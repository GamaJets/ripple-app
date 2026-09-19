// Whose rows are these, and may they be written under the account signed in
// NOW?
//
// ── the write this exists to refuse ───────────────────────────────────────
//
// src/lib/sessionScope.ts traces one route to a member's sets being filed
// under somebody else's name — an AsyncStorage key with no account on it,
// restored by whoever signs in next. It ends its trace at src/ui/workoutLog.tsx
// with: "`uidRef.current` is resolved FRESH from the auth read at save time, so
// it is B". That file has a second route to the same row, and it needs no
// unqualified storage key at all, because the list is held IN MEMORY across the
// account change:
//
//   1. Member A logs a session in a basement. The insert is never answered, so
//      the entries stay in `listRef.current` carrying `local:` ids, queued.
//   2. A signs out. The hydrate re-runs, finds no session, sets `uidRef.current`
//      to null — AND LEAVES `listRef.current` EXACTLY AS IT IS.
//   3. Member B signs in on the same handset. The hydrate re-runs, resolves B,
//      and merges: `withoutStored(listRef.current.filter(isQueued), server)`.
//      A's entries are still in there. They are written to B's own queue file
//      and then sent — `entryToRow(B, e)` — one insert per session.
//
// The row lands in `workouts` with `user_id = B`. It is a well-formed insert of
// B's own id, made by B's session, so RLS is satisfied, PostgREST returns the
// row, and `classifyWrite` reports 'stored'. There is no error anywhere and
// nothing afterwards can tell the two apart: A's lifts are indistinguishable
// from sets B performed, in the history B's coach programmes from.
//
// The reconnect edge reaches it faster still. `flushQueue` is registered once
// and reads `uidRef.current` and `listRef.current` independently; between an
// account change and the hydrate landing, those two are B and A's rows.
//
// ── why the rows may be dropped from memory, and must not be deleted ──────
//
// The answer to a foreign list is to stop holding it, not to migrate it and not
// to erase it. A's queued entries are already on the disk under
// `queueCacheKey(A)` — `repple.workouts:<uid>`, account-scoped — so dropping
// them from memory costs nothing: they are read back, whole, the next time A
// signs in. What must never happen is a WRITE that touches them while B is the
// account: writing B's list over `queueCacheKey(B)` is fine, writing it over
// A's is how A loses the session, and sending them as B is how B gains it.
//
// So every rule here is about the list in memory and about the id on an insert.
// Nothing here removes a byte from any store.
//
// ── the direction of the doubt, inherited ─────────────────────────────────
//
// `read.fate` decides, never `!read.uid` — see src/lib/authedUid.ts. An auth
// read that established NOTHING must move nothing at all: an outage that
// cleared the list would end a session on the strength of a dropped
// connection, and an outage that adopted it would file it under a guess. 'hold'
// is the answer for both, and it is the whole reason this takes a `UidRead`
// rather than a `string | null`.
//
// Pure. No storage, no React, no supabase. src/lib/listOwner.test.ts holds both
// ends of every decision below, including the sign-in → sign-out → sign-in
// sequence the defect lives in.

import { accountScope } from './sessionScope';
import type { UidRead } from './authedUid';

/**
 * What to do with a list held for one account when an auth read comes back.
 *
 *   · 'keep' — the list belongs to the account that just answered, or it
 *              belongs to nobody yet and that account may adopt it.
 *   · 'drop' — the list belongs to a DIFFERENT account. Stop holding it. The
 *              rows are on the disk under their own account's key and are not
 *              being deleted; they are being let go of.
 *   · 'hold' — nothing was established. Touch nothing: not the list, not the
 *              account it is held for, not the store.
 */
export type ListOwnerAct = 'keep' | 'drop' | 'hold';

/**
 * Nothing has ever been recorded about whose these rows are.
 *
 * This is NOT the same question as `accountScope(held) == null`, and the test
 * for this file is what made the difference say itself out loud. `'unknown'` is
 * a real recorded value — src/ui/clientData.tsx publishes `id: sbUid ??
 * 'unknown'`, so it is what every signed-out and still-resolving session on the
 * handset reports — and it means "something held these and we could not name
 * it", which is the opposite of "nobody has held them". Read as unclaimed it
 * would be ADOPTABLE, and every session on the handset that had ever reported
 * `'unknown'` would be adoptable by whoever signed in next. That is the defect
 * this file exists to refuse, arriving through the door marked safe.
 *
 * So only an absent value, or a blank one, is unclaimed. Anything recorded that
 * is not a usable account is refused rather than adopted.
 */
const unclaimed = (held: string | null | undefined): boolean =>
  held == null || (typeof held === 'string' && held.trim() === '');

/**
 * Whether a list held for `held` is a DIFFERENT real account's than `owner`.
 *
 * Both sides go through `accountScope`, so `'unknown'`, the string `'null'` and
 * an id carrying the key separator are not accounts. A list held under one of
 * those is foreign to every real account — see `unclaimed` above for why that
 * is the safe direction rather than the strict one.
 *
 * `owner` being unusable answers FALSE rather than true, and that is
 * deliberate. Nothing is being claimed, so nothing is foreign: a provider whose
 * auth read has not landed yet still holds its own member's sets on screen, and
 * calling them foreign would clear the list of somebody who has simply just
 * launched the app. No write can happen on that path either — `mayWriteUnder`
 * refuses a blank writer outright — so there is nothing for the laxer answer to
 * let through.
 */
export function foreignList(
  held: string | null | undefined,
  owner: string | null | undefined,
): boolean {
  if (unclaimed(held)) return false;
  const o = accountScope(owner);
  if (o == null) return false;
  return accountScope(held) !== o;
}

/**
 * Whether rows held for `held` may be sent to the server as `writer`'s.
 *
 * Two halves, and both are required:
 *
 *   · `writer` must be a real account. A blank, null or `'unknown'` writer is
 *     refused rather than composed into a row — an insert is a claim about a
 *     person and there is no person here.
 *   · `held` must be that same account, or UNCLAIMED. Unclaimed is allowed
 *     through on purpose: entries typed in the seconds between mount and the
 *     first auth read are held for nobody, they have reached no account-scoped
 *     key, and they belong to whoever is at the handset — which is the person
 *     now signing in. src/ui/workoutLog.tsx protects that case explicitly ("a
 *     member can log a set while this read is in flight — it is the first thing
 *     somebody does on opening the app") and refusing it would lose the session
 *     it protects. Unclaimed means nothing was recorded, not that what was
 *     recorded is unusable — see `unclaimed`.
 *
 * A DIFFERENT real account is the case with no benign reading, and it is the
 * one this whole file is for.
 */
export function mayWriteUnder(
  held: string | null | undefined,
  writer: string | null | undefined,
): boolean {
  const w = accountScope(writer);
  if (w == null) return false;
  if (unclaimed(held)) return true;
  return accountScope(held) === w;
}

/**
 * What an auth read means for the list currently held for `held`.
 *
 * Narrowed on `fate`, never on `!read.uid`: `UidRead`'s members are told apart
 * by `fate` being null or not, and `uid`'s non-null member is `string`, which
 * includes `''`. See the note in src/lib/signedInUid.ts.
 *
 * A sign-out drops a list held for anything that was recorded — there is no
 * longer an account for those rows to be about, and the next person to sign in
 * must not inherit them. It KEEPS an unclaimed list, because there is nothing
 * there that could be misfiled: an unclaimed list has reached no store and can
 * reach no server, and clearing it would take away sets that are on screen for
 * no gain.
 */
export function listOwnerAct(held: string | null | undefined, read: UidRead): ListOwnerAct {
  if (read.fate === 'unreadable') return 'hold';
  if (read.fate === 'signed-out') return unclaimed(held) ? 'keep' : 'drop';
  return foreignList(held, read.uid) ? 'drop' : 'keep';
}
