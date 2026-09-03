"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A delivered session you are allowed to disagree with.
// Compile with tsc, run with node.
//
// The assertions that matter are not about the labels. They are about the two
// ways this feature could do harm: a verdict that reads as "approved" when
// nobody approved anything, and copy that lets a member believe they have just
// been refunded.
const sessionDispute_1 = require("./sessionDispute");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the verdict ───────────────────────────────────────────────────────── */
eq((0, sessionDispute_1.verdictOf)(null), 'none', 'no row is no answer');
eq((0, sessionDispute_1.verdictOf)(undefined), 'none', 'and neither is a missing one');
eq((0, sessionDispute_1.verdictOf)({ state: 'approved', approvedAt: '2026-09-01T10:00:00Z' }), 'approved', 'an approval reads as one');
eq((0, sessionDispute_1.verdictOf)({ state: 'disputed', approvedAt: null }), 'disputed', 'and a dispute as one');
// A row written before supabase/parts/241 has no `state` at all and could only
// ever have been an approval. Both halves of that are asserted, because reading
// a stateless row with no timestamp as "approved" would sign off a session
// nobody answered about.
eq((0, sessionDispute_1.verdictOf)({ approvedAt: '2026-08-01T10:00:00Z' }), 'approved', 'a pre-241 row with a timestamp is an approval');
eq((0, sessionDispute_1.verdictOf)({ approvedAt: null }), 'none', 'and one with neither is no answer at all');
// The branch worth having. A value this build has never heard of must not
// default to the client having agreed.
eq((0, sessionDispute_1.verdictOf)({ state: 'withdrawn' }), 'none', 'an unrecognised state is not an approval');
/* ── what is offered ───────────────────────────────────────────────────── */
const unanswered = (0, sessionDispute_1.actionsFor)('none');
ok(unanswered.approve && unanswered.dispute, 'an unanswered session offers both — the whole defect was offering one');
eq((0, sessionDispute_1.actionsFor)('approved').approve, false, 'an approved session does not offer approving again');
eq((0, sessionDispute_1.actionsFor)('approved').dispute, true, 'but may still be disputed — an approval is not irreversible');
eq((0, sessionDispute_1.actionsFor)('disputed').dispute, false, 'a disputed session does not offer disputing again');
eq((0, sessionDispute_1.actionsFor)('disputed').approve, true, 'and approving is how a dispute is withdrawn, exactly as part 241 implements it');
const VERDICTS = ['none', 'approved', 'disputed'];
for (const v of VERDICTS) {
    const a = (0, sessionDispute_1.actionsFor)(v);
    ok(a.approve || a.dispute, `${v}: there is always a way to change your answer`);
}
/* ── the money ─────────────────────────────────────────────────────────── */
//
// The gap between what a member thinks "Dispute" does and what it does is where
// the next complaint comes from, so the copy has to close it before they tap.
ok(/does not take the session off your pack/.test(sessionDispute_1.DISPUTE_MONEY_NOTE), 'says plainly that the pack credit is not returned');
ok(/booked/.test(sessionDispute_1.DISPUTE_MONEY_NOTE), 'and when it actually came off, so the member can check it');
ok(/does not, on its own, get you any money back/.test(sessionDispute_1.DISPUTE_MONEY_NOTE), 'and that this is not a refund button');
ok(/conversation with your coach/.test(sessionDispute_1.DISPUTE_MONEY_NOTE), 'and points at what does resolve it, rather than leaving a dead end');
ok(!/refunded|reversed|credited back/.test(sessionDispute_1.DISPUTE_MONEY_NOTE.replace('get you any money back', '')), 'and promises nothing anywhere in it');
const confirm = (0, sessionDispute_1.disputeConfirm)('did_not_happen');
ok(confirm.body.includes(sessionDispute_1.DISPUTE_MONEY_NOTE), 'the confirm carries the money sentence, not a summary of it');
ok(/change your answer/.test(confirm.body), 'and says the answer is reversible');
ok(/coach will see/.test(confirm.body), 'and that it is not anonymous — the coach is told');
const filed = (0, sessionDispute_1.disputeFiledLine)('wrong_length');
ok(/Nothing has been refunded/.test(filed), 'the receipt repeats it after the fact');
ok(/no credit has been returned/.test(filed), 'in both halves, because a member reads one line and puts the phone down');
ok(/approve the session instead/.test(filed), 'and says how to undo it');
/* ── the options ───────────────────────────────────────────────────────── */
eq(sessionDispute_1.DISPUTE_OPTIONS.length, 4, 'four kinds, matching the check constraint in part 241');
eq(sessionDispute_1.DISPUTE_OPTIONS.map((o) => o.id).join(','), 'did_not_happen,wrong_time,wrong_length,other', 'in the order the constraint lists them, heaviest first');
for (const o of sessionDispute_1.DISPUTE_OPTIONS) {
    ok(/^[A-Z]/.test(o.label), `${o.id}: the label is a button, so it is Title Case`);
    ok(/[.]$/.test(o.note), `${o.id}: the note is prose, so it is a sentence`);
}
eq((0, sessionDispute_1.disputeKindLabel)('wrong_time'), 'The Time Is Wrong', 'a kind names itself');
eq((0, sessionDispute_1.disputeKindLabel)('nonsense'), 'Something Else Is Wrong', 'and an unknown one falls back rather than rendering an empty label');
/* ── the summary, and the dash that must never appear in it ────────────── */
ok(/on 4 Sep/.test((0, sessionDispute_1.disputedSummary)('other', '4 Sep')), 'a date is included when there is one');
const noDate = (0, sessionDispute_1.disputedSummary)('other', null);
ok(!/—/.test(noDate), 'and no em dash is left standing where the date would have been');
ok(/[.]$/.test(noDate), 'the sentence still ends');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('sessionDispute.test.ts — ok');
