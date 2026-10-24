# Housefi: notes for Claude

Housefi is a home-services platform for Hyderabad: customers book a verified technician (plumbing, electrical, AC,
appliances, cleaning, carpentry), pay a ₹49 visit fee, approve a quote, pay the rest; technicians get job offers,
travel, send quotes and earn. English and Telugu throughout.

The owner (sujal128005) is a founder, not a developer. Explain in simple English, one step at a time, and say where
to click. They test on real phones and share screenshots.

## Repositories

| Repository | What | Visibility |
|---|---|---|
| `sujal128005/housefi` (this one) | `app/` the Android + iOS app, `backend/` the API server, database and deploy kit | **Private** |
| `sujal128005/housefi-website` | housefi.tech (Next.js static export on GitHub Pages): home, `/privacy`, `/terms`, **`/pay/`** (Razorpay checkout page the app opens), **`/t/`** (Technician ID check page a QR opens). Publishes itself on every push to `main`. Ignore its `Housefi-3D-Website` entry (an old leftover) | Public (free Pages needs it) |
| `sujal128005/backendwork` | Old copy of the backend. **Archived, read-only, never use** | Private |

Main branch here is **`path1/customer-booking`** (there is no `main`).

## Rules (do not break)

- **Never commit secrets**: API keys, `.env`, `.env.production`, Razorpay key secret, passwords. Keys live only in
  `backend/.env.production` on the server and in the owner's password manager (Bitwarden). Never ask the owner to
  paste a secret in chat; tell them where to put it.
- **The team's two demo phone numbers never appear in any file or commit.** They live only in `DEMO_PHONES` on the
  server. Tests use fake numbers (98765xxxxx).
- The app holds **no secrets** at all (the Razorpay key ID comes from the API with each order).
- Work on a **new branch**, open a **pull request** into `path1/customer-booking`, let the checks run. Never push to
  `path1/customer-booking` directly. The owner merges (or you merge only when they explicitly ask).
- Before saying "done": run the folder's checks (below) and say plainly what passed, failed or was not tested.
- Database migrations are additive; never edit one that is already applied (`backend/prisma/migrations/`).

## Commands

```bash
# App (Expo SDK 57, React Native 0.86, expo-router, TypeScript)
cd app && npm install
npm run typecheck && npm run lint && npm test          # 155+ tests (jest)
EXPO_PUBLIC_HOUSEFI_API_URL=http://localhost:4000/v1 npx expo start   # against a local API
npx expo export -p web                                  # quick browser build for screenshots

# Backend (NestJS 11 + Fastify, Prisma 6, PostgreSQL 16 + PostGIS, Redis)
cd backend && npm install
npm run setup                       # local .env with generated secrets
npm run db:local                    # local DB without Docker (PGlite + PostGIS), or: docker compose up -d
npm run db:deploy && npm run db:seed && npm run dev    # http://localhost:4000/v1/health
npm run lint && npm run typecheck && npm test          # 460+ tests (unit + e2e on PGlite)
npm run tech -- pending | approve <phone>              # technician review CLI
npm run demo                        # laptop demo: customer + technician phones side by side on localhost:8090
```

GitHub checks (`.github/workflows/`): `app.yml` (typecheck, tests, expo-doctor, Android release build opened on an
emulator by `app/tools/launch-check.mjs`; the **iOS build runs only when started by hand**: Actions → App → Run
workflow, because Mac minutes cost 10× on a private repo) and `backend.yml` (lint, typecheck, tests on real
PostgreSQL 16, build, `npm audit`). Dependabot proposes minor/patch updates only.

## How it fits together

- App → API: `https://api.housefi.tech/v1` (`EXPO_PUBLIC_HOUSEFI_API_URL`, default in
  `app/src/services/createBackend.ts`). Contract: `backend/docs/openapi.yaml`; `backend/test/contract.e2e-spec.ts`
  fails if a controller and the spec disagree.
- Sign-in: phone + SMS code (MSG91), roles CUSTOMER and TECHNICIAN, access + refresh tokens (rotated; reuse ends the
  session). Team demo numbers (`DEMO_PHONES`) sign in with `DEMO_OTP_CODE`, see a "Demo account" badge, meet only each
  other, and their payments are simulated.
- Payments: Razorpay. `POST /bookings/{id}/payments` creates an order → the app opens `housefi.tech/pay/#…` in the
  secure in-app browser → result comes back via `housefi://pay/return` → `POST /payments/{id}/verify`; the webhook
  `/v1/webhooks/razorpay` is the source of truth. Cash: the technician confirms.
- Matching/dispatch: offers to nearby online technicians (PostGIS), 45 s each; keypad-phone technicians get an IVR
  call (Exotel) when telephony is on; otherwise a coordinator queue.
- Live: Server-Sent Events with polling fallback; technician location shown only while EN_ROUTE; masked calls through
  Exotel (`/bookings/{id}/call`); push via Expo; uploads to S3-compatible storage (DigitalOcean Spaces), checked
  server-side before use.
- Identity: technician ID card + QR (`/t/` page), Aadhaar Secure QR verified offline (only last 4 digits, birth year,
  gender, name match kept).
- Skill check (after the Aadhaar scan): level → timed exam per trade (marked on the server) and/or a work video HQ
  approves, plus up to 4 certificates. Job offers go only to **verified trades** (`technician_skills.verified_at`);
  `SKILL_CHECK_REQUIRED` (default true). The review window starts when the skill check is sent.
- Privacy: names, phones and addresses encrypted at rest; phone lookups by HMAC; logs never contain secrets or
  personal data; `DELETE /me` erases an account (button in the app: Account / Profile → Delete account).

## Where things are

**App (`app/`)**
- Screens: `src/app/` (expo-router files). Customer tabs `(tabs)/`, booking flow `book/`, booking hub `booking/`,
  technician `tech/`, sign-in `auth/`.
- All words: `src/i18n/en.ts` and `src/i18n/te.ts` (same keys in both; Telugu must be added too).
- Look: colours, spacing, radius in `src/theme/tokens.ts`; shared components in `src/ui/`; 3D icons via
  `src/illustrations/Art3D.tsx` (images in `assets/icons3d`, made by `tools/icons3d`); design notes
  `docs/DESIGN-SYSTEM.md`.
- Talking to the API: interface `src/services/api.ts`, live client `src/services/http/HttpBackend.ts`;
  `src/services/mock/MockBackend.ts` is a **test double only** (no screen may import it; a test checks).
- App settings: `app.json` (name, version, bundle id `app.housefi.mobile`, permissions, Google Maps key placeholder
  `GOOGLE_MAPS_ANDROID_API_KEY`), `eas.json` (build profiles and `EXPO_PUBLIC_*` values).
- No over-the-air updates: every app change reaches users through a new store build.

**Backend (`backend/`)**
- One folder per feature in `src/modules/` (auth, bookings, payments, dispatch, jobs, technicians, telephony,
  notifications, ai, uploads, support, …): `*.controller.ts` (routes), `*.schemas.ts` (zod input checks),
  `*.service.ts` (logic).
- Settings: every environment variable is defined and checked in `src/config/env.ts`; listed with comments in
  `.env.example`; production values only in `.env.production` on the server.
- Database: `prisma/schema.prisma` + `prisma/migrations/`; seed catalogue `src/cli/seed.ts`.
- Payouts: `src/modules/earnings/` (ledger, weekly payouts, technicians' payout details); bank files by the payout kit
  `src/modules/earnings/payout-kit/` (built with IBM Bob, see `docs/IBM-BOB.md`).
- Super admin portal **Housefi HQ**: API in `src/modules/admin/` (sign-in, bookings/people/ops services, `guide/` =
  Sarathi, the guide: look tools + proposals approved by the admin, never acting itself), website in `admin/`
  (React + Vite, served by `deploy/admin.nginx.conf` on the secret `ADMIN_HOST`). Live support chat:
  `src/modules/support/support-chat.service.ts`.
- Docs: `docs/DEPLOY.md` (server, step by step), `docs/DEPLOY-LAPTOP.md` (pilot on the owner's Windows laptop: Docker,
  Cloudflare Tunnel, uploads in versitygw, `deploy/laptop.cmd`), `docs/TELEPHONY.md` (Exotel), `docs/REPORT.md` (security review),
  `docs/STATE-MACHINE.md` (booking statuses), `docs/openapi.yaml`.
- Launch checklist for the owner: `LAUNCH-GUIDE.md` (repo root).

## Recipes

**Change text in the app**: edit the key in `app/src/i18n/en.ts` and the same key in `te.ts`. Run app checks.

**Change a screen or its look**: the screen file in `app/src/app/…`, shared parts in `app/src/ui/`, colours in
`app/src/theme/tokens.ts`. Keep every `testID`. Check visually with `npx expo export -p web` (or a preview APK), and
send the owner a screenshot.

**Add or change an API endpoint**: backend controller + zod schema + service → update `backend/docs/openapi.yaml` →
backend tests (an e2e spec in `backend/test/`) → app: `api.ts` interface, `HttpBackend.ts` method with a decoder,
the same method in `MockBackend.ts`, a test in `app/src/__tests__/httpBackend.test.ts` → the screen.

**Change the database**: edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <what>` to create a new
migration folder; commit it. The server applies migrations itself on start.

**Switch the AI model (same company)**: no code. On the server set `AI_CHAT_MODEL` / `AI_VISION_MODEL` in
`.env.production` (default `claude-opus-5-5`) and restart. **Free option**: `AI_PROVIDER=cloudflare` (Workers AI,
`src/modules/ai/cloudflare.ts`; `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, models in `CLOUDFLARE_AI_CHAT_MODEL` /
`CLOUDFLARE_AI_VISION_MODEL`). **Turn AI off**: `AI_PROVIDER=rules` (rule-based chat and
"pick a service" fallback; the app keeps working).

**Free AI backups**: `AI_BACKUPS=groq,cerebras` (`GROQ_API_KEY`, `CEREBRAS_API_KEY`; models in `GROQ_CHAT_MODEL`,
`GROQ_VISION_MODEL`, `CEREBRAS_CHAT_MODEL`). `src/modules/ai/open-models.ts` asks Cloudflare, then the backups in order
(Cerebras: chat only), each try `AI_ATTEMPT_TIMEOUT_MS`, all together `AI_TIMEOUT_MS`; a model that just failed goes to
the back of the line for `AI_COOLDOWN_MS`; the rules last. Claude (if main) falls back to them too. Another
OpenAI-compatible free service = one more runner there plus its settings in `env.ts`. Do not add Gemini's or Mistral's
free plans: they may use customer messages and photos for training.

**Switch AI to another company** (e.g. OpenAI or Google):
1. New file `backend/src/modules/ai/<company>.ts` with two classes implementing `ChatAssistant` (`chat.ts`) and
   `PhotoClassifier` (`models.ts`). Copy the shape of `claude.ts`: keep `ChatMemory`, send safety messages
   (`soundsDangerous`) and "talk to a person" (`wantsPerson`) to the rules, fall back to `RuleBasedChat` /
   `NoModelPhotoClassifier` on any error or timeout (`AI_TIMEOUT_MS`), read photos only via the uploads service's
   checked copy (`verifiedKey`), return only catalogue service ids, require a minimum confidence.
2. `src/config/env.ts`: add the value to the `AI_PROVIDER` enum and its key (e.g. `OPENAI_API_KEY`) with a "required
   when AI_PROVIDER=…" check; add it to `.env.example` and the table in `docs/DEPLOY.md`.
3. `src/modules/ai/ai.module.ts`: register the classes and choose them in the `CHAT_ASSISTANT` / `PHOTO_CLASSIFIER`
   factories.
4. Tests with a fake HTTP client, like `test/ai-models.e2e-spec.ts`. No app change is needed (same API).
5. Owner: put the new key in `.env.production`, set `AI_PROVIDER=<company>`, restart.

**Switch speech-to-text** (Telugu voice notes): same pattern with `SpeechToText` (`models.ts`), `sarvam.ts` as the
example, `SPEECH_TO_TEXT_PROVIDER` in `env.ts`, wiring in `ai.module.ts`. Keep the 30-second limit.

**Switch the SMS company**: implement `SmsSender` (`src/modules/auth/sms.ts`, see `Msg91SmsSender`), add the value to
`SMS_PROVIDER` in `env.ts`, choose it where `SMS_SENDER` is provided. Indian OTP SMS need a DLT-approved template.

**Festive greeting on the home screens**: the festival list (dates, theme, English and Telugu words, a service to
book) is `backend/src/modules/catalog/festivals.ts`; the app only draws each theme (`app/src/illustrations/FestiveArt.tsx`).
Add next year's dates there and ship a backend change: no new app build needed.

**Addresses: states, districts, localities, PIN codes**: India Post's directory in
`backend/assets/places/india-pincodes.json.gz` (how to refresh it: `backend/assets/places/README.md`), served by
`src/modules/places/`. Technician registration uses it (state → district → localities → PIN that belongs to one).

**Skill exam questions**: one JSON file per trade in `backend/src/modules/skills/questions/` (English + Telugu, bands
1-4 = the four levels; each band needs at least 3 MCQ, 3 DIAGRAM, 4 SELECT; more questions = more variety). Pictures
are ids drawn by the app (`app/src/illustrations/SkillArt.tsx`); a new id goes in `app/src/illustrations/skillArtIds.json`
and gets a drawing (tests on both sides check). Diagram answers are the letters marked in `skillScenes.tsx`. A question
change needs only a backend deploy; a new picture needs an app build. HQ reviews videos and certificates on the
**Skill checks** page.

**Courses** (technician app → Learn tab): the course texts, lessons and quizzes are in
`backend/src/modules/courses/catalog/*.json` (English + Telugu); HQ → **Courses** uploads one video per lesson (MP4/MOV,
at most 100 MB: Cloudflare's limit) and publishes. Basic and safety free; advanced free at 3.8★, otherwise ₹99
(`course_payments`, same Razorpay checkout and webhook as bookings). Completion = every lesson watched at normal speed +
quiz 3/5 → a `HOUSEFI_COURSE` certification on the profile and ID. Changing course texts needs a backend deploy only.

**Skill Passport** (technician app → Profile → My Skill Passport): the technician's record, proven trades (and how:
exam score, video, HQ), Housefi courses and checked certificates. Off by default (`technicians.passport_public`); when
switched on it appears on the public QR page (`GET /verify/technicians/{token}` → `passport`, shown by the website's
`/t/` page). API: `GET`/`PUT /tech/passport` in `src/modules/identity/`. Never phone numbers or addresses.

**Fair-pay meter** (bill, receipt, technician's job): `fairPay` on bookings and jobs, worked out in
`backend/src/modules/earnings/fair-pay.ts` with the ledger's own rules (`jobCredits`), so the technician's part always
equals their earnings. Shares come from `TECH_VISIT_SHARE_RUPEES` / `TECH_LABOUR_SHARE_PERCENT`; coupons are Housefi's.
App: `app/src/ui/FairPayMeter.tsx`. If GST is ever charged, add a tax line there and in the app.

**Quote checker** (customer home → "Got a quote? Check it", `app/src/app/quote-check.tsx`): `POST /ai/read-quote` (the
vision model of `AI_PROVIDER` only reads the photo into lines; `ClaudeQuoteReader` / `CloudflareQuoteReader`; rules:
the customer types) then `POST /ai/check-quote` (fixed rules in `backend/src/modules/ai/quote-check.ts`: Housefi's
usual price = visit fee + service repair range, fair up to the top, "a bit high" to 1.5×; listed parts per piece with
10% leeway). Nothing is stored.

**Telephony** (masked calls, keypad job offers): `TelephonyProvider` in `src/modules/telephony/telephony-provider.ts`
(Exotel and a fake). `TELEPHONY_PROVIDER=off` until Exotel is set up (calls fall back to "call me back").

**Payments**: `src/modules/payments/` (`razorpay.client.ts`, signatures, webhook). Another gateway means a new
client, the app's checkout (`app/src/services/checkout.ts`) and the website's `/pay/` page.

**Give a demo without phones**: `cd backend && npm run demo` (needs `npm install` in `app/` once). Opens one page with
both phones (customer 98765 00001, technician 98765 00002, code 482916, all fake, local only); a fresh database every
start. "Start over" on the page signs both phones out and shows the welcome screen. After app changes:
`npm run demo -- --rebuild`. Ctrl+C stops it.

**Ship a backend change**: merge the PR → on the server: `cd /opt/housefi/backend && git pull && dc up -d --build`
(`dc` shorthand in `docs/DEPLOY.md` step 6; migrations run first; a failed one keeps the old API running).

**Ship an app change**: raise `version` in `app/app.json` → `npx eas-cli@latest build -p android --profile production`
and `-p ios` → `npx eas-cli@latest submit` → store review (`npx eas …` does not work: the package is `eas-cli`). Test first with `--profile preview` (APK).

**Website change** (other repository): edit, `npm run check` (lint, typecheck, tests, build), PR into `main`; it
publishes itself after merge.
