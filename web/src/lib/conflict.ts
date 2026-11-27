export type HunkChoice = "current" | "incoming" | "both";

export interface CleanSegment {
  type: "clean";
  text: string;
}

export interface ConflictHunkSegment {
  type: "conflict";
  id: string;
  index: number;
  startLine: number;
  oursLabel: string;
  theirsLabel: string;
  ours: string;
  base: string | null;
  theirs: string;
}

export type ConflictSegment = CleanSegment | ConflictHunkSegment;

export function hasConflictMarkers(text: string): boolean {
  const lines = text.split(/\r?\n/);
  return lines.some(
    (line) =>
      line.startsWith("<<<<<<<") || line.startsWith("=======") || line.startsWith(">>>>>>>"),
  );
}

export function parseConflictMarkers(markedText: string): ConflictSegment[] {
  const lines = markedText.split(/\r?\n/);
  const segments: ConflictSegment[] = [];
  let cleanBuffer: string[] = [];
  let hunkIndex = 0;
  let i = 0;

  const flushClean = () => {
    if (cleanBuffer.length > 0) {
      segments.push({ type: "clean", text: cleanBuffer.join("\n") });
      cleanBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.startsWith("<<<<<<<")) {
      cleanBuffer.push(line);
      i += 1;
      continue;
    }

    const startLine = i + 1;
    const oursLabel = line.slice(7).trim() || "current";
    const oursLines: string[] = [];
    const baseLines: string[] = [];
    const theirsLines: string[] = [];

    let section: "ours" | "base" | "theirs" = "ours";
    let closed = false;
    let j = i + 1;

    while (j < lines.length) {
      const inner = lines[j] ?? "";
      if (section === "ours" && inner.startsWith("|||||||")) {
        section = "base";
        j += 1;
        continue;
      }
      if ((section === "ours" || section === "base") && inner.startsWith("=======")) {
        section = "theirs";
        j += 1;
        continue;
      }
      if (section === "theirs" && inner.startsWith(">>>>>>>")) {
        const theirsLabel = inner.slice(7).trim() || "incoming";
        flushClean();
        hunkIndex += 1;
        segments.push({
          type: "conflict",
          id: `hunk-${hunkIndex}`,
          index: hunkIndex,
          startLine,
          oursLabel,
          theirsLabel,
          ours: oursLines.join("\n"),
          base: baseLines.length > 0 ? baseLines.join("\n") : null,
          theirs: theirsLines.join("\n"),
        });
        closed = true;
        i = j + 1;
        break;
      }

      if (section === "ours") oursLines.push(inner);
      else if (section === "base") baseLines.push(inner);
      else theirsLines.push(inner);
      j += 1;
    }

    if (!closed) {
      cleanBuffer.push(line);
      i += 1;
    }
  }

  flushClean();
  return segments;
}

export function resolveConflictSegments(
  segments: ConflictSegment[],
  choices: Record<string, HunkChoice>,
): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.type === "clean") {
      parts.push(segment.text);
      continue;
    }
    const choice = choices[segment.id] ?? "current";
    if (choice === "current") {
      parts.push(segment.ours);
    } else if (choice === "incoming") {
      parts.push(segment.theirs);
    } else {
      const combined = [segment.ours, segment.theirs].filter((part) => part.length > 0).join("\n");
      parts.push(combined);
    }
  }
  return parts.join("\n");
}

export function extractSideFromMarked(markedText: string, side: "current" | "incoming"): string {
  const segments = parseConflictMarkers(markedText);
  const choices: Record<string, HunkChoice> = {};
  for (const segment of segments) {
    if (segment.type === "conflict") {
      choices[segment.id] = side;
    }
  }
  return resolveConflictSegments(segments, choices);
}

export function combineWholeDocuments(
  activeText: string | null | undefined,
  incomingText: string | null | undefined,
): string {
  const left = activeText ?? "";
  const right = incomingText ?? "";
  if (left === right) return left;
  if (!left) return right;
  if (!right) return left;
  const separator = left.endsWith("\n") ? "" : "\n";
  return `${left}${separator}${right}`;
}
