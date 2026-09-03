// A set measured in seconds, on the movements this app prescribes in seconds.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `buildProgram` in ./programs.ts hands every fat-loss and tone client a plank
// written as `'45 sec'` and a side plank written as `'30 sec/side'`. The set
// method catalogue has an `isometric` entry whose blurb says, in as many words,
// "The reps column is seconds". And both log paths refuse anything that is not
// a positive whole number of REPS: "Type the reps you did before logging the
// set."
//
// So the app prescribed a hold, told the member the reps column was seconds,
// and then would not accept a hold. What people did instead was type 45 into a
// reps box — which is a claim that they performed forty-five plank repetitions,
// counted into the rep totals on History, and eligible to be read as a rep
// record. The alternative was not logging the movement at all, which is what
// most people did, so the one exercise in a beginner's programme they could
// actually complete was the one their log never mentioned.
//
// ── Why a flag, and not a third number in the pair ─────────────────────────
//
// This is the same shape of problem as ./bodyweightSets.ts and it is solved the
// same way on purpose. `sets[i]` is `[reps, kg]` and is written to a jsonb
// column that three apps read; widening the pair to a triple would change what
// every existing row means to every existing reader, and there is no migration
// that reaches an on-device draft in AsyncStorage.
//
// So `timed[i] === true` is testimony, aligned to `sets` exactly as `bw` and
// `feel` are, and it changes what `sets[i][0]` MEANS: on an ordinary set it is
// repetitions, on a timed set it is SECONDS HELD. The second number goes on
// meaning what it meant — the load, or with `bw` the load added to the body —
// so a 45-second plank with a 10 kg plate on your back is `[45, 10]` with
// `timed[0]` and `bw[0]` both true, and every part of that is recoverable.
//
// Absent means nobody was asked, which is the honest reading of every set
// logged before this existed. It is NOT "false for every set": a member who
// typed 45 into a reps box last month did something we cannot now interpret,
// and quietly relabelling those as holds would invent a record of a plank they
// may never have done.
//
// ── What a timed set is worth ──────────────────────────────────────────────
//
// Nothing, in tonnage — and that is the point rather than an omission. Tonnage
// is Σ reps × load, and seconds × kilograms is not a mass moved; a member
// holding 10 kg for 45 seconds has not lifted 450 kg and no total in this app
// may say so. For the same reason a timed set produces no estimated 1RM: Epley
// takes reps, and feeding it seconds returns a number that looks like a
// strength figure and is arithmetic on a stopwatch.
//
// What a timed set IS worth is the hold itself. `holdRecords` is the board for
// it — longest hold per movement, with any load carried alongside — for the
// same reason `repRecords` exists next to `personalRecords` in
// ./bodyweightSets.ts: the honest record of work that cannot be priced is the
// work, stated in its own units.
import type { WorkoutEntry } from './mockData';

/** True when the person said this set was held for a time rather than
 *  repeated. `sets[i][0]` is then SECONDS. */
export function isTimedSet(e: Pick<WorkoutEntry, 'timed'>, i: number): boolean {
  return e.timed?.[i] === true;
}

/** Whether any set of an entry was timed — for a row that has to decide how to
 *  word itself before it looks at the individual sets. */
export function hasTimedSet(e: Pick<WorkoutEntry, 'timed'>): boolean {
  return Array.isArray(e.timed) && e.timed.some((x) => x === true);
}

/**
 * The seconds a coach's rep prescription is asking for, or null when it is
 * asking for reps.
 *
 * Read from the prescription STRING because that is where the app already
 * says it: `'45 sec'`, `'30 sec/side'`, `'1 min'`, `'90s'`, `'2 min hold'`.
 * Nothing writes a machine-readable duration onto a programme, three years of
 * templates are already stored as prose, and a coach typing "45 sec" into the
 * builder means the same thing today as they did then.
 *
 * A range — `'30-45 sec'` — takes the FIRST number. It is the one the member
 * has to reach for the set to count, and a runner that seeds the box with the
 * top of a range is asking somebody to fail.
 *
 * Deliberately narrow. Only an explicit unit counts, so a bare `'12'` is
 * twelve reps and stays twelve reps: guessing that a large bare number must be
 * seconds is how "AMRAP 100" becomes a minute and forty seconds.
 */
export function prescribedSeconds(reps: string | null | undefined): number | null {
  if (!reps) return null;
  const text = String(reps).toLowerCase();
  // The FIRST figure in the prescription, always. '30-45 sec' is a range and
  // the thirty is the one that has to be reached; anchoring on the number that
  // happens to sit next to the unit picks the forty-five and seeds a runner
  // with the top of a range, which is asking somebody to fail.
  const first = text.match(/\d+(?:\.\d+)?/);
  if (!first) return null;
  // Minutes first: '1 min 30' would otherwise match the seconds pattern on the
  // 30 and hand back half a minute for a set of ninety seconds.
  const min = text.match(/(?:min|minute|minutes)\b|\d\s*m\b/);
  if (min) {
    const whole = Math.round(parseFloat(first[0]) * 60);
    // '1 min 30' and '1m30s' — the remainder after the minutes, when it is
    // stated as seconds rather than as a second minute figure.
    const rest = text.slice((min.index ?? 0) + min[0].length).match(/^\s*(\d+)\s*(?:s|sec|secs|second|seconds)?\b/);
    const extra = rest ? parseInt(rest[1], 10) : 0;
    const total = whole + (Number.isFinite(extra) ? extra : 0);
    return total > 0 ? total : null;
  }
  // Deliberately narrow. Only an explicit unit counts, so a bare '12' is twelve
  // reps and stays twelve reps: guessing that a large bare number must be
  // seconds is how 'AMRAP 100' becomes a minute and forty seconds.
  if (!/\d\s*(?:s|sec|secs|second|seconds)\b/.test(text)) return null;
  const v = Math.round(parseFloat(first[0]));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Whether a prescription is written in time rather than in reps. */
export function isTimedPrescription(reps: string | null | undefined): boolean {
  return prescribedSeconds(reps) != null;
}

/**
 * A typed hold, or the reason it is refused.
 *
 * The same shape and the same discipline as `readLift` in ./units.ts, and for
 * the same reason: a mistyped duration coerced to a number is a measurement
 * nobody made. `parseInt('4 5')` is 4, and a member who fumbled a two-digit
 * hold would have a quarter of their plank in the record with nothing to say
 * so.
 *
 * The ceiling is two hours. It is not a judgement about anybody's core; it is
 * the point past which a figure is far likelier to be a typo — a fat-fingered
 * 4500 for 45 — than a hold, and the sentence says which so the member can
 * disagree by typing it again.
 */
export const MAX_HOLD_SECONDS = 7200;

export type HoldRead = { ok: true; secs: number } | { ok: false; reason: string };

export function readHold(text: string): HoldRead {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: false, reason: 'How long did you hold it? Type the seconds.' };
  // 'mm:ss' as well as plain seconds. A three-minute hold is read off a clock
  // as 3:00 by everybody who has ever used one, and refusing that spelling
  // would send them to do the arithmetic themselves.
  const clock = raw.match(/^(\d{1,2}):([0-5]\d)$/);
  const secs = clock
    ? parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10)
    : (/^\d{1,5}$/.test(raw) ? parseInt(raw, 10) : NaN);
  if (!Number.isFinite(secs)) {
    return { ok: false, reason: 'Type the seconds you held it for, as a whole number or as minutes and seconds like 1:30.' };
  }
  if (secs <= 0) return { ok: false, reason: 'A hold has to be at least one second.' };
  if (secs > MAX_HOLD_SECONDS) {
    return { ok: false, reason: `That is over two hours. Type the hold in seconds — 45 for forty-five seconds — or as minutes and seconds like 1:30.` };
  }
  return { ok: true, secs };
}

/** Seconds as a clock reads them: 45 s, 1:30, 12:05. Under a minute stays in
 *  seconds, because that is how a hold is prescribed and how it is counted. */
export function holdLabel(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * How a timed set reads on a row: "45 s hold", or with something on top of it.
 *
 * Sentence case and prose, matching `bodyweightSetLabel` — it sits under a
 * movement name explaining the set rather than heading it.
 */
export function timedSetLabel(secs: number, loadLabel: string | null, bodyweight: boolean): string {
  const hold = `${holdLabel(secs)} hold`;
  if (bodyweight) return loadLabel ? `${hold} at bodyweight +${loadLabel}` : `${hold} at bodyweight`;
  return loadLabel ? `${hold} with ${loadLabel}` : hold;
}

/**
 * One SAVED set, as it reads on a chip in the log.
 *
 * ── The bug this is the fix for ───────────────────────────────────────────
 *
 * The draft chips in app/(client)/workouts.tsx already knew: a hold is printed
 * as a clock and never as "45×", which is what a reps chip would say about a
 * plank the app itself asked for. The two places that render a SAVED entry did
 * not — they read `set[0]` and `set[1]` straight out of the row, so the moment
 * a plank was saved it came back as "45×— kg". The app prescribes the hold,
 * asks for it in seconds, prints it correctly while it is a draft, and then
 * showed it back as forty-five repetitions of nothing. A coach reading the same
 * rows sees forty-five plank reps.
 *
 * `loadLabel` is passed in rather than imported, because the number has to be
 * rendered in the member's own unit and in the app's own "no figure" glyph, and
 * neither of those belongs in a pure module. It is given null when the row
 * carries no load, so the caller's own em-dash convention is what shows.
 */
export function setChipLabel(
  e: Pick<WorkoutEntry, 'sets' | 'timed'>,
  i: number,
  loadLabel: (kg: number | null) => string,
  unit: string,
): string {
  const set = e.sets?.[i];
  const first = Number(set?.[0]) || 0;
  const load = Number(set?.[1]) || 0;
  if (isTimedSet(e, i)) {
    // The seconds are the measurement. The load, when there is one, is what was
    // held ON TOP of the member — "45 s × 10 kg" — and never a multiplicand.
    return load > 0 ? `${holdLabel(first)} × ${loadLabel(load)} ${unit}` : holdLabel(first);
  }
  return `${first}×${loadLabel(load > 0 ? load : null)} ${unit}`;
}

/**
 * Every set of an entry on one line, for the compact strip.
 *
 * The unit is stated once at the end and only when something on the line is a
 * load, so an all-holds entry does not read "1:00  45 s kg".
 */
export function setListLabel(
  e: Pick<WorkoutEntry, 'sets' | 'timed'>,
  loadLabel: (kg: number | null) => string,
  unit: string,
): string {
  const rows = e.sets ?? [];
  const parts: string[] = [];
  let anyLoaded = false;
  for (let i = 0; i < rows.length; i++) {
    const first = Number(rows[i]?.[0]) || 0;
    const load = Number(rows[i]?.[1]) || 0;
    if (isTimedSet(e, i)) {
      parts.push(load > 0 ? `${holdLabel(first)} × ${loadLabel(load)}` : holdLabel(first));
      if (load > 0) anyLoaded = true;
    } else {
      parts.push(`${first}×${loadLabel(load > 0 ? load : null)}`);
      anyLoaded = true;
    }
  }
  const line = parts.join('  ');
  return anyLoaded && line ? `${line} ${unit}` : line;
}

/** Total seconds held across an entry. Zero when nothing in it was timed —
 *  which is the ordinary case and is not a measurement of anything. */
export function entryHoldSeconds(e: WorkoutEntry): number {
  if (!e.sets?.length) return 0;
  let total = 0;
  for (let i = 0; i < e.sets.length; i++) {
    if (!isTimedSet(e, i)) continue;
    const s = e.sets[i][0];
    if (typeof s === 'number' && Number.isFinite(s) && s > 0) total += s;
  }
  return total;
}

/**
 * The longest hold on record for each movement.
 *
 * A separate board from `personalRecords`, deliberately, and for the reason
 * given at the top of this file: an estimated 1RM over a duration is a number
 * with a strength figure's face on it and a stopwatch behind it. A plank's
 * record is how long it was held, and that needs nothing the log does not
 * already carry.
 *
 * Ranked on seconds, with load breaking a tie, so a 60-second hold with a plate
 * beats a bare 60 and the two are never shown as the same achievement.
 */
export interface HoldRecord {
  exercise: string;
  secs: number;
  /** Kilograms held, or added to the body on a bodyweight hold. 0 for a plain
   *  one. */
  loadKg: number;
  /** True when the hold was the person's own bodyweight — so a row can say
   *  "at bodyweight +10 kg" rather than presenting 10 as the whole of it. */
  bodyweight: boolean;
  at: string;
}

export function holdRecords(log: readonly WorkoutEntry[]): HoldRecord[] {
  const best = new Map<string, HoldRecord>();
  for (const e of log) {
    if (!e.sets?.length) continue;
    for (let i = 0; i < e.sets.length; i++) {
      if (!isTimedSet(e, i)) continue;
      const secs = e.sets[i][0];
      if (!Number.isFinite(secs) || secs <= 0) continue;
      const loadKg = Math.max(0, Number.isFinite(e.sets[i][1]) ? e.sets[i][1] : 0);
      const bodyweight = e.bw?.[i] === true;
      const cur = best.get(e.exercise);
      const better = !cur || secs > cur.secs || (secs === cur.secs && loadKg > cur.loadKg);
      if (better) best.set(e.exercise, { exercise: e.exercise, secs, loadKg, bodyweight, at: e.t });
    }
  }
  return [...best.values()].sort((a, b) => b.secs - a.secs || b.loadKg - a.loadKg);
}
