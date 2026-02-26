package com.emergance.app.security

import android.content.Context
import com.emergance.app.BuildConfig
import com.emergance.app.data.db.MessageInboxEntity
import com.emergance.protocol.Envelope
import java.security.Signature
import java.security.KeyFactory
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import com.google.protobuf.ByteString

class CryptoManager(context: Context) {
    private val keyMaterialStore = KeyMaterialStore(context)
    private val keyMaterial = keyMaterialStore.loadOrCreate(defaultRole = defaultRole())

    val deviceId: String = keyMaterial.identity.deviceId
    val missionFilePath: String = keyMaterial.missionFile.absolutePath
    val publicKeyEncoded: ByteArray = keyMaterial.identity.publicKey.encoded.copyOf()

    fun trustedDevice(deviceId: String) = keyMaterial.trustedDevices[deviceId]

    fun encrypt(plain: ByteArray): Pair<ByteArray, ByteArray> {
        val cipher = Cipher.getInstance("ChaCha20-Poly1305")
        val nonce = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val key = SecretKeySpec(keyMaterial.networkKey, "ChaCha20")
        cipher.init(Cipher.ENCRYPT_MODE, key, IvParameterSpec(nonce))
        return nonce to cipher.doFinal(plain)
    }

    fun decrypt(cipherText: ByteArray, nonce: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("ChaCha20-Poly1305")
        val key = SecretKeySpec(keyMaterial.networkKey, "ChaCha20")
        cipher.init(Cipher.DECRYPT_MODE, key, IvParameterSpec(nonce))
        return cipher.doFinal(cipherText)
    }

    fun sign(unsignedEnvelopeBytes: ByteArray): ByteArray {
        val signature = Signature.getInstance("Ed25519")
        signature.initSign(keyMaterial.identity.privateKey)
        signature.update(unsignedEnvelopeBytes)
        return signature.sign()
    }

    fun verify(envelope: Envelope): Boolean {
        val signatureBytes = envelope.signature.toByteArray()
        if (signatureBytes.isEmpty()) {
            return false
        }

        val unsigned = envelope.toBuilder().clearSignature().build().toByteArray()

        val trusted = trustedDevice(envelope.senderDeviceId)
        if (trusted != null && verifyWithKey(unsigned, signatureBytes, trusted.publicKey)) {
            return true
        }

        val announcedKeyBytes = envelope.keyId.toByteArray()
        if (announcedKeyBytes.isEmpty()) {
            return false
        }

        val announcedKey = runCatching {
            KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(announcedKeyBytes))
        }.getOrNull() ?: return false

        val verified = verifyWithKey(unsigned, signatureBytes, announcedKey)
        if (verified) {
            val role = envelope.senderRole.name
            keyMaterialStore.rememberTrustedDevice(envelope.senderDeviceId, role, announcedKeyBytes)
            keyMaterial.trustedDevices[envelope.senderDeviceId] = TrustedDevice(
                deviceId = envelope.senderDeviceId,
                role = role,
                publicKey = announcedKey
            )
        }
        return verified
    }

    fun buildSignedEnvelope(
        base: Envelope.Builder,
        nonce: ByteArray,
        cipherText: ByteArray
    ): Envelope {
        val unsigned = base
            .setSenderDeviceId(deviceId)
            .setNonce(ByteString.copyFrom(nonce))
            .setCiphertext(ByteString.copyFrom(cipherText))
            .setKeyId(ByteString.copyFrom(publicKeyEncoded))
            .clearSignature()
            .build()

        val signature = sign(unsigned.toByteArray())
        return unsigned.toBuilder().setSignature(ByteString.copyFrom(signature)).build()
    }

    fun toInboxRecord(messageId: String, validSignature: Boolean, replayDropped: Boolean): MessageInboxEntity {
        val now = System.currentTimeMillis()
        return MessageInboxEntity(
            messageId = messageId,
            receivedAtMs = now,
            processedAtMs = now,
            validSignature = validSignature,
            replayDropped = replayDropped
        )
    }

    private fun verifyWithKey(unsigned: ByteArray, signatureBytes: ByteArray, publicKey: PublicKey): Boolean {
        val verifier = Signature.getInstance("Ed25519")
        verifier.initVerify(publicKey)
        verifier.update(unsigned)
        return verifier.verify(signatureBytes)
    }

    private fun defaultRole(): String {
        return when (BuildConfig.APP_ROLE) {
            "DRIVER" -> "DRIVER"
            else -> "SOS"
        }
    }
}
