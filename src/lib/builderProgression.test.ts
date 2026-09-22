// The load a client's own history supports, on the coach's builder. Compile
// with tsc, run with node.
//
// The bug every assertion here is aimed at: "they have not logged this
// movement" is a claim about a person, and there are three ways to produce it
// without it being true — a read still in flight, a read that failed, and a
// read that came back truncated. A coach who believes it writes a beginner's
// load for somebody who has been pressing 80 kg for a year.
import { alreadyAt, progressionOffer, loadTapLabel } from './builderProgression';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A logged session. `sets` is [reps, weightKg] pairs, as the log stores them. */
const entry = (t: string, exercise: string, sets: [number, number][]): WorkoutEntry =>
  ({ t, exercise, sets } as unknown as WorkoutEntry);

const LOG: WorkoutEntry[] = [
  entry('2026-08-24T09:00:00.000Z', 'Bench Press', [[12, 60], [12, 60], [12, 60]]),
  entry('2026-08-17T09:00:00.000Z', 'Bench Press', [[10, 60], [9, 60]]),
  entry('2026-08-20T09:00:00.000Z', 'Back Squat', [[8, 90], [8, 90]]),
  // Bodyweight work, logged. Reps and no load, which is what a press-up, a
  // pull-up and a plank all look like in this table.
  entry('2026-08-22T09:00:00.000Z', 'Press Up', [[20, 0], [18, 0], [15, 0]]),
];

const base = { clientPicked: true, log: LOG, status: 'ready' as const, exercise: 'Bench Press', reps: '8-12' };

/* ── a suggestion, from what they actually did ──────────────────────────── */

const s = progressionOffer({ ...base, unit: 'kg' });
eq(s.kind, 'suggestion', 'a client who cleared the range gets a load to move to');
if (s.kind === 'suggestion') {
  // Double progression: every top set cleared 12, so the load goes up a step.
  // The arithmetic belongs to progression.ts and is tested there; what matters
  // here is that this module hands it through in KILOGRAMS, which is the unit
  // `BEx.loadKg` stores and the unit the whole log is in.
  ok(s.weightKg > 60, 'clearing the top of the range moves the load up');
  eq(s.up, true, 'and it is reported as an increase');
  ok(s.reason.trim().length > 0, 'with the sentence that justifies it');
}

// The unit is a reading convention and is never defaulted — progression.ts
// leaves the load out of the wording rather than stating it in a unit nobody
// chose. Passing none must still produce a usable suggestion.
const noUnit = progressionOffer(base);
eq(noUnit.kind, 'suggestion', 'a coach with no unit set still gets a load');
if (noUnit.kind === 'suggestion' && s.kind === 'suggestion') {
  eq(noUnit.weightKg, s.weightKg, 'the DECISION does not depend on how the coach reads it');
  ok(!/\bkg\b|\blb\b/.test(noUnit.reason), 'and the wording states no unit nobody chose');
}

/* ── silence where there is nothing to say ──────────────────────────────── */

eq(progressionOffer({ ...base, clientPicked: false }).kind, 'silent',
  'with no client picked there is nobody to have a history');
eq(progressionOffer({ ...base, log: null, status: 'ready' }).kind, 'silent',
  'a read nobody issued draws nothing on every row of the week');

/* ── THE three ways to accuse a client of never having trained ──────────── */

const loading = progressionOffer({ ...base, log: null, status: 'loading' });
eq(loading.kind, 'gap', 'a read in flight says so');
if (loading.kind === 'gap') {
  ok(!/have not logged|never/.test(loading.note), 'and does not claim they have never done it');
}

const failed = progressionOffer({ ...base, log: null, status: 'error' });
eq(failed.kind, 'gap', 'a failed read says so');
if (failed.kind === 'gap') {
  ok(/could not be read/.test(failed.note), 'it names the read');
  ok(!/have not logged/.test(failed.note), 'and does not turn it into a claim about the client');
  ok(/rather than a client with no history/.test(failed.note), 'refusing the collapse in as many words');
}

// The truncated case, which is the one that LOOKS like the honest answer below
// it. The cap drops the OLDEST sessions, so a movement whose last outing is
// older than what came back is silent — and that silence is not evidence.
const truncated = progressionOffer({ ...base, exercise: 'Overhead Press', status: 'partial' });
eq(truncated.kind, 'gap', 'a truncated read with nothing for this movement is a gap');
if (truncated.kind === 'gap') {
  ok(!/have not logged/.test(truncated.note), 'which does not accuse the client');
  ok(/not a statement that they have never done it/.test(truncated.note), 'and says exactly that');
}

// And the one that IS about the client: a whole read holding nothing.
const never = progressionOffer({ ...base, exercise: 'Overhead Press', status: 'ready' });
eq(never.kind, 'gap', 'a whole read with nothing for this movement is a gap too');
if (never.kind === 'gap') {
  ok(/have not logged this movement/.test(never.note), 'and this is the only branch that may say so');
}

// And the one that is about the client and is NOT an absence. A bodyweight
// session has reps and no load, so `suggestNextWeight` finds no top weight and
// returns null — the same null a movement nobody has ever done returns. Both
// fell through to "they have not logged this movement", which is an accusation
// of absence about somebody who did the work.
const bodyweight = progressionOffer({ ...base, exercise: 'Press Up', status: 'ready' });
eq(bodyweight.kind, 'gap', 'a bodyweight session offers no load to build from');
if (bodyweight.kind === 'gap') {
  ok(!/have not logged this movement/.test(bodyweight.note),
    'but it is NOT reported as a movement they have never done — they did it, with nothing on the bar');
  ok(/bodyweight/i.test(bodyweight.note), 'and the note says which of the two it is');
}
// The same session under a truncated read is still not an absence: the newest
// row for the movement came back, so the answer is known.
const bodyweightPartial = progressionOffer({ ...base, exercise: 'Press Up', status: 'partial' });
if (bodyweightPartial.kind === 'gap') {
  ok(/bodyweight/i.test(bodyweightPartial.note),
    'and it outranks the truncation sentence, which would say nothing was logged when something was');
}

// The five gap sentences are five sentences.
const notes = [loading, failed, truncated, never, bodyweight]
  .map((o) => (o.kind === 'gap' ? o.note : ''));
eq(new Set(notes).size, 5, 'the five reasons for no suggestion read as five sentences');

/* ── a truncated read may still ANSWER, because the newest row survives ─── */

// This is the difference from the volume check on the same screen, which
// declines on 'partial'. That one needs the heaviest session ever and the cap
// drops the oldest; this one needs the LAST session, and the read is ordered
// newest first. Truncation can remove the question, never change the answer.
const partialAnswer = progressionOffer({ ...base, status: 'partial', unit: 'kg' });
eq(partialAnswer.kind, 'suggestion', 'the last session is present in a truncated newest-first read');
if (partialAnswer.kind === 'suggestion' && s.kind === 'suggestion') {
  eq(partialAnswer.weightKg, s.weightKg, 'and it is the same answer the whole read gives');
}

/* ── the tap, and when it is not offered ────────────────────────────────── */

eq(loadTapLabel('62.5 kg'), 'Use 62.5 kg', 'the button says what pressing it will do');
// A button reading "Use —" is worse than no button: it promises a value the
// screen has already admitted it cannot render.
eq(loadTapLabel(null), null, 'a load that could not be rendered offers no tap');
eq(loadTapLabel(''), null, 'and neither does an empty one');

/* ── and it is not offered for a value already in the box ───────────────── */

eq(alreadyAt(62.5, 62.5), true, 'the suggestion already in the box needs no button');
eq(alreadyAt(62.5, 62.54), true, 'compared at the resolution the ladder works in');
eq(alreadyAt(62.5, 60), false, 'a different load is a different load');
eq(alreadyAt(62.5, null), false, 'an empty box is not already at anything');
eq(alreadyAt(62.5, undefined), false, 'nor is an absent one');
eq(alreadyAt(62.5, NaN), false, 'nor a value that is not a number');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('builderProgression: ok');
