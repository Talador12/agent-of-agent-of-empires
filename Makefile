.PHONY: help setup build dev lint test test-integration test-all clean start daemon check release demo demo-setup demo-dry

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## install deps + build (first-time setup)
	npm install
	npm run build
	@echo ""
	@echo "  done. run 'make daemon' to start, or 'make test' to verify."

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
## ── Demo ──────────────────────────────────────────────────────────────────────
##

demo-setup: ## ensure the AoE session for this repo exists (run once before make demo)
	@echo ""
	@echo "  checking for 'agent-of-agent-of-empires' AoE session..."
	@if aoe list --json 2>/dev/null | python3 -c "import sys,json; sessions=json.load(sys.stdin); print('ok' if any(s['title']=='agent-of-agent-of-empires' for s in sessions) else 'missing')" 2>/dev/null | grep -q ok; then \
		echo "  ✓ session already exists"; \
	else \
		echo "  creating session..."; \
		aoe add "$(PWD)" -t "agent-of-agent-of-empires" -c opencode -y; \
		echo "  ✓ session created"; \
	fi
	@echo ""
	@echo "  ready. run 'make demo' to start supervising."
	@echo ""

demo: build ## start aoaoe supervising this repo (uses aoaoe.tasks.json goal)
	@echo ""
	@echo "  ┌──────────────────────────────────────────────────────┐"
	@echo "  │         aoaoe self-improvement demo                  │"
	@echo "  │                                                       │"
	@echo "  │  aoaoe will supervise itself — watching the          │"
	@echo "  │  agent-of-agent-of-empires AoE session and giving   │"
	@echo "  │  it the roadmap goal from aoaoe.tasks.json.          │"
	@echo "  │                                                       │"
	@echo "  │  ESC ESC to interrupt  •  /help for TUI commands     │"
	@echo "  └──────────────────────────────────────────────────────┘"
	@echo ""
	@if ! aoe list --json 2>/dev/null | python3 -c "import sys,json; sessions=json.load(sys.stdin); exit(0 if any(s['title']=='agent-of-agent-of-empires' for s in sessions) else 1)" 2>/dev/null; then \
		echo "  ⚠  no 'agent-of-agent-of-empires' AoE session found."; \
		echo "  run 'make demo-setup' first, then 'make demo'."; \
		echo ""; \
		exit 1; \
	fi
	node dist/index.js

demo-dry: build ## demo in dry-run mode — observe + plan, no actions executed
	@echo ""
	@echo "  starting aoaoe in dry-run mode (observe only)..."
	@echo "  press Ctrl+C to stop"
	@echo ""
	node dist/index.js --dry-run

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
