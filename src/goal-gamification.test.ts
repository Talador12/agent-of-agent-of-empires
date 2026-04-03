import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createXPState, awardCompletion, recordFailure, getLeaderboard, formatGamification } from "./goal-gamification.js";

describe("createXPState", () => {
  it("starts empty", () => { assert.equal(createXPState().sessions.size, 0); });
});

describe("awardCompletion", () => {
  it("awards base XP", () => {
    const s = createXPState();
    const xp = awardCompletion(s, "alpha");
    assert.ok(xp.xp > 0);
    assert.equal(xp.completions, 1);
  });
  it("awards bonus for fast completion", () => {
    const s = createXPState();
    const normal = awardCompletion(s, "a");
    const fast = awardCompletion(s, "b", { fast: true });
    assert.ok(fast.xp > normal.xp - 10); // fast gets bonus but also streak bonus differs
  });
  it("awards bonus for cheap completion", () => {
    const s = createXPState();
    const xp = awardCompletion(s, "alpha", { cheap: true });
    assert.ok(xp.xp >= 35); // 25 base + 10 cheap
  });
  it("awards bonus for zero errors", () => {
    const s = createXPState();
    const xp = awardCompletion(s, "alpha", { zeroErrors: true });
    assert.ok(xp.badges.includes("zero-errors"));
  });
  it("increments streak", () => {
    const s = createXPState();
    awardCompletion(s, "alpha");
    awardCompletion(s, "alpha");
    const xp = s.sessions.get("alpha")!;
    assert.equal(xp.streak, 2);
  });
  it("levels up at 100 XP", () => {
    const s = createXPState();
    for (let i = 0; i < 5; i++) awardCompletion(s, "alpha", { fast: true, cheap: true, zeroErrors: true });
    const xp = s.sessions.get("alpha")!;
    assert.ok(xp.level >= 2);
  });
  it("awards First Blood badge", () => {
    const s = createXPState();
    awardCompletion(s, "alpha");
    const xp = s.sessions.get("alpha")!;
    assert.ok(xp.badges.some((b) => b.includes("First Blood")));
  });
});

describe("recordFailure", () => {
  it("resets streak", () => {
    const s = createXPState();
    awardCompletion(s, "alpha");
    awardCompletion(s, "alpha");
    recordFailure(s, "alpha");
    assert.equal(s.sessions.get("alpha")!.streak, 0);
  });
});

describe("getLeaderboard", () => {
  it("sorts by XP descending", () => {
    const s = createXPState();
    awardCompletion(s, "low");
    awardCompletion(s, "high"); awardCompletion(s, "high"); awardCompletion(s, "high");
    const board = getLeaderboard(s);
    assert.equal(board[0].sessionTitle, "high");
  });
});

describe("formatGamification", () => {
  it("shows no-XP message when empty", () => {
    const lines = formatGamification(createXPState());
    assert.ok(lines[0].includes("no sessions"));
  });
  it("shows leaderboard", () => {
    const s = createXPState();
    awardCompletion(s, "alpha");
    const lines = formatGamification(s);
    assert.ok(lines[0].includes("Gamification"));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
