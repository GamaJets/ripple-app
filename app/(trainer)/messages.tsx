// Coach · Messages — the list of threads, which did not exist.
//
// ── The gap ────────────────────────────────────────────────────────────────
//
// `app/(trainer)/chat.tsx` is one conversation and requires a `clientId`. The
// only ways a coach could reach one were a client's own detail screen, a tap on
// a leaderboard row, and a push notification carrying the key — three routes
// that all START from a client already chosen. So a coach with twenty clients
// had no way to see who had written to them. The client app gets away with a
// single-thread `/(client)/messages` because a client has exactly one coach;
// src/ui/notifications.tsx has said so in a comment for a while: "for a coach it
// is not: their threads are per-client".
//
// This is the list. `useCoachThreads` is the read; src/lib/coachThreads.ts is
// every decision that can be asserted without a renderer.
//
// ── This is NOT the notification inbox, and the two must not be confused ───
//
// `/(trainer)/notifications` is the bell: bookings, cancellations, anything
// pushed at this coach. This screen is people talking. They overlap — part 26's
// trigger writes a notification row for every message — but they answer
// different questions, and a coach who taps the bell looking for a client's
// message finds it filed between two booking confirmations with no way to
// reply. The hub row below the bell says which is which in its note, and the
// two rows are deliberately in different sections.
//
// ── Clients with no messages yet ───────────────────────────────────────────
//
// They are in the read (`coach_threads()` left-joins the last message, so a
// client with none comes back with a null timestamp) and they are NOT in the
// list. A coach with twenty clients and two conversations must not open
// eighteen blank rows — but a screen that shows only existing threads makes the
// first message in a relationship the one thing the messaging screen cannot do,
// which is the shape of gap this screen exists to close.
//
// So they sit under "Message Someone Else", one tap away, and the section is
// only drawn when there is somebody in it. Same read, no second round trip, and
// the list stays about conversations.
//
// ── The three empty lists ──────────────────────────────────────────────────
//
// An empty list here can mean four different things and only one of them is
// "nobody has written to you". `threadsEmptyNote` is where they are kept apart,
// and the one that matters is 'error': a coach told they have no messages, when
// the read was refused, does not go looking — and the client who wrote that
// morning is waiting on a reply.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Notice, Ghost, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useCoachThreads } from '../../src/ui/coachThreads';
import { peerMonogram } from '../../src/lib/peerAvatar';
import { peerHeading } from '../../src/lib/threadPeer';
import {
  threadPreview, threadWhen, threadsEmptyNote, unreadBadgeLabel, type CoachThread,
} from '../../src/lib/coachThreads';

/**
 * One row: a face, a name, the last thing said and when, and whether anything
 * in it is unopened.
 *
 * The name goes through `peerHeading` — the same resolver the two chat headers
 * use — so a client whose name did not come back renders as the labelled dash
 * this app already draws everywhere else, rather than as the word "Client". A
 * category noun where a name belongs is the defect TF-32 is about, and the coach
 * chat screen carried it until recently.
 */
function ThreadRow({ t, now, onPress }: { t: CoachThread; now: number; onPress: () => void }) {
  const th = useTheme();
  // `unlinked` is unreachable here — the row exists because the roster returned
  // this client — so the only two outcomes are a name and 'withheld'.
  const head = peerHeading(t.name ? { kind: 'named', name: t.name } : { kind: 'withheld' }, 'client');
  const preview = threadPreview(t);
  const when = threadWhen(t.lastAt, now);
  const badge = unreadBadgeLabel(t.unread);
  // A dash badge means the count could not be read, and it must not wear the
  // same solid brand pill as a real number — that would state a figure. It gets
  // the quiet surface instead, and the label under it says so out loud.
  const counted = badge !== null && badge !== '—';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open the conversation with ${head.isName ? head.text : 'this client'}`}
      accessibilityHint={badge === '—'
        ? 'We could not read how many of their messages are unopened.'
        : counted ? `${badge} unopened` : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}
    >
      {/* The face, under the rule src/lib/peerAvatar.ts states: only ever what
          came back from the read for THIS client's id, and a monogram when there
          is none. There is no branch here that can reach the coach's own. */}
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: th.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {t.avatar
          ? <Image source={{ uri: t.avatar }} style={{ width: 44, height: 44 }} accessibilityIgnoresInvertColors />
          : <Text style={{ ...ty.label, fontWeight: '600', color: head.isName ? th.brand : th.ink3 }}>{peerMonogram(head)}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
          {/* Casing and full ink for a real name only; a dash gets neither, so
              a placeholder never reads as somebody called "—". */}
          <Text numberOfLines={1}
            style={{ ...ty.body, fontWeight: '600', flex: 1, color: head.isName ? th.ink : th.ink3, textTransform: head.isName ? 'capitalize' : 'none' }}>
            {head.text}
          </Text>
          {when ? <Text style={{ ...ty.caption, color: th.ink3 }}>{when}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 2 }}>
          {/* The coach's own last word recedes; a client's does not. This is not
              a read receipt — nothing in this app measures whether the client
              opened it — only who wrote it. */}
          <Text numberOfLines={1} style={{ ...ty.caption, flex: 1, color: preview.mine ? th.ink3 : th.ink2 }}>
            {preview.text}
          </Text>
          {badge !== null ? (
            <View style={{
              minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill,
              backgroundColor: counted ? th.brand : th.surface3,
              borderWidth: counted ? 0 : hairline, borderColor: th.ring, alignItems: 'center',
            }}>
              <Text style={{ ...ty.micro, fontWeight: '700', color: counted ? th.brandInk : th.ink3 }}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {/* Spelled out under the row rather than left as a dash somebody has to
            interpret. A coach who reads the dash as "none" is exactly as
            misinformed as one shown a zero. */}
        {badge === '—' ? (
          <Text style={{ ...ty.micro, color: th.ink3, marginTop: 2 }}>
            We could not read how many of their messages are unopened.
          </Text>
        ) : null}
      </View>
      <Icon name="chevron" size={16} color={th.ink3} />
    </Pressable>
  );
}

export default function Messages() {
  const t = useTheme();
  const router = useRouter();
  const { conversations, unstarted, status, roster, refresh } = useCoachThreads();
  const [showAll, setShowAll] = useState(false);

  // Opening a thread is what marks it read (`mark_thread_read`, called by
  // useThread), and the coach comes straight back here. Without this the badge
  // they just cleared is still on the row and the screen is asserting something
  // the server stopped agreeing with a second ago.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // One clock for the whole render, so two rows a millisecond apart cannot
  // disagree about what "now" is.
  const now = Date.now();
  const open = (c: CoachThread) => {
    // Exactly the call the existing sites make — app/(trainer)/leaderboard.tsx
    // and client.tsx — so a thread opened from here is the same screen with the
    // same params. The name rides along because the chat header prefers a name
    // it was handed over a second read it would otherwise have to make; when
    // there is none it is left off rather than sent as an empty string, which
    // the header would take for a name and render as a blank heading.
    router.push(c.name
      ? { pathname: '/(trainer)/chat', params: { clientId: c.clientId, name: c.name } }
      : { pathname: '/(trainer)/chat', params: { clientId: c.clientId } });
  };
  const emptyNote = conversations.length === 0 ? threadsEmptyNote(status, roster) : null;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
          <Icon name="back" size={20} color={t.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your clients</Text>
          <Text style={{ ...ty.head, color: t.ink, marginTop: 2 }}>Messages</Text>
        </View>
      </View>
      <Rule />

      <ScrollView contentContainerStyle={{ paddingBottom: sp.xxl }}>
        {status === 'loading' ? (
          <View style={{ paddingTop: sp.xxl, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={t.ink3} />
          </View>
        ) : null}

        {/* A read that did not come back. Drawn ABOVE the lists, because
            whatever is below it is the last thing we had and not the answer. */}
        {status === 'error' ? (
          <View style={{ paddingHorizontal: G, paddingTop: sp.lg }}>
            <Notice
              tone={t.crit}
              kicker="Not loaded"
              title="We could not read your conversations"
              note="This screen cannot say whether anybody has written to you. Nothing here has been lost — the messages are on the server."
            >
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={() => { refresh(); }} /></View>
            </Notice>
          </View>
        ) : null}

        {/* More clients than one read returns. The threads listed are real; the
            list is not all of them, so "nobody else is waiting" is not something
            this screen may imply. */}
        {status === 'partial' ? (
          <View style={{ paddingHorizontal: G, paddingTop: sp.lg }}>
            <PartialRead what="clients on your book" shown={conversations.length + unstarted.length} onPress={() => { refresh(); }} />
          </View>
        ) : null}

        {conversations.length ? (
          <Section>
            <SectionHead title="Conversations" note="Most recent first" />
            {conversations.map((c, i) => (
              <View key={c.clientId}>
                {i > 0 ? <Rule inset={56} /> : null}
                <ThreadRow t={c} now={now} onPress={() => open(c)} />
              </View>
            ))}
          </Section>
        ) : null}

        {/* The four empty lists, kept apart. Never "no messages" over a failure. */}
        {emptyNote ? (
          <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xxl, paddingHorizontal: G }}>
            {emptyNote}
          </Text>
        ) : null}

        {/* ── starting one ──────────────────────────────────────────────────
            Behind a button rather than in the list above, and only offered when
            there is somebody behind it. A coach with two conversations and
            eighteen quiet clients should open this screen to two rows.

            Expanded by default when there are no conversations at all: the whole
            content of the screen at that point is "pick somebody", and making
            them tap twice for it would be a hub with one row in it. */}
        {unstarted.length ? (
          <>
            <Rule />
            <Section>
              <SectionHead
                title="Message Someone Else"
                note={unstarted.length === 1
                  ? 'One client you have not written to yet'
                  : `${unstarted.length} clients you have not written to yet`}
              />
              {showAll || conversations.length === 0 ? (
                unstarted.map((c, i) => (
                  <View key={c.clientId}>
                    {i > 0 ? <Rule inset={56} /> : null}
                    <ThreadRow t={c} now={now} onPress={() => open(c)} />
                  </View>
                ))
              ) : (
                <Ghost label="Show Clients" icon="people" onPress={() => setShowAll(true)}
                  a11yLabel="Show the clients you have not written to yet" />
              )}
            </Section>
          </>
        ) : null}

        {/* Said once, at the foot, rather than on every row. The bell and this
            screen are two different lists and a coach who conflates them looks
            for a client's message in the wrong one. */}
        {status !== 'loading' ? (
          <>
            <Rule />
            <Section>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                This is people talking. Bookings, cancellations and anything else sent to you are in Notifications.
              </Text>
              <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                <Ghost label="Notifications" icon="bell" onPress={() => router.push('/(trainer)/notifications')} />
              </View>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
