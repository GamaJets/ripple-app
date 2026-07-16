// Client · My bookings. One place for everything the member has booked — group
// classes and personal-training sessions — in chronological order, with cancel.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClasses } from '../../src/ui/classes';
import { useSessions } from '../../src/ui/sessions';
import { useCoachProfile } from '../../src/ui/coachProfile';

const CLIENT_ID = 'c1';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timeLabel = (iso: string) => { const d = new Date(iso); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
const dayLabel = (iso: string) => { const d = new Date(iso); const t = new Date(); const tm = new Date(); tm.setDate(t.getDate() + 1); if (d.toDateString() === t.toDateString()) return 'Today'; if (d.toDateString() === tm.toDateString()) return 'Tomorrow'; return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

type Item = { id: string; kind: 'class' | 'pt'; title: string; sub: string; startsAt: string; waitlist?: boolean; onCancel: () => void };

export default function Bookings() {
  const t = useTheme();
  const router = useRouter();
  const { classes, myStatus, cancel: cancelClass } = useClasses();
  const { sessions, releaseSession } = useSessions();
  const coach = useCoachProfile();

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const c of classes) {
      const st = myStatus[c.id];
      if (st && Date.parse(c.startsAt) > Date.now() - 3600_000) {
        out.push({ id: 'c' + c.id, kind: 'class', title: c.title, sub: `${c.kind} · ${c.branch}${c.room ? ' · ' + c.room : ''}`, startsAt: c.startsAt, waitlist: st === 'waitlist', onCancel: () => cancelClass(c.id) });
      }
    }
    for (const s of sessions) {
      if (s.clientId === CLIENT_ID && s.status === 'booked' && Date.parse(s.startsAt) > Date.now() - 3600_000) {
        out.push({ id: 'p' + s.id, kind: 'pt', title: `PT with ${coach.name}`, sub: `${s.durationMin} min session`, startsAt: s.startsAt, onCancel: () => releaseSession(s.id) });
      }
    }
    return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }, [classes, myStatus, sessions, coach.name]);

  const confirmCancel = (it: Item) => {
    Alert.alert('Cancel this booking?', `${it.title} · ${dayLabel(it.startsAt)} ${timeLabel(it.startsAt)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: it.onCancel },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>My bookings</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Your upcoming classes and personal-training sessions, all in one place.</Text>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <Pressable onPress={() => router.push('/(client)/classes')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: t.brand, borderRadius: 12, paddingVertical: 12 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>+ Book a class</Text></Pressable>
          <Pressable onPress={() => router.push('/(client)/calendar')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 12, paddingVertical: 12 }}><Text style={{ color: t.ink, fontWeight: '800', fontSize: 13 }}>+ Book PT</Text></Pressable>
        </View>

        {items.map((it) => (
          <View key={it.id} style={{ backgroundColor: t.surface, borderColor: it.waitlist ? t.s3 : t.ring, borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <View style={{ backgroundColor: it.kind === 'pt' ? 'rgba(91,157,255,0.16)' : t.surface2, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: it.kind === 'pt' ? t.s1 : t.brand, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 }}>{it.kind === 'pt' ? 'Personal training' : 'Class'}</Text></View>
              <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>{dayLabel(it.startsAt)} · {timeLabel(it.startsAt)}</Text>
              {it.waitlist ? <Text style={{ color: t.s3, fontSize: 11, fontWeight: '800', marginLeft: 'auto' }}>Waitlist</Text> : null}
            </View>
            <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{it.title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ color: t.ink3, fontSize: 12.5 }}>{it.sub}</Text>
              <Pressable onPress={() => confirmCancel(it)} accessibilityRole="button" accessibilityLabel={'Cancel ' + it.title} style={{ backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 }}><Text style={{ color: t.ink2, fontWeight: '800', fontSize: 12.5 }}>{it.waitlist ? 'Leave' : 'Cancel'}</Text></Pressable>
            </View>
          </View>
        ))}
        {items.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 30 }}>No upcoming bookings. Book a class or a PT session to get started.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
