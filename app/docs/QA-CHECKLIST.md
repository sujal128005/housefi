# Housefi app: frontend QA checklist (23 October 2026)

A systematic pass over the customer and technician apps: every screen, button, form and workflow, with edge cases
(double taps, slow and missing internet, small old phones, Telugu, duplicate payments). Frontend only: the backend was
not changed.

**How it was tested**
- Automated clicking through the **laptop demo** (`npm run demo`): the real API and database, the app built for the
  browser, both phones at once. Phone sizes 390 × 844 (normal) and 320 × 568 (small/old), English and Telugu.
- **Slow internet**: every API call delayed 1.5–2.5 s. **No server**: every API call refused. **Double taps**: the
  same control pressed twice 80 ms apart (and the keyboard's Done key pressed 2–3 times). Each server request counted.
- **Code review** of every screen for the same risks.
- Results: **Pass**, **Fail → Fixed** (fixed and retested), **Blocked** (cannot run in a browser / needs hardware or a
  live service), **Not tested**.

## Bugs found and fixed

| # | Severity | Bug | Fix | Retest |
|---|---|---|---|---|
| B1 | High | Phone number: pressing the keyboard's Done 3× on a slow network sent **3 SMS codes** (each SMS costs money) | One request at a time (`useSingleFlight`) for Done and the button | Pass: 1 request |
| B2 | High | New address: Done twice on a slow network **saved the address twice** | Same guard on address save | Pass: 1 address |
| B3 | High | **Chat with the technician stayed blank** (no messages, no box); its requests ran in a loop. Cause: the request time-limit wrapper handed out a new `backend.chat` on every read, so the screen restarted on every redraw and threw each answer away. Affected live phones | The wrapper now returns the same copy every time (`services/timeouts.ts`), with a test | Pass: chat works, 1 message per double tap |
| B4 | Medium | "Resend code" (a text link, no double-tap guard) could send two SMS | Same guard | Code + unit test |
| B5 | Medium | Name, coupon (Done key), code check: could send twice from the keyboard / auto-submit | Same guard | Pass (name) / code |
| B6 | Medium | Pay screen opened again for a bill that is **already paid** still offered "Pay ₹…" and gave a confusing error | Shows "Payment successful" (or "pending") for paid / settling bills | Pass: visit fee and final bill |
| B7 | Medium | **Tab labels cut in half** (Home / Bookings / Help / Account, and the technician tabs) on phones without a bottom safe area: older iPhones, Android with on-screen buttons | Tab bar sized for padding + icon + label, fixed label line height | Pass: 8/8 (both apps, 2 sizes, 2 languages) |
| B8 | Medium | Festive banner: the Telugu title collided with the 3D art and "Book now" on small phones, and was cut with "…" | Title kept between art and button, smaller type for long names | Pass (screenshots) |
| B9 | Low | Rating screen opened again for a rated visit showed an empty form; after rating from a direct link the screen stayed | "You have rated this visit" with the stars; after rating, lands on the booking | Pass |
| B10 | Low | App start with no server: only the logo and "Retry", no reason | Two-language line: couldn't connect, check the internet | Pass |
| B11 | Low | Voice note: a quick double tap on the mic could start the recorder twice ("couldn't record") | Same guard | Code review (needs a microphone) |
| B12 | Low | Start code: with 0 tries left the hint fell back to "5 tries allowed" | `??` instead of `||` | Code review |
| B13 | Low | Area dropdown: "Add …" still offered after the 10th locality | Hidden when full | Code review |
| B14 | Low | Address lists (registration): when the list cannot load (no internet, older server) they said "nothing matches" | "Couldn't load the list", Try again, and type the state / district | Pass (fixed in PR #59) |

## Checklist

### Start, sign-in, language

| Item | Result | Notes |
|---|---|---|
| Welcome slides, Skip, Get started | Pass | |
| Language choice (English / Telugu), switch back and forth from Account | Pass | |
| Customer / technician choice | Pass | |
| Phone: invalid numbers (5xxxxxxxxx, short) show "invalid" | Pass | |
| Phone: pasted "+91 98765 00001" formats correctly | Pass | |
| Phone: Done ×3 on slow network | Fail → Fixed (B1) | 1 request |
| Code: wrong code shows "not right, 2 attempts left" and shakes | Pass | |
| Code: correct code signs in (customer → home / name; technician → home) | Pass | |
| Code: Resend double tap | Fail → Fixed (B4) | |
| Code: too many requests for one number | Pass | Server limits it (429); app shows an error |
| Name: blank disables Save; digits only rejected | Pass | |
| Name: Done twice | Fixed (B5) | |
| SMS auto-read, real SMS delivery | Blocked | Needs a phone and MSG91 |
| Session rotation: an old saved session is signed out | Pass | Security behaviour |
| App start with no server | Fail → Fixed (B10) | Retry works once the server is back |

### Customer: home, catalogue, search, help

| Item | Result | Notes |
|---|---|---|
| Home: greeting, address pill, snap card, search, services, top problems, sign-off | Pass | |
| Home festive look: arch, 3D gift + diya, Book now, coupon strip (only with a live HQ coupon) | Pass | Coupon simulated in the demo |
| Festive banner on 320 px and in Telugu | Fail → Fixed (B8) | |
| Bottom tab labels | Fail → Fixed (B7) | |
| Categories, services, service details, Book | Pass | All 6 categories open |
| Search page, Help tab, Legal, unknown page, bad Technician ID link | Pass | No crash text on any of 16 pages |
| Notifications bell | Pass | |
| Snap a photo (AI), camera / gallery | Blocked | Needs a camera |
| Voice ("Tell us instead") | Blocked | Needs a microphone; double-start fixed in code (B11) |

### Customer: addresses

| Item | Result | Notes |
|---|---|---|
| Add address, required fields, PIN validation | Pass | |
| Done twice on slow network | Fail → Fixed (B2) | |
| Use my current location | Blocked | Browser has no map lookup (phone only) |
| Edit / delete address | Not tested | Code reviewed: delete asks to confirm |

### Customer: booking and payment

| Item | Result | Notes |
|---|---|---|
| Problem → address → time (instant / schedule) → confirm | Pass | |
| Confirm & pay tapped 3× on a slow network | Pass | **1 booking, 1 payment** |
| Visit fee paid → confirmed → tracking | Pass | Demo payments are simulated |
| Searching → technician assigned → on the way → arrived (start code shown) | Pass | |
| Quote ready sheet → Review & approve (double tap) | Pass | 1 answer |
| Extra work approve (double tap) | Pass | 1 answer; total ₹300 + ₹150 = ₹450 correct |
| Pay the bill online (double tap) | Pass | 1 payment |
| Pay the bill in cash; technician confirms; customer screen updates by itself | Pass | |
| Pay screen opened again for a paid bill | Fail → Fixed (B6) | |
| Coupon on the bill: invalid code, Done twice | Not tested in browser | Guard added (B5); coupon box is on the booking page |
| Real Razorpay checkout (UPI app, card page, return to app) | Blocked | Needs a phone and Razorpay test keys |
| Cancel while searching, with a reason, double tap | Pass | 1 cancel, "Booking cancelled" |
| Change time / reschedule, warranty revisit, invoice | Not tested | |
| Rate (Yes/No + stars required, double submit) | Pass | 1 rating |
| Rate screen for a rated visit / after a direct link | Fail → Fixed (B9) | |
| Chat with the technician (double send) | Fail → Fixed (B3) | Was blank |
| Chat photos | Blocked | Needs a camera / gallery |
| Support chat (AI), suggestions | Pass | Chips scroll sideways on small phones (by design) |
| Masked call to the technician | Blocked | Needs Exotel |

### Customer: account

| Item | Result | Notes |
|---|---|---|
| Account page, edit name, saved addresses, language, sounds switch | Pass | |
| Sign out, delete account | Not tested | Destructive; code reviewed (confirmation sheet) |

### Technician

| Item | Result | Notes |
|---|---|---|
| Home, jobs, earnings, profile, payout, ID card, verification, Aadhaar, edit profile: open without errors | Pass | 9 pages |
| Online switch double tap on slow network | Pass | 1 request |
| Offer arrives by itself; accept double tap | Pass | 1 accept |
| Reject: reason sheet, Reject / Back | Pass (sheet) | Reject request itself not run (offer expired) |
| Start trip, arrived (double taps) | Pass | 1 each |
| Start code: wrong code message and tries left; correct code checks itself | Pass | Hint at 0 tries fixed (B12) |
| Quote: requires "what did you find"; zero price refused; send double tap | Pass | 1 quote |
| Start work, extra work, complete (confirmation sheet, double tap) | Pass | 1 each |
| Cash received (confirmation sheet, double tap) | Pass | 1 confirm |
| Payout details: account numbers must match, IFSC format, save double tap | Pass | 1 save |
| Registration area: state → district → localities → PIN, type to search, Add, PIN check | Pass | Tested in PR #59 |
| Registration area when the list cannot load | Fail → Fixed (B14) | PR #59 |
| Use my location (registration) | Blocked | Phone map lookup needed; server tests pass |
| Aadhaar QR scan, profile photo | Blocked | Needs a camera |
| Keypad phone (IVR) flows, push notifications, background location | Blocked | Needs Exotel / a phone |
| Small phone + Telugu: home, jobs, earnings, profile, payout, edit profile | Pass | Banner fixed (B8) |

### Network and devices

| Item | Result | Notes |
|---|---|---|
| Slow network on sign-in, address, booking, payment, online switch, payout | Pass | After fixes |
| No server at start | Fixed (B10) | |
| Phone offline strip (NetInfo) | Blocked | The browser stays "online"; phone only |
| Android back button, app in background and back, deep links, very old Android versions | Blocked | Needs a phone build (APK) |
| iOS: Expo Go on the owner's iPhone | Not tested here | Owner to check after the server update |

## Not covered by this pass
- The Housefi HQ admin portal (separate website).
- Anything that needs a real phone, camera, microphone, SMS, Razorpay checkout, Exotel calls or push notifications:
  test on a preview APK and the iPhone.
