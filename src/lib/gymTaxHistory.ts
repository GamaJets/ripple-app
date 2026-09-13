// What a gym said about its tax registration DURING a period, which is not the
// same question as what it says now.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// `tenants.tax_registered` and `tenants.tax_registration` (part 701) are
// current-state singletons. /tax reads them through `readGymTaxProfile`, turns
// them into a sentence with `taxProfileLine`, and prints that sentence above
// the figures for whichever period the picker is on — including periods that
// ended before the gym ever registered. A gym that registered in April reads,
// over its Q1 figures:
//
//     "This gym says it is registered, under the number below."
//
// about a quarter in which it was not, under a number that did not exist. A gym
// that deregistered in June reads the denial over every quarter it WAS
// registered in. Neither is a tax figure, which is the only reason this is not
// worse; both are statements about a business's legal standing made about a
// stretch of time the stored fact says nothing about, on the page somebody
// works from at a filing deadline.
//
// Everything else on that page already understands that a period is a period.
// `taxPeriod` builds a quarter out of three of this app's own months,
// `taxPeriodAt` puts its bounds on the gym's clock, `openMonthsIn` names the
// months of it that are still moving. The one fact that was not a figure was
// the one fact with no time on it.
//
// ── The three answers, and why there are three ────────────────────────────
//
// `registrationDuring` below never returns a boolean. A period is:
//
//   · answered, by one statement, the whole way through — 'registered' or
//     'not_registered';
//   · answered by MORE THAN ONE statement, which is the April gym: the answer
//     changed inside the period and there is no single thing to print over the
//     figures. It is reported as 'changed', WITH the day it changed on, because
//     "your answer changed in here, on 6 April" is actionable and "cannot say"
//     is not;
//   · not answered, or not answered throughout — 'unstated' and 'gap'. These
//     are the states `tenants.tax_registered` could not express at all, and
//     folding either into "not registered" is the confident-voice failure that
//     column is nullable to avoid.
//
// And above all of them, 'unread': the statements could not be read. A refused
// query must never render as a business that has said nothing, for the same
// reason `taxProfileLine` in src/lib/gymTax.ts already refuses to.
//
// ── Dates are compared as strings, on purpose ─────────────────────────────
//
// Every date in here is a bare `YYYY-MM-DD` off a `date` column, and bare days
// in that form sort lexicographically exactly as they sort chronologically. So
// they are compared with `<=` and never parsed. `new Date('2026-04-01')` is
// midnight UTC, which is 31 March for every reader west of Greenwich — and the
// whole point of this module is a boundary between two quarters, which is the
// one place a day out is a wrong answer rather than a cosmetic one.
//
// Pure apart from the three calls at the bottom, which take the Supabase client
// as an argument the way src/lib/gymTax.ts does.
import type { LoadStatus } from '../ui/loadStatus';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

/* ── a statement ──────────────────────────────────────────────────────────── */

export type TaxStandingStatus = 'registered' | 'not_registered';

/**
 * One dated statement a gym made about itself.
 *
 * `toOn` null means "and still", which is the ordinary shape of the current
 * registration. It is NOT "the end is unknown": a caller that does not know
 * when something ended records the stretch it does know and leaves the rest
 * uncovered, which is how this table says "nobody has answered for that".
 */
export interface TaxStanding {
  id: string;
  status: TaxStandingStatus;
  /** The number as somebody typed it, or null. Null on a `not_registered`
   *  statement by the CHECK in supabase/parts/2641, and allowed on a
   *  `registered` one: a gym that has registered and not yet been given its
   *  number has still said something true. */
  registration: string | null;
  /** `YYYY-MM-DD`, inclusive. */
  fromOn: string;
  /** `YYYY-MM-DD`, inclusive, or null for "and still". */
  toOn: string | null;
  note: string | null;
}

/** Oldest first. A copy, so a caller's array is not reordered underneath it —
 *  the rows usually arrive from a read the screen is also rendering. */
export function byDate(list: readonly TaxStanding[]): TaxStanding[] {
  return [...list].sort((a, b) => (a.fromOn < b.fromOn ? -1 : a.fromOn > b.fromOn ? 1 : a.id.localeCompare(b.id)));
}

/** Does this statement cover this day? Both ends inclusive, string compare. */
export function covers(s: TaxStanding, day: string): boolean {
  if (day < s.fromOn) return false;
  return s.toOn == null || day <= s.toOn;
}

/* ── what the gym said during a period ────────────────────────────────────── */

export type TaxStandingDuring =
  /** The statements could not be read, or have not arrived, or came back
   *  truncated. Nothing is known and nothing may be printed. */
  | { state: 'unread'; why: string }
  /** No statement covers any day of the period. */
  | { state: 'unstated' }
  /** Some of the period is covered and some of it is not. `from` and `to` name
   *  the first and last uncovered day, so a screen can say which part. */
  | { state: 'gap'; from: string; to: string }
  /** One answer, the whole way through. */
  | { state: 'registered'; registration: string | null }
  | { state: 'not_registered' }
  /** The answer changed inside the period. `on` is the first day of the second
   *  statement — the day it changed — and `before`/`after` are the two answers.
   *  This is the gym that registered in April. */
  | { state: 'changed'; on: string; before: TaxStandingStatus; after: TaxStandingStatus };

/**
 * What this gym said about its registration across `firstDay`..`lastDay`,
 * inclusive.
 *
 * `status` is the state of the READ and nothing else — the distinction
 * src/ui/loadStatus.ts exists for. 'partial' is never treated as whole: a
 * truncated read of the statements drops the oldest of them, which are exactly
 * the ones a historical quarter is answered by, and the period would then read
 * as unstated when it is on file.
 *
 * The walk is day-boundary-driven rather than day-by-day: the statements are
 * sorted, the covered stretches are joined where they are adjacent, and what is
 * left is a gap. A quarter is ninety-odd days and a gym has a handful of
 * statements, so this is a few comparisons either way; what matters is that it
 * never iterates a calendar, because iterating a calendar means constructing
 * dates, and constructing dates is how a quarter boundary moves.
 */
export function registrationDuring(
  list: readonly TaxStanding[] | null,
  firstDay: string,
  lastDay: string,
  status: LoadStatus,
): TaxStandingDuring {
  if (status === 'loading') {
    return { state: 'unread', why: 'Still reading what this gym has said about its registration.' };
  }
  if (status === 'error' || list === null) {
    return {
      state: 'unread',
      why: 'What this gym has said about its registration could not be read. That is not a statement that it has said nothing, and anything already recorded still stands.',
    };
  }
  if (status === 'partial') {
    return {
      state: 'unread',
      why: 'More registration statements came back than could be read in one go, so the ones covering this period may not be among them. Nothing is claimed either way.',
    };
  }
  if (!firstDay || !lastDay || lastDay < firstDay) {
    return { state: 'unread', why: 'That period has no days in it, so there is nothing to answer for.' };
  }

  // Only the statements that touch the period at all. A registration that ended
  // in 2019 says nothing about this quarter and must not join the walk, where it
  // would look like the first of two and report the period as "changed".
  const touching = byDate(list).filter(
    (s) => s.fromOn <= lastDay && (s.toOn == null || s.toOn >= firstDay),
  );
  if (!touching.length) return { state: 'unstated' };

  // Walk forward, carrying the last day that has been answered for.
  //
  // The no-overlap constraint in supabase/parts/2641 is built on an INCLUSIVE
  // range, so two statements are ADJACENT when the second starts the day after
  // the first ends — and that day has to be computed, or a registration ending
  // 31 March and one starting 1 April would be reported as a period with a gap
  // in it between them. `nextDay`/`prevDay` are the only arithmetic in this
  // module and they cancel exactly; see their comments.
  let coveredTo: string | null = null;
  for (const s of touching) {
    const needFrom = coveredTo == null ? firstDay : nextDay(coveredTo);
    if (s.fromOn > needFrom) {
      return { state: 'gap', from: needFrom, to: prevDay(s.fromOn) };
    }
    if (s.toOn == null) { coveredTo = lastDay; break; }
    if (coveredTo == null || s.toOn > coveredTo) coveredTo = s.toOn;
    if (coveredTo >= lastDay) break;
  }
  // `touching` is non-empty, so the loop ran at least once and `coveredTo` is
  // set — except where a statement's own dates are inconsistent, which the
  // CHECK refuses. Reported as a gap over the whole period rather than trusted.
  if (coveredTo == null) return { state: 'gap', from: firstDay, to: lastDay };
  if (coveredTo < lastDay) {
    return { state: 'gap', from: nextDay(coveredTo), to: lastDay };
  }

  // Covered throughout. Now: is it one answer, or did it change?
  //
  // Adjacent statements that say the SAME thing are one answer — a gym that
  // re-recorded its registration when the number changed has not stopped being
  // registered. A change of NUMBER inside a period is reported through the
  // number itself being withheld rather than as 'changed', because the period's
  // answer to "were you registered" did not change and that is the question
  // this sentence sits above.
  const first = touching[0];
  const differing = touching.find((s) => s.status !== first.status);
  if (differing) {
    return {
      state: 'changed',
      on: differing.fromOn,
      before: first.status,
      after: differing.status,
    };
  }
  if (first.status === 'not_registered') return { state: 'not_registered' };
  const numbers = new Set(touching.map((s) => (s.registration ?? '').trim()).filter(Boolean));
  return {
    state: 'registered',
    // One number or none. Two numbers inside one period is a real thing — a
    // re-registration, a group restructure — and printing either of them over
    // the period's figures would be printing the one that was not in force for
    // half of it.
    registration: numbers.size === 1 ? [...numbers][0] : null,
  };
}

/**
 * The sentence that goes above the figures.
 *
 * `periodLabel` is the period's own words — 'Q1 2026 · January to March' — so
 * the sentence names the stretch it is about rather than leaving a reader to
 * assume it is about today. That assumption is the entire defect.
 */
export function standingLine(d: TaxStandingDuring, periodLabel: string): string {
  switch (d.state) {
    case 'unread':
      return d.why;
    case 'unstated':
      return `Nobody has said whether this gym was registered for a tax on its sales during ${periodLabel}. That is not the same as saying it was not — until somebody records it, Repple holds no tax fact about this business for this period at all.`;
    case 'gap':
      return d.from === d.to
        ? `This gym has recorded its registration for the rest of ${periodLabel} but not for ${d.from}. Nothing is claimed about that day; record it and this sentence covers the whole period.`
        : `This gym has recorded its registration for part of ${periodLabel} and not for ${d.from} to ${d.to}. Nothing is claimed about those days; record them and this sentence covers the whole period.`;
    case 'changed':
      return `This gym's registration CHANGED inside ${periodLabel}, on ${d.on} — ${STANDING_WORD[d.before]} before that day and ${STANDING_WORD[d.after]} from it. There is no single answer to print over this period's figures, and a return covering it is not one thing either. Your accountant needs the date, which is the one above.`;
    case 'not_registered':
      return `This gym says it was not registered for a tax on its sales during ${periodLabel}. Nothing on this page is a tax figure either way.`;
    case 'registered':
      return d.registration
        ? `This gym says it was registered throughout ${periodLabel}, under the number below. Repple holds that number as typed and has never checked it against any register.`
        : `This gym says it was registered throughout ${periodLabel} and has not stated a number for it. The number is the one tax fact a business has to print on its own invoices, so it is worth adding.`;
  }
}

/**
 * The day after a bare `YYYY-MM-DD`, and the day before one.
 *
 * The only arithmetic in this module, and it is here because adjacency cannot
 * be asked any other way: part 2641 stores the LAST day a statement was true,
 * so a registration ending 2026-03-31 and one starting 2026-04-01 are touching,
 * and a walk that could not compute "the day after 31 March" would report a
 * one-day hole between them on every quarter boundary in the product.
 *
 * `dueAfter` in src/lib/gymInvoices.ts does exactly this and its argument is
 * the one that matters: UTC goes in, UTC comes out, and it cancels. A bare day
 * is anchored at UTC midnight, 86,400,000 milliseconds are added or removed,
 * and the same kind of bare day comes back — which is the same answer for the
 * owner in Auckland and the accountant in Denver, because it is one date on one
 * statement and not an instant anybody is in.
 */
function nextDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return day;
  // utc-day-ok: see above — anchored at UTC one line up, read back at UTC here,
  // so no reader's calendar enters into it. This is a bare day off a `date`
  // column being moved by one day, not an instant being named.
  return new Date(t + 86400000).toISOString().slice(0, 10);
}

function prevDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return day;
  // utc-day-ok: the mirror of `nextDay`, and the same cancellation.
  return new Date(t - 86400000).toISOString().slice(0, 10);
}

const STANDING_WORD: Record<TaxStandingStatus, string> = {
  registered: 'registered',
  not_registered: 'not registered',
};

export const STANDING_LABEL: Record<TaxStandingStatus, string> = {
  registered: 'Registered',
  not_registered: 'Not Registered',
};

/**
 * What to say about `tenants.tax_registered` once this table exists.
 *
 * The flag is not wrong — it is what the gym says TODAY — it is just not an
 * answer to the question the screen is asking. Said in those words rather than
 * hidden, because an owner who set that field last year and now cannot find it
 * will conclude the console lost it.
 */
export const CURRENT_FLAG_IS_NOT_A_PERIOD_NOTE =
  'What this gym says about its registration TODAY is held separately and has no '
  + 'date on it, so it cannot answer for a period that has already ended. Recording '
  + 'the dates below is what lets each quarter carry the answer that was true inside it.';

/* ── what will not be recorded ────────────────────────────────────────────── */

export interface TaxStandingDraft {
  status: TaxStandingStatus;
  registration: string;
  fromOn: string;
  toOn: string;
}

/**
 * Every reason this statement cannot be recorded, in the owner's own words.
 *
 * A list rather than the first failure, the discipline `taxProfileBlockers` and
 * `gymCostBlockers` both keep. Each of these is otherwise a 23514, a 23P01 or a
 * silently wrong row, arriving after the form has closed.
 *
 * `existing` is what the gym has already said. A refused read passes an empty
 * list, which means the overlap check cannot fire — so the database's exclusion
 * constraint is the one that actually holds the line and this is the half that
 * explains it while somebody is still typing.
 */
export function standingBlockers(
  d: TaxStandingDraft, existing: readonly TaxStanding[],
): string[] {
  const out: string[] = [];
  const reg = d.registration.trim();
  if (!isoDay(d.fromOn)) {
    out.push('The day this started has to be a real date — YYYY-MM-DD. A registration with no start day is the flag this replaces.');
  }
  if (d.toOn && !isoDay(d.toOn)) {
    out.push('The day this ended has to be a real date — YYYY-MM-DD, or empty if it is still true.');
  }
  if (isoDay(d.fromOn) && isoDay(d.toOn) && d.toOn < d.fromOn) {
    out.push('That ends before it starts.');
  }
  if (reg.length > 60) {
    out.push('That registration number is longer than any this can hold. Check it, or leave the box empty and none is recorded for this period.');
  }
  if (d.status === 'not_registered' && reg) {
    out.push('This says the gym was not registered and still carries a registration number. Clear the number, or say it was registered.');
  }
  if (isoDay(d.fromOn)) {
    const clash = existing.find((s) => overlaps(s, d));
    if (clash) {
      out.push(
        `This overlaps what is already recorded from ${clash.fromOn}${clash.toOn ? ` to ${clash.toOn}` : ' onwards'}. `
        + 'Two statements about one day are two answers, and no screen can choose between them — close the '
        + 'existing period on the day before this one starts, then record this.',
      );
    }
  }
  return out;
}

/** Do a stored statement and a draft both claim the same day? Inclusive at both
 *  ends, matching the exclusion constraint in supabase/parts/2641. */
function overlaps(s: TaxStanding, d: TaxStandingDraft): boolean {
  const aEnd = s.toOn;
  const bEnd = isoDay(d.toOn) ? d.toOn : null;
  if (aEnd != null && aEnd < d.fromOn) return false;
  if (bEnd != null && bEnd < s.fromOn) return false;
  return true;
}

/** A plain ISO day, and one `Date` actually agrees with. Byte-identical in
 *  behaviour to `isoDay` in src/lib/gymInvoices.ts; repeated rather than
 *  imported because that module pulls in the invoice reads and this one is a
 *  rule a screen with no database in front of it should be able to ask. */
export function isoDay(s: string | null | undefined): boolean {
  const v = String(s ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  // utc-day-ok: this states no day to anybody — it asks whether the string it
  // was handed survives a round trip, which is how `2026-02-31` is caught after
  // Date has rolled it into March. Both ends of that trip are UTC by
  // construction, one line up, so the calendar cancels.
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/* ── reads and writes ─────────────────────────────────────────────────────── */

/**
 * Every statement this gym has made, oldest first.
 *
 * Throws on a refused read rather than returning an empty list, because an
 * empty list is a REAL answer here ("this gym has said nothing") and the two
 * must not arrive in the same shape. supabase-js resolves on a database error,
 * so the error is read off the result — without that, a refused query would
 * report a registered business as having no tax record at all.
 *
 * Not paged and not capped, and this is the one read in the money screens where
 * that is defensible rather than lazy: a row here is a change of legal
 * standing, a gym has one or two in its life, and the no-overlap constraint
 * makes it impossible to accumulate them. It is bounded by reality rather than
 * by a limit.
 */
export async function fetchTaxStandings(
  sb: Queryable, tenantId: string,
): Promise<TaxStanding[]> {
  const { data, error } = await sb
    .from('gym_tax_registrations')
    .select('id, status, registration, from_on, to_on, note')
    .eq('tenant_id', tenantId)
    .order('from_on', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return ((data as any[] | null) ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    registration: (r.registration ?? '').trim() || null,
    fromOn: r.from_on,
    toOn: r.to_on ?? null,
    note: r.note ?? null,
  }));
}

/**
 * Record one statement.
 *
 * The ROW is read back rather than the error being taken as an answer.
 * `gym_tax_registrations_owner` is `is_owner_of(tenant_id)`, so an insert run
 * by anybody else is filtered to nothing and can resolve with no error at all —
 * and the screen would report a registration as recorded while the period is
 * still unstated. See src/lib/wroteRows.ts.
 */
export async function recordTaxStanding(
  sb: Queryable,
  tenantId: string,
  d: TaxStandingDraft & { note?: string | null; createdBy?: string | null },
): Promise<TaxStanding> {
  const reg = d.registration.trim();
  const { data, error } = await sb.from('gym_tax_registrations').insert({
    tenant_id: tenantId,
    status: d.status,
    // Empty is null, never an empty string: the CHECK in part 2641 refuses a
    // blank, and "no number was stated" is what an empty box means.
    registration: reg || null,
    from_on: d.fromOn,
    to_on: d.toOn || null,
    note: d.note?.trim() || null,
    created_by: d.createdBy ?? null,
  }).select('id, status, registration, from_on, to_on, note').single();
  if (error) throw error;
  const row = data as any;
  if (!row?.id) {
    throw new Error(
      'That registration was NOT recorded — the row did not come back. Reload this screen and check '
      + 'the list before entering it again; two statements about one day are refused by the database, '
      + 'so a duplicate will fail rather than double up.',
    );
  }
  return {
    id: row.id,
    status: row.status,
    registration: (row.registration ?? '').trim() || null,
    fromOn: row.from_on,
    toOn: row.to_on ?? null,
    note: row.note ?? null,
  };
}

/**
 * Close an open statement on a day.
 *
 * An UPDATE rather than a delete-and-rewrite, which is the one place this table
 * differs from `gym_costs` and the reason is in part 2641: a registration
 * period is an assertion with an open end, and giving it an end does not make
 * it a different assertion. `created_at` and `created_by` stay with the
 * statement they belong to.
 *
 * The COUNT is checked, not `error` alone.
 */
export async function endTaxStanding(
  sb: Queryable, standingId: string, lastDay: string,
): Promise<void> {
  const r = await sb
    .from('gym_tax_registrations')
    .update({ to_on: lastDay }, { count: 'exact' })
    .eq('id', standingId);
  if (r.error) throw r.error;
  assertWrote('That registration period', r);
}
