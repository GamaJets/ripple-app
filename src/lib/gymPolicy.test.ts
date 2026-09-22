// Tests for the settings a gym has to state about itself, for the answer none
// of them is allowed to give, and for the boundary that decides which columns a
// browser form can reach at all.
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
  payPolicyOf, payPolicyCode, parseTenantCurrency, parseBrandColor, saveGymProfile,
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

/* ── the brand colour ─────────────────────────────────────────────────────── */
//
// The colour has no CHECK constraint behind it — verified against the live
// database and recorded on `isBrandColor` in gymSettings.ts — so unlike the
// currency there is no second line of defence. Whatever this function lets
// through is what a theme parses, and a theme that cannot parse it does not
// fail: it draws unreadable labels on every button in the product.

eq(parseBrandColor('').kind, 'clear',
  'an emptied field CLEARS the colour — part 118 dropped the default so "this gym has not chosen one" could be stored');
eq(parseBrandColor('   ').kind, 'clear', 'and whitespace is empty');
eq(parseBrandColor(null).kind, 'clear', 'and so is nothing at all');

{
  const r = parseBrandColor('#1E88E5');
  eq(r.kind, 'color', 'a six-digit hex is a colour');
  eq(r.kind === 'color' ? r.color : null, '#1e88e5',
    'and it is stored lower-cased — nothing normalises this column on the way in, so one spelling has to be decided here');
}
{
  const r = parseBrandColor('  #1b5  ');
  eq(r.kind === 'color' ? r.color : null, '#1b5',
    'the three-digit form survives; it is one of the two shapes both themes parse');
}

for (const bad of ['1e88e5', '#1e88e', '#1e88e5ff', 'rebeccapurple', 'rgb(1,2,3)', '#', '#gggggg']) {
  const r = parseBrandColor(bad);
  eq(r.kind, 'bad', `"${bad}" is refused HERE — there is no constraint to refuse it later, and a theme fed it produces invisible buttons rather than an error`);
  ok(r.kind === 'bad' && /hex/i.test(r.reason), `"${bad}" is refused with a reason that says what a brand colour is`);
}

// #RRGGBBAA is refused rather than truncated, and that is worth its own line:
// silently dropping the alpha would store a colour the owner did not pick and
// would look like it had worked.
eq(parseBrandColor('#1e88e580').kind, 'bad',
  'eight digits are refused, not truncated to six — a colour nobody chose is the thing this whole module exists to prevent');

/* ── what the patch may write, and what it may not ────────────────────────── */
//
// `tenants` is granted at TABLE level to `authenticated` with no per-column
// ACLs (part 101 §4), so RLS cannot say which columns an update touches. The
// mapping inside `saveGymProfile` IS the boundary between a column and a
// browser form, which makes it worth asserting rather than reading.

/** A Queryable that records the row a write would have sent. */
function capture() {
  const sent: Record<string, unknown>[] = [];
  const sb = {
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => {
        sent.push({ table, ...row });
        // A write that matched one row, so `assertWrote` is satisfied and the
        // assertions below are about the ROW rather than about the count.
        return { eq: () => Promise.resolve({ error: null, count: 1 }) };
      },
    }),
  };
  return { sent, sb };
}

async function main(): Promise<void> {
  {
    const { sent, sb } = capture();
    await saveGymProfile(sb, 'gym', { brandColor: '#1e88e5' });
    eq(sent.length, 1, 'a brand colour is a write');
    eq(sent[0].brand_color, '#1e88e5',
      'and it lands in brand_color — the column this console themes itself from and could not previously change');
    eq('name' in sent[0], false, 'a field the patch did not mention is not sent, so a save cannot blank what it was not asked about');
  }
  {
    const { sent, sb } = capture();
    await saveGymProfile(sb, 'gym', { brandColor: null });
    eq(sent[0].brand_color, null,
      'null is a deliberate CLEAR, not an absent field — a gym that has un-chosen a colour goes back to each surface drawing its own');
  }
  {
    const { sent, sb } = capture();
    await saveGymProfile(sb, 'gym', { name: 'Iron Works' });
    eq('brand_color' in sent[0], false,
      'and saving the name leaves the colour alone — every field is independently optional or a settings screen becomes a way to erase four things at once');
  }
  {
    const { sent, sb } = capture();
    await saveGymProfile(sb, 'gym', { timezone: 'Asia/Dubai' });
    eq(sent[0].timezone, 'Asia/Dubai',
      'a timezone lands in the column part 710 added, unnormalised — zone names are case-sensitive and there is nothing here that could safely fold one');
  }
  {
    const { sent, sb } = capture();
    await saveGymProfile(sb, 'gym', { timezone: null });
    eq(sent[0].timezone, null,
      'and clearing it is a deliberate null — a gym whose days go back to being the reader’s, which every screen has to say out loud rather than call UTC');
  }
  {
    // The widening is OPT-IN, at the mapping. `brand` is refused by a trigger
    // (part 101 §4) and `plan` is what the gym is billed on; neither is in
    // `GymProfilePatch`, and this asserts that being absent from the TYPE is
    // also being absent from the write — a caller reaching past the type with a
    // cast still cannot reach the column.
    const { sent, sb } = capture();
    await saveGymProfile(sb, 'gym', { brand: 'someone_else', plan: 'studio', logo: 'x' } as never);
    eq(sent.length, 0,
      'a patch of nothing this module maps sends nothing at all — an unknown key is ignored, never relayed to the row');
  }

  if (errors.length) {
    console.error(`gymPolicy.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors.slice(0, 20)) console.error('  · ' + e);
    if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
    process.exit(1);
  }
  console.log('gymPolicy.test.ts — ok');
}

main().catch((e) => { console.error('gymPolicy.test.ts — threw:', e); process.exit(1); });
