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
#   .\deploy\laptop.ps1 support open     # support queue: open | resolve <ticketId> "<what>" | unlock <phone> | unlock-start <booking>
#   .\deploy\laptop.ps1 uidai <folder>   # Aadhaar checks: put the UIDAI .cer files from that folder in .env.production
#   .\deploy\laptop.ps1 payouts prepare  # every Monday: weekly technician payouts (list | paid <id> <ref> | failed <id>)
#   .\deploy\laptop.ps1 portal-setup   # once: Housefi HQ's secret address, recovery code, tunnel
#   .\deploy\laptop.ps1 admin list     # super admins: create "<name>" <phone> | list | reset-password | reset-passkeys | unlock
#   .\deploy\laptop.ps1 backup           # encrypted database backup into your housefi-backups folder
#   .\deploy\laptop.ps1 tunnel-setup     # once: the Cloudflare Tunnel for api.housefi.tech and files.housefi.tech
param(
  [Parameter(Position = 0)] [string] $Action = 'status',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Rest = @()
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function dc {
  if (-not (Test-Path .env.production)) { throw '.env.production is missing: create it first (docs/DEPLOY-LAPTOP.md, step 3).' }
  docker compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.laptop.yml --env-file .env.production --profile local-db @args
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') failed (exit $LASTEXITCODE)" }
}

# A cryptographically random whole number from 0 to n-1 (Windows PowerShell 5.1 has no RandomNumberGenerator.GetInt32).
function secureRandom([int] $n) {
  $rng = [Security.Cryptography.RNGCryptoServiceProvider]::new(); $b = [byte[]]::new(4)
  $limit = [uint32]::MaxValue - ([uint32]::MaxValue % [uint32]$n)
  do { $rng.GetBytes($b); $v = [BitConverter]::ToUInt32($b, 0) } while ($v -ge $limit)
  return [int]($v % [uint32]$n)
}

# One value of .env.production ('' when unset), and setting one (the file's other lines stay as they are).
function envValue([string] $key) {
  $line = Get-Content .env.production | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
  if ($line) { return ($line -replace "^$key=", '').Trim() } else { return '' }
}
function setEnvValue([string] $key, [string] $value) {
  $lines = @(Get-Content .env.production)
  if ($lines | Where-Object { $_ -match "^$key=" }) { $lines = $lines | ForEach-Object { if ($_ -match "^$key=") { "$key=$value" } else { $_ } } }
  else { $lines += "$key=$value" }
  [IO.File]::WriteAllLines((Resolve-Path .env.production), $lines)
}

# cloudflared with the account folder (~\.cloudflared: cert.pem from the login, one credentials file per tunnel).
$CloudflaredImage = 'cloudflare/cloudflared:2026.9.3'
$CloudflaredHome = Join-Path $HOME '.cloudflared'
function cfd {
  docker run --rm -v "${CloudflaredHome}:/home/nonroot/.cloudflared" $CloudflaredImage @args
  if ($LASTEXITCODE -ne 0) { throw "cloudflared $($args -join ' ') failed (exit $LASTEXITCODE)" }
}

switch ($Action) {
  'tunnel-setup' {
    # A locally managed tunnel: no Zero Trust plan and no card. Safe to run again (it reuses the tunnel).
    $name = 'housefi-laptop'
    $run = Join-Path $CloudflaredHome 'housefi'
    New-Item -ItemType Directory -Force $run | Out-Null
    if (-not (Test-Path (Join-Path $CloudflaredHome 'cert.pem'))) {
      'Open the link that appears below in the browser where you are signed in to Cloudflare, choose housefi.tech and click Authorize.'
      cfd tunnel login
    }
    $tunnel = (cfd tunnel list --output json | ConvertFrom-Json) | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if (-not $tunnel) {
      cfd tunnel create $name | Out-Host
      $tunnel = (cfd tunnel list --output json | ConvertFrom-Json) | Where-Object { $_.name -eq $name } | Select-Object -First 1
    }
    $id = $tunnel.id
    $creds = Join-Path $CloudflaredHome "$id.json"
    if (-not (Test-Path $creds)) { throw "Tunnel $name exists but $creds is missing (made on another computer?). Delete $name in Cloudflare, then run tunnel-setup again." }
    $adminHost = envValue 'ADMIN_HOST'
    $hosts = @('api.housefi.tech', 'files.housefi.tech') + @($adminHost | Where-Object { $_ })
    foreach ($h in $hosts) { cfd tunnel route dns --overwrite-dns $name $h }
    # The folder the tunnel container gets: only this tunnel's credentials and its two hostnames (never cert.pem).
    Copy-Item $creds (Join-Path $run "$id.json") -Force
    $config = @(
      '# Cloudflare Tunnel for the Housefi laptop server (deploy/docker-compose.laptop.yml mounts this folder).'
      "tunnel: $id"
      "credentials-file: /etc/cloudflared/$id.json"
      'ingress:'
      '  - hostname: api.housefi.tech'
      '    service: http://api:4000'
      '  - hostname: files.housefi.tech'
      '    service: http://s3:7070'
    ) + @(if ($adminHost) { "  - hostname: $adminHost"; '    service: http://admin:8080' }) + @(
      '  - service: http_status:404'
    ) -join "`n"
    [IO.File]::WriteAllText((Join-Path $run 'config.yml'), "$config`n")
    "Tunnel $name ($id) is ready. In .env.production: CLOUDFLARED_DIR=$($run -replace '\\', '/')"
  }
  'portal-setup' {
    # Housefi HQ, once: a secret host name (never linked anywhere) and the code for "forgot password", kept only in
    # .env.production. Then the tunnel learns the host name, and everything restarts with the portal.
    $adminHost = envValue 'ADMIN_HOST'
    if (-not $adminHost) {
      $chars = 'abcdefghjkmnpqrstuvwxyz23456789'
      $label = -join (1..14 | ForEach-Object { $chars[(secureRandom $chars.Length)] })
      $adminHost = "hq-$label.housefi.tech"
      setEnvValue 'ADMIN_HOST' $adminHost
    }
    if (-not (envValue 'ADMIN_RECOVERY_CODE')) {
      $code = -join (1..8 | ForEach-Object { (secureRandom 10) })
      setEnvValue 'ADMIN_RECOVERY_CODE' $code
      "Recovery code for 'forgot password' (save it in Bitwarden now, it is not shown again): $code"
    }
    & $PSCommandPath tunnel-setup
    dc up -d --build
    "Housefi HQ: https://$adminHost  (save this address in Bitwarden; do not share or link it anywhere)"
    'Next: deploy\laptop admin create "<name>" <phone>  (once for each founder)'
  }
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
  'support' { dc exec api node dist/cli/support.js @Rest }
  'admin' { dc exec api node dist/cli/admin.js @Rest }
  'payouts' { dc exec api node dist/cli/payouts.js @Rest }
  'uidai' {
    if ($Rest.Count -ne 1) { throw 'usage: deploy\laptop uidai <folder with the UIDAI .cer files>' }
    node scripts/uidai-certs.mjs $Rest[0]
    if ($LASTEXITCODE -ne 0) { throw 'nothing changed' }
  }
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
  default { 'Use: start | status | logs [service] | stop | update | seed | tech <command> | support <command> | backup | tunnel-setup' }
}
