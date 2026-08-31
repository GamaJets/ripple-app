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
import { useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule } from '../../src/ui/kit';
import { useKeyboardLift } from '../../src/ui/keyboardLift';
import { HAS_NATIVE_VIDEO, UPDATE_REQUIRED_NOTE } from '../../src/ui/nativeModules';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { peerHeading } from '../../src/lib/threadPeer';
import { peerMonogram } from '../../src/lib/peerAvatar';
import { attachmentNoun, unsentNote } from '../../src/lib/messageAttachments';
import {
  useThread, useThreadPeerName, useAttachmentUrl, pickMessageAttachment,
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
  const { messages: msgs, send, status, unsent } = useThread(null, 'client');
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const scRef = useRef<ScrollView>(null);

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
  const onSend = async () => {
    if (busy) return;
    if (!text.trim() && !pending) return;
    const body = text;
    const att = pending;
    setText(''); setPending(null); setBusy(true);
    const res = await send(body, att);
    setBusy(false);
    if (!res.ok && res.reason) Alert.alert('Not sent', res.reason);
  };
  const fmt = (iso: string) => { const d = new Date(iso); const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
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
      </View>
      <Rule />
      {/* The compose bar is lifted by measurement rather than by
          KeyboardAvoidingView, which under-lifted it by the height of the
          navigator header and left the keyboard sitting over the field you were
          typing into. See `src/ui/keyboardLift.ts` for why. */}
      <View style={{ flex: 1, paddingBottom: lift }}>
        <ScrollView ref={scRef} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} onContentSizeChange={() => scRef.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
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
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: sp.md }}>
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
              </View>
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
        <View ref={barRef} style={{ flexDirection: 'row', gap: sp.sm, paddingHorizontal: G, paddingVertical: sp.md, backgroundColor: t.bg, alignItems: 'center' }}>
          <Pressable onPress={onAttach} accessibilityRole="button" accessibilityLabel="Add a photo or video" hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={18} color={t.ink2} />
          </Pressable>
          <TextInput value={text} onChangeText={setText} placeholder="Message your coach…" placeholderTextColor={t.ink3}
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
          {/* Disabled while a send is in flight: tapping twice would put the
              same photo in the bucket twice and the thread twice with it. */}
          <Pressable onPress={onSend} disabled={busy} accessibilityRole="button" accessibilityLabel="Send message"
            accessibilityState={{ disabled: busy }}
            style={{ backgroundColor: t.brand, borderRadius: radius.md, paddingHorizontal: sp.lg, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
            <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>{busy ? 'Sending…' : 'Send'}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
