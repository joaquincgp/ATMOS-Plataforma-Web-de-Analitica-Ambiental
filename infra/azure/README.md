# Azure deployment for `main`

This deployment path is optimized for a small public production demo with controlled Azure credit usage.

## Target Architecture

- Frontend: Azure Storage Static Website.
- Backend: Azure Container Apps consumption environment with `min-replicas 0` and `max-replicas 1`.
- Images: Azure Container Registry Basic.
- Database: Azure Database for PostgreSQL Flexible Server, burstable `Standard_B1ms`, 32 GB storage.
- Logs: Log Analytics workspace with 30-day retention.
- CI auth: User-Assigned Managed Identity with GitLab OIDC Workload Identity Federation (no passwords).

GitLab CI listens to `main`, merge requests, and every `feat/...` branch. Feature branches run validation, tests, build, and packaging. Azure deployment runs automatically only from `main`.

The GitHub workflow `.github/workflows/deploy-azure-main.yml` is kept aligned with the same Azure target, but the intended production path for this project is GitLab CI/CD.

## Region

Default region is **`brazilsouth`** (São Paulo). This region is required so the backend can reach the Municipio de Quito public APIs (`aireambiente.quito.gob.ec`, `datosambiente.quito.gob.ec`) which block requests from North American Azure regions.

## Cost Controls

- Container Apps scales the backend to zero when idle.
- The frontend is static content in Storage, so it does not require a running frontend container.
- PostgreSQL Flexible Server is the main always-on cost. Delete the resource group when the demo is no longer needed.
- `ETL_SYNC_DEFAULT_MAX_ARCHIVES=2` is set in production to avoid expensive ingestion bursts.
- Create an Azure budget alert before deploying. Suggested alerts: 50%, 80%, and 100% of the intended monthly spend.

## First-Time Setup

1. Login to Azure CLI:

   ```powershell
   az login
   az account set --subscription "<subscription-id>"
   ```

2. Run the provisioning script. It creates all resources and prints the GitLab CI variables:

   ```powershell
   .\infra\azure\provision-low-cost.ps1 `
     -SubscriptionId "<subscription-id>" `
     -ResourceGroup "rg-atmos-prod" `
     -Location "brazilsouth" `
     -NamePrefix "atmosprod" `
     -GitLabProjectPath "<gitlab-namespace>/<project-slug>"
   ```

   The script creates:
   - Azure Container Registry (ACR Basic)
   - PostgreSQL Flexible Server B1ms
   - Log Analytics workspace
   - Container Apps environment and Container App (seeded with a placeholder image)
   - Storage Static Website
   - User-Assigned Managed Identity with GitLab OIDC federated credential and Contributor role

   If `NamePrefix` collides with an existing global Azure resource name, rerun with a different prefix.

3. Copy the values printed by the script into GitLab CI/CD variables (see section below).

4. Push to `main`. GitLab CI builds the real backend image and deploys it automatically.

The script prints secrets only to your terminal. Do not commit them.

## GitLab CI/CD Variables

Set these in `Settings > CI/CD > Variables`. Authentication to Azure uses Workload Identity Federation — no passwords or Service Principal secrets are needed.

Non-secret variables:

- `AZURE_FRONTEND_URL` — full URL of the Storage Static Website (printed by the script)
- `AZURE_BACKEND_URL` — full URL of the Container App (printed by the script)
- `AZURE_CLIENT_ID` — Client ID of the User-Assigned Managed Identity (printed by the script)
- `AZURE_TENANT_ID` — Azure AD tenant ID (visible with `az account show --query tenantId`)
- `AZURE_SUBSCRIPTION_ID` — subscription ID (visible with `az account show --query id`)

Secret variables (mask in GitLab):

- `ACR_LOGIN_SERVER` — e.g. `atmosprodacr.azurecr.io`
- `ACR_USERNAME` — ACR admin username
- `ACR_PASSWORD` — ACR admin password
- `AZURE_FRONTEND_STORAGE_ACCOUNT` — storage account name
- `AZURE_STORAGE_ACCOUNT_KEY` — storage account key
- `DATABASE_URL` — full connection string with SSL
- `JWT_SECRET_KEY` — long random secret

`DATABASE_URL` must include SSL:

```text
postgresql+psycopg://<user>:<password>@<server>.postgres.database.azure.com:5432/atmos?sslmode=require
```

Protect deployment variables if `main` is protected in GitLab. Feature branches do not need Azure deployment secrets.

## GitLab Deploy Flow

On `main`, the pipeline:

1. Runs backend and frontend quality gates.
2. Builds and packages frontend and backend.
3. Builds a new Docker image and pushes it to ACR with tags `:$CI_COMMIT_SHA` and `:main`.
4. Authenticates to Azure via Workload Identity Federation (OIDC) and updates the Container App to run the `:$CI_COMMIT_SHA` image.
5. Rebuilds the frontend with `VITE_API_BASE_URL=$AZURE_BACKEND_URL`.
6. Uploads `apps/frontend/dist` to the Storage Static Website `$web` container.

After deployment, the app is available at `$AZURE_FRONTEND_URL`.

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
- The public dashboard syncs live air quality data from `aireambiente.quito.gob.ec` automatically on each request. The ETL historical pipeline downloads from `datosambiente.quito.gob.ec`. Both require outbound connectivity to Ecuadorian government servers, which is why `brazilsouth` is the required region.
