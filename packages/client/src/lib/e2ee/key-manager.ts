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
import { signData, verifySignature, getOrCreateIdentity, checkIdentityPin } from "./identity";

export class KeyManager {
  private ecdhKeyPair: CryptoKeyPair | null = null;
  private channelKey: CryptoKey | null = null;
  private keyEpoch = 0;
  private isKeyHolder = false;
  private localUserId: string | null = null;
  private localIdentityPublicKey: string | null = null;
  private currentChannelId: string | null = null;
  private currentServerId: string | null = null;
  private channelMemberIds = new Set<string>();
  private peerPublicKeys = new Map<string, CryptoKey>();
  private peerIdentityKeys = new Map<string, string>();
  private signaling: SignalingClient;
  private onKeyChangedListeners: Array<(key: CryptoKey | null, epoch: number) => void> = [];

  constructor(signaling: SignalingClient) {
    this.signaling = signaling;
  }

  private notifyKeyChanged(): void {
    for (const cb of this.onKeyChangedListeners) {
      cb(this.channelKey, this.keyEpoch);
    }
  }

  async initialize(): Promise<void> {
    this.ecdhKeyPair = await generateECDHKeyPair();
    const identity = await getOrCreateIdentity();
    this.localIdentityPublicKey = identity.publicKeyHex;
  }

  /**
   * Set the current channel context. Must be called before announcePublicKey/electKeyHolder.
   * channelId + serverId are included in all signed payloads to prevent replay/misroute.
   */
  setChannelContext(channelId: string, serverId: string): void {
    this.currentChannelId = channelId;
    this.currentServerId = serverId;
  }

  /**
   * Elect the key holder based on min(SHA-256(identityPublicKey)).
   * This is deterministic, user-controlled, and not gameable by the server.
   * Call this after joining a channel with the list of member userIds.
   */
  async electKeyHolder(localUserId: string, memberUserIds: string[]): Promise<void> {
    this.localUserId = localUserId;
    this.channelMemberIds = new Set(memberUserIds);

    // Determine key holder by identity key hash, not server-assigned userId
    const candidates: Array<{ userId: string; identityHash: string }> = [];

    // Add self
    if (this.localIdentityPublicKey) {
      candidates.push({ userId: localUserId, identityHash: await sha256Hex(this.localIdentityPublicKey) });
    }

    // Add known peers with identity keys
    for (const uid of memberUserIds) {
      if (uid === localUserId) continue;
      const peerIdentity = this.peerIdentityKeys.get(uid);
      if (peerIdentity) {
        candidates.push({ userId: uid, identityHash: await sha256Hex(peerIdentity) });
      }
    }

    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.identityHash.localeCompare(b.identityHash));
    const elected = candidates[0]!;

    if (elected.userId === localUserId && !this.isKeyHolder) {
      await this.becomeKeyHolder();
    }
  }

  async announcePublicKey(targetUserId?: string): Promise<void> {
    if (!this.ecdhKeyPair) await this.initialize();
    if (!this.localIdentityPublicKey || !this.currentChannelId || !this.currentServerId) return;

    const publicKeyRaw = await exportPublicKey(this.ecdhKeyPair!.publicKey);
    const publicKeyB64 = arrayBufferToBase64(publicKeyRaw);
    const signature = await signData(
      `public-key-announce:${publicKeyB64}:${this.currentChannelId}:${this.currentServerId}`
    );
    if (!signature) {
      console.error("[e2ee] Failed to sign public-key-announce — cannot announce");
      return;
    }

    this.signaling.send({
      type: "e2ee",
      payload: {
        kind: "public-key-announce",
        ecdhPublicKey: publicKeyB64,
        identityPublicKey: this.localIdentityPublicKey,
        signature,
        channelId: this.currentChannelId,
        serverId: this.currentServerId,
        targetUserId,
      },
    });
  }

  async handleKeyExchangeMessage(fromUserId: string, payload: E2EEKeyExchangeMessage): Promise<void> {
    switch (payload.kind) {
      case "public-key-announce": {
        // Mandatory: reject unsigned messages
        if (!payload.identityPublicKey || !payload.signature) {
          console.warn(`[e2ee] Rejected unsigned public-key-announce from ${fromUserId}`);
          break;
        }

        // Reject if channel context doesn't match local state
        if (payload.channelId !== this.currentChannelId || payload.serverId !== this.currentServerId) {
          console.warn(`[e2ee] Rejected public-key-announce from ${fromUserId}: channel/server context mismatch`);
          break;
        }

        const valid = await verifySignature(
          `public-key-announce:${payload.ecdhPublicKey}:${payload.channelId}:${payload.serverId}`,
          payload.signature,
          payload.identityPublicKey
        );
        if (!valid) {
          console.warn(`[e2ee] Rejected public-key-announce from ${fromUserId}: invalid signature`);
          break;
        }

        // TOFU identity pin check — hard-fail on mismatch
        if (this.currentServerId) {
          const pinResult = await checkIdentityPin(this.currentServerId, fromUserId, payload.identityPublicKey);
          if (pinResult === "mismatch") {
            console.error(`[e2ee] REJECTED public-key-announce from ${fromUserId}: identity key changed (TOFU pin mismatch — possible MITM)`);
            break;
          }
          if (pinResult === "new") {
            console.log(`[e2ee] First contact with ${fromUserId} — identity key pinned (TOFU)`);
          }
        }

        this.peerIdentityKeys.set(fromUserId, payload.identityPublicKey);
        const publicKey = await importPublicKey(base64ToArrayBuffer(payload.ecdhPublicKey));
        this.peerPublicKeys.set(fromUserId, publicKey);

        // Re-evaluate key holder election now that we have a new peer's identity
        if (this.localUserId) {
          await this.reelectKeyHolder();
        }

        // If we're the key holder, send the channel key to the new peer
        if (this.isKeyHolder && this.channelKey && this.ecdhKeyPair && this.localIdentityPublicKey) {
          await this.sendEncryptedKeyTo(fromUserId, publicKey);
        }
        break;
      }

      case "encrypted-channel-key": {
        if (!this.ecdhKeyPair) break;

        // Mandatory: reject unsigned messages
        if (!payload.identityPublicKey || !payload.signature) {
          console.warn(`[e2ee] Rejected unsigned encrypted-channel-key from ${fromUserId}`);
          break;
        }

        // Reject if channel context doesn't match local state
        if (payload.channelId !== this.currentChannelId || payload.serverId !== this.currentServerId) {
          console.warn(`[e2ee] Rejected encrypted-channel-key from ${fromUserId}: channel/server context mismatch`);
          break;
        }

        // TOFU identity pin check — hard-fail on mismatch
        if (this.currentServerId) {
          const pinResult = await checkIdentityPin(this.currentServerId, fromUserId, payload.identityPublicKey);
          if (pinResult === "mismatch") {
            console.error(`[e2ee] REJECTED encrypted-channel-key from ${fromUserId}: identity key changed (TOFU pin mismatch — possible MITM)`);
            break;
          }
        }

        // Cross-check with in-session identity
        const knownIdentity = this.peerIdentityKeys.get(fromUserId);
        if (knownIdentity && knownIdentity !== payload.identityPublicKey) {
          console.error(`[e2ee] REJECTED encrypted-channel-key from ${fromUserId}: identity key mismatch with session state`);
          break;
        }

        const valid2 = await verifySignature(
          `encrypted-channel-key:${payload.encryptedKey}:${payload.keyEpoch}:${payload.channelId}:${payload.serverId}`,
          payload.signature,
          payload.identityPublicKey
        );
        if (!valid2) {
          console.warn(`[e2ee] Rejected encrypted-channel-key from ${fromUserId}: invalid signature`);
          break;
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
        this.notifyKeyChanged();
        break;
      }

      case "key-ratchet": {
        // Mandatory: reject unsigned messages
        if (!payload.identityPublicKey || !payload.signature) {
          console.warn(`[e2ee] Rejected unsigned key-ratchet from ${fromUserId}`);
          break;
        }

        // Reject if channel context doesn't match local state
        if (payload.channelId !== this.currentChannelId || payload.serverId !== this.currentServerId) {
          console.warn(`[e2ee] Rejected key-ratchet from ${fromUserId}: channel/server context mismatch`);
          break;
        }

        // TOFU identity pin check — hard-fail on mismatch
        if (this.currentServerId) {
          const pinResult = await checkIdentityPin(this.currentServerId, fromUserId, payload.identityPublicKey);
          if (pinResult === "mismatch") {
            console.error(`[e2ee] REJECTED key-ratchet from ${fromUserId}: identity key changed (TOFU pin mismatch — possible MITM)`);
            break;
          }
        }

        // Cross-check with in-session identity
        const knownIdentity3 = this.peerIdentityKeys.get(fromUserId);
        if (knownIdentity3 && knownIdentity3 !== payload.identityPublicKey) {
          console.error(`[e2ee] REJECTED key-ratchet from ${fromUserId}: identity key mismatch with session state`);
          break;
        }

        const valid3 = await verifySignature(
          `key-ratchet:${payload.keyEpoch}:${payload.reason}:${payload.channelId}:${payload.serverId}`,
          payload.signature,
          payload.identityPublicKey
        );
        if (!valid3) {
          console.warn(`[e2ee] Rejected key-ratchet from ${fromUserId}: invalid signature`);
          break;
        }

        if (this.channelKey) {
          this.channelKey = await ratchetKey(this.channelKey);
          this.keyEpoch = payload.keyEpoch;
          this.notifyKeyChanged();
        }
        break;
      }
    }
  }

  async becomeKeyHolder(): Promise<void> {
    this.isKeyHolder = true;
    this.channelKey = await generateChannelKey();
    this.keyEpoch++;
    this.notifyKeyChanged();

    // Distribute signed key to all known peers
    if (this.ecdhKeyPair && this.localIdentityPublicKey) {
      for (const [userId, publicKey] of this.peerPublicKeys) {
        await this.sendEncryptedKeyTo(userId, publicKey);
      }
    }
  }

  private async sendEncryptedKeyTo(targetUserId: string, recipientEcdhKey: CryptoKey): Promise<void> {
    if (!this.ecdhKeyPair || !this.channelKey || !this.localIdentityPublicKey
        || !this.currentChannelId || !this.currentServerId) return;

    const encrypted = await encryptKeyForRecipient(
      this.channelKey,
      recipientEcdhKey,
      this.ecdhKeyPair.privateKey
    );
    const encryptedKeyB64 = arrayBufferToBase64(encrypted);
    const senderEcdhB64 = arrayBufferToBase64(
      await exportPublicKey(this.ecdhKeyPair.publicKey)
    );
    const sig = await signData(
      `encrypted-channel-key:${encryptedKeyB64}:${this.keyEpoch}:${this.currentChannelId}:${this.currentServerId}`
    );
    if (!sig) {
      console.error("[e2ee] Failed to sign encrypted-channel-key — cannot distribute");
      return;
    }

    this.signaling.send({
      type: "e2ee",
      payload: {
        kind: "encrypted-channel-key",
        targetUserId,
        encryptedKey: encryptedKeyB64,
        senderEcdhPublicKey: senderEcdhB64,
        keyEpoch: this.keyEpoch,
        identityPublicKey: this.localIdentityPublicKey,
        signature: sig,
        channelId: this.currentChannelId,
        serverId: this.currentServerId,
      },
    });
  }

  async onMemberLeft(userId: string): Promise<void> {
    this.peerPublicKeys.delete(userId);
    this.peerIdentityKeys.delete(userId);
    this.channelMemberIds.delete(userId);

    // If we're the key holder, ratchet the key for forward secrecy
    if (this.isKeyHolder && this.channelKey && this.localIdentityPublicKey
        && this.currentChannelId && this.currentServerId) {
      this.channelKey = await ratchetKey(this.channelKey);
      this.keyEpoch++;
      this.notifyKeyChanged();

      const sig = await signData(
        `key-ratchet:${this.keyEpoch}:member-left:${this.currentChannelId}:${this.currentServerId}`
      );
      if (sig) {
        this.signaling.send({
          type: "e2ee",
          payload: {
            kind: "key-ratchet",
            keyEpoch: this.keyEpoch,
            reason: "member-left",
            identityPublicKey: this.localIdentityPublicKey,
            signature: sig,
            channelId: this.currentChannelId,
            serverId: this.currentServerId,
          },
        });
      }
    } else if (!this.isKeyHolder && this.localUserId) {
      // Re-elect based on identity key hash
      await this.reelectKeyHolder();
    }
  }

  private async reelectKeyHolder(): Promise<void> {
    if (!this.localUserId || !this.localIdentityPublicKey) return;

    const candidates: Array<{ userId: string; identityHash: string }> = [];
    candidates.push({ userId: this.localUserId, identityHash: await sha256Hex(this.localIdentityPublicKey) });

    for (const uid of this.channelMemberIds) {
      if (uid === this.localUserId) continue;
      const peerIdentity = this.peerIdentityKeys.get(uid);
      if (peerIdentity) {
        candidates.push({ userId: uid, identityHash: await sha256Hex(peerIdentity) });
      }
    }

    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.identityHash.localeCompare(b.identityHash));

    if (candidates[0]!.userId === this.localUserId && !this.isKeyHolder) {
      await this.becomeKeyHolder();
    }
  }

  onKeyChanged(callback: (key: CryptoKey | null, epoch: number) => void): () => void {
    this.onKeyChangedListeners.push(callback);
    return () => {
      this.onKeyChangedListeners = this.onKeyChangedListeners.filter((cb) => cb !== callback);
    };
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
    this.localIdentityPublicKey = null;
    this.currentChannelId = null;
    this.currentServerId = null;
    this.channelMemberIds.clear();
    this.peerPublicKeys.clear();
    this.peerIdentityKeys.clear();
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}
