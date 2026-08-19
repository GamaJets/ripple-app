// Coach-side chat with one client. Thread keyed by the client's id (passed as a
// route param). Real-time + optimistic via the shared useThread hook.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). No hero and no cards — a chat screen's content is the
// conversation, so the bubbles carry the ink (sent on the brand, received on
// surface2, one radius, no borders) and the chrome recedes to a hairline. Same
// thread hook, same params, same empty state, same send.
import { useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useThread } from '../../src/ui/messaging';

export default function CoachChat() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const clientId = typeof params.clientId === 'string' ? params.clientId : null;
  const name = typeof params.name === 'string' ? params.name : 'Client';
  const { messages: msgs, send } = useThread(clientId, 'coach');
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
          <Text style={{ ...ty.head, color: t.ink, textTransform: 'capitalize' }}>{name}</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>Coaching chat</Text>
        </View>
      </View>
      <Rule />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* ── the conversation ───────────────────────────────────────────── */}
        <ScrollView ref={scRef} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} onContentSizeChange={() => scRef.current?.scrollToEnd({ animated: true })}>
          {msgs.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: sp.huge }}>
              <Text style={{ ...ty.label, color: t.ink3 }}>No messages yet — say hi to {name.split(' ')[0]}.</Text>
            </View>
          ) : null}
          {msgs.map((m) => {
            const mine = m.sender === 'coach';
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: sp.md }}>
                <View style={{ backgroundColor: mine ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                  <Text style={{ ...ty.body, color: mine ? t.brandInk : t.ink }}>{m.body}</Text>
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>{fmt(m.createdAt)}</Text>
              </View>
            );
          })}
        </ScrollView>

        {/* ── composer ───────────────────────────────────────────────────── */}
        <Rule />
        <View style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: G, paddingVertical: sp.md, alignItems: 'flex-end' }}>
          <TextInput value={text} onChangeText={setText} placeholder={'Message ' + name + '…'} placeholderTextColor={t.ink3}
            style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.md, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
          <Cta label="Send" onPress={onSend} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
