// One exercise, explained — and, since the redesign, performed.
//
// Reported by a trainer: "when an instructor has not provided a video for the
// exercise there should be an automation of the exercise being demo'd." Until
// now a movement with no coach clip was a dead end — the library said "No clips
// yet" and that was the whole of it, for every exercise, because the video
// table has never held a single row.
//
// ── What wins, in order ────────────────────────────────────────────────────
//
//   1. the client's OWN coach's clip — a member should see the person who
//      actually trains them demonstrating the lift;
//   2. the platform Academy clip;
//   3. the bought animation for this movement;
//   4. the catalogue's reference frames, cross-faded;
//   5. a sentence saying there is nothing, and offering to ask their coach.
//
// Rules 1 and 2 come from videoForExercise(), which already refuses to fall
// back to a stranger's clip. Rule 3 is what this screen adds. Rule 4 is the one
// that must never be dressed up as rule 3: a placeholder silhouette shown where
// we have no picture is a lie a client acts on under load.
//
// ── The three views (approved board, client pages 4, 5 and 6) ──────────────
//
// The board draws this screen three ways and the member moves between them
// without leaving it:
//
//   ready   page 4 — the movement's name, its prescription, the demonstration,
//           and three round controls: start a set, watch the demo, pick another
//           movement. Everything else the screen has always carried (the
//           coach's cue, the quick log row, the member's own trail) sits below
//           the fold in the same order it always did.
//   demo    page 5 — the same demonstration over the written steps, the
//           muscles, the tips and the catalogue's filing.
//   set     page 6 — a clock as the figure, the movement, "Set n of N", reps
//           and load as two big boxes, one green Complete Set and a plain Skip.
//
// The set view is a tracker, not a second log path: a set completed there is
// written through the same `logWorkouts` as the row below it, with the same
// three outcomes said out loud, the same bodyweight and timed flags, the same
// personal-record guards the guided runner in app/(client)/workouts.tsx uses,
// and the runner's rest countdown. What it does NOT know is the programme —
// this screen is opened by a movement's name, so the sets and reps it prints
// are the ones handed to it on the route (`sets`, `reps`), and when nothing was
// handed over it says what the member did last time rather than inventing a
// prescription.
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
// expo-image is required through src/ui/nativeModules.ts, never imported. Its
// entry point resolves to `requireNativeModule('ExpoImage')`, which THROWS on a
// binary that predates the dependency — and expo-image landed on 30 Aug, three
// days after the version last moved to 1.1.0, so every binary built 27-29 Aug
// takes today's bundle and has no ExpoImage in it. A bare import would take
// this whole screen down while it loaded. React Native's own <Image> is the
// fallback and is in every binary ever built.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from 'react-native';
import { GuardedImage } from '../../src/ui/GuardedImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useBackTo } from '../../src/ui/backTo';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Section, SectionHead, Notice, Ghost, PageHead, Flag, fig, TonedChip, IconPlate, HeroRing, CtaBright, Spark, ChartShell, Expandable } from '../../src/ui/kit';
import { sp, layout, radius, elevation, font, type as ty, value } from '../../src/theme/scale';
import { useExerciseDetail } from '../../src/ui/exerciseDetail';
import { ExerciseMuscles, groupTone } from '../../src/ui/ExerciseMuscles';
import { BACK_ICON } from '../../src/ui/direction';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
// The demonstration renderers moved to src/ui/ExerciseDemo when the owner app
// gained an exercise screen of its own: one implementation, imported twice, so
// two members of the same gym looking at the same lift on two apps cannot end
// up seeing two different pieces of artwork.
import { DemoAnimation, FrameLoop } from '../../src/ui/ExerciseDemo';
import { videoForExercise } from '../../src/lib/exerciseId';
import { catalogueValue as cap } from '../../src/lib/format';
import { frameUrls, FRAMES_ARE_UNHOSTED, demoCaption, demoIsShippable, DEMO_BUCKET, evalAnimationUrl } from '../../src/lib/exerciseMedia';
import { supabase } from '../../src/lib/supabase';
import { useClientData } from '../../src/ui/clientData';
import { RepdbInlineCredit } from '../../src/ui/Attribution';
import { useExerciseMedia } from '../../src/ui/useExerciseMedia';
// The two things this screen could not do, and they are the two things somebody
// standing in front of the machine actually wants. `ExerciseHistoryPanel` was
// mounted on app/(client)/history.tsx and on the coach's client-training screen
// and nowhere else, so "what did I do on this last time" was three screens away
// from the movement; and the set row was a local component on Train, so this
// screen — the one reached from the library, from a demo, from a search — could
// not log anything at all.
import { ExerciseTrail } from '../../src/ui/ExerciseHistory';
import { LogSetRow, SetKindChip, type LoggedSet } from '../../src/ui/LogSetRow';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useScrollPad } from '../../src/ui/keyboardPad';
import { pickFormClip, sendFormClip, fetchFormClip, deleteFormClip, type FormClip } from '../../src/ui/formClips';
import { MEMBER_CONSENT_NOTE, clipRefusal, clipRefusalLine } from '../../src/lib/formCheck';
import { useSettings } from '../../src/ui/settings';
import { exerciseIndex, exerciseOutings } from '../../src/lib/exerciseHistory';
import { bestSetLabel } from '../../src/lib/bestSet';
import { exerciseSlug } from '../../src/lib/exerciseId';
// What this member's own coach says about this movement, every time, to
// everybody they train. Separate from the note on a particular programme day,
// which is about this member on that day and arrives with the programme.
import { fetchCoachCue, cueFor, type CueRead } from '../../src/lib/coachCues';
import { reportError } from '../../src/lib/reportError';
import { USE_SUPABASE } from '../../src/lib/config';
import { unsentNote } from '../../src/lib/offlineQueue';
import { tapLight } from '../../src/ui/haptics';
// ── the tracker's own dependencies ───────────────────────────────────────
// Every one of these is the same module the guided runner reads, on purpose:
// the rest clock, the countdown ticks, the estimated 1RM a record is judged on
// and the coach's notification of it. A second definition of any of them would
// be a second answer to "what is a personal record", and the runner's own
// comments explain at length why there must be exactly one.
import { isWhole } from '../../src/ui/loadStatus';
import { plain, liftIn, liftLabel, readLift, est1RMIn } from '../../src/lib/units';
import { readHold, setListLabel, isTimedPrescription } from '../../src/lib/timedSets';
import { est1RM } from '../../src/lib/streaks';
import { priorBest1RM } from '../../src/lib/progression';
import { announcePersonalBest } from '../../src/lib/prNotifyStore';
import { DEFAULT_REST_SEC, restClock, shouldTick } from '../../src/lib/restTimer';
import { playSound } from '../../src/ui/sounds';
import { Confetti } from '../../src/ui/Confetti';
import { injuryFlag } from '../../src/lib/injuries';
import type { WorkoutEntry } from '../../src/lib/mockData';

/** Which of the board's three drawings of this screen is up. */
type ExerciseView = 'ready' | 'demo' | 'set';

export default function ExerciseScreen() {
  const t = useTheme();
  const router = useRouter();
  // `sets` and `reps` are the prescription, when the screen that opened this
  // one had a programme to hand over. They are strings off the route and are
  // only ever printed or counted — never written into a set. Absent means "no
  // prescription", not "0 sets", and the screen then says what was done last
  // time instead.
  const { name: raw, from, sets: setsParam, reps: repsParam } = useLocalSearchParams<{ name?: string; from?: string; sets?: string; reps?: string }>();
  const goBack = useBackTo(from);
  const name = (raw || '').trim();
  const { detail, display, status, signedOut, reload: reloadDetail } = useExerciseDetail(name);
  // `status`, not just `videos`. exerciseVideos.ts says so in as many words:
  // "`[]` with status 'error' is not the same claim as `[]` with status
  // 'ready', and the screens must not conflate them." This screen conflated
  // them — a failed video read left `clip` null, fell through to the last
  // branch below, and told a client "Nobody has filmed this movement" about a
  // clip their coach uploaded last week. The catalogue read already had its own
  // error branch; the video read had none.
  const { videos, status: videoStatus, reload: reloadVideos } = useExerciseVideos();
  const cd = useClientData();

  // The client's own coach first. cd.trainerId is who actually trains them, so
  // passing it is what stops a stranger's clip being offered as theirs.
  //
  // It was read through a cast to `any` until tonight, and `useClientData` had
  // no such field: every member got `null`, and rule 1 of the clip ordering —
  // the member's OWN coach's clip wins — could not fire at all, for months,
  // with nothing failing anywhere. The field is real now (src/ui/clientData.tsx)
  // and the cast is gone, which is what stops it vanishing again silently: a
  // rename is a type error now rather than a quiet null. The dependency is
  // `cd.trainerId` and not `cd` because that is the only part of the context
  // this memo reads, and the context object's identity changes whenever any
  // unrelated field of the profile does.
  const clip = useMemo(
    () => videoForExercise(name, videos, cd.trainerId),
    [name, videos, cd.trainerId],
  );
  // The bought animation, signed like a coach's own clip.
  //
  // Gated on the licence recorded against the row, not on anything this screen
  // knows: an evaluation asset from a CC BY-NC preview bundle renders while
  // somebody is deciding whether to buy the pack, and never in a build that
  // reaches a real person. __DEV__ is the only thing that distinguishes them,
  // and it is the one flag that cannot be wrong in a release binary.
  // One hook for all three apps. Media resolution lived in each screen and
  // that is the shape that already produced a client app and a coach app
  // disagreeing about the name of a muscle — worse here, because a picture
  // that fails to resolve is an empty box with no error to read.
  const { frames, animUrl, animCacheKey, equipmentUrl } = useExerciseMedia(detail);
  const caption = demoCaption(detail?.source, frames.length);

  // ── this member's own record of this movement ──────────────────────────
  const { log, status: logStatus, unsent: unsentSets, logWorkouts, reload: reloadLog } = useWorkoutLog();
  /* ── a clip of the set just logged ───────────────────────────────────────
     Offered HERE and not on Train, because this screen is already about one
     movement — which is exactly when somebody wonders whether they are doing
     it right. The set logged from this screen is its own `workouts` row with a
     single set, so the clip's (workout_id, set_index) is that row and 0.

     Held by timestamp and name rather than by id, because the id does not
     exist yet at the moment it is logged: `send` in src/ui/workoutLog.tsx
     adopts the server's id into the entry a moment after the write lands, and
     this looks it up when it is there. Until then the block says it is still
     saving rather than offering a button that would attach to nothing. */
  const pad = useScrollPad();
  const [clipFor, setClipFor] = useState<{ t: string; exercise: string } | null>(null);
  const [clipNote, setClipNote] = useState('');
  const [clipBusy, setClipBusy] = useState(false);
  const [clipSaid, setClipSaid] = useState<string | null>(null);
  /* The clip now on that set, once one is there. Held so the member can remove
     it — `MEMBER_CONSENT_NOTE` promises they can delete it at any time, and a
     promise with no control behind it is worse than not making it. */
  const [clipSent, setClipSent] = useState<FormClip | null>(null);
  const clipWorkoutId = clipFor
    ? (log.find((e) => e.t === clipFor.t && e.exercise === clipFor.exercise)?.id ?? null)
    : null;
  /* ── this member's coach's cue for this movement ─────────────────────────
   *
   * No coach id is sent, and that is the security property rather than a
   * convenience: the select policy in supabase/parts/3150 admits exactly the
   * rows whose `coach_id` is the trainer of the signed-in client, so there is
   * no argument this screen could carry that would widen it to a stranger's
   * cues. (`cd.trainerId` is read a hundred lines above for the clip. It used
   * to be cast through `any`, did not exist on `useClientData`, and was always
   * null; both are fixed. Nothing here depends on it either way.)
   *
   * ── This read must not be able to take the screen down ─────────────────
   *
   * supabase/parts/3150 is not applied to any database as this ships, and
   * PostgREST answers a select naming a table absent from its schema cache
   * with PGRST205 — measured against this project's own REST endpoint. So the
   * read is not attempted at all without a server, and where it is attempted
   * `fetchCoachCue` turns that code (and 42P01) into 'absent' and throws
   * everything else. 'absent' draws NOTHING: there is no cue to show and no
   * sentence is owed to a member about a feature their coach has not been
   * given yet. A read that genuinely failed is held as `cueFailed` and says so
   * rather than being rendered as a coach who wrote nothing — because "your
   * coach left no cue" is a claim about their coach.
   */
  const [cue, setCue] = useState<CueRead | null>(null);
  const [cueFailed, setCueFailed] = useState(false);
  const reloadCue = useCallback(async () => {
    if (!USE_SUPABASE || !name) { setCue(null); setCueFailed(false); return; }
    setCueFailed(false);
    try {
      setCue(await fetchCoachCue(supabase, name));
    } catch (e) {
      reportError('clientExercise.cue', e);
      // Null and not an empty read. An empty read would render as "your coach
      // has written nothing", which is a statement about their coach made from
      // a request that never came back.
      setCue(null); setCueFailed(true);
    }
  }, [name]);
  useEffect(() => { setCue(null); void reloadCue(); }, [reloadCue]);
  const coachCue = cue ? cueFor(cue, name) : null;

  // Four reads: the movement itself, the coach's clips for it, the coach's own
  // cue, and this member's own history of the lift underneath. The cue is in
  // here because the sentence shown when it fails tells them to pull down.
  const pull = usePullToRefresh(useCallback(() => {
    void reloadDetail(); void reloadVideos(); reloadLog(); void reloadCue();
  }, [reloadDetail, reloadVideos, reloadLog, reloadCue]));
  const wu = useSettings().weightUnit;
  // The member's weight over time, so a set of pull-ups is priced at the body
  // that did them rather than left out of every figure on the panel below. An
  // empty series is not an error — see src/lib/bodyweightSets.ts.
  const weightSeries = cd.weightSeries;
  const slug = exerciseSlug(name);
  // Built from the whole log rather than from a filtered one, because the index
  // is what knows whether a movement was logged with no sets against it at all
  // — the cardio case, which reads as "never done" if it is filtered out first.
  // The read is handed in with the log. `useWorkoutLog` asks for this member's
  // whole `workouts` table with no date bound, so the window is null and the
  // day count on the trail below is a fact about them; `logStatus` still
  // carries truncation on its own.
  const summary = useMemo(
    () => (slug
      ? exerciseIndex(log, weightSeries, { status: logStatus, windowDays: null }).find((e) => e.slug === slug) ?? null
      : null),
    [log, weightSeries, slug, logStatus],
  );
  /* ── the movement's best set, day by day ─────────────────────────────────
     The picture over the trail: each dated day's best set as its estimated
     1RM — `best1RMKg`, the figure src/lib/exerciseHistory.ts already folds per
     outing through the app's one Epley — oldest first, in the member's unit.
     A bodyweight or held day has no such figure and stays NULL, which Spark
     draws as a gap rather than a dip to nought. An undated outing is left out:
     a point needs a place on the axis and src/lib/chartAxis.ts will not invent
     one. Whether any of this is drawn at all is ChartShell's decision below,
     on `logStatus` — a line through half a log is a wrong line. */
  const bestSeries = useMemo(() => {
    const days = exerciseOutings(log, name, weightSeries).filter((o) => o.day != null).reverse();
    let top: (typeof days)[number] | null = null;
    for (const o of days) if (o.best1RMKg != null && (top == null || o.best1RMKg > (top.best1RMKg ?? 0))) top = o;
    return {
      data: days.map((o) => est1RMIn(o.best1RMKg, wu)),
      labels: days.map((o) => o.day as string),
      points: days.filter((o) => o.best1RMKg != null).length,
      top: top?.bestSet ?? null,
    };
  }, [log, name, weightSeries, wu]);
  const [saving, setSaving] = useState(false);

  // The identity a set is written under: the catalogue's spelling once the
  // movement has been looked up, and the route's until then.
  const exName = detail?.name || name;

  /* ── what was done last time ─────────────────────────────────────────────
     The newest entry of this movement that carries sets, read straight off the
     log rather than through `exerciseOutings`, and for one reason: an outing
     prices a bodyweight set at the person's own weight, which is right for a
     tonnage and wrong for a box the member is about to type a barbell load
     into. The raw row still carries what was actually typed — the added load
     and the two flags — and that is what the tracker opens on.

     A prefill is a convenience and not a claim, so a truncated read is allowed
     to supply one: the set it names was genuinely done. What it is never used
     for is a figure on the page — "Set n of N" comes from the route or from
     nothing. */
  const lastEntry = useMemo(() => {
    if (!slug) return null;
    let newest: WorkoutEntry | null = null;
    for (const e of log) {
      if (!e.sets?.length || exerciseSlug(e.exercise) !== slug) continue;
      if (!newest || e.t > newest.t) newest = e;
    }
    return newest;
  }, [log, slug]);
  const lastSets = lastEntry ? setListLabel(lastEntry, (kg) => fig(liftIn(kg, wu)), wu) : null;

  /* ── the prescription, if one arrived ────────────────────────────────────
     Counted only when it is a positive whole number; "3 sets" is a promise the
     page makes about the programme, and a route carrying "abc" or "0" has not
     made it. `reps` is left as the coach wrote it — "8-12", "AMRAP", "45 sec"
     — because rewriting it is how a hold became forty-five repetitions once
     already (src/lib/timedSets.ts). */
  const plannedSets = (() => { const n = parseInt((setsParam || '').trim(), 10); return Number.isFinite(n) && n > 0 ? n : null; })();
  const plannedReps = (repsParam || '').trim() || null;
  const prescription = plannedSets && plannedReps
    ? `${plannedSets} set${plannedSets === 1 ? '' : 's'} × ${plannedReps}${isTimedPrescription(plannedReps) ? '' : ' reps'}`
    : plannedSets
      ? `${plannedSets} set${plannedSets === 1 ? '' : 's'}`
      : lastSets
        ? `Last time · ${lastSets}`
        : [detail?.group, detail?.equipment].filter((x): x is string => !!x).map(cap).join(' · ') || null;

  /* ── the set tracker (board page 6) ──────────────────────────────────────
     Two clocks share one figure. While a set is being done it counts UP from
     the moment Start (or the previous rest ending) was pressed; once a set is
     completed it counts DOWN the rest, and when that reaches zero the next
     set's clock starts on its own. Both are wall-clock instants held in refs
     and read by one interval, exactly as the runner does it, so a phone that
     goes in a pocket comes back showing the truth rather than however many
     ticks JavaScript was allowed. */
  const [view, setView] = useState<ExerciseView>('ready');
  const [setNo, setSetNo] = useState(1);
  const [repsText, setRepsText] = useState('');
  const [loadText, setLoadText] = useState('');
  const [bwOn, setBwOn] = useState(false);
  const [timedOn, setTimedOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState(0);
  const setStartedAt = useRef<number | null>(null);
  const restEndsAt = useRef<number | null>(null);
  const prevLeft = useRef<number | null>(null);
  // The loaded, repped sets completed on THIS visit. A record is judged against
  // the whole history AND against these, because a set we watched happen a
  // minute ago is part of what "best ever" means even before the write lands.
  const doneHere = useRef<{ reps: number; kg: number }[]>([]);
  const [prMsg, setPrMsg] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const inSet = view === 'set';
  const pastPlan = plannedSets != null && setNo > plannedSets;

  useEffect(() => {
    if (!inSet) return;
    const id = setInterval(() => {
      const now = Date.now();
      const end = restEndsAt.current;
      if (end != null) {
        const left = Math.max(0, Math.ceil((end - now) / 1000));
        // Fired on the TRANSITION and tracked in refs, for the runner's reason:
        // a haptic and a chime are side effects that must happen exactly as
        // often as the thing they announce, and an interval reads the same
        // second more than once. playSound refuses on its own when the member
        // has the sound switched off, so nothing here reads the preference.
        if (left === 0) {
          restEndsAt.current = null;
          prevLeft.current = null;
          tapLight();
          playSound('restOver');
          // The next set's clock starts as the rest ends — the member is
          // looking at the bar, not at a Start button.
          setStartedAt.current = now;
          setElapsed(0);
        } else if (shouldTick(left, prevLeft.current)) {
          playSound('countdown');
        }
        prevLeft.current = left;
        setRest(left);
        return;
      }
      const from = setStartedAt.current;
      setElapsed(from == null ? 0 : Math.floor((now - from) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [inSet]);

  /** Open set `i` (0-based) on what the same set held last time, if it was done. */
  const prefill = (i: number) => {
    const s = lastEntry?.sets?.[i];
    if (!lastEntry || !s) return;
    setRepsText(String(Number(s[0]) || ''));
    // A load that was never written down stays an empty box, not a 0 kg lift:
    // the third state is carried as null until the box is drawn.
    const kg = s[1] == null ? null : Number(s[1]);
    const shown = kg != null && Number.isFinite(kg) && kg > 0 ? liftIn(kg, wu) : null;
    setLoadText(shown != null ? plain(shown) : '');
    setBwOn(!!lastEntry.bw?.[i]);
    setTimedOn(!!lastEntry.timed?.[i]);
  };
  const startSets = () => {
    setSetNo(1);
    doneHere.current = [];
    setPrMsg(null);
    restEndsAt.current = null; prevLeft.current = null; setRest(0);
    setStartedAt.current = Date.now(); setElapsed(0);
    prefill(0);
    setView('set');
    tapLight();
  };
  const leaveSets = () => {
    setStartedAt.current = null; restEndsAt.current = null; prevLeft.current = null;
    setRest(0);
    setView('ready');
  };
  const skipRest = () => {
    restEndsAt.current = null; prevLeft.current = null; setRest(0);
    setStartedAt.current = Date.now(); setElapsed(0);
  };
  /** Move to the next set, resting first when a set was actually done. */
  const advance = (afterASet: boolean) => {
    const next = setNo + 1;
    setSetNo(next);
    prefill(next - 1);
    // No rest after the last prescribed set — there is nothing to rest for,
    // and a countdown under "Finish" is a countdown to nothing.
    if (afterASet && !(plannedSets != null && next > plannedSets)) {
      restEndsAt.current = Date.now() + DEFAULT_REST_SEC * 1000;
      prevLeft.current = null;
      setRest(DEFAULT_REST_SEC);
      setStartedAt.current = null; setElapsed(0);
    } else {
      restEndsAt.current = null; prevLeft.current = null; setRest(0);
      setStartedAt.current = Date.now(); setElapsed(0);
    }
  };

  /* ── one set, written ────────────────────────────────────────────────────
     Shared by the quick row below the fold and the tracker's Complete Set, so
     the two cannot drift on what "saved" means. It writes through the same
     provider Train does, so a set logged here is the same row, on the same
     timestamp discipline, with the same three outcomes said out loud — a set
     the server refused is not in anybody's log and must never be reported as
     one. */
  const logOne = async (set: LoggedSet): Promise<'stored' | 'unsent' | 'refused' | 'busy'> => {
    if (saving) return 'busy';
    setSaving(true);
    try {
      const at = new Date().toISOString();
      const out = await logWorkouts([{
        t: at,
        exercise: exName,
        sets: [[set.value, set.kg ?? 0]],
        ...(set.bw ? { bw: [true] } : {}),
        ...(set.timed ? { timed: [true] } : {}),
      }]);
      if (out === 'stored') {
        tapLight();
        // Offered only after the set is actually on the server.
        // A clip attached to a set that is still queued would
        // have no row to hang off.
        setClipFor({ t: at, exercise: exName });
        setClipNote('');
        setClipSaid(null);
        // And the clip held from the PREVIOUS set, or the Delete
        // control below would still be pointing at it. `clipSent`
        // is a row, not a flag: `deleteFormClip(clipSent)` acts on
        // whichever (workout_id, set_index) is in it, so leaving
        // last set's row here put a "Delete It" button under the
        // block that has just been opened for a NEW set — and
        // pressing it deleted the earlier set's clip while the
        // screen said "Deleted" about this one. A destructive
        // control must never outlive the thing it was built for.
        setClipSent(null);
        return 'stored';
      }
      if (out === 'unsent') {
        Alert.alert('Saved on this phone',
          'No connection, so this set has not reached your training log yet — nothing is lost. It is saved here and goes up on its own next time you have signal.');
        return 'unsent';
      }
      Alert.alert('Not saved',
        'Your training log rejected this set, so it has not been recorded and it is not waiting to send.');
      return 'refused';
    } finally { setSaving(false); }
  };

  /* ── a personal record, judged the runner's way ──────────────────────────
     Zero for a bodyweight set, on purpose: `priorBest1RM` reads a set's second
     number as the load, so a whole history of pull-ups reads there as zeros
     and a real bodyweight load compared against it would fire "New PR!" on
     every set of every calisthenics session forever. Never for a hold either —
     Epley over seconds is a strength figure computed from a stopwatch.

     And only when the WHOLE history was read. `priorBest1RM` over an unread
     log returns 0, and every set beats 0, so a failed read would turn the first
     set into a record with confetti, mid-workout, in front of a coach. Under
     'partial' the record it is compared against may be in the half that did
     not arrive. The coach is told from inside the same branch so every guard
     is inherited by the notification for free — see the runner for why that
     placement is the whole design. */
  const checkRecord = (set: LoggedSet) => {
    const wkg = set.kg ?? 0;
    const r = set.value;
    if (!wkg || !r || set.bw || set.timed) return;
    const newE1 = est1RM(wkg, r);
    const historyWhole = isWhole(logStatus);
    const priorBest = Math.max(
      historyWhole ? priorBest1RM(log, exName) : 0,
      ...doneHere.current.map((s) => est1RM(s.kg, s.reps)),
      0,
    );
    if (historyWhole && newE1 > 0 && newE1 > priorBest) {
      // `wkg` is a positive finite load here, so `liftLabel` has a figure for it;
      // the guard is for the type, not for a dash in a sentence.
      const lifted = liftLabel(wkg, wu);
      setPrMsg(lifted ? `New PR on ${exName}! ${lifted} × ${r}` : `New PR on ${exName}!`);
      setConfetti(true);
      void announcePersonalBest(
        cd.trainerId,
        cd.id === 'unknown' ? null : cd.id,
        { movement: exName, kg: wkg, reps: r },
        cd.profileStatus === 'ready' ? cd.name : null,
      );
    }
    doneHere.current.push({ reps: r, kg: wkg });
  };

  /* ── Complete Set ────────────────────────────────────────────────────────
     The reps check, `readHold` and `readLift` are the ones LogSetRow applies,
     in the same words, so a hold or a load this screen accepts in the row it
     also accepts in the tracker. LogSetRow's own header explains why a third
     copy of these guards is a risk; it is taken here because the board's two
     big boxes cannot be that row, and the guards themselves live in pure
     modules the row and this share. */
  const completeSet = async () => {
    let v: number;
    if (timedOn) {
      const held = readHold(repsText);
      if (!held.ok) { Alert.alert('How long was the hold?', held.reason); return; }
      v = held.secs;
    } else {
      const r = parseInt(repsText, 10);
      if (!Number.isFinite(r) || r <= 0) {
        Alert.alert('How many reps?', `Type the reps you did before completing the set. The ${wu} box can stay empty for a bodyweight set.`);
        return;
      }
      v = r;
    }
    const read = readLift(loadText, wu);
    // Left in the box on a refusal, with the reason said, rather than cleared
    // — the number was typed once and the app has no better guess.
    if (!read.ok) { Alert.alert('Check that load', read.reason); return; }
    // An empty load box IS a bodyweight set. Recorded rather than inferred
    // later: a stored 0 cannot be told apart from a load nobody typed.
    const set: LoggedSet = { value: v, kg: read.kg, bw: bwOn || read.kg == null, timed: timedOn };
    const out = await logOne(set);
    // A queued set was done and is on the phone; a refused one was not
    // recorded anywhere and the tracker stays on it.
    if (out === 'stored' || out === 'unsent') { checkRecord(set); advance(true); }
  };

  const G = layout.gutter;
  const chips = [detail?.equipment, detail?.level, detail?.mechanic, detail?.force]
    .filter((x): x is string => !!x)
    .map(cap);

  /* ── the written guide: the steps, the cues, and the muscles on the body ─
     ONE element, drawn by the ready view and the demo view alike. It was the
     demo view's alone, so a member who opened a movement from the library and
     never pressed the play control got the demonstration and nothing about
     how to do it — reported in those words: "the exercises are missing the
     tips and instructions on how to do the exercise". Sharing the element is
     what stops the two views drifting apart the next time one is edited.

     "Muscles Worked" is the body, not a line of words: the same figure the
     Training Summary draws on, lit with the catalogue's primary and secondary
     lists, and the words underneath it. src/ui/ExerciseMuscles.tsx says what
     that picture does and does not claim. */
  const guide = detail ? (
    <>
      {/* The picture leads the written guide: WHERE the movement lands is
          read at a glance and the steps are read once. Gated on the catalogue
          naming SOMETHING. A row that names no muscles is a gap in the
          catalogue, and a heading over an empty body would state the movement
          works nothing. */}
      {detail.primaryMuscles.length || detail.secondaryMuscles.length ? (
        <Section>
          <SectionHead title="Muscles Worked" />
          <ExerciseMuscles primary={detail.primaryMuscles} secondary={detail.secondaryMuscles} status={status} />
        </Section>
      ) : null}

      {detail.instructions.length ? (
        <Section>
          <SectionHead title="Instructions" note={`${detail.instructions.length} step${detail.instructions.length === 1 ? '' : 's'}`} />
          {detail.instructions.map((step, n) => (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, marginBottom: sp.md }}>
              {/* The numeral on the accent's plate, in Sora: the step number is
                  how somebody finds their place again after looking up at the
                  bar, and a grey 15pt digit was the quietest thing in the row. */}
              <View style={{ minWidth: 30, minHeight: 30, borderRadius: radius.sm, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.xs }}>
                <Text style={{ ...value(15), color: t.brandText }}>{n + 1}</Text>
              </View>
              <Text style={{ ...ty.body, color: t.ink2, flex: 1, marginTop: 3 }}>{step}</Text>
            </View>
          ))}
        </Section>
      ) : status === 'ready' ? (
        <Section>
          <SectionHead title="Instructions" />
          {/* 41 of the original rows carry no instructions because nobody
              has confirmed which catalogue movement they are. Saying so
              is the point — an empty section would read as an app that
              forgot to render, not as a gap we know about. */}
          <Text style={{ ...ty.label, color: t.ink3 }}>
            No written steps for this one yet.
          </Text>
        </Section>
      ) : null}

      {/* ── coaching cues ────────────────────────────────────────────────
          Kept apart from the numbered steps rather than appended to them. A
          client following the sequence needs it in order; a client who
          already knows the movement wants the cue, and a cue buried at step
          six is a cue they have stopped reading before they reach. Amber
          plates, so the two lists are told apart before either is read. */}
      {detail.tips.length ? (
        <Section>
          <SectionHead title="Tips" note={`${detail.tips.length}`} />
          {detail.tips.map((tip, n) => (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, marginBottom: sp.md }}>
              <IconPlate icon="sparkle" tone="amber" size={30} />
              <Text style={{ ...ty.body, color: t.ink2, flex: 1, marginTop: 3 }}>{tip}</Text>
            </View>
          ))}
        </Section>
      ) : null}
    </>
  ) : null;

  /* ── the demonstration ─────────────────────────────────────────────────── */
  const demonstration = status === 'loading' ? (
    <View style={{ paddingVertical: sp.xl, alignItems: 'center' }}>
      <ActivityIndicator />
      <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>Looking this movement up…</Text>
    </View>
  ) : status === 'error' ? (
    <Notice tone={t.warn} kicker="Exercise" title="This could not be read"
      note="Nothing below is missing because it does not exist — we could not reach the catalogue. Try again once you have signal." />
  ) : clip ? (
    <ExerciseVideo video={clip} exerciseName={exName} />
  ) : animUrl ? (
    <>
      <DemoAnimation uri={animUrl} label={exName}
        // The stills, so the box is never empty while 1.6 MB of clip is on
        // its way, and so a clip that never arrives lands on the picture we
        // already had rather than on a hole.
        stillUrls={frames} cacheKey={animCacheKey ?? undefined} />
      {detail?.demoLicence !== 'commercial' ? (
        <View style={{ marginTop: sp.sm }}>
          <Flag tone={t.warn}>Evaluation asset — licensed for review only, never for release.</Flag>
        </View>
      ) : null}
    </>
  ) : frames.length ? (
    <>
      <FrameLoop urls={frames} label={exName} />
      {caption ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{caption}</Text>
      ) : null}
      {/* Beside the artwork, not two screens away. The licence asks for
          one visible credit and the Credits card in settings is it; this
          costs a line and is worth more where somebody is looking. */}
      {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
    </>
  ) : equipmentUrl ? (
    // A handful of catalogue rows name a machine rather than a movement
    // — Cable Machine, Ski Erg, Smith Machine — so there is no
    // illustration of "performing" them and never will be. A picture of
    // the kit is the useful thing to show, kept visibly apart from a
    // demonstration: still, not cross-faded, and captioned as equipment.
    <>
      <GuardedImage
        source={{ uri: equipmentUrl }}
        contentFit="contain"
        cachePolicy="disk"
        accessibilityLabel={`${exName}, equipment`}
        style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: t.surface2 }}
      />
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
        The equipment, not a demonstration — this is a machine rather than a movement.
      </Text>
      {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
    </>
  ) : (
    // No clip and no frames. Said plainly, with the one action that
    // actually changes it, rather than a grey silhouette implying a
    // demonstration we do not have.
    <Notice tone={t.ink3} kicker="Demonstration"
      // Sentence case. A <Notice title> is a sentence, not a label — it
      // renders at ty.head with no transform, and every other one in
      // app/(client) is written as prose, including the one on line 108
      // of this same file ("This could not be read"). With no clip and no
      // grant anywhere on the platform, this branch is the most-read
      // string in the product, and it was the only Title-Cased sentence
      // among them.
      title={videoStatus === 'loading' ? 'Looking for a clip…'
        : videoStatus === 'error' ? 'We couldn’t check for a clip'
        // 'partial' used to fall through to "No demonstration yet", which
        // is the same false claim the error arm below exists to refuse,
        // reached from a read that succeeded. The log half of this very
        // file already carries the third arm — see logStatus === 'partial'
        // further down — and the video half did not.
        : videoStatus === 'partial' ? 'We couldn’t check the whole library'
        : detail ? 'No demonstration yet' : signedOut ? 'Sign in to see this' : 'Not in our catalogue'}
      note={videoStatus === 'loading'
        ? 'Your coach’s video library is still being read.'
        : videoStatus === 'error'
        // "Nobody has filmed this" is a claim about the coach's library,
        // and a failed read of that library is not evidence for it.
        ? 'Your coach’s video library could not be read, so we cannot say whether there is a clip for this movement. There may well be one. The written guide is unaffected.'
        : videoStatus === 'partial'
        // A truncated read is not evidence for it either: the clip may be
        // one row past where the read stopped.
        ? 'There are more clips in your coach’s library than we can read at once, and none of the ones we read were for this movement. That is not a statement that nobody has filmed it. The written guide is unaffected.'
        : detail
        ? 'Nobody has filmed this movement and the catalogue has no reference frames for it. Your coach can add a clip from their app.'
        // Not "this movement is not in our catalogue" — that is a claim
        // about our data, and while signed out we have not been allowed
        // to look. The catalogue reads `to authenticated`, so a
        // signed-out session is handed zero rows with no error, which is
        // indistinguishable from an absent movement unless we say so.
        : signedOut
          ? 'The exercise library is only available once you are signed in, so this screen could not look this movement up. It is very likely in there.'
          : 'This movement is not in our catalogue, so there is no guide for it. If your coach wrote it into your program, ask them how they want it done.'} />
  );

  /* ── the demonstration as the page's hero ────────────────────────────────
     The mockups open a training page on a picture in a 24pt card under the
     hero shadow (ClientTrain's programme image), and the demonstration is this
     page's picture. Only a PICTURE gets the card: the loading line and the
     three "there is nothing to show, and why" notices are sentences, and a
     sentence in a hero frame reads as a demonstration that failed to load —
     the exact claim those notices exist to refuse. */
  // whole-ok: this only mirrors `demonstration`'s own first two arms to decide
  // whether a FRAME goes round it — no figure, count or "nothing here" hangs
  // off it, and a 'partial' detail read still holds a real picture to frame.
  const hasMedia = status !== 'loading' && status !== 'error' && !!(clip || animUrl || frames.length || equipmentUrl);
  const heroMedia = hasMedia ? (
    <View style={{ marginTop: sp.lg, backgroundColor: t.surface, borderRadius: radius.xl, padding: sp.sm, ...elevation.hero }}>
      {demonstration}
    </View>
  ) : (
    <View style={{ marginTop: sp.lg }}>{demonstration}</View>
  );

  /* ── how the catalogue files it, as chips ────────────────────────────────
     The muscle group in ITS tone — the same one the library's filter row and
     rows use, from src/ui/ExerciseMuscles.tsx — and the attributes in the
     neutral plate, so the one coloured chip is the one that names a group. */
  const chipRow = detail && (detail.group || chips.length) ? (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
      {detail.group ? <TonedChip label={detail.group} tone={groupTone(detail.group)} /> : null}
      {chips.map((c) => <TonedChip key={c} label={c} tone="neutral" />)}
    </View>
  ) : null;

  /* ── what your coach says about this one ─────────────────────────────────
     Drawn only when there IS a cue. Absence is silent on purpose:
     a member whose coach has written none, and a member whose gym has
     not had this switched on, are owed no sentence about a feature
     that is not theirs to use — and any sentence here would be a claim
     about their coach made from an empty answer. A read that FAILED is
     different and does say so, because the alternative is a member
     standing at the machine who is not shown the one thing their coach
     wanted them to remember and has no way to know. */
  // `onGround`: on the page's grey ground it is a card of its own, with the
  // card shadow, because surface2 is two points of grey from the ground and the
  // coach's one sentence was the faintest block on the page. Inside the set
  // view's card it stays the inset block it was.
  const cueBlock = (onGround: boolean) => coachCue ? (
    <View style={{ marginTop: sp.lg, padding: sp.lg, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'flex-start', gap: sp.md,
      ...(onGround ? { backgroundColor: t.surface, ...elevation.card } : { backgroundColor: t.surface2 }) }}>
      <IconPlate icon="message" tone="blue" size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.xs }}>From your coach</Text>
        <Text style={{ ...ty.body, color: t.ink }} accessibilityLabel={`From your coach: ${coachCue}`}>{coachCue}</Text>
      </View>
    </View>
  ) : cueFailed ? (
    <View style={{ marginTop: sp.lg }}>
      <Flag tone={t.ink3}>
        Your coach’s note for this movement could not be read just now. That is not a record that they have not
        written one — pull down to try again.
      </Flag>
    </View>
  ) : null;

  /* ── the injury caution, the runner's way ────────────────────────────────
     `cd.injuries` is `[]` under a failed read as well as under a member who
     has disclosed nothing, so no caution here would mean two different things
     and only one of them is "this movement is fine for you". The three arms
     are drawn apart for that reason. `isWhole`, not `!== 'error'`: 'partial'
     is an unread list, and half an injury list is not a softer thing. */
  const injuryLine = !isWhole(cd.profileStatus) ? (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: sp.md }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cd.profileStatus === 'loading' ? t.ink3 : t.crit, marginTop: 5 }} />
      <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>
        {cd.profileStatus === 'loading'
          ? 'Still reading what you have disclosed — this movement has not been checked against your injuries yet.'
          : 'Your injuries could not be read, so this movement has not been checked against them. Go easy if something is hurt.'}
      </Text>
    </View>
  ) : (() => {
    const f = injuryFlag(exName, detail?.group ?? '', cd.injuries);
    return f ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
        <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{f.reason}. Ease off, keep it pain-free, or pick another movement.</Text>
      </View>
    ) : null;
  })();

  /* ── send your coach a clip of that set ──────────────────────────────────
     The consent sentence is shown BEFORE the camera opens, not
     after the upload: consent that arrives once the file exists
     is not consent. src/lib/formCheck.ts owns it, and the
     storage policies in supabase/parts/2617 are what make it
     true. Rendered under whichever control logged the set. */
  const clipOffer = clipFor ? (
    <View style={{ marginTop: sp.lg, padding: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm }}>
      {(() => {
        const stop = clipRefusal({
          hasCoach: !!cd.trainerId,
          setExists: !!clipWorkoutId,
        });
        // A set still being saved is not a member without a coach,
        // and the two must not share a sentence.
        if (stop === 'no-set') {
          return <Text style={{ ...ty.label, color: t.ink3 }}>Saving that set… the form check appears once it lands.</Text>;
        }
        if (stop) {
          return <Text style={{ ...ty.label, color: t.ink3 }}>{clipRefusalLine(stop)}</Text>;
        }
        return (<>
          <Text style={{ ...ty.body, ...font('600'), color: t.ink }}>Send your coach a form check</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{MEMBER_CONSENT_NOTE}</Text>
          <TextInput
            value={clipNote}
            onChangeText={setClipNote}
            placeholder="What do you want them to look at?"
            placeholderTextColor={t.ink3}
            accessibilityLabel="What to ask your coach about this set"
            style={{ ...ty.body, color: t.ink, backgroundColor: t.surface, borderRadius: radius.sm, padding: sp.md, marginTop: sp.md }}
          />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md, flexWrap: 'wrap' }}>
            {(['camera', 'library'] as const).map((src) => (
              <Ghost
                key={src}
                // `clipBusy` was set on the way in and cleared on the
                // way out and NOTHING read it, so the only thing a
                // second press met was the silent `return` at the top
                // of the handler. A clip is megabytes over gym wifi:
                // for those seconds both buttons looked live and did
                // nothing at all. `disabled` refuses the press, drops
                // the fill and announces the state, and the line
                // below says which of the two things is happening —
                // relabelling both buttons "Sending…" would have said
                // it twice and named neither.
                disabled={clipBusy}
                label={src === 'camera' ? 'Film It' : 'Choose a Clip'}
                a11yLabel={src === 'camera' ? 'Film this set now' : 'Choose a clip already on this phone'}
                onPress={async () => {
                  if (clipBusy || !clipWorkoutId) return;
                  setClipBusy(true); setClipSaid(null);
                  try {
                    const picked = await pickFormClip(src);
                    if (picked.error) { setClipSaid(picked.error); return; }
                    if (!picked.clip) return;
                    const out = await sendFormClip({
                      memberId: cd.id === 'unknown' ? '' : cd.id,
                      workoutId: clipWorkoutId,
                      setIndex: 0,
                      clip: picked.clip,
                      note: clipNote,
                      hasCoach: !!cd.trainerId,
                    });
                    setClipSaid(out.ok
                      ? 'Sent. Your coach sees it against this set.'
                      : out.error);
                    if (out.ok) {
                      setClipNote('');
                      // Read back rather than assumed: the row is
                      // what the coach sees, so the control that
                      // removes it is built from the row that
                      // actually exists.
                      setClipSent(await fetchFormClip(clipWorkoutId, 0));
                    }
                  } finally { setClipBusy(false); }
                }}
              />
            ))}
          </View>
          {clipBusy ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>Sending your clip…</Text>
          ) : clipSaid ? (
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.sm }}>{clipSaid}</Text>
          ) : null}
          {clipSent ? (
            <View style={{ alignSelf: 'flex-start', marginTop: sp.sm }}>
              <Ghost
                label="Delete It"
                a11yLabel="Delete the clip you sent your coach"
                onPress={() => {
                  Alert.alert(
                    'Delete this clip?',
                    'It goes from your coach’s screen and from this app. Deleting it is final — there is no copy anywhere else.',
                    [
                      { text: 'Keep it', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: async () => {
                        const gone = await deleteFormClip(clipSent);
                        // `deleteFormClip` counts the rows, so a
                        // delete that matched nothing says so
                        // rather than reporting success over a
                        // video that is still there.
                        setClipSaid(gone.ok ? 'Deleted. Your coach can no longer see it.' : gone.error);
                        if (gone.ok) setClipSent(null);
                      } },
                    ],
                  );
                }}
              />
            </View>
          ) : null}
        </>);
      })()}
    </View>
  ) : null;

  // Sets on this phone that the server has not taken. They are
  // not lost and they are not in the log a coach reads, and only
  // one of those two is obvious from looking at the screen.
  const unsentLine = unsentNote(unsentSets, 'set') ? (
    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{unsentNote(unsentSets, 'set')}</Text>
  ) : null;

  /* ── the board's header: a round back control, the title centred ─────────
     Three views, three heads, and each one's back goes somewhere different:
     the set screen returns to the exercise, not to wherever the exercise was
     opened from, which is why `onBack` and `backLabel` are passed through
     rather than left to the kit's default. */
  const nav = (title: string, onBack: () => void, backLabel: string) => (
    <PageHead title={title} onBack={onBack} backLabel={backLabel} />
  );

  const shownName = display?.name.text || exName || 'Exercise';
  // The day names carrying the night values, for the one shared control the
  // set view draws on the night ground (`SetKindChip` reads `t.ink`, `t.ink3`,
  // `t.ring` and the accent pair). A spread, not a second theme: every value in
  // it is a token the palette already measured against `night`.
  const nightTheme = { ...t, ink: t.nightInk, ink3: t.nightInk2, ring: t.nightInk2, brand: t.brandBright, brandInk: t.brandDeep };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: inSet ? t.night : t.bg }} edges={['top']}>
      {/* `automaticallyAdjustKeyboardInsets` and a dismissable keyboard, because
          this scroller now holds a text field — the form-check question — and
          check:keyboard caught it sitting behind the keyboard.
          `useScrollPad` and NOT the bare constant: 220pt of permanent padding
          is what made pages "go blank at the bottom after there is no more
          wording", which was a real report. The hook gives the headroom only
          while a keyboard is actually up. */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 + pad }}
        showsVerticalScrollIndicator={false}
        refreshControl={pull}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {view === 'set' ? (
          /* ── page 6: Workout Tracking, in night focus mode ────────────────
             The approved ClientWorkout mockup: the whole screen on the night
             ground, the clock inside a ring, the movement in Sora, a pip per
             prescribed set, reps and load as two night tiles, the bright
             button and a plain Skip. Everything on the ground uses the night
             inks; what is left over — a record, the injury line, the coach's
             cue, the form check — sits in ONE ordinary card under the button,
             where the day tokens are right again. */
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
              {/* PageHead's shape, rebuilt on night: the kit's head draws its
                  title in `t.ink`, which is near-black on this ground. */}
              <Pressable accessibilityRole="button" accessibilityLabel="Back to the exercise" onPress={leaveSets}
                style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: t.night2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={BACK_ICON} size={18} color={t.nightInk} />
              </Pressable>
              <Text accessibilityRole="header" style={{ ...ty.page, color: t.nightInk, flex: 1, minWidth: 0, textAlign: 'center' }}>Workout Tracking</Text>
              <View style={{ width: 44 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            </View>
            {/* The clock is the figure. One ring, one spoken sentence, and
                which clock it is said in words under the digits — a resting
                member and a working member are looking at the same digits.
                The ARC is the rest running down against the rest it started
                from. A set being done has no target to be a fraction of, so it
                is handed null and draws the track alone: an arc there would be
                progress towards nothing. */}
            <View style={{ alignItems: 'center', marginTop: sp.lg }}>
              <HeroRing size={196}
                value={rest > 0 ? rest / DEFAULT_REST_SEC : null}
                figure={restClock(rest > 0 ? rest : elapsed)}
                sub={rest > 0 ? 'Rest' : 'Set'}
                spoken={`${rest > 0 ? 'Rest' : 'Set'} ${restClock(rest > 0 ? rest : elapsed)}`} />
            </View>
            {rest > 0 ? (
              <View style={{ alignItems: 'center', marginTop: sp.xs }}>
                {/* Whose number this is. Nobody has set a rest for a movement
                    opened by name, so the fallback names itself rather than
                    borrowing a coach's authority. */}
                <Text style={{ ...ty.caption, color: t.nightInk2 }}>App default of {DEFAULT_REST_SEC} seconds</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Skip the rest timer" onPress={skipRest}
                  hitSlop={8} style={{ paddingVertical: sp.sm, paddingHorizontal: sp.md }}>
                  <Text style={{ ...ty.label, ...font('600'), color: t.nightInk3 }}>Skip rest</Text>
                </Pressable>
              </View>
            ) : null}
            <Text style={{ ...ty.title, color: t.nightInk, textAlign: 'center', marginTop: sp.md }}>{shownName}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: sp.sm, marginTop: sp.sm }}>
              {/* A pip per PRESCRIBED set, lit up to the one being done. Only
                  when a prescription arrived on the route: without one there
                  is no total to draw pips towards, and the words alone say
                  "Set 2". Decoration — the sentence beside them is the fact. */}
              {plannedSets != null && plannedSets <= 10 ? (
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: 6 }}>
                  {Array.from({ length: plannedSets }, (_, i) => (
                    <View key={i} style={{ width: 30, height: 8, borderRadius: 4, backgroundColor: i < setNo ? t.brandBright : t.night2 }} />
                  ))}
                </View>
              ) : null}
              <Text style={{ ...ty.caption, color: t.nightInk2 }}>
                {pastPlan
                  ? `All ${plannedSets} sets done`
                  : plannedSets != null ? `Set ${setNo} of ${plannedSets}` : `Set ${setNo}`}
              </Text>
            </View>

            {/* Reps and load as the two figures. They are boxes, not labels,
                because they are what gets written: a figure a member cannot
                correct is a figure they will log wrong rather than not log. */}
            <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.xl }}>
              <View style={{ flex: 1, alignItems: 'center', backgroundColor: t.night2, borderRadius: radius.lg, paddingVertical: sp.lg, paddingHorizontal: sp.sm }}>
                <TextInput
                  value={repsText}
                  onChangeText={setRepsText}
                  keyboardType="numeric"
                  placeholder={fig(null)}
                  placeholderTextColor={t.nightInk2}
                  accessibilityLabel={timedOn ? 'How long you held it, in seconds' : 'How many reps you did'}
                  style={{ ...value(36), color: t.nightInk, textAlign: 'center', minWidth: 64, padding: 0 }}
                />
                <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.xs }}>{timedOn ? 'Seconds' : 'Reps'}</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', backgroundColor: t.night2, borderRadius: radius.lg, paddingVertical: sp.lg, paddingHorizontal: sp.sm }}>
                <TextInput
                  value={loadText}
                  onChangeText={setLoadText}
                  keyboardType="decimal-pad"
                  placeholder={fig(null)}
                  placeholderTextColor={t.nightInk2}
                  accessibilityLabel={bwOn
                    ? (wu === 'kg' ? 'Added load in kilograms, on top of your bodyweight' : 'Added load in pounds, on top of your bodyweight')
                    : (wu === 'kg' ? 'Load in kilograms' : 'Load in pounds')}
                  style={{ ...value(36), color: t.nightInk, textAlign: 'center', minWidth: 64, padding: 0 }}
                />
                <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.xs }}>{bwOn ? `Added ${wu}` : wu}</Text>
              </View>
            </View>
            {/* The same two answers about a set, in the same words, as the
                row below the fold and the runner — one drawing of the
                control, three keyboards. It draws from the theme it is HANDED,
                so on night it is handed the night inks under the day names. */}
            <View style={{ flexDirection: 'row', gap: sp.xl, flexWrap: 'wrap', justifyContent: 'center', marginTop: sp.sm }}>
              <SetKindChip
                t={nightTheme} on={bwOn} onToggle={() => setBwOn((v) => !v)}
                label="Bodyweight set"
                onLabel={`Bodyweight set — the box is what you added, in ${wu}`}
                a11yHint={bwOn
                  ? `The box holds what you added on top of your own weight, in ${wu}. Turn this off for a set on a bar or a machine.`
                  : 'Turn this on for a pull-up, a dip or a press-up. Leaving the load box empty does the same thing.'}
              />
              <SetKindChip
                t={nightTheme} on={timedOn} onToggle={() => setTimedOn((v) => !v)}
                label="Timed set"
                onLabel="Timed set — the first box is seconds held"
                a11yHint={timedOn
                  ? 'The first box is the seconds you held it for. Turn this off to count reps instead.'
                  : 'Turn this on for a plank, a hollow hold or a wall sit, where the set is a length of time rather than a count.'}
              />
            </View>

            <View style={{ marginTop: sp.xl }}>
              {pastPlan ? (
                <CtaBright label="Finish" a11yLabel="Finish, back to the exercise" onPress={leaveSets} />
              ) : (
                <CtaBright label="Complete Set" disabled={saving}
                  a11yLabel={`Complete set ${setNo}${plannedSets != null ? ` of ${plannedSets}` : ''}`}
                  onPress={() => { void completeSet(); }} />
              )}
            </View>
            {!pastPlan ? (
              // Plain, under the bright one, as the mockup draws it. Nothing is
              // written by a skip, so nothing is asked first; it moves the
              // count on and starts the next set's clock.
              <Pressable accessibilityRole="button" accessibilityLabel={`Skip set ${setNo}`} onPress={() => advance(false)}
                style={{ alignSelf: 'stretch', alignItems: 'center', paddingVertical: sp.md, marginTop: sp.xs, minHeight: 46, justifyContent: 'center' }}>
                <Text style={{ ...ty.head, ...font('600'), color: t.nightInk2 }}>Skip</Text>
              </Pressable>
            ) : null}

            {prMsg || injuryLine || coachCue || cueFailed || clipOffer || unsentLine ? (
              <Section>
                {prMsg ? <Flag tone={t.brand}>{prMsg}</Flag> : null}
                {injuryLine}
                {cueBlock(false)}
                {clipOffer}
                {unsentLine}
              </Section>
            ) : null}
          </>
        ) : view === 'demo' ? (
          /* ── page 5: Exercise Demo ────────────────────────────────────── */
          <>
            {nav('Exercise Demo', () => setView('ready'), 'Back to the exercise')}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...ty.title, color: t.ink }}>{shownName}</Text>
                {prescription ? <Text style={{ ...ty.label, color: t.ink3, marginTop: 2 }}>{prescription}</Text> : null}
              </View>
              <Ghost icon="dumbbell" a11yLabel="Start a set" onPress={startSets} />
            </View>
            {display?.note ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{display.note}</Text>
            ) : null}
            {heroMedia}
            {FRAMES_ARE_UNHOSTED && frames.length ? (
              <View style={{ marginTop: sp.sm }}>
                <Flag tone={t.warn}>Reference frames are served from the source dataset — not for release.</Flag>
              </View>
            ) : null}

            {/* ── what it is ──────────────────────────────────────────────── */}
            {detail ? (
              <>
                {/* The steps, the cues and the body lead, as the board's page 5
                    has them, and the description sits with the chips underneath:
                    somebody who has just pressed "demo" wants the sequence, and
                    the sentence saying what the movement IS is still here for the
                    person who does not know it. The three sections are `guide`,
                    the same element the ready view draws. */}
                {guide}

                {/* The description — the one thing the original request asked
                    for that the previous dataset had no field for at all — over
                    the attribute chips. */}
                <Section>
                  {display?.description ? (
                    <Text style={{ ...ty.body, color: t.ink, marginBottom: sp.md }}>{display.description.text}</Text>
                  ) : null}
                  {chipRow}
                </Section>

                {/* What the movement is FOR, and how it is filed. Last, because it is
                    the least useful thing to somebody standing in front of the bar. */}
                {detail.goals.length || detail.tags.length ? (
                  <Section>
                    {detail.goals.length ? (
                      <>
                        <SectionHead title="Good For" />
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: detail.tags.length ? sp.lg : 0 }}>
                          {detail.goals.map((g) => <TonedChip key={g} label={cap(g)} tone="brand" />)}
                        </View>
                      </>
                    ) : null}
                    {detail.tags.length ? (
                      <>
                        <SectionHead title="Tags" />
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                          {detail.tags.map((g) => <TonedChip key={g} label={cap(g)} tone="neutral" />)}
                        </View>
                      </>
                    ) : null}
                  </Section>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          /* ── page 4: Workout View ─────────────────────────────────────── */
          <>
            {nav('Exercise', goBack, 'Back')}
            {/* HERO: the demonstration in the hero card, then the movement's
                name in Sora at the leading edge with how it is filed as chips.
                The reader's own language where the catalogue has it, English
                where it does not — and `display.note` says which, so an
                English name among German ones is never passed off as the German
                one. The identity is still `name`: that is what this screen was
                opened with and what a logged set is written under. */}
            {heroMedia}
            {FRAMES_ARE_UNHOSTED && frames.length ? (
              <View style={{ marginTop: sp.sm }}>
                <Flag tone={t.warn}>Reference frames are served from the source dataset — not for release.</Flag>
              </View>
            ) : null}
            <View style={{ marginTop: sp.lg }}>
              <Text accessibilityRole="header" style={{ ...ty.display, color: t.ink }}>{shownName}</Text>
              {prescription ? (
                <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.xs }}>{prescription}</Text>
              ) : null}
              {display?.note ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{display.note}</Text>
              ) : null}
              {chipRow ? <View style={{ marginTop: sp.md }}>{chipRow}</View> : null}
            </View>

            {/* The three round controls, on a night plate: start in the bright
                accent, the demo and another movement on night2. The third is
                the Exercise Library this screen has always linked to at its
                foot, moved up to where the board put it. Each now carries its
                word under it — three unlabelled circles were three guesses —
                and keeps the fuller spoken name it always had. */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start', marginTop: sp.lg,
              backgroundColor: t.night, borderRadius: radius.xl, paddingVertical: sp.lg, paddingHorizontal: sp.md, ...elevation.hero }}>
              {([
                { key: 'start', word: 'Start Set', said: 'Start a set', hint: 'Opens the set tracker with a clock, reps and load', icon: 'dumbbell', go: startSets },
                { key: 'demo', word: 'Demo', said: 'Exercise demo', hint: 'The demonstration with the written steps', icon: 'play', go: () => setView('demo') },
                { key: 'swap', word: 'Library', said: 'Another exercise', hint: 'Opens the exercise library', icon: 'swap', go: () => router.push('/(client)/library') },
              ] as const).map((c) => {
                const lead = c.key === 'start';
                return (
                  <Pressable key={c.key} accessibilityRole="button" accessibilityLabel={c.said} accessibilityHint={c.hint}
                    onPress={c.go} style={{ flex: 1, alignItems: 'center', gap: sp.sm }}>
                    <View style={{ width: lead ? 64 : 56, height: lead ? 64 : 56, marginTop: lead ? 0 : 4, borderRadius: radius.pill,
                      backgroundColor: lead ? t.brandBright : t.night2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={c.icon} size={lead ? 26 : 22} color={lead ? t.brandDeep : t.nightInk} />
                    </View>
                    <Text style={{ ...ty.micro, color: lead ? t.nightInk : t.nightInk2, textAlign: 'center' }}>{c.word}</Text>
                  </Pressable>
                );
              })}
            </View>

            {cueBlock(true)}
            {injuryLine}

            {/* ── INFOGRAPHICS: the body, then the member's own line ─────────
                `guide` opens on the muscle picture and carries the steps and
                the tips under it. The coach's cue and the injury caution keep
                their place ABOVE the catalogue's words: one is the person who
                trains them and the other is a safety line, and both are a few
                lines where the steps are a page. */}
            {guide}

            {/* ── the best set, over time ───────────────────────────────────
                Drawn only on a WHOLE read with a movement on record; every
                other state of the log already has its sentence in the trail's
                card below, and saying it twice on one page reads as two
                faults. Inside that, ChartShell holds the two-point rule: one
                loaded day is a sentence, not a line. */}
            {isWhole(logStatus) && summary ? (
              <Section>
                <SectionHead title="Best Set Over Time" note={`Est. 1RM · ${wu}`} />
                <ChartShell status={logStatus} points={bestSeries.points}
                  emptyLine="No set of this with a load on the bar is on record yet, so there is no best set to chart."
                  onePointLine="One day with a loaded set so far. The line appears from the second.">
                  <Spark area data={bestSeries.data} labels={bestSeries.labels} unit={wu} />
                  {bestSeries.top ? (
                    <View style={{ marginTop: sp.md }}>
                      <TonedChip icon="trophy" label={`Best ${bestSetLabel({ reps: bestSeries.top.reps }, liftLabel(bestSeries.top.loadKg, wu), null)}`} />
                    </View>
                  ) : null}
                </ChartShell>
              </Section>
            ) : null}

            {/* ── log a set of it, here ─────────────────────────────────────
                The quick row, for a set already done: the whole point of this
                screen being reachable from a machine, and still here under the
                tracker for the member who did not start a clock. How it logs
                is folded away — the row's own boxes and ticks say it, and the
                paragraph was pushing them down the page. */}
            {name ? (
              <Section>
                <SectionHead title="Log a Set" note="Into today" />
                <LogSetRow t={t} unit={wu} onLog={(set) => { void logOne(set); }} />
                {clipOffer}
                {unsentLine}
                <Expandable title="How This Logs">
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    Straight into today, without going back to Train. Leave the load box empty for a
                    bodyweight set, or tick Timed for a hold.
                  </Text>
                </Expandable>
              </Section>
            ) : null}

            {/* ── what you have done on it ──────────────────────────────────── */}
            <Section>
              {logStatus === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3 }}>Reading your training log&hellip;</Text>
              ) : logStatus === 'error' ? (
                <Flag tone={t.warn}>
                  Your training log could not be read, so we cannot say what you have done on this. That
                  is not the same as having done none of it.
                </Flag>
              ) : summary ? (
                <ExerciseTrail
                  summary={summary}
                  log={log}
                  status={logStatus}
                  /* Unwindowed, as above — so nothing here loses the sentences it
                     has today. */
                  windowDays={null}
                  unit={wu}
                  voice={{ they: 'You', their: 'your', have: 'have' }}
                  history={weightSeries}
                />
              ) : logStatus === 'partial' ? (
                // 'partial' had no arm and fell into "You have not logged this
                // movement yet" — said on the movement's own page to a lifter whose
                // squats all predate the row cap. A truncated read holds the newest
                // thousand sessions and nothing behind them, so an absence in it is
                // silence rather than a fact. Same arm records.tsx and
                // progression.tsx already carry, for the reason written on
                // src/lib/rowCap.ts: a confident empty state is strictly worse than
                // a failed read.
                <Flag tone={t.warn}>
                  You have logged more sessions than this screen can read in one go, and none of the ones
                  it read were this movement. That is not a statement that you have never done it.
                </Flag>
              ) : (
                <Text style={{ ...ty.body, color: t.ink2 }}>
                  You have not logged this movement yet. The first set you log starts the trail.
                </Text>
              )}
            </Section>
          </>
        )}
      </ScrollView>
      <Confetti show={confetti} onDone={() => setConfetti(false)} />
    </SafeAreaView>
  );
}
