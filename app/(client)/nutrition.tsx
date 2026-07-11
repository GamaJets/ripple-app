// Nutrition — personalised meal plan (engine) with recipes, swaps & grocery list.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { buildPlan, swapIndex, groceryData, DEPTS, DEPT_ICO, type PlannedMeal } from '../../src/lib/meals';
import type { Diet, Goal } from '../../src/lib/types';
import { useClientData } from '../../src/ui/clientData';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { useRouter } from 'expo-router';
import { Icon } from '../../src/ui/Icon';

const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const DIET_LABEL: Record<Diet, string> = { meat: 'Meat', vegetarian: 'Veggie', vegan: 'Vegan', paleo: 'Paleo', keto: 'Keto' };
const GOALS: Goal[] = ['fatloss', 'tone', 'muscle'];
const GOAL_LABEL: Record<Goal, string> = { fatloss: 'Fat Loss', tone: 'Tone', muscle: 'Build Muscle' };

export default function Nutrition() {
  const t = useTheme();
  const c = useClientData();
  const router = useRouter();
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Meal plan</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Built for your body & goal · tap a meal for the recipe</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 4, marginBottom: 4 }}>
          {([["meals","Food Log","/(client)/foodlog"],["water","Recovery","/(client)/recovery"],["settings","Macros","/(client)/tools"]] as const).map(([ic, label, route]) => (
            <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Icon name={ic} size={14} color={t.brand} /><Text style={{ color: t.ink2, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {coachAdjust ? (<View style={{ backgroundColor: t.surface, borderColor: t.brand, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 }}><Text style={{ color: t.brand, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>🥗 Adjusted by your coach</Text>{coachAdjust.note ? <Text style={{ color: t.ink2, fontSize: 13, marginTop: 5, lineHeight: 18 }}>{coachAdjust.note}</Text> : null}</View>) : null}

        <View style={{ backgroundColor: t.surface, borderRadius: 20, borderWidth: 1, borderColor: t.ring, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize' }}>Today · {tot.K.toLocaleString()} / {target.kcal.toLocaleString()} kcal</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[['Protein', tot.P, target.protein, t.brand], ['Carbs', tot.C, target.carbs, t.s1], ['Fat', tot.F, target.fat, t.s3]].map(([k, v, tg, col]) => (
              <View key={k as string} style={{ flex: 1 }}>
                <Text style={{ color: t.ink3, fontSize: 12 }}>{k as string}</Text>
                <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{v as number}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}>/{tg as number}g</Text></Text>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, marginTop: 4, overflow: 'hidden' }}>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: col as string, width: Math.min(100, Math.round(((v as number) / (tg as number)) * 100)) + '%' }} />
                </View>
              </View>
            ))}
          </View>
        </View>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Goal</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {GOALS.map((g) => (
            <Pressable key={g} onPress={() => { c.setGoal(g); setOverride({}); }} style={{ flex: 1, paddingVertical: 9, borderRadius: 20, alignItems: 'center', backgroundColor: c.goal === g ? t.brand : t.surface, borderWidth: 1, borderColor: c.goal === g ? t.brand : t.ring }}>
              <Text style={{ color: c.goal === g ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{GOAL_LABEL[g]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Diet</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
          {DIETS.map((d) => (
            <Pressable key={d} onPress={() => { c.setDiet(d); setOverride({}); }} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: diet === d ? t.brand : t.surface, borderWidth: 1, borderColor: diet === d ? t.brand : t.ring }}>
              <Text style={{ color: diet === d ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{DIET_LABEL[d]}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {plan.map((m) => (
          <View key={m.pos} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 22 }}>{m.ico}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.slot}</Text>
                <Text style={{ color: t.ink, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{m.n}</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{m.K} kcal · P{m.P} C{m.C} F{m.F}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Pressable onPress={() => setRecipe(m)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingVertical: 9, alignItems: 'center' }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>📖 Recipe</Text>
              </Pressable>
              <Pressable onPress={() => swap(m.pos, m.slot, m.idx)} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingVertical: 9, alignItems: 'center' }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13 }}>🔄 Swap</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Pressable onPress={() => setShowGrocery(true)} style={{ backgroundColor: t.brand, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 6 }}>
          <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>🛒 Grocery list · {grocCount} items</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={!!recipe} transparent animationType="slide" onRequestClose={() => setRecipe(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setRecipe(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '80%' }}>
          {recipe && (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', textTransform: 'capitalize' }}>{recipe.ico} {recipe.n}</Text>
              <Text style={{ color: t.ink3, fontSize: 13, marginTop: 4, marginBottom: 16 }}>{recipe.slot} · {recipe.K} kcal · P{recipe.P} / C{recipe.C} / F{recipe.F}</Text>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize', marginBottom: 8 }}>🧺 Ingredients</Text>
              {recipe.ing.map((ing, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.ring }}>
                  <Text style={{ color: t.ink2, fontSize: 14 }}>{ing[0]}</Text>
                  <Text style={{ color: t.ink, fontSize: 14, fontWeight: '600' }}>{Math.round(ing[1] * recipe.servings * 100) / 100}{ing[2] ? ' ' + ing[2] : ''}</Text>
                </View>
              ))}
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize', marginTop: 18, marginBottom: 8 }}>👩‍🍳 Method</Text>
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
            <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', textTransform: 'capitalize', marginBottom: 4 }}>🛒 Grocery list</Text>
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
