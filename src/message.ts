// message.ts — pure functions for user message processing in the daemon loop.
// extracted from index.ts so the logic is testable without running the daemon.
import { existsSync, statSync } from "node:fs";

/** Result of classifying raw drained messages into commands vs. user text */
export interface ClassifiedMessages {
  commands: string[];      // __CMD_* markers to dispatch in the main loop
  userMessages: string[];  // real operator messages for the reasoner
}

/**
 * Separate __CMD_* command markers from real user messages.
 * Preserves order within each bucket.
 */
export function classifyMessages(raw: string[]): ClassifiedMessages {
  const commands: string[] = [];
  const userMessages: string[] = [];
  for (const msg of raw) {
    if (msg.startsWith("__CMD_")) {
      commands.push(msg);
    } else {
      userMessages.push(msg);
    }
  }
  return { commands, userMessages };
}

/**
 * Format user messages for the reasoner prompt.
 * Single message: passed through as-is.
 * Multiple messages: numbered as "Operator message 1/N: ..." so the
 * reasoner can address each one individually.
 */
export function formatUserMessages(messages: string[]): string {
  if (messages.length === 0) return "";
  if (messages.length === 1) return messages[0];
  return messages
    .map((m, i) => `Operator message ${i + 1}/${messages.length}: ${m}`)
    .join("\n");
}

/**
 * Generate per-message receipt strings for the conversation log.
 * Each receipt shows the message content (truncated) so the user
 * can see exactly what the daemon received and in what order.
 */
export function buildReceipts(messages: string[]): string[] {
  if (messages.length === 0) return [];
  if (messages.length === 1) {
    const preview = truncate(messages[0], 120);
    return [`received: ${preview}`];
  }
  return messages.map((m, i) => {
    const preview = truncate(m, 100);
    return `received (${i + 1}/${messages.length}): ${preview}`;
  });
}

/**
 * Decide whether the daemon should skip sleep after a tick.
 * Returns true when there are already-queued messages that the
 * next tick should process immediately.
 */
export function shouldSkipSleep(state: {
  hasPendingStdin: boolean;
  hasPendingFile: boolean;
  interrupted: boolean;
}): boolean {
  return state.hasPendingStdin || state.hasPendingFile || state.interrupted;
}

/**
 * Check if a pending-input file exists and has content.
 * Lightweight stat-only check — does not read or drain the file.
 */
export function hasPendingFile(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const st = statSync(filePath);
    return st.size > 0;
  } catch {
    return false;
  }
}

/**
 * Insist prefix marker — messages prefixed with this bypass the normal queue
 * and trigger an immediate interrupt + delivery.
 */
export const INSIST_PREFIX = "__INSIST__";

/**
 * Check if a message is an insist (priority) message.
 */
export function isInsistMessage(msg: string): boolean {
  return msg.startsWith(INSIST_PREFIX);
}

/**
 * Strip the insist prefix from a message, returning the raw user text.
 */
export function stripInsistPrefix(msg: string): string {
  return msg.startsWith(INSIST_PREFIX) ? msg.slice(INSIST_PREFIX.length) : msg;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}
