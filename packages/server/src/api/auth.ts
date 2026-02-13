import type { FastifyRequest, FastifyReply } from "fastify";

let adminToken = "";
let openAdmin = false;

export function setAdminToken(token: string): void {
  adminToken = token;
}

export function setOpenAdmin(open: boolean): void {
  openAdmin = open;
}

/**
 * Fastify preHandler that requires a valid admin token in the Authorization header.
 * If no admin token is configured:
 *   - If RADDIR_OPEN_ADMIN=true, all requests are allowed (explicit opt-in).
 *   - Otherwise, all admin requests are blocked.
 * Usage: { preHandler: requireAdmin }
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!adminToken) {
    if (openAdmin) return;
    reply.code(403).send({ error: "Admin token not configured. Set RADDIR_ADMIN_TOKEN or enable RADDIR_OPEN_ADMIN=true" });
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Authorization required" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== adminToken) {
    reply.code(403).send({ error: "Invalid admin token" });
    return;
  }
}
