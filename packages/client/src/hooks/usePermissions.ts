import { useServerStore } from "../stores/serverStore";
import type { PermissionKey } from "@raddir/shared";

export function usePermissions() {
  const myPermissions = useServerStore((s) => s.myPermissions);

  const can = (key: PermissionKey): boolean => {
    if (!myPermissions) return false;
    return myPermissions[key] === "allow";
  };

  const isAdmin = can("admin");

  return { can, isAdmin };
}
