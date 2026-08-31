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
//
// TF-37: those fields were also labelled "kg" and "cm" and stored what was
// typed unchanged. This is the first thing a new client ever types, so a client
// who thinks in pounds began their account with a body that was never theirs —
// and unlike a display bug it is the stored record that was wrong, which every
// calorie target, every goal and every coach view is then built from. Weight
// and height now go through src/lib/units.ts in the unit the account reads in.
// Body fat stays exactly as it was: a percentage is a percentage in every unit
// system and there is nothing to convert.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Cta, Ghost, Field } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightToKg, heightToCm, heightIn, weightIn, heightParts, kgToLb, cmToIn } from '../../src/lib/units';
import { dayLabel } from '../../src/lib/bodyFigures';
import { ALLERGENS, type Allergen } from '../../src/lib/meals';
import type { Goal, Diet } from '../../src/lib/types';
import { INJURY_AREAS, newInjuryId } from '../../src/lib/injuries';

export const ONBOARD_KEY = 'repple.onboarded';

// The plausible range for a human, in the metric this app stores. Each bound is
// converted into whichever unit the client is typing in before it is applied,
// because a range checked against a raw imperial figure is not a range at all:
// 180 lb sits comfortably inside "20 to 400" and would have been waved through
// as 180 kg.
const MIN_KG = 20;
const MAX_KG = 400;
const MIN_CM = 80;
const MAX_CM = 260;

const GOALS: { id: Goal; label: string; sub: string }[] = [
  { id: 'fatloss', label: 'Lose Fat', sub: 'Lean out, keep muscle' },
  { id: 'tone', label: 'Tone Up', sub: 'Recomp — a bit of both' },
  { id: 'muscle', label: 'Build Muscle', sub: 'Add size and strength' },
];
const DIETS: { id: Diet; label: string }[] = [
  { id: 'meat', label: 'Meat' }, { id: 'vegetarian', label: 'Vegetarian' }, { id: 'vegan', label: 'Vegan' },
  { id: 'paleo', label: 'Paleo' }, { id: 'keto', label: 'Keto' },
];

export default function Onboarding() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  // Read before the fields are initialised, because a useState initialiser runs
  // once and cannot wait for a hook declared below it.
  const stInit = useSettings();
  const wuInit = stInit.weightUnit;
  const luInit = stInit.lengthUnit;
  // The client's own measured figures. weightKg / bodyFatPct are the most
  // recent of {scan, weigh-in} and are null when nothing has been measured.
  const fromScan = { weightKg: c.weightKg, bodyFatPct: c.bodyFatPct };
  const scanHeight = (() => {
    if (c.heightCm == null) return { whole: '', inches: '' };
    if (luInit === 'in') {
      const parts = heightParts(c.heightCm);
      return parts ? { whole: String(parts.feet), inches: String(parts.inches) } : { whole: '', inches: '' };
    }
    return { whole: String(Math.round(c.heightCm)), inches: '' };
  })();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(c.name);
  const [goal, setGoal] = useState<Goal>(c.goal);
  // Pre-filled from a MEASUREMENT, and blank otherwise.
  //
  // These fields were emptied for a good reason: they used to read back out of
  // ClientDataProvider, whose weight/height/body-fat were placeholder fallbacks
  // for a new account (70kg / 170cm / 20%, plus a hardcoded `|| 175`). Tapping
  // straight through wrote that invented body to the profile, and every calorie
  // and macro target was computed from it.
  //
  // What changed is the provider, not the argument. It no longer invents a
  // body: weight and body fat are the most recent of {InBody scan, hand-typed
  // weigh-in} and are NULL when neither exists. So a figure here is now either
  // something somebody measured or nothing at all — and asking a client to
  // re-type a number off a scan the app already holds is its own small insult.
  //
  // Still blank when there is nothing. The rule this screen exists to protect
  // is that a value only ever reaches the profile because a person put it
  // there, and a prefill from a scan they stood on satisfies that.
  const scanW = fromScan.weightKg == null ? '' : String(Math.round((weightIn(fromScan.weightKg, wuInit) ?? 0) * 10) / 10);
  const scanBf = fromScan.bodyFatPct == null ? '' : String(Math.round(fromScan.bodyFatPct * 10) / 10);
  const [weight, setWeight] = useState(scanW);
  const [height, setHeight] = useState(scanHeight.whole);    // centimetres, or whole feet
  const [heightInVal, setHeightInVal] = useState(scanHeight.inches); // inches, imperial only
  const [bf, setBf] = useState(scanBf);

  // Whether the boxes arrived with anything in them, and what to call the
  // source. `scans` is oldest-first, so the newest is the last element.
  const latestScan = c.scans.length ? c.scans[c.scans.length - 1] : null;
  const prefilled = scanW !== '' || scanBf !== '' || scanHeight.whole !== '';
  const lastScanLabel = latestScan && (scanW !== '' || scanBf !== '')
    ? `${latestScan.source || 'scan'}, ${dayLabel(latestScan.takenAt)}`
    : null;

  // The units this account reads in. Nothing on this screen offers to change
  // them — a first run is not the place for a settings control, and Settings
  // and the profile sheet both already own that toggle.
  const st = stInit;
  const wu = wuInit;
  const lu = luInit;

  // The same bounds, said in the unit being typed. Rounded to whole units so
  // the comparison is against a number of the same shape as the one in the box.
  const minWeight = wu === 'lb' ? Math.round(kgToLb(MIN_KG)) : MIN_KG;
  const maxWeight = wu === 'lb' ? Math.round(kgToLb(MAX_KG)) : MAX_KG;
  const minHeight = lu === 'in' ? Math.round(cmToIn(MIN_CM)) : MIN_CM;
  const maxHeight = lu === 'in' ? Math.round(cmToIn(MAX_CM)) : MAX_CM;
  const [diet, setDiet] = useState<Diet>(c.diet);
  const [avoid, setAvoid] = useState<Allergen[]>(c.avoid || []);
  const [injAreas, setInjAreas] = useState<string[]>([]);

  const finish = async () => {
    if (name.trim()) c.setName(name.trim());
    c.setGoal(goal);
    // Judge the figure the client actually typed against a bound on the same
    // scale, then store the metric it converts to. Both steps matter: the check
    // has to see pounds as pounds, and the record has to receive kilograms.
    const w = parseFloat(weight);
    if (w > minWeight && w < maxWeight) { const kg = weightToKg(weight, wu); if (kg != null) c.setWeightKg(kg); }
    // Height comes from one box in metric and two in imperial, so the typed
    // magnitude is recovered from the centimetres rather than re-parsed: feet
    // and inches are only a plausible height taken together.
    const cm = heightToCm(height, lu, heightInVal);
    const h = heightIn(cm, lu);
    if (cm != null && h != null && h > minHeight && h < maxHeight) c.setHeightCm(cm);
    // Body fat is a percentage and is stored exactly as typed. There is no such
    // thing as an imperial percentage, and converting one would be nonsense.
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
        <Text style={{ ...ty.title, color: t.ink }}>Let's Personalise Repple</Text>
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
        <Text style={{ ...ty.title, color: t.ink }}>Your Stats</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: prefilled ? sp.md : sp.xl }}>Used to set your calorie and macro targets. Leave anything you don't know blank — you can add it later.</Text>
        {/* Said out loud when the boxes arrive with numbers already in them.
            A field that fills itself and does not say why reads as the app
            guessing, and the whole reason these were blank for a while is that
            it used to be guessing. Naming the source also tells the client
            which figure to correct if their scan is out of date. */}
        {prefilled ? (
          <Text style={{ ...ty.label, color: t.ink2, marginBottom: sp.xl }}>
            Filled in from your most recent measurement{lastScanLabel ? ` — ${lastScanLabel}` : ''}. Change anything that has moved on.
          </Text>
        ) : null}
        {/* The units were placeholders, and `prefilled` above is the case that
            makes that fatal: the boxes arrive holding the last scan's figures,
            so the one screen that decides every calorie target the client ever
            sees showed three bare numerals with no unit on any of them. */}
        <Field label="Weight" hint={wu} style={{ marginBottom: sp.lg }} a11y={wu === 'kg' ? 'Weight in kilograms' : 'Weight in pounds'}>
          <TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" style={inp} />
        </Field>
        {/* Two boxes in imperial, one in metric, as in the profile sheet. A
            single box asking for a height "in inches" is a box nobody who
            thinks in feet knows how to fill in — they would type 5.10 and mean
            five foot ten. */}
        <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg, alignItems: 'flex-end' }}>
          <Field label="Height" hint={lu === 'cm' ? 'cm' : 'ft'} a11y={lu === 'cm' ? 'Height in centimetres' : 'Height, feet'}>
            <TextInput value={height} onChangeText={setHeight} keyboardType="number-pad" style={inp} />
          </Field>
          {lu === 'in' ? (
            <Field label="Inches" a11y="Height, inches">
              <TextInput value={heightInVal} onChangeText={setHeightInVal} keyboardType="number-pad" style={inp} />
            </Field>
          ) : null}
        </View>
        <Field label="Body fat" hint="% · optional" a11y="Body fat percentage">
          <TextInput value={bf} onChangeText={setBf} keyboardType="decimal-pad" style={inp} />
        </Field>
      </View>
    ),
    // 2 — diet + allergens
    (
      <View>
        <Text style={{ ...ty.title, color: t.ink }}>How You Eat</Text>
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
        <Text style={{ ...ty.title, color: t.ink }}>Any Injuries?</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.sm }}>Tell us what to train around. Your coach and your plan will avoid loading these areas and offer safer swaps.</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>Guidance only, not medical advice — see a professional for pain or a diagnosis.</Text>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Tap any that apply</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {INJURY_AREAS.filter((a) => a.id !== 'other').map((a) => { const on = injAreas.includes(a.id); return (
            <Pill key={a.id} on={on} label={a.label} onPress={() => setInjAreas((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))} />); })}
        </View>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{injAreas.length > 0 ? 'You can add severity, notes, and mark these recovered anytime in Me › Injuries & Limitations.' : 'No injuries? Leave this blank — you can add them later in Me › Injuries.'}</Text>
      </View>
    ),
  ];

  const last = step === steps.length - 1;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', gap: 5, paddingHorizontal: layout.gutter, paddingTop: sp.md }}>
        {steps.map((_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? t.brand : t.surface3 }} />)}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: sp.xl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
        {steps[step]}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: layout.gutter, paddingBottom: sp.lg }}>
        {step > 0 ? (
          <Ghost label="Back" onPress={() => setStep(step - 1)} />
        ) : (
          <Ghost label="Skip" onPress={skip} />
        )}
        <View style={{ flex: 1 }}>
          <Cta label={last ? 'Start Training' : 'Continue'} onPress={() => (last ? finish() : setStep(step + 1))} wide />
        </View>
      </View>
    </SafeAreaView>
  );
}
