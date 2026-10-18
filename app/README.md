# Housefi

Native Android and iOS app for Housefi, a home-services platform with a **Customer** and a **Technician**
interface in one app. The app talks to the Housefi API (`api.housefi.tech`) for everything: sign-in by SMS code,
bookings, Razorpay payments, live technician location, masked calls, push notifications, Aadhaar QR verification,
AI photo reading and voice notes. It has no built-in demo data.

The API server is in `../backend/` (same repository); its contract is `backend/docs/openapi.yaml`. How the app connects is in
[`docs/backend/INTEGRATION.md`](docs/backend/INTEGRATION.md).

## Stack

| Piece | Choice | Why |
|---|---|---|
| App framework | Expo SDK 57 / React Native 0.86 (TypeScript) | Real native Android and iOS apps (no WebView, no PWA); Expo generates the native projects (`android/`, `ios/` are not committed) |
| Navigation | Expo Router (native stack + tabs) | File-based routes in `src/app` |
| Brand and icons | Finalized Housefi logo (`assets/brand`, source of every app icon and the splash); Housefi's 3D icon set (`assets/icons3d`, 88 transparent WebP icons rendered by `tools/icons3d` from three.js models in the same style as the Housefi website); code-drawn glossy tiles (Material Design Icons, Apache 2.0) only for names without a 3D icon | One look across the app and the website; about 1.8 MB in total |
| Sound & vibration | expo-audio with Housefi's own interface sounds (`assets/sounds`, synthesised by `tools/sounds/make_sounds.py`), expo-haptics | One calm sound family, felt and heard at key moments; one switch turns both off |
| Device | expo-location (address and language from location), expo-image-picker (problem photos) | |
| Fonts | Anek Latin (English) and Anek Telugu (Telugu), one family for both scripts | OFL, bundled |
| Technician ID card | expo-screen-capture (Android secure window, iOS capture protection), react-native-qrcode-svg (QR on the existing SVG library), expo-crypto (random IDs and tokens), expo-image-manipulator (480 px profile photos) | Native protection, no extra servers |
| Live features | expo-web-browser (Razorpay checkout on housefi.tech/pay), react-native-maps (technician on the way), expo-camera (Aadhaar Secure QR), expo-notifications (push, job-offer channel), expo-audio (30 s voice notes), expo-secure-store (sign-in tokens) | |
| Storage | AsyncStorage (preferences, booking draft), Keychain / Keystore (tokens) | |

## How the code is organised

```
src/
  app/            screens (Expo Router)
    (tabs)/       customer: Home, Bookings, Help, Account
    book/         customer booking: snap, problem, voice, photos, address, when, confirm, confirmed
    booking/      booking hub (live), receipt, rating, assigned technician's ID card
    tech/         technician: setup (photo, legal name), verification, (tabs)/ Home, Jobs, Earnings, Profile, offer, job,
                  quote, id-card (My Housefi ID)
    verify/       verification page a Technician ID card's QR code opens
  domain/         types and pure rules (validation, slots, quotes, earnings, lifecycle, language from location,
                  technician identity: ID format and generation, verification display)
  data/           DEMO catalogue, prices and fictional technicians
  services/
    api.ts        the backend contract the screens use (customer, technician, AI, notifications, support)
    http/         the live client (HttpBackend), token vault, uploads, live updates (SSE with polling fallback)
    mock/         an in-memory backend used only by the unit tests
    checkout.ts   Razorpay checkout through housefi.tech/pay
    push.ts, calls.ts, locationReporter.ts
    feedback.ts   sounds and vibration
  state/          app state (language, interface, both sessions) and the booking draft
  i18n/           English and Telugu strings and formatting
  ui/             shared components (incl. live alerts for quotes and job offers)
tools/            Android emulator launch check, 3D icon studio, sound generator
docs/             reports, screenshots, backend handoff
```

## Run it

Requirements: Node 20+, Android SDK with an emulator (and JDK 17), or macOS with Xcode for iOS.

```bash
npm install
npx expo run:android      # builds the native Android app and starts Metro
npx expo run:ios          # macOS only
npm test                  # unit tests
npm run typecheck
npm run lint
```

**Quick, lag-free look in a browser** (review aid only; the product is the native app):

```bash
npx expo start --web
```

then open http://localhost:8081 and use the browser's phone-size view (Chrome DevTools → device toolbar).

Launch check on a running Android emulator with the release build installed (first screens in both languages,
offline strip, no crash; screenshots into `docs/screens/app/launch/`). GitHub runs it on every pull request:

```bash
node tools/launch-check.mjs
```

The full customer + technician journey needs the API (sign-in is by SMS code); it is tested against a local API, see
[`docs/backend/INTEGRATION.md`](docs/backend/INTEGRATION.md).

## Settings (build time)

Set these in `eas.json` (per build profile) or a local `.env`. None of them is secret; secrets live only on the server.

| Variable | Default | What |
|---|---|---|
| `EXPO_PUBLIC_HOUSEFI_API_URL` | `https://api.housefi.tech/v1` | The API. https only (http allowed for `localhost` while developing) |
| `EXPO_PUBLIC_HOUSEFI_CHECKOUT_URL` | `https://housefi.tech/pay/` | The website page that opens Razorpay checkout |
| `EXPO_PUBLIC_HOUSEFI_SUPPORT_PHONE` | none | Customer-care number for the "Call us" buttons (without it, those buttons ask for a call-back) |

`app.json` also holds:

- the Expo project (`owner`, `extra.eas.projectId`), needed for push notifications;
- the Google Maps Android key under the `react-native-maps` plugin: replace `GOOGLE_MAPS_ANDROID_API_KEY` with a key
  restricted to the app's package name and signing certificate (Google Cloud → Maps SDK for Android). iOS uses
  Apple Maps and needs no key.

The Razorpay **key ID** comes from the API with each order; the app holds no payment keys.

## Team demo accounts

Only the phone numbers listed in `DEMO_PHONES` on the server get demo accounts. They sign in with the fixed
`DEMO_OTP_CODE` (no SMS), see a small **Demo account** badge, only ever meet each other, and their payments are
simulated. Every other number is a normal live account. The numbers are kept out of every repository.

To try both sides on one phone: sign in as a customer with one demo number, then **Account → Switch to technician
app** and sign in with the other. Approve the technician profile with `npm run tech -- approve <phone>` in the
backend, go online, and book as the customer.
