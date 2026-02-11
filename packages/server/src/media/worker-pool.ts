import * as mediasoup from "mediasoup";
import type { Worker, WorkerSettings } from "mediasoup/types";
import type { RaddirConfig } from "../config.js";

let workers: Worker[] = [];
let nextWorkerIdx = 0;

export async function createWorkerPool(config: RaddirConfig): Promise<void> {
  const numWorkers = config.mediaWorkers;
  console.log(`[media] Creating ${numWorkers} mediasoup workers...`);

  const workerSettings: WorkerSettings = {
    rtcMinPort: config.rtcMinPort,
    rtcMaxPort: config.rtcMaxPort,
    logLevel: "warn",
    logTags: ["rtp", "srtp", "rtcp"],
  };

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker(workerSettings);

    worker.on("died", (error) => {
      console.error(`[media] Worker ${worker.pid} died:`, error);
      workers = workers.filter((w) => w.pid !== worker.pid);
    });

    workers.push(worker);
    console.log(`[media] Worker ${worker.pid} created`);
  }
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
