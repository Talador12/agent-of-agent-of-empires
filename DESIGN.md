# Design: aoaoe as an Agent of Empires plugin

This document is the design for running aoaoe's orchestrator as a first-class
[Agent of Empires (AoE)](https://github.com/agent-of-empires/agent-of-empires)
**plugin**, per the community decision on
[PR #2699](https://github.com/agent-of-empires/agent-of-empires/pull/2699) and
[issue #553](https://github.com/agent-of-empires/agent-of-empires/issues/553):
the orchestrator lives in this repo, installs as a plugin users opt into, and
can later be promoted to the featured index by PRing its release tree hash.

It also answers the design questions raised in the issue thread before any
code: what the orchestrator *is*, where mechanism vs. policy lives, and which
host primitives it consumes vs. which it still needs.

## What the orchestrator is

A convergence-oriented supervisor, not a transport. It watches every AoE
session, ranks them by an **attention score** (who needs a human or a
supervisor next), recommends bounded actions, and — only where the plugin API
grants it authority — acts. Two orchestration styles are supported, matching
the two use cases discussed in the thread:

1. **Algorithmic (deterministic, default).** A rules reasoner derives
   recommendations purely from observable session state (status, transition
   history, stuck-ness). No LLM, no tokens, reproducible. Structured outputs
   are enforced trivially because the rules emit the action schema directly.
2. **LLM-assisted (opt-in).** The existing aoaoe reasoner backends
   (`claude-code` via `claude --print`, or OpenCode) receive the same
   structured observation and must return the same JSON action schema;
   malformed output is rejected by the parser and the tick degrades to
   "no action", never to an unstructured side effect.

Both styles flow through one pipeline — observe → reason → execute
(`src/loop.ts`) — with the same policy gates, so the guarantees below do not
depend on which reasoner is selected.

## Mechanism lives in AoE; policy lives here

The plugin holds **no** internal copy of AoE mechanism. It consumes only the
public plugin API (worker JSON-RPC, `api_version = 11`):

| Need | Host primitive |
|---|---|
| Observe sessions | `sessions.list` (id, title, project_path, tool, status, archived, snoozed) |
| Discover agents/models | `acp.capabilities.get` |
| Create sessions (e.g. from GitHub issues) | `sessions.create` (+ `initial_turn`, `idempotency_key`) |
| Nudge a session | `sessions.turn.send` — host-enforced to sessions this plugin created |
| Persist state | `plugin.storage.*` |
| Show the queue | `ui.state.set` (card, pane, row-badge, row-column, sort-key, status-bar) |
| Alert the operator | `ui.notify` |
| Interop with other plugins | `events.publish` (`queue.updated` topic) |

The host, not the plugin, classifies approval modes, enforces repository
trust, and rate-limits session driving (20 creates/hr, 5 active plugin
sessions, 120 turns/hr). We deliberately do **not** request
`session.unattended`.

**Consequence of staying on the public API:** for sessions the plugin did not
create, it cannot type into the pane and cannot read pane output. For those
sessions the orchestrator is *advisory*: it ranks, badges, and notifies, and
the human acts. This is the "recommend actions" shape issue #553 asked for,
and it is exactly the boundary njbrake described: non-destructive levers on
the host, conservative-on-destruction policy in the orchestrator.

### Missing host primitives (feature requests, not workarounds)

Rather than reaching into AoE internals (tmux names, `sessions.json`), the
gaps below are what we would ask the host to expose next. Until then the
plugin simply has reduced signal, never undefined behavior:

1. **Session output read** (`sessions.output.get` or an output-digest field on
   `sessions.list`) — would unlock the pane-content intelligence modules
   (error classification, permission-prompt detection, stuck detection by
   output hash).
2. **Session state-change events** on the plugin event bus — today the worker
   polls `sessions.list` on its tick interval.
3. **Attention levers on foreign sessions** (`sessions.snooze/favorite`
   RPCs mirroring the CLI) — would let "act on recommendation" be one click
   inside the pane instead of a manual CLI step.

## Guardrails (carried over from the in-tree PR, plus review fixes)

* `dry_run` defaults to **true**: ticks produce recommendations and UI state,
  never actions, until the user flips the setting.
* `allow_nudge` defaults to **false**; even when true, nudges only reach
  plugin-created sessions (host-enforced ownership).
* Tick interval clamps to a 5s floor, so a misconfigured interval cannot spin.
* Per-session, per-action-kind cooldown that is updated **within** a batch,
  so two recommendations for the same session in one tick cannot both fire
  (fixes the cooldown-snapshot bug found in the PR #2699 review).
* Spawn-from-issues is dry-run by default (`spawn_live = false`), capped by
  `spawn_limit` and `max_active_sessions`, uses `idempotency_key =
  "issue:<repo>#<number>"` so retries can never double-spawn, and backs off
  exponentially on failure.
* Quiet hours (`HH:MM-HH:MM`) skip reasoning/acting but keep observing.
* Reasoner subprocess and HTTP calls are timeout-bounded (`src/shell.ts`
  default 30s exec timeout; reasoner calls pass explicit deadlines).
* All persisted worker state goes through `plugin.storage` CAS where
  concurrent writers are possible.

## Structure

```
aoe-plugin.toml            manifest (api_version 11)
scripts/plugin-build.mjs   install-time build: deps + tsc into .aoe-build/
tsconfig.plugin.json       compiles src/ (minus tests) to .aoe-build/dist
src/plugin/
  protocol.ts              newline-delimited JSON-RPC 2.0 framing (both directions)
  host.ts                  typed client for the host RPCs listed above
  settings.ts              plugin settings -> orchestrator config
  attention.ts             attention scoring from session metadata + history
  rules-reasoner.ts        deterministic Reasoner (no LLM)
  plugin-poller.ts         PollerLike over sessions.list
  plugin-executor.ts       ExecutorLike over sessions.create / turn.send + gates
  spawn.ts                 GitHub issues -> sessions (gh CLI, dry-run default)
  ui.ts                    card / pane / badge / column / status-bar payloads
  worker.ts                entry point: tick loop, command dispatch, lifecycle
```

The worker reuses the existing seam: `tick()` in `src/loop.ts` accepts any
`PollerLike`/`ExecutorLike`/`Reasoner`. The standalone `aoaoe` CLI (tmux +
`aoe` CLI integration) continues to work unchanged; the plugin is an
additional deployment mode of the same engine, not a fork of it.

## Attention scoring

Inputs available from metadata alone: status (error > waiting > idle >
running), time in current status (tracked by the worker across ticks),
snoozed/archived (excluded), and whether the session is plugin-created (can
be acted on) . Score is a weighted sum with idle escalation: the longer a
session sits in `waiting`/`error` unacknowledged, the higher it climbs.
The ranked queue is one canonical shape (`QueueRow`) used by the card, the
pane, the `status` command JSON, and the `queue.updated` event — a single
schema, as the PR review requested.
