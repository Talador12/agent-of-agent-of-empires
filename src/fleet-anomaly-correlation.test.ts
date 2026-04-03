import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { correlateAnomalies, hotCorrelationSessions, formatCorrelations } from "./fleet-anomaly-correlation.js";
import type { AnomalyEvent } from "./fleet-anomaly-correlation.js";

function makeEvent(overrides: Partial<AnomalyEvent> = {}): AnomalyEvent {
  return { sessionTitle: "alpha", type: "error", timestamp: 1000, detail: "test", ...overrides };
}

describe("correlateAnomalies", () => {
  it("detects correlated anomalies within time window", () => {
    const events = [
      makeEvent({ sessionTitle: "alpha", timestamp: 1000 }),
      makeEvent({ sessionTitle: "beta", timestamp: 1500 }),
    ];
    const clusters = correlateAnomalies(events, 1000);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].sessions.length, 2);
  });

  it("separates uncorrelated anomalies", () => {
    const events = [
      makeEvent({ sessionTitle: "alpha", timestamp: 1000 }),
      makeEvent({ sessionTitle: "beta", timestamp: 100_000 }),
    ];
    const clusters = correlateAnomalies(events, 1000);
    assert.equal(clusters.length, 0); // each cluster needs 2+ events
  });

  it("identifies fleet-wide same-type anomalies", () => {
    const events = [
      makeEvent({ sessionTitle: "a", type: "error", timestamp: 1000 }),
      makeEvent({ sessionTitle: "b", type: "error", timestamp: 1200 }),
      makeEvent({ sessionTitle: "c", type: "error", timestamp: 1400 }),
    ];
    const clusters = correlateAnomalies(events, 1000);
    assert.ok(clusters.length > 0);
    assert.ok(clusters[0].possibleCause.includes("fleet-wide"));
  });

  it("identifies cascading failures in single session", () => {
    const events = [
      makeEvent({ sessionTitle: "alpha", type: "error", timestamp: 1000 }),
      makeEvent({ sessionTitle: "alpha", type: "stuck", timestamp: 1200 }),
    ];
    const clusters = correlateAnomalies(events, 1000);
    assert.ok(clusters.length > 0);
    assert.ok(clusters[0].possibleCause.includes("cascading"));
  });

  it("handles empty input", () => {
    assert.deepEqual(correlateAnomalies([]), []);
  });

  it("handles single event", () => {
    assert.deepEqual(correlateAnomalies([makeEvent()]), []);
  });

  it("forms multiple clusters", () => {
    const events = [
      makeEvent({ timestamp: 1000 }),
      makeEvent({ sessionTitle: "b", timestamp: 1200 }),
      // gap
      makeEvent({ timestamp: 100_000 }),
      makeEvent({ sessionTitle: "c", timestamp: 100_500 }),
    ];
    const clusters = correlateAnomalies(events, 1000);
    assert.equal(clusters.length, 2);
  });
});

describe("hotCorrelationSessions", () => {
  it("ranks sessions by cluster participation", () => {
    const events = [
      makeEvent({ sessionTitle: "a", timestamp: 1000 }),
      makeEvent({ sessionTitle: "a", timestamp: 1100 }),
      makeEvent({ sessionTitle: "b", timestamp: 1200 }),
    ];
    const clusters = correlateAnomalies(events, 1000);
    const hot = hotCorrelationSessions(clusters);
    assert.ok(hot.length > 0);
  });
});

describe("formatCorrelations", () => {
  it("shows no-anomalies message when empty", () => {
    const lines = formatCorrelations([]);
    assert.ok(lines[0].includes("no correlated"));
  });

  it("shows cluster details", () => {
    const events = [
      makeEvent({ sessionTitle: "alpha", timestamp: 1000 }),
      makeEvent({ sessionTitle: "beta", timestamp: 1200 }),
    ];
    const clusters = correlateAnomalies(events, 1000);
    const lines = formatCorrelations(clusters);
    assert.ok(lines[0].includes("Anomaly Correlation"));
    assert.ok(lines.some((l) => l.includes("Cause")));
  });
});
