import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, inQuietHours, SETTING_DEFAULTS, MIN_TICK_INTERVAL_SECS } from "./settings.js";
import type { HostClient } from "./host.js";

function fakeHost(values: Record<string, unknown>): HostClient {
  return {
    configGet: async (key: string) => values[key] ?? null,
  } as unknown as HostClient;
}

test("unset settings fall back to manifest defaults", async () => {
  const s = await loadSettings(fakeHost({}));
  assert.deepEqual(s, SETTING_DEFAULTS);
  assert.equal(s.dryRun, true); // the load-bearing default: never act until opted in
});

test("values are read and clamped to manifest bounds", async () => {
  const s = await loadSettings(
    fakeHost({
      dry_run: false,
      tick_interval_secs: 1, // below the 5s floor
      reasoner: "claude-code",
      allow_nudge: true,
      spawn_limit: 999,
      max_active_sessions: 50,
      action_cooldown_secs: -10,
    })
  );
  assert.equal(s.dryRun, false);
  assert.equal(s.tickIntervalSecs, MIN_TICK_INTERVAL_SECS);
  assert.equal(s.reasoner, "claude-code");
  assert.equal(s.allowNudge, true);
  assert.equal(s.spawnLimit, 20);
  assert.equal(s.maxActiveSessions, 5);
  assert.equal(s.actionCooldownSecs, 0);
});

test("an unknown reasoner value falls back to rules", async () => {
  const s = await loadSettings(fakeHost({ reasoner: "gpt-12" }));
  assert.equal(s.reasoner, "rules");
});

test("a failing config.get falls back per-key instead of throwing", async () => {
  const host = {
    configGet: async (key: string) => {
      if (key === "dry_run") throw new Error("boom");
      if (key === "spawn_repo") return "owner/repo";
      return null;
    },
  } as unknown as HostClient;
  const s = await loadSettings(host);
  assert.equal(s.dryRun, true);
  assert.equal(s.spawnRepo, "owner/repo");
});

test("quiet hours: same-day and overnight ranges", () => {
  const at = (h: number, m: number) => new Date(2026, 0, 1, h, m);
  assert.equal(inQuietHours("09:00-17:00", at(12, 0)), true);
  assert.equal(inQuietHours("09:00-17:00", at(8, 59)), false);
  assert.equal(inQuietHours("09:00-17:00", at(17, 0)), false);
  // overnight wrap
  assert.equal(inQuietHours("22:00-06:00", at(23, 30)), true);
  assert.equal(inQuietHours("22:00-06:00", at(2, 0)), true);
  assert.equal(inQuietHours("22:00-06:00", at(12, 0)), false);
});

test("quiet hours: malformed specs disable quieting rather than muting forever", () => {
  const noon = new Date(2026, 0, 1, 12, 0);
  assert.equal(inQuietHours("", noon), false);
  assert.equal(inQuietHours("all day", noon), false);
  assert.equal(inQuietHours("25:00-26:00", noon), false);
  assert.equal(inQuietHours("12:00-12:00", noon), false);
});
