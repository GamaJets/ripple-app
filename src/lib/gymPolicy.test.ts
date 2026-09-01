// Tests for the two settings a gym has to state about itself, and for the
// answer neither of them is allowed to give.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// `PAY_DELIVERED_ONLY` is documented in gymSessions.ts as "the conservative
// default", and four screens used it as a STORED VALUE. /sessions, /staff and
// /close each held their own `useState` behind their own pair of checkboxes;
// /coach/earnings hardcoded it and told the coach on screen that it could not
// read the gym's real policy. Nothing saved anything. An owner set the policy
// on one screen, walked to another to settle the month, and settled against a
// different number — with nothing anywhere to say the two disagreed.
//
// So the assertions here are mostly about the NULL: what an unset policy maps
// to, and what an unrecognised one maps to. Both must be null, and null must
// not be the conservative reading dressed up, because a screen that receives a
// policy cannot tell it was invented and will print it as the gym's answer.
//
// Compile with tsc then run with node, like wroteRows.test.ts.
import {
  payPolicyOf, payPolicyCode, parseTenantCurrency,
  PAY_POLICY_CODES, PAY_POLICY_LABEL,
} from './gymPolicy';
import { PAY_DELIVERED_ONLY, isPayable, type PayPolicy } from './gymSessions';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the null is the point ────────────────────────────────────────────────── */

eq(payPolicyOf(null), null,
  'A GYM THAT HAS NOT DECIDED GETS NULL — not the conservative reading, which a screen would print as the gym’s answer');
eq(payPolicyOf(undefined), null, 'and the same for a column the read never returned');
eq(payPolicyOf(''), null, 'and for the empty string an emptied field posts');
eq(payPolicyOf('delivered'), null,
  'a value this build does not recognise is unknown, not conservative — guessing is exactly the substitution the column exists to end');
eq(payPolicyOf('DELIVERED_ONLY'), null,
  'the stored form is lower case (the trigger lower-cases it), so an upper-case value is not silently rescued here');

/* ── the four answers ─────────────────────────────────────────────────────── */

{
  const p = payPolicyOf('delivered_only');
  ok(p !== null, 'delivered_only is a policy');
  eq(p?.payNoShows, false, 'and it does not pay no-shows');
  eq(p?.payLateCancellations, false, 'nor late cancellations');
  eq(JSON.stringify(p), JSON.stringify(PAY_DELIVERED_ONLY),
    'it is exactly the conservative reading — which remains a legitimate ANSWER, it just may not be a default');
}
{
  const p = payPolicyOf('no_shows');
  eq(p?.payNoShows, true, 'no_shows pays a no-show');
  eq(p?.payLateCancellations, false, 'and only that');
}
{
  const p = payPolicyOf('late_cancellations');
  eq(p?.payNoShows, false, 'late_cancellations does not pay a no-show');
  eq(p?.payLateCancellations, true, 'and does pay a late cancellation');
}
{
  const p = payPolicyOf('no_shows_and_late_cancellations');
  eq(p?.payNoShows, true, 'the fourth answer pays both');
  eq(p?.payLateCancellations, true, 'both, indeed');
}

/* ── the round trip, which is what stops the four screens diverging ───────── */

for (const code of PAY_POLICY_CODES) {
  const p = payPolicyOf(code);
  ok(p !== null, `${code} is one of the codes the column permits and maps to a policy`);
  eq(payPolicyCode(p as PayPolicy), code,
    `${code} survives policy → code → policy; a lossy mapping here is how a saved setting comes back as a different one`);
  ok((PAY_POLICY_LABEL as Record<string, string>)[code]?.length > 0,
    `${code} has words a screen can print — an unlabelled code would be rendered raw to an owner`);
}

// Every combination a control can assemble has a code. Two boolean toggles make
// four states and the column holds four; a state with no representation would
// be a setting that saves as something else.
{
  const all: PayPolicy[] = [
    { payNoShows: false, payLateCancellations: false },
    { payNoShows: true, payLateCancellations: false },
    { payNoShows: false, payLateCancellations: true },
    { payNoShows: true, payLateCancellations: true },
  ];
  const codes = all.map(payPolicyCode);
  eq(new Set(codes).size, 4, 'four distinct policies map to four distinct codes — nothing collapses on the way to the column');
  ok(codes.every((c) => PAY_POLICY_CODES.includes(c)), 'and every one of them is a value the check constraint permits');
}

/* ── what the policy actually decides ─────────────────────────────────────── */
//
// Tied back to `isPayable`, because that is the function the money goes
// through. A mapping that is internally consistent and wrong at this boundary
// would pass every assertion above.
{
  const noShow = { outcome: 'no_show' as const };
  const late = { outcome: 'late_cancelled' as const };
  const done = { outcome: 'completed' as const };
  const strict = payPolicyOf('delivered_only') as PayPolicy;
  const both = payPolicyOf('no_shows_and_late_cancellations') as PayPolicy;

  ok(isPayable(done, strict) && isPayable(done, both),
    'a delivered session is payable under every policy — that is not the part a gym decides');
  ok(!isPayable(noShow, strict), 'delivered_only does not pay a no-show');
  ok(isPayable(noShow, both), 'and the widest policy does');
  ok(!isPayable(late, strict), 'delivered_only does not pay a late cancellation');
  ok(isPayable(late, both), 'and the widest policy does');
}

/* ── the currency ─────────────────────────────────────────────────────────── */

eq(parseTenantCurrency('').kind, 'clear',
  'an emptied field CLEARS the currency — the column is nullable precisely so "we no longer know" can be said');
eq(parseTenantCurrency('   ').kind, 'clear', 'and whitespace is empty');
eq(parseTenantCurrency(null).kind, 'clear', 'and so is nothing at all');

{
  const r = parseTenantCurrency('gbp');
  eq(r.kind, 'currency', 'a three-letter code is a currency however it was typed');
  eq(r.kind === 'currency' ? r.currency : null, 'GBP',
    'and it is upper-cased — the column constraint is ^[A-Z]{3}$ and two spellings of one currency break every === comparison in the product');
}
{
  const r = parseTenantCurrency('  aed  ');
  eq(r.kind === 'currency' ? r.currency : null, 'AED', 'padding is trimmed before the shape is checked');
}

for (const bad of ['£', '$', 'GB', 'GBPP', 'pounds', 'G8P', 'gb p', '123']) {
  const r = parseTenantCurrency(bad);
  eq(r.kind, 'bad', `"${bad}" is refused HERE, where the field is still on screen, rather than by the constraint after the sheet closed`);
  ok(r.kind === 'bad' && /ISO|three-letter/i.test(r.reason),
    `"${bad}" is refused with a reason that says what a currency code is`);
}

if (errors.length) {
  console.error(`gymPolicy.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('gymPolicy.test.ts — ok');
