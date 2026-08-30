// Trainer · Program Builder. Pick a client, compose a weekly program (days →
// exercises with sets/reps) starting from their auto plan or blank, then assign
// it. The assigned program flows straight to that client's Train tab, replacing
// the auto-generated one. Revert puts them back on auto.
//
// Rebuilt on the instrument-panel kit (`src/ui/kit`) and the scale
// (`src/theme/scale`). Same providers, state, handlers, routes and modals —
// only the presentation changed: the Georgia serif header and the stack of
// bordered boxes (one per day, one per exercise) became a header block plus
// hairline-separated sections, and every form field now shares one treatment
// (surface2 fill, radius.sm, ty.body, no border). No <Hero>: a builder has no
// single live metric to lead with — the day/exercise counts sit in the section
// head where they belong.
//
// Also removed: the note prefill on the auto plan. `buildProgram()` writes prose
// that cites "your latest InBody scan (25% body fat)" — the 25 is a constant
// this screen passes because the roster carries no body-fat reading, so that
// sentence was an invented scan result being typed into the coach's note to
// their client and shipped with the assigned program. The note now starts empty
// unless a human wrote one. (The exercise library below is kept: it is a
// vocabulary of movement names, not invented client content.)
//
// ── The Assign button is now withheld, not warned about ────────────────────
//
// This screen consumed four providers and read one of their statuses. The one
// that mattered was `useAssignedPrograms`: `getProgram` returns null both for a
// client with no coach-assigned programme and for a client whose row could not
// be read, and the builder answered that null by loading the generic auto plan
// and presenting it as what the client is on. Assign then wrote it over the
// bespoke programme the screen had never seen — no undo, no history row, and
// nothing that tells the client their next session changed.
//
// A banner would not have stopped that, because the banner is not what the
// thumb lands on. So until the current programme has actually been read the
// builder stays empty, says why, and the Assign control is held. See
// src/lib/overwriteGuard.ts.
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useCoachExercises, mergeExerciseLists } from '../../src/ui/coachExercises';
import { useExerciseCatalogue } from '../../src/ui/exerciseDetail';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { buildProgram, type Program } from '../../src/lib/programs';
import { guardOverwrite } from '../../src/lib/overwriteGuard';
import type { Goal } from '../../src/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LIB: { name: string; group: string }[] = [
  { name: 'Back Squat', group: 'Legs' }, { name: 'Front Squat', group: 'Legs' }, { name: 'Leg Press', group: 'Legs' },
  { name: 'Romanian Deadlift', group: 'Hamstrings' }, { name: 'Deadlift', group: 'Back' }, { name: 'Hip Thrust', group: 'Glutes' },
  { name: 'Walking Lunge', group: 'Legs' }, { name: 'Bulgarian Split Squat', group: 'Legs' }, { name: 'Bench Press', group: 'Chest' },
  { name: 'Incline Dumbbell Press', group: 'Chest' }, { name: 'Push-up', group: 'Chest' }, { name: 'Overhead Press', group: 'Shoulders' },
  { name: 'Lateral Raise', group: 'Shoulders' }, { name: 'Face Pull', group: 'Shoulders' }, { name: 'Pull-up', group: 'Back' },
  { name: 'Lat Pulldown', group: 'Back' }, { name: 'Bent-over Row', group: 'Back' }, { name: 'Seated Row', group: 'Back' },
  { name: 'Barbell Curl', group: 'Arms' }, { name: 'Triceps Pushdown', group: 'Arms' }, { name: 'Plank', group: 'Core' },
  { name: 'Cable Crunch', group: 'Core' }, { name: 'Calf Raise', group: 'Calves' },
];

/** Prose written by the program generator, which cites a body-fat reading this
 *  screen does not have. Never prefilled into the coach's note to a client. */
const GENERATED_NOTE = /latest InBody scan/i;

let KEY = 1;
const nextKey = () => 'e' + KEY++;

type BEx = { key: string; name: string; group: string; sets: number; reps: string };
type BDay = { day: string; focus: string; cardio?: string; exercises: BEx[] };

function goalToEnum(g: string): Goal {
  const s = (g || '').toLowerCase();
  if (s.includes('muscle')) return 'muscle';
  if (s.includes('tone')) return 'tone';
  return 'fatloss';
}

export default function Builder() {
  const t = useTheme();
  // Every one of these carries a status and this screen used none of them.
  //
  // The one that matters is `programStatus`. `getProgram` returns null both for
  // a client who has never been assigned anything and for a client whose row
  // could not be read, and this screen answered that null by loading the
  // generic auto-generated plan and presenting it as what they are on. The
  // Assign button underneath then wrote that plan over the bespoke programme
  // the screen had never seen — no undo, no history, and no notice to the
  // client, who simply found a different session waiting for them. That is the
  // meal-plan-chip bug in the most expensive place it can happen, which is
  // somebody's training.
  const { roster, status: rosterStatus } = useRoster();
  const { getProgram, assignProgram, clearProgram, status: programStatus } = useAssignedPrograms();
  const { templates, saveTemplate, status: tplStatus } = useProgramTemplates();
  const router = useRouter();

  const params = useLocalSearchParams();
  const [clientId, setClientId] = useState((params.clientId as string) || roster[0]?.id || '');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState<BDay[]>([]);
  const [pickerDay, setPickerDay] = useState<number | null>(null);
  const coachEx = useCoachExercises();
  // The whole catalogue, names and groups only — the hook is explicit that it
  // does NOT pull instructions or descriptions, so this is a list of names to
  // search rather than the megabyte behind them. The detail screen fetches the
  // one row a coach actually opens.
  const cat = useExerciseCatalogue();
  const [custom, setCustom] = useState('');
  // Drawn in pages. Six hundred rows mounted inside a bottom sheet is a visibly
  // janky scroll on an older phone, and nobody reads past the first screenful
  // of an alphabetical list anyway.
  const [catShown, setCatShown] = useState(30);
  // The picker is a native modal, and on iOS a modal sits above anything pushed
  // underneath it — so opening the detail screen from inside the sheet would
  // put the movement behind the sheet that sent them there. Hiding it keeps
  // `pickerDay` intact, which is the point: the coach comes back to the same
  // day they were adding to rather than to a builder that forgot.
  const [previewing, setPreviewing] = useState(false);
  useFocusEffect(useCallback(() => { setPreviewing(false); }, []));
  const [tplPick, setTplPick] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [tplName, setTplName] = useState('');

  const client = roster.find((c) => c.id === clientId);
  // Only a whole read of `assigned_programs` can tell us this. Under any other
  // status a null from getProgram means "we did not find out", so saying "on
  // their auto-generated program" — and offering a Revert for a programme we
  // cannot see — would both be assertions this screen has no basis for.
  const assignedNow = programStatus === 'ready' && !!getProgram(clientId);
  const planGuard = guardOverwrite(
    programStatus,
    client ? `the programme ${client.name.split(' ')[0]} is currently on` : "this client's current programme",
  );

  const loadFrom = (p: Program) => {
    setTitle(p.title);
    setNote(p.note && !GENERATED_NOTE.test(p.note) ? p.note : '');
    setDays(p.days.map((d) => ({
      day: d.day, focus: d.focus, cardio: d.cardio,
      exercises: d.exercises.map((e) => ({ key: nextKey(), name: e.name, group: e.group, sets: e.sets, reps: e.reps })),
    })));
  };

  // Load the client's current program (assigned if any, else their auto plan)
  // whenever the selected client changes — but only once we actually know what
  // they are on.
  //
  // Filling the builder from an unread record is how the wrong programme gets
  // written. The days below would show the auto plan, the section head would
  // count its exercises, and nothing on the page would distinguish that from
  // the coach's own work — so the coach tweaks it and assigns it, over the top
  // of whatever was really there. Blank is the honest state for "we do not
  // know yet", and the Program section says so in words.
  useEffect(() => {
    if (!clientId) return;
    if (programStatus !== 'ready') { setTitle(''); setNote(''); setDays([]); return; }
    const existing = getProgram(clientId);
    if (existing) loadFrom(existing);
    else loadFrom(buildProgram(goalToEnum(client?.goal ?? ''), 25));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, programStatus]);

  // If opened from the template library with a templateId, load it once.
  const loadedTplRef = useRef<string | null>(null);
  useEffect(() => {
    const tid = params.templateId as string;
    if (!tid || loadedTplRef.current === tid) return;
    const tpl = templates.find((x) => x.id === tid);
    if (tpl) { loadedTplRef.current = tid; loadFrom(tpl.program); setTplName(tpl.name); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.templateId, templates.length]);

  const setDayFocus = (di: number, focus: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, focus } : d)));
  const addExercise = (di: number, name: string, group: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: [...d.exercises, { key: nextKey(), name, group, sets: 3, reps: '10-12' }] } : d)));
  const removeExercise = (di: number, key: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: d.exercises.filter((e) => e.key !== key) } : d)));
  const patchEx = (di: number, key: string, patch: Partial<BEx>) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: d.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)) } : d)));
  const addDay = () => setDays((ds) => {
    const used = new Set(ds.map((d) => d.day));
    const free = DAYS.find((d) => !used.has(d)) ?? 'Mon';
    return [...ds, { day: free, focus: 'Training', exercises: [] }];
  });
  const cycleDay = (di: number) => setDays((ds) => ds.map((d, i) => {
    if (i !== di) return d;
    const idx = DAYS.indexOf(d.day);
    return { ...d, day: DAYS[(idx + 1) % 7] };
  }));
  const removeDay = (di: number) => setDays((ds) => ds.filter((_, i) => i !== di));

  const totalExercises = days.reduce((a, d) => a + d.exercises.length, 0);
  const canAssign = !!clientId && totalExercises > 0;

  // ── what the picker searches ────────────────────────────────────────────
  //
  // One field does both jobs. What the coach types filters the two lists below
  // AND is what the Add button writes as a custom exercise, because those are
  // the same gesture from the coach's side: they know the movement's name and
  // they want it in Thursday. If we have a row for it they should tap it and
  // get the group and the illustration for free; if we have never heard of it —
  // a coach's own progression, a piece of kit only their gym owns — typing it
  // is the custom case working, not an error, and the Add button stays there
  // whether the search found anything or not.
  const pickTerm = custom.trim().toLowerCase();
  const ownList = useMemo(
    () => mergeExerciseLists(coachEx.saved, LIB),
    [coachEx.saved],
  );
  const ownShown = ownList.filter((x) => pickTerm === '' || x.name.toLowerCase().includes(pickTerm));
  // Hidden from the catalogue list when the coach's own list already offers the
  // same movement, so "Bench Press" is not two rows that do the same thing.
  //
  // Exact slug equality and nothing else. Similarity matching on these names
  // pairs Back Squat with Hack Squat at 0.90 and Hip Abduction with Cable Hip
  // Adduction — the opposite movement — and the cost of getting it wrong here
  // is a coach assigning one lift and their client being shown another.
  const ownSlugs = useMemo(() => new Set(ownList.map((x) => exerciseSlug(x.name))), [ownList]);
  const catShownList = cat.rows.filter(
    (e) => !ownSlugs.has(e.id) && (pickTerm === '' || e.name.toLowerCase().includes(pickTerm)),
  );
  // A fresh search starts at the top of the catalogue rather than 300 rows into
  // the last one.
  useEffect(() => { setCatShown(30); }, [pickTerm]);

  /** Open a movement's detail screen without losing the day being built. */
  const previewExercise = (name: string) => {
    setPreviewing(true);
    router.push({ pathname: '/(trainer)/exercise', params: { name } });
  };

  const composeProgram = (): Program => ({
    title: title.trim() || 'Custom program',
    focus: ['Coach-assigned', 'Personalised for you'],
    note: note.trim() || 'Your coach built this program for you. Progress the weight when you hit the top of the rep range.',
    days: days.filter((d) => d.exercises.length).map((d) => ({
      day: d.day, focus: d.focus.trim() || 'Training', cardio: d.cardio,
      exercises: d.exercises.map((e, i) => ({ key: d.day + '-' + i, name: e.name, group: e.group || '', sets: e.sets, reps: e.reps || '8-12', alternatives: [] })),
    })),
  });
  // `saveTemplate` resolves false when the insert never reached
  // `program_templates`, and this used to discard that and say "Template
  // saved". The template then sat in the library for the rest of the session
  // and was gone at the next launch, so the coach's evidence that their work
  // was saved was a sentence this screen made up.
  const doSaveTemplate = async () => {
    if (totalExercises === 0) { Alert.alert('Nothing to save', 'Add at least one exercise first.'); return; }
    const nm = tplName.trim() || title.trim() || 'Untitled template';
    const saved = await saveTemplate(nm, composeProgram());
    setSaveOpen(false); setTplName('');
    Alert.alert(
      saved ? 'Template saved' : 'Saved on this device only',
      saved
        ? 'It is in your Program Templates — assign it to as many clients as you like.'
        : `“${nm}” did not reach the server, so it is in your library on this phone only and will be gone when you reopen the app. Save it again once you have signal.`,
    );
  };
  const assign = async () => {
    // Belt as well as braces: the control is withheld above, and the handler
    // refuses too. An overwrite of somebody's training must not be one stray
    // render away from happening.
    if (!canAssign || !planGuard.allowed) return;
    const program: Program = {
      title: title.trim() || 'Custom program',
      focus: ['Coach-assigned', 'Personalised for you'],
      note: note.trim() || 'Your coach built this program for you. Progress the weight when you hit the top of the rep range.',
      days: days.filter((d) => d.exercises.length).map((d) => ({
        day: d.day, focus: d.focus.trim() || 'Training', cardio: d.cardio,
        exercises: d.exercises.map((e, i) => ({ key: `${d.day}-${i}`, name: e.name, group: e.group || '', sets: e.sets, reps: e.reps || '8-12', alternatives: [] })),
      })),
    };
    const saved = await assignProgram(clientId, program);
    Alert.alert(saved ? 'Program assigned' : 'Saved on this device only',
      saved ? `${client?.name ?? 'Your client'} will now see this in their Train tab.`
            : `It could not be saved to the server, so ${client?.name ?? 'your client'} cannot see it yet. Clients you added by hand have no Train tab until they join.`,
      [{ text: 'Done' }]);
  };

  // `clearProgram` resolves false when the delete never reached the server, and
  // the old version announced the revert regardless. A client left on a
  // programme their coach believes they took away is the same lie as one moved
  // off a programme the coach believes they still have — so the builder is only
  // put back on the auto plan when the server confirmed the removal.
  const revert = async () => {
    const cleared = await clearProgram(clientId);
    if (!cleared) {
      Alert.alert('Not reverted', `${client?.name ?? 'Your client'} is still on their coach-assigned program — the removal did not reach the server. Reopen this screen once you have signal and try again.`);
      return;
    }
    loadFrom(buildProgram(goalToEnum(client?.goal ?? ''), 25));
    Alert.alert('Reverted to auto', `${client?.name ?? 'Your client'} is back on their auto-generated program.`);
  };

  // One field treatment for the whole screen: surface2 fill, no border.
  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 };
  const sheet = { backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30, ...elevation.e2 };
  const scrim = { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' };
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        {/* ── header ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Programs</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Program builder</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>Build a weekly plan and assign it to a client.</Text>
        </View>

        {/* ── client ─────────────────────────────────────────────────────── */}
        <Section>
          {/* The roster count is a count, so it waits for a whole read. Under
              'partial' `roster.length` is the size of the page that came back,
              not the size of the book. */}
          <SectionHead title="Client" note={rosterStatus === 'ready' && roster.length ? `${roster.length} in roster` : undefined} />

          {/* An unread roster is not an empty one. Without this a coach with a
              full book is told they have no clients and sent to add one. */}
          {rosterStatus === 'error' ? (
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="Nobody is listed below because the roster did not come back — it does not mean you have no clients. Reopen this screen once you have signal." />
          ) : rosterStatus === 'partial' ? (
            <PartialRead what="clients on your book" shown={roster.length} />
          ) : null}

          {roster.length === 0 && rosterStatus === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              No clients yet — add a client from your dashboard and they'll appear here to build for.
            </Text>
          ) : roster.length === 0 && rosterStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your roster…</Text>
          ) : roster.length === 0 ? null : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingRight: sp.lg }}>
              {roster.map((c) => {
                const on = c.id === clientId;
                return (
                  <Pressable key={c.id} onPress={() => setClientId(c.id)}
                    style={{ paddingHorizontal: sp.lg, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface2 }}>
                    <Text style={{ ...ty.label, fontWeight: '500', color: on ? t.brandInk : t.ink2 }}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {/* Only when there IS a client. With an empty roster this line sat
              directly under "No clients yet" and said "Currently on their
              auto-generated program · goal: —" — a sentence about somebody who
              does not exist, with a dash where their goal would be. */}
          {client ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.md }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: assignedNow ? t.brand : t.ink3 }} />
              {/* "is on their auto-generated program" is a statement about what
                  this person trains, and it used to be printed off a null that
                  meant nothing more than "the read failed". A coach reading it
                  concludes there is no bespoke plan to preserve. */}
              <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>
                {programStatus === 'loading'
                  ? `Reading what ${client.name.split(' ')[0]} is currently on`
                  : programStatus !== 'ready'
                  ? `What ${client.name.split(' ')[0]} is currently on could not be read`
                  : assignedNow
                    ? 'Currently on a coach-assigned program'
                    : `${client.name.split(' ')[0]} is on their auto-generated program`} · goal: {client.goal ?? '—'}
              </Text>
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── templates ──────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Templates" note="Save as template" onPress={() => { setTplName(title); setSaveOpen(true); }} />
          <Ghost label="Start From a Template" icon="grid" onPress={() => setTplPick(true)} />
        </Section>

        <Rule />

        {/* ── the program itself ─────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Program" />

          {/* Why the builder below is empty. Without this the coach sees a
              blank program with no explanation and starts typing one, which is
              the same trap by a different door: the work is real, the save at
              the bottom is what has to be held. */}
          {planGuard.allowed ? null : (
            <Notice tone={t.warn} kicker={programStatus === 'loading' ? 'Reading' : 'Programme'}
              title={programStatus === 'loading' ? 'Reading their current programme' : 'What they are on could not be read'}
              note={`${planGuard.reason} Nothing has been loaded into the builder, because an empty builder is not this client's plan.`} />
          )}

          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Program name</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Push · Pull · Legs" placeholderTextColor={t.ink3}
            style={[inp, { marginBottom: sp.lg }]} />
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Note to client (optional)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Focus, tempo, anything they should know…" placeholderTextColor={t.ink3}
            multiline style={[inp, { minHeight: 72, textAlignVertical: 'top' }]} />
        </Section>

        <Rule />

        {/* ── days ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Training days"
            note={days.length ? `${days.length} day${days.length === 1 ? '' : 's'} · ${totalExercises} exercises` : undefined} />

          {days.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              No training days yet — add one to start building.
            </Text>
          ) : null}

          {days.map((d, di) => (
            <View key={di} style={{
              marginTop: di === 0 ? 0 : sp.xl, paddingTop: di === 0 ? 0 : sp.xl,
              borderTopWidth: di === 0 ? 0 : hairline, borderTopColor: t.ring,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <Pressable onPress={() => cycleDay(di)} accessibilityRole="button" accessibilityLabel={`Change day, currently ${d.day}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11 }}>
                  <Text style={{ ...ty.label, fontWeight: '600', color: t.ink }}>{d.day}</Text>
                  <Icon name="swap" size={13} color={t.ink3} />
                </Pressable>
                <TextInput value={d.focus} onChangeText={(v) => setDayFocus(di, v)} placeholder="Focus (e.g. Push)" placeholderTextColor={t.ink3}
                  style={[inp, { flex: 1 }]} />
                <Pressable onPress={() => removeDay(di)} accessibilityRole="button" accessibilityLabel="Remove day" hitSlop={8}
                  style={{ paddingHorizontal: sp.sm, paddingVertical: sp.sm }}>
                  <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
                </Pressable>
              </View>

              {d.exercises.map((e) => (
                <View key={e.key} style={{ marginTop: sp.md, paddingTop: sp.md, borderTopWidth: hairline, borderTopColor: t.ring }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.name}</Text>
                      {e.group ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{e.group}</Text> : null}
                    </View>
                    <Pressable onPress={() => removeExercise(di, e.key)} accessibilityRole="button" accessibilityLabel="Remove exercise" hitSlop={8}
                      style={{ paddingHorizontal: sp.sm, paddingVertical: sp.xs }}>
                      <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>Sets</Text>
                    <Pressable onPress={() => patchEx(di, e.key, { sets: Math.max(1, e.sets - 1) })} accessibilityRole="button" accessibilityLabel="One set fewer"
                      style={{ width: 30, height: 30, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="minus" size={14} color={t.ink2} />
                    </Pressable>
                    <Text style={{ ...value(16), color: t.ink, minWidth: 16, textAlign: 'center' }}>{e.sets}</Text>
                    <Pressable onPress={() => patchEx(di, e.key, { sets: Math.min(8, e.sets + 1) })} accessibilityRole="button" accessibilityLabel="One set more"
                      style={{ width: 30, height: 30, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus" size={14} color={t.ink2} />
                    </Pressable>
                    <Text style={{ ...ty.caption, color: t.ink3, marginLeft: sp.sm }}>Reps</Text>
                    <TextInput value={e.reps} onChangeText={(v) => patchEx(di, e.key, { reps: v })} placeholder="8-10" placeholderTextColor={t.ink3}
                      style={[inp, { width: 74, paddingVertical: 7, paddingHorizontal: 10 }]} />
                  </View>
                </View>
              ))}

              <View style={{ marginTop: sp.lg }}>
                <Ghost label="Add Exercise" icon="plus" onPress={() => { setCustom(''); setPickerDay(di); }} />
              </View>
            </View>
          ))}

          <View style={{ marginTop: days.length ? sp.xl : 0 }}>
            <Ghost label="Add Training Day" icon="calendar" onPress={addDay} />
          </View>
        </Section>

        <Rule />

        {/* ── assign ─────────────────────────────────────────────────────── */}
        <Section>
          {/* The control itself is withheld, not merely annotated. A banner
              over a live Assign button does not stop a thumb, and what is on
              the other side of that thumb is an irreversible write over a
              training programme this screen never read — no undo, no history
              row, and nothing that tells the client their sessions changed. */}
          <View style={{ opacity: canAssign && planGuard.allowed ? 1 : 0.4 }} pointerEvents={canAssign && planGuard.allowed ? 'auto' : 'none'}>
            <Cta wide label={planGuard.label ?? `Assign to ${client?.name ?? 'client'} · ${totalExercises} exercises`} onPress={assign} />
          </View>
          {!planGuard.allowed ? (
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
              {planGuard.reason}
            </Text>
          ) : !canAssign ? (
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
              {clientId ? 'Add at least one exercise to assign this program.' : 'Pick a client first.'}
            </Text>
          ) : null}
          {assignedNow ? (
            <View style={{ marginTop: sp.md }}>
              <Ghost label="Revert to Auto-generated Program" onPress={revert} />
            </View>
          ) : null}
        </Section>

      </ScrollView>

      {/* ── exercise picker ──────────────────────────────────────────────── */}
      <Modal visible={pickerDay !== null && !previewing} transparent animationType="slide" onRequestClose={() => setPickerDay(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={scrim} onPress={() => setPickerDay(null)} />
        <View style={[sheet, { maxHeight: '82%' }]}>
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Add exercise</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
            <TextInput value={custom} onChangeText={setCustom} placeholder="Search, or type a new exercise" placeholderTextColor={t.ink3}
              accessibilityLabel="Search the exercise catalogue, or type a name of your own"
              style={[inp, { flex: 1 }]} />
            <Cta label="Add" onPress={() => {
              if (custom.trim() && pickerDay !== null) {
                const nm = custom.trim();
                addExercise(pickerDay, nm, '');
                // Deliberately not awaited. The exercise belongs to the program
                // the moment it is typed; remembering it for next time is the
                // convenience, and a failed write must not hold up the sheet or
                // lose the name the coach just entered.
                void coachEx.remember(nm);
                setCustom('');
                setPickerDay(null);
              }
            }} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6, marginBottom: sp.lg }}>
            Tap a movement to add it, or the arrow to read what it is first. Add puts whatever you
            typed in as it stands — a movement we have never heard of is fine.
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {coachEx.status === 'error' ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
                Your saved exercises could not be read, so only the built-in ones are listed. That is
                not the same as having none saved — try again in a moment.
              </Text>
            ) : coachEx.status === 'partial' ? (
              // 'partial' arrived with the row-cap work and this branch was
              // written before it existed, so a short read of the coach's own
              // names fell through to silence.
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
                Your saved exercises came back short — there are more of them than are listed here.
              </Text>
            ) : null}

            {/* Headed only when it has rows. An empty "Your exercises" above a
                gap reads as a list that failed to load, which is the one thing
                it is not — the coach may simply have searched for something
                only the catalogue has. */}
            {ownShown.length ? <SectionHead title="Your exercises" /> : null}

            {ownShown.map((x, i) => (
              <View key={x.name} style={{
                flexDirection: 'row', alignItems: 'center',
                borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
              }}>
                <Pressable onPress={() => { if (pickerDay !== null) { addExercise(pickerDay, x.name, x.group); setPickerDay(null); } }}
                  accessibilityRole="button" accessibilityLabel={`Add ${x.name}`}
                  style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp.md }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{x.name}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{x.group}</Text>
                </Pressable>
                <Pressable onPress={() => previewExercise(x.name)} hitSlop={8}
                  accessibilityRole="button" accessibilityLabel={`What ${x.name} is`}
                  style={{ paddingLeft: sp.md, paddingVertical: sp.md }}>
                  <Icon name="chevron" size={15} color={t.ink3} />
                </Pressable>
              </View>
            ))}

            {/* ── the catalogue ──────────────────────────────────────────── */}
            <View style={{ marginTop: sp.xl }}>
              <SectionHead
                title="Exercise catalogue"
                // A count of what came back is only a count of the catalogue
                // once we know the read was whole. Under 'partial' or 'error'
                // it is the size of what arrived, which is a different fact.
                note={cat.status === 'ready' ? `${catShownList.length} of ${cat.rows.length}` : undefined}
              />

              {cat.status === 'loading' ? (
                <Text style={{ ...ty.caption, color: t.ink3 }}>Reading the exercise catalogue…</Text>
              ) : cat.status === 'error' ? (
                // Not "no exercises". There are hundreds; we could not read
                // them. The coach's own list above is unaffected and still
                // works, and so does typing a name — this only removes the
                // catalogue, and says so.
                <Text style={{ ...ty.caption, color: t.ink2 }}>
                  The catalogue could not be read, so only your own list is shown above. The movements
                  are still there — your saved names and anything you type still work. Try again once
                  you have signal.
                </Text>
              ) : catShownList.length === 0 ? (
                <>
                  {/* Said before the empty line, not after it: under 'partial'
                      the read stopped at the row cap, so "nothing matches" is a
                      statement about the part of the catalogue that arrived and
                      not about the catalogue. */}
                  {cat.status === 'partial' ? <PartialRead what="catalogue movements" shown={cat.rows.length} /> : null}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    {pickTerm
                      ? cat.status === 'partial'
                        ? `Nothing in the part of the catalogue that loaded matches “${custom.trim()}”. Tap Add to put it in as your own.`
                        : `No catalogue movement matches “${custom.trim()}”. Tap Add to put it in as your own.`
                      : cat.status === 'partial'
                        ? 'Everything that loaded is already in your list above.'
                        : 'Every catalogue movement is already in your list above.'}
                  </Text>
                </>
              ) : (
                <>
                  {cat.status === 'partial' ? <PartialRead what="catalogue movements" shown={cat.rows.length} /> : null}
                  {catShownList.slice(0, catShown).map((e, i) => (
                    <View key={e.id} style={{
                      flexDirection: 'row', alignItems: 'center',
                      borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                    }}>
                      <Pressable
                        onPress={() => { if (pickerDay !== null) { addExercise(pickerDay, e.name, e.group || ''); setPickerDay(null); } }}
                        accessibilityRole="button" accessibilityLabel={`Add ${e.name}`}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.name}</Text>
                          {/* Only what the row actually carries. A movement with
                              no muscle group shows no muscle group — never
                              "Uncategorised", which is a label we invented, and
                              never a blank chip implying one is loading. And
                              "illustrated" is claimed only where image_paths is
                              genuinely non-empty, because a coach who taps
                              expecting a picture and gets a sentence stops
                              trusting the marker on every other row. */}
                          {e.group || e.hasDemo ? (
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                              {[e.group, e.hasDemo ? 'illustrated' : null].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                      <Pressable onPress={() => previewExercise(e.name)} hitSlop={8}
                        accessibilityRole="button" accessibilityLabel={`What ${e.name} is`}
                        style={{ paddingLeft: sp.md, paddingVertical: sp.md }}>
                        <Icon name="chevron" size={15} color={t.ink3} />
                      </Pressable>
                    </View>
                  ))}
                  {catShownList.length > catShown ? (
                    <View style={{ marginTop: sp.md }}>
                      {/* A count, not a bare "Show more". The number is what a
                          coach scrolling an alphabetical list wants to know:
                          how much of it is still below. */}
                      <Ghost label={`Show ${Math.min(30, catShownList.length - catShown)} more of ${catShownList.length - catShown}`}
                        onPress={() => setCatShown((n) => n + 30)} />
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </ScrollView>
        </View>
              </KeyboardAvoidingView>
      </Modal>

      {/* ── start-from-template picker ───────────────────────────────────── */}
      <Modal visible={tplPick} transparent animationType="slide" onRequestClose={() => setTplPick(false)}>
        <Pressable style={scrim} onPress={() => setTplPick(false)} />
        <View style={[sheet, { maxHeight: '80%' }]}>
          <Text style={{ ...ty.title, color: t.ink }}>Start from a template</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
            Loads into the builder for {client?.name ?? 'this client'} — tweak, then assign.
          </Text>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {/* The library is seeded with three built-in starters, so a failed
                read of the coach's own templates leaves a picker that looks
                perfectly healthy and is missing everything they ever built.
                Nothing in the list itself marks the difference. */}
            {tplStatus === 'error' ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
                Your saved templates could not be read, so only the built-in starters are listed below.
                That is not the same as having none saved.
              </Text>
            ) : tplStatus === 'partial' ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>
                Your library came back short — there are more saved templates than are listed here.
              </Text>
            ) : null}
            {templates.length === 0 && tplStatus === 'ready' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>No templates saved yet.</Text>
            ) : null}
            {templates.map((tpl, i) => {
              const dc = tpl.program.days.length;
              const ec = tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);
              return (
                <Pressable key={tpl.id} onPress={() => { loadFrom(tpl.program); setTplName(tpl.name); setTplPick(false); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md,
                    borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                  }}>
                  <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="grid" size={17} color={t.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{tpl.name}</Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{dc} days · {ec} exercises</Text>
                  </View>
                  <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Use</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="Manage All Templates" onPress={() => { setTplPick(false); router.push('/(trainer)/templates'); }} />
          </View>
        </View>
      </Modal>

      {/* ── save-as-template ─────────────────────────────────────────────── */}
      <Modal visible={saveOpen} transparent animationType="slide" onRequestClose={() => setSaveOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={scrim} onPress={() => setSaveOpen(false)} />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Save as template</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
            Reuse this program with other clients — {totalExercises} exercises across {days.filter((d) => d.exercises.length).length} days.
          </Text>
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Template name</Text>
          <TextInput value={tplName} onChangeText={setTplName} placeholder="e.g. Push · Pull · Legs" placeholderTextColor={t.ink3}
            style={[inp, { marginBottom: sp.xl }]} />
          <Cta label="Save Template" wide onPress={doSaveTemplate} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Cancel" onPress={() => setSaveOpen(false)} />
        </View>
              </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
