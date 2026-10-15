# Path 1 — Customer: language selection to technician assignment

Status: **implemented and tested on Android; ready for review.** Path 2 has not been started.

## What was built

A fresh native app (Expo SDK 57 / React Native 0.86, TypeScript) in this repository. One app with an interface
chooser; the Customer interface is complete for Path 1, the Technician interface shows a clear "coming in Path 3"
screen. Every backend-dependent feature runs against the in-app **demo backend** (`src/services/mock`), behind the
contract in `src/services/api.ts`, so the real backend can replace it without changing screens.

| # | Screen / state | Route |
|---|---|---|
| 1 | Welcome (3 slides, skip) | `/welcome` |
| 2 | Language: English / తెలుగు (switches the whole app instantly; changeable from Account) | `/language` |
| 3 | Interface chooser: customer / technician | `/role` |
| 4 | Technician placeholder (Path 3), switch back or change language | `/technician` |
| 5 | Mobile number sign-in / sign-up (+91 validation, Google/Apple marked "Soon") | `/auth/phone` |
| 6 | 6-digit code with labelled "Demo SMS", Fill, resend timer, wrong / expired / locked states | `/auth/otp` |
| 7 | Name (first sign-in only; also "Edit name" from Account) | `/auth/name` |
| 8 | Home: greeting, location, search, active booking, hero, categories, trust points, popular | `/home` |
| 9 | Search (English and Telugu words, issues; empty state) | `/search` |
| 10 | All services, category, service details (visit fee, what's included, issues) | `/services`, `/category/[id]`, `/service/[id]` |
| 11 | Step 1 — describe the problem: issue chips, voice note, photos, note | `/book/issue` |
| 12 | Voice note (simulated recording, waveform, playback, sample transcript) | `/book/voice` |
| 13 | Photos (simulated camera / gallery with labelled sample photos, max 4, remove) | `/book/photos` |
| 14 | Step 2 — check the problem (edit any part) | `/book/summary` |
| 15 | Step 3 — address: saved list or add new (validation, demo service area) | `/book/address`, `/address/edit` |
| 16 | Step 4 — date strip and 2-hour windows (closed / full slots) | `/book/schedule` |
| 17 | Step 5 — review: summary, price details, conditions, confirm (submitting overlay) | `/book/review` |
| 18 | Booking request received (booking ID, demo notice) | `/book/confirmed` |
| 19 | Booking status: finding technician → still searching → technician assigned / no technician; change time; cancel with reason; demo "simulate outcome" | `/booking/[id]` |
| 20 | Bookings (Active / Past, empty states), Help (FAQ), Account (addresses, language, demo settings, switch interface, sign out) | tabs |
| 21 | Demo settings: matching outcome (quick / slow / none), fail next request, slot just filled, reset demo data | `/demo` |

Honesty rules applied: the **DEMO** marker is on every screen; the booking is a "request received", never a real
booking; the technician is a "demo technician … simulated"; Call / Message / Add to calendar / current location /
Google / Apple / contact support open a "Not available in demo" explanation; prices say "Demo prices, not final".

## Design system (from the reference screenshots)

Deep navy primary buttons, royal blue for selection and links, green only for success and assignment, warm
orange and yellow inside illustrations, pastel washes (lavender, peach, mint, sky) that fade into an off-white page,
white rounded cards with soft shadows, large bold headings (Plus Jakarta Sans; Noto Sans Telugu for Telugu with
taller line height and no negative tracking). Illustrations are vector "3D toy" art drawn in code: the Housefi
technician mascot (wave / wrench / thumbs-up / toolbox poses), house, globe, phone, calendar, map search, scooter,
clock, box, map pin, six category objects and four sample photos. Tokens: `src/theme/tokens.ts`.

## How it was tested

- `npm run typecheck`: clean.
- `npm test`: 33 unit tests (validation, slots, search, matching timeline, Indian rupee formatting, Telugu window
  wording, Telugu covers every English key with the same placeholders, demo backend: OTP attempts / lock / expiry,
  sign-up vs returning, addresses, booking create / match / delay / unfulfilled / reschedule / cancel, simulated
  failures, persistence).
- `npx expo-doctor`: 21/21.
- **Android emulator (Pixel, API 36), native build**, driven end to end by `tools/path1-journey.mjs`:
  English **passed** (40 screenshots) and Telugu **passed** (40 screenshots): fresh install → welcome → language →
  customer → wrong phone / wrong code → sign-up → demo settings → home → search → category → service → issue
  (chip, voice, 2 photos) → summary → address validation errors → new address → schedule → review → confirm →
  finding technician → still searching → technician assigned → home with active booking → bookings → account.
- Edge states journey `tools/path1-states.mjs` **passed** (15 screenshots): technician placeholder and switching
  back, empty bookings, search with no results, simulated network error + retry, PIN outside the service area,
  "slot just filled" on confirm + choosing another time, no technician found, reschedule (matching restarts),
  cancel with a reason, cancelled booking under Past.
- Screenshots (downscaled JPEGs): `docs/screens/path1/en`, `docs/screens/path1/te`, `docs/screens/path1/states`.

## Bugs found by testing and fixed

1. Address step looped forever when the customer had no saved address (unstable setter + no-op update).
2. Press animation wrapper swallowed flex styles (unequal cards, short "Book now").
3. Tab bar sat under the gesture bar with labels cut off.
4. Scrolled Home content ran under the status bar.
5. Pastel washes ended in a hard line.
6. Booking draft was cleared before navigation could leave the booking steps.
7. Signed-out screens could crash during sign-out.
8. Address card nested one button inside another (screen-reader and web problem).
9. List screens fired a second request on first show, which hid a failed load behind a later success.
10. "Slot just filled" appeared below the fold on Review; the error and "Choose another time" now sit in the
    pinned footer above Confirm.

## Not done / open

- **iOS has not been run**: there is no Mac here. The CI workflow (`.github/workflows/ci.yml`) builds the iOS
  simulator app on a macOS runner and captures a launch screenshot, but it only runs once the code is pushed.
- Telugu text is written in simple everyday Telugu and **needs a native-speaker review**.
- Illustrations are first-pass vector art; real 3D renders can replace them through `src/illustrations`.
- Real microphone, camera, maps, calendar, calls and payments are intentionally not connected (demo phase).
- Tested on one emulator size (1080×2400). Small phones, tablets and very large system font sizes were not checked yet.
- The debug build is slow on this emulator; the release APK is much smoother. A browser preview
  (`npx expo start`, then open http://localhost:8081) is available for quick visual review only. It is not the
  product, and a few native details (haptics, keyboard behaviour, fonts' exact metrics) differ there.

## Next

Path 2 (customer: technician assigned → completed service, quote, payment, rating) after your review and approval.
