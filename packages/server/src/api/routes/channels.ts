import type { FastifyInstance } from "fastify";
import { getChannelsByServer, getChannel, createChannel, deleteChannel } from "../../models/channel.js";
import type { Channel } from "@raddir/shared";

export async function channelRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { serverId: string } }>(
    "/api/servers/:serverId/channels",
    async (request) => {
      const { serverId } = request.params;
      return getChannelsByServer(serverId);
    }
  );

  fastify.get<{ Params: { channelId: string } }>(
    "/api/channels/:channelId",
    async (request) => {
      const { channelId } = request.params;
      const channel = getChannel(channelId);
      if (!channel) {
        return { error: "Channel not found" };
      }
      return channel;
    }
  );

  fastify.post<{
    Params: { serverId: string };
    Body: { name: string; parentId?: string; description?: string; position?: number; maxUsers?: number; joinPower?: number; talkPower?: number };
  }>(
    "/api/servers/:serverId/channels",
    async (request, reply) => {
      const { serverId } = request.params;
      const { name, ...opts } = request.body;

      if (!name || name.trim().length === 0) {
        reply.status(400);
        return { error: "Channel name is required" };
      }

      const channel = createChannel(serverId, name.trim(), opts);
      reply.status(201);
      return channel;
    }
  );

  fastify.delete<{ Params: { channelId: string } }>(
    "/api/channels/:channelId",
    async (request, reply) => {
      const channel = getChannel(request.params.channelId);
      if (!channel) return reply.code(404).send({ error: "Channel not found" });
      if (channel.isDefault) return reply.code(400).send({ error: "Cannot delete default channel" });

      const deleted = deleteChannel(request.params.channelId);
      if (!deleted) return reply.code(400).send({ error: "Failed to delete channel" });
      return { success: true };
    }
  );
}
