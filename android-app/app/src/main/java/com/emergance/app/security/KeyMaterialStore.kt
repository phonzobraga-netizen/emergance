package com.emergance.app.security

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

data class DeviceIdentity(
    val deviceId: String,
    val publicKey: PublicKey,
    val privateKey: PrivateKey
)

data class TrustedDevice(
    val deviceId: String,
    val role: String,
    val publicKey: PublicKey
)

data class KeyMaterial(
    val networkKey: ByteArray,
    val identity: DeviceIdentity,
    val trustedDevices: MutableMap<String, TrustedDevice>,
    val missionFile: File
)

class KeyMaterialStore(private val context: Context) {
    private val file: File by lazy {
        File(context.filesDir, "keys/mission-keypack.json").apply { parentFile?.mkdirs() }
    }

    @Synchronized
    fun loadOrCreate(
        defaultDeviceId: String = generatedDefaultDeviceId(),
        defaultRole: String = "SOS"
    ): KeyMaterial {
        val networkKey = defaultNetworkKey()
        if (!file.exists()) {
            val keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()

            val json = JSONObject().apply {
                put("networkKeyBase64", networkKey.toB64())
                put(
                    "identity",
                    JSONObject().apply {
                        put("deviceId", defaultDeviceId)
                        put("role", defaultRole)
                        put("publicKeyBase64", keyPair.public.encoded.toB64())
                        put("privateKeyBase64", keyPair.private.encoded.toB64())
                    }
                )
                put(
                    "trustedDevices",
                    JSONArray().put(
                        JSONObject().apply {
                            put("deviceId", defaultDeviceId)
                            put("role", defaultRole)
                            put("publicKeyBase64", keyPair.public.encoded.toB64())
                        }
                    )
                )
            }
            file.writeText(json.toString(2))
        }

        val parsed = JSONObject(file.readText())
        val persistedNetworkKey = runCatching { parsed.optString("networkKeyBase64", "").fromB64() }
            .getOrDefault(ByteArray(0))
        if (!persistedNetworkKey.contentEquals(networkKey)) {
            // Debug profile uses shared offline key so Android and Dispatch interoperate without manual provisioning.
            parsed.put("networkKeyBase64", networkKey.toB64())
            file.writeText(parsed.toString(2))
        }
        val identityJson = parsed.getJSONObject("identity")

        val keyFactory = KeyFactory.getInstance("Ed25519")
        val publicKey = keyFactory.generatePublic(X509EncodedKeySpec(identityJson.getString("publicKeyBase64").fromB64()))
        val privateKey = keyFactory.generatePrivate(PKCS8EncodedKeySpec(identityJson.getString("privateKeyBase64").fromB64()))

        val normalizedDeviceId = normalizeDeviceId(
            currentDeviceId = identityJson.getString("deviceId"),
            publicKeyEncoded = publicKey.encoded
        )
        if (normalizedDeviceId != identityJson.getString("deviceId")) {
            identityJson.put("deviceId", normalizedDeviceId)
            parsed.put("identity", identityJson)
            file.writeText(parsed.toString(2))
        }

        val identity = DeviceIdentity(
            deviceId = normalizedDeviceId,
            publicKey = publicKey,
            privateKey = privateKey
        )

        val trusted = mutableMapOf<String, TrustedDevice>()
        val trustedArray = parsed.optJSONArray("trustedDevices") ?: JSONArray().also {
            parsed.put("trustedDevices", it)
            file.writeText(parsed.toString(2))
        }
        for (index in 0 until trustedArray.length()) {
            val item = trustedArray.getJSONObject(index)
            val trustedPub = keyFactory.generatePublic(X509EncodedKeySpec(item.getString("publicKeyBase64").fromB64()))
            val trustedDevice = TrustedDevice(
                deviceId = item.getString("deviceId"),
                role = item.optString("role", "RELAY"),
                publicKey = trustedPub
            )
            trusted[trustedDevice.deviceId] = trustedDevice
        }

        if (!trusted.containsKey(identity.deviceId)) {
            trusted[identity.deviceId] = TrustedDevice(
                deviceId = identity.deviceId,
                role = defaultRole,
                publicKey = identity.publicKey
            )
            rememberTrustedDevice(identity.deviceId, defaultRole, identity.publicKey.encoded)
        }

        return KeyMaterial(
            networkKey = networkKey,
            identity = identity,
            trustedDevices = trusted,
            missionFile = file
        )
    }

    @Synchronized
    fun rememberTrustedDevice(deviceId: String, role: String, publicKeyBytes: ByteArray) {
        if (deviceId.isBlank() || publicKeyBytes.isEmpty()) {
            return
        }

        val parsed = if (file.exists()) JSONObject(file.readText()) else JSONObject()
        val trustedArray = parsed.optJSONArray("trustedDevices") ?: JSONArray()
        parsed.put("trustedDevices", trustedArray)

        val record = JSONObject().apply {
            put("deviceId", deviceId)
            put("role", role)
            put("publicKeyBase64", publicKeyBytes.toB64())
        }

        var replaced = false
        for (index in 0 until trustedArray.length()) {
            val item = trustedArray.optJSONObject(index) ?: continue
            if (item.optString("deviceId") == deviceId) {
                trustedArray.put(index, record)
                replaced = true
                break
            }
        }
        if (!replaced) {
            trustedArray.put(record)
        }

        file.writeText(parsed.toString(2))
    }

    private fun defaultNetworkKey(): ByteArray {
        val seed = "emergance-offline-network-v1".toByteArray(Charsets.UTF_8)
        return MessageDigest.getInstance("SHA-256").digest(seed).copyOf(32)
    }

    private fun generatedDefaultDeviceId(): String {
        val modelPrefix = android.os.Build.MODEL
            .replace(" ", "-")
            .lowercase()
            .replace(Regex("[^a-z0-9_-]"), "")
            .ifBlank { "android" }
        val suffix = UUID.randomUUID().toString().replace("-", "").take(8)
        return "android-$modelPrefix-$suffix"
    }

    private fun normalizeDeviceId(currentDeviceId: String, publicKeyEncoded: ByteArray): String {
        val legacyPrefix = "android-${android.os.Build.MODEL.replace(" ", "-").lowercase()}"
        if (currentDeviceId != legacyPrefix) {
            return currentDeviceId
        }

        val fingerprint = MessageDigest.getInstance("SHA-256")
            .digest(publicKeyEncoded)
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
            .take(8)
        return "$legacyPrefix-$fingerprint"
    }
}

private fun ByteArray.toB64(): String = Base64.encodeToString(this, Base64.NO_WRAP)
private fun String.fromB64(): ByteArray = Base64.decode(this, Base64.NO_WRAP)
