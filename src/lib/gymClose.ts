// Closing a month, so that it stays closed.
//
// src/lib/monthEnd.ts decides whether a month CAN be closed. Until this file
// there was nothing that could record that anybody had, so:
//
//   · `buildClose` recomputed the verdict from live rows on every load. A month
//     closed on Monday was open again on Tuesday if anyone recorded a late
//     payment, and nothing on screen said it had ever been closed.
//   · /accounting re-reported the same month with different figures, and the
//     number the owner handed their accountant last week was unrecoverable —
//     not disputed, gone, because it was never a stored thing.
//   · "Have we closed August?" had no answer in the database. The only evidence
//     was whatever the owner remembered.
//
// Two halves, and they are different things. This module is the first: a close
// is a ROW, and it carries the figures. The second is enforcement, and it lives
// in the database — supabase/parts/182 refuses a payment or an invoice written
// into a month this gym has closed, because a stored close that any later write
// can invalidate is a note rather than a close.
//
// ── Why the figures are snapshotted ───────────────────────────────────────
//
// The point of closing a month is that the numbers stop moving. `payroll_
// settlements` already makes this argument about what was handed over — "a
// later change to the gym's session fee cannot rewrite what was actually
// handed over" — and it applies with more force here, because a close is what
// leaves the building.
//
// Every figure is NULLABLE and so is every currency, because every one of them
// is nullable on screen. A month whose invoice read failed, or a gym that has
// not set a currency, produces a close with holes in it, and a close that
// turned those into zeros to satisfy a NOT NULL would be storing the exact lie
// the whole screen is built to refuse.
//
// ── One currency beside four figures, and only one of them was in it ──────
//
// This module stored FOUR money figures and ONE currency code, and /close
// handed it `currencyOf(rec, gymCcy)` — which is payments-first: what the
// month's `gym_payments` rows agree on, falling back to the invoices and then
// to `tenants.currency`. So the code was true of `takenCents` and of nothing
// else beside it:
//
//   · `invoicedCents` and `outstandingCents` come off `gym_invoices`, which
//     carries its own currency per row;
//   · `payrollCents` comes off `sessions.rate_cents` — snapshotted with their
//     own `rate_currency` since supabase/parts/1010 — and off
//     `tenants.session_fee`, which is denominated in `tenants.currency`.
//
// A gym whose August card takings happened to be all AED therefore filed its
// GBP invoices, its GBP arrears and its GBP payroll as dirhams, permanently, on
// the one document an owner reconciles against a bank statement and hands to an
// accountant. Every later drift line reads back through the stored row, and the
// handoff CSV exports it.
//
// The KPI row on /close was repaired for exactly this and now prices those
// figures with the invoices' own agreed code and with the payroll run's own.
// The STORED row was not, so the screen and the record it wrote disagreed.
//
// supabase/parts/2540 adds a currency column PER FIGURE and this module writes
// all four. `currency` — the single legacy code — is kept and is written NULL
// from here on; see the note on `CloseSnapshot.currency` below.
//
// ── Closing over a blocker is allowed, and recorded ───────────────────────
//
// /close refuses to call a month closeable while anything is outstanding, and
// that refusal is the best thing about the screen. It is still not this
// module's job to make the decision unavailable: a gym with one session nobody
// will ever be able to mark, from a trainer who left in March, would otherwise
// be unable to close March forever. So the blockers are written onto the close
// verbatim, and a close made over them reads as exactly that — a decision
// somebody took, with the reasons they took it over printed beside it.

// ── The fifth figure: what the desk sold over the counter ────────────────
//
// The close stored four money figures. /close shows FIVE — `buildClose` reads
// five parts of a month and the fifth is `passes` — and not one column here
// recorded it. So four figures stopped moving the moment a month was filed and
// the fifth went on moving forever: a pass voided in September changed what
// August sold, `driftSince` compares stored against live figure by figure, and
// a figure that was never stored cannot drift. The owner who handed their
// accountant an August close in September held a document silent about a real
// part of August's takings, with no later way to recover the number.
//
// Pass sales are NOT inside `takenCents` and never were. `gym_passes` and
// `gym_payments` are two independent registers with no link column between
// them, so adding them double-counts and dropping one loses income; that is
// why `buildClose` holds them apart and why the close has to file them apart.
// supabase/parts/2970 adds the four columns and this module writes all four.

import { assertWrote } from './wroteRows';
import { assertWhole, capLimit } from './rowCap';
import { readByIds } from './idLookup';
import type { MonthClose } from './monthEnd';
/*
 * The pass derivation, IMPORTED rather than copied.
 *
 * `passSnapshotOf` decides the three cases that matter — the passes were not
 * read, the priced passes span two moneys, or there is a real figure — and a
 * second copy of that decision here is how the stored row and the screen come
 * to disagree about the same month, which is the fault this file's header is
 * already about. So it is taken from where it was written.
 *
 * This makes gymClose ⇄ ownerClose a cycle, and it is safe because neither
 * module touches the other at MODULE level: every reference is inside a
 * function body, resolved on the first call, by which time both module objects
 * are populated under CommonJS and under every bundler this repo builds with.
 * It is still a cycle, and the right cure is moving `passSnapshotOf` and
 * `PassSnapshot` down here beside `CloseSnapshot`, where the other four
 * figures' rules already live — not available to this lane, which does not own
 * src/lib/ownerClose.ts.
 */
import { passSnapshotOf, type PassSnapshot } from './ownerClose';

type Queryable = { from: (table: string) => any };

export interface MonthCloseRow {
  id: string;
  monthKey: string;
  closedAt: string;
  closedBy: string | null;
  closedByName: string | null;
  note: string | null;
  takenCents: number | null;
  invoicedCents: number | null;
  outstandingCents: number | null;
  payrollCents: number | null;
  /** One code per figure — supabase/parts/2540. Null where the figure's own
   *  rows named no single money, which is a dash on screen and not a borrowed
   *  code. */
  takenCurrency: string | null;
  invoicedCurrency: string | null;
  outstandingCurrency: string | null;
  payrollCurrency: string | null;
  /**
   * The legacy single code, and NULL on everything written since 2540.
   *
   * Kept rather than dropped, and read rather than ignored, because a column
   * that has ever been written is a column something might still read: a
   * console tab left open on the previous bundle can still insert one. It was
   * derived payments-first, so it can honestly speak for `takenCents` and for
   * no other figure on the row — which is how the four "at the close" tiles
   * read it.
   */
  currency: string | null;
  /**
   * What the close filed about the month's pass sales — supabase/parts/2970.
   *
   * OPTIONAL, and the optionality is the load-bearing part of this type.
   * ABSENT IS NOT NULL. `passDriftSince` in src/lib/ownerClose.ts reports
   * nothing at all for a row carrying none of these four keys, precisely so
   * that a row which was never asked the question cannot produce a movement
   * line; the keys being present is what turns that check on. `fetchCloses`
   * below is the only thing in the product that decides which of the two a
   * stored row is, and the rule it applies is written there.
   *
   * The four are one fact in four columns and must be read together:
   *
   *   · `passCents` null is NEVER zero. It is either "the passes could not be
   *     read at the close" or "the priced passes spanned more than one money,
   *     and a sum across two moneys is not an amount of anything".
   *   · `passCurrency` is null wherever `passCents` is, so the pair can never
   *     disagree — and ALSO null over a REAL figure whose rows stated no code
   *     at all, which is one unknown unit rather than two known ones. That
   *     shape — cents present, currency null — is legitimate and is not to be
   *     coalesced into anything.
   *   · `passesSold` is a COUNT and survives a withheld figure. It is what
   *     stops a null `passCents` reading as "no passes were sold".
   *   · `passesPriced` says what fraction of the month `passCents` is a sum
   *     OVER: four priced out of five sold is a figure with a known hole in
   *     it, four out of four is a total.
   */
  passCents?: number | null;
  passCurrency?: string | null;
  passesSold?: number | null;
  passesPriced?: number | null;
  unmarkedSessions: number | null;
  blockersAtClose: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
}

/**
 * What is written when a month is closed. Every figure may be absent, and so
 * may the currency of any one of them, independently of the other three.
 *
 * `extends PassSnapshot` and not four hand-copied fields: the pass half of a
 * close is one shape, `passSnapshotOf` is the one thing that derives it, and a
 * second declaration of the same four would be free to drift away from the
 * rules written on that one. Every field it brings is REQUIRED here, unlike on
 * `MonthCloseRow` — a snapshot is the answer to the question, so it always has
 * all four, even when all four of them are null.
 */
export interface CloseSnapshot extends PassSnapshot {
  takenCents: number | null;
  invoicedCents: number | null;
  outstandingCents: number | null;
  payrollCents: number | null;
  takenCurrency: string | null;
  invoicedCurrency: string | null;
  outstandingCurrency: string | null;
  payrollCurrency: string | null;
  /** Always null. The legacy single code is never written again — see the
   *  header, and `MonthCloseRow.currency` for why the column stays. */
  currency: null;
  unmarkedSessions: number | null;
  blockersAtClose: string | null;
}

/**
 * The three currencies the SCREEN priced its tiles with, handed in.
 *
 * Not re-derived here, and that is the point. `takenCents` is the figure the
 * "Taken" tile rendered and `takenCurrency` must be the code that tile rendered
 * it in, or the stored row and the screen it was taken from disagree about the
 * same month — which is the whole class of fault this file's header is about.
 * /close computes these once, at the top of `CloseView`, and the KPI row and
 * the close are handed the same three values.
 *
 * Payroll is deliberately NOT among them: `MonthClose.payroll` already carries
 * its own answer, computed by `payrollOf` from the very sessions the figure is
 * a sum of, so the label cannot be derived from a different set of rows than
 * the number. See `PayrollView.currency` in src/lib/monthEnd.ts.
 */
export interface CloseCurrencies {
  /** What the month's PAYMENTS agree on, or null when they do not agree. */
  taken: string | null;
  /** What the INVOICES agree on. Two fields rather than one because they are
   *  two columns and two figures; today /close derives both from the same set,
   *  and a screen that later prices them apart must be able to store that. */
  invoiced: string | null;
  outstanding: string | null;
}

/**
 * The figures on screen, reduced to what gets stored.
 *
 * Pure, and separate from the write, because this is the part that can be wrong
 * in a way nobody notices: a snapshot that reads `owed.settledCents` where the
 * screen renders `arrears.outstandingCents` would store a plausible number
 * against the wrong label, permanently, and the screen it came from would still
 * look right. The assertions in src/lib/gymClose.test.ts are what hold the four
 * to the four the KPI row shows.
 *
 * `blockers` is joined rather than counted. "Closed over 3 blockers" is not
 * something anybody can act on in March; "12 sessions still need an outcome" is.
 */
export function snapshotOf(c: MonthClose, ccy: CloseCurrencies): CloseSnapshot {
  const invoiced = c.owed
    ? sumOrNull(c.owed.settledCents, c.owed.outstandingCents)
    : null;
  /*
   * A payroll total across more than one rate currency is not filed.
   *
   * `payroll.total.cents` is still a sum in that case — `payrollTotal` adds the
   * per-trainer lines and has no opinion about money — and the screen withholds
   * it, because a number made of dirhams and pounds is not an amount of
   * anything. Storing it with a null currency beside it would be worse than the
   * defect this part closes: an unlabelled figure reads as "the currency was
   * not recorded", and an accountant would price it with the gym's code, which
   * is precisely the substitution the whole change is here to stop. So the
   * figure goes in as absent, and `blockers_at_close` carries the sentence
   * saying why the month was signed off without it.
   *
   * The 'unrecorded' case is different and IS stored: rates snapshotted before
   * supabase/parts/1010 are a real sum in one unknown unit, not a sum across
   * two known ones, and `payrollCurrency` null says exactly that.
   */
  const payrollCents = c.payroll && !c.payroll.mixedCurrency ? c.payroll.total.cents : null;
  return {
    // The KPI reads `c.income.takenCents`, which is already null when the
    // month's payments carry more than one currency. That null is carried
    // through rather than repaired: a month whose takings cannot be totalled
    // does not acquire a total by being closed.
    takenCents: c.income ? c.income.takenCents : null,
    invoicedCents: invoiced,
    outstandingCents: c.arrears ? c.arrears.outstandingCents : null,
    // `payroll.total.cents` is null while anything is unpriced, and it is a
    // FLOOR rather than a total while anything is unmarked. `unmarkedSessions`
    // beside it is what says which of the two this figure is.
    payrollCents,
    takenCurrency: ccy.taken ?? null,
    invoicedCurrency: ccy.invoiced ?? null,
    outstandingCurrency: ccy.outstanding ?? null,
    // From the close itself, not from the caller: `payrollOf` derived it from
    // the same sessions `payrollCents` is a sum of.
    payrollCurrency: c.payroll ? c.payroll.currency : null,
    // Never again. The column stays for the rows that predate the split.
    currency: null,
    /*
     * The fifth figure, derived by the one function that derives it.
     *
     * Spread rather than restated so that the three cases `passSnapshotOf`
     * decides between — passes unread, two moneys, a real figure — are decided
     * ONCE and read the same way on the owner's phone and in the stored row.
     * Note what it does NOT do: a mixed-currency month files null cents with
     * the real COUNTS beside them, because two currencies cannot be added but
     * the number of passes sold is still a fact, and a 0 there would be the
     * one claim an accountant cannot detect as false.
     */
    ...passSnapshotOf(c),
    unmarkedSessions: c.payroll ? c.payroll.total.unmarked : null,
    blockersAtClose: c.blockers.length ? c.blockers.map((b) => b.text).join('\n') : null,
  };
}

/**
 * Two figures that may each be null.
 *
 * This is /close's own `sumOrNull`, copied deliberately rather than improved.
 * The snapshot has to store the figure that was ON THE SCREEN when somebody
 * pressed Close, and the screen renders its "Billed this month" tile through
 * exactly this rule: null only when BOTH sides are unknown, and an unknown side
 * counted as nothing otherwise. Storing a stricter figure here would mean the
 * close and the tile it came from disagreed, which is a worse fault than either
 * rule on its own.
 */
function sumOrNull(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Why this month cannot be closed right now, or null when it can.
 *
 * Deliberately NOT the same question as `closeBlockers`. That one asks whether
 * the figures are safe to act on and its answer is advisory — an owner may
 * close over it, and the reasons are stored. This asks whether closing is
 * possible at all, and there are only two answers: the month has not finished,
 * or it is already closed.
 *
 * A month still running is refused outright and that is not advisory. Closing
 * September on the 14th would lock out every payment for the rest of the month
 * through the trigger in supabase/parts/182 — the front desk would stop being
 * able to take money, and the error would name a month that has not ended.
 */
export function closeBlocker(
  monthKey: string, ended: boolean, existing: MonthCloseRow | null,
): string | null {
  if (existing && !existing.reopenedAt) {
    return `${monthKey} is already closed. Reopen it if something in it has to change.`;
  }
  if (!ended) {
    return `${monthKey} has not finished. Closing a month that is still running would stop the desk recording payments for the rest of it.`;
  }
  return null;
}

/**
 * Why money dated into this month cannot be written, or null.
 *
 * ── The door that was left open ───────────────────────────────────────────
 *
 * Part 182 locked `gym_payments` and `gym_invoices` against writes into a
 * closed month and locked nothing else. `payroll_settlements` — the one table
 * in the product where money LEAVES the building — was unguarded, and /payroll
 * never read this table at all: the period picker offered a closed month
 * exactly like an open one and wrote `period_from` straight through. The month
 * was signed off, and then a settlement landed in it, and /accounting's "Money
 * out" for a filed month moved underneath the accountant.
 *
 * Part 481 attaches the same trigger to `payroll_settlements.period_from`, so
 * the database refuses it. This is the half that refuses it BEFORE the button
 * is pressed, because a payroll run that fails at the database is a worse way
 * to learn the month is closed than being told so with the run on screen.
 *
 * `rows` null means the record of closes could not be read. That returns null —
 * allowed — deliberately: the database is now the backstop and will refuse a
 * genuine violation, so blocking here on an unreadable read would take payroll
 * away from a gym over a failure that costs nothing. That is the opposite trade
 * from `closeBlocker`, where nothing downstream would catch a double close.
 */
export function closedMonthBlocker(day: string, rows: MonthCloseRow[] | null): string | null {
  if (rows == null) return null;
  const key = (day ?? '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  const live = liveCloseFor(key, rows);
  if (!live) return null;
  return `${key} is closed. Nothing dated into it can be recorded until it is reopened on the Close screen, with a reason.`;
}

/** Why a reopen cannot be recorded, or null. */
export function reopenBlocker(reason: string): string | null {
  if (!reason.trim()) {
    return 'Say why this month is being reopened. A month that closed and then moved is a thing an accountant has to be told about, and the reason is the telling.';
  }
  return null;
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * Every close and reopen this gym has recorded, newest first.
 *
 * Not filtered to the live ones. A month closed, reopened and closed again is
 * three rows and a true history, and the history is the half an auditor wants —
 * the current state is one boolean they can see on the screen anyway.
 *
 * ── why this refuses a truncated read, on a set that will never truncate ────
 *
 * The `.limit(capLimit())` here had neither `capped()` nor `assertWhole` behind
 * it — the only read in this slice that did not — so at the ceiling the probe
 * row `capLimit()` asks for, which is requested to be COUNTED and not read,
 * would have gone into the history table as a real close, and the oldest months
 * would have fallen off the far end in silence. `closedMonthBlocker` looks a
 * named month up in this list, and the rows it drops are the oldest ones, so
 * the visible failure would be a recording accepted into a month that was
 * signed off years ago.
 *
 * It cannot happen. A close is one row a month plus one more per reopen, so a
 * thousand and one of them is the better part of a century of month-ends, and
 * no gym in this database is eighty-three years old. That is exactly why the
 * guard belongs here rather than in a note: it costs one line, it will never
 * fire, and the reason it will never fire is an assumption about a customer's
 * age that nothing enforces and nobody would think to re-check.
 *
 * `assertWhole` and not `capped`, for the same reason gymCosts.ts gives: this
 * hands back a plain array, a prefix of a gym's sign-off history presented as
 * the history is the one thing the record must never be, and both callers are
 * already built for the throw. studio-web/app/close/page.tsx catches it, says
 * the record of closed months could not be read and leaves the Close button
 * unusable — which is right, because a close pressed over a list that cannot
 * say whether the month is already closed is the mistake that table exists to
 * prevent. studio-web/app/payroll/page.tsx reads it inside `Promise.allSettled`,
 * so the rejection lands as one settled failure, `closedMonthBlocker` is handed
 * null and declines to block, and payroll is not taken away from a gym over it
 * — the trade `closedMonthBlocker` argues for in as many words.
 */
export async function fetchCloses(sb: Queryable, tenantId: string): Promise<MonthCloseRow[]> {
  const { data, error } = await sb
    .from('gym_month_closes')
    .select('id, month_key, closed_at, closed_by, note, taken_cents, invoiced_cents, outstanding_cents, payroll_cents, taken_currency, invoiced_currency, outstanding_currency, payroll_currency, currency, pass_cents, pass_currency, passes_sold, passes_priced, unmarked_sessions, blockers_at_close, reopened_at, reopened_by, reopen_reason')
    .eq('tenant_id', tenantId)
    .order('month_key', { ascending: false })
    .order('closed_at', { ascending: false })
    .limit(capLimit());
  if (error) throw error;

  const rows = assertWhole<any>(data, "this gym's record of closed months");
  const names = await namesFor(sb, rows.flatMap((r) => [r.closed_by, r.reopened_by]));
  return rows.map((r) => ({
    id: r.id,
    monthKey: r.month_key,
    closedAt: r.closed_at,
    closedBy: r.closed_by ?? null,
    closedByName: r.closed_by ? names.get(r.closed_by) ?? null : null,
    note: r.note ?? null,
    takenCents: numOrNull(r.taken_cents),
    invoicedCents: numOrNull(r.invoiced_cents),
    outstandingCents: numOrNull(r.outstanding_cents),
    payrollCents: numOrNull(r.payroll_cents),
    takenCurrency: r.taken_currency ?? null,
    invoicedCurrency: r.invoiced_currency ?? null,
    outstandingCurrency: r.outstanding_currency ?? null,
    payrollCurrency: r.payroll_currency ?? null,
    currency: r.currency ?? null,
    ...passColumnsOf(r),
    unmarkedSessions: numOrNull(r.unmarked_sessions),
    blockersAtClose: r.blockers_at_close ?? null,
    reopenedAt: r.reopened_at ?? null,
    reopenedBy: r.reopened_by ?? null,
    reopenedByName: r.reopened_by ? names.get(r.reopened_by) ?? null : null,
    reopenReason: r.reopen_reason ?? null,
  }));
}

/**
 * The pass columns off a stored row — or NO KEYS AT ALL, which is a different
 * answer and the whole reason this is a function.
 *
 * ── the silence a `select` must not invent ────────────────────────────────
 *
 * `passDriftSince` reports nothing for a row carrying none of the four keys,
 * so that a read which never asked about passes cannot produce movement lines.
 * The moment the select above asks for the columns, that guard stops firing on
 * its own — every row would carry all four keys — and every close filed before
 * supabase/parts/2970 would start reading as a month whose passes had moved.
 * Those rows are not that. They are closes that RECORDED NOTHING about the
 * passes, which is exactly what the part says of them in as many words: "NULL
 * on a row written before this part means 'this close did not record the
 * passes', which is precisely what happened."
 *
 * So the row itself says which it is, and the rule is the only one the four
 * columns can support: all four null is a close that said nothing about the
 * passes, and it is handed on ABSENT. Anything else is a close that spoke, and
 * every one of its four values travels, nulls included.
 *
 * A month whose passes were read and had nothing in them is NOT caught by
 * this: it files `passesSold: 0` and `passesPriced: 0` beside a null figure,
 * and 0 is not null. That is the distinction the house rule is about in both
 * directions — 0 is never the answer for an unknown, and an unknown is never
 * quietly promoted to 0. The test is `== null` per field and never truthiness,
 * because `if (!sold)` here would file a real, counted, empty month as a month
 * nobody read.
 *
 * The case this rule cannot separate is a close written AFTER the part whose
 * passes slice failed — it also stores four nulls, and it also means "this
 * close could not speak for the passes". Two identical facts, read identically,
 * which is why one rule is enough: null means nobody can say, and nothing that
 * cannot be said is reported as movement.
 */
function passColumnsOf(r: any): {
  passCents?: number | null;
  passCurrency?: string | null;
  passesSold?: number | null;
  passesPriced?: number | null;
} {
  const passCents = numOrNull(r.pass_cents);
  const passCurrency = r.pass_currency ?? null;
  const passesSold = numOrNull(r.passes_sold);
  const passesPriced = numOrNull(r.passes_priced);
  if (passCents == null && passCurrency == null && passesSold == null && passesPriced == null) {
    return {};
  }
  return { passCents, passCurrency, passesSold, passesPriced };
}

/** The close currently in force for a month, or null if the month is open. */
export function liveCloseFor(monthKey: string, rows: MonthCloseRow[] | null): MonthCloseRow | null {
  return (rows ?? []).find((r) => r.monthKey === monthKey && !r.reopenedAt) ?? null;
}

/**
 * What the record says now, against what was stored when the month was closed.
 *
 * This is the whole reason for snapshotting. A closed month whose live figures
 * have since moved is not an error — a refund recorded in September correctly
 * changes what September's ledger says about an August payment — but it IS
 * something the person holding last month's filed figure has to be told, and
 * before this there was no way to know it had happened.
 *
 * Returns one line per figure that has moved, in the words of the tile it came
 * from. An empty array means the month reads today exactly as it read when it
 * was closed.
 *
 * ── each side is priced in its OWN money ──────────────────────────────────
 *
 * `fmt` took cents alone, so /close closed over one code and printed all eight
 * amounts in it — the same single-currency assumption that produced the stored
 * row this function reads. Now it takes the currency too, and each side of each
 * comparison is formatted in the currency THAT side was recorded in.
 *
 * A CHANGE OF CURRENCY is itself a drift line, and it is the one this could
 * previously not see at all: `was === is` returned early, so a payroll figure of
 * 180,000 recorded in GBP and reading 180,000 in EUR today — a gym that changed
 * `tenants.currency`, or a coach re-rated in another money — reported that the
 * month had not moved. The number had not. The money had.
 */
export function driftSince(
  stored: MonthCloseRow, now: CloseSnapshot,
  fmt: (cents: number | null, currency: string | null) => string,
): string[] {
  const out: string[] = [];
  const check = (
    label: string,
    was: number | null, wasCcy: string | null,
    is: number | null, isCcy: string | null,
  ) => {
    if (was === is && wasCcy === isCcy) return;
    // One side unknown is still a difference worth naming, and naming it needs
    // the words rather than a dash: "was 4,200.00, is now not known" is a
    // sentence, and "4,200.00 → —" is a puzzle.
    out.push(`${label} was ${was == null ? 'not known' : fmt(was, wasCcy)} at the close and is ${is == null ? 'not known' : fmt(is, isCcy)} now.`);
  };
  // The stored side reads its own per-figure column, falling back for `Taken`
  // alone to the legacy single code — which was derived payments-first and so
  // is the one figure it can honestly speak for. See `MonthCloseRow.currency`.
  check('Taken', stored.takenCents, stored.takenCurrency ?? stored.currency, now.takenCents, now.takenCurrency);
  check('Billed', stored.invoicedCents, stored.invoicedCurrency, now.invoicedCents, now.invoicedCurrency);
  check('Still owed', stored.outstandingCents, stored.outstandingCurrency, now.outstandingCents, now.outstandingCurrency);
  check('Payroll', stored.payrollCents, stored.payrollCurrency, now.payrollCents, now.payrollCurrency);
  // The PASS figure is deliberately not checked here. `now` carries it — a
  // `CloseSnapshot` holds all five figures — but `passDriftSince` in
  // src/lib/ownerClose.ts is what compares it, because only that function
  // holds the absent-versus-null guard a pre-2970 row needs, and it words a
  // null as "not a single amount" rather than "not known". `filingOf` appends
  // its lines to these; checking the passes in both places would report every
  // movement in them twice.
  if (stored.unmarkedSessions !== now.unmarkedSessions) {
    out.push(`${stored.unmarkedSessions ?? 'An unknown number of'} session(s) were unmarked at the close; ${now.unmarkedSessions ?? 'an unknown number'} are now.`);
  }
  return out;
}

/* ── writes ────────────────────────────────────────────────────────────────── */

/**
 * Close a month.
 *
 * The unique index in supabase/parts/182 is what actually guarantees one live
 * close per month; `closeBlocker` above is the courtesy that says so before the
 * round trip. Two owners closing August in two tabs produce one close and one
 * 23505, which is the right outcome — the second is told, rather than a second
 * close quietly appearing beside the first with different figures on it.
 */
export async function closeMonth(
  sb: Queryable,
  tenantId: string,
  monthKey: string,
  snap: CloseSnapshot,
  closedBy: string | null,
  note: string | null,
): Promise<void> {
  const { error } = await sb.from('gym_month_closes').insert({
    tenant_id: tenantId,
    month_key: monthKey,
    closed_by: closedBy,
    note: note?.trim() || null,
    taken_cents: snap.takenCents,
    invoiced_cents: snap.invoicedCents,
    outstanding_cents: snap.outstandingCents,
    payroll_cents: snap.payrollCents,
    // One code per figure — supabase/parts/2540. `currency` is written NULL
    // rather than omitted, so a reader of the row can tell a close written
    // since the split from one written before it without a join to anything.
    taken_currency: snap.takenCurrency,
    invoiced_currency: snap.invoicedCurrency,
    outstanding_currency: snap.outstandingCurrency,
    payroll_currency: snap.payrollCurrency,
    currency: snap.currency,
    // The fifth figure — supabase/parts/2970. All four go in, and the counts
    // go in even when the money does not: a month whose priced passes span two
    // currencies files `pass_cents` null beside a real `passes_sold`, because
    // two moneys cannot be added and the number of passes sold is still a
    // fact. A 0 there would claim the gym sold nothing, which is false in the
    // one direction an accountant cannot detect — a zero reconciles against an
    // absence and nobody goes looking. The database refuses the shape that
    // cannot be true (`pass_cents` over no priced passes) and deliberately
    // permits cents with no code, which is one unknown unit, not two known
    // ones.
    pass_cents: snap.passCents,
    pass_currency: snap.passCurrency,
    passes_sold: snap.passesSold,
    passes_priced: snap.passesPriced,
    unmarked_sessions: snap.unmarkedSessions,
    blockers_at_close: snap.blockersAtClose,
  });
  if (error) throw error;
}

/**
 * Reopen a month, with a reason.
 *
 * The COUNT is checked, not `error` alone — see src/lib/wroteRows.ts. A refused
 * UPDATE is a 204 with a null error, and the screen would then say the month is
 * open while the trigger in supabase/parts/182 is still refusing every payment
 * written into it. The owner would take that as the desk being broken.
 */
export async function reopenMonth(
  sb: Queryable, closeId: string, reason: string, by: string | null,
): Promise<void> {
  const r = await sb.from('gym_month_closes')
    .update({ reopened_at: new Date().toISOString(), reopened_by: by, reopen_reason: reason.trim() }, { count: 'exact' })
    .eq('id', closeId)
    .is('reopened_at', null);
  if (r.error) throw r.error;
  assertWrote('Reopening that month', r);
}

function numOrNull(v: unknown): number | null {
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

/**
 * Who closed and who reopened each month, by id.
 *
 * CHUNKED, about the REQUEST LINE and not the row ceiling. `fetchCloses` reads
 * up to `capLimit()` rows and this is handed TWO ids off each of them, so up to
 * two thousand uuids arrive; at about 39 bytes each inside `in.("…","…")` that
 * is a ~78KB query string against the 8KB request line nginx and most CDNs
 * enforce by default. The refusal is a **414**, supabase-js does not reject on
 * it, and it arrives as `data: null`.
 *
 * no-error-ok (about the ROW ceiling — one row per id, 150 ids a chunk): an
 * unreadable name renders as a dash beside the close; the close itself is still
 * recorded. What that does not cover is every name going at once on a month-end
 * history, which is the record an auditor reads to see who signed off what.
 */
async function namesFor(sb: Queryable, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  let rows: any[] = [];
  try {
    rows = await readByIds<any>(
      ids,
      (chunk, from, to) => sb.from('profiles').select('id, full_name')
        .in('id', chunk).order('id', { ascending: true }).range(from, to),
      'the names of the people who closed these months',
    );
  } catch { return new Map(); }
  return new Map(rows
    .map((p: any) => [p.id, (p.full_name || '').trim()] as [string, string])
    .filter(([, n]: [string, string]) => !!n));
}
