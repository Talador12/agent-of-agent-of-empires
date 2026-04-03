import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { detectDependencies, formatDetectedDeps } from "./session-dep-auto-detect.js";

describe("detectDependencies", () => {
  it("detects explicit dependencies", () => {
    const sessions = [
      { title: "frontend", repo: "web", goal: "build UI", dependsOn: ["backend"] },
      { title: "backend", repo: "api", goal: "build API" },
    ];
    const deps = detectDependencies(sessions);
    assert.ok(deps.some((d) => d.from === "frontend" && d.to === "backend" && d.type === "explicit"));
  });

  it("detects goal references", () => {
    const sessions = [
      { title: "deploy", repo: "infra", goal: "deploy after backend is ready" },
      { title: "backend", repo: "api", goal: "build API endpoints" },
    ];
    const deps = detectDependencies(sessions);
    assert.ok(deps.some((d) => d.from === "deploy" && d.to === "backend" && d.type === "goal-reference"));
  });

  it("detects file overlap", () => {
    const sessions = [
      { title: "auth", repo: "app", goal: "add auth", recentFiles: ["src/auth.ts", "src/config.ts"] },
      { title: "settings", repo: "app", goal: "add settings", recentFiles: ["src/config.ts", "src/settings.ts"] },
    ];
    const deps = detectDependencies(sessions);
    assert.ok(deps.some((d) => d.type === "file-overlap"));
    assert.ok(deps.some((d) => d.reason.includes("src/config.ts")));
  });

  it("detects blocked-by pattern in goals", () => {
    const sessions = [
      { title: "migrate", repo: "db", goal: "run migration blocked by schema session" },
      { title: "schema", repo: "db", goal: "update schema" },
    ];
    const deps = detectDependencies(sessions);
    assert.ok(deps.some((d) => d.from === "migrate" && d.to === "schema"));
  });

  it("returns empty for unrelated sessions", () => {
    const sessions = [
      { title: "frontend", repo: "web", goal: "build UI" },
      { title: "infra", repo: "terraform", goal: "provision servers" },
    ];
    const deps = detectDependencies(sessions);
    assert.equal(deps.length, 0);
  });

  it("handles empty input", () => {
    assert.deepEqual(detectDependencies([]), []);
  });

  it("sorts by confidence (high first)", () => {
    const sessions = [
      { title: "a", repo: "app", goal: "fix after b is done", dependsOn: ["b"], recentFiles: ["f.ts"] },
      { title: "b", repo: "app", goal: "build", recentFiles: ["f.ts"] },
    ];
    const deps = detectDependencies(sessions);
    if (deps.length >= 2) {
      const confs = deps.map((d) => d.confidence);
      const idx = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < confs.length; i++) {
        assert.ok(idx[confs[i]] >= idx[confs[i - 1]]);
      }
    }
  });

  it("deduplicates dependencies", () => {
    const sessions = [
      { title: "a", repo: "app", goal: "build a", dependsOn: ["b"] },
      { title: "b", repo: "app", goal: "build b" },
    ];
    const deps = detectDependencies(sessions);
    const explicitDeps = deps.filter((d) => d.type === "explicit" && d.from === "a" && d.to === "b");
    assert.equal(explicitDeps.length, 1); // no duplicates
  });
});

describe("formatDetectedDeps", () => {
  it("shows no-deps message when empty", () => {
    const lines = formatDetectedDeps([]);
    assert.ok(lines[0].includes("no dependencies"));
  });

  it("shows dependency details", () => {
    const deps = detectDependencies([
      { title: "fe", repo: "web", goal: "build", dependsOn: ["be"] },
      { title: "be", repo: "api", goal: "build" },
    ]);
    const lines = formatDetectedDeps(deps);
    assert.ok(lines.some((l) => l.includes("fe")));
    assert.ok(lines.some((l) => l.includes("be")));
  });
});
