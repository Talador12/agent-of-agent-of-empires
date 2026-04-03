// session-tag-manager.ts — manage tags on sessions for filtering, grouping, and routing.
// persists tags alongside session state for use by cost-tags, priority, and templates.

export interface SessionTagStore {
  tags: Map<string, Map<string, string>>; // sessionTitle → { key → value }
}

/**
 * Create an empty tag store.
 */
export function createTagStore(): SessionTagStore {
  return { tags: new Map() };
}

/**
 * Set a tag on a session.
 */
export function setTag(store: SessionTagStore, sessionTitle: string, key: string, value: string): void {
  if (!store.tags.has(sessionTitle)) store.tags.set(sessionTitle, new Map());
  store.tags.get(sessionTitle)!.set(key, value);
}

/**
 * Get a tag value from a session.
 */
export function getTag(store: SessionTagStore, sessionTitle: string, key: string): string | undefined {
  return store.tags.get(sessionTitle)?.get(key);
}

/**
 * Get all tags for a session.
 */
export function getTags(store: SessionTagStore, sessionTitle: string): Map<string, string> {
  return store.tags.get(sessionTitle) ?? new Map();
}

/**
 * Remove a tag from a session.
 */
export function removeTag(store: SessionTagStore, sessionTitle: string, key: string): boolean {
  return store.tags.get(sessionTitle)?.delete(key) ?? false;
}

/**
 * List all sessions with a specific tag key.
 */
export function findByTag(store: SessionTagStore, key: string, value?: string): string[] {
  const results: string[] = [];
  for (const [title, tags] of store.tags) {
    const v = tags.get(key);
    if (v !== undefined && (value === undefined || v === value)) results.push(title);
  }
  return results;
}

/**
 * Format tag store for TUI display.
 */
export function formatTagStore(store: SessionTagStore): string[] {
  if (store.tags.size === 0) return ["  (no session tags set)"];
  const lines: string[] = [];
  for (const [title, tags] of store.tags) {
    const tagStr = [...tags.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
    lines.push(`  ${title}: ${tagStr}`);
  }
  return lines;
}
