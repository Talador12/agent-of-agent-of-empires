# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v2.5.0

## Status: COMPLETE — v2.5.0 tagged, full platform shipped

74 source modules. 110 test files. 3491 tests. 72 TUI commands. 20 CLI subcommands.
8-gate reasoning pipeline. 18 Prometheus metrics. 5 alert rules. 5 workflow templates.
6 session templates. Zero runtime dependencies. Four tagged releases (v1.0.0, v1.3.0, v2.0.0, v2.5.0).

### If resuming work
The v3.0 backlog has genuine platform features, not more modules:
1. **Web dashboard v2** — real-time browser UI via SSE (the biggest UX gap)
2. **Reasoner plugin system** — load custom backends as ESM modules (extensibility)
3. **Daemon OpenTelemetry traces** — distributed tracing for reasoning pipeline (production ops)

## Ideas Backlog (v3.0)
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Federation auto-discovery** — mDNS peer finding
- **Daemon OpenTelemetry traces** — distributed tracing
- **Workflow DAG editor** — interactive workflow definition
- **Fleet cost allocation tags** — label sessions by team/project
- **Session replay TUI player** — animated step-through
- **Multi-reasoner parallel** — concurrent calls + merge
- **Output archival to R2/S3** — remote storage
