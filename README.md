# ATMOS (Analytics Time-Series Modeling Operational System)

ATMOS es una plataforma web para ingestión ETL, analítica atmosférica y gestión de workspaces de investigación aislados.

## Módulos principales
- ETL para ingestión de series históricas y cargas manuales.
- Analytical Workspace con visualizaciones interactivas.
- Autenticación JWT con RBAC (`admin`, `researcher`, `generic`).
- Multi-tenant por esquema PostgreSQL (`schema-per-tenant`) para workspaces.
- Persistencia de dashboards por workspace con bloques dinámicos.

## Stack
- Backend: FastAPI + SQLAlchemy + PostgreSQL/PostGIS
- Frontend: React + TypeScript + Recharts + Tailwind

## Roles RBAC
- `admin`: acceso total, creación de usuarios, configuración global.
- `researcher`: workspaces propios, ETL, análisis avanzado y guardado de dashboards.
- `generic`: acceso restringido solo a `/public-dashboard`.

## Backend (desarrollo local)
```bash
cd apps/backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Frontend (desarrollo local)
```bash
npm install --workspace @atmos/frontend
npm run dev:frontend
```

## Docker (stack completo)
```bash
npm run dev
```

Servicios:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- OpenAPI: `http://localhost:8000/docs`

## Inicialización de base de datos
La inicialización del esquema base ahora ocurre por defecto al iniciar backend (`AUTO_INIT_DB_ON_STARTUP=true`).
No es necesario ejecutar `curl` ni scripts manuales para crear tablas base.

## Variables relevantes
Backend (`apps/backend/.env.example`):
- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `ACCESS_TOKEN_EXPIRE_MINUTES`
- `REFRESH_TOKEN_EXPIRE_DAYS`
- `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES`
- `WORKSPACE_STORAGE_DIR`
- `AUTO_INIT_DB_ON_STARTUP`

## Endpoints de autenticación
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`

## Workspaces multi-tenant
- `GET /api/v1/workspaces/`
- `POST /api/v1/workspaces/`
- `GET /api/v1/workspaces/{workspace_id}`
- `GET /api/v1/workspaces/{workspace_id}/dashboards`
- `POST /api/v1/workspaces/{workspace_id}/dashboards`

Cada workspace crea:
- esquema PostgreSQL dedicado (`ws_<user>_<slug>`)
- tablas internas (`dashboards`, `ml_artifacts`)
- storage aislado en disco (`data/workspaces/<user>/<workspace>`)
