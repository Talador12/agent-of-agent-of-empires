import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetRateLimiter } from "./fleet-rate-limiter.js";

describe("FleetRateLimiter", () => {
  it("allows reasoning when under limits", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 10, maxDailyCostUsd: 100 });
    limiter.recordCost(1);
    assert.equal(limiter.isBlocked(), false);
  });

  it("blocks when hourly limit exceeded", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 5, maxDailyCostUsd: 100, cooldownMs: 60_000 });
    const now = Date.now();
    for (let i = 0; i < 6; i++) limiter.recordCost(1, now); // $6 > $5
    assert.equal(limiter.isBlocked(now), true);
  });

  it("blocks when daily limit exceeded", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 100, maxDailyCostUsd: 10, cooldownMs: 60_000 });
    const now = Date.now();
    // spread costs over multiple hours to avoid hourly limit
    for (let i = 0; i < 11; i++) {
      limiter.recordCost(1, now - i * 3_600_000);
    }
    assert.equal(limiter.isBlocked(now), true);
  });

  it("unblocks after cooldown when costs age out of hourly window", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 5, maxDailyCostUsd: 100, cooldownMs: 1000 });
    const now = Date.now();
    // costs are 59 minutes old — about to age out of the hourly window
    for (let i = 0; i < 6; i++) limiter.recordCost(1, now - 59 * 60_000);
    assert.equal(limiter.isBlocked(now), true); // hourly cost still high
    // after 2 more minutes, costs fall out of hourly window + cooldown is past
    assert.equal(limiter.isBlocked(now + 2 * 60_000), false);
  });

  it("getStatus shows correct cost totals", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 10, maxDailyCostUsd: 100 });
    const now = Date.now();
    limiter.recordCost(3, now);
    limiter.recordCost(2, now - 30 * 60_000); // 30min ago
    const status = limiter.getStatus(now);
    assert.equal(status.hourlyCostUsd, 5);
    assert.equal(status.blocked, false);
  });

  it("formatStatus shows green when ok", () => {
    const limiter = new FleetRateLimiter();
    limiter.recordCost(0.5);
    const lines = limiter.formatStatus();
    assert.ok(lines.some((l) => l.includes("🟢")));
    assert.ok(lines.some((l) => l.includes("Reasoning allowed")));
  });

  it("formatStatus shows red when blocked", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 1, cooldownMs: 60_000 });
    const now = Date.now();
    limiter.recordCost(2, now);
    const lines = limiter.formatStatus(now);
    assert.ok(lines.some((l) => l.includes("🔴")));
    assert.ok(lines.some((l) => l.includes("Blocked")));
  });

  it("prunes old samples beyond 25h", () => {
    const limiter = new FleetRateLimiter();
    const now = Date.now();
    limiter.recordCost(100, now - 26 * 3_600_000); // 26h ago
    limiter.recordCost(1, now);
    const status = limiter.getStatus(now);
    assert.equal(status.dailyCostUsd, 1); // old sample pruned
  });
});
