/**
 * THE PLAN AND THE RECORD, SIDE BY SIDE — and the four claims this refuses to
 * make.
 *
 * A coach has had both halves of this since the day the coach app shipped and
 * has never once been shown them together. `assigned_programs` says what was
 * prescribed. `workouts` says what was done. They are two independent read
 * surfaces on two different screens and the reconciliation is performed by a
 * human being with a thumb, scrolling between them.
 *
 * The sentence that changes next week's programme — "they got through the upper
 * days and dropped every leg day" — is arithmetic over those two tables and
 * nothing in this app has ever done it.
 *
 * ── The four things this module will not say, and why ─────────────────────
 *
 * 1. IT WILL NOT SAY A SESSION WAS COMPLETED. A logged set carries no reference
 *    to a plan row: `workouts` is `(user_id, performed_at, exercise, sets)` and
 *    there is no programme id, no day index and no set index on it. Nothing
 *    connects a squat somebody logged to the squat somebody prescribed except
 *    the NAME, matched by `exerciseSlug`. So "they did the Monday session" is
 *    not a fact this data supports; "the four movements Monday prescribes were
 *    all logged in the window" is, and that is what `DayCoverage` says.
 *
 * 2. IT WILL NOT ATTRIBUTE WORK TO A NAMED WEEKDAY. `workouts.performed_at` is
 *    a timestamptz — an instant — and there is NO CLIENT TIMEZONE COLUMN
 *    anywhere in this schema. Deciding whether a set landed on the client's
 *    Tuesday requires their zone. src/lib/coachWeek.ts and
 *    app/(trainer)/client-week.tsx already refuse to state a tick or a
 *    percentage for exactly this reason, and that refusal is right and is kept
 *    here without weakening. This module therefore works over a WINDOW OF DAYS,
 *    never over a named day, and `WINDOW_IS_NOT_A_WEEKDAY` is the sentence it
 *    hands the screen to say so.
 *
 * 3. IT WILL NOT PRODUCE A PERCENTAGE. "68% adherence" is a single number that
 *    hides every one of the caveats above, and the moment it exists it is the
 *    only thing anybody reads. Coverage is reported as counts of movements with
 *    the movements themselves listed, so a coach who disagrees can point at the
 *    row they disagree about — the same discipline src/lib/programReview.ts
 *    applies to its findings.
 *
 * 4. IT WILL NOT SAY "NOT DONE" OVER A READ THAT WAS NOT WHOLE. A movement
 *    absent from a truncated log may simply be a movement past the row cap.
 *    `Coverage` is a TRI-STATE — 'logged' | 'not-logged' | 'unknown' — and
 *    'not-logged' is produced only when the read genuinely covered the window.
 *    Under a capped read that means comparing the window against the oldest row
 *    that came back, which is why `oldestDay` is an input rather than something
 *    guessed.
 *
 * ── What it does say ──────────────────────────────────────────────────────
 *
 * Per prescribed movement: was it logged in the window, when last, how many
 * separate days it was logged on, and the heaviest set logged against the load
 * the coach wrote. Per prescribed day: how many of its movements that is. And
 * separately, the movements the client logged that the programme does not
 * contain — which is the other half of the conversation and the half a coach
 * currently has no way to see at all.
 *
 * Pure and framework-free, so its assertions run under the three timezones the
 * repo tests in.
 */
import type { Program, ProgramDay } from './programs';
import { exerciseSlug } from './exerciseId';
import { expandSets } from './setRows';
import { countsToVolume } from './setMethods';
import type { WorkoutEntry } from './mockData';
import { dayKeyOf } from './entryEdit';
import { type LoadStatus } from '../ui/loadStatus';

/**
 * How far back the comparison looks, in days.
 *
 * Twenty-eight, and the number is argued rather than picked. A week is too
 * short: a client who trains Monday and Thursday and is read on a Wednesday has
 * had five days, and a movement they do fortnightly would read as dropped. A
 * quarter is too long: a movement logged eleven weeks ago is not evidence about
 * the block they are on now, and a coach reading "logged" would be reassured
 * about a session that happened before this programme was written.
 *
 * Four weeks is also the longest block most of the coaches on this platform
 * write, so the window is the same order of magnitude as the thing it is
 * measuring. It is exported so a screen can offer another and so the assertions
 * can name it rather than repeating 28.
 */
export const WINDOW_DAYS = 28;

/**
 * THE SENTENCE. What a window is and what a weekday would have been.
 *
 * Written once so that the day this schema grows a client timezone column there
 * is one string to delete and one grep that finds every screen that promised a
 * window rather than a day. A phrase composed at each call site would leave
 * three of them still hedging a year after the hedge stopped being necessary —
 * and, worse, would let a fourth screen quietly not hedge at all.
 */
export const WINDOW_IS_NOT_A_WEEKDAY =
  'Matched over a window of days, never against a named weekday. A logged set is stored as an instant '
  + "and this app holds no timezone for the client, so nothing here can say a Tuesday session happened on their Tuesday. "
  + 'It can say the movement was logged, and when.';

/** Whether the record answers for a prescribed movement.
 *
 *   'logged'     it appears in the log inside the window.
 *   'not-logged' the read covered the window and it does not appear. A claim
 *                about the client, and only made when it is one.
 *   'unknown'    the read did not cover the window — it failed, it is still in
 *                flight, or it came back at the row cap before reaching that far
 *                back. NOT the same as 'not-logged' and never rendered as it. */
export type Coverage = 'logged' | 'not-logged' | 'unknown';

/** One prescribed movement, against the record. */
export interface MovementCheck {
  /** The movement spelled as the COACH wrote it, which is what a screen prints.
   *  The slug is the join key and is never shown. */
  name: string;
  slug: string;
  coverage: Coverage;
  /** `YYYY-MM-DD` it was last logged, in the reader's own zone; null when it
   *  was not, or when no entry for it carried a readable timestamp. */
  lastDay: string | null;
  /** Distinct days inside the window it was logged on. Zero under 'not-logged',
   *  and zero under 'unknown' too — where it is not a count of anything and a
   *  screen must not print it. `coverage` is what gates that. */
  daysLogged: number;
  /** The load the coach wrote for this movement, in KILOGRAMS, taken from the
   *  heaviest working set of its plan — a ramp's top set, not its warm-up.
   *  Null where the plan names no load, which is the ordinary case for
   *  bodyweight work and for a movement the coach left to the client's judgement. */
  plannedTopKg: number | null;
  /** The heaviest load LOGGED against it in the window, in kilograms; null when
   *  nothing in the window carried one. Never 0 — a bodyweight session has no
   *  load to report, which is an absent measurement rather than a measurement
   *  of nothing. */
  loggedTopKg: number | null;
}

/** One prescribed day, against the record. */
export interface DayCoverage {
  /** The day as the coach named it — 'Mon', 'Day 1'. A LABEL, and explicitly
   *  not a claim that anything happened on that weekday: see refusal 2. */
  day: string;
  focus: string;
  movements: MovementCheck[];
  /** Movements with coverage 'logged'. */
  logged: number;
  /** Movements the read can state were NOT logged. */
  notLogged: number;
  /** Movements the read cannot answer for. Non-zero means the two counts above
   *  do not add up to the day and a screen must say so rather than letting the
   *  reader assume the remainder was skipped. */
  unknown: number;
}

export interface PlanVsActual {
  /** 'unreadable' when nothing below is a fact about this client — either read
   *  failed, or there is no programme to compare against. */
  state: 'unreadable' | 'no-programme' | 'ready';
  days: DayCoverage[];
  /** Every prescribed movement across the whole week, de-duplicated by slug —
   *  a squat on Monday and Friday is one movement the client either does or
   *  does not do. */
  movements: MovementCheck[];
  /**
   * Movements LOGGED in the window that the programme does not contain.
   *
   * The other half of the conversation, and the half a coach has had no way to
   * see. A client quietly swapping the prescribed row for a machine they prefer
   * is the single most common reason a block does not do what it was supposed
   * to, and it is invisible from the plan side. Spelled as the CLIENT wrote it,
   * because that is what they typed into their own phone and what the coach
   * should read back to them.
   *
   * Empty under anything but a whole-enough read, and `state` is what says
   * whether it is empty because there were none.
   */
  offPlan: string[];
  /** The first and last day of the window, `YYYY-MM-DD`, in the reader's zone.
   *  Carried so the screen prints the window it actually used rather than
   *  restating a constant that might have been overridden. */
  fromDay: string | null;
  toDay: string | null;
}

const UNREADABLE: PlanVsActual = {
  state: 'unreadable', days: [], movements: [], offPlan: [], fromDay: null, toDay: null,
};

export interface PlanVsActualInput {
  /** The week to compare. For a multi-week block the caller passes the week the
   *  client is standing in — `blockPosition` in src/lib/programStart.ts decides
   *  which, and passes week one when there is no start date to decide from.
   *  Null is a client on no coach-assigned programme, which is a real state. */
  days: readonly ProgramDay[] | null;
  /** How the read of the assignment went. A null `days` under anything but a
   *  landed read is "we did not find out", not "they are on nothing". */
  programStatus: LoadStatus;
  /** The client's logged training. Null under 'error', for the reason
   *  src/lib/clientTraining.ts gives: an empty array must never be able to
   *  arrive here meaning two things. */
  log: readonly WorkoutEntry[] | null;
  logStatus: LoadStatus;
  /** Today, `YYYY-MM-DD`, in the reader's own zone. Passed rather than read
   *  from a clock so every assertion can fix it. */
  todayISO: string;
  /** The oldest day the log read actually reached, `YYYY-MM-DD`, or null when
   *  it is not known.
   *
   *  This is what makes 'not-logged' honest under a capped read. `capped()`
   *  hands back the NEWEST rows up to the cap, so a truncated read still covers
   *  the recent window completely — and refusing to answer at all for it would
   *  withhold a true answer from every client with a long history. Where the
   *  window starts before this day, the answer is 'unknown' for everything. */
  oldestDay?: string | null;
  /** How far back to look. Defaults to `WINDOW_DAYS`. */
  windowDays?: number;
}

/** `YYYY-MM-DD` shifted back by whole days. UTC midnights on both sides, so no
 *  daylight-saving hour lands in the arithmetic and the result is exact. */
function backDays(dayISO: string, n: number): string | null {
  const ms = Date.parse(`${dayISO}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms - n * 86_400_000);
  const p = (x: number) => (x < 10 ? '0' + x : String(x));
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * The heaviest WORKING set a plan names for an exercise, in kilograms.
 *
 * Working, by `countsToVolume` — a warm-up single at 60 and a top set at 120 are
 * both in the table, and reporting the warm-up as what the coach prescribed
 * would make every ramped movement look lighter than it is. The same rule
 * src/lib/programReview.ts applies for the same reason.
 *
 * Null when no working set carries a load. Not 0: an exercise with nothing on
 * the bar is bodyweight work, and a planned top of 0 kg beside a logged 40 kg
 * would render as somebody wildly exceeding a prescription that did not exist.
 */
function plannedTop(ex: Parameters<typeof expandSets>[0]): number | null {
  let top: number | null = null;
  for (const s of expandSets(ex)) {
    if (!countsToVolume(s.method)) continue;
    if (s.loadKg == null || !Number.isFinite(s.loadKg)) continue;
    if (top == null || s.loadKg > top) top = s.loadKg;
  }
  return top;
}

/** What the log holds for one movement inside the window. */
interface LoggedFacts {
  days: Set<string>;
  lastDay: string | null;
  topKg: number | null;
}

export function planVsActual(input: PlanVsActualInput): PlanVsActual {
  const windowDays = Number.isFinite(input.windowDays) && (input.windowDays as number) > 0
    ? Math.floor(input.windowDays as number)
    : WINDOW_DAYS;
  const toDay = input.todayISO;
  const fromDay = backDays(toDay, windowDays - 1);

  // No programme is one of three different answers and only one of them is
  // 'no-programme'. A null under a read that has not landed is "we did not find
  // out what they are on", which is exactly the confusion
  // src/ui/assignedPrograms.tsx exists to prevent.
  if (input.programStatus === 'loading' || input.programStatus === 'error') return UNREADABLE;
  if (!input.days || !input.days.length) {
    return { ...UNREADABLE, state: 'no-programme', fromDay, toDay };
  }

  // Whether the record may be used to say a movement was NOT logged.
  //
  // Three conditions, all of them necessary. The read landed; it was not still
  // in flight; and it reached back at least as far as the window starts. That
  // last one is what lets a truncated read still answer: `capped()` returns the
  // newest rows, so a client with four thousand workouts has their last month
  // read in full and only their 2023 is missing.
  const landed = input.log != null && input.logStatus !== 'error' && input.logStatus !== 'loading';
  const reachesWindow = input.logStatus === 'ready'
    || (input.oldestDay != null && fromDay != null && input.oldestDay <= fromDay);
  const canSayNo = landed && reachesWindow && fromDay != null;

  const facts = new Map<string, LoggedFacts>();
  const offPlanNames = new Map<string, string>();
  for (const e of input.log ?? []) {
    const day = dayKeyOf(e?.t);
    // No readable timestamp means no day, and a movement cannot be placed
    // inside or outside the window without one. Skipped rather than counted:
    // filing it under today would put work inside a window it may predate by a
    // year, which is precisely the invention src/lib/clientTraining.ts refuses
    // when it keeps undated sessions in their own list.
    if (!day || fromDay == null) continue;
    if (day < fromDay || day > toDay) continue;
    const slug = exerciseSlug(e.exercise ?? '');
    if (!slug) continue;
    let f = facts.get(slug);
    if (!f) { f = { days: new Set(), lastDay: null, topKg: null }; facts.set(slug, f); }
    f.days.add(day);
    if (f.lastDay == null || day > f.lastDay) f.lastDay = day;
    for (const set of e.sets ?? []) {
      const reps = typeof set?.[0] === 'number' ? set[0] : 0;
      const load = typeof set?.[1] === 'number' ? set[1] : 0;
      // A load with no rep count behind it is a row somebody tabbed past, not a
      // set. The same test `sessionsOf` uses, so the two screens cannot
      // disagree about what counts as a set.
      if (!(reps > 0) || !(load > 0)) continue;
      if (f.topKg == null || load > f.topKg) f.topKg = load;
    }
    // Spelled as the client typed it. Kept in a map keyed by slug so 'Bench
    // press' and 'Bench Press' are one movement rather than two rows on the
    // coach's screen accusing the client of doing something twice.
    if (!offPlanNames.has(slug)) offPlanNames.set(slug, (e.exercise ?? '').trim());
  }

  const check = (name: string, ex: Parameters<typeof expandSets>[0]): MovementCheck => {
    const slug = exerciseSlug(name);
    const f = slug ? facts.get(slug) : undefined;
    const coverage: Coverage = f ? 'logged' : canSayNo ? 'not-logged' : 'unknown';
    return {
      name: (name ?? '').trim() || 'An unnamed movement',
      slug,
      coverage,
      lastDay: f?.lastDay ?? null,
      daysLogged: f ? f.days.size : 0,
      plannedTopKg: plannedTop(ex),
      loggedTopKg: f?.topKg ?? null,
    };
  };

  const days: DayCoverage[] = [];
  // De-duplicated across the week: a squat on Monday and on Friday is ONE
  // movement the client either does or does not do, and counting it twice would
  // make a two-squat week look like better coverage than a one-squat week for
  // the same behaviour.
  const bySlug = new Map<string, MovementCheck>();
  const planSlugs = new Set<string>();

  for (const d of input.days) {
    const movements: DayCoverage['movements'] = [];
    let logged = 0, notLogged = 0, unknown = 0;
    for (const ex of d.exercises ?? []) {
      const c = check(ex.name ?? '', ex);
      movements.push(c);
      if (c.slug) { planSlugs.add(c.slug); if (!bySlug.has(c.slug)) bySlug.set(c.slug, c); }
      if (c.coverage === 'logged') logged += 1;
      else if (c.coverage === 'not-logged') notLogged += 1;
      else unknown += 1;
    }
    days.push({
      day: (d.day ?? '').trim() || 'An unnamed day',
      focus: (d.focus ?? '').trim(),
      movements, logged, notLogged, unknown,
    });
  }

  // Off-plan is only meaningful when the log read landed. Under an unreadable
  // log the map is empty for the wrong reason, and an empty list rendered under
  // a heading reading "Logged but not prescribed" is a screen saying the client
  // stuck to the plan when it never read what they did.
  const offPlan = landed
    ? [...offPlanNames.entries()].filter(([slug]) => !planSlugs.has(slug)).map(([, name]) => name).filter(Boolean).sort()
    : [];

  return {
    state: 'ready',
    days,
    movements: [...bySlug.values()],
    offPlan,
    fromDay,
    toDay,
  };
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * The one line above the comparison, in sentence case.
 *
 * Counts MOVEMENTS, never sessions and never a percentage, for the reasons at
 * the top of this file. The 'unknown' arm is separate rather than folded into
 * the "not logged" figure, because the difference between "they have not done
 * these" and "we could not tell" is the whole reason this module exists.
 */
export function coverageLine(pva: PlanVsActual, windowDays: number, who: string): string {
  if (pva.state === 'unreadable') {
    return `The programme or the training could not be read, so nothing here compares them. An empty list below is not a statement about ${who}.`;
  }
  if (pva.state === 'no-programme') {
    return `${who} is on no coach-assigned programme, so there is nothing to compare their training against.`;
  }
  const all = pva.movements;
  const logged = all.filter((m) => m.coverage === 'logged').length;
  const unknown = all.filter((m) => m.coverage === 'unknown').length;
  if (!all.length) return 'This programme names no movements, so there is nothing to compare.';
  if (unknown === all.length) {
    // Two different failures land here — the log read was refused, or it came
    // back at the row cap before reaching the start of the window — and both
    // produce the same list of unknowns. The sentence names the read rather
    // than the client either way, because the one thing a coach must not take
    // from an empty comparison is that their client did none of it.
    return `Their logged training could not be read back over the last ${windowDays} days, so none of these ${all.length} `
      + `movement${all.length === 1 ? '' : 's'} can be answered for. That is about the read, and it is not a statement about ${who}.`;
  }
  const head = `${logged} of ${all.length} prescribed movement${s(all.length)} logged in the last ${windowDays} days.`;
  const tail = unknown ? ` ${unknown} of them cannot be answered for — the read did not cover the whole window.` : '';
  const off = pva.offPlan.length
    ? ` ${pva.offPlan.length} movement${s(pva.offPlan.length)} logged that this programme does not name.`
    : '';
  return head + tail + off;
}

/* ── the load, not just the presence ───────────────────────────────────────
 *
 * P5. Everything above compares PRESENCE: which prescribed movements appear in
 * the log at all. That is not the sentence that changes next week's programme.
 * "They did four of six sessions" tells a coach almost nothing; "they hit every
 * prescribed load on upper and missed every one on legs" tells them what to
 * write.
 *
 * Both halves have been on the `MovementCheck` since it was built —
 * `plannedTopKg` is the heaviest WORKING set the coach wrote, `loggedTopKg` is
 * the heaviest the client actually put on the bar inside the window — and
 * nothing has ever joined them.
 *
 * ── What this refuses ─────────────────────────────────────────────────────
 *
 * It does not produce an adherence figure over load, for the reason refusal 3
 * at the top of this file gives about percentages. It reports one verdict per
 * movement, with both numbers beside it, so a coach who disagrees can point at
 * the row.
 *
 * It does not compare a top set against a top set where the plan names no
 * load. A prescription of "3×10, choose your own" met at 40 kg is not somebody
 * exceeding anything, and `plannedTopKg` is null rather than 0 precisely so
 * this cannot be read as a target of nothing.
 */

/**
 * How close the heaviest logged set came to the heaviest prescribed one.
 *
 *   'no-plan'     the plan names no load for this movement. Bodyweight work,
 *                 and work the coach left to the client's judgement.
 *   'not-logged'  there is a prescribed load and nothing in the window carried
 *                 one to compare it against. NOT "they lifted nothing" — see
 *                 `MovementCheck.coverage`, which says whether the movement was
 *                 logged at all.
 *   'at'          within `LOAD_TOLERANCE`. The prescription was carried out.
 *   'under'       below it by more than the tolerance.
 *   'over'        above it by more than the tolerance. Reported rather than
 *                 congratulated: a client 20 kg over a prescribed top set is
 *                 either stronger than the block assumes or is doing something
 *                 the coach did not ask for, and both are worth a look.
 */
export type LoadVerdict = 'no-plan' | 'not-logged' | 'at' | 'under' | 'over';

/**
 * What counts as having hit the number.
 *
 * The smallest pair of plates on most racks is 1.25 kg a side, so the finest
 * adjustment a client can actually make to a barbell is 2.5 kg. Against a
 * prescribed 100 that is 2.5%, and a client who racked 97.5 carried out the
 * instruction — calling that a miss would fill a coach's screen with rows
 * about the plate rack rather than about the training. A FRACTION and not a
 * fixed kilogram, because 2.5 kg off a prescribed 20 kg accessory is an eighth
 * of the load and is a different fact entirely.
 */
export const LOAD_TOLERANCE = 0.025;

export interface LoadCheck {
  verdict: LoadVerdict;
  /** Kilograms, as the plan and the log hold them. The screen converts. */
  plannedKg: number | null;
  loggedKg: number | null;
  /** Logged minus prescribed, in kilograms. Negative is short. Null unless both
   *  numbers exist — a gap against an absent prescription is not a gap. */
  gapKg: number | null;
}

/** One movement's load, judged. Pure, and takes the check rather than the whole
 *  board so a screen can call it per row. */
export function loadCheck(m: MovementCheck): LoadCheck {
  const planned = Number.isFinite(m.plannedTopKg as number) && (m.plannedTopKg as number) > 0
    ? (m.plannedTopKg as number) : null;
  const logged = Number.isFinite(m.loggedTopKg as number) && (m.loggedTopKg as number) > 0
    ? (m.loggedTopKg as number) : null;
  if (planned == null) return { verdict: 'no-plan', plannedKg: null, loggedKg: logged, gapKg: null };
  if (logged == null) return { verdict: 'not-logged', plannedKg: planned, loggedKg: null, gapKg: null };
  const gap = logged - planned;
  const tol = planned * LOAD_TOLERANCE;
  const verdict: LoadVerdict = Math.abs(gap) <= tol ? 'at' : gap < 0 ? 'under' : 'over';
  return { verdict, plannedKg: planned, loggedKg: logged, gapKg: gap };
}

export interface LoadTally {
  /** Movements with a prescribed load that could be compared at all. */
  compared: number;
  at: number;
  under: number;
  over: number;
  /** Prescribed a load, nothing logged against it in the window. */
  notLogged: number;
  /** No load prescribed, so nothing to compare. */
  noPlan: number;
}

/**
 * The tally over a set of movements — a whole week, or one prescribed day.
 *
 * Counts and nothing else. There is no rate here for the same reason there is
 * no coverage percentage: the moment "78% of prescribed loads hit" exists it is
 * the only thing anybody reads, and it hides that half the movements had no
 * prescribed load at all.
 */
export function loadTally(movements: readonly MovementCheck[]): LoadTally {
  const out: LoadTally = { compared: 0, at: 0, under: 0, over: 0, notLogged: 0, noPlan: 0 };
  for (const m of movements) {
    const c = loadCheck(m);
    switch (c.verdict) {
      case 'no-plan': out.noPlan++; break;
      case 'not-logged': out.notLogged++; break;
      case 'at': out.at++; out.compared++; break;
      case 'under': out.under++; out.compared++; break;
      case 'over': out.over++; out.compared++; break;
    }
  }
  return out;
}

/**
 * The sentence above the rows, or null when there is nothing load-shaped to
 * say.
 *
 * Null rather than "0 movements carried a prescribed load", because a block
 * written in reps and RPE alone is an ordinary block and a line apologising for
 * it every time the screen opens is furniture.
 */
export function loadLine(tally: LoadTally, who: string): string | null {
  if (tally.compared === 0 && tally.notLogged === 0) return null;
  if (tally.compared === 0) {
    return `${tally.notLogged} prescribed movement${tally.notLogged === 1 ? ' names a load' : 's name a load'} `
      + `and nothing logged in the window carried one, so there is nothing to compare ${who} against.`;
  }
  const parts: string[] = [];
  if (tally.at) parts.push(`${tally.at} at the prescribed load`);
  if (tally.under) parts.push(`${tally.under} under it`);
  if (tally.over) parts.push(`${tally.over} over it`);
  let out = `Of ${tally.compared} movement${tally.compared === 1 ? '' : 's'} that could be compared on load: ${parts.join(', ')}.`;
  if (tally.notLogged) {
    out += ` ${tally.notLogged} more name${tally.notLogged === 1 ? 's' : ''} a load that nothing in the window carried.`;
  }
  if (tally.noPlan) {
    out += ` ${tally.noPlan} name${tally.noPlan === 1 ? 's' : ''} no load at all, which is ordinary and is not a gap.`;
  }
  return out;
}
