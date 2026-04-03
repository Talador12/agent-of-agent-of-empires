// session-pattern-evolution.ts — detect when output patterns change over
// time. tracks pattern frequency per window and alerts when patterns
// appear, disappear, or shift significantly between windows.

export interface PatternWindow {
  windowStart: number;
  patternCounts: Map<string, number>;
}

export interface PatternShift {
  pattern: string;
  type: "appeared" | "disappeared" | "increased" | "decreased";
  oldCount: number;
  newCount: number;
  changePct: number;
}

export interface EvolutionState {
  windows: PatternWindow[];
  maxWindows: number;
  patterns: RegExp[];
  patternNames: string[];
}

const DEFAULT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "test-pass", pattern: /(?:pass|passed|✓|✔)/i },
  { name: "test-fail", pattern: /(?:fail|failed|✗|✘)/i },
  { name: "error", pattern: /(?:error|ERROR|exception)/i },
  { name: "warning", pattern: /(?:warn|WARNING)/i },
  { name: "build", pattern: /(?:build|compile|tsc)/i },
  { name: "git", pattern: /(?:commit|push|merge|rebase)/i },
  { name: "install", pattern: /(?:install|npm|yarn|pnpm)/i },
  { name: "deploy", pattern: /(?:deploy|release|publish)/i },
];

/**
 * Create evolution tracking state.
 */
export function createEvolutionState(maxWindows = 20): EvolutionState {
  return {
    windows: [],
    maxWindows,
    patterns: DEFAULT_PATTERNS.map((p) => p.pattern),
    patternNames: DEFAULT_PATTERNS.map((p) => p.name),
  };
}

/**
 * Record a window of output lines and count pattern occurrences.
 */
export function recordWindow(state: EvolutionState, lines: string[], now = Date.now()): PatternWindow {
  const counts = new Map<string, number>();
  for (let i = 0; i < state.patterns.length; i++) {
    const name = state.patternNames[i];
    let count = 0;
    for (const line of lines) {
      state.patterns[i].lastIndex = 0;
      if (state.patterns[i].test(line)) count++;
    }
    if (count > 0) counts.set(name, count);
  }

  const window: PatternWindow = { windowStart: now, patternCounts: counts };
  state.windows.push(window);
  if (state.windows.length > state.maxWindows) {
    state.windows = state.windows.slice(-state.maxWindows);
  }
  return window;
}

/**
 * Detect pattern shifts between the two most recent windows.
 */
export function detectShifts(state: EvolutionState, threshold = 50): PatternShift[] {
  if (state.windows.length < 2) return [];
  const prev = state.windows[state.windows.length - 2];
  const curr = state.windows[state.windows.length - 1];
  const shifts: PatternShift[] = [];
  const allPatterns = new Set([...prev.patternCounts.keys(), ...curr.patternCounts.keys()]);

  for (const pattern of allPatterns) {
    const oldCount = prev.patternCounts.get(pattern) ?? 0;
    const newCount = curr.patternCounts.get(pattern) ?? 0;

    if (oldCount === 0 && newCount > 0) {
      shifts.push({ pattern, type: "appeared", oldCount, newCount, changePct: 100 });
    } else if (oldCount > 0 && newCount === 0) {
      shifts.push({ pattern, type: "disappeared", oldCount, newCount, changePct: -100 });
    } else if (oldCount > 0) {
      const changePct = Math.round(((newCount - oldCount) / oldCount) * 100);
      if (Math.abs(changePct) >= threshold) {
        shifts.push({ pattern, type: changePct > 0 ? "increased" : "decreased", oldCount, newCount, changePct });
      }
    }
  }

  return shifts.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

/**
 * Get pattern trend over all windows for a specific pattern.
 */
export function patternTrend(state: EvolutionState, patternName: string): number[] {
  return state.windows.map((w) => w.patternCounts.get(patternName) ?? 0);
}

/**
 * Format pattern evolution for TUI display.
 */
export function formatPatternEvolution(state: EvolutionState): string[] {
  const shifts = detectShifts(state);
  const lines: string[] = [];
  lines.push(`  Pattern Evolution (${state.windows.length} windows, ${state.patternNames.length} patterns):`);
  if (shifts.length === 0) {
    lines.push("    No significant pattern shifts detected");
  } else {
    for (const s of shifts.slice(0, 8)) {
      const icon = s.type === "appeared" ? "+" : s.type === "disappeared" ? "-" : s.changePct > 0 ? "↑" : "↓";
      lines.push(`    ${icon} ${s.pattern}: ${s.type} (${s.oldCount} → ${s.newCount}, ${s.changePct > 0 ? "+" : ""}${s.changePct}%)`);
    }
  }
  // sparklines for top patterns
  const topPatterns = state.patternNames.filter((n) => state.windows.some((w) => (w.patternCounts.get(n) ?? 0) > 0));
  for (const name of topPatterns.slice(0, 4)) {
    const trend = patternTrend(state, name);
    const sparkChars = "▁▂▃▄▅▆▇█";
    const max = Math.max(...trend, 1);
    const spark = trend.slice(-10).map((v) => sparkChars[Math.min(7, Math.round((v / max) * 7))]).join("");
    lines.push(`    ${name}: ${spark}`);
  }
  return lines;
}
