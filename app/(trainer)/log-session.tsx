// Trainer · Log the session you just ran, into your client's own record.
//
// A coach standing next to somebody through an hour of squats had nowhere to
// put it. `workouts` only ever accepted writes from the person they belonged
// to, so an in-person session existed in the coach's memory and in neither
// app. 53-coach-logged-workouts.sql opened an insert for a coach's own client,
// attributed with `logged_by`; this is the screen that uses it.
//
// What lands is the same shape the client's own log writes, so their progress,
// PRs, calories, streak and weekly report count it without caring who typed it.
//
// Two things this screen refuses to do:
//
//   · say "logged" when it is not. The write goes through the floor queue,
//     which reports the three answers apart — the server took it, the server
//     refused it, or nobody answered — and a queued write is never reported as
//     saved. See rule 1 in src/lib/floorQueue.ts.
//   · invent a calorie figure. Strength work records reps and weight, not
//     energy, and the client's own screens render an absent burn as a dash.
//     Guessing here would put a fabricated number into somebody else's history.
//
// ── One send per press of Save ────────────────────────────────────────────
//
// It wrote with `logForClient` and then, on any failure, re-issued the same
// insert through the queue. Two sends for one press — and an insert whose
// acknowledgement was lost has already landed, so the retry put the same hour
// of somebody's training in their history twice. `logForClient` also reports a
// PARTIAL insert as a failure, so the retry duplicated exactly the rows that
// had made it. The queue is now the only sender; see `save`.
//
// ── And it asks when the session happened ─────────────────────────────────
//
// Every entry was stamped `new Date().toISOString()` at the moment Save was
// pressed, and there was no way to say otherwise — so a Monday evening session
// written up on the Tuesday landed on the Tuesday in the client's own log,
// their streak, their weekly report and plan-versus-actual. Writing up at the
// end of the day is the ordinary case, not the awkward one. src/lib/sessionWhen.ts
// holds the day arithmetic and the sentence that says what turns on it.
//
// ── Who it is for, and why that is a picker rather than a param ────────────
//
// This screen used to read `clientId` off the route and nothing else. Opened
// any other way it rendered "Client" as its title, took a whole hour of
// somebody's training, and said "This screen was opened without a client, so
// there is nobody to log against" WHEN THE COACH PRESSED SAVE — the worst
// possible moment, because the sets are typed by then and nothing on the screen
// keeps them. src/lib/features.ts left it out of the coach's directory for
// exactly that reason: a search result that leads to lost work is worse than no
// search result. So it has a picker, and it is listed.
//
// The picker is seeded from the param when there is one, so the way in from the
// client's own screen is unchanged — the coach lands with the person already
// chosen and never sees a list. And the CTA is HELD until somebody is chosen,
// with the reason under it, rather than accepting an hour of typing against
// nobody: the check that used to happen at save now happens before the first
// set is entered.
//
// The roster it offers is only ever the roster that LOADED. Under a read that
// failed the list is unknown, not empty, and this screen says which — a coach
// standing on a gym floor being shown "you have no clients" would put the phone
// away. A client seeded from the param stays selectable through all of that,
// because that id came from the person's own screen and does not depend on this
// screen's read of anything.
//
// ── And it can now FINISH a session, not just log one ─────────────────────
//
// "You can start a session but you can't finish a session and have it marked
// completed and save the information that was logged during the session."
//
// This screen wrote `workouts` rows and contained no session id anywhere, so
// the hour that was booked and the hour that was written up were two records
// with nothing joining them. Marking the session delivered happened later and
// elsewhere, on app/(trainer)/sessions.tsx. A coach who wrote the session up
// still had it in the marking queue holding a settlement up.
//
// Opened from a session (`sessionId`), Save now does both: the entries are
// written carrying that session, and the session is marked delivered. Whether
// that second write should happen on the same press at all is a real question
// — supabase/parts/370 SPENDS A CLIENT'S CREDIT at delivery — and the argument
// is written out in the header of src/lib/sessionFinish.ts rather than here.
// The short of it: same press, but on a control that names what it does, with
// the consequence stated above it, and the two answers reported apart.
//
// Two things this screen will not do with a session in hand:
//
//   · attempt the outcome after the SERVER REFUSED the log. A credit spent for
//     an hour with no record of what was done in it is the worst ending
//     available, and it is the one nobody would ever find.
//   · let the client be changed. supabase/parts/890 requires the session to be
//     FOR the person whose training this is, so a picker that could point an
//     hour at somebody else's booking is a refused insert at best. With a
//     session in hand the client is the session's, stated and not chosen.
import { useCallback, useEffect, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { readLift, type WeightUnit } from '../../src/lib/units';
import { useSettings } from '../../src/ui/settings';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Flag } from '../../src/ui/kit';
import { Icon } from '../../src/ui/Icon';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { useAuth } from '../../src/ui/auth';
import { useRoster } from '../../src/ui/roster';
import { searchRoster, rosterSearchLine } from '../../src/lib/rosterSearch';
import { hitSlopFor } from '../../src/lib/a11y';
import { useCoachExercises, mergeExerciseLists } from '../../src/ui/coachExercises';
import { useFloorQueue } from '../../src/ui/floorQueue';
import { floorPendingNote, flushResultLine, keptOfflineLine, refusedLine } from '../../src/lib/floorQueue';
// When the session happened, which this screen never asked. See the module
// header: `new Date().toISOString()` at the moment Save was pressed put a
// Monday evening session on the Tuesday it was written up.
import {
  hourLabel, logDayOptions, logStamp, logStampProblem, logWhenLine,
} from '../../src/lib/sessionWhen';
import { isoDay } from '../../src/lib/weekStart';
// Finishing, as opposed to logging. The decision about whether Save may mark a
// session delivered — and the sentences that report the two writes apart — live
// there, tested, rather than in this file.
import {
  DELIVERED_MEANS, NOT_DELIVERED_MEANS, finishCta, finishReport,
  type OutcomeAnswer,
} from '../../src/lib/sessionFinish';
// The rate to snapshot when this screen marks a session delivered. The same
// figure app/(trainer)/sessions.tsx snapshots, from the same two places and by
// the same currency-aware conversion — a session finished from here must not be
// worth a different amount from one finished from the queue. That is now
// literal: both call `rateCentsToSnapshot`, and so does the schedule.
import { useTenant } from '../../src/ui/tenant';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { rateCentsToSnapshot } from '../../src/lib/rateSnapshot';
import { fetchMyCurrency } from '../../src/lib/myCurrency';
import type { MyCurrency } from '../../src/lib/currencySource';
import { notifySuccess } from '../../src/ui/haptics';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { BACK_ICON } from '../../src/ui/direction';

/** The same starter list the program builder offers. */
const LIB = [
  { name: 'Back Squat', group: 'Legs' }, { name: 'Front Squat', group: 'Legs' },
  { name: 'Romanian Deadlift', group: 'Hamstrings' }, { name: 'Deadlift', group: 'Back' },
  { name: 'Hip Thrust', group: 'Glutes' }, { name: 'Walking Lunge', group: 'Legs' },
  { name: 'Bulgarian Split Squat', group: 'Legs' }, { name: 'Bench Press', group: 'Chest' },
  { name: 'Incline Dumbbell Press', group: 'Chest' }, { name: 'Push-up', group: 'Chest' },
  { name: 'Overhead Press', group: 'Shoulders' }, { name: 'Lateral Raise', group: 'Shoulders' },
  { name: 'Pull-up', group: 'Back' }, { name: 'Barbell Row', group: 'Back' },
  { name: 'Lat Pulldown', group: 'Back' }, { name: 'Plank', group: 'Core' },
];

/** How many names the picker draws before somebody has typed.
 *
 *  A coach with eighty clients gets eighty pills between the title and the
 *  first exercise, and scrolls past their whole book to reach the thing they
 *  came here to do. Twelve is a screenful; the line under them says how many
 *  there are and that typing finds the rest, so the short list is never
 *  mistaken for the whole one. */
const PICKER_SHOWN = 12;

interface Row { key: string; name: string; sets: { reps: string; kg: string }[] }

let SEQ = 0;
const mkKey = () => `ex-${SEQ++}`;

export default function LogSession() {
  const t = useTheme();
  const router = useRouter();
  // The unit the COACH reads in. The field was hardcoded "kg", so a coach
  // thinking in pounds typed 135 and wrote 135 kg into a client's history.
  const wu: WeightUnit = useSettings().weightUnit;
  const auth = useAuth();
  // What this phone is still carrying. Read once per account and flushed on
  // mount, so a session typed in a basement yesterday goes up as soon as this
  // screen is opened anywhere with signal.
  const queue = useFloorQueue(auth.user?.id ?? null);
  // Pulled out because the hook hands back a fresh object each render while
  // the callback inside it is stable.
  const flushQueue = queue.flush;
  // Send what this phone is still carrying, now. The queue is emptied on the
  // app's own reconnect and foreground triggers too, through the registry in
  // src/lib/offlineQueue.ts; this is the button beside the banner that used to
  // say something was waiting and offer nothing to do about it. Every arm of
  // the result is reported: a refused write has been dropped rather than kept.
  const [sending, setSending] = useState(false);
  const sendWaiting = async () => {
    if (sending) return;
    setSending(true);
    try {
      const line = flushResultLine(await queue.flush());
      if (line) Alert.alert('Sending finished', line);
    } finally { setSending(false); }
  };
  const { clientId, name, sessionId: sessionParam, sessionAt } =
    useLocalSearchParams<{ clientId?: string; name?: string; sessionId?: string; sessionAt?: string }>();
  /**
   * The session being finished, or null for the ordinary write-up.
   *
   * Requires the client id as well, and that is not belt-and-braces. Part 890's
   * guard refuses a `session_id` whose session is not FOR the person whose
   * workout it is, so a session arriving without the client it belongs to is a
   * link this screen cannot make safely — and an insert refused for it takes
   * the whole hour of typing down with it. Dropped to a plain log rather than
   * risked; the coach can still mark the outcome from Mark Sessions.
   */
  const sessionId = sessionParam && clientId ? sessionParam : null;
  const coachEx = useCoachExercises();
  const r = useRoster();
  // A gym's fee where there is a gym, and otherwise the coach's own — the same
  // fallback app/(trainer)/sessions.tsx makes. Read unconditionally: hooks
  // cannot be called behind a condition, and with no session in hand nothing
  // below uses it.
  const { tenant } = useTenant();
  const { sessionFee: ownFee } = useMyTrainerProfile();
  /* ── the currency, which for a coach with no gym is not the gym's ────────
   *
   * The fee already fell back to the coach's own rate; the conversion did not.
   * It read `tenant?.currency`, null for a coach with no gym, so an
   * independent coach's finished sessions were filed with no rate at all.
   * `fetchMyCurrency` answers it under the one precedence rule in
   * src/lib/currencySource.ts — the gym is the authority, `trainers.currency`
   * applies if and only if there is no gym — and src/lib/rateSnapshot.ts is
   * where this screen, the marking queue and the schedule agree on the answer.
   *
   * Skipped where the tenant provider already holds a gym currency: that IS
   * the authoritative answer, and it is also the copy that survives having no
   * signal, which on this screen is the normal case.
   */
  const gymCcy = (tenant?.currency || '').trim() || null;
  const [myCcy, setMyCcy] = useState<MyCurrency | null>(null);
  useEffect(() => {
    let live = true;
    if (gymCcy) { setMyCcy(null); return; }
    void (async () => { const c = await fetchMyCurrency(); if (live) setMyCcy(c); })();
    return () => { live = false; };
  }, [gymCcy]);

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * Two reads behind the form: the book this session is logged against, and
   * the coach's own saved exercise names — the latter written from other
   * screens and from other devices, so a movement saved on an iPad is not
   * here until somebody asks.
   *
   * The queue is flushed with them, for the same reason it is on the class
   * register: a session typed in a basement is sitting on this handset, and
   * the gesture somebody reaches for when they want the screen to be right
   * should not leave it there. Repeating it is safe — an empty queue sends
   * nothing.
   *
   * What is typed into the form is untouched. Nothing here writes to the
   * draft, and a refresh that cleared a half-logged session would be the
   * worst thing this screen could do. */
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([r.refresh(), Promise.resolve(coachEx.reload()), flushQueue()]),
    [r, coachEx, flushQueue],
  ));

  // Seeded from the route, so the way in from a client's own screen is exactly
  // what it was: their name in the title and nothing to choose. `null` is the
  // state this screen could not previously get out of.
  const [picked, setPicked] = useState<string | null>(clientId ?? null);
  const [clientQ, setClientQ] = useState('');

  /* ── when it happened ──────────────────────────────────────────────────
   *
   * The day and the hour, both defaulted to now, so a coach typing up a session
   * they have just finished touches neither. What it ends is the ordinary case
   * that used to be silently wrong: a coach with back-to-back clients writes
   * the lot up at the end of the day, or the next morning, and every one of
   * them landed on the day they were typed. See src/lib/sessionWhen.ts for what
   * the stamp is made of and why the day is the part that matters.
   */
  //
  // Opened FROM a session, both are seeded from that session's own start
  // instead of from now. A coach finishing the four o'clock at half past six
  // would otherwise file it at half past six — in the client's log, their
  // streak, their weekly report and plan-versus-actual — on the one path where
  // the app knows exactly when the hour was. An unreadable start falls back to
  // now rather than to nothing, and the day and hour stay editable either way.
  const seededStart = (() => {
    if (!sessionAt) return null;
    const d = new Date(sessionAt);
    return Number.isFinite(d.getTime()) ? d : null;
  })();
  const [logDay, setLogDay] = useState(() => isoDay(seededStart ?? new Date()));
  const [logHour, setLogHour] = useState(() => (seededStart ?? new Date()).getHours());
  /**
   * Whether Save also marks the session delivered. On by default, and off in
   * one tap.
   *
   * Default on because a coach who has just typed up an hour has told us the
   * hour happened; default off would leave the queue exactly as full as it is
   * today and the report unfixed. Off is for the coach who wants the record
   * without the outcome — a session that ran short, or one they want to speak
   * to the client about first. src/lib/sessionFinish.ts holds the argument.
   */
  const [markDelivered, setMarkDelivered] = useState(true);

  const [rows, setRows] = useState<Row[]>([]);
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const pickedRow = r.roster.find((c) => c.id === picked) ?? null;
  // The roster's name where the roster has one, and the param's where it does
  // not — which is every case where the read failed or the client was added by
  // hand on another device. Never the param's name for a DIFFERENT id: a coach
  // who arrived on Sarah's screen and then picked Priya must not read Sarah's
  // name over Priya's sets.
  const pickedName = pickedRow?.name ?? (picked && picked === clientId ? (name || null) : null);
  const first = (pickedName || 'your client').split(' ')[0];

  /* ── the picker ────────────────────────────────────────────────────────────
   *
   * One field over the coach's own book, shared with the roster search on the
   * Clients screen (src/lib/rosterSearch.ts) so typing three letters means the
   * same thing in both places.
   *
   * `shownClients` is what is drawn. The person already chosen is always in it,
   * whatever has been typed and whatever the read cut off — a selected chip
   * that scrolls out of existence is a screen that cannot tell the coach who
   * they are about to write to. */
  const matches = searchRoster(r.roster, clientQ);
  const capped = !clientQ.trim() && matches.length > PICKER_SHOWN;
  const shownClients = (() => {
    const base = capped ? matches.slice(0, PICKER_SHOWN) : matches;
    if (pickedRow && !base.some((c) => c.id === pickedRow.id)) return [pickedRow, ...base];
    return base;
  })();
  /** What the search searched. Only a whole read may say a name is not on the
   *  book — see src/lib/rosterSearch.ts. */
  const clientQLine = rosterSearchLine({
    status: r.status, query: clientQ, matched: matches.length, searched: r.roster.length,
  });
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 };
  const G = layout.gutter;

  const addExercise = (n: string) => {
    setRows((p) => [...p, { key: mkKey(), name: n, sets: [{ reps: '', kg: '' }] }]);
    setPicker(false);
    setCustom('');
  };
  const addSet = (key: string) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, sets: [...r.sets, { reps: '', kg: '' }] } : r)));
  const patchSet = (key: string, i: number, patch: Partial<{ reps: string; kg: string }>) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, sets: r.sets.map((s, x) => (x === i ? { ...s, ...patch } : s)) } : r)));
  const removeRow = (key: string) => setRows((p) => p.filter((r) => r.key !== key));

  // Only sets with a rep count are real. A blank row the coach tabbed past is
  // not a set of zero reps, and writing it as one would put a lie in the log.
  //
  // The same reasoning applies to the LOAD, and it had not been applied.
  // `parseFloat(s.kg) || 0` turned anything unreadable into zero — a letter O
  // typed for a nought, a comma decimal, a stray space — and zero here is not
  // an absence, it is a bodyweight set written into somebody ELSE's history.
  // It drags down their volume, their estimated 1RM and the next target built
  // from it, and the person it happened to has no way of knowing.
  //
  // readLift refuses instead of coercing, and converts from whatever unit the
  // coach reads in. `loadProblem` below surfaces the refusal rather than
  // letting a bad figure through quietly.
  const entriesToWrite = (at: string): WorkoutEntry[] => {
    return rows
      .map((r) => {
        const pairs = r.sets
          .filter((s) => (parseInt(s.reps, 10) || 0) > 0)
          .map((s) => {
            const load = readLift(s.kg, wu);
            // A refused load is not written as a number at all. `ready` below
            // withholds the save while any refusal stands, so this only ever
            // runs on figures that read.
            return [parseInt(s.reps, 10) || 0, load.ok && load.kg != null ? load.kg : 0] as [number, number];
          });
        return pairs.length ? { t: at, exercise: r.name, sets: pairs } : null;
      })
      .filter(Boolean) as WorkoutEntry[];
  };

  /** The first unreadable load on the sheet, addressed to the coach. Null when
   *  every figure reads — including the empty ones, which are bodyweight sets
   *  and always legitimate. */
  const loadProblem = (): string | null => {
    for (const r of rows) {
      for (const st of r.sets) {
        if ((parseInt(st.reps, 10) || 0) <= 0) continue;
        const load = readLift(st.kg, wu);
        if (!load.ok) return `${r.name}: ${load.reason}`;
      }
    }
    return null;
  };

  /** Whether there is anything worth writing. The same rule `entriesToWrite`
   *  applies — only a set with a rep count is a set — asked without needing a
   *  timestamp, so the button can be held before one has been settled on. */
  const hasSets = rows.some((r) => r.sets.some((st) => (parseInt(st.reps, 10) || 0) > 0));

  /** Why the day and hour on the picker cannot be used, or null. A session
   *  dated into the future counts towards a streak nobody has earned, and the
   *  client cannot correct it because they did not type it. */
  const whenProblem = logStampProblem(logDay, logHour, new Date());

  // Withheld while any load is unreadable. Saving a session with one bad
  // figure silently zeroed is the failure above; refusing the save is the
  // only honest alternative, because this is a write to a client's record
  // with no undo and no notification to them.
  //
  // And withheld while nobody is chosen, which is the change this screen was
  // listed for. The check existed — at save, after the hour was typed. Held
  // here it costs a coach one tap at the top of the screen instead of the whole
  // session.
  const ready = picked != null && hasSets && loadProblem() == null && whenProblem == null;

  const save = async () => {
    // The instant the session is filed under, settled ONCE and reused for every
    // entry. Once, and not per call, because it is also what identifies this
    // log to the offline queue — see `supersedeKey` in src/lib/floorQueue.ts.
    const at = logStamp(logDay, logHour, new Date());
    if (!at || whenProblem) {
      setFailure(whenProblem ?? 'That day could not be read, so there is nothing to file this session under.');
      return;
    }
    const entries = entriesToWrite(at);
    if (!entries.length) {
      Alert.alert('Nothing to log', 'Add at least one set with a rep count.');
      return;
    }
    if (!picked) {
      // Reachable only if the button is pressed while nothing is chosen, which
      // `ready` already prevents. Kept as the second half of the belt: this is
      // a write into somebody's history and there is no undo on the other side.
      setFailure('Nobody is chosen yet, so there is nobody to log this against. Pick a client at the top of this screen.');
      return;
    }
    const coachId = auth.user?.id;
    if (!coachId) {
      // A session still being restored is not a signed-out coach, and telling
      // somebody they are signed out sends them to sign in again and lose the
      // sets they have just typed. `auth.loading` is the difference between the
      // two, and this screen used to fold them into one sentence.
      setFailure(auth.loading
        ? 'Still checking your sign-in — nothing has been saved yet. Try again in a moment.'
        : 'You are not signed in, so this cannot reach your client.');
      return;
    }
    setBusy(true);
    setFailure(null);

    /* ── ONE round trip, through the queue ─────────────────────────────────
     *
     * This used to write with `logForClient` and then, on any failure, re-issue
     * the identical insert through `queue.attempt`. Two sends for one press of
     * Save, and the second one is the bug: an insert whose ACKNOWLEDGEMENT was
     * lost has already landed, and re-issuing it puts the same hour of somebody
     * else's training in their history twice. Worse, `logForClient` reports a
     * PARTIAL insert as a failure — some rows in, some not — and the retry
     * duplicated exactly the rows that had made it. Neither the client nor the
     * coach can tell which of the two copies to delete, and the client cannot
     * delete either: their coach typed them.
     *
     * So the queue is the only sender. It classifies the answer itself — the
     * server took it, the server refused it, or nobody answered — and keeps
     * only the third, which is the one worth keeping. A queued write is never
     * reported as saved; see rule 1 in src/lib/floorQueue.ts.
     */
    const out = await queue.attempt({
      kind: 'session-log', clientId: picked, clientName: pickedName, entries, sessionId,
    });

    /* ── and then the session, which is a SECOND write with its own answer ──
     *
     * In this order on purpose. The entries are twenty minutes of typing that
     * exists nowhere else; the outcome is one tap that can be made again from
     * the Mark Sessions queue. So the log goes first, and a log the SERVER
     * REFUSED stops the outcome dead — supabase/parts/370 spends a client's
     * session credit at delivery, and spending it for an hour whose record was
     * refused is the one ending nobody would ever find.
     *
     * A log the server never ANSWERED does not stop it. That is not the same
     * event: the entries are on this phone and going up, the coach is standing
     * in the same basement for both writes, and refusing to record the outcome
     * because of the weather would put the session back in the queue for a
     * reason that has nothing to do with the session. It is offered, it comes
     * back queued too, and `finishReport` says so in as many words.
     */
    let outcomeAnswer: OutcomeAnswer = 'not-asked';
    if (sessionId && markDelivered) {
      if (out === 'refused') {
        outcomeAnswer = 'not-attempted';
      } else {
        // Snapshotted here and carried into the queue rather than recomputed at
        // flush time, exactly as the marking screen does it: a session finished
        // on Tuesday and sent on Thursday is worth what it was worth on
        // Tuesday. A snapshot already written is a historical fact and nothing
        // here rewrites or backfills one — this decides only what is filed from
        // now on. Converted by whatever currency actually resolves, never by a
        // factor of a hundred. Null converts to undefined, which is "do not
        // touch the rate" — a coach with no fee or no currency recorded must
        // not have a zero written into the column payroll is settled from.
        const rateCents = rateCentsToSnapshot({
          gymFee: tenant?.sessionFee, ownFee, gymCurrency: tenant?.currency, mine: myCcy,
        }) ?? undefined;
        outcomeAnswer = await queue.attempt({
          kind: 'session-outcome', sessionId, clientName: pickedName,
          outcome: 'completed', rateCents,
        });
      }
    }

    setBusy(false);

    // Nothing below is computed from what was SENT. Both writes returned their
    // own answer and `finishReport` turns the pair into sentences that say
    // different things — entries in with the outcome refused is a session that
    // looks unrun, and an outcome in with the entries lost is worse.
    if (sessionId) {
      const notMineHere = picked && !pickedRow && r.status === 'ready';
      const rep = finishReport({
        entries: out, outcome: outcomeAnswer, entryCount: entries.length, first,
        refusalCause: notMineHere
          ? `${pickedName || 'That person'} is not on your roster, and a session can only be logged for somebody on your book. Add them as a client first, then log this again.`
          : null,
      });
      if (rep.logged) notifySuccess();
      // A refused log keeps the sets on screen: nothing else in this app is
      // holding them, and the banner repeats the reason above the button.
      if (!rep.mayLeave) {
        setFailure(rep.lines.join('\n\n'));
        Alert.alert(rep.title, rep.lines.join('\n\n'));
        return;
      }
      Alert.alert(rep.title, rep.lines.join('\n\n'), [{ text: 'Done', onPress: () => router.back() }]);
      return;
    }

    if (out === 'stored') {
      notifySuccess();
      Alert.alert(
        'Session logged',
        `${entries.length} exercise${entries.length === 1 ? '' : 's'} added to ${first}'s record. They will see it on their own phone, marked as logged by you, and it counts towards their progress.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
      return;
    }
    if (out === 'refused') {
      // The server read it and declined, so it is NOT waiting to send and the
      // same bytes offered again would be declined again. The reason is not
      // re-fetched by writing a second time: that is the retry this whole
      // change exists to remove, and a refusal that was really a partial insert
      // would duplicate the half that landed. The one cause a coach can act on
      // is named instead, and the screen already says so above the button when
      // it can see it.
      //
      // The roster refusal is the one cause a coach can act on, and this screen
      // can tell when it is certainly that: a whole read of the book that does
      // not contain the person chosen. `logForClient` used to name it from the
      // 42501 the server sent back, which cost a second write to find out.
      const notMine = picked && !pickedRow && r.status === 'ready';
      setFailure(refusedLine(
        'This session',
        notMine
          ? `${pickedName || 'That person'} is not on your roster, and a session can only be logged for somebody on your book. Add them as a client first, then log this again.`
          : 'The usual cause is that the person is not on your roster — a session can only be logged for somebody on your book. If they are on it, open their record before typing this in again: part of it may have reached them.',
      ));
      return;
    }
    // Kept. Said as a sentence and not as a success: the client cannot see this
    // yet and neither can anybody else.
    Alert.alert('Kept on this phone',
      keptOfflineLine('This session'),
      [{ text: 'Done', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* ── the keyboard was sitting on the field you were typing into ────
            `KeyboardAvoidingView` with behavior="padding" pads the BOTTOM of
            its own container — and this ScrollView already fills that
            container, so there was nothing for the padding to push and the
            focused row never scrolled clear. A coach entering reps and weight
            typed into a field they could not see, on the screen where the
            whole point is checking the number.

            `automaticallyAdjustKeyboardInsets` is what the coach dashboard
            uses and what actually works here: iOS adds the keyboard height to
            the scroll insets and brings the focused input above it. The
            bottom padding goes up with it, so the LAST exercise's sets can
            still scroll above the keyboard rather than stopping under it —
            40pt was enough when nothing was ever hidden and is not now. */}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 260 }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          refreshControl={pull}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg }}>
            <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={BACK_ICON} size={18} color={t.ink} />
            </Pressable>
            <View>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Log a session</Text>
              {/* The person's name once there is one, and an honest heading
                  before that. It used to read "Client" over a screen that had
                  nobody and could not be given anybody. */}
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>{pickedName || 'Log a Session'}</Text>
            </View>
          </View>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
            {picked
              ? `Goes into ${first}’s own record, marked as logged by you.`
              : 'Pick who this was with, then add what they did. It goes into their own record, marked as logged by you.'}
          </Text>

          <Rule />

          {failure ? (
            <View style={{ marginBottom: sp.lg }}>
              <Flag tone={t.crit}>{failure}</Flag>
            </View>
          ) : null}

          {/* What this phone is still carrying, and the one thing that is not
              a count of it. A queue that could not be READ is not an empty
              queue — src/lib/floorQueue.ts, rule 2 — so "nothing waiting" is
              withheld rather than stated, and nothing is written to the device
              until a launch that can read it. */}
          {!queue.queueRead ? (
            <View style={{ marginBottom: sp.lg }}>
              <Flag tone={t.warn}>
                What this phone is still carrying could not be read, so whether anything is waiting to go up is not known. Nothing has been lost — it is not being written over either.
              </Flag>
            </View>
          ) : floorPendingNote(queue.unsent) ? (
            <View style={{ marginBottom: sp.lg }}>
              <Flag tone={t.warn}>{floorPendingNote(queue.unsent)}</Flag>
              <View style={{ alignItems: 'flex-start', paddingTop: sp.sm }}>
                <Ghost label="Send Now" a11yLabel="Send what is waiting on this phone"
                  onPress={() => { void sendWaiting(); }} />
              </View>
            </View>
          ) : null}

          {/* ── who this was with ──────────────────────────────────────────
              First on the screen, because it is the first thing the coach has
              to be right about and the one thing that used to be unanswerable
              here. Under a failed read the chips are not the book — that is
              said rather than left to be inferred from an empty row of pills. */}
          {/* ── who this was with ──────────────────────────────────────────
              With a session in hand it is STATED, not chosen. supabase/parts/890
              requires the session to be for the person whose training this is,
              so a picker here would offer the coach a choice whose only effect
              is a refused insert. The way to log against somebody else is to go
              back and open their record. */}
          {sessionId ? (
            <Section>
              <SectionHead title="This Session" />
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
                {pickedName || 'Your client'}
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {seededStart
                  ? `Booked for ${seededStart.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`
                  : 'You came here from this session, so what you type is filed against it.'}
              </Text>
              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
                What you type below is filed against this session, so it can be read back from it later.
                To log an hour for somebody else, go back and open their record.
              </Text>
            </Section>
          ) : (
          <Section>
            <SectionHead title="Client" note={picked ? undefined : 'Pick one'} />

            {r.status === 'error' ? (
              <View style={{ marginBottom: sp.md }}>
                <Flag tone={t.warn}>
                  Your clients could not be read, so this is not an empty book — nobody is listed
                  because the list did not come back. {picked
                    ? 'The person you came here for is still selected and can still be logged against.'
                    : 'Open this from a client’s own screen, or try again once you are connected.'}
                </Flag>
              </View>
            ) : null}

            {/* The field is offered whenever there is anything to search. It is
                the same matcher the Clients screen uses, so three letters mean
                the same thing in both places. */}
            {r.roster.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, marginBottom: sp.md }}>
                <Icon name="search" size={16} color={t.ink3} />
                <TextInput value={clientQ} onChangeText={setClientQ}
                  placeholder="Find a client by name" placeholderTextColor={t.ink3}
                  autoCapitalize="none" autoCorrect={false} accessibilityLabel="Find a client by name"
                  style={{ flex: 1, ...ty.body, color: t.ink, paddingVertical: sp.md }} />
                {clientQ ? (
                  <Pressable onPress={() => setClientQ('')} hitSlop={hitSlopFor(24)}
                    accessibilityRole="button" accessibilityLabel="Clear the client search">
                    <Text style={{ ...ty.head, color: t.ink3 }}>&times;</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {r.roster.length === 0 && r.status !== 'error' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                {r.status === 'loading'
                  ? 'Reading your clients…'
                  : 'Nobody is on your book yet. Add or invite a client from the Clients screen and they can be logged against here.'}
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {shownClients.map((c) => {
                  const on = picked === c.id;
                  return (
                    <Pressable key={c.id} onPress={() => setPicked(on ? null : c.id)}
                      accessibilityRole="button" accessibilityState={{ selected: on }}
                      accessibilityLabel={on ? `${c.name}, chosen` : `Log this session against ${c.name}`}
                      hitSlop={{ top: hitSlopFor(34), bottom: hitSlopFor(34), left: 0, right: 0 }}
                      style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                      <Text style={{ ...ty.label, fontWeight: '500', color: on ? t.brandInk : t.ink2 }}>{c.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Two different things the coach is owed, and neither may be
                skipped. `clientQLine` is what the search searched — and the only
                sentence allowed to say a name is not on the book, and only under
                a whole read. The second says the pills are a screenful of a
                longer list, so a short row is never read as a short book. */}
            {clientQLine ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{clientQLine}</Text>
            ) : capped ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                {`Showing ${shownClients.length} of your ${r.roster.length} clients — type a name to find the rest.`}
              </Text>
            ) : null}

            {/* A client seeded from a route the roster does not confirm. Said
                out loud rather than left as a name in the title: under a whole
                read they are not on this coach's book, and `logForClient` will
                refuse the write for exactly that reason. */}
            {picked && !pickedRow && r.status === 'ready' ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
                {pickedName || 'This client'} is not on your roster, so a session logged against them will be refused. Pick somebody from your book instead.
              </Text>
            ) : null}
          </Section>
          )}

          {/* ── when it happened ──────────────────────────────────────────
              Second, after who and before what: a coach writing up yesterday's
              work needs to change this once and then not think about it. It
              used to not exist at all — the record said the session happened
              at the moment Save was pressed. */}
          <Section>
            <SectionHead title="When" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -2 }} contentContainerStyle={{ gap: sp.sm, paddingHorizontal: 2 }}>
              {logDayOptions(new Date()).map((d) => {
                const on = d.day === logDay;
                return (
                  <Pressable key={d.day} onPress={() => setLogDay(d.day)}
                    accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={on ? `${d.label}, chosen` : `File this session under ${d.label}`}
                    hitSlop={{ top: hitSlopFor(34), bottom: hitSlopFor(34), left: 0, right: 0 }}
                    style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: on ? t.brandInk : t.ink2 }}>{d.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* The hour, on a stepper rather than a row of twenty-four chips.
                The minute is not asked for and is written as zero — an hour is
                what a coach remembers about a session they ran yesterday, and a
                minute they had to invent would be invented detail in somebody
                else's record. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.md }}>
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>Start hour</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderRadius: radius.sm }}>
                <Pressable onPress={() => setLogHour((h) => (h + 23) % 24)} hitSlop={8}
                  accessibilityRole="button" accessibilityLabel="An hour earlier"
                  style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Icon name="minus" size={15} color={t.ink2} />
                </Pressable>
                <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, minWidth: 64, textAlign: 'center' }}>
                  {hourLabel(logHour)}
                </Text>
                <Pressable onPress={() => setLogHour((h) => (h + 1) % 24)} hitSlop={8}
                  accessibilityRole="button" accessibilityLabel="An hour later"
                  style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Icon name="plus" size={15} color={t.ink2} />
                </Pressable>
              </View>
            </View>

            {/* Where this lands and what turns on it, or why it cannot land
                there. Never both. */}
            {whenProblem ? (
              <View style={{ marginTop: sp.md }}>
                <Flag tone={t.warn}>{whenProblem}</Flag>
              </View>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
                {logWhenLine(logDay, logHour, new Date(), first)}
              </Text>
            )}
          </Section>

          <Section>
            <SectionHead title="Exercises" note={rows.length ? `${rows.length}` : undefined} />
            {rows.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Nothing added yet. Add what {first} actually did — only sets with a rep count are saved.
              </Text>
            ) : null}

            {rows.map((r) => (
              <View key={r.key} style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, flex: 1 }}>{r.name}</Text>
                  <Pressable onPress={() => removeRow(r.key)} hitSlop={8} accessibilityRole="button"
                    accessibilityLabel={`Remove ${r.name}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                    <Text style={{ ...ty.caption, color: t.ink2 }}>Remove</Text>
                  </Pressable>
                </View>

                {/* Column headers rather than placeholders. Every set after the
                    first is seeded from the one above it, so from set two on
                    the two words that said which column was reps and which was
                    load were never on screen — and the load column's unit is
                    the coach's own kg/lb setting, not a constant. */}
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center' }}>
                  <View style={{ width: 46 }} />
                  <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>Reps</Text>
                  <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>{wu.toUpperCase()}</Text>
                </View>
                {r.sets.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center' }}>
                    <Text style={{ ...ty.caption, color: t.ink3, width: 46 }}>Set {i + 1}</Text>
                    <TextInput value={s.reps} onChangeText={(v) => patchSet(r.key, i, { reps: v })}
                      keyboardType="numeric"
                      accessibilityLabel={`${r.name} set ${i + 1} reps`} style={[inp, { flex: 1 }]} />
                    <TextInput value={s.kg} onChangeText={(v) => patchSet(r.key, i, { kg: v })}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`${r.name} set ${i + 1} weight in ${wu === 'kg' ? 'kilograms' : 'pounds'}`} style={[inp, { flex: 1 }]} />
                  </View>
                ))}
                <Pressable onPress={() => addSet(r.key)} hitSlop={8} accessibilityRole="button"
                  style={{ paddingVertical: sp.sm, marginTop: 2 }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Add a set</Text>
                </Pressable>
              </View>
            ))}

            <View style={{ marginTop: sp.md }}>
              <Ghost label="Add Exercise" onPress={() => setPicker(true)} />
            </View>
          </Section>

          {/* ── finishing it ──────────────────────────────────────────────
              The one control on this screen that moves somebody else's money.
              Marking a session delivered draws a credit off the client's pack
              or gym pass (supabase/parts/370), so it is a switch that says what
              it does with the consequence written under it — never a silent
              side effect of a button labelled Save. The argument for doing it
              on the same press at all is in src/lib/sessionFinish.ts. */}
          {sessionId ? (
            <Section>
              <SectionHead title="Finish" />
              <Pressable onPress={() => setMarkDelivered((v) => !v)}
                accessibilityRole="switch" accessibilityState={{ checked: markDelivered }}
                accessibilityLabel="Mark this session as delivered when you save"
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, color: t.ink }}>Mark it delivered</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                    {markDelivered ? DELIVERED_MEANS : NOT_DELIVERED_MEANS}
                  </Text>
                </View>
                <View style={{ width: 46, height: 27, borderRadius: radius.pill, backgroundColor: markDelivered ? t.brand : t.surface3, borderWidth: hairline, borderColor: markDelivered ? t.brand : t.ring, justifyContent: 'center', paddingHorizontal: 3 }}>
                  <View style={{ width: 21, height: 21, borderRadius: radius.pill, backgroundColor: markDelivered ? t.brandInk : t.ink3, alignSelf: markDelivered ? 'flex-end' : 'flex-start' }} />
                </View>
              </Pressable>
            </Section>
          ) : null}

          <View style={{ marginTop: sp.xl }}>
            <View style={{ opacity: ready && !busy ? 1 : 0.4 }} pointerEvents={ready && !busy ? 'auto' : 'none'}>
              {/* The label says what the press does. With no session in hand it
                  is the sentence this screen has always shown. */}
              <Cta wide
                label={busy
                  ? 'Saving…'
                  : sessionId ? finishCta(markDelivered, true) : `Log to ${first}'s record`}
                onPress={save} />
            </View>
            {/* Two different reasons the button is held, and they need
                different sentences. "Add a set" to somebody who added four and
                typed one load wrong sends them looking for the wrong thing. */}
            {!ready ? (
              // Centred under the held button, so the tone goes into a dot in
              // the same row rather than into the ink — warn as caption text is
              // 3.87–4.08:1 on the light palettes, and this is the sentence
              // that explains why the button will not move.
              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: sp.sm }}>
                {loadProblem() || whenProblem ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} /> : null}
                <Text style={{ ...ty.caption, color: loadProblem() || whenProblem ? t.ink2 : t.ink3, textAlign: 'center' }}>
                  {/* The client comes first of the three, because it is the one
                      that used to be reported at save — and a coach told to add
                      a set, who adds one and is then told about the client, has
                      been sent looking twice. */}
                  {!picked
                    ? 'Pick who this session was with, at the top of this screen.'
                    : whenProblem ?? loadProblem() ?? 'Add at least one set with a rep count.'}
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPicker(false)} />
          <View style={[sheet, { maxHeight: '82%' }]}>
            <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Add Exercise</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.lg }}>
              <TextInput value={custom} onChangeText={setCustom} placeholder="Custom exercise name"
                placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} accessibilityLabel="Custom exercise name" />
              <Cta label="Add" onPress={() => {
                const nm = custom.trim();
                if (!nm) return;
                addExercise(nm);
                // Remembered for next time, exactly as the program builder does.
                void coachEx.remember(nm);
              }} />
            </View>
            {coachEx.status === 'error' ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
                Your saved exercises could not be read, so only the built-in ones are listed. That is not
                the same as having none saved.
              </Text>
            ) : coachEx.status === 'partial' ? (
              // 'partial' arrived with the row-cap work and this branch did not
              // exist for it, so a coach whose saved list came back short saw a
              // picker missing names with nothing to say why — and retyped one
              // they had already saved.
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
                Your saved exercises came back short — there are more of them than are listed here.
              </Text>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {mergeExerciseLists(coachEx.saved, LIB).map((x, i) => (
                <Pressable key={x.name} onPress={() => addExercise(x.name)}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{x.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{x.group}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
