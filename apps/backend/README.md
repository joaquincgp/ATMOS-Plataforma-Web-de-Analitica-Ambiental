# ATMOS Backend

Backend de ATMOS con FastAPI organizado por capas para facilitar ETL, analitica y seguridad.

## Setup local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Estructura base

```text
app/
  main.py                 # arranque FastAPI + middleware
  api/                    # routers y dependencias HTTP
    deps.py
    v1/
      endpoints/
  core/                   # configuracion global
  db/                     # engine y sesiones
  models/                 # entidades ORM (SQLAlchemy)
  schemas/                # contratos Pydantic (input/output)
  services/               # logica de negocio
```

## Endpoints actuales

- `GET /api/v1/health`
- `POST /api/v1/auth/login` (stub)
- `GET /api/v1/stations`
- `POST /api/v1/etl/db/init` (inicializa esquema desde codigo)
- `POST /api/v1/etl/sync/remmaq` (extraccion automatica REMMAQ)
- `POST /api/v1/etl/upload` (carga manual de archivo)
- `GET /api/v1/etl/runs`
- `GET /api/v1/etl/metrics`

## Flujo ETL (REMMAQ)

1. `POST /api/v1/etl/db/init` para crear tablas.
2. `POST /api/v1/etl/sync/remmaq` para descubrir links estaticos, descargar RAR/XLSX, normalizar y cargar.
3. `GET /api/v1/etl/runs` para trazabilidad por corrida.

## Notas operativas

- Si ejecutas ETL con archivos `.rar`, instalar `unrar` o `unar` en el host.
- Para inicializar automaticamente al levantar FastAPI: `AUTO_INIT_DB_ON_STARTUP=true`.
