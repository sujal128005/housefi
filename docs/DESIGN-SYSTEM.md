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

- **Illustrations** (`src/illustrations/Art3D.tsx`, files in `assets/illustrations/`): Housefi's soft-3D tiles,
  for categories, services, steps, states, people, empty and error screens. Sizes 40 pt and up. Only this style;
  no stock icons, emoji or other illustration styles next to them.
- Under 32 pt the same name draws a **simple symbol in a soft blue chip** automatically: small spots are
  functional, not decorative.
- **Functional icons** (navigation, actions, row icons): Ionicons, one weight, `ink` / `navy`. Tab bar icons are
  outline when idle, filled when selected.
- Each service shows its own illustration where a specific service is meant (`serviceArt(serviceId, …)`); the
  category's illustration where only the category is known.
- New illustrations: add the sheet tile in `tools/illustrations/cut_tiles.py` (MAP), run it, add one line to `IMG`.

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

Short and quiet: 140 / 240 / 420 ms. Screens slide in; success pops once; illustrations may float gently on hero
states. Everything that moves stops when the phone asks for reduced motion.

## Words

Plain, friendly, short. Say what happens next ("We'll notify you"). Anything simulated says so ("Demo", "Simulated
payment. No money was taken."). Never show codes, stack traces or internal IDs to people.
