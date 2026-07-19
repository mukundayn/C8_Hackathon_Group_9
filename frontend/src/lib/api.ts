import type {
  AnalyzeCallbacks,
  AnalysisResult,
  DebugLogLine,
  Expertise,
  LiveEvent,
  NodeEvent,
} from "../types";
import { parseSseFrames, type SseFrame } from "./sse";

const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return res.statusText || String(res.status);
    // Render/WAF "Blocked" HTML pages — keep the message short.
    if (text.includes("<!DOCTYPE html>") || text.includes("<title>Blocked</title>")) {
      return "Edge firewall blocked the request. Retry with JSON analyze (redeploy latest) or a smaller/simpler log.";
    }
    try {
      const json = JSON.parse(text) as { detail?: unknown };
      if (typeof json.detail === "string") return json.detail;
      return text.slice(0, 280);
    } catch {
      return text.slice(0, 280);
    }
  } catch {
    return res.statusText || String(res.status);
  }
}

async function consumeAnalyzeStream(
  res: Response,
  { onNode, onDone, onError, onDebug }: AnalyzeCallbacks,
): Promise<boolean> {
  if (!res.body) return false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  const dispatch = (events: SseFrame[]): void => {
    for (const { evt, data } of events) {
      if (evt === "node") onNode?.(data as NodeEvent);
      else if (evt === "debug") onDebug?.(data as DebugLogLine);
      else if (evt === "error") {
        const msg =
          data && typeof data === "object" && "message" in data
            ? String((data as { message: unknown }).message)
            : "Analysis failed on the server.";
        // Prefer the server's message; still wait for a possible partial `done`.
        onError?.(new Error(msg));
      } else if (evt === "done") {
        sawDone = true;
        onDone?.(data as AnalysisResult);
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseFrames(buffer);
    buffer = parsed.rest;
    dispatch(parsed.events);
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const parsed = parseSseFrames(buffer.endsWith("\n\n") ? buffer : `${buffer}\n\n`);
    dispatch(parsed.events);
  }
  return sawDone;
}

/**
 * Stream a log analysis from the real backend.
 *
 * Sends JSON (not multipart) to avoid Render/WAF 403 "Blocked" pages that
 * frequently trigger on multipart uploads containing log-attack patterns.
 */
export async function analyze(
  file: File,
  { onNode, onDone, onError, onDebug }: AnalyzeCallbacks,
  expertise: Expertise[] = [],
): Promise<void> {
  let sawDone = false;
  const url = apiUrl("/api/analyze");
  try {
    const logText = await file.text();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        log_text: logText,
        filename: file.name || "upload.log",
        expertise: expertise.join(","),
      }),
    });

    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw new Error(`Request failed: ${res.status} (${url}) — ${detail}`);
    }

    sawDone = await consumeAnalyzeStream(res, { onNode, onDone, onError, onDebug });
    if (!sawDone) {
      onError?.(
        new Error(
          "Analysis stream ended before results were received. " +
            "Usually the Render process crashed or hit an LLM/RAG error mid-run — check the service logs.",
        ),
      );
    }
  } catch (err) {
    if (!sawDone) onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Convenience: turn a sample-template string into a File for the analyze helper. */
export function textToLogFile(text: string, filename: string): File {
  return new File([text], filename, { type: "text/plain" });
}

/** Poll the real recent-events buffer (populated by the webhook ingestion endpoint). */
export async function fetchRecentEvents(): Promise<LiveEvent[]> {
  const res = await fetch(apiUrl("/api/events/recent"), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Events request failed: ${res.status}`);
  const data = (await res.json()) as { events?: LiveEvent[] };
  return data.events ?? [];
}

export interface TrafficPoint {
  time: string;
  requests: number;
  volume_per_sec: number;
  errors: number;
  avg_response_ms: number;
  /** Mean severity score in bucket: 1=INFO … 4=CRITICAL */
  avg_severity: number;
}

export interface HudMetrics {
  ingest_total: number;
  avg_response_ms: number;
  critical_incidents: number;
}

/** Fetch aggregated traffic buckets derived from the recent-events buffer. */
export async function fetchTraffic(): Promise<TrafficPoint[]> {
  const res = await fetch(apiUrl("/api/metrics/traffic"), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Traffic request failed: ${res.status}`);
  const data = (await res.json()) as { points?: TrafficPoint[] };
  return (data.points ?? []).map((p) => ({
    ...p,
    volume_per_sec: p.volume_per_sec ?? p.requests ?? 0,
    avg_severity: p.avg_severity ?? 0,
  }));
}

/** Cockpit tiles: ingest count, avg add process ms, critical rollup. */
export async function fetchHudMetrics(): Promise<HudMetrics> {
  const res = await fetch(apiUrl("/api/metrics/hud"), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HUD metrics failed: ${res.status}`);
  const data = (await res.json()) as Partial<HudMetrics>;
  return {
    ingest_total: data.ingest_total ?? 0,
    avg_response_ms: data.avg_response_ms ?? 0,
    critical_incidents: data.critical_incidents ?? 0,
  };
}

export interface HitlApproveRequest {
  issue_ids: string[];
  pending?: Array<Record<string, unknown>>;
  issues?: Array<Record<string, unknown>>;
  remediations?: Array<Record<string, unknown>>;
  operator_expertise?: string[];
  cookbook?: Record<string, unknown> | null;
  learned_issue_ids?: string[];
}

export interface HitlApproveResponse {
  status: string;
  approved_issue_ids: string[];
  jira_tickets: import("../types").JiraTicket[];
  slack_result: import("../types").SlackResult;
}

/** Approve newly-learned critical(s) → create Jira tickets + Slack notify. */
export async function approveHitl(body: HitlApproveRequest): Promise<HitlApproveResponse> {
  const res = await fetch(apiUrl("/api/hitl/approve"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`HITL approve failed: ${res.status} ${err.slice(0, 160)}`);
  }
  return (await res.json()) as HitlApproveResponse;
}

/** The public URL an external system (e.g. n8n) should POST logs to. */
export function webhookIngestUrl(): string {
  return `${window.location.origin}/api/webhook/logs`;
}
