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
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships, fetchPayments, money, sharedCurrency } from '@lib/gymRecord';
import {
  fetchSessions, isAwaitingOutcome, PAY_DELIVERED_ONLY,
  type PtSession, type PayPolicy, type PayrollLine,
} from '@lib/gymSessions';
import { fetchPasses } from '@lib/gymPasses';
import { payPolicyOf, PAY_POLICY_LABEL, NO_PAY_POLICY_NOTE, type PayPolicyCode } from '@lib/gymPolicy';
import { readAll } from '@lib/rowCap';
import { readByIds } from '@lib/idLookup';
import { NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { sliceLoading, sliceReady, sliceFailed, sliceNote, type Slice } from '@lib/memberView';
// The reader's locale, the GYM's zone. This page is printed for an accountant
// and every date on it is a month boundary; drawn on the reader's clock, a
// month closed at 09:00 in Dubai reads as the previous day in London.
import { gymDateText, gymDateTimeText } from '@lib/gymWhen';
import {
  monthWindow, recentMonths, monthKeyOf, buildClose, isOverdue, closeHeadline, monthEnded,
  type CloseRecord, type MonthClose, type GymInvoice, type Line, type Blocker,
} from '@lib/monthEnd';
import {
  fetchCloses, closeMonth, reopenMonth, snapshotOf, liveCloseFor,
  closeBlocker, reopenBlocker, driftSince,
  type MonthCloseRow,
} from '@lib/gymClose';
// `tenants.session_fee` is stored in WHOLE units and every `*_cents` column is
// in minor units, and the factor between them is not a hundred — it is a
// hundred in most of the world, one in Japan and Korea, and a thousand in
// Kuwait and Bahrain. `minorFromWhole` asks `currencyDecimals` rather than
// assuming; see the note on it in src/lib/coachMoney.ts.
import { minorFromWhole } from '@lib/coachMoney';
import { gymLink, noGymNote } from '@lib/gymLink';
import { parseGymZone, gymDay } from '@lib/gymZone';
// The reader's own calendar day — the fallback where the gym has set no zone,
// and the SAME one `buildClose` falls back to, so the sheet cannot hold two.
import { isoDay } from '@lib/weekStart';
import { Fetched, useFetched } from '@/components/Fetched';
import { toCsv } from '@lib/gymExport';
import { saveText } from '@/lib/save';
import { Banner } from '@/components/Banner';

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
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  // `tenants.currency`. A month-end close is the document an owner reconciles
  // against a bank statement, so the one thing it must not do is name a
  // currency nobody chose — see currencyOf() at the foot of this file.
  const [gymCcy, setGymCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  const [feeRead, setFeeRead] = useState<'ok' | 'failed'>('ok');

  // The record is stored WITH the month it was read for, and used only when the
  // two agree. Without that, switching from June to July renders one frame of
  // June's invoices under a July heading — and a close screen that shows the
  // wrong month's receivables, however briefly, is the exact failure this page
  // exists to prevent. A mismatch reads as "not loaded yet", which is true.
  const [loaded, setLoaded] = useState<{ key: string; rec: CloseRecord }>({ key: '', rec: EMPTY });

  // Every close and reopen this gym has recorded. Not scoped to the month on
  // screen: the history is the half an auditor wants, and a month closed,
  // reopened and closed again is three rows that only make sense together.
  //
  // null is "not read", which is NOT the same as "this gym has never closed a
  // month" — the section below says which, because offering a Close button over
  // a failed read is how a month gets closed twice.
  const [closes, setCloses] = useState<MonthCloseRow[] | null>(null);
  const [closesErr, setClosesErr] = useState<string | null>(null);

  // Default to the month that has actually finished. Opening on the running
  // month would greet an owner with a refusal about a month nobody claimed was
  // over, and train them to skip the refusals.
  const months = useMemo(() => recentMonths(MONTHS_OFFERED + 1), []);
  const [key, setKey] = useState<string>(() => {
    const all = recentMonths(2);
    return all[1] ?? monthKeyOf();
  });

  /**
   * Whether a no-show is payable is a gym policy, and this screen READS it.
   *
   * The comment here used to say that a close pricing no-shows differently from
   * the payroll screen "would be a second opinion about the same money", and
   * then held its own unsaved copy — so it was one. An owner ticked the box on
   * /sessions, walked here to settle the month, and this screen had reset. The
   * month was closed on a number the owner had already decided against, in the
   * one place in the console where the figure leaves the building.
   */
  const [policyCode, setPolicyCode] = useState<string | null>(null);

  const w = useMemo(() => monthWindow(key), [key]);

  const load = useCallback(async (tenantId: string, mw: NonNullable<ReturnType<typeof monthWindow>>): Promise<boolean> => {
    // Five independent reads, deliberately not one Promise.all under a single
    // catch. An invoice table that 500s must not take the payments down with
    // it: the close is allowed to be partial, but only if it says which part
    // failed and refuses to be called closed over it.
    const [payments, invoices, sessions, memberships, passes] = await Promise.all([
      // Bounded at BOTH ends. This computed a start date and no end, so a close
      // opened on a month from a year ago read every payment from that month up
      // to today — an unbounded set that the month's figures then filter back
      // down. `fetchPayments` now pages rather than refusing past a thousand
      // rows, so that no longer breaks the screen; it would still drag a year
      // of payments across the wire to total one month of them, and nothing
      // outside the month is used here.
      slice(() => fetchPayments(supabase, tenantId, mw.fromIso, mw.toIso)),
      slice(() => fetchInvoices(tenantId, mw.lastDay)),
      slice(() => fetchSessions(supabase, tenantId, mw.fromIso, mw.toIso)),
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchPasses(supabase, tenantId)),
    ]);
    setLoaded({ key: mw.key, rec: { payments, invoices, sessions, memberships, passes } });
    try {
      setCloses(await fetchCloses(supabase, tenantId));
      setClosesErr(null);
    } catch (e: any) {
      // Kept apart from the five reads above because it is not part of the
      // close: it is the record OF closes. A failure here leaves the figures
      // perfectly readable and only the Close button unusable, which is the
      // right trade — a Close pressed over a read that could not say whether
      // the month was already closed is the one mistake this table exists to
      // prevent.
      setCloses(null);
      setClosesErr(e?.message ?? 'The record of closed months could not be read.');
      return false;
    }
    // Whole only when all five reads AND the record of closes came back.
    return payments.state === 'ready' && invoices.state === 'ready'
      && sessions.state === 'ready' && memberships.state === 'ready'
      && passes.state === 'ready';
  }, []);

  /*
   * The close, kept current.
   *
   * Month-end is the one job in a gym two people genuinely do at once: the
   * owner on this screen, the bookkeeper on /accounting and /costs recording
   * the last of the month's invoices. This screen read once, at page open, and
   * then printed "Every figure reads today exactly as it read at the close" —
   * a comparison between a snapshot stored in the database and a read taken in
   * this browser minutes or hours ago. Taking a close from a stale read files a
   * month that was already different when the button was pressed, and the drift
   * line then reports no drift.
   *
   * Two minutes, plus every return to the tab.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId && w ? load(me.tenantId, w) : Promise.resolve(false)),
    { everyMs: 2 * 60_000 },
  );

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      // `sliceReady([])` is the gym saying it has none. An account with no gym
      // on it was written as five of them, so this screen closed a month over a
      // record it never read: no payments, no invoices, no sessions, nothing
      // blocking, and a verdict at the top of the page saying so. The render
      // below stops before any of that.
      const link = gymLink(who?.tenantId, 'payments, invoices or one-to-ones');
      if (!link.linked) return;
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name, session_fee, currency, session_pay_policy, timezone').eq('id', link.tenantId).single();
      if (!live) return;
      // Checked, not assumed. A null session fee from a failed read would price
      // every unrated session at nothing and quietly shrink payroll; the two
      // are told apart so the screen can say "the fee could not be read".
      setGymName(tErr ? null : t?.name ?? null);
      setGymCcy(tErr ? null : (((t?.currency ?? '') as string).trim().toUpperCase() || null));
      // The gym's own wall clock, for the one date this screen computes rather
      // than reads: what counts as overdue TODAY. See `Owed` below.
      const z = tErr ? { kind: 'clear' as const } : parseGymZone((t as any)?.timezone);
      setZone(z.kind === 'zone' ? z.zone : null);
      setSessionFee(tErr ? null : t?.session_fee ?? null);
      setPolicyCode(tErr ? null : (((t as any)?.session_pay_policy ?? null) as string | null));
      setFeeRead(tErr ? 'failed' : 'ok');
      // Through `refresh`, so the first read stamps the same way every later
      // one does.
      if (w) refresh();
    })();
    return () => { live = false; };
  }, [load, w, key, refresh]);

  // Only the record that was actually read for the month on screen. Anything
  // else is EMPTY, which renders as "still reading" rather than as another
  // month's figures.
  const rec = loaded.key === key ? loaded.rec : EMPTY;

  // The gym's currency as the record itself states it. Declared before the
  // close, not after: the formatter below closes over it, and a `const` read
  // before its own initialiser is a ReferenceError, not a fallback.
  const currency = useMemo(() => currencyOf(rec, gymCcy), [rec, gymCcy]);

  // The gym's stated policy, and the floor where it has not stated one. A close
  // built on delivered sessions alone cannot pay somebody more than they earned;
  // it can pay them less, which is why the screen says so rather than implying
  // the gym chose it.
  const stated = payPolicyOf(policyCode);
  const policy: PayPolicy = stated ?? PAY_DELIVERED_ONLY;

  /**
   * The gym's standard session fee in minor units, or null when it cannot be
   * stated in them.
   *
   * It was `Math.round(sessionFee * 100)`. A ¥6,000 fee became 600,000 minor
   * units and every session the register never marked was priced at ¥600,000 on
   * the sheet handed to an accountant; a Kuwaiti gym's came out at a tenth of
   * the truth. `minorFromWhole` asks the currency how many places it has.
   *
   * `gymCcy` and NOT `currency`. `currency` is what the month's rows happened to
   * agree on; the fee is `tenants.session_fee` and the only currency it is ever
   * denominated in is `tenants.currency`. Pricing a stored fee by the scale of
   * whatever the card machine took that month is the same bug wearing a hat.
   *
   * Null when the gym has no currency, and that is not zero: an unpriced session
   * stays unpriced, exactly as it does when no fee is set at all.
   */
  const feeCents = useMemo(() => minorFromWhole(sessionFee, gymCcy), [sessionFee, gymCcy]);

  const close: MonthClose | null = useMemo(() => {
    if (!w) return null;
    return buildClose(rec, w, {
      policy,
      fallbackRateCents: feeCents,
      // The GYM's day, which this call was not passing at all.
      //
      // `CloseOptions.today` in src/lib/monthEnd.ts exists for this one caller
      // and says so: "The day to judge an invoice overdue against… the GYM's
      // own, `gymDay(Date.now(), zone)`. It was not injectable at all until now,
      // and what it did instead was take UTC's calendar day… An invoice due on
      // the 31st was counted overdue from 5pm on the 31st in Los Angeles, on the
      // one screen an owner uses to sign off a month."
      //
      // The parameter landed and this call site never took it, so `buildClose`
      // fell through to `isoDay(new Date(now))` — the READER's day. That decides
      // `owed.overdue`, `owed.overdueCents` and the same two on `arrears`, which
      // are the arrears figures on the sheet and the blocker sentences under
      // them. Meanwhile `Owed` seven hundred lines below computes the gym's day
      // for itself and colours its Status column red on that — so one screen
      // counted overdue on two different calendars, and the row and the total
      // above it disagreed for the hours between the two midnights.
      //
      // `?? undefined` rather than `?? isoDay(...)`: with no zone, letting
      // `buildClose` fall back is byte-identical to what a zone-less gym gets
      // today, and the fallback is argued in one place rather than two.
      today: gymDay(Date.now(), zone) ?? undefined,
      fmt: (c) => money(c, currency) ?? '—',
    });
  }, [rec, w, policy, feeCents, currency, zone]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

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

  // Before any verdict. A close is the one screen in this console whose whole
  // job is to refuse, and refusing over an unread record is the one refusal it
  // must not turn into a clean bill of health.
  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} current="/close">
        <h1>Month-End Close</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('payments, invoices or one-to-ones')}
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
        {/* Named — see the same control on /accounting. */}
        <select aria-label="Which month" value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, minWidth: 190 }}>
          {months.map((m) => {
            const mw = monthWindow(m);
            return <option key={m} value={m}>{mw ? mw.label : m}</option>;
          })}
        </select>
        {/* Read, not offered. Two checkboxes stood beside this month picker and
            saved nothing, so the close could be settled on a policy the owner
            had set somewhere else and this screen had forgotten. */}
        <span style={{ color: 'var(--ink2)', fontSize: 12.5 }}>
          {feeRead === 'failed' ? (
            <>Pay policy unknown — the gym record could not be read; delivered sessions only.</>
          ) : stated ? (
            <>Pays for {PAY_POLICY_LABEL[policyCode as PayPolicyCode].toLowerCase()} ·{' '}
            <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a></>
          ) : (
            <>Pay policy not set — delivered sessions only ·{' '}
            <a href="/settings" style={{ color: 'var(--brand)' }}>set it on Gym</a></>
          )}
        </span>
      </div>

      {/* A month is closed here and the figure goes to an accountant, so the
          floor is said in a banner rather than only in a caption beside a
          dropdown. */}
      {feeRead !== 'failed' && !stated ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>No pay policy is stored for this gym</strong> —{' '}
          {NO_PAY_POLICY_NOTE}. Everything below pays delivered sessions only, which is the least
          this gym owes rather than a figure it has agreed to. A coach who held an hour for somebody
          who did not turn up is not in the total.
        </Banner>
      ) : null}

      {/* When these figures were read. The Verdict block below states that
          "every figure reads today exactly as it read at the close" — a
          comparison between a stored snapshot and THIS read, so the age of this
          read is part of the claim. */}
      <Fetched at={readAt} busy={reading} onRefresh={refresh} what="this month" />

      {!w || !close ? (
        <Banner tone="crit">{key} is not a month this console can open.</Banner>
      ) : (
        <CloseView
          c={close} rec={rec} currency={currency} gymCcy={gymCcy} zone={zone} feeRead={feeRead} sessionFee={sessionFee} feeCents={feeCents}
          gymName={gymName} monthKey={key} tenantId={me.tenantId!} me={me}
          closes={closes} closesErr={closesErr}
          onChange={refresh}
        />
      )}
    </Shell>
  );
}

/* ── the close itself ──────────────────────────────────────────────────────── */

function CloseView({ c, rec, currency, gymCcy, zone, feeRead, sessionFee, feeCents, gymName, monthKey, tenantId, me, closes, closesErr, onChange }: {
  c: MonthClose;
  rec: CloseRecord;
  /** `tenants.timezone` — the only correct basis for what "today" means to
   *  this gym. Null when the gym has not set one. */
  zone: string | null;
  /** What the PAYMENTS agree on. Only figures the payments produced may wear
   *  it — see `currencyOf`. */
  currency: TenantCurrency;
  /** `tenants.currency`. What the gym's own standing figures are denominated
   *  in: the session fee, and therefore payroll. */
  gymCcy: TenantCurrency;
  feeRead: 'ok' | 'failed';
  sessionFee: number | null;
  /** The same fee in MINOR units, or null when it cannot be stated in them.
   *  Two values rather than one because the sentences differ: a gym with no fee
   *  set and a gym whose currency would not read are told different things. */
  feeCents: number | null;
  gymName: string | null;
  monthKey: string;
  tenantId: string;
  me: Me;
  closes: MonthCloseRow[] | null;
  closesErr: string | null;
  onChange: () => void;
}) {
  const m = (cents: number | null | undefined) => money(cents, currency);

  // What the INVOICES agree on, and what the PASSES agree on. Null when a set
  // disagrees with itself, which is not a currency and must not borrow one.
  const owedCcy = rec.invoices.state === 'ready' ? agreedCurrency(rec.invoices.rows) : null;
  const passesCcy = rec.passes.state === 'ready' ? agreedCurrency(rec.passes.rows) : null;

  return (
    <>
      <Verdict c={c} />
      <Signoff
        c={c} currency={currency} monthKey={monthKey} zone={zone} tenantId={tenantId} me={me}
        closes={closes} closesErr={closesErr} onChange={onChange}
      />
      <Handoff c={c} rec={rec} currency={currency} gymName={gymName} monthKey={monthKey} />

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

      {/* ── one figure, one currency, and it is the one that produced it ──
          Every section below used to be handed `currency`, which `currencyOf`
          derives from the PAYMENTS rows. So a gym whose August card takings all
          happened to be in AED printed its GBP payroll, its GBP rates and its
          GBP arrears as dirhams — on the sheet that goes to an accountant,
          three inches above an invoice table rendering each row honestly with
          `money(i.amountCents, i.currency)`.

          Income keeps it, because Income IS the payments. Payroll takes the
          gym's own, because it comes from `sessions.rate_cents` and
          `tenants.session_fee` and from nothing else. Owed and Passes take what
          their own rows agree on, and null where they agree on nothing — which
          each of those sections already has a sentence for. */}
      <Income c={c} rec={rec} currency={currency} />
      <Owed c={c} rec={rec} currency={owedCcy} zone={zone} />
      <Reconciliation c={c} rec={rec} />
      <Payroll c={c} rec={rec} currency={gymCcy} zone={zone} sessionFee={sessionFee} feeCents={feeCents} />
      <Passes c={c} rec={rec} currency={passesCcy} />
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

/* ── closing it, and keeping it closed ─────────────────────────────────────── */

/**
 * The button this screen has never had.
 *
 * /close had no `closed_at`, no lock, no sign-off and no write of any kind:
 * `buildClose` recomputed the verdict from live rows on every load. So a month
 * closed on Monday was open again on Tuesday if anybody recorded a late
 * payment, /accounting re-reported it with different numbers, and the figure
 * the owner handed their accountant last week was unrecoverable — not disputed,
 * gone, because it was never a stored thing.
 *
 * Three things happen when this is pressed, and only the first is obvious:
 *
 *   1. A row records that this month was closed, by whom, and WITH THE FIGURES
 *      AS THEY STOOD. Snapshotted, exactly as `payroll_settlements` snapshots
 *      what was handed over rather than recomputing it from today's fee.
 *   2. The database stops accepting payments and invoices dated inside it —
 *      supabase/parts/182. A stored close that any later write can invalidate
 *      is a note, not a close.
 *   3. If the month is closed anyway over blockers, the blockers are stored
 *      verbatim, so a close made over a known problem reads as exactly that.
 *
 * Reopening is deliberate, needs a reason, and leaves the original close
 * standing. A month that closed and then moved is two facts and an auditor
 * wants both.
 */
function Signoff({ c, currency, monthKey, zone, tenantId, me, closes, closesErr, onChange }: {
  c: MonthClose; currency: TenantCurrency; monthKey: string;
  /** `tenants.timezone`. A close is stamped at an instant and read as a date;
   *  which date it is is a fact about the gym, not about the reader. */
  zone: string | null;
  tenantId: string; me: Me;
  closes: MonthCloseRow[] | null; closesErr: string | null; onChange: () => void;
}) {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /*
   * The close is confirmed, and the reopen beside it already was.
   *
   * `<button onClick={doClose}>` fired `closeMonth` on one click, with one
   * optional note field and nothing between the press and a permanent row —
   * while the Reopen beside it demanded a typed sentence, and /costs confirms
   * before removing one £40 line.
   *
   * Closing a month writes the snapshot every later drift comparison is
   * measured against, and supabase/parts/182 then refuses payment and cost
   * writes dated inside it. So the click that needed no confirmation was the
   * one that locks a month for the whole gym, and the one that needed a typed
   * sentence was the one that unlocks it.
   *
   * A step rather than a typed reason: a close is the ordinary, correct
   * month-end action and making somebody write a sentence to do their job is
   * how a confirmation becomes a thing people click through. What it must not
   * be is one press.
   */
  const [confirming, setConfirming] = useState(false);

  const live = closes ? liveCloseFor(monthKey, closes) : null;
  const history = (closes ?? []).filter((r) => r.monthKey === monthKey);
  const snap = snapshotOf(c, currency);
  const ended = monthEnded(c.window);
  const blocker = closes === null
    ? 'The record of closed months could not be read, so this console cannot tell whether this month is already closed. Closing it again would be refused by the database with an error nobody could act on.'
    : closeBlocker(monthKey, ended, live);

  const drift = live ? driftSince(live, snap, (cents) => money(cents, live.currency ?? currency) ?? 'an unstateable amount') : [];

  const doClose = async () => {
    setBusy(true); setErr(null);
    try {
      await closeMonth(supabase, tenantId, monthKey, snap, me.id, note.trim() || null);
      setNote(''); setConfirming(false);
      onChange();
    } catch (e: any) {
      setErr(`${monthKey} was NOT closed: ${e?.message ?? 'the write was refused'}. Nothing has changed and the month is still open.`);
    } finally { setBusy(false); }
  };

  const doReopen = async () => {
    if (!live) return;
    const why = reopenBlocker(reason);
    if (why) { setErr(why); return; }
    setBusy(true); setErr(null);
    try {
      await reopenMonth(supabase, live.id, reason, me.id);
      setReason('');
      onChange();
    } catch (e: any) {
      setErr(`${monthKey} was NOT reopened: ${e?.message ?? 'the write was refused'}. It is still closed, and the desk still cannot record a payment dated inside it.`);
    } finally { setBusy(false); }
  };

  return (
    <Section
      title={live ? `${monthKey} is closed` : `Close ${monthKey}`}
      sub={live
        ? 'The figures below are what the record says today. The ones stored at the close are beside them, and any difference is named — that is the whole reason they are stored.'
        : 'Closing writes the figures as they stand and stops the database accepting a payment or an invoice dated inside this month. Reopening is possible and takes a reason.'}
    >
      {closesErr ? (
        <Banner tone="crit">
          The record of closed months could not be read: {closesErr}. This section cannot say
          whether {monthKey} is closed, so it offers nothing rather than a button that might close
          it twice.
        </Banner>
      ) : null}
      {err ? <Banner tone="crit">{err}</Banner> : null}

      {live ? (
        <>
          <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--ink2)' }}>
            Closed by {live.closedByName ?? 'somebody whose name could not be read'} on{' '}
            <span className="mono">{gymDateTimeText(live.closedAt, zone) ?? 'a date that could not be read'}</span>.
            {live.note ? <> &ldquo;{live.note}&rdquo;</> : null}
          </div>
          {live.blockersAtClose ? (
            <div style={{ padding: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', whiteSpace: 'pre-line', maxWidth: '80ch' }}>
              Closed over these, which were outstanding at the time:{'\n'}{live.blockersAtClose}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', padding: '0 14px 14px' }}>
            <Kpi label="Taken, at the close" text={money(live.takenCents, live.currency)} note={live.currency ? undefined : NO_CURRENCY_NOTE} />
            <Kpi label="Billed, at the close" text={money(live.invoicedCents, live.currency)} />
            <Kpi label="Still owed, at the close" text={money(live.outstandingCents, live.currency)} />
            <Kpi label="Payroll, at the close" text={money(live.payrollCents, live.currency)}
                 note={live.unmarkedSessions ? `${live.unmarkedSessions} session(s) were unmarked` : undefined} />
          </div>
          {drift.length ? (
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--ring)' }}>
              <h3 style={{ fontSize: 13, margin: 0, color: 'var(--warn)' }}>
                The record has moved since this month was closed
              </h3>
              <p style={{ margin: '4px 0 8px', color: 'var(--ink3)', fontSize: 12, maxWidth: '76ch' }}>
                Not necessarily an error &mdash; a refund recorded in a later month correctly changes
                what this month&rsquo;s ledger says about a payment in it. It IS something the
                person holding the filed figure has to be told, and before the close was stored
                there was no way to know it had happened.
              </p>
              <ul style={{ margin: 0, padding: '0 0 0 18px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.6 }}>
                {drift.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
          ) : (
            <p style={{ margin: 0, padding: '0 14px 14px', color: 'var(--ink3)', fontSize: 12.5 }}>
              Every figure reads today exactly as it read at the close.
            </p>
          )}
          <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 14px', borderTop: '1px solid var(--ring)' }}>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
                   placeholder="Why this month is being reopened"
                   style={{ ...field, flex: 2, minWidth: 260 }} aria-label="Why this month is being reopened" />
            <button onClick={doReopen} disabled={busy || !reason.trim()} style={primaryBtn}>Reopen</button>
            <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '52ch' }}>
              The close above is kept and the reopen is recorded beside it, so a month that closed
              and then moved is visible as exactly that rather than as a month nobody ever closed.
            </span>
          </div>
        </>
      ) : (
        <div className="no-print" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="A note for whoever reads this later (optional)"
                   style={{ ...field, flex: 2, minWidth: 260 }} aria-label="A note on this close" />
            {confirming ? (
              <>
                <button onClick={doClose} disabled={busy} style={primaryBtn}>
                  {busy ? 'Closing…' : `Yes — close ${monthKey}`}
                </button>
                <button onClick={() => setConfirming(false)} disabled={busy} style={field}>
                  Not yet
                </button>
              </>
            ) : (
              <button onClick={() => { setErr(null); setConfirming(true); }} disabled={busy || !!blocker} style={primaryBtn}>
                {`Close ${monthKey}`}
              </button>
            )}
          </div>
          {confirming ? (
            <Banner tone="warn">
              <strong style={{ color: 'var(--ink)' }}>This files {monthKey} permanently.</strong>{' '}
              The figures on this screen are stored as they stand, and every later reading of this
              month is compared against them. The database will then refuse a payment, an invoice,
              a cost or a payroll run dated inside {monthKey} &mdash; for everybody, at both desks
              and in the office &mdash; until somebody reopens it with a written reason.
              {c.state === 'blocked'
                ? ' This month is not ready by the checks above, and the reasons are stored on the close word for word.'
                : ''}
            </Banner>
          ) : null}
          {blocker ? (
            <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--warn)', maxWidth: '76ch' }}>{blocker}</p>
          ) : c.state === 'blocked' ? (
            <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--warn)', maxWidth: '76ch' }}>
              This month is not ready by the checks above, and it can still be closed. The reasons
              are stored on the close, word for word, so a month signed off over a known problem
              reads later as a decision somebody took rather than as a clean month.
            </p>
          ) : null}
        </div>
      )}

      {/*
        * Off by one, in exactly the case the reason field was made mandatory for.
        *
        * This was `history.length > 1`. After ONE close and ONE reopen there is
        * one row for the month, `liveCloseFor` returns nothing (the close has a
        * `reopenedAt`), so `live` is null and the screen rendered the Close form
        * and nothing else — no reopen reason, no who, no when, no figures as
        * they stood. A month that was closed and then reopened showed no trace
        * of ever having been closed.
        *
        * The section's own argument, three hundred lines up: "Reopening is
        * deliberate, needs a reason, and leaves the original close standing. A
        * month that closed and then moved is two facts and an auditor wants
        * both." One row is already two facts whenever it carries a reopen.
        */}
      {history.length > 1 || history.some((h) => h.reopenedAt) ? (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--ring)' }}>
          <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>Everything that has happened to {monthKey}</h3>
          <ul style={{ margin: '6px 0 0', padding: '0 0 0 18px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.6 }}>
            {history.map((h) => (
              <li key={h.id}>
                Closed {gymDateText(h.closedAt, zone) ?? 'on a date that could not be read'} by {h.closedByName ?? 'somebody'}
                {h.reopenedAt
                  ? <>, reopened {gymDateText(h.reopenedAt, zone) ?? 'on a date that could not be read'} by {h.reopenedByName ?? 'somebody'} &mdash; &ldquo;{h.reopenReason}&rdquo;</>
                  : ' — still in force'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/* ── getting the close out of the browser ──────────────────────────────────── */

/**
 * The close, as a file and as a printed page.
 *
 * Same reasoning as the handoff on /accounting and the same shape, deliberately:
 * these are the two screens written for month-end, and before this wave neither
 * had an export, a print, a PDF or an email. A gym's month-end left the building
 * as a screenshot or a retyped column.
 *
 * One file. A close is a document — the verdict, the blockers, the takings, the
 * receivables and the payroll are read together, and five downloads is how the
 * blocker list ends up in Downloads on its own with nothing saying which month
 * it belongs to.
 *
 * The VERDICT and the BLOCKERS go in first, above every figure, for the same
 * reason they are at the top of the screen: a reader acts on the first thing
 * they see, and a file that opened with the takings would be a file whose
 * refusals are below the fold.
 */
function Handoff({ c, rec, currency, gymName, monthKey }: {
  c: MonthClose; rec: CloseRecord; currency: TenantCurrency;
  gymName: string | null; monthKey: string;
}) {
  const download = () => {
    const parts: string[] = [];

    parts.push(toCsv(
      ['Report', 'Gym', 'Month', 'From', 'To', 'Verdict', 'Currency', 'Generated'],
      [[
        'Month-end close', gymName ?? '(gym name unread)', c.window.label,
        c.window.firstDay, c.window.lastDay,
        c.state === 'blocked' ? 'NOT CLOSEABLE' : 'Closeable',
        currency ?? '(this gym has not set one)',
        new Date().toISOString(),
      ]],
    ));

    parts.push('\nWHY IT IS NOT CLOSEABLE\n');
    parts.push(c.blockers.length
      ? toCsv(['Kind', 'What is in the way'], c.blockers.map((b) => [b.kind, b.text]), false)
      : 'Nothing is in the way.\n');

    parts.push('\nHEADLINE FIGURES — minor units, in the currency above\n');
    parts.push(toCsv(
      ['Figure', 'Amount (minor units)', 'Note'],
      [
        ['Taken', c.income?.takenCents ?? null,
          c.income ? `${c.income.count} payment(s)${c.income.currencies.length > 1 ? ', more than one currency so no total' : ''}` : 'the payments were not read'],
        ['Still owed', c.arrears?.outstandingCents ?? null,
          c.arrears ? `${c.arrears.outstanding} open, ${c.arrears.overdue} past due` : 'the invoices were not read'],
        ['Payroll', c.payroll?.total.cents ?? null,
          c.payroll ? (c.payroll.total.unmarked > 0 ? `NOT FINAL — ${c.payroll.total.unmarked} unmarked` : `${c.payroll.total.delivered} delivered`) : 'the sessions were not read'],
      ],
      false,
    ));

    // Each line carries its OWN currency, and not the one in the front matter
    // above. This table used to be exported blended across currencies into a
    // file that states a single Currency at the top, which is the one figure on
    // the close an accountant breaks the month down by.
    parts.push('\nWHAT CAME IN, BY METHOD\n');
    parts.push(c.income
      ? toCsv(['How it arrived', 'Currency', 'Payments', 'Amount (minor units)'],
              c.income.byMethod.map((l) => [l.label, l.currency, l.count, l.cents]), false)
      : 'NOT EXPORTED — the payments could not be read. This is unknown, not nil.\n');

    parts.push('\nSTILL OWED AT THE MONTH END\n');
    parts.push(rec.invoices.state === 'ready'
      ? toCsv(
          ['Member', 'Issued', 'Due', 'Amount (minor units)', 'Currency', 'Status'],
          rec.invoices.rows
            .filter((i) => (i.status === 'open' || i.status === 'overdue') && i.issuedOn <= c.window.lastDay)
            .map((i) => [i.memberName, i.issuedOn, i.dueOn, i.amountCents, i.currency, i.status]),
          false)
      : 'NOT EXPORTED — the invoice register could not be read. This is unknown, not nil.\n');

    parts.push('\nPAYROLL BY TRAINER\n');
    parts.push(c.payroll
      ? toCsv(
          ['Trainer', 'Delivered', 'No-shows', 'Cancelled', 'Unmarked', 'Pay (minor units)'],
          c.payroll.lines.map((l) => [l.trainerName, l.delivered, l.noShows, l.cancelled, l.unmarked, l.cents]),
          false)
      : 'NOT EXPORTED — the sessions could not be read. This is unknown, not nil.\n');

    saveText(parts.join(''), `${slugOf(gymName)}-${monthKey}-close.csv`);
  };

  return (
    <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 22px' }}>
      <button onClick={download} style={primaryBtn}>Export this close (CSV)</button>
      <button onClick={() => window.print()} style={{ ...primaryBtn, background: 'transparent', color: 'var(--ink2)', border: '1px solid var(--ring)' }}>
        Print / save as PDF
      </button>
      <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '58ch' }}>
        The verdict and the blockers are the first two sections of the file, above every figure, for
        the same reason they are the first two things on this screen.
      </span>
    </div>
  );
}

/** A filename fragment from the gym's name, or a fallback rather than a file
 *  called "-2026-08-close.csv" that sorts before everything in a folder. */
function slugOf(name: string | null): string {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'gym';
}

/* ── what came in, and what it was for ─────────────────────────────────────── */

function Income({ c, rec, currency }: { c: MonthClose; rec: CloseRecord; currency: TenantCurrency }) {
  // Null for either of `money()`'s two silences — no amount, or no currency —
  // and the sentence below has to hold together under both.
  // The unattributed figure is denominated by the ROWS that make it up, not by
  // the gym's own currency. `unattributedCurrency` is null when those rows
  // disagree, and `money()` then returns null and the sentence below says why —
  // which is the same handling a missing gym currency already got.
  const unattributed = c.income ? money(c.income.unattributedCents, c.income.unattributedCurrency) : null;

  // ── every line prints the currency it is a sum of ──────────────────────────
  //
  // Both of these tables used to render `money(l.cents, currency)` against
  // lines that `incomeOf` and `purposeOf` had blended across currencies, so a
  // gym holding dirhams and pounds read one "Card" figure with a single
  // currency printed over it — on the close, which is the document an
  // accountant works from, and in the CSV below it. The grouping now splits by
  // currency, so each line is a sum of like things and states its own.
  const cols: Column<Line>[] = [
    { key: 'label', header: 'How it arrived', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency,
      render: (l) => l.currency ?? <span className="dash">not stated</span> },
    { key: 'count', header: 'Payments', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, l.currency) },
  ];

  const purposeCols: Column<Line>[] = [
    { key: 'label', header: 'What it was for', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency,
      render: (l) => l.currency ?? <span className="dash">not stated</span> },
    { key: 'count', header: 'Payments', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, l.currency) },
  ];

  return (
    <Section
      title="What came in"
      sub="Only payments somebody recorded. Nothing here is inferred from a membership price, and nothing is pro-rated."
    >
      <Part slice={rec.payments} what="the payments taken">
        {c.income ? (
          <DataTable noun="payment methods"
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
          <DataTable noun="income purposes"
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
            {/* Two different silences now reach this sentence and they are not
                the same fact. The rows themselves may disagree about what money
                they are, which is a thing about the payments; or nothing states
                a currency at all, which is a thing about the gym. */}
            {unattributed ? null : c.income && c.income.unattributedCurrency == null
              ? <> What they come to cannot be stated because those payments do not all state the same currency.</>
              : <> What they come to cannot be stated because {NO_CURRENCY_NOTE}.</>}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/* ── what is still owed ────────────────────────────────────────────────────── */

function Owed({ c, rec, currency, zone }: {
  c: MonthClose; rec: CloseRecord; currency: TenantCurrency; zone: string | null;
}) {
  // The GYM's today, not UTC's. This was `new Date().toISOString().slice(0, 10)`
  // — the UTC calendar date — which for a gym east of Greenwich turns over hours
  // before the gym's own day does and for one west of it hours after. This
  // figure decides which invoices read as overdue on a page printed for an
  // accountant, and an invoice due on the 31st is not late on the morning of
  // the 31st wherever the reader happens to be.
  //
  // The FALLBACK is `isoDay`, the reader's own day, and it was UTC's. Not a
  // free choice: `buildClose` at the top of this file is now handed
  // `gymDay(Date.now(), zone) ?? undefined` and falls back internally to
  // `isoDay(new Date(now))`, so a gym that has set no zone had this table
  // colouring its Status column on UTC's calendar while the "Still owed" tile
  // three inches above it counted `arrears.overdue` on the reader's. One
  // screen, two calendars, disagreeing for the hours between two midnights —
  // which is the whole defect this line was written to end, arriving by the
  // other door. The two fallbacks are now the same expression.
  const today = gymDay(Date.now(), zone) ?? isoDay(new Date());
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
          <DataTable noun="unpaid invoices"
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

function Payroll({ c, rec, currency, zone, sessionFee, feeCents }: {
  c: MonthClose; rec: CloseRecord; currency: TenantCurrency; zone: string | null;
  sessionFee: number | null; feeCents: number | null;
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
      // Three silences, not two. `money()` returns null where the currency is
      // unknown, and this cell rendered that as an EMPTY cell — a blank in the
      // Pay column of a payroll table reads as nothing owed.
      render: (l) => l.cents == null
        ? <span className="dash">no rate</span>
        : money(l.cents, currency) ?? <span className="dash">no currency set</span> },
  ];

  const sessionCols: Column<PtSession>[] = [
    { key: 'when', header: 'Started', value: (s) => s.startsAt,
      render: (s) => gymDateTimeText(s.startsAt, zone) ?? <span className="dash">not stated</span> },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName },
    { key: 'client', header: 'Client', value: (s) => s.clientName },
    { key: 'mins', header: 'Minutes', value: (s) => s.durationMin, numeric: true },
    { key: 'rate', header: 'Rate held', value: (s) => s.rateCents, numeric: true,
      render: (s) => s.rateCents == null
        ? <span className="dash">not snapshotted</span>
        : money(s.rateCents, currency) ?? <span className="dash">no currency set</span> },
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
              {sessionFee == null
                ? ' No standard session fee is set, so a session with no snapshotted rate stays unpriced rather than free.'
                : feeCents == null
                  ? ' This gym has not said what money it charges in, so its standard session fee cannot be stated as an amount and a session with no snapshotted rate stays unpriced rather than free.'
                  : null}
            </p>
          ) : null}
          <DataTable noun="payroll lines"
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
              <DataTable noun="unmarked sessions"
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
 * PAGED through src/lib/rowCap.ts rather than capped, and the difference is
 * the whole life of this screen. PostgREST stops at 1000 rows silently, monthly
 * billing to a couple of hundred members passes that inside half a year, and
 * the order is `issued_on desc` so what fell away was the OLDEST — the
 * long-unpaid invoices, which is precisely what a close is looking for.
 * Refusing was the right answer to that and a temporary one: a month cannot be
 * closed against a set of invoices whose size nobody knows, but nor can it be
 * closed against a read that has refused every month since the gym's first
 * year, and no gym can make its own invoice history shorter. `readAll` finishes
 * the read, and `PAGE_CEILING` still refuses past fifty thousand invoices — a
 * sentence about the size of the read rather than about the money.
 *
 * `issued_on` is a DATE, so a gym that raises its whole book on the first of
 * the month has hundreds of rows tied on it. `id` is the primary key and gives
 * `readAll` the total order it requires; without it, pages of a tied ordering
 * drop and repeat rows silently, which on this screen would be an invoice
 * missing from a closed month.
 */
async function fetchInvoices(tenantId: string, upToDay: string): Promise<GymInvoice[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_invoices')
      .select('id, member_id, amount_cents, currency, issued_on, due_on, status, note')
      .eq('tenant_id', tenantId)
      .lte('issued_on', upToDay)
      .order('issued_on', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    'the invoices up to the end of this month',
  );
  if (!rows.length) return [];

  const names = await namesFor(rows.map((r: any) => r.member_id));
  return rows.map((r: any) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: names.get(r.member_id) ?? null,
    amountCents: r.amount_cents ?? 0,
    // Not `?? 'AED'`. The column is NOT NULL and — since supabase/parts/150 —
    // has NO DEFAULT, so a write that omits the currency is rejected and a read
    // always finds one; this branch does not fire in practice. "In practice" is
    // exactly what the currency bug was made of, so it is still written: null
    // flows to money(), which withholds the figure.
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
 * CHUNKED through src/lib/idLookup.ts, and that stopped being optional when the
 * invoice read above started paging. `unique` used to be bounded by that read's
 * thousand-row refusal, so one `.in()` could not truncate; with the read
 * finished, a gym with five thousand invoices sends five thousand ids, gets the
 * first thousand names back with no complaint, and every invoice past that is
 * drawn with no name on the chase-the-money screen. A list that long is also a
 * 200KB query string, which a proxy refuses long before PostgREST sees it.
 *
 * Fewer names than ids is still not truncation. Verified against the live
 * database: `profiles_owner_tenant_r` is `is_owner_of(tenant_id)`, so ids
 * outside this owner's gym simply do not come back, and the row keeps its
 * honest null.
 */
async function namesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const rows = await readByIds<any>(
    ids,
    (chunk, from, to) => supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
    'the names on those invoices',
  );
  return new Map(rows
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
/*
 * `agreedCurrency` used to live here, as five lines that were `sharedCurrency`
 * in gymRecord.ts written a second time — and written without its
 * `.trim().toUpperCase()`, so ' gbp ' and 'GBP' were two currencies and this
 * close withheld a total the gym was entitled to. That export exists precisely
 * so a rule about money does not exist twice; /revenue had a third copy called
 * `oneCurrency` and it is gone for the same reason.
 */
const agreedCurrency = (rows: Array<{ currency: string | null }>): TenantCurrency =>
  sharedCurrency(rows);

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
  // Four arms via `sliceNote`, and the `??` keeps the 'ready' wording exactly
  // what it was. The arm that mattered is the fourth: a truncated read used to
  // fall into `reading …` and tell an accountant the month was still loading.
  return sliceNote(s, what) ?? `reading ${what}…`;
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
      {slice.state === 'partial' ? <Truncated what={what} cap={slice.cap} /> : null}
      {slice.state === 'ready' ? children : null}
    </>
  );
}

/**
 * The banner over a section whose read came back at its ceiling.
 *
 * Neither the failure banner nor the empty sentence: the rows are real and
 * there are more of them. It does not draw the table beneath it, because every
 * figure on this screen comes through `rowsOf`, which is null for a truncated
 * read on purpose — an empty table under a "cut off" heading is a worse page
 * than the heading alone. On a month-end screen this is the one that matters
 * most: a prefix of the month's payments is a smaller month, and the accountant
 * has no way to see that from a number.
 */
function Truncated({ what, cap }: { what: string; cap: number }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--warn)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Read the first {cap} rows of {what}, and there are more. This section is a{' '}
      <strong>prefix</strong>, not the whole month, so no figure is totalled over it and no
      month may be closed on it.
    </div>
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

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
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

