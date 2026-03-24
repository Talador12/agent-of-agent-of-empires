import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeTmuxName,
  sanitizeTmuxName,
  quickHash,
  extractNewLines,
  stripAnsi,
  buildProfileListArgs,
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


});

describe("stripAnsi", () => {
  it("removes CSI color codes", () => {
    assert.equal(stripAnsi("\x1b[31mred text\x1b[0m"), "red text");
  });

  it("removes CSI bold/underline", () => {
    assert.equal(stripAnsi("\x1b[1mbold\x1b[22m \x1b[4munderline\x1b[24m"), "bold underline");
  });

  it("removes cursor movement sequences", () => {
    assert.equal(stripAnsi("\x1b[2Ahello\x1b[K"), "hello");
  });

  it("removes 256-color and truecolor codes", () => {
    assert.equal(stripAnsi("\x1b[38;5;196mred\x1b[0m"), "red");
    assert.equal(stripAnsi("\x1b[38;2;255;0;0mred\x1b[0m"), "red");
  });

  it("removes OSC sequences (title setting)", () => {
    assert.equal(stripAnsi("\x1b]0;window title\x07text"), "text");
  });

  it("removes OSC with ST terminator", () => {
    assert.equal(stripAnsi("\x1b]0;title\x1b\\text"), "text");
  });

  it("handles multiple escape sequences in one line", () => {
    assert.equal(
      stripAnsi("\x1b[1m\x1b[32m✓\x1b[0m test passed \x1b[90m(0.5ms)\x1b[0m"),
      "✓ test passed (0.5ms)",
    );
  });

  it("handles progress bar spinners", () => {
    // typical spinner: \r + cursor move + overwrite
    const spinner = "\x1b[2K\x1b[1G⠋ Loading...\x1b[2K\x1b[1G⠙ Loading...";
    assert.equal(stripAnsi(spinner), "⠋ Loading...⠙ Loading...");
  });

  it("strips 8-bit CSI (0x9b) sequences", () => {
    assert.equal(stripAnsi("\x9b31mred\x9b0m"), "red");
  });

  it("preserves newlines and meaningful whitespace", () => {
    assert.equal(stripAnsi("\x1b[32mline1\x1b[0m\nline2\n  indented"), "line1\nline2\n  indented");
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

  it("handles repeated lines correctly (no false negatives)", () => {
    const previous = "BUILD OK\nBUILD OK\nBUILD OK";
    const current = "BUILD OK\nBUILD OK\nBUILD OK\nnew output here";
    const result = extractNewLines(previous, current);
    assert.ok(result.includes("new output here"));
  });

  it("handles repeated log lines with new content after", () => {
    const previous = "test 1 passed\ntest 2 passed\ntest 3 passed\ntest 4 passed\ntest 5 passed";
    const current = "test 1 passed\ntest 2 passed\ntest 3 passed\ntest 4 passed\ntest 5 passed\ntest 6 passed\ntest 7 FAILED";
    const result = extractNewLines(previous, current);
    assert.ok(result.includes("test 6 passed"));
    assert.ok(result.includes("test 7 FAILED"));
    assert.ok(!result.includes("test 5 passed"));
  });

  it("handles build progress lines that repeat", () => {
    const previous = "[build] compiling...\n[build] compiling...\n[build] compiling...";
    const current = "[build] compiling...\n[build] compiling...\n[build] compiling...\n[build] done!\nerrors: 0";
    const result = extractNewLines(previous, current);
    assert.ok(result.includes("[build] done!"));
    assert.ok(result.includes("errors: 0"));
  });

  it("skips blank lines when matching anchor", () => {
    const previous = "line A\n\nline B\n\nline C";
    const current = "line A\n\nline B\n\nline C\n\nnew stuff";
    const result = extractNewLines(previous, current);
    assert.ok(result.includes("new stuff"));
    assert.ok(!result.includes("line C"));
  });
});

// ── buildProfileListArgs ─────────────────────────────────────────────────

describe("buildProfileListArgs", () => {
  it("returns ['list', '--json'] for default profile", () => {
    assert.deepEqual(buildProfileListArgs("default"), ["list", "--json"]);
  });

  it("returns ['-p', name, 'list', '--json'] for non-default profile", () => {
    assert.deepEqual(buildProfileListArgs("work"), ["-p", "work", "list", "--json"]);
  });

  it("handles profile with special characters", () => {
    const args = buildProfileListArgs("my-profile_2");
    assert.deepEqual(args, ["-p", "my-profile_2", "list", "--json"]);
  });

  it("treats empty string as non-default", () => {
    const args = buildProfileListArgs("");
    assert.deepEqual(args, ["-p", "", "list", "--json"]);
  });
});
