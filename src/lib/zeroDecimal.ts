// The currencies that have no minor unit — the one list, in the one place that
// everything can reach.
//
// ── Why this is its own file ──────────────────────────────────────────────
//
// The list lived in src/lib/coachMoney.ts and is still imported from there by
// everything in the app: `coachMoney.ts` re-exports it, so nothing had to
// change and there is still exactly one copy of it in the tree.
//
// It moved here because coachMoney.ts imports `./locale`, and a module with any
// import at all cannot be read by the Deno edge functions. Those resolve
// relative paths with explicit extensions — `../../../src/lib/adMatch.ts` — so
// every src/lib module they share is a LEAF with no imports of its own. That is
// why adMatch.ts, directCharges.ts, refunds.ts and subscriptionScope.ts all
// have none. `ads-sync` needs this list to read a Meta ad account's spend at the
// right scale, and the alternative to this file was a second copy of sixteen
// currency codes inside the function — the copy that would still say what it
// says today after somebody adds the seventeenth here.
//
// ── What it is FOR ────────────────────────────────────────────────────────
//
// "Minor units" is how Stripe, and therefore this whole codebase, stores money:
// an integer, so no float ever touches a ledger. How many minor units make one
// whole unit is NOT a hundred. It is a hundred in most currencies and ONE in
// these: there are no sen in a yen, so ¥50,000 is stored as 50000, not
// 5,000,000, and Stripe's own API takes and returns it that way.
//
// Getting it backwards is a hundredfold error in either direction — a figure
// printed as a hundredth of itself, or a figure STORED as a hundred times
// itself — and it is invisible to anyone who does not bill in one of these,
// which is nearly everyone who reads the code. That is exactly why it is one
// list and not sixteen strings scattered through the money paths.
//
// Lowercase, because Stripe reports currencies lowercase and every lookup here
// normalises to that before asking.

/** ISO 4217 codes Stripe bills in whole units. Lowercase; callers normalise. */
export const ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);
