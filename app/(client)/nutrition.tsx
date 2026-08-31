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
import { useState, useEffect, useMemo } from 'react';
import { num } from '../../src/lib/format';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { buildPlan, snackIdeas, SNACK_SHARE, swapIndex, groceryData, DEPTS, DEPT_ICO, ALLERGENS, type PlannedMeal } from '../../src/lib/meals';
import { mealPlanDoc, shareDoc } from '../../src/lib/exportShare';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Diet, Goal } from '../../src/lib/types';
import { useClientData } from '../../src/ui/clientData';
import { useWearables } from '../../src/ui/wearables';
import { caloriesLeft, caloriesNote, dayBurn, macrosFor, applyCoachAdjust, maintenanceFor } from '../../src/lib/nutrition';
import { energyPlanFor, observedRateKg, MAX_DEFICIT_FRACTION_OF_TDEE, type EnergyPlan } from '../../src/lib/goalEnergy';
import { useGoalTracker } from '../../src/ui/goalTracker';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { Icon } from '../../src/ui/Icon';
import { useRouter } from 'expo-router';
import { useBrand } from '../../src/ui/brand';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { analyzeMeal, visionAvailable } from '../../src/lib/vision';
import { parseFoodText, foodAIAvailable } from '../../src/lib/foodAI';
import { BarcodeSheet } from '../../src/ui/BarcodeSheet';
import { useFoodLog } from '../../src/ui/foodLog';
import { notifySuccess } from '../../src/ui/haptics';
import { Rule, Section, SectionHead, Hero, Card, Cta, Ghost, Meter, QuickRow } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';

const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const DIET_LABEL: Record<Diet, string> = { meat: 'Meat', vegetarian: 'Veggie', vegan: 'Vegan', paleo: 'Paleo', keto: 'Keto' };
const GOALS: Goal[] = ['fatloss', 'tone', 'muscle'];
const GOAL_LABEL: Record<Goal, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };

// The three day types, each with the definition shown in the info sheet. A
// tester asked for these ("need a brief definition in each tab for Training
// day, Standard day, Rest day") because the buttons only tell you what a day
// does after you have already picked it.
//
// Deliberately worded as "the day" and not "today": the same three definitions
// have to keep reading correctly when day types can be planned a week ahead,
// which is the direction this is going.
const DAY_TYPES = [
  { key: 'training', label: 'Training Day', blurb: 'A day you train — a gym session or a hard effort. Fuel goes up so there is something to train on.' },
  { key: 'off', label: 'Standard', blurb: 'A normal day with no session: work, walking, ordinary movement. This is the baseline target.' },
  { key: 'rest', label: 'Rest Day', blurb: 'A full day off training. Fuel comes down, because there is no session to feed.' },
] as const;

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
const kgRate = (n: number) => Math.abs(n).toFixed(2).replace(/0$/, '').replace(/\.$/, '');
const onDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * One sentence saying what set today's calorie target. Never a figure the plan
 * did not actually produce — which is why the calorie number quoted here is
 * the plan's own baseline and not the target shown above it. Those two differ
 * by the day type and any coach adjustment, each of which is already announced
 * in its own right further down the screen; attributing their ±250 to the
 * client's goal rate would make this sentence's arithmetic not add up.
 */
function targetBasis(plan: EnergyPlan, goalLabel: string): string {
  if (plan.kind === 'enum') {
    switch (plan.reason) {
      case 'no-goal':
        return `Based on your general goal (${goalLabel}). Set a target weight and a date under Goals and this is built from those instead — a date is what turns a target into a daily number.`;
      case 'not-weight':
        return `Based on your general goal (${goalLabel}). Your goals aren’t about bodyweight, and calories can’t be worked back from those honestly — add a target weight under Goals to drive this.`;
      case 'no-target-date':
        return `You’ve set a target weight, but no date. Two people losing the same 6 kg — one by spring, one by next year — don’t eat the same, so this stays on your general goal (${goalLabel}) until there’s a date under Goals.`;
      case 'no-readings':
        return `You’ve set a target weight, but there’s no weigh-in to measure from yet. Add one and this is built from your goal; for now it’s your general goal (${goalLabel}).`;
      case 'date-passed':
        return `Your goal’s date has gone by, so there’s no time left to spread the remaining kilos over. Set a new date under Goals. Until then this is your general goal (${goalLabel}).`;
      case 'date-too-soon':
        return `Your goal’s date is less than a week away — too soon to tell you whether a plan is working before it arrives. This is your general goal (${goalLabel}) instead.`;
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
    : `${kgRate(plan.plannedRateKg)} kg a week`;
  if (plan.onTime) {
    return `Built from your goal: ${plan.targetKg} kg by ${onDate(plan.targetDateMs)}. From ${plan.currentKg} kg that’s ${pace}, which sets your baseline at ${plan.kcal.toLocaleString()} kcal a day.`;
  }
  const why = plan.limitedBy === 'floor'
    ? `going faster would mean eating more than ${Math.round(MAX_DEFICIT_FRACTION_OF_TDEE * 100)}% below what your body uses in a day`
    : 'that’s faster than this app will plan for';
  // Where the plan has no pace at all there is no finish date, and printing
  // the date they asked for — the one this plan does NOT meet — would be
  // inventing the very number the sentence exists to correct.
  const tail = plan.etaMs != null
    ? ` and gets you there around ${onDate(plan.etaMs)}, later than the ${onDate(plan.targetDateMs)} you set.`
    : `, which does not reach ${plan.targetKg} kg by ${onDate(plan.targetDateMs)}. There is no pace here to put a finish date on, so that stays a dash.`;
  return `Your date needs ${kgRate(plan.requiredRateKg)} kg a week, and ${why}. This plan is built on ${pace} instead${tail} Move the date or the target under Goals if you want them to meet.`;
}

export default function Nutrition() {
  const t = useTheme();
  const c = useClientData();
  const router = useRouter();
  const { appName } = useBrand();
  const _adj = useCoachNutrition().get(c.id);
  const coachAdjust = c.coachingMode === 'solo' ? null : _adj;
  const goals = useGoalTracker().goals;
  // A meal plan is scaled to lean body mass. Without a weight and body fat there
  // is nothing to scale, and the whole screen used to run on a 70 kg / 20%
  // placeholder and present the result as the client's plan. Zeros here are
  // never rendered — `hasBody` swaps the screen for a prompt below.
  //
  // Which is only true once the profile has actually been READ. While it is
  // loading, weightKg is null for the same reason it is null for somebody who
  // has never been scanned, and the screen was telling a client with five
  // scans behind them that they had no measurements and should go and add
  // some. Not knowing yet is not the same answer as none.
  const bodyKnown = c.status === 'ready' || c.status === 'partial';
  const hasBody = c.weightKg != null && c.bodyFatPct != null;
  const w = c.weightKg ?? 0;
  const bf = c.bodyFatPct ?? 0;
  const diet = c.diet;
  const [override, setOverride] = useState<Record<number, number>>({});
  const [ovHydrated, setOvHydrated] = useState(false);
  const [recipe, setRecipe] = useState<PlannedMeal | null>(null);

  /** Put a snack idea in today's log. Nothing else counts it — the section is
   *  a menu, and reading a menu is not eating. */
  const logSnack = (m: PlannedMeal, servings = 1) => {
    void fl.addFood({
      name: m.n,
      kcal: Math.round(m.K * servings),
      protein: Math.round(m.P * servings),
      carbs: Math.round(m.C * servings),
      fat: Math.round(m.F * servings),
      via: 'manual',
    });
  };
  const [showGrocery, setShowGrocery] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => { AsyncStorage.getItem('repple.grocery.checked').then((r) => { if (r) { try { setChecked(JSON.parse(r)); } catch { /* ignore */ } } }); }, []);
  // Persist the client's meal swaps so they survive leaving the tab / relaunch.
  useEffect(() => { AsyncStorage.getItem('repple.mealOverride').then((r) => { if (r) { try { setOverride(JSON.parse(r)); } catch { /* ignore */ } } setOvHydrated(true); }); }, []);
  useEffect(() => { if (!ovHydrated) return; AsyncStorage.setItem('repple.mealOverride', JSON.stringify(override)).catch(() => {}); }, [override, ovHydrated]);
  const [view, setView] = useState<'today' | 'week'>('today');
  const [showAvoid, setShowAvoid] = useState(false);
  const [dayType, setDayType] = useState<'training' | 'rest' | 'off'>('off');
  const [dayInfo, setDayInfo] = useState(false);
  const [batch, setBatch] = useState(1);
  const [cook, setCook] = useState(false);
  const [cookStep, setCookStep] = useState(0);
  const fl = useFoodLog();
  useEffect(() => { setBatch(1); setCook(false); setCookStep(0); }, [recipe]);
  const [nl, setNl] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [bcOpen, setBcOpen] = useState(false);
  const photoLog = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera needed', 'Allow camera to log a meal by photo.'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    const asset = res.assets[0];
    setLogBusy(true); let done = false;
    let nb = asset.base64; try { const mm = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: 1512 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (mm.base64) nb = mm.base64; } catch {}
    if (visionAvailable() && nb) { const r = await analyzeMeal(nb, 'image/jpeg'); if (r) { fl.addFood({ name: r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, via: 'photo' }); notifySuccess(); Alert.alert('Logged', r.name + ' · ' + r.kcal + ' kcal added to today.'); done = true; } }
    setLogBusy(false);
    // Nothing is logged when the photo cannot be read. Guessing macros here is
    // worse than logging nothing — the client would be planning around a number
    // the app invented.
    if (!done) { Alert.alert('Could not read that photo', visionAvailable() ? 'Nothing was logged. Describe it below, or add it from the Food Log.' : 'Photo logging turns on with the AI backend. Describe it below, or add it from the Food Log.'); }
  };
  const barcodeLog = () => setBcOpen(true);
  const describeLog = async () => {
    const text = nl.trim(); if (!text) return;
    setLogBusy(true); const items = await parseFoodText(text); setLogBusy(false);
    if (items && items.length) { items.forEach((it) => fl.addFood({ name: it.name, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, via: 'manual' })); setNl(''); notifySuccess(); }
    else { Alert.alert('Could not read that', foodAIAvailable() ? 'Try e.g. \"2 eggs, toast and a coffee\".' : 'AI logging turns on with the AI backend.'); }
  };

  // Taken by day rather than read off `dayType`, so the info sheet can ask what
  // the other two days would come to without the client having to tap each one
  // to find out.
  const CYCLE_KCAL = 250;
  const adjustFor = (d: typeof dayType) => {
    const cycleDelta = d === 'training' ? CYCLE_KCAL : d === 'rest' ? -CYCLE_KCAL : 0;
    return (coachAdjust || cycleDelta)
      ? { kcalDelta: (coachAdjust?.kcalDelta || 0) + cycleDelta, proteinDelta: coachAdjust?.proteinDelta, carbDelta: coachAdjust?.carbDelta, fatDelta: coachAdjust?.fatDelta }
      : undefined;
  };
  const cyclingAdjust = adjustFor(dayType);

  // TF-29. The calorie target is worked back from the client's own target
  // weight and date where they have set one, and falls back to the goal enum —
  // unchanged, and named on screen — where they have not. `energyPlan` rides
  // on the input object rather than being applied here because `buildPlan`
  // hands its input straight to `macrosFor`: doing it any other way would have
  // scaled the meals below to one calorie figure while the target above them
  // showed another, which is the bug at the foot of src/lib/nutrition.ts.
  const openWeightGoal = goals.find((g) => g.kind === 'weight' && !g.achievedAtISO) ?? null;
  const energyPlan = energyPlanFor({
    goal: openWeightGoal,
    weightSeries: c.weightSeries,
    tdeeKcal: maintenanceFor({ weightKg: w, bodyFatPct: bf, activity: c.activity }).tdee,
    nowMs: Date.now(),
  });
  const observedPace = observedRateKg(energyPlan);

  const input = { id: c.id, weightKg: w, bodyFatPct: bf, activity: c.activity, goal: c.goal, diet, mealsPerDay: c.mealsPerDay, mealOverride: { ...(coachAdjust?.mealOverride ?? {}), ...override }, coachAdjust: cyclingAdjust, avoid: c.avoid, energyPlan };
  const { plan, target, tot } = buildPlan(input);
  // Snacks are ideas, not plan slots: they do not move the targets or the
  // macro split above, because a snack nobody has eaten yet is not a
  // commitment. Logging one is what counts it, like any other food.
  const snacks = useMemo(() => snackIdeas(input, 3), [input]);
  const planHasSnacks = plan.some((m) => m.slot === 'Snack');
  const coachPick = (pos: number) => !!(coachAdjust?.mealOverride && coachAdjust.mealOverride[pos] != null && override[pos] == null);
  const swap = (pos: number, slot: PlannedMeal['slot'], idx: number) => setOverride({ ...override, [pos]: swapIndex(diet, slot, idx) });
  const groc = groceryData(input);
  const grocCount = DEPTS.reduce((a, d) => a + (groc.byDept[d]?.length ?? 0), 0);
  const grocKeys = DEPTS.flatMap((d) => (groc.byDept[d] || []).map((it) => d + '|' + it.item));
  const grocChecked = grocKeys.filter((k) => checked[k]).length;
  const toggleGroc = (k: string) => setChecked((prev) => { const n = { ...prev, [k]: !prev[k] }; AsyncStorage.setItem('repple.grocery.checked', JSON.stringify(n)); return n; });
  const shareGrocery = async () => {
    const lines: string[] = ['Grocery List', ''];
    let html = '<h2>Grocery List</h2>';
    DEPTS.filter((d) => groc.byDept[d]?.length).forEach((d) => {
      lines.push(d.toUpperCase());
      html += '<h3>' + d + '</h3><ul>';
      groc.byDept[d]!.forEach((it) => { const q = it.qty + (it.unit ? ' ' + it.unit : ''); lines.push('- ' + it.item + ' — ' + q); html += '<li>' + it.item + ' — ' + q + '</li>'; });
      html += '</ul>'; lines.push('');
    });
    await shareDoc(html, lines.join('\n'), 'Grocery List');
  };
  const WEEKD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const sharePlan = async () => {
    const rows = plan.map((m) => ({ slot: m.slot, name: m.n, K: m.K, P: m.P, C: m.C, F: m.F }));
    const labels = c.avoid.map((a) => (ALLERGENS.find((x) => x.id === a)?.label ?? a));
    const { html, text } = mealPlanDoc(c.name, target.kcal, rows, labels, appName, t.brand);
    await shareDoc(html, text, 'Meal plan');
  };
  const weekPlans = view === 'week' ? WEEKD.map((_, d) => { const ov: Record<number, number> = {}; plan.forEach((m) => { ov[m.pos] = m.idx + d; }); return buildPlan({ ...input, mealOverride: ov }); }) : [];

  const G = layout.gutter;
  const eaten = fl.consumed;
  // One sum, shared with the Food Log, so the two cannot drift apart again.
  // The budget argument is what stops a day's movement being counted twice:
  // this target is bmr * activity, so the multiplier has already paid for an
  // ordinary day and only the excess over it is new food. See caloriesLeft().
  // dayBurn picks the figure the connected device actually publishes and the
  // budget it may be compared against — active against the movement the
  // activity multiplier bought, whole-day against the whole TDEE. Null when no
  // device has reported, which shows no burn rather than a zero.
  const burn = dayBurn(target, useWearables().today);
  const cal = caloriesLeft(target.kcal, eaten.kcal, burn?.burned ?? 0, burn?.budgeted ?? 0, burn?.kind);
  const cycleNote = dayType === 'training' ? `+${CYCLE_KCAL} kcal, more carbs` : dayType === 'rest' ? `−${CYCLE_KCAL} kcal, fewer carbs` : undefined;

  if (!hasBody) {
    const looking = !bodyKnown;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Nutrition</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Meals</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{looking
                ? 'Reading your latest measurements…'
                : c.status === 'error'
                  ? 'Your measurements could not be read just now, so the targets below them cannot be worked out. This is a connection problem, not a missing scan.'
                  : 'Your targets and meal plan are scaled to your body, so they need a weight and body fat to work from.'}</Text>
            </View>
            <Ghost icon="back" onPress={() => router.back()} />
          </View>
          <Rule />
          <Section>
            {/* No button on the error path. "Add Your Measurements" is the
                wrong thing to offer somebody whose measurements exist and
                could not be fetched — it invites them to type in a duplicate
                of a scan they already have. */}
            {looking ? <ActivityIndicator color={t.brand} />
              : c.status === 'error' ? null
              : <Cta label="Add Your Measurements" wide onPress={() => router.push('/(client)/scans')} />}
          </Section>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Nutrition</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Meals</Text>
          </View>
          <Pressable onPress={sharePlan} accessibilityRole="button" accessibilityLabel="Share plan"
            style={{ width: 38, height: 38, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
            <Icon name="share" size={17} color={t.ink2} />
          </Pressable>
        </View>

        {/* A coach-adjusted plan is marked, not shouted: a coloured dot beside
            ink-coloured text. */}
        {coachAdjust ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
            <Text style={{ ...ty.micro, color: t.ink3 }}>Coach-adjusted</Text>
          </View>
        ) : null}

        {/* ── the hero: what is left to eat today ────────────────────────── */}
        <Hero
          label={cal.net >= 0 ? 'Calories Left' : 'Calories Over'}
          figure={Math.abs(cal.net).toLocaleString()}
          unit="kcal"
          note={caloriesNote(cal)}
          // undefined, not 0: an empty ring drawn for a target we do not have
          // is a figure invented to fill a slot.
          arc={target.kcal ? eaten.kcal / target.kcal : undefined}
          arcLabel="of today's calories eaten"
          onPress={() => router.push('/(client)/foodlog')}
        />

        <Rule />

        {/* ── where that target came from ────────────────────────────────── */}
        <Section>
          <SectionHead
            title="Why This Target"
            note={energyPlan.kind === 'derived' && !energyPlan.onTime ? 'Slower than your date' : undefined}
          />
          <Text style={{ ...ty.label, color: t.ink2 }}>{targetBasis(energyPlan, GOAL_LABEL[c.goal])}</Text>
          {/* Their measured pace, from the same arithmetic the Goals screen
              uses. Absent — not zero — until their weigh-ins span enough days
              to be a trend rather than water. */}
          {observedPace != null ? (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              {Math.abs(observedPace) < 0.05
                ? 'Your weigh-ins haven’t moved yet.'
                : `Your weigh-ins are moving at ${kgRate(observedPace)} kg a week ${observedPace < 0 ? 'down' : 'up'}.`}
            </Text>
          ) : null}
        </Section>

        <Rule />

        {/* ── the plan's macro split against target ──────────────────────── */}
        <Section>
          {/* These meters showed the PLAN — tot.P/C/F, the totals of the meals
              suggested below — while sitting directly under a hero that reads
              "0 of 2,040 kcal eaten". Three filled bars beneath that sentence
              say, in the only visual language this screen has for progress,
              that you have eaten 89g of protein. You have not. A tester read it
              exactly that way and said so: "I didn't log any meals today."

              A meter toward a target means intake here, because that is what
              the figure above it means. The plan's own total keeps its place in
              the note, where it is named. */}
          <SectionHead title="Macros Eaten" note={`${tot.K.toLocaleString()} kcal planned below`} />
          <Meter label="Protein" val={eaten.protein} target={target.protein} />
          <Meter label="Carbs" val={eaten.carbs} target={target.carbs} dim />
          <Meter label="Fat" val={eaten.fat} target={target.fat} dim />
        </Section>

        <Rule />

        {/* ── macro cycling: training vs rest day ────────────────────────── */}
        <Section>
          {/* Not <SectionHead/>: the note slot is already spoken for by
              `cycleNote`, and the kit's tappable note carries no
              accessibilityLabel of its own. The "i" is its own control so it
              can be labelled and given a touch target of its own. */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Today is a…</Text>
              <Pressable onPress={() => setDayInfo(true)} hitSlop={12} accessibilityRole="button"
                accessibilityLabel="What training, standard and rest days mean">
                <Icon name="info" size={17} color={t.ink3} />
              </Pressable>
            </View>
            {cycleNote ? <Text style={{ ...ty.caption, color: t.ink3 }}>{cycleNote}</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {DAY_TYPES.map(({ key, label }) => {
              const on = dayType === key;
              return (
                <Pressable key={key} onPress={() => setDayType(key)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Rule />

        {/* ── the one card: log what you actually ate ────────────────────── */}
        <Section>
          <SectionHead title="Log What You Ate" note={`${fl.consumed.kcal.toLocaleString()} of ${target.kcal.toLocaleString()} kcal`} />
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>Eating something off-plan? Add it and it counts toward your day.</Text>
          <Card>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <Pressable accessibilityLabel="Log a meal from a photo" accessibilityRole="button" onPress={photoLog}
                style={{ flex: 1, backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
                <Icon name="camera" size={18} color={t.brandInk} />
                <Text style={{ ...ty.caption, fontWeight: '600', color: t.brandInk }}>Photo</Text>
              </Pressable>
              <Pressable accessibilityLabel="Scan a barcode" accessibilityRole="button" onPress={barcodeLog}
                style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
                <Icon name="search" size={18} color={t.ink2} />
                <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>Barcode</Text>
              </Pressable>
              <Pressable accessibilityLabel="Open food log" accessibilityRole="button" onPress={() => router.push('/(client)/foodlog')}
                style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', gap: 5 }}>
                <Icon name="plus" size={18} color={t.ink2} />
                <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>Search</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
              <TextInput value={nl} onChangeText={setNl} placeholder='Describe it — "chicken burrito & a coke"' placeholderTextColor={t.ink3}
                onSubmitEditing={describeLog} returnKeyType="done"
                style={{ ...ty.body, flex: 1, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10 }} />
              <Pressable onPress={describeLog} disabled={logBusy || !nl.trim()}
                style={{ backgroundColor: nl.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
                {logBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ ...ty.label, fontWeight: '600', color: nl.trim() ? t.brandInk : t.ink3 }}>Log</Text>}
              </Pressable>
            </View>
          </Card>

          {/* Today's entries — or an honest empty state, not a zero pretending
              to be data. */}
          {fl.entries.length > 0 ? (
            <View style={{ marginTop: sp.lg }}>
              {fl.entries.map((fe, i) => (
                <View key={fe.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <Text style={{ ...ty.body, color: t.ink2, flex: 1 }} numberOfLines={1}>{fe.name}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{num(fe.kcal)} kcal</Text>
                    <Pressable onPress={() => fl.removeFood(fe.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Remove ' + fe.name}>
                      <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>Nothing logged today.</Text>
          )}
        </Section>

        <Rule />

        {/* ── allergen / intolerance filter (collapsible) ────────────────── */}
        <Section>
          <Pressable onPress={() => setShowAvoid((v) => !v)} accessibilityRole="button" accessibilityLabel="Toggle dietary filters"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Avoiding{c.avoid.length ? ' · ' + c.avoid.length + ' filtered' : ' · tap to set'}</Text>
            <View style={{ transform: [{ rotate: showAvoid ? '90deg' : '0deg' }] }}><Icon name="chevron" size={14} color={t.ink3} /></View>
          </Pressable>
          {showAvoid ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.lg }}>
              {ALLERGENS.map((al) => { const on = c.avoid.includes(al.id); return (
                <Pressable key={al.id} onPress={() => c.setAvoid(on ? c.avoid.filter((x) => x !== al.id) : [...c.avoid, al.id])}
                  accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.surface3 : t.surface2 }}>
                  {on ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
                  <Text style={{ ...ty.label, fontWeight: on ? '500' : '400', color: on ? t.ink : t.ink2 }}>{al.label}</Text>
                </Pressable>
              ); })}
            </View>
          ) : null}
        </Section>

        <Rule />

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

        {coachAdjust?.note ? (<>
          <Rule />
          <Section>
            <SectionHead title="Note From Your Coach" />
            <Text style={{ ...ty.body, color: t.ink2 }}>{coachAdjust.note}</Text>
          </Section>
        </>) : null}

        <Rule />

        {/* ── the plan: today or the week ────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: layout.section }}>
            {(['today', 'week'] as const).map((v) => {
              const on = view === v;
              return (
                <Pressable key={v} onPress={() => setView(v)} accessibilityRole="button" accessibilityState={{ selected: on }}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{v === 'today' ? 'Today' : 'This week'}</Text>
                </Pressable>
              );
            })}
          </View>

          {view === 'today' ? (
            <>
              <SectionHead title={`Today's plan · ${plan.length} meals`} note={`${tot.K.toLocaleString()} kcal`} />
              {/* Meals per day. This drives slotsFor() — 3 gives breakfast/lunch/dinner,
                  4 adds a snack, 5 splits into two snacks — so changing it rebuilds the
                  plan and the macro split immediately. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.sm }}>
                <Text style={{ ...ty.label, color: t.ink3, marginRight: 2 }}>Meals per day</Text>
                {([3, 4, 5] as const).map((n) => {
                  const on = c.mealsPerDay === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => c.setMealsPerDay(n)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${n} meals per day`}
                      style={{ minWidth: 34, paddingHorizontal: sp.md, paddingVertical: 5, borderRadius: radius.pill, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.label, ...numeric, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {plan.map((m, i) => (
                <View key={m.pos}>
                  {i > 0 ? <Rule /> : null}
                  <Pressable onPress={() => setRecipe(m)} accessibilityRole="button" accessibilityLabel={m.n}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.lg }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>{m.slot}{coachPick(m.pos) ? " · Coach's pick" : ''}</Text>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 4 }} numberOfLines={2}>{m.n}</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 3 }}>P{m.P} · C{m.C} · F{m.F}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ ...value(20), color: t.ink }}>{m.K}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>kcal</Text>
                    </View>
                    <Icon name="chevron" size={16} color={t.ink3} />
                  </Pressable>
                </View>
              ))}
            </>
          ) : (
            weekPlans.map((wp, d) => (
              <View key={d} style={{ marginBottom: sp.xl }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: sp.sm }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>{WEEKD[d]}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{wp.tot.K.toLocaleString()} kcal</Text>
                </View>
                {wp.plan.map((m) => (
                  <Pressable key={m.pos} onPress={() => setRecipe(m)} accessibilityRole="button" accessibilityLabel={m.n}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>{m.slot}</Text>
                      <Text style={{ ...ty.body, color: t.ink, marginTop: 1 }} numberOfLines={1}>{m.n}</Text>
                    </View>
                    <Text style={{ ...value(15), color: t.ink2 }}>{m.K}</Text>
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </Section>

        <Rule />

        {/* ── snacks ─────────────────────────────────────────────────────── */}
        {snacks.length ? (
          <>
            <Section>
              <SectionHead
                title="Snacks"
                note={planHasSnacks ? 'On top of the plan' : `About ${Math.round(SNACK_SHARE * 100)}% of your day each`}
              />
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                {planHasSnacks
                  ? 'Your plan already builds snacks into the day. These are extras — log one and it counts toward today.'
                  : 'Log one and it counts toward today. Nothing here changes your targets until you do.'}
              </Text>
              {snacks.map((m: PlannedMeal, i: number) => (
                <View key={m.pos}>
                  {i > 0 ? <Rule /> : null}
                  <Pressable onPress={() => setRecipe(m)} accessibilityRole="button" accessibilityLabel={m.n}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.lg }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={2}>{m.n}</Text>
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 3 }}>P{m.P} · C{m.C} · F{m.F}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ ...value(20), color: t.ink }}>{num(m.K)}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3 }}>kcal</Text>
                    </View>
                    <Pressable onPress={() => logSnack(m)} hitSlop={10} accessibilityRole="button"
                      accessibilityLabel={`Log ${m.n}`}
                      style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus" size={16} color={t.ink2} />
                    </Pressable>
                  </Pressable>
                </View>
              ))}
            </Section>

            <Rule />
          </>
        ) : null}

        <Section>
          <Cta label={`Grocery List · ${grocCount} items`} wide onPress={() => setShowGrocery(true)} />
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
                  <Text style={{ ...ty.label, color: t.ink3, textTransform: 'capitalize', flex: 1 }} numberOfLines={1}>{recipe.n}</Text>
                  <Pressable onPress={() => setCook(false)} hitSlop={10}><Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Done</Text></Pressable>
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
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Back</Text>
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

        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setRecipe(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '82%', ...elevation.e2 }}>
          {recipe && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{recipe.slot}</Text>
              <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize', marginTop: 4 }}>{recipe.n}</Text>
              <Text style={{ ...ty.label, ...numeric, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>{Math.round(recipe.K * batch)} kcal · P{Math.round(recipe.P * batch)} / C{Math.round(recipe.C * batch)} / F{Math.round(recipe.F * batch)}{batch > 1 ? '  · ' + batch + ' servings' : ''}</Text>
              {/* A snack idea has no slot in the plan, so there is nothing for a
                  swap to write to — logging it is the action it has. */}
              {recipe.pos < 0
                ? <Ghost label="Log This Snack" icon="plus" onPress={() => { logSnack(recipe, batch); setRecipe(null); }} />
                : <Ghost label="Swap This Meal" icon="swap" onPress={() => { swap(recipe.pos, recipe.slot, recipe.idx); setRecipe(null); }} />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg, marginBottom: sp.lg }}>
                <Text style={{ ...ty.label, color: t.ink2 }}>Servings</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.sm, paddingVertical: 4 }}>
                  <Pressable accessibilityLabel="Fewer servings" accessibilityRole="button" onPress={() => setBatch((b) => Math.max(1, b - 1))} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}><Icon name="minus" size={15} color={t.ink} /></Pressable>
                  <Text style={{ ...value(16), color: t.ink, minWidth: 18, textAlign: 'center' }}>{batch}</Text>
                  <Pressable accessibilityLabel="More servings" accessibilityRole="button" onPress={() => setBatch((b) => Math.min(8, b + 1))} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={15} color={t.ink} /></Pressable>
                </View>
                {recipe.steps && recipe.steps.length > 0 ? (
                  <View style={{ flex: 1 }}><Cta label="Cook Mode" wide onPress={() => { setCookStep(0); setCook(true); }} /></View>
                ) : null}
              </View>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Ingredients</Text>
              {recipe.ing.map((ing, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                  <Text style={{ ...ty.body, color: t.ink2 }}>{ing[0]}</Text>
                  <Text style={{ ...ty.body, ...numeric, fontWeight: '500', color: t.ink }}>{Math.round(ing[1] * recipe.servings * batch * 100) / 100}{ing[2] ? ' ' + ing[2] : ''}</Text>
                </View>
              ))}
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xl, marginBottom: sp.md }}>Method</Text>
              {recipe.steps.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.md }}>
                  <Text style={{ ...ty.label, ...numeric, fontWeight: '600', color: t.brand }}>{i + 1}</Text>
                  <Text style={{ ...ty.body, color: t.ink2, flex: 1 }}>{s}</Text>
                </View>
              ))}
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
      <Modal visible={showGrocery} transparent animationType="slide" onRequestClose={() => setShowGrocery(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowGrocery(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '82%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.title, color: t.ink }}>Grocery List</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.md }}>This week · {DIET_LABEL[diet]} · sorted by aisle</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.xl }}>
              <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: t.surface3, overflow: 'hidden' }}>
                <View style={{ width: `${(grocCount ? Math.round((grocChecked / grocCount) * 100) : 0)}%`, height: 3, borderRadius: 2, backgroundColor: t.brand }} />
              </View>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{grocChecked}/{grocCount} in cart</Text>
            </View>
            {DEPTS.filter((d) => groc.byDept[d]?.length).map((d) => (
              <View key={d} style={{ marginBottom: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{DEPT_ICO[d]} {d}</Text>
                {groc.byDept[d]!.map((it, i) => { const k = d + '|' + it.item; const on = !!checked[k]; return (
                  <Pressable key={i} onPress={() => toggleGroc(k)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={it.item}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, flex: 1 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: on ? 0 : 1, borderColor: t.ring, backgroundColor: on ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{on ? <Icon name="check" size={13} color={t.brandInk} /> : null}</View>
                      <Text style={{ ...ty.body, color: on ? t.ink3 : t.ink2, textDecorationLine: on ? 'line-through' : 'none', flex: 1 }}>{it.item}</Text>
                    </View>
                    <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: on ? t.ink3 : t.ink, textDecorationLine: on ? 'line-through' : 'none' }}>{it.qty}{it.unit ? ' ' + it.unit : ''}</Text>
                  </Pressable>
                ); })}
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
              <View style={{ flex: 1 }}><Cta label="Share List" wide onPress={shareGrocery} /></View>
              <View style={{ flex: 1 }}><Ghost label="Close" onPress={() => setShowGrocery(false)} /></View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── what the three day types mean ────────────────────────────────── */}
      <Modal visible={dayInfo} transparent animationType="slide" onRequestClose={() => setDayInfo(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setDayInfo(false)} />
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
                    <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>{d.label}</Text>
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
      <BarcodeSheet visible={bcOpen} onClose={() => setBcOpen(false)}
        onLogged={(f) => fl.addFood({ ...f, via: 'barcode' })} />
    </SafeAreaView>
  );
}
