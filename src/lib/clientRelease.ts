// Has this person signed the release, and which version.
//
// ── The question, and the reason it was refused for so long ────────────────
//
// The platform liability release is part 84's `liability_waivers`, gated over
// the whole client portal by src/ui/waiver.tsx. Its record has been readable by
// its own subject and by nobody else since the day it landed, on an argument
// this file does not dispute: what somebody agreed to about their own body,
// their own health and their own risk is a legal record and not roster data.
//
// The owner narrowed that on 13 September 2026, to two facts and no more:
// whether a row exists, and which version it names. supabase/parts/2671 is the
// policy, the argument and the list of what stays refused — the wording itself,
// when they signed it, and every column of the document record — and it is the
// file to read before changing anything here.
//
// ── Why this is a module and not four lines on a screen ────────────────────
//
// Because there are two sentences here that a coach will act on, they are
// opposite, and the accident that turns one into the other is a single missing
// check:
//
//   "They have NOT signed the release."        → do not train them yet; ask.
//   "Whether they signed could not be read."   → you have been told nothing.
//
// A refused read, a read still in flight and a genuinely empty record all
// arrive as an empty array. If the empty array is allowed to produce the first
// sentence, a coach turns somebody away over a dropped connection — and the
// person they turn away is somebody who DID sign. That is the failure this
// file exists to make impossible, and it is asserted in clientRelease.test.ts
// rather than trusted to a screen.
//
// ── The version is compared as a string, never as a date ───────────────────
//
// `WAIVER_VERSION` (src/lib/waiver.ts) looks like `2026-08-31` and is not a
// date: it is the day the WORDING last changed, and under a white-label brand
// it carries a suffix (`2026-08-31+examplefitness`). Nothing here parses it.
// Equality decides whether the current wording was agreed to; a plain string
// comparison orders the rest, which for `YYYY-MM-DD` is the same order a date
// comparison would give and cannot slide by a timezone.
import type { LoadStatus } from '../ui/loadStatus';

/**
 * What the app is entitled to know about somebody else's release.
 *
 * One field, because the table behind it has one readable fact beyond the
 * person's own id. There is no `acceptedAt` here and there must never be one:
 * `public.liability_waiver_status` does not carry it, and the reason is in
 * part 2671's header.
 */
export interface ReleaseSignature { version: string }

export type ReleaseVerdict =
  /** The read is still in flight. Say nothing about a person yet. */
  | 'loading'
  /** The read failed or was refused. NOT an unsigned release, and not a signed
   *  one — the one thing it must never do is pass for either. */
  | 'unreadable'
  /** The read came back truncated and the current version was not among what
   *  came back. Absence inside a partial answer is not absence. */
  | 'truncated'
  /** A whole read, and there is genuinely nothing. They have not signed. */
  | 'none'
  /** They have agreed to the wording in force today. */
  | 'current'
  /** They agreed to earlier wording and have not agreed to this one. The
   *  client portal will ask them again on their next launch — see
   *  `waiverGate` in src/lib/waiver.ts. */
  | 'superseded';

/**
 * The newest version they have agreed to, or null when they have agreed to
 * none. Compared as text — see the header; these are not dates.
 */
export function latestSigned(signatures: readonly ReleaseSignature[]): string | null {
  let best: string | null = null;
  for (const s of signatures) {
    const v = typeof s.version === 'string' ? s.version.trim() : '';
    if (!v) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

/**
 * Which of the six situations this is.
 *
 * The order of the tests is the argument. `current` is decided BEFORE the read
 * status is allowed to withhold an answer, because a row that came back is a
 * row that exists: a truncated read can still PROVE a signature, it just
 * cannot disprove one. That is the same asymmetry src/ui/loadStatus.ts states
 * for 'partial' — the rows are real, the absence of a row is not.
 *
 * Everything after that point needs the read to have been whole, so both
 * 'loading' and 'error' are answered first and 'partial' collapses to
 * 'truncated' rather than to 'none'.
 */
export function releaseVerdict(
  read: LoadStatus,
  signatures: readonly ReleaseSignature[],
  current: string,
): ReleaseVerdict {
  if (read === 'loading') return 'loading';
  if (read === 'error') return 'unreadable';
  if (signatures.some((s) => s.version === current)) return 'current';
  if (read === 'partial') return 'truncated';
  return latestSigned(signatures) === null ? 'none' : 'superseded';
}

/**
 * The sentence the coach reads.
 *
 * `who` is the client in the coach's own words. It is never a stand-in for a
 * name that could not be read: the caller passes a description ("this client")
 * rather than somebody else's name — the same rule src/lib/clientPaperwork.ts
 * follows for the coach's own paperwork, one section above this one on screen.
 *
 * No sentence here names the brand. The release is white-labelled (see
 * src/lib/waiver.ts), and "the liability release" is true under every brand
 * running this app.
 */
export function releaseLine(
  read: LoadStatus,
  signatures: readonly ReleaseSignature[],
  current: string,
  who: string,
): string {
  const verdict = releaseVerdict(read, signatures, current);
  if (verdict === 'loading') return `Reading whether ${who} has signed the liability release.`;
  if (verdict === 'unreadable') {
    return `Whether ${who} has signed the liability release could not be read. That is a read that failed, `
      + 'not a record of them having signed nothing — do not take it either way.';
  }
  if (verdict === 'truncated') {
    return `Only part of ${who}'s release record came back, and the current version was not in the part that did. `
      + 'That is not the same as them not having signed it. Pull to refresh.';
  }
  if (verdict === 'none') return `${who} has NOT signed the liability release.`;
  if (verdict === 'current') return `${who} has signed the liability release, version ${current}.`;
  return `${who} signed version ${latestSigned(signatures)} of the liability release, not the current `
    + `version ${current}. They will be asked to sign again next time they open the app.`;
}

/**
 * Whether this is worth flagging rather than merely stating.
 *
 * 'none' only. A failed or truncated read is NOT a warning — a red flag over an
 * unknown is the same lie as a green one and it teaches a coach to ignore the
 * colour (src/lib/clientPaperwork.ts makes the same call about the same
 * screen). 'superseded' is not one either: the person signed what they were
 * shown, the app itself is what changed, and the client portal asks them again
 * without the coach having to do anything.
 */
export const releaseOutstanding = (verdict: ReleaseVerdict): boolean => verdict === 'none';

/**
 * What the coach is told about the limits of what they are being shown.
 *
 * It is on the screen rather than in a comment because a coach who is shown a
 * line about somebody's liability release will reasonably assume they can open
 * it, go looking, and find a door that will not open with no explanation. It
 * also states the boundary to the only person in a position to breach it by
 * asking the client for a copy of something they are not entitled to.
 */
export const RELEASE_PRIVACY_NOTE =
  'You can see whether it is signed and which version. What it says, and when they signed it, stays theirs.';
