// Client · Eating out — estimate macros for common restaurant dishes and log
// them to today's diary.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same estimator, same routes, same hooks in the same
// order. No hero: a search screen has no live number to lead with, so the field
// sits directly under the title and every dish is a hairline-divided row rather
// than its own bordered box.
//
// `src/lib/restaurant.ts` is a reference table of typical restaurant servings —
// a lookup vocabulary, not a record of anything the client ate — so it stays.
// Nothing is logged until they pick a dish, a portion, and tap Add.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useFoodLog } from '../../src/ui/foodLog';
import { CUISINES, PORTIONS, searchDishes, estimateDish, type Dish } from '../../src/lib/restaurant';
import { Rule, Section, SectionHead, KpiRow, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, elevation, type as ty, numeric, value } from '../../src/theme/scale';

export default function Restaurant() {
  const t = useTheme();
  const router = useRouter();
  const fl = useFoodLog();
  const [q, setQ] = useState('');
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [sel, setSel] = useState<Dish | null>(null);
  const [portion, setPortion] = useState(1);

  const results = useMemo(() => {
    const base = searchDishes(q, 200);
    return cuisine ? base.filter((d) => d.cuisine === cuisine) : base;
  }, [q, cuisine]);

  const est = sel ? estimateDish(sel, portion) : null;
  const logIt = () => {
    if (!est) return;
    fl.addFood({ name: est.name, kcal: est.kcal, protein: est.protein, carbs: est.carbs, fat: est.fat, via: 'manual' });
    setSel(null); setPortion(1);
    Alert.alert('Logged', `${est.name} · ${est.kcal} kcal added to today.`);
  };

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Nutrition</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Eating out</Text>
          </View>
        </View>

        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>
          Pick a dish for a macro estimate, set the portion, and log it. These are typical restaurant servings, not label data.
        </Text>

        {/* ── the field is the screen ────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, marginTop: sp.lg }}>
          <Icon name="search" size={16} color={t.ink3} />
          <TextInput value={q} onChangeText={setQ} placeholder="Burrito, ramen, latte…" placeholderTextColor={t.ink3}
            style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
          {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={{ ...ty.head, color: t.ink3 }}>×</Text></Pressable> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.md }} contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.xs }}>
          <Pressable onPress={() => setCuisine(null)} accessibilityRole="button" accessibilityState={{ selected: cuisine === null }}
            style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: cuisine === null ? t.brand : t.surface2 }}>
            <Text style={{ ...ty.label, fontWeight: cuisine === null ? '600' : '500', color: cuisine === null ? t.brandInk : t.ink2 }}>All</Text>
          </Pressable>
          {CUISINES.map((cz) => {
            const on = cuisine === cz;
            return (
              <Pressable key={cz} onPress={() => setCuisine(cz === cuisine ? null : cz)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{cz}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Section>
          <SectionHead title={cuisine || 'All dishes'} note={`${results.length} dish${results.length === 1 ? '' : 'es'}`} />
          {results.map((d, i) => (
            <View key={d.id}>
              {i > 0 ? <Rule /> : null}
              <Pressable onPress={() => { setSel(d); setPortion(1); }} accessibilityRole="button" accessibilityLabel={d.name}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{d.name}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{d.cuisine} · P{d.protein} C{d.carbs} F{d.fat}</Text>
                </View>
                <Text style={{ ...value(18), color: t.ink }}>{d.kcal}</Text>
                <Text style={{ ...ty.caption, color: t.ink3 }}>kcal</Text>
              </Pressable>
            </View>
          ))}
          {results.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
              <Icon name="search" size={26} color={t.ink3} />
              <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md, textAlign: 'center' }}>No dishes match. Try a broader term, or log it in the Food Log with a photo.</Text>
            </View>
          ) : null}
        </Section>

      </ScrollView>

      {/* ── portion sheet ──────────────────────────────────────────────── */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSel(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 }}>
          {sel && est ? (
            <>
              <Text style={{ ...ty.micro, color: t.ink3 }}>{sel.cuisine} · portion estimate</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 4, marginBottom: sp.lg }}>{sel.name}</Text>
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Portion</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.xl }}>
                {PORTIONS.map((p) => { const on = portion === p.mult; return (
                  <Pressable key={p.id} onPress={() => setPortion(p.mult)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{p.label}</Text>
                  </Pressable>); })}
              </View>
              <KpiRow items={[
                { label: 'kcal', value: String(est.kcal) },
                { label: 'Protein', value: String(est.protein), unit: 'g' },
                { label: 'Carbs', value: String(est.carbs), unit: 'g' },
                { label: 'Fat', value: String(est.fat), unit: 'g' },
              ]} />
              <View style={{ height: sp.xl }} />
              <Cta label="Add to today" wide onPress={logIt} />
              <View style={{ height: sp.sm }} />
              <Ghost label="Cancel" onPress={() => setSel(null)} />
            </>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
