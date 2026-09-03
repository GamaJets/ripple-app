'use client';

// Orders — what members bought online, and which of those went wrong.
//
// ── Why this route had to exist ────────────────────────────────────────────
//
// `gym_orders` (supabase/parts/281) is written by supabase/functions/
// gym-checkout and updated by the Stripe webhook. Its only reader in the whole
// product was `fetchMyGymOrders` in src/lib/memberBuy.ts, scoped to the BUYER,
// and later a phone screen at app/(owner)/orders.tsx. The console — the surface
// an owner actually sits in front of, the one that holds /money, /accounting
// and the export — could not see the order book at all.
//
// So a gym took card money through a Stripe account it owns and had no order
// list: no way to see what sold, no way to find somebody's receipt, no line to
// reconcile against the payout, and no answer at the desk to "did my payment go
// through?".
//
// `gym_orders_owner_r` has existed since part 281 — `for select using
// (is_owner_of(tenant_id))`. The rows were readable. Nobody was reading them.
//
// ── The three states this screen exists to separate ────────────────────────
//
// 'failed' is NOT a failed payment, and reading it as one is the mistake this
// page is built to prevent. Part 281 defines it as Stripe having taken the
// money while the entitlement could not be written — a member who paid and got
// nothing. `paidWithNothing` is the same harm arriving by a different door: a
// row marked paid with neither a membership nor a pass behind it, which the
// status column does not admit to. A stale 'pending' is the third and it is a
// question about the webhook rather than about the member.
//
// All three come from `orderTrouble` in src/lib/gymOrders.ts, which is pure and
// tested, so the arithmetic on this screen is assertable without a database.
//
// ── The money is per currency, never one total ─────────────────────────────
//
// Each order carries the currency it was CHARGED in, and a white-label gym that
// changed its currency has both in this table. `paidPots` groups by it and this
// screen prints one figure per currency, because a sum across two of them is
// not a bigger number, it is not a number. Nothing here reads the tenant's
// currency: the order says what it was, and the order is the record.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { readTenant } from '@/lib/currency';
import { Banner as SharedBanner, type BannerTone } from '@/components/Banner';
import { money } from '@lib/gymRecord';
import {
  fetchGymOrders, orderLine, orderTrouble, paidPots, countByStatus,
  ORDER_STATUS_LABEL, PENDING_STALE_MS, type GymOrderRow,
} from '@lib/gymOrders';

/**
 * How far back the list reads, as an owner would ask for it.
 *
 * `null` is everything, and it is offered rather than avoided: `fetchGymOrders`
 * PAGES through `readAll`, so the whole order book is a bounded number of round
 * trips and not a read that refuses at a thousand rows. Ninety days is the
 * default because "did my payment go through" is always about a recent one, and
 * an owner looking for an old receipt is looking on purpose.
 */
const SPANS: Array<{ id: string; label: string; days: number | null }> = [
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last year', days: 365 },
  { id: 'all', label: 'Everything', days: null },
];

const DAY_MS = 86400000;

/** A timestamp as a day. Never the string "null", never today by accident. */
const day = (iso: string | null | undefined): string => {
  const d = (iso ?? '').slice(0, 10);
  return d.length === 10 ? d : '—';
};

/** A timestamp as a day and a time, for the two columns where the minute is the
 *  answer: an order and its payment seconds apart is a working checkout. */
const stamp = (iso: string | null | undefined): string => {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toISOString().replace('T', ' ').slice(0, 16);
};

export default function Orders() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymErr, setGymErr] = useState<string | null>(null);

  const [rows, setRows] = useState<GymOrderRow[] | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [spanId, setSpanId] = useState('90');
  const [q, setQ] = useState('');

  const span = SPANS.find((s) => s.id === spanId) ?? SPANS[1];

  const load = useCallback(async (tenantId: string, days: number | null) => {
    setRows(null);
    setWhy(null);
    try {
      const since = days == null ? undefined : new Date(Date.now() - days * DAY_MS).toISOString();
      setRows(await fetchGymOrders(supabase as any, tenantId, since));
    } catch (e: any) {
      // Never `setRows([])` on a failure. An empty order book and an order book
      // that would not load are the same picture, and the wrong one of the two
      // tells a gym it has sold nothing online.
      setWhy(e?.message ?? 'The order book could not be read.');
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) return;
      const t = await readTenant(supabase, who.tenantId);
      if (!live) return;
      setGymName(t.name); setGymErr(t.error);
      await load(who.tenantId, span.days);
    })();
    return () => { live = false; };
    // Deliberately keyed on the span too: changing the period is a new read,
    // not a filter over rows that were never fetched.
  }, [load, span.days]);

  const trouble = useMemo(() => orderTrouble(rows ?? []), [rows]);
  const pots = useMemo(() => paidPots(rows ?? []), [rows]);
  const statuses = useMemo(() => countByStatus(rows ?? []), [rows]);

  /**
   * The desk's search: a name, an email-shaped fragment of one, an amount, or a
   * Stripe reference pasted out of the dashboard.
   *
   * A filter and NOT a second query, so it can never disagree with the list it
   * is filtering. The count line below says how many of how many, because a
   * filtered table that looks like the whole table is how somebody concludes a
   * gym has three orders.
   */
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !rows) return rows ?? [];
    return rows.filter((o) => {
      const hay = [
        o.memberName ?? '', o.memberId, o.id, o.status, o.kind, o.intent,
        o.currency, String(o.amountCents), orderLine(o),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  // A profile that did not READ is not a person without access. Same branch,
  // same words, as every other route in this console.
  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/orders">
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
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/orders">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          The order book carries what every member paid and the Stripe references
          behind it, so it is owner-only. That is the database&rsquo;s rule and not
          this page&rsquo;s: <code>gym_orders_owner_r</code> admits the owner of the
          tenant and nobody else.
        </p>
      </Shell>
    );
  }

  const cols: Column<GymOrderRow>[] = [
    { key: 'placed', header: 'Placed', value: (o) => o.createdAt, render: (o) => stamp(o.createdAt) },
    { key: 'who', header: 'Member', value: (o) => o.memberName ?? '￿',
      render: (o) => o.memberName ?? <span className="dash">a name that would not load</span> },
    { key: 'what', header: 'What', value: (o) => orderLine(o) },
    { key: 'status', header: 'Status', value: (o) => o.status,
      render: (o) => {
        const bad = o.status === 'failed' || (o.status === 'paid' && o.membershipId == null && o.passId == null);
        const wait = o.status === 'pending';
        return (
          <span style={{ color: bad ? 'var(--crit)' : wait ? '#f0c04e' : 'var(--ink2)' }}>
            {ORDER_STATUS_LABEL[o.status]}
            {o.status === 'paid' && o.membershipId == null && o.passId == null
              ? ' · nothing granted' : ''}
          </span>
        );
      } },
    { key: 'amount', header: 'Amount', value: (o) => o.amountCents, numeric: true, align: 'right',
      // The order's OWN currency. A gym that changed its currency has both in
      // this table and neither figure may borrow the other's unit.
      render: (o) => money(o.amountCents, o.currency)
        ?? <span className="dash">no currency on the order</span> },
    { key: 'paid', header: 'Paid', value: (o) => o.paidAt ?? '',
      render: (o) => o.paidAt ? stamp(o.paidAt) : <span className="dash">—</span> },
    { key: 'granted', header: 'Granted', value: (o) => (o.membershipId ?? o.passId) ?? '',
      render: (o) => o.membershipId ? 'Membership'
        : o.passId ? 'Pass'
        : <span className="dash">nothing</span> },
    // The join to the gym's own Stripe dashboard. It is the column the desk
    // actually uses: a member with a card statement has a reference, and this
    // is the only place in the product that can match one to a person.
    { key: 'ref', header: 'Order reference', value: (o) => o.id,
      render: (o) => <span className="mono" style={{ fontSize: 11.5 }}>{o.id.slice(0, 8)}</span> },
  ];

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={!!gymErr} current="/orders">
      <h1>Online orders</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '84ch' }}>
        Every checkout a member started on their phone, through this gym&rsquo;s own
        Stripe account. These are <strong>not</strong> in the payments ledger — that is the
        desk&rsquo;s register and it holds what was taken at the counter. An order marked
        &ldquo;Paid, not granted&rdquo; is somebody who was charged and got nothing: it is a
        job for today, not a payment that failed.
      </p>

      {why ? (
        <Banner tone="crit">
          The order book could not be read: {why} Nothing below is a count of your orders —
          this screen is showing an empty list because a query did not answer, not because
          nobody has bought anything.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', margin: '18px 0 8px', alignItems: 'baseline' }}>
        {SPANS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSpanId(s.id)}
            style={{
              ...field, cursor: 'pointer',
              background: s.id === spanId ? 'var(--surface3)' : 'var(--surface2)',
              color: s.id === spanId ? 'var(--ink)' : 'var(--ink2)',
            }}
          >
            {s.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a member, an amount or a reference"
          aria-label="Find an order"
          style={{ ...field, minWidth: 260 }}
        />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
        margin: '14px 0 26px', overflow: 'hidden',
      }}>
        <Kpi label="Orders" text={rows ? String(rows.length) : null}
             note={rows ? (rows.length === 0 ? 'none in this period' : span.label.toLowerCase()) : why ? 'not read' : undefined} />
        <Kpi label="Paid and not granted" text={rows ? String(trouble.failed.length + trouble.paidWithNothing.length) : null}
             note={rows && (trouble.failed.length + trouble.paidWithNothing.length) > 0
               ? 'somebody paid and is owed it' : rows ? 'nobody is owed anything' : undefined} />
        <Kpi label="Stuck pending" text={rows ? String(trouble.stuck.length) : null}
             note={rows && trouble.stuck.length > 0
               ? 'older than a Stripe session can live' : rows ? 'none' : undefined} />
        {/* One tile per currency, because there is no such thing as a blended
            total. A gym with one currency sees one tile and notices nothing. */}
        {pots.length === 0 ? (
          <Kpi label="Taken online" text={rows ? '—' : null}
               note={rows ? (rows.length ? 'nothing paid in this period' : 'no orders in this period') : undefined} />
        ) : pots.map((p) => (
          <Kpi key={p.currency} label={`Taken online · ${p.currency}`}
               text={money(p.cents, p.currency) ?? '—'}
               note={`${p.count} paid ${p.count === 1 ? 'order' : 'orders'}`} />
        ))}
      </div>

      {/* The two things somebody has to act on, named separately, above the
          list. A count in a tile is a number; this is a sentence with people in
          it. */}
      {rows && (trouble.failed.length > 0 || trouble.paidWithNothing.length > 0) ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>
            {trouble.failed.length + trouble.paidWithNothing.length}{' '}
            {trouble.failed.length + trouble.paidWithNothing.length === 1 ? 'member has' : 'members have'}{' '}
            paid and been given nothing.
          </strong>{' '}
          Stripe took the money and the membership or pass could not be written, so nothing in this
          product is currently letting them in. Grant it by hand from the member&rsquo;s own page —
          nothing here does it for you, and nothing will retry.{' '}
          {[...trouble.failed, ...trouble.paidWithNothing]
            .slice(0, 6).map((o) => o.memberName ?? 'an unnamed member').join(', ')}
          {trouble.failed.length + trouble.paidWithNothing.length > 6
            ? ` and ${trouble.failed.length + trouble.paidWithNothing.length - 6} more` : ''}.
        </Banner>
      ) : null}

      {rows && trouble.stuck.length > 0 ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>
            {trouble.stuck.length} {trouble.stuck.length === 1 ? 'order has' : 'orders have'} sat
            unpaid longer than a Stripe checkout can stay alive.
          </strong>{' '}
          A session expires after 24 hours and the webhook should have moved these to abandoned
          {' '}{Math.round(PENDING_STALE_MS / 3600000)} hours ago. Nobody has necessarily been
          charged — this is a question about whether the webhook is arriving, not a debt.
        </Banner>
      ) : null}

      <Section
        title="Every order"
        sub="Newest first. The reference is this order's own id, which is what a Stripe payment in the gym's dashboard carries in its metadata."
      >
        {rows === null ? (
          <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
            {why ? 'The order book could not be read. The banner above says why.' : 'Loading…'}
          </div>
        ) : (
          <>
            {q.trim() ? (
              <p style={{ margin: 0, padding: '10px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                Showing {shown.length} of {rows.length} — this is a filter over what was read for{' '}
                {span.label.toLowerCase()}, not a search of the whole order book.
              </p>
            ) : null}
            <DataTable
              rows={shown} columns={cols} rowKey={(o) => o.id} noun="orders"
              empty={q.trim()
                ? 'Nothing in this period matches what you typed. Widen the period before concluding the order does not exist.'
                : 'No online orders in this period. This read came back and came back empty — it is not a failure, and it is not the whole order book unless the period says Everything.'}
            />
          </>
        )}
      </Section>

      <Section
        title="By status"
        sub="Every status in the rows that were read, including one this product has never heard of — a status left out of a total is how a state stops being visible."
      >
        {rows === null ? (
          <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
            {why ? 'Not read.' : 'Loading…'}
          </div>
        ) : statuses.length === 0 ? (
          <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
            No orders in this period, so there is nothing to break down.
          </div>
        ) : (
          <div style={{ padding: '12px 14px', display: 'grid', gap: 7 }}>
            {statuses.map(([s, n]) => (
              <div key={s} style={{ fontSize: 13, color: 'var(--ink2)' }}>
                <span className="mono" style={{ color: 'var(--ink)' }}>{n}</span>
                {' · '}
                {ORDER_STATUS_LABEL[s as keyof typeof ORDER_STATUS_LABEL] ?? s}
              </div>
            ))}
          </div>
        )}
      </Section>

      <p style={{ color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch', margin: '0 0 26px' }}>
        These orders are in the gym&rsquo;s export as <code>online-orders.csv</code>, with the Stripe
        account, session and payment-intent references each one reconciles to — those are not shown
        here because they are for a spreadsheet, not for a desk.
      </p>
    </Shell>
  );
}

/* ── bits (the same shapes as every other console page) ────────────────────── */

const field = {
  background: 'var(--surface2)', border: '1px solid var(--ring)', borderRadius: 0,
  color: 'var(--ink)', padding: '7px 10px', fontSize: 13, fontFamily: 'var(--sans)',
} as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>{sub}</p> : null}
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

function Banner({ children, tone }: { children: React.ReactNode; tone?: BannerTone }) {
  return <SharedBanner tone={tone} style={{ background: 'var(--surface2)', maxWidth: '84ch' }}>{children}</SharedBanner>;
}
