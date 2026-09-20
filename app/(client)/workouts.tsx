// Train — the day's session on the instrument-panel kit (`src/ui/kit`) and the
// scale (`src/theme/scale`). Every provider, hook, conditional branch and route
// from the previous version is preserved; only the presentation changed: one
// hero figure instead of a stack of competing bold numbers, hairline-separated
// sections and list rows instead of eighteen bordered cards, and accent spent
// only on the live metric and the primary action.
// Guided session runner, cardio logging & month calendar preserved.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
// The clock this screen judges "today" by, kept live across the midnight a
// late session runs past. See the note at `useNow()` below.
import { useNow, useToday } from '../../src/ui/today';
// What this member did the last time they did the movement on screen, and how
// the number sitting in the load box compares to it. The runner has held the
// log and its status since it was written and used them for one thing — the PR
// confetti — so four different reasons for a blank box all looked the same
// from the gym floor. See src/lib/lastTime.ts.
import { lastTime } from '../../src/lib/lastTime';
import { BRAND } from '../../src/lib/brands';
import { maintenanceFor } from '../../src/lib/nutrition';
import { num } from '../../src/lib/format';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Alert, KeyboardAvoidingView, Platform, AppState, StatusBar } from 'react-native';
import { GuardedImage } from '../../src/ui/GuardedImage';
import { SessionSteps } from '../../src/ui/SessionSteps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hrFreshness, staleHrNote } from '../../src/lib/hrFreshness';
import { watchReach, zonesNote, liveHrNote, type WatchReach } from '../../src/lib/watchReach';
import { type LiveSession } from '../../src/lib/liveSession';
// Whose session, whose sets, whose draft. The three keys on this screen were
// device-global, and a session restored under the wrong member is finished
// under the wrong member's id — see the header of that file.
import {
  DraftGate, LEGACY_SESSION_KEYS, gateForKey, gateHydrated, guidedDraftKey,
  isLegacyWorkoutDraftKey, liveSessionKey, liveSessionResume, mayPersist,
  workoutDraftKey,
} from '../../src/lib/sessionScope';
import { startLiveActivity, endLiveActivity } from '../../modules/workout-activity';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { tapLight } from '../../src/ui/haptics';
import { restSecondsFor, restClock, shouldTick, DEFAULT_REST_SEC } from '../../src/lib/restTimer';
// Supersets and set methods. Both are pure and both are read POSITIONALLY here
// — `badges` returns one entry per exercise in the order it was handed them, so
// the labels on screen describe the list on screen rather than the program as
// it was written. That matters on this file's list, which is filtered (removed
// movements) and re-sorted (progress-photo focus areas) before it is rendered.
import { badges as groupBadges, groupRuns } from '../../src/lib/setGroups';
import { badgeFor, countsToVolume, methodFor, restAfter } from '../../src/lib/setMethods';
// The sets of an exercise, one by one — a coach's ramp, a warm-up first set, a
// drop-set last one. Read through `expandSets` rather than off the fields, so a
// program that never got a table still reads as `sets` copies of one spec and
// every screen below behaves as it did. See src/lib/setRows.ts.
import { expandSets, hasSetRows, readRepSpan, setCount } from '../../src/lib/setRows';
// ── the block, the week of it this client is on, and the three fields a set
//    prescribes beyond reps and load ─────────────────────────────────────────
// `weekLabel` is imported under another name because this screen already has a
// `weekLabel` of its own: the CALENDAR week the day strip is scrolled to, which
// is a different week from the week of a training block and must not be
// confused with it on a screen that now shows both.
import { weekLabel as blockWeekLabel } from '../../src/lib/programBlock';
import { clientWeekLine } from '../../src/lib/clientBlock';
import { useClientWeek } from '../../src/ui/clientWeek';
// Effort, share of a max and rep speed. `intensityLine` is the notation beside
// the set; `intensityMeaning` is the same thing in words, which is what a
// client reading "@8" for the first time needs. Neither turns a percentage into
// a weight — see the header of src/lib/setIntensity.ts.
import { intensityLine, intensityMeaning, intensityOf } from '../../src/lib/setIntensity';
import { playSound, primeSounds, releaseSounds } from '../../src/ui/sounds';
import { scheduleRestOverAlert, cancelReminders } from '../../src/ui/pushNotifications';
import { Icon } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, ScreenHeader, KpiRow, Cta, Ghost, Notice, PartialRead, Flag, Field, fig, ListRow, Segmented, TonedChip, Meter, HeroRing, CtaBright, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value, font, grown } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { buildProgram, type ProgramExercise } from '../../src/lib/programs';
import { useClientData } from '../../src/ui/clientData';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useWearables } from '../../src/ui/wearables';
import type { WorkoutEntry } from '../../src/lib/mockData';
import type { WorkoutSample } from '../../src/lib/wearables/types';
import { suggestForExercise, priorBest1RM } from '../../src/lib/progression';
import { announcePersonalBest } from '../../src/lib/prNotifyStore';
import { est1RM } from '../../src/lib/streaks';
import { bodyweightAtKg, bodyweightSetLabel, tonnage, tonnageNote, type BodyweightHistory } from '../../src/lib/bodyweightSets';
// A hold is a set whose first number is seconds. The program builder writes
// '45 sec' planks and '30 sec/side' side planks, so the prescription is read
// here to decide which box this screen opens with — see src/lib/timedSets.ts.
import { isTimedPrescription, prescribedSeconds, readHold, holdLabel, timedSetLabel, setChipLabel, setListLabel } from '../../src/lib/timedSets';
// The set row itself, which used to be a local component and so was reachable
// from this screen and nowhere else. See src/ui/LogSetRow.tsx.
import { LogSetRow, SetKindChip, type LoggedSet } from '../../src/ui/LogSetRow';
// The rest between two sets on the PLAN rows. The runner has counted one down
// since it was written; the three ways to log a set without opening the runner
// had none. Same `restTimer` arithmetic, no second copy of it.
import { RestAfterSet } from '../../src/ui/RestAfterSet';
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
import { setTicks, ticksLine, type TickRecord } from '../../src/lib/setTicks';
import { SetChecklist, SetLadder } from '../../src/ui/SetTable';
// ── one row per set in the sheet that adds or corrects a movement ─────────
//
// The other half of the same report: "when entering amount of sets there
// should be a drop down to record with the weight being used per set". The
// count box opens a row for each set instead of making that many copies of one,
// and every decision about resizing, reading and refusing those rows is in the
// tested module rather than in this file.
import {
  ladderFromPlan, ladderToPlanRows, patchLadderRow, readSetCount, resizeLadder,
  type LadderRow,
} from '../../src/lib/setLadder';
// A member's own changes to the plan, kept — and sent to their coach. Four
// `useState`s held all of this and nothing wrote any of them anywhere; see
// src/lib/planEdits.ts for what that cost, and src/ui/planEdits.tsx for the
// hook that replaced them.
import { planEditsNote } from '../../src/lib/planEdits';
import { usePlanEdits } from '../../src/ui/planEdits';
// Starting today from a session already in the log. The conversion is the whole
// of it and none of it is here — src/lib/repeatSession.ts carries the reasoning
// about what a logged set can and cannot be turned into.
import { loggedSessions, repeatSession, sessionSummary, type PastSession } from '../../src/lib/repeatSession';
import { Confetti } from '../../src/ui/Confetti';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useToast } from '../../src/ui/toast';
// Three outcomes, not two. Since src/ui/workoutLog.tsx was brought onto the
// offline queue a write that nobody answered is KEPT — on this phone, in the
// log, counted, and sent on the next launch that reaches a server — so every
// "it will be gone when you next open the app" on this screen had become false
// in the one direction that makes somebody retype an hour of training.
import { unsentNote, type WriteOutcome } from '../../src/lib/offlineQueue';
import { importSources, withHr, useImportedIds, isLogged, readRecent, readNote } from '../../src/ui/watchImport';
import { parseWorkoutText } from '../../src/lib/workoutParse';
import { useExerciseVideos, type VideoItem, type LibraryStatus } from '../../src/ui/exerciseVideos';
// `isWhole`, not `cd.injuries.length`. An empty injury list that was READ and
// one that could not be read are the same value on clientData, and every guard
// on this screen — the severe auto-swap, the hidden movement, the per-exercise
// caution line — is driven off that value alone. See `injRead` below.
import { isWhole, type LoadStatus } from '../../src/ui/loadStatus';
import { ExerciseVideo } from '../../src/ui/ExerciseVideo';
// The same catalogue lookup and the same renderers the standalone exercise
// screen uses. Imported rather than reimplemented: a second copy of the
// media order is a second chance for the plan screen and the runner to show
// a member two different pictures of the lift they are about to do.
import { useExerciseDetail } from '../../src/ui/exerciseDetail';
import { useExerciseMedia } from '../../src/ui/useExerciseMedia';
import { DemoAnimation, FrameLoop } from '../../src/ui/ExerciseDemo';
import { demoCaption } from '../../src/lib/exerciseMedia';
import { RepdbInlineCredit } from '../../src/ui/Attribution';
// expo-image is required through src/ui/nativeModules.ts, never imported. Its
// entry point resolves to `requireNativeModule('ExpoImage')`, which THROWS on a
// binary that predates the dependency — and expo-image landed on 30 Aug, three
// days after the version last moved to 1.1.0, so every binary built 27-29 Aug
// takes today's bundle and has no ExpoImage in it. A bare import would take
// this whole screen down while it loaded. React Native's own <Image> is the
// fallback and is in every binary ever built.
import { videoForExercise, exerciseSlug, type ExerciseRef } from '../../src/lib/exerciseId';
import { titleCaseName } from '../../src/lib/exerciseName';
// One classifier for "whose clip is this". A null trainer is a platform clip
// AND a handset entry whose upload was refused; only the id prefix tells them
// apart, and src/lib/clipOwner.ts is where that is written down.
import { clipOwner, type ClipOwner } from '../../src/lib/clipOwner';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
// One colour per muscle group, shared with This Week so a chip there and a
// bar here agree. See src/ui/groupTone.ts.
import { groupTone, groupsOf } from '../../src/ui/groupTone';
import { DidYouKnow } from '../../src/ui/DidYouKnow';
import { ScreenHelp } from '../../src/ui/ScreenHelp';
import { injuryFlag, areaLabel, type Injury } from '../../src/lib/injuries';
// "A, B and C". The one comma-and-and in this app, so a list of movements left
// undone reads the way the coverage notes already read.
import { list } from '../../src/lib/noKitProgram';
import { warmupSets, deloadCheck } from '../../src/lib/training';
import { startGate } from '../../src/lib/startGate';
import { hrColor, hrZoneNo, zoneColor, zoneName, ZONE_NOS, zoneOf, zoneKey, emptyZoneSeconds, splatPoints, zoneSecondsTotal, hrScaleNote, zonesFromSamples, hrStats, type ZoneSeconds, type ZoneNo } from '../../src/lib/hr';
import { PROVIDERS } from '../../src/lib/wearables/registry';
import { hrKcal, hrKcalNote, hrKcalUnknown, hrKcalUnknownNote } from '../../src/lib/hrKcal';
import { reportError } from '../../src/lib/reportError';
// 44pt is the minimum tap target — the number and the reasoning live in one
// place, and the controls added here take it from there rather than from a
// literal that can drift.
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { ZoneNow, ZoneBoard } from '../../src/ui/ZoneBoard';
import { SessionMusicBar } from '../../src/ui/SessionMusicBar';
import { SessionHrSheet } from '../../src/ui/SessionHrSheet';
import { ageFromDob } from '../../src/lib/age';
import { RECOVERY_ACTIVITIES } from '../../src/lib/recoveryActs';
import { HIIT_ACTIVITIES, MOBILITY_ACTIVITIES, CARDIO_MOVEMENT_ALIASES } from '../../src/lib/workoutKind';
import { STRETCH_ROUTINES, routineSummary, type StretchRoutine } from '../../src/lib/stretchRoutine';
import { buildRoutine, BUILD_MINUTES, STRETCH_FOCUS } from '../../src/lib/stretchBuilder';
import { useStretchCatalogue } from '../../src/ui/stretchCatalogue';
import { StretchRunner } from '../../src/ui/StretchRunner';
import { reviewFor, queryFor } from '../../src/lib/coachLogReview';
import { canPairHere, pairInvite, pairInviteAction } from '../../src/lib/sessionPairing';
import { PairMonitorSheet, usePairRows } from '../../src/ui/PairMonitorSheet';
import { useCoachLogQueries, useLoggingCoach } from '../../src/ui/coachLogQueries';
import { CoachLogReviewStrip } from '../../src/ui/CoachLogReview';
import { dayKeyOf, instantForDay, readWorkoutEdit, type WorkoutDraftSet } from '../../src/lib/entryEdit';
import { useSettings } from '../../src/ui/settings';
import { WeightUnitToggle } from '../../src/ui/WeightUnitToggle';
import { liftIn, liftLabel, readLift, plain, plainExact, volumeHeadline, convertedNote, readNumber, type WeightUnit } from '../../src/lib/units';
// The plate maths, at the bar rather than two screens away on Tools. Pure and
// already tested (src/lib/plateMath.test.ts); this screen only calls it.
import { BARS, loadBar } from '../../src/lib/plateMath';
// The distance unit a cardio log opens on. Derived from the member's length
// unit rather than defaulted to km — see src/lib/distance.ts.
import { distanceUnitFor, distanceUnitName, type DistanceUnit } from '../../src/lib/distance';
// The cardio machines by their own names, matched exactly — see the note on
// CARDIO_MOVEMENTS below for why this asks no matcher at all.
import { MACHINES } from '../../src/lib/machines';
import { WEEK_DAYS, startOfWeek, weekIndexOf } from '../../src/lib/weekStart';
import { BACK_ICON, FORWARD_ARROW, FORWARD_ICON, turn } from '../../src/ui/direction';
import { useMovementName } from '../../src/ui/catalogueTranslations';
import { useReachability } from '../../src/ui/reachability';
import { retryLine } from '../../src/lib/reachability';

/** The day strip and the month sheet's column heads, in the order
 *  src/lib/weekStart.ts draws a week. Both are on this screen, and before this
 *  they were the same array by luck rather than by construction. */
const WEEK = WEEK_DAYS;

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
interface Activity { name: string; met: number | null }

const CARDIO_ACTS: Activity[] = [
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
const HIIT_ACTS: Activity[] = HIIT_ACTIVITIES;

// Recovery is time spent deliberately not training. Duration and heart rate are
// real measurements and are kept; calories are not derivable and are not shown.
// The names live in src/lib/recoveryActs.ts so the Recovery screen and this one
// cannot drift — a modality added there appears in both places.
const RECOVERY_ACTS: Activity[] = RECOVERY_ACTIVITIES.map((name) => ({ name, met: null }));

const MOBILITY_ACTS: Activity[] = MOBILITY_ACTIVITIES;

// Sorted here as well as written in order, so a later addition dropped in the
// wrong place still renders alphabetically.
const byName = (a: Activity, b: Activity) => a.name.localeCompare(b.name);
const names = (acts: Activity[]) => [...acts].sort(byName).map((a) => a.name);

const CARDIO = names(CARDIO_ACTS);

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
const CARDIO_MOVEMENTS: ReadonlySet<string> = new Set(
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
const isCardioMovement = (name: string) => CARDIO_MOVEMENTS.has((name ?? '').trim().toLowerCase());
const SESSION_TYPES: Record<'cardio' | 'hiit' | 'mobility' | 'recovery', string[]> = {
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
const WTYPES = [['strength', 'Program'], ['cardio', 'Cardio'], ['hiit', 'HIIT'], ['mobility', 'Mobility'], ['recovery', 'Recovery'], ['stretch', 'Stretch']] as const;

/** What this screen is currently offering to do. Two of the six are not a
 *  clock over an activity: 'strength' is today's program, and 'stretch' is a
 *  library of guided routines. */
type TrainMode = 'strength' | 'cardio' | 'hiit' | 'mobility' | 'recovery' | 'stretch';

/** The four session types that are an activity and a clock rather than a list
 *  of lifts. Named because both the log form and the live runner below branch
 *  on it, and recovery has to stay distinguishable from the other three. */
type SessionKind = 'cardio' | 'hiit' | 'mobility' | 'recovery';

/** True for a mode that IS a clock over an activity — the four above, and not
 *  the program or the stretch library. One predicate rather than
 *  `m !== 'strength'` repeated, which is what silently started indexing
 *  SESSION_TYPES with 'stretch' the moment a sixth mode existed. */
const isSessionKind = (m: TrainMode): m is SessionKind => m !== 'strength' && m !== 'stretch';
const KIND_LABEL: Record<SessionKind, string> = { cardio: 'Cardio', hiit: 'HIIT', mobility: 'Mobility', recovery: 'Recovery' };

// Approx METs per activity — kcal = MET x weight(kg) x hours (standard estimate).
const MET: Record<string, number> = Object.fromEntries(
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
const cardioKcal = (type: string, mins: number, weightKg?: number | null): number | null => {
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
const onNight = (t: Theme): Theme => ({
  ...t, bg: t.night, surface: t.night2, surface2: t.night2, surface3: t.night2, ring: t.nightInk2,
  ink: t.nightInk, ink2: t.nightInk2, ink3: t.nightInk2,
  brand: t.brandBright, brandInk: t.brandDeep, brandText: t.nightInk3,
});

function MetricCols({ t, items }: { t: Theme; items: { label: string; value: string; dot?: string }[] }) {
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

export default function Train() {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const pageScroll = useRef<ScrollView>(null);
  const router = useRouter();
  const cd = useClientData();
  const assigned = useAssignedPrograms();
  const { getProgram, status: programStatus, cachedNote } = assigned;
  const _cp = getProgram(cd.id);
  const coachProgram = cd.coachingMode === 'solo' ? null : _cp;
  const w = useWearables();
  const { log: loggedWorkouts, status: workoutLogStatus, unsent: unsentWorkouts, logWorkouts, flushWorkouts, updateWorkout, removeWorkout, reload: reloadLog } = useWorkoutLog();
  const toast = useToast();
  // An entry whose delete is staged: off this screen and out of every figure
  // computed from the log, and not yet written. `id` is absent until the row
  // has come back from the server, so the key falls back to the pair that
  // identifies an unsaved entry — the same pair `removeWorkout` matches on.
  const [pendingRemoval, setPendingRemoval] = useState<string[]>([]);
  const entryKey = (l: WorkoutEntry): string => l.id ?? `${l.t}|${l.exercise}`;
  // Filtered ONCE, here, rather than at each of the twenty places that read
  // the log. A staged removal has to come out of the day's volume, the
  // calories, the deload check and the next set's suggestion as well as out of
  // the row — an entry that is off the list and still inside the numbers is
  // the same inconsistency the delete was meant to remove.
  const workoutLog = useMemo(
    () => (pendingRemoval.length ? loggedWorkouts.filter((l) => !pendingRemoval.includes(entryKey(l))) : loggedWorkouts),
    [loggedWorkouts, pendingRemoval],
  );
  useEffect(() => {
    setPendingRemoval((ids) => {
      const live = ids.filter((id) => loggedWorkouts.some((l) => entryKey(l) === id));
      return live.length === ids.length ? ids : live;
    });
  }, [loggedWorkouts]);
  // The unit the member reads a LOAD in. Deliberately left out of TF-37 —
  // barbell plates are metric hardware and tools.tsx does its plate maths
  // against a metric rack — and asked for since: "Need to be able to select kg
  // or pounds". Nothing below is stored in it. Every load reaching the log is
  // kilograms; this converts at the two edges, what is printed and what is
  // typed, through src/lib/units.ts.
  const { weightUnit: wu, lengthUnit: lu } = useSettings();
  const loadNote = convertedNote(wu);
  // What a cardio log OPENS on. It opened on kilometres for everybody, and the
  // toggle beside the box was the whole of the answer — so a member in Dallas
  // switched it on every single entry, and one who did not notice it filed
  // their five miles as five kilometres. The unit travels into the log with the
  // number (`WorkoutEntry.cardio.unit`), so that entry then says 5 km for ever.
  // The toggle stays: this changes which way round it starts.
  const defaultDistUnit = distanceUnitFor(lu);
  // A null from `getProgram` only means "your coach has not assigned you one"
  // once the read has finished and succeeded. Under 'loading' we have not
  // finished asking, under 'error' we asked and could not find out, and under
  // 'partial' the page came back at the row cap so their assignment may have
  // been on the part we never saw. In all three the `??` below hands the member
  // a GENERATED session, drawn under the generic program title at the header
  // — indistinguishable from a member who has no coach plan at all. This is the
  // same defect app/(client)/week.tsx names, and the reason
  // src/ui/assignedPrograms.tsx was given a `status` at all.
  //
  // 'solo' is excluded because there is no coach to have written one: the null
  // is deliberate there and saying otherwise would be the opposite lie.
  //
  // AND IT STAYS GATED ON `coachProgram == null`, deliberately. Serving the
  // device's copy makes `coachProgram` non-null and so takes this notice away —
  // which reads like the defect, but un-gating it would print a sentence that
  // is false: it says today's session "is Repple's automatic program, not one
  // your coach wrote", and a cached block IS one their coach wrote. Telling a
  // member training a real block that they are on the generic one would push
  // them to disregard the right session. What the cached case needs is not this
  // notice but its own, and `cachedNote` above is it — same read, honest about
  // which of the two situations the member is actually in. app/(client)/week.tsx
  // faces the identical gate and resolved it the same way.
  const programUnknown = coachProgram == null && cd.coachingMode !== 'solo' && programStatus !== 'ready';
  const program = coachProgram ?? buildProgram(cd.goal, cd.bodyFatPct);
  /**
   * WHICH WEEK OF THE BLOCK THEY ARE ON.
   *
   * This screen rendered `program.days` — week one — so a client on a twelve
   * week block trained week one twelve times and the other eleven weeks their
   * coach wrote existed only on the coach's phone. `useClientWeek` resolves the
   * block against the start date the coach set, and none of its answers is an
   * empty screen: a block dated to start next Monday is week one today, and a
   * block whose last week has passed stays on its last week. See the header of
   * src/lib/clientBlock.ts.
   */
  const blk = useClientWeek(program, cd.id);
  /**
   * The week whose days are on screen, when the client has tapped along the
   * block to read ahead. Null is "the one that is mine", which is what it goes
   * back to.
   *
   * Reading ahead is allowed on purpose. A start date now decides which week is
   * shown, and the only thing that stops that reading as a gate is that
   * everything is still reachable: a client can see week eight in week one, and
   * the line under the strip says which week is theirs so that looking ahead is
   * never mistaken for having been moved on.
   */
  const [weekPick, setWeekPick] = useState<number | null>(null);
  const viewWeek = weekPick != null && weekPick >= 0 && weekPick < blk.weeks.length ? weekPick : blk.week.index;
  const weekOnScreen = blk.weeks[viewWeek] ?? null;
  const blockLine = clientWeekLine(blk.week, viewWeek);
  // ── The clock this screen judges "today" by ──────────────────────────────
  //
  // This was `weekIndexOf(new Date())`, and `today0` five hundred lines down
  // was a second, separate `new Date()`. Neither is frozen at mount, so
  // check:frozen-day cannot see them and they are not the `useMemo(…, [])`
  // defect — they are the other half of the same problem, which src/ui/today.ts
  // states outright: "A bare `todayKey()` in the render body is correct and
  // does not re-render: it is only right at the moment something else happens
  // to redraw."
  //
  // This is the screen somebody has open while they train, and evening sessions
  // run past midnight. At 00:00 nothing here redraws, so the day strip keeps its
  // dot on yesterday and the section header keeps saying "Today ·" over it
  // (lines ~1401 and ~1520 read `todayIdx` for exactly that). Then some
  // unrelated render — a set typed, the log provider landing — recomputes both
  // and the day silently moves, at whatever arbitrary moment that happens to be.
  // Wrong-then-suddenly-right is worse than either, because the member cannot
  // see the moment it changed.
  //
  // `useNow()` settles it on the two moments that can matter — local midnight,
  // and the app coming back to the foreground — so the change happens when the
  // day changes. ONE `now` for both readings, because two calls to `new Date()`
  // in one render can straddle midnight and disagree with each other about
  // which week the strip is on.
  //
  // What this deliberately does NOT move: `dayIdx` is the member's own
  // selection and is seeded once, and `dateFor(i)` counts from `startOfWeek`,
  // which does not change when the date rolls WITHIN a week. So on six
  // midnights in seven the only thing that moves is the word "Today", onto the
  // day that is now today. On the seventh the strip advances a week, which is
  // what it should do, at midnight rather than at a random redraw.
  const now = useNow();
  const todayIdx = weekIndexOf(now);
  const [dayIdx, setDayIdx] = useState(todayIdx);
  // Which week the strip is on, counted back from this one. 0 is this week; -1
  // is last week.
  //
  // There was no such state. `week0` was derived from today and nothing else,
  // so the seven days on screen were always the seven days of the current week
  // and the Month Calendar sheet inherited the same fixed month. A member who
  // missed Saturday and remembered on Monday had nowhere to put it: the day was
  // not on the strip, not reachable from the sheet, and there is no other way
  // into the log on this screen. "Catching up" is the ordinary case for a
  // training diary, not an edge one.
  //
  // Never positive. Selecting a later day INSIDE this week is already possible
  // and always was — the plan for Saturday is a thing to look at on Tuesday —
  // but a whole week ahead is a week nobody has trained, and every empty state
  // in that week would be a confident statement about a session that has not
  // happened yet.
  const [weekOffset, setWeekOffset] = useState(0);
  // `?mode=recovery` lets the Recovery screen send somebody straight to the
  // right type, so logging a sauna is one tap from the screen that shows it.
  // Anything unrecognised falls back to the program, which is the default.
  const { mode: modeParam, start: startParam } = useLocalSearchParams<{ mode?: string; start?: string }>();
  const startMode: TrainMode = (['strength', 'cardio', 'hiit', 'mobility', 'recovery', 'stretch'] as const)
    .find((m) => m === modeParam) ?? 'strength';
  const [mode, setMode] = useState<TrainMode>(startMode);

  /**
   * Arriving here because somebody pressed "Start Workout" somewhere else.
   *
   * ── The report ────────────────────────────────────────────────────────────
   *
   * "When I press start workout - nothing is coming out! It's stuck on the same
   * screen." Home was showing "Ready to Train · Full Body A" with a live Start
   * Workout, and pressing it appeared to do nothing at all.
   *
   * It was doing something. Train is a TAB, and a tab screen stays MOUNTED once
   * it has been visited — so `router.push('/(client)/workouts')` switches to a
   * screen that is still in whatever state it was last left in. `mode` and
   * `dayIdx` are both plain `useState` seeded once at mount, so a member who had
   * earlier tapped Cardio, or read ahead to Thursday, came back to exactly that:
   * the Cardio log, or a rest day. Neither has a Start button on it.
   *
   * And there is nothing on screen to explain the absence. `startGate` returns
   * `note: null` for 'not-strength' on purpose — "a member reading the Cardio
   * tab is not missing a strength button", which is right for somebody who
   * chose that tab — so the control is simply not there, with no sentence and
   * no error. That is the whole of "nothing is coming out": the app changed
   * tabs, the tab looked untouched, and every trace of the intent was lost on
   * the way. Nothing throws, so app_errors has nothing to show either, which is
   * why this could not be found by looking for a crash.
   *
   * ── The fix ───────────────────────────────────────────────────────────────
   *
   * The intent travels WITH the navigation. `?start=` carries a fresh value on
   * every press — a nonce, not a flag, so pressing it twice in a row is two
   * arrivals and not one — and landing with it resets the three pieces of state
   * that decide whether there is a session in front of the member: the log they
   * are looking at, the week, and the day.
   *
   * `startMode` still wins over 'strength' when the caller named a mode, because
   * `?mode=recovery` from the Recovery screen is an intent too and a more
   * specific one. The reset is to what was ASKED FOR, not unconditionally to the
   * program.
   *
   * Deliberately not a `useFocusEffect`: this must fire on arrival-with-intent
   * and NOT every time the tab is focused, or a member who taps Cardio, wanders
   * to Home and taps Train would be bounced back to the program by an app
   * overruling a choice they just made.
   */
  /* One arrival per nonce, and this ref is what makes that true.
   *
   * The effect below depends on `startMode`, which is DERIVED from `modeParam`
   * — and the effect fifteen lines further down clears `modeParam` the moment
   * it has applied it (`router.setParams({ mode: undefined })`), on purpose, so
   * a second tap on the same link is a change again. The two together undid the
   * more specific of the two intents: arriving at `?start=abc&mode=recovery`
   * set the mode to recovery, the mode effect then cleared the param, which
   * recomputed `startMode` from 'recovery' to 'strength', which re-ran THIS
   * effect on the same unchanged nonce and set the mode back to the program.
   * A member sent to log a sauna landed on their strength plan — the reported
   * bug this whole path exists to fix, arriving from the other direction.
   *
   * `trainIntent(route, mode)` is a documented two-argument API with a test
   * asserting `?mode=recovery` rides along (src/lib/trainIntent.test.ts), so
   * this is the receiving half not honouring a contract the sending half keeps.
   *
   * The nonce already means "this press differs from the last one", so making
   * the effect fire once per DISTINCT nonce is the guard the design was asking
   * for: a fresh press is a fresh token and still lands, and a re-render caused
   * by clearing another param is not a second arrival.
   */
  const startSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!startParam) return;
    if (startSeen.current === startParam) return;
    startSeen.current = startParam;
    setMode(startMode);
    setWeekOffset(0);
    setDayIdx(weekIndexOf(new Date()));
  }, [startParam, startMode]);
  // Swaps, edits, removals and added movements, all four persisted. They were
  // plain `useState` — a swap made on Tuesday was gone on Wednesday and the
  // coach never heard about any of it.
  const planEdits = usePlanEdits(cd.id);
  const { swaps, setSwaps, exEdits, setExEdits, removedEx, setRemovedEx, customEx, setCustomEx } = planEdits;
  // `kg` is KILOGRAMS, whatever unit the member typed it in. The conversion
  // happens once, in `LogRow` at the keyboard, rather than being deferred to
  // the save — so a draft written in pounds and reopened after the setting is
  // changed still means the weight that was actually lifted, and `quickLog`
  // (whose suggestion is already metric) can hand a number straight in without
  // being converted a second time.
  // `bw` is the member saying this set was their own body — see
  // src/lib/bodyweightSets.ts. Optional on the draft shape rather than
  // required, because a draft written by a build that predates it is read back
  // out of AsyncStorage as-is and an absent flag has to mean what it meant
  // then: an ordinary set.
  // `timed` is the member saying this set was HELD, in which case `reps` holds
  // SECONDS — see src/lib/timedSets.ts. Optional for the same reason `bw` is: a
  // draft written by a build that predates it reads back out of AsyncStorage
  // as-is, and an absent flag has to mean what it meant then.
  const [logged, setLogged] = useState<Record<string, { reps: string; kg: string; bw?: boolean; timed?: boolean }[]>>({});

  const [nlw, setNlw] = useState('');
  const logWorkoutNL = async () => {
    // The member's unit, so a bare "135" means what it says on their plates.
    // Without it every unsuffixed number was read as kilograms, and a pounds
    // member logging "bench 3x8 @135" stored 297lb.
    const lifts = parseWorkoutText(nlw, wu);
    // The example is written in the member's own unit.
    if (!lifts.length) { Alert.alert('Could Not Read That', wu === 'lb' ? 'Try e.g. "bench 3x8 135lb, squat 225lb 5 5 5".' : 'Try e.g. "bench 3x8 60kg, squat 100kg 5 5 5".'); return; }
    const nowISO = new Date().toISOString();
    // No kcal — see `buildEntries` in the session runner. The figure this
    // used to carry was `volume / 60 + sets * 8`, which knows nothing about
    // the person doing the lifting.
    // Title Case on the way in, for the reason `commitCx` gives: the parser
    // hands back whatever was typed, and "calf raise" written into `workouts`
    // reads as a second movement beside the catalogue's "Calf Raise" on every
    // screen that lists them. The slug is untouched, so nothing joins
    // differently.
    const out = await logWorkouts(lifts.map((l) => ({ t: nowISO, exercise: titleCaseName(l.exercise), sets: l.sets })));
    // The box is emptied for the two outcomes that KEPT what was typed, and not
    // for the one that threw it away. A refused write leaves the text where it
    // is, which is the only copy of it that exists — the same reasoning
    // my-training.tsx gives for not clearing its boxes.
    if (out !== 'refused') setNlw('');
    // "Logged" was said before anybody had asked the server. This is the
    // sentence that stops a write nobody answered being the same event as a
    // successful one — in both directions, since it is also no longer the same
    // event as a lost one.
    if (out === 'stored') toast.say(`${lifts.length} exercise${lifts.length === 1 ? '' : 's'} added to today.`);
    else if (out === 'unsent') Alert.alert('Saved on This Phone', `No connection, so ${lifts.length === 1 ? 'it has' : 'they have'} not reached your training log yet — nothing is lost. ${lifts.length === 1 ? 'The exercise is' : `All ${lifts.length} exercises are`} saved here and ${lifts.length === 1 ? 'goes' : 'go'} up on their own the next time you have signal.`);
    else Alert.alert('Not Saved', 'Your training log rejected what you typed, so it has not been recorded and it is not waiting to send. What you typed is still in the box — sending it again as it is will be rejected again.');
  };
  const [swapFor, setSwapFor] = useState<ProgramExercise | null>(null);
  const [injRevealed, setInjRevealed] = useState<string[]>([]);
  const [deloadDismiss, setDeloadDismiss] = useState(false);
  const { videos: exVideos, status: exVideoStatus, reload: reloadVideos } = useExerciseVideos();
  // The notice at the top of this screen ends "open this screen again when you
  // have signal" — the plan below it is the automatic program wearing the
  // coach's layout whenever the assignment read failed, and until now leaving
  // and returning really was the only way to try again. Four reads: the
  // assigned plan, the training log the day strip is ticked from, the coach's
  // clips, and the profile the fallback program is built from.
  const pull = usePullToRefresh(useCallback(() => {
    assigned.reload(); reloadLog(); void reloadVideos(); cd.reload();
  }, [assigned, reloadLog, reloadVideos, cd.reload]));
  // Resting burn per minute, for correcting a whole-day energy counter down to
  // just the session. Null without a weight and body fat — there is no resting
  // rate to compute, and a guessed one would be subtracted from a real figure.
  const restingKcalPerMin = (cd.weightKg != null && cd.bodyFatPct != null)
    ? maintenanceFor({ weightKg: cd.weightKg, bodyFatPct: cd.bodyFatPct, activity: cd.activity }).bmr / 1440
    : null;
  // Who coaches this member. The library read is filtered by policy, not by
  // trainer, so it can hand back both a platform clip and this member's own
  // coach demonstrating the same lift — and being shown a stranger when your
  // coach filmed it for you is the wrong one of the two. Same lookup messaging.ts
  // does for the chat thread; null is fine, it just means no tie-break.
  const [coachId, setCoachId] = useState<string | null>(null);
  useEffect(() => {
    if (!USE_SUPABASE || !cd.id || cd.id === 'unknown') return;
    let live = true;
    (async () => {
      try {
        // no-error-ok: a tie-break only; the note above says null is the same as having no coach
        const { data } = await supabase.from('clients').select('trainer_id').eq('id', cd.id).single();
        if (live) setCoachId((data as any)?.trainer_id ?? null);
      } catch { /* no tie-break, which is the same as having no coach */ }
    })();
    return () => { live = false; };
  }, [cd.id]);

  /* ── who wrote the sessions in this log that this member did not ──────────
   *
   * A coach can log a session into the member's own `workouts` rows. Until now
   * the day sheet below rendered `attributionLine(l, null, true)` — the middle
   * argument is the coach's NAME, hard-coded `null`, under a comment saying the
   * client app has no coach-name lookup. It has one: `my_coach()`
   * (supabase/parts/115) returns the linked coach's id AND name to their own
   * client, and src/ui/messaging.ts has called it for the chat header since.
   *
   * Deliberately NOT the `coachId` above. That one is `clients.trainer_id`, one
   * half of the link, kept as a video tie-break where being wrong costs a
   * thumbnail. This name goes under a record made ABOUT somebody, so it uses
   * the function that demands BOTH halves of the coach↔client link and returns
   * the name in the same row — no second read to get out of step with the id.
   *
   * Null covers every way of not knowing, and `coachNameFor` turns all of them
   * back into the generic caption. src/lib/threadPeer.ts is the file that
   * argues why that is the only safe direction: a header that fell back to
   * whichever name WAS readable showed a client their own name under the words
   * "Your coach".
   *
   * The lookup itself moved to `useLoggingCoach` in src/ui/coachLogQueries.ts
   * when app/(client)/activity.tsx came to need the same name for the same
   * reason. It is the same call, the same nulls and the same comments; what
   * changed is that there is now one of it.
   */
  const loggingCoach = useLoggingCoach(cd.id && cd.id !== 'unknown' ? cd.id : null);

  /* Where each coach-logged row stands with the member: queried, or not, or not
   * known. Its own read rather than a field on `WorkoutEntry` — see the header
   * of src/ui/coachLogQueries.ts — and its `status` is what stops this screen
   * saying "you have not queried this" off a read that never came back. */
  const coachLogQueries = useCoachLogQueries(cd.id && cd.id !== 'unknown' ? cd.id : null);

  const [session, setSession] = useState(false);
  // What the runner should resume at, when there is a session to resume.
  // Null for a session started just now.
  const [resumeAt, setResumeAt] = useState<{ startedAt: number; pausedMs: number } | null>(null);
  // The started cardio / HIIT / mobility / recovery session, or null when none
  // is running. The kind is captured here rather than read from `mode` while the
  // modal is open, so a session that began as Recovery is still saved as
  // recovery even if the chips underneath are touched behind it.
  const [timed, setTimed] = useState<{ kind: SessionKind; activity: string } | null>(null);

  /* ── repeating a session already in the log ───────────────────────────────
   *
   * Two pieces of state and deliberately no third. `repeatPick` is the picker
   * being open; `repeatRun` is the session being repeated, which the runner is
   * handed INSTEAD of today's plan for exactly as long as it is on screen.
   *
   * ── What this does NOT write, and why that is the whole decision ─────────
   *
   * Nothing. Not a swap, not an exercise edit, not a removal, and above all not
   * `customEx`. Every one of those goes through `usePlanEdits`, and a plan edit
   * in this app means one specific thing: THE MEMBER HAS CHANGED THEIR
   * PROGRAM. It is written to the phone, upserted to `client_plan_edits`, and
   * drawn on the coach's console as the member rewriting what they were given.
   *
   * Repeating last Thursday is not that. It is one session's choice, today, and
   * recording it as a program change would tell a coach something untrue —
   * permanently, because nothing in this app ever expires a plan edit.
   *
   * `customEx` in particular would be worse than untrue. It is NOT day-scoped:
   * `planRows` and `runnableEx` append it to every day, so a repeat written
   * there would put last Thursday's six movements onto Monday, Tuesday, the
   * rest day and week six as well, for ever, with a Remove per row as the only
   * way back out.
   *
   * ── And when the coach has edited the day since ──────────────────────────
   *
   * Then the coach's day stands, untouched and unlogged. The repeat runs beside
   * it rather than over it: today's plan is still on the sheet, its ring still
   * reads 0 of 5, and the sets the member logs from the repeat land in the log
   * under the movements they actually did. A correction is a second recorded
   * fact and never an erasure, and there is no reading of "I want to do
   * Thursday again" that means "delete what my coach wrote".
   *
   * The confirm on the picker says so in as many words, because the one thing
   * that must not happen is a member repeating a session in the belief they
   * have done today's program. Whether repeating should also be able to
   * DISCHARGE today's plan — mark it done, or swap it out for the week — is a
   * product decision and not a default anyone should pick in a lane: it changes
   * what adherence means, and adherence is what the coach is paid on. This
   * implements the half that cannot be wrong.
   */
  const [repeatPick, setRepeatPick] = useState(false);
  const [repeatRun, setRepeatRun] = useState<{ from: string; exercises: ProgramExercise[] } | null>(null);

  /* ── the workout that was still running when the app went away ────────────
   *
   * "If you close the tab or if you lock the phone, that workout that's being
   * timed disappears."
   *
   * The clock was never the problem — `useLiveVitals` reads elapsed off the
   * wall clock precisely so a locked phone cannot under-report a duration
   * that reaches somebody's health record. What was lost is that a session
   * was HAPPENING: `session` and `timed` are useState in this screen and
   * nothing outside the tree remembered them.
   *
   * Written on start and cleared on finish, so the record exists exactly as
   * long as the session does. src/lib/liveSession.ts holds the rules,
   * including the refusal that matters: a record older than six hours is
   * dropped rather than re-opened, because a session nobody has touched since
   * this morning coming back as a nine-hour workout would put a figure in a
   * health record that describes an afternoon at a desk.
   */
  /*
   * ── and WHOSE session it is ──────────────────────────────────────────────
   *
   * The key was `repple.liveSession.v1`, flat, with no account in it, so the
   * record was the HANDSET's rather than the member's. On a gym desk phone
   * that means member B mounts this screen and is handed member A's session in
   * flight — and the cost is not a wrong screen, it is a wrong WRITE: the
   * finish goes through `logWorkouts`, which stamps the row with the uid it
   * resolves at save time (src/ui/workoutLog.tsx · `uidRef.current`), so A's
   * hour is inserted as B's training history with no error anywhere.
   *
   * `liveSessionKey` puts the account in the key. A null key means there is no
   * account to keep it under — signed out, or a session still restoring — and
   * a null means DO NOTHING: no read, no write, and above all no delete, which
   * would cost the member whose auth read has simply not landed yet the
   * workout they are in the middle of. See src/lib/sessionScope.ts.
   */
  const liveKey = liveSessionKey(cd.id);
  const rememberSession = useCallback((rec: LiveSession | null) => {
    if (!liveKey) return;
    if (!rec) { AsyncStorage.removeItem(liveKey).catch(() => {}); return; }
    AsyncStorage.setItem(liveKey, JSON.stringify(rec)).catch(() => {});
  }, [liveKey]);

  // The key this screen last worked against, so an account CHANGE can be told
  // from an account arriving. `undefined` is "no run yet".
  const lastLiveKey = useRef<string | null | undefined>(undefined);
  // Restored on mount, and again if the account changes. A failure to read is a
  // session that does not come back, which is the same as today and is not
  // worth an error in front of somebody about to train — and it is explicitly
  // not a reason to remove the record, which is what `liveSessionResume`
  // returning 'none' rather than 'forget' says.
  useEffect(() => {
    const prev = lastLiveKey.current;
    lastLiveKey.current = liveKey;
    // ── the state in this component, not only the bytes on the disk ────────
    //
    // app/(client)/_layout.tsx redirects out of this whole group the moment
    // `authed` goes false, so signing out unmounts the Tabs and everything in
    // them — this screen's `session` and `timed` included. That is the primary
    // teardown and it was already correct. This covers the narrower case it
    // does not: the signed-in account CHANGING under a mounted tree. A runner
    // left open across that would be finished under the new member's id, which
    // is the same wrong write by a shorter route.
    if (prev !== undefined && prev !== null && prev !== liveKey) {
      setSession(false);
      setTimed(null);
      setResumeAt(null);
      void endLiveActivity();
    }
    if (!liveKey) return;
    let gone = false;
    (async () => {
      let read: 'ok' | 'failed' = 'ok';
      let raw: string | null = null;
      try { raw = await AsyncStorage.getItem(liveKey); } catch { read = 'failed'; }
      if (gone) return;
      const d = liveSessionResume({ uid: cd.id, read, raw, now: Date.now() });
      if (d.act === 'forget') { AsyncStorage.removeItem(liveKey).catch(() => {}); return; }
      if (d.act !== 'resume') return;
      const rec = d.session;
      setResumeAt({ startedAt: rec.startedAt, pausedMs: rec.pausedMs ?? 0 });
      // The Activity does not survive the app being killed, so a restored
      // session puts it back — at the moment it actually started, not now.
      void startLiveActivity(rec.activity ?? 'Workout', rec.startedAt, rec.pausedMs ?? 0);
      if (rec.kind === 'timed' && rec.activity) {
        setTimed({ kind: (rec.sessionKind as SessionKind) ?? 'cardio', activity: rec.activity });
      } else if (rec.kind === 'guided') {
        setSession(true);
      }
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  /*
   * ── the keys these replace, removed unread ───────────────────────────────
   *
   * `repple.liveSession.v1`, `repple.guidedSession` and every
   * `repple.workoutDraft.<date>` on this device. Deleted rather than migrated,
   * and that is the decision rather than a shortcut: the blob carries no
   * account, so reading it into whoever is signed in now is a GUESS, and the
   * wrong answer files a stranger's lifts under this member's name in a health
   * record their coach then programs from. The right answer saves somebody
   * re-typing sets that had not reached the server anyway. See the header of
   * src/lib/sessionScope.ts.
   *
   * Once, on mount, and deliberately not gated on an account: these bytes
   * belong to nobody the app can name, so there is nothing to wait for.
   */
  useEffect(() => {
    AsyncStorage.multiRemove([...LEGACY_SESSION_KEYS]).catch(() => {});
    (async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const stale = keys.filter(isLegacyWorkoutDraftKey);
        if (stale.length) await AsyncStorage.multiRemove(stale);
      } catch { /* they are unreadable to every account either way */ }
    })();
  }, []);
  // The routine being followed, or null. Held here rather than inside the
  // runner so the modal is MOUNTED only while one is running — the same reason
  // the timed runner is, and for the same effect: a routine reopened starts at
  // its first position with a full clock instead of carrying the last one's.
  const [stretchOn, setStretchOn] = useState<StretchRoutine | null>(null);
  // What the member has told the builder: how long they have, which part of
  // themselves, and which of the several routines that could produce.
  //
  // The seed is reset by both other setters on purpose. Changing the duration
  // or the area is a NEW question and should be answered with that question's
  // first, canonical routine — carrying rotation four across to it would mean
  // the ten-minute leg routine somebody saw last week is not the one they get
  // this week, for no reason they could see. Rotating is something "Build
  // Another" does, deliberately, and nothing else touches it.
  const [buildMins, setBuildMins] = useState(BUILD_MINUTES[1]);
  const [buildFocus, setBuildFocus] = useState(STRETCH_FOCUS[0].id);
  const [buildSeed, setBuildSeed] = useState(0);
  // The stretches to build FROM, read from the catalogue rather than held as a
  // constant — see the header of src/lib/stretchBuilder.ts, where the decision
  // was reversed when `body_part` and `is_unilateral` arrived on the table.
  const stretchCat = useStretchCatalogue();
  // Built on every change of the three, and on the rows arriving. Not on a
  // button: once the rows are here this is arithmetic over fifty-odd of them
  // and costs less than the tap that would have asked for it, and a "Build"
  // button would only be a chance to leave a stale routine on screen under
  // changed chips.
  //
  // Gated on `isWhole`, not on `!== 'error'`. Under 'loading' the list is empty
  // because nothing has arrived, and handing that to the builder would produce
  // "We have no stretches to build a routine from." — a statement about our
  // catalogue, made while the read is still in flight. Under 'partial' the rows
  // are a prefix, and a routine assembled from a prefix looks exactly like one
  // assembled from the whole catalogue.
  const built = useMemo(
    () => (isWhole(stretchCat.status)
      ? buildRoutine({ minutes: buildMins, focus: buildFocus, seed: buildSeed, catalogue: stretchCat.candidates })
      : null),
    [buildMins, buildFocus, buildSeed, stretchCat.status, stretchCat.candidates],
  );

  // While a session modal is open, poll local HR sources every 5s instead
  // of every 60s so the live heart rate actually tracks what you're doing. Cloud
  // vendors stay on the slow cadence — they only return day aggregates and have
  // rate limits. Always turned back off on unmount so a backgrounded app doesn't
  // keep fast-polling.
  //
  // Either runner counts: a timed rowing session shows the same live zones as
  // the guided one, so it needs the same fast cadence feeding it.
  const setLiveMode = w.setLiveMode;
  const liveRunning = session || timed != null;
  useEffect(() => {
    setLiveMode(liveRunning);
    return () => setLiveMode(false);
  }, [liveRunning, setLiveMode]);
  const [ctype, setCtype] = useState(CARDIO[0]); const [mins, setMins] = useState('');

  // Read the param on EVERY arrival, not only the first.
  //
  // `workouts` is a TAB. Once mounted it stays mounted, so the `useState`
  // initialiser above runs once in the life of the app and never again — a
  // second visit carries a new `?mode=` that nothing looks at. Tapping "Log a
  // recovery session" on the Recovery screen therefore dropped you on the Train
  // tab showing your strength program, with no way to tell why, which is
  // exactly what it was reported doing.
  //
  // The param is cleared once applied. Leaving it set would mean a later tap on
  // the same link is not a CHANGE, so the effect would not fire and the second
  // attempt would fail where the first worked — and it would also fight a
  // manual chip choice every time the tab regained focus.
  useEffect(() => {
    const m = (['strength', 'cardio', 'hiit', 'mobility', 'recovery', 'stretch'] as const).find((x) => x === modeParam);
    if (!m) return;
    setMode(m);
    if (isSessionKind(m)) setCtype(SESSION_TYPES[m][0]);
    router.setParams({ mode: undefined });
  }, [modeParam]);
 const [dist, setDist] = useState(''); const [unit, setUnit] = useState<DistanceUnit>(defaultDistUnit);
 // The member's unit can settle AFTER this screen mounts — `useSettings` reads
 // the account's preference asynchronously and `unitsLoaded` is what says so —
 // and a box that opened on the device's guess must move to their real answer
 // when it lands. Only while the box is untouched: once somebody has switched
 // it for this entry, their choice is the one that counts.
 const touchedUnit = useRef(false);
 useEffect(() => { if (!touchedUnit.current) setUnit(defaultDistUnit); }, [defaultDistUnit]);
  const [watts, setWatts] = useState(''); const [kcalIn, setKcalIn] = useState('');
  const [hrEntry, setHrEntry] = useState<WorkoutEntry | null>(null);
  const [showCal, setShowCal] = useState(false);
  const [selCalDay, setSelCalDay] = useState('');
  /** Months away from the week the strip is on. Never positive — see `calAtNow`. */
  const [calShift, setCalShift] = useState(0);
  const [editEntry, setEditEntry] = useState<WorkoutEntry | null>(null);

  // Workouts recorded on a watch used to be importable only from Watch &
  // Devices, which is not a tab. People looked for them here, found nothing,
  // and concluded the app had dropped the session. Look for them here instead.
  // Nothing is written without a tap: a watch records plenty a person would not
  // choose to log, so this offers rather than assumes.
  const { ids: importedIds, mark: markImported } = useImportedIds();
  const [pending, setPending] = useState<WorkoutSample[]>([]);
  /**
   * The sentence about a device that did not answer, or null.
   *
   * This tab OFFERS workouts; it never claimed there were none, so a whole read
   * with nothing in it says nothing here — `readNote` returns that sentence
   * only under `emptyAndWhole`, and the filter below drops it. What must be
   * said is the opposite case: with Apple Health and WHOOP both connected and
   * WHOOP refusing, the offer below is Apple's alone, and a member who cannot
   * see their WHOOP session in it would otherwise read the omission as the app
   * having lost it. So the refusal is stated beside the offer.
   */
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const canImport = importSources(w.states).length > 0;
  useFocusEffect(useCallback(() => {
    if (!canImport) { setPending([]); setWatchNote(null); return; }
    let live = true;
    (async () => {
      // `readRecent`, not `fetchRecent`: the deprecated wrapper THROWS when
      // every provider asked failed, and there is no catch on a focus effect —
      // an unhandled rejection. More to the point, a provider that refused is
      // a fact this screen has to print, and the wrapper cannot express it.
      let r;
      try {
        r = await readRecent(w.states, 14);
      } catch (e) {
        // `readRecent` resolves for every provider outcome, so reaching here
        // means the read itself broke. Say nothing rather than guess: an
        // unexplained silence is not "no workouts from your watch".
        reportError('workouts.watchImport', e);
        return;
      }
      if (!live) return;
      setPending(r.samples.filter((sm) => !isLogged(sm, importedIds, workoutLog)));
      const note = readNote(r, '14 days', 'your devices');
      setWatchNote(r.emptyAndWhole ? null : note);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canImport, importedIds, workoutLog.length]));
  const importPending = async () => {
    if (!pending.length || importing) return;
    setImporting(true);
    try {
      const out = await logWorkouts(await Promise.all(pending.map(withHr)));
      // Marked imported ONLY once the rows are on the server. This used to mark
      // them regardless, so a refused write both lost the session and struck it
      // off the list of things still worth offering — the watch would never
      // suggest it again, and nothing said why.
      //
      // A QUEUED import is deliberately not marked either, and that is the
      // conservative side of the one place this screen can be wrong twice. The
      // mark is permanent and it is the only record that a session was ever
      // brought across, so retiring the row against a write that has not landed
      // would strike it off for good if the queue never drains. Offering it
      // again is survivable: `isLogged` already matches the queued entries in
      // `workoutLog`, so the row disappears on its own once they are in.
      if (out !== 'stored') {
        Alert.alert(
          out === 'unsent' ? 'Saved on This Phone' : 'Not Imported',
          out === 'unsent'
            ? 'No connection, so these have not reached your training log yet — they are saved on this phone and go up on their own next time you have signal. Your watch still has them either way.'
            : 'Your training log rejected these, so nothing was imported and nothing is waiting to send. Your watch still has them.');
        return;
      }
      markImported(pending.map((sm) => sm.id));
      setPending([]);
      tapLight();
    } finally { setImporting(false); }
  };
  const [confetti, setConfetti] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /**
   * Sets, reps and load a member has changed on a PROGRAM exercise.
   *
   * Keyed like `swaps`, by `dayIdx:key`, because that is what identifies one
   * row on one day rather than a movement in general. Held apart from
   * `customEx` because these rows still belong to the plan: the coach can
   * change the program underneath and everything else about the row should
   * follow, while the three numbers the member set stay theirs.
   *
   * This exists because editing was reachable only for exercises the member had
   * typed themselves — `replaceExercise` sent a program lift to the SWAP
   * sheet — so on the plan a coach had written, none of the three numbers could
   * be changed at all. The load was the one people noticed, because it is the
   * one that changes every week.
   */
  // (held by `usePlanEdits` above.)
  const [addOpen, setAddOpen] = useState(false);
  // Exercises the user took off, by uid — a WEEKDAY and a key, so taking
  // Monday's bench off takes Monday's bench off. The program itself is not
  // edited, so Wednesday's copy of the same lift still appears.
  // When set, the add sheet is editing this custom exercise rather than
  // creating one. Same sheet, because renaming IS replacing for a lift the
  // user typed themselves — it has no catalogue alternatives to swap to.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [cxName, setCxName] = useState(''); const [cxSets, setCxSets] = useState('3');
  /**
   * The movement's sets, ONE ROW EACH, in the sheet that adds or corrects one.
   *
   * ── what this replaces ───────────────────────────────────────────────────
   *
   * "Target Sets", "Target Reps" and one "Weight". Three boxes that could only
   * ever say "N of the identical set", so a member whose coach wrote a ramp —
   * or who ramps their own working sets, which is most people who lift — had no
   * way to write down that set 1 is 60 and sets 2 and 3 are 65. Reported from
   * TestFlight on the coach app, in the same words that produced the coach's
   * own table: a set count should open a row per set with its own weight.
   *
   * `setRows` — the shape a coach's program has used for this since it
   * existed — is what it writes. Nothing about the store changed.
   */
  const [cxRows, setCxRows] = useState<LadderRow[]>([]);
  // Seeded from the member's own unit but switchable per entry: a machine in a
  // hotel gym is plated in whatever that gym uses, not in what the member reads.
  const [cxUnit, setCxUnit] = useState<WeightUnit>(wu);
  // `now` from `useNow()` above, not a second `new Date()` — see the note
  // there. A COPY of it and not `now` itself: `now` is state shared by every
  // other reading on this screen, and `today0` is read seven more times below
  // (`dstr(today0)`, the month-calendar bounds, the "is this today" test on
  // every cell), so a future line doing `today0.setHours(0,0,0,0)` would
  // otherwise reach through and change what `weekIndexOf` above was told.
  const today0 = new Date(now);
  const week0 = startOfWeek(today0); week0.setDate(week0.getDate() + weekOffset * 7);
  // `setDate` past the end of a month rolls into the next one, so this arithmetic
  // survives a week that straddles a month or a year boundary without any help.
  const weekEnd0 = new Date(week0); weekEnd0.setDate(week0.getDate() + 6);
  const weekLabel = weekOffset === 0 ? 'This Week'
    : weekOffset === -1 ? 'Last Week'
    : `${week0.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${weekEnd0.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  const dateFor = (i: number) => { const d = new Date(week0); d.setDate(week0.getDate() + i); return d; };
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dstr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // Sets you have entered but not yet saved to the log.
  //
  // These used to live only in memory, so leaving the screen threw them away —
  // a member reported exactly this: "it wipes out as u go back". Someone
  // halfway through a session who checked a demo video, or was interrupted by a
  // call, lost every set they had typed. The work happened; only the record of
  // it did not, which is the worst way to lose data.
  //
  // Persisted per day, so yesterday's abandoned draft cannot reappear on top of
  // today's session. Cleared when the workout is saved for real.
  // Per day AND per account. It was `repple.workoutDraft.<date>`, which looks
  // scoped and is not: a date is not an account, so every member training on
  // this handset on this day shared one draft — and the sets in it are saved
  // through the same provider that stamps the row with whoever is signed in at
  // save time. `dstr` already produces a bare YYYY-MM-DD and it is passed
  // through as a STRING; `workoutDraftKey` checks its shape and never parses it,
  // because a date half built by round-tripping through a Date is a different
  // day for every reader who is not in UTC. See src/lib/sessionScope.ts.
  const draftKey = workoutDraftKey(cd.id, dstr(dateFor(dayIdx)));
  // The arming flag for the write, rebuilt for each key rather than carried
  // across one. A flag that survived the key changing would let an account
  // switch whose read then failed write this member's empty draft straight
  // over the other one's stored sets — the one way to LOSE a draft rather than
  // merely misfile it.
  const [draftGate, setDraftGate] = useState<DraftGate>(() => gateForKey(draftKey));

  useEffect(() => {
    let live = true;
    // Disarmed BEFORE the read, not after it fails.
    setDraftGate(gateForKey(draftKey));
    // No account is no store. Sets typed now stay on screen for this session
    // and are simply not kept — which is what a null key means, and is the only
    // honest answer when the app cannot say whose they are.
    if (!draftKey) { setLogged({}); return; }
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(draftKey);
        if (!live) return;
        setLogged(raw ? JSON.parse(raw) : {});
        // Armed only for the key that was actually read.
        setDraftGate((g) => gateHydrated(g, draftKey));
      } catch {
        // An unreadable store is nothing on screen and nothing armed, so the
        // next change is not written on top of bytes we never managed to read.
        if (live) setLogged({});
      }
    })();
    return () => { live = false; };
  }, [draftKey]);

  useEffect(() => {
    // Only after a read of THIS key has landed, or the first render would
    // immediately overwrite a stored draft with the empty object it starts
    // from — and an account switch would do it to somebody else's.
    if (!draftKey || !mayPersist(draftGate, draftKey)) return;
    if (Object.keys(logged).length === 0) AsyncStorage.removeItem(draftKey).catch(() => {});
    else AsyncStorage.setItem(draftKey, JSON.stringify(logged)).catch(() => {});
  }, [logged, draftKey, draftGate]);
  // `dayKeyOf`, not `dstr(new Date(l.t))`. Same answer, one implementation: the
  // calendar dots, the day list and the day's totals all have to agree on which
  // day an entry belongs to, and three copies of the arithmetic is how they
  // stop agreeing. See src/lib/entryEdit.ts.
  // Whether the marks below are a statement about the member's training or
  // about this screen's luck with a read. `workedDates` is built from
  // `workoutLog`, which is EMPTY under a failed read — so every dot went out,
  // the day strip's own accessibility label stopped saying "trained", the month
  // grid emptied, and a member standing in a gym with bad signal concluded
  // their sessions had been lost and logged them all again.
  const logKnown = workoutLogStatus === 'ready';
  const workedDates = new Set(workoutLog.map((l) => dayKeyOf(l.t)).filter((k): k is string => k != null));
  // ── and NOT a second list kept on this phone ────────────────────────────
  //
  // This line read `if (cardioLog.length) workedDates.add(dstr(today0))`, off a
  // local array `commitSession` prepended to BEFORE it asked the server and
  // never took anything back out of. It is the same crossing the note below
  // says the draft was removed for — "on this phone" counted as "in your log" —
  // and here it survived a write the server had actively REFUSED: the session
  // was rejected, the member was told so in an alert, and today still got a
  // trained mark on the strip, a filled circle in the month grid and a place in
  // "N days logged".
  //
  // Nothing is lost by dropping it. `useWorkoutLog` keeps a QUEUED entry in
  // `log` — its own header says so in as many words ("they are on the phone,
  // they are in `log`, they are counted in `unsent`") — so a stored session and
  // an unsent one both reach `workedDates` through the line above, on the day
  // key of their own timestamp. Only the refused one did not, and only the
  // refused one should not.
  // ── typed, and not saved ────────────────────────────────────────────────
  //
  // The draft used to be folded into `workedDates` itself, so two sets typed on
  // Wednesday and never saved gave Wednesday a brand dot on the strip, a filled
  // circle in the month grid and a place in "N days logged" — under a heading
  // about the LOG — while tapping that day said "Rest day — no workout logged",
  // because the panel reads the log alone. The rest of this file is scrupulous
  // about the line between "on this phone" and "in your log"; this was the one
  // figure that crossed it.
  //
  // The draft is still worth showing: somebody who typed and got called away
  // needs to find their way back to it. It is shown as its own state.
  const draftDates = new Set<string>();
  Object.keys(logged).forEach((k) => { if ((logged[k] || []).length) draftDates.add(dstr(dateFor(parseInt(k.split(':')[0], 10)))); });
  // Today's cardio, read from the saved log so it persists across navigation (not just this mount).
  const todayCardio = workoutLog
    .filter((l) => l.cardio && dayKeyOf(l.t) === dstr(today0))
    // `?? null`, not `?? 0`. The row below guards on `kcal != null` so it can
    // omit the figure entirely, and `?? 0` defeated that guard — a sauna, which
    // has no derivable burn, would have read "0 kcal". Zero is a measurement.
    .map((l) => ({ type: l.exercise, mins: l.cardio!.mins, dist: l.cardio!.dist, unit: l.cardio!.unit, watts: l.cardio!.watts ?? 0, kcal: l.kcal ?? null }));
  // The month the sheet is showing, as an offset from the month the strip is on.
  //
  // `calMonth` and `calYear` were consts off `week0` with no setter anywhere,
  // so the sheet opened on the current month and stayed there — the same defect
  // as the day strip, one screen deeper. A member could see thirty-one days and
  // reach none of the ones before them.
  //
  // Reset when the sheet is opened, so it always opens on the week you are
  // looking at rather than wherever it was left three days ago.
  const calBase = new Date(week0.getFullYear(), week0.getMonth() + calShift, 1);
  const calMonth = calBase.getMonth(), calYear = calBase.getFullYear();
  // How many blank cells the month grid opens with. Through weekStart.ts, so
  // this sheet and the day strip above it and the Calendar tab all agree — this
  // one was Monday-first while app/(client)/calendar.tsx drew the same month
  // Sunday-first, two screens one tap apart with the columns a day out.
  const firstDow = weekIndexOf(new Date(calYear, calMonth, 1));
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const monthLabel = calBase.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  // Not past the month we are in. Every day beyond today is a day with nothing
  // logged, and this sheet's day panel would state that as "Rest day — no
  // workout logged" for a Tuesday three weeks from now.
  const calAtNow = calYear > today0.getFullYear() || (calYear === today0.getFullYear() && calMonth >= today0.getMonth());

  // What is ALREADY in the log for the weekday the strip is on.
  //
  // "No way to edit or delete an exercise that has been entered." Both have
  // existed since TF-02 — but only inside the month-calendar modal, three taps
  // from here, on a day you have to find and tap first. A member looking at
  // Train saw the plan and the draft they were typing and nothing they had
  // already saved, so the entry they wanted to fix was not on screen and
  // neither was any way to fix it. It is on screen now.
  const stripDay = dstr(dateFor(dayIdx));
  const stripEntries = workoutLog.filter((l) => dayKeyOf(l.t) === stripDay);
  const activeCalDay = selCalDay || dstr(today0);
  const dayEntries = workoutLog.filter((l) => dayKeyOf(l.t) === activeCalDay);
  // ── the day's volume, priced the way every other total in this app is ────
  //
  // This was `reps × load` over every stored set, and it got three different
  // answers wrong at once. A 45-second plank is `[45, 10]` with `timed[0]`
  // true, so it read as 450 kg — the exact number src/lib/bodyweightSets.ts
  // names as the thing that must never happen. An hour of pull-ups is
  // `[8, 0]` with `bw[0]` true, so it read as nothing at all and the panel
  // said "Volume 0t" over it. And a total that could price nothing was still
  // printed as a total rather than as unknown.
  //
  // `tonnage` is the one implementation: holds skipped, bodyweight sets priced
  // against the member's own weight on the day, and the sets it could not price
  // counted separately so `tonnageNote` can say so out loud. The finish card in
  // this same file has done it this way for a while; this panel is one modal
  // away and was still doing it by hand.
  const dayTonnage = tonnage(dayEntries, cd.weightSeries as BodyweightHistory);
  const dayVolume = dayTonnage.kg;
  const dayVolumeNote = tonnageNote(dayTonnage);
  const daySets = dayEntries.reduce((a, l) => a + (l.sets ? l.sets.length : 0), 0);
  // Null, not 0, when nothing in the day carries a measured figure.
  // Strength entries no longer invent one (see `buildEntries`), so a pure
  // lifting day has no calories to total — and a column reading "0" over an
  // hour under a barbell is a measurement claim, and a wrong one. A dash is
  // the same answer the cardio rows already give for a sauna.
  const dayKcalEntries = dayEntries.filter((l) => l.kcal != null);
  const dayKcal = dayKcalEntries.length ? dayKcalEntries.reduce((a, l) => a + (l.kcal || 0), 0) : null;
  const dayHeadline = volumeHeadline(dayVolume, wu);
  const prettyDay = (ds: string) => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); };

  // The days of the week they are ON, not `program.days`. Identical for every
  // one-week program, which is every program written before blocks existed
  // and every program this app generates itself.
  const programDays = Array.isArray(blk.days) ? blk.days : [];
  const workout = programDays[dayIdx % (programDays.length || 1)] || programDays[0] || { day: '', focus: 'Rest Day', exercises: [] };

  /* ── the sessions there are to repeat ─────────────────────────────────────
   *
   * `workoutLog` is EMPTY under a failed read — the same trap `logKnown` above
   * already exists for — so the count of sessions here is a count of what was
   * READ and not of what there is. The control below is drawn off it and says
   * which it is looking at; nothing on this screen says "you have no past
   * sessions" without `workoutLogStatus` agreeing. */
  const repeatable = useMemo(() => loggedSessions(workoutLog), [workoutLog]);
  /* The movements this screen can still put a name to.
   *
   * NOT the 615-row `exercises` catalogue. `useExerciseCatalogue` is a third of
   * a megabyte and this screen is used in basements; reading it here to fill in
   * a muscle group would be six hundred rows over a gym's signal for one word
   * under a movement name. What it is instead is the member's own program —
   * every movement on every day of the week they are on, plus anything they
   * have added themselves — which is the list that actually answers the
   * question the picker asks: is this still something you train?
   *
   * A real list either way, never null, so `repeatSession` reports honestly
   * that it was given something to check against. */
  const knownMovements: ExerciseRef[] = (() => {
    const by = new Map<string, ExerciseRef>();
    const add = (name: string, group: string) => {
      const id = exerciseSlug(name);
      if (!id || by.has(id)) return;
      by.set(id, { id, name, group });
    };
    for (const d of programDays) for (const e of (d.exercises || [])) add(e.name, e.group);
    for (const e of customEx) add(e.name, e.group);
    return [...by.values()];
  })();
  /**
   * Open the runner on a session already in the log.
   *
   * No `rememberSession` and no Live Activity, and that is a limitation rather
   * than a preference. The live record in src/lib/liveSession.ts can say that a
   * GUIDED session was running and cannot say which past session it was
   * repeating, so a restore after the app is killed would re-open the runner on
   * TODAY'S PLAN — a different list of movements than the one somebody was
   * three sets into. The typed sets are on disk under the guided draft either
   * way and are left there rather than deleted, because the draft's own
   * day-and-plan check sees a list it does not recognise (`staleDraft`).
   *
   * A repeat therefore does not survive the app being killed, and nothing
   * claims it does. Restoring one needs a field on the live record, which is a
   * change to a module ten screens read.
   */
  const startRepeat = (s: PastSession) => {
    const c = repeatSession(s.entries, knownMovements);
    if (c.exercises.length === 0) {
      // Never an empty runner. `startGate` in src/lib/startGate.ts is the whole
      // story of what mounting one costs, and the reason is always in `skipped`
      // — this is the one path that can produce nothing, and it says which.
      Alert.alert('Nothing to Repeat in That One',
        c.skipped.length ? c.skipped[0].reason : 'No sets were recorded in that session.');
      return;
    }
    setRepeatPick(false);
    setRepeatRun({ from: s.t, exercises: c.exercises });
    setResumeAt(null);
    setSession(true);
    tapLight();
  };
  const exercises = Array.isArray(workout && workout.exercises) ? workout.exercises : [];
  /**
   * The key everything on this screen is held under: what has been logged, what
   * has been removed, which row is open, which was edited.
   *
   * DELIBERATELY NOT week-scoped, and this is worth a note now that the screen
   * can show more than one week. `addWeek` copies a week, so week two's bench
   * press carries the same `key` as week one's, and the tempting fix is to put
   * `viewWeek` in front. It cannot go here: this shape is PERSISTED and it is
   * read back by things that parse it. The workout draft above is stored under
   * these keys and `workedDates` reads the day index straight out of the first
   * segment; `removedEx`, `swaps` and `exEdits` are written under it to the
   * device AND sent to the coach's console by src/ui/planEdits.tsx. Prefixing
   * would orphan every stored edit on every phone and mis-date every draft.
   *
   * What it costs is small and visible: a client who has typed sets against
   * today's session and then taps forward to read week six sees those chips
   * against week six's identically-keyed movement. The line under the week
   * strip says which week they are looking at, and nothing is written from it.
   */
  const uid = (e: ProgramExercise) => `${dayIdx}:${e.key}`;
  /**
   * Whether the injuries every guard below is computed from were actually read.
   *
   * ── The defect ──────────────────────────────────────────────────────────
   *
   * `cd.injuries` starts `[]` (src/ui/clientData.tsx) and is filled from
   * exactly one place, the `clients` row. Under USE_SUPABASE the local cache is
   * DELETED at launch, so there is no second source; the read is tried three
   * times and then `profileStatus` goes to 'error' and stays there for the
   * session. The list is `[]` either way, and everything on this screen that
   * protects an injured member is a function of that list: the severe-injury
   * auto-swap below, `injHidden`, the "on hold" gate, and the caution line
   * under each movement in the session runner.
   *
   * So a failed read did not make this screen cautious, it made it silent. A
   * member with a severe knee on record, opening Lifting in a basement gym with
   * no signal — which is exactly where this screen is used — was shown squats,
   * unswapped, with no caution under them and nothing anywhere saying their
   * disclosure had not been read. That is the same picture as "checked, and you
   * are clear", drawn for the one case with the least basis for it.
   *
   * `app/(client)/injuries.tsx` already draws the three arms apart and says
   * why; this follows it.
   *
   * ── Why a caveat here rather than withholding the session ───────────────
   *
   * The meals screen answers this differently — it refuses to build a plan at
   * all — and the difference is real. A meal week is COMPOSED from the
   * exclusions: filtering renumbers the catalogue, so a week built without them
   * cannot be marked up after the fact, and an unfiltered week is simply the
   * wrong food. A workout is the coach's program, and injuries only ever
   * SUBTRACT from it. The plan on screen is still the plan; what is missing is
   * the subtraction. That can be stated honestly, and stating it is better than
   * taking training away from every member in a gym with no signal — which is
   * most of them, most of the time.
   *
   * 'partial' counts as unread and is not a softer thing: half an injury list
   * is not a basis for drawing the other half as clear.
   */
  const injRead = isWhole(cd.profileStatus);
  const injLoading = cd.profileStatus === 'loading';
  // Severe active injuries auto-manage the plan: swap to a safe alternative, or
  // hide the movement entirely when no alternative avoids the injured area.
  const injAutoMap: Record<string, string> = {};
  const injHidden: string[] = [];
  for (const _e of exercises) {
    const _id = `${dayIdx}:${_e.key}`;
    if (swaps[_id]) continue; // a manual swap always wins
    const _f = injuryFlag(_e.name, _e.group, cd.injuries);
    if (_f && _f.injury.severity === 'severe') {
      const _alt = (_e.alternatives || []).find((a) => !injuryFlag(a, _e.group, cd.injuries));
      if (_alt) injAutoMap[_id] = _alt; else injHidden.push(_id);
    }
  }
  const injHiddenSet = new Set(injHidden);
  const isInjHidden = (e: ProgramExercise) => injHiddenSet.has(uid(e)) && !injRevealed.includes(uid(e));
  const nameOf = (e: ProgramExercise) => swaps[uid(e)] || injAutoMap[uid(e)] || e.name;
  // ── the name to READ, which is not the name to WRITE ────────────────────
  //
  // `nameOf` is the identity: it is the route parameter the exercise screen is
  // opened with, the key `suggestForExercise` and `priorBest1RM` look a record
  // up by, and the string written into `exercise` on every set this screen
  // logs. It must stay English, because English is what `exercises.id` is the
  // slug of.
  //
  // `shownName` is the same movement in the reader's own language. A German
  // member browsing the Library read "Kniebeuge" and then opened the workout
  // they were about to do, where the same movement said "Barbell Back Squat" —
  // the app translating the catalogue it browses and not the one it trains
  // from. Every site below that a person READS or HEARS goes through this one;
  // every site that identifies a movement still goes through `nameOf`.
  const { textOf: movement } = useMovementName();
  const shownName = (e: ProgramExercise) => movement(nameOf(e));
  // Progress-photo focus areas bubble matching muscle groups to the top of today.
  //
  // Sorted in BLOCKS, not in exercises. A superset is a run of neighbours
  // performed back to back (src/lib/setGroups.ts), so a sort that moves one
  // member and leaves the other behind does not reorder the group — it destroys
  // it, and the two halves would then render as ungrouped movements with the
  // coach's pairing silently gone. A block is a whole run or a single exercise,
  // and a run comes forward if ANY of its movements is a focus area, because
  // there is no way to bring half of one forward.
  const orderedExercises = (() => {
    if (!cd.focusAreas.length) return exercises;
    const runs = groupRuns(exercises);
    const blocks: ProgramExercise[][] = [];
    for (let i = 0; i < exercises.length;) {
      const run = runs.find((r) => r.start === i);
      if (run) { blocks.push(exercises.slice(i, i + run.size)); i += run.size; }
      else { blocks.push([exercises[i]]); i += 1; }
    }
    // Stable, like the sort it replaces: blocks that are neither in focus nor
    // out of it keep the order the coach wrote them in.
    return blocks.sort((a, b) => (b.some((e) => cd.focusAreas.includes(e.group)) ? 1 : 0) - (a.some((e) => cd.focusAreas.includes(e.group)) ? 1 : 0)).flat();
  })();
  const deload = deloadCheck(workoutLog);
  // Default: expand the first not-yet-finished exercise, collapse the rest (until the user taps).
  const isRemovedEx = (e: ProgramExercise) => removedEx.indexOf(uid(e)) >= 0;
  // Applied here rather than at each render site: the ring, the set counter,
  // the runner and the suggestion all read `e.sets`/`e.reps`, and an override
  // honoured in only some of them is worse than none.
  const withEdits = (e: ProgramExercise): ProgramExercise => {
    const ed = exEdits[uid(e)];
    if (!ed) return e;
    /**
     * The override used to DROP the coach's per-set table unconditionally, and
     * that was the only honest reading at the time: the sheet asked for one
     * count, one rep target and one load, so saving it meant "I am doing three
     * of the same set", and a table left underneath would go on being what the
     * runner counted, the ring measured and the row displayed, with the numbers
     * they had just typed visible nowhere.
     *
     * The sheet now asks for the table itself, so the correction can say what
     * the plan says and the drop is no longer a refusal to lie — it would be a
     * refusal to record. `ed.setRows` is what the member typed, one row per set,
     * and it replaces the coach's rather than being merged into it: this is a
     * member saying what they are actually doing, not an annotation on what they
     * were asked to do.
     *
     * An edit written before the table existed carries no `setRows` key at all,
     * and that is the case the `undefined` check is for — those corrections
     * still drop the coach's table, exactly as they did on the build that wrote
     * them, because "three of the same set" is still what they meant.
     */
    return {
      ...e,
      setRows: ed.setRows !== undefined ? ed.setRows : null,
      ...(ed.sets != null ? { sets: ed.sets } : {}),
      ...(ed.reps != null ? { reps: ed.reps } : {}),
      ...(ed.loadKg !== undefined ? { loadKg: ed.loadKg } : {}),
    };
  };
  const planEx = orderedExercises.filter((e) => !isRemovedEx(e)).map(withEdits);
  // THE list the runner is handed, named once so that the button which opens it
  // and the runner itself cannot be asked about different days.
  //
  // They were: the Start gate asked `exercises` — the raw program day — and
  // the runner was given this. A day emptied by the per-row Remove, or by a
  // severe injury that every movement on it runs into with no safe alternative,
  // left a live Start Workout in front of an empty runner, whose mount effect
  // reads `exercises[idx].key` and threw a TypeError out of an effect, which is
  // after the render that returns null has committed. That took the whole tab
  // bar down to the error screen, mid session. See src/lib/startGate.ts.
  //
  // `customEx` is in it. A movement the member added to today — through "Add an
  // Exercise You Did", offered on any day with a plan — was on the list on
  // screen (`planRows` below) and in nothing else: the runner was handed
  // `planEx` alone and ran straight past it, and on a REST day the gate was
  // asked about a program of zero, answered 'rest-day', and took the Start
  // button away from somebody who had just typed in the three movements they
  // were about to do. src/lib/startGate.ts says its whole purpose is keeping
  // the button and the runner asking about the same list; this is that list.
  const runnableEx = [...planEx, ...customEx].filter((e) => !isInjHidden(e));

  // The rows in the order they are rendered, and the group badge for each of
  // them read off THAT order.
  //
  // One array, used for both, because a badge computed from a different list
  // than the one on screen is the failure this whole model is designed to
  // prevent: `planEx` is already filtered by `removedEx` and re-sorted by focus
  // area, so a client who removes the middle movement of a tri-set is looking
  // at a run of two and must be told "superset". Exercises the member typed in
  // themselves are appended and carry no group id, so they cannot extend a run.
  const planRows = [...planEx, ...customEx];
  const rowGroups = groupBadges(planRows);

  const isCustomEx = (e: ProgramExercise) => e.key.indexOf('custom-') === 0;

  /**
   * Delete something already in the log. Taken back for six seconds, and
   * believed only when the server says the row is gone.
   *
   * This was a modal asking "Delete this entry?" — and a modal is the wrong
   * shape for it. The tap that deletes is the same tap on the same side of the
   * same dialog every time, so people stop reading it, and once it goes
   * through the set is gone. The row leaves immediately now, the bar at the
   * bottom says so, and the WRITE is held behind an Undo for six seconds; see
   * src/lib/undoable.ts.
   *
   * What has not changed is the half that was already right: the delete is
   * believed only when `removeWorkout` says the row is gone. A refused one
   * used to look done and come back at the next launch with the session — its
   * volume and its calories — back with it. `removeWorkout` resolves false in
   * that case and leaves the log alone, and this says so rather than
   * swallowing it.
   */
  const deleteEntry = (l: WorkoutEntry) => {
    const key = entryKey(l);
    setPendingRemoval((ids) => (ids.includes(key) ? ids : [...ids, key]));
    const putBack = () => setPendingRemoval((ids) => ids.filter((x) => x !== key));
    toast.remove({
      id: key,
      text: `${movement(l.exercise)} removed from your log.`,
      onUndo: putBack,
      onCommit: async () => {
        if (!(await removeWorkout(l))) {
          // Still an alert, and deliberately: this one says the log is not
          // what the screen just showed, and the entry is back on it.
          putBack();
          Alert.alert('Not Deleted', `${movement(l.exercise)} is still in your log — we could not reach the server to remove it.`);
        }
      },
    });
  };

  /**
   * Movements to offer when somebody is replacing a logged exercise.
   *
   * Today's plan and its catalogue alternatives first — a mis-tapped lift is
   * almost always one of the movements sitting next to it — then everything
   * the member has ever logged a weighted set against, which is the only list
   * that knows what they actually do. Deduplicated case-insensitively, because
   * "Back Squat" and "back squat" are one exercise everywhere else in this app
   * and offering both would let somebody split their own PR history in two.
   */
  const knownExercises = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (n?: string | null) => {
      const v = (n ?? '').trim();
      const k = v.toLowerCase();
      if (v && !seen.has(k)) { seen.add(k); out.push(v); }
    };
    for (const e of exercises) { add(e.name); for (const a of e.alternatives || []) add(a); }
    for (const e of customEx) add(e.name);
    for (const l of workoutLog) if (l.sets && l.sets.length) add(l.exercise);
    return out;
  })();

  /** Take an exercise off today. Confirmed, because any sets already logged
   *  against it go with it. */
  const removeExercise = (e: ProgramExercise) => {
    const _u = uid(e);
    const hasSets = (logged[_u] || []).length > 0;
    Alert.alert(
      'Remove ' + shownName(e) + '?',
      hasSets
        ? 'It comes off today, and the sets you logged against it are discarded.'
        : 'It comes off today only. The rest of your program is unchanged.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          if (isCustomEx(e)) setCustomEx((prev) => prev.filter((x) => x.key !== e.key));
          else setRemovedEx((prev) => (prev.indexOf(_u) >= 0 ? prev : [...prev, _u]));
          setLogged((prev) => { const n = { ...prev }; delete n[_u]; return n; });
          tapLight();
        } },
      ],
    );
  };

  /**
   * Open the editor for ANY exercise — one the member typed or one the coach
   * planned. Sets, reps and the load are all editable either way; a program
   * row keeps its Swap action separately, because replacing the movement and
   * correcting its numbers are different intentions.
   */
  /** The name the plan gives a row, so a rename is only recorded when it IS one. */
  const planNameFor = (key: string) => (exercises.find((x) => x.key === key) || { name: '' }).name;

  /**
   * Retype the set count, and grow or shrink the table under it.
   *
   * The box keeps whatever was typed, including something that is not a count,
   * because a controlled input that refuses a keystroke is one nobody can
   * backspace out of. Only a READABLE count moves the table, so clearing the
   * box mid-edit does not throw away four rows of numbers underneath it.
   */
  const retypeCxSets = (v: string) => {
    setCxSets(v);
    const read = readSetCount(v);
    if (read.ok) setCxRows((rows) => resizeLadder(rows, read.n));
  };
  /**
   * Switch the sheet's unit, and CONVERT what is in the boxes.
   *
   * The old sheet had one weight box and relabelled it, which meant tapping LB
   * turned a 60 kg target into a 60 lb one without touching the digits — the
   * member watched the unit change and the number stay, and saved 27 kg. Here
   * the rows are read in the unit they were typed in and written back out in
   * the new one, so the WEIGHT is unchanged and only the way it is written
   * moves. A row that will not read is left exactly as typed rather than
   * blanked: it is the only copy of what somebody meant.
   */
  const switchCxUnit = () => {
    const next: WeightUnit = cxUnit === 'kg' ? 'lb' : 'kg';
    setCxRows((rows) => rows.map((r) => {
      const read = readLift(r.load, cxUnit);
      if (!read.ok) return r;
      return { ...r, load: read.kg == null ? '' : plain(liftIn(read.kg, next) ?? 0) };
    }));
    setCxUnit(next);
  };

  const openEditFor = (e: ProgramExercise) => {
    setEditingKey(e.key);
    // `setCount` rather than `e.sets`: on a movement the coach wrote a table
    // for, those two can differ, and the sheet must open on the number of sets
    // the member is actually looking at.
    setCxName(nameOf(e)); setCxSets(String(setCount(e)));
    // Every set, one row each, read back out in the unit the sheet is currently
    // set to — so what is shown is what would be saved. `ladderFromPlan` goes
    // through `expandSets`, so a coach's table opens as their table and a
    // movement with no table opens as `sets` copies of its one spec, which is
    // exactly what this sheet used to show in three boxes.
    setCxRows(ladderFromPlan(e, cxUnit));
    setAddOpen(true);
  };

  /** Replace an exercise. A program lift swaps to a catalogue alternative;
   *  one the user typed has none, so it opens for editing instead. */
  const replaceExercise = (e: ProgramExercise) => {
    openEditFor(e);
  };

  /** Commit the add sheet. Only clears the draft once the exercise is really
   *  on the list — an interrupted sheet keeps what was typed. */
  const commitCx = () => {
    // Title Case, because this name is about to sit in a list beside movements
    // the catalogue wrote — and, once it is logged, in `workouts.exercise`
    // next to 615 rows that are all spelled that way. `titleCaseName` cannot
    // change the slug (src/lib/exerciseName.ts), so this is a spelling and
    // never an identity.
    //
    // The catalogue's own name is NOT reached for here, and that is this
    // screen's standing rule rather than an oversight: `knownMovements` above
    // explains why the 615-row catalogue is not read on a screen used in
    // basements. So a member who types "shoulder press" gets "Shoulder Press"
    // and not the catalogue's row — same slug, same movement, same history.
    const name = titleCaseName(cxName);
    if (!name) return;
    // The table, one row per set. A load that cannot be believed is REFUSED and
    // named by its row rather than quietly becoming no target: this sheet used
    // to fold a rejected `readLift` into `loadKg = null`, so a mistyped 4225
    // silently erased the target the member was trying to correct.
    const table = ladderToPlanRows(cxRows, cxUnit);
    if (!table.ok) { Alert.alert('Check That', table.reason); return; }
    const setRows = table.setRows;
    // The two numbers are one fact — see src/lib/setRows.ts. A table of four
    // rows under `sets: 3` shows the member "3/3 sets" with a fourth row
    // unlogged underneath it.
    const sets = setRows.length;
    // The exercise's own fallback, which is what every reader that has never
    // heard of a table still reads: the collapsed row's summary line, the
    // suggestion, the runner's header. Taken from the FIRST row, because that is
    // the set the movement opens on.
    const reps = String(setRows[0].reps ?? '') || '10';
    const loadKg = setRows[0].loadKg ?? null;
    if (editingKey) {
      const isCustom = editingKey.indexOf('custom-') === 0;
      if (isCustom) {
        // Same key, so sets already logged against it survive the rename.
        setCustomEx((prev) => prev.map((x) => (x.key === editingKey ? { ...x, name, sets, reps, loadKg, setRows } : x)));
      } else {
        // A PROGRAM row. The numbers are recorded as an override rather than
        // by rewriting the plan, so the coach's program stays the program
        // and this stays the member's correction to it. A rename on a planned
        // movement goes through `swaps`, which is what the Swap sheet already
        // writes and what `nameOf` already reads.
        setExEdits((prev) => ({ ...prev, [dayIdx + ':' + editingKey]: { sets, reps, loadKg, setRows } }));
        if (name && name !== planNameFor(editingKey)) setSwaps((prev) => ({ ...prev, [dayIdx + ':' + editingKey]: name }));
      }
    } else {
      const key = 'custom-' + Date.now();
      setCustomEx((p) => [...p, { key, name, group: 'Added', sets, reps, loadKg, setRows, alternatives: [] } as ProgramExercise]);
      setExpanded((p) => ({ ...p, [dayIdx + ':' + key]: true }));
    }
    setAddOpen(false); setEditingKey(null);
    setCxName(''); setCxSets('3'); setCxRows([]);
    tapLight();
  };
  // `setCount` and not `e.sets`, here and below. The two agree for every
  // exercise without a table and for every one written by this build — the
  // builder keeps them in step — but they are one fact with two homes, and this
  // is the reader that decides which exercise opens first. It asks the rows.
  const firstOpenId = (() => { for (const _e of planRows) { const _u = uid(_e); if ((logged[_u] || []).length < setCount(_e)) return _u; } return null; })();
  // Presentation only: how much of today's plan is already logged, for the hero ring.
  const doneCount = exercises.filter((e) => (logged[uid(e)] || []).length >= setCount(e)).length;
  const plannedSets = exercises.reduce((n, e) => n + setCount(e), 0);
  // What the selected day trains, in the order the day meets it, for the chips
  // under the hero — and what the whole week on screen asks of each group, most
  // sets first, for the Muscle Focus bars. Both read `group` off the program's
  // own rows; a row with none is left out rather than filed under a guess.
  const dayGroups = groupsOf(exercises);
  // The selected day's own name, exactly as the program stores it; a day a
  // coach left unnamed is "Day n" by its place in the week rather than being
  // given a name inferred from what is in it.
  const dayTitle = (workout.focus || '').trim() || `Day ${(dayIdx % (programDays.length || 1)) + 1}`;
  const blockCounted = blk.week.count > 1 && blk.week.reason === 'counted';
  const weekFocus = (() => {
    const by = new Map<string, number>();
    for (const d of programDays) for (const e of (d.exercises || [])) {
      const g = (e.group || '').trim();
      if (g) by.set(g, (by.get(g) ?? 0) + setCount(e));
    }
    return [...by.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  })();
  // WHICH DAY the card and its Start button are about. The day strip that picks
  // it sits under the card, as the board draws it, so the card has to carry the
  // answer itself: a member who tapped Thursday to read it and scrolled back up
  // was looking at "Start Workout" over Thursday's session with nothing on the
  // card saying it was no longer today's. A filter stays attached to what it
  // changes. Same date wording as the strip's own spoken label.
  const cardDay = dayIdx === todayIdx && weekOffset === 0
    ? 'Today'
    : dateFor(dayIdx).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const heroNote = exercises.length === 0
    // A rest day the member has added movements to is still a rest day in the
    // program, and it is no longer a day with nothing on it — the Start
    // button is now offered for exactly those movements, so the line under it
    // has to agree.
    ? (customEx.length > 0
      ? `Rest day — ${customEx.length} movement${customEx.length === 1 ? '' : 's'} you added`
      : 'Rest day — nothing scheduled')
    // COUNTED, not estimated. This read `~${estMin} min`, where `estMin` was
    // `max(20, exercises × 9)` — a duration with no set count, no rest and no
    // measurement in it, printed on the first card of the tab beside the button
    // it describes. Home refuses the same figure in so many words ("there is no
    // duration model in this codebase"), so the two screens disagreed about
    // whether the app knows how long a session is. The set total IS the plan,
    // through the same `setCount` the rows below are ticked against, and a
    // reader can price their own evening from it.
    : `${plannedSets === 1 ? '1 set' : `${plannedSets} sets`}` + (doneCount > 0 ? ` · ${doneCount} of ${exercises.length} done` : '');
  // Whether the session may be started, asked of the list the runner receives
  // rather than of the program, and what to say when it may not be. A
  // withheld button that explains nothing is how the injury case reads
  // otherwise: the app decides today's plan is unsafe for them and then simply
  // has no button, which tells them nothing about a decision made on their
  // behalf.
  const start = startGate({
    isStrength: mode === 'strength',
    // What was scheduled OR added. A rest day somebody has written three
    // movements onto is not a day with nothing on it.
    planned: exercises.length + customEx.length,
    runnable: runnableEx.length,
    removed: removedEx.filter((u) => u.indexOf(dayIdx + ':') === 0).length,
    injuryHidden: injHidden.filter((u) => !injRevealed.includes(u)).length,
  });
  const logSet = (e: ProgramExercise, set: LoggedSet) => {
    if (!set.value) return;
    setLogged({ ...logged, [uid(e)]: [...(logged[uid(e)] || []), {
      reps: String(set.value),
      kg: set.kg == null ? '' : String(set.kg),
      ...(set.bw ? { bw: true } : {}),
      ...(set.timed ? { timed: true } : {}),
    }] });
    tapLight();
  };
  /**
   * Tick a planned set off on the plan screen — which LOGS it, at the figures
   * the plan asked for.
   *
   * The same journey a typed set makes: `logSet` is the one writer of the day's
   * draft, and it is the one that decides what an empty load box means. A
   * planned set with no load is a bodyweight set and its `kg` is null, which is
   * exactly what the row below the movement produces when the box is left
   * empty. A hold is a hold, in seconds, never a rep count.
   */
  const tickPlannedSet = (e: ProgramExercise, rec: TickRecord) => {
    logSet(e, {
      value: rec.kind === 'hold' ? rec.secs : rec.value,
      kg: rec.loadKg,
      bw: rec.loadKg == null,
      timed: rec.kind === 'hold',
    });
  };
  /**
   * Take the most recent set back off this movement.
   *
   * The last one, and only the last. The day's draft is a list of sets in the
   * order they were logged with no set numbers in it, so removing the third of
   * five would renumber the two after it into sets nobody did — the argument is
   * written out in full in src/lib/setTicks.ts, which is what decides that only
   * the most recent tick is undoable.
   */
  const untickLastSet = (e: ProgramExercise) => {
    const _u = uid(e);
    setLogged((prev) => {
      const cur = prev[_u] || [];
      if (!cur.length) return prev;
      return { ...prev, [_u]: cur.slice(0, -1) };
    });
    tapLight();
  };
  // One tap records the set the plan is asking for — TF-27, "can't tap an
  // exercise to log it". This function has existed here unreferenced: the only
  // way to record a set was to expand the row and type the two numbers the app
  // had already worked out and was showing you. It is offered next to that
  // suggestion, so the number you tap is the number you are looking at.
  // A movement prescribed in seconds is quick-logged as the hold it asks for,
  // not as a rep count parsed off the front of '45 sec'. Without this the one
  // tap the plan offers recorded forty-five repetitions of a plank.
  //
  // ── and why it is not offered for every prescription ──────────────────────
  //
  // The rep count was `parseInt(e.reps, 10) || 8`. "AMRAP" and "Max" parse to
  // NaN and became EIGHT; a range parsed to its first number, so "8-10" was
  // recorded as eight whatever was done. That is a rep count the member did not
  // perform, written by the fastest control in the app into the log that feeds
  // their records, their tonnage and next session's target — and the button's
  // own accessibility label read the prescription out verbatim while doing it.
  //
  // `readRepSpan` (src/lib/setRows.ts) already decides this for the coach's
  // side and it decides it here: a single number is a definite count, and a
  // range, a hold and an AMRAP are all "not known in advance". Where it is not
  // known there is no one-tap — the LogSetRow under every row takes the number
  // the member actually did, which is the only place it can come from.
  const quickReps = (reps: string | null | undefined): number | null => {
    const span = readRepSpan(reps);
    return span && span.low === span.high && span.low > 0 ? span.low : null;
  };
  /** Whether one tap can record this movement without inventing a figure. */
  const canQuickLog = (e: ProgramExercise): boolean =>
    prescribedSeconds(e.reps) != null || quickReps(e.reps) != null;
  const quickLog = (e: ProgramExercise) => {
    const sg = suggestForExercise(workoutLog, nameOf(e), e.reps, 2.5, wu);
    const secs = prescribedSeconds(e.reps);
    if (secs != null) { logSet(e, { value: secs, kg: sg ? sg.weight : null, bw: sg == null, timed: true }); return; }
    const r = quickReps(e.reps);
    if (r == null) return;
    logSet(e, { value: r, kg: sg ? sg.weight : null, bw: false, timed: false });
  };
  // One write path for every non-strength session, whether it was timed live in
  // the runner below or typed in afterwards. History, the calendar and the
  // trends all read this one shape, so a second writer would only be a second
  // chance to get it subtly different.
  //
  // Recovery is time only, and the guard lives here rather than at each caller.
  // The form hides Distance, watts and calories under Recovery, but the fields
  // keep whatever was typed under Cardio before the chip was switched — so
  // without this a sauna could still carry the 5 km from the run before it.
  const commitSession = async (
    kind: SessionKind,
    activity: string,
    m: number,
    extra: { dist?: number; unit?: string; watts?: number; kcal?: number | null; zones?: ZoneSeconds } = {},
  ): Promise<boolean> => {
    if (!m) return false;
    const rec = kind === 'recovery';
    const d = rec ? 0 : (extra.dist || 0);
    const u = extra.unit || unit;
    const wt = rec ? 0 : (extra.watts || 0);
    // Null when there is no weight to estimate from, and null is stored rather
    // than a stand-in — an unknown burn is not zero, and it is not 70 kg's.
    // `cardioKcal` already returns null for every recovery modality, since none
    // of them has a MET value to derive one from; `rec` short-circuits it so a
    // figure the person typed cannot get one in through the side door either.
    const kIn = extra.kcal ?? 0;
    const kcal = rec ? null : (kIn > 0 ? kIn : cardioKcal(activity, m, cd.weightKg));
    const out = await logWorkouts([{
      t: new Date().toISOString(),
      exercise: activity,
      cardio: { mins: m, dist: d, unit: u, ...(wt > 0 ? { watts: wt } : {}) },
      kcal: kcal ?? undefined,
      // Attached only when a heart-rate source actually fed the session — see
      // the note on WorkoutEntry.zones, which stays absent rather than
      // zero-filled so "no watch" and "no effort" remain different things.
      ...(extra.zones && zoneSecondsTotal(extra.zones) > 0 ? { zones: extra.zones } : {}),
    }]);
    // A timed session is the one write in this app that cannot be redone from
    // memory — nobody can retype forty minutes of heart-rate zones — so the
    // outcome has to be said rather than swallowed. It is also the write that
    // gained the most from the queue: 'unsent' used to mean those zones were
    // gone at the next launch, and now means they are on the phone waiting.
    const zoned = !!extra.zones && zoneSecondsTotal(extra.zones) > 0;
    if (out === 'unsent') {
      Alert.alert('Saved on This Phone',
        `No connection, so your ${KIND_LABEL[kind].toLowerCase()} session has not reached your training log yet${zoned ? ' — heart-rate zones and all' : ''}. Nothing is lost: it is saved here and goes up on its own next time you have signal.`);
      // True, and the reason this is not `false`: the session is kept, so the
      // caller may clear its form. Nothing here says it was recorded.
      tapLight();
      return true;
    }
    if (out === 'refused') {
      Alert.alert('Not Saved',
        `Your training log rejected this ${KIND_LABEL[kind].toLowerCase()} session, so it has not been recorded${zoned ? ', and the heart-rate zones go with it' : ''}. It is not waiting to send either — logging it again as it is will be rejected again.`);
      return false;
    }
    tapLight();
    return true;
  };

  /* `commitSession` answers false for exactly one outcome — a write the server
   * READ and declined — and its answer was dropped on the floor by the `void`,
   * after which all four boxes were emptied unconditionally. So the alert said
   * "it has not been recorded ... logging it again as it is will be rejected
   * again" over a form that no longer held anything to log again: the minutes,
   * the distance, the watts and the calories the member had just typed were the
   * only copy of that session and the app threw them away on the one path where
   * nothing durable was holding them.
   *
   * `logWorkoutNL` forty lines up already states the rule this broke — "the box
   * is emptied for the two outcomes that KEPT what was typed, and not for the
   * one that threw it away" — and `saveManual` keeps its sets for the same
   * reason. This was the one writer on the screen still clearing regardless. */
  const logCardio = async () => {
    const m = parseInt(mins, 10) || 0; if (!m) return;
    const kept = await commitSession(isSessionKind(mode) ? mode : 'cardio', ctype, m, {
      // `readNumber`, not `parseFloat`. Distance is the one cardio figure that is
      // genuinely fractional — 12.7 km is an ordinary run — so its box is a decimal
      // pad, and the decimal key on that pad is a comma in most of Europe.
      // `parseFloat('12,7')` is 12, and 700 metres would vanish from the record.
      dist: readNumber(dist) ?? 0,
      unit,
      watts: parseInt(watts, 10) || 0,
      kcal: parseInt(kcalIn, 10) || 0,
    });
    // True for 'stored' AND for 'unsent' — a queued session is held on this
    // device by the provider, so the form is no longer the only copy of it.
    if (!kept) return;
    setMins(''); setDist(''); setWatts(''); setKcalIn('');
  };
  const saveManual = async () => {
    // The day the picker is on, not the day it happens to be. This wrote
    // `new Date().toISOString()` regardless of which weekday was selected, so
    // somebody catching up on Thursday with Tuesday's session had it recorded
    // on Thursday: a calendar dot on a day they rested, none on the day they
    // trained, and a streak counted from the wrong end. `instantForDay` keeps
    // today's real clock time and stamps any other day at local midday — see
    // src/lib/entryEdit.ts for why not midnight.
    const dayISO = instantForDay(dstr(dateFor(dayIdx)));
    if (!dayISO) return;
    const nowISO = dayISO;
    let pr = false;
    const historyWhole = workoutLogStatus === 'ready';
    const entries: WorkoutEntry[] = [...exercises.filter((e) => !isRemovedEx(e)), ...customEx].map((e) => {
      const s = logged[uid(e)] || [];
      if (!s.length) return null;
      // Already kilograms — `LogRow` converted at the keyboard. Converting
      // again here would multiply a pounds member's load by 0.45 twice.
      const setPairs = s.map((x) => [parseInt(x.reps, 10) || 0, parseFloat(x.kg) || 0] as [number, number]);
      // On a bodyweight set the second number is what was ADDED to the person,
      // not the load — so the flags travel with the pairs or the pairs lie.
      const bwFlags = s.map((x) => x.bw === true);
      // And on a timed set the FIRST number is seconds rather than reps, which
      // is the other way the same pair can be read wrong. Both flags are
      // written together with the sets they describe or neither means anything.
      const timedFlags = s.map((x) => x.timed === true);
      // The PR claim below still ignores bodyweight sets, deliberately.
      // `priorBest1RM` lives in src/lib/progression.ts and reads a set's second
      // number as the load, so a pull-up's history reads as a run of zeros
      // there — and comparing a real bodyweight load against that would call
      // every single pull-up session a lifetime record, with confetti. The set
      // is stored, counted in the tonnage and eligible for the Records board;
      // only the mid-session claim waits for that function to learn about it.
      const bestE1 = Math.max(0, ...setPairs.map(([r, kg], i) => (r && kg && !bwFlags[i] && !timedFlags[i] ? est1RM(kg, r) : 0)));
      // The same guard SessionRunner carries, for the same reason, on the other
      // path into the same claim. `priorBest1RM` over an unread log returns 0
      // and EVERY set beats it, so a refused read turned an ordinary Tuesday
      // into "New personal record!" with confetti; over a truncated one
      // (src/lib/rowCap.ts) the record being compared against may simply be in
      // the part that did not come back. Only a whole read can establish that
      // something is a lifetime best — see the note at SessionRunner's
      // `historyWhole`, which this deliberately mirrors line for line.
      if (historyWhole && bestE1 > priorBest1RM(workoutLog, nameOf(e))) pr = true;
      // Absent, not an array of false. A row written without the column means
      // "nobody was asked", which is the honest state for every entry logged
      // before this existed and the one a screen already knows how to read.
      return {
        t: nowISO, exercise: nameOf(e), sets: setPairs,
        ...(bwFlags.some(Boolean) ? { bw: bwFlags } : {}),
        ...(timedFlags.some(Boolean) ? { timed: timedFlags } : {}),
      };
    }).filter(Boolean) as WorkoutEntry[];
    if (!entries.length) return;
    const out = await logWorkouts(entries);
    // The typed sets are cleared only when something durable is holding them.
    // They are the only other copy of what was entered, and throwing them away
    // on a refused write is how an hour's training disappears — the exact
    // complaint this screen was changed for. A QUEUED write is durable: the
    // provider has written the entries to this device and will send them.
    if (out === 'refused') {
      Alert.alert('Not Saved',
        'Your training log rejected this session, so it has not been recorded and it is not waiting to send. Your sets are still here — but saving them again as they are will be rejected again.',
        [{ text: 'OK' }]);
      return;
    }
    if (out === 'unsent') {
      setLogged({}); setCustomEx([]);
      Alert.alert('Saved on This Phone',
        `No connection, so ${entries.length === 1 ? 'this exercise has' : `these ${entries.length} exercises have`} not reached your training log yet — nothing is lost. They are saved here, they are listed below, and they go up on their own next time you have signal. Your streak, records and your coach's dashboard will not know about them until then.`,
        [{ text: 'OK' }]);
      return;
    }
    setLogged({}); setCustomEx([]);
    if (pr) setConfetti(true);
    // "Your streak and records are updated" was stated whatever the log's
    // status. Under anything but a whole read the boards downstream are drawn
    // from a prefix, so the promise is one this screen cannot keep — and the
    // absence of "New personal record!" is then an absence of evidence rather
    // than evidence of absence, which is worth saying out loud to somebody who
    // has just put a bar down.
    Alert.alert('Workout Saved',
      `${entries.length} exercise${entries.length === 1 ? '' : 's'} logged.${pr ? ' New personal record!' : ''} `
      + (historyWhole
        ? 'Your streak and records are updated.'
        : 'It is on your log. We could not read your full history just now, so we cannot say whether it set a record.'),
      [{ text: 'Nice' }]);
  };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10, flex: 1, ...ty.body } as const;

  // Rendered by `{showCal ? overlays : null}` inside the month sheet and by
  // `{!showCal ? overlays : null}` outside it — see the note at the second one.
  const overlays = (
    <>
      {editEntry ? (
        <EditEntrySheet
          t={t}
          unit={wu}
          suggestions={knownExercises}
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          // The sheet closes only once the server has the correction. It used
          // to close on the tap and drop the boolean, which is this codebase's
          // defining bug wearing a pencil icon: the calendar redrew with the
          // corrected sets, the day's volume followed, and the row still said
          // what it always had. `updateWorkout` now leaves `log` alone on
          // failure, so the sheet reopening on the old figures is the truth.
          onSave={async (patch) => {
            const saved = await updateWorkout(editEntry, patch);
            if (saved) {
              setEditEntry(null); tapLight();
              // ── why the log is re-read, and only here ──────────────────
              //
              // `amended_at` is stamped by the guard_workout_attribution
              // trigger, server-side, on an UPDATE the member makes to a row
              // their coach logged. `updateWorkout` applies the caller's own
              // patch to the in-memory entry and never sees the stamp —
              // `PERSISTED_FIELDS` deliberately excludes it — so the caption
              // went on reading "Logged by Dave" with no mark on it until the
              // next cold launch. The member was shown a correction the app was
              // still presenting as the coach's untouched account.
              //
              // Only for a coach-logged row: everything else has nothing to
              // fetch, and a re-read of the whole log on every pencil tap is a
              // round trip and a re-render for nothing.
              if (editEntry.loggedBy) { reloadLog(); coachLogQueries.reload(); }
            }
            return saved;
          }}
        />
      ) : null}
      <SessionHrSheet
        visible={!!hrEntry}
        onClose={() => setHrEntry(null)}
        title={hrEntry?.exercise || ''}
        startISO={hrEntry?.t || new Date().toISOString()}
        durationMin={hrEntry ? (hrEntry.cardio?.mins || Math.max(20, (hrEntry.sets?.length || 0) * 4)) : 45}
        age={ageFromDob(cd.dob)}
      />
    </>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView ref={pageScroll} refreshControl={pull} contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header ───────────────────────────────────────────────────────
            Whose plan this is stays the eyebrow here. The program's own name
            is the eyebrow ON the hero, and nowhere else on it. */}
        <ScreenHeader eyebrow={coachProgram ? 'Coach plan' : 'Your training'} title="My Program" />

        {/* Current and past, as the mockup draws them: above the card. Past is
            the training history screen, which already exists and already
            answers it — so that segment GOES somewhere and never draws as
            selected, which is what `onPress` on a Segment is for. */}
        <Segmented
          options={[
            { key: 'current', label: 'Current' },
            { key: 'past', label: 'Past', a11yLabel: 'Past workouts', onPress: () => router.push('/(client)/history') },
          ]}
          value="current" onChange={() => {}} style={{ marginTop: sp.lg }} />

        {/* ── the hero: the SELECTED DAY, and only that day ─────────────────
            Everything on this card is about one day — the one picked on the
            strip below, today until somebody picks another — the way Home's
            hero is about today. The Sora line is that day's own name as the
            program stores it; the picture is that day's first movement that
            has one; the meta is that day's counts; the chips under it are that
            day's muscle groups; Start begins that day. They all read `dayIdx`,
            so they move together.

            It used to lead with the PROGRAM's name, which on "Push · Pull ·
            Legs" put three day types over a bench press and a row of Push
            chips — a card contradicting itself. The program is the eyebrow
            now and appears nowhere else on the card.

            Every gate on Start came with it: the unsent-work note, the injury
            read, and the three reasons it may be withheld. */}
        <View style={{ marginTop: sp.lg, minHeight: grown(210), borderRadius: radius.xl, overflow: 'hidden', backgroundColor: t.night, ...elevation.hero }}>
          {exercises.length ? (
            <View style={{ paddingHorizontal: sp.md }}>
              <DayPicture t={onNight(t)} names={exercises.map(nameOf)} videos={exVideos} videoStatus={exVideoStatus} preferTrainerId={coachId} />
            </View>
          ) : (
            <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}
              accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Icon name="train" size={34} color={t.brandBright} />
            </View>
          )}
          {/* The words over the picture, on a scrim, as the mockup draws them.
              The scrim is what makes the night inks readable over any frame;
              the same sentence is spoken once, from the group. */}
          <View accessible accessibilityLabel={`${program.title}${blockCounted ? `, week ${blk.week.index + 1} of ${blk.week.count}` : ''}. ${dayTitle}. ${cardDay}, ${exercises.length === 1 ? '1 exercise' : `${exercises.length} exercises`}, ${heroNote}`}
            style={{ position: 'absolute', start: 0, end: 0, bottom: 0, paddingHorizontal: 18, paddingTop: sp.lg, paddingBottom: sp.lg, backgroundColor: 'rgba(0,0,0,0.62)' }}>
            {/* The program, and the week of it — the week only when it was
                COUNTED from a start date the coach set. A block with no date,
                an unreadable one or one not yet begun sits on week one by
                default, and "week 1 of 12" over a progress bar would draw that
                default as a measured position. The sentence under the block
                strip below says which of those it is. Capitals because every
                hero eyebrow in the app is set in them; the locale's own rule,
                so a dotted i stays one. */}
            <Text style={{ ...ty.eyebrow, color: t.nightInk3 }} numberOfLines={2}>
              {program.title.toLocaleUpperCase()}{blockCounted ? ` · WEEK ${blk.week.index + 1} OF ${blk.week.count}` : ''}
            </Text>
            <Text style={{ ...ty.title, color: t.nightInk, marginTop: 6 }} numberOfLines={2}>{dayTitle}</Text>
            {/* The same week as a bar. The words are in the eyebrow, so the bar
                carries none of its own. */}
            {blockCounted ? (
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                style={{ height: 6, borderRadius: 3, backgroundColor: t.night2, overflow: 'hidden', marginTop: sp.sm }}>
                <View style={{ width: `${Math.round(((blk.week.index + 1) / blk.week.count) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: t.brandBright }} />
              </View>
            ) : null}
            {/* Two lines allowed: the day, the two counts and what is already
                done is four facts, and at large text a single line cut the
                last of them off — which is the one that changes. */}
            <Text style={{ ...ty.caption, ...numeric, color: t.nightInk2, marginTop: sp.sm }} numberOfLines={2}>
              {cardDay} · {exercises.length === 1 ? '1 exercise' : `${exercises.length} exercises`} · {heroNote}
            </Text>
          </View>
        </View>

        {/* What the selected day trains, as chips — and nothing else. No chip
            repeats the day's name, and no chip names a group that no movement
            in the day trains: they are read off the day's own exercise rows
            (the coach's builder writes each row's group from the catalogue
            when the movement is added), never off the day's title. So a day a
            coach called "Push" that holds a row shows Back beside Chest — the
            name stays as the coach wrote it and the chips say what is in it.
            The 615-row catalogue is still not read on a screen used in
            basements; see `knownMovements`. A colour per group, the same one
            its bar takes below, and always beside the word. */}
        {dayGroups.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
            {dayGroups.map((g) => <TonedChip key={g} label={g} tone={groupTone(g)} />)}
          </View>
        ) : null}

        <View style={{ marginTop: sp.md }}>
        {/* What is on this phone and nowhere else.
            Standing here, above the Start button, for the reason the food log
            and the check-in put theirs at the top of their screens: it is the
            answer to "did that actually send?", and somebody who cannot find
            the answer logs the session a second time. `unsentNote` is the one
            wording for it across all four stores — see the note on it in
            src/lib/offlineQueue.ts, which is careful that the work reads as
            SAFE without reading as delivered.
            Counted in exercises, which is what an entry is: one row per
            movement, holding all of its sets. */}
        {unsentNote(unsentWorkouts, 'exercise') ? (
          <Flag tone={t.warn} style={{ marginTop: sp.md }}>
            {unsentNote(unsentWorkouts, 'exercise')} Until then your streak, your records and your coach's dashboard are short of them.
          </Flag>
        ) : null}
        {/* Above the Start button, because it is a fact about the plan behind
            that button. Two arms, and neither of them is silence: a read still
            in flight is not the same answer as one that failed, and neither is
            the same as "we checked and there is nothing to avoid" — which is
            what this screen used to draw for all three. See `injRead`. */}
        {injLoading ? (
          <Flag tone={t.ink3} style={{ marginTop: sp.md }}>
            Reading what you have disclosed — nothing below has been checked against your injuries yet.
          </Flag>
        ) : !injRead ? (
          <Notice tone={t.crit} kicker="Injury" title="Your Injuries Could Not Be Read"
            note="So nothing in today's plan has been swapped or held back for them, and no movement below carries a caution. This is a connection problem, not a clean sheet — if something is hurt, take it easy on it or skip it, and pull down to try again." />
        ) : null}
        {start.canStart ? (
          <Cta label="Start Workout" wide onPress={() => { const at = Date.now(); setResumeAt(null); rememberSession({ kind: 'guided', startedAt: at }); void startLiveActivity(workout.focus || 'Workout', at); setSession(true); }} />
        ) : start.note && start.safety ? (
          // A heading rather than a footnote, because this one is the app
          // having taken today's session away from them for their own safety.
          <Notice tone={t.crit} kicker="Injury" title="Today's Session Is on Hold" note={start.note} />
        ) : start.note ? (
          <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.md }}>{start.note}</Text>
        ) : null}
        </View>
        {/* ── directly under Start Workout, and moved here on purpose ──────
            Asked for by the owner, passed on from a member: "build work out
            should be just below the start workout tab." It was a row in the
            destinations list at the foot of this screen, five sections down,
            beside Ready-Made Programs.

            The reason it belongs here rather than there is the question it
            answers. Start Workout runs the session the coach wrote. The member
            who does not want that one — wrong day, wrong equipment, wants arms
            — is looking at that button at the moment they decide, and this is
            the other answer to the same question. A member who has no coach
            plan at all sees Start Workout withheld with its reason, and this
            immediately under it. */}
        <View style={{ marginTop: sp.sm }}><Ghost label="Build a Workout" icon="dumbbell" onPress={() => router.push('/(client)/build-workout')} /></View>
        <View style={{ marginTop: sp.sm }}><Ghost label="View Program" icon="grid" onPress={() => router.push('/(client)/week')} /></View>

        {/* ── whose copy of the coach's plan is being trained ──────────────
            The kicker directly above says "Coach plan" the moment `getProgram`
            returns something, and `getProgram` returns this device's copy when
            no read has landed — for up to THIRTY DAYS (PROGRAM_HORIZON_MS in
            src/lib/programCache.ts). This is the screen the session is
            actually trained from, so a block the coach replaced a fortnight
            ago renders here identically to one confirmed a second ago, under
            the same two words, with the "couldn't check" notice below
            suppressed BY the cache — because the cache is what made
            `coachProgram` non-null. The one signal that anything is stale was
            removed by the thing that made it stale.

            `cachedNote` is non-null for precisely as long as the copy is what
            is being served — `mayServeCached` decides that — so it needs no
            gate of its own and disappears the moment a live read lands.
            app/(client)/week.tsx :194 and app/(trainer)/client-week.tsx :437
            render the same sentence in the same position over the same
            program. The plan is NOT withheld: the cache exists so the member
            can train in a basement. This labels it. */}
        {cachedNote ? <Flag tone={t.warn} style={{ marginTop: sp.lg }}>{cachedNote}</Flag> : null}

        {/* The sentence that stops a generated session passing for the coach's.
            Everything below this line — the day strip, the plan rows, Start
            Workout — is drawn from `program`, and when the read did not land
            that is the automatic program wearing the same layout. */}
        {programUnknown ? (
          <View style={{ marginTop: sp.lg }}>
            {programStatus === 'loading' ? (
              <Notice tone={t.ink3} kicker="Your Plan" title="Still Checking for a Coach Plan"
                note={`Today’s session below is ${BRAND.label}'s automatic program. If your coach has assigned you one it takes over as soon as it lands.`} />
            ) : (
              <Notice tone={t.warn} kicker="Your Plan" title="We Couldn’t Check for a Coach Plan"
                note={`Today’s session below is ${BRAND.label}'s automatic program, not one your coach wrote. If your coach has assigned you one it takes over as soon as we can read it — open this screen again when you have signal.`} />
            )}
          </View>
        ) : null}

        {/* ── muscle focus this week ───────────────────────────────────────
            The evidence under the hero: what the week they are on asks of each
            muscle group, as sets — the plan's own rows through `setCount`, so a
            coach's set table counts as the sets it holds. PLANNED, and the
            head says so: what was actually done is a different read (the log,
            joined to the catalogue) and lives on Your Muscles, which the head
            opens. The bars are scaled to the week's biggest group, so they
            compare groups with each other and claim nothing about a target
            nobody set. Absent on a plan with no grouped movements rather than
            drawn empty. */}
        {weekFocus.length ? (
          <Section>
            <SectionHead title="Muscle Focus This Week" note="Planned sets" onPress={() => router.push('/(client)/muscles')} />
            {weekFocus.map(([g, n]) => (
              <Meter key={g} label={g} val={n} target={weekFocus[0][1]} tone={groupTone(g)} note={n === 1 ? '1 set' : `${n} sets`} />
            ))}
          </Section>
        ) : null}

        {/* ── day strip ──────────────────────────────────────────────────── */}
        {/* Which week these seven days are, and the way out of it. Before this
            the strip named no week at all, because there was only ever one it
            could be showing. Now that it can move, saying so is not decoration:
            a member looking at "12–18" needs to know those are not this week's
            numbers before they log a session onto one of them. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.lg }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous week"
            onPress={() => { setWeekOffset((w) => w - 1); tapLight(); }}
            hitSlop={hitSlopFor(34)}
            style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface2 }}>
            <Icon name={BACK_ICON} size={15} color={t.ink2} />
          </Pressable>
          <Text style={{ ...ty.micro, color: t.ink3, flex: 1, textAlign: 'center' }}>{weekLabel}</Text>
          {/* Absent rather than disabled on the current week. A greyed arrow is
              a control that says "not now"; there is no later week to go to and
              there never will be from here. */}
          {weekOffset < 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Next week"
              onPress={() => { setWeekOffset((w) => Math.min(0, w + 1)); tapLight(); }}
              hitSlop={hitSlopFor(34)}
              style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface2 }}>
              <Icon name={FORWARD_ICON} size={15} color={t.ink2} />
            </Pressable>
          ) : <View style={{ width: 34 }} />}
        </View>
        <View style={{ flexDirection: 'row', gap: 5, marginTop: sp.sm }}>
          {WEEK.map((d, i) => {
            const on = i === dayIdx; const today = i === todayIdx && weekOffset === 0; const dnum = dateFor(i).getDate();
            // A day is "trained" only when the log was read whole. Anything a
            // draft on this phone puts into `workedDates` is still known — it
            // is on the device — so an unread day is one with nothing local
            // either, and it is drawn as unknown rather than as a rest day.
            const worked = workedDates.has(dstr(dateFor(i)));
            const drafted = !worked && draftDates.has(dstr(dateFor(i)));
            const unknown = !logKnown && !worked && !drafted;
            return (
              <Pressable key={d} onPress={() => setDayIdx(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${dateFor(i).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${today ? ', today' : ''}${worked ? ', trained' : drafted ? ', typed but not saved' : unknown ? ', not read' : ''}`}
                style={{ flex: 1, paddingVertical: sp.sm, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.surface2 : 'transparent' }}>
                <Text style={{ ...ty.micro, letterSpacing: 0.3, color: on ? t.ink : today ? t.ink2 : t.ink3 }}>{d}</Text>
                <Text style={{ ...value(16), color: on ? t.ink : t.ink2, marginTop: 2 }}>{dnum}</Text>
                {/* Four states, and the difference between the first two is the
                    point: trained (in the log), typed but not saved, not read,
                    and nothing. Only the first is a filled brand dot. */}
                <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 5,
                  backgroundColor: worked ? t.brand : 'transparent',
                  borderWidth: drafted || unknown ? 1 : 0, borderColor: drafted ? t.warn : t.ink3 }} />
              </Pressable>
            );
          })}
        </View>
        {/* The marks above are only as good as the read behind them. A member
            standing in a gym with no signal sees a week of empty days, which is
            the same picture as a week they did not train — and this is the
            screen people open standing in a gym, where the signal is worst. */}
        {!logKnown ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            {workoutLogStatus === 'loading'
              ? 'Reading your log — the marks above are not complete yet.'
              : workoutLogStatus === 'partial'
              ? 'Your log goes further back than this screen can read in one go, so days with no mark above may still have sessions in them.'
              : 'Your log could not be read, so a day with no mark above is a day we could not see rather than a day you did not train. Pull down to try again.'}
          </Text>
        ) : null}

        {/* One tap back, from anywhere. Six taps on an arrow to get home from
            March is the kind of thing people simply do not do. */}
        {weekOffset !== 0 ? (
          <View style={{ alignItems: 'center', marginTop: sp.sm }}>
            <Ghost label="Back to This Week" onPress={() => { setWeekOffset(0); setDayIdx(todayIdx); tapLight(); }} />
          </View>
        ) : null}

        {/* ── the block ──────────────────────────────────────────────────── */}
        {/* Drawn only for a program of more than one week, so a plan written
            before blocks existed looks exactly as it did, with no week number
            anywhere on the screen.

            Every week is TAPPABLE, and that is the whole answer to the question
            a start date now raises. The date decides which week opens; it does
            not lock the others away. A client can read week eight in week one,
            and the line underneath says which week is theirs so that looking
            ahead can never be mistaken for having been moved on. */}
        {blk.weeks.length > 1 ? (
          <View style={{ marginTop: sp.lg }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your Block</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: sp.sm, paddingVertical: sp.sm, paddingEnd: sp.md }}>
              {blk.weeks.map((w, i) => {
                const on = i === viewWeek;
                const mine = i === blk.week.index;
                // The coach's own name for the week where they wrote one, and
                // the position where they did not. A deload is named in the
                // label rather than tinted, because colour is never the only
                // channel carrying meaning here.
                const label = blockWeekLabel(w, i + 1);
                return (
                  <Pressable key={`${i}-${label}`} onPress={() => { setWeekPick(i === blk.week.index ? null : i); tapLight(); }}
                    accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={`${label}${mine ? ', the week you are on' : ''}`}
                    // The chip is around 35pt tall at the default text size and
                    // grows with it. The slop is what carries it past 44 at the
                    // smallest, without a row of pills tall enough to push the
                    // day strip off the first screen.
                    hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: sp.md, paddingVertical: 9,
                             borderRadius: radius.pill, borderWidth: hairline,
                             borderColor: on ? t.ring : 'transparent', backgroundColor: on ? t.surface2 : 'transparent' }}>
                    {/* A dot, not a colour on the word: the week that is theirs
                        has to be findable without reading a tint. */}
                    {mine ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} /> : null}
                    <Text style={{ ...ty.label, ...font(on ? '600' : '400'), color: on ? t.ink : t.ink3 }}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {blockLine ? <Text style={{ ...ty.caption, color: t.ink3 }}>{blockLine}</Text> : null}
            {/* What the coach wanted said about THIS week. A different thing
                from the note at the top of the program, which is read once:
                this one is read on the Monday of week four, which is why it
                lives on the week. Attributed, for the reason the exercise note
                is: rendered bare it would read as the app telling somebody how
                to train. */}
            {weekOnScreen?.note ? (
              <View style={{ marginTop: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
                <Text style={{ ...ty.micro, color: t.ink3 }}>From Your Coach</Text>
                <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{weekOnScreen.note}</Text>
              </View>
            ) : null}
            {viewWeek !== blk.week.index ? (
              <View style={{ alignItems: 'flex-start', marginTop: sp.sm }}>
                <Ghost label="Back to Your Week" onPress={() => { setWeekPick(null); tapLight(); }} />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── the hero: today's session, one number ───────────────────────── */}
        <ScreenHelp screen="train" />


        {/* Calendar, booking and the tip are useful context and secondary to
            choosing and starting today's session. They used to sit above the
            day strip, so a returning member scanned past three unrelated
            controls before they could train; they follow the primary action
            now. Wrapped, not squeezed, at the larger text sizes. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.lg }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Ghost label="Month Calendar" icon="calendar" onPress={() => { setSelCalDay(dstr(dateFor(dayIdx))); setCalShift(0); setShowCal(true); }} />
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Ghost label="Book Session" icon="plus" onPress={() => router.push('/(client)/calendar')} />
          </View>
        </View>
        {/* One tip, at most once every twenty hours. Renders nothing the rest
            of the time — asked for as "once a workout session or once few
            days", and a card that greets you every visit is an interruption. */}
        <View style={{ marginTop: sp.lg }}>
          <DidYouKnow />
        </View>


        {/* ── what you're logging ────────────────────────────────────────── */}
        <Section>
          {/* Modes are choices, not fixed-width columns. Six on one row
              forced the widest label — "Mobility" — under the size it needs
              at 13pt on a 375pt phone, and the fix was to shrink the type
              below the member's chosen size. Each pill keeps its label whole
              and the group wraps to a second line when it needs one; every
              pill is 44pt tall, so no slop is needed to reach the target. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: layout.section }}>
            {WTYPES.map(([id, label]) => {
              const on = mode === id;
              return (
                // What this screen is logging, and the quietest selection mark
                // in the app: `t.surface2` against a transparent ground, with
                // a half-step of font weight. Nothing else on the row says
                // which of the six is live, and the form below — sets and
                // reps, or distance and time — changes completely with it. A
                // member who picks wrong logs a run as a lift.
                <Pressable key={id} onPress={() => { setMode(id); if (isSessionKind(id)) setCtype(SESSION_TYPES[id][0]); }}
                  accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
                  style={{ minHeight: 44, paddingHorizontal: sp.md, paddingVertical: 10, borderRadius: radius.pill,
                    alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.surface2 : 'transparent' }}>
                  <Text style={{ ...ty.label, ...font(on ? '500' : '400'), color: on ? t.ink : t.ink3 }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'strength' ? (
            <View>
              {/* Loads on this screen are typed and read in the member's unit
                  and stored in kilograms, so their coach's console and this
                  will show the same set two different ways. Said once, here,
                  rather than beside every figure — and not at all for the
                  metric majority, who are reading the record itself. */}
              {loadNote ? <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{loadNote}</Text> : null}
              {deload.due && !deloadDismiss ? (
                <Notice tone={t.s3} kicker="Recovery" title="Time for a Deload Week"
                  note={`${deload.reason} Drop to ~60% of your usual sets or weight this week.`}>
                  <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                    <Ghost label="Dismiss" onPress={() => setDeloadDismiss(true)} />
                  </View>
                </Notice>
              ) : null}
              {cd.focusAreas.length > 0 ? (
                <Notice tone={t.brand} kicker="From Your Progress Photo" title={`Emphasising ${cd.focusAreas.join(' · ')}`}
                  note="These moves come first today.">
                  <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                    <Ghost label="Clear" onPress={() => cd.setFocusAreas([])} />
                  </View>
                </Notice>
              ) : null}

              {planRows.map((e, ei) => {
                const _id = uid(e);
                if (isInjHidden(e)) {
                  const inj = injuryFlag(e.name, e.group, cd.injuries);
                  return (
                    <View key={e.key}>
                      {ei > 0 ? <Rule /> : null}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.lg }}>
                        <Icon name="heart" size={15} color={t.crit} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ ...ty.body, ...font('500'), color: t.ink3, textDecorationLine: 'line-through' }} numberOfLines={1}>{movement(e.name)}</Text>
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Hidden to protect your {inj ? areaLabel(inj.injury.area).toLowerCase() : 'injury'} (severe) — no safe swap in your plan.</Text>
                        </View>
                        <Ghost label="Show Anyway" onPress={() => setInjRevealed((prev) => [...prev, _id])} />
                      </View>
                    </View>
                  );
                }
                const sets = logged[_id] || []; const done = sets.length >= e.sets;
                const sug = suggestForExercise(workoutLog, nameOf(e), e.reps, 2.5, wu);
                const flag = injuryFlag(nameOf(e), e.group, cd.injuries);
                const autoFrom = injAutoMap[_id];
                const open = expanded[_id] ?? (_id === firstOpenId);
                const isCustom = e.key.indexOf('custom-') === 0;
                // Which run this row is in, read positionally off the list being
                // rendered, and null when the movement stands on its own — an
                // ungrouped exercise shows nothing.
                const grp = rowGroups[ei];
                const sameRunAbove = ei > 0 && !!grp && rowGroups[ei - 1]?.id === grp.id;
                // How the sets are performed. Null for an ordinary set AND for
                // an id this build does not know (see badgeFor), so nothing here
                // can put a marker on screen that nobody could read.
                const meth = badgeFor(e.method);
                // The sets as planned. One row per set, from the coach's table
                // when there is one and from `sets` copies of the single spec
                // when there is not — which is every program already on a
                // phone, and which draws exactly what it drew before.
                const planned = expandSets(e);
                // Whether those rows actually differ from each other. A ramp is
                // worth the space; three identical lines under a row that
                // already says "3 sets · 42.5 kg" is the same sentence twice.
                // Whether those rows actually differ. The intensity is part of
                // that test now: a coach who writes 4 × 6 at one load and ramps
                // the effort from @7 to @9 across the four has written a real
                // ramp, and without this the table stayed shut and the three
                // different targets rendered nowhere.
                const varied = hasSetRows(e) && planned.some((r) => r.reps !== planned[0].reps || r.loadKg !== planned[0].loadKg || r.method !== planned[0].method
                  || intensityLine(r.intensity) !== intensityLine(planned[0].intensity));
                /**
                 * Effort, share of a max and rep speed, grouped by the sets
                 * that share them.
                 *
                 * One entry for the ordinary case, where the movement carries
                 * the prescription and every set inherits it; more where the
                 * coach wrote different targets on different rows. Grouping
                 * rather than one line per set is what keeps "RPE 8 means about
                 * 2 reps left" from being printed four times under one
                 * movement.
                 *
                 * `intensityOf` has already resolved absent-inherits-present
                 * inside `expandSets`, so nothing here re-implements that rule.
                 */
                const intGroups = (() => {
                  const out: { key: string; sets: number[]; words: string[] }[] = [];
                  for (const r of planned) {
                    const key = intensityLine(r.intensity);
                    if (!key) continue;
                    const hit = out.find((g) => g.key === key);
                    if (hit) hit.sets.push(r.n);
                    else out.push({ key, sets: [r.n], words: intensityMeaning(r.intensity) });
                  }
                  return out;
                })();
                // The one notation that describes the whole movement, or null
                // where the sets disagree — in which case the table above
                // carries them row by row and a single line here would be a
                // summary that is wrong for three sets out of four.
                const intOne = intGroups.length === 1 ? intGroups[0].key : null;
                return (
                  <View key={e.key}>
                    {/* No hairline between two members of one run: they are
                        performed back to back, and a rule across them would cut
                        in half the one thing their badges are saying. */}
                    {ei > 0 && !sameRunAbove ? <Rule /> : null}
                    <View style={grp
                      ? { paddingVertical: sp.lg, borderStartWidth: 2, borderStartColor: t.brand, paddingStart: sp.md, marginStart: 1 }
                      : { paddingVertical: sp.lg }}>
                      {/* The badge, above the movement it labels and only on a
                          row that is really in a run. The words are DERIVED from
                          the size of that run — two is a superset, three a
                          tri-set, four or more a giant set — so it cannot
                          disagree with the movements underneath it. ty.caption
                          rather than ty.micro, which renders uppercase: this is
                          a sentence about two exercises, not a column heading. */}
                      {grp ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.brand }} />
                          <Text style={{ ...ty.caption, ...font('500'), color: t.brandText }}>{grp.label} · {grp.position} of {grp.size}</Text>
                        </View>
                      ) : null}
                      {/* The whole row is one button, so anything rendered
                          INSIDE it is read out as part of its label rather than
                          on its own — which is why the method is spelled out
                          here in full. The chip below is a short marker for the
                          eye; this is the only version a screen reader gets.
                          The group badge is a sibling, above, and is read on its
                          own, so it is not repeated here. */}
                      <Pressable accessibilityRole="button" accessibilityLabel={(open ? 'Collapse ' : 'Expand ') + shownName(e) + (meth ? `, ${meth.label.toLowerCase()}` : '')} onPress={() => setExpanded((p) => ({ ...p, [_id]: !open }))} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {done ? <Icon name="check" size={15} color={t.brand} /> : null}
                            <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize' }} numberOfLines={1}>{shownName(e)}</Text>
                            {meth ? (
                              <View style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ ...ty.caption, ...font('600'), color: t.ink2 }}>{meth.short}</Text>
                              </View>
                            ) : null}
                            {cd.focusAreas.includes(e.group) ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.brand }} />
                                <Text style={{ ...ty.micro, color: t.ink3 }}>Focus</Text>
                              </View>
                            ) : null}
                            {flag ? <Icon name="heart" size={13} color={t.s3} /> : null}
                          </View>
                          {/* A target load set by hand is the member's own
                              instruction and outranks the app's suggestion, so
                              it is what the row shows. Without this the weight
                              could be typed and then never appear anywhere. */}
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{e.group} · {sets.length}/{planned.length} sets{e.loadKg != null && !varied ? ' · ' + fig(liftLabel(e.loadKg, wu)) : (!open && !varied && sug ? ' · ' + fig(liftLabel(sug.weight, wu)) : '')}</Text>
                          {/* How hard, at what share of a max, at what speed.
                              The coach could write all three and none of them
                              reached this screen — they went in the exercise
                              note as prose, for all four sets at once, or
                              nowhere. On its own line rather than appended to
                              the one above, because it is a prescription and
                              not a description of the row. */}
                          {intOne ? (
                            <Text style={{ ...ty.caption, ...numeric, color: t.ink2, marginTop: 2 }}>{intOne}</Text>
                          ) : null}
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel={'Remove ' + shownName(e)} onPress={() => removeExercise(e)} hitSlop={8} style={{ padding: 4 }}><Icon name="minus" size={16} color={t.ink3} /></Pressable>
                        <View style={{ transform: [{ rotate: turn(open ? 90 : 0) }] }}><Icon name={FORWARD_ICON} size={16} color={t.ink3} /></View>
                      </Pressable>
                      {sets.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: sp.md, alignItems: 'center' }}>
                          {sets.map((s, i) => (
                            <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5 }}>
                              {/* A blank load is a bodyweight set, and stays a
                                  dash rather than becoming "0" — see readLift. */}
                              {/* A hold is printed as a clock and never as
                                  "45×", which is what a reps chip would say
                                  about a plank the app itself asked for. */}
                              <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>
                                {s.timed
                                  ? `${holdLabel(Number(s.reps) || 0)}${s.kg === '' ? '' : ` × ${fig(liftIn(Number(s.kg), wu))} ${wu}`}`
                                  : `${s.reps}×${fig(liftIn(s.kg === '' ? null : Number(s.kg), wu))} ${wu}`}
                              </Text>
                            </View>
                          ))}
                          {/* ── the one control here that threw work away ────
                              A 27pt tap with no role, no label and no
                              confirmation, discarding every set typed against
                              this movement — beside a sibling control (Remove,
                              above) that asks first and says what it discards.
                              It now has all three: a target that clears
                              MIN_TARGET, a name a screen reader can read, and
                              the same question its sibling asks. */}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Clear the sets you logged for ${shownName(e)}`}
                            hitSlop={hitSlopFor(27)}
                            onPress={() => Alert.alert(
                              'Clear These Sets?',
                              `The ${(logged[_id] || []).length} set${(logged[_id] || []).length === 1 ? '' : 's'} you have typed against ${shownName(e)} today are discarded. Nothing else on your plan changes.`,
                              [
                                { text: 'Keep Them', style: 'cancel' },
                                { text: 'Clear', style: 'destructive', onPress: () => { setLogged((prev) => { const n = { ...prev }; delete n[_id]; return n; }); tapLight(); } },
                              ],
                            )}
                            style={{ paddingHorizontal: 4 }}>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>Clear</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {open ? (
                        <View>
                          {autoFrom ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
                              <Icon name="swap" size={13} color={t.brand} />
                              <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>Auto-swapped from {movement(e.name)} to protect you</Text>
                            </View>
                          ) : null}
                          {/* ── what the coach actually wrote, set by set,
                                 with a box beside each one ────────────────
                              A single "3 × 8-10 at 42.5" cannot say that set
                              one is a warm-up and set three is five kilos
                              heavier, and for a long time that is all this row
                              could say. The table was then drawn only where the
                              sets DIFFERED, on the argument that three
                              identical rows repeat the line above.

                              That argument held while the rows only described
                              the plan. It stops holding now they are the
                              control that logs it — "a tick box to log sets
                              been completed", from the same TestFlight report
                              as the per-set weights. A member cannot tick off a
                              set that is not on screen, so every movement with
                              a plan gets its rows and the line above them
                              counts down.

                              Loads are converted at this boundary and nowhere
                              earlier — what is stored is kilograms. */}
                          {planned.length ? (
                            <View style={{ marginTop: sp.md }}>
                              <SetChecklist
                                t={t} ticks={setTicks(planned, sets.length)} movement={shownName(e)}
                                line={ticksLine(planned.length, sets.length)}
                                askFor={(n) => {
                                  const r = planned[n - 1];
                                  if (!r) return { text: '', loadText: null };
                                  return {
                                    text: `${r.reps}${r.loadKg != null ? ' × ' + fig(liftLabel(r.loadKg, wu)) : ''}`,
                                    loadText: r.loadKg != null ? liftLabel(r.loadKg, wu) : null,
                                  };
                                }}
                                onTick={(_n, rec) => tickPlannedSet(e, rec)}
                                onUntick={() => untickLastSet(e)}
                                extraFor={(n) => {
                                  const r = planned[n - 1];
                                  if (!r) return null;
                                  const rb = badgeFor(r.method);
                                  const iline = intensityLine(r.intensity);
                                  if (!rb && !iline) return null;
                                  return (
                                    <>
                                      {rb ? (
                                        <Text accessibilityLabel={rb.label} style={{ ...ty.caption, ...font('600'), color: t.ink3 }}>{rb.short}</Text>
                                      ) : null}
                                      {/* This set's own effort, share and tempo.
                                          A warm-up single at @6 and a top set at
                                          @9 are two different instructions and
                                          this is the only row that can hold
                                          both. */}
                                      {iline ? (
                                        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{iline}</Text>
                                      ) : null}
                                    </>
                                  );
                                }} />
                            </View>
                          ) : null}
                          {/* ── the notations, in words ────────────────────
                              "@8" and "3-1-1-0" are a coach's shorthand and
                              this may be the first time the person reading it
                              has seen either. `intensityMeaning` spells them
                              out: RPE as reps in reserve, which is the only
                              phrasing somebody under a bar can act on, and the
                              tempo in the order this app stores it, which is
                              the whole defence against the minority convention
                              that writes the lifting phase first.

                              The percentage stays a percentage. It says so, and
                              it says why: nothing in this app holds a tested
                              one rep max, so a figure in kilograms here would
                              be weight on a bar derived from an estimate
                              nobody made. */}
                          {intGroups.length ? (
                            <View style={{ marginTop: sp.md }}>
                              {intGroups.map((g) => (
                                <View key={g.key} style={{ marginTop: sp.xs }}>
                                  {intGroups.length > 1 ? (
                                    <Text style={{ ...ty.micro, color: t.ink3 }}>
                                      {`Set${g.sets.length === 1 ? '' : 's'} ${g.sets.join(', ')} · ${g.key}`}
                                    </Text>
                                  ) : null}
                                  {g.words.map((line) => (
                                    <Text key={line} style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{line}</Text>
                                  ))}
                                </View>
                              ))}
                            </View>
                          ) : null}
                          {/* The coach's own words on this movement, in the row
                              as well as in the session — a client planning
                              their day reads it here, and a client at the
                              machine reads it in SessionRunner. Attributed for
                              the reason given there, and withheld once the
                              movement has been swapped: a cue about a back
                              squat is not advice about the leg press. */}
                          {e.note && nameOf(e) === e.name ? (
                            <View style={{ marginTop: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
                              <Text style={{ ...ty.micro, color: t.ink3 }}>From Your Coach</Text>
                              <Text style={{ ...ty.caption, color: t.ink2, marginTop: 2 }}>{e.note}</Text>
                            </View>
                          ) : null}
                          {flag ? (
                            <Pressable onPress={() => setSwapFor(e)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
                              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
                              <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{flag.reason} · tap to swap</Text>
                            </Pressable>
                          ) : null}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.md }}>
                            {sug ? (
                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                                <Icon name="target" size={14} color={t.brand} />
                                <Text style={{ ...value(15), color: t.ink }}>{fig(liftLabel(sug.weight, wu))}</Text>
                                {sug.up ? <Text style={{ ...ty.label, ...font('500'), color: t.brandText }}>↑</Text> : null}
                                <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }} numberOfLines={1}>{sug.reason}</Text>
                                {/* Tap the suggestion to take it. The row it
                                    fills in is still below, so a different
                                    weight is still one edit away. */}
                                {/* Only where one tap can say what was done.
                                    The label names the figure that will be
                                    written rather than repeating the
                                    prescription, so the spoken sentence and the
                                    row it creates are the same set. */}
                                {canQuickLog(e) ? (
                                  <Pressable accessibilityRole="button"
                                    accessibilityLabel={prescribedSeconds(e.reps) != null
                                      ? `Log a ${prescribedSeconds(e.reps)} second hold of ${shownName(e)}`
                                      : `Log ${quickReps(e.reps)} reps at ${fig(liftLabel(sug.weight, wu))} of ${shownName(e)}`}
                                    onPress={() => quickLog(e)}
                                    style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 6 }}>
                                    <Text style={{ ...ty.caption, ...font('600'), color: t.brandText }}>Log This</Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            ) : <View style={{ flex: 1 }} />}
                            {/* Opens the movement's own screen — the animation, the steps,
                                the tips — rather than a sheet holding only a coach clip.
                                That screen already answers "what does this look like" in
                                order: the client's coach, the Academy, the bought
                                animation, the reference frames. Back returns here.

                                Offered for a movement the user typed in themselves too. A
                                custom exercise mints its own catalogue slug the first time
                                a clip is recorded against it, so "Kettlebell Windmill" can
                                genuinely have a demo — hiding the button meant a client
                                whose coach had filmed exactly that could never reach it. */}
                            <Pressable accessibilityLabel={'Watch a demonstration of ' + shownName(e)} accessibilityRole="button" onPress={() => router.push({ pathname: '/(client)/exercise', params: { name: nameOf(e), from: 'clientWorkouts' } })} hitSlop={hitSlopFor(38)} style={{ width: 38, height: 38, backgroundColor: t.surface2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }}><Icon name="video" size={15} color={t.ink2} /></Pressable>
                            {/* A pencil on every row. It used to be a pencil
                                only on exercises the member had typed, and a
                                SWAP arrow on everything the coach had planned —
                                so on a real program there was no way to
                                change the sets, the reps or the load at all.
                                Swapping the movement is a different intention
                                and keeps its own button beside this one. */}
                            <Pressable accessibilityRole="button" accessibilityLabel={'Edit sets, reps and weight for ' + shownName(e)} onPress={() => openEditFor(e)} hitSlop={hitSlopFor(38)} style={{ width: 38, height: 38, backgroundColor: t.surface2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }}><Icon name="pencil" size={15} color={flag ? t.s3 : t.ink2} /></Pressable>
                            {!isCustom ? (
                              <Pressable accessibilityRole="button" accessibilityLabel={'Swap ' + shownName(e) + ' for another movement'} onPress={() => setSwapFor(e)} hitSlop={hitSlopFor(38)} style={{ width: 38, height: 38, backgroundColor: t.surface2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }}><Icon name="swap" size={15} color={t.ink2} /></Pressable>
                            ) : null}
                          </View>
                          {/* Opened on the hold box for a movement the plan
                              prescribes in seconds. See src/ui/LogSetRow.tsx. */}
                          <LogSetRow t={t} unit={wu} timedDefault={isTimedPrescription(e.reps)} onLog={(set) => logSet(e, set)} />
                          {/* ── the rest between two sets, on the path that
                              had none ──────────────────────────────────────
                              All three ways to log a set on this row — the
                              checklist tick, the one-tap beside the
                              suggestion, and the boxes above — go through
                              `logSet`, and none of them opened the runner, so
                              none of them started a rest. The runner's own
                              arithmetic, keyed on the count of sets so the
                              next one restarts it. See src/ui/RestAfterSet.tsx.

                              The method of the set JUST LOGGED decides the
                              length, the same way the runner asks
                              `methodAt(done.length)`: a drop set rests for
                              nothing, which is what makes it one, and
                              `restAfter` returns 0 for it so nothing is
                              drawn. */}
                          {sets.length > 0 ? (() => {
                            const m = planned[sets.length - 1]?.method ?? e.method ?? null;
                            const secs = restAfter(m, restSecondsFor(e));
                            const byMethod = typeof methodFor(m).method.restsAfter === 'number';
                            return (
                              <RestAfterSet key={sets.length} seconds={secs}
                                note={byMethod ? `part of the ${methodFor(m).method.label.toLowerCase()}`
                                  : e.restSec != null ? 'set by your coach'
                                  : `app default of ${DEFAULT_REST_SEC} seconds`} />
                            );
                          })() : null}
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}

              {exercises.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
                  <Icon name="moon" size={26} color={t.ink3} />
                  <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>Rest Day</Text>
                  <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>Nothing scheduled today — recovery is where the gains happen. Pick another day above to train, or switch to Cardio to log a session.</Text>
                </View>
              ) : null}

              {/* Where the member's own changes are. Said out loud because
                  until now they were nowhere: a swap or a corrected load lived
                  in a React state until the app was next killed, and the coach
                  went on writing a program the member went on quietly
                  rewriting. The three states are three sentences — see
                  `planEditsNote` — and "your coach can see them" is never said
                  off a write nobody answered. */}
              {planEditsNote(planEdits.edits, planEdits.shared) ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
                  {planEditsNote(planEdits.edits, planEdits.shared)}
                </Text>
              ) : null}

              {exercises.length > 0 || customEx.length > 0 ? (
                <View style={{ marginTop: sp.lg }}>
                  {/* Opened on three rows, which is what the count box has
                      always defaulted to. Blank rows rather than a copied
                      prescription: there is no movement yet to take one from. */}
                  <Ghost label="Add an Exercise You Did" icon="plus" onPress={() => { setEditingKey(null); setCxName(''); setCxSets('3'); setCxRows(resizeLadder([], 3)); setAddOpen(true); }} />
                  {removedEx.filter((u) => u.indexOf(dayIdx + ':') === 0).length > 0 ? (
                    <Ghost label={`Put Back ${removedEx.filter((u) => u.indexOf(dayIdx + ':') === 0).length} Removed`} icon="swap" onPress={() => { setRemovedEx((prev) => prev.filter((u) => u.indexOf(dayIdx + ':') !== 0)); tapLight(); }} />
                  ) : null}
                </View>
              ) : null}

              {/* ── start from a session you have already done ──────────────
                  Offered on any day, rest days included: a member who wants
                  Thursday again on a Sunday is not asking the program for
                  permission. It does not replace the day and does not touch the
                  plan — see `repeatRun` at the top of this screen for the whole
                  of that decision.

                  Withheld only when there is genuinely nothing to offer, and
                  the two reasons for that are not the same thing. An empty
                  `repeatable` under a whole read is a member who has not logged
                  a lifting session yet, and there is nothing to say to them
                  here. An empty one under a read that failed or came back
                  short is us, and saying so is the difference between "you have
                  never trained" and "we could not see it". */}
              {repeatable.length > 0 ? (
                <View style={{ marginTop: sp.md }}>
                  <Ghost label="Repeat a Past Session" icon="clock" a11yLabel="Start a session from one you have already done"
                    onPress={() => { setRepeatPick(true); tapLight(); }} />
                </View>
              ) : !isWhole(workoutLogStatus) ? (
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                  {workoutLogStatus === 'loading'
                    ? 'Still reading your history — past sessions you can repeat will appear here.'
                    : 'We could not read your history in full, so there are no past sessions to offer you yet. That is our end, not yours.'}
                </Text>
              ) : null}

              {Object.keys(logged).some((k) => k.indexOf(dayIdx + ':') === 0 && (logged[k] || []).length > 0) ? (
                <View style={{ marginTop: sp.md }}>
                  <Cta label="Save Workout to Log" wide onPress={saveManual} />
                </View>
              ) : null}
            </View>
          ) : mode === 'stretch' ? (
            /* ── the stretch library ───────────────────────────────────────
               A list of routines rather than a clock over an activity, because
               the report was not "there is no stretch chip" on its own — it was
               "there should be stretch programs and they should have animations
               demonstrating the stretches". A sixth chip that only asked for a
               number of minutes would have answered the first four words of
               that and none of the rest.

               So the duration IS asked for, at the top, and it produces a
               program rather than a stopwatch: the chips below build a real
               routine out of the catalogue and hand it to the same runner the
               six written ones use. Minutes and routines, not minutes instead
               of routines. */
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.xs }}>Stretch Routines</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>
                Guided, one position at a time, with the hold counted down for you. Twelve stretches in the catalogue are moving
                sequences and play as animations; the rest are held, and a still is what a held stretch looks like.
              </Text>

              {/* ── built to fit the time you have ─────────────────────────
                  The six below are fixed lengths, which answers "give me a
                  good back routine" and does not answer "I have ten minutes".
                  Two rows of chips and the routine is already built underneath
                  them — see src/lib/stretchBuilder.ts, which holds all of the
                  deciding and none of the drawing. */}
              <SectionHead title="Built for the Time You Have" note="Pick how long you have and what you want to loosen." />

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {BUILD_MINUTES.map((n) => (
                  <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Build a ${n} minute routine`}
                    accessibilityState={{ selected: buildMins === n }}
                    onPress={() => { setBuildMins(n); setBuildSeed(0); tapLight(); }}
                    style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: buildMins === n ? t.brand : t.surface2 }}>
                    {/* "min" stays lower case — it is a unit and not a word to
                        capitalise, which is written down in coverage.test.ts. */}
                    <Text style={{ ...ty.label, ...numeric, ...font(buildMins === n ? '500' : '400'), color: buildMins === n ? t.brandInk : t.ink2 }}>{n} min</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {STRETCH_FOCUS.map((f) => (
                  <Pressable key={f.id} accessibilityRole="button" accessibilityLabel={`Stretch your ${f.phrase}`}
                    accessibilityState={{ selected: buildFocus === f.id }}
                    onPress={() => { setBuildFocus(f.id); setBuildSeed(0); tapLight(); }}
                    style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: buildFocus === f.id ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, ...font(buildFocus === f.id ? '500' : '400'), color: buildFocus === f.id ? t.brandInk : t.ink2 }}>{f.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* ── loading, unreadable, not allowed, cut short, and empty ─
                  Five sentences, because they are five different things and
                  four of them used to be impossible: the stretches were a
                  constant in src/lib/stretchBuilder.ts, so there was no read
                  and nothing to be honest about. They come from the catalogue
                  now, so each answer gets its own words and none of them is
                  "we have no stretches", which would be a false statement
                  about our own data in four cases out of five. The six written
                  routines below are unaffected either way — they are still a
                  constant, and they still work when this does not. */}
              {stretchCat.status === 'loading' ? (
                <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.md }}>Reading the stretch catalogue…</Text>
              ) : stretchCat.status === 'error' ? (
                <Notice tone={t.warn} kicker="Stretch" title="We Could Not Read the Stretch List"
                  note="That is our end, not yours — the stretches are still there, and the ready-made routines below are unaffected.">
                  <View style={{ marginTop: sp.md }}>
                    <Ghost label="Try Again" onPress={() => { void stretchCat.reload(); }} />
                  </View>
                </Notice>
              ) : stretchCat.signedOut ? (
                // Nought rows and no error is what a session that has not
                // restored looks like, and it is not an empty catalogue. Same
                // sentence as app/(client)/library.tsx, for the same reason.
                <Notice tone={t.warn} kicker="Stretch" title="Sign In to Build a Routine"
                  note="The stretch list is only available once you are signed in, so this was not allowed to look it up. Nothing has been removed." />
              ) : stretchCat.status === 'partial' ? (
                // A prefix of the list, not the list. Nothing on screen would
                // look wrong — a routine built from the first thousand rows is
                // indistinguishable from one built from all of them — so the
                // routine is withheld and the reason is given, rather than
                // quietly building from part of the catalogue. Unreachable
                // today at 58 rows against a cap of 1000, and here because the
                // day it stops being unreachable is not a day anybody will be
                // watching this screen.
                <>
                  <PartialRead what="stretches" shown={stretchCat.candidates.length} onPress={stretchCat.reload} />
                  <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.md }}>
                    We only have part of the stretch list, so we are not building a routine from it. The ready-made
                    routines below are unaffected.
                  </Text>
                </>
              ) : !stretchCat.candidates.length ? (
                <Text style={{ ...ty.label, color: t.ink3, paddingVertical: sp.md }}>
                  We have no equipment-free stretches to build a routine from yet.
                </Text>
              ) : (
                <>
                  {/* A problem here is now always something about the REQUEST —
                      the length, or the focus — because the rows are known to
                      be present by the time this renders. It is worded as
                      something we could not do rather than something you got
                      wrong. */}
                  {built?.problem ? (
                    <Notice tone={t.s3} kicker="Stretch" title="We Could Not Build That One" note={built.problem} />
                  ) : null}

                  {built?.routine ? (
                    <View>
                      <ListRow icon="clock" title={built.routine.title}
                        note={`${routineSummary(built.routine)} · ${built.routine.note}`}
                        onPress={() => { const r = built?.routine; if (r) { setStretchOn(r); tapLight(); } }} />
                      {/* Said UNDER the routine rather than instead of it. Asked
                          for twenty minutes of shoulders we have seven stretches
                          for, the answer is those seven and a sentence — not a
                          repeat of them, and not a two-minute hold on each. */}
                      {built.shortfall ? (
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{built.shortfall}</Text>
                      ) : null}
                      {/* Only offered when there is genuinely another one to
                          build. On a focus whose whole list is already in the
                          routine, this button would redraw the same stretches and
                          look broken. */}
                      {built.canVary ? (
                        <View style={{ alignSelf: 'flex-start', marginTop: sp.xs }}>
                          <Ghost label="Build Another" icon="swap" onPress={() => { setBuildSeed((n) => n + 1); tapLight(); }} />
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </>
              )}

              <Rule />

              <SectionHead title="Ready-Made Routines" note="Six written routines, each with a fixed set of stretches." />
              {STRETCH_ROUTINES.map((r) => (
                <ListRow key={r.id} icon="clock" title={r.title} note={`${routineSummary(r)} · ${r.note}`}
                  onPress={() => { setStretchOn(r); tapLight(); }} />
              ))}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: layout.section }}>
                A finished routine is written to your log as a mobility session called Stretching — the same entry the
                Mobility chip makes, so it is counted once and not twice. That is true of a routine you built and one you
                picked: both are the same session to your calendar and to your coach.
              </Text>
            </View>
          ) : (
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.md }}>{KIND_LABEL[mode as SessionKind]} session</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {(SESSION_TYPES[(mode as SessionKind)] || CARDIO).map((ct) => (
                  <Pressable key={ct} onPress={() => setCtype(ct)} style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: ctype === ct ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, ...font(ctype === ct ? '500' : '400'), color: ctype === ct ? t.brandInk : t.ink2 }}>{ct}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {/* Start comes before the log fields, and it is the primary
                  action, because only the Program had one: reported as "there
                  is no start work out tab for any other workout other than the
                  Program". It sits here rather than beside the Program's own
                  Start button at the top of the screen so that the thing it
                  starts — the chip selected directly above — is on screen with
                  it; the hero up there is about today's lifting plan and would
                  make "Start Sauna" underneath it read as part of that. */}
              <Cta label={`Start ${ctype}`} wide onPress={() => { const at = Date.now(); setResumeAt(null); rememberSession({ kind: 'timed', sessionKind: mode, activity: ctype, startedAt: at }); void startLiveActivity(ctype, at); setTimed({ kind: mode as SessionKind, activity: ctype }); tapLight(); }} />
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: layout.section, marginBottom: sp.md }}>Or Log One You Have Already Done</Text>

              {/* Recovery is not cardio, and this form used to treat it as if it
                  were: logging a sauna asked for Distance, km and Avg watts.
                  None of those has a meaning for Breathwork, a Cold Plunge or a
                  Massage, and the note underneath was about bikes and rowers.
                  Calories go too — recoveryActs.ts is explicit that these are
                  thermoregulation rather than work, so a figure derived from
                  time and body weight would be invented. A recovery session is
                  how long it lasted. */}
              <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'flex-end' }}>
                <Field label="Time" hint="min">
                  <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" style={inp} />
                </Field>
                {mode !== 'recovery' ? (
                  <Field label="Distance" hint={unit}>
                    <View style={{ flexDirection: 'row', gap: sp.sm }}>
                      <TextInput value={dist} onChangeText={setDist} keyboardType="decimal-pad" style={inp} />
                      <Pressable accessibilityRole="button" accessibilityLabel={`Distance unit: ${distanceUnitName(unit)}. Switch to ${distanceUnitName(unit === 'km' ? 'mi' : 'km')}`}
                        onPress={() => { touchedUnit.current = true; setUnit(unit === 'km' ? 'mi' : 'km'); }}
                        style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, justifyContent: 'center' }}>
                        <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>{unit}</Text>
                      </Pressable>
                    </View>
                  </Field>
                ) : null}
                <Pressable onPress={() => { void logCardio(); }} style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 11, justifyContent: 'center' }}>
                  <Text style={{ ...ty.label, ...font('600'), color: t.brandInk }}>Log</Text>
                </Pressable>
              </View>
              {mode !== 'recovery' ? (
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  {/* The unit lives only in the placeholder, and a placeholder is
                      drawn only while the box is EMPTY — so on a correction opened
                      over typed values these are two bare numerals, and 141 is a
                      heart rate as readily as it is a wattage. See Field in
                      src/ui/kit.tsx, which is the fix where there is room for a
                      visible label; these two have none. */}
                  <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" placeholder="Avg watts (optional)" placeholderTextColor={t.ink3} accessibilityLabel="Average watts, optional" style={inp} />
                  <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" placeholder="Calories (optional)" placeholderTextColor={t.ink3} accessibilityLabel="Calories, optional" style={inp} />
                </View>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {mode === 'recovery'
                  ? 'Just how long it lasted. Recovery is not scored as calories burned — a sauna raises your heart rate, but the cost is keeping you cool rather than work done, so any figure here would be made up.'
                  : 'Bikes, rowers & ski ergs: add your avg watts. Logging an Apple Watch workout by hand? Enter the minutes and the calories it shows — leave distance blank for studio classes like Pilates.'}
              </Text>

              <View style={{ marginTop: layout.section }}>
                <SectionHead title="Today's Sessions" />
                {/* Same three causes as the calendar's day list above. */}
                {todayCardio.length === 0 && workoutLogStatus !== 'ready' ? (
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    {workoutLogStatus === 'loading' ? 'Reading your log…' : 'We couldn’t read your log, so we can’t say what is on today.'}
                  </Text>
                ) : todayCardio.length > 0 ? (
                  todayCardio.map((c, i) => (
                    <View key={i}>
                      {i > 0 ? <Rule /> : null}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md, paddingVertical: sp.md }}>
                        <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{c.type}</Text>
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{[`${c.mins} min`, c.dist > 0 ? `${c.dist} ${c.unit}` : null, c.watts > 0 ? `${c.watts} W` : null, c.kcal != null ? `${num(c.kcal)} kcal` : null].filter(Boolean).join(' · ')}</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={{ ...ty.label, color: t.ink3 }}>No sessions logged yet.</Text>
                )}
              </View>
            </View>
          )}
        </Section>

        {/* ── what is already in the log for this day ─────────────────────── */}
        {/*
            Reported as "No way to edit or delete an exercise that has been
            entered." Both actions existed, behind the month calendar; nothing
            on the screen a member logs from ever showed them what they had
            already saved, so there was nothing to tap. This is that list, on
            the day the strip is on, with both actions on every row.
        */}
        {/* The section disappeared entirely under a failed read — it is gated
            on there being entries, and there are never any entries when the
            read did not answer. So the one part of this screen that would have
            said "your sessions are still there" was the part that vanished. */}
        {stripEntries.length === 0 && !logKnown && workoutLogStatus !== 'loading' ? (<>
          <Rule />
          <Section>
            <SectionHead title="Already in Your Log" note={prettyDay(stripDay)} />
            <Text style={{ ...ty.label, color: t.ink3 }}>
              {workoutLogStatus === 'partial'
                ? 'Your log is longer than this screen can read at once, so anything you saved on this day may not be listed here. Nothing is missing from your log.'
                : 'Your log could not be read, so this cannot show what you have already saved on this day. Nothing has been lost — pull down to try again.'}
            </Text>
          </Section>
        </>) : null}

        {stripEntries.length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Already in Your Log" note={prettyDay(stripDay)} />
            {stripEntries.map((l, i) => (
              <View key={l.id ?? `${l.t}-${l.exercise}-${i}`}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize' }} numberOfLines={1}>{movement(l.exercise)}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }} numberOfLines={1}>
                      {/* Through setListLabel: a hold reads as a clock, never as
                          "45×— kg". The draft chips have always got this right
                          and the saved row did not. */}
                      {l.sets && l.sets.length
                        ? setListLabel(l, (kg) => fig(liftIn(kg, wu)), wu)
                        : l.cardio
                        ? [`${l.cardio.mins} min`, l.cardio.dist > 0 ? `${l.cardio.dist} ${l.cardio.unit}` : null].filter(Boolean).join(' · ')
                        : 'Logged'}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={'Edit or replace ' + movement(l.exercise)} onPress={() => { tapLight(); setEditEntry(l); }} hitSlop={8}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                    <Icon name="pencil" size={14} color={t.ink2} />
                    <Text style={{ ...ty.caption, ...font('500'), color: t.ink }}>Edit</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={'Delete ' + movement(l.exercise)} onPress={() => deleteEntry(l)} hitSlop={8} style={{ padding: 4 }}>
                    <Icon name="minus" size={16} color={t.crit} />
                  </Pressable>
                </View>
              </View>
            ))}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              Edit lets you fix the sets or swap the movement for the right one — the sets come with it, so you do not have to
              type them again. Deleting asks first, and only reports it done once the server has actually removed it.
            </Text>
          </Section>
        </>) : null}


        {/* ── log by text ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Log by Text" />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {/* This field is the last thing on the screen, so when the keyboard
                comes up it is exactly where the keyboard is. The ScrollView's
                automaticallyAdjustKeyboardInsets makes the field REACHABLE by
                scrolling, but nothing was scrolling — so what a person saw was
                the section heading and then the keyboard, with whatever they
                typed hidden behind it. Reported twice.

                Scrolling to the end on focus puts it above the keyboard. The
                frame of delay is for the inset to be applied first; scrolling
                before that lands short by the height of the keyboard. */}
            {/* The unit is written into the example on purpose. parseWorkoutText
                reads "60kg" and "135lb", but a BARE number — "bench 3x8 @135" —
                it takes as kilograms, and it has no way to know who is typing.
                Showing a pounds member an example that carries "lb" is what
                stops a 135 lb bench being recorded as a 135 kg one. */}
            <TextInput value={nlw} onChangeText={setNlw} placeholder={wu === 'lb' ? '"bench 3x8 135lb, squat 5 5 5 225lb"' : '"bench 3x8 60kg, squat 5 5 5 100kg"'} placeholderTextColor={t.ink3}
              accessibilityLabel="Describe the workout you did"
              onFocus={() => { setTimeout(() => pageScroll.current?.scrollToEnd({ animated: true }), 120); }}
              onSubmitEditing={logWorkoutNL} returnKeyType="done" style={inp} />
            {/* `accessibilityState` as well as `disabled`. The refusal here was
                drawn and nothing else: the fill drops to `t.surface2` and the
                word to `t.ink3`, which is a colour change and a colour change
                only. VoiceOver read "Log, button", the tap did nothing, and
                nothing said why — so the member's own conclusion is that the
                button is broken rather than that the field above it is empty.
                Announced, it reads "Log, dimmed, button", which is the whole
                sentence. Same edit at eleven other controls in this app that
                said their refusal in colour alone. */}
            <Pressable onPress={logWorkoutNL} disabled={!nlw.trim()} accessibilityState={{ disabled: !nlw.trim() }} accessibilityRole="button" accessibilityLabel="Log workout from text" style={{ backgroundColor: nlw.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
              <Text style={{ ...ty.label, ...font('600'), color: nlw.trim() ? t.brandInk : t.ink3 }}>Log</Text>
            </Pressable>
          </View>
        </Section>


        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          <SectionHead title="Go To" />
          {/* Ordered by what somebody is DOING, not alphabetically and not by
              when each screen happened to be built. Four groups, in the order
              a session actually runs:

                who you train with My Coach · Coach's Documents
                before you start   Playlists · Scan Machine · Library
                what to do         This Week · Targets · When to Rest
                what you did       History · Trends · Records
                how you are        Recovery · Watch & Devices
                settings           Tools

              The coach comes FIRST, on the report that "you haven't added the
              My Coach into the Train tab under Go To". Both screens already
              existed and both were reachable from the Me hub, which is where
              somebody goes to change a setting — not where they go mid-session
              when they want to ask the person who wrote the program a
              question. This is the training screen, so the coach belongs on it,
              and above the equipment rather than after the tool drawer.

              Shown unconditionally, and that is a decision rather than an
              oversight. The obvious gate is this screen's `coachId`, but its
              own comment says "null is fine, it just means no tie-break" and
              its read is marked no-error-ok — so a failed or slow lookup leaves
              it null, and gating on it would make a coached client's shortcut
              to their coach VANISH exactly when the network is bad. That is the
              house rule about an empty read never meaning "there are none",
              applied to navigation.

              The two screens already handle having no coach, and the Me hub
              already links to both without a gate. Consistent, and it cannot be
              wrong in the direction that matters.

              Labels are title case throughout. The row previously mixed
              "This Week" with "Scan machine" and "Watch & Devices", and that
              last one contradicted the screen's OWN title, which has always
              been "Watch & Devices". */}
          {/* Rows, not chips. Fourteen destinations in a wrapping pill grid ran
              off the right edge on a phone — the last one read "Targe" — and a
              label cut in half is a destination somebody cannot identify, let
              alone decide to tap. Chips earn their place when there are a few
              and they are short; at fourteen they are a wall of pills where
              nothing is findable and the widest ones lose their names.

              The same list as rows is scannable top to bottom, gives every
              label its full width whatever the label is, and matches how the
              coach app already presents the equivalent list — one pattern for
              "here is everywhere else you can go" across both apps rather than
              two that have to be learned separately. */}
          {([
            ['people', 'My Coach', '/(client)/my-coach'],
            ['grid', "Coach's Documents", '/(client)/coach-documents'],
            ['play', 'Playlists', '/(client)/music'],
            ['camera', 'Scan Machine', '/(client)/scan-machine'],
            ['video', 'Library', '/(client)/library'],
            // Beside the Library, in the "before you start" group, because the
            // two are the halves of one question: the Library is six hundred
            // movements with no order to do them in, and this is fifteen
            // complete plans that put them in one.
            //
            // "Ready-Made" is load-bearing and is not decoration. This screen is
            // where a coached member reads the program their coach wrote for
            // them, so a row here labelled "Programs" would read as that, and
            // the fifteen behind it are written for nobody. The screen itself
            // says so again at the top.
            ['grid', 'Ready-Made Programs', '/(client)/programs'],
            // Build a Workout was here, beside the two rows above — the third
            // answer to "what do I do today". It is now directly under Start
            // Workout at the top of this screen and NOT in both places: a
            // destination reachable from two rows on one page is a member
            // wondering whether the two are the same thing.
            ['calendar', 'This Week', '/(client)/week'],
            ['trending', 'Targets', '/(client)/progression'],
            // Sits with the training tools rather than three levels down inside
            // History, which is where its only link was. The four sections it
            // opens — Training Summary, the body, Most/Least Trained and the
            // Recovery Map — are about the training this screen logs, so this
            // is where somebody goes looking for them.
            ['dumbbell', 'Your Muscles', '/(client)/muscles'],
            ['moon', 'When to Rest', '/(client)/restday'],
            ['clock', 'History', '/(client)/activity'],
            ['chart', 'Trends', '/(client)/trends'],
            ['trophy', 'Records', '/(client)/records'],
            ['water', 'Recovery', '/(client)/recovery'],
            ['heart', 'Watch & Devices', '/(client)/devices'],
            ['settings', 'Tools', '/(client)/tools'],
          ] as const).map(([icon, label, route]) => (
            <ListRow key={route} icon={icon} title={label}
              onPress={() => router.push(route as any)} />
          ))}
        </Section>

      </ScrollView>

      {/* ── Why these two sheets are a variable rather than JSX in place ──────
          Both are opened from TWO places: the rows on this screen, and the rows
          inside the month sheet below. A `<Modal>` mounted here, as a SIBLING of
          that month `<Modal>`, is presented in a window BENEATH it on iOS — so
          tapping "Heart rate" or the pencil inside the month sheet set the state,
          opened the sheet, and put it behind an opaque sheet the person was still
          looking at. From the outside that is a button that does nothing.

          So they are rendered in exactly one place at a time: inside the month
          sheet while it is open, out here while it is not. One instance either
          way, so no duplicated state and no two sheets fighting over the same
          entry. */}
      {!showCal ? overlays : null}

      <Modal visible={!!swapFor} transparent animationType="slide" onRequestClose={() => setSwapFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSwapFor(null)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, ...elevation.e2 }}>
          {swapFor && (<View>
            <Text style={{ ...ty.head, color: t.ink, textTransform: 'capitalize' }}>Swap {shownName(swapFor)}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>Alternatives that hit the same muscles</Text>
            {[swapFor.name, ...swapFor.alternatives].map((alt, ai) => { const on = nameOf(swapFor) === alt; return (
              <View key={alt}>
                {ai > 0 ? <Rule /> : null}
                <Pressable onPress={() => { setSwaps({ ...swaps, [uid(swapFor)]: alt }); setSwapFor(null); }} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.md }}>
                  {/* The alternative READS in the reader's language; `alt` is
                      still what gets written into `swaps`, and swaps are read
                      back by `nameOf` as the identity of the movement. */}
                  <Text style={{ ...ty.body, ...font(on ? '500' : '400'), color: t.ink, textTransform: 'capitalize' }}>{movement(alt)}</Text>{on && <Icon name="check" size={16} color={t.brand} />}
                </Pressable>
              </View>); })}
          </View>)}
        </View>
      </Modal>


      <Modal visible={showCal} transparent animationType="slide" onRequestClose={() => setShowCal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowCal(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '88%', ...elevation.e2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, flex: 1 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous month"
                onPress={() => { setCalShift((m) => m - 1); tapLight(); }}
                hitSlop={hitSlopFor(34)}
                style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface2 }}>
                <Icon name={BACK_ICON} size={15} color={t.ink2} />
              </Pressable>
              <Text style={{ ...ty.head, color: t.ink, textTransform: 'capitalize' }}>{monthLabel}</Text>
              {/* Nothing forward of the month we are in, for the reason at
                  `calAtNow`: every day after today would be drawn as a rest day
                  that nobody has had yet. */}
              {!calAtNow ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Next month"
                  onPress={() => { setCalShift((m) => m + 1); tapLight(); }}
                  hitSlop={hitSlopFor(34)}
                  style={{ width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface2 }}>
                  <Icon name={FORWARD_ICON} size={15} color={t.ink2} />
                </Pressable>
              ) : null}
            </View>
            <Ghost label="Close" onPress={() => setShowCal(false)} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={{ flexDirection: 'row', marginBottom: 6 }}>
              {WEEK.map((d) => <Text key={d} style={{ ...ty.micro, flex: 1, textAlign: 'center', color: t.ink3 }}>{d[0]}</Text>)}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {Array.from({ length: firstDow }).map((_, i) => <View key={'e' + i} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const ds = `${calYear}-${pad2(calMonth + 1)}-${pad2(day)}`;
                const worked = workedDates.has(ds); const isToday = ds === dstr(today0); const isSel = ds === activeCalDay;
                // Same states as the week strip. A grid of empty circles under a
                // failed read is a month somebody did not train, and a filled
                // one over an unsaved draft is a session that does not exist.
                const draftedDay = !worked && draftDates.has(ds);
                const unknownDay = !logKnown && !worked && !draftedDay;
                return (
                  // Said, not only drawn — the same sentence the week strip
                  // above builds, because the comment two lines up is right
                  // that these are the same four states and the accessibility
                  // was the half that did not come with them. Trained, typed
                  // but not saved, not read and nothing are one filled circle,
                  // one warn-coloured hairline, one grey hairline and no border
                  // at all; the only text in the cell is the day number, which
                  // says none of it.
                  //
                  // `new Date(calYear, calMonth, day)` and not `new Date(ds)`:
                  // a bare ISO day parses as UTC midnight and prints the day
                  // before in every zone west of Greenwich, which on a calendar
                  // would put the spoken date one off the number beside it.
                  <Pressable key={day} onPress={() => setSelCalDay(ds)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSel }}
                    accessibilityLabel={`${new Date(calYear, calMonth, day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${isToday ? ', today' : ''}${worked ? ', trained' : draftedDay ? ', typed but not saved' : unknownDay ? ', not read' : ''}`}
                    style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: worked ? t.brand : 'transparent', borderWidth: isSel ? 2 : (isToday && !worked) || unknownDay || draftedDay ? hairline : 0, borderColor: isSel ? t.ink : draftedDay ? t.warn : isToday && !worked ? t.brand : t.ink3 }}>
                      <Text style={{ ...ty.label, ...numeric, ...font(worked || isToday ? '600' : '400'), color: worked ? t.brandInk : isToday ? t.brandText : t.ink2 }}>{day}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ marginTop: sp.lg }}>
              <Rule />
              <View style={{ paddingTop: sp.lg }}>
                <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.md }}>{prettyDay(activeCalDay)}</Text>
                {dayEntries.length === 0 ? (
                  // Not "Rest day". That word CLASSIFIES the day, and an empty
                  // `dayEntries` has three causes: nothing was logged, the read
                  // failed, or the read stopped at its row limit before it
                  // reached back this far. Under either of the last two the
                  // calendar dot is missing for the same reason, so a member
                  // scrolling back through a month of real training was shown
                  // it as a month of rest days.
                  <Text style={{ ...ty.label, color: t.ink3 }}>
                    {workoutLogStatus === 'loading' ? 'Reading your log…'
                      : workoutLogStatus === 'error' ? 'We couldn’t read your log, so we can’t say what you did on this day.'
                      : workoutLogStatus === 'partial' ? 'Not read this far back — your log goes further than this screen can read in one go.'
                      : 'Rest day — no workout logged.'}
                  </Text>
                ) : (
                  <View>
                    {pending.length ? (
                      <View style={{ marginBottom: sp.lg }}>
                        <Notice
                          kicker="From Your Watch"
                          title={`${pending.length} Workout${pending.length > 1 ? 's' : ''} Not in Your Log`}
                          note={pending.slice(0, 3).map((sm) => sm.activity).join(' · ') + (pending.length > 3 ? ` and ${pending.length - 3} more` : '')}
                        >
                          <View style={{ marginTop: sp.md }}>
                            <Ghost
                              label={importing ? 'Importing…' : `Import ${pending.length === 1 ? 'it' : 'them'}`}
                              onPress={importPending}
                            />
                          </View>
                        </Notice>
                      </View>
                    ) : null}
                    {/* A device that did not answer, named. The offer above is
                        what the devices that DID answer held; without this
                        line a WHOOP that refused is simply absent from it, and
                        an absence on this tab reads as "the app lost it" —
                        which is the conclusion this whole import exists to
                        stop. Warn, not crit: nothing is broken and nothing is
                        lost, the read just has a hole in it and trying again
                        usually closes it. */}
                    {watchNote ? (
                      <View style={{ marginBottom: sp.lg }}>
                        <Notice
                          tone={t.warn}
                          kicker="From Your Watch"
                          title="Not Everything Could Be Read"
                          note={watchNote}
                        />
                      </View>
                    ) : null}
                    <KpiRow items={[
                      { label: 'Exercises', value: fig(dayEntries.length) },
                      { label: 'Sets', value: fig(daySets) },
                      // Tonnes for a metric reader; pounds for an imperial
                      // one, because the tonne has no imperial counterpart
                      // safe to print in a column this narrow — see
                      // volumeHeadline in src/lib/units.ts.
                      { label: 'Volume', value: dayVolume ? `${dayHeadline!.figure.toLocaleString()}${dayHeadline!.unit === 't' ? 't' : ''}` : '—', unit: dayHeadline?.unit === 'lb' ? 'lb' : undefined },
                      { label: 'kcal', value: fig(dayKcal) },
                    ]} />
                    {/* Sets that happened and are not in the figure above,
                        because nothing recorded what the member weighed on the
                        day they did them. Said rather than silently dropped —
                        the same sentence History and the finish card print. */}
                    {dayVolumeNote ? (
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>{dayVolumeNote}</Text>
                    ) : null}
                    <View style={{ marginTop: sp.lg }}>
                      {dayEntries.map((l, i) => (
                        <View key={i}>
                          {i > 0 ? <Rule /> : null}
                          <View style={{ paddingVertical: sp.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ ...ty.body, ...font('500'), color: t.ink, textTransform: 'capitalize', flex: 1 }}>{movement(l.exercise)}</Text>
                              <Pressable accessibilityLabel={'Edit ' + movement(l.exercise)} onPress={() => setEditEntry(l)} hitSlop={8} style={{ padding: 4, marginEnd: sp.sm }}><Icon name="pencil" size={16} color={t.ink3} /></Pressable>
                              {/* Confirmed, then verified. The confirm was already
                                  here; what was missing is that the row left the
                                  screen whether or not the server had removed it,
                                  so a refused delete looked done and the session
                                  was back — with its volume and calories — at the
                                  next launch. */}
                              <Pressable accessibilityLabel={'Delete ' + movement(l.exercise)} onPress={() => deleteEntry(l)} hitSlop={8} style={{ padding: 4, marginEnd: -4 }}><Icon name="minus" size={16} color={t.crit} /></Pressable>
                            </View>
                            {l.sets ? (
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                                {l.sets.map((s: number[], j: number) => { const _f = (l.feel || [])[j]; const _fc = _f === 'easy' ? t.good : _f === 'hard' ? t.crit : null; return <View key={j} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}>{_fc ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: _fc }} /> : null}<Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{setChipLabel(l, j, (kg) => fig(liftIn(kg, wu)), wu)}</Text></View>; })}
                              </View>
                            ) : l.cardio ? (
                              <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 5 }}>{[`${l.cardio.mins} min`, l.cardio.dist > 0 ? `${l.cardio.dist} ${l.cardio.unit}` : null, l.cardio.watts && l.cardio.watts > 0 ? `${l.cardio.watts} W` : null, l.cardio.hrAvg ? `♥ ${l.cardio.hrAvg} avg / ${l.cardio.hrHigh ?? l.cardio.hrAvg} hi` : null].filter(Boolean).join(' · ')}</Text>
                            ) : null}
                            {l.kcal ? <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 6 }}>{num(l.kcal)} kcal</Text> : null}
                            {/* Who put this in the log, and what the member is
                                allowed to say about it. Absent when they logged
                                it themselves, which is almost always — so the
                                strip only appears when it is telling them
                                something.

                                This WAS the caption alone, with the coach's name
                                hard-coded `null` and nothing beside it to press:
                                six identical words under a record made about
                                somebody, with no way to disagree with it. The
                                whole argument, including why a query is a third
                                verb rather than a delete or an edit, is in
                                src/ui/CoachLogReview.tsx and the module under it.

                                `queryFor` returns null for a row the read never
                                saw, which is NOT the same as a row it saw with no
                                query on it — `reviewFor` takes the status and
                                decides which sentence that earns. */}
                            <CoachLogReviewStrip
                              t={t}
                              entry={l}
                              movement={movement(l.exercise)}
                              review={reviewFor(l, queryFor(coachLogQueries.byId, l.id), coachLogQueries.status, loggingCoach)}
                              query={queryFor(coachLogQueries.byId, l.id)}
                              onQuery={(note) => coachLogQueries.query(l.id ?? '', note)}
                              onWithdraw={() => coachLogQueries.withdraw(l.id ?? '')}
                              onAmend={() => { tapLight(); setEditEntry(l); }}
                            />
                            <Pressable onPress={() => { tapLight(); setHrEntry(l); }} accessibilityRole="button" accessibilityLabel={'Heart rate for ' + movement(l.exercise)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.md, alignSelf: 'flex-start', backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                              <Icon name="heart" size={13} color={t.brand} />
                              <Text style={{ ...ty.label, ...font('500'), color: t.ink }}>Heart Rate</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.lg }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.brand }} />
              {/* `workedDates` is a Set of DAY keys, so two sessions on one
                  day counted once and the caption still called them sessions.
                  It is days, it now says days — and it says nothing at all
                  when the read behind it was not whole, because a count of
                  trained days drawn from a prefix is a smaller life. */}
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                Days you trained{workoutLogStatus === 'ready' ? ` · ${workedDates.size} day${workedDates.size === 1 ? '' : 's'} logged` : workoutLogStatus === 'loading' ? ' · still reading' : ' · your log could not be read in full, so a plain day is one we could not see'} · tap any day for details
              </Text>
            </View>
          </ScrollView>
        </View>
        {showCal ? overlays : null}
      </Modal>

      {/* ── which session to repeat ────────────────────────────────────────
          A list and nothing else. Every row says the day it was done, how much
          was in it, and which movements — enough to recognise the session
          without opening it, which is the whole of what a picker owes somebody
          standing in a gym.

          The sentence under the heading is the one that has to be right: a
          member tapping here must not come away believing they have done
          today's program. It says what happens to the plan, because what
          happens to the plan is nothing. */}
      <Modal visible={repeatPick} transparent animationType="slide" onRequestClose={() => setRepeatPick(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setRepeatPick(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: Math.max(insets.bottom, layout.gutter), maxHeight: '76%', ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>Repeat a Session</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
            The movements and sets you recorded, ready to run again. Today&rsquo;s plan is left exactly as it is — this runs instead of it for one session, and does not mark it done.
          </Text>
          {/* The dot is the mark and the words are the meaning — a status
              colour is tuned for a 3:1 mark and not for the 4.5:1 that text
              needs, which is what scripts/check-contrast.mjs holds. Same shape
              the runner's own injury caveat uses a few hundred lines down. */}
          {!isWhole(workoutLogStatus) ? (
            <View style={{ flexDirection: 'row', gap: 7, marginBottom: sp.md }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: workoutLogStatus === 'loading' ? t.ink3 : t.warn, marginTop: 5 }} />
              <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>
                {workoutLogStatus === 'loading'
                  ? 'Still reading — there may be more sessions than these.'
                  : 'Your history could not be read in full, so this is what we could see and not everything you have done.'}
              </Text>
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: sp.md }}>
            {repeatable.slice(0, 20).map((s) => {
              // Translated for READING only. The names that identify the
              // movements are the logged ones and never leave `s.entries`.
              const names = s.entries.filter((e) => Array.isArray(e.sets) && e.sets.length > 0).map((e) => movement(e.exercise));
              const when = s.day ? prettyDay(s.day) : 'A Session';
              const line = `${sessionSummary(s)} · ${names.join(', ')}`;
              return (
                <Pressable key={s.t} accessibilityRole="button" accessibilityLabel={`Repeat ${when}. ${line}`}
                  hitSlop={hitSlopFor(MIN_TARGET)}
                  onPress={() => startRepeat(s)}
                  style={{ minHeight: MIN_TARGET, justifyContent: 'center', backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: sp.md, marginBottom: sp.sm }}>
                  <Text style={{ ...ty.body, ...font('500'), color: t.ink }}>{when}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }} numberOfLines={2}>{line}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Ghost label="Close" onPress={() => setRepeatPick(false)} />
        </View>
      </Modal>

      <Modal visible={session} animationType="slide" onRequestClose={() => { rememberSession(null); void endLiveActivity(); setRepeatRun(null); setSession(false); }}>
        {/* `clientId` is null rather than 'unknown': that placeholder is what
            this screen carries before the profile has resolved, and a
            notification routed to `?clientId=unknown` opens a coach's screen at
            nobody. `clientName` only under a READ profile — the cached name on
            a shared handset can belong to whoever used it last, and a coach
            congratulating the wrong person by name is worse than one told "a
            client". */}
        {/* ── the plan, or the session being repeated ────────────────────
            Three props move together and must not be split up.

            `exercises` is the repeated list when there is one. `nameOf` becomes
            the identity function with it, because the plan's `nameOf` resolves
            a swap by `dayIdx:key` and a repeated movement has neither — it is
            already the name it was logged under, which is the name it will be
            logged under again. And `onSwap` is dropped entirely: it writes a
            swap into `usePlanEdits` keyed on a plan row, and a repeated
            movement is not one. The runner reads `!!onSwap` for `canSwap`, so
            the Swap control is simply not offered — correct in its own right,
            since a repeated movement carries no alternatives to swap to.

            The injury caution the runner draws under each movement is NOT
            affected: it is computed inside the runner from the name and the
            group, so a repeated movement is flagged exactly as a planned one
            is. What it does not get is the plan screen's severe-injury HIDING,
            which is the same treatment `customEx` already gets one line above
            in `runnableEx` — a movement somebody chose for themselves is shown
            to them with the caution on it rather than taken away. */}
        <SessionRunner t={t} unit={wu} distanceUnit={unit} exercises={repeatRun ? repeatRun.exercises : runnableEx} focus={repeatRun ? 'Repeat' : workout.focus} nameOf={repeatRun ? (e: ProgramExercise) => e.name : nameOf} onSwap={repeatRun ? undefined : (e, alt) => { setSwaps({ ...swaps, [uid(e)]: alt }); tapLight(); }} age={ageFromDob(cd.dob)} restingKcalPerMin={restingKcalPerMin} log={workoutLog} logStatus={workoutLogStatus} weightHistory={cd.weightSeries} injuries={cd.injuries} injuryStatus={cd.profileStatus} videos={exVideos} videoStatus={exVideoStatus} preferTrainerId={coachId} clientId={cd.id && cd.id !== 'unknown' ? cd.id : null} clientName={cd.profileStatus === 'ready' ? cd.name : null} onComplete={logWorkouts} onRetry={flushWorkouts} resumeAt={resumeAt} onClose={() => { rememberSession(null); void endLiveActivity(); setResumeAt(null); setRepeatRun(null); setSession(false); }} />
      </Modal>

      {/* Mounted only while a session is running, so its clock starts at zero
          every time rather than carrying the last one's elapsed time. */}
      <Modal visible={timed != null} animationType="slide" onRequestClose={() => { rememberSession(null); void endLiveActivity(); setTimed(null); }}>
        {timed ? (
          <TimedSessionRunner
            t={t}
            kind={timed.kind}
            activity={timed.activity}
            age={ageFromDob(cd.dob)}
            restingKcalPerMin={restingKcalPerMin}
            defaultUnit={unit}
            weightKg={cd.weightKg}
            sex={cd.sex}
            // Closed only once the row is on the server. `commitSession`
            // already says so when it is not; leaving the sheet up is what
            // makes saying so useful, because the Save button is still there.
            onSave={async (v) => { const ok = await commitSession(timed.kind, timed.activity, v.mins, v); if (ok) { rememberSession(null); void endLiveActivity(); setResumeAt(null); setTimed(null); } return ok; }}
            resumeAt={resumeAt}
            onClose={() => { rememberSession(null); void endLiveActivity(); setResumeAt(null); setTimed(null); }}
          />
        ) : null}
      </Modal>

      {/* Same contract as the timed runner above: it never writes the log
          itself, `commitSession` does, and the sheet stays up until the row is
          actually on the server. A stretch routine commits as a MOBILITY
          session named "Stretching" — the entry the Mobility chip has always
          made — so it is counted once, in one place, and a session logged
          before this feature existed still reads exactly as it did. */}
      <Modal visible={stretchOn != null} animationType="slide" onRequestClose={() => setStretchOn(null)}>
        {stretchOn ? (
          <StretchRunner
            t={t}
            routine={stretchOn}
            onSave={async (mins) => { const ok = await commitSession('mobility', 'Stretching', mins); if (ok) setStretchOn(null); return ok; }}
            onClose={() => setStretchOn(null)}
          />
        ) : null}
      </Modal>

      {/* KeyboardAvoidingView, or the keyboard sits on top of the very fields
          this sheet exists to fill in — and every tap aimed at a covered field
          lands on the backdrop and closes the sheet instead. */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)}
          accessibilityRole="button" accessibilityLabel="Close" />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: Math.max(insets.bottom, layout.gutter), ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>{editingKey ? 'Edit Exercise' : 'Add an Exercise'}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>{editingKey ? 'Rename it, or change the sets and reps you are aiming for.' : "Log something you did that isn't in today's plan."}</Text>
          <TextInput value={cxName} onChangeText={setCxName} autoFocus returnKeyType="done" onSubmitEditing={commitCx} blurOnSubmit={false} placeholder="Exercise name (e.g. Cable fly)" placeholderTextColor={t.ink3} accessibilityLabel="Exercise name" style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12, marginBottom: sp.md }} />
          {/* ── how many sets, and then a row for each of them ─────────────
              "Target Sets", "Target Reps" and one "Weight" is three boxes that
              can only say "N of the identical set". A member whose coach wrote
              a ramp, or who ramps their own working sets, had nowhere to put
              60 / 65 / 65 — which is the exact report this answers.

              The count box still asks how many. What changed is what it does
              with the answer: it opens a ROW for each set rather than making
              that many copies of one. The table beneath is the same component
              the coach's own log uses, without the tick column — a plan is not
              testimony, and there is nothing to tick about a set that has not
              happened yet. See `onToggle` in src/ui/SetTable.tsx. */}
          <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'flex-end' }}>
            <View style={{ width: 108 }}>
              <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xs }}>Target Sets</Text>
              <TextInput value={cxSets} onChangeText={retypeCxSets} keyboardType="numeric" placeholderTextColor={t.ink3} accessibilityLabel="How many sets" style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} />
            </View>
            {/* Switchable per entry rather than read off the profile. A machine
                in another gym is plated in whatever that gym uses, and the
                figures typed below are the ones on the machine — so the unit has
                to travel with the numbers, not with the account. What is STORED
                is kilograms either way, and switching here RE-RENDERS the rows
                rather than relabelling them: the same weight in the other unit,
                not the same digits under a different word. */}
            <Pressable accessibilityRole="button"
              accessibilityLabel={`Weight unit: ${cxUnit === 'kg' ? 'kilograms' : 'pounds'}. Switch to ${cxUnit === 'kg' ? 'pounds' : 'kilograms'}`}
              onPress={() => { switchCxUnit(); tapLight(); }}
              style={{ backgroundColor: t.surface3, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 11 }}>
              <Text style={{ ...ty.label, ...font('600'), color: t.ink }}>{cxUnit.toUpperCase()}</Text>
            </Pressable>
          </View>
          <View style={{ marginBottom: sp.lg }}>
            {cxRows.length ? (
              <SetLadder
                t={t} unit={cxUnit} rows={cxRows} movement={cxName.trim() || 'this exercise'}
                onPatch={(at, patch) => setCxRows((rows) => patchLadderRow(rows, at, patch))}
                note={null} />
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Say how many sets, and a row appears for each one — its own reps, its own weight. Leave a weight empty for no target.
              </Text>
            )}
          </View>
          <Pressable disabled={!cxName.trim()} onPress={commitCx} style={{ backgroundColor: cxName.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginBottom: sp.sm }}>
            <Text style={{ ...ty.label, ...font('600'), color: cxName.trim() ? t.brandInk : t.ink3 }}>{editingKey ? 'Save Changes' : 'Add to Today'}</Text>
          </Pressable>
          <Pressable onPress={() => { setAddOpen(false); setEditingKey(null); }} style={{ paddingVertical: sp.md, alignItems: 'center' }}><Text style={{ ...ty.label, ...font('500'), color: t.ink3 }}>Cancel</Text></Pressable>
        </View>
        </KeyboardAvoidingView>
      </Modal>
      <Confetti show={confetti} onDone={() => setConfetti(false)} />
    </SafeAreaView>
  );
}

// The set row and its two chips used to live here, as `LogRow` and
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
function useLiveVitals(age: number | null, restingKcalPerMin: number | null, paused = false, startedAtMs?: number | null, pausedMsSeed = 0) {
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
function ZonePanel({ t, liveZone, liveSample, zoneSecs, age, elapsed, reach, onPair }: {
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
function TimedSessionRunner({ t, kind, activity, age, restingKcalPerMin, defaultUnit, weightKg, sex, resumeAt, onSave, onClose }: {
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
                  ? 'Calories came from your watch for this session — change them if you would rather use the machine’s figure. Nothing here is required; leave a box empty and it is left out rather than saved as a zero.'
                  : 'The clock was measured; these were not. Nothing here is required — leave a box empty and it is left out rather than saved as a zero.'}
              </Text>
            </Section>
          )}

          {zoneSecondsTotal(zoneSecs) > 0 ? (<>
            <Section>
              <SectionHead title="Time in Zone" note={`${splatPoints(zoneSecs)} splat`} />
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
                Under a minute on the clock — too short to log, and rounding it up to one would be a figure you did not train.
              </Text>
              <Cta label="Close" wide onPress={onClose} />
            </View>
          )}
          <View style={{ marginTop: sp.md, alignItems: 'center' }}>
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
            That bpm is today&apos;s average from your connected device, not a live reading — it can&apos;t be used for zones.
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
function clipCaption(owner: ClipOwner): string {
  switch (owner) {
    case 'mine': return 'Recorded by your coach';
    // Real, published, and not theirs. Named as a coach's rather than as the
    // library's, because the library's means nobody's.
    case 'other': return `Recorded by a coach on ${BRAND.label}`;
    case 'platform': return `From the ${BRAND.label} library`;
    // Never the library's. There is no row behind this clip, nobody but this
    // device can see it, and no coach put it here for this member.
    case 'local': return 'Saved on this device only — not from the library, and not your coach’s';
  }
}

function SessionDemo({ t, name, videos, videoStatus, preferTrainerId, onNoMedia }: {
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
            <Flag tone={t.warn}>Evaluation asset — licensed for review only, never for release.</Flag>
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
          The equipment, not a demonstration — this is a machine rather than a movement.
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
    ? 'No demonstration for this one yet — no clip from your coach and no reference frames in the catalogue. Ask your coach how they want it done.'
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
function DayPicture({ t, names, videos, videoStatus, preferTrainerId }: {
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
type RunnerView = 'ready' | 'demo' | 'set';

function SessionRunner({ t, unit, distanceUnit, exercises, focus, nameOf, onSwap, age, restingKcalPerMin, log, logStatus, weightHistory, injuries, injuryStatus, videos, videoStatus, preferTrainerId, clientId, clientName, onComplete, onRetry, onClose, resumeAt }: { t: Theme; unit: WeightUnit; /** The distance unit the cardio boxes open on, the member's own — same source the standalone cardio timer uses. */ distanceUnit: DistanceUnit; exercises: ProgramExercise[]; focus: string; nameOf: (e: ProgramExercise) => string; /** Replace one movement for the rest of the plan, through the same `swaps` map the plan screen writes. Optional so a caller with no plan to write to still gets a runner. */ onSwap?: (e: ProgramExercise, alt: string) => void; age: number | null; restingKcalPerMin: number | null; log: WorkoutEntry[]; logStatus: LoadStatus; weightHistory: BodyweightHistory; injuries: Injury[]; /** How the read that produced `injuries` went. An empty list under anything but 'ready' means UNKNOWN, and the caution line below is drawn off that list — so without this the runner draws "no injury applies here" for a member whose disclosure never arrived. */ injuryStatus: LoadStatus; videos: VideoItem[]; videoStatus: LibraryStatus; preferTrainerId: string | null; clientId: string | null; clientName: string | null; onComplete: (entries: WorkoutEntry[]) => Promise<WriteOutcome>; onRetry: (entries: WorkoutEntry[]) => Promise<WriteOutcome>; onClose: () => void; /** Where a RESTORED session resumes. Null for one starting now. */ resumeAt?: { startedAt: number; pausedMs: number } | null }) {
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
  const [results, setResults] = useState<{ reps: number; kg: number; bw?: boolean; timed?: boolean }[][]>(() => exercises.map(() => []));
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
    setLoad(sug ? showLoad(sug.weight) : '');
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
            return `${n} set${n === 1 ? ' from this session was' : 's from this session were'} still on this phone and ${n === 1 ? 'is' : 'are'} back on screen. ${n === 1 ? 'It has' : 'They have'} not reached your log yet — finishing the session is what ${n === 1 ? 'saves it' : 'saves them'}.`;
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
    if (historyWhole && newE1 > 0 && newE1 > priorBest) {
      setPrMsg(`New PR on ${name}! ${fig(liftLabel(wkg, unit))} × ${r}`);
      prAt.current = done.length;
      setConfetti(true);
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
    setResults((prev) => { const n = prev.map((a) => [...a]); n[idx].push({ reps: r, kg: wkg, ...(bw ? { bw: true } : {}), ...(timed ? { timed: true } : {}) }); return n; });
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
    setReps(''); startRest(restAfter(methodAt(done.length), restSecondsFor(ex))); setPendingFeel(wkg);
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
        ? ` ${list(undone)} ${undone.length === 1 ? 'has' : 'have'} nothing logged and will be recorded as not done — not as zeroes, and not counted.`
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
                note={`${num(totalSets)} set${totalSets === 1 ? '' : 's'} are saved on this phone and listed below. They have not reached your log yet — they go up on their own the next time the app has signal, and it is safe to close this. Until then your streak, your records and your coach's dashboard do not know about them.`}>
                <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                  <Ghost label="Try Sending Now" onPress={() => { void retry(); }} />
                </View>
              </Notice>
            </View>
          ) : null}
          {saveState === 'idle' && totalSets === 0 ? (
            <View style={{ marginTop: sp.lg }}>
              <Notice tone={t.ink3} kicker="Nothing Logged" title="No Sets Were Recorded"
                note="Nothing has been written to your log, because nothing was entered. Close this and the session is simply not there — no empty workout, no dot on the calendar." />
            </View>
          ) : null}
          <Section>
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
                  {list(undone)} {undone.length === 1 ? 'has' : 'have'} no sets and {undone.length === 1 ? 'is' : 'are'} recorded as not done. {undone.length === 1 ? 'It is' : 'They are'} not in your log as zeroes and {undone.length === 1 ? 'does' : 'do'} not count against your figures — the session you did is the session above.
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
              <SectionHead title="Time in Zone" note={`${splatPoints(zoneSecs)} splat`} />
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
                  The clock was measured; these were not. Nothing here is required — leave a box empty and it is
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
              ? "Logged to your history — strength trends and your coach's dashboard update automatically."
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
          <Cta
            label={saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Close and Lose These Sets' : 'Done'}
            wide
            onPress={() => {
              if (saveState === 'saving') return;
              if (saveState !== 'failed') { forgetGuidedDraft(); onClose(); return; }
              Alert.alert(
                'Close Without Saving?',
                'These sets have not reached your log. Closing loses them — there is no copy anywhere else.',
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
  const plannedRest = restAfter(methodAt(done.length), restSecondsFor(ex));
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
        <Text style={{ ...ty.micro, color: t.nightInk2 }}>Exercise {idx + 1} of {exercises.length}{paused ? ' · Paused' : ''}</Text>
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
  const repsWord = (r: string) => (/^\d+(\s*[-–]\s*\d+)?$/.test(r.trim()) ? `${r.trim()} reps` : r);
  const prescription = `${plan.length} set${plan.length === 1 ? '' : 's'} × ${variedPlan ? 'varied' : repsWord(ex.reps)}`
    + (ex.loadKg != null && !variedPlan ? ' × ' + fig(liftLabel(ex.loadKg, unit)) : '')
    + (plannedRest > 0 && (ex.restSec != null || restIsMethods) ? ' · ' + restClock(plannedRest) + ' rest' : '');

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
          ? 'Still reading what you have disclosed — this movement has not been checked against your injuries yet.'
          : 'Your injuries could not be read, so this movement has not been checked against them. Nothing here has been swapped or held back — go easy if something is hurt.'}
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
      <Notice tone={t.s3} kicker="Personal Record" title={prMsg} />
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
          Not in your log yet — finishing the session is what saves {done.length === 1 ? 'it' : 'them'}.
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: sp.sm }}><Icon name="flame" size={14} color={t.s3} /><Text style={{ ...ty.micro, color: t.ink3 }}>Warm-up Ramp</Text></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
        {wu.map((ws, i) => <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{fig(liftLabel(ws.kg, unit))} × {ws.reps}</Text></View>)}
      </View>
      <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Ramp up first — these don't count as working sets.</Text>
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
          That bpm is today&apos;s average from your connected device, not a live reading — it can&apos;t be used for zones.
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
                  ? `All ${plan.length} sets done — set ${done.length + 1} is extra`
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
                onLabel={`Bodyweight Set — the box above is what you added, in ${unit}`}
                a11yHint={bwOn
                  ? `The box holds what you added on top of your own weight, in ${unit}. Turn this off for a set on a bar or a machine.`
                  : 'Turn this on for a pull-up, a dip or a press-up. Leaving the load box empty does the same thing.'} />
              <SetKindChip t={nt} on={timedOn} onToggle={() => setTimedOn((v) => !v)}
                label="Timed Set"
                onLabel="Timed Set — the first box is seconds held"
                a11yHint={timedOn
                  ? 'The first box is the seconds you held it for. Turn this off to count reps instead.'
                  : 'Turn this on for a plank, a hollow hold or a wall sit, where the set is a length of time rather than a count.'} />
            </View>

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
                    : `Just the bar — ${plain(bar)} ${unit}.`}
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
                    These plates do not make that exactly — the nearest under it is {plain(barLoad.total)} {unit}.
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
                <Text style={{ ...ty.caption, color: nt.ink3, marginTop: sp.sm }}>Tunes your next set — Easy adds weight, Hard eases it back.</Text>
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
                <TonedChip label={ex.group} tone={groupTone(ex.group)} />
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
                You have logged a set of this, so it can no longer be swapped — the sets would end up filed under the movement you swapped to.
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
                <Pressable accessibilityRole="button"
                  accessibilityLabel={`Start the ${restClock(plannedRest)} rest`}
                  onPress={() => startRest(plannedRest)}
                  style={{ borderRadius: radius.lg, padding: sp.lg, alignItems: 'center', marginTop: sp.xl, backgroundColor: t.night2 }}>
                  <Text style={{ ...ty.label, ...font('600'), color: t.nightInk }}>Start Rest</Text>
                  <Text style={{ ...ty.caption, ...numeric, color: t.nightInk2, marginTop: 2 }}>
                    {restClock(plannedRest)}{ex.restSec != null ? ' · set by your coach' : ` · app default`}
                  </Text>
                </Pressable>
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
function EditEntrySheet({ t, unit, entry, suggestions, onClose, onSave }: {
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
      Alert.alert('Not Saved', `Your correction did not reach your record, so this entry still reads as it did — on this phone as well. ${retryLine(reach)}`);
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
              Logged on {dayLabel}. Correcting it leaves it on that day — your calendar, streak and history all read it from there.
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
                Nothing in today's plan or your history matches that. Type the movement in full above — anything you type is accepted.
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
                  ? 'The minutes, distance and the heart-rate zones recorded against it stay — nobody can retype a heart rate, and they were measured whatever the session was called.'
                  : setCount > 0
                  ? `The ${setCount} set${setCount === 1 ? '' : 's'} below come with it, so you do not have to type them again. Your best one counts towards ${trimmed} from now on, and ${entry.exercise} falls back to whatever else you have logged against it — a record set on this work belongs to the movement you actually did.`
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
                Tick Bodyweight for a set you did with your own body — the load box is then whatever you added on top. Tick Timed for a hold, and the first box counts seconds.
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
