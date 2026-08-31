'use client';

// Earnings — what one coach has earned in a chosen month, what of it has
// already been paid, and what is holding the rest up.
//
// /payroll is the same money read from the gym's side: every trainer on one
// screen, with a button that hands money over. This is the other side of it,
// and it is deliberately smaller and read-only. A coach does not need the
// roster, does not need anybody else's rates, and must never be handed a
// control that records their own pay. What a coach needs is the answer to one
// question asked at the end of every month — "is that right?" — and the rows
// that answer it.
//
// Two rules do all the work here.
//
// SCOPED TO THE SIGNED-IN COACH, IN THE QUERY. Every read below carries
// .eq('trainer_id', me.id) as well as the tenant. Not a filter applied to a
// tenant-wide read after it lands: a tenant-wide read pulls every colleague's
// sessions and rates into this browser, and one missing .filter() away from
// there is a coach reading another coach's book. The in-memory filter that
// follows each read is a second belt, not the first one.
//
// A PARTIAL SUM IS WORSE THAN NO SUM. When anything in the month is still
// unmarked, the outstanding figure is a dash with the reason beside it, never
// a number. The number would be real arithmetic over the sessions somebody
// did mark — and it would be smaller than what the coach is owed, look exactly
// like a final figure, and be read as being underpaid. The reason comes from
// settlementBlocker and is printed word for word, because "3 sessions still
// need an outcome recorded." tells a coach what to chase and "—" alone does
// not.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { amount, currencyNote, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import {
  isDelivered, isAwaitingOutcome, isPayable,
  payrollByTrainer, payrollTotal, settlementBlocker,
  settleableSessions, settlementAmount, settleBlocker,
  PAY_DELIVERED_ONLY,
  type PtSession, type PayPolicy, type Settlement,
} from '@lib/gymSessions';
import { money } from '@lib/gymRecord';
import { isoDate } from '@lib/format';
import { assertWhole, capLimit } from '@lib/rowCap';

/** How many months back a coach can look. */
const PERIODS = 12;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "Nothing has been paid for this month yet" are both lies about a query that
 * errored — and the second one sends a coach to argue with their gym about a
 * payment that may well have been made.
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
  fromDate: string;
  toDate: string;
}

/**
 * The last few calendar months, in the gym's timezone.
 *
 * Local, not UTC, and for the same reason the door log and the payroll run are:
 * this product sells in AED, so the desk is four hours ahead and the UTC month
 * does not turn over until 04:00 on the 1st. Built from UTC bounds, every
 * session a coach delivered in the first four hours of the 1st would show up in
 * the previous month — and a coach checking a payslip against this screen would
 * find an hour missing from one month and an extra hour in another.
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

/* ── reads, scoped to one coach ────────────────────────────────────────────── */

/** The names, and whether the read that was meant to supply them happened. */
interface ClientNames {
  names: Map<string, string>;
  /** Null when the read came back. A sentence when it did not. */
  unread: string | null;
}

/**
 * Client names for a set of session rows.
 *
 * Not a PostgREST embed: `clients` carries no full_name, and sessions reaches it
 * through two foreign keys, so the embed is both wrong and ambiguous. Ids out,
 * profiles in — the shape gymSessions uses.
 *
 * A failure here is deliberately not fatal. A name is a label on a row whose
 * subject is money; losing it must not black out a figure that is perfectly
 * readable without it.
 *
 * But it is not silent either, and it used to be. The error was swallowed and
 * an empty map returned, and an empty map is indistinguishable from a
 * successful read — so a refused profiles query rendered every row's client as
 * the same em dash that a session with NO CLIENT ON IT shows. Two different
 * facts, one glyph, and on this screen they are not close: "this hour was not
 * against anybody" is a thing the coach knows about their own week, and "we
 * could not read who this was" is a reason to reload. So the failure travels
 * with the names and the table says which it is.
 *
 * A name MISSING from a read that succeeded is a third thing again, and it is
 * normal rather than a fault. Verified against the live database: a coach
 * reaches `profiles` through `profiles_trainer_read` and
 * `profiles_trainer_r_clients`, both of which are scoped to their own clients,
 * so a session against somebody who is no longer on their roster comes back
 * without a name and is entitled to. Asking for three ids and getting two is
 * not truncation and is not treated as it.
 */
async function clientNames(ids: string[]): Promise<ClientNames> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { names: new Map(), unread: null };
  // Capped, though it cannot truncate in practice: `unique` is bounded by one
  // coach's sessions in one month. If it ever did come back at the ceiling,
  // half the rows would be named and half would show the "not named" dash,
  // which is the one outcome this whole function is being rewritten to avoid.
  const { data, error } = await supabase
    .from('profiles').select('id, full_name').in('id', unique).limit(capLimit());
  if (error) {
    return { names: new Map(), unread: error.message || 'the names could not be read' };
  }
  let rows: Array<{ id: string; full_name: string | null }>;
  try {
    rows = assertWhole(data, 'the names of your clients');
  } catch (e: any) {
    return { names: new Map(), unread: e?.message ?? 'the names could not be read whole' };
  }
  const m = new Map<string, string>();
  for (const p of rows) {
    const name = (p.full_name ?? '').trim();
    if (p.id && name) m.set(p.id, name);
  }
  return { names: m, unread: null };
}

/**
 * This coach's sessions in one month.
 *
 * gymSessions.fetchSessions is tenant-scoped, which is right for the owner's
 * payroll run and wrong here twice over: it would put every colleague's rates
 * in this browser, and for an owner who also coaches it would silently widen
 * this screen from "your month" to "the gym's month" without the heading
 * changing. trainer_id is in the query.
 */
/** A month's sessions, and whether the names on them could be read. The two
 *  travel together because a screen that has one without the other cannot tell
 *  an unnamed row from an unreadable one. */
interface MyMonth {
  sessions: PtSession[];
  namesUnread: string | null;
}

async function fetchMySessions(
  tenantId: string, trainerId: string, fromIso: string, toIso: string,
): Promise<MyMonth> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, settlement_id')
    .eq('tenant_id', tenantId)
    .eq('trainer_id', trainerId)
    .gte('starts_at', fromIso)
    .lte('starts_at', toIso)
    .order('starts_at', { ascending: false });
  // supabase-js resolves on a database error rather than rejecting. Reading only
  // `data` would turn a refused read into an empty month — a coach told they
  // delivered nothing in August.
  if (error) throw error;

  const rows = (data ?? []) as any[];
  // Second belt. The query above is the guard; if it ever stops being, this
  // stops a colleague's session reaching the screen rather than merely making
  // the total wrong.
  const mine = rows.filter((r) => r.trainer_id === trainerId);
  const { names, unread } = await clientNames(mine.map((r) => r.client_id).filter(Boolean));

  return { namesUnread: unread, sessions: mine.map((r) => ({
    id: r.id,
    trainerId: r.trainer_id,
    trainerName: null,
    clientId: r.client_id ?? null,
    clientName: r.client_id ? names.get(r.client_id) ?? null : null,
    startsAt: r.starts_at,
    durationMin: r.duration_min ?? 60,
    status: r.status,
    outcome: r.outcome ?? null,
    outcomeAt: r.outcome_at ?? null,
    rateCents: r.rate_cents ?? null,
    settlementId: r.settlement_id ?? null,
  })) };
}

/**
 * What this coach has actually been paid. Their own rows and nobody else's.
 *
 * The `.limit(100)` is a deliberate prefix, not an accident of the cap, and
 * src/lib/rowCap.ts's rule — a limit the caller asked for is not a set that was
 * cut off behind its back — applies. It is safe because of what these rows are
 * USED for and nothing else: `paidHere` keeps only the settlements whose ids
 * are stamped on sessions in the selected month, and the month is one of the
 * last few. A settlement covering a session that recent cannot be older than
 * the hundredth most recent run against this one coach, which for monthly
 * payroll is eight years. Nothing here totals the list, and nothing says "these
 * are all your payments"; widening the period picker past a hundred payment
 * runs is what would make this wrong.
 */
async function fetchMySettlements(tenantId: string, trainerId: string): Promise<Settlement[]> {
  const { data, error } = await supabase
    .from('payroll_settlements')
    .select('id, trainer_id, period_from, period_to, amount_cents, currency, sessions_count, method, note, settled_at')
    .eq('tenant_id', tenantId)
    .eq('trainer_id', trainerId)
    .order('settled_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as any[])
    .filter((r) => r.trainer_id === trainerId)
    .map((r) => ({
      id: r.id,
      trainerId: r.trainer_id,
      periodFrom: r.period_from,
      periodTo: r.period_to,
      amountCents: r.amount_cents ?? 0,
      // Not `?? 'AED'`. This is what a coach was actually handed. The column is
      // NOT NULL and — since supabase/parts/150 — has NO DEFAULT, so a
      // settlement that does not name its currency is rejected rather than
      // filed as dirhams, and the branch below does not fire in practice. "In
      // practice" is what every currency bug in this repo was made of, so it is
      // still written: null reaches money(), which withholds the figure rather
      // than denominating somebody's pay for them.
      currency: r.currency ?? null,
      sessionsCount: r.sessions_count ?? 0,
      method: r.method ?? 'transfer',
      note: r.note ?? null,
      settledAt: r.settled_at,
    }));
}

/* ── the screen ────────────────────────────────────────────────────────────── */

export default function CoachEarnings() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  // `tenants.currency`, null when the gym has not set one. The settlement rows
  // at the bottom carry their own currency and use it; everything derived from
  // the session fee has none of its own and inherits the gym's.
  const [ccy, setCcy] = useState<TenantCurrency>(null);

  // "The gym has not set a session fee" and "we could not read the gym" both
  // leave sessionFee null, and they are different errands: one is a setting the
  // owner must fill in, the other is a read to retry. Without this string the
  // screen tells a coach to go and ask for a fee that is probably already set.
  const [gymError, setGymError] = useState<string | null>(null);

  const periods = useMemo(() => periodsBack(PERIODS), []);
  const [periodKey, setPeriodKey] = useState(periods[0].key);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];

  const [sessions, setSessions] = useState<PtSession[] | null>(null);
  const [runs, setRuns] = useState<Settlement[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  // Carried apart from `sessionsErr` because it is a different failure with a
  // different cost: the sessions are readable and every figure on this screen
  // is right, and the only thing missing is who each hour was with. Folding it
  // into the banner would tell a coach their month could not be read.
  const [namesErr, setNamesErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /**
   * Read the month.
   *
   * `stale` is not tidiness. Switching from August to July while August is still
   * in flight would otherwise let the slower answer land last, painting August's
   * sessions under July's heading and July's total. On a screen a coach checks a
   * payslip against, that is a month's pay shown as the wrong month's.
   */
  const load = useCallback(async (
    tenantId: string, trainerId: string, p: Period, stale: () => boolean = () => false,
  ) => {
    setSessions(null); setRuns(null); setNamesErr(null);

    // allSettled, not all: one failing read must not take the other with it.
    // Under Promise.all a refused payroll_settlements query would also empty the
    // sessions — so a screen whose only fault was not knowing what had been paid
    // would instead report a month with no work in it, and the two wrong facts
    // point opposite ways.
    const [sRes, rRes] = await Promise.allSettled([
      fetchMySessions(tenantId, trainerId, p.fromIso, p.toIso),
      fetchMySettlements(tenantId, trainerId),
    ]);

    if (stale()) return;

    // A read that failed is null, never []. [] is the gym saying there were
    // none; null is nobody knowing. Here those two answers differ by a month's
    // wages.
    setSessions(sRes.status === 'fulfilled' ? sRes.value.sessions : null);
    setNamesErr(sRes.status === 'fulfilled' ? sRes.value.namesUnread : null);
    setRuns(rRes.status === 'fulfilled' ? rRes.value : null);

    const s = failure(sRes, 'your sessions for this month');
    const r = failure(rRes, 'what you have already been paid');
    setSessionsErr(s); setRunsErr(r);

    const trouble = [s, r].filter((x): x is string => x !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) return;
      const { data: g, error } = await supabase
        .from('tenants').select('name, session_fee, currency').eq('id', who.tenantId).single();
      if (!live) return;
      setGymName(error ? null : g?.name ?? null);
      setSessionFee(error ? null : g?.session_fee ?? null);
      setCcy(error ? null : ((((g as any)?.currency ?? '') as string).trim().toUpperCase() || null));
      setGymError(error ? (error.message || 'Could not read your gym.') : null);
    })();
    return () => { live = false; };
  }, []);

  // The month is a dependency on purpose: changing it is a fresh read, not a
  // filter over rows already in hand. Filtering would show August's sessions
  // under September's heading until something else happened to trigger a load.
  useEffect(() => {
    if (me === undefined) return;
    if (!me?.tenantId) { setSessions([]); setRuns([]); setNamesErr(null); return; }
    let dropped = false;
    load(me.tenantId, me.id, period, () => dropped);
    return () => { dropped = true; };
  }, [me, period, load]);

  // The gym's fee is in major units; everything downstream is minor units.
  const fallbackCents = sessionFee == null ? null : Math.round(sessionFee * 100);

  /**
   * The pay policy this screen reads by, stated rather than chosen.
   *
   * /payroll gives the owner a toggle for no-shows and late cancellations,
   * because it is a gym decision. It is not a coach decision, and a toggle here
   * would let a coach raise their own figure by ticking a box — so this screen
   * takes the conservative position, counts no-shows and late cancellations
   * separately, and says out loud that the gym may pay for them.
   */
  const policy: PayPolicy = PAY_DELIVERED_ONLY;

  // Stays null while `sessions` is null rather than collapsing to []. Handing
  // payrollByTrainer an empty array produces a confident, complete-looking month
  // in which nothing is owed, built out of a read that never returned.
  const lines = useMemo(
    () => sessions && payrollByTrainer(sessions, policy, fallbackCents),
    [sessions, policy, fallbackCents],
  );
  const total = useMemo(() => payrollTotal(lines ?? []), [lines]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  // A refused profile read is not a statement about who somebody is.
  //
  // `roleUnknown` exists in lib/supabase.ts for exactly this branch, and these
  // three coach screens were the only ones in the console without it: the
  // fifteen owner pages all carry it. Without it, an RLS hiccup on `profiles`
  // arrived as `role: null`, fell into the refusal below, and told a working
  // coach "your account is not a coaching account" — a claim about them, made
  // out of a query that failed.
  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/coach/earnings">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not being a coach. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'trainer' && me.role !== 'owner') {
    // A plain sentence, not empty tables. Empty tables read as "you have earned
    // nothing", which is a far worse thing to tell somebody than "wrong screen".
    return (
      <Shell me={me} gymName={gymName} current="/coach/earnings">
        <h1>This screen is for coaches</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: 560 }}>
          Earnings shows one coach&rsquo;s delivered sessions and what they are owed for them.
          Your account is not a coaching account, so there is no book to show — that is not the
          same as a book with nothing in it.
        </p>
      </Shell>
    );
  }

  // An account with no gym on it gets a sentence, not an earnings board.
  //
  // The effect above sets sessions and runs to [] in this case, so the screen
  // read "Sessions delivered 0", "Nothing waiting — every finished session this
  // month has an outcome" and "No payment has been recorded against this
  // month's sessions yet." to a coach whose profile simply carries no
  // tenant_id. Every one of those is a statement about their pay, made out of
  // a query that was never run.
  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} current="/coach/earnings">
        <h1>My earnings</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          Your account is not linked to a gym, so there are no sessions to price
          and no settlements to read. This is not a month in which you earned
          nothing — it is an account with no gym on it. The gym&rsquo;s owner
          sets that.
        </p>
      </Shell>
    );
  }

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread = (rows: unknown[] | null, e: string | null): Unread =>
    rows !== null ? null : e ? 'failed' : 'loading';

  const sessionsUnread = unread(sessions, sessionsErr);
  const runsUnread = unread(runs, runsErr);

  /*
   * Why the month has no outstanding figure, in words the coach can act on.
   *
   * settlementBlocker's own sentences, printed verbatim — "4 sessions still need
   * an outcome recorded." is the whole point of the dash beside it. Two things
   * it cannot know, because it sees only the sessions: with `sessions` null it
   * would answer "No payable sessions in this period." about a month nobody
   * managed to read, and when payable sessions have no rate it says "set a
   * session fee", which is the wrong errand when the fee is missing because the
   * gym row could not be read.
   */
  const blocker =
    sessions === null
      ? null
      : gymError && total.priced < total.payable
        ? `Your gym could not be read, so there is no session fee to price the rest with: ${gymError}`
        : settlementBlocker(total);

  // Marked, payable, priced, and not already stamped with a payment. Paying by
  // session rather than by period is what stops a late-marked session being paid
  // twice — and it is why a coach's outstanding figure can be right even when a
  // previous month was settled before they finished marking it.
  const outstanding = sessions ? settleableSessions(sessions, policy) : null;

  /*
   * The outstanding figure, and the single most important decision on this
   * screen.
   *
   * A dash whenever anything blocks it — not only when the sum comes back null.
   * With sessions unmarked, settlementAmount over `outstanding` is a real sum
   * over the sessions somebody did mark: it looks final, it is smaller than the
   * truth, and a coach reading it concludes they are being short-paid. The
   * honest answer is that this month does not have a figure yet, and the reason
   * beside the dash says which sessions are missing.
   */
  const outstandingText =
    sessions === null || outstanding === null || blocker !== null
      ? null
      : amount(settlementAmount(outstanding), ccy);

  // Sessions in this month already stamped with a payment, and what their own
  // snapshotted rates say those were worth. A rate missing on a settled session
  // means this cannot be totalled — a dash, not a smaller number, for the same
  // reason as above.
  const settledSessions = sessions ? sessions.filter((s) => s.settlementId != null) : null;
  const settledUnpriced = settledSessions ? settledSessions.filter((s) => s.rateCents == null).length : 0;
  const settledCents =
    settledSessions === null || settledUnpriced > 0
      ? null
      : settledSessions.reduce((a, s) => a + (s.rateCents ?? 0), 0);

  // The payments themselves, matched by the id stamped on this month's own
  // sessions rather than by comparing dates. A run recorded on the 2nd for last
  // month's work belongs to last month, and a date comparison files it here.
  const paidHere = (() => {
    if (!sessions || !runs) return null;
    const ids = new Set(sessions.map((s) => s.settlementId).filter((x): x is string => x != null));
    return runs.filter((r) => ids.has(r.id));
  })();

  const awaiting = sessions ? sessions.filter((s) => isAwaitingOutcome(s)) : null;
  const marked = sessions ? sessions.filter((s) => s.outcome !== null) : null;
  const line = lines?.[0] ?? null;
  const notPaidByPolicy = line ? line.noShows + line.cancelled : 0;

  const refresh = () => load(me.tenantId!, me.id, period);

  return (
    <Shell me={me} gymName={gymName} current="/coach/earnings">
      <h1>Earnings</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: 640 }}>
        Your {period.label}: what you delivered, what has been paid, and what is
        still outstanding. Only sessions with a recorded outcome reach a figure —
        a booked slot whose time has passed is not a delivered session, and this
        screen will not price one as though it were.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      {me.role === 'owner' ? (
        <Banner>
          You are signed in as the owner, and this screen is scoped to{' '}
          <strong style={{ color: 'var(--ink)' }}>your own</strong> sessions — the ones booked
          against you as a coach, not the gym&rsquo;s. Everybody&rsquo;s pay is on{' '}
          <a href="/payroll">Payroll</a>.
        </Banner>
      ) : null}

      {gymError ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>Your gym could not be read</strong>, so this
          month does not know the standard session fee: {gymError}. Anything that needed the fee to
          price it is shown as unpriced rather than as worth nothing. This is not the same as your
          gym having no fee set — reload the page.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 0' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--ink2)' }}>
          Month
          <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} style={field}>
            {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
          {period.fromDate} → {period.toDate}
        </span>
      </div>

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 10px',
        }}
      >
        <Kpi
          label="Sessions delivered"
          text={sessions ? String(total.delivered) : null}
          note={sessions ? 'outcome recorded as completed' : undefined}
        />
        <Kpi
          label="Awaiting an outcome"
          text={sessions ? String(total.unmarked) : null}
          note={
            sessions === null ? undefined
              : total.unmarked > 0 ? 'these are what hold the rest up'
              : 'nothing unmarked'
          }
        />
        <Kpi
          label="Already settled"
          text={amount(settledCents, ccy)}
          note={
            settledSessions === null
              ? undefined
              : settledUnpriced > 0
                ? `${settledUnpriced} of ${settledSessions.length} paid sessions carry no rate, so this month's paid total cannot be added up`
                : settledSessions.length === 0
                  ? 'no session this month carries a payment yet'
                  : currencyNote(settledCents, ccy)
                    ?? `${settledSessions.length} session${settledSessions.length === 1 ? '' : 's'} stamped with a payment`
          }
        />
        <Kpi
          label="Outstanding"
          text={outstandingText}
          // No note at all while the month is unknown: "nothing outstanding" over
          // a read that never returned is the worst sentence available here.
          note={
            sessions === null
              ? undefined
              : blocker
                ? blocker
                : settleBlocker(outstanding ?? [], total.unmarked)
                  ?? currencyNote(settlementAmount(outstanding ?? []), ccy)
                  ?? `${outstanding?.length ?? 0} session${(outstanding?.length ?? 0) === 1 ? '' : 's'} marked, priced, and not yet paid`
          }
        />
      </div>

      {blocker && total.unmarked > 0 ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>This month has no outstanding figure yet.</strong>{' '}
          {blocker} Those sessions are listed below. The figure is a dash rather than a number on
          purpose: adding up only the marked ones would give you a total smaller than what you are
          owed, and it would look exactly like a final one.
        </Banner>
      ) : blocker ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>No outstanding figure for this month.</strong>{' '}
          {blocker}
        </Banner>
      ) : null}

      {notPaidByPolicy > 0 ? (
        <Banner>
          {notPaidByPolicy} session{notPaidByPolicy === 1 ? '' : 's'} this month{' '}
          {notPaidByPolicy === 1 ? 'was' : 'were'} recorded as a no-show or a cancellation, and{' '}
          {notPaidByPolicy === 1 ? 'is' : 'are'} not counted as payable above. Whether your gym pays
          for a no-show or a late cancellation is its own policy, and this screen cannot read it —
          so it takes the narrow view. If your gym does pay for those, your figure is higher than
          the one shown here, not lower.
        </Banner>
      ) : null}

      {namesErr ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>Your clients&rsquo; names could not be read.</strong>{' '}
          Every figure on this page is unaffected — the names are a label on the rows, not part of
          the arithmetic — but the sessions below say &ldquo;name not read&rdquo; rather than who
          they were with. That is deliberately not the same dash as a session booked against
          nobody. {namesErr}
        </Banner>
      ) : null}

      <Blocking sessions={awaiting} unread={sessionsUnread} namesUnread={namesErr} ccy={ccy} />

      <LineItems sessions={marked} unread={sessionsUnread} namesUnread={namesErr} policy={policy} ccy={ccy} />

      <Paid runs={paidHere} unread={runsUnread} sessionsUnread={sessionsUnread} period={period} />

      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '0 0 30px', maxWidth: 640 }}>
        Nothing on this screen records an outcome or a payment. A figure marked
        settled here is settled because a payment run stamped these exact
        sessions, and outstanding means no run has. If a month looks wrong,
        this is the page to bring to your gym.{' '}
        <button style={linkBtn} onClick={refresh}>Reload the month</button>
      </p>
    </Shell>
  );
}

/**
 * The Client column, and the three different facts it has to be able to tell
 * apart.
 *
 * All three used to render the same em dash, which made the most alarming of
 * them invisible:
 *
 *   · the session has no client on it at all. Ordinary — a coach's own
 *     training, or a slot blocked out — and the coach already knows it;
 *   · the session has a client, the names read came back, and this one is not
 *     in it. Also ordinary, and the reason is in the database rather than in
 *     the code: a coach reads `profiles` through policies scoped to their own
 *     roster, so somebody who has since left it is a client they may no longer
 *     name. The row is right, the figure is right, the name is genuinely not
 *     available;
 *   · the names read FAILED. Nothing here is known, and the coach can fix it by
 *     reloading. Shown as the same dash as the two above, it was a fault
 *     reported as an ordinary fact about the week.
 *
 * The figures are untouched in every case: a name is a label, and a screen a
 * coach checks a payslip against must not black out because a label is missing.
 */
function clientColumn(namesUnread: string | null): Column<PtSession> {
  return {
    key: 'client',
    header: 'Client',
    // Sorted on the same three cases, so the rows whose name could not be read
    // group together instead of scattering through the alphabet as blanks.
    value: (s) => s.clientName ?? (s.clientId == null ? '' : namesUnread ? '\uffff\uffff' : '\uffff'),
    render: (s) => {
      if (s.clientName) return s.clientName;
      if (s.clientId == null) return <span className="dash" title="This session was not booked against a client.">—</span>;
      if (namesUnread) {
        return (
          <span className="dash" title={namesUnread}>— name not read</span>
        );
      }
      return <span className="dash" title="This session is against a client this console cannot name — usually somebody no longer on your roster.">— not named</span>;
    },
  };
}

/* ── what is holding the rest up ───────────────────────────────────────────── */

function Blocking({ sessions, unread, namesUnread, ccy }: {
  sessions: PtSession[] | null; unread: Unread; namesUnread: string | null; ccy: TenantCurrency;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleString([], {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) },
    clientColumn(namesUnread),
    { key: 'mins', header: 'Mins', value: (s) => s.durationMin, numeric: true },
    // Not "0.00" and not the gym's standard fee presented as earned: until
    // somebody says what happened, this session has no price, only a rate it
    // might turn out to be worth.
    { key: 'worth', header: 'If delivered', value: (s) => s.rateCents ?? -1, numeric: true,
      render: (s) => s.rateCents == null
        ? <span className="dash">not rated</span>
        : <span className="dash">{amount(s.rateCents, ccy) ?? NO_CURRENCY_NOTE}</span> },
  ];
  return (
    <Section
      title="Holding up your month"
      sub="Booked, finished, and nobody has recorded what happened. None of these are priced, and the outstanding figure cannot be worked out around them."
    >
      {sessions === null ? (
        // "Nothing waiting" is an all-clear, and an all-clear is exactly what a
        // failed read has not earned. Here it would tell a coach their month is
        // complete when nobody managed to read it.
        <Unresolved
          state={unread ?? 'loading'}
          what="your sessions, so nobody can say whether anything is waiting to be marked"
        />
      ) : (
        <DataTable
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing waiting — every finished session this month has an outcome."
        />
      )}
    </Section>
  );
}

/* ── the evidence ──────────────────────────────────────────────────────────── */

const OUTCOME_LABEL: Record<string, string> = {
  completed: 'Delivered',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  late_cancelled: 'Late cancel',
};

/**
 * Every marked session this month, line by line.
 *
 * The totals above are a summary, and a coach who disagrees with a total needs
 * the rows it was made of: which session, what was recorded, at what rate, and
 * whether it has been paid. Without this the only way to answer "why is my
 * August short" is to trust the number, which is the position this screen
 * exists to get a coach out of.
 */
function LineItems({ sessions, unread, namesUnread, policy, ccy }: {
  sessions: PtSession[] | null; unread: Unread; namesUnread: string | null;
  policy: PayPolicy; ccy: TenantCurrency;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) },
    clientColumn(namesUnread),
    { key: 'outcome', header: 'Recorded', value: (s) => s.outcome ?? '',
      render: (s) => (
        <span style={{ color: isDelivered(s) ? 'var(--good)' : 'var(--ink2)' }}>
          {s.outcome ? OUTCOME_LABEL[s.outcome] ?? s.outcome : <span className="dash">—</span>}
        </span>
      ) },
    { key: 'counts', header: 'Payable', value: (s) => (isPayable(s, policy) ? 1 : 0), numeric: true,
      render: (s) => isPayable(s, policy)
        ? <span style={{ color: 'var(--ink2)' }}>yes</span>
        : <span className="dash">no</span> },
    { key: 'rate', header: 'Rate', value: (s) => s.rateCents ?? null, numeric: true,
      // Null is a session nobody priced, which is not a session worth nothing.
      // Shown as unrated so it reads as a question for the gym rather than as a
      // free hour.
      render: (s) => s.rateCents == null
        ? <span className="dash">not rated</span>
        : (amount(s.rateCents, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>) },
    { key: 'paid', header: 'Paid', value: (s) => (s.settlementId ? 1 : 0), numeric: true,
      render: (s) => s.settlementId
        ? <span style={{ color: 'var(--ink2)' }}>settled</span>
        : <span className="dash">outstanding</span> },
  ];
  return (
    <Section
      title="Line items"
      sub="Every session this month somebody recorded an outcome for — the rows the figures above are made of."
    >
      {sessions === null ? (
        <Unresolved state={unread ?? 'loading'} what="your sessions, so there are no line items to show" />
      ) : (
        <DataTable
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing this month has been marked yet."
        />
      )}
    </Section>
  );
}

/* ── what has actually reached you ─────────────────────────────────────────── */

function Paid({ runs, unread, sessionsUnread, period }: {
  runs: Settlement[] | null; unread: Unread; sessionsUnread: Unread; period: Period;
}) {
  const cols: Column<Settlement>[] = [
    { key: 'when', header: 'Paid', value: (r) => r.settledAt,
      render: (r) => new Date(r.settledAt).toLocaleDateString() },
    { key: 'period', header: 'Covering', value: (r) => r.periodFrom,
      render: (r) => `${r.periodFrom} → ${r.periodTo}` },
    { key: 'n', header: 'Sessions', value: (r) => r.sessionsCount, numeric: true },
    { key: 'method', header: 'How', value: (r) => r.method },
    { key: 'note', header: 'Note', value: (r) => r.note ?? '',
      render: (r) => r.note ?? <span className="dash">—</span> },
    { key: 'amount', header: 'Amount', value: (r) => r.amountCents, numeric: true,
      // Snapshotted when the money went out, never recomputed — a later change
      // to a rate must not rewrite what a coach was actually handed.
      render: (r) => money(r.amountCents, r.currency)
        ?? <span className="dash">{r.amountCents == null ? 'not recorded' : NO_CURRENCY_NOTE}</span> },
  ];
  return (
    <Section
      title={`Payments covering ${period.label}`}
      sub="Runs matched by the payment stamped on this month's own sessions, not by comparing dates. Each amount is what was handed over at the time."
    >
      {runs === null ? (
        // The two failures behind an empty list are different errands, and
        // neither of them is "you have not been paid" — a sentence whose obvious
        // next step is a coach asking their gym for money they may already have.
        <Unresolved
          state={(sessionsUnread ?? unread) ?? 'loading'}
          what={sessionsUnread
            ? 'your sessions, so no payment can be matched to the month it covered'
            : 'your payment history. An empty list here would not mean you have not been paid — reload first'}
        />
      ) : (
        <>
          <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
            A single run can cover sessions from more than one month, so an amount here need not
            match the &ldquo;already settled&rdquo; figure above, which counts only this
            month&rsquo;s sessions.
          </p>
          <DataTable
            rows={runs} columns={cols} rowKey={(r) => r.id}
            empty="No payment has been recorded against this month's sessions yet."
          />
        </>
      )}
    </Section>
  );
}

/* ── shared bits (same shapes as the Door and Payroll screens) ─────────────── */

const field = {
  padding: '7px 10px', borderRadius: 0, fontSize: 13,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

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
      <div
        className="mono"
        style={{ fontSize: 21, marginTop: 5, letterSpacing: '-0.02em', color: text == null ? 'var(--ink3)' : 'var(--ink)' }}
      >
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
 * could not ask" and "there were none" were the same sentence on screen. On a
 * page about somebody's pay, those two sentences are worth an argument.
 */
function Unresolved({ state, what }: { state: Exclude<Unread, null>; what: string }) {
  return (
    <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
      {state === 'loading' ? 'Loading…' : `Could not read ${what}. The banner above says why.`}
    </div>
  );
}
