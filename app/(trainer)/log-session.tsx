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
// Three things this screen refuses to do:
//
//   · say "logged" when it is not. The write goes through the floor queue,
//     which reports the three answers apart — the server took it, the server
//     refused it, or nobody answered — and a queued write is never reported as
//     saved. See rule 1 in src/lib/floorQueue.ts.
//   · invent a calorie figure. Strength work records reps and weight, not
//     energy, and the client's own screens render an absent burn as a dash.
//     Guessing here would put a fabricated number into somebody else's history.
//   · turn a PRESCRIPTION into a performed figure. Since the sheet can be
//     filled from the client's own program (below), every rep target the
//     coach wrote passes through this screen — and `parseInt('30s')` is 30,
//     which is a thirty-second plank hold written into somebody's permanent
//     record as thirty repetitions. Nothing here parses a target. A row loaded
//     from '6-8', 'AMRAP' or '30s' shows those words and leaves the box empty.
//     src/lib/planPrefill.ts holds the rule and the reasoning.
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
// ── The session the coach already wrote ───────────────────────────────────
//
// "After a coach builds a client a workout template, the coach should be able
// to tap on the client's name and have an option to log the session by using
// the workout template they have built for the client."
//
// The tap and the option already existed — app/(trainer)/client.tsx pushes
// here with the client. What this screen then offered was `LIB`, sixteen
// generic movement names, the same list for everybody on the book. A coach who
// had spent twenty minutes writing somebody a push day retyped it standing next
// to them.
//
// So the sheet can now be FILLED from the program this coach assigned this
// client, for the day being logged. The picker offers the whole week rather
// than only the day the date falls on, because a coach writing up an hour
// afterwards is routinely writing up the Friday session they ran on a
// Wednesday. What comes across is the movement list, the set count and the
// coach's own target as a caption; what does not is a rep number the plan never
// stated — see the third refusal above, and src/lib/planPrefill.ts for the
// whole argument.
//
// Nothing about the WRITE changed. `entriesToWrite` still only writes sets with
// a rep count in the box, so a loaded row whose reps are blank writes nothing
// at all, and the targets are captions that never leave the screen. A prefilled
// figure is a suggestion sitting in an editable box above a button the coach
// has to press.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { liftIn, plain, readLift, type WeightUnit } from '../../src/lib/units';
import { useSettings } from '../../src/ui/settings';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, PageHead, Cta, Ghost, Flag, KpiRow, fig } from '../../src/ui/kit';
import { Icon } from '../../src/ui/Icon';
import { sp, layout, radius, hairline, elevation, numeric, type as ty, font } from '../../src/theme/scale';
import { useAuth } from '../../src/ui/auth';
import { useRoster } from '../../src/ui/roster';
import { searchRoster, rosterSearchLine, rosterPickerLine } from '../../src/lib/rosterSearch';
import { hitSlopFor } from '../../src/lib/a11y';
import { useCoachExercises, mergeExerciseLists } from '../../src/ui/coachExercises';
import { useFloorQueue } from '../../src/ui/floorQueue';
import {
  floorFullLine, floorPendingNote, flushResultLine, keptOfflineLine, refusedLine,
} from '../../src/lib/floorQueue';
// When the session happened, which this screen never asked. See the module
// header: `new Date().toISOString()` at the moment Save was pressed put a
// Monday evening session on the Tuesday it was written up.
import {
  hourLabel, logDayOptions, logStamp, logStampProblem, logWhenLine,
} from '../../src/lib/sessionWhen';
import { isoDay } from '../../src/lib/weekStart';
// What day it is, kept true for as long as this screen is open. This screen is
// registered `href: null` in app/(trainer)/_layout.tsx, so it mounts once and is
// never torn down — see the block above `logDay` for what that cost.
import { useNow } from '../../src/ui/today';
// Whose record this screen is showing. This file is the eighth and last user of
// it, and the only one that WRITES — src/lib/routeSubject.ts quotes the exact
// line that was here and sets out why a `useState` initialiser is the wrong
// place to read a route param on a screen that never unmounts.
import { subjectOf, subjectChange, type RouteParam } from '../../src/lib/routeSubject';
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
// The program this coach assigned this client, and the rules for putting it
// on the sheet. The provider is the one every other coach screen reads, so the
// block shown here is the block shown on their record; the module beside it
// owns the one thing that must not be got wrong, which is that a target is not
// a performed set.
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { planOffer, prefillDay, prefillLine, targetLine } from '../../src/lib/planPrefill';
import { notifySuccess, tapLight } from '../../src/ui/haptics';
// The two clocks a coach on the floor asked for — "No timer when logging". The
// rest arithmetic, the digits and the three-two-one rule are the member
// runner's own (src/lib/restTimer.ts), and the noise goes through the one door
// that asks the sound switch first (src/ui/sounds.ts). Nothing about either is
// re-derived here: a coach and the client beside them must hear the same cue at
// the same instant for the same rest.
import { restSecondsFor, restClock, shouldTick, DEFAULT_REST_SEC } from '../../src/lib/restTimer';
import { playSound, primeSounds, releaseSounds } from '../../src/ui/sounds';
// A still for each movement on the sheet — "Pictures with the exercises on the
// coaching app". The same catalogue read, the same exact-slug match and the
// same one-request signing the program builder uses, so the picture beside a
// movement here is the picture beside it there.
import { useExerciseCatalogue } from '../../src/ui/exerciseDetail';
import { useCatalogueThumbs } from '../../src/ui/useCatalogueThumbs';
import { ExerciseThumb } from '../../src/ui/ExerciseDemo';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { canonicalExerciseName } from '../../src/lib/exerciseName';
// Ticking a set off standing next to the person doing it, and the one rule that
// makes a tick safe on a screen that writes to somebody else's permanent
// record: it may only put a figure in a box where the plan states a definite
// one. src/lib/sheetTick.ts holds the reasoning and the refusals.
import {
  sheetTick, sheetTickLabel, sheetTicksLine, willSave, isTappable,
} from '../../src/lib/sheetTick';
// This movement against the last time they did it. The trail is the one every
// other screen reads; what this adds is the other side of the comparison — the
// sets being typed, which are not in the log yet and cannot be.
import { exerciseOutings, type ExerciseOuting } from '../../src/lib/exerciseHistory';
import { previousSets, sheetTally } from '../../src/lib/sheetProgress';
import { liftLabel, volumeIn } from '../../src/lib/units';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
// `capped` is aliased: this file already has a local `capped` for the roster
// picker's own truncation flag, and two different meanings under one name in
// one component is a bug waiting for whoever reads it next.
import { capLimit, capped as cappedRows } from '../../src/lib/rowCap';
// Whether this session may be sent at all, and the one part of that which a
// press beating the button still has to get past. Both live in src/lib so that
// deleting either of the two guards below fails a test rather than a client's
// hour of training — see sessionSend.test.ts.
import { maySendSession, sessionClientBlocked } from '../../src/lib/sessionSend';
import { rowToEntry, WORKOUT_COLS, type WorkoutRow } from '../../src/lib/workoutRow';
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { dayLabel as historyDayLabel } from '../../src/lib/adherence';
import { num } from '../../src/lib/format';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { useMovementName } from '../../src/ui/catalogueTranslations';
import { useScrollPad } from '../../src/ui/keyboardPad';

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

/**
 * One movement on the sheet.
 *
 * `target` is the coach's OWN prescription for that set — '6-8', 'AMRAP',
 * '30s' — carried across when the row was loaded from the client's program,
 * and absent on a row the coach added by hand. It is a caption and nothing
 * else: it is never parsed, never written, and `entriesToWrite` does not know
 * it exists. What goes into the client's record is `reps` and `kg`, which are
 * what the coach typed or confirmed.
 *
 * `restSec` is the rest the coach's own program states for the movement, in
 * seconds, and null where it states none or the row was added by hand. It
 * feeds the rest countdown and nothing else; like `target` it is never written.
 *
 * ── `held`, which is a tick taken back off ────────────────────────────────
 *
 * "Can't untick a log if accidentally press." A tick here is drawn from the
 * reps box — a box with a count in it IS a set that will be saved — so on a row
 * whose figure the coach typed there was nothing for a second tap to do except
 * erase the figure, and src/lib/sheetTick.ts rightly refuses that: this screen
 * has no undo. So a filled tick on a typed row was a control that could not be
 * pressed, which on the floor reads as stuck.
 *
 * `held` is the second tap. The figures STAY in the boxes and the set is simply
 * not counted: not written by `entriesToWrite`, not in the totals, not drawn as
 * ticked. Tapping again counts it; so does typing a new rep count, because
 * typing reps is recording a set. The invariant the tick was built on is kept
 * whole — A FILLED TICK IS A SET THAT WILL BE SAVED — and nothing a person typed
 * is erased by a control they brushed with a thumb. `counts` below is the one
 * reader of it, and every total on this screen asks `counts`.
 */
interface SheetSet { reps: string; kg: string; target?: string | null; held?: boolean }
interface Row { key: string; name: string; restSec?: number | null; sets: SheetSet[] }

/** Whether this set, as the sheet stands, is one Save will write. The same
 *  `> 0` test on the coach's own rep box `entriesToWrite` has always applied —
 *  a blank or unreadable box is a row never filled in, not a set of no reps —
 *  with the one addition that a set the coach has unticked is not written. */
// zero-ok: the coach's own text box, and zero is the arm that SKIPS the set.
const counts = (st: SheetSet): boolean => !st.held && (parseInt(st.reps, 10) || 0) > 0;

/** A rest that is running: which set it followed, and the wall-clock instant it
 *  ends. An instant and not a count, for the runner's reason — iOS suspends the
 *  interval in a pocket, and only the wall clock is still right afterwards. */
interface RestRun { gen: number; endsAt: number; rowKey: string; setIdx: number; name: string; fromPlan: boolean }

let SEQ = 0;
const mkKey = () => `ex-${SEQ++}`;

export default function LogSession() {
  const t = useTheme();
  const scrollPad = useScrollPad(220);
  // `x.name` and `r.name` are what gets WRITTEN into the client's log, so they
  // stay the English identity — `addExercise(x.name)` below is untouched.
  // `movement()` is the same movement in the coach's own language, which is
  // what the picker and the rows they are typing into should say.
  const { textOf: movement } = useMovementName();
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
      if (line) Alert.alert('Sending Finished', line);
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
   *
   * Both halves go through `subjectOf` for the reason src/lib/routeSubject.ts
   * gives: `useLocalSearchParams<{ sessionId?: string }>` is an assertion by the
   * caller and not a check, and expo-router hands back `string[]` for a repeated
   * key on a deep link. A `string[]` reaching `session_id` is a column written
   * from an array — and the client id it is checked against is now read the same
   * way, so the two halves of this screen cannot disagree about which route they
   * are looking at.
   */
  const sessionId = subjectOf(clientId) ? subjectOf(sessionParam) : null;
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
  //
  // Seeded ONCE, though, and this screen never unmounts — it is registered
  // `href: null` inside <Tabs> (app/(trainer)/_layout.tsx), so a `useState`
  // initialiser runs for the FIRST client a coach opens it for and for nobody
  // after. Opening it for Ben used to draw Amy. `subjectChange` is the rule,
  // with the reasoning and the string[] hazard in src/lib/routeSubject.ts; it is
  // applied during render rather than in an effect so the wrong person is never
  // painted, not even for one frame.
  //
  // This is the eighth screen to take it and the only one where the stale
  // subject was a WRITE. The insert would have succeeded — Amy really is this
  // coach's client, so no policy refuses it — and what Ben got was nothing while
  // Amy got an hour of training on a day she did not train, typed by her coach
  // and therefore not hers to delete.
  const [picked, setPicked] = useState<string | null>(subjectOf(clientId));
  const [seenParam, setSeenParam] = useState<RouteParam>(clientId);
  const moved = subjectChange(seenParam, clientId);
  if (moved) { setSeenParam(clientId); setPicked(moved.subject); }
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
  /* ── the default is a derived value, not state ─────────────────────────
   *
   * Both of these were `useState(() => … new Date() …)`, and the only thing
   * that ever re-read the clock was the client-change block below. A `useState`
   * initialiser runs ONCE, at mount, and this screen is registered `href: null`
   * inside <Tabs> (app/(trainer)/_layout.tsx): it mounts the first time a coach
   * opens it and is never unmounted, not on `router.back()` and not on the app
   * being backgrounded. So a coach who opened Log Session on Sunday evening and
   * wrote a session up on Monday morning filed it under SUNDAY — and unlike a
   * stale label, `logStamp` WRITES that day, into the client's log, their
   * streak, their weekly report, plan-versus-actual and the fee that follows
   * the session.
   *
   * So the coach's CHOICE is the state, and the default is derived from a clock
   * that stays current. `useNow()` (src/ui/today.ts) re-renders this screen at
   * the next local midnight, on every foreground and on every focus, and it is
   * this tree's one clock subscription — there is no second ticker here.
   * `null` means "not chosen", which is also what makes the re-seed below a
   * single line rather than two clock reads that could disagree.
   *
   * The HOUR follows the same clock and not just the day, and that is not
   * tidiness: leave the hour frozen at mount and a coach who opened the screen
   * at 23:00 on Sunday and logged at 00:30 on Monday would be offered Monday at
   * 11 pm — an hour that has not happened, which `logStampProblem` refuses. A
   * day that moves under an hour that does not is a screen that cannot save.
   */
  const now = useNow();
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [chosenHour, setChosenHour] = useState<number | null>(null);
  const logDay = chosenDay ?? isoDay(seededStart ?? now);
  const logHour = chosenHour ?? (seededStart ?? now).getHours();
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
  /**
   * Which days of the client's program have already been put on this sheet.
   *
   * A coach who taps Load twice gets the same six movements twice, and the
   * second copy is indistinguishable from a genuine second time through the
   * session — which they would then Save. So a day already loaded says so and
   * offers nothing, rather than being silently ignored (a control that does
   * nothing reads as the app having failed) or quietly de-duplicating (which
   * would refuse a coach who really did run the day twice; they can still add
   * the movements by hand, which is deliberate work rather than a double tap).
   *
   * Keys, not day objects: it is compared against `PlanDayOption.key`, which is
   * the day's position in the week it came from.
   */
  const [loadedDays, setLoadedDays] = useState<string[]>([]);
  /**
   * The day of the program the coach has chosen, or null to follow the one
   * the date being logged actually schedules.
   *
   * Null rather than seeded, so that changing the day at the top of the screen
   * moves the offer with it. A coach who switches from Tuesday to Monday is
   * asking about Monday's session, and a pre-selected chip that stayed put
   * would answer yesterday's question.
   */
  const [pickedPlanDay, setPickedPlanDay] = useState<string | null>(null);
  /** What the last load put on the sheet, and what it left blank. Held rather
   *  than recomputed, because it is a statement about something that already
   *  happened — the coach has typed over half of it by now. */
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The same fact as `busy`, held where a second tap in the same frame can see
   * it.
   *
   * `busy` is React state. It is set inside `save`, which has already awaited
   * by the time the setter's re-render lands, so two taps a frame apart BOTH
   * read `busy === false` and both run — and the only thing between them was
   * `pointerEvents`, computed from that same state and therefore stale in
   * exactly the frame that matters.
   *
   * What the second run costs is written out at length inside `save` itself:
   * `queue.attempt` sends straight to the server when there is signal, with no
   * idempotency key anywhere on the path, so it is a second `workouts` insert
   * of the same entries — "the same hour of somebody else's training in their
   * history twice", which "the client cannot delete: their coach typed them".
   * The queue's `supersedeKey` does not help, because it collapses acts that
   * are WAITING on the phone and these two were both sent.
   *
   * A ref rather than a longer-lived lock: it is set and cleared in the same
   * function, and a tap that arrives while a save is genuinely in flight is
   * the only thing it refuses.
   */
  const saving = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  /* ── the two clocks ────────────────────────────────────────────────────────
   *
   * "No timer when logging." This screen was written as a WRITE-UP — the head
   * used to say, in so many words, that a stopwatch on it would be counting how
   * long the typing took — and the coach who filed that was standing next to a
   * client mid-set, using it as the session itself. Both are real. So:
   *
   *   · THE SESSION CLOCK is elapsed wall-clock time from an instant, and the
   *     instant is either an explicit Start or the first tick of a set. It has
   *     no pause: a PT hour does not pause, and a clock that could be paused is
   *     a clock somebody forgot to resume. It can be stopped, which also turns
   *     the rest bar off until Start is pressed again — that is the write-up
   *     coach's way out of a chime after every tick.
   *   · THE REST COUNTDOWN starts when a set becomes done: the tick tapped, or
   *     — while the clock is running — a rep count typed into an empty box and
   *     left. It counts the program's own rest for that movement where the
   *     program states one and `DEFAULT_REST_SEC` where it does not, and says
   *     which. The end cue is the member runner's, through the same two calls.
   *
   * Both are offered ONLY for a session filed under today. A session being
   * written up for yesterday is not happening now, and a rest timer chiming
   * over it would be the app timing the typing after all.
   *
   * NEITHER IS WRITTEN. `workouts` has no duration for strength work and this
   * screen invents no figure for somebody else's record; the clock is for the
   * two people on the floor and the line under it says so.
   *
   * The ticking itself lives in the two small components at the foot of this
   * file, so that a clock redraws a line of digits twice a second and not a
   * two-thousand-line form with a keyboard up.
   */
  const isLive = logDay === isoDay(now);
  const [clockFrom, setClockFrom] = useState<number | null>(null);
  const [timersOff, setTimersOff] = useState(false);
  const [rest, setRest] = useState<RestRun | null>(null);
  const restGen = useRef(0);
  // Whether the reps box in focus already counted when it was entered, so that
  // leaving it starts a rest only for a set that BECAME done in between — not
  // for every coach who taps into a finished row to read it.
  const repsFocus = useRef<{ at: string; counted: boolean } | null>(null);
  // The day was moved off today with the clocks running: they stop, for the
  // reason above. An effect and not a derived mask, so moving the day back does
  // not resurrect a clock that has silently been counting the whole time.
  useEffect(() => {
    if (!isLive) { setClockFrom(null); setRest(null); }
  }, [isLive]);
  // Players built when the clock starts and let go when it stops, as the runner
  // does on open and close: decoding a file at the instant a cue is due makes
  // the cue late. This screen never unmounts, so "stops" is the only release.
  const clockOn = clockFrom != null;
  useEffect(() => {
    if (!clockOn) return;
    primeSounds();
    return () => { releaseSounds(); };
  }, [clockOn]);
  const startClock = () => { setTimersOff(false); setClockFrom((v) => v ?? Date.now()); };
  const stopClocks = () => { setTimersOff(true); setClockFrom(null); setRest(null); };
  const startRest = (row: Row, i: number) => {
    if (!isLive || timersOff) return;
    // The first tick starts the session clock too — a coach who ticks the
    // opening set has started the hour whether or not they pressed Start.
    setClockFrom((v) => v ?? Date.now());
    restGen.current += 1;
    const secs = restSecondsFor({ restSec: row.restSec });
    setRest({
      gen: restGen.current, endsAt: Date.now() + secs * 1000,
      rowKey: row.key, setIdx: i, name: row.name, fromPlan: row.restSec != null,
    });
  };
  /** A set that stopped being done takes its own rest with it. Somebody else's
   *  rest is left alone: unticking set 1 while resting after set 3 says nothing
   *  about set 3. */
  const dropRestFor = (key: string, i: number) =>
    setRest((cur) => (cur && cur.rowKey === key && cur.setIdx === i ? null : cur));

  /* ── a picture for each movement on the sheet ──────────────────────────────
   *
   * Exact slug equality and nothing else, which is the builder's rule and the
   * builder's reason: similarity pairs Back Squat with Hack Squat, and a wrong
   * picture beside a movement being logged into somebody's record is worse
   * than none. A movement the catalogue does not hold — a coach's own name for
   * something — gets the empty tile, and so does every row while the catalogue
   * is loading or if it could not be read: a still is an illustration, and no
   * sentence on this screen is made from whether one arrived.
   */
  const cat = useExerciseCatalogue();
  const catByName = useMemo(() => {
    const m = new Map<string, typeof cat.rows[number]>();
    for (const c of cat.rows) m.set(exerciseSlug(c.name), c);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.rows]);
  const stillFor = (nm: string) => catByName.get(exerciseSlug(nm)) ?? null;
  // The sheet's rows and, while it is open, the Add Exercise list — one batch,
  // because they are signed in one request and two effects would be two waits.
  // The list is only asked for while the sheet is up: sixteen built-ins and a
  // coach's saved names are stills nobody is looking at otherwise.
  const thumbRows = useMemo(
    () => [...rows.map((row) => row.name), ...(picker ? mergeExerciseLists(coachEx.saved, LIB).map((x) => x.name) : [])]
      .map((nm) => catByName.get(exerciseSlug(nm)) ?? null)
      .filter((c): c is typeof cat.rows[number] => !!c),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, catByName, picker, coachEx.saved],
  );
  const thumbFor = useCatalogueThumbs(thumbRows);

  /* ── the draft belongs to the route it was typed under ─────────────────────
   *
   * `picked` following the route is only half of the fix above. `rows` — the
   * exercises and the sets — is seeded from nothing and kept in this screen's
   * state for as long as the app runs, so a coach who typed Amy's session,
   * backed out without saving and opened Log a Session from Ben's screen landed
   * on Ben's name with Amy's sets under it. One press of Save and Ben's record
   * holds an hour he did not train, in somebody else's numbers.
   *
   * So a move of the SUBJECT clears the sheet. What it costs is a half-typed
   * draft, and it is worth saying plainly that this is a loss: the coach has to
   * type it again. It is the smaller loss. The draft was never anywhere but this
   * screen's memory, whereas a save under the wrong name is a row in a client's
   * history that they cannot delete because their coach typed it.
   *
   * The SESSION is watched as well as the client, and that is not belt and
   * braces. Two sessions with the same person — the four o'clock and the seven
   * o'clock — move `sessionId` and do not move `clientId`, so the client-side
   * test alone would carry the four o'clock's sets and the four o'clock's HOUR
   * into the write-up of the seven o'clock. `subjectChange` is asked the same
   * question about the second param, which is the same rule and not a variant of
   * it.
   *
   * The day and hour are re-seeded with the sheet rather than left, for the
   * reason their own initialisers exist: on a cleared sheet they are the seed
   * for the session now in the route, and the current day and hour are the
   * ordinary case. Both are now derived rather than held, so re-seeding them is
   * clearing the coach's choice — see the block above `logDay`.
   */
  const [seenSession, setSeenSession] = useState<RouteParam>(sessionParam);
  const movedSession = subjectChange(seenSession, sessionParam);
  if (moved || movedSession) {
    if (movedSession) setSeenSession(sessionParam);
    setRows([]);
    // With the sheet goes everything said ABOUT the sheet. A note reading "6
    // exercises and 22 sets added" over an empty form, or a day still marked
    // loaded when its rows have just been cleared, are both this screen
    // describing the previous client's session to the next one.
    setLoadedDays([]);
    setPickedPlanDay(null);
    setPlanNote(null);
    setFailure(null);
    // Back to the default, which is the seed for the session now in the route
    // and otherwise the day and hour it is NOW. Read from `useNow()` above
    // rather than from a second `new Date()` here, so the value and the picker
    // beside it cannot come from two different instants.
    setChosenDay(null);
    setChosenHour(null);
    // The clocks belong to the session that has just left the screen.
    setClockFrom(null); setRest(null); setTimersOff(false);
  }

  const pickedRow = r.roster.find((c) => c.id === picked) ?? null;
  // The roster's name where the roster has one, and the param's where it does
  // not — which is every case where the read failed or the client was added by
  // hand on another device. Never the param's name for a DIFFERENT id: a coach
  // who arrived on Sarah's screen and then picked Priya must not read Sarah's
  // name over Priya's sets.
  // `subjectOf` on both sides, so this asks the same question the line above
  // asks: the param resolves to one person or to nobody, and a repeated key
  // names nobody rather than an array that happens not to equal `picked`.
  const pickedName = pickedRow?.name
    ?? (picked && picked === subjectOf(clientId) ? (typeof name === 'string' ? name : '') || null : null);
  // The first name, or a noun phrase that reads in the same slots.
  //
  // This was `(pickedName || 'your client').split(' ')[0]`, which takes the
  // FIRST WORD of the fallback and hands back "your" — so every sentence built
  // on it read "Goes into your's record", "Add what your actually did" and
  // "Log to your's record". Seen on screen the moment the screen was opened
  // without a client, which is how it opens from the tab bar.
  //
  // Only a real name is split. The fallback is a whole noun phrase and stays
  // one, because it has to work as a subject ("Add what your client actually
  // did") and as a possessive ("your client's record") in the same file.
  const first = pickedName ? pickedName.split(' ')[0] : 'your client';

  /* ── the session this coach already wrote for them ──────────────────────
   *
   * The same provider every other coach screen reads, so the block offered here
   * is the block on their record rather than a second read that could disagree
   * with it. `planOffer` is asked for the DAY BEING LOGGED — `logDay`, not
   * today — because a coach writing Monday up on Tuesday is asking about
   * Monday, and on a multi-week block the week is counted to the day on screen.
   *
   * Nobody chosen means nothing to ask about: `getProgram` takes a client id and
   * there is no such thing as "the program" without one.
   *
   * No clock is read here. `logDay` is a chosen day, and the whole resolution —
   * which week of the block, which day of that week — is arithmetic on it.
   */
  const assigned = useAssignedPrograms();
  const offer = picked
    ? planOffer(assigned.getProgram(picked), assigned.startsOn[picked] ?? null, logDay, assigned.status, first)
    : null;
  /** The chip that is on. The coach's own pick when they have made one, and
   *  otherwise the day this date schedules — falling back to the first day of
   *  the week, so a coach logging a session on a rest day still lands on
   *  something rather than on an offer with nothing selected. */
  const planKey = pickedPlanDay ?? offer?.scheduledKey ?? offer?.days[0]?.key ?? null;
  const chosenPlanDay = offer && offer.state === 'ready'
    ? (offer.days.find((d) => d.key === planKey) ?? null)
    : null;

  /** The prescribed load, in the unit the COACH is typing in, ready for the
   *  box. Stored figures are kilograms; `liftIn` is the one converter and this
   *  screen reads it back through `readLift` on the way out, so a pounds coach
   *  is shown 135 and 61.23 kg is what lands. An absent load is an empty box:
   *  never a zero, which in this app is a bodyweight set somebody performed. */
  const loadBox = (kg: number | null): string => {
    if (kg == null) return '';
    const v = liftIn(kg, wu);
    return v == null ? '' : plain(v);
  };

  /**
   * Put a day of the program on the sheet.
   *
   * APPENDED, never substituted. Whatever the coach has already typed is
   * theirs and this screen is the only thing holding it — the same rule
   * `clearSheet` is written under. A coach who wanted a clean sheet can remove
   * a row; a coach whose four typed sets vanished because they tapped Load
   * has lost work no undo can reach.
   *
   * Every figure that lands here came through `prefillDay`, which parses no
   * prescription: a row loaded from '6-8', 'AMRAP' or '30s' arrives with an
   * empty reps box and the coach's own words underneath it.
   */
  const loadPlanDay = (opt: NonNullable<typeof chosenPlanDay>) => {
    const p = prefillDay(opt.day);
    // The program's own rest for each movement, looked up by the name
    // `prefillDay` kept — it drops nameless rows, so positions do not line up
    // and an index would hand one movement another's rest. Only a usable
    // positive figure is carried: `restSecondsFor` treats everything else as
    // "nobody set one", and the bar must not say "from your program" over the
    // app's default.
    const restByName = new Map<string, number>();
    for (const ex of Array.isArray(opt.day?.exercises) ? opt.day.exercises : []) {
      const v = ex?.restSec;
      const nm = String(ex?.name ?? '').trim();
      if (nm && typeof v === 'number' && Number.isFinite(v) && v > 0 && !restByName.has(nm)) restByName.set(nm, v);
    }
    setRows((prev) => [
      ...prev,
      ...p.exercises.map((e) => ({
        key: mkKey(),
        name: e.name,
        restSec: restByName.get(e.name) ?? null,
        sets: e.sets.map((s) => ({
          reps: s.reps == null ? '' : String(s.reps),
          kg: loadBox(s.loadKg),
          target: s.target,
        })),
      })),
    ]);
    setLoadedDays((prev) => (prev.includes(opt.key) ? prev : [...prev, opt.key]));
    setPlanNote(prefillLine(p));
  };

  /* ── putting it on the sheet without being asked ───────────────────────────
   *
   * "When a coach is logging a session for a client the planned workout for
   * that day should automatically populate."
   *
   * Every piece of this already existed — `planOffer` resolves which day the
   * date schedules and `loadPlanDay` puts it on the sheet — and between them
   * sat a button the coach had to find and press. This closes that gap, under
   * four conditions, none of which is fussiness:
   *
   *   1. ONLY THE SCHEDULED DAY. `planKey` falls back to the first day of the
   *      week so the picker always has something selected, and auto-loading
   *      THAT would put a session on the sheet the client was never due — on a
   *      rest day, silently, ready to save. An automatic action may only take
   *      the answer the program actually gives.
   *   2. ONLY ONTO AN EMPTY SHEET. `loadPlanDay` appends, deliberately, and an
   *      effect that appends is an effect that can double. Whatever the coach
   *      has typed is theirs and this screen is the only thing holding it.
   *   3. ONCE. `loadedDays` already records what has been put on; the same key
   *      is never loaded twice, so a re-render, a refetch, or the coach
   *      switching the date away and back cannot stack two copies of a day.
   *   4. NOT FROM A READ THAT DID NOT LAND. `offer.caveat` marks a program
   *      resolved from the phone's last copy rather than a confirmed one. Shown
   *      with its caveat and loaded on a tap, that is a coach choosing to work
   *      from what is in hand. Loaded automatically it is a possibly-stale
   *      session appearing on screen as fact, which is precisely the class of
   *      quiet wrongness this codebase refuses.
   *
   * The coach remains able to change any of it: pick another day, edit any
   * figure, remove a row, add a movement. None of that touches the program —
   * this screen records what happened, and what the client is due next week is
   * still what the coach wrote in the builder.
   */
  const autoLoadRef = useRef<(() => void) | null>(null);
  const scheduledDay = offer && offer.state === 'ready' && offer.scheduledKey
    ? (offer.days.find((d) => d.key === offer.scheduledKey) ?? null)
    : null;
  const mayAutoLoad =
    !!scheduledDay && !offer?.caveat && scheduledDay.exercises > 0
    && rows.length === 0 && !loadedDays.includes(scheduledDay.key) && pickedPlanDay == null;
  autoLoadRef.current = mayAutoLoad && scheduledDay ? () => loadPlanDay(scheduledDay) : null;
  // Primitive deps only, and the work goes through the ref. `scheduledDay` is a
  // fresh object on every render and `loadPlanDay` closes over the coach's unit
  // setting, so either in the dependency list would re-run this on every
  // render — and an effect that appends and re-runs is the doubling that
  // condition 3 exists to prevent, arriving by a different door.
  const autoKey = mayAutoLoad && scheduledDay ? `${picked}|${logDay}|${scheduledDay.key}` : null;
  useEffect(() => {
    if (autoKey) autoLoadRef.current?.();
  }, [autoKey]);

  /* ── what they did last time, so the two of them can see the difference ────
   *
   * "Show the progress from the last time this exercise was done and show the
   * difference / improvement between the 2 sessions."
   *
   * The arithmetic is not here. `exerciseOutings` folds a log into one outing
   * per day and `compareToLast` diffs the sheet against the newest of them;
   * this is only the read that feeds them, and it is the same read
   * app/(trainer)/client-training.tsx makes, ordered the same way and for the
   * same reason — `id` settles the ties because one session writes every
   * exercise with the SAME `performed_at`, and at the cap the server may break
   * those ties differently on each read.
   *
   * NEWEST FIRST IS LOad-BEARING HERE, not a preference. The read is capped,
   * and a capped read drops the OLDEST rows — so the newest outing of any
   * movement that appears at all is the one thing truncation cannot take. That
   * is what makes "last time" safe to state off a partial read, and it is why
   * `whole` is carried separately: it does not qualify the comparison, it
   * qualifies the SILENCE. A movement with no outing in a whole read has not
   * been done before; a movement with no outing in a truncated read simply was
   * not in the rows that came back, and saying "first time" about it would be
   * telling a coach something false about their client in front of them.
   */
  const [hist, setHist] = useState<WorkoutEntry[] | null>(null);
  const [histStatus, setHistStatus] = useState<LoadStatus>('loading');
  const histFor = useRef<string | null>(null);

  /**
   * Whether this client HAS a log that could be read at all.
   *
   * Found on a device, and it is the fault src/lib/clientRecord.ts was written
   * for. A hand-added client has no Repple account and no `workouts` rows, so
   * the read is skipped — and the first version of this screen then set the
   * status to `ready` and rendered "First time Tamer has done this one" under
   * every movement on the sheet. That is a statement about a person, made from
   * a read that never happened, in front of them.
   *
   * `coach_clients.id` is `uuid DEFAULT gen_random_uuid()`, so a hand-added
   * client's id is indistinguishable from a real one's downstream; `handAdded`
   * is marked in src/ui/roster.tsx at the only place that knows which table the
   * row came out of, and `clientIsQueryable` — reached through
   * `sessionClientBlocked` — is the one reader of it. The same
   * similarity once told coaches that people with no account had disclosed no
   * injuries and not filled in their intake.
   */
  /**
   * Whether a session may be WRITTEN against this client at all.
   *
   * The same fact `historyAskable` is built on, held one step apart from it
   * because the two questions differ by one term and that term matters in
   * opposite directions. `USE_SUPABASE` belongs in the READ — a build with no
   * backend has nothing to ask — but it must not reach the WRITE, where its
   * only effect would be to disable Finish for every client in a no-backend
   * build, including the ones this screen has always been able to log.
   *
   * ── what the write does without this ──────────────────────────────────────
   *
   * `workouts.user_id references profiles(id)` and the insert policy resolves
   * `is_my_client()`, an EXISTS over `clients`. A hand-added client has neither
   * — they are a `coach_clients` row and nothing else — so every entry on the
   * sheet is refused, by the foreign key or by RLS, and `classifyWrite` reads
   * both for what they are: a server that answered and declined. Offering the
   * same bytes again gets the same answer for as long as that person has no
   * account.
   *
   * The refusal ARRIVES honestly (src/ui/floorQueue.ts does not queue one, and
   * this screen keeps the sheet on a refusal), but it arrives after twenty
   * minutes of typing, against a name the picker is showing, with a sentence
   * about the roster that is not the reason. And offline it is worse than a bad
   * sentence: nobody answers, the act is QUEUED, the coach is told it is on the
   * phone and going up, the sheet is cleared, and the next flush with signal
   * meets the refusal and drops it — an hour of somebody's training gone with
   * no screen left to say so. Neither ending is reachable if the write is
   * refused here, before anything is sent and while the sheet is still on
   * screen.
   */
  // Asked through `sessionSendBlock`'s own predicate rather than re-derived
  // here, so the sentences below and the two guards further down cannot come
  // to different conclusions about the same person.
  const clientLoggable = !sessionClientBlocked({ clientId: picked, handAdded: pickedRow?.handAdded });
  const historyAskable = USE_SUPABASE && clientLoggable;

  useEffect(() => {
    const id = picked;
    if (!id || !historyAskable) {
      histFor.current = id ?? null;
      setHist(null);
      // Deliberately NOT 'ready'. Nothing was asked, so nothing landed, and a
      // status meaning "the read came back empty" would be the lie above.
      setHistStatus('loading');
      return;
    }
    let live = true;
    histFor.current = id;
    setHist(null);
    setHistStatus('loading');
    (async () => {
      const res = await supabase.from('workouts').select(WORKOUT_COLS)
        .eq('user_id', id)
        .order('performed_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(capLimit());
      // The coach may have moved on to another client while this was in the
      // air. Landing an answer about the wrong person under their name is the
      // failure this guard exists for, and it is checked on both the closure
      // and the ref so a remount cannot resurrect a stale one.
      if (!live || histFor.current !== id) return;
      if (res.error) {
        reportError('logSession.history', res.error);
        setHist(null);
        setHistStatus('error');
        return;
      }
      const page = cappedRows((res.data ?? []) as unknown as WorkoutRow[]);
      setHist(page.rows.map(rowToEntry));
      setHistStatus(page.truncated ? 'partial' : 'ready');
    })();
    return () => { live = false; };
  }, [picked, historyAskable]);

  /**
   * The newest outing of each movement on the sheet.
   *
   * Keyed by the row's own name because that is what the coach is looking at;
   * `exerciseOutings` resolves the identity by slug underneath, so a client who
   * logged "Bench-Press" is still found under "Bench Press".
   *
   * No bodyweight history is passed. That is a real limitation and it is
   * deliberate rather than forgotten: pricing a chin-up needs the client's
   * weigh-ins (src/lib/bodyweightSets.ts), which is a second read this screen
   * does not make. The consequence is contained — a bodyweight movement's sets
   * land in `unpricedSets` and its load-derived figures come back null, so the
   * comparison shows reps and sets and withholds tonnage rather than inventing
   * a body. Withholding is the correct failure.
   */
  const lastByName = useMemo(() => {
    const m = new Map<string, ExerciseOuting | null>();
    if (!hist) return m;
    for (const row of rows) {
      if (m.has(row.name)) continue;
      const outings = exerciseOutings(hist, row.name);
      m.set(row.name, outings.length ? outings[0] : null);
    }
    return m;
  }, [hist, rows]);

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

  /**
   * Put a movement on the sheet.
   *
   * The name is resolved to the CATALOGUE's own spelling before it goes on,
   * and that is the whole of the fix: `entriesToWrite` writes `r.name`
   * straight into `workouts.exercise`, so whatever lands here is what a
   * client's history says forever. Ten rows in the live table held a coach's
   * typed text — "Calf raise", "Hip abduction", "Shoulder press" — against
   * catalogue rows spelled "Calf Raise", "Hip Abduction", "Shoulder Press",
   * and the member's own screen then printed the same lift two ways depending
   * on which handset wrote it.
   *
   * Resolution is by slug or by an exact synonym and never by a near-miss (see
   * src/lib/exerciseName.ts); a movement nothing resolves goes on as typed, in
   * Title Case, so a coach's own invention still looks like the library around
   * it. Re-casing cannot change the slug, so an unread catalogue costs nothing
   * here either.
   *
   * Every caller routes through this — the custom box, the coach's saved list
   * and the built-in list — rather than each one remembering to ask.
   */
  const addExercise = (n: string) => {
    const name = canonicalExerciseName(n, cat.rows);
    setRows((p) => [...p, { key: mkKey(), name, sets: [{ reps: '', kg: '' }] }]);
    setPicker(false);
    setCustom('');
  };
  const addSet = (key: string) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, sets: [...r.sets, { reps: '', kg: '' }] } : r)));
  // A new rep count takes `held` off with it: typing reps is recording a set,
  // and a row that kept refusing to count after being retyped would be the
  // stuck tick again from the other side. The load box does not — correcting
  // the weight on a set that was unticked says nothing about whether it ran.
  const patchSet = (key: string, i: number, patch: Partial<{ reps: string; kg: string }>) =>
    setRows((p) => p.map((r) => (r.key === key
      ? { ...r, sets: r.sets.map((s, x) => (x === i ? { ...s, ...patch, ...(patch.reps !== undefined ? { held: false } : null) } : s)) }
      : r)));
  /** Untick or re-tick a set whose figures the coach typed. See `held`. */
  const holdSet = (key: string, i: number, held: boolean) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, sets: r.sets.map((s, x) => (x === i ? { ...s, held } : s)) } : r)));
  const removeRow = (key: string) => setRows((p) => p.filter((r) => r.key !== key));
  /**
   * Take one set off an exercise, leaving the rest.
   *
   * Reported from the floor: "need to be able to remove a set from an exercise
   * not just able to delete the entire exercise." A coach who loaded a four-set
   * day their client only got three sets into had one control — Remove — and it
   * took the whole movement with it, so the three sets they HAD done were
   * retyped from scratch.
   *
   * Never the last one. An exercise with no sets writes nothing and reads as a
   * broken row; a coach who wants the movement gone has Remove, which says so.
   * The screen hides the control at one set and this refuses it as well, because
   * the two must not be able to disagree.
   */
  const removeSet = (key: string, i: number) =>
    setRows((p) => p.map((r) => (
      r.key === key && r.sets.length > 1
        ? { ...r, sets: r.sets.filter((_, x) => x !== i) }
        : r
    )));
  /**
   * Remove a set, asking first if it carries anything.
   *
   * This screen has no undo — the rule `loadPlanDay` and the tick are both
   * written under — and this control sits next to the tick, which is the thing
   * a coach taps repeatedly with one hand mid-session. A mis-tap that silently
   * deletes a typed set is the cost of getting that adjacency wrong.
   *
   * An EMPTY set goes without a question, because there is nothing to lose and
   * a confirmation on every tap is how people learn to dismiss confirmations.
   */
  const askRemoveSet = (key: string, i: number, name: string, s: { reps: string; kg: string }) => {
    const typed = (s.reps ?? '').trim() !== '' || (s.kg ?? '').trim() !== '';
    if (!typed) { removeSet(key, i); return; }
    Alert.alert(
      `Remove Set ${i + 1}?`,
      `${name} set ${i + 1} has figures in it, and this screen has no undo.`,
      [
        { text: 'Keep It', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeSet(key, i) },
      ],
    );
  };

  /** Empty the form once the write has been taken responsibility for.
   *
   *  Called on exactly the arms where something now holds these sets other than
   *  this screen — the server, or the floor queue on this phone. Never on a
   *  refusal and never on a queue that would not take them, because on those
   *  arms this form is the only copy in existence.
   *
   *  It exists because `router.back()` does not unmount this screen: it is
   *  registered `href: null` inside <Tabs> (app/(trainer)/_layout.tsx) and stays
   *  mounted for the life of the app, so a saved session sat in `rows` waiting to
   *  be saved again against whoever was opened next. */
  const clearSheet = () => {
    setRows([]); setCustom(''); setPicker(false);
    // And what was said about the rows that have just gone. See the same three
    // setters in the subject-change block above.
    setLoadedDays([]); setPickedPlanDay(null); setPlanNote(null);
    // And the clocks. They were timing THIS session, and this screen is never
    // unmounted — a clock left running would be counting the next client's
    // hour from the middle of the last one's.
    setClockFrom(null); setRest(null); setTimersOff(false);
  };

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
          // zero-ok: `s.reps` is the coach's own text box on this screen, not a
          // figure anybody reported. A blank or unreadable box is not a set of
          // zero reps — it is a row that was never filled in — and the `> 0`
          // here is exactly the filter that drops it. See the comment above.
          // …and, since the tick can be taken back off, a set the coach has
          // unticked. `counts` is both halves.
          .filter(counts)
          .map((s) => {
            const load = readLift(s.kg, wu);
            // A refused load is not written as a number at all. `ready` below
            // withholds the save while any refusal stands, so this only ever
            // runs on figures that read.
            // zero-ok: only reached for a set the filter above has already
            // read as more than zero reps, so this coercion cannot produce the
            // 0 it is written with. Same box, same argument.
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
        // zero-ok: the coach's own rep box again, and the zero is the arm that
        // SKIPS the row rather than one that gets written. A blank set is a row
        // they tabbed past; its load is not asked about because there is no set.
        // An unticked set is skipped for the same reason: it is not going to
        // be written, so an unreadable load on it holds nothing up.
        if (!counts(st)) continue;
        const load = readLift(st.kg, wu);
        if (!load.ok) return `${r.name}: ${load.reason}`;
      }
    }
    return null;
  };

  /** Whether there is anything worth writing. The same rule `entriesToWrite`
   *  applies — only a set with a rep count is a set — asked without needing a
   *  timestamp, so the button can be held before one has been settled on. */
  // zero-ok: the same rep box and the same `> 0` validity test `entriesToWrite`
  // applies, asked of the whole sheet. An empty box reads as zero and means
  // "nothing typed here yet", which is what this question is for.
  const hasSets = rows.some((r) => r.sets.some(counts));

  /** Why the day and hour on the picker cannot be used, or null. A session
   *  dated into the future counts towards a streak nobody has earned, and the
   *  client cannot correct it because they did not type it. */
  //
  // A FRESH read, deliberately, and the one place on this screen that is not
  // `now`. This asks "has that hour happened yet", and the answer has to be
  // about the moment of asking: `useNow()` settles at midnight, on foreground
  // and on focus, so at 14:01 it may still be holding 13:59 — and a coach who
  // stepped the hour to 2 pm would be told 2 pm has not happened. A render-body
  // read is re-evaluated on every render, and every tap on this screen is one.
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
  //
  // And withheld for a client there is no record to write into, which is the
  // second half of the same argument. `clientLoggable` is the whole of that
  // decision and its docstring is the reason; held HERE it costs the coach the
  // banner above the button instead of the session, which is what it cost when
  // the check happened at the insert.
  //
  // The whole of it is `maySendSession` in src/lib/sessionSend.ts, which is
  // where each of the five refusals is asserted. `handAdded` is a required
  // field of what it is handed, so the account question cannot leave this call
  // without the compiler saying so.
  const ready = maySendSession({
    clientId: picked, handAdded: pickedRow?.handAdded,
    hasSets, loadProblem: loadProblem(), whenProblem,
  });

  const save = async () => {
    // Synchronous, before the first await — see `saving`. This is the whole of
    // the protection: there is no second one on the server.
    if (saving.current || busy) return;
    saving.current = true;
    try {
      await runSave();
    } finally {
      saving.current = false;
    }
  };

  const runSave = async () => {
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
      Alert.alert('Nothing to Log', 'Add at least one set with a rep count.');
      return;
    }
    if (!picked) {
      // Reachable only if the button is pressed while nothing is chosen, which
      // `ready` already prevents. Kept as the second half of the belt: this is
      // a write into somebody's history and there is no undo on the other side.
      setFailure('Nobody is chosen yet, so there is nobody to log this against. Pick a client at the top of this screen.');
      return;
    }
    if (sessionClientBlocked({ clientId: picked, handAdded: pickedRow?.handAdded })) {
      // The same belt as the line above, for the same reason and with more at
      // stake: `ready` already withholds the button, and this is what stands
      // between a press that beat it and a write nothing on the other side can
      // accept. Before `setBusy`, before the queue, before anything is sent —
      // so the sheet is untouched and the coach is told so in the same breath.
      setFailure(`${pickedName || 'That person'} has no Repple account, so there is no record for this session to go into and nothing has been sent. `
        + 'What you have typed is still here. Send them your coaching code from their own screen, and this can be saved once they are on the app.');
      return;
    }
    const coachId = auth.user?.id;
    if (!coachId) {
      // A session still being restored is not a signed-out coach, and telling
      // somebody they are signed out sends them to sign in again and lose the
      // sets they have just typed. `auth.loading` is the difference between the
      // two, and this screen used to fold them into one sentence.
      setFailure(auth.loading
        ? 'Still checking your sign-in. Nothing has been saved yet. Try again in a moment.'
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
      // 'full' joins 'refused' here for the same reason and a stronger one: the
      // log did not reach anybody and is not going to, so spending a client's
      // session credit for an hour with no record would be the ending point 4
      // of the decision exists to prevent, with not even a queue entry to
      // explain it later.
      if (out === 'refused' || out === 'full') {
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
        const marked = await queue.attempt({
          kind: 'session-outcome', sessionId, clientName: pickedName,
          outcome: 'completed', rateCents,
        });
        // A device that would not keep the mark is not a server that refused
        // it, but for the session it is the same fact and the same sentence:
        // nothing was recorded and nothing is waiting. `OutcomeAnswer` has no
        // 'full' arm because the outcome is one tap that can be made again from
        // the Mark Sessions queue — unlike the entries above, which exist
        // nowhere else — so it is reported as the refusal it functionally is.
        outcomeAnswer = marked === 'full' ? 'refused' : marked;
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
      // Written, or on this phone and going up. Either way the sheet has been
      // taken responsibility for and must not be left behind it — see the note
      // on the non-session arm below, which is the same rule.
      clearSheet();
      Alert.alert(rep.title, rep.lines.join('\n\n'), [{ text: 'Done', onPress: () => router.back() }]);
      return;
    }

    if (out === 'stored') {
      notifySuccess();
      /* ── and the sheet goes ────────────────────────────────────────────────
       *
       * `router.back()` does not unmount this screen — it is registered
       * `href: null` inside <Tabs> and stays mounted for the life of the app —
       * so the sets that have just been written stayed in `rows`, ready to be
       * written a second time. The next open, for anybody, drew somebody else's
       * session already typed in, and a coach who pressed Save on it put the
       * same hour of training into a second person's history. The subject
       * following the route (above) fixes whose name is on the screen; this
       * fixes what is under it. */
      clearSheet();
      Alert.alert(
        'Session Logged',
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
          : 'The usual cause is that the person is not on your roster. A session can only be logged for somebody on your book. If they are on it, open their record before typing this in again: part of it may have reached them.',
      ));
      return;
    }
    /* ── nothing was kept, which is not the same as being offline ────────────
     *
     * `queue.attempt` has a fourth answer and this arm used to swallow it: with
     * the phone already holding FLOOR_CAP acts the write is neither sent nor
     * queued, and the sentence below — "saved on this phone … it goes up next
     * time this app has signal" — is then false in both halves. A coach who
     * reads it presses Done and walks away from an hour of typing that exists
     * nowhere. `floorFullLine` says the true thing and the sheet stays on
     * screen, because this screen is the only thing holding it.
     */
    if (out === 'full') {
      setFailure(floorFullLine('This session'));
      return;
    }
    // Kept. Said as a sentence and not as a success: the client cannot see this
    // yet and neither can anybody else. The sheet still goes: it is on this
    // phone, in the queue, under its own timestamp, and leaving a copy of it in
    // the form is how it gets sent a second time.
    clearSheet();
    Alert.alert('Kept on This Phone',
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
          contentContainerStyle={{ paddingHorizontal: G, paddingBottom: scrollPad }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          refreshControl={pull}
        >
          {/* ── the board's head: back, the title on the centre line, and
              the person's name under it once there is one. It used to read
              "Client" over a screen that had nobody and could not be given
              anybody; now it says nothing until it can say a name.

              ── Finish, where it can always be reached ────────────────────
              Reported as missing entirely: "how does a coach save a session
              they have logged for a client as there is no save logged
              session button for them to tap". The button at the foot of the
              form was real, but it was below the fold at the end of a long
              sheet and drawn in two greys. Giving its disabled state an edge
              made it visible; putting a second one HERE, in the head's one
              trailing slot, makes it findable, which is a different problem
              and the one that was actually reported.
              Both press `save`. There is no second write path and no second
              set of guards — `ready` is the same predicate, so the two cannot
              disagree about whether this session may be filed. */}
          <PageHead title="Log a Session" subtitle={pickedName || undefined}
            trailing={
              <Cta label={busy ? 'Saving…' : 'Finish'} disabled={!ready || busy} onPress={save}
                a11yLabel={!picked ? 'Finish. Pick a client first'
                  : !clientLoggable ? `Finish. ${first} has no Repple account for this to be logged to`
                  : `Finish and log this session to ${first}'s record`} />
            } />
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
            {/* Not a promise this screen can keep for everybody on the book. A
                hand-added client has no record for a session to go into, and
                saying it does under a disabled button is the screen describing
                somebody else's client. */}
            {!picked
              ? 'Pick who this was with, then add what they did. It goes into their own record, marked as logged by you.'
              : clientLoggable
                ? `Goes into ${first}’s own record, marked as logged by you.`
                : `${first} has no Repple account yet, so there is no record for this to go into.`}
          </Text>

          {/* ── the session clock ─────────────────────────────────────────────
              Context before state: how long the two of them have been at it
              sits in the head, above the totals it puts in proportion. Offered
              only for a session filed under today — see `isLive` — and it says
              under itself that it is not written anywhere, because every other
              figure on this screen ends up in somebody's record and this one
              must not be mistaken for one that does. */}
          {/* A NIGHT strip, and the figure in the hero face: the clock is the
              one thing on this screen read from across a rack, by somebody
              holding a bar, and it was a 24pt line beside an 18pt icon. Night
              rather than a white card because it is the floor's instrument and
              not a field — nothing else on this sheet is night, so it cannot
              be mistaken for something that gets saved. Everything on it uses
              the night inks; the button is the bright accent under its deep
              ink, the pair the kit's hero button is drawn in. */}
          {isLive ? (
            <View style={{
              flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.md, marginTop: sp.md,
              backgroundColor: t.night, borderRadius: radius.lg, padding: sp.lg, ...elevation.hero,
            }}>
              <View style={{ flex: 1, minWidth: 150 }}>
                <Text style={{ ...ty.eyebrow, color: t.nightInk3 }}>Session Clock</Text>
                {clockFrom != null ? (
                  <SessionClock from={clockFrom} ink={t.nightInk} />
                ) : (
                  <Text style={{ ...ty.section, color: t.nightInk, marginTop: 2 }}>{timersOff ? 'Stopped' : 'Not Started'}</Text>
                )}
                <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: 2 }}>
                  {clockFrom != null
                    ? 'On this phone only, not written to their record.'
                    : timersOff
                      ? 'The rest timer stopped with it. Start brings both back.'
                      : 'Starts here, or with the first set you tick.'}
                </Text>
              </View>
              <Pressable
                onPress={clockFrom != null ? stopClocks : () => { startClock(); tapLight(); }}
                accessibilityRole="button"
                accessibilityLabel={clockFrom != null ? 'Stop the session clock and the rest timer' : 'Start the session clock'}
                style={{
                  minHeight: 48, paddingHorizontal: sp.xl, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: clockFrom != null ? t.night2 : t.brandBright,
                }}>
                <Text style={{ ...ty.label, ...font('700'), color: clockFrom != null ? t.nightInk : t.brandDeep }}>
                  {clockFrom != null ? 'Stop' : 'Start'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── what is on the sheet, as it is typed ──────────────────────────
              Volume and Sets, the two running totals a coach can check against
              what they just watched. Duration is not among them: the clock
              above is the floor's, and a session written up afterwards has no
              honest duration to show — a figure here would be how long the
              typing took.

              Both come from `sheetTally`, the same fold the Previous column's
              history is measured with, so the strip cannot disagree with the
              table under it. SETS is the count that will actually be SAVED —
              the same rule the ticks draw — which is why a sheet of empty rows
              reads 0 rather than however many rows are on screen. */}
          {rows.length ? (() => {
            const all = sheetTally(rows.flatMap((r) => r.sets.reduce<[number, number | null][]>((acc, st) => {
              const n = parseInt(st.reps, 10);
              if (!counts(st) || !Number.isFinite(n)) return acc;
              const load = readLift(st.kg, wu);
              acc.push([n, load.ok && load.kg != null ? load.kg : null]);
              return acc;
            }, [])));
            const vol = volumeIn(all.volumeKg, wu);
            return (
              /* Two tiles in the colours these two figures have everywhere else
                 in the look — volume orange, a count blue. A dash, not a
                 nought, for the volume: a session of bodyweight sets moved a
                 real amount that this app cannot price, and printing 0 kg over
                 it would be a measurement of something that did not happen.
                 `KpiTile` draws the dash for null and says "no figure". */
              <KpiRow tiles items={[
                { label: 'Volume', tone: 'orange', value: vol == null ? fig(null) : num(vol), unit: vol == null ? undefined : wu },
                { label: 'Sets', tone: 'blue', value: num(all.setCount) },
              ]} />
            );
          })() : null}

          <Rule />

          {/* ── the client this session cannot be filed against ──────────────
              Said as soon as they are chosen and kept on screen while they
              are, because the cost of saying it late is the whole sheet: a
              hand-added client's insert is refused by the foreign key and by
              RLS, and offline it is queued, reported as kept and dropped on the
              next flush. `clientLoggable` carries the argument in full.

              It says what happens to the typing as well as what does not
              happen to the record. Nothing on this sheet is cleared or sent for
              somebody with no account, and a coach standing in a gym needs to
              know that before they decide whether to write the hour down on
              paper. */}
          {picked && !clientLoggable ? (
            <View style={{ marginBottom: sp.lg }}>
              <Flag tone={t.warn}>
                {pickedName || 'This client'} was added by hand and has no Repple account, so there is no record
                for a session to go into and Finish is withheld. Nothing you type here is lost. It stays on this
                sheet. Send them your coaching code from their own screen, and this can be saved once they are on
                the app.
              </Flag>
            </View>
          ) : null}

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
                What this phone is still carrying could not be read, so whether anything is waiting to go up is not known. Nothing has been lost, and it is not being written over either.
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
              <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>
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
                  Your clients could not be read, so this is not an empty book. Nobody is listed
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

            {/*
              * whole-ok: neither status this lets through can make the branch say the
              * wrong thing. 'loading' is split out one line below and gets "Reading your
              * clients…" — which is the whole reason that sentence is there, because this
              * is the screen a coach opens mid-session while standing in front of the
              * client, and "nobody is on your book" is the worst thing it could say to
              * them. And 'partial' means the read stopped at the 1000-row ceiling
              * (src/lib/rowCap.ts), so the roster holds a thousand names rather than
              * none: it cannot reach an empty list to make this branch true.
              */}
            {r.roster.length === 0 && r.status !== 'error' ? (
              r.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading your clients…</Text>
              ) : (
                /* The sentence named the Clients screen and left the coach to
                   go and find it. Same component as the eleven per-client
                   screens now use, so the remedy is in one place and one
                   wording — see src/ui/EmptyRoster.tsx. */
                <EmptyRoster lacks="there is nobody to log a session against" />
              )
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
                      <Text style={{ ...ty.label, ...font('500'), color: on ? t.brandInk : t.ink2 }}>{c.name}</Text>
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
              // `r.roster.length` is what THIS APP HOLDS, which is the size of
              // the book only under a whole read. `useRoster` reports 'partial'
              // on a truncated one, and this screen already honours it for the
              // search sentence three lines up — while the sentence that tells
              // a coach where the missing people are printed the page size as
              // the total. See `rosterPickerLine`.
              <Text style={{ ...ty.caption, color: r.status === 'ready' ? t.ink3 : t.ink2, marginTop: sp.md }}>
                {rosterPickerLine({ status: r.status, shown: shownClients.length, known: r.roster.length })}
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
              {/* The same instant the default day above is derived from, not a
                  second read of the clock: a chip list built from one `new Date()`
                  and a `logDay` built from another disagree across midnight, and
                  the coach is shown a picker with nothing selected on it. */}
              {logDayOptions(now).map((d) => {
                const on = d.day === logDay;
                return (
                  <Pressable key={d.day} onPress={() => {
                    setChosenDay(d.day);
                    // And the program day goes back to following the date. A
                    // coach who switches from Tuesday to Monday is asking about
                    // Monday's session; a chip that stayed selected would be
                    // answering the question they have just changed. What has
                    // already been LOADED is untouched — those rows are on the
                    // sheet and are the coach's now.
                    setPickedPlanDay(null);
                  }}
                    accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={on ? `${d.label}, chosen` : `File this session under ${d.label}`}
                    hitSlop={{ top: hitSlopFor(34), bottom: hitSlopFor(34), left: 0, right: 0 }}
                    style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, ...font('500'), color: on ? t.brandInk : t.ink2 }}>{d.label}</Text>
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
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>Start Hour</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderRadius: radius.sm }}>
                {/* Stepped from the hour ON SCREEN, which is the coach's choice
                    where they have made one and the current hour where they have
                    not. Not a functional updater: the state behind this is
                    `null` until the first tap, and `null` is not an hour to step
                    from. */}
                <Pressable onPress={() => setChosenHour((logHour + 23) % 24)} hitSlop={8}
                  accessibilityRole="button" accessibilityLabel="An hour earlier"
                  style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Icon name="minus" size={15} color={t.ink2} />
                </Pressable>
                <Text style={{ ...ty.body, ...font('500'), color: t.ink, minWidth: 64, textAlign: 'center' }}>
                  {hourLabel(logHour)}
                </Text>
                <Pressable onPress={() => setChosenHour((logHour + 1) % 24)} hitSlop={8}
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
                {logWhenLine(logDay, logHour, now, first)}
              </Text>
            )}
          </Section>

          {/* ── the session the coach already wrote ────────────────────────
              Between When and Exercises, because it is an answer to "what did
              they do" and it depends on the day chosen above it: the offer
              re-resolves when the coach changes the day, so a session filed
              under Monday offers Monday's plan.

              Four states, four sentences, and they are not interchangeable —
              a coach told "they have no program" when the truth is "the read
              did not land" will write the session from memory and stop
              trusting the screen. `planOffer` owns which one is said. */}
          {picked && offer ? (
            <Section>
              <SectionHead title="From Their Program" note={offer.weekLabel ?? undefined} />
              {offer.state === 'unreadable' ? (
                <Flag tone={t.warn}>{offer.line}</Flag>
              ) : (
                <Text style={{ ...ty.label, color: t.ink3 }}>{offer.line}</Text>
              )}

              {/* A plan resolved from a read that did not land is offered WITH
                  the caveat rather than withheld: the program is real, it is
                  simply not known to be the newest one. */}
              {offer.caveat ? (
                <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{offer.caveat}</Text>
              ) : null}

              {offer.state === 'ready' ? (
                <View>
                  {/* The whole WEEK, not only the day this date falls on. A
                      coach writing an hour up afterwards is routinely writing
                      up the Friday session they ran on a Wednesday. */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
                    {offer.days.map((d) => {
                      const on = d.key === planKey;
                      return (
                        <Pressable key={d.key} onPress={() => setPickedPlanDay(d.key)}
                          accessibilityRole="button" accessibilityState={{ selected: on }}
                          accessibilityLabel={on
                            ? `${d.label}, chosen. ${d.exercises} exercise${d.exercises === 1 ? '' : 's'}.`
                            : `Choose ${d.label}, ${d.exercises} exercise${d.exercises === 1 ? '' : 's'}.`}
                          hitSlop={{ top: hitSlopFor(34), bottom: hitSlopFor(34), left: 0, right: 0 }}
                          style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                          <Text style={{ ...ty.label, ...font('500'), color: on ? t.brandInk : t.ink2 }}>
                            {d.label} · {d.exercises}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {chosenPlanDay ? (
                    <View style={{ alignItems: 'flex-start', marginTop: sp.md }}>
                      {loadedDays.includes(chosenPlanDay.key) ? (
                        // Said rather than a control that does nothing. A
                        // second tap would put the same six movements on the
                        // sheet twice, and the copy is indistinguishable from a
                        // genuine second time through the session.
                        <Text style={{ ...ty.caption, color: t.ink2 }}>
                          {chosenPlanDay.label} is already on the sheet below. If they did something else as well,
                          add it by hand with Add Exercise.
                        </Text>
                      ) : (
                        <Ghost
                          label={`Load ${chosenPlanDay.exercises} Exercise${chosenPlanDay.exercises === 1 ? '' : 's'}`}
                          a11yLabel={`Put the ${chosenPlanDay.exercises} exercise${chosenPlanDay.exercises === 1 ? '' : 's'} of ${chosenPlanDay.label} on the sheet, with your targets to edit`}
                          onPress={() => loadPlanDay(chosenPlanDay)} />
                      )}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* What landed, and every box it left blank, accounted for by
                  name. A screen that fills eleven boxes and leaves nine empty
                  without saying why reads as a bug — and a coach who reads it
                  as one deletes the rows and types the session again, which is
                  the work this exists to save them. */}
              {planNote ? (
                <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{planNote}</Text>
              ) : null}
            </Section>
          ) : null}

          <Section>
            <SectionHead title="Exercises" note={rows.length ? `${rows.length}` : undefined} />
            {rows.length === 0 ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>
                Nothing added yet. Add what {first} actually did. Only sets with a rep count are saved.
              </Text>
            ) : null}

            {rows.map((r) => {
              /* ── this movement, against the last time they did it ──────────
               *
               * Built per row and per render, off the boxes as they stand, so
               * the comparison moves as the coach types. Every figure in it is
               * kilograms — this is the render boundary and the only place a
               * conversion happens, which is the rule src/ui/ExerciseHistory.tsx
               * states and the reason a genuine 2.5 kg progression does not read
               * "+5 lb" one week and "+6 lb" the next.
               *
               * A set with no rep count is not in the tally, exactly as it is
               * not in `entriesToWrite`. A load box that will not parse is not
               * a load of nothing either: `readLift` refuses it, and it comes
               * through as an unknown load rather than as zero. */
              const nowSets = r.sets.reduce<[number, number | null][]>((acc, s) => {
                const n = parseInt(s.reps, 10);
                if (!counts(s) || !Number.isFinite(n)) return acc;
                const load = readLift(s.kg, wu);
                acc.push([n, load.ok && load.kg != null ? load.kg : null]);
                return acc;
              }, []);
              const last = lastByName.get(r.name) ?? null;
              // One entry per row of THIS sheet, so the column and the table
              // cannot fall out of step as sets are added and removed.
              const prev = previousSets(last, r.sets.length);
              return (
              <View key={r.key} style={{ paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.md }}>
                  {/* The still, leading the row the way the builder's rows and
                      the member's meals do. Decorative to a screen reader: the
                      name beside it is the label, and a picture of a squat
                      announced before "Back Squat" is the same thing twice. */}
                  <View accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                    <ExerciseThumb uri={thumbFor(stillFor(r.name) ?? { thumbPath: null })} t={t} size={56} />
                  </View>
                  <Text style={{ ...ty.head, color: t.ink, flex: 1 }}>{movement(r.name)}</Text>
                  <Pressable onPress={() => removeRow(r.key)} hitSlop={8} accessibilityRole="button"
                    accessibilityLabel={`Remove ${movement(r.name)}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
                    <Text style={{ ...ty.caption, color: t.ink2 }}>Remove</Text>
                  </Pressable>
                </View>

                {/* ── what could not be read, when that is the fact ──────────
                    The PREVIOUS column below carries the ordinary case, set by
                    set. What a column of dashes cannot say is WHY it is empty,
                    and there are four different reasons — so the three that are
                    not "they have not done this before" are said in words.

                    Only a read that LANDED may call something a first time.
                    Under a truncated read the honest statement is about the
                    rows that came back, and under a failed one it is about the
                    connection. Saying "first time" off a read that was cut
                    would be telling a coach something false about their client
                    while standing next to them. */}
                {!historyAskable ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                    {first} was added by hand and has no Repple account, so there is no history to compare against.
                  </Text>
                ) : histStatus === 'loading' ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                    Reading what {first} did last time…
                  </Text>
                ) : histStatus === 'error' ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                    {first}’s history could not be read, so the Previous column is empty for a reason that is
                    nothing to do with them. Log the session as normal.
                  </Text>
                ) : last ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                    Previous · {last.day ? historyDayLabel(last.day) : 'date unknown'}
                    {last.entryCount > 1 ? ` · written up in ${num(last.entryCount)} goes` : ''}
                  </Text>
                ) : isWhole(histStatus) ? (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                    First time {first} has done this one.
                  </Text>
                ) : (
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                    No earlier {movement(r.name)} in the sessions that could be read. Their record goes back
                    further than this, so this may not be the first time.
                  </Text>
                )}

                {/* Column headers rather than placeholders. Every set after the
                    first is seeded from the one above it, so from set two on
                    the two words that said which column was reps and which was
                    load were never on screen — and the load column's unit is
                    the coach's own kg/lb setting, not a constant. */}
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center' }}>
                  <Text style={{ ...ty.micro, color: t.ink3, width: 24 }}>Set</Text>
                  {/* What that set WAS, on the line of the set it was. Asked for
                      after seeing it done this way elsewhere, and it is better
                      than the sentence it replaces: set 3's figure sits on set
                      3's row instead of having to be held in the head while
                      typing into it. */}
                  <Text style={{ ...ty.micro, color: t.ink3, flex: 1.7 }}>Previous</Text>
                  {/* KG before REPS, matching the Previous column's own phrasing
                      ("42.5 kg × 12") so the eye reads the row in one direction.
                      Safe to reorder because both columns are LABELLED — the
                      header row exists precisely because sets after the first
                      are seeded from the one above and the words would otherwise
                      be off screen — and because `patchSet` addresses the fields
                      by name, so nothing about the write depends on their
                      position. */}
                  <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>{wu.toUpperCase()}</Text>
                  <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>Reps</Text>
                  {/* The tick's column, named. A bare column of circles is a
                      control nobody knows the meaning of until they press one,
                      and the one thing this must not be is a mystery on a
                      screen that writes to somebody else's record. */}
                  <View style={{ width: 44, alignItems: 'center' }}>
                    <Text style={{ ...ty.micro, color: t.ink3 }}>Done</Text>
                  </View>
                  {/* The remove column has no heading — a word over a column of
                      minus signs reads as an instruction rather than a label —
                      but it needs the width, or the two rows stop lining up. */}
                  <View style={{ width: 30 }} />
                </View>
                {r.sets.map((s, i) => (
                  <View key={i}>
                    {/* A done set is a TONED row, not only a filled circle at
                        its far end: the accent's pale plate across the whole
                        row and its number in the accent's text colour, so a
                        coach glancing down mid-session sees how far through
                        the movement they are without reading a column. The
                        test is the tick's own — `willSave` and not held — so
                        the plate and the tick cannot disagree. The negative
                        margin gives the plate its inset without moving the
                        columns off the header row above. */}
                    <View style={{
                      flexDirection: 'row', gap: sp.sm, marginTop: sp.sm, alignItems: 'center',
                      marginHorizontal: -sp.xs, paddingHorizontal: sp.xs, borderRadius: radius.md,
                      backgroundColor: willSave(sheetTick(s.target, s.reps)) && !s.held ? t.brandSoft : 'transparent',
                    }}>
                      <Text style={willSave(sheetTick(s.target, s.reps)) && !s.held
                        ? { ...ty.caption, ...font('700'), color: t.brandText, width: 24 }
                        : { ...ty.caption, color: t.ink3, width: 24 }}>{i + 1}</Text>
                      {/* The same set, last time. A dash means there was no set
                          in that position — nothing about the read, which the
                          line above the table says in words when it is the
                          case. Kilograms out of the history, converted HERE and
                          once, like every other load on this screen. */}
                      <Text style={{ ...ty.caption, color: t.ink3, flex: 1.7 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                        {(() => {
                          const pv = prev[i];
                          if (!pv) return '—';
                          const load = liftLabel(pv.loadKg, wu);
                          // A bodyweight set has reps and no knowable load, and
                          // "0 kg × 12" would be a lift nobody did.
                          return load ? `${load} × ${pv.reps}` : `${pv.reps} reps`;
                        })()}
                      </Text>
                      <TextInput value={s.kg} onChangeText={(v) => patchSet(r.key, i, { kg: v })}
                        keyboardType="decimal-pad"
                        accessibilityLabel={`${movement(r.name)} set ${i + 1} weight in ${wu === 'kg' ? 'kilograms' : 'pounds'}`} style={[inp, { flex: 1 }]} />
                      <TextInput value={s.reps} onChangeText={(v) => patchSet(r.key, i, { reps: v })}
                        // decimal-ok: a rep count is whole — nobody performs 8.5
                        // repetitions, and `entriesToWrite` reads this box with
                        // parseInt. Only flagged at all because the columns were
                        // reordered to KG then REPS to match the Previous
                        // column's own phrasing, which puts this box directly
                        // after the weight field's label; the gate matches a
                        // field to the nearest name and picks up "weight". The
                        // keyboard here is right and the attribution is not.
                        keyboardType="numeric"
                        // A set that BECAME done while this box had the focus
                        // starts its rest when the box is left — the range and
                        // AMRAP rows, which have no tick to tap because the
                        // figure has to be typed. Only with the clock running:
                        // a coach writing the hour up afterwards has started no
                        // clock and gets no chime for typing.
                        onFocus={() => { repsFocus.current = { at: `${r.key}:${i}`, counted: counts(s) }; }}
                        onBlur={() => {
                          const f = repsFocus.current;
                          repsFocus.current = null;
                          if (clockFrom != null && f && f.at === `${r.key}:${i}` && !f.counted && counts(s)) startRest(r, i);
                        }}
                        accessibilityLabel={`${movement(r.name)} set ${i + 1} reps`}
                        // The prescription, spoken. A coach using VoiceOver
                        // cannot see the caption below the row, and the box
                        // being empty under 'AMRAP' is the one thing about
                        // this screen that has to be explained rather than
                        // looked at.
                        accessibilityHint={s.target
                          ? `You wrote ${s.target} for this set. Type what they actually did.`
                          : undefined}
                        style={[inp, { flex: 1 }]} />
                      {/* ── the tick ──────────────────────────────────────────
                          "There should be a check mark to the right of the
                          exercise set being performed that logs this set as
                          being completed."

                          It logs it by FILLING THE BOX, and it is drawn as done
                          when the box holds a count. That is the whole design
                          and src/lib/sheetTick.ts argues it: a `done` flag
                          beside the reps would be a second answer to a question
                          the reps already answer, and the two disagree the
                          first time somebody ticks a set and clears it. So the
                          invariant on screen is the one a coach can rely on —
                          A FILLED TICK IS A SET THAT WILL BE SAVED.

                          Not offered where the plan is a range, an AMRAP or a
                          hold: one tap would have to decide what '6-8' meant,
                          and the fastest control on the screen must not make
                          that call on the coach's behalf. Nor may it erase a
                          figure the coach typed by hand — this screen has no
                          undo.

                          ── and it comes back off ─────────────────────────────
                          "Can't untick a log if accidentally press." On a row
                          whose figure was typed (`done`) the tick used to be
                          inert for exactly the reason above, and an inert
                          filled tick is a stuck one. The second tap now HOLDS
                          the set — see `held` on the Row type: the figures stay
                          where they are, the set stops counting, and a third
                          tap counts it again. `sheetTick` is still asked what
                          the boxes say; `held` only decides whether a row the
                          boxes call saveable is one the coach has taken back. */}
                      {(() => {
                        const tick = sheetTick(s.target, s.reps);
                        const held = !!s.held && willSave(tick);
                        const on = willSave(tick) && !held;
                        const tappable = isTappable(tick) || tick.state === 'done';
                        const where = `${movement(r.name)} set ${i + 1}`;
                        const press = () => {
                          tapLight();
                          if (held) { holdSet(r.key, i, false); startRest(r, i); return; }
                          if (tick.state === 'fill') { patchSet(r.key, i, { reps: String(tick.reps) }); startRest(r, i); return; }
                          // Out of a done state, either way, and its rest goes
                          // with it. `clear` empties the box because the tick is
                          // what filled it; `done` holds, because a person did.
                          dropRestFor(r.key, i);
                          if (tick.state === 'clear') patchSet(r.key, i, { reps: '' });
                          else holdSet(r.key, i, true);
                        };
                        return (
                          <Pressable
                            onPress={tappable ? press : undefined}
                            disabled={!tappable}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on, disabled: !tappable }}
                            accessibilityLabel={held
                              ? `${where} is unticked and will not be saved. Its figures are still in the boxes. Tap to count it again.`
                              : tick.state === 'done'
                                ? `${where} is done and will be saved. Tap to untick it; the figures stay in the boxes.`
                                : sheetTickLabel(tick, movement(r.name), i + 1)}
                            hitSlop={{ top: hitSlopFor(28), bottom: hitSlopFor(28), left: 6, right: 6 }}
                            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                            <View style={{
                              width: 26, height: 26, borderRadius: 13,
                              alignItems: 'center', justifyContent: 'center',
                              backgroundColor: on ? t.brand : 'transparent',
                              borderWidth: on ? 0 : hairline * 2,
                              // A control that cannot be pressed looks like one.
                              // The alternative — a tappable-looking circle that
                              // does nothing — reads as the app having failed,
                              // which is the same fault as a button with no
                              // handler.
                              borderColor: tappable ? t.ink3 : t.ring,
                            }}>
                              {on ? <Icon name="check" size={16} color={t.brandInk} /> : null}
                            </View>
                          </Pressable>
                        );
                      })()}
                      {/* ── taking one set off ────────────────────────────────
                          "Need to be able to remove a set from an exercise not
                          just able to delete the entire exercise."

                          Offered only from the second set on. At one set the
                          thing to remove is the exercise, and that control is
                          already at the top of the row saying so — a minus here
                          that emptied a movement would leave a named exercise
                          with nothing under it, which writes nothing and reads
                          as a fault. The spacer keeps the columns aligned so a
                          row does not jump sideways as sets come and go. */}
                      {r.sets.length > 1 ? (
                        <Pressable onPress={() => askRemoveSet(r.key, i, movement(r.name), s)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${movement(r.name)} set ${i + 1}`}
                          hitSlop={{ top: hitSlopFor(30), bottom: hitSlopFor(30), left: 7, right: 7 }}
                          style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="minus" size={16} color={t.ink3} />
                        </Pressable>
                      ) : (
                        <View style={{ width: 30 }} />
                      )}
                    </View>
                    {/* What the coach WROTE for this set, in their own words,
                        under the boxes they are typing into. It is a caption
                        and nothing else: never parsed, never written, and the
                        reason a reps box can legitimately be empty on a row
                        that was loaded rather than typed. */}
                    {/* Said in words beside the set it is about. An empty circle
                        next to two full boxes is otherwise a contradiction the
                        coach has to work out, and the consequence — this set
                        is not going into the record — is the one thing here
                        that must not be left to a shade of grey. */}
                    {s.held && counts({ ...s, held: false }) ? (
                      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 3 }}>
                        <View style={{ width: 46 }} />
                        <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>
                          Unticked, so this set will not be saved. The figures stay here. Tap the tick to count it again.
                        </Text>
                      </View>
                    ) : null}
                    {targetLine(s.target) ? (
                      <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: 3 }}>
                        <View style={{ width: 46 }} />
                        <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>{targetLine(s.target)}</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
                <Pressable onPress={() => addSet(r.key)} hitSlop={8} accessibilityRole="button"
                  style={{ paddingVertical: sp.sm, marginTop: 2 }}>
                  <Text style={{ ...ty.label, ...font('500'), color: t.brand }}>Add a Set</Text>
                </Pressable>
              </View>
              );
            })}

            {/* What is actually going to be saved, counted.
                The tick's whole meaning is "this set will be written", so the
                sheet owes the coach the total in the same terms — and it is the
                one thing a coach cannot see by scanning, because a row with an
                empty reps box looks exactly like a row with a full one until
                you read it. Null on an empty sheet: nought out of nought is not
                a fact about anybody's session. */}
            {(() => {
              const total = rows.reduce((n, r) => n + r.sets.length, 0);
              const saved = rows.reduce((n, r) => n + r.sets.filter(counts).length, 0);
              const heldN = rows.reduce((n, r) => n + r.sets.filter((st) => st.held && counts({ ...st, held: false })).length, 0);
              // `sheetTicksLine` speaks of sets that "have a rep count", which
              // is the whole story until a set is unticked — and then it is
              // false of exactly the sets it is there to account for. With one
              // held, the count is said in the tick's own terms instead.
              const line = heldN > 0 && total > 0
                ? `${num(saved)} of ${num(total)} sets are ticked and will be saved. ${heldN === 1 ? 'One you unticked keeps its figures' : `${num(heldN)} you unticked keep their figures`} on this sheet and will not be.`
                : sheetTicksLine(saved, total);
              return line ? (
                <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{line}</Text>
              ) : null;
            })()}

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
                  <Text style={{ ...ty.body, color: t.ink }}>Mark It Delivered</Text>
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
              {/* `disabled` as well as the `pointerEvents` above it. The
                  wrapper stops a thumb and says nothing to a screen reader, so
                  VoiceOver announced a live button through the whole save and
                  a second activation landed on it. */}
              <Cta wide
                disabled={!ready || busy}
                label={busy
                  ? 'Saving…'
                  : sessionId ? finishCta(markDelivered, true) : `Log to ${first}'s Record`}
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
        {/* ── the rest, where it can be seen from any row ──────────────────
            Under the scroll and above the tab bar, inside the keyboard's own
            view so it rides up with it: the coach typing the next set's load
            is exactly the person who needs to see the rest running out. Keyed
            by the rest's generation, so a new rest is a new countdown with no
            memory of the last one's final seconds — the runner resets the same
            thing by hand in `startRest`. */}
        {rest && isLive ? (
          <RestBar key={rest.gen} t={t} endsAt={rest.endsAt}
            title={`${movement(rest.name)} · Set ${rest.setIdx + 1}`}
            note={rest.fromPlan ? 'Rest from your program' : `App default of ${DEFAULT_REST_SEC} seconds`}
            onAdd={() => setRest((cur) => (cur && cur.gen === rest.gen ? { ...cur, endsAt: cur.endsAt + 15000 } : cur))}
            onSkip={() => setRest((cur) => (cur && cur.gen === rest.gen ? null : cur))}
            onDone={() => setRest((cur) => (cur && cur.gen === rest.gen ? null : cur))} />
        ) : null}
      </KeyboardAvoidingView>

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setPicker(false)}
            accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[sheet, { maxHeight: '82%' }]}>
            <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Add Exercise</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.lg }}>
              <TextInput value={custom} onChangeText={setCustom} placeholder="Custom exercise name"
                placeholderTextColor={t.ink3} style={[inp, { flex: 1 }]} accessibilityLabel="Custom exercise name" />
              <Cta label="Add" onPress={() => {
                const nm = canonicalExerciseName(custom, cat.rows);
                if (!nm) return;
                addExercise(nm);
                // Remembered for next time, exactly as the program builder does
                // — and remembered under the catalogue's spelling, so the saved
                // list stops accumulating a second name for a movement that
                // already has one.
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
                Your saved exercises came back short. There are more of them than are listed here.
              </Text>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {mergeExerciseLists(coachEx.saved, LIB).map((x, i) => (
                <Pressable key={x.name} onPress={() => addExercise(x.name)}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, flex: 1 }}>
                    <ExerciseThumb uri={thumbFor(stillFor(x.name) ?? { thumbPath: null })} t={t} size={40} />
                    <Text style={{ ...ty.body, ...font('500'), color: t.ink, flex: 1 }}>{movement(x.name)}</Text>
                  </View>
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

/**
 * Elapsed time since `from`, redrawn once a second.
 *
 * Read off the wall clock on every draw rather than counted up, so a phone that
 * spent ten minutes in a pocket — where iOS runs no intervals at all — shows the
 * right figure the moment it comes back out. Its own component so that the
 * second hand redraws one line and not the form around it.
 */
function SessionClock({ from, ink }: { from: number; ink: string }) {
  const [, setBeat] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setBeat((b) => b + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((Date.now() - from) / 1000));
  // `restClock` is minutes and seconds, which is right for a rest and reads
  // "75:03" for a session that has run over; the hour is split off in front.
  const hrs = Math.floor(secs / 3600);
  const face = hrs > 0 ? `${hrs}:${restClock(secs % 3600).padStart(5, '0')}` : restClock(secs);
  return (
    // The hero figure, shrinking to one line rather than wrapping: "1:15:03"
    // at a large text size is wider than the strip's text column.
    <Text accessibilityLabel={`Session clock, ${face}`} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
      style={{ ...ty.hero, color: ink, ...numeric }}>{face}</Text>
  );
}

/**
 * The rest countdown: a slim bar with the digits, what it is resting from,
 * where the figure came from, +15s and Skip.
 *
 * The cues are the member runner's, made by the same calls for the same
 * reasons (app/(client)/workouts.tsx): a light tap and `restOver` on the
 * TRANSITION to zero, once, guarded by a ref because a cue must happen exactly
 * as often as the thing it announces; `countdown` on three, two and one, decided
 * by `shouldTick`, which is what stops a 500 ms interval that reads each second
 * twice from ticking twice. `playSound` asks the sound switch itself.
 *
 * What the runner has and this does not is the OS alert for a rest that ends
 * with the app in a pocket. The member puts the phone down to lift; the coach
 * is holding theirs.
 */
function RestBar({ t, endsAt, title, note, onAdd, onSkip, onDone }: {
  t: ReturnType<typeof useTheme>; endsAt: number; title: string; note: string;
  onAdd: () => void; onSkip: () => void; onDone: () => void;
}) {
  const leftAt = (end: number) => Math.max(0, Math.ceil((end - Date.now()) / 1000));
  const [left, setLeft] = useState(() => leftAt(endsAt));
  // Read through refs by an interval armed once: +15s moves `endsAt` under a
  // running countdown, and the parent hands a fresh `onDone` on every render.
  const endRef = useRef(endsAt);
  endRef.current = endsAt;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const prevLeft = useRef<number | null>(null);
  const over = useRef(false);
  // What the bar drains FROM. This component is keyed by the rest's generation,
  // so the first reading is the whole rest; +15s can push `left` past it, and
  // then the longer figure is the whole — a bar over 100% is a full bar that
  // does not move for fifteen seconds, which reads as a stuck timer.
  const total = useRef(Math.max(1, left));
  if (left > total.current) total.current = left;
  useEffect(() => {
    const id = setInterval(() => {
      if (over.current) return;
      const now = leftAt(endRef.current);
      if (now === 0) {
        over.current = true;
        tapLight();
        playSound('restOver');
        doneRef.current();
      } else if (shouldTick(now, prevLeft.current)) {
        playSound('countdown');
      }
      prevLeft.current = now;
      setLeft(now);
    }, 500);
    return () => clearInterval(id);
  }, []);
  return (
    /* Night, like the session clock it belongs to, with the rest as a BRIGHT
       bar that drains: the digits say how long, the bar says how much of it is
       left, and the second is what is read from two metres away. The bar is a
       picture of the digits beside it and is hidden from a screen reader, which
       is given the sentence. */
    <View style={{
      flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.md,
      paddingHorizontal: layout.gutter, paddingTop: sp.sm, paddingBottom: sp.md,
      backgroundColor: t.night,
    }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={{ width: '100%', height: 8, borderRadius: 4, backgroundColor: t.night2, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round((left / total.current) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: t.brandBright }} />
      </View>
      <View accessible accessibilityLabel={`Rest, ${restClock(left)} left. ${title}. ${note}.`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, flex: 1, minWidth: 160 }}>
        <Text style={{ ...ty.display, color: t.nightInk, ...numeric }}>{restClock(left)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.caption, ...font('600'), color: t.nightInk }}>Rest · {title}</Text>
          <Text style={{ ...ty.caption, color: t.nightInk2 }}>{note}</Text>
        </View>
      </View>
      <Ghost label="+15s" a11yLabel="Add fifteen seconds to this rest" onPress={() => { onAdd(); tapLight(); }} />
      <Ghost label="Skip" a11yLabel="Skip the rest of this rest" onPress={() => { onSkip(); tapLight(); }} />
    </View>
  );
}
