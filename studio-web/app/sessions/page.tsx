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
  settleableSessions, settlementAmount, settleBlocker, recordSettlement, fetchSettlements,
  type Settlement,
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
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [settling, setSettling] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    try {
      const [rows, runs] = await Promise.all([
        fetchSessions(supabase, tenantId, new Date(Date.now() - 30 * DAY).toISOString()),
        fetchSettlements(supabase, tenantId).catch(() => [] as Settlement[]),
      ]);
      setSessions(rows); setSettlements(runs); setErr(null);
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

  // What each trainer is actually owed RIGHT NOW: marked, priced, payable and
  // not already settled. Derived from the sessions rather than from the payroll
  // line, because the line counts everything in the window while a settlement
  // must only ever cover what has not been paid.
  const owed = useMemo(() => {
    const byTrainer = new Map<string, { name: string | null; rows: PtSession[]; unmarked: number }>();
    for (const s of sessions ?? []) {
      const e = byTrainer.get(s.trainerId)
        ?? { name: s.trainerName, rows: [] as PtSession[], unmarked: 0 };
      if (isAwaitingOutcome(s)) e.unmarked += 1;
      byTrainer.set(s.trainerId, e);
    }
    for (const s of settleableSessions(sessions ?? [], policy)) {
      const e = byTrainer.get(s.trainerId);
      if (e) e.rows.push(s);
    }
    return [...byTrainer.entries()]
      .map(([trainerId, e]) => ({
        trainerId, name: e.name, rows: e.rows, unmarked: e.unmarked,
        cents: settlementAmount(e.rows),
        blocker: settleBlocker(e.rows, e.unmarked),
      }))
      .filter((x) => x.rows.length > 0 || x.unmarked > 0);
  }, [sessions, policy]);

  const settle = async (t: (typeof owed)[number]) => {
    if (!me?.tenantId || t.blocker) return;
    const dates = t.rows.map((s) => s.startsAt.slice(0, 10)).sort();
    setSettling(t.trainerId);
    try {
      await recordSettlement(supabase, me.tenantId, {
        trainerId: t.trainerId,
        periodFrom: dates[0],
        periodTo: dates[dates.length - 1],
        amountCents: t.cents,
        sessionIds: t.rows.map((s) => s.id),
      });
      await load(me.tenantId);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not record that settlement.');
    } finally { setSettling(null); }
  };

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
      <Settle owed={owed} settling={settling} onSettle={settle} />
      <Settled runs={settlements} />
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

/* ── settling: handing the money over, exactly once ────────────────────────── */

function Settle({ owed, settling, onSettle }: {
  owed: { trainerId: string; name: string | null; rows: PtSession[]; unmarked: number; cents: number; blocker: string | null }[];
  settling: string | null;
  onSettle: (t: any) => void;
}) {
  return (
    <Section
      title="Outstanding"
      sub="What each trainer is owed for work not yet paid for. Settling stamps those exact sessions, so nothing here can be paid a second time."
    >
      {owed.length === 0 ? (
        <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--ink3)' }}>
          Nothing outstanding. Every marked session in this window has been settled.
        </p>
      ) : owed.map((t) => (
        <div key={t.trainerId} style={{
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
          padding: '12px 14px', borderTop: '1px solid var(--ring)',
        }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{t.name ?? 'Trainer'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 2 }}>
              {t.blocker
                ? t.blocker
                : `${t.rows.length} session${t.rows.length === 1 ? '' : 's'} unpaid`}
            </div>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, minWidth: 100, textAlign: 'right' }}>
            {t.blocker ? <span className="dash">—</span> : money(t.cents)}
          </div>
          <button
            disabled={!!t.blocker || settling === t.trainerId}
            onClick={() => onSettle(t)}
            style={{
              background: t.blocker ? 'var(--surface2)' : 'var(--brand)',
              color: t.blocker ? 'var(--ink3)' : 'var(--brand-ink)',
              border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13,
              fontWeight: 600, cursor: t.blocker ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {settling === t.trainerId ? 'Recording…' : 'Mark as paid'}
          </button>
        </div>
      ))}
    </Section>
  );
}

/* ── what has already been paid ────────────────────────────────────────────── */

function Settled({ runs }: { runs: Settlement[] | null }) {
  if (runs === null) return null;
  const cols: Column<Settlement>[] = [
    { key: 'when', header: 'Paid', value: (r) => r.settledAt,
      render: (r) => new Date(r.settledAt).toLocaleDateString() },
    { key: 'period', header: 'Covering', value: (r) => r.periodFrom,
      render: (r) => `${r.periodFrom} → ${r.periodTo}` },
    { key: 'n', header: 'Sessions', value: (r) => r.sessionsCount, numeric: true },
    { key: 'amount', header: 'Amount', value: (r) => r.amountCents, numeric: true,
      // Snapshotted at the time, never recomputed — a later fee change must not
      // rewrite what was actually handed over.
      render: (r) => money(r.amountCents) },
  ];
  return (
    <Section title="Already paid" sub="Amounts as they were when the money went out, not as today's rates would price them.">
      <DataTable rows={runs} columns={cols} rowKey={(r) => r.id} empty="No payroll has been settled yet." />
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
