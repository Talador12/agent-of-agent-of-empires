import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { detectVersion, getMigrationsNeeded, migrateConfig, formatMigration } from "./daemon-config-migration.js";

describe("detectVersion", () => {
  it("detects explicit version", () => {
    assert.equal(detectVersion({ configVersion: "3.0" }), "3.0");
  });

  it("detects v1.0 by pollInterval heuristic", () => {
    assert.equal(detectVersion({ pollInterval: 10000 }), "1.0");
  });

  it("detects v2.0 by missing costBudgets", () => {
    assert.equal(detectVersion({ pollIntervalMs: 10000 }), "2.0");
  });

  it("detects v5.0 as current", () => {
    assert.equal(detectVersion({ configVersion: "5.0" }), "5.0");
  });
});

describe("getMigrationsNeeded", () => {
  it("returns all migrations from v1.0", () => {
    const needed = getMigrationsNeeded("1.0");
    assert.equal(needed.length, 4);
  });

  it("returns no migrations for current", () => {
    assert.equal(getMigrationsNeeded("5.0").length, 0);
  });

  it("returns subset from v3.0", () => {
    const needed = getMigrationsNeeded("3.0");
    assert.equal(needed.length, 2);
  });
});

describe("migrateConfig", () => {
  it("migrates from v1.0 to v5.0", () => {
    const result = migrateConfig({ pollInterval: 10000, reasoner: "opencode" });
    assert.ok(result.success);
    assert.equal(result.finalVersion, "5.0");
    assert.ok("pollIntervalMs" in result.config);
    assert.ok("costBudgets" in result.config);
    assert.ok("healthPort" in result.config);
    assert.ok("sessionPool" in result.config);
  });

  it("renames verbose to logging.verbose", () => {
    const result = migrateConfig({ pollIntervalMs: 10000, verbose: true, configVersion: "2.0" });
    assert.ok(result.success);
    assert.ok(!("verbose" in result.config));
    assert.ok(result.config.logging);
  });

  it("normalizes claude to claude-code", () => {
    const result = migrateConfig({ costBudgets: {}, reasoner: "claude", configVersion: "3.0" });
    assert.ok(result.success);
    assert.equal(result.config.reasoner, "claude-code");
  });

  it("returns unchanged for current version", () => {
    const result = migrateConfig({ configVersion: "5.0", reasoner: "opencode" });
    assert.equal(result.migrationsApplied.length, 0);
    assert.ok(result.success);
  });

  it("records applied migrations", () => {
    const result = migrateConfig({ pollInterval: 5000 });
    assert.ok(result.migrationsApplied.length >= 4);
  });
});

describe("formatMigration", () => {
  it("shows already-current message", () => {
    const result = migrateConfig({ configVersion: "5.0" });
    const lines = formatMigration(result);
    assert.ok(lines[0].includes("already at"));
  });

  it("shows migration steps", () => {
    const result = migrateConfig({ pollInterval: 5000 });
    const lines = formatMigration(result);
    assert.ok(lines[0].includes("→"));
    assert.ok(lines.length > 1);
  });
});
