import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StateViews";
import { RevisionConfirmDialogs } from "./revision/RevisionConfirmDialogs";
import { RevisionHeader } from "./revision/RevisionHeader";
import { RevisionProvider, useRevision } from "./revision/RevisionProvider";
import { RevisionStudio } from "./revision/RevisionStudio";
import { RevisionSummary } from "./revision/RevisionSummary";

function RevisionShell() {
  const { actions, meta } = useRevision();

  if (meta.detailLoading) {
    return <LoadingPanel label="加载中…" />;
  }

  if (meta.detailError) {
    return (
      <ErrorPanel
        title="无法加载修订详情"
        error={meta.detailError}
        onRetry={actions.refreshDetail}
      />
    );
  }

  if (!meta.detail || !meta.revision || !meta.project) {
    return <EmptyPanel title="修订不存在" />;
  }

  return (
    <div className="space-y-4">
      <RevisionHeader />
      <RevisionSummary />
      <RevisionStudio />
      <RevisionConfirmDialogs />
    </div>
  );
}

export function RevisionDetailPage({ revisionId }: { revisionId: string }) {
  return (
    <RevisionProvider revisionId={revisionId}>
      <RevisionShell />
    </RevisionProvider>
  );
}
