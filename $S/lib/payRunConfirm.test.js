"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The question asked before a coach is marked as paid.
// Compile with tsc, run with node.
//
// The defect: studio-web/app/payroll/page.tsx recorded a payroll settlement on
// ONE click of a button inside a table row — permanently stamping every session,
// class and adjustment in the run — while the Reverse control on the same screen
// demanded a typed reason to undo it. /close names that exact asymmetry about
// its own pair of buttons and calls it the wrong way round.
//
//   THE FIGURE     the amount and the name are on the last thing pressed
//   THE REFUSAL    a run whose total cannot be stated is never offered
//   THE ROWS       only the kinds actually in the run are listed
//   THE HONESTY    the confirmation says this records a payment, not makes one
//   THE NAME       an unread name never becomes a blank in the sentence
const payRunConfirm_1 = require("./payRunConfirm");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const run = (over = {}) => ({
    who: 'Dana Okafor',
    amountText: '£1,240.00',
    periodLabel: 'August 2026',
    sessions: 31,
    classes: 4,
    adjustments: 1,
    methodLabel: 'bank transfer',
    ...over,
});
/* ── THE FIGURE ───────────────────────────────────────────────────────────
 * A person who mis-clicked one row of a twelve-row table is about to confirm
 * the wrong coach. The name and the amount are the two facts that catch that,
 * so both have to be on the button, not only in a heading above it.
 */
{
    const r = run();
    ok((0, payRunConfirm_1.payRunHeading)(r).includes('£1,240.00'), 'the heading states the amount');
    ok((0, payRunConfirm_1.payRunHeading)(r).includes('Dana Okafor'), 'and who it is going to');
    ok((0, payRunConfirm_1.payRunYesLabel)(r).includes('£1,240.00'), 'and so does the button — the heading is above the click, the label IS the click');
    eq((0, payRunConfirm_1.payRunYesLabel)(r), 'Yes — record £1,240.00 paid', 'the whole label');
    eq(payRunConfirm_1.PAY_RUN_NO_LABEL, 'Not yet', 'the way out is not a second "Cancel" on a screen where cancelled already means a session outcome');
}
/* Currency is never re-derived here. The page hands a formatted string, so a
 * yen run says yen — this module has no opinion and no second copy of the
 * decimal rule to get wrong. */
{
    const r = run({ amountText: '¥184,000', who: 'Rin Adachi' });
    ok((0, payRunConfirm_1.payRunYesLabel)(r).includes('¥184,000'), 'a zero-decimal currency passes straight through');
    ok(!(0, payRunConfirm_1.payRunYesLabel)(r).includes('.'), 'and acquires no decimal point on the way');
}
/* ── THE REFUSAL ──────────────────────────────────────────────────────────
 * `settle()` opened with two silent `return`s. A button that is pressed, does
 * nothing and says nothing is its own defect.
 */
{
    eq((0, payRunConfirm_1.payRunStops)(run()), null, 'an ordinary run is offered');
    const noAmount = (0, payRunConfirm_1.payRunStops)(run({ amountText: null }));
    ok(noAmount !== null, 'a run whose total cannot be stated is refused outright');
    ok(!!noAmount && !noAmount.includes('0'), 'and the refusal never states a figure — a run that cannot be totalled is not a run worth nothing');
    ok(!!noAmount && noAmount.includes('Owed'), 'it points at the column that says which part is unknown');
    const empty = (0, payRunConfirm_1.payRunStops)(run({ sessions: 0, classes: 0, adjustments: 0 }));
    ok(empty !== null, 'a run with nothing outstanding is refused rather than silently doing nothing');
    eq((0, payRunConfirm_1.payRunStops)(run({ sessions: 0, classes: 0, adjustments: 1 })), null, 'one adjustment on its own is a real run — a coach reimbursed for a course fee delivered no sessions');
    eq((0, payRunConfirm_1.payRunStops)(run({ sessions: 0, classes: 2, adjustments: 0 })), null, 'and so is a coach who only taught classes');
}
/* ── THE ROWS ─────────────────────────────────────────────────────────────
 * These exact rows leave the run for ever. They are listed, and only the kinds
 * that are actually there — "0 classes and 0 adjustments" buries the one number
 * that matters between two that do not.
 */
{
    ok((0, payRunConfirm_1.payRunBody)(run()).includes('31 sessions, 4 classes and 1 adjustment'), 'all three kinds, in a sentence a person reads');
    ok((0, payRunConfirm_1.payRunBody)(run({ classes: 0, adjustments: 0 })).includes('31 sessions as settled'), 'a plain session run says only sessions');
    ok(!(0, payRunConfirm_1.payRunBody)(run({ classes: 0, adjustments: 0 })).includes('0 class'), 'and never lists a kind that is not in the run');
    ok((0, payRunConfirm_1.payRunBody)(run({ sessions: 1, classes: 1, adjustments: 1 }))
        .includes('1 session, 1 class and 1 adjustment'), 'singulars, all three of them — "1 classes" is what a machine writes');
    ok((0, payRunConfirm_1.payRunBody)(run({ sessions: 0, classes: 0, adjustments: 2 })).includes('2 adjustments as settled'), 'adjustments alone');
    ok((0, payRunConfirm_1.payRunBody)(run()).includes('will not appear in another one'), 'and it says what being stamped means, which is that they are gone from every later run');
    ok((0, payRunConfirm_1.payRunBody)(run()).includes('August 2026'), 'the period is named — a run is settled against one');
}
/* ── THE HONESTY ──────────────────────────────────────────────────────────
 * The sentence "Mark as paid" does not say. Nothing in this product moves money
 * to a coach, and a run marked paid before the transfer is sent reads for ever
 * afterwards as a coach who has been paid.
 */
{
    const b = (0, payRunConfirm_1.payRunBody)(run());
    ok(b.includes('It does not send it'), 'the confirmation says this console does not move the money');
    ok(b.includes('bank transfer'), 'and names the method that will be recorded, which is the one on the dropdown');
    ok(b.includes('written reason'), 'and says what undoing it costs, because the Reverse control demands one');
    ok((0, payRunConfirm_1.payRunBody)(run({ methodLabel: 'cash' })).includes('cash'), 'the method is the one the owner chose, never a default');
}
/* ── THE NAME ─────────────────────────────────────────────────────────────
 * The roster read can fail on this screen — the page has a whole branch for a
 * trainer who worked the period and is not on it. A missing name must not
 * become a blank or an em dash inside a question about paying somebody.
 */
{
    const h = (0, payRunConfirm_1.payRunHeading)(run({ who: null }));
    ok(h.includes('this trainer'), 'an unread name becomes a phrase, not a hole');
    ok(!h.includes('null') && !h.includes('undefined') && !h.includes('—'), 'and never leaks the absence as a value');
    ok(h.includes('£1,240.00'), 'the amount is still stated — that half is known');
    ok((0, payRunConfirm_1.payRunHeading)(run({ who: null, amountText: null })).includes('this run'), 'both unknown still reads as a sentence, though payRunStops refuses this case before it is shown');
}
if (errors.length) {
    console.error(`payRunConfirm: ${errors.length} failure(s)`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('payRunConfirm: all assertions passed');
