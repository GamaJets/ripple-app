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
import { Rule, Section, SectionHead, Notice, Ghost, PartialRead, Flag, PageHead, ListRow } from '../../src/ui/kit';
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
// What this handset is still holding, which the read above cannot see. The
// decisions are in src/lib/threadOutbox.ts; `asQueuedMessage` stays the only
// place that narrows a stored payload back into a message.
import { useOutbox } from '../../src/ui/outbox';
import { asQueuedMessage } from '../../src/ui/messaging';
import {
  outboxThreadsNote, queuedByThread, queuedThreadNote,
  type QueuedForThread, type QueuedWord,
} from '../../src/lib/threadOutbox';
// …and the third outcome, which is not the same as the second and had reached
// no screen at all. A refused message is dropped from the outbox — correctly —
// and until this arrived the drop also took away the only mark saying it had
// not gone. See src/lib/refusedMessages.ts.
import { useRefusedMessages } from '../../src/ui/messaging';
import {
  refusedByThread, refusedScreenNote, refusedThreadNote, type RefusedForThread,
} from '../../src/lib/refusedMessages';
// The clock this screen is ordered and timed by. NOT a bare `Date.now()` in the
// render body: app/(trainer)/_layout.tsx registers this screen with
// `href: null`, so it mounts once and is never torn down, and the value would
// then be whatever day the coach first opened Messages. Everything on the
// screen hangs off it — `threadWhen` on every row, and the whole-day threshold
// `waitingOn` puts somebody on the queue by. See src/ui/today.ts.
import { useNow } from '../../src/ui/today';
import { isWhole } from '../../src/ui/loadStatus';
import { hitSlopFor } from '../../src/lib/a11y';
import { FORWARD_ICON } from '../../src/ui/direction';

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
function ThreadRow({ t, now, queued, refused, onPress }: {
  t: CoachThread; now: number; queued?: QueuedForThread | null;
  refused?: RefusedForThread | null; onPress: () => void;
}) {
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
  // What this PHONE is holding for this conversation, which the server's answer
  // above cannot know about. Everything else on this row is `stored`; this is
  // the `unsent` state, and without it a reply typed underground renders as
  // nothing at all. See src/lib/threadOutbox.ts.
  const queuedNote = queuedThreadNote(queued, now);
  // The third state, and the one this row used to render as nothing. A message
  // the SERVER refused is out of the outbox, so it has no `queued` mark — and a
  // row with no mark is what a delivered message looks like. `now` is the same
  // moving clock the rest of the row is timed by, so "Written 2 days ago" is
  // measured rather than guessed.
  const refusedNote = refusedThreadNote(refused, now);
  // All three said to a screen reader, because `Pressable` collapses this whole
  // subtree into one element: text drawn inside it is not announced on its own.
  const hint = [
    badge === '—' ? 'We could not read how many of their messages are unopened.' : counted ? `${badge} unopened` : null,
    queuedNote,
    refusedNote,
  ].filter(Boolean).join(' ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open the conversation with ${head.isName ? head.text : 'this client'}`}
      accessibilityHint={hint || undefined}
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
        {/* The words this phone is still holding for this conversation. In its
            own line under the preview rather than replacing it: the preview is
            the last thing SAID in the thread and a queued reply is the last
            thing typed, which nobody has read. The tone mark is what stops it
            reading as a quiet aside. */}
        {queuedNote ? (
          <View style={{ marginTop: 3 }}>
            <Flag tone={th.warn}>{queuedNote}</Flag>
          </View>
        ) : null}
        {/* A stronger tone than the queued mark, and deliberately: one is a
            message that will go, the other is one that never will. They can be
            drawn together — a coach who typed twice may have had the first
            refused and the second still waiting — and the two sentences say
            opposite things about the same conversation, which is the whole
            reason they are two marks rather than one. */}
        {refusedNote ? (
          <View style={{ marginTop: 3 }}>
            <Flag tone={th.crit}>{refusedNote}</Flag>
          </View>
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
function WaitingRow({ w, now, queued, refused, onPress }: {
  w: Waiting; now: number; queued?: QueuedForThread | null;
  refused?: RefusedForThread | null; onPress: () => void;
}) {
  const th = useTheme();
  const head = peerHeading(w.thread.name ? { kind: 'named', name: w.thread.name } : { kind: 'withheld' }, 'client');
  const line = waitingLine(w);
  // This queue is built from who spoke last ON THE SERVER, so a coach who has
  // already answered from a train is still on it — correctly, because nobody
  // has received that answer. What would be wrong is leaving them on it with no
  // word of why, which is how the same reply gets typed twice.
  const queuedNote = queuedThreadNote(queued, now);
  // And the one that keeps somebody on this queue forever. A refused reply
  // never reaches the server, so `lastSender` stays the client's and this row
  // stays up — with nothing on it saying why, the coach retypes the same
  // message into the same refusal.
  const refusedNote = refusedThreadNote(refused, now);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open the conversation with ${head.isName ? head.text : 'this client'}. ${line}${queuedNote ? ` ${queuedNote}` : ''}${refusedNote ? ` ${refusedNote}` : ''}`}
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
        {queuedNote ? (
          <View style={{ marginTop: 3 }}>
            <Flag tone={th.warn}>{queuedNote}</Flag>
          </View>
        ) : null}
        {refusedNote ? (
          <View style={{ marginTop: 3 }}>
            <Flag tone={th.crit}>{refusedNote}</Flag>
          </View>
        ) : null}
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
  // disagree about what "now" is — and one that MOVES, which it was not.
  //
  // This read `Date.now()` in the render body. That is the second form of the
  // frozen clock, the one `check:frozen-day` and `check:frozen-hook` do not
  // see: they look for the `useState`/`useMemo` initialiser, and a bare call in
  // a render body is only as fresh as the last render. This screen is an
  // `href: null` tab that mounts once and stays mounted, so a coach who left it
  // open and came back the next day was shown yesterday's "3h" on every row,
  // and `waitingOn`'s whole-day threshold was measured against yesterday too —
  // the queue of who is waiting on a reply, timed by a clock that stopped.
  const now = useNow().getTime();
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
   * ── THE WORDS THIS PHONE IS STILL HOLDING ────────────────────────────────
   *
   * Everything above comes from `coach_threads()`, which is the server's answer
   * and therefore describes only what is `stored`. The third state — typed,
   * kept on this handset, delivered to nobody — was invisible on this screen,
   * and it is the state a coach most needs to see here: they replied to three
   * people underground, came back to an inbox that still showed those three
   * clients' own words last, and had no way to tell whether their answers went.
   *
   * `null` when there is no outbox above this screen, which is a different fact
   * from an empty one and is said as such — see `outboxThreadsNote`.
   *
   * A payload this build cannot narrow is kept with NO thread key rather than
   * dropped: it is still a message on this phone, and `outboxThreadsNote`
   * counts it against the total so the per-row marks are never presented as the
   * whole queue.
   */
  const outbox = useOutbox();
  const queuedWords = useMemo<QueuedWord[] | null>(() => {
    if (!outbox) return null;
    const out: QueuedWord[] = [];
    for (const item of outbox.pending) {
      if (item.kind !== 'message') continue;
      out.push({ clientId: asQueuedMessage(item.payload)?.clientId ?? '', at: item.at });
    }
    return out;
  }, [outbox]);
  const queuedThreads = useMemo(() => queuedByThread(queuedWords ?? []), [queuedWords]);
  /**
   * ── AND THE ONES THE SERVER ANSWERED NO TO ───────────────────────────────
   *
   * The queue above holds messages that WILL go. This holds the ones that will
   * not, and the difference was invisible here: `flush` drops a refused item
   * exactly as it drops a stored one, so the "waiting to send" mark simply
   * came off the row — leaving a row that looks identical to one whose reply
   * landed. A coach reads that as delivery.
   *
   * `refused` is null when this device could not read its own record, which is
   * not an empty one, and `refusedScreenNote` says so below.
   */
  const refusedRecord = useRefusedMessages();
  const refusedThreads = useMemo(
    () => refusedByThread(refusedRecord.refused ?? []),
    [refusedRecord.refused],
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
  /**
   * The one sentence this screen owes about its own queue.
   *
   * Its denominator is what is ACTUALLY DRAWN — the conversations and the
   * unstarted clients after the filter — so a message held for somebody the
   * coach has narrowed out of the list is counted and said to be off-screen
   * rather than marked nowhere and implied not to exist.
   */
  const shownIds = useMemo(
    () => new Set([...shown, ...shownUnstarted].map((c) => c.clientId)),
    [shown, shownUnstarted],
  );
  const outboxNote = outboxThreadsNote(queuedWords, outbox ? outbox.status : 'ready', shownIds);
  /** The same sentence for the opposite fact, and with the same denominator: a
   *  refusal for somebody the coach has narrowed out of the list is counted and
   *  said to be off-screen rather than marked nowhere. */
  const refusedNote = refusedScreenNote(refusedRecord.refused, refusedRecord.status, shownIds);
  /* ── who is waiting on the coach, first ──────────────────────────────
   *
   * A client's unread messages are work waiting on the coach, so they lead
   * the screen instead of being buried in recency order. Split from `shown`
   * — the filtered list — so a search or a filter narrows both halves the
   * same way. A null unread count stays in the ordinary list: an unread count
   * that failed to load is not silently treated as zero, and ThreadRow says
   * the unknown state on the row itself. */
  /* ── and nobody in two queues ─────────────────────────────────────────
   *
   * "Waiting on a Reply" above is drawn from the same threads, and somebody
   * who wrote on Monday and has not been opened since is in BOTH by
   * definition: last word theirs, a day old, unread. They were drawn twice,
   * four inches apart, under two headings that both began with "Waiting" —
   * and a coach counting the screen got a number one higher than the people
   * on it. The reply queue keeps them, because its row already says whether
   * the message has been opened (`waitingLine`), and this one takes whoever is
   * left. Only while that queue is actually drawn: under a filter it is not,
   * and then nobody is removed from anything. */
  const inReplyQueue = new Set(!narrowed && hasWaiting(waiting) ? waiting.rows.map((w) => w.thread.clientId) : []);
  const listed = shown.filter((c) => !inReplyQueue.has(c.clientId));
  const waitingThreads = listed.filter((c) => c.unread != null && c.unread > 0);
  const otherThreads = listed.filter((c) => c.unread == null || c.unread === 0);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* The kit's pushed-page head — round back, centred title, the context
          under it — in place of the hand-built row every other pushed page
          gave up in round three. Outside the ScrollView, as it always was, so
          the way back does not scroll away under a long inbox. */}
      <View style={{ paddingHorizontal: G, paddingBottom: sp.sm }}>
        <PageHead title="Messages" subtitle="Your clients" />
      </View>

      {/* The name search sits at the top of this list and the keyboard has never been on
          top of it. `automaticallyAdjustKeyboardInsets` is here for what is UNDER it: with
          the keyboard up, the last threads in the list stopped behind it and could not be
          scrolled into view. The padding is deliberately left alone — this field is nowhere
          near the end of the screen, and a keyboard's height of dead space under a list of
          conversations would be scrolling into nothing. */}
      {/* The gutter is the ScrollView's, once. It used to be each notice's own
          `paddingHorizontal`, from when a Section was a full-width band between
          hairlines; Sections became bordered cards (src/ui/kit.tsx) and this
          list kept no gutter of its own, so every card here ran to both edges
          of the glass with its rounded corners cut off by the bezel — the one
          inbox in the app that did not look like the board's. */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: sp.xxl }}
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
          <View style={{ paddingTop: sp.lg }}>
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
          <View style={{ paddingTop: sp.lg }}>
            {/* "clients on your book" was wrong about its own set, and wrong in
                the direction that reassures. `coach_threads()` reads
                `from clients c where c.trainer_id = auth.uid()`
                (supabase/parts/148), so every row here is a client WITH AN
                ACCOUNT; a hand-added `coach_clients` row is in no part of it.
                A coach with twelve hand-added clients was told a number about
                their book that counted none of them. `threadsEmptyNote` says
                the same thing for the empty case. */}
            <PartialRead what="clients with an account" shown={conversations.length + unstarted.length} onPress={() => { refresh(); }} />
          </View>
        ) : null}

        {/* ── what this phone has not sent yet ──────────────────────────────
            Above the lists, because it is a fact about every row below them and
            because it is the one thing on this screen the server did not say.
            Drawn under a failed read of the conversations too: the queue is the
            device's and is known whether or not the server answered. */}
        {outboxNote ? (
          <View style={{ paddingTop: sp.lg }}>
            <Flag tone={t.warn}>{outboxNote}</Flag>
          </View>
        ) : null}

        {/* ── and what the server said no to ────────────────────────────────
            Above the queued note in severity and below it on the screen, so the
            two are read in the order they happened: typed, waiting, refused.
            Drawn under a failed read of the conversations for the same reason
            the queue is — this is the DEVICE's record and is known whether or
            not the server answered this morning. */}
        {refusedNote ? (
          <View style={{ paddingTop: sp.lg }}>
            <Flag tone={t.crit}>{refusedNote}</Flag>
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
          <View style={{ paddingTop: sp.lg }}>
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
                <WaitingRow w={w} now={now} queued={queuedThreads.get(w.thread.clientId)}
                  refused={refusedThreads.get(w.thread.clientId)} onPress={() => open(w.thread)} />
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

        {waitingThreads.length ? (
          <Section>
            {/* "Unread", the chip's own word, and not a second heading that
                begins "Waiting". The count is a count of the coach's book, so
                it is said over a whole read alone — under 'partial' these are
                the unread threads that LOADED, and the notice above says so. */}
            <SectionHead
              title="Unread"
              note={isWhole(status)
                ? `${waitingThreads.length} ${waitingThreads.length === 1 ? 'client' : 'clients'}`
                : undefined}
            />
            {waitingThreads.map((c, i) => (
              <View key={c.clientId}>
                {i > 0 ? <Rule inset={56} /> : null}
                <ThreadRow t={c} now={now} queued={queuedThreads.get(c.clientId)}
                  refused={refusedThreads.get(c.clientId)} onPress={() => open(c)} />
              </View>
            ))}
          </Section>
        ) : null}

        {otherThreads.length ? (
          <>
            {waitingThreads.length ? <Rule /> : null}
            <Section>
              <SectionHead
                title={waitingThreads.length || inReplyQueue.size ? 'Other Conversations' : 'Conversations'}
                note={narrowed
                  ? `${shown.length} of ${conversations.length}`
                  : 'Most recent first'}
              />
              {otherThreads.map((c, i) => (
                <View key={c.clientId}>
                  {i > 0 ? <Rule inset={56} /> : null}
                  <ThreadRow t={c} now={now} queued={queuedThreads.get(c.clientId)}
                    refused={refusedThreads.get(c.clientId)} onPress={() => open(c)} />
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* The four empty lists, kept apart. Never "no messages" over a failure. */}
        {emptyNote ? (
          <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xxl }}>
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
                // Same denominator, same reason: this counts clients with an
                // account, and a hand-added client cannot be messaged at all
                // until they join — which is what `sendCoachMessages` tells a
                // coach who tries. Saying "3 clients you have not written to"
                // to somebody looking at fifteen on the Clients tab reads as a
                // roster that has lost twelve people.
                note={shownUnstarted.length === 1
                  ? 'One client with an account you have not written to yet'
                  : `${shownUnstarted.length} clients with an account you have not written to yet`}
              />
              {/* A coach who has typed a name is looking for that person, so the
                  matches are drawn rather than hidden behind the button — the
                  button exists to keep eighteen quiet clients out of a list of
                  two conversations, and a search result is neither. */}
              {showAll || shown.length === 0 || !!filter.query.trim() ? (
                shownUnstarted.map((c, i) => (
                  <View key={c.clientId}>
                    {i > 0 ? <Rule inset={56} /> : null}
                    <ThreadRow t={c} now={now} queued={queuedThreads.get(c.clientId)}
                      refused={refusedThreads.get(c.clientId)} onPress={() => open(c)} />
                  </View>
                ))
              ) : (
                <Ghost label="Show Clients" icon="people" onPress={() => setShowAll(true)}
                  a11yLabel="Show the clients you have not written to yet" />
              )}
            </Section>
          </>
        ) : null}

        {/* ── one person, or an audience ───────────────────────────────────
            The data-layout review's flow for coach messaging opens "Inbox →
            person / audience", and this inbox had only the first half:
            Broadcast was a tile on the Clients tab and was reachable from
            nowhere on the one screen about writing to clients. It is a row
            here and deliberately NOT a thread in the lists above — a broadcast
            is N ordinary messages in N threads (see broadcast.tsx), so there
            is no broadcast conversation to list, and a row dressed as one
            would be a thread nobody can reply in. The note says how many it
            goes to is settled on that screen, before anything is sent, because
            no count belongs here: the audience has not been chosen yet.

            Saved messages and the Quiet Clients drafts are not rows beside
            it. Both are ways of filling the composer, and both already live
            inside the compose flow — the picker in the chat box, the draft
            sheet that sends through the ordinary thread. */}
        {status !== 'loading' ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Write to Many" />
              <ListRow icon="people" title="Broadcast"
                note="One message into each client’s own thread. You pick who, and see how many, before it goes."
                onPress={() => router.push('/(trainer)/broadcast')} />
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
