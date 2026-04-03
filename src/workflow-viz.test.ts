import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { renderWorkflowDag, renderChainDag, renderWorkflowCompact } from "./workflow-viz.js";
import { createWorkflowState } from "./workflow-engine.js";
import { createWorkflowChain } from "./workflow-chain.js";

describe("renderWorkflowDag", () => {
  it("renders stages with tasks", () => {
    const wf = createWorkflowState({
      name: "test-pipeline",
      stages: [
        { name: "build", tasks: [{ sessionTitle: "builder", goal: "build" }] },
        { name: "test", tasks: [{ sessionTitle: "tester", goal: "test" }] },
      ],
    });
    const lines = renderWorkflowDag(wf);
    assert.ok(lines.some((l) => l.includes("test-pipeline")));
    assert.ok(lines.some((l) => l.includes("build")));
    assert.ok(lines.some((l) => l.includes("tester")));
    assert.ok(lines.some((l) => l.includes("↓")));
  });
});

describe("renderChainDag", () => {
  it("renders chain with dependencies", () => {
    const chain = createWorkflowChain("deploy", [
      { workflowName: "build" },
      { workflowName: "test", dependsOn: ["build"] },
      { workflowName: "deploy", dependsOn: ["test"] },
    ]);
    const lines = renderChainDag(chain);
    assert.ok(lines.some((l) => l.includes("deploy")));
    assert.ok(lines.some((l) => l.includes("build")));
    assert.ok(lines.some((l) => l.includes("←")));
  });
});

describe("renderWorkflowCompact", () => {
  it("renders single-line summary", () => {
    const wf = createWorkflowState({
      name: "pipe",
      stages: [
        { name: "a", tasks: [{ sessionTitle: "t1", goal: "g" }] },
        { name: "b", tasks: [{ sessionTitle: "t2", goal: "g" }] },
      ],
    });
    const line = renderWorkflowCompact(wf);
    assert.ok(line.includes("pipe"));
    assert.ok(line.includes("○→○")); // both pending
  });
});
