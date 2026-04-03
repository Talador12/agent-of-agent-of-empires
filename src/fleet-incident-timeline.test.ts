import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetIncidentTimeline, formatIncidentTimeline } from "./fleet-incident-timeline.js";

describe("FleetIncidentTimeline", () => {
  it("starts empty", () => {
    const t = new FleetIncidentTimeline();
    assert.equal(t.totalCount(), 0);
    assert.equal(t.unresolvedCount(), 0);
  });

  it("records events", () => {
    const t = new FleetIncidentTimeline();
    t.record("alpha", "error", "compile failed");
    t.record("beta", "stuck", "no progress");
    assert.equal(t.totalCount(), 2);
  });

  it("resolves events", () => {
    const t = new FleetIncidentTimeline();
    t.record("alpha", "error", "compile failed");
    assert.equal(t.unresolvedCount(), 1);
    assert.ok(t.resolve("alpha", "error"));
    assert.equal(t.unresolvedCount(), 0);
  });

  it("resolve returns false for no match", () => {
    const t = new FleetIncidentTimeline();
    assert.ok(!t.resolve("nonexistent"));
  });

  it("filters by session", () => {
    const t = new FleetIncidentTimeline();
    t.record("alpha", "error", "err1");
    t.record("beta", "error", "err2");
    t.record("alpha", "recovery", "recovered");
    const filtered = t.getEvents({ sessionTitle: "alpha" });
    assert.equal(filtered.length, 2);
  });

  it("filters by type", () => {
    const t = new FleetIncidentTimeline();
    t.record("a", "error", "e1");
    t.record("a", "recovery", "r1");
    t.record("b", "error", "e2");
    assert.equal(t.getEvents({ type: "error" }).length, 2);
    assert.equal(t.getEvents({ type: "recovery" }).length, 1);
  });

  it("filters unresolved only", () => {
    const t = new FleetIncidentTimeline();
    t.record("a", "error", "e1");
    t.record("b", "error", "e2");
    t.resolve("a", "error");
    assert.equal(t.getEvents({ unresolvedOnly: true }).length, 1);
  });

  it("counts by type", () => {
    const t = new FleetIncidentTimeline();
    t.record("a", "error", "e1");
    t.record("a", "error", "e2");
    t.record("b", "stuck", "s1");
    const counts = t.countByType();
    assert.equal(counts.get("error"), 2);
    assert.equal(counts.get("stuck"), 1);
  });

  it("identifies hot sessions", () => {
    const t = new FleetIncidentTimeline();
    t.record("a", "error", "e1");
    t.record("a", "error", "e2");
    t.record("a", "stuck", "s1");
    t.record("b", "error", "e3");
    const hot = t.hotSessions(2);
    assert.equal(hot[0].sessionTitle, "a");
    assert.equal(hot[0].count, 3);
  });

  it("enforces max events", () => {
    const t = new FleetIncidentTimeline(5);
    for (let i = 0; i < 10; i++) t.record("a", "error", `e${i}`);
    assert.equal(t.totalCount(), 5);
  });

  it("truncates messages to 200 chars", () => {
    const t = new FleetIncidentTimeline();
    t.record("a", "error", "x".repeat(500));
    const events = t.getEvents();
    assert.equal(events[0].message.length, 200);
  });
});

describe("formatIncidentTimeline", () => {
  it("shows no-incidents message when empty", () => {
    const t = new FleetIncidentTimeline();
    const lines = formatIncidentTimeline(t);
    assert.ok(lines.some((l) => l.includes("No incidents")));
  });

  it("shows events and hot sessions", () => {
    const t = new FleetIncidentTimeline();
    t.record("alpha", "error", "compile failed");
    t.record("alpha", "recovery", "fixed");
    t.record("beta", "stuck", "no progress");
    const lines = formatIncidentTimeline(t);
    assert.ok(lines[0].includes("Incident Timeline"));
    assert.ok(lines.some((l) => l.includes("alpha")));
    assert.ok(lines.some((l) => l.includes("Most incidents")));
  });
});
