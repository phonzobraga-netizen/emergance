import sodium from "libsodium-wrappers-sumo";
import { Envelope } from "../core/types";
import { unsignedEnvelopeBytes } from "../core/protocol";

export interface DeviceCryptoIdentity {
  deviceId: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface CryptoConfig {
  identity: DeviceCryptoIdentity;
  networkKey: Uint8Array;
}

export class CryptoService {
  private ready = false;

  constructor(private readonly config: CryptoConfig) {}

  async init(): Promise<void> {
    if (this.ready) {
      return;
    }
    await sodium.ready;
    this.ready = true;
  }

  async encrypt(plainBytes: Uint8Array, aad?: Uint8Array): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
    await this.init();
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES);
    const cipher = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(
      plainBytes,
      aad ?? null,
      null,
      nonce,
      this.config.networkKey
    );
    return { nonce: Uint8Array.from(nonce), ciphertext: Uint8Array.from(cipher) };
  }

  async decrypt(ciphertext: Uint8Array, nonce: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    await this.init();
    const plain = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aad ?? null,
      nonce,
      this.config.networkKey
    );
    return Uint8Array.from(plain);
  }

  async signEnvelope(envelope: Envelope): Promise<Uint8Array> {
    await this.init();
    const bytes = unsignedEnvelopeBytes(envelope);
    const signature = sodium.crypto_sign_detached(bytes, this.config.identity.secretKey);
    return Uint8Array.from(signature);
  }

  async verifyEnvelope(envelope: Envelope, senderPublicKey: Uint8Array): Promise<boolean> {
    await this.init();
    const bytes = unsignedEnvelopeBytes(envelope);
    return sodium.crypto_sign_verify_detached(envelope.signature, bytes, senderPublicKey);
  }

  static async generateIdentity(deviceId: string): Promise<DeviceCryptoIdentity> {
    await sodium.ready;
    const pair = sodium.crypto_sign_keypair();
    return {
      deviceId,
      publicKey: Uint8Array.from(pair.publicKey),
      secretKey: Uint8Array.from(pair.privateKey)
    };
  }

  static async randomNetworkKey(): Promise<Uint8Array> {
    await sodium.ready;
    return Uint8Array.from(
      sodium.randombytes_buf(sodium.crypto_aead_chacha20poly1305_ietf_KEYBYTES)
    );
  }
}
