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
    # 强制使用 Service Account：清空 OAuth Refresh Token，避免 invalid_grant
    $env:GOOGLE_REFRESH_TOKEN = ""

    # 简要记录所需的服务账号变量是否存在（不输出敏感值）
    $hasEmail = -not [string]::IsNullOrEmpty($env:GOOGLE_SERVICE_ACCOUNT_EMAIL)
    $hasKey = -not [string]::IsNullOrEmpty($env:GOOGLE_PRIVATE_KEY)
    "[INFO] Service Account email present: $hasEmail" | Out-File -FilePath $logFile -Encoding UTF8 -Append
    "[INFO] Service Account key present: $hasKey" | Out-File -FilePath $logFile -Encoding UTF8 -Append

    # 执行同步脚本，将标准输出与错误输出同时写入日志
    node sync-to-r2.js >> $logFile 2>&1
} catch {
    "[$(Get-Date -Format 'yyyyMMdd-HHmmss')] ERROR: $_" | Out-File -FilePath $logFile -Encoding UTF8 -Append
}

"[$(Get-Date -Format 'yyyyMMdd-HHmmss')] === Sync Finished ===" | Out-File -FilePath $logFile -Encoding UTF8 -Append
