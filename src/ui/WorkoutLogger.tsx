// The workout logger: the live session runners, their vitals and the edit
// sheet, pulled out of app/(client)/workouts.tsx so the Train screen is the
// plan and this file is the logging. Behaviour is unchanged; see the PR.
// Train — the day's session on the instrument-panel kit (`src/ui/kit`) and the
// scale (`src/theme/scale`). Every provider, hook, conditional branch and route
// from the previous version is preserved; only the presentation changed: one
// hero figure instead of a stack of competing bold numbers, hairline-separated
// sections and list rows instead of eighteen bordered cards, and accent spent
// only on the live metric and the primary action.
// Guided session runner, cardio logging & month calendar preserved.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// The clock this screen judges "today" by, kept live across the midnight a
// late session runs past. See the note at `useNow()` below.
import { useToday } from './today';
// What this member did the last time they did the movement on screen, and how
// the number sitting in the load box compares to it. The runner has held the
// log and its status since it was written and used them for one thing — the PR
// confetti — so four different reasons for a blank box all looked the same
// from the gym floor. See src/lib/lastTime.ts.
import { lastTime } from '../lib/lastTime';
import { BRAND } from '../lib/brands';
import { num, fmtDay } from '../lib/format';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Alert, KeyboardAvoidingView, Platform, AppState, StatusBar } from 'react-native';
import { GuardedImage } from './GuardedImage';
import { SessionSteps } from './SessionSteps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hrFreshness, staleHrNote } from '../lib/hrFreshness';
import { watchReach, zonesNote, liveHrNote, type WatchReach } from '../lib/watchReach';
// Whose session, whose sets, whose draft. The three keys on this screen were
// device-global, and a session restored under the wrong member is finished
// under the wrong member's id — see the header of that file.
import { DraftGate, gateForKey, gateHydrated, guidedDraftKey, mayPersist } from '../lib/sessionScope';
import { tapLight, notifySuccess } from './haptics';
import { restSecondsFor, restClock, shouldTick, DEFAULT_REST_SEC } from '../lib/restTimer';
// Supersets and set methods. Both are pure and both are read POSITIONALLY here
// — `badges` returns one entry per exercise in the order it was handed them, so
// the labels on screen describe the list on screen rather than the program as
// it was written. That matters on this file's list, which is filtered (removed
// movements) and re-sorted (progress-photo focus areas) before it is rendered.
import { badges as groupBadges } from '../lib/setGroups';
import { badgeFor, countsToVolume, methodFor, restAfter } from '../lib/setMethods';
// The sets of an exercise, one by one — a coach's ramp, a warm-up first set, a
// drop-set last one. Read through `expandSets` rather than off the fields, so a
// program that never got a table still reads as `sets` copies of one spec and
// every screen below behaves as it did. See src/lib/setRows.ts.
import { expandSets, hasSetRows } from '../lib/setRows';
// ── the block, the week of it this client is on, and the three fields a set
//    prescribes beyond reps and load ─────────────────────────────────────────
// `weekLabel` is imported under another name because this screen already has a
// `weekLabel` of its own: the CALENDAR week the day strip is scrolled to, which
// is a different week from the week of a training block and must not be
// confused with it on a screen that now shows both.
// Effort, share of a max and rep speed. `intensityLine` is the notation beside
// the set; `intensityMeaning` is the same thing in words, which is what a
// client reading "@8" for the first time needs. Neither turns a percentage into
// a weight — see the header of src/lib/setIntensity.ts.
import { intensityLine, intensityMeaning, intensityOf, readTempo, tempoMeaning } from '../lib/setIntensity';
// The other half of that prescription: what the member actually moved at.
// `packTempos` writes the column, `tempoVerdict` says what a set's tempo means
// against what was asked for, and `tempoSummary` is a saved entry's one line.
// See src/lib/performedTempo.ts — absence is never rendered as zero or as met.
import { packTempos, tempoVerdict } from '../lib/performedTempo';
import { playSound, primeSounds, releaseSounds } from './sounds';
import { scheduleRestOverAlert, cancelReminders } from './pushNotifications';
import { Icon } from './Icon';
import { SharePostButton } from './SharePost';
import { workoutPost, cardioPost } from '../lib/postCard';
import { topMovements } from '../lib/workoutShare';
import { useBrand } from './brand';
import { Rule, Section, SectionHead, SyncBadge, KpiRow, Cta, Ghost, Notice, Flag, Field, fig, TonedChip, HeroRing, CtaBright } from './kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value, font } from '../theme/scale';
import type { Theme } from '../theme/tokens';
import { type ProgramExercise } from '../lib/programs';
import { useWearables } from './wearables';
import type { WorkoutEntry } from '../lib/mockData';
import { suggestForExercise, priorBest1RM } from '../lib/progression';
import { priorTopLoad } from '../lib/sessionRecords';
import { PrFlash } from './PrFlash';
import { announcePersonalBest } from '../lib/prNotifyStore';
import { est1RM } from '../lib/streaks';
import { bodyweightAtKg, bodyweightSetLabel, type BodyweightHistory } from '../lib/bodyweightSets';
// A hold is a set whose first number is seconds. The program builder writes
// '45 sec' planks and '30 sec/side' side planks, so the prescription is read
// here to decide which box this screen opens with — see src/lib/timedSets.ts.
import { isTimedPrescription, prescribedSeconds, readHold, timedSetLabel } from '../lib/timedSets';
// The set row itself, which used to be a local component and so was reachable
// from this screen and nowhere else. See src/ui/LogSetRow.tsx.
import { SetKindChip } from './LogSetRow';
// The rest between two sets on the PLAN rows. The runner has counted one down
// since it was written; the three ways to log a set without opening the runner
// had none. Same `restTimer` arithmetic, no second copy of it.
// ── ticking a planned set off, rather than typing it out ──────────────────
//
// "A tick box to send feedback/log sets been completed." — TestFlight, 8
// September. There is no completion column on `workouts` and none was added:
// a set is done in this app because it was LOGGED, and a filled tick here is
// that logged set read back. src/lib/setTicks.ts holds the whole argument,
// including the one rule that keeps the control honest — a tap that has to
// write a rep count may only be offered where the plan names a single figure,
// which is the same rule `canQuickLog` below already applies to the one-tap
// button.
import { setTicks, ticksLine, type TickRecord } from '../lib/setTicks';
import { SetChecklist } from './SetTable';
// ── one row per set in the sheet that adds or corrects a movement ─────────
//
// The other half of the same report: "when entering amount of sets there
// should be a drop down to record with the weight being used per set". The
// count box opens a row for each set instead of making that many copies of one,
// and every decision about resizing, reading and refusing those rows is in the
// tested module rather than in this file.
// A member's own changes to the plan, kept — and sent to their coach. Four
// `useState`s held all of this and nothing wrote any of them anywhere; see
// src/lib/planEdits.ts for what that cost, and src/ui/planEdits.tsx for the
// hook that replaced them.
// Starting today from a session already in the log. The conversion is the whole
// of it and none of it is here — src/lib/repeatSession.ts carries the reasoning
// about what a logged set can and cannot be turned into.
import { Confetti } from './Confetti';
// Three outcomes, not two. Since src/ui/workoutLog.tsx was brought onto the
// offline queue a write that nobody answered is KEPT — on this phone, in the
// log, counted, and sent on the next launch that reaches a server — so every
// "it will be gone when you next open the app" on this screen had become false
// in the one direction that makes somebody retype an hour of training.
import { type WriteOutcome } from '../lib/offlineQueue';
import { type VideoItem, type LibraryStatus } from './exerciseVideos';
// `isWhole`, not `cd.injuries.length`. An empty injury list that was READ and
// one that could not be read are the same value on clientData, and every guard
// on this screen — the severe auto-swap, the hidden movement, the per-exercise
// caution line — is driven off that value alone. See `injRead` below.
import { isWhole, type LoadStatus } from './loadStatus';
import { ExerciseVideo } from './ExerciseVideo';
// The same catalogue lookup and the same renderers the standalone exercise
// screen uses. Imported rather than reimplemented: a second copy of the
// media order is a second chance for the plan screen and the runner to show
// a member two different pictures of the lift they are about to do.
import { useExerciseDetail } from './exerciseDetail';
import { useExerciseMedia } from './useExerciseMedia';
import { DemoAnimation, FrameLoop } from './ExerciseDemo';
import { demoCaption } from '../lib/exerciseMedia';
import { RepdbInlineCredit } from './Attribution';
// expo-image is required through src/ui/nativeModules.ts, never imported. Its
// entry point resolves to `requireNativeModule('ExpoImage')`, which THROWS on a
// binary that predates the dependency — and expo-image landed on 30 Aug, three
// days after the version last moved to 1.1.0, so every binary built 27-29 Aug
// takes today's bundle and has no ExpoImage in it. A bare import would take
// this whole screen down while it loaded. React Native's own <Image> is the
// fallback and is in every binary ever built.
import { videoForExercise } from '../lib/exerciseId';
import { titleCaseName } from '../lib/exerciseName';
// One classifier for "whose clip is this". A null trainer is a platform clip
// AND a handset entry whose upload was refused; only the id prefix tells them
// apart, and src/lib/clipOwner.ts is where that is written down.
import { clipOwner, type ClipOwner } from '../lib/clipOwner';
// One colour per muscle group, shared with This Week so a chip there and a
// bar here agree. See src/ui/groupTone.ts.
import { groupTone } from './groupTone';
import { injuryFlag, type Injury } from '../lib/injuries';
// "A, B and C". The one comma-and-and in this app, so a list of movements left
// undone reads the way the coverage notes already read.
import { list } from '../lib/noKitProgram';
import { warmupSets } from '../lib/training';
import { hrColor, hrZoneNo, zoneColor, zoneName, ZONE_NOS, zoneOf, zoneKey, emptyZoneSeconds, splatPoints, zoneSecondsTotal, hrScaleNote, zonesFromSamples, hrStats, type ZoneSeconds, type ZoneNo } from '../lib/hr';
import { PROVIDERS } from '../lib/wearables/registry';
import { hrKcal, hrKcalNote, hrKcalUnknown, hrKcalUnknownNote } from '../lib/hrKcal';
import { reportError } from '../lib/reportError';
// 44pt is the minimum tap target — the number and the reasoning live in one
// place, and the controls added here take it from there rather than from a
// literal that can drift.
import { MIN_TARGET, hitSlopFor } from '../lib/a11y';
import { ZoneNow, ZoneBoard } from './ZoneBoard';
import { SessionMusicBar } from './SessionMusicBar';
import { RECOVERY_ACTIVITIES } from '../lib/recoveryActs';
import { HIIT_ACTIVITIES, MOBILITY_ACTIVITIES, CARDIO_MOVEMENT_ALIASES } from '../lib/workoutKind';
import { canPairHere, pairInvite, pairInviteAction } from '../lib/sessionPairing';
import { PairMonitorSheet, usePairRows } from './PairMonitorSheet';
import { dayKeyOf, readWorkoutEdit, type WorkoutDraftSet } from '../lib/entryEdit';
import { useSettings } from './settings';
import { WeightUnitToggle } from './WeightUnitToggle';
import { liftIn, liftLabel, readLift, plain, plainExact, volumeHeadline, readNumber, type WeightUnit } from '../lib/units';
// The plate maths, at the bar rather than two screens away on Tools. Pure and
// already tested (src/lib/plateMath.test.ts); this screen only calls it.
import { BARS, loadBar } from '../lib/plateMath';
// The distance unit a cardio log opens on. Derived from the member's length
// unit rather than defaulted to km — see src/lib/distance.ts.
import { distanceUnitName, type DistanceUnit } from '../lib/distance';
// The cardio machines by their own names, matched exactly — see the note on
// CARDIO_MOVEMENTS below for why this asks no matcher at all.
import { MACHINES } from '../lib/machines';
import { WEEK_DAYS } from '../lib/weekStart';
import { BACK_ICON, FORWARD_ARROW, FORWARD_ICON } from './direction';
import { useMovementName } from './catalogueTranslations';
import { useReachability } from './reachability';
import { retryLine } from '../lib/reachability';

/** The day strip and the month sheet's column heads, in the order
 *  src/lib/weekStart.ts draws a week. Both are on this screen, and before this
 *  they were the same array by luck rather than by construction. */
export const WEEK = WEEK_DAYS;

// Where the guided runner's sets live between the moment they are typed and the
// moment the server takes them is no longer a constant here. It was
// `repple.guidedSession` — one key for the handset — and it is now one key per
// ACCOUNT, composed by `guidedDraftKey` in src/lib/sessionScope.ts and built
// inside SessionRunner where the member's id is in scope. One key per account
// and not one per day is still right: only one guided session can be running,
// and the day it belongs to is stored inside so a stale one cannot be poured
// into a different session. See the restore in SessionRunner for why it is not
// deleted when it cannot be read.
// Session catalog. Each activity carries its own MET value, because the two used
// to live in separate structures keyed by the display string: renaming a label
// silently detached it from its MET, and `cardioKcal` falls back to 7 for an
// unknown key — so a typo would have quietly changed a client's calorie estimate
// with nothing to show for it. One entry, one place.
//
// Titles are Title Case throughout and each list is alphabetical. Acronyms
// (EMOM, AMRAP) stay upper-case; they are not words.
// `met: null` means "this is not exercise expenditure and no calorie figure
// may be derived from it". A sauna raises heart rate, but the energy cost is
// thermoregulation rather than work, so any kcal we printed beside it would be
// invention. Null travels all the way to the log, which renders it as a dash.
export interface Activity { name: string; met: number | null }

export const CARDIO_ACTS: Activity[] = [
  { name: 'Cycling',          met: 7.5 },
  { name: 'Elliptical',       met: 5.0 },
  { name: 'Rowing',           met: 7.0 },
  { name: 'Ski Erg',          met: 9.0 },
  { name: 'Stairs',           met: 8.0 },
  { name: 'Swim',             met: 8.0 },
  { name: 'Treadmill / Run',  met: 9.8 },
  { name: 'Walk',             met: 3.8 },
];

// The HIIT and mobility names live in src/lib/workoutKind.ts for the same
// reason the recovery names live in src/lib/recoveryActs.ts: one array with two
// consumers cannot drift. The second consumer is the calendar, which colours a
// day's dot by what kind of session was logged and has nothing but the name to
// go on — so a HIIT activity added to this picker and nowhere else would show
// up there as strength.
export const HIIT_ACTS: Activity[] = HIIT_ACTIVITIES;

// Recovery is time spent deliberately not training. Duration and heart rate are
// real measurements and are kept; calories are not derivable and are not shown.
// The names live in src/lib/recoveryActs.ts so the Recovery screen and this one
// cannot drift — a modality added there appears in both places.
export const RECOVERY_ACTS: Activity[] = RECOVERY_ACTIVITIES.map((name) => ({ name, met: null }));

export const MOBILITY_ACTS: Activity[] = MOBILITY_ACTIVITIES;

// Sorted here as well as written in order, so a later addition dropped in the
// wrong place still renders alphabetically.
export const byName = (a: Activity, b: Activity) => a.name.localeCompare(b.name);
export const names = (acts: Activity[]) => [...acts].sort(byName).map((a) => a.name);

export const CARDIO = names(CARDIO_ACTS);

/* IS THIS MOVEMENT SOMETHING YOU RIDE, ROW OR RUN?
 *
 * Matched on the WHOLE name against the two lists this app already keeps — the
 * cardio activities the timer offers, and the cardio machines by their own
 * names. It does NOT ask a matcher, and the reason is worth keeping even though
 * the matcher has since been repaired.
 *
 * `isCardioName` used to live in src/lib/machines.ts and answered this question
 * wrongly in both directions — true for 'Barbell Row', because 'Rowing Machine'
 * leads that catalogue carrying the bare key 'row'; false for 'Cycling',
 * because the bike's key is 'cycle' and 'cycling' does not contain it. Both are
 * the wrong answer for a movement in a plan, and the first is much the worse: a
 * distance box on a barbell row invites a figure that then reclassifies the
 * whole entry as cardio.
 *
 * That function is now deleted, and `identifyMachine` takes the best match
 * rather than the first, so the row no longer resolves to a rower. This list
 * stays exact anyway, because the two questions are genuinely different: that
 * one asks what a scanned machine IS and may answer null and let somebody pick,
 * while this one decides which boxes to draw on a plan and has nobody to ask.
 * An exact match here can only ever miss an oddly-named bike, which costs one
 * box nobody was offered; a loose one puts a distance on a deadlift day.
 */
export const CARDIO_MOVEMENTS: ReadonlySet<string> = new Set(
  [
    ...CARDIO_ACTS.map((a) => a.name),
    ...MACHINES.filter((m) => m.cardio).map((m) => m.name),
    // The same movements under the names a program calls them. Without these
    // the set held only the names THIS app writes, so a member cycling inside a
    // coach's program — where the movement might be 'Bike' or 'Indoor
    // Cycling' — was offered no distance box and no way to record the ride.
    // Still exact, still no substring: see the note in src/lib/workoutKind.ts.
    ...CARDIO_MOVEMENT_ALIASES,
  ].map((n) => n.trim().toLowerCase()),
);
export const isCardioMovement = (name: string) => CARDIO_MOVEMENTS.has((name ?? '').trim().toLowerCase());
export const SESSION_TYPES: Record<'cardio' | 'hiit' | 'mobility' | 'recovery', string[]> = {
  cardio: CARDIO,
  hiit: names(HIIT_ACTS),
  mobility: names(MOBILITY_ACTS),
  recovery: names(RECOVERY_ACTS),
};
// 'stretch' is a MODE, not a kind, and the difference is the whole design of
// this row. KIND_LABEL in src/lib/workoutKind.ts already documents the same
// separation for the entry beside it: 'strength' reads "Strength" on a calendar
// dot and "Program" here, because this row names WHAT YOU ARE ABOUT TO DO and a
// kind names WHAT A PAST SESSION WAS.
//
// So Stretch opens the routine library, and a routine finished there is
// committed as a MOBILITY session called "Stretching" — the identical entry the
// Mobility chip has always written. It is not a sixth WorkoutKind: there is no
// `kind` column on `workouts`, so a kind is derived from the exercise name, and
// promoting "Stretching" out of MOBILITY_ACTIVITIES would silently re-colour
// every mobility session anybody has ever logged. The reasoning in full is at
// the head of src/lib/stretchRoutine.ts.
export const WTYPES = [['strength', 'Program'], ['cardio', 'Cardio'], ['hiit', 'HIIT'], ['mobility', 'Mobility'], ['recovery', 'Recovery'], ['stretch', 'Stretch']] as const;

/** What this screen is currently offering to do. Two of the six are not a
 *  clock over an activity: 'strength' is today's program, and 'stretch' is a
 *  library of guided routines. */
export type TrainMode = 'strength' | 'cardio' | 'hiit' | 'mobility' | 'recovery' | 'stretch';

/** The four session types that are an activity and a clock rather than a list
 *  of lifts. Named because both the log form and the live runner below branch
 *  on it, and recovery has to stay distinguishable from the other three. */
export type SessionKind = 'cardio' | 'hiit' | 'mobility' | 'recovery';

/** True for a mode that IS a clock over an activity — the four above, and not
 *  the program or the stretch library. One predicate rather than
 *  `m !== 'strength'` repeated, which is what silently started indexing
 *  SESSION_TYPES with 'stretch' the moment a sixth mode existed. */
export const isSessionKind = (m: TrainMode): m is SessionKind => m !== 'strength' && m !== 'stretch';
export const KIND_LABEL: Record<SessionKind, string> = { cardio: 'Cardio', hiit: 'HIIT', mobility: 'Mobility', recovery: 'Recovery' };

// Approx METs per activity — kcal = MET x weight(kg) x hours (standard estimate).
export const MET: Record<string, number> = Object.fromEntries(
  [...CARDIO_ACTS, ...HIIT_ACTS, ...MOBILITY_ACTS, ...RECOVERY_ACTS]
    .filter((a) => a.met != null)
    .map((a) => [a.name, a.met as number]),
);
// Returns null when we do not know what the client weighs. It used to fall
// back to 70 kg, so the burn shown next to a session was MET x 70 regardless
// of who was training, and that number was written into the workout log and
// re-surfaced in the weekly report as a measured figure.
//
// It also used to fall back to MET 7 — roughly rowing — for any activity not in
// the table. That made a typo, or a new entry like Sauna, silently produce a
// plausible-looking burn for something nobody had measured. An unknown MET is
// now null, exactly as an unknown weight is.
export const cardioKcal = (type: string, mins: number, weightKg?: number | null): number | null => {
  const met = MET[type];
  if (met == null) return null;
  return (weightKg && weightKg > 0) ? Math.round(met * weightKg * (mins / 60)) : null;
};

/** Metric columns divided by a hairline — the KpiRow idiom, where a status dot is needed. */
/**
 * The app's theme with its grounds and inks swapped for the night set.
 *
 * For the parts of this file that are handed `t` as a PROP and are drawn on
 * the night ground — the Train hero's picture and the live runner's focus
 * mode. A part that reads the theme itself (`Notice`, `Flag`, the zone board,
 * the music bar) cannot be reached this way, which is why the runner sets
 * those on a day-surface card rather than on the night ground.
 *
 * `brandText` becomes the night eyebrow ink: the bright accent is measured as
 * a MARK on night (3:1), and a word needs more than that.
 */
export const onNight = (t: Theme): Theme => ({
  ...t, bg: t.night, surface: t.night2, surface2: t.night2, surface3: t.night2, ring: t.nightInk2,
  ink: t.nightInk, ink2: t.nightInk2, ink3: t.nightInk2,
  brand: t.brandBright, brandInk: t.brandDeep, brandText: t.nightInk3,
});

export function MetricCols({ t, items }: { t: Theme; items: { label: string; value: string; dot?: string }[] }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {items.map((k, i) => (
        <View key={k.label} style={{ flex: 1, paddingEnd: sp.md, paddingStart: i === 0 ? 0 : sp.lg, borderStartWidth: i === 0 ? 0 : hairline, borderStartColor: t.ring }}>
          <Text style={{ ...ty.caption, color: t.ink3 }} numberOfLines={1}>{k.label}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
            {k.dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: k.dot }} /> : null}
            <Text style={{ ...value(20), color: t.ink }}>{k.value}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}


// `BodyweightChip`. They are src/ui/LogSetRow.tsx now: a member standing in
// front of a machine reaches app/(client)/exercise.tsx, not this screen, and a
// row that could only be typed into from the plan was the whole of why that
// screen could not log a set.

/**
 * The measured half of a live session: the clock, the current heart rate, the
 * peak, the watch's calorie delta and the seconds banked in each zone.
 *
 * Shared by both runners rather than written out twice, because the rule it
 * encodes is subtle and getting it wrong was a real bug. `heartRateLatest` is
 * the most recent SAMPLE and is only ever set by HealthKit (see
 * appleHealth.ts). Cloud providers leave it null: WHOOP, Oura and Fitbit expose
 * no intraday samples at all, and WHOOP's `heartRateAvg` is the average across
 * the whole physiological day.
 *
 * So the daily average is kept as a display fallback for the bpm column, but it
 * must NEVER drive the zone: accumulating time-in-zone against a static
 * day-average would invent a zone breakdown for a session it never measured — a
 * WHOOP user would finish and see "42 min in Zone 2" derived from one number
 * that had nothing to do with the workout.
 */
export function useLiveVitals(age: number | null, restingKcalPerMin: number | null, paused = false, startedAtMs?: number | null, pausedMsSeed = 0) {
  const w = useWearables();
  // A real reading — and, separately, whether it is a CURRENT one.
  //
  // These were one thing, and the comment here called the sample "a real,
  // current reading". The first half was true. The second was an assumption,
  // and it is the whole of the report that a cardio session shows a heart rate
  // which never changes: an Apple Watch only streams to HealthKit while a
  // workout runs ON THE WATCH, so away from one this is the same sample for
  // minutes at a time. src/lib/hrFreshness.ts holds the argument.
  const liveSample = w.today.heartRateLatest;
  const hrFresh = hrFreshness(w.today.heartRateLatestAt, Date.now());
  // Zones, peak and the session average are built from a sample only while it
  // is MOVING. A stale one repeated into a zone timer banks minutes in a zone
  // the member has left, and these figures reach the health record.
  const freshSample = hrFresh.state === 'live' ? liveSample : null;
  const liveHr = liveSample ?? w.today.heartRateAvg;   // display only
  const startKcalRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [hrPeak, setHrPeak] = useState<number | null>(null);
  // The session's burn is the day's counter minus what it read when the
  // session started.
  //
  // WHICH counter matters. Some devices publish energy above rest (Oura,
  // Apple) and some publish the whole day including resting metabolism
  // (WHOOP). Differencing a whole-day counter over an hour hands back the
  // hour's resting burn as if it were the session — roughly 70 kcal, credited
  // to a workout that did not do it — so the resting share of the elapsed time
  // is taken back off. `restingKcalPerMin` is null when there is no body to
  // compute a resting rate from, and then a total-only device reports nothing
  // rather than an overstatement.
  const dayKcal = typeof w.today.activeKcal === 'number' ? w.today.activeKcal : w.today.totalKcal;
  const dayKind: 'active' | 'total' = typeof w.today.activeKcal === 'number' ? 'active' : 'total';
  if (startKcalRef.current == null && typeof dayKcal === 'number') startKcalRef.current = dayKcal;
  const rawSession = (typeof dayKcal === 'number' && startKcalRef.current != null)
    ? Math.max(0, Math.round(dayKcal - startKcalRef.current)) : null;
  const restingShare = (dayKind === 'total' && restingKcalPerMin != null) ? restingKcalPerMin * (elapsed / 60) : 0;
  const sessionKcal = rawSession == null ? null
    : (dayKind === 'total' && restingKcalPerMin == null) ? null
    : Math.max(0, Math.round(rawSession - restingShare));
  // Elapsed is read off the wall clock rather than counted up a tick at a time.
  // A phone that locks or backgrounds the app stops delivering the interval, so
  // a counter would silently under-report — and for a timed session that number
  // is not just a display, it is the duration written to the log.
  // Seeded from a restored session when there is one, so a workout that was
  // interrupted resumes at the elapsed it had REACHED rather than at zero.
  // Restarting the clock would be the quiet version of the same defect: the
  // session would look continuous and report a duration that is short by
  // however long the phone was away, into a health record.
  const startedAtRef = useRef(startedAtMs ?? Date.now());
  // Time the member was not training, taken back off the wall clock.
  //
  // The clock is deliberately read off the wall rather than counted up, so it
  // survives a locked phone — and that is exactly why a pause cannot simply
  // stop the interval. The wall goes on regardless, and a session paused for a
  // phone call would come back forty minutes longer. `sessionMins` is written
  // to the health record, so this is a figure that has to be true.
  const pausedAtRef = useRef<number | null>(null);
  // Pauses the session had already banked before it went away.
  const pausedMsRef = useRef(pausedMsSeed);
  const pausedRef = useRef(paused);
  if (paused && pausedAtRef.current == null) { pausedAtRef.current = Date.now(); }
  if (!paused && pausedAtRef.current != null) { pausedMsRef.current += Date.now() - pausedAtRef.current; pausedAtRef.current = null; }
  pausedRef.current = paused;
  const awayMs = () => pausedMsRef.current + (pausedAtRef.current != null ? Date.now() - pausedAtRef.current : 0);
  useEffect(() => {
    const tick = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAtRef.current - awayMs()) / 1000))), 1000);
    const q = setInterval(() => w.syncAll(), 10000);
    w.syncAll();
    return () => { clearInterval(tick); clearInterval(q); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (typeof freshSample === 'number' && freshSample > 0) setHrPeak((p) => (p == null || freshSample > p ? freshSample : p)); }, [freshSample]);

  // Time in zone, accumulated a second at a time against the latest reading.
  // `hrRef` keeps the tick reading the current bpm without re-arming the interval.
  const [zoneSecs, setZoneSecs] = useState<ZoneSeconds>(emptyZoneSeconds);
  /** The session's OWN average heart rate, from the samples the rebuild
   *  fetches. `w.today.heartRateAvg` is the whole day's — a morning ride
   *  averaged with eight hours at a desk — and a calorie model fed that would
   *  describe a different session. Null until a rebuild has run. */
  const [sessionAvgBpm, setSessionAvgBpm] = useState<number | null>(null);
  const hrRef = useRef<number | null>(null);
  hrRef.current = typeof freshSample === 'number' && freshSample > 0 ? freshSample : null;
  useEffect(() => {
    const z = setInterval(() => {
      // Nothing is banked while the session is paused. Time in zone is minutes
      // of training, and a member sitting on a bench taking a call is still
      // wearing the watch — crediting those minutes would put a rest into the
      // zone breakdown the finish screen prints as effort.
      if (pausedRef.current) return;
      const bpm = hrRef.current;
      if (!bpm) return; // no reading → bank nothing, rather than crediting zone 1
      setZoneSecs((p) => ({ ...p, [zoneKey(zoneOf(bpm, age))]: p[zoneKey(zoneOf(bpm, age))] + 1 }));
    }, 1000);
    return () => clearInterval(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [age]);

  /**
   * Throw the tick-counted breakdown away and rebuild it from the watch.
   *
   * The counting above banks a second at a time, and iOS stops delivering
   * timers to an app that is not on screen — so a ride with the phone in a
   * pocket banks a fraction of itself. The watch was recording throughout; only
   * our counting stopped. HealthKit will hand back every sample it took, so the
   * honest breakdown is the one rebuilt from those, not the one we managed to
   * count while being looked at.
   *
   * It REPLACES rather than adds. Rebuilding covers the whole window including
   * the part we did count, so adding would double it.
   *
   * The full-resolution read, not the chart one: that thins the series to keep
   * an SVG light, which drops short bursts into zone 4 — and a splat point is a
   * minute at zone 4 or above.
   *
   * Silent on failure, and that is deliberate. There is no watch on Android's
   * Health Connect path, a member may have refused heart-rate permission, and a
   * session may genuinely have no samples. In every one of those the tick count
   * is the best thing anybody has, and the board already says how much of the
   * session it does not account for. Replacing a real count with nothing
   * because a read failed would be the loss this function exists to prevent.
   */
  const rebuildZonesFromWatch = useCallback(async (): Promise<void> => {
    try {
      // Whichever connected source can actually hand back samples — HealthKit
      // on iOS, Health Connect on Android. Not pinned to Apple: the Android
      // read exists now, and a cloud vendor deliberately does not offer this
      // method at all, because WHOOP, Oura and Fitbit return day aggregates and
      // there is nothing per-second in them to rebuild a breakdown from.
      const source = PROVIDERS.find((p) => typeof p.fetchHeartRateSamples === 'function' && p.isAvailable());
      const fetchSamples = source?.fetchHeartRateSamples;
      if (!fetchSamples || !source) return;
      const startISO = new Date(startedAtRef.current).toISOString();
      const endISO = new Date(Date.now()).toISOString();
      const pts = await fetchSamples(startISO, endISO);
      const rebuilt = zonesFromSamples(pts, age, startISO, endISO);
      if (rebuilt) setZoneSecs(rebuilt);
      // The same samples answer a second question for free: what this session
      // actually averaged. Only from a real series — one reading is an instant
      // and says nothing about a session.
      const stats = pts.length >= 2 ? hrStats(pts) : null;
      if (stats) setSessionAvgBpm(stats.avg);
    } catch (e) {
      reportError('liveVitals.rebuildZones', e);
    }
  }, [age]);

  // On the way back to the screen, and once more at the finish. Coming back is
  // when the gap has just happened and is largest; the finish is what gets
  // written to the log, and is the one that has to be right.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void rebuildZonesFromWatch();
    });
    return () => sub.remove();
  }, [rebuildZonesFromWatch]);

  // Is there a source that can stream SAMPLES at all — HealthKit or Health
  // Connect? A cloud vendor returns day aggregates and cannot produce zones,
  // so it deliberately does not count as "a watch is connected".
  const localConnected = PROVIDERS.some(
    (p) => (p.meta.kind === 'healthkit' || p.meta.kind === 'health-connect')
      && w.states[p.meta.id] === 'connected' && p.isAvailable());
  const reach = watchReach(localConnected, liveSample != null, hrFresh.state);
  return { w, reach, elapsed, liveSample, freshSample, hrFresh, liveHr, hrPeak, sessionKcal, zoneSecs, rebuildZonesFromWatch, sessionAvgBpm, liveZone: hrZoneNo(freshSample, age) };
}

/**
 * Live effort, drawn the same way in every running session: the zone numeral
 * leads and colour only confirms it.
 *
 * One component rather than a copy per runner, because of what it does when
 * there is no heart rate. This block used to render NOTHING without a watch —
 * no zones, and no reason for their absence — so the one screen where live
 * zones belong looked like it had never been built, which is exactly how it was
 * reported. A second copy of it would be a second chance to forget that, and
 * the timed sessions below are the ones most likely to be run without a watch.
 *
 * Deliberately not a link to the settings: leaving mid-session to go and pair a
 * device would abandon the workout being logged.
 */
export function ZonePanel({ t, liveZone, liveSample, zoneSecs, age, elapsed, reach, onPair }: {
  t: Theme; liveZone: ZoneNo | null; liveSample: number | null;
  /** Whether a watch can reach this panel at all, and why not. Decided by
   *  src/lib/watchReach.ts — the panel used to assume 'none' and tell a member
   *  with a connected watch to connect a watch. */
  reach?: WatchReach; zoneSecs: ZoneSeconds;
  /** The member's age, or null when the app has no date of birth for them —
   *  which is the case this panel now has to say something about. */
  age: number | null;
  /** The session clock. Passed through so the board can say how much of the
   *  session these five rows do not account for. */
  elapsed?: number | null;
  /**
   * Open the in-session pairing sheet.
   *
   * The comment on this component used to end at "Deliberately not a link to
   * the settings: leaving mid-session to go and pair a device would abandon the
   * workout being logged" — a correct refusal with nothing on the other side of
   * it, so a member with no heart rate finished without one and the samples for
   * that hour were never asked for and cannot be recovered. This is the third
   * option the refusal implied: a sheet OVER the runner. Optional, because a
   * caller that has nowhere to put one is better off with the settings sentence
   * than with a button that goes nowhere.
   */
  onPair?: () => void;
}) {
  const hasZones = zoneSecondsTotal(zoneSecs) > 0;
  // Whether pairing here could lead anywhere: a build with no native health
  // module has nothing to offer, and `pairInvite` returns null for it so the
  // panel falls back to `zonesNote`, which is still true.
  const canPair = canPairHere(usePairRows());
  const invite = onPair ? pairInvite(reach ?? 'none', canPair) : null;
  // Whose scale this is. Every band on this panel is a percentage of 220 − age,
  // and with no date of birth on the profile that age is thirty — so a member
  // of fifty-five was being shown a zone 5 that starts 23 bpm above the top of
  // their actual range, on the one screen in this app that asks somebody to
  // push harder. The guess is kept (see ASSUMED_AGE in src/lib/hr.ts: zones
  // with no colour on them are a worse product than approximate ones) and it is
  // no longer silent. Null for a member whose age we have, so nobody is
  // apologised to about a scale that is theirs.
  const scaleNote = hrScaleNote(age);
  if (!liveZone && !hasZones) {
    return (
      <View style={{ marginTop: sp.xl, paddingVertical: sp.md, paddingHorizontal: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm }}>
        <Text style={{ ...ty.label, ...font('600'), color: t.ink }}>Heart-Rate Zones</Text>
        {/* rtl-ok: a navigation PATH inside an English sentence — "the screen
            called X, and inside it the thing called Y". The separator belongs to
            the sentence, not to the layout: dropping FORWARD_CHAR into it would
            put a mirrored chevron in the middle of an unmirrored English clause,
            which is worse than leaving it. When the catalogue is translated the
            whole sentence moves and the separator goes with it.

            `zonesNote` only when there is no sheet to open. Its 'none' sentence
            names the settings screen, which is the trip that loses the session
            — true advice for every screen that cannot pair in place, and the
            wrong thing to print directly above a button that can. */}
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
          {invite ?? zonesNote(reach ?? 'none') ?? ''}
        </Text>
        {invite && onPair ? (
          <Pressable
            onPress={() => { tapLight(); onPair(); }}
            accessibilityRole="button"
            accessibilityLabel={pairInviteAction(reach ?? 'none') + ' without leaving your session'}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.md, alignSelf: 'flex-start', backgroundColor: t.surface, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 8 }}
          >
            <Icon name="heart" size={13} color={t.brand} />
            <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>{pairInviteAction(reach ?? 'none')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ marginTop: sp.xl }}>
      <ZoneNow zone={liveZone} bpm={liveSample ?? null} compact />
      {hasZones ? (
        <View style={{ marginTop: sp.lg }}>
          <ZoneBoard seconds={zoneSecs} current={liveZone} elapsed={elapsed} />
        </View>
      ) : null}
      {scaleNote ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{scaleNote}</Text>
      ) : null}
    </View>
  );
}

/**
 * A started session for the four types that are an activity and a clock:
 * cardio, HIIT, mobility and recovery.
 *
 * Deliberately NOT SessionRunner. That component is built end to end around
 * `ProgramExercise[]` — an index into a list of lifts, a per-exercise results
 * array, rest timers between sets, warm-up ramps, PR detection from estimated
 * 1RM, and a finish that writes one entry per exercise with `sets`. A sauna or
 * a rowing piece has none of that, and threading a "there are no sets" flag
 * through every one of those branches would make the guided session — the flow
 * that already works — carry the weight of a case it never sees. What the two
 * genuinely share is the vitals hook and the zone panel above, so those are
 * shared and the rest is not.
 */
export function TimedSessionRunner({ t, kind, activity, age, restingKcalPerMin, defaultUnit, weightKg, sex, resumeAt, onSave, onClose }: {
  /** Where a RESTORED session resumes — wall-clock start and the pauses it
   *  had already banked. Null for one starting now. */
  resumeAt?: { startedAt: number; pausedMs: number } | null;
  // `DistanceUnit`, not `string`. The toggle inside this runner reads the unit
  // back out in words for a screen reader, and a bare string would let a caller
  // seed it with anything and have the sentence say "miles" about it.
  t: Theme; kind: SessionKind; activity: string; age: number | null; restingKcalPerMin: number | null; defaultUnit: DistanceUnit;
  /** For the heart-rate calorie estimate offered when no watch put a figure on
   *  the session. Both nullable and neither defaulted: src/lib/hrKcal.ts
   *  declines to produce a figure rather than assume a body. */
  weightKg: number | null; sex: 'male' | 'female' | null;
  /** Resolves whether the server took it. It used to return void and the
   *  caller closed the modal on the tap, so a refused write shut the one
   *  screen holding the session's heart-rate zones — the single thing in
   *  this app nobody can retype. It stays open on false. */
  onSave: (v: { mins: number; dist: number; unit: string; watts: number; kcal: number | null; zones: ZoneSeconds }) => Promise<boolean>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 44);
  const { w, reach, elapsed, liveSample, freshSample, hrFresh, liveHr, hrPeak, sessionKcal, zoneSecs, liveZone, rebuildZonesFromWatch, sessionAvgBpm } = useLiveVitals(age, restingKcalPerMin, false, resumeAt?.startedAt ?? null, resumeAt?.pausedMs ?? 0);

  /* The in-session pairing sheet. State rather than a route, because a route
   * is what the ZonePanel comment refuses: `router.push` unmounts this runner,
   * and the sets in it exist nowhere else until the finish writes them. */
  const [pairing, setPairing] = useState(false);
  const [finalElapsed, setFinalElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [confetti, setConfetti] = useState(false);
  // Distance, watts and calories are only ever what the person tells us. The
  // clock is measured; these are not, so they stay blank until typed and a
  // blank one is written as "no figure" rather than as a zero.
  const [dist, setDist] = useState(''); const [unit, setUnit] = useState(defaultUnit);
  const [watts, setWatts] = useState(''); const [kcalIn, setKcalIn] = useState('');
  const [saving, setSaving] = useState(false);
  const recovery = kind === 'recovery';
  const { appName: brandName } = useBrand();
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // The log stores whole minutes, so anything under thirty seconds rounds to
  // nothing. Rather than round it up to a minute it never lasted, the save is
  // withheld and says why — a session too short to record is not a session.
  const finalMins = Math.round(finalElapsed / 60);

  /**
   * A second calorie figure, from this member's own body and their own heart
   * rate — offered, never applied.
   *
   * The ask was to take the machine's number and correct it for heart rate,
   * age, height and weight. That is not a thing that can be done honestly: a
   * machine's figure is already an estimate made without knowing who is on it,
   * and there is no way to undo an assumption nobody told us. So this computes
   * an INDEPENDENT figure and puts it beside the box, and the member decides.
   *
   * The average comes from the session's own samples, not from
   * `w.today.heartRateAvg` — that is the whole day, a morning ride averaged
   * with eight hours at a desk, and a model fed that describes a different
   * session. It is therefore null until the rebuild has answered, which is why
   * this is a suggestion under the field rather than something `finish` writes:
   * finish runs before the samples are back.
   */
  const hrInput = useMemo(() => ({
    avgBpm: sessionAvgBpm ?? undefined,
    minutes: Math.round(finalElapsed / 60),
    age: age ?? undefined,
    weightKg: weightKg ?? undefined,
    sex: sex ?? undefined,
  }), [sessionAvgBpm, finalElapsed, age, weightKg, sex]);

  const hrEstimate = useMemo(() => (recovery ? null : hrKcal(hrInput)), [recovery, hrInput]);

  /**
   * Why there is no figure, when there is none.
   *
   * The offer above was rendered only when the estimate existed, and nothing
   * was rendered when it did not — so a member for whom the model declines saw
   * an empty space under the Calories box and no way to know whether the
   * feature was missing, broken, or waiting on something of theirs.
   *
   * It is not a rare case. `sex` is one of the five inputs and `clients.sex`
   * is written by nothing in this product, so today it is null for every
   * member and this branch is the one everybody gets. The sentence names each
   * missing input; for sex it says there is nowhere to record it rather than
   * sending them to a profile screen that has no such field.
   *
   * Not shown for recovery, where the section above already explains that a
   * calorie figure is not ours to record at all.
   */
  const hrUnknownNote = useMemo(
    () => (recovery ? null : hrKcalUnknownNote(hrKcalUnknown(hrInput))),
    [recovery, hrInput],
  );

  const finish = () => {
    // Ask the watch what actually happened, before the figures are frozen.
    //
    // This is the moment that matters: `finish` is what the log keeps, and the
    // tick-counted breakdown behind it is only ever as complete as the time the
    // screen spent being looked at. The rebuild replaces it with the samples
    // the watch took throughout — including every minute the phone was in a
    // pocket, which is most of a ride.
    //
    // Deliberately NOT awaited. The finish screen appears now, as it always
    // has, and the zone rows fill in a moment later when the read returns; the
    // save happens from that screen and not from here. Blocking the button on a
    // HealthKit round trip would make finishing a session feel broken to buy an
    // accuracy the member cannot see yet.
    void rebuildZonesFromWatch();
    setFinalElapsed(elapsed);
    // The watch's calorie delta across the session is a real measurement, so it
    // seeds the field instead of the MET estimate — which is only ever a stand-in
    // for not having measured. It is editable, and it is never offered for
    // recovery, where a calorie figure is not ours to record at all.
    if (!recovery && sessionKcal != null && sessionKcal > 0) setKcalIn(String(sessionKcal));
    setFinished(true);
    setConfetti(true);
  };

  const discard = () => {
    Alert.alert(
      `Discard This ${KIND_LABEL[kind]} Session?`,
      // The clock the member is LOOKING at. Once `finish` has run the screen
      // shows `finalElapsed`, frozen at the tap, while `elapsed` keeps
      // counting underneath — so this dialog said "1:50 on the clock" over a
      // screen reading 1:31. Two numbers for one session, in the sentence
      // asking somebody to throw it away.
      `${clock(finished ? finalElapsed : elapsed)} on the clock. Nothing is written to your log.`,
      [{ text: 'Keep Going', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: onClose }],
    );
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12, flex: 1, ...ty.body } as const;

  if (finished) {
    const strip: { label: string; value: string; dot?: string }[] = [
      { label: 'Time', value: clock(finalElapsed) },
    ];
    if (hrPeak != null) strip.push({ label: 'Peak Bpm', value: fig(hrPeak), dot: hrColor(hrPeak, age) });
    if (typeof w.today.heartRateAvg === 'number') strip.push({ label: 'Avg Bpm', value: fig(w.today.heartRateAvg) });
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 10 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ alignItems: 'center', marginTop: sp.xl }}><Icon name="trophy" size={40} color={t.brand} /></View>
          <Text style={{ ...ty.title, color: t.ink, textAlign: 'center', marginTop: sp.md }}>{activity}</Text>
          <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>{KIND_LABEL[kind]} session</Text>
          <Section>
            <MetricCols t={t} items={strip} />
          </Section>
          <Rule />
          {/* The boxes come FIRST, and the zone board after them.
              They were the other way round, and the report was that a finished
              cycling session gave no way to enter distance or average watts. It
              did — under a five-row zone board, a splat line and, as of this
              morning, a paragraph about time that was not counted. The one
              section on this screen that asks for anything was the last thing
              on it. What is above it now is a summary somebody reads; what is
              below is a result they look at. */}
          {/* Nothing to fill in when nothing can be saved.
              Reproduced in the simulator: on a session under a minute this
              screen drew Distance, Avg watts and Calories as ordinary editable
              boxes, said "nothing here is required", and then offered only
              Close — no Save. A member could type a distance and a wattage and
              there was no button that kept them. Asking for input and then
              refusing to take it is worse than not asking: it reads as the
              boxes being broken, which is exactly how it was reported.
              The sentence below explains why the session is not being kept, and
              it should be the only thing here. */}
          {finalMins <= 0 ? null : recovery ? (
            <Section>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                Recovery records how long it lasted, and nothing else. A sauna raises your heart rate, but the cost is
                keeping you cool rather than work done, so a distance or a calorie figure here would be made up.
              </Text>
            </Section>
          ) : (
            <Section>
              <SectionHead title="Anything to Add" />
              <Field label="Distance" hint={unit}>
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  <TextInput value={dist} onChangeText={setDist} keyboardType="decimal-pad" style={inp} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`Distance unit: ${distanceUnitName(unit)}. Switch to ${distanceUnitName(unit === 'km' ? 'mi' : 'km')}`}
                    onPress={() => setUnit(unit === 'km' ? 'mi' : 'km')} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, justifyContent: 'center' }}>
                    <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>{unit}</Text>
                  </Pressable>
                </View>
              </Field>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                <Field label="Avg Watts" hint="optional">
                  <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" style={inp} />
                </Field>
                <Field label="Calories" hint="kcal · optional">
                  <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" style={inp} />
                </Field>
              </View>
              {/* Offered, not applied. If the watch measured the session its
                  figure is already in the box above; this is the other opinion,
                  and a member who knows their machine reads high can take it. */}
              {hrEstimate != null && String(hrEstimate) !== kcalIn.trim() ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${hrEstimate} calories, worked out from your heart rate`}
                  onPress={() => { setKcalIn(String(hrEstimate)); tapLight(); }}
                  style={{ marginTop: sp.sm }}>
                  <Text style={{ ...ty.caption, color: t.brandText, ...font('500') }}>
                    Use {plainExact(hrEstimate)} kcal from your heart rate
                  </Text>
                  <Text style={{ ...ty.micro, color: t.ink3, marginTop: 2 }}>
                    {hrKcalNote(hrEstimate, sessionAvgBpm)}
                  </Text>
                </Pressable>
              ) : hrEstimate == null && hrUnknownNote ? (
                /* The blank, named. A missing figure is a fact about what this
                   app was told, and saying which thing it was missing is the
                   difference between a feature that is waiting and one that
                   looks broken. */
                <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                  {hrUnknownNote}
                </Text>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {sessionKcal != null && sessionKcal > 0
                  ? 'Calories came from your watch for this session. Change them if you would rather use the machine’s figure. Nothing here is required; leave a box empty and it is left out rather than saved as a zero.'
                  : 'The clock was measured; these were not. Nothing here is required. Leave a box empty and it is left out rather than saved as a zero.'}
              </Text>
            </Section>
          )}

          {zoneSecondsTotal(zoneSecs) > 0 ? (<>
            <Section>
              <SectionHead title="Time in Zone" note={`${splatPoints(zoneSecs)} Splat`} />
              <ZoneBoard seconds={zoneSecs} showSplat={false} elapsed={elapsed} />
            </Section>
            <Rule />
          </>) : null}

          {finalMins > 0 ? (
            // Guarded against a second tap. The sheet no longer closes on the
            // tap itself, so an impatient double-press on gym wifi would
            // otherwise insert the same session twice.
            <Cta label={saving ? 'Saving…' : 'Save to Your Log'} wide onPress={() => {
              if (saving) return;
              setSaving(true);
              void onSave({
                mins: finalMins,
                // `readNumber`, not `parseFloat`. Distance is the one cardio figure that is
                // genuinely fractional — 12.7 km is an ordinary run — so its box is a decimal
                // pad, and the decimal key on that pad is a comma in most of Europe.
                // `parseFloat('12,7')` is 12, and 700 metres would vanish from the record.
                dist: readNumber(dist) ?? 0,
                unit,
                watts: parseInt(watts, 10) || 0,
                kcal: parseInt(kcalIn, 10) || 0,
                zones: zoneSecs,
              }).finally(() => setSaving(false));
            }} />
          ) : (
            <View>
              <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginBottom: sp.md }}>
                Under a minute on the clock. That is too short to log, and rounding it up to one would be a figure you did not train.
              </Text>
              <Cta label="Close" wide onPress={onClose} />
            </View>
          )}
          <View style={{ marginTop: sp.md, flexDirection: 'row', justifyContent: 'center', gap: sp.md }}>
            {finalMins > 0 ? <SharePostButton invite label="Share" make={() => {
              const d = readNumber(dist);
              return cardioPost({
                activity: titleCaseName(activity), minutes: finalMins,
                distance: d != null && d > 0 ? `${fig(d)} ${unit}` : null,
                kcal: recovery ? null : parseInt(kcalIn, 10) || null, brand: brandName,
              });
            }} /> : null}
            {finalMins > 0 ? <Ghost label="Discard" onPress={discard} /> : null}
          </View>
        </ScrollView>
        <Confetti show={confetti} onDone={() => setConfetti(false)} />
      </SafeAreaView>
    );
  }

  // Time is the hero here, so it is not repeated in the strip. Calories are
  // left out for recovery entirely: the figure would only ever be discarded at
  // the save, and showing a running total we refuse to record is a promise the
  // finish screen then breaks.
  const liveCols: { label: string; value: string; dot?: string }[] = [
    { label: 'bpm', value: fig(liveHr ?? '–'), dot: liveHr ? hrColor(liveHr, age) : undefined },
    { label: 'Peak', value: fig(hrPeak ?? '–'), dot: hrPeak ? hrColor(hrPeak, age) : undefined },
  ];
  if (!recovery) liveCols.push({ label: 'kcal', value: fig(sessionKcal ?? '–') });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 4 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>{KIND_LABEL[kind]} session</Text>
          <Ghost label="Discard" onPress={discard} />
        </View>

        {/* What is being done and how long it has been going, said plainly and
            first. The report on the guided session was that a started workout
            never told you which workout it was. */}
        <Text style={{ ...ty.title, color: t.ink }}>{activity}</Text>
        <Text style={{ ...value(56), color: t.ink, marginTop: sp.sm }}>{clock(elapsed)}</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>Running · finish when you are done and it goes to your log</Text>

        <View style={{ marginTop: sp.xl }}>
          <MetricCols t={t} items={liveCols} />
        </View>
        {liveHr == null ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {liveHrNote(reach ?? 'none', !recovery)}
          </Text>
        ) : liveSample == null ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            That bpm is today&apos;s average from your connected device, not a live reading, so it can&apos;t be used for zones.
            Live zones need an Apple Watch.
          </Text>
        ) : hrFresh.state !== 'live' ? (
          /* The third state, which did not exist. A real sample, and not a
             current one — drawn identically to a streaming one until now, which
             is why a heart rate that had stopped moving looked like a heart
             that had. It says how old, and it does NOT say reconnect the watch:
             that was tried, it changed nothing, and it could not have. */
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            {staleHrNote(hrFresh.ageMs)}
          </Text>
        ) : null}

        <ZonePanel t={t} reach={reach} liveZone={liveZone} liveSample={freshSample ?? null} zoneSecs={zoneSecs} age={age} elapsed={elapsed} onPair={() => setPairing(true)} />
        {/* Over the runner, never instead of it. `onPaired` rebuilds the
            zones from whatever the watch already holds for this window, so a
            member who pairs ten minutes in gets the ten minutes the watch
            recorded before the app was allowed to read them — and no more
            than that, which is what MID_SESSION_GAP_NOTE says out loud. */}
        <PairMonitorSheet t={t} visible={pairing} onClose={() => setPairing(false)} reach={reach}
          hasSample={freshSample != null} onPaired={() => { void rebuildZonesFromWatch(); }} />

        {/* TF-36 — reachable without leaving the session. It renders nothing
            but an honest line when Spotify is not connected or the account
            cannot drive playback, so it costs a disconnected client no space
            they would resent. */}
        <SessionMusicBar />

        <View style={{ marginTop: sp.xl }}>
          <Cta label="Finish Session" wide onPress={finish} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The movement, shown mid-session, through the whole chain rather than the
 * first link of it.
 *
 * ── What this screen was actually showing ─────────────────────────────────
 *
 * The runner rendered <ExerciseVideoBlock> (since deleted) and nothing else,
 * which asks one
 * question: has anybody uploaded a CLIP of this. `exercise_videos` has never
 * held a single row on this platform — not one, for any gym — so the answer
 * mid-set was always "No demonstration for this exercise yet", under a toggle
 * that had just offered to show them one. Meanwhile the catalogue holds a
 * bought, commercially licensed animation for 489 of its movements and
 * reference frames for 601, including every lift in every program this app
 * builds. The demonstration existed; the session runner was the one screen in
 * the app that did not look for it.
 *
 * app/(client)/exercise.tsx has resolved the full order for a year:
 *
 *   1. the client's OWN coach's clip;
 *   2. the platform Academy clip;
 *   3. the bought animation;
 *   4. the catalogue's reference frames;
 *   5. a sentence saying there is nothing.
 *
 * Same order here, off the same hooks and the same renderers, so the movement a
 * member sees standing at the rack is the movement they saw on the plan screen
 * ten seconds earlier.
 *
 * Deliberately still no "look one up on the web": a live session's sets live in
 * this component tree and a browser hand-off risks the OS reclaiming the app
 * with the workout inside it. Rule 5 stays an honest sentence.
 *
 * Mounted only while it is open, so a five-exercise session does not fire five
 * catalogue reads at the moment somebody presses Start.
 */
/**
 * Where a client is told this demonstration came from.
 *
 * The line was `clip.trainerId ? 'Recorded by your coach' : 'From the Repple
 * library'`, and that one expression made TWO false statements, because a null
 * trainer and a non-null trainer are each two different things:
 *
 *   · `trainerId` is null for a clip stranded in this handset's AsyncStorage
 *     after its insert was refused — character for character the shape of a
 *     platform clip, and separable from one only by the id prefix. So a coach's
 *     un-uploaded phone recording was captioned as the library's. Worse than
 *     wrong: the AsyncStorage key is not namespaced by account and is not
 *     cleared on sign-out, so on any handset that has ever been a coach's, a
 *     later CLIENT session reads those entries back and is told the platform
 *     published them.
 *   · `trainerId` is non-null for ANOTHER coach's clip, published and visible
 *     here — captioned "Recorded by your coach", about a coach the member has
 *     never met.
 *
 * Asked through `clipOwner` (src/lib/clipOwner.ts), which is the one place this
 * app answers it, so this caption cannot drift from the library row, the
 * coverage report and the player's own precedence — all of which ask it too.
 */
export function clipCaption(owner: ClipOwner): string {
  switch (owner) {
    case 'mine': return 'Recorded by your coach';
    // Real, published, and not theirs. Named as a coach's rather than as the
    // library's, because the library's means nobody's.
    case 'other': return `Recorded by a coach on ${BRAND.label}`;
    case 'platform': return `From the ${BRAND.label} library`;
    // Never the library's. There is no row behind this clip, nobody but this
    // device can see it, and no coach put it here for this member.
    case 'local': return 'Saved on this device only, not from the library, and not your coach’s';
  }
}

export function SessionDemo({ t, name, videos, videoStatus, preferTrainerId, onNoMedia }: {
  t: Theme; name: string; videos: VideoItem[]; videoStatus: LibraryStatus; preferTrainerId: string | null;
  /** Told ONCE, when the catalogue row has been read whole and neither it nor
   *  the coach's library holds anything to show for this movement. Only
   *  <DayPicture> passes it. Never fired under a failed or pending read: "we
   *  could not look" is not "there is nothing", and walking on down the day
   *  would fire a second failing read for every movement in it. */
  onNoMedia?: () => void;
}) {
  const { detail, status, signedOut } = useExerciseDetail(name);
  const { frames, animUrl, animCacheKey, equipmentUrl } = useExerciseMedia(detail);
  const clip = useMemo(() => videoForExercise(name, videos, preferTrainerId), [name, videos, preferTrainerId]);
  const caption = demoCaption(detail?.source, frames.length);
  // Asked of the ROW, not of the signed URLs above: those arrive a round trip
  // after the row does, and a picture that is merely still being signed would
  // read as a movement with none.
  // And only once the coach's library has answered too — a clip that is still
  // on its way is not a clip that does not exist.
  const nothingToShow = status === 'ready' && videoStatus !== 'loading' && !clip
    && !((detail?.imagePaths?.length ?? 0) > 0 || detail?.animationPath || detail?.equipmentIconPath);
  const told = useRef(false);
  useEffect(() => {
    if (nothingToShow && onNoMedia && !told.current) { told.current = true; onNoMedia(); }
  }, [nothingToShow, onNoMedia]);

  if (clip) {
    return (
      <View style={{ paddingVertical: sp.sm }}>
        <ExerciseVideo video={clip} exerciseName={name} />
        <Text style={{ ...ty.caption, color: t.ink3, paddingTop: sp.xs }}>
          {clipCaption(clipOwner({ id: clip.id, trainerId: clip.trainerId ?? null }, preferTrainerId))}
        </Text>
      </View>
    );
  }
  if (animUrl) {
    return (
      <View style={{ paddingVertical: sp.sm }}>
        {/* `stillUrls` and `cacheKey`, both of which this call site left off
            and every other call site passes.

            The stills are the catalogue frames, already fetched, and they hold
            the box while the 1.6 MB clip arrives — without them the
            demonstration a member opened mid-session is an empty grey rectangle
            for the second or two that takes on gym wifi, which reads as broken
            rather than as loading.

            The cacheKey is the storage path, and it is the difference between
            the clip being downloaded once and being downloaded every hour.
            src/ui/signedMedia.ts re-signs each URL after 55 minutes because the
            bucket is private; expo-image keys its disk cache by URL, so every
            fresh signature is a file it has never seen. `cachePolicy="disk"` is
            asked for in ExerciseDemo and was doing nothing here. In a basement
            gym with no signal the re-signing fails outright and the member gets
            a blank box for a clip that is sitting on their phone. */}
        <DemoAnimation uri={animUrl} label={name} stillUrls={frames} cacheKey={animCacheKey ?? undefined} />
        {detail?.demoLicence !== 'commercial' ? (
          <View style={{ marginTop: sp.sm }}>
            <Flag tone={t.warn}>Evaluation asset: licensed for review only, never for release.</Flag>
          </View>
        ) : null}
      </View>
    );
  }
  if (frames.length) {
    return (
      <View style={{ paddingVertical: sp.sm }}>
        <FrameLoop urls={frames} label={name} />
        {caption ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>{caption}</Text> : null}
        {detail?.source === 'repdb' ? <RepdbInlineCredit /> : null}
      </View>
    );
  }
  if (equipmentUrl) {
    // A machine rather than a movement — Cable Machine, Ski Erg. Shown still
    // and captioned as kit, never cross-faded as though somebody were
    // performing it.
    return (
      <View style={{ paddingVertical: sp.sm }}>
        <GuardedImage
          source={{ uri: equipmentUrl }}
          contentFit="contain"
          cachePolicy="disk"
          accessibilityLabel={`${name}, equipment`}
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: t.surface2 }}
        />
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
          The equipment, not a demonstration. This is a machine rather than a movement.
        </Text>
      </View>
    );
  }

  // Nothing to show. Which of the several reasons it is matters: "we could not
  // look" and "there is nothing" are different sentences, and a member told the
  // second when the first is true concludes their coach has left them to guess.
  const note = status === 'loading'
    ? 'Looking for a demonstration…'
    : status === 'error'
    ? 'We could not reach the exercise catalogue, so we cannot tell you whether there is a demonstration for this one.'
    : videoStatus === 'error'
    ? 'We could not read the video library, so we cannot tell you whether your coach has a clip for this.'
    : videoStatus === 'partial'
    ? 'We could only read part of the video library, so we cannot tell you whether there is a clip for this one.'
    : signedOut
    ? 'The exercise library is only available once you are signed in, so this could not be looked up.'
    : detail
    ? 'No demonstration for this one yet: no clip from your coach and no reference frames in the catalogue. Ask your coach how they want it done.'
    : 'This movement is not in our catalogue, so there is no guide for it. If your coach wrote it into your program, ask them how they want it done.';
  return (
    <View style={{ paddingVertical: sp.md }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{note}</Text>
    </View>
  );
}

/**
 * The Train hero's picture: the selected day's first movement that HAS one.
 *
 * A day that opens on a movement nobody has filmed used to lead the whole tab
 * with "no demonstration for this one yet" while the second movement's clip sat
 * unread. This walks the day in order, one single-row read at a time and only
 * as far as it has to — the first movement answers in the ordinary case — and
 * when none of them has anything it settles back on the FIRST, whose sentence
 * about why is the honest picture of that day.
 *
 * Keyed by name below, so each try mounts fresh: `useExerciseDetail` keeps the
 * previous movement's row for one render after its name changes, and a "ready,
 * no media" read off that stale row would skip a movement that has a clip.
 */
export function DayPicture({ t, names, videos, videoStatus, preferTrainerId }: {
  t: Theme; names: string[]; videos: VideoItem[]; videoStatus: LibraryStatus; preferTrainerId: string | null;
}) {
  const [skipped, setSkipped] = useState(0);
  const day = names.join('|');
  useEffect(() => { setSkipped(0); }, [day]);
  const exhausted = skipped >= names.length;
  const name = names[exhausted ? 0 : skipped];
  if (!name) return null;
  return (
    <SessionDemo key={`${name}:${exhausted}`} t={t} name={name} videos={videos} videoStatus={videoStatus} preferTrainerId={preferTrainerId}
      onNoMedia={exhausted ? undefined : () => setSkipped((n) => n + 1)} />
  );
}

/** Which of the board's three drawings of the live session is up — client pages 4, 5 and 6. */
export type RunnerView = 'ready' | 'demo' | 'set';

export function SessionRunner({ t, unit, distanceUnit, exercises, focus, nameOf, onSwap, age, restingKcalPerMin, log, logStatus, weightHistory, injuries, injuryStatus, videos, videoStatus, preferTrainerId, clientId, clientName, onComplete, onRetry, onClose, resumeAt }: { t: Theme; unit: WeightUnit; /** The distance unit the cardio boxes open on, the member's own — same source the standalone cardio timer uses. */ distanceUnit: DistanceUnit; exercises: ProgramExercise[]; focus: string; nameOf: (e: ProgramExercise) => string; /** Replace one movement for the rest of the plan, through the same `swaps` map the plan screen writes. Optional so a caller with no plan to write to still gets a runner. */ onSwap?: (e: ProgramExercise, alt: string) => void; age: number | null; restingKcalPerMin: number | null; log: WorkoutEntry[]; logStatus: LoadStatus; weightHistory: BodyweightHistory; injuries: Injury[]; /** How the read that produced `injuries` went. An empty list under anything but 'ready' means UNKNOWN, and the caution line below is drawn off that list — so without this the runner draws "no injury applies here" for a member whose disclosure never arrived. */ injuryStatus: LoadStatus; videos: VideoItem[]; videoStatus: LibraryStatus; preferTrainerId: string | null; clientId: string | null; clientName: string | null; onComplete: (entries: WorkoutEntry[]) => Promise<WriteOutcome>; onRetry: (entries: WorkoutEntry[]) => Promise<WriteOutcome>; onClose: () => void; /** Where a RESTORED session resumes. Null for one starting now. */ resumeAt?: { startedAt: number; pausedMs: number } | null }) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 44);
  // The same split the plan screen makes: `nameOf` is the identity written
  // into every logged set and looked up by, `shownName` is the movement in the
  // reader's own language. See the note beside `shownName` in Train().
  const { textOf: movement } = useMovementName();
  const shownName = (e: ProgramExercise) => movement(nameOf(e));
  // The unit toggle under the load tile writes the member's own setting, as
  // <WeightUnitToggle> does; `unit` comes back in through the prop.
  const settings = useSettings();
  // The day the recap below dates its outing against.
  //
  // `useToday()` rather than a `todayKey()` in the render body, for the reason
  // the note at the top of this screen already gives: a runner is on screen for
  // an hour, evening sessions run past midnight, and "1 day ago" over a session
  // done six hours earlier is the sort of small wrongness that costs the whole
  // line its credibility.
  const runnerToday = useToday();
  // A session can be put down and picked up.
  //
  // It could not before. There was no pause anywhere in this runner, so a phone
  // call in the middle of a session left the clock, the rest countdown and the
  // time-in-zone all running through it — and the only way out was End, which
  // is the button that offers to throw the session away. src/ui/StretchRunner.tsx
  // has had Back, Pause and Skip since it was written; this is that same row,
  // not a second idea about the same problem.
  const [paused, setPaused] = useState(false);
  const { w, reach, elapsed, liveSample, freshSample, hrFresh, liveHr, hrPeak, sessionKcal, zoneSecs, liveZone, rebuildZonesFromWatch } = useLiveVitals(age, restingKcalPerMin, paused, resumeAt?.startedAt ?? null, resumeAt?.pausedMs ?? 0);

  /* The in-session pairing sheet. State rather than a route, because a route
   * is what the ZonePanel comment refuses: `router.push` unmounts this runner,
   * and the sets in it exist nowhere else until the finish writes them. */
  const [pairing, setPairing] = useState(false);
  const [finalElapsed, setFinalElapsed] = useState(0);
  const [idx, setIdx] = useState(0);
  // `bw` marks a set the member did with their own body; `kg` is then what
  // they ADDED to it. Optional, so a guided draft restored from a build that
  // predates the flag reads back as the ordinary sets it recorded.
  // `tempo` is the speed the member says they actually moved at, and it is
  // present only on a set where a tempo was PRESCRIBED — see `tempoBlock`
  // below for why this screen never asks for one otherwise. Absent is not a
  // tempo of zero and not the prescription met.
  const [results, setResults] = useState<{ reps: number; kg: number; bw?: boolean; timed?: boolean; tempo?: string }[][]>(() => exercises.map(() => []));
  // `load` is TEXT in the member's own unit; `results` is kilograms. The
  // conversion happens at this one keyboard, so everything downstream of the
  // runner — the PR check, the warm-up ramp, the entries written to the log —
  // goes on working in the metric the rest of the app is built on.
  const [reps, setReps] = useState(''); const [load, setLoad] = useState('');
  /* WHICH bar the plate line below is worked out for, by index — never as a
     number. A bar held as 20 survives a flip to pounds as a "20 lb bar", which
     is a bar no gym owns; src/lib/plateMath.ts keeps one native list per unit
     for the same reason. Index 0 is the 20 kg / 45 lb men's bar, which is what
     is on the rack unless somebody says otherwise, and saying otherwise is one
     tap. */
  const [barIdx, setBarIdx] = useState(0);
  const [bwOn, setBwOn] = useState(false);
  // Whether the box above the load is counting SECONDS. Seeded per movement
  // from the coach's own prescription in the effect that follows `idx`, because
  // a runner that opens on a reps box for a set written as '45 sec' is asking
  // the member to fix the app before they can record what it told them to do.
  const [timedOn, setTimedOn] = useState(false);
  /* ── the tempo this set was actually performed at ─────────────────────────
     Three pieces of state for one question, and only ever asked where a coach
     wrote a tempo down.

     `tempoHit` is the one tap: the prescribed tempo, confirmed. `tempoOpen`
     reveals the box for the other answer, and `tempoText` is what goes in it.
     All three are cleared after every set, because each set is its own claim —
     a member who hit the tempo on set 1 has said nothing yet about set 2, and
     carrying the confirmation forward would record a tempo nobody confirmed. */
  const [tempoHit, setTempoHit] = useState(false);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [tempoText, setTempoText] = useState('');
  /* WHAT A BIKE DID, WHICH REPS AND KILOGRAMS CANNOT SAY.
   *
   * A cardio movement inside a plan came through here and left as sets. The
   * standalone cardio timer has asked for distance and average watts since it
   * was written, and `scan-machine.tsx` asks for both as well — but a bike that
   * arrived as the fourth line of a program had nowhere to put either, so the
   * one number a cyclist actually trains against was not recordable on the
   * screen they were most likely to be looking at.
   *
   * Kept per exercise rather than per session: a session can hold a row and a
   * bike, and one distance across both would be a figure that describes
   * neither. Strings, not numbers, for the same reason the other two runners
   * keep strings — a blank box is "not measured" and must not become a zero.
   */
  const [cardioExtra, setCardioExtra] = useState<Record<number, { dist: string; watts: string }>>({});
  const cardioAt = (i: number) => cardioExtra[i] ?? { dist: '', watts: '' };
  const setCardioAt = (i: number, patch: Partial<{ dist: string; watts: string }>) =>
    setCardioExtra((prev) => ({ ...prev, [i]: { ...(prev[i] ?? { dist: '', watts: '' }), ...patch } }));
  const showLoad = (kg: number) => (kg ? plain(liftIn(kg, unit) ?? 0) : '');
  const [rest, setRest] = useState(0);
  const [restOverride, setRestOverride] = useState<Record<number, number>>({});
  /* ── which of the board's drawings is up ─────────────────────────────────
     'ready' is client page 4 — the movement, its prescription, the
     demonstration and three round controls. 'set' is page 6 — a clock as the
     figure, the two boxes, one green Complete Set. 'demo' is page 5 — the same
     demonstration over the written steps. The session underneath (the sets,
     the rest, the clock, the zones, the draft on disk) is one thing whichever
     is showing; the view only decides which drawing of it is on screen. It
     goes back to 'ready' when the movement changes, because the set page is
     about ONE movement's sets. */
  const [view, setView] = useState<RunnerView>('ready');
  // Where the demo was opened from, so its back control returns there rather
  // than always to the ready page — a member who opened it while resting is
  // resting still, and the countdown is where they left it.
  const demoFrom = useRef<'ready' | 'set'>('ready');
  /* The set clock: counts UP from the moment the set page opened, or from the
     moment the previous rest ended, and is the figure on page 6 whenever no
     rest is running. A wall-clock instant in a ref read by one interval,
     exactly as the rest is, so a phone that goes in a pocket comes back
     showing the truth rather than however many ticks JavaScript was allowed.
     Null while nothing is being timed. */
  const setStartedAt = useRef<number | null>(null);
  const [setElapsed, setSetElapsed] = useState(0);
  const [rpes, setRpes] = useState<('easy' | 'ok' | 'hard')[][]>(() => exercises.map(() => []));
  const [pendingFeel, setPendingFeel] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [prMsg, setPrMsg] = useState<string | null>(null);
  // Every best set this session, worded for the share card at the end.
  const [sessionPrs, setSessionPrs] = useState<string[]>([]);
  const { appName } = useBrand();
  // WHICH set of this movement the banner above is about, by position. The
  // banner outlives the set that raised it — it stays up until the movement
  // changes — so without this an Undo on a mis-tapped record left "New PR!"
  // standing over a set that is no longer in the session.
  const prAt = useRef<number | null>(null);
  // What happened when the session was written. 'saving' is a real state on a
  // gym's wifi and the Done button must not be tappable through it; 'failed'
  // is the one this screen used to have no word for at all.
  // Four outcomes, because there are four. 'queued' is the one the offline
  // queue added and it is a genuinely different thing to be told: the session
  // is NOT in the log, and it is NOT lost either, and collapsing it into either
  // neighbour is a lie in one direction or the other — "Logged to your history"
  // over sets no server has seen, or "Close and Lose These Sets" over sets that
  // are safely on the phone and would have gone up on their own.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'queued' | 'failed'>('idle');
  // The entries built at the finish, kept so a refused write can be retried
  // with exactly what was logged rather than rebuilt from state that has since
  // been re-rendered. Also what the draft below is cleared against.
  const [pendingEntries, setPendingEntries] = useState<WorkoutEntry[]>([]);
  const rid = useRef<ReturnType<typeof setInterval> | null>(null);
  // When the rest period ENDS, as a wall-clock instant, rather than a count of
  // seconds ticked down.
  //
  // A phone in a pocket between sets stops delivering setInterval — iOS
  // suspends timers in a backgrounded app — so the countdown froze wherever it
  // happened to be and the member came back to "0:47" that never moved again.
  // A rest timer that stops counting during the rest is the one moment it had
  // to work. Same reasoning as `startedAtRef` in useLiveVitals: the clock is the
  // wall, the interval only decides how often we look at it.
  const restEndsAt = useRef<number | null>(null);
  // Read by the countdown interval and by the background-alert listener, both
  // of which are armed once and must see the CURRENT value rather than the one
  // that was in scope when they were created.
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const pausedSinceRef = useRef<number | null>(null);
  // How many seconds the interval saw last time it looked, so a countdown tick
  // fires on the TRANSITION into a second rather than every time that second is
  // observed. The interval runs at 500 ms against a wall clock and therefore
  // reads each second twice; `shouldTick` in src/lib/restTimer.ts owns the rule
  // and this ref is the only state it needs. Reset to null by startRest so a
  // fresh rest never ticks on its first reading.
  const prevLeft = useRef<number | null>(null);
  // Which rest period is currently running, as a number that only goes up.
  //
  // The local notification below is asked for asynchronously, and a member can
  // skip the rest, log another set or end the session before the OS answers. The
  // id that comes back is then cancelled on arrival unless the rest it belongs
  // to is still the one running — without this, a skipped rest still buzzes at
  // somebody ninety seconds later about a set they already did.
  const restGen = useRef(0);
  const restAlertId = useRef<string | null>(null);
  const cancelRestAlert = () => {
    const id = restAlertId.current;
    restAlertId.current = null;
    if (id) void cancelReminders([id]);
  };
  // How long the rest that is running was WHEN IT STARTED — the whole of the
  // ring the countdown drains. A ref rather than state: it changes only in the
  // same call that sets `rest`, which is the render that reads it.
  const restTotal = useRef(0);
  const startRest = (secs: number) => {
    restTotal.current = secs;
    restGen.current += 1;
    cancelRestAlert();
    prevLeft.current = null;
    restEndsAt.current = secs > 0 ? Date.now() + secs * 1000 : null;
    setRest(secs);
  };

  // ── Making a noise from a pocket ──────────────────────────────────────────
  //
  // src/ui/sounds.ts plays the chime while this screen is in front of somebody.
  // It cannot play one from a pocket: the audio session is deliberately
  // `.ambient` so the phone's mute switch is obeyed, which rules out background
  // playback, and iOS suspends a backgrounded app's JavaScript anyway — the
  // interval above is not running to call it. Storing the wall-clock end instant
  // is what keeps the DISPLAY right across a backgrounding; it cannot make a
  // sound while nothing is executing.
  //
  // So the OS is asked instead, and only while the app is actually away. A
  // notification scheduled unconditionally would arrive alongside the chime for
  // a member watching the screen — a banner and two sounds for one event — so it
  // is scheduled when the app leaves and cancelled the moment it comes back.
  // 'inactive' counts as away: it is the state a phone passes through on the way
  // to the lock screen, and a rest that ends during a transient inactive simply
  // has its alert cancelled a second later when 'active' returns.
  //
  // It never asks for the notification permission — scheduleRestOverAlert
  // refuses unless it is already granted. Raising the system prompt over a live
  // workout would spend the app's single per-install chance on the least
  // important thing it sends.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') { cancelRestAlert(); return; }
      // A paused rest has an end instant that is no longer true — `resume` is
      // what makes it true again — so nothing is scheduled against it. Better
      // no alert than one that fires while the member is still on the phone.
      if (pausedRef.current) return;
      const end = restEndsAt.current;
      if (end == null || end <= Date.now()) return;
      const gen = restGen.current;
      // Read before it is used, like everything else in here that indexes the
      // plan. A runner mounted on an empty list is a bug upstream — the Start
      // button and this component are asked about the same list now — but an
      // effect that throws does not fail this screen, it fails the app: it runs
      // after the render has committed, so the empty-list return below cannot
      // catch it, and the error boundary swallows every tab.
      const cur = exercises[idx];
      if (!cur) return;
      const name = nameOf(cur);
      void scheduleRestOverAlert(
        new Date(end),
        'Rest Over',
        `Time for your next set of ${name}.`,
      ).then((id) => {
        if (!id) return;
        // The rest that asked for this alert may have been skipped while the OS
        // was answering. Cancel rather than store, or the member gets an alert
        // about a rest that is no longer running.
        if (restGen.current !== gen || restEndsAt.current == null) { void cancelReminders([id]); return; }
        restAlertId.current = id;
      });
    });
    return () => { sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, exercises]);

  // Decode the tones and set the audio session when the session opens, not when
  // the first rest ends. Decoding a file at the instant a cue is due makes the
  // cue late, and a late cue is a wrong one. Released on the way out because
  // each player holds a native object and a decoded buffer, and this is the only
  // screen in the app that makes a sound.
  useEffect(() => {
    primeSounds();
    return () => { releaseSounds(); cancelRestAlert(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rest <= 0) { if (rid.current) clearInterval(rid.current); restEndsAt.current = null; prevLeft.current = null; return; }
    rid.current = setInterval(() => {
      // A paused session does not rest. The countdown is a wall-clock end
      // instant, so leaving it alone would run it down while the member is on
      // the phone and chime at them about a set they have not got back to;
      // `resume` pushes the instant forward by however long they were away.
      if (pausedRef.current) return;
      const end = restEndsAt.current;
      if (end == null) { setRest(0); return; }
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      // A buzz at zero, because the phone is face-down on a bench and the
      // countdown is the one thing on this screen nobody is watching. Fired on
      // the TRANSITION, tracked in a ref rather than inside the state updater —
      // React may run an updater more than once, and a haptic is a side effect
      // that must happen exactly as often as the thing it announces.
      //
      // The chime rides on exactly that transition, for exactly that reason: a
      // sound is a louder version of the same mistake, and playing it twice is
      // the difference between a cue and a fault. playSound refuses on its own
      // if the member has the sound switched off, so this line does not read the
      // preference — there is one way to make a noise in this app and it asks.
      if (left === 0 && restEndsAt.current != null) {
        restEndsAt.current = null;
        tapLight();
        playSound('restOver');
        // The alert was for this rest, and this rest has just ended on screen.
        // Leaving it scheduled would buzz a second later at somebody already
        // holding the phone.
        cancelRestAlert();
        // The next set's clock starts as the rest ends — the member is looking
        // at the bar, not at a Start button. Harmless off the set page: the
        // instant is only read while that page is up.
        setStartedAt.current = Date.now();
        setSetElapsed(0);
      } else if (shouldTick(left, prevLeft.current)) {
        // Three, two, one. A quieter, lower tick than the chime, so the two are
        // not four sounds that all mean the same thing.
        playSound('countdown');
      }
      prevLeft.current = left;
      setRest(left);
    }, 500);
    return () => { if (rid.current) clearInterval(rid.current); };
  }, [rest > 0]);

  // The set clock, looked at twice a second while the set page is up. Reads
  // the wall through `setStartedAt`, like the rest countdown above, and holds
  // still while the session is paused — `resume` pushes the instant forward
  // by however long the member was away, so nothing is lost or invented.
  useEffect(() => {
    if (view !== 'set') return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      const from = setStartedAt.current;
      setSetElapsed(from == null ? 0 : Math.floor((Date.now() - from) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [view]);

  useEffect(() => {
    // The throw that took the whole app down. This effect runs on mount, and on
    // mount `exercises` could be empty while Start was still on screen — so
    // `exercises[idx]` was undefined and `nameOf` read `.key` off it, from an
    // effect, which is to say after the null render below had already
    // committed. Nothing downstream of an empty list has anything to set up.
    const cur = exercises[idx];
    if (!cur) return;
    const sug = suggestForExercise(log, nameOf(cur), cur.reps, 2.5, unit);
    // Their own history first; with none, the load the coach prescribed, so a
    // first attempt does not open on a blank box beside "× 50 kg" (seen on
    // the simulator, 21 Sep 2026).
    setLoad(sug ? showLoad(sug.weight) : cur.loadKg ? showLoad(cur.loadKg) : '');
    setReps('');
    // The movement's own prescription decides which box opens. `next` and
    // `back` clear the bodyweight tick for the same reason and this is the
    // same rule: how a set is measured is a property of the MOVEMENT, and
    // carrying "seconds" from a plank to the squat rack would record a
    // forty-five second squat.
    setTimedOn(isTimedPrescription(expandSets(cur)[0]?.reps ?? cur.reps));
    setPrMsg(null);
    prAt.current = null;
    setPendingFeel(null);
    // A new movement opens on its own page 4, with no set clock running: the
    // set page is about one movement's sets and this is a different movement.
    setView('ready');
    setStartedAt.current = null;
    setSetElapsed(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // ── Surviving the phone ───────────────────────────────────────────────────
  //
  // Every set logged in here lived in `results` and nowhere else until the
  // finish, so an hour of work existed only in one React component's state. A
  // phone that runs out of battery, a call that comes in, iOS reclaiming a
  // backgrounded app to make room for the camera — any of those and the whole
  // session is gone with nothing to recover from. The plan screen below already
  // learned this the hard way ("it wipes out as u go back", see `draftKey`);
  // the guided runner, which is where a member spends the actual hour, never
  // did.
  //
  // So the sets go to disk as they are typed. One key, because only one guided
  // session can be running, and it carries the day and the exercise names it
  // was recorded against: restoring Tuesday's Push sets on top of Thursday's
  // Legs would be worse than losing them. A draft that does not match today's
  // list is left where it is rather than deleted — it is somebody's training,
  // and it costs nothing to keep until it can be read.
  //
  // ── and one key PER ACCOUNT ──────────────────────────────────────────────
  //
  // It was `repple.guidedSession`, flat. "Only one guided session can be
  // running" is true of a handset and says nothing about whose it is: on a gym
  // desk phone the next member to open the runner was handed the previous
  // one's sets under "Picked up where you left off", and finishing them wrote
  // them to the server under the NEW member's id — `logWorkouts` stamps the row
  // with the uid it resolves at save time (src/ui/workoutLog.tsx). The day and
  // the plan were checked; the person never was. `clientId` is already null
  // rather than 'unknown' where it is passed in, and a null key means the sets
  // are on screen for this session and are not kept. See src/lib/sessionScope.ts.
  const guidedKey = guidedDraftKey(clientId);
  /** Remove this account's draft. A no-op with no account, because there is
   *  then no key of ours to remove and the flat one is not ours to read. */
  const forgetGuidedDraft = useCallback(() => {
    if (guidedKey) AsyncStorage.removeItem(guidedKey).catch(() => {});
  }, [guidedKey]);
  // Armed only by a read of THIS key that actually came back. It used to be a
  // `finally`, which armed after a FAILED read too — so the next set typed was
  // written straight over bytes the app had never managed to read.
  const [draftGate, setDraftGate] = useState<DraftGate>(() => gateForKey(guidedKey));
  // A draft that belongs to some other day or some other plan. It cannot be
  // poured into this session, but it is still somebody's training, so the
  // "nothing logged yet" branch below leaves it alone rather than deleting
  // it on the way past. The first set logged here does overwrite it — by
  // then there is a live session with a better claim on the one key.
  const staleDraft = useRef(false);
  const planNames = exercises.map((e) => nameOf(e));
  const planKey = planNames.join('|');
  const todayKey = dayKeyOf(new Date().toISOString());
  useEffect(() => {
    let live = true;
    setDraftGate(gateForKey(guidedKey));
    staleDraft.current = false;
    if (!guidedKey) return;
    (async () => {
      let read: 'ok' | 'failed' = 'ok';
      let raw: string | null = null;
      try { raw = await AsyncStorage.getItem(guidedKey); } catch { read = 'failed'; }
      if (!live) return;
      // A read that did not answer arms nothing and restores nothing. It is not
      // an empty draft, and the sets on the disk stay where they are.
      if (read !== 'ok') return;
      setDraftGate((g) => gateHydrated(g, guidedKey));
      try {
        if (!raw) return;
        const d = JSON.parse(raw) as { day?: string; plan?: string; results?: unknown; rpes?: unknown; idx?: number };
        // Same day and the same movements in the same order, or it is not this
        // session and must not be poured into it.
        if (d.day !== todayKey || d.plan !== planKey) { staleDraft.current = true; return; }
        const rs = Array.isArray(d.results) ? (d.results as { reps: number; kg: number }[][]) : null;
        if (!rs || rs.length !== exercises.length) { staleDraft.current = true; return; }
        if (!rs.some((a) => Array.isArray(a) && a.length)) return;
        setResults(rs.map((a) => (Array.isArray(a) ? a : [])));
        const fs = Array.isArray(d.rpes) ? (d.rpes as ('easy' | 'ok' | 'hard')[][]) : null;
        if (fs && fs.length === exercises.length) setRpes(fs.map((a) => (Array.isArray(a) ? a : [])));
        if (typeof d.idx === 'number' && d.idx >= 0 && d.idx < exercises.length) setIdx(d.idx);
        Alert.alert(
          'Picked Up Where You Left Off',
          // `were` was fixed while the count was not: one recovered set read
          // "1 set from this session were still on this phone".
          (() => {
            const n = rs.reduce((a, x) => a + (x ? x.length : 0), 0);
            return `${n} set${n === 1 ? ' from this session was' : 's from this session were'} still on this phone and ${n === 1 ? 'is' : 'are'} back on screen. ${n === 1 ? 'It has' : 'They have'} not reached your log yet. Finishing the session is what ${n === 1 ? 'saves it' : 'saves them'}.`;
          })(),
        );
      } catch { /* an unreadable draft is not worth an error the member cannot act on */ }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedKey]);
  useEffect(() => {
    // Only after a read of THIS key has landed, or the first render writes the
    // empty arrays it starts from straight over the draft it was about to read
    // — and an account arriving late would do it to the other member's.
    if (!guidedKey || !mayPersist(draftGate, guidedKey) || saveState === 'saved') return;
    const any = results.some((a) => a.length);
    if (!any) { if (!staleDraft.current) forgetGuidedDraft(); return; }
    AsyncStorage.setItem(guidedKey, JSON.stringify({ day: todayKey, plan: planKey, results, rpes, idx })).catch(() => {});
  }, [results, rpes, idx, draftGate, guidedKey, forgetGuidedDraft, saveState, todayKey, planKey]);

  const ex = exercises[idx];
  const done = results[idx] || [];
  /**
   * Swapping the movement WITHOUT leaving the session.
   *
   * The plan screen has had a Swap arrow on every row since it was written, and
   * the runner had nothing. So a member who started a session and walked to a
   * squat rack somebody else was using had exactly one route: End the session —
   * the button that offers to throw the logged sets away — go back to the plan,
   * swap there, and start again. In a gym. Mid-warm-up.
   *
   * It goes through the same `swaps` map the plan screen writes, passed in as
   * `onSwap`, so the swap is the same swap: it persists (src/lib/planEdits.ts),
   * it survives closing the app, and the plan behind this session shows the
   * movement the member actually did rather than the one that was written.
   *
   * ── Why it stops once a set is logged ────────────────────────────────────
   *
   * `results` is indexed by position, and the entries written at the finish
   * take their name from `nameOf(exercises[i])` at THAT moment. So swapping
   * after logging would relabel sets that have already been done: three sets of
   * back squat would be filed as three sets of leg press, at the back squat's
   * loads, into the member's permanent record — and the PR check and next
   * session's suggestion would both read them as leg press. A member who has
   * started the movement has not been beaten to the rack; they are on it.
   */
  const [swapOpen, setSwapOpen] = useState(false);
  const canSwap = !!onSwap && !!ex && done.length === 0 && (ex.alternatives?.length ?? 0) > 0;
  // Closed whenever the movement changes, so a sheet left open on exercise two
  // cannot be tapped into a swap of exercise three.
  useEffect(() => { setSwapOpen(false); }, [idx]);
  /**
   * The sets of this movement, one by one — the coach's table where there is
   * one, and `sets` copies of the single spec where there is not, which is
   * every program written before the table existed.
   */
  // Guarded, because this runs above the empty-exercises return below and a
  // runner mounted on nothing must not crash on the way to rendering nothing.
  const plan = ex ? expandSets(ex) : [];
  /**
   * How the set at `i` is performed.
   *
   * The METHOD is now a property of a set and not of an exercise, and every
   * reader below had to move with it. A ramp whose first set is a warm-up and
   * whose last is a drop set gets two different rests, two different badges,
   * and only one of them in the volume — and reading `ex.method` for all of
   * them would give the whole movement whichever answer the coach happened to
   * put on the exercise. A row past the end of the table falls back to the
   * exercise, because a client who logged a seventh set of a six-set movement
   * did something real and it is an ordinary set unless something says else.
   */
  const methodAt = (i: number) => plan[i]?.method ?? ex?.method ?? null;
  /**
   * The tempo PRESCRIBED for one set of this movement, canonical, or null.
   *
   * Per set and not per movement, for the reason the method badge and the
   * intensity line already give: set 1 can be a warm-up at no tempo inside an
   * exercise whose top set is a four-second eccentric. Past the end of the
   * plan there is no row left, so the movement's own is used — a member doing a
   * fifth set of a four-set plan is still doing this movement.
   *
   * Canonicalised through `readTempo`, which is the only thing in this app
   * allowed to decide that a coach's "311" and a member's "3-1-1-0" are the
   * same instruction.
   */
  const prescribedTempoAt = (i: number): string | null => {
    const spec = plan[i] ? plan[i].intensity : (ex ? intensityOf(ex, null) : null);
    const r = readTempo(spec?.tempo);
    return r.ok ? r.tempo : null;
  };
  const logSet = () => {
    // Reps, or SECONDS when this movement is a hold. Read through `readHold`
    // rather than parsed here, so the runner and src/ui/LogSetRow.tsx accept
    // and refuse exactly the same things — including '1:30', which is how
    // anybody who has looked at a clock writes ninety seconds.
    let r: number;
    if (timedOn) {
      const held = readHold(reps);
      if (!held.ok) { Alert.alert('How Long Was the Hold?', held.reason); return; }
      r = held.secs;
    } else {
      r = parseInt(reps, 10) || 0;
      // Said, not swallowed. This returned silently, so tapping the tick with an
      // empty reps box — the commonest thing to do after typing only the load —
      // did nothing at all, gave no haptic and left the member tapping harder.
      if (!r) { Alert.alert('How Many Reps?', `Type the reps you did before logging the set. The ${unit} box can stay empty for a bodyweight set.`); return; }
    }
    // Refused rather than coerced: `parseFloat(kg) || 0` is what this shipped
    // with, and a mistyped load silently becoming 0 records a bodyweight set
    // in the middle of a session and drags the volume, the PR check and the
    // next session's target down with it.
    const read = readLift(load, unit);
    if (!read.ok) { Alert.alert('Check That Load', read.reason); return; }
    const wkg = read.kg ?? 0;
    // An empty load box IS a bodyweight set — this screen's own alert two lines
    // up has said so for as long as it has existed, and until now the app threw
    // the set away rather than recording what it was told. The toggle carries
    // the case an empty box cannot say: a dip with a belt on.
    const bw = bwOn || read.kg == null;
    record(r, wkg, bw, timedOn);
  };

  /**
   * Everything that happens once a set is KNOWN — the record, the personal-best
   * check, the coach's notification, the demo offer, the rest timer and the
   * "how did that feel" prompt.
   *
   * Split out of `logSet` above, which is now only the reading of the two boxes
   * and the two toggles. The reason is the tick: the checklist beside the plan
   * logs a set at the figures the plan asked for, and it must produce the SAME
   * set as typing those figures in — the same PR check with the same three
   * guards, the same rest, the same prompt. Anything less is a second
   * definition of "a set was logged" that would drift from this one within a
   * release, and the PR guards are exactly the thing that must not be
   * reimplemented anywhere: `historyWhole` below is what keeps a failed read
   * from firing "New PR!" on every set of a session.
   *
   * `timed` is a parameter rather than the `timedOn` toggle for the same
   * reason. A tick on a plank prescribed as '45 sec' records a HOLD whatever
   * the toggle happens to be showing.
   */
  const record = (r: number, wkg: number, bw: boolean, timed: boolean) => {
    const name = nameOf(exercises[idx]);
    /* ── what speed this was moved at ───────────────────────────────────────
       Read here rather than in `logSet`, because the checklist's one-tap tick
       comes through `record` too and a set logged by tapping the plan must
       carry the same claim as the same set typed out. The whole point of
       recording a tempo is that the prescription becomes falsifiable, and two
       routes disagreeing about whether one was confirmed would un-falsify it.

       Refused rather than dropped. A member who typed something into the box
       said something, and silently storing nothing for it would tell their
       coach the tempo went unrecorded when in fact it was answered. */
    let tempo: string | null = null;
    if (prescribedTempoAt(done.length)) {
      if (tempoOpen && tempoText.trim()) {
        const said = readTempo(tempoText);
        if (!said.ok) { Alert.alert('Check That Tempo', said.why); return; }
        tempo = said.tempo;
      } else if (tempoHit) {
        tempo = prescribedTempoAt(done.length);
      }
    }
    // Zero for a bodyweight set, on purpose. The PR banner below is a claim
    // about everything this person has ever lifted, and the thing it is checked
    // against — `priorBest1RM` in src/lib/progression.ts — reads a set's second
    // number as the load, so a whole history of pull-ups reads there as zeros.
    // Comparing a real bodyweight load against that would fire "New PR!" on
    // every set of every calisthenics session forever. The set is recorded and
    // counted everywhere else; only this banner holds off.
    // …and never for a hold. Epley over seconds returns a strength figure
    // computed from a stopwatch, and it would fire "New PR!" at somebody for
    // holding a plank three seconds longer.
    const newE1 = wkg && r && !bw && !timed ? est1RM(wkg, r) : 0;
    // A personal record is a claim about EVERYTHING this person has ever
    // lifted, so it can only be made when the whole history was read.
    //
    // `priorBest1RM` over an unread log returns 0, and every set beats 0 — so a
    // failed read turned the first set of the session, and every set after it,
    // into "New PR!" with confetti, mid-workout, in front of a coach. Under
    // 'partial' the log is a prefix, which is the same problem more quietly:
    // the record it is compared against may be in the half that did not arrive.
    //
    // Sets logged in THIS session are still compared, because those we watched
    // happen — they just cannot, on their own, establish a lifetime best.
    const historyWhole = logStatus === 'ready';
    const priorBest = Math.max(
      historyWhole ? priorBest1RM(log, name) : 0,
      ...done.map((s) => (s.kg && s.reps ? est1RM(s.kg, s.reps) : 0)),
      0,
    );
    // The second record a lifter counts: the heaviest weight ever on the bar
    // for this movement, even at fewer reps than the best estimated 1RM. Same
    // guards — whole history, loaded, repped — and it only counts against a
    // movement that HAS an earlier loaded set (see src/lib/sessionRecords.ts),
    // so the first set of a new exercise stays the e1RM rule's call alone.
    const priorTop = Math.max(
      historyWhole ? priorTopLoad(log, name) : 0,
      ...done.map((s) => (s.kg && s.reps && !s.bw && !s.timed ? s.kg : 0)),
      0,
    );
    const e1Record = newE1 > 0 && newE1 > priorBest;
    const loadRecord = newE1 > 0 && priorTop > 0 && wkg > priorTop;
    if (historyWhole && (e1Record || loadRecord)) {
      const recordSet = `${liftLabel(wkg, unit) ?? `${plain(wkg)} kg`} × ${r}`;
      setPrMsg(e1Record ? `New PR on ${name}! ${recordSet}` : `Heaviest Ever on ${name}! ${recordSet}`);
      setSessionPrs((l) => [...l.filter((x) => !x.startsWith(`${name} `)), `${name} ${fig(liftLabel(wkg, unit))} ${unit}`]);
      prAt.current = done.length;
      setConfetti(true);
      // The success haptic REDESIGN-PLAN §6 asks of a PR, beside the banner and
      // the confetti. Here, in the set's own handler and not in an updater, so
      // it fires once per record (see the note on haptics in updaters above).
      notifySuccess();
      // The coach is told from INSIDE this branch, and that placement is the
      // whole design. Every guard above — the whole history was read, not a
      // bodyweight set, not a hold, this session's own sets cannot establish a
      // lifetime best — is inherited by the notification for free. Anywhere
      // else, in this file or in plpgsql, would be a second definition of a
      // personal record. supabase/parts/202 says the same thing at length and
      // is why the SQL half of this was withheld.
      //
      // `void`, never awaited, and every path inside swallows: a coach who is
      // not told is a coach who is not told, and a set that fails to log
      // because a push failed would be unforgivable. How often this actually
      // fires is src/lib/prNotify.ts's problem, not this branch's.
      void announcePersonalBest(preferTrainerId, clientId, { movement: name, kg: wkg, reps: r }, clientName);
    }
    setResults((prev) => { const n = prev.map((a) => [...a]); n[idx].push({ reps: r, kg: wkg, ...(bw ? { bw: true } : {}), ...(timed ? { timed: true } : {}), ...(tempo ? { tempo } : {}) }); return n; });
    // The tempo question is asked again for the next set, from scratch. A
    // confirmation is a claim about ONE set; inheriting it would record a
    // four-second eccentric on a set nobody was asked about.
    setTempoHit(false); setTempoOpen(false); setTempoText('');
    // The demonstration used to open itself here, after the first set, on the
    // argument that the first rest is when somebody has 90 seconds and a
    // reason to look. It no longer needs to: the board's ready page carries
    // the demonstration in its first viewport, and the set page links to it.
    // The coach's rest for THIS movement, or the app's fallback when they did
    // not set one. It used to be 90 for every exercise in every program,
    // which is right for accessory work and wrong for a heavy triple and wrong
    // again for a finisher. `restSecondsFor` is the one place an absent value
    // becomes a usable one — a stored 0 must not be honoured here, because
    // startRest(0) is how the timer is CLEARED.
    // …and then HOW this movement is performed decides whether there is a rest
    // at all. Inside a drop set there is deliberately none — that is what makes
    // it a drop set — and `restAfter` returns 0, which is the same argument
    // `startRest` already takes for "clear the timer": no countdown opens, no
    // chime is scheduled, and the member goes straight to the next drop.
    // Rest-pause and cluster return fifteen seconds, which is the pause inside
    // the method rather than the rest between sets.
    // …and it is THIS set's method that decides, not the movement's. The set
    // just logged is the one at `done.length` — the count before this log — so
    // finishing a warm-up rests the coach's rest and finishing the drop set
    // that follows it rests not at all.
    setReps('');
    { const base = restAfter(methodAt(done.length), restSecondsFor(ex)); startRest(base > 0 && restOverride[idx] != null ? restOverride[idx] : base); }
    setPendingFeel(wkg);
    // The set clock starts over. Under a rest it is not the figure and the
    // rest's end restarts it anyway; inside a drop set there is no rest, and
    // this is what times the next drop.
    setStartedAt.current = Date.now(); setSetElapsed(0);
  };
  // Kilograms, in both unit systems, and deliberately. This is the same
  // increment ladder `suggestForExercise` and the Targets screen work in, and
  // giving the runner an imperial ladder of its own would be a second
  // progression model quietly disagreeing with the first about how much to add.
  // What the member reads is the converted result, not a different decision.
  const feelStep = (base: number) => (base >= 60 ? 5 : base >= 20 ? 2.5 : base > 0 ? 1 : 0);
  const chooseFeel = (f: 'easy' | 'ok' | 'hard') => {
    setRpes((prev) => { const n = prev.map((a) => [...a]); n[idx].push(f); return n; });
    const base = pendingFeel || 0;
    const st = feelStep(base);
    const nextKg = f === 'easy' ? base + st : f === 'hard' ? Math.max(0, base - st) : base;
    setLoad(showLoad(nextKg));
    setPendingFeel(null);
    tapLight();
  };
  const buildEntries = (): WorkoutEntry[] => {
    const nowISO = new Date().toISOString();
    // How long the session actually ran, from the clock this screen has been
    // keeping all along.
    //
    // It was measured, printed on the finish screen as "Time", and then thrown
    // away: `sessionMins` existed on the entry with a working setter in
    // src/ui/workoutLog.tsx, and nothing on this screen ever wrote it. So the
    // one honest measure of how long somebody trained reached the finish
    // screen and never the record — and `sessionDuration` in
    // wearables/appleHealthWrite.ts, which needs a start and an end to write a
    // strength session to Apple Health at all, was left with nothing but the
    // sentence "No length recorded. Enter how long this session ran and it can
    // be written."
    //
    // Whole minutes, and zero is not written. `workouts.session_mins` carries a
    // `> 0` check constraint and would refuse the row outright, which would
    // lose the SETS as well as the length — and a session under thirty seconds
    // rounded up to "1 min" is a figure nobody trained. Session-scoped, so
    // every entry sharing this timestamp carries the same number, which is what
    // the field's own doc comment requires.
    const mins = Math.round(elapsed / 60);
    return results
      .map((sets, i) => (sets.length ? {
        t: nowISO,
        exercise: nameOf(exercises[i]),
        sets: sets.map((s) => [s.reps, s.kg]) as [number, number][],
        // The bike's own numbers, on the entry the bike is already on, in the
        // shape `logCardio` writes so every reader of a cardio block — the
        // month strip, the records screen, the coach's report — sees one thing
        // and not two. Absent unless something was typed: a blank box means the
        // machine was not read, which is not the same as a zero, and `dist: 0`
        // would print "0 km" over an hour somebody rode.
        ...((): { cardio?: { mins: number; dist: number; unit: string; watts?: number } } => {
          if (!isCardioMovement(nameOf(exercises[i]))) return {};
          const raw = cardioAt(i);
          // `readNumber`, not `parseFloat` — the identical box on the two
          // other cardio writers on this screen (`logCardio`, and the timed
          // runner's own finish) already says why at length: this is a
          // `decimal-pad`, and the decimal key on that pad is a COMMA across
          // most of Europe. `parseFloat('12,7')` is 12, so 700 metres of a run
          // logged inside the guided session vanished on the way to the record,
          // silently and only for those members. This was the one distance box
          // of the three still reading itself in ASCII.
          const d = raw.dist.trim() === '' ? 0 : (readNumber(raw.dist) ?? 0);
          const w = raw.watts.trim() === '' ? 0 : (parseInt(raw.watts, 10) || 0);
          if (d <= 0 && w <= 0) return {};
          return { cardio: { mins, dist: d, unit: distanceUnit, ...(w > 0 ? { watts: w } : {}) } };
        })(),
        // Absent rather than an array of false, for the reason on the column
        // itself: a missing flag means nobody was asked, and that is the only
        // thing true of every session logged before this existed.
        bw: sets.some((s) => s.bw) ? sets.map((s) => s.bw === true) : undefined,
        // And absent rather than an array of false for the same reason: a
        // session logged before holds could be recorded is not a session of
        // repetitions, it is a session nobody was asked about.
        timed: sets.some((s) => s.timed) ? sets.map((s) => s.timed === true) : undefined,
        // And the speed they were moved at, where anybody said — through
        // `packTempos`, which returns undefined rather than a list of nulls
        // when nobody did. A set that was never asked about carries null at its
        // own index and is read back as "no tempo recorded", never as a tempo
        // of zero and never as the prescription met.
        tempos: packTempos(sets.map((s) => s.tempo)),
        ...(mins > 0 ? { sessionMins: mins } : {}),
        feel: (rpes[i] && rpes[i].length) ? rpes[i] : undefined,
        // No `kcal`. It used to carry `volume / 60 + sets * 8` — an expression
        // with no body weight, no heart rate and no measurement of any kind in
        // it, printed afterwards beside the real ones as "184 kcal" under the
        // exercise. `cardioKcal` at the top of this file was rewritten to
        // return null rather than guess, and recovery was stripped of calories
        // entirely, for exactly this reason; the strength path was the last
        // place still inventing one. The session's real burn is measured by the
        // watch and shown on the finish screen as `sessionKcal`, which is not
        // divided up between exercises here because apportioning it would be a
        // second invention on top of a real number.
        //
        // Absent, not zero: `kcal` is nullable in `workouts`, every reader
        // guards on it, and a dash is what "nobody measured this" looks like.
        // Only attach zones when a heart-rate source actually fed the session.
        zones: zoneSecondsTotal(zoneSecs) > 0 ? zoneSecs : undefined,
      } : null))
      .filter(Boolean) as WorkoutEntry[];
  };

  /**
   * End the session and write it.
   *
   * `onComplete` resolves false on a refused write and its result was dropped
   * on the floor: the trophy, the confetti and the sentence "Logged to your
   * history — strength trends and your coach's dashboard update automatically"
   * were shown to somebody whose hour of training existed on one phone and
   * nowhere else. This is the single most expensive lie in the app, because the
   * one place it fires is a gym, which is where the signal is worst.
   *
   * So the finish screen is not reached until the server has answered, and it
   * says which of the three answers it got. On a refusal the sets stay on
   * screen, the draft stays on disk, and there is a button that tries again.
   *
   * The draft is removed for 'queued' as well as for 'saved', and that is not a
   * shortcut. The provider has written those entries to this device under
   * `local:` ids and holds them until a server takes them, so the draft is now a
   * SECOND copy of the same sets — and a second copy that this screen would
   * restore into an empty runner, where finishing again would log the session
   * twice under a new timestamp. One durable copy, held by the thing that knows
   * whether it has been sent.
   */
  const save = async (entries: WorkoutEntry[]) => {
    setSaveState('saving');
    const out = await onComplete(entries);
    setSaveState(out === 'stored' ? 'saved' : out === 'unsent' ? 'queued' : 'failed');
    if (out !== 'refused') forgetGuidedDraft();
    // Confetti for a session that is in the log. A queued one has not reached
    // anybody yet, and celebrating it is the far side of the line this screen's
    // own draft wording draws.
    if (out === 'stored') setConfetti(true);
  };
  const finish = () => {
    if (saveState === 'saving') return;
    // Stop the rest timer before the finish screen goes up. The component stays
    // mounted behind it, so an unstopped interval went on running and fired the
    // zero-transition haptic after the session had ended — with a chime on that
    // transition it would now also make a noise at somebody who is already
    // reading their results.
    startRest(0);
    // The same rebuild the timed runner does, for the same reason: a lifting
    // session spends most of itself with the phone down between sets, so the
    // banked breakdown is the smaller half of what the watch recorded. Not
    // awaited — the finish screen is immediate and the rows settle behind it.
    void rebuildZonesFromWatch();
    const entries = buildEntries();
    setFinalElapsed(elapsed);
    setPendingEntries(entries);
    setFinished(true);
    // Nothing logged is not a failed write — there was nothing to write. The
    // finish screen says so rather than claiming a save that never happened.
    if (!entries.length) { setSaveState('idle'); return; }
    void save(entries);
  };
  /** Try the same entries again. Through `retryWorkouts`, not `addWorkouts` —
   *  the first attempt already put them in the local log, and a second
   *  optimistic add would show the member their session twice. */
  const retry = async () => {
    if (saveState === 'saving' || !pendingEntries.length) return;
    setSaveState('saving');
    const out = await onRetry(pendingEntries);
    setSaveState(out === 'stored' ? 'saved' : out === 'unsent' ? 'queued' : 'failed');
    if (out !== 'refused') forgetGuidedDraft();
    if (out === 'stored') { setConfetti(true); tapLight(); }
  };
  // Bodyweight is a property of the MOVEMENT, so the tick clears when the
  // movement does. Left on, a member who has just finished a set of pull-ups
  // walks to the rack and types 60 into a box that now means "sixty kilos on
  // top of me".
  const next = () => { if (idx < exercises.length - 1) { setIdx(idx + 1); setBwOn(false); startRest(0); } else finish(); };
  // `timedOn` is not cleared here: the effect on `idx` re-seeds it from the new
  // movement's own prescription, which is a better answer than false and is the
  // only place that decision is made.
  /**
   * Back to the movement before this one.
   *
   * `setIdx` was written in exactly three places — on mount, on restoring a
   * draft, and by `next` — so a session only ever went forwards. Forget a set
   * on exercise two and there was no way back to it: the sets already logged
   * for that movement are still in `results`, still on their way to the log,
   * and simply unreachable. The only door out was End, which offers to discard
   * the session.
   *
   * The rest timer is cleared on the way, exactly as `next` clears it. A
   * countdown belongs to the set that started it, and carrying it backwards
   * would chime at somebody about a rest between two sets they are no longer
   * doing.
   */
  const back = () => { if (idx > 0) { setIdx(idx - 1); setBwOn(false); startRest(0); tapLight(); } };
  /**
   * Stop the clock, and start it again where it stopped.
   *
   * Three things are running and all three have to stop, or a pause is a lie
   * told in three places: the session clock (which becomes `sessionMins` in a
   * health record), the rest countdown, and the seconds banked against each
   * heart-rate zone. The first two are wall-clock instants, so neither can be
   * paused by stopping a timer — the elapsed clock subtracts the away time and
   * the rest end is pushed forward by it.
   */
  const pause = () => { if (paused) return; pausedSinceRef.current = Date.now(); cancelRestAlert(); setPaused(true); tapLight(); };
  const resume = () => {
    if (!paused) return;
    const from = pausedSinceRef.current;
    pausedSinceRef.current = null;
    if (from != null && restEndsAt.current != null) restEndsAt.current += Date.now() - from;
    // The set clock too — it is the same kind of instant, and a pause that
    // stopped two of the three clocks is a pause that lied about one.
    if (from != null && setStartedAt.current != null) setStartedAt.current += Date.now() - from;
    setPaused(false);
    tapLight();
  };
  /* ── moving between the board's pages ────────────────────────────────────
     Start set is the green control on the ready page. The clock starts when
     the page does, unless a rest is running — then the countdown is the figure
     and the set clock starts when it ends, as it does after every set. */
  const startSet = () => {
    if (rest <= 0) { setStartedAt.current = Date.now(); setSetElapsed(0); }
    setView('set');
    tapLight();
  };
  const openDemo = (from: 'ready' | 'set') => { demoFrom.current = from; setView('demo'); tapLight(); };
  /** Skipping a rest is also the start of the next set's clock, from either page. */
  const skipRest = () => { startRest(0); setStartedAt.current = Date.now(); setSetElapsed(0); };
  const loggedSets = results.reduce((a, r) => a + r.length, 0);
  /**
   * The "End" in the header.
   *
   * It called `onClose` straight through. Mid-session, with sets on screen,
   * that threw away everything logged so far with no confirmation and no
   * mention that anything was being lost — one mis-tap next to the top of the
   * scroll and the workout was gone. Ending a session someone is halfway
   * through is a real thing to want; ending it silently is not, and the useful
   * half of it — saving what they did do — was not offered at all.
   */
  /**
   * The movements this session has nothing logged against, by the name on
   * screen.
   *
   * Said out loud when somebody ends early, and again on the finish screen.
   * `buildEntries` writes ONE ENTRY PER MOVEMENT THAT HAS SETS and drops the
   * rest — which is right, because an untouched movement has no reps, no load
   * and no time under a bar, and writing a row of zeroes for it would put
   * training in the log that nobody did and count it against the member's
   * tonnage, their records and their coach's dashboard.
   *
   * But dropping a thing silently and not doing it are different, and only one
   * of them is what happened. So they are named rather than written: the member
   * ending on exercise three of five is told which two are not going in, at the
   * moment they decide and again after it is done.
   */
  const notDoneNames = (): string[] =>
    exercises.map((e, i) => ((results[i] || []).length ? null : shownName(e)))
      .filter((x): x is string => !!x);
  const endSession = () => {
    if (!loggedSets) { onClose(); return; }
    const undone = notDoneNames();
    Alert.alert(
      'End This Session?',
      `${loggedSets} set${loggedSets === 1 ? '' : 's'} logged so far. Save them to your log, or discard the session.`
      + (undone.length
        ? ` ${list(undone)} ${undone.length === 1 ? 'has' : 'have'} nothing logged and will be recorded as not done, not as zeroes, and not counted.`
        : ''),
      [
        { text: 'Keep Going', style: 'cancel' },
        { text: 'Save and End', onPress: () => finish() },
        { text: 'Discard', style: 'destructive', onPress: () => { forgetGuidedDraft(); onClose(); } },
      ],
    );
  };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12, flex: 1, ...ty.head, ...font('400') } as const;

  if (!exercises || exercises.length === 0) return null;
  if (finished) {
    const totalSets = results.reduce((a, r) => a + r.length, 0);
    // ── what counts as training volume, and what only counts as work ────────
    //
    // A warm-up is real: it was performed, it was typed in, and it is in the
    // log. It is NOT tonnage, and neither is a cool-down. Counting them makes a
    // member's session total — and the weekly figure it feeds — jump on a day
    // they did nothing different, which is the lie `countsToVolume` exists to
    // stop. The METHOD decides, never the name of the movement, so a method
    // added to the catalogue later cannot quietly start inflating this.
    // Per SET, and that is the change. This asked the exercise, which was the
    // only grain there was — so a movement whose first set is a warm-up and
    // whose next three are working sets was either entirely tonnage or entirely
    // not, and both answers are wrong by three sets. `expandSets` gives the
    // method of each set in turn, and a set logged past the end of the plan
    // falls back to the exercise's own.
    const counts = (i: number, j: number) => {
      const e = exercises[i];
      if (!e) return true;
      return countsToVolume(expandSets(e)[j]?.method ?? e.method ?? null);
    };
    // A hold contributes nothing here, and that is the point rather than an
    // omission: seconds × kilograms is not a mass moved, and a member who held
    // 45 seconds under a 10 kg plate has not lifted 450 kg. See
    // src/lib/timedSets.ts, which keeps every reader of a set agreeing about
    // what its first number means.
    //
    // ── and why a bodyweight set is not a zero ──────────────────────────────
    //
    // On a bodyweight set `st.kg` is what was ADDED to the body, not the load —
    // 0 for a plain pull-up. `reps × kg` therefore priced an hour of pull-ups
    // and dips at nothing, and this card printed "Volume 0t" over it as a hero
    // figure with nothing saying the total could not price the work.
    //
    // Priced the way every other tonnage in this app is priced, by
    // src/lib/bodyweightSets.ts: the member's own weight as recorded on or
    // before today, plus whatever they hung off it. Where there is no such
    // weigh-in the set has NO KNOWN LOAD — it is counted and named below,
    // never valued at zero and never priced against an invented body.
    const bodyToday = bodyweightAtKg(weightHistory, new Date().toISOString());
    let volume = 0;
    let unpricedSets = 0;
    for (let i = 0; i < results.length; i++) {
      for (let j = 0; j < results[i].length; j++) {
        const st = results[i][j];
        if (!counts(i, j) || st.timed) continue;
        if (st.bw) {
          if (bodyToday == null) { if (st.reps > 0) unpricedSets++; continue; }
          volume += st.reps * (bodyToday + Math.max(0, st.kg || 0));
          continue;
        }
        volume += st.reps * st.kg;
      }
    }
    // A total of nothing over sets that exist is not a total. When every set
    // this card could have priced was a bodyweight one it could not, the
    // figure is unknown rather than zero — the same rule the rest of the
    // screen follows about an empty read.
    const volumeKnown = volume > 0 || unpricedSets === 0;
    const workingSets = results.reduce((a, r, i) => a + r.filter((_, j) => counts(i, j)).length, 0);
    // Sets that happened and are saved, but are not part of either figure
    // above. Said out loud below rather than silently subtracted: a member who
    // logged twelve sets and reads "9" is owed the sentence explaining it.
    const uncountedSets = totalSets - workingSets;
    const exDone = results.filter((r) => r.length > 0).length;
    const strip: { label: string; value: string; dot?: string }[] = [
      { label: 'Time', value: `${Math.floor(finalElapsed / 60)}:${String(finalElapsed % 60).padStart(2, '0')}` },
    ];
    if (sessionKcal != null) strip.push({ label: 'kcal Burned', value: fig(sessionKcal) });
    if (hrPeak != null) strip.push({ label: 'Peak Bpm', value: fig(hrPeak), dot: hrColor(hrPeak, age) });
    if (typeof w.today.heartRateAvg === 'number') strip.push({ label: 'Avg Bpm', value: fig(w.today.heartRateAvg) });
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 10 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {/* The trophy is for a session that is actually IN the log. A
              refused write gets the same figures — they are true, the training
              happened — under a heading that does not congratulate anybody. */}
          <View style={{ alignItems: 'center', marginTop: sp.xl }}>
            <Icon name={saveState === 'saved' || saveState === 'idle' ? 'trophy' : saveState === 'saving' ? 'trophy' : 'info'} size={40}
              color={saveState === 'failed' ? t.crit : saveState === 'queued' ? t.warn : t.brand} />
          </View>
          <Text style={{ ...ty.title, color: t.ink, textAlign: 'center', marginTop: sp.md }}>
            {saveState === 'saving' ? 'Saving…'
              : saveState === 'failed' ? 'Not Saved Yet'
              : saveState === 'queued' ? 'Waiting to Send'
              : 'Session Complete'}
          </Text>
          <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs, textTransform: 'capitalize' }}>{focus}</Text>
          {saveState === 'failed' ? (
            <View style={{ marginTop: sp.lg }}>
              {/* A refusal, not a silence. The server read these sets and
                  declined them, so they are NOT queued — the provider drops a
                  refused row rather than retrying it on every launch forever —
                  and closing this screen really does lose them. */}
              <Notice tone={t.crit} kicker="Your Training Log" title="Your Log Refused This Session"
                note={`${num(totalSets)} set${totalSets === 1 ? '' : 's'} are still on this phone and are listed below, but they were rejected rather than lost on the way, so they are not recorded and they are not waiting to send. Closing this screen loses them.`}>
                <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                  <Ghost label="Try Saving Again" onPress={() => { void retry(); }} />
                </View>
              </Notice>
            </View>
          ) : null}
          {saveState === 'queued' ? (
            <View style={{ marginTop: sp.lg }}>
              {/* The wording the runner's own draft notice already uses, on the
                  other side of the same line: the sets are safe on this phone,
                  they have not reached the log, and finishing is no longer what
                  saves them — signal is. Nothing here asks the member to stay on
                  the screen or to do anything at all, because there is nothing
                  they need to do. */}
              <Notice tone={t.warn} kicker="Your Training Log" title="Saved on This Phone, Not in Your Log Yet"
                note={`${num(totalSets)} set${totalSets === 1 ? '' : 's'} are saved on this phone and listed below. They have not reached your log yet. They go up on their own the next time the app has signal, and it is safe to close this. Until then your streak, your records and your coach's dashboard do not know about them.`}>
                <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                  <Ghost label="Try Sending Now" onPress={() => { void retry(); }} />
                </View>
              </Notice>
            </View>
          ) : null}
          {saveState === 'idle' && totalSets === 0 ? (
            <View style={{ marginTop: sp.lg }}>
              <Notice tone={t.ink3} kicker="Nothing Logged" title="No Sets Were Recorded"
                note="Nothing has been written to your log, because nothing was entered. Close this and the session is simply not there: no empty workout, no dot on the calendar." />
            </View>
          ) : null}
          <Section>
            {/* Rule 6: the write state beside the sets it is about. The runner
                only knows the SESSION's outcome (one write for all of them), so
                it is said once, over the figures, not invented per set. */}
            {(saveState === 'queued' || saveState === 'failed') && totalSets > 0 ? (
              <View style={{ marginBottom: sp.sm }}>
                <SyncBadge state={saveState} label={saveState === 'queued' ? 'On This Phone · Waiting to Send' : 'Refused · Not in Your Log'} />
              </View>
            ) : null}
            <KpiRow items={[
              { label: 'Exercises', value: `${exDone}/${exercises.length}` },
              // The column names what it counts. With no warm-up or cool-down in
              // the session the two figures are the same and the old label is
              // the right one; where they differ, "Sets" over a number that is
              // not the number of sets logged is the lie.
              { label: uncountedSets > 0 ? 'Working Sets' : 'Sets', value: fig(uncountedSets > 0 ? workingSets : totalSets) },
              // See volumeHeadline: tonnes for a metric reader, pounds for an imperial
      // one, because a short ton is 10% off a tonne and would read as the same
      // unit to anybody comparing this with a coach's console.
      { label: 'Volume', value: volumeKnown ? `${volumeHeadline(volume, unit)!.figure.toLocaleString()}${unit === 'kg' ? 't' : ''}` : fig(null), unit: volumeKnown && unit === 'lb' ? 'lb' : undefined },
            ]} />
            {/* The work this figure could not price, named. A member who did
                nothing but pull-ups is owed the reason the number is short —
                and the thing they can do about it — rather than a measured
                looking zero. Same sentence as `tonnageNote`, in the runner's
                own voice because the fix is one weigh-in away. */}
            {unpricedSets > 0 ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                {unpricedSets === 1 ? 'One bodyweight set is' : `${num(unpricedSets)} bodyweight sets are`} not in the volume above, because your own weight is not recorded for today. Add your weight and {unpricedSets === 1 ? 'it counts' : 'they count'}.
              </Text>
            ) : null}
            {/* ── the movements that were not done ─────────────────────────
                "3/5" above is the whole of what this screen used to say about
                the other two, and a member reading it a week later has no way
                to tell which. They are not in the log — `buildEntries` writes
                a row only for a movement with sets, because a row of zeroes is
                training nobody did — so this is the only place they are named,
                and being named is the difference between recorded as not done
                and quietly dropped. */}
            {(() => {
              const undone = notDoneNames();
              return undone.length ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {list(undone)} {undone.length === 1 ? 'has' : 'have'} no sets and {undone.length === 1 ? 'is' : 'are'} recorded as not done. {undone.length === 1 ? 'It is' : 'They are'} not in your log as zeroes and {undone.length === 1 ? 'does' : 'do'} not count against your figures. The session you did is the session above.
                </Text>
              ) : null;
            })()}
            {/* Only when there is something to explain. A member who warmed up
                did the work and it is saved; this says where it went rather
                than leaving them to find the arithmetic themselves. */}
            {uncountedSets > 0 ? (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                {uncountedSets === 1 ? 'One more set was logged' : `${num(uncountedSets)} more sets were logged`} as warm-up or cool-down. They are saved with the session and left out of the figures above, which are your working sets.
              </Text>
            ) : null}
          </Section>
          <Rule />
          <Section>
            <MetricCols t={t} items={strip} />
          </Section>
          <Rule />
          {zoneSecondsTotal(zoneSecs) > 0 ? (<>
            <Section>
              <SectionHead title="Time in Zone" note={`${splatPoints(zoneSecs)} Splat`} />
              <ZoneBoard seconds={zoneSecs} showSplat={false} />
            </Section>
            <Rule />
          </>) : null}

          {/* WHAT THE MACHINE SAID, for the movements where reps and kilograms
              cannot say it. A cardio movement inside a plan came through this
              runner and left as sets: the standalone cardio timer has asked for
              distance and average watts since it was written, and scan-machine
              asks for both, but a bike that arrived as the fourth line of a
              program had nowhere to put either — so the one number a cyclist
              trains against was not recordable on the screen they were most
              likely to be looking at.

              One line per movement, not one per session: a row and a bike on
              the same day are two distances and a single figure describes
              neither. Drawn only for cardio movements actually trained, so a
              session of squats never grows a distance box. Nothing is required
              — the clock was measured, these were not, and an empty box is
              written as "not measured" rather than as a zero. */}
          {(() => {
            const done = results
              .map((sets, i) => ({ i, sets }))
              .filter(({ i, sets }) => sets.length > 0 && isCardioMovement(nameOf(exercises[i])));
            if (!done.length) return null;
            return (<>
              <Section>
                <SectionHead title="Anything to Add" />
                {done.map(({ i }) => {
                  const raw = cardioAt(i);
                  return (
                    <View key={i} style={{ marginBottom: sp.md }}>
                      <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.xs }}>{nameOf(exercises[i])}</Text>
                      <View style={{ flexDirection: 'row', gap: sp.sm }}>
                        <View style={{ flex: 1 }}>
                          <Field label="Distance" hint={distanceUnit}>
                            <TextInput
                              value={raw.dist}
                              onChangeText={(v) => setCardioAt(i, { dist: v })}
                              keyboardType="decimal-pad"
                              accessibilityLabel={`Distance for ${nameOf(exercises[i])}, in ${distanceUnitName(distanceUnit)}`}
                              style={inp}
                            />
                          </Field>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Field label="Avg Watts" hint="optional">
                            <TextInput
                              value={raw.watts}
                              onChangeText={(v) => setCardioAt(i, { watts: v })}
                              keyboardType="numeric"
                              accessibilityLabel={`Average watts for ${nameOf(exercises[i])}`}
                              style={inp}
                            />
                          </Field>
                        </View>
                      </View>
                    </View>
                  );
                })}
                <Text style={{ ...ty.caption, color: t.ink3 }}>
                  The clock was measured; these were not. Nothing here is required. Leave a box empty and it is
                  left out rather than saved as a zero.
                </Text>
              </Section>
              <Rule />
            </>);
          })()}
          {/* Said only when it is true. This sentence was printed
              unconditionally, including over a write the server had refused —
              which is how an hour of training becomes a screenshot of a
              promise. */}
          <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.xl, marginBottom: sp.xl }}>
            {saveState === 'saved'
              ? "Logged to your history. Strength trends and your coach's dashboard update automatically."
              : saveState === 'saving'
              ? 'Writing this session to your log…'
              : saveState === 'queued'
              ? 'Kept on this phone and waiting to send, so your trends and your coach’s dashboard do not know about it yet.'
              : saveState === 'failed'
              ? 'Nothing here has reached your history yet, so your trends and your coach’s dashboard do not know about it.'
              : 'Nothing was logged, so there is nothing to save.'}
          </Text>
          {/* Closing on a REFUSED write is what throws the session away, so the
              button says what it does and asks again. Closing on a queued one
              does not, and must not say it does: a member frightened off the
              Done button by a warning that does not apply to them is a member
              standing in a gym waiting for signal they may not get. */}
          {(saveState === 'saved' || saveState === 'queued') && totalSets > 0 ? (
            <View style={{ alignItems: 'center', marginBottom: sp.md }}>
              <SharePostButton invite label="Share My Workout" make={() => workoutPost({
                focus: titleCaseName(focus), sets: uncountedSets > 0 ? workingSets : totalSets,
                minutes: finalElapsed >= 60 ? Math.round(finalElapsed / 60) : null,
                volume: volumeKnown && volume > 0 ? `${volumeHeadline(volume, unit)!.figure.toLocaleString()} ${unit === 'kg' ? 't' : 'lb'}` : null,
                prs: sessionPrs, brand: appName,
                date: fmtDay(new Date().toISOString()),
                top: topMovements(results.map((r, i) => ({
                  name: exercises[i] ? nameOf(exercises[i]) : '',
                  sets: r.filter((st) => !st.timed).map((st) => [st.reps, st.bw ? null : st.kg] as const),
                }))),
              })} />
            </View>
          ) : null}
          <Cta
            label={saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Close and Lose These Sets' : 'Done'}
            wide
            onPress={() => {
              if (saveState === 'saving') return;
              if (saveState !== 'failed') { forgetGuidedDraft(); onClose(); return; }
              Alert.alert(
                'Close Without Saving?',
                'These sets have not reached your log. Closing loses them. There is no copy anywhere else.',
                [
                  { text: 'Try Saving Again', onPress: () => { void retry(); } },
                  { text: 'Close and Lose Them', style: 'destructive', onPress: () => { forgetGuidedDraft(); onClose(); } },
                ],
              );
            }}
          />
        </ScrollView>
        <Confetti show={confetti} onDone={() => setConfetti(false)} />
      </SafeAreaView>
    );
  }

  // ── the two things this movement is, beyond its name ──────────────────────
  //
  // Which run it belongs to, read positionally off the very list the runner is
  // stepping through, so a badge here cannot describe an order other than the
  // one being trained. Null for a movement that stands alone, and then nothing
  // is drawn at all.
  const exGroup = groupBadges(exercises)[idx];
  // How its sets are performed. Null for an ordinary set and for an id this
  // build does not recognise — see badgeFor — so no marker nobody could read
  // reaches the screen.
  // The method of the set about to be logged — which is what the badge at the
  // top of the screen is describing, because that is the set the client is
  // standing in front of the bar for.
  const exMethod = badgeFor(methodAt(done.length));
  // What the rest after a set of this movement actually is, and whose number it
  // is. A method carrying its own rest — the fifteen seconds inside a
  // rest-pause or a cluster — is not the coach's rest and must not be labelled
  // as theirs. A drop set has none, `plannedRest` is 0, and no banner opens.
  const restIsMethods = typeof methodFor(methodAt(done.length)).method.restsAfter === 'number';
  // The member's own rest for this movement, set with − and + beside Start
  // Rest ("need to be able to adjust the rest time", owner, 21 Sep 2026). It
  // replaces the coach's or the app's figure for the rest of this session only,
  // for the manual Start Rest and the automatic one after a set alike. A drop
  // set's zero rest stays zero: there is no rest there to lengthen.
  const baseRest = restAfter(methodAt(done.length), restSecondsFor(ex));
  const plannedRest = baseRest > 0 && restOverride[idx] != null ? restOverride[idx] : baseRest;
  // The set about to be done, or null once the plan is finished and the client
  // is adding sets of their own.
  const nextSet = plan[done.length] ?? null;
  // Whether the sets of this movement actually differ. It no longer decides
  // whether the per-set rows are DRAWN — see `planTicks` — but the two summary
  // lines still need it: "3 × 8-10 × 42.5 kg" is a true description of three
  // identical sets and a false one of a ramp, which is why it says "varied"
  // instead.
  const variedPlan = !!ex && hasSetRows(ex) && plan.some((r) => r.reps !== plan[0].reps || r.loadKg !== plan[0].loadKg || r.method !== plan[0].method
    || intensityLine(r.intensity) !== intensityLine(plan[0].intensity));
  /**
   * The plan as a CHECKLIST, and what a tap on each line would write.
   *
   * This used to be drawn only where the sets differed from one another, with
   * the argument that three identical rows under a line already reading
   * "3 × 8-10 × 42.5 kg" is the same sentence four times. That argument was
   * right about a table that only described the plan, and it stops being right
   * the moment the rows are the control that logs them: a member cannot tick
   * off a set that is not on screen, and "what is left" is the question the
   * report asked to have answered. So it is drawn for every movement with a
   * plan, and the sentence above it counts down.
   */
  const planTicks = setTicks(plan, done.length);
  const planLine = ticksLine(plan.length, done.length);
  /**
   * Tick one planned set off — which LOGS it, at the figures the plan asked
   * for, through the same `record` every typed set goes through.
   *
   * A prescription in seconds is recorded as a hold and not as a rep count.
   * That is the whole of `TickRecord`'s reason for having two shapes, and it is
   * the defect the one-tap button on the plan screen was fixed for: '45 sec'
   * parsed to 45 and went in as forty-five plank repetitions.
   *
   * A planned set with no load is a BODYWEIGHT set. `record` takes 0 for the
   * load and true for `bw`, which is what typing an empty load box does — see
   * `logSet` above, where an empty box has always meant exactly this.
   */
  const tickPlanned = (rec: TickRecord) => {
    if (rec.kind === 'hold') record(rec.secs, rec.loadKg ?? 0, rec.loadKg == null, true);
    else record(rec.value, rec.loadKg ?? 0, rec.loadKg == null, false);
  };
  /**
   * Take the most recent set back out.
   *
   * The feel goes with it. `rpes[idx]` is positional against `results[idx]` and
   * is only ever as long as it — a set logged and not yet answered for leaves
   * it one short — so the last feel belongs to the last set exactly when the
   * two are the same length. Popping the set and leaving the feel would slide
   * every "that was hard" up onto the set before it.
   *
   * The rest timer is deliberately left running. A member who mis-tapped is
   * still standing where they were standing, and cancelling their rest as a
   * side effect of fixing a tick is the app taking a decision about their
   * session that they did not ask for.
   */
  const untickLast = () => {
    const had = (results[idx] || []).length;
    if (!had) return;
    setResults((prev) => { const n = prev.map((a) => [...a]); n[idx].pop(); return n; });
    setRpes((prev) => { const n = prev.map((a) => [...a]); if (n[idx].length >= had) n[idx].pop(); return n; });
    // The prompt asks about a set that no longer exists.
    setPendingFeel(null);
    // And so does the record banner, when the set taken back is the one that
    // raised it. A banner raised by an EARLIER set of this movement stays: that
    // set is still in the session and the claim is still true of it.
    if (prAt.current === had - 1) { prAt.current = null; setPrMsg(null); }
    tapLight();
  };
  /**
   * The effort, share of a max and rep speed of THE SET ABOUT TO BE DONE.
   *
   * Read off `nextSet` rather than off the movement, for the same reason the
   * method badge above it is: set one can be a warm-up at @6 inside an exercise
   * whose top set is @9, and a screen that showed the movement's own figure
   * would be showing the wrong instruction to somebody standing at the bar.
   * Once the plan is finished and the client is adding sets of their own there
   * is no prescription left to show, and `nextSet` is null, so the movement's
   * own is used rather than nothing: a client doing a fifth set of a four set
   * plan is still doing this movement.
   */
  const nextIntensity = nextSet ? nextSet.intensity : intensityOf(ex, null);
  const nextIntensityLine = intensityLine(nextIntensity);
  const nextIntensityWords = intensityMeaning(nextIntensity);
  /**
   * What they did last time on this movement, and what the load box holds
   * next to it.
   *
   * `boxKg` is read off the box AS IT IS, not off the suggestion that seeded
   * it, so the comparison keeps up with what the member types. It is also why
   * the sentence is arithmetic rather than advice — see src/lib/lastTime.ts:
   * the claim is about two figures on this screen, and it stays true whether
   * the number came from `suggestForExercise` or from a thumb.
   *
   * A load the reader refuses — "16,5" on a German keyboard, a stray letter —
   * is passed as null rather than as a guess. There is nothing to compare and
   * the recap says so by staying quiet about it.
   */
  const boxRead = readLift(load, unit);
  /* ── what to put on the bar ──────────────────────────────────────────────
   *
   * `loadBar` and `warmupRamp` have been in src/lib since the client app was
   * written and their only mounts are app/(client)/tools.tsx and the coach's
   * `LiftingToolsPanel` — two screens nobody is on while holding a bar. Strong,
   * Hevy and Jefit all put this next to the weight field, because the moment
   * the arithmetic is wanted is the moment a number has just been typed and
   * somebody is standing at a rack deciding which discs to pick up.
   *
   * Drawn from the BOX and from nothing else. The alternative — inferring that
   * this movement is a barbell one from its name — is the trap
   * src/lib/strengthLifts.ts documents at length (Bench Dips, Bench Pull,
   * Overhead Carry all match the obvious patterns), and a plate breakdown drawn
   * under a dumbbell press is a lie somebody acts on with a loaded sleeve.
   * `ProgramExercise` carries no equipment field, so there is no honest signal
   * here; the member typing a load and reading the line is the signal.
   *
   * Withheld for a bodyweight set (the box is what was HUNG off a belt, not a
   * bar) and for a hold (the first box is seconds). Withheld too when the load
   * is under the bar, where `loadBar` answers null rather than inventing an
   * empty sleeve.
   *
   * `liftIn` back out of kilograms first, exactly as `LiftingToolsPanel` does:
   * `PLATES` and `BARS` are native per-unit lists and never converted, because
   * a 20 kg bar and a 45 lb bar are different objects with different discs
   * beside them.
   */
  const bars = BARS[unit];
  const bar = bars[Math.min(barIdx, bars.length - 1)];
  const barLoad = (!bwOn && !timedOn && boxRead.ok && boxRead.kg != null)
    ? loadBar(liftIn(boxRead.kg, unit), bar, unit)
    : null;
  const recall = lastTime({
    log,
    status: logStatus,
    exercise: nameOf(ex),
    today: runnerToday,
    unit,
    boxKg: boxRead.ok ? boxRead.kg : null,
  });

  const liveCols: { label: string; value: string; dot?: string }[] = [
    { label: 'Time', value: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` },
    { label: 'bpm', value: fig(liveHr ?? '–'), dot: liveHr ? hrColor(liveHr, age) : undefined },
    { label: 'kcal', value: fig(sessionKcal ?? '–') },
    { label: 'Peak', value: fig(hrPeak ?? '–'), dot: hrPeak ? hrColor(hrPeak, age) : undefined },
  ];

  const last = idx >= exercises.length - 1;
  // Past the coach's plan, and the client adding sets of their own. `nextSet`
  // is null here and the primary control becomes moving on, as it always did
  // once the plan was ticked off; the extra set is still one tap away.
  const pastPlan = plan.length > 0 && done.length >= plan.length;
  const sessionClock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const nextLabel = last ? 'Finish Session' : `Next Exercise ${FORWARD_ARROW}`;

  /* ── the board's header: a round back control, the title centred ─────────
     The trailing 38pt is the width of the back control, so the title is
     centred on the page and not on what is left of it. Under it, the runner's
     own line — which movement this is of how many, and the session clock,
     which the board's page 4 draws small at either side of the name — and the
     strip of movements that has always been here. */
  /* ── the focus mode's two grounds ─────────────────────────────────────────
     The whole runner is on night, and everything somebody acts on mid-set is
     drawn straight onto it in the night inks. What is CONTEXT — the sets done,
     last time, the coach's note, the watch, the music — sits below on a
     day-surface card, for a reason that is mechanical rather than aesthetic:
     `Notice`, `Flag`, the zone board, the written steps and the music bar all
     read the app's theme themselves, so on a light palette their ink is
     near-black and would vanish into night. A card gives them the ground
     their ink was measured against, unchanged. On a dark palette the card is
     one quiet step off the night and the page reads as one. */
  const dayCard = { backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg, marginTop: sp.xl } as const;
  const nt = onNight(t);
  // The mockup's tile: a night2 card with a 36pt Sora figure and its unit under.
  const tile = { flex: 1, flexBasis: 0, backgroundColor: t.night2, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: sp.sm, alignItems: 'center', gap: 2 } as const;
  // A live heart rate is one that is MOVING — `freshSample` is null for a
  // day's average and for a reading that has gone stale, and the third tile
  // and the zone strip exist only while it is not. No feed, two tiles.
  const liveBpm = typeof freshSample === 'number' && freshSample > 0 ? freshSample : null;
  // What the ring is a picture of. Resting, the share of the rest still to
  // run, so it drains. Working a HOLD, the share of the prescribed seconds
  // held. Working reps there is no target for a clock to fill towards, so the
  // ring is its track and the digits — an arc there would be a progress
  // nobody measured.
  const holdTarget = timedOn ? prescribedSeconds(nextSet?.reps ?? ex.reps) : null;
  const ringValue = rest > 0
    ? (restTotal.current > 0 ? Math.min(1, rest / restTotal.current) : null)
    : holdTarget ? Math.min(1, setElapsed / holdTarget) : null;
  /* The rest's provenance and the way out of it, under whichever ring is
     drawing it. Whose number this is: a client resting three minutes because
     their coach said so and a client resting because nobody set anything are
     looking at the same digits, and only one of them is following a program
     — so the fallback names itself rather than borrowing the coach's
     authority. */
  const restLine = rest > 0 ? (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.sm }}>{restIsMethods ? `Part of the ${methodFor(ex.method).method.label.toLowerCase()}` : ex.restSec != null ? 'Set by your coach' : `App default of ${DEFAULT_REST_SEC} seconds`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Skip the rest timer" onPress={skipRest}
        hitSlop={8} style={{ paddingVertical: sp.sm, paddingHorizontal: sp.md, minHeight: MIN_TARGET, justifyContent: 'center' }}>
        <Text style={{ ...ty.label, ...font('600'), color: t.nightInk3 }}>Skip Rest</Text>
      </Pressable>
    </View>
  ) : null;

  const nav = (title: string, onBack: () => void, backLabel: string) => (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        {/* The mockup's back control on night: a night2 disc. Built here
            because `Ghost` draws a white disc from the app's theme, which is
            the day ground's control and not this one's. 40pt, so it keeps the
            slop that carries it to a reachable target. */}
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} hitSlop={hitSlopFor(40)}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.night2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={BACK_ICON} size={20} color={t.nightInk} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={2}
          style={{ ...ty.page, color: t.nightInk, flex: 1, textAlign: 'center', textTransform: 'capitalize' }}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: sp.md }}>
        {/* The first thing the review's active-workout order asks for, so it
            is drawn in label weight and full ink rather than as a micro
            caption beside the clock: "which exercise am I on" is the question
            a glance at the runner is for. */}
        <Text style={{ ...ty.label, ...font('600'), ...numeric, color: t.nightInk }}>Exercise {idx + 1} of {exercises.length}{paused ? ' · Paused' : ''}</Text>
        <Text accessibilityLabel={`Session time ${sessionClock}`} style={{ ...ty.micro, ...numeric, color: t.nightInk2 }}>{sessionClock}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 5, marginTop: sp.sm }}>
        {exercises.map((_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i < idx ? t.brandBright : i === idx ? t.nightInk : t.night2 }} />)}
      </View>
    </>
  );

  /* ── "3 sets × 10 reps", off the program's own prescription ────────────
     `plan.length` is the coach's table where there is one and `sets` copies
     of the single spec where there is not. The reps are printed as the coach
     wrote them — "8-12", "AMRAP", "45 sec" — with " reps" added only to a bare
     count, because rewriting a hold is how forty-five seconds became
     forty-five repetitions once already (src/lib/timedSets.ts). A ramp says
     "varied" and the checklist below carries each set's own figures. The rest
     on this line is the rest that will actually run — a drop set says nothing
     here, because there is none. */
  const repsWord = (r: string) => (/^\d+(\s*[-–]\s*\d+)?$/.test(r.trim()) ? `${r.trim()} Reps` : r);
  const prescription = `${plan.length} Set${plan.length === 1 ? '' : 's'} × ${variedPlan ? 'Varied' : repsWord(ex.reps)}`
    + (ex.loadKg != null && !variedPlan ? ' × ' + fig(liftLabel(ex.loadKg, unit)) : '')
    + (plannedRest > 0 && (ex.restSec != null || restIsMethods) ? ' · ' + restClock(plannedRest) + ' Rest' : '');

  /* The run this movement is in, above its name — "Superset · 1 of 2" — with
     the words derived from how many movements are in the run rather than
     stored anywhere. A member reading it is being told the next movement
     follows immediately, which is the thing they need before they pick the
     weight up. */
  const groupLine = exGroup ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: sp.xl }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brandBright }} />
      <Text style={{ ...ty.label, ...font('500'), color: t.nightInk3 }}>{exGroup.label} · {exGroup.position} of {exGroup.size}</Text>
    </View>
  ) : null;
  /* How the sets are performed. The short marker is what fits beside a
     movement name; the full label is what a screen reader reads, because "RP"
     is not a word and nobody should have to know it. */
  const methodLine = exMethod ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: sp.sm }}>
      <View style={{ backgroundColor: t.night2, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 }}>
        <Text accessibilityLabel={exMethod.label} style={{ ...ty.caption, ...font('600'), color: t.nightInk2 }}>{exMethod.short}</Text>
      </View>
      <Text style={{ ...ty.label, color: t.nightInk2 }}>{exMethod.label}</Text>
    </View>
  ) : null;
  /* ── what this set asks for, beyond reps and load ─────────────────────────
     Drawn for the set that is next, and in words underneath. A client reading
     "@8" for the first time is being asked for something they cannot act on
     until somebody says it means two reps left; a tempo is worse, because the
     four digits are read in two different orders in the wild and only one of
     them is what their coach meant.

     The percentage is never converted into a weight here. See
     `intensityMeaning` in src/lib/setIntensity.ts: the only maxima this app
     holds are Epley estimates off logged sets, and a bar loaded off an
     estimate is the one thing this feature is not allowed to do. */
  const intensityBlock = nextIntensityLine ? (
    <View style={{ marginTop: sp.md, alignItems: 'center' }}>
      <Text style={{ ...ty.label, ...numeric, ...font('600'), color: t.nightInk }}>{nextIntensityLine}</Text>
      {nextIntensityWords.map((line) => (
        <Text key={line} style={{ ...ty.caption, color: t.nightInk2, marginTop: 2, textAlign: 'center' }}>{line}</Text>
      ))}
    </View>
  ) : null;

  /* ── the tempo this set is about to be recorded at ────────────────────────
     Offered ONLY where a coach prescribed one. A tempo box on every ordinary
     set is friction on every set of every session for a number nobody asked
     for; where a tempo WAS asked for it is the one thing the set exists to
     change, and until now the log could not say whether it happened. That
     makes the prescription falsifiable, which is the whole point.

     One tap confirms it. Saying something else takes more, and should: the
     notation is the part a member is least likely to have at their fingertips,
     so the box carries the prescribed value as its placeholder and the words
     underneath say what those four numbers mean — this app's own order, which
     is the defence against the minority convention that reads them backwards.

     Nothing confirmed records nothing. Neither control is a default: a set
     logged without touching either carries no tempo, and no screen may read
     that as a tempo of zero or as the prescription met. */
  const askTempo = prescribedTempoAt(done.length);
  const tempoBlock = askTempo ? (
    <View style={{ marginTop: sp.sm, alignItems: 'center', alignSelf: 'stretch' }}>
      <SetKindChip t={nt} on={tempoHit && !tempoOpen}
        onToggle={() => { setTempoOpen(false); setTempoText(''); setTempoHit((v) => !v); }}
        label={`Hit the ${askTempo} Tempo`}
        onLabel={`Hit the ${askTempo} Tempo, recorded as ${askTempo}`}
        a11yHint={`Your coach asked for ${tempoMeaning(askTempo)}. Tick this to record that you did it. Leave it alone and this set is logged with no tempo.`} />
      <Pressable accessibilityRole="button"
        accessibilityLabel={tempoOpen ? 'Cancel the tempo you were typing' : 'Record a different tempo'}
        accessibilityHint="For a set you did at a speed other than the one your coach asked for."
        hitSlop={hitSlopFor(24)}
        onPress={() => { setTempoOpen((v) => { if (!v) setTempoHit(false); else setTempoText(''); return !v; }); tapLight(); }}>
        <Text style={{ ...ty.caption, color: nt.ink3, textDecorationLine: 'underline' }}>
          {tempoOpen ? 'Never mind' : 'I did a different tempo'}
        </Text>
      </Pressable>
      {tempoOpen ? (
        <View style={{ alignItems: 'center', marginTop: sp.sm }}>
          <TextInput
            value={tempoText}
            onChangeText={setTempoText}
            autoCapitalize="characters"
            placeholder={askTempo}
            placeholderTextColor={t.nightInk2}
            accessibilityLabel="The tempo you actually did"
            accessibilityHint="Down, pause, up, and a pause at the top if there was one. Like 3-1-1 or 3-0-X-1."
            style={{ ...value(24), ...numeric, color: t.nightInk, textAlign: 'center', minWidth: 120, padding: 0 }} />
          {/* What those four numbers mean, as they are typed — the same
              sentence the builder prints under the coach's own box. A member
              reading the other convention sees this one disagree with them
              here, rather than after the set is in the log. */}
          <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: 2, textAlign: 'center' }}>
            {tempoMeaning(tempoText) ?? 'Down, pause, up, and a pause at the top if there was one.'}
          </Text>
        </View>
      ) : null}
    </View>
  ) : null;

  /* The caution under the movement the member is about to perform, and the
     sentence that has to stand in for it when there is nothing to compute it
     from. `injuries` is `[]` under a failed read as well as under a member who
     has disclosed nothing, so no caution here means two different things and
     only one of them is "this movement is fine for you". The absent line was
     the whole of the safety information in the session, so drawing them the
     same way is the picture of a checked, clear session.

     In the night inks: it is drawn in the focus zone of both pages now, beside
     the movement it is about, rather than a screen below on the context card. */
  const injuryLine = !isWhole(injuryStatus) ? (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: sp.md }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: injuryStatus === 'loading' ? t.ink3 : t.crit, marginTop: 5 }} />
      <Text style={{ ...ty.caption, color: t.nightInk2, flex: 1 }}>
        {injuryStatus === 'loading'
          ? 'Still reading what you have disclosed. This movement has not been checked against your injuries yet.'
          : 'Your injuries could not be read, so this movement has not been checked against them. Nothing here has been swapped or held back. Go easy if something is hurt.'}
      </Text>
    </View>
  ) : (() => { const f = injuryFlag(nameOf(ex), ex.group, injuries); return f ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
      <Text style={{ ...ty.caption, color: t.nightInk2, flex: 1 }}>{f.reason}. Ease off, keep it pain-free, or swap this move.</Text>
    </View>
  ) : null; })();

  /* ── what the coach wrote about THIS movement ──────────────────────────────
     Their words, on the screen somebody is looking at while standing at the
     machine — which is the whole reason the note is attached to the exercise
     and not to the week.

     ATTRIBUTED, and that is not decoration. Rendered bare it would read as the
     app telling somebody how to lift, which is not a thing this app is
     entitled to do; "From your coach" is a description rather than a name, so
     it is true whether or not the name could be read.

     Withheld once the movement has been SWAPPED. A cue written about a back
     squat is not advice about the leg press the client chose instead, and
     carrying it across would put the coach's name on guidance they never
     gave. */
  const coachNote = ex.note && nameOf(ex) === ex.name ? (
    <View style={{ marginTop: sp.lg, backgroundColor: t.surface2, borderRadius: radius.md, padding: sp.lg }}>
      <Text style={{ ...ty.micro, color: t.ink3 }}>From Your Coach</Text>
      <Text style={{ ...ty.body, color: t.ink, marginTop: sp.xs }}>{ex.note}</Text>
    </View>
  ) : null;

  const prBlock = prMsg ? (
    <View style={{ marginTop: sp.xl }}>
      <PrFlash key={prMsg}>
        <Notice tone={t.s3} kicker="Personal Record" title={prMsg} />
      </PrFlash>
    </View>
  ) : null;

  /* What a pause actually does, said where the clock is. Somebody comes back
     to this screen ten minutes later and has to be able to tell a stopped
     session from a broken one — and the sentence has to name the three things
     that stopped, because the session length it protects is written into a
     health record. */
  const pausedNotice = paused ? (
    <View style={{ marginTop: sp.lg }}>
      <Notice kicker="Paused" title="Your Session Clock Is Stopped"
        note="The clock, your rest countdown and your time in each heart-rate zone are all held where they are. Nothing you have logged is affected. Resume when you are back." />
    </View>
  ) : null;

  /* ── the sets done so far, and the way to take the last one back ──────────
     Reported from TestFlight as "can't untick a log if accidentally press". The
     ready page could: a filled tick on the checklist is a button that calls
     `untickLast`. But nothing SAID so, the set page — where Complete Set is —
     had no such control at all, and a set logged past the end of the plan has
     no tick row to sit on, so it could not be taken back from anywhere.

     One control, under the chips, on both pages, through the same `untickLast`
     the tick uses. Only the LAST set, for the reason src/lib/setTicks.ts gives:
     the log has no set numbers in it, so "undo set 2 of 5" is not a thing the
     store can express.

     And what the undo is honest about: these sets are not in the log. Nothing
     in this runner is written anywhere but this phone until the session is
     finished, so taking one back un-sends nothing and queues nothing — it
     changes the draft, and the draft effect above rewrites the copy on disk
     (or removes it, when that was the only set). The line says so, because a
     member who believes each Complete Set has already reached their coach has
     the wrong idea of what closing the app mid-session costs them. */
  const loggedChips = done.length > 0 ? (
    <View style={{ marginTop: sp.xl }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
        {done.map((s, i) => { const f = (rpes[idx] || [])[i]; const fc = f === 'easy' ? t.good : f === 'hard' ? t.crit : t.ink3; return (<View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 11, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6 }}>{f ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fc }} /> : null}<Text style={{ ...ty.label, ...numeric, ...font('500'), color: t.ink2 }}>Set {i + 1}: {s.timed
            ? timedSetLabel(s.reps, s.kg ? `${fig(liftIn(s.kg, unit))} ${unit}` : null, s.bw === true)
            : s.bw ? bodyweightSetLabel(s.reps, s.kg, s.kg ? `${fig(liftIn(s.kg, unit))} ${unit}` : null) : `${s.reps}×${fig(liftIn(s.kg || null, unit))} ${unit}`}</Text>{/* The marker of the set that was actually logged — set 1 can be a warm-up and set 4 a drop set inside one movement, so this is read per chip rather than once for the exercise. */}{(() => { const cb = badgeFor(methodAt(i)); return cb ? <Text accessibilityLabel={cb.label} style={{ ...ty.caption, ...font('600'), color: t.ink3 }}>{cb.short}</Text> : null; })()}</View>); })}
      </View>
      {/* ── the tempo, asked for against done ───────────────────────────────
          On its own lines under the chips rather than inside them, because a
          tempo is a sentence: "3-1-1-0" beside "8×60 kg" is four digits a
          member may be reading for the first time, and only `tempoMeaning`
          says which way round they go.

          A set that was asked for a tempo and recorded none says so in those
          words. It is NOT drawn as a miss and NOT drawn as a match — nobody
          answered, and the one thing this feature must never do is turn
          silence into either. Sets nobody asked about draw nothing at all. */}
      {done.map((s, i) => {
        const v = tempoVerdict(prescribedTempoAt(i), s.tempo);
        if (v.state === 'none') return null;
        // The tick is a MARK and the words carry the claim on their own — a
        // green sentence would be the colour saying it, which fails both the
        // contrast floor and anybody reading it in sunlight.
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 }}>
            {v.state === 'met' ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.good, marginTop: 5 }} /> : null}
            <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>{`Set ${i + 1}: ${v.line}`}</Text>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}>
        <Pressable accessibilityRole="button"
          accessibilityLabel={`Undo set ${done.length} of ${shownName(ex)}`}
          accessibilityHint="Takes the most recent set back out of this session. Nothing has been sent yet, so nothing is un-sent."
          onPress={untickLast}
          style={{ minHeight: MIN_TARGET, paddingHorizontal: sp.md, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring,
                   flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="minus" size={14} color={t.ink2} />
          <Text style={{ ...ty.label, ...font('500'), color: t.ink2 }}>Undo Set {done.length}</Text>
        </Pressable>
        <Text style={{ ...ty.caption, color: t.ink3, flex: 1, minWidth: 160 }}>
          Not in your log yet. Finishing the session is what saves {done.length === 1 ? 'it' : 'them'}.
        </Text>
      </View>
    </View>
  ) : null;

  /* ── the last time they did this ──────────────────────────────────────────
     The runner has always held the log. It used it to seed the load box from
     `suggestForExercise` and to check for a personal record at the end, and
     told the member neither — so a number appeared in a text field with no
     provenance, and a member who had done pull-ups on Tuesday got a blank box
     on Thursday because a bodyweight movement produces no suggestion at all.

     The five sentences are five different states and are drawn as one block
     deliberately: whichever it is, this is the line the member looks at before
     they pick the weight up, and it is never empty. The comparison under the
     chips moves as they type, because it is about the box rather than about
     the suggestion that seeded it. */
  const recallBlock = (
    <View style={{ marginTop: sp.xl }}>
      {recall.kind === 'outing' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: sp.sm }}>
            <Icon name="clock" size={14} color={t.ink3} />
            <Text style={{ ...ty.micro, color: t.ink3 }}>Last Time{recall.when ? ` · ${recall.when}` : ''}</Text>
          </View>
          <View
            accessibilityRole="text"
            accessibilityLabel={`Last time${recall.when ? `, ${recall.when}` : ''}: ${recall.sets.map((s) => s.label).join(', ')}${recall.more > 0 ? `, and ${recall.more} more` : ''}`}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            {recall.sets.map((s, i) => (
              <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{s.label}</Text>
              </View>
            ))}
            {/* Stated, not silently trimmed. A strip that simply stops is a
                strip the member reads as the whole session. */}
            {recall.more > 0 ? (
              <View style={{ borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ ...ty.caption, color: t.ink3 }}>and {recall.more} more</Text>
              </View>
            ) : null}
          </View>
          {recall.boxNote ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{recall.boxNote}</Text>
          ) : null}
        </>
      ) : recall.kind === 'error' ? (
        /* A read that failed is marked, and the mark is a dot rather than
           coloured words — the sentence already says it, and colour is never
           the only channel. */
        <Flag tone={t.warn}>{recall.note}</Flag>
      ) : (
        <Text style={{ ...ty.caption, color: t.ink3 }}>{recall.note}</Text>
      )}
    </View>
  );

  /* The ramp is worked out from the working load in kilograms — its
     percentages are of the bar, not of a converted figure — and each rung is
     read out in the member's unit. */
  const rampBlock = done.length === 0 ? (() => { const readTop = readLift(load, unit); const wu = warmupSets(readTop.ok ? (readTop.kg ?? 0) : 0); return wu.length ? (
    <View style={{ marginTop: sp.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: sp.sm }}><Icon name="flame" size={14} color={t.s3} /><Text style={{ ...ty.micro, color: t.ink3 }}>Warm-Up Ramp</Text></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
        {wu.map((ws, i) => <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{fig(liftLabel(ws.kg, unit))} × {ws.reps}</Text></View>)}
      </View>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Ramp up first. These don't count as working sets.</Text>
    </View>
  ) : null; })() : null;

  /* ── the watch, the zones and the music, under the task ──────────────────
     Below the core controls on every page, as the implementation notes ask,
     so an integration never displaces the set somebody is standing in front
     of. Nothing here changed shape: the live columns, the three heart-rate
     sentences, the zone panel and the music bar are the ones this runner has
     always drawn, in the same order. */
  const liveBlock = (
    <View style={{ ...dayCard, paddingTop: sp.lg }}>
      <MetricCols t={t} items={liveCols} />
      {liveHr == null ? (
        /* Was the literal "Wear your Apple Watch for live heart rate &
           calories", with no branch on `reach` at all — so a member whose
           watch WAS connected was told to wear the watch they had on, and
           never told the one thing that starts the stream. See liveHrNote. */
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{liveHrNote(reach ?? 'none', true)}</Text>
      ) : liveSample == null ? (
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          That bpm is today&apos;s average from your connected device, not a live reading, so it can&apos;t be used for zones.
          Live zones need an Apple Watch.
        </Text>
      ) : hrFresh.state !== 'live' ? (
        /* The third state, which did not exist. A real sample, and not a
           current one — drawn identically to a streaming one until now, which
           is why a heart rate that had stopped moving looked like a heart that
           had. It says how old, and it does NOT say reconnect the watch: that
           was tried, it changed nothing, and it could not have. */
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
          {staleHrNote(hrFresh.ageMs)}
        </Text>
      ) : null}

      {/* Live effort, and the same empty state as a timed session when there
          is no watch feeding it — see ZonePanel. */}
      <ZonePanel t={t} reach={reach} liveZone={liveZone} liveSample={freshSample ?? null} zoneSecs={zoneSecs} age={age} elapsed={elapsed} onPair={() => setPairing(true)} />

      {/* TF-36 — reachable without leaving the session. It renders nothing
          but an honest line when Spotify is not connected or the account
          cannot drive playback, so it costs a disconnected client no space
          they would resent. */}
      <SessionMusicBar />
    </View>
  );

  /* The same row src/ui/StretchRunner.tsx has carried since it was written,
     in the same order and drawn the same way — Back, then the clock control.
     There is no Skip here because the round control above already is one on
     the ready page, and the plain Skip under Complete Set is one on the set
     page: a second control meaning the same thing is how two paths into one
     action come to disagree. */
  const pauseRow = (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.xl, marginTop: sp.lg }}>
      {idx > 0 ? <Ghost label="Back" a11yLabel="Back to the previous exercise" onPress={back} /> : null}
      {!paused ? <Ghost label="Pause" a11yLabel="Pause the session" onPress={pause} /> : null}
    </View>
  );

  /* ── finishing a session you did not finish ──────────────────────────────
     Passed on by the owner from a member: "need to be able to finish a workout
     even if you didn't do all the exercises in the workout."

     It was already possible and it was not findable. `endSession` — the round
     control at the top of the page, labelled "End the session" — has offered
     "Save and End" beside "Discard" ever since the End button stopped throwing
     a half-finished session away. But the only word on the page that says
     "finish" appears on the LAST exercise, so a member standing on exercise
     three of five, done for the day, is looking at Next Exercise and Skip and
     a back arrow. Skipping forward twice to reach a Finish Session button is
     the workaround people were doing, and it walks them past two movements
     they have to decide about again.

     So the same door, in the place the decision is made, and only when there is
     something to save: nothing logged is `onClose` and needs no ceremony. The
     alert it opens is the one that names the sets and the movements left
     undone. */
  const finishEarlyRow = !paused && idx < exercises.length - 1 && loggedSets > 0 ? (
    <Pressable accessibilityRole="button"
      accessibilityLabel={`Finish here, keeping the ${loggedSets} set${loggedSets === 1 ? '' : 's'} you have logged`}
      onPress={endSession}
      style={{ alignSelf: 'stretch', alignItems: 'center', paddingVertical: sp.md, marginTop: sp.sm, minHeight: MIN_TARGET, justifyContent: 'center' }}>
      <Text style={{ ...ty.body, ...font('600'), color: t.nightInk2 }}>Finish Here</Text>
    </Pressable>
  ) : null;

  /* Which clock is the figure. A resting member and a working member are
     looking at the same digits, so the word above them says which. */
  const resting = rest > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.night }}>
      {/* Night is dark on every palette, so the clock and battery over it are
          light for as long as the runner is up; the bar's own style comes back
          when this unmounts. */}
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 4 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {view === 'set' ? (
          /* ── page 6: Workout Tracking ───────────────────────────────────── */
          <>
            {nav('Workout Tracking', () => setView('ready'), 'Back to the exercise')}
            {/* The clock is the figure, inside the ring. One element, one
                spoken sentence, and which clock it is said in words under the
                digits: the set clock counts UP, the rest counts DOWN and its
                ring drains with it. The rest is the same clock the coach reads
                while setting it, built by the same function, so the two cannot
                start disagreeing about what 90 seconds looks like. */}
            <View style={{ alignItems: 'center', marginTop: sp.lg }}>
              <HeroRing size={196} value={ringValue}
                figure={restClock(resting ? rest : setElapsed)}
                sub={resting ? `rest ${restClock(restTotal.current)}` : holdTarget ? `hold ${restClock(holdTarget)}` : `set ${done.length + 1}`}
                spoken={`${resting ? 'Rest' : 'Set'} ${restClock(resting ? rest : setElapsed)}`} />
            </View>
            {restLine}

            {groupLine}
            <Text style={{ ...ty.title, color: t.nightInk, textAlign: 'center', marginTop: exGroup ? sp.xs : sp.md, textTransform: 'capitalize' }}>{shownName(ex)}</Text>
            {methodLine}
            {/* Which set, of how many the coach asked for, as the mockup's
                pips — one per planned set, filled as they are logged, the one
                being worked in the bright ink. The pips are a picture of the
                sentence beside them and are hidden from a screen reader, which
                is read the sentence. Past the plan the words change and the
                pips are simply all full. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}>
              {plan.length ? (
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: 6, flexShrink: 1 }}>
                  {plan.map((_, i) => (
                    <View key={i} style={{ width: plan.length > 6 ? 16 : 30, height: 8, borderRadius: 4,
                      backgroundColor: i < done.length ? t.brandBright : i === done.length ? t.nightInk : t.night2 }} />
                  ))}
                </View>
              ) : null}
              <Text style={{ ...ty.caption, color: t.nightInk2 }}>
                {pastPlan
                  ? `All ${plan.length} sets done. Set ${done.length + 1} is extra`
                  : plan.length ? `Set ${done.length + 1} of ${plan.length}` : `Set ${done.length + 1}`}
              </Text>
            </View>
            {/* The ask, on every plan and not only on a ramp — on a ramp set 4
                has its own reps and its own load and the client should not
                have to count rows to find them. It was once drawn only where
                the sets differ, on the argument that the ready page had
                already said "3 × 8-10 × 42.5 kg" — but this is the page
                somebody is on with the bar in their hands, and the load box
                under it is seeded from their LOG, not from the plan. So a
                coach's 42.5 was nowhere on the screen that records the set.
                Printed as the coach wrote it, through `repsWord`. Nothing is
                prefilled into the boxes — what goes in the log is what was
                lifted, not what was planned. */}
            {nextSet ? (
              <Text style={{ ...ty.label, ...numeric, color: t.nightInk, textAlign: 'center', marginTop: sp.xs }}>
                {repsWord(nextSet.reps)}{nextSet.loadKg != null ? ' × ' + fig(liftLabel(nextSet.loadKg, unit)) : ''}
              </Text>
            ) : null}
            {/* The caution, beside the movement it is about and above the
                boxes — it was under the watch panel's neighbours, a screen
                below the set it qualifies. */}
            {injuryLine}
            {intensityBlock}

            {/* Reps and load as the two figures. They are boxes, not labels,
                because they are what gets written: a figure a member cannot
                correct is a figure they will log wrong rather than not log.
                The plan's own ask is the placeholder and nothing more — grey,
                and gone the moment a digit is typed. */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: sp.lg }}>
              <View style={tile}>
                <TextInput
                  value={reps}
                  onChangeText={setReps}
                  keyboardType="numeric"
                  placeholder={nextSet?.reps || fig(null)}
                  placeholderTextColor={t.nightInk2}
                  accessibilityLabel={timedOn ? 'How long you held it, in seconds' : 'How many reps you did'}
                  style={{ ...value(36), color: t.nightInk, textAlign: 'center', minWidth: 64, padding: 0 }}
                />
                <Text style={{ ...ty.caption, color: t.nightInk2 }}>{timedOn ? 'seconds' : 'reps'}</Text>
              </View>
              <View style={tile}>
                <TextInput
                  value={load}
                  onChangeText={setLoad}
                  keyboardType="decimal-pad"
                  placeholder={fig(null)}
                  placeholderTextColor={t.nightInk2}
                  accessibilityLabel={bwOn
                    ? (unit === 'kg' ? 'Added load in kilograms, on top of your bodyweight' : 'Added load in pounds, on top of your bodyweight')
                    : (unit === 'kg' ? 'Load in kilograms' : 'Load in pounds')}
                  style={{ ...value(36), color: t.nightInk, textAlign: 'center', minWidth: 64, padding: 0 }}
                />
                {/* The unit under the box is the control that flips it — the
                    same two-halves toggle this box has always carried, written
                    out here in the night inks because <WeightUnitToggle> draws
                    its unlit half in the day theme's quiet ink, which is not
                    readable on a night tile. Same roles, same write. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xs }}>
                  {bwOn ? <Text style={{ ...ty.caption, color: t.nightInk2 }}>added</Text> : null}
                  <View accessibilityRole="radiogroup" accessibilityLabel="Weight unit" style={{ flexDirection: 'row', gap: 2 }}>
                    {(['kg', 'lb'] as const).map((u) => {
                      const on = u === unit;
                      return (
                        <Pressable key={u} accessibilityRole="radio" accessibilityState={{ selected: on }}
                          accessibilityLabel={u === 'kg' ? 'Kilograms' : 'Pounds'}
                          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
                          onPress={() => { if (!on) settings.set({ weightUnit: u }); }}
                          style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: on ? t.night : 'transparent' }}>
                          <Text style={{ ...ty.caption, ...font(on ? '700' : '400'), color: on ? t.nightInk : t.nightInk2 }}>{u}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>
              {/* Only while a heart rate is STREAMING. The figure takes the red
                  of the data palette — heart rate's colour across the app — on
                  the red plate that ink is measured against, because the
                  palette has no red that clears on night in a light scheme
                  (#b91c1c on the night tile is 2.2:1). */}
              {liveBpm != null ? (
                <View accessible accessibilityLabel={`Heart rate ${liveBpm} beats per minute, live`} style={{ ...tile, backgroundColor: t.data.redSoft }}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={{ ...value(36), color: t.data.redInk }}>{fig(liveBpm)}</Text>
                  <Text style={{ ...ty.caption, color: t.data.redInk }}>bpm</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: sp.xl, flexWrap: 'wrap', justifyContent: 'center' }}>
              <SetKindChip t={nt} on={bwOn} onToggle={() => setBwOn((v) => !v)}
                label="Bodyweight Set"
                onLabel={`Bodyweight Set: the box above is what you added, in ${unit}`}
                a11yHint={bwOn
                  ? `The box holds what you added on top of your own weight, in ${unit}. Turn this off for a set on a bar or a machine.`
                  : 'Turn this on for a pull-up, a dip or a press-up. Leaving the load box empty does the same thing.'} />
              <SetKindChip t={nt} on={timedOn} onToggle={() => setTimedOn((v) => !v)}
                label="Timed Set"
                onLabel="Timed Set: the first box is seconds held"
                a11yHint={timedOn
                  ? 'The first box is the seconds you held it for. Turn this off to count reps instead.'
                  : 'Turn this on for a plank, a hollow hold or a wall sit, where the set is a length of time rather than a count.'} />
            </View>
            {/* Beside the two flags, because it is the third thing this set
                is — and, unlike them, present only where somebody asked. */}
            {tempoBlock}

            {/* ── which plates make that ─────────────────────────────────────
                Present only when there is a load in the box that a bar could
                carry. It states the bar it assumed, because a member on a 15 kg
                bar reading a breakdown for a 20 kg one would load 5 kg too
                little and nothing on screen would have said which bar was
                meant — and the bar is the one part of this that cannot be read
                off the box. */}
            {barLoad ? (
              <View style={{ marginTop: sp.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, flexWrap: 'wrap' }}>
                  <Text style={{ ...ty.micro, color: nt.ink3 }}>Per Side</Text>
                  {/* The bar, switchable. Two entries in `BARS`, so this is a
                      toggle rather than a picker — and it is a control rather
                      than a caption because the women's bar is on the rack of
                      most gyms. */}
                  <Pressable
                    onPress={() => { setBarIdx((i) => (i + 1) % bars.length); tapLight(); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Worked out for a ${plain(bar)} ${unit} bar. Tap to use the ${plain(bars[(barIdx + 1) % bars.length])} ${unit} bar instead.`}
                    hitSlop={hitSlopFor(MIN_TARGET)}
                    style={{ paddingHorizontal: sp.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: nt.surface2, minHeight: 28, justifyContent: 'center' }}
                  >
                    <Text style={{ ...ty.caption, ...numeric, color: nt.ink2 }}>{plain(bar)} {unit} bar</Text>
                  </Pressable>
                </View>
                <Text
                  accessible
                  accessibilityRole="text"
                  /* Spoken as a sentence. The visible line is a list of discs
                     read left to right off a sleeve, which is the right shape
                     to look at and the wrong one to hear. */
                  accessibilityLabel={barLoad.plates.length
                    ? `Per side: ${barLoad.plates.map((x) => plain(x)).join(', ')} ${unit}. ${barLoad.exact
                        ? `That makes ${plain(barLoad.total)} ${unit} on the bar.`
                        : `The nearest these plates make is ${plain(barLoad.total)} ${unit}.`}`
                    : `Just the bar: ${plain(bar)} ${unit}.`}
                  style={{ ...ty.body, ...numeric, color: nt.ink, marginTop: sp.xs }}
                >
                  {barLoad.plates.length ? barLoad.plates.map((x) => plain(x)).join('  ·  ') : 'Just the bar'}
                </Text>
                {/* `exact` is the field this refuses to round past. A rack that
                    cannot make 102.3 is a fact about the rack, and quietly
                    drawing the plates for 102.5 under the number somebody typed
                    is how the bar ends up heavier than the set they logged. */}
                {!barLoad.exact ? (
                  <Text style={{ ...ty.caption, color: nt.ink3, marginTop: 2 }}>
                    These plates do not make that exactly. The nearest under it is {plain(barLoad.total)} {unit}.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* ── the heart-rate zone, while there is one ─────────────────────
                Only with a streaming sample, for the reason the bpm tile gives:
                a zone worked out from a stale or averaged reading is a zone the
                member may have left. The number and the name lead and the
                colour is a mark beside them — src/lib/hr.ts is firm that a zone
                is never a bare swatch — and the five bands are the lib's own
                colours, the one in play drawn taller and the rest held back.
                The scale's caveat travels with it, as it does on every screen
                that prints a zone. */}
            {liveBpm != null && liveZone != null ? (
              <View style={{ backgroundColor: t.night2, borderRadius: radius.lg, padding: 14, marginTop: sp.md }}>
                <View accessible accessibilityLabel={`Heart-rate zone ${liveZone} of 5, ${zoneName(liveZone)}`}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: sp.sm }}>
                  <Text style={{ ...ty.caption, ...font('600'), color: t.nightInk2 }}>Heart-Rate Zone</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: zoneColor(liveZone) }} />
                    <Text style={{ ...ty.caption, ...font('700'), color: t.nightInk }}>Zone {liveZone} · {zoneName(liveZone)}</Text>
                  </View>
                </View>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 12, marginTop: sp.sm }}>
                  {ZONE_NOS.map((no) => (
                    <View key={no} style={{ flex: 1, height: no === liveZone ? 12 : 6, borderRadius: 3, backgroundColor: zoneColor(no), opacity: no === liveZone ? 1 : 0.45 }} />
                  ))}
                </View>
                {hrScaleNote(age) ? <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.sm }}>{hrScaleNote(age)}</Text> : null}
              </View>
            ) : null}

            {/* One wide bright control and a quiet one under it, as the mockup
                draws them on night. Which is which follows the rule this runner has
                always had: once the plan is ticked off, moving on is the
                primary action and the extra set is the quiet one. A skip
                writes nothing, so nothing is asked first; it moves on to the
                next movement, or on the last one it finishes the session —
                which does write, and says so in its label. */}
            <View style={{ marginTop: sp.lg }}>
              {paused
                ? <CtaBright label="Resume Session" onPress={resume} />
                : pastPlan
                ? <CtaBright label={nextLabel} onPress={next} />
                : <CtaBright label="Complete Set" a11yLabel={`Complete set ${done.length + 1}${plan.length ? ` of ${plan.length}` : ''}`} onPress={logSet} />}
            </View>
            {!paused ? (
              <Pressable accessibilityRole="button"
                accessibilityLabel={pastPlan ? `Complete set ${done.length + 1}, beyond the plan` : last ? 'Finish the session' : 'Skip the rest of this exercise'}
                onPress={pastPlan ? logSet : next}
                style={{ alignSelf: 'stretch', alignItems: 'center', paddingVertical: sp.md, marginTop: sp.sm, minHeight: MIN_TARGET, justifyContent: 'center' }}>
                <Text style={{ ...ty.body, ...font('600'), color: t.nightInk2 }}>{pastPlan ? 'Complete Set' : last ? 'Finish Session' : 'Skip'}</Text>
              </Pressable>
            ) : null}
            {finishEarlyRow}

            {/* Directly under the control it changed: the green button reads
                Resume Session while this is up, and the sentence saying what a
                pause holds used to be under the watch panel, a screen away. */}
            {pausedNotice}
            {prBlock}
            {pendingFeel != null ? (
              <View style={{ marginTop: sp.xl }}>
                <Text style={{ ...ty.micro, color: nt.ink3, marginBottom: sp.md }}>How Did That Set Feel?</Text>
                <View style={{ flexDirection: 'row', gap: sp.sm }}>
                  {(([['easy', 'Easy', t.good], ['ok', 'Just Right', t.brandBright], ['hard', 'Hard', t.crit]]) as ['easy' | 'ok' | 'hard', string, string][]).map(([f, lbl, c]) => (
                    <Pressable key={f} accessibilityRole="button" accessibilityLabel={`That set felt ${lbl.toLowerCase()}`} onPress={() => chooseFeel(f)} style={{ flex: 1, backgroundColor: nt.surface2, borderRadius: radius.sm, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
                      <Text style={{ ...ty.label, ...font('500'), color: nt.ink }}>{lbl}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={{ ...ty.caption, color: nt.ink3, marginTop: sp.sm }}>Tunes your next set: Easy adds weight, Hard eases it back.</Text>
              </View>
            ) : null}
            {/* Back and Pause, above everything that is only context. The
                review's order for a live set is the set, the rest, what is done
                and the way between movements — and THEN the watch, the zones
                and the music. This row was the last thing on the page, under
                all three. */}
            {pauseRow}
            {/* What is only context, on the day card — see `dayCard`. */}
            <View style={dayCard}>
              {loggedChips}
              {coachNote}
              {recallBlock}
              {rampBlock}
              {/* The movement, playing here rather than in a browser. A client
                  mid-set who is unsure of their form had no way to see the lift
                  from this screen at all — the only demo in the app was back on
                  the plan, behind leaving the session. The rest keeps counting
                  while they look; it is a wall-clock instant, not a timer on
                  this page. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={'See a demonstration of ' + shownName(ex)}
                onPress={() => openDemo('set')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.xl, minHeight: MIN_TARGET }}
              >
                <Icon name="video" size={14} color={t.ink3} />
                <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>See How This Is Done</Text>
                <Icon name={FORWARD_ICON} size={14} color={t.ink3} />
              </Pressable>
            </View>
            {liveBlock}
          </>
        ) : view === 'demo' ? (
          /* ── page 5: Exercise Demo ──────────────────────────────────────── */
          <>
            {nav('Exercise Demo', () => setView(demoFrom.current), 'Back')}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...ty.title, color: t.nightInk, textTransform: 'capitalize' }}>{shownName(ex)}</Text>
                <Text style={{ ...ty.label, color: t.nightInk2, marginTop: 2 }}>{prescription}</Text>
              </View>
              <Ghost icon="dumbbell" a11yLabel={`Start set ${done.length + 1}`} onPress={startSet} />
            </View>
            {/* No onSearch here, unlike the plan screen. A live session's sets
                live in this component's state and nowhere else, so sending the
                client to the browser risks the OS reclaiming the app and taking
                the whole session with it. "No demonstration yet" is the honest
                answer; losing an hour of logged work to a web search is not a
                fair price for it. */}
            <View style={{ ...dayCard, marginTop: sp.lg, paddingTop: sp.sm }}>
              <SessionDemo t={t} name={nameOf(ex)} videos={videos} videoStatus={videoStatus} preferTrainerId={preferTrainerId} />
            {/* The words, under the picture. `exercises.instructions` and
                `tips` were read by exactly ONE screen — the catalogue's own —
                so a member standing at the rack got a clip or an animation and
                no cue at all, on the screen where the cue is the thing they
                need. Same shape as the `met` column: populated, and nobody
                asked.

                `nameOf(ex)`, NOT `shownName(ex)`. The catalogue is keyed by
                the stored English identity, so a translated name would look up
                nothing and report every movement as having no instructions. */}
            <SessionSteps name={nameOf(ex)} />
            {coachNote}
            </View>
          </>
        ) : (
          /* ── page 4: Workout View ───────────────────────────────────────── */
          <>
            {/* The head names the SESSION and the Sora line under it names the
                movement. It used to say the movement twice, once in each. */}
            {nav(focus || 'Workout', endSession, 'End the session')}
            {groupLine}
            <Text style={{ ...ty.title, color: t.nightInk, textAlign: 'center', marginTop: exGroup ? sp.xs : sp.xl, textTransform: 'capitalize' }}>{shownName(ex)}</Text>
            {methodLine}
            <Text style={{ ...ty.label, ...numeric, color: t.nightInk2, textAlign: 'center', marginTop: sp.xs }}>{prescription}</Text>
            {/* The muscle group as the chip it is on Train, in the same colour. */}
            {ex.group ? (
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: sp.sm }}>
                <TonedChip label={titleCaseName(ex.group)} tone={groupTone(ex.group)} />
              </View>
            ) : null}
            {/* The caution, beside the movement it is about — above the demo
                and the controls, not under the checklist. */}
            {injuryLine}

            {/* The demonstration, in the first viewport, as the board draws
                it. It used to sit behind a "See how this is done" toggle, and
                SessionDemo's own note says why: mounted only while open, so a
                five-exercise session did not fire five catalogue reads at the
                moment somebody pressed Start. That property holds — this is
                ONE read, for the movement on screen, when it comes on screen;
                the four movements still to come are not looked up until they
                are reached. What it does not do is send anybody to a browser
                for a movement nobody filmed: rule 5 stays an honest sentence,
                in the card, with the movement's name over it. */}
            <View style={{ ...dayCard, marginTop: sp.lg }}>
              <SessionDemo t={t} name={nameOf(ex)} videos={videos} videoStatus={videoStatus} preferTrainerId={preferTrainerId} />
            </View>

            {/* The board's three round controls: start, in the bright accent; the
                demo and the third as night2 discs. The third is Swap while the movement
                can still be swapped — see `canSwap` for why that stops the
                moment a set is logged — and Skip once it cannot: it moves on
                to the next movement without logging anything for this one, or
                on the last movement finishes the session. Every one of them is
                named, since none has a word on it. */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: sp.xl, marginTop: sp.xl }}>
              <Pressable accessibilityRole="button"
                accessibilityLabel={`Start set ${done.length + 1} of ${shownName(ex)}`}
                accessibilityHint="Opens the set tracker with a clock, reps and load"
                onPress={startSet}
                style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: t.brandBright, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: t.brandDeep }} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Exercise demo"
                accessibilityHint="The demonstration with the written steps"
                onPress={() => openDemo('ready')}
                style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.night2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="play" size={20} color={t.nightInk} />
              </Pressable>
              <Pressable accessibilityRole="button"
                accessibilityLabel={canSwap ? `Swap ${shownName(ex)} for another movement` : last ? 'Finish the session' : 'Skip this exercise'}
                accessibilityHint={canSwap
                  ? 'The rack may be taken. Your session and everything you have logged stay as they are.'
                  : last ? 'Writes the session to your log' : 'Moves on without logging anything for this movement'}
                onPress={canSwap ? () => { setSwapOpen(true); tapLight(); } : next}
                style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: t.night2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={canSwap ? 'swap' : FORWARD_ICON} size={20} color={t.nightInk} />
              </Pressable>
            </View>
            {/* Said once a set is in, rather than the control simply changing
                meaning. A member who used Swap on exercise one and finds Skip
                on exercise two is owed the reason. */}
            {onSwap && done.length > 0 && (ex.alternatives?.length ?? 0) > 0 ? (
              <Text style={{ ...ty.caption, color: t.nightInk2, marginTop: sp.lg, textAlign: 'center' }}>
                You have logged a set of this, so it can no longer be swapped, because the sets would end up filed under the movement you swapped to.
              </Text>
            ) : null}

            {resting ? (
              <View style={{ alignItems: 'center', marginTop: sp.xl }}>
                <HeroRing size={136} value={ringValue} figure={restClock(rest)} sub="rest" spoken={`Rest ${restClock(rest)}`} />
                {restLine}
              </View>
            ) : (
              /* ── Starting a rest yourself ──────────────────────────────────
                 Reported as "there is not a way to start the timer between
                 reps". True: `startRest` was called from exactly one place,
                 inside `logSet`, so the timer only ever began as a side effect
                 of recording a set through that button.

                 Every other way of resting had no timer at all — resting
                 before the first set, between a warm-up and the working sets,
                 or after a set logged from the plan rather than the runner.
                 And once a rest was skipped it could not be restarted, only
                 waited out by eye.

                 It starts the SAME number the automatic one would, from the
                 same `plannedRest`, so a rest a client starts and a rest the
                 app starts cannot disagree about what their coach asked for.
                 Shown only when the exercise has a rest to run; a movement
                 with none has nothing for this control to do. */
              plannedRest > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.xl }}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Rest 15 seconds shorter"
                    disabled={plannedRest <= 15}
                    onPress={() => setRestOverride((o) => ({ ...o, [idx]: Math.max(15, plannedRest - 15) }))}
                    style={{ width: 56, alignSelf: 'stretch', borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: t.night2, opacity: plannedRest <= 15 ? 0.4 : 1 }}>
                    <Icon name="minus" size={22} color={t.nightInk} />
                  </Pressable>
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={`Start the ${restClock(plannedRest)} rest`}
                    onPress={() => startRest(plannedRest)}
                    style={{ flex: 1, borderRadius: radius.lg, padding: sp.lg, alignItems: 'center', backgroundColor: t.night2 }}>
                    <Text style={{ ...ty.label, ...font('600'), color: t.nightInk }}>Start Rest</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.nightInk2, marginTop: 2 }}>
                      {restClock(plannedRest)}{restOverride[idx] != null ? ' · Your Choice' : ex.restSec != null ? ' · Set by Your Coach' : ' · App Default'}
                    </Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Rest 15 seconds longer"
                    disabled={plannedRest >= 600}
                    onPress={() => setRestOverride((o) => ({ ...o, [idx]: Math.min(600, plannedRest + 15) }))}
                    style={{ width: 56, alignSelf: 'stretch', borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: t.night2, opacity: plannedRest >= 600 ? 0.4 : 1 }}>
                    <Icon name="plus" size={22} color={t.nightInk} />
                  </Pressable>
                </View>
              ) : null
            )}

            {intensityBlock}
            {/* ── the plan, ticked off ──────────────────────────────────────
                One line per planned set, with a box that logs it. The set page
                is still the only way to record a set that did not go to plan —
                a rep short, a load changed at the rack, an AMRAP. The tick is
                for the sets that DID go to plan, which is most of them, and it
                is the difference between four typed numbers and one tap.

                Every load is converted at this line, by `liftLabel`, and
                nowhere earlier. What is stored is kilograms. */}
            {prBlock}
            {pausedNotice}
            {/* The plan to tick, and what is only context, on the day card —
                see `dayCard`. */}
            <View style={dayCard}>
              {plan.length ? (
                <View style={{ marginTop: sp.xl }}>
                  <SetChecklist
                    t={t} ticks={planTicks} movement={shownName(ex)} line={planLine}
                    askFor={(n) => {
                      const r = plan[n - 1];
                      if (!r) return { text: '', loadText: null };
                      const loadText = r.loadKg != null ? liftLabel(r.loadKg, unit) : null;
                      return {
                        text: `${r.reps}${r.loadKg != null ? ' × ' + fig(liftLabel(r.loadKg, unit)) : ''}`,
                        loadText,
                      };
                    }}
                    onTick={(_n, rec) => tickPlanned(rec)}
                    onUntick={() => untickLast()}
                    extraFor={(n) => {
                      const r = plan[n - 1];
                      if (!r) return null;
                      const rb = badgeFor(r.method);
                      const line = intensityLine(r.intensity);
                      if (!rb && !line) return null;
                      return (
                        <>
                          {rb ? (
                            <Text accessibilityLabel={rb.label} style={{ ...ty.caption, ...font('600'), color: t.ink3 }}>{rb.short}</Text>
                          ) : null}
                          {/* Each row's own effort, share and tempo — a warm-up
                              single at @6 and a top set at @9 are two different
                              instructions and this is the only row that can hold
                              both. */}
                          {line ? (
                            <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{line}</Text>
                          ) : null}
                        </>
                      );
                    }} />
                </View>
              ) : null}
              {coachNote}
              {loggedChips}
              {recallBlock}
              {rampBlock}
            </View>

            {/* Next, Back and Pause BEFORE the watch panel. They were under it:
                on a session with a zone board and a music bar, "what do I tap
                next" once the sets were ticked was answered two screens down,
                past integrations — which is the one thing the review's
                acceptance test for this flow rules out. Nothing about the
                controls changed; `liveBlock` is simply last now, on both pages. */}
            <View style={{ marginTop: sp.xl }}>
              {paused
                ? <CtaBright label="Resume Session" onPress={resume} />
                : done.length >= plan.length
                ? <CtaBright label={nextLabel} onPress={next} />
                : <Ghost label={nextLabel} onPress={next} />}
            </View>
            {finishEarlyRow}
            {pauseRow}
            {liveBlock}
          </>
        )}

        {/* Over the runner, never instead of it. `onPaired` rebuilds the
            zones from whatever the watch already holds for this window, so a
            member who pairs ten minutes in gets the ten minutes the watch
            recorded before the app was allowed to read them — and no more
            than that, which is what MID_SESSION_GAP_NOTE says out loud. */}
        <PairMonitorSheet t={t} visible={pairing} onClose={() => setPairing(false)} reach={reach}
          hasSample={freshSample != null} onPaired={() => { void rebuildZonesFromWatch(); }} />

        <Modal visible={swapOpen} transparent animationType="slide" onRequestClose={() => setSwapOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSwapOpen(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 32 }}>
            {ex ? (
              <View>
                <Text style={{ ...ty.head, color: t.ink, textTransform: 'capitalize' }}>Swap {shownName(ex)}</Text>
                <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs }}>
                  Your sets, your clock and your time in each zone all stay where they are. Your plan keeps the swap, so it is the movement you did that goes into your record.
                </Text>
                <View style={{ marginTop: sp.lg }}>
                  {[ex.name, ...(ex.alternatives ?? [])].map((alt) => {
                    const on = nameOf(ex) === alt;
                    return (
                      <Pressable
                        key={alt}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={on ? `${movement(alt)}, the movement you are on` : `Swap to ${movement(alt)}`}
                        onPress={() => { if (!on) onSwap?.(ex, alt); setSwapOpen(false); }}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.md, minHeight: MIN_TARGET }}
                      >
                        <Text style={{ ...ty.body, color: on ? t.ink : t.ink2, ...font(on ? '600' : '400'), textTransform: 'capitalize', flex: 1 }}>{movement(alt)}</Text>
                        {/* A tick, not a colour. The selected row is the one the
                            member is standing at, and a brand-tinted row says
                            nothing to a screen reader or to anybody who cannot
                            separate the two hues. */}
                        {on ? <Icon name="check" size={16} color={t.brand} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
                  <Ghost label="Keep This One" onPress={() => setSwapOpen(false)} />
                </View>
              </View>
            ) : null}
          </View>
        </Modal>
      </ScrollView>
      <Confetti show={confetti} onDone={() => setConfetti(false)} />
    </SafeAreaView>
  );
}

// Edit, and now REPLACE, one logged entry.
//
// ── What was already here, and what the report actually asked for ──────────
//
// Editing shipped with TF-02: this sheet, `readWorkoutEdit` in
// src/lib/entryEdit.ts, and a delete beside it. Two reports came back on it.
//
// "No way to edit or delete an exercise that has been entered" is a
// discoverability report, not a missing feature — both actions lived only
// inside the month-calendar modal, and Train showed a member nothing they had
// already saved. The fix for that is the "Already in your log" section on the
// screen itself, not here.
//
// "You have the option to delete the exercise but not able to replace with" is
// the real gap, and it is the more useful of the two. Somebody who logged five
// sets of Front Squat when they did Back Squat could only delete the entry and
// type all five again — losing the reps and loads they had just entered to
// correct a single word. The name was editable as free text, but nothing on
// screen said so, nothing offered the movement they meant, and nothing said
// what would happen to the sets. All three are answered below.
//
// ── What happens to the sets, and to a PR ─────────────────────────────────
//
// The sets stay with the entry and move to the new movement. That is what the
// report is asking for — a wrong label on the right work — and it is also the
// only reading that keeps the record honest: the reps and the load happened,
// and it is the name attached to them that was wrong.
//
// A personal record follows them, and nothing has to be done to make it. There
// is no PR table: `personalRecords` in src/lib/streaks.ts and `prTimeline` in
// src/lib/longView.ts both derive the board from the log by exercise name every
// time they are called. So the moment the row's `exercise` changes, the best
// set counts towards the new movement and the old one falls back to whatever
// else is logged against it — which is the truth. A PR credited to Front Squat
// off a set of Back Squats is a record nobody set.
//
// "Unless the person says otherwise" is the "Clear the sets" action: it empties
// the rows for retyping rather than saving an entry with nothing in it, because
// `readWorkoutEdit` refuses that and names the delete button, and an entry with
// no sets is a ghost in the calendar that cannot be corrected either.
//
// ── The unit ───────────────────────────────────────────────────────────────
//
// The loads are shown and typed in the member's own unit and stored in
// kilograms, through `readLift`/`liftIn`. The rows hold TEXT rather than
// numbers so that typing "137.5" is not re-rendered halfway through as "13" by
// a controlled input converting every keystroke and back.
//
// Mounted only while it is open (see the caller) so it always opens on the
// entry's current values rather than the first one ever edited.
//
// What the fields say is read and checked in src/lib/entryEdit.ts rather than
// here, and two things move out with it. A field that is not a number is now
// refused instead of becoming 0 — `parseInt('abc', 10) || 0` is what this
// shipped with, and a mistyped calorie box turning into a confident zero is a
// fabricated figure sitting in a health record. And the patch it returns cannot
// carry `t` at all, which makes "a correction does not move the day" a compile
// error rather than a habit: an entry fixed on Thursday stays on Tuesday, where
// the calendar dots, the streak, History's monthly bars and the coach's week
// all read it from.
export function EditEntrySheet({ t, unit, entry, suggestions, onClose, onSave }: {
  t: Theme; unit: WeightUnit; entry: WorkoutEntry; suggestions: string[];
  onClose: () => void; onSave: (patch: Partial<WorkoutEntry>) => Promise<boolean>;
}) {
  const reach = useReachability();
  const [name, setName] = useState(entry.exercise);
  // Reps and load as TEXT, in the member's unit, converted once on the way in
  // and once on the way out.
  //
  // `bw` and `timed` come in WITH the row, and that is the fix. The sheet built
  // its rows from the `[reps, kg]` pair alone and wrote the pair back, so it
  // could not see a hold or a bodyweight set: a 45-second plank opened in a
  // column headed "Reps" showing 45, a pull-up opened showing no load, and
  // saving dropped both flags off the entry entirely — turning a session of
  // calisthenics into weighted sets worth nothing to any board. Carrying the
  // flags on the row rather than in arrays beside it is also what stops adding
  // or removing a row leaving the survivors describing different sets. See
  // src/lib/entryEdit.ts.
  const [rows, setRows] = useState<{ reps: string; load: string; bw: boolean; timed: boolean }[]>(() =>
    (entry.sets ?? []).map(([r, kg], i) => ({
      reps: r ? String(r) : '',
      load: kg ? plain(liftIn(kg, unit) ?? 0) : '',
      bw: entry.bw?.[i] === true,
      timed: entry.timed?.[i] === true,
    })));
  const [mins, setMins] = useState(entry.cardio ? String(entry.cardio.mins) : '');
  const [dist, setDist] = useState(entry.cardio ? String(entry.cardio.dist) : '');
  // The unit is EDITABLE here, and it is the one field on a cardio entry most
  // likely to be wrong: the app opened every cardio log on kilometres for
  // everybody until recently, so a member in Dallas filed a five-mile run as
  // five kilometres — and the only remedy this sheet offered was to delete the
  // session, which also discards the heart-rate zones nobody can retype.
  const [distUnit, setDistUnit] = useState<DistanceUnit>(entry.cardio?.unit === 'mi' ? 'mi' : 'km');
  const [watts, setWatts] = useState(entry.cardio && entry.cardio.watts ? String(entry.cardio.watts) : '');
  const [kcal, setKcal] = useState(entry.kcal != null ? String(entry.kcal) : '');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const isCardio = !!entry.cardio;
  const trimmed = name.trim();
  // Case-insensitive, because everything else that groups by exercise name is:
  // re-saving "back squat" as "Back Squat" is a capitalisation, not a swap, and
  // announcing a replacement for it would be nonsense.
  const replacing = trimmed !== '' && trimmed.toLowerCase() !== entry.exercise.trim().toLowerCase();
  const setAt = (i: number, key: 'reps' | 'load', v: string) =>
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, [key]: v } : r)));
  const flagAt = (i: number, key: 'bw' | 'timed') =>
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, [key]: !r[key] } : r)));

  // What to offer. Narrowed by whatever has been typed — but only once the
  // name has actually been changed. Filtering on the untouched name would open
  // the picker on the one list guaranteed to be useless: the movements whose
  // names contain the movement being replaced. The entry's own current name is
  // never offered as a replacement for itself either way.
  const q = replacing ? trimmed.toLowerCase() : '';
  const matches = suggestions
    .filter((n) => n.toLowerCase() !== entry.exercise.trim().toLowerCase())
    .filter((n) => q === '' || n.toLowerCase().includes(q))
    .slice(0, 20);

  // Which day this entry is on, said out loud. A correction never moves it, and
  // somebody fixing Tuesday's session on a Thursday should be able to see that
  // rather than take it on trust. Built from the calendar numbers, not from a
  // second `new Date()`, for the reason src/lib/localDate.ts sets out.
  const dayLabel = (() => {
    const key = dayKeyOf(entry.t);
    if (!key) return null;
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  })();

  const save = async () => {
    if (busy) return;
    // The loads go back to kilograms here, one row at a time, so a refusal can
    // name the row it came from. `readLift` states its bound in the unit on the
    // keyboard, and a blank box is a bodyweight set rather than a refusal.
    const sets: WorkoutDraftSet[] = [];
    for (let i = 0; i < rows.length; i++) {
      const read = readLift(rows[i].load, unit);
      if (!read.ok) { Alert.alert(`Check Set ${i + 1}`, read.reason); return; }
      sets.push({
        reps: parseInt(rows[i].reps, 10) || 0,
        kg: read.kg ?? 0,
        bw: rows[i].bw,
        timed: rows[i].timed,
      });
    }
    const read = readWorkoutEdit(entry, { name, sets, mins, dist, distUnit, watts, kcal });
    if (!read.ok) { Alert.alert('Check That', read.reason); return; }
    setBusy(true);
    const saved = await onSave(read.value);
    setBusy(false);
    // Left open on failure with everything still typed in it. The caller has
    // left the log untouched, so closing here would both throw the correction
    // away and imply it had been taken.
    if (!saved) {
      // The second half used to be "Check your connection and save again"
      // whatever had happened, which `retryLine` replaces — see
      // src/lib/reachability.ts.
      //
      // The first half moved one word with it, and had to. It said the
      // correction "did not reach the server", which is only one of the two
      // things that can be true here and flatly contradicts the sentence
      // `retryLine` appends when the server DID read it and refuse. "did not
      // reach your record" is true either way, and is the thing the member
      // cares about: what their log now says.
      Alert.alert('Not Saved', `Your correction did not reach your record, so this entry still reads as it did, on this phone as well. ${retryLine(reach)}`);
    }
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10, ...ty.body } as const;
  const setCount = rows.filter((r) => (parseInt(r.reps, 10) || 0) > 0).length;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose}
          accessibilityRole="button" accessibilityLabel="Close" />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '86%', ...elevation.e2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: sp.lg }}>
          <Pressable onPress={onClose} hitSlop={8}><Text style={{ ...ty.body, ...font('500'), color: t.ink3 }}>Cancel</Text></Pressable>
          <Text style={{ ...ty.head, color: t.ink }}>Edit Entry</Text>
          <Pressable onPress={save} hitSlop={8} disabled={busy}><Text style={{ ...ty.body, ...font('600'), color: busy ? t.ink3 : t.brandText }}>{busy ? 'Saving…' : 'Save'}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {dayLabel ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              Logged on {dayLabel}. Correcting it leaves it on that day. Your calendar, streak and history all read it from there.
            </Text>
          ) : null}
          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>Exercise</Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
            <TextInput value={name} onChangeText={setName} style={{ ...inp, flex: 1 }} placeholder="Exercise" placeholderTextColor={t.ink3} />
            {/* The affordance the report was missing. The field underneath has
                always accepted a different name; nothing said so, and nobody
                types a movement they can be offered. */}
            <Pressable accessibilityRole="button" accessibilityLabel={picking ? 'Hide the list of movements' : 'Replace with another movement'}
              onPress={() => { setPicking((v) => !v); tapLight(); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }}>
              <Icon name="swap" size={14} color={t.ink2} />
              <Text style={{ ...ty.caption, ...font('600'), color: t.ink }}>Replace</Text>
            </Pressable>
          </View>

          {picking ? (
            matches.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
                {matches.map((n) => (
                  <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Replace with ${n}`}
                    onPress={() => { setName(n); setPicking(false); tapLight(); }}
                    style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                    <Text style={{ ...ty.caption, ...font('500'), color: t.ink2, textTransform: 'capitalize' }}>{n}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              // Never a silent empty list: the field above still takes anything
              // typed, and saying so is the difference between "no matches" and
              // "you cannot do this here".
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Nothing in today's plan or your history matches that. Type the movement in full above. Anything you type is accepted.
              </Text>
            )
          ) : null}

          {replacing ? (
            <View style={{ marginTop: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm, padding: sp.md }}>
              <Text style={{ ...ty.caption, color: t.ink2 }}>
                Replacing {entry.exercise} with {trimmed}.
              </Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
                {isCardio
                  ? 'The minutes, distance and the heart-rate zones recorded against it stay. Nobody can retype a heart rate, and they were measured whatever the session was called.'
                  : setCount > 0
                  ? `The ${setCount} set${setCount === 1 ? '' : 's'} below come with it, so you do not have to type them again. Your best one counts towards ${trimmed} from now on, and ${entry.exercise} falls back to whatever else you have logged against it. A record set on this work belongs to the movement you actually did.`
                  : 'There are no sets on this entry to move.'}
              </Text>
              {!isCardio && rows.length > 0 ? (
                <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                  {/* "Unless the person says otherwise". This empties the rows
                      for retyping rather than saving an entry with none —
                      readWorkoutEdit refuses that and names the delete button,
                      because an entry with nothing in it still counts as a
                      session in the calendar and the streak. */}
                  <Ghost label="Clear the Sets and Retype Them" onPress={() => { setRows([{ reps: '', load: '', bw: false, timed: false }]); tapLight(); }} />
                </View>
              ) : null}
            </View>
          ) : null}

          {isCardio ? (
            <View style={{ marginTop: sp.xl }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Cardio</Text>
              {/* Labels, not placeholders. This sheet opens holding the numbers
                  already logged, so every placeholder below was invisible from
                  the moment it appeared — three bare numerals under one word,
                  with nothing to say which was minutes, which was distance, or
                  that 141 was watts rather than a heart rate. */}
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <Field label="Minutes">
                  <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" style={inp} />
                </Field>
                {/* The same tap-to-switch pill the logging form has, for the
                    same reason: a fixed label states the unit and cannot fix
                    it, and this is the correction sheet. */}
                <Field label="Distance" hint={distUnit} a11y={`Distance in ${distanceUnitName(distUnit)}`}>
                  <View style={{ flexDirection: 'row', gap: sp.sm }}>
                    <TextInput value={dist} onChangeText={setDist} keyboardType="decimal-pad" style={inp} />
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={`Distance unit: ${distanceUnitName(distUnit)}. Switch to ${distanceUnitName(distUnit === 'km' ? 'mi' : 'km')}`}
                      hitSlop={hitSlopFor(36)}
                      onPress={() => setDistUnit(distUnit === 'km' ? 'mi' : 'km')}
                      style={{ minHeight: 36, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, justifyContent: 'center' }}>
                      <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>{distUnit}</Text>
                    </Pressable>
                  </View>
                </Field>
              </View>
              <Field label="Avg Watts" hint="optional" style={{ marginTop: sp.md }}>
                <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" style={inp} />
              </Field>
            </View>
          ) : (
            <View style={{ marginTop: sp.xl }}>
              {/* The unit is named in the heading rather than left to the
                  placeholder, which disappears the moment a row has a number
                  in it — and a column of loads with no unit over it is exactly
                  how somebody types pounds into a kilogram field. */}
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Sets</Text>
              {/* A heading over the whole block named the units once; these name
                  the two columns, and stay put once there are numbers in them. */}
              {/* The first column is headed per ROW now, because a set of ten
                  and a forty-five second hold sit in the same table and one
                  heading over both is how a plank came to read as reps. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: 6 }}>
                <View style={{ width: 22 }} />
                <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>Reps or Seconds</Text>
                <Text style={{ ...ty.caption, color: 'transparent' }}>×</Text>
                <View style={{ flex: 1 }}><WeightUnitToggle compact /></View>
                <View style={{ width: 24 }} />
              </View>
              {rows.map((r, i) => (
                <View key={i} style={{ marginBottom: sp.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                    <Text style={{ ...ty.caption, color: t.ink3, width: 22 }}>{i + 1}</Text>
                    <TextInput value={r.reps} onChangeText={(v) => setAt(i, 'reps', v)} keyboardType="numeric"
                      accessibilityLabel={r.timed ? `Set ${i + 1}, seconds held` : `Set ${i + 1}, reps`}
                      placeholder={r.timed ? 'Secs' : 'Reps'} placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                    <Text style={{ ...ty.caption, color: t.ink3 }}>×</Text>
                    <TextInput value={r.load} onChangeText={(v) => setAt(i, 'load', v)} keyboardType="decimal-pad"
                      accessibilityLabel={r.bw ? `Set ${i + 1}, load added on top of your bodyweight in ${unit === 'kg' ? 'kilograms' : 'pounds'}` : `Set ${i + 1}, load in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
                      placeholder={r.bw ? `+${unit}` : unit} placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                    <Pressable accessibilityLabel={`Remove set ${i + 1}`} hitSlop={8} onPress={() => setRows((p) => p.filter((_, k) => k !== i))} style={{ padding: 4 }}>
                      <Icon name="minus" size={16} color={t.crit} />
                    </Pressable>
                  </View>
                  {/* What the set WAS, and it is per set: a movement's first set
                      can be a hold and its next three ordinary. Both flags are
                      the ones the runner writes, so a set edited here reads back
                      to every board exactly as a set logged live does. */}
                  <View style={{ flexDirection: 'row', gap: sp.lg, paddingStart: 22 + sp.sm }}>
                    <SetKindChip t={t} on={r.bw} onToggle={() => { flagAt(i, 'bw'); tapLight(); }}
                      label={`Set ${i + 1} Bodyweight`} onLabel={`Set ${i + 1} Bodyweight`}
                      a11yHint={r.bw
                        ? `The load box beside it is what you added on top of your own weight, in ${unit}. Turn this off for a set on a bar or a machine.`
                        : 'Turn this on for a pull-up, a dip or a press-up.'} />
                    <SetKindChip t={t} on={r.timed} onToggle={() => { flagAt(i, 'timed'); tapLight(); }}
                      label={`Set ${i + 1} Timed`} onLabel={`Set ${i + 1} Timed`}
                      a11yHint={r.timed
                        ? 'The first box is the seconds you held it for. Turn this off to count reps instead.'
                        : 'Turn this on for a plank or a wall sit, where the set is a length of time rather than a count.'} />
                  </View>
                </View>
              ))}
              <Ghost label="Add Set" onPress={() => setRows((p) => [...p, { reps: '', load: p.length ? p[p.length - 1].load : '', bw: p.length ? p[p.length - 1].bw : false, timed: p.length ? p[p.length - 1].timed : false }])} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Tick Bodyweight for a set you did with your own body. The load box is then whatever you added on top. Tick Timed for a hold, and the first box counts seconds.
              </Text>
            </View>
          )}

          <View style={{ marginTop: sp.xl }}>
            <Field label="Calories" hint="kcal · leave blank if unknown">
              <TextInput value={kcal} onChangeText={setKcal} keyboardType="numeric" style={inp} />
            </Field>
          </View>
        </ScrollView>
      </View>
          </KeyboardAvoidingView>
    </Modal>
  );
}
