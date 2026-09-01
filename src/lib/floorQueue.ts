// The three writes a coach makes standing on a gym floor, and what happens to
// them when there is no signal down there.
//
// ── What was measured ──────────────────────────────────────────────────────
//
// src/lib/offlineQueue.ts is imported by five CLIENT screens and by
// src/ui/workoutLog.tsx. It was imported by no file under app/(trainer)/ at
// all. Meanwhile the three coach screens that are used in the room rather than
// at a desk all wrote straight through:
//
//   app/(trainer)/log-session.tsx    `logForClient`   — an hour of somebody's
//                                    training, typed set by set, gone on a
//                                    failed insert with a red banner.
//   app/(trainer)/class-checkin.tsx  `setAttendance`  — the tick a trainer is
//                                    PAID on, and the one the gym's payroll is
//                                    built from.
//   app/(trainer)/sessions.tsx       `markMyOutcome`  — the same money, one
//                                    session at a time.
//
// And app/(trainer)/classes.tsx already apologises for classes that "are on
// this phone only", which is this problem named on a screen next door.
//
// Basements are where gyms are. A coach who has just spent an hour with
// somebody and loses the record of it does not type it again — they remember it
// wrong a week later, or they stop using the screen.
//
// ── The two rules the reference implementation is built on ─────────────────
//
// src/ui/workoutLog.tsx was brought onto this queue earlier and its header
// states both. They are restated here because every function below exists to
// hold one of them:
//
// 1. A QUEUED WRITE IS NEVER REPORTED AS SAVED. `classifyWrite` in
//    offlineQueue.ts already separates "the server said no" from "nobody
//    answered", and this module never softens the second into the first. The
//    screens say "on this phone" and not "saved", because a coach who believes
//    the gym has the attendance does not check it, and a trainer is paid on it.
//
// 2. A QUEUE THAT HAS NOT BEEN READ IS NOT AN EMPTY QUEUE. `readFloorQueue`
//    returns `read: false` for bytes it could not parse, and the caller must
//    then stop writing the cache — otherwise the next enqueue overwrites an
//    unread queue with one entry and every session already on the phone is
//    gone. This is the same distinction `serverRows` holds for a read and
//    `QueueRead` holds in src/lib/workoutQueue.ts.
//
// ── One queue and not three ────────────────────────────────────────────────
//
// The three acts are different writes against three different tables, and the
// temptation is three queues. It is one, for the reason the count is what a
// coach actually reads: "3 things saved on this phone and not sent yet" is a
// sentence somebody acts on, and three separate counters on three screens is a
// coach who has to visit all three to find out whether their morning is safe.
// The SENDING is per-act and lives with the code that knows each table.
import { unsentNote, type Stamped } from './offlineQueue';

/** One thing a coach did on the floor that has to reach the server.
 *
 *  A closed union rather than a bag of columns: each arm is exactly the
 *  arguments its own sender takes, so a queued act cannot be missing a field
 *  the send needs, and adding a fourth kind is a type error at every site that
 *  has to handle it. */
export type FloorAct =
  /** An hour of training typed into a client's own record. The entries are the
   *  same shape the client's log writes; `coachId` is NOT stored, because the
   *  insert policy requires `logged_by = auth.uid()` and the queue is read back
   *  by whoever is signed in when it flushes. */
  | { kind: 'session-log'; clientId: string; clientName: string | null; entries: unknown[] }
  /** A member ticked present or absent for a class. */
  | { kind: 'class-attendance'; classId: string; userId: string; memberName: string | null; present: boolean }
  /** What became of a PT session, and what it was worth at the moment of
   *  marking. `rateCents` is `undefined` for "do not touch the rate" and null
   *  for "clear it" — the distinction `markMyOutcome` already draws, and
   *  flattening it here would write a zero that reads as a free session. */
  | { kind: 'session-outcome'; sessionId: string; clientName: string | null; outcome: string; rateCents?: number | null };

/** A queued act with the two things every queue entry needs: an id that says it
 *  has not been sent, and the instant it happened. Deliberately the same shape
 *  as `Stamped` in offlineQueue.ts so the shared helpers apply. */
export interface QueuedAct extends Stamped { act: FloorAct }

/**
 * Where one account's unsent floor writes live.
 *
 * Per-account, and that is not tidiness. A gym's front-desk phone is signed in
 * and out all day; a queue shared across accounts would flush one trainer's
 * attendance under the next trainer's name, and attendance is what people are
 * paid on. The same argument `queueCacheKey` makes in src/lib/workoutQueue.ts.
 */
export const floorQueueKey = (uid: string): string => `repple.floorQueue:${uid}`;

/**
 * What identifies an act for the purpose of SUPERSEDING an earlier one.
 *
 * Two of the three acts are a state, not an event. A trainer who ticks somebody
 * present, then absent, then present again while offline has made one decision
 * — present — and sending three writes replays a flicker the gym's record has
 * no use for, with the final answer depending on the order they happen to land
 * in. Same for a session outcome: the last thing the coach chose is the answer.
 *
 * A session LOG is an event and is never collapsed. Two logs for one client are
 * two sessions, and merging them would delete an hour of somebody's training on
 * the grounds that it looked similar. Its key is therefore unique per entry,
 * which is what the queue id gives.
 */
export function supersedeKey(a: FloorAct): string | null {
  switch (a.kind) {
    case 'class-attendance': return `class:${a.classId}:${a.userId}`;
    case 'session-outcome': return `session:${a.sessionId}`;
    case 'session-log': return null;
  }
}

/**
 * The queue after adding one act.
 *
 * An act with a supersede key replaces any earlier queued act carrying the same
 * one, IN PLACE — not appended to the end. Position is when the decision was
 * first made and the timestamp is refreshed to when it was last changed, so a
 * trainer working down a class list does not watch rows jump around while they
 * correct one.
 */
export function enqueueAct(queue: readonly QueuedAct[], entry: QueuedAct): QueuedAct[] {
  const key = supersedeKey(entry.act);
  if (key === null) return [...queue, entry];
  let replaced = false;
  const next = queue.map((q) => {
    if (replaced || supersedeKey(q.act) !== key) return q;
    replaced = true;
    return entry;
  });
  return replaced ? next : [...next, entry];
}

/** The queue after one act has reached the server. Matched on the queue id
 *  rather than on the act, because two class ticks for two members are
 *  different rows that compare equal on everything a shallow check would look
 *  at. */
export function dropSent(queue: readonly QueuedAct[], id: string): QueuedAct[] {
  return queue.filter((q) => q.id !== id);
}

/** What came off the device, and whether anything was actually read.
 *
 *  `read` is the whole point of the type — see rule 2 in the header. */
export interface FloorQueueRead {
  acts: QueuedAct[];
  /** False when the stored queue could not be understood. The caller must then
   *  stop writing the cache, or the next write silently deletes it. */
  read: boolean;
}

/** True for a value that is shaped like something this queue can send. Checked
 *  rather than cast: the bytes come off a device and a build that has been
 *  upgraded may hold entries written by a version that spelled them
 *  differently, and an act missing the field its sender needs would throw
 *  inside the flush and stall every act behind it. */
function usableAct(v: unknown): v is FloorAct {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  switch (a.kind) {
    case 'session-log':
      return typeof a.clientId === 'string' && !!a.clientId && Array.isArray(a.entries) && a.entries.length > 0;
    case 'class-attendance':
      return typeof a.classId === 'string' && !!a.classId
        && typeof a.userId === 'string' && !!a.userId
        && typeof a.present === 'boolean';
    case 'session-outcome':
      return typeof a.sessionId === 'string' && !!a.sessionId
        && typeof a.outcome === 'string' && !!a.outcome;
    default:
      return false;
  }
}

/**
 * The queue, from whatever was on disk.
 *
 * Three inputs and only two of them are answers, exactly as `readQueue` in
 * src/lib/workoutQueue.ts has it:
 *
 *   null / ''        nothing has ever been queued for this account. A real
 *                    answer, and the ordinary one. `read` is true.
 *   a valid array    the queue. `read` is true even when it is empty — a queue
 *                    written empty IS empty.
 *   anything else    NOT an answer. `read` is false and the caller must stop
 *                    writing the cache.
 *
 * Individual entries that are not usable are DROPPED while `read` stays true.
 * That is deliberate and it is the one lossy branch in this file: an entry no
 * sender can take is an entry that would throw on every flush forever, blocking
 * everything queued behind it. The array itself parsed, so the rest of it is
 * known good and must not be thrown away with it.
 */
export function readFloorQueue(raw: string | null | undefined): FloorQueueRead {
  if (raw == null || raw === '') return { acts: [], read: true };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { acts: [], read: false }; }
  if (!Array.isArray(parsed)) return { acts: [], read: false };
  const acts: QueuedAct[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) continue;
    if (typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))) continue;
    if (!usableAct(r.act)) continue;
    acts.push({ id: r.id, at: r.at, act: r.act });
  }
  return { acts, read: true };
}

/** One pending act, in the coach's words, for the list that says what is still
 *  on the phone. Never claims anything reached anybody. */
export function actLine(a: FloorAct): string {
  switch (a.kind) {
    case 'session-log': {
      const n = a.entries.length;
      const who = a.clientName?.trim();
      return `${n} exercise${n === 1 ? '' : 's'} for ${who || 'a client'}`;
    }
    case 'class-attendance': {
      const who = a.memberName?.trim();
      return `${who || 'A member'} marked ${a.present ? 'present' : 'absent'}`;
    }
    case 'session-outcome': {
      const who = a.clientName?.trim();
      return `${who ? `${who}’s session` : 'A session'} marked ${a.outcome.replace(/_/g, ' ')}`;
    }
  }
}

/**
 * The sentence a coach sees about what is still on the phone, or null for an
 * empty queue.
 *
 * `unsentNote` from offlineQueue.ts, with this queue's noun, because the
 * delicate part is stated once there: the work is NOT lost, it is counted, it
 * will go — and none of that may imply it has reached anybody. A trainer whose
 * attendance is in this queue must not believe the gym has it.
 */
export function floorPendingNote(n: number): string | null {
  return unsentNote(n, 'change', 'changes');
}

/**
 * What to say when a write did not reach the server but was kept.
 *
 * Separate from `floorPendingNote` because it is said at the moment of the tap,
 * when a coach is about to walk away from the screen believing the thing is
 * done. `what` is that act in their words — "This session", "That tick".
 */
export function keptOfflineLine(what: string): string {
  return `${what} is saved on this phone and has not reached the server yet, so nobody else can see it. It goes up next time this app has signal.`;
}

/**
 * And what to say when the server ANSWERED and refused.
 *
 * Not queued, because the same bytes will be refused every time they are
 * offered — and a coach who is told something is waiting to send, when it never
 * will, has been given a worse lie than "it failed". `why` is the reason the
 * caller already has.
 */
export function refusedLine(what: string, why: string | null): string {
  const tail = why && why.trim() ? ` ${why.trim().replace(/\s*$/, '')}` : '';
  return `${what} was not saved and is not waiting to send — the server read it and declined.${tail}`;
}
