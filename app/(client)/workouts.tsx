// Train — the day's session on the instrument-panel kit (`src/ui/kit`) and the
// scale (`src/theme/scale`). Every provider, hook, conditional branch and route
// from the previous version is preserved; only the presentation changed: one
// hero figure instead of a stack of competing bold numbers, hairline-separated
// sections and list rows instead of eighteen bordered cards, and accent spent
// only on the live metric and the primary action.
// Guided session runner, cardio logging & month calendar preserved.
import { useState, useEffect, useRef, useCallback } from 'react';
import { maintenanceFor } from '../../src/lib/nutrition';
import { num } from '../../src/lib/format';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { tapLight } from '../../src/ui/haptics';
import { Icon } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Notice, fig, ChipGrid } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, numeric, value } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { buildProgram, type ProgramExercise } from '../../src/lib/programs';
import { useClientData } from '../../src/ui/clientData';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useWearables } from '../../src/ui/wearables';
import type { WorkoutEntry } from '../../src/lib/mockData';
import type { WorkoutSample } from '../../src/lib/wearables/types';
import { suggestForExercise, priorBest1RM } from '../../src/lib/progression';
import { est1RM } from '../../src/lib/streaks';
import { Confetti } from '../../src/ui/Confetti';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { importSources, withHr, useImportedIds, isLogged, fetchRecent } from '../../src/ui/watchImport';
import { parseWorkoutText } from '../../src/lib/workoutParse';
import { useExerciseVideos, type VideoItem, type LibraryStatus } from '../../src/ui/exerciseVideos';
import { ExerciseVideoBlock } from '../../src/ui/ExerciseVideo';
import { videoForExercise } from '../../src/lib/exerciseId';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { DidYouKnow } from '../../src/ui/DidYouKnow';
import { injuryFlag, areaLabel, type Injury } from '../../src/lib/injuries';
import { warmupSets, deloadCheck } from '../../src/lib/training';
import { hrColor, hrZoneNo, zoneOf, zoneKey, emptyZoneSeconds, splatPoints, zoneSecondsTotal, type ZoneSeconds, type ZoneNo } from '../../src/lib/hr';
import { ZoneNow, ZoneBoard } from '../../src/ui/ZoneBoard';
import { SessionMusicBar } from '../../src/ui/SessionMusicBar';
import { SessionHrSheet } from '../../src/ui/SessionHrSheet';
import { ageFromDob } from '../../src/lib/age';
import { RECOVERY_ACTIVITIES } from '../../src/lib/recoveryActs';
import { HIIT_ACTIVITIES, MOBILITY_ACTIVITIES } from '../../src/lib/workoutKind';
import { attributionLine } from '../../src/lib/workoutAttribution';
import { dayKeyOf, instantForDay, readWorkoutEdit } from '../../src/lib/entryEdit';
import { useSettings } from '../../src/ui/settings';
import { liftIn, liftLabel, readLift, plain, volumeHeadline, convertedNote, type WeightUnit } from '../../src/lib/units';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
const SESSION_TYPES: Record<'cardio' | 'hiit' | 'mobility' | 'recovery', string[]> = {
  cardio: CARDIO,
  hiit: names(HIIT_ACTS),
  mobility: names(MOBILITY_ACTS),
  recovery: names(RECOVERY_ACTS),
};
const WTYPES = [['strength', 'Program'], ['cardio', 'Cardio'], ['hiit', 'HIIT'], ['mobility', 'Mobility'], ['recovery', 'Recovery']] as const;

/** The four session types that are an activity and a clock rather than a list
 *  of lifts. Named because both the log form and the live runner below branch
 *  on it, and recovery has to stay distinguishable from the other three. */
type SessionKind = 'cardio' | 'hiit' | 'mobility' | 'recovery';
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
function MetricCols({ t, items }: { t: Theme; items: { label: string; value: string; dot?: string }[] }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {items.map((k, i) => (
        <View key={k.label} style={{ flex: 1, paddingRight: sp.md, paddingLeft: i === 0 ? 0 : sp.lg, borderLeftWidth: i === 0 ? 0 : hairline, borderLeftColor: t.ring }}>
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
  const _cp = useAssignedPrograms().getProgram(cd.id);
  const coachProgram = cd.coachingMode === 'solo' ? null : _cp;
  const w = useWearables();
  const { log: workoutLog, addWorkouts, updateWorkout, removeWorkout } = useWorkoutLog();
  // The unit the member reads a LOAD in. Deliberately left out of TF-37 —
  // barbell plates are metric hardware and tools.tsx does its plate maths
  // against a metric rack — and asked for since: "Need to be able to select kg
  // or pounds". Nothing below is stored in it. Every load reaching the log is
  // kilograms; this converts at the two edges, what is printed and what is
  // typed, through src/lib/units.ts.
  const wu = useSettings().weightUnit;
  const loadNote = convertedNote(wu);
  const program = coachProgram ?? buildProgram(cd.goal, cd.bodyFatPct);
  const jsToMon = (new Date().getDay() + 6) % 7;
  const [dayIdx, setDayIdx] = useState(jsToMon);
  // `?mode=recovery` lets the Recovery screen send somebody straight to the
  // right type, so logging a sauna is one tap from the screen that shows it.
  // Anything unrecognised falls back to the program, which is the default.
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const startMode = (['strength', 'cardio', 'hiit', 'mobility', 'recovery'] as const)
    .find((m) => m === modeParam) ?? 'strength';
  const [mode, setMode] = useState<'strength' | 'cardio' | 'hiit' | 'mobility' | 'recovery'>(startMode);
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  // `kg` is KILOGRAMS, whatever unit the member typed it in. The conversion
  // happens once, in `LogRow` at the keyboard, rather than being deferred to
  // the save — so a draft written in pounds and reopened after the setting is
  // changed still means the weight that was actually lifted, and `quickLog`
  // (whose suggestion is already metric) can hand a number straight in without
  // being converted a second time.
  const [logged, setLogged] = useState<Record<string, { reps: string; kg: string }[]>>({});

  const [cardioLog, setCardioLog] = useState<{ type: string; mins: number; dist: number; unit: string; kcal: number | null }[]>([]);
  const [nlw, setNlw] = useState('');
  const logWorkoutNL = async () => {
    // The member's unit, so a bare "135" means what it says on their plates.
    // Without it every unsuffixed number was read as kilograms, and a pounds
    // member logging "bench 3x8 @135" stored 297lb.
    const lifts = parseWorkoutText(nlw, wu);
    // The example is written in the member's own unit.
    if (!lifts.length) { Alert.alert('Could not read that', wu === 'lb' ? 'Try e.g. "bench 3x8 135lb, squat 225lb 5 5 5".' : 'Try e.g. "bench 3x8 60kg, squat 100kg 5 5 5".'); return; }
    const nowISO = new Date().toISOString();
    const saved = await addWorkouts(lifts.map((l) => ({ t: nowISO, exercise: l.exercise, sets: l.sets, kcal: Math.round(l.sets.reduce((a, [r, w]) => a + r * (w || 0), 0) / 60) + l.sets.length * 8 })));
    setNlw('');
    // "Logged" was said before anybody had asked the server. `addWorkouts`
    // resolves false on a refused write, and this is the sentence that stops it
    // being the same event as a successful one.
    if (saved) Alert.alert('Logged', `${lifts.length} exercise${lifts.length === 1 ? '' : 's'} added to today.`);
    else Alert.alert('Not saved', 'We could not reach your training log. What you typed is showing on this phone, but it has not been recorded and will be gone when you next open the app.');
  };
  const [swapFor, setSwapFor] = useState<ProgramExercise | null>(null);
  const [injRevealed, setInjRevealed] = useState<string[]>([]);
  const [deloadDismiss, setDeloadDismiss] = useState(false);
  const { videos: exVideos, status: exVideoStatus } = useExerciseVideos();
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
  const [session, setSession] = useState(false);
  // The started cardio / HIIT / mobility / recovery session, or null when none
  // is running. The kind is captured here rather than read from `mode` while the
  // modal is open, so a session that began as Recovery is still saved as
  // recovery even if the chips underneath are touched behind it.
  const [timed, setTimed] = useState<{ kind: SessionKind; activity: string } | null>(null);

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
    const m = (['strength', 'cardio', 'hiit', 'mobility', 'recovery'] as const).find((x) => x === modeParam);
    if (!m) return;
    setMode(m);
    if (m !== 'strength') setCtype(SESSION_TYPES[m][0]);
    router.setParams({ mode: undefined });
  }, [modeParam]);
 const [dist, setDist] = useState(''); const [unit, setUnit] = useState<'km' | 'mi'>('km');
  const [watts, setWatts] = useState(''); const [kcalIn, setKcalIn] = useState('');
  const [hrEntry, setHrEntry] = useState<WorkoutEntry | null>(null);
  const [showCal, setShowCal] = useState(false);
  const [selCalDay, setSelCalDay] = useState('');
  const [editEntry, setEditEntry] = useState<WorkoutEntry | null>(null);

  // Workouts recorded on a watch used to be importable only from Watch &
  // Devices, which is not a tab. People looked for them here, found nothing,
  // and concluded the app had dropped the session. Look for them here instead.
  // Nothing is written without a tap: a watch records plenty a person would not
  // choose to log, so this offers rather than assumes.
  const { ids: importedIds, mark: markImported } = useImportedIds();
  const [pending, setPending] = useState<WorkoutSample[]>([]);
  const [importing, setImporting] = useState(false);
  const canImport = importSources(w.states).length > 0;
  useFocusEffect(useCallback(() => {
    if (!canImport) { setPending([]); return; }
    let live = true;
    (async () => {
      const found = await fetchRecent(w.states, 14);
      if (live) setPending(found.filter((sm) => !isLogged(sm, importedIds, workoutLog)));
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canImport, importedIds, workoutLog.length]));
  const importPending = async () => {
    if (!pending.length || importing) return;
    setImporting(true);
    try {
      const saved = await addWorkouts(await Promise.all(pending.map(withHr)));
      // Marked imported ONLY once the rows are on the server. This used to mark
      // them regardless, so a refused write both lost the session and struck it
      // off the list of things still worth offering — the watch would never
      // suggest it again, and nothing said why.
      if (!saved) {
        Alert.alert('Not imported', 'We could not reach your training log, so nothing was imported. Your watch still has these — try again when you have signal.');
        return;
      }
      markImported(pending.map((sm) => sm.id));
      setPending([]);
      tapLight();
    } finally { setImporting(false); }
  };
  const [confetti, setConfetti] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [customEx, setCustomEx] = useState<ProgramExercise[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  // Exercises the user took off today, by uid. Today only — the programme
  // itself is not edited, so tomorrow's copy of the same lift still appears.
  const [removedEx, setRemovedEx] = useState<string[]>([]);
  // When set, the add sheet is editing this custom exercise rather than
  // creating one. Same sheet, because renaming IS replacing for a lift the
  // user typed themselves — it has no catalogue alternatives to swap to.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [cxName, setCxName] = useState(''); const [cxSets, setCxSets] = useState('3'); const [cxReps, setCxReps] = useState('10');
  const today0 = new Date();
  const monday0 = new Date(today0); monday0.setDate(today0.getDate() - jsToMon); monday0.setHours(0, 0, 0, 0);
  const dateFor = (i: number) => { const d = new Date(monday0); d.setDate(monday0.getDate() + i); return d; };
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
  const draftKey = `repple.workoutDraft.${dstr(dateFor(dayIdx))}`;
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    setDraftLoaded(false);
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(draftKey);
        if (!live) return;
        setLogged(raw ? JSON.parse(raw) : {});
      } catch { if (live) setLogged({}); }
      finally { if (live) setDraftLoaded(true); }
    })();
    return () => { live = false; };
  }, [draftKey]);

  useEffect(() => {
    // Only after the load has run, or the first render would immediately
    // overwrite a stored draft with the empty object it starts from.
    if (!draftLoaded) return;
    if (Object.keys(logged).length === 0) AsyncStorage.removeItem(draftKey).catch(() => {});
    else AsyncStorage.setItem(draftKey, JSON.stringify(logged)).catch(() => {});
  }, [logged, draftKey, draftLoaded]);
  // `dayKeyOf`, not `dstr(new Date(l.t))`. Same answer, one implementation: the
  // calendar dots, the day list and the day's totals all have to agree on which
  // day an entry belongs to, and three copies of the arithmetic is how they
  // stop agreeing. See src/lib/entryEdit.ts.
  const workedDates = new Set(workoutLog.map((l) => dayKeyOf(l.t)).filter((k): k is string => k != null));
  Object.keys(logged).forEach((k) => { if ((logged[k] || []).length) workedDates.add(dstr(dateFor(parseInt(k.split(':')[0], 10)))); });
  if (cardioLog.length) workedDates.add(dstr(today0));
  // Today's cardio, read from the saved log so it persists across navigation (not just this mount).
  const todayCardio = workoutLog
    .filter((l) => l.cardio && dayKeyOf(l.t) === dstr(today0))
    // `?? null`, not `?? 0`. The row below guards on `kcal != null` so it can
    // omit the figure entirely, and `?? 0` defeated that guard — a sauna, which
    // has no derivable burn, would have read "0 kcal". Zero is a measurement.
    .map((l) => ({ type: l.exercise, mins: l.cardio!.mins, dist: l.cardio!.dist, unit: l.cardio!.unit, watts: l.cardio!.watts ?? 0, kcal: l.kcal ?? null }));
  const calMonth = monday0.getMonth(), calYear = monday0.getFullYear();
  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const monthLabel = monday0.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

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
  const dayVolume = dayEntries.reduce((a, l) => a + (l.sets ? l.sets.reduce((x: number, s: number[]) => x + (s[0] || 0) * (s[1] || 0), 0) : 0), 0);
  const daySets = dayEntries.reduce((a, l) => a + (l.sets ? l.sets.length : 0), 0);
  const dayKcal = dayEntries.reduce((a, l) => a + (l.kcal || 0), 0);
  const dayHeadline = volumeHeadline(dayVolume, wu);
  const prettyDay = (ds: string) => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); };

  const programDays = Array.isArray(program && program.days) ? program.days : [];
  const workout = programDays[dayIdx % (programDays.length || 1)] || programDays[0] || { day: '', focus: 'Rest Day', exercises: [] };
  const exercises = Array.isArray(workout && workout.exercises) ? workout.exercises : [];
  const estMin = Math.max(20, exercises.length * 9);
  const uid = (e: ProgramExercise) => `${dayIdx}:${e.key}`;
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
  // Progress-photo focus areas bubble matching muscle groups to the top of today.
  const orderedExercises = cd.focusAreas.length ? [...exercises].sort((a, b) => (cd.focusAreas.includes(b.group) ? 1 : 0) - (cd.focusAreas.includes(a.group) ? 1 : 0)) : exercises;
  const deload = deloadCheck(workoutLog);
  // Default: expand the first not-yet-finished exercise, collapse the rest (until the user taps).
  const isRemovedEx = (e: ProgramExercise) => removedEx.indexOf(`${dayIdx}:${e.key}`) >= 0;
  const planEx = orderedExercises.filter((e) => !isRemovedEx(e));

  const isCustomEx = (e: ProgramExercise) => e.key.indexOf('custom-') === 0;

  /**
   * Delete something already in the log. Confirmed first, and believed only
   * when the server says the row is gone.
   *
   * The confirm was always here; what was missing is that the row left the
   * screen whether or not the delete landed, so a refused one looked done and
   * the session — with its volume and its calories — was back at the next
   * launch. `removeWorkout` resolves false in that case and leaves `log`
   * alone, and this says so rather than swallowing it.
   */
  const deleteEntry = (l: WorkoutEntry) => {
    Alert.alert(
      'Delete this entry?',
      `${l.exercise} will be removed from your log, and this day's volume and calories go down by it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          if (!(await removeWorkout(l))) {
            Alert.alert('Not deleted', `${l.exercise} is still in your log — we could not reach the server to remove it.`);
          }
        } },
      ],
    );
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
      'Remove ' + nameOf(e) + '?',
      hasSets
        ? 'It comes off today, and the sets you logged against it are discarded.'
        : 'It comes off today only. The rest of your programme is unchanged.',
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

  /** Replace an exercise. A programme lift swaps to a catalogue alternative;
   *  one the user typed has none, so it opens for editing instead. */
  const replaceExercise = (e: ProgramExercise) => {
    if (isCustomEx(e)) {
      setEditingKey(e.key);
      setCxName(e.name); setCxSets(String(e.sets)); setCxReps(String(e.reps));
      setAddOpen(true);
    } else setSwapFor(e);
  };

  /** Commit the add sheet. Only clears the draft once the exercise is really
   *  on the list — an interrupted sheet keeps what was typed. */
  const commitCx = () => {
    const name = cxName.trim();
    if (!name) return;
    const sets = parseInt(cxSets, 10) || 3;
    const reps = String(parseInt(cxReps, 10) || 10);
    if (editingKey) {
      // Same key, so sets already logged against it survive the rename.
      setCustomEx((prev) => prev.map((x) => (x.key === editingKey ? { ...x, name, sets, reps } : x)));
    } else {
      const key = 'custom-' + Date.now();
      setCustomEx((p) => [...p, { key, name, group: 'Added', sets, reps, alternatives: [] } as ProgramExercise]);
      setExpanded((p) => ({ ...p, [dayIdx + ':' + key]: true }));
    }
    setAddOpen(false); setEditingKey(null);
    setCxName(''); setCxSets('3'); setCxReps('10');
    tapLight();
  };
  const firstOpenId = (() => { for (const _e of [...planEx, ...customEx]) { const _u = `${dayIdx}:${_e.key}`; if ((logged[_u] || []).length < _e.sets) return _u; } return null; })();
  // Presentation only: how much of today's plan is already logged, for the hero ring.
  const doneCount = exercises.filter((e) => (logged[uid(e)] || []).length >= e.sets).length;
  const heroNote = exercises.length === 0
    ? 'Rest day — nothing scheduled'
    : `~${estMin} min` + (doneCount > 0 ? ` · ${doneCount} of ${exercises.length} done` : '');
  const logSet = (e: ProgramExercise, reps: string, kg: number | null) => { if (!reps) return; setLogged({ ...logged, [uid(e)]: [...(logged[uid(e)] || []), { reps, kg: kg == null ? '' : String(kg) }] }); tapLight(); };
  // One tap records the set the plan is asking for — TF-27, "can't tap an
  // exercise to log it". This function has existed here unreferenced: the only
  // way to record a set was to expand the row and type the two numbers the app
  // had already worked out and was showing you. It is offered next to that
  // suggestion, so the number you tap is the number you are looking at.
  const quickLog = (e: ProgramExercise) => { const sg = suggestForExercise(workoutLog, nameOf(e), e.reps); logSet(e, String(parseInt(e.reps, 10) || 8), sg ? sg.weight : null); };
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
    setCardioLog([{ type: activity, mins: m, dist: d, unit: u, kcal }, ...cardioLog]);
    const saved = await addWorkouts([{
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
    // memory — nobody can retype forty minutes of heart-rate zones — so a
    // refused write has to be said rather than swallowed.
    if (!saved) {
      Alert.alert('Not saved',
        `Your ${KIND_LABEL[kind].toLowerCase()} session did not reach the server. It is showing below on this phone, but it has not been recorded${extra.zones && zoneSecondsTotal(extra.zones) > 0 ? ', and the heart-rate zones go with it' : ''}.`);
      return false;
    }
    tapLight();
    return true;
  };

  const logCardio = () => {
    const m = parseInt(mins, 10) || 0; if (!m) return;
    void commitSession(mode === 'strength' ? 'cardio' : mode, ctype, m, {
      dist: parseFloat(dist) || 0,
      unit,
      watts: parseInt(watts, 10) || 0,
      kcal: parseInt(kcalIn, 10) || 0,
    });
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
    const entries: WorkoutEntry[] = [...exercises.filter((e) => !isRemovedEx(e)), ...customEx].map((e) => {
      const s = logged[uid(e)] || [];
      if (!s.length) return null;
      // Already kilograms — `LogRow` converted at the keyboard. Converting
      // again here would multiply a pounds member's load by 0.45 twice.
      const setPairs = s.map((x) => [parseInt(x.reps, 10) || 0, parseFloat(x.kg) || 0] as [number, number]);
      const bestE1 = Math.max(0, ...setPairs.map(([r, kg]) => (r && kg ? est1RM(kg, r) : 0)));
      if (bestE1 > priorBest1RM(workoutLog, nameOf(e))) pr = true;
      return { t: nowISO, exercise: nameOf(e), sets: setPairs, kcal: Math.round(setPairs.reduce((a, [r, kg]) => a + r * kg, 0) / 60) + s.length * 8 };
    }).filter(Boolean) as WorkoutEntry[];
    if (!entries.length) return;
    const saved = await addWorkouts(entries);
    // The draft is cleared only when the session is really on the server. It is
    // the only other copy of what was typed, and throwing it away on a refused
    // write is how an hour's training disappears — the exact complaint the
    // draft was added for.
    if (!saved) {
      Alert.alert('Not saved',
        'We could not reach your training log, so this session has not been recorded. Your sets are still here — leave the screen and come back when you have signal, and save again.',
        [{ text: 'OK' }]);
      return;
    }
    setLogged({}); setCustomEx([]);
    if (pr) setConfetti(true);
    Alert.alert('Workout saved', `${entries.length} exercise${entries.length === 1 ? '' : 's'} logged.${pr ? ' New personal record!' : ''} Your streak and records are updated.`, [{ text: 'Nice' }]);
  };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10, flex: 1, ...ty.body } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView ref={pageScroll} contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }} numberOfLines={1}>{coachProgram ? 'Coach plan' : program.title}</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Train</Text>
        </View>


        {/* One tip, at most once every twenty hours. Renders nothing the rest
            of the time — asked for as "once a workout session or once few
            days", and a card that greets you every visit is an interruption. */}
        <View style={{ marginTop: sp.lg }}>
          <DidYouKnow />
        </View>
        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
          <View style={{ flex: 1 }}>
            <Ghost label="Month Calendar" icon="calendar" onPress={() => { setSelCalDay(dstr(dateFor(dayIdx))); setShowCal(true); }} />
          </View>
          <View style={{ flex: 1 }}>
            <Ghost label="Book Session" icon="plus" onPress={() => router.push('/(client)/calendar')} />
          </View>
        </View>

        {/* ── day strip ──────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', gap: 5, marginTop: sp.lg }}>
          {WEEK.map((d, i) => {
            const on = i === dayIdx; const today = i === jsToMon; const dnum = dateFor(i).getDate(); const worked = workedDates.has(dstr(dateFor(i)));
            return (
              <Pressable key={d} onPress={() => setDayIdx(i)} style={{ flex: 1, paddingVertical: sp.sm, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.surface2 : 'transparent' }}>
                <Text style={{ ...ty.micro, letterSpacing: 0.3, color: on ? t.ink : today ? t.ink2 : t.ink3 }}>{d}</Text>
                <Text style={{ ...value(16), color: on ? t.ink : t.ink2, marginTop: 2 }}>{dnum}</Text>
                <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 5, backgroundColor: worked ? t.brand : 'transparent' }} />
              </Pressable>
            );
          })}
        </View>

        {/* ── the hero: today's session, one number ───────────────────────── */}
        <Hero
          label={`Today · ${workout.focus}`}
          figure={fig(exercises.length)}
          unit={exercises.length === 1 ? 'exercise' : 'exercises'}
          note={heroNote}
          arc={exercises.length > 0 ? doneCount / exercises.length : undefined}
          arcLabel="of today's exercises done"
          onPress={() => router.push('/(client)/week')}
        />
        {mode === 'strength' && exercises.length > 0 ? (
          <Cta label="Start Workout" wide onPress={() => setSession(true)} />
        ) : null}

        <Rule />

        {/* ── what you're logging ────────────────────────────────────────── */}
        <Section>
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: layout.section }}>
            {WTYPES.map(([id, label]) => {
              const on = mode === id;
              return (
                <Pressable key={id} onPress={() => { setMode(id); if (id !== 'strength') setCtype(SESSION_TYPES[id][0]); }}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? t.surface2 : 'transparent' }}>
                  <Text style={{ ...ty.label, fontWeight: on ? '500' : '400', color: on ? t.ink : t.ink3 }}>{label}</Text>
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
                <Notice tone={t.s3} kicker="Recovery" title="Time for a deload week"
                  note={`${deload.reason} Drop to ~60% of your usual sets or weight this week.`}>
                  <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                    <Ghost label="Dismiss" onPress={() => setDeloadDismiss(true)} />
                  </View>
                </Notice>
              ) : null}
              {cd.focusAreas.length > 0 ? (
                <Notice tone={t.brand} kicker="From your progress photo" title={`Emphasising ${cd.focusAreas.join(' · ')}`}
                  note="These moves come first today.">
                  <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                    <Ghost label="Clear" onPress={() => cd.setFocusAreas([])} />
                  </View>
                </Notice>
              ) : null}

              {[...planEx, ...customEx].map((e, ei) => {
                const _id = uid(e);
                if (isInjHidden(e)) {
                  const inj = injuryFlag(e.name, e.group, cd.injuries);
                  return (
                    <View key={e.key}>
                      {ei > 0 ? <Rule /> : null}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.lg }}>
                        <Icon name="heart" size={15} color={t.crit} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink3, textDecorationLine: 'line-through' }} numberOfLines={1}>{e.name}</Text>
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Hidden to protect your {inj ? areaLabel(inj.injury.area).toLowerCase() : 'injury'} (severe) — no safe swap in your plan.</Text>
                        </View>
                        <Ghost label="Show Anyway" onPress={() => setInjRevealed((prev) => [...prev, _id])} />
                      </View>
                    </View>
                  );
                }
                const sets = logged[_id] || []; const done = sets.length >= e.sets;
                const sug = suggestForExercise(workoutLog, nameOf(e), e.reps);
                const flag = injuryFlag(nameOf(e), e.group, cd.injuries);
                const autoFrom = injAutoMap[_id];
                const open = expanded[_id] ?? (_id === firstOpenId);
                const isCustom = e.key.indexOf('custom-') === 0;
                return (
                  <View key={e.key}>
                    {ei > 0 ? <Rule /> : null}
                    <View style={{ paddingVertical: sp.lg }}>
                      <Pressable accessibilityRole="button" accessibilityLabel={(open ? 'Collapse ' : 'Expand ') + nameOf(e)} onPress={() => setExpanded((p) => ({ ...p, [_id]: !open }))} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {done ? <Icon name="check" size={15} color={t.brand} /> : null}
                            <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }} numberOfLines={1}>{nameOf(e)}</Text>
                            {cd.focusAreas.includes(e.group) ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.brand }} />
                                <Text style={{ ...ty.micro, color: t.ink3 }}>Focus</Text>
                              </View>
                            ) : null}
                            {flag ? <Icon name="heart" size={13} color={t.s3} /> : null}
                          </View>
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{e.group} · {sets.length}/{e.sets} sets{!open && sug ? ' · ' + fig(liftLabel(sug.weight, wu)) : ''}</Text>
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel={'Remove ' + nameOf(e)} onPress={() => removeExercise(e)} hitSlop={8} style={{ padding: 4 }}><Icon name="minus" size={16} color={t.ink3} /></Pressable>
                        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon name="chevron" size={16} color={t.ink3} /></View>
                      </Pressable>
                      {sets.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: sp.md, alignItems: 'center' }}>
                          {sets.map((s, i) => (
                            <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5 }}>
                              {/* A blank load is a bodyweight set, and stays a
                                  dash rather than becoming "0" — see readLift. */}
                              <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{s.reps}×{fig(liftIn(s.kg === '' ? null : Number(s.kg), wu))} {wu}</Text>
                            </View>
                          ))}
                          <Pressable onPress={() => setLogged((prev) => { const n = { ...prev }; delete n[_id]; return n; })} hitSlop={6} style={{ paddingHorizontal: 4 }}>
                            <Text style={{ ...ty.caption, color: t.ink3 }}>clear</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {open ? (
                        <View>
                          {autoFrom ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
                              <Icon name="swap" size={13} color={t.brand} />
                              <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>Auto-swapped from {e.name} to protect you</Text>
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
                                {sug.up ? <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>↑</Text> : null}
                                <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }} numberOfLines={1}>{sug.reason}</Text>
                                {/* Tap the suggestion to take it. The row it
                                    fills in is still below, so a different
                                    weight is still one edit away. */}
                                <Pressable accessibilityRole="button" accessibilityLabel={`Log ${e.reps} reps at ${fig(liftLabel(sug.weight, wu))} of ${nameOf(e)}`} onPress={() => quickLog(e)}
                                  style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 6 }}>
                                  <Text style={{ ...ty.caption, fontWeight: '600', color: t.brand }}>Log this</Text>
                                </Pressable>
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
                            <Pressable accessibilityLabel={'Watch a demonstration of ' + nameOf(e)} accessibilityRole="button" onPress={() => router.push({ pathname: '/(client)/exercise', params: { name: nameOf(e), from: 'clientWorkouts' } })} style={{ width: 38, height: 38, backgroundColor: t.surface2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }}><Icon name="video" size={15} color={t.ink2} /></Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={isCustom ? 'Edit ' + nameOf(e) : 'Swap ' + nameOf(e)} onPress={() => replaceExercise(e)} style={{ width: 38, height: 38, backgroundColor: t.surface2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }}><Icon name={isCustom ? 'pencil' : 'swap'} size={15} color={flag ? t.s3 : t.ink2} /></Pressable>
                          </View>
                          <LogRow t={t} unit={wu} onLog={(reps, kg) => logSet(e, reps, kg)} />
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

              {exercises.length > 0 || customEx.length > 0 ? (
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Add an Exercise You Did" icon="plus" onPress={() => { setEditingKey(null); setAddOpen(true); }} />
                  {removedEx.filter((u) => u.indexOf(dayIdx + ':') === 0).length > 0 ? (
                    <Ghost label={`Put back ${removedEx.filter((u) => u.indexOf(dayIdx + ':') === 0).length} removed`} icon="swap" onPress={() => { setRemovedEx((prev) => prev.filter((u) => u.indexOf(dayIdx + ':') !== 0)); tapLight(); }} />
                  ) : null}
                </View>
              ) : null}

              {Object.keys(logged).some((k) => k.indexOf(dayIdx + ':') === 0 && (logged[k] || []).length > 0) ? (
                <View style={{ marginTop: sp.md }}>
                  <Cta label="Save Workout to Log" wide onPress={saveManual} />
                </View>
              ) : null}
            </View>
          ) : (
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.md }}>{KIND_LABEL[mode as SessionKind]} session</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {(SESSION_TYPES[(mode as SessionKind)] || CARDIO).map((ct) => (
                  <Pressable key={ct} onPress={() => setCtype(ct)} style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: ctype === ct ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: ctype === ct ? '500' : '400', color: ctype === ct ? t.brandInk : t.ink2 }}>{ct}</Text>
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
              <Cta label={`Start ${ctype}`} wide onPress={() => { setTimed({ kind: mode as SessionKind, activity: ctype }); tapLight(); }} />
              <Text style={{ ...ty.micro, color: t.ink3, marginTop: layout.section, marginBottom: sp.md }}>Or log one you have already done</Text>

              {/* Recovery is not cardio, and this form used to treat it as if it
                  were: logging a sauna asked for Distance, km and Avg watts.
                  None of those has a meaning for Breathwork, a Cold Plunge or a
                  Massage, and the note underneath was about bikes and rowers.
                  Calories go too — recoveryActs.ts is explicit that these are
                  thermoregulation rather than work, so a figure derived from
                  time and body weight would be invented. A recovery session is
                  how long it lasted. */}
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" placeholder="Time (min)" placeholderTextColor={t.ink3} style={inp} />
                {mode !== 'recovery' ? (
                  <>
                    <TextInput value={dist} onChangeText={setDist} keyboardType="numeric" placeholder="Distance" placeholderTextColor={t.ink3} style={inp} />
                    <Pressable onPress={() => setUnit(unit === 'km' ? 'mi' : 'km')} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, justifyContent: 'center' }}>
                      <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{unit}</Text>
                    </Pressable>
                  </>
                ) : null}
                <Pressable onPress={logCardio} style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Log</Text>
                </Pressable>
              </View>
              {mode !== 'recovery' ? (
                <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                  <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" placeholder="Avg watts (optional)" placeholderTextColor={t.ink3} style={inp} />
                  <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" placeholder="Calories (optional)" placeholderTextColor={t.ink3} style={inp} />
                </View>
              ) : null}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {mode === 'recovery'
                  ? 'Just how long it lasted. Recovery is not scored as calories burned — a sauna raises your heart rate, but the cost is keeping you cool rather than work done, so any figure here would be made up.'
                  : 'Bikes, rowers & ski ergs: add your avg watts. Logging an Apple Watch workout by hand? Enter the minutes and the calories it shows — leave distance blank for studio classes like Pilates.'}
              </Text>

              <View style={{ marginTop: layout.section }}>
                <SectionHead title="Today's Sessions" />
                {todayCardio.length > 0 ? (
                  todayCardio.map((c, i) => (
                    <View key={i}>
                      {i > 0 ? <Rule /> : null}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md, paddingVertical: sp.md }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.type}</Text>
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
        {stripEntries.length > 0 ? (<>
          <Rule />
          <Section>
            <SectionHead title="Already in Your Log" note={prettyDay(stripDay)} />
            {stripEntries.map((l, i) => (
              <View key={l.id ?? `${l.t}-${l.exercise}-${i}`}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize' }} numberOfLines={1}>{l.exercise}</Text>
                    <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 2 }} numberOfLines={1}>
                      {l.sets && l.sets.length
                        ? l.sets.map((st) => `${st[0]}×${fig(liftIn(st[1] || null, wu))}`).join('  ') + ` ${wu}`
                        : l.cardio
                        ? [`${l.cardio.mins} min`, l.cardio.dist > 0 ? `${l.cardio.dist} ${l.cardio.unit}` : null].filter(Boolean).join(' · ')
                        : 'Logged'}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={'Edit or replace ' + l.exercise} onPress={() => { tapLight(); setEditEntry(l); }} hitSlop={8}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                    <Icon name="pencil" size={14} color={t.ink2} />
                    <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink }}>Edit</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={'Delete ' + l.exercise} onPress={() => deleteEntry(l)} hitSlop={8} style={{ padding: 4 }}>
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

        <Rule />

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
              onFocus={() => { setTimeout(() => pageScroll.current?.scrollToEnd({ animated: true }), 120); }}
              onSubmitEditing={logWorkoutNL} returnKeyType="done" style={inp} />
            <Pressable onPress={logWorkoutNL} disabled={!nlw.trim()} accessibilityRole="button" accessibilityLabel="Log workout from text" style={{ backgroundColor: nlw.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: nlw.trim() ? t.brandInk : t.ink3 }}>Log</Text>
            </Pressable>
          </View>
        </Section>

        <Rule />

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          <SectionHead title="Go To" />
          {/* Wrapped, not scrolled sideways — see ChipGrid in src/ui/kit,
              which now carries this and the reasoning behind it. The coach
              dashboard had the identical row with the identical fault, which
              is why it is a component rather than a second copy. */}
          {/* Ordered by what somebody is DOING, not alphabetically and not by
              when each screen happened to be built. Four groups, in the order
              a session actually runs:

                before you start   Playlists · Scan Machine · Library
                what to do         This Week · Targets · When to Rest
                what you did       History · Trends · Records
                how you are        Recovery · Watch & Devices
                settings           Tools

              Labels are title case throughout. The row previously mixed
              "This Week" with "Scan machine" and "Watch & devices", and that
              last one contradicted the screen's OWN title, which has always
              been "Watch & Devices". */}
          <ChipGrid items={([
            ['play', 'Playlists', '/(client)/music'],
            ['camera', 'Scan Machine', '/(client)/scan-machine'],
            ['video', 'Library', '/(client)/library'],
            ['calendar', 'This Week', '/(client)/week'],
            ['trending', 'Targets', '/(client)/progression'],
            ['moon', 'When to Rest', '/(client)/restday'],
            ['clock', 'History', '/(client)/activity'],
            ['chart', 'Trends', '/(client)/trends'],
            ['trophy', 'Records', '/(client)/records'],
            ['water', 'Recovery', '/(client)/recovery'],
            ['heart', 'Watch & Devices', '/(client)/devices'],
            ['settings', 'Tools', '/(client)/tools'],
          ] as const).map(([icon, label, route]) => ({
            icon, label, key: route, onPress: () => router.push(route as any),
          }))} />
        </Section>

      </ScrollView>

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
            if (saved) { setEditEntry(null); tapLight(); }
            return saved;
          }}
        />
      ) : null}

      <Modal visible={!!swapFor} transparent animationType="slide" onRequestClose={() => setSwapFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setSwapFor(null)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, ...elevation.e2 }}>
          {swapFor && (<View>
            <Text style={{ ...ty.head, color: t.ink, textTransform: 'capitalize' }}>Swap {nameOf(swapFor)}</Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.md }}>Alternatives that hit the same muscles</Text>
            {[swapFor.name, ...swapFor.alternatives].map((alt, ai) => { const on = nameOf(swapFor) === alt; return (
              <View key={alt}>
                {ai > 0 ? <Rule /> : null}
                <Pressable onPress={() => { setSwaps({ ...swaps, [uid(swapFor)]: alt }); setSwapFor(null); }} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.md }}>
                  <Text style={{ ...ty.body, fontWeight: on ? '500' : '400', color: t.ink, textTransform: 'capitalize' }}>{alt}</Text>{on && <Icon name="check" size={16} color={t.brand} />}
                </Pressable>
              </View>); })}
          </View>)}
        </View>
      </Modal>


      <Modal visible={showCal} transparent animationType="slide" onRequestClose={() => setShowCal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setShowCal(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: 30, maxHeight: '88%', ...elevation.e2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
            <Text style={{ ...ty.head, color: t.ink, textTransform: 'capitalize' }}>{monthLabel}</Text>
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
                return (
                  <Pressable key={day} onPress={() => setSelCalDay(ds)} style={{ width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: worked ? t.brand : 'transparent', borderWidth: isSel ? 2 : isToday && !worked ? hairline : 0, borderColor: isSel ? t.ink : t.brand }}>
                      <Text style={{ ...ty.label, ...numeric, fontWeight: worked || isToday ? '600' : '400', color: worked ? t.brandInk : isToday ? t.brand : t.ink2 }}>{day}</Text>
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
                  <Text style={{ ...ty.label, color: t.ink3 }}>Rest day — no workout logged.</Text>
                ) : (
                  <View>
                    {pending.length ? (
                      <View style={{ marginBottom: sp.lg }}>
                        <Notice
                          kicker="FROM YOUR WATCH"
                          title={`${pending.length} workout${pending.length > 1 ? 's' : ''} not in your log`}
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
                    <View style={{ marginTop: sp.lg }}>
                      {dayEntries.map((l, i) => (
                        <View key={i}>
                          {i > 0 ? <Rule /> : null}
                          <View style={{ paddingVertical: sp.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize', flex: 1 }}>{l.exercise}</Text>
                              <Pressable accessibilityLabel={'Edit ' + l.exercise} onPress={() => setEditEntry(l)} hitSlop={8} style={{ padding: 4, marginRight: sp.sm }}><Icon name="pencil" size={16} color={t.ink3} /></Pressable>
                              {/* Confirmed, then verified. The confirm was already
                                  here; what was missing is that the row left the
                                  screen whether or not the server had removed it,
                                  so a refused delete looked done and the session
                                  was back — with its volume and calories — at the
                                  next launch. */}
                              <Pressable accessibilityLabel={'Delete ' + l.exercise} onPress={() => deleteEntry(l)} hitSlop={8} style={{ padding: 4, marginRight: -4 }}><Icon name="minus" size={16} color={t.crit} /></Pressable>
                            </View>
                            {l.sets ? (
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                                {l.sets.map((s: number[], j: number) => { const _f = (l.feel || [])[j]; const _fc = _f === 'easy' ? t.good : _f === 'hard' ? t.crit : null; return <View key={j} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}>{_fc ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: _fc }} /> : null}<Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{s[0]}×{fig(liftIn(s[1] || null, wu))} {wu}</Text></View>; })}
                              </View>
                            ) : l.cardio ? (
                              <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 5 }}>{[`${l.cardio.mins} min`, l.cardio.dist > 0 ? `${l.cardio.dist} ${l.cardio.unit}` : null, l.cardio.watts && l.cardio.watts > 0 ? `${l.cardio.watts} W` : null, l.cardio.hrAvg ? `♥ ${l.cardio.hrAvg} avg / ${l.cardio.hrHigh ?? l.cardio.hrAvg} hi` : null].filter(Boolean).join(' · ')}</Text>
                            ) : null}
                            {l.kcal ? <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 6 }}>{num(l.kcal)} kcal</Text> : null}
                            {/* Who put this in the log. Absent when you did it
                                yourself, which is almost always — so the line
                                only appears when it is telling you something.
                                `null` for the name on purpose: the client app has
                                no coach-name lookup yet, and attributionLine
                                renders "your coach" rather than a blank. Better a
                                true generic than a name fetched wrong. */}
                            {attributionLine(l, null, true) ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.brand }} />
                                <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>{attributionLine(l, null, true)}</Text>
                              </View>
                            ) : null}
                            <Pressable onPress={() => { tapLight(); setHrEntry(l); }} accessibilityRole="button" accessibilityLabel={'Heart rate for ' + l.exercise} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: sp.md, alignSelf: 'flex-start', backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                              <Icon name="heart" size={13} color={t.brand} />
                              <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>Heart rate</Text>
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
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>Days you trained · {workedDates.size} sessions logged · tap any day for details</Text>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={session} animationType="slide" onRequestClose={() => setSession(false)}>
        <SessionRunner t={t} unit={wu} exercises={planEx.filter((e) => !isInjHidden(e))} focus={workout.focus} nameOf={nameOf} age={ageFromDob(cd.dob)} restingKcalPerMin={restingKcalPerMin} log={workoutLog} injuries={cd.injuries} videos={exVideos} videoStatus={exVideoStatus} preferTrainerId={coachId} onComplete={addWorkouts} onClose={() => setSession(false)} />
      </Modal>

      {/* Mounted only while a session is running, so its clock starts at zero
          every time rather than carrying the last one's elapsed time. */}
      <Modal visible={timed != null} animationType="slide" onRequestClose={() => setTimed(null)}>
        {timed ? (
          <TimedSessionRunner
            t={t}
            kind={timed.kind}
            activity={timed.activity}
            age={ageFromDob(cd.dob)}
            restingKcalPerMin={restingKcalPerMin}
            defaultUnit={unit}
            onSave={(v) => { void commitSession(timed.kind, timed.activity, v.mins, v); setTimed(null); }}
            onClose={() => setTimed(null)}
          />
        ) : null}
      </Modal>

      {/* KeyboardAvoidingView, or the keyboard sits on top of the very fields
          this sheet exists to fill in — and every tap aimed at a covered field
          lands on the backdrop and closes the sheet instead. */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, paddingBottom: Math.max(insets.bottom, layout.gutter), ...elevation.e2 }}>
          <Text style={{ ...ty.head, color: t.ink }}>{editingKey ? 'Edit exercise' : 'Add an exercise'}</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>{editingKey ? 'Rename it, or change the sets and reps you are aiming for.' : "Log something you did that isn't in today's plan."}</Text>
          <TextInput value={cxName} onChangeText={setCxName} autoFocus returnKeyType="done" onSubmitEditing={commitCx} blurOnSubmit={false} placeholder="Exercise name (e.g. Cable fly)" placeholderTextColor={t.ink3} style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12, marginBottom: sp.md }} />
          <View style={{ flexDirection: 'row', gap: sp.md, marginBottom: sp.lg }}>
            <View style={{ flex: 1 }}><Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xs }}>Target sets</Text><TextInput value={cxSets} onChangeText={setCxSets} keyboardType="numeric" placeholderTextColor={t.ink3} style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} /></View>
            <View style={{ flex: 1 }}><Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.xs }}>Target reps</Text><TextInput value={cxReps} onChangeText={setCxReps} keyboardType="numeric" placeholderTextColor={t.ink3} style={{ ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }} /></View>
          </View>
          <Pressable disabled={!cxName.trim()} onPress={commitCx} style={{ backgroundColor: cxName.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginBottom: sp.sm }}>
            <Text style={{ ...ty.label, fontWeight: '600', color: cxName.trim() ? t.brandInk : t.ink3 }}>{editingKey ? 'Save changes' : 'Add to today'}</Text>
          </Pressable>
          <Pressable onPress={() => { setAddOpen(false); setEditingKey(null); }} style={{ paddingVertical: sp.md, alignItems: 'center' }}><Text style={{ ...ty.label, fontWeight: '500', color: t.ink3 }}>Cancel</Text></Pressable>
        </View>
        </KeyboardAvoidingView>
      </Modal>
      <SessionHrSheet
        visible={!!hrEntry}
        onClose={() => setHrEntry(null)}
        title={hrEntry?.exercise || ''}
        startISO={hrEntry?.t || new Date().toISOString()}
        durationMin={hrEntry ? (hrEntry.cardio?.mins || Math.max(20, (hrEntry.sets?.length || 0) * 4)) : 45}
        age={ageFromDob(cd.dob)}
      />
      <Confetti show={confetti} onDone={() => setConfetti(false)} />
    </SafeAreaView>
  );
}

/**
 * The two boxes that record one set.
 *
 * The load is read through `readLift` rather than `parseFloat(kg) || 0`, which
 * is what this shipped with: a fat-fingered load became a confident 0, and a
 * 0 in a set row is a BODYWEIGHT set as far as the volume, the estimated 1RM
 * and next session's target are concerned. A typo is not a claim that the bar
 * was empty, so it is refused instead — and the bound in that refusal is
 * stated in the unit on the keyboard, because telling somebody typing pounds
 * that 1,000 is impossible would be wrong.
 *
 * What leaves here is kilograms. The unit is a reading and typing convention;
 * the record is metric, and the coach's console reads the same row.
 */
function LogRow({ t, unit, onLog }: { t: Theme; unit: WeightUnit; onLog: (reps: string, kg: number | null) => void }) {
  const [reps, setReps] = useState(''); const [kg, setKg] = useState('');
  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9, flex: 1, ...ty.body } as const;
  return (
    <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
      <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
      <TextInput value={kg} onChangeText={setKg} keyboardType="numeric" placeholder={unit} placeholderTextColor={t.ink3} style={inp} />
      <Pressable onPress={() => {
        const read = readLift(kg, unit);
        // Left in the box on a refusal, with the reason said, rather than
        // cleared — the number was typed once and the app has no better guess.
        if (!read.ok) { Alert.alert('Check that load', read.reason); return; }
        onLog(reps, read.kg); setReps(''); setKg('');
      }} style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
        <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Log set</Text>
      </Pressable>
    </View>
  );
}

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
function useLiveVitals(age: number | null, restingKcalPerMin: number | null) {
  const w = useWearables();
  const liveSample = w.today.heartRateLatest;          // a real, current reading
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
  const startedAtRef = useRef(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    const q = setInterval(() => w.syncAll(), 10000);
    w.syncAll();
    return () => { clearInterval(tick); clearInterval(q); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (typeof liveSample === 'number' && liveSample > 0) setHrPeak((p) => (p == null || liveSample > p ? liveSample : p)); }, [liveSample]);

  // Time in zone, accumulated a second at a time against the latest reading.
  // `hrRef` keeps the tick reading the current bpm without re-arming the interval.
  const [zoneSecs, setZoneSecs] = useState<ZoneSeconds>(emptyZoneSeconds);
  const hrRef = useRef<number | null>(null);
  hrRef.current = typeof liveSample === 'number' && liveSample > 0 ? liveSample : null;
  useEffect(() => {
    const z = setInterval(() => {
      const bpm = hrRef.current;
      if (!bpm) return; // no reading → bank nothing, rather than crediting zone 1
      setZoneSecs((p) => ({ ...p, [zoneKey(zoneOf(bpm, age))]: p[zoneKey(zoneOf(bpm, age))] + 1 }));
    }, 1000);
    return () => clearInterval(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [age]);

  return { w, elapsed, liveSample, liveHr, hrPeak, sessionKcal, zoneSecs, liveZone: hrZoneNo(liveSample, age) };
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
function ZonePanel({ t, liveZone, liveSample, zoneSecs }: {
  t: Theme; liveZone: ZoneNo | null; liveSample: number | null; zoneSecs: ZoneSeconds;
}) {
  const hasZones = zoneSecondsTotal(zoneSecs) > 0;
  if (!liveZone && !hasZones) {
    return (
      <View style={{ marginTop: sp.xl, paddingVertical: sp.md, paddingHorizontal: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm }}>
        <Text style={{ ...ty.label, fontWeight: '600', color: t.ink }}>Heart-rate zones</Text>
        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>
          Connect a watch under Train → Watch &amp; devices and your zones appear here live while you train.
        </Text>
      </View>
    );
  }
  return (
    <View style={{ marginTop: sp.xl }}>
      <ZoneNow zone={liveZone} bpm={liveSample ?? null} compact />
      {hasZones ? (
        <View style={{ marginTop: sp.lg }}>
          <ZoneBoard seconds={zoneSecs} current={liveZone} />
        </View>
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
function TimedSessionRunner({ t, kind, activity, age, restingKcalPerMin, defaultUnit, onSave, onClose }: {
  t: Theme; kind: SessionKind; activity: string; age: number | null; restingKcalPerMin: number | null; defaultUnit: string;
  onSave: (v: { mins: number; dist: number; unit: string; watts: number; kcal: number | null; zones: ZoneSeconds }) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 44);
  const { w, elapsed, liveSample, liveHr, hrPeak, sessionKcal, zoneSecs, liveZone } = useLiveVitals(age, restingKcalPerMin);
  const [finalElapsed, setFinalElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [confetti, setConfetti] = useState(false);
  // Distance, watts and calories are only ever what the person tells us. The
  // clock is measured; these are not, so they stay blank until typed and a
  // blank one is written as "no figure" rather than as a zero.
  const [dist, setDist] = useState(''); const [unit, setUnit] = useState(defaultUnit);
  const [watts, setWatts] = useState(''); const [kcalIn, setKcalIn] = useState('');
  const recovery = kind === 'recovery';
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // The log stores whole minutes, so anything under thirty seconds rounds to
  // nothing. Rather than round it up to a minute it never lasted, the save is
  // withheld and says why — a session too short to record is not a session.
  const finalMins = Math.round(finalElapsed / 60);

  const finish = () => {
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
      `Discard this ${KIND_LABEL[kind].toLowerCase()} session?`,
      `${clock(elapsed)} on the clock. Nothing is written to your log.`,
      [{ text: 'Keep going', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: onClose }],
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
          {zoneSecondsTotal(zoneSecs) > 0 ? (<>
            <Section>
              <SectionHead title="Time in Zone" note={`${splatPoints(zoneSecs)} splat`} />
              <ZoneBoard seconds={zoneSecs} showSplat={false} />
            </Section>
            <Rule />
          </>) : null}

          {recovery ? (
            <Section>
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                Recovery records how long it lasted, and nothing else. A sauna raises your heart rate, but the cost is
                keeping you cool rather than work done, so a distance or a calorie figure here would be made up.
              </Text>
            </Section>
          ) : (
            <Section>
              <SectionHead title="Anything to Add" />
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <TextInput value={dist} onChangeText={setDist} keyboardType="numeric" placeholder="Distance" placeholderTextColor={t.ink3} style={inp} />
                <Pressable onPress={() => setUnit(unit === 'km' ? 'mi' : 'km')} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, justifyContent: 'center' }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{unit}</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" placeholder="Avg watts (optional)" placeholderTextColor={t.ink3} style={inp} />
                <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" placeholder="Calories (optional)" placeholderTextColor={t.ink3} style={inp} />
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {sessionKcal != null && sessionKcal > 0
                  ? 'Calories came from your watch for this session — change them if you would rather use the machine’s figure. Nothing here is required; leave a box empty and it is left out rather than saved as a zero.'
                  : 'The clock was measured; these were not. Nothing here is required — leave a box empty and it is left out rather than saved as a zero.'}
              </Text>
            </Section>
          )}

          {finalMins > 0 ? (
            <Cta label="Save to Your Log" wide onPress={() => onSave({
              mins: finalMins,
              dist: parseFloat(dist) || 0,
              unit,
              watts: parseInt(watts, 10) || 0,
              kcal: parseInt(kcalIn, 10) || 0,
              zones: zoneSecs,
            })} />
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
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Wear your Apple Watch for live heart rate{recovery ? '' : ' & calories'}</Text>
        ) : liveSample == null ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            That bpm is today&apos;s average from your connected device, not a live reading — it can&apos;t be used for zones.
            Live zones need an Apple Watch.
          </Text>
        ) : null}

        <ZonePanel t={t} liveZone={liveZone} liveSample={liveSample ?? null} zoneSecs={zoneSecs} />

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

function SessionRunner({ t, unit, exercises, focus, nameOf, age, restingKcalPerMin, log, injuries, videos, videoStatus, preferTrainerId, onComplete, onClose }: { t: Theme; unit: WeightUnit; exercises: ProgramExercise[]; focus: string; nameOf: (e: ProgramExercise) => string; age: number | null; restingKcalPerMin: number | null; log: WorkoutEntry[]; injuries: Injury[]; videos: VideoItem[]; videoStatus: LibraryStatus; preferTrainerId: string | null; onComplete: (entries: WorkoutEntry[]) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 44);
  const { w, elapsed, liveSample, liveHr, hrPeak, sessionKcal, zoneSecs, liveZone } = useLiveVitals(age, restingKcalPerMin);
  const [finalElapsed, setFinalElapsed] = useState(0);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<{ reps: number; kg: number }[][]>(() => exercises.map(() => []));
  // `load` is TEXT in the member's own unit; `results` is kilograms. The
  // conversion happens at this one keyboard, so everything downstream of the
  // runner — the PR check, the warm-up ramp, the entries written to the log —
  // goes on working in the metric the rest of the app is built on.
  const [reps, setReps] = useState(''); const [load, setLoad] = useState('');
  const showLoad = (kg: number) => (kg ? plain(liftIn(kg, unit) ?? 0) : '');
  const [rest, setRest] = useState(0);
  // Whether the demonstration is on screen for the current exercise.
  //
  // It is deliberately its own flag rather than `rest > 0`. Opening it with the
  // first rest period puts the movement in front of the one person who has 90
  // seconds and a reason to look at it; tying it to the timer would then rip the
  // clip away at 0:00 from someone still watching. It never opens itself over a
  // set in progress — the toggle is there if they want it sooner.
  const [demoOpen, setDemoOpen] = useState(false);
  const [rpes, setRpes] = useState<('easy' | 'ok' | 'hard')[][]>(() => exercises.map(() => []));
  const [pendingFeel, setPendingFeel] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [prMsg, setPrMsg] = useState<string | null>(null);
  const rid = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (rest <= 0) { if (rid.current) clearInterval(rid.current); return; }
    rid.current = setInterval(() => setRest((r) => (r <= 1 ? 0 : r - 1)), 1000);
    return () => { if (rid.current) clearInterval(rid.current); };
  }, [rest > 0]);

  useEffect(() => {
    const sug = suggestForExercise(log, nameOf(exercises[idx]), exercises[idx].reps);
    setLoad(sug ? showLoad(sug.weight) : '');
    setReps('');
    setPrMsg(null);
    setPendingFeel(null);
    setDemoOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const ex = exercises[idx];
  const done = results[idx] || [];
  const logSet = () => {
    const r = parseInt(reps, 10) || 0; if (!r) return;
    // Refused rather than coerced: `parseFloat(kg) || 0` is what this shipped
    // with, and a mistyped load silently becoming 0 records a bodyweight set
    // in the middle of a session and drags the volume, the PR check and the
    // next session's target down with it.
    const read = readLift(load, unit);
    if (!read.ok) { Alert.alert('Check that load', read.reason); return; }
    const wkg = read.kg ?? 0;
    const name = nameOf(exercises[idx]);
    const newE1 = wkg && r ? est1RM(wkg, r) : 0;
    const priorBest = Math.max(priorBest1RM(log, name), ...done.map((s) => (s.kg && s.reps ? est1RM(s.kg, s.reps) : 0)), 0);
    if (newE1 > 0 && newE1 > priorBest) { setPrMsg(`New PR on ${name}! ${fig(liftLabel(wkg, unit))} × ${r}`); setConfetti(true); }
    setResults((prev) => { const n = prev.map((a) => [...a]); n[idx].push({ reps: r, kg: wkg }); return n; });
    // Only after the first set of an exercise. By set three they have done the
    // movement three times and do not need it offered again.
    if (done.length === 0) setDemoOpen(true);
    setReps(''); setRest(90); setPendingFeel(wkg);
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
  const finish = () => {
    const nowISO = new Date().toISOString();
    const entries: WorkoutEntry[] = results
      .map((sets, i) => (sets.length ? {
        t: nowISO,
        exercise: nameOf(exercises[i]),
        sets: sets.map((s) => [s.reps, s.kg]) as [number, number][],
        feel: (rpes[i] && rpes[i].length) ? rpes[i] : undefined,
        kcal: Math.round(sets.reduce((a, s) => a + s.reps * (s.kg || 0), 0) / 60) + sets.length * 8,
        // Only attach zones when a heart-rate source actually fed the session.
        zones: zoneSecondsTotal(zoneSecs) > 0 ? zoneSecs : undefined,
      } : null))
      .filter(Boolean) as WorkoutEntry[];
    onComplete(entries);
    setFinalElapsed(elapsed); setFinished(true); setConfetti(true);
  };
  const next = () => { if (idx < exercises.length - 1) { setIdx(idx + 1); setRest(0); } else finish(); };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12, flex: 1, ...ty.head, fontWeight: '400' } as const;

  if (!exercises || exercises.length === 0) return null;
  if (finished) {
    const totalSets = results.reduce((a, r) => a + r.length, 0);
    const volume = results.reduce((a, r) => a + r.reduce((x, s) => x + s.reps * s.kg, 0), 0);
    const exDone = results.filter((r) => r.length > 0).length;
    const strip: { label: string; value: string; dot?: string }[] = [
      { label: 'Time', value: `${Math.floor(finalElapsed / 60)}:${String(finalElapsed % 60).padStart(2, '0')}` },
    ];
    if (sessionKcal != null) strip.push({ label: 'kcal burned', value: fig(sessionKcal) });
    if (hrPeak != null) strip.push({ label: 'Peak Bpm', value: fig(hrPeak), dot: hrColor(hrPeak, age) });
    if (typeof w.today.heartRateAvg === 'number') strip.push({ label: 'Avg Bpm', value: fig(w.today.heartRateAvg) });
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 10 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ alignItems: 'center', marginTop: sp.xl }}><Icon name="trophy" size={40} color={t.brand} /></View>
          <Text style={{ ...ty.title, color: t.ink, textAlign: 'center', marginTop: sp.md }}>Session Complete</Text>
          <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs, textTransform: 'capitalize' }}>{focus}</Text>
          <Section>
            <KpiRow items={[
              { label: 'Exercises', value: `${exDone}/${exercises.length}` },
              { label: 'Sets', value: fig(totalSets) },
              // See volumeHeadline: tonnes for a metric reader, pounds for an imperial
      // one, because a short ton is 10% off a tonne and would read as the same
      // unit to anybody comparing this with a coach's console.
      { label: 'Volume', value: `${volumeHeadline(volume, unit)!.figure.toLocaleString()}${unit === 'kg' ? 't' : ''}`, unit: unit === 'lb' ? 'lb' : undefined },
            ]} />
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
          <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.xl, marginBottom: sp.xl }}>Logged to your history — strength trends and your coach's dashboard update automatically.</Text>
          <Cta label="Done" wide onPress={onClose} />
        </ScrollView>
        <Confetti show={confetti} onDone={() => setConfetti(false)} />
      </SafeAreaView>
    );
  }

  const liveCols: { label: string; value: string; dot?: string }[] = [
    { label: 'Time', value: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` },
    { label: 'bpm', value: fig(liveHr ?? '–'), dot: liveHr ? hrColor(liveHr, age) : undefined },
    { label: 'kcal', value: fig(sessionKcal ?? '–') },
    { label: 'Peak', value: fig(hrPeak ?? '–'), dot: hrPeak ? hrColor(hrPeak, age) : undefined },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 4 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp.lg }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Exercise {idx + 1} of {exercises.length}</Text>
          <Ghost label="End" onPress={onClose} />
        </View>
        <View style={{ flexDirection: 'row', gap: 5, marginBottom: sp.xl }}>
          {exercises.map((_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i < idx ? t.good : i === idx ? t.brand : t.surface3 }} />)}
        </View>

        <MetricCols t={t} items={liveCols} />
        {liveHr == null ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>Wear your Apple Watch for live heart rate &amp; calories</Text>
        ) : liveSample == null ? (
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            That bpm is today&apos;s average from your connected device, not a live reading — it can&apos;t be used for zones.
            Live zones need an Apple Watch.
          </Text>
        ) : null}

        {/* Live effort, and the same empty state as a timed session when there
            is no watch feeding it — see ZonePanel. */}
        <ZonePanel t={t} liveZone={liveZone} liveSample={liveSample ?? null} zoneSecs={zoneSecs} />

        {/* TF-36 — reachable without leaving the session. It renders nothing
            but an honest line when Spotify is not connected or the account
            cannot drive playback, so it costs a disconnected client no space
            they would resent. */}
        <SessionMusicBar />

        {prMsg ? (
          <View style={{ marginTop: sp.xl }}>
            <Notice tone={t.s3} kicker="Personal record" title={prMsg} />
          </View>
        ) : null}

        <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xl, textTransform: 'capitalize' }}>{nameOf(ex)}</Text>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.xs }}>{ex.group} · target {ex.sets} × {ex.reps}</Text>
        {(() => { const f = injuryFlag(nameOf(ex), ex.group, injuries); return f ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.s3 }} />
            <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{f.reason}. Ease off, keep it pain-free, or swap this move.</Text>
          </View>
        ) : null; })()}

        {rest > 0 ? (
          <View style={{ backgroundColor: t.brand, borderRadius: radius.md, padding: sp.xl, alignItems: 'center', marginTop: sp.xl }}>
            <Text style={{ ...ty.micro, color: t.brandInk }}>Rest</Text>
            <Text style={{ ...value(40), color: t.brandInk, marginTop: sp.xs }}>{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Skip the rest timer" onPress={() => setRest(0)} hitSlop={8} style={{ marginTop: sp.sm }}><Text style={{ ...ty.label, fontWeight: '500', color: t.brandInk }}>Skip rest</Text></Pressable>
          </View>
        ) : null}

        {/* The movement, playing here rather than in a browser. A client mid-set
            who is unsure of their form had no way to see the lift from this
            screen at all — the only demo in the app was back on the plan, behind
            leaving the session. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={(demoOpen ? 'Hide the demonstration of ' : 'Watch a demonstration of ') + nameOf(ex)}
          onPress={() => { setDemoOpen((v) => !v); tapLight(); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.xl }}
        >
          <Icon name="video" size={14} color={t.ink3} />
          <Text style={{ ...ty.micro, color: t.ink3, flex: 1 }}>{demoOpen ? 'Hide the demo' : 'Watch this movement'}</Text>
          <View style={{ transform: [{ rotate: demoOpen ? '90deg' : '0deg' }] }}><Icon name="chevron" size={14} color={t.ink3} /></View>
        </Pressable>
        {/* No onSearch here, unlike the plan screen. A live session's sets live
            in this component's state and nowhere else, so sending the client to
            the browser risks the OS reclaiming the app and taking the whole
            session with it. "No demonstration yet" is the honest answer; losing
            an hour of logged work to a web search is not a fair price for it. */}
        {demoOpen ? (
          <ExerciseVideoBlock
            video={videoForExercise(nameOf(ex), videos, preferTrainerId)}
            exerciseName={nameOf(ex)}
            status={videoStatus}
          />
        ) : null}

        {done.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.xl }}>
            {done.map((s, i) => { const f = (rpes[idx] || [])[i]; const fc = f === 'easy' ? t.good : f === 'hard' ? t.crit : t.ink3; return (<View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 11, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6 }}>{f ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fc }} /> : null}<Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>Set {i + 1}: {s.reps}×{fig(liftIn(s.kg || null, unit))} {unit}</Text></View>); })}
          </View>
        ) : null}

        {/* The ramp is worked out from the working load in kilograms — its
            percentages are of the bar, not of a converted figure — and each
            rung is read out in the member's unit. */}
        {done.length === 0 ? (() => { const readTop = readLift(load, unit); const wu = warmupSets(readTop.ok ? (readTop.kg ?? 0) : 0); return wu.length ? (
          <View style={{ marginTop: sp.xl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: sp.sm }}><Icon name="flame" size={14} color={t.s3} /><Text style={{ ...ty.micro, color: t.ink3 }}>Warm-up ramp</Text></View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {wu.map((ws, i) => <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{fig(liftLabel(ws.kg, unit))} × {ws.reps}</Text></View>)}
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Ramp up first — these don't count as working sets.</Text>
          </View>
        ) : null; })() : null}

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xl, marginBottom: sp.sm }}>Log set {done.length + 1} · reps × {unit}</Text>
        <View style={{ flexDirection: 'row', gap: sp.md }}>
          <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
          <TextInput value={load} onChangeText={setLoad} keyboardType="numeric" placeholder={unit} placeholderTextColor={t.ink3} style={inp} />
          <Pressable accessibilityLabel="Log set" accessibilityRole="button" onPress={logSet} style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingHorizontal: 22, justifyContent: 'center' }}><Icon name="check" size={18} color={t.brandInk} /></Pressable>
        </View>

        {pendingFeel != null ? (
          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.md }}>How did that set feel?</Text>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              {(([['easy', 'Easy', t.good], ['ok', 'Just right', t.brand], ['hard', 'Hard', t.crit]]) as ['easy' | 'ok' | 'hard', string, string][]).map(([f, lbl, c]) => (
                <Pressable key={f} onPress={() => chooseFeel(f)} style={{ flex: 1, backgroundColor: t.surface2, borderRadius: radius.sm, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{lbl}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Tunes your next set — Easy adds weight, Hard eases it back.</Text>
          </View>
        ) : null}

        <View style={{ marginTop: sp.xl }}>
          {done.length >= ex.sets
            ? <Cta label={idx < exercises.length - 1 ? 'Next Exercise →' : 'Finish Session'} wide onPress={next} />
            : <Ghost label={idx < exercises.length - 1 ? 'Next Exercise →' : 'Finish Session'} onPress={next} />}
        </View>
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
  const [name, setName] = useState(entry.exercise);
  // Reps and load as TEXT, in the member's unit, converted once on the way in
  // and once on the way out. A blank load is a bodyweight set and stays blank.
  const [rows, setRows] = useState<{ reps: string; load: string }[]>(() =>
    (entry.sets ?? []).map(([r, kg]) => ({
      reps: r ? String(r) : '',
      load: kg ? plain(liftIn(kg, unit) ?? 0) : '',
    })));
  const [mins, setMins] = useState(entry.cardio ? String(entry.cardio.mins) : '');
  const [dist, setDist] = useState(entry.cardio ? String(entry.cardio.dist) : '');
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
    const sets: [number, number][] = [];
    for (let i = 0; i < rows.length; i++) {
      const read = readLift(rows[i].load, unit);
      if (!read.ok) { Alert.alert(`Check set ${i + 1}`, read.reason); return; }
      sets.push([parseInt(rows[i].reps, 10) || 0, read.kg ?? 0]);
    }
    const read = readWorkoutEdit(entry, { name, sets, mins, dist, watts, kcal });
    if (!read.ok) { Alert.alert('Check that', read.reason); return; }
    setBusy(true);
    const saved = await onSave(read.value);
    setBusy(false);
    // Left open on failure with everything still typed in it. The caller has
    // left the log untouched, so closing here would both throw the correction
    // away and imply it had been taken.
    if (!saved) {
      Alert.alert('Not saved', 'Your correction did not reach the server, so this entry still reads as it did — on this phone as well. Check your connection and save again.');
    }
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10, ...ty.body } as const;
  const setCount = rows.filter((r) => (parseInt(r.reps, 10) || 0) > 0).length;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '86%', ...elevation.e2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: sp.lg }}>
          <Pressable onPress={onClose} hitSlop={8}><Text style={{ ...ty.body, fontWeight: '500', color: t.ink3 }}>Cancel</Text></Pressable>
          <Text style={{ ...ty.head, color: t.ink }}>Edit entry</Text>
          <Pressable onPress={save} hitSlop={8} disabled={busy}><Text style={{ ...ty.body, fontWeight: '600', color: busy ? t.ink3 : t.brand }}>{busy ? 'Saving…' : 'Save'}</Text></Pressable>
        </View>
        <Rule />
        <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {dayLabel ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              Logged on {dayLabel}. Correcting it leaves it on that day — your calendar, streak and history all read it from there.
            </Text>
          ) : null}
          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>EXERCISE</Text>
          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
            <TextInput value={name} onChangeText={setName} style={{ ...inp, flex: 1 }} placeholder="Exercise" placeholderTextColor={t.ink3} />
            {/* The affordance the report was missing. The field underneath has
                always accepted a different name; nothing said so, and nobody
                types a movement they can be offered. */}
            <Pressable accessibilityRole="button" accessibilityLabel={picking ? 'Hide the list of movements' : 'Replace with another movement'}
              onPress={() => { setPicking((v) => !v); tapLight(); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }}>
              <Icon name="swap" size={14} color={t.ink2} />
              <Text style={{ ...ty.caption, fontWeight: '600', color: t.ink }}>Replace</Text>
            </Pressable>
          </View>

          {picking ? (
            matches.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
                {matches.map((n) => (
                  <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Replace with ${n}`}
                    onPress={() => { setName(n); setPicking(false); tapLight(); }}
                    style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                    <Text style={{ ...ty.caption, fontWeight: '500', color: t.ink2, textTransform: 'capitalize' }}>{n}</Text>
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
                  <Ghost label="Clear the Sets and Retype Them" onPress={() => { setRows([{ reps: '', load: '' }]); tapLight(); }} />
                </View>
              ) : null}
            </View>
          ) : null}

          {isCardio ? (
            <View style={{ marginTop: sp.xl }}>
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>CARDIO</Text>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" placeholder="Minutes" placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                <TextInput value={dist} onChangeText={setDist} keyboardType="numeric" placeholder={`Distance (${entry.cardio!.unit})`} placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
              </View>
              <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" placeholder="Watts (optional)" placeholderTextColor={t.ink3} style={{ ...inp, marginTop: sp.sm }} />
            </View>
          ) : (
            <View style={{ marginTop: sp.xl }}>
              {/* The unit is named in the heading rather than left to the
                  placeholder, which disappears the moment a row has a number
                  in it — and a column of loads with no unit over it is exactly
                  how somebody types pounds into a kilogram field. */}
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>SETS · REPS × {unit.toUpperCase()}</Text>
              {rows.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.sm }}>
                  <Text style={{ ...ty.caption, color: t.ink3, width: 22 }}>{i + 1}</Text>
                  <TextInput value={r.reps} onChangeText={(v) => setAt(i, 'reps', v)} keyboardType="numeric" placeholder="Reps" placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                  <Text style={{ ...ty.caption, color: t.ink3 }}>×</Text>
                  <TextInput value={r.load} onChangeText={(v) => setAt(i, 'load', v)} keyboardType="numeric" placeholder={unit} placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                  <Pressable accessibilityLabel={`Remove set ${i + 1}`} hitSlop={8} onPress={() => setRows((p) => p.filter((_, k) => k !== i))} style={{ padding: 4 }}>
                    <Icon name="minus" size={16} color={t.crit} />
                  </Pressable>
                </View>
              ))}
              <Ghost label="Add Set" onPress={() => setRows((p) => [...p, { reps: '', load: p.length ? p[p.length - 1].load : '' }])} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                Leave a load empty for a bodyweight set — it is recorded as no external load rather than as zero.
              </Text>
            </View>
          )}

          <View style={{ marginTop: sp.xl }}>
            <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>CALORIES</Text>
            <TextInput value={kcal} onChangeText={setKcal} keyboardType="numeric" placeholder="Leave blank if unknown" placeholderTextColor={t.ink3} style={inp} />
          </View>
        </ScrollView>
      </View>
          </KeyboardAvoidingView>
    </Modal>
  );
}
