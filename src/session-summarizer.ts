// session-summarizer.ts — distill session activity into plain English summaries.
// runs on the diff (new lines since last poll) and produces a short human-readable
// summary of what the session is doing, without needing an LLM call.

export interface SessionSummary {
  sessionTitle: string;
  summary: string;
  activity: ActivityType;
  timestamp: number;
}

export type ActivityType =
  | "coding"
  | "testing"
  | "building"
  | "committing"
  | "debugging"
  | "installing"
  | "idle"
  | "error"
  | "reviewing"
  | "waiting"
  | "unknown";

interface PatternMatch {
  activity: ActivityType;
  summary: string;
  priority: number; // higher = more specific, wins on tie
}

// ordered patterns — first match wins within a priority group
const ACTIVITY_PATTERNS: Array<{
  pattern: RegExp;
  activity: ActivityType;
  summary: string | ((match: RegExpMatchArray) => string);
  priority: number;
}> = [
  // ── errors first (high priority) ────────────────────────────────────
  { pattern: /error(?:\[|\s*:)\s*(.{1,60})/i, activity: "error", summary: (m) => `error: ${m[1].trim()}`, priority: 90 },
  { pattern: /ERR[!]?\s+(.{1,60})/, activity: "error", summary: (m) => `error: ${m[1].trim()}`, priority: 90 },
  { pattern: /(?:FAIL|FAILED)\s+(.{1,60})/i, activity: "error", summary: (m) => `test failure: ${m[1].trim()}`, priority: 85 },
  { pattern: /panic|segfault|SIGSEGV|core dumped/i, activity: "error", summary: "crash detected", priority: 95 },

  // ── committing / pushing ────────────────────────────────────────────
  { pattern: /^\[(\S+)\s+([a-f0-9]{7,})\]\s+(.{1,60})$/m, activity: "committing", summary: (m) => `committed: ${m[3].trim()}`, priority: 80 },
  { pattern: /[a-f0-9]+\.\.[a-f0-9]+\s+\S+\s*->\s*(\S+)/, activity: "committing", summary: (m) => `pushed to ${m[1]}`, priority: 80 },
  { pattern: /git\s+(?:add|commit|push)/i, activity: "committing", summary: "git operation", priority: 50 },

  // ── testing ─────────────────────────────────────────────────────────
  { pattern: /ℹ\s+tests\s+(\d+)/, activity: "testing", summary: (m) => `ran ${m[1]} tests`, priority: 70 },
  { pattern: /Tests:\s*(\d+)\s+passed,?\s*(\d+)\s+total/i, activity: "testing", summary: (m) => `${m[1]}/${m[2]} tests passed`, priority: 70 },
  { pattern: /(\d+)\s+(?:tests?\s+)?pass(?:ed|ing)/i, activity: "testing", summary: (m) => `${m[1]} tests passing`, priority: 60 },
  { pattern: /(?:npm|yarn|pnpm)\s+test|pytest|go\s+test|cargo\s+test/i, activity: "testing", summary: "running tests", priority: 55 },

  // ── building ────────────────────────────────────────────────────────
  { pattern: /build\s+(?:completed|succeeded|done)/i, activity: "building", summary: "build completed", priority: 65 },
  { pattern: /✓\s+built\s+in\s+(.+)/i, activity: "building", summary: (m) => `built in ${m[1].trim()}`, priority: 65 },
  { pattern: /(?:npm|yarn|pnpm)\s+run\s+build|tsc|webpack|vite\s+build|cargo\s+build/i, activity: "building", summary: "building", priority: 50 },
  { pattern: /compiling/i, activity: "building", summary: "compiling", priority: 45 },

  // ── installing deps ─────────────────────────────────────────────────
  { pattern: /(?:npm|yarn|pnpm)\s+install|pip\s+install|cargo\s+add|go\s+get/i, activity: "installing", summary: "installing dependencies", priority: 50 },
  { pattern: /added\s+(\d+)\s+packages?/i, activity: "installing", summary: (m) => `installed ${m[1]} packages`, priority: 55 },

  // ── debugging ───────────────────────────────────────────────────────
  { pattern: /(?:debug|debugger|breakpoint|stacktrace|traceback)/i, activity: "debugging", summary: "debugging", priority: 45 },
  { pattern: /fix(?:ed|ing)?\s+(.{1,40})/i, activity: "debugging", summary: (m) => `fixing: ${m[1].trim()}`, priority: 40 },

  // ── code review ─────────────────────────────────────────────────────
  { pattern: /(?:reviewing|review|PR|MR|merge\s+request|pull\s+request)/i, activity: "reviewing", summary: "reviewing code", priority: 40 },

  // ── coding (generic — lowest priority) ──────────────────────────────
  { pattern: /Edit\s+(\S+\.[a-zA-Z0-9]+)/, activity: "coding", summary: (m) => `editing ${m[1]}`, priority: 30 },
  { pattern: /Write\s+(\S+\.[a-zA-Z0-9]+)/, activity: "coding", summary: (m) => `writing ${m[1]}`, priority: 30 },
  { pattern: /Read\s+(\S+\.[a-zA-Z0-9]+)/, activity: "coding", summary: (m) => `reading ${m[1]}`, priority: 20 },

  // ── waiting ─────────────────────────────────────────────────────────
  { pattern: /Permission required/i, activity: "waiting", summary: "waiting for permission", priority: 75 },
  { pattern: /(?:Allow once|Allow always|Reject)/i, activity: "waiting", summary: "permission prompt", priority: 75 },
  { pattern: /waiting\s+for/i, activity: "waiting", summary: "waiting", priority: 35 },
];

/**
 * Analyze session output and produce a plain-English summary.
 * Processes the diff lines (new output since last poll) not the full buffer.
 */
export function summarizeSession(
  sessionTitle: string,
  newLines: readonly string[],
  now = Date.now(),
): SessionSummary {
  const clean = newLines
    .map((l) => l.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").trim())
    .filter(Boolean);

  if (clean.length === 0) {
    return { sessionTitle, summary: "idle", activity: "idle", timestamp: now };
  }

  // scan for all matching patterns, keep the highest-priority match
  let best: PatternMatch | null = null;

  for (const line of clean) {
    for (const { pattern, activity, summary, priority } of ACTIVITY_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const resolved = typeof summary === "function" ? summary(match) : summary;
        if (!best || priority > best.priority) {
          best = { activity, summary: resolved, priority };
        }
      }
    }
  }

  if (best) {
    return { sessionTitle, summary: best.summary, activity: best.activity, timestamp: now };
  }

  // fallback: use last meaningful line
  const lastLine = clean[clean.length - 1];
  const truncated = lastLine.length > 60 ? lastLine.slice(0, 57) + "..." : lastLine;
  return { sessionTitle, summary: truncated, activity: "unknown", timestamp: now };
}

/**
 * Maintain a rolling summary per session. Replaces old summaries when new
 * activity is detected, keeps the last summary if output is unchanged.
 */
export class SessionSummarizer {
  private summaries = new Map<string, SessionSummary>();

  /** Update summary for a session from its new output lines. */
  update(sessionTitle: string, newLines: readonly string[], now = Date.now()): SessionSummary {
    const summary = summarizeSession(sessionTitle, newLines, now);
    // only replace if we got a meaningful update (not idle from empty diff)
    if (summary.activity !== "idle" || !this.summaries.has(sessionTitle)) {
      this.summaries.set(sessionTitle, summary);
    }
    return this.summaries.get(sessionTitle)!;
  }

  /** Get the current summary for a session. */
  get(sessionTitle: string): SessionSummary | undefined {
    return this.summaries.get(sessionTitle);
  }

  /** Get all current summaries. */
  getAll(): Map<string, SessionSummary> {
    return new Map(this.summaries);
  }

  /** Format a single summary for display. */
  static format(summary: SessionSummary): string {
    const icon = ACTIVITY_ICONS[summary.activity] ?? "?";
    return `${icon} ${summary.summary}`;
  }
}

const ACTIVITY_ICONS: Record<ActivityType, string> = {
  coding: "⌨",
  testing: "🧪",
  building: "🔨",
  committing: "📦",
  debugging: "🔍",
  installing: "📥",
  idle: "💤",
  error: "❌",
  reviewing: "👀",
  waiting: "⏳",
  unknown: "·",
};
