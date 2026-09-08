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
// ── Finding one of them, and finding the ones waiting on you ───────────────
//
// This screen listed `conversations` newest-first under one head reading "Most
// recent first" and offered nothing else: no query field, no unread filter, no
// archive. The header above says it exists because "a coach with twenty clients
// had no way to see who had written to them" — and at forty, recency-only
// ordering recreates precisely that, on the queue that predicts churn better
// than anything else in the product. The roster next door already draws
// "3 unread" on its rows, so the app computed the answer and would not let the
// coach filter to it.
//
// Both controls are in src/lib/threadFilter.ts, which is also where the one
// thing that is hard about the unread chip lives: `unread` is nullable, and a
// filter that dropped the rows whose count did not come back would hide exactly
// the client who might be waiting, behind a shorter list that looks complete.
//
// ── The queue above them, and why the Unread chip is not it ───────────────
//
// src/lib/features.ts describes this screen, in the app's own search catalogue,
// as "Every client conversation, and who is waiting on a reply". The second
// half was not built. `CoachThread.lastSender` came back on every load and was
// spent on the `You: ` prefix and an ink colour, and the chip that looked like
// it answered the question is the one thing that structurally cannot: `unread`
// counts what the coach has not OPENED, and src/ui/readReceipts.ts clears it
// the moment the bottom of the thread is on screen. So the worst case in the
// whole inbox — read on a train on Monday, meant to answer that evening, did
// not — has an unread count of zero and sits wherever Monday lands by Thursday.
//
// "Waiting on a Reply" is that queue, and every decision in it is in
// src/lib/awaitingReply.ts: the whole-day threshold that keeps a message sent
// ninety minutes ago off it, the three sentences for whether the coach has even
// opened it, and the rule that no row may accuse — the list can tell who wrote
// last, not who is owed an answer, and the sentence under it says so.
import { useCallback, useMemo, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { View, Text, ScrollView, Pressable, Image, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
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
import {
  NO_THREAD_FILTER, filterThreads, knownUnread, threadFilterActive, threadFilterLine,
  unknownUnread, unreadChipLabel, withheldNames, type ThreadFilter,
} from '../../src/lib/threadFilter';
import {
  WAITING_TITLE, hasWaiting, waitedLabel, waitingCountNote, waitingLine, waitingNote, waitingOn,
  type Waiting,
} from '../../src/lib/awaitingReply';
import { isWhole } from '../../src/ui/loadStatus';
import { hitSlopFor } from '../../src/lib/a11y';
import { BACK_ICON, FORWARD_ICON } from '../../src/ui/direction';

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
      <Icon name={FORWARD_ICON} size={16} color={th.ink3} />
    </Pressable>
  );
}

/**
 * One row of the queue at the top: who is waiting, and how long they have been.
 *
 * Deliberately NOT `ThreadRow`. That row is built for scanning a list — a
 * preview of the last message and an unread badge — and both are the wrong
 * facts here. The preview is the client's own words, which the coach is about
 * to read anyway by tapping; the badge is zero for the case this section
 * exists for, because opening a thread is what clears it. What this row carries
 * instead is the wait, which is the only thing that puts these rows in this
 * order.
 *
 * The same client appears again in Conversations below. That is on purpose:
 * this is a short queue worked from the top, that is the whole book scanned by
 * recency, and both taps land on the same conversation.
 */
function WaitingRow({ w, onPress }: { w: Waiting; onPress: () => void }) {
  const th = useTheme();
  const head = peerHeading(w.thread.name ? { kind: 'named', name: w.thread.name } : { kind: 'withheld' }, 'client');
  const line = waitingLine(w);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open the conversation with ${head.isName ? head.text : 'this client'}. ${line}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: th.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {w.thread.avatar
          ? <Image source={{ uri: w.thread.avatar }} style={{ width: 36, height: 36 }} accessibilityIgnoresInvertColors />
          : <Text style={{ ...ty.caption, fontWeight: '600', color: head.isName ? th.brand : th.ink3 }}>{peerMonogram(head)}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
          <Text numberOfLines={1}
            style={{ ...ty.body, fontWeight: '600', flex: 1, color: head.isName ? th.ink : th.ink3, textTransform: head.isName ? 'capitalize' : 'none' }}>
            {head.text}
          </Text>
          {/* The wait, as words rather than as a coloured dot. A queue ordered
              by something the reader cannot see is one they have to take on
              trust. */}
          <Text style={{ ...ty.caption, color: th.ink2 }}>{waitedLabel(w.waitedMs)}</Text>
        </View>
        <Text style={{ ...ty.caption, color: th.ink3, marginTop: 2 }}>{line}</Text>
      </View>
      <Icon name={FORWARD_ICON} size={16} color={th.ink3} />
    </Pressable>
  );
}

export default function Messages() {
  const t = useTheme();
  const router = useRouter();
  const { conversations, unstarted, status, roster, refresh } = useCoachThreads();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<ThreadFilter>(NO_THREAD_FILTER);
  const narrowed = threadFilterActive(filter);

  // READING a thread is what marks it read, and the coach comes straight back
  // here. Without this the badge they just cleared is still on the row and the
  // screen is asserting something the server stopped agreeing with a second
  // ago.
  //
  // "Reading" is no longer "opening": the write is `mark_thread_read_at`,
  // called by `useReadReceipt` (src/ui/readReceipts.ts) from the chat screen
  // only while the end of the thread is on screen, focused and in the
  // foreground — because the same watermark is now shown to the OTHER person as
  // a read receipt, and a thread opened and left at the top had not been read.
  // So a coach who opens a thread, does not scroll to the bottom of it and
  // comes back finds the badge still up, which is now the truth rather than a
  // stale count.
  // `useRefreshOnFocus`, not `useFocusEffect(useCallback(…, [refresh]))`. Same
  // shape and same failure as app/(trainer)/calendar.tsx — a provider that
  // publishes its context value as an object literal hands back a new
  // `refresh` on every render, the dependency changes, the effect re-runs, and
  // the screen reads in a loop for as long as it is focused. The hook holds
  // the function in a ref so identity cannot re-arm it. See its header in
  // src/ui/refreshOnFocus.ts, and the note on the same line in calendar.tsx
  // for the measurement.
  useRefreshOnFocus(refresh);
  // The same read focus runs. Threads are written by the OTHER side — a
  // client replying is the only thing that changes this list — so a coach
  // sitting on this screen waiting for an answer had no way to ask for it.
  const pull = usePullToRefresh(useCallback(() => { refresh(); }, [refresh]));

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
  /**
   * What is drawn, and what the chip is drawn FROM.
   *
   * The chip's own count comes from the whole list rather than from the
   * filtered one, so pressing it does not change the number on it. And it is
   * withheld entirely while any count is unknown — see `unreadChipLabel`.
   */
  const shown = useMemo(() => filterThreads(conversations, filter), [conversations, filter]);
  const unreadKnown = useMemo(() => knownUnread(conversations), [conversations]);
  const unreadUnknown = useMemo(() => unknownUnread(conversations), [conversations]);
  /**
   * Whether a NUMBER may go on the chip at all.
   *
   * `unreadChipLabel` withholds the figure when a row's own unread count did
   * not come back, and that is the only doubt it can see — it is handed two
   * numbers and no `LoadStatus`. Under 'partial' every row that loaded has a
   * real count, so `unreadUnknown` is 0 and the chip reads "Unread · 7" over a
   * PREFIX of the coach's book: they answer seven and read the inbox as clear,
   * on a screen whose own `waitingCountNote` already opens with
   * `if (!isWhole(status)) return null` for exactly this reason.
   *
   * So the status is folded in here, at the call site, which is the only place
   * that knows both halves. `isWhole` and nothing looser: 'loading' would print
   * "Unread" over a list that has not arrived, and 'error' a count over rows
   * that are the last thing we had rather than the answer. The chip still works
   * — it is the FIGURE that is withheld, not the filter — and the doubt is
   * carried in words by the `PartialRead` notice above and by `filterLine`.
   */
  const unreadCountKnowable = isWhole(status) && unreadUnknown === 0;
  /**
   * People the coach has never written to are matched on their NAME and are not
   * offered under the unread chip at all — an unstarted thread has no messages
   * in it, so it can hold nothing unopened, and listing one there would be a
   * row that answers the filter it is under by accident.
   */
  const shownUnstarted = useMemo(
    () => (filter.mode === 'unread' ? [] : filterThreads(unstarted, { mode: 'all', query: filter.query })),
    [unstarted, filter],
  );
  /**
   * What the narrowing did, in one sentence, or null.
   *
   * `searched` is the number of threads the filter actually ran over — what
   * LOADED, which under 'partial' is not the coach's book. `withheld` is the
   * rows a name query could never have matched because the name did not come
   * back; without it they are simply absent, which reads as "not on your book".
   */
  // The pool the filter actually ran over. Under the unread chip that is the
  // conversations alone, because clients who have never written are not
  // candidates for it — so counting their withheld names here would tell the
  // coach rows were skipped that were never in the running.
  const pool = filter.mode === 'unread' ? conversations : [...conversations, ...unstarted];
  const filterLine = threadFilterLine({
    status, filter,
    matched: shown.length + shownUnstarted.length,
    searched: pool.length,
    unknown: unknownUnread(shown),
    withheld: withheldNames(pool),
  });
  /**
   * "Nobody has written to you" is a claim about the coach's book and must
   * never be printed over a list somebody has narrowed. Under an active filter
   * the empty list is `filterLine`'s to explain, and it is careful about which
   * statuses may state an absence at all.
   */
  const emptyNote = conversations.length === 0 && !narrowed ? threadsEmptyNote(status, roster) : null;
  /**
   * Who spoke last, and how long ago — src/lib/awaitingReply.ts.
   *
   * Built from `conversations`, which is the same read the list below is drawn
   * from: no second round trip, and no chance of the two disagreeing about who
   * is on the coach's book. It is deliberately NOT built from `shown`: a
   * narrowed list is the coach asking a different question, and a queue drawn
   * over their search results would be answering it with somebody else's.
   *
   * Not memoised, and not by oversight: `now` is read fresh on every render
   * just above, so a dependency array containing it would never hit and would
   * only read as though this were cached. It is one pass over the threads
   * already in memory.
   */
  const waiting = waitingOn(conversations, now, status);
  const waitNote = waitingNote(waiting);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
          <Icon name={BACK_ICON} size={20} color={t.ink2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your clients</Text>
          <Text style={{ ...ty.head, color: t.ink, marginTop: 2 }}>Messages</Text>
        </View>
      </View>
      <Rule />

      {/* The name search sits at the top of this list and the keyboard has never been on
          top of it. `automaticallyAdjustKeyboardInsets` is here for what is UNDER it: with
          the keyboard up, the last threads in the list stopped behind it and could not be
          scrolled into view. The padding is deliberately left alone — this field is nowhere
          near the end of the screen, and a keyboard's height of dead space under a list of
          conversations would be scrolling into nothing. */}
      <ScrollView contentContainerStyle={{ paddingBottom: sp.xxl }}
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive" refreshControl={pull}>
        {status === 'loading' ? (
          <View style={{ paddingTop: sp.xxl, alignItems: 'center' }}>
            {/* Named. Unnamed it is not in the accessibility tree, so the screen
                reads as a coach with no conversations rather than one still
                being read — and the error branch below never draws. */}
            <ActivityIndicator size="small" color={t.ink3} accessible accessibilityRole="progressbar" accessibilityLabel="Reading your conversations…" />
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

        {/* ── narrowing ─────────────────────────────────────────────────────
            Offered whenever there is a list to narrow, including under a failed
            read — a coach who typed a name and got nothing is owed the sentence
            saying nothing was searched, and hiding the field would leave them
            with no way to ask the question at all.

            The chip is drawn from the WHOLE list, so pressing it never changes
            the number written on it. */}
        {status !== 'loading' ? (
          <View style={{ paddingHorizontal: G, paddingTop: sp.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
              <Icon name="search" size={16} color={t.ink3} />
              <TextInput
                value={filter.query}
                onChangeText={(q) => setFilter((f) => ({ ...f, query: q }))}
                placeholder="Find a client by name" placeholderTextColor={t.ink3}
                autoCapitalize="none" autoCorrect={false}
                accessibilityLabel="Find a client by name"
                style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }}
              />
              {filter.query ? (
                <Pressable onPress={() => setFilter((f) => ({ ...f, query: '' }))} hitSlop={hitSlopFor(24)}
                  accessibilityRole="button" accessibilityLabel="Clear the name search">
                  <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
              {/* One chip, not a segmented control: "All" is the absence of a
                  filter and does not need a control of its own — pressing this
                  a second time is what turns it off, and the label says which
                  state it is in through `accessibilityState`. */}
              <Pressable
                onPress={() => setFilter((f) => ({ ...f, mode: f.mode === 'unread' ? 'all' : 'unread' }))}
                accessibilityRole="button"
                accessibilityState={{ selected: filter.mode === 'unread' }}
                accessibilityLabel={!unreadCountKnowable
                  ? 'Show only clients with an unopened message. This is not your whole book yet, so the number is not shown.'
                  : unreadKnown > 0
                    ? `Show only clients with an unopened message. ${unreadKnown} of them.`
                    : 'Show only clients with an unopened message'}
                hitSlop={hitSlopFor(32)}
                style={{
                  paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill,
                  backgroundColor: filter.mode === 'unread' ? t.brand : t.surface2,
                  borderWidth: filter.mode === 'unread' ? 0 : hairline, borderColor: t.ring,
                }}>
                <Text style={{ ...ty.micro, fontWeight: '600', color: filter.mode === 'unread' ? t.brandInk : t.ink2 }}>
                  {unreadChipLabel(unreadKnown, !unreadCountKnowable)}
                </Text>
              </Pressable>
              {narrowed ? (
                <Ghost label="Clear" onPress={() => setFilter(NO_THREAD_FILTER)}
                  a11yLabel="Clear the filter and show every conversation" />
              ) : null}
            </View>
            {/* What was actually narrowed, and over what. This is the only
                thing on the screen allowed to state an absence, and only under
                a whole read — see src/lib/threadFilter.ts. */}
            {filterLine ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{filterLine}</Text>
            ) : null}
          </View>
        ) : null}

        {/* ── waiting on a reply ────────────────────────────────────────────
            The queue this screen's own catalogue entry promises — see
            src/lib/features.ts, "Every client conversation, and who is waiting
            on a reply" — and did not draw. `lastSender` was already read on
            every load and spent on a prefix and an ink colour.

            Not drawn under an active filter: the coach has asked a narrower
            question and a queue over their search results would be answering it
            with somebody else's. Not drawn when nothing is waiting either — the
            absence is the message, and a section congratulating a coach every
            morning is one they scroll past on the day it matters. */}
        {!narrowed && hasWaiting(waiting) ? (
          <Section>
            <SectionHead title={WAITING_TITLE} note={waitingCountNote(waiting, status) ?? undefined} />
            {waiting.rows.map((w, i) => (
              <View key={w.thread.clientId}>
                {i > 0 ? <Rule inset={48} /> : null}
                <WaitingRow w={w} onPress={() => open(w.thread)} />
              </View>
            ))}
            {/* Said once, under the list. It carries the doubt about the read
                first and then the rows that could not say who spoke last — and
                where there is neither, it says what this list is and is not,
                because a coach who reads it as a list of their own failures
                stops opening it the first time a "thanks" lands on it. */}
            {waitNote ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{waitNote}</Text>
            ) : null}
          </Section>
        ) : null}

        {shown.length ? (
          <Section>
            <SectionHead
              title="Conversations"
              note={narrowed
                ? `${shown.length} of ${conversations.length}`
                : 'Most recent first'}
            />
            {shown.map((c, i) => (
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
        {shownUnstarted.length ? (
          <>
            <Rule />
            <Section>
              <SectionHead
                title="Message Someone Else"
                note={shownUnstarted.length === 1
                  ? 'One client you have not written to yet'
                  : `${shownUnstarted.length} clients you have not written to yet`}
              />
              {/* A coach who has typed a name is looking for that person, so the
                  matches are drawn rather than hidden behind the button — the
                  button exists to keep eighteen quiet clients out of a list of
                  two conversations, and a search result is neither. */}
              {showAll || shown.length === 0 || !!filter.query.trim() ? (
                shownUnstarted.map((c, i) => (
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
