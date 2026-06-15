param(
  [string]$SubscriptionId = "",
  [string]$ResourceGroup = "rg-atmos-prod",
  [string]$Location = "brazilsouth",
  [string]$NamePrefix = "atmosprod",
  [string]$PostgresAdmin = "atmosadmin",
  [string]$PostgresPassword = "",
  [string]$GitLabProjectPath = "gmarguello112.ma/atmos"
)

$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI is required. Install it from https://learn.microsoft.com/cli/azure/install-azure-cli"
}

function Test-AzCommand {
  param([Parameter(Mandatory = $true)][scriptblock]$Command)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $Command *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Invoke-AzChecked {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Command,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  & $Command
  if ($LASTEXITCODE -ne 0) { throw $FailureMessage }
}

if ($SubscriptionId) {
  az account set --subscription $SubscriptionId
}

az extension add --name containerapp --upgrade | Out-Null

$suffix = ($NamePrefix.ToLower() -replace "[^a-z0-9]", "")
if ($suffix.Length -gt 18) { $suffix = $suffix.Substring(0, 18) }

$acrName            = "${suffix}acr"
$postgresName       = "${suffix}-pg"
$postgresDb         = "atmos"
$workspaceName      = "${suffix}-logs"
$containerEnvName   = "${suffix}-env"
$containerAppName   = "${suffix}-api"
$storageAccountName = "${suffix}web"
$uamiName           = "${suffix}-ci-identity"

# --- Postgres password ---
if (-not $PostgresPassword) {
  $randomPart = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  $PostgresPassword = "Atm0s!$randomPart"
}
Write-Host ""
Write-Host "PostgreSQL password (save this now): $PostgresPassword"
Write-Host ""

# --- Resource group ---
Write-Host "Creating resource group $ResourceGroup in $Location..."
if (Test-AzCommand { az group show --name $ResourceGroup }) {
  $resourceGroupLocation = az group show --name $ResourceGroup --query location -o tsv
  Write-Host "Resource group $ResourceGroup already exists in $resourceGroupLocation."
} else {
  Invoke-AzChecked { az group create --name $ResourceGroup --location $Location | Out-Null } `
    "Could not create resource group $ResourceGroup."
}

# --- ACR ---
Write-Host "Creating Basic Azure Container Registry $acrName..."
if (Test-AzCommand { az acr show --resource-group $ResourceGroup --name $acrName }) {
  Write-Host "Azure Container Registry $acrName already exists."
} else {
  Invoke-AzChecked { az acr create `
    --resource-group $ResourceGroup `
    --name $acrName `
    --sku Basic `
    --admin-enabled true | Out-Null
  } "Could not create Azure Container Registry $acrName."
}

# --- PostgreSQL ---
# Tries brazilsouth first, then falls back to other regions allowed by the subscription.
Write-Host "Creating PostgreSQL Flexible Server $postgresName on burstable B1ms..."
$postgresRegionCandidates = @($Location, "southcentralus", "canadacentral", "chilecentral", "eastus") | Select-Object -Unique
$postgresActualLocation = $null

if (Test-AzCommand { az postgres flexible-server show --resource-group $ResourceGroup --name $postgresName }) {
  Write-Host "PostgreSQL Flexible Server $postgresName already exists."
  $postgresActualLocation = $Location
} else {
  foreach ($pgRegion in $postgresRegionCandidates) {
    Write-Host "  Trying region $pgRegion..."
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    az postgres flexible-server create `
      --resource-group $ResourceGroup `
      --name $postgresName `
      --location $pgRegion `
      --admin-user $PostgresAdmin `
      --admin-password $PostgresPassword `
      --version 16 `
      --tier Burstable `
      --sku-name Standard_B1ms `
      --storage-size 32 `
      --public-access 0.0.0.0 `
      --yes
    $pgExitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap

    if ($pgExitCode -eq 0) {
      $postgresActualLocation = $pgRegion
      Write-Host "  PostgreSQL Flexible Server created in $pgRegion."
      break
    }
    Write-Host "  Region $pgRegion is restricted for this subscription, trying next..."
  }

  if (-not $postgresActualLocation) {
    throw "Could not create PostgreSQL Flexible Server in any of the tried regions ($($postgresRegionCandidates -join ', ')). Verify your subscription has available quota."
  }
}

if (Test-AzCommand { az postgres flexible-server db show --resource-group $ResourceGroup --server-name $postgresName --name $postgresDb }) {
  Write-Host "PostgreSQL database $postgresDb already exists."
} else {
  Invoke-AzChecked { az postgres flexible-server db create `
    --resource-group $ResourceGroup `
    --server-name $postgresName `
    --name $postgresDb | Out-Null
  } "Could not create PostgreSQL database $postgresDb."
}

Write-Host "Allowing PostGIS extension on PostgreSQL Flexible Server..."
Invoke-AzChecked { az postgres flexible-server parameter set `
  --resource-group $ResourceGroup `
  --server-name $postgresName `
  --name azure.extensions `
  --value POSTGIS | Out-Null
} "Could not enable PostGIS on PostgreSQL Flexible Server $postgresName."

# --- Log Analytics ---
Write-Host "Creating Log Analytics workspace $workspaceName with 30-day retention..."
if (Test-AzCommand { az monitor log-analytics workspace show --resource-group $ResourceGroup --workspace-name $workspaceName }) {
  Write-Host "Log Analytics workspace $workspaceName already exists."
} else {
  Invoke-AzChecked { az monitor log-analytics workspace create `
    --resource-group $ResourceGroup `
    --workspace-name $workspaceName `
    --location $Location `
    --retention-time 30 | Out-Null
  } "Could not create Log Analytics workspace $workspaceName."
}

# --- Container Apps environment ---
Write-Host "Creating Container Apps environment $containerEnvName..."
if (Test-AzCommand { az containerapp env show --resource-group $ResourceGroup --name $containerEnvName }) {
  Write-Host "Container Apps environment $containerEnvName already exists."
} else {
  $logsWorkspaceId  = az monitor log-analytics workspace show --resource-group $ResourceGroup --workspace-name $workspaceName --query customerId -o tsv
  $logsWorkspaceKey = az monitor log-analytics workspace get-shared-keys --resource-group $ResourceGroup --workspace-name $workspaceName --query primarySharedKey -o tsv
  Invoke-AzChecked { az containerapp env create `
    --resource-group $ResourceGroup `
    --name $containerEnvName `
    --location $Location `
    --logs-workspace-id $logsWorkspaceId `
    --logs-workspace-key $logsWorkspaceKey | Out-Null
  } "Could not create Container Apps environment $containerEnvName."
}

# --- Storage Static Website ---
Write-Host "Creating Storage Static Website $storageAccountName..."
if ($SubscriptionId) { az account set --subscription $SubscriptionId | Out-Null }
if (Test-AzCommand { az storage account show --resource-group $ResourceGroup --name $storageAccountName }) {
  Write-Host "Storage account $storageAccountName already exists."
} else {
  Invoke-AzChecked { az storage account create `
    --resource-group $ResourceGroup `
    --name $storageAccountName `
    --location $Location `
    --sku Standard_LRS `
    --kind StorageV2 `
    --allow-blob-public-access true `
    --min-tls-version TLS1_2 | Out-Null
  } "Could not create Storage account $storageAccountName."
}

az storage blob service-properties update `
  --account-name $storageAccountName `
  --static-website `
  --index-document index.html `
  --404-document index.html | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not enable static website hosting on Storage account $storageAccountName." }

# --- Gather credentials ---
$acrLoginServer  = az acr show --resource-group $ResourceGroup --name $acrName --query loginServer -o tsv
$acrUsername     = az acr credential show --resource-group $ResourceGroup --name $acrName --query username -o tsv
$acrPassword     = az acr credential show --resource-group $ResourceGroup --name $acrName --query "passwords[0].value" -o tsv
$storageKey      = az storage account keys list --resource-group $ResourceGroup --account-name $storageAccountName --query "[0].value" -o tsv
$staticWebsiteUrl = (az storage account show --resource-group $ResourceGroup --name $storageAccountName --query "primaryEndpoints.web" -o tsv).TrimEnd("/")
$databaseUrl     = "postgresql+psycopg://${PostgresAdmin}:${PostgresPassword}@${postgresName}.postgres.database.azure.com:5432/${postgresDb}?sslmode=require"

# --- JWT secret ---
$jwtSecret = ""
if (Get-Command python -ErrorAction SilentlyContinue) {
  $jwtSecret = python -c "import secrets; print(secrets.token_hex(32))" 2>$null
}
if (-not $jwtSecret) {
  $chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  $jwtSecret = -join ((1..64) | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}

# --- User-Assigned Managed Identity for GitLab CI OIDC ---
Write-Host "Creating User-Assigned Managed Identity $uamiName..."
if (Test-AzCommand { az identity show --resource-group $ResourceGroup --name $uamiName }) {
  Write-Host "Managed Identity $uamiName already exists."
} else {
  Invoke-AzChecked { az identity create `
    --resource-group $ResourceGroup `
    --name $uamiName `
    --location $Location | Out-Null
  } "Could not create Managed Identity $uamiName."
  Write-Host "Waiting for identity to propagate in Azure AD..."
  Start-Sleep 20
}

$uamiClientId    = az identity show --resource-group $ResourceGroup --name $uamiName --query clientId -o tsv
$uamiPrincipalId = az identity show --resource-group $ResourceGroup --name $uamiName --query principalId -o tsv
$rgScope         = az group show --name $ResourceGroup --query id -o tsv
$tenantId        = az account show --query tenantId -o tsv
$subscriptionId  = az account show --query id -o tsv

Write-Host "Assigning Contributor role to $uamiName on $ResourceGroup..."
$existingRole = az role assignment list --assignee $uamiPrincipalId --role Contributor --scope $rgScope --query "[0].id" -o tsv 2>$null
if (-not $existingRole) {
  Invoke-AzChecked { az role assignment create `
    --assignee $uamiPrincipalId `
    --role Contributor `
    --scope $rgScope | Out-Null
  } "Could not assign Contributor role to $uamiName."
} else {
  Write-Host "Contributor role already assigned."
}

Write-Host "Creating federated credential for GitLab CI (main branch)..."
if (Test-AzCommand { az identity federated-credential show --identity-name $uamiName --resource-group $ResourceGroup --name "gitlab-main-branch" }) {
  Write-Host "Federated credential already exists."
} else {
  Invoke-AzChecked { az identity federated-credential create `
    --identity-name $uamiName `
    --resource-group $ResourceGroup `
    --name "gitlab-main-branch" `
    --issuer "https://gitlab.com" `
    --subject "project_path:${GitLabProjectPath}:ref_type:branch:ref:main" `
    --audience "api://AzureADTokenExchange" | Out-Null
  } "Could not create federated credential for $uamiName."
}

# --- Container App ---
Write-Host "Creating Container App $containerAppName..."
if (Test-AzCommand { az containerapp show --resource-group $ResourceGroup --name $containerAppName }) {
  Write-Host "Container App $containerAppName already exists."
} else {
  Invoke-AzChecked { az containerapp create `
    --resource-group $ResourceGroup `
    --name $containerAppName `
    --environment $containerEnvName `
    --image "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" `
    --target-port 8000 `
    --ingress external `
    --min-replicas 0 `
    --max-replicas 1 `
    --cpu 0.5 `
    --memory 1Gi `
    --registry-server $acrLoginServer `
    --registry-username $acrUsername `
    --registry-password $acrPassword `
    --secrets "database-url=$databaseUrl" "jwt-secret-key=$jwtSecret" `
    --env-vars `
      ENVIRONMENT=production `
      "API_V1_PREFIX=/api/v1" `
      AUTO_INIT_DB_ON_STARTUP=true `
      ETL_SYNC_DEFAULT_MAX_ARCHIVES=2 `
      "DATABASE_URL=secretref:database-url" `
      "JWT_SECRET_KEY=secretref:jwt-secret-key" `
      "CORS_ORIGINS=$staticWebsiteUrl" | Out-Null
  } "Could not create Container App $containerAppName."
}

$containerAppFqdn = az containerapp show --resource-group $ResourceGroup --name $containerAppName --query "properties.configuration.ingress.fqdn" -o tsv
$containerAppUrl  = "https://$containerAppFqdn"

# --- Summary ---
if ($postgresActualLocation -and $postgresActualLocation -ne $Location) {
  Write-Host ""
  Write-Host "NOTE: PostgreSQL was created in $postgresActualLocation (primary region $Location was restricted)."
}

Write-Host ""
Write-Host "=============================="
Write-Host " Azure resources are ready."
Write-Host "=============================="
Write-Host ""
Write-Host "The Container App was seeded with a placeholder image."
Write-Host "Push to main to deploy the real backend image via GitLab CI."
Write-Host ""
Write-Host "GitLab CI/CD variables (Settings > CI/CD > Variables):"
Write-Host ""
Write-Host "  Non-secret:"
Write-Host "    AZURE_FRONTEND_URL=$staticWebsiteUrl"
Write-Host "    AZURE_BACKEND_URL=$containerAppUrl"
Write-Host "    AZURE_CLIENT_ID=$uamiClientId"
Write-Host "    AZURE_TENANT_ID=$tenantId"
Write-Host "    AZURE_SUBSCRIPTION_ID=$subscriptionId"
Write-Host ""
Write-Host "  Secret (mask in GitLab):"
Write-Host "    ACR_LOGIN_SERVER=$acrLoginServer"
Write-Host "    ACR_USERNAME=$acrUsername"
Write-Host "    ACR_PASSWORD=$acrPassword"
Write-Host "    AZURE_FRONTEND_STORAGE_ACCOUNT=$storageAccountName"
Write-Host "    AZURE_STORAGE_ACCOUNT_KEY=$storageKey"
Write-Host "    DATABASE_URL=$databaseUrl"
Write-Host "    JWT_SECRET_KEY=$jwtSecret"
Write-Host ""
Write-Host "Secrets printed above are for CI/CD setup only. Do not commit them."
Write-Host "Cost note: PostgreSQL is the main always-on cost (~18 USD/month)."
Write-Host "Delete the resource group when the demo is no longer needed."
