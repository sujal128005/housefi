// DEMO CATALOG: synthetic categories, services, prices and ratings for the frontend-first phase. Not real prices or
// reviews. The mock backend serves this; the real backend will replace it.
import type { Category, Issue, QuoteLine, Service, Technician } from '../domain/types';
import type { Localized } from '../i18n/format';

export const CATEGORIES: readonly Category[] = [
  { id: 'PLUMBING', name: { en: 'Plumbing', te: 'ప్లంబింగ్' }, tagline: { en: 'Taps, leaks, drains', te: 'కుళాయిలు, లీకేజీలు, డ్రైన్లు' }, art: 'tap', wash: 'sky' },
  { id: 'ELECTRICAL', name: { en: 'Electrical', te: 'ఎలక్ట్రికల్' }, tagline: { en: 'Fans, switches, wiring', te: 'ఫ్యాన్లు, స్విచ్‌లు, వైరింగ్' }, art: 'bulb', wash: 'sunrise' },
  { id: 'AC', name: { en: 'AC Repair', te: 'ఏసీ రిపేర్' }, tagline: { en: 'Service, repair, install', te: 'సర్వీస్, రిపేర్, ఇన్‌స్టలేషన్' }, art: 'snowflake', wash: 'mint' },
  { id: 'APPLIANCE', name: { en: 'Appliances', te: 'గృహోపకరణాలు' }, tagline: { en: 'Washer, fridge, RO', te: 'వాషర్, ఫ్రిజ్, RO' }, art: 'tv', wash: 'lavender' },
  { id: 'CLEANING', name: { en: 'Cleaning', te: 'క్లీనింగ్' }, tagline: { en: 'Bathroom, kitchen, sofa', te: 'బాత్రూమ్, కిచెన్, సోఫా' }, art: 'sponge', wash: 'peach' },
  { id: 'CARPENTRY', name: { en: 'Carpentry', te: 'కార్పెంట్రీ' }, tagline: { en: 'Doors, locks, furniture', te: 'తలుపులు, తాళాలు, ఫర్నిచర్' }, art: 'saw', wash: 'sunrise' },
];

const i = (id: string, en: string, te: string): Issue => ({ id, name: { en, te } });

export const SERVICES: readonly Service[] = [
  {
    id: 'plumb-tap', categoryId: 'PLUMBING', popular: true, visitFee: 49, repairFrom: 149, durationMin: [30, 60], rating: 4.8, reviews: 1240,
    name: { en: 'Tap & mixer repair', te: 'కుళాయి & మిక్సర్ రిపేర్' },
    description: { en: 'Fix dripping taps, loose handles and low flow in kitchen and bathroom.', te: 'కిచెన్, బాత్రూమ్‌లో కారుతున్న కుళాయిలు, వదులైన హ్యాండిల్స్, తక్కువ నీటి ప్రవాహం సరిచేస్తాం.' },
    issues: [i('tap-leak', 'Tap leaking', 'కుళాయి కారుతోంది'), i('tap-flow', 'Low water flow', 'నీరు తక్కువగా వస్తోంది'), i('tap-loose', 'Tap is loose', 'కుళాయి వదులైంది'), i('tap-handle', 'Handle broken', 'హ్యాండిల్ విరిగింది')],
    keywords: ['tap', 'faucet', 'mixer', 'nal', 'kulai', 'కుళాయి', 'నల్లా'],
  },
  {
    id: 'plumb-leak', categoryId: 'PLUMBING', visitFee: 49, repairFrom: 199, durationMin: [45, 90], rating: 4.7, reviews: 860,
    name: { en: 'Leakage & pipe repair', te: 'లీకేజీ & పైపు రిపేర్' },
    description: { en: 'Find and fix leaking pipes, joints and damp walls.', te: 'కారుతున్న పైపులు, జాయింట్లు, తడి గోడలను కనిపెట్టి సరిచేస్తాం.' },
    issues: [i('pipe-leak', 'Pipe leaking', 'పైపు కారుతోంది'), i('pipe-damp', 'Damp wall', 'గోడ తడిగా ఉంది'), i('pipe-burst', 'Pipe burst', 'పైపు పగిలింది'), i('pipe-joint', 'Joint leaking', 'జాయింట్ కారుతోంది')],
    keywords: ['leak', 'pipe', 'leakage', 'water', 'లీక్', 'పైపు'],
  },
  {
    id: 'plumb-block', categoryId: 'PLUMBING', visitFee: 49, repairFrom: 149, durationMin: [30, 75], rating: 4.6, reviews: 702,
    name: { en: 'Blockage & drain cleaning', te: 'బ్లాకేజ్ & డ్రైన్ క్లీనింగ్' },
    description: { en: 'Clear blocked sinks, bathroom drains and bad smells.', te: 'మూసుకుపోయిన సింక్‌లు, బాత్రూమ్ డ్రైన్లు, దుర్వాసన సరిచేస్తాం.' },
    issues: [i('blk-sink', 'Sink blocked', 'సింక్ మూసుకుపోయింది'), i('blk-bath', 'Bathroom drain blocked', 'బాత్రూమ్ డ్రైన్ మూసుకుపోయింది'), i('blk-smell', 'Bad smell', 'దుర్వాసన'), i('blk-slow', 'Water drains slowly', 'నీరు నెమ్మదిగా పోతోంది')],
    keywords: ['block', 'blockage', 'drain', 'clog', 'sink', 'డ్రైన్', 'సింక్'],
  },
  {
    id: 'plumb-tank', categoryId: 'PLUMBING', visitFee: 49, repairFrom: 249, durationMin: [45, 90], rating: 4.6, reviews: 410,
    name: { en: 'Water tank & motor', te: 'వాటర్ ట్యాంక్ & మోటార్' },
    description: { en: 'Motor not starting, tank overflow or no water upstairs.', te: 'మోటార్ స్టార్ట్ కాకపోవడం, ట్యాంక్ పొంగడం, పైకి నీరు రాకపోవడం.' },
    issues: [i('tank-motor', 'Motor not starting', 'మోటార్ స్టార్ట్ కావడం లేదు'), i('tank-overflow', 'Tank overflowing', 'ట్యాంక్ పొంగుతోంది'), i('tank-nowater', 'No water upstairs', 'పైకి నీరు రావడం లేదు')],
    keywords: ['tank', 'motor', 'pump', 'ట్యాంక్', 'మోటార్'],
  },
  {
    id: 'elec-fan', categoryId: 'ELECTRICAL', popular: true, visitFee: 49, repairFrom: 149, durationMin: [30, 60], rating: 4.8, reviews: 1530,
    name: { en: 'Fan repair & install', te: 'ఫ్యాన్ రిపేర్ & ఇన్‌స్టలేషన్' },
    description: { en: 'Ceiling, wall and exhaust fans: repair, regulator and installation.', te: 'సీలింగ్, వాల్, ఎగ్జాస్ట్ ఫ్యాన్లు: రిపేర్, రెగ్యులేటర్, ఇన్‌స్టలేషన్.' },
    issues: [i('fan-dead', 'Fan not running', 'ఫ్యాన్ తిరగడం లేదు'), i('fan-noise', 'Fan making noise', 'ఫ్యాన్ శబ్దం చేస్తోంది'), i('fan-slow', 'Runs slowly', 'నెమ్మదిగా తిరుగుతోంది'), i('fan-new', 'Install a new fan', 'కొత్త ఫ్యాన్ బిగించాలి')],
    keywords: ['fan', 'ceiling fan', 'exhaust', 'regulator', 'ఫ్యాన్', 'pankha'],
  },
  {
    id: 'elec-switch', categoryId: 'ELECTRICAL', visitFee: 49, repairFrom: 100, durationMin: [20, 45], rating: 4.7, reviews: 980,
    name: { en: 'Switch & socket', te: 'స్విచ్ & సాకెట్' },
    description: { en: 'Repair or replace switches, sockets and switchboards.', te: 'స్విచ్‌లు, సాకెట్లు, స్విచ్‌బోర్డులు రిపేర్ లేదా మార్పు.' },
    issues: [i('sw-dead', 'Switch not working', 'స్విచ్ పని చేయడం లేదు'), i('sw-spark', 'Sparks from socket', 'సాకెట్ నుండి నిప్పురవ్వలు'), i('sw-loose', 'Loose socket', 'సాకెట్ వదులైంది'), i('sw-new', 'Need a new point', 'కొత్త పాయింట్ కావాలి')],
    keywords: ['switch', 'socket', 'plug', 'board', 'స్విచ్', 'సాకెట్'],
  },
  {
    id: 'elec-wiring', categoryId: 'ELECTRICAL', visitFee: 49, repairFrom: 249, durationMin: [45, 120], rating: 4.6, reviews: 530,
    name: { en: 'Wiring & MCB', te: 'వైరింగ్ & MCB' },
    description: { en: 'Tripping MCBs, power loss in a room, damaged wires.', te: 'MCB ట్రిప్ అవడం, ఒక గదిలో కరెంట్ పోవడం, దెబ్బతిన్న వైర్లు.' },
    issues: [i('wr-trip', 'MCB trips often', 'MCB తరచుగా ట్రిప్ అవుతోంది'), i('wr-room', 'No power in one room', 'ఒక గదిలో కరెంట్ లేదు'), i('wr-smell', 'Burning smell', 'కాలిన వాసన'), i('wr-damage', 'Wire damaged', 'వైర్ దెబ్బతింది')],
    keywords: ['wiring', 'wire', 'mcb', 'trip', 'power', 'current', 'వైరింగ్', 'కరెంట్'],
  },
  {
    id: 'elec-light', categoryId: 'ELECTRICAL', visitFee: 49, repairFrom: 100, durationMin: [20, 45], rating: 4.7, reviews: 640,
    name: { en: 'Lights & fittings', te: 'లైట్లు & ఫిట్టింగ్‌లు' },
    description: { en: 'Tube lights, LED panels, chandeliers and decorative lights.', te: 'ట్యూబ్ లైట్లు, LED ప్యానెల్స్, షాండ్లియర్లు, అలంకరణ లైట్లు.' },
    issues: [i('lt-dead', 'Light not working', 'లైట్ వెలగడం లేదు'), i('lt-flicker', 'Light flickering', 'లైట్ మినుకుమినుకుమంటోంది'), i('lt-new', 'Install a light', 'లైట్ బిగించాలి')],
    keywords: ['light', 'tube', 'bulb', 'led', 'లైట్', 'బల్బ్'],
  },
  {
    id: 'ac-service', categoryId: 'AC', popular: true, visitFee: 49, repairFrom: 399, durationMin: [45, 90], rating: 4.8, reviews: 2110,
    name: { en: 'AC service & cleaning', te: 'ఏసీ సర్వీస్ & క్లీనింగ్' },
    description: { en: 'Deep cleaning of filters and coils for better cooling.', te: 'మంచి కూలింగ్ కోసం ఫిల్టర్లు, కాయిల్స్ డీప్ క్లీనింగ్.' },
    issues: [i('acs-cool', 'Not cooling well', 'సరిగా చల్లబడటం లేదు'), i('acs-smell', 'Bad smell', 'దుర్వాసన'), i('acs-drip', 'Water dripping', 'నీరు కారుతోంది'), i('acs-regular', 'Regular service', 'సాధారణ సర్వీస్')],
    keywords: ['ac', 'air conditioner', 'service', 'cooling', 'ఏసీ', 'ఎయిర్ కండిషనర్'],
  },
  {
    id: 'ac-repair', categoryId: 'AC', visitFee: 49, repairFrom: 349, durationMin: [45, 120], rating: 4.7, reviews: 1320,
    name: { en: 'AC repair', te: 'ఏసీ రిపేర్' },
    description: { en: 'AC not turning on, noises, gas and remote problems.', te: 'ఏసీ ఆన్ కాకపోవడం, శబ్దాలు, గ్యాస్, రిమోట్ సమస్యలు.' },
    issues: [i('acr-dead', 'Not turning on', 'ఆన్ కావడం లేదు'), i('acr-noise', 'Strange noise', 'వింత శబ్దం'), i('acr-gas', 'Gas check', 'గ్యాస్ చెక్'), i('acr-remote', 'Remote not working', 'రిమోట్ పని చేయడం లేదు')],
    keywords: ['ac', 'repair', 'gas', 'ఏసీ', 'రిపేర్'],
  },
  {
    id: 'ac-install', categoryId: 'AC', visitFee: 49, repairFrom: 599, durationMin: [60, 150], rating: 4.6, reviews: 540,
    name: { en: 'AC install & uninstall', te: 'ఏసీ ఇన్‌స్టలేషన్ & తొలగింపు' },
    description: { en: 'Install a new AC, remove an old one, or shift it.', te: 'కొత్త ఏసీ బిగించడం, పాతది తీయడం, లేదా మార్చడం.' },
    issues: [i('aci-new', 'Install a new AC', 'కొత్త ఏసీ బిగించాలి'), i('aci-remove', 'Uninstall AC', 'ఏసీ తీయాలి'), i('aci-shift', 'Shift AC', 'ఏసీ మార్చాలి')],
    keywords: ['ac', 'install', 'uninstall', 'shift', 'ఏసీ'],
  },
  {
    id: 'app-washer', categoryId: 'APPLIANCE', popular: true, visitFee: 49, repairFrom: 299, durationMin: [45, 90], rating: 4.7, reviews: 1180,
    name: { en: 'Washing machine', te: 'వాషింగ్ మెషిన్' },
    description: { en: 'Front and top load: spinning, draining, leaks and noise.', te: 'ఫ్రంట్, టాప్ లోడ్: తిరగకపోవడం, నీరు పోకపోవడం, లీక్‌లు, శబ్దం.' },
    issues: [i('wm-spin', 'Not spinning', 'తిరగడం లేదు'), i('wm-drain', 'Not draining', 'నీరు బయటకు పోవడం లేదు'), i('wm-leak', 'Water leaking', 'నీరు కారుతోంది'), i('wm-noise', 'Loud noise', 'పెద్ద శబ్దం')],
    keywords: ['washing machine', 'washer', 'వాషింగ్ మెషిన్'],
  },
  {
    id: 'app-fridge', categoryId: 'APPLIANCE', visitFee: 49, repairFrom: 349, durationMin: [45, 90], rating: 4.7, reviews: 990,
    name: { en: 'Refrigerator', te: 'రిఫ్రిజిరేటర్' },
    description: { en: 'Cooling problems, leaks, ice build-up and noise.', te: 'కూలింగ్ సమస్యలు, లీక్‌లు, మంచు పేరుకోవడం, శబ్దం.' },
    issues: [i('fr-cool', 'Not cooling', 'చల్లబడటం లేదు'), i('fr-leak', 'Water leaking inside', 'లోపల నీరు కారుతోంది'), i('fr-ice', 'Ice building up', 'మంచు పేరుకుపోతోంది'), i('fr-noise', 'Unusual noise', 'అసాధారణ శబ్దం')],
    keywords: ['fridge', 'refrigerator', 'ఫ్రిజ్', 'రిఫ్రిజిరేటర్'],
  },
  {
    id: 'app-ro', categoryId: 'APPLIANCE', visitFee: 49, repairFrom: 199, durationMin: [30, 60], rating: 4.6, reviews: 760,
    name: { en: 'RO water purifier', te: 'RO వాటర్ ప్యూరిఫైయర్' },
    description: { en: 'No water, odd taste, leaks and filter changes.', te: 'నీరు రాకపోవడం, రుచి మారడం, లీక్‌లు, ఫిల్టర్ మార్పు.' },
    issues: [i('ro-flow', 'No water flow', 'నీరు రావడం లేదు'), i('ro-taste', 'Water tastes odd', 'నీటి రుచి మారింది'), i('ro-leak', 'Leaking', 'లీక్ అవుతోంది'), i('ro-filter', 'Filter change', 'ఫిల్టర్ మార్చాలి')],
    keywords: ['ro', 'purifier', 'water filter', 'ప్యూరిఫైయర్'],
  },
  {
    id: 'app-geyser', categoryId: 'APPLIANCE', visitFee: 49, repairFrom: 249, durationMin: [30, 75], rating: 4.6, reviews: 480,
    name: { en: 'Geyser', te: 'గీజర్' },
    description: { en: 'No hot water, leaks or tripping power.', te: 'వేడి నీరు రాకపోవడం, లీక్‌లు, కరెంట్ ట్రిప్ అవడం.' },
    issues: [i('gy-cold', 'No hot water', 'వేడి నీరు రావడం లేదు'), i('gy-leak', 'Leaking', 'లీక్ అవుతోంది'), i('gy-trip', 'Trips the power', 'కరెంట్ ట్రిప్ అవుతోంది')],
    keywords: ['geyser', 'heater', 'water heater', 'గీజర్'],
  },
  {
    id: 'clean-bath', categoryId: 'CLEANING', visitFee: 49, repairFrom: 399, durationMin: [60, 120], rating: 4.7, reviews: 870,
    name: { en: 'Bathroom deep cleaning', te: 'బాత్రూమ్ డీప్ క్లీనింగ్' },
    description: { en: 'Tiles, fittings and hard-water stains, scrubbed clean.', te: 'టైల్స్, ఫిట్టింగ్‌లు, ఉప్పునీటి మరకలు పూర్తిగా శుభ్రం.' },
    issues: [i('cb-stains', 'Hard-water stains', 'ఉప్పునీటి మరకలు'), i('cb-tiles', 'Dirty tiles', 'మురికి టైల్స్'), i('cb-fittings', 'Fittings cleaning', 'ఫిట్టింగ్‌ల శుభ్రత')],
    keywords: ['bathroom', 'cleaning', 'toilet', 'బాత్రూమ్', 'క్లీనింగ్'],
  },
  {
    id: 'clean-kitchen', categoryId: 'CLEANING', visitFee: 49, repairFrom: 599, durationMin: [90, 180], rating: 4.6, reviews: 520,
    name: { en: 'Kitchen cleaning', te: 'కిచెన్ క్లీనింగ్' },
    description: { en: 'Oily walls, chimney, cabinets and sink area.', te: 'జిడ్డు గోడలు, చిమ్నీ, క్యాబినెట్లు, సింక్ ప్రాంతం.' },
    issues: [i('ck-oil', 'Oily walls and tiles', 'జిడ్డు గోడలు, టైల్స్'), i('ck-chimney', 'Chimney cleaning', 'చిమ్నీ క్లీనింగ్'), i('ck-sink', 'Sink area', 'సింక్ ప్రాంతం')],
    keywords: ['kitchen', 'chimney', 'cleaning', 'కిచెన్'],
  },
  {
    id: 'clean-sofa', categoryId: 'CLEANING', visitFee: 49, repairFrom: 449, durationMin: [60, 120], rating: 4.7, reviews: 450,
    name: { en: 'Sofa & carpet cleaning', te: 'సోఫా & కార్పెట్ క్లీనింగ్' },
    description: { en: 'Shampoo cleaning for stains, dust and odour.', te: 'మరకలు, దుమ్ము, వాసనకు షాంపూ క్లీనింగ్.' },
    issues: [i('cs-stain', 'Stains', 'మరకలు'), i('cs-dust', 'Dust', 'దుమ్ము'), i('cs-odour', 'Odour', 'వాసన')],
    keywords: ['sofa', 'carpet', 'couch', 'సోఫా'],
  },
  {
    id: 'carp-door', categoryId: 'CARPENTRY', visitFee: 49, repairFrom: 149, durationMin: [30, 75], rating: 4.7, reviews: 610,
    name: { en: 'Door & lock repair', te: 'తలుపు & తాళం రిపేర్' },
    description: { en: 'Doors that stick, broken locks and loose hinges.', te: 'బిగుసుకుపోయే తలుపులు, విరిగిన తాళాలు, వదులైన కీళ్లు.' },
    issues: [i('cd-close', 'Door not closing', 'తలుపు మూసుకోవడం లేదు'), i('cd-lock', 'Lock broken', 'తాళం విరిగింది'), i('cd-hinge', 'Hinge loose', 'కీలు వదులైంది')],
    keywords: ['door', 'lock', 'hinge', 'తలుపు', 'తాళం'],
  },
  {
    id: 'carp-furniture', categoryId: 'CARPENTRY', visitFee: 49, repairFrom: 199, durationMin: [45, 120], rating: 4.6, reviews: 390,
    name: { en: 'Furniture repair', te: 'ఫర్నిచర్ రిపేర్' },
    description: { en: 'Drawers, loose joints, beds and cupboards.', te: 'డ్రాయర్లు, వదులైన జాయింట్లు, మంచాలు, అల్మారాలు.' },
    issues: [i('cf-drawer', 'Drawer broken', 'డ్రాయర్ విరిగింది'), i('cf-joint', 'Loose joints', 'జాయింట్లు వదులయ్యాయి'), i('cf-bed', 'Bed repair', 'మంచం రిపేర్')],
    keywords: ['furniture', 'drawer', 'bed', 'cupboard', 'ఫర్నిచర్'],
  },
  {
    id: 'carp-install', categoryId: 'CARPENTRY', visitFee: 49, repairFrom: 149, durationMin: [30, 90], rating: 4.7, reviews: 520,
    name: { en: 'Fitting & assembly', te: 'ఫిట్టింగ్ & అసెంబ్లీ' },
    description: { en: 'Assemble furniture, fix shelves, curtain rods or a TV mount.', te: 'ఫర్నిచర్ అసెంబ్లీ, షెల్ఫ్‌లు, కర్టెన్ రాడ్లు, టీవీ మౌంట్ బిగించడం.' },
    issues: [i('ci-assemble', 'Assemble furniture', 'ఫర్నిచర్ అసెంబుల్ చేయాలి'), i('ci-shelf', 'Fix shelf or curtain rod', 'షెల్ఫ్ లేదా కర్టెన్ రాడ్ బిగించాలి'), i('ci-tv', 'Mount a TV', 'టీవీ గోడకు బిగించాలి')],
    keywords: ['assembly', 'shelf', 'curtain', 'tv mount', 'drill', 'షెల్ఫ్'],
  },
];

/** Fictional technicians the mock backend "assigns". Clearly labelled as demo everywhere they appear. */
const t = (id: string, en: string, te: string, gender: 'M' | 'F', rating: number, jobs: number, years: number, womenRated: boolean, vehicle: string): Technician =>
  ({ id, name: { en, te }, gender, rating, jobs, years, womenRated, vehicle, maskedPhone: '+91 80 4718 2236', demo: true });

export const DEMO_TECHNICIANS: Readonly<Record<string, readonly Technician[]>> = {
  PLUMBING: [t('tech-ramesh', 'Ramesh Kumar', 'రమేష్ కుమార్', 'M', 4.8, 326, 7, false, 'Scooter · TS 09 AB 1234'), t('tech-swathi', 'Swathi Naidu', 'స్వాతి నాయుడు', 'F', 4.9, 214, 5, true, 'Scooter · TS 08 CD 4521')],
  ELECTRICAL: [t('tech-suresh', 'Suresh Reddy', 'సురేష్ రెడ్డి', 'M', 4.9, 412, 9, true, 'Bike · TS 10 EF 7788'), t('tech-anitha', 'Anitha Rao', 'అనిత రావు', 'F', 4.8, 188, 4, true, 'Scooter · TS 07 GH 3302')],
  AC: [t('tech-anil', 'Anil Varma', 'అనిల్ వర్మ', 'M', 4.7, 288, 6, false, 'Bike · TS 11 JK 9012'), t('tech-farhan', 'Farhan Ali', 'ఫర్హాన్ అలీ', 'M', 4.8, 351, 8, true, 'Scooter · TS 09 LM 5566')],
  APPLIANCE: [t('tech-kiran', 'Kiran Rao', 'కిరణ్ రావు', 'M', 4.8, 305, 8, false, 'Scooter · TS 12 NP 2468'), t('tech-divya', 'Divya Sree', 'దివ్య శ్రీ', 'F', 4.9, 236, 6, true, 'Scooter · TS 08 QR 1357')],
  CLEANING: [t('tech-lakshmi', 'Lakshmi Devi', 'లక్ష్మీ దేవి', 'F', 4.9, 254, 5, true, 'Scooter · TS 07 ST 8642'), t('tech-raju', 'Raju Yadav', 'రాజు యాదవ్', 'M', 4.6, 198, 4, false, 'Bike · TS 10 UV 9753')],
  CARPENTRY: [t('tech-mahesh', 'Mahesh Goud', 'మహేష్ గౌడ్', 'M', 4.7, 198, 11, false, 'Bike · TS 09 WX 1122'), t('tech-salma', 'Salma Begum', 'సల్మా బేగం', 'F', 4.8, 143, 6, true, 'Scooter · TS 11 YZ 3344')],
};

interface QuoteTemplate {
  readonly diagnosis: Localized;
  readonly lines: readonly QuoteLine[];
  readonly extra: { readonly diagnosis: Localized; readonly line: QuoteLine };
}

const labour = (unitPrice: number, en = 'Repair labour', te = 'రిపేర్ కూలీ'): QuoteLine => ({ kind: 'LABOUR', name: { en, te }, qty: 1, unitPrice });
const material = (en: string, te: string, unitPrice: number, qty = 1): QuoteLine => ({ kind: 'MATERIAL', name: { en, te }, qty, unitPrice });

/** Demo quotes per category: what the technician found, labour and materials, and the "extra work" case. */
export const QUOTE_TEMPLATES: Readonly<Record<string, QuoteTemplate>> = {
  PLUMBING: {
    diagnosis: { en: 'Worn-out washer and a loose joint under the sink.', te: 'సింక్ కింద అరిగిపోయిన వాషర్, వదులైన జాయింట్.' },
    lines: [labour(150), material('Washer and sealant', 'వాషర్, సీలెంట్', 90)],
    extra: { diagnosis: { en: 'The tap body is cracked and should be replaced.', te: 'కుళాయి పగిలింది, మార్చాలి.' }, line: material('New tap (ISI)', 'కొత్త కుళాయి (ISI)', 340) },
  },
  ELECTRICAL: {
    diagnosis: { en: 'Loose wiring at the switchboard and a faulty capacitor.', te: 'స్విచ్‌బోర్డ్ వద్ద వదులైన వైరింగ్, పాడైన కెపాసిటర్.' },
    lines: [labour(150), material('Capacitor', 'కెపాసిటర్', 120)],
    extra: { diagnosis: { en: 'The fan regulator is burnt too.', te: 'ఫ్యాన్ రెగ్యులేటర్ కూడా కాలిపోయింది.' }, line: material('New regulator', 'కొత్త రెగ్యులేటర్', 260) },
  },
  AC: {
    diagnosis: { en: 'Dirty filters and coils, so cooling is low.', te: 'ఫిల్టర్లు, కాయిల్స్ మురికిగా ఉన్నాయి, కూలింగ్ తక్కువ.' },
    lines: [labour(399, 'Deep cleaning service', 'డీప్ క్లీనింగ్ సర్వీస్'), material('Cleaning chemicals', 'క్లీనింగ్ రసాయనాలు', 80)],
    extra: { diagnosis: { en: 'Gas pressure is low; a top-up is needed.', te: 'గ్యాస్ ఒత్తిడి తక్కువగా ఉంది; నింపాలి.' }, line: material('Gas top-up', 'గ్యాస్ నింపడం', 1200) },
  },
  APPLIANCE: {
    diagnosis: { en: 'The drain pump is blocked and the belt is worn.', te: 'డ్రెయిన్ పంప్ మూసుకుపోయింది, బెల్ట్ అరిగిపోయింది.' },
    lines: [labour(250), material('Drive belt', 'డ్రైవ్ బెల్ట్', 180)],
    extra: { diagnosis: { en: 'The inlet valve is leaking too.', te: 'ఇన్‌లెట్ వాల్వ్ కూడా లీక్ అవుతోంది.' }, line: material('Inlet valve', 'ఇన్‌లెట్ వాల్వ్', 420) },
  },
  CLEANING: {
    diagnosis: { en: 'Hard-water stains on tiles and fittings.', te: 'టైల్స్, ఫిట్టింగ్‌లపై ఉప్పునీటి మరకలు.' },
    lines: [labour(399, 'Deep cleaning (2 hrs)', 'డీప్ క్లీనింగ్ (2 గంటలు)'), material('Cleaning materials', 'క్లీనింగ్ సామగ్రి', 60)],
    extra: { diagnosis: { en: 'The exhaust fan is greasy too.', te: 'ఎగ్జాస్ట్ ఫ్యాన్ కూడా జిడ్డుగా ఉంది.' }, line: labour(149, 'Exhaust fan cleaning', 'ఎగ్జాస్ట్ ఫ్యాన్ క్లీనింగ్') },
  },
  CARPENTRY: {
    diagnosis: { en: 'The hinges are loose and the lock is misaligned.', te: 'కీళ్లు వదులయ్యాయి, తాళం సరిగా లేదు.' },
    lines: [labour(150), material('Hinges and screws', 'కీళ్లు, స్క్రూలు', 45, 2)],
    extra: { diagnosis: { en: 'The lock itself is broken.', te: 'తాళం విరిగిపోయింది.' }, line: material('New door lock', 'కొత్త తాళం', 380) },
  },
};

/** Problems customers book most, shown as quick picks on Home (service + issue). */
export const TOP_PROBLEMS: readonly { readonly serviceId: string; readonly issueId: string }[] = [
  { serviceId: 'plumb-tap', issueId: 'tap-leak' },
  { serviceId: 'elec-fan', issueId: 'fan-dead' },
  { serviceId: 'ac-service', issueId: 'acs-cool' },
  { serviceId: 'plumb-block', issueId: 'blk-sink' },
  { serviceId: 'elec-switch', issueId: 'sw-dead' },
  { serviceId: 'app-washer', issueId: 'wm-drain' },
];

/** Demo "AI" ranking pool for "Top problems near you": common problems with a base weight (bookings per week). */
export const LOCAL_PROBLEM_POOL: readonly { readonly serviceId: string; readonly issueId: string; readonly weight: number }[] = [
  { serviceId: 'plumb-tap', issueId: 'tap-leak', weight: 30 },
  { serviceId: 'elec-fan', issueId: 'fan-dead', weight: 26 },
  { serviceId: 'ac-service', issueId: 'acs-cool', weight: 24 },
  { serviceId: 'plumb-block', issueId: 'blk-sink', weight: 20 },
  { serviceId: 'elec-switch', issueId: 'sw-dead', weight: 18 },
  { serviceId: 'app-washer', issueId: 'wm-drain', weight: 16 },
  { serviceId: 'app-ro', issueId: 'ro-flow', weight: 15 },
  { serviceId: 'plumb-tank', issueId: 'tank-motor', weight: 14 },
  { serviceId: 'elec-wiring', issueId: 'wr-trip', weight: 13 },
  { serviceId: 'app-fridge', issueId: 'fr-cool', weight: 12 },
  { serviceId: 'app-geyser', issueId: 'gy-cold', weight: 11 },
  { serviceId: 'carp-door', issueId: 'cd-lock', weight: 10 },
  { serviceId: 'clean-bath', issueId: 'cb-stains', weight: 9 },
];

/** Demo "AI" for the bundled sample photos: which service each one shows. */
export const SAMPLE_PHOTO_SERVICE: Readonly<Record<number, string>> = { 1: 'plumb-leak', 2: 'plumb-tap', 3: 'elec-switch', 4: 'plumb-leak' };

export const POPULAR_SEARCHES: readonly string[] = ['plumb-tap', 'ac-service', 'elec-fan', 'app-washer', 'plumb-block'];

export function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function serviceById(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}

export function servicesIn(categoryId: string): readonly Service[] {
  return SERVICES.filter((s) => s.categoryId === categoryId);
}

/** Lowest visit fee in a category, shown on category cards. */
export function categoryVisitFee(categoryId: string): number {
  return Math.min(...servicesIn(categoryId).map((s) => s.visitFee));
}
