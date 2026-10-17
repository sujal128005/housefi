# Customer app (final) and Technician app: report

Status: **customer and technician apps built, redesigned on the finalized Housefi logo, with branded error and
offline handling, the technician identity feature (photo, permanent ID, digital ID card, QR verification) and one
written design system (`docs/DESIGN-SYSTEM.md`); tested with unit tests and on the Android emulator (English and
Telugu).** Admin portal: not started (as agreed). Your soft-3D illustrations are in the app (79 of them); the few
still to generate are listed under "Illustrations still to generate".

Both interfaces live in one app and share one demo backend, the same way they will share the real backend: a
customer's booking is offered to a technician who is online in the technician app; the technician's quote reaches
the customer after an AI price check. When no technician is online, a simulated technician runs the visit, so the
customer app can always be tried on its own.

## Redesign (this round)

| Request | Done |
|---|---|
| Finalized logo as the single source of the brand | Your PNG is kept as-is in `assets/brand/` (proportions untouched; only the white outside the rounded tile is made transparent). Every app icon is generated from it: iOS icon, Android adaptive icon (foreground at 70% so circle, squircle and square masks never clip the house, background in the logo's own blue), monochrome icon, splash, favicon, and the logo in headers |
| Entry screen | Logo → **Housefi** (large, bold) → "by Nexara**9**" (9 in golden yellow) → "Home Help, Made Easy." with a soft gradient wave rising from the bottom-left in the logo's blues and a thin amber line |
| Theme from the logo | Cobalt blue primary, cyan secondary, amber/orange highlights, ivory and white surfaces, deep navy text. Gradients only where they matter (Home header, main buttons, hero cards) |
| Eye-catching icons instead of "3D keyboard" emoji | Your generated soft-3D illustrations: the 6 categories; each of the 21 services (tap, leak, drain, tank, fan, switch, wiring, light, AC service and repair, washer, fridge, RO, geyser, bathroom, kitchen, sofa, door, furniture, fittings) in booking cards, Confirm & pay, Home's top problems and the technician's jobs; every booking step (finding, assigned, on the way, arrived, inspecting, quote, repair, extra materials, payment, done); payment states (secure, success, pending, failed, cash, receipt); technician verification (pending, approved, needs correction), job offer, start code, earnings, trophy; technician and customer characters; language, OTP, photo, AI scan, voice, map, schedule; empty and no-results states. Each is cut into a rounded tile by `tools/illustrations/cut_tiles.py` |
| Fonts | Anek Latin and Anek Telugu: one modern family for both scripts |
| Better sounds | New interface sounds (Kenney, CC0, free for commercial use): confirm, notification, job-offer ring, cash, error, send, tap |
| All phones to tablets | Content is a centred column (max 680 pt), side margins and text size adjust to the screen, grids go from 3 to 4 columns on wide screens; iPad support on |

## Error handling, offline and recovery (this round)

| Situation | What people see |
|---|---|
| App can't start (storage or sign-in check fails) | Branded screen (logo, "Housefi by Nexara9", tagline), a friendly line in English and Telugu, **Retry**. A slow start shows the same screen with a loader after 10 s instead of a frozen splash |
| An unexpected error inside a screen | Branded "Something went wrong · your bookings and details are safe" in place of that screen only, with **Try again** (re-opens the same screen; the screens behind it and the tab bar stay) and **Go to home**. No code, stack trace or red developer screen in the release app; errors outside screens get the same screen |
| Phone offline | A strip at the top, "You're offline · we'll keep what you've entered", over the current screen (nothing is reset); "Back online" when it returns |
| A request fails | The screen stays with what it had; a message with **Retry**. Retrying Confirm & pay reuses the booking already created (no second booking), buttons lock while a request runs, and a booking that is already paid refuses a second payment. The real backend adds `Idempotency-Key` on booking and payment creation (in the backend contract) |
| Session ended | "Your session has ended" with **Sign in again**; the booking draft is kept. If the sign-in check can't reach the server at start, the saved sign-in is kept and Retry is offered (it no longer signs people out) |
| Loading | Skeletons and the branded loader, never a blank screen |
| Try it | Account / Profile → Demo settings → **Test the error screen** |

## Technician identity, photo, permanent ID and digital ID card (this round)

**Fully implemented in the app and the demo backend** (the demo backend stands in for the authoritative data layer;
16 tests in `src/__tests__/identity.test.ts`):

| Requirement | What the app does |
|---|---|
| Mandatory photo | Registration needs a profile photo: **Take a photo** (front camera, square crop) or **Upload**; shrunk to a 480 px JPEG. The demo also offers a labelled sample photo ("Sample photo (demo), not a real person"). No photo, no submit; the backend refuses it too |
| Photo can't be replaced | After the first submission the photo and legal name are read-only (Edit profile shows them locked). The backend rejects a different name (`IDENTITY_LOCKED`) and ignores a new photo. Corrections: **Profile → Request a correction** (name or photo, with a note) |
| Photo pending | Until verification is approved the photo is "under review" on the technician's card, and customers never get an unapproved photo |
| Three read-only fields | Profile → **Identity**: full legal name, identity verification status, Housefi Technician ID. Plain text, not inputs |
| Technician ID `N9-HF-T-XXXXXX` | Issued by the backend at the first submission: 6 characters from 31 unambiguous ones (no 0/O/1/I/L), drawn from the phone's cryptographic random source by rejection sampling; checked against a register of every ID ever issued (never reused). Not built from name, phone or a counter, and never used to sign in or to look anything up |
| My Housefi ID | Profile → **My Housefi ID**: Housefi header with the logo and Nexara9, photo, legal name, role and skills, the full ID, the verification status, a QR code, and a live watermark (Housefi, the ID, the time) |
| Customer view | On the booking, the assigned technician's photo, name, rating and **identity status**; tapping the photo, the name or **View Technician ID** opens the same card read-only. The backend answers only for the customer's own booking with a technician assigned (anyone else: not found) |
| QR code | Points at Housefi's verification page with a random 24-character token (no personal data). In the demo it opens `housefi://verify/<token>`, a page inside the app, and the card says so ("Demo QR"). The page shows photo, first name and initial, ID, **Active / Not active** right now, and the status time |
| Verification states | Pending, Approved, Needs correction, Rejected, Suspended, the same everywhere (registration, profile, card, verification page, customer booking). Only a genuine approval shows the green **Verified** tick; the demo's approval shows **Demo verification · simulated, not verified**. Rejected or suspended technicians can't go online, see "Your access is paused", and customers see the withdrawn status at once. Demo settings → **Suspend this technician** shows it |
| No copy / share / save | The card has no such actions; text is not selectable; nothing about the card is logged or put on the clipboard |
| Capture protection | Native (`expo-screen-capture`), on only while the card is on screen. Android: secure window (FLAG_SECURE), verified on the emulator. iOS (16.4+, not yet tested on an iPhone): a screenshot is still saved but the app area comes out blank, and the app says it couldn't be captured; while the phone is recorded or mirrored (screen recording, AirPlay, QuickTime) the card is covered in black, on the phone too; the app-switcher preview is blurred. If switching protection on fails, the app retries instead of silently leaving the card unprotected |

**Checked on the Android emulator:** the journey registers with a photo, reads the Technician ID from Profile and checks
its format, opens My Housefi ID (same ID, demo status), opens the verification page from the card (Active), and opens
the technician's card from the customer's booking. On both card screens the journey asserts that the window manager
reports **FLAG_SECURE** for the app's window and that a screenshot is empty or one flat colour (decoded pixel by
pixel). After leaving the card it checks the opposite as a control: FLAG_SECURE is off and a screenshot shows real
content, so the blank result can't come from a device that always captures black. The checks themselves were tested
both ways (real screens are detected as content; the flag reads off on other screens).

**Depends on the real backend and an admin tool (not built in this phase):** genuine identity checks (document upload
is still "Soon"), photo approval by a reviewer, deciding correction requests, rejecting / suspending, the public
verification web page on a Housefi domain, storing photos in a private bucket. The backend package (`docs/backend`)
specifies all of it: endpoints, schema with database-level locks on the identity columns, the ID register, hashed QR
tokens.

**Platform limits (stated honestly):** nothing stops someone photographing the screen with another camera, which is why
the card carries a live watermark and the QR shows the current status. On iOS the protection has **not been tried
on an iPhone or simulator yet**: CI builds the iOS app but does not drive these screens, so the iOS behaviour above is
read from the installed `expo-screen-capture` 57.0.4 native code, not from a test. iOS can't refuse a screenshot: the
picture is still saved, with the app area blank, and the app tells the person afterwards; a screen recording gets no
message. The screenshot blocking relies on an undocumented iOS behaviour, so a future iOS update could weaken it.
Simulator screenshots in CI would not show the protection either (they read the screen image directly), so the check
is a short manual checklist on a real iPhone; see "iOS verification" below. The web preview has no capture
protection (browsers don't offer it); the card there is for review only.

**iOS verification (manual, about 10 minutes on a TestFlight or development build):**
1. On My Housefi ID take a screenshot: the "can't be captured" message appears and the saved image is blank where
   the app is. Back on Profile, a screenshot shows normal content.
2. Start a Control Center screen recording on Profile, then open the card: the phone shows black; go back and content
   returns. The recording is black while the card was shown.
3. Mirror with AirPlay or QuickTime: the card is black on both screens.
4. Swipe up to the app switcher from the card: the preview is blurred; reopen and the card is sharp.
5. From the card open the verification page: a screenshot there is normal; go back and a screenshot is blank again.
6. Send the app to the background on the card and reopen: still protected.
7. Repeat 1 and 2 on the customer's Technician ID.
8. On an iPad, rotate or resize (Stage Manager) on the card: it still shows fully and a screenshot is still blank.

## What changed in the customer app (from your feedback)

| Request | Done |
|---|---|
| Real 3D icons everywhere, bigger on Home | Now your own soft-3D illustrations (see Redesign) |
| Clearer interface choice | "Continue as": **Book a home service** / **Work as a technician** |
| Scooter animation when assigned | Scooter rides in from the left on "Technician assigned" (customer) and on the technician's job screen |
| Shorter flow | Home → How can we help (photos, tap-to-speak with AI note, own note) → Address (or current location) → When (**Now** or **Schedule**) → Confirm & pay → done |
| Snap a photo, AI picks the service | "Snap the problem" on Home; sample photos get a suggestion, real photos get the closest options (demo AI) |
| Top problems by locality (AI) | "Top problems near you": AI-ranked top 6 for the saved address's PIN code, with weekly counts |
| Remove "Why Housefi" and "Popular right now" | Removed |
| ₹49 visit fee in advance; repair decided by the technician after the visit (min ₹100) | Confirm & pay shows ₹49 now and "Decided by the technician after the visit · min. ₹100"; "from ₹X" removed everywhere |
| Technician enters repair + material (e.g. 120 + 200); AI checks; customer sees the same amounts in a pop-up | Technician quote builder → AI price check (fair / sent to a reviewer) → pop-up anywhere in the customer app with repair, materials and total → Approve / **Ask for a lower price** / Don't repair |
| OTP for the technician on arrival + technician details after payment | 4-digit arrival code after payment; technician card (rating, jobs, experience, vehicle, verified, masked call) |
| "Rated highly by women" preference | Optional toggle on Confirm & pay; matching tries those technicians first |
| Proper tracking | Live progress, animated map with ETA, arrival, inspection, quote, repair, payment |
| AI support chat, then customer care | Help → AI chat (demo, rule-based) with "Talk to a person" hand-off |
| After the job: Satisfied? Yes / No | Rating starts with "Were you satisfied with the work?" Yes / No, then stars and tags |
| "Are you a woman?" on the rating | Optional checkbox **I'm a woman**, unticked by default, with a note that it stays private. It feeds the technician's **Rated highly by women** badge (and the "Prefer technicians rated highly by women" option): average 4.5+ stars from women; one such rating in the demo, at least 5 on the real backend. Never shown to anyone |
| Language from location (coming soon) | Language screen: "Detect from my location" (Kurnool → Telugu; Delhi → Hindi "coming soon", stays English) |
| Sounds and vibration | Interface sounds (expo-audio) and haptics at key moments; **Account → Sounds & vibration** turns both off; respects the phone's silent switch |
| Notifications | Bell on Home with an inbox (assigned, on the way, arrived, quote ready, payment due, completed...) and live toasts |
| Cash | Cash is confirmed by the technician in their app (no more instant "paid") |

## Technician app (new)

| Screen | What it does |
|---|---|
| Sign-in | Same phone + code flow, separate technician account ("Technician sign-in") |
| Profile setup | Name, gender, experience, skills (3D tiles), city, PIN, areas, vehicle; ID upload marked "coming soon" |
| Verification | Pending → Approved / Needs correction (with the note); checks automatically |
| Home | Online / offline switch, today's and total earnings, the **one next action** for the current job, "Waiting for new jobs" with a practice-job button (demo), today's jobs, notifications |
| Job offer | Rings and vibrates; countdown; service, problem, **area only**, distance, time, visit earning; Accept / Reject with reason; "Offer expired" |
| Job | Stepper Accept → Go → Start → Quote → Repair → Done; one main button per step: Start trip, I've arrived, enter the customer's code (5 tries, then locked), Prepare quote, wait for approval / Revise, Start repair, extra materials, Complete, Cash received; job summary with earning; directions in Maps; masked call; report a problem (customer unavailable, wrong address, can't complete, unsafe, payment, other) |
| Quote builder | Labour and material lines, quantity, price, common items for the job, live totals, minimum ₹100, usual range and a live AI check |
| Jobs | Active / past |
| Earnings | Today, total, waiting for payout, next Monday payout, per-job earnings, how earnings work (₹30 per visit, 80% of labour, materials in full) |
| Profile | Verification, rating, skills, area, edit (re-verification), language, sounds & vibration, partner support, demo settings, switch to customer app, sign out |

Every situation from your list is covered: no job ("Waiting for new jobs"), offer expires, customer unavailable,
wrong address, invalid start code, customer rejects / asks for a lower price, extra materials, work cannot be
completed, payment pending / failed / cash.

## Backend team

`docs/backend/` (and the zip sent separately): answers to all 12 questions, OpenAPI contract (validated), PostgreSQL
schema, state machine, `.env.example`, sample JSON, a starter prompt for their Claude Code, and the app's contract
files. The app's demo backend implements the same contract and is their working reference.

## Testing

- **Unit tests: 68 passing** (`npx jest`): validation, slots, quote rules, AI price check, earnings, payout date,
  language from location, demo auth, addresses, bookings (payment success / pending / failure, matching scenarios,
  quotes, extra work, cancellation and refunds, reschedule, closed slots, instant hours), and the technician app end
  to end (sign-up and verification, a real customer booking offered → accepted → trip → wrong and right start code
  → ₹120 + ₹200 quote → AI check → customer asks for a lower price → revised quote → approve → repair → cash →
  earnings ₹310), offer missed / rejected → reassigned, privacy between accounts, cancellation notice, reviewer
  path for high quotes, practice job, locality top problems.
- **Typecheck, lint, expo-doctor**: clean (21/21).
- **Web preview (localhost)**: both apps walked through end to end, including the cross-app flow on one device.
- **Android emulator (release build, Pixel API 36)**: `tools/app-journey.mjs` drives the customer and technician
  journeys and saves screenshots to `docs/screens/app/<language>/`. Result: see below.

### Results

| Check | Result |
| --- | --- |
| Unit tests | 85 / 85 passed (16 new for technician identity, 1 for women's ratings) |
| Typecheck, lint | clean |
| expo-doctor | 21 / 21 |
| Android release build (x86_64) | built |
| Emulator journey, English | **passed**, 54 screenshots in `docs/screens/app/en/`, now including the profile photo, the Technician ID format check, both ID cards (screenshots blank: blocked by Android's secure window, asserted), the verification page and "I'm a woman" on the rating |
| Emulator journey, Telugu | **passed**, 54 screenshots in `docs/screens/app/te/` (same checks as English) |
| Error handling on the emulator (`tools/recovery-check.mjs`) | **passed**: Wi-Fi and data off → offline strip over the current screen, back on → "Back online"; branded error screen with no technical text; Try again re-opens the same screen; Go to home goes home. Screenshots in `docs/screens/app/recovery/` |
| GitHub Actions CI | **all green** on `c870b48` (run 38984534001): typecheck, 85 tests, expo-doctor; Android release build with both journeys (English, Telugu) and the error check on an Android 14 emulator; iOS simulator build. The earlier Android failures were the test driver (a number pad that stays open after ESCAPE on Android 14), not the app |

Problems found and fixed while testing:

- This round: blocking Android's `DETECT_SCREEN_CAPTURE` permission made the app crash at start (the screen-capture
  module registers its callback on Android 14+). It is an install-time permission with no privacy cost, so it stays;
  `READ_MEDIA_IMAGES` and `RECORD_AUDIO` (not needed) are removed.
- This round: the verification page showed a stale status (it read the technician before the pending review was
  applied); found by a test, fixed.
- This round: on the card, "Open the verification page" sat exactly where the "My Housefi ID" row was on the
  previous screen, so a carried-over tap could open it. The link now ignores taps for 0.7 s after the card appears.
- This round: the verification screen said "You're verified!" for the demo's simulated approval, and the approval
  notification said "You're verified". Both now say it is a simulated demo approval.

- This round: if the sign-in check at start failed for a network reason, the app treated it as "signed out" and
  dropped the saved sign-in. Now only a session the server says has ended signs people out; a failed check shows
  the branded Retry screen.
- This round: "Try again" on the error screen restarted the whole app at its first screen. Each screen now has
  its own boundary, so Try again re-opens just that screen.
- This round: on Home, content scrolled under the transparent status bar (clock over text). A soft ivory strip now
  fades in behind the status bar as you scroll.

- The quote showed "Waiting for the customer" while the AI was still checking it; the cash step showed a raw
  "{amount}"; "1 jobs today"; the language-detect message talked about typing an address. Fixed.
- The repair-price row on Confirm & pay squeezed out its label on phones. Fixed (wraps beside the label).
- "Start trip" opened Google Maps automatically and took the technician out of the app; now Start trip only starts
  the trip and **Open directions** is a separate button.
- Countdowns updated every second even with "reduce motion" on; they now update every 5 s in that mode (calmer,
  and lets automated checks read the screen).
- After adding the audio package, a second copy of `expo-asset` broke the web bundle (black screen on localhost);
  fixed by installing the SDK-matched version. Metro now ignores native build folders, so the web preview no longer
  stalls during an Android build.

## Illustrations still to generate

Reviewed against every place the app draws a picture (anything under 32 pt is drawn as a simple symbol, so it
needs no illustration). Four spots still show the earlier code-drawn tile:

| Name | Where it appears (size) | What to generate, or an existing tile that would do |
|---|---|---|
| AI assistant | Help tab header (104 pt), support chat header (72), booking screen "Need help?" row (40), technician job while the AI checks a quote (104, two states) | A friendly AI helper (chat bubble with a sparkle, cobalt and cyan). Stopgap: the chat-bubbles tile already generated ("3D Home Services App Icon Grid", tile 5 counting from 1) |
| SOS / safety | Safety button on the booking screen (34) and its SOS sheet (56); technician job "report a problem" row (36) | A calm red-and-white beacon or shield marked "SOS". Stopgap: the orange warning triangle ("Pastel 3D UI Illustration Tile Set", tile 9) |
| Technician offline | Technician Home while offline (90) | The technician resting with a moon, or a phone with a pause badge. No existing tile fits |
| Satisfied? Yes / No | Rating screen: both buttons (64); "No" is currently the same thumbs-up turned upside down | A **thumbs up** and a separate **thumbs down** in the same style. Stopgap for Yes: the technician thumbs-up with a medal ("Friendly Home Services Character Set", tile 6) |

Not needed after all: morning / afternoon / evening (shown at 22 pt as simple symbols). Optional polish: the language
globe already uses your illustration, but its letters are A, अ and 文; a version with **A** and **తె** (Telugu)
would fit the app better.

Also found in the review: the small "badge" pictures (e.g. a toolbox next to the technician) are not drawn on top of
illustrations, so three of them never appear; "no technician found" uses the same hourglass picture as "waiting"; and
one cut tile (`refund`, 14 KB) is not used yet.

## Not real yet (by design in this phase)

Real SMS, payments (Razorpay), push notifications, masked calls, maps / live GPS of the technician, AI models,
ID verification, payouts and the admin / coordinator portal. Each is marked "Demo" or "Soon" in the app, and the
backend package describes how each should be built.
