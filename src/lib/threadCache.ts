// Which key on this device one conversation is kept under.
//
// ── The key this replaces ──────────────────────────────────────────────────
//
// `cacheKey('thread', clientId)` — `rc:v1:thread:<clientId>` — which names the
// thread and not the person reading it. On the CLIENT side that is harmless by
// accident: a client's thread key IS their own account id, so the key was
// already scoped to them. On the COACH side it is not, and the gap is the one
// eight other lanes have been closing all night:
//
//   · a coach signs in on a shared or demonstration handset, opens the thread
//     with client X, and the page is written to `rc:v1:thread:<X>`;
//   · a second coach signs in on the same handset — a client who changed
//     trainers is the ordinary way this happens, and the roster carries them
//     over — opens X, and `useThread` reads that key BEFORE the network. The
//     first coach's private conversation with X is on screen, under the second
//     coach's composer, for as long as the read below takes. If that read is
//     refused, `cachedNote` keeps it there with a date on it.
//
// Nothing was misdelivered and nothing was written: the rows came off this
// device. That is exactly what makes it worth fixing here rather than at the
// database, which never saw the second read at all.
//
// ── The rules, which are the same three every other scoped key obeys ───────
//
//   1. THE VIEWER IS IN THE KEY. `rc:v1:thread:<viewer>:<thread>`. The thread
//      id stays in it because one account has many threads; the viewer goes in
//      front because that is the half that was missing.
//   2. NO ACCOUNT, NO CACHE. A null id, an empty string and the literal
//      'unknown' are all refused — `threadCacheKey` returns null and the caller
//      neither reads nor writes. A cache we cannot attribute is one we must not
//      open, and 'unknown' is refused by name because it is what a resolver
//      hands back when it could not tell, which is precisely the moment a
//      device-global key would be minted again.
//   3. THE OLD KEY IS REMOVED UNREAD. `legacyThreadCacheKey` is only ever
//      passed to a delete. Reading it first to migrate it would mean deciding
//      whose conversation it was, and the only honest answer is that this build
//      cannot tell — the bytes have no account on them. They are dropped, and
//      the first read with signal writes the scoped key.
//
// Pure and framework-free; asserted under plain node in threadCache.test.ts.
// The reads and writes are src/ui/messaging.ts.
import { cacheKey } from './readCache';

/** The scope both keys are built in. Exported because src/ui/messaging.ts used
 *  to declare its own copy of this string beside the two call sites. */
export const THREAD_SCOPE = 'thread';

/**
 * Whether this is an account id a cache may be attributed to.
 *
 * 'unknown' is a value, not an account. So is ''. Both are refused rather than
 * concatenated into a key that would then be shared by every device that could
 * not name its reader.
 */
export function usableAccountId(uid: string | null | undefined): boolean {
  if (typeof uid !== 'string') return false;
  const s = uid.trim();
  return s !== '' && s !== 'unknown' && s !== 'null' && s !== 'undefined';
}

/**
 * Where this reader's copy of this thread lives, or null when it may not be
 * kept at all.
 *
 * Null for an unusable account AND for an unusable thread id: a key with an
 * empty half is a key two different absences would collide on.
 */
export function threadCacheKey(
  threadId: string | null | undefined,
  viewerId: string | null | undefined,
): string | null {
  if (!usableAccountId(viewerId) || !usableAccountId(threadId)) return null;
  return cacheKey(THREAD_SCOPE, `${String(viewerId).trim()}:${String(threadId).trim()}`);
}

/**
 * The device-global key this used to be written under.
 *
 * For deletion only. It is deliberately NOT returned alongside anything that
 * could read it, and it takes no viewer, because the whole defect is that the
 * bytes under it say nothing about whose they are.
 */
export function legacyThreadCacheKey(threadId: string | null | undefined): string | null {
  if (!usableAccountId(threadId)) return null;
  return cacheKey(THREAD_SCOPE, String(threadId).trim());
}
