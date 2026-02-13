import { useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useServerStore } from "../stores/serverStore";
import { useVoiceStore } from "../stores/voiceStore";
import { SignalingClient } from "../lib/signaling-client";
import { KeyManager } from "../lib/e2ee/key-manager";
import { normalizeServerUrl } from "../lib/normalize-url";
import { getOrCreateIdentity } from "../lib/e2ee/identity";
import type {
  ServerAuthResultMessage,
  ServerJoinedServerMessage,
  ServerUserJoinedChannelMessage,
  ServerUserLeftChannelMessage,
  ServerUserUpdatedMessage,
  ServerErrorMessage,
  ServerE2EEMessage,
} from "@raddir/shared";

let signalingClient: SignalingClient | null = null;
let keyManager: KeyManager | null = null;

export function getSignalingClient(): SignalingClient | null {
  return signalingClient;
}

export function getKeyManager(): KeyManager | null {
  return keyManager;
}

export function useConnection() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kickReason, setKickReason] = useState<string | null>(null);
  const [banReason, setBanReason] = useState<string | null>(null);
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const nickname = useSettingsStore((s) => s.nickname);
  const store = useServerStore;

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);

    if (signalingClient) {
      signalingClient.disconnect();
    }

    // Generate or load persistent Ed25519 identity
    let publicKeyHex: string | undefined;
    try {
      const identity = await getOrCreateIdentity();
      publicKeyHex = identity.publicKeyHex;
    } catch (err) {
      console.warn("[connection] Ed25519 not supported, connecting without identity");
    }

    const wsUrl = normalizeServerUrl(serverUrl);

    // Register the server host as trusted for self-signed TLS certificates
    try {
      const serverHost = new URL(wsUrl.replace(/^ws/, "http")).host;
      (window as any).raddir?.trustServerHost(serverHost);
    } catch {}

    signalingClient = new SignalingClient(wsUrl);
    keyManager = new KeyManager(signalingClient);
    await keyManager.initialize();

    signalingClient.onConnect(() => {
      store.getState().setConnected(true);
      // Find password for the current server
      const { savedServers, serverUrl: currentUrl } = useSettingsStore.getState();
      const matchedServer = savedServers.find((s) => s.address === currentUrl);
      signalingClient!.send({
        type: "auth",
        token: "",
        nickname,
        publicKey: publicKeyHex,
        password: matchedServer?.password || undefined,
        adminToken: matchedServer?.adminToken || undefined,
        credential: matchedServer?.credential || undefined,
      });
    });

    signalingClient.onDisconnect(() => {
      store.getState().setConnected(false);
      store.getState().setAuthenticated(false);
      keyManager?.reset();
      setConnecting(false);
    });

    signalingClient.on("auth-result", (msg) => {
      const result = msg as ServerAuthResultMessage;
      if (result.success && result.userId) {
        store.getState().setAuthenticated(true, result.userId);
      } else {
        setError(result.error ?? "Authentication failed");
      }
      setConnecting(false);
    });

    signalingClient.on("joined-server", (msg) => {
      const data = msg as ServerJoinedServerMessage;
      store.getState().setServerData({
        serverId: data.serverId,
        channels: data.channels,
        members: data.members,
        roles: data.roles,
        myPermissions: data.myPermissions,
      });
    });

    signalingClient.on("joined-channel", (msg: any) => {
      // Set current channel from server response
      store.getState().setCurrentChannel(msg.channelId);
      // Update all users in the channel we just joined
      if (msg.users) {
        for (const user of msg.users) {
          store.getState().addMember({ ...user, channelId: msg.channelId });
        }
      }
    });

    signalingClient.on("user-joined-channel", (msg) => {
      const data = msg as ServerUserJoinedChannelMessage;
      store.getState().addMember(data.user);
    });

    signalingClient.on("user-left-channel", (msg) => {
      const data = msg as ServerUserLeftChannelMessage;
      store.getState().updateMember(data.userId, { channelId: null });
      keyManager?.onMemberLeft(data.userId);
    });

    signalingClient.on("user-updated", (msg) => {
      const data = msg as ServerUserUpdatedMessage;
      store.getState().updateMember(data.userId, data.updates as any);
    });

    signalingClient.on("e2ee", (msg) => {
      const data = msg as ServerE2EEMessage;
      keyManager?.handleKeyExchangeMessage(data.fromUserId, data.payload);
    });

    signalingClient.on("speaking", (msg: any) => {
      useVoiceStore.getState().setUserSpeaking(msg.userId, msg.speaking);
    });

    signalingClient.on("role-assigned", (msg: any) => {
      // Update the member's roleIds in the store (best-effort since SessionInfo doesn't have roleIds)
      console.log(`[connection] Role ${msg.assigned ? "assigned" : "unassigned"}: ${msg.roleId} for ${msg.userId}`);
    });

    signalingClient.on("user-kicked", (msg: any) => {
      if (msg.userId === store.getState().userId) {
        setKickReason(msg.reason ?? "You were kicked from the server");
        doDisconnect();
      }
    });

    signalingClient.on("user-banned", (msg: any) => {
      if (msg.userId === store.getState().userId) {
        setBanReason(msg.reason ?? "You were banned from the server");
        doDisconnect();
      }
    });

    signalingClient.on("error", (msg) => {
      const err = msg as ServerErrorMessage;
      console.error("[connection] Server error:", err.code, err.message);
      setError(err.message);
    });

    signalingClient.connect();
  }, [serverUrl, nickname]);

  const doDisconnect = useCallback(() => {
    signalingClient?.disconnect();
    signalingClient = null;
    keyManager?.reset();
    keyManager = null;
    store.getState().reset();
  }, []);

  const disconnect = useCallback(() => {
    setKickReason(null);
    setBanReason(null);
    doDisconnect();
  }, [doDisconnect]);

  return { connect, disconnect, connecting, error, kickReason, banReason, setKickReason, setBanReason };
}
