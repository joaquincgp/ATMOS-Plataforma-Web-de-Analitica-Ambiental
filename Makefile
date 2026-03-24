SHELL := /bin/zsh

.PHONY: help setup-env install docker-dev db-up backend-dev frontend-dev lint typecheck test check

help:
	@printf "Available targets:\n"
	@printf "  make setup-env     Copy .env.example to .env if missing\n"
	@printf "  make install       Install frontend and backend dependencies\n"
	@printf "  make docker-dev    Start db, backend and frontend with Docker\n"
	@printf "  make db-up         Start only PostgreSQL/PostGIS\n"
	@printf "  make backend-dev   Run FastAPI locally on :8000\n"
	@printf "  make frontend-dev  Run Vite locally on :5173\n"
	@printf "  make lint          Run frontend lint and backend ruff\n"
	@printf "  make typecheck     Run frontend typecheck\n"
	@printf "  make test          Run backend tests\n"
	@printf "  make check         Run lint, typecheck and tests\n"

setup-env:
	@if [ ! -f .env ] && [ -f .env.example ]; then cp .env.example .env; echo ".env created from .env.example"; else echo ".env already exists or .env.example missing"; fi

install:
	npm install
	cd apps/backend && python3 -m pip install -e ".[dev]"

docker-dev:
	docker compose up --build

db-up:
	docker compose up -d db

backend-dev:
	cd apps/backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

frontend-dev:
	npm run dev --workspace @atmos/frontend

lint:
	npm run lint --workspace @atmos/frontend
	cd apps/backend && ruff check .

typecheck:
	npm run typecheck --workspace @atmos/frontend

test:
	cd apps/backend && pytest -q

check: lint typecheck test
