import type { FastifyInstance } from "fastify";
import { getServer, ensureDefaultServer } from "../../models/server.js";
import { getChannelsByServer } from "../../models/channel.js";
import { getRolesByServer } from "../../models/permission.js";

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
}
