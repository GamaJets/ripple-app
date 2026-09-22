// What a charge was for, said to the person it was charged to. Compile with
// tsc, run with node.
//
// The bug every assertion here is aimed at: the member's own list of what they
// owe filtered on one literal string and never selected `reason` at all, so a
// charge raised under any other word was in the database, readable by them, on
// their coach's screen, and absent from theirs. Widening that read is only safe
// if a reason this build has never heard of survives the trip to the screen
// intact — dropped, renamed or folded into 'late cancellation', it is a charge
// the member cannot ask about.
import {
  UNKNOWN_REASON_NOTE, chargeReasonLabel, chargeReasonNote, chargesLine, hasUnknownReason,
} from './chargeReasons';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the one reason this build writes ───────────────────────────────────── */

eq(chargeReasonLabel('late_cancellation'), 'Late cancellation',
  'the string cancel_my_session writes reads as English');
ok(chargeReasonNote('late_cancellation') != null,
  'and it is the one charge whose origin this app actually knows, so it gets a sentence');

/* ── a reason from a build ahead of this one ────────────────────────────── */

eq(chargeReasonLabel('late_reschedule'), 'Late reschedule',
  'a reason this build has never heard of is presented, not reinterpreted');
eq(chargeReasonLabel('no_show'), 'No show', 'and so is the next one');
eq(chargeReasonNote('late_reschedule'), null,
  'with no provenance invented for it — this app did not see it happen');
ok(!/other|unknown/i.test(chargeReasonLabel('late_reschedule')),
  'above all it is not collapsed into "Other", which is not a thing a member can ask their coach about');

/* ── the row whose reason says nothing ──────────────────────────────────── */
//
// `reason` is NOT NULL in the table, so a blank one is a string that is there
// and states nothing. That is an absence and reads as one; calling it "Charge"
// would read as a KIND of charge.

eq(chargeReasonLabel(''), 'Reason not recorded', 'an empty reason is an absence and says so');
eq(chargeReasonLabel('   '), 'Reason not recorded', 'and so is whitespace');
eq(chargeReasonLabel(null), 'Reason not recorded', 'and so is a column that did not come back');
eq(chargeReasonLabel('___'), 'Reason not recorded', 'and so is punctuation with no word in it');

/* ── comparison is on the value, not on its spelling ────────────────────── */
//
// Nothing constrains `reason`, so a row repaired by hand in the SQL editor can
// carry any casing. Two spellings of one reason must not become two reasons.

eq(chargeReasonLabel('LATE_CANCELLATION'), 'Late cancellation', 'casing is not a second reason');
eq(chargeReasonLabel(' late_cancellation '), 'Late cancellation', 'and neither is a stray space');
ok(chargeReasonNote(' Late_Cancellation ') != null, 'the note keys off the same comparison');
ok(!hasUnknownReason(['LATE_CANCELLATION', ' late_cancellation ']),
  'so a list of nothing but late cancellations does not claim to hold an unknown one');

/* ── the note under the list ────────────────────────────────────────────── */

ok(hasUnknownReason(['late_cancellation', 'gym_damage']), 'one strange reason is enough to say so');
ok(!hasUnknownReason([]), 'an empty list holds no unknown reason');
ok(!hasUnknownReason(['', null, undefined]),
  'and a blank reason is not an unknown one — it already has its own wording, and saying both would send a member asking about two different things');
ok(/exactly as it was recorded/.test(UNKNOWN_REASON_NOTE),
  'and the note says the wording came off the record rather than out of this app');

/* ── four reads, four sentences ─────────────────────────────────────────── */
//
// The one that matters: an empty list under 'error' must never be able to say
// "you have no charges". A member who reads that stops expecting a bill that is
// already standing.

const lines = ['loading', 'ready', 'partial', 'error'] as const;
eq(new Set(lines.map(chargesLine)).size, 4, 'every status has its own sentence');
ok(/couldn’t read/.test(chargesLine('error')), 'a failed read says it failed');
ok(/not a statement that you have none/.test(chargesLine('error')),
  'and says explicitly that it is not a claim about the record');
ok(/not all of them/.test(chargesLine('partial')),
  'a truncated read says the list is real and incomplete — both halves');
ok(!/no charges|nothing/i.test(chargesLine('error')),
  'and nothing in the failed-read sentence can be read as an empty record');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('chargeReasons: ok — a reason this build has never heard of reaches the member as itself, and a failed read never reads as an empty ledger');
