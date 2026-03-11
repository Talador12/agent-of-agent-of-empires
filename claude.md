# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.42.0

## Current Focus

590 tests across 28 files. v0.42.0 shipped: robustness — early NaN errors, resolveProjectDir cache, writeState debounce, dead export cleanup, discriminated union switch, empty catch fixes.

## Roadmap

### v0.43.0 — "UI Polish" (next)
OpenCode-inspired TUI overhaul. Minimalist + slick, smooth color design, not monochrome but not a rave.
- **Block-style rendering** — structured sections with visual hierarchy (OpenCode's panel approach)
- **Highlighted sections** — last-ran commands and recent AI decisions get visual emphasis
- **Scroll-through history** — navigate back through session activity without losing context
- **Persisted history per session** — survive restarts, pick up where you left off
- **Smooth color gradients** — tasteful use of full ANSI palette, easy on the eyes
- **Slick animations** — subtle transitions for phase changes, countdowns, new events
- Design principle: pizzaz without being annoying. Minimalist with confident color choices.

### v0.44.0+ — Ideas Backlog
- **Homebrew tap fix** — PAT needs `repo` scope for `peter-evans/repository-dispatch`
- **End-to-end testing** — daemon + chat running together (mock-based, canned reasoner)
- **Notification hooks** — Slack, webhook for significant events (errors, completions)
- **Multi-profile support** — manage multiple AoE profiles simultaneously
- **Web dashboard** — browser UI via `opencode web` (not wired yet)
- **README refresh** — update test counts, new features, architecture diagram

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

## Backlog

- Homebrew tap PAT needs `repo` scope for dispatch (tracked in roadmap)

## Completed

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
