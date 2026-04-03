import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  extractRepoName,
  extractGoalTokens,
  suggestSessionNames,
  formatNameSuggestions,
} from "./smart-session-naming.js";

describe("extractRepoName", () => {
  it("extracts last segment from path", () => {
    assert.equal(extractRepoName("/Users/dev/repos/github/adventure"), "adventure");
  });
  it("handles nested paths", () => {
    assert.equal(extractRepoName("github/agent-of-agent-of-empires"), "agent-of-agent-of-empires");
  });
  it("strips .git suffix", () => {
    assert.equal(extractRepoName("myrepo.git"), "myrepo");
  });
  it("strips -main suffix", () => {
    assert.equal(extractRepoName("project-main"), "project");
  });
  it("handles empty path", () => {
    assert.equal(extractRepoName(""), "unknown");
  });
  it("handles Windows backslashes", () => {
    assert.equal(extractRepoName("C:\\Users\\dev\\myproject"), "myproject");
  });
});

describe("extractGoalTokens", () => {
  it("extracts verbs and nouns", () => {
    const { verbs, nouns } = extractGoalTokens("Add authentication to the user dashboard");
    assert.ok(verbs.includes("add"));
    assert.ok(nouns.includes("authentication"));
    assert.ok(nouns.includes("dashboard"));
  });
  it("deduplicates", () => {
    const { verbs } = extractGoalTokens("fix the bug and fix the tests");
    assert.equal(verbs.length, 1);
  });
  it("filters stopwords", () => {
    const { nouns } = extractGoalTokens("the quick brown fox");
    assert.ok(!nouns.includes("the"));
  });
  it("handles empty string", () => {
    const { verbs, nouns } = extractGoalTokens("");
    assert.equal(verbs.length, 0);
    assert.equal(nouns.length, 0);
  });
});

describe("suggestSessionNames", () => {
  it("generates repo-verb suggestions", () => {
    const suggestions = suggestSessionNames("github/adventure", "fix the authentication bug");
    assert.ok(suggestions.some((s) => s.title === "adventure-fix"));
  });

  it("generates repo-noun suggestions", () => {
    const suggestions = suggestSessionNames("github/adventure", "implement user authentication");
    assert.ok(suggestions.some((s) => s.title.includes("adventure")));
  });

  it("generates verb-noun suggestions", () => {
    const suggestions = suggestSessionNames("github/adventure", "add metrics dashboard");
    assert.ok(suggestions.some((s) => s.title === "add-metrics"));
  });

  it("avoids existing titles", () => {
    const suggestions = suggestSessionNames("github/adventure", "fix auth bug", ["adventure-fix"]);
    const titles = suggestions.map((s) => s.title);
    assert.ok(!titles.includes("adventure-fix"));
  });

  it("falls back to repo basename", () => {
    const suggestions = suggestSessionNames("github/adventure", "do it", []);
    // "do" is too short (2 chars), "it" is a stopword, so verbs/nouns are empty
    assert.ok(suggestions.length > 0);
  });

  it("adds numeric suffix when all names taken", () => {
    const existing = ["adventure", "adventure-2", "adventure-3"];
    const suggestions = suggestSessionNames("github/adventure", "", existing);
    assert.ok(suggestions.some((s) => /adventure-\d/.test(s.title)));
  });
});

describe("formatNameSuggestions", () => {
  it("shows no-suggestions message when empty", () => {
    const lines = formatNameSuggestions([]);
    assert.ok(lines[0].includes("no suggestions"));
  });

  it("shows suggestions with confidence", () => {
    const suggestions = suggestSessionNames("github/adventure", "add dark mode toggle");
    const lines = formatNameSuggestions(suggestions);
    assert.ok(lines[0].includes("Session Name Suggestions"));
    assert.ok(lines.some((l) => l.includes("adventure")));
  });
});
