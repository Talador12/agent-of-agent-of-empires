import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createMutationState, recordGoalChange, getGoalHistory, detectScopeCreep, mutationStats, formatMutationHistory } from "./session-goal-mutation.js";

describe("recordGoalChange", () => {
  it("records initial goal", () => {
    const s = createMutationState();
    const m = recordGoalChange(s, "alpha", "build auth");
    assert.equal(m.changeType, "initial");
    assert.equal(m.version, 1);
  });
  it("detects refined goal", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "build user authentication system");
    const m = recordGoalChange(s, "a", "build user authentication module");
    assert.equal(m.changeType, "refined");
  });
  it("detects expanded goal", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "build user authentication system for login");
    const m = recordGoalChange(s, "a", "build user authentication system for login with oauth integration social login mfa and audit logging");
    assert.equal(m.changeType, "expanded");
  });
  it("detects narrowed goal", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "build user authentication system for login with oauth integration social login mfa and audit logging");
    const m = recordGoalChange(s, "a", "build user authentication system");
    assert.equal(m.changeType, "narrowed");
  });
  it("detects replaced goal", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "build authentication system");
    const m = recordGoalChange(s, "a", "fix database migration scripts");
    assert.equal(m.changeType, "replaced");
  });
  it("increments version numbers", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "v1");
    recordGoalChange(s, "a", "v2 refined");
    recordGoalChange(s, "a", "v3 refined more");
    assert.equal(getGoalHistory(s, "a").length, 3);
    assert.equal(getGoalHistory(s, "a")[2].version, 3);
  });
});

describe("detectScopeCreep", () => {
  it("detects scope creep from repeated expansion", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "build user auth system for login page");
    recordGoalChange(s, "a", "build user auth system for login page with oauth integration social login enterprise sso");
    recordGoalChange(s, "a", "build user auth system for login page with oauth integration social login enterprise sso mfa audit logging monitoring alerts dashboard notifications reporting compliance analytics backup recovery caching");
    assert.ok(detectScopeCreep(s, "a"));
  });
  it("no creep for refined goals", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "build authentication");
    recordGoalChange(s, "a", "build user authentication");
    recordGoalChange(s, "a", "build user auth module");
    assert.ok(!detectScopeCreep(s, "a"));
  });
});

describe("mutationStats", () => {
  it("computes stats", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "g1"); recordGoalChange(s, "a", "g2 refined");
    recordGoalChange(s, "b", "g3");
    const stats = mutationStats(s);
    assert.equal(stats.sessionsTracked, 2);
    assert.equal(stats.totalMutations, 3);
  });
});

describe("formatMutationHistory", () => {
  it("shows session history", () => {
    const s = createMutationState();
    recordGoalChange(s, "alpha", "build auth");
    recordGoalChange(s, "alpha", "build auth module with OAuth");
    const lines = formatMutationHistory(s, "alpha");
    assert.ok(lines[0].includes("alpha"));
    assert.ok(lines.some((l) => l.includes("v1")));
  });
  it("shows fleet summary", () => {
    const s = createMutationState();
    recordGoalChange(s, "a", "g");
    const lines = formatMutationHistory(s);
    assert.ok(lines[0].includes("Goal Mutations"));
  });
});
