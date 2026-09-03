// An account with no gym on it, and why that is not a quiet gym.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// Three of the console's money screens began the same way: read the signed-in
// profile, and if it carries no `tenant_id`, write every slice of the month as
// a SUCCESSFUL EMPTY READ.
//
//   if (!who?.tenantId) {
//     setLoaded({ key, books: { invoices: { rows: [], state: null, why: null }, … } });
//     return;
//   }
//
// `rows: []` with no state and no reason is, to every component downstream, a
// query that ran and found nothing. So /accounting printed "No payment is
// recorded in August. That is a statement about the record, not about the till.",
// a register with no invoices in it, and a reconciliation reporting that both
// sides line up — to a member of staff whose account had simply lost its link
// to the gym. Three confident statements about a gym's trading, assembled out
// of a fact about the reader's profile, on the screens somebody files from.
//
// It is the exact substitution src/lib/rowCap.ts and half this codebase's
// comments exist to prevent, and it arrived through the front door rather than
// through a row cap: nobody had to truncate anything, because no read was ever
// made.
//
// ── Why a module rather than an `if` on each screen ────────────────────────
//
// Because there are three of them and they drifted. /sessions had already been
// given the right answer — a sentence instead of a payroll board — and the
// wording of that answer is the part that matters: an owner who reads "no
// payments recorded" goes and looks for their money, and an owner who reads
// "your account is not linked to a gym" goes and asks somebody to link it.
// Those are different afternoons.
//
// The distinction this draws is between the reader and the gym, and it is the
// same distinction `fetchGymZone` draws and for the same stated reason: an
// instruction to go and change a setting, printed over something that is not a
// setting, sends somebody to change what is already correct.

/** A gym id that may be used, or the sentence to print instead of a figure. */
export type GymLink =
  | { linked: true; tenantId: string }
  | { linked: false; note: string };

/**
 * The invariant half of the sentence — the clause that says which of the two
 * facts this is.
 *
 * Kept whole rather than composed from fragments, because it is the half a
 * caller would be most tempted to shorten and it is the half that does the
 * work: without it, "there is nothing here" is what the reader takes away.
 */
export const NOT_A_QUIET_GYM =
  'This is not a gym with nothing in it — it is an account with no gym on it. The owner sets that.';

/**
 * What to say when the reader's profile carries no gym.
 *
 * `what` is a plain-English plural noun phrase for the thing that was not read
 * — "payments", "recorded costs", "invoices to reconcile" — and it is named
 * rather than generic because this sentence replaces a figure somebody came to
 * the screen for.
 */
export function noGymNote(what: string): string {
  const subject = (what || '').trim() || 'records';
  return `Your account is not linked to a gym, so there are no ${subject} to read. ${NOT_A_QUIET_GYM}`;
}

/**
 * A tenant id, or the reason there is nothing to read.
 *
 * Never returns an empty result. A caller that gets `linked: false` must render
 * `note`; writing `rows: []` for it is the defect this module is named after.
 *
 * A blank or whitespace-only id is treated as absent. `tenant_id` is a uuid
 * column, so an empty string is not a gym anybody could read — and passing one
 * through would send a `tenant_id=eq.` filter that matches nothing and comes
 * back as, once again, a successful empty read.
 */
export function gymLink(tenantId: string | null | undefined, what: string): GymLink {
  const id = (tenantId ?? '').trim();
  return id ? { linked: true, tenantId: id } : { linked: false, note: noGymNote(what) };
}
