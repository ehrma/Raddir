import type { FastifyRequest, FastifyReply } from "fastify";

let adminToken = "";

export function setAdminToken(token: string): void {
  adminToken = token;
}

/**
 * Fastify preHandler that requires a valid admin token in the Authorization header.
 * If no admin token is configured on the server, all requests are allowed (open server).
 * Usage: { preHandler: requireAdmin }
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!adminToken) {
    // No admin token configured — allow all requests (open server)
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
