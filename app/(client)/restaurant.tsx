// Client · Eating out. Estimate macros for common restaurant dishes and log them
// to today's food diary. Pure estimates (src/lib/restaurant.ts) — editable via
// portion before logging. Works fully over-the-air.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useFoodLog } from '../../src/ui/foodLog';
import { CUISINES, PORTIONS, searchDishes, estimateDish, type Dish } from '../../src/lib/restaurant';

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Eating out</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14, fontSize: 14 }}>Pick a dish for a quick macro estimate, adjust the portion, and log it. Estimates are typical servings.</Text>

        <TextInput value={q} onChangeText={setQ} placeholder="Search dishes — burrito, ramen, latte…" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12 }} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8 }}>
          <Pressable onPress={() => setCuisine(null)} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, backgroundColor: cuisine === null ? t.brand : t.surface2, borderWidth: 1, borderColor: cuisine === null ? t.brand : t.ring }}>
            <Text style={{ color: cuisine === null ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>All</Text>
          </Pressable>
          {CUISINES.map((cz) => (
            <Pressable key={cz} onPress={() => setCuisine(cz === cuisine ? null : cz)} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, backgroundColor: cuisine === cz ? t.brand : t.surface2, borderWidth: 1, borderColor: cuisine === cz ? t.brand : t.ring }}>
              <Text style={{ color: cuisine === cz ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{cz}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {results.map((d) => (
          <Pressable key={d.id} onPress={() => { setSel(d); setPortion(1); }} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14.5 }}>{d.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 2 }}>{d.cuisine} · P{d.protein} C{d.carbs} F{d.fat}</Text>
            </View>
            <Text style={{ color: t.brand, fontWeight: '800', fontSize: 15 }}>{d.kcal}</Text>
          </Pressable>
        ))}
        {results.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 20 }}>No dishes match. Try a broader term, or log it in the Food Log with a photo.</Text> : null}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 34 }}>
            {sel && est ? (
              <>
                <Text style={{ color: t.ink, fontSize: 19, fontWeight: '800' }}>{sel.name}</Text>
                <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 2, marginBottom: 14 }}>{sel.cuisine} · portion estimate</Text>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 7 }}>Portion</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  {PORTIONS.map((p) => { const on = portion === p.mult; return (
                    <Pressable key={p.id} onPress={() => setPortion(p.mult)} style={{ flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center', backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                      <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 13 }}>{p.label}</Text>
                    </Pressable>); })}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 15, marginBottom: 16 }}>
                  {[['kcal', est.kcal], ['P', est.protein + 'g'], ['C', est.carbs + 'g'], ['F', est.fat + 'g']].map(([l, v]) => (
                    <View key={l as string} style={{ alignItems: 'center' }}>
                      <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{v}</Text>
                      <Text style={{ color: t.ink3, fontSize: 10, marginTop: 2 }}>{l}</Text>
                    </View>
                  ))}
                </View>
                <Pressable onPress={logIt} style={{ backgroundColor: t.brand, borderRadius: 13, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 7 }}>
                  <Icon name="plus" size={17} color={t.brandInk} /><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Add to today</Text>
                </Pressable>
                <Pressable onPress={() => setSel(null)} style={{ paddingVertical: 13, alignItems: 'center', marginTop: 4 }}><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 13 }}>Cancel</Text></Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
