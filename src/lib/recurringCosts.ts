// The rent, typed out again every month.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// src/lib/gymCosts.ts gave a gym somewhere to put its rent, its power, its
// cleaner and its accountant. It gave it no memory at all. Every line is typed
// from nothing — description, payee, category, currency, amount — twelve times
// a year, for the eight or ten suppliers that are the same eight or ten
// suppliers every month.
//
// The typing is the small cost. What it does to the book is the real one, and
// all three of these are already visible in this repository:
//
//   · A LINE GOES MISSING. src/lib/closeCosts.ts exists entirely because a
//     cost that was not entered before the month was closed cannot be entered
//     afterwards — `gym_refuse_write_into_closed_month` locks it, and the
//     supplier's invoice for August arrives in the first week of September,
//     which is the week the owner presses Close.
//
//   · THE PAYEE DRIFTS. "EDF Energy", "EDF" and "edf energy ltd" are one
//     supplier to the gym and three to every grouping in this product.
//     `costLineKey` folds case and spacing; it cannot fold a different name.
//
//   · THE CATEGORY DRIFTS WITH IT, so "Where it went" on /costs splits two
//     typing habits rather than the money.
//
// ── THE LINE THIS FILE MUST NOT CROSS ──────────────────────────────────────
//
// A TEMPLATE NEVER BECOMES A COST.
//
// Nothing here inserts into `gym_costs`, nothing here returns something a
// caller can write to `gym_costs` without a person looking at it, and
// supabase/parts/2730 carries no trigger and no job that would. `carryForward`
// below produces text for a FORM, and the owner still reads the amount, reads
// the date and presses Record.
//
// The reason is what a cost claims. `gym_costs` is a record of money that LEFT
// THE GYM'S ACCOUNT, /accounting hands it to an accountant on that basis, and
// every one of these is an arrangement that produced no payment in some month:
// a direct debit that bounced, a rent holiday, an insurer changed mid-term, a
// refurbishment the cleaner did not come for, a price that moved and a template
// nobody updated. A template that posted on its own would write a cost that was
// never incurred into a ledger whose only remaining job is to be true, under a
// month that will later be LOCKED, with nothing on the row saying a machine
// wrote it — because `gym_costs` has no such column, and adding one would be
// admitting the design was wrong rather than fixing it.
//
// A template that silently posts is worse than retyping. Retyping is slow and
// true. `TEMPLATES_NEVER_POST` says so on the screen, because the absence of an
// automatic posting reads as a missing feature unless somebody states it was a
// decision.
//
// ── And nothing here is added up ───────────────────────────────────────────
//
// There is no "monthly commitment" total in this file and there must never be
// one. Templates hold amounts in whatever currency each arrangement is in, some
// hold no amount at all because the bill varies, and a figure over that set
// would be a sum across currencies built partly out of blanks — which is both
// of the things src/lib/gymCosts.ts refuses at length, in one number.
//
// ── Why this is typed and not derived ──────────────────────────────────────
//
// `standingCosts` in closeCosts.ts already DERIVES standing lines from history:
// three of the last six months, including the most recent month on record. That
// is a good detector, and it is blind in exactly the places an owner is least
// sure: it knows nothing in a gym's first two months, it cannot tell that an
// arrangement ENDED until the supplier falls out of the six-month window, and a
// QUARTERLY bill is seen twice in six months and never clears the bar.
//
// So the two are paired rather than merged. Derivation answers "what does this
// gym's history look like"; a row answers "what does this gym say it pays".
// `untemplatedStanding` turns the first into an offer to create the second, and
// neither of them is ever allowed to become a cost on its own.
//
// Pure, framework-free and asserted against under plain `node`. Months are
// 'YYYY-MM' strings and days are 'YYYY-MM-DD' strings, compared and stepped as
// text and integers — never parsed through a Date, because `new Date(
// '2026-08-01')` is midnight UTC and therefore July for half the world. The
// reads and writes at the bottom take the Supabase client as an argument, as
// gymCosts.ts does, so the console and the phone can both use this.
import { isWhole, type LoadStatus } from '../ui/loadStatus';
// One reader for a typed amount and one writer back to the box, both of which
// know that the factor is 1, 100 or 1000 and never a hundred.
import { readMinorAmount, majorFromMinor } from './coachMoney';
// The SAME key the close screen matches a standing line on. Imported rather
// than reimplemented: two opinions about whether a template and a cost are "the
// same line" would show an owner a template marked recorded on one screen and
// missing on the other, over one ledger.
import { costLineKey, isMonthKey, costMonthOf, type CostLine, type StandingCost } from './closeCosts';
import {
  GYM_COST_CATEGORIES, GYM_COST_MAX_MINOR, type GymCostCategory,
} from './gymCosts';
import { assertWhole, capLimit } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

/* ── one arrangement ──────────────────────────────────────────────────────── */

/**
 * A standing arrangement the gym says it has.
 *
 * Deliberately NOT a `GymCost` with extra fields. A cost has an amount and a
 * day it went out, both required, because it is a claim that money moved. A
 * template has neither: the electricity bill varies, and "the 31st" is not a
 * day in February. Sharing a type would make every screen that handles one
 * handle the other, and the field that would quietly become required is the
 * amount — which is the field a template is most often honest about not
 * knowing.
 */
export interface CostTemplate {
  id: string;
  description: string;
  /** Who it is paid to. Null only for a row this app did not create — see the
   *  column note in part 2730. A template with no payee can never be matched
   *  against a month, and `reviewTemplates` reports that rather than guessing. */
  supplier: string | null;
  category: string;
  /** What it USUALLY is, in minor units. Null is ordinary and is not a zero:
   *  the water, the card fees and the accountant are all "this supplier, every
   *  month, a different number". */
  amountCents: number | null;
  /** The currency that amount is in, or null with it. Never the gym's by
   *  default — an insurer billing in EUR against a gym charging GBP is
   *  ordinary, and the two are never added or converted. */
  currency: string | null;
  /** 1 to 31, or null for "whenever the invoice turns up". */
  dueDay: number | null;
  /** 'YYYY-MM-DD'. When the arrangement began, as the owner stated it. */
  startsOn: string;
  /** 'YYYY-MM-DD', or null while it is still running. */
  endsOn: string | null;
  note: string | null;
  createdAt: string | null;
}

/** What somebody typed into the template form, before it is anything. */
export interface CostTemplateDraft {
  description: string;
  /** Required here even though the column allows null — see `templateBlockers`. */
  supplier: string;
  category: GymCostCategory;
  /** MAJOR units as a person types them, or blank for "it varies". */
  amountText: string;
  /** The gym's currency, needed only when an amount was typed. */
  currency: string | null;
  /** '1'…'31', or blank. Kept as text because it comes out of an input and an
   *  empty box is a real answer that `Number('')` turns into 0. */
  dueDayText: string;
  startsOn: string;
  note?: string;
}

/* ── the sentences that keep the screen honest ────────────────────────────── */

/**
 * That nothing here posts by itself. Said on the screen, not only in this file.
 *
 * An owner who sets up ten templates will reasonably assume next month's costs
 * appear on their own — every other product with this feature does that — and
 * the consequence of assuming it wrongly is a month filed with no costs in it
 * at all, past a lock they cannot reopen without a reason.
 */
export const TEMPLATES_NEVER_POST =
  'Nothing here records a cost by itself. A template fills the form in and you press Record, because Repple has no way of knowing whether the money actually went out: a direct debit can bounce, a landlord can give a rent holiday, an insurer can be changed mid-term, and a month the gym was shut is a month the cleaner did not come. A line that appeared on its own would be money this gym never paid, sitting in the book your accountant works from.';

/**
 * What a carried amount is, said beside the amount box.
 *
 * The specific danger of pre-filling: a figure that was typed by a person nine
 * months ago looks exactly like a figure that was typed by a person this
 * morning, and the rent has gone up since. This is the sentence that makes an
 * owner look at the number rather than at the button.
 */
export const CARRIED_IS_NOT_INCURRED =
  'The amount came from the template, not from a bill. Check it against what you were actually charged before you record it. A figure carried forward is last time’s figure, and rents, premiums and licence fees all move.';

/**
 * Why the form makes the payee compulsory when the column does not.
 *
 * Worth saying rather than merely enforcing: "who it was paid to" is optional
 * on the cost form one section above, so a required box here looks arbitrary
 * until somebody explains that it is the only thing that can match the two.
 */
export const TEMPLATE_NEEDS_A_PAYEE =
  'A template needs the payee, even though a one-off cost does not. It is the only thing that can tell this arrangement apart from every other cost in its category. Without it, nothing can say whether this month’s bill has been entered yet.';

/**
 * The sentence under an empty template list, which depends entirely on the read.
 *
 * A confident "this gym has no standing arrangements" over a failed read tells
 * an owner their rent template is gone, and the fix they would reach for is to
 * create it a second time.
 */
export function templatesEmptyLine(status: LoadStatus): string {
  if (status === 'error') {
    return 'The standing arrangements could not be read, so none are listed. That is not a statement that there are none, and anything already set up still stands.';
  }
  if (status === 'partial') {
    return 'There are more standing arrangements than could be read in one request, so this list is not all of them.';
  }
  if (status === 'loading') return 'Still reading.';
  return 'Nothing is set up to repeat. A gym pays most of the same suppliers every month (the landlord, the power, the cleaner, the music licence, the accountant), and setting each one up once means filling the form with one press instead of retyping it twelve times a year.';
}

/* ── what a person typed, judged ──────────────────────────────────────────── */

/**
 * Every reason this template cannot be saved, in the owner's own words.
 *
 * A list rather than the first failure, matching `gymCostBlockers`: somebody who
 * has left three boxes empty should be told all three at once rather than made
 * to press the button three times.
 */
export function templateBlockers(d: CostTemplateDraft): string[] {
  const out: string[] = [];

  if (!String(d.description ?? '').trim()) {
    out.push('Say what this is for. It becomes the description on every cost filled in from it, and an amount with nothing beside it is a line nobody can place against a bank statement in eleven months.');
  }

  // Required here and nullable in the column, and the split is the whole reason
  // this template can be checked at all. `costLineKey` returns null without a
  // payee, so a template with no supplier can never be matched against the
  // month's costs — it would sit in the list forever saying nothing, which is
  // worse than refusing to create it.
  if (!String(d.supplier ?? '').trim()) {
    out.push(TEMPLATE_NEEDS_A_PAYEE);
  }

  if (!GYM_COST_CATEGORIES.some((c) => c.id === d.category)) {
    out.push('Say what kind of cost this is. It is carried onto every line filled in from this template, and it is what stops the same insurer filing under three different headings across a year.');
  }

  // The amount is OPTIONAL and its absence is a real answer. What is refused is
  // an amount with no currency to read it in: "450" is not an amount of money
  // until somebody says of what, and the factor between the typed figure and
  // the stored integer is 1, 100 or 1000 depending entirely on the answer.
  const typed = String(d.amountText ?? '').trim();
  if (typed) {
    const cur = (d.currency || '').trim();
    if (!cur) {
      out.push('This gym has not set its currency, so a usual amount cannot be read. Leave the amount blank, or set the currency on the Gym screen. Repple is white-labelled and there is no default that is right for every gym.');
    } else {
      // The reader's own refusal, so a gym in Kuwait is told the last place must
      // be a nought and a gym in Japan is told a yen has no smaller unit.
      // `false` for chargeable, matching the cost form: this is money leaving
      // the gym's own account, not a charge Stripe has to accept.
      const read = readMinorAmount(typed, cur, false);
      if (!read.ok) out.push(read.reason);
      else if (read.minorUnits <= 0) {
        out.push('A usual amount of nothing is not an amount. Leave it blank if the bill varies; that is what blank means here.');
      } else if (read.minorUnits >= GYM_COST_MAX_MINOR) {
        out.push('That is more than Repple will record on one cost line. Check the zeros.');
      }
    }
  }

  // Blank is "whenever the invoice turns up", which is most arrangements. What
  // is refused is a number that is not a day of any month.
  const day = String(d.dueDayText ?? '').trim();
  if (day) {
    if (!/^\d{1,2}$/.test(day) || Number(day) < 1 || Number(day) > 31) {
      out.push('The day of the month has to be a number from 1 to 31, or blank if the bill does not arrive on a fixed day. A 31 in a month that has thirty days is filled in as the last day of that month, which you will see in the date box before you record anything.');
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.startsOn ?? ''))) {
    out.push('The day this arrangement started could not be read. It is what stops a template you set up in September claiming this gym has been paying the landlord since January.');
  }

  return out;
}

/* ── which day of which month ─────────────────────────────────────────────── */

/**
 * How long each month is, in the only way that does not go through a clock.
 *
 * `new Date(2026, 2, 0).getDate()` is the usual trick and it builds a Date from
 * the reader's local calendar, which this repository has a gate for — and the
 * question has no clock in it at all: how many days February 2026 has is
 * arithmetic on the year.
 */
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function daysInMonth(monthKey: string): number | null {
  if (!isMonthKey(monthKey)) return null;
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (month !== 2) return MONTH_LENGTHS[month - 1];
  // The full rule, not `% 4`. 1900 was not a leap year and 2000 was, and a
  // template recording the 29th would be filled in as 1 March in one of them.
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 29 : 28;
}

/**
 * The day inside `monthKey` this template's money usually goes out, as
 * 'YYYY-MM-DD', or null when the template does not say.
 *
 * A 31 in a thirty-day month is walked back to the 30th rather than refused or
 * rolled into the next month. Rolling would file a cost in a month the owner is
 * not looking at; refusing would make them state a day that is not their day.
 * Walking it back is visible: this string lands in a date box the owner reads
 * before pressing Record, which is the only reason it is allowed to be a guess.
 *
 * Null rather than the first of the month when `dueDay` is unset. The 1st is a
 * real answer somebody might have meant, and offering it as though the template
 * had said so is how a date nobody chose ends up on a permanent row.
 */
export function suggestedDay(t: CostTemplate, monthKey: string): string | null {
  const len = daysInMonth(monthKey);
  if (len == null || t.dueDay == null) return null;
  if (!Number.isInteger(t.dueDay) || t.dueDay < 1 || t.dueDay > 31) return null;
  const day = Math.min(t.dueDay, len);
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/* ── where a template stands in a month ───────────────────────────────────── */

/**
 * What this arrangement's position is in the month being looked at.
 *
 * Six answers, and 'unknown' is the one that matters most. A template is
 * "already recorded" or "still due" only on the strength of a WHOLE read of
 * that month's costs: over a truncated one, every line past the cap looks
 * missing, and a screen that then said "the landlord is not in August" would be
 * making a false accusation from its own paging.
 */
export type TemplateStanding =
  /** The arrangement had not started by this month. */
  | 'not-yet'
  /** It ended before this month. */
  | 'ended'
  /** Running, and a cost matching it is already in the month. */
  | 'recorded'
  /** Running, and nothing matching it is in the month. */
  | 'due'
  /** Running, and it has no payee, so nothing can be matched either way. */
  | 'unmatchable'
  /** The month's costs did not come back whole, so this cannot be answered. */
  | 'unknown';

export interface TemplateReview {
  template: CostTemplate;
  standing: TemplateStanding;
  /** How many costs in the month matched it. 0 for every standing but
   *  'recorded'. More than one is not an error — a gym can pay a supplier
   *  twice in a month — and the screen says the count rather than assuming. */
  matched: number;
}

/**
 * Whether the arrangement was running at any point in `monthKey`.
 *
 * Month keys compared as text, with `startsOn`/`endsOn` sliced to their first
 * seven characters. Both are DATE columns; `new Date('2026-08-01')` is midnight
 * UTC and therefore July west of Greenwich, so a lease that began on the first
 * of the month would be judged not to have begun for half the world.
 *
 * Inclusive at both ends: a template that ended on 12 August was running in
 * August, and the August cost for it is real.
 */
function runsIn(t: CostTemplate, monthKey: string): 'not-yet' | 'ended' | 'running' {
  const start = costMonthOf(t.startsOn);
  // A start date this app cannot read is not evidence that the arrangement had
  // not begun. Treated as running, so the template is still offered — the worst
  // case is an offer the owner ignores, and the alternative is a rent template
  // that silently stops appearing.
  if (start && start > monthKey) return 'not-yet';
  const end = costMonthOf(t.endsOn);
  if (end && end < monthKey) return 'ended';
  return 'running';
}

/**
 * Every template, placed against the month's own costs.
 *
 * `monthRows` is the costs dated inside `monthKey` and `monthStatus` is how
 * that read came back. The status is taken rather than inferred from the rows
 * being empty, because an empty array is the same shape whether the gym
 * recorded nothing or the query was refused — and those two produce opposite
 * advice.
 *
 * A line counts as recorded if ANY cost matches it. The question is whether
 * somebody has entered this month's bill, not whether the amount agrees; an
 * amount check would be this module deciding that a rent rise is a mistake.
 */
export function reviewTemplates(
  templates: readonly CostTemplate[],
  monthRows: readonly CostLine[],
  monthKey: string,
  monthStatus: LoadStatus,
): TemplateReview[] {
  const whole = isWhole(monthStatus);
  const counted = new Map<string, number>();
  if (whole) {
    for (const row of monthRows) {
      // Only rows actually dated inside the month. A caller that passed a wider
      // window would otherwise have July's rent mark August as recorded, and
      // the owner would close a month with no rent in it.
      if (costMonthOf(row.paidOn) !== monthKey) continue;
      const key = costLineKey(row);
      if (key) counted.set(key, (counted.get(key) ?? 0) + 1);
    }
  }

  return templates.map((template): TemplateReview => {
    const when = runsIn(template, monthKey);
    if (when !== 'running') return { template, standing: when, matched: 0 };
    const key = costLineKey(template);
    if (!key) return { template, standing: 'unmatchable', matched: 0 };
    if (!whole) return { template, standing: 'unknown', matched: 0 };
    const matched = counted.get(key) ?? 0;
    return { template, standing: matched > 0 ? 'recorded' : 'due', matched };
  });
}

/**
 * The sentence beside a template in the list.
 *
 * One wording in one place, and six of them rather than a truthy/falsy pair,
 * because the difference between "you have not entered this yet" and "nobody
 * can tell whether you have" is the difference between acting and being misled.
 */
export function standingNote(r: TemplateReview, monthLabel: string): string {
  switch (r.standing) {
    case 'not-yet':
      return `This arrangement starts after ${monthLabel}, so it is not offered here.`;
    case 'ended':
      return `This arrangement ended before ${monthLabel}. It is kept so the months it did run in still make sense.`;
    case 'recorded':
      return r.matched === 1
        ? `One cost to this supplier is already recorded in ${monthLabel}.`
        : `${r.matched} costs to this supplier are already recorded in ${monthLabel}.`;
    case 'due':
      return `Nothing to this supplier is recorded in ${monthLabel} yet.`;
    case 'unmatchable':
      return 'This template has no payee on it, so nothing can say whether the month’s bill has been entered. Add the payee and it can be checked.';
    case 'unknown':
    default:
      return `The costs in ${monthLabel} did not come back in full, so whether this one is already entered is unknown rather than no.`;
  }
}

/* ── filling the form ─────────────────────────────────────────────────────── */

/** What a template puts in the boxes. Not a cost, and nothing writes it. */
export interface CarriedCost {
  description: string;
  supplier: string;
  category: GymCostCategory;
  /** MAJOR units as the amount box wants them, or '' where nothing is carried. */
  amountText: string;
  /** 'YYYY-MM-DD', or null where the template does not say which day — in
   *  which case the form keeps whatever date it already had rather than being
   *  given one nobody chose. */
  paidOn: string | null;
  note: string;
  /**
   * What was NOT carried, and why. Null when everything was.
   *
   * Shown beside the form rather than swallowed. The case that produces it is
   * the dangerous one: a template holding EUR 900 against a gym that records in
   * GBP. There is no rate anywhere in this product, so the amount is left blank
   * and both currencies are named — an owner who is told "EUR 900" in a GBP box
   * would record nine hundred pounds.
   */
  withheld: string | null;
}

export type Carried =
  | { ok: true; filled: CarriedCost }
  | { ok: false; why: string };

/**
 * A template, as the boxes on the cost form.
 *
 * This is the whole of "carrying a cost forward", and it deliberately stops one
 * step short of a cost: it returns strings for a form. Nothing here writes, and
 * the caller cannot turn this into a row without the owner pressing Record on
 * a form they can see every field of.
 *
 * `tenantCurrency` is the currency the cost would be RECORDED in, which is the
 * gym's and not the template's. Where they differ the amount is withheld rather
 * than converted, for the reason `sumTaken` never merges two pots: this product
 * holds no exchange rate, and a number in the wrong three letters is a
 * different amount of money.
 */
export function carryForward(
  t: CostTemplate, monthKey: string, tenantCurrency: string | null,
): Carried {
  if (!isMonthKey(monthKey)) {
    return { ok: false, why: `${monthKey} is not a month, so nothing can be filled in for it.` };
  }
  const when = runsIn(t, monthKey);
  if (when === 'not-yet') {
    return {
      ok: false,
      why: `This arrangement starts on ${t.startsOn}, which is after the month on screen. Recording it here would put a cost in a month the gym had not started paying it in.`,
    };
  }
  if (when === 'ended') {
    return {
      ok: false,
      why: `This arrangement ended on ${t.endsOn}, which is before the month on screen. If the gym did pay this supplier in this month, record it on the form above. The template is not the record.`,
    };
  }

  const gymCcy = (tenantCurrency || '').trim().toUpperCase();
  const category = GYM_COST_CATEGORIES.some((c) => c.id === t.category)
    ? (t.category as GymCostCategory)
    // A category a newer build wrote and this one does not know. Falling back to
    // 'other' rather than refusing: the description and the payee are still
    // right, and the owner re-picks one box instead of retyping five.
    : ('other' as GymCostCategory);

  let amountText = '';
  let withheld: string | null = null;
  if (t.amountCents == null || !t.currency) {
    // Not a failure. Most utility templates hold no amount on purpose, and a
    // blank box is the correct thing to hand somebody reading off a bill.
    withheld = null;
  } else if (!gymCcy) {
    withheld = 'This gym has not set a currency, so the usual amount could not be filled in. Nothing else on this template has changed.';
  } else if (t.currency.trim().toUpperCase() !== gymCcy) {
    withheld = `This template’s usual amount is in ${t.currency.trim().toUpperCase()} and costs here are recorded in ${gymCcy}. Repple holds no exchange rate and will not convert one, so the amount box has been left empty. Type what actually went out, in ${gymCcy}.`;
  } else {
    // Back through the reader that knows the factor is 1, 100 or 1000. A yen
    // template read as `cents / 100` would fill the box with a hundredth of the
    // rent, and the owner would press Record on it.
    amountText = majorFromMinor(t.amountCents, t.currency);
    if (!amountText) {
      withheld = 'The usual amount on this template could not be read back into this currency, so the amount box has been left empty rather than filled with a figure nobody can check.';
    }
  }

  return {
    ok: true,
    filled: {
      description: t.description,
      supplier: (t.supplier ?? '').trim(),
      category,
      amountText,
      paidOn: suggestedDay(t, monthKey),
      note: (t.note ?? '').trim(),
      withheld,
    },
  };
}

/* ── the history that is already a template in all but name ───────────────── */

/**
 * The standing lines this gym's own history shows that have no template yet.
 *
 * `standing` comes from `standingCosts` in closeCosts.ts — three of the last six
 * months, including the most recent month on record — and this is the join that
 * makes the detector useful rather than merely correct: a gym with eight
 * suppliers already in its ledger sets all eight up with eight presses, instead
 * of typing each one out from memory.
 *
 * Matched on `costLineKey`, the same key everything else here matches on, so a
 * line cannot be offered as new while the template list already shows it. An
 * ENDED template still counts as having one: a gym that deliberately stopped an
 * arrangement must not be offered it back every month, which is rule 2 of
 * `standingCosts` pointed at this list.
 */
export function untemplatedStanding(
  standing: readonly StandingCost[], templates: readonly CostTemplate[],
): StandingCost[] {
  const known = new Set<string>();
  for (const t of templates) {
    const key = costLineKey(t);
    if (key) known.add(key);
  }
  return standing.filter((s) => !known.has(s.key));
}

/* ── reads ────────────────────────────────────────────────────────────────── */

/**
 * Every template this gym has, newest arrangement first.
 *
 * Unbounded by the caller and capped by `capLimit`, because a gym has tens of
 * standing arrangements and not thousands — and a prefix of them presented as
 * the whole would tell an owner their landlord has no template and invite them
 * to create a second one. `assertWhole` refuses the truncated read in words.
 *
 * Ended templates are read too, rather than filtered in SQL. The screen has to
 * show that an arrangement ENDED — that is the difference between "we changed
 * insurer in June" and "somebody deleted it" — and `untemplatedStanding` needs
 * them to avoid re-offering a supplier the gym has deliberately stopped.
 */
export async function fetchCostTemplates(
  sb: Queryable, tenantId: string,
): Promise<CostTemplate[]> {
  const { data, error } = await sb
    .from('gym_cost_templates')
    .select('id, description, supplier, category, amount_cents, currency, due_day, starts_on, ends_on, note, created_at')
    .eq('tenant_id', tenantId)
    .order('starts_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(capLimit());
  if (error) throw error;

  const rows = assertWhole(data, 'this gym’s standing cost arrangements');
  return rows.map((r: any) => ({
    id: r.id,
    description: r.description ?? '',
    supplier: r.supplier ?? null,
    category: r.category ?? '',
    // Not `?? 0`. A template with no usual amount is an arrangement whose bill
    // varies, and a zero here would fill the form with a free supplier.
    amountCents: r.amount_cents ?? null,
    currency: r.currency ?? null,
    dueDay: r.due_day ?? null,
    startsOn: r.starts_on,
    endsOn: r.ends_on ?? null,
    note: r.note ?? null,
    createdAt: r.created_at ?? null,
  }));
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/** The fields a template is written with, already read out of the form. */
export interface CostTemplateWrite {
  description: string;
  supplier: string;
  category: GymCostCategory;
  /** Minor units, or null for "it varies". Read ONCE, by the caller, with the
   *  same reader `templateBlockers` used — two readers over one box is how an
   *  amount comes to be shown as one figure and stored as another. */
  amountCents: number | null;
  /** Null exactly when `amountCents` is null; part 2730 has a CHECK on it. */
  currency: string | null;
  dueDay: number | null;
  startsOn: string;
  note?: string | null;
}

/**
 * Create a template.
 *
 * `created_by` is passed rather than defaulted in the column, so a row can
 * never claim an author the caller did not name.
 */
export async function createCostTemplate(
  sb: Queryable, tenantId: string, createdBy: string | null, t: CostTemplateWrite,
): Promise<void> {
  const r = await sb.from('gym_cost_templates').insert({
    tenant_id: tenantId,
    created_by: createdBy,
    description: t.description.trim(),
    supplier: t.supplier.trim() || null,
    category: t.category,
    amount_cents: t.amountCents,
    currency: t.currency ? t.currency.trim().toUpperCase() : null,
    due_day: t.dueDay,
    starts_on: t.startsOn,
    ends_on: null,
    note: (t.note ?? '').trim() || null,
  }, { count: 'exact' });
  if (r.error) throw r.error;
  // The count, not the absence of an error. `gym_cost_templates_owner_insert`
  // is `is_owner_of(tenant_id)`, so an insert attempted by anybody else matches
  // no policy — and a screen reading `error` alone would say the arrangement
  // was saved while the table is empty.
  assertWrote('That standing arrangement', r);
}

/**
 * Change what a template says.
 *
 * Granted where `gym_costs` grants no update at all, and the difference is what
 * the two rows are. A cost is a recorded fact about money that moved on a day;
 * editing one leaves an amount and a date from two different intentions with
 * nothing saying so. A template is a standing instruction about the future, and
 * a rent that went up in April is a change to the instruction rather than a
 * restatement of anything that happened.
 *
 * `starts_on` is not touched here: the arrangement began when it began, and an
 * edit that moved it would make a template say this gym has only had a landlord
 * since the day somebody corrected a typo.
 */
export async function updateCostTemplate(
  sb: Queryable, templateId: string, t: CostTemplateWrite,
): Promise<void> {
  const r = await sb.from('gym_cost_templates').update({
    description: t.description.trim(),
    supplier: t.supplier.trim() || null,
    category: t.category,
    amount_cents: t.amountCents,
    currency: t.currency ? t.currency.trim().toUpperCase() : null,
    due_day: t.dueDay,
    note: (t.note ?? '').trim() || null,
  }, { count: 'exact' }).eq('id', templateId);
  if (r.error) throw r.error;
  assertWrote('That standing arrangement', r);
}

/**
 * Record that an arrangement stopped.
 *
 * Not a delete, and the distinction is the point. A deleted template says this
 * gym never had this supplier; an ended one says it had them until June, which
 * is what stops `untemplatedStanding` offering the cancelled insurer back every
 * month for the rest of the look-back, and what stops `reviewTemplates` calling
 * July's bill missing.
 */
export async function endCostTemplate(
  sb: Queryable, templateId: string, endsOn: string,
): Promise<void> {
  const r = await sb.from('gym_cost_templates')
    .update({ ends_on: endsOn }, { count: 'exact' })
    .eq('id', templateId);
  if (r.error) throw r.error;
  assertWrote('That standing arrangement', r);
}

/**
 * Remove a template.
 *
 * Safe in a way removing a cost is not: no money figure anywhere changes,
 * because nothing in this product has ever added a template into a total. The
 * costs already recorded from it are ordinary `gym_costs` rows and are
 * untouched — they were typed by a person and they stay.
 *
 * The COUNT is checked rather than `error` alone, for the reason
 * src/lib/wroteRows.ts gives: a delete run by somebody the policy does not
 * admit matches ZERO ROWS and returns `error: null`.
 */
export async function deleteCostTemplate(sb: Queryable, templateId: string): Promise<void> {
  const r = await sb.from('gym_cost_templates').delete({ count: 'exact' }).eq('id', templateId);
  if (r.error) throw r.error;
  assertWrote('That standing arrangement', r);
}
