// Launch check on a running Android emulator/device with the release build installed: the app opens, the first
// screens work in both languages, the offline strip appears with the network off, and nothing crashes or shows
// technical text. Signing in needs the live API (an SMS code), so the full customer + technician journey is tested
// against a local API instead (see docs/backend/INTEGRATION.md).
// Screenshots go to <outDir> (default docs/screens/app/launch). Usage: node tools/launch-check.mjs [outDir] [apk]
// With an APK path it first waits for the emulator to finish booting and installs it (with retries: a freshly booted
// emulator on a CI runner is sometimes not ready). On failure it saves a screenshot and the screen's text, and prints
// the reason as a GitHub annotation, so the cause is readable without the full log.
import { writeFileSync, mkdirSync } from 'node:fs';
import { adb, dump, launch, PKG, printDeviceErrors, shot, sleep, tap, tapUntil, waitFor } from './android-driver.mjs';

const out = process.argv[2] ?? 'docs/screens/app/launch';
const apk = process.argv[3];
let n = 0;
const snap = async (name) => {
  await sleep(700);
  n += 1;
  const file = `${out}/${String(n).padStart(2, '0')}-${name}.png`;
  shot(file);
  console.log(`  shot ${file}`);
};
const step = (s) => console.log(`- ${s}`);
const network = (on) => {
  adb(['shell', 'svc', 'wifi', on ? 'enable' : 'disable']);
  adb(['shell', 'svc', 'data', on ? 'enable' : 'disable']);
};

/** No developer error screen, stack trace or raw error text anywhere on screen, and the app is still running. */
function assertHealthy() {
  const text = dump().map((x) => `${x.text} ${x.desc}`).join(' | ');
  const bad = /(Render Error|Uncaught|TypeError|ReferenceError|stack|at [A-Za-z]+ \(|\.tsx?:\d+)/.exec(text);
  if (bad) throw new Error(`Technical text on screen: "${bad[0]}" in ${text.slice(0, 400)}`);
  if (!adb(['shell', 'pidof', PKG]).toString().trim()) throw new Error('the app is not running (crashed?)');
}

const quiet = (args) => {
  try {
    return adb(args, { stdio: 'pipe' }).toString().trim();
  } catch {
    return '';
  }
};

async function bootAndInstall() {
  step('wait for the emulator to finish booting');
  for (let i = 0; i < 90 && quiet(['shell', 'getprop', 'sys.boot_completed']) !== '1'; i++) await sleep(2000);
  for (let i = 0; i < 30 && !quiet(['shell', 'pm', 'path', 'android']).startsWith('package:'); i++) await sleep(2000);
  step(`install ${apk}`);
  for (let k = 1; ; k++) {
    try {
      adb(['install', '-r', apk], { stdio: 'pipe' });
      return;
    } catch (e) {
      if (k === 3) throw new Error(`install failed 3 times: ${String(e.stderr ?? e.message).slice(0, 300)}`);
      console.log(`  (install attempt ${k} failed, retrying)`);
      await sleep(15000);
    }
  }
}

async function main() {
  if (apk) await bootAndInstall();
  adb(['logcat', '-c']);
  step('first start');
  launch({ clear: true });
  try {
    await waitFor({ id: 'welcome' }, 120000);
  } catch {
    // A cold first start on a slow emulator can miss the window; one more try before calling it a failure.
    console.log('  (welcome screen not up yet; starting the app again)');
    launch();
    await waitFor({ id: 'welcome' }, 120000);
  }
  await snap('welcome');
  assertHealthy();

  step('language: Telugu, then English');
  await tapUntil({ id: 'welcome-skip' }, { id: 'language' });
  await tap({ id: 'lang-te' });
  await snap('language-te');
  await tap({ id: 'lang-en' });
  await tapUntil({ id: 'language-continue' }, { id: 'role' });
  await snap('role');
  assertHealthy();

  step('customer sign-in screen');
  await tapUntil({ id: 'role-customer' }, { id: 'auth-phone' });
  await snap('phone');
  assertHealthy();

  step('offline strip');
  network(false);
  try {
    await waitFor({ id: 'offline-banner' }, 20000);
    await snap('offline');
  } finally {
    network(true);
  }
  await waitFor({ id: 'auth-phone' }, 20000);
  assertHealthy();

  const crash = adb(['logcat', '-d', '-v', 'brief']).toString('utf8').split(/\r?\n/).find((l) => /FATAL EXCEPTION|AndroidRuntime: FATAL/.test(l));
  if (crash) throw new Error(`crash in the device log: ${crash}`);
  console.log('Launch check passed.');
}

main().catch((e) => {
  console.error(e);
  printDeviceErrors();
  let screen = '';
  try {
    screen = dump().map((x) => x.id || x.text).filter(Boolean).slice(0, 40).join(' | ');
    shot(`${out}/failure.png`);
  } catch {
    // The device may be gone.
  }
  const running = quiet(['shell', 'pidof', PKG]) ? 'running' : 'not running';
  const crash = quiet(['logcat', '-d', '-v', 'brief']).split(/\r?\n/).filter((l) => /FATAL|AndroidRuntime|ReactNativeJS.*Error/.test(l)).slice(-5).join(' / ');
  const reason = `${String(e.message ?? e).slice(0, 300)}; app ${running}; screen: ${screen.slice(0, 400) || '(empty)'}; device errors: ${crash.slice(0, 600) || '(none)'}`;
  try {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/failure.txt`, `${reason}\n`);
  } catch {
    // Best effort.
  }
  console.log(`::error title=Android launch check::${reason.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
  process.exit(1);
});
