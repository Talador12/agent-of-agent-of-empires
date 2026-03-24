// direct tests for parse.ts — the core JSON parsing that turns LLM output into actions.
// opencode.test.ts re-exports and tests these too; this file covers edge cases and
// exercises the module boundary directly (no reasoner wiring).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateResult, parseReasonerResponse, extractFirstValidJson, inferConfidence } from "./parse.js";

// ---------------------------------------------------------------------------
// validateResult — per-action-type field validation
// ---------------------------------------------------------------------------

describe("validateResult (parse.ts direct)", () => {
  // --- shape validation ---

  it("returns wait for undefined input", () => {
    const r = validateResult(undefined);
    assert.equal(r.actions[0].action, "wait");
  });

  it("returns wait for numeric input", () => {
    const r = validateResult(42);
    assert.equal(r.actions[0].action, "wait");
  });

  it("returns wait for array input (not an object)", () => {
    const r = validateResult([{ action: "wait" }]);
    // arrays are objects but don't have .actions
    assert.equal(r.actions[0].action, "wait");
  });

  // --- per-action field checks ---

  it("accepts start_session with valid session", () => {
    const r = validateResult({ actions: [{ action: "start_session", session: "s1" }] });
    assert.equal(r.actions[0].action, "start_session");
  });

  it("rejects start_session with empty session string", () => {
    const r = validateResult({ actions: [{ action: "start_session", session: "" }] });
    assert.equal(r.actions[0].action, "wait");
  });

  it("rejects start_session with numeric session", () => {
    const r = validateResult({ actions: [{ action: "start_session", session: 123 }] });
    assert.equal(r.actions[0].action, "wait");
  });

  it("accepts stop_session with valid session", () => {
    const r = validateResult({ actions: [{ action: "stop_session", session: "s1" }] });
    assert.equal(r.actions[0].action, "stop_session");
  });

  it("rejects stop_session with missing session", () => {
    const r = validateResult({ actions: [{ action: "stop_session" }] });
    assert.equal(r.actions[0].action, "wait");
  });

  it("accepts remove_agent with valid session", () => {
    const r = validateResult({ actions: [{ action: "remove_agent", session: "s1" }] });
    assert.equal(r.actions[0].action, "remove_agent");
  });

  it("rejects remove_agent with empty session", () => {
    const r = validateResult({ actions: [{ action: "remove_agent", session: "" }] });
    assert.equal(r.actions[0].action, "wait");
  });

  it("accepts create_agent with all required fields", () => {
    const r = validateResult({
      actions: [{ action: "create_agent", path: "/foo", title: "bar", tool: "opencode" }],
    });
    assert.equal(r.actions[0].action, "create_agent");
    if (r.actions[0].action === "create_agent") {
      assert.equal(r.actions[0].path, "/foo");
      assert.equal(r.actions[0].title, "bar");
      assert.equal(r.actions[0].tool, "opencode");
    }
  });

  it("rejects create_agent missing title", () => {
    const r = validateResult({
      actions: [{ action: "create_agent", path: "/foo", tool: "opencode" }],
    });
    assert.equal(r.actions[0].action, "wait");
  });

  it("rejects create_agent missing tool", () => {
    const r = validateResult({
      actions: [{ action: "create_agent", path: "/foo", title: "bar" }],
    });
    assert.equal(r.actions[0].action, "wait");
  });

  it("rejects create_agent with empty path", () => {
    const r = validateResult({
      actions: [{ action: "create_agent", path: "", title: "bar", tool: "opencode" }],
    });
    assert.equal(r.actions[0].action, "wait");
  });

  it("accepts wait with no reason", () => {
    const r = validateResult({ actions: [{ action: "wait" }] });
    assert.equal(r.actions[0].action, "wait");
  });

  it("accepts wait with reason", () => {
    const r = validateResult({ actions: [{ action: "wait", reason: "idle" }] });
    assert.equal(r.actions[0].action, "wait");
    if (r.actions[0].action === "wait") {
      assert.equal(r.actions[0].reason, "idle");
    }
  });

  it("coerces non-string wait reason to undefined", () => {
    const r = validateResult({ actions: [{ action: "wait", reason: 42 }] });
    if (r.actions[0].action === "wait") {
      assert.equal(r.actions[0].reason, undefined);
    }
  });

  it("accepts report_progress with session and summary", () => {
    const r = validateResult({
      actions: [{ action: "report_progress", session: "s1", summary: "50% done" }],
    });
    assert.equal(r.actions[0].action, "report_progress");
  });

  it("rejects report_progress with empty summary", () => {
    const r = validateResult({
      actions: [{ action: "report_progress", session: "s1", summary: "" }],
    });
    assert.equal(r.actions[0].action, "wait");
  });

  it("accepts complete_task with session and summary", () => {
    const r = validateResult({
      actions: [{ action: "complete_task", session: "s1", summary: "all green" }],
    });
    assert.equal(r.actions[0].action, "complete_task");
  });

  it("rejects complete_task with empty session", () => {
    const r = validateResult({
      actions: [{ action: "complete_task", session: "", summary: "done" }],
    });
    assert.equal(r.actions[0].action, "wait");
  });

  // --- mixed valid/invalid ---

  it("preserves order of valid actions while filtering invalid", () => {
    const r = validateResult({
      actions: [
        { action: "send_input", session: "s1", text: "hi" },
        { action: "unknown_type" },
        { action: "stop_session", session: "s2" },
        null,
        { action: "create_agent" }, // missing fields
        { action: "wait", reason: "end" },
      ],
    });
    assert.equal(r.actions.length, 3);
    assert.equal(r.actions[0].action, "send_input");
    assert.equal(r.actions[1].action, "stop_session");
    assert.equal(r.actions[2].action, "wait");
  });
});

// ---------------------------------------------------------------------------
// parseReasonerResponse — raw string → ReasonerResult
// ---------------------------------------------------------------------------

describe("parseReasonerResponse (parse.ts direct)", () => {
  it("parses JSON with leading/trailing newlines", () => {
    const raw = `\n\n{"actions": [{"action": "wait"}]}\n\n`;
    const r = parseReasonerResponse(raw);
    assert.equal(r.actions[0].action, "wait");
  });

  it("parses JSON wrapped in markdown with language tag and extra whitespace", () => {
    const raw = "Some text\n```json\n  { \"actions\": [{ \"action\": \"wait\" }] }  \n```\nmore text";
    const r = parseReasonerResponse(raw);
    assert.equal(r.actions[0].action, "wait");
  });

  it("falls back to balanced-brace scanner when code block JSON is invalid", () => {
    // code block has bad JSON, but a valid object exists outside it
    const raw = "```json\n{bad json\n```\nanyway {\"actions\": [{\"action\": \"wait\"}]}";
    const r = parseReasonerResponse(raw);
    assert.equal(r.actions[0].action, "wait");
  });

  it("handles response with only reasoning, no actions", () => {
    const raw = JSON.stringify({ reasoning: "thinking...", actions: [] });
    const r = parseReasonerResponse(raw);
    // empty actions → fallback wait
    assert.equal(r.actions[0].action, "wait");
  });

  it("handles response where actions field is missing entirely", () => {
    const raw = JSON.stringify({ reasoning: "hmm" });
    const r = parseReasonerResponse(raw);
    assert.equal(r.actions[0].action, "wait");
  });

  it("extracts valid actions from a mix of good and bad in fenced JSON", () => {
    const raw = "```json\n" + JSON.stringify({
      actions: [
        { action: "send_input", session: "s1", text: "go" },
        { action: "invalid" },
        { action: "wait" },
      ],
    }) + "\n```";
    const r = parseReasonerResponse(raw);
    assert.equal(r.actions.length, 2);
    assert.equal(r.actions[0].action, "send_input");
    assert.equal(r.actions[1].action, "wait");
  });

  it("handles complete LLM response with reasoning + multi-action", () => {
    const raw = JSON.stringify({
      reasoning: "Adventure is stuck on a permission prompt, CHV is idle",
      actions: [
        { action: "send_input", session: "adventure", text: "yes" },
        { action: "send_input", session: "chv", text: "continue the rebase" },
      ],
    });
    const r = parseReasonerResponse(raw);
    assert.equal(r.reasoning, "Adventure is stuck on a permission prompt, CHV is idle");
    assert.equal(r.actions.length, 2);
    assert.equal(r.actions[0].action, "send_input");
    assert.equal(r.actions[1].action, "send_input");
  });
});

// ---------------------------------------------------------------------------
// extractFirstValidJson — balanced brace scanner
// ---------------------------------------------------------------------------

describe("extractFirstValidJson (parse.ts direct)", () => {
  it("returns null for empty string", () => {
    assert.equal(extractFirstValidJson(""), null);
  });

  it("returns null for string with only closing braces", () => {
    assert.equal(extractFirstValidJson("}}}}"), null);
  });

  it("returns null for string with only opening braces", () => {
    assert.equal(extractFirstValidJson("{{{{"), null);
  });

  it("handles object at the very start of text", () => {
    const r = extractFirstValidJson('{"x": 1} rest') as Record<string, number>;
    assert.deepEqual(r, { x: 1 });
  });

  it("handles object at the very end of text", () => {
    const r = extractFirstValidJson('prefix {"x": 1}') as Record<string, number>;
    assert.deepEqual(r, { x: 1 });
  });

  it("extracts first valid object when first candidate is malformed", () => {
    const r = extractFirstValidJson('{bad} {"good": true}') as Record<string, boolean>;
    assert.deepEqual(r, { good: true });
  });

  it("handles string values containing backslash-escaped braces", () => {
    // JSON string: "a\\{b" which is the literal value a\{b
    const text = '{"val": "a\\\\{b"}';
    const r = extractFirstValidJson(text) as Record<string, string>;
    assert.ok(r !== null);
  });

  it("handles nested arrays inside objects", () => {
    const text = 'prefix {"arr": [1, {"nested": true}, 3]} suffix';
    const r = extractFirstValidJson(text) as Record<string, unknown>;
    assert.ok(r !== null);
    assert.ok(Array.isArray(r.arr));
  });

  it("handles empty object", () => {
    const r = extractFirstValidJson("some text {} more");
    assert.deepEqual(r, {});
  });

  it("handles deeply nested objects", () => {
    const text = '{"a": {"b": {"c": {"d": 1}}}}';
    const r = extractFirstValidJson(text) as Record<string, unknown>;
    assert.ok(r !== null);
    assert.deepEqual(r, { a: { b: { c: { d: 1 } } } });
  });

  it("resets depth on stray closing brace", () => {
    // stray } before the valid object shouldn't prevent finding it
    const text = '} {"valid": true}';
    const r = extractFirstValidJson(text) as Record<string, boolean>;
    assert.deepEqual(r, { valid: true });
  });

  it("ignores opening quote at depth 0", () => {
    // quote scanning only activates at depth > 0 to avoid false skips
    const text = '"not an object" {"real": 1}';
    const r = extractFirstValidJson(text) as Record<string, number>;
    assert.deepEqual(r, { real: 1 });
  });
});

// ── inferConfidence ───────────────────────────────────────────────────────────

describe("inferConfidence", () => {
  const waitAction = [{ action: "wait" as const }];
  const sendAction = [{ action: "send_input" as const, session: "x", text: "go" }];

  it("returns medium for undefined reasoning", () => {
    assert.equal(inferConfidence(undefined, sendAction), "medium");
  });

  it("returns high for clearly confident reasoning", () => {
    const r = inferConfidence("The agent has clearly completed the task and confirmed success.", sendAction);
    assert.equal(r, "high");
  });

  it("returns low for uncertain reasoning", () => {
    const r = inferConfidence("I'm not sure what the agent is doing. Maybe it's stuck, hard to tell.", waitAction);
    assert.equal(r, "low");
  });

  it("returns low for single uncertainty signal with no high signals", () => {
    const r = inferConfidence("This might be an error state.", waitAction);
    assert.equal(r, "low");
  });

  it("returns medium for mixed signals", () => {
    const r = inferConfidence("I can see progress but maybe there are still issues.", sendAction);
    assert.equal(r, "medium");
  });

  it("returns medium for neutral reasoning without strong signals", () => {
    const r = inferConfidence("The agent sent a message and is waiting for a response.", sendAction);
    assert.ok(r === "medium" || r === "high", `expected medium or high for neutral text, got ${r}`);
  });

  it("validateResult includes confidence field", () => {
    const parsed = {
      actions: [{ action: "wait" }],
      reasoning: "Clearly the agent has finished successfully.",
    };
    const result = validateResult(parsed);
    assert.ok(result.confidence !== undefined);
    assert.ok(["high", "medium", "low"].includes(result.confidence!));
  });
});
