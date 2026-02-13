export const PERMISSION_KEYS = [
  "join",
  "speak",
  "video",
  "screenShare",
  "whisper",
  "moveUsers",
  "kick",
  "ban",
  "admin",
  "manageChannels",
  "managePermissions",
  "manageRoles",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const DEFAULT_ADMIN_PERMISSIONS: Record<PermissionKey, "allow" | "deny" | "inherit"> = {
  join: "allow",
  speak: "allow",
  video: "allow",
  screenShare: "allow",
  whisper: "allow",
  moveUsers: "allow",
  kick: "allow",
  ban: "allow",
  admin: "allow",
  manageChannels: "allow",
  managePermissions: "allow",
  manageRoles: "allow",
};

export const DEFAULT_MEMBER_PERMISSIONS: Record<PermissionKey, "allow" | "deny" | "inherit"> = {
  join: "allow",
  speak: "allow",
  video: "allow",
  screenShare: "allow",
  whisper: "allow",
  moveUsers: "deny",
  kick: "deny",
  ban: "deny",
  admin: "deny",
  manageChannels: "deny",
  managePermissions: "deny",
  manageRoles: "deny",
};

export const DEFAULT_GUEST_PERMISSIONS: Record<PermissionKey, "allow" | "deny" | "inherit"> = {
  join: "allow",
  speak: "deny",
  video: "deny",
  screenShare: "deny",
  whisper: "deny",
  moveUsers: "deny",
  kick: "deny",
  ban: "deny",
  admin: "deny",
  manageChannels: "deny",
  managePermissions: "deny",
  manageRoles: "deny",
};
