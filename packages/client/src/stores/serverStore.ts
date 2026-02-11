import { create } from "zustand";
import type { Channel, PermissionSet } from "@raddir/shared";
import type { SessionInfo, RoleInfo } from "@raddir/shared";

export interface ServerState {
  connected: boolean;
  authenticated: boolean;
  userId: string | null;
  serverId: string | null;
  channels: Channel[];
  members: Map<string, SessionInfo>;
  roles: RoleInfo[];
  myPermissions: PermissionSet | null;
  currentChannelId: string | null;

  setConnected: (connected: boolean) => void;
  setAuthenticated: (authenticated: boolean, userId?: string) => void;
  setServerData: (data: {
    serverId: string;
    channels: Channel[];
    members: SessionInfo[];
    roles: RoleInfo[];
    myPermissions: PermissionSet;
  }) => void;
  setCurrentChannel: (channelId: string | null) => void;
  updateMember: (userId: string, updates: Partial<SessionInfo>) => void;
  addMember: (member: SessionInfo) => void;
  removeMember: (userId: string) => void;
  reset: () => void;
}

const initialState = {
  connected: false,
  authenticated: false,
  userId: null as string | null,
  serverId: null as string | null,
  channels: [] as Channel[],
  members: new Map<string, SessionInfo>(),
  roles: [] as RoleInfo[],
  myPermissions: null as PermissionSet | null,
  currentChannelId: null as string | null,
};

export const useServerStore = create<ServerState>((set) => ({
  ...initialState,

  setConnected: (connected) => set({ connected }),

  setAuthenticated: (authenticated, userId) =>
    set({ authenticated, userId: userId ?? null }),

  setServerData: (data) =>
    set({
      serverId: data.serverId,
      channels: data.channels,
      members: new Map(data.members.map((m) => [m.userId, m])),
      roles: data.roles,
      myPermissions: data.myPermissions,
    }),

  setCurrentChannel: (currentChannelId) => set({ currentChannelId }),

  updateMember: (userId, updates) =>
    set((state) => {
      const members = new Map(state.members);
      const existing = members.get(userId);
      if (existing) {
        members.set(userId, { ...existing, ...updates });
      }
      return { members };
    }),

  addMember: (member) =>
    set((state) => {
      const members = new Map(state.members);
      members.set(member.userId, member);
      return { members };
    }),

  removeMember: (userId) =>
    set((state) => {
      const members = new Map(state.members);
      members.delete(userId);
      return { members };
    }),

  reset: () => set(initialState),
}));
