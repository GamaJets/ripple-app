'use client';

// Accounting — the month in the shape somebody outside this building has to file.
//
// Every other money screen in the console is for the owner: what came in, who
// is behind, whether payroll is safe to run. This one is for the accountant,
// and that changes what it is allowed to do. An owner reading a slightly wrong
// figure makes a slightly wrong decision. An accountant reading a slightly
// wrong figure signs it, and the gym owns that signature for seven years.
//
// So three things are true of this page that are not true of the others:
//
//   1. It is cash-basis and says so. Money in is payments somebody recorded in
//      the month; money out is payroll somebody settled in the month. Neither
//      is accrual and neither pretends to be.
//   2. It never subtracts one from the other and calls the answer profit. The
//      difference is cash Repple has a record of, and Repple has never seen
//      rent, stock, utilities, insurance, tax, equipment or the owner's own
//      drawings. That sentence is on the screen, not in this comment.
//   3. Where two records should agree and do not, the disagreement is the
//      output. The reconciliation lists at the bottom — invoices marked paid
//      with no payment behind them, payments with no invoice in front of them —
//      are the reason an accountant opens this screen at all. A tidy page with
//      those lists hidden would be worse than no page.
//
// The reads are the dangerous part, as everywhere: supabase-js RESOLVES on a
// database error, so a missing `.error` check turns a refused query into an
// empty month, and an empty month here is a filed return that says the gym
// took nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchPayments, money, type GymPayment } from '@lib/gymRecord';
import {
  monthWindow, recentMonths, monthKeyOf, monthEnded, inMonth,
  type MonthWindow,
} from '@lib/monthEnd';
import { isoDate } from '@lib/format';

/** How far back the picker offers. Thirteen so last year's same month is there. */
const MONTHS_OFFERED = 13;

const DAY = 86400000;

/**
 * How far either side of an invoice a payment may sit and still be treated as
 * that invoice's payment.
 *
 * There is no invoice_id on `gym_payments`, so nothing in the database links
 * the two. Matching is therefore a guess with a stated rule, and a stated rule
 * needs a stated window: a payment more than six weeks from the invoice date is
 * not evidence about that invoice.
 */
const MATCH_DAYS = 45;

/**
 * What a piece of state is when it holds no rows: a read still in flight, or
 * one that came back refused. Null means the read returned.
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "No payments this month" are both lies about a query that errored, and on
 * this screen the second one becomes a number on a tax return.
 */
type Unread = 'loading' | 'failed' | null;

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as any)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

/* ── rows ──────────────────────────────────────────────────────────────────── */

/**
 * A row of `gym_invoices`.
 *
 * Declared here rather than borrowed from monthEnd.ts because that one types
 * `amountCents` as a number and defaults a null to 0. On the close screen that
 * is survivable. Here it is not: an invoice with no amount recorded is money of
 * unknown size, and a set containing one cannot be totalled at all. Same for
 * `status` — an unrecognised or missing status is reported under its own name
 * rather than quietly filed as "open".
 */
interface Invoice {
  id: string;
  memberId: string | null;
  memberName: string | null;
  membershipId: string | null;
  amountCents: number | null;
  currency: string;
  issuedOn: string;
  /** Null means no due date was set — which is not the same as due today, and
   *  is why such an invoice cannot be aged. */
  dueOn: string | null;
  status: string | null;
  note: string | null;
}

/** A row of `payroll_settlements` — money that has actually left the account. */
interface Settled {
  id: string;
  trainerId: string | null;
  trainerName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  amountCents: number | null;
  currency: string;
  /** Null when the run did not record how many sessions it paid for. Not 0 —
   *  a settlement for no sessions and a settlement that forgot to say are
   *  different rows, and only one of them is worth asking about. */
  sessionsCount: number | null;
  method: string | null;
  settledAt: string;
}

/** One read, with the three states kept apart. */
interface Read<T> {
  rows: T[] | null;
  state: Unread;
  why: string | null;
}

const reading = <T,>(): Read<T> => ({ rows: null, state: 'loading', why: null });

function landed<T>(res: PromiseSettledResult<T[]>, what: string): Read<T> {
  if (res.status === 'fulfilled') return { rows: res.value, state: null, why: null };
  return { rows: null, state: 'failed', why: failure(res, what) };
}

interface Books {
  invoices: Read<Invoice>;
  payments: Read<GymPayment>;
  settled: Read<Settled>;
}

const EMPTY: Books = { invoices: reading(), payments: reading(), settled: reading() };

/* ── totals that refuse ────────────────────────────────────────────────────── */

/**
 * The sum of a set of amounts, or the reason there isn't one.
 *
 * Three ways a set has no total, and all three are ordinary in a real gym's
 * data: nobody recorded anything, a row carries no amount, or the rows are in
 * more than one currency. Adding dirhams to pounds is not a sum, and treating a
 * missing amount as nothing shrinks the figure by exactly the row somebody
 * forgot to fill in.
 */
type Sum =
  | { known: true; cents: number; currency: string }
  | { known: false; why: string };

function sumOf(
  rows: Array<{ amountCents: number | null; currency: string }>,
  whenEmpty: string,
): Sum {
  if (!rows.length) return { known: false, why: whenEmpty };

  const missing = rows.filter((r) => !Number.isFinite(r.amountCents as number)).length;
  if (missing) {
    return {
      known: false,
      why: `${missing} of ${rows.length} rows carry no amount, so this set cannot be totalled — the sum would be short by exactly ${missing === 1 ? 'that row' : 'those rows'}`,
    };
  }

  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  if (currencies.length > 1) {
    return { known: false, why: `${currencies.join(' and ')} in one set — not summed` };
  }

  return {
    known: true,
    cents: rows.reduce((a, r) => a + (r.amountCents as number), 0),
    currency: currencies[0],
  };
}

const sumText = (s: Sum): string | null => (s.known ? money(s.cents, s.currency) : null);
const sumNote = (s: Sum): string | undefined => (s.known ? undefined : s.why);

/* ── the screen ────────────────────────────────────────────────────────────── */

export default function Accounting() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameErr, setGymNameErr] = useState<string | null>(null);

  const months = useMemo(() => recentMonths(MONTHS_OFFERED), []);

  // Opens on the month that has finished, not the one running. A part-month is
  // not something anybody files, and offering it first invites a figure to be
  // copied out of here before the month has stopped moving.
  const [key, setKey] = useState<string>(() => recentMonths(2)[1] ?? monthKeyOf());
  const w = useMemo(() => monthWindow(key), [key]);

  // Stored WITH the month it was read for, and used only when the two agree.
  // Without that, switching from June to July paints one frame of June's
  // invoices under a July heading — and on the page somebody files from, a
  // figure that was briefly the wrong month's is a figure that can be copied.
  const [loaded, setLoaded] = useState<{ key: string; books: Books }>({ key: '', books: EMPTY });

  const load = useCallback(async (tenantId: string, mw: MonthWindow) => {
    setLoaded({ key: '', books: EMPTY });

    // Payments are read wider than the month on purpose. The month's own
    // takings come from the window; the reconciliation needs the shoulders,
    // because an invoice issued on the 30th is often paid on the 3rd and a
    // match rule that could not see across the month boundary would report
    // that as a paid invoice nobody paid.
    const since = new Date(Date.parse(mw.fromIso) - MATCH_DAYS * DAY).toISOString();

    // allSettled, never all. Under a single catch a refused invoice query also
    // empties the payments — and this screen would then report a month in which
    // the gym both billed nothing and took nothing, two wrong facts that agree
    // with each other and so look like a quiet month rather than a broken read.
    const [iRes, pRes, sRes] = await Promise.allSettled([
      fetchInvoices(tenantId, mw.lastDay),
      fetchPayments(supabase, tenantId, since),
      fetchSettled(tenantId, mw.fromIso, mw.toIso),
    ]);

    setLoaded({
      key: mw.key,
      books: {
        invoices: landed(iRes, 'the invoice register'),
        payments: landed(pRes, 'the payments taken'),
        settled: landed(sRes, 'the payroll settlements'),
      },
    });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) {
        setLoaded({
          key,
          books: {
            invoices: { rows: [], state: null, why: null },
            payments: { rows: [], state: null, why: null },
            settled: { rows: [], state: null, why: null },
          },
        });
        return;
      }
      // supabase-js resolves with { data, error } on a database error rather
      // than rejecting, so the error is read off the result, not caught.
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name').eq('id', who.tenantId).single();
      if (!live) return;
      setGymName(tErr ? null : (t as any)?.name ?? null);
      setGymNameErr(tErr ? (tErr.message || 'Could not read the gym name.') : null);
      if (w) await load(who.tenantId, w);
    })();
    return () => { live = false; };
  }, [load, w, key]);

  const books = loaded.key === key ? loaded.books : EMPTY;

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/accounting">
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
      <Shell me={me} gymName={gymName} current="/accounting">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          This is the gym&rsquo;s books — every payment, every invoice and every
          trainer&rsquo;s settlement in one month. It is owner-only.
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} current="/accounting">
      <h1>Accounting</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        One month, cash basis, in the form you hand to whoever files it: what was
        banked, what went out in payroll, what was invoiced against what was
        collected, how old the debt is, and what the two records disagree about.
      </p>

      {gymNameErr ? (
        <Banner tone="crit">
          This account is linked to a gym, but the gym&rsquo;s name could not be read:{' '}
          {gymNameErr}. Nothing below depends on that lookup — the figures are scoped
          by tenant id, not by name.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
        <select value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, minWidth: 190 }}>
          {months.map((m) => {
            const mw = monthWindow(m);
            return <option key={m} value={m}>{mw ? mw.label : m}</option>;
          })}
        </select>
      </div>

      {!w
        ? <Banner tone="crit">{key} is not a month this console can open.</Banner>
        : <Month w={w} books={books} />}
    </Shell>
  );
}

/* ── one month, worked out ─────────────────────────────────────────────────── */

function Month({ w, books }: { w: MonthWindow; books: Books }) {
  const ended = monthEnded(w);

  // Ageing has to be as at a date, and the honest one differs by month. For a
  // finished month it is the last day of it — that is the balance an accountant
  // is reconciling to. For the month still running it is today, because ageing
  // a debt to a date that has not arrived would show invoices as overdue before
  // they are.
  const asAt = ended ? w.lastDay : isoDate(new Date());

  const paymentsAll = books.payments.rows;
  const inMonthPayments = useMemo(
    () => (paymentsAll ?? []).filter((p) => inMonth(p.takenAt, w)),
    [paymentsAll, w],
  );

  const invoicesAll = books.invoices.rows;
  const raised = useMemo(
    () => (invoicesAll ?? []).filter((i) => i.issuedOn >= w.firstDay && i.issuedOn <= w.lastDay),
    [invoicesAll, w],
  );

  // Everything still unpaid as at the reporting date, including invoices raised
  // in earlier months — those are still money the gym is owed on that date, and
  // scoping the ageing to the month would report a gym owed nothing.
  const outstanding = useMemo(
    () => (invoicesAll ?? []).filter((i) => i.issuedOn <= asAt && isOutstanding(i.status)),
    [invoicesAll, asAt],
  );

  const settledRows = books.settled.rows ?? [];

  const cashIn = sumOf(inMonthPayments, `no payment is recorded in ${w.label} — which is not the same as none being taken`);
  const cashOut = sumOf(settledRows, `no payroll settlement is recorded in ${w.label}`);
  const raisedSum = sumOf(raised.filter((i) => isRaised(i.status)), `no invoice was raised in ${w.label}`);
  const owedSum = sumOf(outstanding, `nothing was outstanding as at ${asAt}`);

  const net = netOf(cashIn, cashOut, books);

  return (
    <>
      {books.invoices.why ? <Banner tone="crit">{books.invoices.why}</Banner> : null}
      {books.payments.why ? <Banner tone="crit">{books.payments.why}</Banner> : null}
      {books.settled.why ? <Banner tone="crit">{books.settled.why}</Banner> : null}

      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '10px 0 0' }}>
        {w.label}, {w.firstDay} to {w.lastDay}, in the gym&rsquo;s own timezone.
        Receivables are aged as at <span className="mono">{asAt}</span>
        {ended ? ' — the month end.' : ' — today, because this month has not finished.'}
      </p>

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '16px 0 26px',
        }}
      >
        {/* A read that has not returned shows a dash whatever the sum says —
            `sumOf([])` over rows nobody has yet is "nothing recorded", which is
            a claim about the month, and the month has not been read. */}
        <Kpi
          label="Money in"
          text={books.payments.state ? null : sumText(cashIn)}
          note={note(books.payments, 'the payments') ?? (cashIn.known ? `${inMonthPayments.length} payment${inMonthPayments.length === 1 ? '' : 's'} banked` : cashIn.why)}
        />
        <Kpi
          label="Money out (payroll)"
          text={books.settled.state ? null : sumText(cashOut)}
          note={note(books.settled, 'the settlements') ?? (cashOut.known ? `${settledRows.length} settlement${settledRows.length === 1 ? '' : 's'}` : cashOut.why)}
        />
        <Kpi
          label="Cash recorded in Repple"
          text={net.known ? sumText(net) : null}
          note={net.known ? 'not profit — see below' : net.why}
        />
        <Kpi
          label="Invoiced"
          text={books.invoices.state ? null : sumText(raisedSum)}
          note={note(books.invoices, 'the invoices') ?? (raisedSum.known ? `${raised.length} raised in ${w.label}` : raisedSum.why)}
        />
        <Kpi
          label="Outstanding"
          text={books.invoices.state ? null : sumText(owedSum)}
          note={note(books.invoices, 'the invoices') ?? (owedSum.known ? `${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'} unpaid at ${asAt}` : owedSum.why)}
        />
      </div>

      <MoneyIn read={books.payments} rows={inMonthPayments} w={w} total={cashIn} />
      <MoneyOut read={books.settled} rows={settledRows} total={cashOut} />
      <NetCash net={net} w={w} />
      <Invoiced read={books.invoices} raised={raised} w={w} />
      <Ageing read={books.invoices} rows={outstanding} asAt={asAt} total={owedSum} />
      <Reconcile books={books} w={w} inMonthPayments={inMonthPayments} />
    </>
  );
}

/**
 * Money in minus money out, or the reason there is no such figure.
 *
 * Deliberately not computed from `?? 0` on either side. If the payments read
 * failed and the payroll read did not, "money out" alone is not a net position,
 * and rendering it as one would tell an accountant the gym spent more than it
 * earned in a month whose income simply did not load.
 */
function netOf(cashIn: Sum, cashOut: Sum, books: Books): Sum {
  if (books.payments.state === 'loading' || books.settled.state === 'loading') {
    return { known: false, why: 'still reading both sides' };
  }
  if (books.payments.state === 'failed') return { known: false, why: 'the payments could not be read, so there is no in to subtract from' };
  if (books.settled.state === 'failed') return { known: false, why: 'the settlements could not be read, so there is no out to subtract' };
  if (!cashIn.known) return { known: false, why: `money in has no total — ${cashIn.why}` };
  if (!cashOut.known) return { known: false, why: `money out has no total — ${cashOut.why}` };
  if (cashIn.currency !== cashOut.currency) {
    return { known: false, why: `money in is in ${cashIn.currency} and money out in ${cashOut.currency} — not subtracted` };
  }
  return { known: true, cents: cashIn.cents - cashOut.cents, currency: cashIn.currency };
}

/* ── money in ──────────────────────────────────────────────────────────────── */

interface MethodLine {
  key: string;
  method: string;
  currency: string;
  count: number;
  cents: number;
}

/**
 * Payments grouped by method AND currency.
 *
 * `incomeOf` in monthEnd.ts groups by method alone and sums across currencies
 * into one figure per line. That is right for the close screen, which shows the
 * currency list beside it and refuses the headline total. It is not right here:
 * a line reading "Card 4,200" over two currencies is a number an accountant
 * would copy. Splitting the key means every line on this page is a sum of like
 * things, and a gym with one currency — which is almost all of them — sees
 * exactly the same table it would have seen.
 */
function byMethod(payments: GymPayment[]): MethodLine[] {
  const out = new Map<string, MethodLine>();
  for (const p of payments) {
    if (!Number.isFinite(p.amountCents)) continue;
    const method = p.method ?? 'unrecorded';
    const k = `${method}|${p.currency}`;
    const line = out.get(k) ?? { key: k, method, currency: p.currency, count: 0, cents: 0 };
    line.count += 1;
    line.cents += p.amountCents;
    out.set(k, line);
  }
  return [...out.values()].sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key));
}

function MoneyIn({ read, rows, w, total }: {
  read: Read<GymPayment>; rows: GymPayment[]; w: MonthWindow; total: Sum;
}) {
  const lines = useMemo(() => byMethod(rows), [rows]);
  const unpriced = rows.filter((p) => !Number.isFinite(p.amountCents));
  const unattributed = rows.filter((p) => !p.memberId);

  const cols: Column<MethodLine>[] = [
    { key: 'method', header: 'Method', value: (l) => l.method.replace('_', ' ') },
    { key: 'currency', header: 'Currency', value: (l) => l.currency },
    { key: 'count', header: 'Payments', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, l.currency) },
  ];

  return (
    <Section
      title="Money in"
      sub={`Payments recorded as taken in ${w.label}, by how they arrived. Cash basis: a payment counts on the day it was banked, whatever period it was for.`}
    >
      <Part read={read} what="the payments taken"
            cost="money in is unknown for this month, and so is everything computed from it">
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {total.known
              ? <>{money(total.cents, total.currency)} across {rows.length} payment{rows.length === 1 ? '' : 's'}.</>
              : <>No total: {total.why}.</>}
            {unpriced.length
              ? ` ${unpriced.length} payment${unpriced.length === 1 ? '' : 's'} carr${unpriced.length === 1 ? 'ies' : 'y'} no amount and ${unpriced.length === 1 ? 'is' : 'are'} left out of the table below entirely rather than counted as nothing.`
              : null}
            {unattributed.length
              ? ` ${unattributed.length} payment${unattributed.length === 1 ? '' : 's'} carr${unattributed.length === 1 ? 'ies' : 'y'} nobody's name — counted in the total, and unmatchable against any invoice.`
              : null}
          </p>
          <DataTable
            rows={lines} columns={cols} rowKey={(l) => l.key}
            empty={`No payment is recorded as taken in ${w.label}. That is a statement about the record, not about the till.`}
          />
        </>
      </Part>
    </Section>
  );
}

/* ── money out ─────────────────────────────────────────────────────────────── */

function MoneyOut({ read, rows, total }: { read: Read<Settled>; rows: Settled[]; total: Sum }) {
  const cols: Column<Settled>[] = [
    { key: 'settled', header: 'Settled', value: (s) => s.settledAt,
      render: (s) => new Date(s.settledAt).toLocaleDateString() },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName },
    { key: 'period', header: 'For the period', value: (s) => s.periodFrom,
      render: (s) => (s.periodFrom && s.periodTo
        ? <>{s.periodFrom} → {s.periodTo}</>
        : <span className="dash">period not recorded</span>) },
    { key: 'sessions', header: 'Sessions', value: (s) => s.sessionsCount, numeric: true,
      render: (s) => (s.sessionsCount == null
        ? <span className="dash">not recorded</span>
        : <>{s.sessionsCount}</>) },
    { key: 'amount', header: 'Amount', value: (s) => s.amountCents, numeric: true,
      render: (s) => (s.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(s.amountCents, s.currency)}</>) },
    { key: 'per', header: 'Per session', value: (s) => perSession(s), numeric: true,
      // A division, so the denominator is checked before it is used. A
      // settlement that paid for no sessions, or never said how many, has no
      // per-session figure — not a zero, and certainly not the whole amount.
      render: (s) => {
        const c = perSession(s);
        if (c == null) {
          return (
            <span className="dash">
              {s.amountCents == null ? 'no amount' : s.sessionsCount == null ? 'session count not recorded' : 'no sessions on this run'}
            </span>
          );
        }
        return <>{money(c, s.currency)}</>;
      } },
    { key: 'method', header: 'Method', value: (s) => s.method },
  ];

  return (
    <Section
      title="Money out (payroll)"
      sub="Settlements recorded as paid in this month. Cash basis again, and the period column is why it matters: a settlement paid on the 3rd of August is August's cash and July's work."
    >
      <Part read={read} what="the payroll settlements"
            cost="money out is unknown for this month, so no net position is offered">
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {total.known
              ? <>{money(total.cents, total.currency)} across {rows.length} settlement{rows.length === 1 ? '' : 's'}.</>
              : <>No total: {total.why}.</>}
            {' '}This is payroll only. It is not everything the gym paid out — it is
            everything the gym paid out <em>through Repple</em>.
          </p>
          <DataTable
            rows={rows} columns={cols} rowKey={(s) => s.id}
            empty="No payroll settlement was recorded in this month. If trainers were paid outside Repple, this is what that looks like — and money out below is short by whatever that was."
          />
        </>
      </Part>
    </Section>
  );
}

/** Amount per session, or null when the division has no meaning. */
function perSession(s: Settled): number | null {
  if (s.amountCents == null || !Number.isFinite(s.amountCents)) return null;
  if (s.sessionsCount == null || s.sessionsCount <= 0) return null;
  // Integer cents throughout; never a float on currency. The remainder is
  // dropped rather than distributed, which is why this column is a sanity
  // check and not a figure to pay anybody from.
  return Math.round(s.amountCents / s.sessionsCount);
}

/* ── the net, named honestly ───────────────────────────────────────────────── */

function NetCash({ net, w }: { net: Sum; w: MonthWindow }) {
  return (
    <Section
      title="Cash recorded in Repple"
      sub="Money in, less payroll out. Read the paragraph before you copy the number."
    >
      <div style={{ padding: 14 }}>
        <div
          className="mono"
          style={{ fontSize: 25, letterSpacing: '-0.02em', color: net.known ? 'var(--ink)' : 'var(--ink3)' }}
        >
          {net.known ? sumText(net) : '—'}
        </div>
        {!net.known ? (
          <p style={{ margin: '6px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{net.why}</p>
        ) : null}

        <p style={{ margin: '12px 0 0', color: 'var(--ink2)', fontSize: 13.5, maxWidth: 760 }}>
          <strong>This is not profit, and it is not a P&amp;L line.</strong> It is the
          difference between two things Repple happens to hold records of: payments
          somebody entered, and payroll somebody settled here. It omits rent,
          utilities, stock and supplements, equipment and finance on it, insurance,
          licences, marketing, software, bank and card fees, VAT and corporation tax,
          staff paid outside Repple, and the owner&rsquo;s own drawings — none of which
          this database has ever seen. A gym with a healthy figure on this line can be
          losing money every month of {w.label}&rsquo;s year.
        </p>
        <p style={{ margin: '9px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: 760 }}>
          It is here for one job: to be reconciled against the bank. If the bank moved
          by something other than this, the difference is either a cost Repple never
          saw, or a payment nobody recorded.
        </p>
      </div>
    </Section>
  );
}

/* ── invoiced vs collected ─────────────────────────────────────────────────── */

interface StatusLine {
  key: string;
  label: string;
  currency: string;
  count: number;
  cents: number | null;
  /** Rows in this group that carry no amount — why `cents` may be null. */
  unpriced: number;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft — not yet raised',
  open: 'Open',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
  written_off: 'Written off',
};

/** An invoice the gym actually raised — a draft is not a claim on anybody. */
function isRaised(status: string | null): boolean {
  return status !== null && status !== 'draft';
}

/** Still money owed. Void and written off are decisions, not debts; paid is
 *  collected; draft was never raised. */
function isOutstanding(status: string | null): boolean {
  return status === 'open' || status === 'overdue';
}

function Invoiced({ read, raised, w }: { read: Read<Invoice>; raised: Invoice[]; w: MonthWindow }) {
  const lines = useMemo(() => {
    const out = new Map<string, StatusLine>();
    for (const i of raised) {
      const status = i.status ?? '(no status recorded)';
      const k = `${status}|${i.currency}`;
      const line = out.get(k) ?? {
        key: k,
        label: STATUS_LABEL[status] ?? status,
        currency: i.currency,
        count: 0,
        cents: 0,
        unpriced: 0,
      };
      line.count += 1;
      if (Number.isFinite(i.amountCents as number)) {
        if (line.cents != null) line.cents += i.amountCents as number;
      } else {
        line.unpriced += 1;
        line.cents = null;
      }
      out.set(k, line);
    }
    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [raised]);

  const raisedRows = raised.filter((i) => isRaised(i.status));
  const paidRows = raised.filter((i) => i.status === 'paid');
  const raisedSum = sumOf(raisedRows, 'nothing was raised');
  const paidSum = sumOf(paidRows, 'none of this month’s invoices is marked paid');

  // A collection rate, and the denominator is the whole reason this is written
  // out rather than inlined. Zero invoices raised does not mean 0% collected —
  // it means the question has no answer, and 0% on an accountant's page reads
  // as a gym that collected nothing.
  const rate: string | null =
    raisedSum.known && paidSum.known && raisedSum.currency === paidSum.currency && raisedSum.cents > 0
      ? `${Math.round((paidSum.cents * 100) / raisedSum.cents)}%`
      : null;
  const rateWhy =
    !raisedSum.known ? raisedSum.why
      : raisedSum.cents === 0 ? 'the invoices raised total nothing, so there is no proportion to take'
      : !paidSum.known ? paidSum.why
      : raisedSum.currency !== paidSum.currency ? 'raised and paid are in different currencies'
      : null;

  const cols: Column<StatusLine>[] = [
    { key: 'label', header: 'Status', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency },
    { key: 'count', header: 'Invoices', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => (l.cents == null
        ? <span className="dash">{l.unpriced} of {l.count} carry no amount</span>
        : <>{money(l.cents, l.currency)}</>) },
  ];

  return (
    <Section
      title="Invoices raised, and what was collected"
      sub={`Invoices dated inside ${w.label}, by the status the register holds today. A draft was never raised and is shown apart from the ones that were.`}
    >
      <Part read={read} what="the invoice register"
            cost="what the gym billed this month is unknown, and so is what it collected">
        <>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
            <Figure label="Raised" text={sumText(raisedSum)} note={sumNote(raisedSum) ?? `${raisedRows.length} invoice${raisedRows.length === 1 ? '' : 's'}`} />
            <Figure label="Marked paid" text={sumText(paidSum)} note={sumNote(paidSum) ?? `${paidRows.length} invoice${paidRows.length === 1 ? '' : 's'}`} />
            <Figure label="Collected" text={rate} note={rate ? 'of what was raised this month, by value' : rateWhy ?? undefined} />
          </div>
          <p style={{ margin: 0, padding: '11px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            &ldquo;Marked paid&rdquo; is the register&rsquo;s claim, not the bank&rsquo;s.
            Whether a payment stands behind each one is the next section but one.
          </p>
          <DataTable
            rows={lines} columns={cols} rowKey={(l) => l.key}
            empty={`No invoice is dated in ${w.label}. If this gym takes money without invoicing, that is what this looks like — and there is then no second record to check the takings against.`}
          />
        </>
      </Part>
    </Section>
  );
}

/* ── receivables ageing ────────────────────────────────────────────────────── */

type Band = 'current' | 'd1' | 'd31' | 'd61' | 'undated';

const BAND_LABEL: Record<Band, string> = {
  current: 'Current — not yet due',
  d1: '1–30 days past due',
  d31: '31–60 days past due',
  d61: 'More than 60 days past due',
  undated: 'No due date set',
};

const BAND_ORDER: Band[] = ['current', 'd1', 'd31', 'd61', 'undated'];

const BAND_TONE: Record<Band, string> = {
  current: 'var(--ink2)',
  d1: 'var(--warn)',
  d31: 'var(--serious)',
  d61: 'var(--crit)',
  undated: 'var(--ink3)',
};

/** Whole days between two YYYY-MM-DD dates, both read as UTC midnight so the
 *  arithmetic is exact and no daylight-saving hour can shift a bucket. */
function daysPast(dueOn: string, asAt: string): number | null {
  const d = Date.parse(`${dueOn}T00:00:00Z`);
  const a = Date.parse(`${asAt}T00:00:00Z`);
  if (!Number.isFinite(d) || !Number.isFinite(a)) return null;
  return Math.round((a - d) / DAY);
}

/**
 * Which band an invoice falls in as at a date.
 *
 * An invoice due today is not late today. An invoice with no due date is not
 * current either — the gym never said when it wanted the money, so it cannot be
 * aged at all, and it gets its own band instead of being quietly filed as the
 * healthiest one.
 */
function bandOf(inv: Invoice, asAt: string): Band {
  if (!inv.dueOn) return 'undated';
  const n = daysPast(inv.dueOn, asAt);
  if (n == null) return 'undated';
  if (n <= 0) return 'current';
  if (n <= 30) return 'd1';
  if (n <= 60) return 'd31';
  return 'd61';
}

interface BandLine {
  key: Band;
  label: string;
  count: number;
  sum: Sum;
}

function Ageing({ read, rows, asAt, total }: {
  read: Read<Invoice>; rows: Invoice[]; asAt: string; total: Sum;
}) {
  const lines: BandLine[] = useMemo(() => {
    const groups = new Map<Band, Invoice[]>();
    for (const i of rows) {
      const b = bandOf(i, asAt);
      groups.set(b, [...(groups.get(b) ?? []), i]);
    }
    return BAND_ORDER.map((b) => {
      const g = groups.get(b) ?? [];
      return {
        key: b,
        label: BAND_LABEL[b],
        count: g.length,
        sum: sumOf(g, 'no invoice sits in this band'),
      };
    });
  }, [rows, asAt]);

  const detailCols: Column<Invoice>[] = [
    { key: 'member', header: 'Member', value: (i) => i.memberName },
    { key: 'issued', header: 'Issued', value: (i) => i.issuedOn },
    { key: 'due', header: 'Due', value: (i) => i.dueOn,
      render: (i) => (i.dueOn
        ? <span style={{ color: BAND_TONE[bandOf(i, asAt)] }}>{i.dueOn}</span>
        : <span className="dash">none set</span>) },
    { key: 'age', header: 'Days past due', value: (i) => (i.dueOn ? daysPast(i.dueOn, asAt) : null), numeric: true,
      render: (i) => {
        if (!i.dueOn) return <span className="dash">cannot be aged</span>;
        const n = daysPast(i.dueOn, asAt);
        if (n == null) return <span className="dash">due date unreadable</span>;
        return n <= 0 ? <span className="dash">not yet due</span> : <>{n}</>;
      } },
    { key: 'amount', header: 'Amount', value: (i) => i.amountCents, numeric: true,
      render: (i) => (i.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(i.amountCents, i.currency)}</>) },
    { key: 'status', header: 'Status', value: (i) => i.status },
    { key: 'note', header: 'Note', value: (i) => i.note },
  ];

  const bandCols: Column<BandLine>[] = [
    { key: 'label', header: 'Band', value: (l) => l.label,
      render: (l) => <span style={{ color: BAND_TONE[l.key] }}>{l.label}</span> },
    { key: 'count', header: 'Invoices', value: (l) => l.count, numeric: true },
    { key: 'amount', header: 'Amount', value: (l) => (l.sum.known ? l.sum.cents : null), numeric: true,
      render: (l) => (l.sum.known
        ? <>{money(l.sum.cents, l.sum.currency)}</>
        : <span className="dash">{l.sum.why}</span>) },
  ];

  return (
    <Section
      title="Accounts receivable, aged"
      sub={`Every invoice still marked open or overdue as at ${asAt}, whichever month it was raised in, bucketed by how far past its due date it is.`}
    >
      <Part read={read} what="the invoice register"
            cost="the debt is unknown — no ageing is shown rather than an empty one, which would read as a gym owed nothing">
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {total.known
              ? <>{money(total.cents, total.currency)} outstanding across {rows.length} invoice{rows.length === 1 ? '' : 's'}.</>
              : <>No outstanding total: {total.why}.</>}
            {' '}Void and written-off invoices are money the gym has decided not to
            collect and are counted in neither this nor what came in.
          </p>
          <DataTable rows={lines} columns={bandCols} rowKey={(l) => l.key}
                     empty="No band to show." />
          {rows.length ? (
            <div style={{ borderTop: '1px solid var(--ring)' }}>
              <div style={{ padding: '11px 14px' }}>
                <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>The invoices behind those bands</h3>
                <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
                  Named, because an ageing summary an accountant cannot drill into is
                  a number they have to take on trust.
                </p>
              </div>
              <DataTable rows={rows} columns={detailCols} rowKey={(i) => i.id} empty="—" />
            </div>
          ) : null}
        </>
      </Part>
    </Section>
  );
}

/* ── reconciliation ────────────────────────────────────────────────────────── */

interface Recon {
  /** Invoices this month marked paid that no payment in the window explains. */
  invoicesWithoutPayment: Invoice[];
  /** Payments this month that no invoice in the register explains. */
  paymentsWithoutInvoice: GymPayment[];
  /** Payments carrying no member — unmatchable by construction, held apart so
   *  they do not swell the list above with rows nobody can act on. */
  unattributed: GymPayment[];
}

/**
 * Match payments to invoices, knowing full well that nothing in the database
 * links them.
 *
 * `gym_payments` has no invoice_id. So the rule is stated and crude on purpose:
 * same member, same currency, exactly the same amount in cents, within
 * MATCH_DAYS of the invoice date, and each payment may satisfy at most one
 * invoice. Every paid invoice the register holds gets a chance to consume a
 * payment — not only this month's — otherwise a payment settling July's invoice
 * would surface in August's list as money nobody billed for.
 *
 * What this cannot see, and what the screen therefore says out loud: part
 * payments, one payment covering two invoices, a family paying under one name,
 * and cash banked in a lump. Both lists are questions for a human, never
 * findings.
 */
function reconcile(invoices: Invoice[], payments: GymPayment[], w: MonthWindow): Recon {
  const paid = [...invoices.filter((i) => i.status === 'paid')]
    .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));

  const used = new Set<string>();
  const invoicesWithoutPayment: Invoice[] = [];

  for (const inv of paid) {
    const hit = inv.memberId != null && Number.isFinite(inv.amountCents as number)
      ? payments.find((p) =>
          !used.has(p.id)
          && p.memberId === inv.memberId
          && p.currency === inv.currency
          && Number.isFinite(p.amountCents)
          && p.amountCents === inv.amountCents
          && withinDays(p.takenAt, inv.issuedOn, MATCH_DAYS))
      : undefined;

    if (hit) used.add(hit.id);
    // Only this month's paid invoices are reported. An unmatched paid invoice
    // from March is real, but it is March's problem and listing it here would
    // bury the month somebody is actually filing.
    else if (inv.issuedOn >= w.firstDay && inv.issuedOn <= w.lastDay) invoicesWithoutPayment.push(inv);
  }

  const inWindow = payments.filter((p) => inMonth(p.takenAt, w));
  return {
    invoicesWithoutPayment,
    paymentsWithoutInvoice: inWindow.filter((p) => p.memberId != null && !used.has(p.id)),
    unattributed: inWindow.filter((p) => p.memberId == null),
  };
}

/** Whether a timestamp falls within n days of a date, either side. */
function withinDays(iso: string, day: string, n: number): boolean {
  const t = Date.parse(iso);
  const d = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(d)) return false;
  return Math.abs(t - d) <= n * DAY;
}

function Reconcile({ books, w, inMonthPayments }: {
  books: Books; w: MonthWindow; inMonthPayments: GymPayment[];
}) {
  const bothRead = books.invoices.state === null && books.payments.state === null;
  const r = useMemo(
    () => (bothRead ? reconcile(books.invoices.rows ?? [], books.payments.rows ?? [], w) : null),
    [bothRead, books.invoices.rows, books.payments.rows, w],
  );

  const invCols: Column<Invoice>[] = [
    { key: 'member', header: 'Member', value: (i) => i.memberName },
    { key: 'issued', header: 'Issued', value: (i) => i.issuedOn },
    { key: 'amount', header: 'Invoiced', value: (i) => i.amountCents, numeric: true,
      render: (i) => (i.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(i.amountCents, i.currency)}</>) },
    { key: 'why', header: 'Why it is here', value: (i) => (i.memberId == null ? 'no member' : 'no payment matches'),
      render: (i) => (
        <span style={{ color: 'var(--ink3)' }}>
          {i.memberId == null
            ? 'the invoice names no member, so nothing can be matched to it'
            : i.amountCents == null
              ? 'the invoice carries no amount, so nothing can be matched to it'
              : `no payment of this amount from this member within ${MATCH_DAYS} days`}
        </span>
      ) },
    { key: 'note', header: 'Note', value: (i) => i.note },
  ];

  const payCols: Column<GymPayment>[] = [
    { key: 'taken', header: 'Taken', value: (p) => p.takenAt,
      render: (p) => new Date(p.takenAt).toLocaleDateString() },
    { key: 'member', header: 'Member', value: (p) => p.memberName },
    { key: 'amount', header: 'Amount', value: (p) => p.amountCents, numeric: true,
      render: (p) => money(p.amountCents, p.currency) },
    { key: 'method', header: 'Method', value: (p) => (p.method ?? '').replace('_', ' ') },
    { key: 'note', header: 'Note', value: (p) => p.note },
  ];

  return (
    <Section
      title="What does not reconcile"
      sub="The two lists an accountant came for. Neither is a finding — each row is a question with a name on it."
    >
      {!bothRead ? (
        <div style={{ padding: 14, color: 'var(--ink2)', fontSize: 13.5 }}>
          {books.invoices.state === 'loading' || books.payments.state === 'loading'
            ? 'Still reading both sides.'
            : 'One side could not be read, so no comparison is offered. A reconciliation run against a failed read produces findings that look exactly like real ones, which is worse than no reconciliation.'}
        </div>
      ) : r ? (
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            Nothing in the database links a payment to an invoice — there is no
            invoice id on a payment row. So the match is made on member, exact
            amount, currency and a payment within {MATCH_DAYS} days of the invoice
            date, one payment per invoice. Part payments, one payment settling two
            invoices, a partner paying under their own name and cash banked in a
            lump will all appear below and all be fine. That is expected: the list
            is short enough to walk through, which is the point of it.
          </p>

          <div style={{ padding: '11px 14px' }}>
            <h3 style={{ fontSize: 13, margin: 0, color: r.invoicesWithoutPayment.length ? 'var(--crit)' : 'var(--ink2)' }}>
              Marked paid, no payment behind it — {r.invoicesWithoutPayment.length}
            </h3>
            <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
              The register says this money arrived in {w.label}. The payments record
              does not show it. Either it was banked and never entered, or the
              invoice was marked paid before the money moved.
            </p>
          </div>
          <DataTable
            rows={r.invoicesWithoutPayment} columns={invCols} rowKey={(i) => i.id}
            empty={`Every invoice raised in ${w.label} and marked paid has a payment of the same amount from the same member behind it.`}
          />

          <div style={{ padding: '11px 14px', borderTop: '1px solid var(--ring)' }}>
            <h3 style={{ fontSize: 13, margin: 0, color: r.paymentsWithoutInvoice.length ? 'var(--warn)' : 'var(--ink2)' }}>
              Banked, no invoice in front of it — {r.paymentsWithoutInvoice.length}
            </h3>
            <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
              Real money, recorded, with nothing in the invoice register that explains
              what it was for. Perfectly normal at a gym that takes cash at the desk —
              and exactly where unbilled income hides at one that does not.
            </p>
          </div>
          <DataTable
            rows={r.paymentsWithoutInvoice} columns={payCols} rowKey={(p) => p.id}
            empty={`Every attributed payment banked in ${w.label} lines up with an invoice.`}
          />

          {r.unattributed.length ? (
            <div style={{ borderTop: '1px solid var(--ring)' }}>
              <div style={{ padding: '11px 14px' }}>
                <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>
                  Banked against nobody — {r.unattributed.length}
                </h3>
                <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
                  Held apart from the list above because these cannot be matched by
                  construction, not because they failed a check. They are counted in
                  money in, and they cannot be chased, refunded or explained later.
                </p>
              </div>
              <DataTable rows={r.unattributed} columns={payCols} rowKey={(p) => p.id} empty="—" />
            </div>
          ) : null}

          <p style={{ margin: 0, padding: '12px 14px', borderTop: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            {inMonthPayments.length} payment{inMonthPayments.length === 1 ? '' : 's'} banked in {w.label} went into this
            comparison, against every invoice the register holds up to {w.lastDay}.
          </p>
        </>
      ) : null}
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * Invoices issued on or before the end of the month.
 *
 * Deliberately not scoped to the month: an invoice raised in June and still
 * unpaid in August is money owed at the August close, and a query scoped to
 * August would report that gym as owed nothing. The ageing and the
 * reconciliation both need the history.
 *
 * `.error` is checked on both queries here. supabase-js resolves on a database
 * error, so without it a refused read arrives as `data: null`, falls through
 * `?? []`, and this page reports a gym that billed nothing, is owed nothing and
 * reconciles perfectly.
 */
async function fetchInvoices(tenantId: string, upToDay: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('gym_invoices')
    .select('id, member_id, membership_id, amount_cents, currency, issued_on, due_on, status, note')
    .eq('tenant_id', tenantId)
    .lte('issued_on', upToDay)
    .order('issued_on', { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  const names = await namesFor(rows.map((r: any) => r.member_id));
  return rows.map((r: any) => ({
    id: r.id,
    memberId: r.member_id ?? null,
    memberName: r.member_id ? names.get(r.member_id) ?? null : null,
    membershipId: r.membership_id ?? null,
    // Not `?? 0`. An invoice with no amount is money of unknown size, and every
    // total on this page refuses rather than absorbs it.
    amountCents: r.amount_cents ?? null,
    currency: r.currency ?? 'AED',
    issuedOn: r.issued_on,
    dueOn: r.due_on ?? null,
    status: r.status ?? null,
    note: r.note ?? null,
  }));
}

/** Payroll settled inside the month, by the date it was settled. */
async function fetchSettled(tenantId: string, fromIso: string, toIso: string): Promise<Settled[]> {
  const { data, error } = await supabase
    .from('payroll_settlements')
    .select('id, trainer_id, period_from, period_to, amount_cents, currency, sessions_count, method, settled_at')
    .eq('tenant_id', tenantId)
    .gte('settled_at', fromIso)
    .lt('settled_at', toIso)
    .order('settled_at', { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  const names = await namesFor(rows.map((r: any) => r.trainer_id));
  return rows.map((r: any) => ({
    id: r.id,
    trainerId: r.trainer_id ?? null,
    trainerName: r.trainer_id ? names.get(r.trainer_id) ?? null : null,
    periodFrom: r.period_from ?? null,
    periodTo: r.period_to ?? null,
    amountCents: r.amount_cents ?? null,
    currency: r.currency ?? 'AED',
    sessionsCount: r.sessions_count ?? null,
    method: r.method ?? null,
    settledAt: r.settled_at,
  }));
}

/** Names from `profiles`, where they live. Throws rather than returning an empty
 *  map: an unnamed row on a page somebody files from is not cosmetic. */
async function namesFor(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', unique);
  if (error) throw error;
  return new Map((data ?? [])
    .map((p: any) => [p.id, (p.full_name || '').trim()] as [string, string])
    .filter(([, n]) => !!n));
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

/** The note under a figure whose read has not returned — which of the two
 *  states it is missing for, never a shrug. */
function note<T>(r: Read<T>, what: string): string | undefined {
  if (r.state === 'loading') return `reading ${what}…`;
  if (r.state === 'failed') return `${what} could not be read`;
  return undefined;
}

/**
 * A section body that cannot lie about which of the three states it is in:
 * loading says loading, failed says what broke and what is therefore unknown,
 * returned hands over to the table.
 */
function Part<T>({ read, what, cost, children }: {
  read: Read<T>; what: string; cost?: string; children: React.ReactNode;
}) {
  if (read.state === 'loading') return <Loading />;
  if (read.state === 'failed') {
    return (
      <div style={{
        padding: '16px 14px', margin: 14, borderRadius: 0,
        border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
        background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
      }}>
        Could not read {what}. This section is <strong>unknown</strong>, not empty
        {cost ? <> — {cost}</> : null}. Nothing here may be filed.
        {read.why ? (
          <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{read.why}</div>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
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

function Kpi({ label, text, note }: { label: string; text: string | null | undefined; note?: string }) {
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

/** The same idea as a Kpi, inline inside a section header strip. */
function Figure({ label, text, note }: { label: string; text: string | null; note?: string }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div className="micro">{label}</div>
      <div className="mono" style={{ fontSize: 16.5, marginTop: 3, color: text == null ? 'var(--ink3)' : 'var(--ink)' }}>
        {text ?? '—'}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 2, maxWidth: 300 }}>{note}</div> : null}
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

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
