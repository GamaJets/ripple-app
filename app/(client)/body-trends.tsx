// Client · Body composition trends. Graphs every body metric over your history
// — weight, body fat %, skeletal muscle, and InBody score — so you can see the
// direction of travel, not just the latest numbers.
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
//
// ── TF build 35: "the numbers on the body page" ─────────────────────────────
//
// A tester reported that Progress and this screen showed different figures for
// the same person on the same day. They did, and the cause was here: this
// screen read `cd.scans` and graphed the InBody scans alone, while Progress
// showed `cd.weightKg` — which clientData derives as the most RECENT of {a
// weigh-in logged on the check-in screen, the newest scan}. A client who
// weighed in on Tuesday saw Tuesday's figure on Progress and last month's scan
// here, both labelled "Weight".
//
// Three changes, and none of them is rounding the two into looking alike:
//
//   · weight, body fat and skeletal muscle are read from the series clientData
//     already publishes (`weightSeries`, `bodyFatSeries`, `muscleSeries`), so
//     the trailing figure is the same value Progress shows by construction;
//   · every figure says WHAT measured it and WHEN, through
//     src/lib/bodyFigures.ts, so the differences that remain — which are
//     differences of date, and legitimate — read as two measurements rather
//     than as the app contradicting itself;
//   · the counts say "3 scans · 1 weigh-in" rather than "4 scans", because a
//     count that names the wrong instrument is the same defect as a figure
//     that does.
//
// The InBody score is the one metric still read straight off the scans, and
// that is correct: no bathroom scale produces one.
//
// Dates go through src/lib/localDate.ts. `scans.taken_at` is a bare postgres
// DATE, and the axis labels here used to be `new Date(iso).getDate()` — UTC
// midnight, which is the day before for every client west of Greenwich.
import { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { useSettings } from '../../src/ui/settings';
import { weightDeltaIn, weightIn } from '../../src/lib/units';
import {
  bodyReadings, measuredNote, stalenessNote, mixedSourceNote, readingsLabel,
  dayLabel, todayISO, type BodyReading,
} from '../../src/lib/bodyFigures';
import { Rule, Section, SectionHead, Ghost, Notice, Spark } from '../../src/ui/kit';
import { isWhole } from '../../src/ui/loadStatus';
import { sp, layout, type as ty, numeric, value } from '../../src/theme/scale';

interface MetricDef {
  key: string; label: string; unit: string; better: 'up' | 'down';
  /** True when the stored figure is a mass in kilograms, and so is read in the
   *  client's weight unit. False for anything that is not a weight at all. */
  weight?: boolean;
  /**
   * Which published series this metric's readings come from.
   *
   * Named on the metric rather than switched on `key` further down, so that a
   * metric added later cannot quietly fall through to re-deriving itself from
   * `cd.scans` — which is the exact shape of the bug that made this screen and
   * Progress disagree.
   */
  from: 'weight' | 'bodyFat' | 'muscle' | 'score';
}
const METRICS: MetricDef[] = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', better: 'down', weight: true, from: 'weight' },
  { key: 'bodyFatPct', label: 'Body Fat', unit: '%', better: 'down', from: 'bodyFat' },
  { key: 'skeletalMuscleKg', label: 'Skeletal Muscle', unit: 'kg', better: 'up', weight: true, from: 'muscle' },
  { key: 'inbodyScore', label: 'InBody Score', unit: 'pts', better: 'up', from: 'score' },
];

export default function BodyTrends() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const wu = useSettings().weightUnit;
  const scans = useMemo(() => [...(cd.scans || [])].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)), [cd.scans]);
  const today = todayISO();
  const G = layout.gutter;

  // clientData appends the logged weigh-in past the last scan, so the number of
  // scans is what separates the two kinds of point. It is read from the same
  // provider in the same render as the series themselves, so the two cannot
  // drift apart between here and there.
  const scanCount = cd.scans.length;
  // `cd.scansStatus` says whether `cd.scans` is the member's scan history or the
  // shape a failed read leaves behind. Its own doc comment in clientData.tsx
  // spells it out — under 'error' an empty `scans` means UNKNOWN, not "never
  // measured" — and this screen, whose entire subject is that history, read
  // neither it nor `profileStatus`. So a refused read printed "Every body metric
  // across 0 scans" in the header, "Not Enough Readings Yet · Add another scan
  // to see trends" in the body, and "Not enough data yet." under each of the
  // four metrics, to somebody with twenty scans on record.
  const bodyStatus = cd.scansStatus;
  const bodyWhole = isWhole(bodyStatus);
  const readingsFor = (m: MetricDef): BodyReading[] => {
    switch (m.from) {
      case 'weight': return bodyReadings(cd.weightSeries, scanCount);
      case 'bodyFat': return bodyReadings(cd.bodyFatSeries, scanCount);
      case 'muscle': return bodyReadings(cd.muscleSeries, scanCount);
      // The one metric no weigh-in can produce. A scan with no score
      // contributes no point rather than a zero — a charted zero is not a low
      // score, it is a cliff that flattens every real reading beside it.
      case 'score': return scans.flatMap((s) => (
        typeof s.metrics?.inbodyScore === 'number'
          ? [{ value: s.metrics.inbodyScore, at: s.takenAt, source: 'scan' as const }]
          : []
      ));
    }
  };

  const byMetric = METRICS.map((m) => ({ m, readings: readingsFor(m) }));
  // The screen's own summary line, and it must not say "scans" — most clients'
  // weight series is a mixture and a few clients' is weigh-ins only.
  const allLatest = byMetric.map(({ readings }) => (readings.length ? readings[readings.length - 1] : null));
  const headNote = mixedSourceNote(allLatest);
  const anyTrend = byMetric.some(({ readings }) => readings.length > 1);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingTop: sp.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>
              {bodyWhole
                ? `Every body metric across ${scans.length} scan${scans.length === 1 ? '' : 's'}${cd.weightSeries.length > scanCount ? ' and your latest weigh-in' : ''}`
                : 'Every body metric you have on record'}
            </Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Composition Trends</Text>
          </View>
          <Ghost icon="back" onPress={() => router.back()} />
        </View>

        {/* Said once, at the top, and only when the figures below genuinely do
            come from different instruments or different days. This is the
            sentence that turns "these two screens disagree" into "these two
            figures were measured on different days", which is a fact about the
            client's month rather than a fault in the app. */}
        {headNote ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{headNote}</Text>
        ) : null}

        <Rule />

        {/* Said before the charts, because "Not Enough Readings Yet" below is a
            claim about the member's record and this is the reason it may not be
            one. Under 'partial' the readings shown are real but are not all of
            them, which matters here more than on most screens: the FIRST
            reading is the one a trend is measured from. */}
        {!bodyWhole && bodyStatus !== 'loading' ? (
          <Section>
            <Notice
              tone={t.warn}
              kicker="Composition"
              title={bodyStatus === 'error' ? 'We couldn’t read your scans' : 'Not all of your scans could be read'}
              note={bodyStatus === 'error'
                ? 'Nothing below is a statement about your body — it is a statement about a read that did not answer. Your scans are on your record and are not lost.'
                : 'You have more readings on record than this screen can read in one go, so a trend drawn here starts where the read stopped rather than where you did.'}
            />
          </Section>
        ) : null}

        {!anyTrend ? (
          <Section>
            {/* Only a whole read may say the member has not got enough. */}
            {!bodyWhole ? (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                {bodyStatus === 'loading' ? 'Reading your scans…' : 'No trends can be drawn from what was read. That is not the same as having none — see above.'}
              </Text>
            ) : (<>
              <SectionHead title="Not Enough Readings Yet" />
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Add another scan to see trends</Text>
              <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>Once you've logged two or more readings, each metric graphs here so you can watch it move over time.</Text>
            </>)}
          </Section>
        ) : (
          byMetric.map(({ m, readings }, mi) => {
            if (readings.length < 2) return (
              <View key={m.key}>
                {mi > 0 ? <Rule /> : null}
                <Section>
                  <SectionHead title={m.label} note={readings.length ? readingsLabel(readings) : undefined} />
                  {/* One reading is a reading, not a trend — so it is printed
                      with its date rather than withheld. A client who has been
                      scanned once has a real figure, and telling them there is
                      "not enough data" without showing it reads as though the
                      app has lost it. */}
                  {readings.length === 1 ? (
                    <Text style={{ ...ty.label, color: t.ink3 }}>
                      One reading so far — {m.weight ? weightIn(readings[0].value, wu) : readings[0].value}
                      {m.weight ? ` ${wu}` : ` ${m.unit}`} · {measuredNote(readings[0], today)}. A trend needs two.
                    </Text>
                  ) : (
                    <Text style={{ ...ty.label, color: t.ink3 }}>{m.from === 'score' ? 'InBody score reads from your scan once the AI reader is connected.' : bodyWhole ? 'Not enough data yet.' : bodyStatus === 'loading' ? 'Reading…' : 'Nothing read for this one — see the note above.'}</Text>
                  )}
                </Section>
              </View>
            );
            // A single point read out in the client's unit, through the same
            // `weightIn` every other screen uses. This screen used to round
            // pounds locally and leave kilograms unrounded, so a stored 84.25 kg
            // printed as 84.3 on Progress and 84.25 here — a second, quieter way
            // for the two screens to disagree.
            const show = (v: number) => (m.weight ? (weightIn(v, wu) ?? v) : v);
            const unit = m.weight ? wu : m.unit;
            const vals = readings.map((r) => show(r.value));
            const min = Math.min(...vals), max = Math.max(...vals);
            const first = vals[0], last = vals[vals.length - 1];
            const now = readings[readings.length - 1];
            const stale = stalenessNote(now, today);
            // The change is taken across the STORED figures and converted once,
            // not read off the two converted endpoints: a 0.4 kg gain is 0.88 lb,
            // and endpoints rounded into pounds before subtracting would report
            // it as either nothing or two pounds depending on nothing but where
            // the two readings happened to fall.
            const rawDelta = Math.round((readings[readings.length - 1].value - readings[0].value) * 10) / 10;
            const delta = (m.weight ? weightDeltaIn(rawDelta, wu) : rawDelta) ?? rawDelta;
            const improving = m.better === 'up' ? rawDelta >= 0 : rawDelta <= 0;
            return (
              <View key={m.key}>
                {mi > 0 ? <Rule /> : null}
                <Section>
                  <SectionHead title={m.label} note={readingsLabel(readings)} />
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{ ...value(26), color: t.ink }}>{last}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginLeft: 3 }}>{unit}</Text>
                    </View>
                    {delta !== 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: improving ? t.brand : t.ink3 }} />
                        {/* "since your first scan" was wrong the moment the
                            first point was a weigh-in. The date it is actually
                            measured from is printed instead of guessed at. */}
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{delta > 0 ? '+' : '−'}{Math.abs(delta)} {unit} since {dayLabel(readings[0].at)}</Text>
                      </View>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3 }}>No change since {dayLabel(readings[0].at)}</Text>
                    )}
                  </View>
                  {/* The date and instrument behind the big number above it.
                      "Need to see the dates the weight was measured as well" —
                      this is that line, on every metric on the screen. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{measuredNote(now, today)}</Text>
                  {stale ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{stale}</Text> : null}
                  <View style={{ height: sp.md }} />
                  {/* The two end dates that used to sit in the row below are
                      now the chart's own axis, drawn from the same array it
                      plots — so they cannot drift from the points the way a
                      row assembled beside a chart can. What is left underneath
                      is the part the axis does not say: where the series
                      starts and how far it ranges. */}
                  <Spark data={vals} labels={readings.map((r) => r.at)} unit={` ${unit}`} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>first {first} {unit}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>range {min}–{max} {unit}</Text>
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
