// Trainer · Mark what happened. The queue of past sessions whose outcome
// nobody has recorded yet.
//
// This screen exists because of a coupling that is easy to miss: payroll is
// deliberately unanswerable while any session sits unmarked. payrollTotal()
// returns null rather than guessing, which is right — but it means the gym
// cannot pay anybody until this queue is empty, so marking has to be faster
// than opening each session in turn. Everything here is one tap.
//
// Four outcomes, not two. "Cancelled" and "late cancelled" are different
// commercially — one is usually paid and the other usually is not, per the
// gym's PayPolicy — and "no show" is different again from both. Collapsing
// them into done/not-done would quietly decide a payroll question that belongs
// to the gym, not to this screen.
//
// An empty queue is the good state and says so, rather than rendering a blank
// stretch of screen that looks like a loading failure.
//
// ── It is the coach's queue, not the gym's ─────────────────────────────────
//
// This screen read the queue by `tenant_id` and opened with
// `if (!tenant?.id) return;`. A coach who works for himself has no gym and
// therefore no tenant, so that line returned before anything was read — and
// because the unread state IS null, the screen sat on "Loading…" indefinitely
// with no error and no retry. He could not mark a single session.
//
// The rows are now read by `trainer_id`, which is what `sessions_trainer` in
// supabase/parts/09-sessions-access.sql has always scoped them by. A gym
// trainer sees exactly what they saw before; an independent one can finally
// work. See src/lib/trainerSessions.ts for why that is the right key rather
// than a convenient one.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, fig, Flag, Ghost, Cta, Notice } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useTenant } from '../../src/ui/tenant';
import { useAuth } from '../../src/ui/auth';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { rateCentsToSnapshot } from '../../src/lib/rateSnapshot';
import { fetchMyCurrency } from '../../src/lib/myCurrency';
import type { MyCurrency } from '../../src/lib/currencySource';
import { tapLight } from '../../src/ui/haptics';
import { type PtSession, type SessionOutcome } from '../../src/lib/gymSessions';
import {
  MARK_WINDOW_DAYS, awaitingOutcome, fetchMySessions, windowStart,
} from '../../src/lib/trainerSessions';
import { useFloorQueue } from '../../src/ui/floorQueue';
import { floorFullLine, floorPendingNote, flushResultLine, keptOfflineLine } from '../../src/lib/floorQueue';
// The record, as opposed to the queue. See "What Already Happened" below.
import {
  pastSessions, pastVerdict, PAST_STATES, PAST_STATE_LABEL, PAST_STATE_NOTE, type PastState,
} from '../../src/lib/sessionHistory';
// ── Finishing a session, as opposed to merely marking it ──────────────────
//
// This screen was the ONLY way a session ever got an outcome, and it asks the
// question in isolation: what happened, four buttons, done. The exercises that
// were actually done in the hour were typed on a different screen, carried no
// session, and were never joined to it — so a coach could close a session with
// no record of what it contained, or write the record and leave the session
// open holding a settlement up.
//
// "Finish This Session" is the way in from here: it opens the log with this
// session in hand, and Save writes both. What the log then does about marking
// the session delivered — and why that is one press rather than two — is
// argued in src/lib/sessionFinish.ts.
import {
  canFinish, fetchSessionLogCounts, finishBlockedNote, loggedAgainstLine,
  loggedExercisesLine, type SessionLogCounts,
} from '../../src/lib/sessionFinish';
import {
  NO_FILTER, clientOptions, emptyFilterLine, filterActive, filterLine, filterSessions,
  stateCounts, type SessionFilter,
} from '../../src/lib/sessionFilter';
import { appLocale } from '../../src/lib/locale';
// A day on this screen is a day in the coach's own life. `startsAt.slice(0, 10)`
// is the UTC date of a row this screen renders in local time — see `byDay`.
import { isoDay } from '../../src/lib/weekStart';
import { localDate } from '../../src/lib/localDate';
// ── Answering a request for an hour the coach never opened ────────────────
//
// This screen is where a coach settles what has already happened. The requests
// queue is the opposite — what has not happened yet, and cannot until they
// answer — and it is here rather than on a screen of its own for one reason: a
// request stops meaning anything the moment its hour arrives (src/lib/
// sessionRequests.ts · EXPIRY_RULE), so it has to be somewhere a working coach
// already opens. A screen nobody visits is where a time-limited question goes
// to lapse.
//
// It is drawn ABOVE the marking queue and separated by its own heading,
// because the two lists are answers to different questions and the harm in
// running them together is that "4 to mark" and "2 asking" become one number
// that means neither.
import { fetchCoachRequests, answerRequest, type CoachRequest } from '../../src/ui/sessionRequests';
import {
  COACH_ACCEPT_RULE, OUTCOME_LABEL, REQUEST_NOTE_MAX, answerRefusalNote,
  answerTellLine, answeredConfirmation, coachQueue, coachQueueNote,
} from '../../src/lib/sessionRequests';
import { sendPushChecked } from '../../src/ui/pushNotifications';
import { hitSlopFor } from '../../src/lib/a11y';
import { USE_SUPABASE } from '../../src/lib/config';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { FORWARD_ICON } from '../../src/ui/direction';

/**
 * The four outcomes, in the order a person would consider them.
 *
 * `wholeDay` says whether an outcome may be applied to a whole day at once, and
 * it is a NAMED PROPERTY because the whole-day row used to be
 * `OUTCOMES.slice(0, 2)`.
 *
 * Two things were wrong with that. The small one: it offered two of the four,
 * so a coach whose Tuesday was called off — the single most common reason a
 * whole day needs clearing — had to tap every session individually, which is
 * the tapping this control exists to remove, and payroll stays unanswerable
 * until they finish. The large one: a slice is positional. The day somebody
 * reorders this array to put the outcomes in a different order on screen, the
 * whole-day row silently starts offering a different pair, with nothing
 * anywhere saying it changed and no way to notice except by using it. A
 * property moves with its row.
 *
 * All four qualify today. The field is not therefore redundant: it is the place
 * a fifth outcome that must NOT be a whole-day action gets excluded by name.
 */
const OUTCOMES: { id: SessionOutcome; label: string; short: string; wholeDay: boolean; tone: (t: Theme) => string }[] = [
  { id: 'completed',      label: 'Went Ahead',    short: 'Done',        wholeDay: true, tone: (t) => t.brand },
  { id: 'no_show',        label: 'Did Not Turn Up', short: 'No show',   wholeDay: true, tone: (t) => t.crit },
  { id: 'late_cancelled', label: 'Cancelled Late', short: 'Late cxl',   wholeDay: true, tone: (t) => t.s3 },
  { id: 'cancelled',      label: 'Cancelled in Time', short: 'Cxl',     wholeDay: true, tone: (t) => t.ink3 },
];

/** The subset offered on the whole-day row, by property rather than by
 *  position. Computed once — it cannot change between renders. */
const WHOLE_DAY_OUTCOMES = OUTCOMES.filter((o) => o.wholeDay);

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

/**
 * The hour a request is about, written out — or null when it cannot be read.
 *
 * Deliberately NOT `when` above, which answers a dash. A dash is the right
 * answer in a slot under a label and the wrong one as the subject of a
 * sentence: "Say yes to — ?" is what `check:prose` exists to stop. A request
 * whose hour will not parse is not drawn at all.
 */
const requestWhen = (iso: string): string | null => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(appLocale(), {
    weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
};

/** The mark beside a past session. A 6pt dot; the words stay in ink beside it,
 *  because `crit`/`warn`/`good` are marks in this app and never text colour. */
const stateTone = (t: Theme, s: PastState): string => {
  switch (s) {
    case 'delivered': return t.brand;
    case 'missed': return t.crit;
    case 'late_cancelled': return t.s3;
    case 'cancelled': return t.ink3;
    case 'unmarked': return t.warn;
  }
};

/** A bare day, through `appLocale()` — a hardcoded tag is what `check:locale`
 *  refuses, and this string names the edge of what has been read. */
const dayOnly = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Group by calendar day so a trainer can clear a whole day at once.
 *
 * ── The day is the coach's own, not the UTC one ──────────────────────────
 *
 * This was `s.startsAt.slice(0, 10)`, which is the UTC date of a timestamp that
 * every row on this screen RENDERS in local time. West of Greenwich the two
 * disagree for every evening session: a coach in Los Angeles saw "6:30 PM" on a
 * row filed under tomorrow, under a heading naming a day they had not worked
 * yet. The whole-day mark buttons then acted on that set — so "everyone on
 * Tuesday went ahead" marked Monday evening and Tuesday morning, and the
 * sessions those outcomes belonged to were left in the queue holding payroll up.
 *
 * `isoDay` from src/lib/weekStart.ts is the local `YYYY-MM-DD` this app already
 * uses everywhere a day is a day in somebody's life, and `localDate` reads it
 * back without a timezone moving it. The label is the same day the rows say.
 */
function byDay(sessions: PtSession[]): { day: string; label: string; rows: PtSession[] }[] {
  const m = new Map<string, PtSession[]>();
  for (const s of sessions) {
    const at = new Date(s.startsAt);
    // A row whose start will not parse is not filed under today: that would put
    // it in a day a coach then marks wholesale. It gets its own bucket, sorted
    // to the end, and is still markable one row at a time.
    const day = Number.isFinite(at.getTime()) ? isoDay(at) : '';
    const list = m.get(day);
    if (list) list.push(s); else m.set(day, [s]);
  }
  return [...m.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))   // most recent day first
    .map(([day, rows]) => ({
      day,
      label: dayHeading(day),
      rows: rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }));
}

/** The heading over a day's rows, in the reader's own locale. */
function dayHeading(day: string): string {
  const d = localDate(day);
  if (!d) return 'Date not readable';
  return d.toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function TrainerSessions() {
  const t = useTheme();
  const router = useRouter();
  const { tenant, refresh: refreshTenantRaw } = useTenant();
  // Wrapped so the refresh list below is all promises. `useTenant().refresh`
  // bumps a tick and returns nothing.
  const refreshTenant = useCallback(async () => { refreshTenantRaw(); }, [refreshTenantRaw]);
  // ── who these sessions belong to ──────────────────────────────────────────
  //
  // The coach, by `trainer_id` — NOT the gym, by `tenant_id`.
  //
  // This screen opened with `if (!tenant?.id) return;`, and a coach with no gym
  // has no tenant, so `load` returned before doing anything at all. `queue`
  // stays null, and null is this screen's "not read yet" state — so it sat on
  // "Loading…" for ever, with no error, no retry and nothing to say why. An
  // independent trainer could not mark a single session outcome, which is the
  // one thing this screen exists to do.
  //
  // `sessions_trainer` in supabase/parts/09-sessions-access.sql has always
  // scoped these rows by the trainer who owns the slot; the tenant filter was
  // an extra narrowing the coach app had no reason to apply to its own
  // sessions. See src/lib/trainerSessions.ts.
  const { user, loading: authLoading } = useAuth();
  const uid = user?.id ?? null;
  // Named `floor` rather than `queue`: this screen already calls its list of
  // unmarked sessions `queue`, and two things called that on one screen is how
  // somebody later flushes the wrong one.
  const floor = useFloorQueue(uid);
  // The rate to snapshot when an outcome is recorded. A gym's fee where there
  // is a gym, and otherwise the coach's own — an independent trainer's sessions
  // are priced by the rate on their profile, and there is nowhere else for that
  // figure to come from. Null stays null: the queue's sender then leaves
  // rate_cents untouched rather than writing a zero that reads as "this was
  // free" — `undefined` and null are different instructions and src/ui/floorQueue.ts
  // carries that distinction through unflattened.
  const { sessionFee: ownFee } = useMyTrainerProfile();

  /* ── and the currency, which for a coach with no gym is not the gym's ────
   *
   * The fee above already fell back to the coach's own rate. The CONVERSION did
   * not: it read `tenant?.currency`, which is null for a coach who has no gym,
   * so `minorFromWhole` returned null and every session such a coach ever
   * delivered was filed with no rate at all — including after part 940 let them
   * say what they charge in. Their own fee had a figure and no unit.
   *
   * `fetchMyCurrency` answers it under the one precedence rule, in
   * src/lib/currencySource.ts: the gym on `profiles.tenant_id` is the
   * authority, and `trainers.currency` applies if and only if there is no gym.
   * src/lib/rateSnapshot.ts is where this screen, the schedule and the log
   * screen agree on what to do with the answer — all three call the same
   * function, because three sessions of the same hour's work filed three
   * different ways is worse than three filed with nothing.
   *
   * Read only when the tenant provider is not already holding a gym currency.
   * Where it is, that IS the authoritative answer, asking again would spend a
   * read to be told the same thing, and the in-memory copy is the one that
   * survives a coach standing in a basement with no signal.
   */
  const gymCcy = (tenant?.currency || '').trim() || null;
  const [myCcy, setMyCcy] = useState<MyCurrency | null>(null);
  useEffect(() => {
    let live = true;
    if (gymCcy) { setMyCcy(null); return; }
    void (async () => { const c = await fetchMyCurrency(); if (live) setMyCcy(c); })();
    return () => { live = false; };
  }, [gymCcy]);

  // Whether there is a gym behind these sessions, which decides only what the
  // screen CALLS the thing it is asking for. A gym trainer is holding up a
  // payroll run; an independent coach is holding up their own record of what
  // they delivered. The work is identical, and telling a self-employed trainer
  // that "payroll can be settled" names a process he does not have.
  const hasGym = !!tenant?.id;

  const [queue, setQueue] = useState<PtSession[] | null>(null);
  // Separate from `queue === null`, which only means "not read yet". A refused
  // or unreachable read used to land here as an empty queue, and an empty queue
  // is the screen's good state — so the coach got a tick and "nothing is
  // holding payroll up" at the exact moment the app had no idea what was
  // outstanding. Payroll is then settled short, and nobody finds out until a
  // trainer asks where their session went.
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Marked in this sitting, so an accidental tap can be taken back without
  // hunting for the session again once it has left the queue.
  const [justMarked, setJustMarked] = useState<{ s: PtSession; outcome: SessionOutcome }[]>([]);

  /* ── the window, and what it costs to widen it ────────────────────────────
   *
   * This screen read a fixed 90 days and kept only the UNMARKED sessions out of
   * it. That is a to-do list, and a to-do list empties itself: a coach who
   * cleared the queue on Monday had, by Tuesday, no screen anywhere in the app
   * that said what they had delivered, to whom, or what became of it. The
   * marking is what generates the record and then the record was thrown away.
   *
   * So the whole read is kept now, the queue is derived from it, and the window
   * can be pushed back a quarter at a time. It is paged rather than opened
   * wide, because going further back costs a read and `fetchMySessions` refuses
   * a truncated one outright (`assertWhole` — a payroll figure over an unknown
   * fraction of a set is worse than no figure). A quarter at a time keeps each
   * read inside the row cap for any realistic coach and makes the boundary
   * something the coach chose rather than something that happened to them.
   */
  const [all, setAll] = useState<PtSession[] | null>(null);
  /** The window the rows in `all` actually cover. Never assumed from a control
   *  the coach tapped — only set from a read that came back. */
  const [loadedDays, setLoadedDays] = useState(MARK_WINDOW_DAYS);
  const [widening, setWidening] = useState(false);
  /** A widening that failed. Kept apart from `failed`: the rows already on
   *  screen are still real and still current, and blanking them because the
   *  quarter BEFORE them could not be read would take a working record away. */
  const [widenErr, setWidenErr] = useState<string | null>(null);
  // Read inside the catch below, where the state value would be the one
  // captured when `load` was built rather than the one that is true now.
  const haveRows = useRef(false);

  const load = useCallback(async (days: number = MARK_WINDOW_DAYS) => {
    // Still working out who is signed in. Not an answer either way, so leave
    // the queue unread — the effect runs again when auth settles.
    if (authLoading) return;
    if (!uid) {
      // Nobody signed in. This screen has no way to know whose sessions to
      // ask for, and an empty queue would say "nothing outstanding" — which is
      // the one thing it must never say without having looked.
      reportError('sessions.awaiting', new Error('no signed-in coach to read sessions for'));
      setQueue(null);
      setAll(null);
      haveRows.current = false;
      setFailed(true);
      return;
    }
    setWidening(true);
    setWidenErr(null);
    if (!haveRows.current) setFailed(false);
    try {
      // 90 days back by default: far enough to catch a forgotten fortnight,
      // short enough that the query stays cheap and the list stays readable.
      // `days` is what the coach has asked for beyond that.
      const since = windowStart(days);
      const mine = await fetchMySessions(supabase, uid, since, new Date().toISOString());
      setAll(mine);
      haveRows.current = true;
      setLoadedDays(days);
      setQueue(awaitingOutcome(mine));
      setFailed(false);
    } catch (e) {
      reportError('sessions.awaiting', e);
      if (haveRows.current) {
        // A wider read that failed leaves the narrower one standing. What the
        // coach loses is the extra quarter, and they are told exactly that
        // rather than watching the screen they were working on empty itself.
        setWidenErr('That earlier period could not be read, so this list still ends where it did. Nothing already on this screen has changed.');
      } else {
        // Leave the queue unknown rather than empty. [] here would be read as
        // "nothing outstanding", which is a claim about the gym's payroll this
        // screen is in no position to make.
        setQueue(null);
        setAll(null);
        setFailed(true);
      }
    } finally {
      setWidening(false);
    }
  }, [uid, authLoading]);

  useEffect(() => { void load(MARK_WINDOW_DAYS); }, [load]);

  /* ── what the coach has been ASKED, as opposed to what they delivered ─────
   *
   * Its own state and its own read, deliberately not folded into `load`. The
   * marking queue is `sessions`; this is `session_requests`, a different table
   * with different policies, and a failure in either must not be reported as a
   * failure in the other — a coach told "could not be read" over an empty
   * requests list would stop looking, and the thing they stopped looking at is
   * a client waiting for an answer.
   */
  const [reqs, setReqs] = useState<CoachRequest[] | null>(null);
  const [reqStatus, setReqStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [reqNamesRead, setReqNamesRead] = useState(true);
  const [answering, setAnswering] = useState<string | null>(null);
  /** The coach's words on a decline, keyed by request. Optional — a coach who
   *  declines without explaining has still given an answer, and a box that
   *  demanded a reason would collect full stops typed to get past it. */
  const [declineNote, setDeclineNote] = useState<Record<string, string>>({});

  const loadRequests = useCallback(async () => {
    const out = await fetchCoachRequests();
    setReqs(out.rows);
    setReqStatus(out.status);
    setReqNamesRead(out.namesRead);
  }, []);
  useEffect(() => { void loadRequests(); }, [loadRequests]);

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * Both reads, and they stay two reads: the marking queue is `sessions` and
   * the requests are `session_requests`, different tables with different
   * policies, and one failing must not be reported as the other failing. The
   * gesture asks for both because the coach pulling it down wants the screen
   * to be right, not one half of it.
   *
   * Both are written from somewhere else: a client asking for an hour, and a
   * session falling into the marking window because time passed. */
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([load(MARK_WINDOW_DAYS), loadRequests(), refreshTenant()]),
    [load, loadRequests, refreshTenant],
  ));

  /**
   * Say yes or no.
   *
   * Nothing is checked here before calling. The clash has to be tested inside
   * the same transaction as the write or it is a test against a calendar that
   * can change underneath it, and `answer_session_request` does exactly that,
   * behind `select … for update` on the request row — so one question cannot
   * become two sessions however many devices answer it. Every refusal comes
   * back named, and `answerRefusalNote` is the one place it becomes a sentence.
   */
  async function answer(r: CoachRequest, accept: boolean) {
    const when = requestWhen(r.startsAt);
    if (!when) return;
    // A courtesy, not the guarantee. Two taps in the same frame both pass this,
    // and so do two handsets — which is exactly why the guarantee is the
    // `select … for update` inside `answer_session_request` and not here. What
    // this saves is the second alert.
    if (answering) return;
    setAnswering(r.id);
    const words = (declineNote[r.id] ?? '').trim() || null;
    const res = await answerRequest(r.id, accept, accept ? null : words);
    setAnswering(null);
    await loadRequests();
    if (!res.ok) {
      Alert.alert('Not answered', answerRefusalNote(res.reason, res.className));
      return;
    }
    setDeclineNote((p) => { const next = { ...p }; delete next[r.id]; return next; });
    // The accepted session belongs on the coach's own calendar too, and that
    // list is read by a different provider on a different screen. Nothing here
    // writes to it: the row is in `sessions`, and the calendar's live
    // subscription is what picks it up.
    const push = await sendPushChecked(
      [r.clientId],
      accept ? 'Your session is on' : 'About that time',
      accept ? `Your coach said yes to ${when}.` : `Your coach can’t do ${when}.`,
      { route: '/(client)/request-session' },
      'bookings',
    );
    // Three outcomes, and this warned on one of them. `ok` covers a send that
    // was accepted and could only part-read the client's handsets (`partial`),
    // and a send that was accepted while `notify_users` wrote no row at all
    // (`recorded: 0`) — both of which read on screen exactly like the case
    // where the client has been told. `answerTellLine` is the one place the
    // three are separated, and it is tested there.
    const lines = [answeredConfirmation(accept, when)];
    const told = answerTellLine({
      ok: push.ok, recorded: push.recorded, inboxKept: push.inboxKept, partial: push.partial,
    });
    if (told) lines.push(told);
    Alert.alert(accept ? 'Session created' : 'Answered', lines.join('\n\n'), [{ text: 'OK' }]);
  }


  const loaded = queue !== null;
  const rows = queue ?? [];

  /* ── narrowing a quarter of sessions down to the one being looked for ────
   *
   * The filter is applied to what is DRAWN and to nothing else. Every figure on
   * this screen — the Hero, the three KPIs, the size of the record — stays on
   * the unfiltered lists, because they are facts about the coach's book and a
   * coach who types three letters into a search box has not changed how many
   * sessions are waiting on an outcome. A Hero that fell to 2 because a name
   * was typed would be the same defect as an unread queue rendering as zero,
   * arrived at from the other direction, and this screen is one a gym settles
   * payroll against.
   *
   * `filterActive` and the sentences live in src/lib/sessionFilter.ts, which
   * exists mainly to keep "you have none" and "none of these matches what you
   * narrowed to" from ever being the same sentence.
   */
  const [filter, setFilter] = useState<SessionFilter>(NO_FILTER);
  const narrowed = filterActive(filter);
  const clearFilter = () => setFilter(NO_FILTER);
  const shownRows = useMemo(() => filterSessions(rows, filter), [rows, filter]);
  /** Unfiltered, for the KPI row: how many days of the coach's queue there are
   *  is not a property of what they have typed into a box. */
  const allDays = useMemo(() => byDay(rows), [rows]);
  const days = useMemo(() => byDay(shownRows), [shownRows]);

  /* Everything in the window that has already finished, newest first —
   * delivered, not attended, cancelled either way, and the ones still waiting
   * on an outcome. Cancellations are kept rather than filtered out: they are
   * the evidence the hour was booked, and supabase/parts/195 is the argument
   * for why removing that evidence quietly improves every figure computed over
   * what is left. */
  const history = useMemo(() => pastSessions(all ?? []), [all]);

  /* ── what was actually logged in each of these hours ──────────────────────
   *
   * A second read, deliberately its own: `workouts` is a different table with
   * different policies from `sessions`, and one failing must not be reported as
   * the other failing. It is also the read that must never be allowed to
   * fabricate a zero — a coach shown "nothing was logged" about an hour they
   * wrote up types it in again, and their client ends up with the same session
   * twice. `loggedAgainstLine` is what holds that line; the status is carried
   * rather than the map alone, because a map built from a failed read is an
   * empty map and an empty map says "nothing" about every row in it.
   */
  const [logs, setLogs] = useState<SessionLogCounts>(
    { status: 'loading', bySession: new Map(), namesBySession: new Map() });
  const historyIds = useMemo(() => history.map((s) => s.id).join(','), [history]);
  useEffect(() => {
    const nothing: SessionLogCounts = { status: 'ready', bySession: new Map(), namesBySession: new Map() };
    if (!USE_SUPABASE) { setLogs(nothing); return; }
    const ids = historyIds ? historyIds.split(',') : [];
    if (!ids.length) { setLogs(nothing); return; }
    let live = true;
    // The previous answer is kept while the next read is in flight, so widening
    // the window does not blank every line that is already right.
    setLogs((p) => ({ ...p, status: 'loading' }));
    void fetchSessionLogCounts(supabase, ids).then((out) => { if (live) setLogs(out); });
    return () => { live = false; };
  }, [historyIds]);
  /* The state is `pastVerdict`'s and is passed in rather than re-derived, so
   * the chip a coach filters by and the label printed on the row can never come
   * from two different opinions about the same session. */
  const stateOf = useCallback((row: PtSession): PastState => pastVerdict(row).state, []);
  const shownHistory = useMemo(
    () => filterSessions(history, filter, stateOf), [history, filter, stateOf]);
  const historyDays = useMemo(() => byDay(shownHistory), [shownHistory]);
  /** Who is in the window at all. Built from the record rather than from the
   *  queue: the queue is the unmarked part of the same set, so a picker built
   *  from it would lose every client whose sessions are all marked — which is
   *  most of them, and exactly who somebody looking through the record wants. */
  const who = useMemo(() => clientOptions(history), [history]);
  const counts = useMemo(() => stateCounts(history, stateOf, PAST_STATES), [history, stateOf]);
  /** The picked client's name, for the sentence. Null when the pick names
   *  somebody no longer in the window — the chip goes with them, and a filter
   *  matching nobody must still be explainable. */
  const pickedName = useMemo(
    () => who.find((c) => c.clientId === filter.clientId)?.name ?? null, [who, filter.clientId]);
  /** The instant the loaded window starts at — the edge of what this screen can
   *  answer for, named on screen rather than implied by a list that stops. */
  const windowFrom = useMemo(() => windowStart(loadedDays), [loadedDays]);

  /* ── going off to finish one, and coming back ─────────────────────────────
   *
   * The log screen writes the entries AND marks the session delivered, so a
   * session finished there is gone from this queue on the server and still
   * drawn here until something re-reads. A coach who presses "Finish This
   * Session", writes the hour up, comes back and sees the session still sitting
   * in "waiting on an outcome" has been told the finish did not work — and the
   * fix they reach for is to mark it a second time.
   *
   * So the return is re-read, and ONLY the return: a ref set on the way out and
   * cleared on the way back in. A blanket reload on every focus would buy the
   * same correctness and charge a read for every visit to the tab.
   */
  const wentToFinish = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!wentToFinish.current) return;
    wentToFinish.current = false;
    void load(loadedDays);
  }, [load, loadedDays]));

  const finish = (s: PtSession) => {
    if (!s.clientId) return;
    wentToFinish.current = true;
    router.push({
      pathname: '/(trainer)/log-session',
      params: {
        clientId: s.clientId,
        // The name is a label and may legitimately not have been read. Sent as
        // an empty string rather than the word "Client", which would put a
        // placeholder in the title of a screen that writes to a real person.
        name: s.clientName ?? '',
        sessionId: s.id,
        sessionAt: s.startsAt,
      },
    });
  };

  const mark = async (s: PtSession, outcome: SessionOutcome) => {
    // Unreachable in practice — with no uid the queue is `failed` and no row is
    // drawn to tap — but the write is scoped by the coach's id and a `!` here
    // would be a claim rather than a check.
    if (!uid) return;
    setBusy(s.id);
    try {
      // Snapshot the fee at the moment of marking, so a later fee change cannot
      // rewrite what this session was worth. The snapshot is taken HERE and
      // carried into the queue rather than recomputed at flush time: a session
      // marked on Tuesday and sent on Thursday is worth what it was worth on
      // Tuesday, and re-reading the fee would let a rate change in between
      // quietly rewrite it.
      //
      // A SNAPSHOT ALREADY WRITTEN IS A HISTORICAL FACT. This changes what is
      // filed from now on and nothing else — no session already delivered is
      // re-derived, re-priced or backfilled by any of this, including the ones
      // an independent coach delivered with no currency to convert by.
      //
      // Converted by whatever currency actually resolves — src/lib/rateSnapshot.ts
      // holds the rule and all three writing screens call it — and never by a
      // factor of a hundred: in yen that snapshot was a hundred times the fee
      // and in dinar a tenth of it, on the column payroll is settled from. When
      // nothing names a currency it stays null, `undefined` leaves rate_cents
      // untouched, and payrollByTrainer falls back to the rate the gym states
      // today, which is a figure somebody chose. A zero is not.
      const rateCents = rateCentsToSnapshot({
        gymFee: tenant?.sessionFee, ownFee, gymCurrency: tenant?.currency, mine: myCcy,
      }) ?? undefined;
      // ── the outcome, and the room it is recorded in ────────────────────
      //
      // This is the same money as the class tick, one session at a time, and
      // it went straight through: a throw produced "check your connection and
      // try again", the row stayed in the list, and a coach clearing a day's
      // sessions in a basement did it three times and got nowhere.
      //
      // `markMyOutcome` throws on a zero-row update as well as on a transport
      // failure, and those are not the same event — one is the session not
      // being theirs to mark, which will be true again next time. The queue
      // separates them: `refused` keeps the row in the list and says so,
      // `unsent` takes it off the list because the coach HAS decided and this
      // phone now holds that decision, and says the gym cannot see it yet.
      const out = await floor.attempt({
        kind: 'session-outcome', sessionId: s.id, clientName: s.clientName ?? null, outcome, rateCents,
      });
      if (out === 'refused') {
        Alert.alert('Not recorded',
          'That outcome was not saved and is not waiting to send — the session may no longer exist, or it is not yours to mark.');
        return;
      }
      // Nothing was kept. The session stays on the Mark Sessions queue, because
      // that is where it actually still is — and the sentence names the cause,
      // which unlike a refusal is one the coach can clear themselves.
      if (out === 'full') {
        Alert.alert('Not recorded', floorFullLine('That outcome'));
        return;
      }
      setQueue((prev) => (prev ?? []).filter((x) => x.id !== s.id));
      // The session leaves the queue and JOINS the record, in the same tap. It
      // is the same row seen two ways, and letting the history keep saying
      // "still needs an outcome" for one it has just been given would make the
      // two halves of this screen disagree with each other in front of the
      // person who resolved it.
      setAll((prev) => (prev ?? []).map((x) => (x.id === s.id
        ? { ...x, outcome, outcomeAt: new Date().toISOString() } : x)));
      setJustMarked((prev) => [{ s, outcome }, ...prev].slice(0, 8));
      tapLight();
      if (out === 'unsent') {
        Alert.alert('Kept on this phone', keptOfflineLine('That outcome'));
      }
    } catch (e) {
      reportError('sessions.mark', e);
      Alert.alert('Not recorded', 'That outcome was not saved. Check your connection and try again.');
    } finally { setBusy(null); }
  };

  /**
   * Send what this phone is still carrying, now.
   *
   * The queue is emptied on the app's own two triggers as well — the signal
   * coming back and the app returning to the foreground, both of which reach it
   * through the registry in src/lib/offlineQueue.ts. This is the button for the
   * coach who can see the banner and wants it gone before they walk out.
   *
   * All three arms of the result are reported, because they mean three
   * different things and only one of them is "done". A refused act has been
   * dropped from the queue rather than kept, and a coach who is not told that
   * will press this button for the rest of the install.
   */
  const [sending, setSending] = useState(false);
  const sendWaiting = async () => {
    if (sending) return;
    setSending(true);
    try {
      const line = flushResultLine(await floor.flush());
      if (line) Alert.alert('Sending finished', line);
    } finally { setSending(false); }
  };

  const undo = async (entry: { s: PtSession; outcome: SessionOutcome }) => {
    if (!uid) return;
    try {
      // ── through the queue, like the mark it takes back ──────────────────
      //
      // This was `clearMyOutcome(supabase, uid, entry.s.id)` — straight to the
      // server, while `mark` above goes through `floor.attempt`. The two halves
      // of one feature met in exactly the conditions the queue was built for: a
      // coach on a gym floor with no signal marked a session, the act was kept
      // on the phone, they undid it in front of the client, the undo THREW, and
      // when the signal came back the queue flushed the outcome they had
      // retracted — onto that client's record and onto payroll.
      //
      // A retraction carries the same supersede key as the mark, so offline it
      // replaces the queued act in place and nothing false is ever sent. When
      // the mark HAD reached the server this is the clear that always had to
      // happen, and it is now retried like everything else rather than lost to
      // one failed round trip.
      const out = await floor.attempt({
        kind: 'session-outcome', sessionId: entry.s.id, clientName: entry.s.clientName ?? null, outcome: null,
      });
      if (out === 'refused') {
        // The server read it and declined, so the outcome stands. Named as what
        // is true of the RECORD, because that is what the coach has to act on.
        Alert.alert('Not undone',
          `${entry.s.clientName ?? 'That session'} is still recorded as “${OUTCOMES.find((o) => o.id === entry.outcome)?.label ?? entry.outcome}” — the session may no longer exist, or it is not yours to change.`);
        return;
      }
      setJustMarked((prev) => prev.filter((x) => x.s.id !== entry.s.id));
      setQueue((prev) => [entry.s, ...(prev ?? [])]);
      // Back to unmarked in the record too, for the same reason as above.
      setAll((prev) => (prev ?? []).map((x) => (x.id === entry.s.id
        ? { ...x, outcome: null, outcomeAt: null } : x)));
      tapLight();
      if (out === 'unsent') {
        // Kept, not saved, and never the other way round. What matters to the
        // coach here is the half that IS now true: the outcome they retracted
        // will not be sent, whatever this phone was carrying.
        Alert.alert('Kept on this phone', keptOfflineLine('Taking that outcome back'));
      }
    } catch (e) {
      // The row may keep its outcome on the server, so saying nothing here
      // leaves the coach believing they took back a "no show" they did not —
      // and the gym pays, or does not pay, on the outcome that is still
      // recorded.
      reportError('sessions.undo', e);
      Alert.alert('Not undone', `${entry.s.clientName ?? 'That session'} may still be recorded as “${OUTCOMES.find((o) => o.id === entry.outcome)?.label ?? entry.outcome}”. Check your connection and tap undo again.`);
    }
  };

  /** Mark a whole day the same way. Confirmed, because it is many writes. */
  const markDay = (day: { label: string; rows: PtSession[] }, outcome: SessionOutcome) => {
    const label = OUTCOMES.find((o) => o.id === outcome)?.label ?? outcome;
    // The rows this acts on are the rows on screen, which under a filter is not
    // the whole day. Said out loud rather than left for the coach to work out
    // from a count: "mark the whole day" over a filtered day would otherwise
    // leave sessions behind on a day the coach believes they have cleared, and
    // an unmarked session is what holds a settlement up.
    const narrowNote = narrowed
      ? `\n\nYou have narrowed this list, so this is the ${day.rows.length} shown and not necessarily every unmarked session on that day. Clear the filters first if you meant all of them.`
      : '';
    Alert.alert(
      `${label} — all ${day.rows.length}?`,
      `Every unmarked session on ${day.label} that is shown below will be recorded as "${label}". You can undo each one afterwards.${narrowNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark all', onPress: async () => { for (const s of day.rows) await mark(s, outcome); } },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={pull}
      >
        {/* ── the back control that pointed forwards ─────────────────────
            This drew `FORWARD_ICON` — a bare `›` — in the back position,
            behind an accessibility label that said "Back". Seen on a device,
            reached by deep link from a notification: a chevron pointing away
            from the direction it takes you, with no target ring around it,
            beside Invoices and Statement which both draw the circled `‹`
            that every other screen in this app uses.

            `Ghost icon="back"` is that control. It carries the ring, the
            44pt target and `BACK_ICON`, so it mirrors correctly in RTL
            without this screen knowing about direction at all — which is the
            whole point of src/ui/direction. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Ghost icon="back" onPress={() => router.back()} a11yLabel="Back" />
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Mark Sessions</Text>
        </View>

        <Hero
          label="Waiting on an Outcome"
          figure={fig(loaded ? rows.length : null)}
          note={failed
            ? 'Could not be read — this is not a count of zero.'
            : !loaded
              ? 'Reading your sessions…'
              : rows.length === 0
                ? (hasGym ? 'Nothing outstanding — payroll can be settled.' : 'Nothing outstanding — every session you have delivered is on the record.')
                : (hasGym ? 'Payroll cannot be worked out until every one of these is marked.' : 'Your delivered-sessions count is incomplete until every one of these is marked.')}
        />

        <Rule />

        {/* ── asked, and not yet answered ─────────────────────────────────
            A client can now ask for an hour this coach never opened
            (supabase/parts/740). It is a QUESTION and not a booking: nothing is
            held, no credit has moved, and accepting is the only thing anywhere
            in the app that turns one into a session.

            It sits above the marking queue and under its own heading. The two
            lists answer different questions — what has happened, and what has
            not happened yet — and running them together would produce one
            number that means neither.

            Drawn whenever there is something to answer or something to say
            about why there is not. Loading, failed and empty are three
            different sentences, because an unread queue rendered as "nobody is
            asking" is a client left waiting for an answer their coach was told
            did not exist. */}
        {USE_SUPABASE ? (
          <Section>
            <SectionHead title="Session Requests"
              note={reqs && isWhole(reqStatus) ? (coachQueueNote(coachQueue(reqs).length) ?? 'Nothing waiting') : undefined} />

            {reqStatus === 'error' ? (
              <Flag tone={t.warn}>
                Requests could not be read, so this is not a list of what your clients have asked for.
                Anyone waiting on you is still waiting — check again when you have signal.
              </Flag>
            ) : reqStatus === 'loading' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>Reading what your clients have asked for.</Text>
            ) : (() => {
              const pending = coachQueue(reqs ?? []);
              if (!pending.length) {
                return (
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    Nobody is asking for a time right now. A client can ask for an hour you have not
                    opened, and it will appear here.
                  </Text>
                );
              }
              return (
                <>
                  {reqStatus === 'partial' ? (
                    <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
                      There are more requests than fitted in one read, so this is the soonest of them
                      rather than all of them.
                    </Flag>
                  ) : null}
                  {/* A name that could not be READ is not a client with no
                      name. Said once, above the rows, rather than a dash on
                      each of them. */}
                  {!reqNamesRead ? (
                    <Flag tone={t.warn} style={{ marginBottom: sp.md }}>
                      Your clients’ names could not be read, so the requests below say when rather than
                      who. The times are right and you can still answer them.
                    </Flag>
                  ) : null}
                  {pending.map((r, i) => {
                    const rWhen = requestWhen(r.startsAt);
                    if (!rWhen) return null;
                    const mine = answering === r.id;
                    return (
                      <View key={r.id}>
                        {i ? <Rule /> : null}
                        <View style={{ paddingVertical: sp.md }}>
                          <Text style={{ ...ty.micro, color: t.ink3 }}>{OUTCOME_LABEL.asked}</Text>
                          <Text style={{ ...ty.body, fontWeight: '600', color: t.ink, marginTop: 2 }}>
                            {r.clientName ? `${r.clientName} · ${rWhen}` : rWhen}
                          </Text>
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                            {r.durationMin} min
                          </Text>
                          {r.note ? (
                            <Text style={{ ...ty.caption, color: t.ink2, marginTop: 4 }}>They said: {r.note}</Text>
                          ) : null}

                          <TextInput
                            value={declineNote[r.id] ?? ''}
                            onChangeText={(v) => setDeclineNote((p) => ({ ...p, [r.id]: v }))}
                            placeholder="If you say no, tell them why (optional)"
                            placeholderTextColor={t.ink3}
                            maxLength={REQUEST_NOTE_MAX}
                            accessibilityLabel="A reason, if you say no"
                            style={{
                              ...ty.caption, color: t.ink, backgroundColor: t.surface2,
                              borderRadius: radius.sm, borderWidth: hairline, borderColor: t.ring,
                              paddingHorizontal: sp.md, paddingVertical: sp.sm, marginTop: sp.md, minHeight: 44,
                            }}
                          />

                          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, alignItems: 'center' }}>
                            <Cta label={mine ? 'Saving…' : 'Yes'} onPress={() => { void answer(r, true); }}
                              disabled={mine} a11yLabel={`Say yes to ${rWhen}`} />
                            <Ghost label="No" onPress={() => { void answer(r, false); }}
                              a11yLabel={`Say no to ${rWhen}`} />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  <Notice kicker="WHAT YES DOES" title="It creates the session" note={COACH_ACCEPT_RULE} />
                </>
              );
            })()}
          </Section>
        ) : null}

        <Rule />

        {loaded && rows.length > 0 ? (
          <Section>
            <KpiRow items={[
              { label: 'Sessions', value: fig(rows.length) },
              { label: 'Days', value: fig(allDays.length) },
              // `.slice(5)` off a local `YYYY-MM-DD`, which is what `byDay` now
              // keys on. The last bucket may be the unreadable-date one, whose
              // key is the empty string — a dash there is the right answer, and
              // an empty slot would look like a rendering fault.
              { label: 'Oldest', value: fig(allDays.length ? (allDays[allDays.length - 1].day.slice(5) || null) : null) },
            ]} />
          </Section>
        ) : null}

        {/* What this phone is still carrying, said above the list rather than
            inside it: an outcome kept here has already left the list, so a
            coach who does not see this believes the gym has it — and a gym
            settles payroll on it. A queue that could not be READ is not an
            empty one, so "nothing waiting" is withheld rather than claimed. */}
        {!floor.queueRead ? (
          <View style={{ paddingTop: sp.sm }}>
            <Flag tone={t.warn}>
              What this phone is still carrying could not be read, so whether any outcomes are waiting to go up is not known. Nothing has been lost — it is not being written over either.
            </Flag>
          </View>
        ) : floorPendingNote(floor.unsent) ? (
          <View style={{ paddingTop: sp.sm }}>
            <Flag tone={t.warn}>{floorPendingNote(floor.unsent)}</Flag>
            {/* The banner used to say something was waiting and offer no way to
                send it, so a coach standing in reception with four bars had to
                guess at what would trigger a flush. The app's own reconnect and
                foreground triggers reach this queue now, and this is the manual
                one for the coach who wants to watch it happen before they leave
                the building. */}
            <View style={{ alignItems: 'flex-start', paddingTop: sp.sm }}>
              <Ghost label="Send Now" a11yLabel="Send what is waiting on this phone"
                onPress={() => { void sendWaiting(); }} />
            </View>
          </View>
        ) : null}

        {/* ── narrowing what is drawn ──────────────────────────────────────
            Ninety days of a full book is several hundred rows and the screen
            had no way to reach into it: no client picker, no search, no filter
            on what became of a session. A coach looking for one person's March
            read everybody's March.

            It narrows the two LISTS and no figure. The Hero above and the three
            KPIs stay on the unfiltered queue, because "seven waiting on an
            outcome" is a fact about the book and not about what somebody typed
            into a box — and this is the screen a gym settles payroll from.

            Drawn only once a read has come back and there is something to
            narrow. Controls over an unread list would be four ways to produce
            an empty screen that has nothing to do with the filters. */}
        {all !== null && (history.length > 0 || rows.length > 0) ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Find" note={narrowed ? 'Filtered' : undefined} />

              <TextInput
                value={filter.text}
                onChangeText={(v) => setFilter((f) => ({ ...f, text: v }))}
                placeholder="Search a client's name"
                placeholderTextColor={t.ink3}
                accessibilityLabel="Search these sessions by client name"
                autoCapitalize="none"
                autoCorrect={false}
                style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }}
              />

              {/* One chip per client in the window, with how many sessions are
                  theirs — so a coach can see somebody has one before tapping
                  into a list with one row in it. An id, not a name: two people
                  called Sam are two people. */}
              {who.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.md }}>
                  {who.map((c) => {
                    const on = filter.clientId === c.clientId;
                    return (
                      <Pressable key={c.clientId} hitSlop={4}
                        onPress={() => setFilter((f) => ({ ...f, clientId: on ? null : c.clientId }))}
                        accessibilityRole="button" accessibilityState={{ selected: on }}
                        accessibilityLabel={`${on ? 'Stop showing only' : 'Show only'} ${c.name}, ${c.count} ${c.count === 1 ? 'session' : 'sessions'}`}
                        style={{ borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2, paddingHorizontal: sp.md, paddingVertical: 6 }}>
                        <Text style={{ ...ty.caption, color: on ? t.brandInk : t.ink2 }}>{c.name} · {c.count}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}

              {/* Outcome, over the record only. Every row in the queue above is
                  unmarked by construction, so a state filter there would be one
                  useful position and four that empty the list. A count of zero
                  is drawn rather than the chip being dropped: a coach who
                  cannot see "cancelled late" has no way to learn that none of
                  their sessions is. */}
              {history.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: who.length > 1 ? 0 : sp.md }}>
                  {PAST_STATES.map((st) => {
                    const on = filter.state === st;
                    return (
                      <Pressable key={st} hitSlop={4}
                        onPress={() => setFilter((f) => ({ ...f, state: on ? null : st }))}
                        accessibilityRole="button" accessibilityState={{ selected: on }}
                        accessibilityLabel={`${on ? 'Stop showing only sessions' : 'Show only sessions'} ${PAST_STATE_LABEL[st]}, ${counts[st]} of them`}
                        style={{ borderWidth: hairline, borderColor: on ? t.brand : t.ring, borderRadius: radius.pill, backgroundColor: on ? t.brand : 'transparent', paddingHorizontal: sp.md, paddingVertical: 5 }}>
                        <Text style={{ ...ty.caption, color: on ? t.brandInk : t.ink2 }}>
                          {PAST_STATE_LABEL[st]} · {counts[st]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {narrowed ? (
                <View style={{ marginTop: sp.md }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {filterLine(shownRows.length + shownHistory.length, rows.length + history.length, filter, pickedName)}
                  </Text>
                  <View style={{ alignItems: 'flex-start', marginTop: sp.sm }}>
                    <Ghost label="Show Everything" a11yLabel="Clear every filter" onPress={clearFilter} />
                  </View>
                </View>
              ) : null}
            </Section>
          </>
        ) : null}

        {failed ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
            <Flag tone={t.crit}>Could not read your sessions</Flag>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>
              There may or may not be sessions waiting on an outcome — the app could not find out.
              {hasGym ? ' Do not settle payroll on this screen until it loads.' : ' Do not treat this as a clear queue until it loads.'}
            </Text>
            <Pressable onPress={() => void load(loadedDays)} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Try reading your sessions again"
              style={{ marginTop: sp.lg, borderWidth: hairline, borderColor: t.ring, borderRadius: radius.pill, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try Again</Text>
            </Pressable>
          </View>
        ) : !loaded ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>Loading…</Text>
        ) : rows.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
            <Icon name="check" size={26} color={t.brand} />
            <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>All caught up</Text>
            <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>
              Every session that has already happened has an outcome recorded{hasGym ? ', so nothing is holding payroll up.' : '.'}
            </Text>
          </View>
        ) : shownRows.length === 0 ? (
          /* NOT "all caught up". There are unmarked sessions and the coach
             narrowed them off the screen themselves — a tick and "nothing is
             holding payroll up" here would be a settlement cleared by a search
             box. */
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.lg }}>
            {emptyFilterLine(rows.length, filter)}
          </Text>
        ) : days.map((day, di) => (
          <View key={day.day}>
            <Section>
              <SectionHead title={day.label} note={`${day.rows.length} to mark`} />

              <View style={{ flexDirection: 'row', gap: sp.sm, flexWrap: 'wrap', marginBottom: sp.md }}>
                <Text style={{ ...ty.caption, color: t.ink3, alignSelf: 'center' }}>Whole day:</Text>
                {/* The label is the control's own claim about an irreversible
                    batch write, and it said "every session on Friday 14 March"
                    while a filter was on — `days` is `byDay(shownRows)` and
                    this acts on the shown rows only. `markDay`'s confirmation
                    already corrects it, but the spoken label is the whole of
                    what a VoiceOver user has BEFORE the dialog, and it is the
                    sentence they act on. It says the count, and says "shown"
                    when the list is narrowed, in the same words `narrowNote`
                    uses.

                    Vertical slop only: `paddingVertical: 5` around an 18pt
                    caption is a 28pt row, under the 44 in src/lib/a11y.ts —
                    and these chips sit 8pt apart, so horizontal slop would
                    have neighbours fighting over the gap. */}
                {WHOLE_DAY_OUTCOMES.map((o) => (
                  <Pressable key={o.id} onPress={() => markDay(day, o.id)}
                    hitSlop={{ top: hitSlopFor(28), bottom: hitSlopFor(28), left: 0, right: 0 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark ${narrowed ? 'the' : 'all'} ${day.rows.length} ${day.rows.length === 1 ? 'session' : 'sessions'}${narrowed ? ' shown' : ''} on ${day.label} as ${o.label}`}
                    accessibilityHint="Asks first. Each one can be undone afterwards."
                    style={{ borderWidth: hairline, borderColor: o.tone(t), borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 5 }}>
                    <Text style={{ ...ty.caption, color: o.tone(t) }}>{o.short}</Text>
                  </Pressable>
                ))}
              </View>

              {day.rows.map((s, i) => (
                <View key={s.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ paddingVertical: sp.md, opacity: busy === s.id ? 0.5 : 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>
                      {s.clientName ?? 'Client'}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {when(s.startsAt)} · {s.durationMin} min
                      {s.trainerName ? ` · ${s.trainerName}` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
                      {OUTCOMES.map((o) => (
                        <Pressable key={o.id} disabled={busy === s.id} onPress={() => mark(s, o.id)} hitSlop={4}
                          accessibilityRole="button" accessibilityLabel={`${s.clientName ?? 'Client'}: ${o.label}`}
                          accessibilityState={{ disabled: busy === s.id, busy: busy === s.id }}
                          style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 8 }}>
                          <Text style={{ ...ty.label, fontWeight: '600', color: o.tone(t) }}>{o.short}</Text>
                        </Pressable>
                      ))}
                    </View>

                    {/* The other half of the same act. The four buttons above
                        close the session and say nothing about what was in it;
                        this writes the hour up and closes it in one press. It
                        is a Ghost and not a Cta: for a coach clearing a day of
                        cancellations the four buttons are still the fast path,
                        and this must not compete with them. */}
                    {canFinish(s) ? (
                      <View style={{ alignItems: 'flex-start', marginTop: sp.md }}>
                        <Ghost label="Finish This Session"
                          a11yLabel={`Write up and finish ${s.clientName ?? 'this client'}’s session`}
                          onPress={() => finish(s)} />
                      </View>
                    ) : (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                        {finishBlockedNote(s)}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </Section>
            {di < days.length - 1 ? <Rule /> : null}
          </View>
        ))}

        {justMarked.length > 0 ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="Marked Just Now" note="Tap to undo" />
              {justMarked.map((e, i) => (
                <View key={e.s.id}>
                  {i > 0 ? <Rule /> : null}
                  <Pressable onPress={() => undo(e)} accessibilityRole="button"
                    accessibilityLabel={`Undo ${e.outcome} for ${e.s.clientName ?? 'client'}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, color: t.ink2 }} numberOfLines={1}>{e.s.clientName ?? 'Client'}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {when(e.s.startsAt)} · {OUTCOMES.find((o) => o.id === e.outcome)?.label}
                      </Text>
                    </View>
                    <Text style={{ ...ty.label, fontWeight: '600', color: t.ink3 }}>Undo</Text>
                  </Pressable>
                </View>
              ))}
            </Section>
          </>
        ) : null}

        {/* ── what already happened ───────────────────────────────────────
            The queue above is a to-do list and empties itself. This is the
            record it generates, and it is the only place in the coach app that
            says what became of a session once it has been marked. Shown only
            once a read has come back: under `failed` the section above already
            says the app could not find out, and repeating a second empty list
            underneath it would read as a coach with no history. */}
        {all !== null ? (
          <>
            <Rule />
            <Section>
              <SectionHead title="What Already Happened"
                note={`${history.length} in ${loadedDays} days`} />

              {/* The edge of the window, said plainly. A list that simply stops
                  is read as a record that stops. */}
              <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                Sessions from {dayOnly(windowFrom)} onwards. Anything earlier is on the server and has not
                been read onto this screen.
              </Text>

              {widenErr ? <Flag tone={t.warn}>{widenErr}</Flag> : null}

              {history.length === 0 ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  No sessions of yours have finished in this window. Read further back to see earlier ones.
                </Text>
              ) : shownHistory.length === 0 ? (
                /* The window still holds sessions; the filter is what is hiding
                   them. "Read further back" would send a coach to buy another
                   read for rows that are already on this phone. */
                <Text style={{ ...ty.label, color: t.ink3 }}>
                  {emptyFilterLine(history.length, filter)}
                </Text>
              ) : historyDays.map((day, di) => (
                <View key={day.day}>
                  {di > 0 ? <Rule /> : null}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md, marginBottom: sp.xs }}>{day.label}</Text>
                  {day.rows.map((s) => {
                    const v = pastVerdict(s);
                    return (
                      <View key={s.id} style={{ paddingVertical: sp.sm }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                          <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>
                            {s.clientName ?? 'Client'}
                          </Text>
                          {/* The tone is the dot. The label is ink beside it. */}
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: stateTone(t, v.state) }} />
                          <Text style={{ ...ty.caption, color: t.ink2 }}>{PAST_STATE_LABEL[v.state]}</Text>
                        </View>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                          {when(s.startsAt)} · {s.durationMin} min
                          {v.at ? ` · marked ${when(v.at)}` : ''}
                        </Text>
                        {/* Said in full only where it changes what somebody
                            should do. A delivered session needs no sentence; an
                            unmarked one is holding up a settlement. */}
                        {v.state === 'unmarked' ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{PAST_STATE_NOTE.unmarked}</Text>
                        ) : null}
                        {/* ── what was done in the hour ──────────────────
                            Drawn where it changes what somebody should do: on
                            a session recorded as DELIVERED, where "nothing is
                            filed against this session" is a real gap in the
                            client's record, and on any session that has
                            something filed against it whatever its state. A
                            cancelled hour with nothing in it needs no sentence
                            saying so.

                            Never a bare count: `loggedAgainstLine` is the one
                            place that decides what may be said, and a read that
                            failed says so rather than reading as an empty
                            session. */}
                        {(() => {
                          const n = logs.bySession.get(s.id) ?? 0;
                          if (v.state !== 'delivered' && !(isWhole(logs.status) && n > 0)) return null;
                          const counted = isWhole(logs.status) || logs.status === 'partial';
                          const what = counted ? loggedExercisesLine(logs.namesBySession.get(s.id) ?? []) : null;
                          return (
                            <>
                              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                                {loggedAgainstLine(logs.status, counted ? n : null)}
                              </Text>
                              {/* The movements themselves. A count says whether
                                  the hour was written up; this says what was in
                                  it, which is what a coach opening last Tuesday
                                  came for. Withheld entirely when there is
                                  nothing to name — never an empty sentence. */}
                              {what ? (
                                <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{what}</Text>
                              ) : null}
                            </>
                          );
                        })()}
                      </View>
                    );
                  })}
                </View>
              ))}

              {/* Going further back costs a read, so it is a tap and not a
                  scroll. The label names the price rather than hiding it. */}
              <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
                <Pressable
                  disabled={widening}
                  onPress={() => void load(loadedDays + MARK_WINDOW_DAYS)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: widening, busy: widening }}
                  accessibilityLabel={`Read the ${MARK_WINDOW_DAYS} days before ${dayOnly(windowFrom)}`}
                  style={{ borderWidth: hairline, borderColor: t.ring, borderRadius: radius.pill, paddingHorizontal: sp.lg, paddingVertical: sp.sm, opacity: widening ? 0.5 : 1 }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>
                    {widening ? 'Reading…' : 'Read Another 90 Days'}
                  </Text>
                </Pressable>
              </View>
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
