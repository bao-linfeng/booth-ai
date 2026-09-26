[CmdletBinding()]
param([switch]$SkipStart)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
$composePath = Join-Path $repoRoot 'infra/compose.dev.yaml'

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $envPath)) {
    $content = @(
        '# Local credentials. Do not commit this file.'
        "POSTGRES_PASSWORD=$(New-RandomSecret)"
        "REDIS_PASSWORD=$(New-RandomSecret)"
        "S3_ACCESS_KEY=booth$(New-RandomSecret)"
        "S3_SECRET_KEY=$(New-RandomSecret)"
        "SESSION_SECRET=$(New-RandomSecret)"
        'EXTERNAL_API_URL=https://api.lingtong.net.cn'
    ) -join "`n"
    [System.IO.File]::WriteAllText($envPath, $content + "`n", [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Created .env with random local credentials.'
} else {
    $existing = [System.IO.File]::ReadAllText($envPath)
    if ($existing -notmatch '(?m)^SESSION_SECRET=') {
        [System.IO.File]::AppendAllText($envPath, "SESSION_SECRET=$(New-RandomSecret)`n", [System.Text.UTF8Encoding]::new($false))
    }
    if ($existing -notmatch '(?m)^EXTERNAL_API_URL=') {
        [System.IO.File]::AppendAllText($envPath, "EXTERNAL_API_URL=https://api.lingtong.net.cn`n", [System.Text.UTF8Encoding]::new($false))
    }
    Write-Host 'Using existing .env; credentials were not changed.'
}

if ($SkipStart) { return }
& docker compose --env-file $envPath -f $composePath up -d --build --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose startup failed. Check Docker Desktop and service logs.' }
Write-Host 'API: http://localhost:3000/health/ready'
Write-Host 'Silo console: http://localhost:19001'
