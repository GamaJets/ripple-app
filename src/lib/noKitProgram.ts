// A week for somebody who has nothing to train with.
//
// Asked for twice, the second time as the shape it had to take: "also need to
// be able to create a work out program when a user has no equipment available
// to use", then "there needs to be a way to select no equipment available as an
// option in order to build a work out program". So it is a control the coach
// picks, and this is what the control runs.
//
// ── Why this reads the catalogue and `buildProgram` does not ──────────────
//
// `buildProgram` in ./programs.ts writes three days of named movements out of
// its own source: Bench Press, Lat Pulldown, Cable Crunch, Seated Row. Every
// one of them is a bar, a stack or a machine. There is no version of that
// function with the kit taken out, because the movements ARE the function.
//
// The 183 rows that need no kit are in `public.exercises`, so the generator has
// to be handed the catalogue. The caller passes the rows it already has on
// screen; nothing here reads, so nothing here can be wrong about whether the
// read succeeded — an empty `rows` produces an empty `days` and a coverage
// report that says the pool was empty, and the screen decides what that means.
// A failed catalogue read must never arrive here as "the gym has no bodyweight
// exercises".
//
// ── What it cannot do, which is the part that goes on the screen ──────────
//
// Counted against the live table: the no-kit pool is Full body 56, Core 50,
// Legs 17, Chest 16, Back 14, Shoulders 12, Glutes 8, Hamstrings 6, Lower back
// 3, Arms 1, Calves 0.
//
// Arms has ONE movement and Calves has NONE. A no-kit week therefore cannot be
// balanced the way an equipped one can, and there are exactly two dishonest
// ways to hide that: invent a movement that is not in the catalogue, or drop
// the group and say nothing. `coverage` is the third option — the program
// carries the list of what it could not cover, `noKitCoverageNote` says it in
// words, and the builder prints that sentence beside the week it generated.
//
// ── The group vocabulary is not written down here ─────────────────────────
//
// Which groups a balanced week owes you is read from the rows passed in, not
// from a list in this file. That matters for Calves specifically: the pool
// holds nothing for it, so a pool-derived list would not know the group exists
// and the omission would be invisible. The groups come from the WHOLE
// catalogue and the pool is measured against them, which is how a zero gets
// reported as a zero rather than as an absence.
import { needsNoKit, type KitRow } from './equipmentFacet';
import { exerciseSlug } from './exerciseId';
import type { Program, ProgramDay, ProgramExercise } from './programs';
import { WEEK_DAYS } from './weekStart';

/** A catalogue row, as much of one as this needs. Structurally a subset of
 *  `CatalogueRow` in src/ui/exerciseDetail.ts, so a screen passes its rows
 *  straight in. */
export interface NoKitRow extends KitRow {
  name: string;
  /** `exercises.muscle_group`. Null where the catalogue does not place it. */
  group: string | null;
  /** `exercises.category` — 'stretching' on 58 of the 183, which are prescribed
   *  as a hold rather than as repetitions. Absent is fine; it only downgrades
   *  a stretch to ordinary reps, never the other way. */
  category?: string | null;
}

export interface NoKitCoverage {
  /** How many movements in the catalogue need no equipment at all. */
  poolSize: number;
  /** Groups the catalogue HAS that the no-kit pool cannot fill at all. */
  missing: string[];
  /** Groups the pool is too short on to train properly: either the catalogue
   *  holds exactly one no-equipment movement for them, so there is nothing to
   *  alternate with, or the week asks for the group more often than the pool
   *  can answer and a movement comes round twice. `options` is what the
   *  catalogue actually holds, never rounded up. */
  thin: { group: string; options: number }[];
  /** No-kit movements the catalogue does not place on the body. They are in
   *  the pool and not in the week, and that is stated rather than swallowed. */
  unplaced: number;
}

export interface NoKitPlan {
  program: Program;
  coverage: NoKitCoverage;
}

/** Sets and reps for a movement nobody can load. Prescriptions, like every
 *  figure `buildProgram` writes — not facts read off the row. A stretch is a
 *  hold, in the spelling `prescribedSeconds` already reads (see
 *  src/lib/timedSets.ts); everything else is a rep range. */
const isStretch = (r: NoKitRow) => /stretch/i.test(String(r.category || ''));
const setsFor = (r: NoKitRow) => (isStretch(r) ? 2 : 3);
const repsFor = (r: NoKitRow) => (isStretch(r) ? '30 sec' : '10-15');

/** Evenly spread across the week, and always inside it. Three days land on the
 *  first, third and sixth weekday of whatever the member's week starts on. */
const dayNameAt = (i: number, days: number) =>
  WEEK_DAYS[Math.min(6, Math.round(i * (7 / Math.max(1, days))))];

/**
 * A week drawn entirely from movements that need nothing.
 *
 * `rows` is the WHOLE catalogue, not a pre-filtered pool — see the header: the
 * groups it could not cover are only knowable from the rows it left out.
 */
export function noKitProgram(
  rows: readonly NoKitRow[],
  opts: { days?: number; perDay?: number } = {},
): NoKitPlan {
  const days = Math.max(1, Math.min(7, Math.trunc(opts.days ?? 3) || 3));
  const perDay = Math.max(1, Math.min(8, Math.trunc(opts.perDay ?? 5) || 5));

  // Every group the catalogue names, in the catalogue's own spelling. First
  // spelling seen wins, compared case-insensitively — `equipment` taught this
  // file that free text arrives in three capitalisations.
  const known = new Map<string, string>();
  for (const r of rows) {
    const g = (r.group || '').trim();
    if (g && !known.has(g.toLowerCase())) known.set(g.toLowerCase(), g);
  }

  const pool = rows.filter(needsNoKit);
  const byGroup = new Map<string, NoKitRow[]>();
  let unplaced = 0;
  for (const r of pool) {
    const g = (r.group || '').trim();
    if (!g) { unplaced++; continue; }
    const k = g.toLowerCase();
    const list = byGroup.get(k);
    if (list) list.push(r); else byGroup.set(k, [r]);
  }
  // Strength before stretching inside a group, then by name so the same
  // catalogue always produces the same week. A week that reshuffles itself on
  // every tap is a week a coach cannot review.
  for (const list of byGroup.values()) {
    list.sort((a, b) => (Number(isStretch(a)) - Number(isStretch(b))) || a.name.localeCompare(b.name));
  }

  // Biggest pool first, so the day opens on the group with the most to choose
  // from and the thin ones fill in behind it. Derived, not ranked by hand.
  const order = [...byGroup.keys()].sort((a, b) =>
    (byGroup.get(b)!.length - byGroup.get(a)!.length) || a.localeCompare(b));

  const cursor = new Map<string, number>();
  const uses = new Map<string, number>();
  const plan: ProgramDay[] = [];
  for (let d = 0; d < days && order.length; d++) {
    const exercises: ProgramExercise[] = [];
    for (let k = 0; k < order.length && exercises.length < perDay; k++) {
      // Advanced by a whole day's worth, not by one, so consecutive days take
      // DIFFERENT groups and a week reaches every group the pool has. Stepping
      // by one overlapped each day with the last by four groups and left the
      // smallest pools — which is Arms, with its single movement — out of the
      // week entirely while the report still called them covered.
      const key = order[(d * perDay + k) % order.length];
      const list = byGroup.get(key)!;
      const at = cursor.get(key) ?? 0;
      const row = list[at % list.length];
      cursor.set(key, at + 1);
      uses.set(key, (uses.get(key) ?? 0) + 1);
      const group = known.get(key) ?? key;
      exercises.push({
        // The slug, and the day index behind it. Two days that share a movement
        // — which is what a one-option group forces — must not share a key:
        // `patchEx` in the builder edits by key, and a second Arms row with the
        // same key would move whenever the first one did.
        key: `nokit-${exerciseSlug(row.name)}-${d}`,
        name: row.name,
        group,
        sets: setsFor(row),
        reps: repsFor(row),
        // Real rows from the same group, never invented. Empty is honest for a
        // group with one movement in it.
        alternatives: list.filter((x) => x.name !== row.name).slice(0, 2).map((x) => x.name),
      });
    }
    if (!exercises.length) break;
    const focusGroups: string[] = [];
    for (const e of exercises) if (!focusGroups.includes(e.group)) focusGroups.push(e.group);
    plan.push({ day: dayNameAt(d, days), focus: focusGroups.slice(0, 2).join(' · '), exercises });
  }

  const missing = [...known.entries()]
    .filter(([k]) => !(byGroup.get(k)?.length))
    .map(([, label]) => label)
    .sort((a, b) => a.localeCompare(b));
  // Two ways a group is short, and both have to be said.
  //
  // `l.length === 1` is the Arms case: the catalogue holds one movement, the
  // week puts it in, and a coach reading a balanced-looking week has no way to
  // tell that there is nothing else behind it. It is reported whether or not
  // the rotation happened to use it twice.
  //
  // `(uses ?? 0) > l.length` is the other: the week asked for the group more
  // often than the pool can answer, so a movement comes round again. That one
  // depends on the day count, which is why it is counted rather than assumed.
  const thin = [...byGroup.entries()]
    .filter(([k, l]) => l.length === 1 || (uses.get(k) ?? 0) > l.length)
    .map(([k, l]) => ({ group: known.get(k) ?? k, options: l.length }))
    .sort((a, b) => a.options - b.options || a.group.localeCompare(b.group));

  const coverage: NoKitCoverage = { poolSize: pool.length, missing, thin, unplaced };
  const note = [
    'Every movement in this program needs no equipment at all — no bar, no bands, no bench.',
    noKitCoverageNote(coverage),
  ].filter(Boolean).join(' ');

  return {
    program: {
      title: 'No-Equipment Program',
      focus: ['Bodyweight strength', 'Trainable anywhere'],
      note,
      days: plan,
    },
    coverage,
  };
}

/** 'a, b and c'. */
const list = (xs: string[]): string =>
  (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * What the screen says about the groups this could not cover, or null when
 * there is nothing to admit.
 *
 * Named, always, and with the reason attached. "Some groups are not covered"
 * tells a coach to go and check eleven of them; naming Calves tells them what
 * to bring to the session.
 *
 * An empty pool is not a program with gaps in it — it is no program — and it
 * gets its own sentence, because "Calves is not covered" said over a failed or
 * unread catalogue would be a claim about the catalogue we do not have.
 */
export function noKitCoverageNote(c: NoKitCoverage): string | null {
  if (c.poolSize <= 0) {
    return 'No movement in the catalogue is recorded as needing no equipment, so there is nothing to build this program from.';
  }
  const parts: string[] = [];
  if (c.missing.length) {
    parts.push(c.missing.length === 1
      ? `${c.missing[0]} is not in this program: the catalogue holds no movement for it that needs no equipment, and none was invented to fill the gap.`
      : `${list(c.missing)} are not in this program: the catalogue holds no movement for them that needs no equipment, and none was invented to fill the gaps.`);
  }
  if (c.thin.length) {
    const said = c.thin.map((x) => `${x.group} has ${x.options === 1 ? 'only one movement' : `only ${x.options} movements`}`);
    parts.push(`${list(said)} that ${c.thin.length === 1 && c.thin[0].options === 1 ? 'needs' : 'need'} no equipment, so the week has nothing else to give ${c.thin.length === 1 ? 'it' : 'them'}.`);
  }
  if (c.unplaced > 0) {
    parts.push(c.unplaced === 1
      ? '1 no-equipment movement is not in the week because the catalogue does not say which muscle group it trains.'
      : `${c.unplaced} no-equipment movements are not in the week because the catalogue does not say which muscle groups they train.`);
  }
  return parts.length ? parts.join(' ') : null;
}
