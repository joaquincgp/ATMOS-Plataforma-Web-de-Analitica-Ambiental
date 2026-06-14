# Despliegue en Azure

La estrategia vigente de despliegue esta documentada en `infra/azure/README.md`.

Resumen:

- Frontend: Azure Storage Static Website.
- Backend: Azure Container Apps con escala a cero.
- Imagen backend: Azure Container Registry Basic.
- Base de datos: Azure Database for PostgreSQL Flexible Server `Standard_B1ms`.
- Despliegue automatico: GitLab CI/CD solo desde `main`.
- Ramas `feat/...`: validan, prueban, compilan y empaquetan, pero no despliegan.

La configuracion anterior con App Service queda descartada para este proyecto porque mantiene mas recursos activos y no es la opcion mas eficiente para creditos limitados.
