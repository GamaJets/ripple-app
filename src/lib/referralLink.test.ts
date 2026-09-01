// The referral link, which is a string that leaves the phone and cannot be
// corrected afterwards.
//
// Two things are worth guarding above all else, and both are about the same
// hazard: a referral code and a coach code look identical and mean opposite
// things. `record_referral` keeps the FIRST code an account records, for the
// life of that account, so a code spent as the wrong kind attributes somebody
// to a stranger permanently and neither party ever finds out.
//
// `ok`/`eq` into an errors array and process.exit(1) — never node:assert, which
// stops at the first failure.
import {
  REFERRAL_LINK_BASE, isPlausibleReferralCode, normaliseReferralCode,
  referralLink, referralMessage,
} from './referralLink';
import { JOIN_LINK_BASE } from './joinCode';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// ── the parameter, which is the whole safety of this ──────────────────────
//
// THE ASSERTION THIS FILE EXISTS FOR. A coach link is `?c=` and a referral link
// is `?r=`, and the day they share a parameter, app/join.tsx has to guess which
// kind of code it is holding — and guessing wrong spends a coach's code as a
// referral, which cannot be undone.
{
  const link = referralLink('TIM-4K9Z');
  ok(link.includes('?r='), `a referral link carries r= — got "${link}"`);
  ok(!link.includes('?c=') && !link.includes('&c='),
    'AND IT NEVER CARRIES c=, WHICH IS THE COACH PARAMETER — one route reads both and a code spent as the wrong kind is permanent');
  ok(link.startsWith(JOIN_LINK_BASE),
    'both kinds land on the same /join route, so the page a friend reaches is the one that already exists');
  eq(REFERRAL_LINK_BASE, JOIN_LINK_BASE, 'and the two bases are the same string, derived from the same brand origin');
}

// ── the origin follows the BRAND ──────────────────────────────────────────
//
// A white-label gym's member handing out their supplier's domain is advertising
// the supplier to the gym's own friends, and the page they land on offers a
// download of an app their gym does not use.
{
  ok(/^https:\/\//.test(REFERRAL_LINK_BASE), 'the link is https, because it is pasted into places that refuse anything else');
  ok(!/localhost|example\.com\/\?/.test(referralLink('AB1')), 'and it is a real origin');
}

// ── cleaning what somebody typed ──────────────────────────────────────────
{
  eq(normaliseReferralCode(' tim-4k9z '), 'TIM-4K9Z', 'trimmed and uppercased');
  eq(normaliseReferralCode('TIM 4K9Z'), 'TIM4K9Z', 'a space somebody pasted is not part of the code');
  eq(normaliseReferralCode('-TIM-4K9Z-'), 'TIM-4K9Z', 'and neither are leading or trailing dashes');
  eq(normaliseReferralCode(''), '', 'nothing in, nothing out — never a fabricated code');
  // The dash is the one thing that separates this rule from joinCode's. A
  // referral code is `referral_code_for(uid, full_name)`: a name fragment, a
  // dash, and base-36 characters. Applying the coach rule here — six
  // characters, no dash, a restricted alphabet — would reject every real one.
  ok(isPlausibleReferralCode('TIM-4K9Z'), 'A DASHED CODE IS VALID — the coach rule would reject every real referral code');
  ok(isPlausibleReferralCode('A1'), 'and a very short one is still worth sending; the server is the authority');
  ok(!isPlausibleReferralCode(''), 'an empty string is not a code');
  ok(!isPlausibleReferralCode('!!!'), 'nor is punctuation');
  ok(!isPlausibleReferralCode('-'), 'nor a bare separator');
}

// ── what leaves the phone ─────────────────────────────────────────────────
{
  const msg = referralMessage('TIM-4K9Z', 'Example Fitness');
  ok(msg.includes(referralLink('TIM-4K9Z')), 'the message carries the link, which is the path that needs nobody to type anything');
  ok(msg.includes('TIM-4K9Z'),
    'and the bare code too — a friend who opens this on a desktop, or whose app strips links, still has to be able to finish');
  ok(msg.includes('Example Fitness'), 'it names the tenant');
  ok(!/\bRepple\b/.test(msg),
    'AND NEVER THE SUPPLIER — this string is sent to somebody who has never heard of us, under the member’s own name');
  // The code goes into a URL, so a code with a character that means something
  // in a query string must not break the link.
  const odd = referralLink('A-B');
  ok(odd.endsWith('A-B'), `a dash needs no escaping and must not be escaped into %2D — got "${odd}"`);
}

if (errors.length) {
  console.error(`referralLink.test.ts — ${errors.length} failures:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('referralLink.test.ts — ok');
