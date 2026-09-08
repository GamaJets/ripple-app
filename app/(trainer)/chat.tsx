// Coach-side chat with one client. Thread keyed by the client's id (passed as a
// route param). Real-time + optimistic via the shared useThread hook.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero and no cards — a chat screen's content is the
// conversation, so the bubbles carry the ink (sent on the brand, received on
// surface2, one radius, no borders) and the chrome recedes to a hairline. Same
// thread hook, same params, same empty state, same send.
//
// ── TF-32, this side of it ─────────────────────────────────────────────────
//
// The client's Messages header was named from the reader's own profile; the
// coach's was named from a route param that defaulted to the literal string
// 'Client'. That default only ever showed on one path, and it was the path
// where it did most harm: the push notification's route carried no clientId, so
// a coach who tapped "New message from your client" landed on a thread headed
// "Client", holding nothing, whose replies went nowhere. The route now carries
// the key (src/ui/messaging.ts), and when a name still does not arrive with it
// the header resolves the client's own — or says it could not, rather than
// labelling a real conversation with a category noun.
//
// ── The clip of the third rep ──────────────────────────────────────────────
//
// A message can now carry one photo or one short video, and the coach half of
// that is mostly the second case: a form check sent back with the cue on it,
// recorded here and capped at half a minute. It goes to a private bucket only
// this coach and this client can read (supabase/parts/124) and is read back
// through a short-lived signed URL — so an ex-coach loses the photographs with
// the thread, exactly as they lose the messages.
//
// The bubble keeps sending, not-sent and unreadable apart for the reason the
// client screen gives at length: a coach who thinks their demonstration went is
// worse off than one who knows it did not.
import { useCallback, useRef, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, TextInput, ScrollView, Image, Pressable, Alert, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Cta, Ghost, Flag } from '../../src/ui/kit';
import { useKeyboardLift } from '../../src/ui/keyboardLift';
import { HAS_NATIVE_VIDEO, UPDATE_REQUIRED_NOTE } from '../../src/ui/nativeModules';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { peerHeading, type PeerHeading } from '../../src/lib/threadPeer';
import { peerMonogram } from '../../src/lib/peerAvatar';
import { attachmentNoun } from '../../src/lib/messageAttachments';
import { fmtRelativeDay } from '../../src/lib/format';
import { atBottom } from '../../src/lib/readReceipt';
import { useReadReceipt } from '../../src/ui/readReceipts';
import { useMyTemplates } from '../../src/ui/messageTemplates';
import {
  applyTemplate, orderTemplates, templatesEmptyLine, hasUnfilledToken,
  UNFILLED_TOKEN_NOTE,
} from '../../src/lib/messageTemplates';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import {
  useThread, useThreadPeerName, useAttachmentUrl, pickMessageAttachment, useThreadSafety,
  type AttachSource, type PendingAttachment, type ThreadMessage,
} from '../../src/ui/messaging';
import {
  blockActionLabel, blockConfirm, blockedComposerNote, canSendInto, unblockConfirm,
  reportFiledLine, REPORT_EXPLAINER, REPORT_OPTIONS, type ReportCategory,
} from '../../src/lib/threadSafety';
import { BACK_ICON } from '../../src/ui/direction';

/** The clip itself, in its own component so the player hook receives a settled
 *  URL — a signature arrives asynchronously and a hook cannot wait for one. */
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
 * No branch renders nothing. A message whose attachment quietly disappears
 * reads as a message that was never sent, and on this side that means a coach
 * re-recording a demonstration their client already has, or worse, assuming one
 * arrived that did not.
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

  if (m.attachment.state === 'unreadable') return note(m.attachment.why);

  // The file is on this phone: on its way up, delivered (the row landed and
  // points at this same file), or refused. Drawn from here in all three cases,
  // because it is what the coach is already looking at — but only the caption
  // changes with the state, and none of them says "sent" for a bubble that is
  // not.
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
  if (!url) return note(`This ${attachmentNoun(stored.kind)} could not be loaded.`);

  if (stored.kind === 'image') {
    return <Image source={{ uri: url }} style={box} resizeMode="cover" accessibilityIgnoresInvertColors
      accessibilityLabel="Photo in this conversation" />;
  }
  // An install made before expo-video was added has this screen and not the
  // player, and would otherwise draw a black rectangle with nothing to read.
  if (!HAS_NATIVE_VIDEO) return note(UPDATE_REQUIRED_NOTE);
  return <Clip uri={url} label="Video in this conversation" />;
}

export default function CoachChat() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const clientId = typeof params.clientId === 'string' ? params.clientId : null;
  // The roster passes the name it has already read, and that is the better
  // source — so the lookup below is given no id to chase on that path, and does
  // no work. It is only for arrivals that carry a key but no name, which is the
  // notification tap.
  const routeName = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : null;
  const peer = useThreadPeerName('coach', routeName ? null : clientId);
  const head: PeerHeading = routeName ? { text: routeName, note: null, isName: true } : peerHeading(peer, 'client');
  // Used where a sentence needs to address them. Falls back to the role word
  // rather than to a dash mid-sentence — "say hi to —" is not a sentence.
  const firstName = head.isName ? head.text.split(' ').filter(Boolean)[0] : null;
  // `hasOlder`, `loadingOlder`, `olderError` and `loadOlder` were on the hook
  // and taken by the client's copy of this screen alone. `useThread` reads
  // newest-first at the row cap, so a long coaching relationship arrives with
  // its own start missing — reported as `status: 'partial'` and said NOWHERE on
  // the coach's side, which has only 'loading' and 'error' branches, so a
  // truncated thread rendered as a complete one.
  //
  // The coach is the one who needs the history: a client scrolls back to find
  // what they were told, and a coach scrolls back to find what they promised
  // and to read it out to somebody disputing it.
  const {
    messages: msgs, send, status, unsent, cachedNote, reload: reloadThread, threadId,
    hasOlder, loadingOlder, olderError, loadOlder,
  } = useThread(clientId, 'coach');
  /* ── the way out ───────────────────────────────────────────────────────
   *
   * The database has supported blocking and reporting in BOTH directions since
   * supabase/parts/240 — `report_abuse` derives the reported party from the
   * thread and reads 'coach' as readily as 'client'. Only the client app had
   * controls, which left a coach being harassed by a client with a working
   * mechanism and no button. The two sides are the same screen to the person
   * using them, so this mirrors `app/(client)/messages.tsx` rather than
   * inventing a second shape for it.
   *
   * The word for the other party is 'this client' and not their name: a coach
   * blocking somebody does not need the name they are about to stop reading
   * spelled out in the confirm, and `head.text` is a dash when the read failed.
   */
  const safety = useThreadSafety(clientId, 'coach');
  const OTHER = 'this client';
  const blockNote = blockedComposerNote(safety.state, OTHER);
  const canSend = canSendInto(safety.state);
  const [reportFor, setReportFor] = useState<{ open: true; messageId: string | null } | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const scRef = useRef<ScrollView>(null);
  /** Set just before older messages are asked for, so the content growing at the
   *  TOP does not throw the coach back to the bottom of the thread. */
  const heldPosition = useRef(false);
  /**
   * The end of the conversation is on screen.
   *
   * One of the four clauses of "what counts as read" (src/lib/readReceipt.ts),
   * and on this screen it is the load-bearing one twice over: this chat is a
   * `Tabs.Screen` with `href: null` and no `unmountOnBlur`, so it stays mounted
   * — scrolled wherever the coach left it — behind everything they open next.
   * True to begin with because `onContentSizeChange` scrolls a freshly loaded
   * thread to its end, and corrected by the first real scroll event.
   */
  const [atEnd, setAtEnd] = useState(true);
  /**
   * What each of the coach's own bubbles may claim, and the write that tells
   * the client their messages have been read.
   *
   * The failure sentences are unchanged — `deliveryLine` delegates them back to
   * `unsentNote`, which is why this screen no longer imports it — and the two
   * new states are "Sent Mon 1/9" for a row the server has, and "· Read" once
   * the client's own watermark has passed it.
   */
  const receipt = useReadReceipt({ threadId, role: 'coach', messages: msgs, unsent, atEnd, them: firstName ?? 'they' });

  const attach = async (source: AttachSource) => {
    const { attachment, error } = await pickMessageAttachment(source);
    // A cancel carries neither, and must raise nothing at anybody.
    if (error) { Alert.alert('That file cannot be sent', error); return; }
    if (attachment) setPending(attachment);
  };

  const onAttach = () => {
    Alert.alert('Add to your message', `Only ${firstName ?? 'your client'} will be able to see this.`, [
      { text: 'Take a photo', onPress: () => { attach('photo'); } },
      { text: 'Record a form check', onPress: () => { attach('video'); } },
      { text: 'Choose from your library', onPress: () => { attach('library'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // The box empties on the way out, as it always has. The failure is not
  // swallowed with it: a send that did not go says so here as well as leaving
  // the bubble marked, because a coach who believes a demonstration arrived
  // will not send it again.
  const onSafety = () => {
    const blocked = safety.state === 'blocked-by-me';
    const c = blocked ? unblockConfirm(OTHER) : blockConfirm(OTHER);
    Alert.alert(c.title, c.body, [
      { text: 'Not Now', style: 'cancel' },
      {
        text: blocked ? 'Unblock' : 'Block',
        style: blocked ? 'default' : 'destructive',
        onPress: async () => {
          const r = blocked ? await safety.unblock() : await safety.block();
          if (!r.ok) { Alert.alert(blocked ? 'Not unblocked' : 'Not blocked', r.error ?? 'That did not save.'); return; }
          Alert.alert(
            blocked ? 'Unblocked' : 'Blocked',
            blocked
              ? 'They can message you again. Any report you made stays on record.'
              : 'Nothing more can be sent either way. Everything already here is kept, so you can still read it and still report it.',
          );
        },
      },
    ]);
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
  /* ── the six messages a coach types every week ─────────────────────────
   *
   * The library lands text IN THE COMPOSER and does not send. That is the same
   * rule src/lib/nudge.ts holds for AI drafts and supabase/parts/140 holds in
   * the database — a message is never composed under somebody else's name, and
   * a message the coach did not read before it went is exactly that.
   *
   * `{name}` is filled from the name this screen already resolved for its own
   * header, so a template used from a thread whose peer name did not load comes
   * out with the token still visible rather than with a blank where somebody's
   * name should be. `hasUnfilledToken` says so under the box.
   *
   * Appended rather than replacing what is typed: a coach who has half-written
   * a message and then reaches for a template is adding to it, and silently
   * discarding their words would be the one thing this feature must not do.
   */
  const templates = useMyTemplates();
  const { name: coachName } = useMyTrainerProfile();
  const [tplOpen, setTplOpen] = useState(false);
  const useTemplate = (body: string) => {
    const filled = applyTemplate(body, firstName ?? null, coachName ?? null);
    setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${filled}` : filled));
    setTplOpen(false);
  };

  // The stamp under every bubble, and the sister screen's already. This was a
  // hardcoded English weekday array glued to `${d.getDate()}/${d.getMonth() + 1}`
  // — a day name in a language the coach may not read, over a date that is
  // 9 December here and 12 September in the United States. It is the same
  // wording, on the same message, as the one the CLIENT sees under their copy
  // of it (app/(client)/messages.tsx), so the two disagreeing about which day a
  // message was sent on is a disagreement inside one conversation.
  //
  // `fmtRelativeDay` is that screen's answer and is now this one's: the reader's
  // own language, the reader's own date order, and "Today"/"Tomorrow" which
  // neither hand-rolled copy ever managed.
  const fmt = (iso: string) => fmtRelativeDay(iso);
  const G = layout.gutter;
  const { ref: barRef, lift } = useKeyboardLift();

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * This began "There is no realtime subscription on a thread", which is the
   * same false sentence app/(client)/messages.tsx carried and is wrong about
   * the same code: `useThread` opens `.channel('msg:' + cid)` and appends
   * INSERTs on `messages` for this thread (src/ui/messaging.ts). Both screens
   * mount that hook, so both have had live updates for as long as it has.
   *
   * The subscription is BEST-EFFORT, and that is what earns this control. It is
   * opened inside a try/catch marked "realtime optional", so a project without
   * the publication, a network that will not open a websocket, or a socket lost
   * while the phone slept leaves the thread looking live and quietly frozen —
   * and a coach waiting for an answer, looking straight at the conversation, is
   * the one person nothing would then tell.
   *
   * The block state goes with it: it is written from the other side too, and a
   * composer enabled against a stale answer is a message sent into a thread
   * that will refuse it. The saved templates come along because they are the
   * other thing this screen puts into the box.
   *
   * What is typed is untouched. `reload` re-reads the thread; it does not go
   * near the composer. */
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    Promise.resolve(reloadThread()), Promise.resolve(safety.reload()),
    Promise.resolve(templates.reload()),
  ]), [reloadThread, safety, templates]));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>

      {/* ── header ───────────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
        <Ghost icon={BACK_ICON} onPress={() => router.back()} />
        {/* The client's face, read for the CLIENT's id via
            `profiles_trainer_read` and from nowhere else. On the roster path the
            hook is handed no id and does no work, so there is nothing to draw
            and the monogram is taken from the name the roster passed — never
            from the coach's own profile, which is the readable one on this app
            and therefore the one TF-32 would have reached for. */}
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {peer.avatar
            ? <Image source={{ uri: peer.avatar }} style={{ width: 38, height: 38 }} accessibilityIgnoresInvertColors />
            : <Text style={{ ...ty.label, fontWeight: '600', color: head.isName ? t.brand : t.ink3 }}>{peerMonogram(head)}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          {/* Casing and full ink are for a real name only; a dash gets neither,
              so the header never dresses a placeholder up as a person. */}
          <Text style={{ ...ty.head, color: head.isName ? t.ink : t.ink3, textTransform: head.isName ? 'capitalize' : 'none' }} numberOfLines={1}>{head.text}</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>{head.note ?? 'Coaching chat'}</Text>
        </View>
        {/* In the header rather than buried in a menu, for the same reason it is
            in the client's: a moderation path somebody has to go looking for is
            one they reach for after it has already gone wrong. The icon carries
            no status colour — the state is said in words under the composer. */}
        <Pressable onPress={onSafety} accessibilityRole="button" hitSlop={8}
          accessibilityLabel={blockActionLabel(safety.state, OTHER)}
          accessibilityHint="Block this conversation, or report a message in it"
          style={{ width: 34, height: 34, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" size={16} color={t.ink2} />
        </Pressable>
      </View>
      <Rule />

      {/* The compose bar is lifted by measurement rather than by
          KeyboardAvoidingView, which under-lifted it by the height of the
          navigator header and left the keyboard sitting over the field you were
          typing into. See `src/ui/keyboardLift.ts` for why. */}
      <View style={{ flex: 1, paddingBottom: lift }}>

        {/* ── the conversation ───────────────────────────────────────────── */}
        {/* This conversation came off the phone, not off the server. Said
            once, above the thread, because a member reading a cached thread as
            a live one believes they have heard everything — and the message
            that is missing is the one that arrived after the signal went. */}
        {cachedNote ? <Flag tone={t.warn} style={{ paddingHorizontal: G, paddingTop: sp.sm }}>{cachedNote}</Flag> : null}
        <ScrollView ref={scRef} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }}
          // Jumping to the end is right for a new message and exactly wrong for
          // older ones: a coach who asked for the start of the conversation and
          // was thrown back to the bottom of it has not been given the history.
          onContentSizeChange={() => {
            if (heldPosition.current) { heldPosition.current = false; return; }
            scRef.current?.scrollToEnd({ animated: true });
          }}
          keyboardShouldPersistTaps="handled" refreshControl={pull}
          // Feeds the "scrolled to the end" clause and nothing else; the
          // decision, the debounce and the forward-only rule are all in
          // src/lib/readReceipt.ts.
          onScroll={(e) => setAtEnd(atBottom({
            offsetY: e.nativeEvent.contentOffset.y,
            viewport: e.nativeEvent.layoutMeasurement.height,
            content: e.nativeEvent.contentSize.height,
          }))}
          scrollEventThrottle={64}>
          {/* ── the beginning of the conversation, when it is not on screen ──
              Said ABOVE the oldest bubble, which is where the missing part
              actually is, and with the control beside the sentence rather than
              a sentence on its own. The same shape app/(client)/messages.tsx
              has had since the paging was built. */}
          {hasOlder || status === 'partial' ? (
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
          {/* A thread that failed to load has not been read, so it cannot be
              reported as one nobody has written in. */}
          {msgs.length === 0 && status !== 'loading' ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
              <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center' }}>
                {status === 'error'
                  ? 'We could not load this conversation, so we cannot say whether there are messages in it.'
                  : clientId
                    ? `No messages yet — say hi${firstName ? ' to ' + firstName : ''}.`
                    : 'This screen was opened without a client, so there is no thread to show.'}
              </Text>
            </View>
          ) : null}
          {msgs.map((m) => {
            const mine = m.sender === 'coach';
            // Local-only: the upload or the insert was refused, so the client
            // cannot see it. The stage says which, because "the video did not
            // upload" is the half a coach can do something about.
            // Only the MARK is decided here now. The sentence beside it comes
            // from `receipt.line`, which reads the same `unsent` entry.
            const stage = unsent[m.id];
            const hasMedia = m.attachment.state !== 'none' || !!m.local;
            return (
              <Pressable key={m.id}
                onLongPress={() => { if (safety.threadId) setReportFor({ open: true, messageId: m.id }); }}
                delayLongPress={400}
                accessibilityRole="button"
                accessibilityLabel={mine ? 'Your message' : 'Their message'}
                accessibilityHint="Press and hold to report this message"
                style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: sp.md }}>
                {hasMedia ? (
                  <View style={{ marginBottom: m.body ? sp.xs : 0, alignSelf: mine ? 'flex-end' : 'flex-start', overflow: 'hidden', borderRadius: radius.md }}>
                    <Attachment m={m} />
                  </View>
                ) : null}
                {/* A clip needs no caption, and an empty bubble under one is a
                    thing the sender did not say. */}
                {m.body ? (
                  <View style={{ backgroundColor: mine ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                    <Text style={{ ...ty.body, color: mine ? t.brandInk : t.ink }}>{m.body}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                  {/* Status colours never colour text — the mark carries it. */}
                  {stage ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
                  {/* One sentence, from one place: the failures still worded by
                      `unsentNote`, plus the confirmation this screen never made
                      out loud and the receipt it could not express at all. */}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {receipt.line(m, fmt(m.createdAt))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── composer ───────────────────────────────────────────────────── */}
        <Rule />
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
        {/* Said under the box and only when it is true: the template still has
            a placeholder in it, which means the name it needed was not known
            and this text goes to the client exactly as it reads. */}
        {hasUnfilledToken(text) ? (
          <View style={{ paddingHorizontal: G, paddingTop: sp.sm }}>
            <Text style={{ ...ty.caption, color: t.ink2 }}>{UNFILLED_TOKEN_NOTE}</Text>
          </View>
        ) : null}
        <View ref={barRef} style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md, alignItems: 'center' }}>
          <Pressable onPress={onAttach} accessibilityRole="button" accessibilityLabel="Add a photo or video" hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={18} color={t.ink2} />
          </Pressable>
          <Pressable onPress={() => setTplOpen(true)} accessibilityRole="button" accessibilityLabel="Use a saved message" hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="pencil" size={18} color={t.ink2} />
          </Pressable>
          <TextInput value={text} onChangeText={setText} editable={canSend}
            placeholder={canSend ? (firstName ? 'Message ' + firstName + '…' : 'Message your client…') : 'This conversation is closed'}
            placeholderTextColor={t.ink3}
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md, opacity: canSend ? 1 : 0.6 }} />
          {/* Disabled while a send is in flight: tapping twice would put the
              same clip in the bucket twice and the thread twice with it. And
              disabled while blocked — the database refuses the write either
              way, so leaving it live would only turn a closed conversation into
              an error message. */}
          <Cta label={busy ? 'Sending…' : 'Send'} onPress={onSend} disabled={busy || !canSend} />
        </View>
        {/* The state, in words, under the box. `blockedComposerNote` returns
            null for an unread state rather than guessing: a coach who has not
            blocked anybody must not be told they have. */}
        {blockNote ? <Flag tone={t.warn} style={{ paddingHorizontal: G, paddingBottom: sp.md }}>{blockNote}</Flag> : null}
      </View>

      {/* ── the saved messages ───────────────────────────────────────────
          A picker and nothing more. Editing them lives on the Documents screen
          rather than here: a coach standing in front of a client wants the
          message, and an editor inside a chat is where somebody edits a
          template by accident while meaning to edit the message. */}
      <Modal visible={tplOpen} transparent animationType="slide" onRequestClose={() => setTplOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setTplOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 30, maxHeight: '70%' }}>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.sm }}>Saved Messages</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>
            Tapping one puts it in your box, with {firstName ? firstName + '’s' : 'the'} name filled in. Nothing is sent until you press Send.
          </Text>
          <ScrollView>
            {templates.rows.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>{templatesEmptyLine(templates.status)}</Text>
            ) : orderTemplates(templates.rows).map((tpl, i) => (
              <Pressable key={tpl.id ?? tpl.title} onPress={() => useTemplate(tpl.body)}
                accessibilityRole="button" accessibilityLabel={`Use the ${tpl.title} message`}
                style={{ paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.ring }}>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{tpl.title}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={2}>
                  {applyTemplate(tpl.body, firstName ?? null, coachName ?? null)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ height: sp.md }} />
          <Ghost label="Manage Your Messages" onPress={() => { setTplOpen(false); router.push('/(trainer)/templates-messages'); }} />
          <View style={{ height: sp.sm }} />
          <Cta label="Close" wide onPress={() => setTplOpen(false)} />
        </View>
      </Modal>
      {/* Reporting is its own sheet rather than an Alert, because the list of
          reasons is the part that has to be readable and the note underneath
          is optional: requiring an explanation puts a writing task in front of
          the person least able to do one at that moment. */}
      <Modal visible={!!reportFor} transparent animationType="slide" onRequestClose={() => setReportFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setReportFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.title, color: t.ink }}>
              {reportFor?.messageId ? 'Report this message' : 'Report this conversation'}
            </Text>
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
