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
let currentRawKey: ArrayBuffer | null = null;
let encryptCount = 0;
let decryptCount = 0;
let encryptDropCount = 0;
let decryptDropCount = 0;
let decryptFailCount = 0;
let lastLogTime = 0;
const activeScriptWorkers = new Set<Worker>();

type TransformTarget = RTCRtpSender | RTCRtpReceiver;

function attachScriptWorker(target: TransformTarget, worker: Worker): void {
  const targetAny = target as any;
  const existing = targetAny.__raddirFrameCryptoWorker as Worker | undefined;
  if (existing) {
    existing.terminate();
    activeScriptWorkers.delete(existing);
  }
  targetAny.__raddirFrameCryptoWorker = worker;
  activeScriptWorkers.add(worker);
}

function createFrameCryptoWorker(): Worker {
  const workerSource = `
    const IV_LENGTH = ${IV_LENGTH};
    const TAG_LENGTH = ${TAG_LENGTH};
    let key = null;

    self.onmessage = async (event) => {
      const data = event.data || {};
      if (data.type !== "set-key") return;
      if (!data.key) {
        key = null;
        return;
      }
      key = await crypto.subtle.importKey(
        "raw",
        data.key,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    };

    self.onrtctransform = (event) => {
      const transformer = event.transformer;
      const options = transformer.options || event.options || {};
      const operation = options.operation === "decrypt" ? "decrypt" : "encrypt";
      const unencryptedBytes = Number(options.unencryptedBytes ?? 1);

      const stream = new TransformStream({
        async transform(encodedFrame, controller) {
          if (!key) {
            return;
          }

          try {
            const data = encodedFrame.data;
            const headerLen = Math.min(unencryptedBytes, data.byteLength);

            if (operation === "encrypt") {
              const header = new Uint8Array(data, 0, headerLen);
              const payload = data.slice(headerLen);
              const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
              const encrypted = await crypto.subtle.encrypt(
                { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
                key,
                payload
              );

              const newData = new ArrayBuffer(headerLen + iv.byteLength + encrypted.byteLength);
              const newView = new Uint8Array(newData);
              newView.set(header, 0);
              newView.set(iv, headerLen);
              newView.set(new Uint8Array(encrypted), headerLen + iv.byteLength);

              encodedFrame.data = newData;
              controller.enqueue(encodedFrame);
              return;
            }

            if (data.byteLength <= headerLen + IV_LENGTH) {
              return;
            }

            const header = new Uint8Array(data, 0, headerLen);
            const iv = new Uint8Array(data, headerLen, IV_LENGTH);
            const encrypted = data.slice(headerLen + IV_LENGTH);

            const decrypted = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
              key,
              encrypted
            );

            const newData = new ArrayBuffer(headerLen + decrypted.byteLength);
            const newView = new Uint8Array(newData);
            newView.set(header, 0);
            newView.set(new Uint8Array(decrypted), headerLen);
            encodedFrame.data = newData;
            controller.enqueue(encodedFrame);
          } catch {
            // drop invalid frames
          }
        },
      });

      transformer.readable
        .pipeThrough(stream)
        .pipeTo(transformer.writable)
        .catch(() => {});
    };
  `;

  const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const worker = new Worker(blobUrl);
  URL.revokeObjectURL(blobUrl);
  return worker;
}

function sendKeyToWorker(worker: Worker, rawKey: ArrayBuffer | null): void {
  if (rawKey) {
    const keyCopy = rawKey.slice(0);
    worker.postMessage({ type: "set-key", key: keyCopy }, [keyCopy]);
    return;
  }
  worker.postMessage({ type: "set-key", key: null });
}

function broadcastKeyToWorkers(rawKey: ArrayBuffer | null): void {
  for (const worker of activeScriptWorkers) {
    sendKeyToWorker(worker, rawKey);
  }
}

function tryApplyScriptTransform(
  target: TransformTarget,
  operation: "encrypt" | "decrypt",
  unencryptedBytes: number,
): boolean {
  const ctor = (globalThis as any).RTCRtpScriptTransform;
  if (typeof ctor !== "function") return false;

  let worker: Worker | null = null;
  try {
    worker = createFrameCryptoWorker();
    attachScriptWorker(target, worker);
    sendKeyToWorker(worker, currentRawKey);
    const scriptTransform = new ctor(worker, { operation, unencryptedBytes });
    (target as any).transform = scriptTransform;
    return true;
  } catch (error) {
    console.warn(`[e2ee-frames] Failed to apply RTCRtpScriptTransform (${operation})`, error);
    if (worker) {
      worker.terminate();
      activeScriptWorkers.delete(worker);
    }
    return false;
  }
}

function tryApplyLegacyTransform(target: TransformTarget, transform: TransformStream<any, any>): boolean {
  const targetAny = target as any;

  if (typeof targetAny.createEncodedStreams === "function") {
    try {
      const streams = targetAny.createEncodedStreams();
      if (streams?.readable && streams?.writable) {
        streams.readable.pipeThrough(transform).pipeTo(streams.writable).catch(() => {});
        return true;
      }
    } catch (error) {
      console.warn("[e2ee-frames] Failed to apply createEncodedStreams transform", error);
    }
  }

  try {
    targetAny.transform = transform;
    return true;
  } catch (error) {
    console.warn("[e2ee-frames] Failed to assign legacy transform", error);
    return false;
  }
}

function logFrameStats(): void {
  const now = Date.now();
  if (now - lastLogTime < 5000) return;
  lastLogTime = now;
  console.log(`[e2ee-frames] encrypt: ${encryptCount} ok, ${encryptDropCount} dropped | decrypt: ${decryptCount} ok, ${decryptDropCount} dropped, ${decryptFailCount} failed | key: ${currentKey ? 'set' : 'null'}`);
  encryptCount = decryptCount = encryptDropCount = decryptDropCount = decryptFailCount = 0;
}

/**
 * Update the encryption key for all active frame transforms.
 * Called from the main thread when the channel key changes.
 */
export async function setFrameEncryptionKey(key: CryptoKey | null): Promise<void> {
  currentKey = key;
  currentRawKey = key ? await crypto.subtle.exportKey("raw", key) : null;
  broadcastKeyToWorkers(currentRawKey);
}

/**
 * Apply an encrypt TransformStream to a sender (encrypt outgoing frames).
 * @param mediaKind - "audio" or "video" — determines how many unencrypted header bytes to preserve
 */
export function applyEncryptTransform(sender: RTCRtpSender, mediaKind: "audio" | "video" = "audio"): void {
  const unencryptedBytes = mediaKind === "video" ? UNENCRYPTED_BYTES_VIDEO : UNENCRYPTED_BYTES_AUDIO;
  if (tryApplyScriptTransform(sender, "encrypt", unencryptedBytes)) {
    return;
  }

  const transform = new TransformStream({
    async transform(encodedFrame: any, controller: any) {
      if (!currentKey) {
        // No key — drop frame to prevent sending unencrypted data
        encryptDropCount++;
        logFrameStats();
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
        encryptCount++;
        logFrameStats();
      } catch {
        // Encrypt failed — drop frame to prevent sending unencrypted
        encryptDropCount++;
        logFrameStats();
      }
    },
  });
  if (!tryApplyLegacyTransform(sender, transform)) {
    console.warn("[e2ee-frames] No compatible insertable-stream API for sender. E2EE encrypt disabled for this track.");
  }
}

/**
 * Apply a decrypt TransformStream to a receiver (decrypt incoming frames).
 * @param mediaKind - "audio" or "video" — must match the sender's mediaKind
 */
export function applyDecryptTransform(receiver: RTCRtpReceiver, mediaKind: "audio" | "video" = "audio"): void {
  const unencryptedBytes = mediaKind === "video" ? UNENCRYPTED_BYTES_VIDEO : UNENCRYPTED_BYTES_AUDIO;
  if (tryApplyScriptTransform(receiver, "decrypt", unencryptedBytes)) {
    return;
  }

  const transform = new TransformStream({
    async transform(encodedFrame: any, controller: any) {
      if (!currentKey) {
        // No key — drop frame to prevent playing garbage / unencrypted data
        decryptDropCount++;
        logFrameStats();
        return;
      }
      try {
        const data: ArrayBuffer = encodedFrame.data;
        if (data.byteLength <= unencryptedBytes + IV_LENGTH) {
          // Too short to be encrypted — drop
          decryptDropCount++;
          logFrameStats();
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
        decryptCount++;
        logFrameStats();
      } catch {
        // Decrypt failed — drop frame to prevent garbage output
        decryptFailCount++;
        logFrameStats();
      }
    },
  });
  if (!tryApplyLegacyTransform(receiver, transform)) {
    console.warn("[e2ee-frames] No compatible insertable-stream API for receiver. E2EE decrypt disabled for this track.");
  }
}

/**
 * Clean up. Call when leaving a channel.
 */
export function resetFrameCrypto(): void {
  currentKey = null;
  currentRawKey = null;
  for (const worker of activeScriptWorkers) {
    worker.terminate();
  }
  activeScriptWorkers.clear();
}
