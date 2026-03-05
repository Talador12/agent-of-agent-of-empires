.PHONY: build dev lint clean install start

build: ## compile typescript
	npm run build

dev: ## watch mode
	npm run dev

lint: ## type-check without emitting
	npm run lint

clean: ## remove build artifacts
	npm run clean

install: ## install deps
	npm install

start: build ## build and run
	node dist/index.js

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
