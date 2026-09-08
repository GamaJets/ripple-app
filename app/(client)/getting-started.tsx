// Client · Getting Started — the persistent one.
//
//   "Repple Coach has a Getting Started, however Client doesn't have this. This
//    is needed on the Client app to better help Clients understand the app and
//    its features."
//
// There is no screen called Getting Started in the coach app either. What that
// app did was show the first-run tour, because `repple.tour.seen.trainer` was
// unset on a fresh install; the client app did not, because its own key had
// been set on an earlier launch. So the difference reported is behavioural, and
// what it exposes is that a one-shot, skippable, per-device carousel is not a
// Getting Started. Once it is consumed it is gone, and somebody who skipped it,
// reinstalled, or changed handset has no route back that they would ever find.
//
// This screen is the route back, and it does not depend on having been caught
// on the right launch. It is a list of things worth doing with a tick against
// each, so it doubles as the "initial set up process" the same report asked
// for: what is done, what is left, and the screen that does each one.
//
// ── Where it is reachable from, and why that is three places ───────────────
//
//   · The home screen, as one row, WHILE it has anything left to say. That is
//     the discoverability half — Profile alone was the problem.
//   · The Me hub, forever. When the list finishes, the home row goes and this
//     is where it lives; a screen nothing links to is the other failure, and
//     scripts/check-reachable.mjs fails on it.
//   · Explore, so searching "start", "setup" or "tutorial" lands here.
//
// ── What a tick is allowed to mean ────────────────────────────────────────
//
// Every fact below is `boolean | null`, and null is a provider saying it did not
// answer. Those rows draw a dash rather than an empty circle, are counted
// neither as done nor as outstanding, and — the part that matters — stop the
// list calling itself finished. A checklist that congratulates somebody because
// three of its reads failed is worse than one that stays a day too long. The
// rules are in src/lib/firstRun.ts and tested in firstRun.test.ts.
import { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useClientData } from '../../src/ui/clientData';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useFoodLog } from '../../src/ui/foodLog';
import { useWearables } from '../../src/ui/wearables';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { isWhole } from '../../src/ui/loadStatus';
import { checklist, checklistDone, checklistLeft, nextTodo, type ChecklistRow } from '../../src/lib/firstRun';
import { ONBOARD_KEY } from './onboarding';
import { GUIDE_SEEN_KEY } from '../guide';
import { BACK_ICON, FORWARD_ICON } from '../../src/ui/direction';

export default function GettingStarted() {
  const t = useTheme();
  const router = useRouter();
  const c = useClientData();
  const { log, status: logStatus, reload: reloadLog } = useWorkoutLog();
  const food = useFoodLog();
  const wearables = useWearables();
  const { states } = wearables;
  // Every tick on this checklist is a claim about a server read — profile,
  // training log, food log, connected watch — and a read that failed leaves the
  // step showing as not done. Telling a member they have not started when they
  // have is the one thing this screen must not do twice.
  const pull = usePullToRefresh(useCallback(() => {
    c.reload(); reloadLog(); food.reload(); void wearables.syncAll();
  }, [c.reload, reloadLog, food.reload, wearables]));

  // Two device-local marks, read on every focus so a tick appears the moment
  // somebody comes back from the screen that earned it. null while the read is
  // in flight, which is the same "we do not know" the providers use.
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [guideSeen, setGuideSeen] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => {
    let gone = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([AsyncStorage.getItem(ONBOARD_KEY), AsyncStorage.getItem(GUIDE_SEEN_KEY)]);
        if (!gone) { setSetupDone(!!a); setGuideSeen(!!b); }
      } catch { if (!gone) { setSetupDone(null); setGuideSeen(null); } }
    })();
    return () => { gone = true; };
  }, []));

  const solo = c.coachingMode === 'solo';
  // `states` is empty until the provider has looked, and an empty map is not
  // the same claim as "no watch is connected" — see src/ui/wearables.tsx, where
  // a client with a live WHOOP token was told they had no device for exactly
  // this reason.
  const deviceKnown = Object.keys(states).length > 0;

  const rows = checklist({
    setup: setupDone,
    guide: guideSeen,
    // Already `boolean | null` at source: null is clientData saying the link
    // could not be read, which is not the same as not being linked.
    coach: c.coachLinked,
    workout: isWhole(logStatus) ? log.length > 0 : (log.length > 0 ? true : null),
    // Only today's log is loaded, so a `true` is trustworthy and a `false` is
    // only "not today". Both are read the same way: something logged is proof,
    // nothing logged on a settled read is a genuine no, and an unsettled one is
    // unknown.
    meal: isWhole(food.status) ? food.entries.length > 0 : (food.entries.length > 0 ? true : null),
    device: deviceKnown ? Object.values(states).some((s) => s === 'connected') : null,
    solo,
  });

  const done = checklistDone(rows);
  const left = checklistLeft(rows);
  const next = nextTodo(rows);
  const unknown = rows.length - done - left;
  const G = layout.gutter;

  const Tick = ({ state }: { state: ChecklistRow['state'] }) => (
    <View style={{
      width: 24, height: 24, borderRadius: radius.pill,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: state === 'done' ? t.brand : 'transparent',
      borderWidth: state === 'done' ? 0 : hairline,
      borderColor: t.ring,
    }}>
      {state === 'done' ? <Icon name="check" size={13} color={t.brandInk} /> : null}
      {/* A dash, not an empty circle. An empty circle is a claim that this has
          not been done, and under a failed read that is a claim we have not
          earned. */}
      {state === 'unknown' ? <Text style={{ ...ty.caption, color: t.ink3 }}>—</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, paddingBottom: sp.lg }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Getting started</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>
              {/* Counted, not fractioned, when part of the list is unreadable.
                  "4 of 6" over two failed reads states a denominator we cannot
                  stand behind. */}
              {unknown > 0 ? `${done} done` : `${done} of ${rows.length} done`}
            </Text>
          </View>
        </View>

        {next ? (
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
            Work through these in any order. Each one opens the screen that does it.
          </Text>
        ) : left === 0 && unknown === 0 ? (
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
            That is everything. This screen stays here if you want to look again.
          </Text>
        ) : (
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
            Some of this could not be read just now, so it is shown as a dash rather than as undone.
          </Text>
        )}

        <Section>
          {rows.map((r) => (
            <Pressable
              key={r.item.id}
              onPress={() => router.push(r.item.route as any)}
              accessibilityRole="button"
              accessibilityLabel={`${r.item.title}. ${r.state === 'done' ? 'Done' : r.state === 'unknown' ? 'Not known' : 'Still to do'}. ${r.item.note}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}
            >
              <Tick state={r.state} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: r.state === 'done' ? t.ink3 : t.ink }}>{r.item.title}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.item.note}</Text>
              </View>
              <Icon name={FORWARD_ICON} size={15} color={t.ink3} />
            </Pressable>
          ))}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="If Something Does Not Make Sense" />
          <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>
            Every tab has a row at the top saying what it is showing you. Open it, read it, and close it —
            it will not come back.
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.md }}>
            <Ghost label="User Guide" onPress={() => router.push('/guide')} />
            <Ghost label="Take the Tour" onPress={() => router.push('/tour')} />
          </View>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
