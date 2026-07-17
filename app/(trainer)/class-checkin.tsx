// Trainer · Class check-in. Tap each member as they arrive; the checked-in count
// is what the trainer is paid on (per-attendee rate) and feeds payroll + the owner's
// class analytics. Backend RPCs when live; a demo roster otherwise.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { tapLight } from '../../src/ui/haptics';
import { classRoster, setAttendance, type RosterMember } from '../../src/lib/classAttendance';

export default function ClassCheckin() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string; branch?: string }>();
  const classId = String(params.id || 'demo');
  const title = String(params.title || 'Class');
  const branch = String(params.branch || '');

  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState('25'); // per-attendee pay, AED

  useEffect(() => { let on = true; classRoster(classId).then((r) => { if (on) { setRoster(r); setLoading(false); } }); return () => { on = false; }; }, [classId]);

  const present = useMemo(() => roster.filter((m) => m.attended).length, [roster]);
  const booked = useMemo(() => roster.filter((m) => m.status === 'booked').length, [roster]);
  const pay = Math.round((parseFloat(rate) || 0) * present);

  const toggle = (m: RosterMember) => {
    const next = !m.attended;
    setRoster((p) => p.map((x) => (x.userId === m.userId ? { ...x, attended: next } : x)));
    tapLight();
    setAttendance(classId, m.userId, next);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={8}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        </View>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Check-in</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>{title}{branch ? ' · ' + branch : ''}</Text>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 14 }}>
            <Text style={{ color: t.ink3, fontSize: 11.5 }}>Checked in</Text>
            <Text style={{ color: t.brand, fontSize: 24, fontWeight: '800', marginTop: 4 }}>{present}<Text style={{ color: t.ink3, fontSize: 14 }}> / {booked}</Text></Text>
          </View>
          <View style={{ flex: 1, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 14 }}>
            <Text style={{ color: t.ink3, fontSize: 11.5 }}>You'll be paid</Text>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800', marginTop: 4 }}>AED {pay}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Text style={{ color: t.ink3, fontSize: 13 }}>Rate per attendee</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 }}>
            <Text style={{ color: t.ink3, fontSize: 14 }}>AED</Text>
            <TextInput value={rate} onChangeText={setRate} keyboardType="numeric" style={{ color: t.ink, paddingVertical: 9, fontSize: 15, minWidth: 44 }} />
          </View>
        </View>

        {loading ? (
          <Text style={{ color: t.ink3, fontSize: 13 }}>Loading roster…</Text>
        ) : (
          roster.map((m) => (
            <Pressable key={m.userId} onPress={() => toggle(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderColor: m.attended ? t.brand : t.ring, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 9 }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: m.attended ? t.brand : t.ring, backgroundColor: m.attended ? t.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {m.attended ? <Icon name="check" size={15} color={t.brandInk} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{m.name}</Text>
                <Text style={{ color: m.status === 'waitlist' ? t.warn : t.ink3, fontSize: 12 }}>{m.status === 'waitlist' ? 'Waitlist' : m.attended ? 'Present' : 'Booked · tap when they arrive'}</Text>
              </View>
            </Pressable>
          ))
        )}

        <Text style={{ color: t.ink3, fontSize: 11.5, lineHeight: 17, marginTop: 12 }}>Check-ins are saved as you tap. Your gym owner sees attendance per class for payroll and class analytics.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
