// fleet-session-topology.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTopology,
  formatTopology,
} from "./fleet-session-topology.js";

describe("buildTopology", () => {
  it("builds topology from dependencies", () => {
    const result = buildTopology(
      ["a", "b", "c"],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }],
      [], [], [], [],
    );
    assert.equal(result.nodes.length, 3);
    assert.equal(result.edges.length, 2);
    assert.equal(result.edges[0].type, "dependency");
  });

  it("includes shared file edges", () => {
    const result = buildTopology(
      ["x", "y"],
      [],
      [{ session1: "x", session2: "y", file: "shared.ts" }],
      [], [], [],
    );
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].type, "shared-file");
    assert.equal(result.edges[0].label, "shared.ts");
  });

  it("includes conflict edges", () => {
    const result = buildTopology(
      ["a", "b"],
      [], [], [], [],
      [{ session1: "a", session2: "b" }],
    );
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].type, "conflict");
    assert.equal(result.edges[0].weight, 7); // conflicts are high weight
  });

  it("deduplicates edges", () => {
    const result = buildTopology(
      ["a", "b"],
      [{ from: "a", to: "b" }, { from: "a", to: "b" }],
      [], [], [], [],
    );
    assert.equal(result.edges.length, 1);
  });

  it("computes in/out degree", () => {
    const result = buildTopology(
      ["a", "b", "c"],
      [{ from: "a", to: "b" }, { from: "a", to: "c" }],
      [], [], [], [],
    );
    const nodeA = result.nodes.find((n) => n.session === "a")!;
    assert.equal(nodeA.outDegree, 2);
    assert.equal(nodeA.inDegree, 0);
    const nodeB = result.nodes.find((n) => n.session === "b")!;
    assert.equal(nodeB.inDegree, 1);
  });

  it("identifies isolated sessions", () => {
    const result = buildTopology(
      ["a", "b", "lonely"],
      [{ from: "a", to: "b" }],
      [], [], [], [],
    );
    assert.ok(result.isolatedSessions.includes("lonely"));
  });

  it("finds connected clusters", () => {
    const result = buildTopology(
      ["a", "b", "c", "x", "y"],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }],
      [{ session1: "x", session2: "y", file: "f.ts" }],
      [], [], [],
    );
    assert.equal(result.clusters.length, 2); // {a,b,c} and {x,y}
    assert.ok(result.clusters[0].length >= 2);
  });

  it("computes density", () => {
    const result = buildTopology(
      ["a", "b", "c"],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c" }],
      [], [], [], [],
    );
    // 3 edges out of max 6 (3*2) = 0.5
    assert.equal(result.density, 0.5);
  });

  it("handles empty input", () => {
    const result = buildTopology([], [], [], [], [], []);
    assert.equal(result.nodes.length, 0);
    assert.equal(result.edges.length, 0);
    assert.equal(result.density, 0);
  });

  it("sorts nodes by total degree desc", () => {
    const result = buildTopology(
      ["hub", "leaf1", "leaf2"],
      [{ from: "hub", to: "leaf1" }, { from: "hub", to: "leaf2" }],
      [], [], [], [],
    );
    assert.equal(result.nodes[0].session, "hub");
  });

  it("includes knowledge transfer edges", () => {
    const result = buildTopology(
      ["teacher", "student"],
      [], [], [],
      [{ from: "teacher", to: "student" }],
      [],
    );
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].type, "knowledge");
    assert.equal(result.edges[0].weight, 4);
  });

  it("includes event flow edges", () => {
    const result = buildTopology(
      ["producer", "consumer"],
      [], [],
      [{ from: "producer", to: "consumer", event: "build:done" }],
      [], [],
    );
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].type, "event-flow");
    assert.equal(result.edges[0].label, "build:done");
  });
});

describe("formatTopology", () => {
  it("formats topology for TUI", () => {
    const result = buildTopology(
      ["frontend", "backend", "infra"],
      [{ from: "frontend", to: "backend" }],
      [{ session1: "backend", session2: "infra", file: "deploy.sh" }],
      [], [], [],
    );
    const lines = formatTopology(result);
    assert.ok(lines[0].includes("3 nodes"));
    assert.ok(lines.some((l) => l.includes("edge types")));
    assert.ok(lines.some((l) => l.includes("topology:")));
    assert.ok(lines.some((l) => l.includes("──▶") || l.includes("◀─▶")));
  });

  it("handles empty topology", () => {
    const result = buildTopology([], [], [], [], [], []);
    const lines = formatTopology(result);
    assert.ok(lines[0].includes("0 nodes"));
  });
});
