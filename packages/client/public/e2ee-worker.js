"use strict";

// E2EE Frame Encryption Worker for RTCRtpScriptTransform
// Handles encrypt/decrypt of audio frames using AES-256-GCM

const UNENCRYPTED_BYTES = 1; // Preserve first byte (Opus TOC)
const IV_LENGTH = 12;
const TAG_LENGTH = 128;

let currentKey = null;
let senderId = 0;
let frameCounter = 0;

function generateIV(counter, sid) {
  const iv = new Uint8Array(IV_LENGTH);
  const view = new DataView(iv.buffer);
  view.setUint32(0, sid, true);
  view.setUint32(4, counter >>> 0, true);
  view.setUint32(8, (counter / 0x100000000) >>> 0, true);
  return iv;
}

async function encryptFrame(encodedFrame, controller) {
  if (!currentKey) {
    controller.enqueue(encodedFrame);
    return;
  }

  try {
    const data = encodedFrame.data;
    const header = new Uint8Array(data, 0, UNENCRYPTED_BYTES);
    const payload = data.slice(UNENCRYPTED_BYTES);

    const iv = generateIV(frameCounter++, senderId);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
      currentKey,
      payload
    );

    const newData = new ArrayBuffer(
      UNENCRYPTED_BYTES + iv.byteLength + encrypted.byteLength
    );
    const newView = new Uint8Array(newData);
    newView.set(header, 0);
    newView.set(iv, UNENCRYPTED_BYTES);
    newView.set(new Uint8Array(encrypted), UNENCRYPTED_BYTES + iv.byteLength);

    encodedFrame.data = newData;
    controller.enqueue(encodedFrame);
  } catch {
    // On error, pass through unencrypted
    controller.enqueue(encodedFrame);
  }
}

async function decryptFrame(encodedFrame, controller) {
  if (!currentKey) {
    controller.enqueue(encodedFrame);
    return;
  }

  try {
    const data = encodedFrame.data;
    if (data.byteLength <= UNENCRYPTED_BYTES + IV_LENGTH) {
      controller.enqueue(encodedFrame);
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
    // Decryption failed — pass through (may be unencrypted frame)
    controller.enqueue(encodedFrame);
  }
}

// Handle RTCRtpScriptTransform events
self.onrtctransform = (event) => {
  const transformer = event.transformer;
  const options = transformer.options || {};

  // Set up message port for receiving key updates
  if (options.port) {
    options.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "setKey" && msg.key) {
        crypto.subtle.importKey(
          "raw",
          msg.key,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        ).then((key) => {
          currentKey = key;
        });
      } else if (msg.type === "clearKey") {
        currentKey = null;
      } else if (msg.type === "setSenderId") {
        senderId = msg.senderId;
      }
    };
    options.port.start();
  }

  const transformFn = options.name === "encrypt" ? encryptFrame : decryptFrame;

  const transform = new TransformStream({ transform: transformFn });
  transformer.readable
    .pipeThrough(transform)
    .pipeTo(transformer.writable);
};
