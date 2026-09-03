// The three answers a coach's own calorie target is built from.
//
// ── What was being computed, and out of what ──────────────────────────────
//
// app/(trainer)/my-nutrition.tsx builds the coach's day with
//
//     macrosFor({ weightKg, bodyFatPct, activity, goal, diet })
//
// and took the last three off `useClientData`, which reads `clients` — a table
// a coach has no row in. app/(trainer)/my-progress.tsx states the consequence
// already: "the goal, diet and height on that provider are constructed defaults
// for a coach rather than answers a coach gave". They are `'muscle'`, `'meat'`
// and a literal `1.5`, which through src/lib/nutrition.ts is a twelve per cent
// surplus, protein at 2.0 g per kg of lean mass and fat at 27%.
//
// So a coach who is cutting was handed a bulking target, headed "Calories
// Remaining", and counted down against it all day — on a screen that is
// otherwise scrupulous about not saying more than it knows.
//
// ── What this module is ───────────────────────────────────────────────────
//
// The vocabulary for asking, and the rule for when a target may be built at
// all. Storage is `coach_prefs.own_goal / own_diet / own_activity`
// (supabase/parts/1020) and the reads are in src/lib/coachPrefsStore.ts; there
// is no clock, no network and no React here, so every rule below runs under
// `npm test`.
//
// ── Why activity is a named level and not a number in a box ───────────────
//
// Because 1.5 means nothing to a person and everything to the answer. The
// multiplier is the largest single input to a maintenance figure — the gap
// between sedentary and very active is over 50% of BMR — and asking for it as a
// decimal invites a coach to type a number they have no way to calibrate. The
// levels below are the standard Harris–Benedict activity factors, each with the
// sentence that says which one somebody actually is.
import type { Diet, Goal } from './types';
import type { LoadStatus } from '../ui/loadStatus';

/** How much a coach moves, as a thing a person can pick. */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very-active';

export interface ActivityChoice {
  id: ActivityLevel;
  label: string;
  /** What that level actually describes, in a coach's own week. */
  note: string;
  /** The multiplier applied to BMR. See src/lib/nutrition.ts `maintenanceFor`. */
  factor: number;
}

/**
 * The five levels, in order, with the multiplier each one means.
 *
 * The factors are the published Harris–Benedict set and are not this app's
 * invention. They are stated here once so the database constraint
 * (supabase/parts/1020) and the app agree on the range, and so that no screen
 * ever writes a bare number of its own.
 */
export const ACTIVITY_LEVELS: readonly ActivityChoice[] = [
  { id: 'sedentary', label: 'Sedentary', note: 'Desk work, no training beyond walking about.', factor: 1.2 },
  { id: 'light', label: 'Lightly active', note: 'On your feet some of the day, or training one to three times a week.', factor: 1.375 },
  { id: 'moderate', label: 'Moderately active', note: 'Coaching sessions most days, or training three to five times a week.', factor: 1.55 },
  { id: 'active', label: 'Very active', note: 'On the floor all day, or training six or seven times a week.', factor: 1.725 },
  { id: 'very-active', label: 'Extremely active', note: 'Physical work plus daily training, or two sessions a day.', factor: 1.9 },
];

/** The multiplier for a level. */
export function activityFactor(level: ActivityLevel): number {
  return ACTIVITY_LEVELS.find((a) => a.id === level)?.factor ?? 1.55;
}

/**
 * The level a stored multiplier belongs to, or null.
 *
 * Nearest rather than exact, because a row written by an earlier build — or by
 * hand — may carry a value between two levels, and a coach whose stored figure
 * is 1.5 is not wrong, only unlabelled. Null for anything outside the range the
 * constraint allows, so a nonsense value is asked again rather than snapped to
 * the nearest sensible-looking one.
 */
export function activityLevelOf(factor: number | null | undefined): ActivityLevel | null {
  if (factor == null || !Number.isFinite(factor)) return null;
  if (factor < 1 || factor > 2.5) return null;
  let best: ActivityChoice = ACTIVITY_LEVELS[0];
  for (const a of ACTIVITY_LEVELS) {
    if (Math.abs(a.factor - factor) < Math.abs(best.factor - factor)) best = a;
  }
  return best.id;
}

/** A stored `own_goal`, or null when it is not one of the three. */
export function asOwnGoal(v: unknown): Goal | null {
  return v === 'fatloss' || v === 'tone' || v === 'muscle' ? v : null;
}

/** A stored `own_diet`, or null when it is not one of the five. */
export function asOwnDiet(v: unknown): Diet | null {
  return v === 'meat' || v === 'vegetarian' || v === 'vegan' || v === 'paleo' || v === 'keto' ? v : null;
}

/** What the coach has told us about themselves. Every field null until asked. */
export interface OwnMacroInputs {
  goal: Goal | null;
  diet: Diet | null;
  activity: number | null;
}

/** Whether a target may be computed, and what is stopping it. */
export type MacroGate =
  | { ok: true; goal: Goal; diet: Diet; activity: number }
  | { ok: false; reason: 'reading' | 'unread' | 'unmeasured' | 'unasked'; why: string };

/**
 * The one decision this screen turns on.
 *
 * Every refusal is its own sentence, because to a coach they are four different
 * situations and only one of them is anything they can act on now:
 *
 *   'reading'    — the answers have not arrived. Nothing is claimed either way.
 *   'unread'     — the read failed. NOT "you have not answered", which would
 *                  invite a coach to answer a second time and, worse, would
 *                  read as a reason to accept a target built from defaults.
 *   'unmeasured' — no weight or no body fat on record, which is the gate this
 *                  screen already had and is kept exactly as it was.
 *   'unasked'    — the coach genuinely has not said. This is the one with a
 *                  control under it.
 *
 * `measured` is passed rather than read here so this module never touches a
 * body: the screen already knows whether it has one.
 */
export function macroGate(o: {
  status: LoadStatus;
  inputs: OwnMacroInputs;
  measured: boolean;
}): MacroGate {
  if (o.status === 'loading') {
    return { ok: false, reason: 'reading', why: 'Reading the answers your target is built from.' };
  }
  if (o.status === 'error') {
    return {
      ok: false,
      reason: 'unread',
      why: 'Your goal, diet and activity level could not be read, so no target is worked out. That is a read that failed rather than questions you have not answered — pull down to try again.',
    };
  }
  if (!o.measured) {
    return {
      ok: false,
      reason: 'unmeasured',
      why: 'A target needs a weight and a body-fat figure on record. Add a weigh-in and a scan, and this will work itself out from them.',
    };
  }
  const { goal, diet, activity } = o.inputs;
  if (goal == null || diet == null || activity == null) {
    return { ok: false, reason: 'unasked', why: unaskedLine({ goal, diet, activity }) };
  }
  return { ok: true, goal, diet, activity };
}

/**
 * Which of the three is still missing, said by name.
 *
 * Named rather than counted, because the coach has to know which control to
 * touch — and because "answer three questions" is a chore while "we do not know
 * your goal" is a sentence somebody finishes.
 */
export function unaskedLine(i: OwnMacroInputs): string {
  const missing: string[] = [];
  if (i.goal == null) missing.push('what you are training for');
  if (i.diet == null) missing.push('how you eat');
  if (i.activity == null) missing.push('how active your week is');
  const list = missing.length === 1
    ? missing[0]
    : missing.length === 2
      ? `${missing[0]} or ${missing[1]}`
      : `${missing.slice(0, -1).join(', ')} or ${missing[missing.length - 1]}`;
  return `You have not told this app ${list}, so it will not put a calorie target in front of you. `
    + 'It used to assume you were building muscle, eating meat and moderately active, and count the day down against that.';
}

/** What the screen says once the three are answered — so a number a coach reads
 *  all day carries the assumptions it was built from. */
export function builtFromLine(goal: Goal, diet: Diet, activity: number): string {
  const level = activityLevelOf(activity);
  const label = ACTIVITY_LEVELS.find((a) => a.id === level)?.label.toLowerCase() ?? 'the activity level you set';
  return `Built from your own answers: ${GOAL_WORD[goal]}, ${DIET_WORD[diet]}, ${label}. Change any of them and the target moves.`;
}

export const GOAL_WORD: Record<Goal, string> = {
  fatloss: 'losing fat',
  tone: 'holding your weight',
  muscle: 'building muscle',
};

export const DIET_WORD: Record<Diet, string> = {
  meat: 'eating meat',
  vegetarian: 'vegetarian',
  vegan: 'vegan',
  paleo: 'paleo',
  keto: 'keto',
};
