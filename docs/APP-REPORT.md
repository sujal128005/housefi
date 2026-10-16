# Customer app (final) and Technician app: report

Status: **customer app finalised and technician app built; tested with unit tests, in the web preview and on the
Android emulator (English and Telugu).** Admin portal: not started (as agreed). Next: the UI redesign you asked for.

Both interfaces live in one app and share one demo backend, the same way they will share the real backend: a
customer's booking is offered to a technician who is online in the technician app; the technician's quote reaches
the customer after an AI price check. When no technician is online, a simulated technician runs the visit, so the
customer app can always be tried on its own.

## What changed in the customer app (from your feedback)

| Request | Done |
|---|---|
| Real 3D icons everywhere, bigger on Home | Microsoft Fluent 3D art (65 images) across all screens; 72-92 px category tiles |
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
| Language from location (coming soon) | Language screen: "Detect from my location" (Kurnool → Telugu; Delhi → Hindi "coming soon", stays English) |
| Sounds and vibration | Synthesised sounds (expo-audio) and haptics at key moments; **Account → Sounds & vibration** turns both off; respects the phone's silent switch |
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
| Unit tests | 68 / 68 passed |
| Typecheck, lint | clean |
| expo-doctor | 21 / 21 |
| Android release build (x86_64) | built |
| Emulator journey, English | **passed**, 47 screenshots in `docs/screens/app/en/` |
| Emulator journey, Telugu | **passed**, 47 screenshots in `docs/screens/app/te/` |
| GitHub Actions CI (Android build + both journeys, iOS simulator build) | see the run for this commit |

Problems found and fixed while testing:

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

## Not real yet (by design in this phase)

Real SMS, payments (Razorpay), push notifications, masked calls, maps / live GPS of the technician, AI models,
ID verification, payouts and the admin / coordinator portal. Each is marked "Demo" or "Soon" in the app, and the
backend package describes how each should be built.
