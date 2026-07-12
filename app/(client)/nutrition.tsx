// Meals — dense briefing that matches the approved mockup: serif header + gold
// coach chip, calorie ring + macro bars hero, clean tappable meal cards, recipe
// & grocery sheets. Meal-plan engine + swap + grocery logic unchanged.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
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
import { analyzeMeal, visionAvailable } from '../../src/lib/vision';
import { parseFoodText, foodAIAvailable } from '../../src/lib/foodAI';
import { lookupBarcode, normalizeBarcode } from '../../src/lib/openfoodfacts';
import { useFoodLog } from '../../src/ui/foodLog';
import { notifySuccess } from '../../src/ui/haptics';

const SERIF = 'Georgia';
const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const DIET_LABEL: Record<Diet, string> = { meat: 'Meat', vegetarian: 'Veggie', vegan: 'Vegan', paleo: 'Paleo', keto: 'Keto' };
const GOALS: Goal[] = ['fatloss', 'tone', 'muscle'];
const GOAL_LABEL: Record<Goal, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };

function CalRing({ t, val, target }: { t: Theme; val: number; target: number }) {
  const r = 34, c = 2 * Math.PI * r, frac = Math.max(0, Math.min(1, target ? val / target : 0));
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={86} height={86} viewBox="0 0 90 90">
        <Circle cx="45" cy="45" r={r} fill="none" stroke={t.surface3} strokeWidth={9} />
        <Circle cx="45" cy="45" r={r} fill="none" stroke={t.brand} strokeWidth={9} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 45 45)" />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>{val.toLocaleString()}</Text>
        <Text style={{ color: t.ink3, fontSize: 9 }}>/ {target.toLocaleString()}</Text>
      </View>
    </View>
  );
}

export default function Nutrition() {
  const t = useTheme();
  const c = useClientData();
  const router = useRouter();
  const { appName } = useBrand();
  const _adj = useCoachNutrition().get(c.id);
  const coachAdjust = c.coachingMode === 'solo' ? null : _adj;
  const w = c.weightKg;
  const bf = c.bodyFatPct;
  const diet = c.diet;
  const [override, setOverride] = useState<Record<number, number>>({});
  const [recipe, setRecipe] = useState<PlannedMeal | null>(null);
  const [showGrocery, setShowGrocery] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => { AsyncStorage.getItem('repple.grocery.checked').then((r) => { if (r) { try { setChecked(JSON.parse(r)); } catch { /* ignore */ } } }); }, []);
  const [view, setView] = useState<'today' | 'week'>('today');
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
    if (visionAvailable() && asset.base64) { const r = await analyzeMeal(asset.base64); if (r) { fl.addFood({ name: r.name, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, via: 'photo' }); notifySuccess(); Alert.alert('Logged', r.name + ' · ' + r.kcal + ' kcal added to today.'); done = true; } }
    setLogBusy(false);
    if (!done) { fl.addFood({ name: 'Meal (photo)', kcal: 520, protein: 40, carbs: 50, fat: 16, via: 'photo' }); Alert.alert('Logged an estimate', 'Added ~520 kcal — open Food Log to fine-tune.'); }
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
    ? { kcalDelta: (coachAdjust?.kcalDelta || 0) + cycleDelta, proteinDelta: coachAdjust?.proteinDelta }
    : undefined;
  const input = { id: c.id, weightKg: w, bodyFatPct: bf, activity: c.activity, goal: c.goal, diet, mealsPerDay: c.mealsPerDay, mealOverride: override, coachAdjust: cyclingAdjust, avoid: c.avoid };
  const { plan, target, tot } = buildPlan(input);
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
    const { html, text } = mealPlanDoc(c.name, target.kcal, rows, labels, appName);
    await shareDoc(html, text, 'Meal plan');
  };
  const weekPlans = view === 'week' ? WEEKD.map((_, d) => { const ov: Record<number, number> = {}; plan.forEach((m) => { ov[m.pos] = m.idx + d; }); return buildPlan({ ...input, mealOverride: ov }); }) : [];

  const macroBar = (label: string, val: number, tgt: number, col: string) => (
    <View style={{ marginBottom: 9 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: t.ink3, fontSize: 11 }}>{label}</Text>
        <Text style={{ color: t.ink2, fontSize: 11, fontWeight: '700' }}>{val}/{tgt}g</Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, marginTop: 4, overflow: 'hidden' }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: col, width: `${Math.min(100, Math.round((val / (tgt || 1)) * 100))}%` }} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* header row: serif title + gold coach chip */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 14 }}>
          <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: SERIF }}>Meals</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {coachAdjust ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.s3, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6 }}>
                <Icon name="sparkle" size={13} color={t.s3} /><Text style={{ color: t.s3, fontSize: 11, fontWeight: '700' }}>Coach-adjusted</Text>
              </View>
            ) : null}
            <Pressable onPress={sharePlan} accessibilityLabel="Share plan" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}><Icon name="share" size={16} color={t.ink2} /></Pressable>
          </View>
        </View>

        {/* hero: ring + macro bars */}
        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <CalRing t={t} val={tot.K} target={target.kcal} />
          <View style={{ flex: 1 }}>
            {macroBar('Protein', tot.P, target.protein, t.brand)}
            {macroBar('Carbs', tot.C, target.carbs, t.s3)}
            {macroBar('Fat', tot.F, target.fat, t.s1)}
          </View>
        </View>

        {/* Macro cycling: training vs rest day */}
        <View style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 }}>
            <Icon name="flame" size={14} color={t.brand} />
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800' }}>Today is a…</Text>
            {dayType !== 'off' ? <Text style={{ color: t.ink3, fontSize: 11 }}>· {dayType === 'training' ? '+250 kcal, more carbs' : '−250 kcal, fewer carbs'}</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['training', 'Training day'], ['off', 'Standard'], ['rest', 'Rest day']] as const).map(([key, label]) => {
              const on = dayType === key;
              return (
                <Pressable key={key} onPress={() => setDayType(key)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                  <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 12 }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Log what you are actually eating */}
        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>Log what you ate</Text>
            <Text style={{ color: t.ink3, fontSize: 12 }}>Eaten <Text style={{ color: t.ink, fontWeight: '700' }}>{fl.consumed.kcal}</Text> / {target.kcal} kcal</Text>
          </View>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>Eating something off-plan? Add it and it counts toward your day.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <Pressable onPress={photoLog} style={{ flex: 1, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 12, alignItems: 'center', gap: 4 }}><Icon name="camera" size={19} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>Photo</Text></Pressable>
            <Pressable onPress={barcodeLog} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', gap: 4 }}><Icon name="search" size={19} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Barcode</Text></Pressable>
            <Pressable onPress={() => router.push('/(client)/foodlog')} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', gap: 4 }}><Icon name="plus" size={19} color={t.ink} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12 }}>Search</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={nl} onChangeText={setNl} placeholder='Describe it — "chicken burrito & a coke"' placeholderTextColor={t.ink3} onSubmitEditing={describeLog} returnKeyType="done" style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 }} />
            <Pressable onPress={describeLog} disabled={logBusy || !nl.trim()} style={{ backgroundColor: nl.trim() ? t.brand : t.surface2, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: nl.trim() ? t.brand : t.ring }}>{logBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ color: nl.trim() ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 13 }}>Log</Text>}</Pressable>
          </View>
          {fl.entries.length > 0 ? (
            <View style={{ marginTop: 12, gap: 6 }}>
              {fl.entries.map((fe) => (
                <View key={fe.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface2, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }}>
                  <Text style={{ color: t.ink2, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{fe.name}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12, marginHorizontal: 8 }}>{fe.kcal} kcal</Text>
                  <Pressable onPress={() => fl.removeFood(fe.id)} hitSlop={6}><Text style={{ color: t.ink3, fontSize: 15 }}>×</Text></Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* allergen / intolerance filter */}
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 7 }}>Avoiding{c.avoid.length ? ' · plan filtered' : ''}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ALLERGENS.map((al) => { const on = c.avoid.includes(al.id); return (
              <Pressable key={al.id} onPress={() => c.setAvoid(on ? c.avoid.filter((x) => x !== al.id) : [...c.avoid, al.id])} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, backgroundColor: on ? t.crit : t.surface, borderWidth: 1, borderColor: on ? t.crit : t.ring, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {on ? <Icon name="check" size={12} color="#fff" /> : null}
                <Text style={{ color: on ? '#fff' : t.ink2, fontWeight: '700', fontSize: 12.5 }}>{al.label}</Text>
              </Pressable>
            ); })}
          </View>
        </View>

        {/* quick links */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
          {([['meals', 'Food Log', '/(client)/foodlog'], ['water', 'Recovery', '/(client)/recovery'], ['settings', 'Macros', '/(client)/tools']] as const).map(([ic, label, route]) => (
            <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Icon name={ic} size={14} color={t.brand} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {coachAdjust?.note ? (
          <View style={{ backgroundColor: t.surface, borderColor: t.s3, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: t.s3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Note from your coach</Text>
            <Text style={{ color: t.ink2, fontSize: 13, marginTop: 5, lineHeight: 18 }}>{coachAdjust.note}</Text>
          </View>
        ) : null}

        {/* today / week toggle */}
        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: 11, padding: 3, marginBottom: 12, borderWidth: 1, borderColor: t.ring }}>
          {(['today', 'week'] as const).map((v) => (
            <Pressable key={v} onPress={() => setView(v)} style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: view === v ? t.brand : 'transparent' }}>
              <Text style={{ color: view === v ? t.brandInk : t.ink3, fontWeight: '700', fontSize: 13 }}>{v === 'today' ? 'Today' : 'This week'}</Text>
            </Pressable>
          ))}
        </View>

        {view === 'today' ? (
          <>
        <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 9 }}>Today's plan · {plan.length} meals</Text>
        {plan.map((m) => (
          <Pressable key={m.pos} onPress={() => setRecipe(m)} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: t.brand, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>{m.slot}</Text>
              <Text style={{ color: t.ink, fontSize: 14, fontWeight: '700', marginTop: 3 }} numberOfLines={2}>{m.n}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 3 }}>P{m.P} · C{m.C} · F{m.F}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{m.K}</Text>
              <Text style={{ color: t.ink3, fontSize: 9 }}>kcal</Text>
            </View>
          </Pressable>
        ))}

          </>
        ) : (
          weekPlans.map((wp, d) => (
            <View key={d} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14 }}>{WEEKD[d]}</Text>
                <Text style={{ color: t.ink3, fontSize: 12 }}>{wp.tot.K.toLocaleString()} kcal</Text>
              </View>
              {wp.plan.map((m) => (
                <Pressable key={m.pos} onPress={() => setRecipe(m)} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 12, marginBottom: 7, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ color: t.brand, fontSize: 8.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 }}>{m.slot}</Text>
                    <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>{m.n}</Text>
                  </View>
                  <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700' }}>{m.K}</Text>
                </Pressable>
              ))}
            </View>
          ))
        )}

        <Pressable onPress={() => setShowGrocery(true)} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 6, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <Icon name="check" size={16} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Grocery list · {grocCount} items</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={!!recipe} transparent animationType="slide" onRequestClose={() => setRecipe(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setRecipe(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '82%' }}>
          {recipe && (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={{ color: t.brand, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>{recipe.slot}</Text>
              <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: SERIF, textTransform: 'capitalize', marginTop: 3 }}>{recipe.n}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 4, marginBottom: 14 }}>{Math.round(recipe.K * batch)} kcal · P{Math.round(recipe.P * batch)} / C{Math.round(recipe.C * batch)} / F{Math.round(recipe.F * batch)}{batch > 1 ? '  · ' + batch + ' servings' : ''}</Text>
              <Pressable onPress={() => { swap(recipe.pos, recipe.slot, recipe.idx); setRecipe(null); }} style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingVertical: 11, marginBottom: 16 }}>
                <Icon name="swap" size={15} color={t.brand} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Swap this meal</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700' }}>Servings</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingHorizontal: 6, paddingVertical: 4 }}>
                  <Pressable onPress={() => setBatch((b) => Math.max(1, b - 1))} style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><Icon name="minus" size={15} color={t.ink} /></Pressable>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, minWidth: 18, textAlign: 'center' }}>{batch}</Text>
                  <Pressable onPress={() => setBatch((b) => Math.min(8, b + 1))} style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={15} color={t.ink} /></Pressable>
                </View>
                {recipe.steps && recipe.steps.length > 0 ? (
                  <Pressable onPress={() => { setCookStep(0); setCook(true); }} style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: t.brand, borderRadius: 11, paddingVertical: 11 }}>
                    <Icon name="flame" size={15} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Cook mode</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 8 }}>Ingredients</Text>
              {recipe.ing.map((ing, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <Text style={{ color: t.ink2, fontSize: 14 }}>{ing[0]}</Text>
                  <Text style={{ color: t.ink, fontSize: 14, fontWeight: '600' }}>{Math.round(ing[1] * recipe.servings * batch * 100) / 100}{ing[2] ? ' ' + ing[2] : ''}</Text>
                </View>
              ))}
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginTop: 18, marginBottom: 8 }}>Method</Text>
              {recipe.steps.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                  <Text style={{ color: t.brand, fontWeight: '800' }}>{i + 1}</Text>
                  <Text style={{ color: t.ink2, fontSize: 14, flex: 1, lineHeight: 20 }}>{s}</Text>
                </View>
              ))}
              <Pressable onPress={() => setRecipe(null)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 }}>
                <Text style={{ color: t.ink, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Cook mode — one step at a time */}
      <Modal visible={cook && !!recipe} transparent animationType="fade" onRequestClose={() => setCook(false)}>
        <View style={{ flex: 1, backgroundColor: t.bg }}>
          {recipe && recipe.steps && recipe.steps.length > 0 ? (
            <View style={{ flex: 1, padding: 24, paddingTop: 60, justifyContent: 'space-between' }}>
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                  <Text style={{ color: t.ink3, fontSize: 13, fontWeight: '700', textTransform: 'capitalize' }}>{recipe.n}</Text>
                  <Pressable onPress={() => setCook(false)} hitSlop={10}><Text style={{ color: t.ink3, fontWeight: '800', fontSize: 15 }}>Done</Text></Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 5, marginBottom: 28 }}>
                  {recipe.steps.map((_, i) => (
                    <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= cookStep ? t.brand : t.surface3 }} />
                  ))}
                </View>
                <Text style={{ color: t.brand, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, marginBottom: 10 }}>STEP {cookStep + 1} OF {recipe.steps.length}</Text>
                <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', lineHeight: 36, fontFamily: SERIF }}>{recipe.steps[cookStep]}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
                <Pressable onPress={() => setCookStep((x) => Math.max(0, x - 1))} disabled={cookStep === 0} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: cookStep === 0 ? 0.4 : 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>Back</Text>
                </Pressable>
                {cookStep < recipe.steps.length - 1 ? (
                  <Pressable onPress={() => setCookStep((x) => x + 1)} style={{ flex: 2, backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
                    <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Next step</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => setCook(false)} style={{ flex: 2, backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
                    <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Finish ✓</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal visible={showGrocery} transparent animationType="slide" onRequestClose={() => setShowGrocery(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowGrocery(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '82%' }}>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: SERIF, marginBottom: 4 }}>Grocery list</Text>
            <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 10 }}>This week · {DIET_LABEL[diet]} · sorted by aisle</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <View style={{ flex: 1, height: 7, backgroundColor: t.surface2, borderRadius: 4, marginRight: 12, overflow: 'hidden' }}>
                <View style={{ width: (grocCount ? Math.round((grocChecked / grocCount) * 100) : 0) + '%', height: 7, backgroundColor: t.brand }} />
              </View>
              <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700' }}>{grocChecked}/{grocCount} in cart</Text>
            </View>
            {DEPTS.filter((d) => groc.byDept[d]?.length).map((d) => (
              <View key={d} style={{ marginBottom: 16 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, marginBottom: 6 }}>{DEPT_ICO[d]} {d}</Text>
                {groc.byDept[d]!.map((it, i) => { const k = d + '|' + it.item; const on = !!checked[k]; return (
                  <Pressable key={i} onPress={() => toggleGroc(k)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={it.item} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: on ? t.brand : t.ring, backgroundColor: on ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{on ? <Icon name="check" size={13} color={t.brandInk} /> : null}</View>
                      <Text style={{ color: on ? t.ink3 : t.ink2, fontSize: 14, textDecorationLine: on ? 'line-through' : 'none', flex: 1 }}>{it.item}</Text>
                    </View>
                    <Text style={{ color: on ? t.ink3 : t.ink, fontSize: 13, fontWeight: '600', textDecorationLine: on ? 'line-through' : 'none' }}>{it.qty}{it.unit ? ' ' + it.unit : ''}</Text>
                  </Pressable>
                ); })}
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={shareGrocery} accessibilityLabel="Share grocery list" style={{ flex: 1, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                <Icon name="share" size={15} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800' }}>Share list</Text>
              </Pressable>
              <Pressable onPress={() => setShowGrocery(false)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: t.ink, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={bcOpen} transparent animationType="slide" onRequestClose={() => setBcOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setBcOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, padding: 20, paddingBottom: 30 }}>
          <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: SERIF, marginBottom: 4 }}>Scan a barcode</Text>
          <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>Type the number under the barcode — we look it up in Open Food Facts and add the real macros.</Text>
          <TextInput value={bcCode} onChangeText={setBcCode} placeholder="e.g. 0049000042566" placeholderTextColor={t.ink3} keyboardType="number-pad" returnKeyType="done" onSubmitEditing={runBarcodeLookup} autoFocus style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, letterSpacing: 1, marginBottom: 14 }} />
          <Pressable onPress={runBarcodeLookup} disabled={bcBusy} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}>
            {bcBusy ? <ActivityIndicator color={t.brandInk} /> : <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Look up &amp; log</Text>}
          </Pressable>
          <Pressable onPress={() => setBcOpen(false)} style={{ paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
