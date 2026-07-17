// Owner · Class analytics & payroll. Reads class attendance (per class × branch ×
// trainer × time) to show fill rates, and computes trainer pay from check-ins at a
// per-attendee rate — the payroll basis. Live via class_attendance_summary; demo otherwise.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { classSummary, type ClassSummaryRow } from '../../src/lib/classAttendance';

type Range = 'week' | 'month' | 'season';
const RANGES: [Range, string, number][] = [['week', 'This week', 7], ['month', 'This month', 30], ['season', 'Season', 90]];

function rangeFrom(days: number): { from: string; to: string } {
  // Fixed "now" isn't available deterministically here; use Date at call time.
  const now = new Date(); const to = new Date(now); const from = new Date(now); from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function OwnerClassAnalytics() {
  const t = useTheme();
  const router = useRouter();
  const [range, setRange] = useState<Range>('week');
  const [rows, setRows] = useState<ClassSummaryRow[]>([]);
  const [rate, setRate] = useState('25');

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
    return { classes, attended, booked, fill: booked ? Math.round((attended / booked) * 100) : 0, payroll: Math.round(attended * rate$) };
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Classes & payroll</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 16, fontSize: 14 }}>Attendance drives trainer pay and class performance.</Text>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {RANGES.map(([k, label]) => (
            <Pressable key={k} onPress={() => setRange(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: range === k ? t.brand : t.surface2, borderWidth: 1, borderColor: range === k ? t.brand : t.ring }}>
              <Text style={{ color: range === k ? t.brandInk : t.ink2, fontWeight: '800', fontSize: 12.5 }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          {[['Classes', String(totals.classes)], ['Check-ins', String(totals.attended)], ['Avg fill', totals.fill + '%'], ['Trainer payroll', 'AED ' + totals.payroll.toLocaleString()]].map(([l, v]) => (
            <View key={l} style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 14, padding: 14 }}>
              <Text style={{ color: t.ink3, fontSize: 11.5 }}>{l}</Text>
              <Text style={{ color: l === 'Trainer payroll' ? t.brand : t.ink, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Text style={{ color: t.ink3, fontSize: 13 }}>Pay per attendee</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 }}>
            <Text style={{ color: t.ink3, fontSize: 14 }}>AED</Text>
            <TextInput value={rate} onChangeText={setRate} keyboardType="numeric" style={{ color: t.ink, paddingVertical: 9, fontSize: 15, minWidth: 44 }} />
          </View>
        </View>

        {/* Payroll by trainer */}
        <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, marginBottom: 4 }}>Payroll by trainer</Text>
          <Text style={{ color: t.ink3, fontSize: 12, marginBottom: 12 }}>Check-ins × AED {rate$} per attendee</Text>
          {byTrainer.map(([name, v]) => (
            <View key={name} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.ring }}>
              <View><Text style={{ color: t.ink, fontWeight: '700', fontSize: 14 }}>{name}</Text><Text style={{ color: t.ink3, fontSize: 12 }}>{v.classes} classes · {v.attended} check-ins</Text></View>
              <Text style={{ color: t.brand, fontWeight: '800', fontSize: 15 }}>AED {(v.attended * rate$).toLocaleString()}</Text>
            </View>
          ))}
          <Text style={{ color: t.ink3, fontSize: 11.5, marginTop: 10 }}>Export feeds accounting/payroll once Stripe & accounting are connected.</Text>
        </View>

        {/* Attendance by branch */}
        <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, marginBottom: 12 }}>Attendance by branch</Text>
          {byBranch.map(([b, v]) => (
            <View key={b} style={{ marginBottom: 11 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}><Text style={{ color: t.ink2, fontSize: 12.5 }}>{b}</Text><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12.5 }}>{v.attended} <Text style={{ color: t.ink3 }}>/ {v.booked}</Text></Text></View>
              <View style={{ height: 9, backgroundColor: t.surface2, borderRadius: 5 }}><View style={{ height: 9, width: `${Math.round((v.attended / maxBranch) * 100)}%`, backgroundColor: t.brand, borderRadius: 5 }} /></View>
            </View>
          ))}
        </View>

        {/* Attendance by class type */}
        <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, marginBottom: 12 }}>Popularity by class type</Text>
          {byKind.map(([k, v]) => (
            <View key={k} style={{ marginBottom: 11 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}><Text style={{ color: t.ink2, fontSize: 12.5 }}>{k}</Text><Text style={{ color: t.ink, fontWeight: '700', fontSize: 12.5 }}>{v.attended} <Text style={{ color: t.ink3 }}>· {v.classes} run</Text></Text></View>
              <View style={{ height: 9, backgroundColor: t.surface2, borderRadius: 5 }}><View style={{ height: 9, width: `${Math.round((v.attended / maxKind) * 100)}%`, backgroundColor: t.warn, borderRadius: 5 }} /></View>
            </View>
          ))}
        </View>

        {/* Class log */}
        <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 16 }}>
          <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15, marginBottom: 12 }}>Classes</Text>
          {rows.map((r) => (
            <View key={r.classId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.ring }}>
              <View style={{ flex: 1 }}><Text style={{ color: t.ink, fontWeight: '700', fontSize: 13.5 }}>{r.title}</Text><Text style={{ color: t.ink3, fontSize: 11.5 }}>{r.branch} · {r.trainerName}</Text></View>
              <Text style={{ color: r.attended >= r.booked ? t.good ?? t.brand : t.ink2, fontWeight: '800', fontSize: 13 }}>{r.attended}/{r.booked}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
