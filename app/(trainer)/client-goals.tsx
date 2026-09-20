// Coach · Working toward. What one client is aiming at, and how it is going.
//
// ── Why this screen exists ─────────────────────────────────────────────────
//
// Clients have been able to set four kinds of goal since supabase/parts/59 —
// a target weight, body fat, muscle, or something the app cannot measure at
// all — and the whole point of moving them off the phone and into
// `goal_targets` was that somebody else could see them. The console got a
// "Working toward" column on the roster; the coach app got nothing. So the one
// thing a coach most needs to know about a client, the thing that decides what
// their program should even be for, was visible on a laptop and invisible on
// the phone they actually coach from.
//
// ── It reads and it does not write ─────────────────────────────────────────
//
// `goal_targets_coach_read` grants SELECT and nothing else, deliberately: a
// goal is the client's own statement of what they want, and a coach silently
// editing it would make the screen the client is looking at stop being theirs.
// There is no Done button here and no edit field, and that is not an omission
// to be filled in later. A coach who disagrees with a target has the messaging
// thread — which is the same reason `checklists.tsx` cannot tick a habit.
//
// ── Three empty screens that mean three different things ───────────────────
//
// The console named them and this screen keeps the vocabulary: a read that
// failed is "— unreadable", a client who has set nothing is "— none set", and
// a client who has got there is "— all reached". Collapsing any two of them
// tells a coach something false about a person they are about to ring.
//
// The same distinction runs one level down, into the readings. A client can
// have a target weight and no weigh-ins, which is worth knowing — it is the
// coach's cue to get them on the scales — and it is a different sentence from
// "their scans could not be read just now". Neither is ever a 0%.
//
// ── And the readings the scale cannot take ─────────────────────────────────
//
// `measurements` — the tape: waist, chest, arm, thigh, hips — was the third
// table carrying a coach-read policy that nothing in the product used. It has
// granted `measurements_coach_read` since supabase/parts/02 and no coach-side
// query existed. So a coach could see everything a machine says about a client
// (weight, body fat, skeletal muscle, all above) and not one thing a tape says,
// which is the half of the record that moves when body composition changes and
// the scale does not. Six weeks of "no change" on the scales and two
// centimetres off the waist is the conversation this screen was missing.
//
// It is on this screen rather than its own because it answers the same question
// — how is this person actually going — and because a coach who has to open a
// second screen to find out will compare the two from memory.
//
// The arithmetic is entirely src/lib/goalTargets.ts and the wire-reading is
// src/lib/clientGoals.ts and src/lib/clientMeasurements.ts, all pure and all
// tested. Nothing on this screen works out a percentage, a finish date or a
// change of its own.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, PageHead, Notice, Flag, Ring, IconPlate, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric, font } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useSettings } from '../../src/ui/settings';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { isWhole, worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import {
  progressOf, projectionOf, goalLabel, isMeasured, isOverdue,
  deadlineTally, deadlineNote,
  GOAL_METRIC, MIN_TREND_DAYS,
  type GoalTarget, type MeasuredKind, type Point,
} from '../../src/lib/goalTargets';
import {
  readGoals, seriesFrom, seriesFor, goalBoard, goalUnit, goalValue, goalDelta,
  type ClientSeries, type GoalRow, type ScanRow, type WeighInRow,
} from '../../src/lib/clientGoals';
import {
  readMeasurements, measureBoard, unmeasuredSites, siteChangeLine, siteAgeLine,
  isSiteStale, DIRECTION_CAVEAT,
  type MeasurementRow, type SiteHistory,
} from '../../src/lib/clientMeasurements';
import { isoToday } from '../../src/lib/dayPlan';
import { kgToLb, lengthLabel, type WeightUnit } from '../../src/lib/units';
import { deltaMoved, deltaSign } from '../../src/lib/deltaLabel';
import { subjectOf, subjectChange, type RouteParam } from '../../src/lib/routeSubject';
import { localDate } from '../../src/lib/localDate';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useNow } from '../../src/ui/today';
import { num2 } from '../../src/lib/format';

const GOAL_COLS = 'id, kind, target_value, title, target_date, achieved_at, created_at';
const SCAN_COLS = 'taken_at, weight_kg, body_fat_pct, skeletal_muscle_kg';
const CHECKIN_COLS = 'at, weight_kg';
const MEAS_COLS = 'taken_at, kind, value';

const EMPTY_SERIES: ClientSeries = { weight: [], bodyfat: [], muscle: [] };

/**
 * A goal's date as a short day, read as the day it says.
 *
 * `new Date(iso)` was wrong for the value this is called with. Both callers
 * below pass `goal_targets.target_date`, which is a bare Postgres `date`, and
 * `new Date('2026-09-01')` is UTC midnight — which every local getter and
 * `toLocaleDateString` then reads back in the coach's own zone, so a coach in
 * Los Angeles was shown "Aug 31" over a target their client typed as the 1st,
 * and the overdue line read "Target date passed (Aug 31)" about a date that
 * does not exist anywhere in this record.
 *
 * `localDate` builds a bare date at LOCAL midnight and leaves a real timestamp
 * — `achievedAtISO` is a timestamptz — as the instant it is. One function for
 * both because the two callers below pass one of each. src/lib/clientBrief.ts
 * fixed exactly this for exactly this column; this screen was the other half.
 */
const shortDate = (iso: string) => {
  const d = localDate(iso);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
};

/** The client's trend in a sentence, addressed to their coach, or null when
 *  there is no honest one to write. Every branch here is a named member of
 *  `Projection`; none of them is inferred on this screen. */
function projectionLine(goal: GoalTarget, series: Point[], wu: WeightUnit, who: string, nowMs: number): string | null {
  const p = projectionOf(goal, series, nowMs);
  if (!p) return null;
  const kind = goal.kind as MeasuredKind;
  const unit = goalUnit(kind, wu);
  // A weekly rate is a change per week, so it converts as a span — but it keeps
  // two decimals rather than going through `goalDelta`, which rounds to the
  // whole pound a single reading can support. At half a kilogram a week the
  // honest figure is 1.10 lb/wk, and whole pounds would make every pace between
  // 0.7 and 1.5 look identical.
  const rate = (v: number) => (unit === 'lb' ? kgToLb(v) : v);
  // A pace is only quoted where it survives being printed. `weeklyRate === 0`
  // is caught upstream as 'flat', but a rate of 0.004 kg/wk is not zero and
  // formatted "+0.00 kg/wk" — a plus sign on a pace of nothing, offered to a
  // coach as the basis of a finish date for somebody else's body.
  const pace = (v: number) => {
    const r = rate(v);
    return deltaMoved(r, 2) ? ` (${deltaSign(r, 2)}${num2(Math.abs(r))} ${unit}/wk)` : '';
  };
  switch (p.kind) {
    case 'reached':
      return `${who} has reached this one. It is theirs to mark done — worth a message.`;
    case 'tooshort':
      return `Only ${p.days === 1 ? 'a day' : `${p.days} days`} between their readings so far. A finish date needs about ${MIN_TREND_DAYS} days of them; a shorter gap is noise, not a trend.`;
    case 'flat':
      return 'Their readings have not moved since they set this, so there is no pace to project from.';
    case 'wrongway':
      return `Their trend since setting this${pace(p.weeklyRate)} is heading away from the target.`;
    case 'eta': {
      const eta = new Date(p.etaMs);
      return `At their current pace${pace(p.weeklyRate)} they get there around ${eta.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.`;
    }
  }
}

export default function ClientGoals() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();
  // Arrives from the client sheet on the dashboard, so a coach who is already
  // looking at somebody lands on that person rather than on a picker.
  const { clientId } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  // The coach's own unit, not the client's. The target is stored in kilograms
  // whichever unit it was typed in (TF-37), so this only changes what is
  // printed — but printing a kilogram figure to a coach who reads pounds is a
  // wrong number, not a stylistic one.
  const wu = useSettings().weightUnit;
  // Likewise the coach's own length unit, for the same reason and by the same
  // argument: tape readings are stored in centimetres (TF-37) whichever unit
  // the client typed them in, so this changes only what is printed — and a
  // coach who thinks in inches reading "84" off a client's waist will read it
  // as inches. Deliberately NOT the client's `length_unit`: this screen already
  // prints their weight in the coach's unit two inches further up, and one
  // screen carrying two people's unit preferences at once is a screen where
  // nobody can tell which number belongs to which system.
  const lu = useSettings().lengthUnit;

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

  // Null is "we do not know", never "there are none". Each read carries its own
  // status because they fail independently: a refused check_ins read must not
  // empty the body-fat series, which comes from scans and is unaffected by it.
  const [goals, setGoals] = useState<GoalTarget[] | null>(null);
  const [unreadableGoals, setUnreadableGoals] = useState(0);
  const [goalStatus, setGoalStatus] = useState<LoadStatus>('ready');
  const [series, setSeries] = useState<ClientSeries>(EMPTY_SERIES);
  const [scanStatus, setScanStatus] = useState<LoadStatus>('ready');
  const [weighStatus, setWeighStatus] = useState<LoadStatus>('ready');
  const [sites, setSites] = useState<SiteHistory[] | null>(null);
  const [unreadableMeas, setUnreadableMeas] = useState(0);
  const [measStatus, setMeasStatus] = useState<LoadStatus>('ready');
  // Fixed at the moment of the read rather than recomputed on every render, so
  // a screen left open over midnight cannot quietly age a reading under the
  // coach's eyes while they are looking at it. Same as client-week.tsx.
  const [todayISO, setTodayISO] = useState<string>(() => isoToday(new Date()));
  /** The instant every judgement about a target DATE is made against. Kept
   *  current for the life of the mount — see the note at `goalCard`. */
  const nowMs = useNow().getTime();

  // The client whose reads are allowed to reach the screen. Tapping through a
  // book of clients starts a read per tap and they do not come back in order,
  // so without this a slow answer for the person tapped first can land under
  // the name of the person tapped second — one client's goals attributed to
  // another, which is worse than showing nothing at all.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string, askable: boolean) => {
    wanted.current = id;
    setGoalStatus('loading'); setScanStatus('loading'); setWeighStatus('loading');
    setMeasStatus('loading');
    setGoals(null); setUnreadableGoals(0); setSeries(EMPTY_SERIES);
    setSites(null); setUnreadableMeas(0);
    const today = isoToday(new Date());

    /* A client the coach typed in by hand has a `coach_clients` row and no user
     * account, so nothing server-backed is asked for them.
     *
     * This screen asked anyway. `coach_clients.id` is `uuid DEFAULT
     * gen_random_uuid()` — client-report.tsx and client-body.tsx both carry the
     * note — so the id passes every shape test, all four reads ran, and
     * `goal_targets_coach_read` / `scans_trainer_read` / `checkins_trainer_read`
     * / `measurements_coach_read` all hang off `is_my_client()`, which is an
     * EXISTS over `clients` and is false for a `coach_clients` row. RLS
     * therefore answered every one of them with zero rows and NO error, and
     * this screen printed that as:
     *
     *     "{who} hasn't set a goal yet. The read came back and it was empty,
     *      so this is about them rather than about the connection — which
     *      makes it worth raising."
     *
     * A sentence about somebody's own ambition, invented out of the absence of
     * an account, and it ends by telling the coach to go and raise it with
     * them. The tape section said the same thing about a tape they have no way
     * to log with.
     *
     * The statuses go to 'error' so that nothing downstream — `goalBoard`,
     * `measureBoard`, `progressOf`, `projectionOf` — can compute a figure over
     * an empty list it would otherwise call whole. The render does not print
     * those as a failed read: `askable` has its own branch up there, because
     * "they have no account" is a THIRD answer and collapsing it into "the read
     * failed" is the same flattening src/lib/coachWellness.ts keeps a
     * `not-asked` kind apart from `unreadable` for.
     */
    if (!askable) {
      setGoalStatus('error'); setScanStatus('error');
      setWeighStatus('error'); setMeasStatus('error');
      return;
    }

    // RLS already limits all four of these to clients this coach actually
    // coaches (goal_targets_coach_read, scans_trainer_read,
    // checkins_trainer_read, measurements_coach_read), so the filter below is
    // about which client is on screen rather than about who may be seen.
    const [goalRes, scanRes, ciRes, measRes] = await Promise.all([
      supabase.from('goal_targets').select(GOAL_COLS)
        .eq('client_id', id).order('created_at', { ascending: false }).limit(capLimit()),
      // NEWEST-FIRST, and reversed back into ascending order once the page has
      // been measured. `ascending: true` with a cap is the pair
      // src/lib/historyWindow.ts:5-18 documents by name: PostgREST answers with
      // at most a thousand rows and says nothing, so an ascending read hands
      // back the OLDEST thousand and stops. A client who weighs in weekly for
      // twenty years, or daily for three, would have had a chart of their first
      // thousand readings drawn as their current trend — the same shape as the
      // screen that told a member "nothing logged since Mar 2023" the morning
      // after they trained. Reading downward puts the cut at the far end of
      // their history instead, where a truncated read costs the oldest points
      // rather than every recent one, and `weighStatus` says it happened.
      //
      // The id settles ties for the same reason it settles them on the
      // measurements read below: a client who is scanned and weighed on the
      // same instant writes rows the server may order differently on each
      // request, and an order with ties in it is not an order to cut a page on.
      supabase.from('scans').select(SCAN_COLS)
        .eq('client_id', id)
        .order('taken_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
      supabase.from('check_ins').select(CHECKIN_COLS)
        .eq('user_id', id)
        .order('at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
      // Newest-first, as the two above now are, because what this one is for is
      // the latest reading at each site and the one before it — so if the cap
      // bites, the rows that fall off the end are the oldest and least useful.
      // `taken_at` is a DATE, and a client who measures five sites writes five
      // rows carrying the same one: an order with ties in it is not an order,
      // and at the cap the server may break them differently on each read, so a
      // chest measurement that was here yesterday is simply gone today. The id
      // settles them, exactly as src/ui/measurements.tsx settles its own.
      supabase.from('measurements').select(MEAS_COLS)
        .eq('user_id', id)
        .order('taken_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit()),
    ]);
    if (wanted.current !== id) return;
    setTodayISO(today);

    if (goalRes.error) {
      reportError('clientGoals.goals', goalRes.error);
      setGoalStatus('error');
    } else {
      const page = capped((goalRes.data ?? []) as unknown as GoalRow[]);
      const read = readGoals(page.rows);
      setGoals(read.goals);
      setUnreadableGoals(read.skipped);
      setGoalStatus(page.truncated ? 'partial' : 'ready');
    }

    // Both reads feed `seriesFrom`, and a failure in one leaves the other's
    // rows exactly as good as they were: a coach whose check_ins read is
    // refused should still see body fat, which comes from scans and knows
    // nothing about check-ins. The statuses are what stops the remainder being
    // read as the whole of somebody's record.
    let scans: ScanRow[] = [];
    if (scanRes.error) {
      reportError('clientGoals.scans', scanRes.error);
      setScanStatus('error');
    } else {
      const page = capped((scanRes.data ?? []) as unknown as ScanRow[]);
      // Back into ascending order, which is what every chart below reads and
      // what `seriesFrom` is handed everywhere else. The read is downward so
      // the cap bites the oldest rows; the ORDER the screen draws in is not the
      // order the rows have to arrive in.
      scans = page.rows.slice().reverse();
      setScanStatus(page.truncated ? 'partial' : 'ready');
    }

    let weighIns: WeighInRow[] = [];
    if (ciRes.error) {
      reportError('clientGoals.checkIns', ciRes.error);
      setWeighStatus('error');
    } else {
      const page = capped((ciRes.data ?? []) as unknown as WeighInRow[]);
      weighIns = page.rows.slice().reverse();
      setWeighStatus(page.truncated ? 'partial' : 'ready');
    }

    setSeries(seriesFrom(scans, weighIns));

    // Tape measurements stand on their own: they share no source with the three
    // series above, so a refused scans read says nothing about them and a
    // refused measurements read must not empty anything else.
    if (measRes.error) {
      reportError('clientGoals.measurements', measRes.error);
      setMeasStatus('error');
    } else {
      const page = capped((measRes.data ?? []) as unknown as MeasurementRow[]);
      const read = readMeasurements(page.rows);
      setSites(read.sites);
      setUnreadableMeas(read.skipped);
      setMeasStatus(page.truncated ? 'partial' : 'ready');
    }
  }, []);

  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const who = client?.name.split(' ')[0] ?? 'They';
  /** Whether the server may be asked about this person at all. Computed at
   *  render rather than inside `load`, so a roster that arrives AFTER the read
   *  and says this row was typed in by hand re-runs the effect and withdraws
   *  the answer, instead of leaving four empty sections standing as facts about
   *  them. `handAdded` undefined is "the roster has not said", which goes on
   *  asking — only an explicit true withholds. See src/lib/clientRecord.ts. */
  const askable = clientIsQueryable(picked, client?.handAdded);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    if (!picked) {
      // Deselecting has to disown the read in flight too, or it lands on a
      // screen that is no longer showing anybody.
      wanted.current = null;
      setGoals(null); setUnreadableGoals(0); setSeries(EMPTY_SERIES);
      setSites(null); setUnreadableMeas(0);
      setGoalStatus('ready'); setScanStatus('ready'); setWeighStatus('ready');
      setMeasStatus('ready');
      return;
    }
    void load(picked, askable);
  }, [picked, askable, load]);

  // `load` is one call over four reads — the goals, the scans, the weigh-ins
  // and the tape — and they are asked for together on purpose: every delta on
  // this screen crosses two of them, and a refresh that moved one would date
  // a change from one read against a starting point from another. The roster
  // is the picker and the name at the top.
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    r.refresh(),
    ...(picked ? [load(picked, askable)] : []),
  ]), [r, picked, askable, load]));

  // 'error' hands `goalBoard` a null, which is the only way it can answer
  // 'unreadable'. Under any other status the list is the server's own answer.
  const board = useMemo(
    () => goalBoard(goalStatus === 'error' ? null : goals),
    [goalStatus, goals],
  );

  // Same rule for the tape: 'error' hands it a null, which is the only way it
  // can answer 'unreadable'. A client who has never picked up a tape and a read
  // that was refused both arrive here as an empty list otherwise, and they are
  // opposite things to say to a coach.
  const tape = useMemo(
    () => measureBoard(measStatus === 'error' ? null : sites),
    [measStatus, sites],
  );

  /**
   * Whether the readings a goal of this kind is measured against are the whole
   * of what the client has. Weight is held against scans AND weigh-ins, so it
   * is only as trustworthy as the worse of the two; body fat and muscle come
   * from scans alone and a refused check_ins read says nothing about them.
   */
  const readingStatus = useCallback((kind: MeasuredKind): LoadStatus =>
    kind === 'weight' ? worstStatus(scanStatus, weighStatus) : scanStatus,
  [scanStatus, weighStatus]);

  /** What can honestly be said about how far along one measured goal is. */
  const measuredLine = (g: GoalTarget & { kind: MeasuredKind }): string => {
    const st = readingStatus(g.kind);
    const source = GOAL_METRIC[g.kind].source;
    if (st === 'loading') return `Reading their ${source}…`;
    if (st === 'error') {
      return `Their ${source} could not be read, so there is nothing to hold this against right now. That is our connection, not their record.`;
    }
    if (st === 'partial') {
      return `Only part of their ${source} came back, and a percentage worked out from an unknown fraction of them would be a wrong number rather than a rough one.`;
    }
    const prog = progressOf(g, seriesFor(series, g.kind));
    if (!prog) {
      return `No ${source} on record yet, so there is nothing to measure this against. ${who} set the target; nobody has taken the reading.`;
    }
    const unit = goalUnit(g.kind, wu);
    const left = Math.abs(goalDelta(prog.remaining, g.kind, wu));
    return prog.reached
      ? `Reached — ${fig(goalValue(prog.current, g.kind, wu))} ${unit} against a target of ${fig(goalValue(prog.target, g.kind, wu))}.`
      : `${prog.pct}% of the way · ${fig(left)} ${unit} to go · now ${fig(goalValue(prog.current, g.kind, wu))} ${unit}`;
  };

  /** The goal to lead with: the nearest-due open one that actually has whole
   *  readings behind it. A goal nothing can be said about makes a poor hero. */
  const lead = useMemo(() => {
    if (board.state !== 'working') return null;
    for (const g of board.open) {
      if (!isMeasured(g)) continue;
      const kind = g.kind as MeasuredKind;
      if (!isWhole(readingStatus(kind))) continue;
      const prog = progressOf(g, seriesFor(series, kind));
      if (prog) return { goal: g, kind, prog };
    }
    return null;
  }, [board, series, readingStatus]);

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  /**
   * The client picker. Above everything while nobody is chosen, because there
   * is nothing else to draw; under the record once somebody is, because the
   * board opens a record page on the client's figure and not on a list of
   * names. The screen is reachable without a param, so the picker cannot go.
   */
  const picker = (
    <Section>
      <SectionHead title={picked ? 'Switch Client' : 'Client'} />
      {r.roster.length === 0 && isWhole(r.status) ? (
        <EmptyRoster lacks="there are no goals to look at" />
      ) : r.roster.length === 0 && r.status === 'loading' ? (
        /* An empty chip row while the roster lands reads as a coach
           with nobody on their book — the same claim `EmptyRoster`
           above is gated on `isWhole` to avoid making. Said in words
           instead, exactly as app/(trainer)/client-week.tsx says it. */
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
  );

  const goalCard = (g: GoalTarget, i: number) => {
    const measured = isMeasured(g);
    const kind = measured ? (g.kind as MeasuredKind) : null;
    const unit = kind ? goalUnit(kind, wu) : '';
    /* `nowMs` from `useNow`, never a bare `Date.now()` here.
     *
     * This line, and the `projectionOf` behind the one under it, both read the
     * clock in a render body. A render body is not a safe place for one on this
     * screen: app/(trainer)/_layout.tsx registers client-goals `href: null`
     * inside <Tabs>, so it mounts once and is never torn down — not by
     * navigating away and not by backgrounding the app — and nothing on it
     * re-renders on a timer. A coach who opened a client's goals on Sunday
     * evening and came back to the app on Wednesday was still being told "By
     * Sep 13" about a target date that had passed on the Monday, with no warn
     * dot and the pale ink that means nothing needs them.
     *
     * `useNow` moves on the two moments that matter and on no others: the local
     * day rolling over, and the app coming back to the foreground. See
     * src/ui/today.ts — the same fix credentials.tsx took for expiry dates. */
    const overdue = isOverdue(g, nowMs);
    const proj = kind && isWhole(readingStatus(kind))
      ? projectionLine(g, seriesFor(series, kind), wu, who, nowMs)
      : null;
    // The ring beside the goal: how far along it is, and ONLY where
    // `measuredLine` below would print a percentage — a measured goal, a whole
    // read of its series, and a reading to hold it against. Everything else
    // gets a plate and its sentence; an empty ring beside "could not be read"
    // would look like a goal nobody has started.
    const ringProg = kind && !g.achievedAtISO && isWhole(readingStatus(kind)) ? progressOf(g, seriesFor(series, kind)) : null;
    const ringPct = ringProg ? Math.round(Math.max(0, Math.min(100, ringProg.pct))) : null;
    return (
      <View key={g.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        {ringPct != null
          ? <Ring size={64} tone={overdue ? 'amber' : 'brand'} value={ringPct / 100} figure={`${ringPct}%`} spoken={`${goalLabel(g)}, ${ringPct} percent of the way`} />
          : <IconPlate icon={g.achievedAtISO ? 'check' : 'target'} tone={g.achievedAtISO ? 'brand' : overdue ? 'amber' : 'blue'} />}
        <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...ty.body, color: g.achievedAtISO ? t.ink3 : t.ink, ...font('600') }}>
          {goalLabel(g)}
          {kind && g.targetValue != null ? ` · ${fig(goalValue(g.targetValue, kind, wu))} ${unit}` : ''}
        </Text>
        {/* "Target date passed" is already the whole message in words. warn as
            micro ink is 3.87–4.08:1 on the three light palettes — under AA at
            the smallest size in the app — so the tone is a dot instead. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: sp.xs }}>
          {overdue ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
          <Text style={{ ...ty.micro, color: overdue ? t.ink2 : t.ink3, flex: 1 }}>
            {g.achievedAtISO
              ? `Marked done ${shortDate(g.achievedAtISO)}`
              : g.targetDateISO
                ? (overdue ? `Target date passed (${shortDate(g.targetDateISO)})` : `By ${shortDate(g.targetDateISO)}`)
                : 'No target date'}
          </Text>
        </View>
        {/* A goal with no number by construction gets the client's own words
            and no percentage. "Squat without my knee complaining" is 40% of
            nothing, and only they can say when it is done. */}
        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
          {measured
            ? measuredLine(g as GoalTarget & { kind: MeasuredKind })
            : `In their words, and nothing measures it. Only ${who} can say when this one is done.`}
        </Text>
        {proj ? <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs }}>{proj}</Text> : null}
        </View>
      </View>
    );
  };

  /**
   * One site's row: what the tape said, how it has moved, and how old that is.
   *
   * The change gets a sign and no colour. The client's own screen paints a fall
   * in `t.brand` (src/ui/measurements.tsx), which is fine on the screen of the
   * person who knows what they are training for and wrong here — a coach reads
   * five sites at once and the same green would mean "good" on a waist and
   * "losing the arm they are building" one line below it. The only tone on the
   * row is on the AGE, and that is a fact about the record rather than about
   * the body: a reading from four months ago is out of date whatever it says.
   */
  const siteRow = (h: SiteHistory, i: number) => {
    const stale = isSiteStale(h, todayISO);
    return (
      <View key={h.key} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md }}>
          <Text style={{ ...ty.body, color: t.ink, ...font('600') }}>{h.label}</Text>
          <Text style={{ ...ty.body, ...numeric, color: t.ink, ...font('500') }}>
            {fig(lengthLabel(h.latest.cm, lu))}
          </Text>
        </View>
        <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{siteChangeLine(h, lu)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: sp.xs }}>
          {stale ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
          <Text style={{ ...ty.micro, color: stale ? t.ink2 : t.ink3, flex: 1 }}>{siteAgeLine(h, todayISO)}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} refreshControl={pull}>

        {/* ── the board's head: back, and the title on the centre line ────
            The client's name sits under it because this is one person's
            record; the picker that names them is below the fold once
            somebody is chosen, as on client-body.tsx. */}
        <PageHead title="Goals" subtitle={client?.name || undefined} />

        {!USE_SUPABASE ? (
          <Section>
            <Notice tone={t.warn} kicker="Not Loaded" title="This Build Is Running Without the Server"
              note="Goals live on the server and belong to the client, so there is no local copy of somebody else's to fall back on. Nothing below is a claim that they have not set any." />
          </Section>
        ) : (
          <>
            {r.status === 'error' ? (
              <Section>
                <Notice tone={t.warn} kicker="Roster" title="Your Clients Could Not Be Read"
                  note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
              </Section>
            ) : null}

            {!picked ? picker : null}

            {picked && !askable ? (
              /* ── the third answer ────────────────────────────────────────
                 Not "they have set none" and not "the read failed". This
                 person is a name the coach typed into their own book: there is
                 a `coach_clients` row and no account behind it, so there is no
                 goal to read, no scan, no weigh-in and no tape — and nothing
                 was ever refused, because nothing was ever entitled to be
                 asked. Four sections of "could not be read" would tell a coach
                 to try again on a connection that is working perfectly.

                 The same distinction `wellnessPanel`'s `not-asked` kind keeps
                 apart from `unreadable` in src/lib/coachWellness.ts. */
              <View>
                <Rule />
                <Section>
                  <Notice kicker="No Account" title={`${client?.name ?? 'This Client'} Has No Repple Account`}
                    note={`You added ${who} to your book by hand, so there is nothing of theirs on the server to read — no goals, no scans, no weigh-ins and no tape. That is not an empty record and not a failed read: goals are set in the app, and ${who} does not have it. Invite them from your client list and this screen fills in from the day they accept.`} />
                </Section>
              </View>
            ) : picked ? (
              <View>
                <Rule />

                {/* The three states, kept apart. Each is a different fact about
                    this person and each starts a different conversation. */}
                {goalStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their goals…</Text></Section>
                ) : board.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their Goals Could Not Be Read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${who} has set none — that is a different screen and a different conversation.`} />
                  </Section>
                ) : board.state === 'none' ? (
                  <Section>
                    <SectionHead title={client?.name ?? 'Their Goals'} note="none set" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      {who} hasn&rsquo;t set a goal yet. The read came back and it was empty, so this
                      is about them rather than about the connection — which makes it worth raising.
                    </Text>
                  </Section>
                ) : board.state === 'reached' ? (
                  <Section>
                    <SectionHead title={client?.name ?? 'Their Goals'} note="all reached" />
                    <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.md }}>
                      Everything {who} set has been reached and marked done. Nothing is outstanding —
                      which is not the same as nothing being set, and is usually the moment to agree
                      the next one.
                    </Text>
                    {board.achieved.map(goalCard)}
                  </Section>
                ) : (
                  <>
                    {lead ? (() => {
                      /* ── the board's figure card ─────────────────────────
                         The goal to lead with, as one card: the goal's name
                         over the current reading at the board's figure size,
                         how far along it is as a ring beside it, and what is
                         left. It was a bar for a round; the approved look
                         draws progress against a target as a ring. `lead`
                         is already gated on a WHOLE read of the series, so
                         the percentage is never a figure off a truncated
                         page. */
                      const unit = goalUnit(lead.kind, wu);
                      const figure = fig(goalValue(lead.prog.current, lead.kind, wu));
                      const left = `${fig(Math.abs(goalDelta(lead.prog.remaining, lead.kind, wu)))} ${unit} to go`;
                      const pct = Math.round(Math.max(0, Math.min(100, lead.prog.pct)));
                      return (
                        <Section>
                          <SectionHead title={goalLabel(lead.goal)} note={`${pct}% of the way`} />
                          {/* One stop for the ear: goal, reading, how far, what
                              is left. Four Texts were four unrelated facts. */}
                          <View accessible accessibilityLabel={`${goalLabel(lead.goal)}, ${figure} ${unit}. ${pct}% of the way to the goal, ${left}.`}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
                            {/* The approved look's ring, where the bar was: the
                                same percentage, off the same whole read. */}
                            <Ring size={108} value={pct / 100} figure={`${pct}%`} sub="of the way" spoken={`${pct} percent of the way`} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                              <Text style={{ ...ty.hero, color: t.ink }}>{figure}</Text>
                              <Text style={{ ...ty.body, ...numeric, color: t.ink3, marginStart: 5 }}>{unit}</Text>
                            </View>
                            {/* The same strip of figures the goal rows print —
                                "58% of the way · 4 kg to go" — off a progress
                                object `lead` has already built whole. */}
                            <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>
                              {`${pct}% of the way · ${fig(Math.abs(goalDelta(lead.prog.remaining, lead.kind, wu)))} ${unit} to go`}
                              {lead.goal.targetValue != null ? ` · target ${fig(goalValue(lead.goal.targetValue, lead.kind, wu))} ${unit}` : ''}
                            </Text>
                            </View>
                          </View>
                        </Section>
                      );
                    })() : null}

                    <Section>
                      {/* `isWhole(goalStatus)`, not the bare length. A count is
                          a figure, and under 'partial' this one was a subtotal
                          of a truncated page presented as the whole of what
                          somebody is working toward — "3 open" over a client
                          with eleven. The Flag further down already says the
                          read was cut; it cannot un-say a number a coach has
                          already read as a total. app/(trainer)/client-week.tsx
                          gates its own "N marked" on exactly this, and
                          app/(trainer)/checklists.tsx its "N showing". */}
                      <SectionHead title={client?.name ?? 'Their Goals'}
                        note={isWhole(goalStatus) ? `${board.open.length} open` : undefined} />
                      {/* Deadline pressure, said once at the top.
                       *
                       * The overdue mark was on the individual cards and nowhere
                       * else, so on a client with eleven goals "has anything
                       * slipped" was a question a coach answered by scrolling.
                       * TrueCoach, Trainerize, Everfit and PT Distinction all
                       * lead their goal board with this; it needs no read this
                       * screen was not already making.
                       *
                       * Gated on `isWhole(goalStatus)`, the same gate as the
                       * "N open" note beside the title and for the same reason:
                       * under 'partial' these counts are of a truncated page,
                       * and "nothing is late" drawn from a prefix is the worst
                       * sentence on the screen. The Flag further down says the
                       * read was cut; it cannot un-say an all-clear.
                       *
                       * `deadlineNote` names the open goals it could not judge
                       * and how many, so the figures are never an all-clear over
                       * an empty set. `nowMs` is `useNow()` — see goalCard. */}
                      {isWhole(goalStatus) ? (() => {
                        const line = deadlineNote(deadlineTally(board.open, nowMs));
                        return line ? (
                          <Text style={{ ...ty.label, color: t.ink2, marginBottom: sp.sm }}>{line}</Text>
                        ) : null;
                      })() : null}
                      {board.open.map(goalCard)}
                    </Section>

                    {board.achieved.length ? (
                      <>
                        <Rule />
                        <Section>
                          {/* Same gate. The list stands under 'partial' — the
                              goals in it are real — but the number over it
                              cannot. */}
                          <SectionHead title="Reached"
                            note={isWhole(goalStatus) ? `${board.achieved.length}` : undefined} />
                          {board.achieved.map(goalCard)}
                        </Section>
                      </>
                    ) : null}
                  </>
                )}

                {/* Two things the lists above cannot say for themselves. */}
                {goalStatus === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their goals came back at the row limit, so this is some of them rather than all
                      of them. The newest are here; older ones may not be.
                    </Flag>
                  </Section>
                ) : null}
                {unreadableGoals > 0 ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {unreadableGoals === 1
                        ? 'One more goal is on record in a shape this version of the app cannot show, so it is not in the list above.'
                        : `${unreadableGoals} more goals are on record in a shape this version of the app cannot show, so they are not in the list above.`}
                    </Flag>
                  </Section>
                ) : null}

                {/* ── the tape ──────────────────────────────────────────────
                    The scans above say what the scale and the machine say. A
                    client whose weight has not moved for six weeks can still
                    have lost two centimetres off their waist and put one on
                    their arm, and until now their coach could not see it.

                    Same three states as the goals, kept apart for the same
                    reason: unreadable, nothing recorded, and readings. */}
                <Rule />
                {measStatus === 'loading' ? (
                  <Section><Text style={{ ...ty.body, color: t.ink3 }}>Reading their measurements…</Text></Section>
                ) : tape.state === 'unreadable' ? (
                  <Section>
                    <Notice tone={t.warn} kicker="Unreadable" title="Their Measurements Could Not Be Read"
                      note={`Nothing is shown below because nothing came back. It does not mean ${who} has never measured — the goals above came from a different read and are unaffected either way.`} />
                  </Section>
                ) : tape.state === 'none' ? (
                  <Section>
                    <SectionHead title="Tape" note="none recorded" />
                    <Text style={{ ...ty.body, color: t.ink2 }}>
                      {who} hasn&rsquo;t logged a tape measurement. The read came back and it was
                      empty, so this is about them rather than about the connection — and it is the
                      one record that moves when the scale doesn&rsquo;t.
                    </Text>
                  </Section>
                ) : (
                  <Section>
                    {/* And the same for the tape. `measStatus === 'partial'`
                        means the oldest rows fell off the read, and a SITE
                        whose only readings are old is then missing from
                        `tape.sites` altogether — so this count is not merely
                        short, it is a different set from the one the coach
                        thinks they are being given the size of. The caveat
                        under the list already says the read was cut. */}
                    <SectionHead title="Tape"
                      note={isWhole(measStatus)
                        ? `${tape.sites.length} ${tape.sites.length === 1 ? 'site' : 'sites'}`
                        : undefined} />
                    <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.sm }}>{DIRECTION_CAVEAT}</Text>
                    {tape.sites.map(siteRow)}
                    {/* Only under a whole read. Under 'partial' a site is
                        missing from the list either because nobody has measured
                        it or because its rows are older than the row limit, and
                        naming it as never measured would pick the wrong one. */}
                    {measStatus === 'ready' && unmeasuredSites(tape.sites).length ? (
                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
                        Nothing on record for {unmeasuredSites(tape.sites).join(', ').toLowerCase()} — the
                        client&rsquo;s own screen offers those boxes and they have been left empty.
                      </Text>
                    ) : null}
                  </Section>
                )}

                {measStatus === 'partial' ? (
                  <Section>
                    <Flag tone={t.warn}>
                      Their measurements came back at the row limit, so the newest are here and
                      older ones may not be. A site showing one reading may have earlier ones that
                      did not arrive, and every change is measured against the most recent earlier
                      reading that did.
                    </Flag>
                  </Section>
                ) : null}
                {unreadableMeas > 0 ? (
                  <Section>
                    <Flag tone={t.warn}>
                      {unreadableMeas === 1
                        ? 'One more measurement is on record in a shape this version of the app cannot show, so it is not counted above.'
                        : `${unreadableMeas} more measurements are on record in a shape this version of the app cannot show, so they are not counted above.`}
                    </Flag>
                  </Section>
                ) : null}
              </View>
            ) : null}

            {picked ? picker : null}
          </>
        )}

        {/* What this page is, said once and below the record: the board opens
            on the figure, not on a paragraph. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
          What each client is aiming at, in their own words and numbers, how far along they are,
          and what the tape says. You can read these; you can&rsquo;t change them — a goal is theirs
          to set and theirs to call done, and a measurement is theirs to take.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
