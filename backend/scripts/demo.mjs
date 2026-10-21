// `npm run demo`: the whole app on this laptop, for showing Housefi without phones. One page shows the customer's
// phone and the technician's phone side by side, both running the real app against a real (local) API:
//   1. a fresh in-memory database (PGlite + PostGIS) with the catalogue and the parts price list;
//   2. the demo API (demo/server.ts) with a ready technician; payments are simulated, nothing leaves the laptop;
//   3. the app's web build (made once, in app/dist/demo; `npm run demo -- --rebuild` makes it again);
//   4. the demo page on http://localhost:8090, opened in the browser.
// Each phone is its own web address (a port of its own), so each keeps its own sign-in; all on localhost, so the
// browser treats them as one site and lets both phones keep their sign-in inside the page.
// Every start begins from scratch. Stop with Ctrl+C.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { startPgliteServer } from './pglite-server.mjs';

const API_PORT = 4100;
const PAGE_PORT = 8090;
const CUSTOMER_PORT = 8095;
const TECHNICIAN_PORT = 8096;
const CUSTOMER_URL = `http://localhost:${CUSTOMER_PORT}`;
const TECHNICIAN_URL = `http://localhost:${TECHNICIAN_PORT}`;
const APP_DIR = resolve('..', 'app');
const WEB_DIR = join(APP_DIR, 'dist', 'demo');
const rebuild = process.argv.includes('--rebuild');
const children = [];

/** Fake numbers and the code shown on the demo page: the same as in demo/server.ts. */
const NUMBERS = { customer: '98765 00001', technician: '98765 00002', code: '482916' };
/** Where each phone "is": the customer in Jubilee Hills, the technician 3 km away in Banjara Hills. */
const POSITIONS = { [CUSTOMER_PORT]: { lat: 17.4326, lng: 78.4071 }, [TECHNICIAN_PORT]: { lat: 17.4156, lng: 78.4347 } };

const say = (msg) => console.log(`[demo] ${msg}`);

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

/** Runs a command to the end; resolves with its exit code. */
function run(cmd, args, opts = {}) {
  return new Promise((ok) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && !cmd.endsWith('.exe'), ...opts });
    child.on('exit', (code) => ok(code ?? 1));
  });
}

async function stop(code = 0) {
  for (const c of children) c.kill();
  await db?.stop().catch(() => undefined);
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));

// ---------- the app's web build ----------
async function buildWeb() {
  if (!existsSync(join(APP_DIR, 'node_modules'))) throw new Error('the app is not installed yet: in the app folder, run "npm install" once, then npm run demo again');
  if (!rebuild && existsSync(join(WEB_DIR, 'index.html'))) {
    say('Using the existing web build of the app (npm run demo -- --rebuild to make a new one).');
    return;
  }
  say('Building the app for the browser (first time only, about 2 minutes)...');
  const code = await run('npx', ['expo', 'export', '-p', 'web', '--output-dir', 'dist/demo', '--clear'], {
    cwd: APP_DIR,
    env: { ...process.env, EXPO_PUBLIC_HOUSEFI_API_URL: `http://localhost:${API_PORT}/v1`, EXPO_PUBLIC_INSTANT_ALL_DAY: '1' },
  });
  if (code !== 0) throw new Error('the web build of the app failed');
}

// ---------- the phones: the web build, with each phone's position ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };

/** Gives the page a fixed position (the browser would otherwise ask, and give the laptop's own). */
const positionScript = `<script>(function(){var P=${JSON.stringify(POSITIONS)};var p=P[location.port];if(!p||!navigator.geolocation)return;
var pos=function(){return{coords:{latitude:p.lat,longitude:p.lng,accuracy:15,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()}};
navigator.geolocation.getCurrentPosition=function(ok){setTimeout(function(){ok(pos())},50)};
navigator.geolocation.watchPosition=function(ok){setTimeout(function(){ok(pos())},50);return 1};
navigator.geolocation.clearWatch=function(){};
if(navigator.permissions){var q=navigator.permissions.query.bind(navigator.permissions);navigator.permissions.query=function(d){return d&&d.name==='geolocation'?Promise.resolve({state:'granted',onchange:null,addEventListener:function(){},removeEventListener:function(){}}):q(d)}}})()</script>`;

/** Every start is a fresh database: each phone forgets the sign-in it kept from an earlier demo. */
const RUN = Date.now().toString(36);
const freshScript = `<script>try{if(localStorage.getItem('housefi-demo-run')!=='${RUN}'){localStorage.clear();sessionStorage.clear();localStorage.setItem('housefi-demo-run','${RUN}')}}catch(e){}</script>`;

/**
 * A back-history of its own for each phone. Frames in one page share the browser's back history, so "back" in the
 * customer's app would undo the technician's last screen (and the other way round). Each phone keeps its own list of
 * screens instead and only ever replaces its browser entry; going back fires the usual popstate for the app.
 */
const historyScript = `<script>(function(){if(window.top===window)return;var H=history,rep=H.replaceState.bind(H),list=[{s:H.state,u:location.href}],at=0;
H.pushState=function(s,t,u){list=list.slice(0,at+1);list.push({s:s,u:u==null?location.href:String(u)});at++;rep(s,t,u)};
H.replaceState=function(s,t,u){list[at]={s:s,u:u==null?location.href:String(u)};rep(s,t,u)};
H.go=function(n){var to=at+(n|0);if(!n||to<0||to>=list.length)return;at=to;rep(list[at].s,'',list[at].u);setTimeout(function(){dispatchEvent(new PopStateEvent('popstate',{state:list[at].s}))},0)};
H.back=function(){H.go(-1)};H.forward=function(){H.go(1)};
Object.defineProperty(H,'length',{configurable:true,get:function(){return list.length}})})()</script>`;

function serveApp() {
  return http.createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(WEB_DIR, path));
    if (!file.startsWith(WEB_DIR)) return void res.writeHead(403).end();
    if (!existsSync(file) || statSync(file).isDirectory()) {
      const html = existsSync(`${file}.html`) ? `${file}.html` : join(file, 'index.html');
      file = existsSync(html) ? html : join(WEB_DIR, 'index.html');
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    let body = readFileSync(file);
    if (type.startsWith('text/html')) body = Buffer.from(body.toString('utf8').replace('<head>', `<head>${freshScript}${positionScript}${historyScript}`));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'max-age=3600' });
    res.end(body);
  });
}

// ---------- the demo page: both phones side by side ----------
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Housefi demo</title>
<style>
  :root { --bg: #0d1b4d; --card: #13256a; --ink: #f4f6ff; --muted: #a9b6e8; --accent: #48d9f5; --phone-w: 390px; --phone-h: 844px; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: radial-gradient(circle at 50% 0%, #1d3ab0 0%, var(--bg) 60%); color: var(--ink); font: 15px/1.4 "Segoe UI", system-ui, sans-serif; overflow: hidden; }
  header { height: 64px; display: flex; align-items: center; gap: 14px; padding: 0 28px; }
  header h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  header .tag { font-size: 12px; font-weight: 600; color: var(--bg); background: var(--accent); padding: 3px 10px; border-radius: 99px; }
  header .right { margin-left: auto; display: flex; gap: 10px; }
  button { font: inherit; font-weight: 600; color: var(--ink); background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.22); border-radius: 99px; padding: 7px 16px; cursor: pointer; }
  button:hover { background: rgba(255,255,255,0.18); }
  main { height: calc(100% - 64px); display: flex; justify-content: center; align-items: flex-start; gap: var(--gap, 72px); }
  .side { width: calc(var(--phone-w) * var(--s) + 24px); display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .label { text-align: center; }
  .label b { display: block; font-size: 17px; }
  .label span { color: var(--muted); font-size: 13px; }
  .label code { color: var(--ink); background: rgba(255,255,255,0.12); padding: 1px 7px; border-radius: 6px; font-family: Consolas, monospace; }
  .phone { width: calc(var(--phone-w) * var(--s) + 24px); height: calc(var(--phone-h) * var(--s) + 24px); padding: 12px; border-radius: calc(54px * var(--s) + 12px); background: #050a1f; box-shadow: 0 0 0 2px #2b3c7e, 0 30px 80px rgba(0,0,0,0.5); }
  /* clip, not hidden: typing inside a phone must not scroll its frame (the browser scrolls hidden overflow to show the
     focused field, which would shift the whole screen). */
  .screen { width: calc(var(--phone-w) * var(--s)); height: calc(var(--phone-h) * var(--s)); border-radius: calc(44px * var(--s)); overflow: clip; background: #faf9f5; }
  iframe { width: var(--phone-w); height: var(--phone-h); border: 0; transform: scale(var(--s)); transform-origin: 0 0; display: block; }
</style></head>
<body>
<header>
  <h1>Housefi</h1><span class="tag">LIVE DEMO</span>
  <div class="right"><button id="reload">Reload both</button></div>
</header>
<main>
  <section class="side">
    <div class="label"><b>Customer</b><span>"Book a home service" · <code>${NUMBERS.customer}</code> · code <code>${NUMBERS.code}</code></span></div>
    <div class="phone"><div class="screen"><iframe id="customer" src="${CUSTOMER_URL}/" title="Customer phone" allow="geolocation; camera; microphone; clipboard-write"></iframe></div></div>
  </section>
  <section class="side">
    <div class="label"><b>Technician</b><span>"Work as a technician" · <code>${NUMBERS.technician}</code> · code <code>${NUMBERS.code}</code></span></div>
    <div class="phone"><div class="screen"><iframe id="technician" src="${TECHNICIAN_URL}/" title="Technician phone" allow="geolocation; camera; microphone; clipboard-write"></iframe></div></div>
  </section>
</main>
<script>
  // Both phones as big as the window allows, with the space between them in proportion.
  function fit() {
    var s = Math.min(1, (window.innerHeight - 64 - 70) / (844 + 24), (window.innerWidth - 120) / (2 * (390 + 24)));
    document.documentElement.style.setProperty('--s', s.toFixed(3));
    document.documentElement.style.setProperty('--gap', Math.round(80 * s) + 'px');
  }
  fit(); addEventListener('resize', fit);
  // Browsers without overflow: clip: put a frame back if focusing a field scrolled it.
  document.querySelectorAll('.screen').forEach(function (el) { el.addEventListener('scroll', function () { el.scrollTop = 0; el.scrollLeft = 0; }); });
  document.getElementById('reload').onclick = function () { ['customer', 'technician'].forEach(function (id) { var f = document.getElementById(id); f.src = f.src; }); };
</script>
</body></html>`;

// ---------- start ----------
let db = null;
try {
  say('Starting a fresh database...');
  db = await startPgliteServer({ port: await freePort() });
  if ((await run(process.execPath, [join('node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: db.url }, stdio: 'ignore' })) !== 0) throw new Error('migrations failed');

  say('Preparing the server...');
  if ((await run(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.demo.json'])) !== 0) throw new Error('the server did not compile');
  const api = spawn(process.execPath, [join('.demo-dist', 'demo', 'server.js')], {
    env: { ...process.env, DATABASE_URL: db.url, DEMO_API_PORT: String(API_PORT), DEMO_SCREENS: `${CUSTOMER_URL},${TECHNICIAN_URL}` },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(api);
  await new Promise((ok, fail) => {
    api.stdout.on('data', (d) => {
      const text = d.toString();
      if (text.includes('DEMO_READY')) ok();
      else if (process.env.DEMO_VERBOSE) process.stdout.write(text);
    });
    api.on('exit', (code) => fail(new Error(`the demo server stopped (exit ${code})`)));
  });
  say(`Server ready (http://localhost:${API_PORT}/v1/health), technician online near Banjara Hills.`);

  await buildWeb();
  for (const port of [CUSTOMER_PORT, TECHNICIAN_PORT]) await new Promise((ok) => serveApp().listen(port, '127.0.0.1', ok));
  await new Promise((ok) => http.createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page)).listen(PAGE_PORT, '127.0.0.1', ok));
  const url = `http://localhost:${PAGE_PORT}`;
  say(`Demo open at ${url}  (Ctrl+C to stop)`);
  if (!process.argv.includes('--no-open')) spawn(process.platform === 'win32' ? 'cmd' : 'open', process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { stdio: 'ignore', detached: true }).unref();
} catch (err) {
  console.error(`[demo] ${err.message}`);
  await stop(1);
}
