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
import { useState, useRef, useMemo, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Image, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { useTheme } from '../../src/ui/components';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, KpiRow, ListRow, Ghost, Field, Flag, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import { ageFromDob } from '../../src/lib/age';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { useClientData, type CoachingMode } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, weightToKg, readBodyWeight, heightIn as heightAs, heightParts, heightLabel, heightToCm, plain, convertedNote, readNumber, type WeightUnit, type LengthUnit } from '../../src/lib/units';
import { useCoachNutrition } from '../../src/ui/coachNutrition';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { uploadMyAvatar } from '../../src/ui/avatarUpload';
// A profile photo used to be stored as the picker's own file:// path — a
// location inside this handset, written into a row the coach, the gym and the
// web console all read, where it drew as a blank circle for every one of them.
// These decide what may be stored and what may be drawn; the bytes now go to a
// bucket (supabase/parts/961) and the column holds the URL of the object.
import { avatarSource, isDeviceAvatar, DEVICE_AVATAR_NOTE, AVATAR_UPLOAD_FAILED_NOTE } from '../../src/lib/avatarImage';
import { Icon, type IconName } from '../../src/ui/Icon';
import { COACHING_MODE_LABEL, COACHING_MODE_NOTE, type Goal, type Diet } from '../../src/lib/types';
import { monthNamesShort, fmtFullDay } from '../../src/lib/format';
import { localDate } from '../../src/lib/localDate';
import { FORWARD_ICON, turn } from '../../src/ui/direction';

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

// This was a second hardcoded English copy of the month names — the first was
// on the dashboard. Repple is white-label and has no house locale, so the wheel
// scrolls through the reader's own months. See src/lib/locale.ts.
const ITEM_H = 44;
const VISIBLE = 5;
const YEARS = Array.from({ length: 100 }, (_, i) => 1926 + i);
const daysIn = (m: number, y: number) => new Date(y, m + 1, 0).getDate();

/**
 * One column of the date-of-birth picker.
 *
 * ── It only answered to a flick ───────────────────────────────────────────
 *
 * `onMomentumScrollEnd` was the whole of it. Momentum is what a FLICK produces:
 * let go while still moving and the list coasts, and the event fires when it
 * stops. Drag the column slowly to the year you want and let go — which is what
 * anybody does when they are aiming at one item rather than scrolling — and
 * there is no momentum, so no momentum-end, so `onChange` never fired. The
 * wheel visibly sat on 1971 and the sheet still held whatever it opened on, and
 * Save wrote that. A date of birth is not a preference: it is what
 * `ageFromDob` feeds to the heart-rate zones, so the failure lands on the one
 * screen that asks somebody to push their heart rate.
 *
 * `onScrollEndDrag` is the missing half — the event for a drag that ends
 * without coasting. Both are handled, and both go through the same reader, so a
 * flick and a drag cannot disagree about where the column landed. A drag that
 * DOES coast fires the drag end first and the momentum end after, with the same
 * final offset, so the second call is the same answer rather than a different
 * one.
 *
 * ── And a route that is not a gesture at all ──────────────────────────────
 *
 * Each row is a button now. A scroll wheel is invisible to a screen reader as a
 * control — there is nothing to activate, only content that moves — and it is
 * awkward for anybody with a tremor or one usable hand. The rows are already
 * 44pt tall (`ITEM_H`), so tapping one is a target that meets
 * src/lib/a11y.ts without anything moving.
 */
function Wheel({ items, index, onChange, t, label }: {
  items: string[]; index: number; onChange: (i: number) => void; t: Theme;
  /** What this column is — "Day", "Month", "Year" — so a tappable row can say
   *  "Year 1971" rather than announcing a bare number in a row of three. */
  label: string;
}) {
  const ref = useRef<ScrollView>(null);
  const placed = useRef(false);
  // Line the wheel up with the current value the first time it has a size.
  // A mount-time scrollTo lands on a ScrollView with no layout yet and is
  // silently dropped, which left every wheel parked on its first item.
  const place = () => { if (placed.current) return; placed.current = true; ref.current?.scrollTo({ y: index * ITEM_H, animated: false }); };
  const landedOn = (y: number) => onChange(Math.max(0, Math.min(items.length - 1, Math.round(y / ITEM_H))));
  return (
    <View style={{ flex: 1, height: ITEM_H * VISIBLE }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => landedOn(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => landedOn(e.nativeEvent.contentOffset.y)}
        onContentSizeChange={place}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
       keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {items.map((it, i) => (
          <Pressable
            key={i}
            onPress={() => { onChange(i); ref.current?.scrollTo({ y: i * ITEM_H, animated: true }); }}
            accessibilityRole="button"
            accessibilityState={{ selected: i === index }}
            accessibilityLabel={`${label} ${it}`}
            style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ ...(i === index ? value(21) : ty.body), color: i === index ? t.ink : t.ink3 }}>{it}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function DobPicker({ iso, onClose, onSave, t }: { iso: string; onClose: () => void; onSave: (iso: string) => void; t: Theme }) {
  // `localDate`, not `new Date`. A bare `YYYY-MM-DD` parsed as UTC midnight
  // reads back as the day before west of Greenwich, so the wheel opened one day
  // off the date it was showing — and saving without touching it wrote that.
  const init = localDate(iso) ?? new Date(1997, 5, 15);
  // Twelve Intl calls, once, rather than on every scroll of the wheel.
  const months = useMemo(() => monthNamesShort(), []);
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
            <Wheel items={days} index={dayIdx} onChange={setD} t={t} label="Day" />
            <Wheel items={months} index={m} onChange={setM} t={t} label="Month" />
            <Wheel items={YEARS.map(String)} index={y} onChange={setY} t={t} label="Year" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// "CM", "IN", "KG", "LB" are two letters each, and a screen reader spells them
// or mispronounces them ("in" is a preposition). `SEG_SPOKEN` gives the switch
// the sentence a sighted reader gets from the field label beside it.
const SEG_SPOKEN: Record<string, string> = {
  cm: 'centimetres', in: 'inches', kg: 'kilograms', lb: 'pounds',
};

function Seg({ options, value: val, onChange, t }: { options: string[]; value: string; onChange: (v: string) => void; t: Theme }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.sm, padding: 3 }}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)}
          // The chosen segment was carried by background colour alone, which a
          // screen reader gets nothing of: every option read as a plain button
          // and nothing said which one was on.
          accessibilityRole="radio" accessibilityState={{ selected: val === o }}
          accessibilityLabel={val === o ? `Shown in ${SEG_SPOKEN[o] ?? o}` : `Show in ${SEG_SPOKEN[o] ?? o} instead`}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: val === o ? t.brand : 'transparent' }}>
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
  '/(client)/recovery': 'water', '/(client)/habits': 'check', '/(client)/checkin': 'pencil', '/(client)/injuries': 'heart', '/(client)/intake': 'pencil', '/(client)/my-coach': 'people',
  '/(client)/foodlog': 'meals', '/(client)/coach': 'chat', '/(client)/messages': 'message', '/(client)/reminders': 'bell', '/(client)/packages': 'trophy',
  '/(client)/social': 'share', '/(client)/devices': 'clock', '/(client)/music': 'play',
  '/(client)/appearance': 'palette', '/(client)/settings': 'settings', '/(client)/trainers': 'people', '/(client)/feedback': 'message',
  '/(client)/coach-documents': 'pencil', '/(client)/notifications': 'bell',
  '/(client)/agreements': 'pencil',
};
const HUB_GROUPS: { title: string; items: { label: string; note: string; route: string }[] }[] = [
  // First, deliberately. Pairing a watch is not an occasional settings errand —
  // it is the thing a member opens Me to do in their first week and again every
  // time a strap stops syncing, and it was the fifth group down, under roughly
  // twenty-eight rows. A group's position is the only ranking this screen has.
  { title: 'Devices & Media', items: [
    { label: 'Watch & Devices', note: 'Apple Watch, WHOOP, Garmin…', route: '/(client)/devices' },
    { label: 'Music & Playlists', note: 'AI workout playlists', route: '/(client)/music' },
  ] },
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
    // The intake had no in-app entry point at all: the coach's "Ask Them to
    // Finish It" push deep-linked to it and nothing else reached it. It sits
    // beside Injuries because they are the same kind of thing — what your coach
    // needs to know about your body, owned by you and written only by you.
    { label: 'Your Intake', note: 'What your coach should know before they train you', route: '/(client)/intake' },
  ] },
  { title: 'Daily', items: [
    { label: 'Daily Habits', note: 'Habits & water tracker', route: '/(client)/habits' },
    { label: 'Weekly Check-in', note: 'Send your coach a weekly pulse', route: '/(client)/checkin' },
    { label: 'Food Log', note: 'Search, barcode or photo', route: '/(client)/foodlog' },
    { label: 'Reminders', note: 'Hydration & supplement nudges', route: '/(client)/reminders' },
  ] },
  { title: 'Connect', items: [
    // The coach you HAVE, above the directory of coaches you do not. There was
    // no screen for the former until part 130 made one possible.
    { label: 'Your Coach', note: 'Who is coaching you, and what they can see', route: '/(client)/my-coach' },
    // Directly under Your Coach, because these are that coach's own papers and
    // not Repple's. The release signed on joining is a different document owned
    // by a different party, and coach-documents.tsx says so on its face — a
    // member who cannot tell the two apart takes a dispute to the wrong people.
    { label: "Your Coach's Documents", note: 'Waivers and forms your coach asks you to read', route: '/(client)/coach-documents' },
    // Directly beneath the coach's, because they are the two sets of paperwork
    // a member cannot otherwise tell apart, and this one is the gym's. Until it
    // existed a member had no way to sign a gym waiver at all: every signature
    // the product held was a member of staff typing the member's name at the
    // desk. Both screens name their owner on their face for the same reason —
    // somebody who cannot tell whose document it is takes a dispute to the
    // wrong party.
    { label: "Your Gym's Paperwork", note: 'Waivers and consents your gym asks you to sign', route: '/(client)/agreements' },
    { label: 'Find a Trainer', note: 'Have a code from your coach? Enter it here', route: '/(client)/trainers' },
    { label: 'Memberships & Packs', note: 'Your session packs & payments', route: '/(client)/packages' },
    { label: 'AI Coach', note: 'Chat with your AI coach', route: '/(client)/coach' },
    // Immediately above Messages, because the two are constantly mistaken for
    // each other and the pairing is the explanation: this is what was SENT to
    // you, the row below is what you and your coach have SAID to each other.
    // The bell in the dashboard header still opens the thread rather than this,
    // so until that changes this row and Explore are the only ways in.
    { label: 'Notifications', note: 'Bookings, cancellations and anything your gym has sent you', route: '/(client)/notifications' },
    { label: 'Messages', note: 'Chat with your coach', route: '/(client)/messages' },
    // Not "Post progress to Instagram / TikTok". Nothing in this app is
    // connected to a social network — the NETWORKS list whose Connect button
    // flipped a local boolean was removed from social.tsx as fabricated state,
    // and what is left is one React Native `Share.share()` call. The row now
    // describes the OS share sheet, which is the whole of what happens.
    { label: 'Share & Social', note: 'Share your progress from the share sheet', route: '/(client)/social' },
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
  const coachNutrition = useCoachNutrition();
  // The client's own record — name, dob, height, goal, injuries, weight and the
  // scan history behind it — plus whatever their coach has adjusted on top. A
  // profile read that failed left every field on this screen at its default
  // with no way to ask again.
  const pull = usePullToRefresh(useCallback(() => {
    cd.reload(); void coachNutrition.reload();
  }, [cd.reload, coachNutrition]));

  // Uploaded first, and the column is only pointed at something that is in the
  // bucket. `setPhoto` used to be given `res.assets[0].uri` — the picker's path
  // inside this phone — so the member saw their photo, their coach saw a blank
  // circle, and the picture disappeared the first time iOS cleared its cache.
  const [photoBusy, setPhotoBusy] = useState(false);
  const pickPhoto = async (fromCamera: boolean) => {
    if (!(await ensureMediaPermission(fromCamera ? 'camera' : 'library', 'set your photo'))) return;
    const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    setPhotoBusy(true);
    const up = await uploadMyAvatar(cd.id === 'unknown' ? '' : cd.id, res.assets[0].uri);
    setPhotoBusy(false);
    if (!up.url) {
      // Nothing is set. A photo the server never received must not be shown
      // here as though it had been — that is the whole defect being closed.
      Alert.alert('Photo not saved', up.error ?? AVATAR_UPLOAD_FAILED_NOTE);
      return;
    }
    cd.setPhoto(up.url);
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
  // Through `readBodyWeight`, which BOUNDS it. `weightToKg` has no bound of any
  // kind, and this sheet is the main place a member edits their own weight: a
  // slipped keypress put 1,800 kg on the health record permanently, and from
  // there into the macro calculator, the goal projection, every chart, and the
  // pricing of every bodyweight set in the training log. There is no delete on
  // that series. The body-fat box two fields down has been bounded all along.
  const weightRead = readBodyWeight(weightVal, wu);
  const enteredKg = weightRead.ok ? weightRead.kg : null;
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
    // Refused out loud, and NOTHING ELSE ON THE SHEET IS SAVED either: a member
    // who mistyped their weight and had their name change go through would have
    // no reason to look at the weight again. The sentence names the range in the
    // unit they are typing in.
    if (!weightRead.ok && weightVal !== asText(shownWeight)) {
      Alert.alert('Check that weight', weightRead.reason);
      return;
    }
    if (enteredKg != null && weightVal !== asText(shownWeight)) cd.setWeightKg(enteredKg);
    if (enteredCm != null && (heightVal !== heightFieldOfRecord || heightInVal !== heightInchFieldOfRecord)) cd.setHeightCm(enteredCm);
    // `readNumber`, so a decimal comma reads as a decimal point — this box is
    // a decimal pad now, and 22,5 through `parseFloat` is 22.
    const bf = readNumber(bfVal);
    if (bf != null && bf > 3 && bf < 70) cd.setBodyFat(round1(bf));
    // "Saved — plan updated" was a 900 ms timer and nothing else. It fired
    // whether or not anything reached the server: these four setters are local,
    // and the write behind them is a debounced push in clientData.tsx that
    // COUNTS ITS ROWS and reports the outcome through `cd.saveFailed`. That
    // signal existed, injuries.tsx and habits.tsx both surface it, and this
    // sheet — the one place in the client app where somebody edits their
    // weight, height and body fat — read it nowhere.
    //
    // The optimistic close stays: the values are held locally, the push retries,
    // and holding the sheet hostage to a debounce would be worse. What changes
    // is the sentence. "Saved" is a claim about the server, so the button says
    // what actually just happened, and the outcome is surfaced on the screen
    // behind it in the same words the other two screens use.
    setSaved(true);
    setTimeout(() => { setSaved(false); setShowEdit(false); }, 900);
  };

  const age = ageFromDob(cd.dob);
  const _adj = coachNutrition.get(cd.id);
  // No weight, no target. This used to run on the 70 kg / 20% placeholder and
  // present the result as the client's own daily calorie and protein target.
  const macros = (cd.weightKg != null && cd.bodyFatPct != null)
    ? applyCoachAdjust(macrosFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity, goal: cd.goal, diet: cd.diet }), cd.coachingMode === 'solo' ? undefined : (_adj || undefined))
    : null;
  // The same reader as `save` above uses, so the macro preview on screen is
  // built from the same number the button is about to store.
  const _bfPrev = readNumber(bfVal);
  const _bfForPreview = _bfPrev == null ? cd.bodyFatPct : _bfPrev;
  // `enteredKg` is null for an empty field where the old expression produced 0,
  // so the preview no longer quietly computes a day of food for a 0 kg client.
  const previewMacros = (enteredKg != null && enteredKg > 0 && _bfForPreview != null)
    ? macrosFor({ weightKg: enteredKg, bodyFatPct: _bfForPreview, activity: cd.activity, goal: cd.goal, diet: cd.diet })
    : null;

  // `new Date('1990-05-14')` is UTC midnight, which every getter west of
  // Greenwich reads back as 13 May — a date of birth off by a day, on the
  // screen where somebody checks it. `fmtFullDay` goes through `localDate` and
  // writes the date the way the reader's own locale does.
  const dobLabel = cd.dob && fmtFullDay(cd.dob) !== '—' ? fmtFullDay(cd.dob) : 'Select date';

  // Height and weight in the client's own units. This line printed "cm" and
  // "kg" over the stored figures no matter what the Settings screen said,
  // because nothing in the app read that setting. Each part is dropped rather
  // than dashed: a line reading "34 yrs · — · —" is noise, and the fallback
  // sentence below already says what to do about it.
  const statsLine = [age != null ? age + ' yrs' : null, heightLabel(cd.heightCm, lu), weightLabel(cd.weightKg, wu)]
    .filter(Boolean).join(' · ') || 'Add your height and weight';
  const soloHidden = new Set(['/(client)/messages', '/(client)/checkin']);
  // Every group renders. There used to be a `HUB_KEEP` set here, one line above
  // this, that filtered HUB_GROUPS down to Connect · Devices & Media · Account
  // and dropped Progress & Insights, Training and Daily on the floor.
  //
  // ── Why it was there ───────────────────────────────────────────────────────
  //
  // The IA rebalance that introduced Explore moved "find any screen" to a
  // search field, and the Me tab was slimmed to match: the hub was meant to
  // hold the things you go to Me FOR — your coach, your devices, your account —
  // while everything else was to be found by searching. src/lib/features.ts
  // still describes the result in its own header as "the slimmed Me hub".
  //
  // ── Why it is gone ─────────────────────────────────────────────────────────
  //
  // The slimming was safe only if Explore really did list everything, and it
  // never did. CLIENT_FEATURES was missing Reminders outright, so the row in the
  // Daily group was Reminders' ONLY link anywhere in the app and hiding the
  // group made the screen unreachable — not hard to find, unreachable, with no
  // route into it from any tab, hub, banner or search result. Eighteen or so
  // screens whose own headers say "reachable from the profile hub" were in the
  // same position or one banner away from it, all of them describing a hub that
  // had stopped rendering them.
  //
  // Search is a second way to reach a screen. It is not a first one: it only
  // finds what somebody already knows to type, and a member who has never seen
  // "Strength Standards" will not search for it. So the hub lists everything
  // again, with per-group collapse (see `collapsed` above, expanded by default) so
  // the length costs nothing, and Explore is the shortcut rather than the door.
  //
  // Every route below was checked against app/(client)/ before this shipped —
  // all 32 resolve to a real file. A row pointing at nothing is worse than no
  // row, so if one is ever deleted, delete its row here in the same change.
  //
  // That count said 28 while there were 30 rows, which is the ordinary fate of
  // a number kept by hand. Both halves of the claim are now checked by a script
  // rather than by this sentence: scripts/check-reachable.mjs fails if a route
  // named here does not exist on disk, and fails if a route file in app/ is
  // named by nothing anywhere — the Reminders failure, from the other side.
  const hubGroups = HUB_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => cd.coachingMode !== 'solo' || !soloHidden.has(it.route)) }));
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

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
          <Pressable onPress={changePhoto} disabled={photoBusy} accessibilityState={{ disabled: photoBusy }} accessibilityRole="button"
            accessibilityLabel={photoBusy ? 'Uploading your profile photo' : 'Change your profile photo'}>
            {/* `avatarSource`, not `cd.photo`. A row still holding a device path
                from before the upload existed would otherwise draw here — and
                only here, on the one device that can open it, which is exactly
                how nobody noticed the coach could not. */}
            {avatarSource(cd.photo) ? (
              <Image source={{ uri: avatarSource(cd.photo)! }} style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.surface2 }} />
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                {cd.init ? (
                  <Text style={{ ...value(20), color: t.brandInk }}>{cd.init}</Text>
                ) : (
                  <Icon name="me" size={24} color={t.brandInk} />
                )}
              </View>
            )}
            <View style={{ position: 'absolute', bottom: -2, end: -2, width: 22, height: 22, borderRadius: radius.pill, backgroundColor: t.surface, borderWidth: hairline, borderColor: t.ring, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={12} color={t.ink2} />
            </View>
          </Pressable>
        </View>

        {/* A photo saved before there was anywhere to put it. The member is the
            only person who can fix it and the one person for whom nothing looks
            wrong — their own device draws its own file happily. */}
        {isDeviceAvatar(cd.photo) ? (
          <Flag tone={t.warn} style={{ marginTop: sp.md }}>{DEVICE_AVATAR_NOTE}</Flag>
        ) : null}
        {photoBusy ? (
          <Flag tone={t.ink3} style={{ marginTop: sp.md }}>Uploading your photo…</Flag>
        ) : null}

        <ScreenHelp screen="me" />

        <Rule />

        {/* ── goal ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Goal" />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {/* The chosen goal was carried by background colour alone, which a
                screen reader gets nothing of — the same defect `Seg` above
                names, and the coaching-mode radios below already avoid. This
                answer and the diet answer decide every calorie and macro
                figure in the app, so a VoiceOver user not being able to tell
                which one is set is not a cosmetic gap. */}
            {GOALS.map((g) => {
              const on = cd.goal === g.id;
              return (
                <Pressable key={g.id} onPress={() => cd.setGoal(g.id)}
                  accessibilityRole="radio" accessibilityState={{ selected: on }}
                  accessibilityLabel={on ? `${g.label}. Your goal.` : `Set your goal to ${g.label}`}
                  accessibilityHint="Your goal sets your daily calorie and macro targets"
                  style={{ flex: 1, alignItems: 'center', paddingVertical: sp.md, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
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
          {/* The one write on this screen, and whether it landed. clientData's
              push counts the rows it matched — a PostgREST update matching zero
              rows is not an error — and this is where the answer belongs, next
              to the figures it decides. */}
          {cd.saveFailed ? (
            <Flag tone={t.crit} style={{ marginBottom: sp.md }}>
              Your last profile change has not reached the server, so what is on this screen may not be what your coach sees. It keeps retrying — open Edit and save again if it does not clear.
            </Flag>
          ) : null}
          <SectionHead title="Daily Target" note={macros ? `${macros.kcal.toLocaleString()} kcal` : undefined} onPress={() => router.push('/(client)/nutrition')} />
          {macros ? (
            <KpiRow items={[
              { label: 'Protein', value: fig(macros.protein), unit: 'g' },
              { label: 'Carbs', value: fig(macros.carbs), unit: 'g' },
              { label: 'Fat', value: fig(macros.fat), unit: 'g' },
            ]} />
          ) : (
            // "Add your weight and body fat" is an instruction that only makes
            // sense if we know they have not. `macros` is null equally when the
            // profile read failed, and clientData says so through
            // `profileStatus` — telling somebody who weighs in every week to go
            // and add a weight reads as the app having lost it.
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {cd.profileStatus === 'loading' ? 'Reading your profile…'
                : cd.profileStatus === 'error' ? 'We couldn’t read your profile, so there is no target to work out. This is not a statement that your weight is missing.'
                : 'Add your weight and body fat above and your daily targets appear here.'}
            </Text>
          )}
        </Section>

        <Rule />

        <Section>
          {/* First of the three, and permanent. Reported as "Repple Coach has a
              Getting Started, however Client doesn't have this" — what that app
              had was the first-run tour firing on a fresh install, which is
              gone the moment it is skipped. This row is here whether the list
              is finished or not: the HOME row leaves when there is nothing left
              in it, and a screen nothing links to fails check:reachable and,
              more to the point, cannot be gone back to. */}
          <ListRow icon="sparkle" title="Getting Started" note="What is set up, and what is still worth doing"
            onPress={() => router.push('/(client)/getting-started')} />
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
                <View style={{ transform: [{ rotate: turn(gc ? 0 : 90) }] }}><Icon name={FORWARD_ICON} size={13} color={t.ink3} /></View>
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

            {/* This sheet always opens holding the figures already on file, so
                the unit — which lived only in the placeholder — was invisible
                every single time it was opened. A height of 5 is feet and a
                height of 175 is centimetres, but 70 is both, and a weight with
                no unit over it is how pounds get saved as kilograms. */}
            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: lengthNote ? sp.sm : sp.lg, alignItems: 'flex-end' }}>
              {/* Two boxes in imperial, one in metric. A single box asking for
                  a height "in inches" is a box nobody who thinks in feet knows
                  how to fill in — they would type 5.10 and mean 5' 10". */}
              <Field label="Height" hint={lu === 'cm' ? 'cm' : 'ft'} a11y={lu === 'cm' ? 'Height in centimetres' : 'Height, feet'}>
                <TextInput value={heightVal} onChangeText={setHeightVal} keyboardType="number-pad"
                  style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              </Field>
              {lu === 'in' ? (
                <Field label="Inches" a11y="Height, inches">
                  <TextInput value={heightInVal} onChangeText={setHeightInVal} keyboardType="number-pad"
                    style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
                </Field>
              ) : null}
              <View style={{ paddingBottom: 4 }}>
                <Seg options={['cm', 'in']} value={lu} onChange={switchLengthUnit} t={t} />
              </View>
            </View>
            {lengthNote ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{lengthNote}</Text> : null}

            <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: weightNote ? sp.sm : sp.lg, alignItems: 'flex-end' }}>
              <Field label="Current weight" hint={wu} a11y={wu === 'kg' ? 'Current weight in kilograms' : 'Current weight in pounds'}>
                <TextInput value={weightVal} onChangeText={setWeightVal} keyboardType="decimal-pad"
                  style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              </Field>
              <View style={{ paddingBottom: 4 }}>
                <Seg options={['kg', 'lb']} value={wu} onChange={switchWeightUnit} t={t} />
              </View>
            </View>
            {weightNote ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{weightNote}</Text> : null}

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Body fat %</Text>
            <TextInput value={bfVal} onChangeText={setBfVal} keyboardType="decimal-pad" placeholder="e.g. 22" placeholderTextColor={t.ink3} style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginBottom: sp.sm }} />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>From your latest scan, or type it in. Changes recalculate your plan.</Text>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Diet</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, marginBottom: sp.lg }}>
              {/* Same as the goal above, and for the same reason: the diet
                  decides the macro split, and background colour is not an
                  answer a screen reader can read. */}
              {DIETS.map((d) => (
                <Pressable key={d.id} onPress={() => cd.setDiet(d.id)}
                  accessibilityRole="radio" accessibilityState={{ selected: cd.diet === d.id }}
                  accessibilityLabel={cd.diet === d.id ? `${d.label}. Your diet.` : `Set your diet to ${d.label}`}
                  accessibilityHint="Your diet sets how your daily target is split between protein, carbs and fat"
                  style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: cd.diet === d.id ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: cd.diet === d.id ? '600' : '500', color: cd.diet === d.id ? t.brandInk : t.ink2 }}>{d.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={{ backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md, marginBottom: sp.lg }}>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{previewMacros ? <>New target · <Text style={{ ...ty.caption, ...numeric, fontWeight: '600', color: t.ink }}>{previewMacros.kcal.toLocaleString()} kcal</Text> · P{previewMacros.protein} / C{previewMacros.carbs} / F{previewMacros.fat}</> : 'Enter a weight and body fat to see your target.'}</Text>
            </View>

            <Pressable style={{ backgroundColor: saved ? t.surface2 : t.brand, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: sp.sm }} onPress={save}>
              {saved ? <Icon name="check" size={16} color={t.ink} /> : null}
              <Text style={{ ...ty.body, fontWeight: '600', color: saved ? t.ink : t.brandInk }}>{saved ? 'Sending…' : 'Save'}</Text>
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
