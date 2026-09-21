// Client · Meals — the day's fuel: what is left to eat, the macro split against
// target, today's or the week's plan, and the tools to log what actually went in.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, hook (same order), conditional branch and
// route from the previous version is preserved — only the presentation changed:
// one hero figure (calories left) instead of a ring competing with three bars,
// hairline-separated sections instead of five stacked bordered boxes, and a
// single card spent on the one thing you act on, logging a meal.
//
// Also removed: the photo-log fallback that invented a 520 kcal / 40P / 50C /
// 16F "Meal (photo)" entry whenever vision was unavailable or failed. Nothing is
// logged now — the app says it could not read the photo rather than making a
// number up.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import { titleCaseName, mealTitle, mealTitleParts } from '../../src/lib/exerciseName';import { num, numUpTo } from '../../src/lib/format';
import { fmtDay, fmtFullDay } from '../../src/lib/format';
import { PLAN_WEEKDAYS, planDayIndex, planDayOverride, planStale } from '../../src/lib/mealPlan';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import {
  buildPlan, snackIdeas, SNACK_SHARE, swapIndex, searchMeals, mealAt, catalogSize, groceryFromWeek, planWeek, slotsFor, catalogRepeatDay,
  emptySlots, mealAllergens, allergenGapNote, allergenLabel, mealRowSpoken,
  dislikeFreeIndex, dislikeGaps, dislikeGapNote, mealDish, normaliseDislike, preferNotDisliked,
  DEPTS, DEPT_ICO, ALLERGENS, type GroceryItem, type PlannedMeal, type Allergen, type Slot,
} from '../../src/lib/meals';
import { mealPlanDoc, shareDoc } from '../../src/lib/exportShare';
import { hitSlopFor } from '../../src/lib/a11y';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Diet, Goal } from '../../src/lib/types';
import { useClientData } from '../../src/ui/clientData';
import { useToday } from '../../src/ui/today';
import { startOfWeek, WEEK_DAY_NAMES } from '../../src/lib/weekStart';
import { dayKeyOfDate } from '../../src/lib/entryEdit';
import { groceryTicksKey, readGroceryTicks } from '../../src/lib/groceryTicks';
import { CUPBOARD_HEAD, needText } from '../../src/lib/groceryPacks';
// The member's own meal swaps, under a key with their account in it. They lived
// under a bare `repple.mealOverride` — no account, no sign-out entry — fifteen
// lines below the grocery ticks that were fixed for exactly that. See
// src/lib/mealSwaps.ts.
import { LEGACY_MEAL_SWAPS_KEY, mealSwapsKey, readMealSwaps, writeMealSwaps } from '../../src/lib/mealSwaps';
// Real, photographed recipes beside the generated dishes — see
// docs/RECIPES-SPOONACULAR.md. Three things about them shape everything this
// screen does with one: every search SPENDS quota, so nothing is asked until a
// member asks; nothing Spoonacular returns may be stored except a recipe's id,
// title and image URL (src/lib/recipePlan.ts keeps exactly that); and a recipe's
// `idx` is -1, which must never reach `choose`, `swapIndex`, `mealAt` or the
// `mealOverride` map — those are catalogue-index machinery.
import {
  RECIPE_ATTRIBUTION, RECIPE_DISCLAIMER, isRecipeMeal, portionRecipe, recipeAllergens,
  type RecipeMeal, type PlannedRecipe, type RecipeDetailResult, type RecipeContext,
} from '../../src/lib/recipes';
import { recipePlanKey, readRecipePlan, writeRecipePlan, recipePlanAt, withRecipeAt, withoutRecipeAt, type RecipePlan } from '../../src/lib/recipePlan';
// How far ahead the member is looking, and the recipes they planned for a DATE
// rather than for a weekday. The resolution order at a slot — the date, then
// the weekday, then the coach's pin — is `plannedRecipeAt` and is not restated
// here: every surface on this screen reads through that one function.
import {
  horizonDays, plannedRecipeAt, recipeDatePlanKey, readDatedRecipePlan, writeDatedRecipePlan,
  withDatedRecipeAt, withoutDatedRecipeAt, type DatedRecipePlan, type Horizon, type HorizonDay,
} from '../../src/lib/mealHorizon';
import { useRecipeSearch, useRecipeDetail, searchRecipesOnce } from '../../src/ui/useRecipeSearch';
import { GuardedImage } from '../../src/ui/GuardedImage';
import { reportError } from '../../src/lib/reportError';
import { useWearables } from '../../src/ui/wearables';
import { caloriesLeft, caloriesNote, dayBurn, macrosFor, applyCoachAdjust, maintenanceFor, macroWords } from '../../src/lib/nutrition';
import { energyPlanFor, observedRateKg, MAX_DEFICIT_FRACTION_OF_TDEE, type EnergyPlan } from '../../src/lib/goalEnergy';
// The one place the coach's adjust and the day type are folded together. The
// Food Log reads its target through the same file — see src/lib/dayTarget.ts,
// which exists because these two screens computed the same day two ways.
import { dayAdjust } from '../../src/lib/dayTarget';
import { useGoalTracker } from '../../src/ui/goalTracker';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { unsentNote } from '../../src/lib/offlineQueue';
import { Icon } from '../../src/ui/Icon';
import { useRouter } from 'expo-router';
import { useBrand } from '../../src/ui/brand';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { analyzeMeal, visionAvailable } from '../../src/lib/vision';
// The camera permission is about the hardware. This is about where the frame
// goes, which is a different question with a different answer.
import {
  mayAnalyzePhoto, PHOTO_ASK_KICKER, PHOTO_ASK_TITLE, PHOTO_DESTINATION_BY_SUBJECT,
  PHOTO_SENT_BY_SUBJECT, PHOTO_NOT_SENT_BY_SUBJECT, PHOTO_IF_YOU_DECLINE,
  PHOTO_SEND_LABEL, PHOTO_DECLINE_LABEL, PHOTO_SEND_A11Y, PHOTO_DECLINE_A11Y,
  PHOTO_REFUSED_NOTE, PHOTO_UNREAD_NOTE, PHOTO_OFF_NOTE,
} from '../../src/lib/photoAI';
import { usePhotoAI } from '../../src/ui/photoAI';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { readFoodText, foodAIAvailable, type ParsedFood } from '../../src/lib/foodAI';
import { foodReadSay } from '../../src/lib/readerAnswer';
import { BarcodeSheet } from '../../src/ui/BarcodeSheet';
// The same review sheet the Food Log tab uses. This tab's photo path COMMITTED
// — with an alert — while the other offered an editable sheet for the same read
// of the same photo, and its barcode path logged one of whatever basis Open
// Food Facts returned. One feature, two behaviours, and the committing one was
// where the read is least certain. See src/ui/LogFoodSheet.tsx.
import { LogFoodSheet } from '../../src/ui/LogFoodSheet';
import type { FoodFacts } from '../../src/lib/foodPortion';
import { useFoodLog } from '../../src/ui/foodLog';
import { isWhole } from '../../src/ui/loadStatus';
import { notifySuccess } from '../../src/ui/haptics';
import { Rule, Section, SectionHead, Card, Cta, Ghost, Flag, QuickRow, ListRow, Segmented, Ring, Meter, PageHead, TonedChip, Expandable, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value, font } from '../../src/theme/scale';
import { useSettings } from '../../src/ui/settings';
// The words of the help row, read straight from their source. Round five moves
// the explanation off the page and behind an info control in the head; the
// kit's <ScreenHelp> is a ROW with a "Got It" that removes it for good, which
// is the wrong shape for a control that stays — so the head's info button opens
// these same lines in a sheet. Reconcile in the kit if it grows an action form.
import { SCREEN_HELP } from '../../src/lib/screenHelp';
// The water count and the member's own goal live in one store (see its header:
// the count used to be kept twice and disagree). The note decides what may be
// drawn — a count, a bar, or neither — so this card and Recovery say one thing.
import { useHabits } from '../../src/ui/habits';
import { hydrationNote } from '../../src/lib/hydrationHero';
import { weightLabel, kgToLb, type WeightUnit } from '../../src/lib/units';
import { BACK_ICON, FORWARD_ICON, turn } from '../../src/ui/direction';
import { appLocale } from '../../src/lib/locale';

const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const DIET_LABEL: Record<Diet, string> = { meat: 'Meat', vegetarian: 'Veggie', vegan: 'Vegan', paleo: 'Paleo', keto: 'Keto' };
const GOALS: Goal[] = ['fatloss', 'tone', 'muscle'];
const GOAL_LABEL: Record<Goal, string> = { fatloss: 'Fat Loss', tone: 'Tone', muscle: 'Build Muscle' };

// The three day types, each with the definition shown in the info sheet. A
// tester asked for these ("need a brief definition in each tab for Training
// day, Standard day, Rest day") because the buttons only tell you what a day
// does after you have already picked it.
//
// Deliberately worded as "the day" and not "today": the same three definitions
// have to keep reading correctly when day types can be planned a week ahead,
// which is the direction this is going.
const DAY_TYPES = [
  { key: 'training', label: 'Training Day', blurb: 'A day you train: a gym session or a hard effort. Fuel goes up so there is something to train on.' },
  { key: 'off', label: 'Standard', blurb: 'A normal day with no session: work, walking, ordinary movement. This is the baseline target.' },
  { key: 'rest', label: 'Rest Day', blurb: 'A full day off training. Fuel comes down, because there is no session to feed.' },
] as const;

// The plate behind a dish's glyph, by slot. A generated dish has no photograph
// and none is invented; the tone is what tells four rows of emoji apart at a
// glance. None of these is a metric's colour (protein blue, carbs orange, fat
// purple, water teal), so a plate never reads as a macro.
const SLOT_TONE: Record<Slot, Exclude<Tone, 'brand' | 'neutral'>> = { Breakfast: 'amber', Lunch: 'pink', Dinner: 'purple', Snack: 'teal' };

// ── where the calorie target came from (TF-29) ───────────────────────────────
//
// "The client's stated goal should drive their calories, macros and plan." It
// did not: the target moved by a three-way enum with no date in it, so losing
// 6 kg by Christmas and losing 6 kg by next summer produced the same number.
// src/lib/goalEnergy.ts derives it from the client's real target and date now.
//
// This block is the other half of that work, and the more important half. A
// derived number is only honest if the screen can say where it came from — and
// say so in the two cases that are easy to hide:
//
//  · The plan was CLAMPED. Their date needed a rate this app will not build a
//    plan around, so the plan is slower and lands later than the date they
//    typed. Showing the slower target under their own deadline, silently, is
//    the app lying about arithmetic it did itself.
//  · The plan was NOT derived at all. No target, no date, no weigh-in — the
//    old enum behaviour, unchanged, but named as such rather than passed off
//    as goal-driven.
/**
 * A rate of weight change per week, in the unit the member reads in.
 *
 * The STORE is right here and the LABEL was wrong: `plannedRateKg`,
 * `requiredRateKg` and the observed pace are all genuinely kilograms per week,
 * and every one of them was printed with " kg a week" typed after it. A member
 * reading in pounds was told their plan moves them 0.5 kg a week — a figure in
 * a unit they had never chosen, on the screen that explains where their whole
 * calorie target comes from.
 *
 * Converted through `kgToLb`, which is exact by definition, rather than through
 * `weightDeltaIn`: that rounds a difference to the whole pound, and 0.25 kg a
 * week — an ordinary, deliberate, slow cut — would come out as "1 lb a week",
 * double the truth. A rate is not a scale reading with a tenth of a kilogram of
 * slop in it; it is a number this app computed, so it keeps the two decimal
 * places the metric side has always shown.
 */
const rateIn = (kgPerWeek: number, unit: WeightUnit) =>
  numUpTo(Math.abs(unit === 'lb' ? kgToLb(kgPerWeek) : kgPerWeek), 2);
// Through the app's own resolver rather than the device's, like every other
// date in this app. This one is the deadline the whole calorie target is
// explained by.
const onDate = (ms: number) => fmtFullDay(new Date(ms).toISOString());

/**
 * One sentence saying what set today's calorie target. Never a figure the plan
 * did not actually produce — which is why the calorie number quoted here is
 * the plan's own baseline and not the target shown above it. Those two differ
 * by the day type and any coach adjustment, each of which is already announced
 * in its own right further down the screen; attributing their ±250 to the
 * client's goal rate would make this sentence's arithmetic not add up.
 */
function targetBasis(plan: EnergyPlan, goalLabel: string, wu: WeightUnit): string {
  /** A stored bodyweight as the member reads it. `weightLabel` returns null for
   *  nothing, and there is nothing here: every one of these branches is only
   *  reached because the plan HAS a target and a current weight. */
  const w = (kg: number) => weightLabel(kg, wu) ?? '';
  if (plan.kind === 'enum') {
    switch (plan.reason) {
      case 'no-goal':
        return `Based on your general goal (${goalLabel}). Set a target weight and a date under Goals and this is built from those instead. A date is what turns a target into a daily number.`;
      case 'not-weight':
        return `Based on your general goal (${goalLabel}). Your goals aren’t about bodyweight, and calories can’t be worked back from those honestly. Add a target weight under Goals to drive this.`;
      case 'no-target-date':
        return `You’ve set a target weight, but no date. Two people losing the same 6 kg (one by spring, one by next year) don’t eat the same, so this stays on your general goal (${goalLabel}) until there’s a date under Goals.`;
      case 'no-readings':
        return `You’ve set a target weight, but there’s no weigh-in to measure from yet. Add one and this is built from your goal; for now it’s your general goal (${goalLabel}).`;
      case 'date-passed':
        // "the remaining kilos" was a unit typed into prose. It is the same defect
        // as a label, and it is worse for being invisible to a search for a
        // figure: there is no number beside it to look wrong.
        return `Your goal’s date has gone by, so there’s no time left to spread the remaining weight over. Set a new date under Goals. Until then this is your general goal (${goalLabel}).`;
      case 'date-too-soon':
        return `Your goal’s date is less than a week away, too soon to tell you whether a plan is working before it arrives. This is your general goal (${goalLabel}) instead.`;
      case 'reached':
        return `You’ve reached your target weight. Mark it done or set the next one under Goals; this is your general goal (${goalLabel}) in the meantime.`;
      case 'no-maintenance':
        return `Based on your general goal (${goalLabel}).`;
    }
  }
  // Under 50 g a week is a target the client is already standing on; calling
  // that "0.05 kg a week" would dress up a rounding error as a plan.
  const pace = Math.abs(plan.plannedRateKg) < 0.05
    ? 'holding you where you are'
    : `${rateIn(plan.plannedRateKg, wu)} ${wu} a week`;
  if (plan.onTime) {
    return `Built from your goal: ${w(plan.targetKg)} by ${onDate(plan.targetDateMs)}. From ${w(plan.currentKg)} that’s ${pace}, which sets your baseline at ${plan.kcal.toLocaleString()} kcal a day.`;
  }
  const why = plan.limitedBy === 'floor'
    ? `going faster would mean eating more than ${Math.round(MAX_DEFICIT_FRACTION_OF_TDEE * 100)}% below what your body uses in a day`
    : 'that’s faster than this app will plan for';
  // Where the plan has no pace at all there is no finish date, and printing
  // the date they asked for — the one this plan does NOT meet — would be
  // inventing the very number the sentence exists to correct.
  const tail = plan.etaMs != null
    ? ` and gets you there around ${onDate(plan.etaMs)}, later than the ${onDate(plan.targetDateMs)} you set.`
    : `, which does not reach ${w(plan.targetKg)} by ${onDate(plan.targetDateMs)}. There is no pace here to put a finish date on, so that stays a dash.`;
  return `Your date needs ${rateIn(plan.requiredRateKg, wu)} ${wu} a week, and ${why}. This plan is built on ${pace} instead${tail} Move the date or the target under Goals if you want them to meet.`;
}

// ── real recipes in the list ─────────────────────────────────────────────────

/** Whether two rows are the same dish. A generated dish is its catalogue index;
 *  a recipe is its `sourceId`, because EVERY recipe's `idx` is -1 — compared by
 *  `idx` alone, every recipe on screen is every other recipe, and all of them
 *  are "In your plan" the moment one is. */
const sameDish = (a: PlannedMeal, b: PlannedMeal): boolean =>
  isRecipeMeal(a) ? isRecipeMeal(b) && a.sourceId === b.sourceId : !isRecipeMeal(b) && a.idx === b.idx;
/** The same distinction, as a React key. */
const dishKey = (m: PlannedMeal): string => (isRecipeMeal(m) ? `r${m.sourceId}` : String(m.idx));

/** A credit or the library's backlink, opened in the browser. A link that will
 *  not open is reported rather than alerted: nothing the member was doing
 *  depends on it, and the words it sits under are the credit either way. */
const openLink = (where: string, url: string) => { Linking.openURL(url).catch((e) => reportError(where, e)); };

/** Said once, on screen and on both shared documents, so the sheet somebody
 *  shops from and the file they send cannot disagree about it. A planned
 *  recipe's ingredients and figures are not stored — they are read from the
 *  library — and a read that has not landed leaves the plan's own meal standing
 *  in, which is a meal they are not going to cook. */
const UNREAD_SHOPPING_WARNING =
  'One or more of your planned recipes could not be read, so your plan’s own meal is standing in for it. Its ingredients are not on this list and its figures are not in these totals.';
/** The heading unmeasured ingredients go under. They are shopping and belong
 *  on the list; they have no quantity, and inventing one is worse than none. */
const UNMEASURED_HEAD = 'To Taste & As Needed';
/** Under the store-cupboard heading: these are a check, not a shop. */
const CUPBOARD_NOTE = 'Small amounts of flavourings. Check what you already have before buying these.';

/** One planned recipe's read, as the screen holds it. `loading` rides along so
 *  "Try Again" can say it is trying — the hook keeps the old failure in
 *  `result` until the new answer lands. */
interface PlannedRead { result: RecipeDetailResult | null; loading: boolean; refresh: () => void }

/**
 * Reads ONE planned recipe back from its id, and draws nothing.
 *
 * A component because `useRecipeDetail` is a hook and a plan holds a variable
 * number of recipes: one of these is mounted per planned recipe whose dish is
 * not already in hand, which is the only shape that keeps the hook count fixed.
 *
 * What is stored for a planned recipe is its id, title and image URL (the terms
 * allow nothing else — src/lib/recipePlan.ts), so its figures, ingredients and
 * method exist only after this read. Each one costs 1.1 Spoonacular points, so
 * the screen mounts it only for a recipe the member deliberately planned, and
 * not at all for one chosen this session, whose dish is still in memory.
 */
function PlannedRecipeRead({ sourceId, ctx, onRead }: {
  sourceId: number; ctx: RecipeContext; onRead: (sourceId: number, read: PlannedRead) => void;
}) {
  const d = useRecipeDetail(sourceId, ctx);
  useEffect(() => { onRead(sourceId, { result: d.result, loading: d.loading, refresh: d.refresh }); },
    [sourceId, d.result, d.loading, d.refresh, onRead]);
  return null;
}

export default function Nutrition() {
  const t = useTheme();
  const c = useClientData();
  const router = useRouter();
  const { appName } = useBrand();
  // The unit this member reads bodyweight in. Chosen if they have chosen;
  // otherwise their phone's region, and Settings says so — see
  // src/lib/unitPreference.ts. What it is never again is a hardcoded 'kg'
  // typed after a figure, which is what every sentence on this screen did.
  const wu = useSettings().weightUnit;
  const coachNutrition = useCoachNutrition();
  const _adj = coachNutrition.get(c.id);
  const soloEater = c.coachingMode === 'solo';
  const coachAdjust = soloEater ? null : _adj;
  // A null from `get()` is two answers, and this screen was taking the wrong
  // one. src/ui/coachNutrition.tsx says it in its own header: under 'error' a
  // null means the adjustment could not be READ, not that there is none — "so
  // a client whose coach had cut them 400 kcal was quietly handed the
  // uncorrected targets and ate to them". Every calorie and macro figure below,
  // and the whole week of meals scaled to them, is built on `coachAdjust`.
  //
  // src/ui/habits.tsx guards this with `adjustUnknown` and has since the
  // checklist was written; the two screens the member actually eats from did
  // not. Only for a COACHED member: nobody adjusts a solo member's macros, so
  // a failed read tells us nothing there.
  const adjustUnknown = !soloEater && coachNutrition.status === 'error' && _adj == null;
  const goalTracker = useGoalTracker();
  const goals = goalTracker.goals;
  // A meal plan is scaled to lean body mass. Without a weight and body fat there
  // is nothing to scale, and the whole screen used to run on a 70 kg / 20%
  // placeholder and present the result as the client's plan. Zeros here are
  // never rendered — `hasBody` swaps the screen for a prompt below.
  //
  // Which is only true once the profile has actually been READ. While it is
  // loading, weightKg is null for the same reason it is null for somebody who
  // has never been scanned, and the screen was telling a client with five
  // scans behind them that they had no measurements and should go and add
  // some. Not knowing yet is not the same answer as none — and neither is
  // knowing that the read failed, which is a third answer the prompt below
  // reads `c.status` for directly.
  const hasBody = c.weightKg != null && c.bodyFatPct != null;
  const w = c.weightKg ?? 0;
  const bf = c.bodyFatPct ?? 0;
  const diet = c.diet;
  /**
   * Whether the two fields that decide WHICH FOOD this screen puts in front of
   * somebody — their diet style and the things they asked to avoid — were
   * actually read.
   *
   * ── The defect ──────────────────────────────────────────────────────────
   *
   * `c.avoid` starts `[]` and `c.diet` starts 'meat'. Both come from exactly
   * one place, the `clients` row, and under USE_SUPABASE the local cache is
   * deleted at launch so there is no second source. A failed read therefore
   * leaves this screen holding "excludes nothing, eats meat" — which is a
   * perfectly ordinary member, indistinguishable from a real one.
   *
   * And the door above did not stop it. `hasBody` is weight and body fat, and
   * both of those fall back to the LATEST SCAN — a different read, on a
   * different table, which is usually fine when the profile read is not. So a
   * failed profile read with healthy scans walked straight through and built a
   * full seven-day plan, a grocery list and a shareable plan document with
   * `avoid: []` and `diet: 'meat'` in them. A member with a nut allergy was
   * shown peanut components with no "Contains nuts" beside them, because
   * `mealAllergens(m, c.avoid)` is empty for an empty `avoid`; the gap warning
   * above the week is rendered on the same empty list, so that went too. A
   * vegan got a meat week under their own name.
   *
   * ── Why this refuses the plan rather than captioning it ─────────────────
   *
   * `app/(client)/restaurant.tsx` and the food search can caption theirs: their
   * rows exist independently of the exclusions and the marks are laid over the
   * top, so an unmarked row plus `DISH_MARK_UNKNOWN` is an honest screen. This
   * one is not like that. The exclusions and the diet are INPUTS to
   * `buildPlan` — they filter the pools, and filtering renumbers every index
   * after the removal — so the week, the targets, the grocery list and the
   * shared document are all composed FROM them. There is no unfiltered week
   * that can be marked up afterwards into the right week; there is only the
   * wrong food, with a sentence over it. That is the same argument
   * `adjustUnknown` below is already made on, and it is stronger here: the
   * worst `adjustUnknown` costs is the wrong calorie figure.
   *
   * So it goes through the same door, which says what could not be read and
   * offers the pull that retries it.
   *
   * 'partial' counts as unread with 'error'. A truncated profile read may be
   * missing the one exclusion that matters, and half an allergen list is not a
   * basis for composing the other half as safe.
   */
  const foodRulesUnknown = !isWhole(c.profileStatus);
  const [override, setOverride] = useState<Record<number, number>>({});
  const [ovHydrated, setOvHydrated] = useState(false);
  const [recipe, setRecipe] = useState<PlannedMeal | null>(null);
  // Which day of the horizon the open sheet belongs to. A row in the list for
  // Thursday the 25th plans FOR Thursday the 25th; without this the sheet
  // planned everything for today, whichever row opened it.
  const [sheetDay, setSheetDay] = useState<HorizonDay | null>(null);
  // ── real recipes ───────────────────────────────────────────────────────
  //
  // `recipeSearchOpen` is the deliberate act. Every search is about two
  // Spoonacular points out of a day's fifty shared by every member of every
  // coach, so mounting this tab asks nothing: the hook below is handed null
  // until somebody taps "Search Real Recipes", and again after they change
  // slot, which is a different search they have not asked for yet.
  const [recipeSearchOpen, setRecipeSearchOpen] = useState(false);
  // Where the Swap or Search card sits in the scroll, so the Recipes tab can
  // take the member to the recipe search rather than open one meal.
  const scrollRef = useRef<ScrollView>(null);
  const swapY = useRef<number | null>(null);
  const [wantRecipes, setWantRecipes] = useState(false);
  // Slot position → the recipe the member planned there. Refs only, under a key
  // with their account in it: see src/lib/recipePlan.ts for both halves.
  const [recipePlan, setRecipePlan] = useState<RecipePlan>({});
  const [rpHydrated, setRpHydrated] = useState(false);
  // The same, for a recipe planned on a DATE — "Thursday the 25th" rather than
  // "every Thursday". Two maps and two stores on purpose: see the header of
  // src/lib/mealHorizon.ts. Neither overwrites the other; the date one is read
  // first.
  const [datePlan, setDatePlan] = useState<DatedRecipePlan>({});
  const [dpHydrated, setDpHydrated] = useState(false);
  // Dishes in hand for planned recipes, by `sourceId`: the one the member just
  // chose out of a search (so choosing costs no second read), and the reads
  // `PlannedRecipeRead` reports. React state, and only that — it dies with the
  // screen, which is what the terms require of everything but the ref.
  const [recipeLive, setRecipeLive] = useState<Record<number, RecipeMeal>>({});
  const [recipeReads, setRecipeReads] = useState<Record<number, PlannedRead>>({});
  const onRecipeRead = useCallback((sourceId: number, read: PlannedRead) => {
    setRecipeReads((prev) => {
      const was = prev[sourceId];
      if (was && was.result === read.result && was.loading === read.loading && was.refresh === read.refresh) return prev;
      return { ...prev, [sourceId]: read };
    });
  }, []);

  /** Put a planned meal or a snack idea in today's log. Nothing else counts it
   *  — the plan is a menu, and reading a menu is not eating.
   *
   *  It was `logPlanned` and it was offered for snack ideas only (`pos < 0`). A
   *  planned breakfast, lunch or dinner got "Swap This Meal" and nothing else,
   *  so the day's plan and the day's log were two unconnected things on one
   *  tab: a member who ate exactly what their coach had written still had to go
   *  and describe it to the food log by hand.
   *
   *  `void fl.addFood(...)` threw the answer away. `logFood` distinguishes three
   *  outcomes for exactly this reason and the photo path forty lines down
   *  already branches on all three: a snack the server REFUSED is not on the
   *  record, and one that could not be sent is waiting rather than counted.
   *  Both looked identical here — the row's + faded and nothing else happened —
   *  so somebody tapping it, seeing no complaint, and eating the snack was
   *  eating to a day's total that was missing it. */
  const logPlanned = async (m: PlannedMeal, servings = 1) => {
    const food = {
      name: m.n,
      kcal: Math.round(m.K * servings),
      protein: Math.round(m.P * servings),
      carbs: Math.round(m.C * servings),
      fat: Math.round(m.F * servings),
      via: 'manual' as const,
    };
    const out = await fl.logFood(food);
    if (out === 'refused') {
      Alert.alert('Not Logged', `${m.n} could not be saved, so it is not on today's record.`);
      return;
    }
    notifySuccess();
    if (out === 'unsent') {
      Alert.alert('Logged, Waiting to Send', `${m.n} is counted toward today and kept on this phone. It goes up when you have signal.`);
    }
  };
  const [showGrocery, setShowGrocery] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // ── whose shop, and which week ─────────────────────────────────────────
  //
  // The ticks lived under one unqualified key, `repple.grocery.checked`, keyed
  // by nothing at all. The item keys are department plus item name, so
  // "Produce|Spinach" ticked three weeks ago was still ticked the next time
  // spinach was on the list — the member opened the list in the shop and it
  // said 12 of 30 in cart before they had picked anything up, with the progress
  // bar agreeing. The twelve were last week's staples, which are exactly the
  // things they still need.
  //
  // Account and week. `useToday` rolls the week over at midnight without the
  // screen being reopened, and an account-scoped key is unreadable to the next
  // person on a shared handset by construction — which is why this needs no
  // entry in src/lib/signOutState.ts and the old key did.
  const todayKeyNow = useToday();
  const grocWeekKey = useMemo(() => dayKeyOfDate(startOfWeek(new Date(`${todayKeyNow}T12:00:00`))), [todayKeyNow]);
  const grocKey = groceryTicksKey(c.id, grocWeekKey);
  useEffect(() => {
    // The ticks are re-read whenever the key changes, and CLEARED when there is
    // no key: a trolley from another account or another week is not this one's
    // starting point.
    if (!grocKey) { setChecked({}); return; }
    let live = true;
    AsyncStorage.getItem(grocKey)
      .then((r) => { if (live) setChecked(readGroceryTicks(r)); })
      .catch(() => { if (live) setChecked({}); });
    return () => { live = false; };
  }, [grocKey]);
  // ── whose swaps ────────────────────────────────────────────────────────
  //
  // The same hole the ticks above had, in the same file, and a worse one. These
  // were `AsyncStorage.getItem('repple.mealOverride')` on mount and a matching
  // setItem — no account in the key, no entry in src/lib/signOutState.ts — so
  // the next person to sign in on a shared handset had the previous member's
  // swaps hydrated into `override`, which is an INPUT to `buildPlan`: it
  // composes their day, their week, their grocery list and the plan document
  // they share. And an override is a catalogue index resolved through pools
  // that diet and exclusions have filtered, so the same number means a
  // different dinner to a different member. See src/lib/mealSwaps.ts, which
  // makes the same argument src/lib/mealPlan.ts makes about a coach's plan.
  //
  // Keyed on `swapsKey`, not `[]`: `c.id` is 'unknown' until the auth read
  // lands, and a mount-time read would either miss the member's swaps or write
  // an empty map over them.
  const swapsKey = mealSwapsKey(c.id);
  useEffect(() => {
    // No account is no store. The swaps still work for this session; they are
    // simply not kept, which is what `mealSwapsKey` returning null means.
    if (!swapsKey) { setOverride({}); setOvHydrated(false); return; }
    let live = true;
    // Cleared BEFORE the read, not left at whatever the last key's read set
    // it to. `ovHydrated` is the arming flag for the write effect below, and
    // it survived the key changing — so an account switch whose read then
    // failed would have written this member's empty map straight over the
    // other one's stored swaps, which is the one way to LOSE a swap rather
    // than merely show the wrong one.
    setOvHydrated(false);
    AsyncStorage.getItem(swapsKey)
      .then((r) => { if (live) { setOverride(readMealSwaps(r)); setOvHydrated(true); } })
      // An unreadable store is no swaps on screen, and `ovHydrated` stays
      // false, so nothing is persisted over whatever is actually on the
      // device. A swap made in this session still works; it is not kept, and
      // the next launch reads the real bytes again.
      .catch(() => { if (live) setOverride({}); });
    return () => { live = false; };
  }, [swapsKey]);
  // The unqualified key this replaces, removed rather than migrated: there is
  // no way to tell a single-owner handset's old swaps from the previous
  // member's on a shared one, and reading it would be the defect performed once
  // deliberately. Costs a member who upgrades a handful of re-taps; see the
  // header of src/lib/mealSwaps.ts.
  useEffect(() => { AsyncStorage.removeItem(LEGACY_MEAL_SWAPS_KEY).catch(() => {}); }, []);
  useEffect(() => {
    if (!ovHydrated || !swapsKey) return;
    AsyncStorage.setItem(swapsKey, writeMealSwaps(override)).catch(() => {});
  }, [override, ovHydrated, swapsKey]);
  // ── and whose planned recipes ──────────────────────────────────────────
  //
  // The swaps' shape exactly, for the swaps' reasons: keyed on the account, not
  // on mount; disarmed BEFORE the read so an account switch whose read fails
  // cannot write this member's empty map over the other one's; and an
  // unreadable store is nothing planned on screen with nothing persisted over
  // it. `writeRecipePlan` writes refs and only refs whatever it is handed.
  const recipesKey = recipePlanKey(c.id);
  useEffect(() => {
    if (!recipesKey) { setRecipePlan({}); setRpHydrated(false); return; }
    let live = true;
    setRpHydrated(false);
    AsyncStorage.getItem(recipesKey)
      .then((r) => { if (live) { setRecipePlan(readRecipePlan(r)); setRpHydrated(true); } })
      .catch(() => { if (live) setRecipePlan({}); });
    return () => { live = false; };
  }, [recipesKey]);
  useEffect(() => {
    if (!rpHydrated || !recipesKey) return;
    AsyncStorage.setItem(recipesKey, writeRecipePlan(recipePlan)).catch(() => {});
  }, [recipePlan, rpHydrated, recipesKey]);
  // The date layer, stored exactly as the weekday one is and for the same
  // reasons: account in the key, disarmed before the read, an unreadable store
  // is nothing planned rather than something wrong planned.
  const datesKey = recipeDatePlanKey(c.id);
  useEffect(() => {
    if (!datesKey) { setDatePlan({}); setDpHydrated(false); return; }
    let live = true;
    setDpHydrated(false);
    AsyncStorage.getItem(datesKey)
      .then((r) => { if (live) { setDatePlan(readDatedRecipePlan(r)); setDpHydrated(true); } })
      .catch(() => { if (live) setDatePlan({}); });
    return () => { live = false; };
  }, [datesKey]);
  useEffect(() => {
    if (!dpHydrated || !datesKey) return;
    AsyncStorage.setItem(datesKey, writeDatedRecipePlan(datePlan)).catch(() => {});
  }, [datePlan, dpHydrated, datesKey]);
  // How far ahead the member is looking AND planning: one day, a week, a month.
  // The meal list, the shopping list and the recipe reads all follow it, so
  // "this month" is not a longer list drawn over a week's worth of shopping.
  const [view, setView] = useState<Horizon>('today');
  // "How does a client build a meal plan for themselves? I don't see how to."
  // (owner, 21 Sep 2026). Every choice existed, scattered: meals per day inside
  // Swap or Search, diet and exclusions at the foot of the screen, the horizon
  // on the plan card. This sheet puts them in one place, in order, behind a
  // button that says what it does. It writes through the same setters, so the
  // plan it shows is the one the screen already builds from them.
  const [buildOpen, setBuildOpen] = useState(false);
  // The board's meal list is one slot at a time — Breakfast, Lunch, Dinner
  // segments over the rows. null is "the first slot of the plan", so a plan
  // rebuilt with fewer meals never points at a slot it no longer has.
  const [slotPick, setSlotPick] = useState<Slot | null>(null);
  // The board's search row searches THIS list — the slot's catalogue — not the
  // food log. Cleared when the slot changes: a query about breakfast is not a
  // query about dinner.
  const [mealQuery, setMealQuery] = useState('');
  const [showAvoid, setShowAvoid] = useState(false);
  const [dislikeDraft, setDislikeDraft] = useState('');
  // Why the last dislike change did not save, drawn until the next one does.
  // A refused write is never drawn as done: the chips only move on success.
  const [dislikeError, setDislikeError] = useState<string | null>(null);
  const saveDislikes = async (next: string[]) => { setDislikeError(await c.setDislikes(next)); };
  const addDislike = () => {
    const w = normaliseDislike(dislikeDraft);
    if (!w) return;
    setDislikeDraft('');
    if (!c.dislikes.includes(w)) void saveDislikes([...c.dislikes, w]);
  };
  const [dayType, setDayType] = useState<'training' | 'rest' | 'off'>('off');
  const [dayInfo, setDayInfo] = useState(false);
  // The head's info control. See the SCREEN_HELP import.
  const [helpOpen, setHelpOpen] = useState(false);
  const [batch, setBatch] = useState(1);
  const [cook, setCook] = useState(false);
  const [cookStep, setCookStep] = useState(0);
  const fl = useFoodLog();
  // Four reads feed this screen and every one of them changes what is on the
  // plate: the profile (the lean mass the plan is scaled to), the coach's
  // adjustment to the targets, the goals, and what has already been eaten
  // today. `adjustUnknown` above is the sentence a member reads when the
  // second of those failed — it tells them to check back in a moment, and this
  // is how they check.
  // Read here rather than inline at the burn below, so the pull can reach it.
  // See `burnStale`: this screen tells a member their device could not be
  // reached and to pull down, and a gesture that retries four reads and not the
  // fifth makes that instruction a dead one — which is the defect
  // app/(client)/restaurant.tsx carries a paragraph about.
  const wear = useWearables();
  const syncDevices = wear.syncAll;
  const habits = useHabits();
  const reloadHabits = habits.reload;
  const pull = usePullToRefresh(useCallback(() => {
    c.reload(); void coachNutrition.reload(); goalTracker.reload(); fl.reload(); syncDevices(); reloadHabits();
  }, [c.reload, coachNutrition, goalTracker.reload, fl.reload, syncDevices, reloadHabits]));
  /**
   * Take a meal off today's record, and say so when it did not come off.
   *
   * `removeFood` resolves FALSE when the row is still there — src/ui/foodLog.tsx
   * deliberately leaves it on screen until the server confirms the delete,
   * because a row that vanishes and comes back at the next launch takes the
   * day's calories with it in both directions. The × here dropped that promise,
   * so a refused delete was a tap that did nothing at all: the meal stayed, no
   * sentence appeared, and the member tapped it again. The Food Log tab has
   * always said something; this one is where the same meal is deleted from.
   */
  const removeMeal = async (id: string, name: string) => {
    const gone = await fl.removeFood(id);
    if (!gone) {
      Alert.alert('Still on Today’s Record',
        `${name} could not be removed just now, so it is still counted toward today. Try again in a moment.`);
    }
  };
  useEffect(() => { setBatch(1); setCook(false); setCookStep(0); }, [recipe]);
  const [nl, setNl] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  // The member's answer about sending a photograph of their food to a language
  // model — its own subject and its own stored key, because agreeing to
  // photograph a gym machine is not agreeing to photograph the table you are
  // sitting at. See src/lib/photoAI.ts.
  const photoAI = usePhotoAI('meal');
  // True only while the question is on screen. Nothing has been photographed
  // and nothing sent at that point, so dismissing the sheet is a cancel and
  // never a quiet yes.
  const [askPhoto, setAskPhoto] = useState(false);
  const [bcOpen, setBcOpen] = useState(false);
  // Everything that is about to become a row in the food log goes through one
  // sheet, on this tab as on the other. See src/ui/LogFoodSheet.tsx.
  const [pending, setPending] = useState<FoodFacts | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [pendingTitle, setPendingTitle] = useState<string | undefined>(undefined);
  const [pendingVia, setPendingVia] = useState<'search' | 'barcode' | 'photo' | 'manual'>('manual');
  // More described foods waiting their turn behind the one on screen.
  //
  // There was no queue here. `setPending(gaps[0])` was the whole of it, so
  // "2 eggs, toast and a coffee" with a macro missing on each offered ONE sheet
  // and dropped the other two — along with the text that would have been needed
  // to type them again. app/(client)/foodlog.tsx has handled the identical case
  // since it was written, and this is that, not a second idea about it: the
  // first is on screen, the rest wait behind it, and closing the sheet advances
  // the queue rather than discarding it.
  const [queue, setQueue] = useState<FoodFacts[]>([]);
  /**
   * The question, put BEFORE the camera opens.
   *
   * This path posted a photograph of the member's food to api.anthropic.com —
   * `analyzeMeal`, the `vision-analyze` edge function — behind a camera
   * permission reading "Allow camera to log a meal by photo". That describes
   * the hardware and nothing else. A plate is photographed at a table, and
   * whoever is sitting round it goes with the food; none of them are in the
   * room when the question is put, which is why it has to be put at all.
   *
   * Before the shutter, not after: a member who has already taken the photo
   * has already taken it, and asking afterwards makes agreeing the way to stop
   * having wasted the gesture. Same rule and same wording source as
   * app/(client)/foodlog.tsx and app/(client)/scan-machine.tsx — one module,
   * src/lib/photoAI.ts, so the three cannot drift.
   */
  const photoLog = async () => {
    const gate = mayAnalyzePhoto(photoAI.consent, visionAvailable());
    if (gate.block === 'unknown') {
      Alert.alert('One Moment', 'Still checking your answer about photos. Try that again in a moment.');
      return;
    }
    if (gate.block === 'unasked' || gate.block === 'refused') { setAskPhoto(true); return; }
    await runPhotoLog(gate.allowed ? 'send' : 'off');
  };

  /**
   * Take the photograph, and send it only on 'send'.
   *
   * Three outcomes rather than a boolean, because the sheet has to say WHY
   * nothing was read. "You said no", "this build has no reader" and "the
   * reader gave nothing back" are three different facts.
   *
   * Every one of them now lands on the SHEET rather than an alert. The old
   * "Could not read that photo" alert pointed at the Food Log and threw the
   * picture away; on the refusal branch that would have drawn a member's own
   * decision as a failure and left them nowhere. The sheet is the route the
   * Food Log tab has always offered, and it is the thing that makes "no" leave
   * the feature working: the photo is on screen, it went nowhere, and the
   * figures are typed against it.
   */
  const runPhotoLog = async (outcome: 'send' | 'refused' | 'off') => {
    // Through ensureMediaPermission, with the same purpose phrase foodlog.tsx
    // passes for the same act. The bare request and Alert that used to be here
    // is the defect src/ui/permissions.ts exists to delete: after a refusal iOS
    // has recorded, `requestCameraPermissionsAsync` returns
    // `{ granted: false, canAskAgain: false }` having shown nothing, so "Allow
    // camera to log a meal by photo" was a box with one button and no route to
    // anywhere the camera could actually be allowed. The Food Log tab was fixed
    // for this; this tab offers the same photo log and was not.
    if (!(await ensureMediaPermission('camera', 'log a meal by photo'))) return;
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    const asset = res.assets[0];
    // Only while something is actually being read. Nothing is in flight on the
    // two branches that send nothing, and a spinner over a photo that is going
    // nowhere describes a send that is not happening.
    if (outcome === 'send') setLogBusy(true);
    // The resize is an optimisation, not the read. `nb` already holds the
    // picker's own base64, so a manipulator that throws costs a larger upload
    // and nothing else — the same photo goes to `analyzeMeal` and the same meal
    // comes back. The member asked to log a meal, not to hear about a
    // compression step, so there is nothing here to tell them.
    let nb = asset.base64; try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) nb = mm.base64; } catch { /* see above: the original base64 is still in `nb` */ }
    if (outcome === 'send' && visionAvailable() && nb) {
      const r = await analyzeMeal(nb, 'image/jpeg');
      if (r) {
        // Through the sheet, like everything else that becomes a row. This
        // committed on the spot with an alert — on the tab where the read is
        // least certain, while the Food Log tab offered an editable sheet for
        // the same read of the same photo.
        setLogBusy(false);
        setPendingVia('photo');
        setPendingPhoto(asset.uri);
        setPendingTitle('Check and Log');
        setPendingNote('Read from your photo. Check every figure before logging it. The picture itself is not kept: it is here to read the meal from and to check against, and the numbers are what go into your log.');
        setPending({ name: r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, basis: null });
        return;
      }
    }
    setLogBusy(false);
    // Nothing was read, so nothing is estimated. Guessing macros here would be
    // worse than logging nothing — the member would be planning around a
    // number the app invented. A blank sheet, with the picture beside it and a
    // sentence saying which of the three reasons this is.
    setPendingVia('photo');
    setPendingPhoto(asset.uri);
    setPendingTitle('Enter This Meal');
    setPendingNote(outcome === 'refused' ? PHOTO_REFUSED_NOTE.meal
      : outcome === 'off' ? PHOTO_OFF_NOTE.meal
      : PHOTO_UNREAD_NOTE.meal);
    setPending({ name: '', kcal: NaN, protein: null, carbs: null, fat: null, basis: null });
  };
  const barcodeLog = () => setBcOpen(true);
  const describeLog = async () => {
    const text = nl.trim(); if (!text) return;
    // `readFoodText`, not `parseFoodText`: the wrapper collapses four distinct
    // outcomes into one null, and this screen used to show one sentence for all
    // of them. A member who typed "a bowl of soup" and is shown an error learns
    // the app is broken; one told the reader named no food in that line learns
    // to type differently — which is the only one of the four they can act on.
    setLogBusy(true); const read = await readFoodText(text); setLogBusy(false);
    const parsed: ParsedFood[] | null = read && read.ok ? read.items : null;
    // A macro the reader did not give us is blank, not nought — see
    // src/lib/foodAI.ts. Those foods go to the sheet to be completed rather
    // than into the log with a zero standing in for a measurement.
    //
    // Calories included. They used to be coerced to zero and the food then
    // filtered out for being worth nothing, so an item the model could not
    // price was removed from the reader's own description with no sentence
    // anywhere — the one outcome that file's header refuses for the macros.
    // `NaN` is what a FoodFacts carries for a figure nobody has supplied yet
    // and the sheet seeds an empty calories box from it.
    const whole = (it: ParsedFood): it is ParsedFood & { kcal: number; protein: number; carbs: number; fat: number } =>
      it.kcal != null && it.protein != null && it.carbs != null && it.fat != null;
    const gaps: FoodFacts[] = parsed
      ? parsed.filter((it) => !whole(it))
        .map((it) => ({ name: it.name, kcal: it.kcal ?? NaN, protein: it.protein, carbs: it.carbs, fat: it.fat, basis: null }))
      : [];
    if (gaps.length) {
      setPendingVia('manual');
      setPendingPhoto(null);
      setPendingTitle('Check This One');
      setPendingNote(`Read from what you typed. Some of the figures did not come back, so they are blank rather than nought. Fill them in and this can be logged.${gaps.length > 1 ? ` ${gaps.length - 1} more to check after it.` : ''}`);
      setPending(gaps[0]);
      setQueue(gaps.slice(1));
    }
    const items = parsed ? parsed.filter(whole) : null;
    if (items && items.length) {
      // `items.forEach` over an async write started every one of them and
      // waited for none, then fired the success haptic and cleared the box the
      // typing was in. A member who described three things and had two refused
      // was told, by the only signal this path has, that all three were logged
      // — and the text they would have needed to try again was gone. The field
      // is cleared only for what actually landed.
      const outs = await Promise.all(items.map((it) =>
        fl.logFood({ name: it.name, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, via: 'manual' })));
      const refused = outs.filter((o) => o === 'refused').length;
      const unsent = outs.filter((o) => o === 'unsent').length;
      if (refused === outs.length) {
        Alert.alert('Not Logged', `Nothing you described could be saved, so none of it is on today's record. Your text is still in the box.`);
        return;
      }
      setNl(''); notifySuccess();
      if (refused > 0) {
        Alert.alert('Partly Logged', `${outs.length - refused} of ${outs.length} went on today's record. ${refused} could not be saved and ${refused === 1 ? 'is' : 'are'} not counted.`);
      } else if (unsent > 0) {
        Alert.alert('Logged, Waiting to Send', `${unsent === outs.length ? 'They are' : `${unsent} of them are`} counted toward today and kept on this phone until you have signal.`);
      }
    }
    else if (!gaps.length) {
      // `read === null` is the one case that is not an answer at all: no reader
      // was asked, because the backend is off or the box was empty. It keeps
      // its own sentence and is deliberately outside the four — saying "the
      // reader did not answer" about a reader nobody asked would be a fifth
      // wrong claim in place of the one this change removes.
      if (read === null) Alert.alert('Nothing Was Read', foodAIAvailable() ? 'Try e.g. "2 eggs, toast and a coffee".' : 'AI logging turns on with the AI backend.');
      else { const say = foodReadSay(read); Alert.alert(say.title, say.body); }
    }
  };

  // Taken by day rather than read off `dayType`, so the info sheet can ask what
  // the other two days would come to without the client having to tap each one
  // to find out.
  const CYCLE_KCAL = 250;
  // Folded by `dayAdjust` in src/lib/dayTarget.ts rather than here, so the Food
  // Log applies the coach's adjust the same way this tab does. It is the same
  // arithmetic it always was; what changed is that there is now one copy of it.
  const adjustFor = (d: typeof dayType) =>
    dayAdjust(coachAdjust ?? null, d === 'training' ? CYCLE_KCAL : d === 'rest' ? -CYCLE_KCAL : 0);
  const cyclingAdjust = useMemo(() => adjustFor(dayType), [coachAdjust, dayType]);

  // TF-29. The calorie target is worked back from the client's own target
  // weight and date where they have set one, and falls back to the goal enum —
  // unchanged, and named on screen — where they have not. `energyPlan` rides
  // on the input object rather than being applied here because `buildPlan`
  // hands its input straight to `macrosFor`: doing it any other way would have
  // scaled the meals below to one calorie figure while the target above them
  // showed another, which is the bug at the foot of src/lib/nutrition.ts.
  const openWeightGoal = useMemo(() => goals.find((g) => g.kind === 'weight' && !g.achievedAtISO) ?? null, [goals]);
  // ── and why every one of these is memoised ────────────────────────────────
  //
  // `input` was an object literal built on every render, so the `useMemo` on
  // `snackIdeas` below could never hit and the grocery list had no memo at all.
  // Typing one character into the "Describe it" box calls `setNl`, which
  // re-renders — and a re-render rebuilt a whole synthetic week of meals plus
  // the department aggregation, whether or not the grocery sheet was even open,
  // on the tab a member uses standing in a kitchen.
  //
  // The chain has to be memoised end to end or none of it holds: a fresh
  // `energyPlan` or `coachOverride` object makes `input` fresh, and a fresh
  // `input` makes everything downstream fresh again. `nowHour` is the only way
  // the clock gets in — an hourly bucket rather than `Date.now()`, so a
  // projection that moves by milliseconds cannot re-trigger the week on every
  // keystroke.
  const nowHour = Math.floor(Date.now() / 3600000);
  const energyPlan = useMemo(() => energyPlanFor({
    goal: openWeightGoal,
    weightSeries: c.weightSeries,
    tdeeKcal: maintenanceFor({ weightKg: w, bodyFatPct: bf, activity: c.activity }).tdee,
    nowMs: Date.now(),
  }), [openWeightGoal, c.weightSeries, w, bf, c.activity, nowHour]);
  const observedPace = observedRateKg(energyPlan);

  // The week the coach composed (part 133 / src/lib/mealPlan.ts). It supersedes
  // the single-day `mealOverride`, and is used only while it still describes
  // THIS client: a plan written before they disclosed an allergen, changed diet
  // or changed meals-per-day resolves its indices through a DIFFERENT catalogue
  // — filtering a pool renumbers every index after the removal — so a stale
  // plan is dropped rather than served under a coach's name. Serving one would
  // put a shellfish meal in front of somebody who has just told us they cannot
  // eat it, with their coach's name on it.
  const coachPlan = coachAdjust?.plan ?? null;
  const coachPlanCurrent = !!coachPlan && !planStale(coachPlan, diet, c.avoid, c.mealsPerDay).stale;
  // ── which day of the coach's week the member is standing in ────────────
  //
  // Was `planDayIndex(new Date().toISOString())`. The ZONE was never wrong —
  // `dateParts` in src/lib/localDate.ts parses an instant that carries its own
  // offset and reads the parts back with the local getters, which is why this
  // is not a check-utc-day finding and why the weekday is identical in every
  // zone. What was wrong is WHEN it is asked.
  //
  // `new Date()` in a render body is only right at the moment something else
  // happens to redraw, and nothing redraws a screen that is sitting still.
  // Expo Router mounts these once and backgrounding does not tear them down,
  // so a member who left Meals open overnight, or pocketed the phone for two
  // days, went on being served the coach's day for the day they opened it —
  // a whole different set of written meals, under the coach's name, with the
  // Today plan and the swaps composed around it. That is the exact defect
  // src/ui/today.ts was written for, and this file was already calling it for
  // the grocery week three lines of state above.
  //
  // `todayKeyNow` is that hook: the reader's own `YYYY-MM-DD`, re-stated at
  // local midnight and when the app comes back to the foreground.
  const coachDay = planDayIndex(todayKeyNow);
  const coachOverride = useMemo(() => (coachPlanCurrent && coachDay != null
    ? planDayOverride(coachPlan!, coachDay)
    : (coachAdjust?.mealOverride ?? {})), [coachPlanCurrent, coachDay, coachPlan, coachAdjust]);
  const input = useMemo(() => ({ id: c.id, weightKg: w, bodyFatPct: bf, activity: c.activity, goal: c.goal, diet, mealsPerDay: c.mealsPerDay, mealOverride: { ...coachOverride, ...override }, coachAdjust: cyclingAdjust, avoid: c.avoid, dislikes: c.dislikes, energyPlan }),
    [c.id, w, bf, c.activity, c.goal, diet, c.mealsPerDay, coachOverride, override, cyclingAdjust, c.avoid, c.dislikes, energyPlan]);
  const { plan, target, tot } = useMemo(() => buildPlan(input), [input]);
  // Snacks are ideas, not plan slots: they do not move the targets or the
  // macro split above, because a snack nobody has eaten yet is not a
  // commitment. Logging one is what counts it, like any other food.
  const snacks = useMemo(() => snackIdeas(input, 3), [input]);
  const planHasSnacks = plan.some((m) => m.slot === 'Snack');
  const planSlots = useMemo(() => Array.from(new Set(plan.map((m) => m.slot))), [plan]);
  const slotSel: Slot | null = slotPick && planSlots.includes(slotPick) ? slotPick : planSlots[0] ?? null;
  // ── the plan, with the planned recipes in it ───────────────────────────
  //
  // `plan` stays what `buildPlan` composed: catalogue indices, portioned. What
  // a recipe does to it is applied ONCE, by `withRecipes`, and every artefact on
  // this screen is built through that one composition — today's list, This
  // Week, the grocery list and the shared document. It used to be applied to
  // today's list alone, so a member who planned three real recipes went on
  // shopping for three generated meals they were not going to eat.
  //
  // A planned recipe stands in at its position, portioned to the calories the
  // generated row there carries (`portionRecipe` is `buildPlan`'s own
  // arithmetic, so the slot's share of the day does not move by more than the
  // dish). Its `ing` is PER SERVING and so is its `k/p/c/f` — the two are the
  // same divisor (src/lib/recipes.ts, `toRecipeMeal`), which is what lets
  // `groceryFromWeek` multiply the ingredients by `servings` and the day total
  // add `K` without either being a figure for a plate nobody is serving.
  //
  // "Once its dish is in hand" is the rule that matters. A ref with no read
  // behind it has no figures and no ingredients, and a failed read is not an
  // empty slot: until the read is WHOLE the generated row stays exactly where
  // it was, the list says which recipe it is waiting for, and the day it is on
  // prints no total and carries a warning on the shopping list — see
  // `waitingIn`. That is the line the coach's board takes for the same reason
  // (a day holding a pinned recipe draws its targets but not its rings).
  const recipeDish = (sourceId: number): RecipeMeal | null => {
    const held = recipeLive[sourceId];
    if (held) return held;
    const read = recipeReads[sourceId]?.result;
    return read && read.status === 'ready' ? read.meal : null;
  };
  // Which day of the week the member is standing in, and therefore which day a
  // recipe planned here is planned FOR. `planDayIndex` returns null only for a
  // date that is not one, and `todayKeyNow` is always the reader's own
  // YYYY-MM-DD; the fallback is the week's first day rather than "no day", so a
  // choice is never silently dropped on the floor.
  const todayIdx = coachDay ?? 0;
  // ── the days on screen ─────────────────────────────────────────────────
  //
  // `view` says how far ahead the member is looking — a day, a week, a month —
  // and this is that span as real days, today first. Each one carries its own
  // DATE, which is what a recipe planned for Thursday the 25th is keyed by, and
  // its WEEKDAY, which is what "every Thursday" and the coach's repeating week
  // are keyed by. Everything below counts in offsets from today rather than
  // from the start of the week, so the first row is always the day the member
  // is standing in and planning further ahead never pushes it down the list.
  const days = useMemo(() => horizonDays(todayKeyNow, view), [todayKeyNow, view]);
  // Never empty — `horizonDays` returns at least one day, with an empty date
  // for a clock it could not read, which matches nothing in the date layer.
  const today: HorizonDay = days[0] ?? { key: todayKeyNow, weekday: todayIdx, offset: 0 };
  // The coach's pinned recipes, keyed by the same two numbers the member's own
  // are. Only while the coach's written week is the CURRENT one: a stale plan's
  // day indices name meals this member is no longer served, and `coachOverride`
  // has already fallen off it. A coach read that FAILED is `coachAdjust ===
  // null` above — no refs, which is not the same as none pinned, and is why
  // `adjustUnknown` still stops the board drawing.
  // Memoised because `?? {}` is a new object every render, and what hangs off
  // it is now a month of days rather than a week: an identity that changes for
  // nothing recomposed thirty days and their shopping list on every keystroke.
  const coachRefs = useMemo(() => (coachPlanCurrent ? coachAdjust?.recipeRefs : null) ?? {},
    [coachPlanCurrent, coachAdjust]);
  /** The three sources a slot's recipe can come from, in the order they win:
   *  this date, then this weekday, then the coach's pin. `plannedRecipeAt` is
   *  where that order is decided, and it is decided once. */
  const plannedSrc = useMemo(() => ({ dates: datePlan, weekdays: recipePlan, coach: coachRefs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datePlan, recipePlan, coachRefs]);
  /** The recipe planned for a day and slot, and WHICH of the three said so. */
  const refAt = (day: HorizonDay, pos: number) => plannedRecipeAt(plannedSrc, day, pos);
  /** A built day with its planned recipes standing in. */
  const withRecipes = (day: readonly PlannedMeal[], d: HorizonDay): PlannedMeal[] => day.map((m) => {
    const ref = refAt(d, m.pos)?.ref ?? null;
    const dish = ref ? recipeDish(ref.sourceId) : null;
    // The slot is the PLAN's, not the one the recipe was searched under: a
    // change of meals-per-day moves which slot a position is, and a row filed
    // under a segment the plan no longer has would be a row nobody can find.
    // An empty slot's own `K` is 0; its share of the day is `slotKcal`.
    return dish ? portionRecipe({ ...dish, slot: m.slot }, m.slotKcal ?? m.K, m.pos) : m;
  });
  /** The rows of a built day whose planned recipe is NOT in hand — still being
   *  read, or the read failed. The generated meal is standing in for each. */
  const waitingIn = (day: readonly PlannedMeal[], d: HorizonDay) =>
    day.filter((m) => { const hit = refAt(d, m.pos); return !!hit && !recipeDish(hit.ref.sourceId); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const todayPlan = useMemo(() => withRecipes(plan, today), [plan, today, plannedSrc, recipeLive, recipeReads]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const todayWaiting = useMemo(() => waitingIn(plan, today), [plan, today, plannedSrc, recipeLive, recipeReads]);
  const slotMeals = todayPlan.filter((m) => m.slot === slotSel);
  // The slot's rows as the ENGINE composed them. Everything that does catalogue
  // arithmetic below — the stride, `mealAt`, the "not the lead again" filter —
  // reads this one, because `slotMeals[0]` may now be a recipe and a recipe's
  // `idx` is -1.
  const genSlotMeals = plan.filter((m) => m.slot === slotSel);
  /** Pick a named meal for a slot — the swap the board's list offers, by
      choice rather than by stepping to the next one.

      Refuses anything that is not a catalogue index. No caller hands it a
      recipe's -1 — the sheet branches on `isRecipeMeal` before it gets here —
      and this is the second lock on that door, because what is behind it is
      `buildPlan` resolving `idx % size` into a dinner nobody chose, persisted. */
  const choose = (pos: number, idx: number) => {
    if (!Number.isInteger(idx) || idx < 0) return;
    setOverride({ ...override, [pos]: idx });
  };
  /** The day the open sheet plans for. The member's horizon can change under an
   *  open sheet, and a day that is no longer on screen is not one to plan on. */
  /** Open the meal sheet on a row, remembering WHICH day of the horizon it came
   *  from. Everything the sheet plans, it plans for that day. */
  const openMeal = (m: PlannedMeal, day: HorizonDay) => {
    // An empty slot has no dish to open, cook or log. Tapping it goes where it
    // can be filled: that slot's recipe search, on Today.
    if (m.unfillable?.length) { setView('today'); setSlotPick(m.slot); setMealQuery(''); setRecipeSearchOpen(true); return; }
    setSheetDay(day); setRecipe(m);
  };
  const planDay: HorizonDay = sheetDay && days.some((d) => d.offset === sheetDay.offset && d.key === sheetDay.key)
    ? sheetDay : today;
  /** Plan a real recipe at its slot — on ONE DATE, or on every such weekday.
   *  The REF is what is kept (both writers go through `recipeRef`); the dish is
   *  held in state so the row can be drawn now without paying for a second read
   *  of something already in hand.
   *
   *  Two scopes because a member means two different things. "Thursday the
   *  25th" is a meal they intend to cook once; "every Thursday" is a standing
   *  preference, and it is the one src/lib/recipePlan.ts holds. Neither writes
   *  over the other: the date is simply read first. */
  const planRecipe = (m: PlannedRecipe, scope: 'date' | 'weekday') => {
    if (m.pos < 0) return;
    setRecipeLive((prev) => ({ ...prev, [m.sourceId]: m }));
    if (scope === 'weekday') setRecipePlan((prev) => withRecipeAt(prev, planDay.weekday, m.pos, m));
    else setDatePlan((prev) => withDatedRecipeAt(prev, planDay.key, m.pos, m));
  };
  /** Hand a slot back to whatever is behind it. It takes out the MEMBER's own
   *  choice, and only the one named: clearing the 25th leaves every Thursday
   *  standing, and clearing every Thursday leaves the 25th. A recipe their
   *  coach pinned is the coach's pick and stays, the way a coach's meal
   *  override does. */
  const unplanRecipe = (pos: number, scope: 'date' | 'weekday') => {
    if (scope === 'weekday') setRecipePlan((prev) => withoutRecipeAt(prev, planDay.weekday, pos));
    else setDatePlan((prev) => withoutDatedRecipeAt(prev, planDay.key, pos));
  };
  // The rest of the slot's catalogue, portioned like the planned meal so the
  // calories on the rows are the calories the plan would carry. The planned
  // meal leads and is not repeated. Real search over real rows; an empty
  // query lists the first of the catalogue, which is what the board draws.
  const slotOptions = useMemo((): PlannedMeal[] => {
    const lead = genSlotMeals[0];
    // An empty slot has no catalogue to offer; its way out is the recipe search.
    if (!slotSel || !lead || lead.unfillable?.length) return [];
    const q = mealQuery.trim();
    // Neighbouring indices differ only in the last component: "Berry oats",
    // "Berry oats (warm)", "Berry oats (chilled)". So the catalogue is
    // sampled at a stride when nothing is typed, and a search is thinned to
    // one row per base dish. Eight different breakfasts, not eight oats.
    const size = catalogSize(diet, slotSel, c.avoid);
    // Sampled wide (32 draws) and thinned twice: one row per base dish AND one
    // per leading flavour. Thinned on the dish alone, the list opened on five
    // "Apple & Cinnamon" breakfasts in a row (owner, 21 Sep 2026).
    const stride = Math.max(1, Math.floor(size / 32));
    const raw = q
      ? searchMeals(diet, slotSel, q, 60, c.avoid, c.dislikes)
      : Array.from({ length: 32 }, (_, i) => mealAt(diet, slotSel, dislikeFreeIndex(diet, slotSel, (lead.idx + stride * (i + 1) + i * 7) % size, c.avoid, c.dislikes), c.avoid));
    const flavour = (n: string) => n.trim().split(/\s+/)[0].toLowerCase();
    const seen = new Set<string>([mealDish(lead.n)]);
    const seenFlavour = new Set<string>(q ? [] : [flavour(lead.n)]);
    return raw
      .filter((m) => {
        const base = mealDish(m.n);
        if (m.idx === lead.idx || seen.has(base)) return false;
        if (!q && seenFlavour.has(flavour(m.n))) return false;
        seen.add(base); seenFlavour.add(flavour(m.n)); return true;
      })
      .slice(0, 12)
      .map((m) => ({ ...m, pos: lead.pos, servings: lead.servings,
        K: Math.round(m.k * lead.servings), P: Math.round(m.p * lead.servings), C: Math.round(m.c * lead.servings), F: Math.round(m.f * lead.servings) }));
  }, [genSlotMeals, slotSel, mealQuery, diet, c.avoid, c.dislikes]);
  // A position the member has put a recipe in is not showing the coach's pick,
  // whatever the override maps say: the row under the label would be the
  // member's own choice with the coach's name on it.
  const coachPick = (pos: number) => coachOverride[pos] != null && override[pos] == null
    && !(todayPlan[pos] && isRecipeMeal(todayPlan[pos]));
  const swap = (pos: number, slot: PlannedMeal['slot'], idx: number) => {
    // `swapIndex` steps along the catalogue FROM an index. See `choose`.
    //
    // `c.avoid` is not optional here even though the parameter is. The index
    // written goes into `override`, which `buildPlan` resolves with `idx %
    // size` against the pools `avoid` has FILTERED — so without it the step
    // was taken in the unfiltered space and landed back in the filtered one as
    // a different meal. The coach's swap on client-nutrition.tsx has always
    // passed the list; this one defaulted to `[]`, which is the index-space
    // confusion src/lib/mealSwaps.ts is written about. The profile read is
    // already gated above: nothing on this board draws until `c.avoid` is
    // known, so this is the member's real list and never an empty stand-in.
    if (!Number.isInteger(idx) || idx < 0) return;
    setOverride({ ...override, [pos]: swapIndex(diet, slot, idx, c.avoid, c.dislikes) });
  };
  // ── the recipe search, and only when asked ─────────────────────────────
  //
  // Null until `recipeSearchOpen`, and the hook spends nothing on null. The
  // calorie band is the GENERATED lead's `K` — the slot's share of the day —
  // so what comes back can be portioned to the slot without halving or
  // tripling it. An empty box is a real search ("breakfasts for my diet"), one
  // or two letters are not, and the hook debounces the typing: all three are
  // its rules (src/ui/useRecipeSearch.ts), followed here rather than restated.
  //
  // To the nearest 50 kcal, for the SEARCH only. Every generated dish lands on
  // a slightly different `K` (servings move in quarters), the hook asks again
  // whenever its params change by value, and 612 against 598 is not a new
  // question worth three points. The rows are still portioned to the exact `K`.
  //
  // The three doors of the early return below close it too. They already keep
  // this list off screen, but the hook runs ABOVE them, and a search sent with
  // `avoid: []` because the profile read failed is the defect they exist for.
  const recipeLead = genSlotMeals[0] ?? null;
  const recipes = useRecipeSearch(recipeSearchOpen && hasBody && !adjustUnknown && !foodRulesUnknown && slotSel && recipeLead
    ? { slot: slotSel, diet, avoid: c.avoid, query: mealQuery, targetKcal: Math.round((recipeLead.slotKcal ?? recipeLead.K) / 50) * 50, number: 8 }
    : null);
  const found = recipeSearchOpen ? recipes.result : null;
  // Spoonacular is sent the allergens (`c.avoid`, the union); dislikes are
  // applied here, to what came back, and give way when nothing would be left.
  const recipeRows: PlannedRecipe[] = recipeLead && found && (found.status === 'ready' || found.status === 'partial')
    ? preferNotDisliked(found.meals, c.dislikes).rows
      // The hook keeps its last answer while the next one is out, so the rows
      // dim rather than flash away. Across a change of SLOT that answer is for
      // another meal of the day, and is not drawn under this one at all.
      .filter((m) => m.slot === slotSel)
      // The planned recipe already leads the list; it is not listed twice.
      .filter((m) => !slotMeals.some((x) => isRecipeMeal(x) && x.sourceId === m.sourceId))
      .map((m) => portionRecipe(m, recipeLead.slotKcal ?? recipeLead.K, recipeLead.pos))
    : [];
  // ── Today's meals are real recipes ─────────────────────────────────────
  //
  // The owner's call (21 Sep 2026): today's plan is real, photographed
  // recipes; the week and month stay built by the app. Once a day, every slot
  // of TODAY with nothing chosen for it (no recipe the member or coach planned,
  // no meal the coach picked, no dish the member swapped in) is filled with the
  // best-fitting recipe for its calories, diet and allergens, planned on
  // today's date. That is one search per slot (about 2 points each) and then
  // the ordinary read-back.
  //
  // The safety net is the one the plan already has: a slot whose recipe cannot
  // be read shows the app-built meal. A failed search leaves the slot as it
  // was and is not asked again today; the gate in useRecipeSearch already
  // holds a spent quota until midnight UTC. The attempt is remembered per day
  // on the phone, so a member who takes a recipe back out is not refilled.
  const autoKey = datesKey ? `${datesKey}.auto` : null;
  const autoBusy = useRef(false);
  useEffect(() => {
    if (!autoKey || !dpHydrated || autoBusy.current) return;
    if (!hasBody || adjustUnknown || foodRulesUnknown) return;
    if (!today.key || !plan.length) return;
    const open = plan.filter((m) => !refAt(today, m.pos) && !coachPick(m.pos) && override[m.pos] == null);
    if (!open.length) return;
    autoBusy.current = true;
    (async () => {
      try {
        if ((await AsyncStorage.getItem(autoKey)) === today.key) return;
        await AsyncStorage.setItem(autoKey, today.key);
        const taken = new Set<number>();
        for (const m of open) {
          const r = await searchRecipesOnce({ slot: m.slot, diet, avoid: c.avoid, targetKcal: Math.round((m.slotKcal ?? m.K) / 50) * 50, number: 5 });
          if (r.status !== 'ready' && r.status !== 'partial') break;
          const pick = preferNotDisliked(r.meals, c.dislikes).rows.find((x) => !taken.has(x.sourceId));
          if (!pick) continue;
          taken.add(pick.sourceId);
          const dish = portionRecipe({ ...pick, slot: m.slot }, m.slotKcal ?? m.K, m.pos);
          setRecipeLive((prev) => ({ ...prev, [dish.sourceId]: dish }));
          setDatePlan((prev) => withDatedRecipeAt(prev, today.key, m.pos, dish));
        }
      } catch { /* nothing planned; the app-built meals stand */ } finally { autoBusy.current = false; }
    })();
    // Not cancelled on a re-render: today is already marked as tried, so a
    // fill that stopped halfway would never finish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, dpHydrated, hasBody, adjustUnknown, foodRulesUnknown, today.key, plan.length, diet, c.avoid]);

  // Planned recipes in this slot whose dish is NOT in hand: still reading, or
  // the read failed. The generated row is standing in for each of them. `mine`
  // decides whether "Back to Plan's Meal" is offered — it takes out the
  // member's own choice, and a recipe the COACH pinned is not one.
  const recipesWaiting = waitingIn(genSlotMeals, today)
    .map((m) => { const hit = refAt(today, m.pos)!; return { pos: m.pos, ref: hit.ref, from: hit.from, mine: hit.from !== 'coach' }; });
  // Whether any recipe stands in today's list. It decides the one caption that
  // says how far a planned recipe reaches, and the attribution that must go
  // wherever one is shown.
  const recipeInPlan = todayPlan.some((m) => isRecipeMeal(m));
  // The seven days the member is actually shown, decided ONCE and used by both
  // the week view below and the grocery list. `coachWeekDay` is the coach's
  // written day where there is one and null where there is not, which is the
  // rule `planWeek` follows day by day. Before this the list was built from a
  // private `planForDay` that read neither the coach's week nor the member's
  // own swaps, so a member shopped for meals nobody had shown them.
  //
  // `d` is an offset from TODAY, and the coach's week is a repeating week, so
  // the offset is rotated onto it: day 0 is the coach's day for today, not the
  // coach's Monday. Before the horizon this list started at the top of the
  // week, which meant a member on a Friday shopped for Monday to Thursday —
  // four days that had already happened.
  const coachWeekDay = (d: number): Record<number, number> | null =>
    (coachPlanCurrent ? planDayOverride(coachPlan!, (todayIdx + d) % PLAN_WEEKDAYS.length) : null);
  const week = useMemo(() => planWeek(input, coachWeekDay, days.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, coachPlanCurrent, coachPlan, days, todayIdx]);
  // The same seven days with the planned recipes standing in — ONE composition,
  // so This Week, the shopping list and today's list cannot describe three
  // different dinners. `groceryFromWeek` needs nothing new to shop a recipe: a
  // `PlannedRecipe` IS a `PlannedMeal`, its `ing` carries metric amounts and a
  // Repple department already (`deptForAisle`), and its `unmeasured` — "salt,
  // to taste" — comes back on its own heading rather than as a quantity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weekPlan = useMemo(() => week.map((p, d) => withRecipes(p, days[d] ?? today)), [week, days, today, plannedSrc, recipeLive, recipeReads]);
  // How many rows of each day are standing in for a recipe that could not be
  // read. A day with any is a day whose total and whose shopping are INCOMPLETE
  // — the recipe's figures and ingredients are not stored, so there is nothing
  // honest to print — and both places say so rather than quietly totalling the
  // generated stand-in as though it were the meal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const weekWaiting = useMemo(() => week.map((day, d) => waitingIn(day, days[d] ?? today).length), [week, days, today, plannedSrc, recipeLive, recipeReads]);
  const weekUnread = weekWaiting.reduce((a, n) => a + n, 0);
  // Whether a real recipe is anywhere in the week. The shopping list is drawn
  // from those ingredients, so it owes the credit and the backlink too.
  const recipeWeek = weekPlan.some((day) => day.some(isRecipeMeal));
  const groc = useMemo(() => groceryFromWeek(weekPlan), [weekPlan]);
  // The dates this horizon covers, named wherever its food is shown. A month as
  // one flat shopping list is useless — nobody buys thirty days of fresh food
  // at once — so the list follows the selector and SAYS which days it is for,
  // on the sheet, on the row that opens it and in the shared document. "to"
  // rather than a dash: this is read aloud as often as it is read.
  const rangeLabel = days.length > 1
    ? `${fmtDay(days[0]?.key ?? '')} to ${fmtDay(days[days.length - 1]?.key ?? '')}`
    : fmtDay(today.key);
  const spanLabel = `${num(days.length)} ${days.length === 1 ? 'day' : 'days'}`;
  // The catalogue is finite and the horizon steps through it, so a long enough
  // horizon comes back round to a meal it has already served. `catalogRepeatDay`
  // is that arithmetic; this is the day it happens on for the tightest slot in
  // this member's plan. Measured: nothing repeats inside 31 days for a member
  // with no exclusions, in any diet. A keto member avoiding dairy and nuts has
  // 100 snacks and a stride of 25, so their snacks come round on day four — and
  // they are told so rather than served the same week twice in silence. It is
  // the GENERATED meals that repeat; a day a recipe stands on is that recipe.
  const repeatsOn = useMemo(() => Math.min(...planSlots.map((s) => catalogRepeatDay(diet, s, c.avoid))),
    [planSlots, diet, c.avoid]);
  const horizonRepeats = days.length > repeatsOn ? repeatsOn : 0;
  // ── the exclusions that could not be honoured, computed once ────────────
  //
  // It used to be computed inside the Today arm and rendered only there, so
  // switching to This Week took the warning off the screen while leaving the
  // meals it was about — and the grocery sheet below, which is built from that
  // same week and is the artefact somebody actually shops from, never carried
  // it at all.
  const gapNote = useMemo(
    () => allergenGapNote(emptySlots(diet, slotsFor(c.mealsPerDay), c.avoid)),
    [diet, c.mealsPerDay, c.avoid],
  );
  // The dislikes that had to be relaxed. A preference, so it is said in the
  // ordinary warning tone and never in the allergen one.
  const dislikeNote = useMemo(
    () => dislikeGapNote(dislikeGaps(diet, slotsFor(c.mealsPerDay), c.avoid, c.dislikes)),
    [diet, c.mealsPerDay, c.avoid, c.dislikes],
  );
  // Which of the excluded things are actually in the week the list is built
  // from. `gapNote` says the filter could not be honoured; this says what ended
  // up in the shopping. Both go on the sheet.
  // Read off the week AS SHOPPED, so a recipe's ingredients are marked the way
  // the row and the sheet mark them — and through `recipeAllergens` for a
  // recipe, which reads the unmeasured ingredients too ("butter, for greasing"
  // is exactly as much dairy as 50 g of it).
  const weekAllergens = useMemo(() => {
    const found = new Set<Allergen>();
    for (const day of weekPlan) {
      for (const m of day) for (const a of (isRecipeMeal(m) ? recipeAllergens(m, c.avoid) : mealAllergens(m, c.avoid))) found.add(a);
    }
    return [...found];
  }, [weekPlan, c.avoid]);
  const grocCount = DEPTS.reduce((a, d) => a + (groc.byDept[d]?.length ?? 0), 0) + groc.cupboard.length;
  const grocKeys = [...DEPTS.flatMap((d) => (groc.byDept[d] || []).map((it) => d + '|' + it.item)), ...groc.cupboard.map((it) => 'cupboard|' + it.item)];
  // What the plan needs, as a person reads an amount: "810 g", "1.26 kg".
  const grocNeed = (it: GroceryItem) => needText(it.qty, it.unit, numUpTo);
  // A line is the pack to pick up with the exact need beside it, or the need
  // alone where there is no honest pack (loose produce, meat by weight).
  const grocLine = (it: GroceryItem) => it.buy ? `${it.buy} (plan uses ${grocNeed(it)})` : grocNeed(it);
  const grocChecked = grocKeys.filter((k) => checked[k]).length;
  const toggleGroc = (k: string) => setChecked((prev) => {
    const n = { ...prev, [k]: !prev[k] };
    // No key means no account yet, and a tick written without one is a tick the
    // next person on the handset inherits. It still shows on screen for this
    // session; it simply is not kept.
    if (grocKey) AsyncStorage.setItem(grocKey, JSON.stringify(n)).catch(() => {});
    return n;
  });
  const shareGrocery = async () => {
    // The warning travels with the file. A list shared to a phone's notes app
    // or printed is read where none of this screen's flags exist.
    const warn = [
      gapNote,
      weekAllergens.length
        ? `Meals in this week contain ${weekAllergens.map(allergenLabel).join(' and ')}, which you asked to avoid. Check each item before you buy.`
        : null,
      // A list that is short of a planned recipe's ingredients is a list
      // somebody shops from and comes home missing a dinner.
      weekUnread ? UNREAD_SHOPPING_WARNING : null,
    ].filter(Boolean) as string[];
    // The DATES this list is for, at the top of it. A month of shopping with no
    // range on it is a list nobody can use: it is read in a supermarket, days
    // after it was sent, with none of this screen around it, and thirty days of
    // fresh food is not one trip.
    const range = `${days.length === 1 ? 'For' : 'For the'} ${spanLabel} ${days.length === 1 ? 'of' : 'from'} ${rangeLabel}.`;
    const spread = days.length > 7
      ? 'That is more than a week of food, so buy the fresh things a few days at a time.'
      : null;
    const head = [range, spread].filter(Boolean) as string[];
    const lines: string[] = ['Grocery List', ...head, ...(warn.length ? ['', ...warn] : []), ''];
    let html = '<h2>Grocery List</h2>' + head.map((h) => `<p>${h}</p>`).join('') + warn.map((w) => `<p><strong>${w}</strong></p>`).join('');
    DEPTS.filter((d) => groc.byDept[d]?.length).forEach((d) => {
      lines.push(d.toUpperCase());
      html += '<h3>' + d + '</h3><ul>';
      groc.byDept[d]!.forEach((it) => { const q = grocLine(it); lines.push('- ' + it.item + ': ' + q); html += '<li>' + it.item + ': ' + q + '</li>'; });
      html += '</ul>'; lines.push('');
    });
    if (groc.cupboard.length) {
      lines.push(CUPBOARD_HEAD.toUpperCase(), CUPBOARD_NOTE);
      html += '<h3>' + CUPBOARD_HEAD + '</h3><p>' + CUPBOARD_NOTE + '</p><ul>';
      groc.cupboard.forEach((it) => { const q = grocLine(it); lines.push('- ' + it.item + ': ' + q); html += '<li>' + it.item + ': ' + q + '</li>'; });
      html += '</ul>'; lines.push('');
    }
    // Named, never quantified: a recipe asked for salt to taste, and "0 g salt"
    // on a shopping list is a figure nobody wrote.
    if (groc.unmeasured.length) {
      lines.push(UNMEASURED_HEAD.toUpperCase());
      html += '<h3>' + UNMEASURED_HEAD + '</h3><ul>';
      groc.unmeasured.forEach((it) => { lines.push('- ' + it); html += '<li>' + it + '</li>'; });
      html += '</ul>'; lines.push('');
    }
    if (recipeWeek) { lines.push(RECIPE_DISCLAIMER, `${RECIPE_ATTRIBUTION.text}: ${RECIPE_ATTRIBUTION.url}`); html += `<p>${RECIPE_DISCLAIMER}</p><p><a href="${RECIPE_ATTRIBUTION.url}">${RECIPE_ATTRIBUTION.text}</a></p>`; }
    await shareDoc(html, lines.join('\n'), 'Grocery List');
  };
  // The rows below are labelled by DATE (`fmtDay`), because they are days
  // ahead of today rather than the seven weekdays of one week — "Thu" on a
  // month of rows names four different Thursdays. `WEEK_DAY_NAMES` is still
  // what a WEEKDAY choice is called ("every Thursday"), and `PLAN_WEEKDAYS` is
  // still the order the coach's repeating week is written in.
  const sharePlan = async () => {
    // `todayPlan`, not `plan`. This mapped the composed catalogue day, so a
    // member who sent their plan to somebody sent the meals they had replaced.
    const rows = todayPlan.map((m) => ({ slot: m.slot, name: m.n, K: m.K, P: m.P, C: m.C, F: m.F }));
    const labels = c.avoid.map((a) => (ALLERGENS.find((x) => x.id === a)?.label ?? a));
    // Attribution and the backlink go WITH the document — it is read where none
    // of this screen's links exist — and so does the sentence that says a
    // planned recipe could not be read and the plan's own meal is in the table
    // in its place.
    const note = [
      recipeInPlan ? `${RECIPE_DISCLAIMER} ${RECIPE_ATTRIBUTION.text}: ${RECIPE_ATTRIBUTION.url}` : null,
      todayWaiting.length ? UNREAD_SHOPPING_WARNING : null,
    ].filter(Boolean).join(' ');
    const { html, text } = mealPlanDoc(c.name, target.kcal, rows, labels, appName, t.brand, note || undefined);
    await shareDoc(html, text, 'Meal Plan');
  };
  // `idx + d` was a synthetic week — the same meal shifted along the catalogue
  // one place per day, which is a pattern rather than a plan. Where the coach
  // has written a real week, show theirs.
  //
  // A day standing in for a recipe it could not read has NO total: the figures
  // belong to the recipe and are not stored, and the generated stand-in's `K`
  // summed under the recipe's name is a number for a plate nobody is serving.
  const weekPlans = view !== 'today'
    ? weekPlan.map((p, d) => ({ day: days[d] ?? today, plan: p, waiting: weekWaiting[d], tot: { K: weekWaiting[d] ? null : p.reduce((a, m) => a + m.K, 0) } }))
    : [];

  const G = layout.gutter;
  const eaten = fl.consumed;
  // Whether today's food log is what the server holds.
  //
  // Every figure below this line is `target − eaten`, and `eaten` is a FLOOR
  // under anything but a whole read: the provider's own header says so. So a
  // failed read did not make this screen blank, it made it generous — a member
  // whose log could not be read was shown their entire day's allowance as
  // "Calories Left", with three empty macro bars and the words "Nothing logged
  // today" underneath, and ate to it. The prompt below does exactly this for
  // the profile read; the food read, which is the one that moves every day,
  // had nothing.
  const dayWhole = isWhole(fl.status);
  // One sum, shared with the Food Log, so the two cannot drift apart again.
  // The budget argument is what stops a day's movement being counted twice:
  // this target is bmr * activity, so the multiplier has already paid for an
  // ordinary day and only the excess over it is new food. See caloriesLeft().
  // dayBurn picks the figure the connected device actually publishes and the
  // budget it may be compared against — active against the movement the
  // activity multiplier bought, whole-day against the whole TDEE. Null when no
  // device has reported, which shows no burn rather than a zero.
  const burn = dayBurn(target, wear.today);
  const cal = caloriesLeft(target.kcal, eaten.kcal, burn?.burned ?? 0, burn?.budgeted ?? 0, burn?.kind);
  // ── and whether that burn is a CURRENT reading ─────────────────────────
  //
  // src/ui/wearables.tsx says it on `todayStatus` in its own words: "A screen
  // printing a figure off `today` should say so when this is not 'ready'."
  // This screen prints it, in `caloriesNote` under the hero — "2,648 kcal
  // burned all day, rest included, 97 more than your activity level assumes" —
  // and asked nothing. Under 'error' that is not today's movement: it is
  // whatever the last successful read left behind, which after a night of
  // failed syncs is yesterday's, and a member reads it as the day they are
  // standing in.
  //
  // What it is NOT is arithmetic. `caloriesLeft` computes `net = target −
  // eaten` and has never added the burn — nutrition.ts argues that at length —
  // so no allowance moves and there is nothing to withhold. This is a claim
  // about a measurement, and the fix is the one the provider was built to make
  // possible: say which of the two it is. Withholding the figure would be
  // wrong for the reason that file gives about keeping it — a watch that could
  // not be reached at three o'clock did not un-burn the morning.
  //
  // `isWhole`, not `!== 'error'`: the comparison that reads naturally admits
  // 'loading' too, and 'loading' gets no banner — a first read still in flight
  // is not a stale figure, and `burn` is null under it anyway.
  // Only where a burn is actually PRINTED: `caloriesNote` drops the clause
  // when the figure is nought, and the whole note is withheld while today's
  // log is not whole. A banner about a sentence that is not on screen is its
  // own small lie.
  const burnStale = dayWhole && (burn?.burned ?? 0) > 0
    && !isWhole(wear.todayStatus) && wear.todayStatus !== 'loading';
  // The basis of the targets in the ring card, short enough to sit under the
  // macros. `targetBasis` is the same fact at full length.
  const targetSource = energyPlan.kind === 'derived'
    ? 'Targets built from your weight goal and date'
    : `Targets from your measurements and general goal (${GOAL_LABEL[c.goal]})`;
  // ── water ──────────────────────────────────────────────────────────────
  // Two reads, as on Recovery: the count is the habits store's, the goal is
  // `clients.water_goal_glasses` and rides on the profile read. `hydrationNote`
  // decides what may be drawn from the pair — see src/lib/hydrationHero.ts.
  // (The profile read is whole by the time this is on screen: `foodRulesUnknown`
  // is a door above. It is passed anyway, so the rule is asked and not assumed.)
  const hydration = hydrationNote(habits.waterStatus, c.profileStatus, habits.water, habits.waterGoal);
  const waterGoal = hydration.showRing ? habits.waterGoal : null;
  const cycleNote = dayType === 'training' ? `+${CYCLE_KCAL} kcal, more carbs` : dayType === 'rest' ? `−${CYCLE_KCAL} kcal, fewer carbs` : undefined;

  // The same door for the same reason, and `adjustUnknown` goes through it
  // rather than getting a banner over a plan: this screen has no honest partial
  // state. The targets, the meters, the seven-day week and the grocery list are
  // all one arithmetic, and there is nowhere to show that arithmetic with the
  // coach's correction missing from it without the member reading the result as
  // their plan. So the screen says what it does not know instead.
  //
  // `foodRulesUnknown` joins it for the same reason and a worse consequence —
  // see the long note on it above. `hasBody` cannot stand in for it: weight and
  // body fat fall back to the latest scan, so a failed profile read with
  // healthy scans passes this door with `avoid` empty and `diet` at its default
  // unless it is asked about directly.
  if (!hasBody || adjustUnknown || foodRulesUnknown) {
    // 'loading' is the ONLY status that means "still reading". Written as
    // `!bodyKnown` this was also true under 'error', and 'error' is where this
    // screen sat: clientData clears the local cache at launch under
    // USE_SUPABASE, its hydrate effect is keyed on the signed-in uid and does
    // not re-run on its own, and there is no pull-to-refresh here. So a single
    // refused measurements read left the Meals tab spinning under "Reading your
    // latest measurements…" for the whole session, with the two `c.status ===
    // 'error'` arms below it — one of which is the sentence written for exactly
    // this case — unreachable, because `looking` had already answered.
    const looking = c.status === 'loading';
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>
          <PageHead title="Nutrition" />
          <Section>
            {/* The measurements arms are asked first and only of the case
                they are about, so the food-rules arms below cannot answer
                over the top of "you have never been scanned". Each is the
                reason the plan is withheld, so each stays on the page — cut
                to the one line that says what was not read and what to do. */}
            <Text style={{ ...ty.label, color: t.ink2, marginBottom: sp.md }}>{adjustUnknown
              ? 'Your coach’s adjustment to your targets could not be read, so no plan is shown. Generic figures are not your coach’s plan. Check back in a moment.'
              : !hasBody
              ? (looking
                ? 'Reading your latest measurements…'
                : c.status === 'error'
                  ? 'Your measurements could not be read just now, so no targets are shown. This is a connection problem, not a missing scan.'
                  : 'Your targets and meal plan are scaled to your body, so they need a weight and body fat.')
              : c.profileStatus === 'loading'
              ? 'Reading your diet and the foods you asked to avoid…'
              : 'Your diet and the foods you avoid could not be read, so no plan is shown. Meals built without your exclusions would be the wrong food. Pull down to try again.'}</Text>
            {/* No button on the error path. "Add Your Measurements" is the
                wrong thing to offer somebody whose measurements exist and
                could not be fetched — it invites them to type in a duplicate
                of a scan they already have. */}
            {/* No button on the adjustment path either, and for the same
                reason: there is nothing for the member to add. The read has to
                land, and it is retried by the provider rather than by them. */}
            {/* Nor on the exclusions path: the member has already told the app
                what they avoid, and offering to take it again here would ask
                them to re-enter an allergy the server is holding — into a
                provider whose write is disarmed while the read is failing. */}
            {adjustUnknown ? null
              : !hasBody
                ? (looking ? <ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel="Reading your measurements…" />
                  : c.status === 'error' ? null
                  : <Cta label="Add Your Measurements" wide onPress={() => router.push('/(client)/scans')} />)
              : c.profileStatus === 'loading' ? <ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel="Reading your profile…" />
              : null}
          </Section>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── today's list: the rows, and how one is drawn ───────────────────────
  //
  // The plan's own rows lead; a generated dish a recipe has displaced follows
  // as an ordinary row (it is how the member gets back to it from the list);
  // then the rest of the slot's catalogue. Real recipes are drawn by the same
  // `mealRow`, under their own sub-head, further down.
  const mealQ = mealQuery.trim().toLowerCase();
  const recipeQueryShort = mealQ.length > 0 && mealQ.length < 3;
  const matchesQuery = (m: PlannedMeal) => !mealQ || m.n.toLowerCase().includes(mealQ);
  // The plan's own row, then real recipes, then the app's other ideas: real,
  // photographed recipes lead the swap list (owner, 21 Sep 2026), and the
  // app-built dishes follow as more ideas and as the net when the library
  // cannot answer.
  const planRows: PlannedMeal[] = slotMeals.filter(matchesQuery);
  const ideaRows: PlannedMeal[] = [
    ...genSlotMeals.filter((g) => todayPlan[g.pos] !== g).filter(matchesQuery),
    ...slotOptions,
  ];
  /** One row of today's list — a generated dish or a real recipe, drawn alike.
   *  `dim` is the recipe rows while the next search is out: the old answer
   *  stays put, faded, rather than flashing away and back. */
  /** `inToday` is the Today’s Meals card, where every row is the plan’s: the
   *  words "In your plan" would be said of all of them, so only WHOSE pick it
   *  is survives there. */
  /** Protein, Carbs and Fat, one line each, the word and its grams in bold
   *  ink (owner, 21 Sep 2026: the one grey run-on line was hard to read). */
  const macroLines = (p: number, cc: number, f: number) => (
    <View style={{ marginTop: 2 }}>
      {([['Protein', p], ['Carbs', cc], ['Fat', f]] as const).map(([w, g]) => (
        <Text key={w} style={{ ...ty.caption, ...numeric, ...font('700'), color: t.ink }}>{w} {num(Math.round(g))}{'\u00A0'}g</Text>
      ))}
    </View>
  );
  const mealRow = (m: PlannedMeal, ruled: boolean, dim = false, inToday = false) => {
    const real = isRecipeMeal(m) ? m : null;
    // Read once and used twice — for the mark and for the sentence.
    // Two reads is how the two come to disagree.
    //
    // For a recipe this is Repple's OWN reading of the ingredient list, measured
    // and unmeasured, against today's exclusions — never the remote filter's
    // word for it, and not the `flagged` the dish was read with either, which
    // is as old as the read.
    const inIt = real ? recipeAllergens(real, c.avoid) : mealAllergens(m, c.avoid);
    const planned = inToday || slotMeals.some((x) => sameDish(x, m));
    const whose = real ? 'Your Recipe' : coachPick(m.pos) ? 'Coach’s Pick' : null;
    const plate = t.data[`${SLOT_TONE[m.slot]}Soft`];
    return (
      <View key={`${m.pos}-${dishKey(m)}`} style={dim ? { opacity: 0.5 } : undefined}>
        {ruled ? <Rule /> : null}
        <Pressable onPress={() => openMeal(m, today)} accessibilityRole="button"
          // Not `m.n`. A Pressable is one accessibility element, so a
          // label on it REPLACES the lines below rather than adding
          // to them — and the line it was replacing hardest is the
          // allergen mark. See `mealRowSpoken`.
          accessibilityLabel={m.unfillable?.length ? `${m.slot}. ${m.n}. Search real recipes for it`
            : `${mealRowSpoken({
            slot: m.slot, coachPick: planned && coachPick(m.pos), name: m.n,
            allergens: inIt, kcal: String(m.K),
          })}${real ? ', a real recipe' : ''}${planned ? ', in your plan' : ''}`}
          style={{ paddingVertical: sp.md, gap: sp.sm }}>
          {/* ── the row, laid out to use its width (owner, 21 Sep 2026) ──────
              It was picture | narrow text column | kcal chip, with the chip's
              column running the full height of the row, so every name wrapped
              into a third of the card and the right side sat empty. Now the
              name has the width beside the picture, and the four figures run
              across the whole card underneath in one strip. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
            {/* The dish's own glyph on a plate; a real recipe's photograph is
                drawn over it (Spoonacular's terms: URL kept, bytes not). */}
            <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: plate, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <Text style={{ fontSize: 24 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{m.ico}</Text>
              {real?.image ? (
                <GuardedImage source={{ uri: real.image }} contentFit="cover" cachePolicy="memory"
                  style={{ position: 'absolute', width: 52, height: 52 }} />
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...ty.caption, ...font('700'), color: t.ink }}>
                {m.slot}{planned && (whose || !inToday) ? <Text style={{ color: t.brandText }}>{' · ' + [inToday ? null : 'In Your Plan', whose].filter(Boolean).join(' · ')}</Text> : null}
              </Text>
              {(() => { const nm = mealTitleParts(m.n); return (<>
                <Text style={{ ...ty.head, color: t.ink }}>{nm.main}</Text>
                {nm.note ? <Text style={{ ...ty.caption, color: t.ink2 }}>({nm.note})</Text> : null}
              </>); })()}
            </View>
          </View>
          {m.unfillable?.length ? (
            // An empty slot: nothing to count, and the one thing to do.
            <Text style={{ ...ty.caption, color: t.ink2 }}>Tap to search real recipes, or ask your coach</Text>
          ) : (
            <View style={{ flexDirection: 'row', borderRadius: radius.md, backgroundColor: t.surface2, paddingVertical: sp.sm }}>
              {([
                [num(m.K), 'kcal', t.data.orangeInk],
                [`${num(Math.round(m.P))}\u00A0g`, 'Protein', t.ink],
                [`${num(Math.round(m.C))}\u00A0g`, 'Carbs', t.ink],
                [`${num(Math.round(m.F))}\u00A0g`, 'Fat', t.ink],
              ] as const).map(([v, w, ink], i) => (
                <View key={w} style={{ flex: 1, alignItems: 'center', borderStartWidth: i ? hairline : 0, borderStartColor: t.ring }}>
                  <Text style={{ ...ty.label, ...numeric, ...font('700'), color: ink }}>{v}</Text>
                  <Text style={{ ...ty.caption, color: t.ink2 }}>{w}</Text>
                </View>
              ))}
            </View>
          )}
          {/* On the row somebody is about to cook: crit in the MARK, the
              words in ink, so colour is never the only channel. */}
          {inIt.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
              <Text style={{ ...ty.caption, color: t.ink2 }}>
                Contains {inIt.map(allergenLabel).join(' and ')}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    );
  };
  // The sheet's dish, narrowed once. Everything recipe-only on the sheet — the
  // photograph, the credit, the unmeasured ingredients, the disclaimer, and
  // WHICH of the two "Use This Meal" paths a tap takes — hangs off this.
  const sheetRecipe = recipe && isRecipeMeal(recipe) ? recipe : null;
  // What is planned at the open sheet's slot ON ITS OWN DAY, and which of the
  // three sources said so. The two `sourceId`s below are asked of each layer
  // separately rather than of the winner, because the sheet offers both
  // buttons and each must say what IT holds: a member can have planned this
  // dish for the 25th and for every Thursday, and taking it off one of them is
  // not taking it off the other.
  const sheetHit = recipe && recipe.pos >= 0 ? refAt(planDay, recipe.pos) : null;
  const sheetOnDate = recipe && recipe.pos >= 0 && planDay.key ? datePlan[planDay.key]?.[recipe.pos]?.sourceId ?? null : null;
  const sheetOnWeekday = recipe && recipe.pos >= 0 ? recipePlanAt(recipePlan, planDay.weekday, recipe.pos)?.sourceId ?? null : null;
  const sheetWeekdayName = WEEK_DAY_NAMES[planDay.weekday] ?? '';
  /** Which of the member's OWN two choices holds this slot, if either. A
   *  coach's pin is not one, and is not taken out from this sheet. */
  const sheetMine: 'date' | 'weekday' | null = sheetHit && sheetHit.from !== 'coach' ? sheetHit.from : null;
  const sheetAllergens = !recipe ? [] : sheetRecipe ? recipeAllergens(sheetRecipe, c.avoid) : mealAllergens(recipe, c.avoid);
  // One reader per DISTINCT planned recipe whose dish is not already in hand —
  // by `sourceId`, so the same recipe in two slots, or on three days, is one
  // read and not six.
  //
  // The whole week, not just today, because the week is what the grocery list
  // is built from and a ref has no ingredients. The cost is bounded by what the
  // member (or their coach) deliberately PLANNED, never by how many rows a list
  // happens to draw — which is the rule that matters now that an overrun is
  // billed rather than refused: a detail is 1.1 points against 0.11 inside a
  // search, and nothing here fetches one per search result.
  // ponytail: one read per planned recipe, no cross-screen cache. If a member
  // planning seven recipes a week turns out to be common, cache the replies by
  // sourceId in src/ui/useRecipeSearch.ts, where the gate already lives.
  // ── what a horizon costs, and the bound on it ──────────────────────────
  //
  // Every planned recipe whose dish is not already in hand is one detail read,
  // and a detail is 1.1 Spoonacular points. This account is on the Cook plan,
  // which BILLS an overrun at half a cent a point rather than refusing it, so a
  // month of planned dinners is real money on a screen somebody opens daily.
  //
  // Two rules, and together they are why this is no longer a map over a fixed
  // week. Only the days ACTUALLY ON SCREEN are read, so drawing today does not
  // pay for a month. And the number is BOUNDED: the days are walked
  // nearest-first, so the bound falls on the far end of the horizon and
  // planning further ahead never takes today's recipes away. What the bound
  // left out is said on screen rather than quietly not loaded.
  //
  // Still one read per distinct `sourceId` and never one per row: the same
  // dinner on four days is one read, which is what the `seenRefs` set is for.
  const RECIPE_READ_BUDGET = 12;
  const seenRefs = new Set<number>();
  const recipesToRead: { sourceId: number; slot: Slot }[] = [];
  for (const { day, meals } of [{ day: today, meals: plan }, ...week.map((meals, d) => ({ day: days[d] ?? today, meals }))]) {
    for (const m of meals) {
      const hit = refAt(day, m.pos);
      if (!hit || recipeLive[hit.ref.sourceId] || seenRefs.has(hit.ref.sourceId)) continue;
      seenRefs.add(hit.ref.sourceId);
      if (recipesToRead.length < RECIPE_READ_BUDGET) recipesToRead.push({ sourceId: hit.ref.sourceId, slot: m.slot });
    }
  }
  const recipesUnread = seenRefs.size - recipesToRead.length;

  const dietPills = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
      {DIETS.map((d) => { const on = diet === d; return (
        <Pressable key={d} onPress={() => c.setDiet(d)}
          accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={DIET_LABEL[d]}
          style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
          <Text style={{ ...ty.label, ...font(on ? '600' : '400'), color: on ? t.brandInk : t.ink2 }}>{DIET_LABEL[d]}</Text>
        </Pressable>
      ); })}
    </View>
  );
  const dislikeEditor = (
    <>
            {c.dislikes.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.sm }}>
          {c.dislikes.map((w) => (
            <Pressable key={w} onPress={() => { void saveDislikes(c.dislikes.filter((x) => x !== w)); }}
              accessibilityRole="button" accessibilityLabel={`Remove ${w}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
              <Text style={{ ...ty.label, color: t.ink }}>{w}</Text>
              <Icon name="minus" size={12} color={t.ink3} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
        <TextInput value={dislikeDraft} onChangeText={setDislikeDraft} placeholder="e.g. mushrooms" placeholderTextColor={t.ink3}
          accessibilityLabel="Add a food you dislike" returnKeyType="done" autoCorrect={false} autoCapitalize="none"
          onSubmitEditing={addDislike}
          style={{ ...ty.body, flex: 1, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10 }} />
        <Pressable onPress={addDislike} disabled={!normaliseDislike(dislikeDraft)}
          accessibilityRole="button" accessibilityLabel="Add dislike"
          style={{ paddingHorizontal: sp.lg, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: normaliseDislike(dislikeDraft) ? t.brand : t.surface2 }}>
          <Text style={{ ...ty.label, ...font('600'), color: normaliseDislike(dislikeDraft) ? t.brandInk : t.ink3 }}>Add</Text>
        </Pressable>
      </View>
    </>
  );
  const avoidPills = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
      {ALLERGENS.map((al) => { const on = c.ownAvoid.includes(al.id); return (
        <Pressable key={al.id} onPress={() => c.setOwnAvoid(on ? c.ownAvoid.filter((x) => x !== al.id) : [...c.ownAvoid, al.id])}
          accessibilityRole="button" accessibilityState={{ selected: on }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.surface3 : t.surface2 }}>
          {on ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
          <Text style={{ ...ty.label, ...font(on ? '500' : '400'), color: on ? t.ink : t.ink2 }}>{al.label}</Text>
        </Pressable>
      ); })}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* Draw nothing; read the member's planned recipes back from their ids.
            Mounted here, below the three doors above, so nothing is read for a
            member whose diet and exclusions are unknown — the allergen re-check
            on what comes back is made against `c.avoid`. */}
        {recipesToRead.map((r) => (
          <PlannedRecipeRead key={r.sourceId} sourceId={r.sourceId} ctx={{ slot: r.slot, diet, avoid: c.avoid }} onRead={onRecipeRead} />
        ))}

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The mockup's centred head. Which day the ring under this is
            counting rides as the quiet line, as a date and not only the word:
            the food log is read for the reader's own calendar day, and a
            screen left open past midnight should say which one it is showing.
            A tab root has no back; the leading slot carries Share, and the
            trailing one is the info control the help row became. */}
        <PageHead title="Nutrition"
          subtitle={`Today · ${new Date().toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}`}
          leading={<Ghost icon="share" a11yLabel="Share Plan" onPress={sharePlan} />}
          // Two controls in the trailing slot: search, then help. Search is on
          // every tab root now — a member who knows the word for what they want
          // should not have to know which tab it was filed under.
          trailing={<View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xs }}>
            <Ghost icon="search" a11yLabel="Search anything in Repple" onPress={() => router.push('/(client)/explore')} />
            <Ghost icon="info" a11yLabel={SCREEN_HELP.meals.title} onPress={() => setHelpOpen(true)} />
          </View>} />

        {/* Plan, Targets and Recipes as the board draws them. Targets is the
            Goal screen, which owns the figures; Recipes opens the first meal
            of the plan in the sheet every meal row below already opens, and
            is off until there is a plan to open. Both GO somewhere, so
            neither ever draws as selected — see `Segment.onPress`. */}
        <Segmented style={{ marginTop: sp.lg }} value="plan" onChange={() => {}}
          options={[
            { key: 'plan', label: 'Plan' },
            { key: 'targets', label: 'Targets', onPress: () => router.push('/(client)/goal') },
            // The recipe library, not the first meal of the day: it opened one
            // recipe (Apple & Cinnamon Oats) and nothing else (owner, 21 Sep
            // 2026). Now it opens the real search on Swap or Search and scrolls
            // there; the meal tabs on that card pick breakfast, lunch or dinner.
            { key: 'recipes', label: 'Recipes', disabled: plan.length === 0, onPress: () => {
              setView('today'); setRecipeSearchOpen(true); setWantRecipes(true);
              if (swapY.current != null) scrollRef.current?.scrollTo({ y: Math.max(0, swapY.current - 12), animated: true });
            } },
          ]} />

        {/* ── today, as the board draws it ──────────────────────────────────
            One white card: the calorie ring on the left, the three macros
            beside it, Log Meal under both. It was a night hero headed
            "2,480 kcal Left" over a separate macro card, which is not what the
            approved Meals board shows (owner, 21 Sep 2026).

            The ring and the macros still wait for a whole read: an unread log
            is a track and a dash, never an empty arc round a full allowance,
            and the line under them says which read is short. */}
        <Section>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
            <Pressable onPress={() => router.push('/(client)/foodlog')} accessibilityRole="button"
              accessibilityLabel={dayWhole ? `${num(eaten.kcal)} of ${num(target.kcal)} calories eaten today. Open the food log` : 'Today’s calories are not counted. Open the food log'}
              hitSlop={8}>
              <Ring
                value={dayWhole && target.kcal ? eaten.kcal / target.kcal : null}
                figure={dayWhole ? num(eaten.kcal) : null}
                sub={`of ${num(target.kcal)} kcal`}
                spoken={dayWhole ? `${num(eaten.kcal)} of ${num(target.kcal)} calories eaten today` : 'Today’s calories are not counted'} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Meter label="Protein" tone="blue" val={dayWhole ? Math.round(eaten.protein) : null} target={target.protein} />
              <Meter label="Carbs" tone="orange" val={dayWhole ? Math.round(eaten.carbs) : null} target={target.carbs} />
              <Meter label="Fat" tone="purple" val={dayWhole ? Math.round(eaten.fat) : null} target={target.fat} />
            </View>
          </View>
          {/* What is left, and the burn it counts: the sentence the stale
              burn warning below refers to. */}
          {dayWhole ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md, textAlign: 'center' }}>{caloriesNote(cal)}</Text>
          ) : (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {fl.status === 'loading' ? 'Reading today’s food log…'
                : fl.status === 'partial' ? 'More is logged today than can be read in one go, so what is left is unknown.'
                : 'Today’s food log could not be read, so what is left is unknown. It is not your whole allowance.'}
            </Text>
          )}
          <View style={{ marginTop: sp.lg }}>
            <Cta label="Log Meal" wide onPress={() => router.push('/(client)/foodlog')} />
          </View>
          {/* Where the targets came from, in one line: a target with no
              source reads as a rule nobody set. A coach-adjusted plan is
              marked with a coloured dot beside ink text. */}
          <View accessible accessibilityLabel={`${coachAdjust ? 'Coach-adjusted. ' : ''}${targetSource}`}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: sp.md }}>
            {coachAdjust ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} /> : null}
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', flexShrink: 1 }}>{coachAdjust ? 'Coach-adjusted · ' : ''}{targetSource}</Text>
          </View>
        </Section>

        {/* The burn named in the sentence above is the last thing the device
            told us rather than a current reading. Said here rather than woven
            into `caloriesNote`, which is shared with screens that know nothing
            about devices — and said in the same words the two Devices screens
            use, so a member who reads both is told one thing. */}
        {burnStale ? (
          <Flag tone={t.warn} style={{ marginTop: 14 }}>
            Calories burned is the last figure we had. Your device could not be reached. Pull down to try again.
          </Flag>
        ) : null}


        {/* ── water ─────────────────────────────────────────────────────────
            The mockup's tracker: one segment per glass of the member's OWN
            goal, filled in teal. No goal is no segments — a row of eight
            drawn for somebody who never set eight is a target invented to
            fill a card — and the head offers the way to set one instead, only
            when we KNOW there is none (`offerGoal`). The count is printed
            whenever it is known; the bar needs both reads. */}
        <Section>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
            <Text accessibilityRole="header" style={{ ...ty.caption, ...font('700'), color: t.ink }}>Water</Text>
            {hydration.offerGoal ? (
              <Pressable onPress={() => router.push('/(client)/habits')} accessibilityRole="button" accessibilityLabel="Set a Water Goal" hitSlop={hitSlopFor(24)}>
                <Text style={{ ...ty.caption, ...font('700'), color: t.data.tealInk }}>Set a Water Goal</Text>
              </Pressable>
            ) : (
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3, flexShrink: 1 }}>
                {!hydration.showCount ? 'Reading…'
                  : waterGoal != null ? `${num(habits.water)} of ${num(waterGoal)} glasses`
                  : `${num(habits.water)} ${habits.water === 1 ? 'glass' : 'glasses'} today`}
              </Text>
            )}
          </View>
          {waterGoal != null ? (
            <View accessible accessibilityRole="progressbar"
              accessibilityLabel={`${num(habits.water)} of ${num(waterGoal)} glasses of water today`}
              accessibilityValue={{ min: 0, max: waterGoal, now: Math.min(habits.water, waterGoal) }}
              style={{ flexDirection: 'row', gap: 5, marginTop: sp.sm }}>
              {Array.from({ length: waterGoal }, (_, i) => (
                <View key={i} style={{ flex: 1, height: 22, borderRadius: 6, backgroundColor: i < habits.water ? t.data.teal : t.surface3 }} />
              ))}
            </View>
          ) : hydration.offerGoal ? (
            <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: sp.xs }}>
              {num(habits.water)} {habits.water === 1 ? 'glass' : 'glasses'} today
            </Text>
          ) : null}
          {/* Only the two FAULTS get their sentence here: a count this phone
              could not check, and a goal that could not be read. "3 more to
              go" is the bar above said again in words. */}
          {hydration.kind === 'countUnread' || hydration.kind === 'goalUnread' ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{hydration.text}</Text>
          ) : null}
          {/* Dead until the count has arrived. `addWater` writes an ABSOLUTE
              count from a ref that is 0 until the read lands, so an early tap
              writes 1 over a morning's 5 — app/(client)/recovery.tsx carries
              the long form of this, and the same gate. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
            <Ghost icon="minus" a11yLabel="Remove a Glass" onPress={habits.removeWater} disabled={!hydration.showCount} />
            <View style={{ flex: 1 }}>
              <Ghost label="Add a Glass" icon="plus" onPress={habits.addWater} disabled={!hydration.showCount} />
            </View>
          </View>
        </Section>

        {/* ── the plan: today or the week ────────────────────────────────── */}
        <Section>
          {/* The mockup's "Today’s Meals" with its trailing link; the link is
              the week, which is what "See all" of a day's plan is. */}
          <SectionHead title={view === 'today' ? 'Today’s Meals' : view === 'week' ? 'This Week' : 'This Month'}
            note={view === 'today' ? fmtDay(today.key) : rangeLabel} />
          {/* How far ahead the member is looking AND planning. It was a link
              that flipped between today and the week; a month is a third
              thing, and the shopping list and the recipe reads below both
              follow whichever is chosen rather than a week nobody asked for. */}
          <Segmented style={{ marginBottom: sp.md }} value={view} onChange={(v) => setView(v)}
            options={[
              { key: 'today', label: 'Today' },
              { key: 'week', label: 'This Week' },
              { key: 'month', label: 'This Month' },
            ]} />
          <View style={{ marginBottom: sp.md }}>
            <Cta label="Build My Meal Plan" wide onPress={() => setBuildOpen(true)} />
          </View>

          {/* An exclusion the engine could not honour, said before the plan
              rather than buried in it. `poolFilter` falls back to the
              UNFILTERED pool whenever the exclusions empty a required component
              list, and nothing on screen told anybody — so somebody who ticked
              Dairy got a plan with dairy in it, drawn and priced and shopped
              for. See src/lib/meals.ts.

              ABOVE the Today/This Week switch, not inside the Today arm. It was
              inside it, so switching to the week made the warning disappear
              while the meals it was about stayed — and the week is what the
              shopping list is built from. */}
          {gapNote ? (
            <View style={{ marginBottom: sp.md }}>
              <Flag tone={t.warn}>{gapNote}</Flag>
            </View>
          ) : null}
          {dislikeNote ? (
            <View style={{ marginBottom: sp.md }}>
              <Flag tone={t.warn}>{dislikeNote}</Flag>
            </View>
          ) : null}
          {/* The catalogue wraps. Said here rather than letting the same dinner
              arrive twice unannounced — see `horizonRepeats`. */}
          {horizonRepeats ? (
            <View style={{ marginBottom: sp.md }}>
              <Flag tone={t.warn}>
                Your plan has enough meals for {num(horizonRepeats)} days, so from day {num(horizonRepeats + 1)} this list starts again from the first one. Planning your own recipes, or excluding fewer ingredients, gives you more to choose from.
              </Flag>
            </View>
          ) : null}
          {/* What the read budget left out. A recipe nobody read is a row
              standing in for a meal the member chose, and a member who is not
              told that reads the stand-in as their plan. */}
          {recipesUnread ? (
            <View style={{ marginBottom: sp.md }}>
              <Flag tone={t.warn}>
                {recipesUnread === 1 ? 'One recipe' : `${num(recipesUnread)} recipes`} you planned further ahead {recipesUnread === 1 ? 'is' : 'are'} not loaded yet, so your plan’s own meal is shown on {recipesUnread === 1 ? 'that day' : 'those days'}. Choose Today or This Week to see {recipesUnread === 1 ? 'it' : 'them'}.
              </Flag>
            </View>
          ) : null}
          {/* The day as the plan composed it, every slot, with the member's
              planned recipes standing in where their dish is in hand. */}
          {view === 'today' ? todayPlan.map((m, i) => mealRow(m, i > 0, false, true)) : null}
          {view !== 'today' ? weekPlans.map((wp, d) => (
              <View key={d} style={{ marginBottom: sp.xl }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: sp.sm }}>
                  {/* The DATE, not the weekday. These rows are days ahead of
                      today now, so "Thu" on a month of rows would name four
                      different Thursdays identically and a member could not
                      tell which one they were planning. */}
                  <Text accessibilityRole="header" style={{ ...ty.caption, ...font('700'), color: t.ink }}>
                    {wp.day.offset === 0 ? `Today · ${fmtDay(wp.day.key)}` : fmtDay(wp.day.key)}
                  </Text>
                  {/* A dash, not a sum, on a day standing in for a recipe it
                      could not read. See `weekPlans`. */}
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}
                    accessibilityLabel={wp.tot.K == null ? 'Day total not known yet' : `${wp.tot.K.toLocaleString()} kcal`}>
                    {wp.tot.K == null ? '—' : wp.tot.K.toLocaleString()} kcal
                  </Text>
                </View>
                {wp.waiting ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>
                    {wp.waiting === 1 ? 'A recipe' : `${num(wp.waiting)} recipes`} planned for this day could not be read yet, so your plan’s meal is shown instead and the day has no total.
                  </Text>
                ) : null}
                {wp.plan.map((m) => {
                  // The same per-row mark the Today list carries. This arm drew
                  // slot, name and kcal and nothing else, so a dish containing
                  // the thing the member excluded was unmarked on the tab they
                  // plan and shop from. For a recipe it is Repple's own reading
                  // of the ingredient list, unmeasured ones included.
                  const inIt = isRecipeMeal(m) ? recipeAllergens(m, c.avoid) : mealAllergens(m, c.avoid);
                  return (
                  <Pressable key={m.pos} onPress={() => openMeal(m, wp.day)} accessibilityRole="button"
                    // The mark this arm was given is on the row and in the
                    // sentence. See `mealRowSpoken`.
                    accessibilityLabel={mealRowSpoken({
                      slot: m.slot, name: m.n, allergens: inIt, kcal: m.unfillable?.length ? null : String(m.K),
                    })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{m.slot}</Text>
                      <Text style={{ ...ty.body, color: t.ink, marginTop: 1 }}>{mealTitle(m.n)}</Text>
                      {inIt.length ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>Contains {inIt.map(allergenLabel).join(' and ')}</Text>
                        </View>
                      ) : null}
                    </View>
                    {/* An empty slot counts nothing toward the day, and says so. */}
                    {m.unfillable?.length ? <TonedChip tone="neutral" label="Empty" /> : <TonedChip tone="orange" label={`${num(m.K)} kcal`} />}
                  </Pressable>
                  );
                })}
              </View>
          )) : null}
        </Section>

        {/* The card that CHANGES the day: the slot's catalogue, the search over
            it, and the real recipe library. Below the day, because the day is
            read every time and a swap is made now and then. */}
        {view === 'today' ? (
        <View onLayout={(e) => {
          swapY.current = e.nativeEvent.layout.y;
          // Switching to Today from the week draws this card for the first
          // time, so the scroll waits for it to have a place.
          if (wantRecipes) { setWantRecipes(false); scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 12), animated: true }); }
        }}>
        <Section>
              <SectionHead title="Swap or Search" note={`${num(plan.length)} Meals a Day`} />
              {/* One slot at a time, the way the board lists meals. The slots
                  come from the plan itself, so a 4- or 5-meal day shows its
                  snacks as a segment rather than losing them. */}
              {/* The kit's Segmented, and `scroll` because the slots are the
                  plan's and not ours: three meals are three equal segments,
                  and a five-meal day with two snacks scrolls rather than
                  squeezing "Breakfast" to a stub. */}
              <Segmented scroll={planSlots.length > 4} style={{ marginBottom: sp.md }} value={slotSel}
                // And the recipe search closes with it: recipes for Dinner are a
                // search nobody has asked for yet, and it is not free.
                onChange={(slot) => { setSlotPick(slot); setMealQuery(''); setRecipeSearchOpen(false); }}
                options={planSlots.map((slot) => ({ key: slot, label: slot }))} />
              {/* The board's search row, searching the list under it. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, minHeight: 46, paddingHorizontal: sp.lg, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
                <Icon name="search" size={17} color={t.ink3} />
                <TextInput value={mealQuery} onChangeText={setMealQuery} placeholder={`Search ${slotSel ? slotSel.toLowerCase() : 'meals'}…`} placeholderTextColor={t.ink3}
                  accessibilityLabel={`Search ${slotSel ?? 'meals'}`} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing"
                  style={{ flex: 1, ...ty.label, color: t.ink, paddingVertical: 0 }} />
              </View>
              {/* The way into the real recipe library, and a deliberate one:
                  every search spends quota the whole customer base shares, so
                  nothing is asked until this is tapped — not on mount, not on
                  focus. Once open it says what it is doing, because the rows it
                  adds arrive UNDER the plan's own and may be below the fold.

                  'not-configured' draws nothing for a member: the library does
                  not exist yet as far as they are concerned and there is
                  nothing for them to do about it. The owner, in a dev build,
                  gets the one line that says why the rows never came. */}
              {recipeLead ? (
                !recipeSearchOpen ? (
                  <View style={{ marginTop: sp.md }}>
                    <Ghost label="Search Real Recipes" icon="search" onPress={() => setRecipeSearchOpen(true)} />
                  </View>
                ) : found?.status === 'not-configured' ? (
                  __DEV__ ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Recipe library not configured</Text> : null
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md }}>
                    <Text accessibilityLiveRegion="polite" style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                      {recipeQueryShort ? 'Type at least three letters to search real recipes.'
                        : recipes.loading ? 'Searching real recipes…'
                        : 'Real recipes are listed first, under your plan’s meal.'}
                    </Text>
                    <Pressable onPress={() => setRecipeSearchOpen(false)} accessibilityRole="button" accessibilityLabel="Hide real recipes" hitSlop={hitSlopFor(24)}>
                      <Text style={{ ...ty.label, ...font('600'), color: t.brand }}>Hide</Text>
                    </Pressable>
                  </View>
                )
              ) : null}
              {/* A planned recipe whose dish is not in hand. The generated row
                  below is standing in for it — a failed read is not an empty
                  slot, and a ref has no figures to draw — and this says which
                  recipe, and whether it is still being read or could not be. */}
              {recipesWaiting.map(({ pos, ref, from, mine }) => {
                const read = recipeReads[ref.sourceId];
                const failed = read && !read.loading && read.result && read.result.status !== 'ready' ? read.result : null;
                return (
                  <View key={`waiting-${pos}`} style={{ marginTop: sp.md }}>
                    {failed ? (
                      <>
                        <Flag tone={t.warn}>
                          {mine ? 'Your recipe' : 'Your coach’s recipe'} “{ref.title}” could not be read, so your plan’s meal is shown in its place. {failed.message}
                        </Flag>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}>
                          {/* Not for a recipe the library no longer has, nor for
                              a library that is switched off: asking again
                              spends a read on an answer that cannot change. */}
                          {failed.status === 'limited' || failed.status === 'error' ? (
                            <Ghost label="Try Again" a11yLabel={`Try reading ${ref.title} again`} onPress={read!.refresh} />
                          ) : null}
                          {/* Only for the member's own choice. A recipe their
                              COACH pinned is the coach's pick and is not taken
                              out from here, the same as a coach's meal. */}
                          {mine ? (
                            <Ghost label="Back to Plan’s Meal"
                              a11yLabel={from === 'date' ? `Take ${ref.title} off ${fmtDay(today.key)}` : `Take ${ref.title} off every ${WEEK_DAY_NAMES[today.weekday] ?? ''}`}
                              onPress={() => unplanRecipe(pos, from === 'date' ? 'date' : 'weekday')} />
                          ) : null}
                        </View>
                      </>
                    ) : (
                      <Text accessibilityLiveRegion="polite" style={{ ...ty.caption, color: t.ink3 }}>
                        Reading {mine ? 'your recipe' : 'your coach’s recipe'} “{ref.title}”… Your plan’s meal stands in until it is read.
                      </Text>
                    )}
                  </View>
                );
              })}
              {planRows.map((m, i) => mealRow(m, i > 0))}
              {/* ── real recipes, under the plan's own rows ──────────────────
                  Five outcomes and only two of them carry rows (see
                  `RecipeSearchResult`). "No recipes matched." is said ONLY of a
                  search that worked; limited and failed each get their own
                  words and the one retry there is — the hook never retries by
                  itself, because a retry against a spent quota cannot succeed
                  and one against a flaky connection pays for answers nobody
                  receives. */}
              {recipeSearchOpen && found && found.status !== 'not-configured' ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text accessibilityRole="header" style={{ ...ty.head, color: t.ink }}>Real Recipes</Text>
                  {recipeRows.map((m, i) => mealRow(m, i > 0, recipes.loading))}
                  {found.status === 'partial' ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                      {found.dropped === 1 ? '1 recipe' : `${num(found.dropped)} recipes`} could not be read and {found.dropped === 1 ? 'is' : 'are'} not listed.
                    </Text>
                  ) : null}
                  {found.status === 'ready' && !recipes.loading && !found.meals.some((m) => m.slot === slotSel) ? (
                    <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>No recipes matched.</Text>
                  ) : null}
                  {found.status === 'limited' || found.status === 'error' ? (
                    <View style={{ marginTop: sp.sm }}>
                      <Flag tone={t.warn}>{found.message}</Flag>
                      <View style={{ flexDirection: 'row', marginTop: sp.sm }}>
                        <Ghost label="Try Again" a11yLabel="Try the recipe search again" disabled={recipes.loading} onPress={recipes.refresh} />
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {ideaRows.length ? (
                <View style={{ marginTop: sp.lg }}>
                  <Text accessibilityRole="header" style={{ ...ty.head, color: t.ink }}>More Ideas</Text>
                  {ideaRows.map((m, i) => mealRow(m, i > 0))}
                </View>
              ) : null}
              {/* Wherever a recipe is drawn: the library's backlink, as a
                  link (their terms ask for it on the free plan; it is drawn on
                  every plan — see RECIPE_ATTRIBUTION), and the disclaimer their
                  terms make Repple's job, beside the figures it is about. */}
              {recipeRows.length > 0 || slotMeals.some((m) => isRecipeMeal(m)) ? (
                <View style={{ marginTop: sp.md }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{RECIPE_DISCLAIMER}</Text>
                  <Pressable onPress={() => openLink('meals.recipeAttribution', RECIPE_ATTRIBUTION.url)} accessibilityRole="link"
                    accessibilityLabel={`${RECIPE_ATTRIBUTION.text}. Opens spoonacular.com`} hitSlop={hitSlopFor(20)}
                    style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, ...font('600'), color: t.brand }}>{RECIPE_ATTRIBUTION.text}</Text>
                  </Pressable>
                </View>
              ) : null}
              {/* How far a planned recipe reaches, said once and where it is
                  true. It used to say "today's meal only", and it was accurate:
                  the week, the grocery list and the shared plan were composed
                  from catalogue indices that knew nothing about a recipe, so a
                  member who planned three of them shopped for three meals they
                  were not going to eat. All four are now one composition
                  (`withRecipes`), and a recipe is planned for a DAY — so what
                  this says is which day, and that the shopping followed it. */}
              {recipeInPlan ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  Planned for {fmtDay(today.key)}. The days ahead, the Grocery List and the shared plan are built from it. Another day keeps your plan’s own meal until you choose one there, and a recipe you planned for every {WEEK_DAY_NAMES[today.weekday] ?? 'week'} stands behind it.
                </Text>
              ) : null}
              {/* Meals per day. This drives slotsFor() — 3 gives breakfast/lunch/dinner,
                  4 adds a snack, 5 splits into two snacks — so changing it rebuilds the
                  plan and the macro split immediately. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.lg }}>
                <Text style={{ ...ty.label, color: t.ink3, marginEnd: 2 }}>Meals per Day</Text>
                {([3, 4, 5] as const).map((n) => {
                  const on = c.mealsPerDay === n;
                  return (
                    <Pressable
                      key={n}
                      // Rebuilding the day moves every slot's calories, and an
                      // open recipe search would quietly ask again for each.
                      onPress={() => { setRecipeSearchOpen(false); c.setMealsPerDay(n); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${n} meals per day`}
                      // About 28pt, and a mis-tap rebuilds the day's meals and
                      // the macro split behind them.
                      hitSlop={hitSlopFor(28)}
                      style={{ minWidth: 34, paddingHorizontal: sp.md, paddingVertical: 5, borderRadius: radius.pill, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.label, ...numeric, ...font(on ? '600' : '500'), color: on ? t.brandInk : t.ink2 }}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
        </Section>
        </View>
        ) : null}

        {/* The order below the plan is the review's: what was eaten and the
            way to add to it, then the coach's word, then why the target is
            what it is and which kind of day it is, then the extra recipes,
            and last the things set once and left — the shopping list, diet
            and exclusions, and the doors to other screens. Nothing was
            removed to get there; the blocks moved whole. */}
        {/* ── the one card: log what you actually ate ────────────────────── */}
        <Section>
          <SectionHead title="Log What You Ate" note={dayWhole ? `${fl.consumed.kcal.toLocaleString()} of ${target.kcal.toLocaleString()} kcal` : `${target.kcal.toLocaleString()} kcal Target`} />
          <Card>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <Pressable accessibilityLabel="Log a meal from a photo" accessibilityRole="button" onPress={photoLog}
                style={{ flex: 1, backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
                <Icon name="camera" size={18} color={t.brandInk} />
                <Text style={{ ...ty.caption, ...font('600'), color: t.brandInk }}>Photo</Text>
              </Pressable>
              <Pressable accessibilityLabel="Scan a barcode" accessibilityRole="button" onPress={barcodeLog}
                style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
                <Icon name="search" size={18} color={t.ink2} />
                <Text style={{ ...ty.caption, ...font('500'), color: t.ink }}>Barcode</Text>
              </Pressable>
              <Pressable accessibilityLabel="Open food log" accessibilityRole="button" onPress={() => router.push('/(client)/foodlog')}
                style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
                <Icon name="plus" size={18} color={t.ink2} />
                <Text style={{ ...ty.caption, ...font('500'), color: t.ink }}>Search</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
              <TextInput value={nl} onChangeText={setNl} placeholder='Describe it, e.g. "chicken burrito & a coke"' placeholderTextColor={t.ink3}
                accessibilityLabel="Describe what you ate"
                onSubmitEditing={describeLog} returnKeyType="done"
                style={{ ...ty.body, flex: 1, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10 }} />
              <Pressable onPress={describeLog} disabled={logBusy || !nl.trim()}
                accessibilityRole="button"
                accessibilityLabel={logBusy ? 'Reading what you typed' : 'Log what you typed'}
                accessibilityState={{ disabled: logBusy || !nl.trim(), busy: logBusy }}
                style={{ backgroundColor: nl.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
                {logBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ ...ty.label, ...font('600'), color: nl.trim() ? t.brandInk : t.ink3 }}>Log</Text>}
              </Pressable>
            </View>
          </Card>

          {/* Meals on this phone the server has not taken. They count toward
              today in the figures above and they are not lost — but they are
              not in the log a coach reads, and nothing on this tab said so:
              `unsent` was rendered on the Food Log and nowhere else, so the
              member logging a meal in a basement gym saw it appear here, in the
              day's total, with no hint that it had gone no further than the
              handset. Same sentence as the other tab, deliberately. */}
          {unsentNote(fl.unsent, 'meal') ? (
            <Flag tone={t.warn} style={{ marginTop: sp.lg }}>{unsentNote(fl.unsent, 'meal')}</Flag>
          ) : null}

          {/* Today's entries — or an honest empty state, not a zero pretending
              to be data. */}
          {fl.entries.length > 0 ? (
            <View style={{ marginTop: sp.lg }}>
              {/* Named, because the list above this card is the PLAN and this
                  one is what was eaten, and the two are rows of dishes with
                  kcal beside them. The plan's rows say "In your plan"; these
                  say so once, over the list. */}
              <Text accessibilityRole="header" style={{ ...ty.head, color: t.ink, marginBottom: sp.xs }}>Eaten Today</Text>
              {fl.entries.map((fe, i) => (
                <View key={fe.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, ...font('600'), color: t.ink, flex: 1 }} numberOfLines={2}>{fe.name}</Text>
                    <TonedChip tone="orange" label={`${num(fe.kcal)} kcal`} />
                    <Pressable onPress={() => { void removeMeal(fe.id, fe.name); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + fe.name}>
                      <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
              {/* Three states, not two. This was `loading` / `error` /
                  everything else, and 'partial' fell into "everything else" —
                  so a read that stopped at its row cap would have been drawn as
                  a day with nothing in it, which is the one sentence that sends
                  somebody to log their breakfast a second time. It takes a
                  thousand meals in one day to reach, and being right about a
                  case nobody can get to is the cheap half of the trade;
                  app/(client)/foodlog.tsx splits the same three already. */}
              {fl.status === 'loading' ? 'Reading today’s food log…'
                : fl.status === 'error' ? 'Today’s food log could not be read. This is not a day with nothing in it.'
                : fl.status === 'partial' ? 'More is logged today than can be listed in one go. This is not a day with nothing in it.'
                : 'Nothing logged today.'}
            </Text>
          )}
        </Section>


        {coachAdjust?.note ? (<>
          <Section>
            <SectionHead title="Note from Your Coach" />
            <Text style={{ ...ty.body, color: t.ink2 }}>{coachAdjust.note}</Text>
          </Section>
        </>) : null}

        {/* ── where that target came from ────────────────────────────────── */}
        {/* Folded: the paragraph is the long form of the one line under the
            macros above, and round five takes paragraphs off the page. What is
            NOT folded is the clamp — a plan slower than the member's own date
            is a fact about the figure, so it is the row's note and is read
            without opening anything. */}
        <Expandable title="Why This Target"
          note={energyPlan.kind === 'derived' && !energyPlan.onTime ? 'Slower than your date' : targetSource}>
          <Text style={{ ...ty.label, color: t.ink2 }}>{targetBasis(energyPlan, GOAL_LABEL[c.goal], wu)}</Text>
          {/* Their measured pace, from the same arithmetic the Goals screen
              uses. Absent — not zero — until their weigh-ins span enough days
              to be a trend rather than water. */}
          {observedPace != null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              {Math.abs(observedPace) < 0.05
                ? 'Your weigh-ins haven’t moved yet.'
                : `Your weigh-ins are moving at ${rateIn(observedPace, wu)} ${wu} a week ${observedPace < 0 ? 'down' : 'up'}.`}
            </Text>
          ) : null}
        </Expandable>

        {/* ── macro cycling: training vs rest day ────────────────────────── */}
        <Section>
          {/* Not <SectionHead/>: the note slot is already spoken for by
              `cycleNote`, and the kit's tappable note carries no
              accessibilityLabel of its own. The "i" is its own control so it
              can be labelled and given a touch target of its own. */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Text accessibilityRole="header" style={{ ...ty.head, color: t.ink }}>Today Is A…</Text>
              <Pressable onPress={() => setDayInfo(true)} hitSlop={12} accessibilityRole="button"
                accessibilityLabel="What training, standard and rest days mean">
                <Icon name="info" size={17} color={t.ink3} />
              </Pressable>
            </View>
            {cycleNote ? <Text style={{ ...ty.caption, color: t.ink3 }}>{cycleNote}</Text> : null}
          </View>
          {/* Three genuinely different plans, one of them chosen: the kit's
              Segmented, which wraps two to a row at large text rather than
              squeezing three labels into three fixed columns. */}
          <Segmented value={dayType} onChange={setDayType}
            options={DAY_TYPES.map(({ key, label }) => ({ key, label, a11yLabel: `${label} meal plan` }))} />
        </Section>


        {/* ── snacks ─────────────────────────────────────────────────────── */}
        {snacks.length ? (
          <>
            <Section>
              <SectionHead
                title="Snacks"
                note={planHasSnacks ? 'On Top of the Plan' : `About ${Math.round(SNACK_SHARE * 100)}% of Your Day Each`}
              />
              {snacks.map((m: PlannedMeal, i: number) => {
                // The third meal list, and the one that had neither half of the
                // mark. `snackIdeas` builds out of the FILTERED pools, which is
                // not the same as a guarantee: `poolGaps` is the case where a
                // slot has nothing left to build from and the components go
                // back in, and `mealAllergens` is what reads the dish that
                // came out. Both channels now, like the two lists above.
                const inIt = mealAllergens(m, c.avoid);
                return (
                <View key={m.pos}>
                  {i > 0 ? <Rule /> : null}
                  <Pressable onPress={() => openMeal(m, today)} accessibilityRole="button"
                    // The same sentence the other two meal lists say, so the
                    // three cannot drift apart again. See `mealRowSpoken`.
                    accessibilityLabel={mealRowSpoken({ name: m.n, allergens: inIt, kcal: num(m.K) })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.lg }}>
                    <View style={{ flex: 1 }}>
                      {(() => { const nm = mealTitleParts(m.n); return (<>
                        <Text style={{ ...ty.head, color: t.ink }}>{nm.main}</Text>
                        {nm.note ? <Text style={{ ...ty.caption, color: t.ink2 }}>({nm.note})</Text> : null}
                      </>); })()}
                      {macroLines(m.P, m.C, m.F)}
                      {inIt.length ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>Contains {inIt.map(allergenLabel).join(' and ')}</Text>
                        </View>
                      ) : null}
                    </View>
                    <TonedChip tone="orange" label={`${num(m.K)} kcal`} />
                    <Pressable onPress={() => { void logPlanned(m); }} hitSlop={10} accessibilityRole="button"
                      accessibilityLabel={`Log ${m.n}`}
                      style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus" size={16} color={t.ink2} />
                    </Pressable>
                  </Pressable>
                </View>
                );
              })}
            </Section>
          </>
        ) : null}


        {/* A row, not a second green bar: Log Meal is this screen's one
            action, and a full-width Cta at the foot of it read as a rival. */}
        <Section>
          <ListRow icon="check" tone="brand" title="Grocery List" note={`${grocCount} ${grocCount === 1 ? 'item' : 'items'} · ${rangeLabel}`} onPress={() => setShowGrocery(true)} />
        </Section>

        {/* ── how you eat, and what to leave out (collapsible) ────────────
            Diet style used to be asked twice on a first run — once in the
            post-sign-up wizard and once in the client one — and it is now asked
            in neither. It is not a question the app breaks without: macrosFor()
            only reads it to shift the fat share for keto and paleo, and
            everything else it decides is WHICH MEALS get suggested. So it is
            asked here, directly above the plan it changes, at the moment
            somebody first looks at a plan and thinks "I don't eat that".

            Allergens moved in beside it for the same reason and were already
            here. Fourteen pills is a wall on a first run and a reasonable
            control on the screen they filter.

            Below the plan now rather than above it: it is set once and then
            left, and the data-layout review puts what is set once under what
            is read every day. The row's own label still says the diet and
            how many foods are filtered, so the state is on the glass without
            opening it. */}
        <Section>
          <Pressable onPress={() => setShowAvoid((v) => !v)} accessibilityRole="button" accessibilityLabel="Toggle diet and dietary filters"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...ty.head, color: t.ink }}>Diet and Exclusions</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{DIET_LABEL[diet]}{c.avoid.length ? ' · ' + c.avoid.length + ' filtered' : ' · tap to change'}</Text>
            </View>
            <View style={{ transform: [{ rotate: turn(showAvoid ? 90 : 0) }] }}><Icon name={FORWARD_ICON} size={14} color={t.ink3} /></View>
          </Pressable>
          {showAvoid ? (
            <View style={{ marginTop: sp.lg }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Diet Style</Text>
              <View style={{ marginBottom: sp.xl }}>{dietPills}</View>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Anything to Avoid</Text>
            {avoidPills}
            {/* What their coach recorded for them, shown so nothing is kept
                out of their meals on their behalf without them seeing it. Not
                tappable: it is the coach's note, and the coach's to correct. */}
            {c.coachAvoid.length ? (
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Noted by Your Coach</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {c.coachAvoid.map((a) => (
                    <View key={a} accessible accessibilityLabel={`${ALLERGENS.find((x) => x.id === a)?.label ?? a}, noted by your coach`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: t.surface3 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                      <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>{ALLERGENS.find((x) => x.id === a)?.label ?? a}</Text>
                    </View>
                  ))}
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Your coach added these from what you told them. They are kept out of your meals along with your own. Ask your coach if one is wrong.</Text>
              </View>
            ) : null}
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xl, marginBottom: sp.sm }}>Foods You Dislike</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>Left out of your meals where there is another option. Not an allergy: if a meal can only be made with one, it stays in and we tell you.</Text>
            {dislikeEditor}
            {dislikeError ? <Flag tone={t.crit} style={{ marginTop: sp.sm }}>{dislikeError}</Flag> : null}
            </View>
          ) : null}
          {/* ── the one write on this screen that can fail in silence ────────
              Tapping a pill above calls `c.setAvoid`, which is state plus the
              debounced profile push in src/ui/clientData.tsx. That push counts
              its rows and reports the outcome through `saveFailed` — and this
              screen was the only one holding one of its controls that never
              read it. injuries, habits, profile and injury-doc all render it;
              here it was argued about in a comment and never put on the glass.

              What that costs is the worst of the set. A member taps Peanuts,
              the update is refused or matches no rows, and the pill still
              shows selected — while `c.avoid` is what `mealAllergens` filters
              this week by and what `gapNote` is computed from, so the plan
              goes on reading as though the exclusion had landed. Somebody who
              believes they have excluded an allergen and has not is the one
              silent write in this app that can put the food in front of them.

              OUTSIDE the `showAvoid` disclosure, deliberately. The pills are
              collapsed by default, and a failure hidden behind the control
              that caused it is a failure nobody sees.

              `t.crit`, not the `t.warn` habits.tsx uses: that one is about a
              step goal. */}
          {c.saveFailed ? (
            <Flag tone={t.crit} style={{ marginTop: sp.lg }}>
              Your last diet or exclusion change has not saved, so this plan may not reflect it. Do not treat a meal as safe on the strength of it. It keeps retrying.
            </Flag>
          ) : null}
        </Section>


        {/* ── quick links ────────────────────────────────────────────────── */}
        <Section>
          <QuickRow items={[
            { icon: 'meals', label: 'Food Log', onPress: () => router.push('/(client)/foodlog') },
            { icon: 'water', label: 'Recovery', onPress: () => router.push('/(client)/recovery') },
            // On the MEALS tab rather than under devices, because glucose is
            // only interesting next to what was eaten — which is the screen it
            // opens onto. Shown to everybody: it costs one row, and somebody
            // wearing a CGM should not have to know to look under wearables.
            { icon: 'heart', label: 'Blood Sugar', onPress: () => router.push('/(client)/glucose') },
            // Reported as "why is tapping macros sending you to lifting tools?".
            // The macro reference does live on that screen — it works protein
            // and fat out of this client's own recorded weight and body fat —
            // but it is the third tab of a screen called Lifting Tools, and a
            // shortcut on the MEALS tab labelled only "Macros" promised the
            // targets this screen is already showing. It now says where it
            // goes, and lands on the tab it meant rather than the 1RM
            // estimator.
            { icon: 'settings', label: 'Macro Guide', onPress: () => router.push({ pathname: '/(client)/tools', params: { tab: 'macros' } }) },
          ]} />
        </Section>

      </ScrollView>

      {/* ── recipe sheet ─────────────────────────────────────────────────── */}
      {/* One modal, two faces.
          Cook mode used to be a SECOND Modal, a sibling of this one, and both
          were visible at the same time — this one on `!!recipe`, that one on
          `cook && !!recipe`. iOS presents a modal as a native view controller
          and will not stack a second one from the same parent, so tapping
          "Cook mode" did nothing at all: the recipe sheet simply stayed put.
          Nothing threw and nothing logged, which is why it read as a dead
          button rather than as a crash.

          Switching the CONTENT of one modal is the shape that works on both
          platforms. It also fixes the Android back button, which used to
          dismiss the recipe sheet out from under cook mode. */}
      <Modal
        visible={!!recipe}
        transparent
        animationType="slide"
        onRequestClose={() => { if (cook) setCook(false); else setRecipe(null); }}
      >
        {cook && recipe && recipe.steps.length > 0 ? (

        <View style={{ flex: 1, backgroundColor: t.bg }}>
          {recipe && recipe.steps && recipe.steps.length > 0 ? (
            <View style={{ flex: 1, padding: sp.xl, paddingTop: 60, justifyContent: 'space-between' }}>
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.xl }}>
                  <Text style={{ ...ty.label, color: t.ink3, flex: 1 }}>{mealTitle(recipe.n)}</Text>
                  <Pressable onPress={() => setCook(false)} hitSlop={10}><Text style={{ ...ty.label, ...font('600'), color: t.ink2 }}>Done</Text></Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 5, marginBottom: sp.xxl }}>
                  {recipe.steps.map((_, i) => (
                    <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= cookStep ? t.brand : t.surface3 }} />
                  ))}
                </View>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Step {cookStep + 1} of {recipe.steps.length}</Text>
                <Text style={{ ...ty.title, color: t.ink }}>{recipe.steps[cookStep]}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.xl }}>
                <Pressable onPress={() => setCookStep((x) => Math.max(0, x - 1))} disabled={cookStep === 0}
                  style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center', opacity: cookStep === 0 ? 0.4 : 1 }}>
                  <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>Back</Text>
                </Pressable>
                {cookStep < recipe.steps.length - 1 ? (
                  <View style={{ flex: 2 }}><Cta label="Next Step" wide onPress={() => setCookStep((x) => x + 1)} /></View>
                ) : (
                  <View style={{ flex: 2 }}><Cta label="Finish" wide onPress={() => setCook(false)} /></View>
                )}
              </View>
            </View>
          ) : null}
        </View>
        ) : (
          <>

        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setRecipe(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        {/* TF-24, "Angles on the pop up screen": the corners are the card
            radius the rest of the approved look uses, and the sheet clips what
            scrolls inside it to them. */}
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden', maxHeight: '82%', ...elevation.e2 }}>
          {recipe && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              {/* A real recipe's photograph, where it has one. Over the slot's
                  glyph, as on the row, so a picture that is slow or will not
                  load leaves a tile rather than a hole; from memory only, as on
                  the row, because the terms do not let the bytes be kept. A
                  generated dish has no photograph and none is invented. */}
              {sheetRecipe?.image ? (
                <View style={{ height: 180, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: sp.lg }}>
                  <Text style={{ fontSize: 44 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{sheetRecipe.ico}</Text>
                  <GuardedImage source={{ uri: sheetRecipe.image }} contentFit="cover" cachePolicy="memory"
                    accessibilityLabel={`Photograph of ${sheetRecipe.n}`}
                    style={{ position: 'absolute', width: '100%', height: '100%' }} />
                </View>
              ) : null}
              <Text style={{ ...ty.micro, color: t.ink3 }}>{recipe.slot}{sheetRecipe ? ' · Recipe' : ''}</Text>
              {/* A non-breaking hyphen, so "(Pre-Workout)" wraps as a word
                  rather than leaving "(Pre-" at the end of a line (TF-24). */}
              {(() => { const nm = mealTitleParts(recipe.n); return (<>
                <Text style={{ ...ty.title, color: t.ink, marginTop: 4 }}>{nm.main.replace(/-/g, '\u2011')}</Text>
                {nm.note ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>({nm.note})</Text> : null}
              </>); })()}
              <Text style={{ ...ty.label, ...numeric, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>{num(Math.round(recipe.K * batch))} kcal · {macroWords(recipe.P * batch, recipe.C * batch, recipe.F * batch)}{batch > 1 ? '  · ' + batch + ' servings' : ''}</Text>
              {/* What the recipe says of itself. The figures above are THIS
                  slot's portion of it; "makes 4" is the recipe as written, and
                  is here so the two are not mistaken for each other. */}
              {sheetRecipe ? (
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: -sp.md, marginBottom: sp.lg }}>
                  {[
                    sheetRecipe.readyInMinutes != null ? `Ready in ${num(sheetRecipe.readyInMinutes)} min` : null,
                    `Makes ${numUpTo(sheetRecipe.recipeServings, 1)} servings as written`,
                    `Your portion is ${numUpTo(recipe.servings, 2)} of them`,
                  ].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              {/* A snack idea has no slot in the plan, so there is nothing for a
                  swap to write to — logging it is the action it has. */}
              {/* Both, for a planned meal. "Log This Meal" existed for snack
                  ideas only, so the one thing a member does most — eat what
                  the plan says and record it — was the one thing this sheet
                  could not do, and the day's plan and the day's log sat
                  unconnected on the same tab. Servings above multiply it. */}
              {recipe.pos < 0 ? (
                <Ghost label="Log This Snack" icon="plus" onPress={() => { void logPlanned(recipe, batch); setRecipe(null); }} />
              ) : (<>
                <Ghost label="Log This Meal" icon="plus" onPress={() => { void logPlanned(recipe, batch); setRecipe(null); }} />
                {/* Three cases, and the FIRST test is which kind of dish this is.
                    A recipe's `idx` is -1: it goes to `planRecipe`, which keeps
                    a ref beside the swaps, and never to `choose` or `swap`,
                    which write catalogue indices into `buildPlan`'s input.

                    A recipe already in the slot offers the way back instead.
                    A generated dish in a slot a recipe holds is "Use This
                    Meal" even when it is the plan's own — using it is what
                    takes the recipe out — and it only writes a swap when it is
                    a DIFFERENT dish from the one the plan composed, so a
                    coach's pick handed back stays the coach's pick. */}
                {/* A recipe is planned for a DAY or for a WEEKDAY, and both
                    are offered because a member means both: "Thursday the
                    25th" is one dinner, "every Thursday" is a preference.
                    Neither button writes over the other — the date is simply
                    read first — so each one says what it takes out. */}
                {sheetRecipe ? (<>
                  {planDay.key ? (
                    sheetOnDate === sheetRecipe.sourceId
                      ? <Ghost label={`Remove From ${fmtDay(planDay.key)}`} icon="swap"
                          a11yLabel={`Take ${sheetRecipe.n} off ${fmtDay(planDay.key)}`}
                          onPress={() => { unplanRecipe(recipe.pos, 'date'); setRecipe(null); }} />
                      : <Ghost label={`Plan for ${fmtDay(planDay.key)}`} icon="check"
                          a11yLabel={`Plan ${sheetRecipe.n} for ${fmtDay(planDay.key)} only`}
                          onPress={() => { planRecipe(sheetRecipe, 'date'); setRecipe(null); }} />
                  ) : null}
                  {sheetOnWeekday === sheetRecipe.sourceId
                    ? <Ghost label={`Remove From Every ${sheetWeekdayName}`} icon="swap"
                        a11yLabel={`Take ${sheetRecipe.n} off every ${sheetWeekdayName}`}
                        onPress={() => { unplanRecipe(recipe.pos, 'weekday'); setRecipe(null); }} />
                    : <Ghost label={`Every ${sheetWeekdayName}`} icon="check"
                        a11yLabel={`Plan ${sheetRecipe.n} for every ${sheetWeekdayName}`}
                        onPress={() => { planRecipe(sheetRecipe, 'weekday'); setRecipe(null); }} />}
                </>) : sheetMine ? (
                  /* A generated dish in a slot one of the member's own choices
                     holds. Using it takes out the one that is WINNING there and
                     leaves the other standing: clearing the 25th falls back to
                     every Thursday, which is what the member still said. */
                  <Ghost label="Use This Meal" icon="check" onPress={() => {
                    unplanRecipe(recipe.pos, sheetMine);
                    if (plan[recipe.pos]?.idx !== recipe.idx) choose(recipe.pos, recipe.idx);
                    setRecipe(null);
                  }} />
                ) : plan[recipe.pos]?.idx === recipe.idx
                  ? <Ghost label="Swap This Meal" icon="swap" onPress={() => { swap(recipe.pos, recipe.slot, recipe.idx); setRecipe(null); }} />
                  : <Ghost label="Use This Meal" icon="check" onPress={() => { choose(recipe.pos, recipe.idx); setRecipe(null); }} />}
              </>)}
              {/* Which of the two choices this row came from, said where the
                  buttons that clear them are. A member who cannot tell "every
                  Thursday" from "Thursday the 25th" cannot clear either one
                  with any confidence. */}
              {sheetHit ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                  {sheetHit.from === 'date'
                    ? `Planned for ${fmtDay(planDay.key)} only.`
                    : sheetHit.from === 'weekday'
                      ? `Planned for every ${sheetWeekdayName}.`
                      : `Your coach planned this for every ${sheetWeekdayName}.`}
                </Text>
              ) : null}
              {sheetAllergens.length ? (
                <View style={{ marginTop: sp.md }}>
                  {/* Two different reasons a dish contains what was excluded,
                      and each sheet gives its own. A generated dish has it
                      because the pools ran out; a recipe has it because the
                      library's filter — computed from ingredient text — let it
                      through, and Repple's own reading of the list caught it. */}
                  <Flag tone={t.crit}>
                    {sheetRecipe
                      ? `This contains ${sheetAllergens.map(allergenLabel).join(' and ')}, which you asked to avoid. The recipe library’s own filter let it through; ${appName} read the ingredient list again and found it.`
                      : `This contains ${sheetAllergens.map(allergenLabel).join(' and ')}, which you asked to avoid. There are not enough suitable components in this diet to build every meal without it.`}
                  </Flag>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg, marginBottom: sp.lg }}>
                <Text style={{ ...ty.label, color: t.ink2 }}>Servings</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.sm, paddingVertical: 4 }}>
                  {/* 30pt, eight points apart, and both write the same figure
                      into the log — so the likely mis-hit is the other one.
                      `hitSlopFor` brings each up to MIN_TARGET. */}
                  <Pressable accessibilityLabel="Fewer servings" accessibilityRole="button" hitSlop={hitSlopFor(30)} onPress={() => setBatch((b) => Math.max(1, b - 1))} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}><Icon name="minus" size={15} color={t.ink} /></Pressable>
                  <Text style={{ ...value(16), color: t.ink, minWidth: 18, textAlign: 'center' }}>{batch}</Text>
                  <Pressable accessibilityLabel="More servings" accessibilityRole="button" hitSlop={hitSlopFor(30)} onPress={() => setBatch((b) => Math.min(8, b + 1))} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={15} color={t.ink} /></Pressable>
                </View>
                {recipe.steps && recipe.steps.length > 0 ? (
                  <View style={{ flex: 1 }}><Cta label="Cook Mode" wide onPress={() => { setCookStep(0); setCook(true); }} /></View>
                ) : null}
              </View>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Ingredients</Text>
              {recipe.ing.map((ing, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                  <Text style={{ ...ty.body, color: t.ink2 }}>{ing[0]}</Text>
                  <Text style={{ ...ty.body, ...numeric, ...font('500'), color: t.ink }}>{Math.round(ing[1] * recipe.servings * batch * 100) / 100} {ing[2] || 'whole'}</Text>
                </View>
              ))}
              {/* Ingredients the recipe gives no amount for — "salt, to taste",
                  "butter, for greasing". Listed AS such rather than with a
                  nought beside them: they are still in the dish, they are still
                  read for allergens, and "0 g butter" is a figure nobody wrote. */}
              {sheetRecipe && sheetRecipe.unmeasured.length ? (
                <>
                  <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>No Amount Given</Text>
                  {sheetRecipe.unmeasured.map((name, i) => (
                    <View key={`${name}-${i}`} style={{ paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                      <Text style={{ ...ty.body, color: t.ink2 }}>{name}</Text>
                    </View>
                  ))}
                </>
              ) : null}
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xl, marginBottom: sp.md }}>Method</Text>
              {recipe.steps.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
                  <Text style={{ ...ty.label, ...numeric, ...font('600'), color: t.brand }}>{i + 1}</Text>
                  <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{s}</Text>
                </View>
              ))}
              {/* A recipe the library holds no steps for. Said, rather than a
                  heading over nothing; the publisher's page below has them. */}
              {sheetRecipe && recipe.steps.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>The library has no written method for this one.{sheetRecipe.credit?.url ? ' The publisher’s page, linked below, does.' : ''}</Text>
              ) : null}
              {sheetRecipe ? (
                <View style={{ marginTop: sp.lg, gap: sp.sm }}>
                  {/* The original publisher, by name and WITH the hyperlink —
                      Spoonacular's terms ask for the credit "in the same
                      manner" they give it. Plain text only when they named
                      somebody and gave no address to link. */}
                  {sheetRecipe.credit ? (
                    sheetRecipe.credit.url ? (
                      <Pressable onPress={() => openLink('meals.recipeCredit', sheetRecipe.credit!.url!)} accessibilityRole="link"
                        accessibilityLabel={`Recipe from ${sheetRecipe.credit.name}. Opens the publisher’s page`} hitSlop={hitSlopFor(20)}
                        style={{ alignSelf: 'flex-start' }}>
                        <Text style={{ ...ty.label, ...font('600'), color: t.brand }}>Recipe from {sheetRecipe.credit.name}</Text>
                      </Pressable>
                    ) : <Text style={{ ...ty.label, color: t.ink2 }}>Recipe from {sheetRecipe.credit.name}</Text>
                  ) : null}
                  {/* Their terms make this Repple's to say, and it would be
                      owed without them: neither the macros nor the allergen
                      marks above have seen the packet. */}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{RECIPE_DISCLAIMER}</Text>
                </View>
              ) : null}
              <View style={{ marginTop: sp.lg }}>
                <Ghost label="Close" onPress={() => setRecipe(null)} />
              </View>
            </ScrollView>
          )}
        </View>
          </>
        )}
      </Modal>

      {/* ── grocery sheet ────────────────────────────────────────────────── */}
      {/* ── Build My Plan ─────────────────────────────────────────────────
          Four choices in the order a person makes them, then the plan. Each
          takes effect as it is tapped, through the setters the rest of this
          screen uses; the button at the foot only closes the sheet onto the
          plan it has just shaped. */}
      <Modal visible={buildOpen} transparent animationType="slide" onRequestClose={() => setBuildOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setBuildOpen(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '86%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30, gap: sp.xl }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View>
              <Text accessibilityRole="header" style={{ ...ty.title, color: t.ink }}>Build My Meal Plan</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>
                Meals are made to your {num(target.kcal)} kcal target{coachAdjust ? ', as your coach set it' : ''}. Choose below; every change applies straight away.
              </Text>
            </View>
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.sm }}>1 · Meals per Day</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                {([3, 4, 5] as const).map((n) => { const on = c.mealsPerDay === n; return (
                  <Pressable key={n} onPress={() => { setRecipeSearchOpen(false); c.setMealsPerDay(n); }}
                    accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${n} meals per day`}
                    style={{ flex: 1, paddingVertical: sp.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.head, ...numeric, color: on ? t.brandInk : t.ink }}>{n}</Text>
                    <Text style={{ ...ty.caption, color: on ? t.brandInk : t.ink3 }}>{n === 3 ? 'No Snacks' : n === 4 ? 'One Snack' : 'Two Snacks'}</Text>
                  </Pressable>
                ); })}
              </View>
            </View>
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.sm }}>2 · Diet Style</Text>
              {dietPills}
            </View>
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.sm }}>3 · Anything to Avoid</Text>
              {avoidPills}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Allergens are never in your meals.</Text>
            </View>
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: 2 }}>4 · Foods You Dislike</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>Left out where there is another option. Not an allergy.</Text>
              {dislikeEditor}
              {dislikeError ? <Flag tone={t.crit} style={{ marginTop: sp.sm }}>{dislikeError}</Flag> : null}
            </View>
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.sm }}>5 · How Far Ahead</Text>
              <Segmented value={view} onChange={(v) => setView(v)}
                options={[
                  { key: 'today', label: 'Today' },
                  { key: 'week', label: 'This Week' },
                  { key: 'month', label: 'This Month' },
                ]} />
            </View>
            <Cta label={view === 'today' ? 'Show My Day' : view === 'week' ? 'Show My Week' : 'Show My Month'} wide onPress={() => setBuildOpen(false)} />
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>Then swap any meal you don’t fancy, or search real recipes, from the plan.</Text>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showGrocery} transparent animationType="slide" onRequestClose={() => setShowGrocery(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowGrocery(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '82%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.title, color: t.ink }}>Grocery List</Text>
            {/* The range, never just "this week": the list follows the
                selector now, so which days it covers is the one fact that
                changes under it. */}
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.md }}>{rangeLabel} · {DIET_LABEL[diet]} · sorted by aisle</Text>
            {/* Nobody buys thirty days of fresh food at once. Said on the sheet
                somebody actually shops from, with the way to shorten it. */}
            {days.length > 7 ? (
              <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
                This is {spanLabel} of food. Buy the fresh things a few days at a time. Choose This Week above the meals for one week’s list.
              </Flag>
            ) : null}
            {/* The list is built from the week, and the week can contain the
                thing the member excluded — `poolFilter` falls back to the
                unfiltered pool rather than leaving a slot empty. This sheet
                carried no mark of that anywhere, and it is the artefact
                somebody actually shops from. */}
            {gapNote ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{gapNote}</Flag> : null}
            {weekAllergens.length ? (
              <Flag tone={t.crit} style={{ marginBottom: sp.md }}>
                Meals in this week contain {weekAllergens.map(allergenLabel).join(' and ')}, which you asked to avoid, so this list has ingredients for them in it. Check each item before you buy.
              </Flag>
            ) : null}
            {/* A list short of a planned recipe's ingredients is a list
                somebody shops from and comes home missing a dinner. */}
            {weekUnread ? (
              <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{UNREAD_SHOPPING_WARNING}</Flag>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.xl }}>
              <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: t.surface3, overflow: 'hidden' }}>
                <View style={{ width: `${(grocCount ? Math.round((grocChecked / grocCount) * 100) : 0)}%`, height: 3, borderRadius: 2, backgroundColor: t.brand }} />
              </View>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{grocChecked}/{grocCount} in cart</Text>
            </View>
            {[...DEPTS.filter((d) => groc.byDept[d]?.length).map((d) => ({ key: d, head: `${DEPT_ICO[d]} ${d}`, note: null as string | null, items: groc.byDept[d]! })),
              ...(groc.cupboard.length ? [{ key: 'cupboard', head: `🫙 ${CUPBOARD_HEAD}`, note: CUPBOARD_NOTE as string | null, items: groc.cupboard }] : [])].map((g) => (
              <View key={g.key} style={{ marginBottom: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{g.head}</Text>
                {g.note ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.sm }}>{g.note}</Text> : null}
                {g.items.map((it, i) => { const k = g.key + '|' + it.item; const on = !!checked[k]; const need = grocNeed(it); return (
                  <Pressable key={i} onPress={() => toggleGroc(k)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    // With the quantity. A shopping list read out as bare
                    // nouns is a list you cannot shop from.
                    accessibilityLabel={`${it.item}, ${grocLine(it)}`}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, flex: 1 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: on ? 0 : 1, borderColor: t.ring, backgroundColor: on ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{on ? <Icon name="check" size={13} color={t.brandInk} /> : null}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, color: on ? t.ink3 : t.ink2, textDecorationLine: on ? 'line-through' : 'none' }}>{it.item}</Text>
                        {/* The exact amount stays visible under the pack, so
                            rounding up to a bag hides nothing. */}
                        {it.buy ? <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>Plan uses {need}</Text> : null}
                      </View>
                    </View>
                    <Text style={{ ...ty.label, ...numeric, ...font('500'), color: on ? t.ink3 : t.ink, textDecorationLine: on ? 'line-through' : 'none' }}>{it.buy ?? need}</Text>
                  </Pressable>
                ); })}
              </View>
            ))}
            {/* What a recipe asks for without an amount — "salt, to taste",
                "butter, for greasing". It is shopping and belongs on the list;
                it has no quantity, and `src/lib/recipes.ts` keeps it out of the
                measured rows rather than printing 0 g of it. No tick box: there
                is nothing to count it against, and the progress bar above
                counts things somebody can put in a trolley. */}
            {groc.unmeasured.length ? (
              <View style={{ marginBottom: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>🧂 {UNMEASURED_HEAD}</Text>
                {groc.unmeasured.map((it) => (
                  <Text key={it} style={{ ...ty.body, color: t.ink2, paddingVertical: sp.xs }}>{it}</Text>
                ))}
              </View>
            ) : null}
            {/* Wherever a recipe is shown: the disclaimer and the backlink. The
                ingredients above are a recipe's on any week that holds one. */}
            {recipeWeek ? (
              <View style={{ marginBottom: sp.lg }}>
                <Text style={{ ...ty.caption, color: t.ink3 }}>{RECIPE_DISCLAIMER}</Text>
                <Pressable onPress={() => openLink('meals.groceryAttribution', RECIPE_ATTRIBUTION.url)} accessibilityRole="link"
                  accessibilityLabel={`${RECIPE_ATTRIBUTION.text}. Opens spoonacular.com`} hitSlop={hitSlopFor(20)}
                  style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
                  <Text style={{ ...ty.caption, ...font('600'), color: t.brand }}>{RECIPE_ATTRIBUTION.text}</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
              <View style={{ flex: 1 }}><Cta label="Share List" wide onPress={shareGrocery} /></View>
              <View style={{ flex: 1 }}><Ghost label="Close" onPress={() => setShowGrocery(false)} /></View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── what the three day types mean ────────────────────────────────── */}
      {/* ── the question, asked before the camera opens ─────────────────
          Nothing has been photographed and nothing has been sent while this is
          on screen, so every way out of it is a real answer:

            Send the Photo to Be Read   take it, send it, read the meal
            No — I'll Type It Myself    take it, send nothing, type the figures
            Cancel / back               nothing at all happens

          Dismissing it is Cancel and never a quiet yes. The two answers are
          RECORDED rather than merely acted on, because a dismissal asks again
          on the next tap and that is how a question becomes a nag.

          Every sentence comes from src/lib/photoAI.ts rather than being typed
          here, so what somebody agrees to cannot drift from what is sent — and
          so this tab and the Food Log tab cannot come to say different things
          about the same photograph going to the same place. */}
      <Modal visible={askPhoto} transparent animationType="slide" onRequestClose={() => setAskPhoto(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
          accessibilityRole="button" accessibilityLabel="Do not take a meal photo at all"
          onPress={() => setAskPhoto(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: layout.gutter, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{PHOTO_ASK_KICKER.meal}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>{PHOTO_ASK_TITLE.meal}</Text>
            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>{PHOTO_DESTINATION_BY_SUBJECT.meal}</Text>
            <View style={{ marginTop: sp.lg, gap: sp.xs }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>What Is Sent</Text>
              {PHOTO_SENT_BY_SUBJECT.meal.map((line) => (
                <Text key={line} style={{ ...ty.caption, color: t.ink2 }}>&bull; {line}</Text>
              ))}
              <View style={{ height: sp.sm }} />
              <Text style={{ ...ty.micro, color: t.ink3 }}>What Is Not</Text>
              {PHOTO_NOT_SENT_BY_SUBJECT.meal.map((line) => (
                <Text key={line} style={{ ...ty.caption, color: t.ink2 }}>&bull; {line}</Text>
              ))}
            </View>
            {/* The half of the question that makes "no" an answer somebody can
                afford to give, stated before the choice and not after it. */}
            <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>{PHOTO_IF_YOU_DECLINE.meal}</Text>
            <View style={{ marginTop: sp.xl, gap: sp.sm }}>
              <Cta label={PHOTO_SEND_LABEL.meal} a11yLabel={PHOTO_SEND_A11Y.meal} wide
                onPress={() => { photoAI.answer('yes'); setAskPhoto(false); void runPhotoLog('send'); }} />
              <Ghost label={PHOTO_DECLINE_LABEL.meal} a11yLabel={PHOTO_DECLINE_A11Y.meal}
                onPress={() => { photoAI.answer('no'); setAskPhoto(false); void runPhotoLog('refused'); }} />
              <Ghost label="Cancel" a11yLabel="Do not take a meal photo at all"
                onPress={() => setAskPhoto(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── what the numbers mean: the head's info control ───────────────
          The help row's own lines, and under them the sentences round five
          took off the page — the ones that explain a card rather than qualify
          a figure. Nothing here is a withheld reason, an allergen or a sync
          state; those stayed beside the thing they are about. */}
      <Modal visible={helpOpen} transparent animationType="slide" onRequestClose={() => setHelpOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setHelpOpen(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '82%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
            <Text accessibilityRole="header" style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>{SCREEN_HELP.meals.title}</Text>
            {[
              ...SCREEN_HELP.meals.lines,
              { term: 'Logging', means: 'anything you eat off-plan counts toward your day once you add it: by photo, barcode, search or a typed description.' },
              { term: 'Snacks', means: planHasSnacks
                ? 'your plan already builds snacks into the day. The ideas further down are extras, and count only when you log one.'
                : 'ideas only. Nothing changes your targets until you log one.' },
              { term: 'Real Recipes', means: 'searched only when you ask, portioned to the slot, and re-checked against what you avoid.' },
            ].map((l) => (
              // One text node, as the help row draws it: the term and its
              // explanation are one sentence and wrap as one.
              <Text key={l.term} style={{ ...ty.label, color: t.ink2, marginBottom: sp.md }}>
                <Text style={{ ...font('700'), color: t.ink }}>{l.term}</Text>{': '}{l.means}
              </Text>
            ))}
            <Ghost label="Close" onPress={() => setHelpOpen(false)} />
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={dayInfo} transparent animationType="slide" onRequestClose={() => setDayInfo(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setDayInfo(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '82%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
            <Text style={{ ...ty.title, color: t.ink }}>Training, Standard, Rest</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>The day you pick sets the calorie and carb targets the whole plan is built to.</Text>
            {DAY_TYPES.map((d, i) => {
              // The figures are asked of the same engine the screen runs on
              // rather than written into the copy. The ±250 kcal reaches carbs
              // only because applyCoachAdjust holds protein and fat where they
              // are and re-derives carbs from the new calorie total — and a
              // coach who has set an explicit carb delta breaks that chain, at
              // which point a hardcoded "+62 g" would be a number this client's
              // plan never uses.
              const m = applyCoachAdjust(macrosFor(input), adjustFor(d.key));
              return (
                <View key={d.key} style={{ marginBottom: sp.md }}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md, marginTop: i > 0 ? sp.md : 0 }}>
                    <Text style={{ ...ty.body, ...font('600'), color: t.ink }}>{d.label}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{m.kcal.toLocaleString()} kcal · {m.carbs} g carbs</Text>
                  </View>
                  <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{d.blurb}</Text>
                </View>
              );
            })}
            <Text style={{ ...ty.caption, color: t.ink3 }}>Protein and fat targets are the same on all three days.</Text>
            <View style={{ marginTop: sp.lg }}>
              <Ghost label="Close" onPress={() => setDayInfo(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* The sheet itself lives in src/ui/BarcodeSheet — the Food Log needs the
          same one, and a second copy is how the two calorie sums on these very
          screens came to disagree. */}
      {/* A scanned product carries the basis its figures are for — "100 g",
          "1 serving" — and the sheet is where that question is asked. This
          logged one of whatever the basis was, so a member who ate a whole
          500 g pot recorded 100 g of it. */}
      <BarcodeSheet visible={bcOpen} onClose={() => setBcOpen(false)}
        onLogged={(f) => {
          setPendingVia('barcode'); setPendingPhoto(null); setPendingTitle(undefined); setPendingNote(null);
          setPending({ name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, basis: f.basis });
        }} />

      {/* ── the one review sheet ───────────────────────────────────────── */}
      <LogFoodSheet
        food={pending}
        photoUri={pendingPhoto}
        title={pendingTitle}
        note={pendingNote}
        onClose={() => {
          // The next described food that could not be read whole, if there is
          // one. Closing the sheet on a queue would silently drop the rest of
          // what somebody typed — see `queue` above.
          const [next, ...rest] = queue;
          setPending(next ?? null);
          setQueue(rest);
          if (!next) { setPendingPhoto(null); setPendingNote(null); setPendingTitle(undefined); }
        }}
        onLog={async (f) => {
          // The same three outcomes, said the same way. A row the server
          // refuses is not on the record, and the sheet closing is not an
          // answer.
          const out = await fl.logFood({ name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, via: pendingVia });
          if (out === 'refused') { Alert.alert('Not Logged', `${f.name} could not be saved, so it is not on today's record.`); return false; }
          notifySuccess();
          if (out === 'unsent') Alert.alert('Logged, Waiting to Send', `${f.name} is counted toward today and kept on this phone until you have signal.`);
          return true;
        }} />
    </SafeAreaView>
  );
}
