// Client · Classes. Pick a branch and browse the gym's group-class schedule, then
// book or cancel. Full classes offer a waitlist; cancelling frees your seat.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClasses } from '../../src/ui/classes';
import type { GymClass } from '../../src/lib/classesMock';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timeLabel = (iso: string) => { const d = new Date(iso); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
const dayLabel = (iso: string) => { const d = new Date(iso); const t = new Date(); const tm = new Date(); tm.setDate(t.getDate() + 1); if (d.toDateString() === t.toDateString()) return 'Today'; if (d.toDateString() === tm.toDateString()) return 'Tomorrow'; return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

export default function Classes() {
  const t = useTheme();
  const router = useRouter();
  const { classes, myStatus, book, cancel } = useClasses();
  const [branch, setBranch] = useState<string | null>(null);

  const branches = useMemo(() => Array.from(new Set(classes.map((c) => c.branch).filter(Boolean))).sort(), [classes]);
  const filtered = useMemo(() => classes.filter((c) => branch === null || c.branch === branch), [classes, branch]);

  const byDay = useMemo(() => {
    const groups: { key: string; label: string; items: GymClass[] }[] = [];
    const map = new Map<string, GymClass[]>();
    for (const c of [...filtered].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
      const k = new Date(c.startsAt).toDateString();
      if (!map.has(k)) { map.set(k, []); groups.push({ key: k, label: dayLabel(c.startsAt), items: map.get(k)! }); }
      map.get(k)!.push(c);
    }
    return groups;
  }, [filtered]);

  const onBook = async (c: GymClass) => {
    const st = await book(c.id);
    if (st === 'waitlist') Alert.alert('Added to waitlist', `${c.title} is full — you're on the waitlist and we'll move you up if a spot opens.`);
    else Alert.alert('Booked', `You're in for ${c.title} at ${c.branch}, ${dayLabel(c.startsAt)} ${timeLabel(c.startsAt)}.`);
  };
  const onCancel = (c: GymClass) => {
    Alert.alert('Cancel booking?', `${c.title} · ${c.branch} · ${dayLabel(c.startsAt)} ${timeLabel(c.startsAt)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: () => cancel(c.id) },
    ]);
  };

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, backgroundColor: active ? t.brand : t.surface2, borderWidth: 1, borderColor: active ? t.brand : t.ring }}>
      <Text style={{ color: active ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Classes</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 14, fontSize: 14 }}>Pick your location and book a spot. Full classes have a waitlist.</Text>

        {branches.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
            {chip('All branches', branch === null, () => setBranch(null))}
            {branches.map((b) => chip(b, branch === b, () => setBranch(b === branch ? null : b)))}
          </ScrollView>
        ) : null}

        {byDay.map((g) => (
          <View key={g.key} style={{ marginBottom: 18 }}>
            <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 9 }}>{g.label}</Text>
            {g.items.map((c) => {
              const mine = myStatus[c.id];
              const spotsLeft = Math.max(0, c.capacity - c.booked);
              const full = spotsLeft === 0;
              return (
                <View key={c.id} style={{ backgroundColor: t.surface, borderColor: mine ? t.brand : t.ring, borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <View style={{ backgroundColor: t.surface2, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: t.brand, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 }}>{c.kind}</Text></View>
                    <Text style={{ color: t.ink3, fontSize: 12, fontWeight: '700' }}>{timeLabel(c.startsAt)} · {c.durationMin}m</Text>
                  </View>
                  <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{c.title}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 2 }}>{c.instructor} · {c.branch}{c.room ? ' · ' + c.room : ''}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                    <Text style={{ color: full ? t.s3 : t.ink3, fontSize: 12, fontWeight: '700' }}>{mine === 'waitlist' ? 'On the waitlist' : full ? 'Class full' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}</Text>
                    {mine ? (
                      <Pressable onPress={() => onCancel(c)} accessibilityRole="button" accessibilityLabel={'Cancel ' + c.title} style={{ backgroundColor: t.surface2, borderWidth: 1, borderColor: t.ring, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 9 }}><Text style={{ color: t.ink2, fontWeight: '800', fontSize: 13 }}>{mine === 'waitlist' ? 'Leave waitlist' : 'Cancel'}</Text></Pressable>
                    ) : (
                      <Pressable onPress={() => onBook(c)} accessibilityRole="button" accessibilityLabel={'Book ' + c.title} style={{ backgroundColor: t.brand, borderRadius: 11, paddingHorizontal: 20, paddingVertical: 9 }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 13 }}>{full ? 'Join waitlist' : 'Book'}</Text></Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
        {filtered.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 30 }}>No classes scheduled{branch ? ' at ' + branch : ''} yet. Check back soon.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
