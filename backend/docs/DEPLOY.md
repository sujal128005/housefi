# Deploying Housefi (DigitalOcean, Bangalore)

No AWS needed. Everything runs in DigitalOcean's **BLR1** region (Bangalore), so data stays in India and the app is
fast in Hyderabad. Expected cost at launch is about US$45–60 a month (Droplet + Managed PostgreSQL + Spaces).

| Part | DigitalOcean product | Notes |
|---|---|---|
| API (this repo, Docker) + HTTPS | Droplet, Basic, 2 vCPU / 4 GB, Ubuntu 24.04, BLR1 | Caddy gets the certificate for `api.housefi.tech` |
| Database | Managed PostgreSQL 16, BLR1 | PostGIS included, daily backups, point-in-time restore |
| Redis | Container on the Droplet (`deploy/docker-compose.prod.yml`), or Managed Caching (Valkey) | Password always on |
| Photos and voice notes | Spaces (S3-compatible), BLR1, private | The app uploads with short-lived signed URLs |

Zoho Catalyst was checked as an alternative: it has no managed PostgreSQL with PostGIS (the map, distance and dispatch
queries need it), so it would mean rewriting the data layer. E2E Networks (Indian) also works with the same Docker
setup if you prefer it; only steps 1–2 change.

## 1. Create the resources (DigitalOcean control panel)

1. **Project**: "Housefi".
2. **Managed PostgreSQL**: version 16, BLR1, the smallest plan to start (1 GB / 1 vCPU), with a standby node once real
   bookings flow.
   - Settings → Trusted sources: only the Droplet. Nothing else can connect.
   - Users & databases: create database `housefi`. Keep the `doadmin` connection string for the first migration
     (it creates the PostGIS extension).
3. **Droplet**: Ubuntu 24.04, BLR1, Basic 2 vCPU / 4 GB, **SSH key only** (no password), monitoring on, and the
   same VPC as the database.
4. **Cloud Firewall** on the Droplet:
   - Inbound: SSH (22) **only from your office/home IP**; HTTP (80) and HTTPS (443) from anywhere.
   - Outbound: all.
5. **Spaces**: a bucket named `housefi-uploads` in BLR1, **File listing: Restricted** (private).
   - Spaces Keys → generate a key → `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.
   - Lifecycle rule (Settings → Lifecycle, or `s3cmd setlifecycle`): expire objects under the prefix `u/` after 1
     day. Uploads land in `u/`; checked files are moved to `v/`, so `u/` only ever holds leftovers.
   - Optional: a second private Space `housefi-backups` for extra database dumps.

## 2. DNS

Where `housefi.tech` is managed (your domain registrar or the DNS used for GitHub Pages), add:

| Type | Name | Value |
|---|---|---|
| A | `api` | the Droplet's IPv4 address |

The website (`housefi.tech`, GitHub Pages) is not affected. Wait until `nslookup api.housefi.tech` shows the Droplet IP.

## 3. Install on the Droplet

```bash
ssh root@<droplet-ip>
# Docker (official script), then a non-root user to run it
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" housefi && usermod -aG docker housefi
apt-get install -y unattended-upgrades gnupg && dpkg-reconfigure -plow unattended-upgrades
su - housefi
git clone git@github.com:sujal128005/backendwork.git /opt/housefi   # the repository must be PRIVATE
cd /opt/housefi
```

## 4. Secrets

```bash
node --version || (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs)
node scripts/prod-secrets.mjs        # creates .env.production (chmod 600) with every self-generated secret
nano .env.production                 # fill in the values below
```

`prod-secrets.mjs` generates the JWT keys, the peppers, the phone hash key, the data encryption key, the Redis
password, the Exotel webhook secret and the demo code. **Copy `.env.production` into your password manager now.**
Without `DATA_KEYS_B64` and `PHONE_HASH_KEY_B64`, the stored addresses, names and phone lookups cannot be read.

Fill in:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL → Connection details → user `doadmin` for the first run, `?sslmode=require` at the end. Later create an app user (step 7). |
| `DEMO_PHONES` | Your team's two numbers, comma-separated, 10 digits. Only these numbers sign in with `DEMO_OTP_CODE`. |
| `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID` | MSG91 dashboard; the OTP template must be **DLT-approved** (TRAI). Sender ID as registered on DLT. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay → Settings → API keys (live keys `rzp_live_…` only here). |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Webhooks → add `https://api.housefi.tech/v1/webhooks/razorpay`, events `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`; choose a secret. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Spaces key from step 1. |
| `EXPO_ACCESS_TOKEN` | Only if "enhanced push security" is on in the Expo project. |
| `ANTHROPIC_API_KEY`, then `AI_PROVIDER=anthropic` | console.anthropic.com → API keys. Set a monthly spend limit there. |
| `SARVAM_API_KEY`, then `SPEECH_TO_TEXT_PROVIDER=sarvam` | dashboard.sarvam.ai → API keys. |
| `UIDAI_QR_CERT_PEM_B64` | UIDAI's Secure QR certificate (uidai.gov.in → Ecosystem → Aadhaar Secure QR code): `base64 -w0 uidai.cer` (convert to PEM first if it is DER: `openssl x509 -inform der -in uidai.cer -out uidai.pem`). |
| `EXOTEL_*`, then `TELEPHONY_PROVIDER=exotel` | When phone calls go live: docs/TELEPHONY.md. Until then keep `TELEPHONY_PROVIDER=off` (keypad technicians are served through the coordinator queue). |

## 5. Start

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production logs -f api   # Ctrl+C to stop watching
```

The `migrate` service applies every database migration before the API starts. Then load the catalog once:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production exec api node dist/cli/seed.js
curl https://api.housefi.tech/v1/health/ready      # {"status":"ok",...}
```

Without Managed PostgreSQL (cheapest start, one machine): add `--profile local-db` to every `docker compose` command,
keep the generated `DATABASE_URL`, and set up the nightly backup in step 8.

## 6. Operating it

All commands run in `/opt/housefi`. Shorthand used below:
`dc() { docker compose -f deploy/docker-compose.prod.yml --env-file .env.production "$@"; }`

| Task | Command |
|---|---|
| Approve, suspend or reject a technician | `dc exec api node dist/cli/technicians.js approve <phone>` (also `pending`, `suspend <phone> <reason>`, `reinstate`, `reject`, `name`, `new-photo`, `reissue-qr`) |
| Coordinators | `dc exec api node dist/cli/coordinators.js …` |
| Weekly payouts | `dc exec api node dist/cli/payouts.js …` |
| Unlock a phone number locked after wrong codes | `dc exec api node dist/cli/support.js unlock <phone>` |
| Update to a new version | `git pull && dc up -d --build` (migrations run first; a failed migration keeps the old API running) |
| Roll back | `git checkout <previous tag> && dc up -d --build` (migrations are additive; never edit an applied one) |
| Logs | `dc logs --since 1h api`. Look for `ALERT` lines (SMS budget reached, long sign-in locks, phone-call failures). |

**Monitoring**: DigitalOcean → Monitoring → Uptime: check `https://api.housefi.tech/v1/health/ready` every minute and
alert by email. Add alert policies for Droplet CPU > 80 % and disk > 80 %.

## 7. Database user with fewer rights (after the first start)

```sql
-- as doadmin, in the housefi database
CREATE USER housefi_app WITH PASSWORD '<random>';
GRANT CONNECT ON DATABASE housefi TO housefi_app;
GRANT USAGE, CREATE ON SCHEMA public TO housefi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO housefi_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO housefi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO housefi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO housefi_app;
```

Put `housefi_app` in `DATABASE_URL`. Keep the `doadmin` URL in the password manager for migrations that need it.

## 8. Backups

- **Managed PostgreSQL**: daily backups and point-in-time restore (7 days) are automatic. Test a restore once into a
  new cluster ("Fork database").
- **local-db profile**: `deploy/backup.sh` writes an encrypted dump every night and keeps 14 days; set
  `BACKUP_PASSPHRASE` (and optionally `BACKUP_SPACE` with `s3cmd`) and add the cron line from the script's header.
- **Spaces**: photos are evidence for disputes; turn on versioning if you want deleted files kept for a while.
- **`.env.production`**: in the password manager. It is the one thing that cannot be recreated.

## 9. Security checklist before launch

- [ ] GitHub repository is **private**; nobody outside the team has access.
- [ ] SSH: key only, firewall limits port 22 to your IP; `root` login disabled after creating the `housefi` user
      (`PermitRootLogin no` in `/etc/ssh/sshd_config`).
- [ ] `.env.production` is `chmod 600`, never committed, backed up in a password manager.
- [ ] Razorpay live keys only on the server; webhook secret set; test one ₹1 payment and its refund.
- [ ] MSG91 OTP template DLT-approved; `OTP_SMS_PER_DAY` matches your SMS balance.
- [ ] `DEMO_PHONES` holds only the team's numbers; change `DEMO_OTP_CODE` if anyone leaves the team.
- [ ] Anthropic and Sarvam: monthly spend limits set in their dashboards.
- [ ] Aadhaar: offline Secure QR verification only (no Aadhaar number stored; last 4 digits and a one-way fingerprint).
      Have a lawyer confirm the consent text and your obligations under the Aadhaar Act / DPDP Act before launch.
- [ ] Uptime alert on `/v1/health/ready` is active.
- [ ] The website's CORS origin (`https://housefi.tech`) is in `CORS_ORIGINS`, so the Technician ID check page works.
- [ ] The website's `app-pages` branch is merged and deployed, so `https://housefi.tech/pay/` (payments) and
      `https://housefi.tech/t/` (Technician ID check) exist before the app is released.
