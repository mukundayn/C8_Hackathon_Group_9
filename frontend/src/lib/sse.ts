// Robust SSE frame parser shared by the analyze stream reader.
// sse-starlette emits CRLF (\r\n); we normalize so \n\n frame splits work.

export interface SseFrame {
  evt: string | undefined;
  data: unknown;
}

export function parseSseFrames(buffer: string): { events: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = normalized.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: SseFrame[] = [];
  for (const frame of frames) {
    if (!frame.trim()) continue;
    const evt = frame.match(/^event: (.*)$/m)?.[1]?.trim();
    const data = frame.match(/^data: (.*)$/m)?.[1];
    if (!data) continue;
    events.push({ evt, data: JSON.parse(data) as unknown });
  }
  return { events, rest };
}
