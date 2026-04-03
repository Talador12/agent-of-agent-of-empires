import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateHtmlReport, buildReportData } from "./fleet-export.js";
import type { DaemonSessionState, TaskState } from "./types.js";

function makeSessions(): DaemonSessionState[] {
  return [
    { id: "1", title: "adventure", tool: "opencode", status: "working", costStr: "$5.00" },
    { id: "2", title: "code-music", tool: "opencode", status: "idle" },
  ];
}

function makeTasks(): TaskState[] {
  return [
    { repo: "test/adventure", sessionTitle: "adventure", sessionMode: "auto", tool: "opencode", goal: "implement auth", status: "active", progress: [{ at: Date.now(), summary: "started" }], createdAt: Date.now() - 3_600_000 },
    { repo: "test/music", sessionTitle: "code-music", sessionMode: "auto", tool: "opencode", goal: "add synth", status: "completed", progress: [], createdAt: Date.now() - 7_200_000, completedAt: Date.now() - 3_600_000 },
  ];
}

describe("buildReportData", () => {
  it("computes fleet health and cost", () => {
    const data = buildReportData(makeSessions(), makeTasks(), "v0.209.0");
    assert.ok(data.fleetHealth > 0);
    assert.equal(data.totalCostUsd, 5);
    assert.equal(data.activeSessions, 1);
    assert.equal(data.completedTasks, 1);
    assert.equal(data.version, "v0.209.0");
  });

  it("handles empty state", () => {
    const data = buildReportData([], [], "v0.209.0");
    assert.equal(data.sessions.length, 0);
    assert.equal(data.fleetHealth, 100);
  });
});

describe("generateHtmlReport", () => {
  it("generates valid HTML", () => {
    const data = buildReportData(makeSessions(), makeTasks(), "v0.209.0");
    const html = generateHtmlReport(data);
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("</html>"));
    assert.ok(html.includes("aoaoe Fleet Report"));
  });

  it("includes session data", () => {
    const data = buildReportData(makeSessions(), makeTasks(), "v0.209.0");
    const html = generateHtmlReport(data);
    assert.ok(html.includes("adventure"));
    assert.ok(html.includes("code-music"));
    assert.ok(html.includes("$5.00"));
  });

  it("includes task data", () => {
    const data = buildReportData(makeSessions(), makeTasks(), "v0.209.0");
    const html = generateHtmlReport(data);
    assert.ok(html.includes("implement auth"));
    assert.ok(html.includes("add synth"));
  });

  it("escapes HTML in session titles", () => {
    const sessions: DaemonSessionState[] = [{ id: "1", title: "<script>alert(1)</script>", tool: "opencode", status: "idle" }];
    const data = buildReportData(sessions, [], "v0.209.0");
    const html = generateHtmlReport(data);
    assert.ok(!html.includes("<script>alert"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("includes fleet health and cost summary", () => {
    const data = buildReportData(makeSessions(), makeTasks(), "v0.209.0");
    const html = generateHtmlReport(data);
    assert.ok(html.includes("/100")); // health
    assert.ok(html.includes("$5.00")); // cost
  });
});
