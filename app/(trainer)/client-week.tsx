// Coach · Their week. What one client has told the calendar they intend to do.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// `planned_days` shipped with a coach policy on it — `planned_days_coach_read`,
// SELECT on `is_my_client(client_id)` — written so that a coach could see this,
// and then nothing read it. The client could mark Thursday as travel and Friday
// as legs and the only person who could see either was the client. A coach
// spent Friday chasing a session that had been called off on Sunday, which is
// the difference this screen is for: knowing a session was never going to
// happen rather than discovering afterwards that it did not.
//
// ── It reads, and it cannot write ─────────────────────────────────────────
//
// There is no edit control here and there is not going to be one. The policy
// grants SELECT and nothing else on purpose, and src/lib/plannedDays.ts has no
// coach-side write for the same reason `client-goals.tsx` has no Done button: a
// plan is the client's own statement of what they mean to do, and a coach
// quietly editing it would turn the client's calendar into an assignment. That
// is what `assigned_programs` already is. A coach who disagrees with a planned
// rest day has the messaging thread, and the disagreement is shown to both of
// them rather than settled behind one of their backs.
//
// ── NO MARKED DAY IS EVER DRAWN AS SOMETHING THAT HAPPENED ────────────────
//
// Every judgement about a marked day is src/lib/dayPlan.ts's and every sentence
// comes from src/lib/coachWeek.ts, which puts `planOutcome` and `planConflict`
// into the coach's voice and can be tested without a database. No row in either
// list carries a tick, a percentage or the word "completed", and past days are
// drawn quieter than future ones rather than resolved. The reason is in the
// header of coachWeek.ts: `workouts.performed_at` is an INSTANT and this schema
// holds no client timezone, so deciding that a logged set landed on their
// Tuesday is a guess, and a guess rendered as a tick beside somebody's own plan
// is the worst version of it.
//
// ── And the one thing that IS read against the record ─────────────────────
//
// n=44. This screen used to read no training log at all, which meant a coach
// could see what a client intended and nothing whatever about what they did —
// the plan and the record were two screens and the reconciliation was performed
// by a human being with a thumb.
//
// `src/lib/planVsActual.ts` is the module that can answer that WITHOUT breaking
// the refusal above, and its own header names this file as the precedent it is
// preserving. It works over a WINDOW OF DAYS and never over a named weekday, it
// produces no percentage, and it answers 'unknown' rather than 'not logged'
// whenever the read did not actually cover the window. So the section it feeds
// sits on its own, below the two lists, and says which prescribed MOVEMENTS
// were logged in the last four weeks. It never touches a row in Ahead or
// Already Gone, and no day on this screen has gained a mark.
//
// ── Whose today ───────────────────────────────────────────────────────────
//
// The COACH's. `isoToday(new Date())` reads the device this screen is running
// on, and that device is the coach's. The alternative would be the client's own
// calendar day, which is the one their plan is really about — but no column
// anywhere in this schema holds a client's timezone, so it could only be
// guessed, and a guessed day boundary is exactly the class of invention this
// codebase refuses elsewhere. The cost of choosing the coach's is bounded and
// visible: for a few hours a day a coach in Dubai and a client in Los Angeles
// disagree about which day "today" is, so a date can sit under Ahead for one of
// them and under Already gone for the other. Nothing changes meaning across
// that line — both lists print the full date, both say which side of today they
// are on, and no figure on this screen is computed from the boundary.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Notice, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { USE_SUPABASE } from '../../src/lib/config';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { fetchClientPlannedDays } from '../../src/lib/plannedDays';
import { scheduledFocus } from '../../src/lib/checklist';
import { programWeeks, weekCount, weekLabel } from '../../src/lib/programBlock';
import { blockPosition } from '../../src/lib/programStart';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { clientWeek } from '../../src/lib/clientBlock';
import { isoToday, DAY_TYPE_LABEL, type PlannedDay, type PlannedDayType } from '../../src/lib/dayPlan';
// ── the record, against the plan ──────────────────────────────────────────
//
// n=44. The one module that can compare the two without claiming a session
// happened on a named weekday, which is the refusal this screen is built
// around — see the file header and the header of planVsActual.ts, which names
// this file as the precedent it preserves.
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { rowToEntry, type WorkoutRow } from '../../src/lib/workoutRow';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { dayKeyOf } from '../../src/lib/entryEdit';
import {
  WINDOW_DAYS, WINDOW_IS_NOT_A_WEEKDAY, coverageLine, loadLine, loadTally, planVsActual,
} from '../../src/lib/planVsActual';
import { useMovementName } from '../../src/ui/catalogueTranslations';
import { subjectOf, subjectChange, type RouteParam } from '../../src/lib/routeSubject';
import {
  coachWeek, planWindow, dayHeading, whenLabel, coachPlanLine, coachConflictLine,
  programmeCaveat, planNote, DAYS_AHEAD, DAYS_BEHIND,
  type CoachPlanDay, type ScheduledFocus,
} from '../../src/lib/coachWeek';
import { BACK_ICON } from '../../src/ui/direction';

// Written out here, on one line, rather than imported from the library beside
// the logic that consumes them. scripts/check-schema.mjs resolves a select list
// that arrives as a named constant only within the file that names it, so a
// shared constant is a select list nothing compares against the SQL or against
// the live database — which is exactly how `workouts.session_mins` came to be
// declared, committed, generated into setup.sql and never run, breaking every
// workout save for two days. Every other screen in this group declares its own
// for the same reason.
const WORKOUT_COLS = 'id, performed_at, exercise, sets, feel, cardio, kcal, session_mins, logged_by, amended_at';

/** A day type's mark colour. A mark beside ink-coloured text, never coloured
 *  text: the scale reserves status colour for status and none of these clears
 *  AA as type. Training and deload are both sessions and read as the brand;
 *  the two days without one are deliberately quiet. */
function markFor(type: PlannedDayType, t: ReturnType<typeof useTheme>): string {
  switch (type) {
    case 'training': return t.brand;
    case 'deload': return t.s3;
    case 'rest': return t.ink3;
    case 'off': return t.ink3;
  }
}

export default function ClientWeek() {
  const t = useTheme();
  // Movement names here come out of the client's LOG and out of the programme
  // JSON, both of which store the English identity. A German coach reads the
  // library in German and would otherwise read this section in English.
  const { textOf: movement } = useMovementName();
  const router = useRouter();
  const r = useRoster();
  const ap = useAssignedPrograms();
  // Arrives from the client sheet on the dashboard, so a coach already looking
  // at somebody lands on that person rather than on a picker.
  const { clientId } = useLocalSearchParams<{ clientId?: string; name?: string }>();

  // Seeded once, and this screen never unmounts — it is registered `href: null`
  // inside <Tabs> (app/(trainer)/_layout.tsx), so a `useState` initialiser runs
  // for the FIRST client a coach opens it for and for nobody after. Opening it
  // for Ben used to draw Amy. `subjectChange` is the rule, with the reasoning
  // and the string[] hazard in src/lib/routeSubject.ts; it is applied during
  // render rather than in an effect so the wrong person is never painted, not
  // even for one frame.
  const [picked, setPicked] = useState<string | null>(subjectOf(clientId));
  const [seenParam, setSeenParam] = useState<RouteParam>(clientId);
  const moved = subjectChange(seenParam, clientId);
  if (moved) { setSeenParam(clientId); setPicked(moved.subject); }

  // Null is "we do not know", never "they have marked nothing" — the whole
  // point of the three states below.
  const [days, setDays] = useState<PlannedDay[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('ready');
  // Fixed at the moment of the read rather than recomputed on every render, so
  // a screen left open over midnight cannot re-sort itself under the coach's
  // hands halfway through reading it. Reopening the client re-reads and moves.
  const [todayISO, setTodayISO] = useState<string>(() => isoToday(new Date()));

  // The client whose read is allowed to reach the screen. Tapping through a
  // book of clients starts a read per tap and they do not come back in order,
  // so without this a slow answer for the person tapped first lands under the
  // name of the person tapped second — one client's plans shown as another's.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    wanted.current = id;
    setStatus('loading');
    setDays(null); setSkipped(0);
    const today = isoToday(new Date());
    const w = planWindow(today);
    if (!w) { setStatus('error'); return; } // unreachable; isoToday cannot fail to parse
    const read = await fetchClientPlannedDays(id, w.fromISO, w.toISO);
    if (wanted.current !== id) return;
    setTodayISO(today);
    setDays(read.days);
    setSkipped(read.skipped);
    setStatus(read.days == null ? 'error' : read.truncated ? 'partial' : 'ready');
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    if (!picked) {
      // Deselecting has to disown the read in flight too, or it lands on a
      // screen that is no longer showing anybody.
      wanted.current = null;
      setDays(null); setSkipped(0); setStatus('ready');
      return;
    }
    void load(picked);
  }, [picked, load]);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const who = client?.name.split(' ')[0] ?? 'They';
  /**
   * Whether the server may be asked about this person at all.
   *
   * A client typed into the book by hand has a `coach_clients` row and no user
   * account, so `workouts` holds nothing for them — and the read would come
   * back with zero rows and NO error, which this screen would otherwise draw as
   * a person who has trained none of their programme. The roster is the only
   * thing that knows which table the row came from; see
   * src/lib/clientRecord.ts. `handAdded` undefined is "the roster has not
   * said", which goes on asking — only an explicit true withholds.
   */
  const askable = clientIsQueryable(picked, client?.handAdded);

  /* ── what they actually logged ─────────────────────────────────────────
   *
   * n=44. Its own read and its own status, because it fails on its own: a
   * refused log read must never be drawn as a client who did none of it, and
   * `planVsActual` answers 'unknown' rather than 'not-logged' for exactly that.
   * Null under 'error' is what lets it — an empty array must not be able to
   * arrive there meaning two things.
   *
   * The window is `WINDOW_DAYS` and NOT the planned-day window above. They are
   * two different questions — a fortnight of intentions, four weeks of record —
   * and the section prints its own span rather than borrowing the other's.
   */
  const [log, setLog] = useState<WorkoutEntry[] | null>(null);
  const [logStatus, setLogStatus] = useState<LoadStatus>('loading');
  /** The client this log is allowed to land under. Same guard as `wanted`
   *  above: a slow answer for the first client tapped must not be drawn under
   *  the second client's name, and on this screen that would be one person's
   *  training reported as another's. */
  const wantedLog = useRef<string | null>(null);
  const loadLog = useCallback(async (id: string | null, ask: boolean) => {
    wantedLog.current = id;
    if (!id) { setLog(null); setLogStatus('ready'); return; }
    if (!ask) { setLog(null); setLogStatus('error'); return; }
    setLogStatus('loading'); setLog(null);
    // Newest first, and `id` settles the ties: one session writes every exercise
    // with the SAME `performed_at`, so an order on the timestamp alone has ties
    // in it by construction and the server may break them differently on each
    // read. The window is a filter on the QUERY rather than on what came back,
    // so a client with years of history is read under the cap instead of being
    // truncated into 'partial' for ever.
    const { data, error } = await supabase
      .from('workouts')
      .select(WORKOUT_COLS)
      .eq('user_id', id)
      .gte('performed_at', new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString())
      .order('performed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (wantedLog.current !== id) return;
    if (error) {
      reportError('clientWeek.workouts', error);
      setLog(null); setLogStatus('error');
      return;
    }
    const page = capped((data ?? []) as unknown as WorkoutRow[]);
    setLog(page.rows.map(rowToEntry));
    setLogStatus(page.truncated ? 'partial' : 'ready');
  }, []);
  useEffect(() => {
    if (!USE_SUPABASE) return;
    void loadLog(picked, askable);
  }, [picked, askable, loadLog]);

  // Four reads: the client's planned days, the roster the picker and the
  // header come off, the programme assignments — which decide which week of a
  // block is on screen, so a refresh that moved the days and left the
  // assignment would lay this week's plan out against last week's block — and
  // the training log the last section compares that same week against.
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    r.refresh(), Promise.resolve(ap.reload()),
    ...(picked ? [load(picked), loadLog(picked, askable)] : []),
  ]), [r, ap, picked, load, loadLog, askable]));

  // The programme this coach has assigned them, or null. Null covers three
  // different situations — none assigned, the read failed, and a programme
  // assigned by a different coach, which `assigned_programs_coach_rw` will not
  // show this one — and none of the three is "their programme schedules
  // nothing". So a null programme feeds `undefined` into planConflict, which
  // claims no conflict on an unknown, and the caveat below says so in words.
  const programme = picked ? ap.getProgram(picked) : null;
  /**
   * The week of the block this client's own phone is showing them.
   *
   * This screen compared the days they had marked against `programme.days` —
   * week one, by construction (see `ProgramWeek` in src/lib/programs.ts) —
   * whichever week the client was actually standing in. On a twelve-week block
   * that made every conflict after week one a comparison against a session
   * nobody was doing: a rest day marked in week six read as clashing with week
   * one's Monday, and week six's Monday went unmentioned.
   *
   * Read through `clientWeek`, which is the same function the client's Train
   * tab and app/(trainer)/client-training.tsx read, rather than worked out
   * again here. Two implementations of "which week" is how a coach ends up
   * comparing a record against a week their client was never shown, which is
   * what src/lib/clientBlock.ts exists to prevent.
   *
   * `isoToday` reads the COACH's device — the header of this file argues that
   * boundary at length, and a start date is a bare date counted in the reader's
   * own days.
   */
  const startsOn = picked ? (ap.startsOn[picked] ?? null) : null;
  const shownWeek = useMemo(() => {
    if (!programme) return null;
    const weeks = programWeeks(programme);
    if (!weeks.length) return null;
    const pos = blockPosition(startsOn, todayISO, weekCount(programme));
    const w = clientWeek(pos, weeks.length);
    return { days: (weeks[w.index] ?? weeks[0]).days, at: w, label: weekLabel(weeks[w.index] ?? weeks[0], w.index + 1) };
  }, [programme, startsOn, todayISO]);
  const focusOn = useCallback<ScheduledFocus>(
    (weekday) => (shownWeek ? scheduledFocus(shownWeek.days, weekday) : undefined),
    [shownWeek],
  );

  const board = useMemo(
    () => coachWeek(status === 'error' ? null : days, todayISO, focusOn),
    [status, days, todayISO, focusOn],
  );

  /**
   * The oldest day the log read actually reached.
   *
   * This is what lets a TRUNCATED read still say a movement was not logged.
   * `capped()` hands back the newest rows, so a client whose four weeks crossed
   * the cap has their last fortnight read in full and only the start of the
   * window missing — and `planVsActual` downgrades to 'unknown' only when the
   * read stops INSIDE the window rather than refusing everybody with a long
   * history. Null when nothing came back carrying a readable timestamp, which
   * is itself "not known" and never "the window was covered".
   */
  const oldestLogged = useMemo(() => {
    if (!log || !log.length) return null;
    let oldest: string | null = null;
    for (const e of log) {
      const d = dayKeyOf(e.t);
      // A bare `YYYY-MM-DD` compared as a string, which is exactly what it is
      // for. Nothing here parses one as an instant.
      if (d && (oldest == null || d < oldest)) oldest = d;
    }
    return oldest;
  }, [log]);

  /**
   * The prescribed week against the record.
   *
   * `shownWeek` and not week one — the same week every conflict above is
   * computed against, so the two halves of this screen cannot be talking about
   * different Mondays. Null log under 'error', which is the only way the
   * comparison can answer 'unknown' rather than 'not-logged'.
   */
  const pva = useMemo(() => planVsActual({
    days: shownWeek?.days ?? null,
    programStatus: ap.status,
    log: logStatus === 'error' ? null : log,
    logStatus,
    todayISO,
    oldestDay: oldestLogged,
  }), [shownWeek, ap.status, logStatus, log, todayISO, oldestLogged]);
  const loads = useMemo(() => loadLine(loadTally(pva.movements), who), [pva, who]);

  const caveat = ap.status === 'loading' ? null : programmeCaveat(!!programme, who);

  // The span actually asked for, so the empty-week sentence can name its own
  // edges rather than describe a fortnight in the abstract.
  const window = useMemo(() => planWindow(todayISO), [todayISO]);

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  /** One marked day. Past days are drawn quieter than future ones; that is the
   *  only difference, because it is the only difference we can honestly draw —
   *  a day that has gone is still nothing more than what they intended. */
  const dayRow = (d: CoachPlanDay, i: number) => {
    const past = d.side === 'gone';
    const note = planNote(d);
    return (
      <View key={d.plan.dateISO} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <Text style={{ ...ty.micro, color: t.ink3 }}>
          {dayHeading(d.plan.dateISO)} · {whenLabel(d.plan.dateISO, todayISO)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.xs }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: markFor(d.plan.type, t) }} />
          <Text style={{ ...ty.body, fontWeight: '600', color: past ? t.ink2 : t.ink }}>
            {DAY_TYPE_LABEL[d.plan.type]}
          </Text>
        </View>
        <Text style={{ ...ty.label, color: past ? t.ink3 : t.ink2, marginTop: sp.xs }}>
          {coachPlanLine(d.plan.type, d.outcome, who)}
        </Text>
        {/* Their own words, attributed. Refeed and travel are notes rather than
            day types (see the header of dayPlan.ts), so this line is usually
            the only place the reason for a marked day is written down. */}
        {note ? (
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>
            {who}&rsquo;s note: &ldquo;{note}&rdquo;
          </Text>
        ) : null}
        {d.conflict ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>{coachConflictLine(d.conflict, d.plan.type, who)}</Flag>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon={BACK_ICON} a11yLabel="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>Their Week</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          The days a client has marked ahead of time — training, rest, a deload, or a note about
          being away. Every line here is what they intend, never a record of what they did, and
          none of it is yours to change.
        </Text>

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Planned days live on the server and belong to the client, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have marked none." />
          </Section>
        ) : (
          <>
            {r.status === 'error' ? (
              <Section>
                <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
                  note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
              </Section>
            ) : null}

            <Section>
              <SectionHead title="Client" />
              {/* `isWhole`, not `!== 'error'`. The error case already has its own
                  Notice above, so the status this gate was really letting
                  through was 'loading': a coach opening this screen with a full
                  book was told "Nobody is on your book yet" for as long as the
                  roster took to arrive. An empty list is a claim, and it may
                  only be made once the read has finished and come back whole. */}
              {r.roster.length === 0 && isWhole(r.status) ? (
                <EmptyRoster lacks="there are no weeks to look at" />
              ) : r.roster.length === 0 && r.status === 'loading' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>Reading your clients…</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {r.roster.map((c) => (
                    <Pressable key={c.id} onPress={() => setPicked(c.id === picked ? null : c.id)}
                      accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
                      accessibilityLabel={c.name} style={chip(picked === c.id)}>
                      <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Section>

            {picked ? (
              <View>
                <Rule />

                {/* The three states, kept apart. Each is a different fact about
                    this person and each starts a different conversation. */}
                {status === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their planned days&hellip;</Text></Section>
                ) : board.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their planned days could not be read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${who} has marked nothing — that is a different answer, and this screen cannot tell you which one you are looking at until the read succeeds.`} />
                  </Section>
                ) : board.state === 'none' ? (
                  <Section>
                    <SectionHead title={client?.name ?? 'Their Week'} note="nothing marked" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      The read came back and {who} has marked no days between{' '}
                      {dayHeading(window?.fromISO ?? '')} and {dayHeading(window?.toISO ?? '')}.
                      That is about them rather than
                      about the connection — most clients never open the planner, so an empty
                      fortnight is the ordinary answer and not a problem to solve.
                    </Text>
                  </Section>
                ) : (
                  <>
                    {/* Conflicts first, and only the ones still ahead. A day
                        their programme and their own mark disagree about is
                        worth a message while it can still be settled; the same
                        disagreement on a day already gone is an argument about
                        the past, so it stays on its row and out of here. */}
                    {board.conflicts.length ? (
                      <Section>
                        {/* Gated like the count twenty-seven lines below it,
                            which has been right all along. This is the list a
                            coach works through before a check-in call: clear
                            three clashes over a truncated window, believe the
                            week is straight, and the fourth was cut off the
                            page. */}
                        <SectionHead title="Worth Raising"
                          note={isWhole(status) ? `${board.conflicts.length}` : undefined} />
                        <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                          Days where {who}&rsquo;s mark and the programme you assigned them say
                          different things. Neither has been changed by the other, and nothing on
                          this screen will change either.
                        </Text>
                        {board.conflicts.map((d) => (
                          <View key={d.plan.dateISO} style={{ marginTop: sp.sm }}>
                            <Text style={{ ...ty.micro, color: t.ink3 }}>
                              {dayHeading(d.plan.dateISO)} · {whenLabel(d.plan.dateISO, todayISO)}
                            </Text>
                            <View style={{ marginTop: sp.xs }}>
                              <Flag tone={t.warn}>
                                {d.conflict ? coachConflictLine(d.conflict, d.plan.type, who) : ''}
                              </Flag>
                            </View>
                          </View>
                        ))}
                      </Section>
                    ) : null}

                    <Section>
                      <SectionHead
                        title="Ahead"
                        // A count is a figure, so it is only printed when the
                        // read is known to be the whole window. Under 'partial'
                        // it would be a subtotal presented as a total.
                        note={isWhole(status) ? `${board.ahead.length} marked` : undefined}
                      />
                      <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                        Today and the next {DAYS_AHEAD - 1} days. Far enough out to hold the whole of
                        next week, which is where a deload or a week away needs catching — after it
                        starts is too late to reprogramme it.
                      </Text>
                      {board.ahead.length ? board.ahead.map(dayRow) : (
                        // Reaching here means the board is 'planned' and Ahead
                        // is empty, so everything it holds is behind today —
                        // which is why this may say they use the planner.
                        <Text style={{ ...ty.body, color: t.ink2 }}>
                          Nothing marked from today on. {who} did mark days in the week just gone,
                          so they do use the planner — this fortnight is simply empty.
                        </Text>
                      )}
                    </Section>

                    {board.gone.length ? (
                      <>
                        <Rule />
                        <Section>
                          <SectionHead title="Already Gone" note={`last ${DAYS_BEHIND} days`} />
                          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>
                            What {who} meant to do, on days that have passed. Still only intentions:
                            this screen does not read their training log, so nothing below says
                            whether any of it happened.
                          </Text>
                          {board.gone.map(dayRow)}
                        </Section>
                      </>
                    ) : null}
                  </>
                )}

                {/* ── the plan against the record ──────────────────────────
                    n=44. Everything above this line is what the client INTENDED.
                    This is the only part of the screen that reads what they
                    actually logged, and it is deliberately not attached to any
                    of those days: `planVsActual` works over a window of days
                    and never over a named weekday, because `performed_at` is an
                    instant and this schema holds no client timezone. Its own
                    header names this file as the precedent for that refusal.

                    So: no tick beside a marked day, no percentage, and
                    'unknown' rather than 'not logged' wherever the read did not
                    cover the window. `WINDOW_IS_NOT_A_WEEKDAY` says all of that
                    on the screen rather than only in this comment. */}
                {logStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading what they logged&hellip;</Text></Section>
                ) : (
                  <Section>
                    <SectionHead title="Plan Against Record" note={`last ${WINDOW_DAYS} days`} />
                    <Text style={{ ...ty.body, color: t.ink2 }}>{coverageLine(pva, WINDOW_DAYS, who)}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{WINDOW_IS_NOT_A_WEEKDAY}</Text>

                    {pva.state === 'ready' ? pva.days.map((d, di) => (
                      <View key={`${d.day}-${di}`} style={{ marginTop: sp.md, paddingTop: di ? sp.md : 0, borderTopWidth: di ? hairline : 0, borderTopColor: t.ring }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>{d.day}{d.focus ? ` · ${d.focus}` : ''}</Text>
                        {d.movements.map((m) => (
                          <View key={m.slug || m.name} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 4 }}>
                            {/* A 6pt dot, and the state spelled out in ink at
                                the end of the same row. The tone is never the
                                text colour: `t.warn` and `t.good` are tuned to
                                the 3:1 a mark needs and are 3.87-4.08:1 as type
                                on the light palettes. Colour is the second
                                channel here and never the only one. */}
                            <View style={{ width: 14, alignItems: 'center' }}>
                              <View style={{
                                width: 6, height: 6, borderRadius: 3,
                                backgroundColor: m.coverage === 'logged' ? t.good
                                  : m.coverage === 'not-logged' ? t.warn : t.ring,
                              }} />
                            </View>
                            <Text style={{ ...ty.label, color: t.ink, flex: 1 }}>{movement(m.name)}</Text>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              {m.coverage === 'logged'
                                ? `logged ${m.daysLogged} day${m.daysLogged === 1 ? '' : 's'}`
                                : m.coverage === 'not-logged' ? 'not logged' : 'could not be answered'}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )) : null}

                    {/* The load, as counts. No figure is printed here and that
                        is not an omission: a load belongs in the CLIENT's own
                        unit — app/(trainer)/client-training.tsx resolves whose
                        through `unitFor` and prints them there — and this
                        screen reads no unit. A count needs none. */}
                    {pva.state === 'ready' && loads ? (
                      <View style={{ marginTop: sp.lg, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Prescribed load against what was lifted</Text>
                        <Text style={{ ...ty.body, color: t.ink2, marginTop: 4 }}>{loads}</Text>
                      </View>
                    ) : null}

                    {/* The other half of the conversation: work they logged that
                        this programme does not name. Spelled as they typed it. */}
                    {pva.offPlan.length ? (
                      <View style={{ marginTop: sp.lg }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Logged but not prescribed</Text>
                        <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>{pva.offPlan.map(movement).join(' \u00b7 ')}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                          Work outside the programme is not a fault; it is the part of {who}&rsquo;s training the
                          plan does not describe.
                        </Text>
                      </View>
                    ) : null}

                    {logStatus === 'partial' ? (
                      <View style={{ marginTop: sp.md }}>
                        <Flag tone={t.warn}>
                          Their logged training came back at the row limit, so the four weeks above are
                          read from the most recent end. A movement shown as not logged was answered
                          against the part of the window the read reached.
                        </Flag>
                      </View>
                    ) : null}
                  </Section>
                )}

                {/* ── whose copy of the programme every clash above was drawn
                    against ──────────────────────────────────────────────────
                    `getProgram` consults this device's cache when no read has
                    landed, and serves it under 'error' — deliberately, and the
                    header of src/ui/assignedPrograms.tsx argues why. What it
                    does NOT do is make anything 'ready'. So on a failed read
                    `programme` is non-null, `programmeCaveat` returns null
                    because a programme IS known, and every clash on this screen
                    was computed against whatever was on the phone. The horizon
                    on that cache is thirty days: a coach who rewrote the block
                    a fortnight ago reads last month's Thursday against this
                    week's marks and goes to argue about a session nobody has.

                    `ap.cachedNote` exists for exactly this and carries the age.
                    It is non-null for precisely as long as the cache is what is
                    being served — `mayServeCached` decides that — so it needs
                    no gate of its own and disappears the moment a live read
                    lands. app/(client)/week.tsx :194 renders it in the same
                    position over the same programme; this screen is the coach's
                    view of that week and had nothing. */}
                {ap.cachedNote ? (
                  <Section><Flag tone={t.warn}>{ap.cachedNote}</Flag></Section>
                ) : null}

                {/* Three things the lists above cannot say for themselves. */}
                {caveat && board.state !== 'unreadable' ? (
                  <Section><Flag tone={t.ink3}>{caveat}</Flag></Section>
                ) : null}
                {/* Which week of the block the clashes were counted against.
                    Only on a block, and only because a conflict reported
                    against a week the client is not doing is worse than no
                    conflict at all — it sends the coach to change a session
                    nobody has. Null on a one-week programme, where a week
                    number would be counting something that does not exist. */}
                {shownWeek && shownWeek.at.count > 1 && board.state !== 'unreadable' ? (
                  <Section>
                    <Flag tone={t.ink3}>
                      Compared against {shownWeek.label.toLowerCase()}, which is the week {who} is on —
                      week {shownWeek.at.index + 1} of {shownWeek.at.count}
                      {shownWeek.at.reason === 'no-date' ? ', because no start date is set on this block' : ''}
                      {shownWeek.at.reason === 'unreadable' ? ', because the start date stored on this block cannot be read' : ''}
                      {shownWeek.at.reason === 'ended' ? ', which is where their plan stays until you write the next block' : ''}.
                    </Flag>
                  </Section>
                ) : null}
                {status === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their planned days came back at the row limit, so this is some of the window
                      rather than all of it. What is listed is real; days may be missing from it.
                    </Flag>
                  </Section>
                ) : null}
                {skipped > 0 ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {skipped === 1
                        ? `${who} has marked one more day as a kind of day this version of the app does not know, so it is not in the lists above.`
                        : `${who} has marked ${skipped} more days as kinds of day this version of the app does not know, so they are not in the lists above.`}
                    </Flag>
                  </Section>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
