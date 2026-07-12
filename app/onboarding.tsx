// Post-sign-up onboarding (Phase 1). Role → (client) photo → goal → diet →
// starting stats, writing into the shared client data so the app is tailored
// from the first screen. Reached via replace from the Welcome screen after
// creating an account.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../src/ui/components';
import { useClientData } from '../src/ui/clientData';
import type { Goal, Diet } from '../src/lib/types';
import { Icon } from '../src/ui/Icon';

const GOALS: { id: Goal; label: string; icon: string }[] = [
  { id: 'fatloss', label: 'Fat Loss', icon: '' },
  { id: 'tone', label: 'Tone', icon: '' },
  { id: 'muscle', label: 'Build Muscle', icon: '' },
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
  const [weight, setWeight] = useState(String(Math.round(cd.weightKg)));
  const [height, setHeight] = useState(String(cd.heightCm));

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
    router.replace('/(client)/dashboard');
  };

  const next = () => {
    if (role !== 'client') { router.replace(role === 'trainer' ? '/(trainer)/dashboard' : '/(owner)/dashboard'); return; }
    if (step >= clientSteps - 1) { finish(); return; }
    setStep(step + 1);
  };
  const back = () => { if (step > 0) setStep(step - 1); };

  const Btn = ({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={{ flex: primary ? 2 : 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center', backgroundColor: primary ? t.brand : t.surface2, borderWidth: 1, borderColor: primary ? t.brand : t.ring }}>
      <Text style={{ color: primary ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 30, paddingBottom: 30, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {/* progress */}
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surface3, overflow: 'hidden', marginBottom: 28 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.brand, width: pct + '%' }} />
        </View>

        {step === 0 && (
          <View>
            <Text style={{ color: t.ink, fontSize: 26, fontWeight: '800', marginBottom: 6 }}>Welcome to Repple</Text>
            <Text style={{ color: t.ink3, fontSize: 15, marginBottom: 24 }}>How will you use the app?</Text>
            {([['client', 'me', 'I\'m training', 'Follow a program, meals & progress'], ['trainer', 'people', 'I\'m a coach', 'Manage clients & schedule'], ['owner', 'grid', 'I run the platform', 'Trainers, billing & white-label']] as const).map(([id, icon, title, sub]) => {
              const on = role === id;
              return (
                <Pressable key={id} onPress={() => setRole(id as any)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16, marginBottom: 12, backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                  <Icon name={icon as any} size={24} color={on ? t.brandInk : t.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: on ? t.brandInk : t.ink, fontWeight: '800', fontSize: 16 }}>{title}</Text>
                    <Text style={{ color: on ? t.brandInk : t.ink3, fontSize: 12, opacity: on ? 0.85 : 1 }}>{sub}</Text>
                  </View>
                  {on ? <Icon name="check" size={16} color={t.brandInk} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}

        {role === 'client' && step === 1 && (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginBottom: 6, alignSelf: 'flex-start' }}>Add a photo</Text>
            <Text style={{ color: t.ink3, fontSize: 15, marginBottom: 24, alignSelf: 'flex-start' }}>Optional — helps your coach recognise you.</Text>
            {cd.photo ? <Image source={{ uri: cd.photo }} style={{ width: 120, height: 120, borderRadius: 60, marginBottom: 20 }} /> : <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}><Icon name="camera" size={40} color={t.ink3} /></View>}
            <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
              <Btn label="Upload" onPress={() => pickPhoto(false)} />
              <Btn label="Take Photo" onPress={() => pickPhoto(true)} />
            </View>
          </View>
        )}

        {role === 'client' && step === 2 && (
          <View>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginBottom: 6 }}>What's your goal?</Text>
            <Text style={{ color: t.ink3, fontSize: 15, marginBottom: 24 }}>We tailor workouts & meals to this.</Text>
            {GOALS.map((g) => {
              const on = cd.goal === g.id;
              return (
                <Pressable key={g.id} onPress={() => cd.setGoal(g.id)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 16, marginBottom: 12, backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                  <Text style={{ flex: 1, color: on ? t.brandInk : t.ink, fontWeight: '800', fontSize: 16 }}>{g.label}</Text>
                  {on ? <Icon name="check" size={16} color={t.brandInk} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}

        {role === 'client' && step === 3 && (
          <View>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginBottom: 6 }}>Diet preference</Text>
            <Text style={{ color: t.ink3, fontSize: 15, marginBottom: 24 }}>Your meal plan is built around this.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {DIETS.map((d) => {
                const on = cd.diet === d.id;
                return (
                  <Pressable key={d.id} onPress={() => cd.setDiet(d.id)} accessibilityRole="button" style={{ paddingHorizontal: 18, paddingVertical: 12, borderRadius: 20, backgroundColor: on ? t.brand : t.surface, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                    <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 14 }}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {role === 'client' && step === 4 && (
          <View>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginBottom: 6 }}>Starting stats</Text>
            <Text style={{ color: t.ink3, fontSize: 15, marginBottom: 24 }}>So we can set your calorie & macro targets.</Text>
            <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Weight (kg)</Text>
            <TextInput value={weight} onChangeText={setWeight} keyboardType="numeric" placeholderTextColor={t.ink3} accessibilityLabel="Weight in kilograms" style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, marginBottom: 16 }} />
            <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Height (cm)</Text>
            <TextInput value={height} onChangeText={setHeight} keyboardType="numeric" placeholderTextColor={t.ink3} accessibilityLabel="Height in centimetres" style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 }} />
            <Text style={{ color: t.ink3, fontSize: 12, marginTop: 14 }}>You can refine these any time in your profile, and an InBody scan updates them automatically.</Text>
          </View>
        )}

        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 28 }}>
          {step > 0 ? <Btn label="Back" onPress={back} /> : null}
          <Btn label={role !== 'client' ? 'Enter Portal' : step >= clientSteps - 1 ? 'Finish' : step === 1 ? 'Continue' : 'Continue'} onPress={next} primary />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
