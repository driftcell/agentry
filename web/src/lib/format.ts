const intFormatter = new Intl.NumberFormat("en-US");

export function formatTokens(count: number | null | undefined): string {
  if (count === null || count === undefined || Number.isNaN(count)) {
    return "0";
  }
  return intFormatter.format(Math.trunc(count));
}

export function formatSignedDelta(delta: number): string {
  if (delta > 0) return `+${formatTokens(delta)}`;
  if (delta < 0) return `-${formatTokens(Math.abs(delta))}`;
  return "0";
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(2)} MiB`;
}

export function shortHash(hash: string | null | undefined, length = 8): string {
  if (!hash) return "—";
  return hash.slice(0, length);
}

export function shortUuid(id: string | null | undefined, length = 8): string {
  if (!id) return "—";
  return id.slice(0, length);
}

export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "0.0 ms";
  return `${ms.toFixed(1)} ms`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function formatRelativeTime(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "—";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const diffSec = Math.round((nowMs - time) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatTimestamp(iso).slice(0, 10);
}

export function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line || "(empty commit message)";
}
