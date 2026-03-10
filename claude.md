# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.11.0

## Current Focus

v0.11.0 released. Post-release improvements: resolveProjectDirWithSource for
diagnostics, test-context shows resolution source, AGENTS.md updated, 188 tests.

## Working Items

### sessionDirs config
- **Status:** Done
- Added `sessionDirs: Record<string, string>` to AoaoeConfig
- Wired through: resolveProjectDir() -> loadSessionContext() -> poller.ts -> index.ts test-context
- Supports absolute and relative paths, case-insensitive title matching
- Falls back to heuristic search when mapping not found or path doesn't exist
- 10 new tests (8 resolveProjectDir + 2 loadSessionContext)
- README: config table, dedicated section with examples, `test-context` usage

### daemonTick refactor
- **Status:** Done
- index.ts now wraps loop.ts tick() via daemonTick() for UI/IPC side effects
- Core logic in loop.ts is what tests exercise — same code path as production
- Dashboard, status line, state file, console output, interrupt support all in daemonTick()

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Better onboarding for users who run `aoe` from a parent directory

## Completed

- v0.11.0: sessionDirs config, daemonTick refactor using loop.ts,
  resolveProjectDirWithSource diagnostics, 188 tests
- v0.10.0: E2e loop tests with mock infrastructure, "Try It Safely" README section,
  CLI help improvements, CI test glob fix, two-file AI Working Context propagation
- v0.9.0: Auto-discovery of AI instruction files, `resolveProjectDir`, cross-platform inode de-dupe, `test-context` subcommand
- v0.8.0: Title-based project directory resolution for meta-level aoe usage
- v0.7.0: AGENTS.md + claude.md context loading, global + per-session context
- 188 tests across 8 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
- Created `AGENTS.md`, removed `.claude/` scratchpad system
- Propagated two-file AI Working Context across all repos
