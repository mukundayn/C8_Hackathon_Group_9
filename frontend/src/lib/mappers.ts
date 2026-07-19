import type {
  AgentId,
  AgentState,
  AnomalyAlert,
  Expertise,
  Issue,
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
  jira: { name: "jira", role: "HITL gate — newly learned criticals await approve" },
  notifier: { name: "notifier", role: "Slack only after HITL-approved Jira tickets" },
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
  update?: Record<string, unknown> | null,
): AgentState[] {
  const stage = NODE_TO_STAGE[nodeName];
  if (!stage) return agents;

  const stageIdx = AGENT_ORDER.indexOf(stage);
  const fallbackIdx = AGENT_ORDER.indexOf("fallback");
  const imageIdx = AGENT_ORDER.indexOf("image_analyzer");
  const cookbookIdx = AGENT_ORDER.indexOf("cookbook");

  // After remediation, mirror backend route_after_remediation (HIT → cookbook).
  const remediations = Array.isArray(update?.remediations)
    ? (update!.remediations as Array<Record<string, unknown>>)
    : null;
  const remediationGoesToFallback =
    nodeName === "remediation" &&
    remediations !== null &&
    remediations.length > 0 &&
    remediations.some(
      (r) =>
        r.kb_status === "miss" ||
        !Array.isArray(r.grounded_in) ||
        (r.grounded_in as unknown[]).length === 0,
    );
  const remediationGoesToCookbook =
    nodeName === "remediation" && remediations !== null && !remediationGoesToFallback;

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

    // Remediation HIT → skip fallback, light cookbook
    if (remediationGoesToCookbook) {
      if (a.id === "fallback") {
        return {
          ...a,
          status: "completed",
          progress: 100,
          message: "Skipped — KB HIT (runbooks already grounded).",
        };
      }
      if (a.id === "cookbook") {
        return {
          ...a,
          status: "active",
          progress: 55,
          message: `${a.name} running…`,
        };
      }
      return a;
    }

    // Remediation MISS → light fallback (learn)
    if (remediationGoesToFallback && a.id === "fallback") {
      return {
        ...a,
        status: "active",
        progress: 55,
        message: `${a.name} running…`,
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
      // Without update payload, don't assume fallback is next after remediation.
      if (nodeName === "remediation" && a.id === "fallback" && remediations === null) {
        return {
          ...a,
          status: "active",
          progress: 40,
          message: `${a.name} or cookbook next…`,
        };
      }
      if (nodeName === "remediation" && a.id === "fallback" && remediationGoesToCookbook) {
        return a;
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

    // Warm cookbook when remediation HIT skipped the linear +1 slot.
    if (remediationGoesToCookbook && idx === cookbookIdx) {
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

/**
 * Deterministic 0–10 threat score from severity + message/category signals.
 * Mirrors ``live_store.compute_threat_index`` — not an LLM score.
 */
export function computeThreatIndex(input: {
  severity: string;
  message?: string;
  category?: string;
  service?: string;
  responseTimeMs?: number;
  confidence?: number;
}): number {
  const severity = normalizeSeverity(input.severity);
  const message = input.message ?? "";
  const service = input.service ?? "";
  const category = normalizeCategory(input.category ?? "System");
  const text = `${message} ${service}`.toLowerCase();

  const base: Record<LogEntry["severity"], number> = {
    CRITICAL: 7.2,
    ERROR: 5.5,
    WARN: 3.0,
    INFO: 1.0,
  };
  const categoryBoost: Record<LogEntry["category"], number> = {
    Database: 0.4,
    Auth: 0.4,
    Network: 0.25,
    System: 0.25,
    API: 0.1,
  };

  let score = base[severity] + categoryBoost[category];

  const impactTiers: { keys: string[]; boost: number }[] = [
    { keys: ["data loss", "breach", "ransomware", "full outage", "customer-facing outage"], boost: 0.9 },
    { keys: ["deadlock", "oomkilled", "oom killed", "pool exhaust", "cascade", "panic", "segfault"], boost: 0.7 },
    { keys: ["crashloop", "unavailable", "flood", "connection refused", "timeout storm"], boost: 0.55 },
    { keys: ["timeout", " 500 ", "http 500", "degraded", "retry storm", "latency spike"], boost: 0.35 },
  ];
  let impact = 0;
  for (const tier of impactTiers) {
    if (tier.keys.some((k) => text.includes(k))) impact = Math.max(impact, tier.boost);
  }
  score += impact;

  const rt = input.responseTimeMs;
  if (typeof rt === "number" && Number.isFinite(rt)) {
    if (rt >= 2000) score += 0.5;
    else if (rt >= 1000) score += 0.3;
    else if (rt >= 500) score += 0.15;
  }

  if (typeof input.confidence === "number" && Number.isFinite(input.confidence)) {
    score += Math.max(0, Math.min(1, input.confidence)) * 0.4;
  }

  let h = 0;
  const slice = text.slice(0, 240);
  for (let i = 0; i < slice.length; i++) {
    h = (h * 33 + slice.charCodeAt(i)) >>> 0;
  }
  score += (h % 21) / 100;

  return Math.round(Math.max(0.5, Math.min(10, score)) * 10) / 10;
}

export function liveEventToLogEntry(ev: LiveEvent): LogEntry {
  const severity = normalizeSeverity(ev.severity);
  const category = normalizeCategory(ev.category);
  const responseTime = ev.response_time_ms ?? 0;
  const threatIndex =
    typeof ev.threat_index === "number" && Number.isFinite(ev.threat_index)
      ? Math.round(Math.max(0.5, Math.min(10, ev.threat_index)) * 10) / 10
      : computeThreatIndex({
          severity,
          message: ev.message,
          category,
          service: ev.service,
          responseTimeMs: responseTime,
        });
  return {
    id: ev.id,
    timestamp: ev.timestamp,
    service: ev.service,
    responseTime,
    severity,
    message: ev.message,
    category,
    userAssigned: ev.source,
    threatIndex,
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
    .map((l): AnomalyAlert => {
      const threatIndex =
        typeof l.threatIndex === "number" && Number.isFinite(l.threatIndex)
          ? l.threatIndex
          : computeThreatIndex({
              severity: l.severity,
              message: l.message,
              category: l.category,
              service: l.service,
              responseTimeMs: l.responseTime,
            });
      return {
        id: `alt-${l.id}`,
        timestamp: l.timestamp,
        logId: l.id,
        severity: l.severity === "CRITICAL" ? "CRITICAL" : "ERROR",
        message: l.message,
        resolved: false,
        service: l.service,
        threatIndex,
        threatSource: "heuristic",
      };
    });
}

function _overlap(a: string, b: string): boolean {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return false;
  if (x.includes(y.slice(0, Math.min(48, y.length))) || y.includes(x.slice(0, Math.min(48, x.length)))) {
    return true;
  }
  const tokens = y.split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
  let hits = 0;
  for (const t of tokens.slice(0, 8)) {
    if (x.includes(t)) hits += 1;
  }
  return hits >= 2;
}

/**
 * After /analyze completes, overlay LLM-refined threat scores onto matching
 * live CRITICAL/ERROR alerts (heuristic stays until then).
 */
export function refineAlertsFromIssues(
  alerts: AnomalyAlert[],
  issues: Issue[],
): AnomalyAlert[] {
  const scored = issues.filter(
    (i) =>
      typeof i.threat_index === "number" &&
      Number.isFinite(i.threat_index) &&
      (i.severity === "critical" || i.severity === "high") &&
      i.threat_index_source === "llm",
  );
  if (!scored.length) return alerts;

  return alerts.map((alert) => {
    if (alert.resolved || alert.hitl) return alert;
    if (alert.severity !== "CRITICAL" && alert.severity !== "ERROR") return alert;

    const match = scored.find((issue) => {
      const evidence = issue.evidence ?? [];
      if (evidence.some((e) => _overlap(alert.message, e))) return true;
      if (issue.title && _overlap(alert.message, issue.title)) return true;
      if (issue.summary && _overlap(alert.message, issue.summary)) return true;
      const svc = (issue.affected_service || "").toLowerCase();
      const asvc = (alert.service || "").toLowerCase();
      return Boolean(svc && asvc && (svc.includes(asvc) || asvc.includes(svc)) && issue.title && _overlap(alert.message, issue.title));
    });
    if (!match || typeof match.threat_index !== "number") return alert;
    return {
      ...alert,
      threatIndex: match.threat_index,
      threatSource: "llm",
    };
  });
}
