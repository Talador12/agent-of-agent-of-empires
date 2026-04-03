# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v2.0.0

## What shipped in v2.0.0

**v2.0.0 — Full Platform: v1.9 Modules Wired + Alert Rules Per-Tick + v2 Tag**:
- **`/federation` TUI command** — shows multi-host fleet overview (local state as single peer, extensible to remote peers via `/health` endpoint).
- **`/archives` TUI command** — lists gzipped output archives at `~/.aoaoe/output-archive/`.
- **`/runbook-gen` TUI command** — auto-generates operator runbooks from audit trail patterns.
- **`/alert-rules` TUI command** — shows all 5 alert rules with severity, description, and cooldown status.
- **Alert rules wired into main loop** — `evaluateAlertRules()` runs every tick. Fires alerts for critical health (<30), high error rate (>50%), cost spikes (>$5/hr), all-stuck, no-active-sessions. Each alert is logged to TUI + audit trail with severity icon.
- **v2.0.0 milestone** — 69 TUI commands, 66 source modules, 3441 tests.

### Platform Stats
| Metric | Value |
|--------|-------|
| Source modules | 66 |
| Test files | 102 |
| TUI commands | 69 |
| CLI subcommands | 20 |
| Tests | 3441 |
| Reasoning pipeline gates | 8 |
| Alert rules | 5 |
| Workflow templates | 5 |
| Session templates | 6 |
| Runtime dependencies | 0 |

## Ideas Backlog (v3.0)
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Alert rule DSL** — user-defined rules via config
- **Federation auto-discovery** — mDNS/multicast peer finding
- **Output archival to R2/S3** — remote storage
- **Runbook execution engine** — auto-execute generated runbooks
- **Fleet health forecasting** — predict trends from history
- **Session replay TUI player** — animated step-through
- **Multi-reasoner parallel** — concurrent backend calls
- **Workflow visualization** — ASCII DAG rendering
