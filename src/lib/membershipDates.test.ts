// Correcting a membership's two dates. Compile with tsc, run with node.
//
// Three failures this guards, and each one costs a gym something it cannot get
// back later: a correction that silently writes nothing and reports success, an
// end date retyped over the days a pause gave back, and an end date in the past
// mistaken for a cancellation.
import {
  datesRefusal, datesPatch, datesNotes, termLine, unpausedEndsOn,
  lensMatch, EXPIRING_DAYS, type MembershipTerm,
} from './membershipDates';
import { thawedEndsOn } from './membershipFreeze';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (over: Partial<MembershipTerm> = {}): MembershipTerm => ({
  startedOn: '2024-03-01', endsOn: null, frozenFrom: null, frozenTo: null, status: 'active', ...over,
});

/* ── what may not be saved ────────────────────────────────────────────────── */

eq(datesRefusal({ startedOn: '2024-03-01', endsOn: null }), null, 'a start date and no end is a membership');
eq(datesRefusal({ startedOn: '2024-03-01', endsOn: '' }), null, 'an empty end field is open-ended, not a bad date');
eq(datesRefusal({ startedOn: '2024-03-01', endsOn: '2025-03-01' }), null, 'a term with both ends is fine');
// A day pass is a membership that starts and ends on the same day. Gyms sell
// them, so this is not the backwards range below.
eq(datesRefusal({ startedOn: '2024-03-01', endsOn: '2024-03-01' }), null, 'one day is a term');

ok(datesRefusal({ startedOn: null, endsOn: null }) != null, 'a membership must start somewhere');
ok(datesRefusal({ startedOn: '01/03/2024', endsOn: null }) != null, 'another date format is refused, not parsed');
ok(datesRefusal({ startedOn: '2024-03-01', endsOn: '2025-13-40' }) != null, 'an end that did not parse is refused');
ok(datesRefusal({ startedOn: '2024-03-01', endsOn: '2023-03-01' }) != null, 'it cannot end before it starts');

/* ── nothing changed is not a save ────────────────────────────────────────── */

// The whole reason this function exists. `setMembershipDates` returns without
// writing and without throwing on an empty patch, so a caller that cannot tell
// "nothing to do" from "done" closes the sheet over an uncorrected row.
eq(datesPatch({ startedOn: '2024-03-01', endsOn: null }, { startedOn: '2024-03-01', endsOn: null }), null,
  'identical dates produce no patch at all');
eq(datesPatch({ startedOn: '2024-03-01', endsOn: null }, { startedOn: '2024-03-01', endsOn: '' }), null,
  'an empty field over a null end is the same membership');
eq(datesPatch({ startedOn: '2024-03-01', endsOn: undefined }, { startedOn: '2024-03-01', endsOn: null }), null,
  'and so is a null over an absent one');

same(datesPatch({ startedOn: '2024-03-01', endsOn: null }, { startedOn: '2022-09-14', endsOn: null }),
  { startedOn: '2022-09-14' }, 'a corrected start date is sent alone');
// `endsOn` is present-or-absent and not nullable-and-always-sent, because null
// MEANS open-ended. A patch that always carried it would clear the end date of
// every membership whose start was corrected.
same(datesPatch({ startedOn: '2024-03-01', endsOn: '2025-03-01' }, { startedOn: '2022-09-14', endsOn: '2025-03-01' }),
  { startedOn: '2022-09-14' }, 'an unchanged end date is left out of the patch entirely');
same(datesPatch({ startedOn: '2024-03-01', endsOn: '2025-03-01' }, { startedOn: '2024-03-01', endsOn: '' }),
  { endsOn: null }, 'clearing the end date sends null, which is open-ended');
same(datesPatch({ startedOn: '2024-03-01', endsOn: null }, { startedOn: '2022-09-14', endsOn: '2025-03-01' }),
  { startedOn: '2022-09-14', endsOn: '2025-03-01' }, 'both changed, both sent');

/* ── what has to be said before it is saved ───────────────────────────────── */

same(datesNotes(row(), { startedOn: '2024-03-01', endsOn: null }, '2026-09-13'), [],
  'a correction that changes nothing has nothing to warn about');

// A pause already pushed `ends_on` out. Retyping it by hand takes those days
// away again, and nothing anywhere records that they existed.
const paused = row({ endsOn: '2026-07-15', frozenFrom: '2026-06-12', frozenTo: '2026-06-26' });
ok(datesNotes(paused, { startedOn: '2024-03-01', endsOn: '2026-06-30' }, '2026-01-01')
  .some((s) => s.includes('pause')), 'replacing the end date over a recorded pause says so');
ok(!datesNotes(paused, { startedOn: '2022-09-14', endsOn: '2026-07-15' }, '2026-01-01')
  .some((s) => s.includes('pause')), 'but correcting only the start date does not');

// An end date is not a door. Nothing flips the status at midnight, so a
// membership that "ended" last month still opens the turnstile.
ok(datesNotes(row(), { startedOn: '2024-03-01', endsOn: '2026-08-01' }, '2026-09-13')
  .some((s) => s.includes('Active')), 'an end date already past is not a cancellation, and the note says which status stands');
ok(datesNotes(row({ status: 'frozen' }), { startedOn: '2024-03-01', endsOn: '2026-08-01' }, '2026-09-13')
  .some((s) => s.includes('Frozen')), 'a frozen membership is named as frozen, not as active');
ok(!datesNotes(row({ status: 'cancelled' }), { startedOn: '2024-03-01', endsOn: '2026-08-01' }, '2026-09-13')
  .some((s) => s.includes('status')), 'a cancelled membership is already closed, so there is nothing to warn about');
ok(!datesNotes(row(), { startedOn: '2024-03-01', endsOn: '2027-08-01' }, '2026-09-13')
  .some((s) => s.includes('already passed')), 'an end date in the future is just an end date');

// Compared as strings. A day either side of today, with no Date constructed,
// so no reader's timezone can move the boundary.
ok(datesNotes(row(), { startedOn: '2024-03-01', endsOn: '2026-09-12' }, '2026-09-13')
  .some((s) => s.includes('already passed')), 'yesterday has passed');
ok(!datesNotes(row(), { startedOn: '2024-03-01', endsOn: '2026-09-13' }, '2026-09-13')
  .some((s) => s.includes('already passed')), 'today has not');

ok(datesNotes(row(), { startedOn: '2022-09-14', endsOn: null }, '2026-09-13')
  .some((s) => s.includes('billing anniversary')), 'a moved start date says what moves with it');

/* ── the pause that is already inside the end date ────────────────────────── */

// The compounding this exists to stop. app/(owner)/members.tsx seeds its pause
// sheet from the dates ON THE ROW and then recomputed the new end date from
// `ends_on`, which ALREADY holds those days — so re-saving an unchanged pause
// pushed the term out by its length again, and again on every tap after that.
const june = { endsOn: '2026-07-15', frozenFrom: '2026-06-12', frozenTo: '2026-06-26' };
eq(unpausedEndsOn(june), '2026-06-30', 'the fifteen days a recorded pause gave back come back off');
// The whole point, stated as the round trip the screen performs: the same pause
// saved a second time lands on the same end date, not a fortnight past it.
eq(thawedEndsOn(unpausedEndsOn(june), { from: '2026-06-12', to: '2026-06-26' }), '2026-07-15',
  're-saving an unchanged pause leaves the end date exactly where it is');
// And a SHORTENED pause pulls it back rather than pushing it further out, which
// the old arithmetic could not do in principle.
eq(thawedEndsOn(unpausedEndsOn(june), { from: '2026-06-12', to: '2026-06-13' }), '2026-07-02',
  'a pause corrected shorter shortens the term back down');
eq(thawedEndsOn(unpausedEndsOn(june), { from: '2026-06-12', to: '2026-07-11' }), '2026-07-30',
  'and a pause corrected longer replaces the old days rather than stacking on them');

// A row with no pause on it is the FIRST freeze, which `thawedEndsOn` was
// always right about — nothing has been given back, so nothing comes off.
eq(unpausedEndsOn({ endsOn: '2026-06-30', frozenFrom: null, frozenTo: null }), '2026-06-30',
  'a membership never paused is returned untouched');
// A pause this build cannot read is not a pause of zero days, and guessing a
// quantity to subtract would be the same mistake pointing the other way.
eq(unpausedEndsOn({ endsOn: '2026-06-30', frozenFrom: '2026-06-26', frozenTo: '2026-06-12' }), '2026-06-30',
  'a backwards range has no length to take off, so the end date is left alone');
eq(unpausedEndsOn({ endsOn: '2026-06-30', frozenFrom: '2026-13-40', frozenTo: '2026-06-12' }), '2026-06-30',
  'and neither does one that did not parse');
// An open-ended membership has no date to take days off. Null, so the screen
// says there is nothing to extend rather than inventing a term.
eq(unpausedEndsOn({ endsOn: null, frozenFrom: '2026-06-12', frozenTo: '2026-06-26' }), null,
  'an open-ended membership has no end date to unwind');
eq(unpausedEndsOn({ endsOn: '30/06/2026', frozenFrom: null, frozenTo: null }), null,
  'and an end date that cannot be read is not reasoned about');

// Inclusive at both ends, the same day-count `frozenDays` uses everywhere: a
// pause from the 12th to the 12th is one day the member could not train.
eq(unpausedEndsOn({ endsOn: '2026-07-01', frozenFrom: '2026-06-12', frozenTo: '2026-06-12' }), '2026-06-30',
  'a one-day pause gave back one day');

/* ── the three groups an owner is actually looking for ───────────────────── */

const TODAY = '2026-09-14';
const lens = (l: Parameters<typeof lensMatch>[0], over: Partial<MembershipTerm>) =>
  lensMatch(l, row(over), TODAY);

// 'all' is every row, including the ones no date lens can answer for. A row
// that answers no question still has to be reachable.
ok(lens('all', {}), 'all holds an open-ended membership');
ok(lens('all', { status: 'cancelled', endsOn: null }), 'and a cancelled one with no dates');

/* expiring — the renewal conversation, and it happens before the date */
ok(lens('expiring', { endsOn: TODAY }), 'a membership ending today is expiring today');
ok(lens('expiring', { endsOn: '2026-10-14' }), 'and one ending on the last day of the window is inside it');
ok(!lens('expiring', { endsOn: '2026-10-15' }), 'one day past the window is outside it');
eq(EXPIRING_DAYS, 30, 'the window the chip names is the window the filter uses');
// Already past is not "expiring soon" — it is the overrun below, and putting it
// in both would have an owner ringing somebody about a renewal that lapsed in
// June.
ok(!lens('expiring', { endsOn: '2026-09-13' }), 'yesterday has expired, not expiring');
// Neither unknown is folded in on either side. An open-ended membership does
// not expire and an unreadable end date cannot be reasoned about, so neither is
// counted into a figure that would be read as a total.
ok(!lens('expiring', { endsOn: null }), 'an open-ended membership is never expiring');
ok(!lens('expiring', { endsOn: '14/10/2026' }), 'and an end date that did not parse is not counted either way');
// Only a membership the door would still let through.
ok(!lens('expiring', { endsOn: '2026-10-01', status: 'cancelled' }), 'a cancelled membership is not up for renewal');
ok(lens('expiring', { endsOn: '2026-10-01', status: 'frozen' }), 'a paused one still has a term running out');

/* overrun — the one nothing else in this product can find */
// supabase/parts/2616: nothing flips `status` at midnight, so this set exists
// and, until this lens, could not be listed anywhere.
ok(lens('overrun', { endsOn: '2026-06-30' }), 'a term that ran out in June on an Active membership is an overrun');
ok(lens('overrun', { endsOn: '2026-09-13', status: 'frozen' }), 'and so is one on a paused membership');
ok(!lens('overrun', { endsOn: TODAY }), 'today has not passed');
ok(!lens('overrun', { endsOn: '2026-06-30', status: 'cancelled' }), 'a cancelled membership is a closed contract, not an overrun');
ok(!lens('overrun', { endsOn: '2026-06-30', status: 'expired' }), 'and neither is one already marked expired');
ok(!lens('overrun', { endsOn: null }), 'an open-ended membership cannot have run out');

/* paused — who is away, and who this build cannot say about */
ok(lens('paused', { frozenFrom: '2026-09-20', frozenTo: '2026-09-27' }), 'a pause that has not started yet is one to know about');
ok(lens('paused', { frozenFrom: '2026-09-10', frozenTo: '2026-09-20' }), 'and one running today');
ok(!lens('paused', { frozenFrom: '2026-08-01', frozenTo: '2026-08-10' }), 'a pause that has run its course needs nothing done to it');
ok(!lens('paused', {}), 'no pause recorded is not a pause');
// Loudest of all: a membership whose pause dates cannot be read is not one that
// was never paused, and whether somebody gets in on Tuesday is not a thing to
// be quiet about.
ok(lens('paused', { frozenFrom: '2026-09-27', frozenTo: '2026-09-20' }), 'a backwards range is unreadable, and unreadable is in');
ok(lens('paused', { frozenFrom: '2026-09-10', frozenTo: null }), 'and so is half a pause');
// Status has no say here. The dates are the question, and the disagreement
// between them and the status is what the row on screen exists to show.
ok(lens('paused', { status: 'active', frozenFrom: '2026-09-10', frozenTo: '2026-09-20' }),
  'a pause recorded on a membership the door still says is Active is exactly the row to surface');

/* ── the term, in one line ────────────────────────────────────────────────── */

eq(termLine(row()), '2024-03-01, open-ended', 'a membership with no end says so rather than showing a blank');
eq(termLine(row({ endsOn: '2025-03-01' })), '2024-03-01 to 2025-03-01', 'and a term shows both ends');
eq(termLine(row({ startedOn: null })), null, 'a start date that cannot be read is not printed as one');

if (errors.length) {
  console.error(`membershipDates: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('membershipDates: all assertions passed');
