# Quality and CI/CD Guide

ATMOS is a Python/FastAPI and React/TypeScript project. The Java tools Checkstyle, JaCoCo and PMD do not apply directly because the repository has no Java modules. The equivalent quality gates used here are:

- Backend style and static analysis: Ruff and Pylint.
- Backend unit tests and coverage: Pytest and pytest-cov.
- Frontend style and consistency: ESLint and TypeScript.
- Frontend unit tests and coverage: Vitest with V8 coverage.

## Test Layout

Backend tests live in:

```text
apps/backend/tests/
apps/backend/tests/unit/
```

Frontend tests live in:

```text
apps/frontend/src/__tests__/unit/
apps/frontend/src/**/*.test.ts
apps/frontend/src/**/*.test.tsx
```

Generated reports live in `reports/` and are ignored by Git.

## Local Commands

Backend:

```bash
cd apps/backend
ruff check .
python -m pylint app tests --fail-under=8.0
pytest --cov=app --cov-report=term-missing --cov-report=xml:../../reports/backend-coverage.xml --junitxml=../../reports/backend-junit.xml
```

Frontend:

```bash
npm run lint:frontend
npm run typecheck:frontend
npm run coverage:frontend
npm run build:frontend
```

Full local quality pass:

```bash
npm run backend:coverage
npm run lint:frontend
npm run typecheck:frontend
npm run coverage:frontend
npm run build:frontend
```

## GitLab Branch Policy

The GitLab pipeline is configured for:

- `main`
- `feat/*`
- merge requests

Validation, tests, coverage, builds and package checks run automatically on those branches. Azure deployment is not active
only from `main` when the required GitLab CI/CD variables are configured.

## GitLab Pipeline Jobs

Backend:

- `backend:ruff`: Ruff style, import and bug-risk checks. Publishes `reports/quality/backend/ruff.html`.
- `backend:pylint`: Pylint static analysis with a minimum score of `9.5`. Publishes `reports/quality/backend/pylint.html`.
- `backend:test`: Pytest with branch coverage and minimum total coverage of `80%`. Publishes JUnit, Cobertura XML and HTML coverage.
- `backend:package`: Creates a backend ZIP artifact without tests, caches, virtualenvs or data files.

Frontend:

- `frontend:eslint`: ESLint with zero warnings. Publishes `reports/quality/frontend/eslint.html`.
- `frontend:typecheck`: TypeScript compile check with `tsc --noEmit`.
- `frontend:test`: Vitest with V8 coverage. Publishes JUnit, Cobertura XML and HTML coverage.
- `frontend:build`: Vite production build.
- `frontend:package`: Creates a compressed frontend build artifact from `apps/frontend/dist`.

## Required GitLab Runner Capabilities

Use a GitLab runner that can run Docker executor jobs and pull public images:

- `python:3.11-slim`
- `node:20-alpine`
- `node:20-bullseye`
- `alpine:3.20`
- `mcr.microsoft.com/azure-cli:latest`

The runner must have outbound internet access to install Python and npm dependencies unless dependency caches are already
available.

## GitLab Variables

No Azure credentials are required for `feat/...` branches or merge requests.

Azure deployment from `main` requires the variables documented in `infra/azure/README.md`:

```text
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
AZURE_RESOURCE_GROUP
AZURE_ACR_NAME
AZURE_CONTAINER_ENV_NAME
AZURE_CONTAINER_APP_NAME
AZURE_FRONTEND_STORAGE_ACCOUNT
AZURE_FRONTEND_URL
CORS_ORIGINS
ACR_USERNAME
ACR_PASSWORD
AZURE_STORAGE_ACCOUNT_KEY
DATABASE_URL
JWT_SECRET_KEY
```

## How to Test in GitLab

1. Push the branch `feat/plotly-graphs-optimization` or any branch matching `feat/*`.
2. Open GitLab > CI/CD > Pipelines.
3. Confirm the pipeline includes validate, test, build and package stages.
4. Open each job and download artifacts to inspect HTML reports.
5. Create a merge request into `main` to verify the same gates run on merge requests.

The backend coverage gate is `80%` through `BACKEND_COVERAGE_MIN`; frontend coverage thresholds are enforced by Vitest configuration.
