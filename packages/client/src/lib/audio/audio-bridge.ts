import type { MediaClient } from "../media-client";

let activeMediaClient: MediaClient | null = null;

export function setActiveMediaClient(client: MediaClient | null): void {
  activeMediaClient = client;
}

export function getActiveMediaClient(): MediaClient | null {
  return activeMediaClient;
}
