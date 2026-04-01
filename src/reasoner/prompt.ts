import type { Observation, AoaoeConfig, TaskState, SessionSnapshot } from "../types.js";
import { goalToList } from "../types.js";
import { applyPromptTemplate } from "./prompt-templates.js";

// base system prompt -- global context appended at runtime via buildSystemPrompt()
const BASE_SYSTEM_PROMPT = `You are a supervisor managing multiple AI coding agents in an agent-of-empires (AoE) tmux session.

You receive periodic observations of each agent's terminal output and status.

Your job:
- Monitor agent progress. If an agent is stuck, idle, or erroring, intervene.
- If an agent asks a question and is waiting for input, answer it or provide guidance.
- If an agent finishes its task, acknowledge and optionally assign follow-up work.
- If a session crashes or is stopped unexpectedly, restart it.
- Do NOT micromanage. Only intervene when there is a clear problem or a decision is needed.
- When multiple actions are needed, return them all at once.
- Use the project context (AGENTS.md / claude.md) to understand each project's goals,
  coding guidelines, and current work items. This context tells you what each agent
  should be working on and how to guide them.

Respond with ONLY a JSON object matching this schema:
{
  "reasoning": "A plain-English explanation shown directly to the human operator. Write this as if explaining to someone watching over your shoulder who may not be a programmer. Say what you see, what you think, and why you're acting (or not). Examples: 'Adventure is making good progress on authentication — no help needed.' or 'Cloud Hypervisor has been stuck on a compile error for 2 minutes, so I'm sending a hint.'",
  "actions": [
    { "action": "send_input", "session": "<id>", "text": "<prompt to send>" },
    { "action": "start_session", "session": "<id>" },
    { "action": "stop_session", "session": "<id>" },
    { "action": "create_agent", "path": "<dir>", "title": "<name>", "tool": "<claude|opencode|gemini|codex|vibe>" },
    { "action": "remove_agent", "session": "<id>" },
    { "action": "report_progress", "session": "<id>", "summary": "brief description of what was accomplished" },
    { "action": "complete_task", "session": "<id>", "summary": "final summary of completed work" },
    { "action": "wait", "reason": "why no action is needed" }
  ]
}

Rules:
- Always return valid JSON. No markdown fences, no extra text.
- The "reasoning" field is REQUIRED and shown to the human operator. Write it in plain English.
  Do NOT use jargon, session IDs, or technical shorthand. Use session titles (e.g. "Adventure").
- If no action is needed, return { "reasoning": "...", "actions": [{ "action": "wait", "reason": "..." }] }
- When sending input, be concise and direct. You are typing into a terminal prompt.
- Prefer "wait" over unnecessary intervention. Agents work best when left alone.
- Never send empty or trivial messages to agents.
- Use "report_progress" to log meaningful milestones (commits, tests passing, features completed).
  Do NOT report trivial progress like "agent is working" -- only concrete accomplishments.
- Use "complete_task" when a task's goal has been fully achieved and the agent has nothing left to do.
  This will clean up the session. Only use when truly done, not just idle.`;

// build the full system prompt with global context appended
export function buildSystemPrompt(globalContext?: string, promptTemplate?: string): string {
  const base = applyPromptTemplate(BASE_SYSTEM_PROMPT, promptTemplate ?? "default");
  if (!globalContext) return base;
  return `${base}\n${globalContext}`;
}

// per-session idle/error tracking for policy enforcement
export interface SessionPolicyState {
  sessionId: string;
  lastOutputChangeAt: number; // timestamp of last observed output change
  consecutiveErrorPolls: number; // polls where status was "error"
  hasPermissionPrompt: boolean; // detected a permission/confirmation prompt
}

// detect permission prompts in tmux output.
// the prompt-watcher module (prompt-watcher.ts) handles these reactively via
// pipe-pane for near-instant clearing. these patterns are kept here as a
// fallback for the daemon's policy alerting (loop.ts reads hasPermissionPrompt).
const PERMISSION_PATTERNS = [
  // opencode TUI permission dialog:
  //   ┃  △ Permission required
  //   ┃    → Edit hello.txt
  //   ┃   Allow once   Allow always   Reject
  /Permission required/i,
  /Allow once/i,
  // generic permission patterns (Claude Code, other tools)
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

// total prompt budget — prevents blowing through LLM context windows
// context is prioritized: changes > policy alerts > project context (trimmed last)
const MAX_PROMPT_BYTES = 100_000; // ~100KB

// slice a string to fit within a byte budget (UTF-8). String.slice() operates
// on UTF-16 code units, not bytes — multi-byte chars (emoji, CJK, accents)
// would overshoot a byte budget if we used .slice(0, byteLimit) directly.
export function sliceToByteLimit(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf-8") <= maxBytes) return s;
  // binary search for the character index that fits within the byte limit
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (Buffer.byteLength(s.slice(0, mid), "utf-8") <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return s.slice(0, lo);
}

// how long without progress before flagging a task as possibly stuck
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// format task context for the reasoner — tells it what each session is working on
export function formatTaskContext(tasks: TaskState[], stuckThresholdMs = STUCK_THRESHOLD_MS): string {
  if (tasks.length === 0) return "";
  const now = Date.now();
  const parts: string[] = [];
  const stuckTasks: string[] = [];

  parts.push("Active tasks (each session is working toward a specific goal):");
  for (const t of tasks) {
    const statusTag = t.status === "completed" ? "COMPLETED" : t.status.toUpperCase();
    const lastProgressMs = t.lastProgressAt ? now - t.lastProgressAt : Infinity;
    const isStuck = t.status === "active" && lastProgressMs > stuckThresholdMs;
    const stuckTag = isStuck ? " ⚠ POSSIBLY STUCK" : "";
    const depsTag = t.dependsOn && t.dependsOn.length > 0
      ? ` [depends on: ${t.dependsOn.join(", ")}]`
      : "";
    const blockedTag = t.status === "pending" && t.dependsOn && t.dependsOn.length > 0
      ? " ⏳ BLOCKED"
      : "";
    parts.push(`  [${statusTag}${stuckTag}${blockedTag}] "${t.sessionTitle}" (${t.repo})${depsTag}`);
    const goalItems = goalToList(t.goal);
    parts.push(`    Goal:`);
    for (const item of goalItems) parts.push(`      - ${item}`);
    if (t.progress.length > 0) {
      const recent = t.progress.slice(-3);
      parts.push(`    Recent progress:`);
      for (const p of recent) {
        const ago = Math.round((now - p.at) / 60_000);
        const agoStr = ago < 1 ? "just now" : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
        parts.push(`      - ${p.summary} (${agoStr})`);
      }
    } else if (t.status === "active") {
      parts.push(`    No progress recorded yet.`);
    }
    if (isStuck) {
      const stuckMin = Math.round(lastProgressMs / 60_000);
      stuckTasks.push(`"${t.sessionTitle}" (no progress for ${stuckMin}m)`);
    }
  }

  if (stuckTasks.length > 0) {
    parts.push("");
    parts.push(`⚠ STUCK TASKS: ${stuckTasks.join(", ")}`);
    parts.push("Consider checking these sessions — they may need a nudge, be waiting for input, or be blocked on an error.");
  }

  parts.push("");
  parts.push("Use report_progress when agents achieve concrete milestones.");
  parts.push("Use complete_task when a task's goal is fully achieved.");
  parts.push("If a task seems stuck, check the session output and send_input to help it get unstuck.");
  parts.push("");
  return parts.join("\n");
}

// format an observation into a user prompt, with optional policy annotations
export function formatObservation(obs: Observation): string {
  const parts: string[] = [];

  parts.push(`Observation at ${new Date(obs.timestamp).toISOString()}`);
  parts.push(`Active sessions: ${obs.sessions.length}`);
  parts.push("");

  // resolve protected sessions list from config (attached by loop.ts)
   const protectedList = obs.protectedSessions ?? [];
   const drainingList = new Set(obs.drainingSessionIds ?? []);

   // session summary table
   parts.push("Sessions:");
   const activeSessions: string[] = [];
   for (const snap of obs.sessions) {
     const s = snap.session;
     const activeTag = snap.userActive ? " [USER ACTIVE]" : "";
     const protectedTag = protectedList.some((p) => p.toLowerCase() === s.title.toLowerCase()) ? " [PROTECTED]" : "";
     const drainingTag = drainingList.has(s.id) ? " [DRAINING — skip, do not send input]" : "";
     parts.push(`  [${s.id.slice(0, 8)}] "${s.title}" tool=${s.tool} status=${s.status} path=${s.path}${activeTag}${protectedTag}${drainingTag}`);
    if (snap.userActive) activeSessions.push(s.title);
  }
   if (activeSessions.length > 0) {
     parts.push("");
     parts.push(`WARNING: A human user is currently interacting with: ${activeSessions.join(", ")}.`);
     parts.push("Do NOT send input to these sessions. The user is actively working and your input would interfere.");
   }
   if (drainingList.size > 0) {
     const drainingTitles = obs.sessions
       .filter((s) => drainingList.has(s.session.id))
       .map((s) => `"${s.session.title}"`);
     if (drainingTitles.length > 0) {
       parts.push("");
       parts.push(`DRAINING: ${drainingTitles.join(", ")} — do NOT assign new tasks or send_input to these sessions.`);
     }
   }
  parts.push("");

  // task context (goals, progress) — injected if tasks are defined
  if (obs.taskContext && obs.taskContext.length > 0) {
    parts.push(formatTaskContext(obs.taskContext));
  }

  // per-session project context (AGENTS.md / claude.md from each session's path)
  // only include context for sessions with changes to stay within budget
  const changedIds = new Set(obs.changes.map((c) => c.sessionId));
  const sessionsWithContext = obs.sessions.filter((s) => s.projectContext);
  // prioritize: sessions with changes first, then others
  const sortedContextSessions = [
    ...sessionsWithContext.filter((s) => changedIds.has(s.session.id)),
    ...sessionsWithContext.filter((s) => !changedIds.has(s.session.id)),
  ];
  if (sortedContextSessions.length > 0) {
    parts.push("Project context for sessions:");
    let contextBudget = 50_000; // max bytes for all project context combined
    for (const snap of sortedContextSessions) {
      const ctx = snap.projectContext ?? "";
      const ctxBytes = Buffer.byteLength(ctx, "utf-8");
      if (ctxBytes > contextBudget) {
        // truncate this context to fit remaining budget
        if (contextBudget > 200) {
          parts.push(`--- ${snap.session.title} [${snap.session.id.slice(0, 8)}] project context (truncated) ---`);
          parts.push(sliceToByteLimit(ctx, contextBudget) + "\n[...truncated to fit prompt budget]");
          parts.push("");
        }
        break; // no budget left for remaining sessions
      }
      parts.push(`--- ${snap.session.title} [${snap.session.id.slice(0, 8)}] project context ---`);
      parts.push(ctx);
      parts.push("");
      contextBudget -= ctxBytes;
    }
  }

  // destructive action gate warning
  const policies = obs.policyContext?.policies;
  if (policies && !policies.allowDestructive) {
    parts.push("NOTE: Destructive actions (remove_agent, stop_session) are DISABLED by policy. Do not attempt them.");
    parts.push("");
  }

  // policy alerts: inject concrete idle/error/permission data so the reasoner has facts
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

  let assembled = parts.join("\n");

  // enforce total prompt budget to prevent blowing LLM context windows.
  // the prompt is laid out as: session table -> project context -> policy alerts -> changes -> operator message.
  // on truncation, we want to preserve the ends (operator message + changes = most important real-time data)
  // and trim from the middle (project context = stale, least important when budget is tight).
  const totalBytes = Buffer.byteLength(assembled, "utf-8");
  if (totalBytes > MAX_PROMPT_BYTES) {
    // find where project context starts and ends so we can trim it
    const ctxStart = assembled.indexOf("Project context for sessions:");
    const ctxEnd = assembled.indexOf("Policy alerts:");
    const changesMarker = ctxEnd >= 0 ? ctxEnd : assembled.indexOf("No new output from any session");
    const changesMarker2 = changesMarker >= 0 ? changesMarker : assembled.indexOf("Changes detected in");

    if (ctxStart >= 0 && changesMarker2 > ctxStart) {
      // trim project context section to fit budget
      const header = assembled.slice(0, ctxStart);
      const tail = assembled.slice(changesMarker2);
      const headerBytes = Buffer.byteLength(header, "utf-8");
      const tailBytes = Buffer.byteLength(tail, "utf-8");
      const availableForCtx = MAX_PROMPT_BYTES - headerBytes - tailBytes - 100;
      if (availableForCtx > 200) {
        const ctxSection = assembled.slice(ctxStart, changesMarker2);
        assembled = header + sliceToByteLimit(ctxSection, availableForCtx) + "\n[...project context truncated]\n\n" + tail;
      } else {
        // no room for context at all — drop it entirely
        assembled = header + "[project context omitted — prompt budget exceeded]\n\n" + tail;
      }
    } else {
      // no project context section — truncate from end as fallback
      assembled = sliceToByteLimit(assembled, MAX_PROMPT_BYTES - 100) + "\n\n[...prompt truncated to fit context budget]";
    }
  }

  return assembled;
}
