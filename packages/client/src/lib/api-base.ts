import { useSettingsStore } from "../stores/settingsStore";

/** Derive the HTTPS base URL from the stored server address. */
export function getApiBase(): string {
  let url = useSettingsStore.getState().serverUrl.trim();

  // Strip any existing protocol
  url = url.replace(/^(wss?|https?):\/\//, "");
  // Strip trailing /ws path
  url = url.replace(/\/ws\/?$/, "");

  // Add default port if missing
  const hostPart = url.split("/")[0]!;
  if (!hostPart.includes(":")) {
    url = hostPart + ":4000";
  }

  // Server always uses TLS
  return "https://" + url;
}
