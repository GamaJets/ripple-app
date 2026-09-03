// Client · Body Measurements. Log tape measurements over time; see the latest
// value and change since the previous entry, plus full history. Reached from the
// profile hub. Complements the InBody scans (Progress tab).
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: waist is the
// screen's one hero figure, the grid of bordered tiles-inside-a-card became
// hairline metric rows, the Georgia serif header is gone, and a change no longer
// paints itself in a status colour — it carries a mark beside ink text.
//
// TF-37: this screen said "cm" in five places and meant it — the values were
// stored, entered and printed in centimetres with no reference to the unit
// preference, which nothing in the app read anyway. Storage is still
// centimetres; what a client who reads in inches types and sees is converted at
// the edge, in src/lib/units.ts. A change is converted as a SPAN rather than as
// the difference of two converted readings, so "−1.0 cm" is always "−0.4 in"
// and not 0.3 one month and 0.4 the next.
//
// TF build 35, "Need to see the dates the weight was measured as well": the
// dates on this screen were being read with `new Date(iso)`. `measurements
// .taken_at` is a bare postgres DATE, so that is UTC midnight, and every entry
// a client logged was captioned the day before it happened for anybody west of
// Greenwich — the exact bug src/lib/localDate.ts exists for. Every date here
// now goes through it, and every figure says how long ago it was taken.
import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useSubmitOnce } from '../../src/ui/submitOnce';
import { useToast } from '../../src/ui/toast';
import { useMeasurements, METRICS, type MeasureEntry, type MetricKey } from '../../src/ui/measurements';
import { hitSlopFor } from '../../src/lib/a11y';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useSettings } from '../../src/ui/settings';
import { lengthIn, lengthLabel, lengthToCm, lengthDeltaIn, plain, convertedNote } from '../../src/lib/units';
import { agoLabel, dayLabel, shortDayLabel, daysBetween, todayISO, STALE_AFTER_DAYS } from '../../src/lib/bodyFigures';
import { useClientData } from '../../src/ui/clientData';
import { deltaLabel, movementIsProgress } from '../../src/lib/deltaLabel';
import { END_ALIGN } from '../../src/ui/direction';

// Which tape sites a goal has an opinion about. A waist and a hip measurement
// follow the fat, so Fat Loss and Tone want them down; a chest, an arm and a
// thigh are size, and nobody's goal is unambiguously less of them. Every site
// on this screen used to paint a fall in the accent colour — src/lib/
// clientMeasurements.ts names that in its own header as the thing it refuses
// to return — so a client building an arm was congratulated for losing one.
const GOAL_READS: Partial<Record<(typeof METRICS)[number]['key'], 'girth'>> = { waist: 'girth', hips: 'girth' };

const fmtDate = shortDayLabel;

export default function Measurements() {
 const t = useTheme();
 const toast = useToast();
 const router = useRouter();
 const { entries, status, addEntry, updateMetric, removeMetric, reload } = useMeasurements();
 // The member's own goal, purely so the mark beside a fall can stop claiming to
 // be good news for everybody. Nothing else on this screen reads it.
 const cd = useClientData();
 // The tape measurements, and the scan history charted beside them.
 const pull = usePullToRefresh(useCallback(() => { reload(); cd.reload(); }, [reload, cd.reload]));
 // True only where this member's goal actually wants this site smaller.
 // `undefined` — no goal set, a goal with no opinion on girth, or a change that
 // rounds to nothing — paints the neutral mark.
 const goalRead = (key: (typeof METRICS)[number]['key'], d: number | null) => {
  const metric = GOAL_READS[key];
  return metric ? movementIsProgress(d, cd.goal, metric) === true : false;
 };
 const [vals, setVals] = useState<Record<string, string>>({});
 const today = todayISO();
 // A failed read reaches `entries: []` by the same route an empty history does,
 // and this screen used to answer both with "No measurements logged yet — save
 // your first entry above". src/ui/measurements.tsx added `status` to separate
 // them and nothing had read it: a client with months of tape history whose read
 // was refused was being invited to start again from nothing.
 const readFailed = status === 'error';
 // The unit the client reads lengths in — theirs, not this device's. See
 // src/ui/settings.tsx and supabase/parts/61-unit-preference.sql.
 const lu = useSettings().lengthUnit;
 const note = convertedNote(lu);

 const latest = entries[0];
 const prev = entries[1];
 const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));
 // The last figure logged for this part, in the client's unit, as the empty
 // field's grey hint. Undefined when there is none — the hint falls back to the
 // unit rather than to a number nobody measured.
 const lastEntered = (k: (typeof METRICS)[number]['key']) => {
  const v = lengthIn(latest?.[k], lu);
  return v == null ? null : plain(v);
 };
 /* ── correcting one figure, without losing the day it was taken ──────────
  *
  * A slipped decimal is not a display glitch: this figure is the baseline every
  * "since" on this screen is measured from, a row in the summary a member gives
  * a clinician, and one of the things a coach programmes from. Re-logging the
  * right number does not fix it — it puts a correct figure on TODAY and leaves
  * the trend bent around the day the mistake was made — so the correction keeps
  * the original date and the removal takes only the one site.
  */
 const [fixing, setFixing] = useState<{ at: string; key: MetricKey; label: string } | null>(null);
 const [fixVal, setFixVal] = useState('');
 const askAbout = (e: MeasureEntry, key: MetricKey, label: string) => {
  const shown = lengthIn(e[key], lu);
  setFixVal(shown == null ? '' : plain(shown));
  setFixing({ at: e.at, key, label });
 };
 const saveFix = async () => {
  if (!fixing) return;
  const cm = lengthToCm(fixVal, lu);
  if (cm == null || cm <= 0) { Alert.alert('Check that figure', `Type the ${fixing.label.toLowerCase()} measurement in ${lu}.`); return; }
  const done = await updateMetric(fixing.at, fixing.key, cm);
  setFixing(null);
  // The answer is read. A correction reported over a write the server refused
  // would leave the wrong figure on the record with the member believing it is
  // gone — which is the failure this whole control exists to end, restated.
  if (done) toast.say(`${fixing.label} corrected.`);
  else Alert.alert('Not corrected', `That change did not reach your account, so your ${fixing.label.toLowerCase()} is still exactly as it was. Try again in a moment.`);
 };
 const removeFix = () => {
  if (!fixing) return;
  const f = fixing;
  Alert.alert(
   `Remove this ${f.label.toLowerCase()} figure?`,
   'It comes off this date only. Everything else you measured that day stays, and so does every other date.',
   [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => { void (async () => {
      const gone = await removeMetric(f.at, f.key);
      setFixing(null);
      if (gone) toast.say(`${f.label} removed.`);
      else Alert.alert('It is still there', `That figure could not be removed just now, so it has not been. Nothing has changed and you can try again in a moment.`);
    })(); } },
   ],
  );
 };

 const send = useSubmitOnce('measurements.save');

 const save = async () => {
 const parsed: Record<string, number> = {};
 // Typed in the client's unit, stored in centimetres. `parseFloat` alone read
 // an inch entry as centimetres, which is only invisible while the preference
 // does nothing — the moment it does, a 32 in waist becomes a 32 cm one.
 for (const { key } of METRICS) { const cm = lengthToCm(vals[key], lu); if (cm != null && cm > 0) parsed[key] = cm; }
 if (Object.keys(parsed).length === 0) { Alert.alert('Nothing to save', 'Enter at least one measurement.'); return; }
 // `addEntry` says which of three things happened, and its answer was once
 // being thrown away entirely — so a refused write showed the entry on screen,
 // said "Saved", and lost it at the next launch. The client is told which one
 // while they are still standing there with the tape.
 //
 // 'queued' is the answer that did not used to exist: a member measuring
 // themselves in a changing room with no signal was told to enter it all
 // again later, by which time the numbers were off the screen. Now it waits
 // on the phone, under the date it was taken, and goes up on its own.
 const out = await addEntry(parsed);
 setVals({});
 // A statement, not a question. It used to stop the screen and wait for a
 // tap to say one word; it now says it in the bar at the bottom and gets out
 // of the way. The two branches below are NOT statements — one says the
 // numbers have not reached the account and the other says they were refused
 // — so both keep the interruption.
 if (out === 'stored') { toast.say('Measurements logged.'); return; }
 if (out === 'queued') {
  Alert.alert('Waiting to send',
   'No signal, so these are saved on this phone and have not reached your account yet. They go up on their own once you are back online, under today\u2019s date.');
  return;
 }
 Alert.alert('Not saved',
  'These are on screen but could not be sent to your account, so they will be gone at the next launch. Enter them again in a moment.');
 };

 const inp = { ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9, width: 96, textAlign: 'center' } as const;

 // Presentation-only: waist is the first tape measurement and the one people
 // track, so it leads. With no waist logged there is no hero — not a zero.
 const waistNow = lengthIn(latest?.waist, lu);
 const waistWas = prev?.waist;
 const waistMove = latest?.waist != null && waistWas != null ? lengthDeltaIn(latest.waist - waistWas, lu) : null;
 // How old the newest entry is, in days, so the screen can say how stale rather
 // than leaving a client to compare a date against today in their head. Null
 // when nothing has been logged — never 0, which would claim it was today.
 const latestAgo = latest ? agoLabel(latest.at, today) : null;
 const latestDays = latest ? daysBetween(latest.at, today) : null;
 const stale = latestDays != null && latestDays > STALE_AFTER_DAYS
  ? `Your last tape entry is ${latestDays} days old — these figures describe the body you had then.`
  : null;
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Tape measurements in {lu}</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Body Measurements</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

  {/* ── the hero: waist, when there is one ──────────────────────────── */}
  {waistNow != null ? (
   <Hero
    label="Waist"
    figure={fig(waistNow)}
    unit={lu}
    // The date this figure was actually measured on, and how long ago that
    // was — not just the date it is being compared against. A waist with no
    // date is a rumour, and a five-week-old one presented as current is a
    // rumour with a number on it.
    // The three arms — a movement, no movement, and no earlier entry — are
    // deltaLabel's, so this cannot drift out of step with the same sentence on
    // Progress. `prev` is non-null exactly when `waistMove` is.
    // `noBaseline` says WHICH baseline is missing. An entry holds one row per
    // body part per date, so a session where somebody taped their chest and not
    // their waist is ordinary — and "First entry" was then printed on their
    // fifth tape session, because `waistMove` is null whenever the previous
    // entry has no waist, not only when there is no previous entry.
    note={deltaLabel(waistMove, {
     since: prev && prev.waist != null ? fmtDate(prev.at) : null,
     unit: lu,
     noChange: 'Unchanged',
     noBaseline: prev ? 'No waist measured last time' : 'First entry',
    }) + ` · measured ${dayLabel(latest.at)}${latestAgo ? ` · ${latestAgo}` : ''}`}
   />
  ) : null}
  {/* Where a figure is stale, how stale. The client is the only person who can
      judge whether a six-week-old waist still describes them, and they can only
      judge it if they are given the six weeks. */}
  {stale ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{stale}</Text> : null}

  {/* ── latest snapshot with change vs previous ─────────────────────── */}
  {latest ? (<>
   <Rule />
   <Section>
    {/* The full date, not just "3 Aug": this heading is what dates every
        figure in the rows beneath it, and a day and month with no year is
        ambiguous the moment a client has a history longer than one. */}
    <SectionHead title={`Measured ${dayLabel(latest.at)}${latestAgo ? ` · ${latestAgo}` : ''}`} note={prev ? `vs ${fmtDate(prev.at)}` : undefined} />
    {METRICS.map(({ key, label }) => {
     const raw = latest[key]; if (raw == null) return null;
     const pv = prev ? prev[key] : undefined;
     const d = pv != null ? lengthDeltaIn(raw - pv, lu) : null;
     return (
      <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: sp.sm, borderBottomWidth: hairline, borderBottomColor: t.ring }}>
       <Text style={{ ...ty.label, color: t.ink2 }}>{label}</Text>
       <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        <Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink }}>{fig(lengthLabel(raw, lu))}</Text>
        {/* "This did not move" and "there is no earlier reading of THIS site"
            were both printed as the same em dash, so a member could not tell an
            unchanged waist from one they had not taped last time — while the
            hero six rows above, over the same arithmetic, kept them apart as
            "Unchanged" and "First entry". The dot is a direction mark and is
            drawn only where there is a direction. */}
        {d != null ? (
         <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 78, justifyContent: 'flex-end' }}>
          {d !== 0 ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: goalRead(key, d) ? t.brand : t.ink3 }} /> : null}
          <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{deltaLabel(d, { since: null, unit: lu, noChange: 'Unchanged' })}</Text>
         </View>
        ) : (
         <Text style={{ ...ty.caption, color: t.ink3, minWidth: 78, textAlign: END_ALIGN }}>{prev ? 'Not measured' : '—'}</Text>
        )}
       </View>
      </View>
     );
    })}
   </Section>
  </>) : null}

  <Rule />

  {/* ── new entry ───────────────────────────────────────────────────── */}
  <Section>
   <SectionHead title="Log New Measurements" note={lu} />
   {METRICS.map(({ key, label }) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.sm }}>
     <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2 }}>{label}</Text>
     <TextInput value={vals[key] ?? ''} onChangeText={(v) => set(key, v)} keyboardType="decimal-pad"
      accessibilityLabel={`${label} in ${lu === 'cm' ? 'centimetres' : 'inches'}`}
      placeholder={lastEntered(key) ?? lu} placeholderTextColor={t.ink3} style={inp} />
    </View>
   ))}
   {note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{note}</Text> : null}
   <View style={{ height: sp.sm }} />
   {/* Guarded. `addEntry` inserts a fresh row set on every call, and this
     provider's own header explains why the duplicate is then invisible:
     "rowsToEntries groups by taken_at and the last row of a kind wins, so the
     screen draws one entry either way and nobody can see the duplicate". Two
     taps in the wait also make `latest` and `prev` the same morning, so every
     delta on this screen collapses to zero and the real change since the last
     measurement disappears — the member's whole reason for taking the tape
     out. See src/lib/submitOnce.ts. */}
   <Cta label={send.busy ? 'Saving…' : 'Save Entry'} disabled={send.busy} wide onPress={() => send.run(save)} />
  </Section>

  <Rule />

  {/* ── history ─────────────────────────────────────────────────────── */}
  <Section>
   {/* `${entries.length} entries` over a truncated read prints the cap as a
     total. `readFailed` is 'error' only, and that is right for the LIST —
     the rows are real — but a count over them is not. */}
        <SectionHead title="History" note={status === 'ready' && entries.length ? `${entries.length} entries` : undefined} />
   {entries.length === 0 ? (
    <Text style={{ ...ty.label, color: t.ink3 }}>{readFailed
     ? 'Your measurement history could not be read, so nothing is listed here. That is not the same as having none — try again once you have a connection, and it will be exactly as you left it.'
     : status === 'loading'
     ? 'Loading your history…'
     : 'No measurements logged yet — save your first entry above and the history builds here.'}</Text>
   ) : null}
   {entries.map((e: MeasureEntry, i) => (
    <View key={e.id} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
     {/* The day the tape went round, with how long ago beside it. Read through
         localDate: `taken_at` is a bare DATE and `new Date(iso)` dated every
         one of these a day early west of Greenwich. */}
     <Text style={{ ...ty.caption, color: t.ink3 }}>{dayLabel(e.at)}{agoLabel(e.at, today) ? ` · ${agoLabel(e.at, today)}` : ''}</Text>
     <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg, marginTop: 5 }}>
      {/* Every figure is tappable, because every figure is one keypress away
          from being wrong for ever: this is the baseline every "since" on the
          screen is measured against, and it is in the summary a member hands a
          clinician. There was no row control of any kind here — no correction
          and no delete — while the scans screen next door has had both.
          MIN_TARGET through hitSlop: the label is caption-sized text. */}
      {METRICS.map(({ key, label }) => e[key] != null ? (
       <Pressable key={key}
        accessibilityRole="button"
        accessibilityLabel={`${label} on ${dayLabel(e.at)}. Correct or remove this figure.`}
        hitSlop={hitSlopFor(20)}
        onPress={() => askAbout(e, key, label)}>
        <Text style={{ ...ty.caption, color: t.ink3 }}>{label} <Text style={{ ...numeric, fontWeight: '500', color: t.ink2 }}>{fig(lengthIn(e[key], lu))}</Text></Text>
       </Pressable>
      ) : null)}
     </View>
     {fixing && fixing.at === e.at ? (
      <View style={{ marginTop: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md }}>
       <Text style={{ ...ty.caption, color: t.ink3 }}>
        {fixing.label} on {dayLabel(e.at)} — the date stays as it is, so your trend is not bent around a correction.
       </Text>
       <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
        <TextInput value={fixVal} onChangeText={setFixVal} keyboardType="decimal-pad"
         accessibilityLabel={`${fixing.label} in ${lu}`}
         placeholder={lu} placeholderTextColor={t.ink3} style={inp} />
        <Text style={{ ...ty.caption, color: t.ink3 }}>{lu}</Text>
       </View>
       <View style={{ height: sp.sm }} />
       <Cta label="Save Correction" wide onPress={() => { void saveFix(); }} />
       <View style={{ height: sp.sm }} />
       <Ghost label="Remove This Figure" onPress={removeFix} />
       <View style={{ height: sp.sm }} />
       <Ghost label="Cancel" onPress={() => setFixing(null)} />
      </View>
     ) : null}
    </View>
   ))}
  </Section>
 </ScrollView>
 </SafeAreaView>
 );
}
