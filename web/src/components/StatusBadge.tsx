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
        <Badge variant="solid">
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
        <Badge variant="added">
          <Check className="h-3 w-3" aria-hidden="true" />
          <span>已批准</span>
        </Badge>
      );
      break;
    case "conflict":
      badge = (
        <Badge variant="warning">
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
        <Badge variant="removed" className="line-through">
          <XCircle className="h-3 w-3" aria-hidden="true" />
          <span>已拒绝</span>
        </Badge>
      );
      break;
    case "superseded":
      badge = (
        <Badge variant="dashed">
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
        <Badge variant="warning" title="该修订基于更早的 Active Revision 合并，当前基线已变化">
          <GitCommitHorizontal className="h-3 w-3" aria-hidden="true" />
          <span>基线已变更</span>
        </Badge>
      ) : null}
    </span>
  );
}
