import type { AnalysisResult, FallbackResults, KbStatus, Remediation } from "../types";

export interface KbPathSummary {
  hits: Remediation[];
  learned: Remediation[];
  misses: Remediation[];
  fallback: FallbackResults | null;
  /** True when fallback node wrote patterns into the vector store. */
  learnedIntoKb: boolean;
  label: string;
}

/** Derive HIT vs MISS→LEARN summary from the analyze `done` payload. */
export function summarizeKbPath(result: AnalysisResult | null | undefined): KbPathSummary {
  const rems = result?.remediations ?? [];
  const fallback = result?.fallback_results ?? null;
  const learnedIds = new Set(fallback?.learned_issue_ids ?? []);

  const hits: Remediation[] = [];
  const learned: Remediation[] = [];
  const misses: Remediation[] = [];

  for (const r of rems) {
    const status: KbStatus | undefined =
      r.kb_status ??
      (r.fallback || learnedIds.has(r.issue_id)
        ? "learned"
        : r.grounded_in && r.grounded_in.length > 0
          ? "hit"
          : "miss");

    if (status === "learned" || r.fallback) learned.push(r);
    else if (status === "hit") hits.push(r);
    else misses.push(r);
  }

  // Prefer fallback-tagged remediations; if only learned_issue_ids, still count.
  const learnedIntoKb = Boolean(
    fallback && ((fallback.patterns_learned ?? 0) > 0 || (fallback.processed ?? 0) > 0),
  );

  let label = "No remediations yet";
  if (hits.length && !learnedIntoKb && learned.length === 0) {
    label = `KB HIT · ${hits.length} grounded in runbooks`;
  } else if (learnedIntoKb || learned.length) {
    label = `KB MISS → LEARN · ${fallback?.patterns_learned ?? learned.length} pattern(s) written to store`;
  } else if (misses.length) {
    label = `KB MISS · ${misses.length} ungrounded (fallback may still be running)`;
  } else if (hits.length && learned.length) {
    label = `Mixed · ${hits.length} HIT · ${learned.length} LEARNED`;
  }

  if (hits.length && learned.length) {
    label = `Mixed · ${hits.length} HIT · ${learned.length} LEARNED`;
  }

  return { hits, learned, misses, fallback, learnedIntoKb, label };
}
