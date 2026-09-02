// Crashes that happened with no signal, kept until there is some.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `src/ui/ErrorBoundary.tsx` sent the crash with
// `supabase.from('app_errors').insert({…}).then(() => {}, () => {})` inside a
// `try { } catch { /* swallow */ }`, and `src/lib/reportError.ts` drops its row
// the same way. Both are correct not to bother the member. Both also meant that
// a crash on a dead network was never reported at all — and the crashes worth
// most are exactly those: the basement gym, the lift, the tube. So `app_errors`
// systematically under-reports the conditions the app is actually used in, and
// the table looks healthiest precisely where the app is worst.
//
// ── Why this is not a fifth `OutboxKind` ───────────────────────────────────
//
// `src/lib/outbox.ts` is the obvious home and it is the wrong one, for reasons
// that file states itself. Its closing rule is:
//
//     "Everything left is a write about the member's own record that says the
//      same thing whenever it lands."
//
// A crash report is not a write about the member's own record. It is a write
// about US, and the whole outbox is built around the first half of that
// sentence rather than the second. Three things follow from it that a crash
// report cannot satisfy:
//
//   · IT IS ADDRESSED TO THE MEMBER. `outboxNote` says "N measurements saved on
//     this phone and not sent yet", and app/(client)/dashboard.tsx draws one
//     line per kind. "1 crash report saved on this phone" is our problem put in
//     front of somebody who did not cause it and cannot act on it.
//
//   · LAPSING TELLS THEM TO DO IT AGAIN. `lapsedNote` is "A … was waiting to
//     send for too long, so it was not sent. Nothing reached anyone and you may
//     want to do it again." There is nothing for anybody to do again, and the
//     outbox header is explicit that a lapsed intent "is the one case where the
//     member has to be told they typed something". They did not type this.
//
//   · IT IS KEYED PER ACCOUNT. `outboxKey(uid)` exists so "two people sharing a
//     phone must not inherit each other's unsent writes", which is right for a
//     message and fatal here: a crash during launch, during sign-in, or on a
//     signed-out screen has no uid to file under, and those are a large share
//     of the crashes anybody wants. `app_errors` accepts a null `user_id`
//     precisely so an unauthenticated report is still worth having.
//
// So this is its own small queue under its own key: not per account, not shown
// to anybody, and it never expires — a crash from Tuesday is still the same
// crash on Thursday. What it DOES share is the trigger: `src/ui/crashQueue.ts`
// registers with `src/lib/offlineQueue.ts` · `flushAll`, so these go up on the
// same reconnect and foreground as everything else.
//
// Pure and in src/lib because it is a rule. The AsyncStorage and Supabase half
// is src/ui/crashQueue.ts, exactly as src/lib/outbox.ts splits from
// src/ui/outbox.tsx.

/** One crash, as it will be sent. Field names match `app_errors` where they
 *  can; `at` does not, because that column is written by the server and this is
 *  when it HAPPENED. */
export interface CrashReport {
  /** Device-local and unique, so a flush can remove exactly what it sent. */
  id: string;
  /** When it happened, not when it is sent. */
  at: string;
  message: string;
  stack: string | null;
  platform: string;
  appVersion: string;
  /** Null where nobody was signed in. Kept rather than refused — see the
   *  header: those are the launch crashes. */
  userId: string | null;
}

/** Not per account. See the header for why that is the point rather than an
 *  oversight. */
export const CRASH_KEY = 'crashq:v1';

/**
 * How many crashes one device will hold.
 *
 * Small, and much smaller than the outbox's 200, because these are not the
 * member's words and there is no case for filling a phone with them. Twenty
 * distinct crashes offline is already a story that one more row will not
 * improve.
 */
export const CRASH_CAP = 20;

/** Longest a stack is kept, matching the `app_errors` column the row goes to.
 *  Trimmed on the way IN so the cap counts the size that will actually be
 *  stored, rather than holding four kilobytes per crash on a phone. */
export const MAX_STACK = 4000;
export const MAX_MESSAGE = 500;

/**
 * Read the queue back off the disk.
 *
 * `read` is false when the bytes could not be parsed, and the caller must NOT
 * treat that as an empty queue — the same rule, for the same reason, as
 * `src/lib/outbox.ts` · `readOutbox` and `src/lib/readCache.ts`: writing a
 * fresh list over bytes nobody could read is how a week of reports disappears
 * in one line. A caller that cannot read stops writing.
 */
export function readCrashQueue(raw: string | null | undefined): { items: CrashReport[]; read: boolean } {
  if (raw == null || raw === '') return { items: [], read: true };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { items: [], read: false };
    const items: CrashReport[] = [];
    for (const r of parsed) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const id = typeof o.id === 'string' ? o.id : '';
      const at = typeof o.at === 'string' ? o.at : '';
      const message = typeof o.message === 'string' ? o.message : '';
      if (!id || !at || !message) continue;
      items.push({
        id, at, message,
        stack: typeof o.stack === 'string' ? o.stack : null,
        platform: typeof o.platform === 'string' ? o.platform : 'unknown',
        appVersion: typeof o.appVersion === 'string' ? o.appVersion : 'unknown',
        userId: typeof o.userId === 'string' ? o.userId : null,
      });
    }
    return { items, read: true };
  } catch {
    return { items: [], read: false };
  }
}

/** One report, trimmed to what the columns will take. */
export function newCrash(input: {
  id: string;
  at: string;
  message: string;
  stack?: string | null;
  platform?: string;
  appVersion?: string;
  userId?: string | null;
}): CrashReport {
  return {
    id: input.id,
    at: input.at,
    message: String(input.message ?? '').slice(0, MAX_MESSAGE),
    stack: input.stack ? String(input.stack).slice(0, MAX_STACK) : null,
    platform: input.platform ?? 'unknown',
    appVersion: input.appVersion ?? 'unknown',
    userId: input.userId ?? null,
  };
}

/**
 * Add one, or say why not.
 *
 * Two refusals, and both of them are about a crash LOOP, which is the shape
 * this queue actually meets in the wild: a screen that throws on every render
 * calls this on every render.
 *
 *   · `'duplicate'` — the same message is already waiting. The fiftieth copy of
 *     one stack teaches nobody anything the first did not, and it would push
 *     out the four unrelated crashes underneath it.
 *   · `'full'` — the cap is reached. REFUSES rather than evicting the oldest,
 *     which is the opposite of the usual instinct and is deliberate: in a loop
 *     the oldest report is the FIRST failure and the newest is its
 *     consequences. Evicting oldest-first would leave twenty copies of the
 *     symptom and none of the cause.
 */
export type CrashAdd = 'added' | 'duplicate' | 'full';
export function addCrash(list: readonly CrashReport[], item: CrashReport): { list: CrashReport[]; result: CrashAdd } {
  if (list.some((c) => c.message === item.message)) return { list: [...list], result: 'duplicate' };
  if (list.length >= CRASH_CAP) return { list: [...list], result: 'full' };
  return { list: [...list, item], result: 'added' };
}

/** Remove one that was sent. */
export function dropCrash(list: readonly CrashReport[], id: string): CrashReport[] {
  return list.filter((c) => c.id !== id);
}

/** Oldest first. A crash log read newest-first invites the reader to diagnose
 *  the consequence rather than the cause. */
export function inCrashOrder(list: readonly CrashReport[]): CrashReport[] {
  return [...list].sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)));
}

/**
 * The `app_errors` row.
 *
 * `message` carries the moment it happened, because the table has no column for
 * it and the row's own `created_at` is written when it arrives. Without this a
 * crash queued on Monday and delivered on Thursday reads as a Thursday crash,
 * which is the one fact about it that must not be wrong: the whole point of
 * this queue is to describe the conditions the app was used in.
 */
export function crashRow(c: CrashReport): {
  user_id: string | null; message: string; stack: string | null; platform: string; app_version: string;
} {
  return {
    user_id: c.userId,
    message: `[offline ${c.at}] ${c.message}`.slice(0, MAX_MESSAGE),
    stack: c.stack,
    platform: c.platform,
    app_version: c.appVersion,
  };
}
