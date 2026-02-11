import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { getDb } from "../../db/database.js";

export async function inviteRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{
    Params: { serverId: string };
    Body: { maxUses?: number; expiresInHours?: number; createdBy: string };
  }>(
    "/api/servers/:serverId/invites",
    async (request, reply) => {
      const { serverId } = request.params;
      const { maxUses, expiresInHours, createdBy } = request.body;

      const id = nanoid();
      const token = nanoid(12);
      const expiresAt = expiresInHours
        ? Math.floor(Date.now() / 1000) + expiresInHours * 3600
        : null;

      const db = getDb();
      db.prepare(`
        INSERT INTO invite_tokens (id, server_id, token, created_by, max_uses, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, serverId, token, createdBy, maxUses ?? null, expiresAt);

      reply.status(201);
      return { id, token, serverId, maxUses: maxUses ?? null, expiresAt };
    }
  );

  fastify.get<{ Params: { token: string } }>(
    "/api/invites/:token",
    async (request) => {
      const { token } = request.params;
      const db = getDb();
      const row = db.prepare("SELECT * FROM invite_tokens WHERE token = ?").get(token) as any;

      if (!row) {
        return { error: "Invite not found" };
      }

      const now = Math.floor(Date.now() / 1000);
      if (row.expires_at && row.expires_at < now) {
        return { error: "Invite expired" };
      }

      if (row.max_uses && row.uses >= row.max_uses) {
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
}
