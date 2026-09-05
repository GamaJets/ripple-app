'use client';

// Equipment — what is on the floor, what is out of action, and what that costs
// the timetable.
//
// The register exists because Studio reports fill rate against a stated
// capacity, and a capacity of 14 is a claim about the room rather than a fact
// about it. The claim stops being true the moment six of the rowers break, and
// nothing else in this console notices: the class still says 14, the fill rate
// still divides by 14, and the gym measures itself against a number that
// quietly became fiction while the maintenance log lived on a whiteboard.
//
// So this is a scheduling screen as much as a maintenance one. A broken rower
// is a fact about Tuesday's 18:00, and the capacity check at the bottom is the
// only place the two halves are put side by side.
//
// Staff see it as well as owners. Taking a machine out of action is a job for
// whoever is standing next to the machine, and a register only trainers can
// read but not write is a register that goes stale in a week.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
// `Unresolved` comes from here rather than being declared at the bottom of
// this file. Seven console screens held a byte-identical copy, every one of
// them a plain `<div>` — so the sentence saying THIS section's rows could not
// be read was never announced. One copy, with the live region on it.
import { ConsoleGate, Unresolved } from '@/components/Gate';
import { type Unread, failure } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { settledLanded } from '@lib/readLanded';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchEquipment, addEquipment, setStatus, recordService,
  fetchLog, addLogEntry, logBlocker, logCost, LOG_KINDS, LOG_LABEL,
  type LogEntry, type LogKind,
  nextServiceDue, serviceState, usableUnits, outOfServiceUnits,
  capacityFor, concurrentKitDemand, summariseRegister, needsAttention,
  type Equipment, type EquipmentStatus, type ServiceState, type CapacityCheck,
  type ConcurrentDemand,
} from '@lib/gymEquipment';
import { fetchClasses, type GymClass } from '@lib/gymSchedule';
import { isoDate } from '@lib/format';
import { money } from '@lib/gymRecord';
import { readTenant, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
// The reader's locale, the GYM's zone. A class clash is an hour on the gym's
// wall clock; drawn on the reader's it can name a different weekday entirely.
import { gymDateTimeText } from '@lib/gymWhen';
// The gym's calendar day. Every service deadline on this screen is a `date`
// column somebody filled in on the gym's own clock, so the "today" it is
// compared against has to be that clock too.
import { gymDay } from '@lib/gymZone';
import { Banner } from '@/components/Banner';

const DAY = 86400000;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "Nothing needs attention" are both lies about a query that errored, and staff
 * act on both of them — one by waiting, the other by telling the owner every
 * machine in the building is fine.
 */


/** The words the screen uses for a service state. `serviceState` decides which. */
const STATE_WORD: Record<ServiceState, string> = {
  overdue: 'overdue',
  due: 'due this week',
  unrecorded: 'never serviced',
  unscheduled: 'no schedule',
  ok: 'in date',
};

const stateColour = (s: ServiceState) =>
  s === 'overdue' ? 'var(--crit)' : s === 'due' || s === 'unrecorded' ? 'var(--warn)' : 'var(--ink2)';

const STATUS_WORD: Record<EquipmentStatus, string> = {
  in_service: 'in service',
  out_of_service: 'out of action',
  retired: 'retired',
};

export default function EquipmentPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  // Whether the gym's NAME could not be READ, as distinct from there being no
  // gym. The read below still drops the error into a `no-error-ok:` — no figure
  // on this page depends on the name — but the rail printed "No gym linked" for
  // either, and that is a sentence about the owner's ACCOUNT produced by a
  // query that failed. Carrying this one bit is what lets the rail say which.
  const [gymNameUnread, setGymNameUnread] = useState(false);
  const [kit, setKit] = useState<Equipment[] | null>(null);
  const [classes, setClasses] = useState<GymClass[] | null>(null);
  /** The maintenance and incident log. Null is unread, never an empty history. */
  const [log, setLog] = useState<LogEntry[] | null>(null);
  /** The gym's own currency, for the cost on a service entry. There is no
   *  fallback: what an engineer charged is a permanent record. */
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string): Promise<boolean> => {
    // allSettled, not all: one failing read must not take the other with it.
    // Under Promise.all a refused gym_classes query also emptied the register,
    // so a gym with four machines out of action read as a gym with none — and
    // the banner blamed the timetable, which nobody had asked about.
    const [kRes, cRes, lRes] = await Promise.allSettled([
      fetchEquipment(supabase, tenantId),
      fetchClasses(
        supabase, tenantId,
        new Date().toISOString(),
        new Date(Date.now() + 7 * DAY).toISOString(),
      ),
      fetchLog(supabase, tenantId),
    ]);

    // A read that failed is null, never []. [] is the gym saying it owns none;
    // null is nobody knowing. Staff act differently on the two.
    setKit(kRes.status === 'fulfilled' ? kRes.value : null);
    setClasses(cRes.status === 'fulfilled' ? cRes.value : null);
    setLog(lRes.status === 'fulfilled' ? lRes.value : null);

    const trouble = [
      failure(kRes, 'the equipment register'),
      failure(cRes, "the coming week's classes"),
      failure(lRes, 'the maintenance and incident log'),
    ].filter((s): s is string => s !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));

    // Whole means all three came back. `useFetched` stamps only on a whole
    // read, so a register read without the coming week's classes leaves the
    // stamp where it was rather than dating a seat count nobody computed.
    return settledLanded([kRes, cRes, lRes]);
  }, []);

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
      if (!who?.tenantId) { setKit([]); setClasses([]); setLog([]); return; }
      // The error is read off the result. Not because the name matters — it is
      // a label — but because "we could not ask" and "there is no gym" must not
      // arrive at the rail as the same null. See the Shell's gymNameUnread prop.
      // The currency comes with it now: a service entry can carry a cost, and
      // what an engineer charged is a permanent record that has to say in what.
      const t = await readTenant(supabase, who.tenantId);
      if (live) { setGymName(t.name); setCcy(t.currency); setZone(t.zone); setGymNameUnread(!!t.error); }
    })();
    return () => { live = false; };
    // Identity and the gym record only — the three reads are the effect below's.
  }, []);

  /**
   * Kept current, and it says when it was last read.
   *
   * The register is written at the machine: a trainer marks a rower out of
   * action from the floor while the owner has this screen open in the office,
   * and "what is out of action" is exactly the figure somebody is about to
   * decide a class on. The classes read is bounded at NOW and seven days out,
   * so it also moves under a tab nobody has touched.
   */
  const { at: readAt, busy: refetching, refresh } = useFetched(
    () => (me?.tenantId ? load(me.tenantId) : Promise.resolve(false)),
  );

  // The first read. Keyed on the tenant id rather than fired at the end of the
  // effect above: `useFetched` holds the reader in a ref assigned during
  // RENDER, so calling `refresh()` in the same tick as `setMe(who)` would run
  // the closure from the previous render, where `me` is still undefined.
  useEffect(() => {
    if (me?.tenantId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/equipment">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner' && me.role !== 'trainer') {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/equipment">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>The equipment register is for gym staff.</p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  // `refresh` is the hook's, not a second reader — see /money for the same note.

  // The gym's own calendar day — the same date every service deadline on this
  // screen is compared against. This product sells in AED, four hours ahead of
  // UTC, so for four hours either side of local midnight a UTC date would have
  // called a service due tomorrow overdue today.
  //
  // It SAID that and was `isoDate(new Date())`, which is the READER's calendar
  // — the same defect one layer over, and one `check:console-when` cannot see
  // because nothing on this line formats a Date. `zone` is already read into
  // this component (`readTenant` supplies it), and every service due date on
  // `gym_equipment` is a `date` column somebody entered as the gym's day, so
  // comparing it against a laptop's day in another country marks a rower
  // overdue a day early — or, worse, still in service on the morning it was
  // due. The reader's day stays as the fallback for a gym that has not set a
  // zone, which is exactly what this screen did before.
  const today = gymDay(Date.now(), zone) ?? isoDate(new Date());

  const sum = kit ? summariseRegister(kit, today) : null;
  const attention = kit ? needsAttention(kit, today) : null;
  const down = kit ? kit.filter((e) => e.status === 'out_of_service') : null;

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread = (rows: unknown[] | null): Unread => (rows !== null ? null : err ? 'failed' : 'loading');

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/equipment">
      <h1>Equipment</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What the gym owns, what is out of action, and which classes that takes
        seats out of. A broken rower is a scheduling fact, not just a
        maintenance one.
      </p>

      <Fetched at={readAt} busy={refetching} onRefresh={refresh}
               what="this register" style={{ margin: '2px 0 14px' }} />

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Items registered"
          text={sum ? String(sum.items) : null}
          note={sum ? 'retired kit not counted' : undefined}
        />
        <Kpi
          label="Usable units"
          text={sum ? String(sum.usableUnits) : null}
          note={sum ? 'in service, summed across quantity' : undefined}
        />
        <Kpi
          label="Out of action"
          text={sum ? String(sum.downUnits) : null}
          note={sum && sum.downUnits > 0 ? 'units the gym owns but cannot use' : undefined}
        />
        <Kpi
          label="Service overdue"
          text={sum ? String(sum.overdue) : null}
          note={sum && sum.due > 0 ? `${sum.due} more due this week` : undefined}
        />
        <Kpi
          label="Never serviced"
          text={sum ? String(sum.unrecorded) : null}
          note={sum && sum.unrecorded > 0 ? 'has a schedule, no service logged' : undefined}
        />
      </div>

      <OutOfAction rows={down} unread={unread(kit)} today={today} onChange={refresh} />
      <DueForService rows={attention} unread={unread(kit)} today={today} tenantId={tenantId} me={me} onChange={refresh} />
      <CapacityAtRisk kit={kit} classes={classes} zone={zone} kitUnread={unread(kit)} classesUnread={unread(classes)} />
      <Register rows={kit} unread={unread(kit)} today={today} onChange={refresh} />

      <History
        rows={log} kit={kit} unread={unread(log)} today={today}
        ccy={ccy} tenantId={tenantId} me={me} onChange={refresh}
      />
      <AddKit tenantId={tenantId} onChange={refresh} />
    </Shell>
  );
}

/* ── out of action ─────────────────────────────────────────────────────────── */

function OutOfAction({ rows, unread, today, onChange }: {
  rows: Equipment[] | null; unread: Unread; today: string; onChange: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  const back = async (e: Equipment) => {
    setMsg(null);
    try {
      await setStatus(supabase, e.id, 'in_service');
      onChange();
    } catch (x: any) {
      // setStatus throws on a refused update, and with no catch that rejection
      // went nowhere: the row stayed out of action and the screen said nothing,
      // so staff read the machine as back on the floor when the database had
      // refused to say so.
      setMsg(x?.message ?? 'Could not put that back in service.');
    }
  };

  const cols: Column<Equipment>[] = [
    { key: 'name', header: 'Item', value: (e) => e.name },
    { key: 'cat', header: 'Kind', value: (e) => e.category ?? '',
      render: (e) => e.category ?? <span className="dash">uncategorised</span> },
    { key: 'id', header: 'Asset', value: (e) => e.identifier ?? '',
      render: (e) => e.identifier ? <span className="mono">{e.identifier}</span> : <span className="dash">—</span> },
    { key: 'qty', header: 'Units', value: (e) => e.quantity, numeric: true },
    { key: 'why', header: 'Why', value: (e) => e.outOfServiceReason ?? '',
      // `outOfServiceReason`, not `note`. They were the same column, and
      // `recordService` CLEARS the note — so a reason stored there vanished the
      // first time anybody serviced the machine, taking its standing
      // description with it. Neither surface ever passed one anyway, so this
      // cell read "no reason recorded" about a column nothing could write.
      render: (e) => e.outOfServiceReason ?? <span className="dash">no reason recorded</span> },
    { key: 'since', header: 'Out since', value: (e) => e.outOfServiceSince ?? '',
      // The question an owner actually asks about a broken machine, which a
      // status column alone could never answer.
      render: (e) => e.outOfServiceSince
        ? <span>{e.outOfServiceSince}{daysSince(e.outOfServiceSince, today) != null ? ` · ${daysSince(e.outOfServiceSince, today)} days` : ''}</span>
        : <span className="dash">not recorded</span> },
    { key: 'back', header: '', value: () => 0, align: 'right',
      render: (e) => <button style={linkBtn} onClick={() => back(e)}>Back in service</button> },
  ];

  return (
    <Section
      title="Out of action"
      sub="Kit the gym owns and cannot use today. Every unit here is already subtracted from the capacity check below."
    >
      {/* Announced. `msg` on this page only ever holds the outcome of a write
          that was refused; `History` below already banners its own. */}
      {msg ? <p role="alert" aria-live="assertive" aria-atomic="true" style={{ margin: 14, fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
      {unread ? <Unresolved state={unread} what="the equipment register" /> : (
        <DataTable noun="items out of action"
          rows={rows ?? []} columns={cols} rowKey={(e) => e.id}
          empty="Nothing is marked out of action."
        />
      )}
    </Section>
  );
}

/* ── what has happened to the kit ──────────────────────────────────────────── */

/**
 * The maintenance history and the accident book.
 *
 * `recordService` used to be the whole of a gym's maintenance record: it
 * overwrote one date and DELETED the note, "since whatever it said is presumably
 * done". Six services in three years left one date and nothing else — no
 * engineer, no cost, no findings, and none of the five before it. So "when was
 * this last looked at, and how often has it needed looking at" was
 * unanswerable, which is exactly the question that tells a broken machine from
 * a machine that keeps breaking.
 *
 * Incidents are in the same table and the same list. An accident book is a
 * statutory requirement in most jurisdictions this product is sold into, the
 * place a gym looks for one is the machine it happened on, and an incident with
 * no machine — somebody slipping on a wet floor — is recorded against no
 * equipment at all rather than not recorded.
 */
function History({ rows, kit, unread, today, ccy, tenantId, me, onChange }: {
  rows: LogEntry[] | null; kit: Equipment[] | null; unread: Unread; today: string;
  ccy: TenantCurrency; tenantId: string; me: Me; onChange: () => void;
}) {
  const [kind, setKind] = useState<LogKind>('service');
  const [equipmentId, setEquipmentId] = useState('');
  const [on, setOn] = useState(today);
  const [by, setBy] = useState('');
  const [findings, setFindings] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const blocker = logBlocker(kind, equipmentId || null, findings, cost, ccy);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker) { setMsg(blocker); return; }
    // Read once, by the same reader the blocker used, and not re-derived here.
    // This line was `cost.trim().replace(/[,\s]/g, '')` followed by
    // `Math.round(Number(clean) * 100)`, so `12,50` became 1250 and was written
    // as 125,000 minor units — with `logBlocker` testing the same stripped
    // string and agreeing. Two readers over one box is how that happened.
    const money = logCost(cost, ccy);
    if (!money.ok) { setMsg(money.reason); return; }
    setBusy(true); setMsg(null);
    try {
      await addLogEntry(supabase, tenantId, {
        equipmentId: equipmentId || null,
        // Snapshotted, because the reference is `on delete set null`: retiring
        // a machine must not turn its accident record into "somebody was hurt
        // by something".
        equipmentLabel: (kit ?? []).find((k) => k.id === equipmentId)?.name ?? null,
        kind,
        happenedOn: on,
        performedBy: by,
        findings,
        costCents: money.minorUnits,
        currency: money.minorUnits == null ? null : ccy,
        recordedBy: me.id,
      });
      setFindings(''); setBy(''); setCost('');
      onChange();
    } catch (x: any) {
      setMsg(`That entry was NOT recorded: ${x?.message ?? 'the write was refused'}. Nothing is in the log.`);
    } finally { setBusy(false); }
  };

  const cols: Column<LogEntry>[] = [
    { key: 'on', header: 'When', value: (r) => r.happenedOn },
    { key: 'kind', header: 'What', value: (r) => LOG_LABEL[r.kind],
      render: (r) => (
        <span style={{ color: r.kind === 'incident' ? 'var(--crit)' : undefined }}>{LOG_LABEL[r.kind]}</span>
      ) },
    { key: 'item', header: 'Item', value: (r) => r.equipmentLabel ?? '',
      // The snapshot first. A retired machine's rows keep pointing at nothing,
      // and "somebody serviced something" is not a maintenance history.
      render: (r) => r.equipmentLabel
        ?? (r.equipmentId ? <span className="dash">a machine no longer on the register</span>
                          : <span className="dash">no machine</span>) },
    { key: 'by', header: 'By', value: (r) => r.performedBy ?? '',
      render: (r) => r.performedBy ?? <span className="dash">not recorded</span> },
    { key: 'findings', header: 'What was found', value: (r) => r.findings ?? '',
      render: (r) => <span style={{ whiteSpace: 'normal' }}>{r.findings ?? <span className="dash">—</span>}</span> },
    { key: 'cost', header: 'Cost', value: (r) => r.costCents, numeric: true,
      render: (r) => r.costCents == null
        ? <span className="dash">none recorded</span>
        : (money(r.costCents, r.currency) ?? <span className="dash">no currency on this entry</span>) },
  ];

  return (
    <Section
      title="Maintenance and incidents"
      sub="Every service, repair, inspection, clean and incident, oldest kept. Recording a service here is what makes the date on the register mean something — before this, servicing a machine deleted the note saying what was wrong with it."
    >
      <form onSubmit={add} style={formRow}>
        <select value={kind} onChange={(e) => setKind(e.target.value as LogKind)}
                style={{ ...field, minWidth: 170 }} aria-label="What kind of entry this is">
          {LOG_KINDS.map((k) => <option key={k} value={k}>{LOG_LABEL[k]}</option>)}
        </select>
        <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}
                style={{ ...field, minWidth: 190 }} aria-label="Which machine">
          <option value="">{kit === null ? 'The register could not be read' : 'No machine — a floor incident'}</option>
          {(kit ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}{k.identifier ? ` · ${k.identifier}` : ''}</option>)}
        </select>
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)}
               style={{ ...field, width: 148 }} aria-label="The day it happened" />
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Who did it"
               style={{ ...field, width: 170 }} aria-label="Who performed it" />
        <input value={findings} onChange={(e) => setFindings(e.target.value)}
               placeholder="What was found or what happened"
               style={{ ...field, flex: 2, minWidth: 220 }} aria-label="What was found" />
        <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal"
               placeholder={ccy ? `Cost (${ccy})` : 'Cost'} style={{ ...field, width: 130 }}
               aria-label="What it cost" />
        <button type="submit" disabled={busy || !!blocker} style={primaryBtn}>Record</button>
      </form>
      <p style={{ margin: '0 14px 12px', fontSize: 12, color: 'var(--ink3)', maxWidth: '80ch' }}>
        &ldquo;Who did it&rdquo; is free text because the answer is usually a company &mdash; a
        foreign key would force every external engineer to have a Repple account. Leave the machine
        blank for an incident that involved none: a gym with no accident book is not helped by one
        that only accepts accidents involving equipment.
        {ccy ? null : ` A cost cannot be recorded until this gym sets its currency — ${NO_CURRENCY_NOTE}.`}
      </p>
      {blocker && (findings || cost) ? (
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '74ch' }}>{blocker}</p>
      ) : null}
      {msg ? <Banner tone="crit">{msg}</Banner> : null}
      {unread ? <Unresolved state={unread} what="the maintenance log" /> : (
        <DataTable noun="log entries"
          rows={rows ?? []} columns={cols} rowKey={(r) => r.id}
          empty="Nothing has been recorded. Until this wave the product kept one date per machine and deleted the note, so an empty log here is the state everything was in rather than a gym that has never serviced anything."
        />
      )}
    </Section>
  );
}

/* ── service ───────────────────────────────────────────────────────────────── */

function DueForService({ rows, unread, today, tenantId, me, onChange }: {
  rows: { item: Equipment; state: ServiceState }[] | null;
  unread: Unread; today: string; tenantId: string; me: Me; onChange: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  const serviced = async (e: Equipment) => {
    setMsg(null);
    try {
      // The log entry goes with it. Ticking a machine off the due list used to
      // move one date and DELETE the note, so the only trace a service had ever
      // happened was that the machine stopped being due — and the description
      // of what was wrong with it went with the note. Carrying the note into
      // the entry's findings is what keeps that sentence: it is about to be
      // cleared, and it is the only account of the fault anybody wrote down.
      await recordService(supabase, e.id, today, {
        tenantId,
        equipmentLabel: e.name,
        kind: 'service',
        findings: e.note,
        recordedBy: me.id,
      });
      onChange();
    } catch (x: any) {
      setMsg(x?.message ?? 'Could not record that service.');
    }
  };

  const pull = async (e: Equipment) => {
    setMsg(null);
    try {
      // The gym's own day on the `since` column, so it and `last_serviced_on`
      // stay in one calendar and "out of action N days" counts from the day the
      // staff member was standing in front of it.
      await setStatus(supabase, e.id, 'out_of_service', undefined, null, today);
      onChange();
    } catch (x: any) {
      setMsg(x?.message ?? 'Could not take that out of service.');
    }
  };

  type Row = { item: Equipment; state: ServiceState };
  const cols: Column<Row>[] = [
    { key: 'name', header: 'Item', value: (r) => r.item.name },
    { key: 'cat', header: 'Kind', value: (r) => r.item.category ?? '',
      render: (r) => r.item.category ?? <span className="dash">uncategorised</span> },
    { key: 'state', header: 'Standing', value: (r) => r.state,
      render: (r) => <span style={{ color: stateColour(r.state) }}>{STATE_WORD[r.state]}</span> },
    { key: 'last', header: 'Last serviced', value: (r) => r.item.lastServicedOn ?? '',
      render: (r) => r.item.lastServicedOn ?? <span className="dash">never logged</span> },
    { key: 'due', header: 'Due', value: (r) => nextServiceDue(r.item) ?? '',
      // A schedule with no service behind it has no due date to compute. A
      // guessed one would put an engineer's visit in the diary on the strength
      // of arithmetic over a blank field.
      render: (r) => nextServiceDue(r.item) ?? <span className="dash">not knowable yet</span> },
    { key: 'note', header: 'Note', value: (r) => r.item.note ?? '',
      render: (r) => r.item.note ?? <span className="dash">—</span> },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 12 }}>
          <button style={linkBtn} onClick={() => serviced(r.item)}>Serviced today</button>
          {r.item.status === 'in_service'
            ? <button style={linkBtn} onClick={() => pull(r.item)}>Take out</button>
            : null}
        </span>
      ) },
  ];

  return (
    <Section
      title="Due for service"
      sub="Overdue first, then what falls due this week, then anything on a schedule that has never been serviced. Kit with no schedule at all is left out on purpose — that was a decision, not a gap."
    >
      {/* Announced. `msg` on this page only ever holds the outcome of a write
          that was refused; `History` below already banners its own. */}
      {msg ? <p role="alert" aria-live="assertive" aria-atomic="true" style={{ margin: 14, fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
      {unread ? <Unresolved state={unread} what="the equipment register" /> : (
        <DataTable noun="items due for service"
          rows={rows ?? []} columns={cols} rowKey={(r) => r.item.id}
          empty="Nothing is due for service."
        />
      )}
    </Section>
  );
}

/* ── what it costs the timetable ───────────────────────────────────────────── */

/**
 * The class capacity check.
 *
 * Which kit a class needs is nowhere in the database — the timetable asks for
 * it while a class is being typed and does not keep the answer — so the
 * category is chosen here rather than inferred. A guessed link between "HIIT"
 * and "rower" would produce a confident, wrong sentence about a class that
 * needs neither.
 */
function CapacityAtRisk({ kit, classes, zone, kitUnread, classesUnread }: {
  kit: Equipment[] | null; classes: GymClass[] | null;
  /** `tenants.timezone` — the clock the classes below actually run on. */
  zone: string | null;
  kitUnread: Unread; classesUnread: Unread;
}) {
  const [category, setCategory] = useState('');
  const [perStr, setPerStr] = useState('1');

  // Every category the register actually uses, so the operator picks a real
  // word rather than typing one that matches nothing.
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    (kit ?? []).forEach((e) => {
      if (e.status === 'retired' || !e.category) return;
      const key = e.category.toLowerCase().trim();
      if (!seen.has(key)) seen.set(key, e.category);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [kit]);

  // Open on whichever category has most units down, because that is the one
  // costing the timetable seats right now.
  const worst = useMemo(() => {
    let best: string | null = null, most = 0;
    categories.forEach((c) => {
      const of = (kit ?? []).filter((e) => (e.category ?? '').toLowerCase().trim() === c.toLowerCase().trim());
      const d = outOfServiceUnits(of);
      if (d > most) { most = d; best = c; }
    });
    return best ?? categories[0] ?? '';
  }, [categories, kit]);

  const chosen = category || worst;
  const per = Number(perStr);
  const perOk = Number.isFinite(per) && per > 0;

  const check: CapacityCheck | null = kit && chosen && perOk
    // Checked against 0, so `limit` and `usable` come back as the plain facts
    // about the kit rather than a verdict on any one class.
    ? capacityFor(kit, chosen, 0, per)
    : null;

  const uncategorised = (kit ?? []).filter((e) => e.status !== 'retired' && !e.category);

  type Row = { c: GymClass; check: CapacityCheck };
  const rows: Row[] = kit && chosen && perOk
    ? (classes ?? []).map((c) => ({ c, check: capacityFor(kit, chosen, c.capacity, per) }))
    : [];
  const short = rows.filter((r) => r.check.supported === false);

  /**
   * The check the table above cannot make, because it asks about one class at a
   * time.
   *
   * `capacityFor` runs against the gym's whole usable stock independently for
   * every class, so two 6am classes of twelve both came back green on fifteen
   * rowers — each answered as though the other were not on. The second class
   * arrives to a room with no kit in it, and the screen built to prevent that
   * had said the week was fine.
   */
  const concurrent: ConcurrentDemand[] = kit && chosen && perOk
    ? concurrentKitDemand(kit, chosen, (classes ?? []).map((c) => ({
        id: c.id, title: c.title, startsAt: c.startsAt,
        durationMin: c.durationMin, capacity: c.capacity, booked: c.booked,
      })), per)
    : [];
  // Only the groups that cannot all be served. A list of every hour with two
  // classes in it is a list of an ordinary timetable.
  const clashingKit = concurrent.filter((g) => (g.shortIfFull ?? 0) > 0);

  const cols: Column<Row>[] = [
    { key: 'when', header: 'When', value: (r) => r.c.startsAt,
      render: (r) => gymDateTimeText(r.c.startsAt, zone, {
        weekday: 'short', hour: '2-digit', minute: '2-digit',
      }) ?? <span className="dash">not stated</span> },
    { key: 'title', header: 'Class', value: (r) => r.c.title },
    { key: 'room', header: 'Room', value: (r) => r.c.room ?? '',
      render: (r) => r.c.room ?? <span className="dash">—</span> },
    { key: 'stated', header: 'Stated', value: (r) => r.c.capacity, numeric: true },
    // The stated capacity alone made a class with fourteen already booked into
    // eight working rowers look identical to an empty one, so the owner could
    // not see who has to be rung and turned away. Confirmed seats only —
    // waitlisters are demand, not people who will arrive expecting a rower.
    { key: 'booked', header: 'Booked', value: (r) => r.c.booked, numeric: true,
      render: (r) => {
        const overKit = r.check.limit != null && r.c.booked > r.check.limit;
        return r.c.booked === 0
          ? <span className="dash">none yet</span>
          : <span style={{ color: overKit ? 'var(--crit)' : 'var(--ink2)' }}>
              {r.c.booked}{overKit ? ` — ${r.c.booked - r.check.limit!} with no kit` : ''}
            </span>;
      } },
    { key: 'seats', header: 'Kit seats', value: (r) => r.check.limit, numeric: true,
      // Null is "the register cannot answer", which is not zero. Zero would
      // tell an owner the class cannot run on the strength of a form nobody
      // filled in.
      render: (r) => r.check.limit == null
        ? <span className="dash">—</span>
        : <span style={{ color: r.check.supported === false ? 'var(--crit)' : 'var(--ink2)' }}>{r.check.limit}</span> },
    { key: 'note', header: 'What that means', value: (r) => r.check.note ?? '',
      render: (r) => r.check.note ?? <span className="dash">capacity holds</span> },
  ];

  return (
    <Section
      title="What it costs the timetable"
      sub="Classes in the next seven days, checked against one kind of kit. Which kit a class needs is not recorded anywhere, so it is chosen here rather than guessed."
    >
      {kit === null ? (
        <Unresolved state={kitUnread === 'failed' ? 'failed' : 'loading'} what="the equipment register" />
      ) : categories.length === 0 ? (
        <p style={{ padding: '0 14px 14px', margin: 0, color: 'var(--ink3)', fontSize: 12.5 }}>
          Nothing in the register carries a kind, so no class can be checked against it.
          Give the kit a category — "rower", "bike", "rig" — and this becomes answerable.
        </p>
      ) : (
        <>
          <div style={formRow}>
            <select aria-label="Category" value={chosen} onChange={(e) => setCategory(e.target.value)} style={{ ...field, flex: 2 }}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--ink3)', fontSize: 12.5 }}>
              units per person
              <input
                value={perStr} onChange={(e) => setPerStr(e.target.value)}
                inputMode="decimal" style={{ ...field, width: 74 }}
              />
            </label>
          </div>
          {!perOk ? (
            <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
              Units per person must be a number above zero — one rower each is 1,
              a rig two people share is 0.5. Nothing is checked until it is.
            </p>
          ) : (
            <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
              {check
                ? `${check.usable} usable, ${check.down} out of action.`
                : 'Nothing to check.'}
              {' '}
              {short.length > 0
                ? `${short.length} of ${rows.length} classes in the next week seat fewer than they advertise.`
                : rows.length > 0
                  ? clashingKit.length > 0
                    // Never the old sentence while a group is short. Every
                    // class passing on its own is precisely the state that
                    // sentence used to describe as a week with nothing wrong
                    // with it.
                    ? 'Every class is supported on its own — but not when two of them are on at once, below.'
                    : 'Every class in the next week is supported by the kit on the floor, on its own and alongside whatever else is on at the time.'
                  : ''}
            </p>
          )}
          {uncategorised.length > 0 ? (
            <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
              {uncategorised.length === 1 ? '1 item has' : `${uncategorised.length} items have`} no
              kind recorded, so they count towards nothing here — including, possibly, the kit this
              class needs.
            </p>
          ) : null}
          {clashingKit.length > 0 ? (
            <div style={{ margin: '0 14px 14px', border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)', background: 'var(--surface2)' }}>
              <p style={{ margin: 0, padding: '10px 13px 6px', fontSize: 13, color: 'var(--ink2)', maxWidth: '84ch' }}>
                <strong style={{ color: 'var(--ink)' }}>
                  The same {chosen} is promised to more than one class at once.
                </strong>{' '}
                The table below checks each class on its own against the whole of the gym&rsquo;s
                stock, which is the wrong question when two classes are on together — {check?.usable ?? 0} units
                cannot serve both.
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: '0 13px 11px' }}>
                {clashingKit.map((g) => (
                  <li key={g.from} style={{ fontSize: 12.5, color: 'var(--ink2)', padding: '5px 0' }}>
                    <span className="mono" style={{ color: 'var(--ink)' }}>
                      {gymDateTimeText(g.from, zone, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) ?? 'an hour that could not be read'}
                    </span>
                    {' — '}
                    {g.classes.map((c) => `${c.title} (${c.booked} of ${c.capacity})`).join(' and ')}
                    {'. '}
                    {/* Booked first, because that is the number somebody has to
                        ring. A shortfall against stated capacity is a seat that
                        may never sell; a shortfall against bookings is a person
                        who has paid and will be turned away. */}
                    {(g.shortBooked ?? 0) > 0 ? (
                      <span style={{ color: 'var(--crit)' }}>
                        {g.shortBooked} already booked would have no {chosen}.
                      </span>
                    ) : (
                      <span style={{ color: 'var(--warn)' }}>
                        Everyone booked so far is covered; {g.shortIfFull} would not be if both fill.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {classes === null ? (
            <Unresolved state={classesUnread === 'failed' ? 'failed' : 'loading'} what="the coming week's classes" />
          ) : perOk ? (
            <DataTable noun="classes"
              rows={rows} columns={cols} rowKey={(r) => r.c.id}
              empty="No classes on the timetable in the next seven days."
            />
          ) : null}
        </>
      )}
    </Section>
  );
}

/* ── the register itself ───────────────────────────────────────────────────── */

function Register({ rows, unread, today, onChange }: {
  rows: Equipment[] | null; unread: Unread; today: string; onChange: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);

  /** Which machine is being taken out, waiting for a reason. */
  const [pulling, setPulling] = useState<Equipment | null>(null);
  const [why, setWhy] = useState('');
  /**
   * The machine somebody has asked to retire, waiting for them to mean it.
   *
   * Retiring was one click while "Take out" — the milder, reversible one right
   * beside it — demanded a typed reason. So the destructive control was the
   * cheaper of the two, and it is the one that silently changes what this
   * screen says the gym can seat: a retired item leaves `usableUnits`, and the
   * class-capacity check below reads that figure.
   */
  const [retiring, setRetiring] = useState<Equipment | null>(null);

  const move = async (e: Equipment, status: EquipmentStatus, reason?: string) => {
    setMsg(null);
    try {
      await setStatus(supabase, e.id, status, undefined, reason ?? null, today);
      setPulling(null); setWhy('');
      onChange();
    } catch (x: any) {
      setMsg(x?.message ?? 'Could not change that item.');
    }
  };

  const cols: Column<Equipment>[] = [
    { key: 'name', header: 'Item', value: (e) => e.name },
    { key: 'cat', header: 'Kind', value: (e) => e.category ?? '',
      render: (e) => e.category ?? <span className="dash">uncategorised</span> },
    { key: 'id', header: 'Asset', value: (e) => e.identifier ?? '',
      render: (e) => e.identifier ? <span className="mono">{e.identifier}</span> : <span className="dash">—</span> },
    { key: 'qty', header: 'Units', value: (e) => e.quantity, numeric: true },
    { key: 'status', header: 'Status', value: (e) => e.status,
      render: (e) => (
        <span style={{ color: e.status === 'out_of_service' ? 'var(--crit)' : e.status === 'retired' ? 'var(--ink3)' : 'var(--good)' }}>
          {STATUS_WORD[e.status]}
        </span>
      ) },
    { key: 'every', header: 'Serviced every', value: (e) => e.serviceIntervalDays,
      numeric: true,
      // No interval is a gym that decided this kit needs no schedule. Said as
      // such, rather than as a zero-day interval nobody set.
      render: (e) => e.serviceIntervalDays == null
        ? <span className="dash">no schedule</span>
        : `${e.serviceIntervalDays} d` },
    { key: 'last', header: 'Last serviced', value: (e) => e.lastServicedOn ?? '',
      render: (e) => e.lastServicedOn ?? <span className="dash">never logged</span> },
    { key: 'due', header: 'Next due', value: (e) => nextServiceDue(e) ?? '',
      render: (e) => {
        const s = serviceState(e, today);
        const due = nextServiceDue(e);
        if (!due) return <span className="dash">{STATE_WORD[s]}</span>;
        return <span style={{ color: stateColour(s) }}>{due}</span>;
      } },
    { key: 'bought', header: 'Bought', value: (e) => e.purchasedOn ?? '',
      render: (e) => e.purchasedOn ?? <span className="dash">—</span> },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (e) => (
        <span style={{ display: 'inline-flex', gap: 12 }}>
          {/* A reason, asked for at the moment somebody knows it. `setStatus`
              has accepted one since it was written and neither surface ever
              passed it, so every out-of-action machine in the product read
              "no reason recorded" — about a field nothing could fill in. */}
          {e.status === 'in_service'
            ? (pulling?.id === e.id
                ? (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'normal' }}>
                    <input value={why} onChange={(ev) => setWhy(ev.target.value)}
                           placeholder="What is wrong with it"
                           style={{ ...field, padding: '3px 5px', fontSize: 12, width: 210 }}
                           aria-label={`Why ${e.name} is coming out of service`} />
                    <button style={linkBtn} disabled={!why.trim()} onClick={() => move(e, 'out_of_service', why)}>Take out</button>
                    <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => { setPulling(null); setWhy(''); }}>Cancel</button>
                  </span>
                )
                : <button style={linkBtn} onClick={() => { setMsg(null); setPulling(e); setWhy(''); }}>Take out</button>)
            : <button style={linkBtn} onClick={() => move(e, 'in_service')}>Put back</button>}
          {e.status !== 'retired'
            ? (retiring?.id === e.id
                ? (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'normal' }}>
                    <span style={{ fontSize: 12, color: 'var(--ink2)', maxWidth: '34ch' }}>
                      Retire {e.name}? It leaves every capacity figure on this screen,
                      including the class check below.
                    </span>
                    <button style={{ ...linkBtn, color: 'var(--crit)' }}
                            onClick={() => { setRetiring(null); void move(e, 'retired'); }}>
                      Retire it
                    </button>
                    <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => setRetiring(null)}>Cancel</button>
                  </span>
                )
                : <button style={linkBtn} onClick={() => { setMsg(null); setPulling(null); setRetiring(e); }}>Retire</button>)
            : null}
        </span>
      ) },
  ];

  const live = (rows ?? []).filter((e) => e.status !== 'retired');

  return (
    <Section
      title="The register"
      sub={
        rows
          ? `${live.length} items on the floor · ${usableUnits(live)} usable units · ${rows.length - live.length} retired`
          : undefined
      }
    >
      {/* Announced. `msg` on this page only ever holds the outcome of a write
          that was refused; `History` below already banners its own. */}
      {msg ? <p role="alert" aria-live="assertive" aria-atomic="true" style={{ margin: 14, fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
      {unread ? <Unresolved state={unread} what="the equipment register" /> : (
        <DataTable noun="items of equipment"
          rows={rows ?? []} columns={cols} rowKey={(e) => e.id}
          empty="Nothing is registered yet. An empty register is not an empty gym — until it is filled in, no class capacity on this screen can be checked."
        />
      )}
    </Section>
  );
}

/* ── adding kit ────────────────────────────────────────────────────────────── */

function AddKit({ tenantId, onChange }: { tenantId: string; onChange: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [interval, setInterval] = useState('');
  const [lastServiced, setLastServiced] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setMsg('Give the item a name.'); return; }
    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 0) { setMsg('Units must be a whole number, nought or above.'); return; }
    const days = interval.trim() ? parseInt(interval, 10) : null;
    if (days !== null && (!Number.isFinite(days) || days <= 0)) {
      setMsg('A service interval is a number of days above zero. Leave it blank for kit that needs no schedule.');
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await addEquipment(supabase, tenantId, {
        name: name.trim(),
        category: category.trim() || null,
        identifier: identifier.trim() || null,
        quantity: qty,
        serviceIntervalDays: days,
        lastServicedOn: lastServiced || null,
      });
      setName(''); setIdentifier(''); setLastServiced('');
      setMsg('Added.');
      onChange();
    } catch (x: any) {
      setMsg(x?.message ?? 'Could not add that item.');
    } finally { setBusy(false); }
  };

  return (
    <Section
      title="Add kit"
      sub="The kind is what the capacity check matches on, so give it the word the gym actually uses — six rowers registered as one item with six units is the same thing as six items."
    >
      <form onSubmit={add} style={formRow}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item — Concept2 rower" style={{ ...field, flex: 2, minWidth: 150 }} />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Kind — rower" style={{ ...field, width: 130 }} />
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Asset no." style={{ ...field, width: 110 }} />
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Units" inputMode="numeric" style={{ ...field, width: 80 }} />
        <input value={interval} onChange={(e) => setInterval(e.target.value)} placeholder="Service every (days)" style={{ ...field, width: 160 }} inputMode="numeric" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--ink3)', fontSize: 12.5 }}>
          last serviced
          <input type="date" value={lastServiced} onChange={(e) => setLastServiced(e.target.value)} style={{ ...field, width: 155 }} />
        </label>
        <button type="submit" disabled={busy} style={{ ...btn, flex: 'none' }}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>
      {msg ? <p role="alert" aria-live="assertive" aria-atomic="true" style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
    </Section>
  );
}

/* ── shared bits (same shapes as the Door screen) ──────────────────────────── */

const field = {
  padding: '9px 11px', borderRadius: 0, fontSize: 13.5,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const btn = {
  ...field, background: 'var(--brand)', color: 'var(--brand-ink)',
  fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 9, padding: 14, borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

/** Whole days between two YYYY-MM-DD dates, both read as UTC midnight so no
 *  daylight-saving hour can shift the answer by one. Null when either is not a
 *  date — which renders as nothing rather than as "NaN days". */
function daysSince(day: string, today: string): number | null {
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

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

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read used to fall through to the table's own empty line, so "we
 * could not ask" and "the gym has none" were the same sentence on screen —
 * and here that sentence would have been "nothing is out of action".
 */

