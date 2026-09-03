"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What this product knows about a gym's tax, which is two facts and no figures.
// Compile with tsc, then run under plain node.
//
// The failures this suite exists to catch are all of one family: a number that
// looks like a tax figure.
//
//   · anything computed from a rate, which is why there is no rate;
//   · a period whose months are quietly not the app's own months, so a return
//     is filed to a boundary a close was never signed off on;
//   · a period reported as settled when the close read failed;
//   · "this gym is not registered" printed out of a query that errored, which
//     is a statement about a business's legal standing;
//   · a registration number that is validated, normalised or inferred, when it
//     is a thing somebody typed and Repple can check against nothing.
const gymTax_1 = require("./gymTax");
const monthEnd_1 = require("./monthEnd");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => {
    if (!Object.is(a, b))
        errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};
/** The name of a month, written out, in whatever language the runner is in.
 *  Day 15 for the reason src/lib/format.ts gives: a day-1 date can fall into a
 *  neighbouring month in a non-Gregorian calendar. */
const monthWord = (m) => new Date(2026, m, 15).toLocaleDateString(undefined, { month: 'long' });
/* ── 1. a quarter is three of this app's own months ───────────────────────
   Not a second opinion about where a month ends. If these ever drift, a return
   is filed to a boundary no close was ever signed off on. */
{
    const q = (0, gymTax_1.taxPeriod)('2026-Q3');
    ok(!!q, 'a quarter key is a period');
    eq(q.months.join(','), '2026-07,2026-08,2026-09', 'Q3 is July, August and September, oldest first');
    eq(q.firstDay, (0, monthEnd_1.monthWindow)('2026-07').firstDay, 'and it starts where this app says July starts');
    eq(q.lastDay, (0, monthEnd_1.monthWindow)('2026-09').lastDay, 'and ends where this app says September ends');
    eq(q.fromIso, (0, monthEnd_1.monthWindow)('2026-07').fromIso, 'the same instants, not a recomputation of them');
    eq(q.toIso, (0, monthEnd_1.monthWindow)('2026-09').toIso, 'with the upper bound exclusive, as everywhere else');
    // Derived, not typed. The contract is "the label NAMES the two end months",
    // not "the label contains the English word July" — a gym filing in Milan
    // reads "luglio" and the sentence is doing its job. Built here from the same
    // two calendar months through the long-month field, so it stays true in every
    // locale the runner may be set to.
    ok(q.label.includes(monthWord(6)) && q.label.includes(monthWord(8)), 'and the label names the months, because "Q3" alone is a fortnight out for half its readers');
    eq((0, gymTax_1.taxPeriod)('2026-Q1').months.join(','), '2026-01,2026-02,2026-03', 'Q1 is the first three');
    eq((0, gymTax_1.taxPeriod)('2026-Q4').lastDay, '2026-12-31', 'Q4 ends on the last day of December');
    // A month key is a period too, because a gym filing monthly, or an owner
    // checking one month against the bank, needs one.
    const m = (0, gymTax_1.taxPeriod)('2026-02');
    eq(m.months.length, 1, 'a month key is a one-month period');
    eq(m.lastDay, '2026-02-28', 'and its length comes from the app’s own month, leap years included');
    eq((0, gymTax_1.taxPeriod)('2028-02').lastDay, '2028-02-29', 'which means a leap February is 29 days');
    ok((0, gymTax_1.taxPeriod)('2026-Q5') === null, 'there is no fifth quarter');
    ok((0, gymTax_1.taxPeriod)('2026-13') === null, 'nor a thirteenth month');
    ok((0, gymTax_1.taxPeriod)('') === null, 'and an empty key is not a period');
    eq((0, gymTax_1.quarterKeyOf)('2026-08'), '2026-Q3', 'August is in Q3');
    eq((0, gymTax_1.quarterKeyOf)('2026-01'), '2026-Q1', 'January is in Q1');
    eq((0, gymTax_1.quarterKeyOf)('2026-12'), '2026-Q4', 'December is in Q4');
    ok((0, gymTax_1.quarterKeyOf)('nonsense') === null, 'and a key that is not a month has no quarter');
}
/* ── 2. the periods offered ───────────────────────────────────────────────*/
{
    const now = Date.parse('2026-09-15T12:00:00Z');
    const ps = (0, gymTax_1.recentTaxPeriods)(4, 3, now);
    eq(ps[0], '2026-Q3', 'the quarter running now is offered first');
    eq(ps[1], '2026-Q2', 'then the one before it');
    // The year boundary, which is where an off-by-one lands somebody in a quarter
    // that does not exist.
    eq(ps[3], '2025-Q4', 'and four back crosses into last year rather than producing Q0');
    eq(ps[4], '2026-09', 'the months follow the quarters');
    ok(ps.every((k) => (0, gymTax_1.taxPeriod)(k) !== null), 'and every key offered is one this module can open');
    const janQ = (0, gymTax_1.recentTaxPeriods)(2, 0, Date.parse('2026-01-08T00:00:00Z'));
    eq(janQ.join(','), '2026-Q1,2025-Q4', 'in January the previous quarter is last year’s fourth');
}
/* ── 3. an open month is a period that can still move ─────────────────────
   And a close read that failed reports every month open, never every month
   closed: telling somebody a period is settled when the read failed is the
   expensive direction. */
{
    const q = (0, gymTax_1.taxPeriod)('2026-Q3');
    eq((0, gymTax_1.openMonthsIn)(q, ['2026-07', '2026-08', '2026-09']).length, 0, 'a fully closed quarter has no open months');
    eq((0, gymTax_1.openMonthsIn)(q, ['2026-07']).join(','), '2026-08,2026-09', 'and the rest are named, oldest first');
    eq((0, gymTax_1.openMonthsIn)(q, []).length, 3, 'nothing closed — or nothing read — leaves all three open');
    ok((0, gymTax_1.periodMovingNote)(q, ['2026-07', '2026-08', '2026-09']) === null, 'a settled quarter carries no warning');
    const note = (0, gymTax_1.periodMovingNote)(q, ['2026-07']);
    // Against the app's OWN month labels rather than against two English
    // literals: the note is built by asking `monthWindow` what each month is
    // called, so that is what "names the months" means here, in any language.
    ok(note.includes((0, monthEnd_1.monthWindow)('2026-08').label) && note.includes((0, monthEnd_1.monthWindow)('2026-09').label), 'and an unsettled one NAMES the months, because a count sends somebody to look at three');
    ok(note.includes('Close screen'), 'and says where to go');
    ok((0, gymTax_1.periodMovingNote)(q, ['2026-07', '2026-08']).includes('has not been closed'), 'one open month reads as one');
}
/* ── 4. what the gym said, which is never read out of a failed query ──────*/
{
    ok((0, gymTax_1.taxProfileLine)(gymTax_1.NO_TAX_PROFILE, 'error').includes('could not be read'), 'a failed read says the read failed');
    ok(!(0, gymTax_1.taxProfileLine)(gymTax_1.NO_TAX_PROFILE, 'error').includes('is not registered'), 'and NEVER states that the gym is not registered — that is a claim about its legal standing');
    ok((0, gymTax_1.taxProfileLine)(gymTax_1.NO_TAX_PROFILE, 'loading').includes('Still reading'), 'a read in flight says only that');
    // Three states, and the middle one is the point.
    ok((0, gymTax_1.taxProfileLine)(gymTax_1.NO_TAX_PROFILE, 'ready').includes('Nobody has said'), 'unanswered is unanswered');
    ok((0, gymTax_1.taxProfileLine)(gymTax_1.NO_TAX_PROFILE, 'ready').includes('not the same as saying it is not'), 'and says so, because a null read as a no is the whole reason the column is nullable');
    ok((0, gymTax_1.taxProfileLine)({ registered: false, registration: null }, 'ready').includes('says it is not registered'), 'a stated no is a real answer');
    ok((0, gymTax_1.taxProfileLine)({ registered: true, registration: 'GB123456789' }, 'ready').includes('never checked it'), 'and a stated yes says the number was not verified');
    ok((0, gymTax_1.taxProfileLine)({ registered: true, registration: null }, 'ready').includes('has not stated a number'), 'registered with no number is its own state, not an error');
}
/* ── 5. what cannot be saved ──────────────────────────────────────────────*/
{
    eq((0, gymTax_1.taxProfileBlockers)({ registered: true, registration: 'GB123456789' }).length, 0, 'an ordinary answer saves');
    eq((0, gymTax_1.taxProfileBlockers)(gymTax_1.NO_TAX_PROFILE).length, 0, 'and so does clearing everything');
    // Nothing here validates the FORMAT of a number. There is no register this
    // app could check and a format rule would refuse valid numbers from countries
    // nobody thought of.
    eq((0, gymTax_1.taxProfileBlockers)({ registered: true, registration: '12 · 345 / ABC' }).length, 0, 'a number in a shape nobody here has seen is still a number');
    eq((0, gymTax_1.taxProfileBlockers)({ registered: true, registration: 'x'.repeat(61) }).length, 1, 'past the column length it is refused rather than truncated');
    eq((0, gymTax_1.taxProfileBlockers)({ registered: false, registration: 'GB123456789' }).length, 1, 'and "not registered, number GB123456789" is a record nobody can act on');
}
/* ── 6. NO TAX IS CALCULATED, ANYWHERE ────────────────────────────────────
   The rule the whole module exists under, and the one part 451 settled on the
   coach's side: this app may print what a person stated and may not work
   anything out from it. */
{
    const mod = require('./gymTax');
    const named = Object.keys(mod).join(' ').toLowerCase();
    ok(!/rate|amount|due|owed|liability|estimate/.test(named), 'this module exports nothing named rate, amount, due, owed, liability or estimate');
    ok(gymTax_1.TAX_NO_RETURN_FIGURE.includes('is not a return'), 'the screen says outright that it is not a return');
    ok(gymTax_1.TAX_NO_RETURN_FIGURE.includes('does not apply a rate'), 'and that no rate is applied to anything');
    ok(gymTax_1.TAX_NO_RETURN_FIGURE.includes('will not estimate'), 'and that it will not estimate one either');
    // Itemised rather than summed into "some data may be missing". A reader told
    // which things are absent can decide whether their own records cover them; a
    // reader told the data is incomplete concludes it is roughly right.
    ok(gymTax_1.TAX_UNKNOWNS.length >= 6, 'the things Repple does not know are listed one at a time');
    const all = gymTax_1.TAX_UNKNOWNS.map((u) => `${u.title} ${u.detail}`).join(' ');
    ok(/No rate is recorded/.test(gymTax_1.TAX_UNKNOWNS.map((u) => u.title).join(' ')), 'starting with the absence of any rate, which is the one a reader assumes is there');
    ok(all.includes('exempt'), 'and says why one rate for a gym would be wrong');
    ok(all.includes('gross'), 'the takings are named as gross');
    ok(all.includes('no supplier invoice'), 'nothing is evidenced, and it says so');
    ok(all.includes('missing, not nil'), 'a cost nobody typed is missing rather than nil');
    ok(all.includes('no rate to turn them into one'), 'two currencies are never added');
    ok(all.includes('Close screen'), 'and an open month is named as still moving');
    ok(gymTax_1.TAX_FACTS_ARE_STATED_NOT_CHECKED.includes('has not checked'), 'the two stored facts say they were not checked');
    ok(gymTax_1.TAX_FACTS_ARE_STATED_NOT_CHECKED.includes('not inferred'), 'and that neither was inferred from a country or a currency');
}
console.log(errors.length ? 'GYM TAX FAILURES:\n' + errors.join('\n') : 'gymTax: ok (no rate, no figure, a quarter made of this app’s own months, and a failed read is never a business that is not registered)');
if (errors.length)
    process.exit(1);
