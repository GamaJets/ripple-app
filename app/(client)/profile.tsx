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
// Round five: the approved mockup (mock/project/ClientMe.dc.html). The identity
// sits on the ground under a centred head with Settings at its trailing edge,
// the three figures are tiles in their own hues over eight real weeks, the
// badges are a row of medals, and the daily target is the macro mix as a donut.
// Flow: who you are → search → the six groups → most people start here →
// what you have done → what you hold → the goal and coaching controls.
//
// TF-37: the edit sheet had its own kg/lb and cm/in toggles, local to the
// modal and gone the moment it closed, converting through a bare `round1` in
// both directions — type 180 lb, get 81.6 kg stored, come back to 179.9 lb. The
// stats line under the name ignored all of it and printed "cm" and "kg"
// regardless. Both now go through src/lib/units.ts, and the unit itself is the
// account's (src/ui/settings.tsx), the same one the Settings screen sets.
import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Image, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaPermission } from '../../src/ui/permissions';
import { useTheme } from '../../src/ui/components';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import type { Theme } from '../../src/theme/tokens';
import { Section, SectionHead, KpiRow, ListRow, PageHead, Ghost, Donut, Legend, Field, Flag, fig, toneOf, HeroCard, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value, font } from '../../src/theme/scale';
import { CLIENT_FEATURES, ME_GROUPS, ME_QUICK, ME_QUICK_TITLE, meGroupFeatures, type Feature } from '../../src/lib/features';
import { ageFromDob } from '../../src/lib/age';
import { macrosFor, applyCoachAdjust } from '../../src/lib/nutrition';
import { useClientData, type CoachingMode } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightIn, weightLabel, weightToKg, readBodyWeight, heightIn as heightAs, heightParts, heightLabel, heightToCm, plain, convertedNote, type WeightUnit, type LengthUnit } from '../../src/lib/units';
// The two boxes either side of the weight, which had between them one silent
// bound and no bound at all. See src/lib/bodyEntry.ts — both refuse out loud
// now, in the unit the figure was typed in.
import { readBodyFat, readHeight } from '../../src/lib/bodyEntry';
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
import { monthNamesShort, fmtFullDay, fmtPointMonth, num } from '../../src/lib/format';
import { localDate } from '../../src/lib/localDate';
import { FORWARD_ICON } from '../../src/ui/direction';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { isWhole } from '../../src/ui/loadStatus';
import { activeDays, longestStreak } from '../../src/lib/streaks';
import { BADGES, badgeFigures, badgeState, earnedKeys, BADGE_COUNT, type BadgeKey } from '../../src/lib/badges';
import { startOfWeek } from '../../src/lib/weekStart';
import { useNow } from '../../src/ui/today';
import { supabase } from '../../src/lib/supabase';

// What each badge's medal looks like: a glyph and a hue by FAMILY, so the row
// of medals reads as four kinds of achievement rather than twelve colours —
// streaks are the orange the streak chip on Home already is, training days the
// accent the Workouts tile is, records amber, volume blue. The hue carries
// nothing the badge's title does not say; it is how an eye finds the one that
// is new. app/(client)/achievements.tsx holds the same table, because a lane
// may not add a module: it belongs in src/lib/badges.ts beside BADGES.
const BADGE_LOOK: Record<BadgeKey, { icon: IconName; tone: Tone }> = {
  'first-rep': { icon: 'check', tone: 'amber' },
  'on-a-roll': { icon: 'flame', tone: 'orange' },
  'week-warrior': { icon: 'flame', tone: 'orange' },
  'two-weeks': { icon: 'calendar', tone: 'orange' },
  'unstoppable': { icon: 'sparkle', tone: 'orange' },
  'ten-sessions': { icon: 'dumbbell', tone: 'brand' },
  'fifty-club': { icon: 'dumbbell', tone: 'brand' },
  'record-breaker': { icon: 'trophy', tone: 'amber' },
  'pr-machine': { icon: 'trending', tone: 'purple' },
  'cardio-kick': { icon: 'heart', tone: 'pink' },
  'one-tonne': { icon: 'scale', tone: 'blue' },
  'ten-tonnes': { icon: 'scale', tone: 'teal' },
};
/** A medal's plate and glyph colours. Not IconPlate: that is a rounded square
 *  and the mockup's medal is a circle. The colours are the kit's own. */
const medalColours = (t: Theme, tone: Tone) => toneOf(t, tone);
/** How many weeks the three tiles' trends look back over. */
const TREND_WEEKS = 8;

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
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose}
          accessibilityRole="button" accessibilityLabel="Close" />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: sp.lg, borderTopWidth: hairline, borderColor: t.ring, ...elevation.e2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.md }}>
          <Pressable onPress={onClose} hitSlop={8}><Text style={{ ...ty.body, ...font('500'), color: t.ink3 }}>Cancel</Text></Pressable>
          <Text style={{ ...ty.head, color: t.ink }}>Date of Birth</Text>
          <Pressable onPress={save} hitSlop={8}><Text style={{ ...ty.body, ...font('600'), color: t.brand }}>Done</Text></Pressable>
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
          <Text style={{ ...ty.label, ...font('600'), color: val === o ? t.brandInk : t.ink3 }}>{o.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

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
      Alert.alert('Photo Not Saved', up.error ?? AVATAR_UPLOAD_FAILED_NOTE);
      return;
    }
    cd.setPhoto(up.url);
  };
  const changePhoto = () => Alert.alert('Profile Photo', undefined, [
    { text: 'Take Photo', onPress: () => pickPhoto(true) },
    { text: 'Choose from Library', onPress: () => pickPhoto(false) },
    ...(cd.photo ? [{ text: 'Remove', style: 'destructive' as const, onPress: () => cd.setPhoto(null) }] : []),
    { text: 'Cancel', style: 'cancel' as const },
  ]);

  const [showDob, setShowDob] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

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
  // Through `readHeight`, for exactly the reason the line above goes through
  // `readBodyWeight`. `heightToCm` converts and rounds and BOUNDS NOTHING, and
  // this sheet is the only place in the client app a member types their own
  // height: 1750 in the cm box stored somebody seventeen and a half metres
  // tall, and ten inches with the feet box empty stored one 25 cm tall. Height
  // is on the row the coach reads and the console prints, and there is no
  // delete on it. `heightToCm` is still used by `switchLengthUnit` above, where
  // an unbounded conversion is right: that carries a half-typed figure across
  // a unit change rather than committing one.
  const heightRead = readHeight(heightVal, lu, heightInVal);
  const enteredCm = heightRead.ok ? heightRead.cm : null;
  // And the body fat, which WAS bounded — `bf > 3 && bf < 70`, with no else.
  // A member who typed 85 got no sentence, no refusal and no stored figure;
  // they got "Sending…" and a sheet that closed. A write that did not happen,
  // reported as one that did, on the field they opened the sheet to change.
  const bfRead = readBodyFat(bfVal);
  // What the two height boxes hold when they are showing the record untouched.
  const heightFieldOfRecord = lu === 'cm' ? asText(shownHeight) : (shownParts ? String(shownParts.feet) : '');
  const heightInchFieldOfRecord = lu === 'in' && shownParts ? String(shownParts.inches) : '';
  // The same, for body fat — so a record that already holds an out-of-range
  // figure does not block somebody who came here to change their name.
  const bfFieldOfRecord = cd.bodyFatPct != null ? String(round1(cd.bodyFatPct)) : '';
  const heightEdited = heightVal !== heightFieldOfRecord || heightInVal !== heightInchFieldOfRecord;
  const bfEdited = bfVal !== bfFieldOfRecord;
  // Said once, under the field, when and only when it is true. Repple records
  // kilograms and centimetres; a client reading pounds is reading a conversion,
  // and their InBody sheet will say a number that looks different. Without this
  // the two look like a discrepancy rather than one reading said twice.
  const weightNote = convertedNote(wu);
  const lengthNote = convertedNote(lu);

  const save = () => {
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
    //
    // All three refusals are checked BEFORE the first setter runs, and each
    // abandons the whole save. Refusing one field and writing the other two
    // would leave a member whose name change went through with no reason to
    // look at the figure that did not — which is the same silence one field
    // narrower. They are tested in the order the boxes appear on the sheet, so
    // the sentence names the topmost thing that is wrong.
    if (!heightRead.ok && heightEdited) {
      Alert.alert('Check That Height', heightRead.reason);
      return;
    }
    if (!weightRead.ok && weightVal !== asText(shownWeight)) {
      Alert.alert('Check That Weight', weightRead.reason);
      return;
    }
    if (!bfRead.ok && bfEdited) {
      Alert.alert('Check That Body Fat', bfRead.reason);
      return;
    }
    cd.setName(nameVal.trim() || cd.name);
    if (enteredKg != null && weightVal !== asText(shownWeight)) cd.setWeightKg(enteredKg);
    if (enteredCm != null && heightEdited) cd.setHeightCm(enteredCm);
    // `readBodyFat` reads a decimal comma and rounds to the one decimal place
    // the column holds, so there is nothing left for `round1` to do here.
    if (bfRead.ok && bfRead.pct != null && bfEdited) cd.setBodyFat(bfRead.pct);
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
  //
  // It said that before and it was not true. `readNumber` alone accepted any
  // figure at all, so a member who typed 85 read "New target · 1,980 kcal"
  // directly above a Save that would discard it — a day's food on screen,
  // computed from a body nobody has, over a button that was never going to
  // record it. A refused figure falls back to the record, which is what the
  // targets are actually still built from.
  const _bfForPreview = bfRead.ok && bfRead.pct != null ? bfRead.pct : cd.bodyFatPct;
  // `enteredKg` is null for an empty field where the old expression produced 0,
  // so the preview no longer quietly computes a day of food for a 0 kg client.
  const previewMacros = (enteredKg != null && enteredKg > 0 && _bfForPreview != null)
    ? macrosFor({ weightKg: enteredKg, bodyFatPct: _bfForPreview, activity: cd.activity, goal: cd.goal, diet: cd.diet })
    : null;

  // `new Date('1990-05-14')` is UTC midnight, which every getter west of
  // Greenwich reads back as 13 May — a date of birth off by a day, on the
  // screen where somebody checks it. `fmtFullDay` goes through `localDate` and
  // writes the date the way the reader's own locale does.
  const dobLabel = cd.dob && fmtFullDay(cd.dob) !== '—' ? fmtFullDay(cd.dob) : 'Select Date';

  // Height and weight in the client's own units. This line printed "cm" and
  // "kg" over the stored figures no matter what the Settings screen said,
  // because nothing in the app read that setting. Each part is dropped rather
  // than dashed: a line reading "34 yrs · — · —" is noise, and the fallback
  // sentence below already says what to do about it.
  // The training log behind the three figures on the card. `status`, not the
  // rows: under 'error' and 'partial' the rows are not the member's history.
  const { log, status: logStatus } = useWorkoutLog();
  const logWhole = isWhole(logStatus);
  // The weight history prices every bodyweight set, so four badges depend on
  // it as well as on the log. Offered only when it was read whole, exactly as
  // app/(client)/achievements.tsx does, so the two screens cannot disagree
  // about how many badges somebody holds.
  const scansWhole = isWhole(cd.scansStatus);
  const badgeFigs = useMemo(() => badgeFigures(log, scansWhole ? cd.weightSeries : []), [log, scansWhole, cd.weightSeries]);
  const medals = BADGES.map((b) => ({ ...b, state: badgeState(b.key, badgeFigs, logWhole, scansWhole) }));
  // A count over the set, so it is withheld while any badge is unreadable: it
  // could only be an under-count, and a figure that is silently low is worse
  // than a dash with its reason beside it.
  const badgesCountable = logWhole && !medals.some((m) => m.state === 'unknown');
  const earnedCount = medals.filter((m) => m.state === 'earned').length;
  // The row on this screen is five medals — the width of the card at the
  // mockup's 54pt — earned first, so what is drawn is what they HAVE and the
  // grey ones are what comes next. All twelve are on Achievements.
  const medalRow = [...medals.filter((m) => m.state === 'earned'), ...medals.filter((m) => m.state !== 'earned')].slice(0, 5);

  // ── the three tiles' trends ──────────────────────────────────────────────
  //
  // Each is the figure above it AS IT STOOD at the end of each of the last
  // eight weeks, recounted from the same log by the same function — not a
  // drawing. Workouts is the exception the brief names: training days IN each
  // week, because an all-time count can only rise and a line that can only rise
  // says nothing about how the last two months went. A week before the first
  // entry in the log is a gap and not a zero: nobody measured it. Nothing is
  // drawn under a read that is not whole, for the reason the tiles are dashes.
  // `useNow`, not `Date.now()`: this tab stays mounted across midnight.
  const now = useNow();
  const trends = useMemo(() => {
    if (!logWhole || log.length === 0) return null;
    const first = Math.min(...log.map((e) => new Date(e.t).getTime()));
    const thisWeek = startOfWeek(now);
    const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => {
      const from = new Date(thisWeek); from.setDate(from.getDate() - 7 * (TREND_WEEKS - 1 - i));
      const to = new Date(from); to.setDate(to.getDate() + 7);
      return { from: from.getTime(), to: to.getTime() };
    });
    const upTo = (ms: number) => log.filter((e) => new Date(e.t).getTime() < ms);
    const lived = (w: { to: number }) => w.to > first;
    return {
      workouts: weeks.map((w) => lived(w) ? activeDays(log.filter((e) => { const ms = new Date(e.t).getTime(); return ms >= w.from && ms < w.to; })).length : null),
      badges: weeks.map((w) => lived(w) ? earnedKeys(badgeFigures(upTo(w.to), scansWhole ? cd.weightSeries : [])).length : null),
      streak: weeks.map((w) => lived(w) ? longestStreak(upTo(w.to)) : null),
    };
  }, [log, logWhole, now, scansWhole, cd.weightSeries]);

  // ── "Member since" ───────────────────────────────────────────────────────
  //
  // The day the ACCOUNT was made, which is `created_at` on the auth user and is
  // held in the stored session, so this asks storage rather than the network.
  // `clients` carries no such column on the rows this screen reads. `error` is
  // read: a session that could not be read draws no line at all, which is the
  // only honest rendering of a date nobody has — never today's, never a guess.
  const [memberSince, setMemberSince] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!live || error) return;
        const at = data.session?.user?.created_at;
        const d = at ? new Date(at) : null;
        if (d && Number.isFinite(d.getTime())) setMemberSince(fmtPointMonth(d.getFullYear(), d.getMonth()));
      } catch { /* the line is simply not drawn */ }
    })();
    return () => { live = false; };
  }, [cd.id]);
  const statsLine = [age != null ? age + ' yrs' : null, heightLabel(cd.heightCm, lu), weightLabel(cd.weightKg, wu)]
    .filter(Boolean).join(' · ') || 'Add your height and weight';
  const solo = cd.coachingMode === 'solo';
  // ── the hub is not a list any more, and it is not written down here ───────
  //
  // There used to be a HUB_GROUPS const above this: forty-one rows, hand
  // written, a second copy of src/lib/features.ts that nobody diffed against
  // the first. Twice, a screen ended up in neither list and had no route into
  // it from anywhere in the app — ten screens the first time, eight the second,
  // among them the one that changes a member's own password. The header of
  // src/lib/features.ts is the write-up of both.
  //
  // The list is gone. Every row below comes from CLIENT_FEATURES, filed by its
  // `meGroup`, so adding a screen to the index is the same act as putting it
  // on this screen and the two cannot drift. scripts/check-client-index.mjs
  // fails the build on a client screen that is in neither the index nor the
  // written-down exclusions.
  //
  // Forty-one rows in one column became six cards. Each opens a list of what
  // is in it, which is one more tap and a name to aim at, and the search field
  // above them is the shortcut for anyone who already knows what they want.
  const groups = useMemo(() => ME_GROUPS.map((g) => ({
    ...g,
    items: meGroupFeatures(g.key).filter((f) => !(solo && f.soloHide)),
  })).filter((g) => g.items.length > 0), [solo]);
  // The three under the cards. Fixed, and the heading does not claim they are
  // this member's own — see ME_QUICK in src/lib/features.ts for why that is not
  // a shortcut worth taking.
  const quick = useMemo(() => ME_QUICK
    .map((r) => CLIENT_FEATURES.find((f) => f.route === r))
    .filter((f): f is Feature => !!f && !(solo && f.soloHide)), [solo]);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* ── head: the mockup's Me opens on a centred title with one control,
            Settings, at the trailing edge. A tab root, so nothing to go back to:
            the leading slot is the blank of the same width. */}
        <PageHead title="Profile" leading={null}
          trailing={<Ghost icon="settings" a11yLabel="Settings" onPress={() => router.push('/(client)/settings')} />} />

        {/* ── the hero: who you are, and who you are with ─────────────────
            The approved night card, off the kit, above the tiles, the search
            field and the six cards, which are untouched under it. The name is
            the headline, the photo sits at the trailing edge where a ring
            would, "Member since" is the eyebrow and the body line is the meta.
            Edit Profile is the one action.

            An empty name used to read "Add Your Name" while the profile was
            still being read, and after a read that failed: an instruction to
            re-enter something the server may well hold. The headline now says
            which of the three it is, and so does the meta line under it, for
            the same reason ("Add your height and weight" over a read that has
            not landed). "Member since" is drawn only when the account's own
            date was read; see `memberSince` above. */}
        <HeroCard
          eyebrow={memberSince ? `MEMBER SINCE ${memberSince.toUpperCase()}` : 'YOUR PROFILE'}
          title={cd.name
            || (cd.profileStatus === 'loading' ? 'Reading Your Profile'
              : !isWhole(cd.profileStatus) ? 'Profile Not Read'
              : 'Add Your Name')}
          meta={isWhole(cd.profileStatus) ? statsLine
            : cd.profileStatus === 'loading' ? 'Reading your details…'
            : 'Your details could not be read. This is not a profile with nothing on it. Pull down to try again.'}
          ring={
            <Pressable onPress={changePhoto} disabled={photoBusy} accessibilityState={{ disabled: photoBusy }} accessibilityRole="button"
              accessibilityLabel={photoBusy ? 'Uploading your profile photo' : 'Change your profile photo'}>
              {/* `avatarSource`, not `cd.photo`. A row still holding a device
                  path from before the upload existed would otherwise draw here,
                  and only here, on the one device that can open it, which is
                  exactly how nobody noticed the coach could not. */}
              {avatarSource(cd.photo) ? (
                <Image source={{ uri: avatarSource(cd.photo)! }} style={{ width: 84, height: 84, borderRadius: radius.pill, backgroundColor: t.night2 }} />
              ) : (
                <View style={{ width: 84, height: 84, borderRadius: radius.pill, backgroundColor: t.night2, alignItems: 'center', justifyContent: 'center' }}>
                  {cd.init ? (
                    <Text style={{ ...value(30), color: t.nightInk }}>{cd.init}</Text>
                  ) : (
                    <Icon name="me" size={32} color={t.nightInk} />
                  )}
                </View>
              )}
              <View style={{ position: 'absolute', bottom: -2, end: -2, width: 26, height: 26, borderRadius: radius.pill, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', ...elevation.card }}>
                <Icon name="camera" size={14} color={t.ink2} />
              </View>
            </Pressable>
          }
          cta={{ label: 'Edit Profile', onPress: openEdit }}>
          {/* ── who you are WITH ─────────────────────────────────────────
              `coachLinked` is the fact (`clients.trainer_id`), and it is
              three-valued: null is a read that has not landed, and under it
              this line is not drawn at all rather than telling a coached
              member they are on their own. It opens Your Coach, which says the
              right thing in either case. No name: a client cannot read their
              coach's row from here (see the header of
              app/(client)/my-coach.tsx). */}
          {cd.coachLinked != null ? (
            <Pressable onPress={() => router.push('/(client)/my-coach')} accessibilityRole="button" hitSlop={10}
              accessibilityLabel={cd.coachLinked ? 'You are working with a coach. Opens Your Coach' : 'You are training on your own. Opens Your Coach'}
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xs, marginTop: sp.md, alignSelf: 'flex-start' }}>
              <Icon name="people" size={14} color={t.nightInk2} />
              <Text style={{ ...ty.caption, color: t.nightInk2 }}>{cd.coachLinked ? 'Working With a Coach' : 'Training on Your Own'}</Text>
              <Icon name={FORWARD_ICON} size={12} color={t.nightInk2} />
            </Pressable>
          ) : null}
        </HeroCard>

        {/* ── search, before anything else ──────────────────────────────────
            Not a second search. It is the field Explore already owns, sitting
            where a member looks first; tapping it opens that screen. A member
            who knows the word for what they want should never have to know
            which of six cards it was filed under. */}
        <Pressable onPress={() => router.push("/(client)/explore")} accessibilityRole="button"
          accessibilityLabel="Search anything in Repple"
          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, marginTop: sp.lg }}>
          <Icon name="search" size={16} color={t.ink3} />
          <Text style={{ ...ty.body, color: t.ink3 }}>Search anything in Repple</Text>
        </Pressable>

        {/* ── the six ───────────────────────────────────────────────────────
            A card with a coloured spine, its name, and the line that says what
            is behind it. The spine is the group's Tone through the data
            palette — never a hex here. */}
        <View style={{ gap: sp.sm, marginTop: sp.lg }}>
          {groups.map((g) => (
            <Pressable key={g.key} onPress={() => router.push({ pathname: '/(client)/me-group', params: { g: g.key } })}
              accessibilityRole="button" accessibilityLabel={`${g.title}. ${g.note}. ${g.items.length} screens`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, backgroundColor: t.surface, borderRadius: radius.lg, padding: sp.lg, borderStartWidth: 4, borderStartColor: toneOf(t, g.tone).mark, ...elevation.card }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...ty.head, color: t.ink }}>{g.title}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{g.note}</Text>
              </View>
              <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{g.items.length}</Text>
              <Icon name={FORWARD_ICON} size={18} color={t.ink3} />
            </Pressable>
          ))}
        </View>

        {/* ── three shortcuts, and an honest heading over them ─────────────
            ME_QUICK_TITLE is "Most People Start Here", not "You open these
            most". Nothing records which screens THIS member opens, so the
            second sentence would be a claim about them that the app has no
            basis for. See ME_QUICK in src/lib/features.ts. */}
        {quick.length ? (
          <Section style={{ marginTop: sp.lg }}>
            <SectionHead title={ME_QUICK_TITLE} />
            {quick.map((f) => (
              <ListRow key={f.route} icon={f.icon} tone="brand" title={f.label} note={f.note}
                onPress={() => router.push(f.route as any)} />
            ))}
          </Section>
        ) : null}


        {/* The mockup's three: workouts, badges, best streak — each a tile of
            its own on the ground, in its own hue, over its own eight weeks. All
            counted off the training log, and only under a WHOLE read of it. A
            log read at the row cap is a prefix of somebody's history, and a
            count over a prefix stated as a total is the invented figure this
            app refuses everywhere else; every tile is a dash, with no line
            under it, until the read is whole. Weight and body fat are on
            Progress. */}
        <KpiRow tiles onPress={(k) => router.push(k.route as any)} items={[
          { label: 'Workouts', value: logWhole ? fig(activeDays(log).length) : fig(null), unit: logWhole ? 'days' : undefined, tone: 'brand', trend: trends?.workouts, route: '/(client)/consistency' },
          { label: 'Badges', value: badgesCountable ? fig(earnedCount) : fig(null), unit: badgesCountable ? `of ${BADGE_COUNT}` : undefined, tone: 'amber', trend: trends?.badges, route: '/(client)/achievements' },
          { label: 'Best Streak', value: logWhole ? fig(longestStreak(log)) : fig(null), unit: logWhole ? 'days' : undefined, tone: 'orange', trend: trends?.streak, route: '/(client)/consistency' },
        ]} />
        {/* What period and what source — a figure without either is a number
            (rule 2). One line, because under a read that is not whole it is the
            reason the tiles are dashes, and that is data rather than prose. */}
        <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
          {logWhole ? 'All time, from your training log · lines are the last 8 weeks' : 'Your training log has not been read in full, so these are not counted'}
        </Text>

        {/* ── badges: what they hold, as medals ─────────────────────────────
            Earned ones in their hue, the rest grey behind a lock — and a badge
            whose state is not KNOWN (a read that failed, or stopped short) is
            grey with no lock on it, because a lock is a claim that it has not
            been earned. "n of 12" is the head's link and opens the full set. */}
        <Section>
          <SectionHead title="Badges" note={badgesCountable ? `${earnedCount} of ${BADGE_COUNT}` : 'See All'} onPress={() => router.push('/(client)/achievements')} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: sp.sm }}>
            {medalRow.map((m) => {
              const earned = m.state === 'earned';
              const c = medalColours(t, earned ? BADGE_LOOK[m.key].tone : 'neutral');
              return (
                <View key={m.key} accessible accessibilityRole="image"
                  accessibilityLabel={`${m.title}, ${earned ? 'earned' : m.state === 'locked' ? 'locked' : 'not known'}`}
                  style={{ width: 54, height: 54, borderRadius: radius.pill, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
                  {earned ? <Icon name={BADGE_LOOK[m.key].icon} size={26} color={c.ink} />
                    : m.state === 'locked' ? <Icon name="lock" size={22} color={c.ink} />
                    : <Text style={{ ...ty.head, color: c.ink }}>{fig(null)}</Text>}
                </View>
              );
            })}
          </View>
          {!badgesCountable && logStatus !== 'loading' ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Not every badge could be read, so they are not counted. Anything shown as earned really is.</Text>
          ) : null}
        </Section>


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


        {/* ── goal ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Your Goal" />
          {/* Pills that wrap, so every label keeps the reader's text size
              rather than four fixed columns squeezing the longest. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
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
                  style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.lg,
                    paddingVertical: sp.md, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, ...font(on ? '600' : '500'), color: on ? t.brandInk : t.ink2 }}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>


        {/* ── coaching mode ──────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Coaching" />
          {COACH_MODES.map((mm, i) => {
            const on = cd.coachingMode === mm;
            return (
              <Pressable key={mm} onPress={() => cd.setCoachingMode(mm)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${COACHING_MODE_LABEL[mm]}. ${COACHING_MODE_NOTE[mm]}`} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 20, height: 20, borderRadius: radius.pill, borderWidth: 2, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>{on ? <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: t.brand }} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{COACHING_MODE_LABEL[mm]}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{COACHING_MODE_NOTE[mm]}</Text>
                </View>
              </Pressable>
            );
          })}
        </Section>


        {/* ── what this profile adds up to ───────────────────────────────── */}
        <Section>
          {/* The one write on this screen, and whether it landed. clientData's
              push counts the rows it matched — a PostgREST update matching zero
              rows is not an error — and this is where the answer belongs, next
              to the figures it decides. */}
          {cd.saveFailed ? (
            <Flag tone={t.crit} style={{ marginBottom: sp.md }}>
              Your last profile change has not reached the server, so what is on this screen may not be what your coach sees. It keeps retrying. Open Edit and save again if it does not clear.
            </Flag>
          ) : null}
          <SectionHead title="Daily Target" note={macros ? 'Meals' : undefined} onPress={() => router.push('/(client)/nutrition')} />
          {macros ? (
            // The day's target as the mix it is: calories by macro, each in the
            // hue it has on Meals (protein blue, carbs orange, fat purple), with
            // the grams the plan actually sets beside each. 4, 4 and 9 kcal a
            // gram are what `macrosFor` built the grams from, so the ring is
            // that arithmetic read backwards and not a second opinion.
            (() => {
              const slices = [
                { label: 'Protein', value: macros.protein * 4, tone: 'blue' as const, shown: `${num(macros.protein)} g` },
                { label: 'Carbs', value: macros.carbs * 4, tone: 'orange' as const, shown: `${num(macros.carbs)} g` },
                { label: 'Fat', value: macros.fat * 9, tone: 'purple' as const, shown: `${num(macros.fat)} g` },
              ];
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
                  <Donut slices={slices} centre={macros.kcal.toLocaleString()} sub="kcal"
                    spoken={`Daily target, ${macros.kcal.toLocaleString()} kilocalories. ${slices.map((x) => `${x.label} ${x.shown}`).join(', ')}.`} />
                  <Legend items={slices} />
                </View>
              );
            })()
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


      </ScrollView>

      {/* edit profile sheet */}
      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowEdit(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '90%', ...elevation.e2 }}>
          <ScrollView contentContainerStyle={{ padding: G }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
              <Text style={{ ...ty.title, color: t.ink }}>Edit Profile</Text>
              <Pressable onPress={() => setShowEdit(false)} hitSlop={8}><Text style={{ ...ty.body, ...font('600'), color: t.brand }}>Close</Text></Pressable>
            </View>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Name</Text>
            <TextInput value={nameVal} onChangeText={setNameVal} placeholder="Your name" placeholderTextColor={t.ink3} autoCapitalize="words" style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginBottom: sp.lg }} />

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Date of Birth</Text>
            <Pressable onPress={() => setShowDob(true)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
              <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{dobLabel}</Text>
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
              <Field label="Current Weight" hint={wu} a11y={wu === 'kg' ? 'Current weight in kilograms' : 'Current weight in pounds'}>
                <TextInput value={weightVal} onChangeText={setWeightVal} keyboardType="decimal-pad"
                  style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              </Field>
              <View style={{ paddingBottom: 4 }}>
                <Seg options={['kg', 'lb']} value={wu} onChange={switchWeightUnit} t={t} />
              </View>
            </View>
            {weightNote ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{weightNote}</Text> : null}

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Body Fat %</Text>
            <TextInput value={bfVal} onChangeText={setBfVal} keyboardType="decimal-pad" placeholder="e.g. 22" placeholderTextColor={t.ink3} style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, marginBottom: sp.sm }} />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>From your latest scan, or type it in. Changes recalculate your plan.</Text>

            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Diet</Text>
            {/* All diet choices stay visible. Hiding the scroll indicator made
                later choices indistinguishable from choices that did not
                exist, especially once larger text widened every label. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.lg }}>
              {/* Same as the goal above, and for the same reason: the diet
                  decides the macro split, and background colour is not an
                  answer a screen reader can read. */}
              {DIETS.map((d) => (
                <Pressable key={d.id} onPress={() => cd.setDiet(d.id)}
                  accessibilityRole="radio" accessibilityState={{ selected: cd.diet === d.id }}
                  accessibilityLabel={cd.diet === d.id ? `${d.label}. Your diet.` : `Set your diet to ${d.label}`}
                  accessibilityHint="Your diet sets how your daily target is split between protein, carbs and fat"
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: sp.lg, paddingVertical: sp.sm,
                    borderRadius: radius.pill, backgroundColor: cd.diet === d.id ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, ...font(cd.diet === d.id ? '600' : '500'), color: cd.diet === d.id ? t.brandInk : t.ink2 }}>{d.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md, marginBottom: sp.lg }}>
              <Text style={{ ...ty.caption, color: t.ink3 }}>{previewMacros ? <>New target · <Text style={{ ...ty.caption, ...numeric, ...font('600'), color: t.ink }}>{previewMacros.kcal.toLocaleString()} kcal</Text> · P{previewMacros.protein} / C{previewMacros.carbs} / F{previewMacros.fat}</> : 'Enter a weight and body fat to see your target.'}</Text>
            </View>

            <Pressable style={{ backgroundColor: saved ? t.surface2 : t.brand, borderRadius: radius.sm, paddingVertical: sp.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: sp.sm }} onPress={save}>
              {saved ? <Icon name="check" size={16} color={t.ink} /> : null}
              <Text style={{ ...ty.body, ...font('600'), color: saved ? t.ink : t.brandInk }}>{saved ? 'Sending…' : 'Save'}</Text>
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
