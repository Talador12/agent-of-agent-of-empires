# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.29.0 (unreleased)

## Current Focus

Daemon UX improvements: wakeable sleep, live status, interrupt fixes.
383 tests across 20 files.

### What changed in v0.29.0

- **Wakeable sleep (`src/wake.ts`)**: New `wakeableSleep()` primitive using
  `fs.watch` on `~/.aoaoe/` directory. Replaces dumb `sleep()` in the main
  loop. Message latency drops from up to 10s (full poll interval) to ~100ms.
  Interrupt works from ANY daemon phase (sleeping, polling, reasoning).
  Falls back to pure timeout if watch dir doesn't exist.

- **Fix stdin `/interrupt` (`src/input.ts`)**: The `/interrupt` command now
  calls `requestInterrupt()` to create the flag file. Previously it only
  pushed a `__CMD_INTERRUPT__` marker that logged a message but never
  actually triggered an interrupt. ESC-ESC from `aoaoe-chat` already worked
  (it calls `requestInterrupt()` directly); now stdin `/interrupt` does too.

- **Live status in conversation log (`src/console.ts`, `src/index.ts`)**:
  New `writeStatus()` method on `ReasonerConsole`. Phase transitions
  (sleeping, reasoning, executing) are written to the conversation log
  so `aoaoe-chat` shows daemon activity in real-time. Message acknowledgment:
  `[status] received your message, processing...` when user input is drained.

- **Remove blocking post-interrupt wait (`src/index.ts`)**: Replaced the 60s
  `waitForInput()` busy-poll loop with a simple continue-to-next-tick.
  Wakeable sleep picks up the user's follow-up message immediately via
  `fs.watch` instead of blocking the main loop.

- **`[status]` colorization in chat (`src/chat.ts`)**: Added `status` tag
  to the colorize regex so `[status]` entries render with dim styling.

- **12 new unit tests (`src/wake.test.ts`)**: timeout, wake on file change,
  abort signal, cleanup (no leaked timers/watchers), sequential calls,
  missing watch directory fallback.

## Working Items

### Remaining backlog
- **CI on PR creation** — add `pull_request` trigger to `.github/workflows/ci.yml` so tests run automatically on PR open/sync, validating before merge
- `OpencodeReasoner.shutdown()` doesn't clean up orphaned servers from prior runs
- `index.ts` dynamic imports in `testContext` that could be static
- `types.ts` `AoeSession.status` is `string` instead of union type
- Meta-level UX improvements (auto session naming, onboarding)
- IPC test isolation (make state dir configurable to prevent daemon race)
- Homebrew tap PAT needs `repo` scope for dispatch

## Completed

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
