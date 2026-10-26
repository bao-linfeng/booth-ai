[CmdletBinding()]
param(
    [string]$Version = (Get-Date -Format 'yyyyMMdd-HHmmss'),
    [ValidateSet('linux/amd64', 'linux/arm64')]
    [string]$Platform = 'linux/amd64'
)

$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$') { throw 'Invalid image version.' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot '.env'
$contextPath = Join-Path $repoRoot 'apps/server'
$releasePath = Join-Path $repoRoot 'release'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw 'Missing root .env with local SMTP configuration.' }
if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) { throw 'Repository directory does not exist.' }
if (-not (Test-Path -LiteralPath $releasePath -PathType Container)) {
    New-Item -ItemType Directory -Path $releasePath | Out-Null
}
$image = "booth-ai-server:$Version"
$archive = Join-Path $releasePath "booth-server-$Version.tar"
& docker buildx build --platform $Platform --target runtime --secret "id=smtp_env,src=$envPath" --no-cache-filter packaged -t $image --load $contextPath
if ($LASTEXITCODE -ne 0) { throw 'Server image build failed.' }
& docker save -o $archive $image
if ($LASTEXITCODE -ne 0) { throw 'Server image export failed.' }
Write-Host "Image: $image"
Write-Host "Archive: $archive"
Write-Host 'The image and archive contain SMTP credentials. Keep them private.'
