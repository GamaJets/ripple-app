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
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { Fetched, useFetched } from '@/components/Fetched';
import { searchRows, searchNote } from '@lib/consoleSearch';
import { readTenant } from '@/lib/currency';
// The reader's locale, the GYM's zone — the same answer /accounting, /close and
// every other screen in this console now gives. This page was the third
// convention: a raw UTC stamp, nobody's locale and nobody's clock.
import { gymDateTimeText, whoseClockNote } from '@lib/gymWhen';
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

/**
 * A timestamp as a day and a time, for the two columns where the minute is the
 * answer: an order and its payment seconds apart is a working checkout.
 *
 * It was `toISOString().replace('T', ' ').slice(0, 16)` — a raw UTC stamp with
 * no locale and no zone at all, and the third convention on one console. Two
 * screens away a payment date was drawn on the READER's clock, and a row count
 * on the same table was drawn in the reader's locale, so the same page answered
 * "whose format" three different ways on three consecutive lines.
 *
 * One answer now, everywhere: the reader's locale, the gym's zone. The gym's,
 * because an order placed at 01:00 on the 1st in Dubai belongs to that gym's
 * 1st whatever hour it was in Greenwich — and UTC was nobody's answer at all,
 * least of all a gym's.
 */
const stamp = (iso: string | null | undefined, zone: string | null): string =>
  gymDateTimeText(iso, zone, {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) ?? '—';

export default function Orders() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymErr, setGymErr] = useState<string | null>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);

  const [rows, setRows] = useState<GymOrderRow[] | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [spanId, setSpanId] = useState('90');
  const [q, setQ] = useState('');

  const span = SPANS.find((s) => s.id === spanId) ?? SPANS[1];

  const load = useCallback(async (tenantId: string, days: number | null): Promise<boolean> => {
    setWhy(null);
    try {
      const since = days == null ? undefined : new Date(Date.now() - days * DAY_MS).toISOString();
      setRows(await fetchGymOrders(supabase as any, tenantId, since));
      return true;
    } catch (e: any) {
      // Never `setRows([])` on a failure. An empty order book and an order book
      // that would not load are the same picture, and the wrong one of the two
      // tells a gym it has sold nothing online.
      // Never `setRows([])` on a failure, and never blank the rows already on
      // screen either: the orders below are still the ones the last successful
      // read returned, and the stamp under the tiles says which moment that
      // was. Blanking them on a refresh that failed would turn a gym that sold
      // eleven memberships into one that sold none.
      setWhy(e?.message ?? 'The order book could not be read.');
      return false;
    }
  }, []);

  /*
   * The order book, kept current.
   *
   * `gym_orders` is written by the checkout function and updated by the Stripe
   * webhook — both of them while somebody is standing at the desk asking
   * whether their payment went through. This screen exists precisely because
   * the order book had no reader; before this it had one that answered about
   * the moment the tab was opened and did not say which moment.
   *
   * Sixty seconds, plus every return to the tab. `orderTrouble`'s stale-pending
   * clock is `now = Date.now()` evaluated once per memo, so it did not advance
   * either while the screen sat open — re-reading is what moves both.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId ? load(me.tenantId, span.days) : Promise.resolve(false)),
    { everyMs: 60_000 },
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
      if (!who?.tenantId) return;
      const t = await readTenant(supabase, who.tenantId);
      if (!live) return;
      setGymName(t.name); setGymErr(t.error); setZone(t.zone);
      // Through `refresh`, so the first read stamps the same way every later
      // one does.
      refresh();
    })();
    return () => { live = false; };
    // Deliberately keyed on the span too: changing the period is a new read,
    // not a filter over rows that were never fetched.
  }, [load, span.days, refresh]);

  // Keyed on `readAt` as well as the rows: `orderTrouble`'s stale-pending
  // clock is a defaulted `now = Date.now()` evaluated once per memo, so without
  // this an order that crosses the stale threshold while the tab is open never
  // appears in the banner. Every re-read moves it.
  const trouble = useMemo(() => orderTrouble(rows ?? []), [rows, readAt]);
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
  //
  // This hand-rolled `hay.includes(needle)` over a single case-folded
  // substring, which is the one screen in the console that did. `searchRows`
  // — /door, /members, /staff, /passes, /classes, /invites and /retention all
  // use it — folds accents, so "zoe" finds "Zoë", and matches PER TERM, so
  // "sara ok" finds "Sara Okafor". A gym in Dubai or Lisbon types a member's
  // name without the accent because that is what is on the keyboard, and this
  // screen said it had none of their orders.
  const shown = useMemo(
    () => searchRows(rows ?? [], q, (o) => [
      o.memberName, o.memberId, o.id, o.status, o.kind, o.intent,
      o.currency, String(o.amountCents), orderLine(o),
    ]),
    [rows, q],
  );
  // And the sentence the other seven render beside their filtered lists. A
  // search that matches nothing emptied this table with nothing said.
  const note = searchNote(q, shown.length, rows?.length ?? 0);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

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
    { key: 'placed', header: 'Placed', value: (o) => o.createdAt, render: (o) => stamp(o.createdAt, zone) },
    { key: 'who', header: 'Member', value: (o) => o.memberName ?? '￿',
      render: (o) => o.memberName ?? <span className="dash">a name that would not load</span> },
    { key: 'what', header: 'What', value: (o) => orderLine(o) },
    { key: 'status', header: 'Status', value: (o) => o.status,
      render: (o) => {
        const bad = o.status === 'failed' || (o.status === 'paid' && o.membershipId == null && o.passId == null);
        const wait = o.status === 'pending';
        return (
          <span style={{ color: bad ? 'var(--crit)' : wait ? 'var(--warn)' : 'var(--ink2)' }}>
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
      render: (o) => o.paidAt ? stamp(o.paidAt, zone) : <span className="dash">—</span> },
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

      {/* Whose clock the two stamped columns below are on. Printed only when it
          is not the gym's — a caveat that appears for every reader on every
          screen is a caveat nobody reads. */}
      {whoseClockNote(zone) ? (
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '80ch' }}>
          Placed and Paid below are timed on your own device: {whoseClockNote(zone)}.
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', margin: '18px 0 8px', alignItems: 'baseline' }}>
        {SPANS.map((s) => (
            // `aria-pressed`, because which one is chosen was carried by a
            // background colour and nothing else — so a screen reader read
            // three identical buttons and no way to tell which window the
            // figures below belong to. The hour strip on /timetable was
            // already doing this ten lines from the day strip that was not.
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === spanId}
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

      {/* When the order book was last read. This is the screen the front desk
          answers "did my payment go through" from, and before this it could not
          see an order placed since the tab was opened. */}
      <Fetched at={readAt} busy={reading} onRefresh={refresh}
               what="the order book" style={{ margin: '-16px 0 22px' }} />

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
          // Announced. The node is mounted for the whole of the wait and only
          // its text changes, which is the one shape a reader reliably reads —
          // and the text that replaces "Loading…" here is a REFUSAL.
          <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
            {why ? 'The order book could not be read. The banner above says why.' : 'Loading…'}
          </div>
        ) : (
          <>
            {note ? (
              <p style={{ margin: 0, padding: '10px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                {note} This is a filter over what was read for {span.label.toLowerCase()}, not a
                search of the whole order book.
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
          <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
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

function Banner({ children, tone }: { children: React.ReactNode; tone?: BannerTone }) {
  return <SharedBanner tone={tone} style={{ background: 'var(--surface2)', maxWidth: '84ch' }}>{children}</SharedBanner>;
}
