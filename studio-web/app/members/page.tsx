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
import { amount, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchMemberships, fetchPayments, money,
  type Membership, type GymPayment,
} from '@lib/gymRecord';
import { fetchVisits, dwellMinutes, type Visit } from '@lib/gymVisits';
import { fetchClasses } from '@lib/gymSchedule';
import { readByIds } from '@lib/idLookup';
import { fetchSessions, type PtSession } from '@lib/gymSessions';
import { fetchPasses, passStatus, remainingUses, type GymPass } from '@lib/gymPasses';
import { fetchInvites, inviteState, type MemberInvite } from '@lib/memberInvites';
import {
  fetchMemberRecords, saveMemberRecord, byMember, parseTags, tagsText,
  contactLine, searchableFields, isEmptyPatch,
  type GymMemberRecord, type MemberRecordPatch,
} from '@lib/gymMembers';
import { searchRows, searchNote } from '@lib/consoleSearch';
import {
  buildSegments, segmentCsv, postToSegment, reachBlocker, deliveryNote,
  willTruncateInbox, MAX_BODY, INBOX_BODY,
  type Segment, type SegmentId, type SegmentMember,
} from '@lib/gymReach';
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
  // `tenants.currency`. The payment ROWS below carry their own currency and use
  // it; the two figures that SUM them across a member's history have none of
  // their own, and inherit the gym's rather than a default.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  const [rec, setRec] = useState<MemberRecord>(EMPTY);
  const [sel, setSel] = useState<string | null>(null);
  /**
   * What the GYM knows about each person: contact, next of kin, an operational
   * medical note, tags and the desk's own note. Held beside `rec` rather than
   * inside it because `MemberRecord` is `src/lib/memberView.ts`'s shape and this
   * screen is not that module's only reader.
   *
   * Null is "not read or refused", never an empty Map. An owner told "no
   * emergency contact" for a member who has one — because the query failed —
   * will not go and ask again.
   */
  const [gymRecs, setGymRecs] = useState<Map<string, GymMemberRecord> | null>(null);
  const [gymRecsErr, setGymRecsErr] = useState<string | null>(null);
  // One search box over the roster. There was none anywhere in this console,
  // and this is the screen the six-hundred-member roster lives on.
  const [q, setQ] = useState('');

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

    // Read after the seven above rather than beside them, and separately, so a
    // gym that has not applied part 197 yet — where this table does not exist —
    // gets one stated failure on one section instead of a page that will not
    // load. Everything else on this screen is unaffected by it.
    try {
      setGymRecs(byMember(await fetchMemberRecords(supabase, tenantId)));
      setGymRecsErr(null);
    } catch (e: any) {
      setGymRecs(null);
      setGymRecsErr(e?.message ?? 'The gym’s own notes on your members could not be read.');
    }
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
        .from('tenants').select('name, currency').eq('id', who.tenantId).single();
      // supabase-js resolves on a database error, so this is checked rather
      // than assumed: a null name here means "not read", not "unnamed gym".
      if (live) {
        setGymName(tErr ? null : t?.name ?? null);
        setCcy(tErr ? null : ((((t as any)?.currency ?? '') as string).trim().toUpperCase() || null));
      }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const dossiers = useMemo(() => buildDossiers(rec), [rec]);
  const active = doorLogActive(rec);

  /**
   * Deep-link one member.
   *
   * /retention names a drifting member and links to /members with no id, so the
   * owner lands on an unselected roster and hunts by eye. There are no dynamic
   * segments anywhere in `studio-web`, and adding `/members/[id]` would mean a
   * second page that re-reads all seven slices for one person.
   *
   * A query parameter does the whole job: `?member=<uuid>` selects on arrival,
   * and picking somebody rewrites the URL so the link in the address bar is
   * always the link to what is on screen. `replaceState`, not `pushState` — a
   * roster where every click adds a Back-button step is worse than one that
   * does not.
   *
   * Read straight off `location` rather than through `useSearchParams`, which
   * under Next 15 forces the whole page into a Suspense boundary for one string.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('member');
    if (id) setSel(id);
  }, []);

  const pick = useCallback((id: string | null) => {
    setSel(id);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('member', id);
    else url.searchParams.delete('member');
    window.history.replaceState(null, '', url.toString());
  }, []);

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
  // Non-null after the role gate above: this screen refuses anybody without a
  // tenant long before it reaches a write.
  const tenantId = me.tenantId!;
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
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
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

      {gymRecsErr ? (
        <Banner>
          The gym’s own notes on your members could not be read: {gymRecsErr}. Contact details, next
          of kin and any medical note are <strong style={{ color: 'var(--ink)' }}>unknown</strong> below
          rather than absent — do not conclude a member has no emergency contact from this screen
          while this line is showing.
        </Banner>
      ) : null}

      <Reach
        dossiers={dossiers} doorLogLive={doorLive} me={me} tenantId={tenantId}
        gymName={gymName} gymRecs={gymRecs}
      />

      <Roster
        rec={rec} dossiers={dossiers} reads={reads} sel={sel} onPick={pick} ccy={ccy}
        gymRecs={gymRecs} query={q} onQuery={setQ}
      />

      {chosen ? (
        <Dossier
          d={chosen} rec={rec} active={active} onClose={() => pick(null)} ccy={ccy}
          gymRec={gymRecs?.get(chosen.memberId) ?? null} gymRecsRead={gymRecs !== null}
          tenantId={tenantId} me={me} onSaved={() => load(tenantId)}
        />
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

  // Paginated and chunked, not capped. Two separate ceilings sit on this read
  // and neither one is allowed to be silent.
  //
  // PostgREST stops at 1000 rows and says nothing (src/lib/rowCap.ts), and a
  // truncated bookings read here is not a smaller figure: every member whose
  // rows fell off the end reports nothing booked and nothing attended, which is
  // the exact false statement the `.error` check above exists to prevent,
  // arriving by another door. The `.in(...)` filter travels in the query
  // string, so a thousand class ids is a forty-kilobyte URL the gateway
  // rejects — a loud failure, but not one to discover in production.
  //
  // Both are `readByIds`' job now (src/lib/idLookup.ts). It was this loop,
  // written out here and again on /retention, and the chunk size lived in two
  // consts that had to agree; a third and fourth copy were about to be written
  // for the name lookups on /accounting and /close, which needed the same
  // treatment once their reads started paging.
  const rows = await readByIds<any>(
    byId.keys(),
    (chunk, from, to) => supabase
      .from('class_bookings')
      .select('id, class_id, user_id, status, attended_at')
      .in('class_id', chunk)
      // A total order. Postgres promises nothing about the order of rows that
      // tie, and each page is a separate request — so paging over a non-unique
      // order can drop rows, silently, which would put this read straight back
      // where it started.
      .order('id', { ascending: true })
      .range(from, to),
    'the class bookings in this window',
  );

  return rows.map((r: any) => {
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

function Roster({ rec, dossiers, reads, sel, onPick, ccy, gymRecs, query, onQuery }: {
  rec: MemberRecord;
  dossiers: MemberDossier[] | null;
  reads: Read[] | null;
  sel: string | null;
  onPick: (id: string) => void;
  ccy: TenantCurrency;
  gymRecs: Map<string, GymMemberRecord> | null;
  query: string;
  onQuery: (q: string) => void;
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
      // `amount`, not `money`. This column sums a member's payments and has no
      // row currency of its own, so `money()` wrote "AED" over it — while the
      // payments table inside the same dossier prints each row with its real
      // currency. One member's money, shown two ways, on one screen.
      render: (d) => (
        <Cell
          state={rec.payments.state}
          value={amount(d.paidCents, ccy)}
          empty={d.paidCents != null && !ccy ? NO_CURRENCY_NOTE : 'nothing recorded'}
        />
      ),
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

  // Searchable on everything the gym holds about a person, not only their name:
  // a phone number, a tag, the plan, the desk's own note. That is the whole
  // point of `gym_member_records` existing — an owner looking for "the student
  // on Bronze who left a number" has one box to type it into.
  const shown = useMemo(
    () => searchRows(dossiers ?? [], query, (d) => [
      d.name, d.planName, d.status, d.memberId,
      ...searchableFields(gymRecs?.get(d.memberId) ?? null),
    ]),
    [dossiers, query, gymRecs],
  );
  const note = searchNote(query, shown.length, dossiers?.length ?? 0);

  return (
    <Section
      title="Roster"
      sub={`Everyone who holds or has held a membership. The last column is the door log answering a question the timetable cannot.`}
    >
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '12px 14px 0', flexWrap: 'wrap' }}>
        <input
          value={query} onChange={(e) => onQuery(e.target.value)}
          placeholder="Search a name, a plan, a tag or a phone number"
          aria-label="Search the roster"
          style={{ ...field, flex: 1, minWidth: 240 }}
        />
        {query ? <button onClick={() => onQuery('')} style={linkBtn}>clear</button> : null}
      </div>
      {/* Above the table, because the failure being guarded against is a
          filtered table read as a roster with nobody on it. */}
      {note ? (
        <p style={{ margin: 0, padding: '8px 14px 0', fontSize: 12.5, color: 'var(--ink3)' }}>{note}</p>
      ) : null}
      {rec.memberships.state === 'loading' ? <Loading /> : null}
      {rec.memberships.state === 'failed' ? (
        <Failed reason={(rec.memberships as { reason: string }).reason}
                what="the membership list" />
      ) : null}
      {dossiers ? (
        <DataTable
          rows={shown} columns={cols} rowKey={(d) => d.memberId}
          empty="No memberships recorded yet. Open one under Money and this page fills in."
        />
      ) : null}
    </Section>
  );
}

/* ── one member ────────────────────────────────────────────────────────────── */

function Dossier({ d, rec, active, onClose, ccy, gymRec, gymRecsRead, tenantId, me, onSaved }: {
  d: MemberDossier; rec: MemberRecord; active: boolean | null; onClose: () => void;
  ccy: TenantCurrency;
  gymRec: GymMemberRecord | null;
  /** False when the gym-side records did not read. An empty form under a failed
   *  read invites the owner to retype an emergency contact that is already
   *  stored, over the top of one they cannot see. */
  gymRecsRead: boolean;
  tenantId: string;
  me: Me;
  onSaved: () => void;
}) {
  const r = rec.visits.state === 'ready' && rec.bookings.state === 'ready'
    ? retentionRead(d, { doorLogActive: !!active })
    : null;

  const broken = brokenParts(rec);

  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
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
        <Kpi label="Paid, all time" text={amount(d.paidCents, ccy)}
             note={
               rec.payments.state === 'failed' ? 'payments not read'
                 : d.paidCents != null && !ccy ? NO_CURRENCY_NOTE
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
          note={rec.passes.state === 'failed' ? 'passes not read' : 'door and classes only'}
        />
        {/* Counted apart from pass visits, because they buy different things: a
            PT credit pays for an hour with a coach and opens no turnstile. The
            note names the hour this gym delivered and took nothing for, which
            is the one line on this record somebody has to act on. */}
        <Kpi
          label="PT credits left"
          text={d.ptCreditsLeft == null ? null : String(d.ptCreditsLeft)}
          note={
            rec.passes.state === 'failed' ? 'passes not read'
              : rec.sessions.state === 'failed' ? 'one-to-ones not read'
              : d.ptShortfalls ? `${d.ptShortfalls} delivered with nothing to draw` : undefined
          }
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
              // Three answers, not two. `gym_visits` carries both `class_id`
              // and `pass_id` — 32-door-log.sql added them together "so the two
              // records reconcile instead of double counting the same person" —
              // and this column collapsed the pass case into "gym floor",
              // because until the Door screen was fixed no console visit ever
              // carried either id and the third answer could not occur. It can
              // now, and a visit somebody paid a drop-in fee for is not a
              // member wandering onto the floor: it is the row that reconciles
              // against the pass ledger.
              { key: 'why', header: 'For',
                value: (v: Visit) => (v.classId ? 'class' : v.passId ? 'on a pass' : 'gym floor') },
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
                  : (amount(s.rateCents, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>) },
              // What the MEMBER paid with, which is a different question from
              // the Rate beside it: that is what the gym owes the coach. A
              // shortfall is the two of them disagreeing — an hour costed,
              // delivered, and covered by nothing.
              { key: 'paid', header: 'Covered by', value: (s: PtSession) => s.packDrawnKind ?? (s.packDrawShortfallAt ? 'zz' : ''),
                render: (s: PtSession) => s.packDrawShortfallAt
                  ? <span style={{ color: 'var(--warn)' }}>nothing left to draw</span>
                  : s.packDrawnKind === 'gym_pass' ? 'a gym PT pass'
                  : s.packDrawnKind === 'coach_pack' ? 'their coach’s pack'
                  : s.outcome === 'completed'
                    ? <span className="dash">settled directly</span>
                    : <span className="dash">nothing drawn yet</span> },
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
              // Two passes with the same name and the same count buy different
              // things. Without this column the desk cannot tell which.
              { key: 'covers', header: 'Good for', value: (p: GymPass) => p.covers,
                render: (p: GymPass) => p.covers === 'pt' ? 'personal training'
                  : p.covers === 'visit' ? 'door and classes'
                  : <span className="dash">the pass type could not be read</span> },
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

      <GymRecordEditor
        memberId={d.memberId} name={d.name} rec={gymRec} read={gymRecsRead}
        tenantId={tenantId} me={me} onSaved={onSaved}
      />

      <Invites d={d} rec={rec} />
    </section>
  );
}

/* ── what the gym itself knows ─────────────────────────────────────────────── */

/**
 * The gym's own record of one person: how to reach them, who to ring, what the
 * floor needs to know, and the desk's note.
 *
 * ── Why this section is the first write on this screen ────────────────────
 *
 * /members was 786 lines with zero inserts and zero updates: its own empty
 * state sent the owner to /money. And the columns it would have written did not
 * exist — grep the schema for a member's phone number, their next of kin or a
 * note the desk wrote and there is nothing at all. `memberships.note` is the
 * closest thing, and it is attached to the CONTRACT, so it is thrown away the
 * moment somebody upgrades from Bronze to Gold.
 *
 * ── Two things it is careful about ────────────────────────────────────────
 *
 * `read = false` disables the form rather than showing it empty. An empty form
 * over a failed read is an invitation to retype an emergency contact that is
 * already stored — and to overwrite it with less than was there.
 *
 * The whole form saves as ONE patch, and `saveMemberRecord` only sends the keys
 * it is given. That matters because the row is shared: a note typed here must
 * not blank a phone number somebody entered at the desk five minutes ago.
 */
function GymRecordEditor({ memberId, name, rec, read, tenantId, me, onSaved }: {
  memberId: string; name: string | null; rec: GymMemberRecord | null; read: boolean;
  tenantId: string; me: Me; onSaved: () => void;
}) {
  const [phone, setPhone] = useState(rec?.phone ?? '');
  const [email, setEmail] = useState(rec?.email ?? '');
  const [eName, setEName] = useState(rec?.emergencyName ?? '');
  const [ePhone, setEPhone] = useState(rec?.emergencyPhone ?? '');
  const [medical, setMedical] = useState(rec?.medicalNote ?? '');
  const [note, setNote] = useState(rec?.note ?? '');
  const [tags, setTags] = useState(tagsText(rec?.tags));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Re-seeded when the selected member changes. Without this, opening a second
  // member shows the first one's phone number in the box — and saving it files
  // one person's contact details against another.
  useEffect(() => {
    setPhone(rec?.phone ?? ''); setEmail(rec?.email ?? '');
    setEName(rec?.emergencyName ?? ''); setEPhone(rec?.emergencyPhone ?? '');
    setMedical(rec?.medicalNote ?? ''); setNote(rec?.note ?? '');
    setTags(tagsText(rec?.tags)); setMsg(null);
  }, [memberId, rec]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch: MemberRecordPatch = {
      phone, email, emergencyName: eName, emergencyPhone: ePhone,
      medicalNote: medical, note, tags: parseTags(tags),
    };
    // An all-blank form on a person with no record would write a row that says
    // nothing and then read back as "a record exists".
    if (!rec && isEmptyPatch(patch)) {
      setMsg('Nothing to save yet — fill something in first.');
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await saveMemberRecord(supabase, tenantId, memberId, patch, me.id ?? null);
      setMsg('Saved.');
      onSaved();
    } catch (x: any) {
      setMsg(x?.message ?? 'That was not saved, so the record is unchanged.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ borderBottom: '1px solid var(--ring)' }}>
      <div style={{ padding: '11px 14px' }}>
        <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>What the gym knows</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
          Kept against the PERSON rather than against a membership, so it survives a lapse and a
          rejoin — the moment it is hardest to recollect. Staff on the floor can read it; only an
          owner can write it. It is not {name ?? 'this member'}&rsquo;s own injury record: that is
          theirs, is written by them, and nothing here touches it.
        </p>
      </div>

      {!read ? (
        <p style={{ margin: 0, padding: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          These could not be read, so the form is closed rather than shown empty. An empty form here
          is an invitation to retype a contact that is already stored — over the top of one you
          cannot see. Reload before entering anything.
        </p>
      ) : (
        <form onSubmit={save} style={{ display: 'grid', gap: 8, padding: '0 14px 14px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone"
                   aria-label="Member phone" style={{ ...field, flex: 1, minWidth: 150 }} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
                   aria-label="Member email" inputMode="email" style={{ ...field, flex: 2, minWidth: 190 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="In an emergency, ring…"
                   aria-label="Emergency contact name" style={{ ...field, flex: 2, minWidth: 190 }} />
            <input value={ePhone} onChange={(e) => setEPhone(e.target.value)} placeholder="Their number"
                   aria-label="Emergency contact number" style={{ ...field, flex: 1, minWidth: 150 }} />
          </div>
          <input value={medical} onChange={(e) => setMedical(e.target.value)}
                 placeholder="What the floor needs to know — e.g. asthma, inhaler in their bag"
                 aria-label="Operational medical note" style={field} />
          <input value={note} onChange={(e) => setNote(e.target.value)}
                 placeholder="The desk’s note about this member"
                 aria-label="Desk note" style={field} />
          <input value={tags} onChange={(e) => setTags(e.target.value)}
                 placeholder="Tags — student, corporate, do not call"
                 aria-label="Tags" style={field} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" disabled={busy} style={btn}>{busy ? 'Saving…' : 'Save'}</button>
            {rec?.updatedAt ? (
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
                last changed {new Date(rec.updatedAt).toLocaleDateString()}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>nothing recorded yet</span>
            )}
          </div>
          {msg ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
        </form>
      )}
    </div>
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
      padding: '16px 14px', margin: '0 14px 14px', borderRadius: 0,
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

/* The same input and button shapes as the Door and Money screens. This page had
 * no form of any kind until now — it was 786 lines with zero writes. */
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

/* ── reaching members as a group ───────────────────────────────────────────── */

/**
 * Say something to a group of members, from the console.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Nothing, on this surface. The only broadcast in the whole product is
 * `app/(owner)/ops.tsx` — phone-only, members-only, no targeting — and
 * `app/(owner)/promotions.tsx`, which pushes to `all_member_ids()`. So an owner
 * sitting at the desk looking at eleven people who have not been in for six
 * weeks could say nothing to those eleven people, and the tool they did have
 * could only shout at everybody.
 *
 * ── Why the recipients are shown before the box ───────────────────────────
 *
 * Because a broadcast is irreversible and its blast radius is the one thing a
 * sender must not have to infer. The count, the definition of the group, and
 * the first names in it are all on screen above the text area, and the button
 * says the number again.
 *
 * ── What it does not do, out loud ─────────────────────────────────────────
 *
 * No push — the Expo token plumbing lives in the phone app and a second, weaker
 * copy of it here would be a switch whose promise nothing keeps. No scheduling
 * — nothing in this repository records anybody's timezone, so "it goes out in
 * the morning" is a promise no code here could honour. No email — that needs a
 * list model, an unsubscribe path and consent tracking, none of which exist, so
 * the export hands the list to whatever the gym already uses.
 */
function Reach({ dossiers, doorLogLive, me, tenantId, gymName, gymRecs }: {
  dossiers: MemberDossier[] | null;
  doorLogLive: boolean;
  me: Me;
  tenantId: string;
  gymName: string | null;
  gymRecs: Map<string, GymMemberRecord> | null;
}) {
  const [segId, setSegId] = useState<SegmentId>('unseen');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const segments: Segment[] | null = useMemo(() => {
    if (!dossiers) return null;
    const rows: SegmentMember[] = dossiers.map((d) => ({
      memberId: d.memberId,
      name: d.name,
      status: d.status,
      lastSeenDays: d.lastSeenDays,
    }));
    return buildSegments(rows, { doorLogLive });
  }, [dossiers, doorLogLive]);

  const seg = segments?.find((x) => x.id === segId) ?? null;
  const blocker = seg ? reachBlocker(body, seg.members.length) : null;

  const send = async () => {
    if (!seg || !me.id) return;
    const stop = reachBlocker(body, seg.members.length);
    if (stop) { setMsg(stop); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await postToSegment(supabase, {
        tenantId,
        authorId: me.id,
        body,
        memberIds: seg.members.map((m) => m.memberId),
        gymName,
      });
      setMsg(deliveryNote(res, seg.members.length));
      // Cleared only on a success. The words stay in the box after a refusal:
      // they were written once, and a cleared field after a failed send is how
      // a notice is lost between the owner and the server.
      setBody('');
    } catch (e: any) {
      setMsg(e?.message ?? 'Nothing was posted, so nobody has seen it. Your words are still here.');
    } finally { setBusy(false); }
  };

  const download = () => {
    if (!seg) return;
    const csv = segmentCsv(seg, (id) => {
      const r = gymRecs?.get(id) ?? null;
      return { email: r?.email ?? null, phone: r?.phone ?? null };
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${seg.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!segments) return null;

  return (
    <Section
      title="Say something to a group"
      sub="Posts to the gym’s notice board and drops it in the chosen members’ inboxes. No push and no scheduling — the console can send neither, and says so rather than implying otherwise."
    >
      {!open ? (
        <p style={{ margin: 0, padding: '16px 14px', fontSize: 13, color: 'var(--ink3)' }}>
          <button onClick={() => setOpen(true)} style={linkBtn}>Write to a group</button>
          {' — '}
          {segments.map((x) => `${x.label.toLowerCase()} (${x.members.length})`).join(' · ')}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10, padding: 14 }}>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {segments.map((x) => (
              <button
                key={x.id}
                onClick={() => setSegId(x.id)}
                style={{
                  ...field, cursor: 'pointer',
                  background: x.id === segId ? 'var(--surface3)' : 'var(--surface2)',
                  color: x.id === segId ? 'var(--ink)' : 'var(--ink2)',
                }}
              >
                {x.label} · {x.members.length}
              </button>
            ))}
          </div>

          {seg ? (
            <>
              {/* The definition, always, beside the count. "Unseen: 34" without
                  it is a number people argue with — and when the door log is
                  silent this sentence is the only thing standing between an
                  owner and a winback sent to their entire roster. */}
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>{seg.note}</p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink2)' }}>
                {seg.members.length === 0
                  ? 'Nobody is in this group.'
                  : <>
                      Goes to <strong style={{ color: 'var(--ink)' }}>{seg.members.length}</strong>{' '}
                      {seg.members.length === 1 ? 'person' : 'people'}:{' '}
                      {seg.members.slice(0, 6).map((m) => m.name ?? 'unnamed').join(', ')}
                      {seg.members.length > 6 ? ` and ${seg.members.length - 6} more` : ''}.
                    </>}
              </p>

              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                maxLength={MAX_BODY}
                placeholder="What do you want to tell them?"
                aria-label="The message"
                style={{ ...field, resize: 'vertical' }}
              />
              {/* `notify_users` stores `left(v_body, 500)` and does not complain.
                  Better said here than discovered by a member reading half a
                  sentence. */}
              {willTruncateInbox(body) ? (
                <p style={{ margin: 0, fontSize: 12.5, color: '#f0c04e' }}>
                  The inbox copy is cut at {INBOX_BODY} characters by the database and yours is{' '}
                  {body.trim().length}. The full text stays on the notice board; the inbox line will
                  stop mid-sentence.
                </p>
              ) : null}
              {blocker ? <p style={{ margin: 0, fontSize: 12.5, color: '#f0c04e' }}>{blocker}</p> : null}

              <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                <button onClick={send} disabled={busy || !!blocker} style={btn}>
                  {busy ? 'Posting…' : `Post to ${seg.members.length}`}
                </button>
                <button onClick={download} disabled={seg.members.length === 0} style={ghostBtn}>
                  Export this group
                </button>
                <button onClick={() => { setOpen(false); setMsg(null); }} style={ghostBtn}>Close</button>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ink3)' }}>
                Export hands the list — with whatever phone number and address the gym has recorded
                — to the mailing tool you already use. There is no email sender in this product, and
                no unsubscribe register, so nothing here pretends to run a campaign.
              </p>
              {msg ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink2)' }}>{msg}</p> : null}
            </>
          ) : null}
        </div>
      )}
    </Section>
  );
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
