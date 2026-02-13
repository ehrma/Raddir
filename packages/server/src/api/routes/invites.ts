import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { getDb } from "../../db/database.js";
import { requireAdmin } from "../auth.js";
import { RateLimiter } from "../../lib/rate-limiter.js";
import { hashCredential } from "../../lib/credential-hash.js";

// 20 requests per 60 seconds per IP for public invite endpoints
const inviteLimiter = new RateLimiter(20, 60_000);
inviteLimiter.startCleanup();

/**
 * Encode an invite blob: base64url-encoded JSON with server address and token.
 * The address is a routing hint so the client knows where to connect.
 * The server never trusts the blob's address for authorization — it validates
 * the token against its own DB and returns the canonical address from there.
 */
function encodeInviteBlob(serverAddress: string, token: string): string {
  const blob = JSON.stringify({ v: 2, a: serverAddress, t: token });
  return Buffer.from(blob, "utf-8").toString("base64url");
}

/**
 * Decode an invite blob back to { address, token }.
 * The address is only used by the client for connectivity — never for auth.
 */
function decodeInviteBlob(encoded: string): { address: string; token: string } | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8");
    const parsed = JSON.parse(json);
    // Accept v1 and v2 blobs (same shape, just version bump)
    if ((parsed.v !== 1 && parsed.v !== 2) || !parsed.a || !parsed.t) return null;
    return { address: parsed.a, token: parsed.t };
  } catch {
    return null;
  }
}

export async function inviteRoutes(fastify: FastifyInstance): Promise<void> {
  // Create an invite token (admin only)
  fastify.post<{
    Params: { serverId: string };
    Body: { maxUses?: number; expiresInHours?: number; serverAddress: string };
  }>(
    "/api/servers/:serverId/invites",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { serverId } = request.params;
      const { maxUses, expiresInHours, serverAddress } = request.body;

      if (!serverAddress) {
        reply.status(400);
        return { error: "serverAddress is required" };
      }

      // createdBy is set server-side — no user identity available at REST API level
      const createdBy = null;

      const id = nanoid();
      const token = nanoid(12);
      const expiresAt = expiresInHours
        ? Math.floor(Date.now() / 1000) + expiresInHours * 3600
        : null;

      const db = getDb();
      db.prepare(`
        INSERT INTO invite_tokens (id, server_id, token, created_by, max_uses, expires_at, server_address)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, serverId, token, createdBy, maxUses ?? null, expiresAt, serverAddress);

      const inviteBlob = encodeInviteBlob(serverAddress, token);

      reply.status(201);
      return { id, token, serverId, maxUses: maxUses ?? null, expiresAt, inviteBlob };
    }
  );

  // Validate an invite token (public, no auth required)
  fastify.get<{ Params: { token: string } }>(
    "/api/invites/:token",
    async (request, reply) => {
      const ip = request.ip;
      if (!inviteLimiter.check(ip)) {
        reply.status(429);
        return { error: "Too many requests. Try again later." };
      }
      const { token } = request.params;
      const db = getDb();
      const row = db.prepare("SELECT * FROM invite_tokens WHERE token = ?").get(token) as any;

      if (!row) {
        reply.status(404);
        return { error: "Invite not found" };
      }

      const now = Math.floor(Date.now() / 1000);
      if (row.expires_at && row.expires_at < now) {
        reply.status(410);
        return { error: "Invite expired" };
      }

      if (row.max_uses && row.uses >= row.max_uses) {
        reply.status(410);
        return { error: "Invite has reached max uses" };
      }

      return {
        id: row.id,
        serverId: row.server_id,
        token: row.token,
        maxUses: row.max_uses,
        uses: row.uses,
        expiresAt: row.expires_at,
        valid: true,
      };
    }
  );

  // Redeem an invite token — creates an unbound session credential (no publicKey yet)
  fastify.post<{
    Body: { inviteBlob: string };
  }>(
    "/api/invites/redeem",
    async (request, reply) => {
      const ip = request.ip;
      if (!inviteLimiter.check(ip)) {
        reply.status(429);
        return { error: "Too many requests. Try again later." };
      }
      const { inviteBlob } = request.body;

      if (!inviteBlob) {
        reply.status(400);
        return { error: "inviteBlob is required" };
      }

      const decoded = decodeInviteBlob(inviteBlob);
      if (!decoded) {
        reply.status(400);
        return { error: "Invalid invite blob" };
      }

      const db = getDb();
      const row = db.prepare("SELECT * FROM invite_tokens WHERE token = ?").get(decoded.token) as any;

      if (!row) {
        reply.status(404);
        return { error: "Invite not found" };
      }

      const now = Math.floor(Date.now() / 1000);
      if (row.expires_at && row.expires_at < now) {
        reply.status(410);
        return { error: "Invite expired" };
      }

      // Atomic increment: only succeeds if uses < max_uses (or no limit)
      const result = db.prepare(`
        UPDATE invite_tokens SET uses = uses + 1
        WHERE id = ?
          AND (max_uses IS NULL OR uses < max_uses)
          AND (expires_at IS NULL OR expires_at >= ?)
      `).run(row.id, now);

      if (result.changes === 0) {
        reply.status(410);
        return { error: "Invite has reached max uses or expired" };
      }

      // Create an unbound credential — publicKey will be bound on first WS auth
      // Store only the SHA-256 hash; plaintext is returned to the client but never persisted
      const credentialId = nanoid();
      const credential = nanoid(32);
      const credHash = hashCredential(credential);

      db.prepare(`
        INSERT INTO session_credentials (id, server_id, credential_hash, invite_token_id)
        VALUES (?, ?, ?, ?)
      `).run(credentialId, row.server_id, credHash, row.id);

      return {
        credential,
        serverAddress: row.server_address || "",
        serverId: row.server_id,
      };
    }
  );

  // Decode an invite blob (public utility endpoint, no auth)
  fastify.post<{ Body: { inviteBlob: string } }>(
    "/api/invites/decode",
    async (request, reply) => {
      const ip = request.ip;
      if (!inviteLimiter.check(ip)) {
        reply.status(429);
        return { error: "Too many requests. Try again later." };
      }
      const { inviteBlob } = request.body;
      if (!inviteBlob) {
        reply.status(400);
        return { error: "inviteBlob is required" };
      }

      const decoded = decodeInviteBlob(inviteBlob);
      if (!decoded) {
        reply.status(400);
        return { error: "Invalid invite blob" };
      }

      // Return canonical address from DB if available, otherwise fall back to blob hint
      const db = getDb();
      const row = db.prepare("SELECT server_address FROM invite_tokens WHERE token = ?").get(decoded.token) as any;

      return { address: row?.server_address || decoded.address, token: decoded.token };
    }
  );
}
