// Trainer · My Training — the coach's OWN workout log.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// Coaches train. Until this screen there was nowhere in the coach app to log or
// review a session of their own, so a coach who lifts had to keep a second
// account in the client app to record their own squats. Nothing in the data
// model required that: `workouts.user_id` references `profiles(id)`, every
// account gets a `profiles` row from `handle_new_user()`, and the RLS policy is
// `user_id = auth.uid()` with no role predicate. A coach could always insert
// their own rows — there was simply no screen that did it. No migration was
// written for this; none was needed.
//
// ── Why this screen is so insistent about whose training it is ─────────────
//
// `useWorkoutLog` reads the SIGNED-IN USER'S rows, always. In the coach app the
// signed-in user is the coach, so everything this provider holds is the coach's
// own training and never a client's. That is easy to write down and was once
// got wrong in exactly the way that matters: an earlier version of
// app/(trainer)/dashboard.tsx rendered `useWorkoutLog` and `useCheckIns` inside
// the client detail sheet — streak, weekly volume, personal records, latest
// check-in — under a client's name. A coach reading that sheet was shown their
// own training as their client's. The header note on dashboard.tsx documents
// the removal, and the provider is still mounted there with its return value
// deliberately discarded so nothing can drift back.
//
// So the separation is stated, not implied, in four places a coach cannot miss:
// the tab title ("My Training"), the kicker above the heading, the sentence
// under it, and the empty state — which says whose log is empty rather than
// just that a log is. A coach glancing at this screen mid-session must be able
// to tell in one look that they are not looking at a client. The pointer at the
// foot says where a client's session goes instead, so the two paths are never
// the same tap.
//
// ── What this screen is not ────────────────────────────────────────────────
//
// It logs and reviews. It does not program: a coach writing themselves a plan
// has the whole of Programs for that, and duplicating it here would fork the
// builder. Nor does it invent a calorie figure for a strength session the way
// the client's quick-log does — reps and weight are what was recorded, energy
// was not, and `WorkoutEntry.kcal` left absent renders as a dash everywhere
// downstream rather than as a fabricated burn in the coach's own history.
import { useCallback, useState, useMemo } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { View, Text, Pressable, ScrollView, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, KpiRow, Cta, Ghost, Notice, PartialRead, Field, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useExerciseCatalogue, type CatalogueRow } from '../../src/ui/exerciseDetail';
import { useMovementName } from '../../src/ui/catalogueTranslations';
import { useCatalogueThumbs } from '../../src/ui/useCatalogueThumbs';
import { ExerciseThumb } from '../../src/ui/ExerciseDemo';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { ensureCatalogueRow } from '../../src/ui/customExercise';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useSettings } from '../../src/ui/settings';
import { isWhole } from '../../src/ui/loadStatus';
import { notifySuccess } from '../../src/ui/haptics';
import { parseWorkoutText } from '../../src/lib/workoutParse';
import { trainingDays, setsSummary } from '../../src/lib/ownTraining';
import { tonnageNote, type BodyweightHistory } from '../../src/lib/bodyweightSets';
import { useCheckIns } from '../../src/ui/checkins';
import { useToday, useNow } from '../../src/ui/today';
// ── the coach's own muscles, read on the CLIENT hooks ──────────────────────
//
// Repple's rule, and it is a rule about the data model rather than a
// preference: trainers self-track, and there is no client→trainer promotion
// anywhere in this product. So the coach's own body diagram is built on the
// same provider their own sets are logged through — `useWorkoutLog()`, which
// reads `user_id = auth.uid()` and in this app is the coach — and on the same
// panel app/(trainer)/client-training.tsx hands a client's log to. There is no
// coach-of-themselves path, nothing here consults the roster, and a coach with
// no clients at all gets the identical screen.
import { MuscleWorkPanel } from '../../src/ui/MuscleWorkPanel';
import { volumeIn, convertedNote, type WeightUnit } from '../../src/lib/units';
// ── one row per set, and a tick that says it happened ─────────────────────
//
// The two TestFlight reports this screen's "Log One Lift" section answers, and
// the pure module that owns every decision in it. `readLift` is no longer
// imported here at all: it is reached through `readLadder`, which reads one row
// at a time and names the set a refusal came from — a coach told "check that
// load" about a four-row table cannot see which row is wrong.
import {
  ladderDone, ladderNote, patchLadderRow, readLadder, readSetCount, resizeLadder,
  setAllLadderRows, toggleLadderRow, type LadderRow,
} from '../../src/lib/setLadder';
import { SetLadder } from '../../src/ui/SetTable';
import { weekStats } from '../../src/lib/streaks';
import { num } from '../../src/lib/format';
import { localDate } from '../../src/lib/localDate';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { appLocale } from '../../src/lib/locale';
import { BACK_ICON } from '../../src/ui/direction';

/** How many days back "Recent" reaches. Beyond a fortnight this stops being a
 *  log a coach reads and starts being a history screen, which is not what this
 *  is for. */
const RECENT_DAYS = 14;

/** The windows the muscle panel offers, in days.
 *
 *  Wider than this screen's session list on purpose, and the widest of them is
 *  ninety rather than a year: `muscleWorkBoard` scales its shading to the
 *  hardest-worked muscle IN the window, so the longer the window the more of a
 *  coach's own history is compressed into one picture, and a year of training
 *  drawn against a single peak says almost nothing about this month. */
const MUSCLE_WINDOWS = [7, 30, 90] as const;

/** A day key as a person reads it: "Fri 14 Aug". */
function dayLabel(day: string): string {
  const d = localDate(day);
  if (!d) return day;
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function MyTraining() {
  const t = useTheme();
  const router = useRouter();
  const { log, status, logWorkouts, removeWorkout, reload } = useWorkoutLog();
  const settings = useSettings();
  const wu: WeightUnit = settings.weightUnit;
  const loadNote = convertedNote(wu);

  // An empty log under 'error' means "we could not read it", which is a
  // different sentence from "you have not trained". Telling a coach who trained
  // four times this week that they have done nothing is the exact failure
  // src/ui/loadStatus.ts exists to prevent, so every count and every empty
  // state below branches on this rather than on `log.length`.
  const known = status !== 'error';
  // Whether the rows in hand are ALL of them. A capped read ('partial') can be
  // listed but not counted — a weekly total computed over an unknown fraction
  // of the log is a subtotal wearing a total's label.
  const whole = isWhole(status);

  const days = trainingDays(log);
  // ── the day this screen thinks it is ──────────────────────────────────
  //
  // `useToday()`, not `dayKeyOfDate(new Date())`. A bare read in the render
  // body is not frozen the way `useMemo(…, [])` is, but it is only ever as
  // fresh as the last render — and `my-training` is registered `href: null` in
  // app/(trainer)/_layout.tsx, so it mounts once and is never torn down, and a
  // screen nobody is touching does not render. A coach who opened their own
  // training log on Sunday, went to another tab and came back on Wednesday had
  // a "Today" section still showing Sunday, and the entries they logged since
  // filed under `recent` as though they belonged to somebody else's week.
  //
  // `check:frozen-day` looks for `useMemo(…, [])` and cannot see this shape at
  // all. `useToday` re-reads at the next local midnight and on foreground, and
  // compares before it sets, so an open screen costs nothing until the day
  // actually turns. Same day format, same local timezone: `todayKey` and
  // `dayKeyOfDate` both build `YYYY-MM-DD` off the same three local getters.
  const todayKey = useToday();
  /* ── the instant the muscle window ends ──────────────────────────────
   *
   * `useNow()` and not `Date.now()`, for the reason the block above gives
   * about `useToday`: this route is registered `href: null`, so it mounts once
   * and never tears down, and a rolling "last 30 days" computed off a clock
   * read at mount is a window that stopped moving the day the coach first
   * opened the tab. `useNow` moves on focus, which is exactly when a coach
   * coming back to this screen is asking about the thirty days ending now. */
  const nowMs = useNow().getTime();
  /** How far back the muscle panel looks. Wider than the fortnight `RECENT_DAYS`
   *  lists, because the question it answers is a different one: a list of
   *  sessions is read forwards from today and a body diagram is read as a
   *  balance, and a balance over one week is mostly a picture of which day of
   *  the split somebody is standing in. Thirty is the default for that reason. */
  const [muscleDays, setMuscleDays] = useState<number>(30);
  const today = days.find((d) => d.day === todayKey) ?? null;
  const recent = days.filter((d) => d.day !== todayKey).slice(0, RECENT_DAYS);
  /* ── the coach's own weight, so their bodyweight sets are worth something ──
   *
   * `weekStats(log)` was called with the third argument omitted, which defaults
   * the bodyweight history to `[]` — and `entryTonnage` cannot price a press-up,
   * a pull-up or a dip without a bodyweight recorded on or before the day it was
   * done, so it counts them as unknown instead. A calisthenics week read as a
   * fraction of the work, and the caveat `weekStats` hands back in
   * `unpricedSets` was never read.
   *
   * The coach's weigh-ins are on `check_ins.weight_kg` — the same series
   * app/(trainer)/my-progress.tsx charts, filtered the same way, because a NULL
   * column arrives here as 0 and a body that weighs nothing prices every set at
   * nothing. Every client screen in this product passes this series; the coach
   * was getting the honest figure everywhere except the screen about themselves.
   */
  const ci = useCheckIns();
  const myWeights: BodyweightHistory = useMemo(
    () => ci.checkins
      .filter((c) => Number.isFinite(c.weightKg) && c.weightKg > 0)
      .map((c) => ({ t: c.at, v: c.weightKg })),
    [ci.checkins],
  );
  const wk = weekStats(log, Date.now(), myWeights);
  /** The sets this week's total could not price, in the words every other
   *  screen uses for them. Null when there are none. */
  const unpricedNote = tonnageNote({ kg: wk.volumeKg, unknownSets: wk.unpricedSets });

  /* ── logging by text ─────────────────────────────────────────────────── */

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * The same parser the client app uses — `parseWorkoutText`, unit-aware and
   * unit-tested. Reused rather than reimplemented: a second parser is a second
   * set of rules about what a bare "135" means, and the whole reason that
   * function takes a unit is that reading an unsuffixed number as kilograms
   * stored a 135 lb bench as 297 lb.
   */
  const logByText = async () => {
    const lifts = parseWorkoutText(text, wu);
    if (!lifts.length) {
      Alert.alert('Could not read that', wu === 'lb'
        ? 'Try e.g. "bench 3x8 135lb, squat 225lb 5 5 5".'
        : 'Try e.g. "bench 3x8 60kg, squat 100kg 5 5 5".');
      return;
    }
    const at = new Date().toISOString();
    setBusy(true);
    // No `kcal`. A strength session records reps and weight; nobody measured
    // the energy, and an absent figure reads as a dash rather than as a number
    // this screen made up.
    const out = await logWorkouts(lifts.map((l) => ({ t: at, exercise: l.exercise, sets: l.sets })));
    setBusy(false);
    // Cleared for the two outcomes that KEPT what was typed. A refusal throws
    // the entries away, and the text box is then the only copy of them.
    if (out !== 'refused') setText('');
    if (out === 'stored') {
      notifySuccess();
      // Only AFTER the log landed. Minting a catalogue row for a movement whose
      // workout was refused would put a name in the library that nothing
      // references — the library is shared, so its rows should be earned.
      const minted = await mintAll(lifts.map((l) => l.exercise));
      Alert.alert('Logged',
        `${lifts.length} exercise${lifts.length === 1 ? '' : 's'} added to your own training for today.`
        + (minted.length ? `\n\n${listNames(minted)} ${minted.length === 1 ? 'was' : 'were'} not in the exercise library, so ${minted.length === 1 ? 'it has' : 'they have'} been added to it.` : ''));
    } else if (out === 'unsent') {
      // Nobody answered, so the entries were kept — on this phone, in the log,
      // counted, and sent on the next launch that reaches a server. They are
      // still not IN the log, so no exercise is minted: the library is shared,
      // and its rows are earned by a workout the server has accepted.
      Alert.alert('Saved on this phone',
        `No connection, so ${lifts.length === 1 ? 'it has' : 'they have'} not reached your training log yet — nothing is lost. ${lifts.length === 1 ? 'The exercise is' : `All ${lifts.length} exercises are`} saved here and go up on their own the next time you have signal.`);
    } else {
      // The server read this and declined it, so it is not recorded and it is
      // not waiting either. Saying "logged" here would be the same event as a
      // real save; saying "it will be gone at the next launch" would be the
      // same event as the one above.
      Alert.alert('Not saved',
        'Your training log rejected what you typed, so it has not been recorded and it is not waiting to send. What you typed is still in the box — sending it again as it is will be rejected again.');
    }
  };

  /* ── logging one lift by hand ────────────────────────────────────────── */

  const [exercise, setExercise] = useState('');
  const [setCount, setSetCount] = useState('');
  /**
   * A ROW PER SET, each with its own reps, its own load and its own tick.
   *
   * ── what this replaces, and why it was wrong ─────────────────────────────
   *
   * Two boxes: one rep figure and one load, written out `setCount` times as
   * `Array.from({ length: s }, () => [r, kg])`. Three sets of the identical
   * number, because two boxes cannot say anything else.
   *
   * Reported from TestFlight by a coach on 1.3.0 (20): "when entering amount of
   * sets there should be a drop down to record with the weight being used per
   * set". A coach who worked up 60 / 65 / 65 had to pick one of those three
   * numbers and lose the other two, and whichever they picked, their own
   * tonnage, their own PR board and their own progression were computed off a
   * session that had not happened.
   *
   * Nothing in the STORE had to change for this. `workouts.sets` has always
   * been `[reps, kg]` PAIRS — one pair per set, each with its own second number
   * — and src/lib/workoutRow.ts has always round-tripped them. The per-set load
   * was in the model the whole time; it was this screen's three boxes that
   * could not reach it.
   *
   * ── and the tick ─────────────────────────────────────────────────────────
   *
   * "A tick box to send feedback/log sets been completed", from the same
   * report. The rows can now go up before the session and be ticked off through
   * it, and ONLY the ticked rows are saved — see `readLadder`. A row nobody
   * ticked is a set nobody did, and it does not reach the log as a zero, as an
   * empty, or at all.
   *
   * All of the arithmetic, the resizing and the refusing is in
   * src/lib/setLadder.ts, tested; the drawing is src/ui/SetTable.tsx, shared
   * with the client app so the same control means the same thing in both.
   */
  const [ladder, setLadder] = useState<LadderRow[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Retype the set count, and grow or shrink the table under it.
   *
   * The box keeps whatever was typed — including something that is not a count
   * at all — because a controlled input that refuses a keystroke is one nobody
   * can backspace out of. What the box says and what the table holds are two
   * different things, and only a READABLE count moves the table.
   */
  const retype = (v: string) => {
    setSetCount(v);
    const read = readSetCount(v);
    if (read.ok) setLadder((rows) => resizeLadder(rows, read.n));
    // Deliberately no `else`. Clearing the box mid-edit must not throw away the
    // four sets already typed and ticked underneath it.
  };

  /**
   * A single lift, typed a row at a time, for when the sentence parser is not
   * what somebody wants.
   *
   * Everything here is refused rather than coerced. `parseInt(x, 10) || 0` is
   * the obvious line and it turns a fat-fingered rep count into a set of zero
   * reps, which is a set that did not happen sitting in the record and dragging
   * down every figure derived from it. The load goes through `readLift`, which
   * refuses text and out-of-range numbers and states the bound in the unit the
   * coach is actually typing in — a blank box stays blank and means a
   * bodyweight set, not a load of nothing.
   */
  /**
   * Put any of these movements the catalogue does not have into it, and return
   * the ones that were genuinely new.
   *
   * Asked for: a coach saving an exercise the library does not list should see
   * it added. Until now a typed name stayed a string on one workout row, so
   * the same movement logged twice was two unrelated records and never gained
   * a search entry, an illustration or a history.
   *
   * Sequential rather than parallel, and deliberately: two of the same new
   * name in one typed session would otherwise race each other to insert the
   * same id.
   */
  const mintAll = async (names: string[]): Promise<string[]> => {
    const made: string[] = [];
    for (const n of [...new Set(names.map((x) => x.trim()).filter(Boolean))]) {
      const { created } = await ensureCatalogueRow(n);
      if (created) made.push(n);
    }
    return made;
  };

  /** "Zercher squat", or "A, B and C" — a list a person reads, not an array. */
  const listNames = (n: string[]): string =>
    (n.length <= 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`) ?? '';

  const logOneLift = async () => {
    setProblem(null);
    const name = exercise.trim();
    if (!name) { setProblem('Give the lift a name.'); return; }
    // The count box is still read, and first, so that somebody who typed a name
    // and a count and nothing else is told about the count rather than about a
    // table that was never drawn.
    const count = readSetCount(setCount);
    if (!count.ok) { setProblem(count.reason); return; }
    // Every refusal is `readLadder`'s, named by the set it came from, and the
    // rule it enforces is the one this screen could not enforce before: only
    // TICKED rows are read, so a table with two of four ticked writes two sets
    // and the other two are absent rather than zero.
    const read = readLadder(ladder, wu);
    if (!read.ok) { setProblem(read.reason); return; }
    const entry: WorkoutEntry = {
      t: new Date().toISOString(),
      exercise: name,
      sets: read.sets,
    };
    setBusy(true);
    const out = await logWorkouts([entry]);
    setBusy(false);
    if (out === 'stored') {
      notifySuccess();
      setExercise(''); setSetCount(''); setLadder([]);
      const minted = await mintAll([name]);
      Alert.alert('Logged', `${name} added to your own training for today.`
        + (minted.length ? '\n\nIt was not in the exercise library, so it has been added to it.' : ''));
    } else if (out === 'unsent') {
      // Kept. The boxes are cleared here and not below, because the lift is on
      // this phone and in the list — leaving it in the form as well is how the
      // same set gets logged twice. No mint: the library's rows are earned by a
      // workout the server has accepted.
      setExercise(''); setSetCount(''); setLadder([]);
      Alert.alert('Saved on this phone',
        `No connection, so ${name} has not reached your training log yet — nothing is lost. It is saved here and goes up on its own the next time you have signal.`);
    } else {
      // The boxes are deliberately NOT cleared. What was typed is the only copy
      // of it that exists, and emptying the form would take that away on the
      // one path where the coach may want to try again.
      setProblem('Not saved — your training log rejected this lift, so it is not recorded and it is not waiting to send. Saving it again as it is will be rejected again.');
    }
  };

  /* ── removing something ──────────────────────────────────────────────── */

  /**
   * Confirmed, and believed only when the server says the row is gone.
   * `removeWorkout` resolves false on a refused delete and leaves `log` alone,
   * so the entry stays on screen — which is honest, and is why this says so
   * rather than letting a row vanish and reappear at the next launch.
   */
  const remove = (e: WorkoutEntry) => {
    Alert.alert('Remove this entry?', `${e.exercise} will be taken out of your own training log.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        if (!(await removeWorkout(e))) {
          Alert.alert('Not removed', `${e.exercise} is still in your log — we could not reach the server to take it out.`);
        }
      } },
    ]);
  };

  // What the catalogue offers for what has been typed so far. Capped at five:

  // this list sits between the field and the sets, and a long one pushes the

  // rest of the form off the screen while somebody is mid-entry.

  //

  // Hidden once the typed name IS a catalogue movement — the suggestion has

  // been taken, and leaving it there just covers the form.

  const cat = useExerciseCatalogue();
  // The coach's OWN logged rows carry the English name — the same identity a
  // client's log carries. Read in their language, written in the catalogue's.
  const { textOf: movement } = useMovementName();
  // Two reads: the trainer's own workout log, and the movement catalogue the
  // name suggestions are drawn from. The log is the point — a session logged
  // on another handset is the thing this screen is missing.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([Promise.resolve(reload()), cat.reload()]),
    [reload, cat],
  ));

  const exSuggestions = useMemo(() => {

    const q = exercise.trim().toLowerCase();

    if (q.length < 2 || cat.status !== 'ready') return [] as CatalogueRow[];

    const typedSlug = exerciseSlug(exercise);

    if (cat.rows.some((r) => r.id === typedSlug)) return [] as CatalogueRow[];

    const starts = cat.rows.filter((r) => r.name.toLowerCase().startsWith(q));

    const rest = cat.rows.filter((r) => !r.name.toLowerCase().startsWith(q) && r.name.toLowerCase().includes(q));

    return [...starts, ...rest].slice(0, 5);

  }, [exercise, cat.rows, cat.status]);

  const thumbFor = useCatalogueThumbs(exSuggestions);


  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 };
  const G = layout.gutter;

  const EntryRow = ({ e }: { e: WorkoutEntry }) => {
    const line = setsSummary(e.sets, wu);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{movement(e.exercise)}</Text>
          {/* No line rather than an invented one. A cardio row carries no sets,
              and "0 × 0" would be a session nobody did. */}
          {line ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{line}</Text> : null}
        </View>
        <Pressable onPress={() => remove(e)} hitSlop={8} accessibilityRole="button"
          accessibilityLabel={`Remove ${e.exercise} from your own training log`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit }} />
          <Text style={{ ...ty.caption, color: t.ink2 }}>Remove</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

          {/* ── header. Whose log this is, said before anything else ─────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
            <Ghost icon={BACK_ICON} onPress={() => router.back()} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.micro, color: t.ink3 }}>Your own log, not a client&rsquo;s</Text>
              <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>My Training</Text>
            </View>
          </View>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.md }}>
            Everything on this screen is training you logged for yourself, under your own account. No
            client&rsquo;s sessions appear here, and nothing you log here reaches a client&rsquo;s record.
          </Text>

          {/* ── can what follows be trusted? ─────────────────────────────── */}
          {status === 'error' ? (
            <Section>
              <Notice tone={t.warn} kicker="Your training" title="We couldn’t read your training log"
                note="Your own sessions are safe — this screen cannot see them right now. Nothing has been reset, and an empty list below means unknown rather than none.">
                <View style={{ marginTop: sp.lg }}><Cta label="Try Again" wide onPress={reload} /></View>
              </Notice>
            </Section>
          ) : status === 'partial' ? (
            <Section>
              {/* "exercises", not "sessions". `log` is `useWorkoutLog`'s rows and
                  that provider's own read says what one row is — "One row per
                  set, not per session" (src/ui/workoutLog.tsx) — so one gym visit
                  files as many rows as it had movements. This banner prints
                  `shown` as "Showing the first N <what>", and calling a thousand
                  exercise rows a thousand sessions is the arithmetic
                  src/lib/streaks.ts refuses everywhere else: `days` is the only
                  provable unit for a visit, and `wk.workouts` — the same
                  `recent.length` count — is labelled "Exercises" forty lines
                  below this one. A coach reading "the first 1,000 sessions of
                  your own" is being told they have trained a thousand times. */}
              <PartialRead what="exercises of your own" shown={log.length} onPress={reload} />
            </Section>
          ) : null}

          <Rule />

          {/* ── the week, and only when the week is knowable ──────────────── */}
          <Section>
            <SectionHead title="Your Last 7 Days" />
            <KpiRow items={[
              { label: 'Days Trained', value: whole ? fig(wk.days) : fig(null) },
              { label: 'Exercises', value: whole ? fig(wk.workouts) : fig(null) },
              // A total over a truncated or unread log is not a total. `num`
              // gives it a thousands separator; a week of lifting passes 999 in
              // either unit long before it passes anything else.
              { label: 'Lifted', value: whole ? num(volumeIn(wk.volumeKg, wu)) : fig(null), unit: whole ? wu : undefined },
            ]} />
            {/* The sets that are not in the number above it. Every client
                screen and the coach's view of a CLIENT print this; the coach's
                own week did not. */}
            {whole && unpricedNote ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>{unpricedNote}</Text>
            ) : null}
            {!whole ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.md }}>
                {status === 'loading'
                  ? 'Reading your log…'
                  : status === 'partial'
                    ? 'Your log came back short, so these would be figures over part of it rather than over the week.'
                    : 'Your log could not be read, so there is no week to count.'}
              </Text>
            ) : loadNote ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{loadNote}</Text>
            ) : null}
          </Section>

          <Rule />

          {/* ── log by text ──────────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Log by Text" />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              Type the session the way you would write it down. Goes into your own log, dated today.
            </Text>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              {/* The unit is written into the example deliberately. The parser
                  reads "60kg" and "135lb" as written, but a BARE number takes
                  the unit below — so showing a pounds coach a kilogram example
                  is what would put a 135 lb bench in as 135 kg. */}
              <TextInput value={text} onChangeText={setText}
                placeholder={wu === 'lb' ? '"bench 3x8 135lb, squat 5 5 5 225lb"' : '"bench 3x8 60kg, squat 5 5 5 100kg"'}
                placeholderTextColor={t.ink3} onSubmitEditing={logByText} returnKeyType="done"
                accessibilityLabel="Describe the workout you did" style={[inp, { flex: 1 }]} />
              <Cta label={busy ? 'Saving…' : 'Log'} onPress={logByText} disabled={busy || !text.trim()} />
            </View>
          </Section>

          <Rule />

          {/* ── log one lift by hand ─────────────────────────────────────── */}
          <Section>
            <SectionHead title="Log One Lift" />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              For when you would rather not type a sentence. Every set gets its own weight, and only the sets you tick are saved. Leave a weight empty for a bodyweight set.
            </Text>
            {/* Typed OR picked. This field was free text only, which asked a
                coach to spell from memory a movement the app already holds 604
                of — and a name that does not slug to a catalogue id gets no
                illustration and no history that lines up with the same lift
                logged from anywhere else. The catalogue is right there; the
                field now offers it.

                Suggestions rather than a required picker: a coach's own
                training includes movements the catalogue has never heard of,
                and refusing those would make this screen useless for exactly
                the people most likely to invent one. */}
            <TextInput value={exercise} onChangeText={setExercise} placeholder="Exercise" placeholderTextColor={t.ink3}
              accessibilityLabel="Exercise name" style={[inp, { marginBottom: sp.sm }]} />
            {exSuggestions.length ? (
              <View style={{ marginBottom: sp.sm, backgroundColor: t.surface, borderRadius: radius.sm, overflow: 'hidden' }}>
                {exSuggestions.map((r: CatalogueRow, i: number) => (
                  // The row READS in the coach's own language and WRITES the
                  // English name. `r.name` is the identity — it is what
                  // exercises.id is the slug of and what a logged set is
                  // stored under — so onPress keeps it and only the two
                  // strings a person sees move to `display`.
                  <Pressable key={r.id} onPress={() => setExercise(r.name)}
                    accessibilityRole="button" accessibilityLabel={`Use ${r.display.text}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: sp.sm,
                      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <ExerciseThumb uri={thumbFor(r)} t={t} size={34} />
                    <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>{r.display.text}</Text>
                    {r.group ? <Text style={{ ...ty.caption, color: t.ink3 }}>{r.group}</Text> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            {/* ── how many sets, and then a row for each of them ───────────
                The count box no longer multiplies one pair of numbers. It says
                HOW MANY ROWS, and each row carries its own reps, its own load
                and its own tick — which is what the report asked for and what
                `workouts.sets` has been able to hold all along.

                It is still one box in one row on its own, so a coach who wants
                three of the same set types 3 and then taps Did on all of them,
                which is two taps rather than the one it used to be. That is the
                price of being able to say 60 / 65 / 65, and `All done` is the
                second tap. */}
            <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
              <Field label="Sets" a11y="Number of sets" style={{ flex: 0, width: 96 }}>
                <TextInput value={setCount} onChangeText={retype} keyboardType="numeric" style={inp} />
              </Field>
              {ladder.length ? (
                <Pressable
                  onPress={() => setLadder((rows) => setAllLadderRows(rows, ladderDone(rows) < rows.length))}
                  accessibilityRole="button"
                  accessibilityLabel={ladderDone(ladder) < ladder.length
                    ? `Tick all ${ladder.length} sets as done`
                    : `Take the tick off all ${ladder.length} sets`}
                  hitSlop={8}
                  style={{ paddingVertical: 11, paddingHorizontal: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>
                    {ladderDone(ladder) < ladder.length ? 'All done' : 'Clear ticks'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {ladder.length ? (
              <SetLadder
                t={t} unit={wu} rows={ladder} movement={exercise.trim() || 'this lift'}
                onPatch={(at, patch) => setLadder((rows) => patchLadderRow(rows, at, patch))}
                onToggle={(at) => setLadder((rows) => toggleLadderRow(rows, at))}
                note={ladderNote(ladder)} />
            ) : (
              // Not an error, and not silence either. An empty count box is
              // somebody who has not said yet, and the sentence says what
              // saying it will do rather than telling them off for it.
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Say how many sets, and a row appears for each one — its own reps, its own weight, ticked off as you do it.
              </Text>
            )}
            {problem ? (
              <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-start', marginTop: sp.md }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.crit, marginTop: 6 }} />
                <Text style={{ ...ty.label, color: t.ink2, flex: 1 }}>{problem}</Text>
              </View>
            ) : null}
            <View style={{ marginTop: sp.md }}>
              <Cta wide label={busy ? 'Saving…' : 'Add to My Log'} onPress={logOneLift} disabled={busy} />
            </View>
            <View style={{ marginTop: sp.sm }}>
              <Ghost label="Browse the Exercise Library" icon="grid"
                onPress={() => router.push('/(trainer)/library')} />
            </View>
          </Section>

          <Rule />

          {/* ── today ────────────────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Today" note={known && today ? `${today.entries.length}` : undefined} />
            {today ? (
              today.entries.map((e, i) => <EntryRow key={e.id ?? `${e.t}-${e.exercise}-${i}`} e={e} />)
            ) : status === 'loading' ? (
              <Text style={{ ...ty.body, color: t.ink3 }}>Reading your log…</Text>
            ) : !known ? (
              // Not "you have not trained today" — that is a claim about the
              // coach's own day that a failed read gives nobody the standing to
              // make.
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Whether you logged anything today is not known — your log could not be read.
              </Text>
            ) : (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Nothing of your own logged today yet.
              </Text>
            )}
          </Section>

          <Rule />

          {/* ── recent ───────────────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Recent" />
            {recent.length ? (
              recent.map((d) => (
                <View key={d.day} style={{ marginBottom: sp.lg }}>
                  <Text style={{ ...ty.micro, color: t.ink3 }}>{dayLabel(d.day)}</Text>
                  {d.entries.map((e, i) => <EntryRow key={e.id ?? `${e.t}-${e.exercise}-${i}`} e={e} />)}
                </View>
              ))
            ) : status === 'loading' ? (
              <Text style={{ ...ty.body, color: t.ink3 }}>Reading your log…</Text>
            ) : !known ? (
              <Text style={{ ...ty.body, color: t.ink2 }}>
                Your own past sessions could not be read. They have not gone anywhere — this screen
                cannot see them right now.
              </Text>
            ) : (
              // The empty state names whose log is empty. "No workouts yet" on a
              // coach's screen is exactly the sentence that could be misread as
              // being about whoever they were last looking at.
              <Text style={{ ...ty.body, color: t.ink2 }}>
                You have not logged any training of your own yet. Anything you log above appears here,
                and only you ever see it.
              </Text>
            )}
          </Section>

          <Rule />

          {/* ── which muscles the coach's own work landed on ───────────────
              The same four blocks a coach reads about a client, about
              themselves, off the same panel and the same modules — Training
              Summary, the body, the rankings and the Recovery Map.

              Built on `useWorkoutLog()`, the client-side hook, because that is
              the rule: trainers self-track and nothing in this app promotes a
              client path into a trainer one. The provider reads the signed-in
              user's rows, so in the coach app it is the coach's own training
              and can never be somebody else's — the header on this file records
              the one time that was got wrong, on a dashboard sheet that showed
              a coach their own volume under a client's name.

              `status === 'error' ? null : log` for the same reason every other
              screen in this app does it: `useWorkoutLog` keeps whatever it had
              before a failure, and a stale array under 'error' drawn as a body
              is a picture of a week that may not be this one. Null is the only
              value that makes the panel say it could not read.

              `cat.signedOut` is folded into the catalogue status rather than
              checked beside it: a signed-out catalogue read comes back as zero
              rows with no error, and a WHOLE read of an empty catalogue would
              publish an empty vocabulary — which is the board asserting that
              every muscle in the coach's body is untrained.

              No `fullScaleAt`: one window, one picture, so it scales to its own
              peak and the panel prints the scale beside the key. */}
          <Section>
            <SectionHead title="Your Muscles" />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              Your own training, broken down by the muscles the exercise catalogue names for each
              movement you logged. Nothing here is about a client, and nothing here is a judgement
              about how recovered you are — it is what you logged and when you logged it.
            </Text>
            <MuscleWorkPanel
              log={status === 'error' ? null : log}
              logStatus={status}
              catalogue={cat.rows}
              catalogueStatus={cat.signedOut ? 'error' : cat.status}
              nowMs={nowMs}
              windowDays={muscleDays}
              windows={MUSCLE_WINDOWS}
              onWindowDays={setMuscleDays}
              voice={{ they: 'You', their: 'your', have: 'have' }}
            />
          </Section>

          <Rule />

          {/* ── the unit these loads are read in ─────────────────────────── */}
          <Section>
            <SectionHead title="Weight Unit" />
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
              How loads are shown and read on this screen. Everything is stored in kilograms either
              way, so changing this never changes what you lifted.
            </Text>
            {/* The control is here because the coach app has no Settings screen
                that offers one, and a screen that reads loads in a unit its
                reader cannot change is a screen that lies to half its readers.
                `useSettings().set` keeps this on the device for a coach —
                `clients.weight_unit` is the account-level home for it and a
                coach has no `clients` row — so it survives a relaunch but not a
                reinstall. That is a gap in the coach app's settings, not
                something this screen can close on its own. */}
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              {(['kg', 'lb'] as const).map((u) => (
                <Pressable key={u} onPress={() => settings.set({ weightUnit: u })}
                  accessibilityRole="radio" accessibilityState={{ selected: wu === u }}
                  accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
                  style={{
                    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
                    backgroundColor: wu === u ? t.brand : t.surface2,
                  }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: wu === u ? t.brandInk : t.ink2 }}>{u}</Text>
                </Pressable>
              ))}
            </View>
          </Section>

          <Rule />

          {/* ── where a CLIENT's session goes instead ────────────────────── */}
          <Section>
            <Text style={{ ...ty.caption, color: t.ink3 }}>
              Logging a session you ran for someone else? That goes on their record, from their card on
              the Clients tab — not here.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.md }}>
              <Icon name="people" size={14} color={t.ink3} />
              <Pressable onPress={() => router.push('/(trainer)/dashboard')} hitSlop={8} accessibilityRole="button">
                <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Go to Clients</Text>
              </Pressable>
            </View>
          </Section>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
