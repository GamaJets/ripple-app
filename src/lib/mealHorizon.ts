// How far ahead a member is planning — a day, a week, a month — and the
// recipes they have planned for a DATE rather than for a weekday.
//
// ── Why this is a second layer and not a reshape ───────────────────────────
//
// `src/lib/recipePlan.ts` keys a member's planned recipes by WEEKDAY, and its
// header argues for it at length: a recipe chosen for a day is a day's meal,
// not a standing choice for every day for ever. What it left behind is a
// standing choice for every TUESDAY, which is a real and useful thing to have
// said — "chicken every Tuesday" — and is exactly what the coach's own
// `coach_nutrition.recipe_refs` means too (`src/lib/coachRecipeRefs.ts`).
//
// "Plan Thursday the 25th" is a different sentence. Turning the weekday map
// into a date map would express it by destroying the other one, so this file
// adds the date map ALONGSIDE, and one function decides which of the three
// sources a slot is showing:
//
//     the date entry, then the weekday entry, then the coach's pin.
//
// Nearest wins. A member who plans Thursday the 25th has not cancelled every
// Thursday, and a member who plans every Tuesday has not overwritten the one
// Tuesday they already planned by hand. `plannedRecipeAt` returns WHICH of the
// three answered, because a row a member cannot trace is a row they cannot
// clear.
//
// ── What is kept ───────────────────────────────────────────────────────────
//
// A `RecipeRef` and nothing else, for the licence reason recipePlan.ts sets
// out: the terms allow the id, the title and the image url to be stored, and
// nothing derived from them. Both directions go through that file's own
// `dayRefsOf`, so the two layers cannot come to keep different things.
import { addDays } from './termDates';
import { planDayIndex } from './mealPlan';
import { dayRefsOf, recipePlanAt, type RecipePlan } from './recipePlan';
import { coachRecipeRefAt, type CoachRecipeRefs } from './coachRecipeRefs';
import { recipeRef, type RecipeMeal, type RecipeRef } from './recipes';

/** How far ahead the member is looking and planning. */
export type Horizon = 'today' | 'week' | 'month';

/** A month is thirty days, not a calendar month: a horizon that changed length
 *  with the month you happened to open it in would make "this month" mean
 *  something different on 1 February and on 1 March. */
const HORIZON_DAYS: Record<Horizon, number> = { today: 1, week: 7, month: 30 };

/** One day of the horizon: the reader's own date, which day of the plan's week
 *  that date is, and how far ahead of today it sits. */
export interface HorizonDay {
  /** `YYYY-MM-DD`, the reader's own calendar day. */
  key: string;
  /** The index into the week AS DRAWN — what `planDayIndex` returns, and what
   *  the weekday layer and the coach's week are both keyed by. */
  weekday: number;
  /** 0 is today. The synthetic catalogue step is taken by this, so the days
   *  ahead differ from today rather than from the start of the week. */
  offset: number;
}

/**
 * The days the member is looking at, today first.
 *
 * A `todayKey` that is not a date gives ONE day — the plan's own, with no date
 * on it. The empty key matches nothing in the date layer, so an unreadable
 * clock serves the plan and the weekday choices and never somebody's Thursday
 * on the wrong day.
 */
export function horizonDays(todayKey: string, horizon: Horizon): HorizonDay[] {
  const none: HorizonDay[] = [{ key: '', weekday: 0, offset: 0 }];
  const days = HORIZON_DAYS[horizon];
  if (!days) return none;
  const out: HorizonDay[] = [];
  for (let offset = 0; offset < days; offset++) {
    const key = offset === 0 ? todayKey : addDays(todayKey, offset);
    const weekday = key ? planDayIndex(key) : null;
    if (!key || weekday == null) return out.length ? out : none;
    out.push({ key, weekday, offset });
  }
  return out;
}

/** Every date-planned-recipe key starts with this. Here so the shape can be
 *  asserted and recognised, as `RECIPE_PLAN_PREFIX` is for the weekday layer. */
export const RECIPE_DATES_PREFIX = 'repple.recipeDates:';

/** Where this member's date-planned recipes live. Null is DO NOT PERSIST —
 *  `recipePlanKey`'s rule, for `recipePlanKey`'s reason: a key with no account
 *  in it is a key the next member on a shared handset inherits. */
export function recipeDatePlanKey(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  if (!id || id === 'unknown') return null;
  return `${RECIPE_DATES_PREFIX}${id}`;
}

/** `YYYY-MM-DD` → slot position → the recipe planned there, for that one day. */
export type DatedRecipePlan = Record<string, Record<number, RecipeRef>>;

/** A stored key is a real calendar day or it is not a day at all. The shape
 *  first, then the day itself: `2026-13-40` is the right shape and is not a
 *  date, and `addDays(k, 0)` — which parses and re-emits — is the cheapest
 *  thing in the repo that already knows that. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const isDateKey = (k: string): boolean => DATE_KEY.test(k) && addDays(k, 0) === k;

const isPos = (pos: number) => Number.isInteger(pos) && pos >= 0;

/** A map of anything reduced to the dates and positions holding a real ref.
 *  Shared by the reader and the writer so the two cannot drift — and it is
 *  `dayRefsOf` underneath, so both layers keep the same three facts. */
function datesOf(v: unknown): DatedRecipePlan {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: DatedRecipePlan = {};
  for (const [key, day] of Object.entries(v as Record<string, unknown>)) {
    if (!isDateKey(key)) continue;
    const refs = dayRefsOf(day);
    if (Object.keys(refs).length) out[key] = refs;
  }
  return out;
}

/** The date-planned recipes read back off a stored string. Anything unreadable
 *  is none planned — `readRecipePlan`'s rule and its reason. */
export function readDatedRecipePlan(raw: string | null | undefined): DatedRecipePlan {
  if (!raw) return {};
  try { return datesOf(JSON.parse(raw)); } catch { return {}; }
}

/** As it goes to the store: refs, and only refs, whatever it was handed. */
export function writeDatedRecipePlan(plan: DatedRecipePlan): string {
  return JSON.stringify(datesOf(plan ?? {}));
}

/** The plan with this recipe on this date, at this slot. Takes the DISH and
 *  keeps the ref. A key that is not a date, or a position that is not one,
 *  changes nothing. */
export function withDatedRecipeAt(plan: DatedRecipePlan, key: string, pos: number, meal: RecipeMeal): DatedRecipePlan {
  if (!isDateKey(key) || !isPos(pos)) return plan;
  return { ...plan, [key]: { ...(plan[key] ?? {}), [pos]: recipeRef(meal) } };
}

/** The plan with nothing chosen on that date at that slot — the slot falls back
 *  to whatever is behind it, which may be a weekday choice or the coach's pin.
 *  The same object for a no-op, so a state setter fed this does not re-render. */
export function withoutDatedRecipeAt(plan: DatedRecipePlan, key: string, pos: number): DatedRecipePlan {
  const held = plan[key];
  if (!held || !(pos in held)) return plan;
  const rest = { ...held };
  delete rest[pos];
  const next = { ...plan };
  if (Object.keys(rest).length) next[key] = rest; else delete next[key];
  return next;
}

/** The three places a planned recipe can come from, nearest first. */
export type PlannedFrom = 'date' | 'weekday' | 'coach';

/** What every surface reads through: the date layer, the weekday layer, and
 *  the coach's pins. */
export interface PlannedRecipeSource {
  dates: DatedRecipePlan;
  weekdays: RecipePlan;
  coach: CoachRecipeRefs;
}

/**
 * THE RESOLUTION ORDER, in one function.
 *
 * The date entry, then the weekday entry, then the coach's pin, then null —
 * which the caller reads as the plan's own generated meal. Every surface goes
 * through this: today's list, the horizon list, the grocery sheet and the
 * shared document, exactly as `withRecipes` already did for one day.
 *
 * `from` travels with the ref because a member must be able to see which of
 * the two choices a row came from, and clear either one.
 */
export function plannedRecipeAt(src: PlannedRecipeSource, day: HorizonDay, pos: number): { ref: RecipeRef; from: PlannedFrom } | null {
  if (!isPos(pos)) return null;
  const onDate = day.key ? src.dates[day.key]?.[pos] ?? null : null;
  if (onDate) return { ref: onDate, from: 'date' };
  const weekly = recipePlanAt(src.weekdays, day.weekday, pos);
  if (weekly) return { ref: weekly, from: 'weekday' };
  const pinned = coachRecipeRefAt(src.coach, day.weekday, pos);
  return pinned ? { ref: pinned, from: 'coach' } : null;
}
