################################################################################
#                                  aoaoe                                       #
#   Autonomous supervisor for Agent of Empires sessions.                       #
#   Watches agents, reasons about what to do, and acts.                        #
#                                                                               #
#   Requires: Node.js >= 20  |  aoe  |  tmux  |  opencode or claude-code      #
################################################################################

SHELL := /bin/bash

.DEFAULT_GOAL := help
.PHONY: help list-targets makeinfo setup build dev lint check test test-integration test-all \
        clean start daemon self self-dry watch release demo demo-setup demo-dry

# Prevent Make from trying to remake Makefile via pattern rule
Makefile: makeinfo ;

################################################################################
#                             Utility Commands                                 #
################################################################################

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "} {printf "%s %03d:## %s\n", $$1, length($$1), $$2}' | sort -k1,1 -k2,2n | awk -F':## ' '{split($$1, parts, " "); printf "\033[36m%-30s\033[0m %s\n", parts[1], $$2}'

list-targets: ## [Utility] List all available targets
	@LC_ALL=C $(MAKE) -pRrq -f $(firstword $(MAKEFILE_LIST)) : 2>/dev/null | awk -v RS= -F: '/(^|\n)# Files(\n|$$)/,/(^|\n)# Finished Make data base/ {if ($$1 !~ "^[#.]") {print $$1}}' | sort | grep -E -v -e '^[^[:alnum:]]' -e '^$@$$'

makeinfo: # Shows the current make command running
	@echoerr() { echo "$$@" 1>&2; }; \
	goal="$(MAKECMDGOALS)"; \
	if [ "$$goal" = "" ] || [ "$$goal" = "makeinfo" ]; then goal="help"; fi; \
	echoerr ""; \
	echoerr "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
	echoerr "  Running: $$goal"; \
	echoerr "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; \
	echoerr ""

################################################################################
#                              Watch — See it work                             #
################################################################################

# Start the supervisor — polls your AoE sessions, reasons, and acts autonomously.
# Creates the AoE session for this repo if it doesn't exist.
self: build ## [Watch] aoaoe supervises itself (reads roadmap, implements, commits, pushes)
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

self-dry: build ## [Watch] Observe + plan only, no actions executed (safe alongside live sessions)
	@echo ""
	@echo "  aoaoe dry-run: observing + planning, no actions executed."
	@echo "  Safe alongside any live AoE sessions. Ctrl+C to stop."
	@echo ""
	node dist/index.js --dry-run

################################################################################
#                          Run — Supervise your projects                       #
################################################################################

setup: ## [Run] Install deps, build, create the AoE session (run once before anything else)
	npm install
	npm run build
	@echo ""
	@echo "  checking for 'aoaoe' AoE session..."
	@if aoe list --json 2>/dev/null | python3 -c \
		"import sys,json; sessions=json.load(sys.stdin); print('ok' if any(s['title']=='aoaoe' for s in sessions) else 'missing')" \
		2>/dev/null | grep -q ok; then \
		echo "  session already exists"; \
	else \
		echo "  creating session..."; \
		aoe add "$(PWD)" -t "aoaoe" -c opencode -y; \
		echo "  session created"; \
	fi
	@echo ""
	@echo "  Ready."
	@echo "  make self         supervise this repo (self-improvement mode)"
	@echo "  make daemon       supervise your own AoE sessions"
	@echo "  make self-dry     observe + plan, no actions"
	@echo ""

daemon: build ## [Run] Supervise your AoE sessions (polls all active sessions, reasons, acts)
	@echo ""
	@echo "  starting aoaoe daemon..."
	@echo "  watching all active AoE sessions. Ctrl+C to stop."
	@echo ""
	node dist/index.js

start: daemon ## [Run] Alias for daemon

################################################################################
#                          Build — Develop aoaoe itself                        #
################################################################################

build: ## [Build] Compile TypeScript → dist/
	npm run build

dev: ## [Build] Watch mode — recompile on save
	npm run dev

watch: dev ## [Build] Alias for dev

lint: ## [Build] Type-check without emitting
	npm run lint

check: lint ## [Build] Alias for lint

test: build ## [Build] Unit tests (2100+, no external deps, runs in seconds)
	npm test

test-integration: build ## [Build] End-to-end test — real aoe + tmux (~30s); requires aoe, opencode/claude-code, tmux
	node dist/integration-test.js

test-all: test test-integration ## [Build] Unit + integration tests

clean: ## [Build] Remove dist/
	rm -rf dist

################################################################################
#                                  Release                                     #
################################################################################

# Cut a release: runs all tests, bumps version, tags, and pushes.
# CI handles npm publish + GitHub Release automatically.
# Usage: make release v=0.30.0
release: test-all ## [Release] Tag + push a new version (CI publishes to npm). Usage: make release v=0.30.0
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

################################################################################
#                               Backward Compat                                #
################################################################################

demo-setup: setup ## Alias for setup
demo: self        ## Alias for self
demo-dry: self-dry ## Alias for self-dry
