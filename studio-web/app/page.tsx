'use client';

// Overview — the gym at a glance.
//
// Every figure here comes from `gymRollup`, the same function the phone app
// uses, reading the same rows through the same row-level policies. Nothing is
// computed twice and nothing is estimated: where the gym has not recorded
// something, this shows a dash and says what is missing.
import { useEffect, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { PasswordField } from '@/components/PasswordField';
import { fetchGymTrainers, payrollBlocker, type GymTrainer } from '@lib/gymTrainers';
import { gymRollup, trainerHealth, type GymRollup } from '@lib/ownerAnalytics';
import { fetchMemberships, fetchPayments, fetchPlans, summarise, money, type Membership } from '@lib/gymRecord';
import { fetchClasses, summariseAttendance, pct } from '@lib/gymSchedule';
import { fetchVisits, summariseVisits } from '@lib/gymVisits';

interface Gym { id: string; name: string | null; sessionFee: number | null }

export default function Overview() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gym, setGym] = useState<Gym | null>(null);
  const [trainers, setTrainers] = useState<GymTrainer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The rest of the business, so the departments can be seen against each
  // other rather than one screen at a time. Each is loaded independently and
  // allowed to fail on its own: a door log that will not read should not blank
  // out the revenue figure beside it.
  const [hub, setHub] = useState<{
    revenueCents: number | null;
    mrrCents: number | null;
    activeMembers: number | null;
    fillRate: number | null;
    visitsToday: number | null;
    inNow: number | null;
  } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setTrainers([]); return; }

      const { data: t } = await supabase
        .from('tenants').select('id, name, session_fee').eq('id', who.tenantId).single();
      if (!live) return;
      setGym(t ? { id: t.id, name: t.name ?? null, sessionFee: t.session_fee ?? null } : null);

      try {
        const rows = await fetchGymTrainers(supabase, who.tenantId);
        if (live) setTrainers(rows);
      } catch (e: any) {
        if (live) { setError(e?.message ?? 'Could not read the roster.'); setTrainers([]); }
      }

      // allSettled, not all: one failing read must not take the others with it.
      // A department that cannot be read shows a dash; the rest still report.
      const from30 = new Date(Date.now() - 30 * 86400_000).toISOString();
      const dayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();
      const [mRes, pRes, plRes, cRes, vRes] = await Promise.allSettled([
        fetchMemberships(supabase, who.tenantId),
        fetchPayments(supabase, who.tenantId),
        fetchPlans(supabase, who.tenantId),
        fetchClasses(supabase, who.tenantId, from30, new Date().toISOString()),
        fetchVisits(supabase, who.tenantId, { sinceIso: dayStart }),
      ]);
      if (!live) return;

      const memberships = mRes.status === 'fulfilled' ? mRes.value : null;
      const payments = pRes.status === 'fulfilled' ? pRes.value : null;
      const plans = plRes.status === 'fulfilled' ? plRes.value : null;
      const classes = cRes.status === 'fulfilled' ? cRes.value : null;
      const visits = vRes.status === 'fulfilled' ? vRes.value : null;

      const rec = (memberships && payments && plans) ? summarise(payments, memberships, plans) : null;
      const att = classes ? summariseAttendance(classes) : null;
      const door = visits ? summariseVisits(visits) : null;

      // Every figure is null rather than 0 when the read failed or the gym has
      // recorded nothing. summarise and summariseAttendance already refuse to
      // invent a denominator; this must not undo that on the way to the screen.
      setHub({
        revenueCents: rec?.takenCents ?? null,
        mrrCents: rec?.mrrCents ?? null,
        activeMembers: rec ? rec.activeMembers : null,
        fillRate: att?.fillRate ?? null,
        visitsToday: door ? door.visits : null,
        inNow: door ? door.inside : null,
      });
    })();
    return () => { live = false; };
  }, []);

  if (me === undefined) return <Splash>Loading…</Splash>;
  if (me === null) return <SignIn />;

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gym?.name ?? null} current="/">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', maxWidth: '60ch', marginTop: 10 }}>
          This screen is for gym owners. Your account is{' '}
          <strong>{me.role ?? 'without a role'}</strong>.
          {me.role === 'trainer' ? (
            <>
              {' '}The <a href="/door">Door</a> is yours though &mdash; checking people in and out is
              staff work, and it is in your menu.
            </>
          ) : (
            <> If that is wrong, ask whoever runs the gym to change it.</>
          )}
        </p>
      </Shell>
    );
  }

  const roll: GymRollup | null = trainers ? gymRollup(trainers, gym?.sessionFee ?? null) : null;

  const cols: Column<GymTrainer>[] = [
    { key: 'name', header: 'Trainer', value: (t) => t.name },
    { key: 'clients', header: 'Clients', value: (t) => t.clients, numeric: true },
    { key: 'delivered30', header: 'Delivered', value: (t) => t.delivered30, numeric: true },
    {
      key: 'unmarked30', header: 'Unmarked', value: (t) => t.unmarked30, numeric: true,
      render: (t) =>
        t.unmarked30 === 0
          ? <span className="dash">—</span>
          : <span style={{ color: 'var(--warn)' }}>{t.unmarked30}</span>,
    },
    {
      key: 'risk',
      header: 'Status',
      value: (t) => trainerHealth(t).risk,
      render: (t) => {
        const { risk } = trainerHealth(t);
        const tone =
          risk === 'ok' ? 'var(--good)' : risk === 'watch' ? 'var(--warn)'
          : risk === 'high' ? 'var(--crit)' : 'var(--ink3)';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: tone }} />
            <span style={{ color: 'var(--ink2)', textTransform: 'capitalize' }}>{risk}</span>
          </span>
        );
      },
    },
    {
      key: 'since',
      header: 'Since',
      value: (t) => t.since,
      render: (t) => (t.since ? new Date(t.since).toLocaleDateString() : <span className="dash">—</span>),
    },
  ];

  return (
    <Shell me={me} gymName={gym?.name ?? null} current="/">
      <h1>Overview</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        {gym?.name ? `${gym.name} · last 30 days` : 'Last 30 days'}
      </p>

      {!me.tenantId ? (
        <Notice>
          Your account is not linked to a gym yet, so there is nothing to show. Whoever set up the
          gym needs to add you as its owner.
        </Notice>
      ) : null}

      {error ? <Notice tone="crit">{error}</Notice> : null}


      {/* The morning glance — the whole operation on one line, so departments
          can be read against each other rather than one screen at a time.
          Anything not recorded shows a dash and says what is missing; none of
          these tiles is allowed to guess. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
          gap: 1,
          background: 'var(--ring)',
          border: '1px solid var(--ring)',
          borderRadius: 8,
          overflow: 'hidden',
          margin: '20px 0 10px',
        }}
      >
        <Kpi label="Taken · 30d" text={hub ? money(hub.revenueCents) : null}
             note={hub && hub.revenueCents == null ? 'no payments recorded' : undefined} />
        <Kpi label="Recurring / mo" text={hub ? money(hub.mrrCents) : null}
             note={hub && hub.mrrCents == null ? 'no priced plan on an active membership' : undefined} />
        <Kpi label="Active members" value={hub?.activeMembers ?? null} />
        <Kpi label="Class fill" text={hub ? pct(hub.fillRate) : null}
             note={hub && hub.fillRate == null ? 'no capacity recorded' : 'booked ÷ capacity'} />
        <Kpi label="In the building" value={hub?.inNow ?? null}
             note={hub?.visitsToday != null ? `${hub.visitsToday} through the door today` : undefined} />
        <Kpi label="Cash position" text={null} note="connect accounting" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
          gap: 1,
          background: 'var(--ring)',
          border: '1px solid var(--ring)',
          borderRadius: 8,
          overflow: 'hidden',
          margin: '20px 0 24px',
        }}
      >
        <Kpi label="Trainers" value={roll?.trainers} />
        <Kpi label="Clients" value={roll?.clients} />
        <Kpi label="Sessions 30d" value={roll?.sessions30} />
        <Kpi
          label="Session value 30d"
          value={roll?.payroll30 ?? null}
          // A dash with no explanation reads as a bug. Say which of the two
          // reasons it is: no fee set, or work still awaiting an outcome.
          note={trainers ? payrollBlocker(trainers, gym?.sessionFee ?? null) ?? undefined : undefined}
        />
        <Kpi label="Awaiting an outcome" value={roll?.unmarked30 ?? null}
             note={roll && roll.unmarked30 > 0 ? 'payroll cannot settle over these' : undefined} />
        <Kpi label="Trainers at risk" value={roll?.atRiskCount} />
      </div>

      <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
          <h2>Roster</h2>
        </div>
        {trainers === null ? (
          <div style={{ padding: '28px 20px', color: 'var(--ink3)' }}>Loading…</div>
        ) : (
          <DataTable
            rows={trainers}
            columns={cols}
            rowKey={(t) => t.id}
            empty="No trainers in this gym yet. Invite one from the Repple Studio app."
          />
        )}
      </section>
    </Shell>
  );
}

function Kpi({ label, value, text, note }: {
  label: string; value?: number | null; text?: string | null; note?: string;
}) {
  // `text` carries an already-formatted figure — money, a percentage. Null
  // means the same thing it means for `value`: not recorded, render a dash.
  const missing = text !== undefined ? text == null : value == null;
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
      <div className="micro">{label}</div>
      <div
        className="mono"
        style={{ fontSize: 25, marginTop: 5, color: missing ? 'var(--ink3)' : 'var(--ink)', letterSpacing: '-0.02em' }}
      >
        {missing ? '—' : (text ?? value!.toLocaleString())}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 3 }}>{note}</div> : null}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: 'crit' }) {
  return (
    <div
      style={{
        margin: '18px 0 0',
        padding: '13px 15px',
        borderRadius: 8,
        background: 'var(--surface)',
        border: '1px solid var(--ring)',
        borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
        color: 'var(--ink2)',
        maxWidth: '72ch',
      }}
    >
      {children}
    </div>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: 'var(--ink3)' }}>{children}</div>;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // The reset link lands on the website rather than in one app's URL scheme,
  // so the same mail works for someone on a phone, a desk, or neither.
  const forgot = async () => {
    const addr = email.trim();
    if (!addr) { setErr('Enter your email first, then tap Forgot password.'); return; }
    setErr(null); setSent(null);
    await supabase.auth.resetPasswordForEmail(addr, {
      redirectTo: 'https://www.repplefitness.com/reset-password',
    });
    // Same answer either way: telling a stranger which addresses have accounts
    // is a way of enumerating your members.
    setSent('If that address has an account, a reset link is on its way.');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setErr(error.message); setBusy(false); return; }
    location.reload();
  };

  const linkish = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
  } as const;

  const field = {
    width: '100%', padding: '10px 12px', borderRadius: 7, fontSize: 14,
    background: 'var(--surface2)', color: 'var(--ink)',
    border: '1px solid var(--ring)', fontFamily: 'var(--sans)',
  } as const;

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <form onSubmit={submit} style={{ width: 340, maxWidth: '100%' }}>
        <h1 style={{ marginBottom: 6 }}>Repple Studio</h1>
        <p style={{ color: 'var(--ink3)', fontSize: 13, marginTop: 0, marginBottom: 20 }}>
          The same account you use in the app.
        </p>
        <label className="micro" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} style={{ ...field, margin: '6px 0 14px' }} />
        <PasswordField label="Password" value={password} onChange={setPassword} required />
        {err ? <div style={{ color: 'var(--crit)', fontSize: 13, marginBottom: 12 }}>{err}</div> : null}
        {sent ? <div style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 12 }}>{sent}</div> : null}
        <button type="submit" disabled={busy}
                style={{ ...field, background: 'var(--brand)', color: 'var(--brand-ink)',
                         fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 14, fontSize: 13 }}>
          <button type="button" onClick={forgot} style={linkish}>Forgot password?</button>
          <a href="https://www.repplefitness.com/signup" style={{ color: 'var(--ink3)' }}>Create an account</a>
        </div>
      </form>
    </div>
  );
}
