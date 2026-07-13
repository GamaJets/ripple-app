// Client onboarding — a short first-run intake that seeds the plan (goal, stats,
// diet, allergens). Writes straight into clientData so Meals, Train and targets
// are personalised from day one, then marks onboarding complete. Reachable from
// the dashboard "personalise" banner; skippable.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { useClientData } from '../../src/ui/clientData';
import { ALLERGENS, type Allergen } from '../../src/lib/meals';
import type { Goal, Diet } from '../../src/lib/types';
import { INJURY_AREAS, newInjuryId } from '../../src/lib/injuries';

export const ONBOARD_KEY = 'repple.onboarded';

const GOALS: { id: Goal; label: string; sub: string }[] = [
  { id: 'fatloss', label: 'Lose fat', sub: 'Lean out, keep muscle' },
  { id: 'tone', label: 'Tone up', sub: 'Recomp — a bit of both' },
  { id: 'muscle', label: 'Build muscle', sub: 'Add size and strength' },
];
const DIETS: { id: Diet; label: string }[] = [
  { id: 'meat', label: 'Meat' }, { id: 'vegetarian', label: 'Vegetarian' }, { id: 'vegan', label: 'Vegan' },
  { id: 'paleo', label: 'Paleo' }, { id: 'keto', label: 'Keto' },
];

export default function Onboarding() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(c.name && c.name !== 'Alex Carter' ? c.name : '');
  const [goal, setGoal] = useState<Goal>(c.goal);
  const [weight, setWeight] = useState(String(Math.round(c.weightKg)));
  const [height, setHeight] = useState(String(c.heightCm || 175));
  const [bf, setBf] = useState(String(Math.round(c.bodyFatPct)));
  const [diet, setDiet] = useState<Diet>(c.diet);
  const [avoid, setAvoid] = useState<Allergen[]>(c.avoid || []);
  const [injAreas, setInjAreas] = useState<string[]>([]);

  const finish = async () => {
    if (name.trim()) c.setName(name.trim());
    c.setGoal(goal);
    const w = parseFloat(weight); if (w > 0) c.setWeightKg(w);
    const h = parseInt(height, 10); if (h > 0) c.setHeightCm(h);
    const b = parseFloat(bf); if (b > 0) c.setBodyFat(b);
    c.setDiet(diet);
    c.setAvoid(avoid);
    injAreas.forEach((area) => c.addInjury({ id: newInjuryId(), area, severity: 'moderate', status: 'active', at: new Date().toISOString() }));
    try { await AsyncStorage.setItem(ONBOARD_KEY, '1'); } catch { /* ignore */ }
    router.replace('/(client)/dashboard');
  };
  const skip = async () => { try { await AsyncStorage.setItem(ONBOARD_KEY, '1'); } catch { /* ignore */ } router.replace('/(client)/dashboard'); };

  const Chip = ({ on, label, sub, onPress }: { on: boolean; label: string; sub?: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={{ backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : t.ring, borderRadius: 14, padding: 15, marginBottom: 10 }}>
      <Text style={{ color: on ? t.brandInk : t.ink, fontWeight: '800', fontSize: 15 }}>{label}</Text>
      {sub ? <Text style={{ color: on ? t.brandInk : t.ink3, fontSize: 12, marginTop: 2, opacity: on ? 0.85 : 1 }}>{sub}</Text> : null}
    </Pressable>
  );
  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17 } as const;

  const steps = [
    // 0 — welcome + name + goal
    (
      <View>
        <Text style={{ color: t.ink, fontSize: 27, fontWeight: '800', fontFamily: 'Georgia' }}>Let's personalise Repple</Text>
        <Text style={{ color: t.ink3, fontSize: 14, marginTop: 4, marginBottom: 20 }}>A minute now tailors your workouts and meals to you.</Text>
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Your name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="First name" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 18 }]} />
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Your main goal</Text>
        {GOALS.map((g) => <Chip key={g.id} on={goal === g.id} label={g.label} sub={g.sub} onPress={() => setGoal(g.id)} />)}
      </View>
    ),
    // 1 — stats
    (
      <View>
        <Text style={{ color: t.ink, fontSize: 27, fontWeight: '800', fontFamily: 'Georgia' }}>Your stats</Text>
        <Text style={{ color: t.ink3, fontSize: 14, marginTop: 4, marginBottom: 20 }}>Used to set your calorie and macro targets. Estimates are fine — refine later.</Text>
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Weight (kg)</Text>
        <TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="80" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 14 }]} />
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Height (cm)</Text>
        <TextInput value={height} onChangeText={setHeight} keyboardType="number-pad" placeholder="175" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 14 }]} />
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>Body fat % (optional)</Text>
        <TextInput value={bf} onChangeText={setBf} keyboardType="decimal-pad" placeholder="20" placeholderTextColor={t.ink3} style={inp} />
      </View>
    ),
    // 2 — diet + allergens
    (
      <View>
        <Text style={{ color: t.ink, fontSize: 27, fontWeight: '800', fontFamily: 'Georgia' }}>How you eat</Text>
        <Text style={{ color: t.ink3, fontSize: 14, marginTop: 4, marginBottom: 20 }}>Your meal plan is built around this.</Text>
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Diet style</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {DIETS.map((d) => (<Pressable key={d.id} onPress={() => setDiet(d.id)} style={{ paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, backgroundColor: diet === d.id ? t.brand : t.surface, borderWidth: 1, borderColor: diet === d.id ? t.brand : t.ring }}><Text style={{ color: diet === d.id ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 14 }}>{d.label}</Text></Pressable>))}
        </View>
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Anything to avoid?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ALLERGENS.map((al) => { const on = avoid.includes(al.id); return (<Pressable key={al.id} onPress={() => setAvoid(on ? avoid.filter((x) => x !== al.id) : [...avoid, al.id])} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: on ? t.crit : t.surface, borderWidth: 1, borderColor: on ? t.crit : t.ring }}><Text style={{ color: on ? '#fff' : t.ink2, fontWeight: '700', fontSize: 13 }}>{al.label}</Text></Pressable>); })}
        </View>
      </View>
    ),
    // 3 — injuries / limitations
    (
      <View>
        <Text style={{ color: t.ink, fontSize: 27, fontWeight: '800', fontFamily: 'Georgia' }}>Any injuries?</Text>
        <Text style={{ color: t.ink3, fontSize: 14, marginTop: 4, marginBottom: 8 }}>Tell us what to train around. Your coach and your plan will avoid loading these areas and offer safer swaps.</Text>
        <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 18 }}>Guidance only, not medical advice — see a professional for pain or a diagnosis.</Text>
        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Tap any that apply</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {INJURY_AREAS.filter((a) => a.id !== 'other').map((a) => { const on = injAreas.includes(a.id); return (
            <Pressable key={a.id} onPress={() => setInjAreas((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: on ? t.s3 : t.surface, borderWidth: 1, borderColor: on ? t.s3 : t.ring }}>
              <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 13 }}>{a.label}</Text>
            </Pressable>); })}
        </View>
        <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 16 }}>{injAreas.length > 0 ? 'You can add severity, notes, and mark these recovered anytime in Me › Injuries & limitations.' : 'No injuries? Leave this blank — you can add them later in Me › Injuries.'}</Text>
      </View>
    ),
  ];

  const last = step === steps.length - 1;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', gap: 5, paddingHorizontal: 18, paddingTop: 12 }}>
        {steps.map((_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? t.brand : t.surface3 }} />)}
      </View>
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        {steps[step]}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 12, padding: 18 }}>
        {step > 0 ? (
          <Pressable onPress={() => setStep(step - 1)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 22, alignItems: 'center' }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>Back</Text></Pressable>
        ) : (
          <Pressable onPress={skip} style={{ paddingVertical: 16, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.ink3, fontWeight: '700', fontSize: 14 }}>Skip</Text></Pressable>
        )}
        <Pressable onPress={() => (last ? finish() : setStep(step + 1))} style={{ flex: 1, backgroundColor: t.brand, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>{last ? 'Start training' : 'Continue'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
