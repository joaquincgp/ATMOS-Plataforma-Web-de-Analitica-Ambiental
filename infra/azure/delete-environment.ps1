param(
  [string]$ResourceGroup = "rg-atmos-prod"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI is required. Install it from https://learn.microsoft.com/cli/azure/install-azure-cli"
}

Write-Host "This deletes the full Azure resource group: $ResourceGroup"
Write-Host "That stops PostgreSQL, Container Apps, Static Web Apps, ACR, logs, and their costs."
$confirmation = Read-Host "Type DELETE to continue"
if ($confirmation -ne "DELETE") {
  Write-Host "Cancelled."
  exit 0
}

az group delete --name $ResourceGroup --yes --no-wait
Write-Host "Deletion started for resource group $ResourceGroup."
