# ATMOS

ATMOS (Atmospheric Time-series Modeling & Observation System) es una plataforma web para ingestión, transformación, análisis, monitoreo y predicción de datos de calidad del aire basados en series temporales.

La aplicación usa datos públicos de la REMMAQ para visualizar e interpretar la calidad del aire en Quito, y permite trabajar con espacios de análisis aislados por equipo o proyecto.

## Características

- Ingesta ETL desde fuentes REMMAQ y cargas manuales.
- Dashboards y análisis de series temporales por workspace.
- Autenticación JWT y roles `admin`, `researcher` y `generic`.
- Arquitectura multi-tenant con un esquema PostgreSQL por workspace.
- Persistencia de artefactos, archivos y configuraciones de análisis.

## Stack

- Backend: FastAPI, Python 3.11+, SQLAlchemy 2, Pydantic, Pandas, PostgreSQL y PostGIS.
- Frontend: React 18, TypeScript, Vite, Tailwind CSS, Radix UI/MUI, Recharts, Plotly y React Leaflet.
- Infra local: Docker Compose con PostgreSQL/PostGIS, API y frontend estático servido por Nginx.

## Estructura

```text
.
├── apps/
│   ├── backend/       # API FastAPI, ETL, modelos y servicios
│   └── frontend/      # SPA React + Vite
├── docs/              # Documentación técnica
├── infra/             # Infraestructura y despliegue
├── packages/
│   └── contracts/     # Contratos API compartidos
├── docker-compose.yml # Ejecución local con contenedores
├── Makefile           # Atajos de desarrollo
└── package.json       # Scripts de workspace
```

## Requisitos

Para Docker:

- Docker y Docker Compose.

Para ejecución local sin contenedores de aplicación:

- Node.js 18+ y npm.
- Python 3.11+.
- PostgreSQL 16 con PostGIS, o el servicio `db` de `docker-compose.yml`.

## Variables de entorno

Para Docker no es obligatorio copiar archivos `.env`; `docker-compose.yml` incluye valores de desarrollo listos para levantar la aplicación. Opcionalmente puedes copiar el archivo raíz si quieres fijar el nombre del proyecto de Compose:

```bash
cp .env.example .env
```

Para ejecución local del backend:

```bash
cp apps/backend/.env.example apps/backend/.env
```

Variables clave:

- `DATABASE_URL`: conexión PostgreSQL. En local con el `db` de Docker usa `postgresql+psycopg://atmos:atmos_dev_password@localhost:5432/atmos`.
- `JWT_SECRET_KEY`: secreto para firmar tokens. Debe cambiarse fuera de desarrollo.
- `AUTO_INIT_DB_ON_STARTUP`: si está en `true`, inicializa el esquema base al arrancar.
- `CORS_ORIGINS`: orígenes permitidos para el frontend.
- `WORKSPACE_STORAGE_DIR`: ruta donde se guardan archivos de workspaces.

Para ejecución local del frontend:

```bash
cp apps/frontend/.env.example apps/frontend/.env.local
```

Variable clave:

- `VITE_API_BASE_URL`: URL del backend, por defecto `http://localhost:8000`.

## Ejecución Con Docker

Esta es la opción recomendada para correr toda la plataforma en local. Levanta PostgreSQL/PostGIS, backend y frontend.

Desde la raíz del proyecto:

```bash
docker compose up --build
```

También puedes usar los atajos equivalentes:

```bash
npm run dev
# o
make docker-dev
```

Servicios disponibles:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`
- Swagger/OpenAPI: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`

Para detener los contenedores:

```bash
docker compose down
```

Para detenerlos y borrar los volúmenes de base de datos y workspaces:

```bash
docker compose down -v
```

## Ejecución Local Sin Contenedores De Aplicación

Usa esta opción cuando necesites depurar backend o frontend directamente desde el host.

1. Levanta solo la base de datos:

   ```bash
   docker compose up -d db
   ```

2. Prepara y ejecuta el backend:

   ```bash
   cd apps/backend
   python -m venv .venv
   source .venv/bin/activate
   pip install -e ".[dev]"
   cp .env.example .env
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

3. En otra terminal, prepara y ejecuta el frontend:

   ```bash
   npm install
   cp apps/frontend/.env.example apps/frontend/.env.local
   npm run dev:frontend
   ```

## Ejecución En Red Local

Para probar la aplicación desde otros dispositivos de la misma red:

```bash
docker compose up -d db
cd apps/backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd ../..
npm install
```

Luego ejecuta:

```bash
make dev-lan
```

El comando detecta la IP local, ajusta `apps/backend/.env` y `apps/frontend/.env.local`, y levanta backend y frontend en `0.0.0.0`.

Comandos relacionados:

```bash
make lan-stop
make lan-clean
```

## Scripts Útiles

Desde la raíz del proyecto:

- `npm run dev`: levanta toda la aplicación con Docker Compose.
- `npm run dev:frontend`: levanta Vite en `0.0.0.0:5173`.
- `npm run build:frontend`: compila el frontend.
- `npm run lint:frontend`: ejecuta ESLint.
- `npm run typecheck:frontend`: valida TypeScript.
- `npm run test:frontend`: ejecuta pruebas del frontend.
- `npm run backend:dev`: levanta FastAPI en modo recarga.
- `npm run backend:test`: ejecuta pruebas del backend.
- `npm run backend:lint`: ejecuta Ruff.

Atajos equivalentes del `Makefile`:

```bash
make help
make db-up
make lint
make typecheck
make test
make check
```

## Flujo Básico

1. Levanta la plataforma con Docker.
2. Entra a `http://localhost:5173`.
3. Registra o inicia sesión con un usuario.
4. Crea o selecciona un workspace.
5. Carga datos, ejecuta procesos ETL y construye dashboards o análisis.

## Documentación Relacionada

- Backend: `apps/backend/README.md`
- Frontend: `apps/frontend/README.md`
- Contratos API: `packages/contracts/README.md`
- Arquitectura: `docs/architecture.md`
- Calidad y CI: `docs/quality-ci.md`
- Azure: `infra/azure/README.md`

## Licencia

Este proyecto está bajo licencia MIT. Consulta `LICENSE` para más detalles.
