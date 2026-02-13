// E2EE Frame Encryption using Insertable Streams (main-thread TransformStream).
// Electron 34 does not support RTCRtpScriptTransform, so we use the older
// sender.transform / receiver.transform with a TransformStream directly.

const UNENCRYPTED_BYTES = 1; // Preserve first byte (Opus TOC)
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
 */
export function applyEncryptTransform(sender: RTCRtpSender): void {
  const transform = new TransformStream({
    async transform(encodedFrame: any, controller: any) {
      if (!currentKey) {
        // No key — drop frame to prevent sending unencrypted audio
        return;
      }
      try {
        const data: ArrayBuffer = encodedFrame.data;
        const header = new Uint8Array(data, 0, UNENCRYPTED_BYTES);
        const payload = data.slice(UNENCRYPTED_BYTES);

        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const encrypted = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
          currentKey,
          payload
        );

        const newData = new ArrayBuffer(UNENCRYPTED_BYTES + iv.byteLength + encrypted.byteLength);
        const newView = new Uint8Array(newData);
        newView.set(header, 0);
        newView.set(iv, UNENCRYPTED_BYTES);
        newView.set(new Uint8Array(encrypted), UNENCRYPTED_BYTES + iv.byteLength);

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
 */
export function applyDecryptTransform(receiver: RTCRtpReceiver): void {
  const transform = new TransformStream({
    async transform(encodedFrame: any, controller: any) {
      if (!currentKey) {
        // No key — drop frame to prevent playing garbage / unencrypted audio
        return;
      }
      try {
        const data: ArrayBuffer = encodedFrame.data;
        if (data.byteLength <= UNENCRYPTED_BYTES + IV_LENGTH) {
          // Too short to be encrypted — drop
          return;
        }

        const header = new Uint8Array(data, 0, UNENCRYPTED_BYTES);
        const iv = new Uint8Array(data, UNENCRYPTED_BYTES, IV_LENGTH);
        const encrypted = data.slice(UNENCRYPTED_BYTES + IV_LENGTH);

        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
          currentKey,
          encrypted
        );

        const newData = new ArrayBuffer(UNENCRYPTED_BYTES + decrypted.byteLength);
        const newView = new Uint8Array(newData);
        newView.set(header, 0);
        newView.set(new Uint8Array(decrypted), UNENCRYPTED_BYTES);

        encodedFrame.data = newData;
        controller.enqueue(encodedFrame);
      } catch {
        // Decrypt failed — drop frame to prevent garbage audio
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
