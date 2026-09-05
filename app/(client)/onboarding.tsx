// Client setup — the ONLY one, now.
//
// ── What this was ──────────────────────────────────────────────────────────
//
// Two wizards. app/onboarding.tsx ran straight after sign-up and asked photo,
// goal, diet, weight, height and coaching mode; then the dashboard's
// "personalise" banner sent the same person here, and this screen asked name,
// goal, weight, height, body fat, diet, allergens and injuries. Eight steps,
// four of the questions asked twice, and the first wizard asked for weight in a
// box hard-labelled "kg" whatever unit the account reads in — so a member who
// thinks in pounds answered the same question twice and got two different
// bodies out of it, the wrong one written first.
//
// Reported as: "There is a lot of information being presented and if users
// don't know what they are looking at or how to understand it, they will simply
// find it too complicated and not use the app." The instinct is to add a longer
// intake. The answer was to delete one of them. app/onboarding.tsx now sends
// every client here without asking anything, and this is the whole of setup.
//
// ── Four questions, and what each one is for ───────────────────────────────
//
// The list, the order and the sentence justifying each are in
// src/lib/firstRun.ts, so a question added later has to say in writing what
// breaks without it before it can be asked. Dropped from here and asked in
// context instead — name and photo (the profile header already says "Add your
// name"), diet and allergens (on Meals, in the collapsible directly above the
// plan they change), body fat (optional on the body step, and a scan fills it
// in by itself).
//
// ── Shorter still, for somebody the app already knows ──────────────────────
//
// `questionsToAsk` drops a question the account can already answer. A member
// whose coach invited them is not asked how they are coached — two people
// settled that between them and this screen is one of them. A member who stood
// on an InBody scan on the way in is not asked for their weight; the app is
// holding a measured one, and the figure they would type is likelier to be
// wrong. Both together is a two-question setup.
//
// ── Where the progress lives ───────────────────────────────────────────────
//
// The ANSWERS go through clientData as each step is left, so they are on the
// account and on every handset the moment they are given. Only the POSITION is
// device-local (AsyncStorage, `repple.setup.at`) — losing a position costs a
// tap and losing an answer costs the answer, so that is the right way round.
// Force-quitting halfway and relaunching reopens the step you were on.
//
// ── The unit question, kept ────────────────────────────────────────────────
//
// It is not a settings control that wandered onto a first run. On every other
// screen the unit decides how a figure is DRAWN; on this step it decides what
// gets STORED, permanently, before a single calorie target is computed from it.
// `clients.weight_unit` is NULL until somebody taps a unit, so without this the
// first thing a new American member ever types is recorded against a unit
// nobody asked them about.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Cta, Ghost, Field } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { peekJoinCode } from '../../src/ui/pendingJoinCode';
import { weightToKg, heightToCm, heightIn, weightIn, heightParts, kgToLb, cmToIn,
  type WeightUnit, type LengthUnit } from '../../src/lib/units';
import { dayLabel } from '../../src/lib/bodyFigures';
import { COACHING_MODE_LABEL, COACHING_MODE_NOTE, type CoachingMode, type Goal } from '../../src/lib/types';
import { INJURY_AREAS, newInjuryId } from '../../src/lib/injuries';
import {
  SETUP_QUESTIONS, EMPTY_DRAFT, questionsToAsk, readDraft, resumeAt, type SetupStep,
} from '../../src/lib/firstRun';
import { isWhole } from '../../src/ui/loadStatus';

export const ONBOARD_KEY = 'repple.onboarded';
/** Where setup got to, on this device. See the header. */
export const SETUP_AT_KEY = 'repple.setup.at';

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

const MODES: CoachingMode[] = ['online', 'inperson', 'hybrid', 'solo'];

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

  const [cmode, setCmode] = useState<CoachingMode>(c.coachingMode);
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
  // something somebody measured or nothing at all.
  const scanW = fromScan.weightKg == null ? '' : String(Math.round((weightIn(fromScan.weightKg, wuInit) ?? 0) * 10) / 10);
  const scanBf = fromScan.bodyFatPct == null ? '' : String(Math.round(fromScan.bodyFatPct * 10) / 10);
  const [weight, setWeight] = useState(scanW);
  const [height, setHeight] = useState(scanHeight.whole);    // centimetres, or whole feet
  const [heightInVal, setHeightInVal] = useState(scanHeight.inches); // inches, imperial only
  const [bf, setBf] = useState(scanBf);
  const [injAreas, setInjAreas] = useState<string[]>([]);

  // Whether the boxes arrived with anything in them, and what to call the
  // source. `scans` is oldest-first, so the newest is the last element.
  const latestScan = c.scans.length ? c.scans[c.scans.length - 1] : null;
  const prefilled = scanW !== '' || scanBf !== '' || scanHeight.whole !== '';
  const lastScanLabel = latestScan && (scanW !== '' || scanBf !== '')
    ? `${latestScan.source || 'scan'}, ${dayLabel(latestScan.takenAt)}`
    : null;

  // ── Which questions this account gets, decided once ───────────────────────
  //
  // Latched behind `status`, and null until it is. clientData hydrates from the
  // device and then from the server, so at the first frame `coachLinked` and
  // `weightKg` are both empty for everybody — deciding on them would ask a
  // coached, measured member all four questions and then pull two of them out
  // from under their thumb a moment later.
  const [steps, setSteps] = useState<SetupStep[] | null>(null);
  useEffect(() => {
    if (steps != null || c.status === 'loading') return;
    setSteps(questionsToAsk({ coachingAgreed: c.coachLinked === true, weighed: c.weightKg != null }));
  }, [steps, c.status, c.coachLinked, c.weightKg]);

  // ── Where it reopens ──────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (steps == null || restored) return;
    let gone = false;
    (async () => {
      let d = EMPTY_DRAFT;
      try { const raw = await AsyncStorage.getItem(SETUP_AT_KEY); if (raw) d = readDraft(JSON.parse(raw)); } catch { /* start at the beginning */ }
      if (gone) return;
      setStep(resumeAt(steps, d));
      setRestored(true);
    })();
    return () => { gone = true; };
  }, [steps, restored]);

  // Written on every move, so a force-quit halfway reopens where it was. Best
  // effort: a position we could not store costs taps, never answers.
  useEffect(() => {
    if (steps == null || !restored) return;
    AsyncStorage.setItem(SETUP_AT_KEY, JSON.stringify({ at: steps[step] })).catch(() => {});
  }, [steps, step, restored]);

  const st = stInit;
  const wu = st.weightUnit;
  const lu = st.lengthUnit;
  // True while the tinted pill is the app's reading of the phone's region
  // rather than an answer. Both are checked because either can be unset on its
  // own — a member may have picked pounds long ago and never touched height.
  const unitsGuessed = st.weightSource === 'device' || st.lengthSource === 'device';

  // The same bounds, said in the unit being typed. Rounded to whole units so
  // the comparison is against a number of the same shape as the one in the box.
  const minWeight = wu === 'lb' ? Math.round(kgToLb(MIN_KG)) : MIN_KG;
  const maxWeight = wu === 'lb' ? Math.round(kgToLb(MAX_KG)) : MAX_KG;
  const minHeight = lu === 'in' ? Math.round(cmToIn(MIN_CM)) : MIN_CM;
  const maxHeight = lu === 'in' ? Math.round(cmToIn(MAX_CM)) : MAX_CM;

  /**
   * Switch the unit the weight box is being typed in, and carry what is already
   * in it across.
   *
   * The carrying is the whole point. A member who typed 180 with "lb" lit and
   * then taps "kg" means the same body — leaving the digits where they are and
   * relabelling them is precisely the stored-record corruption this screen's
   * header is about, except done by the app rather than by the missing
   * preference. The value goes out to kilograms and back through the same
   * functions the record uses, and units.test.ts sweeps that trip for
   * losslessness at these grains, so nothing is shaved off by switching twice.
   */
  const changeWeightUnit = (u: WeightUnit) => {
    if (u === wu) return;
    const kg = weightToKg(weight, wu);
    const carried = kg == null ? null : weightIn(kg, u);
    setWeight(carried == null ? '' : String(carried));
    st.set({ weightUnit: u });
  };

  /** The same for height, which is one box in metric and two in imperial — so
   *  the carry has to go through centimetres, not through the digits. */
  const changeLengthUnit = (u: LengthUnit) => {
    if (u === lu) return;
    const cm = heightToCm(height, lu, heightInVal);
    if (cm == null) { setHeight(''); setHeightInVal(''); }
    else if (u === 'in') {
      const parts = heightParts(cm);
      setHeight(parts ? String(parts.feet) : '');
      setHeightInVal(parts ? String(parts.inches) : '');
    } else {
      const whole = heightIn(cm, 'cm');
      setHeight(whole == null ? '' : String(whole));
      setHeightInVal('');
    }
    st.set({ lengthUnit: u });
  };

  /**
   * Write down the step being left.
   *
   * Committed as each step is left rather than all at the end, so a setup
   * abandoned halfway keeps what it was told. Every one of these is idempotent:
   * going Back and forward again re-writes the same value.
   */
  const commit = (id: SetupStep) => {
    if (id === 'coaching') c.setCoachingMode(cmode);
    if (id === 'goal') c.setGoal(goal);
    if (id === 'body') {
      // Judge the figure the client actually typed against a bound on the same
      // scale, then store the metric it converts to. Both steps matter: the
      // check has to see pounds as pounds, and the record has to receive
      // kilograms.
      const w = parseFloat(weight);
      if (w > minWeight && w < maxWeight) { const kg = weightToKg(weight, wu); if (kg != null) c.setWeightKg(kg); }
      // Height comes from one box in metric and two in imperial, so the typed
      // magnitude is recovered from the centimetres rather than re-parsed: feet
      // and inches are only a plausible height taken together.
      const cm = heightToCm(height, lu, heightInVal);
      const h = heightIn(cm, lu);
      if (cm != null && h != null && h > minHeight && h < maxHeight) c.setHeightCm(cm);
      // Body fat is a percentage and is stored exactly as typed. There is no
      // such thing as an imperial percentage.
      const b = parseFloat(bf); if (b > 3 && b < 70) c.setBodyFat(b);
    }
    if (id === 'injuries') {
      // Only areas that are not already recorded as active. This screen can be
      // reopened from the dashboard's banner and from Getting Started, and a
      // second pass over the same pills used to file the same knee twice.
      const already = new Set(c.injuries.filter((i) => i.status === 'active').map((i) => i.area));
      injAreas
        .filter((area) => !already.has(area))
        .forEach((area) => c.addInjury({ id: newInjuryId(), area, severity: 'moderate', status: 'active', at: new Date().toISOString() }));
    }
  };

  /** Setup is over. Mark it, forget the position, and go somewhere useful. */
  const leave = async (mode: CoachingMode) => {
    try { await AsyncStorage.setItem(ONBOARD_KEY, '1'); } catch { /* ignore */ }
    try { await AsyncStorage.removeItem(SETUP_AT_KEY); } catch { /* ignore */ }
    // A code is waiting when this account was created off the back of a coach's
    // invite link: app/join.tsx stored it before sending them to sign up, and
    // /(client)/trainers is the only screen that spends it. Routing on the
    // coaching answer alone dropped it — somebody who tapped their coach's link
    // and then answered "On my own" (the honest answer for a client with no
    // coach YET) landed on the dashboard with their coach's code sitting unspent
    // in storage and nothing on screen mentioning it.
    //
    // A failed read is treated as no code: it costs the prefill, never the
    // account. And somebody already linked to a coach goes home — Find a
    // Trainer is a directory of coaches they do not need.
    let pending: string | null = null;
    try { pending = await peekJoinCode(); } catch { pending = null; }
    // ── "you have no coach" is a claim, and it needs a whole read ───────────
    //
    // This was `c.coachLinked !== true`. `coachLinked` is `boolean | null`, and
    // null is what clientData holds when the read did not land — so under
    // 'error' (and under 'partial') the expression turned "we could not check
    // whether you have a coach" into "you do not have one", and the last thing
    // that happened to somebody at the end of their very first setup was being
    // dropped into a directory of coaches to find the one they already have.
    // src/ui/loadStatus.ts is explicit that an empty answer under 'error' means
    // UNKNOWN, and `isWhole` is the gate the house rule asks for.
    //
    // Unknown routes HOME, not to the directory: the dashboard carries its own
    // read-failure warnings and its own route to Find a Trainer, so a member
    // who really is uncoached loses one tap, while a coached member is no
    // longer told, by where they land, something untrue about their own coach.
    // A pending join code is a fact about this device and is unaffected — it
    // still sends them to the screen that spends it.
    const knownUncoached = isWhole(c.status) && c.coachLinked !== true;
    const needsCoach = mode !== 'solo' && knownUncoached;
    router.replace(needsCoach || pending ? '/(client)/trainers' : '/(client)/dashboard');
  };

  const finish = async () => {
    if (steps) steps.forEach(commit);
    await leave(steps && steps.includes('coaching') ? cmode : c.coachingMode);
  };

  // Available on every step, not only the first. Everything here is skippable
  // by construction — the app runs on defaults and each of these screens is
  // reachable again from Getting Started — and a wizard you can only escape
  // from its first card is the complaint this work exists to answer.
  const skip = async () => { await leave(c.coachingMode); };

  const Chip = ({ on, label, sub, onPress }: { on: boolean; label: string; sub?: string; onPress: () => void }) => (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={{ backgroundColor: on ? t.brand : t.surface2, borderRadius: radius.sm, padding: sp.lg, marginBottom: sp.sm }}>
      <Text style={{ ...ty.body, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink }}>{label}</Text>
      {sub ? <Text style={{ ...ty.caption, color: on ? t.brandInk : t.ink3, marginTop: 2, opacity: on ? 0.85 : 1 }}>{sub}</Text> : null}
    </Pressable>
  );
  const Pill = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label}
      style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: on ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
  const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md } as const;

  const CARDS: Record<SetupStep, React.ReactNode> = {
    coaching: (
      <View>
        <Text style={{ ...ty.title, color: t.ink }}>How Are You Training?</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.xl }}>
          This decides what the rest of the app offers you. You can change it later under Me.
        </Text>
        {MODES.map((m) => (
          <Chip key={m} on={cmode === m} label={COACHING_MODE_LABEL[m]} sub={COACHING_MODE_NOTE[m]} onPress={() => setCmode(m)} />
        ))}
      </View>
    ),
    goal: (
      <View>
        <Text style={{ ...ty.title, color: t.ink }}>What Are You After?</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.xl }}>Your training plan and your macro split are both built from this.</Text>
        {GOALS.map((g) => <Chip key={g.id} on={goal === g.id} label={g.label} sub={g.sub} onPress={() => setGoal(g.id)} />)}
      </View>
    ),
    body: (
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
        {/* ── The question, asked where the answer changes the record ─────
            Not a settings control that has wandered onto a first run. On every
            other screen the unit decides how a figure is drawn; here it decides
            what gets STORED, so it belongs directly above the two boxes it
            governs. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.sm, marginBottom: unitsGuessed ? sp.sm : sp.lg }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Weight in</Text>
          <Pill on={wu === 'kg'} label="kg" onPress={() => changeWeightUnit('kg')} />
          <Pill on={wu === 'lb'} label="lb" onPress={() => changeWeightUnit('lb')} />
          <Text style={{ ...ty.micro, color: t.ink3 }}>· height in</Text>
          <Pill on={lu === 'cm'} label="cm" onPress={() => changeLengthUnit('cm')} />
          <Pill on={lu === 'in'} label="ft / in" onPress={() => changeLengthUnit('in')} />
        </View>
        {unitsGuessed ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>
            We&#8217;ve gone by your phone&#8217;s region — tap to change it. Your weight is stored once, and
            in the wrong unit it is out by more than double.
          </Text>
        ) : null}
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
    injuries: (
      <View>
        <Text style={{ ...ty.title, color: t.ink }}>Anything to Train Around?</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs, marginBottom: sp.sm }}>Your plan and your coach will avoid loading these areas and offer safer swaps.</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>Guidance only, not medical advice — see a professional for pain or a diagnosis.</Text>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Tap any that apply</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {INJURY_AREAS.filter((a) => a.id !== 'other').map((a) => { const on = injAreas.includes(a.id); return (
            <Pill key={a.id} on={on} label={a.label} onPress={() => setInjAreas((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))} />); })}
        </View>
        {/* rtl-ok: a navigation PATH inside an English sentence — "the screen
            called X, and inside it the thing called Y". The separator belongs to
            the sentence, not to the layout: dropping FORWARD_CHAR into it would
            put a mirrored chevron in the middle of an unmirrored English clause,
            which is worse than leaving it. When the catalogue is translated the
            whole sentence moves and the separator goes with it. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{injAreas.length > 0 ? 'You can add severity, notes, and mark these recovered anytime in Me › Injuries & Limitations.' : 'Nothing to declare? Leave this blank — you can add them later in Me › Injuries.'}</Text>
      </View>
    ),
  };

  // Nothing at all until the question list is settled. A frame of the wrong
  // wizard is worse than a frame of the background: see the latch above.
  if (steps == null || !restored) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;

  const id = steps[step];
  const last = step === steps.length - 1;
  const q = SETUP_QUESTIONS.find((x) => x.id === id);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: layout.gutter, paddingTop: sp.md }}>
        <View style={{ flexDirection: 'row', gap: 5, flex: 1 }}>
          {steps.map((_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? t.brand : t.surface3 }} />)}
        </View>
        {/* On every card, not only the first. */}
        <Ghost label="Skip" onPress={skip} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: sp.xl, paddingBottom: sp.xl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>Step {step + 1} of {steps.length}</Text>
        {CARDS[id]}
        {/* The reason this question is being asked, in the same words the
            module justifies it with. A setup that says what each answer is FOR
            is shorter to read than one of the same length that does not. */}
        {q ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xl }}>Skip this and {q.breaks}.</Text>
        ) : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: layout.gutter, paddingBottom: sp.lg }}>
        {step > 0 ? <Ghost label="Back" onPress={() => { commit(id); setStep(step - 1); }} /> : null}
        <View style={{ flex: 1 }}>
          <Cta label={last ? 'Start Training' : 'Continue'} onPress={() => { if (last) { void finish(); } else { commit(id); setStep(step + 1); } }} wide />
        </View>
      </View>
    </SafeAreaView>
  );
}
