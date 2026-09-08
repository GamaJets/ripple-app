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
import { BRAND } from '../../src/lib/brands';
import { num, num1 } from '../../src/lib/format';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator, Modal, TextInput } from 'react-native';
import { Icon } from '../../src/ui/Icon';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import type { WearableProvider, WorkoutSample } from '../../src/lib/wearables/types';
import { useWearables } from '../../src/ui/wearables';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { importSources, withHr, useImportedIds, isLogged, fetchRecent } from '../../src/ui/watchImport';
import { isWhole } from '../../src/ui/loadStatus';
import type { WriteOutcome } from '../../src/lib/offlineQueue';
import { tapLight } from '../../src/ui/haptics';
import { Rule, Section, SectionHead, Hero, ListRow, Cta, Ghost, Flag, Notice, fig } from '../../src/ui/kit';
import { requestHealthAuth, writeAuthStatus, type WriteAuth } from '../../src/lib/wearables/appleHealth';
import {
  planWrite, readLedger, writeSessions, summariseResult, writeUnavailableReason,
  DURATION_SOURCE_LABEL,
  type Ledger, type WriteResult,
} from '../../src/lib/wearables/appleHealthWrite';
import { reportError } from '../../src/lib/reportError';
import { readSleepFromDevices } from '../../src/lib/wearables/sleep';
import { awaitingNote, liveFootnote, permissionsNote } from '../../src/lib/wearables/liveNotes';
// One answer to "is this connected", shared with Recovery. See
// src/lib/wearableLink.ts — this screen and that one used to compute it
// separately and contradict each other in front of the same client.
import { forgetLink, linkFor, useLinkRevision } from '../../src/lib/wearableLinkLedger';
import { formatSleepHours, recentNights, type SleepRead } from '../../src/lib/sleepMerge';
import { fmtDay, fmtTime } from '../../src/lib/format';
// Distance in the member's own unit. See src/lib/distance.ts for why it is
// derived from the length unit rather than being a third pill in Settings.
import { distanceLabel, distanceUnitFor, metresLabel } from '../../src/lib/distance';
import { useSettings } from '../../src/ui/settings';
// HRV as a trend against the member's own baseline, which is the only way this
// app is allowed to print it — src/lib/wearables/types.ts states that rule on
// the field itself, and this screen was breaking it.
import { useDeviceHrv } from '../../src/ui/deviceHrv';
import { hrvBuildingLine, hrvTrendLine } from '../../src/lib/hrvTrend';
import { sp, layout, radius, hairline, type as ty, numeric, value } from '../../src/theme/scale';
import { BACK_ICON } from '../../src/ui/direction';

type MetricKey = 'kcal' | 'hr' | 'hrv' | 'steps' | 'source';

/**
 * What to say about an import that did not land in the log.
 *
 * Two failures wearing one sentence is what this replaces. "Check your
 * connection and tap Import again" was printed for both, and for the commoner
 * of the two — no signal — it is now false in the direction that matters: the
 * session IS on this phone, it is in the log the member can see, and it goes up
 * on its own. Telling somebody to keep tapping a button for work that is
 * already safe is how a screen teaches people to distrust it.
 *
 * 'refused' keeps the honest half: the log read those rows and declined them,
 * so nothing is waiting and tapping Import again gets the same answer.
 *
 * `many` is passed rather than guessed off the subject's last letter. Half the
 * activity names a watch reports are singular nouns ending in 's' — Pilates,
 * Gymnastics, Crunches — and a sentence that reads "Pilates have not reached
 * your log" is the kind of thing a member screenshots.
 */
const importNote = (what: string, out: WriteOutcome, many: boolean): string =>
  out === 'unsent'
    ? `${what} ${many ? 'have' : 'has'} not reached your log yet — there is no connection. Nothing is lost: ${many ? 'they are' : 'it is'} saved on this phone and ${many ? 'go' : 'goes'} up on ${many ? 'their' : 'its'} own next time you have signal.`
    : `${what} ${many ? 'were' : 'was'} rejected by your log, so nothing was imported and nothing is waiting to send. Your watch still has ${many ? 'them' : 'it'}.`;

function ago(ts?: number): string {
 if (!ts) return '';
 const s = Math.floor((Date.now() - ts) / 1000);
 if (s < 60) return 'just now';
 const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
 const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
 return Math.floor(h / 24) + 'd ago';
}
/** "Mon 25 Aug · 18:30" — a session needs its time of day, not just its date:
 *  two sessions on one day are two different things to write.
 *
 *  This was a private `wkDate` that built the weekday out of a hardcoded
 *  English array and then wrote `${d.getDate()}/${d.getMonth() + 1}`, which is
 *  the exact pattern src/lib/format.ts records removing from five other files:
 *  the weekday is in a language the reader may not have, and "25/8" is 25
 *  August here and nothing at all in the United States, where it reads as a
 *  month of 25. It is interpolated into the list of sessions about to be
 *  written into Apple Health and into every failure line under it, so being
 *  wrong about which day it is means writing a workout onto the wrong one.
 *
 *  `fmtDay` and `fmtTime` are the shared answer, in the reader's own locale and
 *  their own clock. The NaN guard stays: it is the only thing between an
 *  unparseable timestamp and the string "Invalid Date · NaN:NaN" appearing in
 *  the middle of a list of things about to be written. */
function sessionWhen(iso: string): string {
 const d = new Date(iso);
 if (!isFinite(d.getTime())) return '—';
 return `${fmtDay(iso)} · ${fmtTime(iso)}`;
}

export default function Devices() {
 const t = useTheme();
 const router = useRouter();
 const w = useWearables();
 // The unit every distance on this screen is read out in. Derived from the
 // length unit rather than asked for again — see src/lib/distance.ts.
 const du = distanceUnitFor(useSettings().lengthUnit);
 // Tonight's HRV and the member's own baseline for it.
 const hrv = useDeviceHrv();
 // Re-render whenever the server proves something new about any device — a
 // token dying, a scope being refused, or a reconnect clearing both. Without
 // this the screen would go on showing whatever it decided on mount, which is
 // half of why reconnecting appeared to do nothing.
 const linkRev = useLinkRevision();
 const [detail, setDetail] = useState<MetricKey | null>(null);
 // `status`, which this screen dropped. Two things here read the log and both
 // of them are wrong without it:
 //
 //   · `alreadyLogged` decides whether a watch workout is already in the log.
 //     Against an empty-because-unread log every one of them reads as not
 //     logged and is offered for import again — so an unread log turns the
 //     import list into a duplicate-write path, which is the one failure on
 //     this screen that changes the member's record rather than just describing
 //     it wrongly.
 //   · `planWrite` decides what to push INTO Apple Health, and the screen then
 //     said "Your training log has no sessions yet, so there is nothing to
 //     write" — a flat claim about the member's whole log, from a read that had
 //     failed.
 const { log, status: logStatus, logWorkouts, setSessionMins, reload: reloadLog } = useWorkoutLog();
 const logWhole = isWhole(logStatus);
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
 // Every figure on this screen comes off a device that can stop answering, and
 // the only way to ask again was to leave the screen and come back. Pull to
 // refresh is the gesture people already try; see src/ui/pullToRefresh.tsx.
 // The watch sync was the whole of it. The HRV panel is its own read of
 // `hrv_nights`, and whether an imported session is already in the log is read
 // off the training log — so a member could pull this screen, watch the sync
 // spinner, and still be shown last night's HRV and a session marked
 // un-imported that they imported an hour ago.
 const pull = usePullToRefresh(useCallback(() => {
   void w.syncAll(); void hrv.reload(); reloadLog();
 }, [w, hrv.reload, reloadLog]));
 // Null, not false, when the log is not whole: "we cannot tell" is a third
 // answer and the row below renders it as one rather than as "not logged yet".
 const alreadyLogged = (sm: WorkoutSample): boolean | null =>
  logWhole ? isLogged(sm, importedIds, log) : (importedIds.has(sm.id) ? true : null);
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
 // The write's answer was being dropped on the floor. `markImported` is what
 // flips the row to "In log" — permanently, and it is the only record that the
 // workout was ever brought across — so marking it after a failed write retires
 // the row for good: the session is still on the watch, it is not in the log,
 // and the one control that would have fetched it again is gone from the screen.
 //
 // A QUEUED import is not marked either, and that is the conservative side of
 // the only choice here that cannot be undone. The mark is permanent; the queue
 // is not yet delivered. Offering the row again costs nothing, because
 // `alreadyLogged` matches the queued entries sitting in `log` and the row
 // disappears on its own the moment they go up.
 const importOne = async (sm: WorkoutSample) => {
  if (alreadyLogged(sm)) return;
  const out = await logWorkouts([await withHr(sm)]);
  if (out !== 'stored') { Alert.alert('Import workouts', importNote(sm.activity, out, false)); return; }
  markImported([sm.id]);
  tapLight();
 };
 const importAll = async () => {
  const fresh = (wk || []).filter((sm) => !alreadyLogged(sm));
  if (!fresh.length) return;
  const out = await logWorkouts(await Promise.all(fresh.map(withHr)));
  if (out !== 'stored') { Alert.alert('Import workouts', importNote(`Those ${fresh.length} workout${fresh.length === 1 ? '' : 's'}`, out, fresh.length !== 1)); return; }
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
 // Not planned at all from a log that is not whole. `planWrite` compares the
 // log against the ledger, so a prefix produces a plan that omits real sessions
 // and an empty read produces "nothing to write" — both stated as fact about a
 // permanent external record.
 const hkPlan = hkLedger && logWhole ? planWrite(log, hkLedger) : null;

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
 //
 // And it can fail. `disconnectVendor` deletes a row, the server can refuse
 // that, and until recently nothing here could tell — supabase-js resolves on a
 // database error, so a refused delete arrived looking exactly like a
 // successful one. The member was shown Disconnected over a watch that was
 // still connected to their account and that reappeared on the next launch.
 // `forgetLink` is deliberately inside the success path: forgetting the link
 // locally while the token survives is what makes the two disagree.
 const onDisconnect = async (p: WearableProvider) => {
  try {
   await w.disconnect(p.meta.id);
  } catch (e: any) {
   Alert.alert(
    p.meta.name,
    e?.message || `${p.meta.name} could not be disconnected just now, so it is still connected. Try again in a moment.`,
   );
   return;
  }
  forgetLink(p.meta.id);
 };

 /**
  * Ask first, because this deletes measurements.
  *
  * The control that called `onDisconnect` was labelled "Connected". It read as
  * a status pill — that is what the word is, everywhere else on this screen and
  * in the rest of the app — and it was one tap, with no question, into
  * `w.disconnect`, which runs a `.delete()` against `device_sleep_nights` for
  * that provider. So a member tapping what looked like a state indicator to see
  * what it said destroyed every night that device had measured, with no
  * warning, no confirmation and no undo. `app/(client)/injuries.tsx` states the
  * house rule: "Delete now has an <Alert> in front of it, like every other
  * destructive action in this app."
  *
  * The alert names what goes, because "are you sure?" over a row of six devices
  * does not say which one and does not say what is at stake. It is deliberately
  * specific about the two different things that happen — the connection ends
  * AND the nights are removed — since only the first is what the word
  * "disconnect" promises.
  *
  * `Alert` and not a toast: src/ui/toast.tsx is for a thing that can be undone
  * by doing it again, and reconnecting the watch does not bring the nights
  * back.
  */
 const confirmDisconnect = (p: WearableProvider) => {
  Alert.alert(
   `Disconnect ${p.meta.name}?`,
   `${BRAND.label} will stop reading from ${p.meta.name}, and the nights it measured are removed from your record here — your readiness will be built from whatever else you have. Nothing is deleted in the ${p.meta.name} app itself, and reconnecting starts a fresh record rather than bringing these nights back.`,
   [
    { text: 'Keep It', style: 'cancel' },
    { text: 'Disconnect', style: 'destructive', onPress: () => { void onDisconnect(p); } },
   ],
  );
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
 // HRV counts as a live reading too, and for the same reason totalKcal was
 // added: a WHOOP-only member whose day has not been scored yet still has last
 // night's variability, and hiding the whole panel would hide the one figure
 // their device actually published.
 const showLive = connected.length > 0 && (w.today.activeKcal != null || w.today.totalKcal != null || w.today.heartRateAvg != null || w.today.steps != null || hrv.tonight != null);

 const devicesWord = connected.length === 1 ? 'device' : 'devices';
 // The panel below is gated on ANY provider being connected, and its empty
 // state was written for one: "Wear your Apple Watch", "Comes from your
 // iPhone", and a footnote saying heart rate and calories need an Apple Watch.
 // src/lib/wearables/registry.ts lists Google Fit / Health Connect as a
 // connectable provider reading all five metrics, so an Android member was
 // being told to wear hardware they do not own on the one screen whose job is
 // explaining their device. WHOOP does not report steps at all, and was told
 // to wear an iPhone about it.
 //
 // Derived from the catalogue now — see src/lib/wearables/liveNotes.ts, which
 // is where the reasoning and the test live.
 const connectedMeta = connected.map((p) => p.meta);
 /**
  * Which device a figure on the Live row came from.
  *
  * Hoisted out of the energy block below, where it used to live, because every
  * figure on that row needs it and not only the calories. `w.today` picks ONE
  * device per field — see the notes on the roll-up in src/ui/wearables.tsx —
  * and a figure whose source has been dropped cannot be checked against the
  * vendor's own app by the person it is about, which is the complaint the sleep
  * section four rules down already answers in as many words.
  */
 //
 // `w.todayFrom`, not "the first connected provider that publishes this field".
 // That guess named `appleHealth` — element zero of the registry — for every
 // figure, so a member wearing an Apple Watch in the day and a WHOOP overnight
 // saw WHOOP's number captioned with the Apple Watch. They open Apple Health to
 // check it, find something else, and disbelieve the whole screen. The promise
 // four rules below this one is that a figure is "the figure one device
 // actually reported" and is NAMED; the figure kept that promise and the name
 // did not.
 const named = (key: 'activeKcal' | 'totalKcal' | 'heartRateAvg' | 'steps') => {
  const id = w.todayFrom[key];
  return (id ? PROVIDERS.find((p) => p.meta.id === id)?.meta.name : null) ?? 'your device';
 };
 /**
  * The line above the Live row when what is on it is not a current reading.
  *
  * Null while everything is answering, so an ordinary day carries no banner.
  * 'loading' is not warned about — a first read still in flight is not a stale
  * figure, and the row is empty under it anyway.
  */
 const staleNote = w.todayStatus === 'error'
  ? `These are the last figures we had, not a current reading — ${connected.length === 1 ? 'your device' : 'one of your devices'} could not be reached just now. Pull down to try again.`
  : null;
 // Active where a device gives it, whole-day otherwise, and never one label on
 // the other's number.
 const energy: { kcal: number | null; kind: 'active' | 'total'; from: string } = (() => {
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
 // "from your watch", singular and named, because that is now what it is. The
 // roll-up used to average this field across every connected device and this
 // blurb described the result as "the mean of today's samples" — of two
 // devices' means, which is a number neither watch recorded and neither
 // vendor's app will agree with.
 hr: { ico: 'heart', title: 'Average Heart Rate', value: `${num(w.today.heartRateAvg)} bpm`, blurb: `The mean of today’s heart-rate samples from ${named('heartRateAvg')}. Where two devices both measured today, this is the fuller of the two readings and not an average of them — no device recorded an average. During a workout, live heart rate is written into that session.` },
 hrv: {
  ico: 'heart',
  title: 'Heart Rate Variability',
  value: hrv.tonight ? `${hrv.tonight.ms} ms` : fig(null),
  // The whole content of this figure is the comparison, so the blurb leads
  // with why a bare number was worth nothing.
  blurb: hrv.tonight == null
   ? 'No connected device has reported HRV. WHOOP and Oura publish it; Apple Health carries it only if something on your phone writes it there.'
   : `${hrv.trend
     ? hrvTrendLine(hrv.trend)
     : hrv.status === 'error'
      ? 'Your earlier nights could not be read just now, so there is nothing to compare tonight with.'
      : hrvBuildingLine(hrv.nightsKept)}\n\nHRV is not comparable between people — 40 ms is an excellent night for one person and a warning for another — so ${BRAND.label} only ever shows yours against your own nights. Measured by ${hrv.tonight.sourceName}, as RMSSD in milliseconds, which is what your vendor's own app shows.`,
 },
 steps: { ico: 'trending', title: 'Steps', value: num(w.today.steps), blurb: `Today's steps from ${named('steps')} — the device that counted the most of them, not the sum of two devices counting the same walk twice. A simple daily-movement signal that complements your training.` },
 source: { ico: 'clock', title: 'Connected Sources', value: `${connected.length} ${connected.length === 1 ? 'device' : 'devices'}`, blurb: connected.map((p) => `• ${p.meta.name}`).join('\n') || 'No devices connected yet.' },
 };

 // ── pull-to-refresh here was reported dead, and the keyboard props are NOT why ──
 //
 // The report was precise: pulling this screen down did nothing, while the
 // coach's Watch & Devices refreshed. The two screens share the hook
 // (src/ui/pullToRefresh.tsx), the machine (src/lib/pullRefresh.ts), the store
 // (`useWearables`) and an equivalent reload callback, so the only structural
 // difference is the three keyboard props on the ScrollView below — which made
 // `automaticallyAdjustKeyboardInsets` the obvious culprit.
 //
 // It is not, and this is written down because the theory is convincing enough
 // to be re-derived by the next person. React Native's own implementation
 // settles it (node_modules/react-native/React/Views/ScrollView/RCTScrollView.m):
 //
 //   · `_registerKeyboardListener` is called UNCONDITIONALLY in
 //     `initWithEventDispatcher`, for every ScrollView in the app. The prop is
 //     read nowhere at mount — only inside `_keyboardWillChangeFrame:`, as an
 //     early return. With no keyboard on screen the prop has never run a line.
 //
 //   · That handler, for a non-inverted list, writes `newEdgeInsets.bottom`
 //     and nothing else. It never touches `.top`, which is where the
 //     RefreshControl lives. The "standing top inset swallows the pull" story
 //     describes something the code does not do.
 //
 //   · And it self-heals: on dismissal `endFrame` is off the bottom of the
 //     screen, so the inset computes back to zero.
 //
 // So the props are inert until a keyboard appears and harmless after it goes.
 // They are left exactly as the other sixty-seven screens have them.
 //
 // ── What it actually was: the difference is not on this screen ─────────────
 //
 // It was never in this file. app/(client)/_layout.tsx set `headerShown: false`
 // on the five bar tabs and nowhere else, so this screen — and every other
 // `href: null` screen in the client app — took the navigator's default and got
 // a bottom-tabs header on top of the one it draws itself. That header is
 // `44 + statusBarHeight` tall, and `elements/Screen` does not reset the safe
 // area under it, so the `<SafeAreaView edges={['top']}>` below then added the
 // top inset again: about 160 points between the top of the screen and the top
 // of the ScrollView, none of it belonging to the ScrollView.
 //
 // A RefreshControl belongs to its scroller. A pull started in that strip is not
 // a pull at all — no spinner, no error, nothing — while the coach's Watch &
 // Devices, in a group whose layout has always carried `headerShown: false`,
 // starts its list at the top of the screen and refreshes on the same code.
 // "Connected but not updating" is the same fault from the data side: the pull
 // never fired, so `syncAll` never ran.
 //
 // Fixed in the layout, for all sixty-six of those screens at once.

 const G = layout.gutter;

 return (
 <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
 {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
     is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
     KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
     already fills the container it pads.
     The padding stays at 40: the field sits well above the end of this screen, and the
     inset iOS adds already gives the focused row the room it needs to rise. Padding it
     out to a keyboard's height here would only scroll into empty space. */}
 <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
   keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
   keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} refreshControl={pull}>

  {/* ── header ──────────────────────────────────────────────────────── */}
  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
   <View style={{ flex: 1 }}>
    <Text style={{ ...ty.micro, color: t.ink3 }}>Wearables</Text>
    <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Watch &amp; Devices</Text>
   </View>
   <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
  </View>

  {/* ── the hero: today's live burn, when a device is feeding it ─────── */}
  {showLive ? (<>
   <Hero
    label={energy.kind === 'total' ? 'Energy Today' : 'Active Today'}
    figure={num(energy.kcal)}
    unit="kcal"
    // The staleness goes in the hero's own note as well as in the flag below,
    // because this is the figure the label calls "Active Today" — the one a
    // member reads and closes the screen on. A four-hour-old number under that
    // label, with the admission a section further down, is the admission in the
    // wrong place.
    // The FAILED read is asked about first, and it was asked about second —
    // which put it behind a null test it can never get past. `sync()` leaves
    // `metrics[id]` untouched when the first read throws, so a device that
    // could not be reached produces `energy.kcal == null` AND
    // `todayStatus === 'error'` together, and the chain answered "Wear your
    // watch": our own failed read, stated back to the member as something they
    // did not do. Two connected providers where one answers and the other does
    // not is enough to reach it — `showLive` is true, `todayStatus` is
    // `worstStatus(...)`, and the energy figure is still missing.
    note={w.todayStatus === 'error'
     ? (energy.kcal == null
      ? `We couldn’t read today’s energy from your ${connected.length} connected ${devicesWord}, so there is no figure here yet. That is our read, not a day you did not move.`
      : `Last figure we had from ${energy.from} — it has not synced since, so it is not today's total yet.`)
     : energy.kcal == null
      ? `Wear your watch — energy syncs on its own from your ${connected.length} connected ${devicesWord}.`
      : energy.kind === 'total'
       ? `Whole day from ${energy.from}, rest included · already inside your calorie target.`
       : `Energy above rest, from ${energy.from} · already inside your calorie target.`}
    onPress={() => setDetail('kcal')}
   />

   <Rule />

   <Section>
    <SectionHead title="Live Today" note={`${connected.length} ${devicesWord}`} onPress={() => setDetail('source')} />
    {/* Whether these figures are today's, or the last ones we had.
        `src/ui/wearables.tsx` kept the metrics through a failed sync — which is
        right, a watch that could not be reached did not un-burn the morning —
        and said nothing, so a stalled figure and a quiet afternoon looked
        identical. It says now. Nothing is withheld: the numbers are real, they
        are just not current, and that is a different sentence from either
        "live" or "unknown". */}
    {staleNote ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{staleNote}</Flag> : null}
    <ListRow icon="heart" title="Average Heart Rate"
     note={w.today.heartRateAvg == null ? awaitingNote('heartRate', connectedMeta) : `${num(w.today.heartRateAvg)} bpm across today's samples, from ${named('heartRateAvg')}`}
     onPress={() => setDetail('hr')} />
    {/* HRV, as a trend against the member's own nights and never as a bare
        number. src/lib/wearables/types.ts states that rule on the field itself
        — "40 ms is excellent for one member and a red flag for another" — and
        this screen used to print `62 ms HRV` off the last sync and keep
        nothing, so there was no history for it to be a trend against and could
        not have been. The nights are kept now (supabase/parts/720). */}
    {hrv.tonight ? (
     <ListRow icon="heart" title="Heart Rate Variability"
      note={hrv.trend
       ? `${hrv.tonight.ms} ms from ${hrv.tonight.sourceName} · ${hrvTrendLine(hrv.trend)}`
       : hrv.status === 'error'
        // The reading is real; what could not be read is the history behind it.
        // Said plainly, because "no baseline yet" would be a claim about the
        // member's own record made off a read that failed.
        ? `${hrv.tonight.ms} ms from ${hrv.tonight.sourceName} · your earlier nights could not be read, so there is nothing to compare it with just now.`
        : `${hrv.tonight.ms} ms from ${hrv.tonight.sourceName} · ${hrvBuildingLine(hrv.nightsKept)}`}
      onPress={() => setDetail('hrv')} />
    ) : null}
    <ListRow icon="trending" title="Steps"
     note={w.today.steps == null ? awaitingNote('steps', connectedMeta) : `${num(w.today.steps)} today, from ${named('steps')}`}
     onPress={() => setDetail('steps')} />
    <ListRow icon="clock" title="Connected Sources"
     note={connected.map((p) => p.meta.name).join(' · ')}
     onPress={() => setDetail('source')} />
    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
     {liveFootnote(connectedMeta)}
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
      ? <View style={{ alignSelf: 'flex-start', paddingVertical: sp.md }}><ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel="Looking for your workouts…" /></View>
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
          {/* The distance a watch recorded, in the unit the member measures
              distance in. It arrives from every provider in kilometres — that
              is what `WorkoutSample.distanceKm` means — and was printed with
              "km" after it whatever the phone was set to, so a runner in Dallas
              read their five miles as 8.05. */}
          <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{[fmtDay(sm.start), `${sm.mins} min`, sm.distanceKm ? distanceLabel(sm.distanceKm, du) : null, sm.kcal ? `${num(sm.kcal)} kcal` : null].filter(Boolean).join(' · ')}</Text>
         </View>
         {/* Three answers, not two. `done === null` means the training log
             could not be read whole, so we do not know whether this workout is
             already in it — and offering Import there is offering a duplicate.
             The button goes; the sentence explaining why is under the list. */}
         {done === true ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={'Already in log: ' + sm.activity}>
           <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.brand }} />
           <Text style={{ ...ty.caption, color: t.ink3 }}>In log</Text>
          </View>
         ) : done === null ? (
          <Text style={{ ...ty.caption, color: t.ink3 }} accessibilityLabel={'Cannot check whether this is already logged: ' + sm.activity}>Can’t check</Text>
         ) : (
          <Ghost label="Import" onPress={() => importOne(sm)} />
         )}
        </View>
       );
      })}
      {!logWhole ? (
       <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
        {logStatus === 'loading'
         ? 'Reading your training log, so we can’t yet tell which of these are already in it.'
         : 'Your training log could not be read in full, so we can’t tell which of these are already in it. Importing now would log some of them twice, so importing is off until it reads.'}
       </Text>
      ) : (
       <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
        <View style={{ flex: 1 }}><Cta label="Import All" wide onPress={importAll} /></View>
        <View style={{ flex: 1 }}><Ghost label="Refresh" onPress={findWorkouts} /></View>
       </View>
      )}
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
          r.status === 'error' ? (
           <Flag tone={t.warn} style={{ marginTop: 2 }}>
            {r.reason || 'Could not be read just now, so last night is unknown rather than empty.'}
           </Flag>
          ) : (
           <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            {r.reason || `Cannot report sleep to ${BRAND.label} yet.`}
           </Text>
          )
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
    Send the sessions you logged in {BRAND.label} to the Health app, so a gym session sits beside everything your watch recorded. One workout per session: a push day with eight exercises goes in as one entry, not eight.
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
       title={`Health is not letting ${BRAND.label} add workouts`}
       note={`You said no, and that stands — nothing has been written. To change it: Health ▸ Sharing ▸ Apps ▸ ${BRAND.label} ▸ turn on Workouts.`}
      />
     </View>
    ) : null}

    {hkLedger != null && !logWhole ? (
     // The ledger came back and the LOG did not. `planWrite` compares the two,
     // so there is nothing honest to plan — and "nothing to write" would be a
     // claim about the member's training rather than about this read.
     <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
      {logStatus === 'loading'
       ? 'Reading your training log…'
       : 'Your training log could not be read in full, so we can’t work out what is missing from Apple Health. Nothing has been written.'}
     </Text>
    ) : hkPlan == null ? (
     <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
      {hkBusy
       ? <ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel="Working out what is ready to write…" />
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
            // The plan carries metres, because that is what HealthKit takes.
            // What is PRINTED here is the member's own unit: this line is the
            // preview of what is about to be written into their Health app, and
            // "8.05 km" over a run they logged as five miles reads as the app
            // about to write down something they did not do.
            p.distanceMeters != null ? metresLabel(p.distanceMeters, du) : null,
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
      {hkBusy ? <ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel="Writing to Apple Health…" /> : (<>
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
    // ── connected, and not readable on this phone ────────────────────────────
    //
    // The third state, and it had no words anywhere. `blocked` is deliberately
    // `&& !on`, so the reason a provider cannot be read was printed only for
    // devices that are NOT connected — and `sync()` in src/ui/wearables.tsx
    // opens with `if (!p || !p.isAvailable()) return;`, before it sets a status,
    // a timestamp or a metric. So a device that is connected on the account but
    // unavailable in this binary sat here saying Connected, with a live green
    // dot, a Sync Now button that returned instantly and did nothing, no
    // "Synced" timestamp, no figures, and not one sentence explaining any of it.
    // Every sixty-second refresh skipped it in the same silence.
    //
    // Both of the devices this screen is about can land here. Apple Health is
    // unavailable in any build without HealthKit compiled in (Expo Go, or a
    // binary older than the shim), and a cloud vendor is unavailable in a build
    // whose client id is missing — while the token it was connected with is
    // still perfectly good on the server, so nothing upstream calls it
    // disconnected and nothing should.
    //
    // The figures are still whatever was last read, which is right and is what
    // the roll-up in src/ui/wearables.tsx says about a failed read too. What
    // changes is that the row now says they have stopped moving and why.
    const unreadable = on && !p.isAvailable();
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
        <ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel={`Working on ${p.meta.name}…`} />
       ) : link.action === 'reconnect' ? (
        // Offered as the primary control, because it is the one thing that
        // fixes this and the client has to be able to find it. It is offered
        // ONLY where re-authorising genuinely helps: a gap in this build
        // ('metric-blocked' with no action) does not get a button, because
        // pressing it changes nothing and pressing it repeatedly is what this
        // tester spent four reports doing.
        <Cta label="Reconnect" onPress={() => onConnect(p)} />
       ) : on ? (
        // "Disconnect", not "Connected". A button says what pressing it does;
        // the state is already on this row twice over, in the brand-coloured
        // dot beside the name and in the live figures underneath. Labelling a
        // destructive action with the state it undoes is how somebody taps it
        // to find out what it means — see `confirmDisconnect`.
        <Ghost label="Disconnect"
         a11yLabel={`Disconnect ${p.meta.name}, and remove the nights it measured`}
         onPress={() => confirmDisconnect(p)} />
       ) : blocked ? (
        // Unchanged: an unavailable provider's button re-attempts the connect,
        // which is the only thing there is to do about it.
        <Ghost label="Unavailable" onPress={() => onConnect(p)} />
       ) : (
        <Cta label="Connect" onPress={() => onConnect(p)} />
       )}
      </View>

      {blocked && reason ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{reason}</Text> : null}

      {/* Connected, and this build cannot read it — see `unreadable`. A warn
          flag rather than a caption, because the figures underneath are stale
          and nothing else on the row says so. The first sentence is the one
          fact the member cannot get anywhere else: their connection is fine.
          `reason` carries the rest where the provider has one; where it has
          none, saying "for a reason Repple has not named" is still better than
          the silence this replaces, and does not invent a cause. */}
      {unreadable ? (
       <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
        {`${p.meta.name} is connected, but this version of Repple cannot read it on this phone, so the figures below have stopped updating. `}
        {reason ?? 'Repple has not named the reason, which is a fault on our side rather than anything to do with your device.'}
       </Flag>
      ) : null}

      {/* The state in words, wherever it is not simply working.
          'live' says nothing here — the figures below it are the evidence, and
          a line saying "connected" over a row of live numbers is noise. Every
          other state gets its full sentence, because the complaint was one word
          standing in for four different situations. */}
      {link.state !== 'live' && link.state !== 'never' ? (
       link.tone === 'warn'
        ? <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{link.detail}</Flag>
        : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{link.detail}</Text>
      ) : null}

      {/* And the metric-level answer, kept visibly separate from the account
          one. This is the line that used to be absent here and present on
          Recovery as "needs reconnecting", which is how the two screens came to
          disagree about the same device in the same session. */}
      {sleepLink.state === 'metric-blocked' ? (
       sleepLink.tone === 'warn'
        ? <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{sleepLink.detail}</Flag>
        : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{sleepLink.detail}</Text>
      ) : null}

      {on ? (
       <View style={{ marginTop: sp.md }}>
        {(() => {
         const m = w.metrics[p.meta.id];
         // "Tap Sync" is an instruction, and it must not be given to somebody
         // for whom Sync cannot work: `sync()` returns at its first line for an
         // unavailable provider. The flag above this block has already said
         // why, so this only has to stop contradicting it.
         // …and a read that FAILED, or has not come back, is not a device with
         // nothing to say. `sync()` calls `setMetrics` on success and on a
         // `WearableNotConnectedError` only; every other throw leaves the key
         // undefined, so a token that 500s, a network that dropped and a first
         // read still in flight all arrived here as "no data for today yet" —
         // an absence claim over a question nobody got an answer to, with an
         // instruction to tap the button that had just failed. `syncStatus` is
         // on the context and is per provider, which is what makes the three
         // sentences separable.
         const st = w.syncStatus[p.meta.id];
         if (!m) return <Text style={{ ...ty.caption, color: t.ink3 }}>{
          unreadable ? 'Nothing has been read from this device on this phone.'
           : st === 'loading' ? 'Connected. Reading today from this device…'
           : st === 'error' ? 'Connected, but today could not be read from this device. That is our read failing rather than a day with nothing in it — try Sync again in a moment.'
           : 'Connected. Tap Sync — no data for today yet.'}</Text>;
         // A read that answered with every field empty rendered as an EMPTY ROW
         // — no figures, no message, and a "Synced just now" beside it. That is
         // the same silence the flag above exists to break, arriving by the
         // other route: a vendor that answered and holds nothing for today yet
         // (WHOOP publishes no cycle score until it has scored one), or a
         // metric endpoint refusing on a token that is otherwise fine. Saying so
         // is not a claim about which — only that we asked and got no numbers.
         if (m.activeKcal == null && m.totalKcal == null && m.heartRateAvg == null
          && m.heartRateResting == null && m.steps == null && m.workoutMins == null
          && m.recoveryPct == null && m.strain == null && m.hrv == null) {
          return <Text style={{ ...ty.caption, color: t.ink3 }}>Read, and {p.meta.name} has no figures for today yet.</Text>;
         }
         return (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg }}>
           {m.activeKcal != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.activeKcal)} active kcal</Text>
            : m.totalKcal != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.totalKcal)} kcal all day</Text> : null}
           {m.heartRateAvg != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.heartRateAvg} bpm avg</Text> : null}
           {m.heartRateResting != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.heartRateResting} resting</Text> : null}
           {m.steps != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.steps.toLocaleString()} steps</Text> : null}
           {m.workoutMins != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{m.workoutMins} min</Text> : null}
           {/* The three the catalogue above this row has always advertised.
               WHOOP's card sells "Strain, recovery, sleep & heart rate" and
               Oura's sells "Readiness, HRV & sleep", and until now a member who
               connected either one read those words and then found four rows of
               calories, heart rate and steps underneath — no recovery, no
               strain, no HRV anywhere in the app. Each is printed only when the
               device actually sent a number, so an undeployed wearable-day
               leaves them absent rather than showing a recovery of zero.

               The recovery figure is attributed. WHOOP calls it recovery and
               Oura calls it readiness, both 0–100 and both meaning the same
               thing, and a member cross-checking against the vendor's own app
               needs to know which word they are looking for. */}
           {m.recoveryPct != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{Math.round(m.recoveryPct)}% {m.recoverySource === 'oura' ? 'readiness' : 'recovery'}</Text> : null}
           {/* One decimal, because WHOOP's own app shows one and a rounded 14
               and a rounded 15 are a meaningfully different day on a 0–21
               logarithmic scale. */}
           {m.strain != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num1(m.strain)} strain</Text> : null}
           {m.hrv != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{Math.round(m.hrv)} ms HRV</Text> : null}
          </View>
         );
        })()}
        {/* No Sync button where syncing is a no-op. It returned instantly,
            changed nothing, wrote no timestamp and reported nothing, which
            teaches somebody to keep pressing it — the same loop
            src/lib/wearableLink.ts was written to end for reconnecting. */}
        {unreadable ? null : (
         <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md }}>
          <Ghost label="Sync Now" onPress={() => { tapLight(); w.sync(p.meta.id); }} />
          {w.lastSync[p.meta.id] ? <Text style={{ ...ty.caption, color: t.ink3 }}>Synced {ago(w.lastSync[p.meta.id])}</Text> : null}
         </View>
        )}
       </View>
      ) : null}
     </View>
    );
   })}
   {/* This footnote named four cloud vendors and said all four "connect
       through their own APIs — sign in once and the day syncs on its own."
       Two of them cannot be signed into at all: Fitbit has no client id in any
       build profile and Garmin needs a partnership Repple does not have, so
       both render as Unavailable three rows above the sentence claiming they
       work. It now names only the two that do, and says what the other two
       need — which is the same thing their rows say, rather than the opposite. */}
   <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
    Apple Health reads your paired Apple Watch through HealthKit, and Google Fit / Health Connect reads what your Android phone and watch write into it. WHOOP and Oura connect through their own APIs — sign in once and the day syncs on its own. Fitbit and Garmin are not connectable in this version; on an iPhone, both write into Apple Health, so connecting that picks their days up.
   </Text>
  </Section>
 </ScrollView>

 <Modal visible={detail != null} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
  <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setDetail(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
  <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 32 }}>
   {detail ? (
    <>
     <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
      <Text style={{ ...ty.title, color: t.ink }}>{DETAILS[detail].title}</Text>
      <Ghost label="Close" onPress={() => setDetail(null)} />
     </View>
     <Text style={{ ...value(34), color: t.ink, marginBottom: sp.md }}>{DETAILS[detail].value}</Text>
     <Text style={{ ...ty.body, color: t.ink2 }}>{DETAILS[detail].blurb}</Text>
     {/* Apple Health ▸ Sharing is the right answer on an iPhone and no answer
         at all on Android, where the same setting is in Health Connect, or on
         a WHOOP-only account, where nothing on the phone governs it. Null
         when nothing is connected. */}
     {permissionsNote(connectedMeta, BRAND.label) ? (
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>{permissionsNote(connectedMeta, BRAND.label)}</Text>
     ) : null}
    </>
   ) : null}
  </View>
 </Modal>
 </SafeAreaView>
 );
}
