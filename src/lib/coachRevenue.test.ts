// Revenue that counts what happened.
//
// The bug this replaces, exactly as it shipped:
//
//     sessions.filter(s => s.status === 'booked' && startsAt <= now).length * fee
//
// A no-show is booked and in the past. So is a session the coach never turned
// up to, and so is a slot nobody remembered to cancel. Every one of them was
// income on the coach's hero figure, on their at-risk figure, and in the AI
// digest written from both.
//
// The assertions below are almost all one sentence said different ways: ONLY
// `outcome === 'completed'` is money, and an unmarked session is its own state
// that is folded into neither side. The second half of the file is about the
// same rule one level up — a count over a read that was not whole is not a
// smaller count, it is a wrong one.
import {
  monthToDate, sessionMonth, sessionMonthFor, deliveredValue, unmarkedValue,
  unmarkedLine, sessionsUnknownLine, takingsStrands,
  UNKNOWN_MONTH, DELIVERED_IS_MARKED, TAKINGS_IS_GROSS, TWO_FIGURES_NEVER_SUM,
} from './coachRevenue';
import { ledger } from './coachLedger';
import type { HistoryRow } from './sessionHistory';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the window ───────────────────────────────────────────────────────────── */
//
// Local midnight on the 1st, whatever timezone the runner is in. `test:zones`
// runs this suite under six of them, from Kiritimati to Midway, which is the
// only way a month boundary assertion means anything.

const NOW = new Date(2026, 8, 17, 14, 30, 0); // 17 Sep 2026, local
const { from, to } = monthToDate(NOW);
eq(new Date(from).getDate(), 1, 'the window opens on the 1st');
eq(new Date(from).getMonth(), 8, 'of the month containing now');
eq(new Date(from).getHours(), 0, 'at local midnight');
eq(to, NOW.getTime(), 'and closes at now, not at the end of the month');

/** An hour on the given local day of September 2026. */
const day = (d: number, h = 10) => new Date(2026, 8, d, h, 0, 0).toISOString();

const row = (o: Partial<HistoryRow> & { startsAt: string }): HistoryRow =>
  ({ status: 'booked', durationMin: 60, outcome: null, outcomeAt: null, ...o });

/* ── only a marked outcome is delivered ───────────────────────────────────── */

const BOOK: HistoryRow[] = [
  row({ startsAt: day(2), outcome: 'completed' }),
  row({ startsAt: day(3), outcome: 'completed' }),
  row({ startsAt: day(4), outcome: 'no_show' }),
  row({ startsAt: day(5), outcome: 'cancelled' }),
  row({ startsAt: day(6), outcome: 'late_cancelled' }),
  // Booked, its hour is long over, nobody has said. THE state.
  row({ startsAt: day(7) }),
  row({ startsAt: day(8) }),
];

const m = sessionMonth(BOOK, 'ready', from, to);
eq(m.delivered, 2, 'two sessions were actually delivered');
eq(m.missed, 1, 'a no-show is a no-show');
eq(m.cancelled, 1, 'a cancellation with notice is its own state');
eq(m.lateCancelled, 1, 'and a late one is kept apart from it, because gyms pay for one and not the other');
eq(m.unmarked, 2, 'two still need an outcome recorded');

// The old figure. Every one of the seven above is booked and in the past.
eq(BOOK.filter((r) => r.status === 'booked' && Date.parse(r.startsAt) <= to).length, 7,
  'the clock says seven, which is the bug');
ok(m.delivered !== 7, 'and the record says two');

/* ── an unmarked session is never folded into either side ─────────────────── */

const total = (x: typeof m) =>
  (x.delivered ?? 0) + (x.missed ?? 0) + (x.cancelled ?? 0) + (x.lateCancelled ?? 0) + (x.unmarked ?? 0);
eq(total(m), 7, 'every booked past session lands in exactly one bucket');
eq(deliveredValue(m, 50), 100, 'and only the delivered ones are priced');
eq(unmarkedValue(m, 50), 100, 'the unmarked ones are priced SEPARATELY, so their size is visible');
ok(deliveredValue(m, 50)! + unmarkedValue(m, 50)! !== deliveredValue(m, 50),
  'and the two are two figures, never one');

/* ── the future is not unmarked ───────────────────────────────────────────── */

const withFuture = [...BOOK, row({ startsAt: day(25) }), row({ startsAt: day(30) })];
eq(sessionMonth(withFuture, 'ready', from, to).unmarked, 2,
  'next week’s bookings are not sessions waiting on an outcome');
eq(sessionMonth(withFuture, 'ready', from, to).delivered, 2, 'nor are they delivered');

// The hour somebody is standing in is not history either: it started, it has
// not ended. `hasEnded` uses the END of the session for exactly this.
const inProgress = [row({ startsAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), durationMin: 60 })];
eq(sessionMonth(inProgress, 'ready', from, to).unmarked, 0,
  'a session in progress is not yet waiting on an outcome');

// A session MARKED delivered before its hour is up still counts. A coach who
// finished early and marked it must not be told it did not happen.
const markedEarly = [row({ startsAt: day(17, 9), durationMin: 600, outcome: 'completed' })];
eq(sessionMonth(markedEarly, 'ready', from, to).delivered, 1,
  'a session marked delivered before it has ended is delivered');
// The upper bound is still now and not the end of the month, so a booking
// already marked for NEXT week is not this week's income.
eq(sessionMonth([row({ startsAt: day(30), outcome: 'completed' })], 'ready', from, to).delivered, 0,
  'and a session marked for a date still in the future is not history');

/* ── an open slot is not a session ────────────────────────────────────────── */

const slots = [
  row({ startsAt: day(2), status: 'available' }),
  row({ startsAt: day(3), status: 'blocked' }),
  // …but a row carrying an outcome is a real session whatever its slot says.
  row({ startsAt: day(4), status: 'available', outcome: 'completed' }),
];
const sm = sessionMonth(slots, 'ready', from, to);
eq(sm.unmarked, 0, 'an hour nobody booked is not an hour waiting on an outcome');
eq(sm.delivered, 1, 'and a marked outcome makes it a session whatever the slot state says');

/* ── an outcome this build has never heard of is unmarked, not delivered ──── */

const future = [row({ startsAt: day(2), outcome: 'rescheduled_by_gym' as any })];
eq(sessionMonth(future, 'ready', from, to).delivered, 0,
  'a value added to the check constraint later is not paid work by default');
eq(sessionMonth(future, 'ready', from, to).unmarked, 1,
  'it is the state that asks a human to look');

/* ── the month is a month ─────────────────────────────────────────────────── */

const spanning: HistoryRow[] = [
  row({ startsAt: new Date(2026, 7, 31, 10).toISOString(), outcome: 'completed' }),
  row({ startsAt: day(1, 0), outcome: 'completed' }),
  row({ startsAt: day(16), outcome: 'completed' }),
];
eq(sessionMonth(spanning, 'ready', from, to).delivered, 2,
  'last month is last month, and the 1st at midnight is in');

/* ── A COUNT OVER A SHORT READ IS A WRONG COUNT ───────────────────────────── */

for (const st of ['loading', 'partial', 'error'] as LoadStatus[]) {
  const short = sessionMonth(BOOK, st, from, to);
  eq(short.delivered, null, `no delivered count under '${st}'`);
  eq(short.unmarked, null, `no unmarked count under '${st}' — an all-clear made of our own failure`);
  eq(short.missed, null, `no missed count under '${st}'`);
  eq(deliveredValue(short, 50), null, `and therefore no money figure under '${st}'`);
  eq(unmarkedValue(short, 50), null, `nor an unmarked one under '${st}'`);
  eq(unmarkedLine(short), null, `and nothing to say about it under '${st}'`);
}
eq(sessionMonth(BOOK, 'error', from, to).delivered, UNKNOWN_MONTH.delivered,
  'a short read gets the unknown month');

/* ── a rate of nought is a rate, and no rate is no figure ─────────────────── */

eq(deliveredValue(m, null), null, 'no session rate means no figure, never nought');
eq(deliveredValue(m, undefined), null, 'and the same for an absent one');
eq(deliveredValue(m, 0), 0, 'but a coach who charges nothing earns nothing, which is a fact');
eq(unmarkedValue(m, null), null, 'the unmarked figure follows the same rule');

/* ── the sentence about the unmarked ones ─────────────────────────────────── */

eq(unmarkedLine(sessionMonth([], 'ready', from, to)), null,
  'nothing outstanding says nothing — a permanent all-clear teaches people to stop reading');
const one = unmarkedLine(sessionMonth([row({ startsAt: day(7) })], 'ready', from, to))!;
ok(one.startsWith('One session'), 'one reads as a word');
ok(one.includes('outcome recorded'),
  'and borrows gymSessions’ own words rather than inventing a second vocabulary');
const many = unmarkedLine(m)!;
ok(many.startsWith('2 sessions'), 'two read as a count');
for (const line of [one, many, DELIVERED_IS_MARKED, TAKINGS_IS_GROSS, TWO_FIGURES_NEVER_SUM]) {
  ok(line.endsWith('.'), 'every sentence here is a sentence');
  ok(!line.includes('!'), 'and none of them shouts');
  ok(line[0] === line[0].toUpperCase(), 'sentence case, opening capital');
}
ok(DELIVERED_IS_MARKED.includes('clock'), 'the note names what it is no longer counting');
ok(TWO_FIGURES_NEVER_SUM.includes('twice'), 'and the two-figures note says why they are not added');

for (const st of ['loading', 'partial', 'error'] as LoadStatus[]) {
  const line = sessionsUnknownLine(st);
  ok(line.length > 15, `'${st}' has a sentence`);
  ok(!/\b0\b|zero/.test(line) || st === 'error', `'${st}' does not read as a count`);
}
ok(sessionsUnknownLine('error').includes('not a count of zero'),
  'a failed read says outright that it is not nought');
ok(sessionsUnknownLine('partial').includes('short'),
  'and a truncated one says the more dangerous thing: the number would look plausible');

/* ── at risk, on the same basis ───────────────────────────────────────────── */

const withClients: (HistoryRow & { clientId: string | null })[] = [
  { ...row({ startsAt: day(2), outcome: 'completed' }), clientId: 'ana' },
  { ...row({ startsAt: day(3), outcome: 'completed' }), clientId: 'ben' },
  { ...row({ startsAt: day(4), outcome: 'no_show' }), clientId: 'ana' },
  { ...row({ startsAt: day(5) }), clientId: 'ana' },
  { ...row({ startsAt: day(6), outcome: 'completed' }), clientId: null },
];
const risky = sessionMonthFor(withClients, new Set(['ana']), 'ready', from, to);
eq(risky.delivered, 1, 'at-risk revenue counts only what those clients actually took');
eq(risky.missed, 1, 'their no-show is not revenue at risk, it is revenue already gone');
eq(risky.unmarked, 1, 'and their unmarked session is still its own state');
eq(sessionMonthFor(withClients, new Set(['ana']), 'error', from, to).delivered, null,
  'and none of it is quoted off a short read');
eq(sessionMonthFor(withClients, new Set<string>(), 'ready', from, to).delivered, 0,
  'nobody at risk is nothing at risk, which is a real answer');
eq(sessionMonthFor(withClients, new Set(['ana', 'ben']), 'ready', from, to).delivered, 2,
  'an unattributed session belongs to nobody and is counted for nobody');

/* ── the takings half: one money rule, not a second ───────────────────────── */

const paid = (cents: number, currency: string | null, at2: string) =>
  ({ amount_cents: cents, currency, created_at: at2 });

const strands = takingsStrands(
  { sales: 'ready', renewals: 'ready', receipts: 'ready' },
  {
    sale: [paid(60000, 'aed', day(2))],
    renewal: [paid(60000, 'aed', day(3))],
    receipt: [paid(20000, 'aed', day(4))],
  },
);
eq(strands.length, 3, 'three strands: sales, renewals and the cash Stripe never saw');
const led = ledger(strands);
eq(led.total?.pots[0].minorUnits, 140000, 'and they add up, in one currency');
eq(led.total?.pots.length, 1, 'into one pot');

// Cash is not optional. For most self-employed coaches it is the larger half.
for (const which of ['sales', 'renewals', 'receipts'] as const) {
  const bad = ledger(takingsStrands(
    { sales: 'ready', renewals: 'ready', receipts: 'ready', [which]: 'error' } as any,
    { sale: [paid(60000, 'aed', day(2))], renewal: [], receipt: [paid(20000, 'aed', day(4))] },
  ));
  eq(bad.total, null, `a failed '${which}' read withholds the whole total`);
  ok(bad.reason != null && bad.reason.length > 20, `and says which half is missing ('${which}')`);
}
ok(ledger(takingsStrands(
  { sales: 'ready', renewals: 'ready', receipts: 'error' },
  { sale: [], renewal: [], receipt: [] },
)).missing.includes('payments you recorded yourself'),
  'the cash strand is named in the coach’s own words when it is the missing one');

// Two currencies are never one figure.
const twoCur = ledger(takingsStrands(
  { sales: 'ready', renewals: 'ready', receipts: 'ready' },
  { sale: [paid(60000, 'aed', day(2)), paid(9000, 'gbp', day(3))], renewal: [], receipt: [] },
));
eq(twoCur.total?.pots.length, 2, 'AED and GBP are two pots and never one sum');

// An amount with no unit is counted, never dropped and never guessed at.
const noCur = ledger(takingsStrands(
  { sales: 'ready', renewals: 'ready', receipts: 'ready' },
  { sale: [paid(60000, null, day(2))], renewal: [], receipt: [] },
));
eq(noCur.total?.unlabelled, 1, 'a sale with no currency is a hole in the total, and the hole is reported');
eq(noCur.total?.pots.length, 0, 'and no default currency is invented for it');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachRevenue.test.ts — ok');
