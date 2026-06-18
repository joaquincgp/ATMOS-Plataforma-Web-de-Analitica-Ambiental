# API Contracts

Paquete para contratos API compartidos entre backend, frontend e integraciones externas.

## Contenido

```text
openapi/
  atmos-api.v1.yaml       # contrato OpenAPI inicial de ATMOS
```

## Uso

- Usa el contrato como referencia estable para clientes y validaciones.
- Mantén compatibilidad hacia atrás dentro de la misma versión cuando sea posible.
- Si cambias rutas, payloads o respuestas públicas, actualiza este paquete en el mismo cambio.

## Validación Manual

Puedes inspeccionar el contrato con cualquier visor OpenAPI compatible o compararlo con la documentación viva del backend en:

```text
http://localhost:8000/docs
```

El contrato actual es una base inicial; la fuente operativa completa de rutas sigue siendo el backend en `apps/backend/app/api/v1`.
