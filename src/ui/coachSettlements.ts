// The four reads behind what a gym has settled for the coach reading them.
//
// The impure half of src/lib/coachSettlements.ts, which holds every decision
// about what an empty answer means. The split is the one every tested module in
// src/lib follows: that file imports nothing that reaches a network and is run
// by `npm test`; this one reaches Supabase and therefore cannot be.
//
// ── The permission already existed. Nothing had ever used it ──────────────
//
// All four tables carry a policy written so the coach can read their own row,
// and `grep -rl payroll_settlements 'app/(trainer)'` returned nothing:
//
//   `payroll_settlements`  settlements_trainer_read — trainer_id = auth.uid()
//   `payroll_adjustments`  payroll_adjustments_self_r — same shape
//   `gym_class_pay`        gym_class_pay_self_r — same shape
//   `sessions`             sessions_trainer — FOR ALL on trainer_id = auth.uid()
//
// Every filter below RESTATES the policy rather than trusting it, for the
// reason src/ui/coachPayTerms.ts gives: a read scoped only by RLS is a read
// whose correctness lives in another file, and the day somebody widens a policy
// for the owner's console this query still asks only for its own coach's rows.
//
// ── Four statuses, not one ────────────────────────────────────────────────
//
// The settlement list and the three detail reads fail independently, and they
// are kept apart on purpose. A `gym_class_pay` refusal must not take the
// settlement list down with it: the list is the answer to "what have I been
// paid", and the lines are the answer to "what was it made of". A coach who can
// see the first and not the second is far better off than one who sees neither
// — and a screen sharing one status would hide a working half behind a broken
// one, which is the defect app/(trainer)/money.tsx already carries a note
// about.
//
// The one fold that IS performed is the tenant read into the settlement status,
// through `worstStatus`: whether there is a gym at all decides whether an empty
// list means "no payroll" or "no employer", and a view built from half of that
// pair is the substitution src/lib/currencySource.ts exists to prevent.
//
// ── A truncated read is 'partial', and partial is not ready ───────────────
//
// Every one of the four goes through `capped`. A coach with more than
// PostgREST's page of settled sessions gets 'partial', `paidView` gives that
// its own kind carrying no totals, and nothing downstream can sum a prefix. See
// src/lib/rowCap.ts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import {
  paidView, type CoachAdjustment, type CoachClassLine, type CoachSessionLine,
  type PaidView, type Settlement,
} from '../lib/coachSettlements';
import type { GymLink } from '../lib/coachPayTerms';
import { ADJUSTMENT_KINDS, type AdjustmentKind, type ClassPayKind } from '../lib/gymPay';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useTenant } from './tenant';
import { useAuthRevision } from './authRevision';

const SETTLEMENT_COLS =
  'id, period_from, period_to, amount_cents, currency, sessions_count, method, note, '
  + 'settled_at, reversed_at, reverse_reason, reimbursement_cents';
const ADJUSTMENT_COLS = 'id, kind, amount_cents, currency, note, applies_on, settlement_id';
const CLASS_PAY_COLS = 'id, pay_kind, rate_cents, attendees, amount_cents, currency, settlement_id';
const SESSION_COLS = 'id, starts_at, outcome, rate_cents, rate_currency, settlement_id';

/** A numeric column PostgREST may hand back as a string — a bigint survives
 *  JSON only as one — read as a number, and anything unparseable as null. Null
 *  is never zero on this screen: see the header on `Settlement`. */
function centsOf(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A `kind` this build understands, or null. An unrecognised value is NOT
 *  folded to 'bonus': the sign, the label and whether it is taxable all turn on
 *  it, and guessing would put a word on a coach's payslip that nobody wrote. */
function kindOf(v: unknown): AdjustmentKind | null {
  return (ADJUSTMENT_KINDS as readonly string[]).includes(String(v)) ? (v as AdjustmentKind) : null;
}

function classKindOf(v: unknown): ClassPayKind | null {
  return v === 'per_class' || v === 'per_attendee' ? v : null;
}

/** A `date` column arrives as a bare `YYYY-MM-DD` and STAYS one. Never parsed
 *  here: `Date.parse` resolves it to UTC midnight, which is the previous day
 *  for every reader west of Greenwich. */
const bareDate = (v: unknown): string | null => (String(v ?? '').slice(0, 10) || null);

const text = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s || null;
};

export interface Detail<T> { rows: T[]; status: LoadStatus }

export interface MySettlements {
  /** The settlement list folded with the tenant read. What the section as a
   *  whole may say. */
  status: LoadStatus;
  /** Whether there is a gym at all — 'unknown' until the tenant read answers. */
  link: GymLink;
  view: PaidView;
  adjustments: Detail<CoachAdjustment>;
  classLines: Detail<CoachClassLine>;
  sessions: Detail<CoachSessionLine>;
  refresh: () => void;
}

const NONE = <T,>(status: LoadStatus): Detail<T> => ({ rows: [], status });

/**
 * What this coach's gym has settled for them, and the lines behind each run.
 *
 * Costs no reads at all for the account with no tenant, which is every coach on
 * this product today: there is no gym row to ask about, no run that could exist
 * and — crucially — no ambiguity to resolve, so 'ready' with an explicit
 * 'no_gym' link is the honest answer to a question that has one without asking.
 */
export function useMySettlements(): MySettlements {
  const { tenant, status: tenantStatus } = useTenant();
  const authRev = useAuthRevision();
  const [rows, setRows] = useState<Settlement[]>([]);
  const [readStatus, setReadStatus] = useState<LoadStatus>('loading');
  const [adjustments, setAdjustments] = useState<Detail<CoachAdjustment>>(NONE<CoachAdjustment>('loading'));
  const [classLines, setClassLines] = useState<Detail<CoachClassLine>>(NONE<CoachClassLine>('loading'));
  const [sessions, setSessions] = useState<Detail<CoachSessionLine>>(NONE<CoachSessionLine>('loading'));
  const [tick, setTick] = useState(0);

  const tenantId = tenant?.id ?? null;

  // 'none' only once the tenant read has ANSWERED. Under 'loading' and 'error'
  // this is 'unknown', which is what stops "there is no gym attached to this
  // account" being said to an employed coach whose profile read timed out.
  const link: GymLink = tenantStatus === 'ready'
    ? (tenantId ? 'gym' : 'none')
    : 'unknown';

  const load = useCallback(async (cancelled: () => boolean) => {
    if (!USE_SUPABASE) {
      setReadStatus('ready');
      setAdjustments(NONE<CoachAdjustment>('ready'));
      setClassLines(NONE<CoachClassLine>('ready'));
      setSessions(NONE<CoachSessionLine>('ready'));
      return;
    }
    if (!tenantId) {
      // Nothing to read and nothing unknown either. 'ready' where the tenant
      // read has landed, and 'loading' where it has not — never 'ready' over an
      // unanswered one, which would publish "no gym" as a finding.
      const s: LoadStatus = tenantStatus === 'ready' ? 'ready' : 'loading';
      setRows([]);
      setReadStatus(s);
      setAdjustments(NONE<CoachAdjustment>(s));
      setClassLines(NONE<CoachClassLine>(s));
      setSessions(NONE<CoachSessionLine>(s));
      return;
    }
    setReadStatus('loading');
    try {
      // getSession and not getUser: getUser REJECTS with nobody signed in,
      // which would latch this at 'error' before anybody had signed in.
      const { data: sess } = await supabase.auth.getSession();
      if (cancelled()) return;
      const uid = sess?.session?.user?.id ?? null;
      if (!uid) {
        setReadStatus('error');
        setAdjustments(NONE<CoachAdjustment>('error'));
        setClassLines(NONE<CoachClassLine>('error'));
        setSessions(NONE<CoachSessionLine>('error'));
        return;
      }

      const [runs, adj, cls, ses] = await Promise.all([
        // Ordered on `settled_at` AND `id`: two runs closed in the same second
        // are a tie, and a tie is not an order a page boundary can be drawn on.
        supabase.from('payroll_settlements')
          .select(SETTLEMENT_COLS)
          .eq('tenant_id', tenantId).eq('trainer_id', uid)
          .order('settled_at', { ascending: false }).order('id', { ascending: false })
          .limit(capLimit()),
        supabase.from('payroll_adjustments')
          .select(ADJUSTMENT_COLS)
          .eq('tenant_id', tenantId).eq('trainer_id', uid)
          .order('applies_on', { ascending: false }).order('id', { ascending: false })
          .limit(capLimit()),
        supabase.from('gym_class_pay')
          .select(CLASS_PAY_COLS)
          .eq('tenant_id', tenantId).eq('trainer_id', uid)
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .limit(capLimit()),
        // Only the sessions a run has already stamped. The unsettled ones are
        // the Sessions screen's job and are not what this section answers; the
        // filter also keeps a coach's whole history out of a read that only
        // ever needs the settled tail of it.
        supabase.from('sessions')
          .select(SESSION_COLS)
          .eq('trainer_id', uid)
          .not('settlement_id', 'is', null)
          .order('starts_at', { ascending: false }).order('id', { ascending: false })
          .limit(capLimit()),
      ]);
      if (cancelled()) return;

      // `error` first and separately from `data`, on every one of the four. On
      // a refusal both a null data and an error are present, and reading data
      // first is precisely how a refusal becomes "your gym has paid you
      // nothing".
      if (runs.error) {
        reportError('coachSettlements.runs', runs.error);
        setReadStatus('error');
      } else {
        const page = capped((runs.data ?? []) as unknown as Record<string, unknown>[]);
        setRows(page.rows.map((r) => ({
          id: String(r.id),
          periodFrom: bareDate(r.period_from),
          periodTo: bareDate(r.period_to),
          amountCents: centsOf(r.amount_cents),
          currency: text(r.currency),
          sessionsCount: centsOf(r.sessions_count),
          method: text(r.method),
          note: text(r.note),
          settledAt: text(r.settled_at),
          reversedAt: text(r.reversed_at),
          reverseReason: text(r.reverse_reason),
          reimbursementCents: centsOf(r.reimbursement_cents),
        })));
        setReadStatus(page.truncated ? 'partial' : 'ready');
      }

      if (adj.error) {
        reportError('coachSettlements.adjustments', adj.error);
        setAdjustments(NONE<CoachAdjustment>('error'));
      } else {
        const page = capped((adj.data ?? []) as unknown as Record<string, unknown>[]);
        setAdjustments({
          // A row whose kind this build cannot read is DROPPED rather than
          // relabelled, and the drop is visible in the count on screen. A
          // deduction rendered as a bonus is worse than a line that is not
          // there: one is a question the coach asks their gym, the other is an
          // answer they believe.
          rows: page.rows.flatMap((r) => {
            const kind = kindOf(r.kind);
            return kind ? [{
              id: String(r.id),
              kind,
              amountCents: centsOf(r.amount_cents),
              currency: text(r.currency),
              note: text(r.note),
              appliesOn: bareDate(r.applies_on),
              settlementId: text(r.settlement_id),
            }] : [];
          }),
          status: page.truncated ? 'partial' : 'ready',
        });
      }

      if (cls.error) {
        reportError('coachSettlements.classPay', cls.error);
        setClassLines(NONE<CoachClassLine>('error'));
      } else {
        const page = capped((cls.data ?? []) as unknown as Record<string, unknown>[]);
        setClassLines({
          rows: page.rows.map((r) => ({
            id: String(r.id),
            payKind: classKindOf(r.pay_kind),
            rateCents: centsOf(r.rate_cents),
            // NULL on a per-class line by construction. `centsOf` keeps it null
            // rather than turning it into a headcount of nought.
            attendees: centsOf(r.attendees),
            amountCents: centsOf(r.amount_cents),
            currency: text(r.currency),
            settlementId: text(r.settlement_id),
          })),
          status: page.truncated ? 'partial' : 'ready',
        });
      }

      if (ses.error) {
        reportError('coachSettlements.sessions', ses.error);
        setSessions(NONE<CoachSessionLine>('error'));
      } else {
        const page = capped((ses.data ?? []) as unknown as Record<string, unknown>[]);
        setSessions({
          rows: page.rows.map((r) => ({
            id: String(r.id),
            startsAt: text(r.starts_at),
            status: text(r.outcome),
            rateCents: centsOf(r.rate_cents),
            // `rate_currency` and NOT the gym's currency (part 1010): the rate
            // was snapshotted in whatever money it was agreed in, and printing
            // today's gym currency over it would re-denominate history.
            currency: text(r.rate_currency),
            settlementId: text(r.settlement_id),
          })),
          status: page.truncated ? 'partial' : 'ready',
        });
      }
    } catch (e) {
      // A throw out of the fetch is nobody answering, never a refusal — and
      // never an absence of pay.
      reportError('coachSettlements.load', e);
      if (cancelled()) return;
      setReadStatus('error');
      setAdjustments(NONE<CoachAdjustment>('error'));
      setClassLines(NONE<CoachClassLine>('error'));
      setSessions(NONE<CoachSessionLine>('error'));
    }
  }, [tenantId, tenantStatus]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load, authRev, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // The settlement list is only as good as the tenant read it hangs off: that
  // read is what decides whether an empty list is "no payroll" or "no gym".
  const status = worstStatus(tenantStatus, readStatus);

  return useMemo<MySettlements>(() => ({
    status,
    link,
    view: paidView(link, status, rows),
    adjustments,
    classLines,
    sessions,
    refresh,
  }), [status, link, rows, adjustments, classLines, sessions, refresh]);
}
