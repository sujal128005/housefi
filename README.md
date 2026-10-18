# Housefi

Home services in Hyderabad: customers book a verified technician; technicians get jobs, quotes and payouts.
This repository holds both halves. **Keep it private.**

| Folder | What | Start here |
|---|---|---|
| [`app/`](app/) | The Android and iOS app (Expo, React Native): customer and technician in one app | [`app/README.md`](app/README.md) |
| [`backend/`](backend/) | The API server (NestJS, PostgreSQL with PostGIS, Redis), the database schema and migrations (`backend/prisma/`), and the deploy kit | [`backend/README.md`](backend/README.md), then [`backend/docs/DEPLOY.md`](backend/docs/DEPLOY.md) |

The website (housefi.tech, with the payment page `/pay/` and the Technician ID check page `/t/`) is in its own
repository, `sujal128005/housefi-website`, because it publishes itself to GitHub Pages from there.

How they connect: the app calls the API at `https://api.housefi.tech/v1` and opens `https://housefi.tech/pay/` for
Razorpay payments (`app/docs/backend/INTEGRATION.md`). The API contract is `backend/docs/openapi.yaml`; a contract
test keeps it in step with the server.

**Launching:** [`LAUNCH-GUIDE.md`](LAUNCH-GUIDE.md) lists, in order, every account, key and store step.

## Working on it

```bash
# API (details and the no-Docker option: backend/README.md)
cd backend && npm install
npm run setup             # creates .env with local secrets
docker compose up -d      # Postgres + PostGIS, Redis, S3Mock
npm run db:deploy && npm run db:seed && npm run dev

# App against that API
cd app && npm install
EXPO_PUBLIC_HOUSEFI_API_URL=http://localhost:4000/v1 npx expo start
```

Each folder has its own `package.json`, tests and checks (`npm test`, `npm run typecheck`, `npm run lint`). GitHub
runs them on every push that touches the folder (`.github/workflows/app.yml`, `backend.yml`), plus a CodeQL
security scan of both.

Secrets never go in this repository: the server's keys live only in `backend/.env.production` on the server
(`backend/docs/DEPLOY.md` step 4), and the app holds no secrets at all.
