// Meals — dense briefing that matches the approved mockup: serif header + gold
// coach chip, calorie ring + macro bars hero, clean tappable meal cards, recipe
// & grocery sheets. Meal-plan engine + swap + grocery logic unchanged.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { buildPlan, swapIndex, groceryData, DEPTS, DEPT_ICO, type PlannedMeal } from '../../src/lib/meals';
import type { Diet, Goal } from '../../src/lib/types';
import { useClientData } from '../../src/ui/clientData';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { Icon } from '../../src/ui/Icon';

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
  const coachAdjust = useCoachNutrition().get(c.id);
  const w = c.weightKg;
  const bf = c.bodyFatPct;
  const diet = c.diet;
  const [override, setOverride] = useState<Record<number, number>>({});
  const [recipe, setRecipe] = useState<PlannedMeal | null>(null);
  const [showGrocery, setShowGrocery] = useState(false);

  const input = { id: c.id, weightKg: w, bodyFatPct: bf, activity: c.activity, goal: c.goal, diet, mealsPerDay: c.mealsPerDay, mealOverride: override, coachAdjust: coachAdjust || undefined };
  const { plan, target, tot } = buildPlan(input);
  const swap = (pos: number, slot: PlannedMeal['slot'], idx: number) => setOverride({ ...override, [pos]: swapIndex(diet, slot, idx) });
  const groc = groceryData(input);
  const grocCount = DEPTS.reduce((a, d) => a + (groc.byDept[d]?.length ?? 0), 0);

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
          {coachAdjust ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.s3, borderRadius: 16, paddingHorizontal: 11, paddingVertical: 6 }}>
              <Icon name="sparkle" size={13} color={t.s3} /><Text style={{ color: t.s3, fontSize: 11, fontWeight: '700' }}>Coach-adjusted</Text>
            </View>
          ) : null}
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

        {coachAdjust?.note ? (
          <View style={{ backgroundColor: t.surface, borderColor: t.s3, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: t.s3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>Note from your coach</Text>
            <Text style={{ color: t.ink2, fontSize: 13, marginTop: 5, lineHeight: 18 }}>{coachAdjust.note}</Text>
          </View>
        ) : null}

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
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 4, marginBottom: 14 }}>{recipe.K} kcal · P{recipe.P} / C{recipe.C} / F{recipe.F}</Text>
              <Pressable onPress={() => { swap(recipe.pos, recipe.slot, recipe.idx); setRecipe(null); }} style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 11, paddingVertical: 11, marginBottom: 16 }}>
                <Icon name="swap" size={15} color={t.brand} /><Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Swap this meal</Text>
              </Pressable>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 8 }}>Ingredients</Text>
              {recipe.ing.map((ing, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <Text style={{ color: t.ink2, fontSize: 14 }}>{ing[0]}</Text>
                  <Text style={{ color: t.ink, fontSize: 14, fontWeight: '600' }}>{Math.round(ing[1] * recipe.servings * 100) / 100}{ing[2] ? ' ' + ing[2] : ''}</Text>
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

      <Modal visible={showGrocery} transparent animationType="slide" onRequestClose={() => setShowGrocery(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowGrocery(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '82%' }}>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={{ color: t.ink, fontSize: 21, fontWeight: '700', fontFamily: SERIF, marginBottom: 4 }}>Grocery list</Text>
            <Text style={{ color: t.ink3, fontSize: 13, marginBottom: 16 }}>This week · {DIET_LABEL[diet]} · sorted by aisle</Text>
            {DEPTS.filter((d) => groc.byDept[d]?.length).map((d) => (
              <View key={d} style={{ marginBottom: 16 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14, marginBottom: 6 }}>{DEPT_ICO[d]} {d}</Text>
                {groc.byDept[d]!.map((it, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                    <Text style={{ color: t.ink2, fontSize: 14 }}>{it.item}</Text>
                    <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600' }}>{it.qty}{it.unit ? ' ' + it.unit : ''}</Text>
                  </View>
                ))}
              </View>
            ))}
            <Pressable onPress={() => setShowGrocery(false)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
              <Text style={{ color: t.ink, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
