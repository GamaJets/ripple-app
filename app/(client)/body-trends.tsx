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
// ── the nine that were extracted and never trended ──────────────────────────
//
// A scan is parsed into THIRTEEN figures — src/lib/inbodyMetrics.ts has said so
// with a label, a unit, a direction, a heading and a grain for each of them for
// as long as the vision reader has existed — and this screen graphed four of
// them. Visceral fat, BMR, fat mass, lean mass, the five segmental lean masses,
// body water, protein and minerals were shown once, for the newest scan, on the
// Progress table, and never over time. They are on the record of every scan
// that was read from a photograph of the printout; a member watching an arm
// catch up with the other one had a column of numbers and no curve.
//
// They are charted here now, through the SAME code path as the original four
// rather than a second one written beside it: one readings list per metric,
// one delta rule, one goal rule, one chart. The extension point was already
// here — `MetricDef.from` was written so "a metric added later has to say what
// it is" — and these say it by carrying their own `MetricDef` from
// src/lib/inbodyMetrics.ts, which is the one place that knows what each of them
// is. Nothing about them is guessed from a key name here.
//
// Two things had to be settled before they could be drawn:
//
//   · The unit. Nine of the thirteen are masses in kilograms, and a member who
//     reads in pounds was being shown 163 lb at the top and 11.8 kg underneath.
//     They convert — through src/lib/compositionUnit.ts, which carries the
//     finer grain a 0.01 kg segmental reading needs and agrees with
//     `weightIn` everywhere the two could be compared. A litre of body water, a
//     BMR in kcal, a visceral fat level and a score are not masses and are not
//     converted; each says so by its own declared unit rather than by its name.
//
//   · Which way is good. `better` is a property of the metric and is right for
//     protein, minerals and water. It is NOT right for fat mass: `better:
//     'down'` would paint this screen's "moving the right way" mark on somebody
//     deliberately building, which is the exact defect the note on Weight
//     further down was written about. `MetricDef.goalMetric` is what decides it
//     where the member's own goal has an opinion, and silence is what happens
//     where it has not.
//
// Dates go through src/lib/localDate.ts. `scans.taken_at` is a bare postgres
// DATE, and the axis labels here used to be `new Date(iso).getDate()` — UTC
// midnight, which is the day before for every client west of Greenwich.
import { useMemo, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { useClientData } from '../../src/ui/clientData';
import { deltaLabel, movementIsProgress } from '../../src/lib/deltaLabel';
import { useSettings } from '../../src/ui/settings';
import { weightDeltaIn, weightIn } from '../../src/lib/units';
import { numUpTo } from '../../src/lib/format';
import {
  METRIC_DEFS, metricReadings, metricIsProgress,
  type MetricDef as InbodyDef,
} from '../../src/lib/inbodyMetrics';
import {
  isConvertibleMass, compositionUnitOf, compositionDecimals, compositionIn, compositionDeltaIn,
} from '../../src/lib/compositionUnit';
// How FAST it is moving, which this screen has never said. The total change
// since the first reading grows for ever and is mostly a fact about how long
// ago somebody started; the rate is the figure that says whether what they are
// doing this month is working, and it is what InBody's own app, Withings,
// Renpho and Happy Scale all lead with. See src/lib/bodyRate.ts, including why
// the printed grain is derived from the window rather than fixed.
import { rateOf, rateDecimals, rateGapNote } from '../../src/lib/bodyRate';
import { KG_PER_LB } from '../../src/lib/units';
import {
  bodyReadings, measuredNote, stalenessNote, mixedSourceNote, readingsLabel,
  dayLabel, type BodyReading,
} from '../../src/lib/bodyFigures';
import { useToday } from '../../src/ui/today';
import { useGoalTracker } from '../../src/ui/goalTracker';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { goalOfKind, goalOnBody } from '../../src/lib/goalOnBody';
import { Rule, Section, SectionHead, PageHead, Ghost, Notice, Spark } from '../../src/ui/kit';
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
  from: 'weight' | 'bodyFat' | 'muscle' | 'score' | 'scan';
  /**
   * The `goal_targets.kind` this metric can be aimed at, or null when it cannot
   * be aimed at at all.
   *
   * Declared on the metric for the same reason `from` is: the InBody score has
   * no goal kind and never will, and a metric added later has to say which it
   * is rather than falling through to a guess made from its key name.
   */
  goalKind: 'weight' | 'bodyfat' | 'muscle' | null;
  /**
   * The composition definition behind a `from: 'scan'` metric — its unit, the
   * grain the record stores it at, which way is good and whose opinion decides
   * that.
   *
   * Carried whole rather than copied field by field, so that a change made in
   * src/lib/inbodyMetrics.ts — the module the coach's table and the member's
   * table both already read — arrives here rather than being restated. The four
   * metrics above have no InBody definition because they are not read from
   * `scans.metrics` at all: they come off the published series, which is the
   * whole subject of this file's header.
   */
  inbody?: InbodyDef;
  /** The composition heading this metric is drawn under, where it has one. */
  group?: string;
}
const BODY_METRICS: MetricDef[] = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', better: 'down', weight: true, from: 'weight', goalKind: 'weight' },
  { key: 'bodyFatPct', label: 'Body Fat', unit: '%', better: 'down', from: 'bodyFat', goalKind: 'bodyfat' },
  { key: 'skeletalMuscleKg', label: 'Skeletal Muscle', unit: 'kg', better: 'up', weight: true, from: 'muscle', goalKind: 'muscle' },
  // No goal kind. `goal_targets` has no 'score' and there is no series a
  // bathroom scale could move it with, so this metric is charted and never
  // aimed at.
  { key: 'inbodyScore', label: 'InBody Score', unit: 'pts', better: 'up', from: 'score', goalKind: null },
];

/**
 * The rest of the sheet: every metric `scans.metrics` carries that is not
 * already on this screen.
 *
 * Built from METRIC_DEFS rather than retyped, because a fourteenth metric added
 * to the reader has to appear here without anybody remembering to come and add
 * it — the failure this whole list replaces is nine figures that were extracted
 * for years and never drawn. The InBody score is the one exclusion and it is by
 * key, not by group: it is already above, read from the same scans, and listing
 * it twice would draw one metric under two headings.
 *
 * None of these can be aimed at. `goal_targets` has four kinds — weight, body
 * fat, muscle, and none of these — so `goalKind` is null throughout and the
 * target line simply does not draw. That is not the same as `goalMetric` on the
 * definition, which is about which DIRECTION is good rather than about a number
 * the member set.
 */
const INBODY_METRICS: MetricDef[] = METRIC_DEFS
  .filter((d) => d.key !== 'inbodyScore')
  .map((d) => ({
    // Prefixed, because 'weightKg' above and a metrics key could otherwise
    // collide in a React `key` and silently drop a chart.
    key: `scan:${d.key}`,
    label: d.label,
    unit: d.unit,
    // `better` is only the fallback here — see `metricIsProgress`, which
    // consults the member's own goal first where the definition says it should.
    better: d.better === 'down' ? 'down' : 'up',
    // NOT `weight: true`, even for the nine stored in kilograms. `weight` on
    // this screen means "read out by `weightIn`", which rounds to whole pounds
    // because that is the honest grain for a BODY weight. A 3.42 kg arm is not
    // a body weight and reading it that way would throw its second decimal on
    // the floor; src/lib/compositionUnit.ts is the rule these take instead.
    weight: false,
    from: 'scan' as const,
    goalKind: null,
    inbody: d,
    group: d.group,
  }));

const METRICS: MetricDef[] = [...BODY_METRICS, ...INBODY_METRICS];

export default function BodyTrends() {
  const t = useTheme();
  const router = useRouter();
  const cd = useClientData();
  const wu = useSettings().weightUnit;
  // The targets the member set on the Goals screen, which this screen — whose
  // whole subject is those figures moving — had never read. `useGoalTracker`
  // was imported by exactly two screens in the app and neither of them was a
  // body screen.
  const { goals, status: goalStatus, reload: reloadGoals } = useGoalTracker();
  // The scan history the curves are drawn from, and the targets drawn over
  // them. Both are server reads and both can fail on their own.
  const pull = usePullToRefresh(useCallback(() => { cd.reload(); reloadGoals(); }, [cd.reload, reloadGoals]));
  const scans = useMemo(() => [...(cd.scans || [])].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)), [cd.scans]);
  // The day `measuredNote` and `stalenessNote` are both measured against, and
  // it has to keep moving. A bare `todayISO()` in the render body is only right
  // at the moment something else happens to redraw (src/ui/today.ts says so in
  // those words), and this screen is reached from Progress and left mounted: a
  // member who opened it a fortnight ago and came back to it was reading
  // "14 days ago" under a figure that is now 28 days old, and STALE_AFTER_DAYS
  // — the threshold that decides whether the screen warns them at all — never
  // fired, because it was still being asked a fortnight-ago question.
  const today = useToday();
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
      // The rest of the sheet. Read through src/lib/inbodyMetrics.ts rather
      // than flattened here, so the "a scan that did not carry this metric
      // contributes nothing, never a zero" rule and the date-as-string sort are
      // asserted in a test instead of being retyped per screen. Every one of
      // these came off a printout, so 'scan' is not a guess about the source.
      case 'scan': return m.inbody
        ? metricReadings(scans, m.inbody.key).map((r) => ({ value: r.value, at: r.at, source: 'scan' as const }))
        : [];
    }
  };

  // A composition metric NOBODY has a reading for is dropped rather than drawn
  // empty. Most members' scans are typed in by hand — a gym scale gives a
  // weight and a body fat and no breakdown at all — and nine identical "this
  // comes off a photographed printout" panels between Weight and the bottom of
  // the screen is not information, it is the screen apologising nine times. The
  // sentence is said once instead, below, and only where it is the whole story.
  // The four published metrics are NEVER dropped: an empty one of those is a
  // statement about the member's own weigh-ins and has its own wording already.
  const byMetric = METRICS
    .map((m) => ({ m, readings: readingsFor(m) }))
    .filter(({ m, readings }) => m.from !== 'scan' || readings.length > 0);
  const anyComposition = byMetric.some(({ m }) => m.from === 'scan');
  // The screen's own summary line, and it must not say "scans" — most clients'
  // weight series is a mixture and a few clients' is weigh-ins only.
  //
  // Asked of the four PUBLISHED series only. The composition metrics below are
  // all read off scans and can only ever answer "scan", so folding them in
  // would tell a member whose weight comes off the check-in screen that their
  // figures are mixed when the mixture this sentence is about — a weigh-in
  // against a scan — is a fact about those four and nothing else.
  const allLatest = byMetric
    .filter(({ m }) => m.from !== 'scan')
    .map(({ readings }) => (readings.length ? readings[readings.length - 1] : null));
  const headNote = mixedSourceNote(allLatest);
  const anyTrend = byMetric.some(({ readings }) => readings.length > 1);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── header ─────────────────────────────────────────────────────── */}
        {/* The board's pushed-page head. What the page is drawn from — and
            how many scans that is, only when the read was whole — is the one
            quiet line under the title. */}
        <PageHead title="Composition Trends"
          subtitle={bodyWhole
            ? `Every body metric across ${scans.length} scan${scans.length === 1 ? '' : 's'}${cd.weightSeries.length > scanCount ? ' and your latest weigh-in' : ''}`
            : 'Every body metric you have on record'} />

        {/* Said once, at the top, and only when the figures below genuinely do
            come from different instruments or different days. This is the
            sentence that turns "these two screens disagree" into "these two
            figures were measured on different days", which is a fact about the
            client's month rather than a fault in the app. */}
        {headNote ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{headNote}</Text>
        ) : null}


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
              {/* "Add another scan" was the whole instruction and there was no
                  way to do it from here — the only other control on this screen
                  is the Back button. A Ghost rather than a Cta: a member on this
                  screen came to look at trends, and a full-width primary button
                  would read as the thing they came for. */}
              <View style={{ marginTop: sp.lg, alignSelf: 'flex-start' }}>
                <Ghost label="Add a Scan" a11yLabel="Add a body scan" onPress={() => router.push('/(client)/scans')} />
              </View>
            </>)}
          </Section>
        ) : (<>
          {byMetric.map(({ m, readings }, mi) => {
            // ── what this metric is read in, and at what grain ────────────
            //
            // Three rules, and which one applies is declared on the metric
            // rather than inferred from its value:
            //
            //   `weight`        a BODY weight, through `weightIn` — whole
            //                   pounds, the grain src/lib/units.ts argues for.
            //   a kg `inbody`   a composition mass, through
            //                   src/lib/compositionUnit.ts, which is finer
            //                   where the record is finer (0.01 kg limbs) and
            //                   identical to the above where it is not.
            //   anything else   a percentage, a score, a level, a kcal or a
            //                   litre. Not a mass, not converted, and it keeps
            //                   its own label for a pounds reader.
            const ib = m.inbody ?? null;
            const kgDp = ib?.decimals ?? 0;
            const mass = ib != null && isConvertibleMass(ib.unit);
            const show = (v: number) => (
              m.weight ? (weightIn(v, wu) ?? v)
                : mass ? (compositionIn(v, wu, kgDp) ?? v)
                  : v);
            const unit = m.weight ? wu : ib ? compositionUnitOf(ib.unit, wu) : m.unit;
            // The decimals the figure is PRINTED to, which is also the grain at
            // which "nothing moved" is judged — so a figure and the movement
            // under it can never disagree about whether something happened.
            // One for a weight in kilograms and for a body-fat percentage;
            // whole for pounds and for a score.
            const dp = ib ? (mass ? compositionDecimals(kgDp, wu) : kgDp) : (m.weight && wu === 'lb') || m.from === 'score' ? 0 : 1;
            // Through `numUpTo`, not interpolated. These figures were written
            // straight into the JSX, which spells a decimal point with a FULL
            // STOP in every locale there has ever been — so a German handset
            // showed 84.2 kg where 84,2 is what that reader parses, beside a
            // movement from `deltaLabel` that had already been localised. BMR
            // is the other half of it: it is the one metric on this screen that
            // passes a thousand, and a bare 1750 has no separator in it.
            const figure = (v: number) => numUpTo(v, dp);
            // The composition heading this metric sits under, drawn once above
            // the first metric that belongs to it. Nine charts in a row with no
            // headings is a list nobody can navigate; the four headings are the
            // ones the Progress table and the coach's table already use, so a
            // member moving between them is reading the same arrangement.
            // Read off `byMetric`, which is what is actually being drawn — METRICS
            // is the unfiltered list, and indexing the wrong one puts a heading
            // over the wrong metric the moment an empty one is dropped.
            const groupHead = m.group && (mi === 0 || byMetric[mi - 1].m.group !== m.group) ? m.group : null;
            if (readings.length < 2) return (
              <View key={m.key}>
                {mi > 0 ? <Rule /> : null}
                <Section>
                  {groupHead ? <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{groupHead}</Text> : null}
                  <SectionHead title={m.label} note={readings.length ? readingsLabel(readings) : undefined} />
                  {/* One reading is a reading, not a trend — so it is printed
                      with its date rather than withheld. A client who has been
                      scanned once has a real figure, and telling them there is
                      "not enough data" without showing it reads as though the
                      app has lost it. */}
                  {readings.length === 1 ? (
                    <Text style={{ ...ty.label, color: t.ink3 }}>
                      One reading so far — {figure(show(readings[0].value))}
                      {` ${unit}`} · {measuredNote(readings[0], today)}. A trend needs two.
                    </Text>
                  ) : (
                    <Text style={{ ...ty.label, color: t.ink3 }}>{m.from === 'score' ? 'InBody score reads from your scan once the AI reader is connected.'
                      // A composition metric is written only when a scan was
                      // read from a photograph of the printout, so "not enough
                      // data yet" would read as a fault in the app to somebody
                      // who has typed six scans in by hand. It is a statement
                      // about which KIND of scan they have, and it says so.
                      : m.from === 'scan' ? 'This one comes off a photographed InBody printout — a scan typed in by hand carries a weight and a body fat and none of the breakdown.'
                        : bodyWhole ? 'Not enough data yet.' : bodyStatus === 'loading' ? 'Reading…' : 'Nothing read for this one — see the note above.'}</Text>
                  )}
                </Section>
              </View>
            );
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
            //
            // Rounded to the grain the RECORD holds rather than to one decimal
            // for everything: a limb is stored to 0.01 kg, and flattening its
            // span to a tenth before converting would throw away the digit the
            // finer pound rule exists to carry.
            const rawF = 10 ** (ib ? kgDp : 1);
            const rawDelta = Math.round((readings[readings.length - 1].value - readings[0].value) * rawF) / rawF;
            const delta = (m.weight ? weightDeltaIn(rawDelta, wu) : mass ? compositionDeltaIn(rawDelta, wu, kgDp) : rawDelta) ?? rawDelta;
            // `better` is a fixed property of the metric, so Weight was 'down'
            // for everybody: a member training to Build Muscle saw the accent
            // dot — this screen's "moving the right way" — for losing the
            // weight they are working to put on. Their own goal decides it now,
            // and `undefined` where the goal has no opinion paints the neutral
            // mark rather than a verdict. `better` still stands for the InBody
            // Score, which is a composite no goal wants lower.
            //
            // Zero is undefined too, on both paths: an unchanged reading is
            // neither moving the right way nor the wrong one.
            // The goal line, computed from the SAME readings the chart plots
            // rather than from `cd.weightSeries` a second time — a target
            // measured against a different series from the figure above it is
            // exactly the "two screens, one body, two answers" this file's
            // header was written about, reproduced inside one screen.
            /* ── how fast, as opposed to how much ───────────────────────────
             *
             * The line above says the total change since the first reading, and
             * a member three months into a cut reads the same growing number
             * for weeks while the weekly loss quietly falls to nothing. This is
             * the other half, and the rules it follows are src/lib/bodyRate.ts':
             *
             *   · it refuses a window shorter than MIN_TREND_DAYS rather than
             *     dividing two weigh-ins a day apart into a weekly figure;
             *   · it NAMES the window it measured, so a rate over a truncated
             *     read is a true statement about the days it had rather than a
             *     claim about the member's training block;
             *   · the decimals are derived from that window, because a rate is
             *     a difference divided by weeks and the grain of the readings
             *     is divided with it. Whole-pound weights over a fortnight
             *     print whole pounds a week; ten weeks of them earn a tenth.
             *
             * The per-week SPAN converts once, unrounded, and is rounded at the
             * grain above — never `weightDeltaIn`, which rounds to the grain of
             * a single BODY WEIGHT and would flatten every real rate under half
             * a pound a week to "holding steady" for a pounds reader.
             */
            const massLike = !!m.weight || mass;
            const rateAns = rateOf(readings.map((r) => ({ at: r.at, value: r.value })));
            const ratePerWeek = rateAns.rate
              ? (massLike && wu === 'lb' ? rateAns.rate.perWeek / KG_PER_LB : rateAns.rate.perWeek)
              : null;
            // One endpoint step in the unit this metric is PRINTED in, which is
            // exactly what `dp` above already decided.
            const rateDp = rateAns.rate ? rateDecimals(10 ** -dp, rateAns.rate.days) : 0;
            const rateGap = rateGapNote(rateAns.gap, rateAns.days);
            const gk = m.goalKind;
            const target = gk && isWhole(goalStatus)
              ? goalOnBody(goalOfKind(goals, gk), readings.map((r) => ({ t: r.at, v: r.value })), { weight: !!m.weight, unit: m.unit, wu })
              : null;
            const improving: boolean | undefined = m.from === 'score'
              ? (rawDelta > 0 ? true : rawDelta < 0 ? false : undefined)
              // The composition metrics ask their own definition, which
              // consults the member's goal where it has an opinion — fat mass
              // gained during a deliberate bulk gets the neutral mark, not the
              // wrong-way one — and falls back to the metric's own direction
              // for the health readings no goal disputes. Judged on `delta`,
              // the movement the member can actually SEE, so a change too small
              // to print in pounds cannot arrive carrying a verdict.
              : m.from === 'scan' ? (ib ? metricIsProgress(ib, delta, cd.goal, dp) : undefined)
                : movementIsProgress(rawDelta, cd.goal, m.from);
            return (
              <View key={m.key}>
                {mi > 0 ? <Rule /> : null}
                <Section>
                  {groupHead ? <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>{groupHead}</Text> : null}
                  <SectionHead title={m.label} note={readingsLabel(readings)} />
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                      <Text style={{ ...value(26), color: t.ink }}>{figure(last)}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginStart: 3 }}>{unit}</Text>
                    </View>
                    {delta !== 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: improving ? t.brand : t.ink3 }} />
                        {/* "since your first scan" was wrong the moment the
                            first point was a weigh-in. The date it is actually
                            measured from is printed instead of guessed at.
                            `decimals` is the metric's own grain: at the default
                            of one, a limb's 0.05 kg movement printed as "+0.1"
                            beside a figure carrying two decimals. */}
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{deltaLabel(delta, { since: dayLabel(readings[0].at), unit, decimals: dp })}</Text>
                      </View>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3 }}>No change since {dayLabel(readings[0].at)}</Text>
                    )}
                  </View>
                  {/* The date and instrument behind the big number above it.
                      "Need to see the dates the weight was measured as well" —
                      this is that line, on every metric on the screen.

                      Directly under the figure, ahead of the rate and the
                      target: the review's order is the value, then where and
                      when it came from, then how it moved. A reader deciding
                      whether to believe a number needs its date before they
                      need its slope. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{measuredNote(now, today)}</Text>
                  {stale ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{stale}</Text> : null}
                  {/* ── the rate ──────────────────────────────────────────
                      Through `deltaLabel` like every other movement in this
                      app, so the sign, the zero case and the separator are the
                      house's rather than this screen's — "Holding steady"
                      replaces "No change" only because a rate that rounds to
                      nothing is a statement about a body rather than about two
                      readings. The window is printed beside it: a rate whose
                      period is not stated is a rate nobody can check, and under
                      a truncated read it is the difference between a true
                      sentence and a claim about a training block. */}
                  {rateAns.rate ? (
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink2, marginTop: 4 }}>
                      {deltaLabel(ratePerWeek, { since: null, unit: `${unit}/wk`, decimals: rateDp, noChange: 'Holding steady' })}
                      {` over the last ${rateAns.rate.days} days`}
                    </Text>
                  ) : rateGap ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{rateGap}</Text>
                  ) : null}
                  {/* What this metric is aiming at, and how far there is left.
                      Under a failed goal read this is simply absent — an empty
                      `goals` list under 'error' means the targets could not be
                      read, not that none were set, and "no target" printed off
                      a dropped connection would tell somebody their goal had
                      been lost. Absence claims nothing either way. */}
                  {target ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      {/* A mark, not ink. t.brand carries the "reached" state
                          and the neutral ring carries "still going", because
                          the sentence beside it already says which. */}
                      <View accessibilityElementsHidden importantForAccessibility="no"
                        style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: target.reached ? t.brand : t.ink3 }} />
                      <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{target.note}</Text>
                    </View>
                  ) : null}
                  <View style={{ height: sp.md }} />
                  {/* The two end dates that used to sit in the row below are
                      now the chart's own axis, drawn from the same array it
                      plots — so they cannot drift from the points the way a
                      row assembled beside a chart can. What is left underneath
                      is the part the axis does not say: where the series
                      starts and how far it ranges. */}
                  <Spark data={vals} labels={readings.map((r) => r.at)} unit={` ${unit}`} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>first {figure(first)} {unit}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>range {figure(min)}–{figure(max)} {unit}</Text>
                  </View>
                </Section>
              </View>
            );
          })}
          {/* Said once, at the bottom, and only when it is the whole story:
              this member has trends to read and not one of them is a
              composition metric. The nine panels that would otherwise sit here
              are dropped (see `byMetric`), so without this line the feature
              would be invisible to exactly the people who have never used it.

              Only under a whole read. Under 'error' or 'partial' `cd.scans` is
              a fragment, and "you have never had a sheet read" is not something
              a read that did not land may say to somebody about their own
              record — the Notice at the top of this screen already carries
              that case. */}
          {!anyComposition && bodyWhole ? (
            <View>
              <Rule />
              <Section>
                <SectionHead title="The Rest of the Sheet" />
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  Visceral fat, BMR, fat and lean mass, each arm and leg, body water, protein and minerals
                  graph here too — but only from a scan added by photographing the InBody printout. A scan
                  typed in by hand carries a weight and a body fat, and nothing this part can draw.
                </Text>
                <View style={{ marginTop: sp.lg, alignSelf: 'flex-start' }}>
                  <Ghost label="Add a Scan" a11yLabel="Add a body scan from a printout" onPress={() => router.push('/(client)/scans')} />
                </View>
              </Section>
            </View>
          ) : null}
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}
