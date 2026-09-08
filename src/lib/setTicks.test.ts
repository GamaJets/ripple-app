import { expandSets, type SetSpec } from './setRows';
import { setTicks, tickLabel, tickRecord, ticksLine } from './setTicks';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

/** The ordinary programme row: three of the same set, no table. */
const plain: SetSpec = { sets: 3, reps: '10', loadKg: 60 };
/** A ramp, written as a table by a coach. */
const ramp: SetSpec = {
  sets: 3, reps: '8', loadKg: 60,
  setRows: [{ reps: '8', loadKg: 60 }, { reps: '8', loadKg: 65 }, { reps: '6', loadKg: 70 }],
};

// ── what one tap would write ──────────────────────────────────────────────
//
// The rule this file exists to hold: a tick may only be offered where the plan
// names a single definite figure. The quick-log this replaces used
// `parseInt(reps, 10) || 8`, so AMRAP became eight.
eq(tickRecord(expandSets(plain)[0]), { kind: 'reps', value: 10, loadKg: 60 },
  'a definite prescription is what the tick writes');
eq(tickRecord(expandSets(ramp)[2]), { kind: 'reps', value: 6, loadKg: 70 },
  'and on a table it is THAT row, not the exercise');
eq(tickRecord(expandSets({ sets: 1, reps: '8-10', loadKg: 60 })[0]), null,
  'a range names no single figure, so there is no tick');
eq(tickRecord(expandSets({ sets: 1, reps: 'AMRAP', loadKg: 60 })[0]), null,
  'nor does AMRAP — which is the case that used to be written as eight reps');
eq(tickRecord(expandSets({ sets: 1, reps: 'Max', loadKg: 60 })[0]), null, 'nor Max');
eq(tickRecord(expandSets({ sets: 1, reps: '', loadKg: 60 })[0]), null, 'nor a blank');
eq(tickRecord(expandSets({ sets: 1, reps: '0', loadKg: 60 })[0]), null, 'nor a set of no reps');
// A hold is exactly as definite as a rep count and is written as SECONDS.
eq(tickRecord(expandSets({ sets: 1, reps: '45 sec' })[0]), { kind: 'hold', secs: 45, loadKg: null },
  'a plank is logged as a hold, not as forty-five repetitions');
eq(tickRecord(expandSets({ sets: 1, reps: '1 min', loadKg: 20 })[0]), { kind: 'hold', secs: 60, loadKg: 20 },
  'and a minute is sixty seconds, with whatever is on the belt');
// A bodyweight prescription keeps its null rather than gaining a 0.
eq(tickRecord(expandSets({ sets: 1, reps: '12' })[0]), { kind: 'reps', value: 12, loadKg: null },
  'no prescribed load stays null — a stored 0 and a load nobody wrote cannot be told apart later');

// ── the checklist ─────────────────────────────────────────────────────────
const fresh = setTicks(expandSets(plain), 0);
eq(fresh.map((t) => t.state), ['next', 'later', 'later'], 'nothing logged: set one is next and the rest are later');
eq(fresh.map((t) => t.actionable), [true, false, false], 'and only the next one can be tapped');
const two = setTicks(expandSets(plain), 2);
eq(two.map((t) => t.state), ['done', 'done', 'next'], 'two logged: two done, the third next');
eq(two.map((t) => t.actionable), [false, true, true],
  'the tick moves on, and only the MOST RECENT done set can be taken back');
eq(setTicks(expandSets(plain), 3).map((t) => t.state), ['done', 'done', 'done'], 'all three logged');
eq(setTicks(expandSets(plain), 3).map((t) => t.actionable), [false, false, true],
  'with nothing left to tick and the last one still undoable');
// More sets logged than planned is a real session, not a bug.
eq(setTicks(expandSets(plain), 5).map((t) => t.state), ['done', 'done', 'done'],
  'a fifth set of a three-set movement leaves no planned row unticked');
eq(setTicks(expandSets(plain), 5).map((t) => t.actionable), [false, false, false],
  'and nothing planned can be taken back, because the last logged set is not on this list');
eq(setTicks([], 0), [], 'no plan is no checklist');
eq(setTicks(expandSets(plain), -2).map((t) => t.state), ['next', 'later', 'later'],
  'a count below zero is none logged rather than a negative index');
eq(setTicks(expandSets(plain), Number.NaN).map((t) => t.state), ['next', 'later', 'later'],
  'and a count that is not a number is none logged');
eq(setTicks(expandSets(ramp), 0).map((t) => t.n), [1, 2, 3], 'the set numbers come off the plan');

// A movement the plan cannot answer for is DRAWN and not tickable — the row
// still says what is coming, the member types what they did.
const vague = setTicks(expandSets({ sets: 2, reps: '8-10', loadKg: 40 }), 0);
eq(vague.map((t) => t.state), ['next', 'later'], 'a range is still a plan with rows in it');
eq(vague.map((t) => t.actionable), [false, false], 'but no tap can say what was done');
eq(vague[0].records, null, 'and there is nothing for a tap to write');
eq(vague[1].records, null, 'on the row still to come as well, which is how a screen can warn about it early');
// A row still to come DOES carry its figures. They are a property of the
// planned set, not of the tap, and a checklist that only knew the next set's
// numbers could not draw the rows underneath it.
eq(setTicks(expandSets(ramp), 0)[2].records, { kind: 'reps', value: 6, loadKg: 70 },
  'a later row knows what it asks for, even though it cannot be tapped');
eq(setTicks(expandSets(ramp), 0)[2].actionable, false, 'order is gated by actionable and nothing else');

// ── the sentence ──────────────────────────────────────────────────────────
eq(ticksLine(4, 0), '0 of 4 sets done · 4 to go', 'the plan, and what is left of it');
eq(ticksLine(4, 2), '2 of 4 sets done · 2 to go', 'part way through');
eq(ticksLine(4, 3), '3 of 4 sets done · 1 to go', 'one left is singular in the count, not in the noun');
eq(ticksLine(4, 4), 'All 4 sets done.', 'and finished says so');
eq(ticksLine(4, 6), 'All 4 sets done, and 2 more.', 'sets past the plan are counted rather than hidden');
eq(ticksLine(0, 0), null, 'no plan is no sentence — a member adding their own sets is not behind on anything');
eq(ticksLine(-1, 0), null, 'and neither is a nonsense plan');
eq(ticksLine(3, Number.NaN), '0 of 3 sets done · 3 to go', 'a count that is not a number is none');

// ── what a screen reader is told ──────────────────────────────────────────
//
// The label names the FIGURES the tap will write, not the prescription it read
// them from: a control whose spoken sentence is not what it does is worse than
// one with no label.
eq(tickLabel(setTicks(expandSets(plain), 0)[0], 'Back Squat', '60 kg'),
  'Log set 1 of Back Squat: 10 reps at 60 kg.', 'the next set says what the tap records');
eq(tickLabel(setTicks(expandSets({ sets: 1, reps: '45 sec' }), 0)[0], 'Plank', null),
  'Log set 1 of Plank: a 45 second hold at bodyweight.', 'a hold is spoken as a hold, and no load as bodyweight');
eq(tickLabel(setTicks(expandSets(plain), 2)[1], 'Back Squat', '60 kg'),
  'Set 2 of Back Squat is logged. Take it back.', 'the most recent logged set offers the undo');
eq(tickLabel(setTicks(expandSets(plain), 2)[0], 'Back Squat', '60 kg'),
  'Set 1 of Back Squat is logged.', 'an older one states the fact and offers nothing');
eq(tickLabel(setTicks(expandSets(plain), 0)[2], 'Back Squat', '60 kg'),
  'Set 3 of Back Squat, still to come.', 'a later set is announced as such');
ok(tickLabel(vague[0], 'Row', '40 kg').includes('Type what you did'),
  'and where the plan names no figure the label says why there is nothing to tap');
// The unit is the CALLER's — this module formats nothing, so a pounds member is
// never read a stored kilogram.
ok(tickLabel(setTicks(expandSets(plain), 0)[0], 'Back Squat', '132 lb').includes('132 lb'),
  'the load in the label is the one handed in, in the unit it was rendered in');

if (errors.length) { errors.forEach((e) => console.error('FAIL', e)); process.exit(1); }
console.log('setTicks ok — a tick logs the set the plan asked for, and is not offered where the plan will not say');
