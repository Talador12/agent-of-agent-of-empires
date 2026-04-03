import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createWorkflowChain, advanceChain, formatWorkflowChain } from "./workflow-chain.js";
import type { WorkflowState } from "./workflow-engine.js";

describe("createWorkflowChain", () => {
  it("creates chain with all entries pending", () => {
    const chain = createWorkflowChain("deploy", [
      { workflowName: "build-all" },
      { workflowName: "test-all", dependsOn: ["build-all"] },
      { workflowName: "deploy-all", dependsOn: ["test-all"] },
    ]);
    assert.equal(chain.entries.length, 3);
    for (const e of chain.entries) assert.equal(e.status, "pending");
  });
});

describe("advanceChain", () => {
  it("activates entries with no dependencies", () => {
    const chain = createWorkflowChain("test", [
      { workflowName: "first" },
      { workflowName: "second", dependsOn: ["first"] },
    ]);
    const { activate } = advanceChain(chain, new Map());
    assert.deepEqual(activate, ["first"]);
    assert.equal(chain.entries[0].status, "active");
  });

  it("activates dependent when dependency completes", () => {
    const chain = createWorkflowChain("test", [
      { workflowName: "first" },
      { workflowName: "second", dependsOn: ["first"] },
    ]);
    advanceChain(chain, new Map()); // activate first

    // simulate first completing
    chain.entries[0].status = "completed";
    const { activate } = advanceChain(chain, new Map());
    assert.deepEqual(activate, ["second"]);
  });

  it("detects full chain completion", () => {
    const chain = createWorkflowChain("test", [{ workflowName: "only" }]);
    advanceChain(chain, new Map()); // activate
    chain.entries[0].status = "completed";
    const { completed } = advanceChain(chain, new Map());
    assert.equal(completed, true);
    assert.ok(chain.completedAt);
  });

  it("detects failure", () => {
    const chain = createWorkflowChain("test", [{ workflowName: "broken" }]);
    chain.entries[0].status = "failed";
    const { failed } = advanceChain(chain, new Map());
    assert.equal(failed, true);
  });

  it("blocks when deps not met", () => {
    const chain = createWorkflowChain("test", [
      { workflowName: "a" },
      { workflowName: "b", dependsOn: ["a"] },
    ]);
    advanceChain(chain, new Map());
    // a is active but not completed — b should stay pending
    assert.equal(chain.entries[1].status, "pending");
  });

  it("handles parallel entries with no deps", () => {
    const chain = createWorkflowChain("test", [
      { workflowName: "a" },
      { workflowName: "b" },
      { workflowName: "c", dependsOn: ["a", "b"] },
    ]);
    const { activate } = advanceChain(chain, new Map());
    assert.deepEqual(activate.sort(), ["a", "b"]);
  });
});

describe("formatWorkflowChain", () => {
  it("shows chain with icons and deps", () => {
    const chain = createWorkflowChain("deploy", [
      { workflowName: "build" },
      { workflowName: "test", dependsOn: ["build"] },
    ]);
    const lines = formatWorkflowChain(chain);
    assert.ok(lines[0].includes("deploy"));
    assert.ok(lines.some((l) => l.includes("build")));
    assert.ok(lines.some((l) => l.includes("test")));
  });
});
