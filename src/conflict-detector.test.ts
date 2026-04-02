import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { extractEditedFiles, ConflictDetector } from "./conflict-detector.js";

describe("extractEditedFiles", () => {
  it("returns empty for empty input", () => {
    assert.deepEqual(extractEditedFiles([]), []);
  });

  it("extracts Edit tool usage", () => {
    const lines = ["Edit src/index.ts", "Write src/config.ts"];
    const files = extractEditedFiles(lines);
    assert.ok(files.includes("src/index.ts"));
    assert.ok(files.includes("src/config.ts"));
  });

  it("extracts git diff headers", () => {
    const lines = [
      "diff --git a/src/loop.ts b/src/loop.ts",
      "--- a/src/loop.ts",
      "+++ b/src/loop.ts",
    ];
    const files = extractEditedFiles(lines);
    assert.ok(files.includes("src/loop.ts"));
  });

  it("extracts writing/saved/modified patterns", () => {
    const lines = [
      "writing `src/new-feature.ts`",
      "saved src/config.json",
      "modified src/types.ts",
    ];
    const files = extractEditedFiles(lines);
    assert.ok(files.includes("src/new-feature.ts"));
    assert.ok(files.includes("src/config.json"));
    assert.ok(files.includes("src/types.ts"));
  });

  it("filters non-code extensions", () => {
    const lines = ["Edit dist/index.js.map", "Edit src/test.log", "Edit build.o"];
    const files = extractEditedFiles(lines);
    assert.equal(files.length, 0);
  });

  it("deduplicates files", () => {
    const lines = ["Edit src/index.ts", "Read src/index.ts", "Edit src/index.ts"];
    const files = extractEditedFiles(lines);
    assert.equal(files.filter((f) => f === "src/index.ts").length, 1);
  });

  it("strips ANSI codes", () => {
    const lines = ["\x1b[32mEdit src/hello.ts\x1b[0m"];
    const files = extractEditedFiles(lines);
    assert.ok(files.includes("src/hello.ts"));
  });

  it("handles inline code formatting", () => {
    const lines = ["Edit file: `src/app.tsx`"];
    const files = extractEditedFiles(lines);
    assert.ok(files.includes("src/app.tsx"));
  });

  it("normalizes leading ./", () => {
    const lines = ["Edit ./src/index.ts"];
    const files = extractEditedFiles(lines);
    assert.ok(files.includes("src/index.ts"));
  });

  it("handles Read tool lines", () => {
    const lines = ["Read src/config.ts"];
    const files = extractEditedFiles(lines);
    assert.ok(files.includes("src/config.ts"));
  });
});

describe("ConflictDetector", () => {
  it("detects no conflicts with single session", () => {
    const detector = new ConflictDetector();
    detector.recordEdits("session-a", "id-a", ["Edit src/index.ts"]);
    const conflicts = detector.detectConflicts();
    assert.equal(conflicts.length, 0);
  });

  it("detects conflict when two sessions edit same file", () => {
    const detector = new ConflictDetector();
    detector.recordEdits("session-a", "id-a", ["Edit src/index.ts"]);
    detector.recordEdits("session-b", "id-b", ["Edit src/index.ts"]);
    const conflicts = detector.detectConflicts();
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].filePath, "src/index.ts");
    assert.equal(conflicts[0].sessions.length, 2);
  });

  it("detects multiple conflicts", () => {
    const detector = new ConflictDetector();
    detector.recordEdits("a", "1", ["Edit src/index.ts", "Edit src/config.ts"]);
    detector.recordEdits("b", "2", ["Edit src/index.ts"]);
    detector.recordEdits("c", "3", ["Edit src/config.ts"]);
    const conflicts = detector.detectConflicts();
    assert.equal(conflicts.length, 2);
  });

  it("prunes old edits outside the time window", () => {
    const detector = new ConflictDetector(5 * 60 * 1000); // 5min window
    const now = Date.now();
    detector.recordEdits("a", "1", ["Edit src/index.ts"], now - 10 * 60 * 1000); // 10 min ago
    detector.recordEdits("b", "2", ["Edit src/index.ts"], now);
    const conflicts = detector.detectConflicts(now);
    assert.equal(conflicts.length, 0); // old edit was pruned
  });

  it("does not flag edits to different files", () => {
    const detector = new ConflictDetector();
    detector.recordEdits("a", "1", ["Edit src/index.ts"]);
    detector.recordEdits("b", "2", ["Edit src/config.ts"]);
    assert.equal(detector.detectConflicts().length, 0);
  });

  it("formatConflicts returns empty for no conflicts", () => {
    const detector = new ConflictDetector();
    assert.deepEqual(detector.formatConflicts([]), []);
  });

  it("formatConflicts includes file path and session names", () => {
    const detector = new ConflictDetector();
    const conflicts = [{
      filePath: "src/index.ts",
      sessions: [{ title: "adventure", id: "1" }, { title: "code-music", id: "2" }],
      detectedAt: Date.now(),
    }];
    const lines = detector.formatConflicts(conflicts);
    assert.ok(lines.length > 0);
    assert.ok(lines.some((l) => l.includes("src/index.ts")));
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("code-music")));
  });

  it("tracks editCount", () => {
    const detector = new ConflictDetector();
    assert.equal(detector.editCount, 0);
    detector.recordEdits("a", "1", ["Edit src/foo.ts", "Edit src/bar.ts"]);
    assert.equal(detector.editCount, 2);
  });

  it("three sessions on same file creates one conflict with three sessions", () => {
    const detector = new ConflictDetector();
    detector.recordEdits("a", "1", ["Edit src/shared.ts"]);
    detector.recordEdits("b", "2", ["Edit src/shared.ts"]);
    detector.recordEdits("c", "3", ["Edit src/shared.ts"]);
    const conflicts = detector.detectConflicts();
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].sessions.length, 3);
  });
});
