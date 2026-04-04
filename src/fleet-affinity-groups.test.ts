import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { repoSimilarity, computeAffinityGroups, formatAffinityGroups } from "./fleet-affinity-groups.js";

describe("repoSimilarity", () => {
  it("returns 100 for identical repos", () => {
    assert.equal(repoSimilarity("github/adventure", "github/adventure"), 100);
  });
  it("returns 90 for same basename different path", () => {
    assert.equal(repoSimilarity("github/adventure", "gitlab/adventure"), 90);
  });
  it("returns >0 for shared prefix", () => {
    assert.ok(repoSimilarity("github/mono/frontend", "github/mono/backend") > 0);
  });
  it("returns 0 for unrelated repos", () => {
    assert.equal(repoSimilarity("github/alpha", "gitlab/beta"), 0);
  });
  it("handles empty vs non-empty", () => {
    assert.equal(repoSimilarity("", "github/repo"), 0);
  });
});

describe("computeAffinityGroups", () => {
  it("groups sessions with same repo", () => {
    const groups = computeAffinityGroups([
      { sessionTitle: "a", repo: "github/adventure" },
      { sessionTitle: "b", repo: "github/adventure" },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].sessions.length, 2);
  });
  it("groups sessions with similar repos", () => {
    const groups = computeAffinityGroups([
      { sessionTitle: "a", repo: "github/mono/frontend" },
      { sessionTitle: "b", repo: "github/mono/backend" },
    ]);
    assert.ok(groups.length >= 1);
  });
  it("does not group unrelated repos", () => {
    const groups = computeAffinityGroups([
      { sessionTitle: "a", repo: "github/alpha" },
      { sessionTitle: "b", repo: "gitlab/beta" },
    ]);
    assert.equal(groups.length, 0);
  });
  it("returns empty for single session", () => {
    const groups = computeAffinityGroups([{ sessionTitle: "a", repo: "r" }]);
    assert.equal(groups.length, 0);
  });
  it("returns empty for empty input", () => {
    assert.equal(computeAffinityGroups([]).length, 0);
  });
  it("sorts by group size descending", () => {
    const groups = computeAffinityGroups([
      { sessionTitle: "a", repo: "github/big" },
      { sessionTitle: "b", repo: "github/big" },
      { sessionTitle: "c", repo: "github/big" },
      { sessionTitle: "d", repo: "github/small" },
      { sessionTitle: "e", repo: "github/small" },
    ]);
    if (groups.length >= 2) assert.ok(groups[0].sessions.length >= groups[1].sessions.length);
  });
});

describe("formatAffinityGroups", () => {
  it("shows no-groups message when empty", () => {
    const lines = formatAffinityGroups([]);
    assert.ok(lines[0].includes("no related"));
  });
  it("shows group details", () => {
    const groups = computeAffinityGroups([
      { sessionTitle: "alpha", repo: "github/adventure" },
      { sessionTitle: "beta", repo: "github/adventure" },
    ]);
    const lines = formatAffinityGroups(groups);
    assert.ok(lines[0].includes("Affinity Groups"));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
