// Writing down what the gym just paid for, from the counter it was paid at.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// `gym_costs` (supabase/parts/700) is the gym's record of money that LEFT ITS
// ACCOUNT — the rent, the power, the cleaner, the engineer, the music licence,
// the stock in the fridge. src/lib/gymCosts.ts holds every rule about it and
// the console has the form. The phone had nothing, so an owner paying a
// supplier at a counter had to remember the amount, the payee and the day until
// they were next at a desk — and the line that is remembered wrong is worse
// than the line that is late, because nothing downstream can tell.
//
// The cost of forgetting one is not small either. `closeCosts.ts` exists
// because `gym_refuse_write_into_closed_month` LOCKS a month: a cost that was
// not written down before the month was filed cannot be written down at all
// until an owner reopens the month with a reason.
//
// ── THE CONSTRAINT, from part 2730 ────────────────────────────────────────
//
// A cost row is a claim that money left the account. Part 2730 argues at length
// that nothing may create one automatically — not a trigger, not a job, not a
// recurring template that posts on its own — because the direct debit fails,
// the landlord gives a rent holiday, the insurer is changed on the 3rd, and a
// row that was never incurred is then in a ledger whose only remaining job is
// to be true, under a month that will later be locked, carrying no mark to say
// a machine wrote it.
//
// A phone quick-add is the same defect in a friendlier coat. So there is no
// "add £40 cash" shortcut here, nothing is pre-filled from a guess, and the
// form asks for exactly what the console asks for: what it was for, how much,
// in what money, on what day, and under which category. `gymCostBlockers` is
// the one gate, reused rather than re-worded — a second opinion about what
// makes a cost recordable is how the two surfaces come to hold two ledgers.
//
// What this file adds to it is the two questions the console answers by being a
// console: which day to offer when the gym has its own clock, and whether the
// day chosen falls inside a month that has already been signed off.
//
// Pure: no react, no supabase, no clock beyond the `now` handed in.
import { gymCostBlockers, type GymCost, type GymCostDraft } from './gymCosts';
import { closedMonthBlocker, type MonthCloseRow } from './gymClose';
import { gymDay } from './gymZone';
import { isoDay } from './weekStart';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/* ── the sentences ────────────────────────────────────────────────────────── */

/**
 * What pressing Record does, said before it is pressed.
 *
 * The phone's version of `GYM_COSTS_ARE_YOUR_WORD`, which describes a LIST. An
 * owner at a counter is making a single claim about a single payment, and the
 * claim is the thing to name: nothing here is checked against a bank, and the
 * row will be read months later as evidence that this money went out.
 */
export const COST_IS_A_CLAIM_ABOUT_YOUR_BANK =
  'Recording this says the gym paid it — that money left the account, on the day you give, in that currency. '
  + 'Nothing checks it against a bank, a card or the supplier, and no receipt is stored behind it. Somebody '
  + 'reconciling a statement in eleven months has this line and nothing else.';

/**
 * Why there is no one-tap version of this.
 *
 * Part 2730's argument, in the words a person reading a form needs. Printed
 * under the form, because a form with six fields on a phone invites the
 * question and the answer is the whole design.
 */
export const NO_QUICK_ADD_HERE =
  'There is no quick-add and nothing here is filled in from what you usually pay. A cost row is a statement that '
  + 'money actually left, and the day it is guessed on your behalf is the day the direct debit failed and the row '
  + 'is wrong with nothing to show it.';

/** The month the day falls in has been signed off, and the database will refuse
 *  the write. Said here so the refusal arrives beside the field. */
const CLOSED_MONTH_PREFIX = 'That day is inside a month that has been closed. ';

/**
 * Whether the month is closed could not be read.
 *
 * NOT a blocker — `closedMonthBlocker` makes the same trade and says why: the
 * database refuses a genuine violation anyway, so blocking an owner over a
 * failed read would take a working feature away for nothing. It is a note,
 * because an owner whose write is then refused deserves to have been warned
 * that this was the one thing the form could not check.
 */
export const CLOSED_MONTH_UNKNOWN_NOTE =
  'Whether the month you are dating this into has already been signed off could not be read. If it has, the '
  + 'recording will be refused — nothing will be half-written, and you would then reopen the month on the console.';

/* ── the day to offer ─────────────────────────────────────────────────────── */

/**
 * The day the form opens on: today AT THE GYM, or on this phone where the gym
 * has not said where it is.
 *
 * A `gym_costs.paid_on` is a DATE and part 182's lock is keyed on it, so which
 * day it lands on decides which month the row belongs to — and for an owner
 * anywhere east or west of their own gym, the phone's "today" is the wrong one
 * for several hours a day, twice as badly on the 1st and the 31st.
 *
 * Never silently the phone's: the caller is handed `atGym` and owes the reader
 * a sentence when it is false, the same bargain src/lib/gymWhen.ts asks for.
 */
export function defaultPaidOn(
  zone: string | null | undefined,
  now: number = Date.now(),
): { day: string; atGym: boolean } {
  const at = gymDay(now, zone);
  return at ? { day: at, atGym: true } : { day: isoDay(new Date(now)), atGym: false };
}

/* ── whether it may be recorded ───────────────────────────────────────────── */

/**
 * Every reason this cost cannot be recorded, in the owner's own words.
 *
 * `gymCostBlockers` first and unedited — one gate for both surfaces, so the
 * phone cannot accept a row the console would refuse or the other way round —
 * then the one question it cannot ask, which is whether the month is locked.
 *
 * A list rather than the first failure, for the reason `gymCostBlockers` keeps
 * one: somebody who has left three fields empty should be told all three at
 * once rather than made to press the button three times.
 *
 * The closes read is only consulted when it is WHOLE. 'partial' is not an
 * answer — `fetchCloses` refuses a truncated read today, and the day that
 * changes this must not be the place that quietly accepted a prefix of a gym's
 * sign-off history as the whole of it.
 */
export function costEntryBlockers(
  draft: GymCostDraft,
  closes: { status: LoadStatus; rows: readonly MonthCloseRow[] | null },
): string[] {
  const out = gymCostBlockers(draft);
  if (!isWhole(closes.status) || !closes.rows) return out;
  // `closedMonthBlocker` takes the DAY and slices the month key off it as a
  // string. Never a parse: 'YYYY-MM-DD'.slice(0,7) is the month in every zone,
  // and `new Date(day)` is the month before it for anybody west of Greenwich.
  const locked = closedMonthBlocker(draft.paidOn, [...closes.rows]);
  if (locked) out.push(CLOSED_MONTH_PREFIX + locked);
  return out;
}

/* ── whether it actually landed ───────────────────────────────────────────── */

/**
 * The row this draft became, found in a list read back after the write — or
 * null, which means it did not land.
 *
 * ── Why a write is not believed here ──────────────────────────────────────
 *
 * `recordGymCost` inserts and checks `error`, which is the right check for the
 * network and for a constraint. It is not proof: PostgREST answers an INSERT
 * that RLS refused with a 201 and an empty body, and this app's own
 * `recordCost` on the coach side asks for the row back for exactly that reason.
 * That function belongs to another lane's file this session, so the phone's
 * proof is the read it was going to do anyway — the list under the form is
 * refreshed after every write, and the row either appears in it or it does not.
 *
 * Matched on the four fields that identify the claim rather than on an id,
 * because the insert does not hand one back. Two genuinely identical costs on
 * one day — two £40 cash purchases from the same supplier — match the same row,
 * and that is the right failure: it can only ever report a success as a success
 * one write too early, never report a refused write as a success.
 */
export function findRecordedCost(
  rows: readonly GymCost[] | null | undefined,
  want: { description: string; amountCents: number; currency: string; paidOn: string },
): GymCost | null {
  const description = want.description.trim();
  const currency = want.currency.trim().toUpperCase();
  return (rows ?? []).find((r) =>
    r.paidOn === want.paidOn
    && r.amountCents === want.amountCents
    && (r.currency ?? '').trim().toUpperCase() === currency
    && (r.description ?? '').trim() === description) ?? null;
}

/**
 * What to say after a write whose row could not be found.
 *
 * Deliberately neither "recorded" nor "not recorded". The insert may have
 * succeeded and the read after it failed, and telling an owner it did not go in
 * is how a cost gets entered twice — which nothing downstream can detect,
 * because two identical rows are what two identical purchases look like.
 */
export const COST_UNCONFIRMED_NOTE =
  'The recording was sent and no error came back, but the list could not be read afterwards to confirm the line is '
  + 'there. Check the list before entering it again — two identical rows look exactly like two identical purchases, '
  + 'and nothing can tell them apart afterwards.';
