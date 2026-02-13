import { exportKey } from "./crypto";

interface TransformEntry {
  port: MessagePort;
  worker: Worker;
}

// Active transform workers + their message ports
const activeTransforms: TransformEntry[] = [];
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
    for (const entry of activeTransforms) {
      entry.port.postMessage({ type: "clearKey" });
    }
    return;
  }
  const raw = await exportKey(key);
  for (const entry of activeTransforms) {
    const copy = raw.slice(0);
    entry.port.postMessage({ type: "setKey", key: copy }, [copy]);
  }
}

/**
 * Create a Worker + MessageChannel, wire RTCRtpScriptTransform, and register for key updates.
 */
function createTransform(name: "encrypt" | "decrypt"): TransformEntry {
  const worker = new Worker("/e2ee-worker.js");
  const channel = new MessageChannel();
  const entry: TransformEntry = { port: channel.port1, worker };
  activeTransforms.push(entry);

  const transform = new (globalThis as any).RTCRtpScriptTransform(
    worker,
    { name, port: channel.port2 },
    [channel.port2]
  );

  // Send current key immediately if available
  if (currentKey) {
    exportKey(currentKey).then((raw) => {
      const copy = raw.slice(0);
      channel.port1.postMessage({ type: "setKey", key: copy }, [copy]);
    });
  }
  channel.port1.start();

  return { ...entry, transform } as TransformEntry & { transform: any };
}

/**
 * Apply an RTCRtpScriptTransform to a sender (encrypt outgoing frames).
 */
export function applyEncryptTransform(sender: RTCRtpSender): void {
  if (!supportsEncodedTransform()) return;
  const { transform } = createTransform("encrypt") as any;
  (sender as any).transform = transform;
}

/**
 * Apply an RTCRtpScriptTransform to a receiver (decrypt incoming frames).
 */
export function applyDecryptTransform(receiver: RTCRtpReceiver): void {
  if (!supportsEncodedTransform()) return;
  const { transform } = createTransform("decrypt") as any;
  (receiver as any).transform = transform;
}

/**
 * Clean up all active workers and ports. Call when leaving a channel.
 */
export function resetFrameCrypto(): void {
  for (const entry of activeTransforms) {
    entry.port.postMessage({ type: "clearKey" });
    entry.port.close();
    entry.worker.terminate();
  }
  activeTransforms.length = 0;
  currentKey = null;
}
