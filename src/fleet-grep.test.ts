import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatGrepResult } from "./fleet-grep.js";
import type { GrepResult } from "./fleet-grep.js";

describe("formatGrepResult", () => {
  it("shows no-match message", () => {
    const result: GrepResult = { pattern: "test", totalHits: 0, filesSearched: 5, hits: [] };
    const lines = formatGrepResult(result);
    assert.ok(lines[0].includes("no matches"));
  });

  it("shows hit count and previews", () => {
    const result: GrepResult = {
      pattern: "error",
      totalHits: 3,
      filesSearched: 2,
      hits: [
        { archive: "session_2026.txt.gz", lineNumber: 42, line: "error: module not found", matchStart: 0, matchEnd: 5 },
        { archive: "session_2026.txt.gz", lineNumber: 100, line: "another error here", matchStart: 8, matchEnd: 13 },
      ],
    };
    const lines = formatGrepResult(result);
    assert.ok(lines[0].includes("3 match"));
    assert.ok(lines.some((l) => l.includes("error: module")));
  });
});
