# Arquitectura base ATMOS

## Objetivo

Separar responsabilidades entre presentacion (SPA), servicios API (FastAPI), procesamiento de datos (ETL/analitica) y persistencia (PostgreSQL + PostGIS), manteniendo evolucion modular.

## Vista de alto nivel

1. `frontend` consume API REST sobre HTTPS.
2. `backend` valida contratos, aplica reglas de negocio y orquesta pipelines.
3. `database` centraliza series temporales, metadatos y resultados.
4. `contracts` define entradas/salidas para analitica segura.

## Modulos backend (target)

- `api`: rutas REST versionadas
- `core`: configuracion, seguridad, middlewares
- `services`: casos de uso (etl, analisis, modelado)
- `repositories`: acceso a datos con ORM
- `schemas`: DTOs/Pydantic por modulo
- `workers`: tareas programadas de ingesta batch

## Modulos frontend (target)

- `app/pages`: pantallas por modulo funcional
- `app/components`: componentes UI reutilizables
- `features`: logica por dominio (projects, datasets, analytics)
- `shared`: clientes HTTP, tipos, utilidades, estado global

## Principios aplicados

- API-first con contrato versionado
- Separacion estricta de responsabilidades
- Configuracion por entorno (12-factor)
- Entornos reproducibles (Docker)
- Validaciones automticas y pruebas desde la base
