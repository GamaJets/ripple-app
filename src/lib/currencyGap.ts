// Why there is no currency to print, in the coach's words.
//
// ── Four causes, one sentence ─────────────────────────────────────────────
//
// Repple is white-labelled and `tenants.currency` is nullable on purpose (part
// 99): a gym that has not said is not to be guessed at. Every money figure in
// the coach app is therefore withheld when there is no code to put in front of
// it, and that withholding is right and is not what this file is about.
//
// What this file is about is the SENTENCE printed in place of the figure. The
// reads behind a currency can come up empty for four different reasons:
//
//   · they have not finished — nothing is known yet;
//   · a read was refused or the wire dropped — `myTenantCurrency` returns an
//     `error`, `fetchInvoiceCurrency` returns `status: 'error'`;
//   · part of the read answered and part did not — `fetchInvoiceCurrency`
//     returns 'partial' when one of its two halves failed and the other had
//     nothing to say;
//   · everything was read and nobody has set one.
//
// Only the last is "your gym has not set a currency", and only the last is
// fixed by a gym owner. The callers collapsed all four onto that sentence —
// analytics.tsx discarded `myTenantCurrency`'s `error` field entirely, and
// invoices.tsx branched on 'error' and let 'partial' fall through — so a coach
// whose profiles read was refused for thirty seconds was sent to chase their
// gym owner over a setting that was already correct. The owner then looks,
// finds a currency, and neither of them learns anything.
//
// The distinction is already carried by both providers. This is the part that
// says it out loud.

/** Why no currency code is available to print. */
export type CurrencyGap =
  /** The read is still in flight. Nothing is known and nothing may be asked of anybody. */
  | 'reading'
  /** The read failed or was refused. UNKNOWN — this is not "none is set". */
  | 'unreadable'
  /** Part of the read answered and part did not, so "none is set" is not established. */
  | 'incomplete'
  /** Everything answered and there genuinely is no currency on record. */
  | 'unset';

/**
 * The gap behind a `myTenantCurrency()` answer — `{ currency, error }` — plus
 * whether the call has come back at all yet.
 *
 * Returns null when a currency IS available, which is the caller's cue that
 * there is no sentence to print.
 */
export function currencyGapOf(
  input: { currency: string | null; error: string | null; loading: boolean },
): CurrencyGap | null {
  if (input.currency) return null;
  if (input.loading) return 'reading';
  // The error is checked before the null currency, not after. Both are present
  // on a failed read — `myTenantCurrency` returns `{ currency: null, error }` —
  // and reading the null first is exactly how the failure became "not set".
  return input.error ? 'unreadable' : 'unset';
}

/**
 * The same, for a provider that reports a `LoadStatus` instead of an error
 * string — `fetchInvoiceCurrency`. 'partial' is its own answer here: it means
 * one of the two reads behind the currency failed, so an absent code has not
 * been established as absent.
 */
export function currencyGapOfStatus(
  input: { currency: string | null; status: 'loading' | 'ready' | 'partial' | 'error' },
): CurrencyGap | null {
  if (input.currency) return null;
  if (input.status === 'loading') return 'reading';
  if (input.status === 'error') return 'unreadable';
  if (input.status === 'partial') return 'incomplete';
  return 'unset';
}

/**
 * The sentence to print, given the gap and what the coach loses by it.
 *
 * `consequence` is a clause continuing "…, so ___" — lower case, no full stop,
 * e.g. "there is no unit to price these sessions in". Keeping it as a fragment
 * is what lets one set of explanations serve six different figures without any
 * of them saying something vague about "amounts".
 *
 * Only 'unset' names the gym owner. The other three name a read, and say to try
 * again — which is the action that actually resolves them.
 */
export function currencyGapLine(gap: CurrencyGap, consequence: string): string {
  const c = consequence.trim().replace(/[.]+$/, '');
  switch (gap) {
    case 'reading':
      return `Your currency is still being read, so ${c}.`;
    case 'unreadable':
      return `Your currency could not be read, so ${c}. That is a read that failed rather than a setting nobody has made — try again in a moment.`;
    case 'incomplete':
      return `Your currency could not be established, because part of the read did not come back, so ${c}. That is not the same as nobody having set one — try again in a moment.`;
    case 'unset':
      return `Your gym has not set a currency, so ${c}. An owner sets one in the gym settings.`;
  }
}

/**
 * The same four causes, about SOMEBODY ELSE'S money.
 *
 * `currencyGapLine` above is written to a coach about their own gym: it says
 * "your currency" and, for 'unset', sends them to an owner who can fix it. The
 * client's coach directory needs the identical distinction and none of that
 * voice. A member browsing coaches is not the customer of any of those gyms,
 * cannot fix anybody's setting, and must not be told to go and chase one —
 * "your gym has not set a currency" is simply false addressed to them.
 *
 * So this is the third-person half. `who` is a description rather than a name —
 * "this coach", "their gym" — because a name that could not be read renders as
 * a dash, and a dash as the subject of a sentence reads as the screen having
 * broken (scripts/check-prose.mjs).
 *
 * The three read-failure branches deliberately do NOT say "try again": on a
 * directory the member did not ask for this figure and has nothing to retry.
 * They say what the number is and is not, which is the fact they need in order
 * to ask the coach.
 */
export function currencyGapLineAbout(gap: CurrencyGap, who: string): string {
  const w = who.trim();
  switch (gap) {
    case 'reading':
      return `The currency for this figure is still loading, so it is a number without a unit for the moment.`;
    case 'unreadable':
      return `We could not read what ${w} charges in, so this is a number without a currency. It is not a price in any currency this app has picked.`;
    case 'incomplete':
      return `Only part of the read behind this came back, so we cannot say what ${w} charges in. This is a number without a currency, and not a price in any currency this app has picked.`;
    case 'unset':
      return `${w.charAt(0).toUpperCase()}${w.slice(1)} has not told us which currency they charge in, so this is a number without a unit. Ask them before you book.`;
  }
}
