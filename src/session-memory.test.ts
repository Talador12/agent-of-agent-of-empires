import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { getMemoryContext, formatSessionMemory } from "./session-memory.js";
import type { SessionMemory, MemoryEntry } from "./session-memory.js";

// test only pure functions — file I/O tested via integration

describe("getMemoryContext", () => {
  it("returns empty string for no entries", () => {
    // getMemoryContext loads from disk — if no file, returns ""
    const ctx = getMemoryContext("nonexistent-session-xyz");
    assert.equal(ctx, "");
  });
});

describe("formatSessionMemory", () => {
  it("shows empty message for no memories", () => {
    const memory: SessionMemory = { sessionTitle: "test", repo: "", entries: [], lastUpdatedAt: 0 };
    const lines = formatSessionMemory(memory);
    assert.ok(lines[0].includes("no memories"));
  });

  it("formats entries with category and age", () => {
    const memory: SessionMemory = {
      sessionTitle: "adventure",
      repo: "github/adventure",
      entries: [
        { timestamp: Date.now() - 5 * 60_000, category: "error_pattern", text: "SQLite lock timeout" },
        { timestamp: Date.now() - 2 * 60_000, category: "success_pattern", text: "retry with backoff works" },
      ],
      lastUpdatedAt: Date.now(),
    };
    const lines = formatSessionMemory(memory);
    assert.ok(lines[0].includes("adventure"));
    assert.ok(lines[0].includes("2 memories"));
    assert.ok(lines.some((l) => l.includes("error_pattern")));
    assert.ok(lines.some((l) => l.includes("success_pattern")));
  });

  it("limits to last 10 entries", () => {
    const entries: MemoryEntry[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: Date.now() - i * 60_000,
      category: "context_hint" as const,
      text: `hint ${i}`,
    }));
    const memory: SessionMemory = { sessionTitle: "test", repo: "r", entries, lastUpdatedAt: Date.now() };
    const lines = formatSessionMemory(memory);
    // header + 10 entries max
    assert.ok(lines.length <= 11);
  });
});
