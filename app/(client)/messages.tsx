import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { MOCK_MESSAGES, MOCK_TRAINER } from '../../src/lib/mockData';
import type { Message } from '../../src/lib/types';

export default function Messages() {
  const t = useTheme();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Message[]>([...MOCK_MESSAGES]);
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    setMsgs([...msgs, { id: 'm' + Date.now(), clientId: 'c1', sender: 'client', body: text.trim(), createdAt: new Date().toISOString() }]);
    setText('');
  };
  const fmt = (iso: string) => { const d = new Date(iso); const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: t.ring }}>
        <Pressable onPress={() => router.push('/(client)/dashboard')} style={{ marginBottom: 6 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Home</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>{MOCK_TRAINER.name}</Text>
        <Text style={{ color: t.ink3, fontSize: 12 }}>Your coach · usually replies within a few hours</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {msgs.map((m) => {
            const mine = m.sender === 'client';
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
          <TextInput value={text} onChangeText={setText} placeholder="Message your coach…" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 }} />
          <Pressable onPress={send} style={{ backgroundColor: t.brand, borderRadius: 22, paddingHorizontal: 18, justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800' }}>Send</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
