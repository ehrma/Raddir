import { exportKey } from "./crypto";

// Ports to all active e2ee workers (so we can broadcast key updates)
const activePorts: MessagePort[] = [];
let currentKey: CryptoKey | null = null;

/**
 * Check if the browser/Electron supports RTCRtpScriptTransform.
 */
export function supportsEncodedTransform(): boolean {
  return typeof (globalThis as any).RTCRtpScriptTransform === "function";
}

/**
 * Update the encryption key for all active frame transforms.
 * Called from the main thread when the channel key changes.
 */
export async function setFrameEncryptionKey(key: CryptoKey | null): Promise<void> {
  currentKey = key;
  if (!key) {
    for (const port of activePorts) {
      port.postMessage({ type: "clearKey" });
    }
    return;
  }
  const raw = await exportKey(key);
  for (const port of activePorts) {
    port.postMessage({ type: "setKey", key: raw }, [raw.slice(0)]);
  }
}

/**
 * Apply an RTCRtpScriptTransform to a sender (encrypt) or receiver (decrypt).
 * Creates a dedicated Worker and MessageChannel for each transform.
 */
export function applyEncryptTransform(sender: RTCRtpSender): void {
  if (!supportsEncodedTransform()) return;

  const worker = new Worker("/e2ee-worker.js");
  const channel = new MessageChannel();
  activePorts.push(channel.port1);

  const transform = new (globalThis as any).RTCRtpScriptTransform(
    worker,
    { name: "encrypt", port: channel.port2 },
    [channel.port2]
  );
  (sender as any).transform = transform;

  // Send current key immediately if available
  if (currentKey) {
    exportKey(currentKey).then((raw) => {
      channel.port1.postMessage({ type: "setKey", key: raw }, [raw]);
    });
  }
  channel.port1.start();
}

export function applyDecryptTransform(receiver: RTCRtpReceiver): void {
  if (!supportsEncodedTransform()) return;

  const worker = new Worker("/e2ee-worker.js");
  const channel = new MessageChannel();
  activePorts.push(channel.port1);

  const transform = new (globalThis as any).RTCRtpScriptTransform(
    worker,
    { name: "decrypt", port: channel.port2 },
    [channel.port2]
  );
  (receiver as any).transform = transform;

  // Send current key immediately if available
  if (currentKey) {
    exportKey(currentKey).then((raw) => {
      channel.port1.postMessage({ type: "setKey", key: raw }, [raw]);
    });
  }
  channel.port1.start();
}

/**
 * Clean up all active worker ports.
 */
export function resetFrameCrypto(): void {
  for (const port of activePorts) {
    port.postMessage({ type: "clearKey" });
    port.close();
  }
  activePorts.length = 0;
  currentKey = null;
}
