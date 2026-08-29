// Client · Messages — the thread with your coach (Supabase-backed, realtime).
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero and no cards — the bubbles are the content, so
// they keep the ink and the chrome recedes to a hairline.
//
// Fabrication removed: the header claimed your coach "usually replies within a
// few hours". No reply-time is measured anywhere, so the claim is gone rather
// than replaced.
import { useRef } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule } from '../../src/ui/kit';
import { sp, layout, radius, type as ty } from '../../src/theme/scale';
import { useCoachProfile } from '../../src/ui/coachProfile';
import { useThread } from '../../src/ui/messaging';

export default function Messages() {
  const t = useTheme();
  const router = useRouter();
  const coach = useCoachProfile();
  const { messages: msgs, send } = useThread(null, 'client');
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
          <Text style={{ ...ty.head, color: t.ink, marginTop: 2, textTransform: 'capitalize' }} numberOfLines={1}>{coach.name || 'Your coach'}</Text>
        </View>
      </View>
      <Rule />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scRef} contentContainerStyle={{ paddingHorizontal: G, paddingTop: sp.lg, paddingBottom: sp.sm }} onContentSizeChange={() => scRef.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
          {msgs.map((m) => {
            const mine = m.sender === 'client';
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: sp.md }}>
                <View style={{ backgroundColor: mine ? t.brand : t.surface2, borderRadius: radius.md, paddingHorizontal: sp.md, paddingVertical: sp.sm + 2 }}>
                  <Text style={{ ...ty.body, color: mine ? t.brandInk : t.ink }}>{m.body}</Text>
                </View>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>{fmt(m.createdAt)}</Text>
              </View>
            );
          })}
          {msgs.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xxl }}>No messages yet. Say hello.</Text>
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
