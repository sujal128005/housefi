// Path 1 journey on a running Android emulator/device: fresh install state -> welcome -> language -> customer ->
// phone + demo OTP -> name -> home -> search -> category -> service -> issue (chips, voice, photos) -> summary ->
// new address -> schedule -> review -> confirmed -> matching -> technician assigned. Screenshots go to
// docs/screens/path1/<locale>/. Usage: node tools/path1-journey.mjs [en|te] [outDir]
import {
  back, exists, hideKeyboard, key, launch, scrollTo, shot, sleep, swipe, tap, tapXY, typeInto, typeText, waitFor,
} from './android-driver.mjs';
import { printDeviceErrors } from './android-driver.mjs';

const locale = process.argv[2] === 'te' ? 'te' : 'en';
const out = process.argv[3] ?? `docs/screens/path1/${locale}`;
let n = 0;
const snap = async (name) => {
  await sleep(700);
  n += 1;
  const file = `${out}/${String(n).padStart(2, '0')}-${name}.png`;
  shot(file);
  console.log(`  shot ${file}`);
};
const step = (s) => console.log(`- ${s}`);

async function main() {
  step('fresh start');
  launch({ clear: true });
  await waitFor({ id: 'welcome' }, 180000);
  await snap('welcome-1');
  await tap({ id: 'welcome-next' });
  await sleep(500);
  await snap('welcome-2');
  await tap({ id: 'welcome-next' });
  await sleep(500);
  await snap('welcome-3');
  await tap({ id: 'welcome-next' });

  step('language');
  await waitFor({ id: 'language' });
  await tap({ id: `lang-${locale}` });
  await snap('language');
  await tap({ id: 'language-continue' });

  step('interface');
  await waitFor({ id: 'role' });
  await snap('interface');
  await tap({ id: 'role-customer' });

  step('phone sign-in');
  await waitFor({ id: 'auth-phone' });
  await snap('phone-empty');
  // An invalid number first (starts with 5): the error shows and Send stays off.
  await typeInto({ id: 'phone-input' }, '5876543210');
  await hideKeyboard();
  await snap('phone-invalid');
  await tap({ id: 'phone-input' });
  key(123);
  for (let k = 0; k < 14; k++) key(67);
  await typeInto({ id: 'phone-input' }, '9876543210');
  await hideKeyboard();
  await snap('phone-filled');
  await tap({ id: 'phone-send' });

  step('otp');
  await waitFor({ id: 'demo-sms' }, 20000);
  await hideKeyboard();
  await snap('otp');
  await tap({ id: 'otp-boxes' });
  await sleep(600);
  typeText('000000');
  await sleep(1500);
  await hideKeyboard();
  if (await exists({ id: 'otp-problem' })) await snap('otp-wrong-code');
  await tap({ id: 'demo-fill' });

  step('name');
  await waitFor({ id: 'auth-name' }, 20000);
  await typeInto({ id: 'name-input' }, 'Priya Sharma');
  await hideKeyboard();
  await snap('name');
  await tap({ id: 'name-save' });

  step('demo settings: slow matching, so every matching state shows');
  await waitFor({ id: 'home' }, 20000);
  await tap({ id: 'tab-account' });
  await tap({ id: 'account-demo' });
  await waitFor({ id: 'demo-settings' });
  await tap({ id: 'demo-matching-SLOW' });
  await snap('demo-settings');
  back();
  await tap({ id: 'tab-home' });

  step('home');
  await waitFor({ id: 'home' }, 20000);
  await waitFor({ id: 'cat-PLUMBING' }, 20000);
  await snap('home');
  swipe(0.75, 0.3);
  await snap('home-scrolled');
  swipe(0.3, 0.8);

  step('search');
  await tap({ id: 'home-search' });
  await waitFor({ id: 'search' });
  await hideKeyboard();
  await snap('search-empty');
  await typeInto({ id: 'search-input' }, 'fan');
  await sleep(500);
  await hideKeyboard();
  await snap('search-results');
  back();
  await sleep(400);
  if (await exists({ id: 'search' })) back();

  step('category and service');
  await tap({ id: 'cat-PLUMBING' }, 20000);
  await waitFor({ id: 'svc-plumb-tap' }, 20000);
  await snap('category');
  await tap({ id: 'svc-plumb-tap' });
  await waitFor({ id: 'service-book' }, 20000);
  await snap('service-details');
  await tap({ id: 'service-book' });

  step('issue');
  await waitFor({ id: 'book-issue' });
  await snap('issue-empty');
  await tap({ id: 'issue-tap-leak' });
  await tap({ id: 'issue-voice' });
  await waitFor({ id: 'voice' });
  await snap('voice-idle');
  // While recording the waveform animates non-stop, so UI Automator cannot dump the screen; Stop sits exactly where
  // the mic button was.
  const mic = await tap({ id: 'voice-start' });
  await sleep(2600);
  await snap('voice-recording');
  tapXY((mic.x1 + mic.x2) / 2, (mic.y1 + mic.y2) / 2);
  await sleep(600);
  await snap('voice-recorded');
  await tap({ id: 'voice-use' });
  await tap({ id: 'issue-photos' });
  await waitFor({ id: 'photos' });
  await tap({ id: 'photos-camera' });
  await tap({ id: 'photos-gallery' });
  await snap('photos');
  await tap({ id: 'photos-done' });
  await waitFor({ id: 'book-issue' });
  await snap('issue-filled');
  await tap({ id: 'issue-next' });

  step('summary');
  await waitFor({ id: 'book-summary' });
  await snap('summary');
  await tap({ id: 'summary-next' });

  step('address');
  await waitFor({ id: 'book-address' });
  await waitFor({ id: 'address-add' }, 20000);
  await snap('address-empty');
  await tap({ id: 'address-add' });
  await waitFor({ id: 'address-edit' });
  await tap({ id: 'address-save' });
  await hideKeyboard();
  await snap('address-errors');
  await typeInto({ id: 'addr-house' }, 'Flat 4B, Lake View Apts');
  await typeInto({ id: 'addr-street' }, 'Road No. 12, Banjara Hills');
  await hideKeyboard();
  await scrollTo({ id: 'addr-pincode' });
  await typeInto({ id: 'addr-pincode' }, '500034');
  await hideKeyboard();
  await snap('address-form');
  await tap({ id: 'address-save' });
  await waitFor({ id: 'book-address' });
  await waitFor({ contains: 'Banjara' }, 20000);
  await snap('address-selected');
  await tap({ id: 'address-next' });

  step('schedule');
  await waitFor({ id: 'book-schedule' });
  await sleep(1500);
  await snap('schedule');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await tap({ id: `day-${iso}` });
  await sleep(1500);
  let picked = false;
  for (const h of [10, 12, 14, 16, 8, 18]) {
    const node = await scrollTo({ id: `slot-${h}` }).catch(() => null);
    if (node && node.enabled) {
      await tap({ id: `slot-${h}` });
      const after = await waitFor({ id: 'schedule-next' });
      if (after.enabled) {
        picked = true;
        break;
      }
    }
  }
  if (!picked) throw new Error('no open slot tomorrow');
  await snap('schedule-picked');
  await tap({ id: 'schedule-next' });

  step('review');
  await waitFor({ id: 'book-review' });
  await sleep(800);
  await snap('review');
  swipe(0.75, 0.25);
  await snap('review-scrolled');
  await tap({ id: 'review-confirm' });

  step('confirmed');
  await waitFor({ id: 'book-confirmed' }, 20000);
  await waitFor({ id: 'booking-code' }, 20000);
  await snap('confirmed');
  await tap({ id: 'confirmed-track' });

  step('matching -> assigned');
  // The matching screens animate continuously (UI Automator cannot dump them), so capture them on a timer:
  // slow scenario = searching for 7 s, then "taking longer", then assigned at 20 s.
  await sleep(2500);
  await snap('matching');
  await sleep(7000);
  await snap('still-searching');
  await waitFor({ id: 'status-ASSIGNED' }, 40000);
  await snap('assigned');
  swipe(0.75, 0.3);
  await snap('assigned-details');
  back();

  step('home and bookings with the active booking');
  await waitFor({ id: 'home' }, 20000);
  await sleep(1500);
  await snap('home-active-booking');
  await tap({ id: 'tab-bookings' });
  await waitFor({ id: 'bookings' });
  await sleep(1200);
  await snap('bookings');
  await tap({ id: 'tab-account' });
  await waitFor({ id: 'account' });
  await snap('account');
  console.log(`PATH 1 JOURNEY PASSED (${locale}), ${n} screenshots`);
}

main().catch((e) => {
  console.error(`JOURNEY FAILED at shot ${n}: ${e.message}`);
  printDeviceErrors();
  try {
    shot(`${out}/FAILED.png`);
  } catch {
    // ignore
  }
  process.exit(1);
});
