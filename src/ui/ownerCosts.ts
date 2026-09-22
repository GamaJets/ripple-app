// Recording a cost from a phone, and proving it landed.
//
// The impure half of src/lib/ownerCostEntry.ts, which holds every decision
// about what a draft means and what a silence means.
//
// ── One write, and one read that is also the proof ────────────────────────
//
// `recordGymCost` (src/lib/gymCosts.ts) is the shared insert and it is used
// unedited: a second writer of `gym_costs` is a second opinion about what a
// cost row contains, and the console and the phone must produce the same rows.
//
// What it does not do is hand the row back. PostgREST answers an INSERT that
// RLS refused with a 201 and an empty body — this app's own `recordCost` on the
// coach side asks for the row back for exactly that reason — so an owner could
// be told their rent is on record when nothing was written. That function is
// another lane's file this session, so the proof here is the read this hook was
// going to do anyway: the month's costs are re-read after every write and
// `findRecordedCost` looks for the line. Three outcomes, and they are three
// different sentences: it is there, the read says it is not, or the read did
// not answer and nothing may be claimed either way.
//
// ── Which month is listed, and why anything is listed at all ──────────────
//
// The month the owner is standing in, on the GYM's clock. The list is not
// decoration: it is what stops the same £40 being written down twice on a walk
// back from the shop, which is a mistake nothing downstream can detect because
// two identical rows are exactly what two identical purchases look like.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import {
  fetchGymCosts, recordGymCost, type GymCost, type GymCostCategory, type GymCostDraft,
} from '../lib/gymCosts';
import { readMinorAmount } from '../lib/coachMoney';
import { costEntryBlockers, defaultPaidOn, findRecordedCost } from '../lib/ownerCostEntry';
import { monthWindow } from '../lib/monthEnd';
import type { MonthCloseRow } from '../lib/gymClose';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useTenant } from './tenant';
import { useToday } from './today';
import { useAuthRevision } from './authRevision';

/** What a write did, in the three states it can actually be in. */
export type CostWrite =
  | { kind: 'refused'; problems: string[] }
  | { kind: 'failed'; reason: string }
  | { kind: 'recorded'; cost: GymCost }
  /** Sent, no error, and the read back could not confirm it. Never reported as
   *  either outcome — see `COST_UNCONFIRMED_NOTE`. */
  | { kind: 'unconfirmed' };

export interface OwnerCosts {
  /** The read behind the list below. */
  status: LoadStatus;
  /** What this gym has recorded as paid in the month it is currently in,
   *  newest first. Never a list standing in for a read that failed. */
  rows: GymCost[];
  /** 'August 2026' — which month the list covers, named because the list is
   *  only a duplicate check if the reader knows what it is a list OF. */
  monthLabel: string | null;
  /** The day the form offers, and whether it is the gym's own or this phone's. */
  today: { day: string; atGym: boolean };
  /** Record one. Re-reads the month afterwards and says what it found. */
  record: (draft: GymCostDraft) => Promise<CostWrite>;
  refresh: () => void;
}

const EMPTY_TODAY = { day: '', atGym: false };

/**
 * The gym's costs for the month it is in, and the one write that adds to them.
 *
 * `closes` is handed in rather than read again: the month-close card on the
 * same screen has already read `gym_month_closes`, and the cost form needs the
 * same answer to refuse a day inside a filed month before part 182's trigger
 * refuses it afterwards.
 */
export function useOwnerCosts(
  zone: string | null,
  closes: { status: LoadStatus; rows: readonly MonthCloseRow[] | null },
): OwnerCosts {
  const { tenant, status: tenantStatus } = useTenant();
  const authRev = useAuthRevision();
  // The clock this hook reads. Without it in a dependency list the month the
  // list covers — and the day the form offers — freeze at the render that first
  // built them, on a screen an owner leaves open. See src/ui/today.ts.
  const today = useToday();
  const [rows, setRows] = useState<GymCost[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [tick, setTick] = useState(0);

  const tenantId = tenant?.id ?? null;

  const at = useMemo(() => (tenantId ? defaultPaidOn(zone) : EMPTY_TODAY), [tenantId, zone, today]); // eslint-disable-line react-hooks/exhaustive-deps -- `today` is the clock this must re-run on; see src/ui/today.ts
  // A month key is a slice of the day, never a parse: `new Date('2026-09-01')`
  // is August for every reader west of Greenwich, and this decides which month
  // of somebody's purchase ledger is on screen.
  const w = useMemo(() => (at.day ? monthWindow(at.day.slice(0, 7)) : null), [at.day]);
  const firstDay = w?.firstDay ?? null;
  const lastDay = w?.lastDay ?? null;

  const read = useCallback(async (): Promise<{ rows: GymCost[]; status: LoadStatus }> => {
    if (!USE_SUPABASE) return { rows: [], status: 'ready' };
    if (!tenantId || !firstDay || !lastDay) {
      // Nothing to read and nothing unknown, once the tenant read has settled.
      return { rows: [], status: tenantStatus === 'ready' ? 'ready' : 'loading' };
    }
    try {
      // Throws on a refused read AND on a truncated one — `fetchGymCosts` uses
      // `assertWhole`, on the argument that a prefix of somebody's costs shown
      // as the whole is the thing that module exists to prevent. Both arrive
      // here as 'error', which the screen renders as "not read" rather than as
      // "nothing recorded".
      return { rows: await fetchGymCosts(supabase, tenantId, firstDay, lastDay), status: 'ready' };
    } catch (e) {
      reportError('ownerCosts.list', e);
      return { rows: [], status: 'error' };
    }
  }, [tenantId, tenantStatus, firstDay, lastDay]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      const r = await read();
      if (cancelled) return;
      setRows(r.rows);
      setStatus(r.status);
    })();
    return () => { cancelled = true; };
  }, [read, authRev, tick]);

  const record = useCallback(async (draft: GymCostDraft): Promise<CostWrite> => {
    if (!USE_SUPABASE) {
      return { kind: 'failed', reason: 'This build is not connected to a server, so nothing can be recorded.' };
    }
    if (!tenantId) {
      return { kind: 'failed', reason: 'This account is not attached to a gym, so there is no ledger to record into.' };
    }
    // Re-checked here and not only in the form, so a caller added later cannot
    // skip the gate by not rendering the fields that carry it — and so the
    // figure that was checked is the figure that is sent.
    const problems = costEntryBlockers(draft, closes);
    if (problems.length) return { kind: 'refused', problems };

    const cur = (draft.currency || '').trim().toUpperCase();
    // The one reader for a typed amount, which asks the CURRENCY how many
    // places it has rather than multiplying by a hundred. `false`: this is
    // money that has already left the account, not a charge, so the whole-ten
    // rule Stripe imposes on thousandth-unit currencies does not apply — a
    // Kuwaiti water bill really can be 82.505 KWD.
    const read2 = readMinorAmount(draft.amountText, cur, false);
    if (!read2.ok) return { kind: 'refused', problems: [read2.reason] };
    const amountCents = read2.minorUnits;

    try {
      // getSession and not getUser: getUser REJECTS with nobody signed in.
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id ?? null;
      await recordGymCost(supabase, tenantId, {
        recordedBy: uid,
        description: draft.description,
        supplier: draft.supplier ?? null,
        category: draft.category as GymCostCategory,
        amountCents,
        currency: cur,
        paidOn: draft.paidOn,
        note: draft.note ?? null,
      });
    } catch (e: any) {
      reportError('ownerCosts.record', e);
      return { kind: 'failed', reason: e?.message || 'That cost was not recorded. Nothing has been written.' };
    }

    // The absence of an error is not the proof. The month is read back and the
    // line is either in it or it is not — and a read that did not answer is a
    // third outcome, never folded into either of the other two.
    const after = await read();
    setRows(after.rows);
    setStatus(after.status);
    if (after.status !== 'ready') return { kind: 'unconfirmed' };
    const landed = findRecordedCost(after.rows, {
      description: draft.description, amountCents, currency: cur, paidOn: draft.paidOn,
    });
    // A cost dated outside the month on screen is a real write this list cannot
    // see, so its absence proves nothing — 'unconfirmed', which says exactly
    // that, rather than 'failed', which would send the owner to write it twice.
    return landed ? { kind: 'recorded', cost: landed } : { kind: 'unconfirmed' };
  }, [tenantId, closes, read]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return useMemo<OwnerCosts>(() => ({
    status: worstStatus(tenantStatus, status),
    rows,
    monthLabel: w?.label ?? null,
    today: at,
    record,
    refresh,
  }), [tenantStatus, status, rows, w?.label, at, record, refresh]);
}
