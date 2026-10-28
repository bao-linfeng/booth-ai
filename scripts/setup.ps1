[CmdletBinding()]
param(
    [switch]$SkipStart,
    # Shared infrastructure used by several projects (PostgreSQL + pgvector, Redis); defaults to D:\baolf\infra.
    [string]$InfraDir = $env:INFRA_DIR
)

$ErrorActionPreference = 'Stop'
if (-not $InfraDir) {
    $InfraDir = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'infra'
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
$composePath = Join-Path $repoRoot 'infra/compose.dev.yaml'
$infraEnvPath = Join-Path $InfraDir '.env'

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Get-EnvValue([string]$path, [string]$name) {
    $line = [System.IO.File]::ReadAllLines($path) | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
    if (-not $line) { return $null }
    return $line.Substring($name.Length + 1)
}

if (-not (Test-Path -LiteralPath $infraEnvPath)) {
    throw "Shared infrastructure not found: $infraEnvPath. Set it up first (see its README.md) or pass -InfraDir."
}
$infraRedisPassword = Get-EnvValue $infraEnvPath 'REDIS_PASSWORD'
if (-not $infraRedisPassword) { throw "REDIS_PASSWORD is missing in $infraEnvPath." }

if (-not (Test-Path -LiteralPath $envPath)) {
    $content = @(
        '# Local credentials. Do not commit this file.'
        '# POSTGRES_PASSWORD: the booth role in the shared PostgreSQL; REDIS_PASSWORD: the shared Redis (copied from the infra .env).'
        "POSTGRES_PASSWORD=$(New-RandomSecret)"
        "REDIS_PASSWORD=$infraRedisPassword"
        "S3_ACCESS_KEY=booth$(New-RandomSecret)"
        "S3_SECRET_KEY=$(New-RandomSecret)"
        "SESSION_SECRET=$(New-RandomSecret)"
        "AI_MODEL_ENCRYPTION_KEY=$(New-RandomSecret)"
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
    if ($existing -notmatch '(?m)^AI_MODEL_ENCRYPTION_KEY=') {
        [System.IO.File]::AppendAllText($envPath, "AI_MODEL_ENCRYPTION_KEY=$(New-RandomSecret)`n", [System.Text.UTF8Encoding]::new($false))
    }
    if ((Get-EnvValue $envPath 'REDIS_PASSWORD') -ne $infraRedisPassword) {
        Write-Warning 'REDIS_PASSWORD in .env differs from the shared Redis password in the infra .env; update it.'
    }
    Write-Host 'Using existing .env; credentials were not changed.'
}

if ($SkipStart) { return }

& docker compose --project-directory $InfraDir up -d --wait --wait-timeout 120
if ($LASTEXITCODE -ne 0) { throw 'Shared infrastructure startup failed. Check Docker Desktop and the infra logs.' }

# Create the booth role (CREATEDB for booth_test) and database only when missing; an existing password is kept.
$sql = @'
SELECT format('CREATE ROLE booth LOGIN CREATEDB PASSWORD %L', :'pw') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'booth')\gexec
SELECT 'CREATE DATABASE booth OWNER booth' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'booth')\gexec
REVOKE ALL ON DATABASE booth FROM PUBLIC;
'@
$sql | & docker exec -i infra-postgres psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 -v "pw=$(Get-EnvValue $envPath 'POSTGRES_PASSWORD')"
if ($LASTEXITCODE -ne 0) { throw 'Creating the booth role and database in the shared PostgreSQL failed.' }

& docker compose --env-file $envPath -f $composePath up -d --build --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose startup failed. Check Docker Desktop and service logs.' }
Write-Host 'API: http://localhost:3030/health/ready'
Write-Host 'Silo console: http://localhost:19001'
