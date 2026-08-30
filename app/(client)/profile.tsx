// Me — identity, the two settings that change the plan (goal + coaching mode),
// today's target, and the navigational hub.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: no hero (a profile has
// no single live number to lead with), hairline-separated sections instead of
// seven stacked bordered boxes, and `<ListRow>` for the hub instead of a
// hand-rolled row for the 3,815th time.
//
// TF-37: the edit sheet had its own kg/lb and cm/in toggles, local to the
// modal and gone the moment it closed, converting through a bare `round1` in
// both directions — type 180 lb, get 81.6 kg stored, come back to 179.9 lb. The
// stats line under the name ignored all of it and printed "cm" and "kg"
// regardless. Both now go through src/lib/units.ts, and the unit itself is the
// account's (src/ui/settings.tsx), the same one the Settings screen sets.
import { useState, useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Image, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, KpiRow, ListRow, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { ageFromDob } from '../../src/lib/age';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { useClientData, type CoachingMode } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, weightToKg, heightIn as heightAs, heightParts, heightLabel, heightToCm, plain, convertedNote, type WeightUnit, type LengthUnit } from '../../src/lib/units';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { Icon, type IconName } from '../../src/ui/Icon';
import { COACHING_MODE_LABEL, COACHING_MODE_NOTE, type Goal, type Diet } from '../../src/lib/types';

const GOALS: { id: Goal; label: string }[] = [
  { id: 'fatloss', label: 'Fat Loss' },
  { id: 'tone', label: 'Tone' },
  { id: 'muscle', label: 'Build Muscle' },
];
// The order is the order of the answers, and each carries the one line that
// says what picking it changes — see COACHING_MODE_NOTE. Before TF-30 the first
// two notes described a relationship rather than the app, which is why choosing
// between them appeared to do nothing: it did nothing.
const COACH_MODES: CoachingMode[] = ['online', 'inperson', 'hybrid', 'solo'];
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
  const placed = useRef(false);
  // Line the wheel up with the current value the first time it has a size.
  // A mount-time scrollTo lands on a ScrollView with no layout yet and is
  // silently dropped, which left every wheel parked on its first item.
  const place = () => { if (placed.current) return; placed.current = true; ref.current?.scrollTo({ y: index * ITEM_H, animated: false }); };
  return (
    <View style={{ flex: 1, height: ITEM_H * VISIBLE }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => onChange(Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H))))}
        onContentSizeChange={place}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
       keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {items.map((it, i) => (
          <View key={i} style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ ...(i === index ? value(21) : ty.body), color: i === index ? t.ink : t.ink3 }}>{it}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function DobPicker({ iso, onClose, onSave, t }: { iso: string; onClose: () => void; onSave: (iso: string) => void; t: Theme }) {
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
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
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
  '/(client)/appearance': 'palette', '/(client)/settings': 'settings', '/(client)/trainers': 'people', '/(client)/feedback': 'message',
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
    { label: 'Injuries & Limitations', note: 'Train around injuries — safer swaps', route: '/(client)/injuries' },
  ] },
  { title: 'Daily', items: [
    { label: 'Daily Habits', note: 'Habits & water tracker', route: '/(client)/habits' },
    { label: 'Weekly Check-in', note: 'Send your coach a weekly pulse', route: '/(client)/checkin' },
    { label: 'Food Log', note: 'Search, barcode or photo', route: '/(client)/foodlog' },
    { label: 'Reminders', note: 'Hydration & supplement nudges', route: '/(client)/reminders' },
  ] },
  { title: 'Connect', items: [
    { label: 'Find a Trainer', note: 'Have a code from your coach? Enter it here', route: '/(client)/trainers' },
    { label: 'Memberships & Packs', note: 'Your session packs & payments', route: '/(client)/packages' },
    { label: 'AI Coach', note: 'Chat with your AI coach', route: '/(client)/coach' },
    { label: 'Messages', note: 'Chat with your coach', route: '/(client)/messages' },
    { label: 'Share & Social', note: 'Post progress to Instagram / TikTok', route: '/(client)/social' },
  ] },
  { title: 'Devices & Media', items: [
    { label: 'Watch & Devices', note: 'Apple Watch, WHOOP, Garmin…', route: '/(client)/devices' },
    { label: 'Music & Playlists', note: 'AI workout playlists', route: '/(client)/music' },
  ] },
  { title: 'Account', items: [
    { label: 'Appearance', note: 'Theme & accent colour', route: '/(client)/appearance' },
    { label: 'Settings', note: 'Account, notifications, units, legal & version', route: '/(client)/settings' },
    { label: 'Send Feedback', note: 'Tell us what to improve', route: '/(client)/feedback' },
  ] },
];

export default function Profile() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();

  const pickPhoto = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'set your photo'))) return;
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

  // The units this client reads in. These used to be two `useState`s local to
  // the edit sheet, defaulted to kg and cm, thrown away when the sheet closed —
  // a preference that did not outlive one modal, sitting beside a Settings
  // screen with its own kg/lb toggle that nothing read. There is one answer now
  // and it belongs to the account (TF-37).
  const st = useSettings();
  const wu = st.weightUnit;
  const lu = st.lengthUnit;

  // What the record says, rendered in those units. Never a zero: a client with
  // no scan and no manual entry has no weight, and `fig` turns that into a dash.
  const shownWeight = weightIn(cd.weightKg, wu);
  const shownHeight = lu === 'cm' ? heightAs(cd.heightCm, 'cm') : null;
  const shownParts = lu === 'in' ? heightParts(cd.heightCm) : null;

  // The sheet's fields, in the client's units. Filled from the record when the
  // sheet OPENS rather than at mount: the unit preference arrives from the
  // account a moment after launch, and a field seeded at mount would sit there
  // holding kilograms under a "lb" label for everyone who reads in pounds —
  // which is the precise failure this ticket names as the worst outcome.
  const [weightVal, setWeightVal] = useState('');
  const [heightVal, setHeightVal] = useState('');    // centimetres, or whole feet
  const [heightInVal, setHeightInVal] = useState(''); // inches, imperial only
  const [nameVal, setNameVal] = useState(cd.name);
  const [bfVal, setBfVal] = useState(cd.bodyFatPct != null ? String(round1(cd.bodyFatPct)) : '');
  const [saved, setSaved] = useState(false);

  const asText = (n: number | null) => (n == null ? '' : plain(n));
  const openEdit = () => {
    setNameVal(cd.name);
    setBfVal(cd.bodyFatPct != null ? String(round1(cd.bodyFatPct)) : '');
    setWeightVal(asText(shownWeight));
    if (lu === 'cm') { setHeightVal(asText(heightAs(cd.heightCm, 'cm'))); setHeightInVal(''); }
    else { const p = heightParts(cd.heightCm); setHeightVal(p ? String(p.feet) : ''); setHeightInVal(p ? String(p.inches) : ''); }
    setShowEdit(true);
  };

  // Switching units carries what is already typed across, through the same
  // conversion the rest of the app uses. The old version did this with a bare
  // `round1` in both directions, so 180 lb became 81.6 kg became 179.9 lb: the
  // number the client had typed thirty seconds earlier came back different, and
  // toggling a few times walked it down further. Both handlers also WRITE the
  // preference, so a client who picks lb here is not asked again in Settings.
  const switchWeightUnit = (u: string) => {
    const next = u as WeightUnit;
    if (next === wu) return;
    setWeightVal(asText(weightIn(weightToKg(weightVal, wu), next)));
    st.set({ weightUnit: next });
  };
  const switchLengthUnit = (u: string) => {
    const next = u as LengthUnit;
    if (next === lu) return;
    const cm = heightToCm(heightVal, lu, heightInVal);
    if (next === 'cm') { setHeightVal(asText(heightAs(cm, 'cm'))); setHeightInVal(''); }
    else { const p = heightParts(cm); setHeightVal(p ? String(p.feet) : ''); setHeightInVal(p ? String(p.inches) : ''); }
    st.set({ lengthUnit: next });
  };

  // What is in the fields right now, back in the metric the record stores.
  // null means the field is empty or unreadable — NOT zero.
  const enteredKg = weightToKg(weightVal, wu);
  const enteredCm = heightToCm(heightVal, lu, heightInVal);
  // What the two height boxes hold when they are showing the record untouched.
  const heightFieldOfRecord = lu === 'cm' ? asText(shownHeight) : (shownParts ? String(shownParts.feet) : '');
  const heightInchFieldOfRecord = lu === 'in' && shownParts ? String(shownParts.inches) : '';
  // Said once, under the field, when and only when it is true. Repple records
  // kilograms and centimetres; a client reading pounds is reading a conversion,
  // and their InBody sheet will say a number that looks different. Without this
  // the two look like a discrepancy rather than one reading said twice.
  const weightNote = convertedNote(wu);
  const lengthNote = convertedNote(lu);

  const save = () => {
    cd.setName(nameVal.trim() || cd.name);
    // Two rules here, and the first one used to be broken outright.
    //
    // Nothing empty is written. `parseFloat(weightVal) || 0` stored 0 kg and
    // 0 cm for anybody who opened this sheet to change their NAME and left the
    // stat fields alone — and 0 kg is not a light client, it is a client nobody
    // has weighed. The macro calculator would then build them a day's food out
    // of it.
    //
    // And a field the client did not touch is not an edit. Writing back the
    // displayed figure would round an 81.63 kg scan reading down to the 81.6 kg
    // its "180 lb" display converts back to, and would turn a measurement into
    // a manual override, every time this sheet was opened for any reason.
    if (enteredKg != null && weightVal !== asText(shownWeight)) cd.setWeightKg(enteredKg);
    if (enteredCm != null && (heightVal !== heightFieldOfRecord || heightInVal !== heightInchFieldOfRecord)) cd.setHeightCm(enteredCm);
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
  // `enteredKg` is null for an empty field where the old expression produced 0,
  // so the preview no longer quietly computes a day of food for a 0 kg client.
  const previewMacros = (enteredKg != null && enteredKg > 0 && _bfForPreview != null)
    ? macrosFor({ weightKg: enteredKg, bodyFatPct: _bfForPreview, activity: cd.activity, goal: cd.goal, diet: cd.diet })
    : null;

  const dobLabel = (() => {
    const dd = new Date(cd.dob);
    if (isNaN(dd.getTime())) return 'Select date';
    return `${dd.getDate()} ${MONTHS[dd.getMonth()]} ${dd.getFullYear()}`;
  })();

  // Height and weight in the client's own units. This line printed "cm" and
  // "kg" over the stored figures no matter what the Settings screen said,
  // because nothing in the app read that setting. Each part is dropped rather
  // than dashed: a line reading "34 yrs · — · —" is noise, and the fallback
  // sentence below already says what to do about it.
  const statsLine = [age != null ? age + ' yrs' : null, heightLabel(cd.heightCm, lu), weightLabel(cd.weightKg, wu)]
    .filter(Boolean).join(' · ') || 'Add your height and weight';
  const soloHidden = new Set(['/(client)/messages', '/(client)/checkin']);
  const HUB_KEEP = new Set(['Connect', 'Devices & Media', 'Account']);
  const hubGroups = HUB_GROUPS.filter((g) => HUB_KEEP.has(g.title)).map((g) => ({ ...g, items: g.items.filter((it) => cd.coachingMode !== 'solo' || !soloHidden.has(it.route)) }));
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header: who you are. No hero — a profile has no live metric ─── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, paddingBottom: sp.lg }}>
          <Pressable onPress={openEdit} accessibilityRole="button" accessibilityLabel="Edit your profile and stats" style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Me</Text>
            {/* An empty name used to render as an empty line under "ME". Say
                what to do about it instead of showing nothing. */}
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5, textTransform: 'capitalize' }} numberOfLines={1}>
              {cd.name || 'Add your name'}
            </Text>
            <Text style={{ ...ty.label, ...numeric, color: t.ink3, marginTop: 3 }}>{statsLine}</Text>
          </Pressable>
          <Ghost icon="pencil" onPress={openEdit} />
          <Pressable onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change your profile photo">
            {cd.photo ? (
              <Image source={{ uri: cd.photo }} style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                {cd.init ? (
                  <Text style={{ ...value(20), color: t.brandInk }}>{cd.init}</Text>
                ) : (
                  <Icon name="me" size={24} color={t.brandInk} />
                )}
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
          <SectionHead title="Your Goal" />
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
          {COACH_MODES.map((mm, i) => {
            const on = cd.coachingMode === mm;
            return (
              <Pressable key={mm} onPress={() => cd.setCoachingMode(mm)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${COACHING_MODE_LABEL[mm]}. ${COACHING_MODE_NOTE[mm]}`} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 20, height: 20, borderRadius: radius.pill, borderWidth: 2, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>{on ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: t.brand }} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{COACHING_MODE_LABEL[mm]}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{COACHING_MODE_NOTE[mm]}</Text>
                </View>
              </Pressable>
            );
          })}
        </Section>

        <Rule />

        {/* ── what this profile adds up to ───────────────────────────────── */}
        <Section>
          <SectionHead title="Daily Target" note={macros ? `${macros.kcal.toLocaleString()} kcal` : undefined} onPress={() => router.push('/(client)/nutrition')} />
          {macros ? (
            <KpiRow items={[
              { label: 'Protein', value: fig(macros.protein), unit: 'g' },
              { label: 'Carbs', value: fig(macros.carbs), unit: 'g' },
              { label: 'Fat', value: fig(macros.fat), unit: 'g' },
            ]} />
          ) : (
            <Text style={{ ...ty.label, color: t.ink3 }}>Add your weight and body fat above and your daily targets appear here.</Text>
          )}
        </Section>

        <Rule />

        <Section>
          <ListRow icon="search" title="User Guide" note="What each tab does, any time"
            onPress={() => router.push('/guide')} />
          <ListRow icon="search" title="Explore All Features" note="Search anything in the app"
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowEdit(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '90%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: G }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
              <Text style={{ ...ty.title, color: t.ink }}>Edit Profile</Text>
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
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: lengthNote ? sp.sm : sp.lg }}>
              {/* Two boxes in imperial, one in metric. A single box asking for
                  a height "in inches" is a box nobody who thinks in feet knows
                  how to fill in — they would type 5.10 and mean 5' 10". */}
              <TextInput value={heightVal} onChangeText={setHeightVal} keyboardType="numeric"
                accessibilityLabel={lu === 'cm' ? 'Height in centimetres' : 'Height, feet'}
                placeholder={lu === 'cm' ? 'cm' : 'ft'} placeholderTextColor={t.ink3}
                style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              {lu === 'in' ? (
                <TextInput value={heightInVal} onChangeText={setHeightInVal} keyboardType="numeric"
                  accessibilityLabel="Height, inches" placeholder="in" placeholderTextColor={t.ink3}
                  style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              ) : null}
              <Seg options={['cm', 'in']} value={lu} onChange={switchLengthUnit} t={t} />
            </View>
            {lengthNote ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{lengthNote}</Text> : null}

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Current weight</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: weightNote ? sp.sm : sp.lg }}>
              <TextInput value={weightVal} onChangeText={setWeightVal} keyboardType="numeric"
                accessibilityLabel={wu === 'kg' ? 'Current weight in kilograms' : 'Current weight in pounds'}
                placeholder={wu} placeholderTextColor={t.ink3}
                style={{ flex: 1, ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              <Seg options={['kg', 'lb']} value={wu} onChange={switchWeightUnit} t={t} />
            </View>
            {weightNote ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{weightNote}</Text> : null}

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
        </KeyboardAvoidingView>

        {/* Inside the edit sheet, not beside it. iOS will not present a second
            modal while the first one is up, so as a sibling this rendered
            nothing at all and "Select date" looked dead. */}
        {showDob ? (
          <DobPicker iso={cd.dob} onClose={() => setShowDob(false)} onSave={(v) => { cd.setDob(v); setShowDob(false); }} t={t} />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}
