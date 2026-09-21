// The two cancellation-policy fields on app/(owner)/ops.tsx.
// Compile with tsc, run with node.
//
// Both of these were read with one shared `Number()` helper on the screen. That
// is the right reader for neither of them, and the assertions below are all the
// ways it was wrong — kept as a list because every one of them was reachable by
// an owner typing an ordinary thing into an ordinary box, and none of them
// produced an error. The fee ones matter most: `class_cancel_fee` is money, and
// the number of decimal places money has is a property of the currency, never a
// constant. Repple is white-labelled and sixteen of the currencies it supports
// have no minor unit at all.
import {
  MAX_CANCEL_FEE, MAX_CANCEL_HOURS, parseCancelFee, parseCancelHours,
  type PolicyField,
} from './cancelPolicy';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** The value a field parsed to, or the sentinel for a refusal. */
const val = (f: PolicyField): number | null | 'refused' => (f.ok ? f.value : 'refused');
const why = (f: PolicyField): string => (f.ok ? '' : f.reason);

/* ── hours: blank, zero, and the difference ──────────────────────────────── */

// The distinction part 2615's column comment turns on. An empty field means the
// gym has not stated a policy; a typed 0 means it has stated one with no notice
// period. Collapsing them tells members a gym holds no policy when it does.
eq(val(parseCancelHours('')), null, 'an empty notice field withdraws the policy rather than storing zero');
eq(val(parseCancelHours('   ')), null, 'and so does a field holding only spaces');
eq(val(parseCancelHours('0')), 0, 'a typed 0 is a stated policy of no notice period, not a clear');
eq(val(parseCancelHours('12')), 12, 'a whole number of hours saves');
eq(val(parseCancelHours(null)), null, 'a null field is a clear, not a refusal');

/* ── hours: the integer column ───────────────────────────────────────────── */

// The defect this file was written for, half one. `class_cancel_hours` is an
// `integer`: 12.5 passed the old screen's `Number()` check, and Postgres
// rounded it on the way in. The owner asked for twelve and a half hours, got
// thirteen, and was told it saved.
eq(val(parseCancelHours('12.5')), 'refused', 'a half-hour notice period is refused rather than rounded by the integer column');
ok(/whole number of hours/.test(why(parseCancelHours('12.5'))), 'and the refusal says why, naming the field');
eq(val(parseCancelHours('0.5')), 'refused', 'a fractional hour under one is refused too');

/* ── hours: the CHECK constraint, client-side ────────────────────────────── */

eq(val(parseCancelHours('-1')), 'refused', 'a negative notice period is not a policy');
eq(val(parseCancelHours(String(MAX_CANCEL_HOURS))), MAX_CANCEL_HOURS, 'exactly two weeks is allowed — the boundary is inclusive, as the constraint is');
eq(val(parseCancelHours(String(MAX_CANCEL_HOURS + 1))), 'refused', 'one hour beyond it is refused here, not by the database after the sheet closed');
eq(val(parseCancelHours('abc')), 'refused', 'a word is not a number of hours');

/* ── fee: blank, zero, and the difference ────────────────────────────────── */

eq(val(parseCancelFee('', 'GBP')), null, 'an empty fee field withdraws the fee');
// Deliberately unlike `parseSessionFee`, which refuses 0. A gym charging
// nothing for a late cancellation is making a real claim; a gym valuing every
// delivered session at nothing is not. Part 2615: "0 is a stated policy of no
// charge."
eq(val(parseCancelFee('0', 'GBP')), 0, 'a typed 0 is a stated policy of no charge, never a clear');
eq(val(parseCancelFee('5', 'GBP')), 5, 'a whole amount saves');
eq(val(parseCancelFee('5.55', 'GBP')), 5.55, 'two places save in a two-place currency');

/* ── fee: the places come from the CURRENCY ──────────────────────────────── */

// The defect this file was written for, half two, and the expensive one. Each
// of these was stored by the old reader.
eq(val(parseCancelFee('5.555', 'GBP')), 'refused',
  'a third decimal place in GBP is refused rather than silently rounded to 5.56 by numeric(8,2)');
eq(val(parseCancelFee('5.5', 'JPY')), 'refused',
  'JPY has no minor unit, so 5.5 is not an amount of yen and must not be stored as one');
eq(val(parseCancelFee('500', 'JPY')), 500, 'a whole yen amount saves — the refusal above is about the point, not about JPY');
eq(val(parseCancelFee('12.345', 'KWD')), 12.345, 'KWD holds three places and all three survive the round trip');
eq(val(parseCancelFee('12.3456', 'KWD')), 'refused', 'a fourth place is refused even in a three-place currency');
// The proof that nothing here is scaled by a constant: the same typed string is
// a different verdict in three currencies, and only the currency changed.
eq(val(parseCancelFee('1.5', 'GBP')), 1.5, 'one decimal place is an amount in a two-place currency');
eq(val(parseCancelFee('1.5', 'KWD')), 1.5, 'and in a three-place one');
eq(val(parseCancelFee('1.5', 'JPY')), 'refused', 'and is not one in a zero-place currency');

/* ── fee: what a person actually types ───────────────────────────────────── */

eq(val(parseCancelFee('1,50', 'GBP')), 1.5, 'a decimal comma is read as most of the world writes it, not refused');
eq(val(parseCancelFee('1e5', 'GBP')), 'refused', 'scientific notation no longer sets a 100,000 cancellation fee');
eq(val(parseCancelFee('£5', 'GBP')), 'refused', 'a currency symbol is refused with a sentence rather than read as NaN');
eq(val(parseCancelFee('-5', 'GBP')), 'refused', 'a negative fee is a credit, not a policy');

/* ── fee: the column's ceiling ───────────────────────────────────────────── */

eq(val(parseCancelFee(String(MAX_CANCEL_FEE), 'GBP')), MAX_CANCEL_FEE, 'the largest amount numeric(8,2) holds still saves');
eq(val(parseCancelFee('1000000', 'GBP')), 'refused', 'one unit beyond it is refused here, not by a 22003 after the write');
ok(/check the zeros/i.test(why(parseCancelFee('2000000', 'GBP'))), 'and the refusal suggests the thing that is usually actually wrong');

/* ── fee: a gym that has not set a currency ──────────────────────────────── */

// White-label: there is no default currency anywhere in this product, so a fee
// typed at a gym that has not chosen one is not an amount of any money.
eq(val(parseCancelFee('5', null)), 'refused', 'a gym with no currency cannot denominate a fee');
eq(val(parseCancelFee('5', '')), 'refused', 'an empty currency code is the same silence as a null');
eq(val(parseCancelFee('5', '   ')), 'refused', 'and so is whitespace');
// But the withdrawal must stay reachable. A gym that set a fee and then cleared
// its currency would otherwise be unable to take the fee back down.
eq(val(parseCancelFee('', null)), null, 'clearing a fee needs no currency to clear it in');

if (errors.length) {
  console.error(`cancelPolicy: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('cancelPolicy: all assertions passed');
