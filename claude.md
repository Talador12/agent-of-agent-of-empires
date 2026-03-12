# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.58.0

## Current Focus

829 tests across 28 files. v0.58.0 shipped: End-to-end testing — `e2e.test.ts` validates the full daemon→IPC→chat pipeline with mock reasoner, no real processes.

## Roadmap

### v0.59.0+ — Ideas Backlog
- **Multi-profile support** — manage multiple AoE profiles simultaneously
- **Web dashboard** — browser UI via `opencode web` (not wired yet)
- **Persisted TUI history** — survive daemon restarts, scroll through history
- **Refactor config.ts deepMerge as casts** — safe but ugly, could use generics
- **Scroll-through history navigation in TUI**
- **Notification delivery retry** — optional retry with exponential backoff for failed webhook deliveries
- **Health check endpoint** — HTTP endpoint for monitoring (uptime, session count, last action)

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
