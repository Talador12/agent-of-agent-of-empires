.PHONY: help setup build dev lint test test-integration test-all clean start daemon check release self self-dry demo demo-setup demo-dry

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## install deps, build, and ensure the AoE session for this repo exists
	npm install
	npm run build
	@echo ""
	@echo "  checking for 'aoaoe' AoE session..."
	@if aoe list --json 2>/dev/null | python3 -c "import sys,json; sessions=json.load(sys.stdin); print('ok' if any(s['title']=='aoaoe' for s in sessions) else 'missing')" 2>/dev/null | grep -q ok; then \
		echo "  ✓ session already exists"; \
	else \
		echo "  creating session..."; \
		aoe add "$(PWD)" -t "aoaoe" -c opencode -y; \
		echo "  ✓ session created"; \
	fi
	@echo ""
	@echo "  done. run 'make self' to supervise, or 'make test' to verify."

build: ## compile typescript
	npm run build

dev: ## watch mode (recompile on save)
	npm run dev

lint: ## type-check without emitting
	npm run lint

check: lint ## alias for lint

test: build ## run unit tests (2100+ tests, no external deps)
	npm test

test-integration: build ## run integration test (creates real aoe sessions, ~30s)
	node dist/integration-test.js

test-all: test test-integration ## run both unit + integration tests

clean: ## remove build artifacts
	rm -rf dist

daemon: build ## build and start the supervisor daemon
	@echo ""
	@echo "  starting aoaoe daemon..."
	@echo "  press Ctrl+C to stop"
	@echo ""
	node dist/index.js

start: daemon ## alias for daemon

##
## ── Self-improvement (aoaoe supervising its own repo) ────────────────────────
##

self: build ## aoaoe supervises itself — reads roadmap, ships features, commits, pushes
	@echo ""
	@echo "  ┌──────────────────────────────────────────────────────┐"
	@echo "  │              aoaoe self-improvement                  │"
	@echo "  │                                                       │"
	@echo "  │  aoaoe supervises its own AoE session, picks tasks   │"
	@echo "  │  from the roadmap in aoaoe.tasks.json, implements,   │"
	@echo "  │  commits, and pushes — updating itself in real time. │"
	@echo "  │                                                       │"
	@echo "  │  ESC ESC to interrupt  •  /help for TUI commands     │"
	@echo "  └──────────────────────────────────────────────────────┘"
	@echo ""
	@if ! aoe list --json 2>/dev/null | python3 -c "import sys,json; sessions=json.load(sys.stdin); exit(0 if any(s['title']=='aoaoe' for s in sessions) else 1)" 2>/dev/null; then \
		echo "  no 'aoaoe' AoE session found — creating one..."; \
		aoe add "$(PWD)" -t "aoaoe" -c opencode -y; \
	fi
	node dist/index.js

self-dry: build ## observe + plan without executing — safe way to watch what aoaoe would do
	@echo ""
	@echo "  starting aoaoe in dry-run mode (observe only)..."
	@echo "  press Ctrl+C to stop"
	@echo ""
	node dist/index.js --dry-run

## kept for backward compat
demo-setup: setup ## alias for setup
demo: self ## alias for self
demo-dry: self-dry ## alias for self-dry

##
## ── Release ───────────────────────────────────────────────────────────────────
##

release: test-all ## cut a release: run tests, tag, push (usage: make release v=0.29.0)
	@if [ -z "$(v)" ]; then echo "  usage: make release v=0.29.0"; exit 1; fi
	@if ! git diff --quiet HEAD; then echo "  error: uncommitted changes"; exit 1; fi
	@echo ""
	@echo "  releasing v$(v)..."
	npm version $(v) --no-git-tag-version
	git add package.json
	git commit -m "v$(v): $$(git log -1 --format='%s' | sed 's/^v[0-9]*\.[0-9]*\.[0-9]*: //')"
	git tag "v$(v)"
	git push origin main --tags
	@echo ""
	@echo "  v$(v) pushed. CI will npm publish + GitHub Release."
