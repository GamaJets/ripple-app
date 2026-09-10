// Watch & Devices — the coach's own wearables.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// Coaches self-track, and a trainer screen for it is built on the CLIENT
// HOOKS — `useWearables`, `useDeviceHrv`, the provider registry — never by
// promoting a coach's account into a client's. The cost of not having this
// screen is written down in the header of app/(trainer)/my-nutrition.tsx: the
// coach build compiles HealthKit in and had no door in front of it, so a
// coach's Apple Health was permanently unasked, `dayBurn` returned null, and
// "calories remaining" quietly counted everything they ate and nothing they
// burned.
//
// That door was opened, and it is one provider wide and lives inside a food
// log. A coach could connect Apple Health while adding a meal and that was the
// whole of it: no way to connect WHOOP or Oura, no way to disconnect anything,
// and nowhere at all to read what their own devices had reported. This is that
// screen.
//
// ── Why it is not a copy of app/(client)/devices.tsx ───────────────────────
//
// That screen is a thousand lines doing four jobs: the device list, the
// workout importer into the training log, the per-device sleep provenance
// panel, and writing sessions back into Apple Health. A second copy of all
// four would drift from the first inside one release — the two would start
// answering "is WHOOP connected?" differently, which is the precise failure
// src/lib/wearableLinkLedger.ts was written to end after four TestFlight
// reports of the same reconnect loop.
//
// So nothing is duplicated. Every rule stays where it already lives and this
// file is only the coach's view of it:
//
//   · `PROVIDERS` is the catalogue — the names, the blurbs, and the honest
//     "not connectable in this build" rows. It is not re-listed here.
//   · `linkFor` is the ONE answer to whether a device is connected, evidence
//     and all, shared with every other screen that asks.
//   · `useDeviceHrv` keeps the nights; `hrvTrendLine`/`hrvBuildingLine` turn
//     them into the only sentence this app may print about HRV.
//   · `awaitingNote`/`liveFootnote` derive the empty states from the
//     catalogue, so a WHOOP-only coach is never told to wear an iPhone.
//
// Three things are deliberately ABSENT rather than forgotten:
//
//   · The workout importer. A coach's sessions go into their log through
//     app/(trainer)/my-training.tsx, and a second door into the same log is
//     how one session becomes two rows.
//   · The sleep provenance panel. It exists on the client screen to explain
//     where the Recovery figure came from, and the coach app has no Recovery
//     screen for it to explain.
//   · Writing sessions back into Apple Health. That writes permanently into
//     somebody's health record, comes out again only by hand one row at a
//     time, and belongs behind the fuller review the client screen gives it.
//
// ── HRV is a trend or it is nothing ────────────────────────────────────────
//
// src/lib/wearables/types.ts states the rule on the field itself: HRV is not
// comparable between people — 40 ms is an excellent night for one person and a
// warning for another — so every screen that prints it prints it against that
// person's OWN history and never against a population norm this app does not
// have and may not acquire. The coach gets exactly what the client gets: the
// figure, the device that measured it, and `hrvTrendLine`. Where there are not
// yet seven nights behind it, `hrvBuildingLine` says how many there are, which
// is a fact, instead of a comparison the data cannot support.
import { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { BRAND } from '../../src/lib/brands';
import { num, num1 } from '../../src/lib/format';
import { Icon, type IconName } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { tapLight } from '../../src/ui/haptics';
// LoadStatus has four answers and the two that are neither 'ready' nor 'error'
// are the ones that get printed as fact. `isWhole` is the gate; see
// src/ui/loadStatus.ts and scripts/check-whole.mjs.
import { isWhole } from '../../src/ui/loadStatus';
import { Rule, Section, SectionHead, Hero, Cta, Ghost, Flag } from '../../src/ui/kit';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import type { WearableProvider } from '../../src/lib/wearables/types';
import { useWearables } from '../../src/ui/wearables';
// One answer to "is this connected", shared with every screen that asks.
import { forgetLink, linkFor, useLinkRevision } from '../../src/lib/wearableLinkLedger';
import { useDeviceHrv } from '../../src/ui/deviceHrv';
import { hrvBuildingLine, hrvTrendLine } from '../../src/lib/hrvTrend';
import { awaitingNote, liveFootnote, permissionsNote } from '../../src/lib/wearables/liveNotes';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { BACK_ICON } from '../../src/ui/direction';

/** "3m ago" for the last sync stamp. */
function ago(ts?: number): string {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * One reading, as a row.
 *
 * Deliberately NOT `ListRow` from the kit, which is a `Pressable` with a
 * chevron and an accessibilityRole of 'button'. These rows go nowhere: there
 * is no detail sheet behind them on this screen, and a row that announces
 * itself as a button and then does nothing when pressed is worse than a row
 * that never claimed to be one — a screen-reader user swipes through five
 * buttons and finds that none of them work.
 *
 * The four Texts are marked `accessible` as one stop for the reason the kit's
 * own header gives: "Heart Rate", "62 bpm", "from WHOOP" is one fact, and
 * three stops with a swipe between them is three fragments.
 */
function Reading({ icon, title, note, lit }: { icon: IconName; title: string; note: string; lit: boolean }) {
  const t = useTheme();
  return (
    <View accessible accessibilityLabel={`${title}. ${note}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
      <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
        {/* The tile dims when there is no figure. Colour is never the only
            channel here — the note beside it says, in words, that nothing has
            come in and which device owes it. */}
        <Icon name={icon} size={17} color={lit ? t.brand : t.ink3} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{title}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{note}</Text>
      </View>
    </View>
  );
}

export default function TrainerDevices() {
  const t = useTheme();
  const router = useRouter();
  const w = useWearables();
  // Tonight's HRV and the coach's own baseline for it. Same hook the client
  // screen uses, so the two cannot come to hold different rules about what a
  // baseline is or how many nights one needs.
  const hrv = useDeviceHrv();
  // Re-render whenever the server proves something new about any device — a
  // token dying, a scope refused, or a reconnect clearing both. Without it this
  // screen would show whatever it decided on mount, which is half of why
  // reconnecting used to appear to do nothing.
  const linkRev = useLinkRevision();
  const G = layout.gutter;

  // Connected means the shared state machine says so, never the remembered flag
  // on its own: a device whose token the server has told us is dead is not
  // connected however firmly AsyncStorage remembers connecting it. Keyed on
  // `linkRev` as well as the states, because re-authorising an
  // already-connected device does not change WHICH devices are connected — and
  // that is exactly why a stale verdict used to survive the reconnect that
  // fixed it.
  const connected = useMemo(
    () => PROVIDERS.filter((p) => linkFor(p.meta.id, p.meta.name, w.states[p.meta.id] || 'disconnected').connected),
    [w.states, linkRev],
  );
  const connectedMeta = connected.map((p) => p.meta);
  const devicesWord = connected.length === 1 ? 'device' : 'devices';

  // Every figure here comes off a device that can stop answering, and without
  // this the only way to ask again is to leave the screen and come back. Both
  // reads are pulled: the day's metrics are the wearables store's, and the HRV
  // baseline is its own read of `device_hrv_nights`, so refreshing one and not
  // the other would leave last night's trend under this morning's burn.
  const pull = usePullToRefresh(useCallback(() => {
    w.syncAll();
    void hrv.reload();
  }, [w, hrv.reload]));

  // Re-sync on open, and only what is actually CONNECTED. Hitting every
  // available provider instead fires the wearable-day function for WHOOP, Oura,
  // Fitbit and Garmin alike on every visit — pointless round trips for vendors
  // with no stored token, each logging a notConnected report.
  useFocusEffect(useCallback(() => {
    for (const pv of PROVIDERS) {
      if (pv.isAvailable() && w.states[pv.meta.id] === 'connected') void w.sync(pv.meta.id);
    }
  }, [w.sync, w.states]));

  /* ── connecting, and unplugging ──────────────────────────────────────────
   *
   * The same flow as app/(client)/devices.tsx and app/(trainer)/my-nutrition.tsx,
   * deliberately: ask the provider whether it can run in this binary at all
   * before asking the person for permission, so a build without HealthKit says
   * why rather than opening nothing. */
  const onConnect = async (p: WearableProvider) => {
    const reason = p.unavailableReason();
    if (!p.isAvailable() && reason) { Alert.alert(p.meta.name, reason); return; }
    try {
      await w.connect(p.meta.id);
    } catch (e: any) {
      Alert.alert(p.meta.name, e?.message || 'Could not connect.');
    }
  };

  /**
   * Unplugging has to drop what the SERVER proved about the token as well as
   * the token itself, and it has to survive being refused.
   *
   * `forgetLink` is inside the success path on purpose. A verdict left behind
   * outlives its subject and would put "reconnect WHOOP" in front of a coach
   * who has just removed WHOOP deliberately; forgetting the link locally while
   * the token survives is the opposite failure, and is how the app comes to
   * show Disconnected over a device that reappears on the next launch.
   * `disconnectVendor` deletes a row and the server can refuse that — see the
   * note in src/ui/wearables.tsx, which rethrows so this can say so.
   */
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
   * `w.disconnect` runs a delete against `device_sleep_nights` for that
   * provider, so this is destructive and gets the same treatment every other
   * destructive action in this app gets — an Alert naming what goes, not a
   * toast, because reconnecting the watch does not bring the nights back. The
   * alert is specific about the two separate things that happen, since only
   * the first is what the word "disconnect" promises.
   */
  const confirmDisconnect = (p: WearableProvider) => {
    Alert.alert(
      `Disconnect ${p.meta.name}?`,
      `${BRAND.label} will stop reading from ${p.meta.name}, and the nights it measured are removed from the record kept for you. Nothing is deleted in the ${p.meta.name} app itself, and reconnecting starts a fresh record rather than bringing these nights back.`,
      [
        { text: 'Keep It', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => { void onDisconnect(p); } },
      ],
    );
  };

  /* ── today, and which device said so ─────────────────────────────────────
   *
   * `w.today` picks ONE device per field rather than averaging two, and
   * `w.todayFrom` says which — a figure whose source has been dropped cannot be
   * checked against the vendor's own app by the person it is about, and naming
   * the wrong device is worse than naming none. */
  const named = (key: 'activeKcal' | 'totalKcal' | 'heartRateAvg' | 'steps') => {
    const id = w.todayFrom[key];
    return (id ? PROVIDERS.find((p) => p.meta.id === id)?.meta.name : null) ?? 'your device';
  };

  // Active where a device gives it, whole-day otherwise, and never one label on
  // the other's number. The two differ by about 1,600 kcal — see the note on
  // DailyMetrics.activeKcal, which exists because they were once the same field.
  const energy: { kcal: number | null; kind: 'active' | 'total'; from: string } = (() => {
    if (typeof w.today.activeKcal === 'number') return { kcal: w.today.activeKcal, kind: 'active', from: named('activeKcal') };
    if (typeof w.today.totalKcal === 'number') return { kcal: w.today.totalKcal, kind: 'total', from: named('totalKcal') };
    return { kcal: null, kind: 'active', from: 'your device' };
  })();

  /**
   * Resting heart rate: the first CONNECTED device in registry order that
   * reported one, named.
   *
   * It is not on the `w.today` roll-up, so it is picked here — by the same rule
   * `tonightFrom` in src/ui/deviceHrv.ts picks a night's HRV, and for the same
   * reason. Not an average of two straps, because no device recorded an
   * average and neither vendor's app will agree with one; and not the lowest,
   * because "your best strap's figure" is a verdict dressed as a measurement.
   */
  const resting = useMemo(() => {
    for (const p of connected) {
      const bpm = w.metrics[p.meta.id]?.heartRateResting;
      if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) continue;
      return { bpm, from: p.meta.name };
    }
    return null;
  }, [connected, w.metrics]);

  /**
   * Whether what is on the row is a CURRENT reading.
   *
   * `isWhole`, not `w.todayStatus !== 'error'`. The comparison that reads
   * naturally admits 'loading' as well, and under 'loading' the figures are
   * whatever the last read left behind while the banner says they are live —
   * which is the defect scripts/check-whole.mjs exists for. 'loading' gets no
   * banner either: a first read still in flight is not a stale figure, and the
   * rows under it are empty anyway.
   */
  const stale = !isWhole(w.todayStatus) && w.todayStatus !== 'loading';
  const staleNote = stale
    ? `These are the last figures we had, not a current reading — ${connected.length === 1 ? 'your device' : 'one of your devices'} could not be reached just now. Pull down to try again.`
    : null;

  /**
   * The sentence under tonight's HRV figure.
   *
   * Four statuses, four answers, and none of them a comparison the data cannot
   * support. A trend where there is a baseline; the count so far where the
   * history was READ and is simply short; "still reading" while it is in
   * flight; and, where the read did not come back whole, the plain admission
   * that there is nothing to compare against — never "no baseline yet", which
   * would be a claim about the coach's own record made off a failed read.
   */
  const hrvLine = hrv.trend
    ? hrvTrendLine(hrv.trend)
    : hrv.status === 'loading'
      ? 'Reading your earlier nights…'
      : isWhole(hrv.status)
        ? hrvBuildingLine(hrv.nightsKept)
        : 'Your earlier nights could not be read in full just now, so there is nothing to compare tonight with.';

  // The panel is worth drawing once a device is connected AND something has
  // actually come in. HRV counts: a WHOOP-only coach whose day has not been
  // scored yet still has last night's variability, and hiding the panel would
  // hide the one figure their device published.
  const showToday = connected.length > 0 && (
    w.today.activeKcal != null || w.today.totalKcal != null
    || w.today.heartRateAvg != null || w.today.steps != null
    || resting != null || hrv.tonight != null
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your tracking</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Watch &amp; Devices</Text>
          </View>
        </View>

        {/* ── what your own devices are reporting today ──────────────────── */}
        {showToday ? (<>
          <Hero
            label={energy.kind === 'total' ? 'Energy Today' : 'Active Today'}
            figure={num(energy.kcal)}
            unit="kcal"
            note={energy.kcal == null
              ? `Wear your watch — energy syncs on its own from your ${connected.length} connected ${devicesWord}.`
              : stale
                ? `Last figure we had from ${energy.from} — it has not synced since, so it is not today's total yet.`
                : energy.kind === 'total'
                  ? `Whole day from ${energy.from}, rest included.`
                  : `Energy above rest, from ${energy.from}.`}
          />

          <Rule />

          <Section>
            <SectionHead title="Today" note={`${connected.length} ${devicesWord}`} />
            {/* Whether these are today's figures or the last ones we had. The
                store keeps the metrics through a failed sync — which is right,
                a watch that could not be reached did not un-burn the morning —
                so without this a stalled figure and a quiet afternoon look
                identical. Nothing is withheld: the numbers are real, they are
                just not current, and that is a third sentence. */}
            {staleNote ? <Flag tone={t.warn} style={{ marginBottom: sp.md }}>{staleNote}</Flag> : null}

            <Reading icon="flame"
              title={energy.kind === 'total' ? 'Energy Burned' : 'Active Calories'}
              lit={energy.kcal != null}
              note={energy.kcal == null
                ? awaitingNote('energy', connectedMeta)
                : energy.kind === 'total'
                  ? `${num(energy.kcal)} kcal across the whole day from ${energy.from}, resting metabolism included`
                  : `${num(energy.kcal)} kcal above rest, from ${energy.from}`} />

            <Reading icon="heart" title="Average Heart Rate"
              lit={w.today.heartRateAvg != null}
              note={w.today.heartRateAvg == null
                ? awaitingNote('heartRate', connectedMeta)
                : `${num(w.today.heartRateAvg)} bpm across today's samples, from ${named('heartRateAvg')}`} />

            <Reading icon="heart" title="Resting Heart Rate"
              lit={resting != null}
              note={resting == null
                ? awaitingNote('heartRate', connectedMeta)
                : `${num(resting.bpm)} bpm, from ${resting.from}`} />

            <Reading icon="trending" title="Steps"
              lit={w.today.steps != null}
              note={w.today.steps == null
                ? awaitingNote('steps', connectedMeta)
                : `${num(w.today.steps)} today, from ${named('steps')}`} />

            {/* HRV, and only ever as a trend against this coach's own nights.
                src/lib/wearables/types.ts states that rule on the field itself.
                The row is drawn only when a device actually reported a figure:
                a dash here would invite the reading that the coach's HRV is
                zero, and there is nothing useful to say about a measurement
                nothing measured. */}
            {hrv.tonight ? (
              <Reading icon="heart" title="Heart Rate Variability" lit
                note={`${hrv.tonight.ms} ms from ${hrv.tonight.sourceName} · ${hrvLine}`} />
            ) : null}

            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              {liveFootnote(connectedMeta)}
            </Text>
            {/* Where the permission itself is changed, which is a different
                place on iOS, on Android and on a cloud account. Null when
                nothing is connected, so this draws no instruction about a
                permission nobody has granted. */}
            {permissionsNote(connectedMeta, BRAND.label) ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {permissionsNote(connectedMeta, BRAND.label)}
              </Text>
            ) : null}
          </Section>
        </>) : null}

        {/* ── the devices themselves ─────────────────────────────────────── */}
        <Rule />
        <Section>
          <SectionHead title="Your Devices" note={connected.length ? `${connected.length} connected` : undefined} />
          {/* Every row in the catalogue, including the ones that cannot be
              connected in this build. Removing them would be the tidier list
              and the worse screen — see the header of
              src/lib/wearables/registry.ts, which argues it at length: a coach
              who owns a Garmin and finds no mention of it concludes Repple has
              never heard of the thing on their wrist. */}
          {PROVIDERS.map((p, i) => {
            const st = w.states[p.meta.id] || 'disconnected';
            const link = linkFor(p.meta.id, p.meta.name, st);
            const on = link.connected;
            const busy = !!w.busy[p.meta.id];
            const reason = p.unavailableReason();
            const blocked = !p.isAvailable() && !on;
            const m = w.metrics[p.meta.id];
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
                    // Named, because it is the only thing this row draws while the
                    // link is being changed and an unnamed spinner is not in the
                    // accessibility tree at all.
                    <ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel={`Working on ${p.meta.name}…`} />
                  ) : link.action === 'reconnect' ? (
                    // The primary control, because it is the one thing that
                    // fixes this — and offered ONLY where re-authorising
                    // genuinely helps. A gap in this build gets no button:
                    // pressing it changes nothing, and pressing it repeatedly
                    // is what four reports were made of.
                    <Cta label="Reconnect" a11yLabel={`Reconnect ${p.meta.name}`} onPress={() => onConnect(p)} />
                  ) : on ? (
                    // "Disconnect", not "Connected". A button says what
                    // pressing it does; the state is already on this row
                    // twice, in the dot beside the name and in the figures
                    // underneath. Labelling a destructive action with the
                    // state it undoes is how somebody taps it to find out what
                    // it means.
                    <Ghost label="Disconnect"
                      a11yLabel={`Disconnect ${p.meta.name}, and remove the nights it measured`}
                      onPress={() => confirmDisconnect(p)} />
                  ) : blocked ? (
                    <Ghost label="Unavailable" a11yLabel={`${p.meta.name} is unavailable — try connecting again`} onPress={() => onConnect(p)} />
                  ) : (
                    <Cta label="Connect" a11yLabel={`Connect ${p.meta.name}`} onPress={() => onConnect(p)} />
                  )}
                </View>

                {blocked && reason ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{reason}</Text> : null}

                {/* The state in words, wherever it is not simply working.
                    'live' says nothing here — the figures below it are the
                    evidence, and a line reading "connected" over a row of live
                    numbers is noise. Every other state gets its full sentence,
                    because one word standing in for four different situations
                    is the complaint this replaces. The tone goes in a dot and
                    the words stay ink: a status colour is a mark and is never
                    the colour of text — scripts/check-contrast.mjs. */}
                {link.state !== 'live' && link.state !== 'never' ? (
                  link.tone === 'warn'
                    ? <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{link.detail}</Flag>
                    : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{link.detail}</Text>
                ) : null}

                {on ? (
                  <View style={{ marginTop: sp.md }}>
                    {m ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg }}>
                        {/* Each figure only where the device actually sent one,
                            so an undeployed wearable-day leaves a row blank
                            rather than reporting a recovery of zero. */}
                        {m.activeKcal != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.activeKcal)} active kcal</Text>
                          : m.totalKcal != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.totalKcal)} kcal all day</Text> : null}
                        {m.heartRateAvg != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.heartRateAvg)} bpm avg</Text> : null}
                        {m.heartRateResting != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.heartRateResting)} resting</Text> : null}
                        {m.steps != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.steps)} steps</Text> : null}
                        {m.workoutMins != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num(m.workoutMins)} min</Text> : null}
                        {/* Attributed, because WHOOP calls it recovery and Oura
                            calls it readiness — both 0–100, both meaning the
                            same thing — and a coach cross-checking against the
                            vendor's own app needs the word it uses there. */}
                        {m.recoveryPct != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{Math.round(m.recoveryPct)}% {m.recoverySource === 'oura' ? 'readiness' : 'recovery'}</Text> : null}
                        {/* One decimal, because WHOOP's own app shows one and a
                            rounded 14 and a rounded 15 are a meaningfully
                            different day on a 0–21 logarithmic scale. */}
                        {m.strain != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{num1(m.strain)} strain</Text> : null}
                        {/* The raw night, beside its own device and nothing
                            else. The COMPARISON lives on the Today panel above,
                            against this coach's own baseline; what this row
                            says is only "this device measured this", which is a
                            provenance line rather than a verdict. */}
                        {m.hrv != null ? <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{Math.round(m.hrv)} ms HRV measured</Text> : null}
                      </View>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3 }}>Connected. Tap Sync — no data for today yet.</Text>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md }}>
                      <Ghost label="Sync Now" a11yLabel={`Sync ${p.meta.name} now`} onPress={() => { tapLight(); void w.sync(p.meta.id); }} />
                      {w.lastSync[p.meta.id] ? <Text style={{ ...ty.caption, color: t.ink3 }}>Synced {ago(w.lastSync[p.meta.id])}</Text> : null}
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
          {/* Names only the two cloud vendors that can actually be signed into,
              and says what the other two need — the same thing their own rows
              say, rather than the opposite. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
            Apple Health reads your paired Apple Watch through HealthKit, and Google Fit / Health Connect reads what your Android phone and watch write into it. WHOOP and Oura connect through their own APIs — sign in once and the day syncs on its own. Fitbit and Garmin are not connectable in this version; on an iPhone, both write into Apple Health, so connecting that picks their days up.
          </Text>
        </Section>

        <Rule />

        {/* ── whose record this is ───────────────────────────────────────── */}
        <Section>
          <SectionHead title="Yours Only" />
          <Text style={{ ...ty.label, color: t.ink2 }}>
            Everything on this screen is your own body, on your own account. Nothing here is shown to a client, and connecting a device changes nothing about what you can see of theirs — a client's wearables are connected by the client, on their own phone, and reach you only through the screens they already feed.
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Your figures feed your own food log: My Nutrition counts the day’s burn against what you have eaten, and while nothing is connected it counts the eating and none of the burning.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
