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

## 8. Turn on AI (free)

Both are optional; without them the chat answers with Housefi's rules and voice notes stay audio.

**Voice notes to text (Telugu and English): Sarvam**
1. Sign up at dashboard.sarvam.ai (free credits, no card) → **API Keys** → create a key → save it in Bitwarden.
2. In `.env.production`: `SPEECH_TO_TEXT_PROVIDER=sarvam` and `SARVAM_API_KEY=<the key>`.

**Chat assistant and "pick a service" from a photo: Cloudflare Workers AI**
1. Account ID: Cloudflare dashboard → **Account home** → the **⋯** next to your account → **Copy account ID** (32 characters).
2. Token: top right → **My Profile** → **API Tokens** → **Create Token** → template **Workers AI** → **Use template** →
   **Continue to summary** → **Create Token**. Save it in Bitwarden.
3. In `.env.production`: `AI_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID=<the id>`, `CLOUDFLARE_AI_TOKEN=<the token>`.

Then `deploylaptop start` (it restarts the API with the new settings). The free allowance resets every day; past it,
and whenever a model is slow or fails, the chat falls back to the rules by itself. Cloudflare does not use what is
sent for training. Back up `.env.production` in Bitwarden again.

**Free backups when Cloudflare is slow or down: Groq and Ollama** (optional, recommended)
1. Groq: sign up at **console.groq.com** (free, no card) → **API Keys** → **Create API Key** → save it in Bitwarden.
   Optional: **Settings → Data Controls** → turn on **Zero Data Retention**.
2. Ollama: sign up at **ollama.com** (free) → top right → **Settings** → **Keys** → **Add API Key** → save it in Bitwarden.
3. In `.env.production`: `AI_BACKUPS=groq,ollama`, `GROQ_API_KEY=<the Groq key>`, `OLLAMA_API_KEY=<the Ollama key>`.

Then `deploy\laptop update`. Each question goes to Cloudflare first; if it fails, hangs (7 s) or answers badly, Groq
answers, then Ollama (chat only, unless `OLLAMA_VISION_MODEL` names a cloud model that reads images), and only then the
rules. A service that just failed waits at the back of the line for a minute, so customers do not wait on it. Neither
keeps or trains on what is sent. (Cerebras also works as `cerebras` with `CEREBRAS_API_KEY`, but now needs a $5 top-up.)

## 9. Housefi HQ (the super admin portal)

The portal is a website at a **secret address** on housefi.tech, made by the setup below, kept only in
`.env.production` and Bitwarden, and never linked anywhere. It opens on laptops only. There is no sign-up: accounts
exist only when created here. Sign-in is the password, then Windows Hello (face, fingerprint or PIN).

1. Once: `deploy\laptop portal-setup`. It creates the secret address and the **recovery code** for "forgot
   password", adds the address to the Cloudflare tunnel, and restarts. Save the **address** and the **recovery code**
   it prints in Bitwarden (the code is not shown again).
2. Once for each founder: `deploy\laptop admin create "Sujal Negi" <phone>` and `deploy\laptop admin create "Navya"
   <phone>`. Each prints an **official username** and a **password**, once: save both in Bitwarden.
3. Open the address in Edge or Chrome on the laptop, sign in, and register Windows Hello when asked (first time only).

Good to know:
- 5 wrong passwords lock the account for 15 minutes (10: a day). `deploy\laptop admin unlock <username>` lifts it.
- Forgot the password: "Forgot password?" on the sign-in page: username, the phone on the account and the recovery
  code, then a wait of 2 to 5 hours that no one can shorten. Signing in normally meanwhile cancels it.
- New laptop: `deploy\laptop admin reset-passkeys <username>`, then sign in on the new laptop and register again.
- `deploy\laptop admin list` shows the accounts; every sign-in and change is in the audit log.
- New recovery code (for example after it was shown to someone): delete the `ADMIN_RECOVERY_CODE=` line in
  `.env.production`, save, and run `deploy\laptop portal-setup` again. It prints a new code; save it in Bitwarden.

**What is in the portal**
- **Emergency SOS**: when a customer or technician presses SOS, every page of the portal turns red, a siren plays
  and (after you click "Turn on SOS alerts" once) Windows shows an alert. The SOS page shows who, their phone, the
  booking, the other person, and where they are (the phone's position, the technician's live position and the
  address) on a radar, with Google Maps one click away.
- **Reports**, **Queries** (live chats handed over by the app's assistant, and call-back requests), **Bookings**,
  **Customers**, **Technicians**, **Payouts**, **Chats**, **Analytics**, **Audit log**, and **HQ Arcade**.
- **Sarathi**, the guide (the glowing button at the bottom right, or Ctrl + /): ask anything about Housefi, by
  typing, speaking (allow the microphone once) or with a photo. It can prepare actions, but nothing happens until you
  approve the card: a click for small things, typing the confirmation for bigger ones, and for deleting anything
  typing it twice plus Windows Hello. It answers fully when `AI_PROVIDER` is `anthropic` or `cloudflare` (section 8);
  with `AI_PROVIDER=rules` it works in basic mode (SOS, a booking code, "cancel HF-12345", today's numbers).

## Everyday commands

From `housefi-server\backend`:

| Task | Command |
|---|---|
| Is it running? | `deploy\laptop status` |
| Watch the logs | `deploy\laptop logs` (or `deploy\laptop logs api`); Ctrl+C to stop watching |
| After a backend change is merged on GitHub | `deploy\laptop update` |
| Technician review | `deploy\laptop tech pending`, `deploy\laptop tech approve <phone>` |
| Support tickets | `deploy\laptop support open` (most urgent first), `deploy\laptop support resolve <ticketId> "what you did"` |
| Customer locked out of sign-in (too many wrong SMS codes) | Call them on that number first, then `deploy\laptop support unlock <phone>` |
| Technician locked out of a job (5 wrong start codes) | Call the customer and the technician first to check they are together at the door, then `deploy\laptop support unlock-start HF-48291` (the booking code). The technician can type the code again; the support ticket is closed |
| Turn on Aadhaar checks (once, and again when UIDAI publishes a new certificate) | Download every certificate under "Secure QR Code" and "Offline e-KYC" on uidai.gov.in (UIDAI Certificate Details) into one folder, old ones too (an older Aadhaar stays signed with the certificate of its time). Then `deploy\laptop uidai C:\Users\<you>\uidai-certs` and `deploy\laptop start`. To require a verified Aadhaar before approval, set `AADHAAR_REQUIRED=true` in `.env.production` and `deploy\laptop start` |
| Pay technicians (every Monday) | `deploy\laptop payouts prepare` (one payout per technician for the week to Sunday), pay each by bank / UPI, then `deploy\laptop payouts paid <payoutId> <reference>`. A failed transfer: `deploy\laptop payouts failed <payoutId>` (it goes into next Monday's run). Technicians see each week in the app: "Paid on Mon 20 Oct" |
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
