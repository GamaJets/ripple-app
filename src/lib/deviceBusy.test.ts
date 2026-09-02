// Blocking time from the phone's own diary. Compile with tsc, run with node.
//
// Four failures are worth the file.
//
// THE FIRST is privacy, and it is the one that cannot be fixed afterwards. A
// coach's calendar holds their therapy appointment and other people's names,
// and this app takes a start and an end from it and nothing else. That is
// asserted on the SHAPE of what comes back — two keys, both numbers — rather
// than on a promise in a comment, so a third field cannot be added by accident
// or arrive through a spread.
//
// THE SECOND is timezones. Every period here is minutes from LOCAL midnight,
// and a day is 23 or 25 hours twice a year. `npm run test:zones` runs this
// under six zones, Kiritimati (UTC+14) and Midway (UTC-11) among them, so
// every instant below is built from local parts and never from a UTC literal:
// a test written in epoch milliseconds would assert the runner's offset.
//
// THE THIRD is the empty list. "Nothing found" and "we were not allowed to
// look" are the same empty array and they are opposite sentences, and the one
// that must never be said is "you are free all fortnight" to a coach the
// operating system refused us. `busyView` keeps them apart.
//
// THE FOURTH is the partial success blockRange.ts already holds the line on. A
// coach may pick two periods on one Tuesday; the fold below must never let one
// that saved and one that did not add up to a blocked day.
import {
  toBusySpan, busyWindow, busyCandidates, candidateMinutes, candidateTimeLabel,
  foldByDay, busyView, busyBlockLabel, BUSY_NOTES, BUSY_PRIVACY_NOTE, MAX_BUSY_DAYS,
  type BusySpan,
} from './deviceBusy';
import { summariseBlocks, blockSummaryLine, type BlockResult } from './blockRange';
import { setAppLocale } from './locale';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// Stated for the same reason blockRange.test.ts states it: `candidateTimeLabel`
// goes through fmtClock, which asks the reader's locale, and a test that reads
// whatever the runner is set to is a test of the machine.
setAppLocale('en-GB');

const pad = (n: number) => String(n).padStart(2, '0');
/** A local instant, in epoch ms. Built from local parts on purpose. */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();
const span = (a: number, b: number): BusySpan => ({ startMs: a, endMs: b });

/* ── 1. what is read off a calendar entry, and what is not ───────────────── */

// The shape a calendar hands back, with every field this app must never touch
// on it. If any of them ever appears in the result, the assertion below fails.
const privateEntry = {
  id: 'evt-1',
  title: 'Oncology — Dr Whitfield',
  notes: 'bring the referral letter',
  location: '14 Harley Street',
  organizer: 'reception@clinic.example',
  attendees: [{ name: 'Dr Whitfield', email: 'w@clinic.example' }],
  calendarId: 'cal-personal',
  url: 'https://clinic.example/appointments/8814',
  availability: 'busy',
  allDay: false,
  startDate: new Date(at(2026, 9, 8, 14, 0)),
  endDate: new Date(at(2026, 9, 8, 15, 30)),
};

const read = toBusySpan(privateEntry);
ok(read != null, 'a normal entry is read at all');
same(Object.keys(read ?? {}).sort(), ['endMs', 'startMs'],
  'a busy span has exactly two keys, and neither of them is a title, a note, a location or a person');
ok(typeof read?.startMs === 'number' && typeof read?.endMs === 'number',
  'and both of them are numbers, so nothing textual survived the read');
eq(read?.startMs, at(2026, 9, 8, 14, 0), 'the start is the entry start');
eq(read?.endMs, at(2026, 9, 8, 15, 30), 'the end is the entry end');
eq(JSON.stringify(read).includes('Whitfield'), false,
  'nothing serialisable off the entry carries a person through');
eq(JSON.stringify(read).includes('Harley'), false, 'nor a place');

// The three shapes a calendar can put a date in.
eq(toBusySpan({ startDate: '2026-09-08T14:00:00.000Z', endDate: '2026-09-08T15:00:00.000Z' })?.startMs,
  Date.parse('2026-09-08T14:00:00.000Z'), 'an ISO string with an offset is an instant and keeps it');
eq(toBusySpan({ startDate: at(2026, 9, 8, 9, 0), endDate: at(2026, 9, 8, 10, 0) })?.startMs,
  at(2026, 9, 8, 9, 0), 'epoch milliseconds are taken as they are');
// The bare date is the trap src/lib/localDate.ts exists for: `Date.parse` puts
// it at UTC midnight, which is the afternoon before in Kiritimati.
eq(toBusySpan({ startDate: '2026-09-08', endDate: '2026-09-09' })?.startMs, at(2026, 9, 8),
  'a bare date is local midnight, not UTC midnight');

eq(toBusySpan(null), null, 'nothing is not an entry');
eq(toBusySpan({ title: 'Dentist' }), null, 'an entry with no times is dropped rather than guessed at');
eq(toBusySpan({ startDate: 'not a date', endDate: 'nor this' }), null, 'unreadable times are dropped');
eq(toBusySpan({ startDate: new Date(at(2026, 9, 8, 10)), endDate: new Date(at(2026, 9, 8, 10)) }), null,
  'a zero-length entry is not a period anybody is busy for');
eq(toBusySpan({ startDate: new Date(at(2026, 9, 8, 11)), endDate: new Date(at(2026, 9, 8, 10)) }), null,
  'an entry that ends before it starts is dropped, not reversed');
// A getter that throws is what a native shared object does after the event has
// been deleted underneath us. It must not take the sheet down.
eq(toBusySpan({ get startDate(): unknown { throw new Error('gone'); } }), null,
  'an entry whose properties throw is dropped');

/* ── 2. the window ───────────────────────────────────────────────────────── */

const w = busyWindow('2026-09-08', 3);
eq(w?.fromMs, at(2026, 9, 8), 'the window opens at local midnight on the first day');
eq(w?.toMs, at(2026, 9, 11), 'and closes at local midnight three days later');
eq(busyWindow('2026-09-08', 0), null, 'a window of no days is refused');
eq(busyWindow('2026-09-08', MAX_BUSY_DAYS + 1), null, 'and one past the guard is refused rather than clamped');
eq(busyWindow('not a day', 3), null, 'an unreadable first day is refused');

/* ── 3. entries become periods a coach can pick ──────────────────────────── */

const oneAppointment = busyCandidates([span(at(2026, 9, 8, 14, 0), at(2026, 9, 8, 15, 30))], '2026-09-08', 7);
eq(oneAppointment.length, 1, 'one appointment is one period');
eq(oneAppointment[0].day, '2026-09-08', 'on the day it falls on');
eq(oneAppointment[0].startMin, 14 * 60, 'starting at two in the afternoon');
eq(oneAppointment[0].endMin, 15 * 60 + 30, 'and ending at half past three');
eq(oneAppointment[0].allDay, false, 'and it is not an all-day entry');
eq(oneAppointment[0].entries, 1, 'built from one entry');
eq(candidateMinutes(oneAppointment[0]), 90, 'ninety minutes, which is what block_time is given');

eq(busyCandidates([span(at(2026, 9, 20, 9, 0), at(2026, 9, 20, 10, 0))], '2026-09-08', 7).length, 0,
  'an appointment outside the window is not listed');
eq(busyCandidates([span(at(2026, 9, 1, 9, 0), at(2026, 9, 1, 10, 0))], '2026-09-08', 7).length, 0,
  'nor one before it');

// Overnight. `block_time` blocks inside a day, and a coach reads their week a
// day at a time, so a Friday-evening-to-Monday-morning trip is four rows.
const overnight = busyCandidates([span(at(2026, 9, 11, 18, 0), at(2026, 9, 14, 9, 0))], '2026-09-11', 7);
eq(overnight.length, 4, 'an entry running over three midnights is four periods');
same(overnight.map((c) => c.day), ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'],
  'one for each day it touches');
eq(overnight[0].startMin, 18 * 60, 'the first starts when the entry does');
eq(overnight[0].endMin, 1440, 'and runs to the end of that day');
eq(overnight[0].allDay, false, 'an evening is not an all-day period');
eq(overnight[1].allDay, true, 'the day in the middle is');
eq(overnight[3].startMin, 0, 'the last starts at midnight');
eq(overnight[3].endMin, 9 * 60, 'and ends when the entry does');

// The birthday. It is found, it is listed, it is marked, and the coach decides.
const birthday = busyCandidates([span(at(2026, 9, 9), at(2026, 9, 10))], '2026-09-08', 7);
eq(birthday.length, 1, 'an all-day entry is one period');
eq(birthday[0].allDay, true, 'marked as all day, so a birthday is recognisable as one');
eq(birthday[0].startMin, 0, 'covering the day from midnight');
eq(birthday[0].endMin, 1440, 'to midnight');
eq(candidateTimeLabel(birthday[0]), 'All day', 'and it says so rather than printing two midnights');

// Merging. Overlapping and touching are one stretch; a gap is two absences.
const overlapping = busyCandidates([
  span(at(2026, 9, 8, 9, 0), at(2026, 9, 8, 10, 0)),
  span(at(2026, 9, 8, 9, 30), at(2026, 9, 8, 11, 0)),
], '2026-09-08', 1);
eq(overlapping.length, 1, 'two overlapping entries are one busy stretch');
eq(overlapping[0].startMin, 9 * 60, 'from the earlier start');
eq(overlapping[0].endMin, 11 * 60, 'to the later end');
eq(overlapping[0].entries, 2, 'and it says how many entries went into it');

const touching = busyCandidates([
  span(at(2026, 9, 8, 10, 0), at(2026, 9, 8, 11, 0)),
  span(at(2026, 9, 8, 11, 0), at(2026, 9, 8, 12, 0)),
], '2026-09-08', 1);
eq(touching.length, 1, 'back-to-back entries are one stretch, not two calls the second of which is refused');

const apart = busyCandidates([
  span(at(2026, 9, 8, 9, 0), at(2026, 9, 8, 10, 0)),
  span(at(2026, 9, 8, 18, 0), at(2026, 9, 8, 19, 30)),
], '2026-09-08', 1);
eq(apart.length, 2, 'a morning appointment and an evening one are two absences');
eq(apart[0].endMin, 10 * 60, 'and the working day between them is not swallowed');
eq(apart[1].startMin, 18 * 60, 'the second keeps its own start');
ok(apart[0].key !== apart[1].key, 'every period has its own key');

// Order, so the sheet reads down the week.
const jumbled = busyCandidates([
  span(at(2026, 9, 10, 9, 0), at(2026, 9, 10, 10, 0)),
  span(at(2026, 9, 8, 16, 0), at(2026, 9, 8, 17, 0)),
  span(at(2026, 9, 8, 9, 0), at(2026, 9, 8, 10, 0)),
], '2026-09-08', 7);
same(jumbled.map((c) => `${c.day}@${c.startMin}`),
  ['2026-09-08@540', '2026-09-08@960', '2026-09-10@540'],
  'periods come back in the order a week is read');

// Clock changes. Both of these ranges contain a transition in at least one of
// the zones test:zones runs, and neither zone is named: the assertions are
// about local wall-clock minutes, which is what a coach and `block_time` both
// mean by nine in the morning.
// The window OPENS three days before each of them, so the day-by-day walk
// inside busyCandidates has to cross the transition to reach the appointment.
const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
for (const [y, m, d] of [[2026, 3, 8], [2026, 11, 1], [2026, 4, 5], [2026, 9, 27]] as const) {
  const from = dayOf(at(y, m, d - 3));
  const on = dayOf(at(y, m, d));
  const across = busyCandidates([span(at(y, m, d, 9, 0), at(y, m, d, 10, 0))], from, 7);
  eq(across.length, 1, `one appointment on ${on} stays one`);
  eq(across[0].day, on, 'and lands on the day it is actually on, whichever side of a clock change');
  eq(across[0].startMin, 540, 'nine in the morning is nine in the morning across a clock change');
  eq(across[0].endMin, 600, 'and ten is ten');
  const wholeDay = busyCandidates([span(at(y, m, d), at(y, m, d + 1))], from, 7);
  eq(wholeDay.length, 1, 'a whole day around a clock change is one day');
  eq(wholeDay[0].day, on, 'on the right day');
  eq(wholeDay[0].allDay, true, 'and is still recognised as all day when that day is 23 or 25 hours long');
}

// The window bound, which is where an off-by-one would let one appointment out.
const lastDay = busyCandidates([span(at(2026, 9, 14, 9, 0), at(2026, 9, 14, 10, 0))], '2026-09-08', 7);
eq(lastDay.length, 1, 'the seventh day is inside a seven-day window');
const dayAfter = busyCandidates([span(at(2026, 9, 15, 9, 0), at(2026, 9, 15, 10, 0))], '2026-09-08', 7);
eq(dayAfter.length, 0, 'the eighth is not');

/* ── 4. how a period is written ──────────────────────────────────────────── */

const evening = busyCandidates([span(at(2026, 9, 8, 22, 0), at(2026, 9, 9))], '2026-09-08', 1)[0];
eq(evening.endMin, 1440, 'an entry ending at midnight ends at the end of the day');
ok(candidateTimeLabel(evening).endsWith('midnight'),
  'and is written as midnight, because "00:00" at the end of a range reads backwards');
ok(!candidateTimeLabel(oneAppointment[0]).includes('midnight'),
  'an ordinary afternoon says nothing about midnight');

/* ── 5. two periods on one day, and the sentence that must not be said ───── */

const r = (day: string, outcome: BlockResult['outcome'], withdrawn = 0): BlockResult =>
  ({ day, outcome, withdrawn });

same(foldByDay([r('2026-09-08', 'blocked', 2), r('2026-09-08', 'blocked', 1)]),
  [{ day: '2026-09-08', outcome: 'blocked', withdrawn: 3 }],
  'two periods on a day that both saved are one blocked day, with the slots added up');

same(foldByDay([r('2026-09-08', 'blocked', 2), r('2026-09-08', 'failed')]),
  [{ day: '2026-09-08', outcome: 'failed', withdrawn: 2 }],
  'a day where one period saved and one did not is NOT a blocked day');

same(foldByDay([r('2026-09-08', 'booked'), r('2026-09-08', 'already-blocked')]),
  [{ day: '2026-09-08', outcome: 'booked', withdrawn: 0 }],
  'a booked session outranks a period that was already covered');

same(foldByDay([r('2026-09-08', 'failed'), r('2026-09-08', 'booked')]),
  [{ day: '2026-09-08', outcome: 'failed', withdrawn: 0 }],
  'and a call that did not land outranks everything, because only it means try again');

same(foldByDay([r('2026-09-10', 'blocked', 1), r('2026-09-08', 'blocked', 1)]).map((x) => x.day),
  ['2026-09-10', '2026-09-08'], 'days keep the order they were blocked in');

eq(foldByDay([]).length, 0, 'nothing folds to nothing');

// The whole point of the fold, read as a coach reads it.
const mixedLine = blockSummaryLine(summariseBlocks(foldByDay([
  r('2026-09-08', 'blocked', 1), r('2026-09-08', 'failed'),
  r('2026-09-09', 'blocked', 2),
])));
ok(mixedLine.includes('1 day blocked'),
  'a Tuesday half-saved and a Wednesday saved is ONE blocked day, not two');
ok(mixedLine.includes('still bookable'),
  'and the half-saved Tuesday is named as still bookable');

const summary = summariseBlocks(foldByDay([r('2026-09-08', 'blocked', 1), r('2026-09-08', 'failed')]));
same(summary.failed, ['2026-09-08'], 'the half-saved day is the one named for the coach to go back to');
eq(summary.needsAttention, true, 'a day with an unsaved period always needs the coach');
eq(summary.blocked, 0, 'and is never counted among the blocked days');

/* ── 6. refused is not empty ─────────────────────────────────────────────── */

const view = (a: Partial<Parameters<typeof busyView>[0]>) =>
  busyView({ supported: true, asked: true, status: 'ready', permission: 'granted', count: 0, ...a });

eq(view({ supported: false, asked: false, permission: 'unknown' }), 'unavailable',
  'a binary without the native half says so before anything else');
eq(view({ supported: false, asked: false, status: 'error', permission: 'denied' }), 'unavailable',
  'and says it even when something else also went wrong');
eq(view({ permission: 'unavailable' }), 'unavailable',
  'and the read agreeing is enough on its own');
// The promise about what is read has to be legible BEFORE the operating
// system's prompt, which means before anything is read.
eq(view({ asked: false, permission: 'unknown' }), 'ask',
  'nothing is read until the coach asks for it');
eq(view({ asked: false, status: 'loading' }), 'ask',
  'and no read is in flight before they do');
eq(view({ status: 'loading', permission: 'unknown' }), 'loading',
  'nothing is known while the read is in flight');
eq(view({ permission: 'denied' }), 'denied',
  'a refusal is its own state and never "your diary is empty"');
eq(view({ status: 'error', permission: 'denied' }), 'denied',
  'a refusal outranks an error, because it is the thing the coach can act on');
eq(view({ status: 'error' }), 'failed',
  'a read that did not happen is not an empty diary either');
eq(view({}), 'empty',
  'granted and nothing found is the only state that may say nothing was found');
eq(view({ count: 3 }), 'list',
  'and periods found are shown');
eq(view({ status: 'partial', count: 3 }), 'list',
  'a partial read still lists real periods, which are still blockable');

// The words themselves. An empty list under a refusal must never read as "you
// are free": the note is checked for the sentence that says so.
ok(BUSY_NOTES.denied.includes('not a statement that you are free'),
  'the refusal note says outright that it is not a claim about the coach being free');
ok(BUSY_NOTES.failed.includes('not a statement'),
  'and so does the one for a read that failed');
ok(BUSY_NOTES.ask.includes('Nothing has been read yet'),
  'and the state before anybody is asked says outright that nothing has been read');
for (const [state, note] of Object.entries(BUSY_NOTES)) {
  ok(note.trim().length > 20, `the ${state} note is a sentence somebody wrote`);
}
for (const word of ['title', 'notes', 'location', 'never why']) {
  ok(BUSY_PRIVACY_NOTE.includes(word),
    `the promise shown before the permission prompt names ${word}`);
}
ok(BUSY_PRIVACY_NOTE.includes('written back'),
  'and says nothing is ever written back to the coach calendar');

/* ── 7. the button, which never blocks anything unchosen ─────────────────── */

eq(busyBlockLabel(0), null, 'nothing picked disables the button rather than blocking everything found');
eq(busyBlockLabel(-1), null, 'and so does nonsense');
eq(busyBlockLabel(1), 'Block This Period', 'one picked says what it will do');
eq(busyBlockLabel(4), 'Block 4 Periods', 'and four say how many');

if (errors.length) {
  console.error(`deviceBusy: ${errors.length} failed`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('deviceBusy: all assertions passed');
