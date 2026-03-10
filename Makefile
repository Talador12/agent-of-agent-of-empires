.PHONY: help setup build dev lint test test-integration test-all clean start daemon check

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

test: build ## run unit tests (477 tests, no external deps)
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
