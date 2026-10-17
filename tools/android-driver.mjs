// Minimal Android UI driver for journey tests: finds views by testID (exposed as resource-id), taps, types,
// scrolls and takes screenshots through adb. No extra dependencies.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { inflateSync } from 'node:zlib';

const SDK = process.env.ANDROID_HOME ?? `${process.env.LOCALAPPDATA}/Android/Sdk`;
const ADB = `${SDK}/platform-tools/adb`;
export const PKG = 'app.housefi.mobile';

export function adb(args, opts = {}) {
  return execFileSync(ADB, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Current UI tree as a flat list of nodes. */
export function dump() {
  let xml = '';
  for (let k = 0; k < 4 && !xml.includes('<hierarchy'); k++) {
    try {
      // Remove the previous dump first: when the UI never idles, uiautomator can leave an old file behind.
      adb(['shell', 'rm', '-f', '/sdcard/ui.xml'], { stdio: 'pipe' });
      const res = adb(['shell', 'uiautomator', 'dump', '--compressed', '/sdcard/ui.xml'], { stdio: 'pipe' }).toString();
      if (!res.includes('dumped')) continue;
      xml = adb(['shell', 'cat', '/sdcard/ui.xml']).toString('utf8');
    } catch {
      xml = '';
    }
  }
  const nodes = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = {};
    for (const p of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[p[1]] = decode(p[2]);
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(a.bounds ?? '');
    if (!b) continue;
    nodes.push({
      id: a['resource-id'] ?? '', text: a.text ?? '', desc: a['content-desc'] ?? '', enabled: a.enabled === 'true', selected: a.selected === 'true',
      checked: a.checked === 'true', x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4],
    });
  }
  return nodes;
}

/** Bounds are usable for tapping. Android reports odd rects (bottom above top) for views clipped by a scroll view. */
export function onScreen(n) {
  return n.x2 > n.x1 && n.y2 > n.y1;
}

export function find(nodes, sel, { visibleOnly = false } = {}) {
  return nodes.find((n) => (sel.id ? n.id === sel.id : true) && (sel.text ? n.text === sel.text || n.desc === sel.text : true)
    && (sel.contains ? (n.text + ' ' + n.desc).includes(sel.contains) : true) && (!visibleOnly || onScreen(n)));
}

export async function waitFor(sel, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  let nodes = [];
  while (Date.now() < end) {
    nodes = dump();
    // A system "isn't responding" dialog (e.g. the launcher on a slow CI emulator) can cover the app: dismiss it.
    // For our own app choose Wait; for anything else, Close app.
    const anr = nodes.find((x) => x.id === 'android:id/alertTitle' && /isn.t responding/i.test(x.text));
    if (anr) {
      const ours = /housefi/i.test(anr.text);
      const btn = nodes.find((x) => x.id === (ours ? 'android:id/aerr_wait' : 'android:id/aerr_close'));
      if (btn) {
        console.log(`  (dismissing system dialog: ${anr.text})`);
        tapXY((btn.x1 + btn.x2) / 2, (btn.y1 + btn.y2) / 2);
        await sleep(800);
        continue;
      }
    }
    const red = nodes.find((x) => /^(Console Error|Render Error|Uncaught Error|Syntax Error)$/.test(x.text));
    if (red) throw new Error(`App error on screen: ${nodes.map((x) => x.text).filter(Boolean).slice(0, 8).join(' | ')}`);
    const n = find(nodes, sel);
    if (n) return n;
    await sleep(400);
  }
  const visible = nodes.filter((n) => n.id || n.text).map((n) => (n.id ? `${n.id}${n.text ? `="${n.text}"` : ''}${n.enabled ? '' : '(disabled)'}` : n.text)).slice(0, 60).join(' | ');
  const { w, h } = screen();
  throw new Error(`Timed out waiting for ${JSON.stringify(sel)} (screen ${w}x${h}). On screen: ${visible}`);
}

export async function exists(sel) {
  return !!find(dump(), sel);
}

export function tapXY(x, y) {
  adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
}

export async function tap(sel, timeoutMs) {
  let n = await waitFor(sel, timeoutMs);
  if (!onScreen(n)) n = await scrollTo(sel);
  tapXY((n.x1 + n.x2) / 2, (n.y1 + n.y2) / 2);
  await sleep(450);
  return n;
}

/** Scrolls the main content until the selector is on screen (and not hidden under the footer). */
export async function scrollTo(sel, { maxSwipes = 10, bottomLimit = 0.86 } = {}) {
  const { h } = screen();
  // An open keyboard shrinks the window; close it so the target has room to settle.
  await hideKeyboard();
  let lastY = null;
  let lastDir = 0;
  let stride = 0.4;
  for (let k = 0; k <= maxSwipes; k++) {
    const all = find(dump(), sel);
    const n = all && onScreen(all) ? all : null;
    if (n && n.y2 < h * bottomLimit && n.y1 > h * 0.08) return n;
    // At the end of the list the element cannot move further up; accept it if it is fully on screen.
    if (n && lastY !== null && n.y1 === lastY && n.y2 < h * 0.97) return n;
    lastY = n ? n.y1 : null;
    const dir = n && n.y1 <= h * 0.08 ? -1 : 1;
    // Overshot the other way: halve the swipe so it settles instead of bouncing past the visible band.
    if (lastDir !== 0 && dir !== lastDir) stride = Math.max(0.1, stride / 2);
    lastDir = dir;
    if (dir < 0) swipe(0.3, 0.3 + stride);
    else swipe(0.72, 0.72 - stride);
    await sleep(500);
  }
  const last = find(dump(), sel);
  throw new Error(`Could not scroll to ${JSON.stringify(sel)} (screen ${h}px high, element ${last ? `${last.y1}-${last.y2}` : 'not on screen'}, keyboard ${keyboardShown() ? 'open' : 'closed'})`);
}

let size = null;
export function screen() {
  if (!size) {
    const out = adb(['shell', 'wm', 'size']).toString();
    const all = [...out.matchAll(/(\d+)x(\d+)/g)];
    const m = all[all.length - 1];
    size = { w: +m[1], h: +m[2] };
  }
  return size;
}

export function resetScreenCache() {
  size = null;
}

export function swipe(fromFrac, toFrac, xFrac = 0.5) {
  const { w, h } = screen();
  adb(['shell', 'input', 'swipe', String(Math.round(w * xFrac)), String(Math.round(h * fromFrac)), String(Math.round(w * xFrac)), String(Math.round(h * toFrac)), '350']);
}

export function swipeH(fromFrac, toFrac, yFrac = 0.5) {
  const { w, h } = screen();
  adb(['shell', 'input', 'swipe', String(Math.round(w * fromFrac)), String(Math.round(h * yFrac)), String(Math.round(w * toFrac)), String(Math.round(h * yFrac)), '300']);
}

export function typeText(s) {
  adb(['shell', 'input', 'text', s.replace(/ /g, '%s')]);
}

function keyboardShown() {
  return adb(['shell', 'dumpsys', 'input_method']).toString().includes('mInputShown=true');
}

const norm = (t) => t.replace(/[^0-9A-Za-z]/g, '').toLowerCase();

/**
 * Taps a text field, waits for the keyboard, types in small chunks (adb drops characters when typing fast) and
 * checks the field now shows the text; clears and retries if it does not.
 */
export async function typeInto(sel, text, { attempts = 3 } = {}) {
  for (let k = 1; k <= attempts; k++) {
    await tap(sel);
    for (let w = 0; w < 15 && !keyboardShown(); w++) await sleep(200);
    for (let i = 0; i < text.length; i += 8) {
      typeText(text.slice(i, i + 8));
      await sleep(150);
    }
    await sleep(400);
    const n = find(dump(), sel);
    if (n && norm(n.text).includes(norm(text))) return;
    // Clear: move to the end and delete everything, then try again.
    key(123);
    for (let d = 0; d < Math.max(12, (n?.text.length ?? 0) + 4); d++) key(67);
  }
  throw new Error(`Could not type into ${JSON.stringify(sel)}`);
}

export function key(code) {
  adb(['shell', 'input', 'keyevent', String(code)]);
}

export async function hideKeyboard() {
  if (!keyboardShown()) return;
  key(111); // ESCAPE closes the keyboard without navigating back
  await sleep(300);
  // ESCAPE puts Android into keyboard-navigation mode (focus highlights); one touch on the empty header centre
  // returns it to touch mode.
  const { w, h } = screen();
  tapXY(w / 2, h * 0.075);
  await sleep(300);
  // Some Android versions keep the number pad open after ESCAPE; BACK closes an open keyboard without navigating.
  // The reported state lags, so wait for it to settle first: BACK with no keyboard open would leave the screen.
  for (let i = 0; i < 6 && keyboardShown(); i++) await sleep(250);
  if (keyboardShown()) {
    key(4);
    await sleep(400);
  }
}

export function shot(path) {
  mkdirSync(dirname(path), { recursive: true });
  const png = adb(['exec-out', 'screencap', '-p']);
  writeFileSync(path, png);
  return png;
}

/** The app's window has FLAG_SECURE set (no screenshots or recordings), as reported by the window manager. */
export function windowIsSecure() {
  const all = adb(['shell', 'dumpsys', 'window', 'windows']).toString();
  const ours = all.split('Window #').filter((w) => w.includes(`${PKG}/`) && /mAttrs=/.test(w));
  if (ours.length === 0) throw new Error('app window not found in dumpsys window');
  return ours.some((w) => /\bfl=[^\n]*\bSECURE\b/.test(w));
}

/**
 * True when a screenshot shows nothing: the system returned no image, or every pixel has the same colour (a secure
 * window is captured as a flat black frame). Decodes the PNG (8-bit RGB / RGBA, not interlaced) with no dependencies.
 */
export function isBlankScreenshot(png) {
  if (png.length === 0) return true;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const depth = png[24];
  const type = png[25];
  if (depth !== 8 || (type !== 2 && type !== 6) || png[28] !== 0) throw new Error(`unexpected PNG format (depth ${depth}, type ${type})`);
  const bpp = type === 6 ? 4 : 3;
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    const kind = png.toString('ascii', at + 4, at + 8);
    if (kind === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * bpp;
  let prev = Buffer.alloc(stride);
  let first = null;
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      line[x] = (line[x] + pred) & 0xff;
    }
    for (let x = 0; x < stride; x += bpp) {
      const px = line.readUIntBE(x, 3);
      if (first === null) first = px;
      else if (px !== first) return false;
    }
    prev = line;
  }
  return true;
}

export function launch({ clear = false } = {}) {
  // A sleeping screen ignores taps (the layout is still readable, so the failure looks like taps "not working").
  adb(['shell', 'svc', 'power', 'stayon', 'true'], { stdio: 'pipe' });
  adb(['shell', 'settings', 'put', 'system', 'screen_off_timeout', '2147483647'], { stdio: 'pipe' });
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], { stdio: 'pipe' });
  adb(['shell', 'wm', 'dismiss-keyguard'], { stdio: 'pipe' });
  adb(['shell', 'am', 'force-stop', PKG]);
  if (clear) adb(['shell', 'pm', 'clear', PKG]);
  adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'pipe' });
}

export function back() {
  key(4);
}

/**
 * Taps `sel` until `next` appears (a tap right after the keyboard closes can be swallowed on some Android versions).
 * Safe for navigation buttons: a second tap only happens when nothing changed.
 */
export async function tapUntil(sel, next, { tries = 3, waitMs = 8000 } = {}) {
  for (let k = 1; k <= tries; k++) {
    await tap(sel);
    try {
      return await waitFor(next, waitMs);
    } catch (e) {
      if (k === tries) throw e;
      console.log(`  (retrying tap on ${JSON.stringify(sel)})`);
    }
  }
  return null;
}

/** Prints the app's crash / JS error lines from the device log (for CI diagnosis after a failure). */
export function printDeviceErrors() {
  try {
    const log = adb(['logcat', '-d', '-v', 'brief']).toString('utf8');
    const lines = log.split(/\r?\n/).filter((l) => /AndroidRuntime|FATAL|ReactNativeJS|E\/ReactNative|housefi/.test(l));
    console.error('--- device log (app errors) ---');
    console.error(lines.slice(-80).join('\n'));
    console.error(`--- app process: ${adb(['shell', 'pidof', PKG]).toString().trim() || 'not running'} ---`);
    const ime = adb(['shell', 'dumpsys', 'input_method']).toString().split(/\r?\n/).filter((l) => /mInputShown|mServedView|mIsInputViewShown/.test(l));
    console.error(`--- keyboard: ${ime.map((l) => l.trim()).join(' | ')} ---`);
    const win = adb(['shell', 'dumpsys', 'window']).toString().split(/\r?\n/).filter((l) => /mCurrentFocus|mInTouchMode/.test(l));
    console.error(`--- window: ${win.map((l) => l.trim()).join(' | ')} ---`);
  } catch (e) {
    console.error(`could not read device log: ${e.message}`);
  }
}
