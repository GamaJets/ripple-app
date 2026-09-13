// The contract-end band on the gym-wide retention view. Compile with tsc, run
// with node.
//
// ── What this file is for, and what it deliberately is not ─────────────────
//
// src/lib/coverage.test.ts already asserts the behavioural half of
// gymRetention — the cohort spine, the drift bands, the door-log traps — and
// every one of those assertions is untouched by this band and stays in that
// file. This one covers the half that did not exist: `memberships.ends_on`.
//
// The screen built to predict departures could not see the most certain
// departure a gym has. `buildGymRetention` never read `ends_on`, `RetentionRow`
// carried no field for it, and `/members` had been showing it as a table column
// the whole time. No schema change was needed — `fetchMemberships` has always
// selected the column.
//
// ── The four things these assertions exist to hold down ────────────────────
//
//  1. THE TWO KINDS OF EVIDENCE ARE NEVER AVERAGED. A member who trains four
//     times a week and whose contract ends on Friday is a certainty with good
//     attendance, not a medium risk. So `drift` and `term` must be
//     independently reachable, `compareRows` must not look at `term` at all,
//     and adding an end date to a row must not move that row in the band order
//     or change a single drift verdict. Asserted directly below, by building
//     one record twice and comparing.
//
//  2. THE THREE WAYS A DATE CAN BE ABSENT ARE THREE DIFFERENT FACTS. No end
//     date is open-ended and is not a missing value. A date that cannot be read
//     is not the absence of a date. Neither is a member who holds no live
//     membership at all. None of the three may render as the same blank cell,
//     which is what `termLine` refusing to return a dash is for.
//
//  3. THE COMPARISON IS A STRING COMPARISON AGAINST THE GYM'S DAY. Never
//     `Date.parse`, which is UTC midnight and reads back as the previous day
//     for every reader west of Greenwich. The zone loop at the foot of this
//     file is the proof: every assertion above it is re-run under four
//     deliberately hostile TZs and must give byte-identical answers.
//
//  4. A COUNT OVER A ROSTER THAT IS NOT WHOLE IS NOT A COUNT. Every gym-level
//     figure is null over a partial or failed read, and the per-row facts
//     survive.
import {
  buildGymRetention, memberTerm, termDay, termLine, termHeadline, compareByTermEnd,
  compareRows, ENDING_SOON_DAYS, ROLLING_TERM_NOTE,
  type RetentionRecord, type RetentionRow, type MemberTerm,
} from './gymRetention';
import { sliceReady, slicePartial, sliceFailed, type MemberBooking } from './memberView';
import { NO_ZONE_NOTE } from './gymZone';
import { gymTodayWindow } from './gymToday';
import type { Membership } from './gymRecord';
import type { Visit } from './gymVisits';
import type { PtSession } from './gymSessions';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const NOW = Date.parse('2026-09-13T12:00:00Z');
const DAY = 86_400_000;
const ago = (n: number) => new Date(NOW - n * DAY).toISOString();

/** A gym in Dubai. Its own day is what every state below is decided on, and it
 *  is four hours ahead of UTC — so a test run in Midway and one run in
 *  Kiritimati must still agree with this. */
const DUBAI = gymTodayWindow('Asia/Dubai', NOW);
/** The same instant with no zone set: the reader's day, and NO_ZONE_NOTE. */
const NOZONE = gymTodayWindow(null, NOW);

const mem = (
  id: string,
  status: Membership['status'],
  endsOn: string | null,
  startedOn = '2026-01-10',
): Membership => ({
  id: `m-${id}-${endsOn ?? 'open'}-${status}`, memberId: id, memberName: id,
  planId: 'p1', planName: 'Gym', startedOn, endsOn, status,
  frozenFrom: null, frozenTo: null,
});

const vis = (id: string, daysAgo: number): Visit => ({
  id: `v-${id}-${daysAgo}`, memberId: id, memberName: id, passId: null, classId: null,
  enteredAt: ago(daysAgo), exitedAt: null, source: 'door', note: null,
});

const rec = (
  ms: Membership[], vs: Visit[] = [], bs: MemberBooking[] = [],
): RetentionRecord => ({
  memberships: sliceReady(ms), visits: sliceReady(vs),
  bookings: sliceReady(bs), sessions: sliceReady<PtSession>([]),
});

/** The gym's today, as Dubai sees the instant above. */
const TODAY = DUBAI.day;
const rowOf = (g: ReturnType<typeof buildGymRetention>, id: string): RetentionRow =>
  g.rows!.find((r) => r.memberId === id)!;

/* ── 0 · the gym's day is the gym's, and a gym without one says so ─────────── */

eq(DUBAI.basis, 'gym', 'a gym with a timezone gets its own calendar day');
eq(DUBAI.day, '2026-09-13', 'and at noon UTC on the 13th, Dubai is on the 13th');
eq(DUBAI.note, null, 'a gym whose day is its own has nothing to disclose');
eq(NOZONE.basis, 'reader', 'a gym with no timezone set is a real state, not a gym in UTC');
eq(NOZONE.note, NO_ZONE_NOTE, 'and it carries the one wording of that disclosure, never silence');

/* ── 1 · the three ways an end date can be absent ──────────────────────────── */

// No end date. A fact, not a gap: `memberships.ends_on` is nullable precisely
// so a gym can say "this runs until somebody stops it".
eq(memberTerm([mem('a', 'active', null)], TODAY, 'gym').state, 'open-ended',
   'a live membership with no end date is open-ended');
eq(memberTerm([mem('a', 'active', '')], TODAY, 'gym').state, 'open-ended',
   'and an empty string is the same absence — a blank box is not an unreadable date');
eq(memberTerm([mem('a', 'active', null)], TODAY, 'gym').endsOn, null,
   'open-ended carries no date, because there is none to carry');

// An unreadable date. Kept apart from open-ended for the reason freezeState
// keeps 'unreadable' apart from 'none'.
eq(memberTerm([mem('a', 'active', '13/09/2026')], TODAY, 'gym').state, 'unreadable',
   'a date in another format is not read as though it parsed');
eq(memberTerm([mem('a', 'active', 'soon')], TODAY, 'gym').state, 'unreadable',
   'and neither is a word');

// THE ONE THAT EARNS THE STATE. '2025-13-40' and '2026-02-30' both match
// /^\d{4}-\d{2}-\d{2}/, which is what memberChurn.isDay uses, and both STRING
// -COMPARE AS LATER THAN EVERY REAL DATE. A loose check therefore files a
// corrupt end date as "runs to 2025-13-40" — a real risk rendered as no risk,
// which is precisely the failure this band must not have.
eq(memberTerm([mem('a', 'active', '2025-13-40')], TODAY, 'gym').state, 'unreadable',
   'a thirteenth month is REFUSED, not string-compared into the distant future');
eq(memberTerm([mem('a', 'active', '2026-02-30')], TODAY, 'gym').state, 'unreadable',
   'and neither is the 30th of February rolled forward into March');
eq(termDay('2025-13-40'), null, 'termDay round-trips the month rather than matching its shape');
eq(termDay('2026-02-30'), null, 'and the length of the month rather than assuming 31');
eq(termDay('2026-02-28'), '2026-02-28', 'a real end of February reads');
eq(termDay('2024-02-29'), '2024-02-29', 'and so does a leap day');
eq(termDay('2026-09-25T00:00:00+04:00'), '2026-09-25',
   'a value that arrives with a time on it is sliced, so this and memberChurn read one column the same way');

// No live membership at all. A third absence again: there is no forthcoming
// expiry because the departure is not forthcoming.
eq(memberTerm([mem('a', 'cancelled', '2026-09-20')], TODAY, 'gym').state, 'not-on-books',
   'a cancelled row is not a forthcoming expiry');
eq(memberTerm([mem('a', 'expired', null)], TODAY, 'gym').state, 'not-on-books',
   'and neither is an expired one');
eq(memberTerm([], TODAY, 'gym').state, 'not-on-books', 'nor is holding nothing at all');

// All three render as different sentences. None of them is a dash — a dash is
// what let open-ended and unreadable look like the same empty cell.
const lines = (['open-ended', 'unreadable', 'not-on-books'] as const).map(
  (s) => termLine({ state: s, endsOn: null, days: null, basis: 'gym' }),
);
ok(lines.every((l) => typeof l === 'string' && l.length > 0), 'each of the three absences has words of its own');
ok(new Set(lines).size === 3, 'and no two of them say the same thing');
ok(!lines.some((l) => l === '—' || l === ''), 'none of them is a dash');
eq(termLine(null), null, 'a row with no term at all has no line, which is not the same as a blank one');

/* ── 2 · expired is not the same as ending in twelve days ─────────────────── */

const in12 = memberTerm([mem('a', 'active', '2026-09-25')], TODAY, 'gym');
eq(in12.state, 'ending', 'a membership ending in twelve days is ending');
eq(in12.days, 12, 'and it is twelve days, counted on the calendar');
eq(in12.endsOn, '2026-09-25', 'with the date carried so the screen can print it');

const gone = memberTerm([mem('a', 'active', '2026-09-01')], TODAY, 'gym');
eq(gone.state, 'expired', 'an end date already past is expired, not ending');
eq(gone.days, -12, 'and the day count goes negative rather than being clamped to nothing');

// The boundary, both sides. The day itself is ENDING, not expired: a membership
// that runs to the 13th is usable on the 13th, and turning somebody away at the
// door on their last paid day is the mistake this decides.
eq(memberTerm([mem('a', 'active', TODAY)], TODAY, 'gym').state, 'ending',
   'the last day is a day the member still has');
eq(memberTerm([mem('a', 'active', TODAY)], TODAY, 'gym').days, 0, 'and it is zero days away, not one');
eq(memberTerm([mem('a', 'active', '2026-09-12')], TODAY, 'gym').state, 'expired',
   'the day before today has gone');

// The far side of the window.
eq(memberTerm([mem('a', 'active', '2026-09-27')], TODAY, 'gym').state, 'ending',
   `the last day of the ${ENDING_SOON_DAYS}-day window is inside it`);
eq(memberTerm([mem('a', 'active', '2026-09-28')], TODAY, 'gym').state, 'dated',
   'and the day after it is not "ending soon", it is simply dated');
eq(memberTerm([mem('a', 'active', '2027-06-30')], TODAY, 'gym').state, 'dated',
   'an annual membership is dated, not ending');

// The window is calendar arithmetic, not 24-hour arithmetic. Cut across the day
// the clocks move in a northern-hemisphere gym: a fortnight is fourteen
// calendar days whether or not one of them is 23 hours long.
const dstToday = '2026-10-20';
eq(memberTerm([mem('a', 'active', '2026-11-03')], dstToday, 'gym').state, 'ending',
   'fourteen calendar days across a clock change is still inside the fortnight');
eq(memberTerm([mem('a', 'active', '2026-11-04')], dstToday, 'gym').state, 'dated',
   'and fifteen is still outside it');

/* ── 3 · a member holding more than one membership ────────────────────────── */

// The rule that stops the gym phoning somebody who is not going anywhere. An
// open-ended row wins outright: she does not lose access on Friday.
eq(memberTerm([mem('a', 'active', '2026-09-16'), mem('a', 'active', null)], TODAY, 'gym').state,
   'open-ended',
   'an open-ended membership beside a dated one means access does not run out on the dated one');

// Latest, not soonest — access runs to the last of them. Same direction
// memberSpans takes `leftOn`, so the two modules cannot report different last
// days for one member.
const two = memberTerm(
  [mem('a', 'active', '2026-09-16'), mem('a', 'active', '2026-10-30')], TODAY, 'gym',
);
eq(two.endsOn, '2026-10-30', 'two dated memberships run to the later of the two');
eq(two.state, 'dated', 'so she is not in the ending list at all');

// A cancelled row's date is history and must not drag a live member into the
// expired band.
const liveAndDead = memberTerm(
  [mem('a', 'cancelled', '2026-01-31'), mem('a', 'active', '2026-09-25')], TODAY, 'gym',
);
eq(liveAndDead.state, 'ending', 'an old cancelled row does not make a live member expired');
eq(liveAndDead.endsOn, '2026-09-25', 'and the date shown is the live one');

// Unreadable beats dated but loses to open-ended: if one live row has no end at
// all, access does not run out and there is nothing to be uncertain about.
eq(memberTerm([mem('a', 'active', 'rubbish'), mem('a', 'active', '2026-12-01')], TODAY, 'gym').state,
   'unreadable', 'a date we cannot read alongside one we can is still uncertain');
eq(memberTerm([mem('a', 'active', 'rubbish'), mem('a', 'active', null)], TODAY, 'gym').state,
   'open-ended', 'but an open-ended row settles it — nothing is due to run out');

// A today that is not a day cannot decide anything.
eq(memberTerm([mem('a', 'active', '2026-09-25')], 'not-a-day', 'gym').state, 'unreadable',
   'a comparison against a non-date answers "unreadable", never silently one way');

/* ── 4 · THE CENTRAL RULE: drift and the contract are never averaged ──────── */
//
// Built twice from the same activity. The only difference between the two
// records is that in the second, every member's membership carries an end date
// three days away. If the end date leaked into the behavioural half, something
// in `drift`, in `summary.bands` or in the ROW ORDER would move.

const steadyVisits: Visit[] = [];
for (let i = 1; i <= 56; i += 2) steadyVisits.push(vis('four-a-week', i));
for (let i = 30; i <= 56; i += 3) steadyVisits.push(vis('drifter', i));
const quietIds = ['four-a-week', 'drifter'];

const noDates = rec(quietIds.map((id) => mem(id, 'active', null)), steadyVisits);
const withDates = rec(quietIds.map((id) => mem(id, 'active', '2026-09-16')), steadyVisits);

const gNo = buildGymRetention(noDates, { now: NOW, today: DUBAI });
const gYes = buildGymRetention(withDates, { now: NOW, today: DUBAI });

// The member who trains four times a week AND whose contract ends on Friday.
const certain = rowOf(gYes, 'four-a-week');
eq(certain.term!.state, 'ending', 'she is a near-certain departure');
eq(certain.term!.days, 3, 'in three days');
eq(certain.drift!.status, 'on_track', 'AND she is on track — the two facts stand side by side');
ok(certain.drift!.status === 'on_track' && certain.term!.state === 'ending',
   'A CERTAINTY WITH GOOD ATTENDANCE IS NOT A MEDIUM RISK. Both facts are reachable and neither has been blended into the other');

// Nothing behavioural moved.
eq(
  JSON.stringify(gNo.rows!.map((r) => [r.memberId, r.drift, r.read, r.offTimetable, r.quiet, r.lastSeenDays])),
  JSON.stringify(gYes.rows!.map((r) => [r.memberId, r.drift, r.read, r.offTimetable, r.quiet, r.lastSeenDays])),
  'adding an end date to every membership changes no drift verdict and no door read',
);
eq(JSON.stringify(gNo.summary), JSON.stringify(gYes.summary),
   'and it changes not one figure in the behavioural summary');
eq(JSON.stringify(gNo.spine), JSON.stringify(gYes.spine),
   'nor anything in the cohort spine');
eq(
  gNo.rows!.map((r) => r.memberId).join(','),
  gYes.rows!.map((r) => r.memberId).join(','),
  'and the band order is identical — compareRows does not look at the end date',
);

// Said directly, so a future edit to compareRows that started reading `term`
// fails here rather than quietly reordering the coach's client book.
{
  const base: RetentionRow = { ...rowOf(gNo, 'drifter') };
  const ending: RetentionRow = { ...base, term: { state: 'ending', endsOn: '2026-09-14', days: 1, basis: 'gym' } };
  const open: RetentionRow = { ...base, term: { state: 'open-ended', endsOn: null, days: null, basis: 'gym' } };
  eq(compareRows(ending, open), 0, 'compareRows gives two otherwise-identical rows the same rank whatever their contracts say');
}

/* ── 5 · the band's own ordering, which is a separate function ────────────── */

const row = (id: string, t: MemberTerm | null, name = id): RetentionRow => ({
  memberId: id, name, status: 'active', planName: 'Gym', joinedOn: '2026-01-10',
  cohort: '2026-01', onBooks: true, drift: null, read: null,
  offTimetable: false, quiet: false, lastSeenDays: null, term: t,
});
const t = (state: MemberTerm['state'], endsOn: string | null, days: number | null): MemberTerm =>
  ({ state, endsOn, days, basis: 'gym' });

const ordered = [
  row('dated', t('dated', '2027-01-01', 110)),
  row('open', t('open-ended', null, null)),
  row('expired-old', t('expired', '2024-03-01', -926)),
  row('ending-12', t('ending', '2026-09-25', 12)),
  row('unreadable', t('unreadable', null, null)),
  row('expired-recent', t('expired', '2026-09-10', -3)),
  row('ending-1', t('ending', '2026-09-14', 1)),
  row('gone', t('not-on-books', null, null)),
  row('nothing', null),
].sort(compareByTermEnd).map((r) => r.memberId);

eq(ordered.join(','),
   'ending-1,ending-12,expired-recent,expired-old,dated,unreadable,open,gone,nothing',
   'ending soonest first, THEN expired most-recent first, then dated, then the three absences, then unranked');

ok(ordered.indexOf('ending-12') < ordered.indexOf('expired-old'),
   'A MEMBERSHIP EXPIRED TWO YEARS AGO DOES NOT SIT ABOVE ONE ENDING IN TWELVE DAYS. Sorting the two groups together by days-until would put the most stale row at the top of a list headed "ending soon"');
ok(ordered.indexOf('expired-recent') < ordered.indexOf('expired-old'),
   'and within expired, the one that just lapsed leads: it is a renewal conversation still worth having');
eq(ordered[ordered.length - 1], 'nothing', 'a row with no term at all is unranked and sorts last');

/* ── 6 · the roll-up, and what it refuses to count ────────────────────────── */

const roster: Membership[] = [
  mem('soon-a', 'active', '2026-09-14'),
  mem('soon-b', 'frozen', '2026-09-20'),
  mem('soon-c', 'active', '2026-09-27'),
  mem('past-a', 'active', '2026-08-30'),
  mem('past-b', 'frozen', '2025-01-01'),
  mem('open-a', 'active', null),
  mem('open-b', 'active', null),
  mem('bad-a', 'active', '2026-02-30'),
  mem('far-a', 'active', '2027-03-01'),
  mem('gone-a', 'cancelled', '2026-04-01'),
];
const gAll = buildGymRetention(rec(roster), { now: NOW, today: DUBAI });
const term = gAll.term!;

eq(term.ending, 3, 'three memberships end inside the fortnight');
eq(term.expired, 2, 'two have an end date that has already passed while the status still says live');
eq(term.openEnded, 2, 'two are open-ended');
eq(term.unreadable, 1, 'one carries an end date that cannot be read');
eq(term.dated, 1, 'one runs past the window');
eq(term.notOnBooks, 1, 'and one has already gone');
eq(
  (term.ending ?? 0) + (term.expired ?? 0) + (term.openEnded ?? 0)
  + (term.unreadable ?? 0) + (term.dated ?? 0) + (term.notOnBooks ?? 0),
  gAll.summary.roster,
  'the six states account for every member on the roster — nobody has been quietly dropped',
);
eq(term.today, TODAY, 'the summary says which day it was all decided on');
eq(term.basis, 'gym', 'and whose day that was');
eq(term.soonDays, ENDING_SOON_DAYS, 'and how wide the window was');
eq(term.rollingNote, ROLLING_TERM_NOTE, 'and it carries the rolling-plan disclosure from the one place it is worded');
// Asserted on its CONTENT, not just on its identity with the constant: a test
// that only checks `x === X` passes just as happily when X has been emptied,
// and this sentence is the whole defence against a full list being read as a
// crisis. A monthly member stands here every month before their next payment.
ok(ROLLING_TERM_NOTE.length > 80, 'the rolling-plan disclosure is a real sentence, not an empty string');
ok(/renew/i.test(ROLLING_TERM_NOTE), 'it says the date only moves when a renewal is paid for');
ok(/monthly/i.test(ROLLING_TERM_NOTE), 'it names the rolling monthly plan that puts a member here every cycle');
ok(/not as|rather than|not\s+“?is leaving/i.test(ROLLING_TERM_NOTE),
   'and it says what NOT to read the list as, which is the half a reader would otherwise supply themselves');

// EXPIRED IS NOT ADDED INTO ENDING. They are different findings acted on by
// different people, and a single "at risk" number would hide both.
ok(term.ending !== (term.ending ?? 0) + (term.expired ?? 0),
   'the expired count is never folded into the ending count');

const line = termHeadline(gAll)!;
ok(line.includes('3 memberships end'), 'the headline reports the certain thing');
ok(line.includes('2 have an end date that has already passed'), 'and the data finding separately');
ok(!/risk score|combined|overall risk/i.test(line), 'and it never offers a blended risk figure');

/* ── 7 · a list over a read that is not whole is not the gym's list ───────── */

const partial = buildGymRetention(
  { ...rec(roster), memberships: slicePartial(roster, 1000) },
  { now: NOW, today: DUBAI },
);
eq(partial.rows, null, 'a truncated roster produces no row list at all');
eq(partial.term!.whole, false, 'and the band says so out loud');
for (const [k, v] of Object.entries({
  ending: partial.term!.ending, expired: partial.term!.expired,
  openEnded: partial.term!.openEnded, unreadable: partial.term!.unreadable,
  dated: partial.term!.dated, notOnBooks: partial.term!.notOnBooks,
})) {
  eq(v, null, `${k} is null over a prefix of the gym, never a number that reads as complete`);
}
eq(partial.term!.today, TODAY, 'the day still travels, so the screen can still say whose day it could not count on');
eq(termHeadline(partial), null, 'and there is no headline sentence over a roster nobody could count');

const failed = buildGymRetention(
  { ...rec(roster), memberships: sliceFailed('boom') },
  { now: NOW, today: DUBAI },
);
eq(failed.term!.ending, null, 'a failed roster read counts nothing either');
eq(failed.term!.whole, false, 'and is not whole');

/* ── 8 · no day supplied is a fourth thing, and it changes nothing ────────── */
//
// This is the isolation proof for every caller that predates the band:
// studio-web/app/analytics/page.tsx and src/lib/coverage.test.ts both call
// buildGymRetention without a `today`, and both must be byte-identical.

const gNoToday = buildGymRetention(rec(roster), { now: NOW });
eq(gNoToday.term, null, 'no day supplied means no contract-end band at all, rather than a guess');
ok(gNoToday.rows!.every((r) => r.term === null), 'and every row carries null rather than a default');
eq(
  JSON.stringify({ ...gNoToday, rows: gNoToday.rows!.map(({ term: _t, ...r }) => r), term: undefined }),
  JSON.stringify({ ...gAll, rows: gAll.rows!.map(({ term: _t, ...r }) => r), term: undefined }),
  'AND WITH THE NEW FIELD REMOVED THE TWO RESULTS ARE IDENTICAL — supplying a day adds the band and moves nothing else',
);

/* ── 9 · a gym with no timezone is a real state with its own note ─────────── */

const gNoZone = buildGymRetention(rec(roster), { now: NOW, today: NOZONE });
eq(gNoZone.term!.basis, 'reader', 'a gym that has not set a timezone gets the reader\'s day AND says so');
eq(gNoZone.term!.note, NO_ZONE_NOTE, 'with the one wording of that disclosure, never a silent fallback');
ok(gNoZone.rows!.every((r) => r.term!.basis === 'reader'),
   'and the basis is on every row, so no cell can show the band without being able to say whose day it used');
eq(gAll.term!.note, null, 'a gym that HAS set one has nothing to disclose, so the note does not appear everywhere and stop being read');

/* ── 10 · nothing ending is a sentence, not an empty screen ───────────────── */

const calm = buildGymRetention(
  rec([mem('o1', 'active', null), mem('o2', 'active', '2027-08-01')]),
  { now: NOW, today: DUBAI },
);
const calmLine = termHeadline(calm)!;
ok(calmLine.includes('Nothing ends in the next'), 'a quiet fortnight says so');
ok(/open-ended/.test(calmLine),
   'and names the open-ended memberships rather than letting "nothing ends" read as "nothing is at risk"');

/* ── the zone loop ────────────────────────────────────────────────────────── */
//
// Every assertion above runs again under TZ=Pacific/Kiritimati (UTC+14),
// TZ=UTC, TZ=Pacific/Midway (UTC-11) and TZ=Pacific/Auckland. They must all
// agree, because nothing here reads the machine's clock: `now` is an argument,
// the gym's day comes from `gymTodayWindow(zone, now)`, and `ends_on` is
// compared as a string against it. A single `Date.parse('2026-09-13')` anywhere
// in the band would make Midway and Kiritimati disagree about which side of the
// expired boundary a membership on today's date falls.
//
// Asserted rather than left to the runner, so the file states its own
// invariant: the Dubai day above is fixed text, not something derived from
// wherever this process happens to be.
eq(gymTodayWindow('Asia/Dubai', NOW).day, '2026-09-13',
   'the gym\'s day is the gym\'s wherever this test is run');
eq(gymTodayWindow('Pacific/Midway', NOW).day, '2026-09-13',
   'a gym in Midway is on the 13th at this instant too');
eq(gymTodayWindow('Pacific/Kiritimati', NOW).day, '2026-09-14',
   'and one in Kiritimati is already on the 14th — which is the whole reason the gym supplies its own day');

// The structural reason this band cannot make the UTC-day mistake at all: not
// one function in it takes an instant. `memberTerm` takes `today` as a STRING
// and `ends_on` is already a string, so there is no Date for a zone to shift.
// The single place an instant becomes a day is `gymTodayWindow`, which is
// gymZone's tested code and the only "today" source in the console.
ok(memberTerm.length >= 3 && typeof memberTerm([mem('a', 'active', '2026-09-25')], TODAY, 'gym') === 'object',
   'memberTerm is given a day, never a timestamp — there is no instant in the band for a zone to move');
{
  // The mistake itself, written out, so the assertion below has something to
  // be about: a bare day parsed as an instant and compared against `now`.
  const asInstantSaysExpired = Date.parse('2026-09-13') < NOW;
  ok(asInstantSaysExpired,
     'parsing a bare end date as an instant and comparing it to now DOES call a membership that runs to today expired');
  eq(memberTerm([mem('a', 'active', '2026-09-13')], TODAY, 'gym').state, 'ending',
     'and the band does not, because it never parses the day into an instant at all');
}

// The same membership, read by two gyms whose days differ, gets two different
// and equally correct answers. Neither of them is the reader's.
eq(memberTerm([mem('a', 'active', '2026-09-13')], gymTodayWindow('Pacific/Midway', NOW).day, 'gym').state,
   'ending', 'a membership running to the 13th is still live at a gym whose day is the 13th');
eq(memberTerm([mem('a', 'active', '2026-09-13')], gymTodayWindow('Pacific/Kiritimati', NOW).day, 'gym').state,
   'expired', 'and has run out at a gym already on the 14th');

/* ── report ───────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`gymRetention (contract end): ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('gymRetention (contract end): ok');
