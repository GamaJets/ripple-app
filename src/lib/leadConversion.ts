// Coach · the one conversion figure this app is entitled to print, and the six
// it is not.
//
// ── Why almost every "conversion rate" here would be a lie ────────────────
//
// A coach asks one question about their marketing — how many of the people who
// asked about me became clients — and this app holds two piles of rows that
// look like they answer it. They do not, and the reasons are not subtle:
//
//   · IT CANNOT SEE THE ENQUIRY. `coach_leads` holds the people who opened a
//     join link and typed their details into web/join.html. It does not hold
//     the man who stopped the coach between sets, the DM, the phone call, the
//     friend-of-a-client. For most coaches those are the MAJORITY of enquiries.
//     A percentage whose denominator is "the ones we happened to see" is not a
//     conversion rate; it is a conversion rate for one channel, quoted as if it
//     were the business.
//
//   · IT CANNOT SEE THE NON-EVENT. `LeadRow.joined === false` means "no account
//     matched this address on this code". src/lib/leads.ts is explicit that this
//     is not "they did not join" — they may have joined on a different code,
//     typed a different address, or been added by the coach by hand. So the
//     complement of the numerator is not a count of failures, and anything that
//     treats it as one — a failure rate, a "lost" figure, a funnel drop-off —
//     is counting a gap in the join as a gap in the business.
//
//   · IT CANNOT SEE THE CLICK. Nothing records a visit to a join page. There is
//     no impression, no view, no open. Any rate whose top of funnel is "people
//     who saw it" has no top of funnel at all.
//
//   · THE TWO PILES HAVE DIFFERENT DENOMINATORS. Join codes really do count
//     clients (parts 81 and 98, and app/(trainer)/ad-spend.tsx spends against
//     them). But everyone in that count had already installed the app and made
//     an account. Putting an enquiry count underneath it makes a fraction whose
//     numerator and denominator are drawn from two different populations, which
//     is the shape of every dishonest funnel figure ever put on a slide.
//
// ── The one that survives ─────────────────────────────────────────────────
//
// Part 211's trigger — `coach_requests_mark_lead_joined`, on the function
// `lead_joined_notice()` — writes `joined_at` and `joined_via` onto the enquiry
// row when an account is created whose email address matches the enquiry's
// contact AND whose join code matches the code the enquiry arrived on. (This
// line said part 204, which is the timed-sets and plan-edits part and touches
// none of these columns; `joined_via` appears in exactly one part file and it
// is 211. Line 97 below already said 211 about the same two columns, so the
// file disagreed with itself about where its own figure comes from.) Both
// halves of
// that figure come off the SAME rows, recorded by the same mechanism, in the
// same place:
//
//     matched joins ÷ enquiries this app recorded and could check
//
// That is the figure. It is stated as "3 of 18" and never as a percentage, for
// two reasons that are each sufficient. A percentage reads as a property of the
// coach's marketing and detaches from its denominator the moment it is quoted —
// "we convert at 17%" — and the denominator is the entire content of this
// figure. And the numerator is a FLOOR: exact matches only, so a real client
// who typed a different address is missing from the top of the fraction and a
// percentage would round two different uncertainties into one confident number.
//
// ── Nothing here is stated over a read that was not whole ─────────────────
//
// `isWhole`, not "did not fail". A ratio computed over a truncated page has a
// denominator that is a prefix of the real one and a numerator that is a prefix
// of a different prefix; it is not a worse estimate, it is not an estimate. See
// src/ui/loadStatus.ts, whose header was written for exactly this.
//
// Pure and framework-free: no clock, no storage, no network.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';
import type { LeadRow } from './leads';
import { num } from './format';

/**
 * Either the figure, or the reason there is not one.
 *
 * Two shapes rather than a figure with nullable parts, because every caller
 * that could read `matched: 0` as "none of them converted" is a caller that has
 * to be prevented from existing. There is no state here in which a number can
 * be read without its denominator beside it.
 */
export type ConversionRead =
  | {
    kind: 'figure';
    /** Enquiries with an account matched on BOTH the address and the code. A
     *  floor on the real number, never the real number. */
    matched: number;
    /** Enquiries this app recorded AND was able to check. The denominator, and
     *  the only thing that makes `matched` mean anything. */
    checked: number;
  }
  | { kind: 'withheld'; why: string };

/** The section's title. It says what the figure counts, because the two words
 *  a coach would supply instead — "conversion rate" — are the two this module
 *  exists to refuse. */
export const CONVERSION_TITLE = 'Enquiries That Became Clients';

/**
 * The figure, or the reason it is not being shown.
 *
 * `checked` excludes rows whose `joined` is null. That is a build talking to a
 * database without part 211's columns, where the question was never asked of
 * any row — and counting an unasked question as a "no" would put a confident
 * zero on the screen of every coach on an older schema.
 */
export function enquiryConversion(rows: readonly LeadRow[], status: LoadStatus): ConversionRead {
  if (!isWhole(status)) return { kind: 'withheld', why: withheldFor(status) };
  if (rows.length === 0) {
    return {
      kind: 'withheld',
      why: 'Nobody has left their details through your join link yet, so there is nothing to count and nothing to count it against.',
    };
  }
  const checkable = rows.filter((r) => r.joined !== null);
  if (checkable.length === 0) {
    return {
      kind: 'withheld',
      // Not "none of them joined". The question was never put to the database.
      why: 'Your enquiries cannot be checked against your clients on this version, so this figure is not being guessed at. Your enquiries themselves are unaffected; they are listed above.',
    };
  }
  return {
    kind: 'figure',
    matched: checkable.filter((r) => r.joined === true).length,
    checked: checkable.length,
  };
}

/** Why no figure, for each read that is not whole. */
function withheldFor(status: LoadStatus): string {
  switch (status) {
    case 'loading':
      return 'Still reading your enquiries. A figure is not shown over a list that is still arriving.';
    case 'partial':
      return 'More enquiries exist than came back, so any figure here would be a fraction of an unknown fraction. Nothing is being stated over part of your list.';
    case 'error':
      return 'Your enquiries could not be read, so there is no figure. This is not a zero.';
    case 'ready':
      // Unreachable — `enquiryConversion` handles 'ready' before it asks.
      return '';
  }
}

/**
 * The figure itself, with its denominator inside the same sentence.
 *
 * Deliberately not two Texts and not a hero number with a caption. A figure
 * whose whole meaning is its denominator must not be renderable without it, and
 * the way that rule gets broken is somebody putting the numerator in a big font
 * and the denominator in a small one underneath.
 */
export function conversionFigureLine(read: ConversionRead): string {
  if (read.kind === 'withheld') return read.why;
  return `${num(read.matched)} of the ${num(read.checked)} ${read.checked === 1 ? 'enquiry' : 'enquiries'} left through your join link ${read.matched === 1 ? 'has' : 'have'} an account that matches on both the email address and the code.`;
}

/**
 * What the denominator is, said out loud, every time the figure is.
 *
 * The house rule is that a percentage over the leads the app can see is not a
 * conversion rate and the screen must say what it is counting. This is that
 * sentence, and it is not optional decoration — it is the difference between a
 * figure and a claim.
 */
export const CONVERSION_DENOMINATOR_NOTE =
  'The bottom number is every enquiry left through your join link that this app recorded and could check. It is not everybody who asked about you: somebody who stopped you on the gym floor, rang you, or sent you a message is nowhere in it.';

/**
 * What the numerator is, said out loud beside it.
 *
 * The top of this fraction is a floor and the screen has to say so, because a
 * coach reading "3" will otherwise read it as "three, and the other fifteen did
 * not". Fifteen of them are unknown, and one sentence is cheaper than the
 * conclusion a coach draws about their own marketing from a number that looks
 * like a verdict.
 */
export const CONVERSION_NUMERATOR_NOTE =
  'The top number is a floor, not a total. It counts only an exact match on both the address and the code, so anybody who joined on a different code, typed a different address, or was added by you by hand is not in it.';

/** One figure this screen will not print, and why. */
export interface WithheldFigure {
  /** What a coach would call it. */
  figure: string;
  /** What is wrong with it, in one sentence a coach can check. */
  why: string;
}

/**
 * The figures that are NOT shown, and the reason for each.
 *
 * Written down and rendered rather than left as a silence, because a coach who
 * cannot find a conversion rate assumes the app has not got round to it and
 * goes and computes one by hand off the two counts that ARE on screen. Every
 * one of these has a shape somebody would build if nobody had written down what
 * is wrong with it, and each reason is a fact about the data rather than a
 * policy — see this file's header.
 */
export const WITHHELD_CONVERSIONS: readonly WithheldFigure[] = [
  {
    figure: 'A conversion rate as a percentage',
    why: 'The top of that fraction only counts exact matches and the bottom only counts enquiries this app saw. A percentage would round two different unknowns into one confident-looking number, and it would be quoted without either of them.',
  },
  {
    figure: 'How many of everybody who enquired became clients',
    why: 'This app only sees an enquiry left through your join link. The call, the message and the conversation on the gym floor never reach it, so the number of people who asked about you is not something it knows.',
  },
  {
    figure: 'How many people saw your link and did not use it',
    why: 'Nothing here records a visit to a join page. There is no view, no click and no open anywhere in this app, so a funnel that starts at "people who saw it" has no first step.',
  },
  {
    figure: 'How many enquiries did not convert',
    why: 'An enquiry with no match is not an enquiry that came to nothing. They may have joined on another code, signed up with a different email address, or been added by you by hand, so the ones that are not matched are unknown, not lost.',
  },
  {
    figure: 'A conversion rate for this month, or this week',
    why: 'An enquiry left three days ago has not had its chance yet, but it would already be in the month you are dividing by. Cutting the bottom of the fraction at a date the top has not reached makes recent weeks look worse the more enquiries you get.',
  },
  {
    figure: 'Clients per join code, as a conversion rate',
    why: 'Your codes do count clients, on the Ad Spend screen, and that count is sound. It is not a rate: everybody in it had already installed the app and made an account, so there is no matching count of people who did not.',
  },
];
