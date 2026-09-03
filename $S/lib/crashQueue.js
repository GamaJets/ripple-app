"use strict";
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
// ── Why this is not another `OutboxKind` ───────────────────────────────────
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MESSAGE = exports.MAX_STACK = exports.CRASH_CAP = exports.CRASH_KEY = void 0;
exports.readCrashQueue = readCrashQueue;
exports.newCrash = newCrash;
exports.addCrash = addCrash;
exports.dropCrash = dropCrash;
exports.inCrashOrder = inCrashOrder;
exports.attributableTo = attributableTo;
exports.crashRow = crashRow;
/** Not per account. See the header for why that is the point rather than an
 *  oversight. */
exports.CRASH_KEY = 'crashq:v1';
/**
 * How many crashes one device will hold.
 *
 * Small, and much smaller than the outbox's 200, because these are not the
 * member's words and there is no case for filling a phone with them. Twenty
 * distinct crashes offline is already a story that one more row will not
 * improve.
 */
exports.CRASH_CAP = 20;
/** Longest a stack is kept, matching the `app_errors` column the row goes to.
 *  Trimmed on the way IN so the cap counts the size that will actually be
 *  stored, rather than holding four kilobytes per crash on a phone. */
exports.MAX_STACK = 4000;
exports.MAX_MESSAGE = 500;
/**
 * Read the queue back off the disk.
 *
 * `read` is false when the bytes could not be parsed, and the caller must NOT
 * treat that as an empty queue — the same rule, for the same reason, as
 * `src/lib/outbox.ts` · `readOutbox` and `src/lib/readCache.ts`: writing a
 * fresh list over bytes nobody could read is how a week of reports disappears
 * in one line. A caller that cannot read stops writing.
 */
function readCrashQueue(raw) {
    if (raw == null || raw === '')
        return { items: [], read: true };
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return { items: [], read: false };
        const items = [];
        for (const r of parsed) {
            if (!r || typeof r !== 'object')
                continue;
            const o = r;
            const id = typeof o.id === 'string' ? o.id : '';
            const at = typeof o.at === 'string' ? o.at : '';
            const message = typeof o.message === 'string' ? o.message : '';
            if (!id || !at || !message)
                continue;
            items.push({
                id, at, message,
                stack: typeof o.stack === 'string' ? o.stack : null,
                platform: typeof o.platform === 'string' ? o.platform : 'unknown',
                appVersion: typeof o.appVersion === 'string' ? o.appVersion : 'unknown',
                userId: typeof o.userId === 'string' ? o.userId : null,
            });
        }
        return { items, read: true };
    }
    catch {
        return { items: [], read: false };
    }
}
/** One report, trimmed to what the columns will take. */
function newCrash(input) {
    return {
        id: input.id,
        at: input.at,
        message: String(input.message ?? '').slice(0, exports.MAX_MESSAGE),
        stack: input.stack ? String(input.stack).slice(0, exports.MAX_STACK) : null,
        platform: input.platform ?? 'unknown',
        appVersion: input.appVersion ?? 'unknown',
        userId: input.userId ?? null,
    };
}
function addCrash(list, item) {
    if (list.some((c) => c.message === item.message))
        return { list: [...list], result: 'duplicate' };
    if (list.length >= exports.CRASH_CAP)
        return { list: [...list], result: 'full' };
    return { list: [...list, item], result: 'added' };
}
/** Remove one that was sent. */
function dropCrash(list, id) {
    return list.filter((c) => c.id !== id);
}
/** Oldest first. A crash log read newest-first invites the reader to diagnose
 *  the consequence rather than the cause. */
function inCrashOrder(list) {
    return [...list].sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)));
}
/**
 * Whose account the row may claim, given who is signed in when it finally goes.
 *
 * ── The refusal this exists to stop ───────────────────────────────────────
 *
 * `app_errors_insert` (supabase/parts/17) is
 * `with check (user_id = auth.uid() or user_id is null)`, and this queue is
 * deliberately NOT per account — the header says why, and the reason is good:
 * a crash during launch or sign-in has no uid, and those are the crashes worth
 * most. But the same property means a report recorded while one person was
 * signed in can be flushed while somebody else is, which is the ordinary case
 * on a shared gym phone. `user_id` then names an account that is not
 * `auth.uid()`, the policy refuses the row, and it is refused every time it is
 * offered for the life of the install.
 *
 * So attribution is dropped rather than the report. `null` is a value the
 * policy accepts and the table was designed to hold, and an unattributed crash
 * is worth incomparably more than a refused one — it still carries the moment,
 * the stack, the platform and the build, which is everything anybody debugs
 * from. Claiming somebody else's uid, meanwhile, would be attributing one
 * person's crash to another.
 *
 * The uid is kept whenever it is the account actually doing the writing, which
 * is the ordinary single-user phone.
 */
function attributableTo(recorded, signedInAs) {
    return recorded !== null && recorded === signedInAs ? recorded : null;
}
/**
 * The `app_errors` row.
 *
 * `message` carries the moment it happened, because the table has no column for
 * it and the row's own `created_at` is written when it arrives. Without this a
 * crash queued on Monday and delivered on Thursday reads as a Thursday crash,
 * which is the one fact about it that must not be wrong: the whole point of
 * this queue is to describe the conditions the app was used in.
 *
 * `signedInAs` is who the app is signed in as AT THE MOMENT OF SENDING, and it
 * is a required argument rather than an optional one so that no caller can
 * forget the question — see `attributableTo`.
 */
function crashRow(c, signedInAs) {
    return {
        user_id: attributableTo(c.userId, signedInAs),
        message: `[offline ${c.at}] ${c.message}`.slice(0, exports.MAX_MESSAGE),
        stack: c.stack,
        platform: c.platform,
        app_version: c.appVersion,
    };
}
