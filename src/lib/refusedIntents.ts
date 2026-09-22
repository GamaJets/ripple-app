// The queued writes the server considered and declined — which nobody was told
// about, everywhere except chat.
//
// ── The silence, one table over ────────────────────────────────────────────
//
// src/lib/refusedMessages.ts found this for MESSAGES and says it in full: there
// are three ends a queued write can come to (src/lib/offlineQueue.ts ·
// `WriteOutcome`) —
//
//   `stored`   the row is on the server. A fact.
//   `unsent`   it is on this handset, counted, and goes when there is signal.
//              That word is a PROMISE: the row is kept, counted and offered
//              again on the next launch.
//   `refused`  the server answered and said no. It will be refused every time
//              it is offered, so it must NOT sit in a queue retrying forever.
//
// — and that the third one reached no screen: `flush` in src/ui/outbox.tsx
// drops a refused item exactly as it drops a stored one, so the "waiting to
// send" mark comes off both and the two become indistinguishable.
//
// That repair reached the `message` kind and stopped there, because it keeps
// the WORDS and only a message has words. The other eight kinds in
// `OutboxKind` were left with the original defect, and it is not smaller for
// having no text in it:
//
//   · a member sets a goal in a basement studio. The goals screen draws it from
//     the outbox under the outbox's own id. The flush meets a refusal —
//     `goal_targets`' own policy, a coaching link that ended while the phone was
//     in a pocket — `onGoalSettled` fires, the row is taken off the list, and
//     the goal they set disappears with nothing said. They believe it is set.
//   · a member asks their coach for Tuesday at seven. `request_session` answers
//     with a reason — no coach on the account, too many outstanding — the item
//     is dropped, and they go on waiting for an answer to a question nobody was
//     ever asked.
//   · a member signs their coach's document at the studio door. The acceptance
//     is refused, comes out of the queue, and the paperwork screen goes back to
//     asking them to sign something they believe they have signed.
//
// ── What this file is ──────────────────────────────────────────────────────
//
// The device's record of those refusals, and the sentences a screen says about
// them. Like its sibling it is a RECORD and not a retry: nothing here ever
// offers anything to the server again, because the server has already answered.
// What it does is keep the fact, so the person who did the thing finds out that
// it did not happen.
//
// ── Why it is not the outbox, and not the lapse notices ───────────────────
//
// Not the outbox, for the reason src/lib/offlineQueue.ts gives: a refusal
// offered again gets the same refusal, and a queue that keeps it reads "3
// waiting to send" for the life of the install — three words that would be
// false in every one of them, because nothing is waiting and nothing will be
// sent.
//
// Not `outboxLapsedKey` either, and that one is the closer call: both are
// notices about an intent that left the queue unsent, both are held on the
// device until acknowledged, and the dashboard already draws the lapsed ones.
// They are kept apart because `lapsedNote` says "was waiting to send for too
// long", and that is a statement about time which is FALSE of a refusal — the
// server was reached, it looked, and it said no. Folding the two would put the
// wrong explanation in front of the member, and the explanation is the only
// thing either notice carries.
//
// ── Account scope ──────────────────────────────────────────────────────────
//
// Per account, like every other handset store here. `refusedIntentsKey` refuses
// a null, a blank and the literal 'unknown' — see src/lib/deviceAccountCache.ts,
// whose `accountCacheKey` this composes through rather than repeating. There is
// no legacy key: nothing has ever written this store, so there is nothing on any
// handset to remove or to migrate.
//
// Pure and framework-free; asserted under plain node in refusedIntents.test.ts.
// The storage is src/ui/outbox.tsx.
import { accountCacheKey } from './deviceAccountCache';
import { kindNoun, isOutboxKind, type OutboxKind } from './outbox';
import type { WriteOutcome } from './offlineQueue';
import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';

/**
 * The kind whose refusals are kept somewhere ELSE, and must not be kept twice.
 *
 * src/lib/refusedMessages.ts holds a refused message with its body, because the
 * words are the thing the person wants back. A second record here would show
 * them the same refusal twice — once with their words and once as "a message" —
 * and two notices about one event read as two events.
 */
const KEPT_ELSEWHERE: OutboxKind = 'message';

/**
 * What `flush` does with one item, given what the handler answered.
 *
 * Three outcomes and three actions, and the whole point of naming them is that
 * the first two must not collapse: `stored` and `refused` are both DROPPED from
 * the queue — offering a refusal again gets the same refusal — and that shared
 * drop is exactly what made a declined write look like a delivered one.
 */
export type FlushStep =
  /** It is on the server. Take it out; there is nothing to say. */
  | 'drop'
  /** The server said no. Take it out AND write the refusal down, because
   *  dropping it is the last moment anything knows it existed. */
  | 'drop-and-record'
  /** Nobody answered. It stays, stays counted, and is offered again. */
  | 'retry-later';

/**
 * The decision above, made once.
 *
 * Here rather than inline in the flush for the reason src/ui/outbox.tsx gives
 * about its handler registry: a rule written at the point of use is a rule the
 * next branch added beside it does not follow. It is also the only form of this
 * decision that a plain `node` test can reach — the flush itself is inside a
 * React provider that imports `react-native` through `./supabase`.
 *
 * `message` is dropped WITHOUT a record here and that is not an omission — see
 * `KEPT_ELSEWHERE`. It is expressed as a kind check rather than left to the
 * caller, because "remember not to double-record chat" is precisely the thing a
 * caller forgets.
 */
export function flushStep(kind: OutboxKind, outcome: WriteOutcome): FlushStep {
  if (outcome === 'stored') return 'drop';
  if (outcome === 'refused') return kind === KEPT_ELSEWHERE ? 'drop' : 'drop-and-record';
  return 'retry-later';
}

/**
 * What a handler answers for a stored payload this build cannot read.
 *
 * `refused`, and it is written down here rather than typed at each of the six
 * handlers because the tempting answer is the wrong one. `unsent` reads as the
 * kind thing to say — it keeps the member's write — but it is a PROMISE that
 * the row will be sent on the next launch, and nothing can ever send bytes
 * nothing can parse. What it actually buys is an item retried on every
 * reconnect for the life of the install, counted forever in "waiting to send",
 * against a member who is waiting for something that cannot happen.
 *
 * Refused is the truth: this has been looked at and it is not going. The flush
 * then records it, so the member is told rather than simply relieved of it.
 */
export const UNREADABLE_PAYLOAD: WriteOutcome = 'refused';

/** One queued write the server declined. */
export interface RefusedIntent {
  /** The outbox item's own id — the id an optimistic row on a screen was keyed
   *  onto, so a screen can tell a refusal it has already drawn from a new one,
   *  and the handle the person dismisses it by. */
  id: string;
  /** Which surface it came from. What the member is told it WAS. */
  kind: OutboxKind;
  /** When the member did the thing on this phone, ISO. Empty when nothing
   *  readable came with it — never replaced by the moment of the refusal, which
   *  is a different time and would read as the moment they did it. */
  at: string;
}

/** Every refused-intent key starts with this. */
export const REFUSED_INTENTS_PREFIX = 'outbox:refused:v1:';

/**
 * How many refusals one handset keeps.
 *
 * Small, for the reason `MAX_REFUSED` is small: this is a record for a person to
 * read and act on, not a log. When it is full the OLDEST goes — the newest
 * refusal is the one they are most likely to still be able to do something
 * about, and it is the only direction that cannot let a stuck handset push
 * today's refusal out with last month's.
 */
export const MAX_REFUSED_INTENTS = 20;

/**
 * Where this account's refused intents live, or null when there is no account
 * to attribute them to.
 *
 * Null means DO NOT PERSIST, never a fallback to an unqualified key: a gym
 * handset is signed in and out all day, and "a body scan of yours was refused"
 * shown to the next person is both wrong and somebody else's.
 */
export function refusedIntentsKey(uid: string | null | undefined): string | null {
  return accountCacheKey(REFUSED_INTENTS_PREFIX, uid);
}

/** Whether a stored key holds somebody's refused intents. Account-scoped, so it
 *  SURVIVES a sign-out exactly as the per-account outbox does — the person it
 *  belongs to has still not been told. */
export const isRefusedIntentsKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(REFUSED_INTENTS_PREFIX) && k.length > REFUSED_INTENTS_PREFIX.length;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The refusals read back off a stored string.
 *
 * Every field is checked rather than trusted. An entry with no `id` is dropped,
 * because the id is what a screen dismisses one by and an entry nobody can
 * dismiss sits there forever; an entry whose `kind` is not one this build knows
 * is dropped too, because `kindNoun` would have no noun for it and the notice
 * would be a sentence with a hole where the thing goes.
 *
 * An unreadable blob is NO refusals, and that is not a failed read being called
 * an empty one: the caller keeps its own status, and a read that THREW is
 * 'error' at the provider, where `refusedIntentsScreenNote` says so out loud.
 */
export function readRefusedIntents(raw: string | null | undefined): RefusedIntent[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: RefusedIntent[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const v = entry as Record<string, unknown>;
    const id = text(v.id);
    if (!id || seen.has(id)) continue;
    const kind = text(v.kind);
    if (!isOutboxKind(kind)) continue;
    seen.add(id);
    const at = text(v.at);
    out.push({
      id,
      kind,
      // A stamp that will not parse is kept as no stamp at all. It must not
      // become the moment of the read, which is what an undated intent rendered
      // through a relative formatter turns into: "just now".
      at: at && Number.isFinite(Date.parse(at)) ? at : '',
    });
  }
  return out;
}

/** The refusals as they go to the store. Routed through the reader so what is
 *  written is exactly what will be read back. */
export function writeRefusedIntents(list: readonly RefusedIntent[]): string {
  return JSON.stringify(readRefusedIntents(JSON.stringify(list ?? [])));
}

/**
 * Add one refusal to the record.
 *
 * Newest last, capped by dropping from the FRONT. An id already in the list
 * replaces its entry rather than appearing twice: the flush re-checks
 * membership before each item, but two providers mounted at once would
 * otherwise record one refusal twice and the member would read it as two things
 * that did not happen.
 */
export function recordRefusedIntent(
  list: readonly RefusedIntent[],
  item: RefusedIntent,
): RefusedIntent[] {
  const id = text(item?.id);
  if (!id || !isOutboxKind(String(item?.kind))) return list.slice();
  const kept = list.filter((r) => r.id !== id);
  kept.push({ id, kind: item.kind, at: text(item.at) });
  return kept.length > MAX_REFUSED_INTENTS ? kept.slice(kept.length - MAX_REFUSED_INTENTS) : kept;
}

/** Take one out, because the person has read it. Never called by anything but a
 *  gesture: nothing expires these, because nothing else will ever tell them. */
export function dropRefusedIntent(list: readonly RefusedIntent[], id: string): RefusedIntent[] {
  const want = text(id);
  return list.filter((r) => r.id !== want);
}

/** The refusals of one kind. What the dashboard draws a notice per — one line
 *  per kind, the way it already does for the lapsed ones, because three refused
 *  planned days are one thing to say. */
export function refusedIntentsOfKind(
  list: readonly RefusedIntent[],
  kind: OutboxKind,
): RefusedIntent[] {
  return list.filter((r) => r.kind === kind);
}

/** The kinds this record is holding something for, in `OutboxKind` order so the
 *  notices do not reshuffle between reads. */
export function refusedIntentKinds(list: readonly RefusedIntent[]): OutboxKind[] {
  const out: OutboxKind[] = [];
  for (const r of list) if (!out.includes(r.kind)) out.push(r.kind);
  return out;
}

/**
 * The sentence for `n` refusals of one kind.
 *
 * Three things, all load-bearing and all of them the opposite of
 * `outboxNote`'s: it was NOT sent, it will NOT be sent, and the member has to
 * do it again if they still want it. The words "waiting to send" must never
 * appear here — that is the promise the outbox makes about an item it is still
 * holding, and this is the one case where there is nothing left to hold.
 *
 * Null for zero, so a caller can render it unconditionally without drawing an
 * empty banner about nothing.
 */
export function refusedIntentNote(n: number, kind: OutboxKind): string | null {
  if (n <= 0) return null;
  const { one, many } = kindNoun(kind);
  return n === 1
    ? `The server would not accept one ${one} saved on this phone, so it was not sent and will not be tried again. Nothing reached anyone and you may want to do it again.`
    : `The server would not accept ${num(n)} ${many} saved on this phone, so they were not sent and will not be tried again. Nothing reached anyone and you may want to do them again.`;
}

/**
 * The one sentence a screen owes about its own refusals, or null.
 *
 * `status` is the DEVICE's read of the store, not the server's read of
 * anything — the server has already given its opinion, and it was no. A device
 * that could not read its own record must not answer "nothing of yours was
 * refused", which is why `null` and 'error' have a sentence of their own and
 * an empty list that WAS read has none.
 */
export function refusedIntentsScreenNote(
  list: readonly RefusedIntent[] | null,
  status: LoadStatus,
): string | null {
  // Still reading the device. A spinner belongs to the screen; a sentence about
  // doubt does not, because the doubt has not been established yet.
  if (status === 'loading') return null;
  if (list === null || status === 'error') {
    return 'This phone could not say whether anything it was holding was refused, so something you saved here may not have been sent.';
  }
  if (status === 'partial') {
    return 'This phone could not read everything it is holding, so something the server refused may not be shown below.';
  }
  const total = list.length;
  if (total <= 0) return null;
  return total === 1
    ? 'One thing saved on this phone was refused by the server and never sent.'
    : `${num(total)} things saved on this phone were refused by the server and never sent.`;
}
