// A money code on a row that this gym has never used.
//
// ── the column, and what it will accept ───────────────────────────────────
//
// `gym_payments.currency` is `not null` and carries NO ISO check, and
// `gym_invoices.currency` is the same. The word "not null" is doing less work
// than it looks: the empty string satisfies it, so does `pounds`, so does a
// three-letter code for a money this gym has never taken a penny in. Nothing
// between the keyboard and the ledger reads the value at all — `recordPayment`
// writes what it is handed.
//
// Everything downstream normalises (`normaliseCurrency`) and then COMPARES, so
// a ledger holding one odd row does not render an odd row. It renders as a gym
// with two currencies in it: `incomeOf` in src/lib/monthEnd.ts withholds the
// month's total, `closeBlockers` refuses the sign-off, and the sentence the
// owner reads says their payments are not all in one money — which is true, and
// which describes a gym that trades in two currencies rather than a gym with
// one mistyped row. The owner of a single-currency gym then goes looking for
// the second currency they do not have.
//
// So the mixed-currency machinery is right and is not what this file changes.
// This is the half that was missing: naming the ROW, next to where somebody can
// correct it, before the month it falls in cannot be closed.
//
// ── a warning, and deliberately not a coercion ────────────────────────────
//
// Nothing here rewrites, maps, guesses or offers a replacement code, and that
// restraint is the design rather than an omission. A stored currency is what a
// person recorded about money that actually changed hands; `EUR` in a GBP gym
// is just as likely to be a real euro walk-in as a slip, and there is no rate
// in this product that could turn one into the other if it were not. Quietly
// normalising it would make a real second currency disappear from a register
// that is reconciled against a bank statement — the same class of damage as the
// hardcoded 'AED' default this tree spent a whole wave removing, arriving from
// the opposite direction. The row is named. The person decides.
//
// ── three faults, not one, because they have three different fixes ────────
//
//   · 'unstated'   — the column holds nothing. No money can be named for it at
//                    all, and no total containing it is an amount of anything.
//   · 'not_a_code' — it holds something that is not an ISO 4217 code. `£`,
//                    `Pounds`, `GB`. The row states a currency in the sense
//                    that the column is non-empty and in no other sense.
//   · 'unseen'     — a well-formed code that appears nowhere in what this gym
//                    is established to use. The only one of the three that is
//                    a judgement rather than a fact, and the only one that can
//                    be wrong about a gym that genuinely took a euro.
//
// ── why the book can be null, and what that null means ────────────────────
//
// 'unseen' is a claim about the gym's WHOLE record, and a caller holding a
// failed or unfinished read of the price book does not have one to make. Hand
// `null` and the unseen half does not run and does not report an empty result:
// `checked` comes back false and the screen says nothing rather than telling an
// owner that every currency in their ledger is unknown to a gym whose plans
// simply had not loaded. The other two faults are facts about a row that was
// read, so they are reported either way — a blank currency column is blank
// whatever else did or did not arrive.
//
// Pure, like everything beside it: no client, no formatting, no sentence about
// a screen. `strayLines` is here because the wording is the part that must not
// be re-invented per screen, and it is the only thing in this file that knows
// there is a reader.
// `currencyText` and NOT `normaliseCurrency`, and this module is the only place
// in the tree where that is the right import.
//
// `normaliseCurrency` now REFUSES a non-code: it answers null for 'pounds' the
// same as for '', because everything else in this product compares or prints
// its result and a non-code must not survive contact with either. This module
// is the exception — it does not compare or print money, it REPORTS the column,
// and it cannot tell an owner that a row says `Pounds` if the value has already
// been turned into null on the way in. Importing the strict one collapsed
// 'unstated' and 'not_a_code' into one fault and quoted `stated: null` for a
// column that plainly states something, which is the opposite of this file's
// job. `currencyText` is the spelling half that `normaliseCurrency` is built
// on: trimmed and upper-cased, shape unchecked. `isCode` below is what asks the
// shape question here, and it is the same `/^[A-Z]{3}$/`.
import { currencyText } from './gymRecord';

/** Why one code on the rows is being named. See the header — three faults with
 *  three different fixes, never collapsed into "bad currency". */
export type StrayKind = 'unstated' | 'not_a_code' | 'unseen';

export interface Stray {
  kind: StrayKind;
  /**
   * What the rows actually hold, trimmed and NOT upper-cased, or null when they
   * hold nothing.
   *
   * Verbatim on purpose. The grouping below is done on the normalised code —
   * ` gbp ` and `GBP` are one currency and it would be absurd to report them
   * twice — but what gets PRINTED is what somebody typed, because the printed
   * string is the thing they have to recognise in a list of payments. Echoing
   * a tidied-up version of a value back at the person who has to find it is how
   * a warning becomes unactionable.
   */
  stated: string | null;
  /** How many of the rows handed in state it. */
  rows: number;
}

export interface StrayReport {
  /**
   * Whether the 'unseen' question was asked at all.
   *
   * False when the caller could not establish what the gym uses — a null book,
   * or a book with no well-formed code in it. An empty `strays` under
   * `checked: false` means NOT LOOKED, and a screen that renders it as "every
   * currency here is one you use" has made the null-is-not-zero mistake with
   * somebody's ledger.
   */
  checked: boolean;
  /** Worst first: unstated, then not a code, then unseen. */
  strays: Stray[];
  /** The well-formed codes the gym is established to use, sorted. Empty when
   *  the caller handed nothing usable, which is also when `checked` is false. */
  book: string[];
}

/** ISO 4217 is three letters and nothing else. Deliberately a SHAPE test and
 *  not a list of the world's currencies: a list goes stale, a new one would
 *  read as a fault here, and the shape is what separates `Pounds` from a code
 *  this gym has genuinely never used — which are the two different sentences
 *  this module exists to keep apart. */
function isCode(code: string | null): code is string {
  return code != null && /^[A-Z]{3}$/.test(code);
}

/**
 * The codes on some rows that this gym has no record of using.
 *
 * `rows` are the payments (or invoices — the column has the same absence of a
 * check on both) as they were read. `book` is what the gym IS established to
 * use: `tenants.currency` and the currency of every plan and pass in its price
 * book, as the caller has them. Null when that could not be established.
 *
 * The rows themselves are never treated as evidence of what a gym uses. That
 * would be circular — one mistyped row would vouch for itself, and a hundred
 * rows in the wrong money would vouch for each other, which is exactly the
 * shape of an import that went in wrong.
 */
export function strayCurrencies(
  rows: ReadonlyArray<{ currency?: string | null }>,
  book: ReadonlyArray<string | null | undefined> | null,
): StrayReport {
  const known = new Set<string>();
  for (const b of book ?? []) {
    const c = currencyText(b);
    // A gym whose own setting is not a code does not get to legitimise rows
    // holding the same non-code. It is reported against them instead, which is
    // the honest reading: something is wrong, and it is not the payments.
    if (isCode(c)) known.add(c);
  }
  // Null and empty are one answer HERE and two facts elsewhere, and the reason
  // they collapse is that neither supports the claim. A gym that has set no
  // currency and priced no plan has not established a single money, so there is
  // nothing for a code to be unknown to.
  const checked = book != null && known.size > 0;

  // Keyed on the normalised code so that ' gbp ' and 'GBP' are one entry;
  // `stated` keeps the first spelling actually seen, for the reason on the
  // field. The empty-string key is the row that states nothing — it is a member
  // of this map like any other, because "no currency" is a fault to report and
  // not a row to skip.
  const found = new Map<string, Stray>();
  for (const r of rows) {
    const c = currencyText(r.currency);
    const kind: StrayKind = c == null ? 'unstated' : !isCode(c) ? 'not_a_code' : 'unseen';
    // A well-formed code the gym uses is the ordinary case and the only one
    // with nothing to say. The `checked` guard is what stops an unread price
    // book turning every payment in the ledger into a warning.
    if (kind === 'unseen' && (!checked || known.has(c as string))) continue;
    const key = c ?? '';
    const at = found.get(key);
    if (at) { at.rows += 1; continue; }
    found.set(key, { kind, stated: c == null ? null : (r.currency ?? '').trim(), rows: 1 });
  }

  const ORDER: StrayKind[] = ['unstated', 'not_a_code', 'unseen'];
  const strays = [...found.values()].sort((a, b) =>
    ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)
    || b.rows - a.rows
    || (a.stated ?? '').localeCompare(b.stated ?? ''));

  return { checked, strays, book: [...known].sort() };
}

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * One sentence per stray, in the words of whoever has to go and look.
 *
 * `noun` is what the rows are — 'payment', 'invoice' — singular, because these
 * sentences count them. It is a parameter rather than a constant because the
 * same absent ISO check is on both columns and the reader of one has no idea
 * what the other is.
 *
 * Each sentence names the row count, the stored value and what the gym is on
 * record as using, and NONE of them says what to change it to. See the header.
 * An empty array means there is nothing to warn about — which, when `checked`
 * is false, is not the same as nothing being wrong, and is why the report
 * carries that flag for the screen to read rather than folding it in here.
 */
export function strayLines(r: StrayReport, noun: string): string[] {
  // Assembled from `book` rather than from the gym's setting alone: a gym that
  // has changed currency is on record as using both, and a warning that names
  // only the newer one accuses the older half of its own ledger.
  const uses = r.book.length ? `This gym’s records use ${r.book.join(' and ')}.` : null;
  // Joined from the parts that exist rather than interpolated with a maybe-empty
  // one. `${uses}` over a gym with no established currency leaves a double space
  // or a stranded full stop mid-sentence, which is the shape scripts/check-prose
  // .mjs exists to catch one file over.
  const sentence = (...parts: Array<string | null>) => parts.filter(Boolean).join(' ');
  return r.strays.map((x) => {
    const n = `${x.rows} ${noun}${s(x.rows)}`;
    if (x.kind === 'unstated') {
      return sentence(
        `${n} here record no currency at all.`,
        'The column accepts an empty value and these rows hold one, so there is no money to name'
        + ' them in and no total they can honestly be part of.',
      );
    }
    if (x.kind === 'not_a_code') {
      return sentence(
        `${n} here state “${x.stated}”, which is not a currency code.`,
        'Nothing reads it as money, so every figure it belongs to is withheld.',
        uses,
      );
    }
    return sentence(
      `${n} here state ${x.stated}, which appears nowhere else in this gym’s records.`,
      uses,
      `Nothing has been changed. If that is a real ${noun} in ${x.stated} it is fine where it is,`
      + ' and if it is a slip it has to be corrected on the row.',
    );
  });
}

/**
 * What the screen says when the gym's own currencies could not be established.
 *
 * Its own sentence, because "we did not look" and "we looked and found nothing"
 * are the two answers this repository keeps confusing, and because the fix for
 * this one is a reload rather than a correction to anybody's ledger. It does
 * NOT claim the rows are fine: it claims nothing about them at all.
 */
export const STRAY_UNCHECKED_NOTE =
  'The price book and the gym’s own currency did not load, so nothing here '
  + 'could be compared against the money this gym uses. No currency below has '
  + 'been checked, and none of them has been found to be right.';
