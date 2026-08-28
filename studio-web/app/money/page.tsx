'use client';

// Money — the gym's price book, its memberships and what it has been paid.
//
// This is Phase 1 of the roadmap, and deliberately a capture screen rather than
// a dashboard: until a gym records what it sells and what it takes, there is
// nothing for a chart to draw and nothing for a forecast to learn from.
import { useCallback, useEffect, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchPlans, createPlan, setPlanActive,
  fetchMemberships, createMembership, setMembershipStatus,
  fetchPayments, recordPayment,
  summarise, money,
  type MembershipPlan, type Membership, type GymPayment,
  type PlanInterval, type PaymentMethod,
} from '@lib/gymRecord';

const DAY = 86400000;

export default function Money() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameErr, setGymNameErr] = useState<string | null>(null);

  // Three independent reads, each carrying its own error. null means "not read
  // yet, or the read failed"; [] means "read, and the gym genuinely has none".
  // They are different facts and nothing on this screen may render them the
  // same way — the error strings are what tells the two apart.
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [plansErr, setPlansErr] = useState<string | null>(null);
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [membersErr, setMembersErr] = useState<string | null>(null);
  const [payments, setPayments] = useState<GymPayment[] | null>(null);
  const [paymentsErr, setPaymentsErr] = useState<string | null>(null);

  /**
   * Read the price book, the memberships and the payments taken.
   *
   * allSettled, not all: one failing read must not take the others with it.
   * Under a single catch over Promise.all, a price book that would not read
   * also blanked the memberships and the payments to [] — and [] renders as
   * "No payments recorded in the last 30 days", which an owner reads as a
   * month with no income rather than as a query that never came back. A read
   * that failed stays null, and every figure drawn from it shows a dash.
   */
  const load = useCallback(async (tenantId: string) => {
    const [pRes, mRes, payRes] = await Promise.allSettled([
      fetchPlans(supabase, tenantId),
      fetchMemberships(supabase, tenantId),
      fetchPayments(supabase, tenantId, new Date(Date.now() - 30 * DAY).toISOString()),
    ]);

    if (pRes.status === 'fulfilled') { setPlans(pRes.value); setPlansErr(null); }
    else { setPlans(null); setPlansErr(why(pRes.reason, 'Could not read the price book.')); }

    if (mRes.status === 'fulfilled') { setMembers(mRes.value); setMembersErr(null); }
    else { setMembers(null); setMembersErr(why(mRes.reason, 'Could not read the memberships.')); }

    if (payRes.status === 'fulfilled') { setPayments(payRes.value); setPaymentsErr(null); }
    else { setPayments(null); setPaymentsErr(why(payRes.reason, 'Could not read the payments.')); }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setPlans([]); setMembers([]); setPayments([]); return; }
      // supabase-js resolves with { data, error } on a database error rather
      // than rejecting, so the error has to be read off the result, not caught.
      // Destructuring only `data` turned an RLS refusal into t === null, and
      // the sidebar then printed "No gym linked" — a claim about the owner's
      // account, when the account is demonstrably linked (this is the branch
      // where tenantId exists) and all that failed was the name lookup.
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) {
        setGymName(tErr ? null : ((t as any)?.name ?? null));
        setGymNameErr(tErr ? (tErr.message || 'Could not read the gym name.') : null);
      }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/money">
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
      <Shell me={me} gymName={gymName} current="/money">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>Money is owner-only.</p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const sum = plans && members && payments ? summarise(payments, members, plans) : null;
  const refresh = () => load(tenantId);

  // summarise needs all three reads, so any one of them failing leaves every
  // figure above the tables unknown. Name the reads that did not arrive: a bare
  // dash sitting over the note "nothing recorded yet" is how a failure starts
  // being read as a confident zero.
  const failed = [
    paymentsErr ? 'the payments' : null,
    membersErr ? 'the memberships' : null,
    plansErr ? 'the price book' : null,
  ].filter((s): s is string => s !== null);
  const unread = failed.length ? `could not read ${failed.join(', ')}` : undefined;

  return (
    <Shell me={me} gymName={gymName} current="/money">
      <h1>Money</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What the gym sells, who holds a membership, and what has actually been paid.
      </p>

      {gymNameErr ? (
        <Banner tone="crit">
          This account is linked to a gym, but the gym&rsquo;s name could not be read: {gymNameErr}.
          The sidebar says &ldquo;No gym linked&rdquo; only because it has nothing to print — that
          is this failed lookup, not a fact about the account.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi label="Taken (30 days)" text={money(sum?.takenCents)} note={sum?.takenCents == null ? (unread ?? 'nothing recorded yet') : `${sum.payments} payments`} />
        <Kpi label="Recurring / month" text={money(sum?.mrrCents)} note={sum?.mrrCents == null ? (unread ?? 'no priced membership') : undefined} />
        <Kpi label="Active members" text={sum ? String(sum.activeMembers) : null} note={sum ? undefined : unread} />
        <Kpi label="Plans on sale" text={plans ? String(plans.filter((p) => p.active).length) : null} note={plans ? undefined : (plansErr ? 'the price book could not be read' : undefined)} />
      </div>

      <Plans plans={plans} readErr={plansErr} tenantId={tenantId} onChange={refresh} />
      <Members members={members} readErr={membersErr} plans={plans} tenantId={tenantId} onChange={refresh} />
      <Payments payments={payments} readErr={paymentsErr} members={members} tenantId={tenantId} me={me} onChange={refresh} />
    </Shell>
  );
}

/* ── plans ─────────────────────────────────────────────────────────────────── */

function Plans({ plans, readErr, tenantId, onChange }: {
  plans: MembershipPlan[] | null; readErr: string | null; tenantId: string; onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [interval, setInterval] = useState<PlanInterval>('month');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = parseFloat(price);
    if (!name.trim() || !isFinite(major)) return;
    setBusy(true); setWriteErr(null);
    try {
      await createPlan(supabase, tenantId, {
        name: name.trim(), priceCents: Math.round(major * 100), interval,
      });
      setName(''); setPrice(''); onChange();
    } catch (e: any) {
      // createPlan throws on a PostgREST error. With a try/finally and no
      // catch, the only visible effect of a refusal was the button coming back
      // to life: the plan never appeared in the table below, which reads as a
      // list that has not refreshed yet rather than as a write that did not
      // happen. The typed name and price are deliberately left in the form —
      // nothing was saved, so there is something to retry.
      setWriteErr(`That plan was not saved: ${e?.message ?? 'the write was refused'}. Nothing has changed in the price book.`);
    } finally { setBusy(false); }
  };

  const cols: Column<MembershipPlan>[] = [
    { key: 'name', header: 'Plan', value: (p) => p.name },
    { key: 'price', header: 'Price', value: (p) => p.priceCents, numeric: true,
      render: (p) => money(p.priceCents, p.currency) },
    { key: 'interval', header: 'Billed', value: (p) => p.interval,
      render: (p) => (p.interval === 'once' ? 'one-off' : `per ${p.interval}`) },
    { key: 'active', header: '', value: (p) => (p.active ? 1 : 0), align: 'right',
      render: (p) => (
        // setPlanActive rejects on a PostgREST error, and a bare .then swallowed
        // it: onChange never ran, so the row simply stayed as it was and the
        // owner saw a button that looked unclicked. Say which plan did not move
        // and which side of the price book it is still on.
        <button
          onClick={() => setPlanActive(supabase, p.id, !p.active)
            .then(() => { setWriteErr(null); onChange(); })
            .catch((e: any) => setWriteErr(
              `Could not ${p.active ? 'retire' : 'reinstate'} ${p.name}: ${e?.message ?? 'the change was refused'}. It is still ${p.active ? 'on sale' : 'retired'}.`))}
          style={linkBtn}
        >
          {p.active ? 'Retire' : 'Reinstate'}
        </button>
      ) },
  ];

  return (
    <Section title="Price book" sub="Retiring a plan keeps it on the memberships already sold on it.">
      <form onSubmit={add} style={formRow}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name" style={{ ...field, flex: 2 }} />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" inputMode="decimal" style={{ ...field, flex: 1 }} />
        <select value={interval} onChange={(e) => setInterval(e.target.value as PlanInterval)} style={{ ...field, flex: 1 }}>
          <option value="month">per month</option>
          <option value="year">per year</option>
          <option value="once">one-off</option>
        </select>
        <button type="submit" disabled={busy} style={primaryBtn}>Add plan</button>
      </form>
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {plans === null ? (
        readErr ? (
          <Banner tone="crit">
            The price book could not be read: {readErr}. This is not an empty price book — it is a
            query that did not come back, so nothing here can be taken as a list of what the gym
            sells. Reload the page.
          </Banner>
        ) : <Loading />
      ) : (
        <DataTable rows={plans} columns={cols} rowKey={(p) => p.id}
          empty="No plans yet. A gym cannot record a membership until it has something to sell." />
      )}
    </Section>
  );
}

/* ── memberships ───────────────────────────────────────────────────────────── */

function Members({ members, readErr, plans, tenantId, onChange }: {
  members: Membership[] | null; readErr: string | null;
  plans: MembershipPlan[] | null; tenantId: string; onChange: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  // Covers both writes in this section — adding a membership and changing one's
  // status. Either failing has to be visible; neither may look like nothing.
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId.trim()) return;
    setBusy(true); setWriteErr(null);
    try {
      await createMembership(supabase, tenantId, {
        memberId: memberId.trim(),
        planId: planId || null,
        startedOn: new Date().toISOString().slice(0, 10),
      });
      setMemberId(''); onChange();
    } catch (e: any) {
      setWriteErr(e?.message ?? 'Could not add that membership.');
    } finally { setBusy(false); }
  };

  const cols: Column<Membership>[] = [
    { key: 'member', header: 'Member', value: (m) => m.memberName || null },
    { key: 'plan', header: 'Plan', value: (m) => m.planName },
    { key: 'started', header: 'Started', value: (m) => m.startedOn },
    { key: 'ends', header: 'Ends', value: (m) => m.endsOn },
    { key: 'status', header: 'Status', value: (m) => m.status,
      render: (m) => <span style={{ textTransform: 'capitalize' }}>{m.status}</span> },
    { key: 'act', header: '', value: () => '', align: 'right',
      render: (m) => (
        // setMembershipStatus rejects on a PostgREST error, and a bare .then
        // dropped it. The select is driven by m.status, so a refused change
        // repainted the old value the moment the row re-rendered — the owner
        // sees the dropdown flick back and has no way to know whether they
        // misclicked or the database said no. Say which, and say what the
        // membership still is.
        <select
          value={m.status}
          onChange={(e) => {
            const next = e.target.value as any;
            setMembershipStatus(supabase, m.id, next)
              .then(() => { setWriteErr(null); onChange(); })
              .catch((err: any) => setWriteErr(
                `Could not set ${m.memberName || 'that membership'} to ${next}: ${err?.message ?? 'the change was refused'}. It is still ${m.status}.`));
          }}
          style={{ ...field, padding: '4px 6px', fontSize: 12 }}
        >
          <option value="active">active</option>
          <option value="frozen">frozen</option>
          <option value="cancelled">cancelled</option>
          <option value="expired">expired</option>
        </select>
      ) },
  ];

  return (
    <Section title="Memberships" sub="The member id is their Repple account id — the same person who signs into the app.">
      <form onSubmit={add} style={formRow}>
        <input value={memberId} onChange={(e) => setMemberId(e.target.value)}
               placeholder="Member account id (uuid)" style={{ ...field, flex: 3, fontFamily: 'var(--mono)', fontSize: 12.5 }} />
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} style={{ ...field, flex: 2 }}>
          {/* A price book that would not read leaves this list with nothing in
              it, which is indistinguishable from a gym that sells nothing. The
              placeholder says which, so nobody sells a membership off-plan
              believing there was no plan to put it on. */}
          <option value="">{plans === null ? 'No plan — the price book could not be read' : 'No plan'}</option>
          {(plans ?? []).filter((p) => p.active).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="submit" disabled={busy} style={primaryBtn}>Add membership</button>
      </form>
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {members === null ? (
        readErr ? (
          <Banner tone="crit">
            The memberships could not be read: {readErr}. Nobody has been cancelled and nobody has
            left — the list did not come back, which is why the member count above is a dash rather
            than a zero. Reload the page.
          </Banner>
        ) : <Loading />
      ) : (
        <DataTable rows={members} columns={cols} rowKey={(m) => m.id}
          empty="No memberships recorded. This is the row that makes retention and revenue measurable." />
      )}
    </Section>
  );
}

/* ── payments ──────────────────────────────────────────────────────────────── */

function Payments({ payments, readErr, members, tenantId, me, onChange }: {
  payments: GymPayment[] | null; readErr: string | null; members: Membership[] | null;
  tenantId: string; me: Me; onChange: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [memberId, setMemberId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = parseFloat(amount);
    if (!isFinite(major)) return;
    setBusy(true); setWriteErr(null);
    try {
      await recordPayment(supabase, tenantId, {
        memberId: memberId || null,
        amountCents: Math.round(major * 100),
        method,
        recordedBy: me.id,
      });
      setAmount(''); onChange();
    } catch (e: any) {
      // recordPayment throws on a PostgREST error. With a try/finally and no
      // catch, a refused write looked exactly like a successful one whose list
      // had not refreshed yet — and this is money. An owner who believes a
      // payment is recorded and finds it missing will chase a member who has
      // already paid, or never chase one who has not. The amount stays in the
      // box on purpose: nothing was written, so the row is still owed.
      setWriteErr(`That payment was NOT recorded: ${e?.message ?? 'the write was refused'}. Nothing was saved — the money is not in the gym record and has to be entered again.`);
    } finally { setBusy(false); }
  };

  const cols: Column<GymPayment>[] = [
    { key: 'when', header: 'Taken', value: (p) => p.takenAt,
      render: (p) => new Date(p.takenAt).toLocaleString() },
    { key: 'member', header: 'Member', value: (p) => p.memberName },
    { key: 'amount', header: 'Amount', value: (p) => p.amountCents, numeric: true,
      render: (p) => money(p.amountCents, p.currency) },
    { key: 'method', header: 'Method', value: (p) => p.method.replace('_', ' ') },
    { key: 'note', header: 'Note', value: (p) => p.note },
  ];

  const options = [...new Map((members ?? [])
    .filter((m) => m.memberName)
    .map((m) => [m.memberId, m.memberName!])).entries()];

  return (
    <Section title="Payments taken" sub="Last 30 days. A payment appears here because somebody recorded it — never because it was inferred.">
      <form onSubmit={add} style={formRow}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal" style={{ ...field, flex: 1 }} />
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ ...field, flex: 2 }}>
          {/* When the member list did not read, this dropdown holds nobody —
              which looks like a gym with no members rather than a list that
              failed. Unattributed is permanent once written, so the label says
              why the names are missing before anyone accepts it. */}
          <option value="">{members === null ? 'Unattributed — the member list could not be read' : 'Unattributed'}</option>
          {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ ...field, flex: 1 }}>
          <option value="card">card</option>
          <option value="cash">cash</option>
          <option value="transfer">transfer</option>
          <option value="direct_debit">direct debit</option>
          <option value="other">other</option>
        </select>
        <button type="submit" disabled={busy} style={primaryBtn}>Record</button>
      </form>
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {payments === null ? (
        readErr ? (
          <Banner tone="crit">
            The payments could not be read: {readErr}. This is not a month in which the gym took
            nothing — it is a query that did not return, and the total above shows a dash for the
            same reason. Reload before deciding anyone is behind on payment.
          </Banner>
        ) : <Loading />
      ) : (
        <DataTable rows={payments} columns={cols} rowKey={(p) => p.id}
          empty="No payments recorded in the last 30 days." />
      )}
    </Section>
  );
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

/** Promise.allSettled hands the rejection back as `unknown`. Every fetch here
 *  rejects with an Error, so this is its message — and a named fallback rather
 *  than an empty banner, because a blank explanation of a failed read is only
 *  marginally better than no banner at all. */
function why(reason: unknown, fallback: string): string {
  return (reason as any)?.message ?? fallback;
}

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer',
  fontSize: 12.5, padding: 0, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

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
