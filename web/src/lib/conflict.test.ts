import { describe, expect, test } from "bun:test";
import {
  extractSideFromMarked,
  hasConflictMarkers,
  parseConflictMarkers,
  resolveConflictSegments,
} from "@/lib/conflict";

const SAMPLE_MARKED = [
  "# Header",
  "<<<<<<< ours",
  "active line A",
  "active line B",
  "=======",
  "incoming line C",
  ">>>>>>> theirs",
  "footer",
].join("\n");

describe("conflict marker resolution", () => {
  test("detects conflict markers accurately", () => {
    expect(hasConflictMarkers(SAMPLE_MARKED)).toBe(true);
    expect(hasConflictMarkers("# Header\nclean text\n")).toBe(false);
  });

  test("parses conflict hunks and supports Accept Current, Incoming, and Both", () => {
    const segments = parseConflictMarkers(SAMPLE_MARKED);
    const hunks = segments.filter((s) => s.type === "conflict");
    expect(hunks).toHaveLength(1);

    const hunk = hunks[0];
    expect(hunk?.ours).toBe("active line A\nactive line B");
    expect(hunk?.theirs).toBe("incoming line C");

    expect(resolveConflictSegments(segments, { "hunk-1": "current" })).toBe(
      "# Header\nactive line A\nactive line B\nfooter",
    );
    expect(resolveConflictSegments(segments, { "hunk-1": "incoming" })).toBe(
      "# Header\nincoming line C\nfooter",
    );
    expect(resolveConflictSegments(segments, { "hunk-1": "both" })).toBe(
      "# Header\nactive line A\nactive line B\nincoming line C\nfooter",
    );
  });

  test("extracts clean sides from marked text", () => {
    expect(extractSideFromMarked(SAMPLE_MARKED, "current")).toBe(
      "# Header\nactive line A\nactive line B\nfooter",
    );
    expect(extractSideFromMarked(SAMPLE_MARKED, "incoming")).toBe(
      "# Header\nincoming line C\nfooter",
    );
  });
});
