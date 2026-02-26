import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CryptoService, DeviceCryptoIdentity } from "./crypto";

interface KeyRecord {
  deviceId: string;
  role: "SOS" | "DRIVER" | "DISPATCH" | "RELAY";
  publicKeyBase64: string;
}

interface IdentityRecord extends KeyRecord {
  secretKeyBase64: string;
}

interface MissionKeyFile {
  networkKeyBase64: string;
  dispatchIdentity: IdentityRecord;
  trustedDevices: KeyRecord[];
}

function defaultSharedNetworkKey(): Uint8Array {
  return Uint8Array.from(
    crypto.createHash("sha256").update("emergance-offline-network-v1", "utf8").digest().subarray(0, 32)
  );
}

export class KeyStore {
  private constructor(
    public readonly missionFilePath: string,
    public readonly networkKey: Uint8Array,
    public readonly identity: DeviceCryptoIdentity,
    private readonly trustedKeys: Map<string, Uint8Array>
  ) {}

  static async loadOrInit(missionFilePath: string, deviceId = "dispatch-main"): Promise<KeyStore> {
    fs.mkdirSync(path.dirname(missionFilePath), { recursive: true });
    const sharedNetworkKey = defaultSharedNetworkKey();

    if (!fs.existsSync(missionFilePath)) {
      const identity = await CryptoService.generateIdentity(deviceId);
      const initial: MissionKeyFile = {
        networkKeyBase64: Buffer.from(sharedNetworkKey).toString("base64"),
        dispatchIdentity: {
          deviceId,
          role: "DISPATCH",
          publicKeyBase64: Buffer.from(identity.publicKey).toString("base64"),
          secretKeyBase64: Buffer.from(identity.secretKey).toString("base64")
        },
        trustedDevices: [
          {
            deviceId,
            role: "DISPATCH",
            publicKeyBase64: Buffer.from(identity.publicKey).toString("base64")
          }
        ]
      };
      fs.writeFileSync(missionFilePath, JSON.stringify(initial, null, 2), "utf8");
    }

    const loaded = JSON.parse(fs.readFileSync(missionFilePath, "utf8")) as MissionKeyFile;
    let rewritten = false;

    if (!Array.isArray(loaded.trustedDevices)) {
      loaded.trustedDevices = [];
      rewritten = true;
    }

    const expectedNetworkKeyBase64 = Buffer.from(sharedNetworkKey).toString("base64");
    if (loaded.networkKeyBase64 !== expectedNetworkKeyBase64) {
      // Debug profile uses shared offline key so Android and Dispatch interoperate without manual provisioning.
      loaded.networkKeyBase64 = expectedNetworkKeyBase64;
      rewritten = true;
    }

    const selfPublicKeyBase64 = loaded.dispatchIdentity.publicKeyBase64;
    const selfIndex = loaded.trustedDevices.findIndex((item) => item.deviceId === loaded.dispatchIdentity.deviceId);
    if (selfIndex >= 0) {
      if (loaded.trustedDevices[selfIndex].publicKeyBase64 !== selfPublicKeyBase64) {
        loaded.trustedDevices[selfIndex] = {
          deviceId: loaded.dispatchIdentity.deviceId,
          role: "DISPATCH",
          publicKeyBase64: selfPublicKeyBase64
        };
        rewritten = true;
      }
    } else {
      loaded.trustedDevices.push({
        deviceId: loaded.dispatchIdentity.deviceId,
        role: "DISPATCH",
        publicKeyBase64: selfPublicKeyBase64
      });
      rewritten = true;
    }

    if (rewritten) {
      fs.writeFileSync(missionFilePath, JSON.stringify(loaded, null, 2), "utf8");
    }

    const trusted = new Map<string, Uint8Array>();
    for (const record of loaded.trustedDevices) {
      trusted.set(record.deviceId, Uint8Array.from(Buffer.from(record.publicKeyBase64, "base64")));
    }

    const identity: DeviceCryptoIdentity = {
      deviceId: loaded.dispatchIdentity.deviceId,
      publicKey: Uint8Array.from(Buffer.from(loaded.dispatchIdentity.publicKeyBase64, "base64")),
      secretKey: Uint8Array.from(Buffer.from(loaded.dispatchIdentity.secretKeyBase64, "base64"))
    };

    return new KeyStore(
      missionFilePath,
      sharedNetworkKey,
      identity,
      trusted
    );
  }

  getPublicKey(deviceId: string): Uint8Array | null {
    return this.trustedKeys.get(deviceId) ?? null;
  }

  isTrustedDevice(deviceId: string): boolean {
    return this.trustedKeys.has(deviceId);
  }

  rememberTrustedDevice(
    deviceId: string,
    role: "SOS" | "DRIVER" | "DISPATCH" | "RELAY",
    publicKey: Uint8Array
  ): void {
    this.trustedKeys.set(deviceId, publicKey);

    const loaded = JSON.parse(fs.readFileSync(this.missionFilePath, "utf8")) as MissionKeyFile;
    loaded.trustedDevices = Array.isArray(loaded.trustedDevices) ? loaded.trustedDevices : [];

    const record: KeyRecord = {
      deviceId,
      role,
      publicKeyBase64: Buffer.from(publicKey).toString("base64")
    };

    const existingIndex = loaded.trustedDevices.findIndex((item) => item.deviceId === deviceId);
    if (existingIndex >= 0) {
      loaded.trustedDevices[existingIndex] = record;
    } else {
      loaded.trustedDevices.push(record);
    }

    fs.writeFileSync(this.missionFilePath, JSON.stringify(loaded, null, 2), "utf8");
  }
}
