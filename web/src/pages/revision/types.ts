export type ComparePair = "active_incoming" | "base_incoming" | "base_active";

export type ReviewAction = "approve" | "activate" | "reject";

export function comparePairSides(pair: ComparePair) {
  switch (pair) {
    case "active_incoming":
      return {
        left: "active" as const,
        right: "incoming" as const,
        leftLabel: "当前生效",
        rightLabel: "本次变更",
      };
    case "base_incoming":
      return {
        left: "base" as const,
        right: "incoming" as const,
        leftLabel: "原始基线",
        rightLabel: "本次变更",
      };
    case "base_active":
      return {
        left: "base" as const,
        right: "active" as const,
        leftLabel: "原始基线",
        rightLabel: "当前生效",
      };
  }
}

export const COMPARE_PAIR_OPTIONS: ReadonlyArray<{ value: ComparePair; label: string }> = [
  { value: "active_incoming", label: "当前生效 → 本次变更" },
  { value: "base_incoming", label: "原始基线 → 本次变更" },
  { value: "base_active", label: "原始基线 → 当前生效" },
];
