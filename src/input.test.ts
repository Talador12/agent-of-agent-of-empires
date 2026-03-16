import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InputReader, INSIST_PREFIX, parseMouseEvent } from "./input.js";
import type { MouseEvent } from "./input.js";

describe("InputReader queue management", () => {
  let reader: InputReader;

  beforeEach(() => {
    reader = new InputReader();
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
});

describe("InputReader hasPending", () => {
  it("returns false when queue is empty", () => {
    const reader = new InputReader();
    assert.equal(reader.hasPending(), false);
  });

  it("returns true after inject", () => {
    const reader = new InputReader();
    reader.inject("hello");
    assert.equal(reader.hasPending(), true);
  });

  it("returns false after drain", () => {
    const reader = new InputReader();
    reader.inject("hello");
    reader.drain();
    assert.equal(reader.hasPending(), false);
  });

  it("returns true with multiple queued messages", () => {
    const reader = new InputReader();
    reader.inject("a");
    reader.inject("b");
    assert.equal(reader.hasPending(), true);
  });
});

describe("InputReader onQueueChange", () => {
  it("fires callback on inject", () => {
    const reader = new InputReader();
    const counts: number[] = [];
    reader.onQueueChange((c) => counts.push(c));
    reader.inject("hello");
    reader.inject("world");
    assert.deepEqual(counts, [1, 2]);
  });

  it("fires callback on drain (resets to 0)", () => {
    const reader = new InputReader();
    const counts: number[] = [];
    reader.inject("a");
    reader.onQueueChange((c) => counts.push(c));
    reader.drain();
    assert.deepEqual(counts, [0]);
  });

  it("does not fire on drain when queue was already empty", () => {
    const reader = new InputReader();
    const counts: number[] = [];
    reader.onQueueChange((c) => counts.push(c));
    reader.drain();
    assert.deepEqual(counts, []);
  });

  it("is safe to call without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.inject("msg"));
  });
});

describe("INSIST_PREFIX constant", () => {
  it("is a non-empty string", () => {
    assert.ok(INSIST_PREFIX.length > 0);
  });

  it("starts with __", () => {
    assert.ok(INSIST_PREFIX.startsWith("__"));
  });
});

describe("InputReader onView", () => {
  it("registers view handler without throwing", () => {
    const reader = new InputReader();
    const calls: Array<string | null> = [];
    reader.onView((target) => calls.push(target));
    assert.equal(calls.length, 0); // not called until command is issued
  });

  it("is safe to use without registering handler", () => {
    const reader = new InputReader();
    // no onView registered — should not throw
    assert.doesNotThrow(() => reader.drain());
  });
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

// ── parseMouseEvent ─────────────────────────────────────────────────────────

describe("parseMouseEvent", () => {
  it("parses left click press", () => {
    const evt = parseMouseEvent("\x1b[<0;15;3M");
    assert.ok(evt);
    assert.equal(evt.button, 0);
    assert.equal(evt.col, 15);
    assert.equal(evt.row, 3);
    assert.equal(evt.press, true);
  });

  it("parses left click release", () => {
    const evt = parseMouseEvent("\x1b[<0;15;3m");
    assert.ok(evt);
    assert.equal(evt.button, 0);
    assert.equal(evt.col, 15);
    assert.equal(evt.row, 3);
    assert.equal(evt.press, false);
  });

  it("parses right click (button 2)", () => {
    const evt = parseMouseEvent("\x1b[<2;10;5M");
    assert.ok(evt);
    assert.equal(evt.button, 2);
    assert.equal(evt.col, 10);
    assert.equal(evt.row, 5);
    assert.equal(evt.press, true);
  });

  it("parses middle click (button 1)", () => {
    const evt = parseMouseEvent("\x1b[<1;20;10M");
    assert.ok(evt);
    assert.equal(evt.button, 1);
    assert.equal(evt.col, 20);
    assert.equal(evt.row, 10);
  });

  it("parses scroll up (button 64)", () => {
    const evt = parseMouseEvent("\x1b[<64;5;8M");
    assert.ok(evt);
    assert.equal(evt.button, 64);
    assert.equal(evt.col, 5);
    assert.equal(evt.row, 8);
    assert.equal(evt.press, true);
  });

  it("parses scroll down (button 65)", () => {
    const evt = parseMouseEvent("\x1b[<65;5;8M");
    assert.ok(evt);
    assert.equal(evt.button, 65);
  });

  it("parses large coordinates", () => {
    const evt = parseMouseEvent("\x1b[<0;200;150M");
    assert.ok(evt);
    assert.equal(evt.col, 200);
    assert.equal(evt.row, 150);
  });

  it("parses single-digit coordinates", () => {
    const evt = parseMouseEvent("\x1b[<0;1;1M");
    assert.ok(evt);
    assert.equal(evt.col, 1);
    assert.equal(evt.row, 1);
  });

  it("returns null for non-mouse data", () => {
    assert.equal(parseMouseEvent("hello"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseMouseEvent(""), null);
  });

  it("returns null for regular ANSI escape", () => {
    assert.equal(parseMouseEvent("\x1b[32m"), null);
  });

  it("returns null for partial SGR mouse sequence", () => {
    assert.equal(parseMouseEvent("\x1b[<0;15"), null);
  });

  it("returns null for legacy X10 mouse (non-SGR)", () => {
    assert.equal(parseMouseEvent("\x1b[M !!"), null);
  });

  it("handles mouse data embedded in larger string", () => {
    const evt = parseMouseEvent("prefix\x1b[<0;10;5Msuffix");
    assert.ok(evt);
    assert.equal(evt.button, 0);
    assert.equal(evt.col, 10);
    assert.equal(evt.row, 5);
  });

  it("returns MouseEvent with all fields typed correctly", () => {
    const evt = parseMouseEvent("\x1b[<0;1;1M") as MouseEvent;
    assert.equal(typeof evt.button, "number");
    assert.equal(typeof evt.col, "number");
    assert.equal(typeof evt.row, "number");
    assert.equal(typeof evt.press, "boolean");
  });

  it("distinguishes press vs release for same coordinates", () => {
    const press = parseMouseEvent("\x1b[<0;10;5M");
    const release = parseMouseEvent("\x1b[<0;10;5m");
    assert.ok(press);
    assert.ok(release);
    assert.equal(press.press, true);
    assert.equal(release.press, false);
    assert.equal(press.col, release.col);
    assert.equal(press.row, release.row);
  });
});

// ── InputReader onMouseClick ────────────────────────────────────────────────

describe("InputReader onMouseClick", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const clicks: Array<[number, number]> = [];
    reader.onMouseClick((row, col) => clicks.push([row, col]));
    assert.equal(clicks.length, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const clicks1: Array<[number, number]> = [];
    const clicks2: Array<[number, number]> = [];
    reader.onMouseClick((row, col) => clicks1.push([row, col]));
    reader.onMouseClick((row, col) => clicks2.push([row, col]));
    // second handler should be the active one
    assert.equal(clicks1.length, 0);
    assert.equal(clicks2.length, 0);
  });
});

// ── InputReader onMouseWheel ────────────────────────────────────────────────

describe("InputReader onMouseWheel", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const dirs: string[] = [];
    reader.onMouseWheel((dir) => dirs.push(dir));
    assert.equal(dirs.length, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const dirs1: string[] = [];
    const dirs2: string[] = [];
    reader.onMouseWheel((dir) => dirs1.push(dir));
    reader.onMouseWheel((dir) => dirs2.push(dir));
    assert.equal(dirs1.length, 0);
    assert.equal(dirs2.length, 0);
  });
});
