'use client';

// Close — is this month finished, and may I act on these numbers?
//
// Every other screen in this console reports. This one *refuses*. A gym owner
// closing August is about to pay trainers, hand a figure to an accountant and
// chase whoever has not paid, and the single most expensive thing this software
// could do is show them a tidy total that quietly omitted the twelve sessions
// nobody marked.
//
// So the shape is inverted from the rest of the console: the verdict is at the
// top, the reasons the month is NOT closed come before any figure, and where
// the record cannot answer, the screen says so instead of printing a zero.
//
// All the reasoning lives in src/lib/monthEnd.ts, which has no Supabase import
// and is tested under plain node. What lives here is the reads — and the reads
// are the dangerous part, because supabase-js RESOLVES on a database error. A
// missing `.error` check on any query below would turn a broken month into an
// empty one, which on this screen means a payroll run over nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships, fetchPayments, money } from '@lib/gymRecord';
import {
  fetchSessions, isAwaitingOutcome, PAY_DELIVERED_ONLY,
  type PtSession, type PayPolicy, type PayrollLine,
} from '@lib/gymSessions';
import { fetchPasses } from '@lib/gymPasses';
import { assertWhole, capLimit } from '@lib/rowCap';
import { NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { sliceLoading, sliceReady, sliceFailed, type Slice } from '@lib/memberView';
import {
  monthWindow, recentMonths, monthKeyOf, buildClose, isOverdue, closeHeadline,
  type CloseRecord, type MonthClose, type GymInvoice, type Line, type Blocker,
} from '@lib/monthEnd';

const EMPTY: CloseRecord = {
  payments: sliceLoading(),
  invoices: sliceLoading(),
  sessions: sliceLoading(),
  memberships: sliceLoading(),
  passes: sliceLoading(),
};

/** How far back the picker offers. Thirteen so last year's same month is there. */
const MONTHS_OFFERED = 13;

export default function Close() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  // `tenants.currency`. A month-end close is the document an owner reconciles
  // against a bank statement, so the one thing it must not do is name a
  // currency nobody chose — see currencyOf() at the foot of this file.
  const [gymCcy, setGymCcy] = useState<TenantCurrency>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  const [feeRead, setFeeRead] = useState<'ok' | 'failed'>('ok');

  // The record is stored WITH the month it was read for, and used only when the
  // two agree. Without that, switching from June to July renders one frame of
  // June's invoices under a July heading — and a close screen that shows the
  // wrong month's receivables, however briefly, is the exact failure this page
  // exists to prevent. A mismatch reads as "not loaded yet", which is true.
  const [loaded, setLoaded] = useState<{ key: string; rec: CloseRecord }>({ key: '', rec: EMPTY });

  // Default to the month that has actually finished. Opening on the running
  // month would greet an owner with a refusal about a month nobody claimed was
  // over, and train them to skip the refusals.
  const months = useMemo(() => recentMonths(MONTHS_OFFERED + 1), []);
  const [key, setKey] = useState<string>(() => {
    const all = recentMonths(2);
    return all[1] ?? monthKeyOf();
  });

  // Whether a no-show is payable is a gym policy, not something this screen may
  // assume. Same control, same default, same wording as /sessions — a close
  // that priced no-shows differently from the payroll screen would be a second
  // opinion about the same money.
  const [policy, setPolicy] = useState<PayPolicy>(PAY_DELIVERED_ONLY);

  const w = useMemo(() => monthWindow(key), [key]);

  const load = useCallback(async (tenantId: string, mw: NonNullable<ReturnType<typeof monthWindow>>) => {
    setLoaded({ key: '', rec: EMPTY });
    // Five independent reads, deliberately not one Promise.all under a single
    // catch. An invoice table that 500s must not take the payments down with
    // it: the close is allowed to be partial, but only if it says which part
    // failed and refuses to be called closed over it.
    const [payments, invoices, sessions, memberships, passes] = await Promise.all([
      slice(() => fetchPayments(supabase, tenantId, mw.fromIso)),
      slice(() => fetchInvoices(tenantId, mw.lastDay)),
      slice(() => fetchSessions(supabase, tenantId, mw.fromIso, mw.toIso)),
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchPasses(supabase, tenantId)),
    ]);
    setLoaded({ key: mw.key, rec: { payments, invoices, sessions, memberships, passes } });
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
          rec: {
            payments: sliceReady([]), invoices: sliceReady([]), sessions: sliceReady([]),
            memberships: sliceReady([]), passes: sliceReady([]),
          },
        });
        return;
      }
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name, session_fee, currency').eq('id', who.tenantId).single();
      if (!live) return;
      // Checked, not assumed. A null session fee from a failed read would price
      // every unrated session at nothing and quietly shrink payroll; the two
      // are told apart so the screen can say "the fee could not be read".
      setGymName(tErr ? null : t?.name ?? null);
      setGymCcy(tErr ? null : (((t?.currency ?? '') as string).trim().toUpperCase() || null));
      setSessionFee(tErr ? null : t?.session_fee ?? null);
      setFeeRead(tErr ? 'failed' : 'ok');
      if (w) await load(who.tenantId, w);
    })();
    return () => { live = false; };
  }, [load, w, key]);

  // Only the record that was actually read for the month on screen. Anything
  // else is EMPTY, which renders as "still reading" rather than as another
  // month's figures.
  const rec = loaded.key === key ? loaded.rec : EMPTY;

  // The gym's currency as the record itself states it. Declared before the
  // close, not after: the formatter below closes over it, and a `const` read
  // before its own initialiser is a ReferenceError, not a fallback.
  const currency = useMemo(() => currencyOf(rec, gymCcy), [rec, gymCcy]);

  const close: MonthClose | null = useMemo(() => {
    if (!w) return null;
    return buildClose(rec, w, {
      policy,
      // The gym's fee is in major units; everything downstream is minor units.
      fallbackRateCents: sessionFee == null ? null : Math.round(sessionFee * 100),
      fmt: (c) => money(c, currency) ?? '—',
    });
  }, [rec, w, policy, sessionFee, currency]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/close">
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
      <Shell me={me} gymName={gymName} current="/close">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          A month-end close carries every payment and every payroll figure the
          gym holds, so it is owner-only.
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} current="/close">
      <h1>Month-End Close</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What came in, what it was for, what is still owed, what does not
        reconcile, and what is still unmarked and therefore blocking payroll.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
        <select value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, minWidth: 190 }}>
          {months.map((m) => {
            const mw = monthWindow(m);
            return <option key={m} value={m}>{mw ? mw.label : m}</option>;
          })}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink2)', fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={policy.payNoShows}
            onChange={(e) => setPolicy((p) => ({ ...p, payNoShows: e.target.checked }))}
          />
          Pay no-shows
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink2)', fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={policy.payLateCancellations}
            onChange={(e) => setPolicy((p) => ({ ...p, payLateCancellations: e.target.checked }))}
          />
          Pay late cancellations
        </label>
      </div>

      {!w || !close ? (
        <Banner tone="crit">{key} is not a month this console can open.</Banner>
      ) : (
        <CloseView c={close} rec={rec} currency={currency} feeRead={feeRead} sessionFee={sessionFee} />
      )}
    </Shell>
  );
}

/* ── the close itself ──────────────────────────────────────────────────────── */

function CloseView({ c, rec, currency, feeRead, sessionFee }: {
  c: MonthClose;
  rec: CloseRecord;
  currency: TenantCurrency;
  feeRead: 'ok' | 'failed';
  sessionFee: number | null;
}) {
  const m = (cents: number | null | undefined) => money(cents, currency);

  return (
    <>
      <Verdict c={c} />

      {c.warning ? <Banner tone="crit">{c.warning}</Banner> : null}
      {feeRead === 'failed' ? (
        <Banner tone="crit">
          The gym&rsquo;s session fee could not be read, so any session without its
          own snapshotted rate is left unpriced rather than valued at nothing.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Taken"
          text={c.income ? m(c.income.takenCents) : null}
          note={
            !c.income ? stateNote(rec.payments, 'payments')
              : c.income.currencies.length > 1 ? 'more than one currency — not summed'
              : c.income.count === 0 ? 'nothing recorded this month'
              : `${c.income.count} payment${c.income.count === 1 ? '' : 's'}`
          }
        />
        <Kpi
          label="Billed this month"
          text={c.owed ? m(sumOrNull(c.owed.settledCents, c.owed.outstandingCents)) : null}
          note={
            !c.owed ? stateNote(rec.invoices, 'invoices')
              : c.owed.issued === 0 ? 'no invoice issued'
              : `${c.owed.issued} invoice${c.owed.issued === 1 ? '' : 's'}${c.owed.dropped ? `, ${c.owed.dropped} void or written off` : ''}`
          }
        />
        <Kpi
          label="Still owed"
          text={c.arrears ? m(c.arrears.outstandingCents) : null}
          note={
            !c.arrears ? stateNote(rec.invoices, 'invoices')
              : c.arrears.outstanding === 0 ? 'nothing outstanding'
              : `${c.arrears.outstanding} open, ${c.arrears.overdue} past due`
          }
        />
        <Kpi
          label="Payroll"
          text={c.payroll ? m(c.payroll.total.cents) : null}
          note={
            !c.payroll ? stateNote(rec.sessions, 'one-to-ones')
              : c.payroll.total.unmarked > 0
                ? `NOT final — ${c.payroll.total.unmarked} unmarked`
                : c.payroll.total.payable === 0 ? 'no payable sessions'
                : `${c.payroll.total.delivered} delivered`
          }
        />
        <Kpi
          label="Unmarked sessions"
          text={c.payroll ? String(c.payroll.total.unmarked) : null}
          note={!c.payroll ? stateNote(rec.sessions, 'one-to-ones') : 'finished, outcome never recorded'}
        />
      </div>

      <Income c={c} rec={rec} currency={currency} />
      <Owed c={c} rec={rec} currency={currency} />
      <Reconciliation c={c} rec={rec} />
      <Payroll c={c} rec={rec} currency={currency} sessionFee={sessionFee} />
      <Passes c={c} rec={rec} currency={currency} />
    </>
  );
}

/**
 * The verdict, and the reasons — in that order, before a single figure.
 *
 * A blocked month gets no tick, no amber, no "mostly closed". It gets the list
 * of what is in the way, each line an action.
 */
function Verdict({ c }: { c: MonthClose }) {
  const blocked = c.state === 'blocked';
  return (
    <section
      style={{
        border: '1px solid var(--ring)',
        borderLeft: `3px solid ${blocked ? 'var(--crit)' : 'var(--brand)'}`,
        borderRadius: 0, background: 'var(--surface)', padding: '14px 16px', marginTop: 18,
      }}
    >
      <div className="micro">{blocked ? 'Not closed' : 'Can be closed'}</div>
      <p style={{ margin: '7px 0 0', fontSize: 14.5, color: 'var(--ink)' }}>
        {closeHeadline(c)}
      </p>
      {blocked ? (
        <ol style={{ margin: '12px 0 0', paddingLeft: 20, color: 'var(--ink2)', fontSize: 13.5 }}>
          {c.blockers.map((b: Blocker, i: number) => (
            <li key={`${b.kind}-${i}`} style={{ marginBottom: 6 }}>{b.text}</li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/* ── what came in, and what it was for ─────────────────────────────────────── */

function Income({ c, rec, currency }: { c: MonthClose; rec: CloseRecord; currency: TenantCurrency }) {
  // Null for either of `money()`'s two silences — no amount, or no currency —
  // and the sentence below has to hold together under both.
  const unattributed = c.income ? money(c.income.unattributedCents, currency) : null;
  const cols: Column<Line>[] = [
    { key: 'label', header: 'How it arrived', value: (l) => l.label },
    { key: 'count', header: 'Payments', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, currency) },
  ];

  const purposeCols: Column<Line>[] = [
    { key: 'label', header: 'What it was for', value: (l) => l.label },
    { key: 'count', header: 'Payments', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, currency) },
  ];

  return (
    <Section
      title="What came in"
      sub="Only payments somebody recorded. Nothing here is inferred from a membership price, and nothing is pro-rated."
    >
      <Part slice={rec.payments} what="the payments taken">
        {c.income ? (
          <DataTable
            rows={c.income.byMethod} columns={cols} rowKey={(l) => l.key}
            empty="No payment was recorded in this month. That is not the same as no income — it is the same as nobody having entered one."
          />
        ) : null}
      </Part>

      <div style={{ borderTop: '1px solid var(--ring)' }}>
        <div style={{ padding: '11px 14px' }}>
          <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>What it was for</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
            The payments table holds no category, so this is attribution rather
            than accounting: whether the payer held a membership covering the
            month. Nothing is guessed from the amount.
          </p>
        </div>
        {rec.memberships.state === 'loading' || rec.payments.state === 'loading' ? <Loading /> : null}
        {rec.memberships.state === 'failed' ? (
          <Failed reason={rec.memberships.reason} what="the membership roster"
                  cost="payments cannot be attributed, so this is unknown rather than unattributed" />
        ) : null}
        {c.purpose ? (
          <DataTable
            rows={c.purpose} columns={purposeCols} rowKey={(l) => l.key}
            empty="Nothing to attribute — no payment was recorded in this month."
          />
        ) : null}
        {c.income && c.income.unattributed > 0 ? (
          <p style={{ margin: 0, padding: '0 14px 14px', color: 'var(--ink3)', fontSize: 12.5 }}>
            {/* The amount is a clause, not the subject: `money()` returns null
                at a gym that has not set its currency, and React renders null as
                nothing — which left " . Counted in the total" with a space and a
                full stop where the figure should be. The count is what this
                paragraph is for and it is always known, so the money joins it
                only when it can be written. */}
            {c.income.unattributed} payment{c.income.unattributed === 1 ? '' : 's'} carr
            {c.income.unattributed === 1 ? 'ies' : 'y'} nobody&rsquo;s name
            {unattributed ? <> &mdash; {unattributed}</> : null}. Counted in the total, and
            named here because it cannot be chased, refunded or explained later.
            {unattributed ? null : <> What they come to cannot be stated because {NO_CURRENCY_NOTE}.</>}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/* ── what is still owed ────────────────────────────────────────────────────── */

function Owed({ c, rec, currency }: { c: MonthClose; rec: CloseRecord; currency: TenantCurrency }) {
  const today = new Date().toISOString().slice(0, 10);
  // Both null at a gym that has not set a currency, and the paragraph below
  // states the invoice counts rather than a dash when they are.
  const outstanding = c.arrears ? money(c.arrears.outstandingCents, currency) : null;
  const dropped = c.arrears ? money(c.arrears.droppedCents, currency) : null;
  const open = (rec.invoices.state === 'ready' ? rec.invoices.rows : [])
    .filter((i) => i.status === 'open' || i.status === 'overdue')
    .filter((i) => i.issuedOn <= c.window.lastDay);

  const cols: Column<GymInvoice>[] = [
    { key: 'member', header: 'Member', value: (i) => i.memberName },
    { key: 'issued', header: 'Issued', value: (i) => i.issuedOn },
    { key: 'due', header: 'Due', value: (i) => i.dueOn,
      render: (i) => i.dueOn
        ? <span style={{ color: isOverdue(i, today) ? 'var(--crit)' : undefined }}>{i.dueOn}</span>
        : <span className="dash">no due date set</span> },
    { key: 'amount', header: 'Amount', value: (i) => i.amountCents, numeric: true,
      render: (i) => money(i.amountCents, i.currency) },
    { key: 'status', header: 'Status', value: (i) => (isOverdue(i, today) ? 'overdue' : i.status),
      render: (i) => isOverdue(i, today)
        ? <span style={{ color: 'var(--crit)' }}>overdue</span>
        : <span>{i.status}</span> },
    { key: 'note', header: 'Note', value: (i) => i.note },
  ];

  return (
    <Section
      title="What is still owed"
      sub="Every invoice issued on or before the month end that is still unpaid — including ones raised in earlier months, because those are still money the gym is owed at this close."
    >
      <Part slice={rec.invoices} what="the invoice register">
        <>
          {c.arrears ? (
            <p style={{ margin: 0, padding: '12px 14px', color: 'var(--ink2)', fontSize: 13, borderBottom: '1px solid var(--ring)' }}>
              {/* The counts lead and the money follows, because `money()` is
                  null at a gym with no currency set and "— across 3 invoices"
                  is a sentence whose subject has gone missing. The invoice
                  counts are known either way, and they are the fact an owner
                  is reconciling against. */}
              {c.arrears.outstanding === 0
                ? 'Nothing outstanding. Every invoice issued up to the end of this month is settled, void or written off.'
                : <>
                    {c.arrears.outstanding} invoice{c.arrears.outstanding === 1 ? '' : 's'} still unpaid
                    {outstanding ? <>, {outstanding} in all</> : null}, of which{' '}
                    {c.arrears.overdue} {c.arrears.overdue === 1 ? 'is' : 'are'} past a due date the gym set.
                    {outstanding ? null : ` What they come to cannot be stated because ${NO_CURRENCY_NOTE}.`}
                    {c.arrears.dropped
                      ? dropped
                        ? ` A further ${dropped} is void or written off and is counted in neither what was taken nor what is owed.`
                        : ` A further ${c.arrears.dropped} invoice${c.arrears.dropped === 1 ? ' is' : 's are'} void or written off and counted in neither what was taken nor what is owed.`
                      : null}
                  </>}
            </p>
          ) : null}
          <DataTable
            rows={open} columns={cols} rowKey={(i) => i.id}
            empty="No unpaid invoice stands against this month. If the gym does not invoice through Repple, that is what this looks like — there is no second record to check the takings against."
          />
        </>
      </Part>
    </Section>
  );
}

/* ── what does not reconcile ───────────────────────────────────────────────── */

function Reconciliation({ c, rec }: { c: MonthClose; rec: CloseRecord }) {
  const bothRead = rec.payments.state === 'ready' && rec.invoices.state === 'ready';

  return (
    <Section
      title="What does not reconcile"
      sub="Money banked against money the invoice register says arrived, at the gym's own 2% tolerance — the same rule the financial-health screen uses, not a second one."
    >
      <div style={{ padding: '14px' }}>
        {!bothRead ? (
          <p style={{ margin: 0, color: 'var(--ink2)', fontSize: 13.5 }}>
            {rec.payments.state === 'loading' || rec.invoices.state === 'loading'
              ? 'Still reading both sides.'
              : 'One side of the comparison could not be read, so no reconciliation is offered. A check run against a failed read looks like a finding, which is worse than no check.'}
          </p>
        ) : !c.check ? (
          <p style={{ margin: 0, color: 'var(--ink2)', fontSize: 13.5 }}>
            Nothing to reconcile: no payment was recorded in {c.window.label} and no
            invoice in it is marked paid. Two silences, not an agreement.
          </p>
        ) : (
          <>
            <div className="micro">{RECON_LABEL[c.check.r.state]}</div>
            <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'var(--ink2)' }}>
              {c.check.note ?? 'The two sides agree inside the 2% tolerance. Nothing to explain.'}
            </p>
            {c.check.gapCents != null && c.check.r.state === 'differs' ? (
              <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--ink3)' }}>
                The difference is {(c.check.r.driftPct! * 100).toFixed(1)}% of what the
                register expected. It is shown, not absorbed: no figure on this page
                has been adjusted to make the two agree.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}

const RECON_LABEL: Record<string, string> = {
  no_record: 'Nothing to check against',
  not_entered: 'The register says money arrived that no payment shows',
  agrees: 'Agrees',
  differs: 'Does not reconcile',
};

/* ── what is unmarked, and therefore blocking payroll ──────────────────────── */

function Payroll({ c, rec, currency, sessionFee }: {
  c: MonthClose; rec: CloseRecord; currency: TenantCurrency; sessionFee: number | null;
}) {
  const unmarked = useMemo(
    () => (rec.sessions.state === 'ready' ? rec.sessions.rows : [])
      .filter((s) => inWindow(s.startsAt, c))
      .filter((s) => isAwaitingOutcome(s)),
    [rec.sessions, c],
  );

  // Null when the gym has not set a currency — see the paragraph below, which
  // states the session count instead of a dash where the total would go.
  const payrollTotal = c.payroll ? money(c.payroll.total.cents, currency) : null;

  const cols: Column<PayrollLine>[] = [
    { key: 'trainer', header: 'Trainer', value: (l) => l.trainerName },
    { key: 'delivered', header: 'Delivered', value: (l) => l.delivered, numeric: true },
    { key: 'noShows', header: 'No-shows', value: (l) => l.noShows, numeric: true },
    { key: 'cancelled', header: 'Cancelled', value: (l) => l.cancelled, numeric: true },
    { key: 'unmarked', header: 'Unmarked', value: (l) => l.unmarked, numeric: true,
      render: (l) => l.unmarked
        ? <span style={{ color: 'var(--crit)' }}>{l.unmarked}</span>
        : <span className="dash">0</span> },
    { key: 'cents', header: 'Pay', value: (l) => l.cents, numeric: true,
      render: (l) => l.cents == null
        ? <span className="dash">no rate</span>
        : <>{money(l.cents, currency)}</> },
  ];

  const sessionCols: Column<PtSession>[] = [
    { key: 'when', header: 'Started', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleString() },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName },
    { key: 'client', header: 'Client', value: (s) => s.clientName },
    { key: 'mins', header: 'Minutes', value: (s) => s.durationMin, numeric: true },
    { key: 'rate', header: 'Rate held', value: (s) => s.rateCents, numeric: true,
      render: (s) => s.rateCents == null
        ? <span className="dash">not snapshotted</span>
        : <>{money(s.rateCents, currency)}</> },
  ];

  return (
    <Section
      title="What is unmarked, and therefore blocking payroll"
      sub="Payroll counts delivered sessions. A session nobody marked has an unknown outcome, is kept out of the total, and is listed here by name rather than footnoted under it."
    >
      <Part slice={rec.sessions} what="the one-to-ones">
        <>
          {c.payroll ? (
            <p style={{
              margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
              color: c.payroll.blocker ? 'var(--ink2)' : 'var(--ink3)', fontSize: 13,
            }}>
              {/* The payable count leads. `money()` is null at a gym with no
                  currency set, and "…is marked and priced. — across 12 payable
                  sessions." reads as a sentence that lost its total rather than
                  as a total nobody can write. */}
              {c.payroll.blocker
                ? <><strong>Not safe to settle.</strong> {c.payroll.blocker}</>
                : <>Every session in {c.window.label} is marked and priced. {c.payroll.total.payable} payable session{c.payroll.total.payable === 1 ? '' : 's'}{payrollTotal ? <>, {payrollTotal} in all</> : null}.{payrollTotal ? null : ` What they come to cannot be stated because ${NO_CURRENCY_NOTE}.`}</>}
              {sessionFee == null ? ' No standard session fee is set, so a session with no snapshotted rate stays unpriced rather than free.' : null}
            </p>
          ) : null}
          <DataTable
            rows={c.payroll?.lines ?? []} columns={cols} rowKey={(l) => l.trainerId}
            empty="No one-to-one ran in this month. Nothing to pay, and nothing blocking."
          />
          {unmarked.length ? (
            <div style={{ borderTop: '1px solid var(--ring)' }}>
              <div style={{ padding: '11px 14px' }}>
                <h3 style={{ fontSize: 13, margin: 0, color: 'var(--crit)' }}>
                  {unmarked.length} session{unmarked.length === 1 ? '' : 's'} waiting on an outcome
                </h3>
                <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
                  Mark {unmarked.length === 1 ? 'it' : 'them'} under Sessions. Until then
                  the payroll figure above is short by exactly{' '}
                  {unmarked.length === 1 ? 'this one' : `these ${unmarked.length}`}.
                </p>
              </div>
              <DataTable
                rows={unmarked} columns={sessionCols} rowKey={(s) => s.id}
                empty="—"
              />
            </div>
          ) : null}
        </>
      </Part>
    </Section>
  );
}

/* ── passes ────────────────────────────────────────────────────────────────── */

function Passes({ c, rec, currency }: { c: MonthClose; rec: CloseRecord; currency: TenantCurrency }) {
  // Null for either silence — no priced pass, or no gym currency — and the
  // sentence below has a branch for each.
  const passesTotal = c.passes ? money(c.passes.cents, currency) : null;
  return (
    <Section
      title="Passes sold"
      sub="A separate record, shown beside the takings and deliberately not added into them."
    >
      <Part slice={rec.passes} what="passes sold">
        <p style={{ margin: 0, padding: '14px', color: 'var(--ink2)', fontSize: 13.5 }}>
          {!c.passes || c.passes.sold === 0
            ? `No pass was issued in ${c.window.label}.`
            : <>
                {c.passes.sold} pass{c.passes.sold === 1 ? '' : 'es'} issued,{' '}
                {/* Three states, not two: no price recorded on any pass, prices
                    recorded but no currency to write them in, and both. The
                    middle one used to render `money()`'s null as nothing at all,
                    leaving " recorded across 4 of them." — a sentence starting
                    with a space where its subject belonged. */}
                {c.passes.cents == null
                  ? <>and not one carried a recorded price — so the amount is unknown, not nothing.</>
                  : passesTotal
                    ? <>{passesTotal} recorded across {c.passes.priced} of them.</>
                    : <>{c.passes.priced} of them carr{c.passes.priced === 1 ? 'ies' : 'y'} a recorded price, but what they come to cannot be stated because {NO_CURRENCY_NOTE}.</>}
                {' '}Nothing links a pass row to a payment row, so this is not added to
                what came in: summing them would double-count every pass paid for at
                the desk, and ignoring it would drop the rest. Both records are shown
                instead of one invented total.
              </>}
        </p>
      </Part>
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/** Run one read into a slice, so a rejection becomes a stated failure rather
 *  than an empty month. */
async function slice<T>(run: () => Promise<T[]>): Promise<Slice<T>> {
  try {
    return sliceReady(await run());
  } catch (e: any) {
    return sliceFailed(e?.message ?? 'The read failed.');
  }
}

/**
 * Invoices issued on or before the end of the month being closed.
 *
 * Nothing had ever read `gym_invoices` — the status enum existed in
 * gymRecord.ts and no query did. This is the first, and it goes back past the
 * month on purpose: an invoice raised in June and unpaid in August is still
 * money owed at the August close, and scoping the query to August would have
 * reported that gym as owed nothing.
 *
 * `.error` is checked on both queries. supabase-js resolves on a database
 * error, so without it a failed read arrives as `data: null`, falls through
 * `?? []`, and this screen reports a gym that billed nothing and is owed
 * nothing — while continuing to call the month reconciled.
 *
 * Capped through src/lib/rowCap.ts, and refusing rather than reporting a
 * prefix. Same read and same reasoning as /accounting: PostgREST stops at 1000
 * rows silently, monthly billing to a couple of hundred members passes that
 * inside half a year, and the order is `issued_on desc` so what falls away is
 * the OLDEST — the long-unpaid invoices. This is the screen that says a month
 * is closed. A month cannot be closed against a set of invoices whose size
 * nobody knows.
 */
async function fetchInvoices(tenantId: string, upToDay: string): Promise<GymInvoice[]> {
  const { data, error } = await supabase
    .from('gym_invoices')
    .select('id, member_id, amount_cents, currency, issued_on, due_on, status, note')
    .eq('tenant_id', tenantId)
    .lte('issued_on', upToDay)
    .order('issued_on', { ascending: false })
    .limit(capLimit());
  if (error) throw error;

  const rows = assertWhole(data, 'the invoices up to the end of this month');
  if (!rows.length) return [];

  const names = await namesFor(rows.map((r: any) => r.member_id));
  return rows.map((r: any) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: names.get(r.member_id) ?? null,
    amountCents: r.amount_cents ?? 0,
    // Not `?? 'AED'`. The column is `not null default 'AED'` so this branch does
    // not fire in practice — and "in practice" is exactly what the currency bug
    // was made of. Null flows to money(), which withholds the figure.
    currency: r.currency ?? null,
    issuedOn: r.issued_on,
    dueOn: r.due_on ?? null,
    status: r.status ?? 'open',
    note: r.note ?? null,
  }));
}

/**
 * Names from `profiles`, where they live. Throws on a failed read rather than
 * returning an empty map — an unnamed invoice list on a chase-the-money screen
 * is not a cosmetic problem.
 *
 * Capped: `unique` is bounded by the invoice read above, which now refuses past
 * 1000 rows, so this can never legitimately ask for more. A read that comes
 * back at the ceiling means something else is wrong, and half a list of names
 * is not the answer to that.
 *
 * Fewer names than ids is not truncation. Verified against the live database:
 * `profiles_owner_tenant_r` is `is_owner_of(tenant_id)`, so ids outside this
 * owner's gym simply do not come back, and the row keeps its honest null.
 */
async function namesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase
    .from('profiles').select('id, full_name').in('id', unique).limit(capLimit());
  if (error) throw error;
  return new Map(assertWhole(data, 'the names on those invoices')
    .map((p: any) => [p.id, (p.full_name || '').trim()] as [string, string])
    .filter(([, n]) => !!n));
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

function inWindow(iso: string, c: MonthClose): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= Date.parse(c.window.fromIso) && t < Date.parse(c.window.toIso);
}

/** Two figures that may each be null. Null unless at least one is known — and
 *  a known one plus an unknown one is still not a total, so both must be
 *  present or absent together. */
function sumOrNull(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * The currency this close is denominated in — or null, which is a dash on every
 * figure and is the right answer more often than it looks.
 *
 * The last line of this used to be `return 'AED'`. So a month with no priced
 * payment and no invoice in it — a quiet month, a new gym, a month whose reads
 * failed — produced a close reporting itself in dirhams, and a close is the
 * document an owner reconciles against a bank statement and sends to an
 * accountant. Nothing about the number was marked as assumed.
 *
 * Order matters and it is deliberate: a row that STATES its currency wins,
 * because that is what was actually recorded against that money. The gym's own
 * `tenants.currency` is the fallback for a month with no rows to ask. And when
 * the gym has not set one either, there is genuinely no answer and the screen
 * says so rather than picking.
 *
 * ── why it asks the rows to AGREE ─────────────────────────────────────────
 *
 * This used to read `rec.payments.rows[0].currency` — the FIRST payment of the
 * month, denominating the whole close. `gym_payments.currency` is `not null
 * default 'AED'`, so any row written before the write path required a currency
 * is a dirham row, and one of those sitting at the top of August printed a
 * London gym's entire August — payroll, the per-trainer Pay column, the rate
 * held, passes sold — in dirhams. None of those figures comes from a payment at
 * all; they inherit the label. A close is what an owner reconciles against a
 * bank statement and hands to an accountant.
 *
 * So a set of rows only gets to name the currency when every priced row in it
 * names the same one. A set that disagrees has no single currency by
 * definition, and the honest next question is the gym's own — not whichever row
 * happened to sort first.
 *
 * Only ever used for rendering; no total is asserted across currencies anywhere.
 */
function agreedCurrency(rows: Array<{ currency: string | null }>): TenantCurrency {
  // A row with no currency of its own does not agree with the others — it is
  // silent, and silence is not consent to whatever the rest of them say.
  const seen = new Set(rows.map((r) => r.currency));
  return seen.size === 1 ? ([...seen][0] ?? null) : null;
}

function currencyOf(rec: CloseRecord, gym: TenantCurrency): TenantCurrency {
  if (rec.payments.state === 'ready' && rec.payments.rows.length) {
    const agreed = agreedCurrency(rec.payments.rows);
    if (agreed) return agreed;
  }
  if (rec.invoices.state === 'ready' && rec.invoices.rows.length) {
    const agreed = agreedCurrency(rec.invoices.rows);
    if (agreed) return agreed;
  }
  return gym;
}

/** The note under a KPI whose figure is missing — which of the three states it
 *  is missing for. */
function stateNote(s: Slice<unknown>, what: string): string {
  return s.state === 'failed' ? `${what} not read` : `reading ${what}…`;
}

/**
 * A section body that cannot lie about which of the three states it is in.
 * Same shape as the Members screen: loading says loading, failed says what
 * broke and what is therefore unknown, ready hands over to the table.
 */
function Part<T>({ slice, what, children }: {
  slice: Slice<T>; what: string; children: React.ReactNode;
}) {
  return (
    <>
      {slice.state === 'loading' ? <Loading /> : null}
      {slice.state === 'failed' ? <Failed reason={slice.reason} what={what} /> : null}
      {slice.state === 'ready' ? children : null}
    </>
  );
}

function Failed({ reason, what, cost }: { reason: string; what: string; cost?: string }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {what}. This section is <strong>unknown</strong>, not empty
      {cost ? <> — {cost}</> : null}. No month is closed over it.
      <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{reason}</div>
    </div>
  );
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

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
