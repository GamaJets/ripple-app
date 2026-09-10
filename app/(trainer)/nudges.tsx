// Coach · Quiet clients. The screen that does something with the drift figure.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// src/lib/clientDrift.ts has been able to say which clients are breaking their
// own pattern for some time, and the Clients tab sorts on it. That was the
// whole of it: a band heading on a screen a coach opens for another reason. A
// coach with forty clients has to notice the third row of a list, on the week
// it matters — and the entire argument for computing drift in the first place
// was that they will not.
//
// ── THE THING THIS SCREEN DOES NOT DO ──────────────────────────────────────
//
// It does not send anything. There is no automatic message here and there is
// not going to be one. What it produces is a DRAFT, in a box, which the coach
// reads, edits and sends with their own thumb through the ordinary thread —
// `useThread(clientId, 'coach').send`, the same call the chat screen makes.
//
// That is not caution, it is the removal of a defect this codebase has already
// had once: `messages.sender` was taken from the caller's own request, so a
// client could post into their thread as 'coach' and their phone would render
// it as words from their coach. A message that appears to come from a person
// who did not write it is the failure. Composing one on a coach's behalf and
// delivering it under their name would be the same falsehood at scale, with
// the app's blessing — and the client on the other end would be reading a
// sentence in their coach's voice that their coach had never seen.
//
// So: the draft is always visible before the send, the send button is the last
// thing on the sheet, and `client_nudges` is written AFTER the message lands,
// never before and never instead.
//
// "Lands" means one of two things and deliberately not three. The row is on the
// server, OR the words are in the outbox and this phone has undertaken to send
// them (src/ui/messaging.ts · `keepForLater`, which answers `queued`). Both are
// events; a send that simply failed is not one, and records nothing. Writing
// the record FIRST is what this cannot do — see the note on `onSent` below for
// why part 2300's ordering does not carry over to two round trips with no
// transaction around them.
//
// ── The three states this screen must keep apart ───────────────────────────
//
// Everything here is a prompt to contact a person, so a wrong one costs a phone
// call to somebody who trained yesterday — which, to the one client who was
// paying attention, looks exactly like the coach who was not.
//
//   error    the read did not come back. NOTHING is suggested and the banner
//            says so. An empty list here is not a calm week.
//   partial  something came back cut off. Also nothing suggested: a gap in a
//            training record is indistinguishable from silence, and this is the
//            one screen where that distinction is the entire feature.
//   ready    the list is the list. Even then, `withheld` is printed — a coach
//            with four hand-added clients is told that four people on their
//            book cannot be assessed at all, rather than being left to read a
//            short list as good news.
//
// ── And the caveat, which is not decoration ────────────────────────────────
//
// Drift is a fall in what the RECORD holds. An injury, a fortnight away, a
// change of gym, a lapsed payment and somebody who simply stopped opening the
// app all produce this exact shape. `WHAT_IT_CANNOT_SEE` is on every card and
// again on the draft sheet, and the draft itself never names a cause — see
// `NEVER_SAYS` in src/lib/nudge.ts, which is checked against every sentence
// this screen can print.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Cta, Notice, Flag, Card } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { USE_SUPABASE } from '../../src/lib/config';
import { useNudges } from '../../src/ui/nudges';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useThread } from '../../src/ui/messaging';
import { DRIFT_LABEL, bandNote, type Drift } from '../../src/lib/clientDrift';
import {
  WHAT_IT_CANNOT_SEE, ACTION_LABEL, refusalsIn, watchDigestNote,
  type Evidence, type Nudge, type MutedRow,
} from '../../src/lib/nudge';
import { paceNote } from '../../src/lib/interventions';
import { cadenceLine, overdueNote } from '../../src/lib/cadence';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { BACK_ICON } from '../../src/ui/direction';
import { useScrollPad } from '../../src/ui/keyboardPad';

/** The mark beside a verdict. A coloured dot beside ink text, never coloured
 *  text: the scale reserves status colour for status and none of these clears
 *  AA as type. Matches driftTone on the Clients tab so one client does not
 *  change colour between two screens. */
function driftTone(t: ReturnType<typeof useTheme>, d: Drift): string {
  switch (d.status) {
    case 'at_risk': return t.crit;
    case 'idle': return t.warn;
    case 'watch': return t.serious;
    default: return t.good;
  }
}

export default function Nudges() {
  const t = useTheme();
  const router = useRouter();
  const n = useNudges();
  // One read, and it is about SILENCE — who has not been heard from. Nothing
  // the coach does on this screen changes it; what changes it is a client
  // finally training or replying, somewhere else.
  const pull = usePullToRefresh(useCallback(() => n.reload(), [n]));

  // Two sheets, two independent flags. A sibling pair whose `visible`
  // expressions share an identifier is the bug check-runtime-traps.mjs exists
  // for: iOS will not stack two modals from the same parent, so the second is
  // silently dead.
  const [drafting, setDrafting] = useState<Nudge | null>(null);
  const [explaining, setExplaining] = useState<Nudge | MutedRow | null>(null);
  const [showMuted, setShowMuted] = useState(false);
  /** Clients whose message is on this phone waiting for signal, this sitting.
   *  See the ordering note on `onSent` below: it is what keeps this screen's
   *  "Nobody is suggested twice" true in the window where the server has not
   *  been told anything yet. */
  const [queuedFor, setQueuedFor] = useState<string[]>([]);
  // The watch digest opens itself when it is due for the week and is otherwise
  // a section the coach may open. Its own flag: sharing one with `showMuted`
  // would make closing one close the other.
  const [showWatch, setShowWatch] = useState(false);

  const board = n.board;

  const setAside = (item: Nudge) => {
    Alert.alert(
      `Set ${item.name ?? 'this client'} aside?`,
      `They will not be suggested again for ${item.mutedDaysIfDismissed} days. They stay on your Clients tab throughout — this only stops the prompt.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set aside',
          onPress: () => {
            void n.recordDismissed(item.clientId, item.drift, item.observed).then((r) => {
              if (!r.ok) Alert.alert('Not recorded', r.reason);
            });
          },
        },
      ],
    );
  };

  const bringBack = (m: MutedRow) => {
    void n.undismiss(m.clientId).then((r) => {
      if (!r.ok) Alert.alert('Not brought back', r.reason);
    });
  };

  const nudgeCard = (item: Nudge, i: number) => (
    <View key={item.clientId}
      style={{ paddingVertical: sp.lg, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: driftTone(t, item.drift) }} />
        <Text style={{ ...ty.head, color: t.ink, flex: 1 }}>{item.name ?? 'Unnamed client'}</Text>
        <Text style={{ ...ty.micro, color: t.ink3 }}>{DRIFT_LABEL[item.drift.status]}</Text>
      </View>

      {/* What was OBSERVED. clientDrift's own sentence, so this screen and the
          band heading on the Clients tab cannot come to disagree. */}
      <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>{item.observed}</Text>

      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{item.caveat}</Text>

      {/* HOW LONG to leave it, from this client's own pattern.
          `Nudge.pace` has been on this object since the board was built and
          nothing rendered it: the number reached the screen only as
          `mutedDaysIfSent` inside a confirmation, so a coach could see how long
          a suggestion would go quiet for and never why that was the number.
          It is the whole argument for computing a per-client pace rather than
          using one window for everybody — fourteen days loses a client who came
          four times a week and says nothing at all about one who came
          fortnightly, whose ordinary gap between visits IS fourteen days. A
          coach shown a fixed window gives up on the second client for training
          normally. src/lib/interventions.ts owns the sentence. */}
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{paceNote(item.pace)}</Text>

      {/* A message already written to this person is sitting on this phone. No
          second draft is offered — not because the app is being careful with
          the coach, but because the two would both go when the signal comes
          back and the client would read the same sentence twice. Said in words,
          not by the button quietly disappearing. */}
      {queuedFor.includes(item.clientId) ? (
        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.lg }}>
          Your message to {item.name ?? 'them'} is saved on this phone and goes as soon as you are back
          online. Nothing else is drafted for them until it has gone.
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg, flexWrap: 'wrap' }}>
        {queuedFor.includes(item.clientId) ? null : (
          <Cta label="Write a Message" onPress={() => setDrafting(item)} />
        )}
        <Ghost label="Why Them?" onPress={() => setExplaining(item)} />
        <Ghost label="Set Aside" onPress={() => setAside(item)} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>Quiet Clients</Text>
          </View>
        </View>

        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Clients whose training record has gone quiet, with a message drafted for you. Nothing here
          sends: you read it, change it, and send it yourself. Nobody is suggested twice.
        </Text>

        <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{n.note}</Text>

        {/* What "quiet" is measured against, in one dismissible row. The banners
            below already say what a failed read means; this says what the word
            means when the read succeeded, which is the half a coach carries to
            the phone call. src/lib/screenHelp.ts holds the words. */}
        <ScreenHelp screen="coach-quiet" />

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Who has gone quiet is worked out from training records that live on the server, and there is no local copy of somebody else's. Nothing below is a claim that everybody is fine." />
          </Section>
        ) : n.status === 'loading' ? (
          <Section>
            {/* Named. The error branch below is emphatic that an empty screen must
                not read as a quiet week, and an unnamed spinner draws exactly that
                for a reader: nothing at all. */}
            <ActivityIndicator color={t.brand} accessible accessibilityRole="progressbar" accessibilityLabel="Working out who has gone quiet…" />
          </Section>
        ) : n.status === 'error' ? (
          <Section>
            <Notice tone={t.crit} kicker="Unreadable" title="Nothing is suggested, because nothing was read"
              note="This is not a quiet week. The training records did not come back, so no client can honestly be called quiet — pull back and open this again once you are connected.">
              <View style={{ marginTop: sp.md }}>
                <Ghost label="Try Again" onPress={() => { void n.reload(); }} />
              </View>
            </Notice>
          </Section>
        ) : n.status === 'partial' ? (
          <Section>
            <Notice tone={t.warn} kicker="Incomplete" title="Only part of the record came back"
              note="No client is suggested from a partial read. A gap in a training record looks exactly like silence, and this is the one screen where telling those apart is the whole point.">
              <View style={{ marginTop: sp.md }}>
                <Ghost label="Try Again" onPress={() => { void n.reload(); }} />
              </View>
            </Notice>
          </Section>
        ) : board ? (
          <>
            {board.withheld.length ? (
              <Section>
                <Notice tone={t.warn} kicker="Not assessed"
                  title={`${board.withheld.length} on your book could not be assessed`}
                  note="They are not below, and they are not fine — nothing could be read about them. This list is not your whole book.">
                  <View style={{ marginTop: sp.md }}>
                    {board.withheld.map((w) => (
                      <Flag key={w.clientId} tone={t.warn} style={{ marginTop: sp.sm }}>
                        {(w.name ?? 'Unnamed client') + ' — ' + w.note}
                      </Flag>
                    ))}
                  </View>
                </Notice>
              </Section>
            ) : null}

            {/* ── due back ───────────────────────────────────────────────
                The earlier signal, and it is deliberately ABOVE the quiet list
                rather than folded into it. Drift needs a fortnight of silence
                before it can say anything; a client's own interval between
                visits says "four days past their usual gap" on day four. By the
                time somebody reaches the list below, the conversation that
                would have kept them was ten days ago.

                Nobody on the board appears here — a client who is both quiet
                and late is one person, and naming them in two sections on one
                screen is how a coach comes to distrust both counts.

                No draft, and no Set Aside. Being a few days late is not enough
                to justify a message written for somebody, and a per-client
                prompt at this sensitivity is the nagging src/lib/nudge.ts
                refuses. What this offers is the client's own screen. */}
            <Rule />

            {n.dueBack && n.dueBack.length ? (
              <Section>
                <SectionHead title="Due back" note={`${n.dueBack.length}`} />
                <Text style={{ ...ty.label, color: t.ink2 }}>{overdueNote(n.dueBack)}</Text>
                <View style={{ marginTop: sp.md }}>
                  {n.dueBack.map((d, i) => (
                    <View key={d.clientId}
                      style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.serious }} />
                        <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, flex: 1 }}>
                          {d.name ?? 'Unnamed client'}
                        </Text>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>
                          {d.cadence.overdueDays} day{d.cadence.overdueDays === 1 ? '' : 's'} late
                        </Text>
                      </View>
                      <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>{cadenceLine(d.cadence)}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{WHAT_IT_CANNOT_SEE}</Text>
                      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                        <Ghost label="Open Their Record"
                          a11yLabel={`Open the record for ${d.name ?? 'this client'}`}
                          onPress={() => router.push(`/(trainer)/client?clientId=${encodeURIComponent(d.clientId)}` as any)} />
                      </View>
                    </View>
                  ))}
                </View>
              </Section>
            ) : null}

            {n.dueBack && n.dueBack.length ? <Rule /> : null}

            <Section>
              <SectionHead title="Worth a message"
                note={board.nudges.length ? `${board.nudges.length}` : 'none'} />
              {board.nudges.length === 0 ? (
                <Text style={{ ...ty.body, color: t.ink2 }}>
                  {board.assessed
                    ? 'Nobody on the assessed part of your book has broken their own pattern, and everybody you have already contacted is inside their own window. This is a real answer, not an empty one.'
                    : 'Nobody could be assessed, so there is nothing to say about who is quiet.'}
                </Text>
              ) : (
                <View>{board.nudges.map(nudgeCard)}</View>
              )}
            </Section>

            {/* ── the watch band, once a week ────────────────────────────
                `earnsNudge` refuses `watch` and that refusal stays: a client
                who is down and not far down describes a busy fortnight as often
                as it describes anything, and a suggestion per busy fortnight per
                client is exactly the nagging that makes a coach stop reading
                this screen.

                But `at_risk` is often already too late — sixty per cent off
                their own rate — and `watch` is where a word still costs
                nothing. So the band is surfaced as a DIGEST: one section, once a
                week, no draft, no Set Aside, and no per-client prompt. Closing
                it puts it away until the week turns over (`weekKey`); the
                rows are still reachable by opening the section, which is the
                coach asking rather than the app telling.

                `watchDigestDue` is null until the stored week is read back, and
                null renders nothing — a section that appears for one frame and
                vanishes is worse than one that arrives a frame late. */}
            {board.watching.length ? (
              <>
                <Rule />
                <Section>
                  <SectionHead
                    title="Slipping"
                    note={showWatch || n.watchDigestDue ? (showWatch ? 'hide' : `${board.watching.length}`) : `${board.watching.length}`}
                    onPress={() => setShowWatch((v) => !v)}
                  />
                  <Text style={{ ...ty.body, color: t.ink2 }}>{watchDigestNote(board.watching)}</Text>
                  {n.watchDigestDue || showWatch ? (
                    <View style={{ marginTop: sp.md }}>
                      {board.watching.map((w, i) => (
                        <View key={w.clientId}
                          style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.serious }} />
                            <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, flex: 1 }}>
                              {w.name ?? 'Unnamed client'}
                            </Text>
                          </View>
                          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{w.observed}</Text>
                          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                            <Ghost label="Open Their Record"
                              a11yLabel={`Open the record for ${w.name ?? 'this client'}`}
                              onPress={() => router.push(`/(trainer)/client?clientId=${encodeURIComponent(w.clientId)}` as any)} />
                          </View>
                        </View>
                      ))}
                      {n.watchDigestDue ? (
                        <View style={{ marginTop: sp.lg }}>
                          <Ghost label="Read for This Week" onPress={n.dismissWatchDigest} />
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                            This closes until next week. Nobody here is removed from your book and nothing changes for
                            them — it is this section that goes quiet, not them.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </Section>
              </>
            ) : null}

            {/* Set aside · quietened, never hidden. A coach who wants to see who
                they parked can; the app does not raise them unprompted, which
                is the difference between a record and a nag. */}
            {board.muted.length ? (
              <>
                <Rule />
                <Section>
                  <SectionHead
                    title="Set aside"
                    note={showMuted ? 'hide' : `${board.muted.length}`}
                    onPress={() => setShowMuted((v) => !v)}
                  />
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    Contacted or parked recently, so they are not being suggested. They come back on
                    their own.
                  </Text>
                  {showMuted ? (
                    <View style={{ marginTop: sp.md }}>
                      {board.muted.map((m, i) => (
                        <View key={m.clientId}
                          style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                          <Text style={{ ...ty.body, fontWeight: '600', color: t.ink }}>
                            {m.name ?? 'Unnamed client'}
                          </Text>
                          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>
                            {ACTION_LABEL[m.muted.record.action]} · back in{' '}
                            {m.muted.daysLeft} day{m.muted.daysLeft === 1 ? '' : 's'}
                          </Text>
                          {m.muted.record.observed ? (
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                              At the time: {m.muted.record.observed}
                            </Text>
                          ) : null}
                          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                            <Ghost label="Why Them?" onPress={() => setExplaining(m)} />
                            {/* Only a set-aside can be undone. The record that
                                somebody was MESSAGED is what stops them being
                                messaged twice, and part 140's delete policy
                                refuses it — so no button offers it. */}
                            {m.muted.record.action === 'dismissed' ? (
                              <Ghost label="Bring Back" onPress={() => bringBack(m)} />
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Section>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <Modal visible={!!drafting} animationType="slide" onRequestClose={() => setDrafting(null)}>
        {drafting ? (
          <DraftSheet
            nudge={drafting}
            onClose={() => setDrafting(null)}
            onSent={async (body, queued, queuedReason) => {
              const clientId = drafting.clientId;
              /* ── THE ORDER, and why it is not part 2300's ─────────────────
               *
               * supabase/parts/2300 writes `coach_invoice_ageing_notices`
               * BEFORE the notification it records, and argues it: a bookkeeping
               * row that fails takes the notification down with it, because both
               * are statements inside one plpgsql function and the whole
               * iteration rolls back. There is no transaction here. Two
               * independent round trips from a phone, and reversing them would
               * buy the one outcome part 140 refuses to let anybody undo — a
               * 'sent' row for a message the server then DECLINED (a coach who
               * has been blocked, a thread that no longer exists), permanently
               * muting a client who was never written to, with no delete policy
               * to take it back. So the record stays second, which is what this
               * file's header has always said.
               *
               * What changes is what counts as the thing being recorded. It was
               * "the row is on the server"; it is now "the words are somewhere
               * they will go from" — which the outbox has genuinely promised by
               * the time `queued` comes back, because `enqueue` answered
               * 'queued' and the intent is on disk. That is a real event and it
               * is the one the never-nag record exists to remember. A send that
               * merely FAILED still records nothing, because nothing happened.
               */
              const r = await n.recordSent(clientId, drafting.drift, drafting.observed);
              setDrafting(null);
              if (!queued) {
                if (!r.ok) Alert.alert('Sent, but not recorded', r.reason);
                return body;
              }
              /* Queued. The record write goes over the same connection that
               * just refused the message, so it usually fails too — and the
               * hook's own sentence for that opens "Your message was sent",
               * which is the one thing that is not true here. This screen owns
               * the wording for its own case.
               *
               * `queuedFor` is what actually holds the promise while the record
               * cannot: a client whose message is on this phone is not offered a
               * second draft, whatever the server does or does not know yet. It
               * is device-local and lasts this sitting, which is honest — and it
               * is said out loud on the card rather than the row simply
               * vanishing. */
              setQueuedFor((prev) => (prev.includes(clientId) ? prev : [...prev, clientId]));
              const waiting = queuedReason
                ?? 'That message is saved on this phone and has not been sent yet. It goes as soon as you are back online.';
              Alert.alert('Waiting to send', r.ok
                ? waiting
                : `${waiting} It could not be written to your record of who you have contacted, so they may be suggested again on another device — not on this one.`);
              return body;
            }}
          />
        ) : null}
      </Modal>

      <Modal visible={!!explaining} animationType="slide" onRequestClose={() => setExplaining(null)}>
        {explaining ? (
          <WhySheet
            name={explaining.name}
            drift={explaining.drift}
            evidence={n.evidenceFor(explaining.clientId)}
            onClose={() => setExplaining(null)}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

/* ── the draft ─────────────────────────────────────────────────────────────── */

/**
 * The message, in a box, before anybody has sent anything.
 *
 * `useThread` is called here rather than in the screen because it is keyed on
 * one client and opens a realtime channel for that thread; hoisting it would
 * mean the screen held a subscription to whichever client happened to be
 * selected last, for as long as it was open.
 *
 * The send path is deliberately the ordinary one. `send` reports ok only once
 * the ROW is on the server, so a refused insert cannot leave this sheet
 * believing a client was contacted — and `client_nudges` is only written after
 * that, so the never-nag record can never mute somebody who was never reached.
 *
 * `queued` is the third answer and is neither of those. It is not `ok` — the
 * client cannot read the message yet — but it is not a failure either: the
 * words are on this device, counted, and they go on their own. `doSend` below
 * keeps all three apart, because the coach's next action differs in each and
 * the wrong heading on the middle one is what makes them send it twice.
 */
function DraftSheet({ nudge, onClose, onSent }: {
  nudge: Nudge;
  onClose: () => void;
  /**
   * The send is over, and it either reached the server or is waiting on this
   * phone. `queued` is the flag and never inferred from the sentence beside it:
   * `SendResult.reason` is documented as null-able, and reading a null reason as
   * "delivered" would put the two states back together the wrong way round.
   * `reason` is the sentence `useThread` wrote about the wait, passed up rather
   * than alerted here so the coach reads one alert about their message, not two.
   */
  onSent: (body: string, queued: boolean, reason: string | null) => Promise<string>;
}) {
  const t = useTheme();
  const scrollPad = useScrollPad(180);
  const { send } = useThread(nudge.clientId, 'coach');
  const [body, setBody] = useState(nudge.draft);
  const [sending, setSending] = useState(false);

  // What the draft would be claiming if somebody edited a cause into it. This
  // is advisory and never blocks the send — it is the coach's message and their
  // judgement, and a coach who knows the client is injured may well say so. It
  // exists because the one thing the APP must not do is put that sentence there
  // unasked, and a coach who typed it deserves to be told the app did not.
  const claims = refusalsIn(body);

  /**
   * Send it, and tell the truth about which of the THREE things happened.
   *
   * `SendResult` has three outcomes and this read two. A message the phone kept
   * because there was no signal comes back `ok: false, queued: true` with a body
   * saying it is saved and goes when back online — and this headed that body
   * "Not sent", which is a heading that tells the coach to type it again. They
   * do, and the client gets the same "haven't seen you in a while" twice, days
   * later, when the outbox flushes both. app/(trainer)/chat.tsx has said
   * "Waiting to send" over this exact case since the outbox landed; the wording
   * is taken from there rather than invented, because it is one app and the
   * coach meets both screens.
   *
   * And `onSent` was skipped on the queued path, so `client_nudges` recorded
   * nothing — which is the same defect from the other end. This screen's own
   * heading promises "Nobody is suggested twice", and an unrecorded send breaks
   * that promise on every offline draft: the client is still on the board the
   * next time it is opened, with the same draft, ready to go a second time.
   */
  const doSend = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    const r = await send(text);
    setSending(false);
    // Nothing was kept and nothing was sent. The words are still in the box —
    // this is the one outcome where the sheet stays open, because it is the one
    // where trying again is the right thing to do.
    if (!r.ok && !r.queued) {
      Alert.alert('Not sent', r.reason ?? 'That message did not reach the server, so it has not been sent.');
      return;
    }
    await onSent(text, !r.ok, r.ok ? null : (r.reason ?? null));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      {/* The keyboard sat on the field being typed into. `automaticallyAdjustKeyboardInsets`
          is what works here — see the ScrollView in app/(trainer)/log-session.tsx for why a
          KeyboardAvoidingView with behavior="padding" does nothing when the ScrollView
          already fills the container it pads.
          220 rather than 40 because the message body is what this screen is for, and Send is
          directly under it. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: scrollPad }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} onPress={onClose} a11yLabel="Close without sending" />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Draft — nothing sent yet</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>{nudge.name ?? 'Client'}</Text>
          </View>
        </View>

        <Section>
          <Text style={{ ...ty.label, color: t.ink2 }}>{nudge.observed}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{WHAT_IT_CANNOT_SEE}</Text>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Your message" note="edit before sending" />
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            accessibilityLabel="Message to your client"
            placeholder="Write something"
            placeholderTextColor={t.ink3}
            style={{
              ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm,
              padding: sp.md, minHeight: 140, textAlignVertical: 'top',
            }}
          />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            This goes to {nudge.name ?? 'them'} from you, in your ordinary chat thread. It is not
            sent until you press Send.
          </Text>

          {claims.length ? (
            <View style={{ marginTop: sp.md }}>
              <Flag tone={t.warn}>
                {'As written this says something the app cannot know: ' + claims.join('; ')
                  + '. Yours to send if you know it — the app would not have written it.'}
              </Flag>
            </View>
          ) : null}
        </Section>

        <Section>
          <Cta label={sending ? 'Sending…' : 'Send'} onPress={() => { void doSend(); }}
            wide disabled={sending || !body.trim()} />
          <View style={{ marginTop: sp.md }}>
            <Ghost label="Close Without Sending" onPress={onClose} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            Once sent, {nudge.name ?? 'they'} will not be suggested again for{' '}
            {nudge.mutedDaysIfSent} days — paced from how often they used to train, not from a
            fixed number.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── the working ───────────────────────────────────────────────────────────── */

/**
 * Why this client is on the list — the dates, not the percentage.
 *
 * A coach asked to act on a figure has to be able to check it, and the case
 * where the arithmetic is wrong is exactly the case where acting on it is
 * worst. Everything drawn here comes from `explainDrift`, which reads the same
 * events and the same local day boundary the verdict was computed from.
 */
function WhySheet({ name, drift, evidence, onClose }: {
  name: string | null;
  drift: Drift | null;
  evidence: Evidence | null;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={onClose} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Why they are here</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>{name ?? 'Client'}</Text>
          </View>
        </View>

        {drift ? (
          <Section>
            <Card>
              <Text style={{ ...ty.head, color: t.ink }}>{DRIFT_LABEL[drift.status]}</Text>
              <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{bandNote(drift.status)}</Text>
              <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>{drift.reason}</Text>
            </Card>
          </Section>
        ) : null}

        <Section>
          <SectionHead title="The record" note="what was actually read" />
          {evidence ? (
            <View>
              {evidence.lines.map((l, i) => (
                <Flag key={i} tone={i === evidence.lines.length - 1 ? t.warn : t.brand}
                  style={{ marginTop: i ? sp.md : 0 }}>
                  {l}
                </Flag>
              ))}
            </View>
          ) : (
            <Text style={{ ...ty.body, color: t.ink2 }}>
              The working is not available for this client, which means their record was not read on
              this screen. That is not the same as an empty record.
            </Text>
          )}
        </Section>

        {evidence && evidence.baselineDays.length ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Every day on record" note="in the window read" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}>
                {[...evidence.baselineDays, ...evidence.recentDays].map((d) => (
                  <View key={d.day}
                    style={{ paddingHorizontal: sp.md, paddingVertical: sp.xs, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
                    <Text style={{ ...ty.caption, color: t.ink2 }}>{d.day}</Text>
                  </View>
                ))}
              </View>
            </Section>
          </>
        ) : null}

        <Section>
          <Ghost label="Close" onPress={onClose} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
