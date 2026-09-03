'use client';

// Retention — the gym, not one member of it.
//
// The console could already answer this one person at a time. `retentionRead`
// in src/lib/memberView.ts separates somebody who moved from the 6am class to
// the gym floor from somebody who stopped coming, and the Members screen prints
// it beside their name. What no screen did was add it up: an owner could open
// forty members one at a time and still not know whether the gym is keeping
// people. "Class attendance is down 12%" is not that answer either — it is a
// number about classes, and a good half of the training in a gym with a floor
// does not happen in one.
//
// So this page is a roll-up, and the arithmetic lives in src/lib/gymRetention.ts
// where it can be run under plain node. It calls the same per-member functions
// the Members page calls, and `assessDrift` from clientDrift.ts for the bands,
// so the owner's headline and the coach's client book cannot disagree about the
// same person. Drift there is a break in somebody's OWN pattern rather than a
// level, which is what makes a roll-up meaningful at all: a gym of steady
// twice-a-week members is keeping every one of them, and a report that ranked
// members by how keen they are would have said the opposite.
//
// Two things this page refuses to do:
//
//   · convict a roster of absence because nobody installed a door reader. A
//     member with no visits looks identical whether the gym has no terminal,
//     the read failed, or they genuinely stopped. The quiet count is null in
//     the first two cases and the banner says which;
//   · print a percentage over a handful of people. A cohort of four does not
//     have a 75% retention rate, and the floor and its reason are on screen
//     rather than buried in the module.
//
// Four reads, each loaded and each able to fail on its own, and every section
// renders three states — not loaded, loaded and empty, and the read failed.
//
// ── Phase 4 · the intervention loop ────────────────────────────────────────
//
// Surfacing was only ever half of it. This page named the same member every
// Monday and had nowhere to record that anybody rang her, so two staff made the
// same call and the gym could never answer whether any of it helps.
//
// The arithmetic for the other half lives in src/lib/interventions.ts, framework
// -free like the rest, and four of its rules show up on this screen:
//
//   · a logged contact is NOT attendance. `member_interventions` is not one of
//     the four parts a RetentionRecord carries, and nothing below turns a
//     contact into an ActivityEvent. The bands, the cohorts and every drift
//     verdict on this page are byte-identical whether or not anybody has been
//     contacted — if logging a call made a member look healthier, the loop
//     would report its own activity back as retention;
//   · "did it work?" refuses to answer early, on a window taken from the
//     member's OWN rate. A member who trained four times a week is judged after
//     a fortnight; a member who trained fortnightly is not judged for six
//     weeks, because a fortnight of silence is her normal gap;
//   · what is reported is a SEQUENCE — training picked up, held, or kept
//     falling after the contact — never a success rate. See WHY_NO_RATE, which
//     is printed on the page rather than buried in the module;
//   · a member contacted last week sinks within her band. She does not vanish.
//     A gym that stops seeing somebody who is still leaving has swapped a
//     nuisance for a blind spot.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { sliceLanded, slicesLanded } from '@lib/readLanded';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships } from '@lib/gymRecord';
import { gymDateText } from '@lib/gymWhen';
import { fetchVisits } from '@lib/gymVisits';
import { fetchClasses } from '@lib/gymSchedule';
import { searchRows, searchNote } from '@lib/consoleSearch';
import { parseGymZone, gymWallValue, instantAtGym } from '@lib/gymZone';
import { readAll } from '@lib/rowCap';
import { readByIds } from '@lib/idLookup';
import { fetchSessions } from '@lib/gymSessions';
import { buildDossiers, sliceLoading, sliceReady, sliceFailed, slicePartial, type Slice, type MemberBooking } from '@lib/memberView';
import { bandTitle, bandNote, DRIFT_LABEL, type ActivityEvent, type Drift } from '@lib/clientDrift';
import { Banner } from '@/components/Banner';
import {
  buildGymRetention, headline, suppressionNote, activityFor,
  type RetentionRecord, type RetentionRow, type Cohort, type GymRetention,
} from '@lib/gymRetention';
import {
  assessAllFollowUps, summariseFollowUps, surfaceOrder, quietenedCount, loopHeadline,
  paceNote, paceOf, triedLine, contactBy,
  CHANNELS, CHANNEL_LABEL, CONTACT_OUTCOMES, OUTCOME_LABEL, FOLLOW_UP_LABEL, WHY_NO_RATE,
  type Contact, type Channel, type ContactOutcome,
  type FollowUpRead, type FollowUpTally, type Surfaced,
} from '@lib/interventions';

const DAY = 86400000;

/**
 * How far back the door log, the timetable and the one-to-ones are read.
 *
 * Comfortably wider than both windows that consume them — the door-versus-
 * timetable comparison is 56 days and the drift baseline is 56 — so neither is
 * measuring the edge of the query instead of the gym. Memberships are read
 * whole: the cohort spine needs join dates going back years, and a 90-day slice
 * of the roster would report that the gym recruited nobody before June.
 */
const WINDOW_DAYS = 90;

/**
 * How far back the attendance queries actually go, which is further than the
 * retention window and for a different reason.
 *
 * Judging what followed a contact needs the member's pattern from BEFORE it —
 * `DEFAULT_WINDOWS.historyDays` of it, wound back to the day of the call. At a
 * 90-day read only a contact from the last month would have a baseline behind
 * it, and a contact from last month has mostly not passed its own judgement
 * window yet. So nothing would ever be judgeable, and the page would print an
 * unbroken column of "too early" forever while looking like it worked.
 *
 * 150 days makes contacts up to about 94 days old judgeable. Older than that
 * and `assessFollowUp` returns `outside-the-read` — a statement about this
 * page's query, said in those words, rather than a verdict about the member.
 *
 * The retention record itself is still built from exactly WINDOW_DAYS. The wide
 * rows are narrowed below rather than fed straight in, so the bands, the door
 * log state and the cohort spine are computed on precisely the window they were
 * before this section existed.
 */
const ACTIVITY_DAYS = 150;

/** How far back contacts are listed. Beyond ACTIVITY_DAYS they cannot be
 *  judged, but they are still what somebody tried and still stop a second
 *  caller repeating them, so they are shown with the reason. */
const INTERVENTION_DAYS = 180;

const EMPTY: RetentionRecord = {
  memberships: sliceLoading(),
  visits: sliceLoading(),
  bookings: sliceLoading(),
  sessions: sliceLoading(),
};

export default function RetentionPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);
  /** The 150-day reads. Narrowed to WINDOW_DAYS before anything reads them as
   *  a RetentionRecord — see ACTIVITY_DAYS. */
  const [wide, setWide] = useState<RetentionRecord>(EMPTY);
  const [contacts, setContacts] = useState<Slice<Contact>>(sliceLoading());

  const loadContacts = useCallback(async (tenantId: string): Promise<boolean> => {
    setContacts(sliceLoading());
    const sinceIso = new Date(Date.now() - INTERVENTION_DAYS * DAY).toISOString();
    const got = await slice(() => fetchContacts(tenantId, sinceIso));
    setContacts(got);
    // Returned rather than only stored: the read stamp below covers the contact
    // log as well as the roster, and this read's answer was previously
    // destructured off the end of a `Promise.all` and dropped on the floor.
    return sliceLanded(got);
  }, []);

  const load = useCallback(async (tenantId: string): Promise<boolean> => {
    setWide(EMPTY);
    const sinceIso = new Date(Date.now() - ACTIVITY_DAYS * DAY).toISOString();

    // Independent reads, deliberately not one Promise.all with a single
    // catch. A door log that 500s must not take the roster down with it — the
    // page is allowed to be partial, but only if it says which part and what
    // that part was carrying. The interventions read is the same: a broken
    // `member_interventions` must leave the retention half standing.
    const [memberships, visits, bookings, sessions, contactsLanded] = await Promise.all([
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchVisits(supabase, tenantId, { sinceIso })),
      slice(() => fetchBookings(tenantId, sinceIso)),
      slice(() => fetchSessions(supabase, tenantId, sinceIso)),
      loadContacts(tenantId),
    ]);
    setWide({ memberships, visits, bookings, sessions });

    // Whole means all five answered. `useFetched` stamps only on a whole read,
    // so a refresh that lost the door log leaves the stamp where it was — and
    // on this screen the door log is the whole of the one finding a gym cannot
    // get anywhere else: who is still training but no longer booking.
    return contactsLanded && slicesLanded([memberships, visits, bookings, sessions]);
  }, [loadContacts]);

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
        setWide({
          memberships: sliceReady([]), visits: sliceReady([]),
          bookings: sliceReady([]), sessions: sliceReady([]),
        });
        setContacts(sliceReady([]));
        return;
      }
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name, timezone').eq('id', who.tenantId).single();
      // supabase-js resolves on a database error, so this is checked rather
      // than assumed: a null name here means "not read", not "unnamed gym".
      if (live) {
        setGymName(tErr ? null : t?.name ?? null);
        // The gym's own wall clock. The contact log is how a gym decides
        // whether calling lapsed members works, and the interval between the
        // call and the visit is the measurement — two members of staff in two
        // countries logging into one gym's history produce a timeline that
        // cannot be read as one.
        const z = tErr ? { kind: 'clear' as const } : parseGymZone((t as any)?.timezone);
        setZone(z.kind === 'zone' ? z.zone : null);
      }
    })();
    return () => { live = false; };
    // Identity and the gym record only — the five reads are the effect below's.
  }, []);

  /**
   * Kept current, and it says when it was last read.
   *
   * Every figure here is a list of people somebody is about to ring, and the
   * contact log records whether they already did. Two members of staff working
   * the list from two tabs is the ordinary case, and a tab that answered about
   * the moment it was opened had them ringing the same member twice with
   * nothing on screen saying the list was old.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId ? load(me.tenantId) : Promise.resolve(false)),
  );

  useEffect(() => {
    if (me?.tenantId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId]);

  // `now` is pinned per render of the record rather than read inside each
  // helper, so the cohort spine, the drift windows, every cooldown and every
  // follow-up window cannot land either side of a month boundary — or either
  // side of midnight — and disagree with each other on the same screen.
  const view = useMemo(() => buildView(wide, contacts), [wide, contacts]);
  const { rec, g, surfaced, followUps, tally } = view;

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/retention">
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
      <Shell me={me} gymName={gymName} current="/retention">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          Retention reads the whole roster and every member&rsquo;s attendance, so it is owner-only.
        </p>
      </Shell>
    );
  }

  const loading = rec.memberships.state === 'loading';
  const line = headline(g);
  // Drifting and nobody has tried. Null — never 0 — while the interventions
  // read is in flight or has failed: "no one has been contacted" and "we could
  // not read who has been contacted" would send the same staff on the same
  // calls, and only one of them is true.
  const untried = surfaced == null
    ? null
    : surfaced.filter((s) => s.row.drift?.status === 'at_risk' && s.contactCount === 0).length;

  return (
    <Shell me={me} gymName={gymName} current="/retention">
      <h1>Retention</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        How many members the gym is keeping, how many are breaking their own
        pattern, how many have gone quiet — and the one only a gym with a door
        log can see: how many are still training but no longer on the timetable.
      </p>

      <Fetched at={readAt} busy={reading} onRefresh={refresh}
               what="this roster" style={{ margin: '2px 0 14px' }} />

      {g.warning ? <Banner tone="crit">{g.warning}</Banner> : null}
      {g.caveat ? <Banner>{g.caveat}</Banner> : null}
      {g.blocker ? <Banner tone="warn">{g.blocker}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="On the roster"
          text={num(g.summary.roster)}
          note={rec.memberships.state === 'failed' ? 'memberships not read' : 'ever held a membership'}
        />
        <Kpi
          label="Still on the books"
          text={num(g.summary.onBooks)}
          note={
            g.summary.roster == null ? 'memberships not read'
              : `${g.summary.active} active, ${g.summary.frozen} frozen`
          }
        />
        <Kpi
          label="Keeping their pattern"
          text={num(g.summary.bands?.steady ?? null)}
          note={g.summary.bands == null ? 'nothing that records attendance was read' : 'doing about what they always did'}
          tone="good"
        />
        <Kpi
          label="Drifting"
          text={num(g.summary.bands?.drifting ?? null)}
          note={g.summary.bands == null ? 'no attendance read' : 'well down on their own rate'}
          tone="crit"
        />
        <Kpi
          label="Off the timetable"
          text={num(g.summary.offTimetable)}
          note={
            g.doorLog === 'unread' ? 'door log not read'
              : g.doorLog === 'silent' ? 'no door log to see them with'
              : g.summary.offTimetable == null ? 'needs the door log and the bookings'
              : 'stopped booking, still coming in'
          }
          tone="brand"
        />
        <Kpi
          label="Gone quiet"
          text={num(g.summary.quiet)}
          note={
            g.doorLog === 'unread' ? 'door log not read'
              : g.doorLog === 'silent' ? 'no door log to judge by'
              : g.summary.quiet == null ? 'needs the door log and the bookings'
              : `not in once in ${Math.round(g.windowDays / 2)} days`
          }
          tone="crit"
        />
        <Kpi
          label="Drifting, nobody tried"
          text={num(untried)}
          note={
            contacts.state === 'failed' ? 'contacts not read'
              : contacts.state === 'loading' ? 'reading contacts'
              : g.summary.bands == null ? 'no attendance read'
              : 'no contact recorded at all'
          }
          tone="crit"
        />
      </div>

      {line ? (
        <p style={{
          margin: '0 0 22px', padding: '13px 15px', borderRadius: 0,
          border: '1px solid var(--ring)', borderLeft: '3px solid var(--brand)',
          background: 'var(--surface)', color: 'var(--ink2)', fontSize: 13.5,
        }}>{line}</p>
      ) : null}

      <Bands g={g} loading={loading} />
      <Cohorts g={g} loading={loading} />
      <Loop
        g={g}
        me={me}
        zone={zone}
        contacts={contacts}
        followUps={followUps}
        tally={tally}
        onLogged={() => { if (me.tenantId) void loadContacts(me.tenantId); }}
      />
      <Roster g={g} rec={rec} contacts={contacts} surfaced={surfaced} />
    </Shell>
  );
}

/* ── the whole view, computed once against one `now` ───────────────────────── */

interface View {
  now: number;
  /** Exactly the WINDOW_DAYS record this page has always built. */
  rec: RetentionRecord;
  g: GymRetention;
  /** The roster in surfaced order, or null when there is no roster or no
   *  contacts read. Null is not an empty list: with the contacts read failed
   *  the page must fall back to the plain order and say so, not silently
   *  present an un-quietened list as if nobody had been contacted. */
  surfaced: Surfaced<RetentionRow>[] | null;
  followUps: FollowUpRead[] | null;
  tally: FollowUpTally | null;
}

function buildView(wide: RetentionRecord, contacts: Slice<Contact>): View {
  const now = Date.now();
  const cut = now - WINDOW_DAYS * DAY;

  // Narrow the wide reads back to the retention window. A row whose timestamp
  // will not parse is KEPT, exactly as it was before this filter existed — the
  // modules downstream already refuse to date it, and dropping it here would
  // quietly change what they see.
  const rec: RetentionRecord = {
    memberships: wide.memberships,
    visits: narrow(wide.visits, (v) => !(Date.parse(v.enteredAt) < cut)),
    bookings: narrow(wide.bookings, (b) => !(Date.parse(b.startsAt) < cut)),
    sessions: narrow(wide.sessions, (s) => !(Date.parse(s.startsAt) < cut)),
  };

  const g = buildGymRetention(rec, { now });

  // Activity for the follow-up windows, from the WIDE reads — the point of
  // reading 150 days. `buildDossiers` and `activityFor` are the same two
  // functions gymRetention uses internally, so a contact is judged against
  // exactly the events the bands are judged against, just over a longer span.
  // The three parts this page never reads come through as FAILED rather than
  // empty, for the reason gymRetention's own `widen` states: an empty array
  // would be a claim about a query nobody sent.
  const notAsked = 'Not read by the retention view.';
  const dossiers = buildDossiers({
    ...wide,
    payments: sliceFailed(notAsked),
    passes: sliceFailed(notAsked),
    invites: sliceFailed(notAsked),
  }, now);

  const events = new Map<string, ActivityEvent[]>();
  for (const d of dossiers ?? []) events.set(d.memberId, activityFor(d));

  const rows = contacts.state === 'ready' ? contacts.rows : null;

  const followUps = rows == null ? null : assessAllFollowUps(
    rows,
    // An empty array for a member the roster does not carry would claim they
    // did nothing. `readFromMs` is what actually protects that: a contact older
    // than the read comes back `outside-the-read` rather than judged on
    // silence the query never looked at.
    (id) => events.get(id) ?? [],
    { now, readFromMs: now - ACTIVITY_DAYS * DAY },
  );

  return {
    now,
    rec,
    g,
    surfaced: g.rows == null || rows == null ? null : surfaceOrder(g.rows, rows, { now }),
    followUps,
    tally: summariseFollowUps(followUps),
  };
}

/**
 * The same slice with only the rows that pass `keep`.
 *
 * A truncated read stays truncated. Filtering it and handing back `sliceReady`
 * would launder a prefix into a whole set — the filter reduces the rows, it
 * does not go and fetch the ones that never arrived — and every figure gated on
 * 'ready' downstream would then be computed over part of the gym.
 */
function narrow<T>(s: Slice<T>, keep: (row: T) => boolean): Slice<T> {
  if (s.state === 'ready') return sliceReady(s.rows.filter(keep));
  if (s.state === 'partial') return slicePartial(s.rows.filter(keep), s.cap);
  return s;
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
 * The same two plain queries the Members page runs and deliberately not an
 * embedded select: `fetchClasses` already resolves the timetable scoped to the
 * tenant, and asking PostgREST to embed gym_classes from class_bookings is the
 * shape that produced the PGRST201 ambiguity documented in gymSessions.ts.
 *
 * `.error` is checked explicitly. supabase-js RESOLVES on a database error, so
 * without this a failed read arrives as `data === null`, falls through `?? []`,
 * and every member on the roster reports nothing booked and nothing attended —
 * which on THIS page would not draw as a blank but as a gym whose entire
 * membership has stopped training. That is the single most dangerous false
 * figure the console could produce.
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

/**
 * What the gym has already tried, in the window.
 *
 * `.error` is checked explicitly, and it matters more here than almost anywhere
 * else on the page: supabase-js RESOLVES on a database error, so without this a
 * failed read arrives as `data === null`, falls through `?? []`, and the page
 * reports that nobody has ever contacted anybody. Two members of staff would
 * then make the same call — the precise duplicate this table exists to prevent
 * — and the "drifting, nobody tried" tile would read as a to-do list. Hence the
 * slice: a failure is a stated failure, never an empty history.
 *
 * Paged rather than capped, and that is a correction rather than a relaxation.
 *
 * Refusing was the `fetchVisits` standard and it was chosen for the right
 * reason: truncation here makes a false statement about a NAMED PERSON rather
 * than a smaller figure. The order is `at desc`, so the rows that fall away are
 * the OLDEST contacts in the window, and this page's whole purpose is the
 * sentence "nobody has tried this member yet". The member whose call fell off
 * the end reads as never contacted, appears on the "nobody tried" tile, and
 * gets rung a second time by somebody who has just been told nobody rang.
 *
 * What refusing did instead was take the page away. A gym working its drifting
 * list logs a call per member per week, so a busy quarter is past a thousand —
 * and at that point every retention band, every cohort and the whole
 * intervention loop became one error message, permanently, with no date filter
 * on the screen to work around it. This read is already bounded by
 * ACTIVITY_DAYS, which is exactly the shape `readAll` exists for: a finite set
 * the screen genuinely needs all of. The order carries `id` after `at` because
 * paging needs a total one.
 */
async function fetchContacts(tenantId: string, sinceIso: string): Promise<Contact[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('member_interventions')
      .select('id, member_id, at, channel, by_id, by_name, outcome, note')
      .eq('tenant_id', tenantId)
      .gte('at', sinceIso)
      .order('at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    'the contacts already made in this period',
  );

  return rows.map((r: any) => ({
    id: r.id,
    memberId: r.member_id,
    at: r.at,
    channel: r.channel as Channel,
    byId: r.by_id ?? null,
    // Never the uuid dressed up as a name. A missing name is a missing name.
    byName: r.by_name ?? null,
    outcome: (r.outcome ?? 'unknown') as ContactOutcome,
    note: r.note ?? null,
  }));
}

/**
 * Record one contact.
 *
 * `by_id` is sent as the caller's own id because the insert policy requires it
 * — a trainer cannot file a call under a colleague's name, since "who has
 * already tried" is the one thing that stops the second call and it has to be
 * true. `by_name` is written down here rather than joined later so the answer
 * survives that person leaving the gym.
 *
 * The error is returned rather than swallowed. A write that silently fails is
 * worse than one that errors: the staff member believes it is logged, nobody
 * else sees it, and the member gets rung twice anyway.
 */
async function logContact(
  tenantId: string,
  me: Me,
  form: { memberId: string; at: string; channel: Channel; outcome: ContactOutcome; note: string },
): Promise<string | null> {
  const { error } = await supabase.from('member_interventions').insert({
    tenant_id: tenantId,
    member_id: form.memberId,
    at: form.at,
    channel: form.channel,
    by_id: me.id,
    by_name: me.fullName,
    outcome: form.outcome,
    note: form.note.trim() ? form.note.trim() : null,
  });
  return error ? (error.message ?? 'The write failed.') : null;
}

/* ── the bands ─────────────────────────────────────────────────────────────── */

const BAND_COLOUR = {
  steady: 'var(--good)',
  watch: 'var(--warn)',
  drifting: 'var(--crit)',
  unknown: 'var(--ink3)',
} as const;

function Bands({ g, loading }: { g: GymRetention; loading: boolean }) {
  const b = g.summary.bands;

  return (
    <Section
      title="Where the roster stands"
      sub="Measured against each member's own earlier rate, not against a target — a member who has always trained twice a week is not drifting, and one who fell from four times to once is, at any level."
    >
      {loading ? <Loading /> : null}
      {!loading && b == null ? (
        <p style={{ margin: 0, padding: '22px 16px', color: 'var(--ink2)', fontSize: 13.5 }}>
          Nothing that records attendance could be read — no door log, no class
          bookings, no one-to-ones. Every member would come back &ldquo;nothing
          recorded&rdquo;, which would be a statement about the queries wearing
          the clothes of a statement about the gym. So no bands are shown.
        </p>
      ) : null}
      {!loading && b != null && b.total === 0 ? (
        <p style={{ margin: 0, padding: '22px 16px', color: 'var(--ink3)', fontSize: 13.5 }}>
          Nobody holds or has ever held a membership here. Open one under Money
          and this page fills in.
        </p>
      ) : null}
      {!loading && b != null && b.total > 0 ? (
        <div style={{ padding: '16px 16px 18px' }}>
          <BandBar
            total={b.total}
            parts={[
              { key: 'steady', label: bandTitle('on_track'), n: b.steady, colour: BAND_COLOUR.steady },
              { key: 'watch', label: bandTitle('watch'), n: b.watch, colour: BAND_COLOUR.watch },
              { key: 'drifting', label: bandTitle('at_risk'), n: b.drifting, colour: BAND_COLOUR.drifting },
              { key: 'unknown', label: bandTitle('idle'), n: b.unknown, colour: BAND_COLOUR.unknown },
            ]}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
            <Legend colour={BAND_COLOUR.steady} n={b.steady} title={bandTitle('on_track')} note={bandNote('on_track', g.driftWindows)} />
            <Legend colour={BAND_COLOUR.watch} n={b.watch} title={bandTitle('watch')} note={bandNote('watch', g.driftWindows)} />
            <Legend colour={BAND_COLOUR.drifting} n={b.drifting} title={bandTitle('at_risk')} note={bandNote('at_risk', g.driftWindows)} />
            <Legend colour={BAND_COLOUR.unknown} n={b.unknown} title={bandTitle('idle')} note={bandNote('idle', g.driftWindows)} />
          </div>
          {g.sources.length < 3 ? (
            <p style={{ margin: '16px 0 0', fontSize: 12.5, color: 'var(--ink3)' }}>
              Judged on {g.sources.length ? g.sources.map(sourceWord).join(' and ') : 'nothing'} only.
              {' '}{['visits', 'bookings', 'sessions'].filter((s) => !g.sources.includes(s as any)).map((s) => sourceWord(s as any)).join(' and ')}
              {' '}did not load, so a member who trains only that way looks quieter here than they are.
            </p>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function sourceWord(s: 'visits' | 'bookings' | 'sessions'): string {
  return s === 'visits' ? 'the door log' : s === 'bookings' ? 'class attendance' : 'one-to-ones';
}

/**
 * One stacked bar, hand-authored. No chart library, and no chart at all when
 * there is nothing to divide — a full-width grey bar labelled 0 reads as a
 * finding.
 */
function BandBar({ total, parts }: {
  total: number;
  parts: { key: string; label: string; n: number; colour: string }[];
}) {
  const W = 600, H = 26;
  const label = `The roster in four bands, ${total} members in total: `
    + parts.map((p) => `${p.n} ${p.label.toLowerCase()}`).join(', ') + '.';

  let x = 0;
  const rects = parts.map((p) => {
    const w = total > 0 ? (p.n / total) * W : 0;
    const r = { ...p, x, w };
    x += w;
    return r;
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
      role="img" aria-label={label}
      style={{ display: 'block', borderRadius: 0, overflow: 'hidden', background: 'var(--surface2)' }}
    >
      {rects.map((r) => (r.w > 0 ? (
        <rect key={r.key} x={r.x} y={0} width={r.w} height={H} fill={r.colour} />
      ) : null))}
    </svg>
  );
}

function Legend({ colour, n, title, note }: { colour: string; n: number; title: string; note: string }) {
  return (
    <div style={{ display: 'flex', gap: 9 }}>
      <span style={{ width: 3, borderRadius: 0, background: colour, flex: 'none' }} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 17, letterSpacing: '-0.02em' }}>{n}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 2 }}>{note}</div>
      </div>
    </div>
  );
}

/* ── the cohort spine ──────────────────────────────────────────────────────── */

function Cohorts({ g, loading }: { g: GymRetention; loading: boolean }) {
  const spine = g.spine;

  const cols: Column<Cohort>[] = [
    { key: 'month', header: 'Joined in', value: (c) => c.label },
    { key: 'n', header: 'Joiners', value: (c) => c.joined, numeric: true },
    { key: 'books', header: 'Still on the books', value: (c) => c.onBooks, numeric: true,
      render: (c) => c.joined === 0 ? <span className="dash">—</span> : `${c.onBooks} of ${c.joined}` },
    {
      key: 'rate', header: 'Retention', value: (c) => c.retention, numeric: true,
      render: (c) => c.retention == null
        // Never a percentage the cohort cannot carry. The reason is on the row
        // rather than in a footnote, because a dash on its own reads as broken.
        ? <span className="dash" title={suppressionNote(c, g.minCohort) ?? undefined}>
            {c.joined === 0 ? 'no joiners' : c.suppressed === 'too-young' ? 'too recent' : 'too few to rate'}
          </span>
        : <strong>{pct(c.retention)}</strong>,
    },
    {
      key: 'training', header: 'Still training', value: (c) => c.training, numeric: true,
      render: (c) => c.training == null
        ? <span className="dash">not judged</span>
        : c.joined === 0 ? <span className="dash">—</span>
        : `${c.training} of ${c.joined}`,
    },
    {
      key: 'unknown', header: 'Cannot judge', value: (c) => c.unknown, numeric: true,
      render: (c) => c.unknown == null ? <span className="dash">—</span> : String(c.unknown),
    },
  ];

  return (
    <Section
      title="By the month they joined"
      sub="Cohorts are the only honest way to read retention over time: a gym that recruits hard looks like it is keeping people right up until the month it stops."
    >
      {loading ? <Loading /> : null}
      {membershipsFailed(g) ? <Failed reason={g.broken.find((b) => b.part === 'memberships')!.reason} what="the membership list" /> : null}

      {!loading && spine ? (
        <div style={{ padding: '0 0 4px' }}>
          {!spine.feasibility.usable ? (
            <p style={{ margin: 0, padding: '20px 16px', color: 'var(--ink2)', fontSize: 13.5 }}>
              {spine.feasibility.reason}
            </p>
          ) : (
            <>
              <div style={{ padding: '16px 16px 6px' }}>
                <CohortChart spine={spine.cohorts} earlier={spine.earlier} minCohort={g.minCohort} />
              </div>
              <DataTable noun="joining cohorts"
                rows={spine.earlier ? [spine.earlier, ...spine.cohorts] : spine.cohorts}
                columns={cols}
                rowKey={(c) => c.month}
                empty="No dated membership on the roster."
              />
            </>
          )}

          <p style={{ margin: 0, padding: '13px 16px', borderTop: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink3)' }}>
            {spine.floorNote}
            {spine.feasibility.usable ? ` ${spine.reportable} of ${spine.cohorts.length + (spine.earlier ? 1 : 0)} cohorts clear both.` : ''}
            {spine.undated > 0 ? ` ${spine.undated} member${spine.undated === 1 ? '' : 's'} carry no usable start date and are in no cohort at all — they are not folded into the oldest one.` : ''}
          </p>
        </div>
      ) : null}
    </Section>
  );
}

function membershipsFailed(g: GymRetention): boolean {
  return g.broken.some((b) => b.part === 'memberships');
}

/**
 * Joiners per month, each bar split into who is still on the books and who is
 * not. Hand-authored, no library.
 *
 * Months with no joiners are drawn as an empty slot rather than skipped: a
 * month the gym recruited nobody is information, and closing the gap would let
 * the eye read a straight run of recruitment that never happened.
 *
 * A percentage is printed above a bar only where the cohort may carry one. The
 * bars that may not are drawn at reduced opacity, so the shape is still
 * readable without inviting the reader to compare heights as if they were rates.
 */
function CohortChart({ spine, earlier, minCohort }: {
  spine: Cohort[]; earlier: Cohort | null; minCohort: number;
}) {
  const bars = earlier ? [earlier, ...spine] : spine;
  if (!bars.length) return null;

  const BW = 22, GAP = 12, TOP = 20, PLOT = 110, FOOT = 26;
  const W = bars.length * (BW + GAP) + GAP;
  const H = TOP + PLOT + FOOT;
  const max = Math.max(1, ...bars.map((c) => c.joined));

  const label = `Members joining each month and how many still hold a membership. `
    + bars.map((c) => {
      const rate = c.retention == null
        ? (c.joined === 0 ? 'no joiners' : c.suppressed === 'too-young' ? 'no rate yet, too recent' : `no rate, under the floor of ${minCohort}`)
        : `${pct(c.retention)} retained`;
      return `${c.label}: ${c.joined} joined, ${c.onBooks} still on the books, ${rate}`;
    }).join('. ') + '.';

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`} width={W} height={H}
        role="img" aria-label={label}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      >
        {/* the baseline, so a zero month is visibly a slot rather than a hole */}
        <line x1={0} y1={TOP + PLOT + 0.5} x2={W} y2={TOP + PLOT + 0.5} stroke="var(--ring)" strokeWidth={1} />
        {bars.map((c, i) => {
          const x = GAP + i * (BW + GAP);
          const h = (c.joined / max) * PLOT;
          const kept = c.joined === 0 ? 0 : (c.onBooks / c.joined) * h;
          const lost = h - kept;
          const rated = c.retention != null;
          return (
            <g key={c.month} opacity={c.joined === 0 ? 1 : rated ? 1 : 0.45}>
              <rect x={x} y={TOP + PLOT - h} width={BW} height={lost} fill="var(--crit)" rx={2} />
              <rect x={x} y={TOP + PLOT - kept} width={BW} height={kept} fill="var(--good)" rx={2} />
              {c.joined === 0 ? (
                <rect x={x} y={TOP + PLOT - 2} width={BW} height={2} fill="var(--ring)" />
              ) : null}
              {rated ? (
                <text
                  x={x + BW / 2} y={TOP + PLOT - h - 6} textAnchor="middle"
                  fontSize={10} fontFamily="var(--mono)" fill="var(--ink2)"
                >{pct(c.retention!)}</text>
              ) : null}
              <text
                x={x + BW / 2} y={TOP + PLOT + 14} textAnchor="middle"
                fontSize={9} fontFamily="var(--mono)" fill="var(--ink3)"
              >{shortLabel(c.label)}</text>
              <text
                x={x + BW / 2} y={TOP + PLOT + 24} textAnchor="middle"
                fontSize={9} fontFamily="var(--mono)" fill="var(--ink3)"
              >{c.joined || ''}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11.5, color: 'var(--ink3)' }}>
        <Swatch colour="var(--good)">still on the books</Swatch>
        <Swatch colour="var(--crit)">cancelled or expired</Swatch>
        <span>faded bars are cohorts too small or too recent to carry a percentage</span>
      </div>
    </div>
  );
}

function Swatch({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: 0, background: colour }} aria-hidden="true" />
      {children}
    </span>
  );
}

/** 'Aug 2026' → 'Aug 26'. 'Before that' is left alone. */
function shortLabel(label: string): string {
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(label);
  return m ? `${m[1]} ${m[2].slice(2)}` : label.length > 8 ? label.slice(0, 8) : label;
}

/* ── the loop: what was tried, and what followed ───────────────────────────── */

const VERDICT_COLOUR: Record<string, string> = {
  recovered: 'var(--good)',
  held: 'var(--warn)',
  'kept-falling': 'var(--crit)',
};

function Loop({ g, me, zone, contacts, followUps, tally, onLogged }: {
  g: GymRetention;
  me: Me;
  /** `tenants.timezone`, or null when the gym has not set one. */
  zone: string | null;
  contacts: Slice<Contact>;
  followUps: FollowUpRead[] | null;
  tally: FollowUpTally | null;
  onLogged: () => void;
}) {
  const names = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of g.rows ?? []) m.set(r.memberId, r.name);
    return m;
  }, [g.rows]);

  const byContact = useMemo(() => {
    const m = new Map<string, FollowUpRead>();
    for (const f of followUps ?? []) m.set(f.contactId, f);
    return m;
  }, [followUps]);

  const rows = contacts.state === 'ready' ? contacts.rows : null;

  const cols: Column<Contact>[] = [
    {
      key: 'member', header: 'Member', value: (c) => names.get(c.memberId) ?? '￿',
      // Linked for the same reason as the board above: a log of who was rung
      // is read by somebody deciding whether to ring again, and that decision
      // is made on the member's record.
      render: (c) => {
        const n = names.get(c.memberId);
        if (!n) return <span className="dash">not on the roster read</span>;
        return (
          <a href={`/members?member=${encodeURIComponent(c.memberId)}`} style={{ color: 'var(--brand)' }}>{n}</a>
        );
      },
    },
    { key: 'at', header: 'Contacted', value: (c) => c.at, render: (c) => shortWhen(c.at, zone) },
    { key: 'how', header: 'How', value: (c) => CHANNEL_LABEL[c.channel] },
    {
      key: 'by', header: 'By', value: (c) => contactBy(c),
      // A dead uuid is not a name, and "—" is the truthful render of a staff
      // member whose profile is gone and whose name was never written down.
      render: (c) => contactBy(c) ?? <span className="dash">not recorded</span>,
    },
    { key: 'outcome', header: 'On the call', value: (c) => OUTCOME_LABEL[c.outcome] },
    {
      key: 'after', header: 'What followed', value: (c) => {
        const f = byContact.get(c.id);
        return f == null || f.verdict === 'unknown' ? null : f.verdict;
      },
      render: (c) => {
        const f = byContact.get(c.id);
        if (!f) return <span className="dash">not assessed</span>;
        if (f.verdict === 'unknown') {
          return <span className="dash" title={f.reason}>{blockWord(f)}</span>;
        }
        return (
          <span style={{ color: VERDICT_COLOUR[f.verdict], whiteSpace: 'nowrap' }} title={f.reason}>
            {FOLLOW_UP_LABEL[f.verdict]}
          </span>
        );
      },
    },
    {
      key: 'why', header: 'What the record shows', value: (c) => byContact.get(c.id)?.reason ?? null,
      render: (c) => {
        const f = byContact.get(c.id);
        return f
          ? <span style={{ whiteSpace: 'normal' }}>{f.reason}</span>
          : <span className="dash">no attendance read to judge it against</span>;
      },
    },
    {
      key: 'note', header: 'Note', value: (c) => c.note,
      render: (c) => c.note
        ? <span style={{ whiteSpace: 'normal' }}>{c.note}</span>
        : <span className="dash">—</span>,
    },
  ];

  return (
    <Section
      title="What was tried, and what followed"
      sub="Recording a contact does not change anybody's verdict above — a call is not a training session, and the bands would be identical with this table empty."
    >
      <LogForm g={g} me={me} zone={zone} onLogged={onLogged} />

      {contacts.state === 'loading' ? <Loading /> : null}
      {contacts.state === 'failed' ? (
        <Failed reason={(contacts as { reason: string }).reason} what="what has already been tried" />
      ) : null}
      {contacts.state === 'partial' ? (
        <div style={{
          padding: '16px 14px', margin: '14px', borderRadius: 0,
          border: '1px solid var(--ring)', borderLeft: '3px solid var(--warn)',
          background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
        }}>
          Read the first {contacts.cap} contact rows, and there are more. What follows is a{' '}
          <strong>prefix</strong> of what has been tried — an empty &ldquo;Already tried&rdquo; cell
          below means the call may be older than these rows, not that nobody made it.
        </div>
      ) : null}

      {rows ? (
        <>
          {tally && tally.total > 0 ? (
            <div style={{ padding: '14px 16px 4px' }}>
              <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--ink2)' }}>{loopHeadline(tally)}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <Legend colour={VERDICT_COLOUR.recovered} n={tally.recovered} title="Came back"
                  note="training picked up after the contact" />
                <Legend colour={VERDICT_COLOUR.held} n={tally.held} title="Held"
                  note="about the same either side" />
                <Legend colour={VERDICT_COLOUR['kept-falling']} n={tally.keptFalling} title="Kept falling"
                  note="further down after the contact" />
                <Legend colour="var(--ink3)" n={tally.tooEarly} title="Too early to say"
                  note="their own window has not passed" />
                <Legend colour="var(--ink3)" n={tally.noBaseline + tally.recontacted + tally.outsideTheRead + tally.unreadable}
                  title="Cannot be judged" note="no pattern before it, contacted again inside the window, or older than this page reads" />
              </div>
            </div>
          ) : null}

          <DataTable noun="members that cannot be judged"
            rows={rows} columns={cols} rowKey={(c) => c.id}
            empty="Nothing has been recorded yet. Log the first call above and this table starts answering whether any of it lands."
          />

          <p style={{ margin: 0, padding: '13px 16px', borderTop: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink3)' }}>
            {WHY_NO_RATE}
          </p>
        </>
      ) : null}
    </Section>
  );
}

/** The refusal, in two words, with the full sentence on hover. Five different
 *  reasons, never one dash: "we cannot judge this yet" and "this contact
 *  predates what the page read" send a gym to different places. */
function blockWord(f: FollowUpRead): string {
  switch (f.blocked) {
    case 'too-early': return f.daysToWait != null ? `${f.daysToWait}d to wait` : 'too early';
    case 'no-baseline': return 'no pattern before it';
    case 'recontacted': return 'contacted again';
    case 'outside-the-read': return 'older than this page reads';
    default: return 'undated';
  }
}

function LogForm({ g, me, zone, onLogged }: {
  g: GymRetention; me: Me; zone: string | null; onLogged: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  const [channel, setChannel] = useState<Channel>('call');
  const [outcome, setOutcome] = useState<ContactOutcome>('unknown');
  const [note, setNote] = useState('');
  // The GYM's wall clock in the box, and the gym's wall clock read back out of
  // it — not the browser's.
  //
  // This built the value from `d.getFullYear()`, `d.getMonth()`, `d.getDate()`,
  // `d.getHours()`, `d.getMinutes()`: the reader's local parts, written into a
  // field the rest of this console reads back as the gym's. The same shape the
  // last roadmap found on the rota's add-a-shift form.
  const [when, setWhen] = useState(() => gymWallValue(Date.now(), zone) ?? localNow());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const rows = g.rows;
  const chosen = rows?.find((r) => r.memberId === memberId) ?? null;

  if (rows == null) {
    return (
      <p style={{ margin: 0, padding: '18px 16px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
        The roster could not be read, so there is nobody to log a contact against. Nothing is offered rather than a free-text box that would file a call against an id nobody can check.
      </p>
    );
  }

  const submit = async () => {
    setError(null); setDone(null);
    if (!memberId) { setError('Choose the member this contact was with.'); return; }
    if (!me.tenantId) { setError('Your profile carries no gym, so there is nothing to file this against.'); return; }
    // Read back in the same clock it was written in. `new Date(when)` on a
    // `datetime-local` value is the BROWSER's zone, so a receptionist in London
    // logging a call for a Dubai gym filed it four hours late.
    const iso = instantAtGym(when, zone) ?? (() => {
      const d = new Date(when);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })();
    if (!iso) { setError('That is not a time this can be filed under.'); return; }
    const at = new Date(iso);
    // The database refuses a future contact too; catching it here means the
    // person is told why rather than shown a constraint violation.
    if (at.getTime() > Date.now() + 5 * 60_000) {
      setError('A contact is something that happened. Log it after you have made it.');
      return;
    }

    setBusy(true);
    const failed = await logContact(me.tenantId, me, {
      memberId, at: iso, channel, outcome, note,
    });
    setBusy(false);

    if (failed) { setError(failed); return; }
    setDone(`Logged against ${chosen?.name ?? 'that member'}.`);
    setNote('');
    setWhen(gymWallValue(Date.now(), zone) ?? localNow());
    onLogged();
  };

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ring)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Field label="Member">
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={inputStyle}>
            <option value="">Choose…</option>
            {rows.map((r) => (
              <option key={r.memberId} value={r.memberId}>
                {r.name ?? 'unnamed account'}{r.drift ? ` — ${DRIFT_LABEL[r.drift.status]}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="How">
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} style={inputStyle}>
            {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="On the call">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as ContactOutcome)} style={inputStyle}>
            {CONTACT_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </select>
        </Field>
        <Field label="When">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={inputStyle} />
        </Field>
      </div>

      <div style={{ marginTop: 10 }}>
        <Field label="What was said">
          <input
            value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle}
            placeholder="Said the 6am is too early now — offered the 7:15"
          />
        </Field>
      </div>

      {chosen ? (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--ink3)' }}>
          {paceNote(paceOf(chosen.drift))}
        </p>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button onClick={() => void submit()} disabled={busy} style={buttonStyle}>
          {busy ? 'Saving…' : 'Record this contact'}
        </button>
        {/* Both announced. This page imports Banner and uses it at the top;
            the contact log — the one control on it that WRITES — was left
            saying "not recorded" in colour alone. */}
        {error ? <span role="alert" aria-live="assertive" aria-atomic="true"
                       style={{ color: 'var(--crit)', fontSize: 12.5 }}>{error}</span> : null}
        {done ? <span role="status" aria-live="polite" aria-atomic="true"
                      style={{ color: 'var(--good)', fontSize: 12.5 }}>{done}</span> : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="micro" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 9px', borderRadius: 0, fontSize: 13,
  border: '1px solid var(--ring)', background: 'var(--surface2)', color: 'var(--ink)',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 0, fontSize: 13, cursor: 'pointer',
  border: '1px solid var(--ring)', background: 'var(--surface2)', color: 'var(--ink)',
};

/** A `datetime-local` value for right now in the BROWSER's clock.
 *
 *  The fallback, and only the fallback: used when the gym has not set a
 *  timezone, because then the reader's clock is the only clock there is. When
 *  the gym has set one, `gymWallValue` is what fills this field — the comment
 *  that used to sit here said the browser's clock "is the gym's clock", and it
 *  is not: this console is opened from two desks, an office and, routinely,
 *  another country. */
function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A contact date, in the reader's locale and the GYM's zone.
 *
 *  It was the reader's zone, which is the wrong clock for "when did somebody
 *  last ring this member": a call logged at 22:30 in Dubai reads as the day
 *  before to a manager checking from London, and the pacing rule that keeps a
 *  member from being rung twice is counted in days. */
function shortWhen(iso: string, zone: string | null): string {
  return gymDateText(iso, zone, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '—';
}

/* ── the roster ────────────────────────────────────────────────────────────── */

/**
 * The roster, in surfaced order.
 *
 * Two things about the ordering are load-bearing.
 *
 * QUIETENED ROWS ARE STILL HERE. Somebody contacted three days ago sinks to the
 * bottom of her own band and is greyed; she is not filtered out. A filter would
 * mean the gym stops seeing a member who is still leaving, which trades a
 * nuisance for a blind spot — and the member who most needs a second approach
 * is the one the first one did not reach.
 *
 * THE BANDS DO NOT MOVE. A drifting member who was called on Tuesday still sits
 * above every steady member, because she is still drifting. A contact changes
 * which of the drifting members to look at first; it does not change the
 * verdict, and it must not appear to.
 *
 * When the interventions read fails, `surfaced` is null and the list falls back
 * to the plain retention order with a banner — never silently, because an
 * un-quietened list looks exactly like a gym where nobody has been contacted.
 */
function Roster({ g, rec, contacts, surfaced }: {
  g: GymRetention;
  rec: RetentionRecord;
  contacts: Slice<Contact>;
  surfaced: Surfaced<RetentionRow>[] | null;
}) {
  // Every row, either way. When the contacts read failed each row is wrapped
  // with `contact: null` — and the banner above the table says that is a gap
  // rather than a fact, so a blank column is never read as "nobody has tried".
  const rows: Surfaced<RetentionRow>[] | null = surfaced
    ?? (g.rows == null ? null : g.rows.map((row) => plain(row)));

  const quiet = surfaced ? quietenedCount(surfaced) : 0;
  // The console had no search input on any of its twenty-two pages, and this is
  // the one an owner opens holding a list of names.
  const [q, setQ] = useState('');

  const cols: Column<Surfaced<RetentionRow>>[] = [
    {
      key: 'name', header: 'Member', value: (s) => s.row.name ?? '￿',
      // The link carries the id now. It said `/members` with nothing on it, so
      // this screen named a drifting member, sent the owner to an unselected
      // roster of six hundred, and left them to hunt by eye for the person the
      // page had just identified. /members reads `?member=` on arrival and
      // opens that dossier — see the note on `pick` there.
      render: (s) => (
        <span style={{ opacity: s.quietened ? 0.55 : 1 }}>
          <a href={`/members?member=${encodeURIComponent(s.row.memberId)}`}>
            {s.row.name ?? <span className="dash">unnamed account</span>}
          </a>
        </span>
      ),
    },
    {
      key: 'band', header: 'Pattern', value: (s) => s.row.drift ? -bandOrder(s.row.drift) : null,
      render: (s) => s.row.drift
        ? <span style={{ color: driftColour(s.row.drift), opacity: s.quietened ? 0.7 : 1 }}>{DRIFT_LABEL[s.row.drift.status]}</span>
        // Not "unknown": unknown is a verdict this module is allowed to reach
        // and it means the record holds no pattern. This means we did not read
        // anything that could hold one.
        : <span className="dash">not judged</span>,
    },
    {
      key: 'why', header: 'What the record shows', value: (s) => s.row.drift?.reason ?? null,
      render: (s) => s.row.drift
        ? <span style={{ whiteSpace: 'normal' }}>{s.row.drift.reason}</span>
        : <span className="dash">no attendance read</span>,
    },
    {
      // The column that stops the second phone call.
      key: 'tried', header: 'Already tried', value: (s) => s.contactedDaysAgo,
      numeric: true,
      render: (s) => {
        if (contacts.state === 'loading') return <span className="dash">…</span>;
        if (contacts.state === 'failed') return <span className="dash">not read</span>;
        // A prefix of the contact log cannot say nobody has called — the call
        // may simply be past the rows that came back.
        if (contacts.state === 'partial') return <span className="dash">part read</span>;
        if (!s.contact) return <span className="dash">nobody has</span>;
        return (
          <span style={{ whiteSpace: 'normal', color: s.quietened ? 'var(--ink3)' : 'var(--ink2)' }} title={s.label ?? undefined}>
            {triedLine(s.contact)}
            {s.contactCount > 1 ? ` (${s.contactCount} in all)` : ''}
            {s.quietened && s.quietForDays != null
              ? ` Left alone for another ${s.quietForDays} day${s.quietForDays === 1 ? '' : 's'}.`
              : ''}
          </span>
        );
      },
    },
    {
      key: 'door', header: 'Door vs timetable', value: (s) => s.row.offTimetable ? 2 : s.row.quiet ? 1 : 0,
      render: (s) => {
        if (!s.row.read) return <span className="dash">not judged</span>;
        if (s.row.offTimetable) return <span style={{ color: 'var(--brand)' }}>still training, off the timetable</span>;
        if (s.row.quiet) return <span style={{ color: 'var(--crit)' }}>not seen</span>;
        return <span className="dash">—</span>;
      },
    },
    {
      key: 'seen', header: 'Last at the door', value: (s) => s.row.lastSeenDays, numeric: true,
      render: (s) => rec.visits.state === 'loading' ? <span className="dash">…</span>
        : rec.visits.state === 'failed' ? <span className="dash">not read</span>
        // 'never' over a prefix of the door log is the sentence that gets a
        // member phoned who was in the building yesterday.
        : rec.visits.state === 'partial' ? <span className="dash">part read</span>
        : s.row.lastSeenDays == null ? <span className="dash">never</span>
        : s.row.lastSeenDays === 0 ? 'today' : `${s.row.lastSeenDays}d ago`,
    },
    { key: 'joined', header: 'Joined', value: (s) => s.row.joinedOn },
    {
      key: 'status', header: 'Membership', value: (s) => s.row.status,
      render: (s) => s.row.status
        ? <span style={{ textTransform: 'capitalize' }}>{s.row.status}</span>
        : <span className="dash">—</span>,
    },
  ];

  // Filtered, not re-ordered: the surfacing rule above is the whole point of
  // this table and a search must not disturb it. A gym looking for one name in
  // six hundred still sees that person in their own band.
  const shown = searchRows(rows ?? [], q, (s) => [s.row.name, s.row.planName, s.row.status, s.row.memberId]);
  const note = searchNote(q, shown.length, rows?.length ?? 0);

  return (
    <Section
      title="Every member, worst first"
      sub="Ordered exactly as the coach's client book orders it, so the two screens never name a different person as the one to call — then, within each band only, anybody contacted recently sinks to the bottom."
    >
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '12px 16px 0', flexWrap: 'wrap' }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search a member or a plan"
          aria-label="Search the roster"
          style={{
            padding: '9px 11px', borderRadius: 0, fontSize: 13.5, flex: 1, minWidth: 220,
            background: 'var(--surface2)', color: 'var(--ink)',
            border: '1px solid var(--ring)', fontFamily: 'var(--sans)',
          }}
        />
        {q ? (
          <button
            onClick={() => setQ('')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)' }}
          >clear</button>
        ) : null}
      </div>
      {/* Above the table, because a filtered board that comes back empty is
          indistinguishable from a gym with nobody drifting — and that is the
          one reading this whole screen exists to prevent. */}
      {note ? (
        <p style={{ margin: 0, padding: '8px 16px 0', fontSize: 12.5, color: 'var(--ink3)' }}>{note}</p>
      ) : null}
      {rec.memberships.state === 'loading' ? <Loading /> : null}
      {rec.memberships.state === 'failed' ? (
        <Failed reason={(rec.memberships as { reason: string }).reason} what="the membership list" />
      ) : null}
      {/* The fourth state. A truncated roster is not a failure and is not the
          whole gym: the members past the ceiling are missing from this board,
          and a drifting member who is not on it reads as a member who is fine. */}
      {rec.memberships.state === 'partial' ? (
        <Banner tone="crit">
          Only the first {rec.memberships.cap} members were read, and there are more. This board is a
          PREFIX of the gym, not the gym — somebody absent from it has not been judged and found
          well, they have not been looked at.
        </Banner>
      ) : null}
      {contacts.state === 'failed' ? (
        <Banner tone="crit">
          What has already been tried could not be read, so this list is in its plain order and the
          &ldquo;already tried&rdquo; column is blank for everybody. Blank here means unknown, not untouched —
          somebody may well have been called this week.
        </Banner>
      ) : null}
      {rows ? (
        <DataTable noun="members"
          rows={shown} columns={cols} rowKey={(s) => s.row.memberId}
          empty="No memberships recorded yet. Open one under Money and this page fills in."
        />
      ) : null}
      {surfaced ? (
        <p style={{ margin: 0, padding: '13px 16px', borderTop: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink3)' }}>
          {quiet === 0
            ? 'Nobody has been contacted recently enough to be quietened, so this is the plain order.'
            : `${quiet} member${quiet === 1 ? ' has' : 's have'} been contacted recently and ${quiet === 1 ? 'sits' : 'sit'} at the bottom of ${quiet === 1 ? 'their' : 'their'} own band, greyed — still listed, because somebody who was called and is still leaving is exactly who a gym must not stop seeing. The wait is taken from each member's own rate: a member who trained four times a week comes back up sooner than one who trained fortnightly.`}
        </p>
      ) : null}
    </Section>
  );
}

/** A row nobody could check the contact history for. `contact: null` here means
 *  UNREAD, and the banner above the table says so — the field itself cannot
 *  carry that difference, which is why it is never rendered without it. */
function plain(row: RetentionRow): Surfaced<RetentionRow> {
  return {
    row, contact: null, contactedDaysAgo: null, contactCount: 0,
    pace: paceOf(row.drift), quietened: false, quietForDays: null, label: null,
  };
}

function bandOrder(d: Drift): number {
  return d.status === 'at_risk' ? 3 : d.status === 'idle' ? 2 : d.status === 'watch' ? 1 : 0;
}

function driftColour(d: Drift): string {
  return d.status === 'at_risk' ? 'var(--crit)'
    : d.status === 'watch' ? 'var(--warn)'
    : d.status === 'idle' ? 'var(--ink3)'
    : 'var(--good)';
}

/* ── shared bits (same shapes as the Members and Money screens) ────────────── */

/** A count, or null so the KPI draws a dash. Never String(0) for an unknown. */
function num(n: number | null): string | null {
  return n == null ? null : String(n);
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
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

function Failed({ reason, what }: { reason: string; what: string }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {what}. This section is <strong>unknown</strong>, not empty.
      <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{reason}</div>
    </div>
  );
}

