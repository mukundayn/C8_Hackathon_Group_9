import { describe, it, expect } from "vitest";
import { parseSseFrames } from "./sse";

describe("parseSseFrames", () => {
  it("parses complete node + done frames", () => {
    const buf =
      'event: node\ndata: {"node":"classifier","update":{"trace":[]}}\n\n' +
      'event: done\ndata: {"issues":[]}\n\n';
    const { events, rest } = parseSseFrames(buf);
    expect(rest).toBe("");
    expect(events).toHaveLength(2);
    expect(events[0].evt).toBe("node");
    expect((events[0].data as { node: string }).node).toBe("classifier");
    expect(events[1].evt).toBe("done");
  });

  it("normalizes CRLF line endings from sse-starlette", () => {
    const buf = 'event: node\r\ndata: {"node":"jira"}\r\n\r\n';
    const { events } = parseSseFrames(buf);
    expect(events).toHaveLength(1);
    expect((events[0].data as { node: string }).node).toBe("jira");
  });

  it("keeps a partial trailing frame in rest", () => {
    const buf = 'event: node\ndata: {"node":"a"}\n\nevent: node\ndata: {"nod';
    const { events, rest } = parseSseFrames(buf);
    expect(events).toHaveLength(1);
    expect(rest).toContain('data: {"nod');
  });

  it("ignores frames without a data line", () => {
    const buf = "event: ping\n\n";
    const { events } = parseSseFrames(buf);
    expect(events).toHaveLength(0);
  });
});
