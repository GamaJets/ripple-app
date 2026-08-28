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

  // "The gym has not set a session fee" and "we could not read the gym" both
  // leave sessionFee null, and they are not the same problem: one is a setting
  // the owner can go and fill in, the other is a read to retry. Without this
  // string the page tells everybody to go and set a fee.
  const [gymError, setGymError] = useState<string | null>(null);

  // Whether a no-show is payable is a gym policy, not a default we can assume.
  // It is a control on the page so the owner states it and can see what it does
  // to the number, rather than discovering it in a payslip.
  const [policy, setPolicy] = useState<PayPolicy>(PAY_DELIVERED_ONLY);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [settlementsError, setSettlementsError] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);

  /**
   * The two reads this screen stands on: what happened on the floor, and what
   * has already been handed over.
   *
   * Settled one at a time rather than under a single try/catch, and with no
   * `.catch(() => [])` anywhere near either of them, because one read failing
   * must never be reported as the other coming back empty. This is the rule the
   * import screen states, and payroll is where breaking it costs money: the
   * swallowed settlements failure put `[]` under "Already paid", which reads as
   * "no trainer has ever been paid for anything", and the reasonable response
   * to that is to pay them all again.
   */
  const load = useCallback(async (tenantId: string) => {
    const [rows, runs] = await Promise.allSettled([
      fetchSessions(supabase, tenantId, new Date(Date.now() - 30 * DAY).toISOString()),
      fetchSettlements(supabase, tenantId),
    ]);

    if (rows.status === 'fulfilled') {
      setSessions(rows.value);
      setErr(null);
    } else {
      // Null, not []. Every table below is about to be asked what happened in
      // this gym over the last month, and the honest answer is that we do not
      // know — which is not the same answer as "nothing did".
      setSessions(null);
      setErr((rows.reason as any)?.message ?? 'Could not read the session record.');
    }

    if (runs.status === 'fulfilled') {
      setSettlements(runs.value);
      setSettlementsError(null);
    } else {
      setSettlements(null);
      setSettlementsError((runs.reason as any)?.message ?? 'Could not read what has already been paid.');
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setSessions([]); return; }
      // supabase-js resolves on a database error rather than rejecting, so the
      // error has to be read off the result. Destructuring only `data` left a
      // refused or RLS-blocked read looking exactly like a gym with no fee set:
      // sessionFee null, every payroll figure a dash, and a blocker telling the
      // owner "set a session fee" — sending him to check a setting that is
      // probably already correct, for a read he was never told had failed.
      const { data: t, error } = await supabase
        .from('tenants').select('name, session_fee').eq('id', who.tenantId).single();
      if (live) {
        setGymName(error ? null : (t?.name ?? null));
        setSessionFee(error ? null : (t?.session_fee ?? null));
        setGymError(error ? (error.message || 'Could not read your gym.') : null);
      }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  // Each of these stays null while `sessions` is null, rather than collapsing to
  // an empty list. `sessions ?? []` was doing the same damage as the swallowed
  // catch one level up: it handed every table below a confident, empty answer
  // built out of a read that never returned.
  const awaiting = useMemo(() => sessions && sessions.filter((s) => isAwaitingOutcome(s)), [sessions]);
  const settled = useMemo(() => sessions && sessions.filter((s) => s.outcome !== null), [sessions]);

  const lines = useMemo(
    // The gym's session fee is in major units; payroll works in minor units.
    () => sessions && payrollByTrainer(sessions, policy, sessionFee == null ? null : Math.round(sessionFee * 100)),
    [sessions, policy, sessionFee],
  );
  // Totalling nothing gives zeros, which is fine here only because every place
  // that renders one of them checks `sessions` first and shows a dash instead.
  const total = useMemo(() => payrollTotal(lines ?? []), [lines]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/sessions">
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
      //
      // The `undefined` matters. markOutcome leaves rate_cents alone when it
      // gets undefined and writes null when it gets null — so when the gym read
      // failed, sessionFee is null for a reason that has nothing to do with the
      // gym's actual fee, and passing that null through would permanently stamp
      // "no rate" onto a session that has one. A read we could not make is not
      // a price of nothing; the only safe move is to leave the column untouched
      // and let a later marking, made with the fee in hand, set it.
      await markOutcome(supabase, s.id, outcome,
        s.rateCents ?? (gymError ? undefined : sessionFee == null ? null : Math.round(sessionFee * 100)));
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not record that outcome.');
    }
  };

  // clearOutcome throws on a PostgREST error, so `.then(refresh)` alone left a
  // refused undo as an unhandled rejection: the row stayed marked, the button
  // said nothing, and the owner pressed it again.
  const undo = async (id: string) => {
    try {
      await clearOutcome(supabase, id);
      refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not undo that outcome.');
    }
  };

  // Why the figure above cannot be settled, in words the owner can act on.
  //
  // Two things settlementBlocker cannot know, because it sees only the sessions.
  // With `sessions` null it would answer "No payable sessions in this period."
  // about a period nobody has managed to read. And when payable sessions have no
  // rate it says "set a session fee", which is the wrong errand if the fee is
  // missing because the gym row could not be read rather than because nobody set
  // one — so name the read failure instead, and leave the sessions unpriced
  // rather than free.
  const unread = sessions === null && err !== null;
  const blocker =
    sessions === null
      ? null
      : gymError && total.priced < total.payable
        ? `Your gym could not be read, so there is no session fee to price the rest with: ${gymError}`
        : settlementBlocker(total);

  // What each trainer is actually owed RIGHT NOW: marked, priced, payable and
  // not already settled. Derived from the sessions rather than from the payroll
  // line, because the line counts everything in the window while a settlement
  // must only ever cover what has not been paid.
  //
  // Null when the sessions could not be read: an empty "Outstanding" list says
  // every trainer is square, which is the single most expensive wrong sentence
  // on this page.
  const owed = useMemo(() => {
    if (sessions === null) return null;
    const byTrainer = new Map<string, { name: string | null; rows: PtSession[]; unmarked: number }>();
    for (const s of sessions) {
      const e = byTrainer.get(s.trainerId)
        ?? { name: s.trainerName, rows: [] as PtSession[], unmarked: 0 };
      if (isAwaitingOutcome(s)) e.unmarked += 1;
      byTrainer.set(s.trainerId, e);
    }
    for (const s of settleableSessions(sessions, policy)) {
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

  const settle = async (t: NonNullable<typeof owed>[number]) => {
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

      {gymError ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>Your gym could not be read</strong>, so this page
          does not know your session fee: {gymError}. Anything that needed the fee to price it is
          shown as unpriced rather than as nothing owed. This is not the same as your gym having no
          fee set, and setting one now would not fix it — reload the page.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 10px',
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
          // No note at all when the sessions are unknown: "ready to settle" on a
          // period nobody could read is the worst of the available sentences.
          note={sessions === null ? undefined : (blocker ?? 'ready to settle')}
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

      <Awaiting sessions={awaiting} unread={unread} onMark={mark} />
      <Payroll lines={lines} unread={unread} />
      <Settle owed={owed} unread={unread} settling={settling} onSettle={settle} />
      <Settled runs={settlements} error={settlementsError} />
      <Marked sessions={settled} unread={unread} onClear={undo} />
    </Shell>
  );
}

/* ── the queue that unblocks payroll ───────────────────────────────────────── */

function Awaiting({ sessions, unread, onMark }: {
  sessions: PtSession[] | null; unread: boolean;
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
      {sessions === null ? (
        // "Nothing waiting" is an all-clear, and this is the one table on the
        // console whose job is to withhold an all-clear until somebody has
        // actually marked every session.
        unread
          ? <Unread what="the session record could not be read, so nobody can say whether anything is waiting to be marked." />
          : <Loading />
      ) : (
        <DataTable
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing waiting — every finished session has an outcome."
        />
      )}
    </Section>
  );
}

/* ── per-trainer payroll ───────────────────────────────────────────────────── */

function Payroll({ lines, unread }: {
  lines: ReturnType<typeof payrollByTrainer> | null; unread: boolean;
}) {
  const cols: Column<NonNullable<typeof lines>[number]>[] = [
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
      {lines === null ? (
        // "No sessions in this period" is a claim about the gym's month. A read
        // that never returned has established nothing about the gym's month.
        unread
          ? <Unread what="the session record could not be read, so there is nothing here to price." />
          : <Loading />
      ) : (
        <DataTable rows={lines} columns={cols} rowKey={(l) => l.trainerId} empty="No sessions in this period." />
      )}
    </Section>
  );
}

/* ── settling: handing the money over, exactly once ────────────────────────── */

function Settle({ owed, unread, settling, onSettle }: {
  owed: { trainerId: string; name: string | null; rows: PtSession[]; unmarked: number; cents: number; blocker: string | null }[] | null;
  unread: boolean;
  settling: string | null;
  onSettle: (t: any) => void;
}) {
  return (
    <Section
      title="Outstanding"
      sub="What each trainer is owed for work not yet paid for. Settling stamps those exact sessions, so nothing here can be paid a second time."
    >
      {owed === null ? (
        // "Nothing outstanding" is the most expensive wrong sentence on this
        // page: it tells the owner every trainer is square, and he closes the
        // tab. It has to be earned by a read that actually came back.
        unread
          ? <Unread what="the session record could not be read, so what each trainer is owed is not known. Nothing here is settled or unsettled until it can be." />
          : <Loading />
      ) : owed.length === 0 ? (
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
              border: 'none', borderRadius: 0, padding: '8px 14px', fontSize: 13,
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

function Settled({ runs, error }: { runs: Settlement[] | null; error: string | null }) {
  // Not read yet: nothing to show and nothing to say, as before.
  //
  // Read and refused: say so here rather than anywhere else, because this is the
  // only section on the page whose subject is the settlements read. Silence
  // would be as bad as the old empty table — the owner would scroll past a
  // missing section and take it for a gym that has never run payroll.
  if (runs === null && error === null) return null;
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
      {runs === null ? (
        // The old code caught this failure and passed [], so the table said "No
        // payroll has been settled yet." — an affirmative claim that no trainer
        // has ever been paid, whose obvious remedy is to pay them all again.
        <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--ink3)' }}>
          Not shown: the record of what has already been paid could not be read — {error}. Treat
          nothing below as settled or unsettled, and do not pay anybody a second time on the
          strength of this page. Reload first.
        </p>
      ) : (
        <DataTable rows={runs} columns={cols} rowKey={(r) => r.id} empty="No payroll has been settled yet." />
      )}
    </Section>
  );
}

/* ── the marked history, so a mistake can be undone ────────────────────────── */

function Marked({ sessions, unread, onClear }: {
  sessions: PtSession[] | null; unread: boolean; onClear: (id: string) => void;
}) {
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
      {sessions === null ? (
        // "Nothing marked yet" would read as a month of work nobody has touched,
        // which is what the queue above is for — and the owner would go and mark
        // sessions that are already marked.
        unread
          ? <Unread what="the session record could not be read, so nothing can be listed here to undo." />
          : <Loading />
      ) : (
        <DataTable rows={sessions} columns={cols} rowKey={(s) => s.id} empty="Nothing marked yet." />
      )}
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

/**
 * What a section shows when the read behind it did not come back.
 *
 * Deliberately not the table's `empty` string. "There is nothing here" is a
 * statement about the gym, and a failed read has established nothing about the
 * gym — on a payroll screen that difference is an owner who reloads versus an
 * owner who pays a month of sessions twice. The reason itself is on the banner
 * at the top of the page, so it is not repeated four times down the column.
 */
function Unread({ what }: { what: string }) {
  return (
    <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--ink3)' }}>
      Not shown: {what} The banner above says why.
    </p>
  );
}
