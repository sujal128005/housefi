# Housefi launch guide: what you do, in order

Everything in the code is done and tested. What is left needs your accounts, your money, your ID documents or your
clicks. Do the parts in order; each step says **where** and **how**.

Detailed references: server `backend/docs/DEPLOY.md`, phone calls `backend/docs/TELEPHONY.md`, app settings
`app/README.md`.

---

## Part 1. GitHub (10 minutes)

1. **Merge the app + backend.** github.com/sujal128005/housefi → Pull requests → #3 → wait for the green checks →
   **Merge pull request** (keep "Create a merge commit"; do not choose "Squash", it would lose the history) → Confirm.
2. **Close the old UI pull request.** #2 (`ui/3d-icons`) → **Close pull request**. Its work is already inside #3.
3. **Merge the website.** github.com/sujal128005/housefi-website → Pull requests → #2 → Merge → Confirm. After
   2–3 minutes, open https://housefi.tech/pay/ and https://housefi.tech/t/ : both must load (opened directly, without an
   order or a QR code, they show a short message; that is correct).
4. **Old backend repo.** github.com/sujal128005/backendwork → Pull requests → #13 → Merge. Then Settings → bottom
   → **Archive this repository**. From now on the backend lives in `housefi/backend/`.
5. **Optional, nicer name:** housefi → Settings → General → Default branch → rename `path1/customer-booking` to
   `main` (GitHub moves everything for you).
6. **Make `housefi` private:** Settings → General → bottom ("Danger zone") → Change visibility → Private. Do the same
   for `backendwork`. Keep `housefi-website` public: it is the public website, and free GitHub Pages needs a public
   repository. On a private repository the iOS build runs only when you start it (Actions → App → Run workflow),
   because Mac build minutes count 10× against GitHub's free 2,000 minutes a month.

## Part 2. Accounts and keys (the "API" part)

Write every key into a password manager (Bitwarden, 1Password). **Never** paste keys in chat, email, WhatsApp or
GitHub. They go only into `backend/.env.production` on the server (Part 3).

| # | Service | What for | How | Goes into |
|---|---|---|---|---|
| 1 | **Razorpay** | Payments | dashboard.razorpay.com → finish KYC / account activation → Settings → API Keys → **Regenerate** (the old secret was shared in chat) | `RAZORPAY_KEY_ID` = `rzp_live_TpMvQxe0Uc5oEw`, `RAZORPAY_KEY_SECRET` = the new secret |
| 2 | **Razorpay webhook** | Payment confirmations | Settings → Webhooks → Add → URL `https://api.housefi.tech/v1/webhooks/razorpay` → events `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed` → type a long random secret | `RAZORPAY_WEBHOOK_SECRET` |
| 3 | **DLT registration** (TRAI rule for SMS in India) | Sign-in SMS | Register your business as "Principal Entity" on a DLT portal (Jio: trueconnect.jio.com, or Vodafone Idea / Airtel), register the sender header `HOUSFI` and an OTP template like "{#var#} is your Housefi code. Do not share it." Takes 2–7 days; needs GST/PAN and a letter of authorisation | — |
| 4 | **MSG91** | Sends the SMS | msg91.com → sign up → add the DLT entity ID, header and approved template → copy the Auth Key and the template ID | `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID=HOUSFI`, `SMS_PROVIDER=msg91` |
| 5 | **Exotel** (can wait until after launch) | Masked calls, job offers to keypad phones | exotel.com → KYC → buy an ExoPhone number → build the two call flows exactly as `backend/docs/TELEPHONY.md` says | `EXOTEL_*`, then `TELEPHONY_PROVIDER=exotel` (until then keep `off`: calls fall back to "call me back") |
| 6 | **Anthropic (Claude)** | AI chat and photo reading | console.anthropic.com → Billing (add card, set a **monthly limit**, e.g. $50) → API Keys → Create | `ANTHROPIC_API_KEY`, `AI_PROVIDER=anthropic` |
| 7 | **Sarvam** | Telugu/English voice notes to text | dashboard.sarvam.ai → API Keys → Create; add credits | `SARVAM_API_KEY`, `SPEECH_TO_TEXT_PROVIDER=sarvam` |
| 8 | **UIDAI certificate** | Checking Aadhaar QR codes | uidai.gov.in → Ecosystem → Aadhaar Secure QR code → download the certificate. Step 4 of `backend/docs/DEPLOY.md` shows the one command to convert it | `UIDAI_QR_CERT_PEM_B64` |
| 9 | **Google Maps** | The map in the app (Android) | console.cloud.google.com → new project "Housefi" → APIs → enable **Maps SDK for Android** → Credentials → Create API key → Restrict: Android apps, package `app.housefi.mobile` + the SHA-1 from Play Console (Part 5, step 6) | `app/app.json`: replace `GOOGLE_MAPS_ANDROID_API_KEY` |
| 10 | **DigitalOcean** | The server, database, photo storage | cloud.digitalocean.com → sign up → follow `backend/docs/DEPLOY.md` step 1 (Droplet, Managed PostgreSQL, Spaces). About US$45–60 a month | `DATABASE_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| 11 | **Your two team numbers** | Demo accounts | Just type them | `DEMO_PHONES=<number1>,<number2>` (only here, never in GitHub) |

## Part 3. Put the server online (half a day, once)

**No budget yet?** Run the pilot on your own Windows laptop instead: [`backend/docs/DEPLOY-LAPTOP.md`](backend/docs/DEPLOY-LAPTOP.md)
(Docker + a free Cloudflare Tunnel, ₹0, no card; works while the laptop is on). Team demo numbers only.

With a budget, follow `backend/docs/DEPLOY.md` from top to bottom. In short:

1. **DigitalOcean:** create the Droplet, database and Space (step 1).
2. **DNS:** where housefi.tech's DNS is managed, add an `A` record `api` → the Droplet's IP (step 2).
3. **Install:** SSH in, install Docker, and download only the `backend/` folder of the repository (step 3; the
   commands are written out).
4. **Secrets:** `node scripts/prod-secrets.mjs` creates `.env.production` with all the self-made secrets. Fill in
   the keys from Part 2 with `nano .env.production`. **Copy the finished file into your password manager.**
5. **Start:** `docker compose ... up -d` (step 5). Check https://api.housefi.tech/v1/health shows `"status":"ok"`.
6. **Database backups and uptime alert** (step 8 and step 9 checklist).
7. **Test with real keys:** one ₹1 payment and refund, one SMS, one AI photo, one voice note.

Approving technicians: on the server, in `/opt/housefi/backend`, `dc exec api node dist/cli/technicians.js pending`
to see who is waiting, then `dc exec api node dist/cli/technicians.js approve <phone>` (`dc` is the shorthand from
DEPLOY.md step 6, which lists every command).

## Part 4. Build the app

On your laptop (Windows, Mac or Linux) with Node.js 22 installed:

```bash
cd housefi/app
npm install
npx eas login                      # your Expo account (sujal128005)
npx eas-cli@latest build -p android --profile preview      # an APK to install on test phones
```

EAS builds in the cloud (about 15–20 min) and gives a download link. Install it on your phones, sign in with a team
number, and do one full booking with the real server. Fix anything, then build for the stores (Part 5 and 6).

## Part 5. Google Play Store

1. **Account:** play.google.com/console → sign up ($25 once). Choose **Organisation** if you have a registered
   company (needs a free D-U-N-S number from dnb.com, takes ~1 week) or **Personal**. Identity check takes 1–3 days.
   - Personal accounts created after Nov 2023 must run a **closed test with at least 12 testers for 14 days** before
     they can publish. Start this early (friends, family, technicians).
2. **Create app:** Create app → name "Housefi", default language English (India), App, Free.
3. **Store listing:** short description (80 chars), full description, app icon 512×512 (`app/assets/icon.png`
   scaled), feature graphic 1024×500, at least 2 phone screenshots (take them from the test APK).
4. **App content** (left menu → Policy → App content), answer each:
   - Privacy policy URL: publish one on housefi.tech first (a lawyer should check it; it must name Razorpay, MSG91,
     Exotel, Anthropic, Sarvam, DigitalOcean, and the Aadhaar handling).
   - App access: "Some functionality is restricted" → give a team demo number and the demo code so the reviewer can
     sign in (only Google sees this).
   - Ads: No. Content rating: fill the questionnaire (utility app). Target audience: 18+.
   - **Data safety:** collected: name, phone number, approximate and precise location, photos, audio (voice notes),
     purchase history; payment cards are handled by Razorpay, not the app. Encrypted in transit: yes. Users can
     request deletion: yes (in the app: Account → Delete account).
   - Account deletion URL: a page on housefi.tech that says "In the app: Account → Delete account; or write to
     <your support email> from your registered number".
   - Government ID: say the app scans the Aadhaar QR for technician verification and keeps only the last 4 digits.
5. **Build the store file:** `npx eas-cli@latest build -p android --profile production` (creates an `.aab`).
6. **Upload:** Testing → Closed testing (or Internal testing first) → Create release → upload the `.aab`.
   Then Setup → App signing → copy the **SHA-1** for the Google Maps key restriction (Part 2, row 9).
7. **Production:** after testing, Production → Create release → same `.aab` → Send for review (usually 1–7 days).
8. Later updates: `npx eas-cli@latest build -p android --profile production`, then `npx eas-cli@latest submit -p android` uploads it
   (needs a Google service-account key once; EAS walks you through it).

## Part 6. Apple App Store (iPhone)

1. **Account:** developer.apple.com/programs → enrol ($99 a year). Organisation needs the D-U-N-S number; personal
   is faster. Approval 1–2 days.
2. **Build:** `npx eas-cli@latest build -p ios --profile production`. EAS asks to sign in with your Apple ID and creates the
   certificates and push keys for you (say yes to everything). No Mac needed.
3. **Upload:** `npx eas-cli@latest submit -p ios` → it appears in App Store Connect → TestFlight. Test on iPhones via TestFlight.
4. **App Store Connect** (appstoreconnect.apple.com) → the Housefi app:
   - Screenshots for 6.9" and 6.5" iPhones (from a test iPhone or the simulator), description, keywords,
     support URL (housefi.tech), privacy policy URL.
   - **App Privacy:** the same answers as Google's Data safety. Not used for tracking.
   - **App Review Information:** a team demo number + the demo code, and a note: "Phone sign-in by SMS code; use
     this demo account. Payments are for home repair services done in person (Razorpay), not digital goods."
   - Age rating questionnaire; category "Lifestyle" or "Utilities".
5. Choose the build → **Submit for Review** (usually 1–3 days). Common reasons Apple rejects, already handled in
   the code: account deletion in the app ✓, clear permission messages ✓, no in-app purchase needed for physical
   services ✓.

## Part 7. Before you announce it

- Privacy policy and terms published on housefi.tech and checked by a lawyer (Aadhaar Act, DPDP Act).
- Real ₹1 payment + refund done; SMS arrives on Jio, Airtel and Vi numbers.
- At least 3 approved technicians in your area, online at the launch hour.
- Your two team numbers only in `DEMO_PHONES` on the server, nowhere else.
- Uptime alert on `https://api.housefi.tech/v1/health/ready` active; nightly database backup tested once
  (restore it into a test database).

## If something breaks

- App says "Couldn't connect": check https://api.housefi.tech/v1/health. If it does not load, SSH into the server
  and run `dc ps` and `dc logs --since 1h api` (DEPLOY.md step 6).
- Payments stuck "pending": Razorpay dashboard → Webhooks → check deliveries are green.
- No SMS: MSG91 → Reports; most often the DLT template text does not match exactly.
