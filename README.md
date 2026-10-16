# Housefi

Native Android and iOS app for Housefi, a home-services platform with a **Customer** and a **Technician**
interface in one app. This phase is **frontend first**: every backend-dependent feature runs against an in-app demo
backend with clearly labelled synthetic data. Nothing connects to real authentication, SMS, payments or production APIs.

The real backend is being built separately against the contract in `src/services/api.ts`; its starter package is
in [`docs/backend/`](docs/backend/README.md) (answers to the backend team's questions, OpenAPI, database schema,
state machine, starter prompt).

## Stack

| Piece | Choice | Why |
|---|---|---|
| App framework | Expo SDK 57 / React Native 0.86 (TypeScript) | Real native Android and iOS apps (no WebView, no PWA); Expo generates the native projects (`android/`, `ios/` are not committed) |
| Navigation | Expo Router (native stack + tabs) | File-based routes in `src/app` |
| Brand and illustrations | Finalized Housefi logo (`assets/brand`, source of every app icon and the splash); Housefi's own soft-3D illustrations (`assets/illustrations`, 79 rounded-square WebP tiles cut from the generated sheets by `tools/illustrations/cut_tiles.py`); a few code-drawn tiles (Material Design Icons, Apache 2.0) where an illustration is still to come | One look across both apps; 1.4 MB in total |
| Sound & vibration | expo-audio with Kenney "Interface Sounds" (CC0) in `assets/sounds`, expo-haptics | Felt and heard at key moments; one switch turns both off |
| Device | expo-location (address and language from location), expo-image-picker (problem photos) | |
| Fonts | Anek Latin (English) and Anek Telugu (Telugu), one family for both scripts | OFL, bundled |
| Technician ID card | expo-screen-capture (Android secure window, iOS capture protection), react-native-qrcode-svg (QR on the existing SVG library), expo-crypto (random IDs and tokens), expo-image-manipulator (480 px profile photos) | Native protection, no extra servers |
| Storage | AsyncStorage | Demo data and preferences stay on the device |

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
    api.ts        the backend contract the screens use (customer, technician, AI, notifications)
    mock/         the demo backend that implements it (latency, OTP, matching, offers, price check, failures)
    feedback.ts   sounds and vibration
  state/          app state (language, interface, both sessions) and the booking draft
  i18n/           English and Telugu strings and formatting
  ui/             shared components (incl. live alerts for quotes and job offers)
tools/            Android emulator journey driver
docs/             reports, screenshots, backend handoff
```

**Connecting the real backend later:** write an HTTP implementation of `Backend` in `src/services/api.ts` and pass
it to `BackendProvider` in `src/app/_layout.tsx` instead of `createMockBackend`. Screens do not change.

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

End-to-end journey on a running Android emulator, customer and technician (screenshots into `docs/screens/app/`):

```bash
node tools/app-journey.mjs en
node tools/app-journey.mjs te
node tools/recovery-check.mjs   # offline strip and the branded error screen (after a journey)
```

## Trying both interfaces on one phone

Customer and technician use the same demo backend, so a booking made as a customer reaches the technician app:

1. As a customer, book and pay the ₹49 visit fee.
2. **Account → Switch to technician app**, sign in with another number (the code shows on screen), fill the
   profile; it is approved after a few seconds. Go **online**.
3. The booking rings in as a job offer. Accept, start the trip, arrive, get the customer's code (**Demo: get the
   customer's code**), send a quote (e.g. ₹120 labour + ₹200 material).
4. **Profile → Switch to customer app**: the quote pops up after the AI price check. Approve, ask for a lower
   price, or decline; pay online or in cash (the technician confirms cash).

With no technician online, a simulated technician takes the booking and the visit runs by itself
(**Booking status → Demo: simulate outcome** skips ahead). **Home → Try a practice job** gives a technician a
simulated customer.

## Demo mode

- A **DEMO** marker is on every screen; simulated outcomes say so. No money moves, no SMS is sent, nobody visits.
- **Account / Profile → Demo settings**: technician matching (quick, delayed, none), next payment (succeeds,
  pending, fails), extra work during repair, how the practice customer answers a quote, technician profile review
  (approve, or ask for one correction), and forced network / slot-taken failures.
