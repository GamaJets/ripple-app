// Payment terms, as a thing a coach picks rather than a date they count out.
//
// ── What the invoice sheet offered, and what it did not ───────────────────
//
// The due-date row on app/(trainer)/invoices.tsx has always had four shortcuts.
// They were an inline array of `[label, days]` pairs — 'On the day', 'In a
// week', 'In two weeks', 'In a month' — each resolved with `plusDays(today, n)`
// and nothing else. Three things were wrong with that and none of them is
// cosmetic:
//
//   · A TERM IS NOT A DURATION IN WORDS. 'In a month' computed thirty days.
//     Every trade that invoices calls that thirty days, writes it on the
//     document as thirty days, and argues about it in those words; a coach
//     telling a client "a month" while the document says the 13th of October is
//     two different statements of the same thing, and only one of them is on
//     paper. The chips now say the number the document will be read by.
//   · NOTHING SAID WHAT THE DATE MEANT. A coach tapping a chip saw a date
//     appear in a box. Whether that date did anything — whether the app would
//     chase it, mark it late, tell anybody — was not stated anywhere on the
//     sheet, and the answer is surprising in both directions: it is the whole
//     of what makes the invoice fall due, AND the app will never tell the
//     client about it.
//   · A DATE TYPED BY HAND WAS OPAQUE. The calendar was added for "the Friday
//     after their holiday", which is exactly the case where the coach cannot
//     tell at a glance whether they have just written twelve days or forty.
//
// ── `due_on` and `chase_from` are ONE question here, not two ──────────────
//
// `invoiceAge` in coachInvoice.ts chases against `due_on` wherever there is
// one, and falls back to `chase_from` only when there is not — part 660 refuses
// to write the second where the first exists. So a term picked on this sheet
// settles the chasing too, and the sheet can say so in one sentence instead of
// leaving the coach to discover it on a screen they have not opened yet. An
// invoice issued with a term never needs a chase date; an invoice issued
// without one needs a chase date to be on any list at all.
//
// ── WHAT IS STILL NOT DEFAULTED, AND WHY ──────────────────────────────────
//
// Nothing. No term is preselected and `PAYMENT_TERMS` has no default member.
// Thirty days is a convention in one trade in one country, and a coach settling
// weekly in cash has never agreed to it — a default here would print a deadline
// on a document under somebody's name that they did not choose. The sheet's own
// comment has said this since the field existed and it is still true; what has
// changed is that the terms on offer are now named as terms.
//
// Pure, framework-free and asserted against under plain `node`.
import { invoiceDayLabel, plusDays } from './coachInvoice';
import { daysBetweenIso } from './coachWeek';

/**
 * The terms on offer.
 *
 * A closed set, for the reason `ReceiptMethod` and `CostCategory` are closed:
 * these are the words that get printed and later compared, and four spellings
 * of "a fortnight" is not a term anybody can hold somebody to. Anything outside
 * the set is still reachable — the calendar takes any day at all — and a date
 * picked that way is described by `dueTermLine` rather than refused.
 */
export type PaymentTermId = 'on_issue' | 'net7' | 'net14' | 'net30';

export interface PaymentTerm {
  id: PaymentTermId;
  /** The term in full — what a coach would say to a client and what a screen
   *  reader announces. The number is in it deliberately: 'Due in 30 days' is
   *  the phrase the client will use back at the coach, and 'In a month' is not
   *  the same statement on the 31st of January. */
  name: string;
  /** The same term with the words that fit in a chip a quarter of a phone
   *  wide. Two fields rather than one truncated: a label clipped at two lines
   *  is a term a coach cannot read, and a `name` shortened to fit is one a
   *  screen reader announces as half a phrase. Every short form still carries
   *  the NUMBER, which is the part being agreed to. */
  label: string;
  /** How many days after the issue date. Zero is a term and not the absence of
   *  one — "payment on receipt" is a decision. */
  days: number;
  /** The plain gloss under the row, in the voice `COST_CATEGORIES` uses. */
  note: string;
}

export const PAYMENT_TERMS: ReadonlyArray<PaymentTerm> = [
  { id: 'on_issue', name: 'Due on the day you issue it', label: 'On the day', days: 0, note: 'Payment on receipt. It is due the day you issue it.' },
  { id: 'net7', name: 'Due in 7 days', label: '7 days', days: 7, note: 'A week. Common where somebody is paying session by session.' },
  { id: 'net14', name: 'Due in 14 days', label: '14 days', days: 14, note: 'A fortnight.' },
  { id: 'net30', name: 'Due in 30 days', label: '30 days', days: 30, note: 'Thirty days: what most businesses mean by "a month" on an invoice.' },
];

/** A term by id, or null for one this build does not know. Null rather than a
 *  fallback: a term that cannot be named cannot be resolved into a date either,
 *  and the wrong date on a document is worse than no date on one. */
export function paymentTerm(id: string | null | undefined): PaymentTerm | null {
  return PAYMENT_TERMS.find((t) => t.id === id) ?? null;
}

/**
 * The day a term falls due, counted from the day the invoice is issued.
 *
 * Through `plusDays`, which builds both ends out of digits and never reads a
 * bare date back through a local getter — the bug src/lib/localDate.ts exists
 * for. '' from `plusDays` (an unreadable issue date) becomes null here, so a
 * caller cannot put an empty string in the due-date box and call it a term.
 */
export function termDueOn(id: PaymentTermId, issuedOn: string): string | null {
  const term = paymentTerm(id);
  if (!term) return null;
  const day = plusDays(String(issuedOn ?? '').slice(0, 10), term.days);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Which term a date in the box amounts to, or null when it is not one of them.
 *
 * This is what lets a chip show as selected after the coach picked the same day
 * on the calendar, and — more usefully — what lets the sheet tell a coach that
 * the Friday they just tapped happens to be fourteen days, which is a term
 * their client will recognise.
 *
 * Null for a date that matches nothing, and null for an unreadable one. It is
 * deliberately NOT the nearest term: "that is nearly thirty days" is not a term
 * and an invoice is not nearly due.
 */
export function termOfDue(issuedOn: string, dueOn: string | null | undefined): PaymentTermId | null {
  const days = termDays(issuedOn, dueOn);
  if (days == null) return null;
  return PAYMENT_TERMS.find((t) => t.days === days)?.id ?? null;
}

/**
 * How many days the date in the box is after the issue date, or null when
 * either end will not read.
 *
 * Negative where the date is before the issue date. That is refused elsewhere —
 * an invoice cannot fall due before it exists — and it is returned rather than
 * swallowed so the sentence below can say which way round the mistake is.
 */
export function termDays(issuedOn: string, dueOn: string | null | undefined): number | null {
  const from = String(issuedOn ?? '').slice(0, 10);
  const to = String(dueOn ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return daysBetweenIso(from, to);
}

/**
 * What the date currently in the box means, in one sentence.
 *
 * Every branch is a true sentence about a document that has not been issued
 * yet, and the two that matter most are the ends:
 *
 *   · NO DATE is not "not due". It is a document that states no term, that
 *     falls due never, and that lands on the undated list where it sits until
 *     the coach sets a private day to chase it from. `invoiceAge` says the same
 *     thing after the fact; this says it before, which is the only moment the
 *     coach can still change it.
 *   · A DATE BEFORE THE ISSUE DAY is named as such rather than reported as a
 *     negative term. `invoiceDraftBlocker` refuses it, and a blocker the coach
 *     can see coming is one they do not press the button into.
 */
export function dueTermLine(issuedOn: string, dueOn: string | null | undefined): string {
  const to = String(dueOn ?? '').trim();
  if (!to) {
    return 'No due date. The document will state none, nothing on it ever falls due, and it goes on your undated list until you set a private day to start chasing it from.';
  }
  const days = termDays(issuedOn, to);
  if (days == null) {
    return 'That day could not be read as a date, so no term can be worked out from it.';
  }
  if (days < 0) {
    const n = -days;
    return `That is ${n} ${n === 1 ? 'day' : 'days'} BEFORE the day you are issuing this, so it cannot be a due date. An invoice does not fall due before it exists.`;
  }
  if (days === 0) return `Due on the day you issue it: payment on receipt, ${invoiceDayLabel(to)}.`;
  return `Due in ${days} ${days === 1 ? 'day' : 'days'}, on ${invoiceDayLabel(to)}.`;
}

/**
 * That the term is what starts the chasing, and that nothing else does.
 *
 * On the sheet because the coach cannot otherwise know it, and because the
 * alternative — issuing with no term and then going back to set a chase date on
 * each one by hand — is the workflow the undated list was built to rescue
 * people from. `invoiceAge` chases against `due_on` wherever there is one and
 * falls back to `chase_from` only where there is not, so this is one decision
 * made once rather than two made a week apart.
 */
export const TERM_STARTS_THE_CHASING =
  'Whichever term you pick is the day this starts counting as overdue on your own lists, and you will not need to set a separate day to chase it from. That is only for invoices you issue with no due date at all. It goes on the document as a date, not as a term.';

/**
 * That no term is chosen for the coach.
 *
 * The sheet has always said this and the wording is preserved: a suggested term
 * would be a deadline printed under somebody's name that they did not choose,
 * and thirty days is one trade's convention in one country rather than a
 * default that could be right for a coach settling weekly in cash.
 */
export const NO_TERM_IS_OFFERED =
  'None of these is picked for you and there is no suggested term. Thirty days is one trade’s convention in one country, and a coach paid weekly in cash has never agreed to it. Leave it empty and the document states no due date at all, which is a perfectly ordinary invoice.';
