// A member asking their coach for a weekly slot. Compile with tsc, run with node.
//
// The screen this backs could see `useRecurringSeries().create` and could not
// use it: `create_session_series` refuses anybody who is not the client's coach
// with 42501, and it writes eight weeks of real sessions into a diary the
// moment it succeeds. So the member's half of the feature is a REQUEST, and
// what is asserted here is the two things a request of this shape can get
// wrong — a note the database will refuse after somebody has sent it, and a
// first date on the wrong day.
import {
  STANDING_ASK_RULE, NO_COACH_FOR_STANDING, standingAskNote, firstStandingDay, standingAskBlocker,
} from './standingAsk';
import { REQUEST_NOTE_MAX } from './sessionRequests';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the promise made before the tap ───────────────────────────────────── */

ok(/not booked|Nothing is booked/i.test(STANDING_ASK_RULE),
  'the member is told this books nothing before they ask');
ok(/only your coach/i.test(STANDING_ASK_RULE),
  'and that the weekly part is their coach’s to agree');
ok(NO_COACH_FOR_STANDING.length > 0 && !/—/.test(NO_COACH_FOR_STANDING),
  'the no-coach sentence stands on its own with no hole in it');

/* ── the note that travels with the request ────────────────────────────── */

const note = standingAskNote('Tuesday', '7:00 am');
ok(note.includes('Tuesday') && note.includes('7:00 am'), 'the note names the day and the hour asked for');
ok(note.length <= REQUEST_NOTE_MAX, 'and fits the column part 740 puts a CHECK on');

// `fmtClock` answers '—' for an hour it cannot write, and an em dash as the
// subject of a sentence reads as the app having broken — scripts/check-prose.mjs.
ok(!/at\s*—/.test(standingAskNote('Tuesday', '—')), 'an unwritable hour never becomes a dash where the time goes');
ok(!standingAskNote('', '7:00 am').includes('every  at'), 'and an unwritable day never leaves a gap');
ok(standingAskNote('', '').length > 0, 'there is always a question for the coach to read');

// A weekday written in full is several times longer in some languages than in
// English, and the long form is DROPPED rather than cut off mid-question.
const long = standingAskNote('x'.repeat(500), '7:00 am');
ok(long.length <= REQUEST_NOTE_MAX, 'a note that would overrun the column is replaced, not truncated');
ok(/every week/.test(long), 'and what replaces it still asks for a weekly slot');
ok(!long.endsWith('…'), 'a coach is never handed half a question');

/* ── the first date the slot would fall on ─────────────────────────────── */

// 2026-09-13 is a Sunday.
eq(firstStandingDay('2026-09-13', 0, false), '2026-09-13', 'today counts when the hour is still ahead');
eq(firstStandingDay('2026-09-13', 0, true), '2026-09-20', 'and is a week later once that hour has gone');
eq(firstStandingDay('2026-09-13', 2, false), '2026-09-15', 'the next Tuesday is two days off a Sunday');
eq(firstStandingDay('2026-09-13', 6, false), '2026-09-19', 'and the next Saturday six');
// Across a month, and across a year.
eq(firstStandingDay('2026-09-29', 4, false), '2026-10-01', 'the next weekday may be in the next month');
eq(firstStandingDay('2026-12-29', 5, false), '2027-01-01', 'and in the next year');
// 29 February 2028 is a real Tuesday, and a leap year is where day arithmetic
// done by adding seven days of milliseconds to a Date goes wrong.
eq(firstStandingDay('2028-02-28', 2, false), '2028-02-29', 'a leap year counts its extra day');
eq(firstStandingDay('2028-02-29', 2, true), '2028-03-07', 'and the week after the 29th is in March');

eq(firstStandingDay('not a day', 2, false), null, 'a day that will not read produces no date');
eq(firstStandingDay('2026-02-31', 2, false), null, 'nor does one that does not exist');
eq(firstStandingDay('2026-09-13', 7, false), null, 'nor a weekday that is not one of the seven');
eq(firstStandingDay('2026-09-13', -1, false), null, 'in either direction');
eq(firstStandingDay('2026-09-13', 1.5, false), null, 'and half a weekday is not one');

/* ── the one thing the request rail cannot see for itself ──────────────── */

const mine = [{ dow: 2, hour: 7, minute: 0, active: true }, { dow: 4, hour: 18, minute: 30, active: false }];
ok(standingAskBlocker(mine, { dow: 2, hour: 7, minute: 0 }, true) != null,
  'asking for a slot they already have is refused before the coach is troubled');
eq(standingAskBlocker(mine, { dow: 2, hour: 7, minute: 30 }, true), null, 'a different half-hour is a different slot');
eq(standingAskBlocker(mine, { dow: 3, hour: 7, minute: 0 }, true), null, 'and a different day is a different slot');
eq(standingAskBlocker(mine, { dow: 4, hour: 18, minute: 30 }, true), null,
  'an arrangement that has ENDED is not a reason to refuse asking for it again');
// An empty list from a read that did not finish is not an empty diary — but it
// must not withdraw the only way a member has of reaching their coach either.
eq(standingAskBlocker([], { dow: 2, hour: 7, minute: 0 }, false), null,
  'a read that did not finish claims nothing and blocks nothing');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('standingAsk: ok — the member asks for a weekly slot, and the note says what they are asking for');
