import * as mediasoup from "mediasoup";
import type { Worker, WorkerSettings } from "mediasoup/types";
import type { RaddirConfig } from "../config.js";

let workers: Worker[] = [];
let nextWorkerIdx = 0;
let savedWorkerSettings: WorkerSettings | null = null;

const MAX_RESPAWN_ATTEMPTS = 5;
const BASE_RESPAWN_DELAY_MS = 1000;

export async function createWorkerPool(config: RaddirConfig): Promise<void> {
  const numWorkers = config.mediaWorkers;
  console.log(`[media] Creating ${numWorkers} mediasoup workers...`);

  savedWorkerSettings = {
    rtcMinPort: config.rtcMinPort,
    rtcMaxPort: config.rtcMaxPort,
    logLevel: "warn",
    logTags: ["rtp", "srtp", "rtcp"],
  };

  for (let i = 0; i < numWorkers; i++) {
    const worker = await spawnWorker(savedWorkerSettings);
    console.log(`[media] Worker ${worker.pid} created`);
  }
}

async function spawnWorker(settings: WorkerSettings, attempt = 0): Promise<Worker> {
  const worker = await mediasoup.createWorker(settings);
  workers.push(worker);

  worker.on("died", (error) => {
    console.error(`[media] Worker ${worker.pid} died:`, error);
    workers = workers.filter((w) => w.pid !== worker.pid);
    respawnWorker(attempt);
  });

  return worker;
}

function respawnWorker(previousAttempt: number): void {
  if (!savedWorkerSettings) return;
  const attempt = previousAttempt + 1;

  if (attempt > MAX_RESPAWN_ATTEMPTS) {
    console.error(`[media] Worker respawn failed after ${MAX_RESPAWN_ATTEMPTS} attempts, giving up. Active workers: ${workers.length}`);
    return;
  }

  const delay = BASE_RESPAWN_DELAY_MS * Math.pow(2, attempt - 1);
  console.log(`[media] Respawning worker in ${delay}ms (attempt ${attempt}/${MAX_RESPAWN_ATTEMPTS})...`);

  setTimeout(async () => {
    try {
      const worker = await spawnWorker(savedWorkerSettings!, 0); // reset attempt counter on success
      console.log(`[media] Replacement worker ${worker.pid} created. Active workers: ${workers.length}`);
    } catch (err) {
      console.error(`[media] Failed to respawn worker (attempt ${attempt}):`, err);
      respawnWorker(attempt);
    }
  }, delay);
}

export function getNextWorker(): Worker {
  if (workers.length === 0) {
    throw new Error("No mediasoup workers available");
  }
  const worker = workers[nextWorkerIdx % workers.length]!;
  nextWorkerIdx++;
  return worker;
}

export async function closeWorkerPool(): Promise<void> {
  for (const worker of workers) {
    worker.close();
  }
  workers = [];
  nextWorkerIdx = 0;
}

export function getWorkerCount(): number {
  return workers.length;
}
