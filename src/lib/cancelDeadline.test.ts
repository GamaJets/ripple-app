// The last moment a booking can be changed for nothing, said before the member
// decides. Compile with tsc, run with node.
//
// `cancelWarningLine` is printed in exactly three places and all three are
// inside the Alert raised by the Cancel button — so the notice period reached
// the member at the one moment it could no longer help them. And `canOfferMove`
// returning false simply removes the Move control, with no line anywhere saying
// why it went.
import {
  cancelDeadline, freeUntil, CLOSING_SOON_HOURS,
} from './cancelDeadline';
import { canOfferMove } from './reschedule';
import { feeAmountLine, noticeLabel, type CancellationPolicy } from './booking';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-04T09:00:00.000Z');
const HOUR = 3_600_000;
/** A session `h` hours from now. */
const inHours = (h: number) => new Date(NOW + h * HOUR).toISOString();

const CHARGES: CancellationPolicy = { applies: true, noticeHours: 24, fee: 25, currency: 'GBP' };
const FREE: CancellationPolicy = { applies: false, noticeHours: 24, fee: null, currency: null };
const UNPRICED: CancellationPolicy = { applies: true, noticeHours: 24, fee: null, currency: null };
const NO_CURRENCY: CancellationPolicy = { applies: true, noticeHours: 24, fee: 25, currency: null };
const LONG: CancellationPolicy = { applies: true, noticeHours: 48, fee: 30, currency: 'EUR' };

const base = { policyStatus: 'ready' as const, now: NOW, when: 'Mon 7:00 am' };
const note = (r: ReturnType<typeof cancelDeadline>) => (r.kind === 'silent' ? '' : r.note);

/* ── nothing to say ────────────────────────────────────────────────────── */

eq(cancelDeadline({ ...base, startsAt: inHours(-2), policy: CHARGES }).kind, 'silent',
  'a session that has started is not a booking anybody is planning around');
eq(cancelDeadline({ ...base, startsAt: 'not a date', policy: CHARGES }).kind, 'silent',
  'an unparseable start is not evidence of a deadline');
eq(cancelDeadline({ ...base, startsAt: inHours(72), policy: null, policyStatus: 'loading' }).kind, 'silent',
  'no claim about a member’s money is made from a read still in flight');

/* ── the window, while it is open ──────────────────────────────────────── */

{
  const r = cancelDeadline({ ...base, startsAt: inHours(72), policy: CHARGES });
  eq(r.kind, 'open', 'three days out, the window is open');
  ok(/Free to cancel or move until Mon 7:00 am/.test(note(r)), 'and it names the moment it closes');
  // The figure comes from `feeAmountLine`, which is the one place in the app
  // that prices a coach's whole-unit fee. A literal here would be a second
  // opinion about how somebody's money is written.
  ok(note(r).includes(feeAmountLine(25, 'GBP')), 'and what happens after, in the coach’s own money');
  ok(/moving is no longer offered/.test(note(r)),
    'including the control that will disappear, which nothing said before');
  if (r.kind === 'open') {
    eq(r.deadlineAt, new Date(NOW + 48 * HOUR).toISOString(), 'the deadline is 24 hours before a 72-hour session');
    eq(r.closingSoon, false, 'and two days off is not closing soon');
  }
}

{
  // The deadline is derived from the same `noticeHoursOf` the window test uses.
  // A second subtraction here would eventually be an hour away from the one
  // the button obeys, in front of somebody who planned around the wrong one.
  eq(freeUntil(inHours(72), LONG), new Date(NOW + 24 * HOUR).toISOString(),
    'a 48-hour policy moves the deadline, it does not move the session');
  eq(freeUntil('not a date', CHARGES), null, 'and an unreadable start has no deadline');
  eq(freeUntil(inHours(72), null), new Date(NOW + 48 * HOUR).toISOString(),
    'an unread policy falls back to the notice the app has always warned about');
}

{
  const r = cancelDeadline({ ...base, startsAt: inHours(28), policy: CHARGES });
  if (r.kind !== 'open') { errors.push('four hours before the deadline is still open'); }
  else {
    eq(Math.round(r.hoursLeft ?? 0), 4, 'the hours left are exposed for the caller');
    eq(r.closingSoon, true, `and ${CLOSING_SOON_HOURS} hours or fewer is marked`);
  }
}
{
  const r = cancelDeadline({ ...base, startsAt: inHours(24 + CLOSING_SOON_HOURS + 1), policy: CHARGES });
  if (r.kind === 'open') eq(r.closingSoon, false, 'and an hour beyond it is not');
}

{
  // A coach who does not charge has no window to be inside, which is the rule
  // `canOfferMove` follows. This line and that button must never disagree.
  const r = cancelDeadline({ ...base, startsAt: inHours(2), policy: FREE });
  eq(r.kind, 'open', 'a coach who does not charge leaves the window open to the last minute');
  ok(/at any time/.test(note(r)), 'and the member is told so');
  ok(!/Mon 7:00 am/.test(note(r)), 'no deadline is named, because there is not one');
  if (r.kind === 'open') eq(r.deadlineAt, null, 'and none is returned either');
  eq(canOfferMove(inHours(2), FREE, NOW), true, 'and Move is genuinely still offered');
}

/* ── the window, once it has closed ────────────────────────────────────── */

{
  const r = cancelDeadline({ ...base, startsAt: inHours(5), policy: CHARGES });
  eq(r.kind, 'closed', 'five hours out, on a 24-hour notice, the window has closed');
  ok(/Moving it is no longer offered/.test(note(r)),
    'and the vanished control is announced rather than simply absent');
  ok(note(r).includes(feeAmountLine(25, 'GBP')), 'and the fee cancelling would record is stated');
  ok(/Repple doesn’t take that payment/.test(note(r)),
    'with the same disclaimer every other money sentence in this app carries');
  eq(canOfferMove(inHours(5), CHARGES, NOW), false,
    'and this branch is exactly the state in which Move is withheld');
}

{
  // The boundary belongs to `insideNoticeWindow`, not to a second copy of it.
  eq(cancelDeadline({ ...base, startsAt: inHours(24.01), policy: CHARGES }).kind, 'open',
    'a moment outside the notice is outside it');
  eq(cancelDeadline({ ...base, startsAt: inHours(23.99), policy: CHARGES }).kind, 'closed',
    'and a moment inside it is inside it');
  // Exactly on it. `insideNoticeWindow` is `start - now < notice`, strictly, and
  // supabase/parts/126 computes the same expression in SQL — so the fee the
  // member is warned about and the fee that gets recorded are decided by one
  // rule. A `<=` here would refuse a move the server would have allowed.
  eq(cancelDeadline({ ...base, startsAt: inHours(24), policy: CHARGES }).kind, 'open',
    'exactly the notice period is still outside the window');
}

{
  const r = cancelDeadline({ ...base, startsAt: inHours(5), policy: UNPRICED });
  eq(r.kind, 'closed', 'a coach who charges but has not said how much still closes the window');
  ok(/haven’t set an amount/.test(note(r)), 'and the member is told to ask rather than shown a nought');
  ok(!/\b0\b/.test(note(r)), 'a fee nobody stated is never printed as zero');
}

{
  // The same coach, read from outside the window. The sentence about what
  // happens AFTER the deadline must be as careful about an unstated fee as the
  // one about what is happening now.
  const r = cancelDeadline({ ...base, startsAt: inHours(72), policy: UNPRICED });
  eq(r.kind, 'open', 'an unpriced policy still has a deadline');
  ok(/haven’t set an amount/.test(note(r)), 'and the amount is asked for rather than invented');
  ok(!/\b0\b/.test(note(r)), 'never as a zero, which reads as "this is free"');
}

{
  const r = cancelDeadline({ ...base, startsAt: inHours(5), policy: NO_CURRENCY });
  ok(/set a currency/.test(note(r)),
    'a bare 25 in a sentence is read in whatever money the reader is thinking in');
}

/* ── the three ways to have no policy, which are three sentences ───────── */

{
  const r = cancelDeadline({ ...base, startsAt: inHours(72), policy: null, policyStatus: 'error' });
  eq(r.kind, 'open', 'an unread policy still has the window this app assumes');
  ok(/could not be read/.test(note(r)), 'and says the window is an assumption, not their coach’s terms');
  ok(new RegExp(noticeLabel(24)).test(note(r)), 'naming the notice it is assuming');
}
{
  // A STALE policy under a failed read. `useCancellationPolicy` sets 'error'
  // and leaves whatever it had in place, so this is the ordinary shape of a
  // reload that failed on a gym's wifi — and it is the one case where the
  // object in hand is not evidence. Quoting "£25, on 24 hours' notice" off a
  // read that just failed states somebody's terms as current when the app has
  // no idea whether they still are.
  const r = cancelDeadline({ ...base, startsAt: inHours(72), policy: CHARGES, policyStatus: 'error' });
  ok(/could not be read/.test(note(r)), 'a failed read is said to have failed');
  ok(!note(r).includes(feeAmountLine(25, 'GBP')),
    'and a fee held over from before it is not quoted as current');
}

{
  const r = cancelDeadline({ ...base, startsAt: inHours(72), policy: null, policyStatus: 'ready' });
  eq(r.kind, 'open', 'a member with no coach on record gets the assumed window too');
  ok(/No cancellation policy is recorded/.test(note(r)),
    'but a different sentence — a read that came back empty is not a read that failed');
  ok(!/could not be read/.test(note(r)), 'and it does not borrow the failure’s wording');
}
{
  const a = note(cancelDeadline({ ...base, startsAt: inHours(5), policy: null, policyStatus: 'error' }));
  const b = note(cancelDeadline({ ...base, startsAt: inHours(5), policy: null, policyStatus: 'ready' }));
  ok(a !== b, 'and the two stay different inside the window as well');
  ok(/Moving it is no longer offered/.test(a) && /Moving it is no longer offered/.test(b),
    'both of which still explain the missing button');
  ok(!/0|free/i.test(a), 'neither of them claims cancelling is free');
}

/* ── the deadline when the caller could not format one ─────────────────── */

{
  const r = cancelDeadline({ ...base, startsAt: inHours(72), policy: CHARGES, when: null });
  ok(/until 24 hours before it starts/.test(note(r)),
    'the window is stated as a span rather than as a hand-built date');
  ok(!/\d+\/\d+/.test(note(r)), '"9/12" is 9 December in London and 12 September in New York');
}

/* ── somebody else's notice period ─────────────────────────────────────── */

{
  const r = cancelDeadline({ ...base, startsAt: inHours(30), policy: LONG });
  eq(r.kind, 'closed', 'a coach who asks for 48 hours has closed the window at 30');
  ok(/48 hours/.test(note(r)), 'and the sentence quotes their number, not the app’s');
  eq(canOfferMove(inHours(30), LONG, NOW), false, 'which is also when Move goes');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('cancelDeadline: ok — the notice window is a fact on the row, not a surprise inside the confirm');
