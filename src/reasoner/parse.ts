// shared response parsing + validation for both reasoner backends
// validates per-action-type required fields to prevent executor crashes
import type { Action, ReasonerResult, ConfidenceLevel } from "../types.js";

// LOW confidence markers in reasoning text
const LOW_CONFIDENCE_PATTERNS = [
  /\bnot sure\b|\bunsure\b|\bunclear\b|\buncertain\b/i,
  /\bmaybe\b|\bperhaps\b|\bmight\b|\bcould be\b/i,
  /\bhard to tell\b|\bdifficult to determine\b|\bcan't tell\b/i,
  /\bguessing\b|\bguess\b|\bassume\b/i,
  /\blimited (context|information|data)\b/i,
];

// HIGH confidence markers
const HIGH_CONFIDENCE_PATTERNS = [
  /\bclearly\b|\bobviously\b|\bdefinitely\b|\bcertainly\b/i,
  /\bthe (agent|session) (is|was|has)\b/i,
  /\bI can see\b|\bI can confirm\b|\bit is clear\b/i,
  /\bsuccessfully\b|\bconfirmed\b|\bcompleted\b/i,
];

/**
 * Infer confidence from the reasoning text and action set.
 * This is a fast heuristic — no LLM call.
 */
export function inferConfidence(reasoning: string | undefined, actions: Action[]): ConfidenceLevel {
  if (!reasoning) return "medium";

  const lowSignals = LOW_CONFIDENCE_PATTERNS.filter((re) => re.test(reasoning)).length;
  const highSignals = HIGH_CONFIDENCE_PATTERNS.filter((re) => re.test(reasoning)).length;

  // a "wait" with no reasoning = low confidence
  if (actions.every((a) => a.action === "wait") && !reasoning.trim()) return "low";

  if (lowSignals >= 2) return "low";
  if (lowSignals === 1 && highSignals === 0) return "low";
  if (highSignals >= 2 && lowSignals === 0) return "high";
  if (highSignals >= 1 && lowSignals === 0) return "high";

  return "medium";
}

// validate a parsed object into a ReasonerResult with per-field type checks
export function validateResult(parsed: unknown): ReasonerResult {
  if (typeof parsed !== "object" || parsed === null) {
    return { actions: [{ action: "wait", reason: "invalid response shape" }] };
  }

  const obj = parsed as Record<string, unknown>;
  const actions = Array.isArray(obj.actions) ? obj.actions : [];

  // validate each action has the right fields for its type
  const validActions: Action[] = [];
  for (const raw of actions) {
    const validated = validateAction(raw);
    if (validated) validActions.push(validated);
  }

  if (validActions.length === 0) {
    validActions.push({ action: "wait", reason: "no valid actions in response" });
  }

  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : undefined;
  return {
    actions: validActions,
    reasoning,
    confidence: inferConfidence(reasoning, validActions),
  };
}

// validate a single action object, returning null if invalid
function validateAction(raw: unknown): Action | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.action !== "string") return null;

  switch (a.action) {
    case "send_input":
      if (typeof a.session !== "string" || !a.session) return null;
      if (typeof a.text !== "string" || !a.text) return null;
      return { action: "send_input", session: a.session, text: a.text };

    case "start_session":
      if (typeof a.session !== "string" || !a.session) return null;
      return { action: "start_session", session: a.session };

    case "stop_session":
      if (typeof a.session !== "string" || !a.session) return null;
      return { action: "stop_session", session: a.session };

    case "create_agent":
      if (typeof a.path !== "string" || !a.path) return null;
      if (typeof a.title !== "string" || !a.title) return null;
      if (typeof a.tool !== "string" || !a.tool) return null;
      return { action: "create_agent", path: a.path, title: a.title, tool: a.tool };

    case "remove_agent":
      if (typeof a.session !== "string" || !a.session) return null;
      return { action: "remove_agent", session: a.session };

    case "report_progress":
      if (typeof a.session !== "string" || !a.session) return null;
      if (typeof a.summary !== "string" || !a.summary) return null;
      return { action: "report_progress", session: a.session, summary: a.summary };

    case "complete_task":
      if (typeof a.session !== "string" || !a.session) return null;
      if (typeof a.summary !== "string" || !a.summary) return null;
      return { action: "complete_task", session: a.session, summary: a.summary };

    case "wait":
      return { action: "wait", reason: typeof a.reason === "string" ? a.reason : undefined };

    default:
      return null; // unknown action type
  }
}

// parse raw LLM output into a ReasonerResult, handling JSON in various wrappers
export function parseReasonerResponse(raw: string): ReasonerResult {
  const trimmed = raw.trim();

  // empty or whitespace-only response — the LLM returned nothing
  if (!trimmed) {
    return { actions: [{ action: "wait", reason: "LLM returned empty response" }] };
  }

  // try direct JSON parse
  try {
    return validateResult(JSON.parse(trimmed));
  } catch {
    // might have markdown fences or other wrapping
  }

  // extract JSON from markdown code blocks
  const jsonMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      return validateResult(JSON.parse(jsonMatch[1]));
    } catch {
      // fall through
    }
  }

  // last resort: find JSON objects by scanning for balanced braces
  // (greedy regex could match the wrong block when multiple objects exist)
  const jsonObj = extractFirstValidJson(trimmed);
  if (jsonObj !== null) {
    return validateResult(jsonObj);
  }

  return { actions: [{ action: "wait", reason: "failed to parse reasoner response" }] };
}

// scan for balanced { ... } substrings and try to JSON.parse each one
// string-literal-aware: skips braces inside "..." to avoid miscounting
// returns the first successfully parsed object, or null
export function extractFirstValidJson(text: string): unknown {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // skip string literals (handles \" escapes inside strings)
    if (ch === '"' && depth > 0) {
      i++; // advance past opening quote
      while (i < text.length) {
        if (text[i] === "\\") {
          i++; // skip escaped char
        } else if (text[i] === '"') {
          break; // closing quote
        }
        i++;
      }
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          // not valid JSON at this range, keep scanning
          start = -1;
        }
      }
      if (depth < 0) depth = 0; // reset on stray closing brace
    }
  }
  return null;
}
