// session-sentiment.ts — classify session output tone using keyword patterns.
// detects progress, frustration, blocked, success, and error sentiments
// without LLM calls. useful for shift handoffs and priority triage.

export type Sentiment = "progress" | "success" | "blocked" | "frustration" | "error" | "idle" | "neutral";

export interface SentimentResult {
  sessionTitle: string;
  sentiment: Sentiment;
  confidence: number; // 0-100
  signals: { sentiment: Sentiment; pattern: string }[];
}

const PATTERNS: Array<{ sentiment: Sentiment; pattern: RegExp; label: string }> = [
  { sentiment: "success", pattern: /(?:all|every|\d+) (?:tests?|specs?) pass/i, label: "tests passing" },
  { sentiment: "success", pattern: /build (?:succeeded|successful|complete)/i, label: "build success" },
  { sentiment: "success", pattern: /(?:pushed|merged|deployed)/i, label: "shipped" },
  { sentiment: "success", pattern: /✓|✅|PASS\b|done|complete/i, label: "done indicator" },
  { sentiment: "progress", pattern: /(?:working on|implementing|adding|creating|refactoring)/i, label: "active work" },
  { sentiment: "progress", pattern: /(?:step \d|phase \d|progress|moving forward)/i, label: "forward motion" },
  { sentiment: "progress", pattern: /(?:commit|committed|staged)/i, label: "git activity" },
  { sentiment: "blocked", pattern: /(?:waiting for|blocked by|depends on|need.*before)/i, label: "dependency wait" },
  { sentiment: "blocked", pattern: /(?:permission denied|access denied|unauthorized)/i, label: "access blocked" },
  { sentiment: "blocked", pattern: /(?:rate limit|quota exceeded|throttled)/i, label: "rate limited" },
  { sentiment: "frustration", pattern: /(?:still (?:not|failing)|keeps? (?:failing|breaking))/i, label: "persistent failure" },
  { sentiment: "frustration", pattern: /(?:tried (?:again|everything)|cannot figure|stuck)/i, label: "struggle" },
  { sentiment: "frustration", pattern: /(?:ugh|argh|damn|why (?:is|does|won't))/i, label: "frustration expression" },
  { sentiment: "error", pattern: /(?:FAIL|ERROR|FATAL|panic|crash|exception)/i, label: "error indicator" },
  { sentiment: "error", pattern: /(?:segfault|SIGSEGV|OOM|out of memory)/i, label: "crash" },
  { sentiment: "error", pattern: /(?:compilation? (?:error|failed)|type ?error)/i, label: "build error" },
  { sentiment: "idle", pattern: /(?:\$ ?$|> ?$|waiting for input)/i, label: "idle prompt" },
];

/**
 * Analyze sentiment of recent session output.
 */
export function analyzeSentiment(sessionTitle: string, output: string): SentimentResult {
  const lines = output.split("\n").slice(-30); // last 30 lines
  const text = lines.join("\n");
  const signals: SentimentResult["signals"] = [];

  for (const p of PATTERNS) {
    p.pattern.lastIndex = 0;
    if (p.pattern.test(text)) {
      signals.push({ sentiment: p.sentiment, pattern: p.label });
    }
  }

  if (signals.length === 0) {
    return { sessionTitle, sentiment: "neutral", confidence: 30, signals };
  }

  // count by sentiment
  const counts = new Map<Sentiment, number>();
  for (const s of signals) counts.set(s.sentiment, (counts.get(s.sentiment) ?? 0) + 1);

  // pick dominant sentiment (priority: error > blocked > frustration > success > progress > idle)
  const priority: Sentiment[] = ["error", "blocked", "frustration", "success", "progress", "idle"];
  let dominant: Sentiment = "neutral";
  for (const s of priority) {
    if ((counts.get(s) ?? 0) > 0) { dominant = s; break; }
  }

  const dominantCount = counts.get(dominant) ?? 0;
  const confidence = Math.min(95, 40 + dominantCount * 15);

  return { sessionTitle, sentiment: dominant, confidence, signals };
}

/**
 * Analyze sentiment for multiple sessions.
 */
export function analyzeFleetSentiment(sessions: Array<{ title: string; output: string }>): SentimentResult[] {
  return sessions.map((s) => analyzeSentiment(s.title, s.output));
}

/**
 * Format sentiment results for TUI display.
 */
export function formatSentiment(results: SentimentResult[]): string[] {
  if (results.length === 0) return ["  Sentiment: no sessions to analyze"];
  const lines: string[] = [];
  lines.push(`  Session Sentiment (${results.length} sessions):`);
  const icons: Record<Sentiment, string> = { success: "🟢", progress: "🔵", blocked: "🟠", frustration: "😤", error: "🔴", idle: "⏸", neutral: "⚪" };
  for (const r of results) {
    const icon = icons[r.sentiment] ?? "⚪";
    const signalSummary = r.signals.slice(0, 3).map((s) => s.pattern).join(", ");
    lines.push(`    ${icon} ${r.sessionTitle}: ${r.sentiment} (${r.confidence}%) ${signalSummary}`);
  }
  return lines;
}
