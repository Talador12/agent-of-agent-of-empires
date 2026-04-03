// fleet-warm-standby.ts — pre-warm session slots with context for fast
// task activation. maintains a pool of "warm" slots that have already
// loaded context files and are ready to accept a goal immediately.

export type SlotStatus = "warming" | "warm" | "assigned" | "expired";

export interface WarmSlot {
  id: number;
  repo: string;
  contextLoaded: boolean;
  contextFiles: string[];
  status: SlotStatus;
  warmedAt: number;
  assignedTo?: string; // session title once claimed
  expiresAt: number;
}

export interface WarmStandbyState {
  slots: WarmSlot[];
  nextId: number;
  maxSlots: number;
  ttlMs: number; // how long a warm slot stays valid
}

/**
 * Create warm standby state.
 */
export function createWarmStandby(maxSlots = 5, ttlMs = 600_000): WarmStandbyState {
  return { slots: [], nextId: 1, maxSlots, ttlMs };
}

/**
 * Pre-warm a slot for a given repo. Returns the slot ID.
 */
export function warmSlot(
  state: WarmStandbyState,
  repo: string,
  contextFiles: string[],
  now = Date.now(),
): WarmSlot | null {
  // evict expired slots first
  expireSlots(state, now);

  const warmCount = state.slots.filter((s) => s.status === "warm" || s.status === "warming").length;
  if (warmCount >= state.maxSlots) return null; // pool full

  const slot: WarmSlot = {
    id: state.nextId++,
    repo,
    contextLoaded: contextFiles.length > 0,
    contextFiles: [...contextFiles],
    status: "warm",
    warmedAt: now,
    expiresAt: now + state.ttlMs,
  };
  state.slots.push(slot);
  return slot;
}

/**
 * Claim a warm slot for a session. Returns the assigned slot or null.
 */
export function claimSlot(
  state: WarmStandbyState,
  repo: string,
  sessionTitle: string,
  now = Date.now(),
): WarmSlot | null {
  expireSlots(state, now);

  // find a warm slot matching this repo
  const match = state.slots.find(
    (s) => s.status === "warm" && s.repo === repo && s.expiresAt > now,
  );
  if (!match) return null;

  match.status = "assigned";
  match.assignedTo = sessionTitle;
  return match;
}

/**
 * Expire old warm slots.
 */
export function expireSlots(state: WarmStandbyState, now = Date.now()): number {
  let expired = 0;
  for (const s of state.slots) {
    if ((s.status === "warm" || s.status === "warming") && now > s.expiresAt) {
      s.status = "expired";
      expired++;
    }
  }
  return expired;
}

/**
 * Get available warm slots (not assigned or expired).
 */
export function availableSlots(state: WarmStandbyState, now = Date.now()): WarmSlot[] {
  return state.slots.filter((s) => s.status === "warm" && s.expiresAt > now);
}

/**
 * Get warm standby stats.
 */
export function warmStandbyStats(state: WarmStandbyState, now = Date.now()): {
  total: number; warm: number; assigned: number; expired: number; repos: string[];
} {
  expireSlots(state, now);
  return {
    total: state.slots.length,
    warm: state.slots.filter((s) => s.status === "warm").length,
    assigned: state.slots.filter((s) => s.status === "assigned").length,
    expired: state.slots.filter((s) => s.status === "expired").length,
    repos: [...new Set(state.slots.filter((s) => s.status === "warm").map((s) => s.repo))],
  };
}

/**
 * Format warm standby state for TUI display.
 */
export function formatWarmStandby(state: WarmStandbyState): string[] {
  const stats = warmStandbyStats(state);
  const lines: string[] = [];
  lines.push(`  Fleet Warm Standby (${stats.warm} warm / ${stats.assigned} assigned / ${stats.total} total, max ${state.maxSlots}):`);
  if (stats.warm === 0) {
    lines.push("    No warm slots available");
  } else {
    for (const slot of availableSlots(state)) {
      const ttl = Math.round((slot.expiresAt - Date.now()) / 60_000);
      const files = slot.contextFiles.length;
      lines.push(`    #${slot.id} ${slot.repo} (${files} context files, ${ttl}m TTL remaining)`);
    }
  }
  if (stats.repos.length > 0) {
    lines.push(`  Repos: ${stats.repos.join(", ")}`);
  }
  return lines;
}
