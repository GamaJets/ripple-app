// What a coach is told about a client's logged training.
// Compile with tsc, run with node.
//
// Four things are defended here, and each of them is a sentence or a figure
// that would look completely ordinary on the screen while being false about
// somebody else's month:
//
// 1. A bodyweight session has NO volume, not a volume of zero. Chin-ups,
//    press-ups and planks carry reps and no load, and `Σ reps × 0` is a
//    perfectly well-formed 0 that reads as an hour of nothing.
//
// 2. A read that failed produces no count, and a read that came back at the row
//    cap produces no total. `capped()` hands back a prefix of an unknown set,
//    so "12 sessions" over a truncated read is a wrong number stated with total
//    confidence — strictly worse than a dash. The newest session's DATE is the
//    one thing truncation cannot take away (the read is ordered newest first)
//    and is deliberately still stated.
//
// 3. "You logged this" is only ever said about the coach reading the screen. A
//    session logged by a previous coach, or read while the viewer's auth
//    session is still restoring, is a coach — not this one.
//
// 4. No sentence anywhere says the client has logged nothing unless the read
//    actually came back empty.
//
// Nothing here asserts a formatted date string against a literal: `npm test`
// runs the whole suite three times under three timezones (`test:zones`), and a
// local day is a different day in Auckland than it is in Los Angeles. Where a
// day matters, the expectation is computed with the same helper the code uses,
// so the two move together or the test fails.
import {
  sessionsOf, trainingDaysOf, attributionOf, attributionLabel, trainingBoard, trainingLine,
  unitFor, type LoggedSession,
} from './clientTraining';
import { dayKeyOf } from './entryEdit';
import { dayLabel } from './adherence';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const WHO = 'Sam';
const COACH = 'coach-1';
const OTHER = 'coach-2';

const T1 = '2026-08-28T17:30:00.000Z';
const T2 = '2026-08-30T09:00:00.000Z';
const T3 = '2026-08-31T18:15:00.000Z';

const e = (over: Partial<WorkoutEntry> & { t: string; exercise: string }): WorkoutEntry => ({ ...over });

/* ── grouping ─────────────────────────────────────────────────────────────── */

const oneSession = sessionsOf([
  e({ t: T1, exercise: 'Back Squat', sets: [[5, 100], [5, 100], [5, 100]] }),
  e({ t: T1, exercise: 'Bench Press', sets: [[8, 60], [8, 60]] }),
]);
eq(oneSession.length, 1, 'exercises sharing a performed_at are one session, not two');
eq(oneSession[0].exercises, 2, 'and the session knows how many exercises are in it');
eq(oneSession[0].sets, 5, 'sets are counted across every exercise in the session');
eq(oneSession[0].volumeKg, 3 * 5 * 100 + 2 * 8 * 60, 'volume is Σ reps × load over the whole session');

const repeated = sessionsOf([
  e({ t: T1, exercise: 'Back Squat', sets: [[5, 100]] }),
  e({ t: T1, exercise: 'Back Squat', sets: [[5, 90]] }),
]);
eq(repeated[0].exercises, 1,
  'one movement done twice in a session is one exercise, not two — the count is of movements');
eq(repeated[0].sets, 2, 'while both of its sets still count');

const ordered = sessionsOf([
  e({ t: T1, exercise: 'a' }), e({ t: T3, exercise: 'c' }), e({ t: T2, exercise: 'b' }),
]);
eq(ordered.map((x) => x.at).join(','), [T3, T2, T1].join(','),
  'sessions come back newest first whatever order the rows arrived in — the screen must not '
  + 'depend on an ORDER BY in a file it does not own');

/* ── nothing is invented out of a blank row ───────────────────────────────── */

const blanks = sessionsOf([e({ t: T1, exercise: 'Deadlift', sets: [[0, 100], [5, 120]] })]);
eq(blanks[0].sets, 1, 'a row with no reps is not a set of zero reps and is not counted as one');
eq(blanks[0].volumeKg, 5 * 120, 'and it contributes nothing to the volume');

const noDate = sessionsOf([e({ t: 'not-a-date', exercise: 'Plank' })]);
eq(noDate[0].day, null,
  'a timestamp that cannot be read gets no day — filing it under today would invent a training '
  + 'day out of a parsing failure');

eq(sessionsOf([{ t: '', exercise: 'x' } as WorkoutEntry]).length, 0,
  'an entry with no timestamp has no session to belong to and is dropped rather than bucketed under ""');

/* ── 1. a bodyweight session has no tonnage, not a tonnage of zero ────────── */

const bodyweight = sessionsOf([
  e({ t: T1, exercise: 'Pull-up', sets: [[8, 0], [8, 0], [6, 0]] }),
  e({ t: T1, exercise: 'Press-up', sets: [[20, 0]] }),
]);
eq(bodyweight[0].volumeKg, null,
  'a session with no external load has NO volume — a 0 here reads as an hour of nothing');
eq(bodyweight[0].sets, 4, 'though every one of its sets is real and counted');
eq(bodyweight[0].bodyweightSets, 4,
  'and the screen is told how many carried no load, so a small tonnage cannot imply an easy hour');

const mixed = sessionsOf([
  e({ t: T1, exercise: 'Squat', sets: [[5, 100]] }),
  e({ t: T1, exercise: 'Pull-up', sets: [[8, 0]] }),
]);
eq(mixed[0].volumeKg, 500, 'a mixed session totals the loaded sets');
eq(mixed[0].bodyweightSets, 1, 'and says how much of it the total does not cover');

/* ── energy and length are absent, never zero ─────────────────────────────── */

eq(sessionsOf([e({ t: T1, exercise: 'Squat', sets: [[5, 100]] })])[0].kcal, null,
  'a strength session records reps and weight, not energy — an absent burn is a dash, not a 0');
eq(sessionsOf([
  e({ t: T1, exercise: 'Row', kcal: 120 }), e({ t: T1, exercise: 'Bike', kcal: 80 }),
])[0].kcal, 200, 'where entries do carry a figure they are summed');

eq(sessionsOf([e({ t: T1, exercise: 'Squat', sessionMins: 0 })])[0].mins, null,
  'zero minutes is an unfinished form, not a session that lasted no time');
const disagree = sessionsOf([
  e({ t: T1, exercise: 'a', sessionMins: 60 }), e({ t: T1, exercise: 'b', sessionMins: 45 }),
]);
eq(disagree[0].mins, 60, 'a session length is session-scoped, so the first real figure speaks for it');
eq(disagree[0].minsDisagree, true,
  'and rows that disagree are reported rather than averaged into a number nobody wrote');

/* ── 3. attribution names the coach in the room, never a guess ────────────── */

const byClient = sessionsOf([e({ t: T1, exercise: 'Squat' })])[0];
const byMe = sessionsOf([e({ t: T1, exercise: 'Squat', loggedBy: COACH })])[0];
const byThem = sessionsOf([e({ t: T1, exercise: 'Squat', loggedBy: OTHER })])[0];
const byBoth = sessionsOf([
  e({ t: T1, exercise: 'Squat', loggedBy: COACH }), e({ t: T1, exercise: 'Plank' }),
])[0];

eq(attributionOf(byClient, COACH), 'client', 'no logged_by is the client doing it themselves');
eq(attributionOf(byMe, COACH), 'you', 'the coach reading the screen is told they logged it');
eq(attributionOf(byThem, COACH), 'coach',
  'a session another coach logged is never attributed to the coach reading it');
eq(attributionOf(byMe, null), 'coach',
  'and neither is one read while the viewer\'s own id is still unknown — "you logged this" is a '
  + 'claim about who stood in the room');
eq(attributionOf(byBoth, COACH), 'mixed',
  'a session part-logged by each is neither, and says so');
ok(attributionLabel('client', WHO).includes(WHO),
  'the client-logged label names the client');
ok(!attributionLabel('coach', WHO).toLowerCase().includes('you'),
  'and the other-coach label does not say "you"');

/* ── the day, and the double tap that made it necessary ──────────────────── */

// The shape found in the live database: one squat workout written as four rows
// a second apart, same movement, same sets. Counted by timestamp it is four
// sessions; counted by day it is the one workout it actually was.
const doubleTapped = sessionsOf([
  e({ t: '2026-08-30T01:34:16.643Z', exercise: 'Squat', sets: [[3, 11.5], [15, 11.5]] }),
  e({ t: '2026-08-30T01:34:17.677Z', exercise: 'Squat', sets: [[3, 11.5], [15, 11.5]] }),
  e({ t: '2026-08-30T01:34:18.110Z', exercise: 'Squat', sets: [[3, 11.5], [15, 11.5]] }),
  e({ t: '2026-08-30T01:34:18.427Z', exercise: 'Squat', sets: [[3, 11.5], [15, 11.5]] }),
]);
eq(doubleTapped.length, 4, 'four instants are four logging events — the record says so and this does not hide it');
const tappedDays = trainingDaysOf(doubleTapped);
eq(tappedDays.days.length, 1,
  'but they are ONE training day, which is the unit a coach means when they ask what somebody '
  + 'did — a double tap must not read as four workouts');
eq(tappedDays.days[0].sessions.length, 4, 'with every logging event still on it, nothing thrown away');
eq(tappedDays.days[0].exercises, 1, 'and one movement, not four');

const undatedDay = trainingDaysOf(sessionsOf([e({ t: 'not-a-date', exercise: 'Plank', sets: [[1, 0]] })]));
eq(undatedDay.days.length, 0, 'a session with no readable date belongs to no day');
eq(undatedDay.undated.length, 1,
  'and is kept apart rather than dropped or filed under today — the sets in it are real');

const twoDays = trainingDaysOf(sessionsOf([
  e({ t: T1, exercise: 'a', sets: [[5, 100]] }),
  e({ t: T3, exercise: 'b', sets: [[5, 50]] }),
]));
eq(twoDays.days.map((d) => d.day).join(','), [dayKeyOf(T3), dayKeyOf(T1)].join(','),
  'days come back newest first');

/* ── 2. no total the read cannot support ──────────────────────────────────── */

const three: LoggedSession[] = sessionsOf([
  e({ t: T3, exercise: 'Squat', sets: [[5, 100]] }),
  e({ t: T2, exercise: 'Bench', sets: [[5, 60]] }),
  e({ t: T1, exercise: 'Pull-up', sets: [[8, 0]] }),
]);

const whole = trainingBoard(three, 'ready');
eq(whole.state, 'some', 'three sessions is some');
eq(whole.dayCount, 3, 'a whole read may be counted, in days');
eq(whole.entryCount, 3, 'and its logging events counted too, for the days that hold more than one');
eq(whole.sets, 3, 'and its sets totalled');
eq(whole.volumeKg, 500 + 300, 'and its volume, over the sessions that carried a load');

const tapped = trainingBoard(doubleTapped, 'ready');
eq(tapped.dayCount, 1, 'the headline figure a coach reads is days, which a double tap cannot inflate');
eq(tapped.entryCount, 4,
  'while the logging events are still counted, so the screen can explain a day that looks like four workouts');

const part = trainingBoard(three, 'partial');
eq(part.state, 'some', 'a truncated read still has real days in it and they are still listed');
eq(part.days.length, 3, 'every day that arrived is shown');
eq(part.dayCount, null, 'but it may not be counted — a prefix of an unknown set is not a total');
eq(part.entryCount, null, 'nor its logging events');
eq(part.sets, null, 'nor its sets');
eq(part.volumeKg, null, 'nor its volume');
eq(part.newestDay, dayKeyOf(T3),
  'the newest day survives truncation — the read is ordered newest first — so its date stands');

const broken = trainingBoard(null, 'error');
eq(broken.state, 'unreadable', 'a failed read is unreadable, never empty');
eq(broken.dayCount, null, 'and produces no count');
eq(trainingBoard([], 'error').state, 'unreadable',
  'an empty array under error is still unreadable — the status wins, so a caller that forgets to '
  + 'pass null cannot turn a refusal into "they have never trained"');
eq(trainingBoard([], 'loading').state, 'unreadable',
  'and a read still in flight has produced no rows, which is not an empty history either');

const empty = trainingBoard([], 'ready');
eq(empty.state, 'none', 'a read that landed with no rows is genuinely none');
eq(empty.dayCount, 0, 'and zero is the honest count for it');
eq(empty.volumeKg, null,
  'while its volume is still a dash: nobody lifted nothing, there is simply nothing to total');

const noLoad = trainingBoard(bodyweight, 'ready');
eq(noLoad.volumeKg, null,
  'a whole read of bodyweight sessions totals to no volume rather than to zero');
eq(noLoad.days[0].volumeKg, null, 'and so does the day that holds them');
eq(noLoad.days[0].bodyweightSets, 4, 'which says instead how many sets carried no load');

const undatedOnly = trainingBoard(sessionsOf([e({ t: 'nope', exercise: 'x', sets: [[5, 20]] })]), 'ready');
eq(undatedOnly.state, 'some', 'a session with an unreadable date is still training that happened');
eq(undatedOnly.dayCount, 0, 'it lands on no day');
eq(undatedOnly.undated.length, 1, 'and is listed apart');
eq(undatedOnly.sets, 1, 'while its sets still count towards the totals — they were really performed');

/* ── 4. the line the coach reads before opening the screen ────────────────── */

eq(trainingLine('loading', trainingBoard(null, 'loading'), WHO),
  'Reading the sessions they have logged…',
  'a read in flight reads as in flight');
ok(/could not be read/.test(trainingLine('error', broken, WHO))
   && /not the same as/.test(trainingLine('error', broken, WHO)),
  'a failed read says so, and says what it is not');
ok(!/Nothing logged yet/.test(trainingLine('error', broken, WHO)),
  'and never reaches for the empty-state sentence — a failed read stating "nothing logged yet" is '
  + 'the one sentence this file exists to prevent. (It may still say what it is NOT: "not the same '
  + 'as having logged none" is a denial, and denying the claim is the opposite of making it.)');
ok(/Nothing logged yet/.test(trainingLine('ready', empty, WHO))
   && /came back empty/.test(trainingLine('ready', empty, WHO)),
  'an empty read that actually landed may say so, and says why it is entitled to');
ok(/^3 days logged\./.test(trainingLine('ready', whole, WHO)),
  'a whole read is counted in days');
ok(/^1 day logged\./.test(trainingLine('ready', tapped, WHO)),
  'and the double-tapped workout is one day, not four sessions — this is the line the coach reads '
  + 'before deciding whether to open anything');
ok(trainingLine('ready', whole, WHO).includes(dayLabel(dayKeyOf(T3)!)),
  'and dated with the newest day');
ok(/row limit/.test(trainingLine('partial', part, WHO)) && !/\b3 day/.test(trainingLine('partial', part, WHO)),
  'a truncated read is hedged and never counted flat');
ok(trainingLine('partial', part, WHO).includes(dayLabel(dayKeyOf(T3)!)),
  'while still dating the newest day, which truncation cannot remove');
eq(trainingLine('ready', undatedOnly, WHO), '0 days logged.',
  'a client whose only session carries an unreadable date has no dated day to name — a bare count '
  + 'and no invented date, rather than a day this build made up');

/* ── whose pounds ─────────────────────────────────────────────────────────── */

const agreed = unitFor('kg', 'kg', 'ready', WHO);
eq(agreed.unit, 'kg', 'where the record names the client\'s unit, it wins');
eq(agreed.source, 'client', 'and the screen knows whose unit it is printing');
eq(agreed.note, null, 'with nothing to disambiguate when the two agree');

const differ = unitFor('lb', 'kg', 'ready', WHO);
eq(differ.unit, 'lb',
  'the client\'s unit wins even against the coach\'s — this screen is a transcript of what the '
  + 'client\'s own phone showed them, and a coach quoting 100 at somebody reading 220 looks like a '
  + 'coach who does not know what their client did');
ok(differ.note != null && differ.note.includes('lb') && differ.note.includes('kg'),
  'and both units are named, so neither figure is ever unlabelled');

const unchosen = unitFor(null, 'lb', 'ready', WHO);
eq(unchosen.unit, 'lb', 'a NULL column is not kilograms — it is "never chosen", so the coach\'s own stands in');
eq(unchosen.source, 'you', 'and the screen says the unit is the coach\'s rather than the client\'s');
ok(unchosen.note != null && /has not set a unit/.test(unchosen.note),
  'with the reason, because their phone may still be showing them the other one');
eq(unitFor('stones', 'kg', 'ready', WHO).source, 'you',
  'a value the app does not recognise is treated as unset rather than printed as a unit');

const unread = unitFor(null, 'kg', 'error', WHO);
eq(unread.source, 'you', 'a failed read is not a client who chose kilograms');
ok(unread.note != null && /could not be read/.test(unread.note),
  'and says so — the note is about the read, not about their preference');
ok((unitFor(null, 'kg', 'loading', WHO).note ?? '').includes('Reading'),
  'a read still in flight says it is still asking rather than implying it has been told');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'CLIENT TRAINING FAILURES:\n' + errors.join('\n') : 'ALL CLIENT TRAINING TESTS PASSED');
if (errors.length) process.exit(1);
