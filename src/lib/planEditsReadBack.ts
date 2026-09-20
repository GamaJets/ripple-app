// The changes a member made to their own plan, read back to them.
//
// ── What was written and never read ───────────────────────────────────────
//
// `client_plan_edits` (supabase/parts/204) has had exactly one reference in
// this repo since the day it was created: the upsert at src/ui/planEdits.tsx.
// The `edits` blob is written by every swap, removal, addition and corrected
// set a member makes, and NOTHING — in any of the three apps — has ever read it
// back. Part 204's own header says what the column is for: "the one fact that
// would settle it — 'they have swapped this four weeks running' — was being
// typed into a React state and thrown away." It is now being typed into a
// column and thrown away instead.
//
// ── What the CLIENT half of that is, and what it is not ───────────────────
//
// The member already sees their own edits on the plan screen, because that
// screen holds them in React state and reads them off the phone. What they have
// never been able to see is the OTHER copy — the row on the server, which is
// the one their coach reads. `usePlanEdits.shared` can say "your coach can see
// them" only about the write it just made, on the handset that made it: it is a
// flag about one request, not a reading of what is actually stored. A member on
// a second handset, or after a reinstall, has no way at all to find out whether
// the four weeks of corrections they made ever arrived.
//
// So this module is about the stored row. It answers one question — what can my
// coach see of my plan, and when did it last reach them — and it answers it
// from the server's copy rather than from the phone's.
//
// It does NOT undo anything, and that is a decision rather than an omission.
// The device's copy in AsyncStorage and the in-memory copy inside
// `usePlanEdits` are what the plan screen writes from; a change made anywhere
// else would be overwritten by the next tap on that screen, silently, and the
// member would be told twice that something had been undone when it had not.
// An undo belongs beside the edits themselves.
//
// ── The name this file usually does not have ──────────────────────────────
//
// `swaps` and `exEdits` are keyed `dayIdx:exerciseKey`, and the key is a slug
// ('bench', 'ohp', 'rdl' — see src/lib/programs.ts). It is not a name, and the
// program that would turn it into one is not on every screen that wants to
// say what changed. So the sentences below name a movement only where the
// STORED VALUE is itself a name — the movement swapped TO, and a movement the
// member added — and otherwise say which day it was on and what kind of change
// it was. That is less than a reader wants and all the record supports; the
// alternative is printing a slug at somebody as though it were the name of an
// exercise.
//
// Pure — no React, no Supabase, no clock. The time label arrives already
// formatted, because a locale belongs to the reader.
import type { PlanEdits } from './planEdits';
import type { LoadStatus } from '../ui/loadStatus';

/** One change, as much as the record can say about it. */
export interface PlanEditItem {
  /** Stable within one set, for a list key. */
  id: string;
  /**
   * Which training day of the plan it sits on, counted from one, or null.
   *
   * The stored key counts from zero because it is an index into the plan's own
   * days array. Null where the key does not carry one — a movement the member
   * ADDED is held in a flat list with no day on it at all, which is how the
   * plan screen has always held it.
   */
  day: number | null;
  kind: 'swap' | 'removed' | 'numbers' | 'custom';
  /** The movement's name where the stored value is one, else null. Never a
   *  dash: a caller with no name gets a sentence that does not need one. */
  name: string | null;
}

/** The day index out of a `dayIdx:key` key, counted from one, or null when the
 *  key does not begin with one. Not `parseInt`, which reads '3abc' as 3. */
function dayOf(key: string): number | null {
  const head = key.slice(0, key.indexOf(':'));
  if (!/^\d+$/.test(head)) return null;
  const n = Number(head);
  return Number.isFinite(n) ? n + 1 : null;
}

/**
 * Every change, in a fixed order.
 *
 * Sorted by kind and then by key rather than left to object iteration order:
 * the blob is JSON and its key order is whatever the last write happened to
 * produce, so a list built straight off it reshuffles itself between reads and
 * looks like a list that is changing when nothing has.
 */
export function planEditItems(e: PlanEdits): PlanEditItem[] {
  const out: PlanEditItem[] = [];
  for (const k of Object.keys(e.swaps).sort()) {
    out.push({ id: `swap:${k}`, day: dayOf(k), kind: 'swap', name: e.swaps[k] || null });
  }
  for (const k of Object.keys(e.exEdits).sort()) {
    out.push({ id: `numbers:${k}`, day: dayOf(k), kind: 'numbers', name: null });
  }
  for (const k of [...e.removed].sort()) {
    out.push({ id: `removed:${k}`, day: dayOf(k), kind: 'removed', name: null });
  }
  // Index in the key, not the exercise's own `key`: two movements added with
  // the same key is a state the plan screen permits and a duplicate React key
  // is a list that drops a row.
  e.custom.forEach((x, i) => {
    out.push({ id: `custom:${i}`, day: null, kind: 'custom', name: (x.name || '').trim() || null });
  });
  return out;
}

/**
 * One change, as a sentence.
 *
 * The day is a prefix rather than a separate field so a caller cannot render
 * half of it, and it is dropped entirely where the key did not carry one — a
 * sentence reading "Day — you took a movement off" is the failure
 * scripts/check-prose.mjs exists for.
 *
 * "A movement" rather than a name wherever the record holds only a slug. It is
 * deliberately vague and it is true; the plan screen is where the member sees
 * which one, and this is a statement about what reached their coach.
 */
export function planEditItemLine(it: PlanEditItem): string {
  // An added movement has no day on it at all and its clause is written as a
  // whole sentence, because there is never a prefix in front of it.
  if (it.kind === 'custom') {
    return it.name
      ? `You added ${it.name}, which your plan does not contain.`
      : 'You added a movement your plan does not contain.';
  }
  const clause = it.kind === 'swap'
    ? (it.name ? `you swapped a movement for ${it.name}.` : 'you swapped a movement for another one.')
    : it.kind === 'removed'
      ? 'you took a movement off.'
      : 'you set your own sets, reps or load on a movement.';
  // The clause is written lowercase and capitalised HERE when it has to open
  // the sentence. Writing it capitalised and lowercasing after a prefix is the
  // same operation pointing the wrong way: it would mangle a name that
  // legitimately begins the clause the first time one does.
  return it.day == null
    ? clause.charAt(0).toUpperCase() + clause.slice(1)
    : `Day ${it.day}: ${clause}`;
}

/**
 * What the member is told about the copy their coach reads.
 *
 * Five situations and five sentences, and the two that matter most are the ones
 * that look identical on screen if they are collapsed:
 *
 *   · the row could not be READ. An empty answer here would tell somebody their
 *     coach cannot see a month of corrections, and the obvious response to that
 *     is to make them all again.
 *   · the row was read and the bytes would not PARSE. `readPlanEdits` keeps
 *     that apart from "no edits" for the device's copy and the same distinction
 *     holds for the server's: stored-but-unreadable is a thing the member
 *     should be told, not rounded down to nothing.
 *
 * `whenUpdated` is `updated_at` already formatted, and null where there is
 * none. A count of changes with no date on it is still worth saying; a date
 * assembled around a value that would not read is not.
 */
export function coachSeesPlanNote(
  status: LoadStatus, count: number, readable: boolean, whenUpdated: string | null,
): string {
  switch (status) {
    case 'loading':
      return 'Reading what your coach can see of your plan.';
    case 'error':
      return 'We couldn’t read what your coach can see of your plan, so this is not us saying they can see nothing. Check again when you have signal — nothing you have changed has been lost.';
    // Cannot arise on a single-row read, and is handled rather than folded into
    // 'ready' on principle: src/ui/loadStatus.ts forbids computing a figure
    // over a set that is known to be a prefix, and the count below is a figure.
    case 'partial':
      return 'We only got part of an answer about what your coach can see of your plan, so the changes below are not a complete list of them.';
    case 'ready':
      if (!readable) {
        return 'Your plan changes are stored and your coach can see them, but this app could not read them back to list them here. Nothing has been lost — open your plan to see what you have changed.';
      }
      if (count <= 0) {
        return 'You haven’t changed anything in the program you were given, so there is nothing of yours here for your coach to look at.';
      }
      return whenUpdated
        ? `${count} change${count === 1 ? '' : 's'} of yours reached your coach, last sent on ${whenUpdated}.`
        : `${count} change${count === 1 ? '' : 's'} of yours reached your coach.`;
  }
}
