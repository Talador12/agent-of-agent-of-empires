import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InputReader, INSIST_PREFIX } from "./input.js";

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
