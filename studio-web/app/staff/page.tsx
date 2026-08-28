'use client';

// Staff — who works here, what they delivered, what they are owed, and who is
// carrying the load.
//
// The console could already see a trainer three ways and never as a person on a
// payroll: the Overview lists a roster with a health dot, /sessions prices the
// one-to-ones, /timetable draws the rota. The ordinary Monday question — is
// anybody's book emptying, was anybody rostered for hours they did not deliver,
// and can I pay them — meant holding three screens in the head and joining them
// by name.
//
// All the reasoning lives in src/lib/staffView.ts, which has no Supabase import
// and is tested under plain node. What lives here is the reads — and the reads
// are the dangerous part, because supabase-js RESOLVES on a database error. A
// missing `.error` check on any query below would turn a broken roster into an
// empty one, and on this screen an empty roster reads as a gym with no staff
// problems at all.
//
// The rule this screen is built around: A TRAINER WITH NO DATA MUST NEVER READ
// AS FINE. A new hire, and a trainer whose twenty sessions nobody marked, both
// come back Unknown with a sentence saying which kind of nothing it is — never
// a green dot, and never buried under the healthy rows.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { money } from '@lib/gymRecord';
import { fetchSessions, PAY_DELIVERED_ONLY, type PayPolicy, type PayrollLine } from '@lib/gymSessions';
import { fetchShifts, fetchDemand, type DemandBlock } from '@lib/gymRota';
import { fetchClientActivity, DRIFT_LABEL, DEFAULT_WINDOWS, type Drift } from '@lib/clientDrift';
import { sliceLoading, sliceReady, sliceFailed, type Slice } from '@lib/memberView';
import {
  buildStaff, bandTitle, bandNote, STAFF_RANK, STAFF_STATUS_LABEL,
  type StaffRecord, type StaffView, type StaffMember, type StaffTrainer,
  type StaffClient, type ClientActivity,
} from '@lib/staffView';

const DAY = 86_400_000;
/** How far back the sessions, the rota and the timetable are read. */
const WINDOW_DAYS = 30;

const EMPTY: StaffRecord = {
  trainers: sliceLoading(),
  sessions: sliceLoading(),
  shifts: sliceLoading(),
  clients: sliceLoading(),
  activity: sliceLoading(),
  classes: sliceLoading(),
};

export default function Staff() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  const [feeRead, setFeeRead] = useState<'ok' | 'failed'>('ok');
  const [rec, setRec] = useState<StaffRecord>(EMPTY);
  const [sel, setSel] = useState<string | null>(null);

  // Whether a no-show is payable is a gym policy, not something this screen may
  // assume. Same control, same default, same wording as /sessions and /close —
  // three screens holding three opinions about the same money would be worse
  // than any of them being wrong.
  const [policy, setPolicy] = useState<PayPolicy>(PAY_DELIVERED_ONLY);

  const load = useCallback(async (tenantId: string) => {
    setRec(EMPTY);
    const now = Date.now();
    const fromIso = new Date(now - WINDOW_DAYS * DAY).toISOString();
    const toIso = new Date(now).toISOString();

    // Independent reads, deliberately not one Promise.all under a single catch.
    // A rota that 500s must not take the payroll down with it: this page is
    // allowed to be partial, but only if it names the part that failed and says
    // what the reader is therefore not seeing.
    const [trainers, sessions, shifts, clients, classes] = await Promise.all([
      slice(() => fetchTrainers(tenantId)),
      slice(() => fetchSessions(supabase, tenantId, fromIso)),
      slice(() => fetchShifts(supabase, tenantId, fromIso, toIso)),
      slice(() => fetchClients(tenantId)),
      slice(() => fetchClasses(tenantId, fromIso, toIso)),
    ]);

    // The training record can only be asked about clients we actually have. A
    // failed book means a failed activity read too — asking about nobody and
    // getting nothing back would otherwise report every client as silent, which
    // on this page reads as a trainer who has lost their whole book.
    const activity: Slice<ClientActivity> = clients.state !== 'ready'
      ? sliceFailed(
          clients.state === 'failed'
            ? `The client book could not be read, so no client could be looked up: ${clients.reason}`
            : 'The client book was not read.',
        )
      : await slice(() => fetchActivity(tenantId, clients.rows));

    setRec({ trainers, sessions, shifts, clients, activity, classes });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) {
        setRec({
          trainers: sliceReady([]), sessions: sliceReady([]), shifts: sliceReady([]),
          clients: sliceReady([]), activity: sliceReady([]), classes: sliceReady([]),
        });
        return;
      }
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name, session_fee').eq('id', who.tenantId).single();
      if (!live) return;
      // Checked, not assumed. supabase-js resolves on a database error, so a
      // null fee from a failed read would price every unrated session at nothing
      // and quietly shrink what the gym owes its staff.
      setGymName(tErr ? null : t?.name ?? null);
      setSessionFee(tErr ? null : t?.session_fee ?? null);
      setFeeRead(tErr ? 'failed' : 'ok');
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const view: StaffView = useMemo(() => buildStaff(rec, {
    policy,
    // The gym's fee is in major units; everything downstream is minor units.
    fallbackRateCents: sessionFee == null ? null : Math.round(sessionFee * 100),
    windowDays: WINDOW_DAYS,
  }), [rec, policy, sessionFee]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/staff">
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
      <Shell me={me} gymName={gymName} current="/staff">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          This page carries every colleague&rsquo;s pay and delivery record, so it
          is owner-only.
        </p>
      </Shell>
    );
  }

  const chosen = sel && view.members ? view.members.find((m) => m.trainerId === sel) ?? null : null;

  return (
    <Shell me={me} gymName={gymName} current="/staff">
      <h1>Staff</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Who works here, what they delivered in the last {WINDOW_DAYS} days, what
        they are owed and whether it can be settled, the hours they were
        rostered against the hours the record can confirm they were delivering,
        and who is drifting on their book.
      </p>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink2)', fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={policy.payNoShows}
            onChange={(e) => setPolicy((p) => ({ ...p, payNoShows: e.target.checked }))}
          />
          Pay no-shows
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink2)', fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={policy.payLateCancellations}
            onChange={(e) => setPolicy((p) => ({ ...p, payLateCancellations: e.target.checked }))}
          />
          Pay late cancellations
        </label>
      </div>

      {view.warning ? <Banner tone="crit">{view.warning}</Banner> : null}
      {feeRead === 'failed' ? (
        <Banner tone="crit">
          The gym&rsquo;s session fee could not be read, so any session without its
          own snapshotted rate is left unpriced rather than valued at nothing.
        </Banner>
      ) : null}
      {view.caveat ? <Banner tone="crit">{view.caveat}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="On the roster"
          text={view.rollup.trainers == null ? null : String(view.rollup.trainers)}
          note={stateNote(rec.trainers, 'the roster')}
        />
        <Kpi
          label="Cannot be assessed"
          text={view.rollup.unknown == null ? null : String(view.rollup.unknown)}
          // The headline figure of this page. Not "0 problems" — the number of
          // people the record has nothing to say about.
          note={
            view.rollup.unknown == null ? stateNote(rec.trainers, 'the roster')
              : view.rollup.unknown === 0 ? 'every trainer has evidence behind them'
              : 'no evidence either way — not a clean bill of health'
          }
        />
        <Kpi
          label="Needs attention"
          text={view.rollup.atRisk == null ? null : String(view.rollup.atRisk)}
          note={
            view.rollup.flaggedClients
              ? `${view.rollup.flaggedClients} client${view.rollup.flaggedClients === 1 ? '' : 's'} sit under a flagged trainer`
              : undefined
          }
        />
        <Kpi
          label={`Delivered · ${WINDOW_DAYS}d`}
          text={view.rollup.delivered == null ? null : String(view.rollup.delivered)}
          note={
            view.rollup.delivered == null ? stateNote(rec.sessions, 'the one-to-ones')
              : 'confirmed, not merely booked'
          }
        />
        <Kpi
          label="Unmarked"
          text={view.rollup.unmarked == null ? null : String(view.rollup.unmarked)}
          note={
            view.rollup.unmarked == null ? stateNote(rec.sessions, 'the one-to-ones')
              : view.rollup.unmarked > 0 ? 'nobody can be paid or judged over these'
              : 'every finished session has an outcome'
          }
        />
        <Kpi
          label="Payable now"
          text={money(view.rollup.outstandingCents)}
          note={
            rec.sessions.state !== 'ready' ? stateNote(rec.sessions, 'the one-to-ones')
              : view.rollup.outstandingCents == null
                ? 'nothing marked, priced and unsettled'
                : 'settle it under Sessions'
          }
        />
      </div>

      <Roster view={view} rec={rec} sel={sel} onPick={setSel} />

      {chosen ? (
        <Person m={chosen} rec={rec} onClose={() => setSel(null)} />
      ) : (
        <Section title="One person" sub="Pick somebody above to open their record.">
          <p style={{ padding: '26px 20px', margin: 0, color: 'var(--ink3)', fontSize: 13.5 }}>
            {rec.trainers.state === 'loading' ? 'Loading the roster…' : 'Nobody selected.'}
          </p>
        </Section>
      )}

      <OffRoster view={view} />
    </Shell>
  );
}

/* ── the roster ────────────────────────────────────────────────────────────── */

function Roster({ view, rec, sel, onPick }: {
  view: StaffView; rec: StaffRecord; sel: string | null; onPick: (id: string) => void;
}) {
  const cols: Column<StaffMember>[] = [
    {
      key: 'name', header: 'Trainer', value: (m) => m.name ?? '￿',
      render: (m) => (
        <button
          onClick={() => onPick(m.trainerId)}
          style={{ ...linkBtn, fontWeight: sel === m.trainerId ? 700 : 400 }}
        >
          {m.name ?? <span className="dash">unnamed account</span>}
        </button>
      ),
    },
    {
      // Sorted by the page's own rank, so Unknown sits directly under the
      // trainers who need attention rather than below the healthy ones.
      key: 'status', header: 'Status', value: (m) => STAFF_RANK[m.status],
      render: (m) => <StatusDot m={m} />,
    },
    {
      key: 'clients', header: 'Clients', value: (m) => m.clients, numeric: true,
      render: (m) => <Cell state={rec.clients.state} value={m.clients} empty="none on their book" />,
    },
    {
      key: 'delivered', header: 'Delivered', value: (m) => m.delivered, numeric: true,
      render: (m) => <Cell state={rec.sessions.state} value={m.delivered} empty="none" />,
    },
    {
      key: 'noShows', header: 'No-shows', value: (m) => m.noShows, numeric: true,
      render: (m) => <Cell state={rec.sessions.state} value={m.noShows} empty="none" />,
    },
    {
      key: 'unmarked', header: 'Unmarked', value: (m) => m.unmarked, numeric: true,
      render: (m) => {
        if (rec.sessions.state !== 'ready') return <Cell state={rec.sessions.state} value={null} empty="—" />;
        return m.unmarked
          ? <span style={{ color: 'var(--crit)' }}>{m.unmarked}</span>
          : <span className="dash">0</span>;
      },
    },
    {
      key: 'owed', header: 'Payable now', value: (m) => m.outstandingCents, numeric: true,
      render: (m) => {
        if (rec.sessions.state !== 'ready') return <span className="dash">not read</span>;
        if (m.outstandingCents == null) return <span className="dash">nothing to settle</span>;
        return (
          <span style={{ color: m.settleable ? 'var(--ink2)' : 'var(--warn)' }}>
            {money(m.outstandingCents)}
          </span>
        );
      },
    },
    {
      key: 'hours', header: 'Rostered / delivering', value: (m) => m.floorUse,
      render: (m) => {
        if (rec.shifts.state !== 'ready') return <span className="dash">rota not read</span>;
        if (m.rosteredHours == null) return <span className="dash">not rostered</span>;
        return (
          <span>
            {m.rosteredHours}h ·{' '}
            {m.deliveredHours == null
              ? <span className="dash">nothing confirmed</span>
              : `${m.deliveredHours}h delivering`}
          </span>
        );
      },
    },
    {
      key: 'drift', header: 'Book', value: (m) => m.drifting,
      render: (m) => {
        if (m.book == null) return <span className="dash">not judged</span>;
        if (!m.book.length) return <span className="dash">nobody on it</span>;
        const bits: React.ReactNode[] = [];
        if (m.drifting) bits.push(<span key="d" style={{ color: 'var(--crit)' }}>{m.drifting} drifting</span>);
        if (m.unknownClients) bits.push(<span key="u" style={{ color: 'var(--warn)' }}>{m.unknownClients} unknown</span>);
        if (!bits.length) return <span className="dash">holding</span>;
        return <>{bits.map((b, i) => <span key={i}>{i ? ', ' : ''}{b}</span>)}</>;
      },
    },
  ];

  return (
    <Section
      title="The roster"
      sub="Worst first, and Unknown directly beneath — a trainer the record cannot judge is never sorted in among the ones it can vouch for."
    >
      <Part slice={rec.trainers} what="the staff roster">
        {view.members ? (
          <DataTable
            rows={view.members} columns={cols} rowKey={(m) => m.trainerId}
            empty="No trainer is attached to this gym yet. Invite one from the Repple Studio app and this page fills in."
          />
        ) : null}
      </Part>
    </Section>
  );
}

function StatusDot({ m }: { m: StaffMember }) {
  const tone =
    m.status === 'at_risk' ? 'var(--crit)'
    : m.status === 'watch' ? 'var(--warn)'
    : m.status === 'on_track' ? 'var(--good)'
    // Unknown gets its own colour and its own word. A grey dot beside a green
    // one is the whole point: the reader must never mistake "we cannot say"
    // for "fine".
    : 'var(--ink3)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={m.reason}>
      <span style={{
        width: 7, height: 7, borderRadius: 0, background: m.unknown ? 'transparent' : tone,
        border: m.unknown ? `1.5px solid ${tone}` : undefined, flex: 'none',
      }} />
      <span style={{ color: m.unknown ? 'var(--ink3)' : 'var(--ink2)' }}>
        {STAFF_STATUS_LABEL[m.status]}
      </span>
    </span>
  );
}

/* ── one person ────────────────────────────────────────────────────────────── */

function Person({ m, rec, onClose }: { m: StaffMember; rec: StaffRecord; onClose: () => void }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)', display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <h2 style={{ flex: 1 }}>{m.name ?? <span className="dash">Unnamed account</span>}</h2>
        <StatusDot m={m} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink3)' }}>{m.trainerId}</span>
        <button onClick={onClose} style={linkBtn}>Close</button>
      </div>

      {/* The verdict, or the refusal, before a single figure — the same shape
          the close screen uses, and for the same reason. */}
      <p style={{
        margin: 0, padding: '13px 14px', borderBottom: '1px solid var(--ring)',
        borderLeft: `3px solid ${m.unknown ? 'var(--ink3)' : m.status === 'at_risk' ? 'var(--crit)' : m.status === 'watch' ? 'var(--warn)' : 'var(--brand)'}`,
        fontSize: 13.5, color: 'var(--ink2)',
      }}>
        <strong>{STAFF_STATUS_LABEL[m.status]}.</strong> {m.reason}
        {m.unknown ? ' This is a statement about the record, not about them.' : null}
      </p>

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', borderBottom: '1px solid var(--ring)',
        }}
      >
        <Kpi
          label="Clients"
          text={m.clients == null ? null : String(m.clients)}
          note={
            m.clients == null ? stateNote(rec.clients, 'the client book')
              : m.since ? `since ${new Date(m.since).toLocaleDateString()}`
              : 'no join date on file'
          }
        />
        <Kpi
          label="Delivered"
          text={m.delivered == null ? null : String(m.delivered)}
          note={
            m.delivered == null ? stateNote(rec.sessions, 'the one-to-ones')
              : `of ${m.sessions} booked · ${m.noShows} no-show${m.noShows === 1 ? '' : 's'}`
          }
        />
        <Kpi
          label="Unmarked"
          text={m.unmarked == null ? null : String(m.unmarked)}
          note={
            m.unmarked == null ? stateNote(rec.sessions, 'the one-to-ones')
              : m.unmarked > 0 ? 'finished, outcome never recorded'
              : m.upcoming ? `${m.upcoming} still to come`
              : 'nothing waiting'
          }
        />
        <Kpi
          label="Payable now"
          text={money(m.outstandingCents)}
          note={
            rec.sessions.state !== 'ready' ? stateNote(rec.sessions, 'the one-to-ones')
              : m.settleBlocker ?? `${m.outstandingSessions} session${m.outstandingSessions === 1 ? '' : 's'} ready to settle`
          }
        />
        <Kpi
          label={`Earned · ${WINDOW_DAYS}d`}
          text={money(m.owedCents)}
          note={
            rec.sessions.state !== 'ready' ? stateNote(rec.sessions, 'the one-to-ones')
              : m.owedCents == null ? 'no payable session carried a rate'
              : m.priced != null && m.payable != null && m.priced < m.payable
                ? `${m.payable - m.priced} payable session${m.payable - m.priced === 1 ? '' : 's'} carry no rate and are NOT in this`
                : `${m.payable} payable session${m.payable === 1 ? '' : 's'}, all priced`
          }
        />
        <Kpi
          label="Rostered hours"
          text={m.rosteredHours == null ? null : `${m.rosteredHours}h`}
          note={
            rec.shifts.state !== 'ready' ? stateNote(rec.shifts, 'the rota')
              : m.pulledShifts ? `${m.shifts} shift${m.shifts === 1 ? '' : 's'}, ${m.pulledShifts} pulled`
              : m.shifts ? `${m.shifts} shift${m.shifts === 1 ? '' : 's'}`
              : 'no shift on the rota in this window'
          }
        />
        <Kpi
          label="Confirmed delivering"
          text={m.deliveredHours == null ? null : `${m.deliveredHours}h`}
          note={
            m.floorUse == null ? undefined
              : `${Math.round(m.floorUse * 100)}% of the hours they were rostered`
          }
        />
        <Kpi
          label="Class hours"
          text={m.classHours == null ? null : `${m.classHours}h`}
          note={
            rec.classes.state !== 'ready' ? stateNote(rec.classes, 'the timetable')
              : 'on the timetable — scheduled, not confirmed'
          }
        />
      </div>

      {m.hoursNote ? (
        <p style={{ margin: 0, padding: '11px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
          {m.hoursNote}
        </p>
      ) : null}

      <Book m={m} rec={rec} />
    </section>
  );
}

/** Their book, ordered by who is breaking their own pattern. Drifting first and
 *  Unknown directly beneath, exactly as the coach's own dashboard shows it. */
function Book({ m, rec }: { m: StaffMember; rec: StaffRecord }) {
  const cols: Column<Drift>[] = [
    { key: 'who', header: 'Client', value: (d) => d.clientId,
      render: (d) => <span className="mono" style={{ fontSize: 11.5 }}>{d.clientId.slice(0, 8)}</span> },
    { key: 'band', header: 'Band', value: (d) => d.status,
      render: (d) => (
        <span style={{ color: d.status === 'at_risk' ? 'var(--crit)' : d.unknown ? 'var(--ink3)' : 'var(--ink2)' }}>
          {DRIFT_LABEL[d.status]}
        </span>
      ) },
    { key: 'rate', header: 'Days / week', value: (d) => d.recentPerWeek, numeric: true,
      render: (d) => d.recentPerWeek == null
        ? <span className="dash">not enough record</span>
        : <>{d.recentPerWeek}{d.baselinePerWeek == null ? '' : ` (was ${d.baselinePerWeek})`}</> },
    { key: 'quiet', header: 'Quiet for', value: (d) => d.quietDays, numeric: true,
      render: (d) => d.quietDays == null
        ? <span className="dash">nothing recorded</span>
        : `${d.quietDays}d` },
    { key: 'why', header: 'Reading', value: (d) => d.reason },
  ];

  return (
    <div>
      <div style={{ padding: '11px 14px' }}>
        <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>Their book</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
          Each client measured against their <em>own</em> earlier rate over the
          last {DEFAULT_WINDOWS.historyDays} days, not against a target. A client
          the record knows nothing about is {DRIFT_LABEL.idle.toLowerCase()} and
          sits second, never last.
        </p>
      </div>
      {rec.clients.state === 'loading' || rec.activity.state === 'loading' ? <Loading /> : null}
      {rec.clients.state === 'failed' ? (
        <Failed reason={rec.clients.reason} what="the client book"
                cost="how much this trainer is carrying is unknown rather than nil" />
      ) : null}
      {rec.clients.state === 'ready' && rec.activity.state === 'failed' ? (
        <Failed reason={rec.activity.reason} what="the training record"
                cost="a silent book and a steady one look identical without it, so no client is judged here" />
      ) : null}
      {m.book ? (
        <>
          {m.book.length ? (
            <p style={{ margin: 0, padding: '0 14px 10px', color: 'var(--ink3)', fontSize: 12.5 }}>
              {bandTitle('at_risk')}: {m.drifting} · {bandTitle('watch')}: {m.watchClients} ·{' '}
              {bandTitle('idle')}: {m.unknownClients} · {bandTitle('on_track')}: {m.steadyClients}.{' '}
              {bandNote(m.drifting ? 'at_risk' : m.unknownClients ? 'idle' : 'on_track')}
            </p>
          ) : null}
          <DataTable
            rows={m.book} columns={cols} rowKey={(d) => d.clientId}
            empty="Nobody is assigned to this trainer. Their delivery is real work; it is just not against a book."
          />
        </>
      ) : null}
    </div>
  );
}

/* ── money owed to somebody who is not on the roster ───────────────────────── */

function OffRoster({ view }: { view: StaffView }) {
  const rows = view.offRoster;
  if (!rows || !rows.length) return null;

  const cols: Column<PayrollLine>[] = [
    { key: 'who', header: 'Trainer', value: (l) => l.trainerName,
      render: (l) => l.trainerName ?? <span className="mono" style={{ fontSize: 11.5 }}>{l.trainerId}</span> },
    { key: 'delivered', header: 'Delivered', value: (l) => l.delivered, numeric: true },
    { key: 'unmarked', header: 'Unmarked', value: (l) => l.unmarked, numeric: true },
    { key: 'cents', header: 'Pay', value: (l) => l.cents, numeric: true,
      render: (l) => l.cents == null ? <span className="dash">no rate</span> : <>{money(l.cents)}</> },
  ];

  return (
    <Section
      title="Sessions run by somebody not on the roster"
      sub="Real work against a name this page cannot print — a trainer who has left, or a roster row that was never created. Surfaced rather than dropped, because it is money."
    >
      <DataTable rows={rows} columns={cols} rowKey={(l) => l.trainerId} empty="—" />
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/** Run one read into a slice, so a rejection becomes a stated failure rather
 *  than an empty roster. */
async function slice<T>(run: () => Promise<T[]>): Promise<Slice<T>> {
  try {
    return sliceReady(await run());
  } catch (e: any) {
    return sliceFailed(e?.message ?? 'The read failed.');
  }
}

/**
 * The gym's trainers, with the names and join dates that live on `profiles`.
 *
 * Not `fetchGymTrainers`: that one already counts clients and sessions with its
 * own queries, and this page reads both itself with outcomes and ids attached.
 * Calling it would run four more round trips to produce figures this page then
 * has to ignore, and would import a second, weaker definition of "delivered".
 *
 * `.error` is checked on both queries. Without it a failed roster read arrives
 * as `data: null`, falls through `?? []`, and this page reports a gym with no
 * staff — which looks exactly like a gym with no staff problems.
 */
async function fetchTrainers(tenantId: string): Promise<StaffTrainer[]> {
  const { data, error } = await supabase
    .from('trainers').select('id').eq('tenant_id', tenantId);
  if (error) throw error;

  const ids = (data ?? []).map((r: any) => r.id).filter(Boolean);
  if (!ids.length) return [];

  const meta = await profilesFor(ids);
  return ids.map((id: string) => ({
    trainerId: id,
    name: meta.get(id)?.name ?? null,
    since: meta.get(id)?.since ?? null,
  }));
}

/** Every client in the gym and whose book they are on. `trainer_id` null is a
 *  real answer — a member nobody coaches — and is counted as such. */
async function fetchClients(tenantId: string): Promise<StaffClient[]> {
  const { data, error } = await supabase
    .from('clients').select('id, trainer_id').eq('tenant_id', tenantId);
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  const meta = await profilesFor(rows.map((r: any) => r.id));
  return rows.map((r: any) => ({
    clientId: r.id,
    name: meta.get(r.id)?.name ?? null,
    trainerId: r.trainer_id ?? null,
    // The join date clamps the drift baseline to the period they were actually
    // on the book, so a client added on Tuesday is not reported as eight weeks
    // silent. Null where genuinely unknown, never guessed.
    since: meta.get(r.id)?.since ?? null,
  }));
}

/** Signs of life for every client on the gym's books, as slice rows. */
async function fetchActivity(tenantId: string, clients: StaffClient[]): Promise<ClientActivity[]> {
  const ids = clients.map((c) => c.clientId);
  if (!ids.length) return [];
  const events = await fetchClientActivity(supabase, ids, {
    days: DEFAULT_WINDOWS.historyDays,
    tenantId,
  });
  // A client with nothing gets an empty array, not a missing row — "read, and
  // there was nothing" has to stay distinguishable from "not asked about".
  return ids.map((id) => ({ clientId: id, events: events[id] ?? [] }));
}

/**
 * Classes on the timetable in the window, so a trainer who teaches is not shown
 * as an empty pair of rostered hours.
 *
 * `fetchDemand` returns one-to-ones too; they are dropped here because
 * `sessions` already holds them WITH their outcomes, and a scheduled PT block
 * counted as delivery is precisely the inference this whole page refuses.
 */
async function fetchClasses(tenantId: string, fromIso: string, toIso: string): Promise<DemandBlock[]> {
  const demand = await fetchDemand(supabase, tenantId, fromIso, toIso);
  return demand.filter((d) => d.kind === 'class');
}

/** Names and join dates from `profiles`, where they live. Throws on a failed
 *  read rather than returning an empty map — an unnamed staff list on a payroll
 *  screen is not a cosmetic problem. */
async function profilesFor(
  ids: (string | null | undefined)[],
): Promise<Map<string, { name: string | null; since: string | null }>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, { name: string | null; since: string | null }>();
  if (!unique.length) return out;
  const { data, error } = await supabase
    .from('profiles').select('id, full_name, created_at').in('id', unique);
  if (error) throw error;
  for (const p of data ?? []) {
    out.set((p as any).id, {
      name: ((p as any).full_name || '').trim() || null,
      since: (p as any).created_at ?? null,
    });
  }
  return out;
}

/* ── the three states, once ────────────────────────────────────────────────── */

/**
 * A section body that cannot lie about which of the three states it is in.
 * Same shape as the Members and Close screens: loading says loading, failed says
 * what broke and what is therefore unknown, ready hands over to the table.
 */
function Part<T>({ slice: s, what, children }: {
  slice: Slice<T>; what: string; children: React.ReactNode;
}) {
  return (
    <>
      {s.state === 'loading' ? <Loading /> : null}
      {s.state === 'failed' ? <Failed reason={s.reason} what={what} /> : null}
      {s.state === 'ready' ? children : null}
    </>
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
      {cost ? <> — {cost}</> : null}. Nobody is judged over it.
      <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{reason}</div>
    </div>
  );
}

/** A table cell that keeps "not read", "not loaded" and "nothing there" apart. */
function Cell({ state, value, empty }: {
  state: Slice<unknown>['state']; value: number | null; empty: string;
}) {
  if (state === 'loading') return <span className="dash">…</span>;
  if (state === 'failed') return <span className="dash">not read</span>;
  if (value == null) return <span className="dash">{empty}</span>;
  if (value === 0) return <span className="dash">{empty}</span>;
  return <>{value}</>;
}

/** The note under a KPI whose figure is missing — which of the three states it
 *  is missing for. */
function stateNote(s: Slice<unknown>, what: string): string | undefined {
  if (s.state === 'failed') return `${what} could not be read`;
  if (s.state === 'loading') return `reading ${what}…`;
  return undefined;
}

/* ── shared bits (same shapes as the Members and Close screens) ────────────── */

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)', textAlign: 'left' as const,
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
