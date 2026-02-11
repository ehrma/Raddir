import type { PermissionSet, PermissionValue, Channel } from "@raddir/shared";
import { PERMISSION_KEYS, type PermissionKey } from "@raddir/shared";
import { getUserRoles, getChannelOverrides } from "../models/permission.js";
import { getChannel } from "../models/channel.js";

const EMPTY_PERMISSIONS: PermissionSet = {
  join: "inherit",
  speak: "inherit",
  whisper: "inherit",
  moveUsers: "inherit",
  kick: "inherit",
  ban: "inherit",
  admin: "inherit",
  manageChannels: "inherit",
  managePermissions: "inherit",
  manageRoles: "inherit",
};

export function computeEffectivePermissions(
  userId: string,
  serverId: string,
  channelId?: string
): PermissionSet {
  const roles = getUserRoles(userId, serverId);

  if (roles.length === 0) {
    return { ...EMPTY_PERMISSIONS };
  }

  // Merge server-level role permissions (highest priority wins)
  const serverPerms = mergeRolePermissions(roles.map((r) => r.permissions));

  // If admin, grant everything
  if (serverPerms.admin === "allow") {
    const allAllow: PermissionSet = { ...EMPTY_PERMISSIONS };
    for (const key of PERMISSION_KEYS) {
      allAllow[key] = "allow";
    }
    return allAllow;
  }

  if (!channelId) {
    return resolveInherits(serverPerms);
  }

  // Walk channel tree from target channel up to root, collecting overrides
  const channelChain = getChannelChain(channelId);
  let effective = { ...serverPerms };

  for (const ch of channelChain) {
    const overrides = getChannelOverrides(ch.id);
    if (overrides.length === 0) continue;

    // For each role the user has, apply overrides (highest priority role wins)
    const roleIds = new Set(roles.map((r) => r.id));
    const relevantOverrides = overrides
      .filter((o) => roleIds.has(o.roleId))
      .sort((a, b) => {
        const roleA = roles.find((r) => r.id === a.roleId);
        const roleB = roles.find((r) => r.id === b.roleId);
        return (roleB?.priority ?? 0) - (roleA?.priority ?? 0);
      });

    for (const override of relevantOverrides) {
      for (const key of PERMISSION_KEYS) {
        const val = override.permissions[key];
        if (val && val !== "inherit") {
          effective[key] = val;
        }
      }
    }
  }

  return resolveInherits(effective);
}

export function hasPermission(
  userId: string,
  serverId: string,
  permission: PermissionKey,
  channelId?: string
): boolean {
  const perms = computeEffectivePermissions(userId, serverId, channelId);
  return perms[permission] === "allow";
}

function mergeRolePermissions(permSets: PermissionSet[]): PermissionSet {
  const result: PermissionSet = { ...EMPTY_PERMISSIONS };

  // Sort by priority (already sorted from getUserRoles), highest first
  // For each permission, the first non-inherit value wins
  for (const key of PERMISSION_KEYS) {
    for (const perms of permSets) {
      if (perms[key] !== "inherit") {
        result[key] = perms[key];
        break;
      }
    }
  }

  return result;
}

function resolveInherits(perms: PermissionSet): PermissionSet {
  const result = { ...perms };
  for (const key of PERMISSION_KEYS) {
    if (result[key] === "inherit") {
      result[key] = "deny";
    }
  }
  return result;
}

function getChannelChain(channelId: string): Channel[] {
  const chain: Channel[] = [];
  let current = getChannel(channelId);

  while (current) {
    chain.unshift(current);
    if (current.parentId) {
      current = getChannel(current.parentId);
    } else {
      break;
    }
  }

  return chain;
}
