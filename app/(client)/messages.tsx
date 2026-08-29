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
// `useThreadPeerName`. A client cannot usually read their coach's profile row —
// no policy on `profiles` runs client → coach — so the honest answer here is
// often a dash with the reason beside it, and that is what it draws.
//
// While the header was being made truthful, two things the thread hook has long
// exposed and this screen ignored were connected: `status`, so a thread that
// failed to load stops saying "No messages yet", and `unsent`, so a bubble the
// server refused stops looking exactly like a delivered one.
import { useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { peerHeading } from '../../src/lib/threadPeer';
import { useThread, useThreadPeerName } from '../../src/ui/messaging';

export default function Messages() {
  const t = useTheme();
  const router = useRouter();
  const peer = useThreadPeerName('client', null);
  const head = peerHeading(peer, 'coach');
  const { messages: msgs, send, status, unsent } = useThread(null, 'client');
  const [text, setText] = useState('');
  const scRef = useRef<ScrollView>(null);
  const onSend = () => { if (!text.trim()) return; send(text); setText(''); };
  const fmt = (iso: string) => { const d = new Date(iso); const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
  const G = layout.gutter;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8}>
          <Icon name="back" size={20} color={t.ink2} />
        </Pressable>
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scRef} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} onContentSizeChange={() => scRef.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
          {msgs.map((m) => {
            const mine = m.sender === 'client';
            // A bubble the server refused is on this phone and nowhere else.
            // Left unmarked it reads as delivered, which is the belief the send
            // path was fixed to stop creating.
            const failed = unsent.includes(m.id);
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: sp.md }}>
                <View style={{ backgroundColor: mine ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                  <Text style={{ ...ty.body, color: mine ? t.brandInk : t.ink }}>{m.body}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                  {/* Status colours never colour text — the mark carries it. */}
                  {failed ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} /> : null}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{failed ? 'Not sent — your coach cannot see this' : fmt(m.createdAt)}</Text>
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
        <View style={{ flexDirection: 'row', gap: sp.sm, paddingHorizontal: G, paddingVertical: sp.md, backgroundColor: t.bg }}>
          <TextInput value={text} onChangeText={setText} placeholder="Message your coach…" placeholderTextColor={t.ink3}
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
          <Pressable onPress={onSend} accessibilityRole="button" accessibilityLabel="Send message"
            style={{ backgroundColor: t.brand, borderRadius: radius.md, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
            <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
