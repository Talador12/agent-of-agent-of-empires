// shared response parsing + validation for both reasoner backends
// validates per-action-type required fields to prevent executor crashes
import type { Action, ReasonerResult } from "../types.js";

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

  return {
    actions: validActions,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : undefined,
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

    case "wait":
      return { action: "wait", reason: typeof a.reason === "string" ? a.reason : undefined };

    default:
      return null; // unknown action type
  }
}

// parse raw LLM output into a ReasonerResult, handling JSON in various wrappers
export function parseReasonerResponse(raw: string): ReasonerResult {
  const trimmed = raw.trim();

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

  // last resort: find first { ... } block
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return validateResult(JSON.parse(braceMatch[0]));
    } catch {
      // give up
    }
  }

  return { actions: [{ action: "wait", reason: "failed to parse reasoner response" }] };
}
