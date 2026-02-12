/**
 * Normalize a user-friendly server address into a full WebSocket URL.
 *
 * Examples:
 *   "localhost"           → "ws://localhost:4000/ws"
 *   "localhost:4000"      → "ws://localhost:4000/ws"
 *   "192.168.1.5:4000"   → "ws://192.168.1.5:4000/ws"
 *   "example.com"         → "wss://example.com:4000/ws"
 *   "wss://example.com"   → "wss://example.com/ws"
 *   "ws://localhost:4000/ws" → "ws://localhost:4000/ws" (unchanged)
 */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";

  // Already a full ws:// or wss:// URL
  if (url.startsWith("ws://") || url.startsWith("wss://")) {
    if (!url.endsWith("/ws")) {
      url = url.replace(/\/+$/, "") + "/ws";
    }
    return url;
  }

  // Strip http(s):// if someone pastes that
  url = url.replace(/^https?:\/\//, "");

  // Use ws:// for local addresses, wss:// for everything else (server has built-in TLS)
  const isLocal =
    url.startsWith("localhost") ||
    url.startsWith("127.") ||
    url.startsWith("192.168.") ||
    url.startsWith("10.") ||
    url.startsWith("172.");
  const scheme = isLocal ? "ws://" : "wss://";

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
