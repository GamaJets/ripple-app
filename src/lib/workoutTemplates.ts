// The fifteen RepDB programmes, as arithmetic on rows rather than as a screen.
//
// ── What this table is, and what it deliberately is not ───────────────────
//
// `public.workout_templates` is the platform's own programme catalogue: fifteen
// rows, source 'repdb', readable by every signed-in member and coach, writable
// through the API by nobody. It is NOT `program_templates`, which is a coach's
// own saved work, keyed by a NOT NULL `coach_id` and private to them. The
// distinction is the whole reason for the second table — see
// supabase/parts/2600 — and it has to survive into the UI: a coach's library
// is theirs, and these fifteen belong to no one. A screen that listed them
// together would be telling a coach that Stronglifts is something they built.
//
// ── The two things about this data that will bite ─────────────────────────
//
// 1. `reps` IS A STRING AND IS NOT ALWAYS A NUMBER. The live set of values is
//    "5", "6-8", "8-12", "AMRAP", "30s", "30-60s", "45s", "60s", "10/leg",
//    "8/side", "15/side" — twenty-six distinct strings across 126 exercise
//    references, checked against the live table on 7 September 2026, and only
//    eleven of them parse as an integer. `Number("6-8")` is NaN and
//    `parseInt("30s")` is 30, which is the worse of the two failures because it
//    succeeds: a "hold for thirty seconds" plank would be rendered as thirty
//    repetitions and a member would do them. So nothing here parses reps. It is
//    carried, trimmed, and printed as the coaching instruction it is.
//
// 2. `rest_seconds` OF 0 IS A REAL INSTRUCTION. The kettlebell complex and the
//    core finisher are performed back-to-back, and zero says so. `rest || null`
//    would erase exactly the rows where the rest matters most, so zero is
//    distinguished from absent everywhere in this file: absent means the
//    programme does not say, and that is not the same sentence as "do not
//    rest".
//
// ── What is NOT computed here, and will not be ────────────────────────────
//
// How long a session takes, and what it burns. Both are the obvious next
// column and neither is in the data. A duration looks derivable — sets times
// reps times a tempo, plus the rest — and it is not: the tempo is not recorded,
// half the reps are ranges or holds, and a set of "AMRAP" has no length at all.
// `frequency_per_week` IS given and is the only cadence figure that may be
// printed. Anything else would be a number this app made up about somebody's
// evening.
//
// Nothing in here imports react-native or supabase: it is arithmetic on strings
// and arrays, and src/lib/workoutTemplates.test.ts tests it as such.
import type { DisplayString, TranslationLocale } from './catalogueLocale';
import { CATALOGUE_BASE_LOCALE } from './catalogueLocale';

/* ── the shapes ───────────────────────────────────────────────────────────── */

/**
 * One string in the three languages the table carries.
 *
 * A record rather than three fields on every interface, so the fallback rule
 * below is written once. Any of the three may be null: `name_en` is NOT NULL in
 * the table and nothing else is, and the exercise notes are absent on 116 of
 * the 126 references — which is a gap, not an empty string.
 */
export interface Localised {
  en: string | null;
  de: string | null;
  es: string | null;
}

/** One movement inside one day of a programme. */
export interface TemplateExercise {
  /** `exercises.id`. A database trigger refuses a write naming an id the
   *  catalogue does not have (supabase/parts/2600), so this resolves — but the
   *  READ of `exercises` can still fail or come back short, and a screen has to
   *  survive holding an id it has no name for. */
  exerciseId: string;
  /** Null where the programme does not say. Never invented, never defaulted to
   *  one: a movement with no set count is a gap in the row. */
  sets: number | null;
  /** The coaching instruction, verbatim. "6-8", "AMRAP" and "30s" are all
   *  legitimate values and NONE of them is a number. See the header. */
  reps: string | null;
  /** Seconds. ZERO IS A VALUE — see the header — and null is the absence of
   *  one. The two must never be collapsed. */
  restSeconds: number | null;
  notes: Localised;
}

/** One day of a programme — "Workout A", "Push", "Full Body". */
export interface TemplateDay {
  name: Localised;
  exercises: TemplateExercise[];
}

/** One row of `public.workout_templates`, as the app holds it. */
export interface WorkoutTemplate {
  id: string;
  /** 'repdb' on all fifteen today. Kept because the screens say whose
   *  programmes these are, and that sentence must come off the row rather than
   *  out of a constant that a second source would quietly falsify. */
  source: string | null;
  goal: string;
  difficulty: string;
  /** Sessions a week. The ONE cadence figure this data actually carries. Null
   *  where the row does not state it, and a screen then says nothing. */
  frequencyPerWeek: number | null;
  tags: string[];
  days: TemplateDay[];
  name: Localised;
  description: Localised;
  /**
   * Exercise entries in `days` that carried no usable exercise id and were
   * dropped by `parseDays`.
   *
   * Carried rather than swallowed. A programme silently one movement short is
   * a programme somebody trains wrong, and the difference between "this day has
   * four exercises" and "this day has five and we could only read four" is the
   * whole of what a member needs to know before they follow it.
   */
  unreadableEntries: number;
}

/* ── reading the jsonb ─────────────────────────────────────────────────────── */

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
};

/**
 * A whole, finite, non-negative number, or null.
 *
 * `Number(null)` is 0 and `Number('')` is 0, which is why this does not go
 * through Number() at all: a missing set count arriving as zero would render as
 * "0 sets", a sentence about a programme that nobody wrote.
 */
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

const localised = (o: Record<string, unknown>, prefix: string): Localised => ({
  en: str(o[`${prefix}_en`]),
  de: str(o[`${prefix}_de`]),
  es: str(o[`${prefix}_es`]),
});

/** A programme's days, and how many exercise entries had to be thrown away. */
export interface ParsedDays {
  days: TemplateDay[];
  /** Entries with no readable `exercise_id`. See `WorkoutTemplate.unreadableEntries`. */
  dropped: number;
}

/**
 * `workout_templates.days` — arbitrary jsonb as far as PostgREST is concerned —
 * turned into days this app can render.
 *
 * Defensive on purpose, and not because the column is expected to be wrong. It
 * is jsonb: no column type, no NOT NULL and no check constraint stands between
 * a future import and a day object with no `exercises` array. The trigger on
 * the table guards the one thing a trigger CAN guard — that every
 * `exercise_id` names a real movement — and says nothing about shape. A parse
 * that assumed the shape would throw inside a render and take the screen with
 * it; this one drops what it cannot read and counts what it dropped.
 *
 * A day with no readable exercises is KEPT, not dropped. "Day 3 — Legs" with
 * nothing under it is a true statement about a programme that has a third day,
 * and deleting the day would renumber every one after it.
 */
export function parseDays(value: unknown): ParsedDays {
  if (!Array.isArray(value)) return { days: [], dropped: 0 };
  let dropped = 0;
  const days: TemplateDay[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const d = raw as Record<string, unknown>;
    const exercises: TemplateExercise[] = [];
    const list = Array.isArray(d.exercises) ? d.exercises : [];
    for (const rawEx of list) {
      if (!rawEx || typeof rawEx !== 'object' || Array.isArray(rawEx)) { dropped++; continue; }
      const e = rawEx as Record<string, unknown>;
      const exerciseId = str(e.exercise_id);
      // No id is no movement. There is nothing to name, nothing to link to and
      // nothing a member could do with the row, so it does not become one —
      // but it is counted, because a day that is quietly short is worse than a
      // day that says it is.
      if (!exerciseId) { dropped++; continue; }
      exercises.push({
        exerciseId,
        sets: count(e.sets),
        // Trimmed and kept as text. Never Number(), never parseInt(). See the
        // file header for the eleven-of-twenty-six arithmetic.
        reps: str(e.reps),
        restSeconds: count(e.rest_seconds),
        notes: localised(e, 'notes'),
      });
    }
    days.push({ name: localised(d, 'name'), exercises });
  }
  return { days, dropped };
}

/**
 * One PostgREST row of `workout_templates`, or null when it is not one.
 *
 * Null for a row with no id and no English name, which are the two fields
 * nothing downstream can work without — the id is the React key and the route
 * param, and `name_en` is the identity every fallback lands on. Both are NOT
 * NULL in the table; this is what happens if that ever stops being true, and
 * "one row is missing from the list" is a far better outcome than a screen that
 * renders a programme with no name.
 */
export function parseTemplateRow(raw: unknown): WorkoutTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = localised(r, 'name');
  if (!id || !name.en) return null;
  const parsed = parseDays(r.days);
  return {
    id,
    source: str(r.source),
    // Not defaulted to a member of the known set. An unfamiliar goal must
    // render as itself (see `goalLabel`) rather than be silently filed under
    // 'strength', which would put a mobility routine in a strength filter.
    goal: str(r.goal) ?? '',
    difficulty: str(r.difficulty) ?? '',
    frequencyPerWeek: count(r.frequency_per_week),
    tags: Array.isArray(r.tags)
      ? r.tags.map(str).filter((s): s is string => s !== null)
      : [],
    days: parsed.days,
    name,
    description: localised(r, 'description'),
    unreadableEntries: parsed.dropped,
  };
}

/* ── language ─────────────────────────────────────────────────────────────── */

/**
 * The string to put on screen, and the truth about which language it is in.
 *
 * The same contract as `displayName` in src/lib/catalogueLocale.ts and for the
 * same reason, restated over a three-column row instead of a translations
 * table: an English name sitting silently among German ones reads as a
 * translation somebody made, so a reader who does not recognise it assumes it
 * is a term they have not met rather than a gap.
 *
 * Null when there is no string in any language — a description the row simply
 * does not have. That is a real answer and the screen shows nothing, exactly as
 * `displayDescription` does; it is not the same event as a missing translation.
 *
 * Falls back through one step and no further. A German reader with no German
 * gets English, flagged. They never get Spanish.
 */
export function localisedText(s: Localised, want: TranslationLocale | null): DisplayString | null {
  const en = str(s.en);
  if (!want) return en == null ? null : { text: en, locale: CATALOGUE_BASE_LOCALE, isFallback: false };
  const hit = str(want === 'de' ? s.de : s.es);
  if (hit) return { text: hit, locale: want, isFallback: false };
  return en == null ? null : { text: en, locale: CATALOGUE_BASE_LOCALE, isFallback: true };
}

/**
 * The sentence a programme shows when its own words did not translate.
 *
 * A sentence rather than the two-letter badge `fallbackTag` gives a list row,
 * because this appears once at the top of a programme a member is about to
 * follow and there is room to say what actually happened. Null when nothing
 * fell back — an apology on a screen where nothing is wrong is a nag.
 *
 * Deliberately says which PARTS are English. "Some of this is in English" over
 * a page where only the day names fell back sends a reader hunting through the
 * description for a problem that is not in it.
 */
export function templateFallbackNote(
  name: DisplayString | null,
  description: DisplayString | null,
  daysOrNotes: boolean,
): string | null {
  const parts: string[] = [];
  if (name?.isFallback) parts.push('its name');
  if (description?.isFallback) parts.push('its description');
  if (daysOrNotes) parts.push('some of what is written against the days');
  if (!parts.length) return null;
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This programme has not been fully translated, so ${list} ${parts.length === 1 ? 'is' : 'are'} shown in English.`;
}

/** True when any string inside these days falls back to English for `want`. */
export function daysFallBack(days: readonly TemplateDay[], want: TranslationLocale | null): boolean {
  if (!want) return false;
  for (const d of days) {
    if (localisedText(d.name, want)?.isFallback) return true;
    for (const e of d.exercises) {
      if (localisedText(e.notes, want)?.isFallback) return true;
    }
  }
  return false;
}

/* ── the labels a row prints ──────────────────────────────────────────────── */

/**
 * The five goals the fifteen programmes use, in the order a browsing member
 * meets them: what most people came for first, then the two that are somebody's
 * whole session, then the one that is ten minutes before one.
 */
export const TEMPLATE_GOALS = ['strength', 'hypertrophy', 'endurance', 'core', 'mobility'] as const;

/** Easiest first. This is a ladder, and shuffling it makes it not one. */
export const TEMPLATE_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;

const GOAL_LABEL: Record<string, string> = {
  strength: 'Strength',
  hypertrophy: 'Muscle',
  endurance: 'Conditioning',
  core: 'Core',
  mobility: 'Mobility',
};

const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

/**
 * A stored value rendered as itself when we have no label for it.
 *
 * `goal` and `difficulty` are plain `text` columns with no check constraint, so
 * a sixteenth programme can arrive carrying a word this build has never heard
 * of. Dropping the row would hide a real programme; filing it under a
 * neighbouring label would be a lie about what it trains. Printing the word is
 * neither.
 */
function labelled(map: Record<string, string>, raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return '';
  const hit = map[key];
  if (hit) return hit;
  // 'push_pull_legs' → 'Push Pull Legs'. Title-cased because it sits in a row
  // of labels that are (see scripts/check-caps.mjs), and a lone lowercase word
  // among them reads as a rendering fault rather than as a value.
  return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const goalLabel = (goal: string): string => labelled(GOAL_LABEL, goal);
export const difficultyLabel = (d: string): string => labelled(DIFFICULTY_LABEL, d);
export const tagLabel = (tag: string): string => labelled({}, tag);

/**
 * "3 days a week", or null when the row does not say.
 *
 * Null and not "unknown": a member reading a list of fifteen does not need
 * fifteen admissions, and the one programme with no cadence simply does not
 * carry that line. `frequency_per_week` is a smallint and the live values are 3
 * to 7, so no separator is needed and none is added.
 */
export function frequencyLabel(perWeek: number | null): string | null {
  if (perWeek == null || perWeek <= 0) return null;
  return perWeek === 1 ? 'Once a week' : `${perWeek} days a week`;
}

/**
 * The rest between sets, in words.
 *
 * Three outcomes, and the middle one is the reason this is a function:
 *
 *   null  the programme does not say. The row prints nothing.
 *   0     the programme says NOT TO REST. That is an instruction — the
 *         kettlebell complex and the core finisher are performed back-to-back
 *         — and it is the value most easily destroyed by a falsy check.
 *   n     seconds, as minutes once it divides evenly, because "3 min" is how a
 *         coach says 180 and "180 sec" is how a database does.
 */
export function restLabel(seconds: number | null): string | null {
  if (seconds == null) return null;
  if (seconds <= 0) return 'Straight into the next';
  if (seconds < 60) return `${seconds} sec rest`;
  const min = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (rem === 0) return `${min} min rest`;
  return `${min} min ${rem} sec rest`;
}

/**
 * "5 × 5", "3 × AMRAP", "4 × 30s" — the sets and the instruction beside them.
 *
 * The × is the multiplication sign and not the letter x, because it is read
 * aloud as "times" and the letter is not. Null when neither half is recorded;
 * either half alone is still worth printing, because "AMRAP" with no set count
 * still tells a member what to do and "3 sets" still tells them how many.
 */
export function setsLabel(sets: number | null, reps: string | null): string | null {
  const r = reps == null ? null : reps.trim() || null;
  if (sets == null && r == null) return null;
  if (sets == null) return r;
  if (r == null) return sets === 1 ? '1 set' : `${sets} sets`;
  return `${sets} × ${r}`;
}

/**
 * The whole of an exercise row as one sentence, for a screen reader.
 *
 * React Native merges a touchable's children into one element and an
 * `accessibilityLabel` REPLACES what they say (see scripts/check-a11y.mjs), so
 * a row labelled with only the movement name would hide the sets, the reps and
 * the rest from the one reader who cannot see them on the line.
 */
export function exerciseSpoken(name: string, sets: number | null, reps: string | null, restSeconds: number | null): string {
  // Spelled out rather than reusing setsLabel: "5 × 5" is announced by
  // VoiceOver as "5 times 5", which is arithmetic, not a prescription.
  const load = sets == null
    ? (reps == null ? null : reps)
    : reps == null
      ? (sets === 1 ? '1 set' : `${sets} sets`)
      : `${sets === 1 ? '1 set' : `${sets} sets`} of ${reps}`;
  return [name, load, restLabel(restSeconds)].filter(Boolean).join(', ');
}

/* ── counting, and what may be counted ────────────────────────────────────── */

/** Movements listed across every day. Only what the row actually holds. */
export function exerciseCount(t: WorkoutTemplate): number {
  let n = 0;
  for (const d of t.days) n += d.exercises.length;
  return n;
}

/**
 * "2 days · 11 exercises", or null when the programme lists no days at all.
 *
 * Null rather than "0 days", which reads as a measurement of a programme
 * instead of as the absence of one. The screens say the empty case in words.
 */
export function shapeLine(t: WorkoutTemplate): string | null {
  if (!t.days.length) return null;
  const days = t.days.length === 1 ? '1 day' : `${t.days.length} days`;
  const ex = exerciseCount(t);
  if (!ex) return days;
  return `${days} · ${ex === 1 ? '1 exercise' : `${ex} exercises`}`;
}

/**
 * The sentence a programme carries when part of it could not be read.
 *
 * Null on the ordinary case. When it is not null it is about the ROW, not
 * about the network: these entries came back and had nothing in them we could
 * name, so they are not on screen and the day is shorter than the programme
 * says it is.
 */
export function unreadableNote(t: WorkoutTemplate): string | null {
  if (t.unreadableEntries <= 0) return null;
  return t.unreadableEntries === 1
    ? 'One movement in this programme could not be read and is not listed below, so a day here is one exercise shorter than the programme is.'
    : `${t.unreadableEntries} movements in this programme could not be read and are not listed below, so what you see is shorter than the programme is.`;
}

/** Every distinct exercise id these programmes name, in the order first met. */
export function exerciseIdsIn(templates: readonly WorkoutTemplate[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of templates) {
    for (const d of t.days) {
      for (const e of d.exercises) {
        if (seen.has(e.exerciseId)) continue;
        seen.add(e.exerciseId);
        out.push(e.exerciseId);
      }
    }
  }
  return out;
}

/* ── filtering ────────────────────────────────────────────────────────────── */

/**
 * How often a member can train, as the three answers people actually give.
 *
 * Bands rather than the exact numbers, because the exact numbers are a property
 * of the fifteen rows and not of the question. The live values are 3, 4, 6 and
 * 7; a chip row built from them would gain and lose chips as the catalogue
 * grows, and "5" would appear the day a programme uses it and read as a filter
 * that had been broken until then.
 *
 * `max` is inclusive. `null` means no upper bound.
 */
export const FREQUENCY_BANDS = [
  { key: 'upto3', label: 'Up to 3 Days', min: 1, max: 3 },
  { key: '4to5', label: '4 to 5 Days', min: 4, max: 5 },
  { key: '6plus', label: '6 Days or More', min: 6, max: null },
] as const;

export type FrequencyBandKey = (typeof FREQUENCY_BANDS)[number]['key'];

export interface TemplateFilter {
  /** A `goal` value, or null for every goal. */
  goal: string | null;
  /** A `difficulty` value, or null for every level. */
  difficulty: string | null;
  /** A band key, or null for any cadence. */
  frequency: FrequencyBandKey | null;
}

export const NO_FILTER: TemplateFilter = { goal: null, difficulty: null, frequency: null };

/** True when anything is narrowing the list — what an empty result hangs on. */
export function isFiltering(f: TemplateFilter): boolean {
  return f.goal !== null || f.difficulty !== null || f.frequency !== null;
}

/**
 * The programmes matching a filter.
 *
 * A programme with NO `frequency_per_week` matches every band filter's
 * opposite: it is excluded the moment a band is chosen, because the row does
 * not claim a cadence and putting it under "up to 3 days" would be this app
 * asserting one. Under no band filter it is listed like everything else.
 *
 * Matching is case-insensitive on the stored value, so a row imported as
 * 'Strength' is not a fourth goal.
 */
export function filterTemplates(
  templates: readonly WorkoutTemplate[],
  f: TemplateFilter,
): WorkoutTemplate[] {
  const band = f.frequency ? FREQUENCY_BANDS.find((b) => b.key === f.frequency) ?? null : null;
  return templates.filter((t) => {
    if (f.goal && t.goal.trim().toLowerCase() !== f.goal.trim().toLowerCase()) return false;
    if (f.difficulty && t.difficulty.trim().toLowerCase() !== f.difficulty.trim().toLowerCase()) return false;
    if (band) {
      const n = t.frequencyPerWeek;
      if (n == null) return false;
      if (n < band.min) return false;
      if (band.max != null && n > band.max) return false;
    }
    return true;
  });
}

/**
 * The goals and levels actually present, in the house order, with anything the
 * data carries that this build does not know about appended.
 *
 * Built from the rows rather than from the constants, so a chip is never
 * offered that filters to nothing — a member who taps "Mobility" and is shown
 * an empty list has been told, wrongly, that the mobility routine was removed.
 *
 * Only safe over a WHOLE read: over a truncated one, a goal missing from the
 * page is not a goal missing from the catalogue. The callers gate this on
 * `isWhole`, and this function cannot see the status, so it does not pretend
 * to — see the comment at each call site.
 */
export function goalsPresent(templates: readonly WorkoutTemplate[]): string[] {
  return presentIn(templates.map((t) => t.goal), TEMPLATE_GOALS);
}

export function difficultiesPresent(templates: readonly WorkoutTemplate[]): string[] {
  return presentIn(templates.map((t) => t.difficulty), TEMPLATE_DIFFICULTIES);
}

function presentIn(values: readonly string[], order: readonly string[]): string[] {
  const have = new Set<string>();
  for (const v of values) {
    const k = v.trim().toLowerCase();
    if (k) have.add(k);
  }
  const known = order.filter((k) => have.has(k));
  const unknown = [...have].filter((k) => !order.includes(k)).sort();
  return [...known, ...unknown];
}
