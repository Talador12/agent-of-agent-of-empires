# aoaoe — Project Status

See `AGENTS.md` for architecture, build commands, and conventions.

## Rules
- Update this file with every commit.

## Version: v0.17.0

## Current Focus

AbortSignal cancellation for reasoner backends. 334 tests across 16 files.
Next: end-to-end daemon+chat integration tests, meta-level UX improvements.

## Working Items

### Fix Homebrew tap PAT
- **Status:** Todo
- `HOMEBREW_TAP_TOKEN` PAT needs `repo` scope for `peter-evans/repository-dispatch`
- Once fixed, re-run release workflow to trigger tap update

### End-to-end daemon+chat integration tests
- **Status:** Todo
- Mock-based test exercising daemon state IPC + chat reads

### Meta-level UX improvements
- **Status:** Todo
- Auto session naming (match session titles to project directories)
- Better onboarding for users who run `aoe` from a parent directory

### chat.ts tests
- **Status:** Todo
- Tests for colorize, buildStatusLine, isDaemonRunning patterns

## Completed

- v0.17.0: AbortSignal cancellation — `withTimeoutAndInterrupt` refactored from
  raw `Promise<T>` to factory `(signal: AbortSignal) => Promise<T>`, creates
  `AbortController` and passes signal through to reasoner backends; both OpenCode
  (fetch signal) and Claude Code (exec signal) now receive and respect the signal;
  signal is aborted on timeout or interrupt for proper resource cleanup. Renamed
  `console_` to `reasonerConsole` in index.ts for clarity. Fixed hardcoded 30s in
  executor.test.ts to use `DEFAULT_COOLDOWN_MS` constant. Updated MockReasoner in
  loop.test.ts to accept optional AbortSignal (interface compat). New
  abort-signal.test.ts with 11 tests covering factory/signal contract, timeout
  abort behavior, fetch/exec integration patterns, and Reasoner.decide() interface
  contract. 334 tests across 16 files.
- v0.16.0: IPC hardening + chat modernization — atomic rename-based drain in
  console.ts (fixes race condition where input lost between read and clear),
  opencode server PID file (orphan detection + kill on restart), chat.ts async
  rewrite (execFileSync -> async exec, no longer blocks event loop), fs.watch
  replaces watchFile polling in chat.ts, chat.ts imports computeTmuxName from
  poller.ts (DRY), tryExtractSessionId now logs on extraction failure,
  console.test.ts with 10 atomic drain tests, 323 tests total
- v0.15.0: test coverage expansion — 5 new test files (dashboard, claude-code,
  reasoner-factory, daemon-state, input), ANSI escape code stripping in poller
  (stripAnsi before hash+diff), 12 stripAnsi tests, 313 tests total
- v0.14.0: robustness — prompt budget (50KB context cap, changed sessions prioritized),
  send_input text length cap (4KB), DRY session resolution (single resolveSession method),
  configurable rate limit cooldown (policies.actionCooldownMs), auto-prune stale rate
  limit entries, shared sleep() utility (deduplicated from 2 files), hoisted config.ts
  imports, 215 tests
- v0.13.0: remaining audit fixes — test-context parsed in parseCliArgs (consistent
  with attach/register), hoisted dynamic imports out of testContext loop, stale
  OpenCode SDK session auto-recovery (retry with fresh session), shell.ts captures
  signal on process kill, validateConfig edge case tests, tick() error propagation
  tests, subcommand mutual exclusivity tests, 213 tests
- v0.12.0: audit fixes — balanced-brace JSON extraction (replaces greedy regex),
  action log rotation (1MB cap), TOCTOU race fix in daemon-state cleanup,
  rate limiting normalizes session refs through resolver, 200 tests
- v0.11.1: reliability hardening — per-action-type field validation, tmux literal
  mode (injection prevention), config validation at startup, CLI bounds checking,
  error logging in withTimeoutAndInterrupt, orphan process cleanup, Promise.allSettled
  in poller, shared reasoner/parse.ts, 193 tests
- v0.11.0: sessionDirs config, daemonTick refactor using loop.ts,
  resolveProjectDirWithSource diagnostics, reliability hardening, 193 tests
- v0.10.0: E2e loop tests with mock infrastructure, "Try It Safely" README section,
  CLI help improvements, CI test glob fix, two-file AI Working Context propagation
- v0.9.0: Auto-discovery of AI instruction files, `resolveProjectDir`, cross-platform inode de-dupe, `test-context` subcommand
- v0.8.0: Title-based project directory resolution for meta-level aoe usage
- v0.7.0: AGENTS.md + claude.md context loading, global + per-session context
- 334 tests across 16 files, all passing
- Both reasoner backends (OpenCode SDK, Claude Code subprocess)
- Dashboard + interactive chat UI
- GitHub Actions CI, npm publish, GitHub Releases
- Created `AGENTS.md`, removed `.claude/` scratchpad system
- Propagated two-file AI Working Context across all repos
