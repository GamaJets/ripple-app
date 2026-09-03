// Coach · What this client has actually done.
//
// ── The hole this closes ───────────────────────────────────────────────────
//
// A coach could not see a client's training. Not "could see it badly" — there
// was no reader. `workouts` was written from three places, one of them the
// coach's own app/(trainer)/log-session.tsx, and read back only by the client's
// phone. Every coach-side query against the table selected `(user_id,
// performed_at)`: src/ui/roster.tsx to date-stamp "last active" on the roster,
// src/lib/clientDrift.ts to decide whether somebody had gone quiet. Timestamps,
// never a movement, never a set, never a load. The client detail sheet on the
// roster carried the sentence "Session history appears here once <name> logs
// workouts", which had never been true and never would be, because nothing was
// ever going to populate it. A client could log a squat session standing next
// to their coach and the coach's app would show a date and nothing else.
//
// ── The permission was already there ───────────────────────────────────────
//
// No migration was needed and none was written. `workouts_coach_read` grants
// SELECT `USING (is_my_client(user_id))`, and `is_my_client(c)` is
// `exists (select 1 from clients where id = c and trainer_id = auth.uid())` —
// coach-scoped, one client at a time, and tenant-scoped by way of the `clients`
// row it has to find. It shipped alongside the insert policy in
// supabase/parts/53-coach-logged-workouts.sql: the write half was used the day
// it landed and the read half was never called by anything. Verified against
// the live database rather than inferred from the repo.
//
// ── Nothing here works anything out ────────────────────────────────────────
//
// The grouping, the volume, the attribution and every sentence come from
// src/lib/clientTraining.ts, which is pure and tested. This file reads two
// queries and draws them. The two are kept apart because they fail
// independently: a refused `clients` read says nothing about the sessions, and
// a refused `workouts` read must never be drawn as a client who has never
// trained.
//
// ── The dashes ─────────────────────────────────────────────────────────────
//
// A total is printed only when the read was WHOLE. Under 'partial' the sessions
// are listed — they are real sessions and worth reading — and every figure over
// them is a dash, because `capped()` hands back a prefix of an unknown set and
// a sum over a prefix is a wrong number rather than a small one. Under 'error'
// the screen says it could not read, and never that there is nothing to read.
//
// ── Whose kilograms ────────────────────────────────────────────────────────
//
// The client's, where the record names one. Every other coach-side screen
// prints in the coach's own unit and is right to; this one is a transcript of
// what the client's phone showed them mid-session, and a coach saying "how did
// 100 feel" to somebody whose app said 220 looks like a coach who was not
// paying attention. `unitFor` decides it, refuses to read a NULL column as
// kilograms, and hands back the sentence that says whose unit is on screen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Ghost, Notice, Flag, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAuth } from '../../src/ui/auth';
import { useSettings } from '../../src/ui/settings';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { rowToEntry, type WorkoutRow } from '../../src/lib/workoutRow';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { setsSummary } from '../../src/lib/ownTraining';
import { liftLabel, volumeIn, type WeightUnit } from '../../src/lib/units';
import { num, fmtTime } from '../../src/lib/format';
import { dayLabel } from '../../src/lib/adherence';
import {
  sessionsOf, attributionOf, attributionLabel, trainingBoard, unitFor,
  type LoggedSession, type TrainingDay, type Attribution,
} from '../../src/lib/clientTraining';
import { ExerciseHistoryPanel, type HistoryVoice } from '../../src/ui/ExerciseHistory';
// ── the two modules the coach could not reach ──────────────────────────────
//
// P1 and P2. `muscleVolume.ts` answers "have I trained legs this week" and its
// only importer was the CLIENT's own history screen — so the person paid to
// notice a missing posterior chain was the one person the app did not show it
// to, while the client, who cannot rewrite the programme, could. `longView.ts`
// draws twelve months of tonnage and its only importer was the same screen, so
// the renewal conversation — which is won with an arc, not a fortnight — had
// nothing behind it.
//
// Neither module is changed. Both are pure, both are tested, and this screen
// reads them exactly as app/(client)/history.tsx does.
import { muscleBoard, unmatchedNote } from '../../src/lib/muscleVolume';
import { useExerciseCatalogue } from '../../src/ui/exerciseDetail';
import {
  monthlyHistory, monthLabel, bestMonth, trainedMonths, longestGap,
  historySpan, stageOf, lifetimeTotals, volumeArc, tonnes, MAX_MONTHS,
} from '../../src/lib/longView';
// ── the four things this screen could not say before ───────────────────────
//
// It had the RECORD and nothing to compare it against. The assignment was on a
// different screen, the programme checks ran once in the builder and never
// again, the block's start date did not exist, and what somebody had been on
// before was destroyed by the next assign. All four of those are readable from
// here, and every one of them is a claim about a person, so each arrives with
// its own read status and its own refusal.
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useInjuryAcks } from '../../src/ui/injuryAcks';
import { useProgramHistory } from '../../src/ui/programHistory';
import { goalToEnum } from '../../src/lib/rosterMerge';
import { type Injury } from '../../src/lib/injuries';
import { programWeeks, weekCount, weekLabel } from '../../src/lib/programBlock';
// Which week of the block the client is being shown. The one rule, read by the
// client's Train tab and by this screen, so a coach cannot be comparing a
// record against a week their client never saw. See src/lib/clientBlock.ts.
import { clientWeek } from '../../src/lib/clientBlock';
import {
  CLIENT_STARTS_NOW, blockPosition, blockPositionLine,
} from '../../src/lib/programStart';
import { isoToday } from '../../src/lib/dayPlan';
import {
  WINDOW_DAYS, WINDOW_IS_NOT_A_WEEKDAY, coverageLine, planVsActual,
  loadCheck, loadTally, loadLine, LOAD_TOLERANCE,
} from '../../src/lib/planVsActual';
import { historyBoard, historyLine, blockSpanLine } from '../../src/lib/programHistory';
import { reviewProgram, checksLine, type Finding } from '../../src/lib/programReview';

// Written out here, on one line, rather than imported from the library beside
// the logic that consumes them. scripts/check-schema.mjs resolves a select list
// that arrives as a named constant only within the file that names it, so a
// shared constant is a select list nothing compares against the SQL or against
// the live database — which is exactly how `workouts.session_mins` came to be
// declared, committed, generated into setup.sql and never run, breaking every
// workout save for two days. Every other screen in this group declares its own
// (GOAL_COLS, SCAN_COLS, ITEM_COLS) for the same reason.
const WORKOUT_COLS = 'id, performed_at, exercise, sets, feel, cardio, kcal, session_mins, logged_by, amended_at';
const UNIT_COLS = 'weight_unit';

/**
 * How far back to read, and why a coach needs to be able to say.
 *
 * P3. `capLimit()` is a thousand rows and ONE EXERCISE IS ONE ROW, so a client
 * training four times a week and logging six movements crosses it in about ten
 * months. Past that the read is 'partial' for ever, every total on this screen
 * becomes a dash on purpose, and there was nothing on it offering the fix —
 * which is simply to ask for less. A coach's best clients were the ones whose
 * numbers stopped working.
 *
 * Every option is longer than `WINDOW_DAYS`, so narrowing the read can never
 * make the plan-versus-record comparison beneath it answer 'unknown' for a
 * window the coach can see. `null` is everything, and stays the default: a
 * screen that quietly showed twelve weeks would be answering a different
 * question from the one it did yesterday without saying so.
 */
const RANGES: { days: number | null; label: string }[] = [
  { days: 84, label: '12 Weeks' },
  { days: 182, label: '6 Months' },
  { days: 365, label: '12 Months' },
  { days: null, label: 'Everything' },
];

/** How the attribution reads as a chip: short, and tinted only when it is not
 *  the ordinary case. A client logging their own training is what is supposed
 *  to happen and does not need a colour drawing the eye to it. */
const CHIP_SHORT: Record<Attribution, string> = {
  client: 'Theirs',
  you: 'You logged it',
  coach: 'A coach logged it',
  mixed: 'Both',
};

export default function ClientTraining() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  // Whose id "You logged it" is allowed to mean. Null while the session is
  // still being restored, and `attributionOf` deliberately declines to say
  // "you" against a null — see the note there.
  const auth = useAuth();
  const coachUnit: WeightUnit = useSettings().weightUnit;

  // `name` rides along so the header is right during the first render while the
  // roster provider is still reading. It is never an access claim: the read is
  // filtered on the id and the policy behind it is `is_my_client`.
  const params = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const [picked, setPicked] = useState<string | null>(
    typeof params.clientId === 'string' && params.clientId ? params.clientId : null,
  );

  // Null is "we do not know", never "there are none". That distinction is the
  // whole point of the screen: `trainingBoard` is handed null under 'error' so
  // an empty list can never arrive at the renderer meaning two things.
  const [log, setLog] = useState<WorkoutEntry[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [clientUnit, setClientUnit] = useState<unknown>(null);
  const [unitStatus, setUnitStatus] = useState<LoadStatus>('loading');

  // The client whose answers are allowed to reach the screen. Tapping through a
  // book starts a read per tap and they do not come back in order, so without
  // this a slow answer for the first person can land under the name of the
  // second — one client's training attributed to another, which is worse than
  // showing nothing. Same guard as client-body.tsx.
  const wanted = useRef<string | null>(null);
  /** How far back the read asks for. Null is everything, which is what this
   *  screen has always done and stays the default. */
  const [rangeDays, setRangeDays] = useState<number | null>(null);

  const load = useCallback(async (id: string, days: number | null, askable: boolean) => {
    wanted.current = id;
    setStatus('loading'); setUnitStatus('loading');
    setLog(null); setClientUnit(null);

    // A client the coach typed in by hand has a `coach_clients` row and no user
    // account, so nothing server-backed is asked for them.
    //
    // This was `isQueryableId(id)` alone, on the belief that such a client
    // carries an id the phone invented and Postgres would refuse. It does not:
    // `coach_clients.id` is uuid DEFAULT gen_random_uuid(), so from the first
    // round trip onward the guard passed, every read ran, each came back with
    // zero rows and NO error, and this screen rendered that as a fact about the
    // person. The roster is the only thing that knows which table the row came
    // from — see src/lib/clientRecord.ts.
    if (!askable) {
      setStatus('error'); setUnitStatus('error');
      return;
    }

    const [woRes, cliRes] = await Promise.all([
      // Newest first, and `id` settles the ties: one session writes every
      // exercise with the SAME `performed_at`, so an order on the timestamp
      // alone has ties in it by construction — and at the cap the server may
      // break them differently on each read, which would shuffle the exercises
      // of the oldest session on screen between two visits.
      // The range is a filter on the QUERY, not on what came back. Trimming a
      // capped page on the phone would leave the read truncated and every total
      // a dash — the whole point is to bring the read back under the ceiling so
      // the sums can be stated again.
      (days == null
        ? supabase.from('workouts').select(WORKOUT_COLS).eq('user_id', id)
        : supabase.from('workouts').select(WORKOUT_COLS).eq('user_id', id)
            .gte('performed_at', new Date(Date.now() - days * 86_400_000).toISOString()))
        .order('performed_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
      // Their own unit. RLS on `clients` is what limits this to the coach's own
      // book; the filter is about which client is on screen, not about who may
      // be seen.
      supabase.from('clients').select(UNIT_COLS).eq('id', id).limit(1),
    ]);
    if (wanted.current !== id) return;

    if (woRes.error) {
      reportError('clientTraining.workouts', woRes.error);
      setLog(null);
      setStatus('error');
    } else {
      const page = capped((woRes.data ?? []) as unknown as WorkoutRow[]);
      setLog(page.rows.map(rowToEntry));
      setStatus(page.truncated ? 'partial' : 'ready');
    }

    if (cliRes.error) {
      reportError('clientTraining.unit', cliRes.error);
      setClientUnit(null);
      setUnitStatus('error');
    } else {
      // No row is a real answer and not a failure: a client added to the book
      // by hand has no `clients` row to carry a preference. `unitFor` reads
      // that the same way it reads a NULL column — as never chosen.
      const rows = (cliRes.data ?? []) as { weight_unit?: unknown }[];
      setClientUnit(rows[0]?.weight_unit ?? null);
      setUnitStatus('ready');
    }
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE || picked) return;
    // Deselecting disowns the read in flight too, or it lands on a screen that
    // is no longer showing anybody.
    wanted.current = null;
    setLog(null); setClientUnit(null);
    setStatus('ready'); setUnitStatus('ready');
  }, [picked]);

  // On focus, not on mount, and this is the difference the screen exists for.
  //
  // A coach walks a client through a session, taps into Log a Session, saves
  // it, and comes back here. A mount-only effect would have shown them the read
  // they took before the session existed, and they would have had to relaunch
  // the app to see the work they had just typed. The same is true the other way
  // round: the client logs their own set on their own phone mid-session and the
  // coach pulls back to this screen to check it landed.
  //
  // Deliberately does NOT refresh the roster the way client.tsx does. That
  // provider hands out a fresh value object on every render, so a focus effect
  // keyed on it re-runs whenever the provider re-renders; `load` is a
  // useCallback with no dependencies and `picked` is a piece of state, so this
  // one re-runs when the coach changes client and at no other time.
  // `rangeDays` is in the dependency list rather than in a second effect of its
  // own: changing the range is a NEW READ, not a filter over the page already
  // on screen, and two effects both calling `load` would fire it twice on every
  // focus.
  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  /** Whether the server may be asked about this person at all. Computed at
   *  render rather than inside `load`, so a roster that arrives AFTER the read
   *  and says this row was typed in by hand re-runs the effect and withdraws
   *  the answer, instead of leaving an empty screen standing as a fact about
   *  them. `handAdded` undefined is "the roster has not said", which goes on
   *  asking — only an explicit true withholds. */
  const askable = clientIsQueryable(picked, client?.handAdded);

  useFocusEffect(useCallback(() => {
    if (!USE_SUPABASE || !picked) return;
    void load(picked, rangeDays, askable);
  }, [picked, rangeDays, askable, load]));

  const fullName = client?.name ?? (typeof params.name === 'string' ? params.name : '') ?? '';
  const who = (fullName || 'They').split(' ')[0];
  // A name we do not have must not become "They's". The fallback voice is
  // third-person plural throughout rather than a possessive built out of a
  // placeholder, which is the shape that puts "They's training" on a screen.
  const voice: HistoryVoice = fullName
    ? { they: who, their: `${who}'s`, have: 'has' }
    : { they: 'They', their: 'their', have: 'have' };

  const sessions = useMemo(() => (log ? sessionsOf(log) : null), [log]);
  // 'error' hands the board a null, which is the only way it can answer
  // 'unreadable'. Under any other status the rows are the server's own answer.
  const board = useMemo(
    () => trainingBoard(status === 'error' ? null : sessions, status),
    [status, sessions],
  );
  const pick = useMemo(
    () => unitFor(clientUnit, coachUnit, unitStatus, who),
    [clientUnit, coachUnit, unitStatus, who],
  );
  const unit = pick.unit;

  /* ── the plan, beside the record ────────────────────────────────────────
     Everything below this line is the OTHER half of the conversation, and it
     was on three different screens. `assigned_programs` says what was
     prescribed; the days above say what was done. Reconciling them was
     performed by a coach with a thumb.

     Each read is separate and fails separately, and none of them is allowed to
     borrow another's confidence: an unread assignment must never render as a
     client on nothing, and an unread log must never render as a client who did
     none of it. */
  const assigned = useAssignedPrograms();
  const program = picked ? assigned.getProgram(picked) : null;
  const startsOn = picked ? (assigned.startsOn[picked] ?? null) : null;

  /**
   * Where in the block they are standing, and the week to compare against.
   *
   * `isoToday` reads the COACH's device, which is where they are standing.
   * There is no client timezone column anywhere in this schema — the header of
   * app/(trainer)/client-week.tsx argues that at length — so a start date is a
   * bare date and the week number is counted in the reader's own days. Nothing
   * else on this screen is computed across that boundary.
   */
  const position = useMemo(
    () => blockPosition(startsOn, isoToday(new Date()), weekCount(program)),
    [startsOn, program],
  );
  /**
   * The week of the block the comparison runs against.
   *
   * THE WEEK THE CLIENT'S TRAIN TAB IS ACTUALLY SHOWING THEM, and it is read
   * from `clientWeek` — the same function `app/(client)/workouts.tsx` reads —
   * rather than worked out again here. This used to be "the week they are in
   * when the date says so, and week one otherwise", which was correct while the
   * client renderer drew `program.days` and knew nothing about a week index. It
   * does know now, and the two rules differ: a block whose last week has passed
   * stays on its LAST week on the client's phone, not week one. A coach
   * comparing a record against a week nobody was shown is the exact failure
   * this screen exists to prevent, so there is one rule and both sides read it.
   */
  const compareWeek = useMemo(() => {
    const weeks = programWeeks(program);
    if (!weeks.length) return null;
    const w = clientWeek(position, weeks.length);
    return weeks[w.index] ?? weeks[0];
  }, [program, position]);

  /**
   * The oldest day the log read reached.
   *
   * This is what lets a TRUNCATED read still say a movement was not logged.
   * `capped()` hands back the newest rows, so a client with four thousand
   * workouts has their last month read in full and only their 2023 missing —
   * refusing to answer at all for them would withhold a true answer from every
   * client with a long history. `planVsActual` compares this against the start
   * of its window and downgrades to 'unknown' only when the read stops inside it.
   */
  const oldestDay = useMemo(() => {
    const days = board.days;
    return days.length ? days[days.length - 1].day : null;
  }, [board]);

  /* ── which muscles the work landed on ──────────────────────────────────
   *
   * P1. Balance is the COACH's job. `muscleVolume.ts` was reachable only from
   * the client's own history screen, so the member could see that they had
   * trained quads four times and hamstrings never, and the person who wrote the
   * programme could not.
   *
   * The catalogue read is separate and fails on its own. "They have not trained
   * their back" over a catalogue that did not come back is an accusation about
   * a person built out of a broken query — `catalogueWhole` is what gates it,
   * and it is the one figure on the board that asserts an absence.
   */
  const [muscleDays, setMuscleDays] = useState<7 | 28>(28);
  const cat = useExerciseCatalogue();
  /** Whether the workout read reached back to the start of the muscle window.
   *  `capped()` hands back the NEWEST rows, so a truncated read still covers a
   *  recent window in full — the same reasoning `planVsActual` applies with
   *  `oldestDay`, and the reason a long-history client is not simply refused. */
  const muscleWindowRead = useMemo(() => {
    if (status === 'error' || status === 'loading' || !log) return false;
    if (status === 'ready') return true;
    const from = new Date(Date.now() - muscleDays * 86_400_000);
    const p = (x: number) => (x < 10 ? '0' + x : String(x));
    const fromDay = `${from.getFullYear()}-${p(from.getMonth() + 1)}-${p(from.getDate())}`;
    return oldestDay != null && oldestDay <= fromDay;
  }, [status, log, muscleDays, oldestDay]);
  const muscles = useMemo(
    () => muscleBoard(log ?? [], cat.rows, {
      sinceMs: Date.now() - muscleDays * 86_400_000,
      // No weigh-in series is read on this screen, so a bodyweight set carries
      // no load here. `unpricedSets` reports exactly how much work that leaves
      // out of the tonnage, which is the honest answer rather than a silent one.
      catalogueWhole: cat.status === 'ready',
    }),
    [log, cat.rows, cat.status, muscleDays],
  );
  const muscleNote = useMemo(() => unmatchedNote(muscles), [muscles]);

  /* ── the year, not the fortnight ───────────────────────────────────────
   *
   * P2. The renewal conversation is won with an arc. Every figure below comes
   * from `longView.ts`, whose only importer was the client's own screen.
   *
   * Withheld entirely under anything but a WHOLE read. A monthly roll-up over a
   * truncated log draws the oldest months short and the newest months whole,
   * which is a picture of somebody tailing off backwards — the exact opposite
   * of what the record says. The range control above is how a coach gets the
   * read back under the ceiling.
   */
  const longWhole = status === 'ready' && log != null;
  const cells = useMemo(
    () => (longWhole ? monthlyHistory(log ?? [], Date.now(), MAX_MONTHS) : []),
    [longWhole, log],
  );
  const lifetime = useMemo(() => (longWhole ? lifetimeTotals(log ?? []) : null), [longWhole, log]);
  const arc = useMemo(() => volumeArc(cells), [cells]);
  const best = useMemo(() => bestMonth(cells), [cells]);
  const trainedCells = useMemo(() => trainedMonths(cells), [cells]);
  const worstGap = useMemo(() => longestGap(cells), [cells]);
  const stage = useMemo(() => stageOf(longWhole ? historySpan(log ?? []) : null), [longWhole, log]);

  const pva = useMemo(() => planVsActual({
    days: compareWeek?.days ?? null,
    programStatus: assigned.status,
    // Null under 'error', which is the only way the comparison can answer
    // 'unknown' rather than 'not-logged'. The same null `trainingBoard` is
    // handed above, for the same reason.
    log: status === 'error' ? null : log,
    logStatus: status,
    todayISO: isoToday(new Date()),
    oldestDay,
  }), [compareWeek, assigned.status, status, log, oldestDay]);

  /* ── the programme checks, re-run against what they are ACTUALLY on ─────
     `reviewProgram` ran once, in the builder, against a draft. Its seven rules
     include `volume-jump`, which reads THIS CLIENT'S OWN training history — and
     that history keeps moving after the programme is assigned. A block that was
     safe in July against a client training four times a week is a different
     proposition in September against one who has trained twice this month.

     Nothing new is read for it. The log is the one this screen already has, the
     disclosures ride on the roster row, and the goal is on it too. */
  const acks = useInjuryAcks();
  const clientInjuries: Injury[] = useMemo(() => (client?.injuries ?? []).map((i, n) => ({
    id: `${picked}-${n}`, area: i.area, severity: i.severity as Injury['severity'],
    status: 'active', note: i.note, at: '',
  })), [client, picked]);
  /**
   * How the read of the DISCLOSURES went — a different question from how the
   * roster read went, and the one nobody asks.
   *
   * `client?.injuries ?? []` is an empty list under a failed roster exactly as
   * it is under a client with nothing wrong with them. The same discipline
   * app/(trainer)/builder.tsx applies before it lets a programme be assigned;
   * here the consequence is milder — a finding withheld rather than a write
   * permitted — but a check that silently did not run reads exactly like a
   * check that passed.
   */
  const disclosureStatus: LoadStatus =
    !picked ? 'ready'
    : r.status === 'error' ? 'error'
    : client ? 'ready'
    : r.status === 'loading' ? 'loading'
    : 'error';
  const review = useMemo(() => reviewProgram({
    program,
    injuries: picked ? clientInjuries : null,
    injuryStatus: disclosureStatus,
    log: status === 'error' ? null : (log as WorkoutEntry[] | null),
    logStatus: status,
    goal: goalToEnum(client?.goal),
  }), [program, picked, clientInjuries, disclosureStatus, log, status, client]);
  // Only worth drawing when there is a programme to check. A client on nothing
  // has no findings, and an empty "Programme Checks" heading over them reads as
  // seven rules that ran and passed.
  const showChecks = !!program && assigned.status !== 'loading';

  /* ── what they were on before ──────────────────────────────────────────── */
  const history = useProgramHistory(picked);

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * Six reads: what this client actually trained (`load`, which is already the
   * focus read), the book, the programme assigned to them, what they were on
   * before, the movement catalogue, and the injury acknowledgements.
   *
   * The plan-versus-actual comparison on this screen is drawn ACROSS the
   * assignment and the logged sessions, so refreshing the sessions without the
   * assignment would compare this week's work against last week's plan and
   * report the difference as the client's. */
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    r.refresh(), Promise.resolve(assigned.reload()), Promise.resolve(history.reload()),
    cat.reload(), acks.refresh(),
    ...(picked ? [load(picked, rangeDays, askable)] : []),
  ]), [r, assigned, history, cat, acks, picked, rangeDays, askable, load]));
  const hist = useMemo(
    () => historyBoard(history.rows, history.status, program, startsOn, assigned.status),
    [history.rows, history.status, program, startsOn, assigned.status],
  );

  /** A finding's figures in the coach's own unit. The rules module deals in
   *  kilograms and formats nothing — the same render boundary the builder
   *  uses, so the two screens cannot disagree about a number by a rounding. */
  const findingLoads = (f: Finding): string | null => {
    const v = f.volume;
    if (!v) return null;
    const planned = volumeIn(v.plannedKg, unit);
    const best = volumeIn(v.bestKg, unit);
    if (planned == null || best == null) return null;
    return `Planned ${num(planned)} ${unit} against a best of ${num(best)} ${unit} over ${v.compared} sessions.`;
  };

  const G = layout.gutter;
  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  /** One exercise inside a session: the movement and what was done to it. */
  const exerciseRow = (e: WorkoutEntry, i: number) => {
    const lifted = setsSummary(e.sets, unit);
    // A cardio entry carries no sets at all, so `setsSummary` is null for it and
    // this is the line instead. Every figure on it is one somebody recorded —
    // there is no derived pace here, because a pace over a distance the client
    // rounded is a precision the record does not have.
    const cardio = e.cardio
      ? [
        e.cardio.mins ? `${e.cardio.mins} min` : null,
        e.cardio.dist ? `${e.cardio.dist} ${e.cardio.unit || ''}`.trim() : null,
        e.cardio.hrAvg ? `avg ${e.cardio.hrAvg} bpm` : null,
      ].filter(Boolean).join(' · ')
      : null;
    // Per-set effort, and only when it lines up with the sets it claims to
    // describe. A `feel` array of a different length than `sets` cannot be
    // matched to them, and printing it anyway would attribute "hard" to a set
    // that was not the hard one.
    const effort = e.feel && e.sets && e.feel.length === e.sets.length ? e.feel.join(' · ') : null;
    return (
      <View key={`${e.id ?? e.exercise}-${i}`}
        style={{ paddingVertical: sp.sm, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.exercise}</Text>
        {lifted ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{lifted}</Text> : null}
        {cardio ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{cardio}</Text> : null}
        {!lifted && !cardio ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            Recorded with no sets and no distance — the movement was logged, what was done to it was not.
          </Text>
        ) : null}
        {effort ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>How it felt, set by set: {effort}</Text>
        ) : null}
      </View>
    );
  };

  /**
   * One logging event inside a day: who put it there, what was in it, and what
   * it totals. `alone` says this is the day's only entry, in which case the day
   * heading above already carries the totals and the time would only be noise.
   */
  const sessionBlock = (sn: LoggedSession, i: number, alone: boolean) => {
    const attr = attributionOf(sn, auth.user?.id ?? null);
    const vol = volumeIn(sn.volumeKg, unit);
    // fmtTime reads the instant in the coach's own zone, which is where they
    // are standing. A coach in Dubai reading a session logged at 18:15 in Dubai
    // sees 18:15; one reading it from London is entitled to their own clock
    // rather than a time that matches nothing around them.
    const at = Number.isFinite(Date.parse(sn.at)) ? fmtTime(sn.at) : null;
    return (
      <View key={sn.at} style={{ paddingTop: i ? sp.md : sp.sm, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring, marginTop: i ? sp.md : 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>
            {alone ? attributionLabel(attr, who) : `${at ?? 'Time unreadable'} · ${attributionLabel(attr, who)}`}
          </Text>
          {attr === 'client' ? null : (
            <Text style={{ ...ty.micro, color: t.brand }}>{CHIP_SHORT[attr]}</Text>
          )}
        </View>
        {sn.amendedAt ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            {who} has since changed part of this — the record keeps the mark, and neither app can remove it.
          </Text>
        ) : null}

        <View style={{ marginTop: sp.sm }}>
          {sn.entries.map(exerciseRow)}
        </View>

        {/* A per-event footer only where it says something the day's own
            footer does not: a length, an energy figure, or a tonnage that is
            one of several on the day. */}
        {sn.mins != null || sn.kcal != null || (!alone && vol != null) ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: sp.sm }}>
            {!alone && vol != null ? (
              <Text style={{ ...ty.caption, color: t.ink3 }}>{num(vol)} {unit}</Text>
            ) : null}
            {sn.mins != null ? <Text style={{ ...ty.caption, color: t.ink3 }}>{sn.mins} min</Text> : null}
            {sn.kcal != null ? <Text style={{ ...ty.caption, color: t.ink3 }}>{num(sn.kcal)} kcal</Text> : null}
          </View>
        ) : null}
        {sn.minsDisagree ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>
              The rows of this entry disagree about how long it ran. The figure above is the first
              one on record; nothing here picks a winner between them.
            </Flag>
          </View>
        ) : null}
      </View>
    );
  };

  /**
   * One training day.
   *
   * The day is the heading rather than the session, and src/lib/clientTraining.ts
   * says at length why: this client's own record holds one squat workout written
   * as four rows a second apart, and by timestamp that is four sessions. Where a
   * day does hold more than one logging event they are all here, each with its
   * own time, under a line saying how many there are — so nothing is hidden and
   * nothing has to be worked out from four identical headings.
   */
  const dayBlock = (d: TrainingDay, i: number) => {
    const vol = volumeIn(d.volumeKg, unit);
    const alone = d.sessions.length === 1;
    return (
      <View key={d.day} style={{ paddingTop: i ? sp.xl : sp.md }}>
        <Text style={{ ...ty.head, color: t.ink }}>{dayLabel(d.day)}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md, marginTop: 2 }}>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            {d.exercises} exercise{d.exercises === 1 ? '' : 's'} · {d.sets} set{d.sets === 1 ? '' : 's'}
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            Volume {vol == null ? '—' : `${num(vol)} ${unit}`}
          </Text>
          {d.kcal != null ? <Text style={{ ...ty.caption, color: t.ink3 }}>{num(d.kcal)} kcal</Text> : null}
        </View>
        {/* Two things the line above cannot say for itself, and both of them
            stop a small figure being read as an easy hour. */}
        {d.volumeKg == null && d.sets > 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            No load was recorded against any set, so there is no tonnage to total — a dash rather
            than a nought. Bodyweight work reads exactly like this.
          </Text>
        ) : d.bodyweightSets > 0 ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
            {d.bodyweightSets} of those set{d.bodyweightSets === 1 ? '' : 's'} carried no load, so the volume does not cover
            {d.bodyweightSets === 1 ? ' it' : ' them'}.
          </Text>
        ) : null}
        {!alone ? (
          <Flag tone={t.warn} style={{ marginTop: 2 }}>
            Logged in {d.sessions.length} separate entries, listed below. The totals above add all of
            them up — if {who} saved the same work twice, this day reads high and the entries show it.
          </Flag>
        ) : null}

        <View style={{ marginTop: sp.sm }}>
          {d.sessions.map((sn, k) => sessionBlock(sn, k, alone))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>{fullName || 'Your book'}</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>Their Training</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Every day {who} has trained, newest first — what they logged themselves and what was
          logged for them, with the exercises, sets, reps and loads as they were recorded.
          Read-only: this is their record, and nothing on this screen changes it.
        </Text>

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not loaded" title="This build is running without the server"
              note="Training belongs to the client and lives on the server, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have never trained." />
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
              {/* Three sentences, and there was one. `r.status !== 'error'` let
                  'loading' AND 'partial' fall into "Nobody is on your book yet",
                  so that sentence flashed on every single open of this screen,
                  for every coach, however full their book — and it is the exact
                  sentence app/(trainer)/log-session.tsx names in its own header
                  as the one that makes a coach put the phone away: "a coach
                  standing on a gym floor being shown 'you have no clients'".
                  app/(trainer)/builder.tsx handles the identical condition
                  correctly and this screen sits beside it.

                  'partial' gets the list and no claim about it: the rows are
                  real and may be picked from, and `isWhole` is what says the
                  set is not the book. */}
              {r.roster.length === 0 && r.status === 'loading' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>Reading your roster…</Text>
              ) : r.roster.length === 0 && isWhole(r.status) ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  Nobody is on your book yet, so there is no training to look at.
                </Text>
              ) : r.roster.length === 0 ? null : (
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

                {/* ── how far back to read ────────────────────────────────
                    P3. One exercise is one row, so a client training four
                    times a week and logging six movements crosses the
                    thousand-row ceiling in about ten months — and past it
                    every total on this screen is a dash for ever. The fix has
                    always been to ask for less, and until now the screen did
                    not offer it, so a coach's longest-standing clients were the
                    ones whose numbers stopped working.

                    Everything stays the default. A screen that quietly showed
                    twelve weeks would be answering a different question from
                    the one it answered yesterday without saying so. */}
                <Section>
                  <SectionHead title="How Far Back" note={status === 'partial' ? 'The read is at its limit' : undefined} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {RANGES.map((rg) => (
                      <Pressable key={rg.label} onPress={() => setRangeDays(rg.days)}
                        accessibilityRole="button" accessibilityState={{ selected: rangeDays === rg.days }}
                        accessibilityLabel={rg.label} style={chip(rangeDays === rg.days)}>
                        <Text style={{ ...ty.micro, color: rangeDays === rg.days ? t.brandInk : t.ink2 }}>{rg.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {status === 'partial' ? (
                    <Flag tone={t.warn} style={{ marginTop: sp.md }}>
                      {who} has more training on record than one request returns, so every total on this
                      screen is a dash. Ask for a shorter range and the read comes back whole and the
                      figures come back with it — the training itself is not going anywhere.
                    </Flag>
                  ) : (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                      {rangeDays == null
                        ? 'Everything on record. A long history can come back at the row limit, at which point every total here becomes a dash — narrow the range and they come back.'
                        : `The last ${rangeDays} days only. Sessions before that are still on record and are not in any figure on this screen.`}
                    </Text>
                  )}
                </Section>

                {/* ── what they were asked to do ──────────────────────────
                    Above the record rather than below it, because the reason a
                    coach opens this screen is to reconcile the two — and the
                    plan is the shorter half. Every read behind it is separate
                    and each says so for itself. */}
                {assigned.status === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading the programme they are on&hellip;</Text></Section>
                ) : assigned.status === 'error' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="What they are on could not be read"
                      note={`Nothing below compares their training against a plan, because the plan did not come back. That is not the same as ${who} being on no programme.`} />
                  </Section>
                ) : !program ? (
                  <Section>
                    <SectionHead title="Their Programme" note="none assigned" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      The read came back and {who} is on no coach-assigned programme, so there is nothing
                      to compare the sessions below against. Writing one in the Program Builder puts it on
                      their Train tab.
                    </Text>
                  </Section>
                ) : (
                  <Section>
                    <SectionHead
                      title="Programme Versus Record"
                      note={pva.state === 'ready' && position.phase === 'during' && position.week
                        ? `week ${position.week} of ${position.weeks}`
                        : undefined}
                    />
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{program.title || 'An untitled programme'}</Text>

                    {/* The block, and the honesty about what a start date does.
                        A coach who believes the date is enforced and assigns a
                        block "starting Monday" on a Thursday has replaced this
                        week's sessions believing they did not. */}
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                      {blockPositionLine(position, startsOn, who)}
                    </Text>
                    {startsOn ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>{CLIENT_STARTS_NOW}</Text>
                    ) : null}
                    {weekCount(program) > 1 && compareWeek ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                        Compared against {weekLabel(compareWeek, clientWeek(position, weekCount(program)).index + 1).toLowerCase()}, which is
                        the week their Train tab is showing them.
                      </Text>
                    ) : null}

                    <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>
                      {coverageLine(pva, WINDOW_DAYS, who)}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{WINDOW_IS_NOT_A_WEEKDAY}</Text>

                    {/* Per prescribed day, with the movements listed rather
                        than a figure standing in for them — a coach who
                        disagrees has to be able to point at the row. */}
                    {pva.state === 'ready' ? pva.days.map((d, di) => (
                      <View key={`${d.day}-${di}`} style={{ marginTop: sp.md, paddingTop: di ? sp.md : 0, borderTopWidth: di ? hairline : 0, borderTopColor: t.ring }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>{d.day}{d.focus ? ` · ${d.focus}` : ''}</Text>
                        {d.movements.map((m) => (
                          <View key={m.slug || m.name} style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp.sm, marginTop: 4 }}>
                            {/* Three states, three marks, and the word is on the
                                line as well as the mark: colour and glyph are
                                never the only channel carrying meaning. */}
                            <Text style={{ ...ty.label, width: 14, color: m.coverage === 'logged' ? t.good : m.coverage === 'not-logged' ? t.warn : t.ink3 }}>
                              {m.coverage === 'logged' ? '\u2713' : m.coverage === 'not-logged' ? '\u00b7' : '?'}
                            </Text>
                            <Text style={{ ...ty.label, color: t.ink, flex: 1 }}>{m.name}</Text>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>
                              {m.coverage === 'logged'
                                ? `logged ${m.daysLogged} day${m.daysLogged === 1 ? '' : 's'}`
                                : m.coverage === 'not-logged' ? 'not logged' : 'could not be answered'}
                            </Text>
                          </View>
                        ))}
                        {/* ── the load, beneath the presence ──────────────
                            P5. Both halves have been on the MovementCheck
                            since it was built and nothing joined them: the
                            screen compared whether a movement APPEARED, never
                            what went on the bar. The sentence that changes next
                            week's programme is the second one.

                            Rendered only where the plan named a load.
                            "Prescribed 0 kg" is not a prescription, and
                            `plannedTopKg` is null rather than zero precisely so
                            this row cannot claim it was. */}
                        {d.movements.map((m) => {
                          const lc = loadCheck(m);
                          if (lc.verdict === 'no-plan') return null;
                          // Both labels are read before the row is drawn. Where
                          // one of them will not render there is no sentence to
                          // print: "— prescribed" is a line with a word missing
                          // out of it, and the whole row is withheld rather than
                          // shown broken.
                          const wrote = liftLabel(lc.plannedKg, unit);
                          const did = lc.verdict === 'not-logged' ? null : liftLabel(lc.loggedKg, unit);
                          if (!wrote || (lc.verdict !== 'not-logged' && !did)) return null;
                          return (
                            <View key={`load-${m.slug || m.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 2, paddingStart: 14 + sp.sm }}>
                              {/* A 6pt dot beside the caption ink. The tone is
                                  never the text colour. */}
                              <View style={{
                                width: 6, height: 6, borderRadius: 3,
                                backgroundColor: lc.verdict === 'at' ? t.good
                                  : lc.verdict === 'under' ? t.warn
                                  : lc.verdict === 'over' ? t.brand : t.ring,
                              }} />
                              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }} numberOfLines={1}>{m.name}</Text>
                              <Text style={{ ...ty.caption, color: t.ink3 }}>
                                {did ? `${wrote} prescribed, ${did} logged` : `${wrote} prescribed, nothing logged`}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    )) : null}

                    {/* The load, summed over the week. Counts and never a
                        percentage: the moment "78% of prescribed loads hit"
                        exists it is the only thing anybody reads, and it hides
                        that half the movements named no load at all. */}
                    {pva.state === 'ready' && loadLine(loadTally(pva.movements), who) ? (
                      <View style={{ marginTop: sp.lg, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Prescribed load against what was lifted</Text>
                        <Text style={{ ...ty.body, color: t.ink2, marginTop: 4 }}>
                          {loadLine(loadTally(pva.movements), who)}
                        </Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                          The heaviest WORKING set the programme names, against the heaviest {who} logged in
                          the window: a ramp's top set, never its warm-up. Within {LOAD_TOLERANCE * 100}% counts as
                          hitting it, because the finest adjustment anybody can make to a barbell is one pair
                          of the smallest plates on the rack.
                        </Text>
                      </View>
                    ) : null}

                    {/* The other half of the conversation, and the half nothing
                        in this app could see. A client quietly swapping the
                        prescribed row for a machine they prefer is the most
                        common reason a block does not do what it was meant to. */}
                    {pva.offPlan.length ? (
                      <View style={{ marginTop: sp.lg }}>
                        <Text style={{ ...ty.micro, color: t.ink3 }}>Logged but not prescribed</Text>
                        <Text style={{ ...ty.label, color: t.ink2, marginTop: 4 }}>{pva.offPlan.join(' · ')}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                          Spelled as {who} typed {pva.offPlan.length === 1 ? 'it' : 'them'}. Work outside the programme is
                          not a fault; it is the part of their training the plan does not describe.
                        </Text>
                      </View>
                    ) : null}
                  </Section>
                )}

                {/* ── the checks, run again ────────────────────────────────
                    Seven rules that ran once against a draft in the builder and
                    never again — including `volume-jump`, which reads this
                    client's own history, and that history has been moving ever
                    since. No new read: the log is the one this screen already
                    has. */}
                {showChecks ? (
                  <Section>
                    <SectionHead title="Programme Checks" note={review.findings.length ? `${review.findings.length}` : undefined} />
                    <Text style={{ ...ty.caption, color: t.ink3 }}>{checksLine()}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                      Run again here against what {who} is on now and what they have logged since — the same seven
                      rules the builder runs before a programme is assigned, over a history that has moved since.
                    </Text>
                    {review.findings.length === 0 ? (
                      <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>
                        {review.status === 'ready'
                          ? 'Nothing matched. Every rule ran.'
                          : 'Nothing matched among the rules that could run. The ones that could not are listed below, and a rule that did not run is not a rule that passed.'}
                      </Text>
                    ) : review.findings.map((f, i) => (
                      <View key={`${f.id}-${i}`} style={{ marginTop: sp.md, paddingTop: i ? sp.md : 0, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                        <Text style={{ ...ty.label, color: t.ink }}>{f.day ? `${f.day} · ` : ''}{f.exercises.join(', ')}</Text>
                        <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{f.detail}</Text>
                        {findingLoads(f) ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{findingLoads(f)}</Text>
                        ) : null}
                      </View>
                    ))}
                    {review.skipped.length ? (
                      <View style={{ marginTop: sp.md }}>
                        {review.skipped.map((sk) => (
                          <Text key={sk.id} style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{sk.why}</Text>
                        ))}
                      </View>
                    ) : null}
                  </Section>
                ) : null}


                {/* The three states, kept apart. Each is a different fact about
                    this person and each starts a different conversation. */}
                {status === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their logged sessions&hellip;</Text></Section>
                ) : board.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their training could not be read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${who} has logged nothing — that is a different fact and a different conversation. If they were added to your book by hand they have no account for workouts to belong to, which reads the same way from here.`} />
                  </Section>
                ) : board.state === 'none' ? (
                  <Section>
                    <SectionHead title={fullName || 'Their Training'} note="nothing logged" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      The read came back and {who} has no logged sessions at all. That is about them
                      rather than about the connection, which makes it worth raising — and a session
                      you run together can go in from Log a Session on their page, which lands in
                      their own record marked as logged by you.
                    </Text>
                  </Section>
                ) : (
                  <>
                    {/* ── the figures, and a dash wherever the read cannot
                        support one ─────────────────────────────────────── */}
                    <Hero
                      label="Days Trained"
                      figure={fig(board.dayCount)}
                      unit={board.dayCount != null ? (board.dayCount === 1 ? 'day' : 'days') : undefined}
                      note={board.dayCount == null
                        ? 'Their training came back at the row limit, so how much of it there is cannot be counted from here. Everything listed below is real.'
                        : board.newestDay
                          ? `Last trained ${dayLabel(board.newestDay)}.`
                          : 'Nothing on record carries a date this build can read.'}
                      tone={board.dayCount == null ? t.warn : undefined}
                    />
                    <KpiRow items={[
                      { label: 'Sets', value: num(board.sets) },
                      {
                        label: 'Volume',
                        value: board.volumeKg == null ? '—' : num(volumeIn(board.volumeKg, unit)),
                        unit: board.volumeKg == null ? undefined : unit,
                      },
                      { label: 'Last', value: board.newestDay ? dayLabel(board.newestDay) : '—' },
                    ]} />
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                      {board.dayCount == null
                        ? 'Every total here is a dash on purpose: the read came back at its row limit, so a sum over what arrived would be a subtotal wearing a total’s label.'
                        : board.volumeKg == null
                          ? 'Across everything on record. Nothing carried a load, so there is no tonnage to total — a dash rather than a nought.'
                          : 'Across everything on record, over sets that carried a load. Bodyweight sets count on the left and contribute no tonnage.'}
                      {board.entryCount != null && board.dayCount != null && board.entryCount > board.dayCount
                        ? ` Those ${board.dayCount} day${board.dayCount === 1 ? '' : 's'} were logged in ${board.entryCount} separate entries — some days hold more than one, and the days that do say so.`
                        : ''}
                    </Text>
                    {pick.note ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{pick.note}</Text>
                    ) : null}

                    {status === 'partial' ? (
                      <Section>
                        <PartialRead what="training days" shown={board.days.length}
                          onPress={() => { if (picked) void load(picked, rangeDays, askable); }} />
                      </Section>
                    ) : null}

                    <Rule />

                    {/* ── which muscles the work landed on ────────────────
                        P1. Balance is the coach's job, and until now the app
                        showed it only to the client — who cannot rewrite the
                        programme. Bars compare the groups with each other and
                        never with a target: there is no right number of sets
                        for a back and this screen does not pretend to know one. */}
                    <Section>
                      <SectionHead title="By Muscle Group" note={cat.status === 'ready' ? `last ${muscleDays} days` : undefined} />
                      <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
                        {([7, 28] as const).map((dd) => (
                          <Pressable key={dd} onPress={() => setMuscleDays(dd)}
                            accessibilityRole="button" accessibilityState={{ selected: muscleDays === dd }}
                            accessibilityLabel={`Last ${dd} days`} style={chip(muscleDays === dd)}>
                            <Text style={{ ...ty.micro, color: muscleDays === dd ? t.brandInk : t.ink2 }}>{dd} days</Text>
                          </Pressable>
                        ))}
                      </View>
                      {cat.status === 'loading' ? (
                        <Text style={{ ...ty.label, color: t.ink3 }}>Reading the exercise catalogue&hellip;</Text>
                      ) : cat.status === 'error' || cat.signedOut ? (
                        <Text style={{ ...ty.label, color: t.ink3 }}>
                          The exercise catalogue could not be read, so nothing here can say which muscles
                          {' '}{who}&rsquo;s sessions worked. Their training is not affected and nothing is missing from it.
                        </Text>
                      ) : !muscleWindowRead ? (
                        <Flag tone={t.warn}>
                          The read stops before the start of this window, so nothing is said about which muscles
                          were worked. Narrow the range above and it comes back — an empty board here would be
                          about the query, not about {who}.
                        </Flag>
                      ) : !muscles.groups.length ? (
                        <Text style={{ ...ty.body, color: t.ink2 }}>
                          {muscleNote
                            ? `Nothing in the last ${muscleDays} days could be matched to a muscle group. ${muscleNote}`
                            : `Nothing logged with sets in the last ${muscleDays} days, so there is no muscle work to break down. Cardio is logged as time and distance rather than as sets and does not appear here.`}
                        </Text>
                      ) : (<>
                        {muscles.groups.map((g) => {
                          const most = muscles.groups[0].sets;
                          return (
                            <View key={g.group} style={{ marginTop: sp.md }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md }}>
                                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{g.group}</Text>
                                <Text style={{ ...ty.caption, color: t.ink3 }}>
                                  {g.sets} set{g.sets === 1 ? '' : 's'}
                                  {g.volumeKg != null ? ` \u00b7 ${num(volumeIn(g.volumeKg, unit))} ${unit}` : ''}
                                </Text>
                              </View>
                              <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface3, marginTop: 7, overflow: 'hidden' }}>
                                <View style={{ height: 3, borderRadius: 2, width: `${most ? Math.round((g.sets / most) * 100) : 0}%`, backgroundColor: t.brand }} />
                              </View>
                              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4 }}>
                                {g.exercises.slice(0, 3).join(', ')}{g.exercises.length > 3 ? `, and ${g.exercises.length - 3} more` : ''}
                              </Text>
                            </View>
                          );
                        })}
                        {/* An absence stated only where the catalogue read can
                            carry it. This is the line a coach acts on — it is
                            also the one sentence on the board that is a claim
                            about a list, so it is withheld unless the list was
                            read whole. */}
                        {muscles.untrained && muscles.untrained.length ? (
                          <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>
                            Nothing logged for {muscles.untrained.slice(0, 6).join(', ')}
                            {muscles.untrained.length > 6 ? `, and ${muscles.untrained.length - 6} more` : ''} in the
                            last {muscleDays} days.
                          </Text>
                        ) : null}
                        {muscles.groups.some((g) => g.unpricedSets > 0) ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                            Sets with no load on them are counted on the left and contribute no tonnage. No weigh-in
                            series is read here, so a bodyweight set carries no weight in these figures.
                          </Text>
                        ) : null}
                        {muscleNote ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{muscleNote}</Text>
                        ) : null}
                      </>)}
                    </Section>

                    <Rule />

                    {/* ── the year ────────────────────────────────────────
                        P2. The renewal conversation is won with an arc, not a
                        fortnight, and the module that draws twelve months of
                        it was reachable only from the client's own phone.

                        An untrained month is a HOLE, never a bar of height
                        nothing: this app does not know somebody lifted zero
                        kilograms in March, only that March has no logged
                        sessions in it. */}
                    <Section>
                      <SectionHead title="The Long View" note={longWhole && trainedCells.length ? `${trainedCells.length} months trained` : undefined} />
                      {!longWhole ? (
                        <Flag tone={t.warn}>
                          The read came back at its row limit, so no monthly roll-up is drawn. Over a truncated
                          log the oldest months come out short and the newest whole, which draws {who} tailing
                          off backwards — the opposite of what their record says. Narrow the range above.
                        </Flag>
                      ) : !lifetime || stage === 'empty' ? (
                        <Text style={{ ...ty.body, color: t.ink3 }}>
                          Nothing on record with a readable date, so there is no year to show yet.
                        </Text>
                      ) : (<>
                        <KpiRow items={[
                          { label: 'Sessions', value: num(lifetime.sessions) },
                          { label: 'Days', value: num(lifetime.days) },
                          {
                            label: 'Lifted',
                            value: lifetime.volumeKg == null ? '\u2014' : num(tonnes(lifetime.volumeKg)),
                            unit: lifetime.volumeKg == null ? undefined : 't',
                          },
                        ]} />
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                          Everything on record, from {monthLabel(cells.length ? cells[0].key : '')} onward. Tonnage is in
                          metric tonnes whatever unit the sets are shown in above, because a six-digit figure in
                          pounds is not a number anybody reads.
                          {lifetime.unpricedSets > 0
                            ? ` ${lifetime.unpricedSets} set${lifetime.unpricedSets === 1 ? '' : 's'} carried no load and ${lifetime.unpricedSets === 1 ? 'is' : 'are'} not in it.`
                            : ''}
                        </Text>

                        {/* Months as a strip. A trained month carries a bar
                            scaled against the best one; an untrained month
                            inside the history is drawn as a rule, not a bar. */}
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: sp.lg, height: 44 }}>
                          {cells.map((c) => {
                            const peak = best?.volumeKg ?? null;
                            const h = c.trained && c.volumeKg != null && peak
                              ? Math.max(3, Math.round((c.volumeKg / peak) * 40))
                              : null;
                            return (
                              <View key={c.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                                {h != null ? (
                                  <View style={{ width: '100%', height: h, borderRadius: 2, backgroundColor: c.key === best?.key ? t.brand : t.s5 }} />
                                ) : (
                                  <View style={{ width: '100%', height: 2, borderRadius: 1, backgroundColor: c.trained ? t.ring : t.surface3 }} />
                                )}
                              </View>
                            );
                          })}
                        </View>
                        <Text style={{ ...ty.micro, color: t.ink3, marginTop: 4 }}>
                          {cells.length ? `${monthLabel(cells[0].key)} \u2192 ${monthLabel(cells[cells.length - 1].key)}` : ''}
                          {' \u00b7 '}a flat line is a month with no logged sessions, never a month of nothing lifted
                        </Text>

                        {best && best.volumeKg != null ? (
                          <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.lg }}>
                            Their biggest month was {monthLabel(best.key)}: {num(tonnes(best.volumeKg))} t
                            across {best.days ?? 0} day{best.days === 1 ? '' : 's'}
                            {best.topLift ? `, most of it ${best.topLift}` : ''}.
                          </Text>
                        ) : null}
                        {arc && arc.pct != null ? (
                          <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.sm }}>
                            From {monthLabel(arc.fromKey)} to {monthLabel(arc.toKey)}, {arc.months} month
                            {arc.months === 1 ? '' : 's'}, monthly tonnage has moved {arc.pct >= 0 ? 'up' : 'down'} by
                            {' '}{Math.abs(arc.pct)}%. Two months, not a trend line. The months between them are
                            in the strip above and some of them may be holes.
                          </Text>
                        ) : null}
                        {worstGap ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                            Their longest break on record runs {worstGap.months} month{worstGap.months === 1 ? '' : 's'}.
                            {' '}{monthLabel(worstGap.afterKey)} was the last month before it and they came back
                            in {monthLabel(worstGap.returnKey)}. A gap is kept visible rather than smoothed over: the
                            return is the part of the story worth having.
                          </Text>
                        ) : null}
                      </>)}
                    </Section>

                    <Rule />

                    {board.days.length ? (
                      <Section>
                        <SectionHead title="Sessions" note={board.dayCount == null ? undefined : `${board.dayCount} days`} />
                        {board.days.map(dayBlock)}
                      </Section>
                    ) : null}

                    {/* Kept out of the list above rather than filed under a day
                        nobody trained on. The sets are real; where they sit in
                        the week is not something the record supports. */}
                    {board.undated.length ? (
                      <Section>
                        <SectionHead title="No Readable Date" note={`${board.undated.length}`} />
                        <Flag tone={t.warn}>
                          {board.undated.length === 1 ? 'One entry carries' : `${board.undated.length} entries carry`} a
                          timestamp this build cannot read, so {board.undated.length === 1 ? 'it belongs' : 'they belong'} to
                          no day above. What was done is below and is real; when it was done is not something this
                          screen can state, and it is counted in the totals rather than dropped out of them.
                        </Flag>
                        <View style={{ marginTop: sp.md }}>
                          {board.undated.map((sn, k) => sessionBlock(sn, k, true))}
                        </View>
                      </Section>
                    ) : null}

                    {/* ── the same record, read by movement ──────────────── */}
                    {/* At the bottom, under the sessions, because the sessions
                        answer "what did she do last Tuesday" and this answers
                        "where is she on bench press" — the second question is
                        the one a coach asks with a client standing in front of
                        them, and it needs the first one's context above it.
                        Both are drawn from the SAME `log` this screen already
                        read, so nothing here can disagree with the days above
                        it, and the panel is shared with the member's own
                        history screen so the two apps cannot disagree either. */}
                    <Rule />
                    <ExerciseHistoryPanel log={log} status={status} unit={unit} voice={voice} />
                  </>
                )}

                {/* ── what they were on before ────────────────────────────
                    Until supabase/parts/176 there was no copy of it anywhere:
                    `assigned_programs` is one row per client and an assign is an
                    upsert over it, so the spring block ceased to exist the
                    moment the summer block landed. A coach could not answer
                    "what did we do in the spring", and neither could anybody
                    else. The record starts from that migration and the line
                    below says so rather than letting "none" read as "nothing
                    was ever worth keeping". */}
                <Rule />
                <Section>
                  <SectionHead title="Programme History" note={hist.earlierCount == null ? undefined : `${hist.earlierCount}`} />
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{historyLine(history.status, hist, who)}</Text>
                  {hist.entries.map((e, i) => (
                    <View key={e.key} style={{ marginTop: sp.md, paddingTop: i ? sp.md : 0, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
                        <Text style={{ ...ty.body, fontWeight: e.current ? '600' : '400', color: e.current ? t.ink : t.ink2, flex: 1 }}>
                          {e.title}
                        </Text>
                        <Text style={{ ...ty.micro, color: e.current ? t.brand : t.ink3 }}>
                          {e.current ? 'Now' : `${e.weeks} wk`}
                        </Text>
                      </View>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{blockSpanLine(e, dayLabel)}</Text>
                    </View>
                  ))}
                  {history.status === 'partial' ? (
                    <View style={{ marginTop: sp.md }}>
                      <PartialRead what="earlier programmes" shown={hist.entries.filter((e) => !e.current).length}
                        onPress={history.reload} />
                    </View>
                  ) : null}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    Read-only. Putting an old block back is an assign — it writes over what {who} is training
                    this evening — so it goes through the builder, behind the same refusals every other assign does.
                  </Text>
                </Section>

                {/* The unit note belongs on the page even when there is nothing
                    to print it against — a coach who reads pounds should not
                    have to see a figure first to learn whose unit this is. */}
                {board.state !== 'some' && pick.note ? (
                  <Section>
                    <Flag tone={t.ink3}>{pick.note}</Flag>
                  </Section>
                ) : null}
              </View>
            ) : null}
          </>
        )}

        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          Grouped by the day it was done on, in your own timezone. Inside a day, each entry is the
          exercises saved together in one go — a client who logs a movement at a time makes several,
          and a day that holds more than one says so above them rather than reading as several
          workouts. Loads are shown in {unit}.
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
