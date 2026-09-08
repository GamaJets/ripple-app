// What the gym is told after it frees a PT hour that somebody was waiting for.
//
// ── the write this is about ────────────────────────────────────────────────
//
// The owner console frees a one-to-one slot with `updatePtSlot(sb, id,
// { clientId: null })`, and until supabase/parts/2610 that was the end of it:
// `promote_session_waitlist` was authorised on `sessions.trainer_id =
// auth.uid()` and an owner is not the trainer, so the hour opened to anybody
// with the app in their hand and the person who had been first in the queue for
// three weeks was never told. Part 2610 adds the owner arm. This file is the
// half that decides what the desk is then allowed to say.
//
// ── three answers, and why the third may never become the second ───────────
//
// The RPC returns a uuid, or null, or raises. Those are three different facts
// and exactly one of them licenses the desk to move on:
//
//   promoted  a named person holds the hour. The notification proving it was
//             written inside the same transaction as the booking (part 2610
//             inserts it on the owner arm, because a console is not a handset
//             and cannot push), so on this path — and only this one — promoted
//             really does imply told.
//   nobody    the server ran and promoted nobody. The queue was empty, or the
//             slot was no longer available, or it had already started. The hour
//             is genuinely open and offering it round is correct.
//   failed    the call was refused or did not come back. NOTHING is known, and
//             least of all that the queue was empty.
//
// The distinction is `classifyWrite` in src/lib/offlineQueue.ts and `readState`
// in src/lib/staleRead.ts wearing one more face — a call that did not happen is
// not an empty result — and the same one `PromoteResult` in src/ui/sessions.tsx
// draws for the coach's screen. It matters more here than in most places: the
// desk's next act on a wrongly-empty answer is to give the hour to whoever
// rings first, which is the race the waitlist exists to replace, run against
// somebody who may already own the slot.
//
// It is also the shape src/lib/wroteRows.ts exists for. A PostgREST write that
// matches zero rows is not an error, and an owner told "handed to the queue"
// over a call that handed it to nobody is the worst outcome this feature has —
// worse than a refusal, because a refusal gets looked at.
//
// ── why this is here and not in src/ui/sessions.tsx ────────────────────────
//
// `promoteWaitlist` in src/ui/sessions.tsx already reads this RPC the same way,
// but that module imports the React Native supabase client and `USE_SUPABASE`,
// so the web console cannot touch it. This is the pure half: no client, no
// import, assertable without a database. src/ui/sessions.tsx should read its
// answer through `readPromotion` too rather than keeping a second copy of the
// rule — one line, in a file this lane does not hold.

/** Which of the three things happened. `clientId` is present on exactly one. */
export type WaitlistPromotion =
  | { outcome: 'promoted'; clientId: string }
  | { outcome: 'nobody'; clientId: null }
  | { outcome: 'failed'; clientId: null };

/** The shape of a supabase-js `rpc()` result, narrowed to what matters. */
export interface PromotionResult {
  data?: unknown;
  error?: unknown | null;
}

const NOBODY: WaitlistPromotion = { outcome: 'nobody', clientId: null };
const FAILED: WaitlistPromotion = { outcome: 'failed', clientId: null };

/**
 * Read `promote_session_waitlist`'s answer.
 *
 * `null` is the function's own word for "nobody got it" and is the ONLY
 * non-string that may be read as empty. An `undefined`, a number, an object or
 * anything else is a reply we do not understand, and a reply we cannot read is
 * not a reply that the queue was empty — it does not license the re-offer.
 *
 * An empty or blank string is 'failed' for the same reason: it is not a client
 * id, and treating it as one would put a person's name on an hour nobody holds.
 */
export function readPromotion(r: PromotionResult | null | undefined): WaitlistPromotion {
  if (!r || r.error) return FAILED;
  if (typeof r.data === 'string') {
    const id = r.data.trim();
    return id ? { outcome: 'promoted', clientId: id } : FAILED;
  }
  // `=== null`, not `== null`. PostgREST renders the function's null as JSON
  // null and supabase-js hands that through as `null`, so `undefined` is not
  // that answer — it is a result object with no `data` on it at all, which is a
  // call that did not come back the way this reader expects. It falls through.
  return r.data === null ? NOBODY : FAILED;
}

/** True only where the queue is PROVEN to have taken nobody. The one condition
 *  under which the hour may be offered round. 'failed' is not it. */
export function mayReoffer(p: WaitlistPromotion): boolean {
  return p.outcome === 'nobody';
}

/**
 * What the desk reads after freeing the hour.
 *
 * `name` is the promoted member where the console knows it. It is never
 * interpolated into a sentence it could leave a hole in: with no name the
 * sentence says "the member who was first in the queue", which is a description
 * rather than a blank and is true whatever the missing value was.
 *
 * The told clause is a claim about a row, not about a phone. Part 2610 writes
 * the notification in the promoting transaction, so "they have been told" is
 * safe to print on a promotion that came back; whether the push then reached a
 * handset is `send-push`'s business and is not claimed here.
 */
export function promotionText(p: WaitlistPromotion, name?: string | null): string {
  const who = name && name.trim() ? name.trim() : 'the member who was first in the queue';
  switch (p.outcome) {
    case 'promoted':
      return `That hour went to ${who}, who was first on its waitlist, and they have been told. It is booked, not open.`;
    case 'nobody':
      return 'Nobody was waiting for that hour. It is open for anyone to book.';
    case 'failed':
      return 'That hour is free, but we could not find out whether anybody was waiting for it, so nobody has been given it. Reload the timetable before offering it to anyone.';
  }
}
