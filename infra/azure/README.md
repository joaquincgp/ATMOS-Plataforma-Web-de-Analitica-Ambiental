# Despliegue En Azure

Guía para desplegar la demo pública de ATMOS en Azure con costos controlados.

## Arquitectura Objetivo

- Frontend: Azure Storage Static Website.
- Backend: Azure Container Apps con `min-replicas 0` y `max-replicas 1`.
- Imágenes: Azure Container Registry Basic.
- Base de datos: Azure Database for PostgreSQL Flexible Server, SKU `Standard_B1ms`, 32 GB.
- Logs: Log Analytics con retención de 30 días.
- CI/CD: GitLab CI con OIDC y User-Assigned Managed Identity, sin secretos de Service Principal.

El despliegue automático corre desde `main`. Las ramas `feat/...` y merge requests validan, prueban, compilan y empaquetan, pero no publican en Azure.

## Región

La región por defecto es `brazilsouth` (São Paulo). Se usa porque el backend necesita conectarse a APIs públicas del Municipio de Quito (`aireambiente.quito.gob.ec` y `datosambiente.quito.gob.ec`) que bloquean algunas regiones norteamericanas de Azure.

## Requisitos

- Azure CLI autenticado.
- Suscripción activa de Azure.
- Proyecto GitLab con CI/CD habilitado.
- Permisos para crear Resource Groups, ACR, PostgreSQL Flexible Server, Container Apps, Storage Accounts, Managed Identities y federated credentials.

## Primer Despliegue

1. Inicia sesión:

   ```powershell
   az login
   az account set --subscription "<subscription-id>"
   ```

2. Ejecuta el script de aprovisionamiento:

   ```powershell
   .\infra\azure\provision-low-cost.ps1 `
     -SubscriptionId "<subscription-id>" `
     -ResourceGroup "rg-atmos-prod" `
     -Location "brazilsouth" `
     -NamePrefix "atmosprod" `
     -GitLabProjectPath "<gitlab-namespace>/<project-slug>"
   ```

3. Copia las variables que imprime el script en `Settings > CI/CD > Variables` de GitLab.

4. Haz push a `main` para disparar el despliegue.

Si `NamePrefix` choca con un nombre global existente de Azure, vuelve a ejecutar el script con otro prefijo.

## Variables De GitLab CI/CD

Variables no secretas:

- `AZURE_FRONTEND_URL`: URL del Static Website.
- `AZURE_BACKEND_URL`: URL del Container App.
- `AZURE_CLIENT_ID`: Client ID de la Managed Identity.
- `AZURE_TENANT_ID`: tenant de Azure.
- `AZURE_SUBSCRIPTION_ID`: suscripción de Azure.

Variables secretas o sensibles:

- `ACR_LOGIN_SERVER`: servidor del registry, por ejemplo `atmosprodacr.azurecr.io`.
- `ACR_USERNAME`: usuario admin de ACR.
- `ACR_PASSWORD`: password admin de ACR.
- `AZURE_FRONTEND_STORAGE_ACCOUNT`: storage account del frontend.
- `AZURE_STORAGE_ACCOUNT_KEY`: key del storage account.
- `DATABASE_URL`: conexión PostgreSQL con SSL.
- `JWT_SECRET_KEY`: secreto JWT largo y aleatorio.

`DATABASE_URL` debe incluir SSL:

```text
postgresql+psycopg://<user>:<password>@<server>.postgres.database.azure.com:5432/atmos?sslmode=require
```

Protege las variables si `main` está protegida.

## Flujo De Deploy

En `main`, el pipeline:

1. Ejecuta validaciones de backend y frontend.
2. Construye y empaqueta la aplicación.
3. Publica la imagen backend en ACR con tags `:$CI_COMMIT_SHA` y `:main`.
4. Autentica en Azure con OIDC.
5. Actualiza Azure Container Apps con la imagen nueva.
6. Reconstruye el frontend con `VITE_API_BASE_URL=$AZURE_BACKEND_URL`.
7. Sube `apps/frontend/dist` al contenedor `$web` del Static Website.

## Control De Costos

- Container Apps escala el backend a cero cuando está inactivo.
- El frontend estático no requiere contenedor encendido.
- PostgreSQL Flexible Server es el principal costo permanente.
- En producción se usa `ETL_SYNC_DEFAULT_MAX_ARCHIVES=2` para evitar ingestas costosas.
- Crea alertas de presupuesto al 50%, 80% y 100% del gasto previsto.

## Eliminar El Entorno

Cuando la demo ya no se necesite:

```powershell
.\infra\azure\delete-environment.ps1 -ResourceGroup "rg-atmos-prod"
```

Esto elimina PostgreSQL, Container Apps, ACR, Storage Static Website, logs y recursos relacionados.

## Notas

- El backend inicializa el esquema al arrancar con `AUTO_INIT_DB_ON_STARTUP=true`, incluyendo `CREATE EXTENSION IF NOT EXISTS postgis`.
- PostgreSQL Flexible Server debe permitir la extensión `POSTGIS`; el script configura `azure.extensions=POSTGIS`.
- El dashboard público sincroniza datos vivos desde `aireambiente.quito.gob.ec`; el ETL histórico descarga desde `datosambiente.quito.gob.ec`.
- La documentación resumida de despliegue también está en `docs/deployment-azure.md`.
