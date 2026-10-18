# Housefi API on Oracle Cloud Always Free (₹0)

The free way to run the server while Housefi is in its pilot: one Oracle Cloud "Always Free" Ampere (arm64) machine
runs the API, PostgreSQL + PostGIS and Redis together, and Oracle Object Storage (20 GB free) holds the photos and
voice notes. Everything else is the same as [`DEPLOY.md`](DEPLOY.md), which this guide points to for the common
steps. Moving later to DigitalOcean or a paid Oracle plan is a database dump and restore.

Settings for the free pilot (no paid services): `AI_PROVIDER=rules`, `SPEECH_TO_TEXT_PROVIDER=none`,
`TELEPHONY_PROVIDER=off`. Only the team's numbers in `DEMO_PHONES` sign in (no SMS); real customers need the
DLT-approved MSG91 template (LAUNCH-GUIDE.md).

## 1. Create the server (Oracle Cloud console)

1. Sign in at **cloud.oracle.com** (tenancy name, then email and password). Home region: India South (Hyderabad) or
   India West (Mumbai).
2. **☰ → Compute → Instances → Create instance.**
   - **Name:** `housefi-api`.
   - **Image:** click *Change image* → **Canonical Ubuntu 24.04** (it picks the aarch64 version for Ampere).
   - **Shape:** *Change shape* → **Ampere** → **VM.Standard.A1.Flex**, **2 OCPUs, 12 GB memory** (Always Free allows up to
     4 OCPUs / 24 GB in total; 2/12 leaves room and is plenty to start).
   - **Networking:** keep "Create new virtual cloud network" and "Assign a public IPv4 address".
   - **SSH keys:** *Generate a key pair for me* → **Save private key** (a `.key` file). Keep it safe and put a copy in
     your password manager; it is the only way into the server.
   - **Boot volume:** default (about 50 GB) is free.
   - **Create.** If it says **"Out of capacity"**, try another *Availability domain* / *Fault domain* in the same form,
     fewer OCPUs (1 OCPU / 6 GB), or try again in a few hours: free Ampere capacity is shared.
3. When it shows **Running**, copy the **Public IP address**.

## 2. Open the web ports

Oracle blocks everything except SSH by default, in two places.

1. **In the console:** the instance page → *Primary VNIC* → the **Subnet** → **Security Lists** → *Default Security
   List* → **Add Ingress Rules**, twice:
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port **80**.
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port **443**.
2. **On the server** (after step 4 below), Ubuntu on Oracle also has its own firewall rules:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. DNS

Where housefi.tech's DNS is managed, add: type **A**, name **api**, value **the Public IP**. Wait until
`nslookup api.housefi.tech` shows it.

## 4. Connect and install

From your laptop (Windows: PowerShell; Mac/Linux: Terminal), in the folder with the key file:

```bash
chmod 600 ssh-key-*.key            # Mac/Linux only
ssh -i ssh-key-*.key ubuntu@<public-ip>
```

On the server:

```bash
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs git
```

Then the two firewall commands from step 2.

**Download the backend** (the repository is private, so the server gets its own read-only key):

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
```

Copy the printed line → GitHub → `sujal128005/housefi` → **Settings → Deploy keys → Add deploy key** → title
`oracle-server`, paste, **leave "Allow write access" off** → Add. Then:

```bash
sudo mkdir -p /opt/housefi && sudo chown ubuntu:ubuntu /opt/housefi
git clone --filter=blob:none --sparse git@github.com:sujal128005/housefi.git /opt/housefi
cd /opt/housefi && git sparse-checkout set backend
cd /opt/housefi/backend
```

## 5. Photo storage (Oracle Object Storage)

1. Console → **☰ → Storage → Object Storage → Buckets → Create bucket**: name `housefi-uploads`, default
   (Standard, **private**) → Create.
2. On the bucket list page, note the **Namespace** (a short random word) and your region identifier
   (e.g. `ap-hyderabad-1` or `ap-mumbai-1`).
3. **Profile (top right) → My profile → Customer secret keys → Generate secret key** → name `housefi-api` → copy the
   **secret** now (shown once) and then the **Access key** from the list. Both into the password manager.
4. Optional, recommended: bucket → **Lifecycle policy rules → Create rule**: delete objects with prefix `u/` after
   1 day (unchecked uploads land in `u/`; checked ones move to `v/`). If Oracle asks for a policy, add in
   *Identity → Policies*: `Allow service objectstorage-<region> to manage object-family in tenancy`.

## 6. Secrets

```bash
cd /opt/housefi/backend
node scripts/prod-secrets.mjs        # creates .env.production (readable only by you)
nano .env.production
```

Set or change these lines (everything else `prod-secrets.mjs` already filled in):

```
# Photo storage: Oracle Object Storage (replace <namespace> and <region>)
S3_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
S3_REGION=<region>
S3_BUCKET_UPLOADS=housefi-uploads
S3_ACCESS_KEY_ID=<access key from step 5>
S3_SECRET_ACCESS_KEY=<secret key from step 5>

# Free pilot
AI_PROVIDER=rules
SPEECH_TO_TEXT_PROVIDER=none
TELEPHONY_PROVIDER=off

# Team demo (only these numbers sign in until SMS is live)
DEMO_PHONES=<team number 1>,<team number 2>

# SMS: the MSG91 account's auth key; template id "pending" until DLT approves the template
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=<from MSG91>
MSG91_OTP_TEMPLATE_ID=pending

# Razorpay (live keys; webhook secret = the one you type in Razorpay → Webhooks)
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=<from Bitwarden>
RAZORPAY_WEBHOOK_SECRET=<long random text>

# Aadhaar QR checks: UIDAI certificate (DEPLOY.md step 4), or switch the requirement off for now
AADHAAR_REQUIRED=false
```

Keep `DATABASE_URL`, `REDIS_URL`, `POSTGRES_PASSWORD` exactly as generated (they point to the database and Redis on
this machine). Save (Ctrl+O, Enter), exit (Ctrl+X), and **copy the whole file into your password manager**.

## 7. Start

Every command uses the local database profile; a shorthand saves typing:

```bash
cd /opt/housefi/backend
echo 'dc() { docker compose -f /opt/housefi/backend/deploy/docker-compose.prod.yml --env-file /opt/housefi/backend/.env.production --profile local-db "$@"; }' >> ~/.bashrc && source ~/.bashrc
dc up -d --build                    # first build takes 10–20 minutes on the free machine
dc ps                               # repeat until api shows "healthy" (dc logs --since 10m api if it does not)
dc exec api node dist/cli/seed.js   # load the service catalogue once
curl https://api.housefi.tech/v1/health/ready
```

`{"status":"ok"}` means the server is live with HTTPS. Then:

- Razorpay → Settings → **Webhooks** → add `https://api.housefi.tech/v1/webhooks/razorpay` (events in DEPLOY.md
  step 4) with the same secret as `RAZORPAY_WEBHOOK_SECRET`.
- **Backups:** follow DEPLOY.md step 8 ("local-db profile"): `deploy/backup.sh` every night (cron line in the
  script). Keep a copy off the server as well.
- **Uptime alert:** uptimerobot.com (free) → HTTP monitor on `https://api.housefi.tech/v1/health/ready`.

## 8. Operating it

The same commands as DEPLOY.md step 6, with the `dc` shorthand above (it already includes `--profile local-db`):
approve technicians `dc exec api node dist/cli/technicians.js approve <phone>`, update to a new version
`cd /opt/housefi/backend && git pull && dc up -d --build`, logs `dc logs --since 1h api`.

Oracle may reclaim an Always Free machine that stays almost idle for 7 days (very low CPU, network and memory use).
A running API with an uptime monitor usually keeps it active; if Oracle emails about idle reclamation, upgrading the
account to "Pay As You Go" keeps the free limits and stops reclamation (you are still not charged within them).
