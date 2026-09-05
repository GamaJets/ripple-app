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
import { supabase, writeFailed, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { amount, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { DataTable, type Column } from '@/components/DataTable';
import { Banner as SharedBanner, Announce } from '@/components/Banner';
import { Fetched, useFetched } from '@/components/Fetched';
import { slicesLanded } from '@lib/readLanded';
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
// Totals that never cross a currency. /analytics solves the same problem with
// the same function; this tile used a bare `reduce` and the gym's current code.
import { paidTotal, paidNote } from '@lib/gymPaidTotal';
import { wrote, refused, sayText, sayTone, type Said } from '@lib/consoleSay';
import { isoDate } from '@lib/format';
// The reader's locale, the GYM's zone. Every date on a member's record — a
// payment, a door visit, a booking, an invite — was drawn on whichever laptop
// was open, so the same member's last visit read as two different days at two
// desks in two countries.
import { gymDateText, gymDateTimeText } from '@lib/gymWhen';
import { gymDay, parseGymZone } from '@lib/gymZone';
import {
  fetchMemberNotes, addMemberNote, noteBlocker, withLegacy, noteAttribution, MAX_NOTE,
  type MemberNote,
} from '@lib/memberNotes';
import { logBroadcast, loggingNote } from '@lib/gymBroadcastLog';
import {
  buildSegments, segmentCsv, postToSegment, reachBlocker, deliveryNote,
  willTruncateInbox, MAX_BODY, INBOX_BODY,
  type Segment, type SegmentId, type SegmentMember,
} from '@lib/gymReach';
import {
  sliceLoading, sliceReady, sliceFailed,
  // The four-arm note. Every tile below was a hand-written two-arm version —
  // `state === 'failed' ? 'x not read' : <an affirmative claim>` — so a
  // TRUNCATED read fell into the affirmative arm and this page told an owner
  // "no visit in 90 days" and "no plan attached" about rows it had simply not
  // read. Those two sentences are acted on: one is why a member gets a
  // win-back call, the other is why somebody goes looking for a missing plan.
  sliceNote,
  buildDossiers, retentionRead, doorLogActive, attendanceCaveat,
  partialWarning, truncationWarning, brokenParts, completeness,
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
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  // `tenants.currency`. The payment ROWS below carry their own currency and use
  // it; the two figures that SUM them across a member's history have none of
  // their own, and inherit the gym's rather than a default.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);
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

  const load = useCallback(async (tenantId: string): Promise<boolean> => {
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
    let recsLanded = true;
    try {
      setGymRecs(byMember(await fetchMemberRecords(supabase, tenantId)));
      setGymRecsErr(null);
    } catch (e: any) {
      recsLanded = false;
      setGymRecs(null);
      setGymRecsErr(e?.message ?? 'The gym’s own notes on your members could not be read.');
    }

    // Whole means all eight reads answered. `useFetched` stamps only on a whole
    // read, so a refresh that lost the door log leaves the stamp where it was
    // and the section's own banner is what says which read is missing —
    // counting what the server confirmed, not what was sent. A TRUNCATED slice
    // still counts as an answer: see src/lib/readLanded.ts, and the truncation
    // has a banner of its own.
    return recsLanded && slicesLanded([
      memberships, payments, visits, bookings, sessions, passes, invites,
    ]);
  }, []);

  /**
   * Kept current, and it says when it was last read.
   *
   * The whole roster in one read, and every figure on it is one a member of
   * staff acts on: who is overdue, who has not been in for six weeks, whose
   * pass has run out. A console left open on the front desk answered about the
   * moment the tab was opened and did not say which moment that was — so
   * "last in 41 days ago" was read at nine in the morning and believed at four
   * in the afternoon, after the person had walked past the desk.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId ? load(me.tenantId) : Promise.resolve(false)),
  );

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
      if (!who?.tenantId) {
        setRec({
          memberships: sliceReady([]), payments: sliceReady([]), visits: sliceReady([]),
          bookings: sliceReady([]), sessions: sliceReady([]), passes: sliceReady([]),
          invites: sliceReady([]),
        });
        return;
      }
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name, currency, timezone').eq('id', who.tenantId).single();
      // supabase-js resolves on a database error, so this is checked rather
      // than assumed: a null name here means "not read", not "unnamed gym".
      if (live) {
        setGymName(tErr ? null : t?.name ?? null);
        setCcy(tErr ? null : ((((t as any)?.currency ?? '') as string).trim().toUpperCase() || null));
        const z = tErr ? { kind: 'clear' as const } : parseGymZone((t as any)?.timezone);
        setZone(z.kind === 'zone' ? z.zone : null);
      }
    })();
    return () => { live = false; };
    // Identity and the gym record only. The eight reads are fired by the effect
    // below, through `refresh`, so the first read stamps exactly like every
    // later one.
  }, []);

  // The first read. Keyed on the tenant id rather than fired at the end of the
  // effect above: `useFetched` holds the reader in a ref assigned during
  // RENDER, so calling `refresh()` in the same tick as `setMe(who)` would run
  // the closure from the previous render — the one where `me` is still
  // undefined — and answer `false` without having read anything.
  useEffect(() => {
    if (me?.tenantId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId]);

  /** The instant these eight reads landed, and the one every dossier is judged
   *  at. `buildDossiers` defaults its `now`, and this memo is keyed on the rows
   *  alone — so "last in 41 days ago" and every unmarked-session count under it
   *  were frozen at the render that first built them, on a roster screen that is
   *  left open all day at a front desk. */
  const nowMs = readAt ?? Date.now();

  const dossiers = useMemo(() => buildDossiers(rec, nowMs), [rec, nowMs]);
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

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

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
  // A separate sentence from the one above, deliberately. "We could not read the
  // door log" and "we read the first thousand visits of more" are two different
  // states of this page and a reader acts on them differently: the first is a
  // fault to chase, the second is a figure to stop quoting.
  const cut = truncationWarning(rec);
  const caveat = attendanceCaveat(rec);
  // The gym's own calendar day. /door judges every pass against this and this
  // screen judged the same passes against the UTC date, so for the four hours
  // between local and UTC midnight the two screens gave a member two different
  // answers about the same pass.
  //
  // The reader's own day was the second half of that same bug, and it is now
  // the FALLBACK rather than the answer: a pass expires at the end of a day AT
  // THE GYM, so an owner checking from Sydney was told a pass had run out while
  // the member was standing at the turnstile with hours left on it. `isoDate`
  // is kept for the gym that has not set a timezone, where the reader's clock
  // is the only clock there is.
  //
  // And judged at the INSTANT this page read, like every dossier beside it.
  // `dossiers` above is built at `nowMs`; a bare `Date.now()` here is a second
  // clock on one screen, and the two disagree for as long as the tab has been
  // open — a pass whose last day is today reading as expired in the Status
  // column while the dossier around it is still answering about the read.
  const today = gymDay(nowMs, zone) ?? isoDate(new Date(nowMs));
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

      <Fetched at={readAt} busy={reading} onRefresh={refresh}
               what="this roster" style={{ margin: '2px 0 16px' }} />

      {warning ? <Banner tone="crit">{warning}</Banner> : null}
      {cut ? <Banner tone="crit">{cut}</Banner> : null}
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
          note={sliceNote(rec.memberships, 'the membership list') ?? undefined}
        />
        <Kpi
          label="Seen this week"
          text={rec.visits.state === 'ready' ? seenWithin(dossiers, 7) : null}
          note={
            rec.visits.state !== 'ready' ? sliceNote(rec.visits, 'the door log') ?? undefined
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
          today={today} zone={zone}
          gymRec={gymRecs?.get(chosen.memberId) ?? null} gymRecsRead={gymRecs !== null}
          tenantId={tenantId} me={me} onSaved={refresh}
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
      // Grouped by currency before it is totalled, and refusing where that is
      // more than one. It was `amount(d.paidCents, ccy)` — every payment added
      // together and labelled with the gym's CURRENT setting — while the
      // payments table inside the dossier prints each row with the currency it
      // was actually taken in. One member's money, shown two ways, on one
      // screen, and the wrong one is the one an owner quotes down the phone.
      render: (d) => {
        const t = paidTotal(rec.payments.state, d.payments);
        return (
          <Cell
            state={rec.payments.state}
            value={t.kind === 'one' ? money(t.minorUnits, t.currency) : null}
            empty={paidNote(t) ?? 'nothing recorded'}
          />
        );
      },
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
      {/* `dossiers` is null under a truncated read too — `rowsOf` withholds a
          prefix — so this section rendered its heading over nothing at all and
          said not one word about why. A headed, empty roster reads as a gym
          with no members. */}
      {rec.memberships.state === 'partial' ? (
        <Truncated what="the membership list" cap={rec.memberships.cap} />
      ) : null}
      {dossiers ? (
        <DataTable noun="members"
          rows={shown} columns={cols} rowKey={(d) => d.memberId}
          empty="No memberships recorded yet. Open one under Money and this page fills in."
        />
      ) : null}
    </Section>
  );
}

/* ── one member ────────────────────────────────────────────────────────────── */

function Dossier({ d, rec, active, onClose, ccy, today, zone, gymRec, gymRecsRead, tenantId, me, onSaved }: {
  d: MemberDossier; rec: MemberRecord; active: boolean | null; onClose: () => void;
  ccy: TenantCurrency;
  /** `tenants.timezone`, or null when the gym has not set one. Every date in
   *  this record is drawn on it. */
  zone: string | null;
  /** The gym's own calendar day, which is what a pass expiry is compared
   *  against here and on /door. Passed in rather than computed twice. */
  today: string;
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

  /**
   * What this member has paid, per currency.
   *
   * `d.paidCents` deliberately goes unused. It is a sum over `p.amountCents`
   * with no regard to `p.currency`, and a sum across two currencies is not a
   * total — it is a bigger number with the gym's current three letters stamped
   * on it. `paidTotal` groups first and refuses second.
   */
  const paid = useMemo(
    () => paidTotal(rec.payments.state, d.payments),
    [rec.payments.state, d.payments],
  );

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
             note={d.planName ?? sliceNote(rec.memberships, 'the membership list') ?? 'no plan attached'} />
        {/* ── one tile, one currency ─────────────────────────────────────
            This was `amount(d.paidCents, ccy)`, where `paidCents` is
            `pays.reduce((a, p) => a + p.amountCents, 0)` — every payment added
            together with no regard to `p.currency` — and `ccy` is the gym's
            CURRENT setting. So a gym that has ever changed currency showed one
            tile reading AED 4,300 over a list of GBP and AED rows, three
            inches below, each rendered honestly with its own code. This tile
            is the figure an owner quotes down the phone when a member queries
            their account.

            `sumTaken` groups on the normalised currency before it totals
            anything, which is what /analytics already does with the same
            problem. One pot prints; two pots is not a bigger number and gets
            the sentence instead. */}
        <Kpi
          label="Paid, all time"
          text={paid.kind === 'one' ? money(paid.minorUnits, paid.currency) ?? null : null}
          note={paidNote(paid, d.lastPaidAt ? `last ${gymDateText(d.lastPaidAt, zone) ?? 'on a date that could not be read'}` : undefined)}
        />
        <Kpi
          label="Last at the door"
          text={
            rec.visits.state !== 'ready' ? null
              : d.lastSeenDays == null ? null
              : d.lastSeenDays === 0 ? 'today' : `${d.lastSeenDays} days`
          }
          note={
            rec.visits.state !== 'ready' ? sliceNote(rec.visits, 'the door log') ?? undefined
              : d.lastSeenDays == null ? `no visit in ${WINDOW_DAYS} days`
              : `${d.floorVisits} on the floor, ${d.classVisits} at a class`
          }
        />
        <Kpi
          label="Class attendance"
          text={d.showRate == null ? null : `${Math.round(d.showRate * 100)}%`}
          note={
            rec.bookings.state !== 'ready' ? sliceNote(rec.bookings, 'the class bookings') ?? undefined
              : d.booked === 0 ? 'booked nothing in the window'
              : d.booked == null ? undefined
              : `${d.attended} of ${d.booked} booked`
          }
        />
        <Kpi
          label="One-to-ones"
          text={d.delivered == null ? null : String(d.delivered)}
          note={
            rec.sessions.state !== 'ready' ? sliceNote(rec.sessions, 'the sessions') ?? undefined
              : d.unmarked ? `${d.unmarked} still unmarked`
              : d.noShows ? `${d.noShows} no-show${d.noShows === 1 ? '' : 's'}`
              : undefined
          }
        />
        <Kpi
          label="Pass visits left"
          text={d.passVisitsLeft == null ? null : String(d.passVisitsLeft)}
          note={sliceNote(rec.passes, 'the passes') ?? 'door and classes only'}
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
          <DataTable noun="memberships"
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
          <DataTable noun="payments"
            rows={d.payments}
            columns={[
              { key: 'when', header: 'Taken', value: (p: GymPayment) => p.takenAt,
                render: (p: GymPayment) => gymDateText(p.takenAt, zone) ?? <span className="dash">not stated</span> },
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
          <DataTable noun="visits"
            rows={d.visits}
            columns={[
              { key: 'in', header: 'In', value: (v: Visit) => v.enteredAt,
                render: (v: Visit) => gymDateTimeText(v.enteredAt, zone) ?? <span className="dash">not stated</span> },
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
          <DataTable noun="class bookings"
            rows={d.bookings}
            columns={[
              { key: 'when', header: 'When', value: (b: MemberBooking) => b.startsAt,
                render: (b: MemberBooking) => gymDateTimeText(b.startsAt, zone) ?? <span className="dash">—</span> },
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
          <DataTable noun="one-to-one sessions"
            rows={d.sessions}
            columns={[
              { key: 'when', header: 'When', value: (s: PtSession) => s.startsAt,
                render: (s: PtSession) => gymDateTimeText(s.startsAt, zone) ?? <span className="dash">not stated</span> },
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
          <DataTable noun="passes"
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
              // `today` — the GYM's calendar day — and not
              // `new Date().toISOString().slice(0, 10)`, which is UTC's. This
              // product sells in AED, so the UTC date does not turn over until
              // 04:00 local: for those four hours every evening this table
              // called a pass expired that /door, which has always compared
              // against the local day, was still admitting on. One pass, two
              // expiry dates, and the two screens disagreeing about whether a
              // member may come in.
              { key: 'state', header: 'Status', value: (p: GymPass) => passStatus(p, today) },
            ]}
            rowKey={(p: GymPass) => p.id}
            empty="No pass has ever been issued to this member."
          />
        ) : null}
      </Part>

      <GymRecordEditor
        memberId={d.memberId} name={d.name} rec={gymRec} read={gymRecsRead} zone={zone}
        tenantId={tenantId} me={me} onSaved={onSaved}
      />

      <Notes
        memberId={d.memberId} name={d.name} legacy={gymRec?.note ?? null}
        gymRecsRead={gymRecsRead} tenantId={tenantId} me={me} zone={zone}
      />

      <Invites d={d} rec={rec} zone={zone} />
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
function GymRecordEditor({ memberId, name, rec, read, zone, tenantId, me, onSaved }: {
  memberId: string; name: string | null; rec: GymMemberRecord | null; read: boolean;
  /** `tenants.timezone`, or null when the gym has not set one. */
  zone: string | null;
  tenantId: string; me: Me; onSaved: () => void;
}) {
  const [phone, setPhone] = useState(rec?.phone ?? '');
  const [email, setEmail] = useState(rec?.email ?? '');
  const [eName, setEName] = useState(rec?.emergencyName ?? '');
  const [ePhone, setEPhone] = useState(rec?.emergencyPhone ?? '');
  const [medical, setMedical] = useState(rec?.medicalNote ?? '');
  const [tags, setTags] = useState(tagsText(rec?.tags));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Said>(null);

  // Re-seeded when the selected member changes. Without this, opening a second
  // member shows the first one's phone number in the box — and saving it files
  // one person's contact details against another.
  useEffect(() => {
    setPhone(rec?.phone ?? ''); setEmail(rec?.email ?? '');
    setEName(rec?.emergencyName ?? ''); setEPhone(rec?.emergencyPhone ?? '');
    setMedical(rec?.medicalNote ?? '');
    setTags(tagsText(rec?.tags)); setMsg(null);
  }, [memberId, rec]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // `note` is deliberately absent, and absent is not null: `saveMemberRecord`
    // only sends the keys it is given, so the one-line note this form used to
    // overwrite is left exactly as it is. Notes are written in the section
    // below now, where they carry an author and a date and cannot be typed over.
    const patch: MemberRecordPatch = {
      phone, email, emergencyName: eName, emergencyPhone: ePhone,
      medicalNote: medical, tags: parseTags(tags),
    };
    // An all-blank form on a person with no record would write a row that says
    // nothing and then read back as "a record exists".
    if (!rec && isEmptyPatch(patch)) {
      setMsg(refused('Nothing to save yet — fill something in first.'));
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await saveMemberRecord(supabase, tenantId, memberId, patch, me.id ?? null);
      setMsg(wrote('Saved.'));
      onSaved();
    } catch (x: any) {
      setMsg(writeFailed(x, {
        what: 'That record',
        unchanged: 'the record is unchanged',
        howToCheck: 'Reload this page: the boxes above are filled from whatever is actually stored.',
      }));
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

      {/* Mounted for as long as this form is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text — which is the case screen readers handle
          inconsistently. See studio-web/components/Banner.tsx. */}
      <Announce say={sayText(msg)} tone={sayTone(msg)} />

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
          <input value={tags} onChange={(e) => setTags(e.target.value)}
                 placeholder="Tags — student, corporate, do not call"
                 aria-label="Tags" style={field} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" disabled={busy} style={btn}>{busy ? 'Saving…' : 'Save'}</button>
            {rec?.updatedAt ? (
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
                last changed {gymDateText(rec.updatedAt, zone) ?? 'on a date that could not be read'}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>nothing recorded yet</span>
            )}
          </div>
          {msg ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>{msg.text}</p> : null}
        </form>
      )}
    </div>
  );
}

/* ── what the desk wrote, and when, and who wrote it ───────────────────────── */

/**
 * The running list of notes about one member.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * A single text input, written in place. "She complained about the 6am in
 * March" was gone the moment somebody typed "renewing in June" over it — no
 * author, no date, no history and no undo, on the record an owner would reach
 * for in a dispute. The box above no longer writes that column at all; it is
 * still shown, at the bottom of this list, labelled for what it is.
 *
 * ── Read here rather than with the other seven ────────────────────────────
 *
 * Because it is per-member and the page reads per-gym. Fetching every note in
 * the gym to show one member's is a bigger read that gets slower for the gyms
 * that use the feature most. The cost is that this section has its own three
 * states, which it renders itself.
 */
function Notes({ memberId, name, legacy, gymRecsRead, tenantId, me, zone }: {
  memberId: string;
  name: string | null;
  /** The one-line note from `gym_member_records`, which predates this list. */
  legacy: string | null;
  /** False when that record could not be read — so the legacy line below is
   *  unknown rather than absent, and this section has to say which. */
  gymRecsRead: boolean;
  tenantId: string;
  me: Me;
  /** `tenants.timezone`, or null when the gym has not set one. The date under
   *  each note is the day the desk wrote it, which is a fact about the gym and
   *  not about whichever laptop is open — a note written at 01:00 in Dubai read
   *  from London is dated the previous day, on the one record an owner reaches
   *  for when the day a thing was written on is what is being disputed. */
  zone: string | null;
}) {
  const [notes, setNotes] = useState<MemberNote[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Said>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setNotes(await fetchMemberNotes(supabase, tenantId, memberId));
    } catch (e: any) {
      // Null, never []. A read that failed drawn as "no notes yet" is how an
      // owner concludes nothing was ever written about a member.
      setNotes(null);
      setFailed(e?.message ?? 'The notes could not be read.');
    }
  }, [tenantId, memberId]);

  useEffect(() => { setNotes(null); setBody(''); setMsg(null); void load(); }, [load]);

  const blocker = noteBlocker(body);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker) { setMsg(refused(blocker)); return; }
    setBusy(true); setMsg(null);
    try {
      await addMemberNote(supabase, tenantId, memberId, body, me.id ?? null);
      setBody('');
      setMsg(wrote('Added. It carries your name and the time, and nothing can type over it.'));
      await load();
    } catch (x: any) {
      // The words stay in the box on a failure: they were written once.
      setMsg(refused(x?.message, 'That note was not saved, so it is not on the record.'));
    } finally { setBusy(false); }
  };

  const shown = notes ? withLegacy(notes, memberId, gymRecsRead ? legacy : null) : null;

  return (
    <div style={{ borderBottom: '1px solid var(--ring)' }}>
      <div style={{ padding: '11px 14px' }}>
        <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>Notes</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
          Appended, never overwritten. Each one keeps who wrote it and when, and none of them can be
          edited or deleted afterwards — a note somebody can quietly rewrite is worth nothing in the
          argument it exists for. Correct one by writing another.
        </p>
      </div>

      {/* Mounted for as long as this form is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text — which is the case screen readers handle
          inconsistently. See studio-web/components/Banner.tsx. */}
      <Announce say={sayText(msg)} tone={sayTone(msg)} />

      <form onSubmit={add} style={{ display: 'grid', gap: 8, padding: '0 14px 14px' }}>
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)}
          rows={2} maxLength={MAX_NOTE}
          placeholder={`What happened, in your own words${name ? ` — about ${name}` : ''}`}
          aria-label="Add a note about this member"
          style={{ ...field, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" disabled={busy || !!blocker} style={{ ...btn, opacity: blocker ? 0.5 : 1 }}>
            {busy ? 'Adding…' : 'Add note'}
          </button>
          {msg ? <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>{msg.text}</span> : null}
        </div>
      </form>

      {failed ? <Failed reason={failed} what="the notes on this member" /> : null}
      {notes === null && !failed ? <Loading /> : null}
      {shown ? (
        shown.length === 0 ? (
          <p style={{ margin: 0, padding: '0 14px 16px', fontSize: 13, color: 'var(--ink3)' }}>
            Nothing has been written about {name ?? 'this member'} yet.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: '0 14px 14px', display: 'grid', gap: 9 }}>
            {shown.map((n) => (
              <li
                key={n.id ?? 'legacy'}
                style={{
                  border: '1px solid var(--ring)', background: 'var(--surface2)', padding: '9px 11px',
                  // The unattributed line is drawn as what it is rather than
                  // mixed in with the entries that carry a name.
                  borderLeft: n.legacy ? '3px solid var(--ring2)' : '3px solid var(--brand)',
                }}
              >
                <p style={{ margin: 0, fontSize: 13, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{n.body}</p>
                <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--ink3)' }}>
                  {noteAttribution(n, zone)}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** Invites are addressed to an email, not to an account, so they cannot be
 *  filtered by member id. Shown whole and labelled, rather than guessed at. */
function Invites({ d, rec, zone }: { d: MemberDossier; rec: MemberRecord; zone: string | null }) {
  const mine = (d.invites ?? []).filter((i) => i.acceptedBy === d.memberId);
  return (
    <Part title="Invite" slice={rec.invites} what="invites">
      {d.invites ? (
        <DataTable noun="invites"
          rows={mine}
          columns={[
            { key: 'to', header: 'Sent to', value: (i: MemberInvite) => i.email },
            { key: 'plan', header: 'Plan', value: (i: MemberInvite) => i.planName },
            { key: 'when', header: 'Sent', value: (i: MemberInvite) => i.createdAt,
              render: (i: MemberInvite) => gymDateText(i.createdAt, zone) ?? <span className="dash">not stated</span> },
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
      {slice.state === 'partial' ? <Truncated what={what} cap={slice.cap} /> : null}
      {/* Loaded-and-empty is the DataTable's own empty sentence, written once
          per section beside the columns it describes. */}
      {slice.state === 'ready' ? children : null}
    </div>
  );
}


/**
 * The banner over a section whose read came back at its ceiling.
 *
 * The rows are real and there are more of them, so this is neither the failure
 * banner nor the empty sentence. It does not draw the table beneath it: every
 * figure on this screen is computed through `rowsOf`, which is null for a
 * truncated read on purpose, so the table under this banner would be an empty
 * one — "cut off" over "nothing recorded" is a worse page than the banner
 * alone. A section that means to LIST a prefix reads its rows through
 * `rowsToShow` and says so itself.
 */
function Truncated({ what, cap }: { what: string; cap: number }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '0 14px 14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--warn)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Read the first {cap} rows of {what}, and there are more. This section is a{' '}
      <strong>prefix</strong>, not the whole record, so nothing here is counted or totalled.
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

/** A table cell that keeps "not read", "not loaded", "part read" and "nothing
 *  there" apart — four states, four cells. */
function Cell({ state, value, empty }: {
  state: Slice<unknown>['state']; value: string | null; empty: string;
}) {
  if (state === 'loading') return <span className="dash">…</span>;
  if (state === 'failed') return <span className="dash">not read</span>;
  // The rows behind this figure are a prefix, so the figure over them is a
  // subtotal. Withheld, and named as something other than a failure.
  if (state === 'partial') return <span className="dash">part read</span>;
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
  const [msg, setMsg] = useState<Said>(null);
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
    if (stop) { setMsg(refused(stop)); return; }
    setBusy(true); setMsg(null);
    try {
      const memberIds = seg.members.map((m) => m.memberId);
      const res = await postToSegment(supabase, {
        tenantId,
        authorId: me.id,
        body,
        memberIds,
        gymName,
      });
      // Written AFTER the send and never before it, exactly as the export log
      // below is written after the file exists: a row saying a message went to
      // forty people, when it did not, is a false statement about what forty
      // members were told.
      //
      // The announcement itself carries the author and the words. What it does
      // not carry — and what nothing in this schema carried — is WHO IT WENT
      // TO: `notify_users` returns a count and writes rows that point back at
      // no announcement. That is the half this row exists for.
      const logErr = await logBroadcast(supabase, {
        tenantId,
        sentBy: me.id,
        segmentId: seg.id,
        segmentLabel: seg.label,
        memberIds,
        delivered: res.delivered,
        body,
      });
      // `wrote`, not `refused`, even when `logErr` is set: the post HAPPENED.
      // A logging gap is a gap in the record of it, said in the same breath —
      // announcing it assertively would tell the sender their message did not
      // go out, which is the one thing that is not true here.
      setMsg(wrote([deliveryNote(res, seg.members.length), loggingNote(logErr)]
        .filter((x): x is string => !!x).join(' ')));
      // Cleared only on a success. The words stay in the box after a refusal:
      // they were written once, and a cleared field after a failed send is how
      // a notice is lost between the owner and the server.
      setBody('');
    } catch (e: any) {
      // A notice sent twice is two notifications to every member of a segment,
      // which is the one failure this form can produce that reaches people
      // outside the gym.
      setMsg(writeFailed(e, {
        what: 'That notice',
        unchanged: 'nobody has seen it, and your words are still here',
        howToCheck: 'Reload this page and read the list of sent notices below before posting it again.',
      }));
    } finally { setBusy(false); }
  };

  /**
   * The list, and the row that records it leaving.
   *
   * ── Why this writes to gym_export_runs ────────────────────────────────
   *
   * This button writes every selected member's name, membership, email and
   * phone number to disk in one click, and it used to write nothing anywhere
   * else. `/export` — the slow, deliberate, owner-only path — logs every bundle
   * it produces, so the product's answer to "has anybody taken the members off
   * this platform" was drawn entirely from the route nobody uses in a hurry.
   * The unaudited path was the fast one, which is the wrong way round: the
   * question a data-protection officer asks is not which screen it came from.
   *
   * So the same table, the same shape, and the same ORDER. The row is written
   * AFTER the file exists, never before — a log entry for a download that never
   * happened is a false statement about personal data having left the platform,
   * and it is exactly the kind a regulator reads as evidence.
   *
   * `scope` is 'gym' and not 'member' even when the group holds one person. A
   * member-scoped row means "this person's own record was produced", which is
   * usually a subject-access response with a deadline attached; a contact list
   * that happens to be one row long is not that, and logging it as one would
   * put a request in the register that nobody ever made.
   */
  const download = async () => {
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
    await logRosterExport(me, tenantId, seg);
  };

  if (!segments) return null;

  return (
    <Section
      title="Say something to a group"
      sub="Posts to the gym’s notice board and drops it in the chosen members’ inboxes. No push and no scheduling — the console can send neither, and says so rather than implying otherwise."
    >
      {/* Mounted for as long as this form is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text — which is the case screen readers handle
          inconsistently. See studio-web/components/Banner.tsx. */}
      <Announce say={sayText(msg)} tone={sayTone(msg)} />
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
              // `aria-pressed` — which group a message is being written to was
              // carried by a background colour alone.
              <button
                key={x.id}
                type="button"
                aria-pressed={x.id === segId}
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
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--warn)' }}>
                  The inbox copy is cut at {INBOX_BODY} characters by the database and yours is{' '}
                  {body.trim().length}. The full text stays on the notice board; the inbox line will
                  stop mid-sentence.
                </p>
              ) : null}
              {blocker ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--warn)' }}>{blocker}</p> : null}

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
                no unsubscribe register, so nothing here pretends to run a campaign. Taking it is
                recorded, with who took it, when, and how many people were on it: the same record
                the full export writes, because a route out of the console is a route out of the
                console whichever screen it is on. Posting is recorded the same way — who sent it,
                the words, and the members it was addressed to — because a message in dozens of
                inboxes that nothing can trace is the same gap pointing the other way.
              </p>
              {msg ? <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink2)' }}>{msg.text}</p> : null}
            </>
          ) : null}
        </div>
      )}
    </Section>
  );
}

/**
 * Record that a list of members left the platform.
 *
 * The sibling of `logExport` in studio-web/app/export/page.tsx, and swallowed
 * for the same reason it is: the file is already in the owner's hands by the
 * time this runs, so reporting a logging failure as an export failure would be
 * false, and refusing the download over a logging table would be a worse
 * product for a worse reason. A gap in the log is visible as a gap.
 *
 * The note names what was actually in the file. `parts: ['members']` alone
 * would say a roster left and could not say it carried phone numbers, which is
 * the half of the answer that matters to whoever reads this row later.
 */
async function logRosterExport(me: Me, tenantId: string, seg: Segment): Promise<void> {
  if (!tenantId) return;
  // eslint-disable-next-line -- no-error-ok: the CSV is already on the owner's disk; a logging failure must not be reported as an export failure, and a refusal here would be a console that cannot answer its own segments
  await supabase.from('gym_export_runs').insert({
    tenant_id: tenantId,
    scope: 'gym',
    member_id: null,
    parts: ['members'],
    rows_exported: seg.members.length,
    taken_by: me.id,
    note: `Roster CSV from /members — the “${seg.label}” group (${seg.members.length} member(s)), with name, membership, days since last visit, email and phone.`,
  });
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

// The banner is the shared one now: studio-web/components/Banner.tsx. This
// page's copy rendered into a plain <div>, so every "the write was refused and
// nothing was saved" it said was a silence for a screen reader. The shared one
// carries role="alert"/aria-live; `live={false}` is for the ones an Announce
// region on the same screen is already reading out.
function Banner({ children, tone, live }: { children: React.ReactNode; tone?: 'crit'; live?: boolean }) {
  return <SharedBanner tone={tone} live={live}>{children}</SharedBanner>;
}

