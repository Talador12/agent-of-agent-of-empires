import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { tailSession, formatTail, parseTailArgs } from "./session-tail.js";

describe("tailSession", () => {
  it("returns last N lines", () => {
    const output = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const result = tailSession(output, { sessionTitle: "test", lineCount: 10 });
    assert.equal(result.length, 10);
    assert.equal(result[9], "line 99");
  });

  it("strips ANSI codes", () => {
    const result = tailSession(["\x1b[32mgreen text\x1b[0m"], { sessionTitle: "test", stripAnsi: true });
    assert.equal(result[0], "green text");
  });

  it("highlights pattern matches", () => {
    const result = tailSession(["error: something broke"], { sessionTitle: "test", highlightPattern: "error" });
    assert.ok(result[0].includes(">>>error<<<"));
  });

  it("handles empty output", () => {
    const result = tailSession([], { sessionTitle: "test" });
    assert.equal(result.length, 0);
  });
});

describe("formatTail", () => {
  it("includes header and separator", () => {
    const lines = formatTail("adventure", ["line 1", "line 2"], 100);
    assert.ok(lines[0].includes("adventure"));
    assert.ok(lines[0].includes("2 of 100"));
    assert.ok(lines[1].includes("─"));
  });
});

describe("parseTailArgs", () => {
  it("parses session name only", () => {
    const opts = parseTailArgs("adventure");
    assert.equal(opts.sessionTitle, "adventure");
    assert.equal(opts.lineCount, 30);
  });

  it("parses session + count", () => {
    const opts = parseTailArgs("adventure 50");
    assert.equal(opts.sessionTitle, "adventure");
    assert.equal(opts.lineCount, 50);
  });

  it("parses session + count + pattern", () => {
    const opts = parseTailArgs("adventure 20 error");
    assert.equal(opts.sessionTitle, "adventure");
    assert.equal(opts.lineCount, 20);
    assert.equal(opts.highlightPattern, "error");
  });
});
