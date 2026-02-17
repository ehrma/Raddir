import { useState, useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useServerStore } from "../stores/serverStore";
import { useVoiceStore } from "../stores/voiceStore";
import { useVideoStore } from "../stores/videoStore";
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
  const store = useServerStore;

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);

    // Read from store at call time to avoid stale closures
    const { serverUrl, nickname } = useSettingsStore.getState();

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
      store.getState().reset();
      useVideoStore.getState().clearAll();
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
        serverName: data.serverName,
        serverDescription: data.serverDescription,
        serverIconUrl: data.serverIconUrl,
        maxWebcamProducers: data.maxWebcamProducers,
        maxScreenProducers: data.maxScreenProducers,
        channels: data.channels,
        members: data.members,
        roles: data.roles,
        myPermissions: data.myPermissions,
      });
    });

    signalingClient.on("server-updated", (msg: any) => {
      const updates: Record<string, any> = {};
      if (msg.serverName !== undefined) updates.serverName = msg.serverName;
      if (msg.serverDescription !== undefined) updates.serverDescription = msg.serverDescription;
      if (msg.serverIconUrl !== undefined) updates.serverIconUrl = msg.serverIconUrl;
      if (msg.maxWebcamProducers !== undefined) updates.maxWebcamProducers = msg.maxWebcamProducers;
      if (msg.maxScreenProducers !== undefined) updates.maxScreenProducers = msg.maxScreenProducers;
      store.setState(updates);
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
      useVideoStore.getState().removeAllRemoteVideosForUser(data.userId);
      keyManager?.onMemberLeft(data.userId);
    });

    signalingClient.on("user-moved", (msg: any) => {
      store.getState().updateMember(msg.userId, { channelId: msg.channelId });
      const currentChannelId = store.getState().currentChannelId;
      if (msg.channelId !== currentChannelId) {
        useVideoStore.getState().removeAllRemoteVideosForUser(msg.userId);
      }
    });

    signalingClient.on("channel-created", (msg: any) => {
      store.setState((s) => ({ channels: [...s.channels, msg.channel] }));
    });

    signalingClient.on("channel-deleted", (msg: any) => {
      const state = store.getState();
      store.setState((s) => ({ channels: s.channels.filter((c) => c.id !== msg.channelId) }));
      // If we're in the deleted channel, leave it
      if (state.currentChannelId === msg.channelId) {
        state.setCurrentChannel(null);
      }
    });

    signalingClient.on("user-updated", (msg) => {
      const data = msg as ServerUserUpdatedMessage;
      store.getState().updateMember(data.userId, data.updates as any);
      if (Object.prototype.hasOwnProperty.call(data.updates, "channelId")) {
        const currentChannelId = store.getState().currentChannelId;
        if ((data.updates as any).channelId !== currentChannelId) {
          useVideoStore.getState().removeAllRemoteVideosForUser(data.userId);
        }
      }
    });

    signalingClient.on("e2ee", (msg) => {
      const data = msg as ServerE2EEMessage;
      keyManager?.handleKeyExchangeMessage(data.fromUserId, data.payload);
    });

    signalingClient.on("speaking", (msg: any) => {
      useVoiceStore.getState().setUserSpeaking(msg.userId, msg.speaking);
    });

    signalingClient.on("role-assigned", (msg: any) => {
      const { members } = store.getState();
      const member = members.get(msg.userId);
      if (member) {
        const currentRoleIds: string[] = (member as any).roleIds ?? [];
        const newRoleIds = msg.assigned
          ? [...new Set([...currentRoleIds, msg.roleId])]
          : currentRoleIds.filter((id: string) => id !== msg.roleId);
        const updatedMembers = new Map(members);
        updatedMembers.set(msg.userId, { ...member, roleIds: newRoleIds } as any);
        store.setState({ members: updatedMembers });
      }
    });

    signalingClient.on("permissions-updated", (msg: any) => {
      store.setState({ myPermissions: msg.myPermissions });
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
  }, []);

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
