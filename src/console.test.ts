import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ReasonerConsole.drainInput uses hardcoded paths (~/.aoaoe/pending-input.txt)
// so we test the atomic swap logic pattern here with temp files instead.
// This validates the rename-then-read approach is correct.

describe("atomic drain pattern", () => {
  const testDir = join(tmpdir(), `aoaoe-test-drain-${process.pid}`);
  const inputFile = join(testDir, "pending-input.txt");
  const drainFile = inputFile + ".drain";

  // replicate the atomic drain logic from console.ts
  function atomicDrain(): string[] {
    if (!existsSync(inputFile)) return [];

    try {
      renameSync(inputFile, drainFile);
    } catch {
      return [];
    }

    try {
      const content = readFileSync(drainFile, "utf-8").trim();
      try { unlinkSync(drainFile); } catch {}
      if (!content) return [];
      return content.split("\n").filter((l) => l.trim());
    } catch {
      return [];
    }
  }

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    // clean up any leftover files
    try { unlinkSync(inputFile); } catch {}
    try { unlinkSync(drainFile); } catch {}
  });

  afterEach(() => {
    try { unlinkSync(inputFile); } catch {}
    try { unlinkSync(drainFile); } catch {}
  });

  it("returns empty when input file does not exist", () => {
    const result = atomicDrain();
    assert.deepEqual(result, []);
  });

  it("returns empty when input file is empty", () => {
    writeFileSync(inputFile, "");
    const result = atomicDrain();
    assert.deepEqual(result, []);
  });

  it("drains a single message", () => {
    writeFileSync(inputFile, "hello world\n");
    const result = atomicDrain();
    assert.deepEqual(result, ["hello world"]);
  });

  it("drains multiple messages", () => {
    writeFileSync(inputFile, "msg1\nmsg2\nmsg3\n");
    const result = atomicDrain();
    assert.deepEqual(result, ["msg1", "msg2", "msg3"]);
  });

  it("filters out blank lines", () => {
    writeFileSync(inputFile, "msg1\n\n  \nmsg2\n");
    const result = atomicDrain();
    assert.deepEqual(result, ["msg1", "msg2"]);
  });

  it("removes the input file after drain (via rename)", () => {
    writeFileSync(inputFile, "test\n");
    atomicDrain();
    assert.equal(existsSync(inputFile), false, "input file should not exist after drain");
    assert.equal(existsSync(drainFile), false, "drain file should be cleaned up");
  });

  it("concurrent write during drain is not lost (rename is atomic)", () => {
    writeFileSync(inputFile, "original\n");

    // simulate the rename (atomic operation)
    renameSync(inputFile, drainFile);

    // now a "concurrent" write creates a new file
    writeFileSync(inputFile, "concurrent\n");

    // read from drain file (gets the original)
    const drained = readFileSync(drainFile, "utf-8").trim().split("\n").filter((l) => l.trim());
    assert.deepEqual(drained, ["original"]);

    // the concurrent write is in the new file, will be picked up next drain
    const pending = readFileSync(inputFile, "utf-8").trim().split("\n").filter((l) => l.trim());
    assert.deepEqual(pending, ["concurrent"]);

    // clean up
    unlinkSync(drainFile);
  });
});


