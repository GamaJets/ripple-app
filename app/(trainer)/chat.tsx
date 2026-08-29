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
import { useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { peerHeading, type PeerHeading } from '../../src/lib/threadPeer';
import { useThread, useThreadPeerName } from '../../src/ui/messaging';

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
  const scRef = useRef<ScrollView>(null);
  const onSend = () => { if (!text.trim()) return; send(text); setText(''); };
  const fmt = (iso: string) => { const d = new Date(iso); const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
  const G = layout.gutter;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>

      {/* ── header ───────────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
        <Ghost icon="back" onPress={() => router.back()} />
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
            // Local-only: the insert was refused, so the client cannot see it.
            const failed = unsent.includes(m.id);
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: sp.md }}>
                <View style={{ backgroundColor: mine ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                  <Text style={{ ...ty.body, color: mine ? t.brandInk : t.ink }}>{m.body}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                  {/* Status colours never colour text — the mark carries it. */}
                  {failed ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{failed ? 'Not sent — they cannot see this' : fmt(m.createdAt)}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {/* ── composer ───────────────────────────────────────────────────── */}
        <Rule />
        <View style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md, alignItems: 'flex-end' }}>
          <TextInput value={text} onChangeText={setText} placeholder={firstName ? 'Message ' + firstName + '…' : 'Message your client…'} placeholderTextColor={t.ink3}
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
          <Cta label="Send" onPress={onSend} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
