// ── What actually generates the daily checklist ──────────────────────────────
//
// TF-31 asked the question, and until now the honest answer was "nothing". The
// list was a five-item constant compiled into the app: the same "10,000 steps"
// and "Sleep 7h+" for every client on the platform, numbers nobody had set and
// no plan referred to. A client eating 1,450 kcal and a client eating 3,200 saw
// the identical row "Protein target", which never said what the target was, so
// the one line on the list that WAS about their plan still could not be acted
// on without leaving the screen.
//
// This builds the list from the figures the app already holds for this person:
// their macro targets (with their coach's adjustment already layered on), their
// hydration goal, the day their training plan schedules for today, and whatever
// their coach has put on their list directly.
//
// ── The rule that shapes every line below ───────────────────────────────────
//
// A target the app does not have is not a checklist item. Not a default, and
// especially not a plausible-looking one: "10,000 steps" was a bug rather than
// a nice touch precisely because it reads as the client's own goal. So every
// figure below arrives nullable and a null produces NO ROW. `gaps` carries what
// is missing and what the client can do about it — a sentence about an absent
// target is a different statement from a line they are being asked to tick.
//
// Steps and sleep were the sharp end of that. For a while they produced
// nothing at all — no row AND no note — because there was no step goal or sleep
// goal anywhere in the product, and "set a step goal" pointing at a screen that
// did not exist is its own small lie. `clients.step_goal` and
// `clients.sleep_goal_hours` exist now (part 60) and the Daily habits screen
// sets them, so the note has somewhere to send people and is emitted again.
//
// Water was the one that got away. It kept its row throughout, because the
// caller had a number to pass — `const waterGoal = 8`, a platform constant, the
// same eight glasses for everybody. It reads exactly like the client's own
// target on this list, which is what made it worse than a missing row rather
// than better. `clients.water_goal_glasses` (part 70) replaces it, and it
// follows the same rule as the other two: null in, no row, one note.
//
// ── Ids are storage keys, not labels ────────────────────────────────────────
//
// A tick is a row in `habit_logs` keyed (user_id, habit, done_on), so the id is
// the only thing tying today's tick to yesterday's. Every id here is derived
// from WHAT the item is and never from its wording or its position: a coach
// renaming "Walk the dog" to "Walk Bella" keeps the history, and reordering the
// list moves nothing. It is also why a coach item is keyed on its row's uuid
// rather than its index in an array — an index reattaches yesterday's tick to
// whichever item happens to have slid into that slot.
import type { ProgramDay } from './programs';

/** Where a line came from, so a screen can say so without guessing. */
export type ChecklistSource = 'targets' | 'plan' | 'coach';

export interface ChecklistItem {
  id: string;
  label: string;
  icon: string;
  source: ChecklistSource;
}

/** A target the app does not have, and the thing the client can do about it.
 *  Only produced where there is somewhere to go — see the header on steps. */
export interface ChecklistGap { id: string; note: string }

/** One row of `coach_checklist_items`, as the client's app reads it. */
export interface CoachChecklistItem { id: string; label: string; icon?: string | null }

export interface ChecklistInput {
  /** `clients.water_goal_glasses`, in glasses/day. Same rule as steps and
   *  sleep: null is the normal state for a client who has not set one, and it
   *  produces a note rather than a row. It used to arrive as a constant 8 from
   *  every caller, which is why this is the one target that has always had a
   *  row and has never had a note. */
  waterGoalGlasses: number | null;
  /** Grams, from macrosFor() + the coach's adjustment. Null when there is no
   *  weight and body-fat to compute from — the macro engine needs both. */
  proteinTargetG: number | null;
  /** Same source, same null. */
  kcalTarget: number | null;
  /** `clients.step_goal`. Null means the client has not set one — which is the
   *  normal state, not an error, and produces a gap note rather than a row. */
  stepGoal: number | null;
  /** `clients.sleep_goal_hours`. Same rule. */
  sleepGoalHours: number | null;
  /** The focus of the plan day scheduled for today ('Push', 'Full body A'), or
   *  null when today is not a training day. Not "the nearest day" — see
   *  scheduledFocus. */
  todaysTrainingFocus: string | null;
  coachItems: readonly CoachChecklistItem[];
}

export interface Checklist { items: ChecklistItem[]; gaps: ChecklistGap[] }

/** Coach items live in the same id space as the derived ones, so they are
 *  namespaced. Nothing else may start with this. */
export const COACH_ID_PREFIX = 'coach:';

export function coachHabitId(rowId: string): string { return COACH_ID_PREFIX + rowId; }

// Thousands separators without toLocaleString. The label is compared in tests
// and rendered on devices in every locale the app ships to; a separator that
// changes underneath both is a difference nobody asked for.
function thousands(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (n < 0 ? '-' : '') + out;
}

// A number that came out of a division, a null column or a half-finished form
// is not a target. Anything non-finite or non-positive means "not set", which
// is the same answer as absent.
function target(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

const DAY_TO_WEEKDAY: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * The focus of the plan day that falls on `weekday` (0 Sun … 6 Sat), or null.
 *
 * Deliberately an exact match. The home screen picks today's session with
 * `days[mondayIndex % days.length]` and programs.todayIndex picks the NEAREST
 * day, both of which always return something — so a three-day Mon/Wed/Fri plan
 * yields a "session for today" on all seven days of the week. That is tolerable
 * on a screen that is showing you what is coming up; it is not tolerable on a
 * checklist, where it becomes a line telling somebody they owe a leg session on
 * a Sunday their plan gives them off. No scheduled day means no row, which is
 * the truth about a rest day.
 */
export function scheduledFocus(
  days: readonly Pick<ProgramDay, 'day' | 'focus'>[],
  weekday: number,
): string | null {
  for (const d of days) {
    const key = String(d.day || '').trim().slice(0, 3).toLowerCase();
    if (DAY_TO_WEEKDAY[key] === weekday) {
      const focus = String(d.focus || '').trim();
      return focus || null;
    }
  }
  return null;
}

/**
 * Today's checklist for one client.
 *
 * Order is deliberate: the plan first (it is the reason they opened the app),
 * then the day's targets, then anything the coach added. Coach items go last
 * because they are additions to a plan, not replacements for it — and because a
 * coach with five items should not push the client's own macro target off the
 * fold.
 */
export function buildChecklist(input: ChecklistInput): Checklist {
  const items: ChecklistItem[] = [];
  const gaps: ChecklistGap[] = [];

  const focus = (input.todaysTrainingFocus || '').trim();
  if (focus) items.push({ id: 'train', label: `Train — ${focus}`, icon: '🏋️', source: 'plan' });

  const kcal = target(input.kcalTarget);
  if (kcal != null) items.push({ id: 'kcal', label: `Eat to your ${thousands(kcal)} kcal target`, icon: '🔥', source: 'targets' });

  const protein = target(input.proteinTargetG);
  if (protein != null) items.push({ id: 'protein', label: `Hit ${thousands(protein)} g protein`, icon: '🍗', source: 'targets' });

  // Both come out of the same calculation, so they are missing together and one
  // note covers them. Worth saying because the client CAN fix it: weight and
  // body fat are on their profile, and a scan fills both in.
  if (kcal == null && protein == null) {
    gaps.push({ id: 'macros', note: 'Add your weight and body fat — your calorie and protein targets are worked out from them.' });
  }

  const water = target(input.waterGoalGlasses);
  if (water != null) items.push({ id: 'water', label: `Drink ${thousands(water)} glasses of water`, icon: '💧', source: 'targets' });
  // Its own note, for the same reason steps and sleep have separate ones: the
  // three are set independently, and the client can set this one on the screen
  // that shows the note.
  else gaps.push({ id: 'water', note: 'Set a water goal below and your glasses count towards it.' });

  const steps = target(input.stepGoal);
  if (steps != null) items.push({ id: 'steps', label: `Walk ${thousands(steps)} steps`, icon: '👟', source: 'targets' });
  // Separate notes, not one covering both, because they are set independently:
  // telling somebody who has a step goal that they need a step goal is the sort
  // of thing that teaches people to stop reading these.
  else gaps.push({ id: 'steps', note: 'Set a step goal below and it joins your list.' });

  const sleep = target(input.sleepGoalHours);
  // One decimal at most, and no trailing '.0' — "Sleep 7.5h+" and "Sleep 8h+".
  if (sleep != null) items.push({ id: 'sleep', label: `Sleep ${(Math.round(sleep * 10) / 10)}h+`, icon: '😴', source: 'targets' });
  else gaps.push({ id: 'sleep', note: 'Set a sleep goal below to track it here.' });

  const seen = new Set(items.map((i) => i.id));
  for (const c of input.coachItems) {
    const label = String(c.label || '').trim();
    const id = coachHabitId(String(c.id || '').trim());
    // A blank label is a row a coach started and abandoned; rendering it gives
    // the client an unlabelled circle to tick. A duplicate id would give two
    // rows that tick each other, because both write the same habit_logs key.
    if (!label || id === COACH_ID_PREFIX || seen.has(id)) continue;
    seen.add(id);
    const icon = String(c.icon || '').trim();
    items.push({ id, label, icon: icon || '📌', source: 'coach' });
  }

  return { items, gaps };
}

/**
 * The percentage for the hero figure, or null when there is nothing to show.
 *
 * `doneCount / items.length` divided by zero the moment the list stopped being
 * a constant of five, and the screen rendered the result straight into the one
 * big number: "NaN%", over an arc drawn from NaN. Null is the honest answer for
 * an empty list and the caller shows a dash for it.
 */
export function donePercent(doneCount: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const pct = (doneCount / total) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(Math.max(0, Math.min(100, pct)));
}
