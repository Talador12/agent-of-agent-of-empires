import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { exportDot, exportMermaid, exportAscii, exportGraph, graphStats, formatGraphExport } from "./goal-dep-graph-export.js";

const NODES = [
  { sessionTitle: "api", status: "active", dependsOn: [] },
  { sessionTitle: "frontend", status: "active", dependsOn: ["api"] },
  { sessionTitle: "deploy", status: "pending", dependsOn: ["frontend", "api"] },
];

describe("exportDot", () => {
  it("produces valid DOT syntax", () => {
    const dot = exportDot(NODES);
    assert.ok(dot.startsWith("digraph"));
    assert.ok(dot.includes('"api"'));
    assert.ok(dot.includes("->"));
  });
  it("handles empty nodes", () => {
    const dot = exportDot([]);
    assert.ok(dot.includes("digraph"));
  });
});

describe("exportMermaid", () => {
  it("produces valid Mermaid syntax", () => {
    const md = exportMermaid(NODES);
    assert.ok(md.startsWith("graph LR"));
    assert.ok(md.includes("-->"));
    assert.ok(md.includes("classDef"));
  });
});

describe("exportAscii", () => {
  it("produces readable tree", () => {
    const ascii = exportAscii(NODES);
    assert.ok(ascii.includes("api"));
    assert.ok(ascii.includes("frontend"));
  });
  it("handles cycle detection", () => {
    const cyclic = [
      { sessionTitle: "a", status: "active", dependsOn: ["b"] },
      { sessionTitle: "b", status: "active", dependsOn: ["a"] },
    ];
    const ascii = exportAscii(cyclic);
    assert.ok(ascii.length > 0); // should not infinite loop
  });
});

describe("exportGraph", () => {
  it("dispatches to correct format", () => {
    assert.ok(exportGraph(NODES, "dot").includes("digraph"));
    assert.ok(exportGraph(NODES, "mermaid").includes("graph LR"));
    assert.ok(exportGraph(NODES, "ascii").includes("api"));
  });
});

describe("graphStats", () => {
  it("computes node/edge/root/leaf counts", () => {
    const s = graphStats(NODES);
    assert.equal(s.nodeCount, 3);
    assert.equal(s.edgeCount, 3); // frontend→api, deploy→frontend, deploy→api
    assert.equal(s.rootCount, 1); // api
    assert.equal(s.leafCount, 1); // deploy
  });
});

describe("formatGraphExport", () => {
  it("shows graph preview with stats", () => {
    const lines = formatGraphExport(NODES, "dot");
    assert.ok(lines[0].includes("Dep Graph Export"));
    assert.ok(lines[0].includes("3 nodes"));
  });
});
