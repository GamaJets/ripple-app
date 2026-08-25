// Train — the day's session on the instrument-panel kit (`src/ui/kit`) and the
// scale (`src/theme/scale`). Every provider, hook, conditional branch and route
// from the previous version is preserved; only the presentation changed: one
// hero figure instead of a stack of competing bold numbers, hairline-separated
// sections and list rows instead of eighteen bordered cards, and accent spent
// only on the live metric and the primary action.
// Guided session runner, cardio logging & month calendar preserved.
import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Alert, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { tapLight } from '../../src/ui/haptics';
import { Icon } from '../../src/ui/Icon';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Hero, KpiRow, Cta, Ghost, Notice } from '../../src/ui/kit';
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
import { useExerciseVideos } from '../../src/ui/exerciseVideos';
import { injuryFlag, areaLabel, type Injury } from '../../src/lib/injuries';
import { warmupSets, deloadCheck } from '../../src/lib/training';
import { hrColor, hrZoneNo, zoneOf, zoneKey, emptyZoneSeconds, splatPoints, zoneSecondsTotal, type ZoneSeconds } from '../../src/lib/hr';
import { ZoneNow, ZoneBoard } from '../../src/ui/ZoneBoard';
import { SessionHrSheet } from '../../src/ui/SessionHrSheet';
import { ageFromDob } from '../../src/lib/age';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Session catalog. Each activity carries its own MET value, because the two used
// to live in separate structures keyed by the display string: renaming a label
// silently detached it from its MET, and `cardioKcal` falls back to 7 for an
// unknown key — so a typo would have quietly changed a client's calorie estimate
// with nothing to show for it. One entry, one place.
//
// Titles are Title Case throughout and each list is alphabetical. Acronyms
// (EMOM, AMRAP) stay upper-case; they are not words.
interface Activity { name: string; met: number }

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

const HIIT_ACTS: Activity[] = [
  { name: 'AMRAP',            met: 8.0 },
  { name: 'Bag Work',         met: 7.0 },
  { name: 'Bike Intervals',   met: 10.0 },
  { name: 'Circuit',          met: 8.0 },
  { name: 'EMOM',             met: 8.0 },
  { name: 'Sprint Intervals', met: 12.0 },
  { name: 'Tabata',           met: 10.0 },
];

const MOBILITY_ACTS: Activity[] = [
  { name: 'Dynamic Warm-Up',  met: 4.0 },
  { name: 'Foam Rolling',     met: 2.5 },
  { name: 'Pilates',          met: 3.5 },
  { name: 'Stretching',       met: 2.5 },
  { name: 'Yoga',             met: 3.0 },
];

// Sorted here as well as written in order, so a later addition dropped in the
// wrong place still renders alphabetically.
const byName = (a: Activity, b: Activity) => a.name.localeCompare(b.name);
const names = (acts: Activity[]) => [...acts].sort(byName).map((a) => a.name);

const CARDIO = names(CARDIO_ACTS);
const SESSION_TYPES: Record<'cardio' | 'hiit' | 'mobility', string[]> = {
  cardio: CARDIO,
  hiit: names(HIIT_ACTS),
  mobility: names(MOBILITY_ACTS),
};
const WTYPES = [['strength', 'Program'], ['cardio', 'Cardio'], ['hiit', 'HIIT'], ['mobility', 'Mobility']] as const;

// Approx METs per activity — kcal = MET x weight(kg) x hours (standard estimate).
const MET: Record<string, number> = Object.fromEntries(
  [...CARDIO_ACTS, ...HIIT_ACTS, ...MOBILITY_ACTS].map((a) => [a.name, a.met]),
);
// Returns null when we do not know what the client weighs. It used to fall
// back to 70 kg, so the burn shown next to a session was MET x 70 regardless
// of who was training, and that number was written into the workout log and
// re-surfaced in the weekly report as a measured figure.
const cardioKcal = (type: string, mins: number, weightKg?: number | null): number | null =>
  (weightKg && weightKg > 0) ? Math.round((MET[type] ?? 7) * weightKg * (mins / 60)) : null;

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
  const router = useRouter();
  const cd = useClientData();
  const _cp = useAssignedPrograms().getProgram(cd.id);
  const coachProgram = cd.coachingMode === 'solo' ? null : _cp;
  const w = useWearables();
  const { log: workoutLog, addWorkouts, updateWorkout, removeWorkout } = useWorkoutLog();
  const program = coachProgram ?? buildProgram(cd.goal, cd.bodyFatPct);
  const jsToMon = (new Date().getDay() + 6) % 7;
  const [dayIdx, setDayIdx] = useState(jsToMon);
  const [mode, setMode] = useState<'strength' | 'cardio' | 'hiit' | 'mobility'>('strength');
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const [logged, setLogged] = useState<Record<string, { reps: string; kg: string }[]>>({});
  const [cardioLog, setCardioLog] = useState<{ type: string; mins: number; dist: number; unit: string; kcal: number | null }[]>([]);
  const [nlw, setNlw] = useState('');
  const logWorkoutNL = () => {
    const lifts = parseWorkoutText(nlw);
    if (!lifts.length) { Alert.alert('Could not read that', 'Try e.g. "bench 3x8 60kg, squat 100kg 5 5 5".'); return; }
    const nowISO = new Date().toISOString();
    addWorkouts(lifts.map((l) => ({ t: nowISO, exercise: l.exercise, sets: l.sets, kcal: Math.round(l.sets.reduce((a, [r, w]) => a + r * (w || 0), 0) / 60) + l.sets.length * 8 })));
    setNlw('');
    Alert.alert('Logged', `${lifts.length} exercise${lifts.length === 1 ? '' : 's'} added to today.`);
  };
  const [swapFor, setSwapFor] = useState<ProgramExercise | null>(null);
  const [videoFor, setVideoFor] = useState<string | null>(null);
  const [injRevealed, setInjRevealed] = useState<string[]>([]);
  const [deloadDismiss, setDeloadDismiss] = useState(false);
  const { videos: exVideos } = useExerciseVideos();
  const [session, setSession] = useState(false);

  // While the guided session modal is open, poll local HR sources every 5s instead
  // of every 60s so the live heart rate actually tracks what you're doing. Cloud
  // vendors stay on the slow cadence — they only return day aggregates and have
  // rate limits. Always turned back off on unmount so a backgrounded app doesn't
  // keep fast-polling.
  const setLiveMode = w.setLiveMode;
  useEffect(() => {
    setLiveMode(session);
    return () => setLiveMode(false);
  }, [session, setLiveMode]);
  const [ctype, setCtype] = useState(CARDIO[0]); const [mins, setMins] = useState(''); const [dist, setDist] = useState(''); const [unit, setUnit] = useState<'km' | 'mi'>('km');
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
      addWorkouts(await Promise.all(pending.map(withHr)));
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
  const workedDates = new Set(workoutLog.map((l) => dstr(new Date(l.t))));
  Object.keys(logged).forEach((k) => { if ((logged[k] || []).length) workedDates.add(dstr(dateFor(parseInt(k.split(':')[0], 10)))); });
  if (cardioLog.length) workedDates.add(dstr(today0));
  // Today's cardio, read from the saved log so it persists across navigation (not just this mount).
  const todayCardio = workoutLog
    .filter((l) => l.cardio && dstr(new Date(l.t)) === dstr(today0))
    .map((l) => ({ type: l.exercise, mins: l.cardio!.mins, dist: l.cardio!.dist, unit: l.cardio!.unit, watts: l.cardio!.watts ?? 0, kcal: l.kcal ?? 0 }));
  const calMonth = monday0.getMonth(), calYear = monday0.getFullYear();
  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const monthLabel = monday0.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const activeCalDay = selCalDay || dstr(today0);
  const dayEntries = workoutLog.filter((l) => dstr(new Date(l.t)) === activeCalDay);
  const dayVolume = dayEntries.reduce((a, l) => a + (l.sets ? l.sets.reduce((x: number, s: number[]) => x + (s[0] || 0) * (s[1] || 0), 0) : 0), 0);
  const daySets = dayEntries.reduce((a, l) => a + (l.sets ? l.sets.length : 0), 0);
  const dayKcal = dayEntries.reduce((a, l) => a + (l.kcal || 0), 0);
  const prettyDay = (ds: string) => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); };

  const programDays = Array.isArray(program && program.days) ? program.days : [];
  const workout = programDays[dayIdx % (programDays.length || 1)] || programDays[0] || { day: '', focus: 'Rest day', exercises: [] };
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
  const logSet = (e: ProgramExercise, reps: string, kg: string) => { if (!reps) return; setLogged({ ...logged, [uid(e)]: [...(logged[uid(e)] || []), { reps, kg }] }); tapLight(); };
  const quickLog = (e: ProgramExercise) => { const sg = suggestForExercise(workoutLog, nameOf(e), e.reps); logSet(e, String(parseInt(e.reps, 10) || 8), sg ? String(sg.weight) : ''); };
  const logCardio = () => {
    const m = parseInt(mins, 10) || 0, d = parseFloat(dist) || 0; if (!m) return;
    const w = parseInt(watts, 10) || 0;
    const kIn = parseInt(kcalIn, 10) || 0;
    // Null when there is no weight to estimate from, and null is stored rather
    // than a stand-in — an unknown burn is not zero, and it is not 70 kg's.
    const kcal = kIn > 0 ? kIn : cardioKcal(ctype, m, cd.weightKg);
    setCardioLog([{ type: ctype, mins: m, dist: d, unit, kcal }, ...cardioLog]);
    addWorkouts([{ t: new Date().toISOString(), exercise: ctype, cardio: { mins: m, dist: d, unit, ...(w > 0 ? { watts: w } : {}) }, kcal: kcal ?? undefined }]);
    setMins(''); setDist(''); setWatts(''); setKcalIn(''); tapLight();
  };
  const saveManual = () => {
    const nowISO = new Date().toISOString();
    let pr = false;
    const entries: WorkoutEntry[] = [...exercises.filter((e) => !isRemovedEx(e)), ...customEx].map((e) => {
      const s = logged[uid(e)] || [];
      if (!s.length) return null;
      const setPairs = s.map((x) => [parseInt(x.reps, 10) || 0, parseFloat(x.kg) || 0] as [number, number]);
      const bestE1 = Math.max(0, ...setPairs.map(([r, kg]) => (r && kg ? est1RM(kg, r) : 0)));
      if (bestE1 > priorBest1RM(workoutLog, nameOf(e))) pr = true;
      return { t: nowISO, exercise: nameOf(e), sets: setPairs, kcal: Math.round(setPairs.reduce((a, [r, kg]) => a + r * kg, 0) / 60) + s.length * 8 };
    }).filter(Boolean) as WorkoutEntry[];
    if (!entries.length) return;
    addWorkouts(entries);
    setLogged({}); setCustomEx([]);
    if (pr) setConfetti(true);
    Alert.alert('Workout saved', `${entries.length} exercise${entries.length === 1 ? '' : 's'} logged.${pr ? ' New personal record!' : ''} Your streak and records are updated.`, [{ text: 'Nice' }]);
  };
  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10, flex: 1, ...ty.body } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }} numberOfLines={1}>{coachProgram ? 'Coach plan' : program.title}</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Train</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.lg }}>
          <View style={{ flex: 1 }}>
            <Ghost label="Month calendar" icon="calendar" onPress={() => { setSelCalDay(dstr(dateFor(dayIdx))); setShowCal(true); }} />
          </View>
          <View style={{ flex: 1 }}>
            <Ghost label="Book session" icon="plus" onPress={() => router.push('/(client)/calendar')} />
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
          figure={String(exercises.length)}
          unit={exercises.length === 1 ? 'exercise' : 'exercises'}
          note={heroNote}
          arc={exercises.length > 0 ? doneCount / exercises.length : undefined}
          onPress={() => router.push('/(client)/week')}
        />
        {mode === 'strength' && exercises.length > 0 ? (
          <Cta label="Start workout" wide onPress={() => setSession(true)} />
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
                        <Ghost label="Show anyway" onPress={() => setInjRevealed((prev) => [...prev, _id])} />
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
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{e.group} · {sets.length}/{e.sets} sets{!open && sug ? ' · ' + sug.weight + 'kg' : ''}</Text>
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel={'Remove ' + nameOf(e)} onPress={() => removeExercise(e)} hitSlop={8} style={{ padding: 4 }}><Icon name="minus" size={16} color={t.ink3} /></Pressable>
                        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon name="chevron" size={16} color={t.ink3} /></View>
                      </Pressable>
                      {sets.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: sp.md, alignItems: 'center' }}>
                          {sets.map((s, i) => (
                            <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5 }}>
                              <Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{s.reps}×{s.kg || '–'}kg</Text>
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
                                <Text style={{ ...value(15), color: t.ink }}>{sug.weight} kg</Text>
                                {sug.up ? <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>↑</Text> : null}
                                <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }} numberOfLines={1}>{sug.reason}</Text>
                              </View>
                            ) : <View style={{ flex: 1 }} />}
                            {!isCustom ? <Pressable accessibilityLabel="Watch exercise demo" accessibilityRole="button" onPress={() => setVideoFor(nameOf(e))} style={{ width: 38, height: 38, backgroundColor: t.surface2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }}><Icon name="video" size={15} color={t.ink2} /></Pressable> : null}
                            <Pressable accessibilityRole="button" accessibilityLabel={isCustom ? 'Edit ' + nameOf(e) : 'Swap ' + nameOf(e)} onPress={() => replaceExercise(e)} style={{ width: 38, height: 38, backgroundColor: t.surface2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }}><Icon name={isCustom ? 'pencil' : 'swap'} size={15} color={flag ? t.s3 : t.ink2} /></Pressable>
                          </View>
                          <LogRow t={t} onLog={(reps, kg) => logSet(e, reps, kg)} />
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}

              {exercises.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: sp.xl }}>
                  <Icon name="moon" size={26} color={t.ink3} />
                  <Text style={{ ...ty.head, color: t.ink, marginTop: sp.md }}>Rest day</Text>
                  <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs }}>Nothing scheduled today — recovery is where the gains happen. Pick another day above to train, or switch to Cardio to log a session.</Text>
                </View>
              ) : null}

              {exercises.length > 0 || customEx.length > 0 ? (
                <View style={{ marginTop: sp.lg }}>
                  <Ghost label="Add an exercise you did" icon="plus" onPress={() => { setEditingKey(null); setAddOpen(true); }} />
                  {removedEx.filter((u) => u.indexOf(dayIdx + ':') === 0).length > 0 ? (
                    <Ghost label={`Put back ${removedEx.filter((u) => u.indexOf(dayIdx + ':') === 0).length} removed`} icon="swap" onPress={() => { setRemovedEx((prev) => prev.filter((u) => u.indexOf(dayIdx + ':') !== 0)); tapLight(); }} />
                  ) : null}
                </View>
              ) : null}

              {Object.keys(logged).some((k) => k.indexOf(dayIdx + ':') === 0 && (logged[k] || []).length > 0) ? (
                <View style={{ marginTop: sp.md }}>
                  <Cta label="Save workout to log" wide onPress={saveManual} />
                </View>
              ) : null}
            </View>
          ) : (
            <View>
              <Text style={{ ...ty.head, color: t.ink, marginBottom: sp.md }}>Log a {mode === 'hiit' ? 'HIIT' : mode === 'mobility' ? 'mobility' : 'cardio'} session</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingBottom: sp.md }}>
                {(SESSION_TYPES[(mode as 'cardio' | 'hiit' | 'mobility')] || CARDIO).map((ct) => (
                  <Pressable key={ct} onPress={() => setCtype(ct)} style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.pill, backgroundColor: ctype === ct ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: ctype === ct ? '500' : '400', color: ctype === ct ? t.brandInk : t.ink2 }}>{ct}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <TextInput value={mins} onChangeText={setMins} keyboardType="numeric" placeholder="Time (min)" placeholderTextColor={t.ink3} style={inp} />
                <TextInput value={dist} onChangeText={setDist} keyboardType="numeric" placeholder="Distance" placeholderTextColor={t.ink3} style={inp} />
                <Pressable onPress={() => setUnit(unit === 'km' ? 'mi' : 'km')} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, justifyContent: 'center' }}>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{unit}</Text>
                </Pressable>
                <Pressable onPress={logCardio} style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Log</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
                <TextInput value={watts} onChangeText={setWatts} keyboardType="numeric" placeholder="Avg watts (optional)" placeholderTextColor={t.ink3} style={inp} />
                <TextInput value={kcalIn} onChangeText={setKcalIn} keyboardType="numeric" placeholder="Calories (optional)" placeholderTextColor={t.ink3} style={inp} />
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Bikes, rowers &amp; ski ergs: add your avg watts. Logging an Apple Watch workout by hand? Enter the minutes and the calories it shows — leave distance blank for studio classes like Pilates.</Text>

              <View style={{ marginTop: layout.section }}>
                <SectionHead title="Today's sessions" />
                {todayCardio.length > 0 ? (
                  todayCardio.map((c, i) => (
                    <View key={i}>
                      {i > 0 ? <Rule /> : null}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: sp.md, paddingVertical: sp.md }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.type}</Text>
                        <Text style={{ ...ty.caption, ...numeric, color: t.ink3 }}>{[`${c.mins} min`, c.dist > 0 ? `${c.dist} ${c.unit}` : null, c.watts > 0 ? `${c.watts} W` : null, c.kcal != null ? `${c.kcal} kcal` : null].filter(Boolean).join(' · ')}</Text>
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

        <Rule />

        {/* ── log by text ────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Log by text" />
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <TextInput value={nlw} onChangeText={setNlw} placeholder='"bench 3x8 60kg, squat 5 5 5 100kg"' placeholderTextColor={t.ink3} onSubmitEditing={logWorkoutNL} returnKeyType="done" style={inp} />
            <Pressable onPress={logWorkoutNL} disabled={!nlw.trim()} accessibilityRole="button" accessibilityLabel="Log workout from text" style={{ backgroundColor: nlw.trim() ? t.brand : t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
              <Text style={{ ...ty.label, fontWeight: '600', color: nlw.trim() ? t.brandInk : t.ink3 }}>Log</Text>
            </Pressable>
          </View>
        </Section>

        <Rule />

        {/* ── the rest: navigational, deliberately quiet ──────────────────── */}
        <Section>
          <SectionHead title="Go to" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
            {([['camera', 'Scan machine', '/(client)/scan-machine'], ['clock', 'History', '/(client)/activity'], ['chart', 'Trends', '/(client)/trends'], ['trending', 'Targets', '/(client)/progression'], ['calendar', 'This Week', '/(client)/week'], ['trophy', 'Records', '/(client)/records'], ['water', 'Recovery', '/(client)/recovery'], ['moon', 'Rest & deload', '/(client)/restday'], ['video', 'Library', '/(client)/library'], ['settings', 'Tools', '/(client)/tools']] as const).map(([ic, label, route]) => (
              <Pressable key={route} onPress={() => router.push(route as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
                <Icon name={ic} size={14} color={t.ink2} /><Text style={{ ...ty.label, fontWeight: '500', color: t.ink }}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Section>

      </ScrollView>

      {editEntry ? (
        <EditEntrySheet
          t={t}
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSave={(patch) => { updateWorkout(editEntry, patch); setEditEntry(null); }}
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

      <Modal visible={!!videoFor} transparent animationType="fade" onRequestClose={() => setVideoFor(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: layout.gutter }} onPress={() => setVideoFor(null)}>
          {(() => {
            const nm = videoFor || '';
            const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
            const n = norm(nm);
            const vid = n ? (exVideos.find((v) => { const vn = norm(v.name); return vn === n || vn.includes(n) || n.includes(vn); }) || null) : null;
            return (
              <Pressable onPress={() => {}} style={{ width: '100%' }}>
                <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="play" size={40} color="#fff" />
                  <Text style={{ ...ty.body, fontWeight: '500', color: '#fff', marginTop: sp.sm, textTransform: 'capitalize' }}>{nm}</Text>
                  <Text style={{ ...ty.caption, color: '#999', marginTop: sp.xs }}>{vid ? (vid.url ? 'Demo from your coach' : "Your coach's clip — streams once hosting is on") : 'No coach demo yet'}</Text>
                </View>
                {vid && vid.url ? (
                  <View style={{ marginTop: sp.lg }}><Cta label="Play demo" wide onPress={() => Linking.openURL(vid.url as string)} /></View>
                ) : (
                  <View style={{ marginTop: sp.lg }}><Ghost label="Watch a how-to on YouTube" icon="video" onPress={() => Linking.openURL('https://www.youtube.com/results?search_query=' + encodeURIComponent('how to ' + nm + ' proper form'))} /></View>
                )}
                <Text style={{ ...ty.caption, color: '#bbb', marginTop: sp.lg, textAlign: 'center' }}>Tap outside to close</Text>
              </Pressable>
            );
          })()}
        </Pressable>
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
                      { label: 'Exercises', value: String(dayEntries.length) },
                      { label: 'Sets', value: String(daySets) },
                      { label: 'Volume', value: dayVolume ? `${(dayVolume / 1000).toFixed(1)}t` : '—' },
                      { label: 'kcal', value: String(dayKcal) },
                    ]} />
                    <View style={{ marginTop: sp.lg }}>
                      {dayEntries.map((l, i) => (
                        <View key={i}>
                          {i > 0 ? <Rule /> : null}
                          <View style={{ paddingVertical: sp.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink, textTransform: 'capitalize', flex: 1 }}>{l.exercise}</Text>
                              <Pressable accessibilityLabel={'Edit ' + l.exercise} onPress={() => setEditEntry(l)} hitSlop={8} style={{ padding: 4, marginRight: sp.sm }}><Icon name="pencil" size={16} color={t.ink3} /></Pressable>
                              <Pressable accessibilityLabel={'Delete ' + l.exercise} onPress={() => Alert.alert('Delete this entry?', l.exercise + ' will be removed from your log.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => removeWorkout(l) }])} hitSlop={8} style={{ padding: 4, marginRight: -4 }}><Icon name="minus" size={16} color={t.crit} /></Pressable>
                            </View>
                            {l.sets ? (
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                                {l.sets.map((s: number[], j: number) => { const _f = (l.feel || [])[j]; const _fc = _f === 'easy' ? t.good : _f === 'hard' ? t.crit : null; return <View key={j} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}>{_fc ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: _fc }} /> : null}<Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{s[0]}×{s[1]}kg</Text></View>; })}
                              </View>
                            ) : l.cardio ? (
                              <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 5 }}>{[`${l.cardio.mins} min`, l.cardio.dist > 0 ? `${l.cardio.dist} ${l.cardio.unit}` : null, l.cardio.watts && l.cardio.watts > 0 ? `${l.cardio.watts} W` : null, l.cardio.hrAvg ? `♥ ${l.cardio.hrAvg} avg / ${l.cardio.hrHigh ?? l.cardio.hrAvg} hi` : null].filter(Boolean).join(' · ')}</Text>
                            ) : null}
                            {l.kcal ? <Text style={{ ...ty.caption, ...numeric, color: t.ink3, marginTop: 6 }}>{l.kcal} kcal</Text> : null}
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
        <SessionRunner t={t} exercises={planEx.filter((e) => !isInjHidden(e))} focus={workout.focus} nameOf={nameOf} age={ageFromDob(cd.dob)} log={workoutLog} injuries={cd.injuries} onComplete={addWorkouts} onClose={() => setSession(false)} />
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

function LogRow({ t, onLog }: { t: Theme; onLog: (reps: string, kg: string) => void }) {
  const [reps, setReps] = useState(''); const [kg, setKg] = useState('');
  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 9, flex: 1, ...ty.body } as const;
  return (
    <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
      <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
      <TextInput value={kg} onChangeText={setKg} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} style={inp} />
      <Pressable onPress={() => { onLog(reps, kg); setReps(''); setKg(''); }} style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingHorizontal: sp.lg, justifyContent: 'center' }}>
        <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Log set</Text>
      </Pressable>
    </View>
  );
}

function SessionRunner({ t, exercises, focus, nameOf, age, log, injuries, onComplete, onClose }: { t: Theme; exercises: ProgramExercise[]; focus: string; nameOf: (e: ProgramExercise) => string; age: number | null; log: WorkoutEntry[]; injuries: Injury[]; onComplete: (entries: WorkoutEntry[]) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 44);
  const w = useWearables();
  // `heartRateLatest` is the most recent SAMPLE and is only ever set by
  // HealthKit (see appleHealth.ts). Cloud providers leave it null: WHOOP, Oura
  // and Fitbit expose no intraday samples at all, and WHOOP's `heartRateAvg` is
  // the average across the whole physiological day.
  //
  // So the daily average is kept as a display fallback for the bpm column, but
  // it must NEVER drive the zone: accumulating time-in-zone against a static
  // day-average would invent a zone breakdown for a session it never measured —
  // a WHOOP user would finish and see "42 min in Zone 2" derived from one
  // number that had nothing to do with the workout.
  const liveSample = w.today.heartRateLatest;          // a real, current reading
  const liveHr = liveSample ?? w.today.heartRateAvg;   // display only
  const startKcalRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [hrPeak, setHrPeak] = useState<number | null>(null);
  const [finalElapsed, setFinalElapsed] = useState(0);
  if (startKcalRef.current == null && typeof w.today.activeKcal === 'number') startKcalRef.current = w.today.activeKcal;
  const sessionKcal = (typeof w.today.activeKcal === 'number' && startKcalRef.current != null) ? Math.max(0, Math.round(w.today.activeKcal - startKcalRef.current)) : null;
  useEffect(() => {
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
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
  const liveZone = hrZoneNo(liveSample, age);
  const hasZones = zoneSecondsTotal(zoneSecs) > 0;
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<{ reps: number; kg: number }[][]>(() => exercises.map(() => []));
  const [reps, setReps] = useState(''); const [kg, setKg] = useState('');
  const [rest, setRest] = useState(0);
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
    setKg(sug ? String(sug.weight) : '');
    setReps('');
    setPrMsg(null);
    setPendingFeel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const ex = exercises[idx];
  const done = results[idx] || [];
  const logSet = () => {
    const r = parseInt(reps, 10) || 0; if (!r) return;
    const wkg = parseFloat(kg) || 0;
    const name = nameOf(exercises[idx]);
    const newE1 = wkg && r ? est1RM(wkg, r) : 0;
    const priorBest = Math.max(priorBest1RM(log, name), ...done.map((s) => (s.kg && s.reps ? est1RM(s.kg, s.reps) : 0)), 0);
    if (newE1 > 0 && newE1 > priorBest) { setPrMsg(`New PR on ${name}! ${wkg}kg × ${r}`); setConfetti(true); }
    setResults((prev) => { const n = prev.map((a) => [...a]); n[idx].push({ reps: r, kg: wkg }); return n; });
    setReps(''); setRest(90); setPendingFeel(wkg);
  };
  const feelStep = (base: number) => (base >= 60 ? 5 : base >= 20 ? 2.5 : base > 0 ? 1 : 0);
  const chooseFeel = (f: 'easy' | 'ok' | 'hard') => {
    setRpes((prev) => { const n = prev.map((a) => [...a]); n[idx].push(f); return n; });
    const base = pendingFeel || 0;
    const st = feelStep(base);
    const nextKg = f === 'easy' ? base + st : f === 'hard' ? Math.max(0, base - st) : base;
    setKg(nextKg ? String(nextKg) : '');
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
    if (sessionKcal != null) strip.push({ label: 'kcal burned', value: String(sessionKcal) });
    if (hrPeak != null) strip.push({ label: 'Peak bpm', value: String(hrPeak), dot: hrColor(hrPeak, age) });
    if (typeof w.today.heartRateAvg === 'number') strip.push({ label: 'Avg bpm', value: String(w.today.heartRateAvg) });
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40, paddingTop: topPad + 10 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ alignItems: 'center', marginTop: sp.xl }}><Icon name="trophy" size={40} color={t.brand} /></View>
          <Text style={{ ...ty.title, color: t.ink, textAlign: 'center', marginTop: sp.md }}>Session complete</Text>
          <Text style={{ ...ty.label, color: t.ink3, textAlign: 'center', marginTop: sp.xs, textTransform: 'capitalize' }}>{focus}</Text>
          <Section>
            <KpiRow items={[
              { label: 'Exercises', value: `${exDone}/${exercises.length}` },
              { label: 'Sets', value: String(totalSets) },
              { label: 'Volume', value: `${(volume / 1000).toFixed(1)}t` },
            ]} />
          </Section>
          <Rule />
          <Section>
            <MetricCols t={t} items={strip} />
          </Section>
          <Rule />
          {zoneSecondsTotal(zoneSecs) > 0 ? (<>
            <Section>
              <SectionHead title="Time in zone" note={`${splatPoints(zoneSecs)} splat`} />
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
    { label: 'bpm', value: String(liveHr ?? '–'), dot: liveHr ? hrColor(liveHr, age) : undefined },
    { label: 'kcal', value: String(sessionKcal ?? '–') },
    { label: 'Peak', value: String(hrPeak ?? '–'), dot: hrPeak ? hrColor(hrPeak, age) : undefined },
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

        {/* Live effort. The zone numeral leads; colour only confirms it. */}
        {liveZone || hasZones ? (
          <View style={{ marginTop: sp.xl }}>
            <ZoneNow zone={liveZone} bpm={liveSample ?? null} compact />
            {hasZones ? (
              <View style={{ marginTop: sp.lg }}>
                <ZoneBoard seconds={zoneSecs} current={liveZone} />
              </View>
            ) : null}
          </View>
        ) : null}

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
            <Pressable onPress={() => setRest(0)} hitSlop={8} style={{ marginTop: sp.sm }}><Text style={{ ...ty.label, fontWeight: '500', color: t.brandInk }}>Skip rest</Text></Pressable>
          </View>
        ) : null}

        {done.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.xl }}>
            {done.map((s, i) => { const f = (rpes[idx] || [])[i]; const fc = f === 'easy' ? t.good : f === 'hard' ? t.crit : t.ink3; return (<View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 11, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6 }}>{f ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fc }} /> : null}<Text style={{ ...ty.label, ...numeric, fontWeight: '500', color: t.ink2 }}>Set {i + 1}: {s.reps}×{s.kg || '–'}kg</Text></View>); })}
          </View>
        ) : null}

        {done.length === 0 ? (() => { const wu = warmupSets(parseFloat(kg) || 0); return wu.length ? (
          <View style={{ marginTop: sp.xl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: sp.sm }}><Icon name="flame" size={14} color={t.s3} /><Text style={{ ...ty.micro, color: t.ink3 }}>Warm-up ramp</Text></View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {wu.map((ws, i) => <View key={i} style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ ...ty.caption, ...numeric, color: t.ink2 }}>{ws.kg}kg × {ws.reps}</Text></View>)}
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Ramp up first — these don't count as working sets.</Text>
          </View>
        ) : null; })() : null}

        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.xl, marginBottom: sp.sm }}>Log set {done.length + 1}</Text>
        <View style={{ flexDirection: 'row', gap: sp.md }}>
          <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="reps" placeholderTextColor={t.ink3} style={inp} />
          <TextInput value={kg} onChangeText={setKg} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} style={inp} />
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
            ? <Cta label={idx < exercises.length - 1 ? 'Next exercise →' : 'Finish session'} wide onPress={next} />
            : <Ghost label={idx < exercises.length - 1 ? 'Next exercise →' : 'Finish session'} onPress={next} />}
        </View>
      </ScrollView>
      <Confetti show={confetti} onDone={() => setConfetti(false)} />
    </SafeAreaView>
  );
}

// Edit one logged entry. Until now the only thing you could do to a mistake was
// delete it and log the whole thing again, which also lost the heart-rate zones
// recorded against it.
//
// Mounted only while it is open (see the caller) so it always opens on the
// entry's current values rather than the first one ever edited.
function EditEntrySheet({ t, entry, onClose, onSave }: {
  t: Theme; entry: WorkoutEntry; onClose: () => void; onSave: (patch: Partial<WorkoutEntry>) => void;
}) {
  const [name, setName] = useState(entry.exercise);
  const [sets, setSets] = useState<[number, number][]>(entry.sets ? entry.sets.map((s) => [s[0], s[1]] as [number, number]) : []);
  const [mins, setMins] = useState(entry.cardio ? String(entry.cardio.mins) : '');
  const [dist, setDist] = useState(entry.cardio ? String(entry.cardio.dist) : '');
  const [watts, setWatts] = useState(entry.cardio && entry.cardio.watts ? String(entry.cardio.watts) : '');
  const [kcal, setKcal] = useState(entry.kcal != null ? String(entry.kcal) : '');

  const isCardio = !!entry.cardio;
  const setAt = (i: number, j: 0 | 1, v: string) =>
    setSets((prev) => prev.map((s, k) => (k === i ? (j === 0 ? [parseInt(v, 10) || 0, s[1]] : [s[0], parseFloat(v) || 0]) : s)));

  const save = () => {
    const patch: Partial<WorkoutEntry> = {};
    const nm = name.trim();
    if (nm && nm !== entry.exercise) patch.exercise = nm;

    if (isCardio) {
      const m = parseInt(mins, 10) || 0;
      const d = parseFloat(dist) || 0;
      const w = parseInt(watts, 10) || 0;
      patch.cardio = { ...entry.cardio!, mins: m, dist: d, ...(w > 0 ? { watts: w } : {}) };
      if (w <= 0) delete (patch.cardio as { watts?: number }).watts;
    } else {
      const kept = sets.filter((s) => s[0] > 0);
      patch.sets = kept.length ? kept : undefined;
      // Perceived effort is recorded per set, so a set that no longer exists
      // must not keep carrying someone's answer for it.
      if (entry.feel) patch.feel = kept.length ? entry.feel.slice(0, kept.length) : undefined;
    }

    // Blank means "no figure", which is not the same as zero.
    patch.kcal = kcal.trim() === '' ? undefined : (parseInt(kcal, 10) || 0);
    onSave(patch);
  };

  const inp = { color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 10, ...ty.body } as const;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderTopWidth: hairline, borderColor: t.ring, maxHeight: '86%', ...elevation.e2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: sp.lg }}>
          <Pressable onPress={onClose} hitSlop={8}><Text style={{ ...ty.body, fontWeight: '500', color: t.ink3 }}>Cancel</Text></Pressable>
          <Text style={{ ...ty.head, color: t.ink }}>Edit entry</Text>
          <Pressable onPress={save} hitSlop={8}><Text style={{ ...ty.body, fontWeight: '600', color: t.brand }}>Save</Text></Pressable>
        </View>
        <Rule />
        <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>EXERCISE</Text>
          <TextInput value={name} onChangeText={setName} style={inp} placeholder="Exercise" placeholderTextColor={t.ink3} />

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
              <Text style={{ ...ty.micro, color: t.ink3, marginBottom: 6 }}>SETS</Text>
              {sets.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.sm }}>
                  <Text style={{ ...ty.caption, color: t.ink3, width: 22 }}>{i + 1}</Text>
                  <TextInput value={s[0] ? String(s[0]) : ''} onChangeText={(v) => setAt(i, 0, v)} keyboardType="numeric" placeholder="Reps" placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                  <Text style={{ ...ty.caption, color: t.ink3 }}>×</Text>
                  <TextInput value={s[1] ? String(s[1]) : ''} onChangeText={(v) => setAt(i, 1, v)} keyboardType="numeric" placeholder="kg" placeholderTextColor={t.ink3} style={{ ...inp, flex: 1 }} />
                  <Pressable accessibilityLabel={`Remove set ${i + 1}`} hitSlop={8} onPress={() => setSets((p) => p.filter((_, k) => k !== i))} style={{ padding: 4 }}>
                    <Icon name="minus" size={16} color={t.crit} />
                  </Pressable>
                </View>
              ))}
              <Ghost label="Add set" onPress={() => setSets((p) => [...p, [0, p.length ? p[p.length - 1][1] : 0]])} />
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
