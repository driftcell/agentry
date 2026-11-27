import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Clock,
  GitCommitHorizontal,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RevisionStatus } from "@/lib/types";

interface StatusBadgeProps {
  status: RevisionStatus;
  stale?: boolean;
  conflictCount?: number;
}

export function StatusBadge({ status, stale = false, conflictCount }: StatusBadgeProps) {
  let badge: React.ReactNode;
  switch (status) {
    case "active":
      badge = (
        <Badge variant="default">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          <span>生效中</span>
        </Badge>
      );
      break;
    case "pending_review":
      badge = (
        <Badge variant="outline">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>待审批</span>
        </Badge>
      );
      break;
    case "approved":
      badge = (
        <Badge
          variant="outline"
          className="border-emerald-300 bg-emerald-50 text-emerald-800"
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          <span>已批准</span>
        </Badge>
      );
      break;
    case "conflict":
      badge = (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          <span>
            存在冲突
            {conflictCount && conflictCount > 0 ? ` (${conflictCount})` : ""}
          </span>
        </Badge>
      );
      break;
    case "rejected":
      badge = (
        <Badge variant="destructive" className="line-through">
          <XCircle className="h-3 w-3" aria-hidden="true" />
          <span>已拒绝</span>
        </Badge>
      );
      break;
    case "superseded":
      badge = (
        <Badge variant="outline" className="border-dashed text-muted-foreground">
          <Archive className="h-3 w-3" aria-hidden="true" />
          <span>已替代</span>
        </Badge>
      );
      break;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {badge}
      {stale && status !== "active" && status !== "superseded" && status !== "rejected" ? (
        <Badge
          variant="outline"
          className="border-amber-300 bg-amber-50 text-amber-900"
          title="该修订基于更早的 Active Revision 合并，当前基线已变化"
        >
          <GitCommitHorizontal className="h-3 w-3" aria-hidden="true" />
          <span>基线已变更</span>
        </Badge>
      ) : null}
    </span>
  );
}
