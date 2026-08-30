// The coach's view of a client's planned days. Compile with tsc, run with node.
//
// Three things are defended here, and the first two are the ones that would
// ship quietly wrong.
//
// 1. No arrangement of marks, dates and programmes makes this module say a plan
//    was kept. The screen it feeds reads no training log — see the header of
//    coachWeek.ts — so every passed day must come back 'log-unknown', and none
//    of the sentences may claim otherwise.
//
// 2. The window and the labels survive the reader's timezone. Every date here
//    is a bare `YYYY-MM-DD`, which `new Date` resolves to UTC midnight; the repo
//    runs these under America/Los_Angeles, Pacific/Auckland and Asia/Dubai for
//    the two shipped bugs in src/lib/localDate.ts. The spans below deliberately
//    cross both hemispheres' clock changes, where a day is 23 or 25 hours long
//    and naive millisecond arithmetic loses or gains a day.
//
// 3. A conflict is claimed only when the programme is actually known. A coach
//    reads `assigned_programs` only for rows they assigned to a client still
//    theirs, so "no programme came back" is not "their programme is empty".
import {
  DAYS_AHEAD, DAYS_BEHIND, daysBetweenIso, shiftIso, planWindow, sideOf,
  coachWeek, dayHeading, whenLabel, coachPlanLine, coachConflictLine,
  programmeCaveat, planNote, type ScheduledFocus,
} from './coachWeek';
import { PLANNED_DAY_TYPES, type PlannedDay, type PlanOutcome } from './dayPlan';
import { scheduledFocus } from './checklist';
import { buildProgram } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// 1 Sep 2026 is a Tuesday (asserted in dayPlan.test.ts), so 7 Sep is a Monday.
const TODAY = '2026-09-01';

// ── date arithmetic that no clock change may touch ──
ok(shiftIso(TODAY, 0) === TODAY, 'shifting by nothing returns the same day');
ok(shiftIso('2026-08-31', 1) === '2026-09-01', 'a shift crosses a month boundary');
ok(shiftIso('2026-01-01', -1) === '2025-12-31', 'and a year boundary backwards');
// US clocks go forward on 8 March 2026 and back on 1 November; NZ goes back on
// 5 April and forward on 27 September. Each of those days is 23 or 25 hours
// long in one of the three test zones, so a shift computed by adding
// 86,400,000 ms to a local midnight lands on the wrong date for one of them.
ok(shiftIso('2026-03-07', 1) === '2026-03-08', 'a shift across the US spring change');
ok(shiftIso('2026-11-01', 1) === '2026-11-02', 'and across the US autumn change');
ok(shiftIso('2026-04-04', 1) === '2026-04-05', 'and across the NZ autumn change');
ok(shiftIso('2026-09-27', 1) === '2026-09-28', 'and across the NZ spring change');
ok(shiftIso('nonsense', 1) === null, 'an unreadable date shifts to nothing rather than to today');
ok(daysBetweenIso('2026-03-01', '2026-03-31') === 30, 'a month spanning a clock change is still whole days');
ok(daysBetweenIso('2026-09-01', '2026-08-25') === -7, 'and counts backwards');
ok(daysBetweenIso('2026-09-01', 'nonsense') === null, 'an unreadable date has no distance');

// ── the window ──
const W = planWindow(TODAY);
ok(W?.fromISO === '2026-08-25', `the window opens ${DAYS_BEHIND} days back, got ${W?.fromISO}`);
// DAYS_AHEAD counts today, so the last day in view is one short of it.
ok(W?.toISO === '2026-09-14', `and closes ${DAYS_AHEAD - 1} days on, got ${W?.toISO}`);
ok(daysBetweenIso(W!.fromISO, W!.toISO) === DAYS_BEHIND + DAYS_AHEAD - 1,
  'the two ends are exactly the window apart');
// The fortnight exists so that the WHOLE of next week is always in view,
// whichever day the coach opens the screen. A rolling seven days shows a deload
// starting Monday on the Monday it starts.
for (let i = 0; i < 7; i++) {
  const day = shiftIso('2026-08-30', i)!; // a Sunday, so this walks a full week
  const w = planWindow(day)!;
  const nextSunday = shiftIso(day, 7 - new Date(2026, 7, 30 + i).getDay())!;
  const nextSaturday = shiftIso(nextSunday, 6)!;
  ok(daysBetweenIso(w.toISO, nextSaturday)! <= 0,
    `opened on ${day}, the window still reaches the end of next week (${nextSaturday} vs ${w.toISO})`);
}
ok(planWindow('nonsense') === null, 'an unreadable today gives no window rather than a wrong one');

ok(sideOf('2026-08-31', TODAY) === 'gone' && sideOf(TODAY, TODAY) === 'today'
  && sideOf('2026-09-02', TODAY) === 'ahead', 'today is its own side, neither past nor forecast');

// ── the three states are three states ──
const noProgramme: ScheduledFocus = () => undefined;
ok(coachWeek(null, TODAY, noProgramme).state === 'unreadable',
  'a failed read is unreadable — the one thing that must never look like an empty week');
ok(coachWeek([], TODAY, noProgramme).state === 'none',
  'a read that came back empty is a real answer about this client');
ok(coachWeek([], TODAY, noProgramme).ahead.length === 0, 'and it holds nothing');

// ── arrangement ──
const PLANS: PlannedDay[] = [
  { dateISO: '2026-09-07', type: 'rest', note: 'Flying to Berlin' }, // next Monday
  { dateISO: '2026-08-27', type: 'training', note: null },           // last Thursday
  { dateISO: TODAY, type: 'deload', note: null },
  { dateISO: '2026-09-08', type: 'training', note: null },           // next Tuesday
  { dateISO: '2026-08-20', type: 'rest', note: 'before the window' },
  { dateISO: '2026-09-20', type: 'rest', note: 'after the window' },
  { dateISO: 'nonsense', type: 'off', note: null },
];
const plain = coachWeek(PLANS, TODAY, noProgramme);
ok(plain.state === 'planned', 'marked days show as marked');
ok(plain.ahead.map((d) => d.plan.dateISO).join(',') === '2026-09-01,2026-09-07,2026-09-08',
  `today and forward, soonest first, got ${plain.ahead.map((d) => d.plan.dateISO).join(',')}`);
ok(plain.gone.map((d) => d.plan.dateISO).join(',') === '2026-08-27',
  'behind today, most recent first — and the day outside the window is not in either list');
ok(plain.ahead.length + plain.gone.length === 4,
  'a date outside the window and a date that will not parse are both dropped');
ok(plain.ahead[0].side === 'today', 'today lands at the head of Ahead, on its own side');
ok(plain.gone[0].offset === -5, 'the offset is signed days from today');

// ── a plan never becomes a record ──
// The assertion this file exists for. No day, of any type, on either side of
// today, may come back as anything the coach could read as evidence.
for (const d of [...plain.ahead, ...plain.gone]) {
  ok(d.outcome !== 'log-agrees' && d.outcome !== 'nothing-logged',
    `${d.plan.dateISO} must not claim anything about the log — got ${d.outcome}`);
}
ok(plain.gone[0].outcome === 'log-unknown',
  'a day that has passed is unknown, because this screen does not read the log');
ok(plain.ahead[0].outcome === 'today' && plain.ahead[1].outcome === 'not-yet',
  'and days that have not been lived yet say so');

const CLAIM = /\bcompleted\b|\bdone\b|\bkept it\b|\bstuck to it\b|\bas planned\b/i;
const OUTCOMES: PlanOutcome[] = ['not-yet', 'today', 'log-agrees', 'log-disagrees', 'nothing-logged', 'log-unknown'];
for (const type of PLANNED_DAY_TYPES) {
  for (const outcome of OUTCOMES) {
    const line = coachPlanLine(type, outcome, 'Sam');
    ok(line.length > 0, `every outcome has a sentence — ${type}/${outcome} had none`);
    ok(!CLAIM.test(line), `no sentence may read as a record — ${type}/${outcome}: ${line}`);
    ok(line.includes('Sam'), `the sentence is about a named person — ${type}/${outcome}`);
  }
}
ok(coachPlanLine('rest', 'nothing-logged', 'Sam').includes('not evidence'),
  'an empty log on a planned rest day says in words that it proves nothing');
ok(coachPlanLine('rest', 'log-unknown', 'Sam').includes('doesn’t read their training log'),
  'and a passed day says why this screen cannot tell them');

// ── the conflict, which is the point of the screen ──
const programme = buildProgram('muscle', 25); // Mon Push · Wed Pull · Fri Legs
const known: ScheduledFocus = (weekday) => scheduledFocus(programme.days, weekday);
const withProg = coachWeek(PLANS, TODAY, known);
const byDate = new Map(withProg.ahead.concat(withProg.gone).map((d) => [d.plan.dateISO, d]));

const monday = byDate.get('2026-09-07');
ok(monday?.conflict?.kind === 'plan-schedules-a-session',
  'a rest day on a Monday the programme puts Push on is a conflict');
ok(monday?.conflict?.focus === 'Push', `and it names the session, got ${monday?.conflict?.focus}`);
ok(coachConflictLine(monday!.conflict!, 'rest', 'Sam').includes('Push'),
  'the coach is told which session it is');
ok(coachConflictLine(monday!.conflict!, 'rest', 'Sam').includes('Sam'),
  'and whose mark it disagrees with');

const tuesday = byDate.get('2026-09-08');
ok(tuesday?.conflict?.kind === 'plan-schedules-nothing',
  'a training day on a Tuesday the programme leaves empty is the other conflict');
ok(byDate.get(TODAY)?.conflict === null,
  'a deload on a day the programme schedules nothing is not a conflict — it is how a deload works');

ok(withProg.conflicts.map((d) => d.plan.dateISO).join(',') === '2026-09-07,2026-09-08',
  `conflicts are the ones still ahead, in date order, got ${withProg.conflicts.map((d) => d.plan.dateISO).join(',')}`);
// The past Thursday is a training day, and the programme schedules nothing on a
// Thursday — so it IS a conflict, and it is still kept out of the list a coach
// is asked to act on.
ok(byDate.get('2026-08-27')?.conflict?.kind === 'plan-schedules-nothing',
  'a passed day still carries its own disagreement on its row');
ok(!withProg.conflicts.some((d) => d.side === 'gone'),
  'but nothing already gone is put in front of a coach as something to settle');

// ── nothing is claimed against a programme nobody read ──
ok(plain.conflicts.length === 0,
  'with no readable programme, no conflict is claimed in either direction');
for (const d of [...plain.ahead, ...plain.gone]) {
  ok(d.conflict === null, `${d.plan.dateISO} claims nothing while the programme is unknown`);
}
ok(programmeCaveat(true, 'Sam') === null, 'a known programme needs no caveat');
ok((programmeCaveat(false, 'Sam') ?? '').includes('Sam'),
  'and an unknown one is said out loud, because no conflicts looks the same as never having checked');

// ── labels, built rather than formatted ──
ok(dayHeading('2026-09-01') === 'Tue 1 Sep',
  `the heading is the client's own calendar day in every zone, got ${dayHeading('2026-09-01')}`);
ok(dayHeading('2026-09-07') === 'Mon 7 Sep', 'and does not drift a day west of Greenwich');
ok(dayHeading('2026-01-31') === 'Sat 31 Jan', 'month names are one-based off the index');
ok(dayHeading('nonsense') === '—', 'an unreadable date renders as a dash, not as today');
ok(whenLabel(TODAY, TODAY) === 'Today', 'today says so');
ok(whenLabel('2026-09-02', TODAY) === 'Tomorrow' && whenLabel('2026-08-31', TODAY) === 'Yesterday',
  'the two days either side are named');
ok(whenLabel('2026-09-05', TODAY) === 'In 4 days' && whenLabel('2026-08-27', TODAY) === '5 days ago',
  'and everything else is counted, with the side it is on in the words');

// ── the client's own words ──
ok(planNote(plain.ahead[1]) === 'Flying to Berlin',
  'the note survives — it is the only place a travel day is ever written down');
ok(planNote({ ...plain.ahead[1], plan: { ...plain.ahead[1].plan, note: '   ' } }) === null,
  'whitespace is not a note, and would render as an empty quoted line');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH WEEK FAILURES:\n' + errors.join('\n') : 'ALL COACH WEEK TESTS PASSED');
if (errors.length) process.exit(1);
