# Housefi pilot server on this laptop (docs/DEPLOY-LAPTOP.md): one short command for each everyday task.
# Run it in PowerShell from the backend folder:
#
#   .\deploy\laptop.ps1 start            # build and start everything (also after a restart, if it is not running)
#   .\deploy\laptop.ps1 status           # what is running
#   .\deploy\laptop.ps1 logs [service]   # follow the logs (Ctrl+C to stop), e.g. logs api
#   .\deploy\laptop.ps1 stop             # stop everything (data is kept)
#   .\deploy\laptop.ps1 update           # get the newest code from GitHub and restart with it
#   .\deploy\laptop.ps1 seed             # load the service catalogue (once, after the first start)
#   .\deploy\laptop.ps1 tech pending     # technician review: pending | approve <phone> | suspend <phone> <reason> ...
#   .\deploy\laptop.ps1 backup           # encrypted database backup into your housefi-backups folder
param(
  [Parameter(Position = 0)] [string] $Action = 'status',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Rest = @()
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path .env.production)) { throw '.env.production is missing: create it first (docs/DEPLOY-LAPTOP.md, step 3).' }

function dc {
  docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.laptop.yml --env-file .env.production --profile local-db @args
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') failed (exit $LASTEXITCODE)" }
}

switch ($Action) {
  'start' { dc up -d --build; dc ps }
  'status' { dc ps -a }
  'logs' { dc logs --tail 200 -f @Rest }
  'stop' { dc stop }
  'update' {
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'git pull failed: nothing was restarted.' }
    dc up -d --build
    dc ps
  }
  'seed' { dc exec api node dist/cli/seed.js }
  'tech' { dc exec api node dist/cli/technicians.js @Rest }
  'backup' {
    # The dump is compressed and encrypted inside the database container (gpg, AES-256), then copied out.
    # Keep the passphrase in Bitwarden: without it the backup cannot be restored.
    $secure = Read-Host 'Backup passphrase (the one saved in Bitwarden)' -AsSecureString
    $pass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if ($pass.Length -lt 12) { throw 'Use a passphrase of at least 12 characters.' }
    $dir = Join-Path $HOME 'housefi-backups'
    New-Item -ItemType Directory -Force $dir | Out-Null
    $file = Join-Path $dir ("housefi-{0}.sql.gz.gpg" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
    dc exec -T -e "BACKUP_PASSPHRASE=$pass" postgres sh -c 'set -e; umask 077; pg_dump -U housefi -d housefi --no-owner --format=plain | gzip -9 | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE" -o /tmp/housefi-backup.gpg'
    try { dc cp postgres:/tmp/housefi-backup.gpg $file } finally { dc exec -T postgres rm -f /tmp/housefi-backup.gpg }
    "Backup written: $file ({0:N1} MB). Copy it somewhere off this laptop too (e.g. Google Drive)." -f ((Get-Item $file).Length / 1MB)
  }
  default { 'Use: start | status | logs [service] | stop | update | seed | tech <command> | backup' }
}
