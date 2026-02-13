/**
 * Normalize a user-friendly server address into a full WebSocket URL.
 *
 * Examples:
 *   "localhost"           → "wss://localhost:4000/ws"
 *   "localhost:4000"      → "wss://localhost:4000/ws"
 *   "192.168.1.5:4000"   → "wss://192.168.1.5:4000/ws"
 *   "example.com"         → "wss://example.com:4000/ws"
 *   "wss://example.com"   → "wss://example.com/ws"
 *   "ws://localhost:4000/ws" → "wss://localhost:4000/ws" (upgraded)
 */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";

  // Already a full ws:// or wss:// URL — always upgrade to wss:// (server uses TLS)
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    url = url.replace(/^ws:\/\//, "wss://");
    if (!url.endsWith("/ws")) {
      url = url.replace(/\/+$/, "") + "/ws";
    }
    return url;
  }

  // Strip http(s):// if someone pastes that
  url = url.replace(/^https?:\/\//, "");

  // Always use wss:// — the Raddir server always uses TLS (even self-signed for local)
  const scheme = "wss://";

  // Add default port if none specified
  const hostPart = url.split("/")[0]!;
  if (!hostPart.includes(":")) {
    url = hostPart + ":4000";
  }

  // Add /ws path
  if (!url.endsWith("/ws")) {
    url = url.replace(/\/+$/, "") + "/ws";
  }

  return scheme + url;
}

/**
 * Format a full WebSocket URL back to a user-friendly display string.
 * "ws://localhost:4000/ws" → "localhost:4000"
 */
export function displayServerUrl(wsUrl: string): string {
  return wsUrl
    .replace(/^wss?:\/\//, "")
    .replace(/\/ws\/?$/, "");
}
