# Everything runs in containers (docker compose); nothing is installed on the host.
# Use `make DC="podman compose"` (and DOCKER=podman) for Podman.
DC     ?= docker compose
DOCKER ?= docker
CERTS  := .docker/certs

.DEFAULT_GOAL := help
.PHONY: help install build typecheck test devcerts clean-dist down

help: ## List commands
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

install: ## npm install (writes node_modules through the bind mount)
	$(DC) run --rm base npm install

build: ## Build all packages + the UI (apps/google-sheets/dist)
	$(DC) run --rm base npm run build

typecheck: ## Typecheck every workspace
	$(DC) run --rm typecheck

test: ## Run the integration tests
	$(DC) run --rm test

certs: ## One-time: local CA + localhost cert in .docker/certs (then trust rootCA.pem)
	@mkdir -p $(CERTS)
	$(DOCKER) run --rm -v "$(CURDIR)/$(CERTS)":/certs -v "$(CURDIR)/docker/gen-certs.sh":/gen.sh:ro \
	  node:22-alpine sh -c "apk add -q --no-cache openssl && sh /gen.sh"

dev: ## Dev server with hot reload: https://localhost:3000 (mock sheet + real UI)
	$(DC) up app

clean-dist: ## Remove build output
	$(DC) run --rm base npm run clean --workspace=google-sheets

down: ## Stop and remove running containers
	$(DC) down
