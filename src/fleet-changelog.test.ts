import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatChangelog } from "./fleet-changelog.js";

describe("formatChangelog", () => {
  it("handles empty", () => {
    const lines = formatChangelog([]);
    assert.ok(lines[0].includes("no events"));
  });
  it("shows entries", () => {
    const entries = [
      { time: "12:30:00", summary: "[auto_complete] adventure: done" },
      { time: "12:31:00", summary: "[reasoner_action] sent nudge" },
    ];
    const lines = formatChangelog(entries, "last 1h");
    assert.ok(lines[0].includes("last 1h"));
    assert.ok(lines[0].includes("2 events"));
    assert.ok(lines.some((l) => l.includes("auto_complete")));
  });
});
