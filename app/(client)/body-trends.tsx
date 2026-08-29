// Client · Body composition trends. Graphs every InBody metric over your scan
// history — weight, body fat %, skeletal muscle, and InBody score — so you can see
// the direction of travel, not just the latest numbers. Reads the scan store.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Every provider, conditional and route from the previous
// version is preserved — only the presentation changed: four bordered cards with
// hand-rolled View-bar charts became hairline-separated sections carrying a
// <Spark> each, the 8px tick labels are gone, and the movement figure no longer
// paints itself in a reserved status colour — it carries a mark beside ink text.
// Four metrics of equal weight is a list, so this screen leads with no hero.
//
// TF-37: two of the four metrics are kilograms on the record and were graphed,
// labelled and summarised as kilograms for everybody. They now read in the
// client's unit. The other two do not move — body fat is a percentage and the
// InBody score is a score, and neither has a unit system to be converted into.
// Which is which is declared on the metric itself rather than guessed from the
// key name, so a metric added later has to say what it is.
import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightDeltaIn, kgToLb } from '../../src/lib/units';
import { Rule, Section, SectionHead, Ghost, Spark } from '../../src/ui/kit';
import { sp, layout, type as ty, numeric, value } from '../../src/theme/scale';

interface MetricDef {
  key: string; label: string; unit: string; better: 'up' | 'down';
  /** True when the stored figure is a mass in kilograms, and so is read in the
   *  client's weight unit. False for anything that is not a weight at all. */
  weight?: boolean;
}
const METRICS: MetricDef[] = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', better: 'down', weight: true },
  { key: 'bodyFatPct', label: 'Body fat', unit: '%', better: 'down' },
  { key: 'skeletalMuscleKg', label: 'Skeletal muscle', unit: 'kg', better: 'up', weight: true },
  { key: 'inbodyScore', label: 'InBody score', unit: 'pts', better: 'up' },
];

function valOf(scan: any, key: string): number | undefined {
  if (key === 'inbodyScore') return scan?.metrics?.inbodyScore;
  const v = scan?.[key];
  return typeof v === 'number' ? v : undefined;
}

const dm = (iso: string) => `${new Date(iso).getDate()}/${new Date(iso).getMonth() + 1}`;

export default function BodyTrends() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const wu = useSettings().weightUnit;
  const scans = useMemo(() => [...(cd.scans || [])].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)), [cd.scans]);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Every InBody metric across {scans.length} scan{scans.length === 1 ? '' : 's'}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Composition trends</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        <Rule />

        {scans.length < 2 ? (
          <Section>
            <SectionHead title="Not enough scans yet" />
            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Add another scan to see trends</Text>
            <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>Once you've logged two or more InBody scans, each metric graphs here so you can watch it move over time.</Text>
          </Section>
        ) : (
          METRICS.map((m, mi) => {
            const series = scans.map((s) => ({ t: s.takenAt, v: valOf(s, m.key) })).filter((p) => typeof p.v === 'number') as { t: string; v: number }[];
            if (series.length < 2) return (
              <View key={m.key}>
                {mi > 0 ? <Rule /> : null}
                <Section>
                  <SectionHead title={m.label} />
                  <Text style={{ ...ty.label, color: t.ink3 }}>{m.key === 'inbodyScore' ? 'InBody score reads from your scan once the AI reader is connected.' : 'Not enough data yet.'}</Text>
                </Section>
              </View>
            );
            // A single point read out in the client's unit. Only the two mass
            // metrics move; the percentage and the score pass straight through.
            const show = (v: number) => (m.weight && wu === 'lb' ? Math.round(kgToLb(v)) : v);
            const unit = m.weight ? wu : m.unit;
            const vals = series.map((p) => show(p.v));
            const min = Math.min(...vals), max = Math.max(...vals);
            const first = vals[0], last = vals[vals.length - 1];
            // The change is taken across the STORED figures and converted once,
            // not read off the two converted endpoints: a 0.4 kg gain is 0.88 lb,
            // and endpoints rounded into pounds before subtracting would report
            // it as either nothing or two pounds depending on nothing but where
            // the two readings happened to fall.
            const rawDelta = Math.round((series[series.length - 1].v - series[0].v) * 10) / 10;
            const delta = (m.weight ? weightDeltaIn(rawDelta, wu) : rawDelta) ?? rawDelta;
            const improving = m.better === 'up' ? rawDelta >= 0 : rawDelta <= 0;
            return (
              <View key={m.key}>
                {mi > 0 ? <Rule /> : null}
                <Section>
                  <SectionHead title={m.label} note={`${series.length} scans`} />
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{ ...value(26), color: t.ink }}>{last}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 3 }}>{unit}</Text>
                    </View>
                    {delta !== 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: improving ? t.brand : t.ink3 }} />
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{delta > 0 ? '+' : '−'}{Math.abs(delta)} {unit} since your first scan</Text>
                      </View>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3 }}>No change since your first scan</Text>
                    )}
                  </View>
                  <View style={{ height: sp.md }} />
                  <Spark data={vals} labels={series.map((p) => p.t)} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{dm(series[0].t)} · {first} {unit}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>range {min}–{max} {unit}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{dm(series[series.length - 1].t)}</Text>
                  </View>
                </Section>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
