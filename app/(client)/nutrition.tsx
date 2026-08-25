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
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { buildPlan, swapIndex, groceryData, DEPTS, DEPT_ICO, ALLERGENS, type PlannedMeal } from '../../src/lib/meals';
import { mealPlanDoc, shareDoc } from '../../src/lib/exportShare';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Diet, Goal } from '../../src/lib/types';
import { useClientData } from '../../src/ui/clientData';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { Icon } from '../../src/ui/Icon';
import { useRouter } from 'expo-router';
import { useBrand } from '../../src/ui/brand';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { analyzeMeal, visionAvailable } from '../../src/lib/vision';
import { parseFoodText, foodAIAvailable } from '../../src/lib/foodAI';
import { lookupBarcode, normalizeBarcode } from '../../src/lib/openfoodfacts';
import { useFoodLog } from '../../src/ui/foodLog';
import { notifySuccess } from '../../src/ui/haptics';
import { Rule, Section, SectionHead, Hero, Card, Cta, Ghost, Meter, QuickRow } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';

const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const DIET_LABEL: Record<Diet, string> = { meat: 'Meat', vegetarian: 'Veggie', vegan: 'Vegan', paleo: 'Paleo', keto: 'Keto' };
const GOALS: Goal[] = ['fatloss', 'tone', 'muscle'];
const GOAL_LABEL: Record<Goal, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };

export default function Nutrition() {
  const t = useTheme();
  const c = useClientData();
  const router = useRouter();
  const { appName } = useBrand();
  const _adj = useCoachNutrition().get(c.id);
  const coachAdjust = c.coachingMode === 'solo' ? null : _adj;
  // A meal plan is scaled to lean body mass. Without a weight and body fat there
  // is nothing to scale, and the whole screen used to run on a 70 kg / 20%
  // placeholder and present the result as the client's plan. Zeros here are
  // never rendered — `hasBody` swaps the screen for a prompt below.
  const hasBody = c.weightKg != null && c.bodyFatPct != null;
  const w = c.weightKg ?? 0;
  const bf = c.bodyFatPct ?? 0;
  const diet = c.diet;
  const [override, setOverride] = useState<Record<number, number>>({});
  const [ovHydrated, setOvHydrated] = useState(false);
  const [recipe, setRecipe] = useState<PlannedMeal | null>(null);
  const [showGrocery, setShowGrocery] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => { AsyncStorage.getItem('repple.grocery.checked').then((r) => { if (r) { try { setChecked(JSON.parse(r)); } catch { /* ignore */ } } }); }, []);
  // Persist the client's meal swaps so they survive leaving the tab / relaunch.
  useEffect(() => { AsyncStorage.getItem('repple.mealOverride').then((r) => { if (r) { try { setOverride(JSON.parse(r)); } catch { /* ignore */ } } setOvHydrated(true); }); }, []);
  useEffect(() => { if (!ovHydrated) return; AsyncStorage.setItem('repple.mealOverride', JSON.stringify(override)).catch(() => {}); }, [override, ovHydrated]);
  const [view, setView] = useState<'today' | 'week'>('today');
  const [showAvoid, setShowAvoid] = useState(false);
  const [dayType, setDayType] = useState<'training' | 'rest' | 'off'>('off');
  const [batch, setBatch] = useState(1);
  const [cook, setCook] = useState(false);
  const [cookStep, setCookStep] = useState(0);
  const fl = useFoodLog();
  useEffect(() => { setBatch(1); setCook(false); setCookStep(0); }, [recipe]);
  const [nl, setNl] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [bcOpen, setBcOpen] = useState(false);
  const [bcCode, setBcCode] = useState('');
  const [bcBusy, setBcBusy] = useState(false);
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
  const barcodeLog = () => { setBcCode(''); setBcOpen(true); };
  const runBarcodeLookup = async () => {
    if (!normalizeBarcode(bcCode)) { Alert.alert('Enter a barcode', 'Type the 8–13 digit number under the barcode.'); return; }
    setBcBusy(true); const p = await lookupBarcode(bcCode); setBcBusy(false);
    if (!p) { Alert.alert('Not found', 'No match in the Open Food Facts database for that barcode. Try “Describe it” instead.'); return; }
    fl.addFood({ name: p.name, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, via: 'barcode' });
    notifySuccess(); setBcOpen(false);
    Alert.alert('Logged', p.name + ' · ' + p.kcal + ' kcal (' + p.serving + ') added to today.');
  };
  const describeLog = async () => {
    const text = nl.trim(); if (!text) return;
    setLogBusy(true); const items = await parseFoodText(text); setLogBusy(false);
    if (items && items.length) { items.forEach((it) => fl.addFood({ name: it.name, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, via: 'manual' })); setNl(''); notifySuccess(); }
    else { Alert.alert('Could not read that', foodAIAvailable() ? 'Try e.g. \"2 eggs, toast and a coffee\".' : 'AI logging turns on with the AI backend.'); }
  };

  const cycleDelta = dayType === 'training' ? 250 : dayType === 'rest' ? -250 : 0;
  const cyclingAdjust = (coachAdjust || cycleDelta)
    ? { kcalDelta: (coachAdjust?.kcalDelta || 0) + cycleDelta, proteinDelta: coachAdjust?.proteinDelta, carbDelta: coachAdjust?.carbDelta, fatDelta: coachAdjust?.fatDelta }
    : undefined;
  const input = { id: c.id, weightKg: w, bodyFatPct: bf, activity: c.activity, goal: c.goal, diet, mealsPerDay: c.mealsPerDay, mealOverride: { ...(coachAdjust?.mealOverride ?? {}), ...override }, coachAdjust: cyclingAdjust, avoid: c.avoid };
  const { plan, target, tot } = buildPlan(input);
  const coachPick = (pos: number) => !!(coachAdjust?.mealOverride && coachAdjust.mealOverride[pos] != null && override[pos] == null);
  const swap = (pos: number, slot: PlannedMeal['slot'], idx: number) => setOverride({ ...override, [pos]: swapIndex(diet, slot, idx) });
  const groc = groceryData(input);
  const grocCount = DEPTS.reduce((a, d) => a + (groc.byDept[d]?.length ?? 0), 0);
  const grocKeys = DEPTS.flatMap((d) => (groc.byDept[d] || []).map((it) => d + '|' + it.item));
  const grocChecked = grocKeys.filter((k) => checked[k]).length;
  const toggleGroc = (k: string) => setChecked((prev) => { const n = { ...prev, [k]: !prev[k] }; AsyncStorage.setItem('repple.grocery.checked', JSON.stringify(n)); return n; });
  const shareGrocery = async () => {
    const lines: string[] = ['Grocery list', ''];
    let html = '<h2>Grocery list</h2>';
    DEPTS.filter((d) => groc.byDept[d]?.length).forEach((d) => {
      lines.push(d.toUpperCase());
      html += '<h3>' + d + '</h3><ul>';
      groc.byDept[d]!.forEach((it) => { const q = it.qty + (it.unit ? ' ' + it.unit : ''); lines.push('- ' + it.item + ' — ' + q); html += '<li>' + it.item + ' — ' + q + '</li>'; });
      html += '</ul>'; lines.push('');
    });
    await shareDoc(html, lines.join('\n'), 'Grocery list');
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
  const kcalLeft = Math.max(0, target.kcal - eaten.kcal);
  const cycleNote = dayType === 'training' ? '+250 kcal, more carbs' : dayType === 'rest' ? '−250 kcal, fewer carbs' : undefined;

  if (!hasBody) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: sp.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Nutrition</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Meals</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Your targets and meal plan are scaled to your body, so they need a weight and body fat to work from.</Text>
            </View>
            <Ghost icon="back" onPress={() => router.back()} />
          </View>
          <Rule />
          <Section>
            <Cta label="Add your measurements" wide onPress={() => router.push('/(client)/scans')} />
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
          label="Calories left"
          figure={kcalLeft.toLocaleString()}
          unit="kcal"
          note={`${eaten.kcal.toLocaleString()} of ${target.kcal.toLocaleString()} kcal eaten`}
          arc={target.kcal ? eaten.kcal / target.kcal : 0}
          onPress={() => router.push('/(client)/foodlog')}
        />

        <Rule />

        {/* ── the plan's macro split against target ──────────────────────── */}
        <Section>
          <SectionHead title="Macros" note={`${tot.K.toLocaleString()} kcal planned`} />
          <Meter label="Protein" val={tot.P} target={target.protein} />
          <Meter label="Carbs" val={tot.C} target={target.carbs} dim />
          <Meter label="Fat" val={tot.F} target={target.fat} dim />
        </Section>

        <Rule />

        {/* ── macro cycling: training vs rest day ────────────────────────── */}
        <Section>
          <SectionHead title="Today is a…" note={cycleNote} />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {([['training', 'Training day'], ['off', 'Standard'], ['rest', 'Rest day']] as const).map(([key, label]) => {
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
          <SectionHead title="Log what you ate" note={`${fl.consumed.kcal.toLocaleString()} of ${target.kcal.toLocaleString()} kcal`} />
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
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{fe.kcal} kcal</Text>
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
            { icon: 'settings', label: 'Macros', onPress: () => router.push('/(client)/tools') },
          ]} />
        </Section>

        {coachAdjust?.note ? (<>
          <Rule />
          <Section>
            <SectionHead title="Note from your coach" />
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

        <Section>
          <Cta label={`Grocery list · ${grocCount} items`} wide onPress={() => setShowGrocery(true)} />
        </Section>

      </ScrollView>

      {/* ── recipe sheet ─────────────────────────────────────────────────── */}
      <Modal visible={!!recipe} transparent animationType="slide" onRequestClose={() => setRecipe(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setRecipe(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '82%', ...elevation.e2 }}>
          {recipe && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{recipe.slot}</Text>
              <Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize', marginTop: 4 }}>{recipe.n}</Text>
              <Text style={{ ...ty.label, ...numeric, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>{Math.round(recipe.K * batch)} kcal · P{Math.round(recipe.P * batch)} / C{Math.round(recipe.C * batch)} / F{Math.round(recipe.F * batch)}{batch > 1 ? '  · ' + batch + ' servings' : ''}</Text>
              <Ghost label="Swap this meal" icon="swap" onPress={() => { swap(recipe.pos, recipe.slot, recipe.idx); setRecipe(null); }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg, marginBottom: sp.lg }}>
                <Text style={{ ...ty.label, color: t.ink2 }}>Servings</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.sm, paddingVertical: 4 }}>
                  <Pressable accessibilityLabel="Fewer servings" accessibilityRole="button" onPress={() => setBatch((b) => Math.max(1, b - 1))} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}><Icon name="minus" size={15} color={t.ink} /></Pressable>
                  <Text style={{ ...value(16), color: t.ink, minWidth: 18, textAlign: 'center' }}>{batch}</Text>
                  <Pressable accessibilityLabel="More servings" accessibilityRole="button" onPress={() => setBatch((b) => Math.min(8, b + 1))} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={15} color={t.ink} /></Pressable>
                </View>
                {recipe.steps && recipe.steps.length > 0 ? (
                  <View style={{ flex: 1 }}><Cta label="Cook mode" wide onPress={() => { setCookStep(0); setCook(true); }} /></View>
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
      </Modal>

      {/* Cook mode — one step at a time */}
      <Modal visible={cook && !!recipe} transparent animationType="fade" onRequestClose={() => setCook(false)}>
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
                  <View style={{ flex: 2 }}><Cta label="Next step" wide onPress={() => setCookStep((x) => x + 1)} /></View>
                ) : (
                  <View style={{ flex: 2 }}><Cta label="Finish" wide onPress={() => setCook(false)} /></View>
                )}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* ── grocery sheet ────────────────────────────────────────────────── */}
      <Modal visible={showGrocery} transparent animationType="slide" onRequestClose={() => setShowGrocery(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowGrocery(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '82%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.title, color: t.ink }}>Grocery list</Text>
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
              <View style={{ flex: 1 }}><Cta label="Share list" wide onPress={shareGrocery} /></View>
              <View style={{ flex: 1 }}><Ghost label="Close" onPress={() => setShowGrocery(false)} /></View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── barcode sheet ────────────────────────────────────────────────── */}
      <Modal visible={bcOpen} transparent animationType="slide" onRequestClose={() => setBcOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setBcOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
          <Text style={{ ...ty.title, color: t.ink }}>Scan a barcode</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>Type the number under the barcode — we look it up in Open Food Facts and add the real macros.</Text>
          <TextInput value={bcCode} onChangeText={setBcCode} placeholder="e.g. 0049000042566" placeholderTextColor={t.ink3} keyboardType="number-pad" returnKeyType="done" onSubmitEditing={runBarcodeLookup} autoFocus
            style={{ ...ty.head, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 13, letterSpacing: 1, marginBottom: sp.md }} />
          <Pressable onPress={runBarcodeLookup} disabled={bcBusy}
            style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center', marginBottom: sp.sm }}>
            {bcBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Look up &amp; log</Text>}
          </Pressable>
          <Pressable onPress={() => setBcOpen(false)} style={{ paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
          </Pressable>
        </View>
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
