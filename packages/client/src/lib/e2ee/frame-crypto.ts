// E2EE Frame Encryption using Insertable Streams (main-thread TransformStream).
// Electron 34 does not support RTCRtpScriptTransform, so we use the older
// sender.transform / receiver.transform with a TransformStream directly.

// Audio (Opus): preserve 1 byte (TOC byte) so the frame is still valid RTP.
// Video (VP8/VP9): preserve 10 bytes (payload descriptor + keyframe indicator)
// so the SFU can detect keyframes and route them correctly.
const UNENCRYPTED_BYTES_AUDIO = 1;
const UNENCRYPTED_BYTES_VIDEO = 10;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

let currentKey: CryptoKey | null = null;

/**
 * Update the encryption key for all active frame transforms.
 * Called from the main thread when the channel key changes.
 */
export async function setFrameEncryptionKey(key: CryptoKey | null): Promise<void> {
  currentKey = key;
}

/**
 * Apply an encrypt TransformStream to a sender (encrypt outgoing frames).
 * @param mediaKind - "audio" or "video" — determines how many unencrypted header bytes to preserve
 */
export function applyEncryptTransform(sender: RTCRtpSender, mediaKind: "audio" | "video" = "audio"): void {
  const unencryptedBytes = mediaKind === "video" ? UNENCRYPTED_BYTES_VIDEO : UNENCRYPTED_BYTES_AUDIO;
  const transform = new TransformStream({
    async transform(encodedFrame: any, controller: any) {
      if (!currentKey) {
        // No key — drop frame to prevent sending unencrypted data
        return;
      }
      try {
        const data: ArrayBuffer = encodedFrame.data;
        const headerLen = Math.min(unencryptedBytes, data.byteLength);
        const header = new Uint8Array(data, 0, headerLen);
        const payload = data.slice(headerLen);

        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const encrypted = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
          currentKey,
          payload
        );

        const newData = new ArrayBuffer(headerLen + iv.byteLength + encrypted.byteLength);
        const newView = new Uint8Array(newData);
        newView.set(header, 0);
        newView.set(iv, headerLen);
        newView.set(new Uint8Array(encrypted), headerLen + iv.byteLength);

        encodedFrame.data = newData;
        controller.enqueue(encodedFrame);
      } catch {
        // Encrypt failed — drop frame to prevent sending unencrypted
      }
    },
  });
  (sender as any).transform = transform;
}

/**
 * Apply a decrypt TransformStream to a receiver (decrypt incoming frames).
 * @param mediaKind - "audio" or "video" — must match the sender's mediaKind
 */
export function applyDecryptTransform(receiver: RTCRtpReceiver, mediaKind: "audio" | "video" = "audio"): void {
  const unencryptedBytes = mediaKind === "video" ? UNENCRYPTED_BYTES_VIDEO : UNENCRYPTED_BYTES_AUDIO;
  const transform = new TransformStream({
    async transform(encodedFrame: any, controller: any) {
      if (!currentKey) {
        // No key — drop frame to prevent playing garbage / unencrypted data
        return;
      }
      try {
        const data: ArrayBuffer = encodedFrame.data;
        if (data.byteLength <= unencryptedBytes + IV_LENGTH) {
          // Too short to be encrypted — drop
          return;
        }

        const headerLen = Math.min(unencryptedBytes, data.byteLength);
        const header = new Uint8Array(data, 0, headerLen);
        const iv = new Uint8Array(data, headerLen, IV_LENGTH);
        const encrypted = data.slice(headerLen + IV_LENGTH);

        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
          currentKey,
          encrypted
        );

        const newData = new ArrayBuffer(headerLen + decrypted.byteLength);
        const newView = new Uint8Array(newData);
        newView.set(header, 0);
        newView.set(new Uint8Array(decrypted), headerLen);

        encodedFrame.data = newData;
        controller.enqueue(encodedFrame);
      } catch {
        // Decrypt failed — drop frame to prevent garbage output
      }
    },
  });
  (receiver as any).transform = transform;
}

/**
 * Clean up. Call when leaving a channel.
 */
export function resetFrameCrypto(): void {
  currentKey = null;
}
