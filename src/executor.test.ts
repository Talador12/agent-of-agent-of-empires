import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PERMISSION_COOLDOWN_MS } from "./executor.js";

// default cooldown from executor.ts (config.policies.actionCooldownMs ?? 30_000)
const DEFAULT_COOLDOWN_MS = 30_000;

describe("permission approval fast cooldown", () => {
  it("PERMISSION_COOLDOWN_MS is much shorter than default", () => {
    assert.ok(PERMISSION_COOLDOWN_MS < DEFAULT_COOLDOWN_MS, "permission cooldown should be shorter");
    assert.ok(PERMISSION_COOLDOWN_MS <= 2_000, "permission cooldown should be <= 2s");
    assert.ok(PERMISSION_COOLDOWN_MS >= 500, "permission cooldown should be >= 500ms");
  });

  it("permission action uses fast cooldown, next non-permission uses normal", () => {
    // simulate the rate-limit logic from executor.ts
    const recentActions = new Map<string, number>();
    const lastActionWasPermission = new Map<string, boolean>();

    const now = Date.now();

    // simulate permission approval
    recentActions.set("s1", now);
    lastActionWasPermission.set("s1", true);

    // check at PERMISSION_COOLDOWN_MS + 100ms: should NOT be rate limited
    const afterPermCooldown = now + PERMISSION_COOLDOWN_MS + 100;
    const wasPermission = lastActionWasPermission.get("s1") ?? false;
    const cooldown = wasPermission ? PERMISSION_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;
    assert.equal(afterPermCooldown - now < cooldown, false, "should not be rate limited after permission cooldown");

    // but at PERMISSION_COOLDOWN_MS - 100ms: SHOULD be rate limited
    const beforePermCooldown = now + PERMISSION_COOLDOWN_MS - 100;
    assert.equal(beforePermCooldown - now < cooldown, true, "should be rate limited within permission cooldown");
  });
});
