// api-rate-limiting.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createRateLimiter,
  checkRateLimit,
  getClientStats,
  cleanupExpired,
  formatRateLimiter,
} from "./api-rate-limiting.js";

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    const state = createRateLimiter({ maxRequests: 5, windowMs: 60_000, burstAllowance: 0 });
    const result = checkRateLimit(state, "client-1", 1000);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 4);
    assert.equal(result.retryAfterMs, 0);
  });

  it("blocks requests over the limit", () => {
    const state = createRateLimiter({ maxRequests: 3, windowMs: 60_000, burstAllowance: 0 });
    checkRateLimit(state, "c1", 1000);
    checkRateLimit(state, "c1", 1001);
    checkRateLimit(state, "c1", 1002);
    const result = checkRateLimit(state, "c1", 1003);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.ok(result.retryAfterMs > 0);
  });

  it("tracks separate clients independently", () => {
    const state = createRateLimiter({ maxRequests: 2, windowMs: 60_000, burstAllowance: 0 });
    checkRateLimit(state, "a", 1000);
    checkRateLimit(state, "a", 1001);
    const blocked = checkRateLimit(state, "a", 1002);
    const allowed = checkRateLimit(state, "b", 1002);
    assert.equal(blocked.allowed, false);
    assert.equal(allowed.allowed, true);
  });

  it("allows burst in first 10% of window", () => {
    const state = createRateLimiter({ maxRequests: 3, windowMs: 100_000, burstAllowance: 2 });
    const now = 1000;
    // should allow 3 + 2 = 5 requests in burst window
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(state, "c1", now + i);
      assert.equal(result.allowed, true, `request ${i + 1} should be allowed`);
    }
    const result = checkRateLimit(state, "c1", now + 5);
    assert.equal(result.allowed, false);
  });

  it("expires old requests after window", () => {
    const state = createRateLimiter({ maxRequests: 2, windowMs: 10_000, burstAllowance: 0 });
    checkRateLimit(state, "c1", 1000);
    checkRateLimit(state, "c1", 2000);
    // at t=3000, both still in window
    const blocked = checkRateLimit(state, "c1", 3000);
    assert.equal(blocked.allowed, false);
    // at t=12000, first request expired
    const allowed = checkRateLimit(state, "c1", 12000);
    assert.equal(allowed.allowed, true);
  });

  it("returns correct resetMs", () => {
    const state = createRateLimiter({ maxRequests: 1, windowMs: 10_000, burstAllowance: 0 });
    checkRateLimit(state, "c1", 5000);
    const result = checkRateLimit(state, "c1", 6000);
    assert.equal(result.allowed, false);
    // oldest request at 5000, window is 10s, so reset at 15000
    assert.equal(result.resetMs, 9000);
  });

  it("tracks total allowed and blocked", () => {
    const state = createRateLimiter({ maxRequests: 1, windowMs: 60_000, burstAllowance: 0 });
    checkRateLimit(state, "c1", 1000); // allowed
    checkRateLimit(state, "c1", 1001); // blocked
    checkRateLimit(state, "c2", 1002); // allowed
    assert.equal(state.totalAllowed, 2);
    assert.equal(state.totalBlocked, 1);
  });
});

describe("getClientStats", () => {
  it("returns stats for tracked client", () => {
    const state = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });
    checkRateLimit(state, "c1", 1000);
    checkRateLimit(state, "c1", 2000);
    const stats = getClientStats(state, "c1", 3000);
    assert.ok(stats);
    assert.equal(stats.requests, 2);
    assert.equal(stats.blocked, 0);
  });

  it("returns null for unknown client", () => {
    const state = createRateLimiter();
    assert.equal(getClientStats(state, "unknown"), null);
  });

  it("tracks blocked count", () => {
    const state = createRateLimiter({ maxRequests: 1, windowMs: 60_000, burstAllowance: 0 });
    checkRateLimit(state, "c1", 1000);
    checkRateLimit(state, "c1", 1001); // blocked
    checkRateLimit(state, "c1", 1002); // blocked
    const stats = getClientStats(state, "c1", 1003);
    assert.ok(stats);
    assert.equal(stats.blocked, 2);
  });
});

describe("cleanupExpired", () => {
  it("removes clients with no recent activity", () => {
    const state = createRateLimiter({ windowMs: 10_000 });
    checkRateLimit(state, "old", 1000);
    checkRateLimit(state, "new", 50_000);
    assert.equal(state.clients.size, 2);
    const removed = cleanupExpired(state, 50_000);
    assert.equal(removed, 1);
    assert.equal(state.clients.size, 1);
    assert.ok(state.clients.has("new"));
  });

  it("keeps clients within 2x window", () => {
    const state = createRateLimiter({ windowMs: 10_000 });
    checkRateLimit(state, "recent", 40_000);
    const removed = cleanupExpired(state, 50_000);
    assert.equal(removed, 0);
  });
});

describe("formatRateLimiter", () => {
  it("formats status for TUI", () => {
    const state = createRateLimiter({ maxRequests: 100, windowMs: 60_000, burstAllowance: 20 });
    checkRateLimit(state, "1.2.3.4", Date.now());
    checkRateLimit(state, "5.6.7.8", Date.now());
    const lines = formatRateLimiter(state);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].includes("100 req/60s"));
    assert.ok(lines[0].includes("burst: +20"));
    assert.ok(lines.some((l) => l.includes("2 allowed")));
  });
});
