# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.35.0

## Current Focus

490 tests across 25 files. v0.35.0 shipped: trust & safety features for production use.

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

## Backlog

- **CI on PR creation** — add `pull_request` trigger to `.github/workflows/ci.yml`
- `OpencodeReasoner.shutdown()` doesn't clean up orphaned servers from prior runs
- `index.ts` dynamic imports in `testContext` that could be static
- `types.ts` `AoeSession.status` is `string` instead of union type
- Homebrew tap PAT needs `repo` scope for dispatch

## Completed

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
