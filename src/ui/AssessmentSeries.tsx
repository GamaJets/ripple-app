// One test's record, as both apps draw it: the latest result, the change since
// the one before (green only when that change is an improvement for THIS test),
// a small chart, and every earlier result underneath when opened. The coach's
// screen passes `onRecord` and `onDelete`; the client's passes neither, so the
// two apps draw the same rows the same way and only the coach can act on them.
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from './components';
import { Section, SectionHead, Spark, Rule, Ghost } from './kit';
import { sp, type as ty, numeric } from '../theme/scale';
import { fmtDay } from '../lib/format';
import type { WeightUnit } from '../lib/units';
import {
  compareToPrevious, totalLabel, changeLabel, detailLines, chartValue, chartUnit, type Series, type Assessment,
} from '../lib/assessments';

export function AssessmentSeries({ series, wu, onRecord, onDelete }: {
  series: Series;
  wu: WeightUnit;
  onRecord?: () => void;
  onDelete?: (a: Assessment) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const cmp = compareToPrevious(series.history, series.direction);
  if (!cmp) return null;
  const { latest, previous } = cmp;
  const tone = cmp.verdict === 'better' ? t.good : cmp.verdict === 'worse' ? t.warn : t.ink3;
  const change = changeLabel(cmp, wu, previous ? fmtDay(previous.recordedAt) : null);
  const points = series.history.map((a) => chartValue(a, wu));
  const newestFirst = [...series.history].reverse();

  return (
    <Section>
      <SectionHead title={series.label} note={`${series.history.length} on record`} />
      <View accessible accessibilityLabel={`${series.label}. Latest ${totalLabel(latest, wu) ?? 'result not readable'}, ${fmtDay(latest.recordedAt)}. ${change}.`}>
        <Text style={{ ...ty.title, ...numeric, color: t.ink }}>{totalLabel(latest, wu) ?? 'Result not readable'}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{fmtDay(latest.recordedAt)}</Text>
        <Text style={{ ...ty.label, color: tone, marginTop: sp.sm }}>{change}</Text>
      </View>
      {points.filter((p) => p != null).length > 1 ? (
        <View style={{ marginTop: sp.md }}>
          <Spark data={points} labels={series.history.map((a) => a.recordedAt.slice(0, 10))} unit={chartUnit(latest, wu)} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
        <Ghost label={open ? 'Hide History' : 'Show History'} onPress={() => setOpen((o) => !o)} />
        {onRecord ? <Ghost label="Record Again" icon="plus" onPress={onRecord} a11yLabel={`Record ${series.label} again`} /> : null}
      </View>
      {open ? newestFirst.map((a) => (
        <View key={a.id} style={{ marginTop: sp.md }}>
          <Rule />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: sp.md }}>
            <Text style={{ ...ty.head, color: t.ink }}>{fmtDay(a.recordedAt)}</Text>
            <Text style={{ ...ty.head, ...numeric, color: t.ink }}>{totalLabel(a, wu) ?? 'Not readable'}</Text>
          </View>
          {detailLines(a, wu).map((l) => (
            <Text key={l} style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{l}</Text>
          ))}
          {a.notes ? <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>{a.notes}</Text> : null}
          {onDelete ? (
            <Pressable onPress={() => onDelete(a)} accessibilityRole="button" accessibilityLabel={`Delete the ${series.label} test from ${fmtDay(a.recordedAt)}`}
              style={{ marginTop: sp.sm, alignSelf: 'flex-start', paddingVertical: 6 }}>
              <Text style={{ ...ty.label, color: t.ink2, textDecorationLine: 'underline' }}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      )) : null}
    </Section>
  );
}
