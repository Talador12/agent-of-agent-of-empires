// cross-session-knowledge.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createKnowledgeStore,
  addKnowledge,
  recordUsage,
  searchKnowledge,
  findRelevant,
  formatKnowledgeStore,
} from "./cross-session-knowledge.js";

describe("addKnowledge", () => {
  it("adds an entry with auto-generated id", () => {
    const store = createKnowledgeStore();
    const entry = addKnowledge(store, {
      sourceSession: "frontend",
      category: "error-fix",
      summary: "Fix ESLint config for React 19",
      tags: ["eslint", "react"],
    });
    assert.ok(entry.id.startsWith("k-"));
    assert.equal(entry.useCount, 0);
    assert.equal(store.entries.length, 1);
  });

  it("evicts oldest least-used when over capacity", () => {
    const store = createKnowledgeStore(3);
    addKnowledge(store, { sourceSession: "a", category: "general", summary: "old", tags: [] }, 1000);
    addKnowledge(store, { sourceSession: "b", category: "general", summary: "mid", tags: [] }, 2000);
    const popular = addKnowledge(store, { sourceSession: "c", category: "general", summary: "popular", tags: [] }, 3000);
    recordUsage(store, popular.id, "user1");
    addKnowledge(store, { sourceSession: "d", category: "general", summary: "new", tags: [] }, 4000);
    assert.equal(store.entries.length, 3);
    // popular entry should survive
    assert.ok(store.entries.some((e) => e.summary === "popular"));
  });
});

describe("recordUsage", () => {
  it("increments use count", () => {
    const store = createKnowledgeStore();
    const entry = addKnowledge(store, { sourceSession: "s1", category: "pattern", summary: "test", tags: [] });
    recordUsage(store, entry.id, "s2");
    assert.equal(entry.useCount, 1);
    assert.deepEqual(entry.usedBy, ["s2"]);
  });

  it("deduplicates usedBy sessions", () => {
    const store = createKnowledgeStore();
    const entry = addKnowledge(store, { sourceSession: "s1", category: "pattern", summary: "test", tags: [] });
    recordUsage(store, entry.id, "s2");
    recordUsage(store, entry.id, "s2");
    assert.equal(entry.useCount, 2);
    assert.equal(entry.usedBy.length, 1);
  });

  it("returns false for unknown id", () => {
    const store = createKnowledgeStore();
    assert.equal(recordUsage(store, "nonexistent", "s1"), false);
  });
});

describe("searchKnowledge", () => {
  it("filters by category", () => {
    const store = createKnowledgeStore();
    addKnowledge(store, { sourceSession: "s1", category: "error-fix", summary: "fix1", tags: [] });
    addKnowledge(store, { sourceSession: "s2", category: "pattern", summary: "pattern1", tags: [] });
    const results = searchKnowledge(store, { category: "error-fix" });
    assert.equal(results.length, 1);
    assert.equal(results[0].summary, "fix1");
  });

  it("filters by tags", () => {
    const store = createKnowledgeStore();
    addKnowledge(store, { sourceSession: "s1", category: "general", summary: "a", tags: ["react", "frontend"] });
    addKnowledge(store, { sourceSession: "s2", category: "general", summary: "b", tags: ["rust", "backend"] });
    const results = searchKnowledge(store, { tags: ["react"] });
    assert.equal(results.length, 1);
    assert.equal(results[0].summary, "a");
  });

  it("filters by keyword", () => {
    const store = createKnowledgeStore();
    addKnowledge(store, { sourceSession: "s1", category: "general", summary: "fix webpack config", tags: [] });
    addKnowledge(store, { sourceSession: "s2", category: "general", summary: "rust build tips", tags: [] });
    const results = searchKnowledge(store, { keyword: "webpack" });
    assert.equal(results.length, 1);
    assert.ok(results[0].summary.includes("webpack"));
  });

  it("filters by repo", () => {
    const store = createKnowledgeStore();
    addKnowledge(store, { sourceSession: "s1", sourceRepo: "/repos/frontend", category: "general", summary: "a", tags: [] });
    addKnowledge(store, { sourceSession: "s2", sourceRepo: "/repos/backend", category: "general", summary: "b", tags: [] });
    const results = searchKnowledge(store, { repo: "frontend" });
    assert.equal(results.length, 1);
  });

  it("respects limit", () => {
    const store = createKnowledgeStore();
    for (let i = 0; i < 10; i++) {
      addKnowledge(store, { sourceSession: "s", category: "general", summary: `entry ${i}`, tags: [] });
    }
    const results = searchKnowledge(store, { limit: 3 });
    assert.equal(results.length, 3);
  });

  it("ranks by use count then recency", () => {
    const store = createKnowledgeStore();
    const old = addKnowledge(store, { sourceSession: "s1", category: "general", summary: "old popular", tags: [] }, 1000);
    addKnowledge(store, { sourceSession: "s2", category: "general", summary: "new", tags: [] }, 5000);
    recordUsage(store, old.id, "x");
    recordUsage(store, old.id, "y");
    const results = searchKnowledge(store, {});
    assert.equal(results[0].summary, "old popular"); // popular first
  });
});

describe("findRelevant", () => {
  it("finds entries matching repo", () => {
    const store = createKnowledgeStore();
    addKnowledge(store, { sourceSession: "other", sourceRepo: "/repos/myapp", category: "error-fix", summary: "fix", tags: [] });
    addKnowledge(store, { sourceSession: "other2", sourceRepo: "/repos/different", category: "general", summary: "nope", tags: [] });
    const results = findRelevant(store, "me", "/repos/myapp");
    assert.equal(results.length, 1);
    assert.equal(results[0].summary, "fix");
  });

  it("finds entries matching goal keywords", () => {
    const store = createKnowledgeStore();
    addKnowledge(store, { sourceSession: "other", category: "pattern", summary: "TypeScript strict mode tips", tags: ["typescript"] });
    addKnowledge(store, { sourceSession: "other2", category: "general", summary: "rust borrow checker", tags: ["rust"] });
    const results = findRelevant(store, "me", undefined, ["typescript"]);
    assert.equal(results.length, 1);
    assert.ok(results[0].summary.includes("TypeScript"));
  });

  it("excludes self-sourced entries", () => {
    const store = createKnowledgeStore();
    addKnowledge(store, { sourceSession: "me", sourceRepo: "/repos/app", category: "general", summary: "my own", tags: [] });
    const results = findRelevant(store, "me", "/repos/app");
    assert.equal(results.length, 0);
  });

  it("boosts popular entries", () => {
    const store = createKnowledgeStore();
    const unpopular = addKnowledge(store, { sourceSession: "a", category: "general", summary: "matching", tags: ["test"] });
    const popular = addKnowledge(store, { sourceSession: "b", category: "general", summary: "also matching", tags: ["test"] });
    for (let i = 0; i < 5; i++) recordUsage(store, popular.id, `user${i}`);
    const results = findRelevant(store, "me", undefined, ["test"]);
    assert.equal(results[0].id, popular.id);
  });

  it("handles empty store", () => {
    const store = createKnowledgeStore();
    const results = findRelevant(store, "me", "/repos/app", ["test"]);
    assert.equal(results.length, 0);
  });
});

describe("formatKnowledgeStore", () => {
  it("formats store summary", () => {
    const store = createKnowledgeStore();
    addKnowledge(store, { sourceSession: "s1", category: "error-fix", summary: "fix auth bug", tags: ["auth"] });
    addKnowledge(store, { sourceSession: "s2", category: "pattern", summary: "retry pattern", tags: ["resilience"] });
    const entry = store.entries[0];
    recordUsage(store, entry.id, "s3");
    const lines = formatKnowledgeStore(store);
    assert.ok(lines[0].includes("2/500"));
    assert.ok(lines.some((l) => l.includes("error-fix")));
    assert.ok(lines.some((l) => l.includes("1 uses") || l.includes("total uses: 1")));
  });

  it("handles empty store", () => {
    const store = createKnowledgeStore();
    const lines = formatKnowledgeStore(store);
    assert.ok(lines[0].includes("0/500"));
  });
});
