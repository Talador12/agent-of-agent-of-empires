import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { wakeableSleep } from "./wake.js";

// each test gets its own temp directory to avoid cross-test interference
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wake-test-"));
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("wakeableSleep — timeout", () => {
  it("resolves with 'timeout' after the specified duration", async () => {
    const start = Date.now();
    const result = await wakeableSleep(150, dir);
    const elapsed = Date.now() - start;
    assert.equal(result.reason, "timeout");
    assert.ok(elapsed >= 120, `expected >= 120ms, got ${elapsed}ms`);
    assert.ok(elapsed < 500, `expected < 500ms, got ${elapsed}ms`);
    assert.ok(result.elapsed >= 120, `result.elapsed should be >= 120ms, got ${result.elapsed}ms`);
  });

  it("works with very short timeout", async () => {
    const result = await wakeableSleep(10, dir);
    assert.equal(result.reason, "timeout");
    assert.ok(result.elapsed < 200);
  });
});

describe("wakeableSleep — wake on file change", () => {
  it("wakes immediately when a file is created in watch dir", async () => {
    const start = Date.now();

    // write a file after 50ms — should wake the sleeper
    setTimeout(() => {
      writeFileSync(join(dir, "pending-input.txt"), "hello\n");
    }, 50);

    const result = await wakeableSleep(5000, dir);
    const elapsed = Date.now() - start;

    assert.equal(result.reason, "wake");
    assert.ok(elapsed < 1000, `expected < 1000ms, got ${elapsed}ms — did not wake on file`);
    assert.ok(result.elapsed < 1000);
  });

  it("wakes when interrupt flag file is created", async () => {
    setTimeout(() => {
      writeFileSync(join(dir, "interrupt"), String(Date.now()));
    }, 50);

    const result = await wakeableSleep(5000, dir);
    assert.equal(result.reason, "wake");
    assert.ok(result.elapsed < 1000);
  });

  it("wakes on pending-input.txt file creation", async () => {
    setTimeout(() => {
      writeFileSync(join(dir, "pending-input.txt"), "data");
    }, 50);

    const result = await wakeableSleep(5000, dir);
    assert.equal(result.reason, "wake");
    assert.ok(result.elapsed < 1000);
  });

  it("ignores non-wake files like daemon-state.json", async () => {
    setTimeout(() => {
      writeFileSync(join(dir, "daemon-state.json"), "{}");
    }, 50);

    const result = await wakeableSleep(500, dir);
    assert.equal(result.reason, "timeout");
  });
});

describe("wakeableSleep — abort signal", () => {
  it("resolves immediately with 'abort' when signal fires", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);

    const start = Date.now();
    const result = await wakeableSleep(5000, dir, ac.signal);
    const elapsed = Date.now() - start;

    assert.equal(result.reason, "abort");
    assert.ok(elapsed < 500, `expected < 500ms, got ${elapsed}ms`);
  });

  it("resolves immediately if signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    const start = Date.now();
    const result = await wakeableSleep(5000, dir, ac.signal);
    const elapsed = Date.now() - start;

    assert.equal(result.reason, "abort");
    assert.ok(elapsed < 100, `expected < 100ms, got ${elapsed}ms`);
  });
});

describe("wakeableSleep — cleanup", () => {
  it("does not leak timers or watchers on timeout", async () => {
    // just verify it resolves cleanly and doesn't hang
    const result = await wakeableSleep(50, dir);
    assert.equal(result.reason, "timeout");
  });

  it("does not leak timers or watchers on wake", async () => {
    setTimeout(() => {
      writeFileSync(join(dir, "pending-input.txt"), "x");
    }, 20);

    const result = await wakeableSleep(5000, dir);
    assert.equal(result.reason, "wake");
  });

  it("does not leak timers or watchers on abort", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);

    const result = await wakeableSleep(5000, dir, ac.signal);
    assert.equal(result.reason, "abort");
  });
});

describe("wakeableSleep — sequential calls", () => {
  it("works correctly across multiple sequential calls", async () => {
    // first call: timeout
    const r1 = await wakeableSleep(50, dir);
    assert.equal(r1.reason, "timeout");

    // second call: wake (use a wake-eligible filename)
    setTimeout(() => writeFileSync(join(dir, "interrupt"), ""), 30);
    const r2 = await wakeableSleep(5000, dir);
    assert.equal(r2.reason, "wake");

    // third call: abort — use a clean subdirectory to avoid stale inotify
    // events from the msg.txt write in call 2 (race condition on Linux CI)
    const cleanDir = join(dir, "clean");
    mkdirSync(cleanDir);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const r3 = await wakeableSleep(5000, cleanDir, ac.signal);
    assert.equal(r3.reason, "abort");
  });
});

describe("wakeableSleep — missing watch directory", () => {
  it("falls back to timeout if watch dir does not exist", async () => {
    const bogusDir = join(dir, "nonexistent-subdir");
    const result = await wakeableSleep(100, bogusDir);
    assert.equal(result.reason, "timeout");
    assert.ok(result.elapsed >= 80);
  });
});
