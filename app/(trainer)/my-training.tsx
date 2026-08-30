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
import { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, KpiRow, Cta, Ghost, Notice, PartialRead, fig } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useExerciseCatalogue, type CatalogueRow } from '../../src/ui/exerciseDetail';
import { useCatalogueThumbs } from '../../src/ui/useCatalogueThumbs';
import { ExerciseThumb } from '../../src/ui/ExerciseDemo';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { useWorkoutLog } from '../../src/ui/workoutLog';
import { useSettings } from '../../src/ui/settings';
import { isWhole } from '../../src/ui/loadStatus';
import { notifySuccess } from '../../src/ui/haptics';
import { parseWorkoutText } from '../../src/lib/workoutParse';
import { trainingDays, setsSummary } from '../../src/lib/ownTraining';
import { dayKeyOfDate } from '../../src/lib/entryEdit';
import { readLift, volumeIn, convertedNote, type WeightUnit } from '../../src/lib/units';
import { weekStats } from '../../src/lib/streaks';
import { num } from '../../src/lib/format';
import { localDate } from '../../src/lib/localDate';
import type { WorkoutEntry } from '../../src/lib/mockData';

/** How many days back "Recent" reaches. Beyond a fortnight this stops being a
 *  log a coach reads and starts being a history screen, which is not what this
 *  is for. */
const RECENT_DAYS = 14;

/** A day key as a person reads it: "Fri 14 Aug". */
function dayLabel(day: string): string {
  const d = localDate(day);
  if (!d) return day;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function MyTraining() {
  const t = useTheme();
  const router = useRouter();
  const { log, status, addWorkout, addWorkouts, removeWorkout, reload } = useWorkoutLog();
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
  const todayKey = dayKeyOfDate(new Date());
  const today = days.find((d) => d.day === todayKey) ?? null;
  const recent = days.filter((d) => d.day !== todayKey).slice(0, RECENT_DAYS);
  const wk = weekStats(log);

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
    const saved = await addWorkouts(lifts.map((l) => ({ t: at, exercise: l.exercise, sets: l.sets })));
    setBusy(false);
    setText('');
    if (saved) {
      notifySuccess();
      Alert.alert('Logged', `${lifts.length} exercise${lifts.length === 1 ? '' : 's'} added to your own training for today.`);
    } else {
      // `addWorkouts` resolves false when the row never reached the server. The
      // entry is on screen and on this phone only, and saying "logged" here
      // would be the same event as a real save.
      Alert.alert('Not saved',
        'We could not reach your training log. What you typed is showing on this phone, but it has not been recorded and will be gone when you next open the app.');
    }
  };

  /* ── logging one lift by hand ────────────────────────────────────────── */

  const [exercise, setExercise] = useState('');
  const [setCount, setSetCount] = useState('');
  const [reps, setReps] = useState('');
  const [load, setLoad] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * A single lift, typed in four boxes, for when the sentence parser is not
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
  const logOneLift = async () => {
    setProblem(null);
    const name = exercise.trim();
    if (!name) { setProblem('Give the lift a name.'); return; }
    const s = Number(setCount.trim());
    if (!Number.isInteger(s) || s < 1 || s > 30) { setProblem('Sets must be a whole number between 1 and 30.'); return; }
    const r = Number(reps.trim());
    if (!Number.isInteger(r) || r < 1 || r > 200) { setProblem('Reps must be a whole number between 1 and 200.'); return; }
    const read = readLift(load, wu);
    if (!read.ok) { setProblem(read.reason); return; }
    // A blank load is a bodyweight set. Stored as 0, which is what every other
    // writer in this app stores and what `setsSummary` reads back as "no
    // external load" rather than as "0 kg".
    const kg = read.kg ?? 0;
    const entry: WorkoutEntry = {
      t: new Date().toISOString(),
      exercise: name,
      sets: Array.from({ length: s }, () => [r, kg] as [number, number]),
    };
    setBusy(true);
    const saved = await addWorkout(entry);
    setBusy(false);
    if (saved) {
      notifySuccess();
      setExercise(''); setSetCount(''); setReps(''); setLoad('');
      Alert.alert('Logged', `${name} added to your own training for today.`);
    } else {
      // The boxes are deliberately NOT cleared. What was typed is the only copy
      // of it that exists, and emptying the form would take that away on the
      // one path where the coach may want to try again.
      setProblem('Not saved — we could not reach your training log. This lift is showing on this phone only and will be gone when you next open the app.');
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
          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.exercise}</Text>
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
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 44 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

          {/* ── header. Whose log this is, said before anything else ─────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
            <Ghost icon="back" onPress={() => router.back()} />
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
              <PartialRead what="sessions of your own" shown={log.length} onPress={reload} />
            </Section>
          ) : null}

          <Rule />

          {/* ── the week, and only when the week is knowable ──────────────── */}
          <Section>
            <SectionHead title="Your Last 7 Days" />
            <KpiRow items={[
              { label: 'Days trained', value: whole ? fig(wk.days) : fig(null) },
              { label: 'Exercises', value: whole ? fig(wk.workouts) : fig(null) },
              // A total over a truncated or unread log is not a total. `num`
              // gives it a thousands separator; a week of lifting passes 999 in
              // either unit long before it passes anything else.
              { label: 'Lifted', value: whole ? num(volumeIn(wk.volumeKg, wu)) : fig(null), unit: whole ? wu : undefined },
            ]} />
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
              For when you would rather not type a sentence. Leave the weight empty for a bodyweight set.
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
                  <Pressable key={r.id} onPress={() => setExercise(r.name)}
                    accessibilityRole="button" accessibilityLabel={`Use ${r.name}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: sp.sm,
                      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                    <ExerciseThumb uri={thumbFor(r)} t={t} size={34} />
                    <Text style={{ ...ty.body, color: t.ink, flex: 1 }} numberOfLines={1}>{r.name}</Text>
                    {r.group ? <Text style={{ ...ty.caption, color: t.ink3 }}>{r.group}</Text> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <TextInput value={setCount} onChangeText={setSetCount} keyboardType="numeric" placeholder="Sets"
                placeholderTextColor={t.ink3} accessibilityLabel="Number of sets" style={[inp, { flex: 1 }]} />
              <TextInput value={reps} onChangeText={setReps} keyboardType="numeric" placeholder="Reps"
                placeholderTextColor={t.ink3} accessibilityLabel="Reps per set" style={[inp, { flex: 1 }]} />
              <TextInput value={load} onChangeText={setLoad} keyboardType="numeric" placeholder={wu}
                placeholderTextColor={t.ink3} accessibilityLabel={`Weight in ${wu}`} style={[inp, { flex: 1 }]} />
            </View>
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
