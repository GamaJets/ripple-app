// The AI Coach conversation, kept between visits — and kept on the phone.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `app/(client)/coach.tsx` held the whole thread in `useState` and there was no
// other store: no table, no key, no provider. Tapping Back threw the
// conversation away. `app/(trainer)/assistant.tsx` was identical, so NEITHER
// side of the product kept an answer — a member who asked how to train around
// their knee and walked to the rack had to ask again, and a coach who asked
// what to fix this week could not reread it on Friday.
//
// ── Where the thread lives, and why it is not a table ──────────────────────
//
// It lives in AsyncStorage on the device, under a key naming the account AND
// the side. It is not in Postgres, and that is the decision this file exists to
// hold rather than an implementation convenience.
//
// A member's coach thread is not a chat log. `src/lib/coachShare.ts` is the
// whole argument for what may travel to a model at all, and what travels is
// their weight, their body fat, their skeletal muscle, their sleep — hours,
// nights, and how many a device measured — their readiness, the focus areas
// read off their progress photographs, and their injuries. The model writes all
// of it back to them in the second person. So the REPLIES are health
// information about a named account holder, and so is whatever they typed to
// get them: "my knee is worse on stairs" is a disclosure, and nobody asked for
// it in a form.
//
// Storing that thread on the server would be a new copy of that material, in a
// new place, with its own lifetime and its own read policy. Three things follow:
//
//   · IT WOULD CONTRADICT WHAT THE MEMBER WAS TOLD. `WHERE_IT_GOES` is on the
//     screen, above the two buttons, and it ends "and it is not sent to your
//     gym." A row in the gym's database is sent to the gym — by backup, by
//     support access, by a subject-access request, and by whoever holds a
//     service key. Consent was collected against a sentence, and the sentence
//     has to stay true.
//   · THE GUARANTEE WOULD BE ONE POLICY WIDE. "A coach must not be able to read
//     a client's thread" is, in Postgres, a single RLS predicate — and this
//     codebase already has `is_my_client(client_id)` granting coaches SELECT on
//     a client's planned days, their food log and their glucose. One `USING`
//     clause written the way the neighbouring ones are written, and the coach
//     can read the thread. On the device there is no policy to get wrong,
//     because there is no route: the bytes are on a phone the coach does not
//     hold, under a key naming an account that is not theirs.
//   · RETENTION WOULD NEED AN ANSWER NOBODY HAS. A row persists until something
//     deletes it. A device key is trimmed here, cleared by the member on the
//     screen itself, dropped the moment they withdraw the health consent, and
//     gone with the app.
//
// The cost is real and is the same cost `src/ui/coachShare.tsx` already accepts
// for the consent answer itself: a member who reinstalls, or signs in on a
// second handset, starts a fresh conversation. That is the right failure. The
// other one — a thread following the account onto a device, or into a console —
// is the defect, pointing the other way.
//
// ── Why the key names the side as well as the account ─────────────────────
//
// `outboxKey(uid)` is per account because two people sharing a phone must not
// inherit each other's unsent writes. The same rule, one turn harder here: one
// PERSON can hold both roles. A trainer trains, and this app is deliberately
// built so they self-track on the client screens rather than being promoted out
// of them — so the same uid legitimately has a client-side thread about their
// own sleep and a coach-side thread about their own revenue. Keying on the uid
// alone would let the AI Coach screen restore the assistant's conversation
// about the book, and the assistant restore the coach's conversation about a
// body. They are two different subjects and they get two different keys.
//
// Pure, so the key discipline, the trim and the consent-withdrawal drop are all
// assertable under `npm test` with no device and no store. The AsyncStorage
// half is src/ui/coachChat.ts, exactly as src/lib/outbox.ts splits from
// src/ui/outbox.tsx.
import type { ChatMsg } from './coach';

/** Which conversation. The client's AI Coach and the coach's Assistant are two
 *  subjects, not two views of one — see the header. */
export type ThreadSide = 'client' | 'coach';

/** Where one account's one thread lives. Versioned like every other stored blob
 *  in this app, so a shape change cannot be read as a corrupt one. */
export const COACH_CHAT_PREFIX = 'coachchat:v1:';

/** Per account AND per side. Both halves are load-bearing; the header says why
 *  the second one is not decoration. */
export const coachChatKey = (uid: string, side: ThreadSide): string =>
  `${COACH_CHAT_PREFIX}${uid}:${side}`;

/**
 * How many messages one thread keeps.
 *
 * There is a number here for the same reason `OUTBOX_CAP` has one and for one
 * more. AsyncStorage on Android is a SQLite row per key, and a thread nothing
 * trims is a row that grows for the life of the install. The extra reason is
 * the subject: this is health material, so the honest amount to keep is the
 * amount that is still useful to the person, not the amount the disk will take.
 * Forty is twenty exchanges — a fortnight of ordinary use, and more context
 * than anybody scrolls back through.
 *
 * The OLDEST go. A conversation is read from the bottom.
 */
export const THREAD_CAP = 40;

/**
 * What is on the disk.
 *
 * `health` is the flag that makes the consent withdrawal enforceable: it says
 * whether this thread was written while the member's health details were being
 * sent, and therefore whether the replies in it may be about their body, their
 * sleep or their injuries. Stored beside the messages rather than inferred from
 * them, because inferring it would mean reading somebody's sentences to guess
 * whether they are medical, which is both unreliable and worse.
 */
export interface StoredThread {
  health: boolean;
  msgs: ChatMsg[];
}

/** One message off the wire, or null. A role this build does not know and an
 *  empty body are both unsendable and unrenderable, so neither is kept. */
function asMsg(r: unknown): ChatMsg | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const role = o.role;
  const content = o.content;
  if (role !== 'user' && role !== 'assistant') return null;
  if (typeof content !== 'string' || !content) return null;
  return { role, content };
}

/**
 * Read the thread back off the disk.
 *
 * Two halves, and it is the same rule as `src/lib/outbox.ts` · `readOutbox` and
 * `src/lib/crashQueue.ts`: bytes nobody could parse are NOT an empty
 * conversation. A caller that collapses them writes the next reply straight
 * over the top of a thread it never saw. `read: false` is the signal to show
 * what this session has and to stop writing until a launch can read the key
 * cleanly.
 *
 * A null raw — the key has never been written — IS a real empty thread and
 * comes back `read: true`. That is every account that has never used the coach.
 */
export function readThread(raw: string | null | undefined): { thread: StoredThread | null; read: boolean } {
  if (raw == null || raw === '') return { thread: null, read: true };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { thread: null, read: false }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { thread: null, read: false };
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.msgs)) return { thread: null, read: false };
  const msgs: ChatMsg[] = [];
  for (const r of o.msgs) {
    const m = asMsg(r);
    // One unreadable message is dropped and the rest are kept — dropping a row
    // is not the same event as failing to read the file, exactly as `readOutbox`
    // argues. What is NOT tolerated is the flag: see below.
    if (m) msgs.push(m);
  }
  // A missing or non-boolean `health` is treated as true, and that is the only
  // asymmetry in this file. Every other unreadable field falls towards keeping
  // the member's words; this one falls towards treating the thread as medical,
  // because the cost of guessing wrong is a thread full of somebody's body
  // surviving a consent they have withdrawn.
  const health = typeof o.health === 'boolean' ? o.health : true;
  return { thread: { health, msgs }, read: true };
}

/** The last `THREAD_CAP` messages — what is actually written back. Oldest out,
 *  because a conversation is read from the bottom. */
export function trimThread(msgs: readonly ChatMsg[]): ChatMsg[] {
  return msgs.length <= THREAD_CAP ? [...msgs] : msgs.slice(msgs.length - THREAD_CAP);
}

/** What goes on the disk. Trimmed here rather than at the call site, so there
 *  is no path that stores an untrimmed thread. */
export function writeThread(msgs: readonly ChatMsg[], health: boolean): string {
  return JSON.stringify({ health, msgs: trimThread(msgs) } satisfies StoredThread);
}

/**
 * What may be restored, given what the member currently allows.
 *
 * `allowHealth` is the client's answer read forward: true while they are
 * sharing their health details, false once they have turned that off. A stored
 * thread written under a yes is a copy of the material the no is about, so it
 * is dropped rather than shown — and `dropped` comes back so the screen can say
 * that it happened, because a conversation vanishing with no explanation is its
 * own small betrayal.
 *
 * The coach's Assistant passes true and stores false: its thread is counts,
 * rates and amounts about a business, it names no client, and there is no
 * health tier in it to withdraw.
 */
export function threadForConsent(
  thread: StoredThread | null,
  allowHealth: boolean,
): { msgs: ChatMsg[]; dropped: boolean } {
  if (!thread) return { msgs: [], dropped: false };
  if (thread.health && !allowHealth) return { msgs: [], dropped: true };
  return { msgs: thread.msgs, dropped: false };
}

/**
 * The sentence for a thread that was dropped because the member turned sharing
 * off.
 *
 * Says what went and why, and does not apologise for it: they asked for this.
 * It also says the one thing they cannot see for themselves — that the copy is
 * gone from the phone rather than merely hidden.
 */
export const WITHDRAWN_THREAD_NOTE =
  'Your earlier conversation was written while your coach could use your body, sleep and injuries, so it was removed from this phone when you turned that off. Nothing was kept and nothing was sent anywhere.';

/** Where the thread is, said on the screen that keeps it. The member is
 *  entitled to know a record exists before they can decide to clear it. */
export const THREAD_KEPT_NOTE =
  'This conversation is kept on this phone only, under your account, so you can come back to it. It is not stored on our servers and your coach cannot read it. Clearing it removes it for good.';

/** The same sentence for the coach's own Assistant. Different subject, so the
 *  reassurance that would be wrong here — "your coach cannot read it" — is not
 *  made; what a coach needs to know is that their figures did not become a
 *  record somewhere else. */
export const COACH_THREAD_KEPT_NOTE =
  'This conversation is kept on this phone only, under your account. It is not stored on our servers, and no client is named in it. Clearing it removes it for good.';
