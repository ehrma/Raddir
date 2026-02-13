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
import { signData, verifySignature, getStoredIdentityPublicKey } from "./identity";

export class KeyManager {
  private ecdhKeyPair: CryptoKeyPair | null = null;
  private channelKey: CryptoKey | null = null;
  private keyEpoch = 0;
  private isKeyHolder = false;
  private localUserId: string | null = null;
  private channelMemberIds = new Set<string>();
  private peerPublicKeys = new Map<string, CryptoKey>();
  private peerIdentityKeys = new Map<string, string>();
  private signaling: SignalingClient;
  private onKeyChanged?: (key: CryptoKey, epoch: number) => void;

  constructor(signaling: SignalingClient) {
    this.signaling = signaling;
  }

  async initialize(): Promise<void> {
    this.ecdhKeyPair = await generateECDHKeyPair();
  }

  /**
   * Elect the key holder based on the lowest userId in the channel.
   * Call this after joining a channel with the list of member userIds.
   */
  async electKeyHolder(localUserId: string, memberUserIds: string[]): Promise<void> {
    this.localUserId = localUserId;
    this.channelMemberIds = new Set(memberUserIds);

    const allIds = [...memberUserIds].sort();
    const lowestId = allIds[0];

    if (lowestId === localUserId && !this.isKeyHolder) {
      await this.becomeKeyHolder();
    }
  }

  async announcePublicKey(targetUserId?: string): Promise<void> {
    if (!this.ecdhKeyPair) await this.initialize();

    const publicKeyRaw = await exportPublicKey(this.ecdhKeyPair!.publicKey);
    const publicKeyB64 = arrayBufferToBase64(publicKeyRaw);
    const identityPublicKey = getStoredIdentityPublicKey() ?? undefined;
    const signature = await signData(`public-key-announce:${publicKeyB64}`) ?? undefined;

    this.signaling.send({
      type: "e2ee",
      payload: {
        kind: "public-key-announce",
        ecdhPublicKey: publicKeyB64,
        identityPublicKey,
        signature,
        targetUserId,
      },
    });
  }

  async handleKeyExchangeMessage(fromUserId: string, payload: E2EEKeyExchangeMessage): Promise<void> {
    switch (payload.kind) {
      case "public-key-announce": {
        // Verify signature if the sender provided an identity key
        if (payload.identityPublicKey && payload.signature) {
          const valid = await verifySignature(
            `public-key-announce:${payload.ecdhPublicKey}`,
            payload.signature,
            payload.identityPublicKey
          );
          if (!valid) {
            console.warn(`[e2ee] Rejected public-key-announce from ${fromUserId}: invalid signature`);
            break;
          }
          this.peerIdentityKeys.set(fromUserId, payload.identityPublicKey);
        }

        const publicKey = await importPublicKey(base64ToArrayBuffer(payload.ecdhPublicKey));
        this.peerPublicKeys.set(fromUserId, publicKey);

        // If we're the key holder, send the channel key to the new peer
        if (this.isKeyHolder && this.channelKey && this.ecdhKeyPair) {
          const encryptedKeyB64 = arrayBufferToBase64(
            await encryptKeyForRecipient(
              this.channelKey,
              publicKey,
              this.ecdhKeyPair.privateKey
            )
          );
          const senderEcdhB64 = arrayBufferToBase64(
            await exportPublicKey(this.ecdhKeyPair.publicKey)
          );
          const sig = await signData(`encrypted-channel-key:${encryptedKeyB64}:${this.keyEpoch}`) ?? undefined;

          this.signaling.send({
            type: "e2ee",
            payload: {
              kind: "encrypted-channel-key",
              targetUserId: fromUserId,
              encryptedKey: encryptedKeyB64,
              senderEcdhPublicKey: senderEcdhB64,
              keyEpoch: this.keyEpoch,
              signature: sig,
            },
          });
        }
        break;
      }

      case "encrypted-channel-key": {
        if (!this.ecdhKeyPair) break;

        // Verify signature if the sender has a known identity key
        const senderIdentity = this.peerIdentityKeys.get(fromUserId);
        if (senderIdentity && payload.signature) {
          const valid = await verifySignature(
            `encrypted-channel-key:${payload.encryptedKey}:${payload.keyEpoch}`,
            payload.signature,
            senderIdentity
          );
          if (!valid) {
            console.warn(`[e2ee] Rejected encrypted-channel-key from ${fromUserId}: invalid signature`);
            break;
          }
        }

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
    this.channelMemberIds.delete(userId);

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
    } else if (!this.isKeyHolder && this.localUserId) {
      // Re-elect: if the previous key holder left, the new lowest userId takes over
      const allIds = [...this.channelMemberIds].sort();
      if (allIds[0] === this.localUserId) {
        await this.becomeKeyHolder();
      }
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
    this.localUserId = null;
    this.channelMemberIds.clear();
    this.peerPublicKeys.clear();
  }
}
