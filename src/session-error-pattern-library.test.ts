// session-error-pattern-library.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scanForErrors,
  patternsForLanguage,
  supportedLanguages,
  formatErrorScan,
  BUILTIN_PATTERNS,
} from "./session-error-pattern-library.js";

describe("scanForErrors", () => {
  it("detects TypeScript type errors", () => {
    const result = scanForErrors(["src/index.ts(5,1): TS2345: error - argument type mismatch"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].language, "typescript");
    assert.equal(result.matches[0].category, "type");
  });

  it("detects module not found", () => {
    const result = scanForErrors(["Error: Cannot find module 'nonexistent-pkg'"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].category, "import");
  });

  it("detects Python import errors", () => {
    const result = scanForErrors(["ModuleNotFoundError: No module named 'flask'"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].language, "python");
    assert.equal(result.matches[0].category, "import");
  });

  it("detects Rust compiler errors", () => {
    const result = scanForErrors(["error[E0308]: mismatched types"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].language, "rust");
    assert.equal(result.matches[0].category, "build");
  });

  it("detects Rust borrow errors", () => {
    const result = scanForErrors(["error: cannot borrow `x` as mutable because it is also borrowed"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].category, "type");
    assert.ok(result.matches[0].suggestion.includes("borrow") || result.matches[0].suggestion.includes("ownership"));
  });

  it("detects OOM as critical", () => {
    const result = scanForErrors(["FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].severity, "critical");
    assert.equal(result.matches[0].category, "memory");
  });

  it("detects permission denied", () => {
    const result = scanForErrors(["Error: EACCES: permission denied, open '/etc/secret'"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].category, "permission");
  });

  it("detects network errors", () => {
    const result = scanForErrors(["Error: connect ECONNREFUSED 127.0.0.1:5432"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].category, "network");
  });

  it("detects test failures", () => {
    const result = scanForErrors(["FAIL src/app.test.ts", "  5 tests failing"]);
    assert.ok(result.matches.length >= 1);
    assert.equal(result.matches[0].category, "test");
  });

  it("detects assertion errors", () => {
    const result = scanForErrors(["AssertionError: expected 42 to equal 43"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].category, "assertion");
  });

  it("detects npm errors", () => {
    const result = scanForErrors(["npm ERR! code ERESOLVE"]);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].category, "dependency");
  });

  it("handles clean output with no errors", () => {
    const result = scanForErrors(["Building project...", "Done in 2.3s", "All tests passed"]);
    assert.equal(result.matches.length, 0);
  });

  it("counts by severity", () => {
    const result = scanForErrors([
      "FATAL ERROR: JavaScript heap out of memory",
      "Error: Cannot find module 'missing'",
      "warning: timeout exceeded",
    ]);
    assert.equal(result.bySeverity.critical, 1);
    assert.equal(result.bySeverity.error, 1);
    assert.equal(result.bySeverity.warning, 1);
  });

  it("counts by category", () => {
    const result = scanForErrors([
      "ModuleNotFoundError: No module named 'x'",
      "Error: Cannot find module 'y'",
    ]);
    assert.equal(result.byCategory.import, 2);
  });

  it("tracks lines scanned", () => {
    const result = scanForErrors(["line1", "line2", "line3"]);
    assert.equal(result.linesScanned, 3);
  });

  it("one match per line (first pattern wins)", () => {
    // A line that could match multiple patterns should only count once
    const result = scanForErrors(["SyntaxError: TypeError: something bizarre"]);
    assert.equal(result.matches.length, 1);
  });
});

describe("patternsForLanguage", () => {
  it("returns language-specific + general patterns", () => {
    const patterns = patternsForLanguage("typescript");
    assert.ok(patterns.some((p) => p.language === "typescript"));
    assert.ok(patterns.some((p) => p.language === "general"));
    assert.ok(!patterns.some((p) => p.language === "python"));
  });

  it("returns only general for unknown language", () => {
    const patterns = patternsForLanguage("brainfuck");
    assert.ok(patterns.every((p) => p.language === "general"));
    assert.ok(patterns.length > 0);
  });
});

describe("supportedLanguages", () => {
  it("lists all languages except general", () => {
    const langs = supportedLanguages();
    assert.ok(langs.includes("typescript"));
    assert.ok(langs.includes("python"));
    assert.ok(langs.includes("rust"));
    assert.ok(langs.includes("go"));
    assert.ok(!langs.includes("general"));
  });
});

describe("formatErrorScan", () => {
  it("formats scan with matches", () => {
    const result = scanForErrors([
      "error[E0308]: mismatched types",
      "Error: ECONNREFUSED 127.0.0.1:3000",
    ]);
    const lines = formatErrorScan(result);
    assert.ok(lines[0].includes("2 matches"));
    assert.ok(lines.some((l) => l.includes("severity")));
    assert.ok(lines.some((l) => l.includes("top matches")));
    assert.ok(lines.some((l) => l.includes("→")));
  });

  it("formats clean output", () => {
    const result = scanForErrors(["all good"]);
    const lines = formatErrorScan(result);
    assert.ok(lines.some((l) => l.includes("no known error")));
  });
});
