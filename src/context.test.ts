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
  resolveProjectDir,
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

describe("resolveProjectDir", () => {
  it("finds a direct child matching the title", () => {
    mkdirSync(join(TMP, "adventure"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "adventure"), join(TMP, "adventure"));
  });

  it("finds a nested child (group/repo) matching the title", () => {
    // simulate: repos/github/adventure/
    mkdirSync(join(TMP, "github", "adventure"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "adventure"), join(TMP, "github", "adventure"));
  });

  it("matches case-insensitively", () => {
    mkdirSync(join(TMP, "github", "Adventure"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "adventure"), join(TMP, "github", "Adventure"));
  });

  it("normalizes spaces and underscores to hyphens", () => {
    // session title: "agent of agent of empires" -> "agent-of-agent-of-empires"
    mkdirSync(join(TMP, "github", "agent-of-agent-of-empires"), { recursive: true });
    assert.equal(
      resolveProjectDir(TMP, "agent of agent of empires"),
      join(TMP, "github", "agent-of-agent-of-empires"),
    );
  });

  it("normalizes underscores in directory names", () => {
    mkdirSync(join(TMP, "my_project"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "my-project"), join(TMP, "my_project"));
  });

  it("prefers direct child over nested match", () => {
    // both repos/cloudchamber/ and repos/cc/cloudchamber/ exist
    mkdirSync(join(TMP, "cloudchamber"), { recursive: true });
    mkdirSync(join(TMP, "cc", "cloudchamber"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "cloudchamber"), join(TMP, "cloudchamber"));
  });

  it("returns null when no match found", () => {
    mkdirSync(join(TMP, "github", "other-project"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "nonexistent"), null);
  });

  it("returns null for empty inputs", () => {
    assert.equal(resolveProjectDir("", "title"), null);
    assert.equal(resolveProjectDir(TMP, ""), null);
  });

  it("skips hidden directories", () => {
    mkdirSync(join(TMP, ".hidden", "adventure"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "adventure"), null);
  });

  it("skips node_modules", () => {
    mkdirSync(join(TMP, "node_modules", "adventure"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "adventure"), null);
  });

  it("finds across multiple group folders", () => {
    // repos/github/adventure and repos/cc/cloudchamber
    mkdirSync(join(TMP, "github", "adventure"), { recursive: true });
    mkdirSync(join(TMP, "cc", "cloudchamber"), { recursive: true });
    assert.equal(resolveProjectDir(TMP, "adventure"), join(TMP, "github", "adventure"));
    assert.equal(resolveProjectDir(TMP, "cloudchamber"), join(TMP, "cc", "cloudchamber"));
  });
});

describe("loadSessionContext", () => {
  it("loads context from resolved project dir", () => {
    // simulate repos/github/adventure with AGENTS.md
    mkdirSync(join(TMP, "github", "adventure"), { recursive: true });
    writeFileSync(join(TMP, "github", "adventure", "AGENTS.md"), "adventure rules");
    const result = loadSessionContext(TMP, "adventure");
    assert.ok(result.includes("adventure rules"));
  });

  it("includes group-level context from parent dir", () => {
    // simulate repos/github/claude.md + repos/github/adventure/
    mkdirSync(join(TMP, "github", "adventure"), { recursive: true });
    writeFileSync(join(TMP, "github", "claude.md"), "github group context");
    const result = loadSessionContext(TMP, "adventure");
    assert.ok(result.includes("github group context"));
    assert.ok(result.includes("parent directory"));
  });

  it("loads both repo-level and group-level context", () => {
    mkdirSync(join(TMP, "cc", "cloudchamber"), { recursive: true });
    writeFileSync(join(TMP, "cc", "cloudchamber", "AGENTS.md"), "cc repo rules");
    writeFileSync(join(TMP, "cc", "claude.md"), "cc group roadmap");
    const result = loadSessionContext(TMP, "cloudchamber");
    assert.ok(result.includes("cc repo rules"));
    assert.ok(result.includes("cc group roadmap"));
  });

  it("falls back to session path when title doesnt resolve", () => {
    writeFileSync(join(TMP, "AGENTS.md"), "fallback rules");
    const result = loadSessionContext(TMP, "nonexistent-project");
    assert.ok(result.includes("fallback rules"));
  });

  it("returns empty for empty path", () => {
    assert.equal(loadSessionContext(""), "");
  });

  it("works without title (backwards compat)", () => {
    writeFileSync(join(TMP, "AGENTS.md"), "no-title rules");
    const result = loadSessionContext(TMP);
    assert.ok(result.includes("no-title rules"));
  });
});
