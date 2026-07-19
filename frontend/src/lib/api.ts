import type {
  AnalyzeCallbacks,
  AnalysisResult,
  Expertise,
  LiveEvent,
  NodeEvent,
} from "../types";
import { parseSseFrames, type SseFrame } from "./sse";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Stream a log analysis from the real backend.
 *
 * Sends the file as multipart/form-data to POST /api/analyze and dispatches
 * the `node` / `done` SSE events emitted by the LangGraph pipeline.
 * Operator expertise (optional) is forwarded so the backend can route Jira
 * tickets to the active operator vs a specialist queue.
 */
export async function analyze(
  file: File,
  { onNode, onDone, onError }: AnalyzeCallbacks,
  expertise: Expertise[] = [],
): Promise<void> {
  let sawDone = false;
  try {
    const form = new FormData();
    form.append("file", file);
    if (expertise.length > 0) {
      form.append("expertise", expertise.join(","));
    }

    const res = await fetch(`${BASE}/api/analyze`, { method: "POST", body: form });
    if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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

    // Flush any trailing frame left without a final blank line.
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseFrames(buffer.endsWith("\n\n") ? buffer : `${buffer}\n\n`);
      dispatch(parsed.events);
    }

    if (!sawDone) {
      onError?.(new Error("Analysis stream ended before results were received."));
    }
  } catch (err) {
    if (!sawDone) onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Convenience: turn a sample-template string into a File for the multipart upload. */
export function textToLogFile(text: string, filename: string): File {
  return new File([text], filename, { type: "text/plain" });
}

/** Poll the real recent-events buffer (populated by the webhook ingestion endpoint). */
export async function fetchRecentEvents(): Promise<LiveEvent[]> {
  const res = await fetch(`${BASE}/api/events/recent`);
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
  const res = await fetch(`${BASE}/api/metrics/traffic`);
  if (!res.ok) throw new Error(`Traffic request failed: ${res.status}`);
  const data = (await res.json()) as { points?: TrafficPoint[] };
  return data.points ?? [];
}

/** The public URL an external system (e.g. n8n) should POST logs to. */
export function webhookIngestUrl(): string {
  return `${window.location.origin}/api/webhook/logs`;
}
