# Housefi

Native Android and iOS app for Housefi, a home-services platform with a **Customer** and a **Technician**
interface. This phase is **frontend first**: every backend-dependent feature runs against an in-app demo backend
with clearly labelled synthetic data. Nothing connects to real authentication, SMS, payments or production APIs.

## Stack

| Piece | Choice | Why |
|---|---|---|
| App framework | Expo SDK 57 / React Native 0.86 (TypeScript) | Real native Android and iOS apps (no WebView, no PWA); Expo generates the native projects (`android/`, `ios/` are not committed) |
| Navigation | Expo Router (native stack + tabs) | File-based routes in `src/app` |
| Illustrations | Vector art in `src/illustrations` (react-native-svg) | 3D-style gradient art without image assets; real renders can replace them later |
| Fonts | Plus Jakarta Sans (English), Noto Sans Telugu (Telugu) | Both OFL, bundled |
| Icons | Ionicons (`@expo/vector-icons`) | |
| Storage | AsyncStorage | Demo data and preferences stay on the device |

## How the code is organised

```
src/
  app/            screens (Expo Router). (tabs)/ = Home, Bookings, Help, Account; book/ = booking steps
  domain/         types and pure rules (validation, slots, search, matching timeline)
  data/           DEMO catalogue, prices and fictional technicians
  services/
    api.ts        the backend contract the screens use
    mock/         the demo backend that implements it (latency, OTP, matching, failure injection)
  state/          app state (language, interface, session) and the booking draft
  i18n/           English and Telugu strings and formatting
  theme/          design tokens and fonts
  ui/             shared components
  illustrations/  vector illustrations (mascot, scenes, category art)
tools/            Android emulator journey driver
docs/             path reports and screenshots
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
```

End-to-end journey on a running Android emulator (takes screenshots into `docs/screens/`):

```bash
node tools/path1-journey.mjs en
node tools/path1-journey.mjs te
```

## Demo mode

- A **DEMO** marker is on every screen; simulated outcomes say so.
- Sign-in codes appear in a "Demo SMS" card on the code screen. No SMS is sent.
- **Account → Demo settings** chooses the technician matching outcome (quick, delayed, none) and can make the
  next request fail (network error, or the time slot filling up) to show error handling.
- **Booking status → Demo: simulate outcome** jumps a booking to assigned, delayed or no technician.
