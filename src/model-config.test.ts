import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripJsonComments,
  discoverModels,
  normalizeModelName,
  modelsMatch,
  resolveModel,
  checkModelEnforcement,
  formatModelConfig,
  buildModelSearchTerm,
} from "./model-config.js";
import type { AvailableModel, SessionInfo, ModelConfigState } from "./model-config.js";

// --- stripJsonComments ---

describe("stripJsonComments", () => {
  it("removes line comments", () => {
    const input = `{
  // this is a comment
  "key": "value"
}`;
    const result = JSON.parse(stripJsonComments(input));
    assert.equal(result.key, "value");
  });

  it("removes block comments", () => {
    const input = `{
  /* block comment */
  "key": "value"
}`;
    const result = JSON.parse(stripJsonComments(input));
    assert.equal(result.key, "value");
  });

  it("preserves strings containing //", () => {
    const input = `{ "url": "https://example.com" }`;
    const result = JSON.parse(stripJsonComments(input));
    assert.equal(result.url, "https://example.com");
  });

  it("strips trailing commas", () => {
    const input = `{ "a": 1, "b": 2, }`;
    const result = JSON.parse(stripJsonComments(input));
    assert.equal(result.a, 1);
    assert.equal(result.b, 2);
  });

  it("handles trailing commas in arrays", () => {
    const input = `{ "arr": [1, 2, 3, ] }`;
    const result = JSON.parse(stripJsonComments(input));
    assert.deepEqual(result.arr, [1, 2, 3]);
  });

  it("handles empty input", () => {
    assert.equal(stripJsonComments(""), "");
  });
});

// --- discoverModels ---

describe("discoverModels", () => {
  it("always includes known Anthropic models", () => {
    const models = discoverModels("");
    const anthropic = models.filter((m) => m.provider === "anthropic");
    assert.ok(anthropic.length >= 4, "should have at least 4 Anthropic models");
    assert.ok(anthropic.some((m) => m.name === "Claude Opus 4.6"));
  });

  it("parses opencode config with provider models", () => {
    const config = JSON.stringify({
      provider: {
        openai: {
          name: "OpenAI Gateway",
          models: {
            "gpt-4o": { name: "GPT-4o", id: "openai/gpt-4o" },
            "o3": { name: "O3", id: "openai/o3" },
          },
        },
      },
    });
    const models = discoverModels(config);
    assert.ok(models.some((m) => m.name === "GPT-4o"));
    assert.ok(models.some((m) => m.name === "O3"));
    assert.ok(models.some((m) => m.id === "openai/gpt-4o"));
  });

  it("parses Workers AI whitelist models", () => {
    const config = JSON.stringify({
      provider: {
        "cloudflare-workers-ai": {
          name: "Workers AI",
          models: {
            "@cf/moonshotai/kimi-k2.5": {
              id: "workers-ai/@cf/moonshotai/kimi-k2.5",
              name: "Kimi K2.5",
            },
          },
          whitelist: ["@cf/moonshotai/kimi-k2.5", "@cf/zai-org/glm-4.7-flash"],
        },
      },
    });
    const models = discoverModels(config);
    assert.ok(models.some((m) => m.name === "Kimi K2.5"));
    // whitelist item not already covered should be added
    assert.ok(models.some((m) => m.id.includes("glm-4.7-flash")));
  });

  it("handles invalid JSON gracefully", () => {
    const models = discoverModels("not json at all");
    // should still return known Anthropic models
    assert.ok(models.length >= 4);
  });

  it("handles config with no providers", () => {
    const models = discoverModels(JSON.stringify({ model: "test" }));
    assert.ok(models.length >= 4); // Anthropic fallback
  });
});

// --- normalizeModelName ---

describe("normalizeModelName", () => {
  it("lowercases and strips non-alphanumeric", () => {
    assert.equal(normalizeModelName("Claude Opus 4.6"), "claudeopus46");
  });

  it("handles hyphenated names", () => {
    assert.equal(normalizeModelName("claude-opus-4-6"), "claudeopus46");
  });

  it("handles slash-separated ids", () => {
    assert.equal(normalizeModelName("anthropic/claude-opus-4-6"), "anthropicclaudeopus46");
  });
});

// --- modelsMatch ---

describe("modelsMatch", () => {
  it("matches identical strings", () => {
    assert.ok(modelsMatch("Claude Opus 4.6", "Claude Opus 4.6"));
  });

  it("matches display name to hyphenated id", () => {
    assert.ok(modelsMatch("Claude Opus 4.6", "claude-opus-4-6"));
  });

  it("matches with provider prefix stripped", () => {
    assert.ok(modelsMatch("Claude Opus 4.6", "anthropic/claude-opus-4-6"));
  });

  it("matches partial containment", () => {
    assert.ok(modelsMatch("Claude Opus 4.6", "claudeopus46"));
  });

  it("does not match unrelated models", () => {
    assert.ok(!modelsMatch("Claude Opus 4.6", "GPT-4o"));
  });

  it("does not match similar but different versions", () => {
    // Claude Opus 4.6 vs Claude 3.5 Sonnet - these should NOT match
    assert.ok(!modelsMatch("Claude Opus 4.6", "Claude 3.5 Sonnet"));
  });

  it("is case insensitive", () => {
    assert.ok(modelsMatch("CLAUDE OPUS 4.6", "claude opus 4.6"));
  });
});

// --- resolveModel ---

describe("resolveModel", () => {
  const catalog: AvailableModel[] = [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", providerName: "Anthropic" },
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", providerName: "Anthropic" },
    { id: "openai/gpt-4o", name: "GPT-4o", provider: "openai", providerName: "OpenAI" },
    { id: "workers-ai/@cf/moonshotai/kimi-k2.5", name: "Kimi K2.5", provider: "workers-ai", providerName: "Workers AI" },
  ];

  it("resolves exact id match", () => {
    const result = resolveModel("claude-opus-4-6", catalog);
    assert.equal(result?.name, "Claude Opus 4.6");
  });

  it("resolves exact name match", () => {
    const result = resolveModel("Claude Opus 4.6", catalog);
    assert.equal(result?.id, "claude-opus-4-6");
  });

  it("resolves normalized match", () => {
    const result = resolveModel("claude opus 4.6", catalog);
    assert.equal(result?.name, "Claude Opus 4.6");
  });

  it("resolves fuzzy partial match", () => {
    const result = resolveModel("opus 4.6", catalog);
    assert.equal(result?.name, "Claude Opus 4.6");
  });

  it("returns undefined for no match", () => {
    const result = resolveModel("nonexistent-model", catalog);
    assert.equal(result, undefined);
  });
});

// --- checkModelEnforcement ---

describe("checkModelEnforcement", () => {
  const sessions: SessionInfo[] = [
    { sessionId: "a1", sessionTitle: "adventure", tmuxName: "aoe_adventure_a1", detectedModel: "Claude Opus 4.6", isProtected: false },
    { sessionId: "b2", sessionTitle: "code-music", tmuxName: "aoe_code-music_b2", detectedModel: "GPT-4o", isProtected: false },
    { sessionId: "c3", sessionTitle: "business", tmuxName: "aoe_business_c3", detectedModel: "Claude Opus 4.6", isProtected: true },
    { sessionId: "d4", sessionTitle: "new-session", tmuxName: "aoe_new-session_d4", detectedModel: undefined, isProtected: false },
  ];

  it("marks matching sessions as match", () => {
    const results = checkModelEnforcement(sessions, "Claude Opus 4.6");
    const adventure = results.find((r) => r.sessionTitle === "adventure");
    assert.equal(adventure?.action, "match");
  });

  it("marks mismatched sessions as enforce", () => {
    const results = checkModelEnforcement(sessions, "Claude Opus 4.6");
    const codeMusic = results.find((r) => r.sessionTitle === "code-music");
    assert.equal(codeMusic?.action, "enforce");
    assert.equal(codeMusic?.detectedModel, "GPT-4o");
  });

  it("skips protected sessions", () => {
    const results = checkModelEnforcement(sessions, "Claude Opus 4.6");
    const business = results.find((r) => r.sessionTitle === "business");
    assert.equal(business?.action, "skip-protected");
  });

  it("skips sessions with no detected model", () => {
    const results = checkModelEnforcement(sessions, "Claude Opus 4.6");
    const newSession = results.find((r) => r.sessionTitle === "new-session");
    assert.equal(newSession?.action, "skip-no-detection");
  });

  it("returns one result per session", () => {
    const results = checkModelEnforcement(sessions, "Claude Opus 4.6");
    assert.equal(results.length, 4);
  });

  it("handles empty sessions", () => {
    const results = checkModelEnforcement([], "Claude Opus 4.6");
    assert.equal(results.length, 0);
  });

  it("matches hyphenated model names to display names", () => {
    const results = checkModelEnforcement(sessions, "claude-opus-4-6");
    const adventure = results.find((r) => r.sessionTitle === "adventure");
    assert.equal(adventure?.action, "match");
  });
});

// --- formatModelConfig ---

describe("formatModelConfig", () => {
  it("formats state with default model", () => {
    const state: ModelConfigState = {
      defaultModel: "Claude Opus 4.6",
      defaultModelPriority: "high",
      availableModels: [
        { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", providerName: "Anthropic" },
      ],
      sessionStatuses: [],
      lastEnforcementAt: 0,
      enforcementCount: 0,
    };
    const lines = formatModelConfig(state);
    assert.ok(lines.some((l) => l.includes("Claude Opus 4.6")));
    assert.ok(lines.some((l) => l.includes("high")));
  });

  it("formats state without default model", () => {
    const state: ModelConfigState = {
      defaultModel: undefined,
      defaultModelPriority: "high",
      availableModels: [],
      sessionStatuses: [],
      lastEnforcementAt: 0,
      enforcementCount: 0,
    };
    const lines = formatModelConfig(state);
    assert.ok(lines.some((l) => l.includes("No default model configured")));
  });

  it("shows session enforcement status", () => {
    const state: ModelConfigState = {
      defaultModel: "Claude Opus 4.6",
      defaultModelPriority: "high",
      availableModels: [],
      sessionStatuses: [
        { sessionId: "a1", sessionTitle: "adventure", tmuxName: "t", detectedModel: "Claude Opus 4.6", expectedModel: "Claude Opus 4.6", action: "match" },
        { sessionId: "b2", sessionTitle: "code-music", tmuxName: "t", detectedModel: "GPT-4o", expectedModel: "Claude Opus 4.6", action: "enforce" },
      ],
      lastEnforcementAt: Date.now() - 30000,
      enforcementCount: 2,
    };
    const lines = formatModelConfig(state);
    assert.ok(lines.some((l) => l.includes("adventure") && l.includes("OK")));
    assert.ok(lines.some((l) => l.includes("code-music") && l.includes("MISMATCH")));
    assert.ok(lines.some((l) => l.includes("Enforcements applied: 2")));
  });
});

// --- buildModelSearchTerm ---

describe("buildModelSearchTerm", () => {
  it("strips provider suffix from display name", () => {
    assert.equal(buildModelSearchTerm("Claude Opus 4.6 Anthropic: Gateway"), "Claude Opus 4.6");
  });

  it("strips Workers AI suffix", () => {
    assert.equal(buildModelSearchTerm("Kimi K2.5 Workers AI"), "Kimi K2.5");
  });

  it("preserves clean model names", () => {
    assert.equal(buildModelSearchTerm("Claude Opus 4.6"), "Claude Opus 4.6");
  });
});
