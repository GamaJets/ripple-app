// The two settings the owner console asks for, and the one it reads back.
// Compile with tsc, run with node.
//
// The bug behind most of what follows is not arithmetic. `tenants.session_fee`
// was NOT NULL DEFAULT 75 on every one of the gyms in the live database, and
// every owner screen printed payroll, value-per-client and "at your session
// fee" off that 75 as though an owner had chosen it. Part 118 makes null
// reachable; these assertions are what keeps the difference between "not set"
// and "set to nothing" from collapsing again the moment somebody adds a
// `|| 0`.
import {
  MAX_SESSION_FEE, brandColorOf, isBrandColor, parseGymName, parseSessionFee, sessionFeeFieldValue,
  type FeeInput, type NameInput,
} from './gymSettings';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// Readers for the discriminated unions, so an assertion about a refusal does
// not have to be written as a nest of ternaries.
const feeOf = (f: FeeInput): number | null => (f.kind === 'fee' ? f.fee : null);
const nameOf = (n: NameInput): string | null => (n.kind === 'name' ? n.name : null);
const why = (f: FeeInput | NameInput): string => ('reason' in f ? f.reason : '');

/* ── blank clears, zero does not ────────────────────────────────────────── */

// Every call now carries the gym's currency. It used to carry none, and the
// two decimal places it assumed instead are what part 2400 is about: an owner
// of a Kuwaiti gym could not type their own fee. GBP here so the assertions
// below read as they always did.
const GBP = 'GBP';

// The distinction the whole file exists for, from both sides.
eq(parseSessionFee('', GBP).kind, 'clear', 'an empty field withdraws the fee rather than storing a number');
eq(parseSessionFee('   ', GBP).kind, 'clear', 'and so does a field holding only spaces');
eq(parseSessionFee(null, GBP).kind, 'clear', 'null in is the same as blank in');
eq(parseSessionFee(undefined, GBP).kind, 'clear', 'so is undefined');

eq(parseSessionFee('0', GBP).kind, 'bad', 'a typed zero is refused, not quietly treated as "not set"');
ok(/nothing/i.test(why(parseSessionFee('0', GBP))), 'and the refusal says what a zero fee would do to every delivered session');
eq(parseSessionFee('0.00', GBP).kind, 'bad', 'however it is spelled');

/* ── what an owner actually types ───────────────────────────────────────── */

eq(feeOf(parseSessionFee('75', GBP)), 75, 'a whole fee');
eq(feeOf(parseSessionFee('82.50', GBP)), 82.5, 'and one with minor units');
eq(feeOf(parseSessionFee(' 82.5 ', GBP)), 82.5, 'surrounding space is not the owner changing their mind');
eq(feeOf(parseSessionFee('1,250', GBP)), 1250, 'a thousands separator is how people write a four-figure fee');
eq(feeOf(parseSessionFee('AED 300', 'AED')), 300, 'a currency the gym is already denominated in is dropped, not refused');
eq(feeOf(parseSessionFee('£45', GBP)), 45, 'and so is a symbol — the currency is tenants.currency, not this field');

eq(parseSessionFee('-5', GBP).kind, 'bad', 'a negative fee is refused');
ok(/negative/i.test(why(parseSessionFee('-5', GBP))), 'and named as such rather than as a typo');
eq(parseSessionFee('AED -5', 'AED').kind, 'bad', 'including behind a currency symbol, where the regex would otherwise strip the minus');
eq(parseSessionFee('lots', GBP).kind, 'bad', 'a word is not a fee');
eq(parseSessionFee('7.5.0', GBP).kind, 'bad', 'nor does a version number');

/* ── the places are the CURRENCY's, which is the whole of part 2400 ─────── */

// The refusal that was wrong. This said "three decimal places do not fit
// numeric(8,2) and are refused here, not by Postgres" — true of the old column
// and of no currency. `tenants.session_fee` is numeric(11,3) now.
eq(parseSessionFee('75.999', GBP).kind, 'bad', 'a third place is still refused in a two-place currency');
eq(feeOf(parseSessionFee('82.505', 'KWD')), 82.505,
  'but a Kuwaiti gym can state its own fee, which is the defect part 2400 was written for');
eq(feeOf(parseSessionFee('12.345', 'BHD')), 12.345, 'and so can a Bahraini one');
eq(parseSessionFee('82.5055', 'KWD').kind, 'bad', 'a FOURTH place is not an amount in any currency');
eq(feeOf(parseSessionFee('6000', 'JPY')), 6000, 'a zero-decimal currency takes a whole fee');
eq(parseSessionFee('6000.50', 'JPY').kind, 'bad', 'and refuses a fractional yen, which does not exist');
eq(parseSessionFee('75', null).kind, 'bad',
  'and with no currency recorded there is no such thing as an amount — the fee is refused rather than assumed to be two places');

/* ── what the field offers back ─────────────────────────────────────────── */

// `sessionFeeFieldValue` ended `fee.toFixed(2)`, so a Kuwaiti gym was shown its
// own fee with the third place cut off — and saved the truncated figure by
// accepting the field.
eq(sessionFeeFieldValue(75, GBP), '75', 'a whole fee is offered back whole, not as 75.00');
eq(sessionFeeFieldValue(82.5, GBP), '82.50', 'and a part one at the currency\u2019s own places');
eq(sessionFeeFieldValue(82.505, 'KWD'), '82.505', 'all three of them, for a currency that has three');
eq(sessionFeeFieldValue(6000, 'JPY'), '6000', 'and none for a currency that has none');
eq(sessionFeeFieldValue(null, GBP), '', 'a gym that has not set one is offered an empty field, never a 0');

/* ── the column's own ceiling ───────────────────────────────────────────── */

// MAX_SESSION_FEE is six digits before the point, which is why part 2400 chose
// numeric(11,3) rather than numeric(8,3) — the latter holds only five, and the
// ALTER would have failed on a gym charging 250000 in a currency where that is
// an ordinary rate.
eq(MAX_SESSION_FEE, 999999.99, 'the ceiling is six figures and two places');
eq(feeOf(parseSessionFee('999999.99', GBP)), 999999.99, 'the largest fee the column can take is accepted');
eq(parseSessionFee('1000000', GBP).kind, 'bad', 'and the first one it cannot is refused');
ok(/zeros/i.test(why(parseSessionFee('100000000', GBP))), 'a run of zeros is described as a run of zeros');

/* ── what the field opens with ──────────────────────────────────────────── */

eq(sessionFeeFieldValue(null, GBP), '', 'a gym with no fee opens with an empty field, never a zero to accept');
eq(sessionFeeFieldValue(undefined, GBP), '', 'and so does one whose tenant has not loaded');
eq(sessionFeeFieldValue(75, GBP), '75', 'a round fee comes back round');
eq(sessionFeeFieldValue(82.5, GBP), '82.50', 'and a minor-units fee comes back whole');
eq(sessionFeeFieldValue(0, GBP), '0', 'a stored zero is shown, so an owner can see the thing they need to correct');

// Round trip: whatever the field shows must parse back to what it came from.
// Run per currency, because the whole defect was one currency's places being
// applied to another's money.
for (const [ccy, fees] of [
  ['GBP', [75, 82.5, 1250, 999999.99]],
  ['KWD', [75, 82.505, 12.345]],
  ['JPY', [6000, 250000]],
] as const) {
  for (const fee of fees) {
    eq(feeOf(parseSessionFee(sessionFeeFieldValue(fee, ccy), ccy)), fee,
      `the field round-trips ${fee} ${ccy} unchanged`);
  }
}

/* ── the gym's name ─────────────────────────────────────────────────────── */

eq(nameOf(parseGymName('  Iron Works  ')), 'Iron Works', 'a name is trimmed');
eq(nameOf(parseGymName('Iron   Works')), 'Iron Works', 'and interior runs of space collapse, so two phones cannot hold two spellings');
eq(parseGymName('').kind, 'bad', 'tenants.name is NOT NULL, so blank is refused rather than treated as a clear');
eq(parseGymName('   ').kind, 'bad', 'including a name made of spaces');

// The provisioning placeholder. Saving it deliberately would make a string the
// database invented look like a name somebody chose.
eq(parseGymName("Timothy Rodgers's space").kind, 'bad', 'the provisioning placeholder is not a gym name');
ok(/placeholder/i.test(why(parseGymName("Tim's space"))), 'and the refusal says where it came from');
eq(nameOf(parseGymName("Tim's Space Gym")), "Tim's Space Gym", 'a real gym whose name merely contains the word is not caught');
eq(nameOf(parseGymName('A')), 'A', 'a one-character name is a name');
eq(parseGymName('x'.repeat(81)).kind, 'bad', 'and 81 characters is not');
eq(nameOf(parseGymName('x'.repeat(80))), 'x'.repeat(80), 'while 80 exactly is');

/* ── the colour read back off the tenant ────────────────────────────────── */

// There is no check constraint on tenants.brand_color, so this is the only
// thing between whatever is in that column and brandInkFor() parsing it as hex.
ok(isBrandColor('#2dd4bf'), 'six-digit hex is what the column holds today');
ok(isBrandColor('#FFF'), 'three-digit hex is the other form the theme parses');
ok(!isBrandColor('#2dd4bfff'), 'eight digits are refused rather than silently truncated to a different colour');
ok(!isBrandColor('2dd4bf'), 'a missing hash is refused — the theme concatenates, it does not repair');
ok(!isBrandColor('teal'), 'a colour name is not a colour the theme can parse');
ok(!isBrandColor(''), 'empty is not a colour');
ok(!isBrandColor(null), 'and neither is a column nobody has written');

eq(brandColorOf('  #2DD4BF '), '#2dd4bf', 'a usable colour comes back normalised, so two devices compare equal');
eq(brandColorOf('#zzz'), null, 'and an unusable one comes back as null rather than as itself');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`gymSettings: ok (fee ceiling ${MAX_SESSION_FEE}, blank clears, zero refused)`);
