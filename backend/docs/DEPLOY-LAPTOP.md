# Pilot server on a laptop (₹0, no card)

For team testing before there is a budget for a real server. The whole backend runs in Docker on one Windows laptop,
and a free **Cloudflare Tunnel** makes it reachable at `https://api.housefi.tech` without opening any port on the
laptop. Photos and voice notes are stored on the laptop too, at `https://files.housefi.tech`.

**Limits:** it works only while the laptop is on, awake and online. Use it for the team's demo numbers. Before real
customers, move to a proper server (`DEPLOY.md`).

| Part | What runs | Where |
|---|---|---|
| API | the Housefi server (`api`), migrations first (`migrate`) | Docker, private network |
| Database, cache | PostgreSQL 16 + PostGIS (`postgres`), Redis (`redis`) | Docker volumes on the laptop |
| Uploads | Versity S3 Gateway (`s3`), S3-compatible; it checks every signature | Docker volume `files-data` |
| HTTPS and the public addresses | Cloudflare Tunnel (`tunnel`): `api.housefi.tech` → `api:4000`, `files.housefi.tech` → `s3:7070` | Outbound connection only |

Files: `deploy/docker-compose.prod.yml` + `deploy/docker-compose.laptop.yml`, and `deploy/laptop.cmd` for everyday
commands.

## Before you start

- Windows 10/11 (x64) with about 15 GB free on C:, **Docker Desktop** (WSL 2) and **Git**.
- housefi.tech's DNS on **Cloudflare** (free plan), with the website records (4 × `A` for `housefi.tech` to GitHub
  Pages, `CNAME www` → `sujal128005.github.io`) set to **DNS only**.
- Your keys ready in Bitwarden: MSG91 Auth Key, Razorpay key ID and key secret.

## 1. Get the code

In PowerShell:

```powershell
cd $HOME
git clone --branch path1/customer-booking https://github.com/sujal128005/housefi.git housefi-server
cd housefi-server\backend
```

Keep this folder only for the server; do development somewhere else.

## 2. Docker Desktop settings

- Settings → General → **Start Docker Desktop when you sign in to your computer**: on.
- The containers restart by themselves when Docker starts.

## 3. Create `.env.production`

```powershell
node scripts/prod-secrets.mjs --laptop
```

This creates `backend\.env.production` with every secret Housefi makes itself (sign-in keys, data encryption keys,
database, Redis and storage passwords, the demo sign-in code) and the free-pilot settings: `AI_PROVIDER=rules`,
`SPEECH_TO_TEXT_PROVIDER=none`, `TELEPHONY_PROVIDER=off`, `AADHAAR_REQUIRED=false`, `MSG91_OTP_TEMPLATE_ID=pending`,
storage at `https://files.housefi.tech`. It never overwrites an existing file.

Open it in Notepad (`notepad .env.production`) and fill in:

| Setting | Value |
|---|---|
| `DEMO_PHONES` | The team's numbers, 10 digits each, comma-separated. Only these sign in until SMS is live |
| `MSG91_AUTH_KEY` | MSG91 → Authkey |
| `MSG91_OTP_TEMPLATE_ID` | Leave `pending` until DLT approves the template; then the template ID |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay → Account & Settings → API keys |
| `RAZORPAY_WEBHOOK_SECRET` | A long random text you make up; the same text goes into Razorpay in step 7 |
| `CLOUDFLARED_DIR` | Already filled in (`<your user folder>/.cloudflared/housefi`); step 4 puts the tunnel's files there |

Save, then **copy the whole file into Bitwarden** (a secure note). Without `DATA_KEYS_B64` the stored data cannot be
read. Never commit, email or paste this file anywhere else.

## 4. Create the Cloudflare Tunnel (once)

The tunnel is made from the laptop, so it needs no Zero Trust plan and no card (Cloudflare's Zero Trust sign-up asks
for a payment method even on the free plan).

```powershell
deploy\laptop tunnel-setup
```

1. The first time, it prints a link. Open it in the browser where you are signed in to Cloudflare, click
   **housefi.tech**, then **Authorize**. ("Cloudflared has installed a certificate…" means it worked.)
2. It then creates the tunnel `housefi-laptop`, points `api.housefi.tech` and `files.housefi.tech` at it, and writes
   the tunnel's folder `<your user folder>\.cloudflared\housefi` (its credentials and the two addresses:
   `api.housefi.tech` → `api:4000`, `files.housefi.tech` → `s3:7070`).

`<your user folder>\.cloudflared\cert.pem` can manage tunnels and DNS for housefi.tech: keep it only on this laptop. The
tunnel container only gets the `housefi` folder. Running `tunnel-setup` again is safe; it reuses the tunnel.

## 5. Start

```powershell
deploy\laptop start
```

The first start builds the server image (several minutes). Then:

```powershell
deploy\laptop status      # everything "running"; migrate and s3-bucket "exited (0)" is correct
deploy\laptop seed        # once: loads the service catalogue
```

Open `https://api.housefi.tech/v1/health/ready` in a browser: it should say `"status":"ok"`.

## 6. Keep the laptop serving

- Windows Settings → System → **Power** → when plugged in, turn off the screen as you like, but **never sleep**.
- Control Panel → Power Options → **Choose what closing the lid does** → when plugged in: **Do nothing**.
- Keep it plugged in and on Wi-Fi.

## 7. Razorpay webhook

Razorpay → Account & Settings → **Webhooks** → Add: URL `https://api.housefi.tech/v1/webhooks/razorpay`, the
secret from `RAZORPAY_WEBHOOK_SECRET`, events `payment.authorized`, `payment.captured`, `payment.failed`,
`order.paid`, `refund.processed`, `refund.failed`.

## Everyday commands

From `housefi-server\backend`:

| Task | Command |
|---|---|
| Is it running? | `deploy\laptop status` |
| Watch the logs | `deploy\laptop logs` (or `deploy\laptop logs api`); Ctrl+C to stop watching |
| After a backend change is merged on GitHub | `deploy\laptop update` |
| Technician review | `deploy\laptop tech pending`, `deploy\laptop tech approve <phone>` |
| Stop / start | `deploy\laptop stop`, `deploy\laptop start` |
| Backup | `deploy\laptop backup` (asks for a passphrase; keep it in Bitwarden). Writes an encrypted file to `housefi-backups` in your user folder. Copy it off the laptop too |

Restore a backup (only with help): decrypt with `gpg -d`, then feed it to `psql` in the `postgres` container, as in
`deploy/backup.sh`.

## When something is wrong

- `https://api.housefi.tech` doesn't answer: is the laptop awake and online, Docker Desktop running, and
  `deploy\laptop status` showing `tunnel` running? `deploy\laptop logs tunnel` shows the connection.
- The API keeps restarting: `deploy\laptop logs api`. A missing setting is named in the first lines.
- Photos don't upload: `deploy\laptop logs s3` and `deploy\laptop logs tunnel`; `deploy\laptop tunnel-setup` repairs
  the two addresses.

## Moving to a real server later

Copy `.env.production` (from Bitwarden) to the new server, take a backup here, restore it there, then follow
`DEPLOY.md`. Uploaded files are in the `files-data` volume; copy them to the new storage before switching
`S3_ENDPOINT`.
