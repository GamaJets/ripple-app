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
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Cta, Notice, Flag, Card } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { USE_SUPABASE } from '../../src/lib/config';
import { useNudges } from '../../src/ui/nudges';
import { useThread } from '../../src/ui/messaging';
import { DRIFT_LABEL, bandNote, type Drift } from '../../src/lib/clientDrift';
import {
  WHAT_IT_CANNOT_SEE, ACTION_LABEL, refusalsIn,
  type Evidence, type Nudge, type MutedRow,
} from '../../src/lib/nudge';

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

  // Two sheets, two independent flags. A sibling pair whose `visible`
  // expressions share an identifier is the bug check-runtime-traps.mjs exists
  // for: iOS will not stack two modals from the same parent, so the second is
  // silently dead.
  const [drafting, setDrafting] = useState<Nudge | null>(null);
  const [explaining, setExplaining] = useState<Nudge | MutedRow | null>(null);
  const [showMuted, setShowMuted] = useState(false);

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

      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg, flexWrap: 'wrap' }}>
        <Cta label="Write a Message" onPress={() => setDrafting(item)} />
        <Ghost label="Why Them?" onPress={() => setExplaining(item)} />
        <Ghost label="Set Aside" onPress={() => setAside(item)} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
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

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Who has gone quiet is worked out from training records that live on the server, and there is no local copy of somebody else's. Nothing below is a claim that everybody is fine." />
          </Section>
        ) : n.status === 'loading' ? (
          <Section>
            <ActivityIndicator color={t.brand} />
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

            <Rule />

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
            onSent={async (body) => {
              const r = await n.recordSent(drafting.clientId, drafting.drift, drafting.observed);
              setDrafting(null);
              if (!r.ok) Alert.alert('Sent, but not recorded', r.reason);
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
 */
function DraftSheet({ nudge, onClose, onSent }: {
  nudge: Nudge;
  onClose: () => void;
  onSent: (body: string) => Promise<string>;
}) {
  const t = useTheme();
  const { send } = useThread(nudge.clientId, 'coach');
  const [body, setBody] = useState(nudge.draft);
  const [sending, setSending] = useState(false);

  // What the draft would be claiming if somebody edited a cause into it. This
  // is advisory and never blocks the send — it is the coach's message and their
  // judgement, and a coach who knows the client is injured may well say so. It
  // exists because the one thing the APP must not do is put that sentence there
  // unasked, and a coach who typed it deserves to be told the app did not.
  const claims = refusalsIn(body);

  const doSend = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    const r = await send(text);
    setSending(false);
    if (!r.ok) {
      Alert.alert('Not sent', r.reason ?? 'That message did not reach the server, so it has not been sent.');
      return;
    }
    await onSent(text);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={onClose} a11yLabel="Close without sending" />
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
          <Ghost icon="back" onPress={onClose} />
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
