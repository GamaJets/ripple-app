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
import { useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, Image, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Cta, Ghost } from '../../src/ui/kit';
import { HAS_NATIVE_VIDEO, UPDATE_REQUIRED_NOTE } from '../../src/ui/nativeModules';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { peerHeading, type PeerHeading } from '../../src/lib/threadPeer';
import { peerMonogram } from '../../src/lib/peerAvatar';
import { attachmentNoun, unsentNote } from '../../src/lib/messageAttachments';
import {
  useThread, useThreadPeerName, useAttachmentUrl, pickMessageAttachment,
  type AttachSource, type PendingAttachment, type ThreadMessage,
} from '../../src/ui/messaging';

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
          <View style={{ position: 'absolute', right: sp.sm, bottom: sp.sm }}>
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
  const { messages: msgs, send, status, unsent } = useThread(clientId, 'coach');
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
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>

      {/* ── header ───────────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
        <Ghost icon="back" onPress={() => router.back()} />
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
      </View>
      <Rule />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* ── the conversation ───────────────────────────────────────────── */}
        <ScrollView ref={scRef} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} onContentSizeChange={() => scRef.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
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
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {stage ? unsentNote(firstName ?? 'they', stage, kind) : m.sending ? 'Sending…' : fmt(m.createdAt)}
                  </Text>
                </View>
              </View>
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
        <View style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md, alignItems: 'center' }}>
          <Pressable onPress={onAttach} accessibilityRole="button" accessibilityLabel="Add a photo or video" hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={18} color={t.ink2} />
          </Pressable>
          <TextInput value={text} onChangeText={setText} placeholder={firstName ? 'Message ' + firstName + '…' : 'Message your client…'} placeholderTextColor={t.ink3}
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
          {/* Disabled while a send is in flight: tapping twice would put the
              same clip in the bucket twice and the thread twice with it. */}
          <Cta label={busy ? 'Sending…' : 'Send'} onPress={onSend} disabled={busy} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
