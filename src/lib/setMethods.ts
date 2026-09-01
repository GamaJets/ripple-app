/**
 * HOW a set is performed — warm-up, drop set, to failure, AMRAP, and the rest.
 *
 * Asked for as "when you tap on the exercise it gives you various ways to do
 * the exercise, we need this — and also add additional ways the exercise is to
 * be performed."
 *
 * ── Why this is a catalogue and not free text ─────────────────────────────
 *
 * A coach writing "drop" in a notes field means something precise to them and
 * nothing to the app: the client's session runner cannot count it, the history
 * cannot compare it, and the rest timer cannot know a drop set has no rest
 * inside it. Naming the methods makes them things the app can act on.
 *
 * ── Why every method carries `countsToVolume` ─────────────────────────────
 *
 * This is the field that stops a lie downstream. A warm-up set is real work a
 * client performs and records, and it is NOT training volume — counting it
 * makes somebody's weekly tonnage jump when they did nothing different. The
 * history and progress screens ask this field rather than guessing from the
 * name, so a method added later cannot quietly start inflating a chart.
 *
 * ── Why `restsAfter` is here ──────────────────────────────────────────────
 *
 * The rest timer (`restTimer.ts`) fires between sets. Inside a drop set or a
 * rest-pause cluster there is deliberately almost no rest — that is what makes
 * it that method — so a 90-second timer starting mid-drop-set is the app
 * instructing the client to do the opposite of the exercise. A method that
 * says `restsAfter: false` suppresses it.
 *
 * `short` is written as a NUMBER of seconds rather than a flag so the timer
 * has something to count; 15 seconds is the rest-pause convention and is
 * stated here rather than buried in the runner.
 */

export type SetMethod = {
  /** Stored value. Stable — programmes on people's phones hold these. */
  id: string;
  /** What the coach and client read. Sentence case, per the house rule. */
  label: string;
  /** One or two characters for the badge on a set row. */
  short: string;
  /** What it actually means, shown when the coach is choosing. */
  blurb: string;
  /** Whether the work counts toward training volume. See above. */
  countsToVolume: boolean;
  /**
   * Rest after this set: `true` = the exercise's own rest, `false` = none
   * (the method continues), or a number of seconds that overrides it.
   */
  restsAfter: boolean | number;
};

/**
 * The catalogue, in the order a coach meets them. `normal` first because it is
 * the answer for most sets and the default; the four in the middle are the
 * ones the other app offers; the rest are the "additional ways" asked for.
 */
export const SET_METHODS: readonly SetMethod[] = [
  {
    id: 'normal', label: 'Normal', short: '·',
    blurb: 'A straight working set.',
    countsToVolume: true, restsAfter: true,
  },
  {
    id: 'warmup', label: 'Warm-up', short: 'W',
    blurb: 'Light preparation. Not counted as training volume.',
    countsToVolume: false, restsAfter: true,
  },
  {
    id: 'failure', label: 'To failure', short: 'F',
    blurb: 'Keep going until another clean rep is not possible.',
    countsToVolume: true, restsAfter: true,
  },
  {
    id: 'drop', label: 'Drop set', short: 'D',
    blurb: 'At failure, cut the weight and continue with no rest.',
    countsToVolume: true, restsAfter: false,
  },
  {
    id: 'amrap', label: 'As many reps as possible', short: 'A',
    blurb: 'One set, every clean rep you have. The rep target is a floor.',
    countsToVolume: true, restsAfter: true,
  },
  {
    id: 'restpause', label: 'Rest-pause', short: 'RP',
    blurb: 'At failure, rest fifteen seconds and squeeze out more reps.',
    countsToVolume: true, restsAfter: 15,
  },
  {
    id: 'cluster', label: 'Cluster', short: 'C',
    blurb: 'The reps broken into small bunches with seconds between them.',
    countsToVolume: true, restsAfter: 15,
  },
  {
    id: 'tempo', label: 'Tempo', short: 'T',
    blurb: 'Each rep held to a counted speed. Slower than it feels.',
    countsToVolume: true, restsAfter: true,
  },
  {
    id: 'eccentric', label: 'Eccentric', short: 'E',
    blurb: 'The lowering half done slowly, often with help on the way up.',
    countsToVolume: true, restsAfter: true,
  },
  {
    id: 'isometric', label: 'Isometric hold', short: 'I',
    blurb: 'Held still under load. The reps column is seconds.',
    countsToVolume: true, restsAfter: true,
  },
  {
    id: 'backoff', label: 'Back-off', short: 'B',
    blurb: 'A lighter set after the heavy work, for extra quality reps.',
    countsToVolume: true, restsAfter: true,
  },
  {
    id: 'cooldown', label: 'Cool-down', short: 'CD',
    blurb: 'Easy work to finish. Not counted as training volume.',
    countsToVolume: false, restsAfter: true,
  },
];

export const DEFAULT_METHOD = 'normal';

const BY_ID = new Map(SET_METHODS.map((m) => [m.id, m]));

/**
 * The method for a stored id. An id this build does not know — a programme
 * written by a NEWER app and opened on an older one — falls back to `normal`
 * rather than to nothing, because "we do not recognise this" must not become a
 * set the client cannot see. `known` says which happened, so a caller can
 * decline to overwrite what it did not understand.
 */
export function methodFor(id: string | null | undefined): { method: SetMethod; known: boolean } {
  const found = id ? BY_ID.get(id) : undefined;
  if (found) return { method: found, known: true };
  return { method: BY_ID.get(DEFAULT_METHOD)!, known: false };
}

/** Whether a set recorded under this method counts toward training volume. */
export function countsToVolume(id: string | null | undefined): boolean {
  return methodFor(id).method.countsToVolume;
}

/**
 * How long to rest after a set of this method, given the exercise's own rest.
 * Returns 0 when the method continues without rest.
 */
export function restAfter(id: string | null | undefined, exerciseRestSec: number): number {
  const { method } = methodFor(id);
  if (method.restsAfter === false) return 0;
  if (method.restsAfter === true) return Math.max(0, Math.round(exerciseRestSec));
  return method.restsAfter;
}

/**
 * The badge for a set row, or null for an ordinary set. Null rather than "·"
 * so a programme of plain sets is not covered in markers that all say the same
 * thing — the badge should mean "this one is different".
 */
export function badgeFor(id: string | null | undefined): { short: string; label: string } | null {
  // No `known` check: an unrecognised id already resolves to the default
  // method, so the line below catches it. A mutation test proved the extra
  // condition could be deleted without changing a single result.
  const { method } = methodFor(id);
  if (method.id === DEFAULT_METHOD) return null;
  return { short: method.short, label: method.label };
}
