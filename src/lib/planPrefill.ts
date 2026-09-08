// THE SESSION THE COACH ALREADY WROTE, OFFERED BACK TO THEM WHEN THEY LOG IT.
//
// "After a coach builds a client a workout template, the coach should be able
// to tap on the client's name and have an option to log the session by using
// the workout template they have built for the client."
//
// Tapping the client and choosing Log a Session already worked. What the screen
// then offered was `LIB` — sixteen generic movement names, the same list for
// every client on the book — so a coach who had spent twenty minutes writing
// somebody a push day retyped it, movement by movement, standing next to them.
// This module is the other half: the programme that coach assigned, read back
// as rows they can put figures into.
//
// ── THE ONE RULE, AND IT IS THE WHOLE DESIGN ──────────────────────────────
//
// A PLAN'S TARGET IS NOT A PERFORMED SET.
//
// `ProgramExercise.reps` is a STRING and is frequently not a number. The live
// values across this platform's own catalogue are "5", "6-8", "8-12", "AMRAP",
// "30s", "30-60s", "45s", "60s", "10/leg", "8/side", "15/side" — twenty-six
// distinct strings across 126 exercise references, of which eleven parse as an
// integer (src/lib/workoutTemplates.ts checked them against the live table).
// `Number("6-8")` is NaN, which fails loudly. `parseInt("30s")` is 30, WHICH
// SUCCEEDS — and turns a thirty-second plank hold into thirty repetitions in
// somebody else's permanent record, written by their coach, which they cannot
// delete.
//
// So nothing here parses a prescription into a performed figure. The reader is
// `tickRecord` in src/lib/setTicks.ts, which already made this decision for the
// member's own checklist and made it correctly: a single whole number is a
// definite count, and a range, a hold, an AMRAP and a blank are all "not known
// in advance". It is asked rather than re-implemented, because two readers of
// the same strings is how the two halves of an app come to disagree about what
// a plank is.
//
// What the prefill therefore carries across is:
//
//   · THE EXERCISE LIST, in the coach's own order, with the English movement
//     identity that gets written to `workouts.exercise`.
//   · THE SET COUNT, through `expandSets`, so a coach's per-set table — a ramp
//     of 60 / 65 / 70 — arrives as three different rows rather than three
//     copies of the first.
//   · THE TARGET, VERBATIM, as something to read. "6-8" stays the six words
//     the coach wrote and never becomes 6, 7 or 8.
//   · THE PRESCRIBED LOAD, where it is a real number, because a load is stored
//     as a number and needs no interpreting.
//
// and what it refuses to carry is a rep count the plan did not state, and a
// load the plan did not name. An absent load is null and STAYS null: a stored
// 0 and a load nobody prescribed cannot be told apart afterwards, which is the
// argument src/lib/bodyweightSets.ts makes at length.
//
// ── A HOLD IS SEEDED AS NOTHING, AND THAT IS DELIBERATE ───────────────────
//
// `tickRecord` reads "45 sec" as a definite forty-five SECONDS, and the
// member's runner logs it as one — `timed[i] === true` beside the pair, so
// `sets[i][0]` means seconds rather than reps (src/lib/timedSets.ts).
//
// app/(trainer)/log-session.tsx has no such flag. It writes `[reps, kg]` pairs
// and nothing else, so a 45 seeded into its reps box IS forty-five repetitions
// of a plank as far as every reader of that row is concerned. A definite figure
// that the destination cannot express is not a figure worth seeding, so the
// entry is left blank, the target is shown, and `prefillLine` says out loud
// that it happened. The alternative — seeding it and hoping — is the exact
// defect this file exists to prevent, arrived at from the other direction.
//
// ── FOUR REASONS THERE IS NOTHING TO OFFER, AND THEY ARE FOUR SENTENCES ───
//
// `planOffer` is the second half of this module and it exists for one reason:
// "still reading", "the read failed", "no programme assigned" and "a programme
// with nothing in it" are four different facts, and only two of them are about
// the client. A coach standing on a gym floor who is told "they have no
// programme" when the truth is "your phone could not reach the server" will
// write the session from memory and stop trusting the screen. That is the
// distinction src/ui/loadStatus.ts exists for and it is enforced here rather
// than left to a screen's ternary.
//
// Which WEEK of a block the date falls in, and which day of that week the date
// schedules, are not decided here. `trainingOnDay` in src/lib/daySession.ts
// already owns that — through `programWeeks`, `blockPosition`, `clientWeek` and
// `scheduledDay`, in that order — and its header says in as many words that
// there must never be a second resolver. So this asks it, and adds only the
// one thing a LOG needs that a day sheet does not: the whole week's days, so
// the coach can pick. A coach writing up an hour is routinely writing up the
// Friday session they ran on a Wednesday, and an offer that could only load the
// scheduled day would refuse the session that actually happened.
//
// Pure. No react, no supabase, no clock — the date is passed in.
import { expandSets, type SetSpec } from './setRows';
import { tickRecord } from './setTicks';
import { dayTrainingCaveat, trainingOnDay } from './daySession';
import type { Program, ProgramDay, ProgramExercise } from './programs';
import type { LoadStatus } from '../ui/loadStatus';

/* ── the prefill ──────────────────────────────────────────────────────────── */

/**
 * What the plan says about the reps of one set, in the only four ways it can
 * say anything.
 *
 * A kind rather than a boolean, because the three that seed nothing seed
 * nothing for three different reasons and a coach reading the sheet is owed the
 * difference — a blank under "AMRAP" is the plan asking a question, and a blank
 * under "45s" is this screen admitting it cannot hold the answer.
 */
export type TargetKind =
  /** A single whole number of repetitions. The one kind that is seeded. */
  | 'count'
  /** Seconds — '45 sec', '1 min'. Definite, and not a rep count. See the
   *  header on why this screen seeds nothing for it. */
  | 'hold'
  /** A range, an AMRAP, '10/leg' — the plan does not name one figure. */
  | 'open'
  /** The plan says nothing at all about the reps of this set. */
  | 'unstated';

/** One row of the sheet, before the coach has typed into it. */
export interface PrefillSet {
  /** The coach's own words, trimmed and otherwise untouched: '6-8', 'AMRAP',
   *  '30s'. Null where the plan says nothing. Never parsed, never rounded,
   *  never turned into a number. */
  target: string | null;
  kind: TargetKind;
  /** The reps to seed the entry with, or null to leave it blank. Non-null on
   *  'count' and on nothing else. */
  reps: number | null;
  /** The prescribed load in KILOGRAMS, or null where none is prescribed.
   *  Storage is metric and this module converts nothing — the screen renders it
   *  in whatever unit the coach reads in, which is the same boundary
   *  src/lib/setTicks.ts holds for the same reason. */
  loadKg: number | null;
}

/** One movement of the day, with a row per set. */
export interface PrefillExercise {
  /** The ENGLISH identity, which is what gets written to `workouts.exercise`.
   *  A screen may render it translated; a write may not. */
  name: string;
  sets: PrefillSet[];
}

/** A day's worth, and what could not be used. */
export interface DayPrefill {
  exercises: PrefillExercise[];
  /**
   * Entries in the day that carried no movement name and were dropped.
   *
   * Counted rather than swallowed, for the reason `unreadableEntries` is
   * counted in src/lib/workoutTemplates.ts: a day that is quietly one movement
   * short is a session somebody logs wrong, and the coach is the only person
   * who can tell whether the missing row mattered.
   */
  dropped: number;
}

/**
 * One movement's rows.
 *
 * `expandSets` is the reader, so an exercise carrying a per-set TABLE arrives
 * as the coach's own rows and an exercise carrying the old single spec arrives
 * as `sets` copies of it. Neither shape is handled here, on purpose: this file
 * knowing that `setRows` exists would be the second place that decides what a
 * set is.
 */
export function prefillExercise(ex: ProgramExercise): PrefillExercise {
  const name = String(ex?.name ?? '').trim();
  const sets = expandSets(ex as SetSpec).map((s): PrefillSet => {
    const target = String(s.reps ?? '').trim() || null;
    // Asked, never re-derived. `tickRecord` puts the HOLD question first for a
    // reason it writes out: a prescription naming a unit of time is a hold
    // whatever else can be read out of it, and a rep reader that got cleverer
    // must not start reading planks as forty-five repetitions.
    const rec = tickRecord(s);
    const kind: TargetKind = rec?.kind === 'reps' ? 'count'
      : rec?.kind === 'hold' ? 'hold'
        : target ? 'open' : 'unstated';
    return {
      target,
      kind,
      // The ONLY line in this file that puts a number in the reps column, and
      // it copies one `tickRecord` has already certified as a single definite
      // count. There is no parse here and there must never be one.
      reps: rec != null && rec.kind === 'reps' ? rec.value : null,
      // A real number or null. `Number.isFinite` rather than a truthiness test,
      // because a prescribed 0 is not a load and NaN out of a jsonb column is
      // not either — and neither may become a zero in somebody's history.
      loadKg: s.loadKg != null && Number.isFinite(s.loadKg) ? s.loadKg : null,
    };
  });
  return { name, sets };
}

/**
 * A whole day of the programme, ready to be put on the sheet.
 *
 * A movement with no NAME is dropped and counted. The name is the only thing
 * `workouts` stores about which exercise a set belongs to — there is no
 * exercise id on that table — so a nameless row would be sets filed against an
 * empty string, which no screen can show and nobody can search.
 *
 * A movement with no SETS is kept. An exercise written with a zero set count is
 * still a movement the coach put in the session, and it arrives as a row with
 * no set rows under it, which the sheet can have a set added to. Dropping it
 * would be this module deciding the coach made a mistake.
 */
export function prefillDay(day: ProgramDay | null | undefined): DayPrefill {
  const list = day && Array.isArray(day.exercises) ? day.exercises : [];
  const exercises: PrefillExercise[] = [];
  let dropped = 0;
  for (const ex of list) {
    if (!ex || typeof ex !== 'object') { dropped += 1; continue; }
    const one = prefillExercise(ex);
    if (!one.name) { dropped += 1; continue; }
    exercises.push(one);
  }
  return { exercises, dropped };
}

/** How many exercises a day would put on the sheet, without building them.
 *  The figure on the chip and the number of rows that appear are then the same
 *  number by construction rather than by two counts agreeing. */
export function prefillCount(day: ProgramDay | null | undefined): number {
  return prefillDay(day).exercises.length;
}

/** The arithmetic behind `prefillLine`. Counts of rows, never of anything read
 *  from a server, so nothing here needs a load status. */
export interface PrefillTally {
  exercises: number;
  sets: number;
  /** Sets whose reps box was filled in from a definite count. */
  seeded: number;
  /** Sets left blank because the plan names a range, an AMRAP or nothing. */
  open: number;
  /** Sets left blank because the plan names a hold in seconds, which this log
   *  cannot store as anything but repetitions. */
  holds: number;
}

export function prefillTally(p: DayPrefill): PrefillTally {
  const out: PrefillTally = { exercises: p.exercises.length, sets: 0, seeded: 0, open: 0, holds: 0 };
  for (const ex of p.exercises) {
    for (const s of ex.sets) {
      out.sets += 1;
      if (s.kind === 'count') out.seeded += 1;
      else if (s.kind === 'hold') out.holds += 1;
      else out.open += 1;
    }
  }
  return out;
}

/**
 * What just landed on the sheet, said in one place so a coach knows before they
 * scroll why some boxes have figures in them and some do not.
 *
 * Every blank is accounted for by name. A screen that filled eleven boxes and
 * left nine empty without saying so reads as a bug, and a coach who reads it as
 * one will delete the rows and type the session again — which is the work this
 * whole feature exists to save them.
 */
export function prefillLine(p: DayPrefill): string {
  const t = prefillTally(p);
  if (!t.exercises) return 'That day has no movements written on it, so there is nothing to put on the sheet.';
  const parts: string[] = [];
  const ex = t.exercises === 1 ? '1 exercise' : `${t.exercises} exercises`;
  const st = t.sets === 1 ? '1 set' : `${t.sets} sets`;
  parts.push(`${ex} and ${st} added — the plan's figures, not a record of anything yet. Edit them to what was actually done.`);
  if (t.open) {
    parts.push(t.open === 1
      ? '1 set has a target the plan does not state as a single number, so its reps are blank.'
      : `${t.open} sets have a target the plan does not state as a single number, so their reps are blank.`);
  }
  if (t.holds) {
    parts.push(t.holds === 1
      ? '1 set is a hold written in seconds, and this screen records repetitions, so it is left blank.'
      : `${t.holds} sets are holds written in seconds, and this screen records repetitions, so they are left blank.`);
  }
  if (p.dropped) {
    parts.push(p.dropped === 1
      ? '1 movement on that day has no name and could not be added.'
      : `${p.dropped} movements on that day have no name and could not be added.`);
  }
  return parts.join(' ');
}

/**
 * The plan's own words for one row, for the caption under it.
 *
 * Null where the plan says nothing, because "Plan: " with nothing after it is a
 * hole rather than an answer — and a row the coach added by hand has no
 * prescription behind it at all.
 *
 * Takes the string rather than a `PrefillSet`, because the sheet holds these
 * rows as the screen's own editable state by the time they are drawn: the set
 * being captioned is one the coach may have typed over, and only the target
 * survives from the plan.
 */
export function targetLine(target: string | null | undefined): string | null {
  const s = String(target ?? '').trim();
  return s ? `Plan: ${s}` : null;
}

/* ── what there is to offer ───────────────────────────────────────────────── */

/** Why the sheet can or cannot be filled from the programme. Five answers, and
 *  the four that are not 'ready' are four different sentences. */
export type PlanOfferState =
  /** The assignments have not come back yet. Nothing is known either way. */
  | 'loading'
  /** The read failed, or came back truncated. Whether this client has a
   *  programme is UNKNOWN, and must never be said as "they have none". */
  | 'unreadable'
  /** The read landed, and this coach has assigned this client no programme. */
  | 'none'
  /** A programme is assigned and there is nothing written in the week this day
   *  falls in — or nothing but empty days. */
  | 'empty'
  /** There are days to choose from. */
  | 'ready';

/** One day the coach may load. */
export interface PlanDayOption {
  /**
   * The week this came out of and the day's position in it — '0:2'. Stable
   * across a change of date only when it names the same day, which is the
   * point of both halves.
   *
   * Positions rather than names, because two days of one week may both be
   * called 'Push' and a key that collided would let one chip select the other.
   * And the WEEK is in it because the caller holds these keys across changes to
   * the day being logged: a coach who loads day 2 of week one and then files
   * the session under a date in week two would otherwise be told week two's
   * second day was already on the sheet, and shown no way to load it.
   */
  key: string;
  label: string;
  /** How many movements loading it would add. */
  exercises: number;
  /** Whether this is the day the date being logged actually schedules. */
  scheduled: boolean;
  /**
   * The day itself, so the screen can prefill from the chip the coach pressed
   * without asking a second time which week it came out of.
   *
   * Carried rather than looked up again by index. A caller holding a position
   * and a programme would have to re-resolve the week to turn one into the
   * other, and the whole reason `trainingOnDay` hands back `weekDays` is that
   * there is one answer to which week a date falls in.
   */
  day: ProgramDay;
}

export interface PlanOffer {
  state: PlanOfferState;
  /** The one sentence for the section, whatever the state. */
  line: string;
  /** Empty on every state but 'ready'. */
  days: PlanDayOption[];
  /** The day the date schedules, so the screen can pre-select it. Null when the
   *  programme schedules nothing on that weekday, which is ordinary — a coach
   *  logging Friday's session on a Wednesday still gets the picker. */
  scheduledKey: string | null;
  /** 'Week 3 of 8' when the client is on a block, null on a one-week
   *  programme where a week number counts something that does not exist. */
  weekLabel: string | null;
  /** The caveat for a plan resolved from a read that did not land — the phone's
   *  last copy rather than a confirmed one. Null when there is none. */
  caveat: string | null;
}

const NO_DAYS: PlanDayOption[] = [];

/** 'Mon · Push', or whichever half the coach wrote, or the position when they
 *  wrote neither. Always something a coach can tap with confidence. */
function dayLabel(day: ProgramDay, i: number): string {
  const name = String(day?.day ?? '').trim();
  const focus = String(day?.focus ?? '').trim();
  if (name && focus) return `${name} · ${focus}`;
  return focus || name || `Day ${i + 1}`;
}

/**
 * What this coach may load onto the sheet for this client, on this date.
 *
 * `programme`, `startsOn` and `status` are what `useAssignedPrograms` holds;
 * `dateISO` is the day the coach has chosen to file the session under — not
 * today, because a coach writing up Monday's session on Tuesday is asking about
 * Monday and the week of a block is counted to the day on screen. `who` is a
 * first name or a noun phrase, and every sentence below reads with either.
 */
export function planOffer(
  programme: Program | null | undefined,
  startsOn: string | null | undefined,
  dateISO: string,
  status: LoadStatus,
  who: string,
): PlanOffer {
  const d = trainingOnDay(programme, startsOn, dateISO, status, who);
  const caveat = dayTrainingCaveat(d);
  const bare = { days: NO_DAYS, scheduledKey: null, weekLabel: null, caveat: null };

  // The date first, because with an unreadable date nothing below it means
  // anything — and a sentence about the client would be blaming them for it.
  if (d.state === 'undated') {
    return { ...bare, state: 'unreadable', line: 'The day this session is being filed under could not be read, so what was planned for it cannot be worked out.' };
  }
  if (!programme) {
    // Three answers to "there is no programme in hand", and they are three
    // different facts. The order is the one src/ui/assignedPrograms.ts argues
    // for: only a read that LANDED may say a client has nothing assigned.
    if (status === 'loading') {
      return { ...bare, state: 'loading', line: `Reading the programme you have assigned ${who}…` };
    }
    if (d.state === 'unassigned') {
      return {
        ...bare,
        state: 'none',
        line: `You have not assigned ${who} a programme, so there is nothing to load. Add what they did below.`,
      };
    }
    return {
      ...bare,
      state: 'unreadable',
      line: `Your programme assignments could not be read in full, so whether ${who} has one is not known here. That is a connection problem, not a client without a programme — add what they did below, or try again once you are connected.`,
    };
  }

  const days = d.weekDays ?? [];
  // The week `trainingOnDay` resolved, for the key. Zero on a one-week
  // programme, which has no week index to speak of and needs none.
  const weekIndex = d.week?.index ?? 0;
  const options = days.map((day, i): PlanDayOption => ({
    key: `${weekIndex}:${i}`,
    label: dayLabel(day, i),
    exercises: prefillCount(day),
    day,
    // Identity, not a weekday match. `trainingOnDay` picked this day out of
    // this same array through `scheduledDay`, and asking the same question a
    // second way here is how the chip that says "today" comes to disagree with
    // the plan the coach is reading.
    scheduled: d.day != null && day === d.day,
  }));
  const usable = options.filter((o) => o.exercises > 0);
  if (!usable.length) {
    // 'unwritten' is a week with no days in it; a week of days with no
    // movements on them is the same fact for a coach standing here. Both are
    // said as the programme being empty rather than as a rest day, because the
    // coach wrote it and is the only person who can fill it.
    const where = d.weekLabel ? d.weekLabel.toLowerCase() : 'it';
    return {
      ...bare,
      state: 'empty',
      weekLabel: d.weekLabel,
      caveat,
      line: `${who}’s programme has no exercises written in ${where}, so there is nothing to load from it. Add what they did below.`,
    };
  }
  const scheduled = options.find((o) => o.scheduled) ?? null;
  return {
    state: 'ready',
    days: options,
    scheduledKey: scheduled ? scheduled.key : null,
    weekLabel: d.weekLabel,
    caveat,
    line: scheduled
      ? `${scheduled.label} is what ${who}’s programme puts on this day. Load it and edit the sets to what they actually did.`
      : `${who}’s programme schedules nothing on this day, so pick the session you ran. The figures load as targets and you edit them to what was done.`,
  };
}
