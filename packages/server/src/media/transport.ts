import type {
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  DtlsParameters,
  RtpParameters,
  RtpCapabilities,
  MediaKind,
} from "mediasoup/types";
import type { RaddirConfig } from "../config.js";

export interface PeerTransports {
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

const peerTransports = new Map<string, PeerTransports>();

let transportConfig: {
  listenIps: Array<{ ip: string; announcedIp?: string }>;
  enableUdp: boolean;
  enableTcp: boolean;
  preferUdp: boolean;
  initialAvailableOutgoingBitrate: number;
};

export function initTransportConfig(config: RaddirConfig): void {
  const announcedIp = config.announcedIp || undefined;
  console.log(`[transport] Config: listenIp=0.0.0.0, announcedIp=${announcedIp ?? "(none)"}`);
  transportConfig = {
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000,
  };
}

export async function createWebRtcTransport(
  router: Router,
  peerId: string,
  direction: "send" | "recv"
): Promise<WebRtcTransport> {
  const transport = await router.createWebRtcTransport(transportConfig);

  transport.on("dtlsstatechange", (dtlsState: string) => {
    if (dtlsState === "closed" || dtlsState === "failed") {
      console.log(`[transport] DTLS state ${dtlsState} for peer ${peerId}`);
      transport.close();
    }
  });

  const peer = getOrCreatePeer(peerId);
  if (direction === "send") {
    peer.sendTransport = transport;
  } else {
    peer.recvTransport = transport;
  }

  return transport;
}

export async function connectTransport(
  peerId: string,
  transportId: string,
  dtlsParameters: DtlsParameters
): Promise<void> {
  const transport = findTransport(peerId, transportId);
  if (!transport) throw new Error(`Transport ${transportId} not found for peer ${peerId}`);
  await transport.connect({ dtlsParameters });
}

export async function createProducer(
  peerId: string,
  transportId: string,
  kind: MediaKind,
  rtpParameters: RtpParameters
): Promise<Producer> {
  const transport = findTransport(peerId, transportId);
  if (!transport) throw new Error(`Transport ${transportId} not found`);

  const producer = await transport.produce({ kind, rtpParameters });

  const peer = getOrCreatePeer(peerId);
  peer.producers.set(producer.id, producer);

  producer.on("transportclose", () => {
    console.log(`[transport] Producer transport closed for peer ${peerId}`);
    peer.producers.delete(producer.id);
  });

  return producer;
}

export async function createConsumer(
  router: Router,
  peerId: string,
  producerId: string,
  rtpCapabilities: RtpCapabilities
): Promise<Consumer | null> {
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    console.warn(`[transport] Cannot consume producer ${producerId} for peer ${peerId}`);
    return null;
  }

  const peer = getOrCreatePeer(peerId);
  if (!peer.recvTransport) {
    throw new Error(`No recv transport for peer ${peerId}`);
  }

  const consumer = await peer.recvTransport.consume({
    producerId,
    rtpCapabilities,
    paused: true,
  });

  consumer.on("transportclose", () => {
    console.log(`[transport] Consumer transport closed for peer ${peerId}`);
  });

  consumer.on("producerclose", () => {
    console.log(`[transport] Producer closed for consumer ${consumer.id}`);
    peer.consumers.delete(consumer.id);
  });

  peer.consumers.set(consumer.id, consumer);
  return consumer;
}

export function getProducer(peerId: string): Producer | undefined {
  const peer = peerTransports.get(peerId);
  if (!peer) return undefined;
  // Return first producer (primary audio) for backward compatibility
  return peer.producers.values().next().value;
}

export function getProducers(peerId: string): Map<string, Producer> {
  return peerTransports.get(peerId)?.producers ?? new Map();
}

export function closePeerTransports(peerId: string): void {
  const peer = peerTransports.get(peerId);
  if (!peer) return;

  for (const producer of peer.producers.values()) {
    producer.close();
  }
  for (const consumer of peer.consumers.values()) {
    consumer.close();
  }
  peer.sendTransport?.close();
  peer.recvTransport?.close();
  peerTransports.delete(peerId);
}

export function getPeerTransports(peerId: string): PeerTransports | undefined {
  return peerTransports.get(peerId);
}

function getOrCreatePeer(peerId: string): PeerTransports {
  let peer = peerTransports.get(peerId);
  if (!peer) {
    peer = { producers: new Map(), consumers: new Map() };
    peerTransports.set(peerId, peer);
  }
  return peer;
}

function findTransport(peerId: string, transportId: string): WebRtcTransport | undefined {
  const peer = peerTransports.get(peerId);
  if (!peer) return undefined;
  if (peer.sendTransport?.id === transportId) return peer.sendTransport;
  if (peer.recvTransport?.id === transportId) return peer.recvTransport;
  return undefined;
}
