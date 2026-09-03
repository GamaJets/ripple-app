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
   *  by whoever is signed in when it flushes.
   *
   *  `sessionId` is the booked session this hour was, when the coach came here
   *  from one (supabase/parts/890). Optional and usually absent: a client's own
   *  workout and a coach's own training have no session, and neither does an
   *  hour typed up from the coach's directory rather than from the queue. It is
   *  stored on the act rather than resolved at flush time because the coach
   *  said which session this was when they pressed Save, and re-deciding that
   *  three hours later against whatever is nearest in the diary would file an
   *  hour of training under the wrong booking. */
  | { kind: 'session-log'; clientId: string; clientName: string | null; entries: unknown[]; sessionId?: string | null }
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
 * ── And the third, which used to return null ──────────────────────────────
 *
 * A session LOG is an event, and the note here used to stop at that: two logs
 * for one client are two sessions, so it was given no key at all and every
 * offer of one appended.
 *
 * That is right about two SESSIONS and wrong about one session offered twice.
 * app/(trainer)/log-session.tsx writes through the server first and falls back
 * to this queue, and a flush re-offers whatever it could not send — so the same
 * hour of training could be queued behind a copy of itself, and what a client
 * ends up with is the session in their history twice, on a day they trained
 * once. Nobody can tell which of the two to delete, and the client cannot
 * delete either: their coach typed them.
 *
 * So the key is the act's CONTENTS — the client, and every entry exactly as it
 * will be written. That keeps the promise the old note was making, because two
 * real sessions cannot agree on it: `logStamp` in src/lib/sessionWhen.ts carries
 * the second and millisecond of saving into every entry's timestamp, so two
 * sessions typed on the same evening differ even when the exercises and the
 * sets are identical. What DOES agree on it is the one thing that should: the
 * same array of entries, offered again because the first offer was not
 * answered.
 *
 * Contents rather than a hash of them. A hash is shorter and a collision here
 * deletes an hour of somebody's training, which is the exact harm this is
 * being added to prevent — so there is no hash.
 */
export function supersedeKey(a: FloorAct): string | null {
  switch (a.kind) {
    case 'class-attendance': return `class:${a.classId}:${a.userId}`;
    case 'session-outcome': return `session:${a.sessionId}`;
    case 'session-log': {
      const body = logBody(a.entries);
      // Entries that will not serialise cannot reach the device either, so
      // there is nothing to key on. Falls back to the old behaviour — never
      // collapsed — which is the safe direction: a duplicate can be deleted,
      // and a session collapsed into another one cannot be got back.
      //
      // The SESSION is part of the identity. Two offers of the same entries
      // filed under two different bookings are two different writes and must
      // not supersede each other — the empty segment is what an act with no
      // session keys on, so an act queued by a build before supabase/parts/890
      // keys exactly as it always did.
      return body == null ? null : `log:${a.clientId}:${a.sessionId ?? ''}:${body}`;
    }
  }
}

/** The entries as one comparable string, or null when they will not serialise.
 *
 *  `JSON.stringify` and not a field-by-field walk, because the entries are
 *  `unknown[]` here on purpose — this module does not own the shape of a
 *  workout entry and must not start deciding which of its fields count. The
 *  same bytes go to the device, so an act read back off disk keys the same as
 *  the one that was written. */
function logBody(entries: readonly unknown[]): string | null {
  try { return JSON.stringify(entries) ?? null; } catch { return null; }
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
      // `sessionId` is optional, so absent is fine — but a value of the wrong
      // SHAPE is not silently carried: it would reach the insert as a
      // `session_id` PostgREST refuses, and take a whole hour of somebody's
      // training down with it. Anything that is not a string is treated as an
      // act this build cannot send, which is what this function is for.
      return typeof a.clientId === 'string' && !!a.clientId
        && Array.isArray(a.entries) && a.entries.length > 0
        && (a.sessionId == null || (typeof a.sessionId === 'string' && !!a.sessionId));
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
 * The footnote under a class register: who can see the ticks that have just
 * been made.
 *
 * app/(trainer)/class-checkin.tsx printed one sentence unconditionally —
 * "Check-ins are saved as you tap. Your gym owner sees attendance per class for
 * payroll and class analytics." — including while this queue was holding every
 * tick on the phone. That is rule 1 in the header of this file broken on the
 * one screen it was written for: a trainer who believes the gym has the
 * attendance does not check it, and they are paid on it. The banner above the
 * roster said the opposite at the same moment, and the footnote is the calmer
 * of the two sentences, which is the one a person believes.
 *
 * Three answers and they are three different facts:
 *
 *   · the queue could not be read — whether anything is waiting is UNKNOWN, so
 *     neither "the gym has it" nor "the gym does not" may be said.
 *   · something is waiting — the gym has the ticks that went up and not the
 *     ones on this phone, and the coach is told which state they are in.
 *   · nothing is waiting — the ordinary sentence, and now it is true.
 */
export function registerVisibilityLine(unsent: number, queueRead: boolean): string {
  if (!queueRead) {
    return 'What this phone is still carrying could not be read, so whether your gym owner has today’s check-ins is not known. Open this class again once you have signal before payroll is settled.';
  }
  if (unsent > 0) {
    return `${unsent} check-in${unsent === 1 ? '' : 's'} ${unsent === 1 ? 'is' : 'are'} still on this phone and your gym owner cannot see ${unsent === 1 ? 'it' : 'them'} yet. Everything that has reached the server is on their payroll and class analytics; the rest goes up next time this app has signal.`;
  }
  return 'Check-ins are saved as you tap. Your gym owner sees attendance per class for payroll and class analytics.';
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

/**
 * What to say after a coach has pressed the send button and the flush is over.
 *
 * Three numbers and they mean three different things, so this never collapses
 * them into "done". `sent` reached the server. `refused` was read and declined,
 * and is GONE from the queue rather than waiting, which the coach has to be
 * told or they will keep pressing a button for something that will never go.
 * `kept` is still on the phone because nobody answered, which is not a failure
 * of the tap and must not read as one.
 *
 * Null for a flush that had nothing to do, so the caller can stay silent rather
 * than raise an alert saying nothing happened.
 */
export function flushResultLine(r: { sent: number; refused: number; kept: number }): string | null {
  const parts: string[] = [];
  if (r.sent > 0) parts.push(`${r.sent} ${r.sent === 1 ? 'change' : 'changes'} went up.`);
  if (r.refused > 0) {
    parts.push(`${r.refused} ${r.refused === 1 ? 'was' : 'were'} read by the server and declined, so ${r.refused === 1 ? 'it is' : 'they are'} no longer waiting to send.`);
  }
  if (r.kept > 0) {
    parts.push(`${r.kept} could not be sent because nobody answered, so ${r.kept === 1 ? 'it is' : 'they are'} still on this phone and will be tried again.`);
  }
  if (parts.length === 0) return null;
  return parts.join(' ');
}
