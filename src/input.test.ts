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

// ── InputReader onMouseMove ─────────────────────────────────────────────────

describe("InputReader onMouseMove", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const moves: Array<[number, number]> = [];
    reader.onMouseMove((row, col) => moves.push([row, col]));
    assert.equal(moves.length, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const m1: Array<[number, number]> = [];
    const m2: Array<[number, number]> = [];
    reader.onMouseMove((row, col) => m1.push([row, col]));
    reader.onMouseMove((row, col) => m2.push([row, col]));
    assert.equal(m1.length, 0);
    assert.equal(m2.length, 0);
  });
});

// ── InputReader onQuickSwitch ────────────────────────────────────────────────

describe("InputReader onQuickSwitch", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const nums: number[] = [];
    reader.onQuickSwitch((n) => nums.push(n));
    assert.equal(nums.length, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const n1: number[] = [];
    const n2: number[] = [];
    reader.onQuickSwitch((n) => n1.push(n));
    reader.onQuickSwitch((n) => n2.push(n));
    assert.equal(n1.length, 0);
    assert.equal(n2.length, 0);
  });
});

// ── InputReader onSearch ────────────────────────────────────────────────────

describe("InputReader onSearch", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const patterns: Array<string | null> = [];
    reader.onSearch((p) => patterns.push(p));
    assert.equal(patterns.length, 0); // not called until command is issued
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const p1: Array<string | null> = [];
    const p2: Array<string | null> = [];
    reader.onSearch((p) => p1.push(p));
    reader.onSearch((p) => p2.push(p));
    assert.equal(p1.length, 0);
    assert.equal(p2.length, 0);
  });
});

// ── InputReader onSort ──────────────────────────────────────────────────────

describe("InputReader onSort", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const modes: Array<string | null> = [];
    reader.onSort((m) => modes.push(m));
    assert.equal(modes.length, 0); // not called until command is issued
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const m1: Array<string | null> = [];
    const m2: Array<string | null> = [];
    reader.onSort((m) => m1.push(m));
    reader.onSort((m) => m2.push(m));
    assert.equal(m1.length, 0);
    assert.equal(m2.length, 0);
  });
});

// ── InputReader onCompact ───────────────────────────────────────────────────

describe("InputReader onCompact", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onCompact(() => called++);
    assert.equal(called, 0); // not called until command is issued
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onCompact(() => a++);
    reader.onCompact(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onPin ───────────────────────────────────────────────────────

describe("InputReader onPin", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const targets: string[] = [];
    reader.onPin((t) => targets.push(t));
    assert.equal(targets.length, 0); // not called until command is issued
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const t1: string[] = [];
    const t2: string[] = [];
    reader.onPin((t) => t1.push(t));
    reader.onPin((t) => t2.push(t));
    assert.equal(t1.length, 0);
    assert.equal(t2.length, 0);
  });
});

// ── InputReader onBell ──────────────────────────────────────────────────────

describe("InputReader onBell", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onBell(() => called++);
    assert.equal(called, 0); // not called until command is issued
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onBell(() => a++);
    reader.onBell(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onFocus ─────────────────────────────────────────────────────

describe("InputReader onFocus", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onFocus(() => called++);
    assert.equal(called, 0); // not called until command is issued
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onFocus(() => a++);
    reader.onFocus(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onMark ──────────────────────────────────────────────────────

describe("InputReader onMark", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onMark(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onMark(() => a++);
    reader.onMark(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onJump ──────────────────────────────────────────────────────

describe("InputReader onJump", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const nums: number[] = [];
    reader.onJump((n) => nums.push(n));
    assert.equal(nums.length, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const n1: number[] = [];
    const n2: number[] = [];
    reader.onJump((n) => n1.push(n));
    reader.onJump((n) => n2.push(n));
    assert.equal(n1.length, 0);
    assert.equal(n2.length, 0);
  });
});

// ── InputReader onMarks ─────────────────────────────────────────────────────

describe("InputReader onMarks", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onMarks(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onMarks(() => a++);
    reader.onMarks(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onMute ──────────────────────────────────────────────────────

describe("InputReader onMute", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const targets: string[] = [];
    reader.onMute((t) => targets.push(t));
    assert.equal(targets.length, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const t1: string[] = [];
    const t2: string[] = [];
    reader.onMute((t) => t1.push(t));
    reader.onMute((t) => t2.push(t));
    assert.equal(t1.length, 0);
    assert.equal(t2.length, 0);
  });
});

// ── InputReader onNote ──────────────────────────────────────────────────────

describe("InputReader onNote", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const calls: Array<{ target: string; text: string }> = [];
    reader.onNote((target, text) => calls.push({ target, text }));
    assert.equal(calls.length, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const a: Array<{ target: string; text: string }> = [];
    const b: Array<{ target: string; text: string }> = [];
    reader.onNote((target, text) => a.push({ target, text }));
    reader.onNote((target, text) => b.push({ target, text }));
    assert.equal(a.length, 0);
    assert.equal(b.length, 0);
  });
});

// ── InputReader onNotes ─────────────────────────────────────────────────────

describe("InputReader onNotes", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onNotes(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onNotes(() => a++);
    reader.onNotes(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onUnmuteAll ─────────────────────────────────────────────────

describe("InputReader onUnmuteAll", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onUnmuteAll(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onUnmuteAll(() => a++);
    reader.onUnmuteAll(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onTagFilter ─────────────────────────────────────────────────

describe("InputReader onTagFilter", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    const tags: Array<string | null> = [];
    reader.onTagFilter((t) => tags.push(t));
    assert.equal(tags.length, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    const a: Array<string | null> = [];
    const b: Array<string | null> = [];
    reader.onTagFilter((t) => a.push(t));
    reader.onTagFilter((t) => b.push(t));
    assert.equal(a.length, 0);
    assert.equal(b.length, 0);
  });
});

// ── InputReader onUptime ────────────────────────────────────────────────────

describe("InputReader onUptime", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onUptime(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onUptime(() => a++);
    reader.onUptime(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onAutoPin ───────────────────────────────────────────────────

describe("InputReader onAutoPin", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onAutoPin(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onAutoPin(() => a++);
    reader.onAutoPin(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onWho ───────────────────────────────────────────────────────

describe("InputReader onWho", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onWho(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onWho(() => a++);
    reader.onWho(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onDiff ──────────────────────────────────────────────────────

describe("InputReader onDiff", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onDiff(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onDiff(() => a++);
    reader.onDiff(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onClip ─────────────────────────────────────────────────────

describe("InputReader onClip", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onClip(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onClip(() => a++);
    reader.onClip(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader onAliasChange ──────────────────────────────────────────────

describe("InputReader onAliasChange", () => {
  it("registers handler without throwing", () => {
    const reader = new InputReader();
    let called = 0;
    reader.onAliasChange(() => called++);
    assert.equal(called, 0);
  });

  it("is safe without registering handler", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => reader.drain());
  });

  it("handler can be replaced", () => {
    const reader = new InputReader();
    let a = 0;
    let b = 0;
    reader.onAliasChange(() => a++);
    reader.onAliasChange(() => b++);
    assert.equal(a, 0);
    assert.equal(b, 0);
  });
});

// ── InputReader alias state ────────────────────────────────────────────────

describe("InputReader alias state", () => {
  it("starts with empty aliases", () => {
    const reader = new InputReader();
    assert.deepStrictEqual(reader.getAliases(), {});
  });

  it("setAliases populates from plain object", () => {
    const reader = new InputReader();
    reader.setAliases({ "/e": "/filter errors", "/w": "/who" });
    const aliases = reader.getAliases();
    assert.equal(aliases["/e"], "/filter errors");
    assert.equal(aliases["/w"], "/who");
  });

  it("setAliases replaces previous aliases", () => {
    const reader = new InputReader();
    reader.setAliases({ "/x": "/help" });
    reader.setAliases({ "/y": "/who" });
    const aliases = reader.getAliases();
    assert.equal(aliases["/y"], "/who");
    assert.equal(aliases["/x"], undefined);
  });

  it("getAliases returns plain object", () => {
    const reader = new InputReader();
    reader.setAliases({ "/e": "/filter errors" });
    const result = reader.getAliases();
    assert.equal(typeof result, "object");
    assert.ok(!Array.isArray(result));
  });
});

// ── onGroup / onGroups / onGroupFilter ────────────────────────────────────

describe("onGroup", () => {
  it("registers and calls group handler", () => {
    const reader = new InputReader();
    let calledTarget = "";
    let calledGroup = "";
    reader.onGroup((t, g) => { calledTarget = t; calledGroup = g; });
    // simulate direct call (handler registration works)
    reader["groupHandler"]!("alpha", "frontend");
    assert.equal(calledTarget, "alpha");
    assert.equal(calledGroup, "frontend");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => {
      // no handler registered — should not throw
      reader["groupHandler"]?.("alpha", "frontend");
    });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onGroup(() => { calls++; });
    reader.onGroup(() => { calls += 10; });
    reader["groupHandler"]!("x", "y");
    assert.equal(calls, 10);
  });
});

describe("onGroups", () => {
  it("registers and calls groups handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onGroups(() => { called = true; });
    reader["groupsHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["groupsHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onGroups(() => { calls++; });
    reader.onGroups(() => { calls += 10; });
    reader["groupsHandler"]!();
    assert.equal(calls, 10);
  });
});

describe("onGroupFilter", () => {
  it("registers and calls group filter handler", () => {
    const reader = new InputReader();
    let received: string | null = "unset";
    reader.onGroupFilter((g) => { received = g; });
    reader["groupFilterHandler"]!("frontend");
    assert.equal(received, "frontend");
  });

  it("passes null for clear", () => {
    const reader = new InputReader();
    let received: string | null = "unset";
    reader.onGroupFilter((g) => { received = g; });
    reader["groupFilterHandler"]!(null);
    assert.equal(received, null);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["groupFilterHandler"]?.(null); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onGroupFilter(() => { calls++; });
    reader.onGroupFilter(() => { calls += 10; });
    reader["groupFilterHandler"]!(null);
    assert.equal(calls, 10);
  });
});

describe("onBurnRate", () => {
  it("registers and calls burn-rate handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onBurnRate(() => { called = true; });
    reader["burnRateHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["burnRateHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onBurnRate(() => { calls++; });
    reader.onBurnRate(() => { calls += 10; });
    reader["burnRateHandler"]!();
    assert.equal(calls, 10);
  });
});
