// The segments a coach can address that the app already knows about.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// app/(trainer)/broadcast.tsx offered two kinds of segment: everybody, and a
// tag somebody typed by hand. Meanwhile this app computes, on other screens and
// for other purposes, exactly the categories a coach would actually want to
// write to — who has drifted off their own pattern (src/lib/clientDrift.ts),
// who has nothing on record at all, whose session pack has run out and who is
// down to their last one or two (`packRunOut` and `packLeft` in
// src/lib/coachMoney.ts), and who has never checked in. None of it was
// reachable from the one screen that sends a message.
//
// A tag is a note a coach wrote weeks ago and has to maintain. A computed
// segment is true this morning. The whole value of the second is that nobody
// had to remember to keep it up to date.
//
// ── A COMPUTED SEGMENT MUST STATE ITS OWN READ ────────────────────────────
//
// And it is a harder problem than a tag's, which is why most of this file is
// about it.
//
// "Everyone tagged bootcamp" fails visibly: with tags unread every `tagsFor()`
// comes back empty, the segment matches nobody, and the count on the button is
// zero. A coach notices zero.
//
// "Everyone who has drifted" fails INVISIBLY and in the dangerous direction. If
// the activity read comes back at its row ceiling, the clients whose events
// happened to be past the cut-off look silent, and a coach writing "I have not
// seen you in a while" reaches somebody who trained yesterday. If it comes back
// SHORT the other way — a client whose recent workouts loaded and whose
// baseline did not — they drop out of the segment and the coach believes they
// have written to everybody who needed it. Both are a number that looks like a
// segment and is the size of a read.
//
// So every segment here names the SOURCE it is computed from, the screen tracks
// a `LoadStatus` per source, and that status is what
// `guardRecipients(rosterStatus, sourceStatus, …)` refuses on. The status of
// the roster is not enough on its own: the roster can be whole while the read
// that decides who is IN the segment is not.
//
// ── Clients the source could not be asked about ───────────────────────────
//
// `readClientActivity` returns `notAsked` — ids that are not accounts, which is
// every client the coach added by hand. Their empty event list is not evidence
// of silence, and they have no thread to write into either. They are therefore
// excluded from every computed segment rather than counted as "nothing
// recorded", and `unassessed` is how the screen says how many and why. Reading
// their emptiness as drift would put the coach's own notes-to-self at the top
// of a list of people to chase.
//
// Pure — no react, no supabase, no clock.
import type { StatusLevel } from './status';

/** Which read decides membership. The screen keeps one `LoadStatus` per source
 *  and hands the right one to `guardRecipients`. */
export type SegmentSource = 'roster' | 'drift' | 'packs';

export type SegmentKey =
  | 'drifting' | 'slipping' | 'no-record'
  | 'pack-run-out' | 'pack-low'
  | 'never-checked-in';

export interface SegmentDef {
  key: SegmentKey;
  /** The chip. Title Case, like every other control in this app. */
  title: string;
  /** What being in it means, said under the recipient list — a coach about to
   *  write to twelve people has to know what the twelve have in common. */
  note: string;
  source: SegmentSource;
  /**
   * The object of the guard's own sentence: "Only part of ___ came back".
   * Written as a noun phrase for that reason, and lower case because it lands
   * mid-sentence.
   */
  object: string;
}

/**
 * How few sessions left counts as nearly out.
 *
 * Two, not one. A coach who hears about it at one has a single session to have
 * the conversation in; at two there is a session in between, which is when a
 * renewal actually gets sold. It is a threshold this module states rather than
 * a fact about anybody, so it is named here and not buried in a comparison.
 */
export const PACK_LOW_AT = 2;

export const COMPUTED_SEGMENTS: readonly SegmentDef[] = [
  {
    key: 'drifting', source: 'drift', object: 'who has drifted',
    title: 'Drifting',
    note: 'Well below their own rate over the last fortnight, measured against the six weeks before it. Their own pattern, not anybody else’s.',
  },
  {
    key: 'slipping', source: 'drift', object: 'who is slipping',
    title: 'Slipping',
    note: 'Down on their own rate, but not yet far. Worth a word before it becomes the list above.',
  },
  {
    key: 'no-record', source: 'drift', object: 'who has nothing on record',
    title: 'Nothing Recorded',
    note: 'No pattern to judge — nothing read of theirs in the window. That is not the same as fine, and it is not the same as gone; it is a thing to find out.',
  },
  {
    key: 'pack-run-out', source: 'packs', object: 'whose pack has run out',
    title: 'Pack Run Out',
    note: 'They paid for a block of sessions and have used all of it, so the next one is covered by nothing.',
  },
  {
    key: 'pack-low', source: 'packs', object: 'who is nearly out of sessions',
    title: `${PACK_LOW_AT} Sessions Or Fewer`,
    note: `A paid pack with ${PACK_LOW_AT} or fewer left on it. Early enough that there is a session to have the conversation in.`,
  },
  {
    key: 'never-checked-in', source: 'roster', object: 'who has never checked in',
    title: 'Never Checked In',
    note: 'Nobody has a check-in on record for them, so there is no adherence figure to read. New clients are in here too — it is who to ask, not who to worry about.',
  },
];

export function segmentDef(key: string): SegmentDef | null {
  return COMPUTED_SEGMENTS.find((s) => s.key === key) ?? null;
}

/**
 * What is known about one client, reduced to the fields a segment asks about.
 *
 * Every one of them is nullable and null always means UNKNOWN rather than zero.
 * `packLeft: null` is a client who holds no session pack; `drift: null` is a
 * client the activity read could not be put to the database at all.
 */
export interface ClientFacts {
  clientId: string;
  /** From `assessDrift`. Null when this client was never asked about — which is
   *  every hand-added client, and is not an assessment. */
  drift: StatusLevel | null;
  /** The fewest sessions left on any paid pack they hold. Null when they hold
   *  none, which is a different fact from a pack with zero left. */
  packLeft: number | null;
  /** True when a paid pack of theirs has nothing left on it. */
  packRunOut: boolean;
  /** The roster's adherence percentage. Null when they have never checked in. */
  adherence: number | null;
}

/** Whether this client is in this segment. */
export function inSegment(def: SegmentDef, f: ClientFacts): boolean {
  switch (def.key) {
    // The three drift bands. `drift === null` is never in any of them: it is
    // the absence of an assessment, and 'no-record' is the presence of one that
    // found nothing. Collapsing the two would put every hand-added client into
    // a list of people to chase.
    case 'drifting': return f.drift === 'at_risk';
    case 'slipping': return f.drift === 'watch';
    case 'no-record': return f.drift === 'idle';
    case 'pack-run-out': return f.packRunOut;
    // Strictly greater than zero, so a run-out pack is in one list and not two.
    // A coach writing to both would send the same person two messages, and the
    // right thing to say to each is not the same thing.
    case 'pack-low': return f.packLeft !== null && f.packLeft > 0 && f.packLeft <= PACK_LOW_AT;
    case 'never-checked-in': return f.adherence === null;
  }
}

/** The ids in this segment, in the order the facts were given — which is the
 *  roster's order, so the recipient list reads the way the coach's book does. */
export function segmentMembers(def: SegmentDef, facts: readonly ClientFacts[]): string[] {
  return facts.filter((f) => inSegment(def, f)).map((f) => f.clientId);
}

/**
 * Clients this segment's source could not answer for.
 *
 * Only meaningful for 'drift': a client with no Repple account has no
 * server-side activity to read and no thread to write into, so they are outside
 * every drift segment for two independent reasons. The other two sources answer
 * for everybody — a client with no purchases genuinely holds no pack, and a
 * client with no check-ins genuinely has no adherence figure.
 */
export function unassessed(def: SegmentDef, facts: readonly ClientFacts[]): string[] {
  if (def.source !== 'drift') return [];
  return facts.filter((f) => f.drift === null).map((f) => f.clientId);
}

/**
 * What to say under a computed segment about the people it could not consider.
 *
 * Null when there are none, because a standing sentence about an empty set is
 * furniture. Said at all because the alternative is a count that is quietly
 * smaller than the coach's book with nothing anywhere explaining the gap.
 */
export function unassessedNote(def: SegmentDef, count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'client is' : 'clients are'} not in this list and could not be: they were added by you `
    + 'by hand and have no account, so nothing of theirs can be read and there is no thread to write into. '
    + `They are not being counted as ${def.key === 'no-record' ? 'having nothing recorded' : 'outside the segment'} — they were never asked about.`;
}

/**
 * The label under the recipient list, naming what the segment IS.
 *
 * Every computed segment gets one. A tag is self-explanatory and a computed
 * band is not: "Drifting" is a threshold this app chose, and a coach about to
 * write to the twelve people in it is entitled to know which threshold.
 */
export function segmentMeaning(def: SegmentDef): string {
  return def.note;
}
