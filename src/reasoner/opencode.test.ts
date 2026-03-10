import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReasonerResponse, validateResult } from "./opencode.js";
import { extractFirstValidJson } from "./parse.js";

describe("validateResult", () => {
  it("accepts valid action array", () => {
    const result = validateResult({
      reasoning: "all good",
      actions: [{ action: "wait", reason: "nothing to do" }],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
    assert.equal(result.reasoning, "all good");
  });

  it("filters out invalid actions (missing action field)", () => {
    const result = validateResult({
      actions: [
        { action: "wait", reason: "ok" },
        { notAnAction: true },
        "string-not-object",
        null,
      ],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("falls back to wait when no valid actions", () => {
    const result = validateResult({ actions: [] });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("falls back to wait when actions is not an array", () => {
    const result = validateResult({ actions: "not-array" });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("falls back to wait for non-object input", () => {
    const result = validateResult("just a string");
    assert.equal(result.actions[0].action, "wait");
  });

  it("falls back to wait for null input", () => {
    const result = validateResult(null);
    assert.equal(result.actions[0].action, "wait");
  });

  it("preserves reasoning string", () => {
    const result = validateResult({
      reasoning: "session is idle",
      actions: [{ action: "send_input", session: "abc", text: "continue" }],
    });
    assert.equal(result.reasoning, "session is idle");
  });

  it("ignores non-string reasoning", () => {
    const result = validateResult({
      reasoning: 42,
      actions: [{ action: "wait" }],
    });
    assert.equal(result.reasoning, undefined);
  });

  it("handles send_input action", () => {
    const result = validateResult({
      actions: [{ action: "send_input", session: "abc123", text: "do the thing" }],
    });
    assert.equal(result.actions.length, 1);
    const a = result.actions[0];
    assert.equal(a.action, "send_input");
    if (a.action === "send_input") {
      assert.equal(a.session, "abc123");
      assert.equal(a.text, "do the thing");
    }
  });

  it("handles multiple actions", () => {
    const result = validateResult({
      actions: [
        { action: "start_session", session: "s1" },
        { action: "send_input", session: "s2", text: "hello" },
        { action: "wait", reason: "done" },
      ],
    });
    assert.equal(result.actions.length, 3);
  });

  it("rejects send_input missing text field", () => {
    const result = validateResult({
      actions: [{ action: "send_input", session: "abc123" }],
    });
    // should fall back to wait since send_input without text is invalid
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("rejects send_input missing session field", () => {
    const result = validateResult({
      actions: [{ action: "send_input", text: "hello" }],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("rejects create_agent missing required fields", () => {
    const result = validateResult({
      actions: [{ action: "create_agent", path: "/foo" }],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("rejects unknown action types", () => {
    const result = validateResult({
      actions: [{ action: "delete_everything", session: "s1" }],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("keeps valid actions and discards malformed ones", () => {
    const result = validateResult({
      actions: [
        { action: "send_input", session: "s1", text: "hello" },
        { action: "send_input", session: "s2" }, // missing text
        { action: "wait", reason: "done" },
      ],
    });
    assert.equal(result.actions.length, 2);
    assert.equal(result.actions[0].action, "send_input");
    assert.equal(result.actions[1].action, "wait");
  });
});

describe("parseReasonerResponse", () => {
  it("parses direct JSON", () => {
    const json = JSON.stringify({
      reasoning: "looks good",
      actions: [{ action: "wait", reason: "all clear" }],
    });
    const result = parseReasonerResponse(json);
    assert.equal(result.reasoning, "looks good");
    assert.equal(result.actions[0].action, "wait");
  });

  it("extracts JSON from markdown code block", () => {
    const raw = `Here is my decision:
\`\`\`json
{"reasoning": "test", "actions": [{"action": "wait"}]}
\`\`\``;
    const result = parseReasonerResponse(raw);
    assert.equal(result.reasoning, "test");
    assert.equal(result.actions[0].action, "wait");
  });

  it("extracts JSON from bare code block", () => {
    const raw = `\`\`\`
{"actions": [{"action": "start_session", "session": "abc"}]}
\`\`\``;
    const result = parseReasonerResponse(raw);
    assert.equal(result.actions[0].action, "start_session");
  });

  it("finds JSON object in surrounding text", () => {
    const raw = `I think we should wait. {"reasoning": "idle", "actions": [{"action": "wait"}]} That's my call.`;
    const result = parseReasonerResponse(raw);
    assert.equal(result.actions[0].action, "wait");
  });

  it("falls back to wait on unparseable input", () => {
    const result = parseReasonerResponse("this is not json at all");
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("falls back to wait on empty input", () => {
    const result = parseReasonerResponse("");
    assert.equal(result.actions[0].action, "wait");
  });

  it("handles whitespace-padded JSON", () => {
    const raw = `   
    {"actions": [{"action": "wait", "reason": "padding"}]}
    `;
    const result = parseReasonerResponse(raw);
    assert.equal(result.actions[0].action, "wait");
  });

  it("picks first valid JSON when multiple objects exist in text", () => {
    // the old greedy regex would match from first { to last }, grabbing invalid combined text
    const raw = `Here: {"actions": [{"action": "wait"}]} and also {"actions": [{"action": "send_input", "session": "s1", "text": "hi"}]}`;
    const result = parseReasonerResponse(raw);
    // should parse the first valid JSON object, not a greedy match spanning both
    assert.equal(result.actions[0].action, "wait");
  });

  it("handles nested braces in JSON values correctly", () => {
    const raw = `Response: {"reasoning": "obj = {x: 1}", "actions": [{"action": "wait"}]}`;
    const result = parseReasonerResponse(raw);
    assert.equal(result.actions[0].action, "wait");
    assert.equal(result.reasoning, "obj = {x: 1}");
  });

  it("skips invalid JSON objects and finds the valid one", () => {
    const raw = `{invalid json here} then {"actions": [{"action": "wait", "reason": "found it"}]}`;
    const result = parseReasonerResponse(raw);
    assert.equal(result.actions[0].action, "wait");
  });

  it("handles braces inside JSON string values", () => {
    // LLM explains code with braces in the reasoning string
    const raw = `{"reasoning": "use { and } in code like function() { return 1; }", "actions": [{"action": "wait"}]}`;
    const result = parseReasonerResponse(raw);
    assert.equal(result.actions[0].action, "wait");
    assert.ok(result.reasoning?.includes("function()"));
  });

  it("handles escaped quotes inside JSON strings with braces", () => {
    const raw = `{"reasoning": "he said \\"use {braces}\\"", "actions": [{"action": "wait"}]}`;
    const result = parseReasonerResponse(raw);
    assert.equal(result.actions[0].action, "wait");
  });
});

describe("extractFirstValidJson (string-aware)", () => {
  it("extracts JSON with braces in string values", () => {
    const text = `blah {"key": "val with { and } inside"} blah`;
    const result = extractFirstValidJson(text) as Record<string, string>;
    assert.ok(result !== null);
    assert.equal(result.key, "val with { and } inside");
  });

  it("handles escaped quotes within strings", () => {
    const text = `prefix {"msg": "say \\"hello\\""} suffix`;
    const result = extractFirstValidJson(text) as Record<string, string>;
    assert.ok(result !== null);
    assert.equal(result.msg, 'say "hello"');
  });

  it("returns null for no valid JSON", () => {
    assert.equal(extractFirstValidJson("no json here"), null);
  });

  it("skips braces in strings and finds correct closing brace", () => {
    const text = `{"a": "}{}{", "b": 1}`;
    const result = extractFirstValidJson(text) as Record<string, unknown>;
    assert.ok(result !== null);
    assert.equal(result.a, "}{}{");
    assert.equal(result.b, 1);
  });

  it("handles deeply nested objects with string braces", () => {
    const text = `output: {"outer": {"inner": "has {braces}", "num": 42}}`;
    const result = extractFirstValidJson(text) as Record<string, unknown>;
    assert.ok(result !== null);
    assert.equal((result.outer as Record<string, unknown>).num, 42);
  });
});
