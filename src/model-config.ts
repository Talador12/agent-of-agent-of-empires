/**
 * model-config.ts - Default model specification and enforcement for aoaoe.
 *
 * Discovers available models from the opencode config file, allows
 * specifying a default model in aoaoe config, and enforces that default
 * across all supervised opencode sessions via the ctrl+x m keyboard
 * shortcut.
 *
 * The opencode config lives at ~/.config/opencode/opencode.jsonc and
 * defines providers (anthropic, openai, google, cloudflare-workers-ai)
 * each with their own model lists. This module parses that config to
 * build a catalog of available models, then compares each session's
 * detected model against the configured default.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// --- Types ---

export interface AvailableModel {
  id: string;           // e.g. "claude-opus-4-6", "@cf/moonshotai/kimi-k2.5"
  name: string;         // display name, e.g. "Claude Opus 4.6"
  provider: string;     // provider key, e.g. "anthropic", "openai"
  providerName: string; // display name, e.g. "Anthropic: Cloudflare AI Gateway"
}

export interface ModelEnforcementResult {
  sessionId: string;
  sessionTitle: string;
  tmuxName: string;
  detectedModel: string | undefined;
  expectedModel: string;
  action: "match" | "enforce" | "skip-protected" | "skip-no-detection";
}

export interface ModelConfigState {
  defaultModel: string | undefined;
  defaultModelPriority: string;
  availableModels: AvailableModel[];
  sessionStatuses: ModelEnforcementResult[];
  lastEnforcementAt: number;
  enforcementCount: number;
}

// --- Constants ---

const OPENCODE_CONFIG_PATHS = [
  join(homedir(), ".config", "opencode", "opencode.jsonc"),
  join(homedir(), ".config", "opencode", "opencode.json"),
  join(homedir(), ".opencode", "opencode.jsonc"),
  join(homedir(), ".opencode", "opencode.json"),
];

// Known Anthropic models - opencode does not list them in the config file
// because the Anthropic provider auto-discovers from the API. These are
// the models available through the Cloudflare AI Gateway.
const KNOWN_ANTHROPIC_MODELS: AvailableModel[] = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", providerName: "Anthropic" },
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", providerName: "Anthropic" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic", providerName: "Anthropic" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic", providerName: "Anthropic" },
];

// --- Parsing ---

/** Strip JSON comments (// and /* *​/) for JSONC parsing */
export function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      result += ch;
      if (escape) { escape = false; }
      else if (ch === "\\") { escape = true; }
      else if (ch === '"') { inString = false; }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
      continue;
    }

    // line comment
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    // block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2; // skip */
      continue;
    }

    // trailing commas before } or ] - strip them
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") {
        i++; // skip the comma
        continue;
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/** Find and read the opencode config file */
export function findOpencodeConfig(): string | undefined {
  // Also check CWD for project-level config
  const cwdPaths = ["opencode.jsonc", "opencode.json"].map(f => join(process.cwd(), f));
  const allPaths = [...cwdPaths, ...OPENCODE_CONFIG_PATHS];

  for (const p of allPaths) {
    if (existsSync(p)) {
      try { return readFileSync(p, "utf-8"); } catch { /* skip */ }
    }
  }
  return undefined;
}

/** Parse the opencode config and extract available models */
export function discoverModels(configText?: string): AvailableModel[] {
  const models: AvailableModel[] = [];

  // Always include known Anthropic models
  models.push(...KNOWN_ANTHROPIC_MODELS);

  if (!configText) {
    configText = findOpencodeConfig();
  }
  if (!configText) return models;

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(stripJsonComments(configText));
  } catch {
    return models;
  }

  const providers = config.provider as Record<string, unknown> | undefined;
  if (!providers || typeof providers !== "object") return models;

  for (const [providerKey, providerValue] of Object.entries(providers)) {
    if (!providerValue || typeof providerValue !== "object") continue;
    const pv = providerValue as Record<string, unknown>;
    const providerName = (pv.name as string) ?? providerKey;

    // Extract models from provider.models object
    const providerModels = pv.models as Record<string, unknown> | undefined;
    if (providerModels && typeof providerModels === "object") {
      for (const [modelKey, modelValue] of Object.entries(providerModels)) {
        const mv = (modelValue && typeof modelValue === "object") ? modelValue as Record<string, unknown> : {};
        const displayName = (mv.name as string) ?? modelKey;
        const modelId = (mv.id as string) ?? `${providerKey}/${modelKey}`;
        models.push({
          id: modelId,
          name: displayName,
          provider: providerKey,
          providerName,
        });
      }
    }

    // Check whitelist for additional models (workers-ai pattern)
    const whitelist = pv.whitelist as string[] | undefined;
    if (whitelist && Array.isArray(whitelist)) {
      for (const wlModel of whitelist) {
        // Only add if not already covered by the models object
        if (!models.some(m => m.id.includes(wlModel) || m.name === wlModel)) {
          models.push({
            id: `${providerKey}/${wlModel}`,
            name: wlModel,
            provider: providerKey,
            providerName,
          });
        }
      }
    }
  }

  return models;
}

// --- Matching ---

/** Normalize a model name for fuzzy comparison */
export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")  // strip non-alphanumeric
    .replace(/\s+/g, "");
}

/**
 * Check if a detected model name matches the expected default model.
 * Handles various display formats:
 *   "Claude Opus 4.6" matches "claude-opus-4-6"
 *   "Claude Opus 4.6" matches "Claude Opus 4.6"
 *   "claude-opus-4-6" matches "anthropic/claude-opus-4-6"
 */
export function modelsMatch(detected: string, expected: string): boolean {
  if (detected === expected) return true;

  const normDetected = normalizeModelName(detected);
  const normExpected = normalizeModelName(expected);

  if (normDetected === normExpected) return true;

  // Strip provider prefix for comparison
  // "anthropic/claude-opus-4-6" -> "claudeopus46"
  const stripProvider = (s: string) => {
    const slash = s.indexOf("/");
    return slash >= 0 ? normalizeModelName(s.slice(slash + 1)) : normalizeModelName(s);
  };

  if (stripProvider(detected) === stripProvider(expected)) return true;

  // Partial match: one contains the other
  if (normDetected.includes(normExpected) || normExpected.includes(normDetected)) return true;

  return false;
}

/**
 * Resolve a user-supplied model name against the available models catalog.
 * Returns the best matching AvailableModel or undefined.
 */
export function resolveModel(query: string, available: AvailableModel[]): AvailableModel | undefined {
  // Exact match on id or name
  const exact = available.find(m => m.id === query || m.name === query);
  if (exact) return exact;

  // Normalized match
  const normQuery = normalizeModelName(query);
  const normMatch = available.find(m =>
    normalizeModelName(m.id) === normQuery ||
    normalizeModelName(m.name) === normQuery
  );
  if (normMatch) return normMatch;

  // Fuzzy: query contained in model name or id
  const fuzzy = available.find(m =>
    normalizeModelName(m.name).includes(normQuery) ||
    normalizeModelName(m.id).includes(normQuery)
  );
  if (fuzzy) return fuzzy;

  // Reverse fuzzy: model name contained in query
  const reverse = available.find(m =>
    normQuery.includes(normalizeModelName(m.name)) ||
    normQuery.includes(normalizeModelName(m.id))
  );
  if (reverse) return reverse;

  return undefined;
}

// --- Enforcement ---

export interface SessionInfo {
  sessionId: string;
  sessionTitle: string;
  tmuxName: string;
  detectedModel: string | undefined;
  isProtected: boolean;
}

/**
 * Determine which sessions need model enforcement.
 * Does NOT perform the enforcement - caller handles the actual
 * tmux send-keys via executor.restoreModel().
 */
export function checkModelEnforcement(
  sessions: SessionInfo[],
  defaultModel: string,
): ModelEnforcementResult[] {
  const results: ModelEnforcementResult[] = [];

  for (const s of sessions) {
    if (s.isProtected) {
      results.push({
        sessionId: s.sessionId,
        sessionTitle: s.sessionTitle,
        tmuxName: s.tmuxName,
        detectedModel: s.detectedModel,
        expectedModel: defaultModel,
        action: "skip-protected",
      });
      continue;
    }

    if (!s.detectedModel) {
      results.push({
        sessionId: s.sessionId,
        sessionTitle: s.sessionTitle,
        tmuxName: s.tmuxName,
        detectedModel: undefined,
        expectedModel: defaultModel,
        action: "skip-no-detection",
      });
      continue;
    }

    const matches = modelsMatch(s.detectedModel, defaultModel);
    results.push({
      sessionId: s.sessionId,
      sessionTitle: s.sessionTitle,
      tmuxName: s.tmuxName,
      detectedModel: s.detectedModel,
      expectedModel: defaultModel,
      action: matches ? "match" : "enforce",
    });
  }

  return results;
}

// --- TUI Formatting ---

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

export function formatModelConfig(state: ModelConfigState): string[] {
  const lines: string[] = [];
  lines.push(`${BOLD}Model Configuration${RESET}`);
  lines.push("");

  // Default model
  if (state.defaultModel) {
    lines.push(`  Default model: ${CYAN}${state.defaultModel}${RESET}`);
    lines.push(`  Priority: ${state.defaultModelPriority}`);
  } else {
    lines.push(`  ${YELLOW}No default model configured${RESET}`);
    lines.push(`  Set via: config "defaultModel" or --default-model flag`);
  }
  lines.push("");

  // Available models by provider
  const byProvider = new Map<string, AvailableModel[]>();
  for (const m of state.availableModels) {
    const list = byProvider.get(m.providerName) ?? [];
    list.push(m);
    byProvider.set(m.providerName, list);
  }

  lines.push(`  ${BOLD}Available models (${state.availableModels.length}):${RESET}`);
  for (const [provider, models] of byProvider) {
    lines.push(`    ${DIM}${provider}:${RESET}`);
    for (const m of models.slice(0, 8)) { // cap per-provider to avoid flooding
      const isDefault = state.defaultModel && modelsMatch(m.name, state.defaultModel);
      const marker = isDefault ? ` ${GREEN}<- default${RESET}` : "";
      lines.push(`      ${m.name}${DIM} (${m.id})${RESET}${marker}`);
    }
    if (models.length > 8) {
      lines.push(`      ${DIM}... and ${models.length - 8} more${RESET}`);
    }
  }
  lines.push("");

  // Session enforcement status
  if (state.sessionStatuses.length > 0) {
    lines.push(`  ${BOLD}Session model status:${RESET}`);
    for (const s of state.sessionStatuses) {
      let status: string;
      switch (s.action) {
        case "match":
          status = `${GREEN}OK${RESET} (${s.detectedModel})`;
          break;
        case "enforce":
          status = `${RED}MISMATCH${RESET} detected=${s.detectedModel} expected=${s.expectedModel}`;
          break;
        case "skip-protected":
          status = `${YELLOW}protected${RESET} (${s.detectedModel ?? "unknown"})`;
          break;
        case "skip-no-detection":
          status = `${DIM}no model detected yet${RESET}`;
          break;
      }
      lines.push(`    ${s.sessionTitle}: ${status}`);
    }
    lines.push("");
    lines.push(`  Enforcements applied: ${state.enforcementCount}`);
    if (state.lastEnforcementAt > 0) {
      const ago = Math.round((Date.now() - state.lastEnforcementAt) / 1000);
      lines.push(`  Last enforcement: ${ago}s ago`);
    }
  }

  return lines;
}

/**
 * Build the search term for the opencode model picker.
 * Strips provider suffixes and extra metadata to get a clean
 * search string that uniquely matches in the TUI.
 */
export function buildModelSearchTerm(model: string): string {
  return model
    .replace(/\s+(Anthropic|OpenAI|Workers AI|Cloudflare)([:\s].*)?$/i, "")
    .trim();
}
