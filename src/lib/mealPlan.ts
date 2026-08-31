// ── A coach's authored meal plan ─────────────────────────────────────────────
//
// What a coach could do before this file existed: move a client's calorie and
// macro targets by a delta, and pin ONE meal per slot for ONE day
// (`coach_nutrition.meal_override`, a flat position → catalogue-index map). What
// they could not do is write a plan — a week, a day at a time, that a client can
// open on a Thursday and follow.
//
// ── Where it is stored, and why not `meal_plans` ─────────────────────────────
//
// `meal_plans` has been in the schema since 01-schema.sql and no line of this
// repository has ever read or written it. It is not chosen here, and part
// 133 drops it. The full argument is in that file; the short form is that it
// stores `targets` as a frozen jsonb snapshot, which would put a SECOND calorie
// figure in the product beside the one macrosFor() derives live from the
// client's body. Two calorie figures for one day is the exact defect
// caloriesLeft() in ./nutrition.ts was written to end.
//
// So the plan lives on `coach_nutrition`, in a `plan` column, beside the deltas
// it is composed against — one row per client, the row the client's Meals tab
// already reads, under the policies part 69 already wrote.
//
// ── This file computes no target ─────────────────────────────────────────────
//
// Nothing here decides what anybody should eat. Every calorie and macro figure
// downstream of this module comes from `buildPlan` in ./meals.ts, which is
// `macrosFor` (Katch–McArdle, the client's own body, their own goal) with the
// coach's own deltas layered on by `applyCoachAdjust`. This module only records
// WHICH meals the coach chose, and hands the choice back in the shape
// `buildPlan` already accepts. A coach setting a target is a coaching decision;
// nothing in this file turns it into a clinical one, and nothing here tells
// anybody a number is safe.
//
// ── The index space is defined by the allergens ──────────────────────────────
//
// This is the part that has to be got right, and it is not obvious.
// `mealAt(diet, slot, idx, avoid)` resolves an index through pools that `avoid`
// has already FILTERED. Shrinking a pool renumbers everything after it, so
// index 412 under `avoid: []` and index 412 under `avoid: ['nuts']` are two
// different dinners. A plan is therefore only meaningful alongside the three
// inputs it was resolved against — diet, allergens, meals per day — so a plan
// carries all three, and `planStale` is how a screen finds out that the client
// has moved since.
//
// That is also why the plan snapshots each meal's NAME and per-serving macros
// as the coach saw them. It is not a cache: it is the evidence that lets
// `planStale` say "the client is no longer being shown the meal you chose"
// instead of silently serving them something else under a coach's name.
//
// A client disclosing a new allergen after a plan was written is the case this
// exists for. It is the same shape as the injury acknowledgement in
// ./injuryGate.ts and is answered the same way: the coach is stopped by news.
import type { Diet } from './types';
import { buildPlan, catalogSize, mealAt, slotsFor, type Allergen, type PlanInput, type Slot } from './meals';
import { weekdayOfIso } from './dayPlan';
import type { LoadStatus } from '../ui/loadStatus';

/** Bumped only when a stored plan's shape changes in a way a reader must know
 *  about. `parsePlan` refuses anything it does not recognise rather than
 *  guessing, because a half-understood plan reaching a client is worse than
 *  none. */
export const PLAN_VERSION = 1;

/** A plan is a week. Not a month, and not a single day. */
export const PLAN_DAYS = 7;

/** Monday first, matching the week strip the client's Meals tab already draws.
 *  Deliberately NOT `Date.getDay()`'s Sunday-first order — see planDayIndex. */
export const PLAN_WEEKDAYS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * One chosen meal: the index that names it, and the meal that index resolved
 * to at the moment the coach chose it.
 *
 * `idx` is what the client's `buildPlan` consumes. The rest is the coach's
 * record of what they committed to, and the only way to detect that the index
 * has since come to mean something else.
 */
export interface PlanMeal {
  slot: Slot;
  idx: number;
  /** The meal's name as the coach saw it. */
  n: string;
  /** Per-serving macros as decoded then. The client's app scales these to their
   *  live target; these are not a second target. */
  k: number; p: number; c: number; f: number;
}

export interface PlanDay {
  /** One entry per slot, in slot order — `meals[i]` is position `i`, which is
   *  the key `buildPlan`'s `mealOverride` is read by. */
  meals: PlanMeal[];
}

export interface CoachMealPlan {
  v: number;
  /** The three inputs that DEFINE what every `idx` below means. A plan read
   *  back against different ones is not this plan. */
  diet: Diet;
  avoid: Allergen[];
  mealsPerDay: 3 | 4 | 5;
  days: PlanDay[];
  /** When the coach last sent it. ISO instant. */
  writtenAt: string;
}

/**
 * Monday-first day index for a calendar day, or null when the date is
 * unreadable.
 *
 * `weekdayOfIso` answers 0 Sun … 6 Sat because that is what `Date.getDay()`
 * gives and what `scheduledFocus` wants. The client's Meals tab lays its week
 * out Mon…Sun, so a plan stored in getDay() order would hand a client Sunday's
 * dinners on a Monday — off by one, every week, in the direction nobody checks.
 */
export function planDayIndex(dateISO: string): number | null {
  const w = weekdayOfIso(dateISO);
  return w == null ? null : (w + 6) % 7;
}

/** Decode an index and snapshot what it resolved to. */
export function capturePlanMeal(diet: Diet, slot: Slot, idx: number, avoid: readonly Allergen[]): PlanMeal {
  const size = catalogSize(diet, slot, avoid as Allergen[]);
  const safe = size > 0 ? ((idx % size) + size) % size : 0;
  const m = mealAt(diet, slot, safe, avoid as Allergen[]);
  return { slot, idx: safe, n: m.n, k: m.k, p: m.p, c: m.c, f: m.f };
}

/**
 * A week to start editing from: the day the client is already being shown,
 * then six variations of it.
 *
 * Stepping each index by the day number is exactly what the client's Meals tab
 * does for its own week preview, so a coach who opens this screen and saves
 * without touching anything has committed the week the client could already
 * see. A seed that invented a different week would make "send" a change the
 * coach did not make.
 */
export function seedPlan(input: PlanInput, writtenAtISO: string): CoachMealPlan {
  const avoid = [...(input.avoid ?? [])];
  const slots = slotsFor(input.mealsPerDay);
  const day0 = buildPlan(input).plan;
  const days: PlanDay[] = [];
  for (let d = 0; d < PLAN_DAYS; d++) {
    days.push({
      meals: slots.map((slot, i) => capturePlanMeal(input.diet, slot, (day0[i]?.idx ?? 0) + d, avoid)),
    });
  }
  return { v: PLAN_VERSION, diet: input.diet, avoid, mealsPerDay: input.mealsPerDay, days, writtenAt: writtenAtISO };
}

const SLOTS: readonly Slot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const DIETS: readonly Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const ALLERGEN_IDS: readonly Allergen[] = ['dairy', 'gluten', 'nuts', 'shellfish', 'egg', 'soy'];

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A stored plan, or null.
 *
 * Null means "there is no plan here", and it is the ONLY thing that may be
 * rendered as one. A read that failed is a LoadStatus, not a null — see
 * guardPlan, which refuses to let the two be confused.
 *
 * Everything is checked rather than cast. jsonb is whatever was written to it,
 * including by an older build of this app, and a plan half-understood is a
 * client eating meals nobody chose.
 */
export function parsePlan(raw: unknown): CoachMealPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== PLAN_VERSION) return null;
  if (typeof o.diet !== 'string' || !DIETS.includes(o.diet as Diet)) return null;
  const mpd = o.mealsPerDay;
  if (mpd !== 3 && mpd !== 4 && mpd !== 5) return null;
  if (!Array.isArray(o.days) || o.days.length !== PLAN_DAYS) return null;

  const avoid = Array.isArray(o.avoid)
    ? (o.avoid.filter((a): a is Allergen => typeof a === 'string' && ALLERGEN_IDS.includes(a as Allergen)))
    : [];
  const want = slotsFor(mpd);
  const days: PlanDay[] = [];
  for (const d of o.days) {
    if (!d || typeof d !== 'object') return null;
    const list = (d as Record<string, unknown>).meals;
    if (!Array.isArray(list) || list.length !== want.length) return null;
    const meals: PlanMeal[] = [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || typeof m !== 'object') return null;
      const r = m as Record<string, unknown>;
      // The slot is not taken on trust: a plan whose position 2 says
      // 'Breakfast' where the client's meals-per-day puts a Snack would resolve
      // its index through the wrong catalogue entirely.
      if (typeof r.slot !== 'string' || !SLOTS.includes(r.slot as Slot) || r.slot !== want[i]) return null;
      if (!isFiniteNum(r.idx) || r.idx < 0) return null;
      if (typeof r.n !== 'string' || !r.n) return null;
      if (!isFiniteNum(r.k) || !isFiniteNum(r.p) || !isFiniteNum(r.c) || !isFiniteNum(r.f)) return null;
      meals.push({ slot: r.slot as Slot, idx: Math.floor(r.idx), n: r.n, k: r.k, p: r.p, c: r.c, f: r.f });
    }
    days.push({ meals });
  }
  const writtenAt = typeof o.writtenAt === 'string' ? o.writtenAt : '';
  return { v: PLAN_VERSION, diet: o.diet as Diet, avoid, mealsPerDay: mpd, days, writtenAt };
}

/**
 * One day of the plan in the shape `buildPlan` already takes.
 *
 * This is the whole bridge to the client. Their Meals tab passes
 * `mealOverride` straight into `buildPlan`; a coach's day is that map, so the
 * plan reaches them through the path that already exists rather than a second
 * one drawn alongside it.
 */
export function planDayOverride(plan: CoachMealPlan, dayIdx: number): Record<number, number> {
  const day = plan.days[dayIdx];
  const out: Record<number, number> = {};
  if (!day) return out;
  day.meals.forEach((m, i) => { out[i] = m.idx; });
  return out;
}

/** Replace one slot on one day. Immutable, so a screen's undo is a reference. */
export function setPlanMeal(plan: CoachMealPlan, dayIdx: number, pos: number, idx: number): CoachMealPlan {
  const day = plan.days[dayIdx];
  if (!day || !day.meals[pos]) return plan;
  const meals = day.meals.map((m, i) => (i === pos ? capturePlanMeal(plan.diet, m.slot, idx, plan.avoid) : m));
  const days = plan.days.map((d, i) => (i === dayIdx ? { meals } : d));
  return { ...plan, days };
}

/** Copy one authored day over another — "Thursday is Monday again". */
export function copyPlanDay(plan: CoachMealPlan, fromDay: number, toDay: number): CoachMealPlan {
  const src = plan.days[fromDay];
  if (!src || !plan.days[toDay] || fromDay === toDay) return plan;
  const days = plan.days.map((d, i) => (i === toDay ? { meals: src.meals.map((m) => ({ ...m })) } : d));
  return { ...plan, days };
}

/** Base calories of a day at one serving each — what the coach composed, before
 *  the client's app scales it to their target. Never presented as a target. */
export function planDayBaseKcal(plan: CoachMealPlan, dayIdx: number): number {
  const day = plan.days[dayIdx];
  return day ? day.meals.reduce((a, m) => a + m.k, 0) : 0;
}

/** One meal that no longer resolves to the meal the coach chose. */
export interface PlanDivergence {
  dayIdx: number;
  pos: number;
  slot: Slot;
  /** What the coach committed. */
  was: string;
  /** What the client's app resolves that same index to now. */
  now: string;
}

export interface PlanStale {
  /** True when anything below is true. The one thing a caller has to read. */
  stale: boolean;
  /** Allergens the client has disclosed SINCE the plan was written. The reason
   *  this whole check exists. */
  addedAvoid: Allergen[];
  /** Allergens they have dropped. Harmless for safety and still renumbers the
   *  catalogue, which is why it is separate rather than lumped in. */
  droppedAvoid: Allergen[];
  dietChanged: boolean;
  mealsPerDayChanged: boolean;
  /** Meals whose index now names something else. */
  diverged: PlanDivergence[];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * Has the client moved out from under the plan their coach wrote?
 *
 * Compared against the client's CURRENT diet, allergens and meals per day —
 * the three inputs `mealAt` resolves an index through. Any of them changing
 * renumbers the catalogue, so the meals a client is served stop being the ones
 * the coach picked without a single row changing anywhere.
 *
 * `addedAvoid` is the case with a person on the other end of it. A plan written
 * on Monday, a nut allergy disclosed on Wednesday, and a plan that still says
 * trail mix — the divergence list below will usually catch it as a side effect
 * of the renumbering, but "usually" is not a thing to build an allergen check
 * on, so the disclosure is compared directly and named in its own right.
 */
export function planStale(
  plan: CoachMealPlan,
  diet: Diet,
  avoid: readonly Allergen[],
  mealsPerDay: 3 | 4 | 5,
): PlanStale {
  const now = [...avoid];
  const addedAvoid = now.filter((a) => !plan.avoid.includes(a));
  const droppedAvoid = plan.avoid.filter((a) => !now.includes(a));
  const dietChanged = plan.diet !== diet;
  const mealsPerDayChanged = plan.mealsPerDay !== mealsPerDay;

  const diverged: PlanDivergence[] = [];
  // Only worth walking when the plan's slots still line up with the client's;
  // under a changed meals-per-day every position is a different slot and the
  // comparison would be noise on top of a fact already established above.
  if (!mealsPerDayChanged && (dietChanged || !sameSet(plan.avoid, now))) {
    plan.days.forEach((day, dayIdx) => {
      day.meals.forEach((m, pos) => {
        const size = catalogSize(diet, m.slot, now);
        if (!size) return;
        const resolved = mealAt(diet, m.slot, m.idx % size, now);
        if (resolved.n !== m.n) diverged.push({ dayIdx, pos, slot: m.slot, was: m.n, now: resolved.n });
      });
    });
  }

  return {
    stale: addedAvoid.length > 0 || droppedAvoid.length > 0 || dietChanged || mealsPerDayChanged || diverged.length > 0,
    addedAvoid, droppedAvoid, dietChanged, mealsPerDayChanged, diverged,
  };
}

/**
 * The sentence a coach reads about a stale plan, or null when it is current.
 *
 * Addressed to the coach, names the client, and says what to do. It does not
 * say the plan is unsafe — nobody here knows that — it says the plan no longer
 * describes what this client is being served, which is a fact.
 */
export function planStaleLine(s: PlanStale, who: string): string | null {
  if (!s.stale) return null;
  const parts: string[] = [];
  if (s.addedAvoid.length) {
    parts.push(`${who} has disclosed ${listOf(s.addedAvoid)} since you wrote this. Every meal below was chosen from a catalogue that did not exclude ${s.addedAvoid.length === 1 ? 'it' : 'them'}.`);
  }
  if (s.dietChanged) parts.push(`Their diet has changed, so these meals were picked from a different catalogue altogether.`);
  if (s.mealsPerDayChanged) parts.push(`They eat a different number of meals a day now, so the slots this plan was written for are not the slots they have.`);
  if (s.droppedAvoid.length && !s.addedAvoid.length && !s.dietChanged) {
    parts.push(`They no longer avoid ${listOf(s.droppedAvoid)}, which renumbers the catalogue these meals were chosen from.`);
  }
  if (s.diverged.length) {
    parts.push(s.diverged.length === 1
      ? `One meal now resolves to something else on their phone: "${s.diverged[0].was}" is showing as "${s.diverged[0].now}".`
      : `${s.diverged.length} of these meals now resolve to something else on their phone.`);
  }
  parts.push('Rebuild the week and send it again — nothing here is being shown to them as your plan while it says this.');
  return parts.join(' ');
}

function listOf(a: readonly string[]): string {
  const l = a.map((x) => x);
  if (l.length === 1) return l[0];
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}

/** Whether a coach may send this plan, and what to say when they may not. */
export interface PlanGuard {
  allowed: boolean;
  /** Why the control is withheld, addressed to the coach. Null when allowed. */
  reason: string | null;
  /** What to put on the withheld control, so a caller can write
   *  `guard.label ?? 'Send'`. Null when allowed. */
  label: string | null;
}

const SEND_OK: PlanGuard = { allowed: true, reason: null, label: null };

/**
 * May this coach send a meal plan to this client?
 *
 * Two reads have to have landed before the answer is yes, and each is refused
 * for its own reason:
 *
 *  · the client's profile, which carries the allergens and the diet the whole
 *    index space is defined by. Composing a plan over a profile that did not
 *    load means choosing meals from a catalogue filtered by an allergen list
 *    nobody read — which is how a disclosed allergen ends up in a plan.
 *  · the existing plan, so that "no plan yet" is never printed over a read that
 *    failed, and a coach is never shown an empty week for somebody who has one.
 *
 * Same shape and same reasoning as guardInjuries in ./injuryGate.ts: a control
 * withheld, with a sentence saying why and what to do.
 */
export function guardPlan(
  profileStatus: LoadStatus,
  planStatus: LoadStatus,
  stale: PlanStale | null,
  clientName: string,
): PlanGuard {
  if (profileStatus === 'loading') {
    return { allowed: false, label: 'Checking What They Avoid…', reason: `Still reading ${clientName}'s allergens and diet. Every meal in this plan is chosen from a catalogue those two filter, so there is nothing to compose against yet.` };
  }
  if (profileStatus === 'error' || profileStatus === 'partial') {
    return { allowed: false, label: 'Their Allergens Could Not Be Read', reason: `${clientName}'s allergens and diet did not come back, so this screen cannot tell whether they have disclosed anything. Writing a plan on the assumption that they have not is exactly what this check exists to stop.` };
  }
  if (planStatus === 'loading') {
    return { allowed: false, label: 'Reading Their Plan…', reason: `Still reading whether ${clientName} already has a plan. Sending now could overwrite one you have not seen.` };
  }
  if (planStatus === 'error' || planStatus === 'partial') {
    return { allowed: false, label: 'Their Plan Could Not Be Read', reason: `Whether ${clientName} already has a plan is unknown rather than no. Sending would overwrite a week you have not been shown.` };
  }
  if (stale && stale.stale) {
    return { allowed: false, label: 'Rebuild This Week First', reason: planStaleLine(stale, clientName) };
  }
  return SEND_OK;
}

/**
 * What the client's app will do with the servings, in words.
 *
 * `buildPlan` scales every meal in a day by one shared multiplier so the day
 * lands on the client's target, so a coach who composes 1,400 kcal of food
 * against a 2,500 kcal target has not written a 1,400 kcal day — they have
 * written one where every plate is served at 1.75×. That is a consequence of
 * the choice worth reading before it is sent, and it is arithmetic rather than
 * advice: no judgement is offered about either figure.
 */
export function planServingNote(servings: number, baseKcal: number, targetKcal: number): string {
  const mult = servings.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  if (servings === 1) {
    return `These meals come to ${baseKcal.toLocaleString()} kcal at one serving each, which is what their target asks for. Their app serves them as written.`;
  }
  const dir = servings > 1 ? 'up' : 'down';
  return `These meals come to ${baseKcal.toLocaleString()} kcal at one serving each, against a target of ${targetKcal.toLocaleString()} kcal. Their app scales every plate ${dir} to ${mult}× to close the gap — pick differently if that is not the portion you mean.`;
}
