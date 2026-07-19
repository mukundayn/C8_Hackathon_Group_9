import { describe, it, expect } from "vitest";
import {
  AGENT_ORDER,
  initialAgents,
  applyNodeEvent,
  finalizeAgents,
  overallProgress,
  liveEventToLogEntry,
  categoryToExpertise,
  alertsFromLogs,
  computeThreatIndex,
  refineAlertsFromIssues,
} from "./mappers";
import type { Issue, LiveEvent } from "../types";

describe("flow-chart mappers", () => {
  it("starts with idle agents including optional image_analyzer", () => {
    const agents = initialAgents();
    expect(agents.map((a) => a.id)).toEqual(AGENT_ORDER);
    expect(AGENT_ORDER).toContain("image_analyzer");
    expect(AGENT_ORDER).toContain("fallback");
    expect(agents.find((a) => a.id === "image_analyzer")?.optional).toBe(true);
    expect(agents.every((a) => a.status === "idle")).toBe(true);
  });

  it("completes classifier and activates remediation (main path)", () => {
    let agents = initialAgents();
    agents = applyNodeEvent(agents, "classifier", "done");
    expect(agents.find((a) => a.id === "classifier")?.status).toBe("completed");
    expect(agents.find((a) => a.id === "remediation")?.status).toBe("active");
  });

  it("marks image_analyzer completed when that node emits", () => {
    let agents = initialAgents();
    agents = applyNodeEvent(agents, "classifier");
    agents = applyNodeEvent(agents, "image_analyzer");
    expect(agents.find((a) => a.id === "image_analyzer")?.status).toBe("completed");
  });

  it("skips dashed image_analyzer when remediation runs without it", () => {
    let agents = initialAgents();
    agents = applyNodeEvent(agents, "classifier");
    agents = applyNodeEvent(agents, "remediation", "done", {
      remediations: [{ issue_id: "a", kb_status: "hit", grounded_in: ["rb"] }],
    });
    const img = agents.find((a) => a.id === "image_analyzer");
    expect(img?.status).toBe("completed");
    expect(img?.message).toMatch(/Skipped|optional/i);
  });

  it("on KB HIT after remediation: skips fallback and activates cookbook", () => {
    let agents = initialAgents();
    agents = applyNodeEvent(agents, "classifier");
    agents = applyNodeEvent(agents, "remediation", "HIT", {
      remediations: [
        { issue_id: "a", kb_status: "hit", grounded_in: ["Pool runbook"] },
        { issue_id: "b", kb_status: "hit", grounded_in: ["Pool runbook"] },
      ],
    });
    expect(agents.find((a) => a.id === "fallback")?.status).toBe("completed");
    expect(agents.find((a) => a.id === "fallback")?.message).toMatch(/Skipped|KB HIT/i);
    expect(agents.find((a) => a.id === "cookbook")?.status).toBe("active");
  });

  it("on KB MISS after remediation: activates fallback", () => {
    let agents = initialAgents();
    agents = applyNodeEvent(agents, "remediation", "MISS", {
      remediations: [{ issue_id: "a", kb_status: "miss", grounded_in: [] }],
    });
    expect(agents.find((a) => a.id === "fallback")?.status).toBe("active");
  });

  it("marks KB Learn skipped when cookbook runs after a KB HIT", () => {
    let agents = initialAgents();
    agents = applyNodeEvent(agents, "classifier");
    agents = applyNodeEvent(agents, "remediation", "done", {
      remediations: [{ issue_id: "a", kb_status: "hit", grounded_in: ["rb"] }],
    });
    agents = applyNodeEvent(agents, "cookbook");
    const learn = agents.find((a) => a.id === "fallback");
    expect(learn?.status).toBe("completed");
    expect(learn?.message).toMatch(/Skipped|KB HIT/i);
  });

  it("ignores unknown node names", () => {
    const agents = initialAgents();
    expect(applyNodeEvent(agents, "totally_unknown")).toEqual(agents);
  });

  it("finalize marks everything complete → 100%", () => {
    const agents = finalizeAgents(initialAgents());
    expect(overallProgress(agents)).toBe(100);
  });
});

describe("live event normalization", () => {
  const base: LiveEvent = {
    id: "e1",
    timestamp: "10:00:00",
    service: "database-service",
    severity: "critical",
    message: "PostgreSQL connection pool exhausted",
    category: "database",
    source: "datadog",
    response_time_ms: 1200,
  };

  it("maps severity + category + response time", () => {
    const log = liveEventToLogEntry(base);
    expect(log.severity).toBe("CRITICAL");
    expect(log.category).toBe("Database");
    expect(log.responseTime).toBe(1200);
  });

  it("derives alerts only from ERROR/CRITICAL logs", () => {
    const logs = [liveEventToLogEntry(base), liveEventToLogEntry({ ...base, id: "e2", severity: "info" })];
    expect(alertsFromLogs(logs)).toHaveLength(1);
  });

  it("scores threats from signals, not fixed CRITICAL=9.1 / ERROR=7.8", () => {
    const criticalDeadlock = computeThreatIndex({
      severity: "CRITICAL",
      message: "PostgreSQL deadlock detected on orders table",
      category: "Database",
      service: "database-service",
      responseTimeMs: 1200,
    });
    const errorGeneric = computeThreatIndex({
      severity: "ERROR",
      message: "Failed to parse optional cache header",
      category: "API",
      service: "api-gateway",
      responseTimeMs: 40,
    });
    expect(criticalDeadlock).toBeGreaterThan(errorGeneric);
    expect(criticalDeadlock).toBeGreaterThan(7.5);
    expect(errorGeneric).toBeLessThan(7.5);
    // Deterministic for the same inputs
    expect(
      computeThreatIndex({
        severity: "CRITICAL",
        message: "PostgreSQL deadlock detected on orders table",
        category: "Database",
        service: "database-service",
        responseTimeMs: 1200,
      }),
    ).toBe(criticalDeadlock);
  });

  it("uses backend threat_index when present on the live event", () => {
    const log = liveEventToLogEntry({ ...base, threat_index: 8.3 });
    expect(log.threatIndex).toBe(8.3);
    expect(alertsFromLogs([log])[0]?.threatIndex).toBe(8.3);
  });

  it("overlays LLM issue scores onto matching live alerts after analyze", () => {
    const alerts = alertsFromLogs([
      liveEventToLogEntry({
        ...base,
        id: "e-deadlock",
        message: "CRITICAL database: PostgreSQL deadlock detected on orders",
      }),
    ]);
    const issues: Issue[] = [
      {
        id: "db-deadlock",
        title: "PostgreSQL deadlock",
        severity: "critical",
        affected_service: "database-service",
        summary: "Deadlock on orders",
        evidence: ["CRITICAL database: PostgreSQL deadlock detected on orders"],
        threat_index: 9.2,
        threat_index_source: "llm",
      },
    ];
    const refined = refineAlertsFromIssues(alerts, issues);
    expect(refined[0]?.threatIndex).toBe(9.2);
    expect(refined[0]?.threatSource).toBe("llm");
  });
});

describe("categoryToExpertise", () => {
  it("routes database → DB", () => {
    expect(categoryToExpertise("Database")).toBe("DB");
  });
  it("routes auth/network → Network", () => {
    expect(categoryToExpertise("Auth")).toBe("Network");
  });
  it("detects memory pressure from message text", () => {
    expect(categoryToExpertise("System", "container OOMKilled, heap exhausted")).toBe("Memory");
  });
});
