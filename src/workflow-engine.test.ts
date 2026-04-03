import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createWorkflowState, advanceWorkflow, formatWorkflow } from "./workflow-engine.js";
import type { WorkflowDefinition } from "./workflow-engine.js";

function makeWorkflow(): WorkflowDefinition {
  return {
    name: "deploy-pipeline",
    stages: [
      { name: "build", tasks: [{ sessionTitle: "frontend", goal: "build UI" }, { sessionTitle: "backend", goal: "build API" }] },
      { name: "test", tasks: [{ sessionTitle: "integration", goal: "run integration tests" }] },
      { name: "deploy", tasks: [{ sessionTitle: "deployer", goal: "deploy to prod" }] },
    ],
  };
}

describe("createWorkflowState", () => {
  it("initializes all stages as pending", () => {
    const state = createWorkflowState(makeWorkflow());
    assert.equal(state.stages.length, 3);
    for (const s of state.stages) assert.equal(s.status, "pending");
    assert.equal(state.currentStage, 0);
  });
});

describe("advanceWorkflow", () => {
  it("activates first stage tasks on first advance", () => {
    const state = createWorkflowState(makeWorkflow());
    const taskStates = new Map<string, string>();
    const { actions, completed } = advanceWorkflow(state, taskStates);
    assert.equal(completed, false);
    assert.ok(actions.some((a) => a.type === "stage_started" && a.stage === "build"));
    assert.ok(actions.some((a) => a.type === "activate_task" && a.detail === "frontend"));
    assert.ok(actions.some((a) => a.type === "activate_task" && a.detail === "backend"));
    assert.equal(state.stages[0].status, "active");
  });

  it("advances to next stage when all tasks complete", () => {
    const state = createWorkflowState(makeWorkflow());
    const taskStates = new Map<string, string>();

    // activate first stage
    advanceWorkflow(state, taskStates);

    // complete first stage tasks
    taskStates.set("frontend", "completed");
    taskStates.set("backend", "completed");
    const { actions } = advanceWorkflow(state, taskStates);

    assert.ok(actions.some((a) => a.type === "stage_started" && a.stage === "test"));
    assert.equal(state.stages[0].status, "completed");
    assert.equal(state.currentStage, 1);
  });

  it("fails stage when a task fails", () => {
    const state = createWorkflowState(makeWorkflow());
    advanceWorkflow(state, new Map());

    const taskStates = new Map([["frontend", "completed"], ["backend", "failed"]]);
    const { actions } = advanceWorkflow(state, taskStates);

    assert.ok(actions.some((a) => a.type === "stage_failed"));
    assert.equal(state.stages[0].status, "failed");
  });

  it("completes workflow after all stages done", () => {
    const state = createWorkflowState(makeWorkflow());
    const taskStates = new Map<string, string>();

    // stage 1: build
    advanceWorkflow(state, taskStates);
    taskStates.set("frontend", "completed");
    taskStates.set("backend", "completed");
    advanceWorkflow(state, taskStates);

    // stage 2: test
    taskStates.set("integration", "completed");
    advanceWorkflow(state, taskStates);

    // stage 3: deploy
    taskStates.set("deployer", "completed");
    const { completed } = advanceWorkflow(state, taskStates);

    assert.equal(completed, true);
    assert.ok(state.completedAt);
  });

  it("returns completed=true when already finished", () => {
    const state = createWorkflowState({ name: "empty", stages: [] });
    const { completed } = advanceWorkflow(state, new Map());
    assert.equal(completed, true);
  });
});

describe("formatWorkflow", () => {
  it("shows workflow stages with icons", () => {
    const state = createWorkflowState(makeWorkflow());
    advanceWorkflow(state, new Map());
    const lines = formatWorkflow(state);
    assert.ok(lines[0].includes("deploy-pipeline"));
    assert.ok(lines.some((l) => l.includes("build") && l.includes("▶")));
    assert.ok(lines.some((l) => l.includes("test") && l.includes("○")));
    assert.ok(lines.some((l) => l.includes("frontend")));
  });
});
