// Coach · What a client actually logged, day by day.
//
// ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
//
// `food_logs` has had a coach read policy since part 01 — `food_trainer_read`,
// keyed on the coaching link — and until now the entire coach-side use of it
// was six rows on the dashboard's client sheet, read as `name, kcal, via`. A
// coach selling online nutrition could see six food names and nothing else:
// not a day's total, not how many days somebody had logged at all.
//
// The permission was never the problem. Nobody had written the query.
//
// ── WHY IT IS NOT ON THE NUTRITION SCREEN ──────────────────────────────────
//
// app/(trainer)/client-nutrition.tsx refuses this deliberately, and its header
// says why: that screen is where a coach AUTHORS a week, and "mixing the two
// would put a coach's authoring inside a record only the client may add to".
// That reasoning is right and is not weakened by reading the record somewhere
// else. This screen writes nothing, offers no control that could, and links
// back to the plan rather than embedding it.
//
// ── WHAT IT REFUSES TO SAY ─────────────────────────────────────────────────
//
// It does not score a day or a week. There is no compliance percentage, no
// green tick, no "on track" — the app does not know what somebody's week was
// like and the coach reading it does.
//
// It does not draw an unlogged day as a zero. A day with no rows is reported
// as no rows, because "they ate nothing" and "they logged nothing" are
// different claims and only one of them is knowable from this table. The
// sentence at the top carries how many days of the span were logged at all,
// for the same reason: a weekly average over two logged days is a statement
// about two days wearing a week's clothes.
//
// It says when a figure came from a photograph. A photo estimate is this app's
// reading of a picture rather than a label somebody scanned, and a coach about
// to tell somebody they are 300 kcal over should know which it was.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Ghost, Notice, PageHead, PartialRead, Rule, Section, SectionHead } from '../../src/ui/kit';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useRoster } from '../../src/ui/roster';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useBackFromHub } from '../../src/ui/backTo';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, ROW_CAP } from '../../src/lib/rowCap';
import { num } from '../../src/lib/format';
import { fmtRelativeDay } from '../../src/lib/format';
import { hairline, layout, sp, type as ty, font } from '../../src/theme/scale';
import {
  foodDays, loggedOf, loggedLine, type FoodLogRow,
} from '../../src/lib/clientFoodDays';

/** Literal on the line, not imported: scripts/check-schema.mjs can only verify
 *  a select list it can read, and `workouts.session_mins` is why that check
 *  exists. */
const COLS = 'logged_at, name, kcal, protein, carbs, fat, via';

/** The window this screen reads and states. Two weeks rather than one: a
 *  coach looking at a Monday wants the Monday before it, and a fortnight is
 *  still small enough to arrive under the row cap for anybody logging
 *  ordinarily. */
const SPAN_DAYS = 14;

export default function ClientFood() {
  const t = useTheme();
  const router = useRouter();
  const goBack = useBackFromHub('(trainer)');
  const { roster, status: rosterStatus } = useRoster();
  const params = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const clientId = typeof params.clientId === 'string' && params.clientId ? params.clientId : null;

  const [rows, setRows] = useState<FoodLogRow[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const pull = usePullToRefresh(reload);

  const who = useMemo(() => {
    const named = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : null;
    const onRoster = clientId ? roster.find((c) => c.id === clientId)?.name ?? null : null;
    return named ?? onRoster ?? 'This client';
  }, [params.name, clientId, roster]);
  const firstName = who.split(' ')[0] || who;

  useEffect(() => {
    let live = true;
    if (!USE_SUPABASE || !clientId) { setStatus('ready'); setRows([]); return () => { live = false; }; }
    (async () => {
      setStatus('loading');
      // Bounded by date as well as by the cap, so the fortnight this screen
      // claims is the fortnight it read.
      const since = new Date(Date.now() - SPAN_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase.from('food_logs').select(COLS)
        .eq('client_id', clientId)
        .gte('logged_at', since)
        .order('logged_at', { ascending: false })
        .limit(capLimit());
      if (!live) return;
      if (error) {
        // Null, never []. An empty list under 'error' renders as "they logged
        // nothing", which is an accusation about a person manufactured by a
        // failed read.
        reportError('clientFood.list', error, { clientId });
        setRows(null); setStatus('error');
        return;
      }
      const got = (data ?? []) as FoodLogRow[];
      setRows(got);
      setStatus(got.length >= ROW_CAP ? 'partial' : 'ready');
    })();
    return () => { live = false; };
  }, [clientId, tick]);

  const days = useMemo(() => foodDays(rows), [rows]);
  const counted = useMemo(() => loggedOf(days, SPAN_DAYS), [days]);
  const line = loggedLine({ ...counted, whole: isWhole(status), who: firstName });
  const G = layout.gutter;

  /** One day. Entries first, because "three things" is what tells a coach
   *  whether the total below is a day's eating or a single breakfast. */
  const dayRow = (d: ReturnType<typeof foodDays>[number], i: number) => (
    <View key={d.day} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
      <View accessible accessibilityLabel={[
        fmtRelativeDay(`${d.day}T12:00:00`),
        `${d.entries} ${d.entries === 1 ? 'entry' : 'entries'}`,
        `${num(d.kcal)} kilocalories`,
        `protein ${num(d.protein)} grams, carbohydrate ${num(d.carbs)} grams, fat ${num(d.fat)} grams`,
        d.anyFromPhoto ? 'Some of this was read from a photograph' : null,
      ].filter(Boolean).join('. ')}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
          <Text style={{ ...ty.body, ...font('600'), color: t.ink, flex: 1 }}>
            {fmtRelativeDay(`${d.day}T12:00:00`)}
          </Text>
          <Text style={{ ...ty.body, color: t.ink }}>{`${num(d.kcal)} kcal`}</Text>
        </View>
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>
          {`${d.entries} ${d.entries === 1 ? 'entry' : 'entries'} · P ${num(d.protein)}g · C ${num(d.carbs)}g · F ${num(d.fat)}g`}
        </Text>
        {d.anyFromPhoto ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            Some of this day was read from a photograph rather than scanned, so the figures are an estimate.
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false} refreshControl={pull}>
        <PageHead title="What They Logged" subtitle={who} onBack={goBack} />

        {!clientId ? (
          <Notice tone={t.warn} kicker="Food Log" title="No Client Was Named"
            note="Open this from a client to read what they have logged. It is one person's record and there is no list of everybody's." />
        ) : status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xl, textAlign: 'center' }}>
            Reading what they logged…
          </Text>
        ) : status === 'error' ? (
          <Notice tone={t.warn} kicker="Food Log" title="This Could Not Be Read"
            note="This is our end, not yours. It says nothing about whether they have been logging. Pull down to try again once you have signal." />
        ) : isWhole(rosterStatus) && roster.length === 0 ? (
          <EmptyRoster lacks="there is nobody whose food log you could read" />
        ) : (
          <>
            {status === 'partial' ? (
              <PartialRead what="entries" shown={days.length} onPress={reload} />
            ) : null}

            <Section>
              {/* The count of logged days comes first, because every figure
                  under it has to be read through it. */}
              {line ? <Text style={{ ...ty.label, color: t.ink2 }}>{line}</Text> : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {`The last ${num(SPAN_DAYS)} days, as they logged them. This screen reads their record and writes nothing to it.`}
              </Text>
              <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                <Ghost label="Their Plan" icon="meals"
                  a11yLabel={`Open the nutrition plan you set for ${firstName}`}
                  onPress={() => router.push({ pathname: '/(trainer)/client-nutrition', params: { clientId, name: who } } as any)} />
              </View>
            </Section>

            <Rule />
            <Section>
              <SectionHead title="Day by Day"
                note={days.length ? `${num(days.length)} ${days.length === 1 ? 'day' : 'days'}` : undefined} />
              {days.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                  {`Nothing logged in the last ${num(SPAN_DAYS)} days. The food log is theirs to fill in, and an empty one is not a statement about what they ate.`}
                </Text>
              ) : days.map(dayRow)}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
