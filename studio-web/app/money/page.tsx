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
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [payments, setPayments] = useState<GymPayment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    try {
      const [p, m, pay] = await Promise.all([
        fetchPlans(supabase, tenantId),
        fetchMemberships(supabase, tenantId),
        fetchPayments(supabase, tenantId, new Date(Date.now() - 30 * DAY).toISOString()),
      ]);
      setPlans(p); setMembers(m); setPayments(pay); setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not read the gym record.');
      setPlans([]); setMembers([]); setPayments([]);
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setPlans([]); setMembers([]); setPayments([]); return; }
      const { data: t } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) setGymName(t?.name ?? null);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

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

  return (
    <Shell me={me} gymName={gymName} current="/money">
      <h1>Money</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What the gym sells, who holds a membership, and what has actually been paid.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 8, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi label="Taken (30 days)" text={money(sum?.takenCents)} note={sum?.takenCents == null ? 'nothing recorded yet' : `${sum.payments} payments`} />
        <Kpi label="Recurring / month" text={money(sum?.mrrCents)} note={sum?.mrrCents == null ? 'no priced membership' : undefined} />
        <Kpi label="Active members" text={sum ? String(sum.activeMembers) : null} />
        <Kpi label="Plans on sale" text={plans ? String(plans.filter((p) => p.active).length) : null} />
      </div>

      <Plans plans={plans} tenantId={tenantId} onChange={refresh} />
      <Members members={members} plans={plans} tenantId={tenantId} onChange={refresh} />
      <Payments payments={payments} members={members} tenantId={tenantId} me={me} onChange={refresh} />
    </Shell>
  );
}

/* ── plans ─────────────────────────────────────────────────────────────────── */

function Plans({ plans, tenantId, onChange }: {
  plans: MembershipPlan[] | null; tenantId: string; onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [interval, setInterval] = useState<PlanInterval>('month');
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = parseFloat(price);
    if (!name.trim() || !isFinite(major)) return;
    setBusy(true);
    try {
      await createPlan(supabase, tenantId, {
        name: name.trim(), priceCents: Math.round(major * 100), interval,
      });
      setName(''); setPrice(''); onChange();
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
        <button onClick={() => setPlanActive(supabase, p.id, !p.active).then(onChange)} style={linkBtn}>
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
      {plans === null ? <Loading /> : (
        <DataTable rows={plans} columns={cols} rowKey={(p) => p.id}
          empty="No plans yet. A gym cannot record a membership until it has something to sell." />
      )}
    </Section>
  );
}

/* ── memberships ───────────────────────────────────────────────────────────── */

function Members({ members, plans, tenantId, onChange }: {
  members: Membership[] | null; plans: MembershipPlan[] | null; tenantId: string; onChange: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId.trim()) return;
    setBusy(true); setAddErr(null);
    try {
      await createMembership(supabase, tenantId, {
        memberId: memberId.trim(),
        planId: planId || null,
        startedOn: new Date().toISOString().slice(0, 10),
      });
      setMemberId(''); onChange();
    } catch (e: any) {
      setAddErr(e?.message ?? 'Could not add that membership.');
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
        <select
          value={m.status}
          onChange={(e) => setMembershipStatus(supabase, m.id, e.target.value as any).then(onChange)}
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
          <option value="">No plan</option>
          {(plans ?? []).filter((p) => p.active).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="submit" disabled={busy} style={primaryBtn}>Add membership</button>
      </form>
      {addErr ? <Banner tone="crit">{addErr}</Banner> : null}
      {members === null ? <Loading /> : (
        <DataTable rows={members} columns={cols} rowKey={(m) => m.id}
          empty="No memberships recorded. This is the row that makes retention and revenue measurable." />
      )}
    </Section>
  );
}

/* ── payments ──────────────────────────────────────────────────────────────── */

function Payments({ payments, members, tenantId, me, onChange }: {
  payments: GymPayment[] | null; members: Membership[] | null;
  tenantId: string; me: Me; onChange: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [memberId, setMemberId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const major = parseFloat(amount);
    if (!isFinite(major)) return;
    setBusy(true);
    try {
      await recordPayment(supabase, tenantId, {
        memberId: memberId || null,
        amountCents: Math.round(major * 100),
        method,
        recordedBy: me.id,
      });
      setAmount(''); onChange();
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
          <option value="">Unattributed</option>
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
      {payments === null ? <Loading /> : (
        <DataTable rows={payments} columns={cols} rowKey={(p) => p.id}
          empty="No payments recorded in the last 30 days." />
      )}
    </Section>
  );
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 6,
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
    <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)', marginBottom: 22 }}>
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
      margin: '14px 0', padding: '11px 14px', borderRadius: 8, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
