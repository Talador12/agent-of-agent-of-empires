# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.30.0 (in progress)

## Current Focus

**v0.30 theme: "Conversational UX"** — make the chat feel like talking to the
daemon, not reading a log file. The conversation log should show meaningful
events only, with clear visual structure and rich context.

426 tests across 22 files. Goal: ~450+ after v0.30 tests.

### v0.30 Roadmap

The problem: you type a message in chat, see "queued", then read a stream
of raw log lines to understand what happened. No clear visual hierarchy,
noisy status lines, no connection between your message and the response.

**Before (v0.29.1):**
```
10:30:00 [status] received: focus on the auth module
10:30:00 [status] reasoning...
10:30:00 [you] focus on the auth module
10:30:01 [observation] 3 sessions, 1 changed
  adventure (opencode): working
10:30:30 [reasoner] The adventure session is working on CharacterCreate...
10:30:31 [+ action] send_input: Focus on the auth module first
10:30:31 [status] sleeping (next tick in 10s)
```

**After (v0.30):**
```
10:30:00 [status] received: focus on the auth module
──── tick #42 ────
10:30:00 [you] focus on the auth module
10:30:01 [observation] 3 sessions, 1 changed
  ~ adventure (opencode) — writing CharacterCreate.tsx
  . cloud-hypervisor (opencode) — idle
  . aoaoe (opencode) — idle
10:30:30 [reasoner] The adventure session is working on CharacterCreate...
10:30:31 [+ action] send_input → adventure: Focus on the auth module first
```

#### TODO

1. **Reduce conversation log noise** (`src/index.ts`)
   - Remove `writeStatus("sleeping (next tick in Xs)")` — status ticker
     already handles phase display in chat
   - Remove `writeStatus("reasoning...")` — same, status ticker shows this
   - Keep: receipts, executing N actions, system messages
   - Result: conversation log only shows meaningful events

2. **Tick boundary markers** (`src/console.ts`, `src/index.ts`)
   - New `writeTickSeparator(pollCount)` method on ReasonerConsole
   - Writes `──── tick #N ────` line at start of each tick
   - Groups observation → reasoning → actions visually
   - `colorize()` renders separator lines as dim

3. **Enhanced observations with session summaries** (`src/console.ts`, `src/index.ts`)
   - `writeObservation()` accepts per-session one-liners
   - Shows: status icon + title (tool) — last activity snippet
   - Icons: `~` working, `.` idle, `!` error, `?` unknown
   - Data already available from poller snapshots

4. **Rich action lines** (`src/index.ts`)
   - `send_input` shows: `send_input → <session title>: <text preview>`
   - Other actions show session title instead of raw ID where possible
   - Truncate text preview to ~80 chars

5. **Session-aware status ticker** (`src/chat.ts`)
   - `buildStatusLineFromState()` includes compact session names + states
   - e.g. `next: 8s | adventure: working, chv: idle | poll #12`
   - Data already in `DaemonState.sessions` from daemon-state.json
   - Truncate to fit terminal width (compact names)

6. **`/sessions` command** (`src/chat.ts`)
   - Quick session list from daemon-state.json (no tmux capture)
   - Shows: title, tool, status, last activity, current task
   - Instant response (reads cached IPC state, not live data)
   - Complement to `/overview` (which does live tmux capture)

7. **Update `colorize()`** (`src/chat.ts`)
   - Add pattern for tick separator lines (`^──.*──$`)
   - Render as dim — visual structure without noise

8. **Tests** for all new pure logic:
   - `chat.test.ts`: buildStatusLineFromState with sessions, colorize
     for tick separators, /sessions output formatting
   - `console.test.ts`: writeTickSeparator format, writeObservation
     with session summaries

#### Files to modify
- `src/index.ts` — remove noisy status writes, add tick separator call,
  pass session info to writeObservation, rich action lines
- `src/console.ts` — writeTickSeparator(), enhanced writeObservation()
- `src/chat.ts` — buildStatusLineFromState() with sessions, /sessions
  command, colorize() tick separator pattern
- `src/chat.test.ts` — tests for new chat logic
- `src/console.test.ts` — tests for new console methods

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

## Backlog (not v0.30)

- **CI on PR creation** — add `pull_request` trigger to `.github/workflows/ci.yml`
- `OpencodeReasoner.shutdown()` doesn't clean up orphaned servers from prior runs
- `index.ts` dynamic imports in `testContext` that could be static
- `types.ts` `AoeSession.status` is `string` instead of union type
- IPC test isolation (make state dir configurable to prevent daemon race)
- Homebrew tap PAT needs `repo` scope for dispatch

## Completed

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
