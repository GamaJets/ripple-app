// The messages the server considered and declined — which nobody was told about.
//
// ── The silence ────────────────────────────────────────────────────────────
//
// There are three ends a message can come to and this app names all three
// (src/lib/offlineQueue.ts · `WriteOutcome`):
//
//   `stored`   the row is on the server. A fact.
//   `unsent`   it is on this handset, counted, and goes when there is signal.
//   `refused`  the server answered and said no. It will be refused every time
//              it is offered, so it must NOT sit in a queue retrying forever.
//
// The queue gets the third one right and the SCREENS never hear about it.
// `flush` in src/ui/outbox.tsx drops a refused item exactly as it drops a
// stored one — "Both come out" — and `MessageOutboxHandler` reports the error
// to telemetry. Nothing else happens. So:
//
//   · a coach replies to three clients on the underground. The inbox marks all
//     three "waiting to send from this phone" (src/lib/threadOutbox.ts). The
//     flush runs at the top of the escalator. One client has since left them,
//     so `msg_coach` — `is_my_client(client_id) AND sender = 'coach'` — refuses
//     that row. The item comes out of the queue, the mark comes off the row,
//     and the row now looks EXACTLY like the two that landed. The coach reads
//     the absence of the mark as delivery. That is `refused` collapsing into
//     `stored`, which is the one pair that must never collapse.
//   · a member types a message in a basement and their coach has blocked them
//     (part 240). The bubble is drawn from the outbox by `useThread`'s merge.
//     The flush meets the refusal, the item is dropped, the merge stops
//     producing the bubble — and their words disappear off the screen. Not
//     marked, not explained, gone.
//
// src/lib/sessionSend.ts already writes this failure down for a different
// write: "the next flush with signal meets the refusal and drops it. An hour of
// somebody's training is gone with no screen left to say so." That module
// prevents its refusal up front, which is possible there because the cause is
// knowable before the send. It is not knowable here — a coaching link can end,
// or a block be placed, between the typing and the flush — so the refusal
// cannot be prevented and must instead be KEPT and said.
//
// ── What this file is ──────────────────────────────────────────────────────
//
// The device's record of those messages, and the sentences a screen says about
// them. It is deliberately a record and not a retry: nothing here ever offers
// the bytes to the server again, because the server has already answered. What
// it does is keep the words, so the person who typed them can read them back,
// copy them out, and know that nobody received them.
//
// ── Why it is not the outbox ───────────────────────────────────────────────
//
// Leaving a refused item IN the outbox is the failure src/lib/offlineQueue.ts
// exists to prevent, and its header is explicit: a refusal offered again gets
// the same refusal, and the alternative is a queue that reads "3 waiting to
// send" for the life of the install. Those three words — WAITING TO SEND —
// would also be a lie, because nothing is waiting and nothing will be sent.
// So this is a separate store with its own, opposite sentence.
//
// ── Account scope ──────────────────────────────────────────────────────────
//
// The same rule as every other handset store here, and for a sharper reason
// than most: the body of a refused message is the thing being kept, so a
// device-global key would show one person's unsent words to whoever signs in
// next. `refusedMessagesKey` refuses a null, a blank and the literal 'unknown'
// — see src/lib/deviceAccountCache.ts, whose `accountCacheKey` this composes
// through rather than repeating.
//
// There is no legacy key: nothing has ever written this store, so there is
// nothing on any handset to remove or to migrate.
//
// Pure and framework-free; asserted under plain node in refusedMessages.test.ts.
// The storage and the recording are src/ui/messaging.ts.
import { accountCacheKey } from './deviceAccountCache';
import { waitedLabel } from './awaitingReply';
import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';

/** The sides of a thread, as `messages.sender` stores them. Repeated from
 *  src/ui/messaging.ts rather than imported, so this stays free of React. */
export type RefusedSender = 'client' | 'coach';

/**
 * One message the server declined.
 *
 * `body` is kept and is the point of the whole store. Everything else exists so
 * a screen can put it back beside the conversation it was meant for.
 */
export interface RefusedMessage {
  /** The outbox item's own id. The same id the optimistic bubble was re-keyed
   *  onto, so a screen can tell a refusal it already drew from a new one. */
  id: string;
  /** `messages.client_id` — the thread it was addressed to. Empty when the
   *  stored payload could not be read at all, which is itself a refusal and is
   *  counted rather than dropped. */
  clientId: string;
  /** Who wrote it. */
  sender: RefusedSender;
  /** The words. Empty only when the payload was unreadable. */
  body: string;
  /** When it was written on this phone, ISO. Empty when nothing readable came
   *  with it — never replaced by the moment of the refusal, which is a
   *  different time and would read as the moment it was typed. */
  at: string;
}

/** Every refused-message key starts with this. */
export const REFUSED_MESSAGES_PREFIX = 'repple.messages.refused:';

/**
 * How many refusals one handset keeps.
 *
 * Small on purpose. This is a record for a person to read and act on, not a
 * log: past a couple of screenfuls nobody reads it, and the store is holding
 * message bodies, which is the last thing that should grow without bound on a
 * shared device. When it is full the OLDEST goes, for the same reason the
 * outbox refuses rather than evicts in the other direction — the newest refusal
 * is the one the person is most likely to still be able to do something about.
 */
export const MAX_REFUSED = 20;

/**
 * Where this account's refused messages live, or null when there is no account
 * to attribute them to.
 *
 * Null means DO NOT PERSIST. It is not a failure: a refusal that arrives with
 * nobody signed in has no reader to show it to.
 */
export function refusedMessagesKey(uid: string | null | undefined): string | null {
  return accountCacheKey(REFUSED_MESSAGES_PREFIX, uid);
}

/** Whether a stored key holds somebody's refused messages. For the sign-out
 *  assertion: this family is account-scoped, so it SURVIVES a sign-out exactly
 *  as the per-account outbox does. */
export const isRefusedMessagesKey = (k: string): boolean =>
  typeof k === 'string' && k.startsWith(REFUSED_MESSAGES_PREFIX) && k.length > REFUSED_MESSAGES_PREFIX.length;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The refusals read back off a stored string.
 *
 * Every field is checked rather than trusted, and an entry with no `id` is
 * dropped: the id is the handle a screen dismisses one by, and an entry nobody
 * can dismiss is one that sits on the screen forever.
 *
 * An unreadable blob is NO refusals — and that is not a failed read being
 * called an empty one. The caller keeps its own status: a read that THREW is
 * 'partial' at the hook and the screen says so, which is the same separation
 * `readHandsetClips` makes in src/lib/handsetClips.ts.
 */
export function readRefusedMessages(raw: string | null | undefined): RefusedMessage[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: RefusedMessage[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const v = entry as Record<string, unknown>;
    const id = text(v.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const at = text(v.at);
    out.push({
      id,
      clientId: text(v.clientId),
      // Narrowed, never widened. 'client' is the safe default only in the sense
      // that it is the one this store is read on most; nothing branches on it
      // in a way that could cost anybody anything.
      sender: v.sender === 'coach' ? 'coach' : 'client',
      body: typeof v.body === 'string' ? v.body : '',
      // A stamp that will not parse is kept as no stamp at all. It must not
      // become the moment of the read, which is what an undated message
      // rendered through a relative formatter turns into: "just now".
      at: at && Number.isFinite(Date.parse(at)) ? at : '',
    });
  }
  return out;
}

/** The refusals as they go to the store. Routed through the reader so what is
 *  written is exactly what will be read back. */
export function writeRefusedMessages(list: readonly RefusedMessage[]): string {
  return JSON.stringify(readRefusedMessages(JSON.stringify(list ?? [])));
}

/**
 * Add one refusal to the record.
 *
 * Newest last, capped at `MAX_REFUSED` by dropping from the FRONT. An id
 * already in the list replaces its entry rather than appearing twice: the
 * flush re-checks membership before each item, but two providers mounted at
 * once would otherwise record the same refusal twice and the person would read
 * their message as having been refused two separate times.
 */
export function recordRefusal(
  list: readonly RefusedMessage[],
  item: RefusedMessage,
): RefusedMessage[] {
  const id = text(item?.id);
  if (!id) return list.slice();
  const kept = list.filter((r) => r.id !== id);
  kept.push({ ...item, id });
  return kept.length > MAX_REFUSED ? kept.slice(kept.length - MAX_REFUSED) : kept;
}

/** Take one out, because the person has read it. Never called by anything but a
 *  gesture: nothing expires these, because nothing else will ever tell them. */
export function dropRefusal(list: readonly RefusedMessage[], id: string): RefusedMessage[] {
  return list.filter((r) => r.id !== id);
}

/** What one thread is holding a refusal of. Same shape as
 *  `QueuedForThread` in src/lib/threadOutbox.ts and deliberately NOT the same
 *  type: the two describe opposite facts and a screen that could pass one where
 *  the other belongs would say "waiting to send" about something that will
 *  never be sent. */
export interface RefusedForThread {
  /** Always at least 1 wherever this exists. */
  count: number;
  /** The newest refusal's timestamp, or null when none of them carried a
   *  readable one. The NEWEST rather than the oldest, because the sentence this
   *  feeds is about how long the person has been misinformed, and that clock
   *  starts at the most recent thing they believe they sent. */
  newestAt: string | null;
}

/** Group the record by the thread each message was for. A refusal with no
 *  thread key is on no row and is counted by `unaddressedRefused`. */
export function refusedByThread(list: readonly RefusedMessage[]): Map<string, RefusedForThread> {
  const out = new Map<string, RefusedForThread>();
  for (const r of list) {
    const id = text(r?.clientId);
    if (!id) continue;
    const at = text(r?.at) && Number.isFinite(Date.parse(r.at)) ? r.at : null;
    const held = out.get(id);
    if (!held) { out.set(id, { count: 1, newestAt: at }); continue; }
    held.count += 1;
    if (at && (!held.newestAt || Date.parse(at) > Date.parse(held.newestAt))) held.newestAt = at;
  }
  return out;
}

/** Refusals whose payload could not be read, so nothing knows which
 *  conversation they belonged to. Still somebody's words and still refused. */
export function unaddressedRefused(list: readonly RefusedMessage[]): number {
  return list.reduce((n, r) => n + (text(r?.clientId) ? 0 : 1), 0);
}

/**
 * The mark beside one row, or null when nothing for it was refused.
 *
 * Three things in one sentence and all three are load-bearing: that it was not
 * delivered, that it will NOT be retried, and how long ago the person came to
 * believe otherwise. Without the last of those a refusal from last Tuesday
 * reads as one from this minute, which is the difference between "try again"
 * and "they have not heard from me in a week".
 *
 * @param now the reader's clock. Omit it and the age is left off entirely
 *        rather than guessed — see the `at: ''` case in `readRefusedMessages`.
 */
export function refusedThreadNote(
  r: RefusedForThread | undefined | null,
  now?: number,
): string | null {
  if (!r || r.count <= 0) return null;
  const one = r.count === 1;
  const head = one
    ? 'One reply was refused by the server and has not been delivered.'
    : `${num(r.count)} replies were refused by the server and have not been delivered.`;
  const ago = refusedAgeClause(r.newestAt, now);
  const tail = one ? 'It will not be sent again.' : 'They will not be sent again.';
  return `${head} ${ago}${tail}`;
}

/** "Refused 2 days ago. " or "" — never a guess. Separated out so the two
 *  sentences below cannot disagree about when a stamp may be shown. */
function refusedAgeClause(at: string | null, now?: number): string {
  if (!at || now === undefined || !Number.isFinite(now)) return '';
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return '';
  return `Written ${waitedLabel(now - t)} ago. `;
}

/**
 * The one sentence a screen owes about its own refusals, or null.
 *
 * Said with its denominator, for the reason every count in this codebase is:
 * a refusal for a thread that is not on the list would otherwise be marked
 * nowhere, and the per-row marks would be presented as the whole of it.
 *
 * `status` is the DEVICE's read of the store, not the server's read of
 * anything. 'partial' or 'error' means this handset could not say what it is
 * holding, and the absence of marks below is then not evidence — the same rule
 * `outboxThreadsNote` applies to the outbox, said here because the two stores
 * fail independently.
 *
 * An empty record that WAS read gets null. There is nothing to say.
 */
export function refusedScreenNote(
  list: readonly RefusedMessage[] | null,
  status: LoadStatus,
  shownThreadIds: ReadonlySet<string>,
): string | null {
  // Still reading the device. A spinner belongs to the screen; a sentence about
  // doubt does not, because the doubt has not been established yet.
  if (status === 'loading') return null;
  if (list === null) {
    return 'This phone could not say whether any of your messages were refused. Open a conversation to check that your last reply is in it.';
  }
  if (status === 'partial' || status === 'error') {
    return 'This phone could not read everything it is holding, so a message the server refused may not be marked below.';
  }
  const total = list.length;
  if (total <= 0) return null;
  let onScreen = 0;
  for (const [id, r] of refusedByThread(list)) if (shownThreadIds.has(id)) onScreen += r.count;
  const head = total === 1
    ? '1 message was refused by the server and never delivered'
    : `${num(total)} messages were refused by the server and never delivered`;
  const tail = total === 1 ? 'It will not be sent again.' : 'They will not be sent again.';
  if (onScreen === total) {
    return `${head}, marked on the conversation${total === 1 ? '' : 's'} below. ${tail}`;
  }
  return `${head}, and ${num(onScreen)} of ${num(total)} ${onScreen === 1 ? 'is' : 'are'} on a conversation shown here. ${tail}`;
}

/**
 * The refusals for one conversation, newest first, for the thread screen to
 * put the words back in front of the person who typed them.
 *
 * Newest first here and oldest first nowhere: this is not the conversation, it
 * is a list of things that did not join it, and the most recent is the one the
 * member is looking for.
 */
export function refusedForThread(
  list: readonly RefusedMessage[],
  threadId: string | null | undefined,
): RefusedMessage[] {
  const id = text(threadId);
  if (!id) return [];
  return list
    .filter((r) => text(r.clientId) === id)
    .slice()
    .sort((a, b) => {
      const ta = a.at ? Date.parse(a.at) : NaN;
      const tb = b.at ? Date.parse(b.at) : NaN;
      const va = Number.isFinite(ta) ? ta : -Infinity;
      const vb = Number.isFinite(tb) ? tb : -Infinity;
      if (va !== vb) return vb - va;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * The line above one recovered message.
 *
 * Says the words are still here, because the fear this store answers is that
 * they are gone. A body that came back empty says so rather than drawing a
 * blank line, which reads as a message with nothing in it.
 */
export function refusedBodyNote(r: RefusedMessage, now?: number): string {
  const ago = refusedAgeClause(r.at, now);
  return r.body.trim()
    ? `${ago}Not delivered. Your words are below — copy them before you dismiss this.`
    : `${ago}Not delivered. This phone could not read the message back, so the words are not recoverable.`;
}
