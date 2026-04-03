import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatReplay, summarizeReplay } from "./session-replay.js";
import type { SessionReplay } from "./session-replay.js";

function makeReplay(events: Array<{ type: string; detail: string; offset: number }>): SessionReplay {
  const base = Date.now() - 3_600_000;
  return {
    sessionTitle: "test-session",
    events: events.map((e) => ({
      timestamp: base + e.offset,
      timeLabel: new Date(base + e.offset).toISOString().slice(11, 19),
      type: e.type,
      detail: e.detail,
    })),
    totalDurationMs: events.length > 0 ? events[events.length - 1].offset - events[0].offset : 0,
    eventCount: events.length,
  };
}

describe("formatReplay", () => {
  it("handles empty replay", () => {
    const replay = makeReplay([]);
    const lines = formatReplay(replay);
    assert.ok(lines[0].includes("No replay data"));
  });

  it("formats events chronologically", () => {
    const replay = makeReplay([
      { type: "daemon_start", detail: "started", offset: 0 },
      { type: "reasoner_action", detail: "sent nudge", offset: 60_000 },
      { type: "auto_complete", detail: "task done", offset: 120_000 },
    ]);
    const lines = formatReplay(replay);
    assert.ok(lines[0].includes("test-session"));
    assert.ok(lines[0].includes("3 events"));
    assert.ok(lines.some((l) => l.includes("daemon_start")));
    assert.ok(lines.some((l) => l.includes("auto_complete")));
  });

  it("shows time gaps between events", () => {
    const replay = makeReplay([
      { type: "daemon_start", detail: "started", offset: 0 },
      { type: "auto_complete", detail: "done", offset: 300_000 }, // 5min gap
    ]);
    const lines = formatReplay(replay);
    assert.ok(lines.some((l) => l.includes("later")));
  });
});

describe("summarizeReplay", () => {
  it("handles empty replay", () => {
    const replay = makeReplay([]);
    const lines = summarizeReplay(replay);
    assert.ok(lines[0].includes("no events"));
  });

  it("counts events by type", () => {
    const replay = makeReplay([
      { type: "reasoner_action", detail: "a", offset: 0 },
      { type: "reasoner_action", detail: "b", offset: 10_000 },
      { type: "auto_complete", detail: "c", offset: 20_000 },
    ]);
    const lines = summarizeReplay(replay);
    assert.ok(lines.some((l) => l.includes("reasoner_action") && l.includes("2")));
    assert.ok(lines.some((l) => l.includes("auto_complete") && l.includes("1")));
  });
});
