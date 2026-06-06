param(
  [switch]$SkipBackendTests,
  [switch]$SkipFrontendTests
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ReportRoot = Join-Path $RepoRoot "reports\quality"
$BackendReportRoot = Join-Path $ReportRoot "backend"
$FrontendReportRoot = Join-Path $ReportRoot "frontend"

if (Test-Path $ReportRoot) {
  Remove-Item -LiteralPath $ReportRoot -Recurse -Force
}

New-Item -ItemType Directory -Force $BackendReportRoot | Out-Null
New-Item -ItemType Directory -Force $FrontendReportRoot | Out-Null

Push-Location $RepoRoot
try {
  Write-Host "Generating Ruff report..."
  ruff check apps\backend\app apps\backend\tests --output-format json --output-file "$BackendReportRoot\ruff.json"
  python infra\quality\ruff_html_report.py "$BackendReportRoot\ruff.json" "$BackendReportRoot\ruff.html" --project-name "ATMOS backend"

  Write-Host "Generating Pylint report..."
  Push-Location apps\backend
  try {
    python -m pylint app tests --output-format="json:$BackendReportRoot\pylint.json" --reports=y --score=y --exit-zero
  }
  finally {
    Pop-Location
  }
  python infra\quality\pylint_html_report.py "$BackendReportRoot\pylint.json" "$BackendReportRoot\pylint.html" --project-name "ATMOS backend"

  if (-not $SkipBackendTests) {
    Write-Host "Generating backend Pytest coverage report..."
    Push-Location apps\backend
    try {
      pytest tests -q `
        --cov=app `
        --cov-report=term-missing `
        --cov-report=html:"$BackendReportRoot\coverage-html" `
        --cov-report=xml:"$BackendReportRoot\coverage.xml" `
        --junitxml="$BackendReportRoot\junit.xml"
    }
    finally {
      Pop-Location
    }
  }

  Write-Host "Generating ESLint HTML report..."
  npm.cmd exec --workspace @atmos/frontend -- eslint "src/**/*.{ts,tsx}" --format html --output-file "$FrontendReportRoot\eslint.html"

  if (-not $SkipFrontendTests) {
    Write-Host "Generating frontend Vitest coverage report..."
    npm.cmd run coverage:frontend
    Copy-Item -LiteralPath (Join-Path $RepoRoot "reports\frontend-junit.xml") -Destination "$FrontendReportRoot\junit.xml" -Force
    Copy-Item -LiteralPath (Join-Path $RepoRoot "reports\frontend-coverage") -Destination "$FrontendReportRoot\coverage-html" -Recurse -Force
  }

  Write-Host ""
  Write-Host "Reports generated in: $ReportRoot"
  Write-Host "Backend Ruff:     $BackendReportRoot\ruff.html"
  Write-Host "Backend Pylint:   $BackendReportRoot\pylint.html"
  Write-Host "Backend Coverage: $BackendReportRoot\coverage-html\index.html"
  Write-Host "Frontend ESLint:  $FrontendReportRoot\eslint.html"
  Write-Host "Frontend Coverage:$FrontendReportRoot\coverage-html\index.html"
}
finally {
  Pop-Location
}
