// Did the write actually land on a row?
//
// This is the defining bug of this codebase wearing its database face. A
// PostgREST UPDATE or DELETE that matches ZERO rows is not an error. It returns
// 204, `error` is null, and supabase-js hands back a result that is
// indistinguishable from a write that changed something:
//
//     const { error } = await sb.from('memberships').update({ status }).eq('id', id);
//     if (error) throw error;          // never throws
//     await load();                    // reloads, shows the OLD status
//
// Every way a row can fail to match produces exactly that:
//
//   · an RLS policy refused it. `memberships_owner` is `is_owner_of(tenant_id)`
//     and nothing else grants UPDATE, so a member, a trainer, or an owner of a
//     DIFFERENT gym updates zero rows and is told nothing.
//   · the row was deleted by somebody else between the read and the tap.
//   · the id is stale, because the list on screen is from before a refresh.
//
// The owner sees the confirmation dialog dismiss, the list reload, and the
// membership still marked active. They tap again. Or — worse and more common —
// they do not look, and walk away believing they froze a membership that is
// still billing.
//
// So the count is what is checked, never `error` alone. `{ count: 'exact' }`
// on the update/delete makes PostgREST return how many rows it touched, and
// this module turns that into a sentence.
//
// ── Why a missing count is a failure, not a pass ────────────────────────────
//
// `count` is null unless the caller asked for it. A helper that treated null as
// "fine" would silently re-admit every unconverted call site — which is the
// entire population this module was written to close — so null is reported as
// not-confirmed and says which half is missing. A write that genuinely does not
// care whether it matched should not be calling this.

/** The shape of a supabase-js write result, narrowed to what matters here. */
export interface WriteResult {
  error?: unknown | null;
  count?: number | null;
}

/**
 * The reason this write cannot be reported as having happened, or null when it
 * can.
 *
 * Pure, so the sentence an owner reads is assertable without a database. `what`
 * is the thing in the owner's words — "that membership", "this shift" — and is
 * interpolated into the message, so it reads as a sentence rather than as a
 * field name.
 */
export function writeFailure(what: string, r: WriteResult): string | null {
  if (r.error) {
    // The server said no and said why. That message belongs to the report, not
    // to the user, so the caller reports it; this only states the outcome.
    return `${what} could not be saved.`;
  }
  if (r.count == null) {
    // Not "zero rows" — "nobody counted". Naming the omission is what makes
    // this findable when a new call site forgets `{ count: 'exact' }`.
    return `${what} was sent, but the server did not say whether it changed anything.`;
  }
  if (r.count === 0) {
    return `${what} was not changed — the server accepted the request and matched no rows, which usually means it is not yours to change or it is no longer there.`;
  }
  return null;
}

/**
 * Throw unless the write landed.
 *
 * The write helpers in this folder already signal failure by throwing, and
 * every owner call site is a try/catch around one of them, so this keeps that
 * contract rather than introducing a second one they would have to branch on.
 */
export function assertWrote(what: string, r: WriteResult): void {
  const why = writeFailure(what, r);
  if (why) throw new Error(why);
}
