import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseAuditSearchQuery, formatAuditSearchResults } from "./audit-search.js";
import type { AuditEntry } from "./audit-trail.js";

describe("parseAuditSearchQuery", () => {
  it("parses type filter", () => {
    const q = parseAuditSearchQuery("type:auto_complete");
    assert.equal(q.type, "auto_complete");
  });

  it("parses session filter", () => {
    const q = parseAuditSearchQuery("session:adventure");
    assert.equal(q.session, "adventure");
  });

  it("parses keyword filter", () => {
    const q = parseAuditSearchQuery("keyword:budget");
    assert.equal(q.keyword, "budget");
  });

  it("parses limit", () => {
    const q = parseAuditSearchQuery("limit:10");
    assert.equal(q.limit, 10);
  });

  it("parses last duration", () => {
    const q = parseAuditSearchQuery("last:2h");
    assert.ok(q.afterMs);
    const twoHoursAgo = Date.now() - 2 * 3_600_000;
    assert.ok(Math.abs(q.afterMs! - twoHoursAgo) < 1000);
  });

  it("parses multiple filters", () => {
    const q = parseAuditSearchQuery("type:budget_pause session:expensive last:1h limit:5");
    assert.equal(q.type, "budget_pause");
    assert.equal(q.session, "expensive");
    assert.ok(q.afterMs);
    assert.equal(q.limit, 5);
  });

  it("treats bare tokens as keyword", () => {
    const q = parseAuditSearchQuery("some random search");
    assert.ok(q.keyword?.includes("some"));
    assert.ok(q.keyword?.includes("random"));
    assert.ok(q.keyword?.includes("search"));
  });

  it("handles empty input", () => {
    const q = parseAuditSearchQuery("");
    assert.equal(q.type, undefined);
    assert.equal(q.session, undefined);
    assert.equal(q.keyword, undefined);
  });

  it("parses duration strings correctly", () => {
    const q1 = parseAuditSearchQuery("last:30m");
    const q2 = parseAuditSearchQuery("last:1d");
    assert.ok(q1.afterMs);
    assert.ok(q2.afterMs);
    // 30m = ~1.8M ms, 1d = ~86.4M ms
    const diff30m = Date.now() - q1.afterMs!;
    const diff1d = Date.now() - q2.afterMs!;
    assert.ok(diff30m > 29 * 60_000 && diff30m < 31 * 60_000);
    assert.ok(diff1d > 23 * 3_600_000 && diff1d < 25 * 3_600_000);
  });
});

describe("formatAuditSearchResults", () => {
  it("shows no-results message", () => {
    const lines = formatAuditSearchResults([], "type:fake");
    assert.ok(lines[0].includes("no results"));
  });

  it("shows result count and entries", () => {
    const entries: AuditEntry[] = [
      { timestamp: "2026-04-02T12:30:45.000Z", type: "auto_complete", detail: "completed adventure", session: "adventure" },
      { timestamp: "2026-04-02T12:31:00.000Z", type: "budget_pause", detail: "over budget" },
    ];
    const lines = formatAuditSearchResults(entries, "last:1h");
    assert.ok(lines[0].includes("2 result"));
    assert.ok(lines[1].includes("auto_complete"));
    assert.ok(lines[1].includes("adventure"));
    assert.ok(lines[2].includes("budget_pause"));
  });

  it("truncates long detail lines", () => {
    const entries: AuditEntry[] = [
      { timestamp: "2026-04-02T12:30:45.000Z", type: "reasoner_action", detail: "x".repeat(200) },
    ];
    const lines = formatAuditSearchResults(entries, "test");
    assert.ok(lines[1].includes("..."));
  });
});
