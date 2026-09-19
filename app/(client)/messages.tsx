// Client · Messages — the thread with your coach (Supabase-backed, realtime).
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero and no cards — the bubbles are the content, so
// they keep the ink and the chrome recedes to a hairline.
//
// Fabrication removed: the header claimed your coach "usually replies within a
// few hours". No reply-time is measured anywhere, so the claim is gone rather
// than replaced.
//
// ── TF-32: the header named the reader ─────────────────────────────────────
//
// This screen used to head the thread with `useCoachProfile().name`. That
// provider is the coach's own: it reads `auth.getUser()` and loads that user's
// `profiles.full_name`. Signed in as a client, that user IS the client — so
// under the kicker "Your coach" sat the client's own name, and `|| 'Your coach'`
// only hid it from accounts that had never set one. Nothing was misdelivered:
// the thread is keyed by `messages.client_id` and 10-messages-setup.sql decides
// who may read it, so this was the label lying, not the message going astray.
//
// The name now comes from a read for the COACH's id and from nowhere else, via
// `useThreadPeerName`, and so does the face beside it. Both arrive from
// `my_coach()` — a security-definer function that takes no argument, so it can
// only answer about the caller's own coach, and returns two columns, so it
// cannot hand over the rest of a `profiles` row on the way (supabase/parts/67
// and 115).
//
// When either does not come back, the dash and its reason are still what draws.
// That is the ordinary case for a coach who has set no picture, and it stays
// the honest one: nothing here falls back to a name or a face that belongs to
// somebody else, which is the entire lesson of TF-32.
//
// While the header was being made truthful, two things the thread hook has long
// exposed and this screen ignored were connected: `status`, so a thread that
// failed to load stops saying "No messages yet", and `unsent`, so a bubble the
// server refused stops looking exactly like a delivered one.
//
// ── A photo of the machine ─────────────────────────────────────────────────
//
// A message can now carry one photo or one short video. The client half of that
// is mostly the first case: standing in front of a machine wondering whether it
// is the one on the plan, or photographing what is on the plate. The file goes
// to a private bucket only this client and their coach can read
// (supabase/parts/124), and it is read back through a short-lived signed URL.
//
// Three states the bubble keeps apart, because collapsing any two of them is
// the failure this screen has already been fixed for once:
//
//   sending      the picture on screen is the file on THIS phone. Not delivered.
//   not sent     the upload or the row was refused. The note says which, and
//                the picture stays visible so the sender can try it again.
//   unreadable   the row carries an attachment this build cannot draw, or one
//                whose link could not be signed. It says so. It never renders
//                as a message with nothing attached, which would be a photo
//                the sender believes arrived and the reader never saw.
//
// ── A way out of a conversation that carries photographs ──────────────────
//
// The thread above accepts a photo or a 30-second video in either direction and
// had no block and no report — a private surface carrying user-generated media
// between two named adults, with no moderation path for the person receiving
// it. Both now exist, and the enforcement is at the database, not here
// (supabase/parts/240): a block is a row the WITH CHECK on the message policies
// and on the storage INSERT policy reads, so a blocked message is REFUSED and
// the file has nowhere to land. This screen can therefore be stale about the
// block and cost only a sentence, never the protection.
//
// Two ways in, because they are two different moments. The header control is
// for "I want this to stop"; a long press on a bubble is for "look at THIS",
// and it is the one that files a report carrying the message itself — copied
// into the report row, so deleting the message afterwards cannot empty it.
import { useCallback, useMemo, useRef } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Flag, Ghost, Notice } from '../../src/ui/kit';
import { useKeyboardLift } from '../../src/ui/keyboardLift';
import {
  HAS_NATIVE_VIDEO, UPDATE_REQUIRED_NOTE, HAS_NATIVE_CLIPBOARD, copyToClipboard,
} from '../../src/ui/nativeModules';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { peerHeading } from '../../src/lib/threadPeer';
import { peerMonogram } from '../../src/lib/peerAvatar';
import { fmtRelativeDay, fmtTime } from '../../src/lib/format';
import { attachmentNoun } from '../../src/lib/messageAttachments';
import { atBottom, isLocalId } from '../../src/lib/readReceipt';
import { useReadReceipt } from '../../src/ui/readReceipts';
// How long this member has been waiting, when they have been waiting at all.
// The coach's app has filed them under "Waiting on a Reply" since
// src/lib/awaitingReply.ts landed; this is the sentence on their own side of
// that. See src/lib/replyWait.ts for why it never predicts a reply.
import { replyWait } from '../../src/lib/replyWait';
// The clock the wait is measured against. A thread is a screen somebody leaves
// open, so a `Date.now()` taken at mount would freeze the wait at whatever it
// was when they opened it.
import { useNow } from '../../src/ui/today';
import {
  blockActionLabel, blockConfirm, blockedComposerNote, canSendInto, unblockConfirm,
  reportFiledLine, REPORT_EXPLAINER, REPORT_OPTIONS, type ReportCategory,
} from '../../src/lib/threadSafety';
import {
  useThread, useThreadPeerName, useAttachmentUrl, pickMessageAttachment, useThreadSafety,
  useRefusedMessages,
  type AttachSource, type PendingAttachment, type ThreadMessage,
} from '../../src/ui/messaging';
// The words this phone typed that the server declined. Not a bubble and not a
// queue: `flush` drops a refused item, so the merge in `useThread` stops
// producing its bubble and the member watches their own message disappear off
// the screen with nothing said. See src/lib/refusedMessages.ts.
import { refusedBodyNote, refusedForThread } from '../../src/lib/refusedMessages';
// Finding something in a conversation that is months long. Nothing new is read
// — the messages are already in memory — and the whole of the honesty is the
// sentence saying WHAT was searched, because this screen holds the recent end
// of the thread and not the thread. See src/lib/threadSearch.ts.
import {
  searchThread, threadSearchA11y, threadSearchActive, threadSearchLine,
} from '../../src/lib/threadSearch';
import { BACK_ICON, FORWARD_ICON } from '../../src/ui/direction';

/** The clip itself. Split into its own component so the player hook receives a
 *  settled URL — a signature arrives asynchronously and a hook cannot wait. */
function Clip({ uri, label }: { uri: string; label: string }) {
  const t = useTheme();
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return (
    <VideoView player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }}
      accessibilityLabel={label}
      style={{ width: 240, aspectRatio: 3 / 4, borderRadius: radius.md, backgroundColor: t.surface2 }} />
  );
}

/**
 * Whatever is attached to one bubble.
 *
 * Every branch that cannot show the file says so in words. There is deliberately
 * no path through this component that renders nothing at all: a message with an
 * attachment that silently draws as text is indistinguishable, to the person
 * reading it, from one that was never sent — and indistinguishable, to the
 * person who sent it, from one that arrived.
 */
function Attachment({ m }: { m: ThreadMessage }) {
  const t = useTheme();
  const stored = m.attachment.state === 'ok' ? m.attachment.attachment : null;
  // A file still on this phone needs no signature — the sender is looking at
  // their own copy — so the hook is handed nothing to sign in that case. It is
  // still CALLED on every render, as a hook must be.
  const { url, status } = useAttachmentUrl(m.local ? null : stored);
  const box = { width: 240, aspectRatio: 3 / 4, borderRadius: radius.md, backgroundColor: t.surface2 } as const;
  const note = (text: string) => (
    <View style={{ ...box, alignItems: 'center', justifyContent: 'center', padding: sp.md }}>
      <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>{text}</Text>
    </View>
  );

  // A row this app cannot make sense of. Said out loud rather than skipped.
  if (m.attachment.state === 'unreadable') return note(m.attachment.why);

  // The file is on this phone: on its way up, delivered (the row landed and
  // points at this same file), or refused. Drawn from here in all three cases,
  // because it is the picture the sender is already looking at — but only the
  // caption changes with the state, and none of them says "sent" for a bubble
  // that is not.
  if (m.local) {
    const delivered = !!stored;
    return (
      <View>
        {m.local.kind === 'image'
          ? <Image source={{ uri: m.local.uri }} style={box} resizeMode="cover" accessibilityIgnoresInvertColors
              accessibilityLabel={m.sending ? 'The photo you are sending' : delivered ? 'The photo you sent' : 'A photo that did not send'} />
          : m.sending ? note('Sending your video…')
            : delivered ? <Clip uri={m.local.uri} label="The video you sent" />
            : note('This video did not send.')}
        {m.sending ? (
          <View style={{ position: 'absolute', end: sp.sm, bottom: sp.sm }}>
            <ActivityIndicator size="small" color={t.ink3} />
          </View>
        ) : null}
      </View>
    );
  }

  if (!stored) return null;
  if (status === 'loading') return note(`Loading this ${attachmentNoun(stored.kind)}…`);
  // A link we could not mint. Not "no picture" — there is one, and this reader
  // could not be given a way to open it.
  if (!url) return note(`This ${attachmentNoun(stored.kind)} could not be loaded.`);

  if (stored.kind === 'image') {
    return <Image source={{ uri: url }} style={box} resizeMode="cover" accessibilityIgnoresInvertColors
      accessibilityLabel="Photo in this conversation" />;
  }
  // A binary installed before expo-video was added has this screen and not the
  // player; the old behaviour would be a black rectangle with nothing to read.
  if (!HAS_NATIVE_VIDEO) return note(UPDATE_REQUIRED_NOTE);
  return <Clip uri={url} label="Video in this conversation" />;
}

export default function Messages() {
  const t = useTheme();
  const router = useRouter();
  const peer = useThreadPeerName('client', null);
  const head = peerHeading(peer, 'coach');
  const { messages: msgs, send, status, unsent, cachedNote, hasOlder, loadingOlder, olderError, loadOlder, reload, threadId } = useThread(null, 'client');
  // This said "There is no realtime subscription on this thread", and it was
  // flatly wrong about the code directly under it: `useThread` opens
  // `.channel('msg:' + cid)` and subscribes to INSERTs on `messages` filtered to
  // this thread (src/ui/messaging.ts), appending anything it has not already
  // seen. The header of this file says "realtime" in its first line, so the
  // screen carried both sentences at once — and the false one generated a
  // roadmap item to build a subscription that has been there all along.
  //
  // What is TRUE, and what pull-to-refresh is actually for, is that the
  // subscription is best-effort. It is opened inside a try/catch whose comment
  // reads "realtime optional", so a project without the publication, a network
  // that will not open a websocket, or a socket dropped while the phone was
  // asleep all leave the thread live-looking and silently static, with nothing
  // on screen to say so. `reload` re-reads the newest page and is the member's
  // only way out of that; `loadOlder` above walks backwards, and the two are
  // different asks. Nothing queued on this device is dropped by either.
  // The block and the report. Its state is deliberately allowed to be stale or
  // unread: the database refuses a blocked write regardless, so being wrong
  // here costs a sentence rather than the protection. See src/lib/threadSafety.
  const safety = useThreadSafety(null, 'client');
  // ── the pull brings the block back too ────────────────────────────────
  //
  // It re-read the thread and nothing else. `blockStateOf` answers 'unknown'
  // for a read that failed, and 'unknown' draws NO composer note and leaves
  // the composer live — which is the right pessimism and is also silent. So a
  // member who blocked their coach last night, opened this screen on a dropped
  // connection and watched the block read fail had no sentence saying so and
  // no way to ask again: the hook re-runs on the thread key and the sign-in
  // revision, neither of which a gesture moves. `reload` is the hook's own and
  // has been exposed since it was written; this is the gesture that reaches it.
  //
  // Deliberately NOT `safety.status === 'error'`-gated. A block lifted on
  // another handset is just as invisible, and re-reading two rows costs
  // nothing next to the thread page beside it.
  const pull = usePullToRefresh(useCallback(() => { reload(); safety.reload(); }, [reload, safety.reload]));
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  // Which message is being reported, or null for the conversation as a whole.
  // `open` is separate from the id because reporting the conversation is a
  // legitimate report with no message on it — the abuse was the sum of it, or
  // the message has already been deleted by the person who sent it.
  //
  // `body` travels with it so the sheet can offer to COPY the message as well
  // as report it. Empty for the conversation-level open, and empty for a bubble
  // that is only a photograph — the Copy row is drawn on the words, never on an
  // attachment it could not put on a clipboard.
  const [reportFor, setReportFor] = useState<{ open: true; messageId: string | null; body: string } | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const scRef = useRef<ScrollView>(null);
  // Set for exactly one content-size change: the one caused by a page of older
  // messages arriving. Without it the `scrollToEnd` below fires on the growth
  // and throws the reader back to the bottom of the thread they just stepped
  // out of — the newest messages, which is the half they were not reading.
  const heldPosition = useRef(false);
  /**
   * The end of the conversation is on screen.
   *
   * One of the four clauses of "what counts as read" (src/lib/readReceipt.ts):
   * a thread scrolled to the top is not a thread whose newest message has been
   * drawn. Measured from `onScroll` below, and true to begin with because the
   * `onContentSizeChange` above scrolls a freshly loaded thread to its end —
   * so the first render genuinely is at the bottom, and the first real scroll
   * event corrects this the instant a finger moves.
   */
  const [atEnd, setAtEnd] = useState(true);
  // "your coach" rather than their name, and everywhere on this surface. A name
  // that could not be read renders as a dash, and a dash as the subject of
  // "— will not be able to send you messages" reads as the screen having broken
  // at the exact moment somebody needs to trust it (scripts/check-prose.mjs).
  const OTHER = 'your coach';
  const blockNote = blockedComposerNote(safety.state, OTHER);
  const canSend = canSendInto(safety.state);
  /**
   * What each of this member's own bubbles is allowed to claim, and the write
   * that tells their coach they have read theirs.
   *
   * `line` returns the failure sentences unchanged — they still come from
   * `unsentNote`, which is why this screen no longer imports it directly — and
   * adds the two states the report asked for: "Sent 09:41" once the row is on
   * the server, and "· Read" once the coach's own watermark has passed it.
   * The other person's bubbles keep their bare time.
   */
  const receipt = useReadReceipt({ threadId, role: 'client', messages: msgs, unsent, atEnd, them: OTHER });
  /**
   * How long this member has been waiting, when they have been waiting at all.
   *
   * `receipt.peerReadAt` has been exposed by that hook since it was written,
   * with a docstring saying it is there "for a screen that wants to say
   * something once rather than per bubble", and nothing ever said anything.
   * This is that sentence.
   *
   * `delivered` is derived exactly as `deliveryOf` derives its own states — in
   * flight, marked unsent, or carrying an id no server has issued — so a
   * message sitting in the outbox can never be counted as a wait. The three
   * tests are duplicated rather than shared because `Bubble` is the receipt
   * module's shape and this needs three booleans out of it; what must not
   * diverge is the RULE, and the rule is one line in both places.
   */
  const now = useNow();
  const waiting = replyWait({
    messages: msgs.map((m) => ({
      mine: m.sender === 'client',
      createdAt: m.createdAt,
      delivered: !m.sending && !unsent[m.id] && !isLocalId(m.id),
    })),
    status,
    peerReadAt: receipt.peerReadAt,
    now: now.getTime(),
    canSend,
    them: OTHER,
  });

  /**
   * ── THE MESSAGES THAT WERE REFUSED ───────────────────────────────────────
   *
   * A queued message is drawn as a bubble by `useThread`'s merge, marked
   * 'queued', and the line under it says nobody has it yet. When the flush
   * meets a REFUSAL the item leaves the outbox — which is right, the server has
   * answered and will answer the same way again — and the bubble leaves with
   * it. The member sees their message vanish. Nothing tells them, and the
   * likeliest cause on this side is the one they would most want to know
   * about: their coach has blocked them (part 240), or the coaching link has
   * ended.
   *
   * So the words are kept and put back here, above the composer rather than in
   * the thread, because they are NOT in the conversation and drawing them as a
   * bubble would be the same claim the queue's own mark exists to avoid.
   *
   * Only this thread's. A client has one coach, so in practice that is all of
   * them — but the store is keyed by account and not by thread, and filtering
   * by the key this screen actually settled on is what keeps it true if that
   * ever stops being the case.
   */
  /**
   * ── FINDING SOMETHING THEY SAID ──────────────────────────────────────────
   *
   * The answer to "what did they say about my knee" lives in this thread and
   * there was no way to look for it. Every competitor searches message content;
   * app/(trainer)/messages.tsx searches client NAMES and this screen searched
   * nothing.
   *
   * Off by default and behind a control, because a chat screen opens to the
   * newest message and a search field at the top of it would be the first thing
   * a member reads every time.
   */
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const searchOn = searching && threadSearchActive(query);
  /**
   * The bubbles that are drawn.
   *
   * `msgs` is left alone and is still what `receipt` and `waiting` are computed
   * from above: a member searching their own thread has not read anything new
   * and has not stopped waiting for a reply, and filtering the list must not
   * change either claim.
   */
  const found = useMemo(() => (searchOn ? searchThread(msgs, query) : msgs), [searchOn, msgs, query]);
  const searchLine = searchOn
    ? threadSearchLine({ query, matched: found.length, searched: msgs.length, hasOlder, status })
    : null;

  const refusedRecord = useRefusedMessages();
  const refusedHere = useMemo(
    () => refusedForThread(refusedRecord.refused ?? [], threadId),
    [refusedRecord.refused, threadId],
  );

  const attach = async (source: AttachSource) => {
    const { attachment, error } = await pickMessageAttachment(source);
    // A cancel carries neither, and must raise nothing at anybody.
    if (error) { Alert.alert('That file cannot be sent', error); return; }
    if (attachment) setPending(attachment);
  };

  const onAttach = () => {
    Alert.alert('Add to your message', 'Your coach will be able to see this, and nobody else.', [
      { text: 'Take a photo', onPress: () => { attach('photo'); } },
      { text: 'Record a video', onPress: () => { attach('video'); } },
      { text: 'Choose from your library', onPress: () => { attach('library'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // The box empties on the way out, as it always has. What does NOT happen is
  // the failure being swallowed with it: a send that did not go says so here,
  // as well as leaving the bubble marked, because the alert is what reaches
  // somebody who is about to put their phone away.
  /**
   * Block, or lift a block. Confirmed first, and the confirm says the three
   * things a block does NOT do — it is a control somebody reaches for under
   * pressure, and the fear that it cancels their sessions is what stops people
   * using it.
   */
  const onSafety = () => {
    const blocked = safety.state === 'blocked-by-me';
    const c = blocked ? unblockConfirm(OTHER) : blockConfirm(OTHER);
    Alert.alert(c.title, c.body, [
      { text: 'Not Now', style: 'cancel' },
      // ── the half of this control that was promised and not built ────────
      //
      // The header of this file says there are "two ways in, because they are
      // two different moments. The header control is for 'I want this to
      // stop'; a long press on a bubble is for 'look at THIS'." The control's
      // own accessibilityHint says it the same way — "Block this conversation,
      // or report a message in it". Neither was true: this alert offered Not
      // Now and Block, and the ONLY route to the report sheet in the whole
      // screen was a long press on a bubble that is not the member's own.
      //
      // Two things followed, and the second is the worse one:
      //
      //   · a member who wanted to report the conversation rather than one
      //     message — because the abuse was the sum of it, or because the
      //     person who sent it has since deleted it, which `msg_coach` lets
      //     them do — had no way to. `safety.report` has taken a null message
      //     id since it was written, and the sheet below already titles itself
      //     "Report this conversation" for exactly that case: a branch that
      //     rendered for nobody.
      //   · a member who cannot long-press had the ONE moderation path in this
      //     product behind a gesture. The accessibilityActions on each bubble
      //     were added to fix that for a message; nothing fixed it for the
      //     conversation, and a hint on a header button promised it was there.
      //
      // Between Not Now and Block deliberately: reporting is the middle answer,
      // and it is the one somebody reaches for when they want it looked at
      // rather than silenced. It does NOT block — REPORT_EXPLAINER in the sheet
      // is explicit about that, and it is the sentence that stops somebody
      // thinking a report has protected them.
      {
        // Just 'Report'. This alert is the BLOCK confirm on an open thread and
        // the UNBLOCK confirm on one this member has already blocked, and a
        // label that reads as an alternative to the destructive button ("Report
        // Instead") reads as nonsense over "Unblock your coach?". Reporting is
        // available in both, which is what `blockConfirm` already promises when
        // it says everything here is kept "so you can still read it and still
        // report it" — a sentence that had no control behind it.
        text: 'Report',
        onPress: () => { setReportNote(''); setReportFor({ open: true, messageId: null, body: '' }); },
      },
      {
        text: blocked ? 'Unblock' : 'Block',
        style: blocked ? 'default' : 'destructive',
        onPress: async () => {
          const r = blocked ? await safety.unblock() : await safety.block();
          if (!r.ok) { Alert.alert(blocked ? 'Not unblocked' : 'Not blocked', r.error ?? 'That did not save.'); return; }
          Alert.alert(
            blocked ? 'Unblocked' : 'Blocked',
            blocked
              ? `${OTHER.charAt(0).toUpperCase()}${OTHER.slice(1)} can message you again. Any report you made stays on record.`
              : `Nothing more can be sent either way. Everything already here is kept, so you can still read it and still report it.`,
          );
        },
      },
    ]);
  };

  /**
   * Put the words of one message on the clipboard.
   *
   * ── why this is here and not on the bubble ────────────────────────────
   *
   * Nothing in this thread could be copied, selected or got out of the app in
   * any way. A coach writes an address, a supplement, a time, a gym's door
   * code; the member re-types it from a screenshot or does not. Every messenger
   * this product is measured against — and every coaching app with a thread in
   * it — lets the person being coached copy what their coach wrote.
   *
   * The obvious fix is `selectable` on the bubble's <Text>, and it is the wrong
   * one HERE: an incoming bubble is a Pressable whose only gesture is
   * `onLongPress`, and that gesture is the one route this product has to
   * reporting abuse. `selectable` installs a long-press recogniser of its own
   * on the text, so making the coach's words copyable by that route is trading
   * the report gesture for it — on the surface where the report matters most.
   *
   * So it goes where a long press already lands, in the sheet that already
   * knows which message it is about and already opens from an accessibility
   * action as well as from the gesture. Nothing is traded and nothing new is
   * behind a gesture.
   *
   * Reported rather than assumed, for the reason `copyToClipboard` gives:
   * "Copied" is a sentence somebody ACTS on, and claiming it against a binary
   * with no clipboard costs them the paste.
   */
  const copyMessage = async (body: string) => {
    if (!body) return;
    if (!(await copyToClipboard(body))) {
      Alert.alert(
        'Not copied',
        HAS_NATIVE_CLIPBOARD
          ? 'That could not be put on your clipboard just now. Try again in a moment.'
          : 'This version of the app cannot use the clipboard. Updating to the latest build adds it.',
      );
      return;
    }
    setReportFor(null);
    Alert.alert('Copied', 'The message is on your clipboard.');
  };

  /** File the report the sheet has collected. `id` coming back is the row
   *  existing — a call that merely did not raise is not a report. */
  const fileReport = async (category: ReportCategory) => {
    if (reportBusy || !reportFor) return;
    setReportBusy(true);
    const res = await safety.report(category, reportNote, reportFor.messageId);
    setReportBusy(false);
    if (!res.id) { Alert.alert('Not reported', res.error ?? 'That did not save.'); return; }
    setReportFor(null); setReportNote('');
    Alert.alert('Reported', reportFiledLine(category, safety.state));
  };

  const onSend = async () => {
    if (busy) return;
    if (!text.trim() && !pending) return;
    const body = text;
    const att = pending;
    setText(''); setPending(null); setBusy(true);
    const res = await send(body, att);
    setBusy(false);
    // Three outcomes, not two. A message held on this phone because there is no
    // signal is not a message that failed: the words are safe, they are marked
    // under the bubble as waiting, and they go on their own. Heading it "Not
    // sent" would tell somebody to type it again.
    if (!res.ok && res.reason) Alert.alert(res.queued ? 'Waiting to send' : 'Not sent', res.reason);
  };
  // The stamp under every bubble. It was a hardcoded English weekday array
  // glued to `${d.getDate()}/${d.getMonth() + 1}` — day-before-month, which a
  // reader in the United States reads the other way round. Both are the
  // reader's own now. See `fmtRelativeDay` in src/lib/format.ts.
  //
  // ── and the half of it that was missing ────────────────────────────────
  //
  // The day, and no hour. Every message sent today read "Today", so a thread
  // with nine messages in it carried nine identical stamps and there was no way
  // to tell the one sent at breakfast from the one sent ten minutes ago. On a
  // chat that matters twice over: "come at 7" needs to be readable as this
  // morning's or last night's, and `deliveryLine` composes this into "Sent
  // Today", which is a claim about delivery with no time on it at all — the
  // header of src/lib/readReceipt.ts has been describing that sentence as
  // "Sent 09:41" since it was written.
  //
  // Both halves are the reader's own locale and both already refuse to invent
  // anything: each returns '—' for a timestamp it cannot read, and a stamp with
  // one unreadable half says only the half it has rather than pairing a real
  // value with a dash.
  const fmt = (iso: string) => {
    const day = fmtRelativeDay(iso);
    const time = fmtTime(iso);
    if (day === '—') return day;
    if (time === '—') return day;
    return `${day} ${time}`;
  };
  const G = layout.gutter;
  const { ref: barRef, lift } = useKeyboardLift();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* ── board page 13's header ─────────────────────────────────────────
          A back chevron, the coach's face, their name over one small line,
          and a chevron at the far end that opens their page. The eyebrow
          that used to sit ABOVE the name ("Your coach") is the line UNDER it
          now, which is where the board draws a status line — and it is the
          only truthful thing to put there: no presence is measured and no
          reply-time is estimated (see the header of this file), so the line
          says who this is, or, for a name that could not be read, why. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
          <Icon name={BACK_ICON} size={20} color={t.ink2} />
        </Pressable>
        {/* The board's chevron: the name and face open Your Coach, which is
            the screen that says what this person can see and how else to
            reach them. One Pressable over both, so the row is one element
            with one spoken name rather than a face and a name announced
            twice. */}
        <Pressable onPress={() => router.push('/(client)/my-coach')} accessibilityRole="button"
          accessibilityLabel={head.isName ? `${head.text}, your coach. Opens their page` : 'Your coach. Opens their page'}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          {/* The face, under the same rule as the name: `peer.avatar` is only
              ever what came back from the read for the COACH's id, so there is no
              input on which this is the reader's own photograph — which is what
              it used to be. With no picture it falls back to their initials, and
              with no name to take initials from it falls back to the same dash
              the header shows, in the same muted ink. */}
          <View style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {peer.avatar
              ? <Image source={{ uri: peer.avatar }} style={{ width: 40, height: 40 }} accessibilityIgnoresInvertColors />
              : <Text style={{ ...ty.label, fontWeight: '600', color: head.isName ? t.brand : t.ink3 }}>{peerMonogram(head)}</Text>}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* `capitalize` is applied only to a real name. A dash needs no
                casing, and the muted ink is what tells you at a glance that the
                line is a placeholder rather than somebody called "—". */}
            <Text style={{ ...ty.head, color: head.isName ? t.ink : t.ink3, textTransform: head.isName ? 'capitalize' : 'none' }} numberOfLines={1}>{head.text}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={2}>{head.note ?? 'Your coach'}</Text>
          </View>
          <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
        </Pressable>
        {/* The way out. In the header rather than buried in a menu, because a
            moderation path somebody has to go looking for is one they use after
            it has already gone wrong. The icon carries no status colour — the
            state is said in words under the composer. */}
        {/* Searching this conversation. Beside the safety control rather than
            above the thread, so the screen still opens to the newest message.
            Closing it clears the query — a field left holding a word the member
            cannot see is a conversation that looks half-missing next time. */}
        <Pressable onPress={() => setSearching((v) => { if (v) setQuery(''); return !v; })}
          accessibilityRole="button" hitSlop={8}
          accessibilityState={{ selected: searching }}
          accessibilityLabel={searching ? 'Stop searching this conversation' : 'Search this conversation'}
          style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: searching ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="search" size={16} color={searching ? t.brandInk : t.ink2} />
        </Pressable>
        <Pressable onPress={onSafety} accessibilityRole="button" hitSlop={8}
          accessibilityLabel={blockActionLabel(safety.state, OTHER)}
          accessibilityHint="Block this conversation, or report a message in it"
          style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" size={16} color={t.ink2} />
        </Pressable>
      </View>
      {/* ── the search field ──────────────────────────────────────────────
          Drawn only while the control above is on. The sentence under it is the
          important half and is never withheld: this screen holds the recent end
          of a conversation that may be much longer, and "no match" said over a
          prefix is a claim about the whole thread. */}
      {searching ? (
        <View style={{ paddingHorizontal: G, paddingTop: sp.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
            <Icon name="search" size={16} color={t.ink3} />
            <TextInput
              value={query} onChangeText={setQuery} autoFocus
              placeholder="Find a word in this conversation" placeholderTextColor={t.ink3}
              autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Find a word in this conversation"
              style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}
                accessibilityRole="button" accessibilityLabel="Clear the search">
                <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
              </Pressable>
            ) : null}
          </View>
          {searchLine ? (
            // A live region, because the thread below changes under the
            // member's thumb as they type and nothing else would tell a screen
            // reader that it had. The label carries the count and says the rest
            // of the conversation is hidden; the visible sentence carries the
            // denominator.
            <Text accessibilityLiveRegion="polite"
              accessibilityLabel={[threadSearchA11y({ query, matched: found.length }), searchLine].filter(Boolean).join(' ')}
              style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{searchLine}</Text>
          ) : null}
        </View>
      ) : null}
      {/* The compose bar is lifted by measurement rather than by
          KeyboardAvoidingView, which under-lifted it by the height of the
          navigator header and left the keyboard sitting over the field you were
          typing into. See `src/ui/keyboardLift.ts` for why. */}
      <View style={{ flex: 1, paddingBottom: lift }}>
        {/* This conversation came off the phone, not off the server. Said
            once, above the thread, because a member reading a cached thread as
            a live one believes they have heard everything — and the message
            that is missing is the one that arrived after the signal went. */}
        {cachedNote ? <Flag tone={t.warn} style={{ paddingHorizontal: G, paddingTop: sp.sm }}>{cachedNote}</Flag> : null}
        <ScrollView ref={scRef} refreshControl={pull} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }}
          onContentSizeChange={() => {
            if (heldPosition.current) { heldPosition.current = false; return; }
            // Results are read from the TOP: the oldest match is as likely to be
            // the one somebody is looking for as the newest, and jumping to the
            // end of a three-row list looks like the screen lost the other two.
            if (searchOn) return;
            scRef.current?.scrollToEnd({ animated: true });
          }}
          // Whether the newest message is actually in front of the reader.
          // Nothing is written from here: this only feeds the clause, and the
          // decision, the debounce and the forward-only rule all live in
          // src/lib/readReceipt.ts.
          onScroll={(e) => setAtEnd(atBottom({
            offsetY: e.nativeEvent.contentOffset.y,
            viewport: e.nativeEvent.layoutMeasurement.height,
            content: e.nativeEvent.contentSize.height,
          }))}
          scrollEventThrottle={64}
          keyboardShouldPersistTaps="handled">
          {/* ── the beginning of the conversation, when it is not on screen ──
              `useThread` reads newest-first at the row cap, so a long coaching
              relationship arrives with its own start missing. That was reported
              as `status: 'partial'` and said nowhere: the word did not appear on
              this screen, and there was no way back to the messages above the
              cut. A member could not read the beginning of their own
              conversation and nothing admitted it.

              Said ABOVE the oldest bubble, which is where the missing part
              actually is, and with the control beside the sentence rather than
              a sentence on its own. */}
          {!searchOn && (hasOlder || status === 'partial') ? (
            <View style={{ marginBottom: sp.lg, gap: sp.sm }}>
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center' }}>
                {hasOlder
                  ? 'This is not the whole conversation. Earlier messages are on the server and not on this screen.'
                  : 'That is the whole conversation.'}
              </Text>
              {hasOlder ? (
                <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                  <Ghost label={loadingOlder ? 'Loading…' : 'Load Earlier Messages'}
                    onPress={() => { if (loadingOlder) return; heldPosition.current = true; void loadOlder(); }} />
                </View>
              ) : null}
              {olderError ? <Flag tone={t.warn}>{olderError}</Flag> : null}
            </View>
          ) : null}
          {/* The results, or the conversation. `found` IS `msgs` when nothing is
              being searched, so there is one list here and no second render
              path that could drift from this one. Deliberately NOT wrapped in
              an `accessible` group: that would collapse every bubble into one
              element and a member using VoiceOver would hear the count instead
              of the messages. The count is announced by the live region above
              the list, which is where a statement about the list belongs. */}
          {found.map((m) => {
            const mine = m.sender === 'client';
            // A bubble the server refused is on this phone and nowhere else.
            // Left unmarked it reads as delivered, which is the belief the send
            // path was fixed to stop creating. The stage says WHICH half went
            // wrong, because "the photo did not upload" is the actionable half.
            // Only the MARK is decided here now; the sentence beside it comes
            // from `receipt.line`, which reads the same `unsent` entry and adds
            // the two states this screen never had.
            const stage = unsent[m.id];
            const hasMedia = m.attachment.state !== 'none' || !!m.local;
            return (
              // A long press on ANY bubble opens the report, and only a bubble
              // that is not this reader's own is worth reporting — reporting
              // yourself is not a thing, and offering it would make the gesture
              // read as something else. Wrapped rather than replacing the View
              // so nothing about how a bubble draws depends on this.
              //
              // ── Why there is an accessibilityAction as well ───────────────
              //
              // The gesture was the ONLY way in. A bubble with `onLongPress`
              // and no `onPress` announces itself as a button, says "Opens the
              // report options for this message" — and then does nothing at all
              // when a VoiceOver user double-taps it, because activation maps
              // to `onPress`. So the one route this app offers for reporting
              // abuse or a message that should not have been sent was closed to
              // exactly the people least able to work around it, while a hint
              // promised it was open. A long press is not available to somebody
              // driving the screen through a screen reader or a switch.
              //
              // `accessibilityActions` is the fix rather than an `onPress`: an
              // ordinary tap on a chat bubble must keep doing nothing, because
              // a report sheet that opens when somebody rests a thumb on a
              // message is its own kind of broken. 'activate' is what a
              // double-tap sends and 'longpress' is what the rotor's long-press
              // action sends; both land here, and both do what the hint says.
              <Pressable key={m.id} disabled={mine}
                onLongPress={() => { setReportNote(''); setReportFor({ open: true, messageId: isLocalId(m.id) ? null : m.id, body: m.body }); }}
                // ── the label is the MESSAGE ────────────────────────────
                //
                // It was 'Report this message'. `Pressable` is accessible by
                // default, so the whole subtree — the attachment, the words the
                // coach wrote and the time — collapsed into one element
                // announcing that label and nothing else. VoiceOver read every
                // incoming bubble as "Report this message, button" while the
                // member's own bubbles, which are not pressable, read fine: a
                // blind member could hear everything they had said and not one
                // word from their coach.
                //
                // The report action is still reachable and is still announced —
                // it is what the HINT and the two accessibility actions below
                // are for, which is where an action belongs. A label names the
                // thing; a hint says what happens if you act on it.
                accessibilityRole={mine ? undefined : 'button'}
                accessibilityLabel={mine ? undefined : [
                  m.attachment.state === 'ok' ? `${attachmentNoun(m.attachment.attachment.kind)} from your coach` : null,
                  m.attachment.state === 'unreadable' ? 'an attachment this app cannot show' : null,
                  m.local ? `${attachmentNoun(m.local.kind)} from your coach` : null,
                  m.body || null,
                  receipt.line(m, fmt(m.createdAt)),
                ].filter(Boolean).join('. ')}
                accessibilityHint={mine ? undefined : 'Opens the report options for this message'}
                accessibilityActions={mine ? undefined : [
                  { name: 'activate', label: 'Report this message' },
                  { name: 'longpress', label: 'Report this message' },
                ]}
                onAccessibilityAction={mine ? undefined : (e) => {
                  if (e.nativeEvent.actionName !== 'activate' && e.nativeEvent.actionName !== 'longpress') return;
                  setReportNote('');
                  setReportFor({ open: true, messageId: isLocalId(m.id) ? null : m.id, body: m.body });
                }}
                style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: sp.md }}>
                {hasMedia ? (
                  <View style={{ marginBottom: m.body ? sp.xs : 0, alignSelf: mine ? 'flex-end' : 'flex-start', overflow: 'hidden', borderRadius: radius.md }}>
                    <Attachment m={m} />
                  </View>
                ) : null}
                {/* A photo needs no caption, and an empty bubble under one is a
                    thing the sender did not say. */}
                {m.body ? (
                  // The board's bubbles: the coach's in the muted surface on
                  // the near side, the member's in the accent on the far side,
                  // each with the corner nearest its sender's edge squared off
                  // so the two sides read as two voices without a name on
                  // every line. `start`/`end`, not left/right — the sides swap
                  // under a right-to-left layout and the tails must swap with
                  // them.
                  <View style={{
                    backgroundColor: mine ? t.brand : t.surface2, borderRadius: radius.md,
                    borderBottomEndRadius: mine ? 4 : radius.md, borderBottomStartRadius: mine ? radius.md : 4,
                    paddingHorizontal: sp.lg, paddingVertical: sp.md,
                  }}>
                    <Text style={{ ...ty.body, color: mine ? t.brandInk : t.ink }}>{m.body}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                  {/* Status colours never colour text — the mark carries it. */}
                  {stage ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
                  {/* One sentence, from one place. The failure wordings are
                      still `unsentNote`'s — `deliveryLine` delegates them — and
                      what is new is that a bubble the server HAS taken now says
                      so ("Sent 09:41"), and says "· Read" once the coach's own
                      watermark has passed it. */}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {receipt.line(m, fmt(m.createdAt))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {/* An empty thread that failed to load is not an empty thread — and an
              empty RESULT is not an empty thread either, which is why this is
              still asked of `msgs`. "No messages yet. Say hello." over a search
              that found nothing would be the screen forgetting its own
              conversation; `searchLine` above owns that case and names the set
              it looked at. */}
          {!searchOn && msgs.length === 0 && status !== 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xxl }}>
              {status === 'error' ? 'We could not load this conversation, so we cannot say whether there are messages in it.' : 'No messages yet. Say hello.'}
            </Text>
          ) : null}
          {/* ── the silence, when it has lasted ─────────────────────────────
              Under the last bubble, because that bubble is what the silence is
              about, and never above the thread where it would be the first
              thing a member reads on opening it.

              Silent for the first day and silent whenever the read cannot
              support the claim — see src/lib/replyWait.ts. The header of this
              screen records the fabricated "usually replies within a few
              hours" being deleted rather than replaced; nothing here replaces
              it. There is no estimate, no promise, and no suggestion that a
              reply is owed. What there is, is how long it has been, whether
              their coach's app has recorded opening it, and the fact that a
              conversation this old is at the top of that app's messages
              list. */}
          {!searchOn && waiting.kind !== 'silent' ? (
            <View style={{ marginTop: sp.xl, paddingHorizontal: sp.md }}>
              <Text style={{ ...ty.caption, color: t.ink2, textAlign: 'center' }}>{waiting.note}</Text>
            </View>
          ) : null}
        </ScrollView>
        {/* What is about to go with the message, and a way to change your mind
            before it does. Nothing is uploaded until Send. */}
        {pending ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingTop: sp.md }}>
            {pending.kind === 'image'
              ? <Image source={{ uri: pending.uri }} style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: t.surface2 }} resizeMode="cover" accessibilityIgnoresInvertColors />
              : <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="video" size={18} color={t.ink3} />
                </View>}
            <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>
              {pending.kind === 'image' ? 'Photo ready to send' : 'Video ready to send'}
            </Text>
            <Pressable onPress={() => setPending(null)} accessibilityRole="button"
              accessibilityLabel={`Remove the ${attachmentNoun(pending.kind)}`} hitSlop={8}>
              <Text style={{ ...ty.caption, color: t.ink3 }}>Remove</Text>
            </Pressable>
          </View>
        ) : null}
        {/* Why the box below will not send. Said in words rather than by a
            greyed-out button with no explanation, and it says the history is
            kept — a member who thinks blocking deleted the conversation has
            lost the evidence they might want to report. Nothing here is drawn
            on an unread state: `blockedComposerNote` returns null for that,
            and the composer stays live, because the server refuses a blocked
            write anyway and gagging somebody nobody blocked is the worse
            error. */}
        {blockNote ? (
          <View style={{ paddingHorizontal: G, paddingTop: sp.md }}>
            <Flag tone={t.warn}>{blockNote}</Flag>
          </View>
        ) : null}
        {/* ── what did not go, and the words it was ─────────────────────────
            One notice per refused message, because each one carries different
            words and a person may want to send one again and not the other.
            The body is selectable: this is the only copy of it left anywhere,
            and Dismiss is the only thing that removes it — nothing expires
            these, because nothing else will ever raise them again. */}
        {refusedHere.map((r) => (
          <View key={r.id} style={{ paddingHorizontal: G, paddingTop: sp.md }}>
            <Notice
              tone={t.crit}
              kicker="Not delivered"
              title="This message was refused"
              note={refusedBodyNote(r, now.getTime())}
            >
              {r.body.trim() ? (
                <Text selectable style={{ ...ty.body, color: t.ink, marginTop: sp.md }}>{r.body}</Text>
              ) : null}
              <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                <Ghost label="Dismiss" onPress={() => refusedRecord.forget(r.id)}
                  a11yLabel="Dismiss this refused message. The words will not be kept." />
              </View>
            </Notice>
          </View>
        ))}
        {/* ── the board's composer ─────────────────────────────────────────
            One pill holding the field and the camera at its end, and a round
            accent button beside it with a glyph rather than the word "Send".
            The glyph is the forward chevron, mirrored for a right-to-left
            layout by `FORWARD_ICON`, and the button keeps its spoken name and
            its busy/disabled state — a spinner replaces the glyph while a send
            is in flight, which is what "Sending…" used to say. */}
        <View ref={barRef} style={{ flexDirection: 'row', gap: sp.sm, paddingHorizontal: G, paddingVertical: sp.md, backgroundColor: t.bg, alignItems: 'center' }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderRadius: radius.pill, paddingStart: sp.lg, paddingEnd: sp.xs, opacity: canSend ? 1 : 0.6 }}>
            <TextInput value={text} onChangeText={setText} editable={canSend}
              placeholder={canSend ? 'Type a message…' : 'This conversation is closed'} placeholderTextColor={t.ink3}
              accessibilityLabel={canSend ? 'Message your coach' : 'This conversation is closed'}
              style={{ flex: 1, minWidth: 0, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
            <Pressable onPress={onAttach} accessibilityRole="button" accessibilityLabel="Add a photo or video" hitSlop={4}
              style={{ width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={18} color={t.ink2} />
            </Pressable>
          </View>
          {/* Disabled while a send is in flight: tapping twice would put the
              same photo in the bucket twice and the thread twice with it. And
              disabled on a thread this device KNOWS is blocked — not to enforce
              anything (the database does that) but so nobody writes a message,
              taps Send, and reads an alert instead of a bubble. */}
          <Pressable onPress={onSend} disabled={busy || !canSend} accessibilityRole="button" accessibilityLabel="Send message"
            accessibilityState={{ disabled: busy || !canSend, busy }}
            style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center', opacity: busy || !canSend ? 0.5 : 1 }}>
            {busy
              ? <ActivityIndicator size="small" color={t.brandInk} />
              : <Icon name={FORWARD_ICON} size={20} color={t.brandInk} strokeWidth={2.5} />}
          </Pressable>
        </View>
      </View>

      {/* ── the report sheet ────────────────────────────────────────────────
          A sheet rather than an alert, because every option carries a sentence
          saying what it covers and an alert cannot show one. Nothing here asks
          the member to characterise what happened in legal terms, and the note
          is optional: requiring an explanation puts a writing task in front of
          the person least able to do one at that moment. */}
      <Modal visible={!!reportFor} transparent animationType="slide" onRequestClose={() => setReportFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setReportFor(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.title, color: t.ink }}>
              {reportFor?.messageId ? 'Report this message' : 'Report this conversation'}
            </Text>

            {/* ── the way out of the app for a message's words ──────────────
                Above the report, because it is by far the likelier reason
                somebody held their thumb on a message their coach wrote, and
                because burying it under four categories of abuse would read as
                this app thinking they are the same kind of thing. Drawn only
                on a bubble that HAS words: a photograph has nothing to put on a
                clipboard, and a row offering to copy one would do nothing. */}
            {reportFor?.body ? (
              <View style={{ marginTop: sp.md }}>
                <Pressable onPress={() => { void copyMessage(reportFor.body); }}
                  accessibilityRole="button" accessibilityLabel="Copy this message"
                  accessibilityHint="Puts the words of this message on your clipboard"
                  style={{ paddingVertical: sp.md }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Copy this message</Text>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>
                    Puts the words on your clipboard. Nothing is reported and nobody is told.
                  </Text>
                </Pressable>
                <Rule />
              </View>
            ) : null}

            {/* What a report does and does not do — including the sentence that
                matters most, which is that a report is not a block. */}
            <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm, marginBottom: sp.lg }}>{REPORT_EXPLAINER}</Text>

            {REPORT_OPTIONS.map((o, i) => (
              <View key={o.id}>
                {i > 0 ? <Rule /> : null}
                <Pressable onPress={() => { void fileReport(o.id); }} disabled={reportBusy}
                  accessibilityRole="button" accessibilityLabel={o.label} accessibilityHint={o.note}
                  accessibilityState={{ disabled: reportBusy }}
                  style={{ paddingVertical: sp.md, opacity: reportBusy ? 0.5 : 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{o.label}</Text>
                  <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>{o.note}</Text>
                </Pressable>
              </View>
            ))}

            <Rule />
            <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg, marginBottom: sp.sm }}>Anything you want to add</Text>
            <TextInput value={reportNote} onChangeText={setReportNote} multiline editable={!reportBusy}
              placeholder="Optional. Nobody but us reads this." placeholderTextColor={t.ink3}
              style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md, minHeight: 64, textAlignVertical: 'top' }} />

            <Pressable onPress={() => setReportFor(null)} accessibilityRole="button"
              accessibilityLabel="Close without reporting anything"
              style={{ paddingVertical: sp.lg, alignItems: 'center' }}>
              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
