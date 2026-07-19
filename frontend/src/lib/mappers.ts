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
  "remediation",
  "cookbook",
  "jira",
  "notifier",
];

/** Real graph node name → the flow-chart stage it belongs to. */
const NODE_TO_STAGE: Record<string, AgentId> = {
  classifier: "classifier",
  image_analyzer: "remediation",
  remediation: "remediation",
  fallback: "cookbook",
  cookbook: "cookbook",
  jira: "jira",
  notifier: "notifier",
};

const AGENT_META: Record<AgentId, { name: string; role: string }> = {
  classifier: { name: "Log Classifier", role: "Parse & cluster logs, detect root-cause issues" },
  remediation: { name: "Remediator", role: "RAG-grounded fixes from the runbook knowledge base" },
  cookbook: { name: "Cookbook Builder", role: "Assemble an actionable incident checklist" },
  jira: { name: "Jira Integrator", role: "File & route tickets for critical issues" },
  notifier: { name: "Slack Notifier", role: "Post the incident summary to the channel" },
};

export function initialAgents(): AgentState[] {
  return AGENT_ORDER.map(
    (id): AgentState => ({
      id,
      name: AGENT_META[id].name,
      role: AGENT_META[id].role,
      status: "idle",
      progress: 0,
      message: `Standby — ${AGENT_META[id].role}.`,
    }),
  );
}

export function overallProgress(agents: AgentState[]): number {
  const done = agents.filter((a) => a.status === "completed").length;
  const active = agents.some((a) => a.status === "active") ? 0.5 : 0;
  return Math.round(((done + active) / agents.length) * 100);
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
  return agents.map((a): AgentState => {
    const idx = AGENT_ORDER.indexOf(a.id);
    if (idx < stageIdx) return { ...a, status: "completed", progress: 100 };
    if (idx === stageIdx) {
      return {
        ...a,
        status: "completed",
        progress: 100,
        message: message ?? `${a.name} complete.`,
      };
    }
    if (idx === stageIdx + 1) {
      return {
        ...a,
        status: "active",
        progress: 55,
        message: `${a.name} running…`,
      };
    }
    return a;
  });
}

/** Mark every stage complete once the `done` event lands. */
export function finalizeAgents(agents: AgentState[]): AgentState[] {
  return agents.map((a): AgentState => ({ ...a, status: "completed", progress: 100 }));
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
