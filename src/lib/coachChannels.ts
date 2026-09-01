// Every join code the coach runs, added up — and the refusal to set the two
// sides against each other until they can honestly be set against each other.
//
// src/lib/codeReturn.ts answers this ONE CODE AT A TIME, and answers it well:
// what it cost, who came in on it, what they paid, and — the part that matters
// — enoughToTell(), which declines to rank two channels until the split could
// be told from a coin toss. None of that is in question here and none of it is
// re-implemented.
//
// What was missing is the sentence a coach actually opens a money screen for:
// "my ads cost me this, and the people they brought in have paid me that." It
// is one subtraction over a set of codes, and it is the single most dangerous
// figure on the surface, because it is a DIFFERENCE and every hole in either
// side moves it in the flattering direction.
//
// ── The four holes, and why each one withholds the whole figure ───────────
//
// 1. A CODE WITH NO COST RECORDED. Nobody has typed what the Instagram
//    campaign cost. Rolling it in as zero makes the spend side short by the
//    whole of that campaign and the difference bigger by the same amount — and
//    an unmeasured campaign is precisely the one a coach is least able to
//    notice is missing, because there is nothing on the screen where it would
//    have been. `costUnknown` counts them and `spendAgainstReturn` refuses.
//
// 2. A CODE WHOSE CLIENTS' PAYMENTS COULD NOT BE TOTALLED. my_code_returns()
//    hands back a null `revenue_currency` when the purchases behind a code did
//    not agree on one. Treating that as no revenue makes the channel look like
//    a loss it may not be, which is the same error pointing the other way, and
//    a coach turns off a code that was working.
//
// 3. A CODE PAID FOR IN ONE CURRENCY WHOSE CLIENTS PAID IN ANOTHER.
//    codeReturn() already refuses this per code. It has to be refused again
//    over a set, because a set can contain the mismatch without any single row
//    looking wrong.
//
// 4. TWO CODES IN TWO CURRENCIES. Both internally consistent, neither
//    comparable with the other. Their pots are still reported — a coach who
//    runs ads in two countries is owed both figures — but there is no one
//    difference to state, and stating the bigger pot's would be a number about
//    half their advertising.
//
// The default code is not a channel and is left out of all of it. Its bucket
// holds everybody whose join no NAMED code claims — including codes since
// rotated away, and clients who typed the code off a business card. It has no
// spend by construction, so including it would put its revenue on the return
// side against nothing on the cost side and flatter every figure here. This is
// the same exclusion enoughToTell() makes, for the same reason, and `unnamed`
// reports how many rows it took out so the screen can say the list is not the
// whole roster.
//
// ── What is deliberately not here ─────────────────────────────────────────
//
// No ratio, no multiple, no "3.2× return" over a set. codeReturn() gives a
// `back` figure per code and that is the right scale for one: a coach can hold
// one campaign's spend in their head while they read it. Across a set the same
// division silently weights by budget, so one large well-measured campaign
// drowns four small ones, and the number looks like a summary of all five.
//
// No projection, no run rate, no cost per acquisition averaged across
// channels. Revenue here is money already charged, spend is money already
// spent, and neither is annualised.
import { num } from './format';
import { money } from './gymRecord';
import type { Pot } from './coachMoney';
import type { CodeReturnRow } from './codeReturn';
import type { LoadStatus } from '../ui/loadStatus';

/**
 * Every named code, added up, with each hole counted rather than closed.
 *
 * Nothing here is gated on a `LoadStatus`: this is arithmetic over whatever
 * rows it is handed, and it is the CALLER that must not print it under a read
 * that did not complete. `spendAgainstReturn` below is the gated one, because
 * that is the function that produces a claim.
 */
export interface ChannelSum {
  /** Named codes counted. */
  codes: number;
  /** Rows dropped because they are the default bucket rather than a channel. */
  unnamed: number;
  /** People credited to a named code, once each, last touch. */
  clients: number;
  /** How many of them are still on the roster. */
  stayed: number;
  /** Recorded spend, one pot per currency, never merged. */
  spent: Pot[];
  /** What the clients those codes brought have paid, one pot per currency. */
  earned: Pot[];
  /** Codes whose cost nobody has recorded. NOT codes that cost nothing. */
  costUnknown: number;
  /** Codes whose clients' payments could not be put in a single currency. */
  paidUnknown: number;
  /** Codes whose recorded spend and whose revenue are in different currencies. */
  crossCurrency: number;
}

/** Add `m` into `by`, creating the pot if this is the first of its currency. */
function pot(by: Map<string, Pot>, currency: string, minorUnits: number): void {
  const held = by.get(currency);
  if (held) { held.minorUnits += minorUnits; held.count += 1; }
  else by.set(currency, { currency, minorUnits, count: 1 });
}

/** Biggest first, then by code, so the order does not shuffle between reads. */
const ranked = (by: Map<string, Pot>): Pot[] =>
  [...by.values()].sort((a, b) => (b.minorUnits - a.minorUnits) || a.currency.localeCompare(b.currency));

export function channelSum(rows: readonly CodeReturnRow[]): ChannelSum {
  const spentBy = new Map<string, Pot>();
  const earnedBy = new Map<string, Pot>();
  let codes = 0;
  let unnamed = 0;
  let clients = 0;
  let stayed = 0;
  let costUnknown = 0;
  let paidUnknown = 0;
  let crossCurrency = 0;

  for (const r of rows) {
    if (r.isDefault) { unnamed += 1; continue; }
    codes += 1;
    clients += r.clients;
    stayed += r.activeNow;
    if (r.spend) pot(spentBy, r.spend.currency, r.spend.cents);
    else costUnknown += 1;
    if (r.revenue) pot(earnedBy, r.revenue.currency, r.revenue.cents);
    else paidUnknown += 1;
    if (r.spend && r.revenue && r.spend.currency !== r.revenue.currency) crossCurrency += 1;
  }

  return {
    codes, unnamed, clients, stayed,
    spent: ranked(spentBy),
    earned: ranked(earnedBy),
    costUnknown, paidUnknown, crossCurrency,
  };
}

/**
 * Whether what the coach's channels cost may be set against what they returned.
 *
 * `statable: false` is the expected answer and the important one. A coach who
 * has recorded one of four codes' spend is not owed a difference computed from
 * the one; they are owed being told which three are missing, so they can go and
 * fill them in and get a figure that means something.
 *
 * The order of the refusals is the order in which they mislead. An unrecorded
 * cost is first because it is both the commonest and the only one that makes
 * the coach's advertising look better than it was, which is the direction that
 * loses them money.
 */
export type Against =
  | { statable: true; currency: string; spentMinor: number; earnedMinor: number; codes: number }
  | { statable: false; why: 'unread' | 'no-channels' | 'cost-unknown' | 'paid-unknown' | 'cross' | 'two-currencies'; note: string };

export function spendAgainstReturn(status: LoadStatus, sum: ChannelSum): Against {
  // 'partial' is refused with the same words as 'error' on purpose. A truncated
  // set of codes is not a smaller set of codes, it is an unknown one, and the
  // difference between the two sides is the one figure on this screen a missing
  // row moves without leaving a gap where it was.
  if (status !== 'ready') {
    return {
      statable: false,
      why: 'unread',
      note: 'Your codes could not be read in full, so nothing here compares what they cost with what they returned.',
    };
  }
  if (sum.codes === 0) {
    return {
      statable: false,
      why: 'no-channels',
      note: 'You have no named codes yet, so there is nothing to cost. Make one per place you advertise and Repple can tell you which of them paid for itself.',
    };
  }
  if (sum.costUnknown > 0) {
    return {
      statable: false,
      why: 'cost-unknown',
      note: `${num(sum.costUnknown)} of your ${num(sum.codes)} ${sum.codes === 1 ? 'code has' : 'codes have'} no cost recorded, so no figure is stated. That is not a cost of nothing — counting it as nothing would make your advertising look cheaper than it was, which is the mistake that costs you money. Record what each one cost and this becomes a real number.`,
    };
  }
  if (sum.paidUnknown > 0) {
    return {
      statable: false,
      why: 'paid-unknown',
      note: `What the clients off ${num(sum.paidUnknown)} of your ${num(sum.codes)} ${sum.codes === 1 ? 'code has' : 'codes have'} paid could not be put into a single currency, so there is no total to set against your spend. Nothing here says those clients paid nothing.`,
    };
  }
  if (sum.crossCurrency > 0) {
    return {
      statable: false,
      why: 'cross',
      note: `${num(sum.crossCurrency)} of your ${num(sum.codes)} ${sum.codes === 1 ? 'code was' : 'codes were'} paid for in one currency and brought in clients who paid in another. Subtracting one from the other would give a number that is not an amount of anything.`,
    };
  }
  // Every code has both sides, both sides agree per code, so a second currency
  // in either pot means two codes in two currencies. Both are real and neither
  // can be added to the other.
  if (sum.spent.length > 1 || sum.earned.length > 1) {
    return {
      statable: false,
      why: 'two-currencies',
      note: 'Your codes are costed in more than one currency, so there is no single difference to state. The amounts are listed separately below and are deliberately not added together.',
    };
  }
  const spentPot = sum.spent[0];
  const earnedPot = sum.earned[0];
  // Reached only when every code carried both halves, so both pots exist and
  // hold the same currency. Written as a guard rather than asserted, because a
  // future row shape that broke that invariant would otherwise be read off an
  // undefined and printed as a figure.
  if (!spentPot || !earnedPot || spentPot.currency !== earnedPot.currency) {
    return {
      statable: false,
      why: 'cross',
      note: 'What you spent and what those clients paid are not in the same currency, so the two cannot be compared here.',
    };
  }
  return {
    statable: true,
    currency: spentPot.currency,
    spentMinor: spentPot.minorUnits,
    earnedMinor: earnedPot.minorUnits,
    codes: sum.codes,
  };
}

/**
 * The one sentence a coach reads off the two sides — or the reason there is
 * not one.
 *
 * The loss case is WORDED and never signed. `money()` would render it as a
 * minus in front of a figure, and a minus sign in a small grey line is the
 * easiest thing on a screen to miss when it is the only thing between a channel
 * that made money and one that lost it. codeReturn's `returnLine` makes the
 * same choice per code and this is its match over a set.
 *
 * Breaking even is its own arm rather than falling into "more than". A
 * difference of nothing is neither more nor less, and rounding it into either
 * is the same defect src/lib/deltaLabel.ts exists to stop.
 */
/**
 * An amount as a sentence may carry it, or null.
 *
 * `money()` refuses a missing currency and a null amount, and refuses neither
 * NaN nor Infinity — `money(NaN, 'GBP')` is the string "GBP NaN", which is a
 * broken screen wearing a currency code. Every amount here is a subtraction or
 * a sum over pots, so a non-finite one is exactly what arrives if any figure
 * upstream ever goes wrong, and it must not be the thing a coach reads about
 * their own advertising.
 */
function written(minorUnits: number, currency: string): string | null {
  if (!Number.isFinite(minorUnits)) return null;
  return money(minorUnits, currency);
}

export function againstLine(a: Against): string {
  if (!a.statable) return a.note;
  const spent = written(a.spentMinor, a.currency);
  const earned = written(a.earnedMinor, a.currency);
  // Withheld whole rather than printed around a hole: a sentence with a gap
  // where an amount goes reads as a broken screen rather than as missing data,
  // and either side alone being unwritable is enough to withhold both.
  if (!spent || !earned) return 'These amounts could not be written out, so no comparison is stated.';
  const codes = `${num(a.codes)} ${a.codes === 1 ? 'code' : 'codes'}`;
  const opening = `You have recorded ${spent} spent across ${codes}, and the clients they brought in have paid you ${earned}.`;
  const diff = a.earnedMinor - a.spentMinor;
  if (diff === 0) return `${opening} That is exactly what they cost.`;
  const gap = written(Math.abs(diff), a.currency);
  if (!gap) return opening;
  // `> 0` and `>= 0` are the same test here, because the arm above has already
  // taken every case where diff is zero. Written as `> 0` because that is what
  // the line means on its own, and recorded because scripts/mutate.mjs reports
  // the swap as a surviving mutation on every run: no input distinguishes them,
  // so it is neither a missing assertion nor dead code, and a reader should not
  // spend the same ten minutes on it twice.
  return diff > 0
    ? `${opening} That is ${gap} more than they cost.`
    : `${opening} That is ${gap} less than they cost.`;
}

/**
 * What an empty channel list means, which depends entirely on the read.
 *
 * The same rule as ledgerEmptyLine in src/lib/coachLedger.ts: no rows under a
 * failed read is not a coach whose advertising brought in nobody, and that is
 * the sentence that makes somebody stop printing a flyer that was working.
 */
export function channelEmptyLine(status: LoadStatus): string {
  if (status === 'error') return 'Nothing is shown because your codes could not be read, not because none of them worked. Anything they already brought in still stands.';
  if (status === 'partial') return 'There are more codes on record than could be read in one request, so nothing here is a count.';
  if (status === 'loading') return 'Still reading.';
  return 'You have no named codes yet. One code per place you advertise is what turns “I think Instagram works” into a figure.';
}

/**
 * How many of the people a coach has came in on a named code, said in a way
 * that cannot be read as a whole-roster figure.
 *
 * Empty under anything but a completed read. A headcount is a count, and
 * src/ui/loadStatus.ts is explicit that a count over a truncated or failed read
 * is a figure computed from an unknown fraction of the set.
 */
export function channelReachLine(status: LoadStatus, sum: ChannelSum): string {
  if (status !== 'ready') return '';
  if (sum.codes === 0) return '';
  if (sum.clients === 0) {
    return `Nobody has come in on ${sum.codes === 1 ? 'it' : 'any of them'} yet. These are the only people this list can see — anyone who found you another way is on your roster and in none of these figures.`;
  }
  const people = `${num(sum.clients)} ${sum.clients === 1 ? 'person' : 'people'}`;
  const still = sum.stayed === sum.clients
    ? `and all of them are still with you`
    : `and ${num(sum.stayed)} of them ${sum.stayed === 1 ? 'is' : 'are'} still with you`;
  return `${people} came in on a named code, ${still}. Anyone who found you another way is on your roster and in none of these figures.`;
}
