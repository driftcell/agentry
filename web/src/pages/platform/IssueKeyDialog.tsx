import type { FormEvent } from "react";
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
import { ALL_SCOPES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApiKeys } from "./ApiKeysProvider";

export function IssueKeyDialog() {
  const { state, actions, meta } = useApiKeys();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    actions.submitIssue();
  };

  return (
    <Dialog open={state.issueOpen} onOpenChange={(open) => (open ? undefined : actions.closeIssue())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建密钥（{meta.effectiveKeySlug}）</DialogTitle>
          <DialogDescription>密钥明文仅显示一次，请妥善保存。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          {state.formError ? (
            <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono">
              {state.formError}
            </div>
          ) : null}

          <div className="space-y-1">
            <label htmlFor="issue-key-name" className="block text-xs font-medium text-ink">
              名称
            </label>
            <Input
              id="issue-key-name"
              value={state.name}
              onChange={(e) => actions.setName(e.target.value)}
              placeholder="ci-proposer"
              aria-invalid={state.nameError ? true : undefined}
              aria-describedby={state.nameError ? "issue-key-name-error" : undefined}
              required
            />
            {state.nameError ? (
              <p id="issue-key-name-error" className="text-[11px] text-red-700">
                {state.nameError}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-ink">权限范围</span>
            <div className="grid grid-cols-2 gap-2">
              {ALL_SCOPES.map((scope) => {
                const locked = scope === "admin:platform" && !meta.canPlatform;
                const checked = state.scopes.includes(scope);
                return (
                  <label
                    key={scope}
                    className={cn(
                      "flex items-center gap-2 rounded-sm border px-2.5 py-1.5 font-mono text-xs",
                      locked
                        ? "border-hairline bg-subtle text-ink-muted opacity-60 cursor-not-allowed"
                        : "border-zinc-300 bg-white text-ink cursor-pointer",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => actions.toggleScope(scope)}
                    />
                    <span>{scope}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {meta.canPlatform ? (
            <>
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={state.isGlobal}
                  onChange={(e) => actions.setIsGlobal(e.target.checked)}
                />
                <span>全局多项目密钥（不限定到当前项目）</span>
              </label>

              <div className="space-y-1">
                <label htmlFor="issue-key-user" className="block text-xs font-medium text-ink">
                  归属用户（可选）
                </label>
                <Combobox
                  items={meta.userOptions}
                  value={meta.selectedUser}
                  onValueChange={(next) => actions.setUserId(next?.value ?? "")}
                  itemToStringLabel={(item) => item.label}
                  itemToStringValue={(item) => item.value}
                  isItemEqualToValue={(item, current) => item.value === current.value}
                >
                  <ComboboxTrigger
                    id="issue-key-user"
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-between font-mono"
                      />
                    }
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
            </>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={actions.closeIssue}
              disabled={meta.isIssuing}
            >
              取消
            </Button>
            <Button type="submit" size="sm" disabled={meta.isIssuing}>
              {meta.isIssuing ? "正在生成…" : "生成密钥"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
