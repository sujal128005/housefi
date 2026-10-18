# Housefi design system

One system for the customer app, the technician app, and later the web and admin screens. The values live in
`src/theme/tokens.ts` and the shared components in `src/ui/`. A new screen uses these; it does not invent its own.

## Brand

- **Logo**: `assets/brand/housefi-logo.png` (the finalized logo, unchanged). Lock-up: logo → **Housefi** →
  "by Nexara**9**" (9 in gold) → "Home Help, Made Easy." (`BrandLockup` in `src/ui/BrandHero.tsx`).
- **Colours** come from the logo:

| Role | Token | Value | Use |
|---|---|---|---|
| Primary | `navy` | `#0A3CF5` cobalt | Main buttons, selected states, links, hero cards |
| Secondary | `cyan` / `cyanTint` | `#00B2EE` / `#E0F6FE` | Accents, highlights in illustrations and headers |
| Highlight | `amber` / `onAmber` | `#FFB21C` / `#2B1A00` | One standout action per screen at most (AI chip, "Snap a photo") |
| Text | `ink`, `inkMuted`, `inkSubtle` | `#0B1B3F` deep navy … | Headings and body, secondary text, hints |
| Page | `canvas` | `#FAF9F5` warm ivory | Screen background |
| Surface | `surface`, `surfaceMuted` | white, cream | Cards; quiet panels |
| Lines | `line`, `lineStrong` | `#E7E5DE`, `#D2D0C7` | Hairline borders, dividers |
| States | `success`, `warning`, `danger` (+ tints) | | Status pills and banners only |
| Demo | `demo` / `demoTint` | violet | Everything simulated: the DEMO chip, demo banners, simulated results |

- **Gradients** only on: the Home header, primary buttons, hero cards (e.g. today's earnings), the entry wave.
  Never on lists, forms or ordinary cards.

## Type

Anek Latin and Anek Telugu (one family for both scripts). Sizes scale a little with the screen (0.92–1.08); Telugu
gets taller lines.

| Variant | Size / line | Weight | Use |
|---|---|---|---|
| `hero` | 36 / 40 | extra bold | Entry screen, big amounts |
| `title1` | 29 / 34 | bold | Screen titles |
| `title2` | 23 / 28 | bold | Hero states ("Payment successful") |
| `title3` | 19 / 24 | bold | Section titles |
| `body` / `bodyStrong` | 17 / 24 | regular / semibold | Text, row titles |
| `callout` | 16 / 22 | medium | Supporting text under titles |
| `label` | 15 / 20 | semibold | Buttons, chips, field labels |
| `footnote` | 14 / 19 | regular | Secondary lines in rows |
| `caption` | 12.5 / 16 | semibold | Pills, small labels |

## Space, corners, depth

- Spacing scale: 2, 4, 8, 12, 16, 20, 24, 32, 40, 56 (`space.*`). Screen side margin 16 / 20 / 28 by width;
  content column at most 680 pt wide (`src/ui/responsive.ts`).
- Corners: `icon` 12 (40 pt icon chips), `sm` 10, `md` 14 (fields, small cards), `lg` 18 (buttons, cards),
  `xl` 22 (category tiles), `xxl` 28 (hero cards, sheets), `pill`. Circles are half their size.
- Shadows: `card` (resting cards, very soft), `raised` (sheets, pop-ups), `button` (primary button only), `glow`
  (one hero element per screen at most).
- One level of card. A card does not hold another card; inside a card use dividers, rows and tinted panels.

## Pictures and icons

- **3D icons** (`src/illustrations/Art3D.tsx`, files in `assets/icons3d/`): Housefi's 3D icon set, rendered from
  three.js models in the same style, palette and lighting as the Housefi website (glossy soft-3D plastics, the logo's
  cobalt, cyan, orange and yellow). 88 names: categories, the 21 services, steps, payments, states and people (the
  technician avatar wears the cobalt Housefi cap and uniform with the logo). Only this style; no stock icons, emoji or
  other illustration styles next to them.
- **Sizes, by role.** Live and status heroes **132–170 pt** (booking and job status, payment, verification); empty
  states and page heroes **120 pt**; welcome slides fill most of the picture area; feature cards **72–104 pt**;
  category tiles **76 pt** (92 on the large grid); list rows **34–56 pt**; inline **under 32 pt**.
- **96 pt and up** the object floats on the page with its own soft shadow over a pale brand disc. **32–95 pt** it
  sits on the soft brand tile, tinted by meaning (sky = plumbing, amber = electrical and money, mint = AC and done,
  rose = failed…). **Under 32 pt** the same name draws a **simple symbol in a soft blue chip**: small spots are
  functional, not decorative.
- **Live 3D animations** (`src/illustrations/Anim3D.tsx`, sprite sheets in `assets/anim3d/`): the same models in
  motion for the live moments: finding a technician, technician assigned, on the way (the scooter on the tracking
  map), at the door, repair in progress, job done, a job offer ringing. Played on the native thread; still frame with
  reduced motion. New ones: add to `tools/icons3d/src/anims.js` and run `npm run render -- anim_<name>` (writes the
  sheet and `src/illustrations/anim3dSheets.ts`).
- **States** always use the same round badge on the object: green check (done, approved, verified), red cross
  (failed), amber clock (waiting), amber "!" (needs attention).
- **Functional icons** (navigation, actions, row icons): Ionicons, one weight, `ink` / `navy`. Tab bar icons are
  outline when idle, filled when selected.
- Each service shows its own icon where a specific service is meant (`serviceArt(serviceId, …)`); the category's
  icon where only the category is known.
- New icons: model it in `tools/icons3d/src/icons/` (reuse the kit's materials and parts), run
  `cd tools/icons3d && npm install && npm run render -- <name>`, check `tools/icons3d/preview/`, and add one line to
  `ICONS` in `Art3D.tsx`.

## Components

| Need | Use |
|---|---|
| Screen with header and pinned footer | `Screen`, `Header`, `Footer` (`src/ui/Layout.tsx`) |
| Buttons | `Button` variants: `primary` (one per screen), `accent` (amber, rare), `success`, `secondary`, `outline`, `ghost`, `danger` |
| Cards, rows, section titles | `Card`, `ListRow`, `SectionTitle`, `Divider` (`src/ui/Surfaces.tsx`) |
| Status | `Pill`, `StatusPill`, `Banner` (info / success / warning / danger / demo) |
| Loading, empty, errors | `Skeleton`, `EmptyState`, `ErrorView`, `ErrorBanner`, `SessionEnded` (`src/ui/States.tsx`); app and screen errors: `src/ui/Recovery.tsx` |
| Technician identity | `TechPhoto`, `VerificationPill` (the green tick only for a genuine approval), `TechIdCardView` / `IdCardPage` (`src/ui/TechIdentity.tsx`) |
| Sounds and vibration | `feedback('success' | 'notify' | 'offer' | 'cash' | 'error' | 'send' | 'pop' | 'select' | 'tap')` |

## Motion

Short and quiet: 140 / 240 / 420 ms. Screens slide in; illustrations may float gently on hero states.

- **Success** (`Celebrate` in `src/ui/motion.tsx`): the picture pops, a green ring opens and brand-coloured confetti
  flies out once, with the success sound: booking confirmed, payment done, technician verified, job done. The OTP
  boxes turn green before the next screen.
- **Brand water** (`BrandWave`, maths in `src/ui/waveMath.ts`): Gerstner wave layers (crests sharpen, troughs
  flatten, like real water) with the amber crest from the logo, and a perspective mesh of points and lines on the
  water. Runs only while the brand screen shows, pauses in the background.
- Everything that moves stops when the phone asks for reduced motion.

## Sound

One family of soft, glassy tones in E major, Housefi's own (`tools/sounds/make_sounds.py`): success (three rising
notes), notify (two gentle notes), offer (a marimba ring), cash (coin taps), error (two rounded falling notes, never a
buzzer), send, pop. Taps and selections are felt (haptics), not heard.

## Words

Plain, friendly, short. Say what happens next ("We'll notify you"). Anything simulated says so ("Demo", "Simulated
payment. No money was taken."). Never show codes, stack traces or internal IDs to people: whatever goes wrong, the app shows the brand screen with
one Continue button (`src/ui/Recovery.tsx`).
