import type { UserRole } from "@/lib/types";

export type PlatformTab = "projects" | "keys" | "users" | "setup";

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "superadmin":
      return "超级管理员";
    case "admin":
      return "管理员";
    case "member":
      return "普通成员";
  }
}

export const USER_ROLE_OPTIONS: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: "member", label: "普通成员（只读）" },
  { value: "admin", label: "管理员（审批与密钥管理）" },
  { value: "superadmin", label: "超级管理员（全部权限）" },
];
