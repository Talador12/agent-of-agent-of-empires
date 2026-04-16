# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v7.5.0-dev

## Active Work (April 2026)

### Just shipped (this session)
- [x] **User-active false positive fix** - investigated three approaches:
  (a) window_activity - rejected, tracks ALL output including agent, not just user.
  (b) client_activity - CORRECT signal, tracks real user keystrokes only, tmux
  send-keys does NOT update it. Each terminal tab has its own tmux client so
  client_activity IS per-session when each session has its own terminal.
  Also added executor `lastNudgeByDaemon` tracking as safety net for edge cases
  where daemon activity could be misattributed.
  Root cause of original "all 5 show active" was coincidental - the user cycled
  through all windows at the same time, not a shared-client bug.
- [x] **Nudge dedup for reasoner** - observation now includes per-session nudge
  history (last 30min) from the NudgeTracker. The prompt tells the reasoner
  "do NOT repeat these messages - vary your approach or wait." Shows nudge count,
  effectiveness rate, time since last, and message preview per session.
- [x] **Rate limit cascade staggering** - executor now caps `send_input` actions
  per tick (default 2) and adds a configurable delay between sends (default 5s).
  Excess actions are logged as "deferred" and retried next tick. This prevents
  all agents from waking up and hitting the API at the same time. Config:
  `policies.maxSendInputsPerTick` and `policies.sendInputStaggerMs`, both
  hot-reloadable.
- [x] **Stale task reconciliation** - tasks file is now hot-reloaded via fs.watch.
  Editing aoaoe.tasks.json while the daemon runs instantly adds/removes/updates tasks
  without restart. TaskManager.reloadDefinitions() diffs new definitions against
  persistent state: adds new tasks, updates changed goals/tool/profile, removes
  tasks no longer in definitions (keeps completed for history). TUI shows reload
  summary in activity log.
- [x] **Task manager discovery bug** - loadTaskDefinitions() now searches ~/.aoaoe/
  and all sessionDirs paths (from config) for the tasks file, not just basePath.
  Previously the daemon running from ~/repos could not find tasks at
  ~/repos/github/agent-of-agent-of-empires/aoaoe.tasks.json.
- [x] **report_progress fallback** - progress summaries now always persist to
  ~/.aoaoe/progress.log even when taskManager is not configured. The action is
  marked as success instead of failing silently. No more "no task manager configured"
  with lost summaries.
- [x] **TUI input isolation** - user input box no longer hijacked by observer/reasoner
  logs. Root cause: `console.error()` calls in `input.ts` handleLine() wrote directly
  to stderr at the cursor position, corrupting the TUI input row. Also readline's
  `prompt()` fought with `paintInputLine()` for the last row. Fix: (1) added
  `InputLogHandler` callback that routes user feedback through `tui.log()` into the
  activity area, (2) when TUI active, readline output goes to a no-op Writable so it
  never touches the display, (3) user-submitted text now appears in activity log as
  `"(queued)you:"` tagged entries at the timestamp submitted.
- [x] **ANSI escape code garbage filter** - expanded `isMouseOrEscapeSequence()` to
  catch partial CSI parameter fragments (e.g. `123;52mf;148;`), bare SGR color codes
  (`38;5;117m`), and lines dominated by semicolons/digits/letters. These leak when
  tmux splits escape sequences across reads. Previously only full sequences were caught.
- [x] **Default model enforcement** (`model-config.ts` + 39 tests) - aoaoe can now
  enforce a specific model across all supervised opencode sessions. Set `defaultModel`
  in config (e.g. "Claude Opus 4.6") and aoaoe checks every 6 ticks. Sessions using
  the wrong model get switched via ctrl+x m keyboard automation. Protected sessions
  are skipped. Discovers available models from opencode config file at
  `~/.config/opencode/opencode.jsonc`.
- [x] Config fields: `defaultModel`, `defaultModelPriority` in AoaoeConfig
- [x] CLI flag: `--default-model <name>`, `--default-model-priority <level>`
- [x] TUI command: `/model` (show config + enforcement status), `/model set <name>`,
  `/model clear`
- [x] Audit trail: `model_enforcement` event type added
- [x] Executor: `restoreModel()` now public with configurable priority parameter
- [x] Config updated: `defaultModel: "Claude Opus 4.6"` in ~/.aoaoe/aoaoe.config.json
- [x] **Trust ladder fix** - protected session blocks no longer trigger trust demotion.
  Previously any blocked action (including correct blocks on protected sessions) counted
  as a failure and demoted the daemon to observe mode. Now demotion only happens when
  ALL actions in a tick fail (actionsOk === 0). This was the #1 operational blocker.
- [x] **opencode serve default model** - set `"model": "anthropic/claude-opus-4-6"` in
  `~/.config/opencode/opencode.jsonc` so the daemon's reasoner uses Claude Opus 4.6
  instead of Kimi K2.5 (the previous default). Dramatically improves reasoning quality
  for permission approval, session monitoring, and intervention decisions.
- [x] **Daemon running in autonomous mode** - supervising adventure + code-music sessions.
  Approving permission prompts, detecting idle sessions, nudging when stuck.

### Previously shipped (earlier sessions)
- [x] Tasks file trimmed to adventure + code-music only for initial test run
- [x] Config updated: protectedSessions for all non-target sessions, cost budgets ($50 global, $25/session)
- [x] `ensureServiceInstalled()` - auto-install launchd/systemd service on real daemon start

### In progress
- [x] Start aoaoe supervising adventure + code-music sessions - DONE, running in autopilot
- [ ] Verify sessions make sustained progress autonomously

### Roadmap (priority order)

**P0 - Core loop problems (making the daemon less useful than it should be):**

1. ~~Rate limit cascade starvation~~ DONE - executor caps send_input to 2/tick with
   5s stagger delay. Config: policies.maxSendInputsPerTick, policies.sendInputStaggerMs.

2. **report_progress goes nowhere** - the reasoner generates useful progress summaries
   (MR merged, test counts, commit SHAs) but `report_progress` always fails with
   `"no task manager configured"`. 12 failures in the action log. These summaries
   should persist somewhere useful: append to a progress.log, update claude.md in
   the target repo, or surface in the TUI activity area. Currently all that context
   is thrown away.

3. ~~"user active" conflates "window open" with "user typing"~~ DONE - executor
   tracks daemon-caused activity and bypasses userActive when it was our nudge.
4. ~~Repetitive nudge messages~~ DONE - nudge history injected into observation
   prompt with "do NOT repeat" instruction + per-session stats.

**P1 - Usability gaps:**

5. ~~Stale task reconciliation~~ DONE - fs.watch on tasks file, hot-reload with
   add/remove/update diffing.

6. **"Stuck at loading screen" detection** - the reasoner noticed code-music showing
   a "B" (building) state for 6+ cycles but could not diagnose whether it was
   building, stuck, or crashed. No structured state beyond tmux pane scraping.
   The session-heartbeat module detects dead panes but not "alive but stuck" panes.
   Fix: if output hash is unchanged for N ticks AND the session is not user-active,
   classify as "potentially stuck" and include that flag in the observation.

7. **No per-session cost visibility in TUI** - budget config and cost tracking
   modules exist but the compact agent bar shows no spend info. Add a small cost
   indicator (e.g. `$1.23`) next to each session in the agent bar, sourced from
   the existing reasoner-cost tracker.

**P2 - Deferred:**

8. **MCP connection restoration** - model is restored on respawn but MCP server
   connections are not. Needs opencode SDK support or a config file that opencode
   reads on startup.
9. **Service auto-install** - macOS launchd done. Linux systemd needs sudo.

**Done:**
- ~~CRITICAL: User input box hijacked by observer/reasoner logs~~ DONE
- ~~CRITICAL: ANSI escape code garbage in you: box~~ DONE
- ~~CRITICAL: Dead pane recovery~~ DONE
- ~~CRITICAL: Session config persistence~~ DONE
- ~~Scope enforcement~~ DONE
- ~~Update prompt handling~~ DONE
- ~~`aoaoe attach`~~ DONE
- ~~Default model enforcement~~ DONE

## Current State

**197 source modules**, **198 TUI commands**, **5024 tests**, **zero runtime dependencies**.
~61,000 lines of TypeScript. Node stdlib only (`node:test`, `node:fs`, `node:crypto`, etc).

The project is an autonomous supervisor daemon for AI coding sessions. It observes
tmux panes, reasons about what it sees (via OpenCode or Claude Code), and acts.
On top of the core poll→reason→execute loop, 142 intelligence modules run every
daemon tick without LLM calls — pure computation covering fleet observability,
cost management, goal tracking, scheduling, health monitoring, and operator tooling.

Every module follows the same pattern: standalone `.ts` file with pure functions
or a stateful class, a `format*()` function returning `string[]` for TUI display,
a test file, wired into `input.ts` (handler type + slash command) and `index.ts`
(import + instantiation + TUI handler).

## What Just Shipped (v7.4.0 → v7.4.1)

**v7.4.1 is a usability-focused release. No new feature modules.** The project has
196 intelligence modules but the core experience had gaps that would make a new user
close their terminal. This release fixes the P0 blockers.

### Usability fixes:
1. **opencode serve logs to file** — stderr/stdout piped to `~/.aoaoe/opencode-serve.log`
   instead of `/dev/null`. On startup failure, the last 10 lines are shown to the user.
   Previously, opencode serve crashes were invisible.

2. **README accuracy** — test badge updated from 3,491→4,985, module count from 55→196,
   project structure rewritten to show core files vs intelligence modules clearly.

3. **Better missing-tool errors** — `validateEnvironment()` now shows install links for
   each missing tool (aoe → GitHub URL, tmux → brew/apt, opencode → GitHub, claude → npm).

4. **Startup summary** — daemon now prints version, mode, poll/reason intervals, backend,
   API/health URLs, and `/help` hint on startup so the user knows what to expect.

5. **Session title collision warning** — poller warns when 2+ sessions have the same
   case-insensitive title, which can cause wrong-session command routing.

6. **index.ts navigability** — table of contents + 11 section markers (§IMPORTS through
   §HELPERS). Daemon loop searchable via `§LOOP`. `DaemonContext` interface created.

7. **0 sessions = actionable guidance** — daemon now tells users how to create a session
   (`aoe add <path> -t <title> -c opencode -y`) instead of sitting silently.

8. **`--observe` promoted in getting-started flow** — the safest, free mode is now step 3
   in both `--help` and `init` next-steps (before `--dry-run` which costs tokens).

9. **`/help` is now tiered** — bare `/help` shows 12 essential commands. `/help all`
   shows the full 197-command list. New users don't drown.

10. **Default $10 cost budget** — generated config now includes `costBudgets` with
    `globalBudgetUsd: 10.00` and `autoPauseOnExceed: true`. New users can't burn
    unlimited tokens by accident.

11. **Config hot-reload mentioned in startup banner** — users know they can edit
    config without restarting.

12. **init next-steps includes --observe** — the funnel is now: init → test-context →
    observe → dry-run → live. Each step adds risk/cost incrementally.

### Daily-use robustness (same release):
13. **opencode.ts startServer() logs to file** — the reasoner's own restart path
    now pipes to `~/.aoaoe/opencode-serve.log` (append mode), matching init.ts.
14. **Config warnings surfaced in TUI** — unknown key warnings collected during
    `loadConfig()`, replayed as TUI error entries after startup. Typos visible.
15. **Repeated-error suppression** — if the same tick error occurs 3+ times,
    suppressed to "same error repeated N times" instead of flooding the TUI.
16. **SQLite recovery less nuclear** — transient DB lock now triggers restart-
    without-wipe first. Only wipes DB after 2 consecutive SQLite errors.
17. **Claude --resume regex failure warning** — after 5 consecutive calls without
    session ID match, logs warning about increased token usage.
18. **Lock file message fixed** — no longer tells users to delete daemon.lock
    (stale locks auto-reclaim). Shows `kill <pid>` instead.
19. **pollIntervalMs upper bound** — max 300,000ms (5 min). Prevents frozen daemon.
20. **sessionDirs path validation** — warns if mapped paths don't exist on disk.

### Crash fix + polish (same release, continued):
21. **CRITICAL: Fixed require() crash** — startup summary used `require("../package.json")`
    which crashes in ESM. Replaced with existing `readPkgVersion()`. The daemon was
    literally broken and couldn't start. Found by actually running it.
22. **Doctor cleans stale locks** — instead of telling users to `rm daemon.lock`,
    doctor now auto-cleans stale locks (daemon not running). Shows `kill <pid>` for
    live daemons.
23. **Doctor opencode version fixed** — was using `opencode version` (wrong, tries to cd).
    Fixed to `opencode --version`. Now shows "1.3.3" instead of an error.
24. **Doctor version output sanitized** — filters "Error:" lines from tool version output.
25. **Missing cost budget warning** — existing configs without `costBudgets` now get a
    visible warning in the TUI: "no costBudgets configured — LLM spending is unlimited".
26. **`--log-file` flag** — redirect all output to a file for background/service mode.
    No TUI, no terminal interaction. Enables `aoaoe --log-file /var/log/aoaoe.log &`.

### Previous: v7.3.0 → v7.4.0 (feature modules)

v7.4.0 added burndown charts, memory leak detection, and session topology visualization.

## What Shipped Previously (v7.2.0 → v7.3.0)

v7.3.0 adds **error pattern recognition**, **daemon resource monitoring**, and
**cursor-based API pagination**.

1. **`session-error-pattern-library.ts`** + 22 tests — Curated regex patterns for
   common errors across 10+ languages (TypeScript, JavaScript, Python, Rust, Go) plus
   general patterns (OOM, segfault, permission, network, timeout, test, assertion,
   dependency). 28 built-in patterns. Severity classification (critical/error/warning/info).
   Category breakdown. Actionable suggestions per match. `/error-patterns <session>`.

2. **`daemon-resource-monitor.ts`** + 13 tests — Track CPU/memory/disk per daemon tick.
   Samples `process.memoryUsage()` + `process.cpuUsage()`. Rolling history with peak
   tracking. Trend detection (increasing/decreasing/stable) from first-half vs
   second-half comparison. Heap utilization %. Sparkline visualization of heap over
   time. `/resources`.

3. **`api-pagination.ts`** + 18 tests — Cursor-based pagination for API list endpoints.
   Opaque base64url cursors encoding offset + direction. Forward/backward navigation.
   Configurable page size (default 20, max 100). URL query param parsing. HTTP response
   headers (X-Total-Count, X-Has-More, X-Next-Cursor). `/api` endpoints gain pagination
   support.

## What Shipped Previously (v7.1.0 → v7.2.0)

v7.2.0 adds **webhook event push**, **audit trail retention policies**, and
**complexity-normalized velocity comparison**.

1. **`api-webhook-push.ts`** + 16 tests — Push fleet events to external URLs.
   Register webhook subscriptions with URL + event filter + optional HMAC-SHA256
   signing secret. Delivery with retry + exponential backoff. Toggle enable/disable.
   Delivery and failure tracking per subscription. `/webhook-push [add <url>]`.

2. **`audit-trail-retention.ts`** + 15 tests — Configurable TTL with archival for
   audit entries. Per-type retention policies (e.g. debug=1d, action=30d). Archive
   batches created before deletion with metadata (entry count, time range, categories).
   Wildcard default policy. Stats computation. `/audit-retention`.

3. **`goal-velocity-normalization.ts`** + 23 tests — Normalize velocity across
   different goal complexities. 5 complexity tiers (trivial→epic) with expected
   velocity ranges and difficulty weights. Raw %/hr normalized to 0-100 score
   relative to tier expectations. Weighted velocity = raw × complexity weight.
   Performance ratings (excellent/good/normal/slow/stalled). Fleet-level comparison
   with top/bottom performer identification. Bar chart rendering. `/velocity-norm`.

## What Shipped Previously (v7.0.0 → v7.1.0)

v7.1.0 adds **per-client API rate limiting**, **cross-session knowledge transfer**,
and a **2D urgency × importance priority matrix**.

1. **`api-rate-limiting.ts`** + 14 tests — Per-client request throttling for the
   REST API. Sliding window with burst allowance. Tracks per-client request counts,
   blocks with 429 when exceeded. Configurable window/max/burst. Automatic expired
   client cleanup. `/api-rate-limit`.

2. **`cross-session-knowledge.ts`** + 17 tests — Share learnings between sessions.
   Knowledge store with categories (error-fix, pattern, command, config, dependency,
   testing, performance). Search by category/tags/repo/keyword. `findRelevant()`
   scores entries by repo match + goal keywords + popularity. Usage tracking with
   session attribution. Eviction keeps most-used entries. `/knowledge [keyword]`.

3. **`fleet-priority-matrix.ts`** + 21 tests — Eisenhower-style 2D urgency ×
   importance classification. Urgency from: errors (+30), stuck (+20-40), nudges
   (+5/ea), low health (+15), deadline (+20). Importance from: priority level
   (+0-40), blocking (+20), dependents (+5/ea), cost (+5-10), near-completion
   (+10). Four quadrants: do-first, schedule, delegate, eliminate. ASCII matrix
   rendering with per-session recommendations. `/priority-matrix`.

## What Shipped Previously (v6.5.0 → v7.0.0)

v7.0.0 is the **Remote Control API** release — the single biggest architectural
addition since the 8-gate reasoning pipeline. The daemon is now a platform that
external tools can integrate with.

### Flagship: Daemon Remote Control API (`api-server.ts`)
Full REST API server for daemon remote control + external integrations:
- **20 GET endpoints** for fleet metrics (SLA, pool, cost, heartbeat, incidents, etc.)
- **2 POST endpoints** for actions (pause/resume daemon)
- **SSE event stream** (`/api/v1/events`) for live fleet event broadcasting
- **Bearer token auth** with timing-safe comparison
- **OpenAPI 3.1 spec** auto-generated from route definitions (`/api/v1/openapi.json`)
- **Route registry** pattern — modules register getters/actions, server builds routes
- **CORS support** for browser-based consumers
- **Request stats** tracking per-route hit counts
- Config: `apiPort` + `apiToken` fields in `AoaoeConfig`
- TUI: `/api` shows server status, routes, top endpoints, SSE client count
- 45 tests covering auth, routing, OpenAPI generation, SSE, CORS, stats

### Standard Modules (3 new)
1. **`alert-rule-inheritance.ts`** + 16 tests — Child alert rules inherit parent
   severity, cooldown, condition, enabled, and tags. Multi-level depth. Detects
   orphan rules (missing parent) and circular references. Tree-view TUI rendering
   with inheritance annotations. `/alert-inherit`.

2. **`session-affinity-router.ts`** + 14 tests — Route sessions to preferred
   reasoner instances. Weighted scoring from: capacity (load vs max), sticky
   routing (prefer last-used), tag matching, explicit affinity rules, and
   historical performance (success rate). Spreads load across instances for
   multi-session batches. `/affinity-router`.

3. **`batch-goal-assignment.ts`** + 20 tests — Parse structured goal manifests
   for bulk goal loading. Key-value text format with `[session]` blocks, supports
   goal, priority, depends, tags, budget, repo fields. Dependency validation,
   case-insensitive session matching, template generation from existing sessions.
   `/batch-goal [manifest-text]`.

## What Shipped Previously (v3.4.0 → v6.5.0)

90+ modules across 30+ releases. Key categories:
- **Fleet intelligence**: idle detection, goal conflicts, leaderboard, health history
- **Cost management**: anomaly throttle, forecast alerts, budget planner, chargeback, trends, optimizer
- **Goal tracking**: auto-priority, cascading, confidence, NL parser, complexity, mutations, decomp quality
- **Observability**: event bus, incident timeline, sentiment, pattern evolution, structured log
- **Operations**: shift handoff, compliance, runbooks, readiness, auto-scaler, diagnostics
- **Debugging**: action replay, heartbeat, config diff, perf regression, output diff, annotations
- **Infrastructure**: state machine, config profiles, hot-swap, graceful shutdown, distributed lock, process supervisor
- **Visualization**: leaderboard, heatmap, sparklines, ops dashboard, dep graph export, time machine
- **Integration**: webhook integrations, clipboard, transcript export, state export, daily digest

## Ambitious Ideas for Fresh Context

### 1. Web Dashboard v2 (SSE-based browser UI)
Now enabled by the API server. Build a rich browser dashboard consuming the
REST API + SSE event stream. Inline HTML/JS (no build step). Show fleet state,
session outputs, cost charts, incident timeline — all live-updating. The API
server provides every data endpoint needed; this is purely a frontend effort.

### 2. Reasoner Plugin System (ESM module loading)
Load custom reasoning backends as ESM modules:
- Plugin manifest format (name, version, init function, capabilities)
- Dynamic `import()` loading from a plugins directory
- Plugin lifecycle (init, validate, swap, disable)
- Could integrate with existing hot-swap module for version management

### 3. Daemon OpenTelemetry Traces (distributed tracing)
Full tracing for every daemon tick:
- Span per phase (poll, reason, execute, post-tick)
- Trace context propagation through intelligence modules
- Export to Jaeger/Zipkin/OTLP
- Integrate with existing tick profiler + perf regression detector

### 4. Federation Auto-Discovery (mDNS peer finding)
Enable multiple daemon instances to find each other on a LAN:
- mDNS service advertisement + discovery
- Peer health exchange
- Coordinated session scheduling across hosts
- Build on existing fleet-federation module

### 5. Session Hibernation (full state save/resume)
Save complete session state to disk and resume later:
- Serialize all in-memory state for a session
- Checkpoint file format with versioning
- Resume from checkpoint without losing context
- Build on existing session-checkpoint module

### 6. Multi-Reasoner Parallel (concurrent LLM calls + merge)
Call multiple LLM backends simultaneously and merge results:
- Fan-out to 2-3 backends per observation
- Merge/vote on actions (majority wins, confidence weighting)
- Build on existing multi-reasoner + A/B reasoning modules

### 7. Workflow DAG Editor (interactive definition)
Interactive TUI for defining and editing workflow DAGs:
- ASCII-based node/edge editing
- Validate against workflow-engine rules
- Save/load workflow definitions
- Build on existing workflow-engine + workflow-viz modules

### 8. Fleet Time-Travel (full state rewind)
Rewind fleet state to any historical snapshot and explore:
- Full state reconstruction from event store
- Side-by-side comparison of any two time points
- "What-if" analysis (replay with different config)
- Build on existing event-sourcing + snapshot-compression + time-machine modules

### 9. Session Sandbox Mode (isolated environments with rollback)
Run sessions in isolated environments:
- Git branch isolation per session
- Filesystem snapshot before each action
- Automatic rollback on failure
- "Safe mode" that prevents any destructive operations

### 10. API Client SDK (TypeScript package)
Auto-generated TypeScript SDK from the OpenAPI spec:
- Typed methods for every GET/POST endpoint
- SSE event subscription helpers
- Token auth configuration
- Publish as separate `aoaoe-sdk` npm package

## Standard Backlog (smaller items, 1 module each)
- Fleet capacity planning — historical utilization dashboard
- Parallel goal execution — split goals into sub-goals across sessions
- Fleet-wide rollback — coordinated revert across all sessions
- Session output search v2 — regex + fuzzy + semantic search
- Daemon heartbeat federation — cross-host daemon health monitoring
- Daemon config version control — git-style config history with diff
- Fleet cost allocation optimizer — minimize cost while maintaining SLA
- Goal dependency auto-generator — infer deps from code import analysis
- Fleet multi-cluster management — manage multiple daemon fleets from one TUI
- Session output streaming API — stream live pane output via SSE per-session
- Goal progress webhook — fire webhooks on goal completion/failure events
- Daemon metrics Grafana dashboard — pre-built JSON dashboard for Prometheus metrics
- Session replay export — export replays as standalone HTML files with embedded player
- Fleet tenant isolation — multi-tenant daemon sharing with resource quotas
- Daemon config templating — Mustache-style variable substitution in config files
- Session output semantic search — vector embeddings for similarity search (optional LLM)
- Fleet cost projection calendar — calendar view of projected daily costs
- Goal decomposition suggestion — AI-free heuristic sub-goal recommendations
- Session output compression — gzip pane output for lower disk usage in long-running sessions
- API request audit log — detailed log of every API request for security auditing
- Fleet health alert escalation chain — multi-tier alert routing (email → Slack → PagerDuty)
- Session error auto-remediation — auto-suggest fixes based on error pattern matches
- Fleet cost anomaly explainer — root cause analysis for cost spikes
- Session output diff highlights — color-coded diff overlays in TUI output view
- API rate limit per-route — per-endpoint rate limits rather than global
- Daemon tick waterfall — visualize per-tick phase timing as waterfall chart
- Session git integration — track branch/commit per session with auto-PR detection
- Fleet notification digest — batched notification summaries instead of per-event noise
- Goal dependency visualization — interactive TUI dep graph with expand/collapse
- Daemon config hot-reload validation — dry-run config changes before applying
- Session output pattern classifier — ML-free Bayesian classifier for output categories
- Fleet session migration — move sessions between daemon instances
- API GraphQL endpoint — alternative to REST for complex fleet queries

## Session Workflow (for AI agents)

**Current directive: ship and supervise.** The daemon works. The usability
fixes shipped in v7.4.1. Now the focus is running aoaoe on real tasks
(adventure + code-music) and fixing whatever breaks in practice. Priorities:

1. Keep the daemon running and supervising real sessions
2. Fix issues discovered during real autonomous operation
3. Improve task reconciliation and session resilience
4. Add features only when they unblock real work

## Remaining Usability Work

- **P0: index.ts navigability** — DONE. 11 section markers (§IMPORTS → §HELPERS) +
  table of contents. DaemonContext interface created for future extraction.
  Full physical extraction deferred — the risk (breaking 90 closures, duplicating
  264 imports) outweighs the benefit now that the file is searchable.
- **P1: Lazy-load intelligence modules** — 265 import statements at startup.
  Only import when the TUI command is first used or the per-tick hook fires.
- **P2: `--log-file` flag** — run as background service without TUI.
- **P2: Claude Code session ID fallback** — warn instead of silently going stateless.
