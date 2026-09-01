// "Have I trained legs this week?"
//
// ── The hole this closes ───────────────────────────────────────────────────
//
// It is the first question anybody asks of a training history, and nothing in
// this app could answer it. Trends charts weekly tonnage and a per-exercise
// estimated 1RM; History charts months; Records is a best per movement. All of
// them are about a LIFT or about a TOTAL, and none of them is about the body.
// `WorkoutEntry` has no muscle group on it and nothing in src/lib computed sets
// or volume per muscle, so a member could train quads four times a fortnight
// and never once touch a hamstring, and every screen in the product would show
// a rising line.
//
// ── Why the join, and not a column ─────────────────────────────────────────
//
// The obvious fix is a `group` on the workout row. It is the wrong one twice
// over. It would answer nothing about the training already logged — every row
// in every account would carry a null for ever, so the screen would open empty
// for the people with the most to look at. And it would be a SECOND opinion
// about which muscle a movement trains, written by whichever screen logged the
// set, diverging from the catalogue the moment a coach corrected a row.
//
// The catalogue already carries `muscle_group` per movement and
// `useExerciseCatalogue` already reads it for the library. So this is a join,
// keyed on `exerciseSlug` — the app's one answer to "are these the same
// movement" — and it works retroactively over everything anybody has ever
// logged.
//
// ── What it must never do ──────────────────────────────────────────────────
//
// Say "you have not trained legs" when the truth is "we could not read the
// catalogue", and say "you have not trained legs" when the truth is "you logged
// Bulgarian split squats under a name the catalogue has never heard of". Both
// are the LoadStatus rule arriving by a side door: an empty bucket under a
// failed read is UNKNOWN, and a movement that could not be resolved is not
// evidence about any muscle.
//
// So `unmatched` is part of the answer rather than a diagnostic. A member with
// four unmatched movements in the week is owed the sentence naming them, not a
// board that quietly leaves them out — the same argument src/lib/bodyweightSets
// makes about a tonnage that could not price every set.
import type { WorkoutEntry } from './mockData';
import { exerciseSlug } from './exerciseId';
import { entryTonnage, type BodyweightHistory } from './bodyweightSets';
import { isTimedSet } from './timedSets';

/** What the join needs from a catalogue row. Declared structurally rather than
 *  imported from src/ui/exerciseDetail.ts, which pulls in React and Supabase —
 *  this file has to run under plain node for its test. A `CatalogueRow`
 *  satisfies it. */
export interface GroupedExercise {
  /** The catalogue's id, which IS the slug. */
  id: string;
  name: string;
  group: string | null;
}

/** One muscle group's fortnight, or week, or whatever window was handed in. */
export interface MuscleWork {
  /** As the catalogue spells it: 'Legs', 'Back', 'Chest'. */
  group: string;
  /** Sets performed. Warm-ups are in here: this board is about what the body
   *  was asked to do, and a warm-up set of squats is still the quads being
   *  loaded. Tonnage is where the method matters, and tonnage is separate. */
  sets: number;
  /** Σ reps × load in kilograms over the sets whose load is known; null, never
   *  0, when none of them is. */
  volumeKg: number | null;
  /** Sets whose load could not be known, so they are not in `volumeKg` — a
   *  bodyweight set with no weigh-in behind it. */
  unpricedSets: number;
  /** Distinct movements that landed in this group, most recent first. */
  exercises: string[];
  /** The most recent day, `YYYY-MM-DD`, this group was trained. */
  lastDay: string | null;
}

export interface MuscleBoard {
  /** Most sets first. A group with nothing in it is ABSENT rather than present
   *  with a zero: over a one-week window that would list every muscle in the
   *  catalogue as a row of noughts, and "0 sets" reads as a measurement when it
   *  is usually just a week. `untrained` is where the genuinely empty ones go,
   *  and only when the read can support the claim. */
  groups: MuscleWork[];
  /**
   * Catalogue groups with nothing logged against them in the window, or null
   * when that cannot be stated.
   *
   * Null under anything but a whole catalogue read, because "you have not
   * trained your back" is a claim about a list we would have to have read
   * completely to make. This is the one figure on the board that asserts an
   * ABSENCE, so it is the one that has to be withheld the moment the read is
   * anything less than certain.
   */
  untrained: string[] | null;
  /**
   * Movements in the window that no catalogue row matched, by the name they
   * were logged under.
   *
   * Not an error and usually not a mistake: a coach can write any exercise
   * they like, and a member can type one in. They are work that happened and
   * that this board cannot file, and a screen has to say so — otherwise the
   * board understates the week and looks complete doing it.
   */
  unmatched: string[];
  /** Sets inside `unmatched`, so the sentence can be about work rather than
   *  about names. */
  unmatchedSets: number;
}

export const EMPTY_BOARD: MuscleBoard = { groups: [], untrained: null, unmatched: [], unmatchedSets: 0 };

/** The local calendar day an instant falls on. Matches `dayKey` in ./streaks.ts
 *  for the reason given there: an evening session in a UTC+2 gym belongs to the
 *  evening, not to tomorrow. */
const dayOf = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Work per muscle group over a window.
 *
 * `sinceMs` is inclusive and `nowMs` exclusive of nothing — an entry logged
 * this second counts. An entry whose timestamp will not parse is left out
 * entirely rather than filed under today, which is the defect
 * src/lib/ownTraining.ts documents.
 *
 * `catalogueWhole` is whether the catalogue read landed complete. It decides
 * one thing and one thing only: whether `untrained` may be stated at all.
 */
export function muscleBoard(
  log: readonly WorkoutEntry[],
  catalogue: readonly GroupedExercise[],
  opts: {
    sinceMs: number;
    nowMs?: number;
    history?: BodyweightHistory;
    catalogueWhole?: boolean;
  },
): MuscleBoard {
  const { sinceMs, nowMs = Date.now(), history = [], catalogueWhole = false } = opts;
  const bySlug = new Map<string, GroupedExercise>();
  const allGroups = new Set<string>();
  for (const row of catalogue) {
    if (!row || typeof row.id !== 'string' || !row.id) continue;
    bySlug.set(row.id, row);
    const g = (row.group || '').trim();
    if (g) allGroups.add(g);
  }

  const work = new Map<string, MuscleWork>();
  const unmatched = new Map<string, number>();
  let unmatchedSets = 0;

  for (const e of log) {
    if (!e || typeof e.t !== 'string') continue;
    const ms = Date.parse(e.t);
    if (!Number.isFinite(ms) || ms < sinceMs || ms > nowMs) continue;
    // Sets, not cardio. A run has no muscle group in the catalogue's sense and
    // filing it under one would be this file inventing the very opinion its
    // header refuses to hold.
    if (!e.sets?.length) continue;
    // A held set loaded the muscle and is counted as a set, but it carries no
    // tonnage — see src/lib/timedSets.ts. `entryTonnage` already knows that, so
    // the count is the only thing this line has to be careful about.
    const setCount = e.sets.filter((s, i) => (s?.[0] ?? 0) > 0 || isTimedSet(e, i)).length;
    if (setCount <= 0) continue;
    const slug = exerciseSlug(e.exercise || '');
    const row = slug ? bySlug.get(slug) : undefined;
    const group = (row?.group || '').trim();
    if (!group) {
      const name = (e.exercise || '').trim() || 'Unnamed';
      unmatched.set(name, (unmatched.get(name) ?? 0) + setCount);
      unmatchedSets += setCount;
      continue;
    }
    const day = dayOf(e.t);
    const t = entryTonnage(e, history);
    const cur = work.get(group);
    if (!cur) {
      work.set(group, {
        group,
        sets: setCount,
        volumeKg: t.kg > 0 ? Math.round(t.kg) : null,
        unpricedSets: t.unknownSets,
        exercises: [e.exercise],
        lastDay: day || null,
      });
      continue;
    }
    cur.sets += setCount;
    if (t.kg > 0) cur.volumeKg = Math.round((cur.volumeKg ?? 0) + t.kg);
    cur.unpricedSets += t.unknownSets;
    if (!cur.exercises.includes(e.exercise)) cur.exercises.push(e.exercise);
    if (day && (cur.lastDay == null || day > cur.lastDay)) cur.lastDay = day;
  }

  const groups = [...work.values()].sort((a, b) =>
    b.sets - a.sets || (b.volumeKg ?? 0) - (a.volumeKg ?? 0) || a.group.localeCompare(b.group));

  return {
    groups,
    untrained: catalogueWhole
      ? [...allGroups].filter((g) => !work.has(g)).sort((a, b) => a.localeCompare(b))
      : null,
    unmatched: [...unmatched.keys()].sort((a, b) => (unmatched.get(b) ?? 0) - (unmatched.get(a) ?? 0) || a.localeCompare(b)),
    unmatchedSets,
  };
}

/**
 * What to say about the movements this board could not file, or null when
 * there are none.
 *
 * One sentence, one place, and it names the count of SETS rather than of
 * names: "4 sets" is the size of the hole in the board, and "2 movements" is
 * not.
 */
export function unmatchedNote(board: MuscleBoard): string | null {
  if (!board.unmatched.length) return null;
  const n = board.unmatchedSets;
  const named = board.unmatched.slice(0, 3).join(', ');
  const more = board.unmatched.length > 3 ? `, and ${board.unmatched.length - 3} more` : '';
  return `${n} set${n === 1 ? '' : 's'} are not in this — ${named}${more} ${board.unmatched.length === 1 ? 'is' : 'are'} not in the exercise catalogue, so we cannot say which muscle ${board.unmatched.length === 1 ? 'it' : 'they'} worked.`;
}
