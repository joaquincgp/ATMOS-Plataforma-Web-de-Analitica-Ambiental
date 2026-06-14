param(
  [string]$SubscriptionId = "",
  [string]$ResourceGroup = "rg-atmos-prod",
  [string]$Location = "southcentralus",
  [string]$NamePrefix = "atmosprod",
  [string]$PostgresAdmin = "atmosadmin",
  [string]$PostgresPassword = ""
)

$ErrorActionPreference = "Stop"
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI is required. Install it from https://learn.microsoft.com/cli/azure/install-azure-cli"
}

function Test-AzCommand {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

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
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

if ($SubscriptionId) {
  az account set --subscription $SubscriptionId
}

az extension add --name containerapp --upgrade | Out-Null

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
$storageAccountName = "${suffix}web"

# Generate password early so it is known before any resource is created.
if (-not $PostgresPassword) {
  $randomPart = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  $PostgresPassword = "Atm0s!$randomPart"
}
Write-Host ""
Write-Host "PostgreSQL password (save this now): $PostgresPassword"
Write-Host ""

Write-Host "Creating resource group $ResourceGroup in $Location..."
if (Test-AzCommand { az group show --name $ResourceGroup }) {
  $resourceGroupLocation = az group show --name $ResourceGroup --query location -o tsv
  Write-Host "Resource group $ResourceGroup already exists in $resourceGroupLocation."
} else {
  Invoke-AzChecked { az group create --name $ResourceGroup --location $Location | Out-Null } "Could not create resource group $ResourceGroup."
}

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

# PostgreSQL Flexible Server is restricted in some regions for Azure for Students.
# The script tries the requested location first, then falls back automatically.
Write-Host "Creating PostgreSQL Flexible Server $postgresName on burstable B1ms..."

  # Only regions allowed by the Azure for Students policy on this subscription.
$postgresRegionCandidates = @($Location, "southcentralus", "brazilsouth", "canadacentral", "chilecentral", "eastus") | Select-Object -Unique
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

Write-Host "Creating Container Apps environment $containerEnvName..."
if (Test-AzCommand { az containerapp env show --resource-group $ResourceGroup --name $containerEnvName }) {
  Write-Host "Container Apps environment $containerEnvName already exists."
} else {
  Invoke-AzChecked { az containerapp env create `
    --resource-group $ResourceGroup `
    --name $containerEnvName `
    --location $Location `
    --logs-workspace-id $(az monitor log-analytics workspace show --resource-group $ResourceGroup --workspace-name $workspaceName --query customerId -o tsv) `
    --logs-workspace-key $(az monitor log-analytics workspace get-shared-keys --resource-group $ResourceGroup --workspace-name $workspaceName --query primarySharedKey -o tsv) | Out-Null
  } "Could not create Container Apps environment $containerEnvName."
}

Write-Host "Creating Storage Static Website $storageAccountName..."
az account set --subscription $SubscriptionId | Out-Null
if (Test-AzCommand { az storage account show --subscription $SubscriptionId --resource-group $ResourceGroup --name $storageAccountName }) {
  Write-Host "Storage account $storageAccountName already exists."
} else {
  az storage account create `
    --subscription $SubscriptionId `
    --resource-group $ResourceGroup `
    --name $storageAccountName `
    --location $Location `
    --sku Standard_LRS `
    --kind StorageV2 `
    --allow-blob-public-access true `
    --min-tls-version TLS1_2 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not create Storage account $storageAccountName." }
}

az storage blob service-properties update `
  --subscription $SubscriptionId `
  --account-name $storageAccountName `
  --static-website `
  --index-document index.html `
  --404-document index.html | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not enable static website hosting on Storage account $storageAccountName." }

$acrLoginServer = az acr show --resource-group $ResourceGroup --name $acrName --query loginServer -o tsv
$acrUsername = az acr credential show --resource-group $ResourceGroup --name $acrName --query username -o tsv
$acrPassword = az acr credential show --resource-group $ResourceGroup --name $acrName --query "passwords[0].value" -o tsv
$storageKey = az storage account keys list --subscription $SubscriptionId --resource-group $ResourceGroup --account-name $storageAccountName --query "[0].value" -o tsv
$staticWebsiteUrl = (az storage account show --subscription $SubscriptionId --resource-group $ResourceGroup --name $storageAccountName --query "primaryEndpoints.web" -o tsv).TrimEnd("/")
$databaseUrl = "postgresql+psycopg://${PostgresAdmin}:${PostgresPassword}@${postgresName}.postgres.database.azure.com:5432/${postgresDb}?sslmode=require"

if ($postgresActualLocation -ne $Location) {
  Write-Host ""
  Write-Host "NOTE: PostgreSQL was created in $postgresActualLocation (primary region $Location was restricted)."
}

Write-Host ""
Write-Host "Azure resources are ready."
Write-Host ""
Write-Host "Next step: create the Container App once locally (see infra/azure/README.md)."
Write-Host "Then enable ACR continuous deployment from the Portal to auto-update on push."
Write-Host ""
Write-Host "GitLab CI/CD variables (Settings > CI/CD > Variables):"
Write-Host ""
Write-Host "  Non-secret:"
Write-Host "    AZURE_FRONTEND_URL=$staticWebsiteUrl"
Write-Host "    AZURE_BACKEND_URL=<set after Container App is created>"
Write-Host ""
Write-Host "  Secret (mask in GitLab):"
Write-Host "    ACR_LOGIN_SERVER=$acrLoginServer"
Write-Host "    ACR_USERNAME=$acrUsername"
Write-Host "    ACR_PASSWORD=$acrPassword"
Write-Host "    AZURE_FRONTEND_STORAGE_ACCOUNT=$storageAccountName"
Write-Host "    AZURE_STORAGE_ACCOUNT_KEY=$storageKey"
Write-Host "    DATABASE_URL=$databaseUrl"
Write-Host "    JWT_SECRET_KEY=<generate: python -c `"import secrets; print(secrets.token_hex(32))`">"
Write-Host ""
Write-Host "Cost note: PostgreSQL is the main always-on cost (~18 USD/month)."
Write-Host "Delete the resource group when the demo is no longer needed."
Write-Host "Secrets above are printed once for CI/CD setup. Do not commit them."
