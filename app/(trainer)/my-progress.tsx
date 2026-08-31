// Trainer · My Progress — the coach's OWN body stats, weight trend and scans.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// The third of the three things a coach could track for everybody except
// themselves. app/(trainer)/my-training.tsx gave them their own workout log and
// app/(trainer)/my-nutrition.tsx their own food log; this is where their own
// weight, their own tape measurements and their own body composition live.
//
// Both providers behind it read and write the SIGNED-IN USER'S rows —
// `check_ins.user_id = auth.uid()` and `measurements.user_id = auth.uid()` —
// and both of those columns reference `profiles`, which every account has. So a
// coach weighing in here writes a row of their own, and no migration was needed
// for it. It is stated in the tab title, the kicker, the sentence under the
// heading and every empty state, for the reason my-training.tsx sets out: a
// coach must be able to tell in one look that they are not reading a client.
//
// ── Why the weight trend is built from CHECK-INS and not from scans ────────
//
// The client app leads its Progress tab with the InBody figures on
// `useClientData`, and that provider is the wrong source here — not as a
// judgement call, but because it cannot answer for a coach at all:
//
//   · `useClientData` reads the rest of the profile from `clients`, and
//     `provision_profile()` gives a role='trainer' signup a `trainers` row and
//     no `clients` row. Confirmed against the live database: none of the eight
//     trainer profiles and none of the three owner profiles has one. So the
//     goal, diet and height on that provider are constructed defaults for a
//     coach rather than answers a coach gave.
//   · That read is `.maybeSingle()`, and it must STAY `.maybeSingle()`. It was
//     once `.single()`, which reports a missing row as the error PGRST116 —
//     and a coach's missing `clients` row is structural and permanent, so
//     `profileStatus` (and the combined `status` built from it) went to
//     'error' on every coach launch and never cleared. The whole coach app ran
//     on a profile read it believed had failed.
//
// A weigh-in is not: `check_ins` carries `weight_kg` beside the four scores,
// keyed to `profiles`, and a coach can write one. So the trend on this screen
// is the coach's own weigh-ins — a weekly series, which is the grain a weight
// trend wants — rather than the handful of scans a person takes in a year.
// That stays true now that scans work, and is why the hero is unchanged.
//
// ── Body composition, which used to be read-only ───────────────────────────
//
// `scans.client_id` was `references clients(id)` too, so a scan INSERT was
// refused on the foreign key however well-formed it was, and this section
// listed whatever the account happened to have and offered no way to add to
// it. supabase/parts/95-own-food-and-scans.sql repointed it at `profiles(id)`,
// and that part is APPLIED to the live database — read off pg_constraint, not
// taken from the file:
//
//     scans_client_id_fkey  FOREIGN KEY (client_id)
//                           REFERENCES profiles(id) ON DELETE CASCADE
//
// and an insert run as a real role='trainer' account, under RLS
// (`scans_owner` is `for all using (client_id = auth.uid())`, which a coach
// passes), is accepted and reads back. So the section below now takes an
// entry, and it is the same `useClientData.addScan` the client app writes
// through — not a second write path with its own idea of what a scan is.
//
// A scan here is what feeds `weightKg` and `bodyFatPct` on `useClientData`,
// which is what My Nutrition needs before it can build a daily calorie target.
// That is the whole chain a coach could not complete: scan → body → target.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, Spark, Cta, Ghost, Notice, PartialRead, Flag, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value as valueType } from '../../src/theme/scale';
import { useCheckIns, type CheckIn } from '../../src/ui/checkins';
import { useMeasurements, METRICS, type MeasureEntry } from '../../src/ui/measurements';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { isWhole, worstStatus } from '../../src/ui/loadStatus';
import { notifySuccess } from '../../src/ui/haptics';
import {
  weightIn, weightLabel, weightToKg, weightDeltaIn, kgToLb,
  lengthIn, lengthLabel, lengthToCm, lengthDeltaIn, plain, convertedNote,
} from '../../src/lib/units';
import { agoLabel, dayLabel, shortDayLabel, daysBetween, todayISO, STALE_AFTER_DAYS } from '../../src/lib/bodyFigures';
import { num1 } from '../../src/lib/format';

// The range a human weighs, in the kilograms this app stores. Metric because
// the record is metric; the bounds are converted for whichever unit the coach
// is typing in, so the refusal quotes numbers on the same scale as the number
// in the box. Same two constants, and the same reasoning, as the client's
// weekly check-in — see app/(client)/checkin.tsx, where typing 180 lb into a
// field validated 20–400 wrote 180 kg to the record.
const MIN_KG = 20;
const MAX_KG = 400;

// The range a body-fat percentage can be. A percentage is a percentage in
// every unit system, so unlike the weight above these need no conversion — but
// they are still bounds rather than a coercion: a mistyped 155 is refused, not
// clamped to 70, because a clamped figure is a measurement nobody took and it
// would go straight into the calorie target My Nutrition builds from it.
const MIN_BF = 3;
const MAX_BF = 70;

/** How many weigh-ins the trend draws. Beyond this the line is a history
 *  screen rather than a trend a coach reads at a glance. */
const TREND_POINTS = 24;

/** A 1–5 score, unset until it is tapped. Never pre-selected: a score nobody
 *  chose, filed under the coach's own name, is an invented week. */
function Rating({ t, label, score, onChange }: { t: Theme; label: string; score: number; onChange: (v: number) => void }) {
  return (
    <View style={{ marginBottom: sp.md }}>
      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink2, marginBottom: sp.sm }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: sp.sm }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => onChange(n)} accessibilityRole="button"
            accessibilityLabel={`${label}: ${n} of 5`} accessibilityState={{ selected: score === n }}
            style={{ flex: 1, aspectRatio: 1.6, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: score === n ? t.brand : t.surface2 }}>
            <Text style={{ ...valueType(17), color: score === n ? t.brandInk : t.ink3 }}>{n}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function MyProgress() {
  const t = useTheme();
  const router = useRouter();
  const ci = useCheckIns();
  const ms = useMeasurements();
  const cd = useClientData();
  const settings = useSettings();
  const wu = settings.weightUnit;
  const lu = settings.lengthUnit;
  const today = todayISO();

  // Each provider answers for its own section, and the header answers for the
  // screen. An empty list under 'error' is "we could not read it", never "you
  // have never measured yourself"; under 'partial' the rows are real but a
  // change-since-you-started computed over them would be a span across an
  // unknown fraction of the record.
  const bodyStatus = worstStatus(ci.status, ms.status);
  const weighKnown = ci.status !== 'error';
  const weighWhole = isWhole(ci.status);
  const tapeKnown = ms.status !== 'error';

  /* ── the weight series ───────────────────────────────────────────────── */

  // Every check-in that actually carries a weight, newest first.
  //
  // The filter is not paranoia: `check_ins.weight_kg` is a nullable column and
  // src/ui/checkins.tsx reads it as `Number(r.weight_kg)`, which turns a NULL
  // into 0. A 0 charted is not a small reading, it is a cliff, and printed
  // beside "Your Latest Weight" it is a claim that a person weighs nothing.
  // Absent is treated as absent here and renders as a dash.
  const weighed = useMemo(
    () => ci.checkins.filter((c) => Number.isFinite(c.weightKg) && c.weightKg > 0),
    [ci.checkins],
  );

  // The chart wants the opposite order, and the tail rather than the head: a
  // coach who has weighed in weekly for a decade wants this year on the line,
  // not 2016.
  const trend = useMemo(() => {
    const chrono = [...weighed].reverse();
    return chrono.slice(Math.max(0, chrono.length - TREND_POINTS));
  }, [weighed]);

  const latest: CheckIn | null = weighed[0] ?? null;
  const previous: CheckIn | null = weighed[1] ?? null;
  const shownWeight = weightIn(latest?.weightKg, wu);
  const sinceLast = latest && previous ? weightDeltaIn(latest.weightKg - previous.weightKg, wu) : null;
  // Measured over the WHOLE series, not over the window the chart draws:
  // `trend` keeps only the last two dozen points, and a span across those
  // labelled "since start" would silently mean "since two dozen weigh-ins ago"
  // for anybody with a long record.
  //
  // And only over a whole read — the oldest weigh-in in hand is not the oldest
  // one that exists when the list came back truncated, so the same label over
  // that is a span between two arbitrary points.
  const sinceStart = weighWhole && weighed.length > 1
    ? weightDeltaIn(weighed[0].weightKg - weighed[weighed.length - 1].weightKg, wu)
    : null;
  const latestAgo = latest ? agoLabel(latest.at, today) : null;
  const latestDays = latest ? daysBetween(latest.at, today) : null;
  const staleNote = latestDays != null && latestDays > STALE_AFTER_DAYS
    ? `Your last weigh-in is ${latestDays} days old — this figure describes the body you had then.`
    : null;
  const weightNote = convertedNote(wu);
  const tapeNote = convertedNote(lu);

  /* ── logging a weigh-in ──────────────────────────────────────────────── */

  const [typed, setTyped] = useState('');
  const [energy, setEnergy] = useState(0);
  const [sleep, setSleep] = useState(0);
  const [mood, setMood] = useState(0);
  const [adherence, setAdherence] = useState(0);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The bounds said in the unit the coach is typing in. 20–400 kg is 44–882 lb,
  // and telling somebody who typed 180 that the range is "20 to 400" reads as a
  // rejection of a perfectly ordinary weight.
  const minShown = wu === 'lb' ? Math.round(kgToLb(MIN_KG)) : MIN_KG;
  const maxShown = wu === 'lb' ? Math.round(kgToLb(MAX_KG)) : MAX_KG;

  /**
   * Record a weigh-in.
   *
   * The conversion happens before the range check, not after, so the number
   * being judged and the number being stored are the same one. Everything is
   * refused rather than coerced: a blank or unreadable score would have to be
   * written as a 0, which is not a point on a 1–5 scale and would sit in the
   * record as a rating nobody gave.
   *
   * Awaited, and believed only when the row is on the server. `addCheckIn`
   * inserts the entry into `checkins` optimistically, so on a refused write the
   * weigh-in is on this phone alone — and the client app's own check-in screen
   * throws this answer away and says "Check-in sent" regardless, which is the
   * bug this does not repeat.
   */
  const logWeighIn = async () => {
    setProblem(null);
    const kg = weightToKg(typed, wu);
    if (kg == null) { setProblem(`Enter your weight in ${wu}.`); return; }
    if (kg < MIN_KG || kg > MAX_KG) {
      setProblem(`That is outside the range this records — ${minShown} to ${maxShown} ${wu}.`);
      return;
    }
    if (!energy || !sleep || !mood || !adherence) {
      setProblem('Tap a score for energy, sleep, mood and adherence — they are not guessed for you.');
      return;
    }
    setBusy(true);
    const saved = await ci.addCheckIn({ weightKg: kg, energy, sleep, mood, adherence, note: note.trim() });
    setBusy(false);
    if (saved) {
      notifySuccess();
      setTyped(''); setEnergy(0); setSleep(0); setMood(0); setAdherence(0); setNote('');
      Alert.alert('Weigh-in logged', 'It is on your own record and on the trend above.');
      return;
    }
    // The fields are deliberately left as they are: what was typed is the only
    // copy of it, and this is the one path where the coach may want to retry.
    setProblem('Not saved — we could not reach your record. This weigh-in is on this phone only and will be gone when you next open the app.');
  };

  /* ── logging tape measurements ───────────────────────────────────────── */

  const [tape, setTape] = useState<Record<string, string>>({});
  const [tapeBusy, setTapeBusy] = useState(false);
  const setTapeVal = (k: string, v: string) => setTape((s) => ({ ...s, [k]: v }));
  const latestTape = ms.entries[0];
  const prevTape = ms.entries[1];

  /** The last figure logged for this site, in the coach's unit, as the grey
   *  hint. Null when there is none — the hint falls back to the unit rather
   *  than to a number nobody measured. */
  const lastTape = (k: (typeof METRICS)[number]['key']) => {
    const v = lengthIn(latestTape?.[k], lu);
    return v == null ? null : plain(v);
  };

  const saveTape = async () => {
    const parsed: Record<string, number> = {};
    // Typed in the coach's unit, stored in centimetres. `parseFloat` alone
    // reads an inch entry as centimetres, which turns a 32 in waist into a
    // 32 cm one.
    for (const { key } of METRICS) { const cm = lengthToCm(tape[key], lu); if (cm != null && cm > 0) parsed[key] = cm; }
    if (Object.keys(parsed).length === 0) { Alert.alert('Nothing to save', 'Enter at least one measurement.'); return; }
    setTapeBusy(true);
    const stored = await ms.addEntry(parsed);
    setTapeBusy(false);
    if (stored) {
      notifySuccess();
      setTape({});
      Alert.alert('Saved', 'Your measurements are on your own record.');
      return;
    }
    // Not cleared, and not called saved. `addEntry` resolves true only once the
    // rows are on the server.
    Alert.alert('Saved on this phone only',
      'These are on screen but could not be sent to your account, so they will be gone at the next launch. Check your connection and save again.');
  };

  /* ── logging a body scan ─────────────────────────────────────────────── */

  const [scanWt, setScanWt] = useState('');
  const [scanBf, setScanBf] = useState('');
  const [scanSm, setScanSm] = useState('');
  const [scanProblem, setScanProblem] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  /**
   * Record a body-composition scan.
   *
   * Structured exactly like `logWeighIn` above, and for the same reasons: the
   * conversion happens BEFORE the range check, so the number being judged and
   * the number being stored are the same one. This is the write that, in the
   * client app, once filed a 180 lb reading as 180 kg — and because the newest
   * scan is what `useClientData` reports as the body, the wrong body was in the
   * calorie target before the screen had finished closing.
   *
   * Skeletal muscle is OPTIONAL and stays null when it is blank. `parseFloat`
   * on an empty box gives NaN and `|| 0` turns that into a 0 kg muscle reading
   * — a figure nobody measured, filed as if they had, which the chart then
   * draws as a cliff. Blank means "the scale did not report one".
   *
   * Awaited, and believed only when the row is on the server. `addScan` adds
   * the scan optimistically — it moves weight, body fat, muscle, every chart on
   * this screen and the macro target on My Nutrition — so a refused write has
   * to be said rather than left driving all of that until the next launch drops
   * it. The client app's own scan screen does not await this and says "Scan
   * saved" either way; that is the bug this does not repeat.
   */
  const saveScan = async () => {
    setScanProblem(null);
    const kg = weightToKg(scanWt, wu);
    if (kg == null) { setScanProblem(`Enter your weight in ${wu}.`); return; }
    if (kg < MIN_KG || kg > MAX_KG) {
      setScanProblem(`That weight is outside the range this records — ${minShown} to ${maxShown} ${wu}.`);
      return;
    }
    const bf = Number(scanBf.trim());
    if (!scanBf.trim() || !Number.isFinite(bf)) { setScanProblem('Enter your body fat as a percentage.'); return; }
    if (bf < MIN_BF || bf > MAX_BF) {
      setScanProblem(`That body-fat percentage is outside the range this records — ${MIN_BF} to ${MAX_BF}%.`);
      return;
    }
    // Blank is absent, not zero. A typed figure that will not read is refused
    // rather than dropped: silently discarding it would store a scan missing
    // the number the coach thought they had just entered.
    let muscle: number | null = null;
    if (scanSm.trim()) {
      const m = weightToKg(scanSm, wu);
      if (m == null || m <= 0) { setScanProblem(`Muscle mass is not a number this can read. Leave it empty if your scan did not report one.`); return; }
      if (m >= kg) { setScanProblem('Muscle mass has to be less than your total weight.'); return; }
      muscle = m;
    }
    setScanBusy(true);
    const stored = await cd.addScan({
      id: 's' + Date.now(), takenAt: today, weightKg: kg, bodyFatPct: bf,
      skeletalMuscleKg: muscle,
      // Free text, shown as typed wherever a scan is listed. Named for what it
      // actually was — a coach reading their own figures off a machine and
      // typing them in — rather than borrowed from the client app's 'InBody
      // (OCR)', which would claim a sheet was scanned when none was.
      source: 'Entered by me',
    });
    setScanBusy(false);
    if (stored) {
      notifySuccess();
      setScanWt(''); setScanBf(''); setScanSm('');
      Alert.alert('Scan saved', 'It is on your own record, and your daily calorie target on My Nutrition is now built from it.');
      return;
    }
    // Not cleared. What was typed is the only copy of it, and this is the one
    // path where the coach may want to try again.
    setScanProblem('Not saved — we could not reach your record. This scan is on this phone only and will be gone when you next open the app, along with anything built from it.');
  };

  /* ── presentation ────────────────────────────────────────────────────── */

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 };
  const tapeInp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9, width: 96, textAlign: 'center' as const };
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

          {/* ── header. Whose body this is, said before anything else ─────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
            <Ghost icon="back" onPress={() => router.back()} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Your own body, not a client&rsquo;s</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>My Progress</Text>
            </View>
          </View>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
            Every figure on this screen was measured by you, for you, under your own account. No
            client&rsquo;s readings appear here, and nothing you log here reaches a client&rsquo;s record.
          </Text>

          {/* ── can what follows be trusted? ─────────────────────────────── */}
          {bodyStatus === 'error' ? (
            <Section>
              <Notice tone={t.warn} kicker="Your record" title="We couldn’t read your body record"
                note="Your own weigh-ins and measurements are safe — this screen cannot see them right now. Nothing has been reset, and an empty history below means unknown rather than none." />
            </Section>
          ) : bodyStatus === 'partial' ? (
            <Section>
              <PartialRead what="weigh-ins and measurements of your own" shown={ci.checkins.length + ms.entries.length} />
            </Section>
          ) : null}

          <Rule />

          {/* ── the hero: the last weight you recorded ─────────────────────
              The figure goes through `plain` rather than num1: `weightIn` has
              already rounded to the grain the unit can carry — whole pounds, a
              tenth of a kilogram — and a fixed decimal would print a
              whole-pound reading as "180.0". Neither can reach four digits, so
              no thousands separator is due. */}
          <Hero
            label="Your Latest Weight"
            figure={shownWeight == null ? fig(null) : plain(shownWeight)}
            unit={shownWeight == null ? undefined : wu}
            note={shownWeight == null
              ? (ci.status === 'loading'
                ? 'Reading your record…'
                : !weighKnown
                  ? 'Your weigh-ins could not be read, so this is unknown rather than none.'
                  : 'No weigh-in of your own yet — log one below and the trend builds from it.')
              : `${sinceLast != null && sinceLast !== 0
                ? `${sinceLast < 0 ? '−' : '+'}${plain(Math.abs(sinceLast))} ${wu} since ${shortDayLabel(previous!.at)}`
                : sinceLast === 0
                  ? `Unchanged since ${shortDayLabel(previous!.at)}`
                  : 'First weigh-in'} · measured ${dayLabel(latest!.at)}${latestAgo ? ` · ${latestAgo}` : ''}`}
          />
          {staleNote ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{staleNote}</Text> : null}
          {weightNote && shownWeight != null ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{weightNote}</Text>
          ) : null}

          <Rule />

          {/* ── the trend ────────────────────────────────────────────────── */}
          <Section>
            {/* The note counts the whole series, not the drawn window, and only
                when the read was whole — a count over a truncated list is not
                a count. */}
            <SectionHead title="Your Weight Trend" note={weighWhole && weighed.length ? `${weighed.length} weigh-ins` : undefined} />
            {trend.length >= 2 ? (
              <Spark
                data={trend.map((c) => weightIn(c.weightKg, wu) ?? c.weightKg)}
                labels={trend.map((c) => c.at)}
                unit={` ${wu}`}
              />
            ) : (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                {ci.status === 'loading'
                  ? 'Reading your record…'
                  : !weighKnown
                    ? 'Your weigh-ins could not be read, so there is no trend to draw. They have not gone anywhere — this screen cannot see them right now.'
                    : 'A trend needs two weigh-ins of your own. Log one below, and another next week.'}
              </Text>
            )}
            <View style={{ marginTop: sp.lg }}>
              <KpiRow items={[
                { label: 'Since Last', value: sinceLast == null ? fig(null) : `${sinceLast > 0 ? '+' : sinceLast < 0 ? '−' : ''}${plain(Math.abs(sinceLast))}`, unit: sinceLast == null ? undefined : wu },
                { label: 'Since Start', value: sinceStart == null ? fig(null) : `${sinceStart > 0 ? '+' : sinceStart < 0 ? '−' : ''}${plain(Math.abs(sinceStart))}`, unit: sinceStart == null ? undefined : wu },
                // A count over an unread or truncated list is not a count.
                { label: 'Weigh-ins', value: weighWhole ? fig(weighed.length) : fig(null) },
              ]} />
              {!weighWhole ? (
                <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
                  {ci.status === 'loading'
                    ? 'Reading your record…'
                    : ci.status === 'partial'
                      ? 'Your record came back short, so a change since you started would be measured from whichever weigh-in happened to arrive first rather than from your first.'
                      : 'Your record could not be read, so there is nothing here to count.'}
                </Text>
              ) : null}
            </View>
          </Section>

          <Rule />

          {/* ── log a weigh-in ───────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Log a Weigh-in" note={wu} />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              Your weight and how the week has gone. Stored against your own account — no client and no
              other coach can read it.
            </Text>
            <TextInput value={typed} onChangeText={setTyped} keyboardType="numeric" placeholder={wu}
              placeholderTextColor={t.ink3}
              accessibilityLabel={wu === 'kg' ? 'Your weight in kilograms' : 'Your weight in pounds'}
              style={[inp, { ...numeric, marginBottom: sp.lg }]} />
            <Rating t={t} label="Energy" score={energy} onChange={setEnergy} />
            <Rating t={t} label="Sleep Quality" score={sleep} onChange={setSleep} />
            <Rating t={t} label="Mood" score={mood} onChange={setMood} />
            <Rating t={t} label="Training Adherence" score={adherence} onChange={setAdherence} />
            <TextInput value={note} onChangeText={setNote} placeholder="Anything worth remembering…"
              placeholderTextColor={t.ink3} multiline accessibilityLabel="Note to yourself"
              style={[inp, { minHeight: 78, textAlignVertical: 'top' }]} />
            {problem ? <Flag style={{ marginTop: sp.md }}>{problem}</Flag> : null}
            <View style={{ marginTop: sp.md }}>
              <Cta wide label={busy ? 'Saving…' : 'Log My Weigh-in'} onPress={logWeighIn} disabled={busy} />
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              Weight is stored in kilograms whichever unit you read in, so switching the unit in Settings
              never changes what you weighed.
            </Text>
          </Section>

          <Rule />

          {/* ── the tape ─────────────────────────────────────────────────── */}
          <Section>
            <SectionHead
              title={latestTape ? `Measured ${dayLabel(latestTape.at)}` : 'Body Measurements'}
              note={latestTape && prevTape ? `vs ${shortDayLabel(prevTape.at)}` : undefined} />
            {latestTape ? (
              METRICS.map(({ key, label }) => {
                const raw = latestTape[key];
                if (raw == null) return null;
                const was = prevTape ? prevTape[key] : undefined;
                // Converted as a SPAN rather than as the difference of two
                // converted readings, so "−1.0 cm" is always "−0.4 in" and not
                // 0.3 one month and 0.4 the next.
                const d = was != null ? lengthDeltaIn(raw - was, lu) : null;
                return (
                  <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                    <Text style={{ ...ty.label, color: t.ink2 }}>{label}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink }}>{fig(lengthLabel(raw, lu))}</Text>
                      {d != null && d !== 0 ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 62, justifyContent: 'flex-end' }}>
                          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: d < 0 ? t.brand : t.ink3 }} />
                          <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{d > 0 ? '+' : '−'}{plain(Math.abs(d))} {lu}</Text>
                        </View>
                      ) : (
                        <Text style={{ ...ty.caption, color: t.ink3, minWidth: 62, textAlign: 'right' }}>—</Text>
                      )}
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                {ms.status === 'loading'
                  ? 'Reading your measurements…'
                  : !tapeKnown
                    // Not "you have never measured yourself" — a failed read
                    // gives nobody the standing to say that about somebody
                    // else's history.
                    ? 'Your tape history could not be read, so nothing is shown. That is not the same as having none — try again once you have a connection and it will be exactly as you left it.'
                    : 'No tape measurements of your own yet. Save the first below and the comparison builds from it.'}
              </Text>
            )}
          </Section>

          <Rule />

          {/* ── log tape measurements ────────────────────────────────────── */}
          <Section>
            <SectionHead title="Log New Measurements" note={lu} />
            {METRICS.map(({ key, label }) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.sm }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2 }}>{label}</Text>
                <TextInput value={tape[key] ?? ''} onChangeText={(v) => setTapeVal(key, v)} keyboardType="numeric"
                  accessibilityLabel={`${label} in ${lu === 'cm' ? 'centimetres' : 'inches'}`}
                  placeholder={lastTape(key) ?? lu} placeholderTextColor={t.ink3} style={tapeInp} />
              </View>
            ))}
            {tapeNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{tapeNote}</Text> : null}
            <View style={{ marginTop: sp.md }}>
              <Cta wide label={tapeBusy ? 'Saving…' : 'Save Measurements'} onPress={saveTape} disabled={tapeBusy} />
            </View>
            {/* The length unit has no home in the coach app's Settings screen,
                which offers weight only — and a screen that reads tape figures
                in a unit its reader cannot change is a screen that lies to half
                its readers. `useSettings().set` puts it on the account
                (profiles.length_unit, part 82), so it follows the coach to a
                second phone rather than living in this handset's storage. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>Read and type tape figures in</Text>
              {(['cm', 'in'] as const).map((u) => (
                <Pressable key={u} onPress={() => settings.set({ lengthUnit: u })}
                  accessibilityRole="radio" accessibilityState={{ selected: lu === u }}
                  accessibilityLabel={u === 'cm' ? 'Centimetres' : 'Inches'}
                  style={{ paddingHorizontal: sp.lg, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: lu === u ? t.brand : t.surface2 }}>
                  <Text style={{ ...ty.label, fontWeight: lu === u ? '600' : '500', color: lu === u ? t.brandInk : t.ink2 }}>{u}</Text>
                </Pressable>
              ))}
            </View>
          </Section>

          <Rule />

          {/* ── history ──────────────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Your History" note={isWhole(ms.status) && ms.entries.length ? `${ms.entries.length} entries` : undefined} />
            {ms.entries.map((e: MeasureEntry, i) => (
              <View key={e.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                {/* Read through localDate: `taken_at` is a bare DATE, and
                    `new Date(iso)` dates every one of these a day early for
                    anybody west of Greenwich. */}
                <Text style={{ ...ty.caption, color: t.ink3 }}>
                  {dayLabel(e.at)}{agoLabel(e.at, today) ? ` · ${agoLabel(e.at, today)}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg, marginTop: 5 }}>
                  {METRICS.map(({ key, label }) => e[key] != null ? (
                    <Text key={key} style={{ ...ty.caption, color: t.ink3 }}>
                      {label} <Text style={{ ...numeric, fontWeight: '500', color: t.ink2 }}>{fig(lengthIn(e[key], lu))}</Text>
                    </Text>
                  ) : null)}
                </View>
              </View>
            ))}
            {ci.checkins.slice(0, 5).map((c, i) => (
              <View key={c.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 && !ms.entries.length ? 0 : hairline, borderTopColor: t.ring }}>
                <Text style={{ ...ty.caption, color: t.ink3 }}>
                  {dayLabel(c.at)}{agoLabel(c.at, today) ? ` · ${agoLabel(c.at, today)}` : ''}
                </Text>
                {/* A check-in whose weight column was NULL reaches this screen
                    as 0 (see the note on `weighed` above), and "0 kg" is not a
                    reading. It dashes instead; the scores beside it are real
                    either way. */}
                <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: 3 }}>
                  {fig(weightLabel(Number.isFinite(c.weightKg) && c.weightKg > 0 ? c.weightKg : null, wu))} · energy {c.energy}/5 · sleep {c.sleep}/5 · mood {c.mood}/5
                </Text>
                {c.note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, fontStyle: 'italic' }}>“{c.note}”</Text> : null}
              </View>
            ))}
            {!ms.entries.length && !ci.checkins.length ? (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                {bodyStatus === 'loading'
                  ? 'Reading your record…'
                  : bodyStatus === 'error'
                    ? 'Your own history could not be read. It has not gone anywhere — this screen cannot see it right now.'
                    : 'Nothing of your own recorded yet. Anything you log above appears here, and only you ever see it.'}
              </Text>
            ) : null}
          </Section>

          <Rule />

          {/* ── body composition scans ───────────────────────────────────── */}
          <Section>
            <SectionHead title="Body Composition" note={isWhole(cd.scansStatus) && cd.scans.length ? `${cd.scans.length} scans` : undefined} />
            {cd.scans.length ? (
              [...cd.scans].reverse().map((s, i) => (
                <View key={s.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {dayLabel(s.takenAt)}{agoLabel(s.takenAt, today) ? ` · ${agoLabel(s.takenAt, today)}` : ''}
                  </Text>
                  <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: 3 }}>
                    {fig(weightLabel(s.weightKg, wu))} · {num1(s.bodyFatPct)}% body fat
                    {s.skeletalMuscleKg != null ? ` · ${fig(weightLabel(s.skeletalMuscleKg, wu))} muscle` : ''}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                {cd.scansStatus === 'loading'
                  ? 'Reading your scans…'
                  : cd.scansStatus === 'error'
                    // Not "you have never been scanned" — an empty list under a
                    // failed read is unknown, and this is the coach's own body.
                    ? 'Your scans could not be read, so none are listed. That is not the same as having none.'
                    : 'No scan of your own yet. Add the first below and your weight, body fat and muscle build from it.'}
              </Text>
            )}
            {cd.scansStatus === 'partial' ? (
              <View style={{ marginTop: sp.md }}>
                <PartialRead what="scans of your own" shown={cd.scans.length} />
              </View>
            ) : null}
          </Section>

          <Rule />

          {/* ── log a body scan ──────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Log a Body Scan" note={dayLabel(today)} />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              The figures off your scale or InBody sheet, dated today. Stored against your own account,
              and this is what your daily calorie target on My Nutrition is built from — no client and
              no other coach can read it.
            </Text>
            {[
              { key: 'wt', label: 'Weight', unit: wu, value: scanWt, set: setScanWt, a11y: `Your weight in ${wu === 'kg' ? 'kilograms' : 'pounds'}` },
              { key: 'bf', label: 'Body Fat', unit: '%', value: scanBf, set: setScanBf, a11y: 'Your body fat percentage' },
              { key: 'sm', label: 'Muscle', unit: wu, value: scanSm, set: setScanSm, a11y: `Your skeletal muscle mass in ${wu === 'kg' ? 'kilograms' : 'pounds'}, optional` },
            ].map((f) => (
              <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.sm }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2 }}>
                  {f.label}
                  {/* Said on the row rather than in a footnote. The two required
                      figures are the two the calorie target needs; muscle is
                      what a basic scale does not report, and a form that looks
                      like it wants three numbers gets a guess for the third. */}
                  {f.key === 'sm' ? <Text style={{ ...ty.caption, color: t.ink3 }}>  optional</Text> : null}
                </Text>
                <TextInput value={f.value} onChangeText={f.set} keyboardType="numeric"
                  accessibilityLabel={f.a11y} placeholder={f.unit} placeholderTextColor={t.ink3}
                  style={tapeInp} />
              </View>
            ))}
            {weightNote ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{weightNote}</Text> : null}
            {scanProblem ? <Flag style={{ marginTop: sp.md }}>{scanProblem}</Flag> : null}
            <View style={{ marginTop: sp.md }}>
              <Cta wide label={scanBusy ? 'Saving…' : 'Save My Scan'} onPress={saveScan} disabled={scanBusy} />
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              Leave muscle empty if your scan did not report one — it is stored as absent rather than as
              a zero, so the history never shows a reading nobody took. Weight is stored in kilograms
              whichever unit you read in, so switching the unit in Settings never changes what you
              measured.
            </Text>
          </Section>

          <Rule />

          {/* ── where a CLIENT's body record goes instead ────────────────── */}
          <Section>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              Looking at a client&rsquo;s weight, scans or measurements? Those are on their record,
              from their card on the Clients tab — not here.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.md }}>
              <Icon name="people" size={14} color={t.ink3} />
              <Pressable onPress={() => router.push('/(trainer)/dashboard')} hitSlop={8} accessibilityRole="button">
                <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Go to Clients</Text>
              </Pressable>
            </View>
          </Section>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
