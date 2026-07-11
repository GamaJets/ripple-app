// My Profile — hub: DOB wheel picker + unit toggles (cm/in, kg/lb), wired to the
// shared client context so a weight edit here recalculates macros everywhere,
// plus links out to every secondary screen (Devices, Food Log, Library, …).
import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { ageFromDob } from '../../src/lib/age';
import { macrosFor } from '../../src/lib/nutrition';
import { useClientData } from '../../src/ui/clientData';
import type { Goal } from '../../src/lib/types';

const GOALS: { id: Goal; label: string; note: string; icon: string }[] = [
  { id: 'fatloss', label: 'Fat Loss', note: 'Lose fat, keep muscle', icon: '🔥' },
  { id: 'tone', label: 'Tone', note: 'Lean & defined', icon: '✨' },
  { id: 'muscle', label: 'Build Muscle', note: 'Add size & strength', icon: '💪' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ITEM_H = 44;
const VISIBLE = 5;
const YEARS = Array.from({ length: 100 }, (_, i) => 1926 + i); // 1926..2025
const daysIn = (m: number, y: number) => new Date(y, m + 1, 0).getDate();

function Wheel({ items, index, onChange, t }: { items: string[]; index: number; onChange: (i: number) => void; t: Theme }) {
  const ref = useRef<ScrollView>(null);
  useEffect(() => { const id = setTimeout(() => ref.current?.scrollTo({ y: index * ITEM_H, animated: false }), 0); return () => clearTimeout(id); }, []);
  return (
    <View style={{ flex: 1, height: ITEM_H * VISIBLE }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => onChange(Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H))))}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
      >
        {items.map((it, i) => (
          <View key={i} style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: i === index ? t.ink : t.ink3, fontSize: i === index ? 21 : 17, fontWeight: i === index ? '800' : '400' }}>{it}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function DobPicker({ visible, iso, onClose, onSave, t }: { visible: boolean; iso: string; onClose: () => void; onSave: (iso: string) => void; t: Theme }) {
  const init = new Date(iso && !isNaN(Date.parse(iso)) ? iso : '1997-06-15');
  const [d, setD] = useState(init.getDate() - 1);
  const [m, setM] = useState(init.getMonth());
  const [y, setY] = useState(Math.max(0, YEARS.indexOf(init.getFullYear())));
  const year = YEARS[y];
  const maxDay = daysIn(m, year);
  const dayIdx = Math.min(d, maxDay - 1);
  const days = Array.from({ length: maxDay }, (_, i) => String(i + 1));

  const save = () => {
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(dayIdx + 1).padStart(2, '0');
    onSave(`${year}-${mm}-${dd}`);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, borderTopWidth: 1, borderColor: t.ring }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Pressable onPress={onClose}><Text style={{ color: t.ink3, fontSize: 16, fontWeight: '600' }}>Cancel</Text></Pressable>
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>Date of birth</Text>
          <Pressable onPress={save}><Text style={{ color: t.brand, fontSize: 16, fontWeight: '800' }}>Done</Text></Pressable>
        </View>
        <View style={{ position: 'relative' }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ITEM_H * 2, height: ITEM_H, borderRadius: 10, backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring }} />
          <View style={{ flexDirection: 'row' }}>
            <Wheel items={days} index={dayIdx} onChange={setD} t={t} />
            <Wheel items={MONTHS} index={m} onChange={setM} t={t} />
            <Wheel items={YEARS.map(String)} index={y} onChange={setY} t={t} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Seg({ options, value, onChange, t }: { options: string[]; value: string; onChange: (v: string) => void; t: Theme }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: 9, padding: 3, borderWidth: 1, borderColor: t.ring }}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={{ paddingHorizontal: 13, paddingVertical: 6, borderRadius: 7, backgroundColor: value === o ? t.brand : 'transparent' }}>
          <Text style={{ color: value === o ? t.brandInk : t.ink3, fontWeight: '700', fontSize: 13 }}>{o.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const HUB: { icon: string; label: string; note: string; route: string }[] = [
  { icon: '🔔', label: 'Activity', note: 'Your training feed & updates', route: '/(client)/activity' },
  { icon: '📏', label: 'Body Measurements', note: 'Track waist, chest, arms over time', route: '/(client)/measurements' },
  { icon: '📈', label: 'Weekly Report', note: 'Your week at a glance · share it', route: '/(client)/report' },
  { icon: '🏆', label: 'Personal Records', note: 'Your best lifts, ranked', route: '/(client)/records' },
  { icon: '✅', label: 'Daily Habits', note: 'Habits & water tracker', route: '/(client)/habits' },
  { icon: '📝', label: 'Weekly Check-in', note: 'Send your coach a weekly pulse', route: '/(client)/checkin' },
  { icon: '🏆', label: 'Achievements', note: 'Badges you\'ve unlocked', route: '/(client)/achievements' },
  { icon: '🤖', label: 'AI Coach', note: 'Chat with your AI coach · knows your plan', route: '/(client)/coach' },
  { icon: '⌚', label: 'Watch & Devices', note: 'Apple Watch, WHOOP, Garmin…', route: '/(client)/devices' },
  { icon: '🍎', label: 'Food Log', note: 'Search, barcode or photo', route: '/(client)/foodlog' },
  { icon: '🎬', label: 'Exercise Library', note: 'How-to videos from your coach', route: '/(client)/library' },
  { icon: '🎧', label: 'Music & Playlists', note: 'AI workout playlists · Spotify / Apple Music', route: '/(client)/music' },
  { icon: '💬', label: 'Messages', note: 'Chat with your coach', route: '/(client)/messages' },
  { icon: '📣', label: 'Share & Social', note: 'Post progress to Instagram / TikTok', route: '/(client)/social' },
  { icon: '🎨', label: 'Appearance', note: 'Theme & accent colour', route: '/(client)/appearance' },
];

export default function Profile() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();

  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow ' + (fromCamera ? 'camera' : 'photo library') + ' access to set your photo.'); return; }
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (!res.canceled && res.assets && res.assets[0]) cd.setPhoto(res.assets[0].uri);
  };
  const changePhoto = () => Alert.alert('Profile Photo', undefined, [
    { text: 'Take Photo', onPress: () => pickPhoto(true) },
    { text: 'Choose From Library', onPress: () => pickPhoto(false) },
    ...(cd.photo ? [{ text: 'Remove', style: 'destructive' as const, onPress: () => cd.setPhoto(null) }] : []),
    { text: 'Cancel', style: 'cancel' as const },
  ]);

  const [showDob, setShowDob] = useState(false);

  const [heightUnit, setHeightUnit] = useState<'cm' | 'in'>('cm');
  const [heightVal, setHeightVal] = useState(String(cd.heightCm));
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [weightVal, setWeightVal] = useState(String(round1(cd.weightKg)));
  const [saved, setSaved] = useState(false);

  const toggleHeight = (u: string) => {
    if (u === heightUnit) return;
    const n = parseFloat(heightVal) || 0;
    setHeightVal(String(u === 'in' ? round1(n / 2.54) : Math.round(n * 2.54)));
    setHeightUnit(u as 'cm' | 'in');
  };
  const toggleWeight = (u: string) => {
    if (u === weightUnit) return;
    const n = parseFloat(weightVal) || 0;
    setWeightVal(String(u === 'lb' ? round1(n * 2.20462) : round1(n / 2.20462)));
    setWeightUnit(u as 'kg' | 'lb');
  };

  const heightCm = heightUnit === 'cm' ? parseFloat(heightVal) || 0 : (parseFloat(heightVal) || 0) * 2.54;
  const weightKg = weightUnit === 'kg' ? parseFloat(weightVal) || 0 : (parseFloat(weightVal) || 0) / 2.20462;

  const save = () => {
    cd.setHeightCm(round1(heightCm));
    cd.setWeightKg(round1(weightKg));
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const age = ageFromDob(cd.dob);
  const macros = macrosFor({ weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet });

  const dobLabel = (() => {
    const dd = new Date(cd.dob);
    if (isNaN(dd.getTime())) return 'Select date';
    return `${dd.getDate()} ${MONTHS[dd.getMonth()]} ${dd.getFullYear()}`;
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <Pressable onPress={changePhoto}>
            {cd.photo ? (
              <Image source={{ uri: cd.photo }} style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: t.surface2 }} />
            ) : (
              <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 20 }}>{cd.init}</Text>
              </View>
            )}
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 11 }}>📷</Text>
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', textTransform: 'capitalize' }}>{cd.name}</Text>
            <Text style={{ color: t.ink3, fontSize: 13, marginTop: 2 }}>Weight changes recalculate your plan automatically</Text>
          </View>
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
          <Text style={{ color: t.ink, fontSize: 15, fontWeight: '800', marginBottom: 3 }}>Your Goal</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>We tailor your workouts and meal targets to this.</Text>
          <View style={{ gap: 8 }}>
            {GOALS.map((g) => {
              const on = cd.goal === g.id;
              return (
                <Pressable key={g.id} onPress={() => cd.setGoal(g.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 12, backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                  <Text style={{ fontSize: 20 }}>{g.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: on ? t.brandInk : t.ink, fontWeight: '800', fontSize: 15 }}>{g.label}</Text>
                    <Text style={{ color: on ? t.brandInk : t.ink3, fontSize: 12, opacity: on ? 0.85 : 1 }}>{g.note}</Text>
                  </View>
                  {on ? <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 16 }}>✓</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 12 }}>
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Date of birth</Text>
          <Pressable onPress={() => setShowDob(true)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: t.ink, fontSize: 15, fontWeight: '600' }}>{dobLabel}</Text>
            <Text style={{ color: t.ink3, fontSize: 13 }}>{age != null ? `${age} yrs` : ''}  ▾</Text>
          </Pressable>
          <Text style={{ color: t.ink3, fontSize: 12, marginTop: 6, marginBottom: 14 }}>Tap to pick — age updates automatically.</Text>

          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Height</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <TextInput value={heightVal} onChangeText={setHeightVal} keyboardType="numeric" placeholderTextColor={t.ink3}
              style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 }} />
            <Seg options={['cm', 'in']} value={heightUnit} onChange={toggleHeight} t={t} />
          </View>

          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Current weight</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            <TextInput value={weightVal} onChangeText={setWeightVal} keyboardType="numeric" placeholderTextColor={t.ink3}
              style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 }} />
            <Seg options={['kg', 'lb']} value={weightUnit} onChange={toggleWeight} t={t} />
          </View>

          <Pressable style={{ backgroundColor: saved ? t.surface2 : t.brand, borderWidth: 1, borderColor: saved ? t.ring : t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }} onPress={save}>
            <Text style={{ color: saved ? t.ink : t.brandInk, fontWeight: '800', fontSize: 15 }}>{saved ? '✓ Saved — plan updated' : 'Save'}</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <View style={{ flex: 1, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, borderRadius: 14, padding: 15 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>Age</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '700', textTransform: 'capitalize', marginTop: 4 }}>{age != null ? String(age) : '—'}<Text style={{ color: t.ink3, fontSize: 13 }}> yrs</Text></Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, borderRadius: 14, padding: 15 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>Height</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '700', textTransform: 'capitalize', marginTop: 4 }}>{heightVal}<Text style={{ color: t.ink3, fontSize: 13 }}> {heightUnit}</Text></Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, borderRadius: 14, padding: 15 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '600' }}>Weight</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '700', textTransform: 'capitalize', marginTop: 4 }}>{weightVal}<Text style={{ color: t.ink3, fontSize: 13 }}> {weightUnit}</Text></Text>
          </View>
        </View>

        <View style={{ backgroundColor: t.surface2, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 18 }}>
          <Text style={{ color: t.ink2 }}>
            Daily target recalculated live: {macros.kcal.toLocaleString()} kcal · P{macros.protein} / C{macros.carbs} / F{macros.fat}
          </Text>
        </View>

        <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800', marginBottom: 10 }}>More</Text>
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, overflow: 'hidden' }}>
          {HUB.map((h, i) => (
            <Pressable key={h.route} onPress={() => router.push(h.route as any)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 15, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.ring }}>
              <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 20 }}>{h.icon}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, textTransform: 'capitalize' }}>{h.label}</Text>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{h.note}</Text>
              </View>
              <Text style={{ color: t.ink3, fontSize: 20 }}>›</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <DobPicker visible={showDob} iso={cd.dob} onClose={() => setShowDob(false)} onSave={(v) => { cd.setDob(v); setShowDob(false); }} t={t} />
    </SafeAreaView>
  );
}
