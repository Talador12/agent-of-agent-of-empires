import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetCostTrend, formatCostTrend } from "./fleet-cost-trend.js";

describe("FleetCostTrend", () => {
  it("starts empty", () => { assert.equal(new FleetCostTrend().dayCount(), 0); });
  it("records daily snapshots", () => {
    const t = new FleetCostTrend();
    t.recordDay("2026-04-01", 10); t.recordDay("2026-04-02", 12);
    assert.equal(t.dayCount(), 2);
  });
  it("replaces same-date snapshot", () => {
    const t = new FleetCostTrend();
    t.recordDay("2026-04-01", 10); t.recordDay("2026-04-01", 15);
    assert.equal(t.dayCount(), 1);
  });
  it("computes trend direction increasing", () => {
    const t = new FleetCostTrend();
    for (let i = 0; i < 7; i++) t.recordDay(`2026-03-${String(15 + i).padStart(2, "0")}`, 5);
    for (let i = 0; i < 7; i++) t.recordDay(`2026-03-${String(22 + i).padStart(2, "0")}`, 15);
    assert.equal(t.computeTrend().direction, "increasing");
  });
  it("computes trend direction decreasing", () => {
    const t = new FleetCostTrend();
    for (let i = 0; i < 7; i++) t.recordDay(`2026-03-${String(15 + i).padStart(2, "0")}`, 20);
    for (let i = 0; i < 7; i++) t.recordDay(`2026-03-${String(22 + i).padStart(2, "0")}`, 8);
    assert.equal(t.computeTrend().direction, "decreasing");
  });
  it("computes stable for similar weeks", () => {
    const t = new FleetCostTrend();
    for (let i = 0; i < 14; i++) t.recordDay(`2026-03-${String(15 + i).padStart(2, "0")}`, 10);
    assert.equal(t.computeTrend().direction, "stable");
  });
  it("projects weekly and monthly costs", () => {
    const t = new FleetCostTrend();
    for (let i = 0; i < 7; i++) t.recordDay(`2026-04-0${i + 1}`, 10);
    const trend = t.computeTrend();
    assert.equal(trend.projectedWeeklyCost, 70);
    assert.equal(trend.projectedMonthlyCost, 300);
  });
  it("produces sparkline", () => {
    const t = new FleetCostTrend();
    for (let i = 0; i < 5; i++) t.recordDay(`2026-04-0${i + 1}`, 5 + i * 3);
    assert.ok(t.sparkline().length > 0);
  });
  it("enforces max days", () => {
    const t = new FleetCostTrend(5);
    for (let i = 0; i < 10; i++) t.recordDay(`2026-04-${String(i + 1).padStart(2, "0")}`, 10);
    assert.equal(t.dayCount(), 5);
  });
});

describe("formatCostTrend", () => {
  it("shows trend with projection", () => {
    const t = new FleetCostTrend();
    for (let i = 0; i < 7; i++) t.recordDay(`2026-04-0${i + 1}`, 10 + i);
    const lines = formatCostTrend(t);
    assert.ok(lines[0].includes("Cost Trend"));
    assert.ok(lines.some((l) => l.includes("Projected")));
  });
});
