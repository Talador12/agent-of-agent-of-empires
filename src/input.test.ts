import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InputReader } from "./input.js";

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
