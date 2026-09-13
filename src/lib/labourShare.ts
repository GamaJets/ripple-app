// What a published rota week costs against what the gym took — and the eleven
// ways that question has no answer.
//
// ── why this is a module and not two lines on a screen ────────────────────
//
// app/(owner)/rota.tsx contained no money at all. It reported coverage,
// uncovered hours and idle hours over a week of shifts that each carry a price
// (`gym_shifts.rate_cents`, supabase/parts/196) and never once said what the
// week costs, or what share of the till the floor eats. Both figures are on the
// first screen of ABC Ignite and Glofox, and an owner deciding whether to roster
// a sixth Saturday shift is deciding a money question with no money on screen.
//
// The COST half already exists and is already tested: `rotaCost` in
// src/lib/gymRota.ts pots by currency, withholds a mixed total and keeps
// `priced`/`unpriced` apart. Nothing here reimplements it — this module takes
// its output as an argument.
//
// What did not exist anywhere is the SHARE, and a share is where the two
// currency rules meet. `rotaCost` refuses to add GBP to AED. `sharedCurrency`
// refuses to add two moneys in the ledger. Neither of them has anything to say
// about DIVIDING a GBP cost by an AED till, which produces a clean-looking
// percentage out of two numbers that were never comparable — the one arithmetic
// in this area that no existing gate catches, because no existing code does it.
//
// ── the division is the only place a minor unit does not matter ───────────
//
// Both sides are minor units. Where they are the same currency the factor
// cancels: 45000 fils over 180000 fils is the same quarter as 450 pence over
// 1800 pence, and the KWD three-decimal and JPY zero-decimal cases need no
// special handling BECAUSE nothing is ever converted to a whole unit here. This
// is stated out loud because the obvious "fix" — majorFromMinor on each side
// before dividing — would introduce a scale error this shape does not have.
// Where they are NOT the same currency there is no percentage at all, and that
// is the refusal below rather than a conversion.
//
// ── a rate nobody recorded is not a free shift ────────────────────────────
//
// `rotaCost.unpriced` counts the live shifts carrying no rate. Their cost is
// UNKNOWN, and a share computed over the priced ones alone is therefore a
// FLOOR, not the figure. `atLeast` says so and the screen is required to print
// it that way. Dropping that flag would report a gym that has costed two of its
// nine shifts as spending almost nothing on labour, which is the flattering
// direction and the reason this module exists in the first place.
//
// ── a fact the brief for this work got wrong, recorded here ───────────────
//
// There is no such thing as an unassigned shift to withhold a cost for.
// `gym_shifts.trainer_id` is `uuid not null references trainers(id)` in
// supabase/parts/43, and `Shift.trainerId` is a bare `string`. The real and
// live version of that distinction is the UNPRICED shift above, which is the
// one this module carries.
//
// Pure: no react, no supabase, no clock, no formatting.
import { MIXED_CURRENCY_NOTE } from './sumCurrency';

/**
 * How complete a read behind one side of this sum is.
 *
 * Deliberately the same four words as `LoadStatus` in src/ui/loadStatus.ts, so
 * a screen holding one passes it straight in and cannot lose 'partial' in a
 * translation step. It is redeclared rather than imported because this file has
 * no business pulling a react module in, and `isWhole`'s own header is the
 * argument for why the four must stay four.
 */
export type ReadState = 'loading' | 'ready' | 'partial' | 'error';

/** The shape of `rotaCost`'s answer, structurally — so a `RotaCost`, or a row
 *  built by hand in a test, fits without either file importing the other. */
export interface RotaCostLike {
  /** Minor units across the live shifts that carry a rate. Null is "none do",
   *  which is not zero. */
  cents: number | null;
  currency: string | null;
  mixedCurrency: boolean;
  priced: number;
  unpriced: number;
}

/** The till side: a sum of `gym_payments` rows and the currency they were
 *  found to share. `currency` null is `sharedCurrency` saying they share none. */
export interface TakingsLike {
  cents: number | null;
  currency: string | null;
}

/**
 * Why there is no share, or 'ok' when there is one.
 *
 * Eleven refusals and not one fallback. Every member below is a different
 * sentence to an owner, and the four that would be easiest to merge are the
 * four it would be most expensive to: 'no_rota_cost' means nobody has priced a
 * shift, 'rota_unread' means we could not ask, 'rota_partial' means we asked and
 * got a prefix, and 'no_takings' means the gym is the one with nothing. Folding
 * any pair of those together tells an owner to go and fix the wrong thing.
 */
export type ShareGap =
  /** There is a share and a pair of figures that justify it. */
  | 'ok'
  /** One of the two reads is still in flight. Nothing is being withheld yet. */
  | 'loading'
  /** The week's shifts could not be read. Not an unstaffed week. */
  | 'rota_unread'
  /** The shift read came back at the row cap. The shifts are real; the week is
   *  a prefix of itself, and a cost over it is a figure with an unknown
   *  denominator. */
  | 'rota_partial'
  /** The ledger could not be read. Not a gym that took nothing. */
  | 'takings_unread'
  /** The payment read came back short, so the till is a floor and not a total. */
  | 'takings_partial'
  /** No live shift on the rota carries a rate. The week costs an unknown
   *  amount, which is not the same fact as costing nothing. */
  | 'no_rota_cost'
  /** The rota has a cost and no currency to write it in. */
  | 'rota_unstated'
  /** The rated shifts are in more than one money, so there is no one cost. */
  | 'rota_mixed'
  /** The payments are in more than one money, so there is no one till. */
  | 'takings_mixed'
  /** The gym recorded no money coming in over the window, so there is nothing
   *  for the wage bill to be a share OF. Dividing by it would be infinity, and
   *  rendering infinity as a percentage is the failure this member prevents. */
  | 'no_takings'
  /** Both sides are known, both are stated, and they are stated in different
   *  moneys. This is the one Repple cannot resolve: there is no rate anywhere
   *  in this product and a percentage across two currencies is a number with no
   *  referent at all. */
  | 'currency_mismatch';

export interface LabourShare {
  /** The wage bill as a fraction of takings — 0.42 for 42% — or null. Never
   *  clamped: a week that costs more than it took is a real and urgent 1.4, and
   *  flattening it to 100% would hide exactly the week an owner needs to see. */
  share: number | null;
  gap: ShareGap;
  /**
   * True when `share` is a FLOOR rather than the figure, because some live
   * shift carries no rate. A screen holding this must say "at least"; a screen
   * that drops it is reporting unpriced work as free.
   */
  atLeast: boolean;
  /** The money both sides agreed on, or null. Present on 'ok' only. */
  currency: string | null;
  /** The sentence to print in place of, or under, the figure. Null on a clean
   *  'ok' with nothing outstanding — there is nothing to explain. */
  note: string | null;
}

const code = (v: string | null | undefined): string | null =>
  (v ?? '').trim().toUpperCase() || null;

const withheld = (gap: ShareGap, note: string | null): LabourShare =>
  ({ share: null, gap, atLeast: false, currency: null, note });

/** How many live shifts a cost was made of, said the same way in both of the
 *  sentences that need it. */
function pricedOf(cost: RotaCostLike): string {
  const live = cost.priced + cost.unpriced;
  return `${cost.priced} of ${live} shift${live === 1 ? '' : 's'}`;
}

/**
 * The wage bill as a share of the till, or the reason there is none.
 *
 * `cost` is `rotaCost` over the week's shifts and `costState` is how that read
 * went; `takings` is the sum of the window's payments with the currency
 * `sharedCurrency` found them to agree on, and `takingsState` is how THAT read
 * went. Both states are asked for separately because the two are separate reads
 * on the screen and either can fail while the other returns — and a share
 * computed over one good half and one empty half is the most confident wrong
 * number this screen could print.
 *
 * A null `cost` or `takings` under a 'ready' state is treated as the unread
 * case rather than as zero. That is not defensive padding: it is the same rule
 * as everywhere else in this tree, and a caller that has genuinely nothing has
 * a state to say so with.
 */
export function labourShare(
  cost: RotaCostLike | null | undefined,
  costState: ReadState,
  takings: TakingsLike | null | undefined,
  takingsState: ReadState,
): LabourShare {
  // Loading first, and over both sides, because "not yet" is not a refusal and
  // must not be drawn like one. A screen that reports "your rota could not be
  // read" for the second before the read lands has told an owner something
  // false about their own data.
  if (costState === 'loading' || takingsState === 'loading') {
    return withheld('loading', null);
  }
  if (costState === 'error') {
    return withheld('rota_unread',
      'This week’s rota could not be read, so what the floor costs is unknown — not nothing.');
  }
  if (costState === 'partial') {
    return withheld('rota_partial',
      'This week’s shift read came back at its row limit, so these are some of the week’s shifts and not the week. No cost is stated over a set that is a prefix of itself.');
  }
  if (takingsState === 'error') {
    return withheld('takings_unread',
      'Your payments could not be read, so there is nothing to state the wage bill as a share of. This is not a week in which the gym took nothing.');
  }
  if (takingsState === 'partial') {
    return withheld('takings_partial',
      'The payment read came back at its row limit, so the takings behind this are a floor rather than a total, and a share over them would read lower than the truth.');
  }
  if (!cost) {
    return withheld('rota_unread',
      'This week’s rota could not be read, so what the floor costs is unknown — not nothing.');
  }
  if (!takings) {
    return withheld('takings_unread',
      'Your payments could not be read, so there is nothing to state the wage bill as a share of. This is not a week in which the gym took nothing.');
  }

  // ── the rota side ───────────────────────────────────────────────────────
  if (cost.mixedCurrency) {
    return withheld('rota_mixed',
      `${pricedOf(cost)} on this rota are costed, and they are not all in one currency. ${MIXED_CURRENCY_NOTE}`);
  }
  if (cost.cents == null) {
    return withheld('no_rota_cost', cost.unpriced > 0
      ? `Nothing on this week’s rota carries a rate, so what it costs is unknown. ${cost.unpriced} shift${cost.unpriced === 1 ? '' : 's'} ${cost.unpriced === 1 ? 'is' : 'are'} rostered and unpriced — which is not the same as rostered and free.`
      : 'There is nothing live on this week’s rota to cost.');
  }
  const costCur = code(cost.currency);
  if (!costCur) {
    return withheld('rota_unstated',
      'This week’s shifts carry rates and no currency, so the wage bill is a number that cannot be written down. It is not a figure in the gym’s own money.');
  }

  // ── the till side ───────────────────────────────────────────────────────
  if (takings.cents == null) {
    return withheld('takings_unread',
      'Your payments could not be read, so there is nothing to state the wage bill as a share of. This is not a week in which the gym took nothing.');
  }
  const tillCur = code(takings.currency);
  if (!tillCur) {
    return withheld('takings_mixed',
      `The payments behind this window are not all in one currency, so there is no one total for the wage bill to be a share of. ${MIXED_CURRENCY_NOTE}`);
  }
  if (takings.cents <= 0) {
    return withheld('no_takings', takings.cents === 0
      ? 'Nothing was recorded coming in over this window, so there is no figure for the wage bill to be a share of. That is not the same as the gym taking nothing — it is the same as nobody having entered a payment.'
      : 'What was recorded over this window nets below zero once reversals are taken off, so there is no takings figure for the wage bill to be a share of.');
  }

  // ── and the one place the two meet ──────────────────────────────────────
  if (costCur !== tillCur) {
    return withheld('currency_mismatch',
      `This week’s shifts are priced in ${costCur} and the money recorded coming in is ${tillCur}. Repple holds no exchange rate, and a percentage of one currency over another is not a smaller or larger share — it is not a share at all.`);
  }

  const atLeast = cost.unpriced > 0;
  return {
    // Minor units over minor units in one currency. No scale factor is applied
    // to either side and none is needed — see the header.
    share: cost.cents / takings.cents,
    gap: 'ok',
    atLeast,
    currency: costCur,
    note: atLeast
      ? `A floor, not the figure: ${pricedOf(cost)} on this rota carry a rate. The ${cost.unpriced} without one cost an unknown amount, so the real share is this or higher.`
      : null,
  };
}
