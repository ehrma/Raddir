export interface Server {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  maxUsers: number;
}

export interface Channel {
  id: string;
  serverId: string;
  parentId: string | null;
  name: string;
  description: string;
  position: number;
  maxUsers: number;
  joinPower: number;
  talkPower: number;
  isDefault: boolean;
  createdAt: number;
}

export interface User {
  id: string;
  nickname: string;
  publicKey: string | null;
  createdAt: number;
}

export interface ServerMember {
  userId: string;
  serverId: string;
  nickname: string;
  roleIds: string[];
  joinedAt: number;
}

export interface Role {
  id: string;
  serverId: string;
  name: string;
  priority: number;
  permissions: PermissionSet;
  isDefault: boolean;
  createdAt: number;
}

export interface PermissionSet {
  join: PermissionValue;
  speak: PermissionValue;
  whisper: PermissionValue;
  moveUsers: PermissionValue;
  kick: PermissionValue;
  ban: PermissionValue;
  admin: PermissionValue;
  manageChannels: PermissionValue;
  managePermissions: PermissionValue;
  manageRoles: PermissionValue;
}

export type PermissionValue = "allow" | "deny" | "inherit";

export interface ChannelPermissionOverride {
  channelId: string;
  roleId: string;
  permissions: Partial<PermissionSet>;
}

export interface Session {
  id: string;
  userId: string;
  serverId: string;
  channelId: string | null;
  connectedAt: number;
  isMuted: boolean;
  isDeafened: boolean;
}

export interface InviteToken {
  id: string;
  serverId: string;
  token: string;
  createdBy: string;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
}
