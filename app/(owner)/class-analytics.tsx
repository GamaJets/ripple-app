// Owner · Class analytics & payroll. Reads class attendance (per class × branch ×
// trainer × time) to show fill rates, and computes trainer pay from check-ins at a
// per-attendee rate — the payroll basis.
//
// Every figure on this screen comes from `class_attendance_summary`; there is no
// demo fallback, so an empty range says "no classes" rather than inventing
// attendance for people who were never checked in. Pay-per-attendee is the one
// number you type in — payroll is check-ins × that rate, nothing else.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`): eleven bordered boxes became hairline-separated sections,
// payroll became the screen's one hero figure, and the Georgia serif header and
// the 12.5/11.5px font sizes are gone.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { classSummary, type ClassSummaryRow } from '../../src/lib/classAttendance';

type Range = 'week' | 'month' | 'season';
const RANGES: [Range, string, number][] = [['week', 'This week', 7], ['month', 'This month', 30], ['season', 'Season', 90]];

function rangeFrom(days: number): { from: string; to: string } {
  // Fixed "now" isn't available deterministically here; use Date at call time.
  const now = new Date(); const to = new Date(now); const from = new Date(now); from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * One bar of a ranked list. 3px on a dim track, same mark as <Meter/> — `dim`
 * separates the two ranked lists without reaching for a status colour.
 */
function Bar({ t, label, note, pct, dim }: { t: Theme; label: string; note: string; pct: number; dim?: boolean }) {
  return (
    <View style={{ marginTop: sp.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.md }}>
        <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }} numberOfLines={1}>{label}</Text>
        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{note}</Text>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
        <View style={{ height: 3, borderRadius: 2, width: `${pct}%`, backgroundColor: t.brand, opacity: dim ? 0.45 : 1 }} />
      </View>
    </View>
  );
}

export default function OwnerClassAnalytics() {
  const t = useTheme();
  const router = useRouter();
  const [range, setRange] = useState<Range>('week');
  const [rows, setRows] = useState<ClassSummaryRow[]>([]);
  // Empty, not 25. The hero renders a payroll total above the rate field, so a
  // default put a specific AED figure on screen - belonging to no pay
  // agreement - before the owner could see what it was multiplied by.
  const [rate, setRate] = useState('');

  useEffect(() => {
    let on = true;
    const days = RANGES.find((r) => r[0] === range)?.[2] ?? 7;
    const { from, to } = rangeFrom(days);
    classSummary(from, to).then((r) => { if (on) setRows(r); });
    return () => { on = false; };
  }, [range]);

  const rate$ = parseFloat(rate) || 0;
  const totals = useMemo(() => {
    const classes = rows.length;
    const attended = rows.reduce((a, r) => a + r.attended, 0);
    const booked = rows.reduce((a, r) => a + r.booked, 0);
    return { classes, attended, booked, show: booked ? Math.round((attended / booked) * 100) : 0, payroll: Math.round(attended * rate$) };
  }, [rows, rate$]);

  const byGroup = (key: (r: ClassSummaryRow) => string) => {
    const m: Record<string, { attended: number; booked: number; classes: number }> = {};
    for (const r of rows) { const k = key(r) || '—'; (m[k] ||= { attended: 0, booked: 0, classes: 0 }); m[k].attended += r.attended; m[k].booked += r.booked; m[k].classes += 1; }
    return Object.entries(m).sort((a, b) => b[1].attended - a[1].attended);
  };
  const byBranch = useMemo(() => byGroup((r) => r.branch), [rows]);
  const byTrainer = useMemo(() => byGroup((r) => r.trainerName), [rows]);
  const byKind = useMemo(() => byGroup((r) => r.kind || r.title), [rows]);
  const maxBranch = Math.max(1, ...byBranch.map(([, v]) => v.attended));
  const maxKind = Math.max(1, ...byKind.map(([, v]) => v.attended));
  const G = layout.gutter;

  const rateField = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md }}>
      <Text style={{ ...ty.label, color: t.ink3, flex: 1 }}>Pay per attendee</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md }}>
        <Text style={{ ...ty.label, color: t.ink3 }}>AED</Text>
        <TextInput value={rate} onChangeText={setRate} keyboardType="numeric" accessibilityLabel="Pay per attendee in dirhams"
          style={{ ...ty.body, ...numeric, color: t.ink, paddingVertical: 9, minWidth: 44 }} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Attendance drives pay</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Classes & payroll</Text>
          </View>
        </View>

        {/* ── range ──────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderRadius: radius.sm, padding: 3, marginTop: sp.lg }}>
          {RANGES.map(([k, label]) => (
            <Pressable key={k} onPress={() => setRange(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm, backgroundColor: range === k ? t.brand : 'transparent' }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: range === k ? t.brandInk : t.ink3 }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {rows.length === 0 ? (
          <Section>
            <Text style={{ ...ty.head, color: t.ink }}>No classes in this range.</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
              Attendance, fill rates and trainer payroll appear here once classes run and trainers check members in.
              Nothing is estimated — payroll is check-ins × your per-attendee rate.
            </Text>
          </Section>
        ) : (<>

          {/* ── the hero: what this screen is for ────────────────────────── */}
          <Hero
            label="Trainer payroll (AED)"
            figure={rate$ > 0 ? totals.payroll.toLocaleString() : '—'}
            note={rate$ > 0
              ? `${totals.attended} check-ins × AED ${rate$} · ${totals.classes} classes · ${totals.show}% avg show`
              : `${totals.attended} check-ins · ${totals.classes} classes · ${totals.show}% avg show · enter your per-check-in rate below`}
          />

          <Rule />

          <Section>
            <SectionHead title="This range" />
            <KpiRow items={[
              { label: 'Classes', value: String(totals.classes) },
              { label: 'Check-ins', value: String(totals.attended) },
              { label: 'Avg show', value: String(totals.show), unit: '%' },
            ]} />
          </Section>

          <Rule />

          {/* ── payroll by trainer ───────────────────────────────────────── */}
          <Section>
            <SectionHead title="Payroll by trainer" note={rate$ > 0 ? `AED ${totals.payroll.toLocaleString()}` : undefined} />
            {rateField}
            {byTrainer.map(([name, v], i) => (
              <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{name}</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }}>{v.classes} classes · {v.attended} check-ins</Text>
                </View>
                <Text style={{ ...ty.body, fontWeight: '600', ...numeric, color: t.ink }}>{rate$ > 0 ? `AED ${(v.attended * rate$).toLocaleString()}` : '—'}</Text>
              </View>
            ))}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Export feeds accounting/payroll once Stripe & accounting are connected.
            </Text>
          </Section>

          <Rule />

          {/* ── where the check-ins are ──────────────────────────────────── */}
          <Section>
            <SectionHead title="Attendance by branch" note={`${totals.attended} of ${totals.booked} booked`} />
            {byBranch.map(([b, v]) => (
              <Bar key={b} t={t} label={b} note={`${v.attended} / ${v.booked}`} pct={Math.round((v.attended / maxBranch) * 100)} />
            ))}
          </Section>

          <Rule />

          <Section>
            <SectionHead title="Popularity by class type" />
            {byKind.map(([k, v]) => (
              <Bar key={k} t={t} label={k} note={`${v.attended} · ${v.classes} run`} pct={Math.round((v.attended / maxKind) * 100)} dim />
            ))}
          </Section>

          <Rule />

          {/* ── the log the numbers came from ────────────────────────────── */}
          <Section>
            <SectionHead title="Classes" note={`${rows.length} in range`} />
            {rows.map((r, i) => (
              <View key={r.classId} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{r.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.branch} · {r.trainerName}</Text>
                </View>
                {r.attended >= r.booked ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.good }} /> : null}
                <Text style={{ ...ty.body, fontWeight: '600', ...numeric, color: t.ink }}>{r.attended}/{r.booked}</Text>
              </View>
            ))}
          </Section>
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}
