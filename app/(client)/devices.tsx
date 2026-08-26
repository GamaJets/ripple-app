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
import { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator, Modal } from 'react-native';
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
import { Rule, Section, SectionHead, Hero, ListRow, Cta, Ghost } from '../../src/ui/kit';
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
function num(n: number | null | undefined, dashes = '—'): string {
 return typeof n === 'number' ? n.toLocaleString() : dashes;
}
function wkDate(iso: string): string {
 const d = new Date(iso);
 return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export default function Devices() {
 const t = useTheme();
 const router = useRouter();
 const w = useWearables();
 const [detail, setDetail] = useState<MetricKey | null>(null);
 const { log, addWorkouts } = useWorkoutLog();
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

 const connected = PROVIDERS.filter((p) => w.states[p.meta.id] === 'connected');
 const showLive = connected.length > 0 && (w.today.activeKcal != null || w.today.heartRateAvg != null || w.today.steps != null);

 const DETAILS: Record<MetricKey, { ico: string; title: string; value: string; blurb: string }> = {
 kcal: { ico: 'flame', title: 'Calories Burned', value: `${num(w.today.activeKcal)} kcal`, blurb: 'Active energy your watch recorded today. It feeds into your daily calorie target — on training days you can eat back what you earn.' },
 hr: { ico: 'heart', title: 'Average Heart Rate', value: `${num(w.today.heartRateAvg)} bpm`, blurb: 'The mean of today’s heart-rate samples from your watch. During a workout, live heart rate is written into that session.' },
 steps: { ico: 'trending', title: 'Steps', value: num(w.today.steps), blurb: 'Total steps today across your connected devices. A simple daily-movement signal that complements your training.' },
 source: { ico: 'clock', title: 'Connected Sources', value: `${connected.length} ${connected.length === 1 ? 'device' : 'devices'}`, blurb: connected.map((p) => `• ${p.meta.name}`).join('\n') || 'No devices connected yet.' },
 };

 const devicesWord = connected.length === 1 ? 'device' : 'devices';
 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Wearables</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Watch &amp; devices</Text>
   </View>
   <Ghost icon="back" onPress={() => router.back()} />
  </View>

  {/* ── the hero: today's live burn, when a device is feeding it ─────── */}
  {showLive ? (<>
   <Hero
    label="Burned today"
    figure={num(w.today.activeKcal)}
    unit="kcal"
    note={w.today.activeKcal == null
     ? `Wear your watch — active energy syncs on its own from your ${connected.length} connected ${devicesWord}.`
     : `Active energy from your watch · feeds your daily calorie target.`}
    onPress={() => setDetail('kcal')}
   />

   <Rule />

   <Section>
    <SectionHead title="Live today" note={`${connected.length} ${devicesWord}`} onPress={() => setDetail('source')} />
    <ListRow icon="heart" title="Average heart rate"
     note={w.today.heartRateAvg == null ? 'Wear your Apple Watch' : `${num(w.today.heartRateAvg)} bpm across today's samples`}
     onPress={() => setDetail('hr')} />
    <ListRow icon="trending" title="Steps"
     note={w.today.steps == null ? 'Comes from your iPhone' : `${num(w.today.steps)} today`}
     onPress={() => setDetail('steps')} />
    <ListRow icon="clock" title="Connected sources"
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
    <SectionHead title="Import workouts" note={importLabel} />
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
      : <View style={{ alignSelf: 'flex-start' }}><Cta label="Find my workouts" onPress={findWorkouts} /></View>
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
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{[wkDate(sm.start), `${sm.mins} min`, sm.distanceKm ? `${sm.distanceKm} km` : null, sm.kcal ? `${sm.kcal} kcal` : null].filter(Boolean).join(' · ')}</Text>
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
       <View style={{ flex: 1 }}><Cta label="Import all" wide onPress={importAll} /></View>
       <View style={{ flex: 1 }}><Ghost label="Refresh" onPress={findWorkouts} /></View>
      </View>
     </View>
    )}
   </Section>
  </>) : null}

  {/* ── available devices ───────────────────────────────────────────── */}
  <Rule />
  <Section>
   <SectionHead title="Available devices" note={connected.length ? `${connected.length} connected` : undefined} />
   {PROVIDERS.map((p, i) => {
    const st = w.states[p.meta.id] || 'disconnected';
    const on = st === 'connected';
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
       ) : on || blocked ? (
        <Ghost label={on ? 'Connected' : 'Unavailable'} onPress={() => (on ? w.disconnect(p.meta.id) : onConnect(p))} />
       ) : (
        <Cta label="Connect" onPress={() => onConnect(p)} />
       )}
      </View>

      {blocked && reason ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{reason}</Text> : null}

      {on ? (
       <View style={{ marginTop: sp.md }}>
        {(() => {
         const m = w.metrics[p.meta.id];
         if (!m) return <Text style={{ ...ty.caption, color: t.ink3 }}>Connected. Tap Sync — no data for today yet.</Text>;
         return (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg }}>
           {m.activeKcal != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.activeKcal} kcal</Text> : null}
           {m.heartRateAvg != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.heartRateAvg} bpm avg</Text> : null}
           {m.heartRateResting != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.heartRateResting} resting</Text> : null}
           {m.steps != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.steps.toLocaleString()} steps</Text> : null}
           {m.workoutMins != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.workoutMins} min</Text> : null}
          </View>
         );
        })()}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md }}>
         <Ghost label="Sync now" onPress={() => { tapLight(); w.sync(p.meta.id); }} />
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
