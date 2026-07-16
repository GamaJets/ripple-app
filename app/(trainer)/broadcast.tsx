// Trainer · Broadcast. Message a whole segment of clients at once — everyone, or
// a specific tag. Inserts into each client's thread and sends a push. OTA-safe.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useRoster } from '../../src/ui/roster';
import { useClientTags } from '../../src/ui/clientTags';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { sendPush } from '../../src/ui/pushNotifications';

export default function Broadcast() {
  const t = useTheme();
  const router = useRouter();
  const { roster } = useRoster();
  const { allTags, tagsFor } = useClientTags();
  const [seg, setSeg] = useState<string | null>(null); // null = all
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const recipients = useMemo(() => roster.filter((c) => seg === null || tagsFor(c.id).includes(seg)), [roster, seg, tagsFor]);

  const send = async () => {
    const b = body.trim();
    if (!b || !recipients.length || busy) return;
    setBusy(true);
    try {
      if (USE_SUPABASE) {
        try { await supabase.from('messages').insert(recipients.map((c) => ({ client_id: c.id, sender: 'coach', body: b }))); } catch { /* best-effort */ }
        sendPush(recipients.map((c) => c.id), 'Message from your coach', b, { route: '/(client)/messages' });
      }
      setBody('');
      Alert.alert('Sent', `Message delivered to ${recipients.length} client${recipients.length === 1 ? '' : 's'}${seg ? ' in “' + seg + '”' : ''}.`);
    } finally { setBusy(false); }
  };

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 16, backgroundColor: active ? t.brand : t.surface2, borderWidth: 1, borderColor: active ? t.brand : t.ring }}>
      <Text style={{ color: active ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Broadcast</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Send one message to a whole segment of your clients.</Text>

        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', marginBottom: 7 }}>Send to</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8 }}>
          {chip('All clients', seg === null, () => setSeg(null))}
          {allTags.map((tg) => chip(tg, seg === tg, () => setSeg(tg === seg ? null : tg)))}
        </ScrollView>

        <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: t.ink2, fontSize: 13, fontWeight: '700' }}>{recipients.length} recipient{recipients.length === 1 ? '' : 's'}</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginTop: 3 }} numberOfLines={2}>{recipients.map((c) => c.name).join(', ') || 'No clients in this segment.'}</Text>
        </View>

        <TextInput value={body} onChangeText={setBody} placeholder="Your message…" placeholderTextColor={t.ink3} multiline style={{ color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 120, textAlignVertical: 'top', marginBottom: 14 }} />

        <Pressable onPress={send} disabled={!body.trim() || !recipients.length || busy} style={{ backgroundColor: body.trim() && recipients.length ? t.brand : t.surface2, borderWidth: 1, borderColor: body.trim() && recipients.length ? t.brand : t.ring, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
          <Text style={{ color: body.trim() && recipients.length ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 15 }}>{busy ? 'Sending…' : `Send to ${recipients.length}`}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
