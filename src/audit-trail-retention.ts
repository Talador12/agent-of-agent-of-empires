// audit-trail-retention.ts — configurable TTL with archival for audit trail entries.
// manages retention policies that auto-expire old entries, optionally archiving
// them before deletion. supports per-type TTLs and global defaults.
// zero dependencies.

/** retention policy for a category of audit entries */
export interface RetentionPolicy {
  category: string;          // audit event type or "*" for default
  ttlMs: number;             // time-to-live in ms
  archiveBeforeDelete: boolean;
}

/** audit entry (simplified — matches the shape from audit-trail.ts) */
export interface AuditEntry {
  type: string;
  timestamp: number;
  session?: string;
  detail: string;
}

/** archived batch */
export interface ArchiveBatch {
  id: string;
  archivedAt: number;
  entryCount: number;
  oldestEntry: number;
  newestEntry: number;
  categories: string[];
}

/** retention state */
export interface RetentionState {
  policies: RetentionPolicy[];
  defaultTtlMs: number;
  archives: ArchiveBatch[];
  totalExpired: number;
  totalArchived: number;
  lastRunAt: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** create retention state with default policy */
export function createRetentionState(defaultTtlMs = DEFAULT_TTL_MS): RetentionState {
  return {
    policies: [],
    defaultTtlMs,
    archives: [],
    totalExpired: 0,
    totalArchived: 0,
    lastRunAt: 0,
  };
}

/** add a retention policy for a specific category */
export function addPolicy(
  state: RetentionState,
  category: string,
  ttlMs: number,
  archiveBeforeDelete = true,
): void {
  // replace existing policy for same category
  const idx = state.policies.findIndex((p) => p.category === category);
  const policy: RetentionPolicy = { category, ttlMs, archiveBeforeDelete };
  if (idx >= 0) state.policies[idx] = policy;
  else state.policies.push(policy);
}

/** get the effective TTL for a category */
export function getEffectiveTtl(state: RetentionState, category: string): number {
  const policy = state.policies.find((p) => p.category === category);
  if (policy) return policy.ttlMs;
  const wildcard = state.policies.find((p) => p.category === "*");
  if (wildcard) return wildcard.ttlMs;
  return state.defaultTtlMs;
}

/** check if a category should archive before delete */
export function shouldArchive(state: RetentionState, category: string): boolean {
  const policy = state.policies.find((p) => p.category === category);
  if (policy) return policy.archiveBeforeDelete;
  const wildcard = state.policies.find((p) => p.category === "*");
  if (wildcard) return wildcard.archiveBeforeDelete;
  return true; // default: archive
}

/** evaluate which entries have expired */
export function findExpired(
  state: RetentionState,
  entries: AuditEntry[],
  now = Date.now(),
): { expired: AuditEntry[]; retained: AuditEntry[] } {
  const expired: AuditEntry[] = [];
  const retained: AuditEntry[] = [];

  for (const entry of entries) {
    const ttl = getEffectiveTtl(state, entry.type);
    const age = now - entry.timestamp;
    if (age > ttl) expired.push(entry);
    else retained.push(entry);
  }

  return { expired, retained };
}

/** run retention: expire old entries, archive if configured */
export function runRetention(
  state: RetentionState,
  entries: AuditEntry[],
  now = Date.now(),
): { retained: AuditEntry[]; archived: AuditEntry[]; deleted: AuditEntry[] } {
  const { expired, retained } = findExpired(state, entries, now);

  const archived: AuditEntry[] = [];
  const deleted: AuditEntry[] = [];

  // group expired by archive policy
  const toArchive: AuditEntry[] = [];
  for (const entry of expired) {
    if (shouldArchive(state, entry.type)) {
      toArchive.push(entry);
      archived.push(entry);
    } else {
      deleted.push(entry);
    }
  }

  // create archive batch if any
  if (toArchive.length > 0) {
    const categories = [...new Set(toArchive.map((e) => e.type))];
    const batch: ArchiveBatch = {
      id: `archive-${now}`,
      archivedAt: now,
      entryCount: toArchive.length,
      oldestEntry: Math.min(...toArchive.map((e) => e.timestamp)),
      newestEntry: Math.max(...toArchive.map((e) => e.timestamp)),
      categories,
    };
    state.archives.push(batch);
    state.totalArchived += toArchive.length;
  }

  state.totalExpired += expired.length;
  state.lastRunAt = now;

  // cap archive history
  if (state.archives.length > 100) {
    state.archives = state.archives.slice(-50);
  }

  return { retained, archived, deleted };
}

/** compute retention statistics */
export function retentionStats(
  state: RetentionState,
  entries: AuditEntry[],
  now = Date.now(),
): {
  totalEntries: number;
  expiredCount: number;
  retainedCount: number;
  oldestEntry: number;
  policyCount: number;
  archiveBatchCount: number;
} {
  const { expired, retained } = findExpired(state, entries, now);
  const oldest = entries.length > 0 ? Math.min(...entries.map((e) => e.timestamp)) : 0;
  return {
    totalEntries: entries.length,
    expiredCount: expired.length,
    retainedCount: retained.length,
    oldestEntry: oldest,
    policyCount: state.policies.length,
    archiveBatchCount: state.archives.length,
  };
}

/** format retention state for TUI display */
export function formatRetention(state: RetentionState, entries: AuditEntry[]): string[] {
  const lines: string[] = [];
  const stats = retentionStats(state, entries);
  const defaultDays = Math.round(state.defaultTtlMs / 86_400_000);

  lines.push(`audit retention: ${stats.totalEntries} entries, ${stats.expiredCount} expired, default TTL ${defaultDays}d`);
  lines.push(`  total expired: ${state.totalExpired} | total archived: ${state.totalArchived}`);
  lines.push(`  archive batches: ${state.archives.length}`);

  if (state.policies.length > 0) {
    lines.push("  policies:");
    for (const p of state.policies) {
      const days = Math.round(p.ttlMs / 86_400_000);
      const archive = p.archiveBeforeDelete ? "archive" : "delete";
      lines.push(`    ${p.category}: ${days}d (${archive})`);
    }
  }

  if (state.archives.length > 0) {
    const recent = state.archives.slice(-3);
    lines.push("  recent archives:");
    for (const a of recent) {
      lines.push(`    ${a.id}: ${a.entryCount} entries (${a.categories.join(", ")})`);
    }
  }

  return lines;
}
