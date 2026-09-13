// What this gym says it has actually filed — and the three answers a period
// gets, none of which is "not filed".
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// /tax builds a period out of this app's own months, cuts it on the gym's
// clock, and prints the figures an owner hands to an accountant. Part 2641 gave
// the same screen the one fact on it that is not a figure — what the gym says
// it was registered as, with dates on it.
//
// Neither can say whether anything was ever DONE about the period. So an owner
// opening Q1 in September sees exactly what they saw in April, and "have we
// dealt with Q1", "when did we file it", "what was the reference" are all
// unanswerable from the one screen built for them. The answers live in an email
// folder or an accountant's portal.
//
// supabase/parts/2910 is the table. This is the rule over it.
//
// ── ABSENCE IS UNSTATED, AND NEVER "NOT FILED" ───────────────────────────
//
// This is part 2641's rule with a heavier consequence on the other side of it.
// A period no row covers is a period NOBODY HAS ANSWERED FOR — not one this gym
// failed to file for.
//
// "Nothing has been filed for Q1", printed over a quarter an accountant filed
// in a portal this product cannot see, is Repple telling a business it is in
// default when it is not. Every gym running this today is in that state for
// every period it has ever traded, because the table did not exist; an owner
// who reads that sentence rings their accountant, or files twice.
//
// So `filingsFor` returns four states and never a boolean: 'unread' above all
// of them for a refused query, then 'unstated', 'partly' and 'filed'. The test
// asserts none of them collapses into another, and in particular that nothing
// this module produces contains the words "not filed".
//
// ── Two rows about one period is ordinary, not a contradiction ───────────
//
// Part 2641 refuses overlapping statements because a period with two answers
// about its registration has no answer. Here two rows is the correct case
// twice: two KINDS (a sales return and a payroll return for one quarter), and
// an AMENDMENT — a gym that filed Q3, found an error and filed again. The house
// rule is that a correction is a second recorded fact and never an erasure, so
// both rows stand and `filingsFor` reports "filed, and filed again on the 14th"
// rather than picking one.
//
// ── Dates are bare days, compared as strings ─────────────────────────────
//
// `period_from`, `period_to` and `filed_on` are `date` columns holding
// `YYYY-MM-DD`, and bare days in that form sort lexicographically exactly as
// they sort chronologically. Nothing here parses one. `new Date('2026-04-01')`
// is midnight UTC, which is 31 March for every reader west of Greenwich — and
// every comparison in this file is a period boundary, which is the one place a
// day out is a wrong answer rather than a cosmetic one.
//
// ── And nothing here is a tax figure ─────────────────────────────────────
//
// No deadline is computed, no penalty, no liability, no "due in N days". A
// filing deadline is a function of a jurisdiction, a registration type, a
// turnover band and a calendar of public holidays, none of which this product
// holds — and a due date shown to an owner and quietly wrong by a week is worse
// than none. That is `TAX_NO_RETURN_FIGURE`'s argument in src/lib/gymTax.ts,
// applied to a date instead of an amount.
//
// Pure apart from the three calls at the bottom, which take the Supabase client
// as an argument the way src/lib/gymTaxHistory.ts does.
import { assertWrote } from './wroteRows';
import { capLimit, assertWhole } from './rowCap';
import { isoDay } from './gymTaxHistory';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

type Queryable = { from: (table: string) => any };

/* ── what was filed ───────────────────────────────────────────────────────── */

/** What a return is ABOUT. Exactly the five the CHECK in supabase/parts/2910
 *  permits. */
export type FilingKind = 'sales_tax' | 'income_tax' | 'payroll' | 'accounts' | 'other';

export const FILING_KINDS: readonly FilingKind[] =
  ['sales_tax', 'income_tax', 'payroll', 'accounts', 'other'] as const;

export const isFilingKind = (k: string | null | undefined): k is FilingKind =>
  FILING_KINDS.includes(k as FilingKind);

/**
 * The words each kind is shown under.
 *
 * Described by what the return is ABOUT and never by any country's name for it.
 * This product is white-label and sells into places whose returns share no
 * vocabulary — what one calls VAT another calls GST and a third a sales tax,
 * and "Corporation Tax" and "Companies House" are each right in exactly one
 * jurisdiction. Naming any of them is the same assumption
 * src/lib/wholeUnits.ts exists to stop being made about minor units.
 */
export const FILING_KIND_LABEL: Record<FilingKind, string> = {
  sales_tax: 'A return on what the gym sold',
  income_tax: 'A return on the business’s profits',
  payroll: 'A return about what the gym pays its people',
  accounts: 'A set of accounts filed with a registry',
  other: 'Something else the gym had to file',
};

/** One recorded filing. */
export interface TaxFiling {
  id: string;
  kind: FilingKind | null;
  /** `YYYY-MM-DD`, inclusive at both ends. */
  periodFrom: string;
  periodTo: string;
  /** The day it was filed, as stated. */
  filedOn: string;
  /** Verbatim, validated against nothing. */
  reference: string | null;
  /** Who filed it, in the gym's words — often an accountant's firm. */
  filedBy: string | null;
  note: string | null;
}

export interface FilingDraft {
  kind: FilingKind;
  periodFrom: string;
  periodTo: string;
  filedOn: string;
  reference?: string | null;
  filedBy?: string | null;
  note?: string | null;
}

export const MAX_REFERENCE_CHARS = 120;
export const MAX_FILED_BY_CHARS = 120;
export const MAX_FILING_NOTE_CHARS = 1000;

/**
 * The sentence a screen prints beside the list, every time.
 *
 * An owner looking at a period that says "nobody has recorded an answer" must
 * know, at that moment, that Repple is not watching for them — otherwise the
 * absence of a warning reads as a reassurance, which is the one thing this
 * product must never let a silence mean about tax.
 */
export const FILINGS_ARE_YOUR_OWN_RECORD =
  'Nothing tells Repple when a gym files. Every row here is one somebody typed, no reference is '
  + 'checked against anything, and no deadline, penalty or amount is worked out from any of it. A '
  + 'period with nothing recorded against it is one NOBODY HAS ANSWERED FOR — it is not a period '
  + 'this gym failed to file for, and this screen will never say that it is.';

/* ── what a period has had done about it ──────────────────────────────────── */

/** A filing covers a day when that day is inside its span. Both ends
 *  inclusive, matching the shape supabase/parts/2910 stores. */
export function covers(f: TaxFiling, day: string): boolean {
  return day >= f.periodFrom && day <= f.periodTo;
}

export type PeriodFiling =
  /**
   * The filings could not be read, or have not arrived, or came back
   * truncated. Nothing is known and nothing may be printed.
   *
   * Its own arm, and the one that matters most in this file: an unread list has
   * no rows, and no rows would otherwise read as "nothing has been filed" — the
   * exact sentence that tells a compliant business it is in default.
   */
  | { state: 'unread'; line: string }
  /** No filing of this kind covers any day of the period. NOBODY HAS ANSWERED
   *  — deliberately not "not filed". */
  | { state: 'unstated'; line: string }
  /** Some of the period is covered and some is not — a gym filing monthly that
   *  has recorded two of a quarter's three months. `from` and `to` name the
   *  first and last uncovered day, so the screen can say which part. */
  | { state: 'partly'; line: string; from: string; to: string; filings: readonly TaxFiling[] }
  /** Covered the whole way through, by one filing or by several. */
  | { state: 'filed'; line: string; filings: readonly TaxFiling[] };

/**
 * What has been filed covering this period, for one kind.
 *
 * `firstDay` and `lastDay` are the period's own bare days — out of
 * `taxPeriod()` for a quarter, or a `MonthWindow` for a month. Walked day by
 * day would be correct and wasteful; instead the covered spans are merged and
 * the first gap is found, which gives the same answer and names it.
 */
export function filingsFor(
  all: readonly TaxFiling[] | null | undefined,
  kind: FilingKind,
  firstDay: string,
  lastDay: string,
  status: LoadStatus,
  periodLabel: string,
): PeriodFiling {
  // `isWhole`, not `!== 'error'`. A truncated list is missing filings, and a
  // missing filing reads here as a period nobody answered for — which sends an
  // owner to file something they have already filed.
  if (!isWhole(status)) {
    return {
      state: 'unread',
      line: status === 'loading'
        ? 'Still reading what has been filed.'
        : status === 'partial'
          ? `More filings are on record than could be read in one request, so nothing can be said about ${periodLabel}. What is listed is real; it is not all of it.`
          : `What has been filed could not be read, so nothing is known about ${periodLabel}. That is not the same as nothing having been filed, and anything already recorded still stands.`,
    };
  }

  const mine = (all ?? [])
    .filter((f) => f.kind === kind && f.periodTo >= firstDay && f.periodFrom <= lastDay)
    // Oldest span first, so the merge below can walk them in one pass.
    .sort((a, b) => (a.periodFrom < b.periodFrom ? -1 : a.periodFrom > b.periodFrom ? 1 : a.id.localeCompare(b.id)));

  if (!mine.length) {
    return {
      state: 'unstated',
      // The words are the whole point. "Nobody has recorded" is about the
      // RECORD; "has not been filed" would be about the business.
      line: `Nobody has recorded anything filed for ${periodLabel}. That is a statement about this record and not about whether it was filed.`,
    };
  }

  // The first uncovered day, found by walking the spans in order. `reached` is
  // the last day known to be covered, held one day BEFORE the period start so
  // that a span beginning on the first day is adjacent rather than a gap.
  let gapFrom: string | null = null;
  let cursor = firstDay;
  for (const f of mine) {
    if (f.periodFrom > cursor) { gapFrom = cursor; break; }
    if (f.periodTo >= cursor) cursor = dayAfter(f.periodTo) ?? cursor;
    if (cursor > lastDay) break;
  }
  if (gapFrom == null && cursor <= lastDay) gapFrom = cursor;

  const whenLine = describeFilings(mine);
  if (gapFrom != null) {
    return {
      state: 'partly',
      from: gapFrom,
      to: lastDay,
      filings: mine,
      line: `Part of ${periodLabel} has something recorded against it and part of it does not: nothing covers ${gapFrom} to ${lastDay}. ${whenLine}`,
    };
  }
  return { state: 'filed', filings: mine, line: `${periodLabel} — ${whenLine}` };
}

/**
 * "Filed on the 3rd", or "filed on the 3rd and again on the 14th".
 *
 * An amendment is two facts about one period and both are said, in order. The
 * second is NOT described as replacing the first: the first submission really
 * was made and really was received, and a sentence implying otherwise would
 * erase the only record the gym has of having met a deadline.
 */
function describeFilings(mine: readonly TaxFiling[]): string {
  const byDay = [...mine].sort((a, b) => (a.filedOn < b.filedOn ? -1 : a.filedOn > b.filedOn ? 1 : a.id.localeCompare(b.id)));
  const first = byDay[0];
  const who = first.filedBy ? ` by ${first.filedBy}` : '';
  const ref = first.reference ? `, reference ${first.reference}` : '';
  if (byDay.length === 1) return `filed on ${first.filedOn}${who}${ref}.`;
  const rest = byDay.slice(1).map((f) => f.filedOn).join(', ');
  return `filed on ${first.filedOn}${who}${ref}, and filed again on ${rest} — both are recorded, because a later submission does not undo an earlier one.`;
}

/** The day after a bare day, or null when it is not one. UTC in, UTC out, so
 *  the anchoring cancels and no reader's clock can move the boundary. */
function dayAfter(day: string): string | null {
  if (!isoDay(day)) return null;
  // utc-day-ok: two bare days in one calendar, one added, the same calendar
  // out — exactly `dueAfter`'s argument in src/lib/gymInvoices.ts.
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 86400000).toISOString().slice(0, 10);
}

/**
 * The kinds this gym has ever filed anything under, oldest use first.
 *
 * Used to decide which rows a period summary shows: a gym that has never filed
 * a payroll return should not be shown a line saying nobody has answered for
 * its payroll — it has never been the kind of business that files one, and a
 * row of "unanswered" against all five kinds is a row nobody reads, after which
 * the one that matters is invisible too. Returns null under a read that is not
 * whole, because "this gym files two kinds" is itself a claim.
 */
export function kindsInUse(
  all: readonly TaxFiling[] | null | undefined, status: LoadStatus,
): FilingKind[] | null {
  if (!isWhole(status)) return null;
  const seen = new Set<FilingKind>();
  for (const f of all ?? []) if (f.kind) seen.add(f.kind);
  return FILING_KINDS.filter((k) => seen.has(k));
}

/* ── what will not be recorded ────────────────────────────────────────────── */

/**
 * Every reason this filing cannot be recorded, in the owner's own words.
 *
 * A list rather than the first failure — the discipline `standingBlockers` and
 * `gymCostBlockers` both keep, so somebody who has three fields wrong is not
 * corrected three times. Each of these is otherwise a 23514 arriving after the
 * form has closed, and the first two cannot be refused by the database at all:
 * `current_date` is STABLE and Postgres rejects it in a CHECK.
 *
 * `today` is the GYM's bare day.
 */
export function filingBlockers(d: FilingDraft, today: string): string[] {
  const out: string[] = [];
  if (!isFilingKind(d.kind)) {
    out.push('Say what was filed. “Something else the gym had to file” is on the list and is a real answer.');
  }
  if (!isoDay(d.periodFrom)) {
    out.push('The first day the filing covers has to be a real date — YYYY-MM-DD.');
  }
  if (!isoDay(d.periodTo)) {
    out.push('The last day it covers has to be a real date — YYYY-MM-DD. It is inclusive, so a quarter ending on 31 March ends on the 31st.');
  }
  if (isoDay(d.periodFrom) && isoDay(d.periodTo) && d.periodTo < d.periodFrom) {
    out.push('That period ends before it starts.');
  }
  if (!isoDay(d.filedOn)) {
    out.push('The day it was filed has to be a real date — YYYY-MM-DD.');
  }
  if (isoDay(d.filedOn) && isoDay(today) && d.filedOn > today) {
    out.push('That day has not happened yet. This records a filing that was made, so it cannot be dated into the future — record it once it has been sent.');
  }
  // A return is filed for a period that has ENDED. One filed before its own
  // period was over is almost always a mistyped year, and saying so is cheaper
  // than a gym believing Q4 is dealt with in October.
  if (isoDay(d.filedOn) && isoDay(d.periodFrom) && d.filedOn < d.periodFrom) {
    out.push(`This says it was filed on ${d.filedOn}, before the period it covers had even begun on ${d.periodFrom}. Check the dates — a mistyped year is the usual cause.`);
  }
  const ref = (d.reference ?? '').trim();
  if (ref.length > MAX_REFERENCE_CHARS) {
    out.push('That reference is longer than any this can hold. Check it, or leave the box empty and none is recorded — a filing with no reference on it is still a filing.');
  }
  const by = (d.filedBy ?? '').trim();
  if (by.length > MAX_FILED_BY_CHARS) {
    out.push('That is longer than this holds for who filed it. A name or a firm is what this is for.');
  }
  if ((d.note ?? '').trim().length > MAX_FILING_NOTE_CHARS) {
    out.push('That note is longer than this holds. Keep it to what somebody would need to find the submission again.');
  }
  return out;
}

/* ── reads and writes ─────────────────────────────────────────────────────── */

/**
 * Every filing this gym has recorded, newest first.
 *
 * Throws on a refused read rather than returning an empty list, because an
 * empty list is a REAL answer here — "this gym has recorded nothing" — and the
 * two must not arrive in the same shape. supabase-js resolves on a database
 * error, so the error is read off the result; without that, a refused query
 * would report a business that files every quarter as having answered for
 * none of them.
 *
 * Capped and REFUSING rather than paging. A truncated read drops rows, and a
 * dropped filing reads as a period nobody answered for — which sends an owner
 * to file something they have already filed. A gym with more than a thousand
 * recorded filings has been trading for two centuries.
 */
export async function fetchTaxFilings(
  sb: Queryable, tenantId: string,
): Promise<TaxFiling[]> {
  const { data, error } = await sb
    .from('gym_tax_filings')
    .select('id, kind, period_from, period_to, filed_on, reference, filed_by, note')
    .eq('tenant_id', tenantId)
    .order('filed_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  const rows = assertWhole(data as any[] | null, 'what this gym has filed');
  return rows.map((r: any) => ({
    id: r.id,
    // Not coerced to 'other'. A stored value this build does not recognise is
    // reported as unrecognised rather than relabelled as something the gym
    // never said — and it must not silently satisfy a period that a different
    // kind of return was due for.
    kind: isFilingKind(r.kind) ? r.kind : null,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    filedOn: r.filed_on,
    reference: (r.reference ?? '').trim() || null,
    filedBy: (r.filed_by ?? '').trim() || null,
    note: r.note ?? null,
  }));
}

/**
 * Record that this gym filed something.
 *
 * The row is READ BACK and its period and filing day compared with what was
 * sent. An insert that succeeded says a row landed; it does not say the CHECK
 * on `kind` accepted this build's spelling, or that the dates arrived as the
 * days somebody typed. What the comparison catches is a row written into a
 * shape this code did not expect — after which a period would read as answered
 * for by a filing dated somewhere nobody put it.
 */
export async function recordFiling(
  sb: Queryable,
  tenantId: string,
  d: FilingDraft & { createdBy?: string | null },
): Promise<TaxFiling> {
  const { data, error } = await sb.from('gym_tax_filings').insert({
    tenant_id: tenantId,
    kind: d.kind,
    period_from: d.periodFrom,
    period_to: d.periodTo,
    filed_on: d.filedOn,
    // Empty is null, never an empty string: the CHECKs in supabase/parts/2910
    // refuse a blank, and "none was stated" is what an empty box means.
    reference: (d.reference ?? '').trim() || null,
    filed_by: (d.filedBy ?? '').trim() || null,
    note: (d.note ?? '').trim() || null,
    created_by: d.createdBy ?? null,
  }).select('id, kind, period_from, period_to, filed_on, reference, filed_by, note').single();
  if (error) throw error;
  const row = data as any;
  if (!row?.id || row.period_from !== d.periodFrom || row.period_to !== d.periodTo || row.filed_on !== d.filedOn) {
    throw new Error(
      'That filing was NOT recorded the way it was meant to be — the row did not come back matching '
      + 'what was sent. Reload this screen and read the list before entering it again, so that one '
      + 'submission does not end up recorded twice.',
    );
  }
  return {
    id: row.id,
    kind: isFilingKind(row.kind) ? row.kind : null,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    filedOn: row.filed_on,
    reference: (row.reference ?? '').trim() || null,
    filedBy: (row.filed_by ?? '').trim() || null,
    note: row.note ?? null,
  };
}

/**
 * Remove a filing recorded in error.
 *
 * A deletion and not an edit, which is supabase/parts/2910's policy and part
 * 700's argument: a filing is an act performed on one day under one reference,
 * so correcting the record is removing the row that describes a submission
 * nobody made and writing the one that describes the submission they did. An
 * UPDATE would leave a row whose date came from one filing and whose reference
 * came from another, on the record a business would produce to show it complied.
 *
 * This is NOT how an amendment is recorded. A gym that filed and then filed
 * again has made two submissions and both stay — supabase/parts/2910 has no
 * exclusion constraint precisely so that it can, and `filingsFor` says "and
 * filed again on the 14th" rather than replacing the first.
 *
 * THE COUNT IS CHECKED, not `error` alone. `gym_tax_filings_owner_delete` is
 * `is_owner_of(tenant_id)` and is the only policy granting DELETE, so a delete
 * run by anybody else matches ZERO ROWS and returns `error: null` — and the
 * screen would report a wrong filing as removed while a period goes on reading
 * as answered for by something that never happened. See src/lib/wroteRows.ts.
 */
export async function deleteFiling(sb: Queryable, filingId: string): Promise<void> {
  const r = await sb.from('gym_tax_filings').delete({ count: 'exact' }).eq('id', filingId);
  if (r.error) throw r.error;
  assertWrote('That filing', r);
}
