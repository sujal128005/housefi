// Minimal Android UI driver for journey tests: finds views by testID (exposed as resource-id), taps, types,
// scrolls and takes screenshots through adb. No extra dependencies.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
export async function scrollTo(sel, { maxSwipes = 8, bottomLimit = 0.86 } = {}) {
  const { h } = screen();
  let lastY = null;
  for (let k = 0; k <= maxSwipes; k++) {
    const all = find(dump(), sel);
    const n = all && onScreen(all) ? all : null;
    if (n && n.y2 < h * bottomLimit && n.y1 > h * 0.08) return n;
    // At the end of the list the element cannot move further up; accept it if it is fully on screen.
    if (n && lastY !== null && n.y1 === lastY && n.y2 < h * 0.97) return n;
    lastY = n ? n.y1 : null;
    if (n && n.y1 <= h * 0.08) swipe(0.3, 0.6);
    else swipe(0.72, 0.32);
    await sleep(500);
  }
  throw new Error(`Could not scroll to ${JSON.stringify(sel)}`);
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
  const shown = adb(['shell', 'dumpsys', 'input_method']).toString().includes('mInputShown=true');
  if (shown) {
    key(111); // ESCAPE closes the keyboard without navigating back
    await sleep(300);
    // ESCAPE puts Android into keyboard-navigation mode (focus highlights); one touch on the empty header centre
    // returns it to touch mode.
    const { w, h } = screen();
    tapXY(w / 2, h * 0.075);
    await sleep(300);
  }
}

export function shot(path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, adb(['exec-out', 'screencap', '-p']));
}

export function launch({ clear = false } = {}) {
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
