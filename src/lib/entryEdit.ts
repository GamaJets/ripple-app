// Correcting something that is already logged — TF-02, "can't edit an entry".
//
// Two records a client keeps could be added to and deleted from but never
// fixed: a meal in the food log and a lift or cardio session in the training
// log. The only remedy on offer was delete-and-log-again, and on the training
// side that is not an equivalent remedy at all — it discards the heart-rate
// zones recorded against the session, which are a measurement nobody can
// reproduce by typing. So people left the wrong number in rather than lose the
// right ones, and the wrong number went on feeding the day's macros, the
// streak, the monthly bars in History and the coach's adherence figures.
//
// What a person typed is read and checked here, away from React, for three
// reasons. It is where "blank" can be kept distinct from "zero" once instead of
// at five keyboards. It is where the day-preserving rule below can be TESTED
// rather than asserted in a comment. And it is where an unparseable field can
// be refused instead of quietly becoming 0 — `parseInt('abc', 10) || 0` was the
// shape the edit sheet shipped with, and a fat-fingered calorie box turning
// into a confident zero is exactly the kind of invented figure this app exists
// not to print.
//
// ── The day an entry belongs to is not the day you correct it on ────────────
//
// This is the trap in src/lib/localDate.ts, arriving from a new direction. A
// correction typed on Thursday to Tuesday's squats has to leave the entry on
// Tuesday: the calendar dots, the streak, the History bars and the coach's
// week all key off the day, and moving it would silently create a session that
// never happened alongside a Tuesday that suddenly went untrained.
//
// So `workoutPatch` cannot express a change of timestamp at all — `t` is
// excluded from its return type, which makes the rule a compile error rather
// than a habit. And where a day genuinely does have to become an instant —
// saving Tuesday's session on Thursday from Train's day picker — `instantForDay`
// builds it from the calendar numbers through `dateParts`, because `Date.parse`
// resolves a bare `YYYY-MM-DD` to UTC midnight and hands everybody west of
// Greenwich the day before.
import { dateParts } from './localDate';
import type { WorkoutEntry } from './mockData';

/** Either the checked value, or the sentence to show the person who typed it. */
export type Edit<T> = { ok: true; value: T } | { ok: false; reason: string };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The local calendar day an instant falls on, as `YYYY-MM-DD`. */
export function dayKeyOf(iso?: string | null): string | null {
  const p = dateParts(iso);
  return p ? `${p[0]}-${pad2(p[1] + 1)}-${pad2(p[2])}` : null;
}

/** The local calendar day of a Date, in the same `YYYY-MM-DD` shape. */
export function dayKeyOfDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Whether two instants land on the same day in the reader's own timezone. */
export function sameLocalDay(a?: string | null, b?: string | null): boolean {
  const x = dayKeyOf(a);
  return x != null && x === dayKeyOf(b);
}

/**
 * An instant that reads back as `dayKey` for whoever logged it.
 *
 * Train's day picker lets somebody select Tuesday and save the session they did
 * on Tuesday. The save wrote `new Date().toISOString()` regardless, so the
 * session landed on whatever day they happened to be typing — the calendar dot,
 * the streak and the coach's week all recorded a Thursday that never happened
 * and a Tuesday that did.
 *
 * Today keeps the real clock time, because for today the instant IS known and
 * throwing it away would flatten every session of the day onto the same moment.
 * Any other day gets local midday. Not midnight: DST transitions happen in the
 * small hours, and in the zones that shift AT midnight a local midnight can
 * resolve to 23:00 the day before — which is the whole bug again, arriving
 * twice a year.
 *
 * Null for a string that is not a real calendar day, rather than a nearby one:
 * the regex in `dateParts` will happily read '2026-13-45', and rolling that
 * forward to February would file a session under a month nobody chose.
 */
export function instantForDay(dayKey: string, now: Date = new Date()): string | null {
  const p = dateParts(dayKey);
  if (!p) return null;
  const [y, m, d] = p;
  const noon = new Date(y, m, d, 12, 0, 0, 0);
  // Round-trip check: a rolled-over date is not the day that was asked for.
  if (noon.getFullYear() !== y || noon.getMonth() !== m || noon.getDate() !== d) return null;
  return dayKeyOfDate(now) === dayKeyOfDate(noon) ? now.toISOString() : noon.toISOString();
}

/* ── the food log ───────────────────────────────────────────────────────── */

/** What a meal is worth, once the fields have been read and checked. */
export interface FoodFigures { name: string; kcal: number; protein: number; carbs: number; fat: number }
/** The same five fields as the person left them — strings, possibly blank. */
export interface FoodDraft { name: string; kcal: string; protein: string; carbs: string; fat: string }

/** A number, or null when the text is not one. Accepts a decimal comma, which
 *  is what a Gulf or European keyboard offers first. */
function num(s: string): number | null {
  const v = Number(String(s).trim().replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/**
 * Read a corrected meal.
 *
 * Calories are required. `food_logs.kcal` is NOT NULL, so there is nowhere to
 * put "I don't know" — and a meal with no figure cannot be counted against the
 * day anyway, which is the only thing the food log is for. The same sentence
 * the photo sheet already uses is reused here on purpose.
 *
 * An emptied macro field is 0 and not a refusal: broccoli genuinely has no fat,
 * and somebody clearing the box is stating that rather than declining to say.
 * Text that is not a number at all is refused outright — that is a typo, and
 * turning a typo into a zero is how a fabricated figure gets into a record.
 */
export function readFoodEdit(draft: FoodDraft): Edit<FoodFigures> {
  const name = draft.name.trim();
  if (!name) return { ok: false, reason: 'Give the meal a name so you can recognise it later.' };

  const kcal = num(draft.kcal);
  if (draft.kcal.trim() === '' || kcal == null) {
    return { ok: false, reason: 'Enter the calories. A meal with no figure cannot be counted against your day.' };
  }
  if (kcal < 0) return { ok: false, reason: 'Calories cannot be negative.' };

  const macros: Record<'protein' | 'carbs' | 'fat', number> = { protein: 0, carbs: 0, fat: 0 };
  const labels: Record<'protein' | 'carbs' | 'fat', string> = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
  for (const k of ['protein', 'carbs', 'fat'] as const) {
    const raw = draft[k];
    if (raw.trim() === '') { macros[k] = 0; continue; }
    const v = num(raw);
    if (v == null) return { ok: false, reason: `${labels[k]} is not a number. Leave it empty if there is none.` };
    if (v < 0) return { ok: false, reason: `${labels[k]} cannot be negative.` };
    macros[k] = Math.round(v);
  }
  return { ok: true, value: { name, kcal: Math.round(kcal), ...macros } };
}

/** Whether a correction actually corrects anything, so an untouched sheet can
 *  close without claiming a save it never attempted. */
export function foodChanged(before: FoodFigures, after: FoodFigures): boolean {
  return before.name !== after.name || before.kcal !== after.kcal
    || before.protein !== after.protein || before.carbs !== after.carbs || before.fat !== after.fat;
}

/* ── the training log ───────────────────────────────────────────────────── */

/**
 * Everything a correction is allowed to change.
 *
 * `t` is absent by construction, not by discipline — see the header. `id`,
 * `loggedBy` and `amendedAt` are absent for the reason the SQL gives in
 * supabase/parts/53: who recorded a workout is not the subject's to rewrite,
 * and whether an edit left a mark is decided by the trigger rather than by the
 * person doing the editing.
 */
export type WorkoutPatch = Omit<Partial<WorkoutEntry>, 't' | 'id' | 'loggedBy' | 'amendedAt'>;

/** The edit sheet's fields as they stand. `sets` is already numeric because the
 *  sheet edits it as a list of rows rather than as text. */
export interface WorkoutDraft {
  name: string;
  sets: [number, number][];
  mins: string;
  dist: string;
  watts: string;
  kcal: string;
}

/**
 * Read a corrected workout entry.
 *
 * Cardio and strength are different records and are checked differently: a
 * cardio session without minutes is not a session, and a strength entry with
 * every set removed is not an entry. Both are refused with the delete button
 * named, because deleting is what the person actually means and it is one tap
 * away — where writing an empty row would leave a ghost in the calendar that
 * cannot be corrected either.
 *
 * Calories may be blank, and blank means null rather than 0. `kcal` is the one
 * figure here the app sometimes derives and sometimes cannot: a sauna has no
 * MET value, so its burn is genuinely unknown, and the log renders that as a
 * dash. Typing 0 into that dash would be a measurement claim.
 */
export function readWorkoutEdit(entry: WorkoutEntry, draft: WorkoutDraft): Edit<WorkoutPatch> {
  const name = draft.name.trim();
  if (!name) return { ok: false, reason: 'An entry needs an exercise name.' };

  const patch: WorkoutPatch = { exercise: name };

  if (entry.cardio) {
    const mins = num(draft.mins);
    if (mins == null || mins <= 0) {
      return { ok: false, reason: 'How long was it? A session with no minutes is not a session — delete it instead if it did not happen.' };
    }
    const dist = draft.dist.trim() === '' ? 0 : num(draft.dist);
    if (dist == null || dist < 0) return { ok: false, reason: 'Distance is not a number. Leave it empty if you did not measure one.' };
    const watts = draft.watts.trim() === '' ? 0 : num(draft.watts);
    if (watts == null || watts < 0) return { ok: false, reason: 'Watts is not a number. Leave it empty if your machine did not show one.' };
    // Spread the original first so hrAvg and hrHigh — measured by a watch and
    // not editable here — survive a correction to the minutes beside them.
    const cardio: NonNullable<WorkoutEntry['cardio']> = { ...entry.cardio, mins: Math.round(mins), dist };
    if (watts > 0) cardio.watts = Math.round(watts); else delete cardio.watts;
    patch.cardio = cardio;
  } else {
    const kept = draft.sets.filter((s) => s[0] > 0);
    if (!kept.length) {
      return { ok: false, reason: 'Keep at least one set, or delete the entry instead — an entry with nothing in it still counts as a session.' };
    }
    patch.sets = kept.map((s) => [Math.round(s[0]), s[1]] as [number, number]);
    // Perceived effort is recorded per set, so a set that no longer exists must
    // not keep carrying somebody's answer for it.
    if (entry.feel) patch.feel = entry.feel.slice(0, kept.length);
  }

  if (draft.kcal.trim() === '') {
    patch.kcal = undefined;
  } else {
    const k = num(draft.kcal);
    if (k == null) return { ok: false, reason: 'Calories is not a number. Leave it empty if the burn is unknown.' };
    if (k < 0) return { ok: false, reason: 'Calories cannot be negative.' };
    patch.kcal = Math.round(k);
  }

  return { ok: true, value: patch };
}
