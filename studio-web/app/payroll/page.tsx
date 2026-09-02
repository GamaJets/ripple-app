'use client';

// Payroll — what each trainer is owed for a named period, and nothing else.
//
// /sessions is where the floor gets marked: it runs on a rolling 30 days and
// its job is to empty the queue of sessions nobody has said anything about.
// This screen is the run itself. An owner pays people against a period — August,
// not "the last thirty days" — and the question here is narrower and more
// dangerous: for this month, for this trainer, how much money leaves the
// account, and has any of it left already.
//
// The rule the whole screen is built on: ONLY A SESSION WITH A RECORDED OUTCOME
// MAY REACH A FIGURE. A booked slot whose clock has passed is not a delivered
// session — it is a session nobody has looked at yet, and it might have been a
// no-show, a late cancellation, or an hour the trainer never turned up for.
// Pricing it is how a gym pays twice for work it did not receive, and it is
// exactly what "delivered = booked and the time has passed" used to do.
//
// So when anything in the period is still unmarked, the payable total is a dash
// with the count beside it, never a number — not even a number labelled
// "provisional", because the provisional number is the one that gets paid.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { amount, currencyNote, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import {
  fetchSessions, fetchSettlements, recordSettlement,
  isDelivered, isAwaitingOutcome, isPayable,
  payrollByTrainer, payrollTotal, settlementBlocker,
  settleableSessions, settlementAmount, settleBlocker, sessionProfileIds,
  PAY_DELIVERED_ONLY, SETTLEMENT_METHODS, SETTLEMENT_METHOD_LABEL,
  type PtSession, type PayPolicy, type PayrollLine, type Settlement,
  type SettlementMethod,
} from '@lib/gymSessions';
import { fetchGymTrainers, payroll30For, payrollBlocker, type GymTrainer } from '@lib/gymTrainers';
import {
  fetchTrainerPay, saveTrainerPay, withResolvedRates, payRateBlocker, parseRate,
  fetchAdjustments, addAdjustment, adjustmentBlocker, adjustmentSign,
  fetchClassPay, reverseSettlement, reversalReasonBlocker, stampRunExtras,
  runTotal, runCurrencyBlocker, payCurrency, adjustmentsTotal, scopedToRun, runScopeOf,
  ADJUSTMENT_KINDS, ADJUSTMENT_LABEL, CLASS_PAY_LABEL,
  type PayIndex, type TrainerPay, type Adjustment, type AdjustmentKind,
  type ClassPayLine, type ClassPayKind,
} from '@lib/gymPay';
import { payPolicyOf, PAY_POLICY_LABEL, NO_PAY_POLICY_NOTE, type PayPolicyCode } from '@lib/gymPolicy';
import { fetchCloses, closedMonthBlocker, type MonthCloseRow } from '@lib/gymClose';
import { money } from '@lib/gymRecord';
import { isoDate } from '@lib/format';

/** How many months back the run can be opened. */
const PERIODS = 6;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "Nothing outstanding" are both lies about a query that errored, and on this
 * screen the second one tells an owner every trainer is square.
 */
type Unread = 'loading' | 'failed' | null;

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as any)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

interface Period {
  key: string;
  label: string;
  /** Bounds of the calendar month in the gym's own timezone, as instants. */
  fromIso: string;
  toIso: string;
  /** The same bounds as dates, which is what a settlement row records. */
  fromDate: string;
  toDate: string;
}

/**
 * The last few calendar months, in the gym's timezone.
 *
 * Local, not UTC, and for the same reason the door log is: this product sells in
 * AED, so the desk reading it is four hours ahead and the UTC month does not
 * turn over until 04:00 on the 1st. Built from UTC bounds, every session in the
 * first four hours of the 1st would have been paid in the previous month's run
 * and then again in this one — a session can only be settled once, so the second
 * run would silently drop it and the trainer would be short an hour.
 */
function periodsBack(n: number): Period[] {
  const now = new Date();
  const out: Period[] = [];
  for (let i = 0; i < n; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const nextStart = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const end = new Date(nextStart.getTime() - 1);
    out.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString([], { month: 'long', year: 'numeric' }),
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      fromDate: isoDate(start),
      toDate: isoDate(end),
    });
  }
  return out;
}

export default function Payroll() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  // The money this gym counts in, from `tenants.currency`. Null means the gym
  // has not set one — which is not AED, and is not this screen's to guess. Every
  // figure below is the gym's own session fee multiplied out; none of them
  // carries a currency of its own to fall back on.
  const [ccy, setCcy] = useState<TenantCurrency>(null);

  // "The gym has not set a session fee" and "we could not read the gym" both
  // leave sessionFee null, and they are not the same problem: one is a setting
  // to fill in, the other is a read to retry. Without this string the screen
  // sends the owner off to set a fee that is probably already set.
  const [gymError, setGymError] = useState<string | null>(null);

  const periods = useMemo(() => periodsBack(PERIODS), []);
  const [periodKey, setPeriodKey] = useState(periods[0].key);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];

  /**
   * The gym's stored pay policy, READ rather than held.
   *
   * This screen was the fifth copy of the same unsaved `useState`. Four of them
   * — /sessions, /staff, /close and /coach/earnings — were closed by
   * supabase/parts/166, which put one nullable column on `tenants` and made
   * every screen read it. This one was left holding its own, which is worse
   * than any of the four were: an owner setting the policy on Gym and coming
   * here to actually pay somebody would settle against a number the policy they
   * had just chosen did not produce, permanently, with the sessions stamped.
   *
   * Null means the gym has not decided, and the floor below is delivered
   * sessions only — the LEAST the gym owes, said out loud rather than presented
   * as the gym's answer.
   */
  const [policyCode, setPolicyCode] = useState<string | null>(null);

  /** What this gym pays each coach, and what it pays them to teach. */
  const [pay, setPay] = useState<PayIndex | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  /** Class-teaching lines and non-session adjustments, both unsettled and
   *  settled — the run needs the first to pay them and the second to show what
   *  a reversed run put back. */
  const [classPay, setClassPay] = useState<ClassPayLine[] | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustment[] | null>(null);
  // Every close and reopen this gym has recorded. null is "not read", which is
  // not the same as "no month is closed" — see the note where it is set.
  const [closes, setCloses] = useState<MonthCloseRow[] | null>(null);

  const [sessions, setSessions] = useState<PtSession[] | null>(null);
  const [trainers, setTrainers] = useState<GymTrainer[] | null>(null);
  const [runs, setRuns] = useState<Settlement[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [trainersErr, setTrainersErr] = useState<string | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  /**
   * How the money is actually moving, for the settlement about to be recorded.
   *
   * Neither this screen nor /sessions used to pass one, and `recordSettlement`
   * defaulted to 'transfer' into a column that also defaults to 'transfer' — so
   * every settlement the console has ever written says bank transfer, including
   * the cash handed over at the desk, and /accounting prints that under a column
   * headed Method as the gym's own answer. It is the owner pressing the button
   * who knows, so they are the one asked.
   *
   * 'transfer' is the initial value of the CONTROL, which is a different thing
   * from a default in the write: it is on screen, beside the button, and it
   * changes when they change it.
   */
  const [method, setMethod] = useState<SettlementMethod>('transfer');

  /**
   * Read the run.
   *
   * `stale` is not tidiness. Switching from August to July while August is still
   * in flight would otherwise let the slower answer land last and paint August's
   * sessions under July's heading and July's total — a screen that pays people
   * showing one month's work priced as another's. A late answer is dropped.
   */
  const load = useCallback(async (tenantId: string, p: Period, stale: () => boolean = () => false) => {
    setSessions(null); setTrainers(null); setRuns(null);

    // allSettled, not all: one failing read must not take the others with it.
    // Under Promise.all a refused payroll_settlements query also emptied the
    // sessions — so a screen whose only fault was not knowing what had already
    // been paid instead reported a month with no work in it, and the two wrong
    // facts pointed opposite ways.
    const [sRes, tRes, rRes, pRes, cRes, aRes, closesRes] = await Promise.allSettled([
      fetchSessions(supabase, tenantId, p.fromIso, p.toIso),
      fetchGymTrainers(supabase, tenantId),
      fetchSettlements(supabase, tenantId),
      fetchTrainerPay(supabase, tenantId),
      fetchClassPay(supabase, tenantId),
      fetchAdjustments(supabase, tenantId),
      // Which months this gym has signed off. This screen never asked, so the
      // period picker offered a closed month exactly like an open one and the
      // run wrote `period_from` into it — see `closedMonthBlocker`.
      fetchCloses(supabase, tenantId),
    ]);

    if (stale()) return;

    // The pay rates get their own error rather than joining the banner above.
    // A failed read here does not empty the run — every session falls back to
    // the gym's standard fee, which is what happened before this table existed
    // — so the figures are still figures. They are the WRONG figures for any
    // coach on their own rate, and silently smaller, so the screen says so
    // rather than showing a payroll that merely looks unremarkable.
    if (pRes.status === 'fulfilled') { setPay(pRes.value); setPayErr(null); }
    else { setPay(null); setPayErr(failure(pRes, 'what this gym pays each coach')); }
    // null is "not read", and it deliberately does NOT block: part 481 attaches
    // the closed-month trigger to `payroll_settlements`, so the database is the
    // backstop, and refusing payroll over a failed read of the close record
    // would cost more than it protects.
    setCloses(closesRes.status === 'fulfilled' ? closesRes.value : null);
    setClassPay(cRes.status === 'fulfilled' ? cRes.value : null);
    setAdjustments(aRes.status === 'fulfilled' ? aRes.value : null);

    // A read that failed is null, never []. [] is the gym saying it has none;
    // null is nobody knowing. On this screen those two answers differ by a
    // month's wages.
    setSessions(sRes.status === 'fulfilled' ? sRes.value : null);
    setTrainers(tRes.status === 'fulfilled' ? tRes.value : null);
    setRuns(rRes.status === 'fulfilled' ? rRes.value : null);

    const s = failure(sRes, 'the session record');
    const t = failure(tRes, 'the roster');
    const r = failure(rRes, 'what has already been paid');
    setSessionsErr(s); setTrainersErr(t); setRunsErr(r);

    const trouble = [s, t, r].filter((x): x is string => x !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) return;
      // supabase-js resolves on a database error rather than rejecting, so the
      // error has to be read off the result. Destructuring only `data` left a
      // refused read looking exactly like a gym with no fee set: every unrated
      // session priced at nothing, and payroll quietly smaller than it owes.
      const { data: g, error } = await supabase
        .from('tenants').select('name, session_fee, currency, session_pay_policy').eq('id', who.tenantId).single();
      if (!live) return;
      setGymName(error ? null : g?.name ?? null);
      setSessionFee(error ? null : g?.session_fee ?? null);
      setCcy(error ? null : (((g?.currency ?? '') as string).trim().toUpperCase() || null));
      setPolicyCode(error ? null : (((g as any)?.session_pay_policy ?? null) as string | null));
      setGymError(error ? (error.message || 'Could not read your gym.') : null);
    })();
    return () => { live = false; };
  }, []);

  // The period is a dependency on purpose: changing the month is a fresh read,
  // not a filter over rows already in hand. Filtering would have shown August's
  // sessions under September's heading until something else triggered a load —
  // on a screen that pays people, under the wrong month's total.
  useEffect(() => {
    if (me === undefined) return;
    if (!me?.tenantId) { setSessions([]); setTrainers([]); setRuns([]); return; }
    let dropped = false;
    load(me.tenantId, period, () => dropped);
    return () => { dropped = true; };
  }, [me, period, load]);

  // The gym's fee is in major units; everything downstream is minor units.
  const fallbackCents = sessionFee == null ? null : Math.round(sessionFee * 100);

  const stated = payPolicyOf(policyCode);
  const policy: PayPolicy = stated ?? PAY_DELIVERED_ONLY;

  /**
   * The sessions with the rate that actually applies written onto each one.
   *
   * Three layers, resolved ONCE: the rate snapshotted at delivery, then what
   * this gym pays this coach, then the gym's standard fee. Doing it here rather
   * than inside each of `payrollByTrainer`, `settleableSessions` and
   * `settlementAmount` is the whole point — those three have already disagreed
   * about what "priced" means once, and the result was a screen saying AED
   * 1,500 owed while the button handed over 900 and stamped the sessions paid.
   */
  const priced = useMemo(
    () => (sessions ? withResolvedRates(sessions, pay ?? new Map(), fallbackCents) : null),
    [sessions, pay, fallbackCents],
  );

  // Stays null while `sessions` is null rather than collapsing to []. Handing
  // payrollByTrainer an empty array would produce a confident, complete-looking
  // run of nobody owed anything, built out of a read that never returned.
  const lines = useMemo(
    // `null` and not `fallbackCents`: the fallback has already been applied by
    // `withResolvedRates` above. Passing it again would be harmless today and
    // is exactly how the three functions came to disagree the first time.
    () => priced && payrollByTrainer(priced, policy, null),
    [priced, policy],
  );
  const total = useMemo(() => payrollTotal(lines ?? []), [lines]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/payroll">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/payroll">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          The payroll run carries every colleague&rsquo;s pay on one screen, so it is owner-only.
        </p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId, period);

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread = (rows: unknown[] | null, e: string | null): Unread =>
    rows !== null ? null : e ? 'failed' : 'loading';

  const sessionsUnread = unread(sessions, sessionsErr);

  /*
   * Why the figure cannot be settled, in words the owner can act on.
   *
   * Two things settlementBlocker cannot know, because it sees only the sessions.
   * With `sessions` null it would answer "No payable sessions in this period."
   * about a period nobody has managed to read. And when payable sessions have no
   * rate it says "set a session fee", which is the wrong errand if the fee is
   * missing because the gym row could not be read — so name the read failure
   * instead, and leave those sessions unpriced rather than free.
   */
  const blocker =
    sessions === null
      ? null
      : gymError && total.priced < total.payable
        ? `Your gym could not be read, so there is no session fee to price the rest with: ${gymError}`
        : settlementBlocker(total);

  /*
   * The run total, and the single most important decision on this screen.
   *
   * A dash whenever anything blocks settlement — not only when payrollTotal
   * comes back null. When sessions are unmarked, `total.cents` is a real sum
   * over the sessions somebody did mark, and putting that on screen as "the
   * payable total" is the exact failure this module was written to end: it looks
   * final, it is smaller than the truth, and the next thing that happens is that
   * somebody pays it and marks the month closed. When payable sessions carry no
   * rate it is a partial sum for the opposite reason. Either way the honest
   * answer is that this period does not have a total yet, and the note says why.
   */
  const totalText = sessions === null || blocker !== null ? null : amount(total.cents, ccy);

  // Sessions in this period that nobody has marked. The reason payroll refuses,
  // listed rather than merely counted, because the fix is a person opening
  // /sessions and clicking three buttons.
  const awaiting = sessions && sessions.filter((s) => isAwaitingOutcome(s));

  // The evidence behind the money: every session somebody actually recorded an
  // outcome for. Kept separate from `awaiting` rather than shown as one list
  // with a status column, because a payslip dispute is settled by pointing at
  // these rows and nothing else belongs among them.
  const marked = sessions && sessions.filter((s) => s.outcome !== null);

  /*
   * Names this run could not resolve.
   *
   * sessionProfileIds counts the distinct people the period's rows name —
   * trainers and clients alike — and the difference against the ones that came
   * back with a name is how many rows below will show a dash where a person
   * belongs. Said out loud because an owner staring at four dashed rows should
   * know it is a profiles read that RLS filtered, not four trainers who left.
   */
  const nameGap = (() => {
    if (!sessions) return 0;
    const ids = sessionProfileIds(sessions.map((s) => ({ trainer_id: s.trainerId, client_id: s.clientId })));
    const named = new Set<string>();
    for (const s of sessions) {
      if (s.trainerName) named.add(s.trainerId);
      if (s.clientId && s.clientName) named.add(s.clientId);
    }
    return ids.length - named.size;
  })();

  /*
   * The run, one row per trainer.
   *
   * Built from the period's sessions and then topped up from the roster, so a
   * trainer who delivered nothing this month is on the run saying so rather than
   * missing from it. Missing would read as a gym with fewer staff than it has,
   * and the owner would never notice the one whose whole month went unmarked.
   */
  const rows: RunRow[] | null = (() => {
    if (lines === null || sessions === null) return null;
    const byTrainer = new Map<string, RunRow>();
    for (const l of lines) {
      byTrainer.set(l.trainerId, {
        trainerId: l.trainerId,
        name: l.trainerName,
        line: l,
        outstanding: [],
        classes: [],
        adjustments: [],
        blocker: null,
        onRoster: false,
      });
    }
    // Only sessions with a recorded outcome, a rate, and no settlement already
    // stamped on them. Paying by session rather than by period is what stops a
    // late-marked session being paid twice.
    for (const s of settleableSessions(priced ?? [], policy)) {
      byTrainer.get(s.trainerId)?.outstanding.push(s);
    }
    // Class teaching and adjustments join the same run. Both are settled per
    // LINE and not per period, exactly as sessions are — so a class registered
    // after its month was settled joins the next run instead of being lost or
    // paid twice, which is the argument supabase/parts/36 makes about sessions
    // and which applies unchanged to anything else a run pays for.
    // ── scoped to the period, which they never were ──────────────────────
    //
    // `fetchClassPay` is tenant-wide with no date bound, and adjustments carry
    // an `applies_on` this screen collected and never read. So every unsettled
    // line in the gym's history joined whichever run was on screen and was
    // stamped with that run's `period_from`: opening July paid for September's
    // classes, and a bonus deliberately dated 1 September was filed as August's
    // cost. `scopedToRun` keeps the period's own lines and anything still
    // unsettled from BEFORE it — which has no other run coming — and refuses
    // anything dated after it, which does.
    for (const c of scopedToRun(
      (classPay ?? []).filter((x) => x.settlementId == null), (x) => x.taughtOn, period,
    )) {
      const row = byTrainer.get(c.trainerId);
      if (row) row.classes.push(c);
      else byTrainer.set(c.trainerId, {
        trainerId: c.trainerId, name: c.trainerName, line: null,
        outstanding: [], classes: [c], adjustments: [], blocker: null, onRoster: false,
      });
    }
    for (const a of scopedToRun(
      (adjustments ?? []).filter((x) => x.settlementId == null), (x) => x.appliesOn, period,
    )) {
      const row = byTrainer.get(a.trainerId);
      if (row) row.adjustments.push(a);
      else byTrainer.set(a.trainerId, {
        trainerId: a.trainerId, name: a.trainerName, line: null,
        outstanding: [], classes: [], adjustments: [a], blocker: null, onRoster: false,
      });
    }
    for (const r of byTrainer.values()) {
      // A run with no currency is blocked, not merely displayed as a dash.
      // `recordSettlement` once wrote `currency: run.currency ?? 'AED'` into
      // `payroll_settlements`, which stamped the wrong money onto a permanent
      // payment record that /accounting and /close read back as fact. Its
      // `currency` is now a REQUIRED `string` and supabase/parts/150 dropped the
      // column's `'AED'` default, so that particular silent write is gone — but
      // the block stays and is the point: without it this screen would offer a
      // Settle button that can only ever throw, and a payroll run that fails at
      // the database is a worse way to learn the currency is missing than being
      // told so before pressing anything.
      // A run with SOMETHING on it is settleable even when no session is: a
      // coach who taught four classes and delivered no one-to-ones is owed for
      // four classes, and `settleBlocker` — which only ever saw sessions —
      // answered "Nothing outstanding for this trainer" and left them unpaid.
      const anything = r.outstanding.length + r.classes.length + r.adjustments.length;
      const sessionSide = settleBlocker(r.outstanding, r.line?.unmarked ?? 0);
      const closedSide = closedMonthBlocker(period.fromDate, closes);
      r.blocker =
        (r.line?.unmarked ?? 0) > 0 ? sessionSide
        : anything === 0 ? 'Nothing outstanding for this trainer.'
        // A month that is closed stays closed. The run's `period_from` is what
        // /accounting buckets "Money out" by, so a settlement dated into a
        // filed month moves a figure the accountant already has. Part 481 makes
        // the database refuse it; this is the refusal with the run still on
        // screen, which is a much better place to learn it.
        : closedSide ? closedSide
        : !ccy ? 'This gym has not set its currency, so a settlement cannot say what money it is in.'
        // Two currencies on one run is not a smaller run, it is one nobody can
        // hand over. A coach whose class rate is in EUR and whose gym pays in
        // GBP has two amounts and no total.
        : runCurrencyBlocker([
            ccy,
            ...r.classes.map((c) => c.currency),
            ...r.adjustments.map((a) => a.currency),
          ])
        // A session that could not be priced at any of the three layers is
        // unpriced, not free, and `settleableSessions` has already excluded it
        // — so this is the case where sessions exist, none is settleable, and
        // the class and adjustment lines are all there is.
        ?? null;
    }
    for (const t of trainers ?? []) {
      const existing = byTrainer.get(t.id);
      if (existing) { existing.onRoster = true; if (!existing.name) existing.name = t.name; continue; }
      byTrainer.set(t.id, {
        trainerId: t.id,
        name: t.name,
        line: null,
        outstanding: [],
        classes: [],
        adjustments: [],
        blocker: 'Nothing outstanding for this trainer.',
        onRoster: true,
      });
    }
    return [...byTrainer.values()].sort(
      (a, b) => (b.line?.delivered ?? -1) - (a.line?.delivered ?? -1)
        || (a.name ?? '').localeCompare(b.name ?? ''),
    );
  })();

  // Settlements that actually paid for sessions in this period, matched by the
  // id stamped on the sessions themselves rather than by comparing dates. A run
  // recorded on the 2nd for last month's work belongs to last month, and a date
  // comparison would file it under this one.
  const paidHere = (() => {
    if (!sessions || !runs) return null;
    const ids = new Set(sessions.map((s) => s.settlementId).filter((x): x is string => x != null));
    // Class lines and adjustments carry a settlement id too, so a run that paid
    // for four classes and no sessions is still this period's run. Before this
    // it was invisible here — settled, real, and not on the screen that lists
    // what has been settled.
    for (const c of classPay ?? []) if (c.settlementId) ids.add(c.settlementId);
    for (const a of adjustments ?? []) if (a.settlementId) ids.add(a.settlementId);
    return runs.filter((r) => ids.has(r.id));
  })();
  const alreadySettled = sessions && sessions.filter((s) => s.settlementId != null).length;

  const settle = async (r: RunRow) => {
    if (r.blocker || !ccy) return;
    if (r.outstanding.length + r.classes.length + r.adjustments.length === 0) return;
    setSettling(r.trainerId);
    try {
      const id = await recordSettlement(supabase, tenantId, {
        trainerId: r.trainerId,
        // The period's own bounds, not the first and last session in it: this
        // run is "August", and a settlement covering the 4th to the 22nd would
        // leave the rest of August looking unaccounted for next time somebody
        // reads the settlement history.
        periodFrom: period.fromDate,
        periodTo: period.toDate,
        // Sessions, plus the classes taught, plus the adjustments — signed, so
        // a deduction subtracts. `payroll_settlements.amount_cents` has a
        // `>= 0` check, so a run whose deductions exceed its pay is refused by
        // the database rather than stored as a negative payment; that is the
        // right refusal and the screen says so before the button is pressed.
        amountCents: rowOwed(r) ?? 0,
        // Of which, money the coach spent and is getting back rather than pay.
        // Null when the adjustments do not agree on a currency — the split is
        // then two splits and this run has no single figure for either, which
        // is the same answer the Adjustments column gives.
        reimbursementCents: adjustmentsTotal(r.adjustments).reimbursementCents,
        sessionIds: r.outstanding.map((s) => s.id),
        // Said, never defaulted — see the note on `method` above.
        method,
        note: `Payroll run — ${period.label}`,
        // Stated, never defaulted. Left out, gymSessions writes 'AED', and a
        // London gym's payroll history quietly becomes dirhams. `r.blocker`
        // above stops the button reaching here without one.
        currency: ccy ?? undefined,
      });
      // Second, and separately, because `recordSettlement` is shared with the
      // phone app and knows only about sessions. A partial stamp throws rather
      // than being swallowed: the unstamped remainder is silently payable a
      // SECOND time, which is the expensive direction.
      await stampRunExtras(supabase, id, r.classes.map((c) => c.id), r.adjustments.map((a) => a.id));
      await load(tenantId, period);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not record that settlement.');
    } finally { setSettling(null); }
  };

  // Unsettled extras this run deliberately leaves alone. Counted over the same
  // rows the run is built from, so the two cannot disagree about what "held
  // back" means.
  const heldBack = (() => {
    const unsettled = [
      ...(classPay ?? []).filter((x) => x.settlementId == null).map((x) => x.taughtOn),
      ...(adjustments ?? []).filter((x) => x.settlementId == null).map((x) => x.appliesOn),
    ];
    let later = 0;
    let undated = 0;
    for (const d of unsettled) {
      const scope = runScopeOf(d, period);
      if (scope === 'later') later += 1;
      else if (scope === 'undated') undated += 1;
    }
    return { later, undated };
  })();

  return (
    <Shell me={me} gymName={gymName} current="/payroll">
      <h1>Payroll</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What each trainer is owed for {period.label}, counted from sessions with
        a recorded outcome and nothing else. A booked slot whose time has passed
        is not a delivered session, and this screen will not price one.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      {gymError ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>Your gym could not be read</strong>, so this run
          does not know your session fee: {gymError}. Anything that needed the fee to price it is
          shown as unpriced rather than as nothing owed. This is not the same as your gym having no
          fee set, and setting one now would not fix it — reload the page.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 0' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--ink2)' }}>
          Period
          <select
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            style={field}
          >
            {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
          {period.fromDate} → {period.toDate}
        </span>
      </div>

      {/* What this run is NOT paying, and why. A line held back is invisible
          otherwise, and an owner who cannot see it reads the run as everything
          outstanding — which is how the scoping fix would itself become a
          coach quietly unpaid. */}
      {heldBack.later || heldBack.undated ? (
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '72ch' }}>
          {heldBack.later ? (
            <>
              {heldBack.later} unsettled line{heldBack.later === 1 ? '' : 's'} dated after {period.toDate}{' '}
              {heldBack.later === 1 ? 'is' : 'are'} not on this run. {heldBack.later === 1 ? 'It belongs' : 'They belong'}{' '}
              to a later period and will be paid by that period&rsquo;s run.{' '}
            </>
          ) : null}
          {heldBack.undated ? (
            <>
              {heldBack.undated} unsettled line{heldBack.undated === 1 ? '' : 's'} carr
              {heldBack.undated === 1 ? 'ies' : 'y'} no readable date, so {heldBack.undated === 1 ? 'it is' : 'they are'}{' '}
              left off rather than stamped into a period nobody can place.
            </>
          ) : null}
        </p>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 10px',
        }}
      >
        <Kpi
          label={`Payable, ${period.label}`}
          text={totalText}
          // No note at all when the sessions are unknown: "ready to settle" on a
          // period nobody could read is the worst sentence available here. A run
          // that is otherwise ready but has no currency to state it in is its own
          // reason, and it names the setting rather than the sessions.
          note={sessions === null
            ? undefined
            : (blocker ?? currencyNote(total.cents, ccy) ?? 'ready to settle')}
        />
        <Kpi
          label="Delivered"
          text={sessions ? String(total.delivered) : null}
          note={sessions ? 'outcome recorded as completed' : undefined}
        />
        <Kpi
          label="Awaiting an outcome"
          text={sessions ? String(total.unmarked) : null}
          note={total.unmarked > 0 ? 'blocking the run' : sessions ? 'nothing unmarked' : undefined}
        />
        <Kpi
          label="Payable sessions"
          text={sessions ? String(total.payable) : null}
          note={policy.payNoShows || policy.payLateCancellations ? 'policy widens this' : 'delivered only'}
        />
        <Kpi
          label="Already settled"
          text={alreadySettled == null ? null : String(alreadySettled)}
          note={alreadySettled == null ? undefined : 'sessions in this period already paid for'}
        />
      </div>

      {blocker ? (
        <Banner tone={total.unmarked > 0 ? 'crit' : undefined}>
          <strong style={{ color: 'var(--ink)' }}>This run cannot be settled.</strong> {blocker}{' '}
          {total.unmarked > 0 ? (
            <>
              The payable total is a dash rather than a figure on purpose: pricing those{' '}
              {total.unmarked} would mean paying for no-shows and slots nobody cancelled, because
              nobody has yet said which of them they are. Mark them on{' '}
              <a href="/sessions">Sessions</a> and this run will price itself.
            </>
          ) : null}
        </Banner>
      ) : null}

      {nameGap > 0 ? (
        <Banner>
          {nameGap} {nameGap === 1 ? 'person' : 'people'} named by this period&rsquo;s sessions could
          not be looked up, so some rows below show a dash where a name belongs. Every figure beside
          those dashes was still read from the sessions themselves.
        </Banner>
      ) : null}

      {/* Stated, not set — and this screen was the LAST of five holding its own
          unsaved copy. The other four were closed by supabase/parts/166; this
          one, the screen that actually hands money over, was left with two
          toggles that reset on every reload. So an owner could set the policy on
          Gym, come here to pay somebody, and settle against a figure the policy
          they had just chosen did not produce — permanently, with the sessions
          stamped and no way back until this wave. */}
      <Section
        title="Pay policy"
        sub="A gym decision, stored once. It decides which sessions are payable, and therefore the figure above and the money this screen hands over."
      >
        <div style={{ padding: 14, fontSize: 13, color: 'var(--ink2)', maxWidth: '72ch' }}>
          {gymError ? (
            <>
              The gym&rsquo;s record could not be read, so its pay policy is unknown here rather
              than unset. Everything below prices delivered sessions only, which is the least this
              gym owes &mdash; not necessarily what it has agreed to pay. Do not settle on it.
            </>
          ) : stated ? (
            <>
              <strong style={{ color: 'var(--ink)' }}>{PAY_POLICY_LABEL[policyCode as PayPolicyCode]}.</strong>{' '}
              Change it on <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a> and every
              screen that prices a session moves with it, including this one.
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--ink)' }}>Not set</strong> &mdash; {NO_PAY_POLICY_NOTE}.
              Everything below therefore counts delivered sessions only. That is the floor rather
              than an answer: a coach who held an hour for somebody who did not turn up is not in
              it, and settling now pays them for a session the gym may well owe. Say what this gym
              pays for on <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a>.
            </>
          )}
        </div>
      </Section>

      <Rates
        trainers={trainers} pay={pay} payErr={payErr} ccy={ccy}
        sessionFee={sessionFee} tenantId={tenantId} me={me} onChange={refresh}
      />

      <Adjustments
        trainers={trainers} rows={adjustments} ccy={ccy}
        tenantId={tenantId} me={me} period={period} onChange={refresh}
      />

      <Blocking sessions={awaiting} unread={sessionsUnread} ccy={ccy} />

      <Run
        rows={rows}
        unread={sessionsUnread}
        rosterUnread={unread(trainers, trainersErr)}
        settling={settling}
        onSettle={settle}
        method={method}
        onMethod={setMethod}
        ccy={ccy}
      />

      <LineItems sessions={marked} unread={sessionsUnread} policy={policy} ccy={ccy} />

      <CrossCheck
        trainers={trainers}
        unread={unread(trainers, trainersErr)}
        sessionFee={sessionFee}
        gymError={gymError}
        ccy={ccy}
      />

      <Paid runs={paidHere} unread={unread(runs, runsErr)} sessionsUnread={sessionsUnread}
            period={period} me={me} onChange={refresh} onErr={setErr} />

      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '0 0 30px' }}>
        Recording a payment stamps those exact sessions with the run that paid
        for them, so nothing on this screen can be paid a second time — and a
        session marked after its period was settled simply joins the next run
        instead of being lost. <button style={linkBtn} onClick={refresh}>Reload the run</button>
      </p>
    </Shell>
  );
}

/* ── the rows this screen is about ─────────────────────────────────────────── */

interface RunRow {
  trainerId: string;
  name: string | null;
  /** Class-teaching lines not yet stamped with a settlement. */
  classes: ClassPayLine[];
  /** Bonuses, deductions, reimbursements and advances not yet settled. */
  adjustments: Adjustment[];
  /** Null when this trainer has no sessions at all in the period. */
  line: PayrollLine | null;
  /** Marked, priced, payable, and not already settled. */
  outstanding: PtSession[];
  blocker: string | null;
  /** Whether the roster still lists them. Only meaningful once it has been read. */
  onRoster: boolean;
}

/* ── what is holding the run up ────────────────────────────────────────────── */

function Blocking({ sessions, unread, ccy }: {
  sessions: PtSession[] | null; unread: Unread; ccy: TenantCurrency;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleString([], {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '',
      render: (s) => s.trainerName ?? <span className="dash">—</span> },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'mins', header: 'Mins', value: (s) => s.durationMin, numeric: true },
    // Not "0.00" and not the gym's standard fee: until somebody says what
    // happened, this session has no price, only a rate it might be worth.
    { key: 'worth', header: 'If delivered', value: (s) => s.rateCents ?? -1, numeric: true,
      render: (s) => s.rateCents == null
        ? <span className="dash">not rated</span>
        : <span className="dash">{amount(s.rateCents, ccy) ?? NO_CURRENCY_NOTE}</span> },
  ];
  return (
    <Section
      title="Holding up the run"
      sub="Booked, finished, and nobody has recorded what happened. None of these are priced, and none of them can be settled around."
    >
      {sessions === null ? (
        // "Nothing waiting" is an all-clear, and an all-clear is precisely what a
        // failed read has not earned. On this screen it would mean "go ahead and
        // pay" about a month nobody managed to read.
        <Unresolved state={unread ?? 'loading'} what="the session record, so nobody can say whether anything is waiting to be marked" />
      ) : (
        <DataTable
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing waiting — every finished session in this period has an outcome."
        />
      )}
    </Section>
  );
}

/* ── what this gym pays each coach ─────────────────────────────────────────── */

/**
 * A rate per trainer, and a rate for teaching a class.
 *
 * `payroll30For` multiplied delivered sessions by a single `tenants.session_fee`
 * and this screen offered no override anywhere, so a coach of fifteen years and
 * a trainee in their first month were worth an identical amount to payroll.
 *
 * `trainers.session_fee` is NOT this and must never be read as it: it is what a
 * coach CHARGES a client for private work booked through the app, added by
 * supabase/parts/23 as part of their public directory listing. Reading it here
 * would hand a coach's own price list to their employer's payroll run.
 *
 * The class rate is two fields rather than one, and that is the whole reason
 * this section is not a single number per row: "80 per class" and "8 a head"
 * are the same digits and completely different money. A gym that meant the
 * second and stored the first pays a coach twelve times what it agreed.
 */
function Rates({ trainers, pay, payErr, ccy, sessionFee, tenantId, me, onChange }: {
  trainers: GymTrainer[] | null; pay: PayIndex | null; payErr: string | null;
  ccy: TenantCurrency; sessionFee: number | null;
  tenantId: string; me: Me; onChange: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const gymRate = sessionFee == null ? null : Math.round(sessionFee * 100);

  const cols: Column<GymTrainer>[] = [
    { key: 'name', header: 'Trainer', value: (t) => t.name },
    { key: 'rate', header: 'Per session', value: (t) => pay?.get(t.id)?.sessionRateCents ?? null, numeric: true,
      render: (t) => {
        const own = pay?.get(t.id);
        if (own?.sessionRateCents != null) {
          return amount(own.sessionRateCents, own.currency ?? ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>;
        }
        // Not a dash, and not the fee printed as though somebody chose it for
        // this coach. It says which of the two it is, because "on the gym's
        // standard fee" and "nobody has priced this coach" are the same figure
        // and different facts — and only one of them wants doing something about.
        return gymRate == null
          ? <span className="dash">no rate, and no gym fee to fall back on</span>
          : <span style={{ color: 'var(--ink3)' }}>
              {amount(gymRate, ccy) ?? '—'} <span style={{ fontSize: 11 }}>(the gym&rsquo;s fee)</span>
            </span>;
      } },
    { key: 'class', header: 'Per class', value: (t) => pay?.get(t.id)?.classRateCents ?? null, numeric: true,
      render: (t) => {
        const own = pay?.get(t.id);
        if (own?.classRateCents == null || own.classPayKind == null) {
          return <span className="dash">not paid for teaching</span>;
        }
        return (
          <span>
            {amount(own.classRateCents, own.currency ?? ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>}{' '}
            <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
              {own.classPayKind === 'per_attendee' ? 'each person' : 'the class'}
            </span>
          </span>
        );
      } },
    { key: 'set', header: '', value: () => 0, align: 'right',
      render: (t) => editing === t.id
        ? <RateEditor
            trainer={t} existing={pay?.get(t.id) ?? null} ccy={ccy} tenantId={tenantId} me={me}
            onDone={() => { setEditing(null); setErr(null); onChange(); }}
            onCancel={() => setEditing(null)}
            onErr={setErr}
          />
        : <button style={linkBtn} onClick={() => setEditing(t.id)}>Set</button> },
  ];

  return (
    <Section
      title="What this gym pays each coach"
      sub="Per delivered session, and per class taught. Blank means the gym's standard session fee — which is not the same as nothing, and is why an unset rate says so rather than showing a dash."
    >
      {payErr ? (
        <Banner tone="crit">
          {payErr}. Every coach below is therefore priced at the gym&rsquo;s standard fee, which is
          what happened before per-coach rates existed. For anybody on their own rate that is the
          WRONG figure and it is silently smaller &mdash; do not settle a run until this reads.
        </Banner>
      ) : null}
      {err ? <Banner tone="crit">{err}</Banner> : null}
      {!ccy ? (
        <Banner>
          A rate cannot be set until this gym states its currency &mdash; {NO_CURRENCY_NOTE}. What
          somebody is paid is a permanent record and it is only a number until it says what money it
          is in. Set it on <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a>.
        </Banner>
      ) : null}
      {trainers === null ? (
        <Unresolved state="loading" what="the roster, so there is nobody to price" />
      ) : (
        <DataTable
          rows={trainers} columns={cols} rowKey={(t) => t.id}
          empty="Nobody is on the roster, so there is nobody to set a rate for."
        />
      )}
    </Section>
  );
}

function RateEditor({ trainer, existing, ccy, tenantId, me, onDone, onCancel, onErr }: {
  trainer: GymTrainer; existing: TrainerPay | null; ccy: TenantCurrency;
  tenantId: string; me: Me; onDone: () => void; onCancel: () => void; onErr: (s: string | null) => void;
}) {
  const cents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
  const [session, setSession] = useState(cents(existing?.sessionRateCents));
  const [cls, setCls] = useState(cents(existing?.classRateCents));
  const [kind, setKind] = useState<ClassPayKind | ''>(existing?.classPayKind ?? '');
  const [busy, setBusy] = useState(false);

  const blocker = payRateBlocker(session, cls, kind, ccy);

  const save = async () => {
    if (blocker) { onErr(blocker); return; }
    const s = parseRate(session);
    const c = parseRate(cls);
    setBusy(true);
    try {
      await saveTrainerPay(supabase, tenantId, {
        trainerId: trainer.id,
        sessionRateCents: s.kind === 'rate' ? s.cents : null,
        classRateCents: c.kind === 'rate' ? c.cents : null,
        classPayKind: c.kind === 'rate' ? (kind || null) as ClassPayKind | null : null,
        currency: ccy,
        updatedBy: me.id,
      });
      onErr(null);
      onDone();
    } catch (e: any) {
      onErr(`${trainer.name}'s rate was NOT saved: ${e?.message ?? 'the write was refused'}. They are still on whatever they were on.`);
    } finally { setBusy(false); }
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'normal' }}>
      <input value={session} onChange={(e) => setSession(e.target.value)} inputMode="decimal"
             placeholder={ccy ? `Session (${ccy})` : 'Session'}
             style={{ ...field, padding: '3px 5px', fontSize: 12, width: 110 }}
             aria-label={`What the gym pays ${trainer.name} per session`} />
      <input value={cls} onChange={(e) => setCls(e.target.value)} inputMode="decimal"
             placeholder={ccy ? `Class (${ccy})` : 'Class'}
             style={{ ...field, padding: '3px 5px', fontSize: 12, width: 100 }}
             aria-label={`What the gym pays ${trainer.name} per class`} />
      <select value={kind} onChange={(e) => setKind(e.target.value as ClassPayKind | '')}
              style={{ ...field, padding: '3px 5px', fontSize: 12, width: 150 }}
              aria-label="How the class rate is counted">
        <option value="">counted how?</option>
        {(Object.keys(CLASS_PAY_LABEL) as ClassPayKind[]).map((k) => (
          <option key={k} value={k}>{CLASS_PAY_LABEL[k]}</option>
        ))}
      </select>
      <button style={linkBtn} disabled={busy || !!blocker} onClick={save}>Save</button>
      <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={onCancel}>Cancel</button>
    </span>
  );
}

/* ── the lines a run pays for that are not sessions ────────────────────────── */

/**
 * A bonus, a deduction, a reimbursement or an advance.
 *
 * `recordSettlement` was insert-only and all-or-nothing per trainer, with no
 * adjustment line of any kind — so a gym owing a coach a bonus, or recovering
 * an advance it had already handed over, had nowhere to put it and did the
 * arithmetic outside the product. A payslip whose total is the product's figure
 * plus a number somebody worked out in their head is not a payslip anybody can
 * query.
 *
 * The SIGN comes from the kind and is never typed. A screen that asks somebody
 * for a negative number will one day be handed a positive one, and a deduction
 * of fifty recorded as plus fifty is a coach paid a hundred more than they
 * should have been. supabase/parts/183 enforces the same rule at the database,
 * so the two say it independently.
 */
function Adjustments({ trainers, rows, ccy, tenantId, me, period, onChange }: {
  trainers: GymTrainer[] | null; rows: Adjustment[] | null; ccy: TenantCurrency;
  tenantId: string; me: Me; period: Period; onChange: () => void;
}) {
  const [trainerId, setTrainerId] = useState('');
  const [kind, setKind] = useState<AdjustmentKind>('bonus');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [on, setOn] = useState(period.toDate);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const blocker = !trainerId
    ? 'Choose who this is for.'
    : adjustmentBlocker(amt, note, ccy);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker || !ccy) { setErr(blocker); return; }
    const r = parseRate(amt);
    if (r.kind !== 'rate') return;
    setBusy(true); setErr(null);
    try {
      await addAdjustment(supabase, tenantId, {
        trainerId, kind, amountCents: r.cents, currency: ccy,
        note, appliesOn: on, createdBy: me.id,
      });
      setAmt(''); setNote('');
      onChange();
    } catch (e: any) {
      setErr(`That adjustment was NOT recorded: ${e?.message ?? 'the write was refused'}. Nothing has been added to or taken off anybody's pay.`);
    } finally { setBusy(false); }
  };

  const cols: Column<Adjustment>[] = [
    { key: 'when', header: 'Applies', value: (a) => a.appliesOn },
    { key: 'who', header: 'Trainer', value: (a) => a.trainerName },
    { key: 'kind', header: 'Kind', value: (a) => ADJUSTMENT_LABEL[a.kind] },
    { key: 'amount', header: 'Amount', value: (a) => a.amountCents, numeric: true,
      render: (a) => (
        <span style={{ color: a.amountCents < 0 ? 'var(--crit)' : 'var(--good)' }}>
          {money(a.amountCents, a.currency)}
        </span>
      ) },
    { key: 'note', header: 'Why', value: (a) => a.note },
    { key: 'settled', header: 'Paid', value: (a) => (a.settlementId ? 1 : 0),
      render: (a) => a.settlementId
        ? <span style={{ color: 'var(--ink3)' }}>on a settled run</span>
        : <span style={{ color: 'var(--ink2)' }}>on the next run</span> },
  ];

  return (
    <Section
      title="Bonuses, deductions and reimbursements"
      sub="Everything a run pays for that is not a session or a class. Picked up by the next settlement for that coach and stamped with it, exactly as a session is — so nothing here can be paid twice."
    >
      <form onSubmit={add} style={formRow}>
        <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)} style={{ ...field, flex: 2, minWidth: 170 }}
                aria-label="Who this adjustment is for">
          <option value="">{trainers === null ? 'The roster could not be read' : 'Who is this for?'}</option>
          {(trainers ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)} style={{ ...field, flex: 2, minWidth: 200 }}
                aria-label="What kind of adjustment this is">
          {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{ADJUSTMENT_LABEL[k]}</option>)}
        </select>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal"
               placeholder={ccy ? `Amount (${ccy})` : 'Amount'} style={{ ...field, width: 130 }}
               aria-label="How much, as a positive number" />
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)} style={{ ...field, width: 148 }}
               aria-label="The date this belongs to" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it is for"
               style={{ ...field, flex: 2, minWidth: 180 }} aria-label="Why this adjustment exists" />
        <button type="submit" disabled={busy || !!blocker} style={primaryBtn}>Add</button>
      </form>
      <p style={{ margin: '0 14px 12px', fontSize: 12, color: 'var(--ink3)', maxWidth: '78ch' }}>
        Enter every amount as a positive number. A deduction and an advance subtract; a bonus and a
        reimbursement add, and Repple applies the sign from the kind rather than asking anybody to
        type a minus. A reimbursement is money the coach spent being paid back and a bonus is pay
        &mdash; the same arithmetic and different things to whoever files it, which is why they are
        separate kinds rather than one signed line.
      </p>
      {blocker && (trainerId || amt) && !err ? (
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: '#f0c04e', maxWidth: '72ch' }}>{blocker}</p>
      ) : null}
      {err ? <Banner tone="crit">{err}</Banner> : null}
      {rows === null ? (
        <Unresolved state="failed" what="the adjustments, so what is about to be added to or taken off anybody's pay is unknown" />
      ) : (
        <DataTable rows={rows} columns={cols} rowKey={(a) => a.id}
                   empty="No adjustment has been recorded. Every run below is sessions and classes only." />
      )}
    </Section>
  );
}

/* ── the run ───────────────────────────────────────────────────────────────── */

function Run({ rows, unread, rosterUnread, settling, onSettle, method, onMethod, ccy }: {
  rows: RunRow[] | null; unread: Unread; rosterUnread: Unread;
  settling: string | null; onSettle: (r: RunRow) => void;
  method: SettlementMethod; onMethod: (m: SettlementMethod) => void;
  ccy: TenantCurrency;
}) {
  const cols: Column<RunRow>[] = [
    { key: 'name', header: 'Trainer', value: (r) => r.name ?? '',
      render: (r) => (
        <span>
          {r.name ?? <span className="dash">—</span>}
          {/* Only once the roster has actually been read: with that read
              refused, every row would carry this label and the one person it
              is really about would be invisible among them. */}
          {!r.onRoster && rosterUnread === null ? (
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink3)' }}>
              worked this period, not on the roster
            </span>
          ) : null}
        </span>
      ) },
    { key: 'delivered', header: 'Delivered', value: (r) => r.line?.delivered ?? null, numeric: true,
      // A trainer with no sessions in the period has no delivered count to give.
      // Zero would be a claim that they worked and delivered nothing.
      render: (r) => r.line ? String(r.line.delivered) : <span className="dash">—</span> },
    { key: 'noshow', header: 'No-shows', value: (r) => r.line?.noShows ?? null, numeric: true,
      render: (r) => r.line ? String(r.line.noShows) : <span className="dash">—</span> },
    { key: 'cancelled', header: 'Cancelled', value: (r) => r.line?.cancelled ?? null, numeric: true,
      render: (r) => r.line ? String(r.line.cancelled) : <span className="dash">—</span> },
    { key: 'unmarked', header: 'Unmarked', value: (r) => r.line?.unmarked ?? null, numeric: true,
      render: (r) => !r.line ? <span className="dash">—</span>
        : r.line.unmarked === 0 ? <span className="dash">—</span>
        : <span style={{ color: 'var(--warn)' }}>{r.line.unmarked}</span> },
    { key: 'period', header: 'Period worth', value: (r) => periodCents(r) ?? -1, numeric: true,
      render: (r) => {
        const c = periodCents(r);
        // Null covers three different unknowns, and each of them is a dash: no
        // sessions at all, sessions nobody marked, and payable sessions with no
        // rate. The reason travels in the Owed column's note rather than being
        // guessed at here.
        // The currency is a fourth unknown and it is the gym's setting, not a
        // fact about this trainer's month, so it says so rather than joining the
        // dash the other three share.
        return c == null
          ? <span className="dash">—</span>
          : (amount(c, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>);
      } },
    { key: 'classes', header: 'Classes', value: (r) => (r.classes.length || null), numeric: true,
      render: (r) => r.classes.length === 0
        ? <span className="dash">—</span>
        : <span title={r.classes.map((c) => `${c.payKind === 'per_attendee' ? `${c.attendees ?? '?'} × ` : ''}${c.rateCents / 100}`).join(', ')}>
            {r.classes.length}
          </span> },
    { key: 'adjust', header: 'Adjustments', value: (r) => adjustmentsTotal(r.adjustments).cents, numeric: true,
      // Signed and coloured, because a deduction and a bonus of the same size
      // are the same digits and opposite money.
      //
      // And denominated by the ADJUSTMENTS, not by the gym. This cell used to
      // reduce `amountCents` across the rows and print `amount(cents, ccy)`
      // over the result, so a euro reimbursement and a sterling bonus came out
      // as one sterling figure — on the number the owner reads BEFORE deciding
      // whether to press Settle. `runCurrencyBlocker` does stop the button, but
      // it fires after the figure has already been believed.
      render: (r) => {
        if (!r.adjustments.length) return <span className="dash">—</span>;
        const t = adjustmentsTotal(r.adjustments);
        if (t.cents == null) {
          return (
            <span className="dash" title={`${t.count} adjustments in ${t.currencies.join(' and ')}`}>
              {t.currencies.join(' and ')} — not added
            </span>
          );
        }
        return (
          <span
            style={{ color: t.cents < 0 ? 'var(--crit)' : 'var(--good)' }}
            title={t.reimbursementCents
              ? `${amount(t.taxableCents, t.currency) ?? '—'} pay, ${amount(t.reimbursementCents, t.currency) ?? '—'} reimbursed`
              : undefined}
          >
            {amount(t.cents, t.currency) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>}
          </span>
        );
      } },
    { key: 'owed', header: 'Owed now', value: (r) => (r.blocker ? -1 : rowOwed(r) ?? -1), numeric: true,
      render: (r) => {
        if (r.blocker) return <span className="dash">—</span>;
        const owed = rowOwed(r);
        // Null is unpriced work, never nothing owed — `settlementAmount` would
        // have returned a number here by treating an unpriced session as zero,
        // which is how a coach gets paid less than the screen above says.
        if (owed == null) return <span className="dash">not priced</span>;
        return amount(owed, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>;
      } },
    { key: 'why', header: 'Status', value: (r) => r.blocker ?? '',
      render: (r) => (
        <span style={{ color: r.blocker ? 'var(--ink3)' : 'var(--ink2)', whiteSpace: 'normal' }}>
          {r.blocker ?? [
            r.outstanding.length ? `${r.outstanding.length} session${r.outstanding.length === 1 ? '' : 's'}` : null,
            r.classes.length ? `${r.classes.length} class${r.classes.length === 1 ? '' : 'es'}` : null,
            r.adjustments.length ? `${r.adjustments.length} adjustment${r.adjustments.length === 1 ? '' : 's'}` : null,
          ].filter(Boolean).join(', ') + ' unpaid'}
        </span>
      ) },
    { key: 'pay', header: '', value: () => 0, align: 'right',
      render: (r) => (
        <button
          disabled={!!r.blocker || settling === r.trainerId}
          onClick={() => onSettle(r)}
          style={{
            background: r.blocker ? 'var(--surface2)' : 'var(--brand)',
            color: r.blocker ? 'var(--ink3)' : 'var(--brand-ink)',
            border: 'none', borderRadius: 0, padding: '7px 12px', fontSize: 12.5,
            fontWeight: 600, cursor: r.blocker ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            fontFamily: 'var(--sans)',
          }}
        >
          {settling === r.trainerId ? 'Recording…' : 'Mark as paid'}
        </button>
      ) },
  ];

  return (
    <Section
      title="The run"
      sub="What each trainer's marked sessions in this period are worth, and what of it is still outstanding. Settling stamps those exact sessions."
    >
      {rows === null ? (
        // "Nothing outstanding" is the most expensive wrong sentence on this
        // page: it says every trainer is square, and the owner closes the tab.
        <Unresolved state={unread ?? 'loading'} what="the session record, so what anybody is owed is not known. Nothing here is settled or unsettled until it can be" />
      ) : (
        <>
          {rosterUnread ? (
            <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
              {rosterUnread === 'loading'
                ? 'Still reading the roster — a trainer with no sessions this period may not be listed yet.'
                : 'The roster did not come back, so this run covers only trainers who appear in the period’s own sessions. A trainer who delivered nothing this month is missing from the list rather than shown with nothing owed.'}
            </p>
          ) : null}
          {/* Beside the buttons it describes, not buried in a dialog: whoever
              presses Mark as paid is the only person who knows how the money
              moved, and the record is read back months later by somebody
              reconciling a bank statement against it. */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            padding: '10px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink2)',
          }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              Paid by
              <select
                value={method}
                onChange={(e) => onMethod(e.target.value as SettlementMethod)}
                style={field}
              >
                {SETTLEMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{SETTLEMENT_METHOD_LABEL[m]}</option>
                ))}
              </select>
            </label>
            <span style={{ color: 'var(--ink3)' }}>
              recorded against whichever run you settle next, and shown on Accounting as how this
              money left the gym.
            </span>
          </div>
          <DataTable rows={rows} columns={cols} rowKey={(r) => r.trainerId} empty="Nobody delivered anything in this period." />
        </>
      )}
    </Section>
  );
}

/**
 * What the period's marked work is worth for one trainer.
 *
 * Null — a dash — rather than a partial sum whenever the line has anything
 * unmarked or anything payable it could not price. A partial sum on a payroll
 * row is the fabricated number this codebase exists to refuse: it is smaller
 * than the truth and it looks exactly like the truth.
 */
/**
 * What this run would hand over, or null when part of it cannot be priced.
 *
 * Null and not a smaller number. `settlementAmount` prices an unpriced session
 * at zero through its `?? 0`, which is unreachable for anything
 * `settleableSessions` returns and would still be the wrong shape here — a run
 * containing work nobody has priced is not a smaller run, it is one that must
 * not be handed over.
 */
function rowOwed(r: RunRow): number | null {
  if (r.outstanding.some((s) => s.rateCents == null)) return null;
  const cents = runTotal({
    sessionCents: settlementAmount(r.outstanding),
    sessions: r.outstanding.length,
    classCents: r.classes.reduce((a, c) => a + c.amountCents, 0),
    classes: r.classes.length,
    adjustmentCents: r.adjustments.reduce((a, x) => a + x.amountCents, 0),
    adjustments: r.adjustments.length,
  });
  return cents;
}

function periodCents(r: RunRow): number | null {
  if (!r.line) return null;
  if (r.line.unmarked > 0) return null;
  if (r.line.priced < r.line.payable) return null;
  return r.line.cents;
}

/* ── the evidence ──────────────────────────────────────────────────────────── */

const OUTCOME_LABEL: Record<string, string> = {
  completed: 'Delivered',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  late_cancelled: 'Late cancel',
};

/**
 * Every marked session in the period, line by line.
 *
 * The run above is a set of totals, and a trainer who disagrees with a total
 * needs the rows it was made of — which session, what was recorded, at what
 * rate, and whether the pay policy let it count. Without this the only way to
 * answer "why is my August short" is to trust the total.
 */
function LineItems({ sessions, unread, policy, ccy }: {
  sessions: PtSession[] | null; unread: Unread; policy: PayPolicy; ccy: TenantCurrency;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '',
      render: (s) => s.trainerName ?? <span className="dash">—</span> },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'outcome', header: 'Recorded', value: (s) => s.outcome ?? '',
      render: (s) => (
        <span style={{ color: isDelivered(s) ? 'var(--good)' : 'var(--ink2)' }}>
          {s.outcome ? OUTCOME_LABEL[s.outcome] ?? s.outcome : <span className="dash">—</span>}
        </span>
      ) },
    { key: 'counts', header: 'Counts', value: (s) => (isPayable(s, policy) ? 1 : 0), numeric: true,
      // Under this gym's stated policy, not under a default. A no-show counts or
      // does not because somebody ticked a box on this page, and the row says
      // which way it went rather than leaving the total to imply it.
      render: (s) => isPayable(s, policy)
        ? <span style={{ color: 'var(--ink2)' }}>yes</span>
        : <span className="dash">no</span> },
    { key: 'rate', header: 'Rate', value: (s) => s.rateCents ?? null, numeric: true,
      // Null is a session nobody priced, which is not a session worth nothing.
      render: (s) => s.rateCents == null
        ? <span className="dash">not rated</span>
        : (amount(s.rateCents, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>) },
    { key: 'paid', header: 'Settled', value: (s) => s.settlementId ?? '',
      render: (s) => s.settlementId
        ? <span style={{ color: 'var(--ink2)' }}>paid</span>
        : <span className="dash">outstanding</span> },
  ];
  return (
    <Section
      title="Line items"
      sub="Every session in this period that somebody recorded an outcome for — the rows the totals above are made of."
    >
      {sessions === null ? (
        <Unresolved state={unread ?? 'loading'} what="the session record, so there are no line items to show" />
      ) : (
        <DataTable rows={sessions} columns={cols} rowKey={(s) => s.id} empty="Nothing in this period has been marked yet." />
      )}
    </Section>
  );
}

/* ── the second opinion ────────────────────────────────────────────────────── */

/**
 * The roster's own 30-day payroll figure, beside the run.
 *
 * Deliberately a different window from the period above, and said so out loud
 * rather than quietly aligned: it is computed by a different module from a
 * different query, so when the two disagree by more than the window explains,
 * one of them is wrong and the owner should find out which before paying
 * anybody. Presenting them as the same number would hide exactly that.
 */
function CrossCheck({ trainers, unread, sessionFee, gymError, ccy }: {
  trainers: GymTrainer[] | null; unread: Unread; sessionFee: number | null;
  gymError: string | null; ccy: TenantCurrency;
}) {
  // MAJOR units, not cents. tenants.session_fee is a numeric in whole currency
  // (default 75 = AED 75), and payroll30For returns delivered * fee — so 84
  // sessions at 75 is 6,300, not 630,000. This was named `cents` and passed to
  // money(), which divides by 100: the payroll screen showed AED 63.00 where
  // the gym owed AED 6,300. A hundredfold understatement on the one screen
  // whose entire job is to be right about what people are paid.
  const major = trainers ? payroll30For(trainers, sessionFee) : null;
  const why = trainers
    ? (gymError && sessionFee == null
        ? `Your gym could not be read, so there is no session fee to price it with: ${gymError}`
        : payrollBlocker(trainers, sessionFee) ?? (major != null && !ccy ? NO_CURRENCY_NOTE : null))
    : null;

  const cols: Column<GymTrainer>[] = [
    { key: 'name', header: 'Trainer', value: (t) => t.name },
    { key: 'clients', header: 'Clients', value: (t) => t.clients, numeric: true },
    { key: 'booked', header: 'Booked & passed', value: (t) => t.sessions30, numeric: true },
    { key: 'delivered', header: 'Delivered', value: (t) => t.delivered30, numeric: true },
    { key: 'unmarked', header: 'Unmarked', value: (t) => t.unmarked30, numeric: true,
      render: (t) => t.unmarked30 === 0
        ? <span className="dash">—</span>
        : <span style={{ color: 'var(--warn)' }}>{t.unmarked30}</span> },
    { key: 'since', header: 'Since', value: (t) => t.since ?? '',
      render: (t) => t.since
        ? new Date(t.since).toLocaleDateString([], { month: 'short', year: 'numeric' })
        : <span className="dash">—</span> },
  ];

  return (
    <Section
      title="Roster, last 30 days"
      sub="A second reading of the same money, over a rolling 30 days rather than the period above. The two windows do not line up, and are not meant to — this is here to be disagreed with."
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="micro">30-day payroll</span>
        <span className="mono" style={{ fontSize: 18, color: major == null ? 'var(--ink3)' : 'var(--ink)' }}>
          {/* The same refusal as the run above, from the module that owns this
              window: unmarked sessions or no fee means a dash, never a figure. */}
          {(major != null && amount(Math.round(major * 100), ccy)) || '—'}
        </span>
        {why ? <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>{why}</span> : null}
      </div>
      {trainers === null ? (
        <Unresolved state={unread ?? 'loading'} what="the roster, so there is no second reading to check the run against" />
      ) : (
        <DataTable rows={trainers} columns={cols} rowKey={(t) => t.id} empty="No trainers on the roster." />
      )}
    </Section>
  );
}

/* ── what has already gone out ─────────────────────────────────────────────── */

/**
 * What has been paid, and the way back from a run that should not have been.
 *
 * `recordSettlement` was insert-only, all-or-nothing, with no reverse. Pressing
 * "Mark as paid" before the money actually moves stamps every session in the
 * run permanently and drops them all out of "Owed now" — so the coach is shown
 * as settled, the sessions can never be paid again, and the only way back was
 * editing rows in the Supabase dashboard.
 *
 * Reversing is four writes in a fixed order and `reverseSettlement` holds the
 * argument for it: the sessions, the class lines and the adjustments are
 * unstamped FIRST and the settlement is marked reversed last. The other order
 * would mark the run reversed while its sessions were still stamped against it,
 * which excludes them from "Owed now" for ever — a coach silently never paid,
 * by the feature that exists to fix having paid them too early.
 *
 * The settlement row is never deleted. It is a statement that money went out;
 * deleting it leaves neither the statement nor the withdrawal.
 */
function Paid({ runs, unread, sessionsUnread, period, me, onChange, onErr }: {
  runs: Settlement[] | null; unread: Unread; sessionsUnread: Unread; period: Period;
  me: Me; onChange: () => void; onErr: (s: string | null) => void;
}) {
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const doReverse = async (r: Settlement) => {
    const why = reversalReasonBlocker(reason);
    if (why) { onErr(why); return; }
    setBusy(true);
    try {
      await reverseSettlement(supabase, r.id, reason, me.id);
      onErr(null);
      setUndoing(null);
      setReason('');
      onChange();
    } catch (e: any) {
      onErr(`That run was NOT reversed: ${e?.message ?? 'the write was refused'}. It still stands as paid, and its sessions are still stamped against it.`);
    } finally { setBusy(false); }
  };

  const cols: Column<Settlement>[] = [
    { key: 'when', header: 'Paid', value: (r) => r.settledAt,
      render: (r) => new Date(r.settledAt).toLocaleDateString() },
    { key: 'period', header: 'Covering', value: (r) => r.periodFrom,
      render: (r) => `${r.periodFrom} → ${r.periodTo}` },
    { key: 'n', header: 'Sessions', value: (r) => r.sessionsCount, numeric: true },
    // The label, not the column value: "payroll" and "transfer" are the words
    // the table stores, and "through payroll" is what the owner said.
    { key: 'method', header: 'How', value: (r) => r.method,
      render: (r) => SETTLEMENT_METHOD_LABEL[r.method] ?? r.method },
    { key: 'amount', header: 'Amount', value: (r) => r.amountCents, numeric: true,
      // Snapshotted at the time, never recomputed — a later fee change must not
      // rewrite what actually left the account. The CURRENCY is snapshotted on
      // the row too, and dropping it printed every past run in the money the
      // helper defaults to rather than the money that actually left. The
      // coach's own copy of this table (/coach/earnings) always passed it, so
      // one row was being shown two ways.
      // A run that records no currency at all is a dash with the reason, not an
      // empty cell: money() returns null there, and a blank beside an Amount
      // column reads as nothing having been paid.
      render: (r) => money(r.amountCents, r.currency)
        ?? <span className="dash">— this run records no currency</span> },
    { key: 'undo', header: '', value: () => 0, align: 'right',
      render: (r) => undoing === r.id ? (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'normal' }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="Why this run is being taken back"
                 style={{ ...field, padding: '3px 5px', fontSize: 12, width: 240 }}
                 aria-label="Why this settlement is being reversed" />
          <button style={linkBtn} disabled={busy || !reason.trim()} onClick={() => doReverse(r)}>Reverse</button>
          <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => setUndoing(null)}>Cancel</button>
        </span>
      ) : (
        <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => { onErr(null); setUndoing(r.id); }}>
          Reverse
        </button>
      ) },
  ];
  return (
    <Section
      title={`Already paid for ${period.label}`}
      sub="Matched by the run stamped on this period's own sessions, not by comparing dates. Amounts are as they were when the money went out."
    >
      {runs === null ? (
        // The two failures behind an empty list are different errands, and
        // neither of them is "nobody has been paid": that sentence's obvious
        // remedy is to pay everybody again.
        <Unresolved
          state={(sessionsUnread ?? unread) ?? 'loading'}
          what={sessionsUnread
            ? 'the session record, so nothing can be matched to a run that paid for it'
            : 'what has already been paid. Do not pay anybody a second time on the strength of this page — reload first'}
        />
      ) : (
        <>
          <DataTable rows={runs} columns={cols} rowKey={(r) => r.id} empty="Nothing in this period has been paid yet." />
          {runs.length ? (
            <p style={{ margin: 0, padding: '11px 14px', borderTop: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '80ch' }}>
              Reversing a run puts its sessions, classes and adjustments straight back into
              &ldquo;Owed now&rdquo; and keeps the settlement row, marked reversed, with the reason
              on it. It does not move any money &mdash; if the payment actually left the account,
              recovering it is between the gym and the coach, and an advance is the adjustment kind
              for recording that.
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

/* ── shared bits (same shapes as the Sessions and Door screens) ────────────── */

const field = {
  padding: '7px 10px', borderRadius: 0, fontSize: 13,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 12.5, fontFamily: 'var(--sans)',
} as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, text, note }: { label: string; text: string | null; note?: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
      <div className="micro">{label}</div>
      <div className="mono" style={{ fontSize: 21, marginTop: 5, letterSpacing: '-0.02em', color: text == null ? 'var(--ink3)' : 'var(--ink)' }}>
        {text ?? '—'}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 3 }}>{note}</div> : null}
    </div>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone?: 'crit' }) {
  return (
    <div style={{
      margin: '14px 0', padding: '11px 14px', borderRadius: 0, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read used to fall through to the table's own empty line, so "we
 * could not ask" and "the gym has none" were the same sentence on screen. On a
 * payroll run those are an owner who reloads and an owner who pays a month
 * twice.
 */
function Unresolved({ state, what }: { state: Exclude<Unread, null>; what: string }) {
  return (
    <div style={{ padding: '26px 20px', color: 'var(--ink3)', fontSize: 13 }}>
      {state === 'loading' ? 'Loading…' : `Not shown: could not read ${what}. The banner above says why.`}
    </div>
  );
}
