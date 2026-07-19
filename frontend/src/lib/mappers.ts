import type {
  AgentId,
  AgentState,
  AnomalyAlert,
  Expertise,
  LiveEvent,
  LogEntry,
} from "../types";

// ─── Flow-chart stages (mapped from the real LangGraph nodes) ─────────────────

export const AGENT_ORDER: AgentId[] = [
  "classifier",
  "image_analyzer",
  "remediation",
  "fallback",
  "cookbook",
  "jira",
  "notifier",
];

/** Real graph node name → the flow-chart stage it belongs to. */
const NODE_TO_STAGE: Record<string, AgentId> = {
  classifier: "classifier",
  image_analyzer: "image_analyzer",
  remediation: "remediation",
  fallback: "fallback",
  cookbook: "cookbook",
  jira: "jira",
  notifier: "notifier",
};

const AGENT_META: Record<AgentId, { name: string; role: string; optional?: boolean }> = {
  classifier: { name: "classifier", role: "Parse & cluster logs, detect root-cause issues" },
  image_analyzer: {
    name: "image_analyzer",
    role: "Optional — vision path when image payload present",
    optional: true,
  },
  remediation: { name: "remediation", role: "RAG lookup — KB HIT grounds fixes in runbooks" },
  fallback: {
    name: "fallback",
    role: "KB MISS — learn into Chroma for future retrieval",
  },
  cookbook: { name: "cookbook", role: "Assemble an actionable incident checklist" },
  jira: { name: "jira", role: "File & route tickets for critical/high issues" },
  notifier: { name: "notifier", role: "Post the incident summary (mock Slack)" },
};

export function initialAgents(): AgentState[] {
  return AGENT_ORDER.map(
    (id): AgentState => ({
      id,
      name: AGENT_META[id].name,
      role: AGENT_META[id].role,
      status: "idle",
      progress: 0,
      message: AGENT_META[id].optional
        ? "Optional — skipped unless image input."
        : `Standby — ${AGENT_META[id].role}.`,
      optional: AGENT_META[id].optional,
    }),
  );
}

export function overallProgress(agents: AgentState[]): number {
  if (agents.length === 0) return 0;
  const done = agents.filter((a) => a.status === "completed").length;
  const active = agents.some((a) => a.status === "active") ? 0.5 : 0;
  return Math.min(100, Math.round(((done + active) / agents.length) * 100));
}

/**
 * Fold an incoming `node` SSE event into the agent list.
 *
 * LangGraph streams updates AFTER each node finishes, so receiving an event
 * for a stage means that stage just completed; we then light up the next stage.
 */
export function applyNodeEvent(
  agents: AgentState[],
  nodeName: string,
  message?: string,
): AgentState[] {
  const stage = NODE_TO_STAGE[nodeName];
  if (!stage) return agents;

  const stageIdx = AGENT_ORDER.indexOf(stage);
  const fallbackIdx = AGENT_ORDER.indexOf("fallback");
  const imageIdx = AGENT_ORDER.indexOf("image_analyzer");

  return agents.map((a): AgentState => {
    const idx = AGENT_ORDER.indexOf(a.id);

    if (idx < stageIdx) {
      // KB HIT skips fallback
      if (a.id === "fallback" && nodeName !== "fallback" && stageIdx > fallbackIdx) {
        return {
          ...a,
          status: "completed",
          progress: 100,
          message: "Skipped — KB HIT (runbooks already grounded).",
        };
      }
      // No image branch — mark dashed node skipped when we jump to remediation+
      if (
        a.id === "image_analyzer" &&
        nodeName !== "image_analyzer" &&
        stageIdx > imageIdx &&
        a.status !== "completed"
      ) {
        return {
          ...a,
          status: "completed",
          progress: 100,
          message: "Skipped — no image input (optional edge).",
        };
      }
      // Non-critical path skips jira
      if (a.id === "jira" && nodeName === "notifier") {
        return {
          ...a,
          status: "completed",
          progress: 100,
          message: "Skipped — no critical/high severity (route_by_severity).",
        };
      }
      return { ...a, status: "completed", progress: 100 };
    }

    if (idx === stageIdx) {
      return {
        ...a,
        status: "completed",
        progress: 100,
        message: message ?? `${a.name} complete.`,
      };
    }

    // Activate the next primary successor (linear heuristic for "running…" cue).
    // Graph UI also paints edges; this keeps MetricGauges / progress alive.
    if (idx === stageIdx + 1) {
      // After classifier, prefer highlighting remediation (main path); image stays optional idle
      // unless the event was image_analyzer.
      if (nodeName === "classifier" && a.id === "image_analyzer") {
        return a;
      }
      if (nodeName === "classifier" && a.id === "remediation") {
        return {
          ...a,
          status: "active",
          progress: 55,
          message: `${a.name} running…`,
        };
      }
      return {
        ...a,
        status: "active",
        progress: 55,
        message: `${a.name} running…`,
      };
    }

    // classifier → also warm remediation when image_analyzer is the +1 slot
    if (nodeName === "classifier" && a.id === "remediation") {
      return {
        ...a,
        status: "active",
        progress: 40,
        message: `${a.name} running… (or waiting on image branch)`,
      };
    }

    return a;
  });
}

/** Mark every stage complete once the `done` event lands. */
export function finalizeAgents(agents: AgentState[]): AgentState[] {
  return agents.map((a): AgentState => {
    if (a.status === "completed") {
      return a;
    }
    if (a.optional) {
      return {
        ...a,
        status: "completed",
        progress: 100,
        message: a.message.startsWith("Skipped")
          ? a.message
          : "Skipped — no image input (optional edge).",
      };
    }
    if (a.id === "jira" && a.status === "idle") {
      return {
        ...a,
        status: "completed",
        progress: 100,
        message: "Skipped — no critical/high severity.",
      };
    }
    if (a.id === "fallback") {
      return {
        ...a,
        status: "completed",
        progress: 100,
        message: "Skipped — KB HIT path.",
      };
    }
    return { ...a, status: "completed", progress: 100, message: a.message || `${a.name} complete.` };
  });
}

// ─── Live telemetry normalization ─────────────────────────────────────────────

const KNOWN_CATEGORIES: LogEntry["category"][] = [
  "API",
  "Database",
  "Auth",
  "Network",
  "System",
];

function normalizeSeverity(raw: string): LogEntry["severity"] {
  const s = (raw || "").toUpperCase();
  if (s.includes("CRIT") || s.includes("FATAL") || s.includes("PANIC")) return "CRITICAL";
  if (s.includes("ERR") || s.includes("FAIL")) return "ERROR";
  if (s.includes("WARN")) return "WARN";
  return "INFO";
}

function normalizeCategory(raw: string): LogEntry["category"] {
  const match = KNOWN_CATEGORIES.find((c) => c.toLowerCase() === (raw || "").toLowerCase());
  return match ?? "System";
}

export function liveEventToLogEntry(ev: LiveEvent): LogEntry {
  return {
    id: ev.id,
    timestamp: ev.timestamp,
    service: ev.service,
    responseTime: ev.response_time_ms ?? 0,
    severity: normalizeSeverity(ev.severity),
    message: ev.message,
    category: normalizeCategory(ev.category),
    userAssigned: ev.source,
  };
}

/** Category / message heuristics → operator expertise domain (mirrors backend). */
export function categoryToExpertise(
  category?: string,
  message?: string,
  service?: string,
): Expertise {
  const cat = (category || "").toLowerCase();
  const msg = (message || "").toLowerCase();
  const serv = (service || "").toLowerCase();

  if (cat === "database" || cat.includes("db") || serv.includes("postgres") || serv.includes("database")) {
    return "DB";
  }
  if (cat === "network" || cat === "auth" || serv.includes("waf") || serv.includes("firewall") || serv.includes("auth")) {
    return "Network";
  }
  if (msg.includes("oom") || msg.includes("memory") || msg.includes("heap") || msg.includes("leak") || serv.includes("kube")) {
    return "Memory";
  }
  if (msg.includes("cpu") || msg.includes("thread") || msg.includes("load") || msg.includes("capacity")) {
    return "CPU";
  }
  return "General";
}

/** Derive floating alerts from high-severity live logs. */
export function alertsFromLogs(logs: LogEntry[]): AnomalyAlert[] {
  return logs
    .filter((l) => l.severity === "CRITICAL" || l.severity === "ERROR")
    .map(
      (l): AnomalyAlert => ({
        id: `alt-${l.id}`,
        timestamp: l.timestamp,
        logId: l.id,
        severity: l.severity === "CRITICAL" ? "CRITICAL" : "ERROR",
        message: l.message,
        resolved: false,
        service: l.service,
        threatIndex: l.severity === "CRITICAL" ? 9.1 : 7.8,
      }),
    );
}
