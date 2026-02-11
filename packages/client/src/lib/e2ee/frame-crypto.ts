import { encryptFrame, decryptFrame, generateIV } from "./crypto";

const UNENCRYPTED_BYTES = 1;

let currentKey: CryptoKey | null = null;
let senderId = 0;
let frameCounter = 0;

export function setFrameEncryptionKey(key: CryptoKey | null): void {
  currentKey = key;
}

export function setSenderId(id: number): void {
  senderId = id;
}

export function createEncryptTransform(): TransformStream {
  return new TransformStream({
    async transform(encodedFrame: RTCEncodedAudioFrame, controller: TransformStreamDefaultController) {
      if (!currentKey) {
        controller.enqueue(encodedFrame);
        return;
      }

      try {
        const data = encodedFrame.data;
        const header = new Uint8Array(data, 0, UNENCRYPTED_BYTES);
        const payload = data.slice(UNENCRYPTED_BYTES);

        const iv = generateIV(frameCounter++, senderId);
        const encrypted = await encryptFrame(currentKey, payload, iv);

        const newData = new ArrayBuffer(
          UNENCRYPTED_BYTES + iv.byteLength + encrypted.byteLength
        );
        const newView = new Uint8Array(newData);
        newView.set(header, 0);
        newView.set(iv, UNENCRYPTED_BYTES);
        newView.set(new Uint8Array(encrypted), UNENCRYPTED_BYTES + iv.byteLength);

        encodedFrame.data = newData;
        controller.enqueue(encodedFrame);
      } catch (err) {
        console.error("[e2ee] Encrypt error:", err);
        controller.enqueue(encodedFrame);
      }
    },
  });
}

export function createDecryptTransform(): TransformStream {
  return new TransformStream({
    async transform(encodedFrame: RTCEncodedAudioFrame, controller: TransformStreamDefaultController) {
      if (!currentKey) {
        controller.enqueue(encodedFrame);
        return;
      }

      try {
        const data = encodedFrame.data;
        if (data.byteLength <= UNENCRYPTED_BYTES + 12) {
          controller.enqueue(encodedFrame);
          return;
        }

        const header = new Uint8Array(data, 0, UNENCRYPTED_BYTES);
        const iv = new Uint8Array(data, UNENCRYPTED_BYTES, 12);
        const encrypted = data.slice(UNENCRYPTED_BYTES + 12);

        const decrypted = await decryptFrame(currentKey, encrypted, iv);

        const newData = new ArrayBuffer(UNENCRYPTED_BYTES + decrypted.byteLength);
        const newView = new Uint8Array(newData);
        newView.set(header, 0);
        newView.set(new Uint8Array(decrypted), UNENCRYPTED_BYTES);

        encodedFrame.data = newData;
        controller.enqueue(encodedFrame);
      } catch {
        controller.enqueue(encodedFrame);
      }
    },
  });
}

export function applyInsertableStreams(
  sender: RTCRtpSender | null,
  receiver: RTCRtpReceiver | null
): void {
  if (sender && "createEncodedStreams" in sender) {
    const senderStreams = (sender as any).createEncodedStreams();
    const encryptTransform = createEncryptTransform();
    senderStreams.readable
      .pipeThrough(encryptTransform)
      .pipeTo(senderStreams.writable);
  }

  if (receiver && "createEncodedStreams" in receiver) {
    const receiverStreams = (receiver as any).createEncodedStreams();
    const decryptTransform = createDecryptTransform();
    receiverStreams.readable
      .pipeThrough(decryptTransform)
      .pipeTo(receiverStreams.writable);
  }
}
