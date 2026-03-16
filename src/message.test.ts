import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyMessages,
  formatUserMessages,
  buildReceipts,
  shouldSkipSleep,
  hasPendingFile,
  isInsistMessage,
  stripInsistPrefix,
  INSIST_PREFIX,
} from "./message.js";

// --- classifyMessages ---

describe("classifyMessages", () => {
  it("separates commands from user messages", () => {
    const result = classifyMessages([
      "__CMD_STATUS__",
      "fix the bug",
      "__CMD_PAUSE__",
      "also add tests",
    ]);
    assert.deepEqual(result.commands, ["__CMD_STATUS__", "__CMD_PAUSE__"]);
    assert.deepEqual(result.userMessages, ["fix the bug", "also add tests"]);
  });

  it("returns empty arrays for empty input", () => {
    const result = classifyMessages([]);
    assert.deepEqual(result.commands, []);
    assert.deepEqual(result.userMessages, []);
  });

  it("handles all commands, no user messages", () => {
    const result = classifyMessages(["__CMD_VERBOSE__", "__CMD_DASHBOARD__"]);
    assert.deepEqual(result.commands, ["__CMD_VERBOSE__", "__CMD_DASHBOARD__"]);
    assert.deepEqual(result.userMessages, []);
  });

  it("handles all user messages, no commands", () => {
    const result = classifyMessages(["hello", "world"]);
    assert.deepEqual(result.commands, []);
    assert.deepEqual(result.userMessages, ["hello", "world"]);
  });

  it("preserves order within each bucket", () => {
    const result = classifyMessages([
      "first",
      "__CMD_A__",
      "second",
      "__CMD_B__",
      "third",
    ]);
    assert.deepEqual(result.userMessages, ["first", "second", "third"]);
    assert.deepEqual(result.commands, ["__CMD_A__", "__CMD_B__"]);
  });

  it("does not treat __CMD without trailing __ as command", () => {
    const result = classifyMessages(["__CMD_BROKEN", "__CMD_OK__"]);
    // __CMD_BROKEN starts with __CMD_ so it IS classified as command
    // (the contract is startsWith("__CMD_"), not a full marker pattern)
    assert.deepEqual(result.commands, ["__CMD_BROKEN", "__CMD_OK__"]);
    assert.deepEqual(result.userMessages, []);
  });
});

// --- formatUserMessages ---

describe("formatUserMessages", () => {
  it("returns empty string for no messages", () => {
    assert.equal(formatUserMessages([]), "");
  });

  it("passes through single message unchanged", () => {
    assert.equal(formatUserMessages(["fix the bug"]), "fix the bug");
  });

  it("numbers multiple messages", () => {
    const result = formatUserMessages(["fix the bug", "add tests", "run linter"]);
    assert.ok(result.includes("Operator message 1/3: fix the bug"));
    assert.ok(result.includes("Operator message 2/3: add tests"));
    assert.ok(result.includes("Operator message 3/3: run linter"));
  });

  it("separates numbered messages with newlines", () => {
    const result = formatUserMessages(["a", "b"]);
    const lines = result.split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith("Operator message 1/2:"));
    assert.ok(lines[1].startsWith("Operator message 2/2:"));
  });

  it("handles two messages", () => {
    const result = formatUserMessages(["first", "second"]);
    assert.ok(result.includes("1/2"));
    assert.ok(result.includes("2/2"));
  });

  it("preserves message content exactly", () => {
    const result = formatUserMessages(["fix bug in src/index.ts:42"]);
    assert.equal(result, "fix bug in src/index.ts:42");
  });
});

// --- buildReceipts ---

describe("buildReceipts", () => {
  it("returns empty array for no messages", () => {
    assert.deepEqual(buildReceipts([]), []);
  });

  it("returns single receipt without numbering", () => {
    const receipts = buildReceipts(["fix the bug"]);
    assert.equal(receipts.length, 1);
    assert.ok(receipts[0].includes("fix the bug"));
    assert.ok(receipts[0].startsWith("received:"));
    // should NOT have numbering for single message
    assert.ok(!receipts[0].includes("1/1"));
  });

  it("returns numbered receipts for multiple messages", () => {
    const receipts = buildReceipts(["fix bug", "add test", "run lint"]);
    assert.equal(receipts.length, 3);
    assert.ok(receipts[0].includes("(1/3)"));
    assert.ok(receipts[0].includes("fix bug"));
    assert.ok(receipts[1].includes("(2/3)"));
    assert.ok(receipts[1].includes("add test"));
    assert.ok(receipts[2].includes("(3/3)"));
    assert.ok(receipts[2].includes("run lint"));
  });

  it("truncates long messages in receipts", () => {
    const longMsg = "x".repeat(200);
    const receipts = buildReceipts([longMsg]);
    assert.equal(receipts.length, 1);
    assert.ok(receipts[0].length < 200, "receipt should be truncated");
    assert.ok(receipts[0].includes("..."), "truncated receipt should end with ...");
  });

  it("truncates long messages in multi-message receipts", () => {
    const longMsg = "y".repeat(200);
    const receipts = buildReceipts([longMsg, "short"]);
    assert.equal(receipts.length, 2);
    assert.ok(receipts[0].includes("..."));
    assert.ok(receipts[1].includes("short"));
  });

  it("does not truncate messages under the limit", () => {
    const msg = "x".repeat(50);
    const receipts = buildReceipts([msg]);
    assert.ok(!receipts[0].includes("..."));
    assert.ok(receipts[0].includes(msg));
  });
});

// --- shouldSkipSleep ---

describe("shouldSkipSleep", () => {
  it("returns true when stdin has pending messages", () => {
    assert.equal(shouldSkipSleep({ hasPendingStdin: true, hasPendingFile: false, interrupted: false }), true);
  });

  it("returns true when file IPC has pending messages", () => {
    assert.equal(shouldSkipSleep({ hasPendingStdin: false, hasPendingFile: true, interrupted: false }), true);
  });

  it("returns true when interrupted", () => {
    assert.equal(shouldSkipSleep({ hasPendingStdin: false, hasPendingFile: false, interrupted: true }), true);
  });

  it("returns false when nothing is pending", () => {
    assert.equal(shouldSkipSleep({ hasPendingStdin: false, hasPendingFile: false, interrupted: false }), false);
  });

  it("returns true when multiple sources have pending messages", () => {
    assert.equal(shouldSkipSleep({ hasPendingStdin: true, hasPendingFile: true, interrupted: false }), true);
  });

  it("returns true when all flags are set", () => {
    assert.equal(shouldSkipSleep({ hasPendingStdin: true, hasPendingFile: true, interrupted: true }), true);
  });
});

// --- hasPendingFile ---

describe("hasPendingFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "msg-test-"));
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it("returns false when file does not exist", () => {
    assert.equal(hasPendingFile(join(dir, "nope.txt")), false);
  });

  it("returns false when file is empty", () => {
    const f = join(dir, "empty.txt");
    writeFileSync(f, "");
    assert.equal(hasPendingFile(f), false);
  });

  it("returns true when file has content", () => {
    const f = join(dir, "pending.txt");
    writeFileSync(f, "hello\n");
    assert.equal(hasPendingFile(f), true);
  });

  it("returns true for file with single newline", () => {
    const f = join(dir, "newline.txt");
    writeFileSync(f, "\n");
    assert.equal(hasPendingFile(f), true);
  });

  it("returns true for multi-line content", () => {
    const f = join(dir, "multi.txt");
    writeFileSync(f, "line1\nline2\nline3\n");
    assert.equal(hasPendingFile(f), true);
  });
});

// --- integration: full message flow ---

describe("message flow — classify, format, receipt", () => {
  it("handles a burst of messages during reasoning", () => {
    // simulate: user types 3 messages while daemon is reasoning
    const raw = [
      "fix the type error in config.ts",
      "__CMD_DASHBOARD__",
      "also update the test",
      "and run the linter when done",
    ];

    // step 1: classify
    const { commands, userMessages } = classifyMessages(raw);
    assert.equal(commands.length, 1);
    assert.equal(userMessages.length, 3);

    // step 2: format for reasoner
    const formatted = formatUserMessages(userMessages);
    assert.ok(formatted.includes("1/3"));
    assert.ok(formatted.includes("2/3"));
    assert.ok(formatted.includes("3/3"));
    assert.ok(formatted.includes("fix the type error"));
    assert.ok(formatted.includes("also update the test"));
    assert.ok(formatted.includes("run the linter"));

    // step 3: generate receipts for conversation log
    const receipts = buildReceipts(userMessages);
    assert.equal(receipts.length, 3);
    for (const r of receipts) {
      assert.ok(r.startsWith("received ("));
    }
  });

  it("handles single message (common case)", () => {
    const raw = ["check on the build"];

    const { commands, userMessages } = classifyMessages(raw);
    assert.equal(commands.length, 0);
    assert.equal(userMessages.length, 1);

    const formatted = formatUserMessages(userMessages);
    assert.equal(formatted, "check on the build");

    const receipts = buildReceipts(userMessages);
    assert.equal(receipts.length, 1);
    assert.ok(receipts[0].startsWith("received:"));
  });

  it("handles only commands (no user messages)", () => {
    const raw = ["__CMD_STATUS__", "__CMD_VERBOSE__"];

    const { commands, userMessages } = classifyMessages(raw);
    assert.equal(commands.length, 2);
    assert.equal(userMessages.length, 0);

    const formatted = formatUserMessages(userMessages);
    assert.equal(formatted, "");

    const receipts = buildReceipts(userMessages);
    assert.equal(receipts.length, 0);
  });
});

// --- isInsistMessage ---

describe("isInsistMessage", () => {
  it("returns true for insist-prefixed message", () => {
    assert.equal(isInsistMessage(`${INSIST_PREFIX}fix this now`), true);
  });

  it("returns false for normal message", () => {
    assert.equal(isInsistMessage("fix this now"), false);
  });

  it("returns false for command marker", () => {
    assert.equal(isInsistMessage("__CMD_STATUS__"), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isInsistMessage(""), false);
  });
});

// --- stripInsistPrefix ---

describe("stripInsistPrefix", () => {
  it("strips the prefix from an insist message", () => {
    assert.equal(stripInsistPrefix(`${INSIST_PREFIX}hello world`), "hello world");
  });

  it("returns the message unchanged if no prefix", () => {
    assert.equal(stripInsistPrefix("hello world"), "hello world");
  });

  it("handles empty message after prefix", () => {
    assert.equal(stripInsistPrefix(INSIST_PREFIX), "");
  });
});
