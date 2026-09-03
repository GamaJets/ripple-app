// What money a set of delivered sessions is actually denominated in.
//
// ── The defect this exists to close ───────────────────────────────────────
//
// `sessions.rate_cents` was snapshotted for five parts with no companion
// currency column. Part 33's comment says why the snapshot is there — "changing
// a trainer's fee next month does not silently rewrite what last month cost" —
// and it snapshotted half the fact. An integer of minor units names no money, so
// every reader supplied the unit from `tenants.currency`: the gym's currency
// TODAY.
//
// This product lets an owner change that column, from /settings and from their
// phone. The moment they do:
//
//   · /sessions, /payroll and /coach/earnings relabel the gym's entire PT
//     history with the new code, in one write, with nothing on any screen
//     marking a single figure as re-denominated;
//   · `recordSettlement` stamps that code onto a `payroll_settlements` row,
//     which is a permanent payment record /accounting and /close read back as
//     fact and an accountant reconciles against a bank statement;
//   · `settlementAmount` adds the rates up across the change, producing a total
//     in no currency at all.
//
// supabase/parts/1010 adds `sessions.rate_currency` and records the unit at the
// moment the rate is written. This module is the reading half: the rules that
// decide what a RUN of sessions is worth and in what, and refuse rather than
// guess when the answer is more than one thing.
//
// ── Why a null currency is not the gym's currency ─────────────────────────
//
// Every session delivered before part 1010 has a rate and no unit, and nothing
// backfills them — the part says at length why a backfill from
// `tenants.currency` is exactly the fiction the column exists to prevent. So
// `rateCurrency: null` means UNRECORDED, and this module keeps it as a distinct
// answer all the way to the screen rather than resolving it. A caller that wants
// to price such a run against the gym's currency today has to say so, out loud,
// in a sentence a reader can see — which is what the 'unrecorded' member of
// `RunCurrency` and the sentence `totalNote` writes for it are for.
//
// Pure: no react, no supabase, no clock.

/** The two fields of a session this module reads. Structural, so a `PtSession`,
 *  a settlement line or a hand-built row all fit without importing each other. */
export interface RatedSession {
  rateCents: number | null;
  rateCurrency: string | null;
}

/** A sum of rates that are all in one money. `currency` null is the pot of
 *  sessions whose unit was never recorded — never a pot in the gym's money. */
export interface RatePot {
  currency: string | null;
  minorUnits: number;
  count: number;
}

const code = (v: string | null | undefined): string | null => {
  const c = (v || '').trim().toUpperCase();
  return c ? c : null;
};

/**
 * The rates of these sessions, grouped by the money each is actually in.
 *
 * Sessions with no rate at all are absent from every pot and counted nowhere:
 * unpriced work is not a zero, which is the one default this codebase refuses.
 *
 * Ordered: recorded currencies alphabetically, then the unrecorded pot last, so
 * two screens listing the same run cannot list it in two orders.
 */
export function ratePots(sessions: readonly RatedSession[]): RatePot[] {
  const pots = new Map<string, RatePot>();
  for (const s of sessions) {
    if (s.rateCents == null || !Number.isFinite(s.rateCents)) continue;
    const cur = code(s.rateCurrency);
    const key = cur ?? '\u0000';
    const pot = pots.get(key) ?? { currency: cur, minorUnits: 0, count: 0 };
    pot.minorUnits += s.rateCents;
    pot.count += 1;
    pots.set(key, pot);
  }
  return [...pots.values()].sort((a, b) => {
    if (a.currency === b.currency) return 0;
    if (a.currency === null) return 1;
    if (b.currency === null) return -1;
    return a.currency.localeCompare(b.currency);
  });
}

/**
 * What one run of sessions is denominated in.
 *
 *   'none'        nothing in this run carries a rate. There is no money here to
 *                 name, and no total to print.
 *   'one'         every priced session agrees, and `currency` is that code.
 *   'unrecorded'  every priced session predates part 1010. The figures are real
 *                 and the unit is genuinely not on the record; a reader must be
 *                 told that rather than shown the gym's code over the top.
 *   'mixed'       two or more answers in one run — which includes "some recorded
 *                 and some not", because that is also two answers.
 */
export type RunCurrency =
  | { kind: 'none' }
  | { kind: 'one'; currency: string; minorUnits: number; count: number }
  | { kind: 'unrecorded'; minorUnits: number; count: number }
  | { kind: 'mixed'; pots: RatePot[] };

export function runCurrency(sessions: readonly RatedSession[]): RunCurrency {
  const pots = ratePots(sessions);
  if (pots.length === 0) return { kind: 'none' };
  if (pots.length > 1) return { kind: 'mixed', pots };
  const only = pots[0];
  return only.currency === null
    ? { kind: 'unrecorded', minorUnits: only.minorUnits, count: only.count }
    : { kind: 'one', currency: only.currency, minorUnits: only.minorUnits, count: only.count };
}

/** How a run reads when it is named in a sentence. Sorted, comma-joined, and
 *  the unrecorded pot is described rather than given a fake code. */
export function potNames(pots: readonly RatePot[]): string {
  return pots
    .map((p) => (p.currency === null
      ? `${p.count} session${p.count === 1 ? '' : 's'} in a currency nobody recorded`
      : `${p.count} session${p.count === 1 ? '' : 's'} in ${p.currency}`))
    .join(', ');
}

/**
 * Why this run cannot be settled as one payment, or null when it can.
 *
 * `gymCurrency` is `tenants.currency` as it stands NOW — what `recordSettlement`
 * would stamp on the payment row. It is compared against what the sessions
 * actually say, and a disagreement is refused rather than resolved: the
 * settlement row is permanent, an accountant reads it back as fact, and there is
 * nothing downstream that could ever notice the label was supplied by the screen
 * rather than by the work.
 *
 * The unrecorded case is allowed through with no sentence ONLY when the gym has
 * a currency and nothing contradicts it — those sessions were priced by this gym
 * in whatever it charged in, and refusing every pre-part-1010 run would stop
 * every existing gym paying its coaches. What is refused is the case where the
 * record positively disagrees with the label about to be applied.
 */
export function settleCurrencyBlocker(
  sessions: readonly RatedSession[],
  gymCurrency: string | null | undefined,
): string | null {
  const gym = code(gymCurrency);
  const run = runCurrency(sessions);
  switch (run.kind) {
    case 'none':
      return null;
    case 'mixed':
      return `These sessions were not all priced in the same money — ${potNames(run.pots)}. One settlement is one payment in one currency, and paying them together would file a total that is not an amount of anything. Settle each currency's sessions on its own.`;
    case 'unrecorded':
      return gym
        ? null
        : 'These sessions carry rates and no currency, and this gym has not set one either, so there is nothing that could say what the payment is in. An owner sets the gym’s currency on the settings screen.';
    case 'one':
      if (!gym) {
        return `These sessions were priced in ${run.currency}, and this gym has not set a currency, so the settlement has nothing to be recorded in. Set it to ${run.currency} on the settings screen and this run settles as it stands.`;
      }
      return gym === run.currency
        ? null
        : `These sessions were priced in ${run.currency} and this gym now charges in ${gym}. Recording the payment would stamp ${gym} on ${run.count} session${run.count === 1 ? '' : 's'} of ${run.currency} work, permanently, on the row an accountant reconciles. Repple does not convert money — settle this period in ${run.currency}, or correct the sessions first.`;
  }
}

/**
 * The one currency a run's total may be LABELLED with, or null when no single
 * label is honest.
 *
 * Deliberately narrower than `settleCurrencyBlocker`: that one asks whether a
 * payment may be made, this one asks whether a figure may be printed. A run of
 * unrecorded rates has no code of its own, so it gets null here even at a gym
 * with a currency — the screen prints the figure with the unit withheld and the
 * reason beside it, which is what this codebase does everywhere else a currency
 * is missing.
 */
export function runLabel(sessions: readonly RatedSession[]): string | null {
  const run = runCurrency(sessions);
  return run.kind === 'one' ? run.currency : null;
}

/** Why a run's total cannot be printed as one figure, or null when it can.
 *  The sentence that goes under a withheld total. */
export function totalNote(sessions: readonly RatedSession[]): string | null {
  const run = runCurrency(sessions);
  switch (run.kind) {
    case 'none': return null;
    case 'one': return null;
    case 'unrecorded':
      return `These ${run.count} session${run.count === 1 ? ' was' : 's were'} filed before Repple recorded what money a session rate is in, so the figure is real and the currency is genuinely not on the record. It is deliberately not labelled with what this gym charges in today — that would be a guess about the past.`;
    case 'mixed':
      return `This period covers more than one currency — ${potNames(run.pots)} — so there is no single total. Money is never added across currencies here.`;
  }
}
