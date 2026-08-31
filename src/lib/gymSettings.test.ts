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

// The distinction the whole file exists for, from both sides.
eq(parseSessionFee('').kind, 'clear', 'an empty field withdraws the fee rather than storing a number');
eq(parseSessionFee('   ').kind, 'clear', 'and so does a field holding only spaces');
eq(parseSessionFee(null).kind, 'clear', 'null in is the same as blank in');
eq(parseSessionFee(undefined).kind, 'clear', 'so is undefined');

eq(parseSessionFee('0').kind, 'bad', 'a typed zero is refused, not quietly treated as "not set"');
ok(/nothing/i.test(why(parseSessionFee('0'))), 'and the refusal says what a zero fee would do to every delivered session');
eq(parseSessionFee('0.00').kind, 'bad', 'however it is spelled');

/* ── what an owner actually types ───────────────────────────────────────── */

eq(feeOf(parseSessionFee('75')), 75, 'a whole fee');
eq(feeOf(parseSessionFee('82.50')), 82.5, 'and one with minor units');
eq(feeOf(parseSessionFee(' 82.5 ')), 82.5, 'surrounding space is not the owner changing their mind');
eq(feeOf(parseSessionFee('1,250')), 1250, 'a thousands separator is how people write a four-figure fee');
eq(feeOf(parseSessionFee('AED 300')), 300, 'a currency the gym is already denominated in is dropped, not refused');
eq(feeOf(parseSessionFee('£45')), 45, 'and so is a symbol — the currency is tenants.currency, not this field');

eq(parseSessionFee('-5').kind, 'bad', 'a negative fee is refused');
ok(/negative/i.test(why(parseSessionFee('-5'))), 'and named as such rather than as a typo');
eq(parseSessionFee('AED -5').kind, 'bad', 'including behind a currency symbol, where the regex would otherwise strip the minus');
eq(parseSessionFee('lots').kind, 'bad', 'a word is not a fee');
eq(parseSessionFee('75.999').kind, 'bad', 'three decimal places do not fit numeric(8,2) and are refused here, not by Postgres');
eq(parseSessionFee('7.5.0').kind, 'bad', 'nor does a version number');

/* ── the column's own ceiling ───────────────────────────────────────────── */

// numeric(8,2). Anything past this raises 22003 at the database — AFTER the
// sheet has closed and the owner has been told it saved.
eq(MAX_SESSION_FEE, 999999.99, 'the ceiling is what numeric(8,2) actually holds');
eq(feeOf(parseSessionFee('999999.99')), 999999.99, 'the largest fee the column can take is accepted');
eq(parseSessionFee('1000000').kind, 'bad', 'and the first one it cannot is refused');
ok(/zeros/i.test(why(parseSessionFee('100000000'))), 'a run of zeros is described as a run of zeros');

/* ── what the field opens with ──────────────────────────────────────────── */

eq(sessionFeeFieldValue(null), '', 'a gym with no fee opens with an empty field, never a zero to accept');
eq(sessionFeeFieldValue(undefined), '', 'and so does one whose tenant has not loaded');
eq(sessionFeeFieldValue(75), '75', 'a round fee comes back round');
eq(sessionFeeFieldValue(82.5), '82.50', 'and a minor-units fee comes back whole');
eq(sessionFeeFieldValue(0), '0', 'a stored zero is shown, so an owner can see the thing they need to correct');

// Round trip: whatever the field shows must parse back to what it came from.
for (const fee of [75, 82.5, 1250, 999999.99]) {
  eq(feeOf(parseSessionFee(sessionFeeFieldValue(fee))), fee, `the field round-trips ${fee} unchanged`);
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
