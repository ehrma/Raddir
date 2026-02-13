import type { FastifyInstance } from "fastify";
import {
  getRolesByServer,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getChannelOverrides,
  setChannelOverride,
  deleteChannelOverride,
} from "../../models/permission.js";
import { computeEffectivePermissions } from "../../permissions/engine.js";
import type { PermissionSet } from "@raddir/shared";
import { requireAdmin } from "../auth.js";

export async function roleRoutes(fastify: FastifyInstance): Promise<void> {
  // List roles for a server
  fastify.get<{ Params: { serverId: string } }>("/api/servers/:serverId/roles", async (req) => {
    return getRolesByServer(req.params.serverId);
  });

  // Create a role
  fastify.post<{
    Params: { serverId: string };
    Body: { name: string; permissions: PermissionSet; priority?: number; color?: string | null };
  }>("/api/servers/:serverId/roles", { preHandler: requireAdmin }, async (req) => {
    const { name, permissions, priority, color } = req.body;
    return createRole(req.params.serverId, name, permissions, { priority, color });
  });

  // Update a role
  fastify.patch<{
    Params: { roleId: string };
    Body: { name?: string; permissions?: PermissionSet; priority?: number; color?: string | null };
  }>("/api/roles/:roleId", { preHandler: requireAdmin }, async (req, reply) => {
    const role = getRole(req.params.roleId);
    if (!role) return reply.code(404).send({ error: "Role not found" });

    updateRole(req.params.roleId, req.body);
    return getRole(req.params.roleId);
  });

  // Delete a role
  fastify.delete<{ Params: { roleId: string } }>("/api/roles/:roleId", { preHandler: requireAdmin }, async (req, reply) => {
    const role = getRole(req.params.roleId);
    if (!role) return reply.code(404).send({ error: "Role not found" });
    if (role.isDefault) return reply.code(400).send({ error: "Cannot delete default role" });

    deleteRole(req.params.roleId);
    return { success: true };
  });

  // Get channel permission overrides
  fastify.get<{ Params: { channelId: string } }>("/api/channels/:channelId/overrides", async (req) => {
    return getChannelOverrides(req.params.channelId);
  });

  // Set channel permission override
  fastify.put<{
    Params: { channelId: string; roleId: string };
    Body: { permissions: Partial<PermissionSet> };
  }>("/api/channels/:channelId/overrides/:roleId", { preHandler: requireAdmin }, async (req) => {
    setChannelOverride(req.params.channelId, req.params.roleId, req.body.permissions);
    return { success: true };
  });

  // Delete channel permission override
  fastify.delete<{
    Params: { channelId: string; roleId: string };
  }>("/api/channels/:channelId/overrides/:roleId", { preHandler: requireAdmin }, async (req) => {
    deleteChannelOverride(req.params.channelId, req.params.roleId);
    return { success: true };
  });

  // Get effective permissions for a user in a channel
  fastify.get<{
    Params: { serverId: string; userId: string };
    Querystring: { channelId?: string };
  }>("/api/servers/:serverId/users/:userId/permissions", async (req) => {
    const perms = computeEffectivePermissions(
      req.params.userId,
      req.params.serverId,
      req.query.channelId
    );
    return perms;
  });
}
