import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { listRunbooks, getRunbook, searchRunbooks, formatRunbookList, formatRunbookSteps } from "./fleet-runbook-library.js";

describe("listRunbooks", () => {
  it("returns built-in runbooks", () => {
    const rbs = listRunbooks();
    assert.ok(rbs.length >= 6);
  });
  it("includes user runbooks", () => {
    const custom = [{ id: "custom", name: "Custom", description: "test", category: "maintenance" as const, steps: [], tags: [] }];
    const rbs = listRunbooks(custom);
    assert.ok(rbs.some((r) => r.id === "custom"));
  });
});

describe("getRunbook", () => {
  it("finds built-in by ID", () => {
    const rb = getRunbook("stuck-session");
    assert.ok(rb);
    assert.equal(rb!.id, "stuck-session");
    assert.ok(rb!.steps.length >= 3);
  });
  it("returns null for unknown ID", () => {
    assert.equal(getRunbook("nonexistent"), null);
  });
});

describe("searchRunbooks", () => {
  it("finds by keyword in name", () => {
    const results = searchRunbooks("stuck");
    assert.ok(results.length >= 1);
  });
  it("finds by tag", () => {
    const results = searchRunbooks("cost");
    assert.ok(results.length >= 1);
  });
  it("finds by description", () => {
    const results = searchRunbooks("recovery");
    assert.ok(results.length >= 1);
  });
  it("returns empty for no match", () => {
    assert.equal(searchRunbooks("xyzzy123").length, 0);
  });
});

describe("formatRunbookList", () => {
  it("shows no-runbooks message when empty", () => {
    const lines = formatRunbookList([]);
    assert.ok(lines[0].includes("no runbooks"));
  });
  it("shows runbook list", () => {
    const lines = formatRunbookList(listRunbooks());
    assert.ok(lines[0].includes("Runbook Library"));
    assert.ok(lines.some((l) => l.includes("stuck-session")));
  });
});

describe("formatRunbookSteps", () => {
  it("shows runbook steps", () => {
    const rb = getRunbook("stuck-session")!;
    const lines = formatRunbookSteps(rb);
    assert.ok(lines[0].includes("Stuck Session"));
    assert.ok(lines.some((l) => l.includes("1.")));
    assert.ok(lines.some((l) => l.includes("🤖") || l.includes("👤")));
  });
});
