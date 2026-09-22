// The seven reads behind "can this month be closed", on the owner's phone.
//
// The impure half of src/lib/ownerClose.ts, which holds every decision about
// what an empty answer means. The verdict itself is `buildClose` in
// src/lib/monthEnd.ts — the same function the web console's /close runs, over
// the same five parts, so the phone and the console cannot reach two different
// answers about one month. That is the whole reason nothing here re-derives a
// figure: a second opinion about whether August may be signed off is worse than
// no opinion at all.
//
// ── Which month ────────────────────────────────────────────────────────────
//
// The last one that ENDED at the gym. `closeBlockers` refuses a month still
// running outright (`kind: 'month_running'`), so opening on the current month
// would greet an owner with a refusal about a month nobody claimed was over.
//
// "At the gym" is load-bearing and is why `fetchGymZone` is read at all.
// `gymMonthNow(zone)` is the month running on the gym's clock and `monthsBefore`
// steps back one key by arithmetic rather than by stepping a Date. On the first
// of the month a phone in London and a gym in Dubai disagree about which month
// just ended, and which month just ended is this section's entire subject. With
// no zone set the month is the reader's and `basis` says so, exactly as
// src/ui/coachClose.ts reports it for the coach.
//
// ── Why the five reads are separate, and why one more rides beside them ────
//
// Five independent reads and not one `Promise.all` under a single catch: an
// invoice table that refuses must not take the payments down with it. Each
// lands as a `Slice`, so a part that failed is 'failed' rather than empty, and
// `closeBlockers` raises a `read_failed` line naming what the month therefore
// cannot say. A close is allowed to be partial; it is not allowed to be partial
// quietly.
//
// The per-coach rates are the sixth and are NOT one of `CLOSE_PARTS`. A failed
// rates read does not make the takings unknown — it prices every coach at the
// gym's standard fee, which is a wrong payroll figure rather than a missing
// one, and silently smaller for anybody on a rate of their own. /payroll and
// /close both treat that as a refusal to ACT rather than a hole in the sheet;
// this screen cannot act, so it carries the fact out as `ratesUnread` and the
// card says the payroll line beneath it is the gym's fee applied to everybody.
//
// The seventh is `gym_month_closes` — whether the month is already filed. It is
// its own question with its own failure, and src/lib/ownerClose.ts refuses to
// let a read that did not land be drawn as "still open".
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import {
  fetchPayments, fetchMemberships, money, type GymPayment, type Membership,
} from '../lib/gymRecord';
import { fetchInvoices } from '../lib/gymInvoices';
import { fetchSessions, PAY_DELIVERED_ONLY, type PtSession, type PayPolicy } from '../lib/gymSessions';
import { fetchPasses, type GymPass } from '../lib/gymPasses';
import { fetchTrainerPay, withResolvedRates, type PayIndex } from '../lib/gymPay';
import { payPolicyOf } from '../lib/gymPolicy';
import { minorFromWhole } from '../lib/coachMoney';
import { fetchCloses, type MonthCloseRow } from '../lib/gymClose';
import {
  sliceReady, sliceFailed, sliceLoading, type Slice,
} from '../lib/memberView';
import {
  buildClose, type CloseRecord, type GymInvoice, type MonthClose,
} from '../lib/monthEnd';
import type { InvoiceStatus } from '../lib/gymInvoices';
import { fetchGymZone, gymDay } from '../lib/gymZone';
import { gymMonthNow, monthAtGym } from '../lib/gymMonth';
import { monthsBefore } from '../lib/closeCosts';
import { ownerCloseView, type OwnerCloseView } from '../lib/ownerClose';
import type { GymLink, PolicyView } from '../lib/coachPayTerms';
import { useGymPayPolicy } from './gymPayPolicy';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useTenant } from './tenant';
import { useToday } from './today';
import { useAuthRevision } from './authRevision';

export interface OwnerMonthClose {
  /** The worse of every read behind this, for a caller that wants one word. */
  status: LoadStatus;
  /** The whole section, already decided. Never rows a caller has to interpret. */
  view: OwnerCloseView;
  /**
   * The sentence saying whose calendar decided which month just ended, or null
   * when it was the gym's own.
   *
   * `gymMonthNow`'s own wording rather than one written again here: a gym that
   * has set no timezone gets the READER's month, and every screen that draws a
   * gym month on a phone's clock owes the reader that disclosure.
   */
  basisNote: string | null;
  /** The gym's own zone, or null because it has not set one. Only for drawing
   *  the instant a month was FILED at: that is a timestamp, and a close made at
   *  00:30 in Dubai reads as the previous evening on a phone in London. Paired
   *  with `basis`, which is the sentence saying whose clock that was. */
  zone: string | null;
  /**
   * The gym's record of closed months, and whether it was read.
   *
   * Exposed rather than kept private because the cost form on the same screen
   * has to ask the same question: a cost dated into a filed month is refused by
   * part 182's trigger, and one read serving both is what stops the two halves
   * of one screen holding two opinions about whether August is closed.
   */
  closes: { status: LoadStatus; rows: readonly MonthCloseRow[] | null };
  /** True when the per-coach rates could not be read, so every session in the
   *  payroll figure below is priced at the gym's standard fee. */
  ratesUnread: boolean;
  /**
   * What this gym says it pays for, already decided.
   *
   * A boolean was not enough and the difference is a sentence the card has to
   * get right: a gym that has NOT SET a policy and a gym whose row could not be
   * READ both leave the verdict computed on delivered sessions alone, and only
   * one of them is a fact about the gym. `policyView` keeps the two apart, and
   * the card words them separately.
   */
  policy: PolicyView;
  refresh: () => void;
}

const EMPTY: CloseRecord = {
  payments: sliceLoading(),
  invoices: sliceLoading(),
  sessions: sliceLoading(),
  memberships: sliceLoading(),
  passes: sliceLoading(),
};

/** One read into a slice, so a rejection becomes a stated failure rather than
 *  an empty month. The same wrapper /close uses, for the same reason. */
async function slice<T>(run: () => Promise<T[]>): Promise<Slice<T>> {
  try {
    return sliceReady(await run());
  } catch (e: any) {
    return sliceFailed(e?.message ?? 'The read failed.');
  }
}

/**
 * `gym_invoices` as the close reads them.
 *
 * The shared reader (src/lib/gymInvoices.ts) answers a nullable amount and a
 * nullable currency because a hand-written row can hold either; `monthEnd`'s
 * `GymInvoice` does not. The three substitutions are each chosen to be the one
 * that cannot invent money:
 *
 *   · a null amount becomes 0 — the column is NOT NULL, so this fires only
 *     against a row somebody wrote by hand, and a zero adds nothing to a total
 *     rather than making one unreadable;
 *   · a null currency becomes '' and NOT the gym's code. `normaliseCurrency`
 *     folds '' to null, so such a row counts as a disagreement and
 *     `owed.mixedCurrency` withholds the figure — which is exactly what a row
 *     stating no money should do;
 *   · a null member becomes '' , which matches no membership, so the invoice is
 *     unattributed rather than attributed to somebody arbitrary.
 */
const asCloseInvoice = (r: {
  id: string; memberId: string | null; memberName: string | null;
  amountCents: number | null; currency: string | null; issuedOn: string;
  dueOn: string | null; status: string | null; note: string | null;
}): GymInvoice => ({
  id: r.id,
  memberId: r.memberId ?? '',
  memberName: r.memberName,
  amountCents: r.amountCents ?? 0,
  currency: r.currency ?? '',
  issuedOn: r.issuedOn,
  dueOn: r.dueOn,
  status: (r.status ?? 'open') as InvoiceStatus,
  note: r.note,
});

/**
 * The month that just ended at this gym, and whether it can be closed.
 *
 * Costs no reads for an account with no gym: there is no month being closed
 * around it, and `ownerCloseView` answers 'no_gym' from the link before it
 * looks at a row.
 */
export function useOwnerMonthClose(): OwnerMonthClose {
  const { tenant, status: tenantStatus } = useTenant();
  const payPolicy = useGymPayPolicy();
  const authRev = useAuthRevision();
  // Not for a figure — nothing here is per-day — but because this hook decides
  // WHICH MONTH from the clock. An owner console left open across midnight on
  // the 1st would otherwise keep reporting the month before last.
  const today = useToday();
  const [zone, setZone] = useState<string | null>(null);
  const [rec, setRec] = useState<{ key: string; rec: CloseRecord }>({ key: '', rec: EMPTY });
  const [recStatus, setRecStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [pay, setPay] = useState<PayIndex | null>(null);
  const [ratesUnread, setRatesUnread] = useState(false);
  const [closes, setCloses] = useState<readonly MonthCloseRow[] | null>(null);
  const [closesStatus, setClosesStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [tick, setTick] = useState(0);

  const tenantId = tenant?.id ?? null;

  // 'none' only once the tenant read has ANSWERED. Under 'loading' and 'error'
  // this is 'unknown' — the separation src/lib/currencySource.ts exists for,
  // restated here because the wrong side of it tells an owner whose profile
  // read timed out that they have no gym.
  const link: GymLink = tenantStatus === 'ready'
    ? (tenantId ? 'gym' : 'none')
    : 'unknown';

  // Re-derived whenever the day moves. `today` is in the list for that and
  // nothing else: it is the value that changes when midnight passes, which is
  // when the answer to "which month just ended" changes.
  const head = useMemo(() => gymMonthNow(zone), [zone, today]); // eslint-disable-line react-hooks/exhaustive-deps -- `today` is the clock this must re-run on; see src/ui/today.ts
  const prevKey = useMemo(() => monthsBefore(head.key, 1)[0] ?? null, [head.key]);
  const at = useMemo(() => (prevKey ? monthAtGym(prevKey, zone) : null), [prevKey, zone]);
  const w = at?.window ?? null;

  const fromIso = w?.fromIso ?? null;
  const toIso = w?.toIso ?? null;
  const lastDay = w?.lastDay ?? null;
  const monthKey = w?.key ?? null;

  const loadZone = useCallback(async (cancelled: () => boolean) => {
    if (!USE_SUPABASE || !tenantId) return;
    const z = await fetchGymZone(supabase, tenantId);
    if (cancelled()) return;
    // Reported, not swallowed, and not fatal: with no usable zone the month
    // falls back to the reader's and `basis` says so on the card.
    if (z.error) reportError('ownerClose.zone', z.error);
    setZone(z.zone);
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    void loadZone(() => cancelled);
    return () => { cancelled = true; };
  }, [loadZone, authRev, tick]);

  useEffect(() => {
    if (!USE_SUPABASE) { setRecStatus('ready'); setClosesStatus('ready'); return; }
    if (!tenantId || !fromIso || !toIso || !lastDay || !monthKey) {
      // Nothing to read and nothing unknown once the tenant read has settled:
      // with no gym there is no month being closed. Still 'loading' while that
      // read is in flight, or this would claim an answer it has not got.
      setRec({ key: '', rec: EMPTY });
      setCloses(null);
      const settled: LoadStatus = tenantStatus === 'ready' ? 'ready' : 'loading';
      setRecStatus(settled); setClosesStatus(settled);
      return;
    }
    let cancelled = false;
    setRecStatus('loading');
    setClosesStatus('loading');
    // Cleared first, and keyed on the month. Without this the previous month's
    // rows stay under the new month's heading while the reads are in flight,
    // which on a screen whose whole subject is one named month is the one thing
    // it must not do.
    setRec({ key: '', rec: EMPTY });

    void (async () => {
      const [payments, invoices, sessions, memberships, passes] = await Promise.all([
        // Bounded at BOTH ends. Everything outside the month is dropped by
        // `buildClose` anyway, and dragging a year of payments across a phone's
        // connection to total one month of them is a cost an owner on mobile
        // data pays for nothing.
        slice<GymPayment>(() => fetchPayments(supabase, tenantId, fromIso, toIso)),
        // Bounded only at the far end, deliberately: `buildClose` needs every
        // invoice issued up to the month end so that ARREARS — money owed from
        // earlier months and still open — are part of the picture. A read
        // scoped to the month would answer a different question and answer it
        // confidently.
        slice<GymInvoice>(async () => (await fetchInvoices(supabase, tenantId, lastDay)).map(asCloseInvoice)),
        slice<PtSession>(() => fetchSessions(supabase, tenantId, fromIso, toIso)),
        slice<Membership>(() => fetchMemberships(supabase, tenantId)),
        slice<GymPass>(() => fetchPasses(supabase, tenantId)),
      ]);
      if (cancelled) return;
      setRec({ key: monthKey, rec: { payments, invoices, sessions, memberships, passes } });
      // 'ready' here is a claim about the READS HAVING ANSWERED, not about what
      // they said: a part that failed is 'failed' inside the record and
      // `closeBlockers` raises a line naming it. Every one of the five having
      // failed still leaves this hook with an answer to give.
      setRecStatus('ready');

      // The rates and the record of closes, each with its own failure. Settled
      // rather than all-or-nothing for the reason the five above are separate.
      const [rates, closeRows] = await Promise.all([
        fetchTrainerPay(supabase, tenantId).then(
          (m) => ({ ok: true as const, m }),
          (e: any) => ({ ok: false as const, e }),
        ),
        fetchCloses(supabase, tenantId).then(
          (r) => ({ ok: true as const, r }),
          (e: any) => ({ ok: false as const, e }),
        ),
      ]);
      if (cancelled) return;
      if (rates.ok) { setPay(rates.m); setRatesUnread(false); }
      else { reportError('ownerClose.rates', rates.e); setPay(null); setRatesUnread(true); }
      if (closeRows.ok) { setCloses(closeRows.r); setClosesStatus('ready'); }
      else {
        // Never an empty history. `liveCloseFor` over `[]` answers null, which
        // reads as "this month is open" — about a month that may well be filed.
        reportError('ownerClose.closes', closeRows.e);
        setCloses(null); setClosesStatus('error');
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId, tenantStatus, fromIso, toIso, lastDay, monthKey, authRev, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const gymCcy = tenant?.currency ?? null;
  // What the gym pays for, through the one hook that reads it — rather than a
  // second query against `tenants` written here. Two readers of one column is
  // how the console and four screens came to hold four opinions of this policy
  // (see the header of src/lib/gymPolicy.ts), and the whole point of this card
  // is that it agrees with the console.
  const stated = payPolicy.view.kind === 'stated' ? payPolicyOf(payPolicy.view.code) : null;
  // The floor where the gym has not stated one. A close built on delivered
  // sessions alone cannot pay somebody more than they earned; it can pay them
  // less, which is why `policyStated` travels out and the card says so rather
  // than letting the floor read as the gym's own decision.
  const policy: PayPolicy = stated ?? PAY_DELIVERED_ONLY;
  /*
   * The gym's standard session fee in MINOR units, or null.
   *
   * `minorFromWhole` and never `* 100`: `tenants.session_fee` is stored in whole
   * units and there are no sen in a yen, so a ¥6,000 fee scaled by a hundred
   * prices every unrated session at ¥600,000 on the verdict an owner acts on.
   * Null when the gym has no currency, and that is not zero — an unpriced
   * session stays unpriced, exactly as it does when no fee is set at all.
   */
  const feeCents = useMemo(() => minorFromWhole(tenant?.sessionFee ?? null, gymCcy), [tenant?.sessionFee, gymCcy]);

  // Only ever the month it was read for. A record under a different key is not
  // this month's and reads as "not loaded yet", which is true.
  const forMonth = monthKey && rec.key === monthKey ? rec.rec : EMPTY;

  const close: MonthClose | null = useMemo(() => {
    if (!w || !monthKey || rec.key !== monthKey) return null;
    const s = forMonth.sessions;
    // Resolved ONCE, up front, exactly as /payroll, /sessions and /close do it.
    // `buildClose` is then handed rows that already carry their rate and its
    // `fallbackRateCents` is null: applying the gym fee a second time inside
    // `payrollByTrainer` is how those three came to disagree the first time.
    const priced: Slice<PtSession> = s.state === 'ready'
      ? sliceReady(withResolvedRates(s.rows, pay ?? new Map(), feeCents, gymCcy))
      : s;
    const now = Date.now();
    return buildClose({ ...forMonth, sessions: priced }, w, {
      policy,
      fallbackRateCents: null,
      // The GYM's day, which is what decides whether an invoice is overdue. With
      // no zone recorded `buildClose` falls back to the reader's, which is what
      // a zone-less gym already gets everywhere else — argued in one place
      // rather than two.
      today: gymDay(now, zone) ?? undefined,
      now,
      fmt: (c) => money(c, gymCcy) ?? '—',
    });
  // `today` is in the list because `Date.now()` is read inside this memo: the
  // verdict turns on whether the month has ended and on whether an invoice is
  // late, and a clock pinned to the last server answer is what
  // scripts/check-frozen-hook.mjs exists for.
  }, [forMonth, w, monthKey, rec.key, pay, feeCents, gymCcy, policy, zone, today]); // eslint-disable-line react-hooks/exhaustive-deps -- `today` is the clock; see src/ui/today.ts

  const status = worstStatus(tenantStatus, recStatus, closesStatus);

  return useMemo<OwnerMonthClose>(() => ({
    status,
    view: ownerCloseView(
      link,
      w ? { key: w.key, label: w.label } : null,
      close,
      { status: closesStatus, rows: closes },
      (cents, ccy) => money(cents, ccy) ?? 'an unstateable amount',
    ),
    basisNote: head.note,
    zone,
    closes: { status: closesStatus, rows: closes },
    ratesUnread,
    policy: payPolicy.view,
    refresh,
  }), [status, link, w, close, closesStatus, closes, head.note, zone, ratesUnread, payPolicy.view, refresh]);
}
