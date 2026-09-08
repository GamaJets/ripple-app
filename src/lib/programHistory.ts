/**
 * WHAT THEY WERE ON BEFORE — the blocks a reassign used to destroy.
 *
 * `assigned_programs` is one row per client and an assign is an upsert over it,
 * so until supabase/parts/176-the-programme-that-was-there-before.sql there was
 * no copy of the spring block anywhere once the summer block landed. That part
 * adds the table and the trigger; this file is everything a screen may honestly
 * say about what it holds.
 *
 * ── The one shape this module refuses to produce ──────────────────────────
 *
 * An empty timeline under a failed read. It is the same refusal the rest of
 * this codebase is built on and it bites harder here than almost anywhere else,
 * because "no earlier programmes" is a sentence a coach ACTS on: they conclude
 * the client is new to them, or that the record was never kept, and they stop
 * looking. `historyBoard` therefore takes the `LoadStatus` and answers
 * 'unreadable' for anything but a landed read, and every count on it is null
 * unless the read was WHOLE — a capped read is a prefix of an unknown set (see
 * src/lib/rowCap.ts) and "4 previous blocks" over a truncated page is a wrong
 * number rather than a small one.
 *
 * ── Why the current programme is part of the timeline ─────────────────────
 *
 * Because a timeline that started at "the one before this one" is a list a
 * coach has to mentally prepend the present to, on the screen where they are
 * deciding what comes next. `historyBoard` takes the live assignment as its own
 * argument and puts it at the top as `current: true`, with its own start date
 * and no end. The two come from different reads that fail independently, so the
 * live one is passed separately and can be present while the history is
 * unreadable — which is the ordinary case on a slow connection and reads
 * correctly: "this is what they are on; what came before could not be read".
 *
 * ── The date arithmetic, and the day it is honest about ───────────────────
 *
 * A history row carries `assigned_at` (when the block was written) and
 * `replaced_at` (when it stopped). Both are instants and are rendered in the
 * READER's zone, which is the coach's device — the same choice
 * `app/(trainer)/client-training.tsx` makes for session times and for the same
 * reason: a coach in London reading a block a coach in Dubai assigned is
 * entitled to their own clock rather than a time matching nothing around them.
 * No figure here is computed across a day boundary, so nothing is wrong by a
 * day; the dates are labels on events, not the input to a count.
 *
 * `assigned_at` may be null — the trigger copies it from `assigned_programs.updated_at`,
 * which was stale on every overwrite made before part 176 fixed it, and a row
 * snapshotted from a repair in the SQL editor may carry nothing. Null is
 * reported as null and rendered as "start not on record", never as the epoch
 * and never as the replacement date, which would make a block that ran three
 * months look like it ran no time at all.
 *
 * Pure and framework-free.
 */
import type { Program } from './programs';
import { weekCount } from './programBlock';
import { type LoadStatus } from '../ui/loadStatus';
import { dayKeyOf } from './entryEdit';

/** Why a programme stopped being what somebody was on. Mirrors the CHECK on
 *  `assigned_program_history.reason`; a value neither of these — from a build
 *  ahead of this one — is carried through as-is and rendered as the generic
 *  sentence rather than dropping the block out of the timeline. */
export type HistoryReason = 'replaced' | 'removed' | (string & {});

/** One row of `assigned_program_history`, as the reader hands it over. */
export interface HistoryRow {
  id: string;
  program: Program | null;
  startsOn: string | null;
  assignedAt: string | null;
  replacedAt: string | null;
  reason: HistoryReason;
}

/** One entry in the timeline a coach reads. */
export interface BlockEntry {
  /** Stable across renders. The history row's id, or the sentinel below for
   *  the live assignment, which has no id of its own — `assigned_programs` is
   *  keyed by client and carries none. */
  key: string;
  /** True for the programme they are on RIGHT NOW. */
  current: boolean;
  program: Program;
  /** The programme's own title, or the fallback. A programme with no title is a
   *  real state — the builder lets a coach clear the field — and a blank
   *  heading reads as a screen that has lost its text. */
  title: string;
  /** How many weeks it is, by `weekCount`. One for every programme written
   *  before multi-week blocks existed, which is what they are. */
  weeks: number;
  /** The coach's own start date, when they set one. */
  startsOn: string | null;
  /** `YYYY-MM-DD` the block was assigned, in the reader's zone; null when the
   *  record does not carry a readable one. */
  fromDay: string | null;
  /** `YYYY-MM-DD` it stopped. Null for the current block, which has not. */
  toDay: string | null;
  /** Whole days it was in force, or null when either end is missing. Never
   *  guessed from one end. */
  ranDays: number | null;
  reason: HistoryReason;
}

/** The key on the live assignment. A literal rather than an empty string, so a
 *  React list cannot collide it with a history row whose id failed to read. */
export const CURRENT_KEY = 'current-assignment';

const titleOf = (p: Program | null | undefined): string =>
  (p?.title ?? '').trim() || 'An untitled programme';

/**
 * Whole days between two day keys, or null.
 *
 * Day keys rather than instants, so a block assigned at 23:50 and replaced at
 * 00:10 the next morning reads as one day rather than as nought — which is what
 * a millisecond division and a floor would give, and it is the difference
 * between "ran a day" and "ran no time at all" on a coach's screen.
 */
function daysBetweenKeys(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // UTC midnights on both sides, so there is no daylight-saving hour in the
  // subtraction and the quotient is exact.
  return Math.round((b - a) / 86_400_000);
}

/** What a screen may say about a client's programme history. */
export interface HistoryBoard {
  /**
   * 'unreadable'  the read failed, was refused, or has not landed. Nothing
   *               below is a fact about this client.
   * 'none'        the read landed and there is no earlier programme. Which is
   *               true of every client on their first block, and of every
   *               client in the app until part 176 shipped — a coach reading
   *               this needs to know the second one, and `historyLine` says it.
   * 'some'        there are earlier blocks.
   */
  state: 'unreadable' | 'none' | 'some';
  /** Newest first, the current assignment at the top when there is one. */
  entries: BlockEntry[];
  /** How many EARLIER blocks there are, or null when the read cannot support a
   *  count. Excludes the current one, because "5 programmes" that silently
   *  includes the one on screen is the sort of off-by-one a coach checks by
   *  counting the list and then stops trusting the screen. */
  earlierCount: number | null;
}

const UNREADABLE: HistoryBoard = { state: 'unreadable', entries: [], earlierCount: null };

/**
 * The timeline.
 *
 * `current` is the live `assigned_programs` programme or null, and
 * `currentStatus` is how THAT read went — separately from `status`, which is
 * how the history read went. Two reads, two statuses, and a null `current`
 * under anything but a landed read means "we did not find out what they are on"
 * rather than "they are on nothing". That distinction is the whole of
 * src/ui/assignedPrograms.tsx's header and it must not be lost on the way here.
 *
 * `rows` null under 'error' for the same reason it is in
 * src/lib/clientTraining.ts: an empty array must never be able to arrive here
 * meaning two things.
 */
export function historyBoard(
  rows: readonly HistoryRow[] | null,
  status: LoadStatus,
  current: Program | null,
  currentStartsOn: string | null,
  currentStatus: LoadStatus,
): HistoryBoard {
  const entries: BlockEntry[] = [];

  // The live assignment leads, and only when its own read landed. Under
  // 'loading' or 'error' it is left out entirely rather than drawn as absent:
  // the screen's own branch says the current programme could not be read, and
  // a timeline that silently omitted it would read as a client between blocks.
  if (current && (currentStatus === 'ready' || currentStatus === 'partial')) {
    entries.push({
      key: CURRENT_KEY,
      current: true,
      program: current,
      title: titleOf(current),
      weeks: weekCount(current),
      startsOn: currentStartsOn,
      // Deliberately no `fromDay`. `assigned_programs` carries `updated_at`,
      // which is when the row was last WRITTEN and not when the block began —
      // and before part 176 it was not even that, because `default now()` fires
      // on insert only and every overwrite left it at the first assignment's
      // date. The start date the coach typed is the honest answer and it is
      // carried above; where they did not type one there is nothing to show,
      // which is better than a date that means something else.
      fromDay: null,
      toDay: null,
      ranDays: null,
      reason: 'replaced',
    });
  }

  // whole-ok: 'partial' goes on through the loop below on purpose — the earlier
  // blocks that came back are real blocks a coach wants to read, each with its
  // own real dates, and refusing to draw them because there may be more would
  // hide a client's whole history to avoid mis-stating its length. The length is
  // what gets refused instead: both returns below read `status === 'ready' ? n :
  // null` for `earlierCount`, and `historyLine` turns that null into "came back
  // at the row limit, so how many there are cannot be counted from here. Every
  // block listed is real." An `isWhole` on this line would send a client with a
  // long history down the 'unreadable' path and tell their coach the record
  // could not be read, which is not what happened.
  if (rows == null || status === 'error' || status === 'loading') {
    // The current block is still worth drawing when it read: "this is what they
    // are on, and what came before could not be read" is two true sentences.
    return entries.length
      ? { state: 'unreadable', entries, earlierCount: null }
      : UNREADABLE;
  }

  for (const r of rows) {
    // A history row with no programme is not a block. It cannot happen —
    // `program` is NOT NULL in the table — and a jsonb column read through two
    // layers of optional chaining can still hand back null, at which point
    // there is nothing to name, nothing to count weeks of, and nothing a coach
    // could open. Dropped rather than rendered as an untitled empty block,
    // which would read as a programme with no exercises in it.
    if (!r.program) continue;
    const fromDay = r.assignedAt ? dayKeyOf(r.assignedAt) : null;
    const toDay = r.replacedAt ? dayKeyOf(r.replacedAt) : null;
    entries.push({
      key: r.id,
      current: false,
      program: r.program,
      title: titleOf(r.program),
      weeks: weekCount(r.program),
      startsOn: r.startsOn,
      fromDay,
      toDay,
      ranDays: daysBetweenKeys(fromDay, toDay),
      reason: r.reason,
    });
  }

  const earlier = entries.filter((e) => !e.current);
  if (!earlier.length) {
    return { state: 'none', entries, earlierCount: status === 'ready' ? 0 : null };
  }
  return {
    state: 'some',
    entries,
    // A count only over a whole read. Under 'partial' the blocks listed are
    // real blocks and are worth reading; how many there are is not something a
    // prefix of an unknown set can say.
    earlierCount: status === 'ready' ? earlier.length : null,
  };
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * The line under the timeline heading.
 *
 * The 'none' branch carries the sentence that stops a coach drawing the wrong
 * conclusion from a true answer. There genuinely is no earlier programme for
 * this client — and that is also true of every client in the app whose
 * programmes were replaced before the history table existed, because those
 * overwrites destroyed what came before and nothing can bring them back. A
 * coach who reads "no earlier programmes" about a client they have coached for
 * two years should be told which of the two they are looking at.
 */
export function historyLine(status: LoadStatus, board: HistoryBoard, who: string): string {
  if (status === 'loading') return 'Reading what they were on before…';
  if (board.state === 'unreadable') {
    return `The earlier programmes could not be read. That is not the same as ${who} never having been on one.`;
  }
  if (board.state === 'none') {
    return `No earlier programme on record. Programmes replaced before this app started keeping the record were overwritten and cannot be recovered, so this is silent about anything before then.`;
  }
  if (board.earlierCount == null) {
    return `Their earlier programmes came back at the row limit, so how many there are cannot be counted from here. Every block listed is real.`;
  }
  return `${board.earlierCount} earlier programme${s(board.earlierCount)} on record.`;
}

/**
 * How one block's span reads, in sentence case, with no dash inside it.
 *
 * Every branch is a different fact about the record rather than a shorter
 * version of the same one. scripts/check-prose.mjs exists because a `fig()` in
 * the middle of a sentence renders as an em dash and the sentence loses its
 * subject; here the temptation is `${from} — ${to}`, which does the same thing
 * from the other direction when one end is missing.
 */
export function blockSpanLine(e: BlockEntry, dayName: (day: string) => string): string {
  if (e.current) {
    return e.startsOn
      ? `On this now. You set it to start ${dayName(e.startsOn)}.`
      : 'On this now.';
  }
  const ended = e.reason === 'removed'
    ? 'taken off it'
    : 'moved onto something else';
  if (e.fromDay && e.toDay) {
    return e.ranDays == null
      ? `Assigned ${dayName(e.fromDay)}, ${ended} ${dayName(e.toDay)}.`
      : `Assigned ${dayName(e.fromDay)}, ${ended} ${dayName(e.toDay)} — ${e.ranDays} day${s(e.ranDays)}.`;
  }
  if (e.toDay) {
    return `${ended === 'taken off it' ? 'Taken off it' : 'Replaced'} ${dayName(e.toDay)}. When it was assigned is not on record.`;
  }
  if (e.fromDay) return `Assigned ${dayName(e.fromDay)}.`;
  return 'Neither end of this block is on record, so there are no dates to give for it.';
}
