// Coach-side chat with one client. Thread keyed by the client's id (passed as a
// route param). Real-time + optimistic via the shared useThread hook.
import { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
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
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: t.ring }}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: 6 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', textTransform: 'capitalize' }}>{name}</Text>
        <Text style={{ color: t.ink3, fontSize: 12 }}>Coaching chat</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scRef} contentContainerStyle={{ padding: 16 }} onContentSizeChange={() => scRef.current?.scrollToEnd({ animated: true })}>
          {msgs.map((m) => {
            const mine = m.sender === 'coach';
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 10 }}>
                <View style={{ backgroundColor: mine ? t.brand : t.surface, borderColor: t.ring, borderWidth: mine ? 0 : 1, borderRadius: 16, borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4, paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Text style={{ color: mine ? t.brandInk : t.ink, fontSize: 14, lineHeight: 20 }}>{m.body}</Text>
                </View>
                <Text style={{ color: t.ink3, fontSize: 10, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>{fmt(m.createdAt)}</Text>
              </View>
            );
          })}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: t.ring, backgroundColor: t.surface }}>
          <TextInput value={text} onChangeText={setText} placeholder={'Message ' + name + '…'} placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 }} />
          <Pressable onPress={onSend} style={{ backgroundColor: t.brand, borderRadius: 22, paddingHorizontal: 18, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Send</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
