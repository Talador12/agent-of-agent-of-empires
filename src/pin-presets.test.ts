import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPinPresets, savePinPresets, savePreset, deletePreset, getPreset, formatPresetList } from "./pin-presets.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

function makeTempFile(): string {
  const dir = join(tmpdir(), `aoaoe-pin-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, "pin-presets.json");
}

function cleanup(file: string): void {
  try { rmSync(dirname(file), { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("loadPinPresets", () => {
  it("returns empty object when file does not exist", () => {
    const presets = loadPinPresets("/tmp/nonexistent-aoaoe-presets-xyz.json");
    assert.deepEqual(presets, {});
  });

  it("loads valid presets from file", () => {
    const file = makeTempFile();
    try {
      writeFileSync(file, JSON.stringify({ work: ["adventure", "cloudchamber"] }));
      const presets = loadPinPresets(file);
      assert.deepEqual(presets.work, ["adventure", "cloudchamber"]);
    } finally { cleanup(file); }
  });

  it("skips invalid entries", () => {
    const file = makeTempFile();
    try {
      writeFileSync(file, JSON.stringify({ good: ["a", "b"], bad: "not-an-array", worse: [1, 2] }));
      const presets = loadPinPresets(file);
      assert.ok("good" in presets);
      assert.ok(!("bad" in presets));
      assert.ok(!("worse" in presets));
    } finally { cleanup(file); }
  });
});

describe("savePreset + getPreset", () => {
  it("saves and retrieves a preset", () => {
    const file = makeTempFile();
    try {
      savePreset("dev", ["adventure", "aoaoe"], file);
      const titles = getPreset("dev", file);
      assert.deepEqual(titles, ["adventure", "aoaoe"]);
    } finally { cleanup(file); }
  });

  it("retrieves preset case-insensitively", () => {
    const file = makeTempFile();
    try {
      savePreset("Work", ["cloudchamber"], file);
      const titles = getPreset("work", file);
      assert.deepEqual(titles, ["cloudchamber"]);
    } finally { cleanup(file); }
  });

  it("returns undefined for missing preset", () => {
    const file = makeTempFile();
    try {
      assert.equal(getPreset("nope", file), undefined);
    } finally { cleanup(file); }
  });
});

describe("deletePreset", () => {
  it("deletes an existing preset", () => {
    const file = makeTempFile();
    try {
      savePreset("temp", ["a"], file);
      assert.equal(deletePreset("temp", file), true);
      assert.equal(getPreset("temp", file), undefined);
    } finally { cleanup(file); }
  });

  it("returns false for non-existent preset", () => {
    const file = makeTempFile();
    try {
      assert.equal(deletePreset("nope", file), false);
    } finally { cleanup(file); }
  });
});

describe("formatPresetList", () => {
  it("shows no-presets message when empty", () => {
    const result = formatPresetList("/tmp/nonexistent-aoaoe-presets-xyz.json");
    assert.ok(result.includes("no saved presets"));
  });

  it("lists saved presets", () => {
    const file = makeTempFile();
    try {
      savePreset("dev", ["adventure", "aoaoe"], file);
      savePreset("infra", ["cloudchamber"], file);
      const result = formatPresetList(file);
      assert.ok(result.includes("dev"));
      assert.ok(result.includes("infra"));
      assert.ok(result.includes("adventure"));
      assert.ok(result.includes("cloudchamber"));
    } finally { cleanup(file); }
  });
});
