"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Whether the currency step may be ticked. Compile with tsc, run with node.
//
// The bug this guards: the step read `myTenantCurrency()`, which answers about
// a GYM and returns a null currency with no error for a coach who has none. The
// checklist read that as `false` — not done — so an independent coach who set a
// currency of their own in Settings came back to a step that still said they
// had not. A checklist item that can never tick is the app insisting somebody
// has not done the thing they just did.
const currencyStep_1 = require("./currencyStep");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const set = (currency, from = 'own') => ({ currency, from, gap: null, canSetOwn: false });
const gap = (g) => ({ currency: null, from: null, gap: g, canSetOwn: false });
/* ── the step ticks ────────────────────────────────────────────────────── */
eq((0, currencyStep_1.currencyStepDone)(set('GBP', 'own')), true, 'a coach who set their own currency has done it');
eq((0, currencyStep_1.currencyStepDone)(set('AED', 'gym')), true, 'a coach whose gym set one has done it');
// The whole point of the migration. Before this, `own` resolved to false and
// the step could never tick for an independent coach.
ok((0, currencyStep_1.currencyStepDone)(set('JPY', 'own')) !== false, 'setting your own currency is never reported as not done');
/* ── the step is genuinely not done ────────────────────────────────────── */
eq((0, currencyStep_1.currencyStepDone)(gap('own-unset')), false, 'no gym and nothing chosen is not done');
// Not the coach's to fix, and still not done: every money figure in the app is
// withheld either way, and the step's copy sends them somewhere that says so.
eq((0, currencyStep_1.currencyStepDone)(gap('gym-unset')), false, 'a gym that has set none is not done');
/* ── and the four states that are not an answer at all ─────────────────── */
// This is the rule the header of src/lib/coachFirstRun.ts exists for: a
// confident false here tells a coach they have not done something they have.
eq((0, currencyStep_1.currencyStepDone)(gap('reading')), null, 'a read in flight is unknown, not not-done');
eq((0, currencyStep_1.currencyStepDone)(gap('unreadable')), null, 'a failed read is unknown, not not-done');
eq((0, currencyStep_1.currencyStepDone)(gap('unavailable')), null, 'an unapplied migration is unknown, not not-done');
eq((0, currencyStep_1.currencyStepDone)(gap('nowhere')), null, 'no coach record is unknown, not not-done');
eq((0, currencyStep_1.currencyStepDone)(null), null, 'a read that never came back is unknown');
eq((0, currencyStep_1.currencyStepDone)(undefined), null, 'undefined is the same');
// Stated as the invariant, because it is the one that shipped broken: no state
// where we could not look is ever reported as the coach not having done it.
for (const g of ['reading', 'unreadable', 'unavailable', 'nowhere']) {
    ok((0, currencyStep_1.currencyStepDone)(gap(g)) !== false, `${g} is never drawn as not done`);
    ok((0, currencyStep_1.currencyStepDone)(gap(g)) !== true, `${g} is never drawn as done either`);
}
/* ── nothing is ticked on a blank ──────────────────────────────────────── */
eq((0, currencyStep_1.currencyStepDone)({ currency: '   ', from: 'own', gap: null, canSetOwn: false }), null, 'whitespace is not a currency, and with no gap to name it the answer is unknown');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('currencyStep.test.ts — all assertions passed');
