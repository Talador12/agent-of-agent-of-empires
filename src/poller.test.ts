import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeTmuxName,
  sanitizeTmuxName,
  quickHash,
  extractNewLines,
} from "./poller.js";

describe("sanitizeTmuxName", () => {
  it("passes through alphanumeric and dashes/underscores", () => {
    assert.equal(sanitizeTmuxName("my-agent_01"), "my-agent_01");
  });

  it("replaces special characters with underscore", () => {
    assert.equal(sanitizeTmuxName("hello world!"), "hello_world_");
  });

  it("truncates to 20 characters", () => {
    const long = "a".repeat(30);
    assert.equal(sanitizeTmuxName(long), "a".repeat(20));
  });

  it("handles empty string", () => {
    assert.equal(sanitizeTmuxName(""), "");
  });

  it("replaces dots and slashes", () => {
    assert.equal(sanitizeTmuxName("path/to.thing"), "path_to_thing");
  });
});

describe("computeTmuxName", () => {
  it("produces aoe_<sanitized_title>_<id8> format", () => {
    const result = computeTmuxName("abcdef1234567890", "my-agent");
    assert.equal(result, "aoe_my-agent_abcdef12");
  });

  it("sanitizes title and truncates id", () => {
    const result = computeTmuxName("12345678EXTRA", "hello world");
    assert.equal(result, "aoe_hello_world_12345678");
  });

  it("handles short ID", () => {
    const result = computeTmuxName("abc", "test");
    assert.equal(result, "aoe_test_abc");
  });

  it("truncates long titles via sanitize", () => {
    const longTitle = "a-very-long-session-title-that-exceeds-twenty-chars";
    const result = computeTmuxName("abcdef12", longTitle);
    // sanitized title is max 20 chars
    assert.ok(result.startsWith("aoe_a-very-long-session-"));
    assert.ok(result.endsWith("_abcdef12"));
  });
});

describe("quickHash", () => {
  it("returns a 16-char hex string", () => {
    const hash = quickHash("hello world");
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  it("produces different hashes for different inputs", () => {
    assert.notEqual(quickHash("a"), quickHash("b"));
  });

  it("produces same hash for same input (deterministic)", () => {
    assert.equal(quickHash("test"), quickHash("test"));
  });

  it("handles empty string", () => {
    const hash = quickHash("");
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });
});

describe("extractNewLines", () => {
  it("extracts lines after the overlap anchor", () => {
    const previous = "line 1\nline 2\nline 3";
    const current = "line 1\nline 2\nline 3\nnew line 4\nnew line 5";
    const result = extractNewLines(previous, current);
    assert.ok(result.includes("new line 4"));
    assert.ok(result.includes("new line 5"));
  });

  it("returns current when previous is empty lines only", () => {
    const previous = "\n\n\n";
    const current = "hello\nworld";
    // anchor lines is empty (no non-empty lines), so returns current
    const result = extractNewLines(previous, current);
    assert.equal(result, current);
  });

  it("returns last 20 lines when no overlap found", () => {
    const previous = "completely different content\nnothing shared";
    const current = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const result = extractNewLines(previous, current);
    const lines = result.split("\n");
    assert.equal(lines.length, 20);
    assert.equal(lines[0], "line 10");
    assert.equal(lines[19], "line 29");
  });

  it("handles identical content (returns empty)", () => {
    const content = "line 1\nline 2\nline 3";
    const result = extractNewLines(content, content);
    assert.equal(result, "");
  });
});
