import type { Router, RtpCodecCapability } from "mediasoup/types";
import { getNextWorker } from "./worker-pool.js";

const channelRouters = new Map<string, Router>();

const mediaCodecs: RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
    parameters: {
      minptime: 10,
      useinbandfec: 1,
    },
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    preferredPayloadType: 96,
    clockRate: 90000,
  },
  {
    kind: "video",
    mimeType: "video/VP9",
    preferredPayloadType: 98,
    clockRate: 90000,
    parameters: {
      "profile-id": 2,
    },
  },
];

export async function getOrCreateRouter(channelId: string): Promise<Router> {
  const existing = channelRouters.get(channelId);
  if (existing && !existing.closed) {
    return existing;
  }

  const worker = getNextWorker();
  const router = await worker.createRouter({ mediaCodecs });

  channelRouters.set(channelId, router);
  console.log(`[media] Router created for channel ${channelId}`);

  return router;
}

export function getRouter(channelId: string): Router | undefined {
  const router = channelRouters.get(channelId);
  if (router && router.closed) {
    channelRouters.delete(channelId);
    return undefined;
  }
  return router;
}

export function closeRouter(channelId: string): void {
  const router = channelRouters.get(channelId);
  if (router && !router.closed) {
    router.close();
  }
  channelRouters.delete(channelId);
}

export function getRouterRtpCapabilities(channelId: string): object | undefined {
  const router = channelRouters.get(channelId);
  if (!router || router.closed) return undefined;
  return router.rtpCapabilities;
}
