// Trainer · Schedule — week of sessions, availability & block-out time.
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { MOCK_SESSIONS } from '../../src/lib/mockData';
import { ROSTER } from '../../src/lib/trainerMock';
import type { TrainingSession } from '../../src/lib/types';

function fmt(iso: string) {
  const d = new Date(iso); const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} · ${h}${ap}`;
}
const nameOf = (id: string | null) => ROSTER.find((c) => c.id === id)?.name ?? 'Open';

export default function TrainerSchedule() {
  const t = useTheme();
  const [sessions, setSessions] = useState<TrainingSession[]>(JSON.parse(JSON.stringify(MOCK_SESSIONS)));
  const sorted = [...sessions].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const booked = sorted.filter((s) => s.status === 'booked');
  const block = () => Alert.alert('Block out time', 'In the full app you pick a date & time range to mark yourself unavailable. Clients can’t book blocked time.', [{ text: 'OK' }]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', textTransform: 'capitalize' }}>Schedule</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16 }}>Your in-person sessions this week</Text>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: t.brand, borderRadius: 16, padding: 14 }}>
            <Text style={{ color: t.brandInk, fontSize: 12, fontWeight: '700', opacity: 0.8 }}>Booked</Text>
            <Text style={{ color: t.brandInk, fontSize: 22, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 }}>{booked.length}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.ring, padding: 14 }}>
            <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>Open slots</Text>
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 }}>{sorted.filter((s) => s.status === 'available').length}</Text>
          </View>
          <Pressable onPress={block} style={{ flex: 1, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 14, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontSize: 20 }}>🚫</Text>
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '700', marginTop: 4 }}>Block time</Text>
          </Pressable>
        </View>

        <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16, textTransform: 'capitalize', marginBottom: 10 }}>Upcoming</Text>
        {sorted.map((s) => (
          <View key={s.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 8, height: 40, borderRadius: 4, backgroundColor: s.status === 'booked' ? t.brand : t.surface3 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{fmt(s.startsAt)}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 1 }}>{s.durationMin} min · {s.status === 'booked' ? nameOf(s.clientId) : (s.released ? 'Open (re-offered)' : 'Open')}</Text>
            </View>
            <Text style={{ color: s.status === 'booked' ? t.brand : t.ink3, fontWeight: '700', fontSize: 12 }}>{s.status === 'booked' ? 'Confirmed' : 'Available'}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
