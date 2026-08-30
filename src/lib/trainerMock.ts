// Trainer-portal shapes, the shared at-risk rule, and the built-in exercise
// library.
//
// ROSTER is empty. It previously held five invented clients ("Jordan P.",
// "Sam R.", "Alex M.", "Priya N.") with invented adherence, weight deltas and
// injuries, which shipped in the production bundle.
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
  adherence: number | null; lastActive: string; next: string; unread: number;
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
  injuries?: { area: string; severity: string; note?: string; isNew?: boolean }[];
  metrics?: import('./inbodyMetrics').ScanMetrics;
  diet?: string;
  mealsPerDay?: number;
  avoid?: import('./meals').Allergen[];
}
export const ROSTER: RosterClient[] = [];
export interface ExVideo { id: string; name: string; group: string; dur: string; uploaded: boolean; url?: string; }

// Shared "at-risk" definition so every trainer screen agrees (adherence low OR
// inactive 2+ days, OR nothing recorded at all).
//
// THAT LAST CLAUSE IS A BUG FIX, and it is worth knowing why it was missing.
// A client with no record has `adherence === null`, so the first clause is
// false; and `lastActive` for them is the string 'no activity yet', from which
// staleDays parses 0, so the second clause is false too. The function therefore
// returned FALSE — "this client is fine" — for a client it had never seen a
// single data point from. Absence of evidence read as evidence of health, on
// the screen a coach uses to decide who to ring.
//
// It cannot express "unknown", being a boolean, so it now errs toward
// surfacing: a client nothing is known about is returned as needing attention.
// Over-flagging costs a coach one unnecessary look; under-flagging is how
// somebody leaves without anyone noticing. src/lib/clientDrift.ts models this
// properly with a distinct UNKNOWN band and is what the Clients screen ranks on
// — this function remains for the screens that have not moved to it yet.
export function staleDays(str: string): number { const m = /([0-9]+)d/.exec(str || ''); return m ? parseInt(m[1], 10) : 0; }
export function noRecordOf(c: { adherence: number | null; lastActive: string }): boolean {
  return c.adherence == null && !/[0-9]+d/.test(c.lastActive || '');
}
export function atRiskClient(c: { adherence: number | null; lastActive: string }): boolean {
  return (c.adherence != null && c.adherence < 80) || staleDays(c.lastActive) >= 2 || noRecordOf(c);
}
// Built-in exercise library. Each ships with a real proper-form demo (opens
// relevant videos so the row is never a dead end); a trainer replaces any of
// these with their own recorded clip from the Videos screen.
const demo = (q: string) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' proper form technique');
export const EX_VIDEOS: ExVideo[] = [
  { id: 'v1', name: 'Back Squat', group: 'Legs', dur: '', uploaded: true, url: demo('barbell back squat') },
  { id: 'v2', name: 'Barbell Bench Press', group: 'Chest', dur: '', uploaded: true, url: demo('barbell bench press') },
  { id: 'v3', name: 'Romanian Deadlift', group: 'Hamstrings', dur: '', uploaded: true, url: demo('romanian deadlift') },
  { id: 'v4', name: 'Pull-up', group: 'Back', dur: '', uploaded: true, url: demo('pull up') },
  { id: 'v5', name: 'Overhead Press', group: 'Shoulders', dur: '', uploaded: true, url: demo('overhead barbell press') },
  { id: 'v6', name: 'Walking Lunge', group: 'Legs', dur: '', uploaded: true, url: demo('walking lunge') },
];
