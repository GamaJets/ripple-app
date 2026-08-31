// Watch & Devices — real wearable connections through the provider layer.
// Apple Health reads the paired Apple Watch; live metrics are tappable for detail.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: today's active
// energy is the screen's one hero figure, the four bordered metric tiles became
// hairline-separated list rows that still open the same detail sheet, and the
// three stacked bordered card stacks became sections separated by a rule.
//
// Also removed: the footnote claiming cloud devices "arrive with the backend
// rollout". They connect today — `makeCloudProvider` runs the vendor OAuth and
// reads the day through the edge function, and WHOOP already feeds the workout
// importer above it. The line described behaviour the code no longer has.
import { useState, useEffect, useCallback } from 'react';
import { num } from '../../src/lib/format';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator, Modal, TextInput } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import type { WearableProvider, WorkoutSample } from '../../src/lib/wearables/types';
import { useWearables } from '../../src/ui/wearables';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { importSources, withHr, useImportedIds, isLogged, fetchRecent } from '../../src/ui/watchImport';
import { tapLight } from '../../src/ui/haptics';
import { Rule, Section, SectionHead, Hero, ListRow, Cta, Ghost, Notice, fig } from '../../src/ui/kit';
import { requestHealthAuth, writeAuthStatus, type WriteAuth } from '../../src/lib/wearables/appleHealth';
import {
  planWrite, readLedger, writeSessions, summariseResult, writeUnavailableReason,
  DURATION_SOURCE_LABEL,
  type Ledger, type WriteResult,
} from '../../src/lib/wearables/appleHealthWrite';
import { reportError } from '../../src/lib/reportError';
import { readSleepFromDevices } from '../../src/lib/wearables/sleep';
// One answer to "is this connected", shared with Recovery. See
// src/lib/wearableLink.ts — this screen and that one used to compute it
// separately and contradict each other in front of the same client.
import { forgetLink, linkFor, useLinkRevision } from '../../src/lib/wearableLinkLedger';
import { formatSleepHours, recentNights, type SleepRead } from '../../src/lib/sleepMerge';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';

type MetricKey = 'kcal' | 'hr' | 'steps' | 'source';

function ago(ts?: number): string {
 if (!ts) return '';
 const s = Math.floor((Date.now() - ts) / 1000);
 if (s < 60) return 'just now';
 const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
 const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
 return Math.floor(h / 24) + 'd ago';
}
function wkDate(iso: string): string {
 const d = new Date(iso);
 return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}
/** "Mon 25/8 · 18:30" — a session needs its time of day, not just its date:
 *  two sessions on one day are two different things to write. */
function sessionWhen(iso: string): string {
 const d = new Date(iso);
 if (!isFinite(d.getTime())) return '—';
 return `${wkDate(iso)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Devices() {
 const t = useTheme();
 const router = useRouter();
 const w = useWearables();
 // Re-render whenever the server proves something new about any device — a
 // token dying, a scope being refused, or a reconnect clearing both. Without
 // this the screen would go on showing whatever it decided on mount, which is
 // half of why reconnecting appeared to do nothing.
 const linkRev = useLinkRevision();
 const [detail, setDetail] = useState<MetricKey | null>(null);
 const { log, addWorkouts, setSessionMins } = useWorkoutLog();
 const apple = PROVIDERS.find((p) => p.meta.id === 'apple');
 const appleReady = !!apple && apple.isAvailable();
 // Import is no longer Apple-only: any connected provider that implements
 // fetchWorkouts can feed the log. WHOOP does now, via the wearable-day function.
 const sources = importSources(w.states);
 const canImport = sources.length > 0;
 // How far back to pull. WHOOP documents no floor on `start` and HealthKit holds
 // everything on device, so this is a product choice, not an API limit.
 const LOOKBACKS = [14, 30, 90, 365] as const;
 const [lookback, setLookback] = useState<number>(14);
 const lookbackLabel = (d: number) => (d >= 365 ? '1 year' : d >= 90 ? '90 days' : `${d} days`);
 const importLabel = sources.length === 1 ? sources[0].meta.name : 'your devices';
 const [wk, setWk] = useState<WorkoutSample[] | null>(null);
 const [wkBusy, setWkBusy] = useState(false);
 const { ids: importedIds, mark: markImported } = useImportedIds();
 const alreadyLogged = (sm: WorkoutSample) => isLogged(sm, importedIds, log);
 const findWorkouts = async () => {
   if (!canImport) {
     Alert.alert('Import workouts', 'Connect Apple Health or WHOOP first (in Available Devices below), then tap Find my workouts.');
     return;
   }
   setWkBusy(true);
   try {
     const merged = await fetchRecent(w.states, lookback);
     setWk(merged);
     if (!merged.length) Alert.alert('Import workouts', `No workouts found in the last ${lookbackLabel(lookback)} from ${importLabel}.`);
   } catch (e: any) {
     Alert.alert('Import workouts', e?.message || 'Could not read your workouts.');
   } finally {
     setWkBusy(false);
   }
 };
 // `addWorkouts` resolves false when the insert never reached the server, and
 // its answer was being dropped on the floor. `markImported` is what flips the
 // row to "In log" — permanently, and it is the only record that the workout was
 // ever brought across — so marking it after a failed write retires the row for
 // good: the session is still on the watch, it is not in the log, and the one
 // control that would have fetched it again is gone from the screen.
 const importOne = async (sm: WorkoutSample) => {
  if (alreadyLogged(sm)) return;
  const saved = await addWorkouts([await withHr(sm)]);
  if (!saved) { Alert.alert('Import workouts', `${sm.activity} couldn't be added to your log. Check your connection and tap Import again.`); return; }
  markImported([sm.id]);
  tapLight();
 };
 const importAll = async () => {
  const fresh = (wk || []).filter((sm) => !alreadyLogged(sm));
  if (!fresh.length) return;
  const saved = await addWorkouts(await Promise.all(fresh.map(withHr)));
  if (!saved) { Alert.alert('Import workouts', `Those ${fresh.length} workout${fresh.length === 1 ? '' : 's'} couldn't be added to your log. Check your connection and tap Import all again.`); return; }
  markImported(fresh.map((sm) => sm.id));
  tapLight();
 };

 // ── Writing sessions BACK to Apple Health ─────────────────────────────────
 //
 // Off until asked, and it stays off. Nothing here runs on mount, on focus or
 // on the 60s auto-sync: a workout in somebody's Health record is permanent,
 // is theirs, and comes out again only by hand, one row at a time in Apple's
 // own app. So the person presses the button or nothing happens.
 //
 // `hkLedger` doubles as the "have we looked yet" flag — null means we have not
 // read the record of what is already in Health, which is a different thing
 // from having read it and found nothing to write. The plan is derived rather
 // than stored so that typing a session length below updates the lists
 // immediately, without a second round trip.
 const hkBlocked = writeUnavailableReason();
 const [hkLedger, setHkLedger] = useState<Ledger | null>(null);
 const [hkAuth, setHkAuth] = useState<WriteAuth | null>(null);
 const [hkBusy, setHkBusy] = useState(false);
 const [hkResult, setHkResult] = useState<WriteResult | null>(null);
 const [minsDraft, setMinsDraft] = useState<Record<string, string>>({});
 const hkPlan = hkLedger ? planWrite(log, hkLedger) : null;

 const reviewHk = async () => {
  setHkBusy(true);
  try {
   const [led, auth] = await Promise.all([readLedger(), writeAuthStatus()]);
   setHkAuth(auth);
   setHkLedger(led);
  } catch (e: any) {
   reportError('devices.reviewHk', e);
   Alert.alert('Apple Health', e?.message || 'Could not check what is ready to write.');
  } finally {
   setHkBusy(false);
  }
 };

 const writeHk = async () => {
  setHkBusy(true);
  setHkResult(null);
  try {
   // Anyone who connected before writing existed was never shown the workout
   // toggle — the old request asked for no write permissions at all. Ask now;
   // iOS stays silent for anything already decided.
   let auth = await writeAuthStatus();
   if (auth !== 'granted' && auth !== 'denied') {
    try { await requestHealthAuth(); } catch (e) { reportError('devices.writeHk.auth', e); }
    auth = await writeAuthStatus();
   }
   setHkAuth(auth);
   const res = await writeSessions(log, auth);
   setHkResult(res);
   setHkLedger(await readLedger());
   if (res.state === 'done' && res.written.length) tapLight();
  } catch (e: any) {
   reportError('devices.writeHk', e);
   Alert.alert('Apple Health', e?.message || 'Could not write to Apple Health.');
  } finally {
   setHkBusy(false);
  }
 };

 // The third source of a session length: the person types it. Refused rather
 // than repaired if it is not a positive number — a blank field means "nobody
 // has said", which keeps the session out of Health instead of inventing one.
 const saveSessionMins = (sessionT: string, key: string) => {
  const raw = (minsDraft[key] || '').trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) {
   Alert.alert('Session length', 'Enter how many minutes this session ran. There is no default: left blank, it stays out of Apple Health rather than going in with a made-up length.');
   return;
  }
  setSessionMins(sessionT, Math.round(n));
  setMinsDraft((prev) => ({ ...prev, [key]: '' }));
  setHkResult(null);
 };

 // Auto-refresh whenever this screen opens (plus the 60s auto-sync in the store).
 // Only re-sync providers that are actually CONNECTED. This used to hit every
 // available provider, so opening this screen fired wearable-day for WHOOP, Oura,
 // Fitbit and Garmin alike — three pointless edge-function round trips per visit
 // for vendors with no stored token, each logging a notConnected report.
 useFocusEffect(useCallback(() => {
  for (const pv of PROVIDERS) {
   if (pv.isAvailable() && w.states[pv.meta.id] === 'connected') w.sync(pv.meta.id);
  }
 }, [w.sync, w.states]));

 const onConnect = async (p: WearableProvider) => {
 const reason = p.unavailableReason();
 if (!p.isAvailable() && reason) { Alert.alert(p.meta.name, reason); return; }
 try {
 await w.connect(p.meta.id);
 } catch (e: any) {
 Alert.alert(p.meta.name, e?.message || 'Could not connect.');
 }
 };

 // Disconnecting has to drop what the server proved about the token as well as
 // the token itself. A verdict left behind outlives its subject, and would put
 // "reconnect WHOOP" in front of somebody who has just removed WHOOP on
 // purpose. `disconnectVendor` does this for the cloud providers; Apple Health
 // does not go through it, so it is done here for all of them.
 const onDisconnect = async (p: WearableProvider) => {
  await w.disconnect(p.meta.id);
  forgetLink(p.meta.id);
 };

 // Connected means the shared state machine says so — never the remembered flag
 // on its own. A device whose token the server has told us is dead does not
 // belong in this list, however firmly AsyncStorage remembers connecting it.
 const connected = PROVIDERS.filter((p) => linkFor(p.meta.id, p.meta.name, w.states[p.meta.id] || 'disconnected').connected);

 // Which of the connected devices sleep actually comes from (TF-01).
 //
 // This screen is where somebody goes to find out why a figure elsewhere says
 // what it says, so it states the answer per device rather than implying that
 // everything listed above feeds everything in the app. A provider that cannot
 // report sleep says so in its own words; it is not left blank, because blank
 // reads as "nothing recorded".
 const [sleepReads, setSleepReads] = useState<SleepRead[] | null>(null);
 const connectedKey = connected.map((p) => p.meta.id).join(',');
 useEffect(() => {
  let cancelled = false;
  (async () => {
   try {
    const reads = await readSleepFromDevices(w.states, 2);
    if (!cancelled) setSleepReads(reads);
   } catch (e) {
    reportError('devices.sleepSources', e);
    if (!cancelled) setSleepReads([]);
   }
  })();
  return () => { cancelled = true; };
  // `linkRev` alongside the provider list, because reconnecting an
  // already-connected device does not change WHICH devices are connected — and
  // that is exactly why the old sentence survived the reconnect that fixed it.
 }, [connectedKey, linkRev]);
 // Last night per device, UNMERGED. This list is about provenance, so each
 // recorder's own figure sits next to its own name and no precedence is
 // applied — deciding which one to believe is the Recovery screen's job, and
 // doing it twice in two places is how the two screens start disagreeing.
 // Apple Health can contribute several rows here, because it holds whatever
 // every watch and app on the phone wrote into it.
 const lastNightKey = recentNights(1)[0];
 // totalKcal counts as a live reading too. WHOOP publishes only that, so
 // testing activeKcal alone hid the whole panel from every WHOOP user the
 // moment its energy stopped being filed under the wrong name.
 const showLive = connected.length > 0 && (w.today.activeKcal != null || w.today.totalKcal != null || w.today.heartRateAvg != null || w.today.steps != null);

 const devicesWord = connected.length === 1 ? 'device' : 'devices';
 // Active where a device gives it, whole-day otherwise, and never one label on
 // the other's number.
 const energy: { kcal: number | null; kind: 'active' | 'total'; from: string } = (() => {
  const named = (key: 'activeKcal' | 'totalKcal') =>
   connected.find((p) => typeof w.metrics[p.meta.id]?.[key] === 'number')?.meta.name ?? 'your device';
  if (typeof w.today.activeKcal === 'number') return { kcal: w.today.activeKcal, kind: 'active', from: named('activeKcal') };
  if (typeof w.today.totalKcal === 'number') return { kcal: w.today.totalKcal, kind: 'total', from: named('totalKcal') };
  return { kcal: null, kind: 'active', from: 'your device' };
 })();
 const DETAILS: Record<MetricKey, { ico: string; title: string; value: string; blurb: string }> = {
 kcal: {
  ico: 'flame',
  // Which number a device publishes is not a detail: WHOOP reports the WHOLE
  // day including resting metabolism, Oura reports only energy above rest,
  // and the two differ by a night's sleep and a working day. Naming both the
  // quantity and the device it came from is what answers "where does the
  // 1,309 come from" without anybody having to ask.
  title: energy.kind === 'total' ? 'Energy Burned Today' : 'Active Calories Burned',
  value: `${num(energy.kcal)} kcal`,
  blurb: energy.kcal == null
   ? `No connected device has reported today's energy yet.`
   : energy.kind === 'total'
    ? `Your whole day's energy from ${energy.from}, resting metabolism included — which is most of it. Your calorie target already accounts for an ordinary day, so this is not extra food to eat.`
    : `Energy above resting from ${energy.from} — the part that is actually exercise. Your calorie target already accounts for an ordinary day's movement.`,
 },
 hr: { ico: 'heart', title: 'Average Heart Rate', value: `${num(w.today.heartRateAvg)} bpm`, blurb: 'The mean of today’s heart-rate samples from your watch. During a workout, live heart rate is written into that session.' },
 steps: { ico: 'trending', title: 'Steps', value: num(w.today.steps), blurb: 'Total steps today across your connected devices. A simple daily-movement signal that complements your training.' },
 source: { ico: 'clock', title: 'Connected Sources', value: `${connected.length} ${connected.length === 1 ? 'device' : 'devices'}`, blurb: connected.map((p) => `• ${p.meta.name}`).join('\n') || 'No devices connected yet.' },
 };

 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Wearables</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Watch &amp; Devices</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

  {/* ── the hero: today's live burn, when a device is feeding it ─────── */}
  {showLive ? (<>
   <Hero
    label={energy.kind === 'total' ? 'Energy Today' : 'Active Today'}
    figure={num(energy.kcal)}
    unit="kcal"
    note={energy.kcal == null
     ? `Wear your watch — energy syncs on its own from your ${connected.length} connected ${devicesWord}.`
     : energy.kind === 'total'
      ? `Whole day from ${energy.from}, rest included · already inside your calorie target.`
      : `Energy above rest, from ${energy.from} · already inside your calorie target.`}
    onPress={() => setDetail('kcal')}
   />

   <Rule />

   <Section>
    <SectionHead title="Live Today" note={`${connected.length} ${devicesWord}`} onPress={() => setDetail('source')} />
    <ListRow icon="heart" title="Average Heart Rate"
     note={w.today.heartRateAvg == null ? 'Wear your Apple Watch' : `${num(w.today.heartRateAvg)} bpm across today's samples`}
     onPress={() => setDetail('hr')} />
    <ListRow icon="trending" title="Steps"
     note={w.today.steps == null ? 'Comes from your iPhone' : `${num(w.today.steps)} today`}
     onPress={() => setDetail('steps')} />
    <ListRow icon="clock" title="Connected Sources"
     note={connected.map((p) => p.meta.name).join(' · ')}
     onPress={() => setDetail('source')} />
    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
     Updates automatically. Steps come from your iPhone; heart rate &amp; calories need an Apple Watch (wear it).
    </Text>
   </Section>
  </>) : null}

  {/* ── import workouts ─────────────────────────────────────────────── */}
  {canImport ? (<>
   <Rule />
   <Section>
    <SectionHead title="Import Workouts" note={importLabel} />
    <Text style={{ ...ty.label, color: t.ink2 }}>
     Pull sessions from your connected devices — runs, cycling, lifting, Pilates — straight into your training log. No manual entry.
    </Text>
    {/* How far back to look. Changing it clears the current list so the shown
        results always match the selected window. */}
    <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg, marginBottom: sp.lg, flexWrap: 'wrap' }}>
     {LOOKBACKS.map((d) => {
      const on = lookback === d;
      return (
       <Pressable
        key={d}
        onPress={() => { setLookback(d); setWk(null); }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`Look back ${lookbackLabel(d)}`}
        style={{
         paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.pill,
         backgroundColor: on ? t.brand : t.surface2,
        }}>
        <Text style={{ ...ty.caption, fontWeight: on ? '600' : '500', color: on ? t.brandInk : t.ink2 }}>
         {lookbackLabel(d)}
        </Text>
       </Pressable>
      );
     })}
    </View>
    {wk == null ? (
     wkBusy
      ? <View style={{ alignSelf: 'flex-start', paddingVertical: sp.md }}><ActivityIndicator color={t.brand} /></View>
      : <View style={{ alignSelf: 'flex-start' }}><Cta label="Find My Workouts" onPress={findWorkouts} /></View>
    ) : wk.length === 0 ? (
     <Text style={{ ...ty.label, color: t.ink3 }}>No workouts found in the last {lookbackLabel(lookback)}.</Text>
    ) : (
     <View>
      {wk.map((sm, i) => {
       const done = alreadyLogged(sm);
       return (
        <View key={sm.id} style={{
         flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
         borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
        }}>
         <View style={{ flex: 1 }}>
          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{sm.activity}</Text>
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{[wkDate(sm.start), `${sm.mins} min`, sm.distanceKm ? `${sm.distanceKm} km` : null, sm.kcal ? `${num(sm.kcal)} kcal` : null].filter(Boolean).join(' · ')}</Text>
         </View>
         {done ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={'Already in log: ' + sm.activity}>
           <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.brand }} />
           <Text style={{ ...ty.caption, color: t.ink3 }}>In log</Text>
          </View>
         ) : (
          <Ghost label="Import" onPress={() => importOne(sm)} />
         )}
        </View>
       );
      })}
      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
       <View style={{ flex: 1 }}><Cta label="Import All" wide onPress={importAll} /></View>
       <View style={{ flex: 1 }}><Ghost label="Refresh" onPress={findWorkouts} /></View>
      </View>
     </View>
    )}
   </Section>
  </>) : null}

  {/* ── where sleep comes from ──────────────────────────────────────── */}
  {connected.length ? (<>
   <Rule />
   <Section>
    <SectionHead title="Sleep Sources" note={`last night`} />
    <Text style={{ ...ty.label, color: t.ink2 }}>
     Sleep is read from every device you have connected, not from one of them. Where two disagree, Recovery shows the figure one device actually reported and names it — it never averages them into a number no device recorded.
    </Text>
    {sleepReads == null ? (
     <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>Checking your devices…</Text>
    ) : (
     <View style={{ marginTop: sp.lg }}>
      {sleepReads.map((r, i) => {
       const provider = PROVIDERS.find((p) => p.meta.id === r.provider);
       const lastNight = r.readings.filter((rd) => rd.night === lastNightKey);
       return (
        <View key={r.provider} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
         <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{provider?.meta.name ?? r.provider}</Text>
         {r.status !== 'ready' ? (
          // 'error' is louder than 'unsupported' because one of them means we
          // do not know what happened last night and the other means we never
          // asked. Both are stated; neither renders as a zero.
          <Text style={{ ...ty.caption, color: r.status === 'error' ? t.warn : t.ink3, marginTop: 2 }}>
           {r.reason || (r.status === 'error' ? 'Could not be read just now, so last night is unknown rather than empty.' : 'Cannot report sleep to Repple yet.')}
          </Text>
         ) : lastNight.length === 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Readable — nothing recorded for last night.</Text>
         ) : (
          lastNight.map((rd) => (
           <Text key={rd.sourceId} style={{ ...ty.caption, ...numeric, color: t.ink2, marginTop: 2 }}>
            {formatSleepHours(rd.minutesAsleep)} · {rd.sourceName}{rd.basis === 'in-bed' ? ' (time in bed)' : ''}
           </Text>
          ))
         )}
        </View>
       );
      })}
      <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
       <Ghost label="See Your Nights" onPress={() => router.push('/(client)/recovery')} />
      </View>
     </View>
    )}
   </Section>
  </>) : null}

  {/* ── write sessions back to Apple Health ─────────────────────────── */}
  <Rule />
  <Section>
   <SectionHead title="Write to Apple Health" note={hkAuth === 'granted' ? 'allowed' : undefined} />
   <Text style={{ ...ty.label, color: t.ink2 }}>
    Send the sessions you logged in Repple to the Health app, so a gym session sits beside everything your watch recorded. One workout per session: a push day with eight exercises goes in as one entry, not eight.
   </Text>
   <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
    What goes in: the activity, when it started, how long it ran, and energy and distance only where those were actually recorded. Nothing is estimated, nothing is written until you tap the button, and each session is written once.
   </Text>

   {hkBlocked ? (
    <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>{hkBlocked}</Text>
   ) : (<>
    {hkAuth === 'denied' ? (
     <View style={{ marginTop: sp.lg }}>
      <Notice
       kicker="Permission"
       title="Health is not letting Repple add workouts"
       note="You said no, and that stands — nothing has been written. To change it: Health ▸ Sharing ▸ Apps ▸ Repple ▸ turn on Workouts."
      />
     </View>
    ) : null}

    {hkPlan == null ? (
     <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
      {hkBusy
       ? <ActivityIndicator color={t.brand} />
       : <Cta label="See What's Ready" onPress={reviewHk} />}
     </View>
    ) : hkPlan.writable.length === 0 && hkPlan.skipped.length === 0 ? (
     <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
      {hkPlan.alreadyWritten > 0
       ? `Nothing new. All ${hkPlan.alreadyWritten} ${hkPlan.alreadyWritten === 1 ? 'session' : 'sessions'} in your log are already in Apple Health.`
       : 'Your training log has no sessions yet, so there is nothing to write.'}
     </Text>
    ) : (<>

     {/* Ready — every one of these has a length that came from somewhere real. */}
     {hkPlan.writable.length ? (
      <View style={{ marginTop: sp.lg }}>
       <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Ready to write</Text>
       {hkPlan.writable.map((p, i) => (
        <View key={p.key} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
         <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.activityLabel}</Text>
         <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>
          {[sessionWhen(p.t), `${fig(Math.round(p.seconds / 60))} min`,
            p.distanceMeters != null ? `${(p.distanceMeters / 1000).toFixed(2)} km` : null,
            p.kcal != null ? `${num(p.kcal)} kcal` : null,
           ].filter(Boolean).join(' · ')}
         </Text>
         {/* A measured 47 minutes and a typed 45 must not look the same. */}
         <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
          Length: {DURATION_SOURCE_LABEL[p.durationSource]}
          {p.activitySpecific ? '' : ' · goes in as “Other”, because this session mixes activities Health has no single name for'}
         </Text>
         <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{p.exercises.join(' · ')}</Text>
        </View>
       ))}
      </View>
     ) : null}

     {/* Blocked — stated plainly, with the one thing that would unblock it. */}
     {hkPlan.skipped.length ? (
      <View style={{ marginTop: sp.xl }}>
       <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>No length recorded — not written</Text>
       {hkPlan.skipped.map((sk, i) => (
        <View key={sk.key} style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
         <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{sk.exercises[0] || 'Session'}{sk.exercises.length > 1 ? ` +${sk.exercises.length - 1}` : ''}</Text>
         <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{sessionWhen(sk.t)} · {fig(null)} min</Text>
         <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{sk.reason}</Text>
         <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
          <TextInput
           value={minsDraft[sk.key] ?? ''}
           onChangeText={(v) => setMinsDraft((prev) => ({ ...prev, [sk.key]: v.replace(/[^0-9]/g, '') }))}
           keyboardType="number-pad"
           placeholder="—"
           placeholderTextColor={t.ink3}
           accessibilityLabel={`Minutes this session ran, ${sessionWhen(sk.t)}`}
           style={{
            width: 76, paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.sm,
            backgroundColor: t.surface2, color: t.ink, ...ty.body, ...numeric,
           }}
          />
          <Text style={{ ...ty.caption, color: t.ink3 }}>min</Text>
          <Ghost label="Save Length" onPress={() => saveSessionMins(sk.t, sk.key)} />
         </View>
        </View>
       ))}
      </View>
     ) : null}

     <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.xl }}>
      {hkBusy ? <ActivityIndicator color={t.brand} /> : (<>
       <Cta
        label={hkPlan.writable.length
         ? `Write ${hkPlan.writable.length} ${hkPlan.writable.length === 1 ? 'session' : 'sessions'}`
         : 'Nothing to write'}
        disabled={hkPlan.writable.length === 0}
        onPress={writeHk}
       />
       <Ghost label="Refresh" onPress={reviewHk} />
      </>)}
     </View>
     {hkPlan.alreadyWritten > 0 ? (
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
       {hkPlan.alreadyWritten} {hkPlan.alreadyWritten === 1 ? 'session is' : 'sessions are'} already in Apple Health and will not be written again.
      </Text>
     ) : null}
    </>)}

    {/* What actually happened. A partial run never reads as a success. */}
    {hkResult ? (
     <View style={{ marginTop: sp.lg }}>
      <Notice
       tone={hkResult.state === 'done' && hkResult.failed.length === 0 ? undefined : t.warn}
       kicker="Last write"
       title={summariseResult(hkResult)}
      >
       {hkResult.state === 'done' && hkResult.failed.length ? (
        <View style={{ marginTop: sp.sm }}>
         {hkResult.failed.map((f) => (
          <Text key={f.key} style={{ ...ty.caption, color: t.ink2, marginTop: 4 }}>
           • {f.activityLabel}, {sessionWhen(f.t)} — {f.reason}
          </Text>
         ))}
        </View>
       ) : null}
      </Notice>
     </View>
    ) : null}
   </>)}
  </Section>

  {/* ── available devices ───────────────────────────────────────────── */}
  <Rule />
  <Section>
   <SectionHead title="Available Devices" note={connected.length ? `${connected.length} connected` : undefined} />
   {PROVIDERS.map((p, i) => {
    const st = w.states[p.meta.id] || 'disconnected';
    // The account question and the sleep question, asked separately and
    // answered by the same function. Asking them separately is the fix: the
    // second one used to be allowed to change the answer to the first.
    const link = linkFor(p.meta.id, p.meta.name, st);
    const sleepLink = linkFor(p.meta.id, p.meta.name, st, 'sleep');
    const on = link.connected;
    const busy = !!w.busy[p.meta.id];
    const reason = p.unavailableReason();
    const blocked = !p.isAvailable() && !on;
    return (
     <View key={p.meta.id} style={{
      paddingVertical: sp.md,
      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
     }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
       <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="clock" size={17} color={on ? t.brand : t.ink3} />
       </View>
       <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
         {on ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} /> : null}
         <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{p.meta.name}</Text>
        </View>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{p.meta.blurb}</Text>
       </View>
       {busy ? (
        <ActivityIndicator color={t.brand} />
       ) : link.action === 'reconnect' ? (
        // Offered as the primary control, because it is the one thing that
        // fixes this and the client has to be able to find it. It is offered
        // ONLY where re-authorising genuinely helps: a gap in this build
        // ('metric-blocked' with no action) does not get a button, because
        // pressing it changes nothing and pressing it repeatedly is what this
        // tester spent four reports doing.
        <Cta label="Reconnect" onPress={() => onConnect(p)} />
       ) : on || blocked ? (
        <Ghost label={on ? 'Connected' : 'Unavailable'} onPress={() => (on ? onDisconnect(p) : onConnect(p))} />
       ) : (
        <Cta label="Connect" onPress={() => onConnect(p)} />
       )}
      </View>

      {blocked && reason ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{reason}</Text> : null}

      {/* The state in words, wherever it is not simply working.
          'live' says nothing here — the figures below it are the evidence, and
          a line saying "connected" over a row of live numbers is noise. Every
          other state gets its full sentence, because the complaint was one word
          standing in for four different situations. */}
      {link.state !== 'live' && link.state !== 'never' ? (
       <Text style={{ ...ty.caption, color: link.tone === 'warn' ? t.warn : t.ink3, marginTop: sp.sm }}>{link.detail}</Text>
      ) : null}

      {/* And the metric-level answer, kept visibly separate from the account
          one. This is the line that used to be absent here and present on
          Recovery as "needs reconnecting", which is how the two screens came to
          disagree about the same device in the same session. */}
      {sleepLink.state === 'metric-blocked' ? (
       <Text style={{ ...ty.caption, color: sleepLink.tone === 'warn' ? t.warn : t.ink3, marginTop: sp.sm }}>{sleepLink.detail}</Text>
      ) : null}

      {on ? (
       <View style={{ marginTop: sp.md }}>
        {(() => {
         const m = w.metrics[p.meta.id];
         if (!m) return <Text style={{ ...ty.caption, color: t.ink3 }}>Connected. Tap Sync — no data for today yet.</Text>;
         return (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg }}>
           {m.activeKcal != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.activeKcal)} active kcal</Text>
            : m.totalKcal != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.totalKcal)} kcal all day</Text> : null}
           {m.heartRateAvg != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.heartRateAvg} bpm avg</Text> : null}
           {m.heartRateResting != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.heartRateResting} resting</Text> : null}
           {m.steps != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.steps.toLocaleString()} steps</Text> : null}
           {m.workoutMins != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.workoutMins} min</Text> : null}
          </View>
         );
        })()}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md }}>
         <Ghost label="Sync Now" onPress={() => { tapLight(); w.sync(p.meta.id); }} />
         {w.lastSync[p.meta.id] ? <Text style={{ ...ty.caption, color: t.ink3 }}>Synced {ago(w.lastSync[p.meta.id])}</Text> : null}
        </View>
       </View>
      ) : null}
     </View>
    );
   })}
   <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
    Apple Health reads your paired Apple Watch through HealthKit. WHOOP, Oura, Garmin and Fitbit connect through their own APIs — sign in once and the day syncs on its own.
   </Text>
  </Section>
 </ScrollView>

 <Modal visible={detail != null} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
  <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setDetail(null)} />
  <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 32 }}>
   {detail ? (
    <>
     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
      <Text style={{ ...ty.title, color: t.ink }}>{DETAILS[detail].title}</Text>
      <Ghost label="Close" onPress={() => setDetail(null)} />
     </View>
     <Text style={{ ...value(34), color: t.ink, marginBottom: sp.md }}>{DETAILS[detail].value}</Text>
     <Text style={{ ...ty.body, color: t.ink2 }}>{DETAILS[detail].blurb}</Text>
     <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>Manage what Repple can read in Apple Health ▸ Sharing ▸ Repple.</Text>
    </>
   ) : null}
  </View>
 </Modal>
 </SafeAreaView>
 );
}
