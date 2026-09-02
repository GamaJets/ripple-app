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
import { useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Flag, Ghost } from '../../src/ui/kit';
import { useKeyboardLift } from '../../src/ui/keyboardLift';
import { HAS_NATIVE_VIDEO, UPDATE_REQUIRED_NOTE } from '../../src/ui/nativeModules';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { peerHeading } from '../../src/lib/threadPeer';
import { peerMonogram } from '../../src/lib/peerAvatar';
import { fmtRelativeDay } from '../../src/lib/format';
import { attachmentNoun, unsentNote } from '../../src/lib/messageAttachments';
import {
  blockActionLabel, blockConfirm, blockedComposerNote, canSendInto, unblockConfirm,
  reportFiledLine, REPORT_EXPLAINER, REPORT_OPTIONS, type ReportCategory,
} from '../../src/lib/threadSafety';
import {
  useThread, useThreadPeerName, useAttachmentUrl, pickMessageAttachment, useThreadSafety,
  type AttachSource, type PendingAttachment, type ThreadMessage,
} from '../../src/ui/messaging';

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
          <View style={{ position: 'absolute', right: sp.sm, bottom: sp.sm }}>
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
  const { messages: msgs, send, status, unsent, cachedNote, hasOlder, loadingOlder, olderError, loadOlder } = useThread(null, 'client');
  // The block and the report. Its state is deliberately allowed to be stale or
  // unread: the database refuses a blocked write regardless, so being wrong
  // here costs a sentence rather than the protection. See src/lib/threadSafety.
  const safety = useThreadSafety(null, 'client');
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  // Which message is being reported, or null for the conversation as a whole.
  // `open` is separate from the id because reporting the conversation is a
  // legitimate report with no message on it — the abuse was the sum of it, or
  // the message has already been deleted by the person who sent it.
  const [reportFor, setReportFor] = useState<{ open: true; messageId: string | null } | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const scRef = useRef<ScrollView>(null);
  // Set for exactly one content-size change: the one caused by a page of older
  // messages arriving. Without it the `scrollToEnd` below fires on the growth
  // and throws the reader back to the bottom of the thread they just stepped
  // out of — the newest messages, which is the half they were not reading.
  const heldPosition = useRef(false);
  // "your coach" rather than their name, and everywhere on this surface. A name
  // that could not be read renders as a dash, and a dash as the subject of
  // "— will not be able to send you messages" reads as the screen having broken
  // at the exact moment somebody needs to trust it (scripts/check-prose.mjs).
  const OTHER = 'your coach';
  const blockNote = blockedComposerNote(safety.state, OTHER);
  const canSend = canSendInto(safety.state);

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
  const fmt = (iso: string) => fmtRelativeDay(iso);
  const G = layout.gutter;
  const { ref: barRef, lift } = useKeyboardLift();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
          <Icon name="back" size={20} color={t.ink2} />
        </Pressable>
        {/* The face, under the same rule as the name: `peer.avatar` is only
            ever what came back from the read for the COACH's id, so there is no
            input on which this is the reader's own photograph — which is what
            it used to be. With no picture it falls back to their initials, and
            with no name to take initials from it falls back to the same dash
            the header shows, in the same muted ink. */}
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {peer.avatar
            ? <Image source={{ uri: peer.avatar }} style={{ width: 38, height: 38 }} accessibilityIgnoresInvertColors />
            : <Text style={{ ...ty.label, fontWeight: '600', color: head.isName ? t.brand : t.ink3 }}>{peerMonogram(head)}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Your coach</Text>
          {/* `capitalize` is applied only to a real name. A dash needs no
              casing, and the muted ink is what tells you at a glance that the
              line is a placeholder rather than somebody called "—". */}
          <Text style={{ ...ty.head, color: head.isName ? t.ink : t.ink3, marginTop: 2, textTransform: head.isName ? 'capitalize' : 'none' }} numberOfLines={1}>{head.text}</Text>
          {head.note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={2}>{head.note}</Text> : null}
        </View>
        {/* The way out. In the header rather than buried in a menu, because a
            moderation path somebody has to go looking for is one they use after
            it has already gone wrong. The icon carries no status colour — the
            state is said in words under the composer. */}
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
        {/* This conversation came off the phone, not off the server. Said
            once, above the thread, because a member reading a cached thread as
            a live one believes they have heard everything — and the message
            that is missing is the one that arrived after the signal went. */}
        {cachedNote ? <Flag tone={t.warn} style={{ paddingHorizontal: G, paddingTop: sp.sm }}>{cachedNote}</Flag> : null}
        <ScrollView ref={scRef} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }}
          onContentSizeChange={() => {
            if (heldPosition.current) { heldPosition.current = false; return; }
            scRef.current?.scrollToEnd({ animated: true });
          }}
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
          {msgs.map((m) => {
            const mine = m.sender === 'client';
            // A bubble the server refused is on this phone and nowhere else.
            // Left unmarked it reads as delivered, which is the belief the send
            // path was fixed to stop creating. The stage says WHICH half went
            // wrong, because "the photo did not upload" is the actionable half.
            const stage = unsent[m.id];
            const kind = m.local?.kind ?? (m.attachment.state === 'ok' ? m.attachment.attachment.kind : null);
            const hasMedia = m.attachment.state !== 'none' || !!m.local;
            return (
              // A long press on ANY bubble opens the report, and only a bubble
              // that is not this reader's own is worth reporting — reporting
              // yourself is not a thing, and offering it would make the gesture
              // read as something else. Wrapped rather than replacing the View
              // so nothing about how a bubble draws depends on this.
              <Pressable key={m.id} disabled={mine}
                onLongPress={() => { setReportNote(''); setReportFor({ open: true, messageId: m.id.startsWith('local-') ? null : m.id }); }}
                accessibilityRole={mine ? undefined : 'button'}
                accessibilityLabel={mine ? undefined : 'Report this message'}
                accessibilityHint={mine ? undefined : 'Opens the report options for this message'}
                style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: sp.md }}>
                {hasMedia ? (
                  <View style={{ marginBottom: m.body ? sp.xs : 0, alignSelf: mine ? 'flex-end' : 'flex-start', overflow: 'hidden', borderRadius: radius.md }}>
                    <Attachment m={m} />
                  </View>
                ) : null}
                {/* A photo needs no caption, and an empty bubble under one is a
                    thing the sender did not say. */}
                {m.body ? (
                  <View style={{ backgroundColor: mine ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                    <Text style={{ ...ty.body, color: mine ? t.brandInk : t.ink }}>{m.body}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                  {/* Status colours never colour text — the mark carries it. */}
                  {stage ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {stage ? unsentNote('your coach', stage, kind) : m.sending ? 'Sending…' : fmt(m.createdAt)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {/* An empty thread that failed to load is not an empty thread. */}
          {msgs.length === 0 && status !== 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xxl }}>
              {status === 'error' ? 'We could not load this conversation, so we cannot say whether there are messages in it.' : 'No messages yet. Say hello.'}
            </Text>
          ) : null}
        </ScrollView>
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
        <View ref={barRef} style={{ flexDirection: 'row', gap: sp.sm, paddingHorizontal: G, paddingVertical: sp.md, backgroundColor: t.bg, alignItems: 'center' }}>
          <Pressable onPress={onAttach} accessibilityRole="button" accessibilityLabel="Add a photo or video" hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={18} color={t.ink2} />
          </Pressable>
          <TextInput value={text} onChangeText={setText} editable={canSend}
            placeholder={canSend ? 'Message your coach…' : 'This conversation is closed'} placeholderTextColor={t.ink3}
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md, opacity: canSend ? 1 : 0.6 }} />
          {/* Disabled while a send is in flight: tapping twice would put the
              same photo in the bucket twice and the thread twice with it. And
              disabled on a thread this device KNOWS is blocked — not to enforce
              anything (the database does that) but so nobody writes a message,
              taps Send, and reads an alert instead of a bubble. */}
          <Pressable onPress={onSend} disabled={busy || !canSend} accessibilityRole="button" accessibilityLabel="Send message"
            accessibilityState={{ disabled: busy || !canSend }}
            style={{ backgroundColor: t.brand, borderRadius: radius.md, paddingHorizontal: sp.lg, justifyContent: 'center', opacity: busy || !canSend ? 0.5 : 1 }}>
            <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{busy ? 'Sending…' : 'Send'}</Text>
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
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setReportFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, padding: G, paddingBottom: sp.xxl, maxHeight: '88%', ...elevation.e2 }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <Text style={{ ...ty.title, color: t.ink }}>
              {reportFor?.messageId ? 'Report this message' : 'Report this conversation'}
            </Text>
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
