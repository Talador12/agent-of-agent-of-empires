# Agent Guidelines for aoaoe

## Overview

aoaoe (Agent of Agent of Empires) is an autonomous supervisor daemon for
[agent-of-empires](https://github.com/njbrake/agent-of-empires) sessions.
Uses OpenCode or Claude Code as its reasoning engine. Observes agents via
tmux, decides when to intervene, acts.

## Quick Reference

```bash
npm run build            # tsc -> dist/
npm test                 # build + node --test (node:test stdlib)
npm run integration-test # end-to-end test with real aoe sessions (~30s)
npm start                # run daemon
aoaoe init               # detect environment, generate aoaoe.config.json
aoaoe --dry-run          # observe + reason, don't execute
aoaoe --verbose          # verbose logging
aoaoe tasks              # show task progress from persistent state
aoaoe test-context       # safe read-only scan of sessions + context discovery
aoaoe-chat               # interactive chat UI
```

## Architecture

```
Poller (aoe CLI + tmux capture)
  -> Reasoner (OpenCode SDK or Claude Code subprocess)
    -> Executor (tmux send-keys, aoe CLI commands)
```

Three loops: poll sessions, reason about observations, execute actions. The
reasoner gets a system prompt defining the supervisor role + per-session
project context (auto-discovered AI instruction files from each session's
resolved directory).

The main loop is split into two layers:
- **`loop.ts`** — pure tick logic (poll -> reason -> execute + policy tracking).
  Testable with MockPoller/MockReasoner/MockExecutor. No UI, no IPC.
- **`index.ts`** — `daemonTick()` wraps `loop.ts` tick() with dashboard, status
  line, IPC state file, console output, and interrupt support.

## Source Layout

| File | Purpose |
|------|---------|
| `src/index.ts` | Main daemon loop, `daemonTick()` wrapper, subcommands (init, register, tasks, status, config, test-context) |
| `src/loop.ts` | Extracted tick logic (poll -> reason -> execute), testable with mocks |
| `src/config.ts` | Config loader, CLI arg parser, env validation |
| `src/types.ts` | All interfaces — SessionSnapshot, Observation, Action, Reasoner, AoaoeConfig |
| `src/poller.ts` | `aoe list --json` + `tmux capture-pane`, SHA-256 diff detection |
| `src/context.ts` | `discoverContextFiles`, `resolveProjectDir`, `loadSessionContext`, caching |
| `src/task-manager.ts` | Task orchestration: load definitions, persistent state, session reconciliation |
| `src/executor.ts` | Action dispatch — send_input, start/stop/restart, create/remove, report_progress, complete_task |
| `src/tui.ts` | In-place terminal UI with scroll region, resize, activity buffer |
| `src/activity.ts` | User activity detection via `tmux list-clients` |
| `src/message.ts` | Message classification, formatting, receipts, skip-sleep logic |
| `src/wake.ts` | Wakeable sleep using `fs.watch` — message latency ~100ms |
| `src/notify.ts` | Webhook + Slack notification dispatcher for daemon events |
| `src/health.ts` | HTTP health check endpoint (GET /health returns JSON status) |
| `src/colors.ts` | Shared ANSI color/style constants |
| `src/config-watcher.ts` | Config hot-reload — fs.watch on config file, safe field merge |
| `src/tui-history.ts` | Persisted TUI history — JSONL file with rotation, load/append/replay |
| `src/export.ts` | Timeline export — merges actions.log + tui-history into JSON/Markdown |
| `src/tail.ts` | `aoaoe tail` — live-stream daemon activity to a separate terminal |
| `src/stats.ts` | `aoaoe stats` — aggregate daemon statistics from actions + history |
| `src/replay.ts` | `aoaoe replay` — play back tui-history.jsonl like a movie with timing |
| `src/prompt-watcher.ts` | Reactive permission prompt clearing via `tmux pipe-pane` |
| `src/reasoner/index.ts` | `createReasoner()` factory |
| `src/reasoner/prompt.ts` | `buildSystemPrompt()`, `formatObservation()`, `detectPermissionPrompt()` |
| `src/reasoner/parse.ts` | Response parsing, JSON extraction, action validation |
| `src/reasoner/opencode.ts` | OpenCode HTTP backend (native `fetch` to `opencode serve`) |
| `src/reasoner/claude-code.ts` | Claude Code subprocess backend (`claude --print`) |
| `src/chat.ts` | Interactive chat UI entry point (`aoaoe-chat`) |
| `src/dashboard.ts` | CLI status table with per-pane tasks + countdown |
| `src/daemon-state.ts` | IPC state file (`~/.aoaoe/daemon-state.json`) + interrupt flag + debounce |
| `src/task-parser.ts` | Parse OpenCode TODO patterns, model/context/cost from pane output |
| `src/task-cli.ts` | `aoaoe task` subcommand — list, start, stop, edit, new, rm |
| `src/console.ts` | Conversation log, narrated observations, friendly errors |
| `src/input.ts` | Stdin listener with inject() for post-interrupt text |
| `src/init.ts` | `aoaoe init`: auto-discover tools, sessions, reasoner; generate config; auto-start opencode serve |
| `src/session-summarizer.ts` | Plain-English activity digests from tmux output (no LLM) |
| `src/conflict-detector.ts` | Cross-session file edit conflict detection + auto-resolution |
| `src/goal-detector.ts` | Heuristic goal completion detection from git/test/todo signals |
| `src/cost-budget.ts` | Per-session cost budgets with auto-pause enforcement |
| `src/activity-heatmap.ts` | Per-session activity sparklines using Unicode block characters |
| `src/audit-trail.ts` | Structured JSONL audit log of all daemon decisions |
| `src/fleet-snapshot.ts` | Periodic fleet state snapshots for time-travel debugging |
| `src/budget-predictor.ts` | Predictive budget exhaustion from cost burn rate regression |
| `src/task-retry.ts` | Auto-retry failed tasks with exponential backoff + jitter |
| `src/audit-search.ts` | Structured audit trail search by type, session, time, keyword |
| `src/adaptive-poll.ts` | Dynamic poll interval — speeds up when active, slows when idle |
| `src/fleet-forecast.ts` | Fleet-wide cost forecasting from aggregated budget predictions |
| `src/session-priority.ts` | Session priority queue by health, staleness, error, stuck state |
| `src/notify-escalation.ts` | Progressive notification escalation: normal → elevated → critical |
| `src/drift-detector.ts` | Goal drift detection via keyword overlap heuristic |
| `src/goal-progress.ts` | Task % completion estimation from multi-signal heuristics |
| `src/session-pool.ts` | Concurrent active session pool limits with queuing |
| `src/reasoner-cost.ts` | Per-reasoning-call token usage and cost tracking |
| `src/anomaly-detector.ts` | Z-score anomaly detection across fleet session metrics |
| `src/fleet-sla.ts` | Fleet health SLA monitoring with sliding window + breach alerts |
| `src/progress-velocity.ts` | Progress velocity tracking + ETA estimation per task |
| `src/dep-scheduler.ts` | Dependency-aware pool scheduling with capacity limits |
| `src/shell.ts` | Child process helpers |
| `src/integration-test.ts` | End-to-end integration test (real aoe sessions, tmux, daemon) |

## Key Design Decisions

### Two usage modes for aoe
- **Single-repo**: User runs `aoe` from inside a project. `session.path` points to the project directly.
- **Meta-level**: User runs `aoe` from a parent dir (e.g. `~/repos/`), manually names sessions to match projects. All sessions share the same `path`. `resolveProjectDir()` searches 2 levels deep to find the actual project dir by matching the session title.

### sessionDirs config
Explicit session title -> project directory mapping via `sessionDirs` in config.
Checked first in `resolveProjectDir()` before heuristic filesystem search.
Supports absolute and relative paths, case-insensitive title matching.
Falls back to heuristic when key not found or mapped path doesn't exist on disk.

### Context loading
Auto-discovers AI instruction files from each session's project directory.
One `readdir` call, pattern match, done. Loads `AGENTS.md` + `claude.md`
first, then other AI tool files (`*rules`, `*instructions*`, `.aider*`,
`CODEX.md`, `CONTRIBUTING.md`), known nested paths, user extras, and
parent directory group-level `claude.md`.

De-duplication uses device+inode (handles macOS/Windows case-insensitive FS
and Linux case-sensitive FS correctly). Budget: 8KB per file, 24KB per
directory, cached 60s.

### Intelligence modules (v0.196+)
Twenty-two modules run every daemon tick without LLM calls:

- **SessionSummarizer** (`session-summarizer.ts`): pattern-based activity
  classification (coding, testing, building, committing, error, idle, etc.)
  with priority-ranked pattern matching. Exposed via `/activity`.

- **ConflictDetector** (`conflict-detector.ts`): tracks file edits per
  session in a sliding time window (default 10 min). When 2+ sessions edit
  the same code file, logs a conflict alert and auto-pauses the lower-priority
  session. `resolveConflicts()` uses explicit priority or edit-count fallback.
  Exposed via `/conflicts`.

- **Goal completion detector** (`goal-detector.ts`): scans new output for
  completion signals (git push, tests passing, version bumps, all TODOs done,
  explicit "done" messages, idle-after-progress). Aggregates confidence with
  diminishing returns. Auto-completes tasks above 0.7 threshold.

- **Cost budget enforcer** (`cost-budget.ts`): compares parsed `$N.NN` cost
  against `costBudgets.globalBudgetUsd` or per-session overrides. Auto-pauses
  tasks that exceed budget.

- **ActivityTracker** (`activity-heatmap.ts`): records change events per
  session in fixed-width time buckets (default 1min, 30 buckets). Renders
  Unicode sparklines (▁▂▃▄▅▆▇█). Exposed via `/heatmap`.

- **Audit trail** (`audit-trail.ts`): structured JSONL log of every daemon
  decision — reasoner actions, auto-completions, budget pauses, conflict
  detections, operator commands. Rotates at 50MB. Exposed via `/audit [N]`
  and `/audit-stats`.

- **Fleet snapshots** (`fleet-snapshot.ts`): periodic auto-save of full
  fleet state (sessions, tasks, health, costs, summaries) every ~10min.
  Supports `diffFleetSnapshots()` for time-travel comparison. Manual trigger
  via `/fleet-snap`.

- **BudgetPredictor** (`budget-predictor.ts`): records cost samples per
  session each tick, computes $/hr burn rate via linear regression, predicts
  time-to-budget-exhaustion. Alerts when exhaustion is imminent (<30min).
  Exposed via `/budget-predict`.

- **TaskRetryManager** (`task-retry.ts`): auto-retries failed tasks with
  exponential backoff + jitter. Configurable max retries (default 3), base
  delay (60s), max delay (30min). Exhausted tasks are logged. Exposed via
  `/retries`.

- **Audit search** (`audit-search.ts`): structured search of the audit
  trail by type, session, keyword, time range. Supports `last:2h`,
  `type:auto_complete`, `session:adventure`. Exposed via `/audit-search`.

- **AdaptivePollController** (`adaptive-poll.ts`): dynamic poll interval.
  Speeds up (min 5s) after 2+ consecutive active ticks; slows down (max 60s)
  after 3+ consecutive idle ticks. Resets to base on operator input. Replaces
  the fixed `config.pollIntervalMs` in the sleep call. `/poll-status`.

- **Fleet forecast** (`fleet-forecast.ts`): aggregates all session budget
  predictions into total fleet burn rate, projected daily/weekly cost,
  earliest exhaustion, and over-budget/imminent session lists. `/fleet-forecast`.

- **Session priority queue** (`session-priority.ts`): ranks sessions by
  urgency using weighted scoring (error=100, stuck=80, failed=70, low
  health, staleness, user-active=-200). `/priority`.

- **Notification escalation** (`notify-escalation.ts`): progressive
  escalation of stuck-task notifications. Normal → elevated (after N
  notifications) → critical (after more). Supports separate webhook URLs
  per escalation level (DM, SMS, pager). Cooldown between notifications.
  `/escalations`.

- **Drift detector** (`drift-detector.ts`): compares goal keywords against
  recent session output. If fewer than 15% of goal keywords appear in output,
  flags the session as drifted. `/drift`.

- **Goal progress estimator** (`goal-progress.ts`): multi-signal % completion.
  Weighs bullet-point goal items matched, progress entry count, elapsed time,
  and output patterns (git push, tests passing). `/goal-progress`.

- **Session pool manager** (`session-pool.ts`): caps concurrent active
  sessions. Queues pending tasks when at capacity, activates oldest first
  when a slot opens. Respects `dependsOn` constraints. `/pool`.

- **Reasoner cost tracker** (`reasoner-cost.ts`): records input/output tokens
  per reasoning call. Computes avg tokens, cost per call, calls/hr, cost/hr.
  `/reasoner-cost`.

- **Anomaly detector** (`anomaly-detector.ts`): z-score outlier detection
  across fleet metrics (cost rate, activity rate, error count, idle duration).
  Flags sessions >2σ from fleet mean. `/anomaly`.

- **Fleet SLA monitor** (`fleet-sla.ts`): tracks fleet-wide health over a
  sliding window. Alerts when average health drops below threshold (default
  50). Cooldown between alerts. `/sla`.

- **Progress velocity tracker** (`progress-velocity.ts`): records progress %
  samples per task each tick, computes velocity (%/hr) and ETA. Detects
  acceleration/deceleration/stall trends. `/velocity`.

- **Dependency-aware scheduler** (`dep-scheduler.ts`): evaluates pending
  tasks against dependency graph and pool capacity. Returns activate/block/skip
  actions per task. `/schedule`.

All modules are instantiated in `main()`. `daemonTick()` receives the
`intelligence` parameter for change-gated modules. SLA, velocity, adaptive
poll, and fleet snapshots run in the main loop after each tick.

### How to add a new TUI slash command

1. **`src/input.ts`**: Add handler type, private field, `on<Name>(handler)`
   registration method, and `case "/<name>":` in `handleCommand()`.
2. **`src/index.ts`**: Wire with `input.on<Name>(() => { ... })` inside the
   `if (tui) { ... }` block (starts around line 543).
3. **`src/tui.ts`**: Add any state fields and getter/setter methods.
4. For per-tick processing, add logic in `daemonTick()` after observation
   changes are available (inside the `if (intelligence && ...)` block).

### Testing
- 3038 unit tests across 60+ files, `node:test` (stdlib, zero deps)
- Includes e2e loop tests with MockPoller/MockReasoner/MockExecutor
- Integration test (`npm run integration-test`): creates real AoE sessions,
  starts daemon, verifies observation + send-keys + context discovery, cleans up.
  Requires aoe, opencode, tmux on PATH. ~30s.
- Run: `npm test` (unit) or `npm run integration-test` (e2e)

## Dependencies
- Zero runtime dependencies. Uses Node stdlib + native `fetch` for OpenCode HTTP API.
- `typescript`, `@types/node` — dev only

## CI/CD
- GitHub Actions: build + test on Node 20 + 22
- On tag push (v*): npm publish + GitHub Release
- Homebrew tap auto-updates on release via repository-dispatch

## AI Working Context

Two files per repo:
- **`AGENTS.md`** (this file) — how to work on this project. Stable, changes slowly.
- **`claude.md`** — what we're working on. Status, roadmap, what's next. Update every commit.
