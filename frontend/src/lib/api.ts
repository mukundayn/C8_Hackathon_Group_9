import type {
  AnalyzeCallbacks,
  AnalysisResult,
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
  { onNode, onDone }: Pick<AnalyzeCallbacks, "onNode" | "onDone">,
): Promise<boolean> {
  if (!res.body) return false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  const dispatch = (events: SseFrame[]): void => {
    for (const { evt, data } of events) {
      if (evt === "node") onNode?.(data as NodeEvent);
      else if (evt === "done") {
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
  { onNode, onDone, onError }: AnalyzeCallbacks,
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

    sawDone = await consumeAnalyzeStream(res, { onNode, onDone });
    if (!sawDone) {
      onError?.(new Error("Analysis stream ended before results were received."));
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
  errors: number;
  avg_response_ms: number;
}

/** Fetch aggregated traffic buckets derived from the recent-events buffer. */
export async function fetchTraffic(): Promise<TrafficPoint[]> {
  const res = await fetch(apiUrl("/api/metrics/traffic"), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Traffic request failed: ${res.status}`);
  const data = (await res.json()) as { points?: TrafficPoint[] };
  return data.points ?? [];
}

/** The public URL an external system (e.g. n8n) should POST logs to. */
export function webhookIngestUrl(): string {
  return `${window.location.origin}/api/webhook/logs`;
}
