// Merging the two records a coach can hold of the same person, and comparing
// the two goals those records carry. Pure — one type-only import — so it
// compiles and runs under plain node. See rosterMerge.test.ts.
//
// ── Why one person can appear on the roster twice ──────────────────────────
//
// The coach app writes a client down in two different tables, and the two mean
// genuinely different things:
//
//   · `clients` is a real account with a real person behind it. Its `goal` is
//     what the CLIENT chose on their own goal screen, and the roster hangs
//     their weight delta, their adherence and their last activity off that row.
//   · `coach_clients` is a note the coach typed — a name and a goal, no account
//     behind it. Its `lastActive` is the literal string 'added by you', because
//     for a hand-written note nothing has happened yet and nothing can.
//
// Those were two disjoint sets right up until approving a request started
// writing both. src/ui/CoachRequests.tsx calls `link_coaching` and then upserts
// a `coach_clients` row keyed on the client's OWN uid, so the coach has
// somewhere to keep what they know about somebody the moment they accept them.
// The roster then concatenated its two lists with no de-duplication, and that
// client rendered twice: once with their real training on the row, and once as
// 'General · added by you' underneath it. React warned about the duplicate key,
// which was the smallest of the problems.
//
// ── Why the linked row wins ────────────────────────────────────────────────
//
// Not because it is newer, and not because it happened to come first in the
// array. Because of what the two rows are able to say.
//
// The linked row is the only one carrying facts about a person who has been
// training: the goal they chose, the weight they have actually lost, the
// check-ins they have actually filed, when they were actually last seen. The
// manual row carries none of that and structurally cannot — 'added by you' is
// not an activity record, and its null weight delta does not mean "no change",
// it means "this row was never about scans at all". Letting it win would
// replace a real client's history with a placeholder and then present the
// placeholder as fact, which is the oldest bug in this codebase wearing a
// different hat.
//
// The one thing the manual row knows that the linked row does not is the goal
// the COACH wrote down. That is lifted across rather than thrown away — see
// `coachGoal` — because the two goals disagreeing is a conversation the coach
// should be able to have, not a conflict for this function to settle.
import type { Goal } from './types';

/** The minimum a roster entry must carry for the merge to reason about it.
 *  Deliberately structural rather than `RosterClient`: this file has to compile
 *  and run under plain node, and the roster's own shape drags React Native
 *  types in behind it. */
export interface MergeableClient {
  id: string;
  goal: string;
  /** The goal the COACH recorded for this person in Add Client, in the coach's
   *  own words. Only ever set where a `coach_clients` row and a `clients` row
   *  describe the same person: on a manual-only entry `goal` already IS the
   *  coach's goal, and copying it into both fields would make every hand-added
   *  client look like they agree with themselves about something they were
   *  never asked. Undefined means the coach recorded nothing, which is not the
   *  same as recording something we could not read. */
  coachGoal?: string | null;
}

/**
 * One row per person, linked record first.
 *
 * `linked` is built from `clients`, `manual` from `coach_clients`. Where an id
 * appears in both, the linked row survives whole and gains `coachGoal` from the
 * manual one; where an id appears only in `manual`, that entry is passed
 * through untouched, because a coach's hand-written client is a real thing the
 * coach can see and remove and must not vanish from the list.
 *
 * Nothing else is borrowed across the join, and `joinedAt` is the field worth
 * naming: `coach_clients.created_at` is when the coach typed the person's name
 * in, which for a request approved through CoachRequests is the same moment the
 * link was made, but for a coach who wrote somebody down in January and linked
 * them in March is two months early. src/lib/clientDrift.ts clamps its baseline
 * window to how long the client has been on the book, so an early date widens
 * that window and dilutes a real fall in activity into nothing. A null join
 * date renders as a dash; a wrong one is believed.
 *
 * Order is fully determined by the inputs — linked in the order given, then the
 * manual-only entries in the order given — so two renders of the same two reads
 * cannot produce two different lists.
 */
export function mergeRoster<T extends MergeableClient>(linked: readonly T[], manual: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of manual) if (!byId.has(m.id)) byId.set(m.id, m);
  const out: T[] = [];
  const taken = new Set<string>();
  for (const row of linked) {
    // A duplicate id inside one list should not be possible — both are primary
    // keys — but the whole point of this function is that the roster stopped
    // being able to trust that, and a repeated key is a render warning at best
    // and a mis-targeted tap at worst.
    if (taken.has(row.id)) continue;
    taken.add(row.id);
    const note = byId.get(row.id);
    // The spread widens T to T & { coachGoal }, which TypeScript will not infer
    // back down to T on its own. The shape is unchanged; only a field the
    // interface already declares has been filled in.
    out.push(note ? ({ ...row, coachGoal: note.goal } as T) : row);
  }
  for (const m of manual) {
    if (taken.has(m.id)) continue;
    taken.add(m.id);
    out.push(m);
  }
  return out;
}

// ── Two vocabularies for the same three goals ──────────────────────────────
//
// The client's own goal screen stores an enum — 'fatloss' | 'tone' | 'muscle'.
// The coach's Add Client form stores the label they tapped — 'Fat loss' |
// 'Tone' | 'Build muscle' — into a nullable text column with no CHECK behind
// it. Compared raw, every client who joined by code looks like they are arguing
// with their coach.
//
// Matched on an exact normalised key, never by substring. The builder used to
// ask `s.includes('muscle')` before `s.includes('tone')`, which answers
// "muscle" for the phrase "muscle tone" — the opposite of what was typed — and
// this function is now what decides which programme gets generated for
// somebody.
const GOAL_KEYS: Record<string, Goal> = {
  fatloss: 'fatloss',
  tone: 'tone',
  muscle: 'muscle',
  buildmuscle: 'muscle',
};

/**
 * The goal a string names, or null when it does not name one.
 *
 * Null is UNKNOWN and is a fourth answer, not a fourth goal. 'General' is the
 * roster's placeholder for a goal it could not read, an empty string is a
 * column nobody ever filled in, and free text a coach typed before this form
 * had fixed options is a sentence rather than a category. None of those is a
 * statement that the person in front of you wants to lose fat, and the previous
 * version of this lookup returned exactly that for all three.
 */
export function goalToEnum(goal: string | null | undefined): Goal | null {
  const key = (goal || '').toLowerCase().replace(/[^a-z]/g, '');
  // hasOwnProperty rather than `in` or a bare index: the key comes off a text
  // column, and 'constructor' or 'toString' would otherwise resolve to a
  // function off Object.prototype and be handed back as somebody's goal.
  return Object.prototype.hasOwnProperty.call(GOAL_KEYS, key) ? GOAL_KEYS[key] : null;
}

/**
 * Do the client and their coach have DIFFERENT goals written down for this
 * person?
 *
 * Normalised on both sides, so 'Fat loss' and 'fatloss' are one goal stated in
 * two vocabularies and read as agreement.
 *
 * False whenever either side is unknown, and that is the important half. A
 * coach who never recorded a goal has not disagreed with anybody, and a client
 * goal that could not be read is not evidence of anything at all — surfacing
 * either as a disagreement would put a conversation on the coach's screen that
 * nobody needs to have, off the back of a failed read.
 */
export function goalsDisagree(clientGoal: string | null | undefined, coachGoal: string | null | undefined): boolean {
  const a = goalToEnum(clientGoal);
  const b = goalToEnum(coachGoal);
  return a !== null && b !== null && a !== b;
}
