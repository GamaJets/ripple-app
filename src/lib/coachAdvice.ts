// Everything a coach has written to this member, rather than the last line of it.
//
// ── What had no home ──────────────────────────────────────────────────────
//
// `coach_feedback` is the advice a trainer leaves on a client (src/ui/feedback.tsx,
// supabase/parts/02 and 68). The coach writes as many notes as they like from
// app/(trainer)/dashboard.tsx and every one of them is stored, addressed to one
// person, and readable by them.
//
// The member's side of that was one line on the dashboard:
//
//     {coachNotes.length > 0 ? (
//       <Text … numberOfLines={4}>{coachNotes[0].body}</Text>
//     ) : null}
//
// `coachNotes[0]`, clipped at four lines, and nothing anywhere else. The second
// note and every note before it were unreachable in all three apps the moment a
// third arrived. The gym's noticeboard on the same screen does not work that
// way and says so in its own comment — "Only the newest one is here; the rest
// are one tap away in Notices" — so the asymmetry is not a house style, it is a
// screen that was never built.
//
// What that costs is specific. A coach writes "keep the bar over mid-foot, and
// stop at eight even if nine is there" in March; in April they write "book your
// deload week". The March note, which is the one the member needs on the gym
// floor, is gone. The coach can still see both from their own client detail, so
// neither party has any reason to think anything was lost.
//
// ── This is the coach's words TO the member ───────────────────────────────
//
// Worth stating because the table is named for the coach and the direction is
// easy to read backwards. `coach_feedback.coach_id` is the author and
// `client_id` is the reader. Nothing in this codebase carries feedback the other
// way: the member's channels to their coach are the thread
// (app/(client)/messages.tsx), the review (supabase/parts/139), and the reason
// attached to ending coaching (src/lib/endCoaching.ts). Whatever is added here
// must not be described to the member as something they wrote.
//
// ── Why the sentences are here ────────────────────────────────────────────
//
// One of them is the reason this file exists at all. src/ui/feedback.tsx reads
// every note the caller is party to in a single query under `capLimit()`, so its
// status is genuinely 'partial' at the ceiling — and its own header records the
// failure it was given four statuses to stop: "a client whose coach had written
// them three notes was told their coach had said nothing". A count, or the word
// "none", may not be stated over a set that is unknown or known to be short.
//
// Pure — no React, no Supabase, no clock. A formatted date arrives already
// formatted, because a locale belongs to the reader.
import type { LoadStatus } from '../ui/loadStatus';

/** One note, as `src/ui/feedback.tsx` holds it. Structurally the same as its
 *  `FeedbackItem`, restated here so this module stays pure: importing the hook's
 *  types would pull React into a file that runs under plain `node`. */
export interface AdviceNote {
  id: string;
  /** `created_at`, an instant rather than a bare day. */
  at: string;
  body: string;
}

/**
 * Newest first, and stable.
 *
 * The read already orders by `created_at desc, id desc`, so this is not a
 * correction of the server. It is what makes the ORDER a property of this
 * module rather than of whichever query last filled the provider's map: the
 * provider MERGES reads into that map and puts an optimistic write at the
 * front, so the array a screen is handed is only as ordered as the last thing
 * that touched it.
 *
 * `Date.parse`, not a string comparison: these are timestamptz instants, not
 * bare `YYYY-MM-DD` days, so there is a real point in time to compare. A stamp
 * that will not parse sorts last rather than poisoning the comparison, and the
 * id breaks a tie so two notes written in the same second cannot swap places
 * between renders.
 */
export function sortAdvice(notes: AdviceNote[]): AdviceNote[] {
  const at = (n: AdviceNote): number => {
    const ms = Date.parse(n.at);
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
  };
  return [...notes].sort((a, b) => at(b) - at(a) || b.id.localeCompare(a.id));
}

/**
 * The sentence above the list.
 *
 * `coachName` is null wherever the coach's name could not be read, and every
 * branch below is written so the sentence survives that without a hole in it —
 * see scripts/check-prose.mjs. Nothing here says "your coach" about a name we
 * do have, or prints a dash in place of one we do not.
 *
 * 'partial' is not folded into 'ready'. The read is capped (src/lib/rowCap.ts)
 * and a member at the ceiling would otherwise be given a count of their coach's
 * advice that is a count of some of it.
 */
export function coachAdviceNote(status: LoadStatus, count: number, coachName: string | null): string {
  const who = coachName ?? 'your coach';
  switch (status) {
    case 'loading':
      return 'Reading what your coach has written to you.';
    case 'error':
      return `We couldn’t read this. It is not us saying ${who} has written you nothing — try again when you have signal.`;
    case 'partial':
      return `These are some of the notes ${who} has written to you, not all of them. There were more than this app reads at once.`;
    case 'ready':
      if (count <= 0) {
        return `${who} hasn’t written you anything yet. Notes they leave you turn up here and on your dashboard.`;
      }
      return count === 1
        ? `One note from ${who}.`
        : `${count} notes from ${who}, newest first.`;
  }
}

/**
 * The line under each note, or null.
 *
 * Null rather than a dash or an empty string: a stamp that would not parse
 * should cost the date and nothing else, and a screen that renders `null` draws
 * no row at all. The argument is the date ALREADY formatted, because the locale
 * is the reader's and this module may not read one.
 */
export function adviceStampLine(whenWritten: string | null): string | null {
  return whenWritten ? `Written ${whenWritten}` : null;
}
