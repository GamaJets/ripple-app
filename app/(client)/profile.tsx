// Me — identity, the two settings that change the plan (goal + coaching mode),
// today's target, and the navigational hub.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: no hero (a profile has
// no single live number to lead with), hairline-separated sections instead of
// seven stacked bordered boxes, and `<ListRow>` for the hub instead of a
// hand-rolled row for the 3,815th time.
import { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, KpiRow, ListRow, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { ageFromDob } from '../../src/lib/age';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { useClientData, type CoachingMode } from '../../src/ui/clientData';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { Icon, type IconName } from '../../src/ui/Icon';
import type { Goal, Diet } from '../../src/lib/types';

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
            <Text style={{ ...(i === index ? value(21) : ty.body), color: i === index ? t.ink : t.ink3 }}>{it}</Text>
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
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: sp.lg, borderTopWidth: hairline, borderColor: t.ring, ...elevation.e2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
          <Pressable onPress={onClose} hitSlop={8}><Text style={{ ...ty.body, fontWeight: '500', color: t.ink3 }}>Cancel</Text></Pressable>
          <Text style={{ ...ty.head, color: t.ink }}>Date of birth</Text>
          <Pressable onPress={save} hitSlop={8}><Text style={{ ...ty.body, fontWeight: '600', color: t.brand }}>Done</Text></Pressable>
        </View>
        <View style={{ position: 'relative' }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ITEM_H * 2, height: ITEM_H, borderRadius: radius.sm, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.ring }} />
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

function Seg({ options, value: val, onChange, t }: { options: string[]; value: string; onChange: (v: string) => void; t: Theme }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.sm, padding: 3 }}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: val === o ? t.brand : 'transparent' }}>
          <Text style={{ ...ty.label, fontWeight: '600', color: val === o ? t.brandInk : t.ink3 }}>{o.toUpperCase()}</Text>
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [heightUnit, setHeightUnit] = useState<'cm' | 'in'>('cm');
  const [heightVal, setHeightVal] = useState(cd.heightCm != null ? String(cd.heightCm) : '');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [weightVal, setWeightVal] = useState(cd.weightKg != null ? String(round1(cd.weightKg)) : '');
  const [nameVal, setNameVal] = useState(cd.name);
  const [bfVal, setBfVal] = useState(cd.bodyFatPct != null ? String(round1(cd.bodyFatPct)) : '');
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
  const _adj = useCoachNutrition().get(cd.id);
  // No weight, no target. This used to run on the 70 kg / 20% placeholder and
  // present the result as the client's own daily calorie and protein target.
  const macros = (cd.weightKg != null && cd.bodyFatPct != null)
    ? applyCoachAdjust(macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet }), cd.coachingMode === 'solo' ? undefined : (_adj || undefined))
    : null;
  const _bfPrev = parseFloat(bfVal);
  const _bfForPreview = isNaN(_bfPrev) ? cd.bodyFatPct : _bfPrev;
  const previewMacros = (weightKg > 0 && _bfForPreview != null)
    ? macrosFor({ weightKg, bodyFatPct: _bfForPreview, activity: cd.activity, goal: cd.goal, diet: cd.diet })
    : null;

  const dobLabel = (() => {
    const dd = new Date(cd.dob);
    if (isNaN(dd.getTime())) return 'Select date';
    return `${dd.getDate()} ${MONTHS[dd.getMonth()]} ${dd.getFullYear()}`;
  })();

  const statsLine = [age != null ? age + ' yrs' : null, cd.heightCm != null ? cd.heightCm + ' cm' : null, cd.weightKg != null ? round1(cd.weightKg) + ' kg' : null]
    .filter(Boolean).join(' · ') || 'Add your height and weight';
  const soloHidden = new Set(['/(client)/messages', '/(client)/checkin']);
  const HUB_KEEP = new Set(['Connect', 'Devices & Media', 'Account']);
  const hubGroups = HUB_GROUPS.filter((g) => HUB_KEEP.has(g.title)).map((g) => ({ ...g, items: g.items.filter((it) => cd.coachingMode !== 'solo' || !soloHidden.has(it.route)) }));
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header: who you are. No hero — a profile has no live metric ─── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, paddingBottom: sp.lg }}>
          <Pressable onPress={() => setShowEdit(true)} accessibilityRole="button" accessibilityLabel="Edit your profile and stats" style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Me</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5, textTransform: 'capitalize' }} numberOfLines={1}>{cd.name}</Text>
            <Text style={{ ...ty.label, ...numeric, color: t.ink3, marginTop: 3 }}>{statsLine}</Text>
          </Pressable>
          <Ghost icon="pencil" onPress={() => setShowEdit(true)} />
          <Pressable onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change your profile photo">
            {cd.photo ? (
              <Image source={{ uri: cd.photo }} style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...value(20), color: t.brandInk }}>{cd.init}</Text>
              </View>
            )}
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: radius.pill, backgroundColor: t.surface, borderWidth: hairline, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={12} color={t.ink2} />
            </View>
          </Pressable>
        </View>

        <Rule />

        {/* ── goal ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your goal" />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {GOALS.map((g) => {
              const on = cd.goal === g.id;
              return (
                <Pressable key={g.id} onPress={() => cd.setGoal(g.id)} style={{ flex: 1, alignItems: 'center', paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Rule />

        {/* ── coaching mode ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Coaching" />
          {COACH_MODES.map((mm) => {
            const on = cd.coachingMode === mm.id;
            return (
              <Pressable key={mm.id} onPress={() => cd.setCoachingMode(mm.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: mm.id === 'online' ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 20, height: 20, borderRadius: radius.pill, borderWidth: 2, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>{on ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: t.brand }} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{mm.label}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{mm.note}</Text>
                </View>
              </Pressable>
            );
          })}
        </Section>

        <Rule />

        {/* ── what this profile adds up to ───────────────────────────────── */}
        <Section>
          <SectionHead title="Daily target" note={macros ? `${macros.kcal.toLocaleString()} kcal` : undefined} onPress={() => router.push('/(client)/nutrition')} />
          {macros ? (
            <KpiRow items={[
              { label: 'Protein', value: String(macros.protein), unit: 'g' },
              { label: 'Carbs', value: String(macros.carbs), unit: 'g' },
              { label: 'Fat', value: String(macros.fat), unit: 'g' },
            ]} />
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Add your weight and body fat above and your daily targets appear here.</Text>
          )}
        </Section>

        <Rule />

        <Section>
          <ListRow icon="search" title="User guide" note="What each tab does, any time"
            onPress={() => router.push('/guide')} />
          <ListRow icon="search" title="Explore all features" note="Search anything in the app"
            onPress={() => router.push('/(client)/explore')} />
        </Section>

        {/* ── the hub: grouped, collapsible, deliberately quiet ───────────── */}
        {hubGroups.map((g) => { const gc = collapsed[g.title] ?? false; return (
          <View key={g.title}>
            <Rule />
            <Section>
              <Pressable onPress={() => setCollapsed((p) => ({ ...p, [g.title]: !gc }))} accessibilityRole="button" accessibilityLabel={(gc ? 'Expand ' : 'Collapse ') + g.title}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: gc ? 0 : sp.sm }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>{g.title}</Text>
                <View style={{ transform: [{ rotate: gc ? '0deg' : '90deg' }] }}><Icon name="chevron" size={13} color={t.ink3} /></View>
              </Pressable>
              {!gc ? g.items.map((h) => (
                <ListRow key={h.route} icon={HUB_ICON[h.route] || 'chevron'} title={h.label} note={h.note}
                  onPress={() => router.push(h.route as any)} />
              )) : null}
            </Section>
          </View>
        ); })}
      </ScrollView>

      {/* edit profile sheet */}
      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowEdit(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '90%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: G }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
              <Text style={{ ...ty.title, color: t.ink }}>Edit profile</Text>
              <Pressable onPress={() => setShowEdit(false)} hitSlop={8}><Text style={{ ...ty.body, fontWeight: '600', color: t.brand }}>Close</Text></Pressable>
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Name</Text>
            <TextInput value={nameVal} onChangeText={setNameVal} placeholder="Your name" placeholderTextColor={t.ink3} autoCapitalize="words" style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginBottom: sp.lg }} />

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Date of birth</Text>
            <Pressable onPress={() => setShowDob(true)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{dobLabel}</Text>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{age != null ? `${age} yrs  ▾` : '▾'}</Text>
            </Pressable>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Height</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              <TextInput value={heightVal} onChangeText={setHeightVal} keyboardType="numeric" placeholderTextColor={t.ink3} style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              <Seg options={['cm', 'in']} value={heightUnit} onChange={toggleHeight} t={t} />
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Current weight</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.lg }}>
              <TextInput value={weightVal} onChangeText={setWeightVal} keyboardType="numeric" placeholderTextColor={t.ink3} style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              <Seg options={['kg', 'lb']} value={weightUnit} onChange={toggleWeight} t={t} />
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Body fat %</Text>
            <TextInput value={bfVal} onChangeText={setBfVal} keyboardType="numeric" placeholder="e.g. 22" placeholderTextColor={t.ink3} style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginBottom: sp.sm }} />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>From your latest scan, or type it in. Changes recalculate your plan.</Text>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Diet</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, marginBottom: sp.lg }}>
              {DIETS.map((d) => (
                <Pressable key={d.id} onPress={() => cd.setDiet(d.id)} style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: cd.diet === d.id ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: cd.diet === d.id ? '600' : '500', color: cd.diet === d.id ? t.brandInk : t.ink2 }}>{d.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={{ backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md, marginBottom: sp.lg }}>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{previewMacros ? <>New target · <Text style={{ ...ty.caption, ...numeric, fontWeight: '600', color: t.ink }}>{previewMacros.kcal.toLocaleString()} kcal</Text> · P{previewMacros.protein} / C{previewMacros.carbs} / F{previewMacros.fat}</> : 'Enter a weight and body fat to see your target.'}</Text>
            </View>

            <Pressable style={{ backgroundColor: saved ? t.surface2 : t.brand, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: sp.sm }} onPress={save}>
              {saved ? <Icon name="check" size={16} color={t.ink} /> : null}
              <Text style={{ ...ty.body, fontWeight: '600', color: saved ? t.ink : t.brandInk }}>{saved ? 'Saved — plan updated' : 'Save'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <DobPicker visible={showDob} iso={cd.dob} onClose={() => setShowDob(false)} onSave={(v) => { cd.setDob(v); setShowDob(false); }} t={t} />
    </SafeAreaView>
  );
}
