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
`.env.production` (default `claude-opus-5-5`) and restart. **Turn AI off**: `AI_PROVIDER=rules` (rule-based chat and
"pick a service" fallback; the app keeps working).

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

**Telephony** (masked calls, keypad job offers): `TelephonyProvider` in `src/modules/telephony/telephony-provider.ts`
(Exotel and a fake). `TELEPHONY_PROVIDER=off` until Exotel is set up (calls fall back to "call me back").

**Payments**: `src/modules/payments/` (`razorpay.client.ts`, signatures, webhook). Another gateway means a new
client, the app's checkout (`app/src/services/checkout.ts`) and the website's `/pay/` page.

**Ship a backend change**: merge the PR → on the server: `cd /opt/housefi/backend && git pull && dc up -d --build`
(`dc` shorthand in `docs/DEPLOY.md` step 6; migrations run first; a failed one keeps the old API running).

**Ship an app change**: raise `version` in `app/app.json` → `npx eas build -p android --profile production` and
`-p ios` → `npx eas submit` → store review. Test first with `--profile preview` (APK).

**Website change** (other repository): edit, `npm run check` (lint, typecheck, tests, build), PR into `main`; it
publishes itself after merge.
