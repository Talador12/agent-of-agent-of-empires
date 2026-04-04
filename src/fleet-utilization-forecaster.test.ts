import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetUtilizationForecaster, formatUtilizationForecast } from "./fleet-utilization-forecaster.js";

describe("FleetUtilizationForecaster", () => {
  it("starts empty", () => { assert.equal(new FleetUtilizationForecaster().sampleCount(), 0); });
  it("records samples", () => {
    const f = new FleetUtilizationForecaster();
    f.record(10, 1, 75); f.record(11, 1, 80);
    assert.equal(f.sampleCount(), 2);
  });
  it("forecasts with day-of-week filtering", () => {
    const f = new FleetUtilizationForecaster();
    // record Monday data
    for (let h = 0; h < 24; h++) f.record(h, 1, h < 9 ? 20 : h < 17 ? 80 : 30);
    const fc = f.forecast(1); // Monday
    assert.ok(fc.peakUtilPct > 0);
    assert.ok(fc.confidence > 0);
  });
  it("falls back to all data when insufficient day data", () => {
    const f = new FleetUtilizationForecaster();
    f.record(10, 1, 75);
    const fc = f.forecast(3); // Wednesday, but only Monday data
    assert.ok(fc.predictedHours.length === 24);
  });
  it("returns zero confidence with no data", () => {
    const f = new FleetUtilizationForecaster();
    const fc = f.forecast(1);
    assert.equal(fc.confidence, 0);
  });
  it("identifies peak hour", () => {
    const f = new FleetUtilizationForecaster();
    for (let h = 0; h < 24; h++) f.record(h, 2, h === 14 ? 95 : 30);
    const fc = f.forecast(2);
    assert.equal(fc.peakHour, 14);
  });
  it("computes average", () => {
    const f = new FleetUtilizationForecaster();
    for (let h = 0; h < 24; h++) f.record(h, 3, 50);
    const fc = f.forecast(3);
    assert.equal(fc.avgUtilPct, 50);
  });
  it("enforces max samples", () => {
    const f = new FleetUtilizationForecaster(10);
    for (let i = 0; i < 20; i++) f.record(i % 24, 0, 50);
    assert.equal(f.sampleCount(), 10);
  });
  it("clamps values", () => {
    const f = new FleetUtilizationForecaster();
    f.record(-5, -1, 200);
    assert.equal(f.sampleCount(), 1);
  });
});

describe("formatUtilizationForecast", () => {
  it("shows forecast with sparkline", () => {
    const f = new FleetUtilizationForecaster();
    for (let h = 0; h < 24; h++) f.record(h, 1, 30 + h * 2);
    const lines = formatUtilizationForecast(f, 1);
    assert.ok(lines[0].includes("Utilization Forecast"));
    assert.ok(lines[0].includes("Mon"));
    assert.ok(lines.some((l) => l.includes("Peak")));
  });
});
