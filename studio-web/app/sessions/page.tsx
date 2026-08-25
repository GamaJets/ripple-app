'use client';

// Sessions — what happened in the one-to-ones delivered on the gym's floor.
//
// This screen exists because payroll now refuses to price a session nobody has
// marked. That refusal is only defensible if there is somewhere to do the
// marking, and this is it: the sessions that have finished with no outcome
// recorded, at the top, with the three buttons that resolve them.
//
// Before this, "delivered" was inferred as "booked, and the clock has passed" —
// which counted no-shows and slots nobody cancelled, and then paid for them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchSessions, markOutcome, clearOutcome,
  isAwaitingOutcome, payrollByTrainer, payrollTotal, settlementBlocker,
  PAY_DELIVERED_ONLY,
  type PtSession, type SessionOutcome, type PayPolicy,
} from '@lib/gymSessions';
import { money } from '@lib/gymRecord';

const DAY = 86400000;

const OUTCOME_LABEL: Record<SessionOutcome, string> = {
  completed: 'Delivered',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  late_cancelled: 'Late cancel',
};

export default function Sessions() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  const [sessions, setSessions] = useState<PtSession[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Whether a no-show is payable is a gym policy, not a default we can assume.
  // It is a control on the page so the owner states it and can see what it does
  // to the number, rather than discovering it in a payslip.
  const [policy, setPolicy] = useState<PayPolicy>(PAY_DELIVERED_ONLY);

  const load = useCallback(async (tenantId: string) => {
    try {
      const rows = await fetchSessions(supabase, tenantId, new Date(Date.now() - 30 * DAY).toISOString());
      setSessions(rows); setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not read the session record.');
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setSessions([]); return; }
      const { data: t } = await supabase
        .from('tenants').select('name, session_fee').eq('id', who.tenantId).single();
      if (live) { setGymName(t?.name ?? null); setSessionFee(t?.session_fee ?? null); }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const awaiting = useMemo(() => (sessions ?? []).filter((s) => isAwaitingOutcome(s)), [sessions]);
  const settled = useMemo(() => (sessions ?? []).filter((s) => s.outcome !== null), [sessions]);

  const lines = useMemo(
    // The gym's session fee is in major units; payroll works in minor units.
    () => payrollByTrainer(sessions ?? [], policy, sessionFee == null ? null : Math.round(sessionFee * 100)),
    [sessions, policy, sessionFee],
  );
  const total = useMemo(() => payrollTotal(lines), [lines]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/sessions">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>Session records and payroll are owner-only.</p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId);

  const mark = async (s: PtSession, outcome: SessionOutcome) => {
    try {
      // Snapshot the rate at the moment of marking, so changing the gym's fee
      // next month cannot rewrite what this session cost.
      await markOutcome(supabase, s.id, outcome,
        s.rateCents ?? (sessionFee == null ? null : Math.round(sessionFee * 100)));
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not record that outcome.');
    }
  };

  const blocker = settlementBlocker(total);

  return (
    <Shell me={me} gymName={gymName} current="/sessions">
      <h1>Sessions</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        One-to-ones delivered on your floor in the last 30 days, and what they are worth.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 8, overflow: 'hidden', margin: '20px 0 10px',
        }}
      >
        <Kpi label="Delivered" text={sessions ? String(total.delivered) : null} />
        <Kpi
          label="Awaiting an outcome"
          text={sessions ? String(total.unmarked) : null}
          note={total.unmarked > 0 ? 'blocking payroll' : undefined}
        />
        <Kpi label="Payable" text={sessions ? String(total.payable) : null}
             note={policy.payNoShows ? 'no-shows included' : 'delivered only'} />
        <Kpi
          label="Payroll, 30 days"
          text={total.cents == null ? null : money(total.cents)}
          note={blocker ?? 'ready to settle'}
        />
      </div>

      {blocker ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>Not ready to settle.</strong> {blocker}{' '}
          {total.unmarked > 0
            ? 'Until then this figure prices only the sessions somebody has confirmed.'
            : null}
        </Banner>
      ) : null}

      <Section
        title="Pay policy"
        sub="A gym decision, not a default. It changes the payable count and the figure above."
      >
        <div style={{ padding: 14, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <Toggle
            label="Pay for no-shows"
            hint="The trainer held the hour and turned up."
            on={policy.payNoShows}
            onChange={(v) => setPolicy((p) => ({ ...p, payNoShows: v }))}
          />
          <Toggle
            label="Pay for late cancellations"
            hint="Cancelled too late to fill the slot."
            on={policy.payLateCancellations}
            onChange={(v) => setPolicy((p) => ({ ...p, payLateCancellations: v }))}
          />
        </div>
      </Section>

      <Awaiting sessions={awaiting} loading={sessions === null} onMark={mark} />
      <Payroll lines={lines} />
      <Marked sessions={settled} onClear={(id) => clearOutcome(supabase, id).then(refresh)} />
    </Shell>
  );
}

/* ── the queue that unblocks payroll ───────────────────────────────────────── */

function Awaiting({ sessions, loading, onMark }: {
  sessions: PtSession[]; loading: boolean;
  onMark: (s: PtSession, o: SessionOutcome) => void;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleString([], {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '',
      render: (s) => s.trainerName ?? <span className="dash">—</span> },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'mins', header: 'Mins', value: (s) => s.durationMin, numeric: true },
    { key: 'mark', header: 'What happened?', value: () => 0, align: 'right',
      render: (s) => (
        <span style={{ display: 'inline-flex', gap: 10, whiteSpace: 'nowrap' }}>
          <button style={linkBtn} onClick={() => onMark(s, 'completed')}>Delivered</button>
          <button style={linkBtn} onClick={() => onMark(s, 'no_show')}>No-show</button>
          <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => onMark(s, 'cancelled')}>Cancelled</button>
        </span>
      ) },
  ];
  return (
    <Section
      title="Awaiting an outcome"
      sub="Booked, finished, and nobody has said what happened. Payroll will not price these."
    >
      {loading ? <Loading /> : (
        <DataTable
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing waiting — every finished session has an outcome."
        />
      )}
    </Section>
  );
}

/* ── per-trainer payroll ───────────────────────────────────────────────────── */

function Payroll({ lines }: { lines: ReturnType<typeof payrollByTrainer> }) {
  const cols: Column<(typeof lines)[number]>[] = [
    { key: 'name', header: 'Trainer', value: (l) => l.trainerName ?? '',
      render: (l) => l.trainerName ?? <span className="dash">—</span> },
    { key: 'delivered', header: 'Delivered', value: (l) => l.delivered, numeric: true },
    { key: 'noshow', header: 'No-shows', value: (l) => l.noShows, numeric: true },
    { key: 'cancelled', header: 'Cancelled', value: (l) => l.cancelled, numeric: true },
    { key: 'unmarked', header: 'Unmarked', value: (l) => l.unmarked, numeric: true,
      render: (l) => l.unmarked === 0
        ? <span className="dash">—</span>
        : <span style={{ color: 'var(--warn)' }}>{l.unmarked}</span> },
    { key: 'pay', header: 'Pay', value: (l) => l.cents ?? -1, numeric: true,
      // Null is unpriced work, not free work.
      render: (l) => l.cents == null
        ? <span className="dash">not priced</span>
        : money(l.cents) },
  ];
  return (
    <Section title="Payroll by trainer" sub="Priced from confirmed sessions at the rate snapshotted when each was marked.">
      <DataTable rows={lines} columns={cols} rowKey={(l) => l.trainerId} empty="No sessions in this period." />
    </Section>
  );
}

/* ── the marked history, so a mistake can be undone ────────────────────────── */

function Marked({ sessions, onClear }: { sessions: PtSession[]; onClear: (id: string) => void }) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '' },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'outcome', header: 'Outcome', value: (s) => s.outcome ?? '',
      render: (s) => s.outcome ? OUTCOME_LABEL[s.outcome] : <span className="dash">—</span> },
    { key: 'rate', header: 'Rate', value: (s) => s.rateCents ?? -1, numeric: true,
      render: (s) => s.rateCents == null ? <span className="dash">—</span> : money(s.rateCents) },
    { key: 'undo', header: '', value: () => 0, align: 'right',
      render: (s) => <button style={linkBtn} onClick={() => onClear(s.id)}>Undo</button> },
  ];
  return (
    <Section title="Marked" sub="Undo returns a session to awaiting an outcome — it does not mark it cancelled.">
      <DataTable rows={sessions} columns={cols} rowKey={(s) => s.id} empty="Nothing marked yet." />
    </Section>
  );
}

/* ── shared bits (same shapes as the Money and Door screens) ───────────────── */

function Toggle({ label, hint, on, onChange }: {
  label: string; hint: string; on: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer', maxWidth: 300 }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ display: 'block', fontSize: 13.5, color: 'var(--ink)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>{hint}</span>
      </span>
    </label>
  );
}

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
} as const;

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
