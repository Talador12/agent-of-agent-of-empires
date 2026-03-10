import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InputReader } from "./input.js";

// InputReader depends on process.stdin.isTTY for start(), but we can test
// the queue/drain/inject logic and command handling without a real TTY.
// The handleLine method is private, but we can simulate it via inject() +
// the public interface, or test the logic patterns directly.

describe("InputReader queue management", () => {
  let reader: InputReader;

  beforeEach(() => {
    reader = new InputReader();
    // don't call start() -- it requires a TTY
  });

  it("drain returns empty array initially", () => {
    const msgs = reader.drain();
    assert.deepEqual(msgs, []);
  });

  it("inject adds message to queue", () => {
    reader.inject("hello world");
    const msgs = reader.drain();
    assert.deepEqual(msgs, ["hello world"]);
  });

  it("drain clears the queue", () => {
    reader.inject("msg1");
    reader.inject("msg2");
    const first = reader.drain();
    assert.equal(first.length, 2);
    const second = reader.drain();
    assert.deepEqual(second, []);
  });

  it("inject preserves order (FIFO)", () => {
    reader.inject("first");
    reader.inject("second");
    reader.inject("third");
    const msgs = reader.drain();
    assert.deepEqual(msgs, ["first", "second", "third"]);
  });

  it("multiple drain calls are safe", () => {
    assert.deepEqual(reader.drain(), []);
    assert.deepEqual(reader.drain(), []);
    assert.deepEqual(reader.drain(), []);
  });

  it("inject works after drain", () => {
    reader.inject("before");
    reader.drain();
    reader.inject("after");
    const msgs = reader.drain();
    assert.deepEqual(msgs, ["after"]);
  });
});

describe("InputReader pause state", () => {
  it("isPaused returns false initially", () => {
    const reader = new InputReader();
    assert.equal(reader.isPaused(), false);
  });

  // pause/resume is handled via private handleCommand, tested indirectly below
});

describe("InputReader stop", () => {
  it("stop is safe to call without start", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.stop());
  });

  it("stop is safe to call multiple times", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => {
      reader.stop();
      reader.stop();
    });
  });
});

// test handleCommand logic by replicating the switch statement
// (the actual method is private, but the logic is important to validate)
describe("handleCommand (logic)", () => {
  // replicated from input.ts handleLine + handleCommand
  function simulateHandleLine(
    queue: string[],
    paused: { value: boolean },
    line: string,
  ): void {
    if (!line) return;

    if (line.startsWith("/")) {
      const [cmd] = line.split(/\s+/);
      switch (cmd) {
        case "/help":
          // help just prints, no queue effect
          break;
        case "/pause":
          paused.value = true;
          break;
        case "/resume":
          paused.value = false;
          break;
        case "/status":
          queue.push("__CMD_STATUS__");
          break;
        case "/dashboard":
          queue.push("__CMD_DASHBOARD__");
          break;
        case "/verbose":
          queue.push("__CMD_VERBOSE__");
          break;
        case "/interrupt":
          queue.push("__CMD_INTERRUPT__");
          break;
        case "/tasks":
          queue.push("__CMD_DASHBOARD__"); // reuse dashboard
          break;
        default:
          // unknown command, no queue effect
          break;
      }
      return;
    }

    queue.push(line);
  }

  it("empty line is ignored", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "");
    assert.deepEqual(queue, []);
  });

  it("regular text is queued as user message", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "please check the tests");
    assert.deepEqual(queue, ["please check the tests"]);
  });

  it("/pause sets paused to true", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/pause");
    assert.equal(paused.value, true);
    assert.deepEqual(queue, []); // no queue effect
  });

  it("/resume sets paused to false", () => {
    const queue: string[] = [];
    const paused = { value: true };
    simulateHandleLine(queue, paused, "/resume");
    assert.equal(paused.value, false);
  });

  it("/status queues __CMD_STATUS__", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/status");
    assert.deepEqual(queue, ["__CMD_STATUS__"]);
  });

  it("/dashboard queues __CMD_DASHBOARD__", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/dashboard");
    assert.deepEqual(queue, ["__CMD_DASHBOARD__"]);
  });

  it("/verbose queues __CMD_VERBOSE__", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/verbose");
    assert.deepEqual(queue, ["__CMD_VERBOSE__"]);
  });

  it("/interrupt queues __CMD_INTERRUPT__", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/interrupt");
    assert.deepEqual(queue, ["__CMD_INTERRUPT__"]);
  });

  it("/tasks queues __CMD_DASHBOARD__ (alias)", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/tasks");
    assert.deepEqual(queue, ["__CMD_DASHBOARD__"]);
  });

  it("/help does not modify queue", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/help");
    assert.deepEqual(queue, []);
  });

  it("unknown command does not modify queue", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/nonexistent");
    assert.deepEqual(queue, []);
  });

  it("commands are case-sensitive (uppercase fails)", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/PAUSE");
    assert.equal(paused.value, false); // should NOT pause
    assert.deepEqual(queue, []); // unknown command, no queue effect
  });

  it("/pause and /resume toggle correctly", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "/pause");
    assert.equal(paused.value, true);
    simulateHandleLine(queue, paused, "/resume");
    assert.equal(paused.value, false);
    simulateHandleLine(queue, paused, "/pause");
    assert.equal(paused.value, true);
  });

  it("interleaved commands and messages", () => {
    const queue: string[] = [];
    const paused = { value: false };
    simulateHandleLine(queue, paused, "check the build");
    simulateHandleLine(queue, paused, "/status");
    simulateHandleLine(queue, paused, "also fix the tests");
    simulateHandleLine(queue, paused, "/dashboard");
    assert.deepEqual(queue, [
      "check the build",
      "__CMD_STATUS__",
      "also fix the tests",
      "__CMD_DASHBOARD__",
    ]);
  });
});
