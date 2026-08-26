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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships } from '@lib/gymRecord';
import { fetchVisits } from '@lib/gymVisits';
import { fetchClasses } from '@lib/gymSchedule';
import { fetchSessions } from '@lib/gymSessions';
import { sliceLoading, sliceReady, sliceFailed, type Slice, type MemberBooking } from '@lib/memberView';
import { bandTitle, bandNote, DRIFT_LABEL, type Drift } from '@lib/clientDrift';
import {
  buildGymRetention, headline, suppressionNote,
  type RetentionRecord, type RetentionRow, type Cohort, type GymRetention,
} from '@lib/gymRetention';

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

const EMPTY: RetentionRecord = {
  memberships: sliceLoading(),
  visits: sliceLoading(),
  bookings: sliceLoading(),
  sessions: sliceLoading(),
};

export default function RetentionPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [rec, setRec] = useState<RetentionRecord>(EMPTY);

  const load = useCallback(async (tenantId: string) => {
    setRec(EMPTY);
    const sinceIso = new Date(Date.now() - WINDOW_DAYS * DAY).toISOString();

    // Four independent reads, deliberately not one Promise.all with a single
    // catch. A door log that 500s must not take the roster down with it — the
    // page is allowed to be partial, but only if it says which part and what
    // that part was carrying.
    const [memberships, visits, bookings, sessions] = await Promise.all([
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchVisits(supabase, tenantId, { sinceIso })),
      slice(() => fetchBookings(tenantId, sinceIso)),
      slice(() => fetchSessions(supabase, tenantId, sinceIso)),
    ]);
    setRec({ memberships, visits, bookings, sessions });
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) {
        setRec({
          memberships: sliceReady([]), visits: sliceReady([]),
          bookings: sliceReady([]), sessions: sliceReady([]),
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

  // `now` is pinned per render of the record rather than read inside each
  // helper, so the cohort spine and the drift windows cannot land either side
  // of a month boundary and disagree with each other on the same screen.
  const g = useMemo(() => buildGymRetention(rec, { now: Date.now() }), [rec]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

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

  return (
    <Shell me={me} gymName={gymName} current="/retention">
      <h1>Retention</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        How many members the gym is keeping, how many are breaking their own
        pattern, how many have gone quiet — and the one only a gym with a door
        log can see: how many are still training but no longer on the timetable.
      </p>

      {g.warning ? <Banner tone="crit">{g.warning}</Banner> : null}
      {g.caveat ? <Banner>{g.caveat}</Banner> : null}
      {g.blocker ? <Banner tone="warn">{g.blocker}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 8, overflow: 'hidden', margin: '20px 0 26px',
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
      </div>

      {line ? (
        <p style={{
          margin: '0 0 22px', padding: '13px 15px', borderRadius: 8,
          border: '1px solid var(--ring)', borderLeft: '3px solid var(--brand)',
          background: 'var(--surface)', color: 'var(--ink2)', fontSize: 13.5,
        }}>{line}</p>
      ) : null}

      <Bands g={g} loading={loading} />
      <Cohorts g={g} loading={loading} />
      <Roster g={g} rec={rec} />
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
      style={{ display: 'block', borderRadius: 5, overflow: 'hidden', background: 'var(--surface2)' }}
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
      <span style={{ width: 3, borderRadius: 2, background: colour, flex: 'none' }} aria-hidden="true" />
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
              <DataTable
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
      <span style={{ width: 9, height: 9, borderRadius: 2, background: colour }} aria-hidden="true" />
      {children}
    </span>
  );
}

/** 'Aug 2026' → 'Aug 26'. 'Before that' is left alone. */
function shortLabel(label: string): string {
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(label);
  return m ? `${m[1]} ${m[2].slice(2)}` : label.length > 8 ? label.slice(0, 8) : label;
}

/* ── the roster ────────────────────────────────────────────────────────────── */

function Roster({ g, rec }: { g: GymRetention; rec: RetentionRecord }) {
  const rows = g.rows;

  const cols: Column<RetentionRow>[] = [
    {
      key: 'name', header: 'Member', value: (r) => r.name ?? '￿',
      render: (r) => (
        <a href="/members">{r.name ?? <span className="dash">unnamed account</span>}</a>
      ),
    },
    {
      key: 'band', header: 'Pattern', value: (r) => r.drift ? -bandOrder(r.drift) : null,
      render: (r) => r.drift
        ? <span style={{ color: driftColour(r.drift) }}>{DRIFT_LABEL[r.drift.status]}</span>
        // Not "unknown": unknown is a verdict this module is allowed to reach
        // and it means the record holds no pattern. This means we did not read
        // anything that could hold one.
        : <span className="dash">not judged</span>,
    },
    {
      key: 'why', header: 'What the record shows', value: (r) => r.drift?.reason ?? null,
      render: (r) => r.drift
        ? <span style={{ whiteSpace: 'normal' }}>{r.drift.reason}</span>
        : <span className="dash">no attendance read</span>,
    },
    {
      key: 'door', header: 'Door vs timetable', value: (r) => r.offTimetable ? 2 : r.quiet ? 1 : 0,
      render: (r) => {
        if (!r.read) return <span className="dash">not judged</span>;
        if (r.offTimetable) return <span style={{ color: 'var(--brand)' }}>still training, off the timetable</span>;
        if (r.quiet) return <span style={{ color: 'var(--crit)' }}>not seen</span>;
        return <span className="dash">—</span>;
      },
    },
    {
      key: 'seen', header: 'Last at the door', value: (r) => r.lastSeenDays, numeric: true,
      render: (r) => rec.visits.state === 'loading' ? <span className="dash">…</span>
        : rec.visits.state === 'failed' ? <span className="dash">not read</span>
        : r.lastSeenDays == null ? <span className="dash">never</span>
        : r.lastSeenDays === 0 ? 'today' : `${r.lastSeenDays}d ago`,
    },
    { key: 'joined', header: 'Joined', value: (r) => r.joinedOn },
    {
      key: 'status', header: 'Membership', value: (r) => r.status,
      render: (r) => r.status
        ? <span style={{ textTransform: 'capitalize' }}>{r.status}</span>
        : <span className="dash">—</span>,
    },
  ];

  return (
    <Section
      title="Every member, worst first"
      sub="Ordered exactly as the coach's client book orders it, so the two screens never name a different person as the one to call."
    >
      {rec.memberships.state === 'loading' ? <Loading /> : null}
      {rec.memberships.state === 'failed' ? (
        <Failed reason={(rec.memberships as { reason: string }).reason} what="the membership list" />
      ) : null}
      {rows ? (
        <DataTable
          rows={rows} columns={cols} rowKey={(r) => r.memberId}
          empty="No memberships recorded yet. Open one under Money and this page fills in."
        />
      ) : null}
    </Section>
  );
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
    <section style={{ border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, text, note, tone }: {
  label: string; text: string | null; note?: string; tone?: 'good' | 'crit' | 'brand';
}) {
  const colour = text == null ? 'var(--ink3)'
    : tone === 'good' ? 'var(--good)'
    : tone === 'crit' ? 'var(--crit)'
    : tone === 'brand' ? 'var(--brand)'
    : 'var(--ink)';
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
      <div className="micro">{label}</div>
      <div className="mono" style={{ fontSize: 21, marginTop: 5, letterSpacing: '-0.02em', color: colour }}>
        {text ?? '—'}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 3 }}>{note}</div> : null}
    </div>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone?: 'crit' | 'warn' }) {
  const edge = tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn)' : 'var(--brand)';
  return (
    <div style={{
      margin: '14px 0', padding: '11px 14px', borderRadius: 8, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${edge}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

function Failed({ reason, what }: { reason: string; what: string }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 8,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {what}. This section is <strong>unknown</strong>, not empty.
      <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{reason}</div>
    </div>
  );
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
