// Client onboarding — a short first-run intake that seeds the plan (goal, stats,
// diet, allergens). Writes straight into clientData so Meals, Train and targets
// are personalised from day one, then marks onboarding complete. Reachable from
// the dashboard "personalise" banner; skippable.
//
// Re-skinned onto the scale (`src/theme/scale`) and the kit's controls: three
// weights, no raw type sizes and no serif display face. Steps, order, writes and both routes
// are unchanged.
//
// Honesty fix (same class as the one already fixed in app/onboarding.tsx): the
// stats step used to arrive pre-filled with weight / height / body-fat read
// back out of ClientDataProvider — which, for a brand-new account, are the
// provider's placeholder fallbacks (70 kg, 170 cm, 20%), plus a hardcoded
// `|| 175` for height. Tapping straight through wrote that invented body to
// the profile, and every calorie and macro target downstream was computed from
// it. The three fields now start empty and are only written when the user
// actually types a plausible figure.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
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
  const [name, setName] = useState(c.name);
  const [goal, setGoal] = useState<Goal>(c.goal);
  // Blank, not pre-filled: nothing here is known until the user types it.
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [bf, setBf] = useState('');
  const [diet, setDiet] = useState<Diet>(c.diet);
  const [avoid, setAvoid] = useState<Allergen[]>(c.avoid || []);
  const [injAreas, setInjAreas] = useState<string[]>([]);

  const finish = async () => {
    if (name.trim()) c.setName(name.trim());
    c.setGoal(goal);
    const w = parseFloat(weight); if (w > 20 && w < 400) c.setWeightKg(w);
    const h = parseFloat(height); if (h > 80 && h < 260) c.setHeightCm(h);
    const b = parseFloat(bf); if (b > 3 && b < 70) c.setBodyFat(b);
    c.setDiet(diet);
    c.setAvoid(avoid);
    injAreas.forEach((area) => c.addInjury({ id: newInjuryId(), area, severity: 'moderate', status: 'active', at: new Date().toISOString() }));
    try { await AsyncStorage.setItem(ONBOARD_KEY, '1'); } catch { /* ignore */ }
    router.replace('/(client)/dashboard');
  };
  const skip = async () => { try { await AsyncStorage.setItem(ONBOARD_KEY, '1'); } catch { /* ignore */ } router.replace('/(client)/dashboard'); };

  const Chip = ({ on, label, sub, onPress }: { on: boolean; label: string; sub?: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.sm, padding: sp.lg, marginBottom: sp.sm }}>
      <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink }}>{label}</Text>
      {sub ? <Text style={{ ...ty.caption, color: on ? t.brandInk : t.ink3, marginTop: 2, opacity: on ? 0.85 : 1 }}>{sub}</Text> : null}
    </Pressable>
  );
  const Pill = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
  const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md } as const;

  const steps = [
    // 0 — welcome + name + goal
    (
      <View>
        <Text style={{ ...ty.title, color: t.ink }}>Let's personalise Repple</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.xl }}>A minute now tailors your workouts and meals to you.</Text>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Your name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="First name" placeholderTextColor={t.ink3} autoCapitalize="words" style={[inp, { marginBottom: sp.xl }]} />
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Your main goal</Text>
        {GOALS.map((g) => <Chip key={g.id} on={goal === g.id} label={g.label} sub={g.sub} onPress={() => setGoal(g.id)} />)}
      </View>
    ),
    // 1 — stats
    (
      <View>
        <Text style={{ ...ty.title, color: t.ink }}>Your stats</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.xl }}>Used to set your calorie and macro targets. Leave anything you don't know blank — you can add it later.</Text>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>Weight</Text>
        <TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="kg" placeholderTextColor={t.ink3} accessibilityLabel="Weight in kilograms" style={[inp, { marginBottom: sp.lg }]} />
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>Height</Text>
        <TextInput value={height} onChangeText={setHeight} keyboardType="number-pad" placeholder="cm" placeholderTextColor={t.ink3} accessibilityLabel="Height in centimetres" style={[inp, { marginBottom: sp.lg }]} />
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>Body fat % (optional)</Text>
        <TextInput value={bf} onChangeText={setBf} keyboardType="decimal-pad" placeholder="%" placeholderTextColor={t.ink3} accessibilityLabel="Body fat percentage" style={inp} />
      </View>
    ),
    // 2 — diet + allergens
    (
      <View>
        <Text style={{ ...ty.title, color: t.ink }}>How you eat</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.xl }}>Your meal plan is built around this.</Text>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Diet style</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.xl }}>
          {DIETS.map((d) => <Pill key={d.id} on={diet === d.id} label={d.label} onPress={() => setDiet(d.id)} />)}
        </View>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Anything to avoid?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {ALLERGENS.map((al) => { const on = avoid.includes(al.id); return (
            <Pill key={al.id} on={on} label={al.label} onPress={() => setAvoid(on ? avoid.filter((x) => x !== al.id) : [...avoid, al.id])} />); })}
        </View>
      </View>
    ),
    // 3 — injuries / limitations
    (
      <View>
        <Text style={{ ...ty.title, color: t.ink }}>Any injuries?</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.sm }}>Tell us what to train around. Your coach and your plan will avoid loading these areas and offer safer swaps.</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>Guidance only, not medical advice — see a professional for pain or a diagnosis.</Text>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Tap any that apply</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {INJURY_AREAS.filter((a) => a.id !== 'other').map((a) => { const on = injAreas.includes(a.id); return (
            <Pill key={a.id} on={on} label={a.label} onPress={() => setInjAreas((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))} />); })}
        </View>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{injAreas.length > 0 ? 'You can add severity, notes, and mark these recovered anytime in Me › Injuries & limitations.' : 'No injuries? Leave this blank — you can add them later in Me › Injuries.'}</Text>
      </View>
    ),
  ];

  const last = step === steps.length - 1;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', gap: 5, paddingHorizontal: layout.gutter, paddingTop: sp.md }}>
        {steps.map((_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? t.brand : t.surface3 }} />)}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: sp.xl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {steps[step]}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: layout.gutter, paddingBottom: sp.lg }}>
        {step > 0 ? (
          <Ghost label="Back" onPress={() => setStep(step - 1)} />
        ) : (
          <Ghost label="Skip" onPress={skip} />
        )}
        <View style={{ flex: 1 }}>
          <Cta label={last ? 'Start training' : 'Continue'} onPress={() => (last ? finish() : setStep(step + 1))} wide />
        </View>
      </View>
    </SafeAreaView>
  );
}
