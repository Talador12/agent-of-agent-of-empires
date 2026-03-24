# aoaoe Makefile
# Run `make help` to see commands grouped by audience.
# Requires: Node.js >= 20  |  aoe  |  tmux  |  opencode or claude-code

.PHONY: help setup build dev lint check test test-integration test-all clean \
        start daemon self self-dry watch \
        demo demo-setup demo-dry \
        release

# =============================================================================
# [WATCH]  See it work. No setup. Just run.
# =============================================================================

# Start the supervisor — polls your AoE sessions, reasons, and acts autonomously.
# Creates the AoE session for this repo if it doesn't exist.
self: build
	@echo ""
	@echo "╔══════════════════════════════════════════════════════════════╗"
	@echo "║                  aoaoe  self-improvement                    ║"
	@echo "╠══════════════════════════════════════════════════════════════╣"
	@echo "║  aoaoe supervises its own AoE session. It reads the         ║"
	@echo "║  roadmap in aoaoe.tasks.json, picks the next item,          ║"
	@echo "║  implements it with tests, commits, and pushes —            ║"
	@echo "║  updating itself in real time.                              ║"
	@echo "╠══════════════════════════════════════════════════════════════╣"
	@echo "║  ESC ESC  interrupt    /help  all commands                  ║"
	@echo "╚══════════════════════════════════════════════════════════════╝"
	@echo ""
	@# ── Ensure the AoE session exists ──────────────────────────────────
	@SESSION_INFO=$$(aoe list --json 2>/dev/null | python3 -c \
		"import sys,json; sessions=json.load(sys.stdin); s=next((s for s in sessions if s['title']=='aoaoe'),None); print(s['id'][:8] if s else '')" \
		2>/dev/null); \
	if [ -z "$$SESSION_INFO" ]; then \
		echo "  creating 'aoaoe' AoE session..."; \
		aoe add "$(PWD)" -t "aoaoe" -c opencode -y; \
		SESSION_INFO=$$(aoe list --json 2>/dev/null | python3 -c \
			"import sys,json; sessions=json.load(sys.stdin); s=next((s for s in sessions if s['title']=='aoaoe'),None); print(s['id'][:8] if s else '?')" \
			2>/dev/null); \
	fi; \
	TMUX_NAME="aoe_aoaoe_$$SESSION_INFO"; \
	echo "  ┌─ AoE window ──────────────────────────────────────────────┐"; \
	echo "  │  aoaoe is running in this tmux session:                   │"; \
	printf "  │    %-57s│\n" "$$TMUX_NAME"; \
	echo "  │                                                           │"; \
	echo "  │  To watch the agent work, in another terminal:            │"; \
	printf "  │    tmux attach -t %-42s│\n" "$$TMUX_NAME"; \
	echo "  └───────────────────────────────────────────────────────────┘"; \
	echo ""; \
	echo "  Starting aoaoe supervisor TUI..."; \
	echo ""
	node dist/index.js

# Watch mode — aoaoe observes and plans but never acts. Safe to run alongside live sessions.
self-dry: build
	@echo ""
	@echo "  aoaoe dry-run: observing + planning, no actions executed."
	@echo "  Safe alongside any live AoE sessions. Ctrl+C to stop."
	@echo ""
	node dist/index.js --dry-run

# =============================================================================
# [RUN]  Use aoaoe on your own projects. First time? Start here.
# =============================================================================

# First-time setup: install deps, build, create the AoE session for this repo.
setup:
	npm install
	npm run build
	@echo ""
	@echo "  checking for 'aoaoe' AoE session..."
	@if aoe list --json 2>/dev/null | python3 -c \
		"import sys,json; sessions=json.load(sys.stdin); print('ok' if any(s['title']=='aoaoe' for s in sessions) else 'missing')" \
		2>/dev/null | grep -q ok; then \
		echo "  ✓ session already exists"; \
	else \
		echo "  creating session..."; \
		aoe add "$(PWD)" -t "aoaoe" -c opencode -y; \
		echo "  ✓ session created"; \
	fi
	@echo ""
	@echo "  Ready."
	@echo "  make self         supervise this repo (self-improvement mode)"
	@echo "  make daemon       supervise your own AoE sessions"
	@echo "  make self-dry     observe + plan, no actions"
	@echo ""

# Start the daemon against your own AoE sessions (not self-improvement mode).
daemon: build
	@echo ""
	@echo "  starting aoaoe daemon..."
	@echo "  watching all active AoE sessions. Ctrl+C to stop."
	@echo ""
	node dist/index.js

start: daemon  # alias

# =============================================================================
# [BUILD]  Develop aoaoe itself. Tests, build, release.
# =============================================================================

build:
	npm run build

dev:
	npm run dev

lint:
	npm run lint

check: lint

# Unit tests — 2100+ tests, zero external deps, runs in seconds.
test: build
	npm test

# Integration test — creates real AoE sessions, runs the full loop, cleans up (~30s).
# Requires: aoe, opencode (or claude-code), and tmux on PATH.
test-integration: build
	node dist/integration-test.js

test-all: test test-integration

clean:
	rm -rf dist

# Watch mode for development — recompiles on every save.
watch:
	npm run dev

# Cut a release: runs all tests, bumps version, tags, and pushes.
# CI handles npm publish + GitHub Release automatically.
# Usage: make release v=0.30.0
release: test-all
	@if [ -z "$(v)" ]; then echo "  usage: make release v=0.30.0"; exit 1; fi
	@if ! git diff --quiet HEAD; then echo "  error: uncommitted changes — commit or stash first"; exit 1; fi
	@echo ""
	@echo "  releasing v$(v)..."
	npm version $(v) --no-git-tag-version
	git add package.json
	git commit -m "v$(v)"
	git tag "v$(v)"
	git push origin main --tags
	@echo ""
	@echo "  v$(v) tagged and pushed. CI will publish to npm + create GitHub Release."

# =============================================================================
# HELP
# =============================================================================

help:
	@echo ""
	@echo "╔══════════════════════════════════════════════════════════════════╗"
	@echo "║                           aoaoe                                 ║"
	@echo "║   Autonomous supervisor for Agent of Empires sessions.          ║"
	@echo "║   Watches agents, reasons about what to do, and acts.           ║"
	@echo "╚══════════════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "  New here?  →  make setup   then   make self"
	@echo ""
	@echo "┌─ [WATCH]  See it work ────────────────────────────────────────────"
	@echo "│"
	@echo "│  make self              aoaoe supervises itself in real time"
	@echo "│                         reads roadmap → implements → commits → pushes"
	@echo "│"
	@echo "│  make self-dry          observe + plan only, no actions executed"
	@echo "│                         safe to run alongside any live sessions"
	@echo "│"
	@echo "├─ [RUN]  Supervise your own projects ─────────────────────────────"
	@echo "│"
	@echo "│  make setup             install deps, build, create AoE session"
	@echo "│                         run this once before anything else"
	@echo "│"
	@echo "│  make daemon            supervise your AoE sessions"
	@echo "│                         polls all active sessions, reasons, acts"
	@echo "│"
	@echo "│  The daemon TUI:"
	@echo "│    ESC ESC              interrupt the current reasoning cycle"
	@echo "│    /help                show all slash commands"
	@echo "│    /pause / /resume     pause and resume the supervisor"
	@echo "│    /mode dry-run        switch to observe-only at runtime"
	@echo "│    /view N              drill into session N"
	@echo "│    /pin N               pin session N to the top"
	@echo "│    /note N <text>       attach a note to a session"
	@echo "│    /task                manage task goals per session"
	@echo "│"
	@echo "├─ [BUILD]  Develop aoaoe itself ──────────────────────────────────"
	@echo "│"
	@echo "│  make build             compile TypeScript → dist/"
	@echo "│  make watch             watch mode — recompile on save"
	@echo "│  make lint              type-check without emitting"
	@echo "│  make test              unit tests (2100+, no external deps)"
	@echo "│  make test-integration  end-to-end test (real aoe + tmux, ~30s)"
	@echo "│  make test-all          unit + integration"
	@echo "│  make clean             remove dist/"
	@echo "│"
	@echo "│  make release v=0.30.0  tag + push (CI publishes to npm)"
	@echo "│"
	@echo "│  Docs:   README.md"
	@echo "│  State:  claude.md  (roadmap, current work, version)"
	@echo "│  Arch:   AGENTS.md  (source layout, conventions, testing)"
	@echo "│"
	@echo "└───────────────────────────────────────────────────────────────────"
	@echo ""

# kept for backward compat
demo-setup: setup
demo: self
demo-dry: self-dry
