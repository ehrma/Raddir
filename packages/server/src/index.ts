import Fastify from "fastify";
import { dirname } from "node:path";
import { loadConfig } from "./config.js";
import { initDb, closeDb } from "./db/database.js";
import { createWorkerPool, closeWorkerPool } from "./media/worker-pool.js";
import { initTransportConfig } from "./media/transport.js";
import { setupSignaling } from "./signaling/handler.js";
import { ensureDefaultServer } from "./models/server.js";
import { ensureDefaultChannels } from "./models/channel.js";
import { ensureDefaultRoles } from "./models/permission.js";
import { serverRoutes } from "./api/routes/servers.js";
import { channelRoutes } from "./api/routes/channels.js";
import { inviteRoutes } from "./api/routes/invites.js";
import { roleRoutes } from "./api/routes/roles.js";
import { getTlsConfig, scheduleRenewal, type TlsMode, type TlsOptions } from "./tls.js";
import cors from "@fastify/cors";
import { setAdminToken } from "./api/auth.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log("[raddir] Starting Raddir server...");
  console.log(`[raddir] Host: ${config.host}, Port: ${config.port}`);
  console.log(`[raddir] RTC ports: ${config.rtcMinPort}-${config.rtcMaxPort}`);
  console.log(`[raddir] DB: ${config.dbPath}`);
  console.log(`[raddir] Media workers: ${config.mediaWorkers}`);

  // Set admin token for REST API authentication
  setAdminToken(config.adminToken);

  // Initialize database
  initDb(config.dbPath);
  console.log("[raddir] Database initialized");

  // Ensure default server, channels, and roles exist
  const server = ensureDefaultServer();
  ensureDefaultChannels(server.id);
  ensureDefaultRoles(server.id);
  console.log(`[raddir] Default server: ${server.name} (${server.id})`);

  // Initialize mediasoup workers
  await createWorkerPool(config);
  initTransportConfig(config);
  console.log("[raddir] Media workers ready");

  // Get TLS certificate
  const dataDir = dirname(config.dbPath);
  const tlsOpts: TlsOptions = {
    mode: config.tlsMode as TlsMode,
    dataDir,
    domain: config.tlsDomain || undefined,
    email: config.tlsEmail || undefined,
    certPath: config.tlsCert || undefined,
    keyPath: config.tlsKey || undefined,
  };
  console.log(`[raddir] TLS mode: ${tlsOpts.mode}`);
  const tls = await getTlsConfig(tlsOpts);

  // Create Fastify instance with HTTPS
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
    },
    https: {
      cert: tls.cert,
      key: tls.key,
    },
  });

  // Enable CORS for API requests from the Electron/browser client
  await fastify.register(cors, { origin: true });

  // Schedule automatic certificate renewal for Let's Encrypt
  scheduleRenewal(tlsOpts, (newTls) => {
    // Node's tls.Server exposes setSecureContext to hot-swap certs without restart
    const srv = fastify.server as any;
    if (typeof srv.setSecureContext === "function") {
      srv.setSecureContext({ cert: newTls.cert, key: newTls.key });
      console.log("[raddir] TLS certificate renewed and applied");
    }
  });

  // Health check endpoint
  fastify.get("/health", async () => {
    return { status: "ok", version: "0.1.0" };
  });

  // Server info endpoint
  fastify.get("/info", async () => {
    return {
      name: "Raddir",
      version: "0.1.0",
      server: {
        id: server.id,
        name: server.name,
      },
    };
  });

  // Register API routes
  await fastify.register(serverRoutes);
  await fastify.register(channelRoutes);
  await fastify.register(inviteRoutes);
  await fastify.register(roleRoutes);

  // Start Fastify and get the underlying HTTP server
  await fastify.listen({ host: config.host, port: config.port });

  // Attach WebSocket signaling to the underlying HTTP server
  const httpServer = fastify.server;
  setupSignaling(httpServer, config);

  console.log(`[raddir] Server listening on https://${config.host}:${config.port}`);
  console.log(`[raddir] WebSocket signaling available at wss://${config.host}:${config.port}/ws`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[raddir] Shutting down...");
    await closeWorkerPool();
    closeDb();
    await fastify.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[raddir] Fatal error:", err);
  process.exit(1);
});
