// Three years of somebody else's training log, read out of their export.
//
// ── Why this is worth building ────────────────────────────────────────────
//
// A lifter with three years of history in Hevy or Strong will not switch to an
// app that makes them retype it, and Hevy already reads Strong's CSV for
// exactly this reason. `csvImport.ts` is the gym owner's importer — members,
// payments, price books — and reads none of this; `repdbImport.ts` is the
// exercise catalogue; `watchImport.ts` brings in workouts an Apple Watch or
// WHOOP recorded, which is a different record entirely (a duration and a heart
// rate, with no sets in it).
//
// ── What it refuses to do, which is most of the design ───────────────────
//
// It produces NOTHING for a row it cannot read whole, and it says how many it
// dropped and why. The alternative — filing a partial set — puts a lift into
// somebody's permanent record that they did not do, and every figure this app
// derives from the log would then be built on it: their records, their est 1RM,
// their tonnage, their streak, plan-versus-actual.
//
// It also does not DEDUPLICATE against the existing log. That decision belongs
// to the screen, which knows whether this is a first import or a second, and
// guessing it here would silently drop a genuine repeat session — somebody who
// squatted the same weight for the same reps on two consecutive Mondays.
//
// ── The two formats ──────────────────────────────────────────────────────
//
// Both are one row PER SET, with the session identified by its date, so the
// reader has to fold rows into entries rather than map them one to one.
//
//   Strong:  Date,Workout Name,Exercise Name,Set Order,Weight,Reps,...
//   Hevy:    title,start_time,exercise_title,set_index,weight_kg,reps,...
//
// The header row is what tells them apart, and it is matched on the COLUMNS
// rather than on a filename or an order: both products have reordered and
// renamed columns across versions, and a positional reader would file weights
// as reps the first time either of them shipped a change.
import type { WorkoutEntry } from './mockData';

/** Which export this is. */
export type LiftingSource = 'strong' | 'hevy';

export interface LiftingImportRow {
  /** ISO instant of the session this set belonged to. */
  at: string;
  exercise: string;
  reps: number;
  /** Kilograms. Both formats export kg; a pounds export is refused outright
   *  rather than converted on an assumption — see `detectSource`. */
  kg: number;
}

export interface LiftingImportPreview {
  source: LiftingSource | null;
  /** Sessions, newest first, ready to write. */
  entries: WorkoutEntry[];
  /** How many SET rows were read into those entries. */
  setsRead: number;
  /** Rows the reader would not file, and why. One sentence per reason, with a
   *  count — never a silent drop. */
  skipped: { reason: string; rows: number }[];
  /** Why nothing could be read at all, or null when something was. */
  blocker: string | null;
}

/** Split a CSV line, honouring double quotes. Exercise names contain commas
 *  ("Bench Press (Barbell), Close Grip") in both exports. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const norm = (h: string) => h.toLowerCase().replace(/[\s_]+/g, '');

/**
 * Which export this is, from its header columns.
 *
 * Named columns and not positions, because both products have moved and
 * renamed columns between versions — a positional reader files weights as reps
 * the first time either ships a change, and does it silently.
 *
 * A `weight_lb`/`lbs` column is deliberately NOT accepted. Converting it here
 * would be this module deciding that a number it has never seen a unit for is
 * pounds; the refusal sends the member back to the export screen where the unit
 * is theirs to set, which is the same rule `csvImport.parseMoneyCents` applies
 * to an ambiguous amount.
 */
export function detectSource(header: string): LiftingSource | null {
  const h = new Set(cells(header).map(norm));
  if (h.has('exercisename') && h.has('setorder') && h.has('reps')) return 'strong';
  if (h.has('exercisetitle') && h.has('setindex') && h.has('reps')) return 'hevy';
  return null;
}

/** The column names each format uses, in the order this reader looks for them.
 *  Several are alternatives: Strong has shipped both `Date` and `workout_date`,
 *  and both `Weight` and `Weight (kg)`. */
const COLUMNS: Record<LiftingSource, { at: string[]; exercise: string[]; reps: string[]; kg: string[] }> = {
  strong: {
    at: ['date', 'workoutdate'],
    exercise: ['exercisename'],
    reps: ['reps'],
    kg: ['weightkg', 'weight'],
  },
  hevy: {
    at: ['starttime', 'start_time', 'date'],
    exercise: ['exercisetitle'],
    reps: ['reps'],
    kg: ['weightkg', 'weight'],
  },
};

const pick = (head: string[], names: string[]): number => {
  for (const n of names) {
    const i = head.indexOf(norm(n));
    if (i >= 0) return i;
  }
  return -1;
};

/**
 * Read a whole export into sessions.
 *
 * One entry per (day, exercise), because that is what a `workouts` row is —
 * `entriesToWrite` in the logging screens groups the same way, and an entry per
 * SET would multiply somebody's session count by five and every streak and
 * adherence figure with it.
 */
export function previewLiftingImport(text: string): LiftingImportPreview {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) {
    return { source: null, entries: [], setsRead: 0, skipped: [], blocker: 'That file is empty.' };
  }
  const source = detectSource(lines[0]);
  if (!source) {
    return {
      source: null, entries: [], setsRead: 0, skipped: [],
      blocker: 'This does not look like a Strong or Hevy export. Both start with a header row naming the '
        + 'exercise, the set number and the reps — export again from the app rather than editing the file, '
        + 'and if the weights are in pounds switch that app to kilograms first.',
    };
  }

  const head = cells(lines[0]).map(norm);
  const col = COLUMNS[source];
  const iAt = pick(head, col.at);
  const iEx = pick(head, col.exercise);
  const iReps = pick(head, col.reps);
  const iKg = pick(head, col.kg);
  if (iAt < 0 || iEx < 0 || iReps < 0 || iKg < 0) {
    return {
      source, entries: [], setsRead: 0, skipped: [],
      blocker: 'That export is missing a column this reader needs — the date, the exercise, the reps or the '
        + 'weight. Export the full history rather than a filtered view.',
    };
  }

  // Reasons are counted rather than listed row by row: a three-year export with
  // two hundred warm-up rows produces a readable sentence this way and an
  // unreadable wall the other.
  const drop = new Map<string, number>();
  const note = (reason: string) => drop.set(reason, (drop.get(reason) ?? 0) + 1);

  /** day + exercise → the entry being built. */
  const byKey = new Map<string, { at: string; exercise: string; sets: [number, number][] }>();
  let setsRead = 0;

  for (let r = 1; r < lines.length; r++) {
    const c = cells(lines[r]);
    const rawAt = c[iAt] ?? '';
    const exercise = (c[iEx] ?? '').trim();
    // `Number('')` is ZERO, not NaN — so a blank cell reads as a real figure
    // unless the blank is tested for first. That matters most on the weight: a
    // missing weight and a BODYWEIGHT set are both "0" through `Number`, and
    // one is a pull-up while the other is a row this reader must refuse. The
    // same trap src/lib/bodyweightSets.ts argues at length, arriving through a
    // CSV instead of a form.
    const rawReps = (c[iReps] ?? '').trim();
    const rawKg = (c[iKg] ?? '').trim();
    const reps = rawReps === '' ? NaN : Number(rawReps);
    const kg = rawKg === '' ? NaN : Number(rawKg);

    const ms = Date.parse(rawAt.replace(' ', 'T'));
    if (!Number.isFinite(ms)) { note('the date could not be read'); continue; }
    if (!exercise) { note('no exercise name'); continue; }
    // A set with no reps is not a set. Both apps export the row anyway for a
    // logged-but-empty set, and filing it would put a lift nobody did into a
    // permanent record.
    if (!Number.isFinite(reps) || reps <= 0) { note('no rep count'); continue; }
    // Zero IS a real load — a bodyweight pull-up — so only a missing or
    // negative number is refused.
    if (!Number.isFinite(kg) || kg < 0) { note('the weight could not be read'); continue; }

    const at = new Date(ms).toISOString();
    const key = at.slice(0, 10) + '|' + exercise.toLowerCase();
    const e = byKey.get(key);
    if (e) e.sets.push([reps, kg]);
    else byKey.set(key, { at, exercise, sets: [[reps, kg]] });
    setsRead += 1;
  }

  const entries: WorkoutEntry[] = [...byKey.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => ({ t: e.at, exercise: e.exercise, sets: e.sets }));

  const skipped = [...drop.entries()].map(([reason, rows]) => ({ reason, rows }));
  return {
    source,
    entries,
    setsRead,
    skipped,
    blocker: entries.length ? null : 'Nothing in that file could be read as a completed set.',
  };
}

/** The sentence a screen puts under the preview. Says what WILL be written and
 *  what will not, because a count of sessions alone hides the drops. */
export function liftingImportNote(p: LiftingImportPreview): string {
  if (p.blocker) return p.blocker;
  const sessions = p.entries.length;
  const from = p.source === 'strong' ? 'Strong' : 'Hevy';
  const head = `${sessions} session${sessions === 1 ? '' : 's'} from ${from}, holding ${p.setsRead} set${p.setsRead === 1 ? '' : 's'}.`;
  if (!p.skipped.length) return head;
  const dropped = p.skipped.reduce((a, s) => a + s.rows, 0);
  const why = p.skipped.map((s) => `${s.rows} with ${s.reason}`).join(', ');
  return `${head} ${dropped} row${dropped === 1 ? '' : 's'} will not be imported — ${why}. `
    + `Those are left out rather than guessed at.`;
}
