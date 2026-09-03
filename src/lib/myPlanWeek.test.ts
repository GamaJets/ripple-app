// The member's own half of the comparison their coach has been reading.
// Compile with tsc, run with node.
//
// src/lib/planVsActual.ts reconciles the programme against the log and its only
// importer is app/(trainer)/client-training.tsx. app/(client)/week.tsx marks a
// day "Logged" when anything at all was logged on it — so a member can be
// marked Logged on every training day for a month without having touched a
// single prescribed leg movement, and nothing on their side would say so.
import { myPlanWeek, allLoggedNote, MAX_NAMED, CAVEAT } from './myPlanWeek';
import { planVsActual, WINDOW_IS_NOT_A_WEEKDAY, type MovementCheck, type PlanVsActual } from './planVsActual';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const mv = (name: string, coverage: MovementCheck['coverage']): MovementCheck => ({
  name, slug: name.toLowerCase().replace(/ /g, '-'), coverage,
  lastDay: coverage === 'logged' ? '2026-09-01' : null,
  daysLogged: coverage === 'logged' ? 2 : 0,
  plannedTopKg: null, loggedTopKg: null,
});

const pva = (over: Partial<PlanVsActual>): PlanVsActual => ({
  state: 'ready', days: [], movements: [], offPlan: [], fromDay: '2026-08-08', toDay: '2026-09-04', ...over,
});

const note = (r: ReturnType<typeof myPlanWeek>) => r.note;

/* ── the four kinds of nothing ─────────────────────────────────────────── */

{
  const r = myPlanWeek(pva({ state: 'unreadable' }), 28);
  eq(r.kind, 'unreadable', 'a read that did not land is its own answer');
  ok(/not a week with nothing in it/.test(note(r)),
    'and it refuses the reading a silent empty list would produce');
}
{
  const r = myPlanWeek(pva({ state: 'no-programme' }), 28);
  eq(r.kind, 'no-programme', 'no coach programme is a real state, not a failure');
  ok(/this app builds from your goal/.test(note(r)),
    'and the member is told what the plan above them actually is');
}
{
  const r = myPlanWeek(pva({ movements: [] }), 28);
  eq(r.kind, 'empty', 'a programme naming no movements has nothing to compare');
}
{
  // The log came back at the row cap before reaching the start of the window,
  // or the read failed. Both arrive as a list of unknowns, and the sentence has
  // to name the READ — a member who reads an empty comparison as "you did none
  // of it" has been told something false about their own month.
  const r = myPlanWeek(pva({ movements: [mv('Back Squat', 'unknown'), mv('Bench Press', 'unknown')] }), 28);
  eq(r.kind, 'unanswerable', 'a window the read never reached answers for nothing');
  ok(/about the read, not about your week/.test(note(r)), 'and says so in as many words');
  ok(!/have not|missed|skipped/i.test(note(r)), 'and accuses the member of nothing');
}

/* ── the comparison ────────────────────────────────────────────────────── */

{
  const r = myPlanWeek(pva({
    movements: [mv('Back Squat', 'logged'), mv('Bench Press', 'logged'), mv('Romanian Deadlift', 'not-logged')],
  }), 7);
  eq(r.kind, 'ready', 'a whole read compares');
  if (r.kind !== 'ready') { /* narrowed below */ } else {
    eq(r.logged, 2, 'two of three logged');
    eq(r.total, 3, 'out of three');
    ok(/2 of the 3 movements/.test(r.note), 'counted as MOVEMENTS, never as sessions');
    ok(!/%/.test(r.note), 'and never as a percentage — the number nobody reads past');
    eq(r.missing.names.join(), 'Romanian Deadlift', 'the one that has not appeared is named');
    ok(/Not logged in that window: Romanian Deadlift\./.test(r.missingNote ?? ''),
      'so the member can see WHICH, not just how many');
    eq(r.unansweredNote, null, 'and nothing is claimed to be unanswerable when nothing is');
    ok(/last 7 days/.test(r.note), 'the window printed is the window the caller asked for');
  }
}

{
  // 'not-logged' and 'unknown' are two different facts and are never one list.
  // The whole reason planVsActual has a tri-state is that "you have not done
  // this" and "we could not tell" change what the reader does next.
  const r = myPlanWeek(pva({
    movements: [mv('Back Squat', 'logged'), mv('Bench Press', 'not-logged'), mv('Chin-up', 'unknown')],
  }), 28);
  if (r.kind !== 'ready') { errors.push('a mixed read still compares'); } else {
    eq(r.missing.names.join(), 'Bench Press', 'the ones that did not appear are stated');
    eq(r.unanswered.names.join(), 'Chin-up', 'and the ones nobody can answer for are kept apart');
    ok(/cannot be answered for/.test(r.unansweredNote ?? ''), 'with their own sentence');
    ok(!/Chin-up/.test(r.missingNote ?? ''), 'a movement past the row cap is never listed as skipped');
  }
}

{
  const r = myPlanWeek(pva({ movements: [mv('Back Squat', 'logged'), mv('Bench Press', 'logged')] }), 7);
  if (r.kind !== 'ready') { errors.push('an all-logged week compares'); } else {
    eq(r.missingNote, null, 'nothing is listed when nothing is missing');
    eq(allLoggedNote(r, 7), 'Every movement your programme names has been logged in the last 7 days.',
      'and the good state is said out loud rather than left as an absent list');
  }
}
{
  const r = myPlanWeek(pva({ movements: [mv('Back Squat', 'not-logged')] }), 7);
  eq(allLoggedNote(r, 7), null, 'and never said over a movement that has not appeared');
}
{
  const r = myPlanWeek(pva({ movements: [mv('Back Squat', 'unknown'), mv('Bench Press', 'logged')] }), 7);
  eq(allLoggedNote(r, 7), null,
    'nor over a read that could not answer for one — "every movement" is a claim about all of them');
}
eq(allLoggedNote(myPlanWeek(pva({ state: 'unreadable' }), 7), 7), null,
  'and nothing at all is claimed over a read that failed');

/* ── the list is capped, and says so ───────────────────────────────────── */

{
  const many = Array.from({ length: MAX_NAMED + 3 }, (_, i) => mv(`Movement ${i + 1}`, 'not-logged'));
  const r = myPlanWeek(pva({ movements: [mv('Back Squat', 'logged'), ...many] }), 28);
  if (r.kind !== 'ready') { errors.push('a long list still compares'); } else {
    eq(r.missing.names.length, MAX_NAMED, 'the names stop at the cap');
    eq(r.missing.more, 3, 'and the rest are counted rather than dropped');
    ok(/and 3 more\./.test(r.missingNote ?? ''), 'which the sentence says');
  }
}

/* ── off-plan work is information, not a correction ────────────────────── */

{
  const r = myPlanWeek(pva({
    movements: [mv('Barbell Row', 'not-logged')],
    offPlan: ['Chest-Supported Row', 'Leg Press'],
  }), 28);
  if (r.kind !== 'ready') { errors.push('off-plan work still compares'); } else {
    ok(/You also logged 2 movements/.test(r.offPlanNote ?? ''), 'what they did instead is stated');
    ok(/worth telling your coach/.test(r.offPlanNote ?? ''), 'as something to say, not something to answer for');
    ok(!/instead of|should have|failed/i.test(r.offPlanNote ?? ''),
      'a member who swapped a busy rack for a machine has trained');
  }
}
{
  const off = Array.from({ length: MAX_NAMED + 2 }, (_, i) => `Extra ${i + 1}`);
  const r = myPlanWeek(pva({ movements: [mv('Back Squat', 'logged')], offPlan: off }), 28);
  if (r.kind === 'ready') ok(/and 2 more/.test(r.offPlanNote ?? ''), 'and that list is capped too');
}
{
  const r = myPlanWeek(pva({ movements: [mv('Back Squat', 'logged')] }), 28);
  if (r.kind === 'ready') eq(r.offPlanNote, null, 'and nothing is said when there was none');
}

/* ── the disclaimer is the same claim as the coach's ───────────────────── */

{
  const r = myPlanWeek(pva({ movements: [mv('Back Squat', 'logged')] }), 7);
  if (r.kind === 'ready') {
    eq(r.caveat, CAVEAT, 'the caveat is carried, not improvised per screen');
    ok(/never against a named weekday/.test(CAVEAT),
      'and it makes the same refusal WINDOW_IS_NOT_A_WEEKDAY makes');
    ok(/window of days/.test(WINDOW_IS_NOT_A_WEEKDAY), 'which is the claim it is echoing');
    ok(/never says a session was missed/.test(CAVEAT),
      'and adds the half that matters to the member rather than to the coach');
  }
}

/* ── over the real reconciler, not a hand-built shape ──────────────────── */

{
  // The arithmetic must not be duplicated here, so the last case drives
  // `planVsActual` itself: a two-movement day, one of them logged.
  const days = [{
    day: 'Mon', focus: 'Lower',
    exercises: [
      { key: 'a', name: 'Back Squat', group: 'Legs', sets: 3, reps: '8' },
      { key: 'b', name: 'Romanian Deadlift', group: 'Legs', sets: 3, reps: '10' },
    ],
  }] as unknown as Parameters<typeof planVsActual>[0]['days'];
  const log: WorkoutEntry[] = [
    { t: new Date(2026, 8, 1, 18, 0, 0).toISOString(), exercise: 'Back Squat', sets: [[8, 60]] },
    { t: new Date(2026, 8, 2, 18, 0, 0).toISOString(), exercise: 'Leg Press', sets: [[10, 120]] },
  ];
  const out = planVsActual({
    days, programStatus: 'ready', log, logStatus: 'ready',
    todayISO: '2026-09-04', oldestDay: '2026-08-01', windowDays: 28,
  });
  const r = myPlanWeek(out, 28);
  if (r.kind !== 'ready') { errors.push('the real reconciler produces a comparison'); } else {
    eq(r.logged, 1, 'one prescribed movement was logged');
    eq(r.total, 2, 'out of the two the programme names');
    eq(r.missing.names.join(), 'Romanian Deadlift', 'and the other is named');
    ok(/Leg Press/.test(r.offPlanNote ?? ''), 'with the movement they did instead reported as their own');
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('myPlanWeek: ok — a member can see which of their coach’s movements have not appeared, and which nobody can answer for');
