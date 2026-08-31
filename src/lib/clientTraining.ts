// One client's logged training, read back for the coach.
//
// ── The hole this closes ───────────────────────────────────────────────────
//
// A coach could not see what a client had actually done. Not "the screen was
// thin" — there was no reader at all. `workouts` was written from three places
// (the client's own quick-log, their exercise library, and
// app/(trainer)/log-session.tsx, where a coach types up the session they just
// ran) and read back from exactly one direction: the client's own app. Every
// coach-side query against the table selected `(user_id, performed_at)` and
// nothing else — src/ui/roster.tsx to date-stamp "last active",
// src/lib/clientDrift.ts to decide whether somebody had gone quiet. Timestamps.
// Never an exercise, never a set, never a load.
//
// So the coach app knew that a client had trained on Tuesday and could not say
// what they lifted, how many sets they got through, or whether the session was
// one the coach had typed up themselves an hour earlier. The client detail
// sheet on the roster said, in as many words, "Session history appears here
// once <name> logs workouts" — a sentence that had never been true and never
// would be, because nothing was going to populate it.
//
// ── Why the arithmetic is here and not in the screen ───────────────────────
//
// Because this is where the fabrication would happen. Every figure below is a
// claim about somebody else's month made to the person coaching them, and each
// one has an obvious wrong version that looks completely fine on screen:
//
//   · a volume of 0 for a session of chin-ups and planks, which is not a light
//     session, it is a session with no external load to total;
//   · a session count taken off a read that came back at the row cap, which is
//     a subtotal wearing a total's label;
//   · "logged by you" on a session a previous coach logged;
//   · a session count of 0 rendered from a read that was refused.
//
// Pure and framework-free, so a test can hold all of that without a database.
//
// ── What counts as one session ─────────────────────────────────────────────
//
// The rows that share a `performed_at`. That is not a heuristic — it is how the
// writes are built: `app/(trainer)/log-session.tsx` stamps one `at` and applies
// it to every exercise on the sheet, and the client's own quick-log does the
// same with `nowISO`. src/lib/longView.ts already counts a member's months this
// way and says so on `MonthCell.sessions`; this module uses the same rule so a
// coach and their client cannot be shown two different session counts for the
// same fortnight.
//
// It is worth being honest about where that rule frays. A client who logs one
// exercise at a time from their library — open, type the sets, save, open the
// next — writes a distinct timestamp per exercise, and this will read that hour
// as four sessions rather than one. The alternative, bucketing by a time
// window, invents a boundary the record does not contain and would silently
// merge a genuine morning and evening double day into one. Neither is free; the
// timestamps are at least the app's own account of itself, and `day` is carried
// on every session so a screen can group them under one heading without this
// module having to guess.
import type { WorkoutEntry } from './mockData';
import { dayKeyOf } from './entryEdit';
import { type LoadStatus } from '../ui/loadStatus';
import { dayLabel } from './adherence';
import { type WeightUnit } from './units';

/** Who put a session into the client's record.
 *
 *  'coach' rather than 'them' when the id does not match the coach reading the
 *  screen — a client who has changed coach carries the old coach's id on their
 *  old sessions, and so does a coach whose auth session has not finished
 *  restoring. Both are "a coach, not this one, or not known to be this one",
 *  and saying "you logged this" about either is a false statement about who
 *  stood in the room. */
export type Attribution = 'client' | 'you' | 'coach' | 'mixed';

/**
 * One session: everything logged under a single instant.
 *
 * `LoggedSession`, not `TrainingSession`, and the distinction is load-bearing.
 * src/lib/types.ts already owns a `TrainingSession`, and it is a BOOKED slot in
 * the coach's diary — an appointment, with a status and a duration, that may
 * never have happened. This is the opposite end: a record of work that did.
 * Conflating the two is the inference 33-session-outcomes.sql was written to
 * end (a booked slot whose clock has passed is not evidence anybody trained),
 * so the two must not share a name in a codebase where both are in scope.
 */
export interface LoggedSession {
  /** The `performed_at` every entry in it shares. The session's identity. */
  at: string;
  /** The local calendar day it lands on for whoever is reading, or null when
   *  the timestamp cannot be parsed. Never faked to today — see `sessionsOf`. */
  day: string | null;
  /** The exercises, in the order they should be read. */
  entries: WorkoutEntry[];
  /** Distinct exercise names. Two entries for the same movement in one session
   *  count once, because that is one exercise done twice, not two exercises. */
  exercises: number;
  /** Sets with a rep count above zero. A blank row somebody tabbed past is not
   *  a set of no reps and is not counted as one. */
  sets: number;
  /** Sets that had reps but no load: chin-ups, press-ups, planks. Carried
   *  separately so a screen can say the volume below covers only part of the
   *  session rather than letting a small tonnage imply an easy hour. */
  bodyweightSets: number;
  /** Σ reps × load, in kilograms, over the sets that carried a load.
   *
   *  null, never 0, when no set in the session carried one. A bodyweight
   *  session has no tonnage to state — that is an absent measurement, not a
   *  measurement of zero, and every screen downstream renders it as a dash. */
  volumeKg: number | null;
  /** Σ kcal over the entries that carried a figure; null when none did. A
   *  strength session records reps and weight, not energy. */
  kcal: number | null;
  /** How long the session ran, when somebody said. Session-scoped in the
   *  database (see `WorkoutEntry.sessionMins`), so the first entry that carries
   *  one speaks for the session — and a disagreement between rows is reported
   *  rather than averaged away. */
  mins: number | null;
  /** True when two entries of one session carry different lengths. Should not
   *  happen — `setSessionMins` writes them in one statement — and if it does,
   *  the screen says so instead of picking a winner. */
  minsDisagree: boolean;
  /** True when at least one entry carries a cardio block. */
  cardio: boolean;
  /** Distinct non-null `logged_by` ids in the session. */
  coachIds: string[];
  /** True when at least one entry has no `logged_by` — the client's own hand. */
  clientLogged: boolean;
  /** The newest `amended_at` in the session: the client changed something their
   *  coach had logged. Server-stamped by the guard_workout_attribution trigger
   *  and not writable from either app, which is what makes it worth showing. */
  amendedAt: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * A log split into sessions, newest first.
 *
 * The order is stated here rather than inherited from the query. The reads that
 * feed this already ask for `performed_at` descending, but a screen headed
 * "newest first" must not depend on an ORDER BY in a file it does not own —
 * `trainingDays` in src/lib/ownTraining.ts makes the same point for the same
 * reason.
 *
 * An entry whose timestamp cannot be parsed keeps its session (the raw string
 * is still a perfectly good grouping key, and the sets in it are real) but gets
 * `day: null` rather than being filed under today. Inventing a training day out
 * of a parsing failure is the bug ownTraining.ts documents; here it would put
 * a session on the coach's screen dated to the moment they opened it.
 */
export function sessionsOf(log: readonly WorkoutEntry[]): LoggedSession[] {
  const byAt = new Map<string, WorkoutEntry[]>();
  for (const e of log) {
    if (!e || typeof e.t !== 'string' || !e.t) continue;
    const bucket = byAt.get(e.t);
    if (bucket) bucket.push(e);
    else byAt.set(e.t, [e]);
  }

  const out: LoggedSession[] = [];
  for (const [at, entries] of byAt) {
    let sets = 0, bodyweightSets = 0;
    let volume = 0, anyVolume = false;
    let kcal = 0, anyKcal = false;
    let mins: number | null = null, minsDisagree = false;
    let cardio = false;
    let amendedAt: string | null = null;
    const names = new Set<string>();
    const coachIds: string[] = [];
    let clientLogged = false;

    for (const e of entries) {
      names.add(e.exercise);
      if (e.cardio) cardio = true;
      const k = num(e.kcal);
      if (k != null) { kcal += k; anyKcal = true; }

      const m = num(e.sessionMins);
      // Zero is not a length. `setSessionMins` refuses a non-positive figure on
      // the way in for exactly this reason: Health would take it as a real
      // event lasting no time at all.
      if (m != null && m > 0) {
        if (mins == null) mins = m;
        else if (mins !== m) minsDisagree = true;
      }

      if (e.loggedBy) { if (!coachIds.includes(e.loggedBy)) coachIds.push(e.loggedBy); }
      else clientLogged = true;

      if (e.amendedAt && (amendedAt == null || Date.parse(e.amendedAt) > Date.parse(amendedAt))) {
        amendedAt = e.amendedAt;
      }

      for (const set of e.sets ?? []) {
        const reps = num(set?.[0]) ?? 0;
        const load = num(set?.[1]) ?? 0;
        // Only a real rep count is a set. Everything else on this row is
        // conditioned on it, so a blank row contributes nothing anywhere.
        if (!(reps > 0)) continue;
        sets++;
        if (load > 0) { volume += reps * load; anyVolume = true; }
        else bodyweightSets++;
      }
    }

    out.push({
      at,
      day: dayKeyOf(at),
      // Copied, and deliberately NOT re-sorted. Every entry in a session shares
      // one instant, so there is no order in the record to recover — the rows
      // arrive in the order the query returned them and that is the only order
      // there is. Sorting on `t` here would look like it was doing something
      // and would in fact be shuffling on a value that is equal throughout.
      entries: [...entries],
      exercises: names.size,
      sets,
      bodyweightSets,
      volumeKg: anyVolume ? Math.round(volume) : null,
      kcal: anyKcal ? Math.round(kcal) : null,
      mins,
      minsDisagree,
      cardio,
      coachIds,
      clientLogged,
      amendedAt,
    });
  }

  // Newest first. Ties — two sessions written in the same millisecond, which
  // the string key makes impossible, but a reversed page upstream does not —
  // fall back to the key so the order is total and reproducible.
  return out.sort((a, b) => {
    const d = Date.parse(b.at) - Date.parse(a.at);
    return Number.isFinite(d) && d !== 0 ? d : b.at.localeCompare(a.at);
  });
}

/**
 * Who logged a session, from the point of view of the coach reading it.
 *
 * `viewerId` null is the coach's auth session still restoring, and it collapses
 * to 'coach' rather than to 'you': "you logged this" is a specific claim about
 * who was in the room, and a screen that makes it off an unknown id will
 * sometimes make it about a coach who has since handed the client on.
 */
export function attributionOf(s: LoggedSession, viewerId: string | null): Attribution {
  if (!s.coachIds.length) return 'client';
  if (s.clientLogged) return 'mixed';
  if (viewerId && s.coachIds.length === 1 && s.coachIds[0] === viewerId) return 'you';
  return 'coach';
}

/** How a session's attribution reads on the coach's screen. `who` is the
 *  client's first name — the sentence is about them either way. */
export function attributionLabel(a: Attribution, who: string): string {
  switch (a) {
    case 'client': return `${who} logged this`;
    case 'you': return 'You logged this';
    case 'coach': return 'Logged by a coach';
    case 'mixed': return `Logged by ${who} and a coach`;
  }
}

/* ── the day, which is the unit a coach actually reads in ──────────────────── */

/**
 * A local calendar day and everything logged on it.
 *
 * ── Why the screen groups by day and not by session ────────────────────────
 *
 * Because the timestamps lie about session boundaries more often than they were
 * ever supposed to, and the live data says so. One real client's record holds
 * four `workouts` rows for the same movement, with the same sets, at
 * 01:34:16.643, :17.677, :18.110 and :18.427 — one squat workout, or one button
 * tapped four times, written as four instants a second apart. Counted by
 * timestamp that reads as FOUR SESSIONS, and a coach opening the screen the
 * morning after would be shown four identical workouts one second apart and
 * have to work out for themselves that they were looking at one.
 *
 * The day is the unit a coach means when they ask what somebody did. It cannot
 * be got wrong by a double tap, it survives a client who logs one movement at a
 * time, and it costs one thing that is stated rather than hidden: a genuine
 * morning and evening double day reads as one day. `sessions` is carried on
 * every day so the screen can show the separate logging events inside it, and
 * `TrainingBoard.entryCount` counts them, so nothing about the record is thrown
 * away — it is just no longer the headline.
 *
 * src/lib/longView.ts keeps both figures for the same reason and calls them
 * `sessions` and `days`.
 */
export interface TrainingDay {
  /** `YYYY-MM-DD` in the reader's own timezone. */
  day: string;
  /** The logging events on that day, newest first. Usually one. */
  sessions: LoggedSession[];
  /** Distinct movements across the whole day. */
  exercises: number;
  /** Sets with a rep count, across the whole day. */
  sets: number;
  /** Of those, the ones that carried no load. */
  bodyweightSets: number;
  /** Σ reps × load over the day, in kilograms; null when nothing carried a
   *  load. Never 0 — see `LoggedSession.volumeKg`. */
  volumeKg: number | null;
  /** Σ kcal over the day where entries carried a figure; null when none did. */
  kcal: number | null;
  /** True when anything logged that day carried a cardio block. */
  cardio: boolean;
}

/**
 * Sessions folded into the days they happened on, newest day first.
 *
 * A session whose timestamp could not be parsed belongs to no day and comes
 * back in `undated` rather than being filed under one. Putting it under today
 * would invent a training day out of a parsing failure, and putting it under
 * the epoch would invent one in 1970.
 *
 * Deliberately no day-level `mins`. Two logging events on one day may each
 * carry the same session length — that is what `setSessionMins` writes, one
 * figure across every row of a session — and where the four rows above are one
 * workout logged four times, summing their lengths would report four hours of
 * training from an hour of squats. A length is a fact about a session and is
 * shown on the session.
 */
export function trainingDaysOf(
  sessions: readonly LoggedSession[],
): { days: TrainingDay[]; undated: LoggedSession[] } {
  const byDay = new Map<string, LoggedSession[]>();
  const undated: LoggedSession[] = [];
  for (const sn of sessions) {
    if (!sn.day) { undated.push(sn); continue; }
    const bucket = byDay.get(sn.day);
    if (bucket) bucket.push(sn);
    else byDay.set(sn.day, [sn]);
  }

  const days: TrainingDay[] = [];
  for (const [day, group] of byDay) {
    const names = new Set<string>();
    let sets = 0, bodyweightSets = 0;
    let volume = 0, anyVolume = false;
    let kcal = 0, anyKcal = false;
    let cardio = false;
    for (const sn of group) {
      sets += sn.sets;
      bodyweightSets += sn.bodyweightSets;
      if (sn.volumeKg != null) { volume += sn.volumeKg; anyVolume = true; }
      if (sn.kcal != null) { kcal += sn.kcal; anyKcal = true; }
      if (sn.cardio) cardio = true;
      for (const e of sn.entries) names.add(e.exercise);
    }
    days.push({
      day,
      // Newest logging event first inside the day, matching the order of the
      // days themselves. `sessionsOf` already sorts, but a day's contents are
      // read top to bottom and the order must not depend on which bucket a Map
      // happened to fill first.
      sessions: [...group].sort((a, b) => b.at.localeCompare(a.at)),
      exercises: names.size,
      sets,
      bodyweightSets,
      volumeKg: anyVolume ? Math.round(volume) : null,
      kcal: anyKcal ? Math.round(kcal) : null,
      cardio,
    });
  }
  // Day keys are `YYYY-MM-DD`, so a string compare IS a date compare.
  days.sort((a, b) => b.day.localeCompare(a.day));
  return { days, undated };
}

/* ── the whole history, and what may honestly be said about it ─────────────── */

/**
 * What the record supports about a client's training.
 *
 * `state` is the thing the screen branches on, and the three values are three
 * different conversations:
 *
 *   'unreadable'  the read failed or was refused. Nothing below it is a fact
 *                 about the client. This is what a null `sessions` means, and
 *                 the caller passes null on 'error' precisely so that an empty
 *                 array can never arrive here meaning two things.
 *   'none'        the read landed and the client has logged nothing. Worth
 *                 raising with them; it is about them, not the connection.
 *   'some'        there are sessions.
 *
 * Every total is null unless the read was WHOLE. A capped read ('partial')
 * hands back a prefix of an unknown set — see src/lib/rowCap.ts — so counting
 * it produces a smaller number stated with full confidence, which is worse than
 * no number. The days themselves are still listed: a coach reading the newest
 * twenty days of a truncated set is reading twenty real days.
 */
export interface TrainingBoard {
  state: 'unreadable' | 'none' | 'some';
  /** The days, newest first. Empty under 'unreadable' and 'none'. */
  days: TrainingDay[];
  /** Sessions whose timestamp could not be read, so they belong to no day.
   *  Kept rather than dropped — the sets in them are real — and listed apart so
   *  they cannot be silently filed under a day nobody trained on. */
  undated: LoggedSession[];
  /** How many days were trained, or null when the read cannot support a count. */
  dayCount: number | null;
  /** How many separate logging events those days contain. Equal to `dayCount`
   *  for a client who logs a session in one go, and larger for one who logs a
   *  movement at a time. Carried so the screen can explain a day that looks
   *  like four workouts. */
  entryCount: number | null;
  /** Sets with a rep count across the whole set, or null as above. */
  sets: number | null;
  /** Σ volume across the whole set in kilograms; null when the read cannot
   *  support a total, and equally null when it can and no session carried a
   *  load. Both are dashes on screen and neither is a zero. */
  volumeKg: number | null;
  /** The newest day trained, or null when there is none / it cannot be parsed.
   *  Safe to state under 'partial': a capped read is ordered newest first, so
   *  the newest row is the one thing truncation cannot remove. */
  newestDay: string | null;
}

const UNREADABLE: TrainingBoard = {
  state: 'unreadable', days: [], undated: [], dayCount: null, entryCount: null,
  sets: null, volumeKg: null, newestDay: null,
};

const EMPTY_BOARD: TrainingBoard = {
  state: 'none', days: [], undated: [], dayCount: 0, entryCount: 0,
  sets: 0, volumeKg: null, newestDay: null,
};

export function trainingBoard(
  sessions: LoggedSession[] | null,
  status: LoadStatus,
): TrainingBoard {
  if (sessions == null || status === 'error') return UNREADABLE;
  if (!sessions.length) {
    // A read still in flight has produced no rows and is not an empty history.
    // 'loading' therefore cannot say 'none' — it says nothing, and the caller's
    // 'loading' branch is what renders.
    return status === 'loading' ? UNREADABLE : EMPTY_BOARD;
  }

  const { days, undated } = trainingDaysOf(sessions);
  const whole = status === 'ready';
  let sets = 0, volume = 0, anyVolume = false, entries = 0;
  for (const d of days) {
    sets += d.sets; entries += d.sessions.length;
    if (d.volumeKg != null) { volume += d.volumeKg; anyVolume = true; }
  }
  for (const u of undated) {
    sets += u.sets; entries += 1;
    if (u.volumeKg != null) { volume += u.volumeKg; anyVolume = true; }
  }
  return {
    state: 'some',
    days,
    undated,
    dayCount: whole ? days.length : null,
    entryCount: whole ? entries : null,
    sets: whole ? sets : null,
    volumeKg: whole && anyVolume ? volume : null,
    newestDay: days.length ? days[0].day : null,
  };
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * The line under "Their Training" on app/(trainer)/client.tsx — the compressed
 * claim that stands in for a screen the coach has not opened yet.
 *
 * Same discipline as every line in src/lib/clientBrief.ts: a branch per read
 * status, no count over a truncated read, and no empty answer produced by a
 * failure. The sentence a coach must never be shown is "has logged nothing"
 * when the truth is "we could not ask".
 */
export function trainingLine(status: LoadStatus, board: TrainingBoard, who: string): string {
  if (status === 'loading') return 'Reading the sessions they have logged…';
  if (board.state === 'unreadable') {
    return `Their logged training could not be read. That is not the same as ${who} having logged none.`;
  }
  if (board.state === 'none') {
    return `Nothing logged yet. The read came back empty, so that is about ${who} rather than about the connection.`;
  }
  const when = board.newestDay ? dayLabel(board.newestDay) : '—';
  const last = when === '—' ? '' : ` Last trained ${when}.`;
  if (board.dayCount == null) {
    // 'partial'. The newest day survives truncation — the read is ordered
    // newest first — so the date is safe to state and the count is not.
    return `Their training came back at the row limit, so how much of it there is cannot be counted from here.${last}`;
  }
  // Days, not logging events. `entryCount` is the larger number and it is the
  // one a double tap inflates; see the note on `TrainingDay`.
  return `${board.dayCount} day${s(board.dayCount)} logged.${last}`;
}

/* ── whose pounds ─────────────────────────────────────────────────────────── */

/**
 * Which unit a client's loads are printed in on the coach's screen, and the
 * sentence that says whose unit it is.
 *
 * Every other coach-side screen prints in the COACH's unit — client-body.tsx
 * and client.tsx both say so in as many words, and they are right to: printing
 * kilograms at a coach who reads pounds is a wrong number, not a style. This
 * screen is the one place that reasoning breaks down. What is on it is a
 * transcript of a conversation the two of them are about to have — "how did the
 * squats feel at that weight" — and a coach quoting 100 at somebody whose phone
 * says 220 is a coach who appears not to know what their client did.
 *
 * So the client's own unit wins where the record actually holds one. Where it
 * does not, this does NOT guess:
 *
 *   `clients.weight_unit` is nullable with no default, and NULL means "never
 *   chosen" rather than kilograms — see the note on DEFAULTS in
 *   src/ui/settings.tsx and supabase/parts/61-unit-preference.sql. A client who
 *   picked pounds on a handset before that column existed still reads pounds,
 *   from a device cache this screen cannot see, over a NULL column. Printing
 *   "their unit: kg" off that NULL would be a claim about their phone made from
 *   a column that says nothing.
 *
 * In both of the unknown cases the coach's own unit is used — it is the one
 * preference this app is certain of on this device — and the note says plainly
 * whose it is. Nothing on the screen is ever an unlabelled number.
 */
export interface UnitChoice {
  unit: WeightUnit;
  /** 'client' when the record named it; 'you' when it did not and the coach's
   *  own is standing in. */
  source: 'client' | 'you';
  /** What the screen prints under the loads. Null only when the two units agree
   *  AND the record named the client's — the one case where there is genuinely
   *  nothing to disambiguate. */
  note: string | null;
}

const isWeightUnit = (v: unknown): v is WeightUnit => v === 'kg' || v === 'lb';

export function unitFor(
  clientUnit: unknown,
  coachUnit: WeightUnit,
  status: LoadStatus,
  who: string,
): UnitChoice {
  if (status === 'error') {
    return {
      unit: coachUnit, source: 'you',
      note: `${who}'s own unit could not be read, so every load below is in yours (${coachUnit}). `
        + `That is a fact about the read, not about what their app shows them.`,
    };
  }
  if (status === 'loading') {
    // Not yet an answer. The coach's unit stands in, and the note says the
    // screen is still asking rather than implying it has been told.
    return { unit: coachUnit, source: 'you', note: `Reading which unit ${who} uses. Loads are in yours (${coachUnit}) meanwhile.` };
  }
  if (!isWeightUnit(clientUnit)) {
    return {
      unit: coachUnit, source: 'you',
      note: `${who} has not set a unit on their account, so every load below is in yours (${coachUnit}). `
        + `Their phone may still be showing them the other one.`,
    };
  }
  if (clientUnit === coachUnit) return { unit: clientUnit, source: 'client', note: null };
  return {
    unit: clientUnit, source: 'client',
    note: `Every load below is in ${clientUnit} — ${who}'s own unit, and what their phone shows `
      + `them. You read in ${coachUnit}.`,
  };
}
