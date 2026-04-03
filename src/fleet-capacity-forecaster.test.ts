import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetCapacityForecaster, formatCapacityForecast } from "./fleet-capacity-forecaster.js";

describe("FleetCapacityForecaster", () => {
  it("starts empty", () => {
    const f = new FleetCapacityForecaster();
    assert.equal(f.snapshotCount(), 0);
  });

  it("records snapshots", () => {
    const f = new FleetCapacityForecaster();
    f.record(3, 5, 2, 1.0, 0.5);
    assert.equal(f.snapshotCount(), 1);
  });

  it("enforces max snapshots", () => {
    const f = new FleetCapacityForecaster(3);
    for (let i = 0; i < 5; i++) f.record(i, 5, 0, 1.0, 1.0);
    assert.equal(f.snapshotCount(), 3);
  });

  it("forecasts ok when utilization is low", () => {
    const f = new FleetCapacityForecaster();
    f.record(2, 10, 0, 2.0, 1.0);
    const fc = f.forecast();
    assert.equal(fc.currentUtilization, 20);
    assert.equal(fc.recommendation, "ok");
  });

  it("recommends scale-up when utilization is high", () => {
    const f = new FleetCapacityForecaster();
    f.record(9, 10, 5, 1.0, 2.0);
    const fc = f.forecast();
    assert.equal(fc.currentUtilization, 90);
    assert.equal(fc.recommendation, "scale-up");
  });

  it("recommends critical when pool is exhausted with deep queue", () => {
    const f = new FleetCapacityForecaster();
    f.record(10, 10, 15, 0.5, 3.0);
    const fc = f.forecast();
    assert.equal(fc.currentUtilization, 100);
    assert.equal(fc.recommendation, "critical");
  });

  it("computes growth rate from arrivals - completions", () => {
    const f = new FleetCapacityForecaster();
    f.record(5, 10, 3, 2.0, 4.0); // growing at +2/hr
    const fc = f.forecast();
    assert.ok(fc.queueGrowthRate > 0);
  });

  it("returns null exhaustion ETA when not growing", () => {
    const f = new FleetCapacityForecaster();
    f.record(3, 10, 0, 3.0, 1.0); // shrinking
    const fc = f.forecast();
    assert.equal(fc.exhaustionEtaHours, null);
  });

  it("forecasts empty state as ok", () => {
    const f = new FleetCapacityForecaster();
    const fc = f.forecast();
    assert.equal(fc.recommendation, "ok");
    assert.equal(fc.currentUtilization, 0);
  });

  it("averages over recent snapshots", () => {
    const f = new FleetCapacityForecaster();
    f.record(5, 10, 2, 1.0, 2.0);
    f.record(5, 10, 3, 1.0, 3.0);
    f.record(5, 10, 4, 1.0, 4.0);
    const fc = f.forecast();
    assert.ok(fc.arrivalsPerHour > 2); // averaged
  });
});

describe("formatCapacityForecast", () => {
  it("shows ok status for healthy fleet", () => {
    const f = new FleetCapacityForecaster();
    f.record(2, 10, 0, 2.0, 1.0);
    const lines = formatCapacityForecast(f);
    assert.ok(lines[0].includes("ok"));
  });

  it("shows utilization and queue stats", () => {
    const f = new FleetCapacityForecaster();
    f.record(5, 10, 3, 2.0, 1.5);
    const lines = formatCapacityForecast(f);
    assert.ok(lines.some((l) => l.includes("Utilization")));
    assert.ok(lines.some((l) => l.includes("Queue")));
    assert.ok(lines.some((l) => l.includes("Completions")));
  });

  it("shows exhaustion ETA when growing", () => {
    const f = new FleetCapacityForecaster();
    f.record(8, 10, 5, 1.0, 3.0);
    const lines = formatCapacityForecast(f);
    assert.ok(lines.some((l) => l.includes("Exhaustion") || l.includes("scale-up")));
  });
});
