import type { Observation } from "../types.js";

// shared system prompt used by both backends
export const SYSTEM_PROMPT = `You are a supervisor managing multiple AI coding agents in an agent-of-empires (AoE) tmux session.

You receive periodic observations of each agent's terminal output and status.

Your job:
- Monitor agent progress. If an agent is stuck, idle, or erroring, intervene.
- If an agent asks a question and is waiting for input, answer it or provide guidance.
- If an agent finishes its task, acknowledge and optionally assign follow-up work.
- If a session crashes or is stopped unexpectedly, restart it.
- Do NOT micromanage. Only intervene when there is a clear problem or a decision is needed.
- When multiple actions are needed, return them all at once.

Respond with ONLY a JSON object matching this schema:
{
  "reasoning": "brief explanation of your assessment",
  "actions": [
    { "action": "send_input", "session": "<id>", "text": "<prompt to send>" },
    { "action": "start_session", "session": "<id>" },
    { "action": "stop_session", "session": "<id>" },
    { "action": "create_agent", "path": "<dir>", "title": "<name>", "tool": "<claude|opencode|gemini|codex|vibe>" },
    { "action": "remove_agent", "session": "<id>" },
    { "action": "wait", "reason": "why no action is needed" }
  ]
}

Rules:
- Always return valid JSON. No markdown fences, no extra text.
- If no action is needed, return { "reasoning": "...", "actions": [{ "action": "wait", "reason": "..." }] }
- When sending input, be concise and direct. You are typing into a terminal prompt.
- Prefer "wait" over unnecessary intervention. Agents work best when left alone.
- Never send empty or trivial messages to agents.`;

// format an observation into a user prompt
export function formatObservation(obs: Observation): string {
  const parts: string[] = [];

  parts.push(`Observation at ${new Date(obs.timestamp).toISOString()}`);
  parts.push(`Active sessions: ${obs.sessions.length}`);
  parts.push("");

  // session summary table
  parts.push("Sessions:");
  for (const snap of obs.sessions) {
    const s = snap.session;
    parts.push(`  [${s.id.slice(0, 8)}] "${s.title}" tool=${s.tool} status=${s.status}`);
  }
  parts.push("");

  if (obs.changes.length === 0) {
    parts.push("No new output from any session since last poll.");
  } else {
    parts.push(`Changes detected in ${obs.changes.length} session(s):`);
    parts.push("");
    for (const ch of obs.changes) {
      parts.push(`--- ${ch.title} [${ch.sessionId.slice(0, 8)}] (${ch.tool}, ${ch.status}) ---`);
      // truncate very long output to keep context manageable
      const lines = ch.newLines.split("\n");
      if (lines.length > 50) {
        parts.push(`[${lines.length} lines, showing last 50]`);
        parts.push(lines.slice(-50).join("\n"));
      } else {
        parts.push(ch.newLines);
      }
      parts.push("");
    }
  }

  // user operator message (injected via stdin)
  if (obs.userMessage) {
    parts.push("--- OPERATOR MESSAGE (from human supervisor) ---");
    parts.push(obs.userMessage);
    parts.push("--- END OPERATOR MESSAGE ---");
    parts.push("");
    parts.push("IMPORTANT: The operator message above takes priority. Factor it into your decision.");
  }

  return parts.join("\n");
}
