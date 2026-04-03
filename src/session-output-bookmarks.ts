// session-output-bookmarks.ts — mark interesting output lines for later
// reference. operators can bookmark specific lines with labels, then
// recall them for review, debugging, or shift handoff notes.

export interface Bookmark {
  id: number;
  sessionTitle: string;
  lineText: string;
  label: string;
  createdAt: number;
}

export interface BookmarkState {
  bookmarks: Bookmark[];
  nextId: number;
  maxBookmarks: number;
}

/**
 * Create a fresh bookmark state.
 */
export function createBookmarkState(maxBookmarks = 200): BookmarkState {
  return { bookmarks: [], nextId: 1, maxBookmarks };
}

/**
 * Add a bookmark.
 */
export function addBookmark(
  state: BookmarkState,
  sessionTitle: string,
  lineText: string,
  label: string,
  now = Date.now(),
): Bookmark {
  const bm: Bookmark = {
    id: state.nextId++,
    sessionTitle,
    lineText: lineText.slice(0, 300),
    label: label.slice(0, 50),
    createdAt: now,
  };
  state.bookmarks.push(bm);
  if (state.bookmarks.length > state.maxBookmarks) {
    state.bookmarks = state.bookmarks.slice(-state.maxBookmarks);
  }
  return bm;
}

/**
 * Remove a bookmark by ID.
 */
export function removeBookmark(state: BookmarkState, id: number): boolean {
  const idx = state.bookmarks.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  state.bookmarks.splice(idx, 1);
  return true;
}

/**
 * Get bookmarks, optionally filtered by session.
 */
export function getBookmarks(state: BookmarkState, sessionTitle?: string): Bookmark[] {
  if (!sessionTitle) return [...state.bookmarks];
  return state.bookmarks.filter((b) => b.sessionTitle.toLowerCase() === sessionTitle.toLowerCase());
}

/**
 * Search bookmarks by label or line text.
 */
export function searchBookmarks(state: BookmarkState, query: string): Bookmark[] {
  const q = query.toLowerCase();
  return state.bookmarks.filter(
    (b) => b.label.toLowerCase().includes(q) || b.lineText.toLowerCase().includes(q),
  );
}

/**
 * Get bookmark count per session.
 */
export function bookmarkCountBySession(state: BookmarkState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of state.bookmarks) counts.set(b.sessionTitle, (counts.get(b.sessionTitle) ?? 0) + 1);
  return counts;
}

/**
 * Format bookmarks for TUI display.
 */
export function formatBookmarks(bookmarks: Bookmark[]): string[] {
  if (bookmarks.length === 0) return ["  Bookmarks: none saved"];
  const lines: string[] = [];
  lines.push(`  Bookmarks (${bookmarks.length}):`);
  for (const b of bookmarks.slice(-20)) {
    const time = new Date(b.createdAt).toISOString().slice(11, 19);
    const text = b.lineText.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "").slice(0, 60);
    lines.push(`    #${b.id} [${b.sessionTitle}] "${b.label}" @ ${time}`);
    lines.push(`      ${text}`);
  }
  return lines;
}
