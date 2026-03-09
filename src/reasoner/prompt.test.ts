import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatObservation, detectPermissionPrompt } from "./prompt.js";
import type { Observation, SessionSnapshot } from "../types.js";

// helper to build a minimal observation
function makeObs(overrides?: Partial<Observation>): Observation {
  return {
    timestamp: 1700000000000,
    sessions: [],
    changes: [],
    ...overrides,
  };
}

function makeSnap(id: string, title: string, tool = "opencode", status = "working", output = ""): SessionSnapshot {
  return {
    session: { id, title, path: "/tmp", tool, status, tmux_name: `aoe_${title}_${id.slice(0, 8)}` },
    output,
    outputHash: "abcd1234",
    capturedAt: 1700000000000,
  };
}

describe("formatObservation", () => {
  it("includes timestamp and session count", () => {
    const obs = makeObs({ sessions: [makeSnap("abc12345", "agent-1")] });
    const result = formatObservation(obs);
    assert.ok(result.includes("Observation at"));
    assert.ok(result.includes("Active sessions: 1"));
  });

  it("lists sessions with truncated IDs", () => {
    const obs = makeObs({
      sessions: [makeSnap("abcdef1234567890", "my-agent", "claude", "working")],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes('[abcdef12] "my-agent" tool=claude status=working'));
  });

  it("reports no changes when empty", () => {
    const obs = makeObs({ sessions: [makeSnap("abc12345", "a")] });
    const result = formatObservation(obs);
    assert.ok(result.includes("No new output from any session since last poll."));
  });

  it("shows change details", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      changes: [{
        sessionId: "abc12345",
        title: "agent-1",
        tool: "opencode",
        status: "working",
        newLines: "compiling...\ndone!",
      }],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("Changes detected in 1 session(s):"));
    assert.ok(result.includes("compiling..."));
    assert.ok(result.includes("done!"));
  });

  it("truncates long change output to last 50 lines", () => {
    const longOutput = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      changes: [{
        sessionId: "abc12345",
        title: "agent-1",
        tool: "opencode",
        status: "working",
        newLines: longOutput,
      }],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("[80 lines, showing last 50]"));
    assert.ok(result.includes("line 79"));
    assert.ok(!result.includes("line 0\n"));
  });

  it("includes operator message with priority note", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "a")],
      userMessage: "focus on the auth bug",
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("OPERATOR MESSAGE"));
    assert.ok(result.includes("focus on the auth bug"));
    assert.ok(result.includes("takes priority"));
  });

  it("includes IDLE policy alert when session exceeds threshold", () => {
    const obs = makeObs({
      timestamp: 1700000200000, // 200s after lastOutputChangeAt
      sessions: [makeSnap("abc12345", "agent-1")],
      policyContext: {
        policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
        sessionStates: [{
          sessionId: "abc12345",
          lastOutputChangeAt: 1700000000000, // 200s idle
          consecutiveErrorPolls: 0,
          hasPermissionPrompt: false,
        }],
      },
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("Policy alerts:"));
    assert.ok(result.includes("IDLE: session abc12345"));
    assert.ok(result.includes("200s"));
    assert.ok(result.includes("threshold: 120s"));
  });

  it("includes ERROR policy alert when error count exceeds threshold", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      policyContext: {
        policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
        sessionStates: [{
          sessionId: "abc12345",
          lastOutputChangeAt: 1700000000000,
          consecutiveErrorPolls: 5,
          hasPermissionPrompt: false,
        }],
      },
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("ERROR: session abc12345"));
    assert.ok(result.includes("5 consecutive polls"));
  });

  it("includes PERMISSION policy alert", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      policyContext: {
        policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
        sessionStates: [{
          sessionId: "abc12345",
          lastOutputChangeAt: 1700000000000,
          consecutiveErrorPolls: 0,
          hasPermissionPrompt: true,
        }],
      },
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("PERMISSION: session abc12345"));
    assert.ok(result.includes("Auto-answer policy is enabled"));
  });

  it("omits policy alerts when below thresholds", () => {
    const obs = makeObs({
      timestamp: 1700000050000, // 50s after lastOutputChangeAt (below 120s)
      sessions: [makeSnap("abc12345", "agent-1")],
      policyContext: {
        policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
        sessionStates: [{
          sessionId: "abc12345",
          lastOutputChangeAt: 1700000000000,
          consecutiveErrorPolls: 1,
          hasPermissionPrompt: false,
        }],
      },
    });
    const result = formatObservation(obs);
    assert.ok(!result.includes("Policy alerts:"));
  });

  it("omits policy alerts when no policyContext", () => {
    const obs = makeObs({ sessions: [makeSnap("abc12345", "a")] });
    const result = formatObservation(obs);
    assert.ok(!result.includes("Policy alerts:"));
  });
});

describe("detectPermissionPrompt", () => {
  it("detects y/n prompts", () => {
    assert.equal(detectPermissionPrompt("Do something? (y/n)"), true);
  });

  it("detects yes/no prompts", () => {
    assert.equal(detectPermissionPrompt("Continue? (yes/no)"), true);
  });

  it("detects allow/deny prompts", () => {
    assert.equal(detectPermissionPrompt("Allow access to /home?\n"), true);
  });

  it("detects press enter to continue", () => {
    assert.equal(detectPermissionPrompt("Press enter to continue"), true);
  });

  it("detects approve/reject", () => {
    assert.equal(detectPermissionPrompt("Approve this change?\n"), true);
  });

  it("returns false for normal output", () => {
    assert.equal(detectPermissionPrompt("compiling...\nBuild succeeded\n"), false);
  });

  it("only checks last 10 lines", () => {
    // permission prompt buried above 10 lines of other output
    const lines = ["Allow access? (y/n)", ...Array.from({ length: 15 }, (_, i) => `output ${i}`)];
    assert.equal(detectPermissionPrompt(lines.join("\n")), false);
  });

  it("detects prompt in last 10 lines", () => {
    const lines = [...Array.from({ length: 5 }, (_, i) => `output ${i}`), "Do you want to continue?"];
    assert.equal(detectPermissionPrompt(lines.join("\n")), true);
  });
});
