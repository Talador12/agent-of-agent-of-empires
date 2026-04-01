import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendSupervisorEvent, loadSupervisorEvents, rotateSupervisorHistory } from "./supervisor-history.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

function makeTempPath(name: string): string {
  const dir = join(tmpdir(), `aoaoe-supervisor-history-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

describe("supervisor-history", () => {
  it("appends and loads supervisor events", () => {
    const file = makeTempPath("supervisor-history.jsonl");
    try {
      appendSupervisorEvent({ at: Date.now(), detail: "reconcile: +1 created, +0 linked" }, file);
      appendSupervisorEvent({ at: Date.now(), detail: "task command: list" }, file);
      const events = loadSupervisorEvents(10, file, 24 * 60 * 60 * 1000);
      assert.equal(events.length, 2);
      assert.equal(events[0].detail.includes("reconcile"), true);
      assert.equal(events[1].detail.includes("task command"), true);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  it("filters out old events by maxAgeMs", () => {
    const file = makeTempPath("supervisor-history.jsonl");
    try {
      const oldTs = Date.now() - (10 * 24 * 60 * 60 * 1000);
      writeFileSync(file, `${JSON.stringify({ at: oldTs, detail: "old" })}\n`, "utf-8");
      const events = loadSupervisorEvents(10, file, 24 * 60 * 60 * 1000);
      assert.equal(events.length, 0);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  it("rotates large history file", () => {
    const file = makeTempPath("supervisor-history.jsonl");
    try {
      writeFileSync(file, "x".repeat(4096), "utf-8");
      const rotated = rotateSupervisorHistory(file, 128);
      assert.equal(rotated, true);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });
});
