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
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useCoachSetup } from '../../src/ui/coachSetup';
import { useCoachDelivery, useDeliveryFact } from '../../src/ui/coachDelivery';
import { DeliveryModeChoice } from '../../src/ui/DeliveryModeChoice';
import { deliveryAskLine, deliveryNote } from '../../src/lib/coachDelivery';
import {
  coachSetupRows, coachSetupHeading, coachSetupNote, coachSetupNext, NOT_YOUR_SETUP,
  type CoachSetupRow,
} from '../../src/lib/coachFirstRun';
import { FORWARD_ICON } from '../../src/ui/direction';

export default function CoachGettingStarted() {
  const t = useTheme();
  const router = useRouter();
  const { facts, status, reload } = useCoachSetup();
  // How this coach works, from their own answer and their roster together. It
  // decides which steps are on the list at all: an online coach has no slots
  // for anybody to book, so "Set When You Work" is not a task they can finish.
  //
  // Under anything but a whole read this resolves to 'inperson', so a coach
  // whose roster or declaration did not come back gets the entire list. Nothing
  // is ever removed from a list because a read failed.
  const delivery = useDeliveryFact();
  const { refresh: refreshDelivery } = useCoachDelivery();

  // Re-read on every focus, so a tick appears the moment the coach comes back
  // from the screen that earned it. Without this a coach sets their currency,
  // returns, and is still being told to set their currency — which reads as the
  // setting not having saved.
  useFocusEffect(useCallback(() => { void reload(); void refreshDelivery(); }, [reload, refreshDelivery]));
  // The same two reads focus runs. This is the checklist a new coach works
  // through, and every line on it is ticked by something they do somewhere
  // else — often on another device, or on the web — so "I have done that, why
  // is it not ticked" is the exact question this gesture answers.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([reload(), refreshDelivery()]),
    [reload, refreshDelivery],
  ));

  const rows = coachSetupRows(facts, delivery.shape);
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
      {/* Neither a tick nor a dash. A step that does not apply to this coach
          has been answered and does not need doing, and both of the other two
          marks would say something untrue about it. */}
      {state === 'na' ? <View style={{ width: 8, height: hairline * 2, backgroundColor: t.ink3, borderRadius: 1 }} /> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

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
              accessibilityLabel={`${r.item.title}. ${r.state === 'done' ? 'Done' : r.state === 'unknown' ? 'Not known' : r.state === 'na' ? 'Does not apply to you' : 'Still to do'}. ${r.item.note}`}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md }}
            >
              <View style={{ paddingTop: 2 }}><Tick state={r.state} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: r.state === 'done' || r.state === 'na' ? t.ink3 : t.ink }}>{r.item.title}</Text>
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
                {/* A step that does not apply says WHY, and says how it comes
                    back. A row that quietly greyed itself is a row a coach
                    cannot ask a question about, and the answer to "where did
                    my availability step go" has to be on the row. */}
                {r.state === 'na' && NOT_YOUR_SETUP[r.item.id] ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                    {NOT_YOUR_SETUP[r.item.id]}
                  </Text>
                ) : null}
              </View>
              <View style={{ paddingTop: 4 }}><Icon name={FORWARD_ICON} size={15} color={t.ink3} /></View>
            </Pressable>
          ))}
        </Section>

        {/* ── the one step that is answered HERE ──────────────────────────
            Every other row opens the screen that does the thing. This one is
            three taps, so it is offered in place: a coach asked how they coach
            on the first run of a new app should not have to leave the list to
            say. The row above still opens Profile, which is where it is
            CHANGED later, and both render this same control — one set of words
            for one question. Skipping is simply not tapping: nothing is
            declared, nothing is hidden, and the row stays on the list. */}
        <Section>
          <SectionHead title="How Do You Coach?" />
          <DeliveryModeChoice onPicked={() => { void reload(); }} />
          {/* The ASK, until it has been answered, and the state afterwards.
              `deliveryAskLine` was written for this and imported by nothing —
              so the checklist counted the unanswered question against the coach
              while `deliveryNote` described a state rather than requesting an
              answer, and the coach was left to work out for themselves which
              control fills the row in. On the screen whose entire job is to say
              what is left. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {deliveryAskLine(delivery) ?? deliveryNote(delivery)}
          </Text>
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
