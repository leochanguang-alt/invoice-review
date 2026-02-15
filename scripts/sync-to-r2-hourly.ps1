Param()

$ErrorActionPreference = "Stop"
Set-Location "D:\Git\invoice-review"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path (Get-Location) "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}
$logFile = Join-Path $logDir ("sync-" + (Get-Date -Format "yyyyMMdd-HH") + ".log")

"[$timestamp] === Sync Started ===" | Out-File -FilePath $logFile -Encoding UTF8 -Append

try {
    # Force using Service Account: clear OAuth Refresh Token to avoid invalid_grant
    $env:GOOGLE_REFRESH_TOKEN = ""

    # Briefly log whether required service account variables exist (do not output sensitive values)
    $hasEmail = -not [string]::IsNullOrEmpty($env:GOOGLE_SERVICE_ACCOUNT_EMAIL)
    $hasKey = -not [string]::IsNullOrEmpty($env:GOOGLE_PRIVATE_KEY)
    "[INFO] Service Account email present: $hasEmail" | Out-File -FilePath $logFile -Encoding UTF8 -Append
    "[INFO] Service Account key present: $hasKey" | Out-File -FilePath $logFile -Encoding UTF8 -Append

    # Execute sync script, redirect both stdout and stderr to log
    node sync-to-r2.js >> $logFile 2>&1
} catch {
    "[$(Get-Date -Format 'yyyyMMdd-HHmmss')] ERROR: $_" | Out-File -FilePath $logFile -Encoding UTF8 -Append
}

"[$(Get-Date -Format 'yyyyMMdd-HHmmss')] === Sync Finished ===" | Out-File -FilePath $logFile -Encoding UTF8 -Append
