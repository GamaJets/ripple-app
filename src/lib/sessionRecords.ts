// Which movements in a logged session set a personal record AT THE TIME.
//
// The live runner already announces a record the moment a set beats the
// member's previous best estimated 1RM (src/ui/WorkoutLogger.tsx, through
// `priorBest1RM` and the app's one Epley in src/lib/streaks.ts). This is the
// same judgement read back afterwards, for History and the share card, plus
// the second kind of record a lifter counts: the heaviest load ever on the bar.
//
// "At the time" means against entries performed strictly BEFORE the session,
// not against the whole log: a later, heavier session must not un-record an
// earlier one. A movement with no earlier loaded set is a first, not a record,
// so a member's first week is not a wall of trophies. Bodyweight sets and holds
// never count, for the reasons the runner's own comment gives.
import { est1RM } from './streaks';
import { isTimedSet } from './timedSets';
import { isBodyweightSet } from './bodyweightSets';
import type { WorkoutEntry } from './mockData';

export interface SessionRecord {
  exercise: string;
  /** 'e1rm' beats the best estimated 1RM; 'load' beats only the heaviest weight. */
  kind: 'e1rm' | 'load';
  kg: number;
  reps: number;
}

interface Best { e1: number; load: number; e1Set: [number, number] | null; loadSet: [number, number] | null }

function bestOf(entries: readonly WorkoutEntry[]): Map<string, Best> {
  const out = new Map<string, Best>();
  for (const e of entries) {
    if (!e?.sets) continue;
    for (let i = 0; i < e.sets.length; i++) {
      if (isTimedSet(e, i) || isBodyweightSet(e, i)) continue;
      const [r, w] = e.sets[i];
      if (!(r > 0) || !(w > 0)) continue;
      const b = out.get(e.exercise) ?? { e1: 0, load: 0, e1Set: null, loadSet: null };
      const e1 = est1RM(w, r);
      if (e1 > b.e1) { b.e1 = e1; b.e1Set = [r, w]; }
      if (w > b.load || (w === b.load && b.loadSet && r > b.loadSet[0])) { b.load = w; b.loadSet = [r, w]; }
      out.set(e.exercise, b);
    }
  }
  return out;
}

/** The heaviest loaded, repped set of a movement in a log; 0 when none. */
export function priorTopLoad(log: readonly WorkoutEntry[], exerciseName: string): number {
  return bestOf(log.filter((e) => e?.exercise === exerciseName)).get(exerciseName)?.load ?? 0;
}

/** Records set in the session saved at `at` (the shared `performed_at`). */
export function sessionRecords(log: readonly WorkoutEntry[], at: string): SessionRecord[] {
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return [];
  const mine = log.filter((e) => e?.t === at);
  const before = log.filter((e) => e?.t !== at && Date.parse(e?.t) < atMs);
  const prior = bestOf(before);
  const out: SessionRecord[] = [];
  for (const [name, b] of bestOf(mine)) {
    const p = prior.get(name);
    if (!p) continue;
    if (b.e1 > p.e1 && b.e1Set) out.push({ exercise: name, kind: 'e1rm', kg: b.e1Set[1], reps: b.e1Set[0] });
    else if (b.load > p.load && b.loadSet) out.push({ exercise: name, kind: 'load', kg: b.loadSet[1], reps: b.loadSet[0] });
  }
  return out;
}
