// The writes that are allowed to wait, for the surfaces that had no queue.
//
// ── What was actually wrong ────────────────────────────────────────────────
//
// src/lib/offlineQueue.ts decides whether a failed write is worth keeping, and
// four providers act on that decision: the workout log, the food log, habits
// and check-ins. Every other write in the client app had no second half at all.
// A message typed on a treadmill, a tape measurement taken in the changing
// room, an injury disclosed on the way in, a PT session approved at reception —
// all of them called `insert`, caught the throw, returned false and forgot the
// content. The member saw a sentence saying it did not send. The words were
// gone.
//
// This file is the durable half those four surfaces did not have: an intent,
// written to the device, replayed when the app can reach the server again
// (src/lib/offlineQueue.ts · `flushAll`, driven by src/lib/reachability.ts).
//
// ── What is deliberately NOT in here, and why ──────────────────────────────
//
// A queue is not free. Replaying a write later is only honest when the answer
// the server would have given now is the answer it will give then. Four kinds
// of write in this app fail that test and are deliberately left to fail
// immediately, with a sentence that says so:
//
//   · BOOKING A CLASS OR A PT SLOT. A seat is a scarce thing somebody else can
//     take. Queueing the intent means telling a member "we will book you when
//     you have signal", and forty minutes later the class is full and they have
//     arranged their evening around a place they never had. The honest answer
//     offline is that nothing was booked — which is what src/ui/classes.tsx
//     already returns, and what `retryLine` now explains properly.
//
//   · CANCELLING ONE. The consequences are computed against the policy at the
//     moment of cancelling: whether a pack credit comes back, whether a late
//     fee applies, whether the slot is re-offered, whether the coach is paged.
//     A cancellation replayed two hours later is a different cancellation, and
//     the member has already been marked absent for the one they thought they
//     had made. Failing loudly lets them ring the gym, which is the thing that
//     actually saves them the no-show fee.
//
//   · SPENDING MONEY — redeeming an offer, buying a pack, taking a payment.
//     Nothing in this app may move money on a device's word alone, and a
//     replayed purchase is the classic double charge.
//
//   · ANYTHING CARRYING A FILE. A photo, a scan, an injury document. The queue
//     holds JSON in AsyncStorage; the file lives in a cache directory the OS is
//     free to empty, so a queued upload is an intent whose subject may not
//     exist by the time it runs. src/ui/messaging.ts therefore queues text and
//     refuses to queue an attachment, and says which.
//
// Everything left is a write about the member's own record that says the same
// thing whenever it lands. Those are the ones in here.
//
// ── The three that were left out of "everything left" ─────────────────────
//
// That closing rule was written with three kinds behind it and it admitted
// three more, which had no queue for no reason anybody had decided on: the goal
// a member sets (src/ui/goalTracker.tsx), the day they mark on the calendar
// (app/(client)/calendar.tsx) and a blood sugar reading they type
// (src/ui/glucoseData.ts). Every one is a statement about the member's own
// record, none is scarce, none costs money and none carries a file, and all
// three said "it isn't stored" and dropped what was typed. They are 'goal',
// 'day-plan' and 'glucose' below, and src/lib/recordQueue.ts holds their
// payloads.
//
// One of them needed the expiry this file already had and nothing used: a
// planned day is a plan, and `canPlan` refuses to mark a date that has gone.
// An intent to mark next Tuesday that surfaces on Wednesday is not a late plan,
// it is a claim about the past, and this table is explicitly not where a claim
// about the past gets to live. So a day-plan intent expires with its own day —
// see `planExpiry` — and comes back through `partitionLapsed` to be said out
// loud rather than written.
//
// ── The one that is handled somewhere else, deliberately ──────────────────
//
// An injury disclosure is not a kind here, and that is not an omission. It is
// written as part of the client's profile row (src/ui/clientData.tsx), which
// already caches the whole profile to this device and re-sends it as an UPDATE
// from state. For a write shaped like that there is nothing to queue that state
// is not already holding — "send it again" and "send what is on screen" are the
// same instruction. What was missing was only the TRIGGER, and that file now
// registers with src/lib/offlineQueue.ts · `flushAll` like everything else, so a
// knee disclosed in a basement goes up on the reconnect rather than waiting for
// the next thing the member happens to edit.

import { LOCAL_PREFIX } from './wellnessSync';

/**
 * The surfaces with a durable queue.
 *
 * A closed union rather than a string, because the handler registry is keyed on
 * it: a kind with no handler is an item that sits on the phone forever being
 * counted as "waiting to send" by a screen and picked up by nothing.
 */
export type OutboxKind =
  | 'message' | 'measurement' | 'pt-approval'
  | 'goal' | 'day-plan' | 'glucose';

/**
 * The same kinds as a list, for a caller that has to walk them.
 *
 * The union is the authority and this is derived from it by hand, which is the
 * one thing worth watching: `src/lib/outbox.test.ts` asserts every member of
 * the union has an entry here, so a kind added to the type without being added
 * to this list fails the suite rather than going quietly unrendered — the exact
 * failure mode of the sentences this list exists to draw.
 */
export const OUTBOX_KINDS: readonly OutboxKind[] = [
  'message', 'measurement', 'pt-approval', 'goal', 'day-plan', 'glucose',
];

export interface OutboxItem {
  /** Device-local and unique. Prefixed like every other unsent id in this app
   *  (src/lib/wellnessSync.ts) so it can never be mistaken for a server key. */
  id: string;
  kind: OutboxKind;
  /** When the member did the thing — NOT when it is sent. Every payload here
   *  carries its own moment for the same reason the food log does: a
   *  measurement taken on Tuesday is Tuesday's, whenever it reaches the server.
   */
  at: string;
  /** Whatever the handler needs, and nothing that cannot be serialised. */
  payload: unknown;
  /** How many times a handler has tried and been given no answer. Never resets;
   *  it is what tells a diagnostics screen the difference between a phone that
   *  has been offline once and one that cannot talk to us at all. */
  tries: number;
  /**
   * After this instant the intent is meaningless and must not be replayed.
   *
   * Null for the ordinary case — a measurement is still a measurement next
   * week. Set where lateness changes the meaning, and read by
   * `partitionLapsed`, which takes those items OUT rather than sending them.
   */
  expiresAt?: string | null;
}

/** Where one account's outbox lives. Per account, because two people sharing a
 *  phone must not inherit each other's unsent writes. */
export const OUTBOX_PREFIX = 'outbox:v1:';
export const outboxKey = (uid: string): string => `${OUTBOX_PREFIX}${uid}`;

/**
 * How many intents one device will hold.
 *
 * There is a number here for a reason that is not tidiness: AsyncStorage on
 * Android is one SQLite row per key and a runaway queue is a write that starts
 * failing, which would take the whole outbox with it. Two hundred is weeks of
 * ordinary use for one person.
 *
 * `add` REFUSES past the cap rather than evicting. Evicting the oldest is the
 * obvious implementation and it is silent data loss chosen by a constant; a
 * refusal is a thing the caller can put in front of somebody.
 */
export const OUTBOX_CAP = 200;

let SEQ = 0;
/** A new intent. `at` defaults to now and is the member's moment, not the
 *  send's. */
export function newItem(
  kind: OutboxKind,
  payload: unknown,
  opts: { at?: string; expiresAt?: string | null } = {},
): OutboxItem {
  return {
    id: `${LOCAL_PREFIX}ob.${Date.now().toString(36)}.${SEQ++}`,
    kind,
    at: opts.at ?? new Date().toISOString(),
    payload,
    tries: 0,
    expiresAt: opts.expiresAt ?? null,
  };
}

/**
 * What is on the device, and whether we managed to read it.
 *
 * The two halves are the whole point, and it is the same rule
 * src/lib/workoutQueue.ts states for its own cache: bytes nobody could parse
 * are NOT an empty queue. A caller that collapses them writes its own list
 * straight over the top of intents it never saw. `read: false` is the signal to
 * stop writing until the next launch can read the key cleanly.
 *
 * null raw — the key has never been written — IS a real empty queue and comes
 * back `read: true`. That is the ordinary case for every account that has never
 * been offline.
 */
export function readOutbox(raw: string | null | undefined): { items: OutboxItem[]; read: boolean } {
  if (raw == null) return { items: [], read: true };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { items: [], read: false };
    const items: OutboxItem[] = [];
    for (const r of parsed) {
      if (!r || typeof r !== 'object') continue;
      const kind = String((r as any).kind ?? '');
      const id = String((r as any).id ?? '');
      const at = String((r as any).at ?? '');
      // A row missing any of the three cannot be sent OR identified, and
      // keeping it would make it permanently uncountable. Dropping one bad row
      // is not the same event as failing to read the file, so `read` stays
      // true: the rest are known good and may be written back.
      if (!id || !at || !isOutboxKind(kind)) continue;
      items.push({
        id, kind, at,
        payload: (r as any).payload,
        tries: Number.isFinite((r as any).tries) ? Number((r as any).tries) : 0,
        expiresAt: typeof (r as any).expiresAt === 'string' ? (r as any).expiresAt : null,
      });
    }
    return { items, read: true };
  } catch {
    return { items: [], read: false };
  }
}

// The same list as `OUTBOX_KINDS`, deliberately, rather than a second one: a
// private copy here was how a new kind could become readable from storage
// without ever being drawn on a screen.
export const isOutboxKind = (s: string): s is OutboxKind => (OUTBOX_KINDS as readonly string[]).includes(s);

/**
 * Add one intent.
 *
 * `added` is false only when the cap is reached, and the list comes back
 * unchanged so the caller can say "this phone is holding as much as it can"
 * rather than quietly losing either this write or the oldest one.
 */
export function addItem(list: OutboxItem[], item: OutboxItem): { list: OutboxItem[]; added: boolean } {
  if (list.length >= OUTBOX_CAP) return { list, added: false };
  return { list: [...list, item], added: true };
}

/** Remove one, by id. Used on 'stored' and on 'refused' alike — a refusal
 *  offered again gets the same refusal, which offlineQueue.ts argues at
 *  length. */
export const dropItem = (list: OutboxItem[], id: string): OutboxItem[] => list.filter((i) => i.id !== id);

/** Record that a send was attempted and nobody answered. */
export const bumpTry = (list: OutboxItem[], id: string): OutboxItem[] =>
  list.map((i) => (i.id === id ? { ...i, tries: i.tries + 1 } : i));

/** Everything of one kind, oldest first — which is the order they must be sent
 *  in. A thread is a conversation and two messages typed offline arriving in
 *  the wrong order is a different conversation. */
export const ofKind = (list: OutboxItem[], kind: OutboxKind): OutboxItem[] =>
  list.filter((i) => i.kind === kind).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/** Oldest first across every kind, for a flush that sends the lot. */
export const inOrder = (list: OutboxItem[]): OutboxItem[] =>
  [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/**
 * Split off the intents that have stopped meaning anything.
 *
 * Returned rather than deleted, because a lapsed intent is the one case where
 * the member has to be told: they typed something, it never went, and it is not
 * going to. Dropping it silently is exactly the failure this whole file is
 * about, moved later in time.
 */
export function partitionLapsed(list: OutboxItem[], now: number = Date.now()): { live: OutboxItem[]; lapsed: OutboxItem[] } {
  const live: OutboxItem[] = [];
  const lapsed: OutboxItem[] = [];
  for (const i of list) {
    const t = i.expiresAt ? Date.parse(i.expiresAt) : NaN;
    // An unparseable expiry is treated as no expiry. The alternative — treating
    // it as already lapsed — throws away a member's write on the strength of a
    // string this file failed to read.
    if (Number.isFinite(t) && t <= now) lapsed.push(i); else live.push(i);
  }
  return { live, lapsed };
}

/** What one of these is called, for a sentence. Plural given explicitly rather
 *  than by adding an s, so a kind whose plural is irregular cannot be added
 *  later without noticing. */
export function kindNoun(kind: OutboxKind): { one: string; many: string } {
  switch (kind) {
    case 'message': return { one: 'message', many: 'messages' };
    case 'measurement': return { one: 'measurement', many: 'measurements' };
    case 'pt-approval': return { one: 'session approval', many: 'session approvals' };
    // Named the way the member would name them, not the way the table does.
    // "A planned day was waiting to send for too long" is a sentence somebody
    // can act on; "a planned_days row" is not.
    case 'goal': return { one: 'goal', many: 'goals' };
    case 'day-plan': return { one: 'planned day', many: 'planned days' };
    case 'glucose': return { one: 'blood sugar reading', many: 'blood sugar readings' };
  }
}

/**
 * The sentence for a screen that is holding `n` of one kind.
 *
 * Deliberately the same shape and the same promise as
 * src/lib/offlineQueue.ts · `unsentNote`, because a member should not have to
 * learn two vocabularies for the same situation, and because the delicate part
 * is identical: the work is NOT lost, it has NOT been delivered, and nobody has
 * read it. A client whose injury note is sitting here must not believe their
 * coach has seen it.
 *
 * Null for zero, so a caller can render it unconditionally without drawing an
 * empty banner about nothing.
 */
export function outboxNote(n: number, kind: OutboxKind): string | null {
  if (n <= 0) return null;
  const { one, many } = kindNoun(kind);
  return `${n} ${n === 1 ? one : many} saved on this phone and not sent yet — ${n === 1 ? 'it goes' : 'they go'} up next time you have signal.`;
}

/**
 * The sentence for something that waited too long to be worth sending.
 *
 * Names what it was and states plainly that it did not happen, because the
 * member's model is that it did.
 */
export function lapsedNote(kind: OutboxKind): string {
  const { one } = kindNoun(kind);
  return `A ${one} was waiting to send for too long, so it was not sent. Nothing reached anyone and you may want to do it again.`;
}
