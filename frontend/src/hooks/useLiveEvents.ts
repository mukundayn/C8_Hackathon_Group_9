import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRecentEvents } from "../lib/api";
import { alertsFromLogs, liveEventToLogEntry } from "../lib/mappers";
import type { AnomalyAlert, LogEntry } from "../types";

const POLL_MS = 3000;
const MAX_LOGS = 120;

export interface UseLiveEvents {
  logs: LogEntry[];
  alerts: AnomalyAlert[];
  connected: boolean;
  dismissAlert: (id: string) => void;
  dismissAllAlerts: () => void;
  clearLogs: () => void;
}

/**
 * Polls the real recent-events buffer (GET /api/events/recent), which is
 * populated by external systems (n8n, Datadog, etc.) via the webhook endpoint.
 * Replaces the old Netra random log generator with a real external feed.
 */
export function useLiveEvents(enabled: boolean): UseLiveEvents {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
  }, []);

  const dismissAllAlerts = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, resolved: true })));
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    seenIds.current.clear();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const events = await fetchRecentEvents();
        if (cancelled) return;
        setConnected(true);

        const fresh = events
          .filter((e) => !seenIds.current.has(e.id))
          .map(liveEventToLogEntry);
        if (fresh.length === 0) return;

        fresh.forEach((l) => seenIds.current.add(l.id));
        setLogs((prev) => [...fresh, ...prev].slice(0, MAX_LOGS));

        const newAlerts = alertsFromLogs(fresh);
        if (newAlerts.length > 0) {
          setAlerts((prev) => [...newAlerts, ...prev].slice(0, 20));
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    };

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return { logs, alerts, connected, dismissAlert, dismissAllAlerts, clearLogs };
}
