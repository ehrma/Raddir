import type { FastifyInstance } from "fastify";
import { getServer, ensureDefaultServer, updateServer } from "../../models/server.js";
import { getChannelsByServer } from "../../models/channel.js";
import { getRolesByServer } from "../../models/permission.js";
import { requireAdmin } from "../auth.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../../config.js";
import { broadcastToServer } from "../../signaling/handler.js";

export async function serverRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { serverId: string } }>(
    "/api/servers/:serverId",
    async (request) => {
      const { serverId } = request.params;
      const server = getServer(serverId);
      if (!server) {
        return { error: "Server not found" };
      }

      const channels = getChannelsByServer(serverId);
      const roles = getRolesByServer(serverId);

      return { ...server, channels, roles };
    }
  );

  fastify.get("/api/servers", async () => {
    const server = ensureDefaultServer();
    return [server];
  });

  // Update server name / description
  fastify.patch<{
    Params: { serverId: string };
    Body: { name?: string; description?: string };
  }>("/api/servers/:serverId", { preHandler: requireAdmin }, async (req, reply) => {
    const server = getServer(req.params.serverId);
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const { name, description } = req.body;
    if (name !== undefined && !name.trim()) {
      return reply.code(400).send({ error: "Server name cannot be empty" });
    }

    updateServer(req.params.serverId, {
      name: name?.trim(),
      description: description !== undefined ? description : undefined,
    });

    const updated = getServer(req.params.serverId)!;
    broadcastToServer(req.params.serverId, {
      type: "server-updated",
      serverName: updated.name,
      serverDescription: updated.description,
    });

    return updated;
  });

  // Upload server icon (base64 JSON body: { data: "base64...", mimeType: "image/png" })
  fastify.post<{
    Params: { serverId: string };
    Body: { data: string; mimeType: string };
  }>("/api/servers/:serverId/icon", { preHandler: requireAdmin }, async (req, reply) => {
    const server = getServer(req.params.serverId);
    if (!server) return reply.code(404).send({ error: "Server not found" });

    const { data, mimeType } = req.body;
    if (!data || !mimeType) {
      return reply.code(400).send({ error: "Missing data or mimeType" });
    }

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(mimeType)) {
      return reply.code(400).send({ error: "Unsupported image type. Use PNG, JPEG, WebP, or GIF" });
    }

    const ext = mimeType.split("/")[1] === "jpeg" ? "jpg" : mimeType.split("/")[1];
    const buf = Buffer.from(data, "base64");

    // Max 2MB
    if (buf.length > 2 * 1024 * 1024) {
      return reply.code(400).send({ error: "Icon too large. Maximum 2MB" });
    }

    const config = loadConfig();
    const dataDir = dirname(config.dbPath);
    const iconsDir = join(dataDir, "icons");
    if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

    const filename = `${req.params.serverId}.${ext}`;
    const filePath = join(iconsDir, filename);

    // Remove old icon if different extension
    if (server.iconPath && existsSync(server.iconPath)) {
      try { unlinkSync(server.iconPath); } catch {}
    }

    writeFileSync(filePath, buf);
    updateServer(req.params.serverId, { iconPath: filePath });

    const iconUrl = `/api/servers/${req.params.serverId}/icon`;
    broadcastToServer(req.params.serverId, {
      type: "server-updated",
      serverIconUrl: iconUrl,
    });

    return { success: true, iconUrl };
  });

  // Serve server icon
  fastify.get<{ Params: { serverId: string } }>(
    "/api/servers/:serverId/icon",
    async (req, reply) => {
      const server = getServer(req.params.serverId);
      if (!server?.iconPath || !existsSync(server.iconPath)) {
        return reply.code(404).send({ error: "No icon" });
      }

      const ext = server.iconPath.split(".").pop();
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
      };

      const buf = readFileSync(server.iconPath);
      return reply
        .header("Content-Type", mimeMap[ext ?? ""] ?? "image/png")
        .header("Cache-Control", "public, max-age=3600")
        .send(buf);
    }
  );

  // Delete server icon
  fastify.delete<{ Params: { serverId: string } }>(
    "/api/servers/:serverId/icon",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const server = getServer(req.params.serverId);
      if (!server) return reply.code(404).send({ error: "Server not found" });

      if (server.iconPath && existsSync(server.iconPath)) {
        try { unlinkSync(server.iconPath); } catch {}
      }
      updateServer(req.params.serverId, { iconPath: null });

      broadcastToServer(req.params.serverId, {
        type: "server-updated",
        serverIconUrl: null,
      });

      return { success: true };
    }
  );
}
