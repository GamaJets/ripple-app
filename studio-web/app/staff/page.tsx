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
import { Banner as SharedBanner, Announce } from '@/components/Banner';
import { amount, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
// `money()` is reached through lib/currency's `amount()` here: every figure on
// this page is priced from the gym's session fee and has no currency of its own,
// so none of them may be written without `tenants.currency`.
import { fetchSessions, PAY_DELIVERED_ONLY, type PayPolicy, type PayrollLine } from '@lib/gymSessions';
import { payPolicyOf, PAY_POLICY_LABEL, NO_PAY_POLICY_NOTE, type PayPolicyCode } from '@lib/gymPolicy';
// The gym's own clock, as of supabase/parts/710. Every date and time on this
// page used to be the reader's — see the note beside `zone` below.
import { gymWallValue, instantAtGym, isZone, zoneGapNote, NO_ZONE_NOTE } from '@lib/gymZone';
import {
  STAFF_ROLES, ROLE_LABEL, STAFF_ROLE_NOTE, STAFF_ROLE_REACH, CONSOLE_LAG_NOTE,
  grantBlocker, revokeBlocker, revokeConsequence, grantStaffRole, revokeStaffRole,
  grantFromRow, isLiveGrant, grantNote,
  type ProfileRole, type StaffRole, type StaffGrant,
} from '@lib/staffRoles';
import {
  fetchShifts, fetchDemand, addShift, updateShift, setShiftStatus, deleteShift,
  shiftFromHours, shiftBlocker, rotaCost, summariseRota, shiftHours, isLive,
  weekStartOf, weekWindow, weekDays, shiftWeek,
  type DemandBlock, type Shift, type ShiftRole,
} from '@lib/gymRota';
import { money } from '@lib/gymRecord';
import { readAll } from '@lib/rowCap';
import { searchRows, searchNote } from '@lib/consoleSearch';
import { wrote, refused, sayText, sayTone, type Said } from '@lib/consoleSay';
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
  // `tenants.currency`. Every figure on this page is priced from the gym's own
  // session fee and carries no currency of its own, so a null here means the
  // amounts are unprintable rather than printable in a guessed money.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  const [feeRead, setFeeRead] = useState<'ok' | 'failed'>('ok');
  /**
   * `tenants.timezone`. Null means the gym has not said where it is, and on this
   * page that is a statement with consequences rather than a blank field.
   *
   * Every time on this screen is a shift — a person being asked to be in a
   * building at an hour. They were all rendered with `toLocaleString` and no
   * zone, which is the zone of whoever opened the console: a Dubai gym's 06:00
   * cover read as 03:00 to a bookkeeper in London, and the edit form beside it
   * would have SAVED that 03:00 back. The read was wrong by three hours and the
   * write moved somebody's shift.
   *
   * With a zone the times are the gym's. Without one they are still the
   * reader's, and the page says so out loud instead of printing them as though
   * they were the gym's — which is the whole of item J1 in one paragraph.
   */
  const [zone, setZone] = useState<string | null>(null);
  const [rec, setRec] = useState<StaffRecord>(EMPTY);
  const [sel, setSel] = useState<string | null>(null);
  // No console page had a search input. A gym with thirty coaches reads this
  // table by scrolling.
  const [q, setQ] = useState('');

  /**
   * Whether a no-show is payable is a gym policy, and this screen now READS it
   * rather than offering its own switch.
   *
   * The comment that stood here said "same control, same default, same wording
   * as /sessions and /close — three screens holding three opinions about the
   * same money would be worse than any of them being wrong". Three identical
   * controls over three separate `useState`s is exactly three opinions: nothing
   * saved, nothing shared, and each screen back to the conservative reading on
   * every reload. The answer is stored on `tenants` now and set in one place.
   */
  const [policyCode, setPolicyCode] = useState<string | null>(null);

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
        .from('tenants').select('name, session_fee, currency, session_pay_policy, timezone').eq('id', who.tenantId).single();
      if (!live) return;
      // Checked, not assumed. supabase-js resolves on a database error, so a
      // null fee from a failed read would price every unrated session at nothing
      // and quietly shrink what the gym owes its staff.
      setGymName(tErr ? null : t?.name ?? null);
      setSessionFee(tErr ? null : t?.session_fee ?? null);
      setPolicyCode(tErr ? null : (((t as any)?.session_pay_policy ?? null) as string | null));
      setCcy(tErr ? null : ((((t as any)?.currency ?? '') as string).trim().toUpperCase() || null));
      // Checked against this runtime's own zone database, not merely trimmed. A
      // stored string nothing can resolve would otherwise make every helper
      // below return null while this page believed it had the gym's clock, and
      // the times would silently be the reader's again with a zone name sitting
      // beside them.
      {
        const tz = (((t as any)?.timezone ?? '') as string).trim();
        setZone(tErr || !tz || !isZone(tz) ? null : tz);
      }
      setFeeRead(tErr ? 'failed' : 'ok');
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  // The gym's stated policy, and the floor to use where it has not stated one.
  // Delivered-only cannot overpay anybody, so it is safe as a fallback — but it
  // is labelled as the floor rather than printed as the gym's answer.
  const stated = payPolicyOf(policyCode);
  const policy: PayPolicy = stated ?? PAY_DELIVERED_ONLY;

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

      {/* The gym's answer, read rather than offered. Two checkboxes stood here
          and saved nothing: an owner ticked "Pay no-shows", read a bigger number
          on this screen, and settled the month on /close against a smaller one. */}
      <div style={{ margin: '16px 0 4px', color: 'var(--ink2)', fontSize: 12.5, maxWidth: '72ch' }}>
        {feeRead === 'failed' ? (
          <>Pay policy unknown — the gym&rsquo;s record could not be read, so the figures below price
          delivered sessions only.</>
        ) : stated ? (
          <>Pays for: <strong style={{ color: 'var(--ink)' }}>{PAY_POLICY_LABEL[policyCode as PayPolicyCode].toLowerCase()}</strong>.{' '}
          <a href="/settings" style={{ color: 'var(--brand)' }}>Change it on Gym</a>.</>
        ) : (
          <>Pay policy not set — {NO_PAY_POLICY_NOTE}, so everything below counts delivered sessions
          only. That is the floor, not the gym&rsquo;s answer:{' '}
          <a href="/settings" style={{ color: 'var(--brand)' }}>say what it pays for on Gym</a>.</>
        )}
      </div>

      {view.warning ? <Banner tone="crit">{view.warning}</Banner> : null}
      {feeRead === 'failed' ? (
        <Banner tone="crit">
          The gym&rsquo;s session fee could not be read, so any session without its
          own snapshotted rate is left unpriced rather than valued at nothing.
        </Banner>
      ) : null}
      {/* Beside the fee banner because it is the same shape of gap: a number
          this page cannot state. A figure with no currency is not a figure —
          "6,300.00" beside a trainer's name is read in whatever money the
          reader happens to be thinking in. */}
      {feeRead === 'ok' && !ccy ? (
        <Banner tone="crit">
          This gym has not set its currency, so no amount on this page can be
          written down. Set it on the gym record and every figure below fills in.
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
          text={amount(view.rollup.outstandingCents, ccy)}
          note={
            rec.sessions.state !== 'ready' ? stateNote(rec.sessions, 'the one-to-ones')
              : view.rollup.outstandingCents == null
                ? 'nothing marked, priced and unsettled'
                : !ccy ? NO_CURRENCY_NOTE
                : 'settle it under Sessions'
          }
        />
      </div>

      <Roster view={view} rec={rec} sel={sel} onPick={setSel} ccy={ccy} query={q} onQuery={setQ} />

      {chosen ? (
        <Person m={chosen} rec={rec} onClose={() => setSel(null)} ccy={ccy} zone={zone} />
      ) : (
        <Section title="One person" sub="Pick somebody above to open their record.">
          <p style={{ padding: '26px 20px', margin: 0, color: 'var(--ink3)', fontSize: 13.5 }}>
            {rec.trainers.state === 'loading' ? 'Loading the roster…' : 'Nobody selected.'}
          </p>
        </Section>
      )}

      <Roles
        tenantId={me.tenantId!} actorId={me.id} clients={rec.clients} zone={zone}
        onChanged={() => load(me.tenantId!)}
      />

      <Rota tenantId={me.tenantId!} trainers={rec.trainers} ccy={ccy} zone={zone} />

      <OffRoster view={view} ccy={ccy} />
    </Shell>
  );
}

/* ── the roster ────────────────────────────────────────────────────────────── */

function Roster({ view, rec, sel, onPick, ccy, query, onQuery }: {
  view: StaffView; rec: StaffRecord; sel: string | null; onPick: (id: string) => void;
  ccy: TenantCurrency; query: string; onQuery: (q: string) => void;
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
        if (!ccy) return <span className="dash">{NO_CURRENCY_NOTE}</span>;
        return (
          <span style={{ color: m.settleable ? 'var(--ink2)' : 'var(--warn)' }}>
            {amount(m.outstandingCents, ccy)}
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

  // Filtered, never re-ordered. The band order on this table is the whole
  // instrument — "a trainer with no data must never read as fine" — and a
  // search that re-sorted would bury the row the page exists to raise.
  const shown = searchRows(view.members ?? [], query, (m) => [m.name, m.trainerId]);
  const note = searchNote(query, shown.length, view.members?.length ?? 0);

  return (
    <Section
      title="The roster"
      sub="Worst first, and Unknown directly beneath — a trainer the record cannot judge is never sorted in among the ones it can vouch for."
    >
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '12px 14px 0', flexWrap: 'wrap' }}>
        <input
          value={query} onChange={(e) => onQuery(e.target.value)}
          placeholder="Search a coach" aria-label="Search the roster"
          style={{ ...field, flex: 1, minWidth: 200 }}
        />
        {query ? <button onClick={() => onQuery('')} style={linkBtn}>clear</button> : null}
      </div>
      {/* Above the table. An empty filtered roster on THIS page reads as a gym
          with no staff problems at all, which is the sentence the whole screen
          is written against. */}
      {note ? <p style={{ margin: 0, padding: '8px 14px 0', fontSize: 12.5, color: 'var(--ink3)' }}>{note}</p> : null}
      <Part slice={rec.trainers} what="the staff roster">
        {view.members ? (
          <DataTable
            rows={shown} columns={cols} rowKey={(m) => m.trainerId}
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

function Person({ m, rec, onClose, ccy, zone }: {
  m: StaffMember; rec: StaffRecord; onClose: () => void; ccy: TenantCurrency;
  /** The gym's own zone, or null. Only one figure here is a calendar date, and
   *  it is the one below. */
  zone: string | null;
}) {
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
              // The gym's own calendar where it has one. A coach who joined at
              // 23:40 on the 31st joined in a different MONTH depending on
              // where the page is read, which is the sort of one-day
              // disagreement that only ever shows up in an argument about a
              // month's pay.
              : m.since ? `since ${new Date(m.since).toLocaleDateString(undefined, { timeZone: zone ?? undefined })}`
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
          text={amount(m.outstandingCents, ccy)}
          note={
            rec.sessions.state !== 'ready' ? stateNote(rec.sessions, 'the one-to-ones')
              : m.settleBlocker
                ?? (m.outstandingCents != null && !ccy ? NO_CURRENCY_NOTE : null)
                ?? `${m.outstandingSessions} session${m.outstandingSessions === 1 ? '' : 's'} ready to settle`
          }
        />
        <Kpi
          label={`Earned · ${WINDOW_DAYS}d`}
          text={amount(m.owedCents, ccy)}
          note={
            rec.sessions.state !== 'ready' ? stateNote(rec.sessions, 'the one-to-ones')
              : m.owedCents == null ? 'no payable session carried a rate'
              : !ccy ? NO_CURRENCY_NOTE
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

/* ── who works here, and who put them there ────────────────────────────────── */

/** One person in this gym, as `profiles` holds them. */
interface Person {
  id: string;
  name: string | null;
  role: ProfileRole | null;
  since: string | null;
}

/**
 * The staff roster: adding somebody, taking somebody off, and the record of who
 * made each of those decisions.
 *
 * ── Why there was no such control anywhere ────────────────────────────────
 *
 * The section below this one — money owed to somebody not on the roster — says
 * it, and said it before this existed: "a roster row is created when the coach
 * accepts the gym's join code, not from here: the owner cannot insert one, and
 * a button that the database would refuse is worse than this sentence." That
 * was true. `trainers` has no owner INSERT policy, `profiles` has no owner
 * UPDATE policy, and `guard_profile_identity` (part 38) refuses a person
 * changing their own role with the words "Ask the gym owner to change it for
 * you" — addressed to an owner who had no way to.
 *
 * There was also no way OFF. Not a soft one. A coach who left kept their role,
 * their gym and every client on their book, and that book is what carries the
 * read of those members' workouts, measurements, scans and private messages.
 *
 * supabase/parts/711 adds the two functions this calls. Both run as the
 * database, both check that the caller owns this gym, and both write a
 * `staff_grants` row in the same transaction as the access change — because
 * putting somebody on a gym's staff hands them every member's next-of-kin
 * details and operational medical note, and a grant of that has a name and a
 * date against it or it does not happen.
 *
 * ── Two things this screen refuses to do ──────────────────────────────────
 *
 *   · It does not search for accounts outside this gym, because the console
 *     cannot: `profiles_owner_tenant_r` shows an owner the profiles in their
 *     own tenant and nothing else, which is the correct rule and is why the
 *     second field takes an account id rather than a name. A search box that
 *     silently found nobody would read as "that person has no account".
 *   · It does not reproduce the database's refusals as its own verdicts. Every
 *     blocker below is ALSO enforced by the function, which raises; these exist
 *     so the sentence arrives beside the control rather than after a round
 *     trip, which is part 166's arrangement for the currency.
 */
function Roles({ tenantId, actorId, clients, zone, onChanged }: {
  tenantId: string;
  /** The signed-in owner. Needed because two of the refusals are about them. */
  actorId: string;
  /** The gym's client book, so a coach's outstanding clients can be counted
   *  before offering to remove them. A failed read is `null` and blocks. */
  clients: Slice<StaffClient>;
  zone: string | null;
  onChanged: () => void;
}) {
  // Null, never [], for the reason every read on this page is: an empty staff
  // list under a failed read says this gym employs nobody.
  const [people, setPeople] = useState<Person[] | null>(null);
  const [grants, setGrants] = useState<StaffGrant[] | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<Said>(null);
  const [busy, setBusy] = useState(false);

  // The add form. `who` is either an id picked from the members below or one
  // pasted in; the field is the same either way so there is one code path.
  const [who, setWho] = useState('');
  const [role, setRole] = useState<StaffRole | ''>('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [ps, gs] = await Promise.all([fetchPeople(tenantId), fetchGrants(tenantId)]);
      setPeople(ps); setGrants(gs); setReadErr(null);
    } catch (e: any) {
      setPeople(null); setGrants(null);
      setReadErr(e?.message ?? 'The staff list could not be read.');
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const staff = people?.filter((p) => p.role === 'owner' || p.role === 'trainer' || p.role === 'receptionist') ?? null;
  const members = people?.filter((p) => p.role === 'client') ?? null;
  const chosen = people?.find((p) => p.id === who.trim()) ?? null;

  /** How many clients are pointed at a coach right now. Null when the book was
   *  not read — which is unknown, not zero, and blocks the removal. */
  const bookOf = (id: string): number | null =>
    clients.state !== 'ready' ? null : clients.rows.filter((c) => c.trainerId === id).length;

  /** The live grant for a person, or null because there is not one — which for
   *  everybody on a roster today is the ordinary answer. */
  const liveGrant = (id: string): StaffGrant | null =>
    grants?.find((g) => g.subjectId === id && isLiveGrant(g)) ?? null;

  const nameOf = (id: string | null): string | null =>
    (id && people?.find((p) => p.id === id)?.name) || null;

  const addBlocker = grantBlocker({
    subjectId: who,
    // `null` when the id was typed rather than picked. That is a real state and
    // is NOT "could not be read": the account may exist and simply not be in
    // this gym, which is exactly the case the id field is for.
    subjectRole: chosen?.role ?? null,
    subjectTenantId: chosen ? tenantId : null,
    actorId, tenantId, role,
  });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    // `!role` is here for the narrowing below; grantBlocker already returns a
    // sentence for it, so the fallback is only ever reached if that changes.
    if (addBlocker || !role) { setMsg(refused(addBlocker, 'Say what they are being taken on as.')); return; }
    setBusy(true); setMsg(null);
    try {
      const out = await grantStaffRole(supabase, who.trim(), role, note.trim() || null);
      setMsg(wrote(
        `On the staff as ${ROLE_LABEL[out.role].toLowerCase()}.`
        + (out.rosterRow ? ' A roster row was created, so they appear in the rota and in payroll.' : '')
        + ' Recorded against your name.',
      ));
      setWho(''); setRole(''); setNote('');
      await load();
      onChanged();
    } catch (x: any) {
      setMsg(refused(x?.message, 'That grant was refused, so nothing changed.'));
    } finally { setBusy(false); }
  };

  const remove = async (p: Person) => {
    const stop = revokeBlocker({
      subjectId: p.id, subjectRole: p.role, actorId, clientsOnBook: bookOf(p.id),
    });
    if (stop) { setMsg(refused(stop)); return; }
    if (!confirm(`Take ${p.name ?? 'this person'} off the staff?\n\n${revokeConsequence(p.role)}`)) return;
    setBusy(true); setMsg(null);
    try {
      await revokeStaffRole(supabase, p.id, null);
      setMsg(wrote('Off the staff, and the record says when and by whom.'));
      await load();
      onChanged();
    } catch (x: any) {
      setMsg(refused(x?.message, 'That removal was refused, so nothing changed.'));
    } finally { setBusy(false); }
  };

  const cols: Column<Person>[] = [
    { key: 'name', header: 'Who', value: (p) => p.name ?? '￿',
      render: (p) => p.name ?? <span className="dash">unnamed account</span> },
    { key: 'role', header: 'Role', value: (p) => p.role ?? '',
      render: (p) => p.role
        ? <span style={{ color: p.role === 'owner' ? 'var(--brand)' : 'var(--ink2)' }}>{ROLE_LABEL[p.role]}</span>
        : <span className="dash">no role on file</span> },
    { key: 'book', header: 'On their book', value: (p) => bookOf(p.id) ?? -1, numeric: true,
      render: (p) => {
        if (p.role !== 'trainer') return <span className="dash">—</span>;
        const n = bookOf(p.id);
        // Unknown, not none. A dash here that meant "we could not count" and a
        // dash that meant "nobody" would put a Remove button over the first.
        if (n == null) return <span className="dash">book not read</span>;
        return n ? <>{n}</> : <span className="dash">nobody</span>;
      } },
    { key: 'grant', header: 'How they got here', value: (p) => liveGrant(p.id)?.grantedAt ?? '',
      render: (p) => {
        const g = liveGrant(p.id);
        return (
          <span style={{ color: 'var(--ink3)', fontSize: 12.5 }}>
            {grantNote(g, nameOf(g?.actorId ?? null))}
            {g ? (
              <>
                {' '}
                {/* The gym's own calendar, where it has one. A grant made at
                    23:50 is dated a day apart for two colleagues otherwise, and
                    this is the column somebody reads in an argument. */}
                <span className="mono">
                  {new Date(g.grantedAt).toLocaleDateString(undefined, { timeZone: zone ?? undefined })}
                </span>
              </>
            ) : null}
          </span>
        );
      } },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (p) => {
        const stop = revokeBlocker({ subjectId: p.id, subjectRole: p.role, actorId, clientsOnBook: bookOf(p.id) });
        // The owner's own row gets no control at all rather than a disabled
        // one: there is no circumstance in which it becomes pressable, and a
        // greyed button invites somebody to work out how to un-grey it.
        if (p.id === actorId || p.role === 'owner') return <span className="dash">—</span>;
        return (
          <button
            style={{ ...linkBtn, color: stop ? 'var(--ink3)' : 'var(--crit)' }}
            disabled={busy}
            // Deliberately still pressable when there is a blocker: pressing it
            // is how the owner READS the blocker, and the most important one —
            // a coach whose removal would leave their access to somebody's
            // health record behind — is a sentence nobody would guess at.
            onClick={() => remove(p)}
            title={stop ?? undefined}
          >
            Remove
          </button>
        );
      } },
  ];

  return (
    <Section
      title="Who works here"
      sub="Adding somebody to this gym hands them every member’s emergency contact and the gym’s medical note about them. That is why it is written down, and why taking somebody off refuses to do it by halves."
    >
      {readErr ? (
        <div style={{ padding: '16px 14px', margin: 14, border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)', background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13 }}>
          The staff list could not be read, so this section is <strong>unknown</strong>, not empty —
          this gym is not employing nobody. Nothing can be granted or removed until it comes back.
          <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{readErr}</div>
        </div>
      ) : null}

      {staff === null ? (
        readErr ? null : <Loading />
      ) : (
        <DataTable
          rows={staff} columns={cols} rowKey={(p) => p.id}
          empty="Nobody, which cannot be right — you are signed in as this gym’s owner. Reload; an empty staff list here is far more likely to be a refused read than a gym with no staff."
        />
      )}

      {/* The reach table. It sits above the form on purpose: the choice between
          the two roles is the whole decision, and it is not a choice anybody can
          make from two words in a dropdown. */}
      <div style={{ padding: '14px 14px 4px', borderTop: '1px solid var(--ring)' }}>
        <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>What each of them can reach</h3>
        <p style={{ margin: '4px 0 10px', color: 'var(--ink3)', fontSize: 12 }}>{CONSOLE_LAG_NOTE}</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
            <thead>
              <tr>
                {['', ROLE_LABEL.owner, ROLE_LABEL.trainer, ROLE_LABEL.receptionist].map((h, i) => (
                  <th key={i} className="micro" style={{ textAlign: 'left', padding: '5px 12px 5px 0', color: 'var(--ink3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STAFF_ROLE_REACH.map((r) => (
                <tr key={r.what} style={{ borderTop: '1px solid var(--ring)' }}>
                  <td style={{ padding: '7px 12px 7px 0', color: 'var(--ink2)' }}>
                    {r.what}
                    {r.note ? <div style={{ color: 'var(--ink3)', fontSize: 11.5, maxWidth: '58ch' }}>{r.note}</div> : null}
                  </td>
                  <td style={{ padding: '7px 12px 7px 0', color: 'var(--ink3)', verticalAlign: 'top' }}>{r.owner}</td>
                  <td style={{ padding: '7px 12px 7px 0', color: 'var(--ink3)', verticalAlign: 'top' }}>{r.trainer}</td>
                  <td style={{ padding: '7px 12px 7px 0', color: 'var(--ink3)', verticalAlign: 'top' }}>{r.receptionist}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mounted for as long as this form is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text. See studio-web/components/Banner.tsx. */}
      <Announce say={sayText(msg)} tone={sayTone(msg)} />
      <form onSubmit={add} style={{ display: 'grid', gap: 9, padding: 14, borderTop: '1px solid var(--ring)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={members?.some((m) => m.id === who) ? who : ''}
            onChange={(e) => setWho(e.target.value)}
            style={{ ...field, minWidth: 220 }}
            aria-label="A member of this gym to take on"
            disabled={members === null}
          >
            <option value="">A member of this gym…</option>
            {(members ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.name ?? m.id.slice(0, 8)}</option>
            ))}
          </select>
          <span style={{ color: 'var(--ink3)', fontSize: 12.5 }}>or an account id</span>
          <input
            value={who} onChange={(e) => setWho(e.target.value)}
            placeholder="Paste their account id"
            aria-label="The account id of somebody outside this gym"
            style={{ ...field, minWidth: 300, flex: 1 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole | '')}
                  style={{ ...field, minWidth: 160 }} aria-label="Taken on as">
            <option value="">Taken on as…</option>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Why, for the record (optional)"
            aria-label="A note for the record"
            style={{ ...field, minWidth: 260, flex: 1 }}
          />
          <button type="submit" disabled={busy || !!addBlocker} style={btn}>
            {busy ? 'Granting…' : 'Put on the staff'}
          </button>
        </div>
        {/* What the chosen role actually is, under the picker, because "Coach"
            and "Reception" are two words and the difference between them is a
            roster row, a place in payroll and a book of other people's health
            records. */}
        {role ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)', maxWidth: '78ch' }}>{STAFF_ROLE_NOTE[role]}</p> : null}
        {addBlocker && who ? <p style={{ margin: 0, fontSize: 12.5, color: '#f0c04e' }}>{addBlocker}</p> : null}
        {msg ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>{msg.text}</p> : null}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink3)', maxWidth: '78ch' }}>
          This console can only list accounts already in this gym — the database shows an owner
          their own gym&rsquo;s profiles and no others, which is the right rule and is why the second
          field takes an id. Somebody who belongs to another gym is refused rather than moved out of
          it; they have to leave first.
        </p>
      </form>
    </Section>
  );
}

/* ── the rota, and what it costs ───────────────────────────────────────────── */

const ROLES: ShiftRole[] = ['floor', 'classes', 'pt', 'desk', 'admin'];

/**
 * The gym's rota: who is on, and what the floor costs to staff.
 *
 * ── Why this is on Staff and why it did not exist ─────────────────────────
 *
 * `addShift`, `setShiftStatus` and `deleteShift` have been in
 * src/lib/gymRota.ts since the rota was built. `addShift` and `setShiftStatus`
 * had no caller in `studio-web` at all; `deleteShift` had no caller ANYWHERE in
 * the repository. So the console could read rostered hours, compare them
 * against demand, and change none of them — a shift entered wrong could only be
 * soft-pulled from a phone, and never removed or corrected.
 *
 * And `gym_shifts` carried no money, so neither surface could answer what a
 * Saturday costs to cover. The only pay figure in the product is
 * `tenants.session_fee` times DELIVERED one-to-ones; a trainer on the desk from
 * six until ten delivers nothing and is owed four hours.
 *
 * ── Its own read, deliberately ────────────────────────────────────────────
 *
 * The page already reads 30 days of shifts into `rec.shifts` for the
 * rostered-versus-delivered comparison. This section reads ONE WEEK, because a
 * rota is edited a week at a time and pulling a month of rows to render seven
 * days would make the week arrows re-read thirty. Two reads of the same table
 * for two different questions is cheaper than one read that answers neither
 * well.
 */
function Rota({ tenantId, trainers, ccy, zone }: {
  tenantId: string;
  trainers: Slice<StaffTrainer>;
  ccy: TenantCurrency;
  /** The gym's own IANA zone, or null because it has not set one. Never the
   *  reader's — see the note on `zone` at the top of this file. */
  zone: string | null;
}) {
  // The week on screen, as the ISO date it opened on. Which day that is comes
  // from src/lib/weekStart.ts via `weekStartOf` — this screen does not decide.
  const [week, setWeek] = useState(() => weekStartOf());
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<Said>(null);
  const [editing, setEditing] = useState<Shift | null>(null);

  // The add form.
  const [who, setWho] = useState('');
  const [day, setDay] = useState(() => weekDays(weekStartOf())[0]);
  const [from, setFrom] = useState('06');
  const [to, setTo] = useState('14');
  const [role, setRole] = useState<ShiftRole>('floor');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const w = weekWindow(week);
    if (!w) { setShifts(null); setReadErr('That week could not be read as a date range.'); return; }
    try {
      setShifts(await fetchShifts(supabase, tenantId, w.fromISO, w.toISO));
      setReadErr(null);
    } catch (e: any) {
      // Null, never []: an empty rota under a failed read tells an owner that
      // nobody is on the floor this week, which is the one sentence that gets
      // somebody called in on their day off.
      setShifts(null);
      setReadErr(e?.message ?? 'The rota could not be read.');
    }
  }, [tenantId, week]);

  useEffect(() => { load(); }, [load]);
  // The day picker follows the week, or it silently offers last week's dates.
  useEffect(() => { setDay(weekDays(week)[0]); }, [week]);

  const days = weekDays(week);
  const cost = shifts ? rotaCost(shifts) : null;
  const summary = shifts ? summariseRota(shifts) : null;

  // The gym's currency, because a shift rate has none of its own until it is
  // typed. There is no default currency in this product — part 150 — so with
  // `tenants.currency` unset the money half of the form is closed rather than
  // guessed at.
  const canPrice = !!ccy;

  const draft = shiftFromHours(who, day, parseInt(from, 10), parseInt(to, 10), role);
  const cents = rate.trim() === '' ? null : Math.round((parseFloat(rate) || 0) * 100);
  const blocker = (who || rate)
    ? shiftBlocker({
        trainerId: who,
        startsAt: draft?.startsAt ?? null,
        endsAt: draft?.endsAt ?? null,
        rateCents: cents,
        currency: cents == null ? null : ccy,
      })
    : null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = shiftFromHours(who, day, parseInt(from, 10), parseInt(to, 10), role);
    const stop = shiftBlocker({
      trainerId: who, startsAt: d?.startsAt ?? null, endsAt: d?.endsAt ?? null,
      rateCents: cents, currency: cents == null ? null : ccy,
    });
    if (stop || !d) { setMsg(refused(stop, 'That shift could not be built from those hours.')); return; }
    setBusy(true); setMsg(null);
    try {
      await addShift(supabase, tenantId, { ...d, rateCents: cents, currency: cents == null ? null : ccy });
      setMsg(wrote('On the rota.'));
      setRate('');
      await load();
    } catch (x: any) {
      setMsg(refused(x?.message, 'That shift was not added, so nobody is rostered for it.'));
    } finally { setBusy(false); }
  };

  const act = async (job: Promise<void>, done: string) => {
    setMsg(null);
    try { await job; setMsg(wrote(done)); await load(); }
    catch (x: any) { setMsg(refused(x?.message, 'That change was refused, so the rota is unchanged.')); }
  };

  const options = trainers.state === 'ready' ? trainers.rows : null;

  const cols: Column<Shift>[] = [
    { key: 'when', header: 'When', value: (sh) => sh.startsAt,
      // `timeZone: zone` where the gym has one, and the browser's where it has
      // not — which is what this column has always silently done. The header
      // above the table names whichever it is, because a 06:00 that is actually
      // 03:00 looks exactly like a 06:00.
      render: (sh) => (
        <span style={{ opacity: isLive(sh) ? 1 : 0.55 }}>
          {new Date(sh.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zone ?? undefined })}
          {' – '}
          {new Date(sh.endsAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: zone ?? undefined })}
        </span>
      ) },
    { key: 'who', header: 'Who', value: (sh) => sh.trainerName,
      render: (sh) => sh.trainerName
        ?? <span className="mono" style={{ fontSize: 11 }}>{sh.trainerId.slice(0, 8)}</span> },
    { key: 'role', header: 'On for', value: (sh) => sh.role },
    { key: 'hours', header: 'Hours', value: (sh) => shiftHours(sh), numeric: true,
      // Null, never 0: a span that cannot be read is not a shift of no length.
      render: (sh) => shiftHours(sh) ?? <span className="dash">unreadable</span> },
    { key: 'cost', header: 'Costs', value: (sh) => sh.rateCents ?? null, numeric: true,
      render: (sh) => {
        if (sh.rateCents == null) return <span className="dash">not priced</span>;
        return money(sh.rateCents, sh.currency ?? null)
          ?? <span className="dash">no currency on this shift</span>;
      } },
    { key: 'state', header: 'State', value: (sh) => sh.status,
      render: (sh) => isLive(sh)
        ? <span style={{ color: 'var(--good)' }}>on</span>
        // A pulled shift is KEPT — "somebody dropped out" and "nobody was ever
        // rostered" produce the same hole in the cover and are different
        // problems. gymRota counts neither as cover.
        : <span style={{ color: 'var(--warn)' }}>pulled</span> },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (sh) => (
        <span style={{ display: 'inline-flex', gap: 11 }}>
          <button style={linkBtn} onClick={() => setEditing(sh)}>Edit</button>
          {isLive(sh) ? (
            <button style={{ ...linkBtn, color: 'var(--warn)' }}
                    onClick={() => act(setShiftStatus(supabase, sh.id, 'cancelled'), 'Pulled — the hole is visible on the rota rather than hidden.')}>
              Pull
            </button>
          ) : (
            <button style={linkBtn}
                    onClick={() => act(setShiftStatus(supabase, sh.id, 'scheduled'), 'Back on.')}>
              Put back
            </button>
          )}
          <button
            style={{ ...linkBtn, color: 'var(--crit)' }}
            onClick={() => {
              // Delete is for a shift that should never have been written.
              // Pulling is for one somebody dropped out of, and the confirm
              // says which is which — the two leave different records.
              if (!confirm('Delete this shift outright? Use Pull instead if somebody dropped out — a pulled shift stays on the rota so the hole is visible.')) return;
              act(deleteShift(supabase, sh.id), 'Deleted.');
            }}
          >Delete</button>
        </span>
      ) },
  ];

  return (
    <Section
      title="The rota"
      sub="Who is on the floor this week, and what it costs. A pulled shift is kept rather than deleted: an hour somebody dropped out of and an hour nobody was booked for make the same hole in the cover and are different problems."
    >
      {/* Mounted for as long as this form is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text. See studio-web/components/Banner.tsx. */}
      <Announce say={sayText(msg)} tone={sayTone(msg)} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 14px', flexWrap: 'wrap' }}>
        <button style={ghostBtn} onClick={() => setWeek((w) => shiftWeek(w, -1))}>← Previous</button>
        <button style={ghostBtn} onClick={() => setWeek(weekStartOf())} disabled={week === weekStartOf()}>This week</button>
        <button style={ghostBtn} onClick={() => setWeek((w) => shiftWeek(w, 1))}>Next →</button>
        <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
          week of {new Date(`${week}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 1, background: 'var(--ring)', borderTop: '1px solid var(--ring)', borderBottom: '1px solid var(--ring)',
      }}>
        <Kpi label="Shifts on" text={summary ? String(summary.shifts - summary.cancelled) : null}
             note={summary && summary.cancelled > 0 ? `${summary.cancelled} pulled` : undefined} />
        <Kpi label="Rostered hours" text={summary?.hours == null ? null : String(Math.round(summary.hours * 10) / 10)}
             note={summary?.hours == null ? 'nothing rostered this week' : undefined} />
        <Kpi label="People on" text={summary ? String(summary.trainers) : null} />
        <Kpi
          label="Costs"
          // Three different silences, and each gets its own words. A total that
          // hid any of them would read as a cheap week.
          text={
            cost == null ? null
              : cost.mixedCurrency ? null
              : cost.cents == null ? null
              : money(cost.cents, cost.currency) ?? null
          }
          note={
            cost == null ? undefined
              : cost.mixedCurrency ? 'two currencies on one rota — they cannot be added'
              : cost.cents == null ? 'no shift this week carries a rate'
              : cost.unpriced > 0 ? `across ${cost.priced} of ${cost.priced + cost.unpriced} shifts — ${cost.unpriced} carry no rate`
              : `across all ${cost.priced} shifts`
          }
        />
      </div>

      <form onSubmit={add} style={{ display: 'flex', gap: 8, padding: 14, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--ring)' }}>
        {options === null ? (
          <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
            {trainers.state === 'failed'
              ? 'Your roster did not come back, so nobody can be rostered from here. That is a failed query, not a gym with no staff.'
              : 'Reading your roster…'}
          </span>
        ) : options.length === 0 ? (
          <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>Nobody on the roster to put on a shift yet.</span>
        ) : (
          <>
            <select value={who} onChange={(e) => setWho(e.target.value)} style={{ ...field, minWidth: 160 }}
                    aria-label="Who is on">
              <option value="">Who is on?</option>
              {options.map((t) => (
                <option key={t.trainerId} value={t.trainerId}>{t.name ?? 'Unnamed trainer'}</option>
              ))}
            </select>
            <select value={day} onChange={(e) => setDay(e.target.value)} style={{ ...field, minWidth: 140 }} aria-label="Which day">
              {days.map((d) => (
                <option key={d} value={d}>
                  {new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                </option>
              ))}
            </select>
            <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric"
                   aria-label="From hour" style={{ ...field, width: 60 }} />
            <span style={{ color: 'var(--ink3)', fontSize: 12.5 }}>to</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric"
                   aria-label="To hour" style={{ ...field, width: 60 }} />
            <select value={role} onChange={(e) => setRole(e.target.value as ShiftRole)} style={{ ...field, width: 110 }} aria-label="On for">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {/* Closed rather than defaulted when the gym has not said what money
                it takes. There is no default currency in this product — part 150
                removed all seven of them — so a figure typed here would be
                stored in a currency nobody chose. */}
            <input
              value={rate} onChange={(e) => setRate(e.target.value)} disabled={!canPrice}
              placeholder={canPrice ? `Cost (${ccy})` : 'Set the gym’s currency first'}
              inputMode="decimal" aria-label="What this shift costs"
              style={{ ...field, width: 150, opacity: canPrice ? 1 : 0.5 }}
            />
            <button type="submit" disabled={busy} style={btn}>{busy ? 'Adding…' : 'Add'}</button>
          </>
        )}
      </form>

      {!canPrice ? (
        <p style={{ margin: 0, padding: '0 14px 12px', fontSize: 12.5, color: 'var(--ink3)' }}>
          This gym has not set its currency, so a shift can be rostered but not costed — an amount
          with no currency is read in whatever money the reader happens to be thinking in. Set it on
          the gym record and the cost column fills in.
        </p>
      ) : null}
      {blocker ? <p style={{ margin: 0, padding: '0 14px 12px', fontSize: 12.5, color: '#f0c04e' }}>{blocker}</p> : null}
      {msg ? <p style={{ margin: 0, padding: '0 14px 12px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg.text}</p> : null}

      {/* Whose clock the column below is in. Stated always, in both states,
          because the failure this fixes is invisible: a shift at the wrong hour
          renders exactly as neatly as one at the right hour, and the only
          reader who finds out is the coach who turns up. */}
      <p style={{ margin: 0, padding: '0 14px 12px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '80ch' }}>
        {zone ? (
          <>
            Times below are <span className="mono">{zone}</span>, this gym&rsquo;s own clock, and the
            hours you type are read as the gym&rsquo;s too.{' '}
            {zoneGapNote(zone) ? <span style={{ color: 'var(--warn)' }}>{zoneGapNote(zone)}</span> : null}
          </>
        ) : (
          <>
            Times below are <strong style={{ color: 'var(--ink2)' }}>your own device&rsquo;s</strong>{' '}
            — {NO_ZONE_NOTE}, so a colleague opening this page from somewhere else sees the same
            shifts at different hours and neither of you is told.{' '}
            <a href="/settings" style={{ color: 'var(--brand)' }}>Set it on Gym</a> and this table
            becomes the gym&rsquo;s clock.
          </>
        )}
      </p>

      {shifts === null ? (
        <div style={{ padding: '26px 20px', color: 'var(--ink3)', fontSize: 13.5 }}>
          {readErr
            ? `The rota could not be read, so this week is unknown rather than empty: ${readErr}`
            : 'Loading…'}
        </div>
      ) : (
        <DataTable rows={shifts} columns={cols} rowKey={(sh) => sh.id}
                   empty="Nobody is rostered this week. That is a rota nobody has written, not a gym with nobody in it." />
      )}

      {editing ? (
        <EditShift
          shift={editing} ccy={ccy} zone={zone}
          onClose={(changed) => { setEditing(null); if (changed) load(); }}
        />
      ) : null}
    </Section>
  );
}

/**
 * Correct a shift that is already on the rota. Until `updateShift` existed the
 * only correction available was delete-and-retype.
 *
 * ── The wall clock, and whose ────────────────────────────────────────────
 *
 * `datetime-local` holds a wall clock with no zone on it, and the browser both
 * fills it in and reads it back as its own. That was correct while the reader
 * was always standing in the gym and wrong the moment they were not: a Dubai
 * gym's 06:00 shift opened in London showed 03:00, and pressing Save wrote 03:00
 * Dubai — the read was three hours out and the write MOVED SOMEBODY'S SHIFT.
 * Nothing on the form said which clock it was in, so there was nothing to
 * notice.
 *
 * With `tenants.timezone` set, `gymWallValue` and `instantAtGym` put the gym's
 * own clock in the field and take the gym's own clock back out, and the two are
 * exact inverses across the days the clocks move. With no zone this falls back
 * to the browser's — the old behaviour, unchanged — and says so on the form.
 */
function EditShift({ shift, ccy, zone, onClose }: {
  shift: Shift; ccy: TenantCurrency; zone: string | null; onClose: (changed: boolean) => void;
}) {
  const local = (iso: string) => {
    const atGym = gymWallValue(iso, zone);
    if (atGym) return atGym;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    // The reader's own wall clock, which is what this field has always been.
    // Kept as the fallback rather than refusing to open the form: a gym with no
    // zone still has to be able to correct a shift, and this is exactly as
    // right as it was before — the difference is that the form now says so.
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  /** A wall clock out of the form → the instant it names. The inverse of
   *  `local`, and it has to stay the inverse: a form that reads in one clock
   *  and writes in another moves every shift it touches. */
  const instant = (wall: string) => instantAtGym(wall, zone) ?? new Date(wall).toISOString();
  const [startsAt, setStartsAt] = useState(local(shift.startsAt));
  const [endsAt, setEndsAt] = useState(local(shift.endsAt));
  const [role, setRole] = useState<ShiftRole>(shift.role);
  const [note, setNote] = useState(shift.note ?? '');
  const [rate, setRate] = useState(shift.rateCents == null ? '' : String(shift.rateCents / 100));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Said>(null);

  // The shift's OWN currency wins over the gym's: a rate filed last March in
  // one currency must not be silently re-denominated because the gym has since
  // changed its setting. The gym's is only the default for a shift with none.
  const cur = shift.currency ?? ccy;
  const cents = rate.trim() === '' ? null : Math.round((parseFloat(rate) || 0) * 100);
  const blocker = shiftBlocker({
    trainerId: shift.trainerId,
    startsAt: startsAt ? instant(startsAt) : null,
    endsAt: endsAt ? instant(endsAt) : null,
    rateCents: cents,
    currency: cents == null ? null : cur,
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker) { setMsg(refused(blocker)); return; }
    setBusy(true); setMsg(null);
    try {
      await updateShift(supabase, shift.id, {
        startsAt: instant(startsAt),
        endsAt: instant(endsAt),
        role,
        note: note.trim() || null,
        rateCents: cents,
        currency: cents == null ? null : cur,
      });
      onClose(true);
    } catch (x: any) {
      setMsg(refused(x?.message, 'That change was refused, so the shift is unchanged.'));
    } finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-label="Edit this shift"
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: 24, zIndex: 10 }}
         onClick={() => onClose(false)}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ width: 480, maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--ring)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ring)' }}>
          <h2>{shift.trainerName ?? 'This shift'}</h2>
          <p style={{ margin: '3px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
            {isLive(shift) ? 'On the rota' : 'Pulled — still on the record'}
            {' · '}
            {zone
              ? <>hours are <span className="mono">{zone}</span>, the gym&rsquo;s own</>
              : <>hours are this device&rsquo;s, not the gym&rsquo;s — the gym has not set a timezone</>}
          </p>
        </div>
        {/* Mounted for as long as this form is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text. See studio-web/components/Banner.tsx. */}
        <Announce say={sayText(msg)} tone={sayTone(msg)} />
        <form onSubmit={save} style={{ display: 'grid', gap: 9, padding: 14 }}>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={field} aria-label="Starts" />
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={field} aria-label="Ends" />
          <select value={role} onChange={(e) => setRole(e.target.value as ShiftRole)} style={field} aria-label="On for">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" style={field} />
          <input
            value={rate} onChange={(e) => setRate(e.target.value)} disabled={!cur}
            placeholder={cur ? `Cost (${cur})` : 'No currency set — this shift cannot be costed'}
            inputMode="decimal" aria-label="What this shift costs"
            style={{ ...field, opacity: cur ? 1 : 0.5 }}
          />
          {blocker ? <p style={{ margin: 0, fontSize: 12.5, color: '#f0c04e' }}>{blocker}</p> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={busy || !!blocker} style={btn}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => onClose(false)} style={ghostBtn}>Cancel</button>
          </div>
          {msg ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>{msg.text}</p> : null}
        </form>
      </div>
    </div>
  );
}

/* ── money owed to somebody who is not on the roster ───────────────────────── */

function OffRoster({ view, ccy }: { view: StaffView; ccy: TenantCurrency }) {
  const rows = view.offRoster;
  if (!rows || !rows.length) return null;

  const cols: Column<PayrollLine>[] = [
    { key: 'who', header: 'Trainer', value: (l) => l.trainerName,
      render: (l) => l.trainerName ?? <span className="mono" style={{ fontSize: 11.5 }}>{l.trainerId}</span> },
    { key: 'delivered', header: 'Delivered', value: (l) => l.delivered, numeric: true },
    { key: 'unmarked', header: 'Unmarked', value: (l) => l.unmarked, numeric: true },
    { key: 'cents', header: 'Pay', value: (l) => l.cents, numeric: true,
      render: (l) => l.cents == null
        ? <span className="dash">no rate</span>
        : (amount(l.cents, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>) },
  ];

  return (
    <Section
      title="Sessions run by somebody not on the roster"
      sub="Real work against a name this page cannot print — a trainer who has left, or a roster row that was never created. Surfaced rather than dropped, because it is money."
    >
      {/* The section named money owed and offered nothing to do about it. This
          is the honest half of the fix: it says exactly what is missing, what
          the consequence is, and where the row comes from.
          
          It stops short of a button, and that is not an oversight. `trainers`
          has no owner INSERT policy — `trainers_owner_r` is SELECT and
          `trainers_self_rw` is `id = auth.uid()` — so a roster row is created
          when the COACH accepts a join code (part 81), not by the owner. A
          button here would be refused by the database, and a button that
          silently matches zero rows is the exact failure this codebase is
          written against. */}
      <p style={{ margin: 0, padding: '12px 14px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '80ch' }}>
        Everybody below has delivered sessions this gym owes money for and has no{' '}
        <span className="mono">trainers</span> row, so they are missing from every per-coach figure
        above — class hours, rostered cover, the drift bands and the payroll total. A roster row is
        created when the coach accepts the gym&rsquo;s join code, not from here: the owner cannot
        insert one, and a button that the database would refuse is worse than this sentence. Send
        them the join code, and the rows below fold into the roster on their next visit.
      </p>
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

/**
 * Everybody attached to this gym, whatever their role.
 *
 * Not `fetchTrainers`: that one reads `trainers`, which is the COACHING roster
 * and by construction has no receptionist row in it and never will. Staff is a
 * fact about `profiles.role`, and the two are different questions — a coach who
 * has been taken off the staff keeps their `trainers` row on purpose, so a
 * roster read would still list them.
 *
 * `profiles_owner_tenant_r` is what makes this readable and is also its limit:
 * an owner sees the profiles in their own tenant and no others.
 */
async function fetchPeople(tenantId: string): Promise<Person[]> {
  const { data, error } = await supabase
    .from('profiles').select('id, full_name, role, created_at').eq('tenant_id', tenantId);
  if (error) throw error;
  return (data ?? []).map((p: any) => ({
    id: p.id,
    name: (p.full_name || '').trim() || null,
    // Anything the column's own constraint does not permit is treated as no
    // role rather than passed through and printed as a role somebody invented.
    role: (['owner', 'trainer', 'client', 'receptionist'] as const).includes(p.role)
      ? (p.role as ProfileRole) : null,
    since: p.created_at ?? null,
  }));
}

/**
 * The record of who put whom on this gym's staff.
 *
 * Rows that are not a complete record are dropped by `grantFromRow` rather than
 * rendered — a grant with no date or no role is not evidence of anything, and
 * showing one under the heading "how they got here" would be worse than showing
 * nothing, which is what everybody who joined by join code correctly gets.
 *
 * The two `_name` columns are selected as well as the ids and are not
 * redundant: the ids are `on delete set null`, so a grant made by an owner who
 * has since been erased has a name on the row and nothing to join to. That is
 * the shape part 184 uses for the financial record and part 711 takes for the
 * same reason — an access log that blocked an erasure would be worse than one
 * that survives it half-anonymised.
 */
async function fetchGrants(tenantId: string): Promise<StaffGrant[]> {
  const { data, error } = await supabase
    .from('staff_grants')
    .select('id, subject_id, subject_name, actor_id, actor_name, role, granted_at, revoked_at, revoked_by, revoked_by_name, note')
    .eq('tenant_id', tenantId)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => grantFromRow(r))
    .filter((g): g is StaffGrant => g !== null);
}

/**
 * Every client in the gym and whose book they are on. `trainer_id` null is a
 * real answer — a member nobody coaches — and is counted as such.
 *
 * ── Why this is paged rather than capped ───────────────────────────────────
 *
 * It was neither, which is the state src/lib/rowCap.ts was written about: an
 * unbounded `.select()` stops at a thousand rows, says nothing, and hands back
 * a prefix that looks exactly like a complete answer.
 *
 * Two things downstream make that worse than a short list. `fetchActivity`
 * builds its id set from these rows, so a cut does not shorten one column — it
 * removes people from the gym's book entirely, and every figure derived from
 * them is then complete and confident about a roster missing its tail. And
 * `revokeBlocker` reads the count per trainer to decide whether somebody can be
 * taken off the staff: its own comment says a null count is "we could not count
 * them", which is not zero — an UNDERSTATED count is worse still, because it is
 * a number, and it waves through the removal of a coach whose clients are all
 * past row 1000.
 *
 * `readAll` rather than `assertWhole` for the reason the module gives: the
 * screen genuinely needs every row, refusing the whole staff page over a large
 * gym would take a working screen away, and the set is finite by construction.
 * Ordered by the primary key because `readAll` requires an order that cannot
 * tie, and this table has no other column that qualifies.
 */
async function fetchClients(tenantId: string): Promise<StaffClient[]> {
  const rows = await readAll<{ id: string; trainer_id: string | null }>(
    (from, to) => supabase
      .from('clients').select('id, trainer_id').eq('tenant_id', tenantId)
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's clients",
  );
  if (!rows.length) return [];

  const meta = await profilesFor(rows.map((r) => r.id));
  return rows.map((r) => ({
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

/* The same input and button shapes as the Door and Money screens. This page had
 * no control of any kind until the rota gained a form: `addShift`,
 * `setShiftStatus` and `deleteShift` had no caller in this console at all. */
const field = {
  padding: '9px 11px', borderRadius: 0, fontSize: 13.5,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const btn = {
  ...field, background: 'var(--brand)', color: 'var(--brand-ink)',
  fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
} as const;

const ghostBtn = {
  ...field, background: 'var(--surface2)', color: 'var(--ink2)',
  cursor: 'pointer', flex: 'none',
} as const;

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

// The banner is the shared one now: studio-web/components/Banner.tsx. This
// page's copy rendered into a plain <div>, so every "the write was refused and
// nothing was saved" it said was a silence for a screen reader. The shared one
// carries role="alert"/aria-live; `live={false}` is for the ones an Announce
// region on the same screen is already reading out.
function Banner({ children, tone, live }: { children: React.ReactNode; tone?: 'crit'; live?: boolean }) {
  return <SharedBanner tone={tone} live={live}>{children}</SharedBanner>;
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
