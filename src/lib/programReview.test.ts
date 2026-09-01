import {
  CHECKS, HEAVY_REPS, HIGH_REPS, MIN_GOAL_SETS, NOT_CHECKED, RECENT_OUTINGS,
  SHORT_REST_SEC, VOLUME_JUMP, checksLine, reviewProgram,
  type Finding, type ReviewInput,
} from './programReview';
import type { Program, ProgramExercise } from './programs';
import type { Injury } from './injuries';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const ex = (name: string, group: string, over: Partial<ProgramExercise> = {}): ProgramExercise => ({
  key: name.toLowerCase(), name, group, sets: 3, reps: '8-10', alternatives: [], ...over,
});

const prog = (...exercises: ProgramExercise[]): Program => ({
  title: 'Test', focus: [], note: '', days: [{ day: 'Mon', focus: 'Push', exercises }],
});

/** Every read landed and nothing is disclosed — the baseline a rule is added
 *  to, so a finding in a test is the rule under test and not a leftover. */
const base = (program: Program, over: Partial<ReviewInput> = {}): ReviewInput => ({
  program, injuries: [], injuryStatus: 'ready', log: [], logStatus: 'ready', goal: null, ...over,
});

const ids = (fs: Finding[]) => fs.map((f) => f.id);
const only = (fs: Finding[], id: string) => fs.filter((f) => f.id === id);

const injury = (area: string, severity: Injury['severity'] = 'moderate'): Injury =>
  ({ id: 'i1', area, severity, status: 'active', at: '2026-01-01T00:00:00.000Z' });

/** A logged session. Midday UTC so the three timezones `test:zones` runs under
 *  land it on a day of their own; nothing below asserts WHICH day. */
const logged = (day: string, exercise: string, sets: [number, number][]): WorkoutEntry =>
  ({ t: `2026-08-${day}T12:00:00.000Z`, exercise, sets });

/* ── the honest label ─────────────────────────────────────────────────────── */

// The whole point of the module. A screen may not call this an AI review, and
// the sentence it puts above the list is built here so it cannot drift.
ok(!/\bAI\b/i.test(checksLine()), 'the line above the list does not call itself AI');
ok(checksLine().includes('rules, not a model'), 'it says outright what it is');
ok(checksLine().startsWith(`${CHECKS.length} checks`), 'the count comes from the catalogue, not from prose');
ok(CHECKS.every((c) => c.label === c.label.toLowerCase() || !/^[A-Z]/.test(c.label.slice(1))),
   'check labels are prose, not Title Case headings');
ok(NOT_CHECKED.length > 0, 'the questions deliberately not asked are named');

/* ── nothing to review ────────────────────────────────────────────────────── */

const empty = reviewProgram(base({ title: '', focus: [], note: '', days: [] }));
eq(empty.findings, [], 'an empty programme has nothing to find');
eq(empty.counted, { days: 0, exercises: 0, sets: 0 }, 'and nothing to count');
eq(empty.status, 'ready', 'an empty programme is not a failed read');
eq(reviewProgram(base(null as unknown as Program)).findings, [], 'a missing programme is not a crash');

const counted = reviewProgram(base(prog(ex('Bench Press', 'Chest'), ex('Row', 'Back', { sets: 4 })))).counted;
eq(counted, { days: 1, exercises: 2, sets: 7 }, 'days, exercises and sets are counted off the programme');

/* ── injury ───────────────────────────────────────────────────────────────── */

const shoulder = reviewProgram(base(prog(ex('Bench Press', 'Chest')), { injuries: [injury('shoulder')] }));
eq(ids(only(shoulder.findings, 'injury')).length, 1, 'a movement that loads a disclosed area is reported');
ok(shoulder.findings[0].detail.includes('Bench Press'), 'and the finding names the movement');
ok(shoulder.findings[0].detail.includes('shoulder'), 'and the area');
ok(shoulder.findings[0].detail.includes('moderate'), 'and the severity as disclosed');
eq(shoulder.findings[0].day, 'Mon', 'and the day it is on');

eq(only(reviewProgram(base(prog(ex('Leg Curl', 'Hamstrings')), { injuries: [injury('shoulder')] })).findings, 'injury'),
   [], 'a movement that does not load the area is not reported');

// A recovered disclosure is not an active one. `injuryFlag` filters, and this
// asserts the module asks it rather than reading the list itself.
eq(only(reviewProgram(base(prog(ex('Bench Press', 'Chest')), {
  injuries: [{ ...injury('shoulder'), status: 'recovered' }],
})).findings, 'injury'), [], 'a recovered injury is not flagged');

// No client attached is a third answer here too. An empty list under a whole
// read is "they have disclosed nothing"; null is "there is nobody", and the
// check stands down rather than reporting a programme it never looked at.
const noOne = reviewProgram(base(prog(ex('Bench Press', 'Chest')), { injuries: null }));
eq(only(noOne.findings, 'injury'), [], 'a draft with no client is not checked against disclosures');
eq(noOne.skipped.filter((s) => s.id === 'injury').map((s) => s.kind), ['absent'],
   'and that is an absent skip, not a failed read');
eq(noOne.status, 'ready', 'and it does not make the review partial');
eq(reviewProgram(base(prog(ex('Bench Press', 'Chest')), { injuries: null, injuryStatus: 'error' })).status,
   'ready', 'and no client to check against beats whatever the status says');

// The one that matters. An injury list that did not load must not read as an
// injury list with nothing in it.
for (const status of ['loading', 'partial', 'error'] as const) {
  const r = reviewProgram(base(prog(ex('Bench Press', 'Chest')), {
    injuries: [injury('shoulder')], injuryStatus: status,
  }));
  eq(only(r.findings, 'injury'), [], `injuries are not checked under a ${status} read`);
  eq(r.status, 'partial', `and the review says so under a ${status} read`);
  eq(r.skipped.filter((s) => s.id === 'injury').map((s) => s.kind), ['unread'],
     `and the skip is an unread one under a ${status} read`);
}
ok(reviewProgram(base(prog(ex('Bench Press', 'Chest')), { injuryStatus: 'error' }))
  .skipped.find((s) => s.id === 'injury')!.why.includes('could not be read'),
   'a failed injury read says it failed rather than saying nothing was found');
// A read still in flight and a read that failed are different sentences. Both
// arms are asserted: a mutation run inverted the `=== 'loading'` test on the
// log's pair of them and no assertion was watching the other side.
ok(reviewProgram(base(prog(ex('Bench Press', 'Chest')), { injuryStatus: 'loading' }))
  .skipped.find((s) => s.id === 'injury')!.why.includes('still being read'),
   'and a read still in flight says that instead');

/* ── set-count ────────────────────────────────────────────────────────────── */

const rows3 = [{ reps: '10' }, { reps: '10' }, { reps: '8' }];
eq(only(reviewProgram(base(prog(ex('Squat', 'Legs', { sets: 3, setRows: rows3 })))).findings, 'set-count'),
   [], 'a set count that matches its rows is not reported');
const mism = only(reviewProgram(base(prog(ex('Squat', 'Legs', { sets: 4, setRows: rows3 })))).findings, 'set-count');
eq(mism.length, 1, 'a set count that disagrees with its rows is reported');
ok(mism[0].detail.includes('3 sets written out'), 'the finding names the row count');
ok(mism[0].detail.includes('stored as 4'), 'and the stored figure');

// An exercise with no table is the ordinary case and says nothing here.
eq(only(reviewProgram(base(prog(ex('Squat', 'Legs', { sets: 4 })))).findings, 'set-count'),
   [], 'an exercise with no rows has no disagreement to report');
// `setRows: []` falls back like an absent one — see hasSetRows.
eq(only(reviewProgram(base(prog(ex('Squat', 'Legs', { sets: 4, setRows: [] })))).findings, 'set-count'),
   [], 'an empty row table is not a set count of zero');

const nan = only(reviewProgram(base(prog(ex('Squat', 'Legs', { sets: NaN, setRows: rows3 })))).findings, 'set-count');
eq(nan.length, 1, 'a stored set count that is not a number is still a disagreement');
ok(!nan[0].detail.includes('NaN'), 'and the word NaN is not put in front of a coach');

/* ── group-muscle ─────────────────────────────────────────────────────────── */

const superSame = reviewProgram(base(prog(
  ex('Bench Press', 'Chest', { setGroupId: 'g1' }),
  ex('Incline Press', 'Chest', { setGroupId: 'g1' }),
)));
eq(only(superSame.findings, 'group-muscle').length, 1, 'a superset of two chest movements is reported');
ok(superSame.findings[0].detail.includes('superset'), 'and it is called a superset, from its size');
eq(superSame.findings[0].exercises, ['Bench Press', 'Incline Press'], 'and both movements are named');

eq(only(reviewProgram(base(prog(
  ex('Bench Press', 'Chest', { setGroupId: 'g1' }),
  ex('Bent-over Row', 'Back', { setGroupId: 'g1' }),
))).findings, 'group-muscle'), [], 'a superset of two different groups is not reported');

// Adjacency is the model — src/lib/setGroups.ts. Two chest movements in one
// group with a back movement between them are not done back to back.
eq(only(reviewProgram(base(prog(
  ex('Bench Press', 'Chest', { setGroupId: 'g1' }),
  ex('Row', 'Back', { setGroupId: 'g1' }),
  ex('Fly', 'Chest', { setGroupId: 'g1' }),
))).findings, 'group-muscle'), [], 'a group whose same-group members are not adjacent is not reported');

const tri = reviewProgram(base(prog(
  ex('Row', 'Back', { setGroupId: 'g1' }),
  ex('Bench Press', 'Chest', { setGroupId: 'g1' }),
  ex('Fly', 'Chest', { setGroupId: 'g1' }),
)));
eq(only(tri.findings, 'group-muscle').length, 1, 'only the adjacent pair inside a tri-set is reported');
ok(tri.findings[0].detail.includes('tri-set'), 'and the label follows the size of the run it is in');

// A lone id is not a group, and an exercise with no group string is not a
// match with another that has none.
eq(only(reviewProgram(base(prog(ex('Bench Press', 'Chest', { setGroupId: 'g1' })))).findings, 'group-muscle'),
   [], 'a group of one is not a superset');
eq(only(reviewProgram(base(prog(
  ex('A', '', { setGroupId: 'g1' }), ex('B', '', { setGroupId: 'g1' }),
))).findings, 'group-muscle'), [], 'two blank groups are not the same muscle group');
eq(only(reviewProgram(base(prog(
  ex('A', '', { setGroupId: 'g1' }), ex('B', 'Chest', { setGroupId: 'g1' }),
))).findings, 'group-muscle'), [], 'and one blank beside a real one is not either');
// Case is not the movement. The catalogue and a coach's own typing disagree
// about it and the muscle does not.
eq(only(reviewProgram(base(prog(
  ex('A', 'Chest', { setGroupId: 'g1' }), ex('B', 'chest', { setGroupId: 'g1' }),
))).findings, 'group-muscle').length, 1, 'the same group spelled two ways is one group');

/* ── heavy-rest ───────────────────────────────────────────────────────────── */

const noRest = only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: '3-5' })))).findings, 'heavy-rest');
eq(noRest.length, 1, 'a low-rep movement with no rest set is reported');
ok(noRest[0].detail.includes('90 second fallback'), 'and the finding says what the client will actually get');
ok(noRest[0].detail.includes('5 reps or fewer'), 'and the rep target it read');

// The boundary, both sides. HEAVY_REPS is the top of the range, inclusive.
eq(only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: `4-${HEAVY_REPS}` })))).findings, 'heavy-rest').length,
   1, 'a range topping out at the heavy limit is reported');
eq(only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: `4-${HEAVY_REPS + 1}` })))).findings, 'heavy-rest'),
   [], 'a range one rep above it is not');

// A rest that was set, both sides of SHORT_REST_SEC.
eq(only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: '5', restSec: SHORT_REST_SEC - 1 })))).findings,
   'heavy-rest').length, 1, 'a short rest on a low-rep movement is reported');
eq(only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: '5', restSec: SHORT_REST_SEC })))).findings,
   'heavy-rest'), [], 'a rest at the limit is not');
eq(only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: '5', restSec: 180 })))).findings,
   'heavy-rest'), [], 'a long rest is not');
ok(only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: '5', restSec: 40 })))).findings,
   'heavy-rest')[0].detail.includes('40 seconds'), 'and a short rest is quoted back');

// One second is a rest, by the same test `restSecondsFor` uses — it falls back
// at zero and below, not at one. The two must agree or this screen reports a
// rest the runner will not run, and a mutation run raised the threshold here
// to one with no assertion watching.
const oneSec = only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: '5', restSec: 1 })))).findings,
  'heavy-rest');
eq(oneSec.length, 1, 'a rest of one second is still a rest somebody set');
ok(oneSec[0].detail.includes('1 second of rest'), 'and it is one second, not one seconds');
ok(!oneSec[0].detail.includes('no rest set'), 'and it is not reported as no rest at all');

// A stored 0 is how the runner CLEARS the timer, so it is not a rest anybody
// set — the exercise falls back and is reported as having none.
ok(only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: '5', restSec: 0 })))).findings,
   'heavy-rest')[0].detail.includes('no rest set'), 'a stored zero is no rest, not a rest of nothing');
ok(only(reviewProgram(base(prog(ex('Deadlift', 'Back', { reps: '5', restSec: null })))).findings,
   'heavy-rest')[0].detail.includes('no rest set'), 'and so is a null');

// Reps that are not a count are not read as one. "45 sec" is a hold.
eq(only(reviewProgram(base(prog(ex('Plank', 'Core', { reps: '45 sec' })))).findings, 'heavy-rest'),
   [], 'a hold has no rep target and is not called low-rep');
eq(only(reviewProgram(base(prog(ex('Push-up', 'Chest', { reps: 'AMRAP' })))).findings, 'heavy-rest'),
   [], 'AMRAP has no rep target either');

// A warm-up row of ten inside an exercise of triples does not make it a
// ten-rep movement: only the sets that count as work are read.
eq(only(reviewProgram(base(prog(ex('Deadlift', 'Back', {
  reps: '3', sets: 3,
  setRows: [{ reps: '10', method: 'warmup' }, { reps: '3' }, { reps: '3' }],
})))).findings, 'heavy-rest').length, 1, 'a warm-up row does not raise the rep target of the working sets');

// An exercise whose every set is a warm-up has no working sets at all.
eq(only(reviewProgram(base(prog(ex('Bar Work', 'Back', {
  reps: '5', sets: 1, setRows: [{ method: 'warmup' }],
})))).findings, 'heavy-rest'), [], 'an exercise of nothing but warm-ups has no rep target to read');

/* ── warmup-volume ────────────────────────────────────────────────────────── */

const warm = only(reviewProgram(base(prog(ex('Warm-up Bike', 'Legs', { sets: 2, reps: '10' })))).findings,
  'warmup-volume');
eq(warm.length, 1, 'a movement named as a warm-up whose sets are ordinary is reported');
ok(warm[0].detail.includes('2 of its 2 sets'), 'and the finding counts them');
ok(warm[0].detail.includes('warm-up'), 'and says which of the two words it matched');

ok(only(reviewProgram(base(prog(ex('Cool-down Walk', 'Legs', { sets: 1, reps: '10' })))).findings,
   'warmup-volume')[0].detail.includes('cool-down'), 'a cool-down is reported as a cool-down');
eq(only(reviewProgram(base(prog(ex('Warm up Bike', 'Legs', { sets: 1, reps: '10' })))).findings,
   'warmup-volume').length, 1, 'the space spelling is matched too');

// The method is what the app acts on, so a movement whose sets ARE warm-ups
// has nothing wrong with it whatever it is called.
eq(only(reviewProgram(base(prog(ex('Warm-up Bike', 'Legs', { sets: 2, reps: '10', method: 'warmup' })))).findings,
   'warmup-volume'), [], 'a warm-up whose sets are marked as warm-ups is not reported');
eq(only(reviewProgram(base(prog(ex('Warm-up Bike', 'Legs', {
  sets: 2, reps: '10', setRows: [{ method: 'warmup' }, { method: 'warmup' }],
})))).findings, 'warmup-volume'), [], 'and neither is one marked row by row');
// Partly marked is still reported, and the count says how much.
ok(only(reviewProgram(base(prog(ex('Warm-up Bike', 'Legs', {
  sets: 2, reps: '10', setRows: [{ method: 'warmup' }, {}],
})))).findings, 'warmup-volume')[0].detail.includes('1 of its 2 sets'),
   'a half-marked warm-up is reported for the half that counts');

// The word has to be the movement's own. "Warmer" is not "warm-up".
eq(only(reviewProgram(base(prog(ex('Arm Warmer', 'Arms', { reps: '10' })))).findings, 'warmup-volume'),
   [], 'a word that merely contains the letters is not matched');

/* ── volume-jump ──────────────────────────────────────────────────────────── */

// 5 × 5 at 100 kg is 2,500 kg planned. Her best logged session on record is
// 1,000 kg, so the plan is 150% above it.
const squats = prog(ex('Back Squat', 'Legs', { sets: 5, reps: '5', loadKg: 100 }));
const jump = reviewProgram(base(squats, {
  log: [logged('10', 'Back Squat', [[5, 100], [5, 100]])],
}));
const vj = only(jump.findings, 'volume-jump');
eq(vj.length, 1, 'planned volume far above what this client has logged is reported');
eq(vj[0].volume!.plannedKg, 2500, 'the planned figure is carried in kilograms');
eq(vj[0].volume!.bestKg, 1000, 'and so is the one it is compared with');
eq(vj[0].volume!.changePct, 150, 'and the change is a percentage of what came before');
eq(vj[0].volume!.compared, 1, 'and how many sessions were compared');
ok(vj[0].volume!.bestDay != null, 'and the day that session was');
ok(!/\bkg\b/.test(vj[0].detail), 'the sentence carries no load — the screen converts the figures');

// The threshold, both sides of it, one rep apart. 5 × 6 at 100 kg is 3,000 kg
// planned; a best of 2,000 kg is exactly VOLUME_JUMP times under it and 1,900
// is just inside. Strictly above, so the first is silent and the second is not.
const sixes = prog(ex('Back Squat', 'Legs', { sets: 5, reps: '6', loadKg: 100 }));
eq(only(reviewProgram(base(sixes, { log: [logged('10', 'Back Squat', [[10, 100], [10, 100]])] })).findings,
   'volume-jump'), [], 'a plan at exactly the threshold is not reported');
eq(only(reviewProgram(base(sixes, { log: [logged('10', 'Back Squat', [[10, 100], [9, 100]])] })).findings,
   'volume-jump').length, 1, 'a plan a rep past it is');
eq(VOLUME_JUMP * 2000, 3000, 'and that pair really does straddle the threshold');
eq(only(reviewProgram(base(squats, { log: [logged('10', 'Back Squat', [[10, 200]])] })).findings, 'volume-jump'),
   [], 'a plan below what she has done is not reported');

// No history for the movement is not a jump. It is nothing to compare.
eq(only(reviewProgram(base(squats, { log: [logged('10', 'Bench Press', [[5, 60]])] })).findings, 'volume-jump'),
   [], 'a movement with no history of its own is not reported');
eq(only(reviewProgram(base(squats)).findings, 'volume-jump'), [], 'an empty log reports nothing');

// A bodyweight movement has no volume to compare and is not treated as zero.
eq(only(reviewProgram(base(prog(ex('Pull-up', 'Back', { sets: 5, reps: '10' })), {
  log: [logged('10', 'Pull-up', [[5, 0]])],
})).findings, 'volume-jump'), [], 'a movement with nothing on the bar is not a volume jump');

// A load written as an explicit ZERO is a different state from no load at all:
// `plannedVolume` COUNTS the set — nought is a finite number — and the total
// comes out at nought. Both halves of the guard are needed and only this case
// tells them apart, which a mutation run showed by turning the `||` into an
// `&&` and the `<= 0` into a `< 0` with nothing able to notice.
eq(only(reviewProgram(base(prog(ex('Back Squat', 'Legs', { sets: 5, reps: '5', loadKg: 0 })), {
  log: [logged('10', 'Back Squat', [[5, 100]])],
})).findings, 'volume-jump'), [], 'a planned volume of nothing is not a jump above anything');

// The window. Only the most recent RECENT_OUTINGS sessions are compared, so a
// heavy block a year ago does not excuse a jump.
const many: WorkoutEntry[] = [];
for (let i = 0; i < RECENT_OUTINGS; i += 1) many.push(logged(String(20 - i), 'Back Squat', [[5, 100], [5, 100]]));
many.push(logged('01', 'Back Squat', [[10, 300]]));   // 3,000 kg, older than the window
const windowed = reviewProgram(base(squats, { log: many }));
eq(only(windowed.findings, 'volume-jump').length, 1, 'a session outside the compared window does not excuse a jump');
eq(only(windowed.findings, 'volume-jump')[0].volume!.compared, RECENT_OUTINGS,
   'and the finding says how many sessions it did compare');
eq(RECENT_OUTINGS, 6, 'the window is six sessions');

// The best session is picked from the WHOLE window, not from the newest one in
// it. A mutation run narrowed the window to a single session and every
// assertion above still passed, because each was written against the constant
// and every session in `many` carried the same volume.
const deepest = reviewProgram(base(squats, {
  log: [
    logged('20', 'Back Squat', [[5, 100]]),                     //   500 kg, newest
    logged('19', 'Back Squat', [[5, 100]]),                     //   500 kg
    logged('18', 'Back Squat', [[10, 100], [10, 100]]),         // 2,000 kg, the real best
    logged('17', 'Back Squat', [[5, 100]]),                     //   500 kg
  ],
}));
eq(only(deepest.findings, 'volume-jump'), [],
   'the heaviest session in the window is what a plan is measured against, not the newest');

// Two sessions at the same volume: the NEWER one is named. Their most recent
// session at that figure is the one a coach is thinking of, and picking either
// arbitrarily would put a date in front of them that moves for no reason.
const tied = reviewProgram(base(squats, {
  log: [
    logged('20', 'Back Squat', [[10, 100]]),
    logged('12', 'Back Squat', [[10, 100]]),
  ],
}));
eq(only(tied.findings, 'volume-jump').length, 1, 'a tie is still a comparison');
ok((only(tied.findings, 'volume-jump')[0].volume!.bestDay ?? '') > '2026-08-15',
   'and the newer of two equal sessions is the one named');

// No client attached is a THIRD answer, and not a client who has logged
// nothing. An empty array runs the check and finds nothing, which reads as a
// check that ran and passed; null stands it down and says so.
const noClient = reviewProgram(base(squats, { log: null }));
eq(only(noClient.findings, 'volume-jump'), [], 'a draft with no client attached is not compared with a history');
eq(noClient.skipped.filter((s) => s.id === 'volume-jump').map((s) => s.kind), ['absent'],
   'and that is an absent skip, not a failed read');
eq(noClient.status, 'ready', 'and a draft with no client is not a partial review');
eq(reviewProgram(base(squats, { log: null, logStatus: 'error' })).status, 'ready',
   'and no client to compare against beats whatever the status says');

// And the log read that did not land.
for (const status of ['loading', 'partial', 'error'] as const) {
  const r = reviewProgram(base(squats, { log: [], logStatus: status }));
  eq(only(r.findings, 'volume-jump'), [], `volume is not compared under a ${status} log read`);
  eq(r.status, 'partial', `and the review says so under a ${status} log read`);
  eq(r.skipped.filter((s) => s.id === 'volume-jump').map((s) => s.kind), ['unread'],
     `and the skip is an unread one under a ${status} log read`);
}
ok(reviewProgram(base(squats, { log: [], logStatus: 'loading' }))
  .skipped.find((s) => s.id === 'volume-jump')!.why.includes('still being read'),
   'a log still in flight says so');
ok(reviewProgram(base(squats, { log: [], logStatus: 'error' }))
  .skipped.find((s) => s.id === 'volume-jump')!.why.includes('could not be read'),
   'and one that failed says that instead');

/* ── goal-reps ────────────────────────────────────────────────────────────── */

const highRep = (n: number) => prog(
  ...Array.from({ length: n }, (_, i) => ex(`High ${i}`, 'Legs', { sets: 1, reps: '15-20' })),
);

const gr = only(reviewProgram(base(highRep(MIN_GOAL_SETS), { goal: 'muscle' })).findings, 'goal-reps');
eq(gr.length, 1, 'a muscle goal against mostly high-rep work is reported');
ok(gr[0].detail.includes(`${MIN_GOAL_SETS} of the ${MIN_GOAL_SETS} working sets`), 'and it is a count, not a verdict');
eq(gr[0].day, null, 'the finding is about the programme, not a day');

eq(only(reviewProgram(base(highRep(MIN_GOAL_SETS - 1), { goal: 'muscle' })).findings, 'goal-reps'),
   [], 'fewer than the minimum is a finisher, not a pattern');

// The two above are written against the CONSTANT, so they follow it wherever
// it goes — a mutation run lowered MIN_GOAL_SETS to 1 and both still passed.
// These are the same two boundaries written as the numbers they are today, so
// moving the threshold has to be a decision somebody makes here as well.
eq(MIN_GOAL_SETS, 3, 'the minimum is three sets');
eq(only(reviewProgram(base(highRep(2), { goal: 'muscle' })).findings, 'goal-reps'), [], 'two high-rep sets is silent');
eq(only(reviewProgram(base(highRep(3), { goal: 'muscle' })).findings, 'goal-reps').length, 1, 'three is not');

// A majority is required, and half is not one.
const half = (high: number, low: number): Program => prog(
  ...Array.from({ length: high }, (_, i) => ex(`High ${i}`, 'Legs', { sets: 1, reps: '15-20' })),
  ...Array.from({ length: low }, (_, i) => ex(`Low ${i}`, 'Legs', { sets: 1, reps: '8-10' })),
);
eq(only(reviewProgram(base(half(3, 3), { goal: 'muscle' })).findings, 'goal-reps'),
   [], 'half the sets high-rep is not a majority');
eq(only(reviewProgram(base(half(4, 3), { goal: 'muscle' })).findings, 'goal-reps').length,
   1, 'more than half is');

// The WHOLE range has to reach the threshold. A range that merely touches it
// is not counted, which is what keeps 12-15 out of this.
eq(only(reviewProgram(base(prog(
  ex('A', 'Legs', { sets: 1, reps: `12-${HIGH_REPS}` }),
  ex('B', 'Legs', { sets: 1, reps: `12-${HIGH_REPS}` }),
  ex('C', 'Legs', { sets: 1, reps: `12-${HIGH_REPS}` }),
), { goal: 'muscle' })).findings, 'goal-reps'), [], 'a range that only reaches the threshold is not high-rep');
eq(only(reviewProgram(base(prog(
  ex('A', 'Legs', { sets: 3, reps: String(HIGH_REPS) }),
), { goal: 'muscle' })).findings, 'goal-reps').length, 1, 'a flat count at the threshold is');

// Low-rep work under a muscle goal is ordinary strength work and is silent.
eq(only(reviewProgram(base(prog(ex('Squat', 'Legs', { sets: 5, reps: '3' })), { goal: 'muscle' })).findings,
   'goal-reps'), [], 'low reps under a muscle goal are not reported');

// The two goals with no convention to check, and the one with no goal at all.
// None of them degrades the review: nothing failed to load.
for (const goal of ['fatloss', 'tone'] as const) {
  const r = reviewProgram(base(highRep(5), { goal }));
  eq(only(r.findings, 'goal-reps'), [], `${goal} has no rep convention and none is invented`);
  eq(r.skipped.filter((s) => s.id === 'goal-reps').map((s) => s.kind), ['absent'], `${goal} is an absent skip`);
  eq(r.status, 'ready', `and ${goal} does not make the review partial`);
}
const noGoal = reviewProgram(base(highRep(5)));
eq(noGoal.skipped.filter((s) => s.id === 'goal-reps').map((s) => s.kind), ['absent'], 'no goal on record is absent');
eq(noGoal.status, 'ready', 'and a client with no goal does not make the review partial');
ok(noGoal.skipped.find((s) => s.id === 'goal-reps')!.why.includes('No goal is on record'),
   'and it says which of the two it is');

/* ── ordering, and everything at once ─────────────────────────────────────── */

const all = reviewProgram(base({
  title: 'Everything', focus: [], note: '',
  days: [{
    day: 'Mon', focus: 'Full', exercises: [
      ex('Warm-up Bike', 'Legs', { sets: 1, reps: '10' }),
      ex('Back Squat', 'Legs', { sets: 5, reps: '5', loadKg: 100 }),
      ex('Bench Press', 'Chest', { setGroupId: 'g1', sets: 2, setRows: [{ reps: '10' }, { reps: '10' }, { reps: '8' }] }),
      ex('Incline Press', 'Chest', { setGroupId: 'g1' }),
    ],
  }],
}, { injuries: [injury('shoulder')], log: [logged('10', 'Back Squat', [[5, 100], [5, 100]])] }));
eq(ids(all.findings), ['injury', 'injury', 'set-count', 'group-muscle', 'heavy-rest', 'warmup-volume', 'volume-jump'],
   'findings come out in the catalogue order, injuries first');
eq(all.status, 'ready', 'and a programme where every read landed is ready');
eq(all.skipped.map((s) => s.id), ['goal-reps'], 'with only the goal check standing down');

// Every finding is traceable. This is the rule the module exists to keep: a
// finding a coach cannot point at is an opinion.
for (const f of all.findings) {
  ok(f.detail.trim().length > 0, `${f.id} says something`);
  ok(f.id === 'goal-reps' || f.exercises.length > 0, `${f.id} names the movement it is about`);
  ok(f.id === 'goal-reps' || f.day != null, `${f.id} names the day it is on`);
  ok(f.exercises.every((n) => f.detail.includes(n)), `${f.id} names its movements in the sentence too`);
  ok(!/\bAI\b/.test(f.detail), `${f.id} does not claim to be an AI`);
  ok(/^[A-Z]/.test(f.detail) && f.detail.trim().endsWith('.'), `${f.id} reads as a sentence`);
}

// A blank name and a blank day are real states, and neither may leave a hole
// at the front of a sentence — scripts/check-prose.mjs.
const blank = reviewProgram(base({
  title: '', focus: [], note: '',
  days: [{ day: '', focus: '', exercises: [ex('', 'Back', { reps: '3' })] }],
}));
ok(blank.findings.length > 0, 'a blank name still gets its finding');
ok(blank.findings[0].detail.startsWith('An unnamed movement'),
   'and the sentence names the gap rather than opening with nothing');
ok(blank.findings[0].detail.includes('an unnamed day'), 'and so does the day');
// A name typed in lower case opens its sentence in upper case and is left
// alone everywhere else — `exercises` is what a screen renders on its own.
const lower = reviewProgram(base(prog(ex('bench press', 'Chest', { reps: '3' }))));
ok(lower.findings[0].detail.startsWith('Bench press'), 'a lower-case name still opens a sentence in upper case');
eq(lower.findings[0].exercises, ['bench press'], 'and the coach\'s own spelling is carried untouched');

if (errors.length) { errors.forEach((e) => console.error('FAIL', e)); process.exit(1); }
console.log(`programReview ok — ${CHECKS.length} rules, every finding naming the exercise, day or figure behind it`);
