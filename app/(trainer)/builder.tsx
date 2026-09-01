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
import { num } from '../../src/lib/format';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { badges as groupBadges, canJoinNext, isGrouped, joinNext, leaveGroup } from '../../src/lib/setGroups';
import { SET_METHODS, DEFAULT_METHOD, badgeFor, methodFor } from '../../src/lib/setMethods';
import { addSetRow, expandSets, hasSetRows, patchSetRow, removeSetRow, setCount, type SetRow } from '../../src/lib/setRows';
import { readRestSeconds, restClock, DEFAULT_REST_SEC } from '../../src/lib/restTimer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { liftIn, liftLabel, readLift, type WeightUnit } from '../../src/lib/units';
import { Rule, Section, SectionHead, Cta, Ghost, Flag, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { useCoachExercises, mergeExerciseLists } from '../../src/ui/coachExercises';
import { useSettings } from '../../src/ui/settings';
import { useExerciseCatalogue } from '../../src/ui/exerciseDetail';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { useCatalogueThumbs } from '../../src/ui/useCatalogueThumbs';
import { ensureCatalogueRow } from '../../src/ui/customExercise';
import { ExerciseThumb } from '../../src/ui/ExerciseDemo';
import { buildProgram, type Program } from '../../src/lib/programs';
import { guardOverwrite } from '../../src/lib/overwriteGuard';
import { guardInjuries } from '../../src/lib/injuryGate';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { useInjuryAcks } from '../../src/ui/injuryAcks';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { areaLabel, injuryFlag, type Injury } from '../../src/lib/injuries';
import { goalToEnum, goalsDisagree } from '../../src/lib/rosterMerge';
import { useProgramGroups } from '../../src/ui/groupProgram';
import { listNames, planFanOut, fanOutSubject, type FanOutMember } from '../../src/lib/groupProgram';
import {
  overwriteBrief, unassignBrief, bulkReport, selectAllOffer,
  type AssignTarget, type WriteOutcome,
} from '../../src/lib/bulkActions';
import { seedDecision, stillListed, pruneSelection, assignCtaLabel } from '../../src/lib/assignPicker';
import { notifySuccess } from '../../src/ui/haptics';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** 's' unless there is exactly one of them. Four counts on this screen said
 *  "1 exercises" — the Assign button, the Training Days head, the template rows
 *  and the save sheet — because the day count was pluralised and the exercise
 *  count beside it was not. A coach reads the button before an irreversible
 *  write over somebody's training; it should be written in English. */
const s = (n: number) => (n === 1 ? '' : 's');
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

type BEx = {
  key: string; name: string; group: string; sets: number; reps: string;
  /**
   * The load to put on the machine, IN KILOGRAMS, or null when the coach has
   * not said. Sets and reps were editable here and the weight was not, so the
   * one number that changes week to week was the one a coach could not write
   * down — and the note at the top of this very screen says "progress the
   * weight when you hit the top of the rep range".
   *
   * Kilograms because the record is metric everywhere else in this app;
   * `readLift` converts from whatever the coach typed and `liftLabel` reads it
   * back. `loadUnit` remembers which unit they used so the field shows what
   * they wrote rather than a conversion of it.
   */
  loadKg?: number | null;
  loadUnit?: WeightUnit;
  /**
   * What the coach wants said about THIS movement — "keep the elbows tucked",
   * "3-1-1 tempo", "the machine by the window, seat on 4".
   *
   * Not the programme's `note`, which is the letter at the top of the week.
   * That one is read once on the way in; this one is read at the machine by
   * somebody who has already forgotten it. See ProgramExercise.note in
   * src/lib/programs.ts for why the two are not collapsed into one field.
   *
   * A blank field is written out as `undefined` rather than as '', because an
   * empty string stored as a note draws an empty bubble under the movement in
   * the client's app — their coach appearing to have written something and
   * left it blank.
   */
  note?: string;
  /**
   * Carried through, not yet edited here.
   *
   * `ProgramExercise.restSec` arrived while this screen was being rewritten. It
   * has no control in the builder yet, and this field exists so that a
   * programme LOADED into the builder and assigned back out keeps whatever rest
   * a coach set elsewhere — the exact loss `loadKg` and `note` suffered, where
   * `loadFrom` and `composeProgram` enumerate fields by hand and a new one
   * dropped out of both. Whoever adds the control writes to this field and the
   * round trip already works.
   */
  restSec?: number | null;
  /**
   * The group this exercise is performed BACK TO BACK with, or null when it
   * stands alone. Adjacent exercises sharing an id form a superset, a tri-set
   * or a giant set — and which of those it is called is DERIVED FROM HOW MANY
   * there are, in `src/lib/setGroups.ts`, rather than chosen. A coach who
   * could pick the word and separately pick the members would eventually
   * produce a "superset" of four, and nothing could tell it was wrong.
   */
  setGroupId?: string | null;
  /**
   * How the sets are performed — warm-up, drop set, to failure, AMRAP and the
   * rest of `src/lib/setMethods.ts`. Null and 'normal' both mean an ordinary
   * working set; the catalogue is consulted rather than the string compared,
   * so a method added later behaves without this screen changing.
   *
   * This matters past the label: a drop set has NO rest inside it, and a
   * warm-up is not training volume. Both of those are read off the method by
   * the client's runner and the progress screens.
   */
  method?: string | null;
  /**
   * The sets written out one by one, or absent because every set is the same
   * set — the shape every exercise in this builder had until now.
   *
   * The rules for reading it, and the reason it must stay optional, are in
   * src/lib/setRows.ts. What matters here: the fields above are what an
   * exercise WITHOUT a table says, and they are left exactly as the coach
   * typed them when a table appears, because they are still what a build too
   * old to read the table will show. Only `sets` is kept in step with the row
   * count, and only because every progress reader in the app counts against
   * it.
   */
  setRows?: SetRow[] | null;
};
type BDay = { day: string; focus: string; cardio?: string; exercises: BEx[] };

// ── The goal that generates a programme is now allowed to be unknown ───────
//
// This screen carried its own goalToEnum: lowercase the roster's goal string,
// return 'muscle' if it contained "muscle", 'tone' if it contained "tone", and
// otherwise fall through to 'fatloss'. Two failures lived in that last line.
//
// The fallthrough was reached by everything the table did not recognise, and
// the string it was reached by most often is 'General' — which is precisely
// what the roster puts where a client's goal could NOT be read. So a client
// whose goal row was refused, or empty, or written by a newer build, had a
// fat-loss programme generated for them, the builder presented it as their
// plan, and the Assign button underneath offered to send it. Nothing on screen
// said the goal had been guessed. The substring test was wrong too: it asks
// about muscle before tone, so the phrase "muscle tone" resolved to muscle.
//
// Both now live in src/lib/rosterMerge.ts, matched on an exact key and
// returning null for anything they do not recognise, and this screen answers
// that null by WITHHOLDING the generated plan rather than by picking a goal.
//
// Withholding the generated plan, and not the whole screen: the danger is the
// auto plan specifically, because that is the artefact whose content is chosen
// by the goal and which looks identical to work a human did. A programme the
// coach types out themselves is theirs whatever the roster knows about the
// goal, so Assign stays available for it — see the notice in the Program
// section, which asks the coach to set the goal rather than guessing it for
// them.

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
  const { roster, status: rosterStatus, refresh: refreshRoster } = useRoster();
  // An injury recorded a minute ago should be on this page when the coach opens
  // it, not after they next restart the app — this screen is where they check
  // before deciding what to put somebody through.
  useFocusEffect(useCallback(() => { refreshRoster(); }, [refreshRoster]));

  // `assignProgramTo` rather than `assignProgram`: this screen now writes to
  // as many clients as the coach ticked, and a fan-out has to report on each
  // one BY NAME. "8 of 12 saved" tells a coach something is wrong and nothing
  // about which four or what to do — see src/lib/bulkActions.ts, which is where
  // that arithmetic already lives and is not re-implemented here.
  const { getProgram, assignProgramTo, clearProgram, clearProgramFrom, status: programStatus } = useAssignedPrograms();
  const { templates, saveTemplateTo, removeTemplateFrom, isStarter, status: tplStatus } = useProgramTemplates();
  const router = useRouter();

  const params = useLocalSearchParams();
  const [clientId, setClientId] = useState((params.clientId as string) || roster[0]?.id || '');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState<BDay[]>([]);
  /**
   * ── Why a programme in progress is written to the phone ───────────────────
   *
   * The whole builder lived in React state and nowhere else. A coach who
   * locked the screen, took a call, or let the phone sleep while laying out a
   * six-exercise Push day came back to an empty builder: iOS reclaims a
   * backgrounded app's memory whenever it likes, and there was nothing on disk
   * to come back to. Twenty minutes of somebody's work, gone with no error and
   * nothing to retry.
   *
   * `draftLoaded` gates the write for the reason `app/(client)/workouts.tsx`
   * gives at the same shape: without it the first render saves the empty state
   * it starts from, straight over the draft it is about to read.
   */
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [pickerDay, setPickerDay] = useState<number | null>(null);
  const coachEx = useCoachExercises();
  /**
   * The unit the KG/LB toggle opens on for an exercise nobody has typed a
   * weight into yet.
   *
   * It used to be the literal 'kg', which is the shape src/ui/settings.tsx
   * spent a paragraph removing from the rest of the app: a coach in a gym
   * plated in pounds saw KG beside an empty field, typed 225 meaning pounds,
   * and the record stored 225 kilograms — said back to their client with the
   * confidence of a number somebody chose. `useSettings().weightUnit` is the
   * unit this coach has picked, or the one their handset's region uses when
   * they have never been asked; either way it is an answer about them rather
   * than a constant. Once they touch the toggle, `loadUnit` on the exercise is
   * what wins, because that is what they actually said about this lift.
   */
  const defaultUnit = useSettings().weightUnit;
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
  /**
   * ── Who this programme is being assigned TO ───────────────────────────────
   *
   * Reported as "need to save all built templates and be able to choose which
   * client(s) they are assigned to". It used to be one `clientId`, which was
   * both the person whose programme seeded the builder AND the only person it
   * could be sent to — so a coach who writes one week for four clients had to
   * build it four times, and a coach who picked the wrong chip overwrote the
   * wrong person's training with nothing on screen counting them.
   *
   * The two jobs are separated: `clientId` above is the client the builder is
   * LOOKING AT (their current programme seeds it, their disclosures are shown),
   * and this is the set it is being SENT to. They start the same, because the
   * ordinary case is one client and making the coach tick their own subject
   * would be ceremony.
   */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [assignBusy, setAssignBusy] = useState(false);
  /**
   * The client whose current programme the builder's contents were loaded FROM,
   * or null when they are the coach's own composition.
   *
   * The whole reason this exists is in src/lib/assignPicker.ts: the builder used
   * to replace everything in it whenever the selected client changed, and the
   * screen opens with nobody selected, so the coach's own sequence — build the
   * week, then pick who it is for — destroyed the week at the picking step.
   */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [tplSaveFailed, setTplSaveFailed] = useState<string | null>(null);

  const rosterIds = useMemo(() => roster.map((c) => c.id), [roster]);
  /**
   * ── A selected client who is no longer on the book ────────────────────────
   *
   * Photographed by the user: this screen read "No clients yet — add a client
   * from your dashboard" AND, on the primary button, "Injuries Could Not Be
   * Read". Both came from a `clientId` still held for somebody the roster no
   * longer lists. `roster.find()` returned undefined, `disclosureStatus` below
   * maps a missing client onto 'error', and the injury gate then reported the
   * disclosures of a person who is not on the book as unreadable — a sentence
   * about the wrong failure, telling the coach to go and read injuries
   * belonging to nobody.
   *
   * Cleared ONLY under a whole read, which is the one condition under which
   * "they are not on your roster" is a fact. See src/lib/assignPicker.ts.
   */
  useEffect(() => {
    if (clientId && !stillListed(rosterStatus, rosterIds, clientId)) setClientId('');
    setPicked((p) => {
      const on = Object.keys(p).filter((k) => p[k]);
      const kept = pruneSelection(rosterStatus, rosterIds, on);
      if (kept.length === on.length) return p;
      return Object.fromEntries(kept.map((id) => [id, true]));
    });
  }, [rosterStatus, rosterIds, clientId]);

  const client = roster.find((c) => c.id === clientId);
  // Only a whole read of `assigned_programs` can tell us this. Under any other
  // status a null from getProgram means "we did not find out", so saying "on
  // their auto-generated program" — and offering a Revert for a programme we
  // cannot see — would both be assertions this screen has no basis for.
  const assignedNow = programStatus === 'ready' && !!getProgram(clientId);
  // The goal the auto plan would be built from, or null when the roster does
  // not know it. Null is the state this screen used to be unable to hold, and
  // it is not rare: it covers a `clients.goal` that could not be read, one a
  // newer build wrote a value this app has never heard of into, and every
  // hand-added client whose goal the coach left blank.
  const autoGoal = goalToEnum(client?.goal);
  // Two goals for one person, in two vocabularies. Normalised before comparing,
  // so a client on 'fatloss' under a coach who wrote 'Fat loss' is agreement.
  const goalSplit = !!client && goalsDisagree(client.goal, client.coachGoal);
  const planGuard = guardOverwrite(
    programStatus,
    client ? `the programme ${client.name.split(' ')[0]} is currently on` : "this client's current programme",
  );
  // A programme is built AROUND what a client cannot do, so the coach reads
  // the disclosures before writing the sessions. Two guards rather than one
  // because they withhold the button for unrelated reasons and each has its
  // own sentence; see src/lib/injuryGate.ts.
  const acks = useInjuryAcks();
  const clientInjuries: Injury[] = (client?.injuries ?? []).map((i, n) => ({
    id: `${clientId}-${n}`, area: i.area, severity: i.severity as Injury['severity'],
    status: 'active', note: i.note, at: '',
  }));
  // How the read of the DISCLOSURES themselves went, which is a different
  // question from how the read of the acknowledgements went and was the one
  // nobody asked. `client?.injuries ?? []` is an empty list under a roster that
  // failed exactly as it is under a client who has nothing wrong with them, and
  // the gate opened on both — so an outage handed the coach a clean Assign
  // button for somebody with a severe shoulder. This is the injuries half of
  // the same discipline the rest of the screen already applies to `roster`.
  //
  // A client we DID find is trustworthy under 'partial': that status means the
  // roster was truncated, not that this row came back half-read, and their
  // injuries travelled on the row. Under 'error' the `clients` read is the one
  // that failed and anybody still in the list came from the manual half, so
  // even a client we can see is a client whose disclosures we did not read.
  const disclosureStatus: LoadStatus =
    !clientId ? 'ready'
    : rosterStatus === 'error' ? 'error'
    : client ? 'ready'
    : rosterStatus === 'loading' ? 'loading'
    : 'error';
  const injuryGate = guardInjuries(
    disclosureStatus,
    acks.status,
    clientInjuries,
    clientId ? acks.acknowledged(clientId) : null,
    client?.name.split(' ')[0] ?? 'This client',
  );
  // ── This builder edits ONE person's copy ─────────────────────────────────
  //
  // A programme sent to a group is a fan-out: each member gets their own
  // `assigned_programs` row, so a client who turns up with a shoulder is
  // changed here without touching the other seven. That is the whole reason
  // groups own the list and not the plan (app/(trainer)/group.tsx), and it is
  // worth saying on the screen where the coach is about to do it — otherwise
  // the honest fear is that editing a bootcamp client rewrites the bootcamp.
  //
  // Said only off a whole read. Under any other status this client's group
  // membership is unknown, and "in no groups" is not a thing to imply from a
  // read that did not land — so the line is simply absent rather than wrong.
  const clientGroups = useProgramGroups();
  const inGroups = clientId && clientGroups.status === 'ready' ? clientGroups.groupsForClient(clientId) : [];

  /**
   * ── The retry the injury gate never had ───────────────────────────────────
   *
   * The user photographed this screen with its primary button reading
   * "Injuries Could Not Be Read". The guard is right and stays — a programme
   * built around a disclosure nobody read is exactly what it exists to stop —
   * but it was a wall with no door. `injury_acknowledgements` is read once per
   * session, on `authRev` and on nothing else, so one bad connection latched
   * the refusal for as long as the app stayed open and the only escape was to
   * quit it.
   *
   * Both reads the gate depends on are re-run: the roster carries the
   * disclosures themselves, and the acknowledgements say whether they have been
   * read. Offered only when one of them actually failed — a gate held because
   * the coach has genuinely not confirmed an injury is not a read to retry, and
   * a Try Again there would be a button that changes nothing.
   */
  const readFailed = rosterStatus === 'error' || rosterStatus === 'partial'
    || acks.status === 'error' || acks.status === 'partial';
  const [retryBusy, setRetryBusy] = useState(false);
  const retryReads = async () => {
    if (retryBusy) return;
    setRetryBusy(true);
    await Promise.all([refreshRoster(), acks.refresh()]);
    setRetryBusy(false);
  };

  const [ackBusy, setAckBusy] = useState(false);
  const [ackFailed, setAckFailed] = useState(false);
  const confirmInjuries = async () => {
    if (!clientId || ackBusy) return;
    setAckBusy(true); setAckFailed(false);
    const ok = await acks.acknowledge(clientId, injuryGate.outstanding);
    setAckBusy(false);
    // Reported, not swallowed. A coach who believes they confirmed something
    // the server never recorded will hit the same wall next week with no idea
    // why.
    if (!ok) setAckFailed(true);
  };

  /**
   * Fill the builder from a programme.
   *
   * `loadKg` and `note` are carried across, and were not. Both are written per
   * exercise and both were dropped here, so opening a saved template — or the
   * programme a client is already on — silently emptied every weight the coach
   * had typed and every cue they had written, and the builder then presented
   * that stripped copy as the thing they had built. Re-assigning it wrote the
   * loss back over the client's real programme.
   *
   * `setGroupId` and `method` were dropped in exactly the same way and by the
   * same mechanism — this list and `composeProgram`'s enumerate their fields by
   * hand, so a field added to `ProgramExercise` has to be remembered in two
   * places and was remembered in neither. A coach who supersetted four
   * movements and marked a drop set, saved it as a template and opened it
   * again, got their week back as ungrouped ordinary sets. `setRows` is added
   * to both at once rather than becoming the fourth field to learn this.
   *
   * `from` is the client this content belongs to, or null when it is the
   * coach's own — a template, or a blank week. It is what stops the seeding
   * effect below announcing a disagreement that does not exist.
   */
  const loadFrom = (p: Program, from: string | null) => {
    setTitle(p.title);
    setNote(p.note && !GENERATED_NOTE.test(p.note) ? p.note : '');
    setDays(p.days.map((d) => ({
      day: d.day, focus: d.focus, cardio: d.cardio,
      exercises: d.exercises.map((e) => ({
        key: nextKey(), name: e.name, group: e.group, sets: e.sets, reps: e.reps,
        loadKg: e.loadKg ?? null, note: e.note, restSec: e.restSec ?? null,
        setGroupId: e.setGroupId ?? null, method: e.method ?? null,
        setRows: e.setRows && e.setRows.length ? e.setRows.map((r) => ({ ...r })) : null,
      })),
    })));
    setSeededFor(from);
  };
  const clearBuilder = () => { setTitle(''); setNote(''); setDays([]); setSeededFor(null); };

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
  const hasDraft = !!days.length || !!title.trim() || !!note.trim();
  /**
   * Whether the builder may fill itself from the selected client, and what to
   * say when it may not. The rule, and the twenty minutes of lost work behind
   * it, are in src/lib/assignPicker.ts.
   */
  const seed = seedDecision({
    programStatus,
    hasDraft,
    seededFor,
    clientId,
    firstName: client?.name.split(' ')[0] ?? 'this client',
  });
  /** Load what the selected client is really on, over whatever is in the
   *  builder. Only ever run from the control the coach taps — never on its
   *  own, which is what it used to do. */
  const loadTheirProgramme = () => {
    if (!clientId || programStatus !== 'ready') return;
    const existing = getProgram(clientId);
    if (existing) { loadFrom(existing, clientId); return; }
    // No coach-assigned programme, so the builder would normally open on the
    // client's auto plan — but the auto plan's whole content is chosen by the
    // goal, and we do not have one. Generating from a guess and drawing it here
    // is indistinguishable from drawing the real thing, which is the same trap
    // the plan guard above exists for: the coach adjusts what is on screen and
    // assigns it, and somebody trains to a goal nobody ever established. Blank,
    // and the Program section says why.
    if (!autoGoal) { clearBuilder(); return; }
    loadFrom(buildProgram(autoGoal, 25), clientId);
  };
  useEffect(() => {
    if (seed.action === 'seed') loadTheirProgramme();
    else if (seed.action === 'clear') clearBuilder();
    // 'hold' is the whole point and does nothing: what is in the builder is the
    // coach's, and it is not taken from them by a tap on somebody's name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, programStatus, autoGoal, seed.action]);

  // If opened from the template library with a templateId, load it once.
  const loadedTplRef = useRef<string | null>(null);
  useEffect(() => {
    const tid = params.templateId as string;
    if (!tid || loadedTplRef.current === tid) return;
    const tpl = templates.find((x) => x.id === tid);
    // A template is the coach's own work, not a client's programme, so it is
    // seeded `from` nobody — which is what makes the notice below tell the
    // truth when a client is then picked.
    if (tpl) { loadedTplRef.current = tid; loadFrom(tpl.program, null); setTplName(tpl.name); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.templateId, templates.length]);

  const setDayFocus = (di: number, focus: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, focus } : d)));
  const addExercise = (di: number, name: string, group: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: [...d.exercises, { key: nextKey(), name, group, sets: 3, reps: '10-12' }] } : d)));
  const removeExercise = (di: number, key: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: d.exercises.filter((e) => e.key !== key) } : d)));

  /**
   * Move one exercise up or down within its day.
   *
   * Order is not decoration in a programme — it is the order somebody trains
   * in, and a compound put after an isolation is a different session. Until
   * this, the only way to fix a movement in the wrong place was to delete it
   * and add it again at the end, which also threw away the sets, reps and
   * weight already typed against it.
   *
   * Arrows rather than drag-and-drop, deliberately and for now: a hold-and-drag
   * list needs `react-native-gesture-handler` and `react-native-reanimated`,
   * neither of which is in this build, so it cannot reach anybody over the air.
   * These work today and are also the accessible form of the same action —
   * a drag is unreachable with a screen reader, so the arrows earn their place
   * whatever gets added later.
   */
  const moveExercise = (di: number, key: string, dir: -1 | 1) =>
    setDays((ds) => ds.map((d, i) => {
      if (i !== di) return d;
      const at = d.exercises.findIndex((e) => e.key === key);
      const to = at + dir;
      // Silently doing nothing at the ends is right: the control is hidden
      // there, and a wrap-around would move the top exercise to the bottom for
      // somebody who tapped up expecting nothing to happen.
      if (at < 0 || to < 0 || to >= d.exercises.length) return d;
      const next = [...d.exercises];
      const [moved] = next.splice(at, 1);
      next.splice(to, 0, moved);
      return { ...d, exercises: next };
    }));
  /**
   * What the coach has TYPED in each weight box, keyed by exercise.
   *
   * The field used to render `String(liftIn(e.loadKg, …))` — its own parsed
   * value, re-derived on every keystroke. So typing "16." parsed to 16,
   * re-rendered as "16", and ate the decimal point as it was being typed:
   * 16.5 was unreachable no matter what keyboard was on screen. The stored
   * number stays the source of truth; this is only what is under the cursor
   * until the box is left.
   */
  const [loadDraft, setLoadDraft] = useState<Record<string, string>>({});
  /**
   * Raw rest text per exercise, for the same reason `loadDraft` exists. A coach
   * part way through typing "9" on the way to "90" has momentarily typed a
   * number this app refuses; re-deriving the field from the committed value
   * would delete the keystroke.
   */
  const [restDraft, setRestDraft] = useState<Record<string, string>>({});
  /**
   * Which method sheet is open: the day, the exercise, and the ROW inside it —
   * or `row: null` for the exercise's own default, which is what every set
   * follows unless it says otherwise.
   *
   * An object rather than the `dayIndex:key` string this used to be. A third
   * field would have meant a second parse, and the key it is parsing is minted
   * by `nextKey` with no promise about what is in it.
   */
  const [methodOpen, setMethodOpenFor] = useState<{ di: number; key: string; row: number | null } | null>(null);

  /**
   * Apply a change to an exercise's set table.
   *
   * Both halves of the patch land in one write. `sets` and the row count are
   * one fact — see src/lib/setRows.ts — and a table of four sitting under
   * `sets: 3` shows the client "3 of 3 sets" with a fourth row nothing can be
   * logged against.
   *
   * It takes a FUNCTION of the exercise rather than a finished patch, and reads
   * that exercise out of the update itself. The whole table is rewritten on
   * every keystroke, so a patch built from the render's copy would carry a
   * stale array — and two writes landing in one batch would silently discard
   * the earlier one's row. `patchEx` cannot do this: it merges fields, and this
   * has to derive them.
   */
  const patchRows = (di: number, key: string, make: (ex: BEx) => { setRows: SetRow[]; sets: number }) =>
    setDays((ds) => ds.map((d, i) => (i === di
      ? { ...d, exercises: d.exercises.map((x) => (x.key === key ? { ...x, ...make(x) } : x)) }
      : d)));

  /**
   * Join an exercise to the one after it, making a superset — or a tri-set, or
   * a giant set, depending on how many end up adjacent. The id is minted here
   * and the NAME is never stored: `setGroups.badges()` derives it from the run
   * length every render, so it cannot go stale when the run changes size.
   */
  const groupWithNext = (di: number, at: number) =>
    setDays((ds) => ds.map((d, i) => {
      if (i !== di) return d;
      const ids = joinNext(d.exercises, at, () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
      return { ...d, exercises: d.exercises.map((e, k) => ({ ...e, setGroupId: ids[k] })) };
    }));

  /**
   * Take one exercise out of its group. Only that one leaves — the rest of the
   * run stays together and is relabelled for its new size, so a tri-set that
   * loses a movement becomes a superset and says so.
   */
  const ungroup = (di: number, at: number) =>
    setDays((ds) => ds.map((d, i) => {
      if (i !== di) return d;
      const ids = leaveGroup(d.exercises, at);
      return { ...d, exercises: d.exercises.map((e, k) => ({ ...e, setGroupId: ids[k] })) };
    }));


  /**
   * Days the coach has folded away, by index.
   *
   * A five-day programme is fifteen or twenty exercises, each with its own
   * sets, reps and weight row — so reaching Friday means scrolling past all of
   * Monday to Thursday. Folding is per day rather than an accordion that opens
   * one at a time: a coach comparing Push against Pull wants both open, and a
   * screen that closes the thing you were reading because you opened another is
   * its own annoyance.
   *
   * Keyed by INDEX, and deliberately reset when a day is removed — see
   * `removeDay`. Indices shift when a day is deleted, so a stale key would fold
   * the wrong day.
   */
  const [foldedDays, setFoldedDays] = useState<Record<number, boolean>>({});
  const toggleDay = (di: number) => setFoldedDays((p) => ({ ...p, [di]: !p[di] }));

  const DRAFT_KEY = 'repple.builder.draft.v1';

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (!live || !raw) return;
        const d = JSON.parse(raw) as { title?: string; note?: string; days?: BDay[] };
        // Only restore a draft with something IN it. An empty one is not worth
        // resurrecting over whatever the screen has already been given.
        if ((Array.isArray(d.days) && d.days.length) || (typeof d.title === 'string' && d.title.trim())) {
          setTitle(typeof d.title === 'string' ? d.title : '');
          setNote(typeof d.note === 'string' ? d.note : '');
          // Whole `BDay[]`, so every field on the exercise comes back with it —
          // the weight, the unit the coach typed it in, and the note they wrote
          // on the movement. A draft that silently dropped one of those would
          // be worse than one that dropped everything: the coach would come
          // back to what looks like their week with the cues gone.
          setDays(Array.isArray(d.days) ? d.days : []);
          // A restored draft is the coach's OWN work, whoever happens to be
          // selected — so it is seeded from nobody, and the builder says so
          // rather than presenting it as somebody's current programme.
          setSeededFor(null);
        }
      } catch { /* a draft that cannot be parsed is not a draft */ }
      finally { if (live) setDraftLoaded(true); }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    // An EMPTY builder does not clear the stored draft, and that asymmetry is
    // the whole point.
    //
    // The first version of this deleted the draft whenever the screen was
    // empty, which reads as tidy and is a data-loss bug: the load is async, so
    // a remount — a coach tapping a client's name and coming back — starts with
    // empty state, and if the read is slow, fails, or returns a draft with no
    // days, `draftLoaded` flips true with nothing in state and this effect
    // wipes the one copy of their work. A guard against losing a programme must
    // not be the thing that loses it.
    //
    // So autosave only ever WRITES. The draft is cleared deliberately, at the
    // two moments the work is safely elsewhere — saved as a template, or
    // assigned — and by nothing else.
    if (!days.length && !title.trim() && !note.trim()) return;
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ title, note, days })).catch(() => {});
  }, [title, note, days, draftLoaded]);

  /** Called once the work is somewhere durable, and only then — a saved
   *  template that the server counted, or an assignment that landed on every
   *  client it was sent to. Never on a partial one: the draft is the only copy
   *  of anything that did not make it. */
  const clearDraft = () => { AsyncStorage.removeItem(DRAFT_KEY).catch(() => {}); };

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
  /* ── who this is going to ───────────────────────────────────────────────── */

  const pickedIds = Object.keys(picked).filter((k) => picked[k]);
  // The client the coach is looking at starts ticked, because the ordinary case
  // is one client and making them tick the name already selected above would be
  // ceremony. Only while nothing is ticked: once the coach has chosen a set,
  // switching whose programme they are reading must not quietly add somebody to
  // the write.
  useEffect(() => {
    if (!clientId) return;
    setPicked((p) => (Object.keys(p).some((k) => p[k]) ? p : { [clientId]: true }));
  }, [clientId]);

  /** One client's disclosures, as both guards need to see them. */
  const injuriesOf = (id: string): Injury[] => {
    const c = roster.find((r) => r.id === id);
    return (c?.injuries ?? []).map((i, n) => ({
      id: `${id}-${n}`, area: i.area, severity: i.severity as Injury['severity'],
      status: 'active', note: i.note, at: '',
    }));
  };
  /** How the read of THIS person's own disclosures went — a different question
   *  from how the acknowledgement read went, and the one nobody asked. A client
   *  the roster never produced has an empty injury list for exactly the same
   *  reason a healthy client does. */
  const disclosuresOf = (id: string): LoadStatus =>
    rosterStatus === 'error' ? 'error'
    : roster.some((r) => r.id === id) ? 'ready'
    : rosterStatus === 'loading' ? 'loading'
    : 'error';
  const asMember = (id: string): FanOutMember => ({
    clientId: id,
    name: roster.find((r) => r.id === id)?.name.split(' ')[0] ?? 'This client',
    disclosures: disclosuresOf(id),
    ackStatus: acks.status,
    injuries: injuriesOf(id),
    acknowledged: acks.acknowledged(id),
  });
  // The same fan-out plan the Groups screen and the template library use, so
  // the injury gate is consulted ONCE PER RECIPIENT and the ones it holds are
  // named rather than silently dropped. Not re-implemented here: a second
  // fan-out is how two screens start disagreeing about who a bulk assign wrote
  // to. See src/lib/groupProgram.ts.
  //
  // 'ready' for the list itself: unlike a group's membership, this is the ticks
  // the coach just made with their own thumb, and there is no read of it that
  // could have come back short. The roster it was ticked FROM carries its own
  // banner above.
  const plan = planFanOut('ready', programStatus, pickedIds.map(asMember), totalExercises > 0, fanOutSubject(pickedIds.length));
  // What the sweeping gesture is allowed to claim, given how the roster read
  // went — "Select All" over a roster that came back at its row limit ticks a
  // thousand people and calls it everybody. See src/lib/bulkActions.ts.
  const selAll = selectAllOffer(rosterStatus, roster.length);

  /** Every movement in this programme that loads something a RECIPIENT has
   *  disclosed, grouped by who. The old version asked this about the subject
   *  only, so a programme fanned out to four people was checked against one of
   *  them. */
  const injuryLoads = pickedIds.map((id) => {
    const inj = injuriesOf(id);
    const movements = days.flatMap((d) => d.exercises)
      .map((e) => {
        const f = injuryFlag(e.name, e.group || '', inj);
        return f ? { exercise: e.name, area: f.injury.area, severity: f.injury.severity } : null;
      })
      .filter(Boolean) as { exercise: string; area: string; severity: string }[];
    return { clientId: id, name: roster.find((r) => r.id === id)?.name.split(' ')[0] ?? 'This client', movements };
  }).filter((x) => x.movements.length);

  const canAssign = pickedIds.length > 0 && totalExercises > 0 && plan.allowed;
  /** The ticked clients who are actually ON something to be taken off.
   *
   *  Only off a whole read: under any other status a null from `getProgram`
   *  means "we did not find out", and offering to remove a programme this
   *  screen has not seen is the mirror of writing over one. */
  const unassignable = programStatus === 'ready'
    ? pickedIds.filter((id) => !!getProgram(id))
        .map((id) => ({ clientId: id, name: roster.find((r) => r.id === id)?.name.split(' ')[0] ?? 'This client' }))
    : [];

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

  // A picture for every movement on this screen: the ones already in the days
  // being built, and the ones in the picker below. Both in one batch, because
  // they are on screen at the same moment and two effects would be two waits.
  //
  // Reported while looking at a built program — three exercises, three names,
  // and no way to see any of them. A coach choosing between Hip Thrust and
  // Barbell Glute Bridge is choosing between two pictures.
  const catByName = useMemo(() => {
    const m = new Map<string, typeof cat.rows[number]>();
    for (const r of cat.rows) m.set(exerciseSlug(r.name), r);
    return m;
  }, [cat.rows]);
  const rowFor = (name: string) => catByName.get(exerciseSlug(name)) ?? null;
  const thumbRows = useMemo(() => {
    const inDays = days.flatMap((d) => d.exercises.map((e) => rowFor(e.name))).filter(Boolean);
    const inPicker = catShownList.slice(0, catShown);
    return [...inDays, ...inPicker] as { thumbPath: string | null; source?: string | null }[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, catByName, catShownList, catShown]);
  const thumbFor = useCatalogueThumbs(thumbRows);

  // A fresh search starts at the top of the catalogue rather than 300 rows into
  // the last one.
  useEffect(() => { setCatShown(30); }, [pickTerm]);

  /** Open a movement's detail screen without losing the day being built. */
  const previewExercise = (name: string) => {
    setPreviewing(true);
    router.push({ pathname: '/(trainer)/exercise', params: { name, from: 'trainerBuilder' } });
  };

  /**
   * The one place the builder's state becomes a Program.
   *
   * ONE place, because the assign handler used to carry its own identical copy
   * of this object literal — so `loadKg` and the per-exercise note, added to the
   * builder later, would have had to be remembered twice and would have gone
   * out on the template and not on the assignment, or the other way round. The
   * fields a coach types are the fields that must survive all three paths out
   * of this screen: the template, the assignment, and the on-device draft.
   *
   * `note` is `undefined` and never '' for a blank field: an empty string
   * stored as a note draws an empty bubble under the movement in the client's
   * app, which reads as their coach having written something and left it blank.
   */
  const composeProgram = (): Program => ({
    title: title.trim() || 'Custom program',
    focus: ['Coach-assigned', 'Personalised for you'],
    note: note.trim() || 'Your coach built this program for you. Progress the weight when you hit the top of the rep range.',
    days: days.filter((d) => d.exercises.length).map((d) => ({
      day: d.day, focus: d.focus.trim() || 'Training', cardio: d.cardio,
      exercises: d.exercises.map((e, i) => ({
        key: d.day + '-' + i, name: e.name, group: e.group || '',
        reps: e.reps || '8-12', alternatives: [],
        loadKg: e.loadKg ?? null,
        note: e.note && e.note.trim() ? e.note.trim() : undefined,
        restSec: e.restSec ?? null,
        setGroupId: e.setGroupId ?? null,
        method: e.method ?? null,
        // `undefined` and never `[]` for an exercise the coach did not open a
        // table on: an empty array would be a claim that this movement has no
        // sets, and it is the one value src/lib/setRows.ts has to defend
        // against on the way back in. Absent is what "every set is the same
        // set" looks like, and it is what a build that cannot read a table
        // needs to find.
        setRows: e.setRows && e.setRows.length ? e.setRows : undefined,
        // The two numbers are one fact — see setRows.ts. Recomputed here rather
        // than trusted, because this is the last gate before the programme
        // leaves the screen and a client counting "2 of 3 sets" against a table
        // of four is the failure it would produce.
        sets: setCount(e),
      })),
    })),
  });
  // `saveTemplateTo` resolves { ok: false } when the insert never reached
  // `program_templates`, and this used to discard that and say "Template
  // saved". The template then sat in the library for the rest of the session
  // and was gone at the next launch, so the coach's evidence that their work
  // was saved was a sentence this screen made up.
  //
  // The failure now carries its own reason, because "did not reach the server"
  // was said for every cause alike — including the one the coach can act on,
  // which was the app not yet knowing who they were signed in as.
  const doSaveTemplate = async () => {
    if (totalExercises === 0) { Alert.alert('Nothing to save', 'Add at least one exercise first.'); return; }
    const nm = tplName.trim() || title.trim() || 'Untitled template';
    const saved = await saveTemplateTo(nm, composeProgram());
    setSaveOpen(false); setTplName('');
    // The work is on the server now, so the on-device draft has nothing left
    // to protect. Only on a counted save — see clearDraft.
    if (saved.ok) clearDraft();
    setTplSaveFailed(saved.ok ? null : `“${nm}” is not in your library. ${saved.why ?? 'The server did not say why.'} Nothing has been lost from the builder — try saving it again.`);
    Alert.alert(
      saved.ok ? 'Template saved' : 'Not saved',
      saved.ok
        ? 'It is in your Program Templates and will be there when you reopen the app — assign it to as many clients as you like.'
        : `“${nm}” was not saved. ${saved.why ?? 'The server did not say why.'} What you built is still in the builder, so nothing has been lost — try again once you have signal.`,
    );
  };
  /**
   * Record that the coach chose to load a disclosure, for ONE recipient.
   *
   * Recorded BEFORE that person's programme is written, and their write is
   * abandoned if it cannot be. The point of the acknowledgement is that it
   * exists; a programme that went out while the record of the coach's decision
   * did not is the one outcome that makes this worse than having no record at
   * all — it would look, afterwards, exactly like a coach who never knew.
   *
   * Per recipient rather than per tap, and that is the change a fan-out forces:
   * this used to be written once, for the subject, and a programme sent to four
   * people left a record against one of them.
   */
  const recordInjuryChoice = async (
    forClient: string,
    movements: { exercise: string; area: string; severity: string }[],
  ): Promise<boolean> => {
    if (!movements.length) return true;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return false;
      // The row is counted, not merely un-errored. This record is the only
      // thing that will ever say the coach knew, and "no error" is not the same
      // sentence as "it is there" — a manually-added client has no `profiles`
      // row for the foreign key to find, and the whole point of the record is
      // that it survives to be read back by somebody arguing about it later.
      const { data, error } = await supabase.from('program_injury_acknowledgements')
        .insert({ trainer_id: uid, client_id: forClient, movements })
        .select('id');
      if (error) { reportError('builder.injuryChoice', error, { clientId: forClient }); return false; }
      if (!data || !data.length) {
        reportError('builder.injuryChoice', new Error('acknowledgement insert returned no row'), { clientId: forClient });
        return false;
      }
      return true;
    } catch (e) { reportError('builder.injuryChoice', e, { clientId: forClient }); return false; }
  };

  /**
   * Send what is in the builder to everybody ticked.
   *
   * ── 1 · a count is not consent ────────────────────────────────────────────
   *
   * Assigning REPLACES what somebody is currently training, with no undo, no
   * record of what was there and nothing telling the client their next session
   * changed. So the write is preceded by a sentence that states how many of the
   * ticked clients are on a programme now and NAMES them — `overwriteBrief`, in
   * src/lib/bulkActions.ts. The names are the part that works: a coach does not
   * recognise "3 of 4", and does recognise the person they spent an hour
   * programming on Tuesday.
   *
   * ── 2 · partial failure is the normal case ────────────────────────────────
   *
   * Four writes are four chances to be refused, and the ordinary reason is not
   * a network: `assigned_programs_coach_rw` runs through `is_my_client`, which
   * looks in `clients`, so every hand-added client on the book fails it. The
   * report names both halves and the FAILURES STAY TICKED, so trying again is
   * the same gesture over the set that still needs it.
   *
   * ── 3 · and the injury gate keeps its own list ───────────────────────────
   *
   * `plan.blocked` is who this must not write to at all. They were never in
   * `plan.send`, they stay ticked with the retries, and they are named
   * separately — a client held for an unread disclosure is not a failed write
   * and the two must not be reported as one thing.
   */
  const assign = async () => {
    // Belt as well as braces: the control is withheld above, and the handler
    // refuses too. An overwrite of somebody's training must not be one stray
    // render away from happening.
    if (!canAssign || assignBusy) return;

    const targets: AssignTarget[] = plan.send.map((id) => ({
      clientId: id,
      name: roster.find((r) => r.id === id)?.name.split(' ')[0] ?? 'This client',
      // Only sayable because `planFanOut` has already passed the overwrite
      // guard: under any status but a whole read a null from getProgram means
      // "we did not find out", and this sentence would be counting silence.
      onProgramme: !!getProgram(id),
    }));
    const brief = overwriteBrief(targets, title.trim() || 'this programme');
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert(brief.title, brief.body, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        // Destructive only when something is actually being destroyed. A red
        // button on every assign is a red button nobody reads.
        { text: brief.confirmLabel, style: brief.replacing.length ? 'destructive' : 'default', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!go) return;

    // Knowing about a disclosure is not the same as deciding to load it anyway.
    // The gate covers the first; this covers the second, and asks at the moment
    // the coach commits rather than while they are still arranging days. Asked
    // once, about everybody it applies to — four dialogs in a row is a dialog
    // nobody reads.
    const sending = injuryLoads.filter((x) => plan.send.includes(x.clientId));
    if (sending.length) {
      const lines = sending.flatMap((x) =>
        x.movements.slice(0, 4).map((m) => `· ${x.name} — ${m.exercise}, ${areaLabel(m.area).toLowerCase()}, ${m.severity}`),
      );
      const shown = lines.slice(0, 8);
      const more = sending.reduce((a, x) => a + x.movements.length, 0) - shown.length;
      const okd = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'These load what they disclosed',
          `${shown.join('\n')}${more > 0 ? `\n· and ${num(more)} more` : ''}\n\n` +
            'You can absolutely programme these on purpose. Confirming records that you chose to, with the date — ' +
            `${listNames(sending.map((x) => x.name))} can see that record too.`,
          [
            { text: 'Change the Programme', style: 'cancel', onPress: () => resolve(false) },
            { text: 'I Know — Assign', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!okd) return;
    }

    setAssignBusy(true);
    const program = composeProgram();
    const outcomes: WriteOutcome[] = await Promise.all(targets.map(async (tg) => {
      // The record first, and this client's write abandoned if it cannot be
      // made. Per client, so one unrecordable acknowledgement does not cancel
      // three assignments that had nothing to acknowledge.
      const mine = sending.find((x) => x.clientId === tg.clientId);
      if (mine) {
        const recorded = await recordInjuryChoice(tg.clientId, mine.movements);
        if (!recorded) {
          return {
            clientId: tg.clientId, name: tg.name, ok: false,
            why: 'your acknowledgement could not be saved, so the programme was not sent either — it would have left no sign you knew.',
          };
        }
      }
      const r = await assignProgramTo(tg.clientId, program);
      return { clientId: tg.clientId, name: tg.name, ok: r.ok, why: r.why };
    }));
    setAssignBusy(false);

    const report = bulkReport('assign', outcomes);
    if (outcomes.some((o) => o.ok)) notifySuccess();
    // What is left to do: the writes that did not land, plus the people the
    // injury gate held. Both need the coach to come back to them, so both stay
    // ticked and trying again is the same gesture over the set that still
    // needs it.
    const outstanding = [...report.retry, ...plan.blocked.map((b) => b.clientId)];
    setPicked(Object.fromEntries(outstanding.map((id) => [id, true])));
    // Everybody it was sent to has it, and nobody is being held — so the
    // programme is durable somewhere other than this phone and the draft has
    // nothing left to protect. Kept on any partial outcome, because the draft
    // is then the only copy of what did not land.
    if (!outstanding.length) clearDraft();

    const parts = [report.body];
    // Named, never silently dropped. A coach who believes four people got a
    // programme when three did is worse off than one who was refused.
    if (plan.blocked.length) {
      parts.push(`${listNames(plan.blocked.map((b) => b.name))} ${plan.blocked.length === 1 ? 'was' : 'were'} not written to at all — they have disclosed injuries this screen cannot confirm you have read, and they are still ticked. Select them above and read what they disclosed.`);
    }
    Alert.alert(report.title, parts.join('\n\n'));
  };

  /**
   * Take the ticked clients OFF whatever they are on.
   *
   * Asked for as "assign and un-assign templates meanwhile keeping the data for
   * the history of the workouts done in those templates so you can add it back
   * in at a later stage". Un-assign was reachable only as `revert`, below,
   * which acts on the one client the builder is looking at — so a coach who had
   * put a block on eight people had to open eight builders to end it.
   *
   * The overwrite guard is asked FIRST and for the same reason as on the assign
   * side: under anything but a whole read of `assigned_programs` this screen
   * cannot tell a client who is on nothing from one whose row did not come
   * back, so the count in the confirmation would be counting silence. The
   * injury gate is NOT asked, and deliberately: it exists to stop a programme
   * being BUILT around a disclosure nobody read, and removing a programme is
   * the one action that cannot do that.
   */
  const unassign = async () => {
    if (!pickedIds.length || assignBusy) return;
    const guard = guardOverwrite(programStatus, fanOutSubject(pickedIds.length));
    if (!guard.allowed) { Alert.alert('Held', guard.reason as string); return; }

    const targets: AssignTarget[] = pickedIds.map((id) => ({
      clientId: id,
      name: roster.find((r) => r.id === id)?.name.split(' ')[0] ?? 'This client',
      onProgramme: !!getProgram(id),
    }));
    const brief = unassignBrief(targets);
    if (!brief.replacing.length) { Alert.alert(brief.title, brief.body); return; }
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert(brief.title, brief.body, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: brief.confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
    if (!go) return;

    setAssignBusy(true);
    const outcomes: WriteOutcome[] = await Promise.all(brief.replacing.map(async (tg) => {
      const r = await clearProgramFrom(tg.clientId);
      return { clientId: tg.clientId, name: tg.name, ok: r.ok, why: r.why };
    }));
    setAssignBusy(false);
    const report = bulkReport('unassign', outcomes);
    if (outcomes.some((o) => o.ok)) notifySuccess();
    // The ones it did not work for stay ticked, so trying again is the same
    // gesture over the set that still needs it.
    if (report.retry.length) setPicked(Object.fromEntries(report.retry.map((id) => [id, true])));
    Alert.alert(report.title, report.body);
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
    // The removal is what reverts them — the client's own Train tab generates
    // their auto plan from the goal on their own row. All that is in question
    // here is what this builder shows next, so an unknown goal empties it
    // rather than filling it with a fat-loss plan nobody chose.
    if (autoGoal) loadFrom(buildProgram(autoGoal, 25), clientId);
    else clearBuilder();
    Alert.alert('Reverted to auto', `${client?.name ?? 'Your client'} is back on their auto-generated program.`);
  };

  /**
   * Delete a saved template.
   *
   * Confirmed and NAMED first, because a template is the coach's own work and
   * there is no undo — a mis-tap on the wrong row has to be visible before it
   * is irreversible. The row does not leave the list until the server counts
   * it; see `removeTemplateFrom`.
   *
   * Deleting a stencil cannot reach a client training from it: an assignment is
   * a jsonb copy in `assigned_programs` with no reference back, and no foreign
   * key in the database points at `program_templates` at all. That is said in
   * the confirmation rather than left for the coach to worry about.
   */
  const [tplDelFailed, setTplDelFailed] = useState<string | null>(null);
  const deleteTemplate = (id: string, name: string) => {
    Alert.alert(
      'Delete This Template?',
      `“${name}” is removed from your library for good — there is no undo. Anybody already training it keeps their programme, and every session they have logged is untouched: an assignment is a copy, not a link back to this.`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          const gone = await removeTemplateFrom(id);
          setTplDelFailed(gone.ok ? null : `“${name}” is still in your library. ${gone.why ?? 'The server did not say why.'}`);
        } },
      ],
    );
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
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Program Builder</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 4 }}>Build a weekly plan, save it as a template, and assign it to as many clients as you like.</Text>
        </View>

        {/* ── client ─────────────────────────────────────────────────────── */}
        <Section>
          {/* The roster count is a count, so it waits for a whole read. Under
              'partial' `roster.length` is the size of the page that came back,
              not the size of the book. */}
          <SectionHead title="Building For" note={rosterStatus === 'ready' && roster.length ? `${num(roster.length)} in roster` : undefined} />
          {/* Two different questions, and they used to be one control. This one
              is whose current programme and disclosures the builder shows; who
              it gets SENT to is the tick-list further down, and it can be
              several people. Saying so here is what stops a coach reading this
              row as the recipient. */}
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
            Whose current programme and injuries to work from. Who it goes to is further down, and can be more than one person.
          </Text>

          {/* An unread roster is not an empty one. Without this a coach with a
              full book is told they have no clients and sent to add one — and
              "add a client from your dashboard" is then advice about a problem
              they do not have. The empty state below is therefore said only
              under a WHOLE read. */}
          {rosterStatus === 'error' ? (
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="Nobody is listed below because the roster did not come back — it does not mean you have no clients, and nothing you have built here is affected.">
              <View style={{ marginTop: sp.md }}>
                <Ghost label={retryBusy ? 'Trying Again…' : 'Try Reading Again'} onPress={retryReads} />
              </View>
            </Notice>
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
                  <Pressable key={c.id} onPress={() => setClientId(on ? '' : c.id)}
                    accessibilityRole="button" accessibilityLabel={on ? `Stop building for ${c.name}` : `Build for ${c.name}`}
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
          {/* ── the coach's goal and the client's, when they are not the same ──
              Said, not settled. The line above shows the CLIENT's goal, because
              that is what their macros and their own screens run on; what the
              coach picked in Add Client was written to a different table and
              was, until now, simply never shown to anybody again. Two people
              working to two different goals is a conversation to have in the
              next session, so this is neutral: no warning tone, no control to
              "fix" it, and nothing here overwrites either value. */}
          {goalSplit ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
              You recorded {client!.coachGoal} for {client!.name.split(' ')[0]}; they have {client!.goal.toLowerCase()} set in their own app. Neither has been changed.
            </Text>
          ) : null}
        </Section>

        <Rule />

        {/* ── templates ──────────────────────────────────────────────────── */}
        {/* Save as Template used to be the `note` on the SectionHead: small,
            quiet, uppercased micro text with a chevron, in the top right
            corner. Reported as "need to make the Save as Template bigger, it
            gets lost" — and it is the primary way a coach keeps their work,
            drawn like a footnote. It is a control now, beside the one that
            takes a template out, so the two read as the pair they are.

            The count waits for a whole read, because under 'partial' or
            'error' `templates.length` is the size of what arrived plus three
            built-in starters, which is not the size of the library. */}
        <Section>
          <SectionHead title="Templates" note={tplStatus === 'ready' && templates.length ? `${num(templates.length)} saved` : undefined} />
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
            Save this week to reuse it with anybody, or start from one you have already built.
          </Text>

          {/* The starters are the problem, not the consolation. Three of them
              are always present, so a coach whose saved programmes did not come
              back sees a working library with somebody else's programmes in it
              and concludes their work is gone. */}
          {tplStatus === 'error' ? (
            <Notice tone={t.warn} kicker="Library" title="Your saved templates could not be read"
              note="Only the built-in starters are listed below. That is not a statement that you have saved nothing — your own programmes are on the server and did not come back. Reopen this screen once you have signal." />
          ) : tplStatus === 'partial' ? (
            <PartialRead what="templates in your library" shown={templates.length} />
          ) : null}

          {tplSaveFailed ? (
            <Notice tone={t.crit} kicker="Template" title="That template was not saved" note={tplSaveFailed} />
          ) : null}

          <Cta wide label="Save as Template" onPress={() => { setTplName(tplName || title); setSaveOpen(true); }} />
          <View style={{ height: sp.sm }} />
          <Ghost label="Start From a Template" icon="grid" onPress={() => setTplPick(true)} />
          <View style={{ height: sp.sm }} />
          {/* The library was reachable from inside the picker sheet above and
              from the Explore list, and from nowhere a coach standing on this
              screen would look. It is where the twelve programmes they have
              built actually live. */}
          <Ghost label="Open Template Library" icon="grid" onPress={() => router.push('/(trainer)/templates')} />
        </Section>

        <Rule />

        {/* ── the program itself ─────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Program" />

          {/* Why the builder below is empty. Without this the coach sees a
              blank program with no explanation and starts typing one, which is
              the same trap by a different door: the work is real, the save at
              the bottom is what has to be held. */}
          {!planGuard.allowed && !hasDraft ? (
            <Notice tone={t.warn} kicker={programStatus === 'loading' ? 'Reading' : 'Programme'}
              title={programStatus === 'loading' ? 'Reading their current programme' : 'What they are on could not be read'}
              note={`${planGuard.reason} Nothing has been loaded into the builder, because an empty builder is not this client's plan.`} />
          ) : null}

          {/* ── what is in the builder, and whose it is ──────────────────────
              The builder used to replace everything in it whenever the
              selected client changed, and the screen opens with nobody
              selected — so the coach's own order of work, lay out the week and
              then pick who it is for, destroyed the week at the picking step.
              Nothing is taken from them now.

              The other half of that has to be said out loud: a builder showing
              one thing while a client's name is selected is exactly the trap
              the rest of this screen guards, so when the two disagree it says
              so and offers the replacement as something the coach taps. */}
          {seed.note ? (
            <Notice tone={t.ink3} kicker="Builder" title="This is your own draft" note={seed.note}>
              {seed.replaceLabel ? (
                <View style={{ marginTop: sp.md }}>
                  <Ghost label={seed.replaceLabel} onPress={loadTheirProgramme} />
                </View>
              ) : null}
            </Notice>
          ) : null}

          {/* An unreadable goal used to be answered with a fat-loss programme.
              The builder is empty instead, and this says whose goal is missing
              and what to do about it — the coach or the client sets one, and
              nobody here guesses. It is only shown once we know there is no
              coach-assigned programme to display, because that case has a plan
              to show and needs no goal at all. */}
          {client && planGuard.allowed && !assignedNow && !autoGoal ? (
            <Notice tone={t.ink3} kicker="Goal" title="No goal on record"
              note={`${client.name.split(' ')[0]}'s goal is not one this app recognises${client.goal ? ` — their roster row reads “${client.goal}”` : ''}, so no auto-generated plan has been built: the plan a goal produces is a fat-loss block, a toning block or a muscle block, and picking one on their behalf is a guess about somebody's training. Ask them to set a goal in their app, or build the week yourself below and assign it.`} />
          ) : null}

          {inGroups.length ? (
            <Flag tone={t.brand} style={{ marginBottom: sp.lg }}>
              {`${client?.name.split(' ')[0] ?? 'This client'} is in ${listNames(inGroups.map((g) => g.name))}. Assigning here changes only their copy — nobody else in ${inGroups.length === 1 ? 'the group' : 'those groups'} is touched.`}
            </Flag>
          ) : null}

          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Program name</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Push · Pull · Legs" placeholderTextColor={t.ink3}
            style={[inp, { marginBottom: sp.lg }]} />
          {/* The letter at the top of the week. Cues about ONE movement go on
              that movement — a tempo note is useless attached to a Tuesday —
              which is what the Notes field under each exercise below is for. */}
          <Text style={{ ...ty.caption, color: t.ink2, marginBottom: 6 }}>Note to client (optional)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Why this block, what to watch for overall…" placeholderTextColor={t.ink3}
            multiline style={[inp, { minHeight: 72, textAlignVertical: 'top' }]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
            This sits at the top of their week. Notes about a single movement go on that movement, further down.
          </Text>
        </Section>

        <Rule />

        {/* ── days ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Training Days"
            note={days.length ? `${days.length} day${s(days.length)} · ${num(totalExercises)} exercise${s(totalExercises)}` : undefined} />

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
                {/* Fold. The count travels with it, so a folded day still says
                    how much is in it — a row that collapses to just "Wed" makes
                    a coach open it again to find out whether it is the empty
                    one. */}
                <Pressable onPress={() => toggleDay(di)} accessibilityRole="button"
                  accessibilityState={{ expanded: !foldedDays[di] }}
                  accessibilityLabel={`${foldedDays[di] ? 'Show' : 'Hide'} the ${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'} on ${d.day}`}
                  hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: sp.sm, paddingVertical: sp.sm }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{d.exercises.length}</Text>
                  {/* A triangle rather than an Icon: the set has no chevron up
                      or down, and `app/(client)/workouts.tsx` already uses
                      exactly these two characters for the same gesture. */}
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{foldedDays[di] ? '▾' : '▴'}</Text>
                </Pressable>
                <Pressable onPress={() => removeDay(di)} accessibilityRole="button" accessibilityLabel="Remove day" hitSlop={8}
                  style={{ paddingHorizontal: sp.sm, paddingVertical: sp.sm }}>
                  <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
                </Pressable>
              </View>

              {foldedDays[di] ? null : (() => {
                // Computed ONCE per day rather than per row: the badge for any
                // exercise depends on its neighbours, so a per-row call would
                // walk the whole day for every exercise in it.
                const dayBadges = groupBadges(d.exercises);
                return d.exercises.map((e, ei) => {
                const gb = dayBadges[ei];
                // The sets as they will be drawn, worked out once. `tabled`
                // says whether the coach has opened a per-set table on this
                // movement; `list` is what to render either way.
                const rows = { tabled: hasSetRows(e), list: expandSets(e) };
                // A run reads as one block: the rule between two exercises in
                // the same group is dropped, because the line is what says
                // "these are separate". The group's own tinted rail down the
                // left is what says they are not.
                const joinedAbove = ei > 0 && gb != null && dayBadges[ei - 1]?.id === gb.id;
                return (
                <View key={e.key} style={{
                  marginTop: joinedAbove ? 0 : sp.md,
                  paddingTop: sp.md,
                  borderTopWidth: joinedAbove ? 0 : hairline,
                  borderTopColor: t.ring,
                  ...(gb ? { borderLeftWidth: 2, borderLeftColor: t.brand, paddingLeft: sp.md, marginLeft: -sp.md } : null),
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {/* The whole name and picture open the movement, so a coach
                        can check what they have written down without hunting
                        for a control. What opens is the same screen the client
                        gets, which is the point — and it carries Record a clip
                        for the movements this coach wants in their own words. */}
                    <Pressable onPress={() => previewExercise(e.name)} accessibilityRole="button"
                      accessibilityLabel={`What ${e.name} is`}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      <ExerciseThumb uri={thumbFor(rowFor(e.name) ?? { thumbPath: null })} t={t} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.name}</Text>
                        {/* The muscle group, and — separately — the set group.
                            Two different meanings of the word "group" that
                            happened to collide in this file, kept apart on
                            screen because a coach reading "Chest · Superset 1
                            of 2" needs both and would be misled by either
                            alone. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.xs, flexWrap: 'wrap', marginTop: 2 }}>
                          {e.group ? <Text style={{ ...ty.caption, color: t.ink3 }}>{e.group}</Text> : null}
                          {gb ? (
                            <Text style={{ ...ty.caption, color: t.brand, fontWeight: '600' }}>
                              {e.group ? '· ' : ''}{gb.label} · {gb.position} of {gb.size}
                            </Text>
                          ) : null}
                          {(() => {
                            const mb = badgeFor(e.method);
                            if (!mb) return null;
                            return (
                              <Text style={{ ...ty.caption, color: t.ink3 }} accessibilityLabel={mb.label}>
                                {e.group || gb ? '· ' : ''}{mb.label}
                              </Text>
                            );
                          })()}
                        </View>
                        {/* The gate makes a coach READ what a client cannot do.
                            It did nothing to help them act on it: they could
                            acknowledge a moderate knee, then put squats, lunges
                            and leg press in the programme and assign it, with
                            this screen silent throughout — and the client's own
                            app would quietly flag or swap those movements
                            afterwards. The coach is the one making the decision,
                            so they are told at the moment they are making it.

                            `injuryFlag`'s own sentence is written for the client
                            ("may stress YOUR knee"), so the wording is composed
                            here instead of borrowed. */}
                        {(() => {
                          const f = injuryFlag(e.name, e.group || '', clientInjuries);
                          if (!f) return null;
                          return (
                            <Flag tone={t.warn} style={{ marginTop: 3 }}>
                              Loads their {areaLabel(f.injury.area).toLowerCase()} · {f.injury.severity}
                            </Flag>
                          );
                        })()}
                      </View>
                    </Pressable>
                    {/* Hidden at the ends rather than disabled: a control that
                        cannot do anything is still something to aim at. */}
                    {d.exercises.findIndex((x) => x.key === e.key) > 0 ? (
                      <Pressable onPress={() => moveExercise(di, e.key, -1)} accessibilityRole="button"
                        accessibilityLabel={`Move ${e.name} earlier in ${d.day}`} hitSlop={8}
                        style={{ paddingHorizontal: sp.xs, paddingVertical: sp.xs }}>
                        <Text style={{ ...ty.body, color: t.ink3 }}>▲</Text>
                      </Pressable>
                    ) : null}
                    {d.exercises.findIndex((x) => x.key === e.key) < d.exercises.length - 1 ? (
                      <Pressable onPress={() => moveExercise(di, e.key, 1)} accessibilityRole="button"
                        accessibilityLabel={`Move ${e.name} later in ${d.day}`} hitSlop={8}
                        style={{ paddingHorizontal: sp.xs, paddingVertical: sp.xs }}>
                        <Text style={{ ...ty.body, color: t.ink3 }}>▼</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => removeExercise(di, e.key)} accessibilityRole="button" accessibilityLabel={`Remove ${e.name} from ${d.day}`} hitSlop={8}
                      style={{ paddingHorizontal: sp.sm, paddingVertical: sp.xs }}>
                      <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
                    </Pressable>
                  </View>
                  {/* ── the sets, one at a time or all at once ─────────────
                      An exercise is EITHER a count and one spec — three sets
                      of 8-10 at 42.5, which is what every programme in the
                      database says today — OR a table of rows that can each
                      differ. Both are on screen here, never together: two
                      places to type the weight of set one, disagreeing, is
                      worse than either.

                      The single spec is still the default, and the table is
                      opened by adding a set. That control is the only thing in
                      the app that writes `setRows`, which is what keeps every
                      programme nobody has edited exactly as it was. */}
                  {rows.tabled ? (
                    <View style={{ marginTop: sp.md }}>
                      {/* Column heads. ty.micro renders uppercase, so this is
                          the SET / REPS / WEIGHT strip from the screenshot
                          without the source having to shout. */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                        <Text style={{ ...ty.micro, color: t.ink3, width: 26 }}>Set</Text>
                        <Text style={{ ...ty.micro, color: t.ink3, width: 74 }}>Reps</Text>
                        <Text style={{ ...ty.micro, color: t.ink3, width: 84 }}>Weight</Text>
                      </View>
                      {rows.list.map((row, ri) => {
                        // Drafts are per ROW, so typing "16." into set three
                        // cannot disturb set one. `#` because `nextKey` mints
                        // the exercise key and promises nothing about `:`.
                        const rk = `${e.key}#${ri}`;
                        const u = e.loadUnit ?? defaultUnit;
                        const rm = methodFor(row.method).method;
                        return (
                          <View key={rk} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: 6 }}>
                            <Text style={{ ...value(15), color: t.ink3, width: 26 }}>{row.n}</Text>
                            <TextInput value={row.reps}
                              onChangeText={(v) => patchRows(di, e.key, (x) => patchSetRow(x, ri, { reps: v }))}
                              placeholder="8-10" placeholderTextColor={t.ink3}
                              accessibilityLabel={`Reps in set ${row.n} of ${e.name}`}
                              style={[inp, { width: 74, paddingVertical: 7, paddingHorizontal: 10 }]} />
                            {/* The same text-draft as the single Weight field
                                below, and for the same reason: re-deriving the
                                box from the committed kilograms on every
                                keystroke deletes the "16." on the way to
                                "16.5". The draft holds what was typed and the
                                commit happens behind it. */}
                            <TextInput
                              value={loadDraft[rk] ?? (row.loadKg == null ? '' : String(liftIn(row.loadKg, u)))}
                              onChangeText={(v) => {
                                setLoadDraft((prev) => ({ ...prev, [rk]: v }));
                                if (!v.trim()) { patchRows(di, e.key, (x) => patchSetRow(x, ri, { loadKg: null })); return; }
                                const r = readLift(v, u);
                                if (r.ok) patchRows(di, e.key, (x) => patchSetRow(x, ri, { loadKg: r.kg }));
                              }}
                              onBlur={() => setLoadDraft((prev) => { const n = { ...prev }; delete n[rk]; return n; })}
                              keyboardType="decimal-pad" placeholder="optional" placeholderTextColor={t.ink3}
                              accessibilityLabel={`Weight for set ${row.n} of ${e.name}, in ${u === 'kg' ? 'kilograms' : 'pounds'}`}
                              style={[inp, { width: 84, paddingVertical: 7, paddingHorizontal: 10 }]} />
                            {/* How THIS set is performed — the thing the
                                per-exercise field could only say once. A
                                warm-up first set and a drop-set last one now
                                fit in one movement. The catalogue's short
                                marker is what fits; the full label is what is
                                read out, because "RP" is not a word. */}
                            <Pressable onPress={() => setMethodOpenFor({ di, key: e.key, row: ri })} accessibilityRole="button"
                              accessibilityLabel={`How set ${row.n} of ${e.name} is performed — currently ${rm.label}`}
                              style={{ minWidth: 34, alignItems: 'center', paddingHorizontal: sp.sm, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                              <Text style={{ ...ty.caption, fontWeight: '600', color: badgeFor(row.method) ? t.ink : t.ink3 }}>{rm.short}</Text>
                            </Pressable>
                            {/* Hidden on the last row rather than disabled: an
                                exercise of no sets is not a lighter exercise,
                                and removing the movement has its own control. */}
                            {rows.list.length > 1 ? (
                              <Pressable onPress={() => patchRows(di, e.key, (x) => removeSetRow(x, ri))} accessibilityRole="button"
                                accessibilityLabel={`Remove set ${row.n} of ${e.name}`} hitSlop={8}
                                style={{ paddingHorizontal: sp.xs, paddingVertical: sp.xs }}>
                                <Text style={{ ...ty.body, color: t.ink3 }}>×</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        );
                      })}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                        <Pressable onPress={() => patchRows(di, e.key, (x) => addSetRow(x))} accessibilityRole="button"
                          accessibilityLabel={`Add a set to ${e.name}`}
                          style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring }}>
                          <Text style={{ ...ty.caption, color: t.ink2 }}>Add Set</Text>
                        </Pressable>
                        {/* The unit the coach is typing in, for the whole
                            table. One switch rather than one per row: a gym is
                            plated in whatever it is plated in, and the column
                            is one column. Kilograms are stored either way. */}
                        <Pressable accessibilityRole="button"
                          accessibilityLabel={`Weight unit: ${(e.loadUnit ?? defaultUnit) === 'kg' ? 'kilograms' : 'pounds'}. Switch to ${(e.loadUnit ?? defaultUnit) === 'kg' ? 'pounds' : 'kilograms'}`}
                          onPress={() => patchEx(di, e.key, { loadUnit: (e.loadUnit ?? defaultUnit) === 'kg' ? 'lb' : 'kg' })}
                          style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                          <Text style={{ ...ty.label, fontWeight: '600', color: t.ink }}>{(e.loadUnit ?? defaultUnit).toUpperCase()}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                  <>
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
                  {/* The third number. Blank is a real answer — bodyweight
                      work, or a movement the coach wants the client to judge —
                      so it is never defaulted. The unit sits beside the field
                      because a gym is plated in whatever it is plated in, and
                      the figure being typed is the one on the machine. What is
                      STORED is kilograms either way. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>Weight</Text>
                    <TextInput
                      value={loadDraft[e.key] ?? (e.loadKg == null ? '' : String(liftIn(e.loadKg, e.loadUnit ?? defaultUnit)))}
                      onChangeText={(v) => {
                        const u = e.loadUnit ?? defaultUnit;
                        // Keep the raw text as well as the parsed number. "16."
                        // and "16,5" are both valid things to be part-way
                        // through typing, and neither survives a round trip
                        // through readLift and back — which is what deleted the
                        // decimal point mid-keystroke.
                        setLoadDraft((p) => ({ ...p, [e.key]: v }));
                        if (!v.trim()) { patchEx(di, e.key, { loadKg: null }); return; }
                        const r = readLift(v, u);
                        // A number that is not yet valid ("16.") leaves the last
                        // good value alone rather than clearing it, so pausing
                        // mid-decimal does not wipe what was already there.
                        if (r.ok) patchEx(di, e.key, { loadKg: r.kg, loadUnit: u });
                      }}
                      onBlur={() => setLoadDraft((p) => { const n = { ...p }; delete n[e.key]; return n; })}
                      keyboardType="decimal-pad" placeholder="optional" placeholderTextColor={t.ink3}
                      style={[inp, { width: 84, paddingVertical: 7, paddingHorizontal: 10 }]} />
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={`Weight unit: ${(e.loadUnit ?? defaultUnit) === 'kg' ? 'kilograms' : 'pounds'}. Switch to ${(e.loadUnit ?? defaultUnit) === 'kg' ? 'pounds' : 'kilograms'}`}
                      onPress={() => patchEx(di, e.key, { loadUnit: (e.loadUnit ?? defaultUnit) === 'kg' ? 'lb' : 'kg' })}
                      style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                      <Text style={{ ...ty.label, fontWeight: '600', color: t.ink }}>{(e.loadUnit ?? defaultUnit).toUpperCase()}</Text>
                    </Pressable>
                  </View>
                  {/* Turning three identical sets into three rows that can
                      differ. It appends a copy of what is already there, so
                      the fourth set of a 3 × 8-10 at 42.5 is another 8-10 at
                      42.5 rather than a blank line the client would meet with
                      no numbers on it. */}
                  <View style={{ flexDirection: 'row', marginTop: sp.sm }}>
                    <Pressable onPress={() => patchRows(di, e.key, (x) => addSetRow(x))} accessibilityRole="button"
                      accessibilityLabel={`Write out the sets of ${e.name} one by one, so each can have its own weight`}
                      style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring }}>
                      <Text style={{ ...ty.caption, color: t.ink2 }}>Add Set</Text>
                    </Pressable>
                  </View>
                  </>
                  )}
                  {/* ── the coach's own words, on this movement ──────────────
                      Asked for as "trainer notes attached in the exercise.
                      then they are saved for future reference". The builder
                      had one note for the whole programme, which is the wrong
                      grain for what coaches actually write down: "keep the
                      elbows tucked", "3-1-1 tempo", "stop two reps short",
                      "the machine by the window, seat on 4". Those are about
                      one movement and are useless attached to a week.

                      It travels on the exercise, so it survives every path out
                      of this screen — saved into a template, written onto the
                      assignment, and carried in the on-device draft — and the
                      client reads it at the machine, attributed to the coach
                      who wrote it. */}
                  {/* ── Rest, method, and grouping ────────────────────────
                      Three things a coach could not say before, on one row
                      because they are all answers to "how is this performed"
                      rather than "what is it". */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}>
                    {/* The rest between sets, in SECONDS. The client's guided
                        runner already had a timer — hardcoded to the same
                        default for every exercise in every programme, which is
                        right for accessory work and wrong for a heavy triple.
                        Blank is a real answer and the common one: the client
                        falls back to the app default and their rest card says
                        so, rather than presenting a number nobody chose as the
                        coach's instruction. */}
                    <Text style={{ ...ty.caption, color: t.ink3 }}>Rest</Text>
                    <TextInput
                      value={restDraft[e.key] ?? (e.restSec == null ? '' : String(e.restSec))}
                      onChangeText={(v) => {
                        setRestDraft((prev) => ({ ...prev, [e.key]: v }));
                        if (!v.trim()) { patchEx(di, e.key, { restSec: null }); return; }
                        const r = readRestSeconds(v);
                        // A number not yet valid ("9" on the way to "90")
                        // leaves the last good value alone rather than
                        // clearing it. The refusal is said on blur, not on
                        // every keystroke.
                        if (r.ok && r.seconds != null) patchEx(di, e.key, { restSec: r.seconds });
                      }}
                      onBlur={() => {
                        const typed = restDraft[e.key];
                        setRestDraft((prev) => { const n = { ...prev }; delete n[e.key]; return n; });
                        if (typed == null || !typed.trim()) return;
                        const r = readRestSeconds(typed);
                        // Said, not swallowed. A rest that silently stayed at
                        // its old value while the coach believes they changed
                        // it is a programme that does not say what they think.
                        if (!r.ok) Alert.alert('Check that rest', r.reason);
                      }}
                      keyboardType="number-pad"
                      placeholder={String(DEFAULT_REST_SEC)}
                      placeholderTextColor={t.ink3}
                      accessibilityLabel={`Rest between sets of ${e.name}, in seconds`}
                      style={[inp, { width: 68, paddingVertical: 7, paddingHorizontal: 10 }]} />
                    <Text style={{ ...ty.caption, color: t.ink3 }}>
                      {e.restSec != null ? `sec · ${restClock(e.restSec)}` : `sec · default ${restClock(DEFAULT_REST_SEC)}`}
                    </Text>

                    {/* How the sets are performed. The label shown is the
                        catalogue's, never a stored string, so a method renamed
                        later reads correctly in programmes already written. */}
                    <Pressable onPress={() => setMethodOpenFor({ di, key: e.key, row: null })} accessibilityRole="button"
                      accessibilityLabel={`How ${e.name} is performed${rows.tabled ? ', by default' : ''} — currently ${methodFor(e.method).method.label}`}
                      style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring, backgroundColor: t.surface2 }}>
                      <Text style={{ ...ty.caption, color: t.ink }}>{methodFor(e.method).method.label}</Text>
                    </Pressable>

                    {/* Grouping is an act on a PAIR, so the control lives on
                        the upper exercise and names the lower one. Hidden
                        rather than disabled where there is nothing below to
                        join, and where the two are already in one run. */}
                    {canJoinNext(d.exercises, ei) ? (
                      <Pressable onPress={() => groupWithNext(di, ei)} accessibilityRole="button"
                        accessibilityLabel={`Perform ${e.name} back to back with ${d.exercises[ei + 1]?.name}`}
                        style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>Group with next</Text>
                      </Pressable>
                    ) : null}
                    {isGrouped(d.exercises, ei) ? (
                      <Pressable onPress={() => ungroup(di, ei)} accessibilityRole="button"
                        accessibilityLabel={`Take ${e.name} out of the ${gb?.label.toLowerCase() ?? 'group'}`}
                        style={{ paddingHorizontal: sp.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring }}>
                        <Text style={{ ...ty.caption, color: t.ink2 }}>Ungroup</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <View style={{ marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, color: t.ink3, marginBottom: 4 }}>Notes for this exercise</Text>
                    <TextInput
                      value={e.note ?? ''}
                      onChangeText={(v) => patchEx(di, e.key, { note: v })}
                      placeholder="Cue, tempo, setup — they see this at the machine…"
                      placeholderTextColor={t.ink3}
                      accessibilityLabel={`Your notes on ${e.name}`}
                      multiline
                      style={[inp, { minHeight: 44, textAlignVertical: 'top', paddingVertical: 9 }]} />
                  </View>
                </View>
                );
              });
              })()}

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
          {/* ── who gets this ──────────────────────────────────────────────
              Asked for as "need to save all built templates and be able to
              choose which client(s) they are assigned to". It used to be one
              client, and that client was also whoever happened to be selected
              at the top of the screen — so a coach writing one week for four
              people built it four times, and a mis-tapped chip wrote over the
              wrong person's training with nothing on screen counting them.

              The fan-out, the confirmation and the report are all the ones the
              template library already uses (src/lib/groupProgram.ts and
              src/lib/bulkActions.ts). A second copy of any of them is how two
              screens come to disagree about who a bulk assign wrote to. */}
          <SectionHead title="Assign To" note={rosterStatus === 'ready' && pickedIds.length ? `${num(pickedIds.length)} of ${num(roster.length)}` : undefined} />

          {rosterStatus === 'error' ? (
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="Nobody is listed here because the roster did not come back — it does not mean you have no clients. What you have built is untouched. Reopen this screen once you have signal." />
          ) : rosterStatus === 'partial' ? (
            <PartialRead what="clients on your book" shown={roster.length} />
          ) : null}

          {roster.length === 0 && rosterStatus === 'ready' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              No clients yet — add or invite a client and they will appear here to assign to.
            </Text>
          ) : roster.length === 0 && rosterStatus === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>Reading your roster…</Text>
          ) : null}

          {roster.map((c, i) => {
            const on = !!picked[c.id];
            // Only sayable off a whole read. Under any other status the absence
            // of a programme means nothing was found out, and marking somebody
            // "no program yet" on that basis is how a coach comes to overwrite
            // one without realising.
            const replaces = programStatus === 'ready' && !!getProgram(c.id);
            const held = plan.blocked.find((b) => b.clientId === c.id);
            return (
              <Pressable key={c.id} onPress={() => setPicked((p) => ({ ...p, [c.id]: !p[c.id] }))}
                accessibilityRole="button" accessibilityLabel={`${on ? 'Do not assign to' : 'Assign to'} ${c.name}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: on ? t.brand : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Icon name="check" size={14} color={t.brandInk} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.name}</Text>
                  {/* The warning is a DOT, not the ink: warn as caption text
                      measures under AA on the three light palettes, so the one
                      sentence the coach most needs was the hardest to read.
                      The words carry the meaning; the dot carries the tone. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {replaces ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} /> : null}
                    <Text style={{ ...ty.caption, color: replaces ? t.ink2 : t.ink3, flex: 1 }}>
                      {c.goal}{replaces ? ' · replaces the program they are on' : ''}
                    </Text>
                  </View>
                  {/* Their own sentence, on their own row. A count of how many
                      are held tells the coach nothing about whose knee it is. */}
                  {held ? <Flag tone={t.warn} style={{ marginTop: 4 }}>{held.reason}</Flag> : null}
                </View>
              </Pressable>
            );
          })}

          {/* "Select All" over a roster that came back at its row limit ticks a
              page of people and calls it everybody. Nothing on screen is false
              and the coach is still acting on a set they cannot see, so the
              gesture is renamed to the number actually shown rather than
              withheld or warned about. See src/lib/bulkActions.ts. */}
          {selAll.note ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{selAll.note}</Text>
          ) : null}
          {roster.length ? (
            <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
              <View style={{ opacity: selAll.allowed ? 1 : 0.4 }} pointerEvents={selAll.allowed ? 'auto' : 'none'}>
                <Ghost label={selAll.label} onPress={() => {
                  if (!selAll.allowed) return;
                  setPicked(Object.fromEntries(roster.map((c) => [c.id, true])));
                }} />
              </View>
              {pickedIds.length ? (
                <Ghost label="Clear Selection" onPress={() => setPicked({})} />
              ) : null}
            </View>
          ) : null}
        </Section>

        <Rule />

        <Section>
          {/* The disclosures themselves, above the button that is being held.
              Telling a coach to read something without showing it to them is
              a wall, not a check. Shown for the client the builder is focused
              on; every OTHER held recipient is named on their own row above,
              with their own reason. */}
          {!injuryGate.allowed && injuryGate.outstanding.length ? (
            <View style={{ marginBottom: sp.lg }}>
              <Notice tone={t.s3} kicker={`${client?.name.split(' ')[0] ?? 'This client'} has disclosed`} title="Injuries & Limitations">
                <View style={{ marginTop: sp.md, gap: sp.sm }}>
                  {injuryGate.outstanding.map((inj, i) => (
                    <View key={i}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>
                        {areaLabel(inj.area)} · {inj.severity}
                      </Text>
                      {inj.note ? <Text style={{ ...ty.label, color: t.ink2, marginTop: 2 }}>{inj.note}</Text> : null}
                    </View>
                  ))}
                </View>
                <View style={{ marginTop: sp.lg }}>
                  <Cta wide label={ackBusy ? 'Confirming…' : 'I Have Read These'} onPress={confirmInjuries} />
                </View>
                {ackFailed ? (
                  <Flag tone={t.crit} style={{ marginTop: sp.sm }}>
                    That did not save, so nothing has been recorded. Check your connection and try again.
                  </Flag>
                ) : null}
              </Notice>
            </View>
          ) : null}

          {/* ── a refusal the coach can act on ─────────────────────────────
              The guard is right and stays: a programme built around an injury
              nobody read is what it exists to stop. What it did not have was a
              way out. `injury_acknowledgements` is read once per session, on
              `authRev` and nothing else, so a read that failed on a bad
              connection left the button reading "Injuries Could Not Be Read"
              for as long as the app stayed open — a wall with no door, which
              the coach could only escape by force-quitting. This re-runs both
              reads the gate depends on. */}
          {!plan.allowed && plan.reason ? (
            <View style={{ marginBottom: sp.lg }}>
              <Notice tone={t.warn} kicker="Held" title={plan.label ?? 'This cannot go out yet'} note={plan.reason}>
                {readFailed ? (
                  <View style={{ marginTop: sp.md }}>
                    <Ghost label={retryBusy ? 'Trying Again…' : 'Try Reading Again'} onPress={retryReads} />
                  </View>
                ) : null}
              </Notice>
            </View>
          ) : null}
          {plan.allowed && plan.heldNote ? (
            <Notice tone={t.warn} kicker="Not everybody" title="Some of these are held" note={plan.heldNote} />
          ) : null}

          {/* Not a gate. A coach may have every reason to programme around a
              knee deliberately — that is their judgement and their client. It
              is only refusing to let them do it without noticing. Counted
              across every recipient, because a programme fanned out to four
              people used to be checked against one of them. */}
          {injuryLoads.length ? (
            <View style={{ marginBottom: sp.md }}>
              <Flag tone={t.warn}>
                {injuryLoads.map((x) => `${x.name}: ${num(x.movements.length)} movement${x.movements.length === 1 ? '' : 's'} (${[...new Set(x.movements.map((m) => areaLabel(m.area).toLowerCase()))].join(', ')})`).join(' · ')}
                {' — '}this programme loads something they have disclosed. You will be asked to confirm.
              </Flag>
            </View>
          ) : null}

          <View style={{ opacity: canAssign ? 1 : 0.4 }} pointerEvents={canAssign && !assignBusy ? 'auto' : 'none'}>
            <Cta wide label={assignCtaLabel({
              busy: assignBusy,
              picked: pickedIds.length,
              exercises: totalExercises,
              planLabel: plan.label,
              soleName: pickedIds.length === 1 ? (roster.find((r) => r.id === pickedIds[0])?.name ?? null) : null,
            })} onPress={assign} />
          </View>

          {totalExercises === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
              Add at least one exercise to assign this program.
            </Text>
          ) : pickedIds.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginTop: sp.sm }}>
              Tick everybody who should get this — one client or twenty.
            </Text>
          ) : null}

          {/* ── taking somebody off, without putting them on something else ──
              Un-assign was reachable only as the Revert below, which acts on
              the one client the builder is looking at — so a coach ending a
              block for eight people had to open eight builders. This is the
              same fan-out over the ticks.

              Independent of what is in the builder: removing a programme has
              nothing to do with the week on screen, so it is offered whether or
              not there are exercises in it. */}
          {unassignable.length ? (
            <View style={{ marginTop: sp.lg }}>
              <Ghost label={assignBusy ? 'Working…' : unassignable.length === 1
                ? `Take ${unassignable[0].name} Off Their Programme`
                : `Take ${num(unassignable.length)} Off Their Programmes`} onPress={unassign} />
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 6 }}>
                They go back to an auto-generated plan. Every session they have logged stays exactly where it is, so
                you can put the same programme back later and their history is still underneath it.
              </Text>
            </View>
          ) : null}

          {/* The single-client version, kept because it does something the
              fan-out above does not: it also puts the BUILDER back on the
              client's auto plan, so the coach can see what they will be
              training next. Only offered when the control above is not already
              about this person — two buttons doing nearly the same thing to the
              same client is how a coach ends up unsure which one they pressed. */}
          {assignedNow && !unassignable.some((u) => u.clientId === clientId) ? (
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
          <Text style={{ ...ty.title, color: t.ink, marginBottom: sp.lg }}>Add Exercise</Text>
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
                // And into the shared library, so the movement a coach invented
                // gains an id every later reference resolves to — a search
                // entry, a place for an illustration, and a history that lines
                // up with the same lift logged from anywhere else. Marked as
                // the coach's own, never as a curated catalogue row: it has a
                // name and nothing else, and the library says so.
                //
                // Not awaited, for the same reason as remember() above: the
                // exercise belongs to the program the moment it is typed.
                void ensureCatalogueRow(nm);
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
            {ownShown.length ? <SectionHead title="Your Exercises" /> : null}

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
                title="Exercise Catalogue"
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
                              {[e.group, e.hasDemo ? 'Illustrated' : null].filter(Boolean).join(' · ')}
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
          <Text style={{ ...ty.title, color: t.ink }}>Start From a Template</Text>
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
            {/* A refused delete leaves the row exactly where it was, which is
                right and is also silent — so it says so here. */}
            {tplDelFailed ? (
              <Text style={{ ...ty.caption, color: t.ink2, marginBottom: sp.md }}>{tplDelFailed}</Text>
            ) : null}
            {templates.map((tpl, i) => {
              const dc = tpl.program.days.length;
              const ec = tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);
              return (
                <View key={tpl.id} style={{
                  flexDirection: 'row', alignItems: 'center',
                  borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring,
                }}>
                  <Pressable onPress={() => { loadFrom(tpl.program, null); setTplName(tpl.name); setTplPick(false); }}
                    accessibilityRole="button" accessibilityLabel={`Start from ${tpl.name}`}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="grid" size={17} color={t.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{tpl.name}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{num(dc)} day{s(dc)} · {num(ec)} exercise{s(ec)}{isStarter(tpl.id) ? ' · starter' : ''}</Text>
                    </View>
                    <Text style={{ ...ty.label, fontWeight: '500', color: t.brand }}>Use</Text>
                  </Pressable>
                  {/* Not offered on a starter. Those three are compiled into
                      the bundle, so "deleting" one hides it until the next
                      launch and it is back — and it was the only way to empty
                      the picker entirely, with no route back to them. */}
                  {isStarter(tpl.id) ? null : (
                    <Pressable onPress={() => deleteTemplate(tpl.id, tpl.name)} hitSlop={8}
                      accessibilityRole="button" accessibilityLabel={`Delete ${tpl.name}`}
                      style={{ paddingLeft: sp.md, paddingVertical: sp.md }}>
                      <Icon name="minus" size={17} color={t.ink3} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <View style={{ marginTop: sp.lg }}>
            <Ghost label="Manage All Templates" onPress={() => { setTplPick(false); router.push('/(trainer)/templates'); }} />
          </View>
        </View>
      </Modal>

      {/* ── save-as-template ─────────────────────────────────────────────── */}
      {/* ── How this exercise is performed ────────────────────────────────
          A sheet rather than a cycling button: there are twelve methods and
          each needs its sentence to be choosable at all. A coach who does not
          already know what "rest-pause" means cannot pick it from a label. */}
      <Modal visible={methodOpen !== null} transparent animationType="slide" onRequestClose={() => setMethodOpenFor(null)}>
        <Pressable style={scrim} onPress={() => setMethodOpenFor(null)} />
        <View style={sheet}>
          {(() => {
            const cur = methodOpen ? days[methodOpen.di]?.exercises.find((x) => x.key === methodOpen.key) : undefined;
            const forRow = methodOpen != null && methodOpen.row != null;
            const n = methodOpen?.row == null ? 0 : methodOpen.row + 1;
            return (
              <>
              {/* The sheet says which it is about. A coach who tapped set 3's
                  marker and a coach who tapped the exercise's are looking at
                  the same twelve rows, and only one of those choices lands on
                  every set of the movement. */}
              <Text style={{ ...ty.title, color: t.ink }}>{forRow ? `How is set ${n} performed?` : 'How is it performed?'}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
                {forRow
                  ? 'This set only. It is carried to the client and read at the machine, and it drives their rest timer — a drop set runs straight through with no rest.'
                  : 'The default for every set of this exercise that has not been given its own. It is carried to the client and read at the machine, and it drives their rest timer — a drop set runs straight through with no rest.'}
              </Text>
              <ScrollView style={{ maxHeight: 380 }}>
                {SET_METHODS.map((m) => {
                  // What is selected is read through `expandSets` for a row, so
                  // a row that has not said anything shows the exercise default
                  // rather than showing 'Normal' beside an exercise that is not.
                  const at = cur && forRow ? expandSets(cur)[methodOpen!.row as number] : undefined;
                  const on = forRow
                    ? ((at?.method ?? DEFAULT_METHOD) === m.id)
                    : ((cur?.method ?? DEFAULT_METHOD) === m.id);
                  return (
                    <Pressable key={m.id} accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${m.label}. ${m.blurb}`}
                      onPress={() => {
                        // 'normal' is stored as null rather than as the string,
                        // so an ordinary set carries no field at all and a
                        // programme written before methods existed reads back
                        // identically. On a ROW that null is still an answer —
                        // "this set is ordinary" — which is how one set opts
                        // out of an exercise whose default is a drop set.
                        const chosen = m.id === DEFAULT_METHOD ? null : m.id;
                        if (methodOpen == null) return;
                        if (methodOpen.row != null && cur) patchRows(methodOpen.di, methodOpen.key, (x) => patchSetRow(x, methodOpen.row as number, { method: chosen }));
                        else patchEx(methodOpen.di, methodOpen.key, { method: chosen });
                        setMethodOpenFor(null);
                      }}
                      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingVertical: sp.md,
                               borderBottomWidth: hairline, borderBottomColor: t.ring }}>
                      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                                     backgroundColor: on ? t.brand : t.surface2 }}>
                        <Text style={{ ...ty.caption, fontWeight: '700', color: on ? t.brandInk : t.ink3 }}>{m.short}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...ty.body, color: t.ink, fontWeight: on ? '600' : '400' }}>{m.label}</Text>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{m.blurb}</Text>
                        {!m.countsToVolume ? (
                          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>Not counted as training volume.</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
              </>
            );
          })()}
        </View>
      </Modal>

      <Modal visible={saveOpen} transparent animationType="slide" onRequestClose={() => setSaveOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={scrim} onPress={() => setSaveOpen(false)} />
        <View style={sheet}>
          <Text style={{ ...ty.title, color: t.ink }}>Save as Template</Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: 4, marginBottom: sp.lg }}>
            Reuse this program with other clients — {num(totalExercises)} exercise{s(totalExercises)} across {num(days.filter((d) => d.exercises.length).length)} day{s(days.filter((d) => d.exercises.length).length)}.
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
