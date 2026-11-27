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
          <span>ACTIVE</span>
        </Badge>
      );
      break;
    case "pending_review":
      badge = (
        <Badge variant="outline">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>PENDING REVIEW</span>
        </Badge>
      );
      break;
    case "approved":
      badge = (
        <Badge variant="added">
          <Check className="h-3 w-3" aria-hidden="true" />
          <span>APPROVED</span>
        </Badge>
      );
      break;
    case "conflict":
      badge = (
        <Badge variant="warning">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          <span>
            CONFLICT
            {conflictCount && conflictCount > 0 ? ` (${conflictCount})` : ""}
          </span>
        </Badge>
      );
      break;
    case "rejected":
      badge = (
        <Badge variant="removed" className="line-through">
          <XCircle className="h-3 w-3" aria-hidden="true" />
          <span>REJECTED</span>
        </Badge>
      );
      break;
    case "superseded":
      badge = (
        <Badge variant="dashed">
          <Archive className="h-3 w-3" aria-hidden="true" />
          <span>SUPERSEDED</span>
        </Badge>
      );
      break;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {badge}
      {stale && status !== "active" && status !== "superseded" && status !== "rejected" ? (
        <Badge variant="warning" title="Merged against an older active revision">
          <GitCommitHorizontal className="h-3 w-3" aria-hidden="true" />
          <span>STALE</span>
        </Badge>
      ) : null}
    </span>
  );
}
