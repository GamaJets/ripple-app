// Correcting a membership's two dates. Compile with tsc, run with node.
//
// Three failures this guards, and each one costs a gym something it cannot get
// back later: a correction that silently writes nothing and reports success, an
// end date retyped over the days a pause gave back, and an end date in the past
// mistaken for a cancellation.
import { datesRefusal, datesPatch, datesNotes, termLine, type MembershipTerm } from './membershipDates';

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
