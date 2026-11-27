import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const { setSelectedProjectSlug, refreshSession } = useAuth();
  const queryClient = useQueryClient();

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("200000");
  const [error, setError] = useState<string | null>(null);

  const createProject = useMutation({
    mutationFn: (input: { slug: string; name: string; description: string; token_budget: number }) =>
      api.createProject(input),
    onSuccess: async (_result, input) => {
      onOpenChange(false);
      setSlug("");
      setName("");
      setDescription("");
      setBudget("200000");
      setError(null);
      setSelectedProjectSlug(input.slug);
      await Promise.all([
        refreshSession(),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "创建项目失败。");
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const nextSlug = slug.trim();
    const nextName = name.trim();
    const nextBudget = Number(budget);

    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(nextSlug)) {
      setError("项目标识需为 3–64 位小写字母、数字或连字符。");
      return;
    }
    if (!nextName) {
      setError("请填写项目名称。");
      return;
    }
    if (!Number.isInteger(nextBudget) || nextBudget <= 0) {
      setError("Token 预算必须为正整数。");
      return;
    }

    setError(null);
    createProject.mutate({
      slug: nextSlug,
      name: nextName,
      description: description.trim(),
      token_budget: nextBudget,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>创建新的独立项目工作区。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          {error ? (
            <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono">
              {error}
            </div>
          ) : null}

          <div className="space-y-1">
            <label htmlFor="new-proj-slug" className="block text-xs font-medium text-ink">
              项目标识 (Slug)
            </label>
            <Input
              id="new-proj-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="platform-core"
              className="font-mono"
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="new-proj-name" className="block text-xs font-medium text-ink">
              名称
            </label>
            <Input
              id="new-proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="核心平台"
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="new-proj-desc" className="block text-xs font-medium text-ink">
              描述（可选）
            </label>
            <Textarea
              id="new-proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="new-proj-budget" className="block text-xs font-medium text-ink">
              Token 预算上限
            </label>
            <Input
              id="new-proj-budget"
              type="number"
              min={1}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="mono-num"
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={createProject.isPending}
            >
              取消
            </Button>
            <Button type="submit" size="sm" disabled={createProject.isPending}>
              {createProject.isPending ? "正在创建…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
