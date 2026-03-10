import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReasonerResponse, validateResult } from "./opencode.js";

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
});
