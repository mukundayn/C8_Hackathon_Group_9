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
} from "./mappers";
import type { LiveEvent } from "../types";

describe("flow-chart mappers", () => {
  it("starts with 5 idle agents in canonical order", () => {
    const agents = initialAgents();
    expect(agents.map((a) => a.id)).toEqual(AGENT_ORDER);
    expect(agents.every((a) => a.status === "idle")).toBe(true);
  });

  it("completes a stage and activates the next on a node event", () => {
    let agents = initialAgents();
    agents = applyNodeEvent(agents, "classifier", "done");
    expect(agents[0].status).toBe("completed");
    expect(agents[1].status).toBe("active");
  });

  it("folds conditional image_analyzer into the remediation stage", () => {
    let agents = initialAgents();
    agents = applyNodeEvent(agents, "image_analyzer");
    const remediation = agents.find((a) => a.id === "remediation");
    expect(remediation?.status).toBe("completed");
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
  it("falls back to General", () => {
    expect(categoryToExpertise("API", "routine request")).toBe("General");
  });
});
