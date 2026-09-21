// The gym's price book, against what its members are actually being charged —
// and the one question about it this database still cannot answer.
//
// ── What a price book drifts away from ────────────────────────────────────
//
// A gym sets a price. Then it sells a joiner three months at the old rate,
// keeps a founder member on the figure they signed at in 2019, gives the six
// o'clock class a corporate rate somebody agreed on the phone, and puts the
// list price up by ten per cent. None of that is a mistake — every one of those
// is a deliberate act of running a gym. What is a mistake is nobody being able
// to SEE it: studio-web/app/money draws the price book, the memberships and the
// payments in three separate tables, and not one line anywhere puts a plan's
// list price next to what the person on that plan is billed. An owner who
// thinks they sell forty memberships at 60 and are billing 2,400 a month has no
// screen that would ever tell them otherwise.
//
// ── What "what they actually pay" is READ FROM, and what it is not ───────
//
// `gym_invoices`. It is the only per-member amount in this database tied to a
// membership: `membership_id`, `amount_cents`, `currency`, `issued_on`. The
// latest bill raised against a membership is what that member is being asked
// for, and comparing it to the plan's `price_cents` is the comparison.
//
// `gym_payments` is deliberately NOT the source, and this was the decision that
// shaped the module. A payment is what ARRIVED: a part payment, six months
// settled in one go, a joining fee, cash for somebody else's pass. Comparing
// that to a monthly list price produces a screen full of confident differences
// that are not differences, and a gym would act on them. What a member is
// CHARGED and what a member has PAID are two questions; /members already
// answers the second one, per currency, through `paidTotal`.
//
// ── The two refusals this module is built around ─────────────────────────
//
//  1. NEVER ACROSS CURRENCIES. `membership_plans.currency` and
//     `gym_invoices.currency` are independent columns, and a gym that changed
//     its base currency has both in its own books — src/lib/gymRecord.ts
//     records that as having happened live. There is no exchange rate anywhere
//     in this product and there will not be one here. Where the two sides
//     disagree the row states BOTH and subtracts neither: `otherCurrencyNote`
//     is the sentence, and `diffCents` is null.
//
//  2. A MEMBER WHOSE PRICE CANNOT BE READ IS NOT A MEMBER ON THE LIST PRICE.
//     Four separate silences — no bill raised, a bill with no amount on it, an
//     invoice read that did not come back whole, and a membership whose plan is
//     gone — each get their own state, and none of them is ever folded into
//     'on-list'. That fold is the specific way this screen would become
//     dangerous: it turns "we cannot tell" into "everything is fine", on the
//     screen an owner uses to decide whether to raise prices.
import { capLimit, assertWhole } from './rowCap';
import type { MembershipPlan, Membership } from './gymRecord';
import type { GymInvoiceRow } from './gymInvoices';
import { rowsOf, type Slice } from './memberView';

type Queryable = { from: (table: string) => any };

/* ── the read ──────────────────────────────────────────────────────────────── */

/**
 * A plan, plus the stamp supabase/parts/2880 adds.
 *
 * `priceChangedAt` is null for three different reasons and the read below says
 * which: the column is not there yet, the row predates it, or the stamp is not
 * a date. None of them is "the price has not changed".
 */
export type PricedPlan = MembershipPlan & { priceChangedAt: string | null };

/** Whether this database can date a price change at all. */
export type PriceStamps = 'recorded' | 'no-column';

export interface PriceBookRead {
  plans: PricedPlan[];
  stamps: PriceStamps;
}

const PLAN_COLUMNS = 'id, name, price_cents, currency, interval, active';

/**
 * True when this error is PostgREST saying the column is not in the table.
 *
 * Narrow on purpose. `42501` — a policy refusing the read — must NOT arrive
 * here looking like a missing column, or a gym whose RLS is misconfigured would
 * be told its schema is out of date and would go and apply a part that is
 * already applied. Undefined-column is `42703`; the message is checked as well
 * because PostgREST has more than once returned the sentence without the code.
 */
function missingStampColumn(e: any): boolean {
  if (e?.code === '42703') return true;
  const m = String(e?.message ?? '');
  return /price_changed_at/.test(m) && /does not exist|could not find/i.test(m);
}

function toPlan(r: any, stamped: boolean): PricedPlan {
  return {
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    currency: r.currency,
    interval: r.interval,
    active: r.active,
    // Absent and null are the same value here and a different FACT, which is
    // why `stamps` is carried beside the rows rather than inferred from them.
    priceChangedAt: stamped ? r.price_changed_at ?? null : null,
  };
}

/**
 * The price book, with the price-change stamp where the database has one.
 *
 * Two attempts, and the second one only for the one error that means the column
 * is not there. A console that selected the column unconditionally would be a
 * console that stops reading the price book at all until part 2880 is applied —
 * so the screen would lose the drift table, which needs nothing new, to a
 * feature that does.
 *
 * Capped through src/lib/rowCap.ts exactly as `fetchPlans` is, and for the
 * reason given there: the order is live-first then cheapest-first, so a
 * truncation would drop the DEAREST live plans, and this module's whole job is
 * comparing against them.
 */
export async function fetchPriceBook(sb: Queryable, tenantId: string): Promise<PriceBookRead> {
  const ask = (extra: string) => sb
    .from('membership_plans')
    .select(PLAN_COLUMNS + extra)
    .eq('tenant_id', tenantId)
    .order('active', { ascending: false })
    .order('price_cents', { ascending: true })
    .limit(capLimit());

  const stamped = await ask(', price_changed_at');
  if (!stamped.error) {
    return {
      plans: assertWhole<any>(stamped.data, "this gym's price book").map((r) => toPlan(r, true)),
      stamps: 'recorded',
    };
  }
  if (!missingStampColumn(stamped.error)) throw stamped.error;

  const plain = await ask('');
  if (plain.error) throw plain.error;
  return {
    plans: assertWhole<any>(plain.data, "this gym's price book").map((r) => toPlan(r, false)),
    stamps: 'no-column',
  };
}

/* ── what people actually pay ──────────────────────────────────────────────── */

/**
 * Where one membership sits against its plan's list price.
 *
 * Nine states, and six of them are silences. That ratio is the point: this
 * screen is read by somebody deciding whether to put prices up, and every
 * silence it collapses into 'on-list' is a member they will believe they are
 * charging correctly.
 */
export type PriceState =
  /** Billed the list price, in the list price's own currency. */
  | 'on-list'
  /** Billed less than the list price. A legacy rate, a discount, a founder. */
  | 'below-list'
  /** Billed more than the list price. Usually a price rise the book never got. */
  | 'above-list'
  /** The bill and the plan are in different currencies. Never subtracted. */
  | 'other-currency'
  /** No bill has been raised against this membership. Nothing is known. */
  | 'not-billed'
  /** A figure or a currency on one side cannot be read, so there is nothing
   *  to compare. Never folded into 'on-list'. */
  | 'amount-unstated'
  /** The invoices did not come back whole, so no membership can be placed. */
  | 'bills-unread'
  /** The membership carries no plan, so there is no list price for it. */
  | 'no-plan'
  /** The price book did not come back, or the plan is not in it. */
  | 'plan-unread';

/** Title case, short enough for a column. */
export const PRICE_STATE_LABEL: Record<PriceState, string> = {
  'on-list': 'On the List Price',
  'below-list': 'Under the List Price',
  'above-list': 'Over the List Price',
  'other-currency': 'Another Currency',
  'not-billed': 'Never Billed',
  'amount-unstated': 'Amount Not Stated',
  'bills-unread': 'Bills Not Read',
  'no-plan': 'No Plan Attached',
  'plan-unread': 'Plan Not Read',
};

/** Sentence case: what the state means, and what it is not. */
export const PRICE_STATE_MEANS: Record<PriceState, string> = {
  'on-list': 'The last bill raised against this membership matches the plan, to the minor unit, in the same currency.',
  'below-list': 'The last bill is less than the plan says. A legacy rate, a discount somebody agreed, or a price rise this member was never moved onto.',
  'above-list': 'The last bill is more than the plan says. Usually the price book is behind what the desk is actually charging.',
  'other-currency': 'The bill and the plan are in different currencies. This app holds no exchange rate and will not invent one, so both are shown and neither is subtracted from the other.',
  'not-billed': 'No invoice has ever been raised against this membership, so nothing in this database says what this member is charged. This is not the list price; it is silence.',
  'amount-unstated': 'One side of the comparison cannot be read: an invoice with no amount, a plan with no price, or a currency written as something that is not a three-letter code. Nothing can be compared to a blank, and a currency this app cannot name is a blank with writing on it: two rows both reading "pounds" are not thereby in the same money.',
  'bills-unread': 'The invoices could not be read, or came back as a prefix. Every membership is unplaced while that is true, because the bill that would place it may be one of the rows that did not arrive.',
  'no-plan': 'This membership carries no plan. A plan retired with memberships still running leaves them pointing at nothing, so there is no list price to hold it against.',
  'plan-unread': 'The price book could not be read, or this membership points at a plan that is not in it.',
};

/** One live membership, against the plan it was sold on. */
export interface PriceRow {
  membershipId: string;
  /** Null where the account behind the membership has been erased (part 184). */
  memberId: string | null;
  memberName: string | null;
  planName: string | null;
  listCents: number | null;
  listCurrency: string | null;
  /** What the last bill asked for. Null wherever there is no readable bill. */
  billedCents: number | null;
  /** The ISO code, trimmed and upper-cased — or null where what the column
   *  holds is not a currency code at all. Never the raw string: a caller that
   *  spelled money with it would print "POUNDS 60.00" off a row this module had
   *  already refused to compare. */
  billedCurrency: string | null;
  /** The day that bill was issued, as a bare YYYY-MM-DD off a `date` column.
   *  Compared as a string and never parsed into an instant. */
  billedOn: string | null;
  state: PriceState;
  /**
   * Billed minus list, in minor units of the one currency both sides are in.
   *
   * Null wherever there is not exactly one currency — which is every state
   * except the three that compared something. A caller cannot render this
   * without `listCurrency`, and `listCurrency` is only meaningful on those
   * three, so the pair cannot be misused.
   */
  diffCents: number | null;
}

/** A membership somebody is on NOW. Cancelled and expired are history, and a
 *  gym's old contracts would otherwise swamp the live ones. A frozen membership
 *  is paused, not gone: it still has a price, and it comes back at it. */
const LIVE = new Set(['active', 'frozen']);

/** Not a bill. A draft has been issued to nobody (src/lib/memberInvoices.ts
 *  makes the same point to the member reading it), and a void one was withdrawn.
 *  A status this build does not recognise is left IN: the row exists, somebody
 *  raised it, and dropping it would silently turn a member into 'not-billed'. */
const NOT_A_BILL = new Set(['draft', 'void']);

/**
 * ISO 4217 as written down, compared the same way on both sides. Null for
 * anything that is not three letters of a currency code — including the empty
 * string, which is not a currency and must not compare equal to another one.
 *
 * The shape is CHECKED and not merely described, because the sentence above was
 * the whole of it and the code only rejected the empty string. Neither
 * `membership_plans.currency` nor `gym_invoices.currency` is constrained to a
 * code — both are bare `text not null default 'AED'`, and only `tenants.currency`
 * carries `~ '^[A-Z]{3}$'` (part 99). So a gym whose rows were imported or typed
 * can hold "pounds", "GB" or "£" in both columns, and two identical non-codes
 * compared equal, were SUBTRACTED, and placed the member on the list price —
 * the exact fold this module exists to refuse, arrived at through the currency
 * rather than through the amount. `/^[A-Za-z]{3}$/` is the same test
 * ./coachCosts, ./coachInvoice, ./costBudgets, ./coachReceipts and ./csvImport
 * already apply to a currency somebody typed.
 */
function iso(c: string | null | undefined): string | null {
  const s = (c ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/**
 * Every live membership, against the list price of the plan it holds.
 *
 * Null — no table at all — only when the MEMBERSHIP read is not whole. With no
 * roster there is nothing to draw a row per, and a table built from whichever
 * memberships happened to arrive is a price-drift report with members missing
 * from it, which reads as a gym with less drift than it has.
 *
 * A plans or invoices read that did not land does NOT blank the table: every
 * row is present and carries the state that says which read is missing. That is
 * the difference between a screen that says nothing and a screen that says what
 * it does not know.
 */
export function priceRows(input: {
  memberships: Slice<Membership>;
  plans: Slice<PricedPlan>;
  invoices: Slice<GymInvoiceRow>;
}): PriceRow[] | null {
  const ms = rowsOf(input.memberships);
  if (ms == null) return null;

  const plans = rowsOf(input.plans);
  const byPlan = new Map((plans ?? []).map((p) => [p.id, p]));
  const bills = rowsOf(input.invoices);

  // The latest bill per membership. `issuedOn` is a bare YYYY-MM-DD off a
  // `date` column, so it is compared as a STRING — the format sorts correctly
  // as text and parsing it into an instant would move it a day for half the
  // planet. `id` breaks a tie, because a gym that raises a month's book in one
  // run gives every row the same day.
  const latest = new Map<string, GymInvoiceRow>();
  for (const b of bills ?? []) {
    if (!b.membershipId) continue;
    if (b.status && NOT_A_BILL.has(b.status)) continue;
    const held = latest.get(b.membershipId);
    if (!held
      || b.issuedOn > held.issuedOn
      || (b.issuedOn === held.issuedOn && b.id > held.id)) {
      latest.set(b.membershipId, b);
    }
  }

  const rows: PriceRow[] = [];
  for (const m of ms) {
    if (!LIVE.has(m.status)) continue;
    const plan = m.planId ? byPlan.get(m.planId) ?? null : null;
    const bill = latest.get(m.id) ?? null;

    const row: PriceRow = {
      membershipId: m.id,
      // Typed `string` while the column is nullable live — see the note on the
      // field in src/lib/gymRecord.ts.
      memberId: m.memberId || null,
      memberName: m.memberName,
      planName: plan?.name ?? m.planName,
      listCents: plan ? plan.priceCents : null,
      // The normalised code on both sides, for the reason on the field: the
      // comparison below reads these through `iso`, and handing a caller the
      // raw string would let a screen spell an amount in a currency this
      // module would not compare. Null is the honest answer where the column
      // holds something that is not a code, and ./coachMoney's `moneyIn`
      // returns null for it rather than inventing a symbol.
      listCurrency: plan ? iso(plan.currency) : null,
      billedCents: bill?.amountCents ?? null,
      billedCurrency: bill ? iso(bill.currency) : null,
      billedOn: bill?.issuedOn ?? null,
      state: 'on-list',
      diffCents: null,
    };

    row.state = placeRow(m, plan, bill, plans != null, bills != null);
    if (row.state === 'on-list' || row.state === 'below-list' || row.state === 'above-list') {
      // Both sides proved present and in one currency by `placeRow`, which is
      // the only thing that may set these three.
      row.diffCents = (bill!.amountCents as number) - (plan!.priceCents as number);
    }
    rows.push(row);
  }

  return rows.sort(
    (a, b) => (a.memberName ?? '￿').localeCompare(b.memberName ?? '￿')
      || a.membershipId.localeCompare(b.membershipId),
  );
}

/**
 * Which of the nine a row is, in the order the silences have to be checked.
 *
 * The order matters and it runs from the widest silence inwards: a plan read
 * that failed is a fact about every row, and asking "was there a bill" first
 * would report 'not-billed' for a gym whose invoices simply had not arrived.
 */
function placeRow(
  m: Membership,
  plan: PricedPlan | null,
  bill: GymInvoiceRow | null,
  plansRead: boolean,
  billsRead: boolean,
): PriceState {
  if (!plansRead) return 'plan-unread';
  if (!m.planId) return 'no-plan';
  if (!plan) return 'plan-unread';
  if (!billsRead) return 'bills-unread';
  if (!bill) return 'not-billed';

  const listCcy = iso(plan.currency);
  const billCcy = iso(bill.currency);
  if (bill.amountCents == null || !Number.isFinite(bill.amountCents)) return 'amount-unstated';
  if (plan.priceCents == null || !Number.isFinite(plan.priceCents)) return 'amount-unstated';
  if (!listCcy || !billCcy) return 'amount-unstated';
  if (listCcy !== billCcy) return 'other-currency';

  const diff = bill.amountCents - plan.priceCents;
  return diff === 0 ? 'on-list' : diff < 0 ? 'below-list' : 'above-list';
}

/**
 * The sentence for a row billed in a currency its plan is not priced in.
 *
 * Both codes, in the row's own words, and no arithmetic. Null for every other
 * state, so a caller cannot print it where it would not be true.
 */
export function otherCurrencyNote(row: PriceRow): string | null {
  if (row.state !== 'other-currency') return null;
  const billed = iso(row.billedCurrency) ?? 'a currency this app could not read';
  const list = iso(row.listCurrency) ?? 'a currency this app could not read';
  return `Billed in ${billed}; the plan is priced in ${list}. This app holds no exchange rate, so these two are not compared and the difference is not stated.`;
}

export interface PriceDrift {
  counts: Record<PriceState, number>;
  /** Live memberships whose bill was actually compared to a list price. */
  placed: number;
  /** Of those, the ones that are not on the list price. */
  offList: number;
  /** Memberships this app could not place either way. Never in `placed`. */
  unplaced: number;
}

const EVERY_STATE: PriceState[] = [
  'on-list', 'below-list', 'above-list', 'other-currency', 'not-billed',
  'amount-unstated', 'bills-unread', 'no-plan', 'plan-unread',
];

/** Count the rows by state, keeping "compared" and "could not be compared"
 *  apart at the top level — the two numbers an owner reads first. */
export function summarisePrices(rows: PriceRow[]): PriceDrift {
  const counts = Object.fromEntries(EVERY_STATE.map((s) => [s, 0])) as Record<PriceState, number>;
  for (const r of rows) counts[r.state] += 1;
  const placed = counts['on-list'] + counts['below-list'] + counts['above-list'];
  return {
    counts,
    placed,
    offList: counts['below-list'] + counts['above-list'],
    unplaced: rows.length - placed,
  };
}

/**
 * The headline, which says what was compared before it says what it found.
 *
 * "11 members are off the list price" on its own is the sentence that gets
 * quoted, and it is worth nothing without the denominator beside it: eleven out
 * of forty is a gym with a pricing problem, eleven out of twelve placed while
 * two hundred could not be read at all is a gym with a reporting problem.
 */
export function driftLine(d: PriceDrift, total: number): string {
  if (!total) return 'No live membership to hold against the price book.';
  // `total` is every live membership in the gym, so it reaches four digits at a
  // large one and this is NOT a figure that cannot pass 999 — the honest answer
  // is that there is no formatter this module may call to spell it.
  //
  // studio-web/app/members imports this file through `@lib/priceBook`, so the
  // sentence built here is rendered by Next.js. `num()` from src/lib/format
  // reaches `appLocale()`, a module-level latch seeded once, which resolves on
  // the SERVER during render and again in the BROWSER during hydration — two
  // machines with two locales, and a silent hydration error. That is the whole
  // reason studio-web/lib/num.ts duplicates the formatter rather than importing
  // it, and the console's own `num` cannot come the other way either, because
  // src/lib may not depend on studio-web. ./consoleSearch, ./interventions and
  // ./siteRollUp all stand here and say the same thing.
  //
  // numbers-ok: console-shared module — no reader whose locale could be asked.
  if (!d.placed) {
    // numbers-ok: as above, a console-shared module has no locale to spell in.
    return `None of the ${total} live ${total === 1 ? 'membership' : 'memberships'} could be held against the price book, so nothing here says anybody is on the list price.`;
  }
  const found = d.offList === 0
    ? `all ${d.placed} are on the list price`
    : `${d.offList} of ${d.placed} ${d.offList === 1 ? 'is' : 'are'} not on the list price`;
  const rest = d.unplaced
    ? ` The other ${d.unplaced} could not be placed either way and ${d.unplaced === 1 ? 'is' : 'are'} listed below as exactly that.`
    : '';
  // numbers-ok: as above, a console-shared module has no locale to spell in.
  return `Of ${total} live ${total === 1 ? 'membership' : 'memberships'}, ${found}.${rest}`;
}

/* ── a price that has not moved ────────────────────────────────────────────── */

/**
 * How long is long enough to be worth a look.
 *
 * 365 days rather than a calendar year: the question is "has this been left
 * alone", and nothing about it turns on which side of a leap day the answer
 * falls.
 */
export const A_YEAR_DAYS = 365;

/** Milliseconds in a day, for the one subtraction below. Not a date rule: both
 *  ends of it are instants off a `timestamptz`, never a bare calendar day. */
const DAY = 86_400_000;

export type PriceAgeState =
  /** Dated, and it has not moved in a year. */
  | 'stale'
  /** Dated, and it has moved inside the year. */
  | 'moved'
  /** Undated. This app cannot say, and says so. */
  | 'cannot-tell';

/** Why a plan is undated. Four causes, and not one of them is "unchanged". */
export type PriceAgeUnknown = 'no-column' | 'never-stamped' | 'unreadable' | 'bad-stamp';

export const PRICE_AGE_LABEL: Record<PriceAgeState, string> = {
  stale: 'Not Moved in a Year',
  moved: 'Moved Inside the Year',
  'cannot-tell': 'Cannot Be Dated',
};

export const WHY_PRICE_AGE_IS_UNKNOWN: Record<PriceAgeUnknown, string> = {
  'no-column':
    'This database does not record when a price changes. The plan row carries the price and the day the plan was created, and the price is written over in place, so nothing anywhere knows when it last moved. supabase/parts/2880 adds the column that answers this; until it is applied every plan reads this way, and none of these is a claim that a price is fresh.',
  'never-stamped':
    'The stamp exists and this plan has nothing in it, because the plan was on the books before the stamp was added. Undated, which is not the same as unchanged.',
  unreadable:
    'The price book could not be read, so nothing here is a statement about a price.',
  'bad-stamp':
    'This plan carries a stamp that is not a date this app can read, so it is treated as undated rather than as a year with a broken clock in it.',
};

export interface PriceAge {
  planId: string;
  planName: string;
  /** Whole days since the price last moved, or null when it cannot be dated. */
  days: number | null;
  changedAt: string | null;
  state: PriceAgeState;
  /** Set only on 'cannot-tell', and it is which of the four silences it is. */
  why: PriceAgeUnknown | null;
}

/**
 * How long each plan on sale has been at its price.
 *
 * Null when the price book itself is not whole — there is no "the prices" to
 * report on. Retired plans are left out: nothing is sold on them, and a list
 * that flagged a plan taken off the book in 2021 as needing a price review is a
 * list an owner stops reading.
 *
 * Every undated plan is 'cannot-tell'. It is never 'stale', and this is the
 * refusal the whole feature turns on: "unchanged for a year" inferred from an
 * absent record would flag every plan in every gym on the day it shipped, and
 * an owner who acts on one of those and finds the price was raised last month
 * never trusts the screen again.
 */
export function priceAges(
  plans: Slice<PricedPlan>,
  stamps: PriceStamps | null,
  now: number = Date.now(),
): PriceAge[] | null {
  const rows = rowsOf(plans);
  if (rows == null) return null;

  return rows.filter((p) => p.active).map((p) => {
    const base = { planId: p.id, planName: p.name, changedAt: p.priceChangedAt };
    const unknown = (why: PriceAgeUnknown): PriceAge =>
      ({ ...base, days: null, state: 'cannot-tell', why });

    if (stamps == null) return unknown('unreadable');
    if (stamps === 'no-column') return unknown('no-column');
    if (!p.priceChangedAt) return unknown('never-stamped');
    // A timestamptz, so this is an instant and Date.parse is the right reader.
    // A bare YYYY-MM-DD would not be — see the header of src/lib/gymInvoices.ts.
    const t = Date.parse(p.priceChangedAt);
    if (!Number.isFinite(t)) return unknown('bad-stamp');

    const days = Math.floor((now - t) / DAY);
    return {
      ...base,
      days,
      state: days >= A_YEAR_DAYS ? 'stale' : 'moved',
      why: null,
    };
  });
}

/**
 * The headline over the price-age table.
 *
 * Written so that the case where nothing can be dated does not read as a
 * finding. "0 prices have not moved in a year" is the sentence this would
 * otherwise print at every gym in the product, and it is the opposite of what
 * is true.
 */
export function priceAgeLine(ages: PriceAge[]): string {
  if (!ages.length) return 'No plan is on sale, so there is no price to date.';
  const dated = ages.filter((a) => a.why == null);
  if (!dated.length) {
    return `None of the ${ages.length} ${ages.length === 1 ? 'plan' : 'plans'} on sale can be dated, so this screen cannot say whether a price has moved. It is not saying they have all stayed still.`;
  }
  const stale = dated.filter((a) => a.state === 'stale').length;
  const rest = dated.length < ages.length
    ? ` The other ${ages.length - dated.length} cannot be dated at all.`
    : '';
  return `${stale} of the ${dated.length} datable ${dated.length === 1 ? 'price' : 'prices'} on sale ${stale === 1 ? 'has' : 'have'} not moved in a year.${rest}`;
}
