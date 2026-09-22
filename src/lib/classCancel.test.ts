// What a member is told before they cancel a class.
// Compile with tsc, run with node.
//
// The two failures this guards: silence, which reads as "free"; and an invented
// notice window, which would be a fact about the gym's policy that this app has
// never been told.
import {
  hoursUntil, startsInLine, classCancelBody, classChargeLine, cancelStanding,
  CLASS_POLICY_UNKNOWN_NOTE,
  type ClassCancelPolicy,
} from './classCancel';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-01T09:00:00.000Z');
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

/* ── how long until it starts ──────────────────────────────────────────── */

eq(hoursUntil(inHours(3), NOW), 3, 'three hours is three hours');
eq(hoursUntil(inHours(-4), NOW), 0, 'a class that has already started is not minus four hours away');
eq(hoursUntil('not a date', NOW), null, 'and a timestamp nothing can parse is unknown, not zero');

ok(startsInLine(inHours(3), NOW)!.includes('3 hours'), 'the sentence carries the figure');
ok(/within the hour/.test(startsInLine(inHours(0.5), NOW)!), 'half an hour is "within the hour", not "in 0 hours"');
ok(/about an hour/.test(startsInLine(inHours(1), NOW)!), 'and one hour is not "1 hours"');
ok(/already started/.test(startsInLine(inHours(-1), NOW)!), 'a class in progress says so');
ok(/3 days/.test(startsInLine(inHours(72), NOW)!), 'past two days it counts in days');
eq(startsInLine('nonsense', NOW), null, 'and an unreadable time gets no sentence at all');

/* ── the money sentence ────────────────────────────────────────────────── */

ok(/does not hold that policy/.test(CLASS_POLICY_UNKNOWN_NOTE),
  'the app says it does not know rather than implying there is nothing to know');
ok(!/free|no charge|nothing to pay/i.test(CLASS_POLICY_UNKNOWN_NOTE),
  'and never says a cancellation is free — it has no way to know that');
ok(!/\b24 hours\b|\b48 hours\b/.test(CLASS_POLICY_UNKNOWN_NOTE),
  'no notice window is invented: this app has never been told the gym’s');
ok(!/repple/i.test(CLASS_POLICY_UNKNOWN_NOTE),
  'and no supplier is named to a member of a white-label gym');

/* ── the confirmation body ─────────────────────────────────────────────── */

const body = classCancelBody('Spin · Shoreditch · Tue 07:00', inHours(3), NOW);
ok(body.startsWith('Spin · Shoreditch · Tue 07:00'), 'the screen’s own wording of the class leads');
ok(body.includes('3 hours'), 'then when it starts');
ok(body.includes(CLASS_POLICY_UNKNOWN_NOTE), 'then what this app cannot tell them about the cost');

const unparseable = classCancelBody('Spin', 'nonsense', NOW);
ok(unparseable.includes(CLASS_POLICY_UNKNOWN_NOTE),
  'a class whose time could not be read still gets the sentence about the charge');
ok(!unparseable.includes('undefined') && !unparseable.includes('null'),
  'and never leaves a hole where the timing sentence would have been');

/* ── now that a gym can state a policy ────────────────────────────────────── */

// NOW and inHours are already declared at the top of this file and mean the
// same thing; reusing them keeps every assertion below on one clock.
const pol = (p: Partial<ClassCancelPolicy>): ClassCancelPolicy =>
  ({ notice: null, fee: null, currency: null, ...p });

// The good-news sentence, and the only one in the file that is.
{
  const line = classChargeLine(pol({ notice: 12, fee: 8.5, currency: 'GBP' }), inHours(20), NOW);
  ok(/outside/.test(line ?? ''), 'twenty hours out of a twelve-hour window is outside it');
  ok(!/8\.50/.test(line ?? ''), 'and no amount is quoted at somebody who will not be charged');
}

// Inside, with everything stated: the hours AND the money.
{
  const line = classChargeLine(pol({ notice: 12, fee: 8.5, currency: 'GBP' }), inHours(3), NOW) ?? '';
  ok(/12-hour notice/.test(line), 'the window is named');
  ok(/GBP 8\.50/.test(line), 'and so is the amount, with its unit');
}

// Inside, fee unstated. Naming a window while inventing its price would be the
// worst of both, so the window is named and the amount is not.
{
  const line = classChargeLine(pol({ notice: 24 }), inHours(2), NOW) ?? '';
  ok(/24-hour notice/.test(line), 'the window is still named');
  ok(/has not told this app the amount/.test(line), 'and the silence about money is stated');
  ok(!/[0-9]+\.[0-9]{2}/.test(line), 'with no figure anywhere in it');
}

// A fee with no currency on the gym's record. The figure is WITHHELD: a number
// with no unit is not a price, and choosing one is the thing this app never
// does. This is the assertion that would fail if somebody "helpfully" defaulted
// the unit.
{
  const line = classChargeLine(pol({ notice: 12, fee: 8.5, currency: null }), inHours(1), NOW) ?? '';
  ok(/cannot state the amount/.test(line), 'the missing unit is stated');
  ok(!/8\.5/.test(line), 'and the bare number never reaches the member');
  ok(!/[£$€]/.test(line), 'and no symbol is invented for it');
}

// A stated zero. Both zeroes are policies and neither is silence.
ok(/no charge/.test(classChargeLine(pol({ notice: 12, fee: 0, currency: 'GBP' }), inHours(1), NOW) ?? ''),
  'a stated zero fee says the cancellation is free');
{
  const line = classChargeLine(pol({ notice: 0, fee: 5, currency: 'GBP' }), inHours(0.5), NOW) ?? '';
  ok(/does not run a notice period/.test(line), 'a zero-hour window is said in words');
  ok(!/0-hour/.test(line), 'and never as "outside your gym\u2019s 0-hour notice"');
}

// No policy at all, and a read that did not land. Both fall back, and the
// fallback is the sentence this file already had.
eq(classChargeLine(null, inHours(2), NOW), null, 'a failed read produces no claim');
eq(classChargeLine(pol({ fee: 8.5, currency: 'GBP' }), inHours(2), NOW), null,
  'a fee with no window stated is not enough to say anything about lateness');

// The body: the policy sentence REPLACES the unknown one and never sits beside
// it, because two answers to one question is worse than either.
{
  const body = classCancelBody('Spin', inHours(2), NOW, pol({ notice: 12, fee: 8.5, currency: 'GBP' }));
  ok(/GBP 8\.50/.test(body), 'the body carries the charge');
  ok(!body.includes(CLASS_POLICY_UNKNOWN_NOTE), 'and drops the we-do-not-know sentence entirely');
}

// And every existing call site, which passes no policy, is untouched.
eq(classCancelBody('Spin', inHours(2), NOW), classCancelBody('Spin', inHours(2), NOW, null),
  'omitting the policy is the same as a read that found none');
ok(classCancelBody('Spin', inHours(2), NOW).includes(CLASS_POLICY_UNKNOWN_NOTE),
  'and still says we do not hold the policy');

/* ══ part 3060 ══ which word the cancellation is FILED as ══════════════════
 *
 * `class_bookings.status` gains 'cancelled' and 'late_cancelled', and
 * `cancel_class` has to choose. The point of `cancelStanding` is that it is the
 * SAME comparison `classChargeLine` makes, so the sentence the member reads and
 * the word the database stores cannot disagree — which is the failure where
 * somebody is shown a fee and has an ordinary cancellation filed, or is told it
 * is free and is charged. */

const twelve: ClassCancelPolicy = { notice: 12, fee: 8.5, currency: 'GBP' };

eq(cancelStanding(twelve, inHours(2), NOW), 'late_cancelled',
  'two hours before a twelve-hour notice is a late cancellation');
eq(cancelStanding(twelve, inHours(40), NOW), 'cancelled',
  'and well outside it is an ordinary one');

// The boundary, to the hour, on both sides. `hoursUntil` floors, so a class
// exactly twelve hours out is 12, which is NOT less than 12 and is therefore
// outside — the same `<` the fee sentence uses.
eq(cancelStanding(twelve, inHours(12), NOW), 'cancelled', 'exactly on the notice is outside it');
eq(cancelStanding(twelve, inHours(11.99), NOW), 'late_cancelled', 'a minute inside it is late');

// THE one: the two readers agree at every hour across the boundary. A drift of
// one hour between them is a member charged a fee the app said they would not
// pay.
for (let h = 0; h <= 24; h++) {
  const standing = cancelStanding(twelve, inHours(h), NOW);
  const line = classChargeLine(twelve, inHours(h), NOW) ?? '';
  const sentenceSaysLate = line.includes('inside your');
  eq(standing === 'late_cancelled', sentenceSaysLate,
    `the stored word and the sentence agree at ${h}h out`);
}

// A stated zero-hour notice means nothing is ever late. Zero is a STATEMENT and
// not a silence, so it gets an answer rather than a null.
const zero: ClassCancelPolicy = { notice: 0, fee: null, currency: null };
eq(cancelStanding(zero, inHours(0), NOW), 'cancelled',
  'a gym that runs no notice period never records a late cancellation');
eq(cancelStanding(zero, inHours(99), NOW), 'cancelled', 'at any distance');

// Null, three ways, and every one of them means the same thing: the app does not
// know, and `cancel_class` must file 'cancelled'. Recording a late cancellation
// against a window nobody stated would be this app inventing a gym's policy,
// which is the whole subject of this file's header.
eq(cancelStanding(null, inHours(1), NOW), null, 'a read that did not land is not a late cancellation');
eq(cancelStanding({ notice: null, fee: 8.5, currency: 'GBP' }, inHours(1), NOW), null,
  'nor is a fee with no window — a price is not a policy');
eq(cancelStanding(twelve, 'not a date', NOW), null,
  'nor is a class whose start time cannot be parsed');

// A class that has already begun. `hoursUntil` floors at 0, never negative, so
// this lands inside any stated window rather than wrapping out the far side.
eq(cancelStanding(twelve, inHours(-5), NOW), 'late_cancelled',
  'cancelling a class that already started is inside the notice, not outside it');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('classCancel.test.ts — all assertions passed');
