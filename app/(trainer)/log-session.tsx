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
//   · say "logged" when it is not. `logForClient` reports the write rather than
//     returning a boolean, and a failure names what happened and states plainly
//     that nothing was saved — including the one cause a coach can act on,
//     which is the person not being on their roster.
//   · invent a calorie figure. Strength work records reps and weight, not
//     energy, and the client's own screens render an absent burn as a dash.
//     Guessing here would put a fabricated number into somebody else's history.
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
import { useState } from 'react';
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
import { logForClient } from '../../src/lib/coachLog';
import { useFloorQueue } from '../../src/ui/floorQueue';
import { floorPendingNote, flushResultLine, keptOfflineLine } from '../../src/lib/floorQueue';
import { notifySuccess } from '../../src/ui/haptics';
import type { WorkoutEntry } from '../../src/lib/mockData';

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
  const { clientId, name } = useLocalSearchParams<{ clientId?: string; name?: string }>();
  const coachEx = useCoachExercises();
  const r = useRoster();

  // Seeded from the route, so the way in from a client's own screen is exactly
  // what it was: their name in the title and nothing to choose. `null` is the
  // state this screen could not previously get out of.
  const [picked, setPicked] = useState<string | null>(clientId ?? null);
  const [clientQ, setClientQ] = useState('');

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
  const entriesToWrite = (): WorkoutEntry[] => {
    const at = new Date().toISOString();
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

  // Withheld while any load is unreadable. Saving a session with one bad
  // figure silently zeroed is the failure above; refusing the save is the
  // only honest alternative, because this is a write to a client's record
  // with no undo and no notification to them.
  //
  // And withheld while nobody is chosen, which is the change this screen was
  // listed for. The check existed — at save, after the hour was typed. Held
  // here it costs a coach one tap at the top of the screen instead of the whole
  // session.
  const ready = picked != null && entriesToWrite().length > 0 && loadProblem() == null;

  const save = async () => {
    const entries = entriesToWrite();
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
    const res = await logForClient(picked, coachId, entries);
    if (res.ok) {
      setBusy(false);
      notifySuccess();
      Alert.alert(
        'Session logged',
        `${res.written} exercise${res.written === 1 ? '' : 's'} added to ${first}'s record. They will see it on their own phone, marked as logged by you, and it counts towards their progress.`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
      return;
    }

    // ── the write did not land, and there are two very different reasons ──
    //
    // Gyms are in basements. Until now both of them produced the same red
    // banner and the same outcome: an hour of somebody's training, typed set by
    // set, gone. A coach does not type it again — they remember it wrong a week
    // later, or they stop using the screen.
    //
    // `logForClient` reports the failure it saw, and the one thing this screen
    // has to decide is whether the server ANSWERED. It did if the failure names
    // a cause — the roster refusal is a policy decision and will be made again
    // identically — and it did not if nothing came back at all. Only the second
    // is worth keeping: the same bytes refused once are refused forever, and a
    // coach told something is waiting to send when it never will has been given
    // a worse lie than "it failed".
    //
    // `attempt` re-issues the write through the queue, so the ONE round trip a
    // coach actually waits on is the one above; this second call is what
    // classifies and keeps it. It is never reported as saved — see rule 1 in
    // src/lib/floorQueue.ts.
    const out = await queue.attempt({
      kind: 'session-log', clientId: picked, clientName: pickedName, entries,
    });
    setBusy(false);
    if (out === 'stored') {
      notifySuccess();
      Alert.alert('Session logged',
        `${entries.length} exercise${entries.length === 1 ? '' : 's'} added to ${first}'s record.`,
        [{ text: 'Done', onPress: () => router.back() }]);
      return;
    }
    if (out === 'refused') { setFailure(res.reason); return; }
    // Kept. Said as a sentence and not as a success: the client cannot see this
    // yet and neither can anybody else.
    Alert.alert('Kept on this phone',
      keptOfflineLine('This session'),
      [{ text: 'Done', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg }}>
            <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back"
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="back" size={18} color={t.ink} />
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

          <View style={{ marginTop: sp.xl }}>
            <View style={{ opacity: ready && !busy ? 1 : 0.4 }} pointerEvents={ready && !busy ? 'auto' : 'none'}>
              <Cta wide label={busy ? 'Saving…' : `Log to ${first}'s record`} onPress={save} />
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
                {loadProblem() ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} /> : null}
                <Text style={{ ...ty.caption, color: loadProblem() ? t.ink2 : t.ink3, textAlign: 'center' }}>
                  {/* The client comes first of the three, because it is the one
                      that used to be reported at save — and a coach told to add
                      a set, who adds one and is then told about the client, has
                      been sent looking twice. */}
                  {!picked
                    ? 'Pick who this session was with, at the top of this screen.'
                    : loadProblem() ?? 'Add at least one set with a rep count.'}
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
