import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InputReader, INSIST_PREFIX, parseMouseEvent, parseNaturalTaskIntent } from "./input.js";
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

  it("parses legacy X10 mouse format (\\x1b[M + 3 bytes)", () => {
    // X10: \x1b[M then btn+32, col+32, row+32 — space(32)=0, !(33)=1
    const evt = parseMouseEvent("\x1b[M !!"); // btn=0, col=1, row=1
    assert.ok(evt !== null);
    assert.equal(evt!.button, 0);
    assert.equal(evt!.col, 1);
    assert.equal(evt!.row, 1);
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

describe("onCopySession", () => {
  it("registers and calls handler with null (current session)", () => {
    const reader = new InputReader();
    let received: string | null = "unset";
    reader.onCopySession((t) => { received = t; });
    reader["copySessionHandler"]!(null);
    assert.equal(received, null);
  });

  it("registers and calls handler with target", () => {
    const reader = new InputReader();
    let received: string | null = "unset";
    reader.onCopySession((t) => { received = t; });
    reader["copySessionHandler"]!("alpha");
    assert.equal(received, "alpha");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["copySessionHandler"]?.(null); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onCopySession(() => { calls++; });
    reader.onCopySession(() => { calls += 10; });
    reader["copySessionHandler"]!(null);
    assert.equal(calls, 10);
  });
});

describe("onRename", () => {
  it("registers and calls rename handler with target and name", () => {
    const reader = new InputReader();
    let tgt = "", nm = "";
    reader.onRename((t, n) => { tgt = t; nm = n; });
    reader["renameHandler"]!("alpha", "My Alpha");
    assert.equal(tgt, "alpha");
    assert.equal(nm, "My Alpha");
  });

  it("registers and calls rename handler with empty name (clear)", () => {
    const reader = new InputReader();
    let nm = "not-empty";
    reader.onRename((_t, n) => { nm = n; });
    reader["renameHandler"]!("alpha", "");
    assert.equal(nm, "");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["renameHandler"]?.("alpha", "Foo"); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onRename(() => { calls++; });
    reader.onRename(() => { calls += 10; });
    reader["renameHandler"]!("x", "y");
    assert.equal(calls, 10);
  });
});

describe("onCeiling", () => {
  it("registers and calls ceiling handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onCeiling(() => { called = true; });
    reader["ceilingHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["ceilingHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onCeiling(() => { calls++; });
    reader.onCeiling(() => { calls += 10; });
    reader["ceilingHandler"]!();
    assert.equal(calls, 10);
  });
});

describe("onTop", () => {
  it("registers and calls top handler with mode", () => {
    const reader = new InputReader();
    let received = "";
    reader.onTop((m) => { received = m; });
    reader["topHandler"]!("errors");
    assert.equal(received, "errors");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["topHandler"]?.("default"); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onTop(() => { calls++; });
    reader.onTop(() => { calls += 10; });
    reader["topHandler"]!("burn");
    assert.equal(calls, 10);
  });
});

describe("onWatchdog", () => {
  it("registers and calls watchdog handler with minutes", () => {
    const reader = new InputReader();
    let received: number | null = -1;
    reader.onWatchdog((m) => { received = m; });
    reader["watchdogHandler"]!(10);
    assert.equal(received, 10);
  });

  it("registers and calls watchdog handler with null (off)", () => {
    const reader = new InputReader();
    let received: number | null = -1;
    reader.onWatchdog((m) => { received = m; });
    reader["watchdogHandler"]!(null);
    assert.equal(received, null);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["watchdogHandler"]?.(5); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onWatchdog(() => { calls++; });
    reader.onWatchdog(() => { calls += 10; });
    reader["watchdogHandler"]!(10);
    assert.equal(calls, 10);
  });
});

describe("onBroadcast", () => {
  it("registers and calls broadcast handler with message and no group", () => {
    const reader = new InputReader();
    let msg = "";
    let grp: string | null = "unset";
    reader.onBroadcast((m, g) => { msg = m; grp = g; });
    reader["broadcastHandler"]!("hello agents", null);
    assert.equal(msg, "hello agents");
    assert.equal(grp, null);
  });

  it("registers and calls broadcast handler with group", () => {
    const reader = new InputReader();
    let msg = "";
    let grp: string | null = "unset";
    reader.onBroadcast((m, g) => { msg = m; grp = g; });
    reader["broadcastHandler"]!("rebase now", "frontend");
    assert.equal(msg, "rebase now");
    assert.equal(grp, "frontend");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["broadcastHandler"]?.("msg", null); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onBroadcast(() => { calls++; });
    reader.onBroadcast(() => { calls += 10; });
    reader["broadcastHandler"]!("x", null);
    assert.equal(calls, 10);
  });
});

describe("onSnapshot", () => {
  it("registers and calls snapshot handler with json format", () => {
    const reader = new InputReader();
    let received: string = "";
    reader.onSnapshot((fmt) => { received = fmt; });
    reader["snapshotHandler"]!("json");
    assert.equal(received, "json");
  });

  it("registers and calls snapshot handler with md format", () => {
    const reader = new InputReader();
    let received: string = "";
    reader.onSnapshot((fmt) => { received = fmt; });
    reader["snapshotHandler"]!("md");
    assert.equal(received, "md");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["snapshotHandler"]?.("json"); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onSnapshot(() => { calls++; });
    reader.onSnapshot(() => { calls += 10; });
    reader["snapshotHandler"]!("json");
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

describe("onPinAllErrors", () => {
  it("registers and calls pin-all-errors handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onPinAllErrors(() => { called = true; });
    reader["pinAllErrorsHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["pinAllErrorsHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onPinAllErrors(() => { calls++; });
    reader.onPinAllErrors(() => { calls += 10; });
    reader["pinAllErrorsHandler"]!();
    assert.equal(calls, 10);
  });
});

describe("onExportStats", () => {
  it("registers and calls export-stats handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onExportStats(() => { called = true; });
    reader["exportStatsHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["exportStatsHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onExportStats(() => { calls++; });
    reader.onExportStats(() => { calls += 10; });
    reader["exportStatsHandler"]!();
    assert.equal(calls, 10);
  });
});

describe("onStats", () => {
  it("registers and calls stats handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onStats(() => { called = true; });
    reader["statsHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["statsHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onStats(() => { calls++; });
    reader.onStats(() => { calls += 10; });
    reader["statsHandler"]!();
    assert.equal(calls, 10);
  });
});

describe("onRecall", () => {
  it("registers and calls recall handler with keyword and max", () => {
    const reader = new InputReader();
    let kw = "", mx = 0;
    reader.onRecall((k, m) => { kw = k; mx = m; });
    reader["recallHandler"]!("error", 25);
    assert.equal(kw, "error");
    assert.equal(mx, 25);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["recallHandler"]?.("kw", 50); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onRecall(() => { calls++; });
    reader.onRecall(() => { calls += 10; });
    reader["recallHandler"]!("kw", 50);
    assert.equal(calls, 10);
  });
});

describe("onMuteErrors", () => {
  it("registers and calls mute-errors handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onMuteErrors(() => { called = true; });
    reader["muteErrorsHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["muteErrorsHandler"]?.(); });
  });
});

describe("onPrevGoal", () => {
  it("registers and calls handler with target and nBack", () => {
    const reader = new InputReader();
    let tgt = "", nb = 0;
    reader.onPrevGoal((t, n) => { tgt = t; nb = n; });
    reader["prevGoalHandler"]!("alpha", 2);
    assert.equal(tgt, "alpha");
    assert.equal(nb, 2);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["prevGoalHandler"]?.("x", 1); });
  });
});

describe("onTag", () => {
  it("registers and calls tag handler", () => {
    const reader = new InputReader();
    let tgt = "", tgs: string[] = [];
    reader.onTag((t, ts) => { tgt = t; tgs = ts; });
    reader["tagHandler"]!("alpha", ["frontend", "prod"]);
    assert.equal(tgt, "alpha");
    assert.deepEqual(tgs, ["frontend", "prod"]);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["tagHandler"]?.("x", []); });
  });
});

describe("onTagsList", () => {
  it("registers and calls tags-list handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onTagsList(() => { called = true; });
    reader["tagsListHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["tagsListHandler"]?.(); });
  });
});

describe("onTagFilter2", () => {
  it("registers and calls handler with tag", () => {
    const reader = new InputReader();
    let received: string | null = "unset";
    reader.onTagFilter2((t) => { received = t; });
    reader["tagFilter2Handler"]!("backend");
    assert.equal(received, "backend");
  });

  it("passes null for clear", () => {
    const reader = new InputReader();
    let received: string | null = "unset";
    reader.onTagFilter2((t) => { received = t; });
    reader["tagFilter2Handler"]!(null);
    assert.equal(received, null);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["tagFilter2Handler"]?.(null); });
  });
});

describe("onFind", () => {
  it("registers and calls find handler", () => {
    const reader = new InputReader();
    let text = "";
    reader.onFind((t) => { text = t; });
    reader["findHandler"]!("timeout");
    assert.equal(text, "timeout");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["findHandler"]?.("x"); });
  });
});

describe("onResetHealth", () => {
  it("registers and calls reset-health handler", () => {
    const reader = new InputReader();
    let target = "";
    reader.onResetHealth((t) => { target = t; });
    reader["resetHealthHandler"]!("alpha");
    assert.equal(target, "alpha");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["resetHealthHandler"]?.("x"); });
  });
});

describe("onTimeline", () => {
  it("registers and calls timeline handler with target and count", () => {
    const reader = new InputReader();
    let tgt = "", cnt = 0;
    reader.onTimeline((t, c) => { tgt = t; cnt = c; });
    reader["timelineHandler"]!("alpha", 20);
    assert.equal(tgt, "alpha");
    assert.equal(cnt, 20);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["timelineHandler"]?.("x", 30); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onTimeline(() => { calls++; });
    reader.onTimeline(() => { calls += 10; });
    reader["timelineHandler"]!("x", 30);
    assert.equal(calls, 10);
  });
});

describe("onColor", () => {
  it("registers and calls color handler", () => {
    const reader = new InputReader();
    let tgt = "", col = "";
    reader.onColor((t, c) => { tgt = t; col = c; });
    reader["colorHandler"]!("alpha", "lime");
    assert.equal(tgt, "alpha");
    assert.equal(col, "lime");
  });

  it("empty color means clear", () => {
    const reader = new InputReader();
    let col = "unset";
    reader.onColor((_t, c) => { col = c; });
    reader["colorHandler"]!("alpha", "");
    assert.equal(col, "");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["colorHandler"]?.("x", "lime"); });
  });
});

describe("onDuplicate", () => {
  it("calls handler with target and newTitle", () => {
    const r = new InputReader(); let tgt = "", nt = "";
    r.onDuplicate((t, n) => { tgt = t; nt = n; });
    r["duplicateHandler"]!("alpha", "my-copy");
    assert.equal(tgt, "alpha"); assert.equal(nt, "my-copy");
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["duplicateHandler"]?.("x", "")); });
});

describe("onColorAll", () => {
  it("calls handler with color name", () => {
    const r = new InputReader(); let c = "";
    r.onColorAll((n) => { c = n; });
    r["colorAllHandler"]!("lime");
    assert.equal(c, "lime");
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["colorAllHandler"]?.("")); });
});

describe("onQuietHours", () => {
  it("calls handler with specs array", () => {
    const r = new InputReader(); let specs: string[] = [];
    r.onQuietHours((s) => { specs = s; });
    r["quietHoursHandler"]!(["22-06"]);
    assert.deepEqual(specs, ["22-06"]);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["quietHoursHandler"]?.([])); });
});

describe("onHistoryStats", () => {
  it("calls handler", () => {
    const r = new InputReader(); let called = false;
    r.onHistoryStats(() => { called = true; });
    r["historyStatsHandler"]!();
    assert.equal(called, true);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["historyStatsHandler"]?.()); });
});

describe("onNoteHistory", () => {
  it("calls handler with target", () => {
    const r = new InputReader(); let tgt = "";
    r.onNoteHistory((t) => { tgt = t; });
    r["noteHistoryHandler"]!("alpha");
    assert.equal(tgt, "alpha");
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["noteHistoryHandler"]?.("x")); });
});

describe("onLabel", () => {
  it("calls handler with target and label text", () => {
    const r = new InputReader(); let tgt = "", lbl = "";
    r.onLabel((t, l) => { tgt = t; lbl = l; });
    r["labelHandler"]!("alpha", "my worker");
    assert.equal(tgt, "alpha"); assert.equal(lbl, "my worker");
  });
  it("passes empty string to clear label", () => {
    const r = new InputReader(); let lbl = "x";
    r.onLabel((_t, l) => { lbl = l; });
    r["labelHandler"]!("alpha", "");
    assert.equal(lbl, "");
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["labelHandler"]?.("x", "")); });
});

describe("onSessionsTable", () => {
  it("calls handler", () => {
    const r = new InputReader(); let called = false;
    r.onSessionsTable(() => { called = true; });
    r["sessionsTableHandler"]!();
    assert.equal(called, true);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["sessionsTableHandler"]?.()); });
});

describe("onFlapLog", () => {
  it("calls handler", () => {
    const r = new InputReader(); let called = false;
    r.onFlapLog(() => { called = true; });
    r["flapLogHandler"]!();
    assert.equal(called, true);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["flapLogHandler"]?.()); });
});

describe("onDrain", () => {
  it("calls handler with target and drain=true", () => {
    const r = new InputReader(); let tgt = "", drain = false;
    r.onDrain((t, d) => { tgt = t; drain = d; });
    r["drainHandler"]!("alpha", true);
    assert.equal(tgt, "alpha"); assert.equal(drain, true);
  });
  it("calls handler with drain=false for undrain", () => {
    const r = new InputReader(); let drain = true;
    r.onDrain((_t, d) => { drain = d; });
    r["drainHandler"]!("alpha", false);
    assert.equal(drain, false);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["drainHandler"]?.("x", true)); });
});

describe("onExportAll", () => {
  it("calls handler", () => {
    const r = new InputReader(); let called = false;
    r.onExportAll(() => { called = true; });
    r["exportAllHandler"]!();
    assert.equal(called, true);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["exportAllHandler"]?.()); });
});

describe("onHealthTrend", () => {
  it("calls handler with target and height", () => {
    const r = new InputReader(); let tgt = "", ht = 0;
    r.onHealthTrend((t, h) => { tgt = t; ht = h; });
    r["healthTrendHandler"]!("alpha", 6);
    assert.equal(tgt, "alpha"); assert.equal(ht, 6);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["healthTrendHandler"]?.("x", 6)); });
});

describe("onAlertMute", () => {
  it("calls handler with pattern", () => {
    const r = new InputReader(); let pat: string | null = "unset";
    r.onAlertMute((p) => { pat = p; });
    r["alertMuteHandler"]!("watchdog");
    assert.equal(pat, "watchdog");
  });
  it("calls handler with null for clear", () => {
    const r = new InputReader(); let pat: string | null = "unset";
    r.onAlertMute((p) => { pat = p; });
    r["alertMuteHandler"]!(null);
    assert.equal(pat, null);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["alertMuteHandler"]?.(null)); });
});

describe("onBudgetsList", () => {
  it("calls handler", () => {
    const r = new InputReader(); let called = false;
    r.onBudgetsList(() => { called = true; });
    r["budgetsListHandler"]!();
    assert.equal(called, true);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["budgetsListHandler"]?.()); });
});

describe("onBudgetStatus", () => {
  it("calls handler", () => {
    const r = new InputReader(); let called = false;
    r.onBudgetStatus(() => { called = true; });
    r["budgetStatusHandler"]!();
    assert.equal(called, true);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["budgetStatusHandler"]?.()); });
});

describe("onBudget", () => {
  it("calls handler with target and budget", () => {
    const r = new InputReader(); let tgt: string | null = "unset"; let bud: number | null = -1;
    r.onBudget((t, b) => { tgt = t; bud = b; });
    r["budgetHandler"]!("alpha", 2.50);
    assert.equal(tgt, "alpha"); assert.equal(bud, 2.50);
  });
  it("passes null target for global budget", () => {
    const r = new InputReader(); let tgt: string | null = "unset";
    r.onBudget((t) => { tgt = t; });
    r["budgetHandler"]!(null, 5.00);
    assert.equal(tgt, null);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["budgetHandler"]?.(null, null)); });
});

describe("onBulkControl", () => {
  it("calls handler with pause action", () => {
    const r = new InputReader(); let action = "";
    r.onBulkControl((a) => { action = a; });
    r["bulkControlHandler"]!("pause");
    assert.equal(action, "pause");
  });
  it("calls handler with resume action", () => {
    const r = new InputReader(); let action = "";
    r.onBulkControl((a) => { action = a; });
    r["bulkControlHandler"]!("resume");
    assert.equal(action, "resume");
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["bulkControlHandler"]?.("pause")); });
});

describe("onQuietStatus", () => {
  it("calls handler", () => {
    const r = new InputReader(); let called = false;
    r.onQuietStatus(() => { called = true; });
    r["quietStatusHandler"]!();
    assert.equal(called, true);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["quietStatusHandler"]?.()); });
});

describe("onAlertLog", () => {
  it("calls handler with count", () => {
    const r = new InputReader(); let n = 0;
    r.onAlertLog((c) => { n = c; });
    r["alertLogHandler"]!(30);
    assert.equal(n, 30);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["alertLogHandler"]?.(20)); });
});

describe("onCostSummary", () => {
  it("calls handler", () => {
    const r = new InputReader(); let called = false;
    r.onCostSummary(() => { called = true; });
    r["costSummaryHandler"]!();
    assert.equal(called, true);
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["costSummaryHandler"]?.()); });
});

describe("onSessionReport", () => {
  it("calls handler with target", () => {
    const r = new InputReader(); let tgt = "";
    r.onSessionReport((t) => { tgt = t; });
    r["sessionReportHandler"]!("alpha");
    assert.equal(tgt, "alpha");
  });
  it("is safe without handler", () => { assert.doesNotThrow(() => new InputReader()["sessionReportHandler"]?.("x")); });
});

describe("onClearHistory", () => {
  it("registers and calls clear-history handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onClearHistory(() => { called = true; });
    reader["clearHistoryHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["clearHistoryHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onClearHistory(() => { calls++; });
    reader.onClearHistory(() => { calls += 10; });
    reader["clearHistoryHandler"]!();
    assert.equal(calls, 10);
  });
});

// ── parseNaturalTaskIntent ───────────────────────────────────────────────────

describe("parseNaturalTaskIntent", () => {
  it("returns null for empty string", () => {
    assert.equal(parseNaturalTaskIntent(""), null);
  });

  it("returns null for plain sentence with no intent marker", () => {
    assert.equal(parseNaturalTaskIntent("just a normal message"), null);
  });

  it("parses 'task for <session>: <goal>'", () => {
    const r = parseNaturalTaskIntent("task for adventure: implement login");
    assert.deepEqual(r, { session: "adventure", goal: "implement login" });
  });

  it("parses 'task for <session> - <goal>'", () => {
    const r = parseNaturalTaskIntent("task for aoaoe - fix the flap detector");
    assert.deepEqual(r, { session: "aoaoe", goal: "fix the flap detector" });
  });

  it("parses 'task <session>: <goal>'", () => {
    const r = parseNaturalTaskIntent("task cloud-hypervisor: rebase onto main");
    assert.deepEqual(r, { session: "cloud-hypervisor", goal: "rebase onto main" });
  });

  it("parses '<session>: <goal>' (single-word session)", () => {
    const r = parseNaturalTaskIntent("adventure: implement the inventory system");
    assert.deepEqual(r, { session: "adventure", goal: "implement the inventory system" });
  });

  it("is case-insensitive for 'task for'", () => {
    const r = parseNaturalTaskIntent("TASK FOR adventure: implement login");
    assert.deepEqual(r, { session: "adventure", goal: "implement login" });
  });

  it("is case-insensitive for 'task'", () => {
    const r = parseNaturalTaskIntent("Task adventure: fix tests");
    assert.deepEqual(r, { session: "adventure", goal: "fix tests" });
  });

  it("rejects bare number as session (e.g. '12:30')", () => {
    assert.equal(parseNaturalTaskIntent("12:30 is the time"), null);
  });

  it("rejects 'http:' scheme prefix", () => {
    assert.equal(parseNaturalTaskIntent("http: not a task"), null);
  });

  it("rejects single-char session name", () => {
    assert.equal(parseNaturalTaskIntent("x: something"), null);
  });

  it("trims whitespace from goal", () => {
    const r = parseNaturalTaskIntent("task for adventure:   implement login   ");
    assert.deepEqual(r, { session: "adventure", goal: "implement login" });
  });

  it("returns null when goal is empty after colon", () => {
    assert.equal(parseNaturalTaskIntent("task for adventure:"), null);
  });

  it("handles session names with hyphens", () => {
    const r = parseNaturalTaskIntent("task for cloud-hypervisor: fix sev-snp");
    assert.deepEqual(r, { session: "cloud-hypervisor", goal: "fix sev-snp" });
  });
});

// ── onStatsLive ─────────────────────────────────────────────────────────

describe("onStatsLive", () => {
  it("register handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onStatsLive(() => { called = true; });
    reader["statsLiveHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["statsLiveHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onStatsLive(() => { calls++; });
    reader.onStatsLive(() => { calls += 10; });
    reader["statsLiveHandler"]!();
    assert.equal(calls, 10);
  });
});

// ── onFanOut ─────────────────────────────────────────────────────────────

describe("onFanOut", () => {
  it("register handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onFanOut(() => { called = true; });
    reader["fanOutHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["fanOutHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onFanOut(() => { calls++; });
    reader.onFanOut(() => { calls += 10; });
    reader["fanOutHandler"]!();
    assert.equal(calls, 10);
  });
});

// ── onTrust ──────────────────────────────────────────────────────────────

describe("onTrust", () => {
  it("register handler", () => {
    const reader = new InputReader();
    let received = "";
    reader.onTrust((arg) => { received = arg; });
    reader["trustHandler"]!("autopilot");
    assert.equal(received, "autopilot");
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["trustHandler"]?.("test"); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onTrust(() => { calls++; });
    reader.onTrust(() => { calls += 10; });
    reader["trustHandler"]!("");
    assert.equal(calls, 10);
  });
});

// ── onCtxBudget ──────────────────────────────────────────────────────────

describe("onCtxBudget", () => {
  it("register handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onCtxBudget(() => { called = true; });
    reader["ctxBudgetHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["ctxBudgetHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onCtxBudget(() => { calls++; });
    reader.onCtxBudget(() => { calls += 10; });
    reader["ctxBudgetHandler"]!();
    assert.equal(calls, 10);
  });
});

// ── onProfile ────────────────────────────────────────────────────────────

describe("onProfile", () => {
  it("register handler", () => {
    const reader = new InputReader();
    let called = false;
    reader.onProfile(() => { called = true; });
    reader["profileHandler"]!();
    assert.equal(called, true);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["profileHandler"]?.(); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onProfile(() => { calls++; });
    reader.onProfile(() => { calls += 10; });
    reader["profileHandler"]!();
    assert.equal(calls, 10);
  });
});

// ── onReplay ─────────────────────────────────────────────────────────────

describe("onReplay", () => {
  it("register handler", () => {
    const reader = new InputReader();
    let target = ""; let speed: number | null = null;
    reader.onReplay((t, s) => { target = t; speed = s; });
    reader["replayHandler"]!("adventure", 20);
    assert.equal(target, "adventure");
    assert.equal(speed, 20);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["replayHandler"]?.("x", null); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onReplay(() => { calls++; });
    reader.onReplay(() => { calls += 10; });
    reader["replayHandler"]!("x", null);
    assert.equal(calls, 10);
  });
});

// ── onNotifyFilter ───────────────────────────────────────────────────────

describe("onNotifyFilter", () => {
  it("register handler", () => {
    const reader = new InputReader();
    let session: string | null = ""; let events: string[] = [];
    reader.onNotifyFilter((s, e) => { session = s; events = e; });
    reader["notifyFilterHandler"]!("Alpha", ["session_error"]);
    assert.equal(session, "Alpha");
    assert.deepEqual(events, ["session_error"]);
  });

  it("is safe without handler registered", () => {
    const reader = new InputReader();
    assert.doesNotThrow(() => { reader["notifyFilterHandler"]?.("x", []); });
  });

  it("handler replacement works", () => {
    const reader = new InputReader();
    let calls = 0;
    reader.onNotifyFilter(() => { calls++; });
    reader.onNotifyFilter(() => { calls += 10; });
    reader["notifyFilterHandler"]!(null, []);
    assert.equal(calls, 10);
  });
});
