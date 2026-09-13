// Breaking a coach's own book down — by month, by kind, and by the biggest
// single line in it.
//
// ── Why one module and not two ────────────────────────────────────────────
//
// app/(trainer)/costs.tsx already answers "where did it go" per category, and
// `costsByCategory` in coachCosts.ts is the fold that does it. The cash book
// next door — app/(trainer)/receipts.tsx — answers nothing at all: one total
// per currency and a flat list, although every row on it carries a method, a
// day and a client. And neither book could answer the two questions a
// self-employed person actually asks of a list of money:
//
//   · how much in September, and how much in August;
//   · what is the single biggest line in here.
//
// Writing those twice, once per screen, is how `receiptTakenRows` came to be
// hoisted out of a screen in the first place — the header of that function
// spells out what a rule kept in two places costs, and it cost a month of cash
// payments falling into the wrong month for every coach west of Greenwich. So
// the grouping lives here, once, and both books go through it.
//
// ── THE RULE THIS MODULE EXISTS UNDER ─────────────────────────────────────
//
// TWO CURRENCIES ARE NEVER ADDED AND NEVER COMPARED.
//
// Every group is a `Taken` — one pot per currency, from `sumTaken`, which is
// the one summing function in this app. A group's ORDER cannot come off a total
// across its pots either, because there is no such total; it comes off the
// largest single pot, exactly as `costsByCategory` orders categories, and the
// comment there says why.
//
// The biggest-line question has the same shape and a sharper edge: "the largest
// cost" is not a question with one answer on a book containing dirhams and
// sterling. There is no rate anywhere in this product, so `biggestLines`
// answers ONE LINE PER CURRENCY and the screen prints as many as there are. A
// coach with one currency — which is all seven live coaches — sees exactly the
// single line the backlog item asked for, and a coach with two is not told that
// their insurance was bigger than their rent because 450 happens to be a larger
// integer than 1,200.
//
// ── Dates are read as days, never parsed ──────────────────────────────────
//
// The month key is `day.slice(0, 7)` off a bare `YYYY-MM-DD` and nothing here
// calls `Date.parse`. That is not fussiness: `Date.parse('2026-09-01')` is UTC
// midnight, so for every coach in the Americas a payment received on the first
// of the month lands in the previous one — silently, because nothing counts the
// row as missing. src/lib/localDate.ts is the long version and
// `receiptTakenRows` is where this app already paid for it once.
//
// A day that is not a bare date is not swept into the current month. It is
// counted, and `MonthBook.undated` is how the screen says so.
//
// Pure, framework-free and asserted against under plain `node`.
import { sumTaken, type Taken, type TakenRow } from './coachMoney';
import { monthLabel } from './analyticsExport';

/**
 * One line of a coach's own book, whichever book it is.
 *
 * Deliberately structural rather than `CoachReceipt | CoachCost`. The two rows
 * name the same three facts with different words — `receivedOn`/`paidOn`,
 * `paidBy`/`description` — and a union here would make this module know about
 * both tables to answer a question that depends on neither.
 */
export interface BookLine {
  id: string;
  /** `YYYY-MM-DD`, the day the money moved. Never a timestamp: a cost was paid
   *  on a day, and which month it lands in is the whole question below. */
  day: string;
  /** Minor units. Null is an amount nobody stated, which is counted out rather
   *  than summed as a nought. */
  amountCents: number | null;
  currency: string | null;
  /** What the line is called on screen — the payer, or what the money went on.
   *  Carried so `biggestLines` can hand back something nameable. */
  label: string;
}

/** One slice of a book: a key, what to call it, and what it came to. */
export interface BookGroup {
  key: string;
  label: string;
  /** One pot per currency. Never one figure. */
  taken: Taken;
}

const takenOf = (lines: readonly BookLine[]): Taken =>
  sumTaken(lines.map((l): TakenRow => ({
    amount_cents: l.amountCents,
    currency: l.currency,
    // `sumTaken` does not window anything — it folds whatever it is handed —
    // so the date it is given here is never read. The grouping above has
    // already decided which rows belong together, using the string, which is
    // the only way to do it without a timezone moving the first of the month.
    created_at: l.day,
  })));

/** The biggest single pot in a group, for ordering. Never a total across pots:
 *  see the header. Zero for a group whose rows are all unpriced, which sorts it
 *  to the bottom, which is where a slice nobody can put a figure on belongs. */
const topPot = (g: BookGroup): number =>
  g.taken.pots.reduce((m, p) => Math.max(m, p.minorUnits), 0);

/**
 * A book cut into named slices — by method, by client, by anything the caller
 * can name a row with.
 *
 * Biggest slice first, then by label so the order is stable when two slices
 * have nothing comparable in them. Slices with nothing in them are ABSENT
 * rather than present at zero, for the reason `costsByCategory` gives: a
 * "Bank Transfer — 0.00" row is a statement that this coach took no transfers,
 * and what it actually means is that they have not recorded any.
 *
 * `keyOf` returning an empty string puts the row under `fallbackKey`, so a row
 * whose method or client is missing is still counted somewhere rather than
 * disappearing out of a breakdown whose total is meant to match the book's.
 */
export function groupLines(
  lines: readonly BookLine[],
  keyOf: (l: BookLine) => string,
  labelOf: (key: string) => string,
  fallbackKey = 'other',
): BookGroup[] {
  const by = new Map<string, BookLine[]>();
  for (const l of lines) {
    const key = String(keyOf(l) ?? '').trim() || fallbackKey;
    const list = by.get(key);
    if (list) list.push(l); else by.set(key, [l]);
  }
  const out: BookGroup[] = [];
  for (const [key, list] of by) out.push({ key, label: labelOf(key), taken: takenOf(list) });
  return out.sort((a, b) => (topPot(b) - topPot(a)) || a.label.localeCompare(b.label));
}

/**
 * A book by month, newest first — and how many lines could not be placed in
 * one.
 *
 * `undated` is the half of this that a naive version would not have. A row
 * whose day will not read is not in September and is not in August; sweeping it
 * into the current month would make one month's figure quietly too big, and
 * dropping it silently would make the months add up to less than the book. It
 * is counted, and the screen says so.
 */
export interface MonthBook {
  months: BookGroup[];
  /** Lines whose day is not a readable `YYYY-MM-DD`, so they are in no month. */
  undated: number;
}

export function linesByMonth(lines: readonly BookLine[]): MonthBook {
  const by = new Map<string, BookLine[]>();
  let undated = 0;
  for (const l of lines) {
    const day = String(l.day ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { undated += 1; continue; }
    // The month is the first seven characters of a string. No Date is
    // constructed, so no timezone can move the first of the month into the
    // last of the previous one.
    const key = day.slice(0, 7);
    const list = by.get(key);
    if (list) list.push(l); else by.set(key, [l]);
  }
  const months: BookGroup[] = [];
  for (const [key, list] of by) months.push({ key, label: monthLabel(key), taken: takenOf(list) });
  // Newest first, compared as strings. 'YYYY-MM' sorts chronologically as text
  // for every year this app will see, which is the point of the format.
  months.sort((a, b) => b.key.localeCompare(a.key));
  return { months, undated };
}

/** The largest single line in one currency, and what it was. */
export interface BiggestLine {
  currency: string;
  minorUnits: number;
  line: BookLine;
}

/**
 * The biggest single line, one per currency.
 *
 * ONE PER CURRENCY and not one overall, because "the largest" across two
 * currencies is a comparison of integers rather than of amounts of money, and
 * no rate exists anywhere in this product to make it anything else. A coach
 * with one currency gets exactly one row, which is the single biggest line the
 * backlog item asked for.
 *
 * Lines with no amount or no currency are counted in `skipped` rather than
 * ranked. An amount with no unit on it is not an amount of money and cannot be
 * the biggest anything; saying how many were left out is what keeps the answer
 * from being read as "and there is nothing larger than this".
 *
 * Ties go to the LATER day, then to the higher id. Deterministic on purpose: a
 * screen that redraws must not swap which of two equal rent payments it calls
 * the biggest, and the later one is the one a coach is thinking of.
 */
export interface BiggestLines {
  top: BiggestLine[];
  skipped: number;
}

export function biggestLines(lines: readonly BookLine[]): BiggestLines {
  const by = new Map<string, BiggestLine>();
  let skipped = 0;
  for (const l of lines) {
    const amount = l.amountCents;
    if (amount == null || !Number.isFinite(amount)) { skipped += 1; continue; }
    const cur = (l.currency || '').trim().toUpperCase();
    if (!cur) { skipped += 1; continue; }
    const held = by.get(cur);
    if (!held
      || amount > held.minorUnits
      || (amount === held.minorUnits && String(l.day) > String(held.line.day))
      || (amount === held.minorUnits && String(l.day) === String(held.line.day) && String(l.id) > String(held.line.id))) {
      by.set(cur, { currency: cur, minorUnits: amount, line: l });
    }
  }
  // Biggest first is NOT available across currencies, so the order is by code.
  // It is stable, it is not a ranking, and it cannot be read as one.
  return { top: [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency)), skipped };
}

/**
 * That a month is a month and not a tax period.
 *
 * On both screens. A coach reading "September — 1,240.00" will reasonably take
 * it for a figure they can hand somebody, and it is not one: it is a total of
 * what THEY wrote down, dated by the day THEY said the money moved, in calendar
 * months that have nothing to do with their accounting year.
 */
export const MONTHS_ARE_WHAT_YOU_WROTE_DOWN =
  'These months are calendar months, counted by the day you said the money moved, over the lines you have recorded here and nothing else. They are not a return, not a period your accountant works in, and nothing has been checked against a bank.';

/**
 * That the biggest line is the biggest RECORDED line.
 *
 * The sentence that stops a useful figure becoming a wrong one. This app sees
 * only what the coach typed, so "your biggest cost" is really "the biggest one
 * you have written down" — and in the first month of using the feature those
 * are very different sentences.
 */
export const BIGGEST_IS_OF_WHAT_YOU_RECORDED =
  'This is the biggest line you have recorded, which is not necessarily the biggest one there was. Nothing reaches this app on its own.';
