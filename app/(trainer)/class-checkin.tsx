// Trainer · Class check-in. Tap each member as they arrive; the checked-in count
// is what the owner's payroll and class analytics are built from. Attendance is
// written straight to the class_roster / set_class_attendance RPCs — when there
// is no backend row the roster is empty, never invented.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every handler, param, conditional and route from the
// previous version is preserved — only the presentation changed: the two bordered
// stat boxes became the screen's one hero figure, the bordered member cards
// became hairline-separated rows, and "Waitlist" is a coloured dot beside ink
// text rather than warn-coloured text.
//
// Removed — fabricated data, not a style change:
//   · the rate field defaulted to a hardcoded "25" and the screen printed
//     "You'll be paid AED {rate × present}" as a headline figure. Nothing in the
//     app knows this trainer's per-attendee rate or currency — it is never read
//     from the gym, never stored, and never sent anywhere — so that was a payout
//     amount with no payer behind it, in a currency left over from the deleted
//     Dubai branch list. The field now starts empty and is labelled as what it
//     is: an estimate the trainer computes from a number they typed.
//   · the file header claimed "a demo roster otherwise". There is no demo
//     roster; `classRoster` returns [] when the backend has no bookings.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
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
  const [rate, setRate] = useState(''); // per-attendee pay, in the trainer's own currency

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

  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{title}{branch ? ' · ' + branch : ''}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Check-in</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* ── the hero: the count payroll is built from ───────────────────── */}
        <Hero
          label="Checked in"
          figure={fig(present)}
          unit={'/ ' + booked}
          note={booked === 0 ? 'No bookings on this class yet.' : present === booked ? 'Everyone booked is here.' : `${booked - present} still to arrive`}
          arc={booked > 0 ? present / booked : undefined}
        />

        <Rule />

        {/* ── the trainer's own estimate ──────────────────────────────────── */}
        <Section>
          <SectionHead title="Pay estimate" />
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 6 }}>Rate per attendee</Text>
          <TextInput value={rate} onChangeText={setRate} keyboardType="numeric" placeholder="Your rate" placeholderTextColor={t.ink3}
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} />
          {rate.trim() ? (
            <Text style={{ ...ty.label, ...numeric, color: t.ink2, marginTop: sp.md }}>{rate.trim()} × {present} checked in = {pay}</Text>
          ) : null}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Your own arithmetic — Repple is not told your rate and does not process this payment. Your gym owner pays from the attendance below.
          </Text>
        </Section>

        <Rule />

        {/* ── the roster ─────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Members" note={roster.length ? String(roster.length) : undefined} />
          {loading ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading roster…</Text>
          ) : roster.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>No one has booked this class yet — members appear here as they book.</Text>
          ) : (
            roster.map((m, i) => (
              <Pressable key={m.userId} onPress={() => toggle(m)} accessibilityRole="button" accessibilityLabel={m.name}
                accessibilityState={{ checked: m.attended, selected: m.attended }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: m.attended ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  {m.attended ? <Icon name="check" size={15} color={t.brandInk} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{m.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    {m.status === 'waitlist' ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn }} /> : null}
                    <Text style={{ ...ty.caption, color: t.ink3 }}>{m.status === 'waitlist' ? 'Waitlist' : m.attended ? 'Present' : 'Booked · tap when they arrive'}</Text>
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </Section>

        <Rule />

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Check-ins are saved as you tap. Your gym owner sees attendance per class for payroll and class analytics.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
