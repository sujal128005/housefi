// Error-handling check on a running Android emulator/device, run after app-journey.mjs (technician signed in).
// 1. Offline: Wi-Fi and mobile data off -> the offline strip shows over the current screen; back on -> "Back online".
// 2. An unexpected error (Demo settings -> "Test the error screen") -> branded fallback, never a red box or stack trace;
//    "Try again" recovers in place, "Go to home" returns home.
// (A single failed request is covered by the unit tests: the demo's "next request fails" switch is used up by whichever
// background refresh runs first, so it cannot be aimed at one screen reliably here.)
// Screenshots go to <outDir> (default docs/screens/app/recovery). Usage: node tools/recovery-check.mjs [outDir]
import { adb, dump, exists, printDeviceErrors, scrollTo, shot, sleep, tap, waitFor } from './android-driver.mjs';

const out = process.argv[2] ?? 'docs/screens/app/recovery';
let n = 0;
const snap = async (name) => {
  await sleep(700);
  n += 1;
  const file = `${out}/${String(n).padStart(2, '0')}-${name}.png`;
  shot(file);
  console.log(`  shot ${file}`);
};
const step = (s) => console.log(`- ${s}`);
const open = async (path) => {
  adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `housefi://${path}`, 'app.housefi.mobile'], { stdio: 'pipe' });
  await sleep(1500);
};
const network = (on) => {
  adb(['shell', 'svc', 'wifi', on ? 'enable' : 'disable']);
  adb(['shell', 'svc', 'data', on ? 'enable' : 'disable']);
};

/** No developer error screen, stack trace or raw error text anywhere on screen. */
function assertNoTechnicalText() {
  const text = dump().map((x) => `${x.text} ${x.desc}`).join(' | ');
  const bad = /(Render Error|Uncaught|TypeError|ReferenceError|stack|at [A-Za-z]+ \(|\.tsx?:\d+|Demo: simulated app error)/.exec(text);
  if (bad) throw new Error(`Technical text on screen: "${bad[0]}" in ${text.slice(0, 400)}`);
}

async function main() {
  step('offline strip over the current screen');
  await open('tech/earnings');
  await waitFor({ id: 'tech-earnings' }, 20000);
  network(false);
  await waitFor({ id: 'offline-banner' }, 20000);
  await snap('offline');
  if (!(await exists({ id: 'tech-earnings' }))) throw new Error('the screen under the offline strip was replaced');
  network(true);
  // "Back online" shows for 2.5 s, which a slow screen read can miss; the offline strip going away is the real signal.
  const end = Date.now() + 30000;
  let sawBack = false;
  for (;;) {
    const ids = dump().map((x) => x.id);
    if (ids.includes('online-banner')) {
      sawBack = true;
      await snap('back-online');
      break;
    }
    if (!ids.includes('offline-banner')) break;
    if (Date.now() > end) throw new Error('still offline 30 s after turning the network back on');
    await sleep(300);
  }
  if (!(await exists({ id: 'tech-earnings' }))) throw new Error('the screen changed when the network came back');
  console.log(`  back online${sawBack ? ' ("Back online" shown)' : ' (offline strip gone; "Back online" already faded)'}`);

  step('unexpected error: branded fallback, Try again recovers in place');
  await open('demo');
  await waitFor({ id: 'demo-settings' });
  await scrollTo({ id: 'demo-crash' });
  await tap({ id: 'demo-crash' });
  await waitFor({ id: 'app-error' });
  assertNoTechnicalText();
  await snap('error-screen');
  await tap({ id: 'app-error-retry' });
  await waitFor({ id: 'demo-settings' });
  await snap('error-retried');

  step('unexpected error: Go to home');
  await scrollTo({ id: 'demo-crash' });
  await tap({ id: 'demo-crash' });
  await waitFor({ id: 'app-error' });
  await tap({ id: 'app-error-home' });
  await waitFor({ id: 'tech-home' }, 20000);
  await snap('error-home');
  console.log('recovery check passed');
}

main().catch((e) => {
  network(true);
  console.error(e.message);
  printDeviceErrors();
  process.exit(1);
});
