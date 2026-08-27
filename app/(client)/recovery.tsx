// Client · Recovery & Wellness. Hydration tracker, sleep log, mobility routines,
// and rest-day guidance. Profile hub.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: hydration is
// the screen's one hero figure, six bordered cards became hairline-separated
// sections, and the Georgia serif header is gone.
//
// Also fixed: the sleep-quality picker and the quality column in the history
// rows rendered nothing at all — both drew a star glyph that is no longer in the
// source, so `<Text>{''.repeat(quality)}</Text>` painted an empty string and the
// 1–5 selector was invisible and untappable. Quality is now shown as marks.
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWellness } from '../../src/ui/wellness';
import { useClientData } from '../../src/ui/clientData';
import { HrZoneChart } from '../../src/ui/HrZoneChart';
import { ageFromDob, type HrSample } from '../../src/lib/hr';
import { useWearables } from '../../src/ui/wearables';
import { reportError } from '../../src/lib/reportError';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { Icon } from '../../src/ui/Icon';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { RECOVERY_ACTIVITIES, isRecoveryActivity } from '../../src/lib/recoveryActs';

const MOBILITY = [
 { name: 'Full-body warm-up', dur: '6 min', moves: ['Leg swings ×10/side', 'World’s greatest stretch ×5/side', 'Cat-cow ×10', 'Band pull-aparts ×15', 'Bodyweight squats ×10'] },
 { name: 'Hip & lower-body', dur: '5 min', moves: ['90/90 hip switch ×8', 'Couch stretch 45s/side', 'Ankle rocks ×12/side', 'Glute bridge ×15'] },
 { name: 'Shoulders & upper', dur: '5 min', moves: ['Wall slides ×12', 'Thread the needle ×6/side', 'Doorway pec stretch 30s', 'Scapular push-ups ×12'] },
];

/** Sleep quality 1–5, as marks rather than a glyph the font may not carry. */
function Quality({ n, of = 5, color, dim }: { n: number; of?: number; color: string; dim: string }) {
 return (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
   {Array.from({ length: of }).map((_, i) => (
    <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i < n ? color : dim }} />
   ))}
  </View>
 );
}

export default function Recovery() {
 const t = useTheme();
 const router = useRouter();
 const { cups, goalCups, addCup, removeCup, sleep, addSleep } = useWellness();
 const cd = useClientData();
 const wear = useWearables();
 const { log: workoutLog, status: logStatus } = useWorkoutLog();
 // Sauna, cold plunge and the rest are logged on Train like every other
 // session. They belong on this screen too — a member who logs a sauna looks
 // for it under Recovery, and finding nothing here while a screen called
 // Recovery exists is the confusion this section removes.
 const recoverySessions = workoutLog.filter((l) => isRecoveryActivity(l.exercise)).slice(0, 6);
 const age = ageFromDob(cd.dob);
 // Source order, most to least detailed. No demo fallback: an empty chart that
 // says so beats a fabricated curve that looks like the user's own training.
 //   1. Apple Watch / HealthKit — real HR samples, so a full coloured line
 //   2. WHOOP — no intraday samples exist in its API, but per-workout zone
 //      durations do, which still answers "how long was I in each zone"
 //
 // `read` is why an empty `samples` is empty, and it exists because all three
 // reasons used to land on the same line of copy. A failed HealthKit call, a
 // day with nothing recorded yet, and a phone with no watch paired at all were
 // written to state identically, and the chart told all three to "Connect a
 // device in Watch & Devices" — so a client whose Apple Watch was connected and
 // whose read had simply failed was told their watch was not connected, and
 // went looking for a setting that was already switched on.
 const [hr, setHr] = useState<{ samples: HrSample[]; source: 'apple' | null; read: 'loading' | 'ready' | 'error' | 'unavailable' }>(
  { samples: [], source: null, read: 'loading' }
 );
 useEffect(() => {
   let cancelled = false;
   (async () => {
     const apple = PROVIDERS.find((pv) => pv.meta.id === 'apple');
     const fetchHr = apple?.fetchHeartRateSeries;
     // No provider, or HealthKit not available on this device: the one case
     // where "connect a device" is a true answer rather than a guess.
     if (!fetchHr || !apple || !apple.isAvailable()) {
       if (!cancelled) setHr({ samples: [], source: null, read: 'unavailable' });
       return;
     }
     try {
       const start = new Date(); start.setHours(0, 0, 0, 0);
       const s = await fetchHr(start.toISOString(), new Date().toISOString());
       if (cancelled) return;
       // Fewer than two samples is a real answer — the watch is connected and
       // has nothing to show for today yet — and it is not the same answer as
       // the catch below.
       if (s && s.length >= 2) setHr({ samples: s, source: 'apple', read: 'ready' });
       else setHr({ samples: [], source: null, read: 'ready' });
     } catch (e) {
       reportError('recovery.appleHrSeries', e);
       if (!cancelled) setHr({ samples: [], source: null, read: 'error' });
     }
   })();
   return () => { cancelled = true; };
 }, [age]);

 // WHOOP zone totals, straight off the wearables context (no extra round trip).
 const whoopMetrics = wear.metrics?.whoop ?? null;
 const zoneSeconds = hr.source === 'apple' ? null : (whoopMetrics?.zoneSeconds ?? null);
 const hrSource: 'apple' | 'whoop' | null = hr.source === 'apple' ? 'apple' : (zoneSeconds ? 'whoop' : null);
 // Empty, not pre-filled. These used to start at 7.5 hours / quality 4, so
 // tapping Log sleep without touching either control filed a night the client
 // never had - which then became their sleep average and fed the readiness
 // score on the home screen.
 const [hrs, setHrs] = useState('');
 const [q, setQ] = useState(0);
 const [openRoutine, setOpenRoutine] = useState<number | null>(0);

 const avgSleep = sleep.length ? (sleep.reduce((a, s) => a + s.hours, 0) / sleep.length).toFixed(1) : '—';
 const pct = Math.min(100, Math.round((cups / goalCups) * 100));
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Heart rate, hydration, sleep &amp; mobility</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Recovery</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

  {/* ── the hero: today's hydration ─────────────────────────────────── */}
  <Hero
   label="Hydration"
   figure={fig(cups)}
   unit={`of ${goalCups} cups`}
   arc={pct / 100}
   note={cups >= goalCups ? 'Goal met today — nice.' : `${goalCups - cups} more to hit today's goal.`}
  />
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingBottom: layout.section }}>
   <Ghost icon="minus" onPress={removeCup} />
   <View style={{ flex: 1 }}><Cta label="Add a cup" wide onPress={addCup} /></View>
  </View>

  <Rule />

  {/* ── heart-rate zones ────────────────────────────────────────────── */}
  <Section>
   <HrZoneChart
    samples={hr.samples}
    zoneSeconds={zoneSeconds}
    avgBpm={hrSource === 'whoop' ? whoopMetrics?.heartRateAvg ?? null : null}
    maxBpm={hrSource === 'whoop' ? whoopMetrics?.heartRateMax ?? null : null}
    age={age}
    title="Heart-rate zones"
    subtitle={
      hrSource === 'apple' ? 'Today, from your Apple Watch'
      : hrSource === 'whoop' ? "Today's workouts, from WHOOP"
      // Below here there is no data to plot, and the line has to say which of
      // the four reasons it is. Only the last one is a thing the client can act
      // on, and it used to be shown for all four.
      : hr.read === 'loading' ? 'Reading today’s heart rate…'
      : hr.read === 'error' ? 'We couldn’t read today’s heart rate — this is our end, not your watch.'
      : hr.read === 'ready' ? 'Your Apple Watch is connected — no heart rate recorded today yet.'
      : 'Connect a device in Watch & Devices to see your zones'
    } />
  </Section>

  <Rule />

  {/* ── sleep ───────────────────────────────────────────────────────── */}
  <Section>
   <SectionHead title="Sleep" note={sleep.length ? `avg ${avgSleep} h` : undefined} />
   <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
    <TextInput value={hrs} onChangeText={setHrs} keyboardType="numeric" accessibilityLabel="Hours slept"
     style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10, width: 78, textAlign: 'center' }} />
    <Text style={{ ...ty.caption, color: t.ink3 }}>hrs · quality</Text>
    {[1, 2, 3, 4, 5].map((n) => (
     <Pressable key={n} onPress={() => setQ(n)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Sleep quality ${n} of 5`}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: n <= q ? t.brand : t.surface3 }} />
     </Pressable>
    ))}
   </View>
   <View style={{ height: sp.md }} />
   <Cta label="Log sleep" wide disabled={!(parseFloat(hrs) > 0) || q < 1} onPress={() => { addSleep(parseFloat(hrs) || 0, q); setHrs(''); setQ(0); }} />
   {sleep.length === 0 ? (
    <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>No nights logged yet — log one above and your average appears here.</Text>
   ) : null}
   {sleep.slice(0, 4).map((sx) => (
    <View key={sx.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.sm, marginTop: sp.sm, borderTopWidth: hairline, borderTopColor: t.ring }}>
     <Text style={{ ...ty.caption, color: t.ink3 }}>{new Date(sx.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
     <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
      <Text style={{ ...ty.caption, ...numeric, fontWeight: '500', color: t.ink2 }}>{sx.hours} h</Text>
      <Quality n={sx.quality} color={t.brand} dim={t.surface3} />
     </View>
    </View>
   ))}
  </Section>

  <Rule />

  {/* ── logged recovery sessions ─────────────────────────────────────── */}
  <Section>
   <SectionHead title="Recovery sessions" note={recoverySessions.length ? `${recoverySessions.length} recent` : undefined} />
   {logStatus === 'error' ? (
    <Text style={{ ...ty.label, color: t.ink2 }}>
     Your sessions could not be read, so none are shown. That is not the same as having logged none.
    </Text>
   ) : recoverySessions.length === 0 ? (
    <Text style={{ ...ty.label, color: t.ink3 }}>
     Nothing logged yet. {RECOVERY_ACTIVITIES.join(', ')} — duration and heart rate are kept; there is no
     calorie figure, because heating up is not work.
    </Text>
   ) : (
    recoverySessions.map((l, i) => (
     <View key={(l.id ?? '') + i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
       gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{l.exercise}</Text>
      <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>
       {[l.cardio?.mins ? `${l.cardio.mins} min` : null,
         new Date(l.t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })]
        .filter(Boolean).join(' · ')}
      </Text>
     </View>
    ))
   )}
   <View style={{ marginTop: sp.md }}>
    <Ghost label="Log a recovery session" onPress={() => router.push('/(client)/workouts?mode=recovery')} />
   </View>
  </Section>

  <Rule />

  {/* ── mobility routines ───────────────────────────────────────────── */}
  <Section>
   <SectionHead title="Mobility & warm-ups" note={`${MOBILITY.length} routines`} />
   {MOBILITY.map((r, i) => {
    const open = openRoutine === i;
    return (
     <View key={r.name} style={{ borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
      <Pressable onPress={() => setOpenRoutine(open ? null : i)} accessibilityRole="button" accessibilityLabel={r.name}
       style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.md }}>
       <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.name}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.dur}</Text>
       </View>
       <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
        <Icon name="chevron" size={16} color={t.ink3} />
       </View>
      </Pressable>
      {open ? (
       <View style={{ paddingBottom: sp.md }}>
        {r.moves.map((m) => (
         <View key={m} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 5 }}>
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: t.ink3, marginTop: 8 }} />
          <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{m}</Text>
         </View>
        ))}
       </View>
      ) : null}
     </View>
    );
   })}
  </Section>

  <Rule />

  {/* ── rest-day guidance ───────────────────────────────────────────── */}
  <Section>
   <SectionHead title="Rest-day guidance" />
   <Text style={{ ...ty.body, color: t.ink2 }}>Aim for 1–2 rest days a week. Deload every 4–6 weeks (drop ~40% volume) to let strength catch up. Light walking, mobility, and 7–9 h sleep beat total inactivity for recovery.</Text>
  </Section>
 </ScrollView>
 </SafeAreaView>
 );
}
