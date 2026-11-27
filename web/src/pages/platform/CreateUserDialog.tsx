import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import type { UserRole } from "@/lib/types";
import { USER_ROLE_OPTIONS } from "./types";

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const queryClient = useQueryClient();

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [error, setError] = useState<string | null>(null);

  const createUser = useMutation({
    mutationFn: (input: {
      username: string;
      display_name: string;
      password: string;
      role: UserRole;
    }) => api.createUser(input),
    onSuccess: async () => {
      onOpenChange(false);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("member");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "创建用户失败。");
    },
  });

  const selectedRole = USER_ROLE_OPTIONS.find((option) => option.value === role) ?? null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const nextUsername = username.trim();

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(nextUsername)) {
      setError("用户名需为 3–64 位字母、数字、点、下划线或连字符。");
      return;
    }
    if (password.length < 8) {
      setError("密码至少 8 个字符。");
      return;
    }

    setError(null);
    createUser.mutate({
      username: nextUsername,
      display_name: displayName.trim(),
      password,
      role,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建用户</DialogTitle>
          <DialogDescription>创建工作台登录账号。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          {error ? (
            <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono">
              {error}
            </div>
          ) : null}

          <div className="space-y-1">
            <label htmlFor="new-user-username" className="block text-xs font-medium text-ink">
              用户名
            </label>
            <Input
              id="new-user-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="reviewer.alice"
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="new-user-display" className="block text-xs font-medium text-ink">
              显示名称
            </label>
            <Input
              id="new-user-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alice"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="new-user-password" className="block text-xs font-medium text-ink">
              密码（至少 8 位）
            </label>
            <Input
              id="new-user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="new-user-role" className="block text-xs font-medium text-ink">
              角色
            </label>
            <Combobox
              items={[...USER_ROLE_OPTIONS]}
              value={selectedRole}
              onValueChange={(next) => {
                if (next) setRole(next.value);
              }}
              itemToStringLabel={(item) => item.label}
              itemToStringValue={(item) => item.value}
              isItemEqualToValue={(item, current) => item.value === current.value}
            >
              <ComboboxTrigger
                id="new-user-role"
                render={<Button variant="outline" size="sm" className="w-full justify-between" />}
              >
                <ComboboxValue />
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item.value} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={createUser.isPending}
            >
              取消
            </Button>
            <Button type="submit" size="sm" disabled={createUser.isPending}>
              {createUser.isPending ? "正在创建…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
