// Coach · This week, across everybody.
//
// ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
//
// A coach had two views of their book and nothing between them: a client
// screen, one person at a time, and the drift bands on the dashboard, which
// are an aggregate — "three slipping, one at risk". Neither answers "what
// happened this week", which is the question somebody asks on a Monday
// morning before they start writing messages.
//
// The member's own app has had exactly this screen since app/(client)/activity.tsx
// and the counting module behind it, src/lib/activityFeed.ts, was imported by
// that screen and by nothing else. So the coach's version reuses the counting
// and adds the merge: many people's events on one timeline with names on them
// (src/lib/bookFeed.ts).
//
// ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
//
// It does not rank. Newest first and nothing else decides the order — a feed
// sorted by anything else is this app telling a coach whose week mattered
// more, which it cannot know.
//
// It does not draw an absence. A client who did nothing has no rows here, and
// that is not rendered as an event: the dashboard already says "nothing
// recorded" properly, over a window long enough to mean it. A quiet week in a
// seven-day feed is not news.
//
// It states no figures over a read that did not land. Two tables feed this
// and either can fail; `bookLine` is handed whether both landed and says so
// instead of counting. "4 of 12 trained" over a failed read is a claim about
// eight people, and it is exactly the sort of number a coach acts on.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Notice, PageHead, PartialRead, Rule, Section, SectionHead } from '../../src/ui/kit';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useRoster } from '../../src/ui/roster';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useBackFromHub } from '../../src/ui/backTo';
import { useToday } from '../../src/ui/today';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, ROW_CAP } from '../../src/lib/rowCap';
import { num, fmtRelativeDay } from '../../src/lib/format';
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { hairline, layout, sp, type as ty, font } from '../../src/theme/scale';
import {
  bookFeed, bookTally, activePeople, bookLine, BOOK_WINDOW_DAYS, type BookEvent,
} from '../../src/lib/bookFeed';

/* Literals on the line, for scripts/check-schema.mjs — a select list arriving
 * by import is a read it cannot verify against the live database. */
const WORKOUT_COLS = 'id, user_id, performed_at, exercise';
const CHECKIN_COLS = 'id, user_id, at';

export default function BookWeek() {
  const t = useTheme();
  const router = useRouter();
  const goBack = useBackFromHub('(trainer)');
  const { roster, status: rosterStatus } = useRoster();
  // `useToday()` and not a clock read in the body: this screen sits open on a
  // tab that is mounted once, and a week that stopped moving at midnight is
  // the defect scripts/check-frozen-day.mjs exists for.
  const today = useToday();
  const nowMs = useMemo(() => Date.parse(`${today}T23:59:59`), [today]);

  const [workouts, setWorkouts] = useState<Record<string, unknown>[] | null>(null);
  const [checkins, setCheckins] = useState<Record<string, unknown>[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const pull = usePullToRefresh(reload);

  const ids = useMemo(() => roster.filter((c) => !c.handAdded).map((c) => c.id), [roster]);
  const names = useMemo(() => new Map(roster.map((c) => [c.id, c.name])), [roster]);

  useEffect(() => {
    let live = true;
    if (!USE_SUPABASE || ids.length === 0) {
      setWorkouts([]); setCheckins([]); setStatus(isWhole(rosterStatus) ? 'ready' : 'loading');
      return () => { live = false; };
    }
    (async () => {
      setStatus('loading');
      const since = new Date(Date.now() - BOOK_WINDOW_DAYS * 86_400_000).toISOString();
      const [w, c] = await Promise.all([
        supabase.from('workouts').select(WORKOUT_COLS)
          .in('user_id', ids).gte('performed_at', since)
          .order('performed_at', { ascending: false }).limit(capLimit()),
        supabase.from('check_ins').select(CHECKIN_COLS)
          .in('user_id', ids).gte('at', since)
          .order('at', { ascending: false }).limit(capLimit()),
      ]);
      if (!live) return;
      // Either half failing makes the whole week uncountable, and the screen
      // says so rather than drawing the half that landed as the week.
      if (w.error || c.error) {
        reportError('bookWeek.read', w.error ?? c.error);
        setWorkouts(null); setCheckins(null); setStatus('error');
        return;
      }
      const got = { w: (w.data ?? []) as Record<string, unknown>[], c: (c.data ?? []) as Record<string, unknown>[] };
      setWorkouts(got.w);
      setCheckins(got.c);
      // Either half hitting the row cap makes the week a sample of itself, and
      // this used to say 'ready' regardless — so `whole` was true, `bookLine`
      // printed its figures, and a coach with thirty clients read a count of
      // the newest 500 workouts as the count of the week. `isWhole` excludes
      // 'partial', so one word here is what stops the sentence being written.
      setStatus(got.w.length >= ROW_CAP || got.c.length >= ROW_CAP ? 'partial' : 'ready');
    })();
    return () => { live = false; };
  }, [ids, rosterStatus, tick]);

  /** Both tables as one list of events, named. Rows the roster cannot name are
   *  dropped rather than drawn as "Client": a feed row whose subject nobody
   *  can identify is a row a coach cannot act on. */
  const events = useMemo<BookEvent[]>(() => {
    const out: BookEvent[] = [];
    for (const r of workouts ?? []) {
      const id = typeof r.user_id === 'string' ? r.user_id : null;
      const at = typeof r.performed_at === 'string' ? r.performed_at : null;
      const name = id ? names.get(id) : null;
      if (!id || !at || !name) continue;
      out.push({ clientId: id, name, kind: 'workout', at, detail: typeof r.exercise === 'string' ? r.exercise : null });
    }
    for (const r of checkins ?? []) {
      const id = typeof r.user_id === 'string' ? r.user_id : null;
      const at = typeof r.at === 'string' ? r.at : null;
      const name = id ? names.get(id) : null;
      if (!id || !at || !name) continue;
      out.push({ clientId: id, name, kind: 'checkin', at });
    }
    return out;
  }, [workouts, checkins, names]);

  const feed = useMemo(() => bookFeed(events, nowMs), [events, nowMs]);
  const tally = useMemo(() => bookTally(events, nowMs), [events, nowMs]);
  const whole = isWhole(status) && isWhole(rosterStatus);
  const line = bookLine({
    tally,
    // `events`, not `feed`: the feed is capped at 60 rows and the tally is
    // counted over the whole window, so counting people off the capped list
    // put "190 workouts … from 11 of your 30" in one sentence, where the two
    // figures were measured on different sets.
    people: activePeople(events, nowMs),
    onBook: isWhole(rosterStatus) ? roster.length : null,
    whole,
  });
  const G = layout.gutter;

  const row = (e: BookEvent, i: number) => {
    const what = e.kind === 'checkin' ? 'Sent a check-in'
      : e.kind === 'pr' ? 'Set a personal record'
      : e.detail ? `Trained · ${e.detail}`
      : 'Logged a workout';
    return (
      <Pressable key={`${e.clientId}-${e.at}-${i}`}
        onPress={() => router.push({ pathname: '/(trainer)/client', params: { clientId: e.clientId, name: e.name } } as any)}
        accessibilityRole="button"
        accessibilityLabel={`${e.name}. ${what}. ${fmtRelativeDay(e.at)}. Opens their page`}
        hitSlop={hitSlopFor(MIN_TARGET)}
        style={{ paddingVertical: sp.md, minHeight: MIN_TARGET, justifyContent: 'center',
                 borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm }}>
          <Text style={{ ...ty.body, ...font('600'), color: t.ink, flex: 1 }}>{e.name}</Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>{fmtRelativeDay(e.at)}</Text>
        </View>
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{what}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false} refreshControl={pull}>
        <PageHead title="This Week" subtitle="What your clients did" onBack={goBack} />

        {status === 'loading' ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xl, textAlign: 'center' }}>
            Reading your clients’ week…
          </Text>
        ) : status === 'error' ? (
          <Notice tone={t.warn} kicker="This Week" title="This week could not be read"
            note="This is our end, not yours. It says nothing about whether your clients trained. Pull down to try again once you have signal." />
        ) : isWhole(rosterStatus) && roster.length === 0 ? (
          <EmptyRoster lacks="there is nobody whose week this would be" />
        ) : (
          <>
            {!isWhole(rosterStatus) ? (
              <PartialRead what="clients" shown={roster.length} onPress={reload} />
            ) : null}
            {status === 'partial' ? (
              <PartialRead what="this week’s records" shown={feed.length} onPress={reload} />
            ) : null}

            <Section>
              {line ? <Text style={{ ...ty.label, color: t.ink2 }}>{line}</Text> : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {`Workouts and check-ins from the last ${num(BOOK_WINDOW_DAYS)} days, newest first. Nobody is ranked, and a client who did nothing has no row here rather than an empty one.`}
              </Text>
            </Section>

            <Rule />
            <Section>
              <SectionHead title="Newest First"
                note={whole && feed.length ? `${num(feed.length)}` : undefined} />
              {feed.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                  {whole
                    ? 'Nothing in the last seven days. Who has gone quiet for longer than that is on your dashboard, where the window is long enough to mean something.'
                    : 'Not everything could be read, so this is not the whole week.'}
                </Text>
              ) : feed.map(row)}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
