// Client · Body composition trends. Graphs every InBody metric over your scan
// history — weight, body fat %, skeletal muscle, and InBody score — so you can see
// the direction of travel, not just the latest numbers. Reads the scan store.
import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';

interface MetricDef { key: string; label: string; unit: string; better: 'up' | 'down' }
const METRICS: MetricDef[] = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', better: 'down' },
  { key: 'bodyFatPct', label: 'Body fat', unit: '%', better: 'down' },
  { key: 'skeletalMuscleKg', label: 'Skeletal muscle', unit: 'kg', better: 'up' },
  { key: 'inbodyScore', label: 'InBody score', unit: 'pts', better: 'up' },
];

function valOf(scan: any, key: string): number | undefined {
  if (key === 'inbodyScore') return scan?.metrics?.inbodyScore;
  const v = scan?.[key];
  return typeof v === 'number' ? v : undefined;
}

export default function BodyTrends() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const scans = useMemo(() => [...(cd.scans || [])].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)), [cd.scans]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ marginBottom: 8 }}><Text style={{ color: t.brand, fontWeight: '700', fontSize: 15 }}>‹ Back</Text></Pressable>
        <Text style={{ color: t.ink, fontSize: 26, fontWeight: '700', fontFamily: 'Georgia' }}>Composition trends</Text>
        <Text style={{ color: t.ink3, marginTop: 3, marginBottom: 18, fontSize: 14 }}>Every InBody metric across {scans.length} scan{scans.length === 1 ? '' : 's'}.</Text>

        {scans.length < 2 ? (
          <View style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 18 }}>
            <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15, marginBottom: 4 }}>Add another scan to see trends</Text>
            <Text style={{ color: t.ink3, fontSize: 13, lineHeight: 19 }}>Once you've logged two or more InBody scans, each metric graphs here so you can watch it move over time.</Text>
          </View>
        ) : (
          METRICS.map((m) => {
            const series = scans.map((s) => ({ t: s.takenAt, v: valOf(s, m.key) })).filter((p) => typeof p.v === 'number') as { t: string; v: number }[];
            if (series.length < 2) return (
              <View key={m.key} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 }}>
                <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{m.label}</Text>
                <Text style={{ color: t.ink3, fontSize: 12.5, marginTop: 6 }}>{m.key === 'inbodyScore' ? 'InBody score reads from your scan once the AI reader is connected.' : 'Not enough data yet.'}</Text>
              </View>
            );
            const vals = series.map((p) => p.v);
            const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
            const first = vals[0], last = vals[vals.length - 1], delta = Math.round((last - first) * 10) / 10;
            const improving = m.better === 'up' ? delta >= 0 : delta <= 0;
            return (
              <View key={m.key} style={{ backgroundColor: t.surface, borderColor: t.ring, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                  <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{m.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={{ color: t.ink, fontSize: 18, fontWeight: '800' }}>{last}<Text style={{ fontSize: 12, color: t.ink3 }}> {m.unit}</Text></Text>
                    <Text style={{ color: improving ? (t.good ?? t.brand) : t.crit, fontWeight: '800', fontSize: 12.5 }}>{delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : ''}{delta !== 0 ? Math.abs(delta) : '—'}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 6 }}>
                  {series.map((p, i) => (
                    <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={{ color: t.ink3, fontSize: 8.5, marginBottom: 3 }}>{p.v}</Text>
                      <View style={{ width: '66%', height: Math.max(4, ((p.v - min) / span) * 74 + 6), backgroundColor: t.brand, borderRadius: 4 }} />
                      <Text style={{ color: t.ink3, fontSize: 8, marginTop: 4 }}>{new Date(p.t).getDate()}/{new Date(p.t).getMonth() + 1}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
