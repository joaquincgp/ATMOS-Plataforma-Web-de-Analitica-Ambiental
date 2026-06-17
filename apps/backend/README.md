# ATMOS Backend

API de ATMOS construida con FastAPI. Expone autenticación, workspaces, ETL, analítica y endpoints públicos de calidad del aire.

## Requisitos

- Python 3.11+.
- PostgreSQL con PostGIS.
- `unar` o `unrar` si vas a procesar archivos `.rar` fuera de Docker.

El contenedor del backend ya instala `unar`.

## Configuración Local

Desde `apps/backend`:

```bash
cp .env.example .env
```

Variables principales:

- `DATABASE_URL`: conexión a PostgreSQL.
- `JWT_SECRET_KEY`: secreto de tokens JWT.
- `CORS_ORIGINS`: frontend autorizado, por ejemplo `http://localhost:5173`.
- `AUTO_INIT_DB_ON_STARTUP`: inicializa tablas y extensiones al arrancar si está en `true`.
- `ETL_STORAGE_DIR`: artefactos temporales del ETL.
- `WORKSPACE_STORAGE_DIR`: archivos persistidos por workspace.

Si usas la base de datos del `docker-compose.yml` desde el host:

```env
DATABASE_URL=postgresql+psycopg://atmos:atmos_dev_password@localhost:5432/atmos
```

## Ejecución

Desde la raíz del repositorio, puedes levantar solo la base de datos:

```bash
docker compose up -d db
```

Luego ejecuta el backend:

```bash
cd apps/backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

La API queda disponible en:

- `http://localhost:8000`
- `http://localhost:8000/docs`

## Ejecución Con Docker

Desde la raíz:

```bash
docker compose up --build backend db
```

Para levantar toda la plataforma:

```bash
docker compose up --build
```

## Comandos De Calidad

Desde la raíz:

```bash
npm run backend:test
npm run backend:lint
npm run backend:pylint
```

Desde `apps/backend`:

```bash
pytest -q
ruff check .
python -m pylint app tests --fail-under=8.0
```

## Rutas Principales

Todas las rutas versionadas usan el prefijo `/api/v1`.

- `GET /health`
- `/auth`: registro, login, sesión, perfil y recuperación de contraseña.
- `/workspaces`: administración de workspaces y dashboards.
- `/etl`: inicialización de BD, sincronización REMMAQ, carga manual y trazabilidad de corridas.
- `/analytics`: filtros, consultas, datos vivos por estación y vista previa SQL.
- `/eda`: generación de visualizaciones exploratorias.
- `/advanced-analytics`: modelos predictivos.
- `/public/air-quality`: datos públicos para dashboard abierto.
- `/config`: configuración funcional de la aplicación.

## Estructura

```text
app/
  main.py                 # aplicación FastAPI y middleware
  api/                    # routers, dependencias y versionado
  core/                   # configuración y seguridad
  db/                     # engine, sesiones e inicialización
  models/                 # modelos SQLAlchemy
  schemas/                # DTOs Pydantic
  services/               # lógica de negocio, ETL y analítica
```

## Notas Operativas

- `AUTO_INIT_DB_ON_STARTUP=true` crea el esquema base y habilita PostGIS al arrancar.
- Los archivos ETL y de workspace pueden crecer; revisa `ETL_STORAGE_DIR` y `WORKSPACE_STORAGE_DIR` si corres pruebas grandes.
- Para reiniciar por completo la base local usada por Docker: `docker compose down -v`.
