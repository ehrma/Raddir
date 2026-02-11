import {
  generateChannelKey,
  generateECDHKeyPair,
  exportPublicKey,
  importPublicKey,
  encryptKeyForRecipient,
  decryptKeyFromSender,
  ratchetKey,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "./crypto";
import type { SignalingClient } from "../signaling-client";
import type { E2EEKeyExchangeMessage } from "@raddir/shared";

export class KeyManager {
  private ecdhKeyPair: CryptoKeyPair | null = null;
  private channelKey: CryptoKey | null = null;
  private keyEpoch = 0;
  private isKeyHolder = false;
  private peerPublicKeys = new Map<string, CryptoKey>();
  private signaling: SignalingClient;
  private onKeyChanged?: (key: CryptoKey, epoch: number) => void;

  constructor(signaling: SignalingClient) {
    this.signaling = signaling;
  }

  async initialize(): Promise<void> {
    this.ecdhKeyPair = await generateECDHKeyPair();
  }

  async announcePublicKey(targetUserId?: string): Promise<void> {
    if (!this.ecdhKeyPair) await this.initialize();

    const publicKeyRaw = await exportPublicKey(this.ecdhKeyPair!.publicKey);
    const publicKeyB64 = arrayBufferToBase64(publicKeyRaw);

    this.signaling.send({
      type: "e2ee",
      payload: {
        kind: "public-key-announce",
        ecdhPublicKey: publicKeyB64,
        targetUserId,
      },
    });
  }

  async handleKeyExchangeMessage(fromUserId: string, payload: E2EEKeyExchangeMessage): Promise<void> {
    switch (payload.kind) {
      case "public-key-announce": {
        const publicKey = await importPublicKey(base64ToArrayBuffer(payload.ecdhPublicKey));
        this.peerPublicKeys.set(fromUserId, publicKey);

        // If we're the key holder, send the channel key to the new peer
        if (this.isKeyHolder && this.channelKey && this.ecdhKeyPair) {
          const encrypted = await encryptKeyForRecipient(
            this.channelKey,
            publicKey,
            this.ecdhKeyPair.privateKey
          );

          this.signaling.send({
            type: "e2ee",
            payload: {
              kind: "encrypted-channel-key",
              targetUserId: fromUserId,
              encryptedKey: arrayBufferToBase64(encrypted),
              senderEcdhPublicKey: arrayBufferToBase64(
                await exportPublicKey(this.ecdhKeyPair.publicKey)
              ),
              keyEpoch: this.keyEpoch,
            },
          });
        }
        break;
      }

      case "encrypted-channel-key": {
        if (!this.ecdhKeyPair) break;

        const senderPublicKey = await importPublicKey(
          base64ToArrayBuffer(payload.senderEcdhPublicKey)
        );
        this.channelKey = await decryptKeyFromSender(
          base64ToArrayBuffer(payload.encryptedKey),
          senderPublicKey,
          this.ecdhKeyPair.privateKey
        );
        this.keyEpoch = payload.keyEpoch;
        this.onKeyChanged?.(this.channelKey, this.keyEpoch);
        break;
      }

      case "key-ratchet": {
        if (this.channelKey) {
          this.channelKey = await ratchetKey(this.channelKey);
          this.keyEpoch = payload.keyEpoch;
          this.onKeyChanged?.(this.channelKey, this.keyEpoch);
        }
        break;
      }
    }
  }

  async becomeKeyHolder(): Promise<void> {
    this.isKeyHolder = true;
    this.channelKey = await generateChannelKey();
    this.keyEpoch++;
    this.onKeyChanged?.(this.channelKey, this.keyEpoch);

    // Distribute key to all known peers
    if (this.ecdhKeyPair) {
      for (const [userId, publicKey] of this.peerPublicKeys) {
        const encrypted = await encryptKeyForRecipient(
          this.channelKey,
          publicKey,
          this.ecdhKeyPair.privateKey
        );

        this.signaling.send({
          type: "e2ee",
          payload: {
            kind: "encrypted-channel-key",
            targetUserId: userId,
            encryptedKey: arrayBufferToBase64(encrypted),
            senderEcdhPublicKey: arrayBufferToBase64(
              await exportPublicKey(this.ecdhKeyPair.publicKey)
            ),
            keyEpoch: this.keyEpoch,
          },
        });
      }
    }
  }

  async onMemberLeft(userId: string): Promise<void> {
    this.peerPublicKeys.delete(userId);

    // If we're the key holder, ratchet the key for forward secrecy
    if (this.isKeyHolder && this.channelKey) {
      this.channelKey = await ratchetKey(this.channelKey);
      this.keyEpoch++;
      this.onKeyChanged?.(this.channelKey, this.keyEpoch);

      this.signaling.send({
        type: "e2ee",
        payload: {
          kind: "key-ratchet",
          keyEpoch: this.keyEpoch,
          reason: "member-left",
        },
      });
    }
  }

  setOnKeyChanged(callback: (key: CryptoKey, epoch: number) => void): void {
    this.onKeyChanged = callback;
  }

  getChannelKey(): CryptoKey | null {
    return this.channelKey;
  }

  getKeyEpoch(): number {
    return this.keyEpoch;
  }

  reset(): void {
    this.channelKey = null;
    this.keyEpoch = 0;
    this.isKeyHolder = false;
    this.peerPublicKeys.clear();
  }
}
