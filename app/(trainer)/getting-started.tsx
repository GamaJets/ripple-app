// Coach · Getting Started — the persistent one.
//
// The coach's half of the report quoted at length in src/lib/firstRun.ts. The
// client got a list that stays; the coach got a release-notes sheet and, if
// they happened to launch on the right day, a carousel. A one-shot, skippable,
// per-device carousel is not a Getting Started: consumed once it is gone, and
// somebody who skipped it, reinstalled or changed handset has no route back
// that they would ever find.
//
// ── Why the coach's version matters more than the client's ────────────────
//
// A client who never finishes setup gets a plan built from a default. Wrong,
// and recoverable in one screen. A coach who never sets a currency gets SIX
// screens of dashes — Money, Analytics, Invoices, Payments, the Statement and
// their own Profile all withhold every figure, correctly, and not one of them
// offers to fix it. That coach concludes the money features are broken, and
// nothing they can see contradicts them.
//
// ── Where it is reachable from, and why that is three places ──────────────
//
//   · The Clients screen, as one row, WHILE it has anything left to say.
//   · Explore, forever, so searching "setup", "start" or "tutorial" lands here
//     after the row has gone. A screen nothing links to is the other failure
//     and scripts/check-reachable.mjs fails on it.
//   · Settings, forever, for the same reason.
//
// ── What a tick is allowed to mean ────────────────────────────────────────
//
// Every fact is `boolean | null` and null is a read that did not answer. Those
// rows draw a dash, are counted neither as done nor as outstanding, and stop
// the list calling itself finished. "You have not connected Stripe" said to a
// coach who connected it in March, because one read was refused, is the
// sentence that sends them to disconnect a working payout account. The rules
// are in src/lib/coachFirstRun.ts and tested there; the reads are in
// src/ui/coachSetup.ts and each says why it can lie by succeeding.
import { useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useCoachSetup } from '../../src/ui/coachSetup';
import {
  coachSetupRows, coachSetupHeading, coachSetupNote, coachSetupNext,
  type CoachSetupRow,
} from '../../src/lib/coachFirstRun';

export default function CoachGettingStarted() {
  const t = useTheme();
  const router = useRouter();
  const { facts, status, reload } = useCoachSetup();

  // Re-read on every focus, so a tick appears the moment the coach comes back
  // from the screen that earned it. Without this a coach sets their currency,
  // returns, and is still being told to set their currency — which reads as the
  // setting not having saved.
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const rows = coachSetupRows(facts);
  const next = coachSetupNext(rows);
  const G = layout.gutter;

  const Tick = ({ state }: { state: CoachSetupRow['state'] }) => (
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, paddingBottom: sp.lg }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Getting started</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>{coachSetupHeading(rows)}</Text>
          </View>
        </View>

        <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
          {coachSetupNote(rows, status)}
        </Text>

        <Section>
          {rows.map((r) => (
            <Pressable
              key={r.item.id}
              onPress={() => router.push(r.item.route as any)}
              accessibilityRole="button"
              accessibilityLabel={`${r.item.title}. ${r.state === 'done' ? 'Done' : r.state === 'unknown' ? 'Not known' : 'Still to do'}. ${r.item.note}`}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}
            >
              <View style={{ paddingTop: 2 }}><Tick state={r.state} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: r.state === 'done' ? t.ink3 : t.ink }}>{r.item.title}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.item.note}</Text>
                {/* Why it is worth doing, on the rows that are not done. This is
                    the half a checklist usually leaves out and the reason a
                    coach skips the first item on it: "set your currency" is an
                    instruction, and "every money figure is a dash until you do"
                    is a reason. Hidden once it is done, because then it is only
                    a description of a problem the coach no longer has. */}
                {r.state === 'todo' ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                    Until this is done, {r.item.breaks}.
                  </Text>
                ) : null}
              </View>
              <View style={{ paddingTop: 4 }}><Icon name="chevron" size={15} color={t.ink3} /></View>
            </Pressable>
          ))}
        </Section>

        {next ? (
          <Section>
            <SectionHead title="Start Here" />
            <Text style={{ ...ty.body, color: t.ink2 }}>
              {next.title} is the first one still outstanding, and the rest of the list is easier once it is done.
            </Text>
            <View style={{ marginTop: sp.lg }}>
              <Ghost label="Open It" onPress={() => router.push(next.route as any)} />
            </View>
          </Section>
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="If Something Does Not Make Sense" />
          <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>
            Several screens carry a row at the top saying what they are showing you. Open it, read it, and close
            it — it does not come back.
          </Text>
          <View style={{ flexDirection: 'row', gap: sp.md, flexWrap: 'wrap' }}>
            <Ghost label="Search Every Screen" onPress={() => router.push('/(trainer)/explore')} />
            <Ghost label="Take the Tour" onPress={() => router.push('/tour')} />
          </View>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
