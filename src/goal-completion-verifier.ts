// goal-completion-verifier.ts — double-check completed goals by re-scanning
// recent session output for regression signals. prevents premature task
// completion when test failures or errors appear after the initial "done" signal.

export interface VerificationResult {
  sessionTitle: string;
  goal: string;
  passed: boolean;
  confidence: "high" | "medium" | "low";
  signals: VerificationSignal[];
  recommendation: "confirm-complete" | "revert-to-active" | "needs-review";
}

export interface VerificationSignal {
  type: "positive" | "negative" | "neutral";
  pattern: string;
  matchedText: string;
}

const POSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:all )?\d+ (?:tests?|specs?) pass/i, label: "tests passing" },
  { pattern: /build (?:succeeded|successful|complete)/i, label: "build success" },
  { pattern: /(?:push|pushed|merged) (?:to|into)/i, label: "git push" },
  { pattern: /✓|✅|PASS|passed/i, label: "pass indicator" },
  { pattern: /(?:no|0) (?:errors?|failures?)/i, label: "zero errors" },
  { pattern: /deploy(?:ed|ment)?\s+(?:complete|success|done)/i, label: "deploy success" },
  { pattern: /PR (?:created|opened|merged)/i, label: "PR activity" },
];

const NEGATIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:FAIL|FAILED|FAILURE|ERROR)\b/i, label: "failure indicator" },
  { pattern: /\d+ (?:tests?|specs?) fail/i, label: "test failures" },
  { pattern: /build (?:failed|error|broken)/i, label: "build failure" },
  { pattern: /(?:compile|compilation|type)\s*error/i, label: "compile error" },
  { pattern: /panic|segfault|SIGSEGV|OOM/i, label: "crash indicator" },
  { pattern: /permission denied|EACCES|EPERM/i, label: "permission error" },
  { pattern: /conflict|merge conflict/i, label: "merge conflict" },
  { pattern: /revert(?:ed|ing)?/i, label: "revert detected" },
];

/**
 * Verify a completed goal by scanning recent output for regression signals.
 */
export function verifyCompletion(sessionTitle: string, goal: string, recentOutput: string): VerificationResult {
  const signals: VerificationSignal[] = [];
  const lines = recentOutput.split("\n");
  const lastNLines = lines.slice(-50); // scan last 50 lines
  const text = lastNLines.join("\n");

  // scan for positive signals
  for (const p of POSITIVE_PATTERNS) {
    const match = text.match(p.pattern);
    if (match) {
      signals.push({ type: "positive", pattern: p.label, matchedText: match[0].slice(0, 40) });
    }
  }

  // scan for negative signals
  for (const p of NEGATIVE_PATTERNS) {
    const match = text.match(p.pattern);
    if (match) {
      signals.push({ type: "negative", pattern: p.label, matchedText: match[0].slice(0, 40) });
    }
  }

  const positives = signals.filter((s) => s.type === "positive").length;
  const negatives = signals.filter((s) => s.type === "negative").length;

  // decision logic
  let passed: boolean;
  let confidence: VerificationResult["confidence"];
  let recommendation: VerificationResult["recommendation"];

  if (negatives > 0) {
    passed = false;
    confidence = negatives >= 2 ? "high" : "medium";
    recommendation = negatives >= 2 ? "revert-to-active" : "needs-review";
  } else if (positives >= 2) {
    passed = true;
    confidence = "high";
    recommendation = "confirm-complete";
  } else if (positives === 1) {
    passed = true;
    confidence = "medium";
    recommendation = "confirm-complete";
  } else {
    passed = true;
    confidence = "low";
    recommendation = "needs-review";
  }

  return { sessionTitle, goal, passed, confidence, signals, recommendation };
}

/**
 * Format verification results for TUI display.
 */
export function formatVerification(results: VerificationResult[]): string[] {
  if (results.length === 0) return ["  Goal verification: no completed tasks to verify"];
  const lines: string[] = [];
  lines.push(`  Goal Verification (${results.length} tasks):`);
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    const conf = r.confidence === "high" ? "●" : r.confidence === "medium" ? "◐" : "○";
    lines.push(`  ${icon} ${conf} ${r.sessionTitle}: ${r.recommendation}`);
    if (r.signals.length > 0) {
      const pos = r.signals.filter((s) => s.type === "positive").length;
      const neg = r.signals.filter((s) => s.type === "negative").length;
      lines.push(`    ${pos} positive, ${neg} negative signals`);
    }
    for (const s of r.signals.filter((s) => s.type === "negative")) {
      lines.push(`    ⚠ ${s.pattern}: "${s.matchedText}"`);
    }
  }
  return lines;
}
