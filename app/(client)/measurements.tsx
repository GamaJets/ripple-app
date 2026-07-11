// Client · Body Measurements. Log tape measurements over time; see the latest
// value and change since the previous entry, plus full history. Reached from the
// profile hub. Complements the InBody scans (Progress tab).
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useMeasurements, METRICS, type MeasureEntry } from '../../src/ui/measurements';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Measurements() {
  const t = useTheme();
  const router = useRouter();
  const { entries, addEntry } = useMeasurements();
  const [vals, setVals] = useState<Record<string, string>>({});

  const latest = entries[0];
  const prev = entries[1];
  const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));
  const save = () => {
    const parsed: Record<string, number> = {};
    for (const { key } of METRICS) { const n = parseFloat(vals[key]); if (!isNaN(n) && n > 0) parsed[key] = n; }
    if (Object.keys(parsed).length === 0) { Alert.alert('Nothing to save', 'Enter at least one measurement.'); return; }
    addEntry(parsed);
    setVals({});
    Alert.alert('Saved ✓', 'Your measurements were logged.');
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, width: 92, textAlign: 'center' } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={{ marginBottom: 8 }}>
          <Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text>
        </Pressable>
        <Text style={{ color: t.ink, fontSize: 24, fontWeight: '800' }}>Body Measurements</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18 }}>Tape measurements in cm · tracked over time</Text>

        {/* Latest snapshot with change vs previous */}
        {latest ? (
          <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 18 }}>
            <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Latest · {fmtDate(latest.at)}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {METRICS.map(({ key, label }) => {
                const v = latest[key]; if (v == null) return null;
                const pv = prev ? prev[key] : undefined;
                const d = pv != null ? +(v - pv).toFixed(1) : null;
                return (
                  <View key={key} style={{ width: '30%', minWidth: 96, flexGrow: 1, backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.ring, padding: 12 }}>
                    <Text style={{ color: t.ink3, fontSize: 12 }}>{label}</Text>
                    <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800', marginTop: 2 }}>{v}<Text style={{ color: t.ink3, fontSize: 11, fontWeight: '600' }}> cm</Text></Text>
                    {d != null && d !== 0 ? <Text style={{ color: d < 0 ? t.brand : t.s3, fontSize: 12, fontWeight: '700', marginTop: 2 }}>{d > 0 ? '+' : ''}{d} cm</Text> : <Text style={{ color: t.ink3, fontSize: 12, marginTop: 2 }}>—</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* New entry */}
        <View style={{ backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.ring, padding: 16, marginBottom: 18 }}>
          <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>Log new measurements</Text>
          {METRICS.map(({ key, label }) => (
            <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ color: t.ink2, fontSize: 14, fontWeight: '600' }}>{label}</Text>
              <TextInput value={vals[key] ?? ''} onChangeText={(v) => set(key, v)} keyboardType="numeric" placeholder={latest && latest[key] != null ? String(latest[key]) : 'cm'} placeholderTextColor={t.ink3} style={inp} />
            </View>
          ))}
          <Pressable onPress={save} style={{ backgroundColor: t.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 6 }}>
            <Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 15 }}>Save entry</Text>
          </Pressable>
        </View>

        {/* History */}
        <Text style={{ color: t.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>History</Text>
        {entries.map((e: MeasureEntry) => (
          <View key={e.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.ring, padding: 14, marginBottom: 9 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 13, marginBottom: 6 }}>{new Date(e.at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {METRICS.map(({ key, label }) => e[key] != null ? (
                <View key={key} style={{ backgroundColor: t.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: t.ring }}>
                  <Text style={{ color: t.ink3, fontSize: 11 }}>{label} <Text style={{ color: t.ink2, fontWeight: '700' }}>{e[key]}</Text></Text>
                </View>
              ) : null)}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
