// Path 1 edge states on Android: technician placeholder, simulated network error + retry, empty bookings and search,
// "slot just filled" on submit, no technician found, reschedule, cancel. Screenshots go to docs/screens/path1/states.
// Usage: node tools/path1-states.mjs [outDir]
import {
  back, exists, hideKeyboard, key, launch, scrollTo, shot, sleep, swipe, tap, tapUntil, typeInto, waitFor,
} from './android-driver.mjs';
import { printDeviceErrors } from './android-driver.mjs';

const out = process.argv[2] ?? 'docs/screens/path1/states';
let n = 0;
const snap = async (name) => {
  await sleep(700);
  n += 1;
  const file = `${out}/${String(n).padStart(2, '0')}-${name}.png`;
  shot(file);
  console.log(`  shot ${file}`);
};
const step = (s) => console.log(`- ${s}`);

async function openDemoSettings() {
  await tap({ id: 'tab-account' });
  await tap({ id: 'account-demo' });
  await waitFor({ id: 'demo-settings' });
}

async function pickSlot() {
  for (const day of [1, 2, 3]) {
    const d = new Date();
    d.setDate(d.getDate() + day);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await tap({ id: `day-${iso}` });
    await sleep(1500);
    for (const h of [8, 10, 12, 14, 16, 18]) {
      const node = await scrollTo({ id: `slot-${h}` }).catch(() => null);
      if (node && node.enabled) {
        await tap({ id: `slot-${h}` });
        if ((await waitFor({ id: 'schedule-next' })).enabled) return;
      }
    }
    swipe(0.35, 0.75);
  }
  throw new Error('no open slot');
}

async function main() {
  step('technician interface placeholder');
  launch({ clear: true });
  await waitFor({ id: 'welcome' }, 180000);
  await tap({ id: 'welcome-skip' });
  await tap({ id: 'lang-en' });
  await tap({ id: 'language-continue' });
  await tap({ id: 'role-technician' });
  await waitFor({ id: 'technician-soon' });
  await snap('technician-placeholder');
  await tap({ id: 'tech-switch' });
  await tap({ id: 'role-customer' });

  step('sign in');
  await typeInto({ id: 'phone-input' }, '9123456789');
  await hideKeyboard();
  await tapUntil({ id: 'phone-send' }, { id: 'demo-fill' });
  await tap({ id: 'demo-fill' }, 20000);
  await waitFor({ id: 'name-input' }, 20000);
  await typeInto({ id: 'name-input' }, 'Ravi');
  await hideKeyboard();
  await tapUntil({ id: 'name-save' }, { id: 'home' });
  await waitFor({ id: 'home' }, 20000);

  step('empty bookings and empty search');
  await tap({ id: 'tab-bookings' });
  await waitFor({ id: 'bookings-empty' }, 20000);
  await snap('bookings-empty');
  await tap({ id: 'tab-home' });
  await tap({ id: 'home-search' });
  await typeInto({ id: 'search-input' }, 'zzqx');
  await hideKeyboard();
  await waitFor({ id: 'search-empty' });
  await snap('search-no-results');
  back();
  await sleep(500);
  if (await exists({ id: 'search' })) back();

  step('simulated network error, then retry');
  await openDemoSettings();
  await tap({ id: 'demo-fail-network' });
  await snap('demo-settings-fail-network');
  back();
  // Account makes no background requests, so the next request is the address list.
  await tap({ id: 'account-addresses' });
  await waitFor({ id: 'error-view' }, 20000);
  await snap('network-error');
  await tap({ id: 'retry' });
  await waitFor({ id: 'address-add' }, 20000);
  await snap('after-retry');
  back();

  step('next booking: slot just filled, and no technician found');
  await openDemoSettings();
  await tap({ id: 'demo-fail-slot' });
  await tap({ id: 'demo-matching-NONE' });
  await snap('demo-settings-slot-none');
  back();
  await tap({ id: 'tab-home' });
  await tap({ id: 'cat-ELECTRICAL' }, 20000);
  await tap({ id: 'svc-elec-fan' }, 20000);
  await tap({ id: 'service-book' }, 20000);
  await tap({ id: 'issue-fan-dead' });
  await tap({ id: 'issue-next' });
  await tap({ id: 'summary-next' });
  await tap({ id: 'address-add' }, 20000);
  await tap({ id: 'label-WORK' });
  await typeInto({ id: 'addr-house' }, 'Office 301, Cyber Towers');
  await typeInto({ id: 'addr-street' }, 'Hitech City, Madhapur');
  await hideKeyboard();
  await scrollTo({ id: 'addr-pincode' });
  await typeInto({ id: 'addr-pincode' }, '518001');
  await hideKeyboard();
  await tap({ id: 'address-save' });
  await hideKeyboard();
  await snap('address-outside-area');
  await tap({ id: 'addr-pincode' });
  key(123);
  for (let k = 0; k < 8; k++) key(67); // delete the old PIN
  await typeInto({ id: 'addr-pincode' }, '500081');
  await hideKeyboard();
  await tap({ id: 'address-save' });
  await tap({ id: 'address-next' }, 20000);
  await waitFor({ id: 'book-schedule' });
  await pickSlot();
  await tap({ id: 'schedule-next' });
  await tap({ id: 'review-confirm' }, 20000);
  await waitFor({ id: 'slot-taken' }, 20000);
  await snap('slot-just-filled');
  await tap({ id: 'review-choose-time' });
  await waitFor({ id: 'book-schedule' });
  await pickSlot();
  await tap({ id: 'schedule-next' });
  await tap({ id: 'review-confirm' }, 20000);
  await tap({ id: 'confirmed-track' }, 20000);
  await waitFor({ id: 'status-UNFULFILLED' }, 40000);
  await snap('no-technician');

  step('reschedule, then cancel');
  await tap({ id: 'unfulfilled-change-time' });
  await waitFor({ id: 'book-schedule' });
  await pickSlot();
  await snap('reschedule-pick');
  await tap({ id: 'schedule-next' });
  await sleep(2500);
  await snap('rescheduled-matching');
  await waitFor({ id: 'status-UNFULFILLED' }, 40000);
  await scrollTo({ id: 'cancel-booking' });
  await tap({ id: 'cancel-booking' });
  await waitFor({ id: 'confirm-sheet' });
  await tap({ id: 'reason-PLANS_CHANGED' });
  await snap('cancel-sheet');
  await tap({ id: 'confirm-yes' });
  await waitFor({ id: 'status-CANCELLED' }, 20000);
  await snap('cancelled');
  back();
  await tap({ id: 'tab-bookings' }, 20000);
  await tap({ id: 'seg-PAST' });
  await sleep(1200);
  await snap('bookings-past');
  console.log(`PATH 1 STATES PASSED, ${n} screenshots`);
}

main().catch((e) => {
  console.error(`STATES FAILED at shot ${n}: ${e.message}`);
  printDeviceErrors();
  try {
    shot(`${out}/FAILED.png`);
  } catch {
    // ignore
  }
  process.exit(1);
});
