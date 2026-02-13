import type { FastifyInstance } from "fastify";
import { getUser, updateUserAvatar, getUserAvatarPath } from "../../models/user.js";
import { requireAdmin } from "../auth.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "../../config.js";
import { broadcastToServer } from "../../signaling/handler.js";

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // Upload user avatar (base64 JSON body: { data: "base64...", mimeType: "image/png" })
  // Any authenticated user can upload their own avatar; admin can upload for anyone
  fastify.post<{
    Params: { userId: string };
    Body: { data: string; mimeType: string };
  }>("/api/users/:userId/avatar", async (req, reply) => {
    const user = getUser(req.params.userId);
    if (!user) return reply.code(404).send({ error: "User not found" });

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
      return reply.code(400).send({ error: "Avatar too large. Maximum 2MB" });
    }

    const config = loadConfig();
    const dataDir = dirname(config.dbPath);
    const avatarsDir = join(dataDir, "avatars");
    if (!existsSync(avatarsDir)) mkdirSync(avatarsDir, { recursive: true });

    const filename = `${req.params.userId}.${ext}`;
    const filePath = join(avatarsDir, filename);

    // Remove old avatar if different extension
    const oldPath = getUserAvatarPath(req.params.userId);
    if (oldPath && existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch {}
    }

    writeFileSync(filePath, buf);
    updateUserAvatar(req.params.userId, filePath);

    return { success: true, avatarUrl: `/api/users/${req.params.userId}/avatar` };
  });

  // Serve user avatar
  fastify.get<{ Params: { userId: string } }>(
    "/api/users/:userId/avatar",
    async (req, reply) => {
      const avatarPath = getUserAvatarPath(req.params.userId);
      if (!avatarPath || !existsSync(avatarPath)) {
        return reply.code(404).send({ error: "No avatar" });
      }

      const ext = avatarPath.split(".").pop();
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
      };

      const buf = readFileSync(avatarPath);
      return reply
        .header("Content-Type", mimeMap[ext ?? ""] ?? "image/png")
        .header("Cache-Control", "public, max-age=3600")
        .send(buf);
    }
  );

  // Delete user avatar
  fastify.delete<{ Params: { userId: string } }>(
    "/api/users/:userId/avatar",
    async (req, reply) => {
      const avatarPath = getUserAvatarPath(req.params.userId);
      if (avatarPath && existsSync(avatarPath)) {
        try { unlinkSync(avatarPath); } catch {}
      }
      updateUserAvatar(req.params.userId, null);

      return { success: true };
    }
  );
}
