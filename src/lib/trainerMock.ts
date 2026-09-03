// Trainer-portal shapes and the shared at-risk rule.
//
// There is no sample data left in this file, and that is the point of it now.
// It once exported ROSTER — five invented clients ("Jordan P.", "Sam R.",
// "Alex M.", "Priya N.") with invented adherence, weight deltas and injuries —
// and EX_VIDEOS, a six-entry "video library" whose rows were marked
// `uploaded: true` while their URLs were YouTube search queries, so a coach was
// shown six clips they had never recorded. Both shipped in the production
// bundle. What remains are the types the trainer screens are built on.
import type { CoachedMode } from './types';

export interface RosterClient {
  id: string; name: string; goal: string;
  /** The goal the COACH recorded for this person in Add Client, in their own
   *  words — set only where a `coach_clients` note and a linked `clients` row
   *  turn out to describe the same person, which is every client who joined by
   *  code or through the directory.
   *
   *  It sits BESIDE `goal` rather than replacing it because neither value is
   *  allowed to win. `goal` above is the client's own answer and is what drives
   *  their macros; this is what their coach wrote down. Where the two differ
   *  that is a coaching conversation to be surfaced, not a data conflict to be
   *  resolved by whichever screen loaded last — so the roster carries both and
   *  says so. See goalsDisagree() in src/lib/rosterMerge.ts, which compares them
   *  on a normalised basis so 'Fat loss' and 'fatloss' are one goal.
   *
   *  Undefined means the coach recorded nothing. That is not the same as
   *  recording something we could not read, and neither is a disagreement. */
  coachGoal?: string | null;
  /** Change in body weight across the scans on record, in kg.
   *
   *  NULL when there are none — which is every client added by hand, and every
   *  real one until their second scan. It used to be 0, and 0 is a claim: it
   *  says the person held their weight exactly, a measurement nobody took. */
  weightDelta: number | null;
  /** null = this client has never submitted a check-in. It used to default to
   *  100, so a client nobody knew anything about scored a perfect adherence
   *  and could never be flagged at risk. */
  adherence: number | null; lastActive: string; next: string;
  /** Messages from them this coach has not opened. `null` means the count could
   *  not be read — it was hardcoded 0, which told a coach nobody was waiting on
   *  them on the one screen that exists to say who is. */
  unread: number | null;
  mode: CoachedMode;
  /** When this client joined the coach's book, ISO. Null when unknown.
   *
   *  Load-bearing for src/lib/clientDrift.ts: without it, a client added
   *  yesterday and a client silent for eight weeks are indistinguishable —
   *  both have no recent activity, so both read UNKNOWN and the reason says
   *  "nothing recorded in the last 56 days" about somebody who has only been
   *  on the book for one. It also clamps the drift baseline to the period the
   *  client actually existed for, so a real fall is not diluted by weeks they
   *  were not there. coach_clients.created_at has always held this; the roster
   *  selected it and then dropped it on the floor. */
  joinedAt?: string | null;
  /** True when this row is a `coach_clients` note and nothing else — somebody
   *  the coach typed into Add Client, who has no Repple account.
   *
   *  Load-bearing for app/(trainer)/client.tsx, which asks eight questions
   *  about one person and must not ask any of them about this one: every policy
   *  behind those reads goes through `is_my_client()`, which looks in
   *  `clients`, so each of them returns zero rows and NO error — and zero rows
   *  with no error is what this app renders as "they have none". The screen
   *  used to tell the two apart by the id, on the belief that a hand-added
   *  client's id is one the phone invented; `coach_clients.id` is
   *  `uuid DEFAULT gen_random_uuid()`, so it is a real uuid from the first
   *  round trip onward and the id has not been able to answer this since.
   *  See src/lib/clientRecord.ts.
   *
   *  Undefined means the loader did not say — an older cached row, or the first
   *  render before the roster arrives. It is not "false": only an explicit true
   *  withholds a screen. */
  handAdded?: boolean;
  injuries?: { area: string; severity: string; note?: string; isNew?: boolean }[];
  /** Disclosures they have marked recovered. Kept SEPARATE from `injuries`
   *  rather than folded in: the acknowledgement gate and the roster's "Injury"
   *  flag are both about what is live, and a healed knee re-closing a gate or
   *  lighting a warning would be the app being stopped by good news. This is
   *  history — the coach can see what somebody has had, without it counting as
   *  something they have. */
  pastInjuries?: { area: string; severity: string; note?: string }[];
  metrics?: import('./inbodyMetrics').ScanMetrics;
  diet?: string;
  mealsPerDay?: number;
  avoid?: import('./meals').Allergen[];
}
export interface ExVideo { id: string; name: string; group: string; dur: string; uploaded: boolean; url?: string; }

// ── the second definition of "at risk", and where it went ─────────────────
//
// `atRiskClient`, `staleDays` and `noRecordOf` lived here, and every coach
// screen ranked on them: `(adherence != null && adherence < 80) ||
// staleDays(lastActive) >= 2 || noRecordOf(c)`.
//
// Two of those three clauses were not evidence about anybody.
//
//   `staleDays` recovered a number by running /([0-9]+)d/ over `lastActive` —
//   which is a DISPLAY STRING. `ago()` in src/ui/roster.tsx writes "3d ago" for
//   a human to read, and this parsed the 3 back out of it. Reword the caption
//   and the risk model changes.
//
//   `noRecordOf` was true whenever there was no figure and no date. That is the
//   permanent, unchangeable state of every client a coach adds BY HAND —
//   `adherence: null, lastActive: 'added by you'` — so the whole cash half of a
//   working book was flagged "Needs a check-in" for ever. A coach with twenty
//   of them opened their home screen to twenty amber flags that could never
//   clear, and learned inside a week to read past all of them, including the
//   one that was real.
//
// That clause was itself a fix for the opposite bug — a client nothing was
// known about used to read as FINE, absence of evidence as evidence of health
// — and the reason it could not be fixed properly here is in the sentence this
// file already carried: a boolean "cannot express unknown".
//
// src/lib/clientDrift.ts can. `assessDrift` reads each client's own record over
// 56 days, compares their recent fortnight against their own baseline, and has
// a distinct `idle` band for a client there is nothing on record about —
// separately reporting, through `readClientActivity`, which ids the database
// could not be asked about at all, so a hand-added client is UNKNOWN rather
// than at risk. src/ui/clientDrift.ts is the read, shared by the Clients
// screen, Analytics and the Assistant, which is what makes them agree.
//
// Deleted rather than left standing: a second definition that nothing calls is
// the next screen's shortcut.
