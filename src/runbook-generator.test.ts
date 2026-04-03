import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatGeneratedRunbooks } from "./runbook-generator.js";
import type { GeneratedRunbook } from "./runbook-generator.js";

describe("formatGeneratedRunbooks", () => {
  it("handles empty runbooks", () => {
    const lines = formatGeneratedRunbooks([]);
    assert.ok(lines[0].includes("insufficient"));
  });

  it("formats runbook with steps", () => {
    const runbooks: GeneratedRunbook[] = [{
      title: "Stuck Session Recovery",
      scenario: "Session stuck for >30min",
      steps: [
        { action: "stuck_nudge", detail: "nudged session", frequency: 5 },
        { action: "session_restart", detail: "restarted", frequency: 2 },
      ],
      basedOnEvents: 7,
      confidence: "medium",
    }];
    const lines = formatGeneratedRunbooks(runbooks);
    assert.ok(lines.some((l) => l.includes("Stuck Session")));
    assert.ok(lines.some((l) => l.includes("stuck_nudge")));
    assert.ok(lines.some((l) => l.includes("7 events")));
  });
});
