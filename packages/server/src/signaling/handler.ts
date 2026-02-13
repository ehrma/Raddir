import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { RateLimiter } from "../lib/rate-limiter.js";
import type {
  ClientMessage,
  ServerMessage,
  SessionInfo,
  RoleInfo,
} from "@raddir/shared";
import type { RtpCapabilities } from "mediasoup/types";
import { nanoid } from "nanoid";
import type { RaddirConfig } from "../config.js";
import { ensureDefaultServer } from "../models/server.js";
import { getChannelsByServer, getChannel, ensureDefaultChannels } from "../models/channel.js";
import { createUser, getUserByPublicKey, addServerMember, assignRole, unassignRole, getUserRoleIds } from "../models/user.js";
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

function getServerClients(serverId: string): ConnectedClient[] {
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

export function setupSignaling(httpServer: HttpServer, config: RaddirConfig): void {
  serverConfig = config;
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    maxPayload: 64 * 1024, // 64 KB max message size
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    let client: ConnectedClient | null = null;
    const remoteIp = (serverConfig.trustProxy
        ? req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim()
        : undefined)
      || req.socket.remoteAddress
      || "unknown";

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

    // Option 2: Session credential (from invite redemption)
    if (!authenticated && msg.credential) {
      const db = getDb();
      const cred = db.prepare(
        "SELECT id, user_public_key, bound_at FROM session_credentials WHERE credential = ? AND server_id = ? AND revoked_at IS NULL"
      ).get(msg.credential, server.id) as any;

      if (cred) {
        if (!cred.user_public_key) {
          // Unbound credential — bind it to this publicKey now (bootstrap identity)
          if (msg.publicKey) {
            const now = Math.floor(Date.now() / 1000);
            db.prepare(
              "UPDATE session_credentials SET user_public_key = ?, bound_at = ? WHERE id = ?"
            ).run(msg.publicKey, now, cred.id);
          }
          authenticated = true;
        } else if (cred.user_public_key === msg.publicKey) {
          // Already bound — publicKey matches
          authenticated = true;
        }
        // If bound to a different publicKey, authentication fails (credential stolen)
      }
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
  }));

  const roleInfos: RoleInfo[] = roles.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    permissions: r.permissions,
    isDefault: r.isDefault,
  }));

  const myPermissions = computeEffectivePermissions(user.id, server.id);

  send(ws, {
    type: "joined-server",
    serverId: server.id,
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

    case "consume":
      await handleConsume(client, msg.producerId);
      break;

    case "resume-consumer":
      await handleResumeConsumer(client, msg.consumerId);
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

  if (!clientHasPermission(client, "speak", client.channelId)) {
    send(client.ws, { type: "error", code: "NO_PERMISSION", message: "No permission to speak" });
    return;
  }

  const producer = await createProducer(
    client.userId,
    msg.transportId,
    msg.kind,
    msg.rtpParameters as any
  );

  send(client.ws, { type: "produced", producerId: producer.id });

  // Notify others in channel about new producer
  broadcast(getChannelClients(client.channelId), {
    type: "new-producer",
    userId: client.userId,
    producerId: producer.id,
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
    kind: "audio",
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

function handleChat(
  client: ConnectedClient,
  msg: Extract<ClientMessage, { type: "chat" }>
): void {
  if (!client.channelId || !client.serverId) return;

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

  // Broadcast to all connected clients in the server
  broadcast(getServerClients(client.serverId), {
    type: "role-assigned",
    userId: targetUserId,
    roleId,
    assigned: assign,
  });
}

function handleDisconnect(client: ConnectedClient): void {
  if (client.channelId) {
    closePeerTransports(client.userId);

    broadcast(getChannelClients(client.channelId), {
      type: "user-left-channel",
      userId: client.userId,
    });
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
