// Trainer/Gym · Classes. Create and manage group classes across branches. Shows
// each upcoming class with its live booked/capacity, and a form to add a new one.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, handler, conditional and route from the
// previous version is preserved — only the presentation changed: the bordered
// form card and the bordered class rows became hairline-separated sections, the
// Georgia serif header is gone, and the booked/capacity figure reads as ink with
// a coloured mark beside it rather than as coloured text.
//
// The branch field stays free text: the picker it replaced offered six hardcoded
// Dubai locations a real gym may not have. The chips under it are only the
// branches this gym has itself used (`branchesFrom`), and a class still cannot
// be added without one.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, value } from '../../src/theme/scale';
import { useClasses } from '../../src/ui/classes';
import { CLASS_KINDS, branchesFrom, type GymClass } from '../../src/lib/classesMock';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timeLabel = (iso: string) => { const d = new Date(iso); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
const dayShort = (iso: string) => { const d = new Date(iso); const t = new Date(); if (d.toDateString() === t.toDateString()) return 'Today'; return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

export default function TrainerClasses() {
  const t = useTheme();
  const router = useRouter();
  const { classes, addClass } = useClasses();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>(CLASS_KINDS[0]);
  // Branch is typed in. It used to be a picker over six hardcoded Dubai
  // locations; chips below now offer only branches this gym has already used.
  const [branch, setBranch] = useState<string>('');
  const [room, setRoom] = useState('');
  const [instructor, setInstructor] = useState('');
  const [dayOff, setDayOff] = useState(0);
  const [hour, setHour] = useState(18);
  const [dur, setDur] = useState(45);
  const [cap, setCap] = useState(16);
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const knownBranches = branchesFrom(classes);

  const upcoming = useMemo(() => [...classes].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)), [classes]);

  const startIso = () => { const d = new Date(); d.setDate(d.getDate() + dayOff); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  const canAdd = title.trim().length > 0 && branch.trim().length > 0;
  const submit = async () => {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      const base = new Date(startIso());
      for (let w = 0; w < weeks; w++) { const d = new Date(base.getTime() + w * 7 * 86400000); await addClass({ title: title.trim(), kind, instructor: instructor.trim() || 'Coach', branch: branch.trim(), room: room.trim(), startsAt: d.toISOString(), durationMin: dur, capacity: cap }); }
      setTitle(''); setRoom('');
      Alert.alert(weeks > 1 ? 'Classes added' : 'Class added', weeks > 1 ? `${weeks} weekly ${title.trim()} classes at ${branch.trim()}, starting ${dayShort(startIso())} ${timeLabel(startIso())}.` : `${title.trim()} · ${branch.trim()} · ${dayShort(startIso())} ${timeLabel(startIso())}`);
    } finally { setBusy(false); }
  };

  const G = layout.gutter;
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 } as const;
  const lbl = { ...ty.caption, color: t.ink3, marginBottom: 6 } as const;
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: '500', color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );
  const stepper = (label: string, val: string, dec: () => void, inc: () => void) => (
    <View style={{ flex: 1 }}>
      <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 5 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderRadius: radius.sm }}>
        <Pressable onPress={dec} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Lower ' + label} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <Icon name="minus" size={15} color={t.ink2} />
        </Pressable>
        <Text style={{ ...value(15), color: t.ink, flex: 1, textAlign: 'center' }}>{val}</Text>
        <Pressable onPress={inc} hitSlop={8} accessibilityRole="button" accessibilityLabel={'Raise ' + label} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
          <Icon name="plus" size={15} color={t.ink2} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your branches</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Classes</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Schedule group classes across your branches. Members book and waitlist automatically.
        </Text>

        <Rule inset={0} />

        {/* ── new class ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="New class" />

          <TextInput value={title} onChangeText={setTitle} placeholder="Class title — e.g. Sunrise CrossFit" placeholderTextColor={t.ink3} style={inp} />

          <Text style={[lbl, { marginTop: sp.md }]}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {CLASS_KINDS.map((k) => chip(k, kind === k, () => setKind(k)))}
          </ScrollView>

          <Text style={[lbl, { marginTop: sp.md }]}>Branch</Text>
          <TextInput value={branch} onChangeText={setBranch} placeholder="Branch or location — e.g. your main studio" placeholderTextColor={t.ink3} style={inp} />
          {knownBranches.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2, marginTop: sp.sm }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
              {knownBranches.map((b) => chip(b, branch === b, () => setBranch(b)))}
            </ScrollView>
          ) : null}

          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
            <TextInput value={instructor} onChangeText={setInstructor} placeholder="Instructor" placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} />
            <TextInput value={room} onChangeText={setRoom} placeholder="Room (optional)" placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} />
          </View>

          <Text style={[lbl, { marginTop: sp.md }]}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((o) => { const d = new Date(); d.setDate(d.getDate() + o); return chip(o === 0 ? 'Today' : `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, dayOff === o, () => setDayOff(o)); })}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
            {stepper('Start hour', `${hour % 12 || 12}${hour >= 12 ? 'pm' : 'am'}`, () => setHour((h) => (h > 5 ? h - 1 : h)), () => setHour((h) => (h < 22 ? h + 1 : h)))}
            {stepper('Minutes', String(dur), () => setDur((d) => (d > 15 ? d - 15 : d)), () => setDur((d) => (d < 90 ? d + 15 : d)))}
            {stepper('Capacity', String(cap), () => setCap((c) => (c > 4 ? c - 1 : c)), () => setCap((c) => c + 1))}
          </View>

          <Text style={[lbl, { marginTop: sp.md }]}>Repeat</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: 7, paddingHorizontal: 2 }}>
            {([[1, 'Just once'], [4, 'Weekly ×4'], [8, 'Weekly ×8'], [12, 'Weekly ×12']] as [number, string][]).map(([n, label]) => chip(label, weeks === n, () => setWeeks(n)))}
          </ScrollView>

          <View style={{ height: sp.lg }} />
          <Cta label={busy ? 'Adding…' : 'Add class'} wide disabled={!canAdd || busy} onPress={submit} />
        </Section>

        <Rule />

        {/* ── the schedule ───────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Upcoming" note={upcoming.length ? String(upcoming.length) : undefined} />
          {upcoming.map((c: GymClass, i) => {
            const full = c.booked >= c.capacity;
            return (
              <View key={c.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.branch} · {dayShort(c.startsAt)} {timeLabel(c.startsAt)} · {c.kind}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {full ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn }} /> : null}
                    <Text style={{ ...value(16), color: t.ink }}>{c.booked}/{c.capacity}</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{full ? 'full' : 'booked'}</Text>
                </View>
                <Ghost label="Check in" onPress={() => router.push({ pathname: '/(trainer)/class-checkin', params: { id: c.id, title: c.title, branch: c.branch } })} />
              </View>
            );
          })}
          {upcoming.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No classes yet — add your first above.</Text>
          ) : null}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
