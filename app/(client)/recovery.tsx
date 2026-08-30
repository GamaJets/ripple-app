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
import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useWellness } from '../../src/ui/wellness';
// Hydration comes from the same place the home screen's water counter does.
// These were two separate stores and adding a glass on one never reached the
// other — reported twice, from both directions.
import { useHabits } from '../../src/ui/habits';
import { useClientData } from '../../src/ui/clientData';
import { HrZoneChart } from '../../src/ui/HrZoneChart';
import { ageFromDob, type HrSample } from '../../src/lib/hr';
import { useWearables } from '../../src/ui/wearables';
import { useDeviceSleep } from '../../src/ui/deviceSleep';
import { connectedProviders } from '../../src/lib/wearables/sleep';
import { reportError } from '../../src/lib/reportError';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { localDate } from '../../src/lib/localDate';
import { Icon } from '../../src/ui/Icon';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { RECOVERY_ACTIVITIES, isRecoveryActivity } from '../../src/lib/recoveryActs';
// The same connection answer Watch & devices shows. This screen used to reach
// its own conclusion about whether a device was connected, from a different
// piece of evidence, and print it in the same words — see
// src/lib/wearableLink.ts for the four reports that came of it.
import { linkFor, useLinkRevision } from '../../src/lib/wearableLinkLedger';
import { requestHealthAuth } from '../../src/lib/wearables/appleHealth';
import { mergeSleepNights, recentNights, formatSleepHours, type MergedNight, type SleepRead } from '../../src/lib/sleepMerge';
import type { LoadStatus } from '../../src/ui/loadStatus';

const MOBILITY = [
 { name: 'Full-body warm-up', dur: '6 min', moves: ['Leg swings ×10/side', 'World’s greatest stretch ×5/side', 'Cat-cow ×10', 'Band pull-aparts ×15', 'Bodyweight squats ×10'] },
 { name: 'Hip & lower-body', dur: '5 min', moves: ['90/90 hip switch ×8', 'Couch stretch 45s/side', 'Ankle rocks ×12/side', 'Glute bridge ×15'] },
 { name: 'Shoulders & upper', dur: '5 min', moves: ['Wall slides ×12', 'Thread the needle ×6/side', 'Doorway pec stretch 30s', 'Scapular push-ups ×12'] },
];

/** How many nights of device sleep the screen asks for and lists. */

/**
 * The sentence under a night's figure, and the whole point of TF-01.
 *
 * A duration on its own is unarguable in the wrong way — the client cannot tell
 * whether it came from the ring they wore or the watch they left charging, and
 * that was the complaint. So every figure names its device, and where two
 * devices disagreed the other number is printed beside it rather than being
 * quietly dropped or split down the middle.
 */
function attribution(n: MergedNight): string {
  if (n.outcome === 'unknown') return 'We couldn’t read your devices for this night, so it is unknown — that is not the same as no sleep.';
  if (n.outcome === 'no-record') return 'No device recorded this night.';
  const src = n.source;
  if (!src) return 'No device recorded this night.';
  const head = `from your ${src.sourceName}${src.basis === 'in-bed' ? ' — time in bed, which runs longer than time asleep' : ''}`;
  const other = n.others[0];
  if (n.agreement === 'conflicting' && other) {
    return `${head}. Your ${other.sourceName} has the same night at ${formatSleepHours(other.minutesAsleep)} — ${n.spreadMin} min apart. Both are shown; neither has been averaged into a figure no device reported.`;
  }
  if (n.agreement === 'corroborated' && other) {
    return `${head}, and your ${other.sourceName} agrees to within ${n.spreadMin} min.`;
  }
  if (other) {
    const why = other.family === src.family
      ? 'the same device reaching us twice'
      : 'a different measurement';
    return `${head}. Your ${other.sourceName} has it at ${formatSleepHours(other.minutesAsleep)}, but that is ${why}, so it does not confirm this.`;
  }
  return `${head}. Nothing else recorded this night, so nothing corroborates it.`;
}

/** A night key is a bare calendar date, so it is read locally, never parsed as UTC. */
function nightLabel(night: string): string {
  const d = localDate(night);
  return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : night;
}

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
 const { sleep, addSleep } = useWellness();
 const { water: cups, waterGoal: goalCups, addWater: addCup, removeWater: removeCup } = useHabits();
 const cd = useClientData();
 const wear = useWearables();
 // Bumped whenever the server proves something new about a device — including
 // by a reconnect started on the other screen. It is both a re-render trigger
 // and an effect key below.
 const linkRev = useLinkRevision();
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
 // Sleep from the devices, not from one hard-coded source (TF-01).
 //
 // The status is the LoadStatus vocabulary on purpose: an empty list under
 // 'ready' means the devices were readable and recorded nothing, and an empty
 // list under 'error' means we do not know. The merge below keeps those apart
 // per night, and the screen prints a different sentence for each — the bug
 // this app keeps re-reporting is the two of them looking identical.
 // One loader, shared with Home. Recovery used to own this outright, which is
 // how the two screens came to disagree about whether any sleep existed at all:
 // this one showed the week and Home said there was none. The provider keeps
 // the two things that were bugs in their own right — keying on WHICH providers
 // are connected rather than the states object, and on linkRev so a reconnect
 // re-reads. See src/ui/deviceSleep.tsx.
 const deviceSleep = useDeviceSleep();
 const sleepReads: { reads: SleepRead[]; status: LoadStatus } = { reads: deviceSleep.reads, status: deviceSleep.status };
 const loadDeviceSleep = deviceSleep.refresh;
 // The read, its key, and the merge all live in DeviceSleepProvider now —
 // including the two things that were bugs here: keying on WHICH providers are
 // connected rather than on the states object (replaced every 60s), and on
 // linkRev, without which reconnecting an already-listed device never re-ran
 // the read and the stale "needs reconnecting" outlived the reconnect that
 // fixed it. Re-merging here would put this screen and Home back on separate
 // arithmetic over the same nights, which is the whole reason it moved.
 const deviceNights = deviceSleep.nights;

 // Still needed here, for the sentence below that names having no device at
 // all — a different thing from having devices that recorded nothing.
 const connectedKey = connectedProviders(wear.states).map((p: { meta: { id: string } }) => p.meta.id).join(',');
 const lastNight = deviceNights[0] ?? null;
 const unreadable = sleepReads.reads.filter((r) => r.status === 'error');
 const cannotReport = sleepReads.reads.filter((r) => r.status === 'unsupported');
 // Devices the client can actually fix, and the route to fixing them.
 //
 // The reason sentences above name the fix but this screen has no OAuth flow on
 // it, so a client reading "reconnect WHOOP" here had nowhere to go except back
 // to Watch & devices — where the same device said, in one word, Connected.
 // That round trip is the first report. The link is offered only where the
 // state machine says a re-authorisation genuinely resolves it; a gap in this
 // build offers nothing, because nothing the client does closes it.
 const needsReauth = connectedProviders(wear.states)
   .map((p) => linkFor(p.meta.id, p.meta.name, wear.states[p.meta.id] ?? 'connected', 'sleep'))
   .filter((l) => l.action === 'reconnect');
 // Everyone who connected Apple Health before TF-01 was never asked for Sleep,
 // and HealthKit answers a read it never got permission for with an empty array
 // rather than an error — so a permanently blank list looks exactly like a
 // client who never wears their watch.
 //
 // The never-asked half of that is now handled without the client having to
 // find this button: the provider raises the sheet once, by itself, for exactly
 // the people who were never asked (src/lib/wearables/sleepAccess.ts). So by the
 // time this block renders, the ask has happened — which is why the wording
 // below no longer says "Repple may never have been granted Sleep" and points
 // at the Health settings instead. The button stays for somebody who declined
 // and has changed their mind.
 const appleRead = sleepReads.reads.find((r) => r.provider === 'apple');
 const appleSilent = appleRead?.status === 'ready' && appleRead.readings.length === 0;
 const [askingHealth, setAskingHealth] = useState(false);
 const askHealthForSleep = async () => {
   setAskingHealth(true);
   try {
     await requestHealthAuth();
     await loadDeviceSleep();
   } catch (e) {
     reportError('recovery.sleepAuth', e);
   } finally {
     setAskingHealth(false);
   }
 };

 // Empty, not pre-filled. These used to start at 7.5 hours / quality 4, so
 // tapping Log sleep without touching either control filed a night the client
 // never had - which then became their sleep average and fed the readiness
 // score on the home screen.
 const [hrs, setHrs] = useState('');
 const [q, setQ] = useState(0);
 const [openRoutine, setOpenRoutine] = useState<number | null>(0);

 const avgSleep = sleep.length ? (sleep.reduce((a, s) => a + s.hours, 0) / sleep.length).toFixed(1) : '—';
 // Null when the client has not set a goal, because there is no percentage of
 // a goal that does not exist. Left as it was, `cups / goalCups` coerces the
 // null to 0: any glass logged divides by zero and gives Infinity, which
 // Math.min clamps to a confident 100% — a full ring and "Goal met today —
 // nice." to somebody who has never set a goal — and zero glasses gives NaN,
 // which the arc draws from.
 const pct = goalCups != null ? Math.min(100, Math.round((cups / goalCups) * 100)) : null;
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
   unit={goalCups != null ? `of ${goalCups} glasses` : cups === 1 ? 'glass today' : 'glasses today'}
   arc={pct == null ? undefined : pct / 100}
   note={goalCups == null
    ? 'No daily goal set — set one on Daily habits and this fills against it.'
    : cups >= goalCups ? 'Goal met today — nice.' : `${goalCups - cups} more to hit today's goal.`}
   onPress={goalCups == null ? () => router.push('/(client)/habits') : undefined}
  />
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingBottom: layout.section }}>
   <Ghost icon="minus" onPress={removeCup} />
   <View style={{ flex: 1 }}><Cta label="Add a Glass" wide onPress={addCup} /></View>
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
    title="Heart-rate Zones"
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
   <SectionHead title="Sleep" note={sleep.length ? `avg ${avgSleep} h logged` : undefined} />

   {/* ── what the devices recorded ──────────────────────────────────
       Kept above and apart from the hand-typed log below, and never
       averaged into it: a number somebody remembered in the morning and a
       number a ring measured are not the same kind of fact, and blending
       them would make both unfalsifiable. */}
   <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>FROM YOUR DEVICES</Text>
   {connectedKey === '' ? (
    <Text style={{ ...ty.label, color: t.ink3 }}>
     No device connected. Connect a watch or a ring in Watch &amp; devices and your nights appear here, each one labelled with which device recorded it.
    </Text>
   ) : sleepReads.status === 'loading' ? (
    <Text style={{ ...ty.label, color: t.ink3 }}>Reading your devices…</Text>
   ) : (<>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
     <Text style={{ ...value(30), color: lastNight?.outcome === 'measured' ? t.ink : t.ink3 }}>
      {formatSleepHours(lastNight?.minutesAsleep ?? null)}
     </Text>
     <Text style={{ ...ty.caption, color: t.ink3 }}>last night</Text>
    </View>
    {lastNight ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>{attribution(lastNight)}</Text> : null}

    {deviceNights.slice(1, 5).map((n) => (
     <View key={n.night} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
       gap: sp.md, paddingVertical: sp.sm, marginTop: sp.sm, borderTopWidth: hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.caption, color: t.ink3 }}>{nightLabel(n.night)}</Text>
      <View style={{ alignItems: 'flex-end', flex: 1 }}>
       <Text style={{ ...ty.caption, ...numeric, fontWeight: '500', color: n.outcome === 'measured' ? t.ink2 : t.ink3 }}>
        {formatSleepHours(n.minutesAsleep)}
       </Text>
       {/* Every row says where it came from, or why there is nothing —
           "not read" and "nothing recorded" are different answers. */}
       <Text style={{ ...ty.micro, color: t.ink3, marginTop: 2 }} numberOfLines={2}>
        {n.outcome === 'unknown' ? 'not read'
         : n.outcome === 'no-record' ? 'nothing recorded'
         : n.agreement === 'conflicting' && n.others[0]
         ? `${n.source?.sourceName} · ${n.others[0].sourceName} says ${formatSleepHours(n.others[0].minutesAsleep)}`
         : n.source?.sourceName}
       </Text>
      </View>
     </View>
    ))}

    {/* A device that could not be reached is stated, because the dashes
        above are otherwise read as nights of no sleep. */}
    {unreadable.map((r) => (
     <Text key={r.provider} style={{ ...ty.caption, color: t.warn, marginTop: sp.md }}>
      {r.reason || `${r.provider} could not be read, so any dash above may not mean you did not sleep.`}
     </Text>
    ))}
    {cannotReport.map((r) => (
     <Text key={r.provider} style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
      {r.reason || `${r.provider} cannot report sleep to Repple yet.`}
     </Text>
    ))}

    {/* The way out, on the screen that raised the problem. */}
    {needsReauth.length ? (
     <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
      <Ghost label={'Fix in Watch & devices'} onPress={() => router.push('/(client)/devices')} />
     </View>
    ) : null}

    {appleSilent ? (
     <View style={{ marginTop: sp.md }}>
      <Text style={{ ...ty.caption, color: t.ink3 }}>
       Apple Health was readable and holds no sleep for these nights. If you have been wearing your watch, Sleep sharing is probably switched off for Repple — Health ▸ Sharing ▸ Apps ▸ Repple.
      </Text>
      <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
       <Ghost label={askingHealth ? 'Asking…' : 'Allow sleep in Apple Health'} onPress={askHealthForSleep} />
      </View>
     </View>
    ) : null}
   </>)}

   <View style={{ height: sp.xl }} />
   <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>LOGGED BY YOU</Text>
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
   <Cta label="Log Sleep" wide disabled={!(parseFloat(hrs) > 0) || q < 1} onPress={() => { addSleep(parseFloat(hrs) || 0, q); setHrs(''); setQ(0); }} />
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
   <SectionHead title="Recovery Sessions" note={recoverySessions.length ? `${recoverySessions.length} recent` : undefined} />
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
    {/* The object form, not a query string: this targets a TAB, and the
        pathname/params pair is the shape expo-router resolves unambiguously
        for one. The Train screen reads `mode` in an effect rather than in a
        useState initialiser, because a tab stays mounted and an initialiser
        runs once in the life of the app. */}
    <Ghost label="Log a Recovery Session"
      onPress={() => router.push({ pathname: '/(client)/workouts', params: { mode: 'recovery' } })} />
   </View>
  </Section>

  <Rule />

  {/* ── mobility routines ───────────────────────────────────────────── */}
  <Section>
   <SectionHead title="Mobility & Warm-ups" note={`${MOBILITY.length} routines`} />
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
   <SectionHead title="Rest-day Guidance" />
   <Text style={{ ...ty.body, color: t.ink2 }}>Aim for 1–2 rest days a week. Deload every 4–6 weeks (drop ~40% volume) to let strength catch up. Light walking, mobility, and 7–9 h sleep beat total inactivity for recovery.</Text>
  </Section>
 </ScrollView>
 </SafeAreaView>
 );
}
