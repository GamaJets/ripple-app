// Me — matches the mockup: avatar + serif name + stats line + edit pencil, a clean
// 3-pill goal card, then the grouped icon hub. The full edit form (name, DOB wheel,
// height/weight/body-fat with unit toggles, live macro preview) lives in a sheet.
import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { ageFromDob } from '../../src/lib/age';
import { macrosFor } from '../../src/lib/nutrition';
import { useClientData, type CoachingMode } from '../../src/ui/clientData';
import { Icon, type IconName } from '../../src/ui/Icon';
import type { Goal, Diet } from '../../src/lib/types';

const SERIF = 'Georgia';
const GOALS: { id: Goal; label: string }[] = [
  { id: 'fatloss', label: 'Fat loss' },
  { id: 'tone', label: 'Tone' },
  { id: 'muscle', label: 'Build muscle' },
];
const COACH_MODES: { id: CoachingMode; label: string; note: string }[] = [
  { id: 'online', label: 'Online coach', note: 'Remote coaching · plan, check-ins & messaging' },
  { id: 'inperson', label: 'In-person coach', note: 'Coach trains you in person; app tracks progress' },
  { id: 'solo', label: 'Solo', note: 'Self-managed with AI plans & tools' },
];
const DIETS: { id: Diet; label: string }[] = [
  { id: 'meat', label: 'Meat' }, { id: 'vegetarian', label: 'Veggie' }, { id: 'vegan', label: 'Vegan' }, { id: 'paleo', label: 'Paleo' }, { id: 'keto', label: 'Keto' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ITEM_H = 44;
const VISIBLE = 5;
const YEARS = Array.from({ length: 100 }, (_, i) => 1926 + i);
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

const HUB_ICON: Record<string, IconName> = {
  '/(client)/report': 'chart', '/(client)/consistency': 'flame', '/(client)/records': 'trophy',
  '/(client)/standards': 'chart', '/(client)/goal': 'target', '/(client)/measurements': 'ruler',
  '/(client)/achievements': 'trophy', '/(client)/cards': 'share', '/(client)/activity': 'bell',
  '/(client)/week': 'calendar', '/(client)/library': 'video', '/(client)/tools': 'settings',
  '/(client)/recovery': 'water', '/(client)/habits': 'check', '/(client)/checkin': 'pencil', '/(client)/injuries': 'heart',
  '/(client)/foodlog': 'meals', '/(client)/coach': 'chat', '/(client)/messages': 'message', '/(client)/reminders': 'bell', '/(client)/packages': 'trophy',
  '/(client)/social': 'share', '/(client)/devices': 'clock', '/(client)/music': 'play',
  '/(client)/appearance': 'palette', '/(client)/settings': 'settings', '/': 'swap', '/(client)/trainers': 'people', '/(client)/feedback': 'message',
};
const HUB_GROUPS: { title: string; items: { label: string; note: string; route: string }[] }[] = [
  { title: 'Progress & Insights', items: [
    { label: 'Weekly Report', note: 'Your week at a glance · share it', route: '/(client)/report' },
    { label: 'Consistency', note: '12-week training heatmap', route: '/(client)/consistency' },
    { label: 'Personal Records', note: 'Your best lifts, ranked', route: '/(client)/records' },
    { label: 'Strength Standards', note: 'How your lifts stack up', route: '/(client)/standards' },
    { label: 'Goal Tracker', note: 'Target weight & projected finish', route: '/(client)/goal' },
    { label: 'Body Measurements', note: 'Waist, chest, arms over time', route: '/(client)/measurements' },
    { label: 'Achievements', note: 'Badges and milestones', route: '/(client)/achievements' },
    { label: 'Milestone Cards', note: 'Shareable cards of your wins', route: '/(client)/cards' },
    { label: 'Activity', note: 'Your training feed & updates', route: '/(client)/activity' },
  ] },
  { title: 'Training', items: [
    { label: 'This Week', note: 'Your week of training at a glance', route: '/(client)/week' },
    { label: 'Exercise Library', note: 'How-to videos from your coach', route: '/(client)/library' },
    { label: 'Lifting Tools', note: '1RM, plate math & macro reference', route: '/(client)/tools' },
    { label: 'Recovery', note: 'Hydration, sleep & mobility', route: '/(client)/recovery' },
    { label: 'Injuries & limitations', note: 'Train around injuries — safer swaps', route: '/(client)/injuries' },
  ] },
  { title: 'Daily', items: [
    { label: 'Daily Habits', note: 'Habits & water tracker', route: '/(client)/habits' },
    { label: 'Weekly Check-in', note: 'Send your coach a weekly pulse', route: '/(client)/checkin' },
    { label: 'Food Log', note: 'Search, barcode or photo', route: '/(client)/foodlog' },
    { label: 'Reminders', note: 'Hydration & supplement nudges', route: '/(client)/reminders' },
  ] },
  { title: 'Connect', items: [
    { label: 'Find a trainer', note: 'Browse coaches · book online or in-person', route: '/(client)/trainers' },
    { label: 'Memberships & packs', note: 'Your session packs & payments', route: '/(client)/packages' },
    { label: 'AI Coach', note: 'Chat with your AI coach', route: '/(client)/coach' },
    { label: 'Messages', note: 'Chat with your coach', route: '/(client)/messages' },
    { label: 'Share & Social', note: 'Post progress to Instagram / TikTok', route: '/(client)/social' },
  ] },
  { title: 'Devices & Media', items: [
    { label: 'Watch & Devices', note: 'Apple Watch, WHOOP, Garmin…', route: '/(client)/devices' },
    { label: 'Music & Playlists', note: 'AI workout playlists', route: '/(client)/music' },
  ] },
  { title: 'Account', items: [
    { label: 'Switch portal', note: 'Client · Trainer · Owner', route: '/' },
    { label: 'Appearance', note: 'Theme & accent colour', route: '/(client)/appearance' },
    { label: 'Settings', note: 'Notifications, units, legal & version', route: '/(client)/settings' },
    { label: 'Send Feedback', note: 'Tell us what to improve', route: '/(client)/feedback' },
  ] },
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
  const changePhoto = () => Alert.alert('Profile photo', undefined, [
    { text: 'Take Photo', onPress: () => pickPhoto(true) },
    { text: 'Choose From Library', onPress: () => pickPhoto(false) },
    ...(cd.photo ? [{ text: 'Remove', style: 'destructive' as const, onPress: () => cd.setPhoto(null) }] : []),
    { text: 'Cancel', style: 'cancel' as const },
  ]);

  const [showDob, setShowDob] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const [heightUnit, setHeightUnit] = useState<'cm' | 'in'>('cm');
  const [heightVal, setHeightVal] = useState(String(cd.heightCm));
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [weightVal, setWeightVal] = useState(String(round1(cd.weightKg)));
  const [nameVal, setNameVal] = useState(cd.name);
  const [bfVal, setBfVal] = useState(String(round1(cd.bodyFatPct)));
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
    cd.setName(nameVal.trim() || cd.name);
    cd.setHeightCm(round1(heightCm));
    cd.setWeightKg(round1(weightKg));
    const bf = parseFloat(bfVal);
    if (!isNaN(bf) && bf > 3 && bf < 70) cd.setBodyFat(round1(bf));
    setSaved(true);
    setTimeout(() => { setSaved(false); setShowEdit(false); }, 900);
  };

  const age = ageFromDob(cd.dob);
  const macros = macrosFor({ weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet });

  const dobLabel = (() => {
    const dd = new Date(cd.dob);
    if (isNaN(dd.getTime())) return 'Select date';
    return `${dd.getDate()} ${MONTHS[dd.getMonth()]} ${dd.getFullYear()}`;
  })();

  const statsLine = `${age != null ? age + ' yrs' : '—'} · ${cd.heightCm} cm · ${round1(cd.weightKg)} kg`;
  const soloHidden = new Set(['/(client)/messages', '/(client)/checkin']);
  const HUB_KEEP = new Set(['Connect', 'Devices & Media', 'Account']);
  const hubGroups = HUB_GROUPS.filter((g) => HUB_KEEP.has(g.title)).map((g) => ({ ...g, items: g.items.filter((it) => cd.coachingMode !== 'solo' || !soloHidden.has(it.route)) }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <Text style={{ color: t.brand, fontSize: 12, fontWeight: '900', textAlign: 'center', marginBottom: 8 }}>✓ UPDATE LIVE · build 0709c</Text>
        {/* header: avatar + serif name + stats + edit pencil */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4, marginBottom: 16 }}>
          <Pressable onPress={changePhoto}>
            {cd.photo ? (
              <Image source={{ uri: cd.photo }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.surface2 }} />
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 21 }}>{cd.init}</Text>
              </View>
            )}
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: t.surface, borderWidth: 1, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={12} color={t.ink2} />
            </View>
          </Pressable>
          <Pressable onPress={() => setShowEdit(true)} accessibilityRole="button" accessibilityLabel="Edit your profile and stats" style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '700', fontFamily: SERIF, textTransform: 'capitalize' }}>{cd.name}</Text>
            <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{statsLine}</Text>
            <Text style={{ color: t.brand, fontSize: 11, fontWeight: '700', marginTop: 3 }}>Tap to edit ›</Text>
          </Pressable>
          <Pressable onPress={() => setShowEdit(true)} style={{ width: 36, height: 36, borderWidth: 1, borderColor: t.ring, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="pencil" size={16} color={t.ink2} />
          </Pressable>
        </View>

        {/* goal pills */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 6 }}>
          <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Your goal</Text>
          <View style={{ flexDirection: 'row', gap: 7 }}>
            {GOALS.map((g) => {
              const on = cd.goal === g.id;
              return (
                <Pressable key={g.id} onPress={() => cd.setGoal(g.id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: on ? t.brand : t.surface2, borderWidth: 1, borderColor: on ? t.brand : t.ring }}>
                  <Text style={{ color: on ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12.5 }}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* coaching mode */}
        <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14, marginTop: 12 }}>
          <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Coaching</Text>
          {COACH_MODES.map((mm) => {
            const on = cd.coachingMode === mm.id;
            return (
              <Pressable key={mm.id} onPress={() => cd.setCoachingMode(mm.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderTopWidth: mm.id === 'online' ? 0 : 1, borderTopColor: t.ring }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>{on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.brand }} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{mm.label}</Text>
                  <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 1 }}>{mm.note}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* live target strip */}
        <Pressable onPress={() => router.push('/(client)/nutrition')} accessibilityRole="button" accessibilityLabel="See your meal plan" style={{ backgroundColor: t.surface2, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 13, marginTop: 12, marginBottom: 18, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>Daily target · <Text style={{ color: t.ink, fontWeight: '700' }}>{macros.kcal.toLocaleString()} kcal</Text> · P{macros.protein} / C{macros.carbs} / F{macros.fat}</Text>
          <Icon name="chevron" size={16} color={t.ink3} />
        </Pressable>

        <Pressable onPress={() => router.push('/(client)/explore')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 16 }}>
          <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name="search" size={16} color={t.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>Explore all features</Text>
            <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 1 }}>Search anything in the app</Text>
          </View>
          <Icon name="chevron" size={17} color={t.ink3} />
        </Pressable>

        {/* hub groups */}
        {hubGroups.map((g) => (
          <View key={g.title}>
            <Text style={{ color: t.ink3, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8, marginTop: 4 }}>{g.title}</Text>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, overflow: 'hidden', marginBottom: 16 }}>
              {g.items.map((h, i) => (
                <Pressable key={h.route} onPress={() => router.push(h.route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.ring }}>
                  <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}><Icon name={HUB_ICON[h.route] || 'chevron'} size={16} color={t.brand} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{h.label}</Text>
                    <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 1 }}>{h.note}</Text>
                  </View>
                  <Icon name="chevron" size={17} color={t.ink3} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* edit profile sheet */}
      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowEdit(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: t.ring, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: t.ink, fontSize: 20, fontWeight: '700', fontFamily: SERIF }}>Edit profile</Text>
              <Pressable onPress={() => setShowEdit(false)}><Text style={{ color: t.brand, fontSize: 15, fontWeight: '800' }}>Close</Text></Pressable>
            </View>

            <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Name</Text>
            <TextInput value={nameVal} onChangeText={setNameVal} placeholder="Your name" placeholderTextColor={t.ink3} autoCapitalize="words" style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 14 }} />

            <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Date of birth</Text>
            <Pressable onPress={() => setShowDob(true)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ color: t.ink, fontSize: 15, fontWeight: '600' }}>{dobLabel}</Text>
              <Text style={{ color: t.ink3, fontSize: 13 }}>{age != null ? `${age} yrs  ▾` : '▾'}</Text>
            </Pressable>

            <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Height</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <TextInput value={heightVal} onChangeText={setHeightVal} keyboardType="numeric" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 }} />
              <Seg options={['cm', 'in']} value={heightUnit} onChange={toggleHeight} t={t} />
            </View>

            <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Current weight</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              <TextInput value={weightVal} onChangeText={setWeightVal} keyboardType="numeric" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 }} />
              <Seg options={['kg', 'lb']} value={weightUnit} onChange={toggleWeight} t={t} />
            </View>

            <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Body fat %</Text>
            <TextInput value={bfVal} onChangeText={setBfVal} keyboardType="numeric" placeholder="e.g. 22" placeholderTextColor={t.ink3} style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 6 }} />
            <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 16 }}>From your latest scan, or type it in. Changes recalculate your plan.</Text>
            <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Diet</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, marginBottom: 16 }}>
              {DIETS.map((d) => (
                <Pressable key={d.id} onPress={() => cd.setDiet(d.id)} style={{ paddingHorizontal: 15, paddingVertical: 8, borderRadius: 10, backgroundColor: cd.diet === d.id ? t.brand : t.surface2, borderWidth: 1, borderColor: cd.diet === d.id ? t.brand : t.ring }}>
                  <Text style={{ color: cd.diet === d.id ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{d.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 13, marginBottom: 16 }}>
              <Text style={{ color: t.ink3, fontSize: 12 }}>New target · <Text style={{ color: t.ink, fontWeight: '700' }}>{macros.kcal.toLocaleString()} kcal</Text> · P{macros.protein} / C{macros.carbs} / F{macros.fat}</Text>
            </View>

            <Pressable style={{ backgroundColor: saved ? t.surface2 : t.brand, borderWidth: 1, borderColor: saved ? t.ring : t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }} onPress={save}>
              {saved ? <Icon name="check" size={16} color={t.ink} /> : null}
              <Text style={{ color: saved ? t.ink : t.brandInk, fontWeight: '800', fontSize: 15 }}>{saved ? 'Saved — plan updated' : 'Save'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <DobPicker visible={showDob} iso={cd.dob} onClose={() => setShowDob(false)} onSave={(v) => { cd.setDob(v); setShowDob(false); }} t={t} />
    </SafeAreaView>
  );
}
