// Client · My Assessments. The tests a coach recorded with this member, read
// from the same `assessments` rows the coach's screen writes
// (app/(trainer)/assessments.tsx), so the two apps show one record. Read-only:
// the server refuses a member's writes, and this screen offers none.
import { useMemo } from 'react';
import { Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/ui/components';
import { isWhole } from '../../src/ui/loadStatus';
import { PageHead, Notice, Section } from '../../src/ui/kit';
import { sp, layout, type as ty } from '../../src/theme/scale';
import { useAuth } from '../../src/ui/auth';
import { useSettings } from '../../src/ui/settings';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useRefreshOnFocus } from '../../src/ui/refreshOnFocus';
import { useAssessments } from '../../src/ui/assessments';
import { AssessmentSeries } from '../../src/ui/AssessmentSeries';
import { groupSeries } from '../../src/lib/assessments';

export default function MyAssessments() {
  const t = useTheme();
  const { user } = useAuth();
  const wu = useSettings().weightUnit;
  const a = useAssessments(user?.id ?? null);
  const pull = usePullToRefresh(a.reload);
  useRefreshOnFocus(a.reload);
  const series = useMemo(() => groupSeries(a.list), [a.list]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false} refreshControl={pull}>
        <PageHead title="My Assessments" subtitle="Tests your coach recorded with you" />

        {a.status === 'error' ? (
          <Notice tone={t.crit} kicker="Not Loaded" title="Your tests could not be read"
            note="This is a failed read, not an empty record. Pull down to try again." />
        ) : a.status === 'partial' ? (
          <Notice tone={t.warn} kicker="Partial" title="Only part of your history came back" />
        ) : null}

        {!series.length && isWhole(a.status) ? (
          <Section>
            <Text style={{ ...ty.body, color: t.ink2 }}>
              {a.status === 'loading'
                ? 'Reading your tests…'
                : 'No tests on record yet. When your coach records a movement screen, strength test, mobility check or their own test, it appears here with every result after it, so you can see how you are improving.'}
            </Text>
          </Section>
        ) : null}

        {series.map((s) => <AssessmentSeries key={s.key} series={s} wu={wu} />)}
        {series.length ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Green means better for that test. For a few tests, such as a timed one, better is lower.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
