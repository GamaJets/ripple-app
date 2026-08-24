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
import { fetchGymTrainers, payroll30For, type GymTrainer } from '@lib/gymTrainers';
import { gymRollup, trainerHealth, type GymRollup } from '@lib/ownerAnalytics';

interface Gym { id: string; name: string | null; sessionFee: number | null }

export default function Overview() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gym, setGym] = useState<Gym | null>(null);
  const [trainers, setTrainers] = useState<GymTrainer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          Repple Studio on the web is for gym owners. Your account is{' '}
          <strong>{me.role ?? 'without a role'}</strong>. If that is wrong, ask whoever runs the gym
          to change it.
        </p>
      </Shell>
    );
  }

  const roll: GymRollup | null = trainers ? gymRollup(trainers, gym?.sessionFee ?? null) : null;

  const cols: Column<GymTrainer>[] = [
    { key: 'name', header: 'Trainer', value: (t) => t.name },
    { key: 'clients', header: 'Clients', value: (t) => t.clients, numeric: true },
    { key: 'sessions30', header: 'Sessions 30d', value: (t) => t.sessions30, numeric: true },
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
          note={gym?.sessionFee == null ? 'no session fee set' : undefined}
        />
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

function Kpi({ label, value, note }: { label: string; value?: number | null; note?: string }) {
  const missing = value == null;
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
      <div className="micro">{label}</div>
      <div
        className="mono"
        style={{ fontSize: 25, marginTop: 5, color: missing ? 'var(--ink3)' : 'var(--ink)', letterSpacing: '-0.02em' }}
      >
        {missing ? '—' : value.toLocaleString()}
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setErr(error.message); setBusy(false); return; }
    location.reload();
  };

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
        <button type="submit" disabled={busy}
                style={{ ...field, background: 'var(--brand)', color: 'var(--brand-ink)',
                         fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
