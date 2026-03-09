import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readContextFile,
  loadContextFromDir,
  loadGlobalContext,
  loadSessionContext,
  clearContextCache,
} from "./context.js";

const TMP = join(tmpdir(), "aoaoe-context-test-" + process.pid);

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  clearContextCache();
});

afterEach(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  clearContextCache();
});

describe("readContextFile", () => {
  it("reads an existing file", () => {
    writeFileSync(join(TMP, "test.md"), "hello world");
    assert.equal(readContextFile(join(TMP, "test.md")), "hello world");
  });

  it("returns empty for nonexistent file", () => {
    assert.equal(readContextFile(join(TMP, "nope.md")), "");
  });

  it("truncates files over 8KB", () => {
    const big = "x".repeat(10_000);
    writeFileSync(join(TMP, "big.md"), big);
    const result = readContextFile(join(TMP, "big.md"));
    assert.ok(result.length < 10_000);
    assert.ok(result.includes("[... truncated at 8KB ...]"));
  });

  it("caches reads (returns same content)", () => {
    writeFileSync(join(TMP, "cached.md"), "original");
    const first = readContextFile(join(TMP, "cached.md"));
    assert.equal(first, "original");
    // second read should be cached
    const second = readContextFile(join(TMP, "cached.md"));
    assert.equal(second, "original");
  });

  it("trims whitespace", () => {
    writeFileSync(join(TMP, "space.md"), "  content  \n\n");
    assert.equal(readContextFile(join(TMP, "space.md")), "content");
  });
});

describe("loadContextFromDir", () => {
  it("loads AGENTS.md and claude.md", () => {
    writeFileSync(join(TMP, "AGENTS.md"), "# Agents rules");
    writeFileSync(join(TMP, "claude.md"), "# Claude instructions");
    const result = loadContextFromDir(TMP);
    assert.ok(result.includes("--- AGENTS.md ---"));
    assert.ok(result.includes("# Agents rules"));
    assert.ok(result.includes("--- claude.md ---"));
    assert.ok(result.includes("# Claude instructions"));
  });

  it("handles missing files gracefully", () => {
    // no files in TMP
    const result = loadContextFromDir(TMP);
    assert.equal(result, "");
  });

  it("loads only files that exist", () => {
    writeFileSync(join(TMP, "AGENTS.md"), "agents only");
    const result = loadContextFromDir(TMP);
    assert.ok(result.includes("agents only"));
    assert.ok(!result.includes("claude.md"));
  });

  it("checks parent directory for context files", () => {
    const child = join(TMP, "child");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(TMP, "claude.md"), "parent context");
    const result = loadContextFromDir(child);
    assert.ok(result.includes("parent directory"));
    assert.ok(result.includes("parent context"));
  });

  it("returns empty for empty dir path", () => {
    assert.equal(loadContextFromDir(""), "");
  });
});

describe("loadGlobalContext", () => {
  it("wraps context with global header", () => {
    writeFileSync(join(TMP, "AGENTS.md"), "global rules");
    const result = loadGlobalContext(TMP);
    assert.ok(result.includes("GLOBAL PROJECT CONTEXT"));
    assert.ok(result.includes("global rules"));
  });

  it("returns empty when no context files", () => {
    const emptyDir = join(TMP, "empty");
    mkdirSync(emptyDir, { recursive: true });
    assert.equal(loadGlobalContext(emptyDir), "");
  });
});

describe("loadSessionContext", () => {
  it("loads context from session path", () => {
    writeFileSync(join(TMP, "AGENTS.md"), "session rules");
    const result = loadSessionContext(TMP);
    assert.ok(result.includes("session rules"));
  });

  it("returns empty for empty path", () => {
    assert.equal(loadSessionContext(""), "");
  });
});
