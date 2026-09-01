// What a gym pays its own coaches — per session, per class, and everything
// that is neither.
//
// Three gaps close here and they are one piece of work because they are one
// payroll run.
//
// ── Every coach was paid the same ─────────────────────────────────────────
//
// `payroll30For` in src/lib/gymTrainers.ts multiplies delivered sessions by a
// single `tenants.session_fee`, so a coach of fifteen years and a trainee in
// their first month are worth an identical amount to the payroll screen, and
// /payroll offers no override anywhere.
//
// `trainers.session_fee` is NOT the missing value and must never be read as it.
// supabase/parts/23 added it as part of the public directory — tagline, offers,
// specialties, session_fee, listed — and it is what a coach CHARGES a client
// for private work booked through the app. Reading it as what the gym pays them
// would take a coach's own price list and hand it to their employer's payroll
// run: a different number, usually a bigger one, and not the gym's to use.
//
// ── Teaching a class was unpaid by the system ─────────────────────────────
//
// `payroll_settlements` links to `sessions` and nothing else, so a trainer who
// taught twelve classes and covered twenty floor hours is owed nothing this
// product can compute. app/(owner)/class-analytics.tsx holds the per-attendee
// rate in `useState` and says on screen that "nothing is paid from this screen",
// which is honest and is the whole problem.
//
// ── A run could not be undone or adjusted ─────────────────────────────────
//
// `recordSettlement` is insert-only. Pressing "Mark as paid" before the money
// moves stamps every session in the run permanently and drops them out of "Owed
// now", and the only way back is editing rows in the Supabase dashboard.
//
// ── The rate that applies, and the order it is looked for ─────────────────
//
// Three layers, most specific first, and the order matters more than any single
// layer:
//
//   1. `sessions.rate_cents` — snapshotted when the outcome was marked. This is
//      what was AGREED for that session and nothing may override it. It is why
//      a rate rise in March does not retroactively repay January.
//   2. `gym_trainer_pay.session_rate_cents` — what this gym pays this coach,
//      today, for a session that carries no snapshot.
//   3. `tenants.session_fee` — the gym's standing figure, which is what
//      everything used before this file existed.
//
// A null at every layer means the session is UNPRICED, which is not free.
// `payrollTotal` in src/lib/gymSessions.ts already refuses to answer over
// unpriced work and `settlementBlocker` says so; nothing here weakens that.

import { assertWhole, capLimit } from './rowCap';
import { assertWrote } from './wroteRows';
import type { PtSession } from './gymSessions';

type Queryable = { from: (table: string) => any };

/* ── what the gym pays one coach ───────────────────────────────────────────── */

export type ClassPayKind = 'per_class' | 'per_attendee';

export const CLASS_PAY_LABEL: Record<ClassPayKind, string> = {
  per_class: 'A flat amount for the class',
  per_attendee: 'An amount for each person who turned up',
};

export interface TrainerPay {
  trainerId: string;
  /** Minor units. Null means this gym has not set a rate for this coach, which
   *  falls back to the gym's session fee — NOT zero, which would be a claim. */
  sessionRateCents: number | null;
  classPayKind: ClassPayKind | null;
  classRateCents: number | null;
  /** What both rates are in. Never inherited from `tenants.currency` at read
   *  time: a gym that changes its currency must not retroactively re-denominate
   *  what it agreed to pay somebody. */
  currency: string | null;
  updatedAt: string | null;
}

export type PayIndex = Map<string, TrainerPay>;

/**
 * The rate that applies to one session, in minor units, or null when nobody has
 * priced it.
 *
 * The whole of the three-layer rule, in one place, so that `payrollByTrainer`,
 * `settleableSessions` and `settlementAmount` cannot each hold a different
 * opinion of what "priced" means. They already did once: `settleableSessions`
 * required `rateCents != null` while `payrollByTrainer` was pricing the same
 * sessions off the gym fee, so the screen said AED 1,500 owed and the button
 * said "nothing outstanding" — and on a mixed month there was no blocker at
 * all, the screen said 1,500 and settling handed over 900. This is the shape
 * that prevents the third version of that.
 */
export function rateForSession(
  s: Pick<PtSession, 'rateCents' | 'trainerId'>,
  pay: PayIndex,
  gymFeeCents: number | null,
): number | null {
  if (s.rateCents != null) return s.rateCents;
  const own = s.trainerId ? pay.get(s.trainerId)?.sessionRateCents : null;
  if (own != null) return own;
  return gymFeeCents;
}

/**
 * The same sessions with the effective rate written onto each one.
 *
 * This exists rather than a `perTrainerRate` argument threaded through
 * `payrollByTrainer`, `settleableSessions` and `settlementAmount` because those
 * three have ALREADY disagreed about what "priced" means once, and the
 * consequence was a screen saying AED 1,500 owed while the button handed over
 * 900 and stamped the sessions as paid. Three functions with three copies of a
 * three-layer fallback is that bug waiting for its third outing.
 *
 * Resolving once, up front, means every one of them sees the same number
 * because they are all reading the same field. Nothing is written to the
 * database: `sessions.rate_cents` still holds only what was snapshotted at
 * delivery, and a session priced here off a trainer's current rate is priced
 * off it every time this screen loads until somebody settles it — at which
 * point `recordSettlement` snapshots the amount that was actually handed over.
 *
 * The objects are copies. Mutating the caller's rows would leave a screen
 * showing a rate the record does not hold, which is exactly the confusion
 * `sessions.rate_cents` exists to prevent.
 */
export function withResolvedRates(
  sessions: PtSession[], pay: PayIndex, gymFeeCents: number | null,
): PtSession[] {
  return sessions.map((s) => {
    const rate = rateForSession(s, pay, gymFeeCents);
    return rate === s.rateCents ? s : { ...s, rateCents: rate };
  });
}

/**
 * The one currency a set of pay rates agrees on, or null.
 *
 * A gym paying one coach in GBP and another in EUR has no single payroll total,
 * and the screen must say so rather than adding them. A coach with no rate set
 * states nothing and does not disagree — they fall back to the gym's fee, which
 * is denominated in the gym's own currency.
 */
export function payCurrency(rates: TrainerPay[], gymCurrency: string | null): string | null {
  const stated = new Set(
    rates.map((r) => (r.currency ?? '').trim().toUpperCase()).filter((c) => !!c),
  );
  if (stated.size === 0) return gymCurrency;
  if (stated.size > 1) return null;
  const only = [...stated][0];
  // A gym whose stated rates are in one currency and whose own currency is
  // another is a real disagreement, not a fallback. Two answers, so neither.
  if (gymCurrency && gymCurrency !== only) return null;
  return only;
}

export async function fetchTrainerPay(sb: Queryable, tenantId: string): Promise<PayIndex> {
  const { data, error } = await sb
    .from('gym_trainer_pay')
    .select('trainer_id, session_rate_cents, class_pay_kind, class_rate_cents, currency, updated_at')
    .eq('tenant_id', tenantId)
    .limit(capLimit());
  if (error) throw error;
  const out: PayIndex = new Map();
  // Capped and refusing. A truncated read here does not make payroll smaller in
  // a visible way — it silently drops the coaches whose rows fell off the end
  // back onto the gym's standard fee, which for a senior coach is a smaller
  // payslip that looks exactly like a correct one.
  for (const r of assertWhole(data, "this gym's pay rates") as any[]) {
    out.set(r.trainer_id, {
      trainerId: r.trainer_id,
      sessionRateCents: numOrNull(r.session_rate_cents),
      classPayKind: r.class_pay_kind === 'per_class' || r.class_pay_kind === 'per_attendee' ? r.class_pay_kind : null,
      classRateCents: numOrNull(r.class_rate_cents),
      currency: (r.currency ?? '').trim().toUpperCase() || null,
      updatedAt: r.updated_at ?? null,
    });
  }
  return out;
}

/** Why a rate cannot be saved, or null when it can. */
export function payRateBlocker(
  sessionRate: string, classRate: string, classKind: ClassPayKind | '', currency: string | null,
): string | null {
  const s = parseRate(sessionRate);
  if (s.kind === 'bad') return `Session rate: ${s.reason}`;
  const c = parseRate(classRate);
  if (c.kind === 'bad') return `Class rate: ${c.reason}`;
  if (c.kind === 'rate' && classKind === '') {
    return 'Say how the class rate is counted — a flat amount for the class, or an amount per person. "80" and "8 a head" are the same number of digits and completely different money.';
  }
  if (c.kind === 'clear' && classKind !== '') {
    return 'A way of counting class pay with no rate beside it pays nothing. Enter the rate, or clear the counting method.';
  }
  if ((s.kind === 'rate' || c.kind === 'rate') && !currency) {
    return 'This gym has not set its currency, so a rate cannot say what money it is in — and a rate is what somebody is actually paid.';
  }
  return null;
}

export type RateInput =
  | { kind: 'clear' }
  | { kind: 'rate'; cents: number }
  | { kind: 'bad'; reason: string };

/**
 * A rate as typed, in whole units → minor units.
 *
 * Empty CLEARS, and zero is a value. That distinction is the same one
 * `parseSessionFee` in src/lib/gymSettings.ts makes and it matters more here:
 * clearing means "this coach is on the gym's standard fee", and zero means "the
 * gym pays this coach nothing per session", which is a claim somebody has to
 * make deliberately — a volunteer, an owner coaching their own clients — and
 * which must not be reachable by tabbing past an empty box.
 */
export function parseRate(input: string | null | undefined): RateInput {
  const raw = String(input ?? '').trim().replace(/[,\s]/g, '');
  if (!raw) return { kind: 'clear' };
  const bare = raw.replace(/^[^\d.-]+/, '');
  if (/-/.test(raw)) return { kind: 'bad', reason: 'A rate cannot be negative. A deduction is an adjustment line, not a rate.' };
  if (!/^\d+(\.\d{1,2})?$/.test(bare)) {
    return { kind: 'bad', reason: 'Enter it as a number — 45, or 52.50. Leave it empty for the gym’s standard fee.' };
  }
  const cents = Math.round(Number(bare) * 100);
  if (!Number.isFinite(cents) || cents > 2_147_483_647) {
    return { kind: 'bad', reason: 'That is more than Repple will record as a rate — check the zeros.' };
  }
  return { kind: 'rate', cents };
}

/**
 * Store what this gym pays this coach.
 *
 * An upsert on the unique index, with the conflict target named. PostgREST
 * defaults to the primary key, which never collides, so an unnamed upsert would
 * write a second rate row for the same coach every time the owner pressed Save
 * — and `fetchTrainerPay` would then return whichever of them the database felt
 * like ordering first.
 */
export async function saveTrainerPay(
  sb: Queryable,
  tenantId: string,
  p: {
    trainerId: string;
    sessionRateCents: number | null;
    classPayKind: ClassPayKind | null;
    classRateCents: number | null;
    currency: string | null;
    updatedBy: string | null;
  },
): Promise<void> {
  const { error } = await sb.from('gym_trainer_pay').upsert({
    tenant_id: tenantId,
    trainer_id: p.trainerId,
    session_rate_cents: p.sessionRateCents,
    class_pay_kind: p.classPayKind,
    class_rate_cents: p.classRateCents,
    // A row with no amounts on it carries no currency either, which is what the
    // `gym_trainer_pay_amount_has_currency` constraint requires and is also the
    // honest state: nothing has been priced, so nothing is denominated.
    currency: p.sessionRateCents == null && p.classRateCents == null ? null : p.currency,
    updated_at: new Date().toISOString(),
    updated_by: p.updatedBy,
  }, { onConflict: 'tenant_id,trainer_id' });
  if (error) throw error;
}

/* ── class teaching ────────────────────────────────────────────────────────── */

export interface ClassPayLine {
  id: string;
  classId: string;
  trainerId: string;
  trainerName: string | null;
  payKind: ClassPayKind;
  rateCents: number;
  attendees: number | null;
  amountCents: number;
  currency: string;
  settlementId: string | null;
  createdAt: string;
}

/**
 * What one taught class is worth, in minor units, or null when it cannot be
 * priced.
 *
 * A per-attendee class with an unknown register is NULL, not zero. The
 * distinction is the whole reason this returns nullable: a class nobody took a
 * register for has an unknown headcount, and paying it at zero would be the
 * product deciding a coach taught to an empty room because the paperwork is
 * missing. `attendees === 0` is a real answer — an empty class — and pays zero.
 */
export function classPayAmount(
  kind: ClassPayKind, rateCents: number, attendees: number | null,
): number | null {
  if (!Number.isFinite(rateCents) || rateCents < 0) return null;
  if (kind === 'per_class') return rateCents;
  if (attendees == null || !Number.isFinite(attendees) || attendees < 0) return null;
  return rateCents * attendees;
}

/** Why a class cannot be added to the payroll, or null when it can. */
export function classPayBlocker(
  pay: TrainerPay | undefined, attendees: number | null, already: boolean,
): string | null {
  if (already) return 'This class is already on a payroll line for this coach.';
  if (!pay || pay.classRateCents == null || pay.classPayKind == null) {
    return 'This gym has not said what it pays this coach to teach, so there is no rate to apply. Set one on Payroll.';
  }
  if (!pay.currency) {
    return 'The rate for this coach states no currency, so what they are owed cannot be written down.';
  }
  if (pay.classPayKind === 'per_attendee' && attendees == null) {
    return 'This class is paid per person and nobody took a register, so the headcount is unknown. Paying it at nought would say the coach taught to an empty room because the paperwork is missing.';
  }
  return null;
}

export async function fetchClassPay(
  sb: Queryable, tenantId: string,
): Promise<ClassPayLine[]> {
  const { data, error } = await sb
    .from('gym_class_pay')
    .select('id, class_id, trainer_id, pay_kind, rate_cents, attendees, amount_cents, currency, settlement_id, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  const rows = assertWhole(data, 'the class pay lines') as any[];
  if (!rows.length) return [];
  const names = await namesFor(sb, rows.map((r) => r.trainer_id));
  return rows.map((r) => ({
    id: r.id,
    classId: r.class_id,
    trainerId: r.trainer_id,
    trainerName: names.get(r.trainer_id) ?? null,
    payKind: r.pay_kind === 'per_attendee' ? 'per_attendee' : 'per_class',
    rateCents: Number(r.rate_cents) || 0,
    attendees: numOrNull(r.attendees),
    amountCents: Number(r.amount_cents) || 0,
    currency: r.currency,
    settlementId: r.settlement_id ?? null,
    createdAt: r.created_at,
  }));
}

/**
 * Put one taught class onto the payroll.
 *
 * Everything is snapshotted — the kind, the rate, the headcount and the amount
 * — and never recomputed. A rate changed in March must not rewrite what a coach
 * was paid in January, which is the same reasoning as `sessions.rate_cents` and
 * `payroll_settlements.amount_cents`, and a register corrected afterwards must
 * not silently change a figure somebody has already been paid.
 */
export async function addClassPay(
  sb: Queryable,
  tenantId: string,
  line: {
    classId: string; trainerId: string; payKind: ClassPayKind;
    rateCents: number; attendees: number | null; amountCents: number;
    currency: string; createdBy: string | null;
  },
): Promise<void> {
  const { error } = await sb.from('gym_class_pay').insert({
    tenant_id: tenantId,
    class_id: line.classId,
    trainer_id: line.trainerId,
    pay_kind: line.payKind,
    rate_cents: line.rateCents,
    attendees: line.payKind === 'per_attendee' ? line.attendees : null,
    amount_cents: line.amountCents,
    currency: line.currency,
    created_by: line.createdBy,
  });
  if (error) throw error;
}

/* ── adjustments ───────────────────────────────────────────────────────────── */

export type AdjustmentKind = 'bonus' | 'deduction' | 'reimbursement' | 'advance';

export const ADJUSTMENT_KINDS: readonly AdjustmentKind[] =
  ['bonus', 'deduction', 'reimbursement', 'advance'] as const;

/**
 * What each kind means, and it is not four words for two signs.
 *
 * A reimbursement is the gym paying back money the coach spent; a bonus is pay.
 * Both add, and a payslip that called one the other would be wrong in a way
 * that matters to whoever files it — one is taxable and one is not.
 */
export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = {
  bonus: 'Bonus — extra pay',
  deduction: 'Deduction — taken off pay',
  reimbursement: 'Reimbursement — money they spent, paid back',
  advance: 'Advance — pay already handed over',
};

/**
 * The sign the kind implies, never typed.
 *
 * A screen that asks somebody to enter a negative number will one day be handed
 * a positive one, and a deduction of 50 recorded as +50 is a coach paid a
 * hundred more than they should have been. supabase/parts/183 enforces the same
 * rule at the database, so the two say it independently.
 */
export function adjustmentSign(kind: AdjustmentKind): 1 | -1 {
  return kind === 'deduction' || kind === 'advance' ? -1 : 1;
}

export interface Adjustment {
  id: string;
  trainerId: string;
  trainerName: string | null;
  kind: AdjustmentKind;
  /** Signed minor units — negative for a deduction or an advance. */
  amountCents: number;
  currency: string;
  note: string;
  appliesOn: string;
  settlementId: string | null;
}

/** Why an adjustment cannot be recorded, or null. */
export function adjustmentBlocker(amount: string, note: string, currency: string | null): string | null {
  const r = parseRate(amount);
  if (r.kind === 'bad') return r.reason;
  if (r.kind === 'clear') return 'Enter the amount, as a positive number. Repple applies the minus for a deduction or an advance.';
  if (r.cents === 0) return 'An adjustment of nothing changes nothing. Leave it off the run instead.';
  if (!note.trim()) {
    return 'Say what this is for. An adjustment with no reason on it is the line a coach queries and nobody can answer.';
  }
  if (!currency) return 'This gym has not set its currency, so an adjustment cannot say what money it is in.';
  return null;
}

export async function fetchAdjustments(sb: Queryable, tenantId: string): Promise<Adjustment[]> {
  const { data, error } = await sb
    .from('payroll_adjustments')
    .select('id, trainer_id, kind, amount_cents, currency, note, applies_on, settlement_id')
    .eq('tenant_id', tenantId)
    .order('applies_on', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  const rows = assertWhole(data, 'the payroll adjustments') as any[];
  if (!rows.length) return [];
  const names = await namesFor(sb, rows.map((r) => r.trainer_id));
  return rows.map((r) => ({
    id: r.id,
    trainerId: r.trainer_id,
    trainerName: names.get(r.trainer_id) ?? null,
    kind: (ADJUSTMENT_KINDS as readonly string[]).includes(r.kind) ? r.kind : 'bonus',
    amountCents: Number(r.amount_cents) || 0,
    currency: r.currency,
    note: r.note,
    appliesOn: r.applies_on,
    settlementId: r.settlement_id ?? null,
  }));
}

export async function addAdjustment(
  sb: Queryable,
  tenantId: string,
  a: {
    trainerId: string; kind: AdjustmentKind; amountCents: number;
    currency: string; note: string; appliesOn: string; createdBy: string | null;
  },
): Promise<void> {
  const { error } = await sb.from('payroll_adjustments').insert({
    tenant_id: tenantId,
    trainer_id: a.trainerId,
    kind: a.kind,
    // The sign comes from the kind. `Math.abs` first, so a caller that already
    // applied it cannot produce a positive deduction by applying it twice.
    amount_cents: Math.abs(a.amountCents) * adjustmentSign(a.kind),
    currency: a.currency,
    note: a.note.trim(),
    applies_on: a.appliesOn,
    created_by: a.createdBy,
  });
  if (error) throw error;
}

/* ── what a run comes to ───────────────────────────────────────────────────── */

export interface RunLines {
  sessionCents: number | null;
  sessions: number;
  classCents: number;
  classes: number;
  adjustmentCents: number;
  adjustments: number;
}

/**
 * The three parts of one coach's run, added up, or null where a part cannot be.
 *
 * `sessionCents` is nullable and the other two are not, and that asymmetry is
 * real: a session can be unpriced, and `payrollTotal` already refuses over one.
 * A class pay line and an adjustment both carry a snapshotted amount by
 * construction — they cannot exist unpriced — so a zero there is a genuine zero.
 *
 * The TOTAL is null whenever the session half is, because a run that pays for
 * classes and cannot price the sessions is not a smaller run, it is one nobody
 * should hand over.
 */
export function runTotal(l: RunLines): number | null {
  if (l.sessionCents == null) return null;
  return l.sessionCents + l.classCents + l.adjustmentCents;
}

/**
 * Why a run cannot be settled, beyond what `settleBlocker` already says.
 *
 * One rule, and it is about currency: a coach whose class rate is in EUR and
 * whose gym pays in GBP has two amounts that cannot be added. Every other
 * refusal on a payroll run is about sessions and lives in
 * src/lib/gymSessions.ts.
 */
export function runCurrencyBlocker(parts: Array<string | null>): string | null {
  const seen = new Set(parts.filter((c): c is string => !!c).map((c) => c.toUpperCase()));
  if (seen.size > 1) {
    return `This run mixes ${[...seen].sort().join(' and ')}. Adding them is not a total, and no rate here converts one into the other.`;
  }
  return null;
}

/* ── taking a run back ─────────────────────────────────────────────────────── */

/**
 * Undo a payroll run.
 *
 * Four writes, in this order, and the order is the whole safety argument:
 *
 *   1. unstamp the sessions
 *   2. unstamp the class pay lines
 *   3. unstamp the adjustments
 *   4. mark the settlement reversed
 *
 * If any of the first three fails, the settlement is still standing and the run
 * is still recorded as paid — wrong, visible, and repeatable by pressing the
 * button again. The other order would mark the run reversed while its sessions
 * were still stamped against it: they would be excluded from "Owed now"
 * forever, so a coach would silently never be paid for them, and the run that
 * was supposed to have paid them says it did not.
 *
 * The settlement row is never deleted. It is a statement somebody made that
 * money went out; deleting it leaves neither the statement nor the withdrawal.
 */
export async function reverseSettlement(
  sb: Queryable, settlementId: string, reason: string, by: string | null,
): Promise<void> {
  const s = await sb.from('sessions')
    .update({ settlement_id: null }, { count: 'exact' })
    .eq('settlement_id', settlementId);
  if (s.error) throw s.error;

  const c = await sb.from('gym_class_pay')
    .update({ settlement_id: null }, { count: 'exact' })
    .eq('settlement_id', settlementId);
  if (c.error) throw c.error;

  const a = await sb.from('payroll_adjustments')
    .update({ settlement_id: null }, { count: 'exact' })
    .eq('settlement_id', settlementId);
  if (a.error) throw a.error;

  const r = await sb.from('payroll_settlements')
    .update({
      reversed_at: new Date().toISOString(),
      reversed_by: by,
      reverse_reason: reason.trim(),
    }, { count: 'exact' })
    .eq('id', settlementId)
    .is('reversed_at', null);
  if (r.error) throw r.error;
  // Counted, and this is the one that matters most. `settlements_owner` filters
  // rather than refuses, so an update matching nothing returns 204 with a null
  // error — and the screen would say the run was taken back while it still
  // stands, with its sessions now unstamped and payable a SECOND time.
  assertWrote('Reversing that settlement', r);
}

/** Why a reversal cannot be recorded, or null. */
export function reversalReasonBlocker(reason: string): string | null {
  if (!reason.trim()) {
    return 'Say why this run is being taken back. A settlement that was recorded and then withdrawn is two facts a coach is entitled to see, and the reason is the second one.';
  }
  return null;
}

/**
 * Stamp class lines and adjustments onto a settlement that has just been
 * recorded.
 *
 * Separate from `recordSettlement` in src/lib/gymSessions.ts rather than folded
 * into it, because that function is shared with the phone app and knows only
 * about sessions. Called immediately after it, with the id it returns.
 *
 * A PARTIAL stamp is reported rather than swallowed, exactly as
 * `recordSettlement` reports a partial session stamp: the unstamped remainder
 * is silently payable a second time, which is the expensive direction.
 */
export async function stampRunExtras(
  sb: Queryable, settlementId: string, classPayIds: string[], adjustmentIds: string[],
): Promise<void> {
  if (classPayIds.length) {
    const r = await sb.from('gym_class_pay')
      .update({ settlement_id: settlementId }, { count: 'exact' })
      .in('id', classPayIds);
    if (r.error) throw r.error;
    if ((r as { count?: number | null }).count !== classPayIds.length) {
      throw new Error(
        `The settlement was recorded, but only ${(r as { count?: number | null }).count ?? 0} of ${classPayIds.length} class pay lines were stamped against it. The rest are still shown as unpaid and could be settled twice.`,
      );
    }
  }
  if (adjustmentIds.length) {
    const r = await sb.from('payroll_adjustments')
      .update({ settlement_id: settlementId }, { count: 'exact' })
      .in('id', adjustmentIds);
    if (r.error) throw r.error;
    if ((r as { count?: number | null }).count !== adjustmentIds.length) {
      throw new Error(
        `The settlement was recorded, but only ${(r as { count?: number | null }).count ?? 0} of ${adjustmentIds.length} adjustments were stamped against it. The rest are still shown as unpaid and could be settled twice.`,
      );
    }
  }
}

function numOrNull(v: unknown): number | null {
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

async function namesFor(sb: Queryable, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  // no-error-ok: an unreadable name renders as a dash; the amount it labels is still real
  const { data } = await sb.from('profiles').select('id, full_name').in('id', unique).limit(capLimit());
  return new Map((data ?? [])
    .map((p: any) => [p.id, (p.full_name || '').trim()] as [string, string])
    .filter(([, n]: [string, string]) => !!n));
}
