import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  canTransition, validNextStates, allTransitions,
  tryTransition, formatStateMachine, formatTransitionResult,
} from "./session-state-machine.js";

describe("canTransition", () => {
  it("allows pending → starting", () => {
    const r = canTransition("pending", "starting");
    assert.ok(r.allowed);
    assert.ok(r.guard);
  });

  it("allows active → idle", () => {
    assert.ok(canTransition("active", "idle").allowed);
  });

  it("allows active → error", () => {
    assert.ok(canTransition("active", "error").allowed);
  });

  it("allows error → active (recovery)", () => {
    assert.ok(canTransition("error", "active").allowed);
  });

  it("allows error → failed (max retries)", () => {
    assert.ok(canTransition("error", "failed").allowed);
  });

  it("allows completing → completed", () => {
    assert.ok(canTransition("completing", "completed").allowed);
  });

  it("allows completing → active (verification fail)", () => {
    assert.ok(canTransition("completing", "active").allowed);
  });

  it("blocks completed → active (no going back)", () => {
    const r = canTransition("completed", "active");
    assert.ok(!r.allowed);
    assert.ok(r.reason);
  });

  it("blocks pending → completed (must go through lifecycle)", () => {
    assert.ok(!canTransition("pending", "completed").allowed);
  });

  it("allows removed from any non-terminal state", () => {
    assert.ok(canTransition("active", "removed").allowed);
    assert.ok(canTransition("error", "removed").allowed);
    assert.ok(canTransition("paused", "removed").allowed);
  });
});

describe("validNextStates", () => {
  it("returns valid next states for active", () => {
    const nexts = validNextStates("active");
    const states = nexts.map((n) => n.state);
    assert.ok(states.includes("idle"));
    assert.ok(states.includes("error"));
    assert.ok(states.includes("paused"));
    assert.ok(states.includes("completing"));
  });

  it("returns terminal for completed", () => {
    const nexts = validNextStates("completed");
    assert.equal(nexts.length, 1); // only removed
    assert.equal(nexts[0].state, "removed");
  });

  it("returns empty for removed (terminal)", () => {
    const nexts = validNextStates("removed");
    assert.equal(nexts.length, 0);
  });
});

describe("allTransitions", () => {
  it("returns all defined transitions", () => {
    const transitions = allTransitions();
    assert.ok(transitions.length > 20);
    assert.ok(transitions.every((t) => t.from && t.to));
  });
});

describe("tryTransition", () => {
  it("transitions to new state when allowed", () => {
    const { newState, result } = tryTransition("pending", "starting");
    assert.equal(newState, "starting");
    assert.ok(result.allowed);
  });

  it("stays in current state when blocked", () => {
    const { newState, result } = tryTransition("completed", "active");
    assert.equal(newState, "completed");
    assert.ok(!result.allowed);
  });
});

describe("formatStateMachine", () => {
  it("shows all states", () => {
    const lines = formatStateMachine();
    assert.ok(lines[0].includes("State Machine"));
    assert.ok(lines.some((l) => l.includes("active")));
    assert.ok(lines.some((l) => l.includes("completed")));
  });

  it("marks current state", () => {
    const lines = formatStateMachine("active");
    assert.ok(lines.some((l) => l.includes("▶") && l.includes("active")));
  });
});

describe("formatTransitionResult", () => {
  it("shows allowed transition", () => {
    const result = canTransition("active", "idle");
    const lines = formatTransitionResult(result);
    assert.ok(lines[0].includes("✓"));
  });

  it("shows blocked transition", () => {
    const result = canTransition("completed", "active");
    const lines = formatTransitionResult(result);
    assert.ok(lines[0].includes("✗"));
  });
});
