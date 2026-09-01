// "Same again next term" — the eight fields a coach re-types every twelve weeks.
//
// ── What was there ────────────────────────────────────────────────────────
//
// app/(trainer)/classes.tsx offers Repeat as 1 / 4 / 8 / 12 weeks AT CREATION
// and nowhere else. Twelve weeks later the Tuesday 6pm Reformer class simply
// stops, and the only way to put it back is to type the title, the kind, the
// branch, the room, the instructor, the day, the hour, the duration and the
// capacity in again — nine fields, from memory, for a class that is already on
// the screen in front of them.
//
// This module is the part of "same again" that is arithmetic, so it can be
// asserted without a database: which rows are one series, when the series ends,
// which dates a re-run would land on, and which of those dates are already
// taken.
//
// ── There is no series in the database, and this does not invent one ──────
//
// `gym_classes` rows are independent. Part 30 gave them a `tenant_id` and
// nothing has ever given them a parent — the existing Repeat loop writes N
// unrelated rows and the fourth of them does not know about the first. So a
// "series" here is a DESCRIPTION of rows that match, not a record, and the
// difference is worth stating because it decides what this can promise:
//
//   · it can say "these nine rows look like one weekly class", and be right
//     about the nine rows it was given;
//   · it CANNOT say "this is the whole of that series", because a row past the
//     read's row cap, or a read that failed, is a row it never saw.
//
// `duplicateBlocker` is the whole of the second point and it refuses rather
// than warns. The reason is specific: the run starts a week after the LAST
// occurrence of the series, so the whole thing depends on having actually seen
// the last one. Under 'partial' the classes shown are real and the ones missing
// are the LATER ones, because the screen sorts ascending — so the row the run
// counts forward from would be the wrong row, and the new term would land on
// top of a term already scheduled. That is the collision this refuses, and it
// is refused at the read rather than guarded against per date, because a date
// check cannot see a class that never arrived.
//
// ── Weeks are added in local wall-clock time, not in milliseconds ─────────
//
// `startsAt + 7 * 86400000` is the obvious version and it is wrong twice a year:
// a 6pm class re-run across a daylight-saving boundary lands at 5pm or 7pm, and
// the members who booked the old one turn up an hour out. `setDate(d + 7)`
// keeps the wall-clock hour and lets the date do the offset, which is what
// "same time next week" means to everybody who is not a computer. The suite
// runs under three timezones (`test:zones`) because of lines like this one.
//
// Pure — no supabase, no react-native, no clock of its own. `now` is passed in.
import { num } from './format';
import { appLocale } from './locale';
import type { LoadStatus } from '../ui/loadStatus';

/** The fields a duplicate copies. Deliberately the shape of the argument
 *  `addClass` takes, minus the date, so a caller cannot assemble a class this
 *  module has not described. */
export interface SeriesShape {
  title: string;
  kind: string;
  instructor: string;
  branch: string;
  room: string;
  durationMin: number;
  capacity: number;
}

/** One class as this module needs to see it. A structural subset of `GymClass`
 *  so the screen passes its own rows straight in. */
export interface SeriesClass extends SeriesShape {
  id: string;
  startsAt: string;
}

/**
 * What makes two rows the same series.
 *
 * Every field a coach would have to re-type, PLUS the weekday and the time of
 * day — because "Tuesday 6pm Reformer at Al Quoz" and "Thursday 6pm Reformer at
 * Al Quoz" are two classes a member chooses between, not one class recorded
 * twice. Duration and capacity are in as well: a 45-minute class and a
 * 60-minute class with the same name are different products, and merging them
 * would make the duplicate copy whichever one happened to be last.
 *
 * The date is NOT in the key, which is the point of the key.
 *
 * Case- and space-insensitive on the typed fields. Branch is free text (the
 * picker it replaced offered six hardcoded Dubai locations), so "Al Quoz" and
 * "al quoz " are one branch to every human who reads the timetable, and a key
 * that disagreed would offer to duplicate a series of one.
 */
export function seriesKey(c: SeriesClass): string {
  const d = new Date(c.startsAt);
  const norm = (s: string) => String(s ?? '').trim().toLowerCase();
  // A row whose date will not parse gets a key nothing else can match, rather
  // than a NaN weekday shared with every other broken row.
  const when = Number.isFinite(d.getTime())
    ? `${d.getDay()}|${d.getHours()}:${d.getMinutes()}`
    : `unparseable|${c.id}`;
  return [
    norm(c.title), norm(c.kind), norm(c.branch), norm(c.room), norm(c.instructor),
    String(c.durationMin), String(c.capacity), when,
  ].join('§');
}

/** Every class in `all` that belongs to the same series as `c`, oldest first.
 *  `c` itself is included — it is one of its own series. */
export function seriesOf<T extends SeriesClass>(c: SeriesClass, all: readonly T[]): T[] {
  const key = seriesKey(c);
  return all
    .filter((x) => seriesKey(x) === key)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * The same wall-clock time, `weeks` weeks later.
 *
 * Exported because the test has to be able to state the DST rule directly
 * rather than through the plan below it.
 */
export function weeksLater(iso: string, weeks: number): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + 7 * weeks);
  return out.toISOString();
}

/** One proposed occurrence, and whether it is going to be written. */
export interface PlannedClass {
  /** ISO, the instant the class starts. */
  startsAt: string;
  /**
   * False when this occurrence falls in the past and would be a dead row.
   *
   * ── The check that is deliberately NOT here ────────────────────────────
   *
   * The first version of this also skipped an occurrence a class already
   * occupies, and that check could never fire. The run starts a week after the
   * LAST occurrence of the series, and the last occurrence is by definition the
   * furthest one on the timetable — so every date proposed is past everything
   * that exists, and the collision it guarded against is unreachable. A
   * condition that cannot be true is a line no test can ever be watching (the
   * same argument `parseRate` in src/lib/coachPrefs.ts makes about `n < 0`), so
   * it is gone rather than kept as reassurance.
   *
   * What that leaves is the real skip, and it is the ordinary case: a coach
   * notices in December that the Tuesday class stopped in November, the run
   * starts a week after November, and the first several occurrences are already
   * behind them. Those cannot be booked and are on nobody's timetable.
   */
  write: boolean;
}

export interface DuplicatePlan {
  /** Every occurrence considered, in order, with its verdict. */
  planned: PlannedClass[];
  /** The ones that would actually be written. */
  toWrite: PlannedClass[];
  /** How many were skipped for falling in the past. */
  inPast: number;
  /** The last occurrence the timetable holds for this series, or null when
   *  every date on it is unreadable. The run starts a week after this. */
  lastAt: string | null;
  /** The fields being copied, ready for `addClass`. */
  shape: SeriesShape;
}

/**
 * What "run this series again for `weeks` more weeks" would actually write.
 *
 * ── Why it counts forward from the LAST occurrence, not from today ────────
 *
 * A coach opens this in week eleven of a twelve-week term. Counting from today
 * would put the first new class next Tuesday — on top of the one already
 * scheduled — and the term would come out one week short at the far end.
 * Counting from the last occurrence is what "next term" means: the class after
 * the last class.
 *
 * A series whose last occurrence is in the PAST is the ordinary case, not an
 * edge one: the coach noticed in December that the Tuesday class stopped in
 * November. The run still starts a week after that last class, which puts the
 * first few occurrences in the past — so those are skipped as well, by
 * `startsAt <= now`. A class scheduled for a Tuesday three weeks ago cannot be
 * booked and is on nobody's timetable; writing it would put dead rows in the
 * schedule and make the count of what was added disagree with what a member can
 * see. `firstFuture` reports where the run actually begins.
 *
 * `weeks` is how many occurrences to ADD, counted from the last one — so 12
 * gives twelve new Tuesdays, of which the ones already on the timetable and the
 * ones in the past are skipped rather than counted.
 */
export function duplicatePlan(
  c: SeriesClass,
  all: readonly SeriesClass[],
  weeks: number,
  now: Date,
): DuplicatePlan {
  const mine = seriesOf(c, all);
  const times = mine
    .map((x) => Date.parse(x.startsAt))
    .filter((t) => Number.isFinite(t));
  const lastMs = times.length ? Math.max(...times) : null;
  const lastAt = lastMs == null ? null : new Date(lastMs).toISOString();

  const shape: SeriesShape = {
    title: c.title, kind: c.kind, instructor: c.instructor, branch: c.branch,
    room: c.room, durationMin: c.durationMin, capacity: c.capacity,
  };

  if (lastAt == null || !Number.isFinite(weeks) || weeks < 1) {
    return { planned: [], toWrite: [], inPast: 0, lastAt, shape };
  }

  const nowMs = now.getTime();
  const planned: PlannedClass[] = [];
  for (let w = 1; w <= Math.floor(weeks); w++) {
    const at = weeksLater(lastAt, w);
    if (!at) continue;
    planned.push({ startsAt: at, write: Date.parse(at) > nowMs });
  }
  const toWrite = planned.filter((p) => p.write);
  return {
    planned,
    toWrite,
    inPast: planned.filter((p) => !p.write).length,
    lastAt,
    shape,
  };
}

/**
 * Why this series may not be duplicated right now, or null when it may.
 *
 * Refuses rather than warns, and the reason is in the header: a duplicate's one
 * job is to land on empty slots, and a timetable that came back short or not at
 * all cannot say which slots are empty. Under 'partial' the missing rows are
 * the later ones — the exact ones a next-term run would collide with — so this
 * is the status where a warning would be least use and the collision most
 * likely.
 *
 * Sentence case: it goes under a heading or into an alert body, not on a label.
 */
export function duplicateBlocker(status: LoadStatus): string | null {
  if (status === 'loading') {
    return 'Still reading your timetable. Adding classes now could put a second copy of one that is already scheduled, because this screen has not seen the whole schedule yet.';
  }
  if (status === 'partial') {
    return 'Your timetable came back at its row limit, so the classes furthest ahead are the ones missing from this screen — and those are exactly the ones a repeat would land on top of. Nothing is added until the whole schedule can be read.';
  }
  if (status === 'error') {
    return 'Your timetable could not be read, so there is no way to tell which slots are already taken. An empty schedule here means the read failed, not that the week is free.';
  }
  return null;
}

/**
 * What the coach reads before the writes go out.
 *
 * Not a warning — nothing here is destructive, and dressing an ordinary
 * scheduling action as a hazard is how a coach learns to tap through the
 * dialogs that matter. It is a description, and the two numbers in it are the
 * ones a coach would otherwise find out by counting rows afterwards: how many
 * classes go on the timetable, and how many were skipped because they are
 * already there.
 */
export interface DuplicateBrief {
  title: string;
  body: string;
  /** Title Case, carrying the count. */
  confirmLabel: string;
  /** False when there is nothing to write — the caller shows the body and no
   *  confirm. */
  canWrite: boolean;
}

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'a date that could not be read';
  return d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
};

export function duplicateBrief(plan: DuplicatePlan): DuplicateBrief {
  const n = plan.toWrite.length;
  const { title } = plan.shape;

  if (plan.lastAt == null) {
    return {
      title: 'Nothing To Repeat',
      body: `No date on this class could be read, so there is no last occurrence to count forward from.`,
      confirmLabel: 'OK',
      canWrite: false,
    };
  }

  if (n === 0) {
    return {
      title: 'Nothing Left To Add',
      body: plan.inPast > 0
        ? `“${title}” last ran on ${dayLabel(plan.lastAt)}, and every one of the ${num(plan.inPast)} dates this would add falls before today. A class in the past is on nobody’s timetable and cannot be booked, so nothing is written. Ask for more weeks, or add the next one from the form above.`
        : `There is nothing to add. “${title}” runs until ${dayLabel(plan.lastAt)}.`,
      confirmLabel: 'OK',
      canWrite: false,
    };
  }

  const first = plan.toWrite[0].startsAt;
  const last = plan.toWrite[n - 1].startsAt;
  const skipped = plan.inPast > 0
    ? ` ${num(plan.inPast)} of the dates in that run ${plan.inPast === 1 ? 'falls' : 'fall'} before today and ${plan.inPast === 1 ? 'is' : 'are'} skipped — a class in the past is on nobody’s timetable.`
    : '';

  return {
    title: n === 1 ? 'Add One More?' : `Add ${num(n)} More?`,
    body:
      `“${title}” carries on weekly from ${dayLabel(first)} to ${dayLabel(last)}, at the same time, in the same room, `
      + `with the same instructor and the same capacity as the one you tapped.${skipped}\n\n`
      + `Members book each one separately, and nothing is booked for anybody by adding them.`,
    confirmLabel: n === 1 ? 'Add It' : `Add ${num(n)}`,
    canWrite: true,
  };
}

/**
 * What to say once the writes come back.
 *
 * The same discipline `bulkReport` keeps and for the same reason: `addClass`
 * resolves false when the insert never reached `gym_classes`, and a class that
 * exists on the coach's phone alone is on nobody's timetable and cannot be
 * booked. "Added" over a partial run is the sentence that puts a coach in an
 * empty room.
 */
export function duplicateOutcome(title: string, wanted: number, saved: number): { title: string; body: string } {
  if (wanted === 0) return { title: 'Nothing Added', body: 'There was nothing to write.' };
  if (saved === wanted) {
    return {
      title: wanted === 1 ? 'Added' : 'Added To Your Timetable',
      body: `${num(wanted)} more ${wanted === 1 ? 'class' : 'classes'} of “${title}”. Members can book ${wanted === 1 ? 'it' : 'them'} now.`,
    };
  }
  if (saved === 0) {
    return {
      title: 'Not On The Timetable',
      body: `None of the ${num(wanted)} classes reached the server, so they are on this phone only and nobody can book them. They will be gone when you reopen the app — try again once you have signal.`,
    };
  }
  return {
    title: 'Partly Added',
    body: `${num(saved)} of ${num(wanted)} reached the server. The other ${num(wanted - saved)} are on this phone only and cannot be booked. Repeating once you have signal counts forward from the last class that actually landed, so the missing weeks are added rather than the whole run again.`,
  };
}
