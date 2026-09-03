// Which currency a coach is priced in, and which of the two places it came
// from — decided ONCE, here, rather than by whichever screen asked.
//
// ── The rule, in one sentence ─────────────────────────────────────────────
//
//     The gym on `profiles.tenant_id` is the authority on the currency.
//     `trainers.currency` (part 940) applies IF AND ONLY IF there is no gym.
//
// Not "whichever answered". Not "the coach's own if the gym has not set one".
// A coach inside a gym whose owner has not chosen yet is a coach WAITING ON
// THEIR OWNER: answering them from their own column would price their packages
// differently from the coach at the next desk, put a different currency on
// their invoices from the one their clients are charged in, and do it silently.
// So a gym that exists and has set nothing produces a withheld figure and a
// sentence naming the owner — exactly what it produced before part 940 — and
// the coach's own column stays dormant.
//
// ── Why this is a module and not three lines in a screen ──────────────────
//
// Because the second answer is the whole danger. `fetchInvoiceCurrency` in
// src/ui/coachInvoices.ts and `issue_coach_invoice()` in part 138 already
// disagreed about a coach's currency for a year — one read
// `profiles.tenant_id`, the other `trainers.tenant_id`, and part 711 leaves
// those two pointing at different gyms once somebody has left one. Nobody
// noticed, because both answers render perfectly. A precedence rule that lives
// in six screens is six rules.
//
// ── A failed read is not "unset", and that is most of this file ───────────
//
// `myTenantCurrency()` returns `{ currency: null, error }` on a refused read,
// and reading the null before the error is precisely how "your gym has not set
// a currency" came to be said to coaches whose read had timed out (see
// src/lib/currencyGap.ts, which exists for that bug). The same trap is now
// doubled: a failed read of the GYM half must not fall through to the coach's
// own column, because "no gym" is then not established, and offering a coach a
// currency picker on the strength of it would let them write a currency onto
// an account that already has one.
//
// So the gym half is examined first, its failure is checked before its
// emptiness, and the coach's own half is only ever consulted once "there is no
// gym" is an ANSWER rather than an absence of one.
//
// Nothing here imports the Supabase client — the reads live in
// src/lib/myCurrency.ts, which hands the two halves to `resolveMyCurrency`
// below. That is the rule every tested module in src/lib follows and it is
// enforced by the runner: these tests are compiled by tsc and run by plain
// node, so one import of `./supabase` would take this file out of the suite.

/** Where a currency came from. Never guessed, and never both. */
export type CurrencyFrom = 'gym' | 'own';

/**
 * The gym half of the answer, already fetched.
 *
 * `hasGym` is `profiles.tenant_id is not null` — the column the tenant
 * provider and `myTenantCurrency()` both resolve, and deliberately NOT
 * `trainers.tenant_id`, which part 711 leaves pointing at a gym a coach has
 * left.
 *
 * `failed` covers the profile read AND the tenant read. Either one failing
 * means the gym is UNKNOWN, which is not the same as absent and must not be
 * allowed to become it.
 */
export interface GymCurrencyRead {
  hasGym: boolean;
  currency: string | null;
  failed: boolean;
}

/**
 * The coach's own half, already fetched.
 *
 * `hasRow` is whether a `trainers` row exists for this account at all. False
 * is a real state — there is nowhere for a currency to live — and it is not
 * "you have not chosen yet", because a picker drawn on the second would write
 * nothing and say it had worked.
 *
 * `unavailable` is part 940 not being applied: the column does not exist, so
 * the select errored. That is a deploy step and it must never be reported to a
 * coach as a refusal or as a setting nobody has made.
 */
export interface OwnCurrencyRead {
  hasRow: boolean;
  currency: string | null;
  failed: boolean;
  unavailable: boolean;
}

/** Why there is no code to print. Six causes, six sentences — see
 *  `myCurrencyLine`. Loading, failed and empty are never the same words. */
export type MyCurrencyGap =
  /** Still in flight. Nothing is known and nothing may be asked of anybody. */
  | 'reading'
  /** A read failed or was refused. UNKNOWN — emphatically not "none is set". */
  | 'unreadable'
  /** `trainers.currency` does not exist yet. A migration waiting to be applied. */
  | 'unavailable'
  /** No gym, and no `trainers` row either: nowhere a currency could be kept. */
  | 'nowhere'
  /** There is a gym and it has set none. An owner fixes this. */
  | 'gym-unset'
  /** There is no gym, and the coach has not chosen. THEY fix this. */
  | 'own-unset';

/** The whole answer: the code, where it came from, why it is missing when it
 *  is, and whether the coach may name one right now. */
export interface MyCurrency {
  /** ISO 4217, uppercase, or null. Null is never a reason to fall back. */
  currency: string | null;
  from: CurrencyFrom | null;
  gap: MyCurrencyGap | null;
  /**
   * True only when a picker would actually write something: no gym, a
   * `trainers` row to write to, part 940 applied, nothing already set, and
   * both halves read. Every one of those has to hold, and the last two are the
   * ones that matter — a picker offered over a failed read lets a coach set a
   * currency onto an account that may already have one, which is the reprice
   * this whole control refuses to perform.
   */
  canSetOwn: boolean;
}

const code = (v: string | null | undefined): string | null => {
  const c = (v || '').trim().toUpperCase();
  return c ? c : null;
};

const gapOnly = (gap: MyCurrencyGap): MyCurrency => ({ currency: null, from: null, gap, canSetOwn: false });

/**
 * The precedence rule, applied.
 *
 * ORDER IS THE WHOLE OF IT, and it is the same order `currencyGapOf` uses for
 * the same reason: the failure is checked before the emptiness, at every step.
 *
 *   1. still reading — nothing is known.
 *   2. the gym read FAILED — unknown. Not "no gym", so the coach's own column
 *      is not consulted and no picker is offered.
 *   3. there IS a gym — its currency is the answer, set or not. The coach's
 *      own column is never read past this line.
 *   4. there is no gym — the coach's own half decides, with its own failure
 *      checked before its own emptiness.
 */
export function resolveMyCurrency(gym: GymCurrencyRead, own: OwnCurrencyRead, loading = false): MyCurrency {
  if (loading) return gapOnly('reading');
  // Before `hasGym`, always. A refused profile read gives `hasGym: false` and
  // reading that as "independent" is how a coach in a gym would be offered a
  // picker that writes over their gym's own setting.
  if (gym.failed) return gapOnly('unreadable');

  if (gym.hasGym) {
    const c = code(gym.currency);
    if (c) return { currency: c, from: 'gym', gap: null, canSetOwn: false };
    // A gym with no currency is the owner's to fix, and it stays that way.
    // This is the branch part 164 already serves for a coach alone in a
    // personal tenant, and `trainers.currency` is deliberately not reached.
    return gapOnly('gym-unset');
  }

  if (own.failed) return gapOnly('unreadable');
  if (own.unavailable) return gapOnly('unavailable');
  if (!own.hasRow) return gapOnly('nowhere');
  const c = code(own.currency);
  if (c) return { currency: c, from: 'own', gap: null, canSetOwn: false };
  return { currency: null, from: null, gap: 'own-unset', canSetOwn: true };
}

/**
 * The sentence to print, given the gap and what the coach loses by it.
 *
 * `consequence` is a clause continuing "…, so ___" — lower case, no full stop,
 * e.g. "there is no unit to price these sessions in". The fragment is what
 * lets one set of explanations serve six different figures without any of them
 * saying something vague about "amounts". Same contract as
 * `currencyGapLine` in src/lib/currencyGap.ts, which this is the wider sibling
 * of: that one knows about a gym, this one also knows about a coach who has
 * none.
 *
 * Only 'gym-unset' names an owner. That sentence was previously printed at
 * every one of these causes, and it is false at five of them — it sent a coach
 * whose read had timed out to chase a person about a setting that was already
 * correct, and it sent an independent coach to chase a person who does not
 * exist.
 */
export function myCurrencyLine(gap: MyCurrencyGap, consequence: string): string {
  const c = consequence.trim().replace(/[.]+$/, '');
  switch (gap) {
    case 'reading':
      return `Your currency is still being read, so ${c}.`;
    case 'unreadable':
      return `Your currency could not be read, so ${c}. That is a read that failed rather than a setting nobody has made — try again in a moment.`;
    case 'unavailable':
      return `Setting a currency of your own is not switched on yet, so ${c}. That is a change waiting to be applied to the database rather than anything you have done.`;
    case 'nowhere':
      return `There is no coach record on this account, so ${c}. Nothing can be set here until there is one.`;
    case 'gym-unset':
      return `Your gym has not set a currency, so ${c}. An owner sets one in the gym settings.`;
    case 'own-unset':
      return `You have not said what you charge in, so ${c}. You are attached to no gym, so it is yours to choose — you set it once in Settings.`;
  }
}

/**
 * Where the figure on screen came from, in the coach's words, or null when
 * there is nothing to say.
 *
 * Printed beside a total rather than left implicit because the two sources
 * behave differently and the coach can only act on one of them: a gym's
 * currency changes when its owner changes it, and their own changes never.
 */
export function currencyFromNote(from: CurrencyFrom | null, currency: string | null): string | null {
  const c = code(currency);
  if (!c || !from) return null;
  return from === 'gym' ? `Priced in ${c}, from your gym’s setting` : `Priced in ${c}, which you set`;
}
