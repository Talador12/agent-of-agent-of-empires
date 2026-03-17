# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.91.0

## Current Focus

1459 tests across 35 files. v0.91.0 shipped: session diff — `/diff N` shows activity since bookmark N, capped at last 30 entries with a hint to use `/clip` for full export. 3 new tests.

## Roadmap

### v0.92.0+ — Ideas Backlog
- **Multi-profile support** — manage multiple AoE profiles simultaneously
- **Web dashboard** — browser UI via `opencode web` (not wired yet)
- **Session grouping** — tag sessions by project/team, filter views by group
- **Smart session context budget** — dynamic context allocation based on session activity
- **Session health pulse** — tiny per-session sparklines in the compact view
- **Activity heatmap** — colored time-of-day heatmap in stats output
- **Sticky filters** — persist filter/search/sort settings across restarts
- **Filter presets** — `/filter errors` as alias for common multi-tag combos
- **Session memory** — show per-session context token usage in cards
- **Error rate sparkline** — per-session error frequency mini-chart in cards

### What shipped in v0.91.0

**Theme: "Session Diff"** — `/diff N` shows what happened since bookmark N. Slices the activity buffer from the bookmark's index, displays last 30 entries inline, hints `/clip` for full export when truncated. 3 new tests.

Modified: `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +3, net 1459 tests across 35 files.

### What shipped in v0.90.0

**Theme: "Clip"** — activity clipboard export. `/clip [N]` copies the last N activity entries (default 20) to the system clipboard via `pbcopy` (macOS), with file fallback to `~/.aoaoe/clip.txt`. `formatClipText()` pure function formats entries as `[HH:MM:SS] tag: text\n` — clean strings, no ANSI. `getActivityBuffer()` public accessor exposes the ring buffer for external consumers. 13 new tests.

#### 1. `formatClipText()` pure function (`src/tui.ts`)
- Takes `readonly ActivityEntry[]` and optional count `n` (default `CLIP_DEFAULT_COUNT = 20`)
- Returns plain text: `[HH:MM:SS] tag: text\n` per entry, last N entries from the array
- No ANSI codes — ActivityEntry fields are already clean strings

#### 2. `getActivityBuffer()` public accessor (`src/tui.ts`)
- Returns `readonly ActivityEntry[]` — the full activity buffer
- Same reference across calls (no copy)

#### 3. `/clip [N]` command (`src/input.ts`)
- `ClipHandler` type: `(count: number) => void`
- `onClip(handler)` callback registration
- `/clip [N]` command case — parses optional count, defaults to 20
- `/help` updated

#### 4. Wiring (`src/index.ts`)
- `input.onClip()` → gets buffer via `tui.getActivityBuffer()`, formats via `formatClipText()`
- Tries `pbcopy` (macOS) via `execSync`, falls back to `writeFileSync` at `~/.aoaoe/clip.txt`
- Logs result: "copied N entries to clipboard" or "saved N entries to ~/.aoaoe/clip.txt"

#### 5. Tests
- `src/tui.test.ts` (10 tests): CLIP_DEFAULT_COUNT is 20; formatClipText — empty array, single entry, multiple entries, default count (slices last 20 of 25), custom count, count exceeds buffer; getActivityBuffer — initial empty, entries after log, readonly reference
- `src/input.test.ts` (3 tests): onClip — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +13, net 1456 tests across 35 files.

### What shipped in v0.89.0

**Theme: "Auto-pin on Error"** — reactive session pinning. `/auto-pin` toggles automatic pinning of sessions that emit error-like activity. When enabled, any `log()` call with `! action` or `error` tags and a `sessionId` auto-pins that session to the top. Already-pinned sessions are skipped. `shouldAutoPin()` pure function for testability. 17 new tests.

#### 1. `shouldAutoPin()` pure function (`src/tui.ts`)
- Takes a tag string, returns true for `! action` and `error` (case-insensitive)
- Returns false for `system`, `+ action`, `reasoner`, etc.
- Exported for direct testing

#### 2. Auto-pin state on TUI class (`src/tui.ts`)
- `autoPinOnError: boolean` field (default: false)
- `setAutoPin(enabled)` — enable/disable
- `isAutoPinEnabled()` — current state

#### 3. Auto-pin logic in `log()` (`src/tui.ts`)
- Checks: autoPinOnError + sessionId + shouldAutoPin(tag) + not already pinned
- Adds to `pinnedIds` and repaints sessions
- Fires before mute tracking, so muted+error sessions still get pinned

#### 4. `/auto-pin` command (`src/input.ts`)
- `AutoPinHandler` type (no args)
- `onAutoPin(handler)` callback registration
- `/auto-pin` command case
- `/help` updated

#### 5. Wiring (`src/index.ts`)
- `input.onAutoPin()` → toggles `tui.isAutoPinEnabled()`, logs "auto-pin on error: on/off"

#### 6. Tests
- `src/tui.test.ts` (14 tests): shouldAutoPin — ! action, error, case-insensitive, rejects system/+ action/reasoner; TUI auto-pin state — default off, enable/disable, auto-pins on error log, no pin when disabled, no pin for non-error tags, no pin without sessionId, no double-pin
- `src/input.test.ts` (3 tests): onAutoPin — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +17, net 1443 tests across 37 files.

### What shipped in v0.88.0

**Theme: "Session Uptime"** — track and display session duration. `formatUptime(ms)` formats milliseconds as `2h 15m`, `45m`, `3d 2h`, `< 1m` etc. Sessions are timestamped when first observed via `updateState()` — survives status changes but not daemon restarts. Uptime shown in drill-down separator alongside title and notes. `/uptime` command lists all sessions with their running time. 17 new tests.

#### 1. `formatUptime()` pure function (`src/tui.ts`)
- Takes milliseconds, returns human-readable: `< 1m`, `45m`, `2h 15m`, `3d 2h`
- Handles edge cases: negative, zero, under-a-minute, exact boundaries
- Exported for direct testing

#### 2. Session first-seen tracking (`src/tui.ts`)
- `sessionFirstSeen: Map<string, number>` — epoch ms when first observed
- Set once per session ID in `updateState()` — never overwritten
- `getUptime(id)` — returns ms since first seen (0 if unknown)
- `getAllFirstSeen()` — read-only Map for `/uptime` listing

#### 3. Uptime in drill-down separator (`src/tui.ts`)
- `paintDrilldownSeparator()` shows uptime next to title: `── Alpha 2h 15m "working on auth" ──`
- DIM styled, between title and note text

#### 4. `/uptime` command (`src/input.ts`)
- `UptimeHandler` type (no args)
- `onUptime(handler)` callback registration
- `/uptime` command case
- `/help` updated

#### 5. Wiring (`src/index.ts`)
- `input.onUptime()` → iterates sessions, calls `formatUptime()` on each, logs results

#### 6. Tests
- `src/tui.test.ts` (14 tests): formatUptime — negative, zero, under minute, minutes, hours+min, hours only, days+hours, days only, exact 1m; TUI uptime state — unknown session, positive after update, tracks first-seen, stable across updates, new sessions get own timestamp
- `src/input.test.ts` (3 tests): onUptime — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +17, net 1426 tests across 37 files.

### What shipped in v0.87.0

**Theme: "Filter by Tag"** — tag-based activity filtering. `/filter error` shows only activity entries with a matching tag (case-insensitive exact match). `/filter` (no arg) clears the filter. Composes with existing mute and search: filter pipeline is mute → tag → search (all three stack). Separator bar shows active filter with match counts: `filter: error (5/200)`. 17 new tests.

#### 1. `matchesTagFilter()` pure function (`src/tui.ts`)
- Case-insensitive exact match on `entry.tag`
- Empty tag returns true (no filtering)
- Does NOT partial-match — "sys" won't match "system"

#### 2. `formatTagFilterIndicator()` pure function (`src/tui.ts`)
- Formats separator hint: `filter: error (5/200)` with AMBER tag + DIM counts
- Shows match count relative to non-muted total

#### 3. Tag filter state on TUI class (`src/tui.ts`)
- `filterTag: string | null` field
- `setTagFilter(tag)` — sets or clears (empty/null = clear), resets scroll, repaints
- `getTagFilter()` — current filter or null

#### 4. Filter pipeline integration (`src/tui.ts`)
- `log()` — tag filter applied after mute, before search
- `repaintActivityRegion()` — mute → tag → search pipeline
- `scrollUp()` / `scrollToTop()` — tag filter in entry count calculation
- `paintSeparator()` — tag filter indicator takes precedence over search/scroll hints

#### 5. `/filter` command (`src/input.ts`)
- `TagFilterHandler` type: `(tag: string | null) => void`
- `onTagFilter(handler)` callback registration
- `/filter <tag>` sets filter, `/filter` clears
- `/help` updated with `/filter`

#### 6. Wiring (`src/index.ts`)
- `input.onTagFilter()` → `tui.setTagFilter()`, logs "filter: tag" or "filter cleared"

#### 7. Tests
- `src/tui.test.ts` (14 tests): matchesTagFilter — empty tag, exact match (case variants), non-match, multi-word tags, no partial match; formatTagFilterIndicator — includes tag, counts, label; TUI tag filter state — initial null, set/clear/empty, resets scroll, safe when inactive
- `src/input.test.ts` (3 tests): onTagFilter — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +17, net 1409 tests across 37 files.

### What shipped in v0.86.0

**Theme: "Mute Polish"** — quality of life improvements for the mute system. `/unmute-all` clears all mutes at once (returns count of sessions unmuted). Suppressed entry count badge shows `◌(42)` next to muted session cards — tells you how many entries you've missed since muting. Badge caps at `(999+)`. Counts reset on unmute. `formatMuteBadge()` pure function. 20 new tests.

#### 1. `formatMuteBadge()` pure function (`src/tui.ts`)
- Takes a count, returns dim `(N)` string or empty for 0
- Caps at `(999+)` for readability
- Exported for direct testing

#### 2. `mutedEntryCounts` tracking (`src/tui.ts`)
- `mutedEntryCounts: Map<string, number>` — per-session suppressed count since last mute
- Incremented in `log()` for every muted entry (regardless of TUI active state)
- Reset to 0 on mute toggle, cleared on unmute-all
- `getMutedEntryCount(id)` accessor

#### 3. Badge in card rendering (`src/tui.ts`)
- Normal mode: `◌(42) ` after mute icon, reduces card width dynamically
- Both `paintSessions()` and `repaintSessionCard()` render the badge
- Badge width calculated from count digit length + parens + space

#### 4. `unmuteAll()` method (`src/tui.ts`)
- Clears `mutedIds` and `mutedEntryCounts`
- Returns count of sessions unmuted (0 if none)
- Repaints sessions + activity region

#### 5. `/unmute-all` command (`src/input.ts`)
- `UnmuteAllHandler` type (no args)
- `onUnmuteAll(handler)` callback registration
- `/unmute-all` command case
- `/help` updated with `/unmute-all`

#### 6. Wiring (`src/index.ts`)
- `input.onUnmuteAll()` → `tui.unmuteAll()`, logs "unmuted N sessions" or "no sessions are muted"

#### 7. Tests
- `src/tui.test.ts` (17 tests): formatMuteBadge — 0, negative, small count, large count, 999+ cap, huge number; TUI unmuteAll — returns 0 when empty, unmutes all + returns count, clears entry counts, safe when inactive; TUI mutedEntryCount — unknown session, unmuted session, starts at 0, increments on muted log, no increment for non-muted, resets on unmute toggle, ignores entries without sessionId
- `src/input.test.ts` (3 tests): onUnmuteAll — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +20, net 1392 tests across 37 files.

### What shipped in v0.85.0

**Theme: "Notes"** — session notes. `/note N|name text` attaches a short note to a session (max 80 chars, auto-truncated). `/note N|name` (no text) clears. `/notes` lists all session notes with ID→title resolution. `✎` indicator in normal + compact cards. Note text shown in drill-down separator: `── Alpha "working on auth" ──`. 21 new tests.

#### 1. `NOTE_ICON` + `MAX_NOTE_LEN` + `truncateNote()` (`src/tui.ts`)
- `NOTE_ICON = "✎"` — pencil indicator for sessions with notes (TEAL colored)
- `MAX_NOTE_LEN = 80` — max visible chars for a note
- `truncateNote(text)` — pure function, truncates with `..` suffix if over limit

#### 2. Note state on TUI class (`src/tui.ts`)
- `sessionNotes: Map<string, string>` — session ID → note text
- `setNote(sessionIdOrIndex, text)` — resolves by 1-indexed number, ID, ID prefix, or title (case-insensitive). Empty text clears. Returns boolean.
- `getNote(id)` — get note for session ID
- `getNoteCount()` — count of sessions with notes
- `getAllNotes()` — read-only Map for `/notes` listing
- `getSessions()` — read-only session list for ID→title resolution

#### 3. Note indicators in cards (`src/tui.ts`)
- Normal mode: `✎ ` prefix (TEAL) in session card, stacks with pin `▲` and mute `◌`
- Compact mode: `✎` in token, `formatCompactRows()` accepts `noteIds` param
- Drill-down separator shows note text: `── Alpha "working on auth" ──`

#### 4. `/note` + `/notes` commands (`src/input.ts`)
- `NoteHandler` type: `(target: string, text: string) => void`
- `NotesHandler` type: `() => void`
- `onNote(handler)` + `onNotes(handler)` callback registrations
- `/note N|name text` — set note; `/note N|name` — clear; `/notes` — list all
- `/help` updated with both commands

#### 5. Wiring (`src/index.ts`)
- `input.onNote()` → `tui.setNote()`, logs result
- `input.onNotes()` → `tui.getAllNotes()` + `tui.getSessions()` for ID→title display

#### 6. Tests
- `src/tui.test.ts` (15 tests): truncateNote — under limit, over limit, exact, empty; MAX_NOTE_LEN — is 80; NOTE_ICON — is ✎; TUI note state — initial empty, setNote by index, by name, clear with empty, unknown session, getNote unknown, getAllNotes, getSessions, safe when inactive
- `src/input.test.ts` (6 tests): onNote — register handler, safe without handler, handler replacement; onNotes — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +21, net 1372 tests across 37 files.

### What shipped in v0.84.0

**Theme: "Mute"** — session muting. `/mute N|name` toggles hiding activity log entries from a specific session. Muted entries still buffer and persist to disk — they're just hidden from the live display and scroll-back. Unmuting immediately makes them visible again. `◌` indicator in session cards (both normal and compact). 17 new tests.

#### 1. `sessionId` on `ActivityEntry` (`src/tui.ts`)
- Optional `sessionId?: string` field — backwards-compatible, ties an entry to a session for mute filtering
- Passed through from `log(tag, text, sessionId?)` — existing callers unaffected

#### 2. `shouldMuteEntry()` pure function (`src/tui.ts`)
- Takes `entry` and `mutedIds: Set<string>`, returns true if entry should be hidden
- Returns false for entries without `sessionId` or with non-muted IDs
- Exported for direct testing

#### 3. `MUTE_ICON` constant (`src/tui.ts`)
- `"◌"` (combining dotted circle) — displayed DIM next to muted session cards
- Shown in both normal card layout and compact token layout

#### 4. Mute state on TUI class (`src/tui.ts`)
- `mutedIds: Set<string>` field
- `toggleMute(sessionIdOrIndex)` — resolves by 1-indexed number, ID, ID prefix, or title (case-insensitive). Returns boolean.
- `isMuted(id)` — check mute state
- `getMutedCount()` — count of muted sessions
- `toggleMute` repaints session cards and activity region

#### 5. Mute filtering in display (`src/tui.ts`)
- `log()` — muted entries skip live display (still buffered + persisted)
- `repaintActivityRegion()` — filters out muted entries before pagination
- `scrollUp()` / `scrollToTop()` — compute max offset from filtered (non-muted) entries
- Both mute and search filters compose: mute applied first, then search on top

#### 6. Mute indicator in cards (`src/tui.ts`)
- Normal mode: `◌ ` prefix (DIM) before session card, reduces card width by 2 chars per icon
- Compact mode: `◌` between index and status dot in token
- `repaintSessionCard()` includes mute indicator for hover repaints
- Both pin `▲` and mute `◌` can appear together

#### 7. `/mute` command (`src/input.ts`)
- `MuteHandler` type: `(target: string) => void`
- `onMute(handler)` callback registration on `InputReader`
- `/mute <N|name>` toggles mute, `/mute` shows usage hint
- `/help` updated with `/mute` in navigation section

#### 8. Wiring (`src/index.ts`)
- `input.onMute()` → resolves numeric target, calls `tui.toggleMute()`, logs result
- Event highlights pass `s.id` as `sessionId` to `tui.log()` for mute filtering
- Action execution results pass `sessionId` to `tui.log()` for mute filtering

#### 9. Tests
- `src/tui.test.ts` (14 tests): shouldMuteEntry — no sessionId, non-muted, muted, empty set, multiple IDs; MUTE_ICON — is ◌; TUI mute state — initial empty, toggleMute invalid, toggleMute by index, by name, double toggle unmutes, isMuted unknown, safe when inactive, log with muted sessionId
- `src/input.test.ts` (3 tests): onMute — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +17, net 1351 tests across 37 files.

### What shipped in v0.83.0

**Theme: "Bookmark"** — activity bookmarks. `/mark` saves the current scroll position, `/jump N` scrolls to bookmark N (centered in view), `/marks` lists all saved bookmarks with labels. `computeBookmarkOffset()` pure function for clean scroll math. Max 20 bookmarks with FIFO eviction. 24 new tests.

#### 1. `Bookmark` interface + `MAX_BOOKMARKS` constant (`src/tui.ts`)
- `{ index: number, label: string }` — index into activity buffer + auto-generated label
- `MAX_BOOKMARKS = 20` — oldest evicted when exceeded

#### 2. `computeBookmarkOffset()` pure function (`src/tui.ts`)
- Takes bookmark index, buffer length, visible lines
- Returns scroll offset that centers the bookmarked entry
- Returns 0 (live mode) if entry is within the visible tail

#### 3. Bookmark state on TUI class (`src/tui.ts`)
- `bookmarks: Bookmark[]` field
- `addBookmark()` — saves current view position's top entry, returns bookmark number (1-indexed) or 0 if empty
- `jumpToBookmark(num)` — scrolls to bookmark, returns false if invalid
- `getBookmarks()` — read-only accessor for listing
- `getBookmarkCount()` — count accessor

#### 4. Commands (`src/input.ts`)
- `MarkHandler`, `JumpHandler`, `MarksHandler` types
- `onMark(handler)`, `onJump(handler)`, `onMarks(handler)` callback registrations
- `/mark` — adds bookmark
- `/jump N` — jumps to bookmark N (validates positive integer)
- `/marks` — lists all bookmarks
- `/help` updated with all three commands in navigation section

#### 5. Wiring (`src/index.ts`)
- `input.onMark()` → `tui.addBookmark()`, logs result
- `input.onJump()` → `tui.jumpToBookmark(num)`, logs success/failure
- `input.onMarks()` → iterates `tui.getBookmarks()`, logs each

#### 6. Tests
- `src/tui.test.ts` (15 tests): computeBookmarkOffset — visible tail, centered, last entry, buffer start, small buffer, single entry; MAX_BOOKMARKS — is 20; TUI bookmark state — initial empty, addBookmark on empty, addBookmark returns number, multiple bookmarks, jumpToBookmark invalid/valid, safe when inactive
- `src/input.test.ts` (9 tests): onMark/onJump/onMarks — register handler, safe without handler, handler replacement (3 each)

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +24, net 1334 tests across 37 files.

### What shipped in v0.82.0

**Theme: "Focus"** — focus mode. `/focus` toggles hiding all sessions except pinned ones. Header shows "2/5 agents" in focus mode. Empty state in focus guides users: "no pinned agents — /pin to add, /focus to exit". `getVisibleCount()` private helper filters sessions consistently across layout, paint, hit testing, and compact mode. "focus" tag appears in panel border. 12 new tests.

#### 1. Focus state on TUI class (`src/tui.ts`)
- `focusMode` field (default: false)
- `setFocus(enabled)` — toggles focus, recomputes layout, repaints
- `isFocused()` — read-only accessor
- `getVisibleCount()` private helper — returns all sessions count when normal, pinned-only count when focused

#### 2. Visible sessions throughout layout + paint (`src/tui.ts`)
- `getSessionCount()` now returns visible count (for hit testing)
- `paintSessions()` renders only visible sessions (pinned sessions sort to top, so `sessions.slice(0, visibleCount)` works)
- `computeLayout()` uses visible count for row calculation
- `updateState()` detects visible count changes for layout recomputation
- `onResize()`, `setCompact()`, `enterDrilldown()`, `exitDrilldown()` all use visible count
- Compact mode passes only visible sessions to `formatCompactRows()`

#### 3. Header shows focus info (`src/tui.ts`)
- Normal: "5 agents"
- Focus: "2/5 agents" — visible/total

#### 4. Empty state guidance (`src/tui.ts`)
- Focus with no pins: "no pinned agents — /pin to add, /focus to exit"
- Normal with no sessions: "no agents connected" (unchanged)

#### 5. Border label (`src/tui.ts`)
- "focus" tag added to border: ` agents (focus, compact, status) `

#### 6. `/focus` command (`src/input.ts`)
- `FocusHandler` type: `() => void`
- `onFocus(handler)` callback registration on `InputReader`
- `/focus` toggles focus mode
- `/help` updated with `/focus` in navigation section

#### 7. Wiring (`src/index.ts`)
- `input.onFocus()` → toggles `tui.setFocus(!tui.isFocused())`, logs "focus mode: on/off"

#### 8. Tests
- `src/tui.test.ts` (9 tests): TUI focus state — initial off, setFocus on/off, no-op same value, safe when inactive; getSessionCount returns all when not focused, pinned-only when focused, 0 when focused with no pins; focus + pin + unpin updates count
- `src/input.test.ts` (3 tests): onFocus — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +12, net 1310 tests across 37 files.

### What shipped in v0.81.0

**Theme: "Bell"** — terminal bell notifications. `/bell` toggles opt-in audible alerts (\x07) for high-signal events: errors, failed actions, and task completions. 5-second cooldown prevents rapid-fire buzzing. Pure `shouldBell(tag, text)` function for clean testability. 18 new tests.

#### 1. `shouldBell()` pure function (`src/tui.ts`)
- Takes `tag` and `text`, returns boolean for high-signal events only
- `"! action"` or `"error"` tag → true (failures)
- `"+ action"` tag with text containing "complete" (case-insensitive) → true (completions)
- All other tags → false (no noise for routine events)

#### 2. `BELL_COOLDOWN_MS` constant (`src/tui.ts`)
- 5000ms cooldown between bell triggers to prevent buzzing

#### 3. Bell trigger in `log()` (`src/tui.ts`)
- After appending to activity buffer, checks `bellEnabled && shouldBell(tag, text)`
- Respects cooldown: only fires if `nowMs - lastBellAt >= BELL_COOLDOWN_MS`
- Writes `\x07` (BEL character) to `process.stderr`

#### 4. Bell state on TUI class (`src/tui.ts`)
- `bellEnabled` field (default: false — opt-in only)
- `lastBellAt` field (epoch ms of last bell)
- `setBell(enabled)` — enable/disable
- `isBellEnabled()` — read-only accessor

#### 5. `/bell` command (`src/input.ts`)
- `BellHandler` type: `() => void`
- `onBell(handler)` callback registration on `InputReader`
- `/bell` toggles bell state
- `/help` updated with `/bell` in navigation section

#### 6. Wiring (`src/index.ts`)
- `input.onBell()` → toggles `tui.setBell(!tui.isBellEnabled())`, logs "bell notifications: on/off"

#### 7. Tests
- `src/tui.test.ts` (15 tests): shouldBell — error tag, ! action tag, + action with complete, + action with Complete (case), + action without complete, observation/system/reasoner/explain/status tags all false; BELL_COOLDOWN_MS — is 5000ms; TUI bell state — initial off, setBell on/off, safe when inactive
- `src/input.test.ts` (3 tests): onBell — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +18, net 1298 tests across 37 files.

### What shipped in v0.80.0

**Theme: "Pin"** — session pinning. `/pin N` or `/pin name` toggles a session to always sort to the top regardless of sort mode. ▲ indicator in both normal and compact modes. Stable sort preserves mode order within pinned and unpinned groups. Double-toggle unpins. Resolves by 1-indexed number, session ID, ID prefix, or case-insensitive title. 15 new tests.

#### 1. `sortSessions()` updated (`src/tui.ts`)
- New optional `pinnedIds` parameter (Set<string>)
- After applying sort mode, stable-sorts pinned sessions to top
- Preserves mode order within both pinned and unpinned groups (JS stable sort guarantee)

#### 2. Pin indicator (`src/tui.ts`)
- `PIN_ICON` constant: `▲` (AMBER-colored)
- Normal mode: `▲ ` prefix before session card, reduces card width by 2 chars
- Compact mode: `▲` between index and status dot in token
- `repaintSessionCard()` includes pin indicator for hover repaints

#### 3. Pin state on TUI class (`src/tui.ts`)
- `pinnedIds: Set<string>` field
- `togglePin(sessionIdOrIndex)` — resolves target, toggles pin, re-sorts, repaints. Returns boolean.
- `isPinned(id)` — check pin state
- `getPinnedCount()` — count of pinned sessions
- All `sortSessions()` call sites updated to pass `this.pinnedIds`

#### 4. `/pin` command (`src/input.ts`)
- `PinHandler` type: `(target: string) => void`
- `onPin(handler)` callback registration on `InputReader`
- `/pin <N|name>` toggles pin, `/pin` shows usage hint
- `/help` updated with `/pin` in navigation section

#### 5. Wiring (`src/index.ts`)
- `input.onPin()` → resolves numeric target, calls `tui.togglePin()`, logs result

#### 6. Tests
- `src/tui.test.ts` (12 tests): sortSessions with pins — default mode, status mode, empty set, all pinned; formatCompactRows with pins — pin indicator present/absent; TUI pin state — initial no pins, togglePin by index, by title, invalid target, double toggle unpins, safe when inactive
- `src/input.test.ts` (3 tests): onPin — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +15, net 1280 tests across 37 files.

### What shipped in v0.79.0

**Theme: "Compact"** — compact mode for the session panel. `/compact` toggles between normal (one card per row) and compact (inline tokens, multiple per row). In compact mode, sessions display as numbered tokens `1●Alpha  2●Bravo` that wrap to fill the terminal width, drastically reducing panel height for many-session setups. Quick-switch 1-9 and `/view` still work. Mouse click/hover disabled in compact (use keyboard). Sort and compact tags shown in panel border: ` agents (compact, status) `. 17 new tests.

#### 1. `formatCompactRows()` pure function (`src/tui.ts`)
- Takes sessions array and max width, returns array of formatted row strings
- Each token: `{idx}{coloredDot}{boldName}` — e.g. `1●Alpha`
- Names truncated to `COMPACT_NAME_LEN` (10 chars)
- Tokens packed left-to-right with 2-space gaps, wrapping to next row when width exceeded

#### 2. `computeCompactRowCount()` pure function (`src/tui.ts`)
- Returns number of display rows needed for compact layout (minimum 1)

#### 3. Compact state on TUI class (`src/tui.ts`)
- `compactMode` field, `setCompact(enabled)`, `isCompact()` methods
- `setCompact` recomputes layout and repaints when toggled
- `computeLayout()` uses `computeCompactRowCount()` instead of session count in compact mode
- `paintSessions()` branches: compact renders inline tokens, normal renders full cards
- Top border label combines compact and sort tags: ` agents (compact, status) `

#### 4. `/compact` command (`src/input.ts`)
- `CompactHandler` type: `() => void`
- `onCompact(handler)` callback registration on `InputReader`
- `/help` updated with `/compact` in navigation section

#### 5. Wiring (`src/index.ts`)
- `input.onCompact()` → toggles `tui.setCompact(!tui.isCompact())`, logs mode change
- Mouse click and hover guards: skip per-session targeting when compact mode is on
- Click-to-drilldown and hover highlight only active in normal mode

#### 6. Tests
- `src/tui.test.ts` (14 tests): formatCompactRows — empty, single, multiple fit, wrapping, truncation, numbered indexes; computeCompactRowCount — empty, few, many; TUI compact state — initial off, setCompact on/off, no-op same value, safe when inactive
- `src/input.test.ts` (3 tests): onCompact — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +17, net 1265 tests across 37 files.

### What shipped in v0.78.0

**Theme: "Sort"** — session sort in the TUI. `/sort` command with 4 modes: status (errors first), name (alphabetical), activity (most recently changed first), default (original order). Sort indicator in the sessions panel top border. Activity change tracking built into the TUI for time-based sorting. `/sort` with no args cycles through modes. 21 new tests.

#### 1. `sortSessions()` pure function (`src/tui.ts`)
- Takes `sessions`, `mode`, optional `lastChangeAt` map
- `"status"` — priority: error > waiting > working/running > idle > done > stopped > unknown
- `"name"` — case-insensitive alphabetical by title
- `"activity"` — most recently changed first (using `lastChangeAt` timestamps)
- `"default"` — preserves original order
- Returns new array, never mutates input

#### 2. `nextSortMode()` pure function (`src/tui.ts`)
- Cycles: default → status → name → activity → default

#### 3. Sort state on TUI class (`src/tui.ts`)
- `sortMode` field, `setSortMode()`, `getSortMode()` methods
- `lastChangeAt` map — tracks epoch ms of last activity change per session ID
- `prevLastActivity` map — compares `lastActivity` strings between ticks to detect changes
- `updateState()` tracks activity changes and applies sort before storing sessions
- `paintSessions()` shows sort mode in top border label: ` agents (status) `

#### 4. `/sort` command (`src/input.ts`)
- `SortHandler` type: `(mode: string | null) => void`
- `onSort(handler)` callback registration on `InputReader`
- `/sort <mode>` sets explicit mode, `/sort` cycles through all modes
- `/help` updated with `/sort` in navigation section

#### 5. Wiring (`src/index.ts`)
- `input.onSort()` → validates mode against `SORT_MODES`, calls `tui.setSortMode()`, logs sort change
- Unknown modes produce helpful error message

#### 6. Tests
- `src/tui.test.ts` (18 tests): sortSessions — default preserves order, no mutation, status errors first, all priorities, name alphabetical+case-insensitive, activity by timestamp, activity no timestamps, empty array; nextSortMode — 4 cycle tests; SORT_MODES — contains all four; TUI sort state — initial default, setSortMode, no-op same mode, safe when inactive, updateState sorts
- `src/input.test.ts` (3 tests): onSort — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +21, net 1248 tests across 37 files.

### What shipped in v0.77.0

**Theme: "Spark"** — activity sparkline in separator bar. A tiny Unicode block chart (▁▂▃▄▅▆▇█) showing activity rate over the last 10 minutes, with a color gradient from SLATE (low) → SKY (mid) → LIME (high). Empty sparklines (no recent activity) fall back to default separator hints. 14 new tests.

#### 1. `computeSparkline()` pure function (`src/tui.ts`)
- Takes `timestamps: number[]`, `now`, `buckets` (default 20), `windowMs` (default 10 min)
- Returns array of bucket counts (events per time bucket)
- Ignores timestamps outside the window

#### 2. `formatSparkline()` pure function (`src/tui.ts`)
- Takes bucket counts, returns colored Unicode block string
- Color gradient: SLATE (low) → SKY (mid) → LIME (high)
- Returns empty string if all zeros
- Space character for zero-count buckets

#### 3. `activityTimestamps` tracking (`src/tui.ts`)
- `activityTimestamps: number[]` field on TUI class
- `log()` records `Date.now()` alongside activity buffer entries
- Trimmed with activity buffer when exceeding `maxActivity`

#### 4. Wiring into `paintSeparator()` (`src/tui.ts`)
- In live mode (not scrolled, not searching): shows sparkline + `/help` hint
- Falls back to default hints when sparkline is empty (no recent activity)

#### 5. Tests (`src/tui.test.ts`)
- `computeSparkline` (7 tests): empty timestamps, bucket count, correct placement, multiple in same bucket, outside window, recent in last bucket, burst activity
- `formatSparkline` (7 tests): all zeros → empty, non-zero → non-empty, Unicode blocks, max → █, zero → space, single non-zero, relative scaling

Modified: `src/tui.ts`, `src/tui.test.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +14, net 1227 tests across 37 files.

### What shipped in v0.76.0

**Theme: "Keys"** — keyboard quick-switch. Type a bare digit 1-9 and Enter to instantly jump to that session. In overview mode, drills into the session. In drill-down mode, switches to a different session. 3 new tests.

#### 1. Quick-switch handler (`src/input.ts`)
- `QuickSwitchHandler` type: `(sessionNum: number) => void`
- `onQuickSwitch(handler)` callback registration on `InputReader`
- `handleLine()` detects bare digit 1-9 (regex `^[1-9]$`) before slash commands
- Only fires when quick-switch handler is registered (graceful fallback to regular message)

#### 2. Wiring (`src/index.ts`)
- `input.onQuickSwitch((num) => { ... })` — in overview: drill into session; in drilldown: switch to different session
- Logs "viewing session #N" or "switched to session #N" or "session #N not found"

#### 3. Help text (`src/input.ts`)
- `/help` navigation section: added "1-9" quick-switch hint at the top

#### 4. Tests
- `src/input.test.ts` (3 tests): onQuickSwitch — register handler, safe without handler, handler replacement

Modified: `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +3, net 1213 tests across 37 files.

### What shipped in v0.75.0

**Theme: "Hover"** — session highlight on hover. Mouse motion tracking via `?1003h` any-event mode, efficient single-card repaints, subtle BG highlight with `BG_HOVER` (238). Hover clears on drill-down enter/exit. 14 new tests.

#### 1. Mouse mode upgrade (`src/tui.ts`)
- `MOUSE_ON` changed from `?1000h` (button-only) to `?1003h` (any-event tracking)
- `MOUSE_OFF` changed from `?1000l` to `?1003l`
- Enables motion event reporting needed for hover detection

#### 2. Hover highlight (`src/tui.ts`, `src/colors.ts`)
- `BG_HOVER` constant (`\x1b[48;5;238m`) — slightly brighter than `BG_DARK` (236)
- `hoverSessionIdx: number | null` field — 1-indexed, null when no hover
- `setHoverSession(idx)` — updates hover state, repaints only the affected cards (prev + new)
- `getHoverSession()` — read-only accessor for testing
- `repaintSessionCard(idx)` — private method, efficiently repaints a single session card row
- `padBoxLineHover(line, totalWidth, hovered)` — extends hover BG through padding to right border
- `paintSessions()` applies hover BG to the hovered card
- Hover cleared on `enterDrilldown()` and `exitDrilldown()`

#### 3. Mouse move handler (`src/input.ts`)
- `MouseMoveHandler` type: `(row: number, col: number) => void`
- `onMouseMove(handler)` callback registration on `InputReader`
- Extended `mouseDataListener` to detect motion events: button 32-35 (bit 5 set)
- Row-change debounce via `lastMoveRow` — only fires handler when row changes, preventing redundant repaints

#### 4. Wiring (`src/index.ts`)
- `input.onMouseMove((row, col) => { hitTestSession(row, 1, ...) → tui.setHoverSession(idx) })`
- Only processes hover in overview mode

#### 5. Tests
- `src/tui.test.ts` (11 tests): padBoxLineHover — hover BG, non-hover matches padBoxLine, ends with border, BG extends through padding; TUI hover state — initial null, setHoverSession, clear with null, safe when not active, no-op for same index, clears on enterDrilldown, clears on exitDrilldown
- `src/input.test.ts` (3 tests): onMouseMove — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `src/colors.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +14, net 1210 tests across 37 files.

### What shipped in v0.74.0

**Theme: "Search"** — `/search <pattern>` command to filter activity entries by case-insensitive substring match. Search indicator in separator bar shows match count and clear hint. Scroll navigation operates on filtered entries when search is active. New entries only auto-scroll if they match the search. 22 new tests.

#### 1. Search pure function (`src/tui.ts`)
- `matchesSearch(entry, pattern)` — case-insensitive substring match against `entry.tag`, `entry.text`, and `entry.time`
- `formatSearchIndicator(pattern, matchCount, totalCount)` — shows `search: "pattern" │ 12 of 50 │ /search: clear`

#### 2. Search state on TUI class (`src/tui.ts`)
- `searchPattern: string | null` field — active search filter
- `setSearch(pattern)` — set/clear search, reset scroll offset, repaint activity + separator
- `getSearchPattern()` — read-only accessor for testing
- `repaintActivityRegion()` filters entries through `matchesSearch()` when search active
- `paintSeparator()` shows `formatSearchIndicator()` when search active
- `log()` — when search active, only auto-scroll if new entry matches the pattern
- `scrollUp()`/`scrollToTop()` — operate on filtered entry count when search active

#### 3. `/search` command (`src/input.ts`)
- `SearchHandler` type: `(pattern: string | null) => void`
- `onSearch(handler)` callback registration on `InputReader`
- `/search <pattern>` → fires handler with pattern
- `/search` with no args → fires handler with `null` (clear)
- `/help` updated with `/search` in navigation section

#### 4. Wiring (`src/index.ts`)
- `input.onSearch((pattern) => tui.setSearch(pattern))` — logs "search: pattern" or "search cleared" as system activity

#### 5. Tests
- `src/tui.test.ts` (19 tests): matchesSearch — tag/text/time match, case-insensitive, no match, empty pattern, partial text, all fields; formatSearchIndicator — pattern+counts, zero matches, clear hint, quotes, label; TUI search state — initial null, setSearch, clear with null/empty, getSearchPattern, safe when not active
- `src/input.test.ts` (3 tests): onSearch — register handler, safe without handler, handler replacement

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +22, net 1196 tests across 37 files.

### What shipped in v0.73.0

**Theme: "Wheel"** — mouse wheel scrolling in overview and drill-down modes, plus full drill-down scroll state. Wheel scrolls 3 lines per tick for smooth navigation. PgUp/PgDn/End now work in drill-down mode too. Scroll indicator shows position when scrolled back. 16 new tests.

#### 1. Mouse wheel handler (`src/input.ts`)
- `MouseWheelHandler` type exported: `(direction: "up" | "down") => void`
- `onMouseWheel(handler)` callback registration on `InputReader`
- Extended `mouseDataListener` to detect scroll events: button 64 = scroll up, button 65 = scroll down
- Dispatches to wheel handler on any scroll event (press only, not release)

#### 2. Drill-down scroll state (`src/tui.ts`)
- New `drilldownScrollOffset` field — 0 = live tail, >0 = scrolled back N lines
- New `drilldownNewWhileScrolled` field — counts new lines arriving while scrolled back
- `scrollDrilldownUp(lines?)` — scroll back, defaults to half-page
- `scrollDrilldownDown(lines?)` — scroll forward, resets new counter when returning to live
- `scrollDrilldownToBottom()` — jump to live tail
- `isDrilldownScrolledBack()` — read-only accessor
- Scroll offset reset on `enterDrilldown()` and `exitDrilldown()`

#### 3. Drill-down content with scroll (`src/tui.ts`)
- `repaintDrilldownContent()` now uses `computeScrollSlice()` with `drilldownScrollOffset`
- `setSessionOutputs()` tracks new-while-scrolled count when user is scrolled back
- Separator repaints on content update to keep scroll indicator current

#### 4. Drill-down scroll indicator (`src/tui.ts`)
- `formatDrilldownScrollIndicator()` pure function — shows `↑ N lines │ pos/total │ scroll: navigate End=live [N new ↓]`
- `paintDrilldownSeparator()` switches between scroll indicator (when scrolled) and default hints (when at live)
- Default drill-down hints updated: "click or /back: overview  scroll: navigate  /view N: switch"

#### 5. Wiring (`src/index.ts`)
- `input.onMouseWheel()`: in overview → `tui.scrollUp(3)`/`scrollDown(3)`, in drilldown → `tui.scrollDrilldownUp(3)`/`scrollDrilldownDown(3)`
- `input.onScroll()`: PgUp/PgDn/End now dispatch to drill-down scroll methods when in drill-down mode

#### 6. Help text (`src/input.ts`)
- `/help` navigation section: added "mouse wheel" and updated PgUp/PgDn descriptions to mention drill-down

#### 7. Tests
- `src/input.test.ts` (3 tests): onMouseWheel — register handler, safe without handler, handler replacement
- `src/tui.test.ts` (13 tests): formatDrilldownScrollIndicator — offset+position, new lines, omit new, hints, single line; TUI drill-down scroll — initial state, scrollUp/Down/ToBottom no-ops when inactive, no-ops in overview, reset on enter/exit drilldown

Modified: `src/input.ts`, `src/input.test.ts`, `src/tui.ts`, `src/tui.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +16, net 1174 tests across 37 files.

### What shipped in v0.72.0

**Theme: "Click"** — mouse click session selection in the TUI. Click an agent card in the sessions panel to drill down into its live output. Click anywhere in drill-down mode to return to overview. SGR extended mouse protocol, pure hit-test function, zero new dependencies. 36 new tests.

#### 1. Mouse event parsing (`src/input.ts`)
- `MouseEvent` interface: `{ button, col, row, press }` (1-indexed coordinates)
- `parseMouseEvent(data)` pure function — parses SGR extended mouse sequences (`\x1b[<btn;col;rowM/m`)
- `MouseClickHandler` type exported
- `onMouseClick(handler)` callback registration on `InputReader`
- Raw `process.stdin.on("data")` listener intercepts SGR mouse sequences, dispatches left-click press (button=0, M suffix) to handler
- Listener cleanup in `stop()` via `removeListener`

#### 2. Mouse tracking in TUI (`src/tui.ts`)
- `MOUSE_ON` / `MOUSE_OFF` constants — `\x1b[?1000h\x1b[?1006h` / `\x1b[?1000l\x1b[?1006l` (button tracking + SGR extended mode)
- `start()` writes `MOUSE_ON` after entering alternate screen
- `stop()` writes `MOUSE_OFF` before restoring normal screen
- `getSessionCount()` method — exposes session count for external hit testing

#### 3. Hit testing (`src/tui.ts`)
- `hitTestSession(row, headerHeight, sessionCount)` pure exported function
- Session cards at rows `headerHeight+2` through `headerHeight+1+sessionCount`
- Returns 1-indexed session number or `null` for miss

#### 4. Wiring (`src/index.ts`)
- `input.onMouseClick()` handler: in overview mode, calls `hitTestSession()` → `tui.enterDrilldown()`; in drilldown mode, click anywhere → `tui.exitDrilldown()`
- Imported `hitTestSession` from tui.ts

#### 5. UX updates
- `/help` navigation section: added "click session" hint
- TUI separator bar: changed default hints to "click agent to view" for discoverability

#### 6. Tests
- `src/input.test.ts` (19 tests): parseMouseEvent — left click press/release, right click, middle click, scroll up/down, large coordinates, single-digit coordinates, non-mouse data, empty string, ANSI escape, partial sequence, legacy X10, embedded data, typed fields, press vs release; onMouseClick — register handler, safe without handler, handler replacement
- `src/tui.test.ts` (17 tests): hitTestSession — sessions 1-3 in range, top/bottom border miss, header miss, row 0, far below, zero sessions, single session, headerHeight=2, 100 sessions, negative row, negative sessionCount; TUI.getSessionCount — initial 0, after updateState, after change

Modified: `src/input.ts`, `src/input.test.ts`, `src/tui.ts`, `src/tui.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +36, net 1158 tests across 37 files.

### What shipped in v0.71.0

**Theme: "Replay"** — `aoaoe replay` subcommand that plays back tui-history.jsonl like a movie with simulated timing. Adjustable speed (realtime to instant), time window filtering, consistent rendering via formatTailEntry. 58 new tests.

#### 1. Replay module (`src/replay.ts`)
- `computeDelay(prevTs, currTs, speed, maxDelayMs?)` — compute scaled delay between entries, caps at 3s default
- `formatSpeed(speed)` — human-readable speed display ("instant", "1x (realtime)", "5x", "0.5x")
- `parseSpeed(input)` — parse speed strings ("2x", "10x", "0.5x", "instant") into numbers
- `filterByWindow(entries, maxAgeMs?, now?)` — filter entries by time window
- `formatReplayHeader(entries, speed, windowLabel?)` — header with entry count, date range, span, speed
- `formatReplayFooter(entries)` — footer with entry count
- `loadReplayEntries(maxAgeMs?, filePath?)` — load and validate JSONL entries, filter by window
- `runReplay(opts)` — main entry: header, timed playback with Ctrl+C cleanup, footer
- Reuses `formatTailEntry`/`formatTailDate` from tail.ts, `parseDuration` from export.ts

#### 2. CLI wiring (`src/config.ts`, `src/index.ts`)
- `parseCliArgs`: added `runReplay`, `replaySpeed`, `replayLast` fields + `if (argv[2] === "replay")` subcommand block with `--speed`/`-s`, `--last`/`-l`, `--instant` flags
- `printHelp()`: added `replay` command with options section
- `index.ts`: dynamic `import("./replay.js")` + dispatch to `runReplay({ speed, last })`

#### 3. Tests (`src/replay.test.ts`)
- `computeDelay` (10 tests): instant, negative, equal ts, reversed ts, 1x/5x/10x scaling, cap at maxDelayMs, custom cap, exact under cap
- `formatSpeed` (5 tests): instant, negative, realtime, integer, decimal
- `parseSpeed` (9 tests): instant, "0", integer ±x, decimal ±x, empty, non-numeric, negative
- `filterByWindow` (5 tests): undefined/0 maxAge, filters old, all old, uses Date.now()
- `formatReplayHeader` (8 tests): empty, count, speed, instant, window label, seconds/minutes/hours span
- `formatReplayFooter` (3 tests): empty, count, text
- `loadReplayEntries` (7 tests): missing file, empty, loads all, malformed skip, missing fields skip, maxAgeMs filter, undefined maxAgeMs
- `parseCliArgs replay` (11 tests): defaults, --speed, -s, --instant, --last, -l, combined, instant+last, invalid speed, negative speed, non-replay
- Plus 1 update to mutually exclusive subcommand test in config.test.ts

New files: `src/replay.ts` (existed), `src/replay.test.ts`
Modified: `src/config.ts`, `src/config.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +58, net 1122 tests across 37 files.

### What shipped in v0.70.0

**Theme: "Stats"** — `aoaoe stats` subcommand showing aggregate daemon statistics computed from actions.log and tui-history.jsonl. Actions by type, success/failure rate, busiest sessions, activity breakdown, time range. 41 new tests.

#### 1. Stats module (`src/stats.ts`)
- `parseActionStats(lines, maxAgeMs?, now?)` — aggregates action log JSONL into total/succeeded/failed counts, byType map, bySession map (with per-session ok/fail), time range. Skips wait actions and malformed lines.
- `parseHistoryStats(entries, maxAgeMs?, now?)` — aggregates tui-history entries into total count, byTag map, time range
- `combineStats(actions, history)` — merges both stat sources, computes unified time range (min start, max end)
- `formatDuration(ms)` — formats duration as human-readable "45s", "1m 30s", "2h", "1d 4h"
- `formatRate(count, spanMs)` — formats rate as "X/hr" or "X/day" (falls back to "X total" for short spans)
- `formatStats(stats, windowLabel?)` — renders full terminal output: time range, action counts with success %, bar chart by type, top sessions, activity breakdown by tag. Uses 256-color palette.

#### 2. CLI wiring (`src/config.ts`, `src/index.ts`)
- `parseCliArgs`: added `runStats`, `statsLast` fields + `if (argv[2] === "stats")` subcommand block with `--last`/`-l` flag
- `printHelp()`: added `stats` and `stats --last` to commands list
- `index.ts`: `runStatsCommand(statsLast?)` handler — reads actions.log + loadTuiHistory, parses both, combines, formats

#### 3. Tests (`src/stats.test.ts`)
- `parseActionStats` (9 tests): empty input, all-wait, counts, by type, by session (title priority), time range, malformed skip, maxAgeMs filter, per-session ok/fail
- `parseHistoryStats` (4 tests): empty, total count, by tag, time range, maxAgeMs
- `combineStats` (4 tests): both null, actions only, history only, min/max across both
- `formatDuration` (7 tests): seconds, minutes, minutes+seconds, hours, hours+minutes, days, days+hours
- `formatRate` (4 tests): zero span, short span, per-hour, per-day
- `formatStats` (8 tests): no data, window label, time range display, action counts with %, type breakdown, top sessions, activity breakdown, no-actions-with-history
- `parseCliArgs stats` (4 tests): defaults, --last, -l, non-stats returns false
- Plus 1 update to existing mutually exclusive subcommand test

New files: `src/stats.ts`, `src/stats.test.ts`
Modified: `src/config.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +41, net 1064 tests across 36 files.

### What shipped in v0.69.0

**Theme: "Tail"** — `aoaoe tail` subcommand for live-streaming daemon activity to a separate terminal. Reads from `tui-history.jsonl`, prints colorized entries, and optionally follows for new entries via `fs.watch`. 36 new tests.

#### 1. Tail module (`src/tail.ts`)
- `formatTailEntry(entry)` — colorizes a HistoryEntry for terminal output, matching TUI formatActivity style (obs/reasoner/AI/action/error/you/system tags)
- `formatTailDate(ts)` — formats epoch timestamp as YYYY-MM-DD for the header
- `loadTailEntries(count, filePath?)` — reads last N entries from JSONL file, skips malformed lines, validates entry shape
- `getFileSize(filePath)` — returns current file size for follow mode offset tracking
- `readNewEntries(filePath, fromByte)` — reads bytes appended since offset, parses into entries. Detects file rotation (size < offset) and reads from start
- `printEntries(entries)` — writes colorized entries to stderr
- `runTail(opts)` — main entry: prints last N entries with date header, optionally enters follow mode with `fs.watch` + SIGINT cleanup

#### 2. CLI wiring (`src/config.ts`, `src/index.ts`)
- `parseCliArgs`: added `runTail`, `tailFollow`, `tailCount` fields + `if (argv[2] === "tail")` subcommand block with `-f`/`--follow` and `-n`/`--count` flag parsing
- `printHelp()`: added `tail` command with options section
- `index.ts`: dynamic `import("./tail.js")` + dispatch to `runTail({ count, follow })`

#### 3. ESM fix (`src/tail.ts`)
- Replaced `require("node:fs")` calls in `readNewEntries` with proper ESM imports (`openSync`, `readSync`, `closeSync`) for consistency with the rest of the codebase

#### 4. Bug fix (`src/tail.ts`)
- Fixed `readNewEntries` early-return logic: previously returned empty on file rotation (`size < fromByte`). Now correctly detects rotation and reads from byte 0.

#### 5. Tests (`src/tail.test.ts`)
- `formatTailEntry` (10 tests): observation/reasoner/explain/action/error/you/system tags, time field, pipe separator, unknown tags
- `formatTailDate` (3 tests): YYYY-MM-DD format, zero-padded months, zero-padded days
- `loadTailEntries` (6 tests): missing file, empty file, load entries, count limit, malformed skip, missing fields skip
- `getFileSize` (3 tests): missing file, existing file, empty file
- `readNewEntries` (5 tests): no growth, appended entries, file rotation, missing file, malformed lines
- `parseCliArgs tail` (9 tests): defaults, -f, --follow, -n, --count, both flags, invalid count, zero count, non-tail

New files: `src/tail.ts`, `src/tail.test.ts`
Modified: `src/config.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +36, net 1023 tests across 35 files.

### What shipped in v0.68.0

**Theme: "Config Hot-Reload"** — watch the config file for changes and hot-reload safe fields without restarting the daemon. Unsafe field changes are detected and the user is warned. 20 new tests.

#### 1. Config watcher module (`src/config-watcher.ts`)
- `ConfigWatcher` class — `fs.watch` on the config file with 500ms debounce
- `start(callback)` — begins watching, calls back with `(changes, newConfig)` on reload
- `stop()` — stop watching, clean up watcher and timers
- `getConfig()` — returns the current (possibly hot-reloaded) config

#### 2. Pure merge function (`src/config-watcher.ts`)
- `mergeHotReload(current, fresh)` — returns `{ config, changes }`
- **Safe fields** (applied immediately): `pollIntervalMs`, `sessionDirs`, `protectedSessions`, `contextFiles`, `verbose`, `captureLinesCount`, `tuiHistoryRetentionDays`
- **Safe objects** (applied immediately): `policies`, `notifications`
- **Unsafe fields** (detected, NOT applied, user warned): `reasoner`, `dryRun`, `observe`, `confirm`, `healthPort`, `opencode.port`
- `formatConfigChange(change)` — formats a change for TUI display

#### 3. Main loop wiring (`src/index.ts`)
- `config` changed from `const` to `let` for hot-reload
- `ConfigWatcher` started before main loop, stopped during shutdown
- Callback logs applied changes as `system` entries in TUI, warns about restart-required changes
- `executor.updateConfig(newConfig)` called on reload to update protectedSessions/policies

#### 4. Executor update (`src/executor.ts`)
- New `updateConfig(newConfig)` method — hot-swaps the config reference so protectedSessions and policies take effect immediately

#### 5. Tests (`src/config-watcher.test.ts`)
- `mergeHotReload` (12 tests): identical configs, pollIntervalMs/verbose/sessionDirs/protectedSessions/policies/notifications changes (all applied), reasoner/dryRun/opencode.port changes (not applied), multiple simultaneous changes, preserves non-hot-reload fields
- `formatConfigChange` (4 tests): applied/non-applied formatting, long value truncation, object JSON formatting
- `ConfigWatcher` (4 tests): construction, getConfig returns initial, stop safe without start, stop safe multiple calls

Modified: `src/config-watcher.ts` (new), `src/config-watcher.test.ts` (new), `src/index.ts`, `src/executor.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +20, net 987 tests across 34 files.

### What shipped in v0.67.0

**Theme: "Session Drill-down"** — navigate into a specific agent's live tmux output with `/view`, return to overview with `/back`. Full-screen session output replaces the sessions panel and activity region. 13 new tests.

#### 1. View mode + state (`src/tui.ts`)
- New `viewMode: "overview" | "drilldown"` field, `drilldownSessionId`, `sessionOutputs` Map
- `enterDrilldown(sessionIdOrIndex)` — accepts 1-indexed number, session ID, ID prefix, or title (case-insensitive). Returns false if session not found.
- `exitDrilldown()` — returns to overview mode, recomputes layout, repaints
- `setSessionOutputs(outputs)` — stores full tmux output per session, called each tick
- `getViewMode()` and `getDrilldownSessionId()` — read-only accessors for testing

#### 2. Drill-down layout (`src/tui.ts`)
- `computeLayout()` — in drilldown mode: no sessions panel, separator immediately after header, maximizing content space
- `paintAll()` — branches on viewMode to paint either overview or drill-down
- `repaintDrilldownContent()` — renders last N lines of session output in scroll region (tail-follow behavior)
- `paintDrilldownSeparator()` — shows session title + `/back: overview  /view N: switch session` hints

#### 3. Drill-down header (`src/tui.ts`)
- `formatDrilldownHeader()` pure exported function — shows session dot + name + tool + status + currentTask + phase
- Used by `paintHeader()` when in drill-down mode

#### 4. Commands (`src/input.ts`)
- `/view [N|name]` — drill into session N (1-indexed) or by name/ID. Default: 1
- `/back` — return to overview from drill-down
- `onView(handler)` callback registration — TUI wires this to enterDrilldown/exitDrilldown
- `ViewHandler` type exported

#### 5. Wiring (`src/index.ts`)
- `input.onView()` handler wired — dispatches to `tui.enterDrilldown(num)` or `tui.enterDrilldown(name)`
- `tui.setSessionOutputs()` called each tick with `observation.sessions[].output`
- Drill-down repaint triggered automatically when output updates for the viewed session

#### 6. Help text updates (`src/input.ts`, `src/config.ts`)
- `/help` reorganized: new "navigation" section with /view, /back, PgUp/PgDn, Home/End
- `printHelp()` updated with /view and /back in interactive commands

#### 7. Tests
- `src/tui.test.ts` (11 tests): formatDrilldownHeader — known session, working/error/idle status, unknown session, phase display, currentTask; TUI drill-down state — starts overview, enterDrilldown returns false with no sessions, exitDrilldown no-op, setSessionOutputs safe
- `src/input.test.ts` (2 tests): onView — registers handler, safe without handler

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/index.ts`, `src/config.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +13, net 967 tests across 33 files.

### What shipped in v0.66.0

**Theme: "Prompt Queue"** — visible pending message count in the TUI prompt, `!` prefix and `/insist` command for immediate interrupt + message delivery. Improved queue acknowledgment feedback. 19 new tests.

#### 1. Pending count in TUI prompt (`src/tui.ts`)
- New `pendingCount` state field on the TUI class
- `updateState()` accepts `pendingCount` to update the display
- `paintInputLine()` now uses pure `formatPrompt()` function
- New exported `formatPrompt(phase, paused, pendingCount)` — shows `N queued >` when messages are pending, combines with phase-aware prompt (`thinking >`, `paused >`)

#### 2. Insist mode (`src/input.ts`)
- `!message` prefix triggers immediate interrupt + priority message delivery
- `/insist <message>` command as alias for `!` prefix
- `handleInsist()` method: calls `requestInterrupt()`, pushes `__CMD_INTERRUPT__` + `__INSIST__`-prefixed message
- `INSIST_PREFIX` constant exported for cross-module use

#### 3. Queue change notifications (`src/input.ts`)
- `onQueueChange(handler)` callback registration — fires on `inject()`, `drain()`, `handleLine()`, `handleInsist()`, `handleEscInterrupt()`
- `notifyQueueChange()` private method called on every queue mutation
- Queue acknowledgment on submit: shows `queued (N pending) — will be read next cycle` instead of generic "Got it!"

#### 4. Insist message handling (`src/message.ts`, `src/index.ts`)
- `isInsistMessage(msg)` — checks for `__INSIST__` prefix
- `stripInsistPrefix(msg)` — strips prefix, returns raw user text
- `INSIST_PREFIX` constant exported
- Main loop strips insist prefix before passing to reasoner, logs insist messages with `!` tag in TUI

#### 5. Wiring (`src/index.ts`)
- `input.onQueueChange()` wired to `tui.updateState({ pendingCount })` alongside scroll handler
- Insist messages processed via `isInsistMessage()` + `stripInsistPrefix()` in main loop drain

#### 6. Help text updates (`src/input.ts`, `src/config.ts`)
- `/help` updated with `!message` and `/insist <msg>` documentation
- `printHelp()` updated with `/insist` and `!message` in interactive commands section

#### 7. Tests
- `src/tui.test.ts` (6 tests): formatPrompt — no pending, with count, paused+count, thinking, thinking+count, paused beats reasoning
- `src/input.test.ts` (6 tests): onQueueChange — fires on inject, fires on drain, no fire on empty drain, safe without handler; INSIST_PREFIX — non-empty, starts with __
- `src/message.test.ts` (7 tests): isInsistMessage — prefixed/normal/command/empty; stripInsistPrefix — strips/unchanged/empty-after-prefix

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/input.test.ts`, `src/message.ts`, `src/message.test.ts`, `src/index.ts`, `src/config.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +19, net 954 tests across 33 files.

### What shipped in v0.65.0

**Theme: "Scroll Navigation"** — PgUp/PgDn/Home/End keyboard navigation in the TUI activity region. Scroll indicator in separator bar shows position, entry count, and new-while-scrolled counter. 12 new tests.

#### 1. Scroll state + methods (`src/tui.ts`)
- New `scrollOffset` and `newWhileScrolled` state fields on the TUI class
- Public methods: `scrollUp(lines?)`, `scrollDown(lines?)`, `scrollToTop()`, `scrollToBottom()`, `isScrolledBack()`
- `scrollUp/Down` default to half-page (visibleLines / 2) for comfortable browsing
- `repaintActivityRegion()` now uses `computeScrollSlice()` to render from offset instead of always showing tail
- `log()` — when scrolled back, new entries add to buffer but don't auto-scroll; increments `newWhileScrolled` counter and repaints separator

#### 2. Scroll indicator in separator (`src/tui.ts`)
- Separator shows scroll position when scrolled back: `↑ 10 older │ 40/50 │ PgUp/PgDn End=live 3 new ↓`
- Normal separator hints restored when at live (offset=0)
- Two pure exported helpers: `computeScrollSlice(bufferLen, visibleLines, scrollOffset)` and `formatScrollIndicator(offset, totalEntries, visibleLines, newCount)`

#### 3. Input handling (`src/input.ts`)
- `ScrollDirection` type exported: `"up" | "down" | "top" | "bottom"`
- `InputReader` gains `onScroll(handler)` callback
- Keypress handler detects PgUp (`pageup`/`\x1b[5~`), PgDn (`pagedown`/`\x1b[6~`), Home (`home`/`\x1b[1~`), End (`end`/`\x1b[4~`)
- `/help` updated with PgUp/PgDn/Home/End scroll hints

#### 4. Wiring (`src/index.ts`)
- `input.onScroll()` wired to `tui.scrollUp/Down/ToTop/ToBottom` before TUI start

#### 5. Tests (`src/tui.test.ts`)
- `computeScrollSlice` (6 tests): at live, scrolled back, beyond buffer, empty buffer, exact fit, partial page
- `formatScrollIndicator` (4 tests): at live, scrolled back, with new count, at top
- TUI scroll state (2 tests): initial state, scrollDown updates offset

Modified: `src/tui.ts`, `src/tui.test.ts`, `src/input.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +12, net 935 tests across 33 files.

### What shipped in v0.64.0

**Theme: "Export"** — `aoaoe export` subcommand for post-mortem timeline reports. Reads `actions.log` (JSONL) and `tui-history.jsonl`, merges into a unified chronological timeline, outputs as JSON or Markdown. 37 new tests.

#### 1. `src/export.ts` — new module with 6 pure functions
- `parseActionLogEntries(lines)` — parses action log JSONL into `TimelineEntry[]`, skips wait actions and malformed lines
- `parseActivityEntries(entries)` — converts `HistoryEntry[]` into `TimelineEntry[]`
- `mergeTimeline(...sources)` — flattens and sorts all entries chronologically
- `filterByAge(entries, maxAgeMs, now?)` — keeps entries within a time window
- `parseDuration(input)` — parses human-friendly durations ("1h", "6h", "24h", "7d") into milliseconds
- `formatTimelineJson(entries)` — pretty-printed JSON array with ISO timestamps
- `formatTimelineMarkdown(entries)` — Markdown post-mortem document with hour-grouped timeline, success/fail icons, session arrows

#### 2. CLI wiring (`src/config.ts`, `src/index.ts`)
- `parseCliArgs`: added `runExport`, `exportFormat`, `exportOutput`, `exportLast` fields
- `export` subcommand with `--format json|markdown`, `--output <file>`, `--last <duration>`
- `runTimelineExport()` handler: reads both log files, merges, filters, formats, writes to file or stdout
- `printHelp()` updated with export command and all flags

#### 3. Tests
- `src/export.test.ts` (31 tests): parseActionLogEntries (7), parseActivityEntries (4), mergeTimeline (3), filterByAge (3), parseDuration (5), formatTimelineJson (3), formatTimelineMarkdown (6)
- `src/config.test.ts` (6 tests): export subcommand, --format, -f, --output, --last, all flags combined + mutually exclusive update

New files: `src/export.ts`, `src/export.test.ts`
Modified: `src/config.ts`, `src/config.test.ts`, `src/index.ts`, `README.md`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +37, net 923 tests across 33 files.

### What shipped in v0.63.0

**Theme: "Test Isolation"** — eliminated flaky test failures caused by parallel test files racing on shared `~/.aoaoe/daemon-state.json`. All 886 tests now pass consistently (verified 3 consecutive runs, 0 failures). 4 new tests.

#### 1. `setStateDir()` function (`src/daemon-state.ts`)
New exported function that redirects all state file paths (`daemon-state.json`, `interrupt`, `daemon.lock`) to a custom directory. Converts the hardcoded `const` paths to mutable `let` variables. Resets `dirEnsured` flag so the new directory gets created on next write. `flushState()` now computes the temp file path dynamically.

#### 2. Test file isolation (`daemon-state.test.ts`, `e2e.test.ts`, `ipc.test.ts`)
Each test file now creates its own temp directory at module load time using `join(tmpdir(), \`aoaoe-<suite>-test-\${process.pid}-\${Date.now()}\`)` and calls `setStateDir()` before any tests run. Temp dirs are cleaned up in `after()` hooks. Zero cross-file state contamination.

#### 3. Tests for `setStateDir` (`src/daemon-state.test.ts`)
- 3 tests: redirects state file, redirects interrupt file, redirects lock file — each verifies files land in the custom directory and not `~/.aoaoe/`
- 1 cleanup test (temp dir removal in `after()` hook)

Modified: `src/daemon-state.ts`, `src/daemon-state.test.ts`, `src/e2e.test.ts`, `src/ipc.test.ts`, `package.json`, `AGENTS.md`, `Makefile`, `claude.md`
Test changes: +4 (3 setStateDir + 1 cleanup), net 886 tests across 32 files.

### What shipped in v0.62.0

**Theme: "History Retention"** — configurable retention period for TUI history entries, age-based filtering on startup replay, and bumped rotation threshold from 500KB to 50MB. 8 new tests.

#### 1. Rotation threshold bump (`src/tui-history.ts`)
Changed `MAX_FILE_SIZE` from 500KB to 50MB. Modern SSDs have terabytes of space — 500KB was unnecessarily aggressive and caused frequent rotations for active users.

#### 2. Age-based filtering in `loadTuiHistory()` (`src/tui-history.ts`)
New `maxAgeMs` parameter (default: 7 days). Entries older than `Date.now() - maxAgeMs` are filtered out during load. Reads extra lines (`maxEntries * 2`) as a buffer to compensate for filtered entries, then slices to `maxEntries` after filtering.

#### 3. `tuiHistoryRetentionDays` config field (`src/types.ts`, `src/config.ts`)
New optional field on `AoaoeConfig` — positive integer, range 1-365, defaults to 7 when undefined. Added to `KNOWN_KEYS`, config validation, `printHelp()` example config, and README config reference table.

#### 4. Startup replay wiring (`src/index.ts`)
`main()` reads `config.tuiHistoryRetentionDays ?? 7`, converts to milliseconds, and passes to `loadTuiHistory()` so only recent entries are replayed into the TUI buffer.

#### 5. Tests
- `src/config.test.ts` (5 tests): tuiHistoryRetentionDays validation — valid integer, undefined, out of range, non-integer, non-number
- `src/tui-history.test.ts` (3 tests): age filtering — filters old entries, returns empty when all expired, respects both maxEntries and maxAgeMs

Modified: `src/tui-history.ts`, `src/tui-history.test.ts`, `src/types.ts`, `src/config.ts`, `src/config.test.ts`, `src/index.ts`, `package.json`, `AGENTS.md`, `Makefile`, `README.md`, `claude.md`
Test changes: +8, net 882 tests across 32 files.

### What shipped in v0.61.0

**Theme: "Persisted TUI History"** — TUI activity entries now survive daemon restarts. JSONL file at `~/.aoaoe/tui-history.jsonl` with 500KB rotation. Previous activity replays into the TUI buffer on startup. 17 new tests.

#### 1. `tui-history.ts` — new persistence module
Three pure exported functions for testability:
- `appendHistoryEntry(entry, filePath?, maxSize?)` — fire-and-forget JSONL append on each `tui.log()` call. Creates parent dir if missing, rotates file at threshold, never throws.
- `loadTuiHistory(maxEntries?, filePath?)` — reads last N entries (default 200) from JSONL file. Skips malformed lines and validates entry shape. Returns `[]` on missing/unreadable file.
- `rotateTuiHistory(filePath?, maxSize?)` — renames current file to `.old` when it exceeds 500KB. Old file is overwritten on subsequent rotations.

`HistoryEntry` extends `ActivityEntry` with `ts: number` (epoch ms) for time-based filtering.

#### 2. TUI integration (`src/tui.ts`)
- `TUI.log()` now calls `appendHistoryEntry()` after adding to the in-memory buffer. Fire-and-forget — never blocks rendering.
- New `TUI.replayHistory(entries)` method populates the activity buffer from persisted entries before `start()` is called.

#### 3. Startup replay (`src/index.ts`)
Before entering the alternate screen, `main()` calls `loadTuiHistory()` and feeds results to `tui.replayHistory()`. Users see their previous session's activity immediately.

#### 4. Tests (`src/tui-history.test.ts`)
- `appendHistoryEntry` (5 tests): creates file, appends multiple lines, creates parent dirs, fire-and-forget on error, rotation on exceed
- `loadTuiHistory` (6 tests): missing file, empty file, load entries, maxEntries cap, malformed line skip, missing field skip, trailing newlines
- `rotateTuiHistory` (4 tests): missing file, under threshold, exceeds threshold, overwrites existing .old
- `TUI.replayHistory` (1 test): populates buffer from history entries
- 1 cleanup test entry via TUI.log after replay

New files: `src/tui-history.ts`, `src/tui-history.test.ts`
Modified: `src/tui.ts`, `src/index.ts`, `package.json`, `Makefile`, `AGENTS.md`, `claude.md`, `README.md`
Test changes: +17, net 874 tests across 32 files.

### What shipped in v0.60.0

**Theme: "Notification Retry"** — exponential backoff for failed webhook deliveries, configurable via `notifications.maxRetries`. 10 new tests.

#### 1. `fetchWithRetry()` helper (`src/notify.ts`)
New exported function that wraps `fetch` with retry logic:
- `maxRetries=0` (default) = single attempt, no retry (preserves existing behavior)
- On failure (network error or non-2xx response), waits `baseDelay * 2^attempt` ms before retrying
- Default base delay: 1000ms → backoff sequence: 1s, 2s, 4s, 8s, ...
- Returns the last Response on non-ok status after exhausting retries (doesn't throw for HTTP errors)
- Throws the last error on network failures after exhausting retries

#### 2. Retry wired into notification dispatch (`src/notify.ts`)
`sendGenericWebhook()` and `sendSlackWebhook()` now accept `maxRetries` parameter, passed through from `config.notifications.maxRetries`. Fire-and-forget semantics preserved — retries happen in-band but `sendNotification()` still uses `Promise.allSettled()`.

#### 3. Config + validation (`src/types.ts`, `src/config.ts`)
- Added `maxRetries?: number` to `notifications` config block
- Added `maxRetries` to `KNOWN_KEYS` notifications sub-keys
- Validation: must be a non-negative integer (rejects negative, float, non-number)
- Updated `printHelp()` example config + explanation
- Not in `DEFAULTS` — `undefined` means 0 retries (backward compatible)

#### 4. Tests
- `src/notify.test.ts` (5 tests): fetchWithRetry — succeeds first attempt, throws on failure with maxRetries=0, retries and eventually succeeds, gives up after maxRetries exhausted, retries network errors
- `src/config.test.ts` (5 tests): notifications.maxRetries validation — valid integer, zero, negative, non-integer, non-number

### What shipped in v0.59.0

**Theme: "Health Check"** — opt-in HTTP health endpoint for daemon monitoring, plus deepMerge refactor. 18 new tests.

#### 1. HTTP health check server (`src/health.ts`, `src/index.ts`)
New `startHealthServer(port, startedAt)` function creates a lightweight HTTP server on `127.0.0.1:port`. Responds to `GET /health` (and `GET /` as alias) with JSON containing:
- `status`: "ok" or "error" (error when daemon state file missing)
- `version`: from package.json
- `uptimeMs`: time since daemon started
- `daemon`: phase, pollCount, pollIntervalMs, sessionCount, changeCount, paused, sessions array (title, tool, status, currentTask, userActive)
Returns 404 for unknown paths. Server starts after TUI setup, closes in shutdown handler.

#### 2. `buildHealthResponse()` pure function (`src/health.ts`)
Exported for testing — takes `DaemonState | null`, `startedAt`, and optional `now`, returns typed `HealthResponse`. Reads daemon state from the IPC state file and formats session info.

#### 3. Config + CLI (`src/types.ts`, `src/config.ts`)
- Added `healthPort?: number` optional field to `AoaoeConfig`
- Added `healthPort: true` to `KNOWN_KEYS` for unknown-key warnings
- Added validation: must be 1-65535, finite number
- Added `--health-port <number>` CLI flag with NaN-on-parse check
- Updated `printHelp()` with flag and example config
- Not in `DEFAULTS` — opt-in only (undefined by default = no health server)

#### 4. deepMerge refactor (`src/config.ts`)
Extracted internal `mergeRecords()` function that operates on `Record<string, unknown>` with proper typeof guards. Reduced `as` casts inside deepMerge from 5 to 2 (one recursive `as Record<string, unknown>` with typeof guard, one return cast). The call-site double cast (`DEFAULTS as unknown as Record<string, unknown>`) is unavoidable due to TypeScript structural typing.

#### 5. Tests
- `src/health.test.ts` (11 tests): buildHealthResponse (8 — ok status, null state/error, session details, phase, paused, uptime calc, version string, empty sessions), startHealthServer integration (3 — GET /health, GET / alias, 404 unknown path)
- `src/config.test.ts` (7 tests): healthPort validation (5 — valid, undefined, out of range, NaN, non-number), parseCliArgs --health-port (2 — valid, NaN throws)

### What shipped in v0.58.0

**Theme: "End-to-end Testing"** — mock-based integration tests that validate the full daemon→IPC→chat pipeline without real processes, tmux, or LLMs. 16 new tests.

#### 1. `src/e2e.test.ts` — new test file (16 tests)
Wires together three modules: `tick()` from `loop.ts` (with MockPoller/MockReasoner/MockExecutor), `writeState()`/`buildSessionStates()` from `daemon-state.ts`, and chat state readers from `chat.ts` (`isDaemonRunningFromState`, `buildStatusLineFromState`, `formatSessionsList`, `getCountdownFromState`).

Test scenarios:
- Single tick with action → chat sees running daemon with sessions
- Wait-only response → no execution, daemon still visible
- Multi-tick sequence → chat tracks poll count and phase transitions
- Multiple sessions → chat sees all agents
- Dry-run mode → planned actions returned but not executed
- User message forces reasoning without changes
- Confirm mode → beforeExecute filters actions
- Session with currentTask → shows in formatSessionsList
- Error session triggers policy alert → reasoning forced
- Daemon goes offline → chat detects stale state
- Reasoning phase → chat status shows elapsed time
- No sessions → tick skips, daemon state reflects empty
- Cleanup removes state → chat reads null
- Paused daemon → PAUSED in status
- Title-mode status line → compact format
- Full lifecycle: tick → execute → sleep → stale → gone

#### 2. `simulateDaemonStateWrite()` helper
Replicates the IPC write path that `daemonTick()` in `index.ts` performs after each tick: `resetInternalState()` (to clear writeState debounce), `buildSessionStates(obs)`, `writeState(phase, updates)`. This avoids needing to export or test the real `daemonTick()` which has UI, console, and TUI dependencies.

### What shipped in v0.57.0

**Theme: "Logs"** — `aoaoe logs` subcommand for viewing and searching conversation and action logs from the CLI. 17 new tests.

#### 1. `aoaoe logs` subcommand (`src/index.ts`, `src/config.ts`)
New `showLogs()` function with two modes:
- **Conversation log** (default): reads `~/.aoaoe/conversation.log`, colorizes output using `colorizeConsoleLine()`, shows last N entries
- **Action log** (`--actions`/`-a`): reads `~/.aoaoe/actions.log` (JSONL), parses with `toActionLogEntry()`, shows formatted entries with timestamps, success/fail icons, action types, session IDs

#### 2. Log filtering (`src/console.ts`)
New `filterLogLines()` pure function that filters log lines by pattern:
- Tries pattern as regex first (case-insensitive)
- Falls back to plain substring match if regex is invalid (e.g. `[+` which is invalid regex but valid as a substring search for action tags)
- Applied before slicing to `-n` count, so grep + count work together

#### 3. CLI options (`src/config.ts`)
- `--actions`/`-a`: show action log instead of conversation log
- `--grep`/`-g <pattern>`: filter entries by substring or regex
- `-n`/`--count <count>`: number of entries to show (default: 50, ignores invalid/zero values)

#### 4. CLI parser (`src/config.ts`)
- `parseCliArgs`: added `runLogs: boolean`, `logsActions: boolean`, `logsGrep?: string`, `logsCount?: number` fields
- `printHelp()`: added `logs` to commands list with all options
- README: added `logs` to CLI commands section

#### 5. Tests (`src/config.test.ts`)
- 10 `parseCliArgs` tests: `logs` subcommand, `--actions`, `-a`, `--grep`, `-g`, `-n`, `--count`, all flags combined, invalid count, zero count, mutually exclusive update
- 7 `filterLogLines` tests: plain substring, regex pattern, match-all, match-none, invalid regex fallback, empty array, case-insensitive

### What shipped in v0.56.0

**Theme: "Doctor"** — comprehensive health check command covering config, tools, daemon, disk, and sessions. 1 new test.

#### 1. `aoaoe doctor` subcommand (`src/index.ts`, `src/config.ts`)
New `runDoctorCheck()` function that performs 6 categories of diagnostics:
- **Config**: file existence + validation (parses and runs `validateConfig`)
- **Tools**: checks aoe, tmux, node, and selected reasoner CLI on PATH with version output
- **Reasoner**: probes `opencode serve` HTTP health endpoint (port check with 3s timeout)
- **Daemon**: reads IPC state file to check if daemon is running, detects stale lock files
- **Data**: `~/.aoaoe/` directory stats (file count, disk usage), actions.log entry count
- **Sessions**: runs `aoe list --json` to show available sessions
Reports colored pass/fail/warning per check with summary count.

#### 2. CLI parser + docs (`src/config.ts`, `README.md`)
- `parseCliArgs`: added `runDoctor: boolean` field, `doctor` subcommand dispatch
- `printHelp()`: added `doctor` to commands list
- README: added `doctor` to CLI commands section

#### 3. Tests (`src/config.test.ts`)
- `parseCliArgs` test for `doctor` subcommand + mutually exclusive assertion update

### What shipped in v0.55.0

**Theme: "Status Enhancements"** — config diff display, last action in status, improved diagnostic commands. 10 new tests.

#### 1. `aoaoe config --diff` (`src/config.ts`, `src/index.ts`)
New `computeConfigDiff()` function that recursively compares the effective config against defaults, returning dot-notation paths for each difference. `showConfigDiff()` displays results with color-coded current vs. default values. Exported `DEFAULTS` from config.ts for reuse.

#### 2. `aoaoe status` — last action display (`src/index.ts`)
`showDaemonStatus()` now reads the last non-wait action from `actions.log` and shows it with time ago (seconds/minutes/hours), success/fail icon, action type, session, and detail. Uses `toActionLogEntry` for safe parsing.

#### 3. CLI + docs updates (`src/config.ts`, `README.md`)
- `parseCliArgs`: added `configDiff: boolean` field, `--diff` flag parsed when `argv[2] === "config"`
- `printHelp()`: added `config --diff` to commands list
- README: added `config --diff` to CLI commands section

#### 4. Tests (`src/config.test.ts`)
- 2 `parseCliArgs` tests: `config --diff`, `config` without --diff
- 8 `computeConfigDiff` tests: identical objects, changed primitives, new fields, removed fields, nested recursion with dot-notation, array comparison, deeply identical nested, mixed changed/unchanged

### What shipped in v0.54.0

**Theme: "Config Validation"** — standalone config validation command, runtime-safe action log parsing, documentation. 12 new tests.

#### 1. `aoaoe config --validate` / `config -V` (`src/index.ts`, `src/config.ts`)
New `runConfigValidation()` function that performs 5 categories of checks:
- Config file existence (found vs. using defaults)
- Config field validation (all values pass `validateConfig()`)
- Tool availability (aoe, tmux, and selected reasoner on PATH)
- Notifications configuration status (configured, missing URLs, or optional/not set)
- sessionDirs validation (each mapped directory exists on disk)
Reports colored pass/fail/warning per check with summary. Non-zero exit on failure.

#### 2. `toActionLogEntry` runtime validator (`src/types.ts`)
Replaces unsafe `JSON.parse() as { ... }` casts in `showActionHistory()` with a proper runtime validator. Returns `ActionLogEntry | null`, coerces missing `detail` to empty string, drops non-string optional fields. Exported `ActionLogEntry` interface.

#### 3. CLI + docs updates (`src/config.ts`, `README.md`)
- `parseCliArgs`: added `configValidate: boolean` field, `--validate`/`-V` flags parsed when `argv[2] === "config"`
- `printHelp()`: added `config --validate` to commands list
- README: added `config --validate` to CLI commands section

#### 4. Tests (`src/config.test.ts`)
- 3 `parseCliArgs` tests: `config --validate`, `config -V`, `config` without --validate
- 9 `toActionLogEntry` tests: valid entry, title field, null/undefined/primitives, missing timestamp, missing action, non-string action.action, non-boolean success, missing detail coercion, non-string optional field drops

### What shipped in v0.53.0

**Theme: "Notification UX"** — `aoaoe notify-test` subcommand, notification rate limiting, documentation, init scaffolding. 11 new tests.

#### 1. `aoaoe notify-test` subcommand (`src/index.ts`, `src/config.ts`)
New `runNotifyTest()` function that loads config, checks for notification configuration, calls `sendTestNotification()`, and reports per-webhook success/failure with colored output. CLI parser updated with `notifyTest: boolean` field and `notify-test` subcommand dispatch.

#### 2. Notification rate limiting (`src/notify.ts`)
60s dedup window per `event:session` combo to prevent spam during rapid error/recovery cycles. Map-based with 200-entry prune. `isRateLimited()` (read-only check), `recordSent()`, `resetRateLimiter()` (exported for testing). `sendNotification()` now checks rate limiter before dispatching.

#### 3. `sendTestNotification()` (`src/notify.ts`)
Unlike fire-and-forget `sendNotification()`, this returns `{ webhookOk?, slackOk?, webhookError?, slackError? }` so the CLI can report detailed delivery results. 10s timeout per webhook.

#### 4. Help text + README updates (`src/config.ts`, `README.md`)
- `printHelp()`: added `notify-test` to commands list, added notifications config example with explanatory text
- README: added `notify-test` and `status`/`config` to CLI commands, added `notifications.*` to config reference table, added notifications block to example config, added "Notifications" subsection with usage docs, added `notify.ts` to project structure

#### 5. Init scaffolding (`src/init.ts`)
`aoaoe init` now prints a tip about adding notifications config after writing the config file.

#### 6. Tests (`src/notify.test.ts`, `src/config.test.ts`)
- 5 `isRateLimited` tests: first call, read-only check, independence, reset, rate-limit-after-send
- 5 `sendTestNotification` tests: no config, no URLs, unreachable webhook, unreachable Slack, both configured
- 1 `parseCliArgs` test: `notify-test` subcommand parsing + mutually exclusive assertion update

### What shipped in v0.52.0

**Theme: "Notifications"** — webhook + Slack notification system for significant daemon events. Fire-and-forget, never blocks the daemon.

#### 1. Notification module (`src/notify.ts`)
New `sendNotification(config, payload)` function that fires notifications to configured webhooks.
Supports two webhook types:
- **Generic webhook**: POST JSON `{ event, timestamp, session, detail }` to any URL
- **Slack webhook**: POST Slack block kit format with event icons, session names, and timestamps
Both are fire-and-forget with 5s timeout — notification failures are logged but never crash the daemon.
Event filtering via `config.notifications.events` array (default: send all events).

#### 2. Notification events wired into daemon lifecycle (`src/index.ts`)
Six event types fire at key moments:
- `daemon_started` — after startup banner, before entering main loop
- `daemon_stopped` — in shutdown handler, before cleanup
- `session_error` — when a session transitions to error status (fires for both TUI and non-TUI)
- `session_done` — when a session transitions to done status
- `action_executed` — after each successful action execution
- `action_failed` — after each failed action execution

#### 3. Config schema + validation (`src/config.ts`, `src/types.ts`)
- Added `notifications?: { webhookUrl?, slackWebhookUrl?, events?: NotificationEvent[] }` to `AoaoeConfig`
- Added `NotificationEvent` type union: `"session_error" | "session_done" | "action_executed" | "action_failed" | "daemon_started" | "daemon_stopped"`
- Added `notifications` to `KNOWN_KEYS` schema with sub-keys `webhookUrl`, `slackWebhookUrl`, `events`
- Validation: webhook URLs must be strings starting with `http://` or `https://`, events must be valid `NotificationEvent` values
- Entirely optional — no existing configs need updating

#### 4. Slack message formatting (`src/notify.ts`)
`formatSlackPayload()` generates Slack block kit messages with:
- Event-specific emoji icons (🚨 error, ✅ done, ⚙️ executed, ❌ failed, 🚀 started, 🛑 stopped)
- Bold event titles, session names, detail text
- Context block with "aoaoe" branding and ISO timestamp
- Fallback `text` field for clients that don't support blocks

#### 5. Tests (`src/notify.test.ts`, `src/config.test.ts`)
- 16 new tests in `src/notify.test.ts`: formatSlackPayload (8), sendNotification (8)
- 10 new tests in `src/config.test.ts`: notifications validation (8), warnUnknownKeys notifications (2)

Config additions:
- `notifications?: { webhookUrl?, slackWebhookUrl?, events?: NotificationEvent[] }` (optional)

New files: `src/notify.ts`, `src/notify.test.ts`
Modified: `src/types.ts`, `src/config.ts`, `src/config.test.ts`, `src/index.ts`,
`package.json`, `Makefile`, `AGENTS.md`, `claude.md`
Test changes: +26 (16 notify, 10 config), net 762 tests.

### What shipped in v0.51.0

**Theme: "Diagnostics"** — quick health checks without starting the daemon, plus error visibility for silent failures.

#### 1. `aoaoe status` command (`src/index.ts`, `src/config.ts`)
One-shot daemon health check that reads `~/.aoaoe/daemon-state.json` and prints:
- Whether the daemon is running or not (reuses `isDaemonRunningFromState` from chat.ts)
- Current phase (sleeping/polling/reasoning/executing) with elapsed time
- Poll count, poll interval, countdown to next tick
- Session list with status icons, tool names, user-active flags, and current tasks
- Config file location
- Helpful hints (start commands) when daemon is offline

#### 2. `aoaoe config` command (`src/index.ts`, `src/config.ts`)
Shows the effective resolved config after merging defaults + config file. Outputs:
- Source file path (or "defaults" if no config found)
- Full JSON config with 2-space indentation
- Hint to run `aoaoe init` if no config file exists

#### 3. Empty catch logging — 15 silent catches replaced (`6 files`)
Replaced the highest-impact empty catch blocks with `console.error` logging. These were
swallowing JSON parse failures, session data errors, and I/O failures that made debugging
impossible. Fixed catches in:
- `poller.ts` (3): session list parse, session status parse, session show parse
- `chat.ts` (4): conversation log read, tmux capture, pending-input write, log replay
- `executor.ts` (2): create_agent path validation, action log write
- `init.ts` (2): session list parse, session status parse
- `console.ts` (2): pending-input size check, conversation log write
- `context.ts` (2): context file read, inode de-dup stat

Skipped legitimate best-effort catches (file deletion, mkdir, lock files, port probing,
process signal checks, JSON parse fallthrough in reasoner).

#### 4. CLI parser updates (`src/config.ts`)
Added `status` and `config` to `parseCliArgs` subcommand dispatch, help text, and return type.

Config additions: none.
Modified: `src/index.ts`, `src/config.ts`, `src/config.test.ts`, `src/poller.ts`, `src/chat.ts`,
`src/executor.ts`, `src/init.ts`, `src/console.ts`, `src/context.ts`, `package.json`, `Makefile`,
`AGENTS.md`, `claude.md`
Test changes: +2 (status subcommand, config subcommand), net 736 tests.

### What shipped in v0.50.0

**Theme: "Config Hardening"** — catch typos in config files at startup, show which config file is loaded.

#### 1. Unknown config key warnings (`src/config.ts`)
New `warnUnknownKeys(raw, source)` function that checks config file keys against a `KNOWN_KEYS`
schema. Validates both top-level keys (reasoner, pollIntervalMs, verbose, etc.) and nested keys
(opencode.port, policies.maxErrorsBeforeRestart, etc.). Warns on stderr with the key name and
source file path so users can spot typos immediately. Called automatically by `loadConfig()` before
merging. Non-object input is a safe no-op.

#### 2. Config path in startup banner (`src/index.ts`)
`loadConfig()` now returns `{ ...config, _configPath?: string }` so the caller knows which config
file was loaded (or that defaults are being used). The startup banner displays this in both TUI
and non-TUI modes:
- Non-TUI: `  config: ~/.aoaoe/aoaoe.config.json` or `  config: defaults (no config file found)`
- TUI: `config: ~/.aoaoe/aoaoe.config.json` in the welcome system log

#### 3. `warnUnknownKeys` tests (`src/config.test.ts`)
9 new tests: valid keys produce no warnings, unknown top-level key warns, multiple unknown keys,
valid nested keys, unknown nested key (opencode), unknown nested key (policies), non-object input
is no-op, non-object nested value skips nested check, source path included in warning message.

Config additions: none (internal type extension only — `_configPath` on loadConfig return).
Modified: `src/config.ts`, `src/index.ts`, `src/config.test.ts`, `package.json`, `Makefile`,
`AGENTS.md`, `claude.md`
Test changes: +9 (warnUnknownKeys), net 734 tests.

### What shipped in v0.49.0

**Theme: "Test Coverage"** — fill gaps in existing test suites. Covers `formatTaskContext`, `setSessionTask`, `acquireLock`, `Executor` class (destructive gate, protected sessions, user-active guard, rate limiting, session resolution), `VALID_TOOLS` set.

#### 1. `formatTaskContext` tests (`src/reasoner/prompt.test.ts`)
11 new tests for the task context formatter that tells the reasoner what each session is working on.
Covers: empty tasks, header, session title/repo, goal line, status tags (ACTIVE/COMPLETED/PENDING),
progress entries (last 3 shown), time-ago formatting, multiple tasks, instruction lines.

#### 2. `setSessionTask` tests (`src/daemon-state.test.ts`)
2 new tests: stores task text and surfaces it via `buildSessionStates()`, truncates text longer than
80 chars with ellipsis.

#### 3. `acquireLock` tests (`src/daemon-state.test.ts`)
2 new tests: acquires lock when none exists, fails when lock is already held by the current process
(returns `existingPid`).

#### 4. `VALID_TOOLS` tests (`src/executor.test.ts`)
3 new tests: contains expected tool names (opencode, claude-code, cursor, aider), rejects invalid
names, has at least 5 entries.

#### 5. `Executor` class tests (`src/executor.test.ts`)
9 new tests: constructor, wait action success, destructive action blocking (remove_agent,
stop_session), protected session blocking (with case-insensitive matching), user-active send_input
blocking, getRecentLog, session resolution by title.

Config additions: none.
Modified: `src/reasoner/prompt.test.ts`, `src/daemon-state.test.ts`, `src/executor.test.ts`,
`package.json`, `Makefile`, `AGENTS.md`, `claude.md`
Test changes: +27 (11 formatTaskContext, 2 setSessionTask, 2 acquireLock, 3 VALID_TOOLS,
9 Executor), net 725 tests.

### What shipped in v0.48.0

**Theme: "Type Safety"** — runtime validators for untyped JSON, non-null assertion removal, dead export cleanup. Eliminates the highest-risk `as` casts that could silently propagate corrupt data.

#### 1. `toTaskState` validator (`src/types.ts`, `src/task-manager.ts`)
Added `toTaskState(raw)` function that validates arbitrary values from `JSON.parse` against the
`TaskState` interface. Checks all required fields (repo, sessionTitle, tool, goal, status, progress)
with correct types. Validates `status` against the `TaskStatus` union. Filters invalid `progress`
entries. Returns `null` for invalid input instead of silently casting. Applied to `loadTaskState()`.
10 new tests.

#### 2. `toDaemonState` validator (`src/types.ts`, `src/daemon-state.ts`)
Added `toDaemonState(raw)` function that validates the daemon state JSON file against the
`DaemonState` interface. Checks all 10 required fields with correct types. Returns `null` for
corrupt files instead of returning garbage via `as DaemonState`. Applied to `readState()`.
3 new tests.

#### 3. `toAoeSessionList` validator (`src/types.ts`, `src/task-manager.ts`, `src/task-cli.ts`)
Added `toAoeSessionList(raw)` function that validates `aoe list --json` output. Filters array
entries to only those with string `id` and `title` fields. Returns empty array for non-array input.
Applied to `task-manager.ts` session refresh and `task-cli.ts` `taskNew()`. Also added Array.isArray
guard in `init.ts` `discoverSessions()`. 3 new tests.

#### 4. `toReasonerBackend` validator (`src/types.ts`, `src/config.ts`)
Added `toReasonerBackend(raw)` function that validates `--reasoner` CLI arg against the
`ReasonerBackend` union type. Throws a descriptive error for invalid values (e.g.
`--reasoner must be "opencode" or "claude-code", got "gpt-4"`). Previously `as ReasonerBackend`
silently accepted any string. 2 new tests + 1 parseCliArgs integration test.

#### 5. Non-null assertion removal (5 files)
- `index.ts:443`: `reasoner!`/`executor!` → explicit null guard + throw (inside observe-mode else block)
- `reasoner/opencode.ts:93`: `this.client!` → explicit null guard + throw (caller already checks truthy)
- `reasoner/opencode.ts:313`: `p.text!` → `p.text ?? ""` (filter already ensures truthy)
- `reasoner/prompt.ts:180`: `snap.projectContext!` → `snap.projectContext ?? ""` (filter ensures truthy but safer)
- `task-manager.ts:148`: `this.states.get(def.repo)!` → null-safe `if (existing)` guard

#### 6. Dead export cleanup (`src/colors.ts`)
Removed 4 unused exports: `ITALIC`, `BG_DARKER`, `BG_PANEL`, `BG_HIGHLIGHT`. All were defined in
v0.47.0 but never imported by any source file.

#### 7. Unused catch variable (`src/prompt-watcher.ts`)
Changed `catch(e) {}` to `catch {}` — `e` was captured but never used.

Config additions: none.
Modified: `src/types.ts`, `src/task-manager.ts`, `src/daemon-state.ts`, `src/config.ts`,
`src/config.test.ts`, `src/task-cli.ts`, `src/init.ts`, `src/index.ts`, `src/reasoner/opencode.ts`,
`src/reasoner/prompt.ts`, `src/colors.ts`, `src/prompt-watcher.ts`, `package.json`, `Makefile`,
`AGENTS.md`, `claude.md`
Test changes: +17 (10 toTaskState, 3 toDaemonState, 3 toAoeSessionList, 2 toReasonerBackend,
1 --reasoner invalid value), net 698 tests.

### What shipped in v0.47.0

**Theme: "UI Polish"** — OpenCode-inspired block-style TUI overhaul. Visual hierarchy, tasteful 256-color palette, animated phase indicators.

#### 1. Expanded color palette (`src/colors.ts`)
Added 256-color ANSI accents: INDIGO (branding), TEAL (info), AMBER (warnings/active),
SLATE (secondary text), ROSE (errors), LIME (success), SKY (reasoning). Background variants:
BG_DARKER, BG_PANEL, BG_HIGHLIGHT. Box-drawing character set (BOX.tl/tr/bl/br/h/v + rounded
variants rtl/rtr/rbl/rbr). Braille spinner frames (SPINNER). Status dots (DOT.filled/hollow/half).
Also added ITALIC.

#### 2. Box-drawn session panel (`src/tui.ts` paintSessions)
Sessions are now rendered inside a rounded-corner box with `╭─╮│╰─╯` borders.
Each session is a "card" line: status dot (●/○/◐) + bold name + tool badge + separator
+ status description. Empty state shows "no agents connected" inside the box.
Right border character is auto-padded to align with terminal width.

#### 3. Phase spinner animation (`src/tui.ts`)
Active phases (reasoning, executing, polling) now show a braille dot spinner
(`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) that animates at 4fps via the 250ms timer. Sleeping phase has no
spinner. Paused shows bold amber "PAUSED". Interrupted shows bold rose "interrupted".
`phaseDisplay()` is exported and tested independently.

#### 4. Improved header bar (`src/tui.ts` paintHeader)
Brand name uses INDIGO bold. Version in SLATE. Separator pipes are SLATE instead of DIM.
Reasoner name badge in TEAL. Session count says "agents" instead of "sessions". Countdown
in SLATE. Full-width background fill with BG_DARK via `padToWidth()`.

#### 5. Improved activity panel (`src/tui.ts` formatActivity)
Action tags now use arrow prefix (`→ action`) instead of plus. Error tags use cross mark
(`✗ error`). Pipe separator (`│`) between tag and text for cleaner visual. All tags use
the new 256-color palette (SKY for reasoner, AMBER for actions, ROSE for errors, LIME for
user, SLATE for system/status/observation).

#### 6. Phase-aware input prompt (`src/tui.ts` paintInputLine)
Input prompt changes based on phase: `>` (lime) during normal operation, `thinking >`
(sky) during reasoning, `paused >` (amber bold) when paused. Minimal but informative.

#### 7. New exported helpers (`src/tui.ts`)
`formatSessionCard()`, `padBoxLine()`, `padToWidth()`, `stripAnsiForLen()`, `phaseDisplay()`
are all exported pure functions with full test coverage.

#### 8. Comprehensive TUI tests (`src/tui.test.ts`)
26 new tests: `stripAnsiForLen` (4), `padToWidth` (3), `padBoxLine` (2), `phaseDisplay` (7),
`formatSessionCard` (8), plus updated tests for `formatActivity` and `formatSessionSentence`
to verify new formatting (dots, separators, tag prefixes).

Config additions: none.
Modified: `src/colors.ts`, `src/tui.ts`, `src/tui.test.ts`, `package.json`, `Makefile`,
`AGENTS.md`, `claude.md`
Test changes: +26, net 681 tests.

### What shipped in v0.46.0

**Theme: "Correctness & Hygiene"** — audit-driven fixes: type safety, config validation, dead code, silent failures.

#### 1. Fix README action schema bug (`README.md`)
`report_progress` and `complete_task` actions showed `"repo"` field but the actual code uses
`"session"`. Anyone reading the docs would build the wrong JSON. Fixed to match `types.ts`.

#### 2. Type-safe session status validation (`src/types.ts`, `src/poller.ts`, `src/init.ts`)
Added `toSessionStatus(raw)` function that validates arbitrary CLI output strings against the
`AoeSessionStatus` union type. Returns `"unknown"` for any unrecognized value instead of using
`as AoeSessionStatus` casts that could propagate garbage values. Applied to both `poller.ts`
`getSessionStatus()` and `init.ts` `getSessionStatus()`. 4 new tests.

#### 3. Config validation for 6 fields (`src/config.ts`)
`validateConfig()` now checks types for fields that could cause subtle runtime bugs:
- `claudeCode.yolo` must be boolean (string `"false"` is truthy — would enable YOLO mode)
- `claudeCode.resume` must be boolean (same issue)
- `aoe.profile` must be non-empty string (empty string breaks aoe CLI calls)
- `policies.autoAnswerPermissions` must be boolean
- `policies.userActivityThresholdMs` must be number >= 0
- `policies.allowDestructive` must be boolean (string `"false"` truthy → enables destructive)
12 new tests covering accept/reject cases.

#### 4. Fix silent catches in task-manager.ts (`src/task-manager.ts`)
Two `catch {}` blocks at lines 185 and 224 silently swallowed JSON parse errors during session
reconciliation. If `aoe list --json` returned malformed output, all task-session linking would
fail silently. Now logs errors to stderr.

#### 5. Fix non-null assertion in chat.ts (`src/chat.ts`)
`checkDaemon()` called `readState()!` assuming the state file exists because `isDaemonRunning()`
returned true. But the state could become null between the two calls (race). Now captures the
return value and returns early if null.

#### 6. Dead code removal (`src/colors.ts`, `src/poller.ts`)
- Removed unused `MAGENTA` export from `colors.ts` — not imported anywhere.
- Removed orphaned `// eslint-disable-next-line no-control-regex` comment in `poller.ts` —
  ESLint is not a project dependency.

Config additions: none (validation only, no new fields).
Modified: `README.md`, `src/types.ts`, `src/poller.ts`, `src/init.ts`, `src/config.ts`,
`src/config.test.ts`, `src/task-manager.ts`, `src/chat.ts`, `src/colors.ts`, `package.json`,
`Makefile`, `AGENTS.md`, `claude.md`
Test changes: +16 (12 config validation, 4 toSessionStatus), net 655 tests.

### What shipped in v0.45.0

**Theme: "Packaging & Coverage"** — npm package hygiene, CI safety net, and critical untested code gets covered.

#### 1. Fix `package.json` `files` field (`package.json`)
Changed from `"dist"` to specific globs (`dist/**/*.js`, `dist/**/*.d.ts`) with exclusions
for test files and integration-test. npm package went from 219 files (~6MB of test code) to
59 files (88KB). Zero test files ship to users.

#### 2. Remove dead `.npmignore` (`.npmignore`)
When `files` field exists in `package.json`, `.npmignore` is largely ignored by npm. Deleted
entirely — one less file to confuse contributors.

#### 3. Add `npm test` to release CI (`.github/workflows/release.yml`)
The `publish-npm` job previously ran only `npm run build` before `npm publish`. Now runs
`npm test` (which includes build) before publishing. Prevents shipping a package that
compiles but has broken behavior.

#### 4. Create `src/reasoner/parse.test.ts` (41 tests)
`parse.ts` is the core JSON parsing module — both reasoner backends depend on it. Previously
had no direct test file (partially tested via `opencode.test.ts` re-exports).
- `validateResult` (22 tests): shape validation (undefined, numeric, array input),
  per-action field checks for all 8 action types (start_session, stop_session, remove_agent,
  create_agent, send_input, wait, report_progress, complete_task), empty string rejection,
  mixed valid/invalid action ordering.
- `parseReasonerResponse` (7 tests): leading/trailing newlines, markdown with language tag,
  fallback to brace scanner on bad code block, empty actions, missing actions field,
  mixed valid/invalid in fenced JSON, full multi-action response.
- `extractFirstValidJson` (12 tests): empty string, only closing/opening braces, object at
  start/end, malformed-then-valid, escaped braces in strings, nested arrays, empty object,
  deeply nested, stray closing brace reset, quote at depth 0.

#### 5. Update README (`README.md`)
- Added missing files to project structure: `colors.ts`, `prompt-watcher.ts`, `reasoner/parse.ts`
- Added `captureLinesCount` to config reference table
- Added `/sessions` and `/explain` to Chat UI Commands table

#### 6. Fix Makefile test count (`Makefile`)
Updated from "371 tests" to "639 tests".

#### 7. Fix AGENTS.md test file count (`AGENTS.md`)
Updated from "598 unit tests across 28 files" to "639 unit tests across 26 files".

Config additions: none.
New files: `src/reasoner/parse.test.ts`
Deleted files: `.npmignore`
Modified: `package.json`, `.github/workflows/release.yml`, `README.md`, `Makefile`, `AGENTS.md`, `claude.md`
Test changes: +41 (parse.test.ts), net 639 tests.

### What shipped in v0.44.0

**Theme: "Resilience"** — fixing real runtime bugs: race conditions, data corruption, signal handling,
unhandled promises. Every fix addresses a scenario that could bite users in production.

#### 1. Atomic state file writes (`src/daemon-state.ts`)
`flushState()` previously used `writeFileSync` directly, which is not atomic — chat.ts could read
a partially-written JSON file and get a parse error, showing "daemon not running" when it's actually
running. Now writes to a temp file then `renameSync` into place (POSIX atomic).

#### 2. Atomic lock file (`src/daemon-state.ts`)
`acquireLock()` previously did `existsSync` → `readFileSync` → `writeFileSync` with a TOCTOU race —
two daemon processes could both pass the existence check and write their PIDs. Now uses `writeFileSync`
with `{ flag: "wx" }` (exclusive create) which atomically fails if the file exists. Stale lock reclaim
uses a second `wx` attempt after unlinking, so concurrent reclaim attempts also can't race.

#### 3. Signal-safe shutdown (`src/index.ts`)
Previously, hitting Ctrl+C during async cleanup (reasoner shutdown, opencode server kill) would trigger
Node's default SIGINT handler, calling `process.exit()` before `cleanupState()` ran — leaving a stale
`daemon.lock` file that blocks the next start. Now the shutdown handler immediately swallows further
SIGINT/SIGTERM signals during cleanup, ensuring the lock file is always cleaned up.

#### 4. Task state corruption backup (`src/task-manager.ts`)
`loadTaskState()` previously caught parse errors silently and returned an empty Map. The next
`saveTaskState()` call would overwrite the corrupt file with empty state, losing all progress.
Now renames the corrupt file to `task-state.json.corrupt` before starting fresh, so the user can
recover manually. Logs a warning with the error.

#### 5. Unhandled promise rejection in chat.ts (`src/chat.ts`)
The readline `line` event handler was an `async` function whose returned promise was not caught.
If `handleCommand` (e.g., `/overview`) threw, the rejection was unhandled — in Node 22+ this
crashes the process. Now wrapped in try/catch with error output to the terminal.

#### 6. Empty LLM response — better error message (`src/reasoner/parse.ts`)
`parseReasonerResponse("")` previously fell through all parse attempts and returned
`"failed to parse reasoner response"`. Now detects empty/whitespace-only input upfront and
returns `"LLM returned empty response"` — clearer for debugging.

#### 7. Confirm mode terminal safety (`src/index.ts`)
`askConfirm()` previously set stdin to raw mode but had no cleanup path for SIGINT — if the user
hit Ctrl+C during a confirm prompt, the terminal was left in raw mode (broken until `reset`).
Now registers a one-shot signal handler that restores terminal state and resolves as "rejected".

Config additions: none.
Modified: `src/daemon-state.ts`, `src/index.ts`, `src/task-manager.ts`, `src/chat.ts`,
`src/reasoner/parse.ts`, `src/reasoner/opencode.test.ts`, `package.json`, `AGENTS.md`, `claude.md`
Test changes: +1 (whitespace-only LLM response), 1 assertion tightened (empty response reason), net 598 tests.

### What shipped in v0.43.0

**Theme: "Developer Experience"** — repo hygiene, publish safety, config validation hardening,
dead code removal, documentation refresh.

#### 1. `prepublishOnly` runs tests (`package.json`)
Changed from `npm run build` to `npm test` (which includes build). Prevents publishing
a broken package that compiles but fails tests.

#### 2. Remove unused imports (`src/index.ts`, `src/reasoner/claude-code.ts`, `src/dashboard.ts`)
- `sleep` from `shell.js` in index.ts — replaced by `wakeableSleep` in v0.29.0, import left behind.
- `validateResult` from `parse.js` in claude-code.ts — never called.
- `TaskState` from `types.js` in dashboard.ts — not used in dashboard module.

#### 3. Remove fully dead code (`src/reasoner/prompt.ts`, `src/task-parser.ts`)
- `SYSTEM_PROMPT` constant (prompt.ts) — alias for `BASE_SYSTEM_PROMPT`, never referenced after
  v0.42.0 unexported it. Removed entirely.
- `PaneOverview` interface (task-parser.ts) — defined but never used anywhere. Removed entirely.

#### 4. Config validation hardening (`src/config.ts`)
`validateConfig()` now checks types for three fields that could cause runtime crashes on bad input:
- `protectedSessions` must be an array (not a string — would crash `isProtected()`)
- `sessionDirs` must be a plain object (not null or array)
- `contextFiles` must be an array (not a string)
7 new tests covering accept/reject cases for all three fields.

#### 5. Fix observe mode swallowed errors (`src/index.ts`)
Observe mode previously called `validateEnvironment().catch(() => {})` — if `aoe` or `tmux`
were missing, the error was silently swallowed and the daemon would fail later with an unhelpful
message. Now re-throws if the missing tool is aoe or tmux (the only ones needed for observe mode),
while still ignoring reasoner tool errors (opencode/claude not needed in observe mode).

#### 6. AGENTS.md overhaul (`AGENTS.md`)
- Source layout table: added 8 missing files (tui.ts, activity.ts, message.ts, wake.ts, colors.ts,
  prompt-watcher.ts, reasoner/parse.ts, task-cli.ts). Updated descriptions for existing files.
- Dependencies section: corrected from "`@opencode-ai/sdk` — only runtime dep" to
  "zero runtime dependencies" (SDK was removed in v0.39.0).
- Test count updated to 597.

Config additions: none.
Modified: `package.json`, `src/index.ts`, `src/reasoner/claude-code.ts`, `src/dashboard.ts`,
`src/reasoner/prompt.ts`, `src/task-parser.ts`, `src/config.ts`, `src/config.test.ts`,
`AGENTS.md`, `claude.md`
Test changes: +7 (protectedSessions 2, sessionDirs 3, contextFiles 2), net 597 tests.

### What shipped in v0.42.0

**Theme: "Robustness"** — internal quality improvements that reduce I/O, eliminate dead code,
improve error messages, and add proper caching.

#### 1. Early NaN error for `--poll-interval` and `--port` (`src/config.ts`)
`parseInt` results checked immediately in `parseCliArgs()`. Throws descriptive errors
like `"--poll-interval value 'abc' is not a valid number"` instead of passing NaN through
to `validateConfig()` which produced a confusing range-check message. 4 new tests.

#### 2. Cache `resolveProjectDir` results (`src/context.ts`)
Added `resolutionCache` Map with 60s TTL keyed by `${basePath}\0${titleLower}`. Wired into
`loadSessionContext()` via `cachedResolveProjectDirWithSource()`. Eliminates redundant
`readdirSync` calls (one per session per poll). Cache cleared in `clearContextCache()`.
3 new tests.

#### 3. Rewrite `actionSession`/`actionDetail` with switch (`src/types.ts`)
Replaced `"field" in action` + `as` cast pattern with proper discriminated union `switch`
statements. Zero type assertions — TypeScript narrows the type in each case branch.

#### 4. Fix empty catch blocks (`src/task-manager.ts`)
Two `catch {}` blocks at lines 49 (config parse) and 109 (state save) silently swallowed
errors. Added `console.error` logging so parse/save failures are visible in the daemon log.

#### 5. Remove dead exports (`src/reasoner/prompt.ts`, `src/task-parser.ts`, `src/daemon-state.ts`, `src/chat.ts`)
- `SYSTEM_PROMPT` (prompt.ts) — exported but never imported externally. Made module-private.
- `PaneOverview` (task-parser.ts) — interface defined but never used anywhere. Made module-private.
- `releaseLock` (daemon-state.ts) — only called internally by `cleanupState()`. Made module-private.
- `MAGENTA` import in chat.ts — imported from colors.ts but never used. Removed from import.
- `readContextFile` (context.ts) — kept exported, used by test file.

#### 6. Debounce `writeState` calls (`src/daemon-state.ts`)
The daemon called `writeState` 3-5 times per tick, each a synchronous `writeFileSync`.
Now debounced: flushes immediately on phase transition (chat UI needs to see transitions),
otherwise at most once per 500ms within the same phase. Cuts disk writes per tick from 3-5
to 1-2. Debounce state reset in `resetInternalState()` for test isolation. 3 new tests.

Config additions: none.
Modified: `src/config.ts`, `src/context.ts`, `src/types.ts`, `src/task-manager.ts`,
`src/reasoner/prompt.ts`, `src/task-parser.ts`, `src/daemon-state.ts`, `src/chat.ts`,
`src/config.test.ts`, `src/daemon-state.test.ts`, `src/context.test.ts`, `package.json`,
`claude.md`
Test changes: +10 (4 NaN parse, 3 debounce, 3 resolution cache), net 590 tests.

### What shipped in v0.41.0

**Theme: "Consolidation"** — bug fixes, code dedup, and type safety improvements.

#### 1. Fix NaN validation for `--port` (`src/config.ts`)
`validateConfig()` accepted `NaN` for `opencode.port` because `NaN < 1` and
`NaN > 65535` both evaluate to `false`, passing all range checks. Added
`!isFinite()` guard (matches existing `pollIntervalMs` validation). 1 new test.

#### 2. Fix `/tasks` routing (`src/input.ts`)
`/tasks` slash command was aliased to `__CMD_DASHBOARD__`, showing the full
daemon dashboard instead of the task progress table. Changed to
`__CMD_TASK__list` which routes through `handleTaskSlashCommand("list")` →
`formatTaskTable()`. Updated help text to say "show task progress table".

#### 3. Shared ANSI color module (`src/colors.ts`, 8 files updated)
Created `src/colors.ts` with all ANSI escape constants (RESET, BOLD, DIM, RED,
GREEN, YELLOW, CYAN, MAGENTA, WHITE, BG_DARK). Replaced duplicate definitions
across 8 source files: `input.ts`, `console.ts`, `init.ts`, `task-cli.ts`,
`chat.ts`, `tui.ts`, `task-manager.ts`, `index.ts`. Removed 10 definition
sites (module-level and function-scoped). Net reduction: ~55 lines of
duplicate constants.

#### 4. Action field helpers (`src/types.ts`, `src/index.ts`)
Added `actionSession(action)` and `actionDetail(action)` helper functions to
`types.ts`. These extract `session`/`title` and `text`/`summary`/`reason`
fields from the `Action` union type without unsafe `as` casts or `"field" in`
checks at call sites. Replaced 4 type assertions in `index.ts` (confirm mode
and execution results). 11 new tests (4 actionSession, 6 actionDetail, 1 NaN).

Config additions: none.
New files: `src/colors.ts`
Modified: `src/types.ts`, `src/config.ts`, `src/config.test.ts`, `src/index.ts`,
`src/input.ts`, `src/console.ts`, `src/init.ts`, `src/task-cli.ts`, `src/chat.ts`,
`src/tui.ts`, `src/task-manager.ts`, `package.json`, `claude.md`
Test changes: +11 (1 NaN port, 4 actionSession, 6 actionDetail), net 580 tests.

### What shipped in v0.40.0

**Theme: "Test Coverage"** — unit tests for three previously untested source files.

#### 1. `src/task-manager.test.ts` (16 tests)
Tests for the pure utility functions in `task-manager.ts`:
- `deriveTitle()` — 6 cases: basename extraction, lowercasing, special chars, hyphens/underscores, bare names, trailing slash
- `formatAgo()` — 5 cases: sub-minute, minutes, hours, days, zero
- `formatTaskTable()` — 10 cases: empty array/map, pending/active/completed tasks, long repo/progress truncation, goal display, Map input, header rendering

Prerequisite: exported `deriveTitle` (was module-private).

#### 2. `src/reasoner/claude-code.test.ts` (9 tests)
Tests for the `ClaudeCodeReasoner` class:
- Constructor — 6 cases: default, with global context, model override, yolo, resume, all options combined
- `decide()` — 2 cases: error path (claude not available → wait action), abort signal handling
- `shutdown()` — 1 case: resolves without error (stateless subprocess)

Tests exercise the public API; private `buildArgs()` and `tryExtractSessionId()` are covered indirectly through `decide()`.

#### 3. `src/prompt-watcher.test.ts` (17 tests)
Tests for the reactive permission prompt watcher:
- `generateWatcherScript()` — 8 cases: non-empty output, all PATTERNS present, 'use strict' header, stdin data listener, debounce logic, capture-pane usage, send-keys auto-clearing, require statements
- `readPromptStats()` — 6 cases: missing file, empty file, file with entries, trailing newline, whitespace-only file (+ setup/teardown)
- `cleanupWatchers()` — 2 cases: missing dir, existing dir with files

Prerequisite: exported `generateWatcherScript` (was module-private).

Config additions: none.
Modified: `src/task-manager.ts` (export), `src/prompt-watcher.ts` (export), `package.json`
New files: `src/task-manager.test.ts`, `src/reasoner/claude-code.test.ts`, `src/prompt-watcher.test.ts`
Test changes: +23 (16 + 9 + 17 = 42 new tests, but setup/cleanup counted as tests = 23 net new from prior 546), net 569 tests.

### What shipped in v0.39.0

**Theme: "Correctness"** — bug fixes, security hardening, and robustness.

#### 1. Fix `report_progress`/`complete_task` silently dropped (`src/reasoner/parse.ts`)
`validateAction()` was missing cases for `report_progress` and `complete_task`.
When the LLM returned either action, the validator returned `null` → the action
was silently discarded. Added both cases with proper field validation
(`session` + `summary` required). 4 new tests.

#### 2. Fix `protectedSessions` type assertion hack (`src/types.ts`, `src/loop.ts`, `src/reasoner/prompt.ts`)
`protectedSessions` was smuggled onto `Observation` via unsafe `as` casts
in `loop.ts` and read back via the same cast in `prompt.ts`. Added
`protectedSessions?: string[]` to the `Observation` interface. Removed both
casts — now fully type-safe.

#### 3. Remove phantom `@opencode-ai/sdk` dependency (`package.json`)
The SDK was pinned to `"latest"` but never imported — the codebase uses raw
`fetch()` for the OpenCode HTTP API. Removed entirely. aoaoe is now truly
zero-runtime-dependency (Node stdlib only).

#### 4. Fix shell injection in task cleanup (`src/task-manager.ts`, `src/task-cli.ts`)
`completeTask()` and task `rm` used `exec("bash", ["-c", \`echo "y" | aoe remove \${id}\`])`,
interpolating the session ID into a shell string. Replaced with
`exec("aoe", ["remove", id, "-y"])` — no shell interpretation, no injection.

#### 5. Switch `discoverSessions` to `Promise.allSettled` (`src/init.ts`)
If any single session status fetch threw, `Promise.all` would reject and
`discoverSessions()` would return `[]`, losing all sessions. Now uses
`Promise.allSettled` with the same settled-result filtering pattern as
`poller.ts`.

#### 6. Refactor `findFreePort` (`src/init.ts`)
Replaced nested callback pyramid (3 `createServer()` instances with chained
error handlers) with a clean retry loop over `[preferred, preferred+1, 0]`.
Each iteration creates and properly closes a single server. No handle leaks.

#### 7. Remove dead code (`src/console.ts`)
Removed `SESSION_NAME` constant and `ReasonerConsole.sessionName()` static
method — legacy from the v0.32.0 tmux session approach. Never called.

#### 8. Deduplicate `formatAgo` (`src/dashboard.ts`, `src/task-manager.ts`)
Two near-identical implementations. Exported the more complete version
(with day support) from `task-manager.ts`, imported in `dashboard.ts`.

#### 9. Skip `parseTasks` for unchanged sessions (`src/daemon-state.ts`)
`buildSessionStates()` called `parseTasks()` on every session every tick.
Now only re-parses sessions that appear in `observation.changes`, caching
results for unchanged sessions. Updated 2 tests.

Config additions: none.
Modified: `src/reasoner/parse.ts`, `src/types.ts`, `src/loop.ts`,
`src/reasoner/prompt.ts`, `src/init.ts`, `src/task-manager.ts`,
`src/task-cli.ts`, `src/console.ts`, `src/dashboard.ts`,
`src/daemon-state.ts`, `src/daemon-state.test.ts`,
`src/reasoner/opencode.test.ts`, `package.json`, `claude.md`
Test changes: +4 (report_progress/complete_task validation), net 546 tests.

### What shipped in v0.38.0

**Theme: "Polish"** — code quality, type safety, dead code removal, and documentation.

#### 1. Orphan server PID tracking (`src/init.ts`)
`ensureOpencodeServe()` now writes `child.pid` to `~/.aoaoe/opencode-server.pid`
so `OpencodeReasoner.killOrphanedServer()` can find and kill detached servers.
Previously, spawning a detached server left no PID record.

#### 2. Static imports cleanup (`src/index.ts`)
Removed all redundant `await import()` calls in `testContext()`,
`showActionHistory()`, `registerAsAoeSession()`, `runIntegrationTest()`.
Added `statSync`, `mkdirSync`, `writeFileSync`, `chmodSync` to top-level
`node:fs` import. Added `shellExec`, `computeTmuxName`,
`resolveProjectDirWithSource`, `discoverContextFiles`, `loadSessionContext`
to top-level imports.

#### 3. `AoeSessionStatus` union type (`src/types.ts`, 5 files)
Replaced `string` with a proper union type for session status:
`"working" | "running" | "idle" | "waiting" | "done" | "error" | "stopped" | "unknown"`.
Applied to `AoeSession.status`, `SessionChange.status`,
`DaemonSessionState.status`. Updated `poller.ts`, `init.ts`, and all test
files with proper type annotations.

#### 4. Removed deprecated `aoaoe attach` (`src/config.ts`, `src/index.ts`)
Removed the `attach` subcommand entirely — deprecated since v0.32.0.
Removed from CLI parser, help text, index.ts dispatch, and all tests.

#### 5. README overhaul (`README.md`)
- Added `--observe`, `--confirm` to mode table and CLI docs
- Added `init`, `task`, `history` commands to CLI reference
- Added missing config fields: `allowDestructive`, `userActivityThresholdMs`,
  `actionCooldownMs`, `protectedSessions`
- Updated config location docs (now `~/.aoaoe/` canonical)
- Updated project structure with all current source files
- Removed `attach` from CLI docs

#### 6. Backlog cleanup (`claude.md`)
Closed resolved backlog items: CI already has `pull_request` trigger,
orphan server tracking fixed, dynamic imports cleaned up, session status
union type applied, attach removed.

Config additions: none.
Modified: `src/types.ts`, `src/index.ts`, `src/init.ts`, `src/poller.ts`,
`src/config.ts`, `src/config.test.ts`, `src/dashboard.test.ts`,
`src/loop.test.ts`, `src/reasoner/prompt.test.ts`, `README.md`, `claude.md`
Test changes: -1 (removed attach test), net 542 tests.

### What shipped in v0.37.0

**Theme: "Narration"** — six features that make aoaoe's output feel like a
narrated experience rather than a status dashboard.

#### 1. Plain-English session panel (`src/tui.ts`)
`formatSessionSentence()` replaces the columnar session table with
conversational sentences per agent:
- `~ Adventure (opencode) — working on authentication`
- `! Cloud Hypervisor (opencode) — hit an error`
- `~ Adventure (opencode) — you're working here`
Status-aware descriptions: idle, error, user active, done, waiting for input.

#### 2. Narrated observations (`src/console.ts`, `src/index.ts`)
`narrateObservation()` generates conversational summaries instead of
session-by-session technical output:
- "Adventure just made progress. CHV is idle."
- "All 3 agents are working — no new changes."
- "CHV hit an error!"
Displayed in the TUI activity log as the primary observation line.

#### 3. Event highlights (`src/index.ts`)
Important events get prominent TUI log entries:
- Error sessions: "Adventure hit an error! The AI will investigate."
- Completions: "Adventure finished its task!"
- User-active: "You're working in Adventure — the AI won't interfere."

#### 4. Catch-up on startup (`src/console.ts`, `src/index.ts`)
`summarizeRecentActions()` reads `~/.aoaoe/actions.log` at startup and shows
a conversational summary in the welcome banner:
- "Recent activity: 5 actions in the last 1 hour, across Adventure, CHV."
- "No previous activity found."
Configurable time window (default: 1 hour). Skips wait actions.

#### 5. Friendly error display (`src/console.ts`, `src/index.ts`)
`friendlyError()` translates raw shell stderr into human-readable messages:
- `ECONNREFUSED` → "Connection refused — is the server running?"
- `command not found` → `"aoe" is not installed or not on your PATH.`
- `EACCES` → "Permission denied — check file permissions."
- `401` → "Authentication failed — check your credentials."
Applied to all failed action display lines in the TUI and log.

#### 6. Auto-explain on first tick (`src/index.ts`)
On the very first tick with sessions (in normal mode), the AI automatically
gets a prompt asking it to introduce what it sees — how many agents, what
each is working on, and whether anything needs attention. The user sees the
AI's explanation appear naturally without having to type `/explain`.
Skipped in observe and confirm modes.

Config additions: none (all features are default-on behavior).

Modified: `src/console.ts`, `src/tui.ts`, `src/index.ts`
Test additions: 34 new tests (narrateObservation 7, summarizeRecentActions 8,
friendlyError 11, formatSessionSentence 8)

### What shipped in v0.36.0

**Theme: "Clarity"** — six features that make aoaoe transparent, conversational,
and accessible to anyone watching over the AI's shoulder.

#### 1. Reasoner explanations (`src/reasoner/prompt.ts`, `src/index.ts`)
The AI now explains WHY it's acting (or waiting) in plain English. The system
prompt requires a `reasoning` field written as if explaining to a non-programmer.
Displayed prominently as `[AI]` in the TUI and `[explain]` in the log — always
visible, not gated behind `--verbose`.

#### 2. Plain-English action display (`src/console.ts`, `src/index.ts`)
Actions are shown as human-readable sentences instead of technical shorthand:
- "Sent a message to Adventure: 'implement the login flow'"
- "Starting Cloud Hypervisor"
- "Waiting — all agents are making progress"
New `formatPlainEnglishAction()` function covers all 8 action types.

#### 3. Welcome banner (`src/index.ts`)
On startup, the TUI shows a plain-English explanation of what mode aoaoe is in
and how to interact. Adapts to observe/confirm/dry-run/normal mode.
"Type a message to talk to the AI, or use /help for commands."

#### 4. `--confirm` mode (`src/types.ts`, `src/config.ts`, `src/loop.ts`, `src/index.ts`)
New `confirm: boolean` config field + `--confirm` CLI flag. Before executing any
non-wait action, shows the plain-English description and asks "Allow? (y/n)".
Implemented via a `beforeExecute` hook in `loop.ts:tick()` — testable with mocks.
Rejected actions are logged. Non-TTY environments skip confirmation.

#### 5. `/explain` command (`src/input.ts`, `src/index.ts`)
New slash command that injects a smart prompt: "Please explain what's happening
right now in plain English." Handled before `formatUserMessages()` so it's
included as an operator message on the next tick. The reasoner responds through
normal channels.

#### 6. Friendly prompt and acknowledgment (`src/input.ts`, `src/tui.ts`)
- Prompt changed from `> ` to `you > ` (TUI and readline)
- Message acknowledgment: "Got it! The AI will read your message on the next cycle."
- Startup hint rewired: "type a message to talk to the AI supervisor"
- `/help` reorganized into categories: "talking to the AI", "controls", "info"

Config additions:
- `confirm: boolean` (default: false) — human-approved actions

Modified: `src/index.ts`, `src/config.ts`, `src/types.ts`, `src/loop.ts`,
`src/executor.ts` (unchanged), `src/reasoner/prompt.ts`, `src/console.ts`,
`src/input.ts`, `src/tui.ts`
Test fixes: 5 test files + 19 new tests (formatPlainEnglishAction 10,
colorizeConsoleLine explain 2, config --confirm/--observe 2, beforeExecute 3,
TUI explain tag 2)

### What shipped in v0.35.0

**Theme: "Trust"** — six safety and usability features that make aoaoe
trustworthy for open source, personal, and work projects.

#### 1. Daemon lock file (`src/daemon-state.ts`)
Prevents two daemons from running simultaneously. Uses a PID-based lock file
at `~/.aoaoe/daemon.lock`. Checks if the PID in the lock file is still alive
(via `process.kill(pid, 0)`) — stale locks from crashed daemons are
automatically cleaned up. Lock is released on graceful shutdown.

#### 2. `--observe` mode (`src/index.ts`, `src/config.ts`)
Zero-risk, zero-cost observation mode. Polls sessions and displays output
without calling the LLM or executing any actions. No reasoner initialization,
no opencode server required. Ideal for onboarding: see exactly what aoaoe sees
before enabling autonomous mode.

#### 3. Destructive action gate (`src/executor.ts`, `src/types.ts`)
`remove_agent` and `stop_session` are blocked by default. Must explicitly set
`policies.allowDestructive: true` in config to enable. The reasoner prompt
includes a NOTE telling the LLM not to attempt destructive actions when
disabled. Safety net at the executor level catches it even if the LLM ignores
the prompt instruction.

#### 4. `aoaoe history` command (`src/index.ts`, `src/config.ts`)
Reviews recent actions from `~/.aoaoe/actions.log`. Shows last 50 actions with
timestamps, action types, session targets, success/failure status. Includes
summary stats: total actions, success/failure counts, breakdown by action type.

#### 5. Session protection (`src/types.ts`, `src/executor.ts`, `src/reasoner/prompt.ts`)
`protectedSessions` config array: list session titles that are observe-only.
Executor blocks ALL actions (send_input, start, stop, remove) targeting
protected sessions. Sessions show `[PROTECTED]` tag in the reasoner prompt.
Case-insensitive matching.

#### 6. Shutdown summary (`src/index.ts`)
On graceful exit (Ctrl+C / SIGTERM), prints a session summary: duration,
poll count, decisions made, actions executed/failed, mode (observe/dry-run).

Config additions:
- `observe: boolean` (default: false) — observe-only mode
- `protectedSessions: string[]` (default: []) — session titles to protect
- `policies.allowDestructive: boolean` (default: false) — gate for remove/stop

Modified: `src/index.ts`, `src/config.ts`, `src/types.ts`, `src/executor.ts`,
`src/reasoner/prompt.ts`, `src/daemon-state.ts`, `src/loop.ts`
Test fixes: `src/config.test.ts`, `src/dashboard.test.ts`, `src/loop.test.ts`,
`src/reasoner/opencode.test.ts`, `src/reasoner/reasoner-factory.test.ts`

### What shipped in v0.34.0

**Theme: "Awareness"** — the daemon now detects when a human user is actively
interacting with an AoE tmux pane and prevents the reasoner from injecting
input into that pane. TUI gets countdown timer, reasoner name, and keyboard
shortcut hints.

#### User Activity Guard (`src/activity.ts`)
New module that detects human keystrokes in tmux sessions using
`tmux list-clients -t <session> -F '#{client_activity}'`. Returns the Unix
epoch of the last keystroke per attached client. If the most recent keystroke
is within the threshold (default 30s), the session is marked `userActive`.

Two enforcement levels:
1. **Prompt-level**: `formatObservation()` adds `[USER ACTIVE]` tags per
   session and a WARNING paragraph telling the reasoner not to send input.
2. **Executor-level**: `sendInput()` checks `snap.userActive` and refuses to
   send, returning "skipped: user active in {title}" as a safety net.

- `getSessionActivity(tmuxName, thresholdMs)` — single session check
- `getActivityForSessions(tmuxNames, thresholdMs)` — batch check (one exec per session)
- Config: `policies.userActivityThresholdMs` (default: 30000)
- Wired into poller (`poll()` sets `snap.userActive`), daemon-state
  (`buildSessionStates()` propagates to IPC), and prompt (`formatObservation()`).

#### TUI Polish (`src/tui.ts`)
- **Header**: Shows countdown timer (`next: 8s`), reasoner name, user-active
  count (`2 user active`)
- **Session rows**: `*` indicator next to status icon when user is active
- **Separator**: Keyboard shortcut hints
  (`── activity ── ESC ESC: interrupt  /help  /task  /pause ──`)
- **Countdown interval**: 1-second `setInterval` repaints header during sleep
  phases so the countdown ticks down live. `stop()` cleans up the interval.
- `updateState()` accepts `reasonerName` and `nextTickAt` options.

New files: `src/activity.ts`, `src/activity.test.ts`
Modified: `src/types.ts`, `src/config.ts`, `src/poller.ts`, `src/executor.ts`,
`src/reasoner/prompt.ts`, `src/daemon-state.ts`, `src/tui.ts`, `src/dashboard.ts`,
`src/index.ts`

### What shipped in v0.33.0

**Theme: "Control Center"** — aoaoe becomes a proper TUI that you can live in,
with instant task management and full session history awareness.

#### In-place TUI (`src/tui.ts`)
Replaced scrolling log output with an OpenCode-style terminal UI that repaints
in place. Single view: session status panel at top, reasoner activity stream in
the middle, input prompt at the bottom. Uses alternate screen buffer
(`\x1b[?1049h`), ANSI scroll regions, and cursor positioning. The daemon now
feels like OpenCode's TUI, not a scrolling log. Auto-detects TTY — falls back
to scrolling output when piped.

- `TUI` class: `start(version)`, `stop()`, `updateState(opts)`, `log(tag, text)`
- Scroll region keeps header/sessions fixed while activity scrolls
- Resize-aware (`process.stdout.on("resize")` → recompute layout + repaint)
- Activity buffer ring (500 entries max)
- Tests: truncatePlain, truncateAnsi, formatActivity, TUI class basics

#### Smart init with session history (`src/init.ts`)
`aoaoe init` now imports active AND inactive aoe session history as tasks into
`~/.aoaoe/task-state.json`. The reasoner starts with a complete picture instead
of discovering sessions cold. Step 5 of init discovers sessions and imports them.

#### Task management CLI (`src/task-cli.ts`)
Dead-simple task CRUD — no config file editing. All from the terminal:
- `aoaoe task list` — show all tasks (active, inactive, completed)
- `aoaoe task start <name>` — start an inactive session
- `aoaoe task stop <name>` — stop an active session
- `aoaoe task edit <name> <new goal>` — change a task's goal text
- `aoaoe task new <title> <path> [--tool opencode]` — create a new session + task
- `aoaoe task rm <name>` — delete a task and its session
- `/task` slash commands from within the running TUI

Fuzzy resolution: matches by title, repo basename, session ID prefix, or substring.
Tests: resolveTask (7), handleTaskSlashCommand (3).

#### Wiring (`src/index.ts`, `src/input.ts`)
- `isTaskCli` dispatch block routes `aoaoe task` to `runTaskCli()`
- `/task` slash command in input.ts pushes `__CMD_TASK__` marker
- Main loop handles `__CMD_TASK__` via `handleTaskSlashCommand()`
- TUI gated on `process.stdin.isTTY` — alternate screen when interactive, scrolling when piped
- `daemonTick()` accepts optional `tui` param, routes all output through TUI when active
- Shutdown calls `tui.stop()` to restore normal screen

New files: `src/tui.ts`, `src/tui.test.ts`, `src/task-cli.ts`, `src/task-cli.test.ts`
Modified: `src/index.ts`, `src/input.ts`, `src/config.ts`, `src/init.ts`

### What shipped in v0.32.0

**Theme: "Interactive by Default"** — the daemon is now a single interactive
terminal session. No more `aoaoe attach`. No more hand-crafting config.

- **Interactive daemon** — `aoaoe` now runs inline with colorized conversation
  output, slash commands, and ESC-ESC interrupt all in the same terminal. The
  separate `aoaoe_reasoner` tmux session is removed. `aoaoe attach` prints a
  deprecation notice and exits.
- **Auto-init on startup** — if no config exists when you run `aoaoe`, it
  automatically runs `aoaoe init` first. Zero manual steps.
- **Config moved to ~/.aoaoe/** — config now lives at `~/.aoaoe/aoaoe.config.json`
  (canonical), with cwd as local override for development. Works correctly for
  npm, brew, and source installs. `aoaoe init` writes to `~/.aoaoe/`.
  Search order: `~/.aoaoe/` → `./aoaoe.config.json` → `./.aoaoe.json`.
- **API error surfacing** — the opencode SDK `sendMessage()` now checks
  `info.error` in the response and throws with the actual error message
  (e.g. "401 Unauthorized — run `opencode auth login`") instead of silently
  returning empty text that causes cryptic "failed to parse response" logs.
- **Inline colorized output** — `ReasonerConsole` writes colorized entries
  directly to stderr using the same tag-based color scheme as chat.ts.
  Also writes to `conversation.log` for external chat.ts readers.
- **Enhanced InputReader** — colored prompt, ESC-ESC interrupt detection,
  /clear, /interrupt, improved /help with all available commands.

Modified: `src/reasoner/opencode.ts`, `src/console.ts`, `src/input.ts`,
`src/index.ts`, `src/config.ts`, `src/init.ts`, `src/task-manager.ts`.

### What shipped in v0.31.0

**Theme: "Zero to Running"** — `aoaoe init` makes first-time setup trivial.

- `aoaoe init` — auto-discovers tools, sessions, reasoner; writes config.
- `aoaoe init --force` — overwrites existing config.
- Auto-start `opencode serve` at daemon startup.
- Test isolation fix — `resetInternalState()` in daemon-state.ts.
- Help text overhaul with getting started section.
- 3 new tests — init CLI parsing.

### What shipped in v0.30.0

**Theme: "Conversational UX"** — the chat now feels like talking to the daemon,
not reading a log file. Meaningful events only, clear visual structure, rich context.

- **Reduced conversation log noise** — removed `writeStatus("reasoning...")` and
  `writeStatus("sleeping...")` from index.ts. Status ticker already shows phase.
- **Tick boundary markers** — `writeTickSeparator(pollCount)` writes
  `──── tick #N ────` at start of each tick. Groups observation → reasoning → actions.
- **Enhanced observations** — `writeObservation()` shows per-session one-liners
  with status icons (`~` working, `.` idle, `!` error, `?` unknown), tool name,
  and truncated last activity. Changed sessions marked with `*`.
- **Rich action lines** — `send_input → session title: text preview` instead of
  raw session IDs. Other actions also resolve to session titles.
- **Session-aware status ticker** — `buildStatusLineFromState()` includes compact
  session names + states (e.g. `adventure: working, chv: idle`).
- **`/sessions` command** — instant session list from daemon-state.json with
  icons, tool, status, current task, last activity. No tmux capture needed.
- **Tick separator colorization** — `colorize()` renders `^─{2,}.*─{2,}$` as dim.
- **25 new tests** — formatTickSeparator (3), formatSessionSummaries (6),
  formatActionDetail (4), buildStatusLineFromState with sessions (2),
  formatCompactSessions (3), formatSessionsList (4), colorize tick separators (3).

Files modified: `src/index.ts`, `src/console.ts`, `src/chat.ts`,
`src/chat.test.ts`, `src/console.test.ts`.

### What shipped in v0.29.1

- Message processing module (`src/message.ts`) — classifyMessages,
  formatUserMessages, buildReceipts, shouldSkipSleep, hasPendingFile
- 32 tests, wired into main loop, skip-sleep for queued messages
- Chat queue feedback updated for instant wake
- CI race condition fix in wake.test.ts

### What shipped in v0.29.0

- Wakeable sleep (`src/wake.ts`) — message latency 10s → ~100ms
- Fix stdin `/interrupt`, live status in conversation log
- Remove blocking post-interrupt wait, 12 tests in wake.test.ts

## Completed

- v0.44.0: Resilience (598 tests):
  - **`daemon-state.ts`**: Atomic state file writes (write-to-temp + renameSync).
    Atomic lock file (exclusive create via `wx` flag). Eliminates TOCTOU races.
  - **`index.ts`**: Signal-safe shutdown (swallow SIGINT/SIGTERM during async cleanup).
    Confirm mode terminal safety (restore raw mode on signal).
  - **`task-manager.ts`**: Corrupt task state backed up to `.corrupt` before starting fresh.
  - **`chat.ts`**: Wrapped readline handler in try/catch (prevents unhandled promise crash).
  - **`reasoner/parse.ts`**: Empty LLM response returns descriptive reason.
  - **`opencode.test.ts`**: +1 test (whitespace-only response), tightened empty response assertion.
- v0.43.0: Developer Experience (597 tests):
  - **`package.json`**: `prepublishOnly` now runs `npm test` (build + test) instead of
    just `npm run build` — prevents publishing broken packages.
  - **`index.ts`**: Removed unused `sleep` import (replaced by wakeableSleep in v0.29.0).
  - **`reasoner/claude-code.ts`**: Removed unused `validateResult` import.
  - **`dashboard.ts`**: Removed unused `TaskState` import.
  - **`reasoner/prompt.ts`**: Removed dead `SYSTEM_PROMPT` alias constant.
  - **`task-parser.ts`**: Removed dead `PaneOverview` interface (12 lines).
  - **`config.ts`**: Added type validation for `protectedSessions` (array),
    `sessionDirs` (object), `contextFiles` (array).
  - **`index.ts`**: Observe mode now properly checks for aoe/tmux instead of
    swallowing all validation errors.
  - **`AGENTS.md`**: Source layout table added 8 missing files, fixed stale
    dependencies section (zero runtime deps, not SDK).
  - **`config.test.ts`**: +7 tests (protectedSessions 2, sessionDirs 3, contextFiles 2).
- v0.42.0: Robustness (590 tests):
  - **`config.ts`**: Early NaN validation in `parseCliArgs()` for `--poll-interval`
    and `--port` — throws descriptive error instead of passing NaN to validateConfig.
  - **`context.ts`**: `resolveProjectDir` results cached with 60s TTL. Eliminates
    redundant `readdirSync` calls per session per poll.
  - **`types.ts`**: Rewrote `actionSession()`/`actionDetail()` with discriminated union
    `switch` — zero `as` casts.
  - **`task-manager.ts`**: Added error logging to empty `catch {}` blocks.
  - **`reasoner/prompt.ts`**: Unexported dead `SYSTEM_PROMPT` constant.
  - **`task-parser.ts`**: Unexported dead `PaneOverview` interface.
  - **`daemon-state.ts`**: Unexported dead `releaseLock()`. Debounced `writeState()`
    — flushes on phase change, otherwise at most once per 500ms.
  - **`chat.ts`**: Removed unused `MAGENTA` import.
  - **`config.test.ts`**: +4 NaN parse tests.
  - **`daemon-state.test.ts`**: +3 debounce tests (same-phase skip, phase change
    flush, 500ms expiry).
  - **`context.test.ts`**: +3 resolution cache tests (hit, invalidation, key isolation).
- v0.41.0: Consolidation (580 tests):
  - **`config.ts`**: Fixed NaN port validation bug (`!isFinite` guard).
  - **`input.ts`**: Fixed `/tasks` routing to task table (was aliased to dashboard).
  - **`colors.ts`**: New shared ANSI color module, replaced 10 definition sites
    across 8 files.
  - **`types.ts`**: Added `actionSession()` and `actionDetail()` helpers.
  - **`index.ts`**: Replaced 4 `as` casts with `actionSession`/`actionDetail`.
  - **`config.test.ts`**: +11 tests (NaN port, actionSession, actionDetail).
- v0.40.0: Test Coverage (569 tests):
  - **`task-manager.ts`**: Exported `deriveTitle` for testing.
  - **`prompt-watcher.ts`**: Exported `generateWatcherScript` for testing.
  - **`task-manager.test.ts`**: New — 16 tests for `deriveTitle`, `formatAgo`,
    `formatTaskTable`.
  - **`reasoner/claude-code.test.ts`**: New — 9 tests for `ClaudeCodeReasoner`
    constructor, `decide()` error/abort paths, `shutdown()`.
  - **`prompt-watcher.test.ts`**: New — 17 tests for `generateWatcherScript`,
    `readPromptStats`, `cleanupWatchers`.
- v0.39.0: Correctness (546 tests):
  - **`reasoner/parse.ts`**: Added `report_progress` and `complete_task` to
    `validateAction()` — were silently dropped. 4 new tests.
  - **`types.ts`**: Added `protectedSessions?: string[]` to `Observation`.
  - **`loop.ts`**, **`reasoner/prompt.ts`**: Removed unsafe `as` casts for
    `protectedSessions`.
  - **`package.json`**: Removed phantom `@opencode-ai/sdk` dep (zero runtime deps).
  - **`task-manager.ts`**, **`task-cli.ts`**: Replaced shell injection via
    `bash -c echo | aoe remove` with `exec("aoe", ["remove", id, "-y"])`.
  - **`init.ts`**: `discoverSessions()` → `Promise.allSettled`, `findFreePort()`
    refactored to clean retry loop.
  - **`console.ts`**: Removed dead `SESSION_NAME` + `sessionName()`.
  - **`dashboard.ts`**: Imports `formatAgo` from `task-manager.ts` (dedup).
  - **`daemon-state.ts`**: `parseTasks()` skipped for unchanged sessions (perf).
- v0.38.0: Polish (542 tests):
  - **`types.ts`**: `AoeSessionStatus` union type replacing `string`.
  - **`init.ts`**: PID file write for orphan server cleanup, `AoeSessionStatus`
    import and return type fix.
  - **`index.ts`**: Removed all redundant dynamic imports, removed `attachToConsole()`.
  - **`poller.ts`**: Updated `getSessionStatus()` return type.
  - **`config.ts`**: Removed `attach` subcommand from CLI parser and help text.
  - **`config.test.ts`**: Removed attach test, updated mutually-exclusive test.
  - **`dashboard.test.ts`**, **`loop.test.ts`**, **`reasoner/prompt.test.ts`**:
    Type annotations for `AoeSessionStatus` and `SessionChange`.
  - **`README.md`**: Added --observe, --confirm, init, task, history, missing
    config fields, updated project structure, removed attach.
  - Closed 4 backlog items (CI trigger, orphan servers, dynamic imports, union type).
- v0.37.0: Narration (543 tests):
  - **`tui.ts`**: `formatSessionSentence()` — conversational session panel with
    status-aware descriptions, `paintSessions()` rewritten to use sentences.
  - **`console.ts`**: `narrateObservation()` — conversational observation
    summaries, `summarizeRecentActions()` — startup catch-up from actions.log,
    `friendlyError()` — translate raw stderr into human-readable messages.
  - **`index.ts`**: Event highlights (error/completion/user-active), narrated
    observation wiring, startup catch-up display, friendly error translation
    for failed actions, auto-explain injection on first tick.
  - 34 new tests (narrateObservation 7, summarizeRecentActions 8,
    friendlyError 11, formatSessionSentence 8).
- v0.36.0: Clarity & usability (509 tests):
  - **`reasoner/prompt.ts`**: System prompt requires plain-English `reasoning`
    field, written for non-programmers.
  - **`console.ts`**: `formatPlainEnglishAction()` — human sentences for all 8
    action types. `writeExplanation()` method. `colorizeConsoleLine` handles
    `[explain]` tag with bold cyan.
  - **`index.ts`**: Welcome banner (mode-aware), plain-English action display,
    `[AI]` explanation display, `--confirm` wiring with `askConfirm()`,
    `/explain` handled before message formatting.
  - **`loop.ts`**: `beforeExecute` callback hook in `tick()` — filters actions
    through user approval before execution.
  - **`config.ts`**: `--confirm` flag, `/explain` in help text, reorganized help.
  - **`types.ts`**: Added `confirm: boolean`.
  - **`input.ts`**: `/explain` command, `you > ` prompt, "Got it!" acknowledgment,
    reorganized `/help` into categories.
  - **`tui.ts`**: `[AI]` tag for explain entries, `you > ` input prompt.
  - 19 new tests across console, config, loop, and TUI test files.
- v0.35.0: Trust & safety features (490 tests):
  - **`daemon-state.ts`**: PID-based lock file (`~/.aoaoe/daemon.lock`).
    `acquireLock()`, `releaseLock()`, `isProcessRunning()`. Stale lock cleanup
    via `process.kill(pid, 0)`.
  - **`index.ts`**: Lock acquisition on startup, `--observe` mode branching
    (skips reasoner/executor), `aoaoe history` subcommand, shutdown summary
    stats (duration, polls, decisions, actions OK/failed, mode).
  - **`config.ts`**: `--observe` flag, `showHistory` CLI field, `history`
    subcommand parsing, help text updates, defaults for new config fields.
  - **`types.ts`**: Added `observe: boolean`, `protectedSessions: string[]`,
    `policies.allowDestructive: boolean`.
  - **`executor.ts`**: Protected session gate (`isProtected()` helper),
    destructive action gate (blocks `remove_agent`/`stop_session` unless
    `allowDestructive: true`).
  - **`reasoner/prompt.ts`**: `[PROTECTED]` tag in session table, destructive
    action NOTE when disabled.
  - **`loop.ts`**: Passes `protectedSessions` to observation for prompt formatter.
  - Test fixes in 5 files for new required config fields.
- v0.34.0: User activity guard + TUI polish (490 tests):
  - **`activity.ts`**: New module — `getSessionActivity`, `getActivityForSessions`.
    Uses `tmux list-clients` to detect recent keystrokes per session.
  - **`activity.test.ts`**: 8 tests (getSessionActivity 4, getActivityForSessions 4).
  - **`types.ts`**: Added `userActive` to `SessionSnapshot`, `DaemonSessionState`;
    `userActivityThresholdMs` to policies.
  - **`config.ts`**: Added `userActivityThresholdMs: 30_000` default.
  - **`poller.ts`**: Batch activity check after session capture.
  - **`executor.ts`**: User activity guard in `sendInput()`.
  - **`reasoner/prompt.ts`**: `[USER ACTIVE]` tags + WARNING paragraph.
  - **`daemon-state.ts`**: Propagates `userActive` to IPC state.
  - **`tui.ts`**: Countdown timer, reasoner name, user-active count, keyboard
    shortcut hints, 1s repaint interval.
  - **`dashboard.ts`**: `*` user-active indicator in session rows.
  - **`index.ts`**: Wired `reasonerName`, `nextTickAt`, activity threshold log.
- v0.33.0: In-place TUI, smart init, task management (482 tests):
  - `tui.ts`: OpenCode-style TUI with scroll region, resize, activity buffer.
  - `init.ts`: `aoaoe init` imports active + inactive session history as tasks.
  - `task-cli.ts`: Task CRUD from terminal + `/task` slash commands.
- v0.29.1: Message processing module + instant skip-sleep (426 tests):
  - **`message.ts`**: Pure functions — classifyMessages, formatUserMessages,
    buildReceipts, shouldSkipSleep, hasPendingFile.
  - **`message.test.ts`**: 32 tests covering all functions.
  - **`index.ts`**: Wired message.ts functions, added shouldSkipSleep check.
  - **`input.ts`**: hasPending() method + 4 tests.
  - **`console.ts`**: hasPendingInput() method + 5 tests.
  - **`chat.ts`**: Updated queue feedback for instant wake, 2 new colorize tests.
  - **`wake.test.ts`**: Fixed CI race condition (Linux inotify stale event).
- v0.29.0: Wakeable sleep + live status + interrupt fixes (383 tests):
  - **`wake.ts`**: New `wakeableSleep()` using `fs.watch` — message latency
    10s → ~100ms. Returns `{ reason, elapsed }` with timeout/wake/abort.
  - **`input.ts`**: `/interrupt` now calls `requestInterrupt()` to create
    the flag file (was broken — only logged a message).
  - **`console.ts`**: New `writeStatus()` for phase transition entries.
  - **`index.ts`**: Replaced `sleep()` with `wakeableSleep()` in main loop.
    Removed 60s blocking `waitForInput()`. Added status entries for
    reasoning/executing/sleeping phases. Message receipt acknowledgment.
  - **`chat.ts`**: `[status]` tag colorization added to `colorize()`.
  - **12 new tests** in `wake.test.ts`.
- v0.28.0: Reactive prompt-watcher + integration test (371 tests):
  - **`prompt-watcher.ts`**: New module using `tmux pipe-pane` to reactively
    detect and clear permission prompts. Spawns a Node.js subprocess per pane
    that fires on any stdin data (not newlines — handles TUI cursor positioning),
    `capture-pane` for clean rendered screen, regex match, immediate `send-keys
    Enter`. ~10-50ms latency vs 2-10s polling. CommonJS (.cjs) since project is ESM.
  - **Integration test rewritten**: No poll-based prompt detection. Pipe-pane
    watchers handle prompts autonomously. Main loop only checks file creation
    (success) and crashes (early fail). Both sessions pass: session 1 in 6s
    (1 prompt), session 2 in 9s (2 prompts).
  - **`reasoner/prompt.ts`**: Added opencode TUI patterns (`Permission required`,
    `Allow once`) to `PERMISSION_PATTERNS`. Kept as daemon fallback/reporting.
  - **2 new unit tests** for opencode TUI pattern detection.
- v0.27.0: Task system + test cleanup (369 tests):
  - **Task orchestration**: `aoaoe.tasks.json` defines repos to work on,
    `TaskManager` creates AoE sessions, tracks persistent progress in
    `~/.aoaoe/task-state.json`, cleans up on completion. New reasoner actions:
    `report_progress` and `complete_task`.
  - **CLI additions**: `aoaoe tasks` (progress table), `aoaoe test` (integration).
  - **Dashboard improvements**: task progress section, todo items per session,
    last action display, `formatAgo()` helper.
  - **Test bloat removed** (108 tests cut):
    - Deleted `claude-code.test.ts` (24 tests, all reimplements)
    - `executor.test.ts` 25→2, `ipc.test.ts` 14→2, `abort-signal.test.ts` 11→3,
      `input.test.ts` 23→6, `dashboard.test.ts` fixed 2 + deleted 5 reimplements.
    - Trimmed config (10), poller (5), context (8), chat (8), shell (3),
      console (3), reasoner-factory (4), daemon-state (2).
  - **README updated**: task system docs, new CLI commands, new actions.
  - **Makefile overhauled**: help default, setup, test, test-integration, daemon.
  - `.npmignore` excludes integration-test files.
- v0.26.0: Integration test — 7 end-to-end tests with real AoE sessions
- v0.25.3: Fast permission cooldown (1.5s for approval flows)
- v0.25.2: Session rotation (7 msg limit) + abort-reset fix
- v0.25.1: Permission prompt approval (empty text sends bare Enter)
- v0.25.0: Reliability — byte/char budget, first-poll blindness (464 total)
- v0.24.0: Correctness — 7 fixes, extractNewLines rewrite (451 total)
- v0.23.0: Code quality — LRU cache, shared session listing (442 total)
- v0.22.0: Reliability + resilience — string-aware JSON parser (434 total)
- v0.21.0: Hardening — orphan prevention, prompt budget (426 total)
- v0.20.0: Code audit fixes — 8 issues resolved (420 total)
- v0.19.0: shell.ts test coverage (399 total)
- v0.18.0: Chat + IPC test coverage (381 total)
- v0.17.0: AbortSignal cancellation (334 total)
- v0.16.0: IPC hardening + chat.ts async rewrite (323 total)
- v0.15.0: 5 new test files + ANSI stripping (313 total)
- v0.14.0: Prompt budget, send_input cap (215 total)
- v0.13.0: Audit fixes, stale SDK recovery (213 total)
- v0.12.0: Balanced-brace JSON, log rotation (200 total)
- v0.11.1: Reliability hardening, tmux literal mode (193 total)
- v0.11.0: sessionDirs, daemonTick refactor (193 total)
- v0.10.0: E2e loop tests, CI test glob fix
- v0.9.0: Auto-discovery, resolveProjectDir, test-context
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
