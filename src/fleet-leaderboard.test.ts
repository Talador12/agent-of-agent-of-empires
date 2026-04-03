import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeLeaderboard, formatLeaderboard } from "./fleet-leaderboard.js";

describe("computeLeaderboard", () => {
  it("returns empty for no inputs", () => {
    assert.deepEqual(computeLeaderboard([]), []);
  });

  it("ranks by composite productivity score", () => {
    const entries = computeLeaderboard([
      { sessionTitle: "fast", completedTasks: 5, totalTasks: 5, velocityPctPerHr: 50, costUsd: 2 },
      { sessionTitle: "slow", completedTasks: 1, totalTasks: 5, velocityPctPerHr: 10, costUsd: 10 },
    ]);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].sessionTitle, "fast");
    assert.equal(entries[0].rank, 1);
    assert.equal(entries[1].sessionTitle, "slow");
    assert.equal(entries[1].rank, 2);
  });

  it("computes completion rate correctly", () => {
    const entries = computeLeaderboard([
      { sessionTitle: "half", completedTasks: 3, totalTasks: 6, velocityPctPerHr: 20, costUsd: 5 },
    ]);
    assert.equal(entries[0].completionRate, 50);
  });

  it("handles zero total tasks", () => {
    const entries = computeLeaderboard([
      { sessionTitle: "none", completedTasks: 0, totalTasks: 0, velocityPctPerHr: 0, costUsd: 0 },
    ]);
    assert.equal(entries[0].completionRate, 0);
    assert.equal(entries[0].productivityScore, 0);
  });

  it("handles zero completions (Infinity cost per completion)", () => {
    const entries = computeLeaderboard([
      { sessionTitle: "wip", completedTasks: 0, totalTasks: 3, velocityPctPerHr: 15, costUsd: 5 },
    ]);
    assert.equal(entries[0].costPerCompletion, Infinity);
  });

  it("assigns sequential ranks", () => {
    const entries = computeLeaderboard([
      { sessionTitle: "a", completedTasks: 3, totalTasks: 3, velocityPctPerHr: 30, costUsd: 1 },
      { sessionTitle: "b", completedTasks: 2, totalTasks: 3, velocityPctPerHr: 20, costUsd: 5 },
      { sessionTitle: "c", completedTasks: 1, totalTasks: 3, velocityPctPerHr: 10, costUsd: 10 },
    ]);
    assert.deepEqual(entries.map((e) => e.rank), [1, 2, 3]);
  });

  it("normalizes velocity to highest", () => {
    const entries = computeLeaderboard([
      { sessionTitle: "fast", completedTasks: 1, totalTasks: 1, velocityPctPerHr: 100, costUsd: 1 },
      { sessionTitle: "slow", completedTasks: 1, totalTasks: 1, velocityPctPerHr: 50, costUsd: 1 },
    ]);
    // fast should have higher score due to velocity component
    assert.ok(entries[0].productivityScore >= entries[1].productivityScore);
  });
});

describe("formatLeaderboard", () => {
  it("shows no-data message for empty input", () => {
    const lines = formatLeaderboard([]);
    assert.ok(lines[0].includes("no session data"));
  });

  it("shows header and entries", () => {
    const entries = computeLeaderboard([
      { sessionTitle: "alpha", completedTasks: 3, totalTasks: 5, velocityPctPerHr: 25, costUsd: 3.50 },
    ]);
    const lines = formatLeaderboard(entries);
    assert.ok(lines[0].includes("Fleet Leaderboard"));
    assert.ok(lines.some((l) => l.includes("alpha")));
    assert.ok(lines.some((l) => l.includes("$3.50")));
  });

  it("shows medal emoji for top 3", () => {
    const entries = computeLeaderboard([
      { sessionTitle: "gold", completedTasks: 5, totalTasks: 5, velocityPctPerHr: 50, costUsd: 1 },
      { sessionTitle: "silver", completedTasks: 4, totalTasks: 5, velocityPctPerHr: 40, costUsd: 2 },
      { sessionTitle: "bronze", completedTasks: 3, totalTasks: 5, velocityPctPerHr: 30, costUsd: 3 },
    ]);
    const lines = formatLeaderboard(entries);
    const text = lines.join("\n");
    assert.ok(text.includes("🥇"));
    assert.ok(text.includes("🥈"));
    assert.ok(text.includes("🥉"));
  });
});
