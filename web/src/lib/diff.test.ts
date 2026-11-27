import { describe, expect, test } from "bun:test";
import { buildSplitDiffBlocks, collapseDiffLines, computeLineDiff } from "@/lib/diff";

describe("computeLineDiff", () => {
  test("detects identical content", () => {
    const res = computeLineDiff("alpha\nbeta\n", "alpha\nbeta\n");
    expect(res.isIdentical).toBe(true);
    expect(res.additions).toBe(0);
    expect(res.deletions).toBe(0);
    expect(res.lines.every((l) => l.type === "context")).toBe(true);
  });

  test("computes additions, deletions, and preserved line numbers", () => {
    const oldText = "one\ntwo\nthree\nfour\n";
    const newText = "one\ntwo modified\nthree\nfive\n";
    const res = computeLineDiff(oldText, newText);
    expect(res.isIdentical).toBe(false);
    expect(res.additions).toBe(2);
    expect(res.deletions).toBe(2);

    const added = res.lines.filter((l) => l.type === "add").map((l) => l.text);
    const removed = res.lines.filter((l) => l.type === "remove").map((l) => l.text);
    expect(added).toEqual(["two modified", "five"]);
    expect(removed).toEqual(["two", "four"]);
  });

  test("collapses long unchanged spans and aligns split rows", () => {
    const many = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const oldText = many.join("\n");
    const updated = [...many];
    updated[15] = "line 16 changed";
    const newText = updated.join("\n");

    const diff = computeLineDiff(oldText, newText);
    const unified = collapseDiffLines(diff.lines, 2);
    expect(unified.some((b) => b.kind === "collapse")).toBe(true);

    const split = buildSplitDiffBlocks(diff.lines, 2);
    const changedRow = split.find(
      (b) => b.kind === "row" && b.left.type === "remove" && b.right.type === "add",
    );
    expect(changedRow).toBeDefined();
    if (changedRow && changedRow.kind === "row") {
      expect(changedRow.left.text).toBe("line 16");
      expect(changedRow.right.text).toBe("line 16 changed");
    }
  });
});
