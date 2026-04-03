import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  getProfile, listProfiles, applyProfile,
  formatProfileList, formatProfileDetail,
} from "./fleet-config-profiles.js";

describe("getProfile", () => {
  it("finds built-in dev profile", () => {
    const p = getProfile("dev");
    assert.ok(p);
    assert.equal(p!.name, "dev");
    assert.ok(p!.overrides.pollIntervalMs);
  });

  it("finds built-in ci profile", () => {
    const p = getProfile("ci");
    assert.ok(p);
    assert.equal(p!.overrides.policies?.allowDestructive, true);
  });

  it("finds built-in incident profile", () => {
    const p = getProfile("incident");
    assert.ok(p);
    assert.equal(p!.overrides.confirm, true);
  });

  it("finds built-in conservative profile", () => {
    const p = getProfile("conservative");
    assert.ok(p);
    assert.equal(p!.overrides.dryRun, true);
  });

  it("finds built-in overnight profile", () => {
    const p = getProfile("overnight");
    assert.ok(p);
  });

  it("returns null for unknown profile", () => {
    assert.equal(getProfile("nonexistent"), null);
  });

  it("is case-insensitive", () => {
    const p = getProfile("DEV");
    assert.ok(p);
    assert.equal(p!.name, "dev");
  });

  it("finds user-defined profiles", () => {
    const custom = [{ name: "custom", description: "my profile", overrides: { verbose: true } }];
    const p = getProfile("custom", custom);
    assert.ok(p);
    assert.equal(p!.overrides.verbose, true);
  });
});

describe("listProfiles", () => {
  it("includes all built-in profiles", () => {
    const profiles = listProfiles();
    assert.ok(profiles.length >= 5);
    const names = profiles.map((p) => p.name);
    assert.ok(names.includes("dev"));
    assert.ok(names.includes("ci"));
    assert.ok(names.includes("incident"));
    assert.ok(names.includes("conservative"));
    assert.ok(names.includes("overnight"));
  });

  it("includes user profiles", () => {
    const custom = [{ name: "custom", description: "test", overrides: {} }];
    const profiles = listProfiles(custom);
    assert.ok(profiles.some((p) => p.name === "custom"));
  });
});

describe("applyProfile", () => {
  it("returns overrides from profile", () => {
    const p = getProfile("dev")!;
    const overrides = applyProfile(p);
    assert.equal(overrides.pollIntervalMs, p.overrides.pollIntervalMs);
    assert.equal(overrides.verbose, true);
  });
});

describe("formatProfileList", () => {
  it("shows all profiles", () => {
    const profiles = listProfiles();
    const lines = formatProfileList(profiles);
    assert.ok(lines[0].includes("Config Profiles"));
    assert.ok(lines.some((l) => l.includes("dev")));
    assert.ok(lines.some((l) => l.includes("ci")));
  });

  it("marks active profile", () => {
    const profiles = listProfiles();
    const lines = formatProfileList(profiles, "dev");
    assert.ok(lines.some((l) => l.includes("active")));
  });

  it("handles empty list", () => {
    const lines = formatProfileList([]);
    assert.ok(lines[0].includes("none"));
  });
});

describe("formatProfileDetail", () => {
  it("shows profile details", () => {
    const p = getProfile("dev")!;
    const lines = formatProfileDetail(p);
    assert.ok(lines[0].includes("dev"));
    assert.ok(lines.some((l) => l.includes("pollIntervalMs")));
  });
});
