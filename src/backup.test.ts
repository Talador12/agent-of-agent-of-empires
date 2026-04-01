import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBackupResult, formatRestoreResult } from "./backup.js";

describe("formatBackupResult", () => {
  it("includes path in output", () => {
    const result = formatBackupResult("/tmp/backup.tar.gz (3 files, 1.2KB)");
    assert.ok(result.includes("/tmp/backup.tar.gz"));
    assert.ok(result.includes("3 files"));
  });
});

describe("formatRestoreResult", () => {
  it("shows restored files", () => {
    const result = formatRestoreResult({ restored: ["aoaoe.config.json", "task-state.json"], skipped: [] });
    assert.ok(result.includes("restored 2"));
    assert.ok(result.includes("aoaoe.config.json"));
  });

  it("shows skipped files", () => {
    const result = formatRestoreResult({ restored: [], skipped: ["unknown.txt"] });
    assert.ok(result.includes("skipped 1"));
    assert.ok(result.includes("unknown.txt"));
  });

  it("shows both restored and skipped", () => {
    const result = formatRestoreResult({ restored: ["task-state.json"], skipped: ["junk.log"] });
    assert.ok(result.includes("restored 1"));
    assert.ok(result.includes("skipped 1"));
  });
});
