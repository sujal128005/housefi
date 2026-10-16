// End-to-end journey on a running Android emulator/device, both interfaces of the app.
// Customer: fresh start -> welcome -> language -> customer -> phone + demo OTP -> name -> home (AI top problems) ->
//   snap a sample photo (AI suggestion) -> problem + voice note -> new address -> schedule -> confirm & pay (auto) ->
//   confirmed -> tracking (assigned, on the way, arrived) -> quote pop-up -> approve -> pay the bill -> receipt ->
//   "Satisfied?" rating.
// Technician: switch interface -> phone + OTP -> profile -> verification -> online -> practice job offer -> accept ->
//   trip -> start code -> quote (120 labour + 200 material) -> simulated customer approves -> repair -> complete ->
//   simulated customer pays -> summary -> earnings.
// Screenshots go to <outDir> (default docs/screens/app/<locale>). Usage: node tools/app-journey.mjs [en|te] [outDir]
import {
  back, dump, exists, hideKeyboard, launch, scrollTo, shot, sleep, swipe, tap, tapUntil, tapXY, typeInto, waitFor,
} from './android-driver.mjs';
import { printDeviceErrors } from './android-driver.mjs';

const locale = process.argv[2] === 'te' ? 'te' : 'en';
const out = process.argv[3] ?? `docs/screens/app/${locale}`;
let n = 0;
const snap = async (name) => {
  await sleep(700);
  n += 1;
  const file = `${out}/${String(n).padStart(2, '0')}-${name}.png`;
  shot(file);
  console.log(`  shot ${file}`);
};
const step = (s) => console.log(`- ${s}`);

/** First element whose test id starts with `prefix`. */
async function firstWithPrefix(prefix, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const hit = dump().find((x) => x.id.startsWith(prefix));
    if (hit) return hit;
    await sleep(400);
  }
  throw new Error(`nothing with id prefix ${prefix}`);
}

/** The quote pop-up can appear over any screen; answer it with "Review" when it does. */
async function dismissQuoteAlert() {
  if (await exists({ id: 'alert-review' })) {
    await snap('quote-popup');
    await tap({ id: 'alert-review' });
    await sleep(800);
  }
}

/** Waits for a booking status on the hub, answering the quote pop-up ("Review") if it covers the screen. */
const ORDER = ['MATCHING', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'QUOTE_SHARED', 'IN_PROGRESS', 'EXTRA_WORK', 'PAYMENT_DUE', 'COMPLETED'];

/**
 * Waits until the booking is at `status` or a later step (the simulated technician runs on real time, so a slow
 * device can skip past an intermediate step). Answers the quote pop-up ("Review") if it covers the screen.
 * Returns the status found.
 */
async function waitStatus(status, timeoutMs = 30000) {
  const want = ORDER.slice(ORDER.indexOf(status));
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await exists({ id: 'alert-review' })) await dismissQuoteAlert();
    const hit = dump().find((x) => x.id.startsWith('status-') && want.includes(x.id.slice(7)));
    if (hit) return hit.id.slice(7);
    await scrollToTop();
    await sleep(800);
  }
  await waitFor({ id: `status-${status}` }, 1000);
  return status;
}

async function simulateNext(times = 1) {
  for (let k = 0; k < times; k++) {
    // Scroll down to the demo link, answering the quote pop-up whenever it appears in between.
    let link = null;
    for (let s = 0; s < 12 && !link; s++) {
      await dismissQuoteAlert();
      const nodes = dump();
      const n = nodes.find((x) => x.id === 'demo-simulate' && x.y2 > x.y1);
      if (n && n.y1 > 200 && n.y2 < 2400 * 0.97) link = n;
      else {
        swipe(0.72, 0.32);
        await sleep(400);
      }
    }
    if (!link) {
      // No demo link: the booking finished its timed steps (e.g. waiting for the customer's answer).
      break;
    }
    tapXY((link.x1 + link.x2) / 2, (link.y1 + link.y2) / 2);
    await sleep(700);
    await dismissQuoteAlert();
    if (await exists({ id: 'sim-next' })) await tap({ id: 'sim-next' });
    await sleep(1500);
  }
  await scrollToTop();
}

/** Back to the top of a scrolled screen (the status hero lives there; off-screen views are not in the UI dump). */
async function scrollToTop() {
  for (let k = 0; k < 4; k++) {
    swipe(0.3, 0.85);
    await sleep(250);
  }
}

async function customer() {
  step('fresh start');
  launch({ clear: true });
  await waitFor({ id: 'welcome' }, 180000);
  await snap('welcome');
  for (let k = 0; k < 3; k++) {
    await tap({ id: 'welcome-next' });
    await sleep(400);
  }

  step('language and interface');
  await waitFor({ id: 'language' });
  await tap({ id: `lang-${locale}` });
  await snap('language');
  await tap({ id: 'language-continue' });
  await waitFor({ id: 'role' });
  await snap('interface');
  await tap({ id: 'role-customer' });

  step('phone sign-in');
  await waitFor({ id: 'auth-phone' });
  await typeInto({ id: 'phone-input' }, '9876543210');
  await hideKeyboard();
  await snap('phone');
  await tapUntil({ id: 'phone-send' }, { id: 'demo-sms' });
  await hideKeyboard();
  await snap('otp');
  await tap({ id: 'demo-fill' });
  await waitFor({ id: 'auth-name' }, 20000);
  await typeInto({ id: 'name-input' }, 'Priya Sharma');
  await hideKeyboard();
  await tapUntil({ id: 'name-save' }, { id: 'home' });

  step('home');
  await waitFor({ id: 'cat-PLUMBING' }, 20000);
  await snap('home');
  swipe(0.75, 0.3);
  await firstWithPrefix('top-'); // AI-ranked for the locality: ids vary, so wait for any
  await snap('home-top-problems');
  swipe(0.3, 0.8);

  step('snap the problem (AI)');
  await tap({ id: 'home-snap' });
  await waitFor({ id: 'book-snap' });
  await snap('snap');
  await scrollTo({ id: 'snap-sample-2' });
  await tap({ id: 'snap-sample-2' });
  await waitFor({ id: 'snap-suggestion' }, 20000);
  await snap('snap-suggestion');
  await tap({ id: 'snap-continue' });

  step('how can we help');
  await waitFor({ id: 'book-problem' });
  await tap({ id: 'issue-voice' });
  await waitFor({ id: 'voice' });
  const mic = await tap({ id: 'voice-start' });
  await sleep(2600);
  await snap('voice-recording');
  tapXY((mic.x1 + mic.x2) / 2, (mic.y1 + mic.y2) / 2);
  await waitFor({ id: 'voice-transcript' }, 20000);
  await snap('voice-ai-note');
  await tap({ id: 'voice-use' });
  await waitFor({ id: 'ai-note' }, 20000);
  await snap('problem');
  await tap({ id: 'issue-next' });

  step('address');
  await waitFor({ id: 'book-address' });
  await tap({ id: 'address-add' }, 20000);
  await waitFor({ id: 'address-edit' });
  await typeInto({ id: 'addr-house' }, 'Flat 4B, Lake View Apts');
  await typeInto({ id: 'addr-street' }, 'Road No. 12, Banjara Hills');
  await hideKeyboard();
  await scrollTo({ id: 'addr-city' });
  await typeInto({ id: 'addr-city' }, 'Hyderabad');
  await typeInto({ id: 'addr-pincode' }, '500034');
  await hideKeyboard();
  await snap('address-form');
  await tapUntil({ id: 'address-save' }, { id: 'book-address' });
  await waitFor({ contains: 'Banjara' }, 20000);
  await tap({ id: 'address-next' });

  step('when: schedule tomorrow');
  await waitFor({ id: 'book-when' });
  await snap('when');
  await tap({ id: 'mode-schedule' });
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
      const next = await waitFor({ id: 'schedule-next' });
      if (next.enabled) {
        picked = true;
        break;
      }
    }
  }
  if (!picked) throw new Error('no open slot tomorrow');
  await snap('when-picked');
  await tap({ id: 'schedule-next' });

  step('confirm & pay');
  await waitFor({ id: 'book-confirm' });
  await snap('confirm');
  swipe(0.75, 0.25);
  await snap('confirm-price');
  await tap({ id: 'review-confirm' });
  await waitFor({ id: 'pay-success' }, 30000);
  await snap('paid');
  await tap({ id: 'pay-continue' });
  await waitFor({ id: 'book-confirmed' }, 20000);
  await snap('confirmed');
  await tap({ id: 'confirmed-track' });

  step('tracking');
  await waitStatus('ASSIGNED');
  await sleep(1500);
  await snap('assigned');
  await simulateNext(1);
  if ((await waitStatus('EN_ROUTE')) === 'EN_ROUTE') await snap('on-the-way');
  if (ORDER.indexOf(await waitStatus('EN_ROUTE')) < ORDER.indexOf('QUOTE_SHARED')) await simulateNext(1);
  if ((await waitStatus('ARRIVED')) === 'ARRIVED') await snap('arrived-code');
  for (let k = 0; k < 2 && ORDER.indexOf(await waitStatus('ARRIVED')) < ORDER.indexOf('QUOTE_SHARED'); k++) await simulateNext(1);
  await sleep(2500);
  await dismissQuoteAlert();
  await waitStatus('QUOTE_SHARED');
  await scrollTo({ id: 'quote-card' });
  await snap('quote');
  await scrollTo({ id: 'quote-approve' });
  await tap({ id: 'quote-approve' });
  await scrollToTop();
  await waitStatus('IN_PROGRESS');
  await snap('repair');
  await simulateNext(1);
  await dismissQuoteAlert();
  await waitStatus('PAYMENT_DUE');
  await snap('bill');
  await scrollTo({ id: 'hub-pay-final' });
  await tap({ id: 'hub-pay-final' });
  await waitFor({ id: 'paymethod-UPI' });
  await tap({ id: 'paymethod-UPI' });
  await tap({ id: 'pay-now' });
  await waitFor({ id: 'pay-success' }, 30000);
  await snap('bill-paid');
  await tap({ id: 'pay-continue' });
  await waitFor({ id: 'receipt' }, 20000);
  await snap('receipt');
  back();

  step('rating');
  await scrollToTop();
  await waitStatus('COMPLETED');
  await scrollTo({ id: 'hub-rate' });
  await tap({ id: 'hub-rate' });
  await waitFor({ id: 'rate' });
  await tap({ id: 'rate-yes' });
  await snap('rate');
  await tap({ id: 'rate-submit' });
  await scrollToTop();
  await waitStatus('COMPLETED');
  back();
  await waitFor({ id: 'home' }, 20000);
}

async function technician() {
  step('switch to the technician app');
  await tap({ id: 'tab-account' });
  await waitFor({ id: 'account' });
  await snap('account');
  await scrollTo({ id: 'account-switch' });
  await tap({ id: 'account-switch' });
  await waitFor({ id: 'auth-phone' }, 20000);
  await typeInto({ id: 'phone-input' }, '9000000001');
  await hideKeyboard();
  await snap('tech-phone');
  await tapUntil({ id: 'phone-send' }, { id: 'demo-sms' });
  await tap({ id: 'demo-fill' });

  step('technician profile');
  await waitFor({ id: 'tech-setup' }, 20000);
  await snap('tech-setup');
  await typeInto({ id: 'tsetup-name' }, 'Swathi Naidu');
  await hideKeyboard();
  await tap({ id: 'tsetup-gender-F' });
  for (let k = 0; k < 5; k++) await tap({ id: 'tsetup-years-plus' });
  await scrollTo({ id: 'tsetup-skill-PLUMBING' });
  await tap({ id: 'tsetup-skill-PLUMBING' });
  await snap('tech-skills');
  await scrollTo({ id: 'tsetup-city' });
  await typeInto({ id: 'tsetup-city' }, 'Hyderabad');
  await typeInto({ id: 'tsetup-pincode' }, '500034');
  await hideKeyboard();
  await scrollTo({ id: 'tsetup-areas' });
  await typeInto({ id: 'tsetup-areas' }, 'Banjara Hills, Jubilee Hills');
  await hideKeyboard();
  await tapUntil({ id: 'tsetup-submit' }, { id: 'tech-verification' });

  step('verification');
  await sleep(1500);
  await snap('tech-verification-pending');
  await waitFor({ id: 'tverify-go' }, 30000);
  await snap('tech-verified');
  await tap({ id: 'tverify-go' });

  step('technician home: go online, practice job');
  await waitFor({ id: 'tech-home' }, 20000);
  await snap('tech-home-offline');
  await tap({ id: 'tech-online-switch' });
  await waitFor({ id: 'tech-practice' }, 20000);
  await snap('tech-home-online');
  await tap({ id: 'tech-practice' });

  step('job offer');
  await waitFor({ id: 'offer-accept' }, 20000);
  await snap('tech-offer');
  await tap({ id: 'offer-accept' });

  step('job: trip, arrive, start code');
  await waitFor({ id: 'tj-start-trip' }, 20000);
  await snap('tech-job-assigned');
  await tap({ id: 'tj-start-trip' });
  await waitFor({ id: 'tj-arrived' }, 20000);
  await snap('tech-on-the-way');
  await tap({ id: 'tj-arrived' });
  await waitFor({ id: 'tj-demo-code' }, 20000);
  await hideKeyboard();
  await snap('tech-start-code');
  await tap({ id: 'tj-demo-code' });

  step('quote');
  await waitFor({ id: 'tj-prepare-quote' }, 20000);
  await tap({ id: 'tj-prepare-quote' });
  await waitFor({ id: 'tech-quote' }, 20000);
  await typeInto({ id: 'tq-diagnosis' }, 'Worn washer under the sink');
  await hideKeyboard();
  await scrollTo({ id: 'tq-price-0' });
  await typeInto({ id: 'tq-price-0' }, '120');
  await hideKeyboard();
  await scrollTo({ id: 'tq-add-material' });
  await tap({ id: 'tq-add-material' });
  await scrollTo({ id: 'tq-name-1' });
  await typeInto({ id: 'tq-name-1' }, 'Washer');
  await hideKeyboard();
  await scrollTo({ id: 'tq-price-1' });
  await typeInto({ id: 'tq-price-1' }, '200');
  await hideKeyboard();
  await scrollTo({ id: 'tq-totals' });
  await snap('tech-quote');
  await tap({ id: 'tq-send' });

  step('approval, repair, completion');
  await waitFor({ id: 'tj-QUOTE_SHARED' }, 30000);
  await snap('tech-waiting-approval');
  await waitFor({ id: 'tj-start-work' }, 30000); // the simulated customer approves
  await snap('tech-approved');
  await tap({ id: 'tj-start-work' });
  await waitFor({ id: 'tj-complete' }, 20000);
  await tap({ id: 'tj-complete' });
  await tap({ id: 'confirm-yes' });
  await waitFor({ id: 'tj-COMPLETED' }, 30000); // the simulated customer pays
  await snap('tech-job-done');
  await tap({ id: 'tj-home' });

  step('earnings');
  await waitFor({ id: 'tech-home' }, 20000);
  await snap('tech-home-earned');
  await tap({ id: 'ttab-earnings' });
  await waitFor({ id: 'earn-today' }, 20000);
  await snap('tech-earnings');
  await tap({ id: 'ttab-profile' });
  await waitFor({ id: 'tech-profile' }, 20000);
  await snap('tech-profile');
}

async function main() {
  await customer();
  await technician();
  console.log(`APP JOURNEY PASSED (${locale}), ${n} screenshots`);
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
