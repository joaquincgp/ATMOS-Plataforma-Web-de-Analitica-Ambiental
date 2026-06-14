# Azure deployment for `main`

This deployment path is optimized for a small public production demo with controlled Azure credit usage.

## Target Architecture

- Frontend: Azure Storage Static Website.
- Backend: Azure Container Apps consumption environment with `min-replicas 0` and `max-replicas 1`.
- Images: Azure Container Registry Basic.
- Database: Azure Database for PostgreSQL Flexible Server, burstable `Standard_B1ms`, 32 GB storage.
- Logs: Log Analytics workspace with 30-day retention.

GitLab CI listens to `main`, merge requests, and every `feat/...` branch. Feature branches run validation, tests, build, and packaging. Azure deployment runs automatically only from `main`.

The GitHub workflow `.github/workflows/deploy-azure-main.yml` is kept aligned with the same Azure target, but the intended production path for this project is GitLab CI/CD.

## Cost Controls

- Container Apps scales the backend to zero when idle.
- The frontend is static content in Storage, so it does not require a running frontend container.
- PostgreSQL Flexible Server is the main always-on cost. Delete the resource group when the demo is no longer needed.
- `ETL_SYNC_DEFAULT_MAX_ARCHIVES=2` is set in production to avoid expensive ingestion bursts.
- Use a small region supported by the subscription. The default script location is `eastus`.
- Create an Azure budget alert before deploying. Suggested alerts: 50%, 80%, and 100% of the intended monthly spend.

## First-Time Setup

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
     -Location "eastus" `
     -NamePrefix "atmosprod"
   ```

   If `NamePrefix` collides with an existing global Azure resource name, rerun with a different prefix such as `atmosprod01`.

3. Copy the values printed by the script into GitLab CI/CD variables or GitHub repository variables/secrets.

The script prints secrets only to your terminal. Do not commit them.

## GitLab CI/CD Variables

Set these in `Settings > CI/CD > Variables`. No Azure Service Principal or interactive login is required. The pipeline authenticates to Azure using Workload Identity Federation (OIDC) via a User-Assigned Managed Identity.

Non-secret variables:

- `AZURE_FRONTEND_URL` — full URL of the Storage Static Website, e.g. `https://atmosprodweb.z21.web.core.windows.net`
- `AZURE_BACKEND_URL` — full URL of the Container App, e.g. `https://atmosprod-api.<hash>.southcentralus.azurecontainerapps.io`
- `AZURE_CLIENT_ID` — Client ID of the User-Assigned Managed Identity `atmos-ci-identity` (visible en el portal bajo la identidad o con `az identity show`)
- `AZURE_TENANT_ID` — Azure AD tenant ID (visible en `az account show --query tenantId`)
- `AZURE_SUBSCRIPTION_ID` — subscription ID, e.g. `5ea896c0-e847-4a38-b0a7-0b0ab8b4f972`

Secret variables (mask in GitLab):

- `ACR_LOGIN_SERVER` — e.g. `atmosprodacr.azurecr.io`
- `ACR_USERNAME` — ACR admin username
- `ACR_PASSWORD` — ACR admin password
- `AZURE_FRONTEND_STORAGE_ACCOUNT` — storage account name, e.g. `atmosprodweb`
- `AZURE_STORAGE_ACCOUNT_KEY` — storage account key
- `DATABASE_URL` — full connection string with SSL
- `JWT_SECRET_KEY` — long random secret

`DATABASE_URL` must include SSL:

```text
postgresql+psycopg://<user>:<password>@<server>.postgres.database.azure.com:5432/atmos?sslmode=require
```

Protect deployment variables if `main` is protected in GitLab. Feature branches do not need Azure deployment secrets because they do not run deployment jobs.

## First-Time Container App Setup

The Container App is created once locally (interactive login, no Service Principal required). After that, every push to `main` via GitLab CI pushes a new image to ACR, and the ACR continuous deployment webhook updates the Container App automatically.

```powershell
# Generate a JWT secret
$jwt = python -c "import secrets; print(secrets.token_hex(32))"

az containerapp create `
  --resource-group "rg-atmos-prod" `
  --name "atmosprod-api" `
  --environment "atmosprod-env" `
  --image "atmosprodacr.azurecr.io/atmos-backend:main" `
  --target-port 8000 `
  --ingress external `
  --min-replicas 0 `
  --max-replicas 1 `
  --cpu 0.5 `
  --memory 1Gi `
  --registry-server "atmosprodacr.azurecr.io" `
  --registry-username "atmosprodacr" `
  --registry-password "<ACR_PASSWORD>" `
  --secrets "database-url=<DATABASE_URL>" "jwt-secret-key=<JWT>" `
  --env-vars `
    ENVIRONMENT=production `
    API_V1_PREFIX=/api/v1 `
    AUTO_INIT_DB_ON_STARTUP=true `
    ETL_SYNC_DEFAULT_MAX_ARCHIVES=2 `
    "DATABASE_URL=secretref:database-url" `
    "JWT_SECRET_KEY=secretref:jwt-secret-key" `
    "CORS_ORIGINS=https://atmosprodweb.z21.web.core.windows.net"
```

Then enable continuous deployment from the Azure Portal:
`Container App → Continuous deployment → Connect ACR → select image → Save`

This creates an ACR webhook that updates the Container App on every new `:main` tag push.

## GitLab Deploy Flow

On `main`, the pipeline:

1. Runs backend and frontend quality gates.
2. Builds and packages frontend and backend.
3. Builds a new Docker image and pushes it to ACR with tags `:$CI_COMMIT_SHA` and `:main`.
4. Authenticates to Azure via Workload Identity Federation (OIDC) and updates the Container App to run the `:$CI_COMMIT_SHA` image.
5. Rebuilds the frontend with `VITE_API_BASE_URL=$AZURE_BACKEND_URL` (static variable, already known).
6. Uploads `apps/frontend/dist` to the Storage Static Website `$web` container.

After deployment, the app is available at `$AZURE_FRONTEND_URL`.

## GitHub Variables And Secrets

The GitHub Actions workflow (`.github/workflows/deploy-azure-main.yml`) is kept aligned as an alternative path but the intended production path is GitLab CI/CD.

## Stop Spend

Delete the resource group when the deployment is no longer needed:

```powershell
.\infra\azure\delete-environment.ps1 -ResourceGroup "rg-atmos-prod"
```

This removes PostgreSQL, Container Apps, ACR, Storage Static Website, logs, and related resources.

## Notes

- `PRE` is intentionally not exposed in the public dashboard.
- The backend initializes the schema at startup with `AUTO_INIT_DB_ON_STARTUP=true`, including `CREATE EXTENSION IF NOT EXISTS postgis`.
- PostgreSQL Flexible Server must allow the `POSTGIS` extension. The provisioning script sets `azure.extensions=POSTGIS`.
