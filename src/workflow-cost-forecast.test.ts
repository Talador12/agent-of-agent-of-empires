import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { forecastWorkflowCost, formatWorkflowCostForecast } from "./workflow-cost-forecast.js";
import type { WorkflowDefinition } from "./workflow-engine.js";

function makeWorkflow(): WorkflowDefinition {
  return {
    name: "test-pipeline",
    stages: [
      { name: "build", tasks: [{ sessionTitle: "builder", goal: "build the project" }] },
      { name: "test", tasks: [{ sessionTitle: "tester", goal: "run all tests and fix failures" }] },
      { name: "deploy", tasks: [{ sessionTitle: "deployer", goal: "deploy to production" }] },
    ],
  };
}

describe("forecastWorkflowCost", () => {
  it("estimates cost for all stages", () => {
    const forecast = forecastWorkflowCost(makeWorkflow());
    assert.equal(forecast.stages.length, 3);
    assert.ok(forecast.totalEstimatedCostUsd > 0);
    assert.ok(forecast.totalEstimatedHours > 0);
  });

  it("uses custom cost rate when provided", () => {
    const cheap = forecastWorkflowCost(makeWorkflow(), 0.10);
    const expensive = forecastWorkflowCost(makeWorkflow(), 5.00);
    assert.ok(expensive.totalEstimatedCostUsd > cheap.totalEstimatedCostUsd);
  });

  it("reports low confidence without historical data", () => {
    const forecast = forecastWorkflowCost(makeWorkflow());
    assert.equal(forecast.confidence, "low");
  });

  it("reports medium confidence with historical data", () => {
    const forecast = forecastWorkflowCost(makeWorkflow(), 1.0);
    assert.equal(forecast.confidence, "medium");
  });

  it("handles single-stage workflow", () => {
    const wf: WorkflowDefinition = { name: "simple", stages: [{ name: "do", tasks: [{ sessionTitle: "worker", goal: "do the thing" }] }] };
    const forecast = forecastWorkflowCost(wf);
    assert.equal(forecast.stages.length, 1);
    assert.ok(forecast.totalEstimatedCostUsd >= 0);
  });
});

describe("formatWorkflowCostForecast", () => {
  it("shows workflow name and totals", () => {
    const forecast = forecastWorkflowCost(makeWorkflow());
    const lines = formatWorkflowCostForecast(forecast);
    assert.ok(lines[0].includes("test-pipeline"));
    assert.ok(lines.some((l) => l.includes("$")));
    assert.ok(lines.some((l) => l.includes("build")));
  });
});
