import { describe, it, expect } from "vitest";
import { summarizeKbPath } from "./kbPath";
import type { AnalysisResult } from "../types";

describe("summarizeKbPath", () => {
  it("labels a pure KB HIT", () => {
    const result: AnalysisResult = {
      remediations: [
        {
          issue_id: "db-1",
          fix_summary: "raise pool",
          kb_status: "hit",
          grounded_in: ["Postgres pool runbook"],
        },
      ],
    };
    const s = summarizeKbPath(result);
    expect(s.hits).toHaveLength(1);
    expect(s.learnedIntoKb).toBe(false);
    expect(s.label).toMatch(/KB HIT/i);
  });

  it("labels miss → learn from fallback_results", () => {
    const result: AnalysisResult = {
      remediations: [
        {
          issue_id: "qx-1",
          fix_summary: "stabilize chronos",
          kb_status: "learned",
          fallback: true,
        },
      ],
      fallback_results: {
        path: "miss_learn",
        processed: 1,
        patterns_learned: 1,
        learned_issue_ids: ["qx-1"],
        learned_titles: ["Temporal anchor desync"],
      },
    };
    const s = summarizeKbPath(result);
    expect(s.learnedIntoKb).toBe(true);
    expect(s.learned).toHaveLength(1);
    expect(s.label).toMatch(/MISS|LEARN/i);
  });
});
