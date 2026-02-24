# Despliegue en Azure App Service

## Objetivo

Desplegar frontend (React build estatico) y backend (FastAPI) como apps separadas para mantener desacoplamiento.

## Recursos recomendados

- 1 Resource Group
- 1 App Service Plan (Linux)
- 2 Web Apps:
  - `atmos-frontend-prod`
  - `atmos-backend-prod`
- 1 Azure Database for PostgreSQL Flexible Server (+ PostGIS)

## Variables backend (App Settings)

- `APP_NAME=ATMOS API`
- `ENVIRONMENT=production`
- `API_V1_PREFIX=/api/v1`
- `CORS_ORIGINS=https://<frontend-domain>`
- `DATABASE_URL=postgresql+psycopg://...`
- `JWT_SECRET_KEY=<secure-secret>`
- `JWT_ALGORITHM=HS256`
- `ACCESS_TOKEN_EXPIRE_MINUTES=60`

## Variables frontend (build-time)

- `VITE_API_BASE_URL=https://<backend-domain>`

## Flujo GitHub Actions recomendado

1. CI valida build frontend + lint/test backend.
2. CD despliega frontend y backend por separado via publish profiles.

Archivo base de workflow incluido: `.github/workflows/deploy-azure-appservice.yml`.

## Verificacion post-despliegue

1. Backend health: `GET https://<backend-domain>/api/v1/health`
2. OpenAPI: `https://<backend-domain>/docs`
3. Frontend carga sin errores y consume API correcta.
