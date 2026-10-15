// DEMO CATALOG: synthetic categories, services, prices and ratings for the frontend-first phase. Not real prices or
// reviews. The mock backend serves this; the real backend will replace it.
import type { Category, Issue, Service, Technician } from '../domain/types';

export const CATEGORIES: readonly Category[] = [
  { id: 'PLUMBING', name: { en: 'Plumbing', te: 'ప్లంబింగ్' }, tagline: { en: 'Taps, leaks, drains', te: 'కుళాయిలు, లీకేజీలు, డ్రైన్లు' }, art: 'faucet', wash: 'sky' },
  { id: 'ELECTRICAL', name: { en: 'Electrical', te: 'ఎలక్ట్రికల్' }, tagline: { en: 'Fans, switches, wiring', te: 'ఫ్యాన్లు, స్విచ్‌లు, వైరింగ్' }, art: 'bulb', wash: 'sunrise' },
  { id: 'AC', name: { en: 'AC Repair', te: 'ఏసీ రిపేర్' }, tagline: { en: 'Service, repair, install', te: 'సర్వీస్, రిపేర్, ఇన్‌స్టలేషన్' }, art: 'ac', wash: 'mint' },
  { id: 'APPLIANCE', name: { en: 'Appliances', te: 'గృహోపకరణాలు' }, tagline: { en: 'Washer, fridge, RO', te: 'వాషర్, ఫ్రిజ్, RO' }, art: 'washer', wash: 'lavender' },
  { id: 'CLEANING', name: { en: 'Cleaning', te: 'క్లీనింగ్' }, tagline: { en: 'Bathroom, kitchen, sofa', te: 'బాత్రూమ్, కిచెన్, సోఫా' }, art: 'spray', wash: 'peach' },
  { id: 'CARPENTRY', name: { en: 'Carpentry', te: 'కార్పెంట్రీ' }, tagline: { en: 'Doors, locks, furniture', te: 'తలుపులు, తాళాలు, ఫర్నిచర్' }, art: 'hammer', wash: 'sunrise' },
];

const i = (id: string, en: string, te: string): Issue => ({ id, name: { en, te } });

export const SERVICES: readonly Service[] = [
  {
    id: 'plumb-tap', categoryId: 'PLUMBING', popular: true, visitFee: 199, durationMin: [30, 60], rating: 4.8, reviews: 1240,
    name: { en: 'Tap & mixer repair', te: 'కుళాయి & మిక్సర్ రిపేర్' },
    description: { en: 'Fix dripping taps, loose handles and low flow in kitchen and bathroom.', te: 'కిచెన్, బాత్రూమ్‌లో కారుతున్న కుళాయిలు, వదులైన హ్యాండిల్స్, తక్కువ నీటి ప్రవాహం సరిచేస్తాం.' },
    issues: [i('tap-leak', 'Tap leaking', 'కుళాయి కారుతోంది'), i('tap-flow', 'Low water flow', 'నీరు తక్కువగా వస్తోంది'), i('tap-loose', 'Tap is loose', 'కుళాయి వదులైంది'), i('tap-handle', 'Handle broken', 'హ్యాండిల్ విరిగింది')],
    keywords: ['tap', 'faucet', 'mixer', 'nal', 'kulai', 'కుళాయి', 'నల్లా'],
  },
  {
    id: 'plumb-leak', categoryId: 'PLUMBING', visitFee: 199, durationMin: [45, 90], rating: 4.7, reviews: 860,
    name: { en: 'Leakage & pipe repair', te: 'లీకేజీ & పైపు రిపేర్' },
    description: { en: 'Find and fix leaking pipes, joints and damp walls.', te: 'కారుతున్న పైపులు, జాయింట్లు, తడి గోడలను కనిపెట్టి సరిచేస్తాం.' },
    issues: [i('pipe-leak', 'Pipe leaking', 'పైపు కారుతోంది'), i('pipe-damp', 'Damp wall', 'గోడ తడిగా ఉంది'), i('pipe-burst', 'Pipe burst', 'పైపు పగిలింది'), i('pipe-joint', 'Joint leaking', 'జాయింట్ కారుతోంది')],
    keywords: ['leak', 'pipe', 'leakage', 'water', 'లీక్', 'పైపు'],
  },
  {
    id: 'plumb-block', categoryId: 'PLUMBING', visitFee: 199, durationMin: [30, 75], rating: 4.6, reviews: 702,
    name: { en: 'Blockage & drain cleaning', te: 'బ్లాకేజ్ & డ్రైన్ క్లీనింగ్' },
    description: { en: 'Clear blocked sinks, bathroom drains and bad smells.', te: 'మూసుకుపోయిన సింక్‌లు, బాత్రూమ్ డ్రైన్లు, దుర్వాసన సరిచేస్తాం.' },
    issues: [i('blk-sink', 'Sink blocked', 'సింక్ మూసుకుపోయింది'), i('blk-bath', 'Bathroom drain blocked', 'బాత్రూమ్ డ్రైన్ మూసుకుపోయింది'), i('blk-smell', 'Bad smell', 'దుర్వాసన'), i('blk-slow', 'Water drains slowly', 'నీరు నెమ్మదిగా పోతోంది')],
    keywords: ['block', 'blockage', 'drain', 'clog', 'sink', 'డ్రైన్', 'సింక్'],
  },
  {
    id: 'plumb-tank', categoryId: 'PLUMBING', visitFee: 199, durationMin: [45, 90], rating: 4.6, reviews: 410,
    name: { en: 'Water tank & motor', te: 'వాటర్ ట్యాంక్ & మోటార్' },
    description: { en: 'Motor not starting, tank overflow or no water upstairs.', te: 'మోటార్ స్టార్ట్ కాకపోవడం, ట్యాంక్ పొంగడం, పైకి నీరు రాకపోవడం.' },
    issues: [i('tank-motor', 'Motor not starting', 'మోటార్ స్టార్ట్ కావడం లేదు'), i('tank-overflow', 'Tank overflowing', 'ట్యాంక్ పొంగుతోంది'), i('tank-nowater', 'No water upstairs', 'పైకి నీరు రావడం లేదు')],
    keywords: ['tank', 'motor', 'pump', 'ట్యాంక్', 'మోటార్'],
  },
  {
    id: 'elec-fan', categoryId: 'ELECTRICAL', popular: true, visitFee: 199, durationMin: [30, 60], rating: 4.8, reviews: 1530,
    name: { en: 'Fan repair & install', te: 'ఫ్యాన్ రిపేర్ & ఇన్‌స్టలేషన్' },
    description: { en: 'Ceiling, wall and exhaust fans: repair, regulator and installation.', te: 'సీలింగ్, వాల్, ఎగ్జాస్ట్ ఫ్యాన్లు: రిపేర్, రెగ్యులేటర్, ఇన్‌స్టలేషన్.' },
    issues: [i('fan-dead', 'Fan not running', 'ఫ్యాన్ తిరగడం లేదు'), i('fan-noise', 'Fan making noise', 'ఫ్యాన్ శబ్దం చేస్తోంది'), i('fan-slow', 'Runs slowly', 'నెమ్మదిగా తిరుగుతోంది'), i('fan-new', 'Install a new fan', 'కొత్త ఫ్యాన్ బిగించాలి')],
    keywords: ['fan', 'ceiling fan', 'exhaust', 'regulator', 'ఫ్యాన్', 'pankha'],
  },
  {
    id: 'elec-switch', categoryId: 'ELECTRICAL', visitFee: 199, durationMin: [20, 45], rating: 4.7, reviews: 980,
    name: { en: 'Switch & socket', te: 'స్విచ్ & సాకెట్' },
    description: { en: 'Repair or replace switches, sockets and switchboards.', te: 'స్విచ్‌లు, సాకెట్లు, స్విచ్‌బోర్డులు రిపేర్ లేదా మార్పు.' },
    issues: [i('sw-dead', 'Switch not working', 'స్విచ్ పని చేయడం లేదు'), i('sw-spark', 'Sparks from socket', 'సాకెట్ నుండి నిప్పురవ్వలు'), i('sw-loose', 'Loose socket', 'సాకెట్ వదులైంది'), i('sw-new', 'Need a new point', 'కొత్త పాయింట్ కావాలి')],
    keywords: ['switch', 'socket', 'plug', 'board', 'స్విచ్', 'సాకెట్'],
  },
  {
    id: 'elec-wiring', categoryId: 'ELECTRICAL', visitFee: 199, durationMin: [45, 120], rating: 4.6, reviews: 530,
    name: { en: 'Wiring & MCB', te: 'వైరింగ్ & MCB' },
    description: { en: 'Tripping MCBs, power loss in a room, damaged wires.', te: 'MCB ట్రిప్ అవడం, ఒక గదిలో కరెంట్ పోవడం, దెబ్బతిన్న వైర్లు.' },
    issues: [i('wr-trip', 'MCB trips often', 'MCB తరచుగా ట్రిప్ అవుతోంది'), i('wr-room', 'No power in one room', 'ఒక గదిలో కరెంట్ లేదు'), i('wr-smell', 'Burning smell', 'కాలిన వాసన'), i('wr-damage', 'Wire damaged', 'వైర్ దెబ్బతింది')],
    keywords: ['wiring', 'wire', 'mcb', 'trip', 'power', 'current', 'వైరింగ్', 'కరెంట్'],
  },
  {
    id: 'elec-light', categoryId: 'ELECTRICAL', visitFee: 199, durationMin: [20, 45], rating: 4.7, reviews: 640,
    name: { en: 'Lights & fittings', te: 'లైట్లు & ఫిట్టింగ్‌లు' },
    description: { en: 'Tube lights, LED panels, chandeliers and decorative lights.', te: 'ట్యూబ్ లైట్లు, LED ప్యానెల్స్, షాండ్లియర్లు, అలంకరణ లైట్లు.' },
    issues: [i('lt-dead', 'Light not working', 'లైట్ వెలగడం లేదు'), i('lt-flicker', 'Light flickering', 'లైట్ మినుకుమినుకుమంటోంది'), i('lt-new', 'Install a light', 'లైట్ బిగించాలి')],
    keywords: ['light', 'tube', 'bulb', 'led', 'లైట్', 'బల్బ్'],
  },
  {
    id: 'ac-service', categoryId: 'AC', popular: true, visitFee: 299, durationMin: [45, 90], rating: 4.8, reviews: 2110,
    name: { en: 'AC service & cleaning', te: 'ఏసీ సర్వీస్ & క్లీనింగ్' },
    description: { en: 'Deep cleaning of filters and coils for better cooling.', te: 'మంచి కూలింగ్ కోసం ఫిల్టర్లు, కాయిల్స్ డీప్ క్లీనింగ్.' },
    issues: [i('acs-cool', 'Not cooling well', 'సరిగా చల్లబడటం లేదు'), i('acs-smell', 'Bad smell', 'దుర్వాసన'), i('acs-drip', 'Water dripping', 'నీరు కారుతోంది'), i('acs-regular', 'Regular service', 'సాధారణ సర్వీస్')],
    keywords: ['ac', 'air conditioner', 'service', 'cooling', 'ఏసీ', 'ఎయిర్ కండిషనర్'],
  },
  {
    id: 'ac-repair', categoryId: 'AC', visitFee: 299, durationMin: [45, 120], rating: 4.7, reviews: 1320,
    name: { en: 'AC repair', te: 'ఏసీ రిపేర్' },
    description: { en: 'AC not turning on, noises, gas and remote problems.', te: 'ఏసీ ఆన్ కాకపోవడం, శబ్దాలు, గ్యాస్, రిమోట్ సమస్యలు.' },
    issues: [i('acr-dead', 'Not turning on', 'ఆన్ కావడం లేదు'), i('acr-noise', 'Strange noise', 'వింత శబ్దం'), i('acr-gas', 'Gas check', 'గ్యాస్ చెక్'), i('acr-remote', 'Remote not working', 'రిమోట్ పని చేయడం లేదు')],
    keywords: ['ac', 'repair', 'gas', 'ఏసీ', 'రిపేర్'],
  },
  {
    id: 'ac-install', categoryId: 'AC', visitFee: 299, durationMin: [60, 150], rating: 4.6, reviews: 540,
    name: { en: 'AC install & uninstall', te: 'ఏసీ ఇన్‌స్టలేషన్ & తొలగింపు' },
    description: { en: 'Install a new AC, remove an old one, or shift it.', te: 'కొత్త ఏసీ బిగించడం, పాతది తీయడం, లేదా మార్చడం.' },
    issues: [i('aci-new', 'Install a new AC', 'కొత్త ఏసీ బిగించాలి'), i('aci-remove', 'Uninstall AC', 'ఏసీ తీయాలి'), i('aci-shift', 'Shift AC', 'ఏసీ మార్చాలి')],
    keywords: ['ac', 'install', 'uninstall', 'shift', 'ఏసీ'],
  },
  {
    id: 'app-washer', categoryId: 'APPLIANCE', popular: true, visitFee: 249, durationMin: [45, 90], rating: 4.7, reviews: 1180,
    name: { en: 'Washing machine', te: 'వాషింగ్ మెషిన్' },
    description: { en: 'Front and top load: spinning, draining, leaks and noise.', te: 'ఫ్రంట్, టాప్ లోడ్: తిరగకపోవడం, నీరు పోకపోవడం, లీక్‌లు, శబ్దం.' },
    issues: [i('wm-spin', 'Not spinning', 'తిరగడం లేదు'), i('wm-drain', 'Not draining', 'నీరు బయటకు పోవడం లేదు'), i('wm-leak', 'Water leaking', 'నీరు కారుతోంది'), i('wm-noise', 'Loud noise', 'పెద్ద శబ్దం')],
    keywords: ['washing machine', 'washer', 'వాషింగ్ మెషిన్'],
  },
  {
    id: 'app-fridge', categoryId: 'APPLIANCE', visitFee: 249, durationMin: [45, 90], rating: 4.7, reviews: 990,
    name: { en: 'Refrigerator', te: 'రిఫ్రిజిరేటర్' },
    description: { en: 'Cooling problems, leaks, ice build-up and noise.', te: 'కూలింగ్ సమస్యలు, లీక్‌లు, మంచు పేరుకోవడం, శబ్దం.' },
    issues: [i('fr-cool', 'Not cooling', 'చల్లబడటం లేదు'), i('fr-leak', 'Water leaking inside', 'లోపల నీరు కారుతోంది'), i('fr-ice', 'Ice building up', 'మంచు పేరుకుపోతోంది'), i('fr-noise', 'Unusual noise', 'అసాధారణ శబ్దం')],
    keywords: ['fridge', 'refrigerator', 'ఫ్రిజ్', 'రిఫ్రిజిరేటర్'],
  },
  {
    id: 'app-ro', categoryId: 'APPLIANCE', visitFee: 249, durationMin: [30, 60], rating: 4.6, reviews: 760,
    name: { en: 'RO water purifier', te: 'RO వాటర్ ప్యూరిఫైయర్' },
    description: { en: 'No water, odd taste, leaks and filter changes.', te: 'నీరు రాకపోవడం, రుచి మారడం, లీక్‌లు, ఫిల్టర్ మార్పు.' },
    issues: [i('ro-flow', 'No water flow', 'నీరు రావడం లేదు'), i('ro-taste', 'Water tastes odd', 'నీటి రుచి మారింది'), i('ro-leak', 'Leaking', 'లీక్ అవుతోంది'), i('ro-filter', 'Filter change', 'ఫిల్టర్ మార్చాలి')],
    keywords: ['ro', 'purifier', 'water filter', 'ప్యూరిఫైయర్'],
  },
  {
    id: 'app-geyser', categoryId: 'APPLIANCE', visitFee: 249, durationMin: [30, 75], rating: 4.6, reviews: 480,
    name: { en: 'Geyser', te: 'గీజర్' },
    description: { en: 'No hot water, leaks or tripping power.', te: 'వేడి నీరు రాకపోవడం, లీక్‌లు, కరెంట్ ట్రిప్ అవడం.' },
    issues: [i('gy-cold', 'No hot water', 'వేడి నీరు రావడం లేదు'), i('gy-leak', 'Leaking', 'లీక్ అవుతోంది'), i('gy-trip', 'Trips the power', 'కరెంట్ ట్రిప్ అవుతోంది')],
    keywords: ['geyser', 'heater', 'water heater', 'గీజర్'],
  },
  {
    id: 'clean-bath', categoryId: 'CLEANING', visitFee: 149, durationMin: [60, 120], rating: 4.7, reviews: 870,
    name: { en: 'Bathroom deep cleaning', te: 'బాత్రూమ్ డీప్ క్లీనింగ్' },
    description: { en: 'Tiles, fittings and hard-water stains, scrubbed clean.', te: 'టైల్స్, ఫిట్టింగ్‌లు, ఉప్పునీటి మరకలు పూర్తిగా శుభ్రం.' },
    issues: [i('cb-stains', 'Hard-water stains', 'ఉప్పునీటి మరకలు'), i('cb-tiles', 'Dirty tiles', 'మురికి టైల్స్'), i('cb-fittings', 'Fittings cleaning', 'ఫిట్టింగ్‌ల శుభ్రత')],
    keywords: ['bathroom', 'cleaning', 'toilet', 'బాత్రూమ్', 'క్లీనింగ్'],
  },
  {
    id: 'clean-kitchen', categoryId: 'CLEANING', visitFee: 149, durationMin: [90, 180], rating: 4.6, reviews: 520,
    name: { en: 'Kitchen cleaning', te: 'కిచెన్ క్లీనింగ్' },
    description: { en: 'Oily walls, chimney, cabinets and sink area.', te: 'జిడ్డు గోడలు, చిమ్నీ, క్యాబినెట్లు, సింక్ ప్రాంతం.' },
    issues: [i('ck-oil', 'Oily walls and tiles', 'జిడ్డు గోడలు, టైల్స్'), i('ck-chimney', 'Chimney cleaning', 'చిమ్నీ క్లీనింగ్'), i('ck-sink', 'Sink area', 'సింక్ ప్రాంతం')],
    keywords: ['kitchen', 'chimney', 'cleaning', 'కిచెన్'],
  },
  {
    id: 'clean-sofa', categoryId: 'CLEANING', visitFee: 149, durationMin: [60, 120], rating: 4.7, reviews: 450,
    name: { en: 'Sofa & carpet cleaning', te: 'సోఫా & కార్పెట్ క్లీనింగ్' },
    description: { en: 'Shampoo cleaning for stains, dust and odour.', te: 'మరకలు, దుమ్ము, వాసనకు షాంపూ క్లీనింగ్.' },
    issues: [i('cs-stain', 'Stains', 'మరకలు'), i('cs-dust', 'Dust', 'దుమ్ము'), i('cs-odour', 'Odour', 'వాసన')],
    keywords: ['sofa', 'carpet', 'couch', 'సోఫా'],
  },
  {
    id: 'carp-door', categoryId: 'CARPENTRY', visitFee: 199, durationMin: [30, 75], rating: 4.7, reviews: 610,
    name: { en: 'Door & lock repair', te: 'తలుపు & తాళం రిపేర్' },
    description: { en: 'Doors that stick, broken locks and loose hinges.', te: 'బిగుసుకుపోయే తలుపులు, విరిగిన తాళాలు, వదులైన కీళ్లు.' },
    issues: [i('cd-close', 'Door not closing', 'తలుపు మూసుకోవడం లేదు'), i('cd-lock', 'Lock broken', 'తాళం విరిగింది'), i('cd-hinge', 'Hinge loose', 'కీలు వదులైంది')],
    keywords: ['door', 'lock', 'hinge', 'తలుపు', 'తాళం'],
  },
  {
    id: 'carp-furniture', categoryId: 'CARPENTRY', visitFee: 199, durationMin: [45, 120], rating: 4.6, reviews: 390,
    name: { en: 'Furniture repair', te: 'ఫర్నిచర్ రిపేర్' },
    description: { en: 'Drawers, loose joints, beds and cupboards.', te: 'డ్రాయర్లు, వదులైన జాయింట్లు, మంచాలు, అల్మారాలు.' },
    issues: [i('cf-drawer', 'Drawer broken', 'డ్రాయర్ విరిగింది'), i('cf-joint', 'Loose joints', 'జాయింట్లు వదులయ్యాయి'), i('cf-bed', 'Bed repair', 'మంచం రిపేర్')],
    keywords: ['furniture', 'drawer', 'bed', 'cupboard', 'ఫర్నిచర్'],
  },
  {
    id: 'carp-install', categoryId: 'CARPENTRY', visitFee: 199, durationMin: [30, 90], rating: 4.7, reviews: 520,
    name: { en: 'Fitting & assembly', te: 'ఫిట్టింగ్ & అసెంబ్లీ' },
    description: { en: 'Assemble furniture, fix shelves, curtain rods or a TV mount.', te: 'ఫర్నిచర్ అసెంబ్లీ, షెల్ఫ్‌లు, కర్టెన్ రాడ్లు, టీవీ మౌంట్ బిగించడం.' },
    issues: [i('ci-assemble', 'Assemble furniture', 'ఫర్నిచర్ అసెంబుల్ చేయాలి'), i('ci-shelf', 'Fix shelf or curtain rod', 'షెల్ఫ్ లేదా కర్టెన్ రాడ్ బిగించాలి'), i('ci-tv', 'Mount a TV', 'టీవీ గోడకు బిగించాలి')],
    keywords: ['assembly', 'shelf', 'curtain', 'tv mount', 'drill', 'షెల్ఫ్'],
  },
];

/** Fictional technicians the mock backend "assigns". Clearly labelled as demo everywhere they appear. */
export const DEMO_TECHNICIANS: Readonly<Record<string, Technician>> = {
  PLUMBING: { id: 'tech-ramesh', name: { en: 'Ramesh Kumar', te: 'రమేష్ కుమార్' }, rating: 4.8, jobs: 326, years: 7, demo: true },
  ELECTRICAL: { id: 'tech-suresh', name: { en: 'Suresh Reddy', te: 'సురేష్ రెడ్డి' }, rating: 4.9, jobs: 412, years: 9, demo: true },
  AC: { id: 'tech-anil', name: { en: 'Anil Varma', te: 'అనిల్ వర్మ' }, rating: 4.7, jobs: 288, years: 6, demo: true },
  APPLIANCE: { id: 'tech-kiran', name: { en: 'Kiran Rao', te: 'కిరణ్ రావు' }, rating: 4.8, jobs: 305, years: 8, demo: true },
  CLEANING: { id: 'tech-lakshmi', name: { en: 'Lakshmi Devi', te: 'లక్ష్మీ దేవి' }, rating: 4.9, jobs: 254, years: 5, demo: true },
  CARPENTRY: { id: 'tech-mahesh', name: { en: 'Mahesh Goud', te: 'మహేష్ గౌడ్' }, rating: 4.7, jobs: 198, years: 11, demo: true },
};

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
