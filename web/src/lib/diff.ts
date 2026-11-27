export type DiffLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffCollapseBlock {
  kind: "collapse";
  id: string;
  count: number;
  lines: DiffLine[];
}

export interface DiffLineBlock {
  kind: "line";
  line: DiffLine;
}

export type UnifiedDiffBlock = DiffCollapseBlock | DiffLineBlock;

export interface SplitDiffCell {
  type: DiffLineType | "empty";
  lineNo: number | null;
  text: string;
}

export interface SplitDiffRow {
  kind: "row";
  left: SplitDiffCell;
  right: SplitDiffCell;
}

export interface SplitCollapseRow {
  kind: "collapse";
  id: string;
  count: number;
  lines: DiffLine[];
}

export type SplitDiffBlock = SplitDiffRow | SplitCollapseRow;

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  isIdentical: boolean;
  truncatedMatrix: boolean;
}

function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

const MAX_LCS_CELLS = 1_500_000;

export function computeLineDiff(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): DiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  const lines: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) {
    lines.push({
      type: "context",
      oldLine: i + 1,
      newLine: i + 1,
      text: a[i] ?? "",
    });
  }

  let truncatedMatrix = false;
  let additions = 0;
  let deletions = 0;

  if (aMid.length === 0 && bMid.length === 0) {
    // Nothing in middle
  } else if (aMid.length === 0) {
    for (let j = 0; j < bMid.length; j += 1) {
      additions += 1;
      lines.push({
        type: "add",
        oldLine: null,
        newLine: prefix + j + 1,
        text: bMid[j] ?? "",
      });
    }
  } else if (bMid.length === 0) {
    for (let i = 0; i < aMid.length; i += 1) {
      deletions += 1;
      lines.push({
        type: "remove",
        oldLine: prefix + i + 1,
        newLine: null,
        text: aMid[i] ?? "",
      });
    }
  } else if (aMid.length * bMid.length > MAX_LCS_CELLS) {
    truncatedMatrix = true;
    for (let i = 0; i < aMid.length; i += 1) {
      deletions += 1;
      lines.push({
        type: "remove",
        oldLine: prefix + i + 1,
        newLine: null,
        text: aMid[i] ?? "",
      });
    }
    for (let j = 0; j < bMid.length; j += 1) {
      additions += 1;
      lines.push({
        type: "add",
        oldLine: null,
        newLine: prefix + j + 1,
        text: bMid[j] ?? "",
      });
    }
  } else {
    const m = aMid.length;
    const n = bMid.length;
    const stride = n + 1;
    const dp = new Int32Array((m + 1) * stride);

    for (let i = m - 1; i >= 0; i -= 1) {
      const aLine = aMid[i];
      for (let j = n - 1; j >= 0; j -= 1) {
        if (aLine === bMid[j]) {
          dp[i * stride + j] = (dp[(i + 1) * stride + (j + 1)] ?? 0) + 1;
        } else {
          const down = dp[(i + 1) * stride + j] ?? 0;
          const right = dp[i * stride + (j + 1)] ?? 0;
          dp[i * stride + j] = down >= right ? down : right;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (aMid[i] === bMid[j]) {
        lines.push({
          type: "context",
          oldLine: prefix + i + 1,
          newLine: prefix + j + 1,
          text: aMid[i] ?? "",
        });
        i += 1;
        j += 1;
      } else {
        const down = dp[(i + 1) * stride + j] ?? 0;
        const right = dp[i * stride + (j + 1)] ?? 0;
        if (down >= right) {
          deletions += 1;
          lines.push({
            type: "remove",
            oldLine: prefix + i + 1,
            newLine: null,
            text: aMid[i] ?? "",
          });
          i += 1;
        } else {
          additions += 1;
          lines.push({
            type: "add",
            oldLine: null,
            newLine: prefix + j + 1,
            text: bMid[j] ?? "",
          });
          j += 1;
        }
      }
    }
    while (i < m) {
      deletions += 1;
      lines.push({
        type: "remove",
        oldLine: prefix + i + 1,
        newLine: null,
        text: aMid[i] ?? "",
      });
      i += 1;
    }
    while (j < n) {
      additions += 1;
      lines.push({
        type: "add",
        oldLine: null,
        newLine: prefix + j + 1,
        text: bMid[j] ?? "",
      });
      j += 1;
    }
  }

  for (let k = 0; k < suffix; k += 1) {
    const oldIdx = a.length - suffix + k;
    const newIdx = b.length - suffix + k;
    lines.push({
      type: "context",
      oldLine: oldIdx + 1,
      newLine: newIdx + 1,
      text: a[oldIdx] ?? "",
    });
  }

  return {
    lines,
    additions,
    deletions,
    isIdentical: additions === 0 && deletions === 0,
    truncatedMatrix,
  };
}

export function collapseDiffLines(lines: DiffLine[], contextLines = 3): UnifiedDiffBlock[] {
  if (lines.length === 0) return [];
  const keep = new Uint8Array(lines.length);
  let hasChanges = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && line.type !== "context") {
      hasChanges = true;
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length - 1, i + contextLines);
      for (let k = start; k <= end; k += 1) {
        keep[k] = 1;
      }
    }
  }

  if (!hasChanges) {
    // When unchanged, show up to 20 lines and collapse the rest if long.
    if (lines.length <= 24) {
      return lines.map((line) => ({ kind: "line", line }));
    }
    const head: UnifiedDiffBlock[] = lines.slice(0, 12).map((line) => ({ kind: "line", line }));
    const rest = lines.slice(12);
    head.push({
      kind: "collapse",
      id: "collapse-unchanged-tail",
      count: rest.length,
      lines: rest,
    });
    return head;
  }

  const blocks: UnifiedDiffBlock[] = [];
  let hiddenBuffer: DiffLine[] = [];

  const flushHidden = () => {
    if (hiddenBuffer.length === 0) return;
    if (hiddenBuffer.length <= 2) {
      for (const line of hiddenBuffer) {
        blocks.push({ kind: "line", line });
      }
    } else {
      const firstOld = hiddenBuffer[0]?.oldLine ?? 0;
      blocks.push({
        kind: "collapse",
        id: `collapse-${firstOld}-${hiddenBuffer.length}`,
        count: hiddenBuffer.length,
        lines: hiddenBuffer,
      });
    }
    hiddenBuffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (keep[i] === 1) {
      flushHidden();
      blocks.push({ kind: "line", line });
    } else {
      hiddenBuffer.push(line);
    }
  }
  flushHidden();

  return blocks;
}

export function buildSplitDiffBlocks(lines: DiffLine[], contextLines = 3): SplitDiffBlock[] {
  const unified = collapseDiffLines(lines, contextLines);
  const out: SplitDiffBlock[] = [];
  let idx = 0;

  while (idx < unified.length) {
    const block = unified[idx];
    if (!block) {
      idx += 1;
      continue;
    }
    if (block.kind === "collapse") {
      out.push({
        kind: "collapse",
        id: block.id,
        count: block.count,
        lines: block.lines,
      });
      idx += 1;
      continue;
    }
    if (block.line.type === "context") {
      out.push({
        kind: "row",
        left: { type: "context", lineNo: block.line.oldLine, text: block.line.text },
        right: { type: "context", lineNo: block.line.newLine, text: block.line.text },
      });
      idx += 1;
      continue;
    }

    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (idx < unified.length) {
      const curr = unified[idx];
      if (!curr || curr.kind !== "line" || curr.line.type === "context") break;
      if (curr.line.type === "remove") removes.push(curr.line);
      else if (curr.line.type === "add") adds.push(curr.line);
      idx += 1;
    }

    const maxLen = Math.max(removes.length, adds.length);
    for (let k = 0; k < maxLen; k += 1) {
      const rem = removes[k];
      const add = adds[k];
      out.push({
        kind: "row",
        left: rem
          ? { type: "remove", lineNo: rem.oldLine, text: rem.text }
          : { type: "empty", lineNo: null, text: "" },
        right: add
          ? { type: "add", lineNo: add.newLine, text: add.text }
          : { type: "empty", lineNo: null, text: "" },
      });
    }
  }

  return out;
}
