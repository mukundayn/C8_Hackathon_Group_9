import { useEffect, useState } from "react";
import { fetchTraffic, type TrafficPoint } from "../lib/api";

const POLL_MS = 3000;

/** Polls aggregated traffic buckets derived from the real recent-events buffer. */
export function useTraffic(enabled: boolean, refreshKey = 0): TrafficPoint[] {
  const [points, setPoints] = useState<TrafficPoint[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const pts = await fetchTraffic();
        if (!cancelled) setPoints(pts);
      } catch {
        /* keep last known points */
      }
    };

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, refreshKey]);

  return points;
}
