// Starting today from a session you have already done.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// Train can start a session from exactly one place: the programme day. For a
// member with a coach that is the coach's day, and for a solo member it is
// whatever `buildProgram` generated for that weekday — the same four movements
// every Tuesday for ever. Every other lifting app in the world lets somebody
// open last Thursday and do it again, and the data to do it has been sitting in
// `workouts` the whole time: this screen already reads the entire log to draw
// history, records, tonnage and the month calendar.
//
// So no schema changes anything here. What is needed is a conversion, and the
// conversion is the whole of the difficulty.
//
// ── A logged set and a planned set are not the same fact ───────────────────
//
// A `WorkoutEntry` is TESTIMONY. Somebody stood in a gym, did a thing, and
// wrote down what happened: eight reps at 42.5, then eight, then six. A
// `ProgramExercise` is an INSTRUCTION. It is what somebody is being asked to
// do, written before it happened, usually by a coach.
//
// Turning one into the other is therefore not a cast. Every field of the plan
// shape that this file cannot honestly fill from the log is left ABSENT, and
// the list of what it refuses to fill is longer than the list of what it fills:
//
//   `method`      A logged set does not say whether it was a warm-up, a drop
//                 set or a cluster. `setMethods` changes what a set is worth in
//                 tonnage and whether a rest timer runs at all, and inventing
//                 one would change both for a session nobody described that
//                 way.
//   `rpe`         `feel` — 'easy' / 'ok' / 'hard' — is RIGHT THERE on the entry
//                 and is the single most tempting thing in this file, and it is
//                 the one conversion this app never makes. src/lib/programs.ts
//                 says it outright on the field itself: `feel` is the client's
//                 own report after the set and it is evidence; `rpe` is an
//                 instruction written before the set by somebody who was not
//                 there. Mapping 'hard' to an 8 would let a member's account of
//                 their own session come back at them as a prescription, which
//                 is the one direction this app never lets data flow.
//   `note`        The coach's voice, attributed as such everywhere it is drawn.
//                 Nothing the app generates goes in it.
//   `restSec`     Nobody timed the rests. `restSecondsFor` already knows how to
//                 turn an absent value into a usable one and says which it is.
//   `pct1rm`,
//   `tempo`       Never recorded by any log path.
//   `setGroupId`  A superset is the COACH'S pairing of adjacent movements. The
//                 log records the order sets were written in and nothing about
//                 why, so a repeated session has no groups — which `groupRuns`
//                 reads as "these movements stand on their own", the truth.
//
// ── The three shapes of a set ──────────────────────────────────────────────
//
// `sets[i]` is `[reps, kg]` and NEITHER number means one thing:
//
//   ordinary      reps, and the kilograms on the machine
//   bodyweight    `bw[i] === true` — reps, and what was ADDED to the body
//                 (0 for a plain pull-up, 20 for one with a belt)
//   timed         `timed[i] === true` — SECONDS held, and the load
//
// See src/lib/bodyweightSets.ts and src/lib/timedSets.ts, which own those two
// flags and say at length why neither is inferred from a stored zero.
//
// A hold converts to a prescription written in time — `'45 sec'`, the exact
// spelling `buildProgram` already writes and `prescribedSeconds` already reads
// — so the runner opens on a hold box rather than a reps box. `holdLabel` is
// deliberately NOT used for this: it prints 90 seconds as `1:30`, which
// `prescribedSeconds` cannot read back, and a plank prescribed as `1:30` would
// open a runner asking for one and a half repetitions.
//
// A bodyweight set converts to a plan row with NO LOAD, and that is a loss
// taken on purpose. The plan shape has no bodyweight flag — `ProgramExercise`
// carries `loadKg` and nothing else — so the only two things this file could do
// with a belted dip at 20 kg are to write 20 into `loadKg`, where it is
// indistinguishable from 20 kg on a machine and would be priced as such by
// every tonnage and every 1RM estimate downstream, or to write nothing. It
// writes nothing, and `bodyweightSets` in the result is how many sets that
// happened to, so the screen can say so instead of the member noticing an empty
// load box and wondering.
//
// ── Sets that were not done ────────────────────────────────────────────────
//
// The brief for this work asked what happens to a set that was "logged but
// skipped". Nothing, because there is no such set: `buildEntries` in
// app/(client)/workouts.tsx writes an entry only for an exercise with at least
// one set typed against it, and a set that was not done is not written at all.
// A session where somebody did two of four planned sets and went home is four
// planned sets in the programme and TWO SETS in the log, and the difference is
// not recoverable from the log because the plan is not in it.
//
// So this file converts what is recorded and refuses to pad. Repeating that
// session offers two sets. It does not offer four, because four would be this
// app prescribing two sets nobody has evidence anybody did — and a member who
// repeats a session they cut short and is handed the full version has been told
// something untrue about their own history by the screen whose whole job is
// showing it back to them.
//
// The same rule settles "logged at a different weight than planned". The log is
// what was on the machine. Where the loads differ set to set — a ramp, a
// back-off, a set where the rack was taken and they went lighter — the rows
// carry each one and `setRows` is what the runner, the ring and the row summary
// all read. Nothing here compares against a plan, because the plan is a
// different fact and this function is not given one.
//
// ── A movement the app can no longer identify ──────────────────────────────
//
// Real and ordinary: a trainer types any exercise they like into the builder, a
// member types any exercise they like into "Add an Exercise You Did", coaches
// change programmes, and a name logged in March may match nothing today.
//
// It is NOT dropped. The member did it, it is in their history, and a repeat
// list quietly two movements short is the app editing somebody's training. It
// comes through with its name intact and its sets intact; what it loses is the
// muscle group, which is a fact about the catalogue rather than about the set,
// and it is named in `unknown` so the screen can say which ones.
//
// And `known` is allowed to be null, which means NOBODY LOOKED. A screen that
// has not read a catalogue has not learned that every movement is missing from
// it, so `identified` is false in that case and `unknown` is empty — the same
// distinction src/ui/loadStatus.ts draws everywhere else in this app.
import type { WorkoutEntry } from './mockData';
import type { ProgramExercise } from './programs';
import type { SetRow } from './setRows';
import { isBodyweightSet } from './bodyweightSets';
import { isTimedSet } from './timedSets';
import { exerciseSlug, findExercise, type ExerciseRef } from './exerciseId';
import { dayKeyOf } from './entryEdit';

/**
 * What a repeated movement's key looks like.
 *
 * Its own prefix, and deliberately not `custom-`: that one is how
 * app/(client)/workouts.tsx recognises a row the member added to their PLAN,
 * and it offers a delete that writes to `customEx` through `usePlanEdits`. A
 * repeated movement is not in anybody's plan and must never be mistaken for
 * one.
 */
const REPEAT_KEY_PREFIX = 'repeat-';

/**
 * The group a repeated movement carries when the catalogue does not name one.
 *
 * `ProgramExercise.group` is a required string and is drawn as the first thing
 * under the movement in the runner's header, so '' renders as a stray
 * separator. `customEx` already sets 'Added' for exactly this reason — the
 * field doubles as a provenance label when no muscle group is known — and this
 * follows it. It is a word, not a muscle: `injuryFlag` compares it against
 * injury areas and matches none, and the movement is still caught by NAME,
 * which is the half of that check that works on anything.
 */
const REPEATED_GROUP = 'Repeated';

/** One session in the log: every entry that shares an instant. */
export interface PastSession {
  /** The instant the entries share. This is the session's identity. */
  t: string;
  /** The local calendar day it falls on, `YYYY-MM-DD`, or null when `t` cannot
   *  be read. Built by `dayKeyOf`, so a 21:00 session in a UTC+2 gym is on the
   *  day it was actually done. */
  day: string | null;
  /** The entries, in the order the log holds them. */
  entries: WorkoutEntry[];
  /** How many movements carry at least one recorded set. */
  movements: number;
  /** How many sets were recorded across them. */
  sets: number;
}

/**
 * The log split into sessions, newest first.
 *
 * Grouped on `t` EXACTLY. One guided session writes every one of its exercises
 * with a single timestamp (`buildEntries` takes `nowISO` once), so the instant
 * is what makes those rows one session; two sessions on one day are two
 * sessions and are offered as two, because they were.
 *
 * Sessions with nothing to repeat are left out: a cardio row carries no sets,
 * and offering "repeat this" against a bike ride would open the barbell runner
 * on nothing. The lifts in a MIXED session still come through, and the bike
 * ride inside it is reported by `repeatSession` rather than disappearing.
 *
 * `null` is accepted and returns an empty list, and the caller must not draw
 * "you have never trained" off it: an unread log is not an empty one. The Train
 * screen gates the control on `workoutLogStatus` for that reason.
 */
export function loggedSessions(log: readonly WorkoutEntry[] | null): PastSession[] {
  if (!Array.isArray(log)) return [];
  const by = new Map<string, PastSession>();
  for (const e of log) {
    if (!e || typeof e.t !== 'string' || !e.t) continue;
    let s = by.get(e.t);
    if (!s) { s = { t: e.t, day: dayKeyOf(e.t), entries: [], movements: 0, sets: 0 }; by.set(e.t, s); }
    s.entries.push(e);
    const n = Array.isArray(e.sets) ? e.sets.length : 0;
    if (n > 0) { s.movements += 1; s.sets += n; }
  }
  return [...by.values()]
    .filter((s) => s.movements > 0)
    // Newest first, by the INSTANT. `t` is a full timestamp — never a bare
    // `YYYY-MM-DD`, which this codebase compares as a string and never parses —
    // so parsing it is the right reading and is what makes two sessions an hour
    // apart sort correctly. One that will not parse sorts last rather than
    // throwing the whole list into an arbitrary order.
    .sort((a, b) => {
      const ta = Date.parse(a.t); const tb = Date.parse(b.t);
      const va = Number.isFinite(ta); const vb = Number.isFinite(tb);
      if (va && vb) return tb - ta;
      if (va) return -1;
      if (vb) return 1;
      return 0;
    });
}

/** "3 movements · 11 sets", for the row in the picker. */
export function sessionSummary(s: PastSession): string {
  return `${s.movements} movement${s.movements === 1 ? '' : 's'} · ${s.sets} set${s.sets === 1 ? '' : 's'}`;
}

/** A movement that came out of the log and the reason it could not be run. */
export interface RepeatSkip {
  /** The name as it was logged, or '' when the entry carried none. */
  exercise: string;
  /** What to tell the member. A sentence, because it is read as one. */
  reason: string;
}

/** What a past session becomes, and everything that was lost on the way. */
export interface RepeatConversion {
  /** The movements, in the order they were logged, ready for the runner. */
  exercises: ProgramExercise[];
  /** Movements kept whose name matched nothing in `known`. Never dropped —
   *  they are in `exercises` too. Empty when `identified` is false, where it
   *  means nothing at all. */
  unknown: string[];
  /** Whether a catalogue was supplied to check against. False means nobody
   *  looked, which is not the same as everything being found. */
  identified: boolean;
  /** How many sets came through with no load because they were the member's own
   *  bodyweight. The plan shape cannot say "your body", so the screen says it
   *  instead. */
  bodyweightSets: number;
  /** Sets whose numbers could not be read at all. Counted, never guessed at. */
  unreadableSets: number;
  /** Movements that could not be offered, with the reason for each. */
  skipped: RepeatSkip[];
}

/**
 * One past session, as a list the guided runner can be handed.
 *
 * @param entries the entries of ONE session — every row sharing an instant.
 * @param known the movements the app can still identify, or null when no
 *   catalogue was read. Only ever used to fill a muscle group and to say which
 *   names are no longer recognised; a movement is never withheld for being
 *   absent from it.
 */
export function repeatSession(
  entries: readonly WorkoutEntry[] | null,
  known: readonly ExerciseRef[] | null,
): RepeatConversion {
  const out: ProgramExercise[] = [];
  const unknown: string[] = [];
  const skipped: RepeatSkip[] = [];
  let bodyweightSets = 0;
  let unreadableSets = 0;
  const identified = Array.isArray(known);

  const list = Array.isArray(entries) ? entries : [];
  list.forEach((e, j) => {
    if (!e) return;
    const name = String(e.exercise ?? '').trim();
    if (!name) {
      skipped.push({ exercise: '', reason: 'This one was logged without a movement name, so there is nothing to repeat.' });
      return;
    }
    // `unknown[]` on purpose. The declared type is `[number, number][]`, and
    // this is a jsonb column read back off a server — the declaration is what
    // the app writes, not a guarantee about what is there. Typing it as what it
    // is forces every read below through a check.
    const raw: unknown[] | null = Array.isArray(e.sets) ? (e.sets as unknown[]) : null;
    if (!raw || raw.length === 0) {
      skipped.push({
        exercise: name,
        reason: e.cardio
          ? 'This was cardio. Start it from the Cardio tab, where its own timer is.'
          : 'No sets were recorded against this one, so there is nothing to repeat.',
      });
      return;
    }

    const rows: SetRow[] = [];
    raw.forEach((s, i) => {
      // A jsonb column can hold anything, and this one has held rows written by
      // six different builds. A set that is not a readable pair is COUNTED and
      // skipped — never coerced, because `Number(undefined)` is NaN and
      // `parseFloat` of a wrong shape is a figure nobody typed.
      const pair = Array.isArray(s) ? s : null;
      const first = pair && Number.isFinite(Number(pair[0])) ? Number(pair[0]) : null;
      if (first == null || first <= 0) { unreadableSets += 1; return; }
      const timed = isTimedSet(e, i);
      const bw = isBodyweightSet(e, i);
      // Verbatim, not rounded. The figure in the log is what somebody typed,
      // and a 10.5 rounded to 10 here is a rep nobody did. `readRepSpan`
      // returns null for anything that is not a count or a range, which is the
      // honest answer and is already what every reader of it expects.
      //
      // ' sec' and never `holdLabel` — see the header. This spelling is the one
      // `buildProgram` writes and the one `prescribedSeconds` reads back, so
      // the runner opens the hold box on the hold it was given.
      const reps = timed ? `${first} sec` : String(first);
      const kg = pair && Number.isFinite(Number(pair[1])) ? Number(pair[1]) : null;
      if (bw) bodyweightSets += 1;
      // Three readings of the second number, and only one of them is a load:
      //
      //   · a bodyweight set's is what was ADDED to the body, and the plan
      //     shape cannot hold "the body" to add it to — so no load;
      //   · a stored 0 on an ordinary set is the ambiguous zero
      //     src/lib/bodyweightSets.ts was written about — either a bodyweight
      //     set from before the flag existed or an empty box — so no load;
      //   · anything above zero is kilograms and is carried through as it is.
      //
      // `loadKg` is PRESENT and null rather than absent in the first two cases,
      // which `expandSets` reads as "this row has nothing on the bar" instead of
      // "this row follows the exercise". Every row says its own load, which is
      // the entire point of carrying a table rather than a single number.
      const loadKg = bw ? null : (kg != null && kg > 0 ? kg : null);
      rows.push({ reps, loadKg });
    });

    if (rows.length === 0) {
      skipped.push({ exercise: name, reason: 'The sets recorded against this one could not be read, so it is not offered.' });
      return;
    }

    const ref = identified ? findExercise(name, known as ExerciseRef[]) : null;
    if (identified && !ref) unknown.push(name);

    out.push({
      // Indexed as well as slugged: one session can hold the same movement
      // twice — a member who logged their squats, then their accessories, then
      // came back to squats — and two exercises with one key would collide in
      // `logged`, in `expanded` and in the runner's own per-exercise state.
      key: `${REPEAT_KEY_PREFIX}${j}-${exerciseSlug(name) || 'movement'}`,
      // The name EXACTLY as it was logged. It is the identity, not a label:
      // it is what `suggestForExercise` and `priorBest1RM` look a record up by,
      // what the video library resolves against, and what gets written back
      // into `exercise` when this session is logged. A tidied name is a
      // different movement to every one of them.
      name,
      group: ref?.group || REPEATED_GROUP,
      // One fact, two homes — src/lib/setRows.ts. Every reader counts progress
      // against `sets` and none of them knows the table exists, so they are
      // written together.
      sets: rows.length,
      // The exercise's own fallback is the FIRST row's, which is the set the
      // movement opens on. Same rule the member's own plan correction uses in
      // app/(client)/workouts.tsx, and for the same reason: the collapsed row,
      // the suggestion and the runner header all read these two and have never
      // heard of a table.
      reps: String(rows[0].reps ?? ''),
      loadKg: rows[0].loadKg ?? null,
      // Nothing. Alternatives are the coach's list of movements that train the
      // same thing, and the log records none — so the runner's Swap is not
      // offered, which is correct: there is nothing to swap to.
      alternatives: [],
      setRows: rows,
    });
  });

  return { exercises: out, unknown, identified, bodyweightSets, unreadableSets, skipped };
}
