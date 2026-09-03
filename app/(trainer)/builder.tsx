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
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { num } from '../../src/lib/format';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { MIN_TARGET, hitSlopFor } from '../../src/lib/a11y';
import { badges as groupBadges, canJoinNext, isGrouped, joinNext, leaveGroup } from '../../src/lib/setGroups';
import { applyMove, shifts as dragShifts, targetIndex } from '../../src/lib/dragReorder';
import { SET_METHODS, DEFAULT_METHOD, badgeFor, methodFor, otherMethodsHint } from '../../src/lib/setMethods';
import { addSetRow, expandSets, hasSetRows, patchSetRow, removeSetRow, setCount, type SetRow } from '../../src/lib/setRows';
import { readRestSeconds, restClock, DEFAULT_REST_SEC } from '../../src/lib/restTimer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { liftIn, liftLabel, readLift, volumeIn, type WeightUnit } from '../../src/lib/units';
import { Rule, Section, SectionHead, Cta, Ghost, Flag, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { useAssignedPrograms } from '../../src/ui/assignedPrograms';
import { useProgramTemplates } from '../../src/ui/programTemplates';
import { deleteRefusedLine } from '../../src/lib/templateLibrary';
import { useCoachExercises, mergeExerciseLists } from '../../src/ui/coachExercises';
import { useSettings } from '../../src/ui/settings';
import { useExerciseCatalogue } from '../../src/ui/exerciseDetail';
import { exerciseSlug } from '../../src/lib/exerciseId';
import { useCatalogueThumbs } from '../../src/ui/useCatalogueThumbs';
import { matchesSearch, fallbackTag } from '../../src/lib/catalogueLocale';
import { ensureCatalogueRow } from '../../src/ui/customExercise';
import { ExerciseThumb } from '../../src/ui/ExerciseDemo';
import { buildProgram, type Program, type ProgramDay } from '../../src/lib/programs';
// A programme can now be more than one week. `programWeeks` is the ONE reader
// that resolves the block, `withWeeks` the ONE writer that keeps `days` — which
// is what the shipped client app renders — in step with week one. Neither this
// screen nor any other builds the pair by hand; see src/lib/programBlock.ts.
import { canAddWeek, isBlock, programWeeks, weekLabel, withWeeks } from '../../src/lib/programBlock';
// Effort, share of a max and rep speed — three columns a coach was writing into
// a free-text note because there was nowhere else for them. src/lib/setIntensity.ts
// owns every parse and every bound, and now also the words the CLIENT reads
// them in: `intensityMeaning` is drawn on their Train tab and in their session.
import {
  readPercent1RM, readRpe, readTempo, tempoMeaning,
} from '../../src/lib/setIntensity';
// The day the coach said the block begins, and the sentence that stops it
// becoming a promise this app does not keep.
import { CLIENT_STARTS_NOW, isStartDate } from '../../src/lib/programStart';
import { alreadyAt, progressionOffer, loadTapLabel } from '../../src/lib/builderProgression';
import { guardOverwrite } from '../../src/lib/overwriteGuard';
import { guardInjuries } from '../../src/lib/injuryGate';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
import { useInjuryAcks } from '../../src/ui/injuryAcks';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { areaLabel, injuryFlag, type Injury } from '../../src/lib/injuries';
import { goalToEnum, goalsDisagree } from '../../src/lib/rosterMerge';
import { CHECKS, NOT_CHECKED, checksLine, coverageLine, reviewProgram, type Finding } from '../../src/lib/programReview';
import { deltaLabel } from '../../src/lib/deltaLabel';
import { dayLabel } from '../../src/lib/adherence';
import { capLimit, capped } from '../../src/lib/rowCap';
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { rowToEntry, type WorkoutRow } from '../../src/lib/workoutRow';
import type { WorkoutEntry } from '../../src/lib/mockData';
import { USE_SUPABASE } from '../../src/lib/config';
import { useProgramGroups } from '../../src/ui/groupProgram';
import { listNames, planFanOut, fanOutSubject, type FanOutMember } from '../../src/lib/groupProgram';
import {
  overwriteBrief, unassignBrief, bulkReport, selectAllOffer,
  type AssignTarget, type WriteOutcome,
} from '../../src/lib/bulkActions';
import { seedDecision, stillListed, pruneSelection, assignCtaLabel } from '../../src/lib/assignPicker';
import { foldsAfterRemoval, foldsForNewProgramme } from '../../src/lib/foldedDays';
import { notifySuccess } from '../../src/ui/haptics';
import { WEEK_DAYS } from '../../src/lib/weekStart';
import { FORWARD_ICON } from '../../src/ui/direction';
import { DateSheet } from '../../src/ui/DateSheet';

/** The week, in the order src/lib/weekStart.ts draws one. This is the order a
 *  new day is offered in and the order Cycle Day walks, so the builder and the
 *  client's own week strip read the same way round. */
const DAYS = WEEK_DAYS;
/** One week of a block, as this screen edits it. The mirror of `ProgramWeek`
 *  in src/lib/programs.ts over the builder's own `BDay`, which carries a draft
 *  key and a unit the coach typed in that no stored programme needs. */
type BWeek = { days: BDay[]; label?: string; deload?: boolean };
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

/**
 * A stored week as this screen edits it.
 *
 * Hoisted out of `loadFrom` because a block loads several weeks through it and
 * a copy of this mapping per week is a copy of the list of fields — which is
 * exactly the drift `loadFrom`'s own comment warns about, where a field added
 * to the builder later gets remembered in one of the two places.
 */
const toBuilderDays = (ds: readonly ProgramDay[]): BDay[] =>
  (ds ?? []).map((d) => ({
    day: d.day, focus: d.focus, cardio: d.cardio,
    exercises: (d.exercises ?? []).map((e) => ({
      key: nextKey(), name: e.name, group: e.group, sets: e.sets, reps: e.reps,
      loadKg: e.loadKg ?? null, loadUnit: e.loadUnit, note: e.note, restSec: e.restSec ?? null,
      setGroupId: e.setGroupId ?? null, method: e.method ?? null,
      rpe: e.rpe ?? null, pct1rm: e.pct1rm ?? null, tempo: e.tempo ?? null,
      setRows: e.setRows && e.setRows.length ? e.setRows.map((r) => ({ ...r })) : null,
    })),
  }));


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
   * The prescribed effort on the RPE scale, the prescribed share of a one-rep
   * max, and the prescribed rep speed. Absent on every exercise of every
   * programme ever written, and absent is what round-trips.
   *
   * NOT `feel`. `feel` is the client's own report after the set, recorded by
   * the person who did it, and it is evidence; `rpe` is an instruction written
   * beforehand by somebody who was not there. src/lib/setIntensity.ts owns the
   * scale, the bounds and the refusal to convert a percentage into kilograms
   * off a maximum nobody tested.
   *
   * They are per-EXERCISE here and per-ROW on `setRows`, by the same
   * absent-inherits rule as `method` — so a ramp can carry one target on the
   * top set and none on the back-offs.
   */
  rpe?: number | null;
  pct1rm?: number | null;
  tempo?: string | null;
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
  const { getProgram, assignProgramTo, clearProgram, clearProgramFrom, status: programStatus, reload: reloadPrograms } = useAssignedPrograms();
  const { templates, saveTemplateTo, removeTemplateFrom, isStarter, status: tplStatus, reload: reloadTemplates } = useProgramTemplates();
  /**
   * The coach's OWN saved templates, which is what "3 saved" claims to count.
   *
   * `templates` is never only theirs: src/ui/programTemplates.tsx seeds three
   * built-in starters and composes the coach's rows in front of them. The
   * status gate on the header was added and the arithmetic was not, so a coach
   * who has saved nothing read "3 saved" and one who had saved two read five.
   * That label is where they look to find out whether an evening's work is
   * still there, and it would have said yes either way.
   */
  const savedCount = templates.filter((tpl) => !isStarter(tpl.id)).length;
  const router = useRouter();

  const params = useLocalSearchParams();
  /**
   * Who this is for — and nobody, unless the coach said so.
   *
   * This used to fall back to `roster[0]?.id`. That is not a choice, it is an
   * alphabetical accident, and which name it lands on depends on whether the
   * roster provider happened to be warm on the first render — so the same tap
   * did different things on a cold launch and a warm one. What followed was
   * worse than the arbitrariness: the effect below ticks the selected client as
   * the recipient of an assign this file itself documents as irreversible, and
   * the seeding effect loads that person's live block over the screen. A coach
   * who opened Programs to sketch a week had the first person on their book
   * already ticked and their programme already open, so the first thing they
   * typed was an edit to somebody's live plan.
   *
   * Empty is a state the rest of the screen already handles: `seedDecision`
   * answers "the builder is the coach's own scratch space and nothing is being
   * claimed about anybody", and the assign control has nobody ticked until a
   * name is chosen.
   */
  const [clientId, setClientId] = useState((params.clientId as string) || '');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  /**
   * ── The block, and why `days` stopped being state ─────────────────────────
   *
   * `Program` held one week and so did this screen. Every coach on this
   * platform sells a six-, eight- or twelve-week block, and what they did
   * instead was write week one, assign it, and then reopen the builder every
   * Sunday night to retype next week's loads over the top of it — which is the
   * app making a self-employed person do a database write on their evening,
   * and which destroyed the previous week every time.
   *
   * The obvious change is to make `days` a list of weeks. It cannot be done
   * that way: `Program.days` is what a phone that has not been updated renders,
   * and it has never heard of a week index. So `days` stays week one on the way
   * out — a current client build reads the whole block through
   * src/lib/clientBlock.ts and is shown the week its start date counts to (see
   * `composeProgram`, and the argument in full on `ProgramWeek` in
   * src/lib/programs.ts) and `blockWeeks` is the whole block in here.
   *
   * `days` is now DERIVED from it rather than being state of its own, and
   * `setDays` writes into the week being edited. That is deliberate and it is
   * the only safe shape: there are forty-odd `setDays(...)` calls on this
   * screen and every one of them goes on meaning "change the week I am looking
   * at" without being touched. Two pieces of state — a week list and a copy of
   * the current week — would have needed a sync point at every one of those
   * forty, and the failure of a missed one is a coach's edit vanishing when
   * they tap a week chip.
   */
  const [blockWeeks, setBlockWeeks] = useState<BWeek[]>([{ days: [] }]);
  /** Which week is on screen. Always a valid index into `blockWeeks` — every
   *  path that shortens the block clamps it, because a week index past the end
   *  renders an empty builder over a programme that is not empty. */
  const [weekIdx, setWeekIdx] = useState(0);
  /**
   * The day the coach says this block begins, `YYYY-MM-DD`, or '' because they
   * have not said — which stays the default, because "assign it now" is what
   * this control has always meant and every assignment ever made is that.
   *
   * IT DOES NOT HOLD THE PROGRAMME BACK. The client's Train tab renders
   * whatever is on their row the moment it is written, and
   * `CLIENT_STARTS_NOW` is printed under the field saying so. That sentence is
   * the whole safety argument: a coach who believes the date is enforced, and
   * assigns a block "starting Monday" on a Thursday, has just replaced their
   * client's Friday session while believing they did not — which is strictly
   * worse than the Sunday-night alarm this field exists to end.
   *
   * What it DOES do, on a multi-week block, is count the week number the client
   * is shown once it has passed: week three of eight opens on week three rather
   * than on week one. That is the date moving a week number, never withholding
   * a session, and src/lib/clientBlock.ts is where all five of its states are
   * resolved to a week somebody can train today.
   */
  const [startsOn, setStartsOn] = useState('');
  /** Whether the month sheet over that field is open. Reported from the floor
   *  twice: "is there a way that when you click on the space of the date the
   *  whole calendar option pops up for selection?", then "when you tap the date
   *  the keyboard pops up and blocks what you are typing" — src/ui/DateSheet.tsx.
   *  The field is now a button and nothing on this screen raises a keyboard for
   *  a date; typing lives inside the sheet, so coaches who paste dates out of
   *  their own messages still have a way in. */
  const [startPick, setStartPick] = useState(false);
  const days: BDay[] = blockWeeks[weekIdx]?.days ?? [];
  const setDays: React.Dispatch<React.SetStateAction<BDay[]>> = (updater) =>
    setBlockWeeks((ws) => ws.map((w, i) => (i === weekIdx
      ? { ...w, days: typeof updater === 'function' ? (updater as (d: BDay[]) => BDay[])(w.days) : updater }
      : w)));
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
  /** Whether the server may be asked about this person at all. `handAdded`
   *  undefined is "the roster has not said yet", which goes on asking; only an
   *  explicit true withholds. See src/lib/clientRecord.ts. */
  const clientAskable = clientIsQueryable(clientId, client?.handAdded);
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

  /* ── What this client has actually been doing ───────────────────────────
     One of the seven programme checks compares the volume a coach has just
     written against what this client has really logged for the same movement,
     and it cannot be done from anything already on this screen. The read is
     the same one app/(trainer)/client-training.tsx makes — same columns, same
     cap, same `workouts_coach_read` policy — because a second way of asking
     the same table is how two coach screens come to disagree about a client's
     training.

     `null` is "there is nobody to compare against", which is the ordinary
     state of this screen with a template open and no client picked. It is a
     different answer from an empty array, which would be a client who has
     logged nothing, and src/lib/programReview.ts reads the two differently:
     one stands the check down, the other runs it and finds nothing. */
  /** Bumped by the pull below, so the log is re-read with everything else. */
  const [reviewLogNonce, setReviewLogNonce] = useState(0);
  const [reviewLog, setReviewLog] = useState<WorkoutEntry[] | null>(null);
  const [reviewLogStatus, setReviewLogStatus] = useState<LoadStatus>('ready');
  /* The client whose answer is allowed to land. Tapping down a book starts a
     read per tap and they do not come back in order, so without this one
     client's training can arrive under another's name — the same guard
     client-training.tsx and client-body.tsx carry, and here it would put a
     volume finding about the wrong person in front of the coach. */
  const wantedLog = useRef<string | null>(null);
  useEffect(() => {
    wantedLog.current = clientId ?? null;
    if (!clientId || !USE_SUPABASE) { setReviewLog(null); setReviewLogStatus('ready'); return; }
    // A client the coach typed in by hand has a `coach_clients` row and no user
    // account. There is nothing to read and nothing failed: the check stands
    // down rather than reporting a client who never trains.
    //
    // This was `isQueryableId(clientId)`, which stopped separating the two the
    // moment `coach_clients.id` turned out to be uuid DEFAULT
    // gen_random_uuid(): the guard passed, the read ran, it came back empty
    // with no error, and the volume check compared a whole block against a
    // training history that had never been asked for. The roster is what knows
    // which table the row came from — src/lib/clientRecord.ts.
    if (!clientAskable) { setReviewLog(null); setReviewLogStatus('ready'); return; }
    let live = true;
    setReviewLog(null); setReviewLogStatus('loading');
    void (async () => {
      const { data, error } = await supabase.from('workouts')
        .select('id, performed_at, exercise, sets, feel, cardio, kcal, session_mins, logged_by, amended_at')
        .eq('user_id', clientId)
        .order('performed_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit());
      if (!live || wantedLog.current !== clientId) return;
      if (error) {
        reportError('builder.reviewLog', error);
        // Null, not []. An empty list here would be read as a client with no
        // training, and the check would then report nothing and look like it
        // had run. The status is what makes the screen say it did not.
        setReviewLog(null); setReviewLogStatus('error');
        return;
      }
      const page = capped((data ?? []) as unknown as WorkoutRow[]);
      setReviewLog(page.rows.map(rowToEntry));
      // 'partial' rather than 'ready' at the cap, and the check declines to run
      // on it: a prefix of somebody's sessions can hold none of their heavy
      // ones, and "more than she has ever done" measured against half a record
      // is a finding about the read rather than about the programme.
      setReviewLogStatus(page.truncated ? 'partial' : 'ready');
    })();
    return () => { live = false; };
  }, [clientId, clientAskable, reviewLogNonce]);
  // ── the eighth read, which the refresh did not count ──────────────────────
  //
  // The comment under `pull` below opens "Seven reads sit behind this screen"
  // and this was not one of them: the log effect closed on `[clientId,
  // clientAskable]` with no nonce and no focus effect, so it ran once per
  // client and never again. The builder is opened straight after a session more
  // often than at any other moment, and the session that just happened is
  // precisely what is missing — the coach pulls down out of habit, watches the
  // spinner, and prescribes 42.5 kg against a log with no Tuesday in it.
  //
  // It feeds the programme review and the load suggestion the coach taps, so a
  // stale copy is not a stale list, it is a number written into somebody's week.

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

  /* ── pull to refresh ───────────────────────────────────────────────────
   *
   * Eight reads sit behind this screen and the builder crosses them on every
   * decision it makes: the book, what each client is already assigned (the
   * overwrite confirmation is counted off that), the template library, the
   * coach's saved movement names, the movement catalogue, the group
   * membership line, the injury acknowledgements the primary button is gated
   * on, and what this client has actually trained — which drives the programme
   * review and the load suggestion, and was the one this list used to omit.
   *
   * The injury read is the reason this gesture belongs here at all. The
   * button says "Injuries Could Not Be Read" and refuses — correctly — and
   * until now the only way to make it ask again was to leave the screen,
   * which takes the half-built programme with it.
   *
   * NOTHING here touches the draft. Every one of these is a read; the week
   * the coach has laid out is untouched, which is the only reason a refresh
   * gesture is safe on a screen that is mostly an editor. */
  const pull = usePullToRefresh(useCallback(() => {
    // The eighth: what this client has actually trained. See the note beside
    // the effect that reads it.
    setReviewLogNonce((n) => n + 1);
    return Promise.all([
      refreshRoster(), Promise.resolve(reloadPrograms()), Promise.resolve(reloadTemplates()),
      Promise.resolve(coachEx.reload()), cat.reload(),
      Promise.resolve(clientGroups.refresh()), acks.refresh(),
    ]);
  }, [refreshRoster, reloadPrograms, reloadTemplates, coachEx, cat, clientGroups, acks]));

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
    // `programWeeks` is the ONE reader of the block, and it answers a single
    // week built from `days` for every programme that has none — which is every
    // programme in `program_templates`, on every assignment and in every draft.
    // So a one-week programme loads exactly as it always did, into week one,
    // with no week strip drawn for it.
    setBlockWeeks(programWeeks(p).map((w) => ({
      days: toBuilderDays(w.days), label: w.label, deload: w.deload,
    })));
    // Back to week one on every load. A coach who was editing week five of one
    // client's block and taps another client must not land on week five of a
    // programme that may have two weeks in it.
    setWeekIdx(0);
    setSeededFor(from);
    // Every day is a different day now, so an index that was folded names
    // somebody else's Wednesday. Same reasoning as `removeDay`.
    setFoldedDays(foldsForNewProgramme());
  };
  const clearBuilder = () => { setTitle(''); setNote(''); setBlockWeeks([{ days: [] }]); setWeekIdx(0); setSeededFor(null); setFoldedDays(foldsForNewProgramme()); };

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
  //
  // ── and it has to be the WHOLE block, for the same reason ────────────────
  //
  // This read `days`, which is `blockWeeks[weekIdx].days` — ONE week. So a
  // coach with a finished twelve-week block sitting on an empty week five had
  // `hasDraft` false, the seed fired, and twelve weeks of programming were
  // replaced by the selected client's assignment. Silent, total, no undo.
  //
  // `blockExercises` sixty lines below is the identical mistake, found and
  // fixed for the Assign gate, with a comment ending "what decides whether
  // there is anything to send has to be every week too". This is the second
  // caller of the same idea and it was left behind — which is the argument for
  // asking the block rather than the week wherever the question is "is there
  // work here", not just where somebody happened to look.
  const hasDraft = blockWeeks.some((w) => w.days.length > 0) || !!title.trim() || !!note.trim();
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
  /**
   * The conditioning line attached to a day.
   *
   * `cardio` was round-tripped through both mappers and rendered nowhere: the
   * generated plans set it (`src/lib/programs.ts` writes "15 min incline walk"),
   * the client is told to do it, and the coach could not see that it existed.
   * So a block written for a runner and re-assigned to somebody rehabbing a
   * knee carried the incline walk with it, silently, and the only person who
   * ever read the prescription was the person doing it.
   *
   * An empty box clears the field rather than storing a blank string, so a day
   * with no conditioning is a day with none and not a day prescribing "".
   */
  const setDayCardio = (di: number, cardio: string) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, cardio: cardio.trim() ? cardio : undefined } : d)));
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
   * Raw text per exercise for the three intensity boxes, for the same reason
   * `loadDraft` exists: "8." on the way to "8.5" and "3-1" on the way to
   * "3-1-1-0" are both valid things to be part-way through typing, and neither
   * survives a round trip through its reader and back. The committed value is
   * written behind the draft only when the reader accepts it, so a refused
   * keystroke leaves the last good value alone rather than clearing it.
   */
  const [rpeDraft, setRpeDraft] = useState<Record<string, string>>({});
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});
  const [tempoDraft, setTempoDraft] = useState<Record<string, string>>({});
  /**
   * Raw rest text per exercise, for the same reason `loadDraft` exists. A coach
   * part way through typing "9" on the way to "90" has momentarily typed a
   * number this app refuses; re-deriving the field from the committed value
   * would delete the keystroke.
   */
  const [restDraft, setRestDraft] = useState<Record<string, string>>({});

  /* ── Press and hold to drag an exercise into place ──────────────────────
     Asked for twice: arrows shipped first because they work over the air, and
     then "you should be able to press and hold an exercise and drag it in the
     position you want it."

     Built on PanResponder's raw responder props and `Animated`, both in React
     Native core. The usual answer — gesture-handler plus reanimated — could not
     ship: reanimated 4 is what this SDK resolves and it requires the New
     Architecture, which this app does not run. Installing it does not make the
     drag slower, it makes the app not build. Core works on the old
     architecture and is already inside every binary in the field, so this
     reaches people who have the app rather than people who reinstall it.

     Row heights are MEASURED (`onLayout`) rather than assumed. An exercise row
     here is not a fixed height — it grows with a note, a group badge, and the
     sets/reps/weight row wrapping on a narrow phone — so a constant row height
     would land the drag somewhere nobody aimed at, worse the further you drag.
     The arithmetic is in src/lib/dragReorder.ts, where it is tested. */
  const dragY = useRef(new Animated.Value(0)).current;
  const rowH = useRef<Record<string, number>>({});
  const dragFrom = useRef<{ di: number; ei: number } | null>(null);
  const dragStartY = useRef(0);
  const dragTo = useRef<number | null>(null);
  const [dragging, setDragging] = useState<{ di: number; ei: number } | null>(null);
  // Only the TARGET is state. The finger position lives in an Animated.Value so
  // the moving row does not re-render on every pixel; the list re-renders only
  // when the row would actually change place, which is a few times per drag.
  const [dropAt, setDropAt] = useState<number | null>(null);

  const heightsFor = (di: number, count: number) =>
    Array.from({ length: count }, (_, i) => rowH.current[`${di}:${i}`] ?? 0);

  const beginDrag = (di: number, ei: number, pageY: number) => {
    dragFrom.current = { di, ei };
    dragStartY.current = pageY;
    dragTo.current = ei;
    dragY.setValue(0);
    setDragging({ di, ei });
    setDropAt(ei);
  };

  const moveDrag = (pageY: number, count: number) => {
    const from = dragFrom.current;
    if (!from) return;
    const dy = pageY - dragStartY.current;
    dragY.setValue(dy);
    const to = targetIndex(heightsFor(from.di, count), from.ei, dy);
    if (to !== dragTo.current) { dragTo.current = to; setDropAt(to); }
  };

  const endDrag = () => {
    const from = dragFrom.current;
    const to = dragTo.current;
    dragFrom.current = null; dragTo.current = null;
    dragY.setValue(0);
    setDragging(null);
    setDropAt(null);
    if (!from || to == null || to === from.ei) return;
    setDays((ds) => ds.map((d, i) =>
      (i === from.di ? { ...d, exercises: applyMove(d.exercises, from.ei, to) as BEx[] } : d)));
  };


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
   * Keyed by INDEX, so the map has to be re-keyed by every edit that MOVES a
   * day and thrown away by every edit that replaces the list. Both are in
   * src/lib/foldedDays.ts and both are called: `removeDay` shifts the folds
   * past the deletion, and `loadFrom`, `clearBuilder` and the draft restore
   * start over. This comment used to say the map was reset on removal and
   * nothing did it — the visible cost was that deleting a day above a folded
   * one collapsed the wrong day.
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
        const d = JSON.parse(raw) as { title?: string; note?: string; days?: BDay[]; weeks?: BWeek[] };
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
          // `weeks` when the draft has one, and `days` — which is week one —
          // when it does not. Every draft written before blocks existed is the
          // second case, and restoring it as a one-week block is what it is.
          // The two are written together below for the same reason
          // `Program.days` and `Program.weeks` are: a draft carrying only
          // `weeks` would come back empty on a build that had been rolled back.
          setBlockWeeks(Array.isArray(d.weeks) && d.weeks.length
            ? d.weeks.map((w) => ({ days: Array.isArray(w?.days) ? w.days : [], label: w?.label, deload: w?.deload }))
            : [{ days: Array.isArray(d.days) ? d.days : [] }]);
          setWeekIdx(0);
          // The draft carries the days; it does not carry which of them were
          // folded, so nothing may claim to know. Reset rather than left at
          // whatever the empty builder happened to be holding.
          setFoldedDays(foldsForNewProgramme());
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
    // Any week having content is work worth saving. Testing only the week on
    // screen would throw away a six-week block the moment the coach opened its
    // one empty week — which is exactly the shape of loss this autosave exists
    // to prevent.
    const anyContent = blockWeeks.some((w) => w.days.length);
    if (!anyContent && !title.trim() && !note.trim()) return;
    // `days` is still written, and it is still week one. A build rolled back to
    // before blocks existed reads that key and finds a whole week, rather than
    // finding nothing and presenting a coach with an empty builder.
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({
      title, note, days: blockWeeks[0]?.days ?? [], weeks: blockWeeks,
    })).catch(() => {});
  }, [title, note, blockWeeks, draftLoaded]);

  /** Called once the work is somewhere durable, and only then — a saved
   *  template that the server counted, or an assignment that landed on every
   *  client it was sent to. Never on a partial one: the draft is the only copy
   *  of anything that did not make it. */
  const clearDraft = () => { AsyncStorage.removeItem(DRAFT_KEY).catch(() => {}); };

  const patchEx = (di: number, key: string, patch: Partial<BEx>) =>
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, exercises: d.exercises.map((e) => (e.key === key ? { ...e, ...patch } : e)) } : d)));
  const addDay = () => setDays((ds) => {
    const used = new Set(ds.map((d) => d.day));
    const free = DAYS.find((d) => !used.has(d)) ?? DAYS[0];
    return [...ds, { day: free, focus: 'Training', exercises: [] }];
  });
  const cycleDay = (di: number) => setDays((ds) => ds.map((d, i) => {
    if (i !== di) return d;
    const idx = DAYS.indexOf(d.day);
    return { ...d, day: DAYS[(idx + 1) % 7] };
  }));
  // The fold map is re-keyed with the list, not left behind. `foldedDays` is
  // keyed by POSITION, and a `filter` shifts every day after the removed one
  // down by an index — so deleting Monday while Tuesday was folded left index 1
  // marked folded and Wednesday sitting at index 1, collapsed, with Tuesday
  // open. On the one screen in this app where the standing fear is losing work,
  // a day that has shut itself reads as a day whose exercises are gone. The
  // comment on `foldedDays` has claimed this was handled since it was written;
  // this is the code that does it. See src/lib/foldedDays.ts for the re-key.
  const removeDay = (di: number) => {
    setDays((ds) => ds.filter((_, i) => i !== di));
    setFoldedDays((p) => foldsAfterRemoval(p, di));
  };

  /** Exercises in the WEEK ON SCREEN. Used only where the sentence is about
   *  that week — the Training Days heading, and nothing else. */
  const totalExercises = days.reduce((a, d) => a + d.exercises.length, 0);
  /**
   * Exercises in the WHOLE BLOCK, which is what every gate is about.
   *
   * `totalExercises` was doing both jobs, and on a block it was the wrong
   * number for the second: a coach on a deload week five with an empty screen
   * was told to add an exercise and had Assign taken away over six weeks of
   * finished programming. What leaves this screen is `composeProgram()`, which
   * is every week, so what decides whether there is anything to send has to be
   * every week too.
   */
  const blockExercises = blockWeeks.reduce(
    (a, w) => a + w.days.reduce((b, d) => b + d.exercises.length, 0), 0);
  /** Days across the block that actually carry work — for the template sheet,
   *  which saves the block and not the week in front of the coach. */
  const blockDays = blockWeeks.reduce(
    (a, w) => a + w.days.filter((d) => d.exercises.length).length, 0);
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
  const plan = planFanOut('ready', programStatus, pickedIds.map(asMember), blockExercises > 0, fanOutSubject(pickedIds.length));
  // What the sweeping gesture is allowed to claim, given how the roster read
  // went — "Select All" over a roster that came back at its row limit ticks a
  // thousand people and calls it everybody. See src/lib/bulkActions.ts.
  const selAll = selectAllOffer(rosterStatus, roster.length);

  /**
   * Every movement in this programme that loads something a RECIPIENT has
   * disclosed, grouped by who.
   *
   * Two things it used to miss, both of them the same mistake — asking about
   * less than what is actually being sent. It asked about the SUBJECT only, so
   * a programme fanned out to four people was checked against one of them. And
   * it read `days`, the week on screen, so a squat written into week four for a
   * client with a disclosed knee was assigned with no warning and no
   * acknowledgement recorded — which is the entire point of
   * src/lib/injuryGate.ts. `assign` sends `composeProgram()`, every week of it,
   * so this walks every week of it.
   *
   * `week` is the 1-based position, or null on a one-week programme, where a
   * week number would be a count of something that does not exist. It is in the
   * acknowledgement record as well as in the confirmation, because "you were
   * told about the back squat" is a weaker record than "you were told about the
   * back squat in week four".
   */
  const injuryLoads = pickedIds.map((id) => {
    const inj = injuriesOf(id);
    const multi = blockWeeks.length > 1;
    const movements = blockWeeks.flatMap((w, wi) => w.days.flatMap((d) => d.exercises
      .map((e) => {
        const f = injuryFlag(e.name, e.group || '', inj);
        return f
          ? { exercise: e.name, area: f.injury.area, severity: f.injury.severity, week: multi ? wi + 1 : null }
          : null;
      })))
      .filter(Boolean) as { exercise: string; area: string; severity: string; week: number | null }[];
    return { clientId: id, name: roster.find((r) => r.id === id)?.name.split(' ')[0] ?? 'This client', movements };
  }).filter((x) => x.movements.length);

  const canAssign = pickedIds.length > 0 && blockExercises > 0 && plan.allowed;
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
    // Searched on BOTH names. Most German-speaking coaches learned these
    // movements in English and type "bench"; their German-speaking clients
    // read "Bankdrücken". Matching only one of the two hides half the
    // catalogue from whoever is holding the phone.
    (e) => !ownSlugs.has(e.id) && matchesSearch(pickTerm, e.name, e.display),
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
  /**
   * One week of the block, as it will actually be stored.
   *
   * Split out of `composeProgram` so that every week of a block goes through
   * exactly the same rewriting — the reps default, the blank note dropped, the
   * set count recomputed from the rows. A second spelling of this loop for the
   * later weeks would be a second chance for week four to be assigned with a
   * `sets` that disagrees with its table, which is a client shown "3/3 sets"
   * with a fourth row unlogged underneath it.
   */
  const composeDays = (source: readonly BDay[]): ProgramDay[] =>
    source.filter((d) => d.exercises.length).map((d) => ({
      day: d.day, focus: d.focus.trim() || 'Training', cardio: d.cardio,
      exercises: d.exercises.map((e, i) => ({
        key: d.day + '-' + i, name: e.name, group: e.group || '',
        reps: e.reps || '8-12', alternatives: [],
        loadKg: e.loadKg ?? null,
        loadUnit: e.loadUnit,
        note: e.note && e.note.trim() ? e.note.trim() : undefined,
        restSec: e.restSec ?? null,
        setGroupId: e.setGroupId ?? null,
        method: e.method ?? null,
        // Null and never undefined for the three intensity fields, so that
        // clearing an RPE a template carried actually clears it. `undefined`
        // does not survive `JSON.stringify` or a jsonb column, so an
        // undefined here would leave the old value on the row it was meant to
        // remove — which is the one direction this must not fail in: a target
        // the coach deleted going out to a client anyway.
        rpe: e.rpe ?? null,
        pct1rm: e.pct1rm ?? null,
        tempo: e.tempo ?? null,
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
    }));

  /**
   * The programme as it leaves this screen.
   *
   * `withWeeks` is the ONE writer of the block and it keeps `Program.days` —
   * which is what the shipped client app renders — equal to week one. It also
   * DROPS `weeks` entirely for a one-week programme, so a coach who never
   * touched the week strip produces a programme byte-identical to one written
   * before blocks existed. That is not tidiness: `programSignature` decides
   * which members of a group are on the group's plan, and a `weeks: [...]`
   * meaning nothing would have to be reasoned about there too.
   */
  const composeProgram = (): Program => {
    const base: Program = {
      title: title.trim() || 'Custom program',
      focus: ['Coach-assigned', 'Personalised for you'],
      note: note.trim() || 'Your coach built this program for you. Progress the weight when you hit the top of the rep range.',
      days: composeDays(blockWeeks[0]?.days ?? []),
    };
    return withWeeks(base, blockWeeks.map((w) => ({
      days: composeDays(w.days), label: w.label, deload: w.deload,
    })));
  };

  /** Whether the list of what the checks look at is open. Closed by default:
   *  a coach reading findings wants the findings, and the catalogue is what
   *  they open when they want to know why something is NOT in the list. */
  const [checksOpen, setChecksOpen] = useState(false);

  /* ── Programme checks ───────────────────────────────────────────────────
     Seven rules over the draft, run on what would ACTUALLY be assigned rather
     than on the editing state behind it — `composeProgram` is where reps
     default, blank notes are dropped and `sets` is recomputed from the rows,
     and a check that read the state before all that would report findings a
     coach could not see and miss ones they could.

     Not called an AI review, on screen or anywhere else. The reasoning is at
     the top of src/lib/programReview.ts and the short version is
     src/lib/finReview.ts, which is ninety lines of arithmetic that shipped
     under a heading reading "AI Financial Review" and told every gym on the
     platform it was in strong financial health. That file was called
     financialAI.ts and its screen has since been renamed to Financial Checks;
     this one was written not to need renaming.

     Memoised because `reviewProgram` walks this client's whole capped training
     log once per exercise, and this screen re-renders on every keystroke in
     every weight, rest and note field on it. */
  const review = useMemo(
    () => reviewProgram({
      program: composeProgram(),
      // Null, not an empty list, when there is no client on this screen — a
      // template being written for nobody in particular. An empty list would
      // run the injury check against nobody's disclosures and report a clean
      // programme, which is a check appearing to have passed. `null` stands it
      // down and says why. Same shape as `log` on the line below.
      injuries: clientId ? clientInjuries : null,
      injuryStatus: disclosureStatus,
      log: reviewLog,
      logStatus: reviewLogStatus,
      goal: autoGoal,
    }),
    // `composeProgram` is rebuilt every render and is a pure function of these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockWeeks, title, note, clientId, clientInjuries, disclosureStatus, reviewLog, reviewLogStatus, autoGoal],
  );

  /** What the checks covered, on a block. Null on a one-week programme, where
   *  a coverage sentence would be furniture. */
  const coverage = coverageLine(review.counted);

  /**
   * The figures behind a volume finding, in the coach's own unit.
   *
   * The rules module deals in kilograms and never formats one — see its header
   * — so this is the render boundary, and `volumeIn` is the same converter the
   * client's History hero and the coach's client-training screen use. The
   * percentage goes through `deltaLabel` rather than a sign written here:
   * scripts/check-deltas.mjs exists because twenty-five screens each wrote
   * their own, and a change of nothing took whichever arm its author reached
   * for first.
   */
  const volumeLine = (f: Finding): string | null => {
    const v = f.volume;
    if (!v) return null;
    const planned = volumeIn(v.plannedKg, defaultUnit);
    const best = volumeIn(v.bestKg, defaultUnit);
    if (planned == null || best == null) return null;
    const on = v.bestDay ? dayLabel(v.bestDay) : null;
    // Never a dash in the middle of a sentence — scripts/check-prose.mjs. A day
    // that will not parse is described rather than printed as a hole.
    const when = on && on !== '—' ? `on ${on}` : 'in the sessions compared';
    const moved = deltaLabel(v.changePct, {
      since: null, unit: '%', decimals: 0, noChange: 'no change', noBaseline: 'no earlier figure',
    });
    return `Planned ${num(planned)} ${defaultUnit} against ${num(best)} ${defaultUnit}, `
      + `their most in one session ${when}. That is ${moved} on it.`;
  };
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
    if (blockExercises === 0) { Alert.alert('Nothing to save', 'Add at least one exercise first.'); return; }
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
    movements: { exercise: string; area: string; severity: string; week: number | null }[],
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
        // The week is named where there is one. On a twelve-week block the same
        // movement can appear in every week, and four identical lines tell a
        // coach nothing about which week to go and change.
        x.movements.slice(0, 4).map((m) => `· ${x.name} — ${m.exercise}${m.week ? ` in week ${m.week}` : ''}, ${areaLabel(m.area).toLowerCase()}, ${m.severity}`),
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
      // Only ever sent when the coach typed a real date. `undefined` leaves
      // the column alone on an overwrite — a screen that did not offer a date
      // must not silently clear one set from a screen that did — and an
      // unparseable string is not sent at all rather than stored as a date
      // nobody can read back.
      const r = await assignProgramTo(tg.clientId, program, isStartDate(startsOn) ? startsOn : undefined);
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
  /**
   * The template whose delete was refused, and the sentence saying why.
   *
   * Keyed by id, and said in an alert as well, for the reason
   * app/(trainer)/templates.tsx carries at length: this used to be one line
   * drawn ABOVE the list, inside a scrolling picker. A coach who had scrolled
   * to a template half-way down their library got the explanation off the top
   * of the sheet, which is indistinguishable from the button doing nothing —
   * and "the button does nothing" is what was reported.
   */
  const [tplDelFailed, setTplDelFailed] = useState<{ id: string; why: string } | null>(null);
  const deleteTemplate = (id: string, name: string) => {
    Alert.alert(
      'Delete This Template?',
      `“${name}” is removed from your library for good — there is no undo. Anybody already training it keeps their programme, and every session they have logged is untouched: an assignment is a copy, not a link back to this.`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          const gone = await removeTemplateFrom(id);
          if (gone.ok) { setTplDelFailed((p) => (p && p.id === id ? null : p)); return; }
          const why = deleteRefusedLine(name, gone.why);
          setTplDelFailed({ id, why });
          Alert.alert('That template was not deleted', why);
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
      {/* Scrolling is off while a row is held. Without this the ScrollView and
          the drag both claim the same vertical movement, and the list scrolls
          under the finger while the row tries to follow it — which reads as
          the drag being broken rather than as two gestures competing. */}
      <ScrollView scrollEnabled={!dragging} contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingEnd: sp.lg }}>
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
          <SectionHead title="Templates" note={tplStatus === 'ready' && savedCount ? `${num(savedCount)} saved` : undefined} />
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

          {/* ── the day the block begins ──────────────────────────────────
              Coaches sit on their phone on a Sunday night and tap Assign at the
              right moment, because an assignment IS a start: the write lands and
              the client's Train tab reads the row on its next render.

              This field records the day the coach chose. It does NOT hold the
              programme back, and the sentence under it says so — because a
              coach who believes it does, and assigns a block "starting Monday"
              on a Thursday, has replaced their client's Friday session while
              believing they did not. That is strictly worse than the alarm.

              Left blank is the ordinary case and the default: "assign it now"
              is what this control has always meant.

              ── why it is HERE, beside the name, and not in the assign panel ──
              It used to sit at the foot of the screen, directly above the
              Assign button. That put it after the roster — a scrolling list —
              so on a phone a coach met it last, having already scrolled past
              every decision it belongs to, and one of them read a disabled
              Assign button as a complaint about the date.

              A coach decides when a block starts BEFORE they lay out its
              weeks, not after: the start day is what makes "week one" mean
              anything. So it belongs with the block's other two facts — its
              name and its note — and above the Weeks section that reads week
              numbers off it. Nothing about the write changed: `startsOn` is
              still the same state, still optional, and still passed to
              `assignProgramTo` only when `isStartDate` can read it. */}
          <View style={{ marginBottom: sp.lg }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Starts on</Text>
            {/* ── the field IS the button ─────────────────────────────────
                This was a `TextInput` with a small calendar button beside it,
                and it was reported: "when you tap the date the keyboard pops up
                and blocks what you are typing". The soft keyboard comes up over
                the bottom of the window, so on a phone tapping the field to fill
                it in is the gesture that hides it — and the calendar was
                reachable only from a 44pt target off to one side, which is not
                where anybody taps when they want to set a date.

                So the whole box opens the month sheet and nothing here raises a
                keyboard. Typing has NOT been dropped — coaches paste dates out
                of a client's message and out of their own notes — it moved
                inside `DateSheet`, behind its own "Type a Date", so a date is
                entered in one place by either route. The same shape as the
                assign panel in app/(trainer)/templates.tsx, deliberately: two
                controls for one value is what produced the bug.

                Not `@react-native-community/datetimepicker`. That is a native
                module, a native module is a new binary, and this has to reach
                coaches over the air on the build they are already running. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.xs }}>
              <Pressable onPress={() => setStartPick(true)}
                accessibilityRole="button"
                accessibilityLabel={startsOn
                  ? 'The day this block begins. Currently ' + startsOn + '. Opens a calendar.'
                  : 'The day this block begins. No day set, so it starts now. Opens a calendar.'}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.sm,
                  minHeight: MIN_TARGET, paddingHorizontal: 12,
                  backgroundColor: t.surface2, borderRadius: radius.sm,
                }}>
                <Text style={{ ...ty.body, color: startsOn ? t.ink : t.ink3, flex: 1 }}>
                  {startsOn || 'YYYY-MM-DD'}
                </Text>
                <Icon name="calendar" size={18} color={t.ink2} />
              </Pressable>
              {startsOn ? (
                <Ghost label="Clear" onPress={() => setStartsOn('')} />
              ) : null}
            </View>
            {/* Refused rather than corrected. Kept even though the sheet only
                ever hands back a `YYYY-MM-DD`: `assignProgramTo` below drops an
                unreadable date silently, and the one thing a coach must never be
                is told "Assigned" for a block whose start date went nowhere. A
                stored value that will not parse puts every screen reading it
                into "unreadable" for ever, over a plan the coach believes
                carries a date — so it is not stored at all. */}
            {startsOn && !isStartDate(startsOn) ? (
              <Flag tone={t.warn} style={{ marginTop: sp.xs }}>
                Write the date as year, month and day — 2026-09-07. Anything else is not saved, and the
                programme goes out with no start date rather than one nothing can read back.
              </Flag>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{CLIENT_STARTS_NOW}</Text>
            )}
          </View>


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

        {/* ── the block ──────────────────────────────────────────────────
            Drawn ONLY once there is more than one week, plus the one control
            that makes a second. A coach writing a single week must see exactly
            the screen they saw before — a week strip over a one-week programme
            is a decoration that implies a structure that is not there. */}
        <Section>
          <SectionHead title="Weeks" note={isBlock(composeProgram()) ? `${blockWeeks.length}` : undefined} />
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            A block is the six, eight or twelve weeks you actually sell. Week one is what the client trains
            now — the later weeks are stored with the programme and are yours to edit before you send them.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md }}>
            {blockWeeks.map((w, wi) => (
              <Pressable key={wi} onPress={() => setWeekIdx(wi)} accessibilityRole="button"
                accessibilityState={{ selected: wi === weekIdx }}
                accessibilityLabel={`Edit ${weekLabel(w, wi + 1)}`}
                style={{
                  paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
                  backgroundColor: wi === weekIdx ? t.brand : t.surface2,
                }}>
                <Text style={{ ...ty.micro, color: wi === weekIdx ? t.brandInk : t.ink2 }}>{weekLabel(w, wi + 1)}</Text>
              </Pressable>
            ))}
            {canAddWeek(composeProgram()) ? (
              <Pressable
                onPress={() => {
                  // The new week is a COPY of the last, for the reason
                  // `addSetRow` copies a set: nobody adds week five in order to
                  // leave it empty, and a blank week would send the coach back
                  // to retyping the session — which is the thing they do today.
                  setBlockWeeks((ws) => {
                    // Written out here rather than through `addWeek`, because that
                    // works on a stored `Program` and this list holds the
                    // builder's own `BEx` — with its draft keys and the unit
                    // the coach typed in. Round-tripping through `composeProgram`
                    // to add a week would silently apply every one of its
                    // rewritings to the week being copied.
                    const last = ws[ws.length - 1];
                    const copied: BWeek = {
                      days: (last?.days ?? []).map((d) => ({
                        ...d,
                        // Fresh keys, and this is the whole of why the copy is
                        // written out rather than spread. `key` is what every
                        // list, drag handler and per-row draft on this screen
                        // matches on; two weeks sharing one would make typing
                        // into week five's bench press edit week four's as well.
                        exercises: d.exercises.map((e) => ({ ...e, key: nextKey(), setRows: e.setRows ? e.setRows.map((r) => ({ ...r })) : e.setRows })),
                      })),
                    };
                    return [...ws, copied];
                  });
                  setWeekIdx(blockWeeks.length);
                  setFoldedDays(foldsForNewProgramme());
                }}
                accessibilityRole="button" accessibilityLabel="Add another week to this block"
                style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring }}>
                <Text style={{ ...ty.micro, color: t.ink2 }}>Add Week</Text>
              </Pressable>
            ) : null}
          </View>
          {blockWeeks.length > 1 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.md, alignItems: 'center' }}>
              <Ghost label={blockWeeks[weekIdx]?.deload ? 'Not a Deload' : 'Mark as Deload'}
                onPress={() => setBlockWeeks((ws) => ws.map((w, i) => (i === weekIdx ? { ...w, deload: !w.deload } : w)))} />
              <Ghost label="Remove This Week" onPress={() => {
                // Removing WEEK ONE moves what the client trains, immediately,
                // because week two becomes week one and `days` follows it. The
                // coach is told which of the two they are doing rather than
                // both being one silent button.
                const first = weekIdx === 0;
                Alert.alert(
                  first ? 'Remove week one?' : `Remove ${weekLabel(blockWeeks[weekIdx], weekIdx + 1).toLowerCase()}?`,
                  first
                    ? 'Week one is the week the client is training. Removing it promotes week two in its place, and that is what they will see the next time you assign this.'
                    : 'The later weeks move up. Nothing the client is training changes until you assign this again.',
                  [
                    { text: 'Keep It', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => {
                      setBlockWeeks((ws) => (ws.length <= 1 ? ws : ws.filter((_, i) => i !== weekIdx)));
                      // Clamped, because a week index past the end renders an
                      // empty builder over a programme that is not empty.
                      setWeekIdx((i) => Math.max(0, Math.min(i, blockWeeks.length - 2)));
                      setFoldedDays(foldsForNewProgramme());
                    } },
                  ],
                );
              }} />
            </View>
          ) : null}
        </Section>

        <Rule />

        {/* ── days ───────────────────────────────────────────────────────── */}
        <Section>
          <SectionHead title={blockWeeks.length > 1 ? weekLabel(blockWeeks[weekIdx], weekIdx + 1) : 'Training Days'}
            note={days.length ? `${days.length} day${s(days.length)} · ${num(totalExercises)} exercise${s(totalExercises)}` : undefined} />

          {days.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              No training days yet — add one to start building.
            </Text>
          ) : null}

          {/* Said once, at the top, and only when the coach has actually
              written one of the three. This line used to be an apology —
              `CLIENT_CANNOT_SEE_INTENSITY`, saying the client's Train tab drew
              reps, load and the method badge and nothing else. It does draw
              them now, so the constant is deleted and this says what reaches
              the client instead. The percentage half is the part worth a
              coach's attention: it is shown as a percentage and never converted,
              because nothing in this app has a tested maximum to convert it
              against. */}
          {days.some((d) => d.exercises.some((e) => e.rpe != null || e.pct1rm != null || e.tempo)) ? (
            <View style={{ marginBottom: sp.lg }}>
              <Flag tone={t.ink3}>
                Effort, percentage and tempo reach the client. Their Train tab and their session both show these
                beside the set, with the RPE and the tempo spelled out in words. A percentage stays a percentage:
                this app holds no tested one rep max, so it never works out a weight for the bar from one.
              </Flag>
            </View>
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
                  hitSlop={10}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
                           paddingHorizontal: sp.md, paddingVertical: 7,
                           borderRadius: radius.pill, borderWidth: hairline,
                           borderColor: t.ring, backgroundColor: t.surface2 }}>
                  {/* Sized up and given an edge, on the report that "the 5 and
                      down arrow next to the day should be a little bigger so we
                      know what to do with it."

                      That is the real complaint under it: two faint grey
                      characters at caption size read as a LABEL — a count and a
                      decoration — not as something to press. Bigger type alone
                      would have made a bigger label. What says "press me" is the
                      pill: a border, a filled ground, and the word for what
                      happens, so the control announces itself instead of
                      relying on somebody guessing that a triangle is a button.

                      The count stays, because it is the thing worth knowing
                      about a day that is folded shut. */}
                  <Text style={{ ...ty.label, color: t.ink2, fontWeight: '600' }}>{d.exercises.length}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>{foldedDays[di] ? 'Show' : 'Hide'}</Text>
                  {/* A triangle rather than an Icon: the set has no chevron up
                      or down, and `app/(client)/workouts.tsx` already uses
                      exactly these two characters for the same gesture. */}
                  <Text style={{ ...ty.label, color: t.ink2 }}>{foldedDays[di] ? '▾' : '▴'}</Text>
                </Pressable>
                <Pressable onPress={() => removeDay(di)} accessibilityRole="button" accessibilityLabel="Remove day" hitSlop={8}
                  style={{ paddingHorizontal: sp.sm, paddingVertical: sp.sm }}>
                  <Text style={{ ...ty.head, color: t.ink3 }}>×</Text>
                </Pressable>
              </View>

              {/* The conditioning on this day, which used to travel through
                  this screen invisibly. Under the header rather than in it: it
                  is part of the day's prescription and not part of naming it,
                  and a folded day does not need to show it. */}
              {foldedDays[di] ? null : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: sp.sm }}>
                  <Text style={{ ...ty.caption, color: t.ink3 }}>Conditioning</Text>
                  <TextInput value={d.cardio ?? ''} onChangeText={(v) => setDayCardio(di, v)}
                    placeholder="e.g. 15 min incline walk — leave empty for none" placeholderTextColor={t.ink3}
                    accessibilityLabel={`Conditioning on ${d.day}, sent to the client alongside the exercises`}
                    style={[inp, { flex: 1 }]} />
                </View>
              )}

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
                const isDragging = dragging?.di === di && dragging?.ei === ei;
                // Every other row slides to open the gap the dragged one will
                // drop into. Computed from the same module the drop uses, so
                // what you see during the drag and where it lands cannot
                // disagree.
                const shift = dragging?.di === di && dropAt != null
                  ? dragShifts(heightsFor(di, d.exercises.length), dragging.ei, dropAt)[ei] ?? 0
                  : 0;
                return (
                <Animated.View key={e.key}
                  onLayout={(ev) => { rowH.current[`${di}:${ei}`] = ev.nativeEvent.layout.height; }}
                  style={{
                  marginTop: joinedAbove ? 0 : sp.md,
                  paddingTop: sp.md,
                  borderTopWidth: joinedAbove ? 0 : hairline,
                  borderTopColor: t.ring,
                  ...(gb ? { borderStartWidth: 2, borderStartColor: t.brand, paddingStart: sp.md, marginStart: -sp.md } : null),
                  ...(isDragging ? {
                    // Lifted: it must read as picked up, or a coach cannot tell
                    // a drag from a list that has started scrolling.
                    zIndex: 10, elevation: 6, opacity: 0.96,
                    backgroundColor: t.surface, borderRadius: radius.md,
                    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
                  } : null),
                  transform: [{ translateY: isDragging ? dragY : (shift as number) }],
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
                    {/* ── The grip: press and hold here, then drag ────────
                        A dedicated handle rather than the whole row, because
                        the row's name and picture already open the movement
                        and a long-press that stole that tap would cost a coach
                        the thing they use most. The grip says what it is by
                        looking like one.

                        Raw responder props rather than a PanResponder: these
                        rows are produced by a .map(), where a hook cannot go.
                        Same gesture system underneath. */}
                    {d.exercises.length > 1 ? (
                      <View
                        accessible
                        accessibilityRole="adjustable"
                        accessibilityLabel={`Reorder ${e.name}. Position ${ei + 1} of ${d.exercises.length}. Hold and drag, or use the arrows.`}
                        onStartShouldSetResponder={() => true}
                        onMoveShouldSetResponder={() => true}
                        onResponderGrant={(ev) => beginDrag(di, ei, ev.nativeEvent.pageY)}
                        onResponderMove={(ev) => moveDrag(ev.nativeEvent.pageY, d.exercises.length)}
                        onResponderRelease={endDrag}
                        onResponderTerminate={endDrag}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                                 marginEnd: 6, backgroundColor: isDragging ? t.brand : t.surface2,
                                 borderWidth: hairline, borderColor: t.ring }}>
                        <Text style={{ ...ty.label, color: isDragging ? t.brandInk : t.ink3, lineHeight: 18 }}>≡</Text>
                      </View>
                    ) : null}

                    {/* ── Three controls, one of them destructive ──────────
                        Reported as "the up and down arrows and the x need to be
                        bigger and more spaced apart so you don't tap the wrong
                        icon". They were ~24pt of tappable area sitting a few
                        points apart, and the neighbour of the down arrow
                        DELETES the exercise along with its sets, reps, weight,
                        rest and notes.

                        So the fix is not only size. Each is now a 40pt round
                        target — above the 44pt-with-hitSlop mark and the size
                        the rest of this app uses for a real button — and the ×
                        is pushed away from the pair with a gap wide enough that
                        a thumb aiming at "down" cannot reach it. It is also
                        tinted as a destructive control rather than sharing the
                        arrows' grey, because the one that cannot be undone
                        should not look like the two that can.

                        Hidden at the ends rather than disabled: a control that
                        cannot do anything is still something to aim at. */}
                    {d.exercises.findIndex((x) => x.key === e.key) > 0 ? (
                      <Pressable onPress={() => moveExercise(di, e.key, -1)} accessibilityRole="button"
                        accessibilityLabel={`Move ${e.name} earlier in ${d.day}`} hitSlop={6}
                        style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                                 backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.ring }}>
                        <Text style={{ ...ty.label, color: t.ink2 }}>▲</Text>
                      </Pressable>
                    ) : null}
                    {d.exercises.findIndex((x) => x.key === e.key) < d.exercises.length - 1 ? (
                      <Pressable onPress={() => moveExercise(di, e.key, 1)} accessibilityRole="button"
                        accessibilityLabel={`Move ${e.name} later in ${d.day}`} hitSlop={6}
                        style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                                 marginStart: 6, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.ring }}>
                        <Text style={{ ...ty.label, color: t.ink2 }}>▼</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => removeExercise(di, e.key)} accessibilityRole="button"
                      accessibilityLabel={`Remove ${e.name} from ${d.day}`} hitSlop={6}
                      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                               marginStart: sp.lg, backgroundColor: t.surface2, borderWidth: hairline, borderColor: t.crit }}>
                      {/* The critical tone is the BORDER, not the glyph. As ink
                          it measures 3.03–4.05:1 across the ten palettes, under
                          the 4.5:1 text needs, and check:contrast is right to
                          refuse it — a status colour is tuned for a mark. The
                          ring carries the warning, the × stays readable, and
                          the accessibility label says "Remove" in words, so
                          colour is never the only channel saying so. */}
                      <Text style={{ ...ty.head, color: t.ink2, lineHeight: 24 }}>×</Text>
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
                    {/* 30pt round, against MIN_TARGET's 44, and they sit a
                        gap apart — so the slop is what stops a thumb landing
                        on "one set fewer" while reaching for "one set more".
                        This is somebody's programme, not a volume control:
                        the mis-tap is silent, it is saved, and the client
                        trains the wrong session. The × on the set rows above
                        already carries slop for the same reason. */}
                    <Pressable onPress={() => patchEx(di, e.key, { sets: Math.max(1, e.sets - 1) })} accessibilityRole="button" accessibilityLabel="One set fewer"
                      hitSlop={hitSlopFor(30)}
                      style={{ width: 30, height: 30, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="minus" size={14} color={t.ink2} />
                    </Pressable>
                    <Text style={{ ...value(16), color: t.ink, minWidth: 16, textAlign: 'center' }}>{e.sets}</Text>
                    <Pressable onPress={() => patchEx(di, e.key, { sets: Math.min(8, e.sets + 1) })} accessibilityRole="button" accessibilityLabel="One set more"
                      hitSlop={hitSlopFor(30)}
                      style={{ width: 30, height: 30, borderRadius: radius.pill, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="plus" size={14} color={t.ink2} />
                    </Pressable>
                    <Text style={{ ...ty.caption, color: t.ink3, marginStart: sp.sm }}>Reps</Text>
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

                  {/* ── what this client's own log supports ────────────────
                      src/lib/progression.ts has been able to answer this since
                      it was written and its three importers were all in the
                      CLIENT app: the client's phone told them to add 2.5 kg
                      while the coach writing next week's programme for that
                      same person had an empty box and no help at all.
                      No new read. `reviewLog` is already the client's own
                      `workouts` rows, held for the programme checks.
                      Withheld — with a reason — rather than guessed whenever
                      the log has not established an answer, because "they have
                      not logged this movement" is a claim about a person and
                      three different failures produce it. See
                      src/lib/builderProgression.ts. */}
                  {(() => {
                    const offer = progressionOffer({
                      clientPicked: !!clientId,
                      log: reviewLog,
                      status: reviewLogStatus,
                      exercise: e.name,
                      reps: e.reps,
                      // The COACH's unit: this sentence is on the coach's
                      // screen and read by them. The client reads their own
                      // copy of the same advice in their own unit.
                      unit: defaultUnit,
                    });
                    if (offer.kind === 'silent') return null;
                    if (offer.kind === 'gap') {
                      return <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{offer.note}</Text>;
                    }
                    const u = e.loadUnit ?? defaultUnit;
                    // Rendered through `liftLabel`, the same formatter the box
                    // above reads back with, so the button and the field cannot
                    // disagree about the number by a rounding.
                    const label = loadTapLabel(liftLabel(offer.weightKg, u));
                    const same = alreadyAt(offer.weightKg, e.loadKg);
                    return (
                      <View style={{ marginTop: sp.xs }}>
                        <Text style={{ ...ty.caption, color: t.ink3 }}>{offer.reason}</Text>
                        {label && !same ? (
                          <Pressable onPress={() => patchEx(di, e.key, { loadKg: offer.weightKg, loadUnit: u })}
                            accessibilityRole="button" accessibilityLabel={`${label} for ${e.name}`}
                            style={{ alignSelf: 'flex-start', marginTop: sp.xs, paddingHorizontal: sp.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: t.surface2 }}>
                            <Text style={{ ...ty.label, color: t.ink2 }}>{label}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })()}
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
                  {/* ── effort, share of a max, and rep speed ──────────────
                      Three things a coach had nowhere to write and put in the
                      exercise NOTE instead — "@8", "@75%", "3-1-1" — where they
                      are a sentence rather than a column, cannot line up with
                      the set they describe, and are read once instead of at the
                      machine.

                      Offered per EXERCISE rather than per row. The data model
                      holds both (`setRows` carries all three, and a row that
                      says nothing inherits from here, exactly as it does for
                      `method`) — but the set table already has five columns and
                      three more would not fit a phone, so a ramp with one target
                      on the top set is written today by giving the exercise the
                      target and the rows their own loads. Whoever adds the
                      per-row controls writes into the same fields.

                      Every one of the three is REFUSED rather than corrected
                      when it cannot be stored faithfully: a silently rounded
                      8.3 is a prescription nobody wrote. See
                      src/lib/setIntensity.ts. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm }}>
                    <Text style={{ ...ty.caption, color: t.ink3 }}>RPE</Text>
                    <TextInput
                      value={rpeDraft[e.key] ?? (e.rpe == null ? '' : String(e.rpe))}
                      onChangeText={(v) => {
                        // A text draft beside the committed number, for the same
                        // reason `loadDraft` exists above: "8." is a valid thing
                        // to be part-way through typing and does not survive a
                        // round trip through the reader and back.
                        setRpeDraft((prev) => ({ ...prev, [e.key]: v }));
                        if (!v.trim()) { patchEx(di, e.key, { rpe: null }); return; }
                        const r = readRpe(v);
                        if (r.ok) patchEx(di, e.key, { rpe: r.rpe });
                      }}
                      onBlur={() => {
                        // Said, not swallowed — the same rule the Rest box in
                        // this row has always kept. The coach typed @8.3, the
                        // box showed @8.3 while they were in it, and on blur it
                        // snapped back to whatever was there before with nothing
                        // said. The reasonable reading is that the app is slow,
                        // and the block goes out carrying last week's target.
                        // `r.why` already exists and says exactly what is wrong
                        // ("RPE is written in halves — 8 or 8.5, not 8.3").
                        const typed = rpeDraft[e.key];
                        setRpeDraft((prev) => { const n = { ...prev }; delete n[e.key]; return n; });
                        if (typed == null || !typed.trim()) return;
                        const r = readRpe(typed);
                        if (!r.ok) Alert.alert('Check that effort target', r.why);
                      }}
                      keyboardType="decimal-pad" placeholder="8.5" placeholderTextColor={t.ink3}
                      accessibilityLabel={`Prescribed effort for ${e.name}, on the RPE scale`}
                      style={[inp, { width: 58, paddingVertical: 7, paddingHorizontal: 10 }]} />
                    <Text style={{ ...ty.caption, color: t.ink3, marginStart: sp.sm }}>% of 1RM</Text>
                    <TextInput
                      value={pctDraft[e.key] ?? (e.pct1rm == null ? '' : String(e.pct1rm))}
                      onChangeText={(v) => {
                        setPctDraft((prev) => ({ ...prev, [e.key]: v }));
                        if (!v.trim()) { patchEx(di, e.key, { pct1rm: null }); return; }
                        const r = readPercent1RM(v);
                        if (r.ok) patchEx(di, e.key, { pct1rm: r.pct });
                      }}
                      onBlur={() => {
                        const typed = pctDraft[e.key];
                        setPctDraft((prev) => { const n = { ...prev }; delete n[e.key]; return n; });
                        if (typed == null || !typed.trim()) return;
                        const r = readPercent1RM(typed);
                        if (!r.ok) Alert.alert('Check that percentage', r.why);
                      }}
                      keyboardType="number-pad" placeholder="75" placeholderTextColor={t.ink3}
                      accessibilityLabel={`Prescribed share of a one-rep max for ${e.name}, as a whole percentage`}
                      style={[inp, { width: 58, paddingVertical: 7, paddingHorizontal: 10 }]} />
                    <Text style={{ ...ty.caption, color: t.ink3, marginStart: sp.sm }}>Tempo</Text>
                    <TextInput
                      value={tempoDraft[e.key] ?? (e.tempo ?? '')}
                      onChangeText={(v) => {
                        setTempoDraft((prev) => ({ ...prev, [e.key]: v }));
                        if (!v.trim()) { patchEx(di, e.key, { tempo: null }); return; }
                        const r = readTempo(v);
                        if (r.ok) patchEx(di, e.key, { tempo: r.tempo });
                      }}
                      onBlur={() => {
                        const typed = tempoDraft[e.key];
                        setTempoDraft((prev) => { const n = { ...prev }; delete n[e.key]; return n; });
                        if (typed == null || !typed.trim()) return;
                        const r = readTempo(typed);
                        if (!r.ok) Alert.alert('Check that tempo', r.why);
                      }}
                      autoCapitalize="characters" autoCorrect={false}
                      placeholder="3-1-1-0" placeholderTextColor={t.ink3}
                      accessibilityLabel={`Prescribed rep speed for ${e.name}, as down, pause, up and pause`}
                      style={[inp, { width: 84, paddingVertical: 7, paddingHorizontal: 10 }]} />
                  </View>
                  {/* The tempo IN WORDS, under the box, while they type. The
                      four-digit notation is near-universal and it is not
                      unanimous — a minority of coaching literature writes the
                      lifting phase first — and a stored ambiguity is worse than
                      no field. A coach who reads the other convention sees this
                      one disagreeing with them now, rather than after their
                      client has done four weeks of reversed reps. */}
                  {e.tempo && tempoMeaning(e.tempo) ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{tempoMeaning(e.tempo)}</Text>
                  ) : null}

                  {/* ── Rest and grouping ─────────────────────────────────
                      Both answers to "how is this performed" rather than "what
                      is it". Set type used to sit on the end of this row too,
                      which is exactly why nobody tapped it: a bare `Normal`
                      after "sec · default 1:30" reads as a property of the REST
                      timer. It has its own labelled control below. */}
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

                  {/* ── Set type ──────────────────────────────────────────
                      `Normal` on its own was a value with no field beside it.
                      It named what this set is without ever saying that it is
                      a CHOICE, and a coach who has not opened the sheet has no
                      way to learn that warm-ups, drop sets and AMRAP live
                      behind it.

                      So: the field is named above the control, the control is
                      a full 44pt target rather than a 32pt chip, it carries a
                      chevron so it reads as something that opens, and the line
                      underneath says what the current method MEANS and what
                      else is in there. Both sentences come out of the
                      catalogue — see otherMethodsHint — so neither can drift
                      from what the picker actually offers. */}
                  {(() => {
                    const m = methodFor(e.method).method;
                    return (
                      <View style={{ marginTop: sp.md }}>
                        <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.xs }}>
                          {rows.tabled ? 'Set type · every set unless a row says otherwise' : 'Set type'}
                        </Text>
                        <Pressable onPress={() => setMethodOpenFor({ di, key: e.key, row: null })} accessibilityRole="button"
                          accessibilityLabel={`Set type for ${e.name}${rows.tabled ? ', applied to every set unless a row says otherwise' : ''} — currently ${m.label}. ${m.blurb} Opens the list of set types.`}
                          style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: sp.sm,
                                   minHeight: MIN_TARGET, paddingHorizontal: sp.lg, paddingVertical: sp.sm,
                                   borderRadius: radius.pill, borderWidth: hairline, borderColor: t.ring, backgroundColor: t.surface2 }}>
                          <Text style={{ ...ty.body, color: t.ink }}>{m.label}</Text>
                          <Icon name={FORWARD_ICON} size={16} color={t.ink3} />
                        </Pressable>
                        <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>
                          {m.blurb} {otherMethodsHint(e.method)}
                        </Text>
                      </View>
                    );
                  })()}

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
                </Animated.View>
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

        {/* ── programme checks ───────────────────────────────────────────
            Named for what it is. Seven rules, no model, no score and no
            grade — see the header of src/lib/programReview.ts, and
            src/lib/finReview.ts for the screen this one was written not to
            be, back when it was called an AI review. Every line below is a finding that names the exercise, the
            day or the figure it came from, because a finding a coach cannot
            point at is an opinion and they stop reading at the first one
            they disagree with. */}
        <Section>
          <SectionHead title="Programme Checks"
            note={blockExercises && review.findings.length ? `${num(review.findings.length)} to read` : undefined} />
          <Text style={{ ...ty.caption, color: t.ink3, marginBottom: coverage ? sp.xs : sp.lg }}>{checksLine()}</Text>
          {/* Only on a block, and only because the sentence above used to be
              true of week one and read as true of twelve. */}
          {coverage ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.lg }}>{coverage}</Text>
          ) : null}

          {blockExercises === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing to check yet. The checks read the training days above — every week of them — as you write them.
            </Text>
          ) : (
            <>
              {review.findings.length ? review.findings.map((f, i) => {
                // The figures for a volume finding, in the coach's own unit,
                // and null for every other rule. Computed once and then tested:
                // it converts and rounds, and calling it in the condition and
                // again in the body would round one number twice.
                const figures = volumeLine(f);
                return (
                <View key={`${f.id}-${i}`} style={{ marginBottom: sp.md }}>
                  <Flag tone={f.id === 'injury' ? t.crit : t.warn}>{f.detail}</Flag>
                  {figures ? (
                    <Text style={{ ...ty.caption, color: t.ink3, marginStart: 14, marginTop: 3 }}>{figures}</Text>
                  ) : null}
                </View>
                );
              }) : (
                <Text style={{ ...ty.label, color: t.ink2 }}>
                  Nothing matched. That is not a verdict on the programme — it means none of these rules found
                  anything, and they are a short list.
                </Text>
              )}

              {/* A check that did not run must say so. Silence from one reads
                  as a pass, and "no injury conflicts" over an injury list that
                  never loaded is the failure guardInjuries exists to stop. */}
              {review.skipped.length ? (
                <View style={{ marginTop: review.findings.length ? sp.lg : sp.md }}>
                  {review.skipped.map((sk) => (
                    <Flag key={sk.id} tone={sk.kind === 'unread' ? t.warn : t.ink3} style={{ marginBottom: sp.sm }}>
                      {sk.why}
                    </Flag>
                  ))}
                </View>
              ) : null}

              <View style={{ marginTop: sp.lg }}>
                <Ghost label={checksOpen ? 'Hide What Is Checked' : 'Show What Is Checked'}
                  onPress={() => setChecksOpen((v) => !v)} />
              </View>

              {checksOpen ? (
                <View style={{ marginTop: sp.md }}>
                  {CHECKS.map((c) => (
                    <Text key={c.id} style={{ ...ty.caption, color: t.ink2, marginBottom: 3 }}>{`· ${c.label}`}</Text>
                  ))}
                  {/* The questions a coach would expect here and will not find.
                      A list of findings implies a list of questions asked, and
                      the ones deliberately not asked are part of that. */}
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                    Not checked, because none of them has a settled answer this could hold you to:
                  </Text>
                  {NOT_CHECKED.map((n) => (
                    <Text key={n} style={{ ...ty.caption, color: t.ink3, marginTop: 3 }}>{`· ${n}`}</Text>
                  ))}
                </View>
              ) : null}
            </>
          )}
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

          {/* ── the reason, ABOVE the control it is about ───────────────────
              This sentence used to sit under the button. Both of those places
              carry the same words, so this is not a rewrite — it is a move, and
              the move is the whole argument: a disabled control is discovered by
              TAPPING it, and an explanation printed below the tap is read after
              the frustration rather than instead of it. The coach who reported
              the missing calendar had been staring at the date field
              immediately above; reading downward from it they met a dead button
              before they met the reason, and concluded the date was the
              blocker. It reads in the right order now.

              And when they HAVE typed a date into an empty programme — the
              exact state that was reported — the sentence says outright that
              the date is not what is holding it. That is the misdiagnosis
              itself, answered where it happens. */}
          {blockExercises === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginBottom: sp.sm }}>
              Add at least one exercise to assign this program.
              {startsOn ? ' The start date is not what is holding it — an empty program is.' : ''}
            </Text>
          ) : pickedIds.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, textAlign: 'center', marginBottom: sp.sm }}>
              Tick everybody who should get this — one client or twenty.
            </Text>
          ) : null}

          <View style={{ opacity: canAssign ? 1 : 0.4 }} pointerEvents={canAssign && !assignBusy ? 'auto' : 'none'}>
            <Cta wide label={assignCtaLabel({
              busy: assignBusy,
              picked: pickedIds.length,
              exercises: blockExercises,
              planLabel: plan.label,
              soleName: pickedIds.length === 1 ? (roster.find((r) => r.id === pickedIds[0])?.name ?? null) : null,
            })} onPress={assign} />
          </View>

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

      {/* ── the start day, as a month ─────────────────────────────────────
          Dismissing it is a cancel and writes nothing: a picker that committed
          whatever cell was under the highlight when it closed would put a start
          date on a block the coach never chose, which is the same class of harm
          `CLIENT_STARTS_NOW` is printed to prevent. */}
      <DateSheet
        visible={startPick}
        value={startsOn}
        heading="Starts On"
        note="The day this block begins. Leave it unset to start now."
        onCancel={() => setStartPick(false)}
        onPick={(iso) => { setStartsOn(iso); setStartPick(false); }}
      />

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
                  style={{ paddingStart: sp.md, paddingVertical: sp.md }}>
                  <Icon name={FORWARD_ICON} size={15} color={t.ink3} />
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
                        // `e.name` and NOT the translated name, deliberately. A
                        // programme stores an exercise name and every screen
                        // resolves it through exerciseSlug(); writing
                        // "Kniebeuge" in here would put a movement into a
                        // client's week that resolves to nothing — no
                        // illustration, no history, "not in our catalogue" on
                        // tap. The identity is English; only the label moves.
                        onPress={() => { if (pickerDay !== null) { addExercise(pickerDay, e.name, e.group || ''); setPickerDay(null); } }}
                        accessibilityRole="button" accessibilityLabel={`Add ${e.display.text}`}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{e.display.text}</Text>
                          {/* Only what the row actually carries. A movement with
                              no muscle group shows no muscle group — never
                              "Uncategorised", which is a label we invented, and
                              never a blank chip implying one is loading. And
                              "illustrated" is claimed only where image_paths is
                              genuinely non-empty, because a coach who taps
                              expecting a picture and gets a sentence stops
                              trusting the marker on every other row. */}
                          {/* fallbackTag joins the same line: a coach picking a
                              movement for a German-speaking client can see at a
                              glance which names that client will read in
                              English. It is null, and so absent, for a coach
                              whose own device is in English. */}
                          {e.group || e.hasDemo || fallbackTag(e.display) ? (
                            <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                              {[e.group, e.hasDemo ? 'Illustrated' : null, fallbackTag(e.display)].filter(Boolean).join(' · ')}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                      <Pressable onPress={() => previewExercise(e.name)} hitSlop={8}
                        accessibilityRole="button" accessibilityLabel={`What ${e.display.text} is`}
                        style={{ paddingStart: sp.md, paddingVertical: sp.md }}>
                        <Icon name={FORWARD_ICON} size={15} color={t.ink3} />
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
            {templates.map((tpl, i) => {
              const dc = tpl.program.days.length;
              const ec = tpl.program.days.reduce((a, d) => a + d.exercises.length, 0);
              return (
                <View key={tpl.id} style={{ borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
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
                      style={{ paddingStart: sp.md, paddingVertical: sp.md }}>
                      <Icon name="minus" size={17} color={t.ink3} />
                    </Pressable>
                  )}
                </View>
                {/* A refused delete leaves the row exactly where it was, which
                    is right and is also silent — so it says so ON the row that
                    stayed, where the coach is looking. */}
                {tplDelFailed && tplDelFailed.id === tpl.id ? (
                  <Flag tone={t.crit} style={{ marginBottom: sp.md }}>{tplDelFailed.why}</Flag>
                ) : null}
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
            Reuse this program with other clients — {num(blockExercises)} exercise{s(blockExercises)} across {num(blockDays)} day{s(blockDays)}{blockWeeks.length > 1 ? ` in ${num(blockWeeks.length)} weeks` : ''}.
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
