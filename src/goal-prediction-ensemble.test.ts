import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ensemblePredict, buildPredictionMethods, formatEnsemblePredictions } from "./goal-prediction-ensemble.js";

describe("ensemblePredict", () => {
  it("computes weighted average ETA", () => {
    const p = ensemblePredict("a", [
      { name: "linear", etaHours: 4, confidence: 60 },
      { name: "velocity", etaHours: 3, confidence: 70 },
    ]);
    assert.ok(p.ensembleEtaHours !== null);
    assert.ok(p.ensembleEtaHours! > 3 && p.ensembleEtaHours! < 4);
  });
  it("returns null for no valid methods", () => {
    const p = ensemblePredict("a", [{ name: "x", etaHours: null, confidence: 0 }]);
    assert.equal(p.ensembleEtaHours, null);
  });
  it("computes agreement percentage", () => {
    const agree = ensemblePredict("a", [
      { name: "a", etaHours: 5, confidence: 50 },
      { name: "b", etaHours: 5.1, confidence: 50 },
    ]);
    assert.ok(agree.agreementPct > 80);

    const disagree = ensemblePredict("b", [
      { name: "a", etaHours: 2, confidence: 50 },
      { name: "b", etaHours: 10, confidence: 50 },
    ]);
    assert.ok(disagree.agreementPct < agree.agreementPct);
  });
  it("boosts confidence when methods agree", () => {
    const agree = ensemblePredict("a", [
      { name: "a", etaHours: 5, confidence: 60 },
      { name: "b", etaHours: 5, confidence: 60 },
    ]);
    const disagree = ensemblePredict("b", [
      { name: "a", etaHours: 1, confidence: 60 },
      { name: "b", etaHours: 20, confidence: 60 },
    ]);
    assert.ok(agree.ensembleConfidence >= disagree.ensembleConfidence);
  });
});

describe("buildPredictionMethods", () => {
  it("builds linear method from progress", () => {
    const methods = buildPredictionMethods({ currentProgressPct: 50, elapsedHours: 2, velocityPctPerHr: 0 });
    assert.ok(methods.some((m) => m.name === "linear"));
  });
  it("builds velocity method", () => {
    const methods = buildPredictionMethods({ currentProgressPct: 50, elapsedHours: 2, velocityPctPerHr: 10 });
    assert.ok(methods.some((m) => m.name === "velocity"));
  });
  it("builds historical method when data available", () => {
    const methods = buildPredictionMethods({ currentProgressPct: 50, elapsedHours: 2, velocityPctPerHr: 0, historicalAvgHours: 5 });
    assert.ok(methods.some((m) => m.name === "historical"));
  });
  it("skips velocity for low values", () => {
    const methods = buildPredictionMethods({ currentProgressPct: 50, elapsedHours: 2, velocityPctPerHr: 0.1 });
    assert.ok(!methods.some((m) => m.name === "velocity"));
  });
});

describe("formatEnsemblePredictions", () => {
  it("shows no-goals message when empty", () => {
    const lines = formatEnsemblePredictions([]);
    assert.ok(lines[0].includes("no active goals"));
  });
  it("shows ensemble with methods", () => {
    const p = ensemblePredict("alpha", [
      { name: "linear", etaHours: 4, confidence: 60 },
      { name: "velocity", etaHours: 3, confidence: 70 },
    ]);
    const lines = formatEnsemblePredictions([p]);
    assert.ok(lines[0].includes("Prediction Ensemble"));
    assert.ok(lines.some((l) => l.includes("alpha")));
    assert.ok(lines.some((l) => l.includes("linear")));
  });
});
