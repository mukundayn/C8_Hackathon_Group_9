import type {
  AnalyzeCallbacks,
  AnalysisResult,
  DebugLogLine,
  Expertise,
  LiveEvent,
  NodeEvent,
} from "../types";
import { parseSseFrames, type SseFrame } from "./sse";
import { loadOpenRouterKey } from "./openrouterKey";

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
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return (
        "Backend/proxy unavailable (often Render cold-start, crash, or OpenRouter outage). " +
        "Check the API is up (`/api/ping`), restart uvicorn/Render, and confirm your OpenRouter BYOK on login. " +
        `Upstream said: ${text.replace(/\s+/g, " ").slice(0, 160)}`
      );
    }
    try {
      const json = JSON.parse(text) as { detail?: unknown; error?: { message?: unknown } };
      if (typeof json.detail === "string") return json.detail;
      if (typeof json.error?.message === "string") return json.error.message;
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

/** Max screenshot size before base64 (~1.33×) blows request/Render memory. */
const MAX_IMAGE_BYTES = 900_000; // ~0.9 MB after compress
const MAX_IMAGE_EDGE = 1024;

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

function imageMimeFor(file: File): string {
  if (file.type.startsWith("image/")) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/** Binary → base64 without data-URL prefix (chunked to avoid call-stack limits). */
async function bytesToBase64(bytes: Uint8Array): Promise<string> {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fileToBase64(file: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

/**
 * Downscale + JPEG-compress screenshots so vision + Render free tier survive.
 * Falls back to the original file if canvas encode fails.
 */
async function prepareImageForUpload(
  file: File,
): Promise<{ blob: Blob; mime: string; filename: string }> {
  const fallbackMime = imageMimeFor(file);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { blob: file, mime: fallbackMime, filename: file.name };
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72),
    );
    if (!blob || blob.size === 0) {
      return { blob: file, mime: fallbackMime, filename: file.name };
    }
    const base = (file.name || "screenshot").replace(/\.[^.]+$/, "");
    return { blob, mime: "image/jpeg", filename: `${base}.jpg` };
  } catch {
    return { blob: file, mime: fallbackMime, filename: file.name };
  }
}

/**
 * Stream a log (or screenshot) analysis from the real backend.
 *
 * Sends JSON (not multipart) to avoid Render/WAF 403 "Blocked" pages that
 * frequently trigger on multipart uploads containing log-attack patterns.
 * Images are sent as base64 ``image_data`` so the LangGraph image_analyzer runs.
 */
export async function analyze(
  file: File,
  { onNode, onDone, onError, onDebug }: AnalyzeCallbacks,
  expertise: Expertise[] = [],
): Promise<void> {
  let sawDone = false;
  const url = apiUrl("/api/analyze");
  try {
    const openrouterKey = loadOpenRouterKey();
    if (!openrouterKey) {
      throw new Error(
        "OpenRouter API key missing. Return to login and paste your sk-or-… key so analysis bills your account.",
      );
    }

    const filename = file.name || (isImageFile(file) ? "upload.png" : "upload.log");
    const body: Record<string, string> = {
      filename,
      expertise: expertise.join(","),
      openrouter_api_key: openrouterKey,
    };

    if (isImageFile(file)) {
      const prepared = await prepareImageForUpload(file);
      if (prepared.blob.size > MAX_IMAGE_BYTES) {
        throw new Error(
          `Screenshot too large (${(prepared.blob.size / 1e6).toFixed(1)} MB after compress). ` +
            `Resize to under ${MAX_IMAGE_BYTES / 1e6} MB, then retry.`,
        );
      }
      body.filename = prepared.filename || filename;
      body.image_data = await fileToBase64(prepared.blob);
      body.image_mime = prepared.mime;
      body.image_description = `Operations screenshot upload: ${prepared.filename || filename}`;
      // Classifier needs a non-empty raw_logs string; image path adds issues via image_analyzer.
      body.log_text =
        `[image-upload] ${prepared.filename || filename}\n` +
        "INFO netra: screenshot attached for vision analysis\n";
    } else {
      body.log_text = await file.text();
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "X-OpenRouter-Api-Key": openrouterKey,
      },
      credentials: "same-origin",
      body: JSON.stringify(body),
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

/** Path A — live telemetry buffer only (no LangGraph). What n8n should use. */
export function webhookIngestUrl(): string {
  return `${window.location.origin}/api/webhook/logs`;
}

/** Path B — full LangGraph analysis via webhook (separate from live feed). */
export function webhookAnalyzeUrl(): string {
  return `${window.location.origin}/api/webhook/ingest`;
}

export interface IntegrationStatus {
  jira: "real" | "mock";
  slack: "real" | "mock";
  jira_project?: string;
  slack_channel?: string;
}

export async function fetchIntegrationStatus(): Promise<IntegrationStatus> {
  const res = await fetch(apiUrl("/api/integrations/status"), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Integrations status failed: ${res.status}`);
  const data = (await res.json()) as Partial<IntegrationStatus>;
  return {
    jira: data.jira === "real" ? "real" : "mock",
    slack: data.slack === "real" ? "real" : "mock",
    jira_project: data.jira_project,
    slack_channel: data.slack_channel,
  };
}
