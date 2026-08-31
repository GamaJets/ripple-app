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
//
// Two things this screen used to get wrong about its own reads:
//
//   · it took `classes` from `useClasses()` and ignored the `status` beside it,
//     so a refused read drew an empty week under the words "No classes yet".
//     This screen is a timetable; an empty timetable is a coach's plan for
//     their week, and they act on it by not turning up.
//   · `addClass` resolves false when the insert never reached `gym_classes`,
//     and the alert said "Class added" either way. A class that exists on the
//     coach's phone alone is on nobody's timetable and cannot be booked.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, PartialRead, Field } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, value } from '../../src/theme/scale';
import { useClasses } from '../../src/ui/classes';
import { CLASS_KINDS, branchesFrom, type GymClass } from '../../src/lib/classesMock';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timeLabel = (iso: string) => { const d = new Date(iso); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
const dayShort = (iso: string) => { const d = new Date(iso); const t = new Date(); if (d.toDateString() === t.toDateString()) return 'Today'; return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

export default function TrainerClasses() {
  const t = useTheme();
  const router = useRouter();
  // `status` alongside the rows, because this screen draws a timetable and an
  // empty timetable is a sentence: nothing is scheduled. Under 'error' the list
  // is empty because the read did not come back, and a coach who reads that as
  // a free week does not turn up to teach. Under 'partial' the classes shown
  // are real but the far end of the schedule is missing.
  const { classes, addClass, countsKnown, status, refresh } = useClasses();

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
  // `addClass` resolves false when the insert did not reach `gym_classes`, and
  // this used to discard that and announce "Class added" either way. A class
  // that exists on the coach's phone alone is on nobody's timetable and cannot
  // be booked — the members it was scheduled for never see it, and the coach has
  // been told it is up. What is reported now is what the server actually took.
  const submit = async () => {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      const base = new Date(startIso());
      const nm = title.trim(); const br = branch.trim();
      const when = `${dayShort(startIso())} ${timeLabel(startIso())}`;
      let saved = 0;
      for (let w = 0; w < weeks; w++) {
        const d = new Date(base.getTime() + w * 7 * 86400000);
        if (await addClass({ title: nm, kind, instructor: instructor.trim() || 'Coach', branch: br, room: room.trim(), startsAt: d.toISOString(), durationMin: dur, capacity: cap })) saved++;
      }
      // The form is only cleared on a clean save. Clearing it after a refusal
      // throws away everything the coach typed and leaves them nothing to
      // retry from.
      if (saved === weeks) { setTitle(''); setRoom(''); }
      if (saved === weeks) {
        Alert.alert(weeks > 1 ? 'Classes added' : 'Class added', weeks > 1
          ? `${weeks} weekly ${nm} classes at ${br}, starting ${when}.`
          : `${nm} · ${br} · ${when}`);
      } else if (saved === 0) {
        Alert.alert('Not on the timetable', weeks > 1
          ? `None of the ${weeks} ${nm} classes reached the server, so they are on this phone only and nobody can book them. They will be gone when you reopen the app — try again once you have signal.`
          : `${nm} did not reach the server, so it is on this phone only and nobody can book it. It will be gone when you reopen the app — try again once you have signal.`);
      } else {
        Alert.alert('Partly added', `${saved} of ${weeks} ${nm} classes reached the server. The other ${weeks - saved} are on this phone only and cannot be booked — add them again once you have signal.`);
      }
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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

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
          <SectionHead title="New Class" />

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

          {/* Two names side by side, and which is which — and which of the two
              may be left empty — lived in placeholders that the first keystroke
              erased. */}
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
            <Field label="Instructor">
              <TextInput value={instructor} onChangeText={setInstructor} style={inp} />
            </Field>
            <Field label="Room" hint="optional">
              <TextInput value={room} onChangeText={setRoom} style={inp} />
            </Field>
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
          <Cta label={busy ? 'Adding…' : 'Add Class'} wide disabled={!canAdd || busy} onPress={submit} />
        </Section>

        <Rule />

        {/* ── the schedule ───────────────────────────────────────────────── */}
        <Section>
          {/* The count is withheld unless the read was whole. Under 'partial'
              `upcoming.length` is the size of the page that arrived, and
              printing it beside "Upcoming" states it as the number of classes
              the gym has scheduled — which is the one figure a truncated read
              does not know. PartialRead below says "the first N" instead. */}
          <SectionHead title="Upcoming" note={status === 'ready' && upcoming.length ? String(upcoming.length) : undefined} />

          {/* An unread timetable is not an empty week. Without this the screen
              shows a coach with forty classes on the books a blank schedule and
              the words "No classes yet", and they plan their week around it. */}
          {status === 'error' ? (
            <Notice tone={t.warn} kicker="Timetable" title="Your schedule could not be read"
              note="Nothing is listed below because the classes did not come back — it does not mean nothing is scheduled. Anything you add here may duplicate a class that is already on the timetable, so check again once you have signal.">
              <View style={{ marginTop: sp.md }}><Ghost label="Try Again" onPress={refresh} /></View>
            </Notice>
          ) : status === 'partial' ? (
            <PartialRead what="classes on your timetable" shown={upcoming.length} onPress={refresh} />
          ) : null}

          {upcoming.map((c: GymClass, i) => {
            // Unknown is not "not full". Without the counts, `booked` is 0
            // for every class and nothing would ever read as full.
            const full = countsKnown && c.booked >= c.capacity;
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
                    <Text style={{ ...value(16), color: t.ink }}>{countsKnown ? c.booked : '—'}/{c.capacity}</Text>
                  </View>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{!countsKnown ? 'capacity' : full ? 'full' : 'booked'}</Text>
                </View>
                <Ghost label="Check In" onPress={() => router.push({ pathname: '/(trainer)/class-checkin', params: { id: c.id, title: c.title, branch: c.branch } })} />
              </View>
            );
          })}
          {/* Only a settled, whole read may claim the gym has no classes. Under
              'error' the Notice above has already said we do not know, and under
              'loading' nobody has been asked yet. */}
          {upcoming.length === 0 && status === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No classes yet — add your first above.</Text>
          ) : upcoming.length === 0 && status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your timetable…</Text>
          ) : null}
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
