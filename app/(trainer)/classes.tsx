// Trainer/Gym · Classes. Create and manage group classes across branches. Shows
// each upcoming class with its live booked/capacity, and a form to add a new one.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClasses } from '../../src/ui/classes';
import { CLASS_KINDS, BRANCHES, type GymClass } from '../../src/lib/classesMock';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timeLabel = (iso: string) => { const d = new Date(iso); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
const dayShort = (iso: string) => { const d = new Date(iso); const t = new Date(); if (d.toDateString() === t.toDateString()) return 'Today'; return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

export default function TrainerClasses() {
  const t = useTheme();
  const router = useRouter();
  const { classes, addClass } = useClasses();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>(CLASS_KINDS[0]);
  const [branch, setBranch] = useState<string>(BRANCHES[0]);
  const [room, setRoom] = useState('');
  const [instructor, setInstructor] = useState('');
  const [dayOff, setDayOff] = useState(0);
  const [hour, setHour] = useState(18);
  const [dur, setDur] = useState(45);
  const [cap, setCap] = useState(16);
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);

  const upcoming = useMemo(() => [...classes].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)), [classes]);

  const startIso = () => { const d = new Date(); d.setDate(d.getDate() + dayOff); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  const canAdd = title.trim().length > 0;
  const submit = async () => {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      const base = new Date(startIso());
      for (let w = 0; w < weeks; w++) { const d = new Date(base.getTime() + w * 7 * 86400000); await addClass({ title: title.trim(), kind, instructor: instructor.trim() || 'Coach', branch, room: room.trim(), startsAt: d.toISOString(), durationMin: dur, capacity: cap }); }
      setTitle(''); setRoom('');
      Alert.alert(weeks > 1 ? 'Classes added' : 'Class added', weeks > 1 ? `${weeks} weekly ${title.trim()} classes at ${branch}, starting ${dayShort(startIso())} ${timeLabel(startIso())}.` : `${title.trim()} · ${branch} · ${dayShort(startIso())} ${timeLabel(startIso())}`);
    } finally { setBusy(false); }
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 } as const;
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: active ? t.brand : t.surface2, borderWidth: 1, borderColor: active ? t.brand : t.ring }}>
      <Text style={{ color: active ? t.brandInk : t.ink2, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
  const stepper = (label: string, val: string, dec: () => void, inc: () => void) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.ink3, fontSize: 11, marginBottom: 5 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10 }}>
        <Pressable onPress={dec} hitSlop={8} style={{ paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: t.brand, fontWeight: '900', fontSize: 16 }}>−</Text></Pressable>
        <Text style={{ flex: 1, textAlign: 'center', color: t.ink, fontWeight: '800', fontSize: 14 }}>{val}</Text>
        <Pressable onPress={inc} hitSlop={8} style={{ paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: t.brand, fontWeight: '900', fontSize: 16 }}>+</Text></Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Classes</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Schedule group classes across your branches. Members book and waitlist automatically.</Text>

        <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 20 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, marginBottom: 12 }}>New class</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="Class title — e.g. Sunrise CrossFit" placeholderTextColor={t.ink3} style={[inp, { marginBottom: 10 }]} />
          <Text style={{ color: t.ink3, fontSize: 11, marginBottom: 6 }}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 7 }}>{CLASS_KINDS.map((k) => chip(k, kind === k, () => setKind(k)))}</ScrollView>
          <Text style={{ color: t.ink3, fontSize: 11, marginBottom: 6 }}>Branch</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 7 }}>{BRANCHES.map((b) => chip(b, branch === b, () => setBranch(b)))}</ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <TextInput value={instructor} onChangeText={setInstructor} placeholder="Instructor" placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} />
            <TextInput value={room} onChangeText={setRoom} placeholder="Room (optional)" placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} />
          </View>
          <Text style={{ color: t.ink3, fontSize: 11, marginBottom: 6 }}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 7 }}>{[0, 1, 2, 3, 4, 5, 6].map((o) => { const d = new Date(); d.setDate(d.getDate() + o); return chip(o === 0 ? 'Today' : `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, dayOff === o, () => setDayOff(o)); })}</ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            {stepper('Start hour', `${hour % 12 || 12}${hour >= 12 ? 'pm' : 'am'}`, () => setHour((h) => (h > 5 ? h - 1 : h)), () => setHour((h) => (h < 22 ? h + 1 : h)))}
            {stepper('Minutes', String(dur), () => setDur((d) => (d > 15 ? d - 15 : d)), () => setDur((d) => (d < 90 ? d + 15 : d)))}
            {stepper('Capacity', String(cap), () => setCap((c) => (c > 4 ? c - 1 : c)), () => setCap((c) => c + 1))}
          </View>
          <Text style={{ color: t.ink3, fontSize: 11, marginBottom: 6 }}>Repeat</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 7 }}>{([[1,'Just once'],[4,'Weekly \u00d74'],[8,'Weekly \u00d78'],[12,'Weekly \u00d712']] as [number, string][]).map(([n,label]) => chip(label, weeks === n, () => setWeeks(n)))}</ScrollView>
          <Pressable onPress={submit} disabled={!canAdd || busy} style={{ backgroundColor: canAdd ? t.brand : t.surface2, borderWidth: 1, borderColor: canAdd ? t.brand : t.ring, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: canAdd ? t.brandInk : t.ink3, fontWeight: '800', fontSize: 14 }}>{busy ? 'Adding…' : 'Add class'}</Text>
          </Pressable>
        </View>

        <Text style={{ color: t.ink2, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Upcoming ({upcoming.length})</Text>
        {upcoming.map((c: GymClass) => (
          <View key={c.id} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 13, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={{ color: t.ink, fontWeight: '800', fontSize: 14.5 }}>{c.title}</Text>
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>{c.branch} · {dayShort(c.startsAt)} {timeLabel(c.startsAt)} · {c.kind}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: c.booked >= c.capacity ? t.s3 : t.brand, fontWeight: '800', fontSize: 15 }}>{c.booked}/{c.capacity}</Text>
              <Text style={{ color: t.ink3, fontSize: 10 }}>booked</Text>
            </View>
          </View>
        ))}
        {upcoming.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13, textAlign: 'center', marginTop: 20 }}>No classes yet — add your first above.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
