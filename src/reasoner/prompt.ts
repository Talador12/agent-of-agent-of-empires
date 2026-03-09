import type { Observation, AoaoeConfig } from "../types.js";

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

// per-session idle/error tracking for policy enforcement
export interface SessionPolicyState {
  sessionId: string;
  lastOutputChangeAt: number; // timestamp of last observed output change
  consecutiveErrorPolls: number; // polls where status was "error"
  hasPermissionPrompt: boolean; // detected a permission/confirmation prompt
}

// detect permission prompts in tmux output
const PERMISSION_PATTERNS = [
  /\b(?:allow|deny|permit)\b.*\?\s*$/im,
  /\b(?:y\/n|yes\/no)\b/im,
  /\bdo you want to (?:continue|proceed)\b/im,
  /\bpress (?:enter|y) to (?:continue|confirm|allow)\b/im,
  /\b(?:approve|reject)\b.*\?\s*$/im,
];

export function detectPermissionPrompt(output: string): boolean {
  const lastLines = output.split("\n").slice(-10).join("\n");
  return PERMISSION_PATTERNS.some((p) => p.test(lastLines));
}

// format an observation into a user prompt, with optional policy annotations
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

  // policy alerts: inject concrete idle/error/permission data so the reasoner has facts
  const policies = obs.policyContext?.policies;
  const policyStates = obs.policyContext?.sessionStates;
  if (policies && policyStates && policyStates.length > 0) {
    const alerts: string[] = [];
    const now = obs.timestamp;

    for (const ps of policyStates) {
      const idleMs = now - ps.lastOutputChangeAt;
      if (idleMs >= policies.maxIdleBeforeNudgeMs) {
        const idleSec = Math.round(idleMs / 1000);
        const threshSec = Math.round(policies.maxIdleBeforeNudgeMs / 1000);
        alerts.push(
          `  IDLE: session ${ps.sessionId.slice(0, 8)} has been idle for ${idleSec}s ` +
          `(threshold: ${threshSec}s). Consider nudging.`
        );
      }
      if (ps.consecutiveErrorPolls >= policies.maxErrorsBeforeRestart) {
        alerts.push(
          `  ERROR: session ${ps.sessionId.slice(0, 8)} has been in error state for ` +
          `${ps.consecutiveErrorPolls} consecutive polls (threshold: ${policies.maxErrorsBeforeRestart}). ` +
          `Consider restarting.`
        );
      }
      if (ps.hasPermissionPrompt && policies.autoAnswerPermissions) {
        alerts.push(
          `  PERMISSION: session ${ps.sessionId.slice(0, 8)} appears to be waiting for ` +
          `a permission/confirmation prompt. Auto-answer policy is enabled -- send "y" or the appropriate response.`
        );
      }
    }

    if (alerts.length > 0) {
      parts.push("Policy alerts:");
      parts.push(...alerts);
      parts.push("");
    }
  }

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
