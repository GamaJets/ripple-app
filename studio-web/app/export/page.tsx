'use client';

// Export — the gym takes its whole record out.
//
// Roadmap Phase 2: "Exports everywhere. It is the gym's record; leaving must be
// possible." A gym that cannot leave is not a customer, it is a hostage, and a
// record that only exists inside one vendor's console is not the gym's record
// at all. This screen is the answer to "what happens if we stop paying you".
//
// It is the owner-side sibling of the member's own GDPR export in
// src/lib/gdpr.ts: same promise, the other end of the tenant.
//
// ── Why this page is mostly about failure ────────────────────────────────
//
// Eleven independent reads, and the temptation is one `Promise.all` with one
// `catch`. That is exactly wrong here. supabase-js RESOLVES on a database
// error — `{ data: null, error }` — so a read that failed and a read that came
// back empty are the same shape unless `.error` is checked, and an export that
// quietly wrote an empty `payments.csv` would tell the gym they took no money.
// A gym that believes it holds its record and does not is worse off than a gym
// with no export at all.
//
// So: every read carries its own three states (not loaded / loaded and empty /
// the read failed), the button will not build a bundle while anything is still
// in flight, and a read that has definitively failed produces a loudly-named
// stub in place of its CSV, an INCOMPLETE in every filename, and a warning at
// the top of the README. src/lib/gymExport.ts does that part; this file's only
// job is to be honest about what it managed to read.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchPlans, fetchMemberships, fetchPayments } from '@lib/gymRecord';
import { fetchClasses } from '@lib/gymSchedule';
import { fetchSessions } from '@lib/gymSessions';
import { fetchPassTypes, fetchPasses } from '@lib/gymPasses';
import { fetchVisits } from '@lib/gymVisits';
import { fetchInvites } from '@lib/memberInvites';
import { sliceLoading, sliceReady, sliceFailed } from '@lib/memberView';
import {
  buildGymExport, exportBlocker, partSlice,
  EXPORT_PARTS, EXPORT_LABEL, EXPORT_COST,
  type ExportPart, type ExportFile, type GymExportInput,
  type Slice, type MemberBooking, type GymClass,
} from '@lib/gymExport';

/**
 * The bounds the time-ranged reads are made over.
 *
 * An export is the whole record, so these are deliberately wide rather than the
 * 30- or 90-day windows the other screens use. They are still stated in the
 * manifest, because a bundle that implies it covers all of time without saying
 * where it actually looked is making a promise it cannot check.
 */
const FROM = '1970-01-01T00:00:00.000Z';
const TO = '2100-01-01T00:00:00.000Z';

/** How many class ids go into one `.in(...)` filter. A gym with years of
 *  timetable has thousands, and one filter holding all of them is a URL long
 *  enough for the gateway to reject — which would read as "no bookings". */
const ID_CHUNK = 150;

type Reads = Omit<GymExportInput, 'gymName' | 'tenantId' | 'generatedAt' | 'from' | 'to'>;

const PENDING: Reads = {
  plans: sliceLoading(),
  memberships: sliceLoading(),
  payments: sliceLoading(),
  classes: sliceLoading(),
  attendance: sliceLoading(),
  sessions: sliceLoading(),
  passTypes: sliceLoading(),
  passes: sliceLoading(),
  visits: sliceLoading(),
  invites: sliceLoading(),
};

const EMPTY: Reads = {
  plans: sliceReady([]),
  memberships: sliceReady([]),
  payments: sliceReady([]),
  classes: sliceReady([]),
  attendance: sliceReady([]),
  sessions: sliceReady([]),
  passTypes: sliceReady([]),
  passes: sliceReady([]),
  visits: sliceReady([]),
  invites: sliceReady([]),
};

export default function ExportPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [reads, setReads] = useState<Reads>(PENDING);
  const [readAt, setReadAt] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    setReads(PENDING);
    setReadAt(null);

    // The timetable and its bookings are one read with two outputs: a booking
    // is looked up BY class, so bookings cannot be read at all if the classes
    // could not be. Failing them together, and saying so, is the only honest
    // shape — an empty attendance.csv beside a missing timetable would read as
    // "nobody booked anything".
    const timetable = async (): Promise<[Slice<GymClass>, Slice<MemberBooking>]> => {
      let classes: GymClass[];
      try {
        classes = await fetchClasses(supabase, tenantId, FROM, TO);
      } catch (e) {
        const why = reason(e);
        return [
          sliceFailed(why),
          sliceFailed(`the timetable could not be read, so its bookings could not be either — ${why}`),
        ];
      }
      try {
        return [sliceReady(classes), sliceReady(await bookingsFor(classes))];
      } catch (e) {
        return [sliceReady(classes), sliceFailed(reason(e))];
      }
    };

    const [
      plans, memberships, payments, [classes, attendance],
      sessions, passTypes, passes, visits, invites,
    ] = await Promise.all([
      slice(() => fetchPlans(supabase, tenantId)),
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchPayments(supabase, tenantId)),
      timetable(),
      slice(() => fetchSessions(supabase, tenantId, FROM, TO)),
      slice(() => fetchPassTypes(supabase, tenantId)),
      slice(() => fetchPasses(supabase, tenantId)),
      slice(() => fetchVisits(supabase, tenantId)),
      slice(() => fetchInvites(supabase, tenantId)),
    ]);

    setReads({ plans, memberships, payments, classes, attendance, sessions, passTypes, passes, visits, invites });
    setReadAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setReads(EMPTY); setReadAt(new Date().toISOString()); return; }
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name').eq('id', who.tenantId).single();
      // Checked, not assumed: a null name here means "not read", not "the gym
      // has no name" — and the gym's name ends up in every filename.
      if (live) setGymName(tErr ? null : t?.name ?? null);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const input: GymExportInput | null = useMemo(() => (
    me?.tenantId || me
      ? {
          gymName,
          tenantId: me?.tenantId ?? null,
          generatedAt: readAt ?? new Date(0).toISOString(),
          from: FROM,
          to: TO,
          ...reads,
        }
      : null
  ), [me, gymName, readAt, reads]);

  const blocker = input ? exportBlocker(input) : 'Loading.';
  // Built even while blocked, so the screen can show what the bundle WOULD
  // contain — but the download stays disabled, because a bundle taken mid-read
  // is missing rows that exist and nothing in it would know.
  const bundle = useMemo(() => (input && readAt ? buildGymExport(input) : null), [input, readAt]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/export">
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
      <Shell me={me} gymName={gymName} current="/export">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          The export carries every member, payment and door visit the gym holds,
          so it is owner-only.
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} current="/export">
      <h1>Export</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: 640 }}>
        The whole operating record as CSV, in the shapes another system can
        read: the price book, members, memberships, payments, the timetable,
        class attendance, one-to-ones, passes, the door log and invites. It is
        the gym’s record, and leaving with it has to be possible.
      </p>

      {bundle && !bundle.complete ? (
        <Banner tone="crit">
          <strong>{bundle.manifest.warning}</strong>
        </Banner>
      ) : null}

      {bundle?.caveats.map((c) => <Banner key={c}>{c}</Banner>)}

      {bundle?.complete ? (
        <Banner>
          Every part of the record was read. This bundle is complete as of{' '}
          <span className="mono">{bundle.manifest.exportedAt}</span>.
        </Banner>
      ) : null}

      <Parts input={input} />
      <Files bundle={bundle} blocker={blocker} />
      <Notes />
    </Shell>
  );
}

/* ── what is in the record ─────────────────────────────────────────────────── */

interface PartRow {
  part: ExportPart;
  label: string;
  cost: string;
  state: 'loading' | 'ready' | 'failed';
  rows: number | null;
  reason: string | null;
}

function Parts({ input }: { input: GymExportInput | null }) {
  const rows: PartRow[] = EXPORT_PARTS.map((part) => {
    const s = input ? partSlice(input, part) : ({ state: 'loading' } as const);
    return {
      part,
      label: EXPORT_LABEL[part],
      cost: EXPORT_COST[part],
      state: s.state,
      rows: s.state === 'ready' ? (s.rows as unknown[]).length : null,
      reason: s.state === 'failed' ? s.reason : null,
    };
  });

  const cols: Column<PartRow>[] = [
    { key: 'label', header: 'Part', value: (r) => r.label,
      render: (r) => <span style={{ textTransform: 'capitalize' }}>{r.label}</span> },
    {
      key: 'state', header: 'Read', value: (r) => r.state,
      render: (r) =>
        r.state === 'loading' ? <span style={{ color: 'var(--ink3)' }}>reading…</span>
        : r.state === 'failed' ? <span style={{ color: 'var(--crit)' }}>failed</span>
        : <span>read</span>,
    },
    {
      // Three renders, never two. A blank here while a read is in flight is
      // "not known yet"; a 0 is "read, and there is genuinely nothing".
      key: 'rows', header: 'Rows', value: (r) => r.rows, numeric: true, align: 'right',
      render: (r) => (r.rows == null ? <span className="dash">—</span> : <span className="mono">{r.rows}</span>),
    },
    {
      key: 'why', header: 'What that means', value: (r) => r.reason ?? '',
      render: (r) =>
        r.state === 'failed'
          ? <span style={{ color: 'var(--ink2)' }}>
              <strong>Not in the bundle.</strong> {capitalise(r.cost)} is missing, not zero. ({r.reason})
            </span>
          : r.state === 'loading'
            ? <span style={{ color: 'var(--ink3)' }}>Not read yet.</span>
            : r.rows === 0
              ? <span style={{ color: 'var(--ink3)' }}>Read, and there is nothing recorded.</span>
              : <span style={{ color: 'var(--ink3)' }}>{capitalise(r.cost)}.</span>,
    },
  ];

  return (
    <Section
      title="What is in the record"
      sub="Each part is read on its own. A read that fails is reported here and named in the bundle — it never becomes an empty file."
    >
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.part} empty="Nothing to export." />
    </Section>
  );
}

/* ── the files ─────────────────────────────────────────────────────────────── */

function Files({ bundle, blocker }: {
  bundle: ReturnType<typeof buildGymExport> | null;
  blocker: string | null;
}) {
  const [busy, setBusy] = useState(false);

  const downloadAll = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      // One at a time with a breath between: browsers throttle a burst of
      // programmatic downloads and drop the tail, which would take files out of
      // the bundle silently — the exact failure this whole screen exists to
      // avoid.
      for (const f of bundle.files) {
        download(f);
        await new Promise((r) => setTimeout(r, 220));
      }
    } finally { setBusy(false); }
  };

  const cols: Column<ExportFile>[] = [
    {
      key: 'name', header: 'File', value: (f) => f.name,
      render: (f) => (
        <span className="mono" style={{ fontSize: 12.5, color: f.placeholder ? 'var(--crit)' : 'var(--ink)' }}>
          {f.name}
        </span>
      ),
    },
    {
      key: 'rows', header: 'Rows', value: (f) => f.rows, numeric: true, align: 'right',
      render: (f) => (f.rows == null ? <span className="dash">—</span> : <span className="mono">{f.rows}</span>),
    },
    {
      key: 'what', header: '', value: (f) => (f.placeholder ? 1 : 0),
      render: (f) => (f.placeholder
        ? <span style={{ color: 'var(--crit)', fontSize: 12.5 }}>written in place of a file that could not be produced</span>
        : null),
    },
    {
      key: 'get', header: '', value: () => '', align: 'right',
      render: (f) => <button onClick={() => download(f)} style={linkBtn}>Download</button>,
    },
  ];

  return (
    <Section
      title="The files"
      sub={
        bundle && !bundle.complete
          ? 'Every filename carries INCOMPLETE, and the README says what is missing. That is deliberate: this is not the gym’s whole record.'
          : 'UTF-8 with a byte-order mark and CRLF line endings, so they open correctly in Excel. plans, members and payments use the column names Repple’s own CSV import understands.'
      }
    >
      <div style={formRow}>
        <button onClick={downloadAll} disabled={!bundle || !!blocker || busy} style={primaryBtn}>
          {busy ? 'Downloading…' : `Download all ${bundle?.files.length ?? ''} files`.trim()}
        </button>
        {blocker ? <span style={{ color: 'var(--ink3)', fontSize: 12.5 }}>{blocker}</span> : null}
      </div>
      {bundle === null
        ? <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Reading the record…</div>
        : <DataTable rows={bundle.files} columns={cols} rowKey={(f) => f.name} empty="Nothing to download." />}
    </Section>
  );
}

function download(f: ExportFile) {
  const blob = new Blob([f.text], { type: f.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late: Safari has been known to cancel a download whose blob URL is
  // released in the same tick as the click.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ── the small print, said out loud ────────────────────────────────────────── */

function Notes() {
  return (
    <Section title="How to read the figures" sub="The same notes ride along in README.txt and manifest.json.">
      <ul style={{ margin: 0, padding: '14px 14px 16px 32px', color: 'var(--ink2)', fontSize: 13, lineHeight: 1.65 }}>
        <li>
          <strong>Money is integer minor units.</strong> The <span className="mono">*_cents</span> columns are the
          stored figures. The plain <span className="mono">price</span>/<span className="mono">amount</span> columns
          are the same numbers written with two decimals for spreadsheets and for the importer. Nothing is rounded.
        </li>
        <li>
          <strong>An empty cell means never recorded.</strong> Not zero, not “null”. A pass with no recorded price is
          not a free pass, and a member with no recorded weight did not weigh nothing.
        </li>
        <li>
          <strong>Dates are ISO, exactly as stored.</strong> Timestamps keep their time; the date-only columns the
          importer reads sit beside them rather than replacing them.
        </li>
        <li>
          <strong>Names survive.</strong> A comma, a quote or a line break inside a name or a note is quoted properly,
          so O’Brien, “Bob” Smith and a two-line note do not shift every column after them.
        </li>
        <li>
          <strong>Invite tokens are not exported.</strong> They are working join links, and a record should not carry
          live credentials into somebody’s Downloads folder.
        </li>
      </ul>
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

async function slice<T>(run: () => Promise<T[]>): Promise<Slice<T>> {
  try {
    return sliceReady(await run());
  } catch (e) {
    return sliceFailed(reason(e));
  }
}

function reason(e: unknown): string {
  const m = (e as { message?: string } | null)?.message;
  return (typeof m === 'string' && m.trim()) ? m.trim() : 'the read failed';
}

/**
 * Every class booking the gym holds, flattened onto the class it belongs to.
 *
 * The `.error` check on each chunk is not decoration. supabase-js resolves on a
 * database error, so an unchecked failure here arrives as `data === null`,
 * falls through `?? []`, and produces an attendance.csv that is missing a slab
 * of the gym's history with nothing to say so. It throws instead, and the
 * caller turns that into a named, missing part.
 */
async function bookingsFor(classes: GymClass[]): Promise<MemberBooking[]> {
  if (!classes.length) return [];
  const byId = new Map(classes.map((c) => [c.id, c]));
  const ids = [...byId.keys()];
  const out: MemberBooking[] = [];

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from('class_bookings')
      .select('id, class_id, user_id, status, attended_at')
      .in('class_id', ids.slice(i, i + ID_CHUNK));
    if (error) throw error;
    for (const r of (data ?? []) as any[]) {
      const c = byId.get(r.class_id);
      out.push({
        bookingId: r.id,
        memberId: r.user_id,
        classId: r.class_id,
        classTitle: c?.title ?? null,
        startsAt: c?.startsAt ?? '',
        status: r.status ?? 'booked',
        attendedAt: r.attended_at ?? null,
      });
    }
  }
  return out;
}

/* ── bits, matching /money ─────────────────────────────────────────────────── */

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer',
  fontSize: 12.5, padding: 0, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

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

function Banner({ children, tone }: { children: React.ReactNode; tone?: 'crit' }) {
  return (
    <div style={{
      margin: '14px 0', padding: '11px 14px', borderRadius: 8, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13, lineHeight: 1.6,
    }}>{children}</div>
  );
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
