import type { Channel, Session, PermissionSet } from "./models.js";
import type { E2EEKeyExchangeMessage } from "./crypto-types.js";

// ─── Client → Server Messages ───────────────────────────────────────────────

export interface ClientAuthMessage {
  type: "auth";
  token: string;
  nickname: string;
  publicKey?: string;
  password?: string;
  adminToken?: string;
  credential?: string;
}

export interface ClientJoinServerMessage {
  type: "join-server";
  serverId: string;
  inviteToken?: string;
}

export interface ClientJoinChannelMessage {
  type: "join-channel";
  channelId: string;
}

export interface ClientLeaveChannelMessage {
  type: "leave-channel";
}

export interface ClientMuteMessage {
  type: "mute";
  muted: boolean;
}

export interface ClientDeafenMessage {
  type: "deafen";
  deafened: boolean;
}

export interface ClientRtpCapabilitiesMessage {
  type: "rtp-capabilities";
  rtpCapabilities: object;
}

export interface ClientCreateTransportMessage {
  type: "create-transport";
  direction: "send" | "recv";
}

export interface ClientConnectTransportMessage {
  type: "connect-transport";
  transportId: string;
  dtlsParameters: object;
}

export interface ClientProduceMessage {
  type: "produce";
  transportId: string;
  kind: "audio" | "video";
  rtpParameters: object;
  mediaType?: "mic" | "webcam" | "screen";
}

export interface ClientStopProducerMessage {
  type: "stop-producer";
  producerId: string;
}

export interface ClientConsumeMessage {
  type: "consume";
  producerId: string;
}

export interface ClientResumeConsumerMessage {
  type: "resume-consumer";
  consumerId: string;
}

export interface ClientChatMessage {
  type: "chat";
  channelId: string;
  ciphertext: string;
  iv: string;
  keyEpoch: number;
}

export interface ClientE2EEMessage {
  type: "e2ee";
  payload: E2EEKeyExchangeMessage;
}

export interface ClientKickMessage {
  type: "kick";
  userId: string;
  reason?: string;
}

export interface ClientMoveUserMessage {
  type: "move-user";
  userId: string;
  channelId: string;
}

export interface ClientBanMessage {
  type: "ban";
  userId: string;
  reason?: string;
}

export interface ClientSpeakingMessage {
  type: "speaking";
  speaking: boolean;
}

export interface ClientAssignRoleMessage {
  type: "assign-role";
  userId: string;
  roleId: string;
}

export interface ClientUnassignRoleMessage {
  type: "unassign-role";
  userId: string;
  roleId: string;
}

export type ClientMessage =
  | ClientAuthMessage
  | ClientJoinServerMessage
  | ClientJoinChannelMessage
  | ClientLeaveChannelMessage
  | ClientMuteMessage
  | ClientDeafenMessage
  | ClientRtpCapabilitiesMessage
  | ClientCreateTransportMessage
  | ClientConnectTransportMessage
  | ClientProduceMessage
  | ClientConsumeMessage
  | ClientResumeConsumerMessage
  | ClientChatMessage
  | ClientE2EEMessage
  | ClientKickMessage
  | ClientMoveUserMessage
  | ClientBanMessage
  | ClientSpeakingMessage
  | ClientAssignRoleMessage
  | ClientUnassignRoleMessage
  | ClientStopProducerMessage;

// ─── Server → Client Messages ───────────────────────────────────────────────

export interface ServerAuthResultMessage {
  type: "auth-result";
  success: boolean;
  userId?: string;
  error?: string;
}

export interface ServerJoinedServerMessage {
  type: "joined-server";
  serverId: string;
  serverName: string;
  serverDescription: string;
  serverIconUrl: string | null;
  channels: Channel[];
  members: SessionInfo[];
  roles: RoleInfo[];
  myPermissions: PermissionSet;
}

export interface ServerJoinedChannelMessage {
  type: "joined-channel";
  channelId: string;
  users: SessionInfo[];
  routerRtpCapabilities: object;
}

export interface ServerUserJoinedChannelMessage {
  type: "user-joined-channel";
  user: SessionInfo;
}

export interface ServerUserLeftChannelMessage {
  type: "user-left-channel";
  userId: string;
}

export interface ServerUserUpdatedMessage {
  type: "user-updated";
  userId: string;
  updates: Partial<Pick<Session, "isMuted" | "isDeafened" | "channelId">>;
}

export interface ServerTransportCreatedMessage {
  type: "transport-created";
  transportId: string;
  iceParameters: object;
  iceCandidates: object[];
  dtlsParameters: object;
}

export interface ServerProducedMessage {
  type: "produced";
  producerId: string;
  mediaType?: "mic" | "webcam" | "screen";
}

export interface ServerNewProducerMessage {
  type: "new-producer";
  userId: string;
  producerId: string;
  mediaType?: "mic" | "webcam" | "screen";
}

export interface ServerConsumeResultMessage {
  type: "consume-result";
  consumerId: string;
  producerId: string;
  kind: "audio" | "video";
  rtpParameters: object;
}

export interface ServerProducerClosedMessage {
  type: "producer-closed";
  producerId: string;
  userId: string;
  mediaType?: "mic" | "webcam" | "screen";
}

export interface ServerChatMessage {
  type: "chat";
  channelId: string;
  userId: string;
  nickname: string;
  ciphertext: string;
  iv: string;
  keyEpoch: number;
  timestamp: number;
}

export interface ServerE2EEMessage {
  type: "e2ee";
  fromUserId: string;
  payload: E2EEKeyExchangeMessage;
}

export interface ServerErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export interface ServerUserKickedMessage {
  type: "user-kicked";
  userId: string;
  reason?: string;
}

export interface ServerUserMovedMessage {
  type: "user-moved";
  userId: string;
  channelId: string;
}

export interface ServerUserBannedMessage {
  type: "user-banned";
  userId: string;
  reason?: string;
}

export interface ServerSpeakingMessage {
  type: "speaking";
  userId: string;
  speaking: boolean;
}

export interface ServerRoleAssignedMessage {
  type: "role-assigned";
  userId: string;
  roleId: string;
  assigned: boolean;
}

export interface ServerChannelCreatedMessage {
  type: "channel-created";
  channel: Channel;
}

export interface ServerChannelDeletedMessage {
  type: "channel-deleted";
  channelId: string;
}

export type ServerMessage =
  | ServerAuthResultMessage
  | ServerJoinedServerMessage
  | ServerJoinedChannelMessage
  | ServerUserJoinedChannelMessage
  | ServerUserLeftChannelMessage
  | ServerUserUpdatedMessage
  | ServerTransportCreatedMessage
  | ServerProducedMessage
  | ServerNewProducerMessage
  | ServerConsumeResultMessage
  | ServerProducerClosedMessage
  | ServerChatMessage
  | ServerE2EEMessage
  | ServerErrorMessage
  | ServerUserKickedMessage
  | ServerUserMovedMessage
  | ServerUserBannedMessage
  | ServerSpeakingMessage
  | ServerRoleAssignedMessage
  | ServerChannelCreatedMessage
  | ServerChannelDeletedMessage
  | ServerPermissionsUpdatedMessage
  | ServerUpdatedMessage;

export interface ServerUpdatedMessage {
  type: "server-updated";
  serverName?: string;
  serverDescription?: string;
  serverIconUrl?: string | null;
}

export interface ServerPermissionsUpdatedMessage {
  type: "permissions-updated";
  myPermissions: PermissionSet;
}

// ─── Shared Info Types ──────────────────────────────────────────────────────

export interface SessionInfo {
  userId: string;
  nickname: string;
  channelId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  publicKey?: string;
  roleIds?: string[];
  avatarUrl?: string | null;
}

export interface RoleInfo {
  id: string;
  name: string;
  color: string | null;
  priority: number;
  permissions: PermissionSet;
  isDefault: boolean;
}
