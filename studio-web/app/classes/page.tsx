'use client';

// Classes — are they working?
//
// The Timetable answers "what is on, and who is on the floor". It cannot answer
// the question an owner actually asks before they cut a slot or hire a coach:
// are these classes full, do the people who book turn up, and where exactly are
// the empty places. Those are three different numbers and the gym has been
// guessing at all three from a week grid.
//
// Two rates, kept apart on purpose, because collapsing them is how a class read
// 71% in one place and 80% in another:
//
//   · FILL is booked / capacity — how much of the room was sold;
//   · SHOW is attended / booked — how many of the sold places walked in.
//
// A class can be 100% full and 40% show, which is a booking problem, or 30%
// full and 100% show, which is a demand problem. One number cannot tell an
// owner which of those they have, and the fix for each is the opposite of the
// fix for the other.
//
// The arithmetic is `summariseClassRows` in src/lib/classRates.ts, unchanged and
// shared with the phone app so the two cannot disagree. It sums first and
// divides once, so a class of three cannot swing the headline the way an
// average-of-averages would, and it returns null rather than 0 when a
// denominator was never recorded. This screen prints that null as a dash and
// says which denominator was missing.
//
// Three things this page refuses to do:
//
//   · count classes that have not happened yet. The window ends at this moment.
//     An unsold seat in next Tuesday's class is not an empty place, it is a seat
//     that is still for sale, and folding it in makes a healthy timetable look
//     like a failing one. The count of upcoming classes is read separately and
//     said out loud rather than silently dropped;
//   · put a class with no recorded capacity into the fill rate. Its bookings
//     would land in the numerator and nothing in the denominator, which reads
//     as a fuller gym than the room was. Those classes are excluded from fill
//     and counted on screen, so the exclusion is visible rather than tidy;
//   · treat an unmarked register as an empty class. `attended` is only ever what
//     somebody ticked. A slot where nobody was marked present looks identical to
//     a slot nobody attended, so those classes get their own section and the
//     register can be marked from it, rather than being quietly averaged into a
//     show rate that then reports the gym's own paperwork back as churn.
//
// NOTE on src/lib/classAttendance.ts: its `classSummary` / `classRoster` /
// `setAttendance` cannot be used from this console. That module builds a
// Supabase client at import time from EXPO_PUBLIC_* env vars and React Native's
// AsyncStorage; under Next those vars are undefined, so createClient throws on
// import, and even if it did not, the RN client carries no browser session and
// every RPC would come back refused by RLS. The equivalents in gymSchedule.ts
// take the client as an argument — the same tables, the same writes — so this
// page uses those and the shared rate maths from classRates.ts, which imports
// nothing and is what classAttendance itself re-exports.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchClasses, fetchRoster, setAttendance, pct,
  type GymClass, type RosterEntry,
} from '@lib/gymSchedule';
import { fetchTrainerOptions } from '@lib/gymPtSchedule';
import { summariseClassRows, type ClassSummaryRow, type ClassRates } from '@lib/classRates';

const DAY = 86400000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 28, label: '28 days' },
  { days: 90, label: '90 days' },
] as const;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "No classes ran in this window" are both lies about a query that errored, and
 * an owner acts on both of them — one by waiting, the other by cutting a class
 * off the timetable because the console told them nobody came to it.
 */
type Unread = 'loading' | 'failed' | null;

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as any)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

interface Trainer { id: string; name: string | null }

export default function Classes() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [trainers, setTrainers] = useState<Trainer[] | null>(null);
  const [upcoming, setUpcoming] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<number>(28);
  const [open, setOpen] = useState<GymClass | null>(null);

  const load = useCallback(async (tenantId: string, window: number) => {
    setClasses(null); setTrainers(null); setUpcoming(null); setErr(null);
    const now = Date.now();
    // The window ends now, not at midnight and not at the end of the week: a
    // class that has not started cannot have a show rate, and its unsold seats
    // are still on sale.
    const from = new Date(now - window * DAY).toISOString();
    const to = new Date(now).toISOString();

    // allSettled, not all: one failing read must not take the others with it.
    // Under Promise.all a refused `trainers` read — which costs nothing but a
    // coach's name — would have emptied the classes as well, and the page would
    // have reported a gym that ran no classes at all for the month.
    const [cRes, tRes, uRes] = await Promise.allSettled([
      fetchClasses(supabase, tenantId, from, to),
      fetchTrainerOptions(supabase, tenantId),
      fetchClasses(supabase, tenantId, to, new Date(now + 28 * DAY).toISOString()),
    ]);

    // A read that failed is null, never []. [] is the gym saying it ran none;
    // null is nobody knowing. An owner acts differently on the two.
    setClasses(cRes.status === 'fulfilled' ? cRes.value : null);
    setTrainers(tRes.status === 'fulfilled' ? tRes.value : null);
    setUpcoming(uRes.status === 'fulfilled' ? uRes.value.length : null);

    const trouble = [
      failure(cRes, 'the classes in this window'),
      failure(tRes, 'the coach names'),
      failure(uRes, 'the classes still to run'),
    ].filter((s): s is string => s !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setClasses([]); setTrainers([]); setUpcoming(0); return; }
      const { data: t } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) setGymName(t?.name ?? null);
      await load(who.tenantId, days);
    })();
    return () => { live = false; };
  }, [load, days]);

  const nameOf = useCallback((c: GymClass): string => {
    const written = c.instructor?.trim();
    if (written) return written;
    const t = (trainers ?? []).find((x) => x.id === c.trainerId);
    return t?.name?.trim() ?? '';
  }, [trainers]);

  // The shared row shape, so the shared rate maths can be used unchanged.
  // `kind` and `branch` are left empty rather than invented: neither is read by
  // this screen, and nothing below ever renders them.
  const rows: ClassSummaryRow[] = useMemo(
    () => (classes ?? []).map((c) => ({
      classId: c.id,
      title: c.title,
      kind: '',
      branch: '',
      trainerId: c.trainerId ?? '',
      trainerName: nameOf(c),
      startsAt: c.startsAt,
      capacity: c.capacity || 0,
      booked: c.booked,
      attended: c.attended,
    })),
    [classes, nameOf],
  );

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/classes">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          Class performance across every coach is an owner's screen. Your own classes and their
          registers are on the Timetable.
        </p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId, days);

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread: Unread = classes !== null ? null : err ? 'failed' : 'loading';

  // Two summaries over two different sets, and the difference is on screen
  // rather than buried. `all` is every class that ran; `rated` is only those
  // that recorded a capacity, because a class with none puts its bookings into
  // fill's numerator and nothing into its denominator — which reads as a fuller
  // room than the gym actually sold.
  const all: ClassRates | null = classes ? summariseClassRows(rows) : null;
  const capacityless = rows.filter((r) => r.capacity <= 0);
  const rated: ClassRates | null = classes ? summariseClassRows(rows.filter((r) => r.capacity > 0)) : null;

  const emptyPlaces = rated && rated.capacity > 0 ? Math.max(0, rated.capacity - rated.booked) : null;
  const overbooked = rows.filter((r) => r.capacity > 0 && r.booked > r.capacity);
  const unmarked = (classes ?? []).filter((c) => c.booked > 0 && c.attended === 0);

  return (
    <Shell me={me} gymName={gymName} current="/classes">
      <h1>Classes</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Fill is how much of the room sold. Show is how much of what sold turned up. They are
        different problems with opposite fixes, so they are never added together here.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div style={{ display: 'flex', gap: 7, margin: '18px 0 0', flexWrap: 'wrap' }}>
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            onClick={() => setDays(w.days)}
            style={{
              ...field, cursor: 'pointer',
              background: w.days === days ? 'var(--surface3)' : 'var(--surface2)',
              color: w.days === days ? 'var(--ink)' : 'var(--ink2)',
            }}
          >
            {w.label}
          </button>
        ))}
        <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--ink3)' }}>
          ending now — nothing below counts a class that has not started
        </span>
      </div>

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 8, overflow: 'hidden', margin: '18px 0 26px',
        }}
      >
        <Kpi
          label="Classes run"
          text={all ? String(all.classes) : null}
          note={
            upcoming == null
              ? (classes ? 'the classes still to run could not be read' : undefined)
              : upcoming === 0 ? 'none on the timetable for the next 4 weeks'
              : `${upcoming} still to run, not counted here`
          }
        />
        <Kpi
          label="Places offered"
          text={rated && rated.capacity > 0 ? String(rated.capacity) : null}
          note={
            rated == null ? undefined
              : rated.capacity > 0
                ? (capacityless.length > 0 ? `${capacityless.length} class${capacityless.length === 1 ? '' : 'es'} record no capacity` : undefined)
                : whyNoCapacity(all)
          }
        />
        <Kpi label="Places booked" text={all ? String(all.booked) : null} />
        <Kpi
          label="Fill"
          text={rated ? pct(rated.fill) : null}
          note={
            rated == null ? undefined
              : rated.fill == null ? whyNoCapacity(all)
              : `${rated.booked} of ${rated.capacity} places over ${rated.classes} class${rated.classes === 1 ? '' : 'es'}`
          }
        />
        <Kpi
          label="Empty places"
          text={emptyPlaces == null ? null : String(emptyPlaces)}
          note={emptyPlaces == null ? whyNoCapacity(all) : 'places that went unsold'}
        />
        <Kpi
          label="Show"
          text={all ? pct(all.show) : null}
          note={
            all == null ? undefined
              : all.show == null ? whyNoShow(all)
              : all.attended === 0 ? 'nobody marked present anywhere — see below'
              : `${all.attended} of ${all.booked} booked places`
          }
        />
      </div>

      {rated && capacityless.length > 0 ? (
        <Banner>
          {capacityless.length === 1 ? '1 class records' : `${capacityless.length} classes record`} no
          capacity, so {capacityless.length === 1 ? 'it is' : 'they are'} left out of Fill and Empty
          places entirely — counting {capacityless.length === 1 ? 'its' : 'their'}{' '}
          {capacityless.reduce((a, r) => a + r.booked, 0)} booking
          {capacityless.reduce((a, r) => a + r.booked, 0) === 1 ? '' : 's'} without a room size would
          make the gym read fuller than it sold. Set a capacity on the Timetable and they join the rate.
        </Banner>
      ) : null}

      {overbooked.length > 0 ? (
        <Banner>
          {overbooked.length === 1 ? '1 class took' : `${overbooked.length} classes took`} more
          bookings than {overbooked.length === 1 ? 'its' : 'their'} capacity. Fill can therefore read
          above 100% — it is a real over-sell, not a rounding artefact.
        </Banner>
      ) : null}

      <Empties rows={rows} unread={unread} />
      <Unmarked classes={unmarked} unread={unread} nameOf={nameOf} onOpen={setOpen} />
      <ByCoach rows={rows} unread={unread} />
      <EveryClass classes={classes ?? []} rows={rows} unread={unread} nameOf={nameOf} onOpen={setOpen} />

      {open ? <Roster gymClass={open} onClose={() => { setOpen(null); refresh(); }} /> : null}
    </Shell>
  );
}

/* ── reasons a rate has no value ───────────────────────────────────────────── */

/** Why Fill / Places / Empty places is a dash. Never "0" — a rate with no
 *  denominator is a question nobody answered, not a bad answer. */
function whyNoCapacity(all: ClassRates | null): string {
  if (all == null) return 'not read';
  if (all.classes === 0) return 'no classes ran in this window';
  return 'no class in this window records a capacity';
}

/** Why Show is a dash. A class nobody booked has no show rate; that is not the
 *  same as everybody failing to turn up. */
function whyNoShow(all: ClassRates | null): string {
  if (all == null) return 'not read';
  if (all.classes === 0) return 'no classes ran in this window';
  return 'nothing was booked, so there is nothing to have shown up';
}

/* ── where the empty places are ────────────────────────────────────────────── */

interface Slot {
  key: string;
  title: string;
  when: string;
  rates: ClassRates;
  empty: number | null;
}

/**
 * The recurring slot, not the single class.
 *
 * "Tuesday 06:00 Spin is half empty" is something an owner can move, merge or
 * cut. "The Spin on the 4th was half empty" is weather. So classes are grouped
 * by title and by the weekday-and-hour they run at, which is the thing that
 * actually repeats on a timetable, and the rate is taken over the group.
 */
function groupSlots(rows: ClassSummaryRow[]): Slot[] {
  const buckets = new Map<string, ClassSummaryRow[]>();
  for (const r of rows) {
    const t = new Date(r.startsAt);
    if (Number.isNaN(t.getTime())) continue;
    const key = `${r.title}|${t.getDay()}|${t.getHours()}`;
    const b = buckets.get(key);
    if (b) b.push(r); else buckets.set(key, [r]);
  }
  const out: Slot[] = [];
  buckets.forEach((group, key) => {
    const t = new Date(group[0].startsAt);
    const rates = summariseClassRows(group);
    out.push({
      key,
      title: group[0].title,
      when: `${DAY_NAMES[t.getDay()]} ${String(t.getHours()).padStart(2, '0')}:00`,
      rates,
      // Null, not zero: a slot whose classes never recorded a capacity has an
      // unknown number of empty places, and unknown sorts to the bottom rather
      // than reading as a slot that sells out.
      empty: rates.capacity > 0 ? Math.max(0, rates.capacity - rates.booked) : null,
    });
  });
  return out.sort((a, b) => {
    if (a.empty == null && b.empty == null) return 0;
    if (a.empty == null) return 1;
    if (b.empty == null) return -1;
    return b.empty - a.empty;
  });
}

function Empties({ rows, unread }: { rows: ClassSummaryRow[]; unread: Unread }) {
  const slots = useMemo(() => groupSlots(rows), [rows]);

  const cols: Column<Slot>[] = [
    { key: 'slot', header: 'Slot', value: (s) => `${s.when} ${s.title}`,
      render: (s) => (
        <span>
          <span className="mono" style={{ color: 'var(--ink3)', marginRight: 8 }}>{s.when}</span>
          {s.title}
        </span>
      ) },
    { key: 'ran', header: 'Ran', value: (s) => s.rates.classes, numeric: true },
    { key: 'empty', header: 'Empty places', value: (s) => s.empty, numeric: true,
      render: (s) => s.empty == null
        ? <span className="dash" title="no class in this slot records a capacity">— no capacity</span>
        : String(s.empty) },
    { key: 'fill', header: 'Fill', value: (s) => s.rates.fill, numeric: true,
      render: (s) => pct(s.rates.fill) ?? <span className="dash">— no capacity</span> },
    { key: 'show', header: 'Show', value: (s) => s.rates.show, numeric: true,
      render: (s) => pct(s.rates.show) ?? <span className="dash">— nothing booked</span> },
  ];

  return (
    <Section
      title="Where the empty places are"
      sub="Grouped by the slot that repeats, worst first. A single quiet Tuesday is weather; the same Tuesday quiet for a month is a decision waiting to be made."
    >
      {unread ? <Unresolved state={unread} what="the classes" /> : (
        <DataTable
          rows={slots} columns={cols} rowKey={(s) => s.key}
          empty="No classes ran in this window, so there are no empty places to report — which is not the same as a full gym."
        />
      )}
    </Section>
  );
}

/* ── registers nobody marked ───────────────────────────────────────────────── */

/**
 * The classes that make the show rate a lie.
 *
 * `attended` is only ever what somebody ticked. A class with eight bookings and
 * nobody marked present is indistinguishable from a class eight people skipped,
 * and the second reading is the one that ends up in a coach's review. So they
 * are pulled out and named as paperwork rather than averaged in as churn — and
 * the register can be marked from here, because the owner reading this is the
 * person who noticed.
 */
function Unmarked({ classes, unread, nameOf, onOpen }: {
  classes: GymClass[]; unread: Unread; nameOf: (c: GymClass) => string;
  onOpen: (c: GymClass) => void;
}) {
  const cols: Column<GymClass>[] = [
    { key: 'when', header: 'When', value: (c) => c.startsAt,
      render: (c) => new Date(c.startsAt).toLocaleString([], {
        weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      }) },
    { key: 'title', header: 'Class', value: (c) => c.title },
    { key: 'coach', header: 'Coach', value: (c) => nameOf(c) || null,
      render: (c) => nameOf(c) || <span className="dash">— no coach recorded</span> },
    { key: 'booked', header: 'Booked', value: (c) => c.booked, numeric: true },
    { key: 'mark', header: '', value: () => 0, align: 'right',
      render: (c) => <button style={linkBtn} onClick={() => onOpen(c)}>Mark the register</button> },
  ];

  if (unread) {
    return (
      <Section title="Registers nobody marked" sub="Bookings with nobody ticked present.">
        <Unresolved state={unread} what="the classes" />
      </Section>
    );
  }
  if (classes.length === 0) return null;

  return (
    <Section
      title="Registers nobody marked"
      sub="These classes had bookings and nobody marked present. They are counted as 0 attended in the show rate above, which reads the same whether nobody came or nobody ticked."
    >
      <DataTable rows={classes} columns={cols} rowKey={(c) => c.id} empty="Every register in this window has been marked." />
    </Section>
  );
}

/* ── by coach ──────────────────────────────────────────────────────────────── */

interface CoachRow { key: string; name: string | null; rates: ClassRates; empty: number | null }

function ByCoach({ rows, unread }: { rows: ClassSummaryRow[]; unread: Unread }) {
  const coaches = useMemo<CoachRow[]>(() => {
    const buckets = new Map<string, ClassSummaryRow[]>();
    for (const r of rows) {
      // Bucketed by trainer id where there is one, so two coaches who share a
      // first name are not silently added together; only classes with neither
      // an id nor a written instructor fall into the unattributed bucket.
      const key = r.trainerId || (r.trainerName ? `name:${r.trainerName}` : '');
      const b = buckets.get(key);
      if (b) b.push(r); else buckets.set(key, [r]);
    }
    const out: CoachRow[] = [];
    buckets.forEach((group, key) => {
      const rates = summariseClassRows(group);
      out.push({
        key: key || 'unattributed',
        // An unnamed coach is a dash, not "Trainer": a made-up label on a
        // performance table gets read as a person.
        name: group.find((g) => g.trainerName)?.trainerName ?? null,
        rates,
        empty: rates.capacity > 0 ? Math.max(0, rates.capacity - rates.booked) : null,
      });
    });
    return out.sort((a, b) => b.rates.classes - a.rates.classes);
  }, [rows]);

  const cols: Column<CoachRow>[] = [
    { key: 'coach', header: 'Coach', value: (c) => c.name,
      render: (c) => c.name ?? <span className="dash">— not recorded</span> },
    { key: 'ran', header: 'Ran', value: (c) => c.rates.classes, numeric: true },
    { key: 'booked', header: 'Booked', value: (c) => c.rates.booked, numeric: true },
    { key: 'empty', header: 'Empty places', value: (c) => c.empty, numeric: true,
      render: (c) => c.empty == null ? <span className="dash">— no capacity</span> : String(c.empty) },
    { key: 'fill', header: 'Fill', value: (c) => c.rates.fill, numeric: true,
      render: (c) => pct(c.rates.fill) ?? <span className="dash">— no capacity</span> },
    { key: 'show', header: 'Show', value: (c) => c.rates.show, numeric: true,
      render: (c) => pct(c.rates.show) ?? <span className="dash">— nothing booked</span> },
  ];

  return (
    <Section
      title="By coach"
      sub="Whose room fills, and whose bookings turn up. Read it beside the number of classes each ran — one class is not a record."
    >
      {unread ? <Unresolved state={unread} what="the classes" /> : (
        <DataTable
          rows={coaches} columns={cols} rowKey={(c) => c.key}
          empty="No classes ran in this window."
        />
      )}
    </Section>
  );
}

/* ── every class ───────────────────────────────────────────────────────────── */

function EveryClass({ classes, rows, unread, nameOf, onOpen }: {
  classes: GymClass[]; rows: ClassSummaryRow[]; unread: Unread;
  nameOf: (c: GymClass) => string; onOpen: (c: GymClass) => void;
}) {
  const rateOf = useMemo(() => {
    const m = new Map<string, ClassRates>();
    for (const r of rows) m.set(r.classId, summariseClassRows([r]));
    return m;
  }, [rows]);

  const cols: Column<GymClass>[] = [
    { key: 'when', header: 'When', value: (c) => c.startsAt,
      render: (c) => new Date(c.startsAt).toLocaleString([], {
        weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      }) },
    { key: 'title', header: 'Class', value: (c) => c.title },
    { key: 'coach', header: 'Coach', value: (c) => nameOf(c) || null,
      render: (c) => nameOf(c) || <span className="dash">—</span> },
    { key: 'cap', header: 'Capacity', value: (c) => (c.capacity > 0 ? c.capacity : null), numeric: true,
      // Zero capacity is a class nobody sized, not a class with no room in it.
      render: (c) => c.capacity > 0 ? String(c.capacity) : <span className="dash">— not set</span> },
    { key: 'booked', header: 'Booked', value: (c) => c.booked, numeric: true },
    { key: 'empty', header: 'Empty', value: (c) => (c.capacity > 0 ? Math.max(0, c.capacity - c.booked) : null), numeric: true,
      render: (c) => c.capacity > 0
        ? String(Math.max(0, c.capacity - c.booked))
        : <span className="dash">—</span> },
    { key: 'fill', header: 'Fill', value: (c) => rateOf.get(c.id)?.fill ?? null, numeric: true,
      render: (c) => pct(rateOf.get(c.id)?.fill ?? null) ?? <span className="dash">—</span> },
    { key: 'attended', header: 'Attended', value: (c) => c.attended, numeric: true },
    { key: 'show', header: 'Show', value: (c) => rateOf.get(c.id)?.show ?? null, numeric: true,
      render: (c) => pct(rateOf.get(c.id)?.show ?? null) ?? <span className="dash">—</span> },
    { key: 'roster', header: '', value: () => 0, align: 'right',
      render: (c) => <button style={linkBtn} onClick={() => onOpen(c)}>Roster</button> },
  ];

  return (
    <Section
      title="Every class in the window"
      sub="One row per class that has already started. A dash in Fill or Show is a denominator that was never recorded, not a rate of nil."
    >
      {unread ? <Unresolved state={unread} what="the classes" /> : (
        <DataTable
          rows={classes} columns={cols} rowKey={(c) => c.id}
          empty="No classes ran in this window."
        />
      )}
    </Section>
  );
}

/* ── the roster ────────────────────────────────────────────────────────────── */

function Roster({ gymClass, onClose }: { gymClass: GymClass; onClose: () => void }) {
  const [rows, setRows] = useState<RosterEntry[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await fetchRoster(supabase, gymClass.id)); setFailed(null); }
    catch (e: any) {
      // Left as null, not set to []: an empty roster under "Nobody booked" is a
      // confident statement about a class made by code that never read it.
      setRows(null);
      setFailed(e?.message ?? 'Could not read the roster.');
    }
  }, [gymClass.id]);

  useEffect(() => { load(); }, [load]);

  // setAttendance throws on a refused update. Unreported, the tick simply does
  // not move and the owner ticks again — so a member who attended stays
  // recorded absent, and the show rate on the screen behind this one keeps the
  // wrong number.
  const toggle = async (r: RosterEntry) => {
    setMsg(null);
    try {
      await setAttendance(supabase, r.bookingId, !r.attendedAt);
      await load();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not save that check-in.');
    }
  };

  const present = rows ? rows.filter((r) => r.attendedAt).length : null;

  return (
    <div
      role="dialog"
      aria-label={`Register for ${gymClass.title}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'grid', placeItems: 'center', padding: 24, zIndex: 10,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '100%', maxHeight: '80vh', overflow: 'auto',
          background: 'var(--surface)', border: '1px solid var(--ring)', borderRadius: 10,
        }}
      >
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid var(--ring)',
          display: 'flex', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <h2>{gymClass.title}</h2>
            <p style={{ margin: '3px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>
              {new Date(gymClass.startsAt).toLocaleString()} · {gymClass.booked} booked
              {gymClass.capacity > 0 ? ` of ${gymClass.capacity}` : ' · capacity not set'}
              {present == null ? '' : ` · ${present} marked present`}
            </p>
          </div>
          <button onClick={onClose} style={ghostBtn}>Done</button>
        </div>

        {failed ? <Banner tone="crit">{failed}</Banner> : null}
        {msg ? <p style={{ margin: '12px 16px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}

        {rows === null ? (
          <div style={{ padding: '26px 18px', color: 'var(--ink3)', fontSize: 13.5 }}>
            {failed ? 'The roster did not come back, so nobody can be marked from here.' : 'Loading…'}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '26px 18px', color: 'var(--ink3)', fontSize: 13.5 }}>
            Nobody booked this class. That is a fill problem, not a register one.
          </div>
        ) : (
          <div>
            {rows.map((r) => (
              <div
                key={r.bookingId}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--ring)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--ink2)' }}>
                    {r.name ?? <span className="dash">name not readable</span>}
                  </div>
                  <div className="micro" style={{ marginTop: 2 }}>{r.status}</div>
                </div>
                <button
                  onClick={() => toggle(r)}
                  style={{
                    ...field, cursor: 'pointer', flex: 'none',
                    background: r.attendedAt ? 'var(--surface3)' : 'var(--surface2)',
                    color: r.attendedAt ? 'var(--good)' : 'var(--ink2)',
                  }}
                >
                  {r.attendedAt ? 'Present' : 'Mark present'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── shared bits (same shapes as the Door screen) ──────────────────────────── */

const field = {
  padding: '9px 11px', borderRadius: 7, fontSize: 13.5,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const ghostBtn = {
  ...field, background: 'var(--surface2)', color: 'var(--ink2)',
  cursor: 'pointer', flex: 'none',
} as const;

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
      <div
        className="mono"
        style={{
          fontSize: 21, marginTop: 5, letterSpacing: '-0.02em',
          color: text == null ? 'var(--ink3)' : 'var(--ink)',
        }}
      >
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
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--warn)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read used to fall through to the table's own empty line, so "we
 * could not ask" and "the gym ran no classes" were the same sentence — and the
 * second one gets a class cut off the timetable.
 */
function Unresolved({ state, what }: { state: Exclude<Unread, null>; what: string }) {
  return (
    <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
      {state === 'loading' ? 'Loading…' : `Could not read ${what}. The banner above says why.`}
    </div>
  );
}
