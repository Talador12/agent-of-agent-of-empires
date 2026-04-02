import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { formatAuditEntries, formatAuditStats } from "./audit-trail.js";
import type { AuditEntry } from "./audit-trail.js";

// test only the pure formatting functions — file I/O is tested via integration

describe("formatAuditEntries", () => {
  it("returns placeholder for empty entries", () => {
    const result = formatAuditEntries([]);
    assert.equal(result.length, 1);
    assert.ok(result[0].includes("no audit entries"));
  });

  it("formats entries with time, type, and detail", () => {
    const entries: AuditEntry[] = [
      { timestamp: "2026-04-02T12:30:45.000Z", type: "reasoner_action", detail: "sent input to adventure", session: "adventure" },
      { timestamp: "2026-04-02T12:31:00.000Z", type: "auto_complete", detail: "auto-completed code-music" },
    ];
    const result = formatAuditEntries(entries);
    assert.equal(result.length, 2);
    assert.ok(result[0].includes("12:30:45"));
    assert.ok(result[0].includes("reasoner_action"));
    assert.ok(result[0].includes("adventure"));
    assert.ok(result[1].includes("auto_complete"));
  });

  it("truncates long details", () => {
    const entries: AuditEntry[] = [
      { timestamp: "2026-04-02T12:30:45.000Z", type: "operator_command", detail: "a".repeat(200) },
    ];
    const result = formatAuditEntries(entries, 80);
    assert.ok(result[0].includes("..."));
  });

  it("includes session tag when present", () => {
    const entries: AuditEntry[] = [
      { timestamp: "2026-04-02T12:30:45.000Z", type: "budget_pause", detail: "over budget", session: "expensive-session" },
    ];
    const result = formatAuditEntries(entries);
    assert.ok(result[0].includes("[expensive-session]"));
  });

  it("omits session tag when absent", () => {
    const entries: AuditEntry[] = [
      { timestamp: "2026-04-02T12:30:45.000Z", type: "daemon_start", detail: "daemon started" },
    ];
    const result = formatAuditEntries(entries);
    assert.ok(!result[0].includes("["));
  });
});

describe("formatAuditStats", () => {
  it("returns placeholder for empty stats", () => {
    const result = formatAuditStats({});
    assert.equal(result.length, 1);
    assert.ok(result[0].includes("no audit data"));
  });

  it("formats stats sorted by count descending", () => {
    const stats = { reasoner_action: 50, auto_complete: 3, budget_pause: 1 };
    const result = formatAuditStats(stats);
    assert.equal(result.length, 3);
    assert.ok(result[0].includes("reasoner_action"));
    assert.ok(result[0].includes("50"));
    assert.ok(result[2].includes("budget_pause"));
  });
});
