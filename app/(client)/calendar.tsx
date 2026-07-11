// Book — in-person session booking with 24h cancellation fee (demo data).
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { MOCK_SESSIONS, MOCK_TRAINER } from '../../src/lib/mockData';
import type { TrainingSession } from '../../src/lib/types';

const CLIENT_ID = 'c1';
const fee = MOCK_TRAINER.sessionFee;

function fmt(iso: string) {
  const d = new Date(iso);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} · ${h}${ap}`;
}

export default function Calendar() {
  const t = useTheme();
  const router = useRouter();
  const [sessions, setSessions] = useState<TrainingSession[]>(JSON.parse(JSON.stringify(MOCK_SESSIONS)));

  const mine = sessions.filter((s) => s.clientId === CLIENT_ID && s.status === 'booked').sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const open = sessions.filter((s) => s.status === 'available').sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const book = (id: string) => setSessions(sessions.map((s) => (s.id === id ? { ...s, status: 'booked', clientId: CLIENT_ID, released: false } : s)));
  const cancel = (s: TrainingSession) => {
    const late = Date.parse(s.startsAt) - Date.now() < 24 * 3600 * 1000;
    const doCancel = () => setSessions(sessions.map((x) => (x.id === s.id ? { ...x, status: 'available', clientId: null, released: true } : x)));
    if (late) Alert.alert('Within 24 hours', `Cancelling now charges the $${fee} late-cancellation fee, and the slot is offered to other clients. Continue?`, [{ text: 'Keep it', style: 'cancel' }, { text: `Cancel · $${fee}`, style: 'destructive', onPress: doCancel }]);
    else Alert.alert('Cancel session?', 'This is more than 24h away, so no fee. The slot re-opens for others.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel', onPress: doCancel }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.push('/(client)/dashboard')} style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Home</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Book sessions</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>In-person training with {MOCK_TRAINER.name} · cancel 24h+ ahead to avoid the ${fee} fee</Text>

        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginBottom: 8 }}>Your upcoming</Text>
        {mine.length === 0 ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: t.ink3 }}>Nothing booked yet — grab an open slot below.</Text>
          </View>
        ) : mine.map((s) => (
          <View key={s.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{fmt(s.startsAt)}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{s.durationMin} min · confirmed</Text>
            </View>
            <Pressable onPress={() => cancel(s)} style={{ backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ color: t.s6, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
            </Pressable>
          </View>
        ))}

        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, marginTop: 8, marginBottom: 8 }}>Open slots</Text>
        {open.length === 0 ? (
          <Text style={{ color: t.ink3 }}>No open slots right now — check back soon.</Text>
        ) : open.map((s) => (
          <View key={s.id} style={{ backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{fmt(s.startsAt)}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{s.durationMin} min{s.released ? ' · just opened up' : ''}</Text>
            </View>
            <Pressable onPress={() => book(s.id)} style={{ backgroundColor: t.brand, borderRadius: 9, paddingHorizontal: 18, paddingVertical: 9 }}>
              <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>Book</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
