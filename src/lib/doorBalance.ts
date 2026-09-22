// What a member owes, for the person standing at the desk — and everything
// that answer is not allowed to be.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// The check-in panel knows who somebody is, knows whether their membership is
// live, knows their next of kin and the note the floor was given, and could not
// say whether they are behind on a bill. `gym_invoices.status` is read by
// /accounting and /close and by nothing else in the product, so the one screen
// that is used with a person in front of it — the one where a conversation
// about a lapsed payment can actually happen, kindly, before it becomes a
// letter — was the one screen with no sight of it.
//
// ── THIS IS THE MOST DANGEROUS FIGURE IN THE CONSOLE ──────────────────────
//
// A wrong or stale number about somebody's money, shown to a member of staff
// while that person is standing at a turnstile, is worse than no number at all.
// It is read out loud. It is read out loud to somebody who cannot see the
// screen and cannot check it. So this module is written around four refusals,
// and every one of them is a state in the type rather than a comment:
//
//   1. IT NEVER SUMS TWO CURRENCIES. A member billed in two is owed two
//      amounts and no rate exists anywhere in this product to make them one —
//      see the header of src/lib/sumCurrency.ts. `sumTaken` does the
//      arithmetic, one pot per currency, so there is not a second spelling of
//      it in the codebase.
//
//   2. "OWES NOTHING" AND "COULD NOT BE READ" ARE DIFFERENT ANSWERS. An empty
//      invoice list from a refused query looks exactly like an empty invoice
//      list from a member who is up to date, and only one of those may be said
//      to a person's face. `'clear'` and `'unreadable'` are separate arms and
//      the sentences share no words.
//
//   3. IT NEVER TELLS THE DESK WHAT TO DO. There is no verdict here, no
//      'refuse', and nothing in this module is wired into `admissionCheck` in
//      src/lib/gymVisits.ts — which decides admission on the MEMBERSHIP, and
//      should. Whether a gym lets a member in while an invoice is open is the
//      gym's policy and varies by gym, by member and by day; a console that
//      quietly turned a receivable into a locked door would be making that
//      policy on their behalf, in a product they cannot configure it in.
//      `DOOR_BALANCE_IS_NOT_A_DECISION` says so on the screen.
//
//   4. A LOGIN THAT MAY NOT READ THE BILLING IS TOLD SO. `gym_invoices` has
//      exactly two read policies (part 29): the gym's owner, and the member
//      themselves. A trainer or a receptionist working the door matches
//      neither, and row-level security FILTERS rather than raising — so the
//      query returns an empty list and no error, and a naive screen would tell
//      the front desk that every member in the building is up to date. That is
//      the worst possible failure of this feature and it is the default one.
//      `'withheld'` is its own state, the caller passes the role, and the read
//      is not made at all.
//
// ── What "owes" means here, and what it does not ──────────────────────────
//
// It means: this gym has invoices to this member that are neither paid, nor
// drafts, nor written off, nor void. That is the same test /accounting's ageing
// uses, so the desk and the accountant cannot disagree about who is behind.
//
// It does NOT mean the member has not paid. Nothing tells this app when a
// member pays in cash at the desk unless somebody records it, and
// `settleInvoice` is an act a person performs — so an invoice can be open
// because the money never came, or because the money came and nobody marked it.
// The sentence says "the gym's record shows", which is the true claim, and it
// is the same discipline `AGEING_IS_YOUR_OWN_RECORD` keeps on the coach's side.
//
// Pure apart from the one read at the bottom.
import { minorMoney, sumTaken, type Pot } from './coachMoney';
import type { LoadStatus } from '../ui/loadStatus';
import { capLimit } from './rowCap';

type Queryable = { from: (table: string) => any };

/* ── which invoices count ─────────────────────────────────────────────────── */

/**
 * The statuses that are money the gym is still owed.
 *
 * Deliberately the same set /accounting's `isOutstanding` uses, and with the
 * same four exclusions:
 *
 *   · 'paid' — settled;
 *   · 'draft' — an invoice nobody sent. `owedOf` in src/lib/monthEnd.ts skips
 *     drafts entirely, currency and all, and its comment says why: "an invoice
 *     nobody sent is not owed by anybody". A member has not been asked for it
 *     and must not be told at a turnstile that they owe it;
 *   · 'void' and 'written_off' — the gym has decided not to collect. Naming
 *     those at the door would be asking a member for money the gym has already
 *     written off, which is the one mistake here that is worse than silence.
 */
export const OWED_STATUSES: readonly string[] = ['open', 'overdue'] as const;

export const isOwed = (status: string | null | undefined): boolean =>
  OWED_STATUSES.includes(String(status ?? ''));

/** The part of an invoice this answer is made of. */
export interface DoorInvoice {
  id: string;
  /** Null is money of unknown size. Never absorbed as 0 — a set containing one
   *  cannot be totalled, and `unpriced` below is what says so. */
  amountCents: number | null;
  currency: string | null;
  issuedOn: string;
  /** Null means no due date was set, which is not the same as due today and is
   *  why such an invoice can never be called late. */
  dueOn: string | null;
  status: string | null;
}

/* ── the answer ───────────────────────────────────────────────────────────── */

export type DoorBalance =
  /**
   * This login may not read the gym's billing at all.
   *
   * `gym_invoices` is the owner's and the member's own (part 29). A trainer or
   * a receptionist matches neither, and row-level security filters rather than
   * raising — so an unguarded read would hand the front desk an empty list and
   * a clean bill of health for every member in the building.
   */
  | { state: 'withheld'; why: string }
  /** The read has not come back, was refused, or came back truncated. */
  | { state: 'unreadable'; why: string }
  /** The read finished and this member has nothing outstanding. */
  | { state: 'clear' }
  /**
   * They are behind, by these amounts — one per currency, never added.
   *
   * `unpriced` and `unlabelled` are invoices this cannot put a figure on: one
   * with no amount recorded, and one with an amount and no currency. Both are
   * counted and neither is summed, so a figure printed beside them is a figure
   * about the invoices it could read and says so.
   */
  | {
    state: 'owes';
    pots: readonly Pot[];
    /** How many invoices are past a date the member was given. */
    overdue: number;
    /** How many are outstanding in total, including the unpriced ones. */
    count: number;
    unpriced: number;
    unlabelled: number;
  };

/**
 * What this gym's record says the member at the desk owes.
 *
 * `canRead` is the caller's own answer to "may this login read the billing" —
 * `me.role === 'owner'` in the console today. It is an argument rather than
 * something inferred from an empty list, because an empty list is exactly what
 * a login that may not read produces, and telling those two apart afterwards is
 * impossible.
 *
 * `today` is the GYM's calendar day. Overdue is a comparison between two bare
 * `YYYY-MM-DD` strings and nothing is parsed into a Date: an invoice due on the
 * 1st is not late on the 1st anywhere, and a device in Auckland reading a Dubai
 * gym's day through `new Date` would make it late a day early — to a member
 * standing at the counter.
 */
export function doorBalance(
  invoices: readonly DoorInvoice[] | null,
  today: string,
  status: LoadStatus,
  canRead: boolean,
): DoorBalance {
  if (!canRead) {
    return {
      state: 'withheld',
      why: 'What a member owes is part of the gym’s own billing, which this login may not read. Nothing here says they are up to date. It says nobody has asked.',
    };
  }
  if (status === 'loading') {
    return { state: 'unreadable', why: 'Still reading whether they are behind on anything.' };
  }
  if (status === 'error' || invoices === null) {
    return {
      state: 'unreadable',
      why: 'Whether they owe anything could not be read. That is a failed query and NOT a member who is up to date. Do not tell them either way.',
    };
  }
  if (status === 'partial') {
    return {
      state: 'unreadable',
      why: 'More invoices came back than could be read in one go, so what is here is not all of it and no amount may be stated.',
    };
  }

  const owed = invoices.filter((i) => isOwed(i.status));
  if (!owed.length) return { state: 'clear' };

  const taken = sumTaken(owed.map((i) => ({
    amount_cents: i.amountCents,
    currency: i.currency,
    // `sumTaken` does not read this for the pots; it is on `TakenRow` for the
    // coach's period filters, which do not apply here. The invoice's issue day
    // is passed rather than a made-up instant so nothing downstream can be
    // wrong about it either.
    created_at: i.issuedOn,
  })));

  return {
    state: 'owes',
    pots: taken.pots,
    overdue: owed.filter((i) => overdueOn(i, today)).length,
    count: owed.length,
    unpriced: taken.unpriced,
    unlabelled: taken.unlabelled,
  };
}

/**
 * Is this invoice past a date the MEMBER was given?
 *
 * The same rule `isOverdue` in src/lib/monthEnd.ts holds, written here against
 * a nullable status rather than imported, because that module's `GymInvoice`
 * types `status` as a closed union and the door reads whatever is in the
 * column. The rule itself is not restated loosely: an invoice due today is not
 * late today, and an invoice with no due date is never late, because the gym
 * never said when it wanted the money and cannot claim lateness over it.
 *
 * Both sides are bare `YYYY-MM-DD` and are compared as strings. Parsing either
 * would put the comparison in whichever calendar the device is in.
 */
export function overdueOn(inv: Pick<DoorInvoice, 'status' | 'dueOn'>, today: string): boolean {
  if (inv.status === 'overdue') return true;
  if (inv.status !== 'open') return false;
  return !!inv.dueOn && !!today && inv.dueOn < today;
}

/* ── the sentence at the desk ─────────────────────────────────────────────── */

/**
 * The line the desk reads, or null when there is nothing to say.
 *
 * Null for 'clear', deliberately, and it is the same judgement the admission
 * preview on the door already makes: "`ok` is silent: a green line against
 * every member who may come in is a line the desk stops reading, and then the
 * one that matters is invisible too."
 *
 * Every other state says something, including the two silences — because a desk
 * that is shown nothing concludes there is nothing, and on this particular fact
 * that conclusion is a statement about somebody's money.
 */
export function doorBalanceLine(b: DoorBalance): string | null {
  switch (b.state) {
    case 'clear':
      return null;
    case 'withheld':
    case 'unreadable':
      return b.why;
    case 'owes': {
      const amounts = b.pots.length
        ? b.pots.map((p) => minorMoney(p.minorUnits, p.currency) ?? `${p.minorUnits} ${p.currency}`).join(' and ')
        : null;
      const bills = `${b.count} ${b.count === 1 ? 'bill' : 'bills'}`;
      const late = b.overdue > 0
        ? ` ${b.overdue} of ${b.count} ${b.overdue === 1 ? 'is' : 'are'} past the date they were given.`
        : ` ${b.count === 1 ? 'It is not' : 'None of them is'} past the date they were given yet.`;
      const holes = gapNote(b);
      // "The gym's record shows" rather than "they owe": nothing tells this app
      // when somebody pays at the desk unless it is recorded, so an invoice can
      // be open because the money never came OR because it came and nobody
      // marked it. The desk is about to say this to their face.
      const head = amounts
        ? `The gym’s record shows ${amounts} outstanding across ${bills}.`
        : `The gym’s record shows ${bills} outstanding and no amount can be stated for ${b.count === 1 ? 'it' : 'them'}.`;
      return `${head}${late}${holes}`;
    }
  }
}

/** What the figure is missing, where it is missing something. Named rather than
 *  folded in, so nobody reads a short total as the whole of it — the rule
 *  `sumTaken` already keeps and this only says out loud. */
function gapNote(b: Extract<DoorBalance, { state: 'owes' }>): string {
  const parts: string[] = [];
  if (b.unpriced) parts.push(`${b.unpriced} ${b.unpriced === 1 ? 'carries' : 'carry'} no amount at all`);
  if (b.unlabelled) parts.push(`${b.unlabelled} ${b.unlabelled === 1 ? 'carries' : 'carry'} an amount with no currency on it`);
  if (!parts.length) return '';
  return ` Not in the figure above: ${parts.join(', and ')}, so more is outstanding than is shown.`;
}

/**
 * What this is FOR, said where the desk can read it.
 *
 * Not a footnote. A number about money beside a check-in button reads as a gate
 * unless something says it is not one, and the gym's door policy is the gym's:
 * a member who is behind may be waved through, spoken to, or sent to the
 * office, and every one of those is a decision a person makes about a person.
 * Nothing in this module reaches `admissionCheck`, and this sentence is the
 * screen's half of that.
 */
export const DOOR_BALANCE_IS_NOT_A_DECISION =
  'This is here so whoever is on the desk knows before the conversation, not so '
  + 'the door can be shut. Repple does not refuse anybody entry over a bill and '
  + 'has no setting that would: what to do about somebody who is behind is the '
  + 'gym’s call, and it is usually a quiet word rather than a turnstile.';

/** And the other half: what an open invoice is and is not evidence of. Shown
 *  beside the figure, because the desk is about to say it out loud. */
export const DOOR_BALANCE_IS_THE_RECORD =
  'These are invoices this gym has recorded as unpaid. A payment taken in cash '
  + 'at the desk and never entered looks exactly the same, so it is the record '
  + 'that is behind rather than, necessarily, the member.';

/* ── the read ─────────────────────────────────────────────────────────────── */

/**
 * One member's outstanding invoices at this gym.
 *
 * Narrow on purpose. `fetchInvoices` in src/lib/gymInvoices.ts pages the gym's
 * whole register and is right for a month-end; a front desk asking about one
 * person, potentially every thirty seconds, must not drag a year of billing
 * across a gym's network. So this filters on the member and on the two statuses
 * that mean money is still owed, which is a handful of rows.
 *
 * The error is read off the result and THROWN. supabase-js resolves on a
 * database error, so a missing check hands the desk an empty list — which on
 * this screen means "they are up to date", said to somebody's face, out of a
 * query that failed.
 *
 * Capped, and the truncation is reported as `whole: false` rather than thrown:
 * the caller turns it into 'partial', `doorBalance` turns that into
 * 'unreadable', and no amount is stated. A member with more than a thousand
 * open invoices is not a real member, and the one honest thing to do about an
 * impossible read is to decline to add it up.
 */
export async function fetchMemberDebt(
  sb: Queryable, tenantId: string, memberId: string,
): Promise<{ invoices: DoorInvoice[]; whole: boolean }> {
  const { data, error } = await sb
    .from('gym_invoices')
    .select('id, amount_cents, currency, issued_on, due_on, status')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .in('status', OWED_STATUSES as string[])
    .order('issued_on', { ascending: true })
    .order('id', { ascending: true })
    .limit(capLimit());
  if (error) throw error;
  const rows = (data as any[] | null) ?? [];
  return {
    // `capLimit()` asks for one row more than the ceiling, so a full page means
    // the set is bigger than the page. See src/lib/rowCap.ts.
    whole: rows.length < capLimit(),
    invoices: rows.map((r) => ({
      id: r.id,
      // Not `?? 0`. An invoice with no amount recorded is money of unknown
      // size, and `sumTaken` counts it as `unpriced` rather than adding a zero
      // that would make the figure look complete.
      amountCents: r.amount_cents ?? null,
      // Not defaulted either — there is no default currency in this product.
      currency: r.currency ?? null,
      issuedOn: r.issued_on,
      dueOn: r.due_on ?? null,
      status: r.status ?? null,
    })),
  };
}

/** Which of the four states a read is in, from the two things a screen holds.
 *  Written here so the door does not spell the mapping out beside the call and
 *  get 'partial' wrong — which is the one that silently states a subtotal. */
export function readStatus(
  landed: boolean, failed: boolean, whole: boolean,
): LoadStatus {
  if (failed) return 'error';
  if (!landed) return 'loading';
  // 'partial' and not 'ready', which is the whole reason this is a function:
  // src/ui/loadStatus.ts is explicit that a truncated read may be listed and
  // may NOT be totalled, and the total here is somebody's debt.
  return whole ? 'ready' : 'partial';
}
