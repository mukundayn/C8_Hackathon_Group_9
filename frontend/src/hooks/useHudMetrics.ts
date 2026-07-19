import { useEffect, useState } from "react";
import { fetchHudMetrics, type HudMetrics } from "../lib/api";

const POLL_MS = 2000;

const EMPTY: HudMetrics = {
  ingest_total: 0,
  avg_response_ms: 0,
  critical_incidents: 0,
};

/** Polls cockpit gauge rollups (ingest +1, avg process ms, critical rollup). */
export function useHudMetrics(enabled: boolean, refreshKey = 0): HudMetrics {
  const [metrics, setMetrics] = useState<HudMetrics>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const next = await fetchHudMetrics();
        if (!cancelled) setMetrics(next);
      } catch {
        /* keep last known */
      }
    };

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, refreshKey]);

  return metrics;
}
