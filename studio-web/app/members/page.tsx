'use client';

// Members — one person, and everything the gym knows about them.
//
// /money already administers a membership: it opens one, changes its status and
// records a payment against it. What the console has never had is a member
// *view*. The rows existed — memberships, payments, door visits, class
// bookings, one-to-ones, passes, invites — spread across seven tables, each
// queried by a screen that asks a question about the gym rather than about a
// person. An owner wanting to know how one member is doing had to open five
// screens and hold the answer in their head.
//
// The reason it matters more than tidiness: read the class rows alone and a
// member who moved from the 6am class to the gym floor is indistinguishable
// from a member who stopped coming. Both simply stop appearing. The door log is
// what tells them apart, so it is on this page next to the classes, and
// `retentionRead` in src/lib/memberView.ts says out loud when the two disagree.
//
// Every read is loaded independently and every section renders three states —
// not loaded, loaded and empty, and the read failed — because a failed query
// that draws as an empty record is how a gym concludes a member has paid
// nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchMemberships, fetchPayments, money,
  type Membership, type GymPayment,
} from '@lib/gymRecord';
import { fetchVisits, dwellMinutes, type Visit } from '@lib/gymVisits';
import { fetchClasses } from '@lib/gymSchedule';
import { fetchSessions, type PtSession } from '@lib/gymSessions';
import { fetchPasses, passStatus, remainingUses, type GymPass } from '@lib/gymPasses';
import { fetchInvites, inviteState, type MemberInvite } from '@lib/memberInvites';
import {
  sliceLoading, sliceReady, sliceFailed,
  buildDossiers, retentionRead, doorLogActive, attendanceCaveat,
  partialWarning, brokenParts, completeness,
  DEFAULT_WINDOW_DAYS,
  type Slice, type MemberRecord, type MemberBooking, type MemberDossier,
} from '@lib/memberView';

const DAY = 86400000;
/** How far back the door log, the timetable and the one-to-ones are read. */
const WINDOW_DAYS = 90;

const EMPTY: MemberRecord = {
  memberships: sliceLoading(),
  payments: sliceLoading(),
  visits: sliceLoading(),
  bookings: sliceLoading(),
  sessions: sliceLoading(),
  passes: sliceLoading(),
  invites: sliceLoading(),
};

export default function Members() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [rec, setRec] = useState<MemberRecord>(EMPTY);
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    setRec(EMPTY);
    const sinceIso = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();

    // Seven independent reads, and deliberately not one Promise.all with a
    // single catch. A door log that 500s must not take the payments down with
    // it — the page is allowed to be partial, but only if it says which part.
    const [memberships, payments, visits, bookings, sessions, passes, invites] = await Promise.all([
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchPayments(supabase, tenantId)),
      slice(() => fetchVisits(supabase, tenantId, { sinceIso })),
      slice(() => fetchBookings(tenantId, sinceIso)),
      slice(() => fetchSessions(supabase, tenantId, sinceIso)),
      slice(() => fetchPasses(supabase, tenantId)),
      slice(() => fetchInvites(supabase, tenantId)),
    ]);
    setRec({ memberships, payments, visits, bookings, sessions, passes, invites });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) {
        setRec({
          memberships: sliceReady([]), payments: sliceReady([]), visits: sliceReady([]),
          bookings: sliceReady([]), sessions: sliceReady([]), passes: sliceReady([]),
          invites: sliceReady([]),
        });
        return;
      }
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name').eq('id', who.tenantId).single();
      // supabase-js resolves on a database error, so this is checked rather
      // than assumed: a null name here means "not read", not "unnamed gym".
      if (live) setGymName(tErr ? null : t?.name ?? null);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const dossiers = useMemo(() => buildDossiers(rec), [rec]);
  const active = doorLogActive(rec);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/members">
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
      <Shell me={me} gymName={gymName} current="/members">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          The member record carries payments, so it is owner-only.
        </p>
      </Shell>
    );
  }

  const warning = partialWarning(rec);
  const caveat = attendanceCaveat(rec);
  const chosen = sel && dossiers ? dossiers.find((d) => d.memberId === sel) ?? null : null;

  // The headline this page exists to produce: members whose classes stopped but
  // whose door visits did not. Null while the two reads it needs are missing —
  // a count of zero would claim the gym has nobody in that position.
  const reads = dossiers && rec.visits.state === 'ready' && rec.bookings.state === 'ready'
    ? dossiers.map((d) => ({ d, r: retentionRead(d, { doorLogActive: !!active }) }))
    : null;
  // Both of these are claims ABOUT THE DOOR LOG, so neither survives a door
  // log that is not demonstrably live. retentionRead correctly returns false
  // for everybody when it is silent or unread — which filters to an empty
  // array, which renders as "0". And "0 members are training off the
  // timetable" reads as a finding when the truth is that we cannot tell.
  //
  // A dash reads as a gap. A zero reads as an answer. Only one of those is
  // honest here, and the gym-wide view at /retention gates the same two
  // figures the same way.
  const doorLive = active === true;
  const offTimetable = doorLive ? (reads?.filter((x) => x.r.stillTrainingOffTheTimetable) ?? null) : null;
  const absent = doorLive ? (reads?.filter((x) => x.r.absentFromLiveDoorLog) ?? null) : null;

  return (
    <Shell me={me} gymName={gymName} current="/members">
      <h1>Members</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        The whole record for one person: membership and plan, what they have
        paid, when they were last actually in the building, classes booked
        against classes attended, one-to-ones and passes.
      </p>

      {warning ? <Banner tone="crit">{warning}</Banner> : null}
      {caveat ? <Banner>{caveat}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 8, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="On the roster"
          text={dossiers ? String(dossiers.length) : null}
          note={rec.memberships.state === 'failed' ? 'memberships not read' : undefined}
        />
        <Kpi
          label="Seen this week"
          text={rec.visits.state === 'ready' ? seenWithin(dossiers, 7) : null}
          note={
            rec.visits.state === 'failed' ? 'door log not read'
              : active === false ? 'nothing at the door in 90 days'
              : undefined
          }
        />
        <Kpi
          label="Off the timetable"
          text={offTimetable ? String(offTimetable.length) : null}
          note={
            active === false ? 'no door log, so nobody can be seen instead'
              : active === null ? 'door log not read'
              : offTimetable == null ? 'needs the door log and the bookings'
              : 'stopped booking, still coming in'
          }
        />
        <Kpi
          label="Not through the door"
          text={absent ? String(absent.length) : null}
          note={
            active === false ? 'no door log to judge by'
              : active === null ? 'door log not read'
              : absent == null ? 'needs the door log'
              : `in ${DEFAULT_WINDOW_DAYS} days`
          }
        />
      </div>

      <Roster rec={rec} dossiers={dossiers} reads={reads} sel={sel} onPick={setSel} />

      {chosen ? (
        <Dossier d={chosen} rec={rec} active={active} onClose={() => setSel(null)} />
      ) : (
        <Section title="One member" sub="Pick somebody above to open their record.">
          <p style={{ padding: '26px 20px', margin: 0, color: 'var(--ink3)', fontSize: 13.5 }}>
            {completeness(rec) === 'loading'
              ? 'Loading the record…'
              : 'Nobody selected.'}
          </p>
        </Section>
      )}
    </Shell>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/** Run one read into a slice. The rejection becomes a stated failure rather
 *  than an empty list, which is the difference this whole page turns on. */
async function slice<T>(run: () => Promise<T[]>): Promise<Slice<T>> {
  try {
    return sliceReady(await run());
  } catch (e: any) {
    return sliceFailed(e?.message ?? 'The read failed.');
  }
}

/**
 * Class bookings for the gym's classes in the window, flattened per member.
 *
 * Two plain queries and no embedded select. `fetchClasses` already resolves the
 * timetable and is scoped to the tenant, so the class ids it returns are the
 * scope — asking PostgREST to embed gym_classes from class_bookings is the
 * shape that produced the PGRST201 ambiguity documented in gymSessions.ts, and
 * there is no reason to invite it again.
 *
 * `.error` is checked explicitly: supabase-js resolves on a database error, so
 * without this the page would render "0 classes booked" for every member on the
 * roster and look entirely plausible doing it.
 */
async function fetchBookings(tenantId: string, sinceIso: string): Promise<MemberBooking[]> {
  const classes = await fetchClasses(supabase, tenantId, sinceIso, new Date().toISOString());
  if (!classes.length) return [];
  const byId = new Map(classes.map((c) => [c.id, c]));

  const { data, error } = await supabase
    .from('class_bookings')
    .select('id, class_id, user_id, status, attended_at')
    .in('class_id', [...byId.keys()]);
  if (error) throw error;

  return (data ?? []).map((r: any) => {
    const c = byId.get(r.class_id);
    return {
      bookingId: r.id,
      memberId: r.user_id,
      classId: r.class_id,
      classTitle: c?.title ?? null,
      startsAt: c?.startsAt ?? '',
      status: r.status ?? 'booked',
      attendedAt: r.attended_at ?? null,
    };
  });
}

/* ── the roster ────────────────────────────────────────────────────────────── */

type Read = { d: MemberDossier; r: ReturnType<typeof retentionRead> };

function Roster({ rec, dossiers, reads, sel, onPick }: {
  rec: MemberRecord;
  dossiers: MemberDossier[] | null;
  reads: Read[] | null;
  sel: string | null;
  onPick: (id: string) => void;
}) {
  const readFor = useMemo(
    () => new Map((reads ?? []).map((x) => [x.d.memberId, x.r])),
    [reads],
  );

  const cols: Column<MemberDossier>[] = [
    {
      key: 'name', header: 'Member', value: (d) => d.name ?? '￿',
      render: (d) => (
        <button
          onClick={() => onPick(d.memberId)}
          style={{ ...linkBtn, fontWeight: sel === d.memberId ? 700 : 400 }}
        >
          {d.name ?? <span className="dash">unnamed account</span>}
        </button>
      ),
    },
    { key: 'plan', header: 'Plan', value: (d) => d.planName },
    {
      key: 'status', header: 'Status', value: (d) => d.status,
      render: (d) => d.status
        ? <span style={{ textTransform: 'capitalize' }}>{d.status}</span>
        : <span className="dash">—</span>,
    },
    {
      key: 'seen', header: 'Last at the door', value: (d) => d.lastSeenDays ?? null, numeric: true,
      render: (d) => <Cell state={rec.visits.state} value={
        d.lastSeenDays == null ? null : d.lastSeenDays === 0 ? 'today' : `${d.lastSeenDays}d ago`
      } empty="never" />,
    },
    {
      key: 'classes', header: 'Classes', value: (d) => d.attended ?? null, numeric: true,
      render: (d) => <Cell state={rec.bookings.state} value={
        d.booked == null || d.booked === 0 ? null : `${d.attended} / ${d.booked}`
      } empty="none booked" />,
    },
    {
      key: 'paid', header: 'Paid', value: (d) => d.paidCents ?? null, numeric: true,
      render: (d) => <Cell state={rec.payments.state} value={money(d.paidCents)} empty="nothing recorded" />,
    },
    {
      key: 'read', header: 'Door vs timetable', value: (d) => {
        const r = readFor.get(d.memberId);
        return r?.stillTrainingOffTheTimetable ? 2 : r?.absentFromLiveDoorLog ? 1 : 0;
      },
      render: (d) => {
        const r = readFor.get(d.memberId);
        if (!r) return <span className="dash">not judged</span>;
        if (r.stillTrainingOffTheTimetable) {
          return <span style={{ color: 'var(--brand)' }}>still training, off the timetable</span>;
        }
        if (r.absentFromLiveDoorLog) return <span style={{ color: 'var(--crit)' }}>not seen</span>;
        return <span className="dash">—</span>;
      },
    },
  ];

  return (
    <Section
      title="Roster"
      sub={`Everyone who holds or has held a membership. The last column is the door log answering a question the timetable cannot.`}
    >
      {rec.memberships.state === 'loading' ? <Loading /> : null}
      {rec.memberships.state === 'failed' ? (
        <Failed reason={(rec.memberships as { reason: string }).reason}
                what="the membership list" />
      ) : null}
      {dossiers ? (
        <DataTable
          rows={dossiers} columns={cols} rowKey={(d) => d.memberId}
          empty="No memberships recorded yet. Open one under Money and this page fills in."
        />
      ) : null}
    </Section>
  );
}

/* ── one member ────────────────────────────────────────────────────────────── */

function Dossier({ d, rec, active, onClose }: {
  d: MemberDossier; rec: MemberRecord; active: boolean | null; onClose: () => void;
}) {
  const r = rec.visits.state === 'ready' && rec.bookings.state === 'ready'
    ? retentionRead(d, { doorLogActive: !!active })
    : null;

  const broken = brokenParts(rec);

  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)', display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <h2 style={{ flex: 1 }}>{d.name ?? <span className="dash">Unnamed account</span>}</h2>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink3)' }}>{d.memberId}</span>
        <button onClick={onClose} style={linkBtn}>Close</button>
      </div>

      {broken.length ? (
        <p style={{ margin: 0, padding: '11px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 12.5 }}>
          This record is incomplete: {broken.map((b) => b.label).join(', ')} could not be read,
          so {broken.map((b) => b.cost).join(', ')} {broken.length === 1 ? 'is' : 'are'} absent
          below rather than nil.
        </p>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', borderBottom: '1px solid var(--ring)',
        }}
      >
        <Kpi label="Membership" text={d.status ? cap(d.status) : null}
             note={d.planName ?? (rec.memberships.state === 'failed' ? 'not read' : 'no plan attached')} />
        <Kpi label="Paid, all time" text={money(d.paidCents)}
             note={
               rec.payments.state === 'failed' ? 'payments not read'
                 : d.lastPaidAt ? `last ${new Date(d.lastPaidAt).toLocaleDateString()}`
                 : 'nothing recorded'
             } />
        <Kpi
          label="Last at the door"
          text={
            rec.visits.state !== 'ready' ? null
              : d.lastSeenDays == null ? null
              : d.lastSeenDays === 0 ? 'today' : `${d.lastSeenDays} days`
          }
          note={
            rec.visits.state === 'failed' ? 'door log not read'
              : rec.visits.state === 'loading' ? undefined
              : d.lastSeenDays == null ? `no visit in ${WINDOW_DAYS} days`
              : `${d.floorVisits} on the floor, ${d.classVisits} at a class`
          }
        />
        <Kpi
          label="Class attendance"
          text={d.showRate == null ? null : `${Math.round(d.showRate * 100)}%`}
          note={
            rec.bookings.state === 'failed' ? 'bookings not read'
              : d.booked === 0 ? 'booked nothing in the window'
              : d.booked == null ? undefined
              : `${d.attended} of ${d.booked} booked`
          }
        />
        <Kpi
          label="One-to-ones"
          text={d.delivered == null ? null : String(d.delivered)}
          note={
            rec.sessions.state === 'failed' ? 'sessions not read'
              : d.unmarked ? `${d.unmarked} still unmarked`
              : d.noShows ? `${d.noShows} no-show${d.noShows === 1 ? '' : 's'}`
              : undefined
          }
        />
        <Kpi
          label="Pass visits left"
          text={d.passVisitsLeft == null ? null : String(d.passVisitsLeft)}
          note={rec.passes.state === 'failed' ? 'passes not read' : undefined}
        />
      </div>

      {r?.note ? (
        <p style={{
          margin: 0, padding: '13px 14px', borderBottom: '1px solid var(--ring)',
          fontSize: 13, color: 'var(--ink2)',
          borderLeft: `3px solid ${r.stillTrainingOffTheTimetable ? 'var(--brand)' : 'var(--ring)'}`,
        }}>
          {r.note}
        </p>
      ) : null}
      {r == null ? (
        <p style={{ margin: 0, padding: '13px 14px', borderBottom: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink3)' }}>
          The door-log reading needs both the visits and the bookings. One of
          them is unavailable, so no verdict is offered here — an attendance
          drop on the timetable alone cannot tell a member who moved to the
          floor from one who stopped coming.
        </p>
      ) : null}

      <Part title="Memberships" slice={rec.memberships} what="memberships">
        {d.memberships ? (
          <DataTable
            rows={d.memberships}
            columns={[
              { key: 'plan', header: 'Plan', value: (m: Membership) => m.planName },
              { key: 'from', header: 'Started', value: (m: Membership) => m.startedOn },
              { key: 'to', header: 'Ends', value: (m: Membership) => m.endsOn },
              { key: 'status', header: 'Status', value: (m: Membership) => m.status },
            ]}
            rowKey={(m: Membership) => m.id}
            empty="No membership has ever been opened for this person."
          />
        ) : null}
      </Part>

      <Part title="Payments" slice={rec.payments} what="payments">
        {d.payments ? (
          <DataTable
            rows={d.payments}
            columns={[
              { key: 'when', header: 'Taken', value: (p: GymPayment) => p.takenAt,
                render: (p: GymPayment) => new Date(p.takenAt).toLocaleDateString() },
              { key: 'amt', header: 'Amount', value: (p: GymPayment) => p.amountCents, numeric: true,
                render: (p: GymPayment) => money(p.amountCents, p.currency) },
              { key: 'how', header: 'Method', value: (p: GymPayment) => p.method.replace('_', ' ') },
              { key: 'note', header: 'Note', value: (p: GymPayment) => p.note },
            ]}
            rowKey={(p: GymPayment) => p.id}
            empty="No payment has been recorded against this member."
          />
        ) : null}
      </Part>

      <Part title={`Door log — last ${WINDOW_DAYS} days`} slice={rec.visits} what="the door log">
        {d.visits ? (
          <DataTable
            rows={d.visits}
            columns={[
              { key: 'in', header: 'In', value: (v: Visit) => v.enteredAt,
                render: (v: Visit) => new Date(v.enteredAt).toLocaleString() },
              { key: 'stay', header: 'Stay', value: (v: Visit) => dwellMinutes(v) ?? null, numeric: true,
                render: (v: Visit) => {
                  const m = dwellMinutes(v);
                  return m == null ? <span className="dash">no exit</span> : `${m} min`;
                } },
              { key: 'why', header: 'For', value: (v: Visit) => (v.classId ? 'class' : 'gym floor') },
              { key: 'via', header: 'Via', value: (v: Visit) => v.source },
            ]}
            rowKey={(v: Visit) => v.id}
            empty={`Not once through the door in ${WINDOW_DAYS} days.`}
          />
        ) : null}
      </Part>

      <Part title="Classes booked and attended" slice={rec.bookings} what="class bookings">
        {d.bookings ? (
          <DataTable
            rows={d.bookings}
            columns={[
              { key: 'when', header: 'When', value: (b: MemberBooking) => b.startsAt,
                render: (b: MemberBooking) => b.startsAt
                  ? new Date(b.startsAt).toLocaleString()
                  : <span className="dash">—</span> },
              { key: 'what', header: 'Class', value: (b: MemberBooking) => b.classTitle },
              { key: 'status', header: 'Booking', value: (b: MemberBooking) => b.status },
              { key: 'came', header: 'Turned up', value: (b: MemberBooking) => b.attendedAt,
                render: (b: MemberBooking) => b.attendedAt
                  ? 'yes'
                  // Never "no": an unticked booking may be a class nobody took
                  // a register for, which is not the member's absence.
                  : <span className="dash">not marked</span> },
            ]}
            rowKey={(b: MemberBooking) => b.bookingId}
            empty={`No class booked in the last ${WINDOW_DAYS} days.`}
          />
        ) : null}
      </Part>

      <Part title="One-to-ones" slice={rec.sessions} what="one-to-ones">
        {d.sessions ? (
          <DataTable
            rows={d.sessions}
            columns={[
              { key: 'when', header: 'When', value: (s: PtSession) => s.startsAt,
                render: (s: PtSession) => new Date(s.startsAt).toLocaleString() },
              { key: 'who', header: 'Trainer', value: (s: PtSession) => s.trainerName },
              { key: 'out', header: 'Outcome', value: (s: PtSession) => s.outcome,
                render: (s: PtSession) => s.outcome
                  ? s.outcome.replace('_', ' ')
                  : <span className="dash">not recorded</span> },
              { key: 'rate', header: 'Rate', value: (s: PtSession) => s.rateCents ?? null, numeric: true,
                render: (s: PtSession) => s.rateCents == null
                  ? <span className="dash">—</span>
                  : money(s.rateCents) },
            ]}
            rowKey={(s: PtSession) => s.id}
            empty={`No one-to-one in the last ${WINDOW_DAYS} days.`}
          />
        ) : null}
      </Part>

      <Part title="Passes" slice={rec.passes} what="passes">
        {d.passes ? (
          <DataTable
            rows={d.passes}
            columns={[
              { key: 'type', header: 'Pass', value: (p: GymPass) => p.passTypeName },
              { key: 'from', header: 'Issued', value: (p: GymPass) => p.issuedOn },
              { key: 'left', header: 'Left', value: (p: GymPass) => remainingUses(p), numeric: true,
                render: (p: GymPass) => `${remainingUses(p)} / ${p.usesTotal}` },
              { key: 'paid', header: 'Paid', value: (p: GymPass) => p.paidCents ?? null, numeric: true,
                render: (p: GymPass) => p.paidCents == null
                  ? <span className="dash">not recorded</span>
                  : money(p.paidCents, p.currency) },
              { key: 'state', header: 'Status',
                value: (p: GymPass) => passStatus(p, new Date().toISOString().slice(0, 10)) },
            ]}
            rowKey={(p: GymPass) => p.id}
            empty="No pass has ever been issued to this member."
          />
        ) : null}
      </Part>

      <Invites d={d} rec={rec} />
    </section>
  );
}

/** Invites are addressed to an email, not to an account, so they cannot be
 *  filtered by member id. Shown whole and labelled, rather than guessed at. */
function Invites({ d, rec }: { d: MemberDossier; rec: MemberRecord }) {
  const mine = (d.invites ?? []).filter((i) => i.acceptedBy === d.memberId);
  return (
    <Part title="Invite" slice={rec.invites} what="invites">
      {d.invites ? (
        <DataTable
          rows={mine}
          columns={[
            { key: 'to', header: 'Sent to', value: (i: MemberInvite) => i.email },
            { key: 'plan', header: 'Plan', value: (i: MemberInvite) => i.planName },
            { key: 'when', header: 'Sent', value: (i: MemberInvite) => i.createdAt,
              render: (i: MemberInvite) => new Date(i.createdAt).toLocaleDateString() },
            { key: 'state', header: 'State', value: (i: MemberInvite) => inviteState(i) },
          ]}
          rowKey={(i: MemberInvite) => i.id}
          empty="This member holds no invite record — they were added directly."
        />
      ) : null}
    </Part>
  );
}

/* ── the three states, once ────────────────────────────────────────────────── */

/**
 * A section that cannot lie about which of the three states it is in.
 *
 * `loading` says loading, `failed` says what broke and what is therefore
 * missing, and `ready` hands over to the table — whose own empty state is a
 * sentence about the record rather than a blank.
 */
function Part<T>({ title, slice, what, children }: {
  title: string;
  slice: Slice<T>;
  what: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--ring)' }}>
      <div style={{ padding: '11px 14px' }}>
        <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>{title}</h3>
      </div>
      {slice.state === 'loading' ? <Loading /> : null}
      {slice.state === 'failed' ? <Failed reason={slice.reason} what={what} /> : null}
      {/* Loaded-and-empty is the DataTable's own empty sentence, written once
          per section beside the columns it describes. */}
      {slice.state === 'ready' ? children : null}
    </div>
  );
}

function Failed({ reason, what }: { reason: string; what: string }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '0 14px 14px', borderRadius: 8,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {what}. This section is <strong>unknown</strong>, not empty.
      <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{reason}</div>
    </div>
  );
}

/** A table cell that keeps "not read", "not loaded" and "nothing there" apart. */
function Cell({ state, value, empty }: {
  state: Slice<unknown>['state']; value: string | null; empty: string;
}) {
  if (state === 'loading') return <span className="dash">…</span>;
  if (state === 'failed') return <span className="dash">not read</span>;
  if (value == null) return <span className="dash">{empty}</span>;
  return <>{value}</>;
}

/* ── shared bits (same shapes as the Money and Door screens) ───────────────── */

/** How many of the roster were through the door inside `days`.
 *
 *  Only ever called with a door log that was actually read: zero here means
 *  "nobody came in", and it would mean "the query failed" if the caller did not
 *  check the slice state first. */
function seenWithin(dossiers: MemberDossier[] | null, days: number): string | null {
  if (!dossiers) return null;
  return String(dossiers.filter((d) => d.lastSeenDays != null && d.lastSeenDays <= days).length);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)', textAlign: 'left' as const,
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
