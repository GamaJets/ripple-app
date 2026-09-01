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
// Every figure is NULLABLE and so is the currency, because every one of them is
// nullable on screen. A month whose invoice read failed, or a gym that has not
// set a currency, produces a close with holes in it, and a close that turned
// those into zeros to satisfy a NOT NULL would be storing the exact lie the
// whole screen is built to refuse.
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

import { assertWrote } from './wroteRows';
import { capLimit } from './rowCap';
import type { MonthClose } from './monthEnd';

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
  currency: string | null;
  unmarkedSessions: number | null;
  blockersAtClose: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
}

/** What is written when a month is closed. Every figure may be absent. */
export interface CloseSnapshot {
  takenCents: number | null;
  invoicedCents: number | null;
  outstandingCents: number | null;
  payrollCents: number | null;
  currency: string | null;
  unmarkedSessions: number | null;
  blockersAtClose: string | null;
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
export function snapshotOf(c: MonthClose, currency: string | null): CloseSnapshot {
  const invoiced = c.owed
    ? sumOrNull(c.owed.settledCents, c.owed.outstandingCents)
    : null;
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
    payrollCents: c.payroll ? c.payroll.total.cents : null,
    currency: currency ?? null,
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
 */
export async function fetchCloses(sb: Queryable, tenantId: string): Promise<MonthCloseRow[]> {
  const { data, error } = await sb
    .from('gym_month_closes')
    .select('id, month_key, closed_at, closed_by, note, taken_cents, invoiced_cents, outstanding_cents, payroll_cents, currency, unmarked_sessions, blockers_at_close, reopened_at, reopened_by, reopen_reason')
    .eq('tenant_id', tenantId)
    .order('month_key', { ascending: false })
    .order('closed_at', { ascending: false })
    .limit(capLimit());
  if (error) throw error;

  const rows = (data ?? []) as any[];
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
    currency: r.currency ?? null,
    unmarkedSessions: numOrNull(r.unmarked_sessions),
    blockersAtClose: r.blockers_at_close ?? null,
    reopenedAt: r.reopened_at ?? null,
    reopenedBy: r.reopened_by ?? null,
    reopenedByName: r.reopened_by ? names.get(r.reopened_by) ?? null : null,
    reopenReason: r.reopen_reason ?? null,
  }));
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
 */
export function driftSince(
  stored: MonthCloseRow, now: CloseSnapshot, fmt: (cents: number | null) => string,
): string[] {
  const out: string[] = [];
  const check = (label: string, was: number | null, is: number | null) => {
    if (was === is) return;
    // One side unknown is still a difference worth naming, and naming it needs
    // the words rather than a dash: "was 4,200.00, is now not known" is a
    // sentence, and "4,200.00 → —" is a puzzle.
    out.push(`${label} was ${was == null ? 'not known' : fmt(was)} at the close and is ${is == null ? 'not known' : fmt(is)} now.`);
  };
  check('Taken', stored.takenCents, now.takenCents);
  check('Billed', stored.invoicedCents, now.invoicedCents);
  check('Still owed', stored.outstandingCents, now.outstandingCents);
  check('Payroll', stored.payrollCents, now.payrollCents);
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
    currency: snap.currency,
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

async function namesFor(sb: Queryable, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  // no-error-ok: an unreadable name renders as a dash beside the close; the close itself is still recorded
  const { data } = await sb.from('profiles').select('id, full_name').in('id', unique).limit(capLimit());
  return new Map((data ?? [])
    .map((p: any) => [p.id, (p.full_name || '').trim()] as [string, string])
    .filter(([, n]: [string, string]) => !!n));
}
