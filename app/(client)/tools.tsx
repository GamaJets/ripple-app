// Client · Lifting Tools. Three self-contained calculators: 1RM estimator,
// barbell plate math, and a macro/quick reference. No backend, pure local state.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';

const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

function OneRM({ t }: { t: Theme }) {
  const [w, setW] = useState('60');
  const [r, setR] = useState('5');
  const weight = parseFloat(w) || 0, reps = parseInt(r, 10) || 0;
  const oneRm = weight && reps ? Math.round(weight * (1 + reps / 30)) : 0;
  const pcts = [100, 95, 90, 85, 80, 75, 70];
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, flex: 1, textAlign: 'center' } as const;
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 16 }}>
      <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginBottom: 12 }}>1RM Estimator</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <TextInput value={w} onChangeText={setW} keyboardType="numeric" style={inp} placeholder="kg" placeholderTextColor={t.ink3} />
        <Text style={{ color: t.ink3 }}>kg ×</Text>
        <TextInput value={r} onChangeText={setR} keyboardType="numeric" style={inp} placeholder="reps" placeholderTextColor={t.ink3} />
        <Text style={{ color: t.ink3 }}>reps</Text>
      </View>
      <View style={{ backgroundColor: t.surface2, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: t.ink3, fontSize: 12 }}>Estimated 1RM (Epley)</Text>
        <Text style={{ color: t.brand, fontSize: 30, fontWeight: '900' }}>{oneRm} kg</Text>
      </View>
      {oneRm > 0 ? pcts.map((p) => (
        <View key={p} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.ring }}>
          <Text style={{ color: t.ink3, fontSize: 13 }}>{p}%</Text>
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700' }}>{Math.round((oneRm * p) / 100)} kg</Text>
        </View>
      )) : null}
    </View>
  );
}

function PlateCalc({ t }: { t: Theme }) {
  const [target, setTarget] = useState('100');
  const [bar, setBar] = useState(20);
  const total = parseFloat(target) || 0;
  const perSide = Math.max(0, (total - bar) / 2);
  const plates: number[] = [];
  let rem = perSide;
  for (const p of PLATES) { while (rem >= p - 1e-9) { plates.push(p); rem = +(rem - p).toFixed(3); } }
  const achievable = +(bar + plates.reduce((a, p) => a + p, 0) * 2).toFixed(2);
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, flex: 1, textAlign: 'center' } as const;
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 16 }}>
      <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginBottom: 12 }}>Plate Calculator</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <TextInput value={target} onChangeText={setTarget} keyboardType="numeric" style={inp} placeholder="total kg" placeholderTextColor={t.ink3} />
        <Text style={{ color: t.ink3 }}>bar</Text>
        {[20, 15].map((b) => (
          <Pressable key={b} onPress={() => setBar(b)} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: bar === b ? t.brand : t.surface2, borderWidth: 1, borderColor: bar === b ? t.brand : t.ring }}>
            <Text style={{ color: bar === b ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 13 }}>{b}kg</Text>
          </Pressable>
        ))}
      </View>
      {plates.length ? (
        <View>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 8 }}>Per side ({perSide} kg):</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {plates.map((p, i) => <View key={i} style={{ backgroundColor: t.brand, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 7 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>{p}</Text></View>)}
          </View>
          {achievable !== total ? <Text style={{ color: t.warn, fontSize: 12 }}>Closest loadable: {achievable} kg</Text> : <Text style={{ color: t.ink3, fontSize: 12 }}>Loads exactly ✓</Text>}
        </View>
      ) : <Text style={{ color: t.ink3, fontSize: 13 }}>Just the bar ({bar} kg).</Text>}
    </View>
  );
}

function MacroRef({ t }: { t: Theme }) {
  const rows = [['Protein', '4 kcal/g', 'Muscle repair · 1.8–2.2 g/kg lean mass'], ['Carbs', '4 kcal/g', 'Training fuel · fill remaining calories'], ['Fat', '9 kcal/g', 'Hormones · ~0.8–1 g/kg bodyweight'], ['Fibre', '~2 kcal/g', 'Aim 25–35 g/day'], ['Alcohol', '7 kcal/g', 'No nutritional value']];
  return (
    <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16 }}>
      <Text style={{ color: t.ink, fontWeight: '800', fontSize: 16, marginBottom: 12 }}>Macro Reference</Text>
      {rows.map(([k, cal, note]) => (
        <View key={k} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.ring }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{k}</Text>
            <Text style={{ color: t.brand, fontWeight: '800', fontSize: 14 }}>{cal}</Text>
          </View>
          <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{note}</Text>
        </View>
      ))}
    </View>
  );
}

export default function Tools() {
  const t = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState<'1rm' | 'plates' | 'macros'>('1rm');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Lifting Tools</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Calculators for the gym floor</Text>
        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: 10, padding: 3, marginBottom: 16, borderWidth: 1, borderColor: t.ring }}>
          {([['1rm', '1RM'], ['plates', 'Plates'], ['macros', 'Macros']] as const).map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: tab === k ? t.brand : 'transparent' }}>
              <Text style={{ color: tab === k ? t.brandInk : t.ink3, fontWeight: '700', fontSize: 13 }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {tab === '1rm' ? <OneRM t={t} /> : tab === 'plates' ? <PlateCalc t={t} /> : <MacroRef t={t} />}
      </ScrollView>
    </SafeAreaView>
  );
}
