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
| `src/observation-cache.ts` | LLM response caching via observation content hashing |
| `src/fleet-rate-limiter.ts` | Fleet-wide API spend rate limiting (hourly + daily caps) |
| `src/context-compressor.ts` | Observation compression: summarize old lines, keep recent |
| `src/recovery-playbook.ts` | Auto-execute recovery steps when health drops |
| `src/lifecycle-analytics.ts` | Task lifecycle stats: throughput, duration, success rate |
| `src/cost-attribution.ts` | Cost breakdown by repo, status, efficiency |
| `src/goal-decomposer.ts` | Auto-split complex goals into sub-tasks with dependencies |
| `src/priority-reasoning.ts` | Priority-aware observation filtering for reasoner calls |
| `src/session-memory.ts` | Persistent per-session learnings across daemon restarts |
| `src/dep-graph-viz.ts` | ASCII dependency graph visualization + cycle detection |
| `src/approval-queue.ts` | Operator approval queue for batched async human review |
| `src/fleet-diff.ts` | Fleet snapshot comparison CLI + TUI command |
| `src/session-templates.ts` | Pre-configured session profiles (frontend, backend, infra, etc.) |
| `src/difficulty-scorer.ts` | Task complexity estimation from goal analysis |
| `src/smart-nudge.ts` | Context-aware nudge generation using session memory |
| `src/fleet-utilization.ts` | Per-hour fleet activity heatmap for capacity planning |
| `src/template-detector.ts` | Auto-detect session template from repo file patterns |
| `src/fleet-search.ts` | Ranked full-text search across all session outputs |
| `src/nudge-tracker.ts` | Nudge effectiveness tracking with response time stats |
| `src/difficulty-allocator.ts` | Difficulty-weighted pool slot allocation |
| `src/session-graduation.ts` | Auto-promote sessions confirm→auto based on track record |
| `src/approval-workflow.ts` | Route low-confidence decisions through approval queue |
| `src/goal-refiner.ts` | Learn from completed tasks to suggest goal improvements |
| `src/fleet-export.ts` | Generate self-contained HTML fleet report |
| `src/service-generator.ts` | Generate systemd/launchd service files for boot start |
| `src/cli-completions.ts` | Shell autocomplete scripts (bash, zsh, fish) |
| `src/session-replay.ts` | Replay session activity timeline from audit trail |
| `src/workflow-engine.ts` | Multi-session workflow DAG with fan-out/fan-in stages |
| `src/multi-reasoner.ts` | Route sessions to different LLM backends by config/template/difficulty |
| `src/workflow-templates.ts` | Pre-built workflow definitions (CI/CD, feature-dev, refactor, incident) |
| `src/session-checkpoint.ts` | Save + restore transient daemon state across restarts |
| `src/token-quota.ts` | Per-model token quotas for fleet-wide rate limiting |
| `src/ab-reasoning.ts` | A/B reasoning: compare two backends, track which wins |
| `src/workflow-cost-forecast.ts` | Estimate workflow cost from difficulty + historical rates |
| `src/workflow-chain.ts` | Chain workflows with cross-workflow dependencies |
| `src/fleet-federation.ts` | Multi-host fleet coordination via HTTP health endpoints |
| `src/output-archival.ts` | Compress + archive old session outputs to gzipped files |
| `src/runbook-generator.ts` | Auto-generate operator runbooks from audit trail patterns |
| `src/alert-rules.ts` | Custom fleet alerting rules with severity + cooldown |
| `src/alert-rule-dsl.ts` | User-defined alert rules via config DSL |
| `src/alert-composer.ts` | AND/OR composition of alert conditions |
| `src/health-forecast.ts` | Linear regression health trend prediction + SLA breach ETA |
| `src/session-tail.ts` | Live tail of session output with pattern highlighting |
| `src/workflow-viz.ts` | ASCII DAG rendering for workflows + chains |
| `src/metrics-export.ts` | Prometheus-compatible /metrics text exposition |
| `src/fleet-grep.ts` | Regex search across gzipped output archives |
| `src/runbook-executor.ts` | Step-by-step execution of generated runbooks |
| `src/session-clone.ts` | Clone sessions for A/B experimentation |
| `src/goal-similarity.ts` | Jaccard similarity detection for overlapping goals |
| `src/cost-allocation-tags.ts` | Tag sessions by team/project for cost grouping |
| `src/predictive-scaling.ts` | Auto-adjust pool size from utilization patterns |
| `src/session-snapshot-diff.ts` | Line-level diff between session output snapshots |
| `src/session-tag-manager.ts` | Key-value tag store for sessions (team, project, etc.) |
| `src/session-idle-detector.ts` | Detect prolonged idle sessions, escalate nudge → pause → reclaim |
| `src/goal-conflict-resolver.ts` | Cross-session goal conflict analysis via keyword + file + dependency overlap |
| `src/fleet-leaderboard.ts` | Rank sessions by composite productivity score (completion, velocity, cost) |
| `src/session-health-history.ts` | Rolling-window health score tracker per session with sparkline trend viz |
| `src/cost-anomaly-throttle.ts` | Auto-throttle poll rate for cost-anomalous sessions (EMA burn rate vs fleet avg) |
| `src/smart-session-naming.ts` | Auto-generate descriptive session titles from repo path + goal keywords |
| `src/operator-shift-handoff.ts` | Structured handoff notes with fleet state, alerts, recommendations (TUI + markdown) |
| `src/session-dep-auto-detect.ts` | Infer inter-session dependencies from goals, files, repos, explicit declarations |
| `src/cost-forecast-alert.ts` | Project costs at daily/weekly/monthly intervals + fire alerts on threshold breach |
| `src/fleet-event-bus.ts` | Typed pub/sub event bus (22 event types, wildcard subs, history, error-resilient) |
| `src/goal-completion-verifier.ts` | Post-completion regression scanner (7 positive + 8 negative output patterns) |
| `src/session-output-diff.ts` | Line-level diff between consecutive captures (LCS + tail-diff, ANSI stripping) |
| `src/session-heartbeat.ts` | Tmux pane crash detection via output hash tracking (alive/stale/unresponsive/dead) |
| `src/action-replay.ts` | Step through daemon decision history with tick grouping, seek, filter-by-session |
| `src/fleet-config-profiles.ts` | Named config presets (dev, ci, incident, conservative, overnight) + user profiles |
| `src/daemon-diagnostics.ts` | /doctor self-diagnostics: node, config, state, reasoner, poll, uptime, sessions |
| `src/session-state-machine.ts` | 11-state lifecycle state machine with 31 guarded transitions |
| `src/incremental-context.ts` | Mtime/size fingerprinting for skip-unchanged context file reloads |
| `src/daemon-metrics-histogram.ts` | Per-tick latency distribution (p50/p90/p99) with ASCII histograms |
| `src/session-peer-review.ts` | Cross-session code review gating with approve/reject/expire workflow |
| `src/fleet-warm-standby.ts` | Pre-warm session slots with loaded context for instant task activation |
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
Sixty-three modules run every daemon tick without LLM calls:

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

- **Observation cache** (`observation-cache.ts`): SHA-256 content hash
  deduplication of LLM reasoning calls. 5min TTL, 100 entries max. `/cache`.

- **Fleet rate limiter** (`fleet-rate-limiter.ts`): caps fleet-wide API
  spend with hourly ($10 default) and daily ($100) limits. Cooldown on
  breach. `/rate-limit`.

- **Context compressor** (`context-compressor.ts`): compresses old observation
  lines into scored summaries, keeping recent lines detailed. Fits within
  token budgets. Used pre-reasoning to reduce LLM context.

- **Recovery playbook** (`recovery-playbook.ts`): auto-execute recovery
  steps when health drops. 4-step default: nudge → restart → pause → escalate.
  Resets on health recovery, respects maxRetries. `/recovery`.

- **Session idle detector** (`session-idle-detector.ts`): tracks per-session
  last-activity timestamps. Flags sessions idle beyond configurable threshold
  with escalating recommendations: nudge (1x), pause (2x), reclaim (3x).
  Stateful via `createIdleDetector()`. `/idle-detect`.

- **Goal conflict resolver** (`goal-conflict-resolver.ts`): cross-session
  goal conflict analysis. Extracts keywords from goals, computes Jaccard
  similarity, checks file overlap, detects dependency cycles. Severity
  ranking (low/medium/high) with actionable suggestions. `/goal-conflicts`.

- **Fleet leaderboard** (`fleet-leaderboard.ts`): ranks sessions by composite
  productivity score: 40% completion rate, 30% velocity (normalized), 30%
  cost efficiency. Medal emojis for top 3. `/leaderboard`.

- **Session health history** (`session-health-history.ts`): rolling-window
  health score tracker per session. Records samples, computes trend
  (improving/degrading/stable) from first-half vs second-half average.
  Renders Unicode sparklines. Worst-health-first sorting. `/health-history`.

- **Cost anomaly throttle** (`cost-anomaly-throttle.ts`): monitors per-session
  cost burn rates via EMA smoothing, compares against fleet average. When
  a session exceeds threshold (default 3x fleet avg), auto-increases its
  poll interval multiplier. Auto-unthrottles when costs normalize. `/cost-throttle`.

- **Smart session naming** (`smart-session-naming.ts`): generates descriptive
  session title suggestions from repo path + goal text. 5 strategies:
  repo-verb, repo-noun, verb-noun, repo-verb-noun, basename fallback.
  Deduplicates against existing titles. `/suggest-name <repo> [goal]`.

- **Operator shift handoff** (`operator-shift-handoff.ts`): generates structured
  handoff notes for operator shift changes. Aggregates fleet state, session
  health/cost, failed/paused alerts, pending approvals, and actionable
  recommendations. TUI and markdown output formats. `/handoff`.

- **Session dependency auto-detect** (`session-dep-auto-detect.ts`): infers
  inter-session dependencies from explicit declarations, goal text references
  ("after X", "blocked by X"), shared file edits, and repo path overlap.
  Confidence-ranked (high/medium/low), deduplicated. `/auto-deps`.

- **Cost forecast alert** (`cost-forecast-alert.ts`): projects session costs
  at daily/weekly/monthly intervals from current spend + burn rate. Fires
  alerts when projections exceed configurable thresholds ($25/day, $100/week,
  $300/month default). Critical severity for imminent breaches (<2h). `/cost-forecast`.

- **Fleet event bus** (`fleet-event-bus.ts`): typed pub/sub event system
  with 22 event types covering sessions, tasks, costs, health, fleet, approvals,
  and reasoner activity. Wildcard subscriptions, bounded history buffer with
  type filtering, event counting, error-resilient delivery. `/event-bus`.

- **Goal completion verifier** (`goal-completion-verifier.ts`): post-completion
  regression scanner. Checks last 50 lines of output against 7 positive
  patterns (tests passing, build success, git push, PR activity, zero errors)
  and 8 negative patterns (failures, crashes, conflicts, reverts, permission
  errors). Returns confirm-complete / revert-to-active / needs-review. `/verify-goals`.

- **Session output diff** (`session-output-diff.ts`): line-level diff between
  consecutive session output captures. LCS-based matching for small outputs
  (<500 lines), tail-diff for large. Context-window filtering (default 2 lines),
  ANSI code stripping. `/output-diff <session>`.

- **Session heartbeat** (`session-heartbeat.ts`): detects tmux pane crashes
  independent of AoE status. Tracks output hash changes per tick; escalates
  through alive → stale → unresponsive → dead based on consecutive missed
  ticks (configurable thresholds: 5/10/20 default). `/heartbeat`.

- **Action replay** (`action-replay.ts`): post-mortem debugger for daemon
  decisions. Loads action log JSONL, groups by tick via timestamp proximity,
  supports seek/step/filter-by-session navigation. Stats: total ticks,
  actions, failures, sessions involved. `/replay [stats|next|prev|N|session]`.

- **Fleet config profiles** (`fleet-config-profiles.ts`): named config presets
  for different workload types. 5 built-in profiles: dev (fast iteration),
  ci (no confirmation, auto-destructive), incident (fastest polls, cautious),
  conservative (dry run, confirm everything), overnight (unattended, budget-conscious).
  User-defined profiles via config. `/profiles [name]`.

- **Daemon diagnostics** (`daemon-diagnostics.ts`): `/doctor` self-diagnostics.
  Checks node version (>=20), config file existence, state directory, reasoner
  backend validity, poll interval sanity (not <1s or >2m), uptime, tick count,
  session count, actions log. Severity-ranked (ok/warn/error/info) with
  actionable suggestions. `/doctor`.

- **Session state machine** (`session-state-machine.ts`): formalizes 11
  session lifecycle states with 31 valid guarded transitions. States: pending,
  starting, active, idle, stuck, error, paused, completing, completed, failed,
  removed. Blocks illegal transitions (e.g. completed→active). Transition
  checking via `/state-machine active→idle`. `/state-machine [state]`.

- **Incremental context** (`incremental-context.ts`): tracks file mtime +
  size fingerprints per tick. Skips re-reads for unchanged files, reducing
  I/O on large fleets. Reports cache hit rate, reload/skip counts, recent
  change details. `/context-stats`.

- **Daemon metrics histogram** (`daemon-metrics-histogram.ts`): per-tick
  latency distribution for poll, reason, execute, and tick-total phases.
  Records timing samples (capped at 500), computes percentiles (p50/p90/p99),
  renders ASCII histograms with 8 buckets. `/metrics-hist`.

- **Session peer review** (`session-peer-review.ts`): cross-session code
  review gating. Operator requests reviews, reviewer sessions approve or
  reject with feedback. Stale reviews auto-expire. Gates task completion
  on peer approval. `/peer-review [request|approve|reject]`.

- **Fleet warm standby** (`fleet-warm-standby.ts`): pre-warm session slots
  with loaded context for instant task activation. Pool-limited (default 5),
  TTL-based expiry, repo-matched claiming. Reduces cold-start time for
  new tasks. `/warm-standby [warm|claim]`.

All modules are instantiated in `main()`. `daemonTick()` receives the
`intelligence` parameter carrying all module instances. The reasoner pipeline
(wrappedReasoner) uses intelligence gates in this order:
1. Fleet rate limiter — blocks reasoning when hourly/daily API spend limits hit
2. Observation cache — returns cached result for duplicate observations
3. Priority filter — trims observation to highest-priority sessions only
4. Context compressor — compresses old pane output to fit token budgets
5. Reasoner call — send compressed, filtered observation to LLM
6. Cost tracking — record tokens/cost, update rate limiter, cache result

Post-tick in main loop: SLA monitor, velocity tracker, recovery playbook
(auto-nudge/pause/escalate on health drop), dep scheduler (auto-activate
pending tasks when prerequisites complete), fleet utilization, fleet snapshots.

Stuck-task handler: tracks nudge effectiveness via NudgeTracker, escalates
via EscalationManager (normal→elevated→critical), clears escalation on
progress or pause.

Post-reasoning: approval workflow gates risky/low-confidence actions
through the ApprovalQueue. `remove_agent`/`stop_session` always require
approval. Low-confidence actions are queued for operator review.

Per-tick in main loop: GraduationManager evaluates each session and
auto-promotes (confirm→auto) or demotes (auto→confirm) based on success
rate. Goal refiner available via `/refine`. Fleet export via `/export`.

### How to add a new TUI slash command

1. **`src/input.ts`**: Add handler type, private field, `on<Name>(handler)`
   registration method, and `case "/<name>":` in `handleCommand()`.
2. **`src/index.ts`**: Wire with `input.on<Name>(() => { ... })` inside the
   `if (tui) { ... }` block (starts around line 543).
3. **`src/tui.ts`**: Add any state fields and getter/setter methods.
4. For per-tick processing, add logic in `daemonTick()` after observation
   changes are available (inside the `if (intelligence && ...)` block).

### CLI subcommands
- `aoaoe service` — generate systemd/launchd service file for boot start
- `aoaoe completions <bash|zsh|fish>` — generate shell autocomplete script

### Reasoning Pipeline Gates (8 total)
0. Token quota (per-model) → 1. Fleet rate limiter ($) → 2. Observation cache →
3. Priority filter → 4. Context compressor → 5. LLM call → 6. Approval workflow →
7. Cost + token tracking

### Testing
- 3819 unit + integration + property + stress tests across 120+ files, `node:test` (stdlib, zero deps)
- `pipeline-integration.test.ts` — 28 tests exercising the full autonomous pipeline
  end-to-end: reasoning gates, graduation, recovery, scheduling, escalation,
  SLA, budgets, goal completion, summarization, conflict detection, velocity,
  and goal refinement — using real module instances (not mocks)
- `error-correction.test.ts` — 9 tests for session error state misdetection fix
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

## Session Workflow

When asked to continue work on this project:
- **Do multiple roadmap items per request.** Ship 3 features in a single pass:
  module + tests + wiring + docs. Don't stop at one.
- **Add new roadmap ideas** to `claude.md` Ideas Backlog that are in line with the
  project's direction (fleet intelligence, observability, cost management,
  workflow orchestration, developer experience). Keep the backlog at 15-25 items.
- **Update both files every commit**: `claude.md` (version, shipped items, counts)
  and `AGENTS.md` (source layout table, intelligence module descriptions, test counts).
- Follow the established pattern: standalone module → test → wire into input.ts +
  index.ts → update docs. Each module is a pure function or stateful class,
  zero runtime deps, includes a `format*()` function returning `string[]` for TUI.
- **Add this response to AGENTS.md** — every session's shipped summary goes into
  the development session summary table at the bottom.

### v3.6.0 Session Response

Shipped 3 features in v3.6.0 (34 new tests, 3 modules, 3 TUI commands):
1. **`operator-shift-handoff.ts`** + 10 tests — Structured handoff notes aggregating
   fleet state, session health/cost, failed/paused alerts, pending approvals,
   actionable recommendations. TUI (`/handoff`) + clipboard-ready markdown output.
2. **`session-dep-auto-detect.ts`** + 10 tests — Auto-detect inter-session
   dependencies via explicit declarations, goal text references, shared file
   edits, and repo path overlap. Confidence-ranked, deduplicated. `/auto-deps`.
3. **`cost-forecast-alert.ts`** + 14 tests — Project costs at daily/weekly/monthly
   intervals from burn rate. Alerts on threshold breaches ($25/day, $100/week,
   $300/month). Critical severity when breach is <2h away. `/cost-forecast`.

Also shipped in prior session (v3.4.0 + v3.5.0):
- v3.4.0: SessionIdleDetector, GoalConflictResolver, FleetLeaderboard (33 tests)
- v3.5.0: SessionHealthHistory, CostAnomalyThrottle, SmartSessionNaming (44 tests)

Running total: 93 source modules, 94 TUI commands, 3654 tests, zero runtime deps.

### v3.7.0 Session Response

Shipped 3 features in v3.7.0 (36 new tests, 3 modules, 3 TUI commands):
1. **`fleet-event-bus.ts`** + 14 tests — Typed pub/sub event system with 22 event
   types (session/task/cost/health/fleet/approval/reasoner). Wildcard `*`
   subscriptions, bounded history buffer, type-filtered queries, event counting,
   error-resilient delivery that swallows subscriber exceptions. `/event-bus`.
2. **`goal-completion-verifier.ts`** + 11 tests — Post-completion regression
   scanner. Checks last 50 output lines against 7 positive + 8 negative patterns.
   Outputs confirm-complete / revert-to-active / needs-review with signal details. `/verify-goals`.
3. **`session-output-diff.ts`** + 11 tests — Line-level diff between consecutive
   session captures. LCS-based for small outputs, tail-diff for large (>500 lines).
   Context-window filtering, ANSI stripping, +/- display. `/output-diff <session>`.

Running total: 96 source modules, 97 TUI commands, 3690 tests, zero runtime deps.

### v3.8.0 Session Response

Shipped 3 features in v3.8.0 (45 new tests, 3 modules, 3 TUI commands):
1. **`session-heartbeat.ts`** + 14 tests — Tmux pane crash detection independent
   of AoE status. Tracks output hash changes per tick, escalates through
   alive → stale → unresponsive → dead (configurable at 5/10/20 ticks). `/heartbeat`.
2. **`action-replay.ts`** + 17 tests — Post-mortem debugger for daemon decisions.
   Loads action log JSONL, groups into ticks by timestamp, supports seek/step
   forward+backward/filter-by-session navigation. Stats summary. `/replay`.
3. **`fleet-config-profiles.ts`** + 14 tests — 5 built-in config presets (dev, ci,
   incident, conservative, overnight) + user-defined profiles. Each preset
   overrides poll intervals, policies, verbosity, confirm mode. `/profiles`.

Milestone: **100 TUI commands, 99 source modules, 3735 tests, zero runtime deps.**

### v3.9.0 Session Response

Shipped 3 features in v3.9.0 (43 new tests, 3 modules, 3 TUI commands):
1. **`daemon-diagnostics.ts`** + 12 tests — `/doctor` self-diagnostics. Checks
   node version, config file, state dir, reasoner backend, poll interval
   sanity, uptime, tick count, session count, actions log. Severity-ranked
   with actionable suggestions. `/doctor`.
2. **`session-state-machine.ts`** + 19 tests — 11-state session lifecycle with
   31 guarded transitions. Blocks illegal state changes (e.g. completed→active).
   Supports transition checking: `/state-machine active→idle`. `/state-machine`.
3. **`incremental-context.ts`** + 12 tests — Mtime/size fingerprinting to skip
   re-reads for unchanged context files. Cache hit rate tracking, reload/skip
   counts. Reduces I/O on large fleets. `/context-stats`.

Running total: 102 source modules, 103 TUI commands, 3778 tests, zero runtime deps.

### v4.0.0 Session Response

Shipped 3 features in v4.0.0 (41 new tests, 3 modules, 3 TUI commands):
1. **`daemon-metrics-histogram.ts`** + 10 tests — Per-tick latency distribution
   for poll/reason/execute/tick-total phases. Percentiles (p50/p90/p99), ASCII
   histograms with 8 buckets, 500-sample rolling window. `/metrics-hist`.
2. **`session-peer-review.ts`** + 17 tests — Cross-session code review gating.
   Request/approve/reject reviews with feedback. Stale auto-expiry. Gates task
   completion on peer approval. `/peer-review`.
3. **`fleet-warm-standby.ts`** + 14 tests — Pre-warm session slots with loaded
   context for instant task activation. Pool-limited (5 default), TTL expiry,
   repo-matched claiming. `/warm-standby`.

Milestone: **v4.0.0 — 105 source modules, 106 TUI commands, 3819 tests, zero runtime deps.**

## AI Working Context

Two files per repo:
- **`AGENTS.md`** (this file) — how to work on this project. Stable, changes slowly.
- **`claude.md`** — what we're working on. Status, roadmap, what's next. Update every commit.

## Development Session Summary (v0.196 → v2.5.0)

A single extended AI-assisted development session shipped ~40 releases:

| Release | Theme | Key Deliverables |
|---------|-------|------------------|
| v0.196–v0.207 | Intelligence Modules | 51 standalone modules: summarizer, conflicts, goals, budgets, heatmap, audit, snapshots, predictions, retry, search, adaptive poll, forecast, priority, escalation, drift, progress, pool, reasoner cost, anomaly, SLA, velocity, dep-scheduler, cache, rate-limiter, compressor, recovery, lifecycle, cost-attribution, goal-decomposer, priority-reasoning, session-memory, dep-graph, approval-queue, fleet-diff, templates, difficulty, smart-nudge, utilization, template-detector, fleet-search, nudge-tracker, difficulty-allocator |
| v0.208–v0.210 | Deep Integration | All modules wired into autonomous 8-gate reasoning pipeline + per-tick loop |
| v0.211 | Integration Tests | 28 pipeline integration tests proving end-to-end wiring |
| v1.0.0 | Production | Bug fixes (error misdetection, dashboard linking), v1 tag |
| v1.1–v1.2 | Infrastructure | ServiceGenerator, CLICompletions, SessionReplay, WorkflowEngine + wiring |
| v1.3 | Quality | README update, 26 property-based fuzz tests (zero bugs) |
| v1.4–v1.5 | Multi-Reasoner | MultiReasoner routing, WorkflowTemplates, SessionCheckpoints, TokenQuotas + wiring |
| v1.6–v1.7 | A/B + Workflows | A/B reasoning, workflow cost forecast, workflow chains + wiring |
| v1.8 | Stress Tests | 16 stress tests across 14 modules (zero bugs) |
| v1.9–v2.0 | Federation + Alerts | FleetFederation, OutputArchival, RunbookGenerator, CustomAlertRules + wiring, v2 tag |
| v2.1–v2.2 | DSL + Viz | AlertRuleDSL, HealthForecast, SessionTail, WorkflowViz + wiring |
| v2.5 | Platform Completion | MetricsExport, AlertComposer, FleetGrep, RunbookExecutor |
| v2.6–v3.3 | Deep Features | SessionClone, GoalSimilarity, CostAllocationTags, PredictiveScaling, SessionTagManager, SessionCompare, FleetSummaryReport, SessionTimeline, FleetChangelog |
| v3.4 | Fleet Intelligence | SessionIdleDetector, GoalConflictResolver, FleetLeaderboard |
| v3.5 | Observability + DX | SessionHealthHistory, CostAnomalyThrottle, SmartSessionNaming |
| v3.6 | Operations + Forecasting | OperatorShiftHandoff, SessionDepAutoDetect, CostForecastAlert |
| v3.7 | Events + Verification | FleetEventBus, GoalCompletionVerifier, SessionOutputDiff |
| v3.8 | Debugging + Config | SessionHeartbeat, ActionReplay, FleetConfigProfiles |
| v3.9 | Quality + Lifecycle | DaemonDiagnostics, SessionStateMachine, IncrementalContext |
| v4.0 | Performance + Governance | DaemonMetricsHistogram, SessionPeerReview, FleetWarmStandby |

**Totals**: 105 source modules, 120+ test files, 106 TUI commands, 20 CLI subcommands,
3819 tests, ~29,000 lines added, zero runtime dependencies.

**Architecture**: standalone module → test → wire into daemon loop → integration test.
8-gate reasoning pipeline: token quota → rate limit → cache → priority filter →
compress → LLM → approval → cost+token track. Per-tick: SLA, velocity, recovery,
dep-scheduler, graduation, workflow, alert rules, fleet utilization, fleet snapshots.
