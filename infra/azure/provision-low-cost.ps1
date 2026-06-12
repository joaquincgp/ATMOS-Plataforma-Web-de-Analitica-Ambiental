param(
  [string]$SubscriptionId = "",
  [string]$ResourceGroup = "rg-atmos-prod",
  [string]$Location = "eastus2",
  [string]$NamePrefix = "atmosprod",
  [string]$PostgresAdmin = "atmosadmin"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI is required. Install it from https://learn.microsoft.com/cli/azure/install-azure-cli"
}

if ($SubscriptionId) {
  az account set --subscription $SubscriptionId
}

az extension add --name containerapp --upgrade | Out-Null
az extension add --name staticwebapp --upgrade | Out-Null

$suffix = ($NamePrefix.ToLower() -replace "[^a-z0-9]", "")
if ($suffix.Length -gt 18) {
  $suffix = $suffix.Substring(0, 18)
}

$acrName = "${suffix}acr"
$postgresName = "${suffix}-pg"
$postgresDb = "atmos"
$workspaceName = "${suffix}-logs"
$containerEnvName = "${suffix}-env"
$containerAppName = "${suffix}-api"
$staticAppName = "${suffix}-web"

Write-Host "Creating resource group $ResourceGroup in $Location..."
az group create --name $ResourceGroup --location $Location | Out-Null

Write-Host "Creating Basic Azure Container Registry $acrName..."
az acr create `
  --resource-group $ResourceGroup `
  --name $acrName `
  --sku Basic `
  --admin-enabled true | Out-Null

Write-Host "Creating PostgreSQL Flexible Server $postgresName on burstable B1ms..."
$postgresPasswordSecure = Read-Host "PostgreSQL admin password" -AsSecureString
$postgresPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($postgresPasswordSecure)
)

az postgres flexible-server create `
  --resource-group $ResourceGroup `
  --name $postgresName `
  --location $Location `
  --admin-user $PostgresAdmin `
  --admin-password $postgresPassword `
  --database-name $postgresDb `
  --version 16 `
  --tier Burstable `
  --sku-name Standard_B1ms `
  --storage-size 32 `
  --public-access 0.0.0.0 `
  --yes | Out-Null

Write-Host "Allowing PostGIS extension on PostgreSQL Flexible Server..."
az postgres flexible-server parameter set `
  --resource-group $ResourceGroup `
  --server-name $postgresName `
  --name azure.extensions `
  --value POSTGIS | Out-Null

Write-Host "Creating Log Analytics workspace $workspaceName with 30-day retention..."
az monitor log-analytics workspace create `
  --resource-group $ResourceGroup `
  --workspace-name $workspaceName `
  --location $Location `
  --retention-time 30 | Out-Null

Write-Host "Creating Container Apps environment $containerEnvName..."
az containerapp env create `
  --resource-group $ResourceGroup `
  --name $containerEnvName `
  --location $Location `
  --logs-workspace-id $(az monitor log-analytics workspace show --resource-group $ResourceGroup --workspace-name $workspaceName --query customerId -o tsv) `
  --logs-workspace-key $(az monitor log-analytics workspace get-shared-keys --resource-group $ResourceGroup --workspace-name $workspaceName --query primarySharedKey -o tsv) | Out-Null

Write-Host "Creating Free Static Web App $staticAppName..."
az staticwebapp create `
  --resource-group $ResourceGroup `
  --name $staticAppName `
  --location $Location `
  --sku Free | Out-Null

$acrLoginServer = az acr show --resource-group $ResourceGroup --name $acrName --query loginServer -o tsv
$acrUsername = az acr credential show --resource-group $ResourceGroup --name $acrName --query username -o tsv
$acrPassword = az acr credential show --resource-group $ResourceGroup --name $acrName --query "passwords[0].value" -o tsv
$staticToken = az staticwebapp secrets list --resource-group $ResourceGroup --name $staticAppName --query properties.apiKey -o tsv
$databaseUrl = "postgresql+psycopg://${PostgresAdmin}:${postgresPassword}@${postgresName}.postgres.database.azure.com:5432/${postgresDb}?sslmode=require"

Write-Host ""
Write-Host "Azure resources are ready."
Write-Host ""
Write-Host "GitHub Actions variables:"
Write-Host "AZURE_RESOURCE_GROUP=$ResourceGroup"
Write-Host "AZURE_ACR_NAME=$acrName"
Write-Host "AZURE_CONTAINER_ENV_NAME=$containerEnvName"
Write-Host "AZURE_CONTAINER_APP_NAME=$containerAppName"
Write-Host "CORS_ORIGINS=https://$staticAppName.azurestaticapps.net"
Write-Host "AZURE_STATIC_WEB_APP_URL=https://$staticAppName.azurestaticapps.net"
Write-Host ""
Write-Host "GitHub Actions / GitLab CI secrets:"
Write-Host "ACR_LOGIN_SERVER=$acrLoginServer"
Write-Host "ACR_USERNAME=$acrUsername"
Write-Host "ACR_PASSWORD=$acrPassword"
Write-Host "AZURE_STATIC_WEB_APPS_API_TOKEN=$staticToken"
Write-Host "DATABASE_URL=$databaseUrl"
Write-Host "JWT_SECRET_KEY=<generate-a-long-random-secret>"
Write-Host "AZURE_CLIENT_ID=<service-principal-or-federated-credential-client-id>"
Write-Host "AZURE_CLIENT_SECRET=<service-principal-client-secret-for-gitlab>"
Write-Host "AZURE_TENANT_ID=<tenant-id>"
Write-Host "AZURE_SUBSCRIPTION_ID=<subscription-id>"
Write-Host ""
Write-Host "Cost control: PostgreSQL is the main always-on cost. Delete the resource group when the demo is no longer needed."
