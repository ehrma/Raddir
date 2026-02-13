import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { getDb } from "../../db/database.js";
import { requireAdmin } from "../auth.js";

/**
 * Encode an invite blob: base64url-encoded JSON containing only the token.
 * Server address is stored server-side and returned on redeem — never trust the blob for routing.
 */
function encodeInviteBlob(token: string): string {
  const blob = JSON.stringify({ v: 2, t: token });
  return Buffer.from(blob, "utf-8").toString("base64url");
}

/**
 * Decode an invite blob back to { token }.
 * Supports v1 (legacy: had address) and v2 (current: token only).
 */
function decodeInviteBlob(encoded: string): { token: string } | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8");
    const parsed = JSON.parse(json);
    if (!parsed.t) return null;
    return { token: parsed.t };
  } catch {
    return null;
  }
}

export async function inviteRoutes(fastify: FastifyInstance): Promise<void> {
  // Create an invite token (admin only)
  fastify.post<{
    Params: { serverId: string };
    Body: { maxUses?: number; expiresInHours?: number; createdBy: string; serverAddress: string };
  }>(
    "/api/servers/:serverId/invites",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { serverId } = request.params;
      const { maxUses, expiresInHours, createdBy, serverAddress } = request.body;

      if (!serverAddress) {
        reply.status(400);
        return { error: "serverAddress is required" };
      }

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

      const inviteBlob = encodeInviteBlob(token);

      reply.status(201);
      return { id, token, serverId, maxUses: maxUses ?? null, expiresAt, inviteBlob };
    }
  );

  // Validate an invite token (public, no auth required)
  fastify.get<{ Params: { token: string } }>(
    "/api/invites/:token",
    async (request, reply) => {
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

  // Redeem an invite token — creates a permanent session credential
  fastify.post<{
    Body: { inviteBlob: string; publicKey: string };
  }>(
    "/api/invites/redeem",
    async (request, reply) => {
      const { inviteBlob, publicKey } = request.body;

      if (!inviteBlob || !publicKey) {
        reply.status(400);
        return { error: "inviteBlob and publicKey are required" };
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

      // Check if this public key already has a credential for this server
      const existing = db.prepare(
        "SELECT credential FROM session_credentials WHERE user_public_key = ? AND server_id = ? AND revoked_at IS NULL"
      ).get(publicKey, row.server_id) as any;

      if (existing) {
        return {
          credential: existing.credential,
          serverAddress: row.server_address || "",
          serverId: row.server_id,
        };
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

      // Create a permanent session credential
      const credentialId = nanoid();
      const credential = nanoid(32);

      db.prepare(`
        INSERT INTO session_credentials (id, server_id, user_public_key, credential, invite_token_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(credentialId, row.server_id, publicKey, credential, row.id);

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

      // Look up server address from DB — never trust the blob for routing
      const db = getDb();
      const row = db.prepare("SELECT server_address FROM invite_tokens WHERE token = ?").get(decoded.token) as any;

      return { address: row?.server_address || "", token: decoded.token };
    }
  );
}
