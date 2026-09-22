// The classes the SERVER says are this member's, whichever gym ran them.
//
// ── what was wrong ────────────────────────────────────────────────────────
//
// `my_class_history()` was written for exactly this screen and has never been
// called by one. supabase/parts/136-a-member-can-see-that-they-turned-up.sql
// defines it, and it appears in precisely one place: the USING clause of
// `gym_classes_mine_r`, at 136:164. No screen, no hook and no module named it.
//
// app/(client)/attendance.tsx assembles the member's history from
// `class_bookings` and `gym_visits` directly, and then explains the classes it
// could not open like this:
//
//     "Some of these are classes this app could not open — usually because they
//      were run by a gym you are no longer with."
//
// That sentence is a GUESS, and since part 136 it is the wrong guess. The whole
// point of `gym_classes_mine_r` is that a member may now read a class they
// booked or visited "whichever gym it belongs to" — the policy's own comment
// says the old behaviour was that "a member who changes gyms kept their
// bookings and visits and lost every class those rows point at", in the past
// tense, because 136 is what stopped it. A class the member cannot open today
// is therefore NOT usually a gym they have left. It is a class row the gym has
// since deleted, or a read that was refused.
//
// So the screen is telling somebody a reason that is no longer true about their
// own record, and the function that can replace the guess with a check has been
// sitting unused since it was written.
//
// ── what this is for ──────────────────────────────────────────────────────
//
// One question: "does the server agree this class is mine?" `my_class_history()`
// is `security definer` over `class_bookings` and `gym_visits` for `auth.uid()`,
// so it answers without the RLS scoping that made the old sentence true, and it
// answers for every gym at once. Two things follow that the screen could not
// previously say:
//
//   · A class in the timeline that would not open, and whose id the server
//     hands back, is the member's class and is gone. That is a different
//     sentence from "you left that gym", and it is the true one.
//   · A class the server hands back that is on the timeline NOWHERE is a class
//     this device did not read at all — the bookings or the visits read stopped
//     at the row cap, or was refused. The screen's `status` says the READ was
//     partial; this says how much of the record is missing from what is on
//     screen, which is the figure a member can actually judge.
//
// What it is deliberately NOT: a second source of classes to render. It returns
// ids and nothing else — no title, no date, no gym — and a row built from an id
// alone would be exactly the guessed event rule 3 in src/lib/attendance.ts
// forbids.
//
// Framework-agnostic like src/lib/attendance.ts: the Supabase client arrives as
// an argument, so every branch is testable without a database.
import { capLimit, capped } from './rowCap';
import type { Read } from './attendance';

/** The bit of supabase-js this needs. Narrow on purpose. */
type Rpcable = { rpc: (fn: string, args?: unknown) => any };

/** What the server holds, and whether that is all of it. */
export interface ClassHistory {
  /** Every class id the member has a booking for or a recorded visit to. */
  ids: string[];
  /** True when the read came back at the row cap, so `ids` is a PREFIX. No
   *  figure may be computed from a truncated set — src/lib/rowCap.ts. */
  truncated: boolean;
}

/**
 * A uuid out of whatever PostgREST hands back for `returns setof uuid`.
 *
 * A set-returning function over a scalar type comes back as a bare JSON array
 * of strings. Some client and server versions wrap each row in an object keyed
 * by the function name instead, and the difference is invisible until it is in
 * production: the wrapped shape read as an array of strings yields a list of
 * `undefined`, which would make every class look absent from the member's own
 * history and put the wrong sentence under all of them. Both are read.
 */
function idOf(row: unknown): string | null {
  if (typeof row === 'string') return row.trim() || null;
  if (row && typeof row === 'object') {
    for (const v of Object.values(row as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * The class ids the server says are this member's.
 *
 * `{ ok: false }` and never an empty array on failure, the shape
 * src/lib/attendance.ts uses: a refused read that returned `[]` would make
 * every class on the timeline look like one the server does not recognise,
 * which is the most alarming thing this screen could say and would be false.
 *
 * Capped and reported like every other read here. PostgREST applies its
 * thousand-row ceiling to a set-returning function exactly as it does to a
 * table, so a member with more classes than that gets a prefix with no error —
 * and a count taken off a prefix is the subtotal-as-total defect
 * src/lib/rowCap.ts exists for.
 */
export async function fetchMyClassHistory(sb: Rpcable): Promise<Read<ClassHistory>> {
  try {
    const { data, error } = await sb.rpc('my_class_history').limit(capLimit());
    if (error) return { ok: false, reason: (error as any)?.message || 'The read was refused.' };
    const page = capped(((data as unknown[]) ?? []));
    const ids = page.rows.map(idOf).filter((x): x is string => x != null);
    return { ok: true, value: { ids, truncated: page.truncated } };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'The read failed.' };
  }
}

/**
 * Classes the server holds that this screen has put nowhere.
 *
 * `shown` is every class id the timeline accounts for, including the ones drawn
 * as "a class we could not read" and the undated ones — an event with no title
 * is still an event the member can see, and counting it as missing would
 * double-report it.
 *
 * Pure, and it deliberately does not care WHY: a class id here means only that
 * the server says it is the member's and that nothing on screen represents it.
 * The two causes — a truncated read of the bookings or visits, and one that was
 * refused — are already distinguished by the screen's own `status`.
 */
export function classesNotShown(history: readonly string[], shown: readonly string[]): string[] {
  const seen = new Set(shown);
  const out: string[] = [];
  for (const id of history) {
    if (seen.has(id) || !id) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Why a class on the timeline would not open, in the words the record supports.
 *
 * `unopened` is how many events hold no class row. `confirmedMine` is how many
 * of those the server handed back from `my_class_history()`.
 *
 * Three answers, and the point of the function is that they are three:
 *
 *   · We could not ask. The old guess is not repeated — an unchecked reason is
 *     worse than none — so it says only what is certainly true: the attendance
 *     is the member's, the class details are missing.
 *   · The server agrees every one of them is theirs. Then the class record
 *     itself is gone, which is a fact about the gym's timetable and not about
 *     the member, and is worth saying plainly so nobody goes to reception
 *     asking about a membership they never lost.
 *   · Some are not in the server's set at all. That is the only case in which
 *     the reason genuinely IS about access, and it is the only case in which
 *     this says so.
 *
 * Null when there is nothing to explain, so a caller cannot render an empty
 * caption.
 */
export function unopenedClassesLine(unopened: number, confirmedMine: number | null): string | null {
  if (!Number.isFinite(unopened) || unopened <= 0) return null;
  if (confirmedMine == null) {
    return 'Some of these are classes this app could not open, so their title, time and instructor are missing. The attendance itself is still yours and is counted.';
  }
  if (confirmedMine >= unopened) {
    return 'Some of these are classes your gym has since removed from its own timetable, so there is no title or time left to show. Your attendance at them is still on record here and is still counted.';
  }
  return 'Some of these are classes this app is not allowed to open, so their details are missing. The attendance is still yours; only the class itself is out of reach.';
}

/**
 * The classes the server holds and this screen is not showing at all.
 *
 * Said rather than left implicit, because the alternative is a member reading
 * "Every visit · 412" as their whole record when the server knows about more.
 * The screen's `status` already says the READ was partial; this says how much,
 * which is the part a person can act on.
 *
 * `truncated` is carried because the figure itself is then a floor rather than
 * a total, and this is a screen that refuses to state a total it cannot stand
 * behind — see the note on `rhythm.perWeek`.
 */
export function missingClassesLine(missing: number, truncated: boolean): string | null {
  if (!Number.isFinite(missing) || missing <= 0) return null;
  const n = Math.round(missing);
  const count = truncated
    ? `at least ${n} more ${n === 1 ? 'class' : 'classes'}`
    : `${n} more ${n === 1 ? 'class' : 'classes'}`;
  return `Your gym record holds ${count} that this list does not show. The read did not bring back all of it. Pull down to try again; nothing here is missing from your record itself.`;
}
