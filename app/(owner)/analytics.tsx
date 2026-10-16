// Studio Analytics: the owner's view of the gym in one screen.
//
// Every figure comes from one secure RPC, owner_studio_analytics
// (supabase/parts/3510), which resolves the gym from the signed-in owner and
// returns aggregates only. Nothing here names a member. Unknown stays
// unknown: a failed read is said as one and never drawn as zeros, revenue is
// never added across currencies, and the InBody averages are withheld below
// three members.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, KpiRow, Flag, PageHead, Segmented, Meter } from '../../src/ui/kit';
import { num } from '../../src/lib/format';
import { sp, layout, hairline, type as ty, numeric } from '../../src/theme/scale';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { money } from '../../src/lib/gymRecord';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { parseStudioAnalytics, signed, type StudioAnalytics } from '../../src/lib/studioAnalytics';

const RANGES = [
  { key: '30', label: '30 Days' },
  { key: '90', label: '90 Days' },
  { key: '365', label: '12 Months' },
] as const;
type RangeKey = typeof RANGES[number]['key'];

export default function StudioAnalyticsScreen() {
  const t = useTheme();
  const G = layout.gutter;
  const [range, setRange] = useState<RangeKey>('90');
  const [data, setData] = useState<StudioAnalytics | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'none'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const { data: raw, error } = await supabase.rpc('owner_studio_analytics', { p_days: Number(range) });
      if (error) throw error;
      const parsed = parseStudioAnalytics(raw);
      setData(parsed);
      setState(parsed ? 'ready' : 'none');
    } catch (e) {
      reportError('studioAnalytics.load', e);
      setState('error');
    }
  }, [range]);
  useEffect(() => { void load(); }, [load]);
  const pull = usePullToRefresh(load);

  const d = state === 'ready' ? data : null;
  const maxSessions = d ? Math.max(1, ...d.sessionsPerCoach.map((c) => c.sessions)) : 1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>
        <PageHead title="Studio Analytics" />
        <Segmented options={RANGES} value={range} onChange={setRange} style={{ marginTop: sp.lg }} />

        {state === 'loading' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.xl }}>
            <ActivityIndicator size="small" color={t.ink3} />
            <Text style={{ ...ty.caption, color: t.ink3 }}>Reading your gym’s figures…</Text>
          </View>
        ) : state === 'error' ? (
          <Flag tone={t.warn} style={{ marginTop: sp.xl }}>Your analytics could not be read. These are not zeros. Pull down to try again.</Flag>
        ) : state === 'none' ? (
          <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.xl }}>This account does not own a gym on Repple, so there is nothing to count.</Text>
        ) : d ? (
          <>
            <View style={{ marginTop: sp.lg }}>
              <KpiRow tiles items={[
                { label: 'Active Members', value: num(d.activeMemberships), tone: 'brand' },
                { label: 'Training (30d)', value: num(d.trainingMembers), tone: 'blue' },
                { label: 'Retention', value: d.retention.pct == null ? '–' : `${num(d.retention.pct)}%`, tone: 'purple' },
              ]} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                {d.retention.pct == null
                  ? `No memberships were live ${d.days} days ago, so there is no retention to measure yet.`
                  : `${num(d.retention.retained)} of the ${num(d.retention.base)} members active ${d.days} days ago are still active.`}
              </Text>
            </View>

            <Section>
              <SectionHead title="Sessions per Coach" note={`Last ${d.days} days`} />
              {d.sessionsPerCoach.length === 0 ? (
                <Text style={{ ...ty.body, color: t.ink2 }}>No booked sessions in this window.</Text>
              ) : d.sessionsPerCoach.map((c, i) => (
                <View key={c.trainerId} style={{ paddingVertical: sp.sm, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                  <Meter label={c.name} val={c.sessions} target={maxSessions} unit="" />
                </View>
              ))}
            </Section>

            <Section>
              <SectionHead title="Revenue" note={`Last ${d.days} days`} />
              {d.revenue.length === 0 ? (
                <Text style={{ ...ty.body, color: t.ink2 }}>No payments recorded in this window.</Text>
              ) : d.revenue.map((r) => (
                <View key={r.currency} style={{ marginBottom: sp.md }}>
                  <Text style={{ ...ty.title, ...numeric, color: t.ink }}>{money(r.cents, r.currency === '?' ? null : r.currency) ?? `${num(r.cents / 100)} (currency not stated)`}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    {r.months.map((m) => `${m.month}: ${money(m.cents, r.currency === '?' ? null : r.currency) ?? num(m.cents / 100)}`).join(' · ')}
                  </Text>
                </View>
              ))}
              {d.revenue.length > 1 ? (
                <Text style={{ ...ty.caption, color: t.ink3 }}>Shown per currency. Amounts in different currencies are not added together.</Text>
              ) : null}
            </Section>

            <Section>
              <SectionHead title="InBody Progress" note={`${num(d.inbody.scannedMembers)} scanned`} />
              {d.inbody.repeatMembers < d.inbody.minGroup ? (
                <Text style={{ ...ty.body, color: t.ink2 }}>
                  {`Averages appear once at least ${d.inbody.minGroup} members have two or more InBody scans (${num(d.inbody.repeatMembers)} so far), so no one member's body is ever shown as a gym figure.`}
                </Text>
              ) : (
                <KpiRow items={[
                  { label: 'Body Fat', value: signed(d.inbody.avgBodyFatChange) ?? '–', unit: '%' },
                  { label: 'Muscle', value: signed(d.inbody.avgMuscleChangeKg) ?? '–', unit: 'kg' },
                  { label: 'Weight', value: signed(d.inbody.avgWeightChangeKg) ?? '–', unit: 'kg' },
                ]} />
              )}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Average change from each member’s first to latest InBody scan, across {num(d.inbody.repeatMembers)} members with two or more.
              </Text>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
