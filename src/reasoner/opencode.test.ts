import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseReasonerResponse, validateResult, OpencodeReasoner } from "./opencode.js";
import { extractFirstValidJson } from "./parse.js";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

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

  it("handles report_progress action", () => {
    const result = validateResult({
      actions: [{ action: "report_progress", session: "s1", summary: "auth feature done" }],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "report_progress");
  });

  it("rejects report_progress missing summary", () => {
    const result = validateResult({
      actions: [{ action: "report_progress", session: "s1" }],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "wait");
  });

  it("handles complete_task action", () => {
    const result = validateResult({
      actions: [{ action: "complete_task", session: "s1", summary: "all tests pass" }],
    });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].action, "complete_task");
  });

  it("rejects complete_task missing session", () => {
    const result = validateResult({
      actions: [{ action: "complete_task", summary: "done" }],
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

// -- mock opencode HTTP server for testing OpencodeReasoner --

function createMockServer(): { server: Server; port: () => number; sessionsCreated: string[]; messagesReceived: Array<{ sessionId: string; noReply: boolean }> } {
  let nextSessionNum = 0;
  const sessionsCreated: string[] = [];
  const messagesReceived: Array<{ sessionId: string; noReply: boolean }> = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/global/health") {
      res.writeHead(200).end("ok");
      return;
    }
    if (req.method === "POST" && req.url === "/session") {
      const id = `mock-session-${nextSessionNum++}`;
      sessionsCreated.push(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id }));
      return;
    }
    const messageMatch = req.url?.match(/^\/session\/([^/]+)\/message$/);
    if (req.method === "POST" && messageMatch) {
      const sessionId = messageMatch[1];
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        messagesReceived.push({ sessionId, noReply: !!parsed.noReply });
        if (parsed.noReply) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            parts: [{ type: "text", text: '{"actions": [{"action": "wait", "reason": "mock"}]}' }],
          }));
        }
      });
      return;
    }
    res.writeHead(404).end("not found");
  });

  return {
    server,
    port: () => (server.address() as { port: number }).port,
    sessionsCreated,
    messagesReceived,
  };
}

function makeConfig(port: number): import("../types.js").AoaoeConfig {
  return {
    reasoner: "opencode",
    pollIntervalMs: 5000,
    opencode: { port },
    claudeCode: { yolo: false, resume: false },
    aoe: { profile: "default" },
    policies: { maxIdleBeforeNudgeMs: 60000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
    contextFiles: [],
    sessionDirs: {},
    captureLinesCount: 100,
    verbose: false,
    dryRun: false,
    observe: false,
    confirm: false,
    protectedSessions: [],
  };
}

function makeObservation(): import("../types.js").Observation {
  return { timestamp: Date.now(), sessions: [], changes: [] };
}

describe("OpencodeReasoner session rotation", () => {
  let mockServer: ReturnType<typeof createMockServer> | null = null;

  afterEach(() => {
    if (mockServer) {
      mockServer.server.close();
      mockServer = null;
    }
  });

  it("creates a new session on first decide call", async () => {
    mockServer = createMockServer();
    await new Promise<void>((r) => mockServer!.server.listen(0, "127.0.0.1", r));
    const reasoner = new OpencodeReasoner(makeConfig(mockServer.port()));
    await reasoner.init();

    await reasoner.decide(makeObservation());

    assert.equal(mockServer.sessionsCreated.length, 1);
    // system prompt (noReply) + observation (with reply)
    assert.equal(mockServer.messagesReceived.length, 2);
    assert.equal(mockServer.messagesReceived[0].noReply, true);
    assert.equal(mockServer.messagesReceived[1].noReply, false);

    await reasoner.shutdown();
  });

  it("reuses session for subsequent calls within rotation limit", async () => {
    mockServer = createMockServer();
    await new Promise<void>((r) => mockServer!.server.listen(0, "127.0.0.1", r));
    const reasoner = new OpencodeReasoner(makeConfig(mockServer.port()));
    await reasoner.init();

    await reasoner.decide(makeObservation());
    await reasoner.decide(makeObservation());
    await reasoner.decide(makeObservation());

    // only 1 session created, reused for all 3 calls
    assert.equal(mockServer.sessionsCreated.length, 1);
    // 1 system prompt + 3 observations
    assert.equal(mockServer.messagesReceived.length, 4);
    // all messages sent to the same session
    const uniqueSessions = new Set(mockServer.messagesReceived.map((m) => m.sessionId));
    assert.equal(uniqueSessions.size, 1);

    await reasoner.shutdown();
  });

  it(`rotates session after MAX_SESSION_MESSAGES (${OpencodeReasoner.MAX_SESSION_MESSAGES}) calls`, async () => {
    mockServer = createMockServer();
    await new Promise<void>((r) => mockServer!.server.listen(0, "127.0.0.1", r));
    const reasoner = new OpencodeReasoner(makeConfig(mockServer.port()));
    await reasoner.init();

    // make exactly MAX_SESSION_MESSAGES + 1 calls
    for (let i = 0; i < OpencodeReasoner.MAX_SESSION_MESSAGES + 1; i++) {
      await reasoner.decide(makeObservation());
    }

    // should have created 2 sessions: first one + rotated one
    assert.equal(mockServer.sessionsCreated.length, 2);
    assert.notEqual(mockServer.sessionsCreated[0], mockServer.sessionsCreated[1]);

    // the last message should be on the second session
    const lastMsg = mockServer.messagesReceived[mockServer.messagesReceived.length - 1];
    assert.equal(lastMsg.sessionId, mockServer.sessionsCreated[1]);

    await reasoner.shutdown();
  });

  it("multiple rotations create multiple sessions", async () => {
    mockServer = createMockServer();
    await new Promise<void>((r) => mockServer!.server.listen(0, "127.0.0.1", r));
    const reasoner = new OpencodeReasoner(makeConfig(mockServer.port()));
    await reasoner.init();

    // 2 full rotations + 1 extra call
    const totalCalls = OpencodeReasoner.MAX_SESSION_MESSAGES * 2 + 1;
    for (let i = 0; i < totalCalls; i++) {
      await reasoner.decide(makeObservation());
    }

    assert.equal(mockServer.sessionsCreated.length, 3);

    await reasoner.shutdown();
  });

  it("resets session on abort so next call starts fresh", async () => {
    mockServer = createMockServer();
    await new Promise<void>((r) => mockServer!.server.listen(0, "127.0.0.1", r));
    const reasoner = new OpencodeReasoner(makeConfig(mockServer.port()));
    await reasoner.init();

    // first call succeeds normally
    await reasoner.decide(makeObservation());
    assert.equal(mockServer.sessionsCreated.length, 1);

    // second call with pre-aborted signal
    const ac = new AbortController();
    ac.abort();
    const result = await reasoner.decide(makeObservation(), ac.signal);
    assert.equal(result.actions[0].action, "wait");

    // third call should create a fresh session (abort reset the old one)
    await reasoner.decide(makeObservation());
    assert.equal(mockServer.sessionsCreated.length, 2, "abort should have triggered session reset");

    await reasoner.shutdown();
  });

  it("MAX_SESSION_MESSAGES constant is a reasonable value", () => {
    // sanity: rotation threshold should be between 3 and 20
    assert.ok(OpencodeReasoner.MAX_SESSION_MESSAGES >= 3, "rotation threshold too low");
    assert.ok(OpencodeReasoner.MAX_SESSION_MESSAGES <= 20, "rotation threshold too high");
  });
});

describe("OpencodeReasoner error recovery", () => {
  let mockServer: ReturnType<typeof createMockServer> | null = null;

  afterEach(() => {
    if (mockServer) {
      mockServer.server.close();
      mockServer = null;
    }
  });

  it("creates new session after server error on previous call", async () => {
    // start a server that will fail on the 2nd observation message
    let callCount = 0;
    const sessionsCreated: string[] = [];
    let nextSessionNum = 0;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === "/global/health") { res.writeHead(200).end("ok"); return; }
      if (req.method === "POST" && req.url === "/session") {
        const id = `err-session-${nextSessionNum++}`;
        sessionsCreated.push(id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id }));
        return;
      }
      if (req.method === "POST" && req.url?.includes("/message")) {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk; });
        req.on("end", () => {
          const parsed = JSON.parse(body);
          if (parsed.noReply) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
            return;
          }
          callCount++;
          if (callCount === 2) {
            // fail on 2nd observation
            res.writeHead(500).end("internal error");
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            parts: [{ type: "text", text: '{"actions": [{"action": "wait"}]}' }],
          }));
        });
        return;
      }
      res.writeHead(404).end("not found");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    const reasoner = new OpencodeReasoner(makeConfig(port));
    await reasoner.init();

    // first call succeeds
    const r1 = await reasoner.decide(makeObservation());
    assert.equal(r1.actions[0].action, "wait");
    assert.equal(sessionsCreated.length, 1);

    // second call fails (500 error), reasoner retries with fresh session
    const r2 = await reasoner.decide(makeObservation());
    assert.equal(r2.actions[0].action, "wait");
    // error + retry = 2 new sessions (original reset + retry creates new)
    assert.ok(sessionsCreated.length >= 2, `expected >=2 sessions, got ${sessionsCreated.length}`);

    await reasoner.shutdown();
    server.close();
  });
});
