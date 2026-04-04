import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createLockState, acquireLock, releaseLock, isLocked, isStale, lockAge, formatLockState } from "./daemon-distributed-lock.js";

describe("acquireLock", () => {
  it("acquires when unlocked", () => {
    const s = createLockState();
    const r = acquireLock(s, 1234);
    assert.ok(r.acquired);
    assert.ok(isLocked(s));
  });
  it("rejects when already locked", () => {
    const s = createLockState();
    acquireLock(s, 1234);
    const r = acquireLock(s, 5678);
    assert.ok(!r.acquired);
    assert.equal(r.existingPid, 1234);
  });
  it("reclaims stale lock", () => {
    const s = createLockState("lock", 1000);
    acquireLock(s, 1234, 1000);
    const r = acquireLock(s, 5678, 5000); // 4s > 1s threshold
    assert.ok(r.acquired);
    assert.ok(r.stale);
    assert.equal(s.pid, 5678);
  });
});

describe("releaseLock", () => {
  it("releases own lock", () => {
    const s = createLockState();
    acquireLock(s, 1234);
    assert.ok(releaseLock(s, 1234));
    assert.ok(!isLocked(s));
  });
  it("rejects release from wrong pid", () => {
    const s = createLockState();
    acquireLock(s, 1234);
    assert.ok(!releaseLock(s, 5678));
  });
});

describe("isStale", () => {
  it("detects stale lock", () => {
    const s = createLockState("lock", 1000);
    acquireLock(s, 1234, 1000);
    assert.ok(!isStale(s, 1500));
    assert.ok(isStale(s, 3000));
  });
  it("returns false when unlocked", () => {
    assert.ok(!isStale(createLockState()));
  });
});

describe("lockAge", () => {
  it("computes age", () => {
    const s = createLockState();
    acquireLock(s, 1, 1000);
    assert.equal(lockAge(s, 5000), 4000);
  });
  it("returns 0 when unlocked", () => {
    assert.equal(lockAge(createLockState()), 0);
  });
});

describe("formatLockState", () => {
  it("shows unlocked", () => {
    const lines = formatLockState(createLockState());
    assert.ok(lines[0].includes("unlocked"));
  });
  it("shows locked with pid", () => {
    const s = createLockState();
    acquireLock(s, 42);
    const lines = formatLockState(s);
    assert.ok(lines[0].includes("42"));
  });
});
