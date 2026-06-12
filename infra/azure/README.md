# Azure deployment for `main`

This deployment path is optimized for a small public demo with controlled spend.

## Target architecture

- Frontend: Azure Static Web Apps Free tier.
- Backend: Azure Container Apps consumption environment, `min-replicas 0`, `max-replicas 1`.
- Images: Azure Container Registry Basic.
- Database: Azure Database for PostgreSQL Flexible Server, burstable `Standard_B1ms`, 32 GB storage.
- Logs: Log Analytics workspace with 30-day retention.

The GitHub workflow is `.github/workflows/deploy-azure-main.yml` and deploys automatically from `main`. Manual runs are guarded so deployment jobs only run when the selected ref is `main`.

GitLab CI listens to `main`, merge requests, and every `feat/...` branch. `feat/...` branches run validation, tests, build, and package jobs; Azure deployment runs automatically only from `main`.

## Cost controls

- Container Apps can scale to zero, so the backend should not run continuously when idle.
- Static Web Apps Free avoids running a frontend container.
- PostgreSQL Flexible Server is the main always-on cost. Delete the resource group when the demo is not needed.
- Keep `ETL_SYNC_DEFAULT_MAX_ARCHIVES=2` in production to reduce expensive background ingestion.
- Create an Azure budget alert before deploying. Suggested alerts: 50%, 80%, and 100% of your intended monthly spend.

## First-time setup

1. Login to Azure CLI:

   ```powershell
   az login
   az account set --subscription "<subscription-id>"
   ```

2. Provision low-cost resources:

   ```powershell
   .\infra\azure\provision-low-cost.ps1 `
     -SubscriptionId "<subscription-id>" `
     -ResourceGroup "rg-atmos-prod" `
     -Location "eastus2" `
     -NamePrefix "atmosprod"
   ```

3. Copy the values printed by the script into GitHub repository variables/secrets or GitLab CI/CD variables.

## GitHub variables

Set these in `Settings > Secrets and variables > Actions > Variables`:

- `AZURE_RESOURCE_GROUP`
- `AZURE_ACR_NAME`
- `AZURE_CONTAINER_ENV_NAME`
- `AZURE_CONTAINER_APP_NAME`
- `CORS_ORIGINS`

`CORS_ORIGINS` should be the Static Web App origin, for example:

```text
https://atmosprod-web.azurestaticapps.net
```

## GitHub secrets

Set these in `Settings > Secrets and variables > Actions > Secrets`:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `ACR_LOGIN_SERVER`
- `ACR_USERNAME`
- `ACR_PASSWORD`
- `AZURE_STATIC_WEB_APPS_API_TOKEN`
- `DATABASE_URL`
- `JWT_SECRET_KEY`

`DATABASE_URL` must include SSL:

```text
postgresql+psycopg://<user>:<password>@<server>.postgres.database.azure.com:5432/atmos?sslmode=require
```

## GitLab CI/CD variables

Set these in `Settings > CI/CD > Variables`.

Non-secret variables:

- `AZURE_RESOURCE_GROUP`
- `AZURE_ACR_NAME`
- `AZURE_CONTAINER_ENV_NAME`
- `AZURE_CONTAINER_APP_NAME`
- `CORS_ORIGINS`
- `AZURE_STATIC_WEB_APP_URL`

Secret variables, masked where GitLab allows it:

- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `ACR_USERNAME`
- `ACR_PASSWORD`
- `AZURE_STATIC_WEB_APPS_API_TOKEN`
- `DATABASE_URL`
- `JWT_SECRET_KEY`

Deployment variables can be protected if `main` is protected in GitLab. `feat/...` branches do not need access to Azure deployment secrets because they do not run deployment jobs.

GitHub Actions can use federated credentials without `AZURE_CLIENT_SECRET`; the GitLab pipeline included here uses `AZURE_CLIENT_SECRET` unless you configure GitLab OIDC separately.

## Deploy

For production, merge the working branch into `main`. The GitHub workflow and the GitLab deployment jobs are configured for `main`.

You can also run the GitHub workflow manually, selecting `main`:

```text
Actions > Deploy Azure Main > Run workflow
```

When `main` is deployed, the frontend build uses the backend URL returned by the backend deploy job, so it points to the deployed API instead of `localhost`.

## Stop all spend

Delete the resource group when the deployment is no longer needed:

```powershell
.\infra\azure\delete-environment.ps1 -ResourceGroup "rg-atmos-prod"
```

This removes the database, container app, registry, static site, logs, and related resources.

## Notes

- `PRE` is intentionally not exposed in the public dashboard.
- The backend initializes the schema at startup with `AUTO_INIT_DB_ON_STARTUP=true`, including `CREATE EXTENSION IF NOT EXISTS postgis`.
- PostgreSQL Flexible Server must allow the `POSTGIS` extension. The provisioning script sets `azure.extensions=POSTGIS`.
