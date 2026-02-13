import { useServerStore } from "../stores/serverStore";

/**
 * Get the display color for a user based on their highest-priority role.
 * Returns the color hex string or null if no role has a color.
 */
export function getUserRoleColor(userId: string): string | null {
  const { members, roles } = useServerStore.getState();
  const member = members.get(userId);
  if (!member) return null;

  const roleIds = (member as any).roleIds as string[] | undefined;
  if (!roleIds || roleIds.length === 0) return null;

  // Find the highest-priority role that has a color
  let bestColor: string | null = null;
  let bestPriority = -Infinity;

  for (const roleId of roleIds) {
    const role = roles.find((r) => r.id === roleId);
    if (role && role.color && role.priority > bestPriority) {
      bestColor = role.color;
      bestPriority = role.priority;
    }
  }

  return bestColor;
}
