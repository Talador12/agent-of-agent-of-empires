# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, conventions, and full session history.

## Rules
- Update this file with every commit.

## Version: v2.6.0

## What shipped in v2.6.0

**v2.6.0 — Session Cloning, Goal Similarity, Cost Tags, Predictive Scaling**:
- `session-clone.ts`: clone an existing session for A/B experimentation. `cloneSession()` creates a new TaskDefinition from source with optional goal/tool/mode overrides. Clone runs independently (no dependency on source).
- `goal-similarity.ts`: Jaccard similarity on keyword sets to detect overlapping goals. `findSimilarGoals()` returns pairs above threshold sorted by similarity. Useful for coordinating sessions working on related problems.
- `cost-allocation-tags.ts`: tag sessions with key-value pairs (team, project, etc.) for grouped cost attribution. `groupByTag()` aggregates costs per tag value. `parseTags()` handles `"team=platform,project=aoaoe"` format.
- `predictive-scaling.ts`: `recommendScaling()` analyzes utilization, pending tasks, and peak usage to recommend pool scale-up/down/maintain. Never scales below 2. Confidence levels based on data strength.

78 source modules. 114 test files. 3518 tests. 0 runtime deps.

## Ideas Backlog (v3.0)
- **Wire v2.5+v2.6 modules** — /metrics, /fleet-grep, /clone, /similar-goals, /cost-tags, /scaling, /runbook-exec
- **Web dashboard v2** — real-time browser UI via SSE
- **Reasoner plugin system** — load custom backends as ESM modules
- **Daemon OpenTelemetry traces** — distributed tracing
- **Workflow DAG editor** — interactive workflow definition
- **Session replay TUI player** — animated step-through
- **Multi-reasoner parallel** — concurrent calls + merge
- **Output archival to R2/S3** — remote storage
- **Alert rule inheritance** — child rules that inherit parent severity
- **Fleet capacity planning dashboard** — historical utilization + forecast
