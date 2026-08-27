// Client · Classes. Pick a branch and browse the gym's group-class schedule, then
// book or cancel. Full classes offer a waitlist; cancelling frees your seat.
//
// Re-skinned onto the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): no hero (a schedule has no single number), days as
// hairline-separated sections instead of a stack of bordered cards, and a
// coloured dot beside ink text where "Class full" used to be status-coloured
// type. The schedule itself is the gym's own — nothing is scheduled here.
import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { classFillState } from '../../src/lib/gymSchedule';
import { Rule, Section, SectionHead, Cta, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, type as ty, numeric } from '../../src/theme/scale';
import { useClasses } from '../../src/ui/classes';
import { scheduleLocal } from '../../src/ui/pushNotifications';
import type { GymClass } from '../../src/lib/classesMock';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timeLabel = (iso: string) => { const d = new Date(iso); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`; };
const dayLabel = (iso: string) => { const d = new Date(iso); const t = new Date(); const tm = new Date(); tm.setDate(t.getDate() + 1); if (d.toDateString() === t.toDateString()) return 'Today'; if (d.toDateString() === tm.toDateString()) return 'Tomorrow'; return `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

export default function Classes() {
  const t = useTheme();
  const router = useRouter();
  const { classes, myStatus, book, cancel, countsKnown } = useClasses();
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
    // book() now returns null when the server refused the seat. That used to
    // fall into the else below, so the client was told "Booked", got a local
    // reminder an hour before, and turned up to a class with no seat.
    if (st === null) {
      Alert.alert('Not booked', `We could not get you into ${c.title}. Nothing has been reserved — try again in a moment.`);
      return;
    }
    if (st === 'waitlist') Alert.alert('Added to waitlist', `${c.title} is full — you're on the waitlist and we'll move you up if a spot opens.`);
    else {
      const when = new Date(Date.parse(c.startsAt) - 60 * 60 * 1000);
      scheduleLocal(`${c.title} in 1 hour`, `${timeLabel(c.startsAt)} at ${c.branch}${c.room ? ' · ' + c.room : ''} with ${c.instructor}.`, when, { route: '/(client)/bookings' });
      Alert.alert('Booked', `You're in for ${c.title} at ${c.branch}, ${dayLabel(c.startsAt)} ${timeLabel(c.startsAt)}. We'll remind you an hour before.`);
    }
  };
  const onCancel = (c: GymClass) => {
    Alert.alert('Cancel booking?', `${c.title} · ${c.branch} · ${dayLabel(c.startsAt)} ${timeLabel(c.startsAt)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: () => cancel(c.id) },
    ]);
  };

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: active ? t.brand : t.surface2 }}>
      <Text style={{ ...ty.label, fontWeight: active ? '600' : '500', color: active ? t.brandInk : t.ink2 }}>{label}</Text>
    </Pressable>
  );

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>At the gym</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Classes</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Pick your location and book a spot. Full classes have a waitlist.</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {branches.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: sp.lg }} contentContainerStyle={{ gap: sp.sm }}>
            {chip('All branches', branch === null, () => setBranch(null))}
            {branches.map((b) => chip(b, branch === b, () => setBranch(b === branch ? null : b)))}
          </ScrollView>
        ) : null}

        {byDay.map((g) => (
          <View key={g.key}>
            <Rule />
            <Section>
              <SectionHead title={g.label} note={`${g.items.length} class${g.items.length === 1 ? '' : 'es'}`} />
              {g.items.map((c, i) => {
                const mine = myStatus[c.id];
                // `booked` is 0 for every class until the count RPC fills it
                // in. When that failed, subtracting it would advertise a full
                // class as completely empty, so no claim is made about spaces.
                const spotsLeft = countsKnown ? Math.max(0, c.capacity - c.booked) : null;
                const fill = countsKnown ? classFillState(c.capacity, c.booked) : null;
                const full = fill === 'full';
                return (
                  <View key={c.id}>
                    {i > 0 ? <Rule /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>{c.kind}</Text>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, marginTop: 3 }}>{c.title}</Text>
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{timeLabel(c.startsAt)} · {c.durationMin}m · {c.instructor} · {c.branch}{c.room ? ' · ' + c.room : ''}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                          {/* The mark carries the urgency; the words keep the
                              exact count. A class with two spots left and one
                              with twelve were the same grey dot, so the one
                              about to go looked like the one nobody wants. */}
                          <View style={{ width: 6, height: 6, borderRadius: 3,
                            backgroundColor: mine ? t.brand : full ? t.s3 : fill === 'nearly' ? t.warn : t.ink3 }} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>{mine === 'waitlist' ? 'On the waitlist' : mine ? 'Booked' : spotsLeft == null ? 'Spaces unknown' : full ? 'Class full' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}</Text>
                        </View>
                      </View>
                      {mine ? (
                        <Ghost label={mine === 'waitlist' ? 'Leave waitlist' : 'Cancel'} onPress={() => onCancel(c)} />
                      ) : (
                        <Cta label={full ? 'Join waitlist' : 'Book'} onPress={() => onBook(c)} />
                      )}
                    </View>
                  </View>
                );
              })}
            </Section>
          </View>
        ))}

        {filtered.length === 0 ? (
          <View style={{ paddingTop: sp.huge, alignItems: 'center' }}>
            <Text style={{ ...ty.head, color: t.ink, textAlign: 'center' }}>No classes scheduled{branch ? ' at ' + branch : ''} yet</Text>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: 6, maxWidth: 300 }}>Classes appear here as soon as your gym adds them to the schedule.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
