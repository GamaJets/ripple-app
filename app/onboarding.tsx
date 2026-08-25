// Post-sign-up onboarding (Phase 1). Role → (client) photo → goal → diet →
// starting stats, writing into the shared client data so the app is tailored
// from the first screen. Reached via replace from the Welcome screen after
// creating an account.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every step, route and write is unchanged — only the
// presentation moved: no hero (nothing is measured yet), option rows lost
// their 1px borders for a fill, and the footer buttons are <Cta>/<Ghost>.
//
// Also removed: the Starting-stats step opened with the weight and height
// fields pre-filled from the client-data DEFAULTS (70 kg / 170 cm) — numbers
// nobody had entered, presented as the user's own, and written to their
// profile verbatim if they just tapped Finish. Both fields now start empty and
// are only saved when the user actually types a value.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../src/ui/components';
import { useClientData } from '../src/ui/clientData';
import type { Goal, Diet } from '../src/lib/types';
import { Icon } from '../src/ui/Icon';
import { Cta, Ghost } from '../src/ui/kit';
import { sp, layout, radius, type as ty } from '../src/theme/scale';

const GOALS: { id: Goal; label: string }[] = [
  { id: 'fatloss', label: 'Fat Loss' },
  { id: 'tone', label: 'Tone' },
  { id: 'muscle', label: 'Build Muscle' },
];
const DIETS: { id: Diet; label: string }[] = [
  { id: 'meat', label: 'Meat' }, { id: 'vegetarian', label: 'Vegetarian' }, { id: 'vegan', label: 'Vegan' }, { id: 'paleo', label: 'Paleo' }, { id: 'keto', label: 'Keto' },
];

export default function Onboarding() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<'client' | 'trainer' | 'owner'>('client');
  // Empty, not pre-filled: these are the user's own numbers or they're nothing.
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [cmode, setCmode] = useState<'online' | 'inperson' | 'solo'>('online');

  // Steps: 0 role. For client: 1 photo, 2 goal, 3 diet, 4 stats. Others finish at role.
  const clientSteps = 5;
  const totalSteps = role === 'client' ? clientSteps : 1;
  const pct = Math.round(((step + 1) / totalSteps) * 100);

  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow ' + (fromCamera ? 'camera' : 'photo library') + ' access.'); return; }
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (!res.canceled && res.assets && res.assets[0]) cd.setPhoto(res.assets[0].uri);
  };

  const finish = () => {
    const w = parseFloat(weight); if (w > 20 && w < 400) cd.setWeightKg(w);
    const h = parseFloat(height); if (h > 80 && h < 260) cd.setHeightCm(h);
    cd.setCoachingMode(cmode);
    // Connect-a-coach on first run: coached clients land on Find a Trainer so they
    // can pick a coach right away; solo clients go straight to their dashboard.
    router.replace(cmode === 'solo' ? '/(client)/dashboard' : '/(client)/trainers');
  };

  const next = () => {
    if (role !== 'client') { router.replace(role === 'trainer' ? '/(trainer)/dashboard' : '/(owner)/dashboard'); return; }
    if (step >= clientSteps - 1) { finish(); return; }
    setStep(step + 1);
  };
  const back = () => { if (step > 0) setStep(step - 1); };

  const lab = { ...ty.caption, color: t.ink2, marginBottom: 6 } as const;
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;

  /** One selectable option row: quiet fill when off, brand when on. */
  const Option = ({ on, onPress, label, note, icon, mark }: {
    on: boolean; onPress: () => void; label: string; note?: string;
    icon?: 'me' | 'people' | 'grid'; mark?: 'check' | 'radio';
  }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={note ? `${label}. ${note}` : label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, borderRadius: radius.sm, padding: sp.lg, marginBottom: sp.sm, backgroundColor: on ? t.brand : t.surface2 }}>
      {mark === 'radio' ? (
        <View style={{ width: 20, height: 20, borderRadius: radius.pill, borderWidth: 2, borderColor: on ? t.brandInk : t.ink3, alignItems: 'center', justifyContent: 'center' }}>
          {on ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: t.brandInk }} /> : null}
        </View>
      ) : null}
      {icon ? <Icon name={icon} size={22} color={on ? t.brandInk : t.brand} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink }}>{label}</Text>
        {note ? <Text style={{ ...ty.caption, color: on ? t.brandInk : t.ink3, marginTop: 2, opacity: on ? 0.85 : 1 }}>{note}</Text> : null}
      </View>
      {mark === 'check' && on ? <Icon name="check" size={16} color={t.brandInk} /> : null}
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xxl, paddingBottom: sp.xxl, flexGrow: 1 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {/* progress */}
        <View accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of ${totalSteps}`}
          style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, overflow: 'hidden', marginBottom: sp.xl }}>
          <View style={{ height: 3, borderRadius: 2, backgroundColor: t.brand, width: `${pct}%` }} />
        </View>

        {step === 0 && (
          <View>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Step {step + 1} of {totalSteps}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Welcome to Repple</Text>
            <Text style={{ ...ty.body, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>How will you use the app?</Text>
            {([['client', 'me', 'I\'m training', 'Follow a program, meals & progress'], ['trainer', 'people', 'I\'m a coach', 'Manage clients & schedule'], ['owner', 'grid', 'I run the platform', 'Trainers, billing & white-label']] as const).map(([id, icon, title, sub]) => (
              <Option key={id} on={role === id} onPress={() => setRole(id as any)} label={title} note={sub} icon={icon} mark="check" />
            ))}
          </View>
        )}

        {role === 'client' && step === 1 && (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ ...ty.micro, color: t.ink3, alignSelf: 'flex-start' }}>Step {step + 1} of {totalSteps}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5, alignSelf: 'flex-start' }}>Add a photo</Text>
            <Text style={{ ...ty.body, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl, alignSelf: 'flex-start' }}>Optional — helps your coach recognise you.</Text>
            {cd.photo ? <Image source={{ uri: cd.photo }} style={{ width: 120, height: 120, borderRadius: radius.pill, marginBottom: sp.xl }} /> : <View style={{ width: 120, height: 120, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: sp.xl }}><Icon name="camera" size={40} color={t.ink3} /></View>}
            <View style={{ flexDirection: 'row', gap: sp.sm, alignSelf: 'stretch' }}>
              <View style={{ flex: 1 }}><Ghost label="Upload" onPress={() => pickPhoto(false)} /></View>
              <View style={{ flex: 1 }}><Ghost label="Take Photo" onPress={() => pickPhoto(true)} /></View>
            </View>
          </View>
        )}

        {role === 'client' && step === 2 && (
          <View>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Step {step + 1} of {totalSteps}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>What's your goal?</Text>
            <Text style={{ ...ty.body, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>We tailor workouts & meals to this.</Text>
            {GOALS.map((g) => (
              <Option key={g.id} on={cd.goal === g.id} onPress={() => cd.setGoal(g.id)} label={g.label} mark="check" />
            ))}
          </View>
        )}

        {role === 'client' && step === 3 && (
          <View>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Step {step + 1} of {totalSteps}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Diet preference</Text>
            <Text style={{ ...ty.body, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>Your meal plan is built around this.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {DIETS.map((d) => {
                const on = cd.diet === d.id;
                return (
                  <Pressable key={d.id} onPress={() => cd.setDiet(d.id)} accessibilityRole="button" accessibilityLabel={d.label} style={{ paddingHorizontal: sp.lg, paddingVertical: sp.md, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {role === 'client' && step === 4 && (
          <View>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Step {step + 1} of {totalSteps}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Starting stats</Text>
            <Text style={{ ...ty.body, color: t.ink3, marginTop: sp.sm, marginBottom: sp.xl }}>So we can set your calorie & macro targets.</Text>
            <Text style={lab}>Weight (kg)</Text>
            <TextInput value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} accessibilityLabel="Weight in kilograms" style={{ ...inp, marginBottom: sp.lg }} />
            <Text style={lab}>Height (cm)</Text>
            <TextInput value={height} onChangeText={setHeight} keyboardType="numeric" placeholder="cm" placeholderTextColor={t.ink3} accessibilityLabel="Height in centimetres" style={inp} />
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>You can add or refine these any time in your profile, and an InBody scan updates them automatically.</Text>
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xl, marginBottom: sp.sm }}>How are you coaching?</Text>
            {([['online', 'Online coach', 'Remote coaching & messaging'], ['inperson', 'In-person coach', 'Coach trains you in person'], ['solo', 'On my own', 'Self-managed with AI & tools']] as const).map(([id, label, note]) => (
              <Option key={id} on={cmode === id} onPress={() => setCmode(id)} label={label} note={note} mark="radio" />
            ))}
          </View>
        )}

        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.xl }}>
          {step > 0 ? <View style={{ flex: 1 }}><Ghost label="Back" onPress={back} /></View> : null}
          <View style={{ flex: 2 }}>
            <Cta wide onPress={next} label={role !== 'client' ? 'Enter Portal' : step >= clientSteps - 1 ? 'Finish' : step === 1 ? 'Continue' : 'Continue'} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
