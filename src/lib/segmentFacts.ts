// The fact that put each name in the segment, said beside the name.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// app/(trainer)/broadcast.tsx drew its recipient list as
// `recipients.map((c) => c.name).join(', ')` — a comma-joined run of names and
// nothing else. Above it sat one sentence about the segment as a whole
// (`SegmentDef.note`: "Well below their own rate over the last fortnight…"),
// which is a DEFINITION. It is not evidence about anybody on the list.
//
// So a coach about to write "I have not seen you in a while" to fourteen people
// read fourteen names and could not check a single one of them without leaving
// the screen, losing the message in the box, and opening fourteen clients. What
// they actually did instead was send it, because the alternative was an hour.
//
// The facts were all already on this screen. `clientDrift` had computed a
// sentence per client — "Nothing for 19 days — was 3.5 days a week" — and
// broadcast.tsx threw everything but the band away on the way into its map;
// `packLeft` had the sessions remaining per person and only the boolean
// survived; the roster had carried `adherence` all along. Every fact below is
// one this screen already held and discarded.
//
// ── Why it is clientDrift's OWN sentence and not a second one ─────────────
//
// `driftReason` is `Drift.reason` verbatim, for the reason `observedLine` in
// src/lib/nudge.ts gives for doing the same: a second set of sentences here
// would be a second vocabulary, free to drift out of agreement with the band
// heading on the Clients tab and with the draft on Quiet Clients. One client
// described two ways on two screens is how a coach stops believing either.
//
// ── A fact is only ever about the person, never about the send ────────────
//
// Nothing in this file says a message went anywhere. These strings are drawn
// BEFORE the send, under a list of people who have not been written to yet,
// and the one thing they must never acquire is a past tense. What happened to
// a message afterwards is src/lib/broadcastOutcome.ts, which is careful in the
// opposite direction.
//
// Pure — no react, no supabase, no clock.
import { num } from './format';
import type { SegmentDef } from './segments';

/**
 * Everything known about one recipient that any segment might be evidenced by.
 *
 * Every field is nullable and null is UNKNOWN rather than zero, which is the
 * rule `ClientFacts` in src/lib/segments.ts already keeps and for the same
 * reason: `packLeft: 0` is a pack with nothing left on it and `packLeft: null`
 * is a person who holds no pack, and a sentence that reads them as the same
 * fact tells a coach their client has run out of something they never bought.
 */
export interface RecipientFacts {
  /**
   * clientDrift's own sentence about this client's record — `Drift.reason`.
   * Null when the activity read was never put to the database for them, which
   * is every hand-added client: their silence is the absence of a question.
   */
  driftReason: string | null;
  /** Sessions left across every paid pack they hold. Null when they hold none. */
  packLeft: number | null;
  /** The roster's adherence percentage. Null when they have never checked in. */
  adherence: number | null;
  /** What their coach has tagged them, in the coach's own words. */
  tags: readonly string[];
}

/**
 * What the coach has chosen to write to, in the shape this file needs.
 *
 * The screen's own `Selection` carries a `SegmentKey` and looks the definition
 * up; this takes the definition itself, so a key with no definition behind it
 * cannot reach here at all and there is no "unknown segment" branch below
 * inventing a sentence for one.
 */
export type Addressed =
  | { kind: 'all' }
  | { kind: 'tag'; tag: string }
  | { kind: 'seg'; def: SegmentDef };

/**
 * The one line under a recipient's name, or null when there is nothing true to
 * put there.
 *
 * NULL RATHER THAN A PLACEHOLDER, everywhere. A row reading "—" under a name
 * in a list of people about to be messaged is the screen asserting that it
 * looked and found nothing, and for a drift segment that is precisely the
 * claim it must not make: a client with no `driftReason` is one the read never
 * covered, and they are not in the segment in the first place. An absent line
 * is the honest shape of "this segment is not a claim about this person".
 */
export function recipientFact(a: Addressed, f: RecipientFacts): string | null {
  // Everybody. Nothing about the person put them here — being on the book did
  // — so there is no fact to state and stating one anyway would be furniture
  // under every name on the longest list this screen can draw.
  if (a.kind === 'all') return null;

  // A tag. The tag itself is the heading, and repeating it under each name
  // says nothing; their OTHER tags are the part the coach cannot see from the
  // chip they pressed, and are the thing that makes them think twice about
  // sending a bootcamp message to somebody also tagged "on hold".
  if (a.kind === 'tag') {
    const others = f.tags.filter((t) => t && t !== a.tag);
    return others.length ? `Also tagged ${others.join(', ')}` : null;
  }

  switch (a.def.key) {
    // The three drift bands share one sentence, because they are three
    // thresholds over one measurement and the measurement is what the coach
    // needs. Trimmed rather than trusted: an empty reason renders as a blank
    // second line, which reads as a value that failed to load.
    case 'drifting':
    case 'slipping':
    case 'no-record': {
      const r = (f.driftReason ?? '').trim();
      return r || null;
    }
    // Said as a fact about the PACK and not about the person. "They have run
    // out" is a claim about their training; what is known is that the sessions
    // on a thing they paid for are used up, which is the claim the coach is
    // about to write a message on the strength of.
    case 'pack-run-out':
      return 'Every session on the pack they paid for has been used';
    case 'pack-low': {
      // Null is not zero and is not "nearly out" either. A client with no pack
      // is outside this segment, so this branch is unreachable from the screen
      // — and it returns null rather than inventing a number for the day
      // somebody calls it from somewhere else.
      if (f.packLeft == null) return null;
      return `${num(f.packLeft)} ${f.packLeft === 1 ? 'session' : 'sessions'} left on a paid pack`;
    }
    // NOT "0% adherence". `adherence: null` is the absence of a check-in, and
    // the roster carried it as 100 once, which is the same error in the other
    // direction — a person nobody knew anything about scoring perfectly. The
    // sentence names the missing input rather than putting a figure on it.
    case 'never-checked-in':
      return f.adherence == null
        ? 'No check-in on record, so there is no adherence figure to read'
        : null;
  }
}

/**
 * The caption above the recipient list saying what the second line under each
 * name IS.
 *
 * Needed because the lines differ by segment and a reader arriving at
 * "Nothing for 19 days — was 3.5 days a week" under a name has no way to know
 * whether that is a fact about the person or a restatement of the band. It
 * also carries the as-of, which is the part that stops a coach treating a
 * screen they opened an hour ago as this morning's answer.
 *
 * Null for "All clients", where there is no second line to explain.
 */
export function factsCaption(a: Addressed): string | null {
  if (a.kind === 'all') return null;
  if (a.kind === 'tag') return 'Under each name, the other tags you have on them.';
  switch (a.def.key) {
    case 'drifting':
    case 'slipping':
    case 'no-record':
      return 'Under each name, what their record actually shows — read when this screen loaded, not live.';
    case 'pack-run-out':
    case 'pack-low':
      return 'Under each name, what is left on the packs they have paid for — read when this screen loaded, not live.';
    case 'never-checked-in':
      return 'Under each name, why there is no adherence figure for them.';
  }
}
