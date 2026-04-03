// goal-gamification.ts — XP/levels for sessions based on completions,
// efficiency, and streaks. provides a motivational leaderboard with
// badges and level progression.

export interface SessionXP {
  sessionTitle: string;
  xp: number;
  level: number;
  completions: number;
  streak: number;       // consecutive completions without failure
  badges: string[];
}

export interface XPState {
  sessions: Map<string, SessionXP>;
}

const XP_PER_LEVEL = 100;

const XP_REWARDS = {
  completion: 25,
  fastCompletion: 15,    // under 1 hour
  cheapCompletion: 10,   // under $2
  zeroErrors: 10,
  streakBonus: 5,        // per streak level
};

const BADGES: Array<{ name: string; condition: (xp: SessionXP) => boolean }> = [
  { name: "🌟 First Blood", condition: (x) => x.completions >= 1 },
  { name: "⚡ Speed Demon", condition: (x) => x.badges.includes("fast") },
  { name: "💎 Perfectionist", condition: (x) => x.badges.includes("zero-errors") },
  { name: "🔥 On Fire", condition: (x) => x.streak >= 3 },
  { name: "🏆 Veteran", condition: (x) => x.completions >= 10 },
  { name: "👑 Legend", condition: (x) => x.level >= 10 },
];

/**
 * Create XP state.
 */
export function createXPState(): XPState {
  return { sessions: new Map() };
}

/**
 * Get or create session XP.
 */
function getSession(state: XPState, title: string): SessionXP {
  if (!state.sessions.has(title)) {
    state.sessions.set(title, { sessionTitle: title, xp: 0, level: 1, completions: 0, streak: 0, badges: [] });
  }
  return state.sessions.get(title)!;
}

/**
 * Award XP for a goal completion.
 */
export function awardCompletion(state: XPState, sessionTitle: string, opts?: { fast?: boolean; cheap?: boolean; zeroErrors?: boolean }): SessionXP {
  const s = getSession(state, sessionTitle);
  let earned = XP_REWARDS.completion;

  if (opts?.fast) { earned += XP_REWARDS.fastCompletion; if (!s.badges.includes("fast")) s.badges.push("fast"); }
  if (opts?.cheap) { earned += XP_REWARDS.cheapCompletion; }
  if (opts?.zeroErrors) { earned += XP_REWARDS.zeroErrors; if (!s.badges.includes("zero-errors")) s.badges.push("zero-errors"); }

  s.streak++;
  earned += s.streak * XP_REWARDS.streakBonus;

  s.xp += earned;
  s.completions++;
  s.level = Math.floor(s.xp / XP_PER_LEVEL) + 1;

  // check badge conditions
  for (const b of BADGES) {
    if (b.condition(s) && !s.badges.includes(b.name)) s.badges.push(b.name);
  }

  return s;
}

/**
 * Record a failure (breaks streak).
 */
export function recordFailure(state: XPState, sessionTitle: string): void {
  const s = getSession(state, sessionTitle);
  s.streak = 0;
}

/**
 * Get leaderboard sorted by XP.
 */
export function getLeaderboard(state: XPState): SessionXP[] {
  return Array.from(state.sessions.values()).sort((a, b) => b.xp - a.xp);
}

/**
 * Format gamification leaderboard for TUI display.
 */
export function formatGamification(state: XPState): string[] {
  const board = getLeaderboard(state);
  if (board.length === 0) return ["  Gamification: no sessions have earned XP yet"];
  const lines: string[] = [];
  lines.push(`  Goal Gamification (${board.length} sessions):`);
  for (const s of board.slice(0, 10)) {
    const bar = "█".repeat(Math.min(10, Math.floor(s.xp % XP_PER_LEVEL / 10))) + "░".repeat(10 - Math.min(10, Math.floor(s.xp % XP_PER_LEVEL / 10)));
    const badgeStr = s.badges.filter((b) => b.startsWith("�") || b.startsWith("⚡") || b.startsWith("💎") || b.startsWith("🔥") || b.startsWith("🏆") || b.startsWith("👑")).join("");
    lines.push(`    Lv${s.level} ${s.sessionTitle.padEnd(14)} ${s.xp.toString().padStart(5)}XP [${bar}] ${s.completions} done, ${s.streak} streak ${badgeStr}`);
  }
  return lines;
}
