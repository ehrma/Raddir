import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { RateLimiter } from "../lib/rate-limiter.js";
import { hashCredential } from "../lib/credential-hash.js";
import {
  PERMISSION_KEYS,
  type ClientMessage,
  type ServerMessage,
  type SessionInfo,
  type RoleInfo,
} from "@raddir/shared";
import type { RtpCapabilities } from "mediasoup/types";
import { nanoid } from "nanoid";
import type { RaddirConfig } from "../config.js";
import { ensureDefaultServer, getServer } from "../models/server.js";
import { getChannelsByServer, getChannel, ensureDefaultChannels } from "../models/channel.js";
import { createUser, getUserByPublicKey, addServerMember, assignRole, unassignRole, getUserRoleIds, getUserAvatarPath } from "../models/user.js";
import { getRolesByServer, getDefaultRole, ensureDefaultRoles } from "../models/permission.js";
import { computeEffectivePermissions, hasPermission } from "../permissions/engine.js";
import { createBan, isUserBanned } from "../models/ban.js";
import { getDb } from "../db/database.js";
import { getOrCreateRouter, getRouterRtpCapabilities } from "../media/router.js";
import {
  createWebRtcTransport,
  connectTransport,
  createProducer,
  createConsumer,
  getProducer,
  closePeerTransports,
  getPeerTransports,
} from "../media/transport.js";

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  nickname: string;
  serverId: string | null;
  channelId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isAdmin: boolean;
  publicKey?: string;
  rtpCapabilities?: RtpCapabilities;
}

const clients = new Map<string, ConnectedClient>();

function getChannelClients(channelId: string): ConnectedClient[] {
  return Array.from(clients.values()).filter((c) => c.channelId === channelId);
}

export function getServerClients(serverId: string): ConnectedClient[] {
  return Array.from(clients.values()).filter((c) => c.serverId === serverId);
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(targets: ConnectedClient[], msg: ServerMessage, excludeUserId?: string): void {
  for (const client of targets) {
    if (client.userId !== excludeUserId) {
      send(client.ws, msg);
    }
  }
}

/**
 * Broadcast a message to all connected clients on a given server.
 * Exported so REST API routes can notify clients about channel CRUD, etc.
 */
export function broadcastToServer(serverId: string, msg: ServerMessage): void {
  broadcast(getServerClients(serverId), msg);
}

/** Check permission: ephemeral admin bypasses all checks, otherwise use DB roles. */
function clientHasPermission(client: ConnectedClient, permission: import("@raddir/shared").PermissionKey, channelId?: string): boolean {
  if (client.isAdmin) return true;
  if (!client.serverId) return false;
  return hasPermission(client.userId, client.serverId, permission, channelId);
}

let serverConfig: RaddirConfig;

// Rate limit: 10 auth attempts per IP per 60 seconds
const authLimiter = new RateLimiter(10, 60_000);
authLimiter.startCleanup();

// Per-connection post-auth rate limits (messages per second per category)
const MSG_RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  chat:     { max: 5,  windowMs: 1_000 },
  e2ee:     { max: 10, windowMs: 1_000 },
  speaking: { max: 20, windowMs: 1_000 },
  media:    { max: 20, windowMs: 1_000 },
  general:  { max: 30, windowMs: 1_000 },
};

const CHAT_MAX_CIPHERTEXT_B64_LENGTH = 4 * 1024 * 1024;

function getMsgCategory(type: string): string {
  switch (type) {
    case "chat":
    case "chat-message": return "chat";
    case "e2ee": return "e2ee";
    case "speaking": return "speaking";
    case "create-transport":
    case "connect-transport":
    case "produce":
    case "stop-producer":
    case "consume":
    case "resume-consumer":
    case "set-preferred-layers": return "media";
    default: return "general";
  }
}

function checkMsgRate(counters: Map<string, number[]>, type: string): boolean {
  const category = getMsgCategory(type);
  const limit = MSG_RATE_LIMITS[category] ?? MSG_RATE_LIMITS["general"]!;
  const now = Date.now();
  const cutoff = now - limit.windowMs;
  let timestamps = counters.get(category);
  if (timestamps) {
    timestamps = timestamps.filter((t) => t > cutoff);
  } else {
    timestamps = [];
  }
  if (timestamps.length >= limit.max) {
    counters.set(category, timestamps);
    return false;
  }
  timestamps.push(now);
  counters.set(category, timestamps);
  return true;
}

export function setupSignaling(httpServer: HttpServer, config: RaddirConfig): void {
  serverConfig = config;
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    maxPayload: 4 * 1024 * 1024, // 4 MB max message size (chat images are E2EE payloads)
  });

  // Heartbeat: force-close half-open sockets so disconnect cleanup runs reliably.
  const heartbeatInterval = setInterval(() => {
    for (const socket of wss.clients) {
      const ws = socket as WebSocket & { isAlive?: boolean };
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, 15_000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let client: ConnectedClient | null = null;
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    const remoteIp = (serverConfig.trustProxy
        ? req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()
        : undefined)
      || req.socket.remoteAddress
      || "unknown";
    const msgCounters = new Map<string, number[]>();

    ws.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(ws, { type: "error", code: "INVALID_JSON", message: "Invalid JSON" });
        return;
      }

      try {
        if (msg.type === "auth") {
          if (!authLimiter.check(remoteIp)) {
            send(ws, { type: "auth-result", success: false, error: "Too many auth attempts. Try again later." });
            ws.close();
            return;
          }
          client = await handleAuth(ws, msg);
        } else if (!client) {
          send(ws, { type: "error", code: "NOT_AUTHENTICATED", message: "Authenticate first" });
        } else {
          // Per-connection post-auth rate limiting
          if (!checkMsgRate(msgCounters, msg.type)) {
            send(ws, { type: "error", code: "RATE_LIMITED", message: `Rate limited (${getMsgCategory(msg.type)})` });
            return;
          }
          await handleMessage(client, msg);
        }
      } catch (err: any) {
        console.error(`[signaling] Error handling ${msg.type}:`, err);
        send(ws, { type: "error", code: "INTERNAL_ERROR", message: err.message ?? "Internal error" });
      }
    });

    ws.on("close", () => {
      if (client) {
        handleDisconnect(client);
      }
    });

    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    ws.on("error", (err) => {
      console.error("[signaling] WebSocket error:", err);
    });
  });

  console.log("[signaling] WebSocket server ready on /ws");
}

async function handleAuth(
  ws: WebSocket,
  msg: Extract<ClientMessage, { type: "auth" }>
): Promise<ConnectedClient> {
  // Resolve server early so credential checks can be scoped to it
  const server = ensureDefaultServer();

  // Check server password or session credential
  if (serverConfig.password) {
    let authenticated = false;

    // Option 1: Direct server password
    if (msg.password === serverConfig.password) {
      authenticated = true;
    }

    // Option 2: Session credential (from invite redemption) — requires publicKey
    if (!authenticated && msg.credential && msg.publicKey) {
      const db = getDb();
      const credHash = hashCredential(msg.credential);

      const cred = db.prepare(
        "SELECT id, user_public_key FROM session_credentials WHERE credential_hash = ? AND server_id = ? AND revoked_at IS NULL"
      ).get(credHash, server.id) as any;

      if (cred) {
        if (!cred.user_public_key) {
          // Unbound credential — atomically bind to this publicKey (bootstrap identity)
          const now = Math.floor(Date.now() / 1000);
          const result = db.prepare(
            "UPDATE session_credentials SET user_public_key = ?, bound_at = ? WHERE id = ? AND user_public_key IS NULL"
          ).run(msg.publicKey, now, cred.id);

          if (result.changes === 1) {
            authenticated = true;
          } else {
            // Race: another client bound it first — re-read and check
            const reread = db.prepare(
              "SELECT user_public_key FROM session_credentials WHERE id = ?"
            ).get(cred.id) as any;
            if (reread?.user_public_key === msg.publicKey) {
              authenticated = true;
            }
            // Otherwise: bound to a different key, auth fails
          }
        } else if (cred.user_public_key === msg.publicKey) {
          // Already bound — publicKey matches
          authenticated = true;
        }
        // If bound to a different publicKey, authentication fails (credential stolen)
      }
    }

    // Explicit error: credential without publicKey
    if (!authenticated && msg.credential && !msg.publicKey) {
      send(ws, { type: "auth-result", success: false, error: "publicKey is required for credential authentication" });
      ws.close();
      return { ws, userId: "", nickname: "", serverId: null, channelId: null, isMuted: false, isDeafened: false, isAdmin: false } as ConnectedClient;
    }

    if (!authenticated) {
      send(ws, { type: "auth-result", success: false, error: "Invalid server password or credential" });
      ws.close();
      return { ws, userId: "", nickname: "", serverId: null, channelId: null, isMuted: false, isDeafened: false, isAdmin: false } as ConnectedClient;
    }
  }

  let user = msg.publicKey ? getUserByPublicKey(msg.publicKey) : undefined;

  if (!user) {
    user = createUser(msg.nickname, msg.publicKey);
  }

  // Check ban before sending success or registering the session
  if (isUserBanned(user.id, server.id)) {
    send(ws, { type: "auth-result", success: false, error: "You are banned from this server" });
    ws.close();
    return { ws, userId: "", nickname: "", serverId: null, channelId: null, isMuted: false, isDeafened: false } as ConnectedClient;
  }

  // If this user already has an active session, clean up the old one first
  const existing = clients.get(user.id);
  if (existing && existing.ws !== ws) {
    handleDisconnect(existing);
    try { existing.ws.close(); } catch {}
  }

  const isAdmin = !!(serverConfig.adminToken && msg.adminToken === serverConfig.adminToken);

  const client: ConnectedClient = {
    ws,
    userId: user.id,
    nickname: msg.nickname,
    serverId: null,
    channelId: null,
    isMuted: false,
    isDeafened: false,
    isAdmin,
    publicKey: msg.publicKey,
  };

  clients.set(user.id, client);

  send(ws, {
    type: "auth-result",
    success: true,
    userId: user.id,
  });

  const channels = ensureDefaultChannels(server.id);
  const roles = ensureDefaultRoles(server.id);

  addServerMember(user.id, server.id, msg.nickname);

  const defaultRole = getDefaultRole(server.id);
  if (defaultRole) {
    assignRole(user.id, server.id, defaultRole.id);
  }

  if (isAdmin) {
    console.log(`[signaling] Ephemeral admin privileges granted to ${msg.nickname} (${user.id})`);
  }

  client.serverId = server.id;

  const serverClients = getServerClients(server.id);
  const members: SessionInfo[] = serverClients.map((c) => ({
    userId: c.userId,
    nickname: c.nickname,
    channelId: c.channelId,
    isMuted: c.isMuted,
    isDeafened: c.isDeafened,
    publicKey: c.publicKey,
    roleIds: getUserRoleIds(c.userId, server.id),
    avatarUrl: getUserAvatarPath(c.userId) ? `/api/users/${c.userId}/avatar` : null,
  }));

  const roleInfos: RoleInfo[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color ?? null,
    priority: r.priority,
    permissions: r.permissions,
    isDefault: r.isDefault,
  }));

  let myPermissions = computeEffectivePermissions(user.id, server.id);

  // Ephemeral admin (via admin token) gets all permissions
  if (isAdmin) {
    myPermissions = { ...myPermissions };
    for (const key of PERMISSION_KEYS) {
      myPermissions[key] = "allow";
    }
  }

  send(ws, {
    type: "joined-server",
    serverId: server.id,
    serverName: server.name,
    serverDescription: server.description,
    serverIconUrl: server.iconPath ? `/api/servers/${server.id}/icon` : null,
    maxWebcamProducers: server.maxWebcamProducers,
    maxScreenProducers: server.maxScreenProducers,
    channels,
    members,
    roles: roleInfos,
    myPermissions,
  });

  return client;
}

async function handleMessage(client: ConnectedClient, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case "join-channel":
      await handleJoinChannel(client, msg.channelId);
      break;

    case "leave-channel":
      await handleLeaveChannel(client);
      break;

    case "mute":
      client.isMuted = msg.muted;
      if (client.serverId) {
        broadcast(getServerClients(client.serverId), {
          type: "user-updated",
          userId: client.userId,
          updates: { isMuted: msg.muted },
        }, client.userId);
      }
      break;

    case "deafen":
      client.isDeafened = msg.deafened;
      if (client.serverId) {
        broadcast(getServerClients(client.serverId), {
          type: "user-updated",
          userId: client.userId,
          updates: { isDeafened: msg.deafened },
        }, client.userId);
      }
      break;

    case "rtp-capabilities":
      client.rtpCapabilities = msg.rtpCapabilities as RtpCapabilities;
      break;

    case "create-transport":
      await handleCreateTransport(client, msg.direction);
      break;

    case "connect-transport":
      await connectTransport(client.userId, msg.transportId, msg.dtlsParameters as any);
      break;

    case "produce":
      await handleProduce(client, msg);
      break;

    case "stop-producer":
      handleStopProducer(client, msg.producerId);
      break;

    case "consume":
      await handleConsume(client, msg.producerId);
      break;

    case "resume-consumer":
      await handleResumeConsumer(client, msg.consumerId);
      break;

    case "set-preferred-layers":
      handleSetPreferredLayers(client, msg.consumerId, msg.spatialLayer, msg.temporalLayer);
      break;

    case "chat":
      handleChat(client, msg);
      break;

    case "e2ee":
      handleE2EE(client, msg);
      break;

    case "kick":
      handleKick(client, msg);
      break;

    case "move-user":
      await handleMoveUser(client, msg);
      break;

    case "ban":
      handleBan(client, msg);
      break;

    case "speaking":
      if (client.channelId) {
        broadcast(getChannelClients(client.channelId), {
          type: "speaking",
          userId: client.userId,
          speaking: msg.speaking,
        }, client.userId);
      }
      break;

    case "assign-role":
      handleAssignRole(client, msg.userId, msg.roleId, true);
      break;

    case "unassign-role":
      handleAssignRole(client, msg.userId, msg.roleId, false);
      break;

    default:
      send(client.ws, { type: "error", code: "UNKNOWN_MESSAGE", message: `Unknown message type` });
  }
}

async function handleJoinChannel(client: ConnectedClient, channelId: string): Promise<boolean> {
  if (!client.serverId) {
    send(client.ws, { type: "error", code: "NOT_IN_SERVER", message: "Join a server first" });
    return false;
  }

  const channel = getChannel(channelId);
  if (!channel || channel.serverId !== client.serverId) {
    send(client.ws, { type: "error", code: "CHANNEL_NOT_FOUND", message: "Channel not found" });
    return false;
  }

  if (!clientHasPermission(client, "join", channelId)) {
    send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to join this channel" });
    return false;
  }

  // Check max users
  if (channel.maxUsers > 0) {
    const currentUsers = getChannelClients(channelId).length;
    if (currentUsers >= channel.maxUsers) {
      send(client.ws, { type: "error", code: "CHANNEL_FULL", message: "Channel is full" });
      return false;
    }
  }

  // Leave current channel if in one
  if (client.channelId) {
    await handleLeaveChannel(client);
  }

  client.channelId = channelId;

  // Create router for channel if needed
  const router = await getOrCreateRouter(channelId);

  const channelUsers = getChannelClients(channelId);
  const users: SessionInfo[] = channelUsers.map((c) => ({
    userId: c.userId,
    nickname: c.nickname,
    channelId: c.channelId,
    isMuted: c.isMuted,
    isDeafened: c.isDeafened,
    publicKey: c.publicKey,
    roleIds: client.serverId ? getUserRoleIds(c.userId, client.serverId) : [],
    avatarUrl: getUserAvatarPath(c.userId) ? `/api/users/${c.userId}/avatar` : null,
  }));

  send(client.ws, {
    type: "joined-channel",
    channelId,
    users,
    routerRtpCapabilities: router.rtpCapabilities,
  });

  // Send existing producers so the new joiner can consume them
  for (const other of channelUsers) {
    if (other.userId === client.userId) continue;
    const peer = getPeerTransports(other.userId);
    if (peer) {
      for (const producer of peer.producers.values()) {
        if (!producer.closed) {
          send(client.ws, {
            type: "new-producer",
            userId: other.userId,
            producerId: producer.id,
            mediaType: (producer.appData as any)?.mediaType,
          });
        }
      }
    }
  }

  // Notify others in channel
  broadcast(channelUsers, {
    type: "user-joined-channel",
    user: {
      userId: client.userId,
      nickname: client.nickname,
      channelId: client.channelId,
      isMuted: client.isMuted,
      isDeafened: client.isDeafened,
      publicKey: client.publicKey,
      roleIds: client.serverId ? getUserRoleIds(client.userId, client.serverId) : [],
      avatarUrl: getUserAvatarPath(client.userId) ? `/api/users/${client.userId}/avatar` : null,
    },
  }, client.userId);

  // Notify server about channel change
  broadcast(getServerClients(client.serverId), {
    type: "user-updated",
    userId: client.userId,
    updates: { channelId },
  }, client.userId);

  return true;
}

async function handleLeaveChannel(client: ConnectedClient): Promise<void> {
  if (!client.channelId) return;

  const oldChannelId = client.channelId;

  // Explicitly notify peers that this user's producers are gone before transport teardown.
  // This prevents stale frozen video tiles if clients miss user-left timing.
  const peer = getPeerTransports(client.userId);
  if (peer) {
    for (const producer of peer.producers.values()) {
      broadcast(getChannelClients(oldChannelId), {
        type: "producer-closed",
        producerId: producer.id,
        userId: client.userId,
        mediaType: (producer.appData as any)?.mediaType,
      }, client.userId);
    }
  }

  client.channelId = null;

  closePeerTransports(client.userId);

  // Notify others in old channel
  broadcast(getChannelClients(oldChannelId), {
    type: "user-left-channel",
    userId: client.userId,
  });

  // Notify server about channel change
  if (client.serverId) {
    broadcast(getServerClients(client.serverId), {
      type: "user-updated",
      userId: client.userId,
      updates: { channelId: null },
    }, client.userId);
  }
}

async function handleCreateTransport(
  client: ConnectedClient,
  direction: "send" | "recv"
): Promise<void> {
  if (!client.channelId) {
    send(client.ws, { type: "error", code: "NOT_IN_CHANNEL", message: "Join a channel first" });
    return;
  }

  const router = await getOrCreateRouter(client.channelId);
  const transport = await createWebRtcTransport(router, client.userId, direction);

  send(client.ws, {
    type: "transport-created",
    transportId: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates as unknown as object[],
    dtlsParameters: transport.dtlsParameters,
  });
}

async function handleProduce(
  client: ConnectedClient,
  msg: Extract<ClientMessage, { type: "produce" }>
): Promise<void> {
  if (!client.channelId || !client.serverId) return;

  const mediaType = msg.mediaType ?? "mic";

  // Enforce per-channel producer limits for video/screen
  if (mediaType === "webcam" || mediaType === "screen") {
    const server = getServer(client.serverId);
    if (server) {
      const channelClients = getChannelClients(client.channelId);
      let count = 0;
      for (const c of channelClients) {
        const peer = getPeerTransports(c.userId);
        if (!peer) continue;
        for (const p of peer.producers.values()) {
          if (!p.closed && (p.appData as any)?.mediaType === mediaType) count++;
        }
      }
      const limit = mediaType === "webcam" ? server.maxWebcamProducers : server.maxScreenProducers;
      if (count >= limit) {
        send(client.ws, {
          type: "error",
          code: "PRODUCER_LIMIT",
          message: `Maximum ${limit} ${mediaType === "webcam" ? "webcam" : "screen share"} stream${limit !== 1 ? "s" : ""} reached in this channel`,
        });
        return;
      }
    }
  }

  // Permission check based on media type
  if (mediaType === "mic") {
    if (!clientHasPermission(client, "speak", client.channelId)) {
      send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to speak" });
      return;
    }
  } else if (mediaType === "webcam") {
    if (!clientHasPermission(client, "video", client.channelId)) {
      send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to share video" });
      return;
    }
  } else if (mediaType === "screen" || mediaType === "screen-audio") {
    if (!clientHasPermission(client, "screenShare", client.channelId)) {
      send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to share screen" });
      return;
    }
  }

  const producer = await createProducer(
    client.userId,
    msg.transportId,
    msg.kind,
    msg.rtpParameters as any,
    { mediaType }
  );

  send(client.ws, { type: "produced", producerId: producer.id, mediaType });

  // Notify others in channel about new producer
  broadcast(getChannelClients(client.channelId), {
    type: "new-producer",
    userId: client.userId,
    producerId: producer.id,
    mediaType,
  }, client.userId);
}

function handleStopProducer(client: ConnectedClient, producerId: string): void {
  if (!client.channelId) return;

  const peer = getPeerTransports(client.userId);
  if (!peer) return;

  const producer = peer.producers.get(producerId);
  if (!producer) return;

  const mediaType = (producer.appData as any)?.mediaType;
  producer.close();
  peer.producers.delete(producerId);

  // Notify others in channel
  broadcast(getChannelClients(client.channelId), {
    type: "producer-closed",
    producerId,
    userId: client.userId,
    mediaType,
  }, client.userId);
}

async function handleConsume(client: ConnectedClient, producerId: string): Promise<void> {
  if (!client.channelId || !client.rtpCapabilities) {
    send(client.ws, { type: "error", code: "NOT_READY", message: "Not ready to consume" });
    return;
  }

  const router = await getOrCreateRouter(client.channelId);
  const consumer = await createConsumer(router, client.userId, producerId, client.rtpCapabilities);

  if (!consumer) {
    send(client.ws, { type: "error", code: "CANNOT_CONSUME", message: "Cannot consume this producer" });
    return;
  }

  send(client.ws, {
    type: "consume-result",
    consumerId: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  });
}

async function handleResumeConsumer(client: ConnectedClient, consumerId: string): Promise<void> {
  const peer = getPeerTransports(client.userId);
  if (!peer) return;
  const consumer = peer.consumers.get(consumerId);
  if (consumer) {
    await consumer.resume();
  }
}

function handleSetPreferredLayers(
  client: ConnectedClient,
  consumerId: string,
  spatialLayer: number,
  temporalLayer?: number
): void {
  const peer = getPeerTransports(client.userId);
  if (!peer) return;
  const consumer = peer.consumers.get(consumerId);
  if (!consumer) return;

  const layer = Math.max(0, Math.min(2, spatialLayer));
  consumer.setPreferredLayers({
    spatialLayer: layer,
    ...(temporalLayer !== undefined ? { temporalLayer: Math.max(0, Math.min(2, temporalLayer)) } : {}),
  });
}

function handleChat(
  client: ConnectedClient,
  msg: Extract<ClientMessage, { type: "chat" }>
): void {
  if (!client.channelId || !client.serverId) return;

  if (!msg.ciphertext || msg.ciphertext.length > CHAT_MAX_CIPHERTEXT_B64_LENGTH) {
    send(client.ws, {
      type: "error",
      code: "CHAT_TOO_LARGE",
      message: "Chat message too large",
    });
    return;
  }

  const encoding = msg.encoding === "json-v1" ? "json-v1" : "text";

  // Always use the server-tracked channel — never trust msg.channelId
  const channelClients = getChannelClients(client.channelId);
  broadcast(channelClients, {
    type: "chat",
    channelId: client.channelId,
    userId: client.userId,
    nickname: client.nickname,
    ciphertext: msg.ciphertext,
    iv: msg.iv,
    keyEpoch: msg.keyEpoch,
    encoding,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

function handleE2EE(
  client: ConnectedClient,
  msg: Extract<ClientMessage, { type: "e2ee" }>
): void {
  if (!client.serverId) return;

  // Server relays E2EE key exchange messages as opaque blobs
  // It does NOT inspect or store the payload
  const payload = msg.payload;

  /** Send to a targeted user, but only if they share the same server. */
  function sendToTarget(targetUserId: string): void {
    const target = clients.get(targetUserId);
    if (target && target.serverId === client.serverId) {
      send(target.ws, { type: "e2ee", fromUserId: client.userId, payload });
    }
  }

  if (payload.kind === "public-key-announce") {
    // Broadcast to channel or targeted user
    if (payload.targetUserId) {
      sendToTarget(payload.targetUserId);
    } else if (client.channelId) {
      broadcast(getChannelClients(client.channelId), {
        type: "e2ee",
        fromUserId: client.userId,
        payload,
      }, client.userId);
    }
  } else if (payload.kind === "encrypted-channel-key") {
    sendToTarget(payload.targetUserId);
  } else if (payload.kind === "key-ratchet") {
    if (client.channelId) {
      broadcast(getChannelClients(client.channelId), {
        type: "e2ee",
        fromUserId: client.userId,
        payload,
      }, client.userId);
    }
  } else if (payload.kind === "verification-request" || payload.kind === "verification-confirm") {
    sendToTarget(payload.targetUserId);
  }
}

function handleKick(
  client: ConnectedClient,
  msg: Extract<ClientMessage, { type: "kick" }>
): void {
  if (!client.serverId) return;

  if (!clientHasPermission(client, "kick")) {
    send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to kick" });
    return;
  }

  const target = clients.get(msg.userId);
  if (!target || target.serverId !== client.serverId) return;

  send(target.ws, { type: "user-kicked", userId: msg.userId, reason: msg.reason });

  broadcast(getServerClients(client.serverId), {
    type: "user-kicked",
    userId: msg.userId,
    reason: msg.reason,
  });

  handleDisconnect(target);
  target.ws.close();
}

async function handleMoveUser(
  client: ConnectedClient,
  msg: Extract<ClientMessage, { type: "move-user" }>
): Promise<void> {
  if (!client.serverId) return;

  if (!clientHasPermission(client, "moveUsers")) {
    send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to move users" });
    return;
  }

  const target = clients.get(msg.userId);
  if (!target || target.serverId !== client.serverId) return;

  // Force the target to join the new channel — only broadcast on success
  const joined = await handleJoinChannel(target, msg.channelId);
  if (!joined) return;

  broadcast(getServerClients(client.serverId), {
    type: "user-moved",
    userId: msg.userId,
    channelId: msg.channelId,
  });
}

function handleBan(
  client: ConnectedClient,
  msg: Extract<ClientMessage, { type: "ban" }>
): void {
  if (!client.serverId) return;

  if (!clientHasPermission(client, "ban")) {
    send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to ban" });
    return;
  }

  const target = clients.get(msg.userId);
  if (!target || target.serverId !== client.serverId) return;

  createBan(client.serverId, msg.userId, client.userId, msg.reason ?? "");

  send(target.ws, { type: "user-banned", userId: msg.userId, reason: msg.reason });

  broadcast(getServerClients(client.serverId), {
    type: "user-banned",
    userId: msg.userId,
    reason: msg.reason,
  });

  handleDisconnect(target);
  target.ws.close();
}

function handleAssignRole(client: ConnectedClient, targetUserId: string, roleId: string, assign: boolean): void {
  if (!client.serverId) return;
  if (!clientHasPermission(client, "manageRoles")) {
    send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to manage roles" });
    return;
  }

  if (assign) {
    assignRole(targetUserId, client.serverId, roleId);
  } else {
    unassignRole(targetUserId, client.serverId, roleId);
  }

  const serverClients = getServerClients(client.serverId);

  // Broadcast to all connected clients in the server
  broadcast(serverClients, {
    type: "role-assigned",
    userId: targetUserId,
    roleId,
    assigned: assign,
  });

  // Send updated permissions to the target user so permission-gated UI updates immediately
  const targetClient = serverClients.find((c) => c.userId === targetUserId);
  if (targetClient) {
    let perms = computeEffectivePermissions(targetUserId, client.serverId);
    if (targetClient.isAdmin) {
      perms = { ...perms };
      for (const key of PERMISSION_KEYS) {
        perms[key] = "allow";
      }
    }
    send(targetClient.ws, { type: "permissions-updated", myPermissions: perms });
  }
}

function handleDisconnect(client: ConnectedClient): void {
  if (client.channelId) {
    const oldChannelId = client.channelId;

    // Emit producer-closed for all active producers before tearing down transports.
    const peer = getPeerTransports(client.userId);
    if (peer) {
      for (const producer of peer.producers.values()) {
        broadcast(getChannelClients(oldChannelId), {
          type: "producer-closed",
          producerId: producer.id,
          userId: client.userId,
          mediaType: (producer.appData as any)?.mediaType,
        }, client.userId);
      }
    }

    closePeerTransports(client.userId);

    broadcast(getChannelClients(oldChannelId), {
      type: "user-left-channel",
      userId: client.userId,
    });

    client.channelId = null;
  }

  if (client.serverId) {
    broadcast(getServerClients(client.serverId), {
      type: "user-updated",
      userId: client.userId,
      updates: { channelId: null },
    }, client.userId);
  }

  clients.delete(client.userId);
  console.log(`[signaling] Client ${client.userId} (${client.nickname}) disconnected`);
}
