// Launch check on a running Android emulator/device with the release build installed: the app opens, the first
// screens work in both languages, the offline strip appears with the network off, and nothing crashes or shows
// technical text. Signing in needs the live API (an SMS code), so the full customer + technician journey is tested
// against a local API instead (see docs/backend/INTEGRATION.md).
// Screenshots go to <outDir> (default docs/screens/app/launch). Usage: node tools/launch-check.mjs [outDir]
import { adb, dump, launch, PKG, printDeviceErrors, shot, sleep, tap, tapUntil, waitFor } from './android-driver.mjs';

const out = process.argv[2] ?? 'docs/screens/app/launch';
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

async function main() {
  adb(['logcat', '-c']);
  step('first start');
  launch({ clear: true });
  await waitFor({ id: 'welcome' }, 60000);
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
  process.exit(1);
});
