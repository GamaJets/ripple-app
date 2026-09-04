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
//
// The eleven files leave as ONE zip, written by lib/zip.ts — no dependency, the
// 1989 format is a page of DataViews. See the comment on `downloadAll` for why
// eleven separate downloads was not a bundle.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { zip } from '@/lib/zip';
import { save } from '@/lib/save';
import { fetchPlans, fetchMemberships, fetchPayments } from '@lib/gymRecord';
import { fetchClasses } from '@lib/gymSchedule';
import { fetchSessions } from '@lib/gymSessions';
import { fetchPassTypes, fetchPasses } from '@lib/gymPasses';
import { fetchVisits } from '@lib/gymVisits';
import { fetchInvites } from '@lib/memberInvites';
import { readAll } from '@lib/rowCap';
import { sliceLoading, sliceReady, sliceFailed } from '@lib/memberView';
import {
  buildGymExport, exportBlocker, partSlice,
  EXPORT_PARTS, EXPORT_LABEL, EXPORT_COST,
  type ExportPart, type ExportFile, type GymExportInput,
  type Slice, type MemberBooking, type GymClass,
  memberSlices, memberRowCount, MEMBER_PARTS,
  type ExportInvoice, type ExportSettlement, type ExportEquipment, type ExportShift,
  type ExportIntervention, type ExportPromo, type ExportEvent, type ExportPurchase,
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

// The slices, and only the slices. `currency` joins the excluded set because
// it is not a read that can be loading, ready or failed — it comes off the
// same `tenants` row as the gym's name and is held in its own state beside
// it, so that a failed tenant read and an unset currency both arrive as the
// null sessions.csv already knows what to do with.
type Reads = Omit<GymExportInput, 'gymName' | 'tenantId' | 'currency' | 'generatedAt' | 'from' | 'to'>;

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
  invoices: sliceLoading(),
  settlements: sliceLoading(),
  equipment: sliceLoading(),
  shifts: sliceLoading(),
  interventions: sliceLoading(),
  promos: sliceLoading(),
  events: sliceLoading(),
  purchases: sliceLoading(),
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
  invoices: sliceReady([]),
  settlements: sliceReady([]),
  equipment: sliceReady([]),
  shifts: sliceReady([]),
  interventions: sliceReady([]),
  promos: sliceReady([]),
  events: sliceReady([]),
  purchases: sliceReady([]),
};

export default function ExportPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  /** `tenants.currency`, for the one table whose money carries none of its own.
   *  Null is both "not read" and "never set", and sessions.csv treats them the
   *  same way: a blank rate beside the stored integer, never a guessed code. */
  const [ccy, setCcy] = useState<string | null>(null);
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
      invoices, settlements, equipment, shifts, interventions, promos, events, purchases,
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
      // The eight this bundle used to leave behind. Each is its own read with
      // its own three states, for the reason at the top of this file: an empty
      // invoices.csv beside a refused query would tell a gym it had never
      // billed anybody.
      slice(() => readInvoices(tenantId)),
      slice(() => readSettlements(tenantId)),
      slice(() => readEquipment(tenantId)),
      slice(() => readShifts(tenantId)),
      slice(() => readInterventions(tenantId)),
      slice(() => readPromos(tenantId)),
      slice(() => readEvents(tenantId)),
      slice(() => readPurchases(tenantId)),
    ]);

    setReads({
      plans, memberships, payments, classes, attendance, sessions, passTypes, passes, visits, invites,
      invoices, settlements, equipment, shifts, interventions, promos, events, purchases,
    });
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
        .from('tenants').select('name, currency').eq('id', who.tenantId).single();
      // Checked, not assumed: a null name here means "not read", not "the gym
      // has no name" — and the gym's name ends up in every filename.
      if (live) setGymName(tErr ? null : t?.name ?? null);
      // The currency is read for sessions.csv, and only for it. Every other
      // money row in this bundle stores its own code and that code always wins;
      // `pt_sessions.rate_cents` has none, because a session rate has only ever
      // been in the gym's money. A failed read and an unset currency both land
      // as null here, and both produce a blank `rate` cell beside the raw
      // integer rather than a figure in a currency nobody chose — which is the
      // right answer to both, in a file somebody may hand to an accountant.
      if (live) setCcy(tErr ? null : ((((t as any)?.currency ?? '') as string).trim().toUpperCase() || null));
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const input: GymExportInput | null = useMemo(() => (
    me?.tenantId || me
      ? {
          gymName,
          tenantId: me?.tenantId ?? null,
          currency: ccy,
          generatedAt: readAt ?? new Date(0).toISOString(),
          from: FROM,
          to: TO,
          ...reads,
        }
      : null
  ), [me, gymName, ccy, readAt, reads]);

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
        The whole operating record as CSV in one zip, in the shapes another
        system can read: the price book, members, memberships, payments, invoices,
        the timetable, class attendance, one-to-ones, passes, the door log, invites,
        payroll settlements, the equipment register, the rota, member contact, promo
        codes, the activity log and PT packs. It is the gym’s record, and leaving with
        it has to be possible. One member’s own file can be taken from the bottom of
        this page.
      </p>

      {bundle && !bundle.complete ? (
        <Banner tone="crit">
          <strong>{bundle.manifest.warning}</strong>
        </Banner>
      ) : null}

      {bundle?.caveats.map((c) => <Banner key={c}>{c}</Banner>)}

      {/*
        * The sentence, and what stands behind it.
        *
        * "This bundle is complete" was being printed over reads that could
        * silently come back short: PostgREST returns at most 1000 rows and says
        * nothing about having stopped, so a read that truncated SUCCEEDED, its
        * part showed as read, and the banner asserted completeness about a
        * prefix. The claim was not wrong by accident — nothing anywhere had
        * checked it.
        *
        * Every read behind this banner now either asks for one row more than it
        * will accept and fails loudly on getting it (src/lib/rowCap.ts), or
        * pages until the set is finished. So a part that cannot be read whole
        * is a FAILED part: it is named, it gets a stub, and `complete` is
        * false. The second sentence says which of the two guarantees the reader
        * is being given, because "complete" on its own is exactly the word that
        * was doing the unearned work before.
        */}
      {bundle?.complete ? (
        <Banner>
          Every part of the record was read, and read whole. This bundle is complete as of{' '}
          <span className="mono">{bundle.manifest.exportedAt}</span>. No read here can come back
          short without saying so — each one either fails rather than return a partial set, or
          pages until it has all of it, so a part that could not be read in full is listed as
          missing rather than quietly shortened.
        </Banner>
      ) : null}

      <Parts input={input} />
      <Files bundle={bundle} blocker={blocker} me={me} />
      <MemberRecord input={input} blocker={blocker} readAt={readAt} me={me} />
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

function Files({ bundle, blocker, me }: {
  bundle: ReturnType<typeof buildGymExport> | null;
  blocker: string | null;
  me: Me;
}) {
  const [busy, setBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  /**
   * One archive, not eleven downloads.
   *
   * The old loop fired each file at the browser in turn with a pause between,
   * because a burst of programmatic downloads gets throttled and the tail is
   * dropped — silently, which is the exact failure this screen exists to avoid.
   * A pause makes that less likely, never impossible, and it still left the gym
   * holding eleven loose files with no edge between them: README.txt and
   * manifest.json, the two that say what is missing, arriving as just two more
   * things in Downloads. A zip either arrives whole or does not arrive.
   *
   * Names inside the archive are the same names the per-file buttons produce,
   * INCOMPLETE marker and all, so unpacking the bundle and downloading the
   * files one by one cannot produce differently-named records of the same
   * export.
   */
  const downloadAll = async () => {
    if (!bundle) return;
    setBusy(true);
    setZipError(null);
    try {
      const blob = await zip(bundle.files.map((f) => ({ name: f.name, text: f.text })));
      save(blob, `${bundle.prefix}.zip`);
      // Recorded AFTER the file exists, never before. An export log entry for a
      // download that failed to build is a false statement about data having
      // left the platform, and it is the kind of false statement a data
      // protection officer reads as evidence.
      await logExport(me, 'gym', null, bundle.files.reduce((a, f) => a + (f.rows ?? 0), 0), bundle.manifest.parts.map((p) => p.part).filter((p): p is ExportPart => !!p));
    } catch (e) {
      // Said out loud rather than swallowed: a button that appears to do
      // nothing reads as "the export is empty". The per-file buttons below
      // still work, so the record is still reachable.
      setZipError(reason(e));
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
          {busy
            ? 'Building the archive…'
            : bundle
              ? `Download all ${bundle.files.length} files as a zip`
              : 'Download all files as a zip'}
        </button>
        {blocker ? <span style={{ color: 'var(--ink3)', fontSize: 12.5 }}>{blocker}</span> : null}
        {zipError ? (
          <span style={{ color: 'var(--crit)', fontSize: 12.5 }}>
            The archive could not be built: {zipError}. Nothing was downloaded — take the files
            individually below.
          </span>
        ) : null}
      </div>
      {bundle === null
        ? <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Reading the record…</div>
        : <DataTable rows={bundle.files} columns={cols} rowKey={(f) => f.name} empty="Nothing to download." />}
    </Section>
  );
}

function download(f: ExportFile) {
  save(new Blob([f.text], { type: f.mime }), f.name);
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
 * of the gym's history with nothing to say so. `readAll` throws instead, and
 * the caller turns that into a named, missing part.
 *
 * PAGINATED, not capped, and this is the read that made the difference between
 * a bundle that is complete and a bundle that says so. The chunk bounds the URL
 * (see ID_CHUNK); it does nothing about PostgREST's silent 1000-row ceiling,
 * and 150 classes at a dozen bookings each is already past it. Every chunk that
 * truncated would have dropped a slab of attendance out of the archive under a
 * banner reading "This bundle is complete". A capped read that refused would at
 * least have been honest, but it would also have taken class attendance away
 * from every gym big enough to have interesting attendance — on the one screen
 * whose entire purpose is that leaving with the record must be possible. So the
 * read is simply finished.
 */
/* ── one member's own file ─────────────────────────────────────────────────── */

/**
 * A subject-access response, or an archive before an erasure.
 *
 * `/export` was whole-gym only, and `src/lib/gdpr.ts` exports the caller's OWN
 * account — so the gym-side record of one member was reachable from nowhere.
 * `web/delete-account.html` says so to members outright: it tells them the
 * gym-side records are out of reach and to "ask us". An owner honouring that
 * request had no tool, and an owner archiving a member before honouring an
 * erasure had none either.
 *
 * It is built by FILTERING reads this screen has already made, which is the
 * whole reason it is cheap and the whole reason it cannot drift: two
 * implementations of "what does this gym hold about this person" would
 * eventually disagree, and the day they did is the day a legal response went
 * out short.
 *
 * The picker is the memberships roster and not `profiles`. A person this gym
 * has never sold anything to is not a member of it, and offering the console's
 * whole profile visibility as a download menu would be a different feature with
 * a different risk attached.
 */
function MemberRecord({ input, blocker, readAt, me }: {
  input: GymExportInput | null; blocker: string | null; readAt: string | null; me: Me;
}) {
  const [memberId, setMemberId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const roster = useMemo(() => {
    if (!input || input.memberships.state !== 'ready') return null;
    return [...new Map(input.memberships.rows
      .filter((m) => m.memberId)
      .map((m) => [m.memberId, m.memberName ?? m.memberId] as const)).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [input]);

  const chosenName = roster?.find(([id]) => id === memberId)?.[1] ?? null;
  const rows = input && memberId ? memberRowCount(input, memberId) : null;

  const download = async () => {
    if (!input || !memberId || !readAt) return;
    setBusy(true); setErr(null);
    try {
      const scoped = memberSlices(input, memberId);
      const bundle = buildGymExport({
        ...scoped,
        subject: { memberId, memberName: chosenName },
      });
      const blob = await zip(bundle.files.map((f) => ({ name: f.name, text: f.text })));
      save(blob, `${bundle.prefix}.zip`);
      await logExport(me, 'member', memberId, rows, MEMBER_PARTS);
    } catch (e) {
      setErr(reason(e));
    } finally { setBusy(false); }
  };

  return (
    <Section
      title="One member’s record"
      sub="What this gym holds about one person — memberships, payments, invoices, bookings, one-to-ones, passes, door entries, contact and the activity log. Not the price book, the timetable or the rota: those are the gym’s and belong to nobody."
    >
      <div style={{ display: 'flex', gap: 8, padding: '12px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={memberId} onChange={(e) => { setMemberId(e.target.value); setErr(null); }}
                style={{ ...field, minWidth: 240 }} aria-label="Whose record to export">
          <option value="">
            {roster === null ? 'The roster has not been read' : 'Choose a member'}
          </option>
          {(roster ?? []).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button onClick={download} disabled={busy || !memberId || !!blocker} style={primaryBtn}>
          {busy ? 'Building…' : 'Download their record'}
        </button>
        {memberId ? (
          <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
            {/* Null is one or more parts unread, and it is NOT zero. An owner
                answering a legal request has to know the difference before they
                send a bundle of empty files with a covering note. */}
            {rows == null
              ? 'How much is on file cannot be counted while any part of the record is unread.'
              : rows === 0
                ? 'This gym holds no rows at all about them — the bundle will say so in every file rather than being empty and unexplained.'
                : `${rows} row${rows === 1 ? '' : 's'} across the record.`}
          </span>
        ) : null}
      </div>
      {blocker ? (
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: '#f0c04e', maxWidth: '74ch' }}>
          {blocker} The same refusal applies here: a member export built over a read that has not
          finished is missing rows that exist, and nothing in the file would know.
        </p>
      ) : null}
      {err ? <Banner tone="crit">Their record could not be built: {err}. Nothing was downloaded.</Banner> : null}
      <p style={{ margin: 0, padding: '0 14px 14px', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '78ch' }}>
        This is the GYM&rsquo;S side of the record. Their workouts, photos, messages and
        measurements are theirs and are exported from their own account &mdash; this bundle does not
        contain them and does not claim to. Taking it is logged, with who took it and when: an
        export leaving the platform is the one action here that nothing else in the product could
        observe.
      </p>
    </Section>
  );
}

/**
 * Record that an export left the platform.
 *
 * The one action on this screen that writes no row anywhere else — a file is
 * produced in the browser and the database never hears about it — so the client
 * has to state it. That is the opposite of how every other event in
 * `gym_events` is written (triggers, unforgeable, see supabase/parts/105) and
 * it is unavoidable: nothing server-side can observe a download.
 *
 * The failure is SWALLOWED rather than surfaced, and that is a deliberate
 * ordering. The file has already been handed to the owner by the time this
 * runs; telling them the export failed would be false, and refusing the
 * download over a logging table would be a worse product for a worse reason.
 * A gap in the log is visible as a gap; a refused export is a gym that cannot
 * leave.
 */
async function logExport(
  me: Me, scope: 'gym' | 'member', memberId: string | null,
  rows: number | null, parts: ExportPart[],
): Promise<void> {
  if (!me.tenantId) return;
  // eslint-disable-next-line -- no-error-ok: the file is already in the owner's hands; a logging failure must not be reported as an export failure
  await supabase.from('gym_export_runs').insert({
    tenant_id: me.tenantId,
    scope,
    member_id: memberId,
    parts,
    rows_exported: rows,
    taken_by: me.id,
  });
}

/* ── the eight parts the bundle used to leave behind ───────────────────────── */

/**
 * Every one of these is paged with `readAll`, never capped-and-refused.
 *
 * The distinction is the one src/lib/rowCap.ts draws: `assertWhole` is right
 * for a figure, because a figure over an unknown fraction of a set is a wrong
 * figure. This screen is not computing a figure — it is taking the gym's whole
 * record out — so refusing at a thousand rows would hand a gym with three
 * years of activity a bundle that is missing everything before last spring,
 * and it would be the LARGEST gyms that could not leave. Every read below
 * orders by `id` as its final key, because `readAll`'s contract requires a
 * TOTAL order and a page boundary that lands in a run of ties silently loses
 * rows.
 */
async function readInvoices(tenantId: string): Promise<ExportInvoice[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_invoices')
      .select('id, number, member_id, amount_cents, currency, issued_on, due_on, status, note, billed_name')
      .eq('tenant_id', tenantId)
      .order('issued_on', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's invoice register",
  );
  const names = await namesFor(rows.map((r) => r.member_id));
  return rows.map((r) => ({
    id: r.id,
    number: Number.isFinite(r.number) ? r.number : null,
    memberId: r.member_id ?? null,
    // The retained name from supabase/parts/184 where the account has been
    // erased. Without it a retained invoice exports naming nobody, which is the
    // one thing a retention obligation exists to prevent.
    memberName: (r.member_id ? names.get(r.member_id) : undefined) ?? r.billed_name ?? null,
    amountCents: r.amount_cents ?? null,
    currency: r.currency ?? null,
    issuedOn: r.issued_on,
    dueOn: r.due_on ?? null,
    status: r.status ?? null,
    note: r.note ?? null,
  }));
}

async function readSettlements(tenantId: string): Promise<ExportSettlement[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('payroll_settlements')
      .select('id, trainer_id, period_from, period_to, amount_cents, currency, sessions_count, method, settled_at, reversed_at, reverse_reason')
      .eq('tenant_id', tenantId)
      .order('settled_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's payroll settlements",
  );
  const names = await namesFor(rows.map((r) => r.trainer_id));
  return rows.map((r) => ({
    id: r.id,
    trainerId: r.trainer_id ?? null,
    trainerName: r.trainer_id ? names.get(r.trainer_id) ?? null : null,
    periodFrom: r.period_from ?? null,
    periodTo: r.period_to ?? null,
    amountCents: r.amount_cents ?? null,
    currency: r.currency ?? null,
    sessionsCount: r.sessions_count ?? null,
    method: r.method ?? null,
    settledAt: r.settled_at,
    reversedAt: r.reversed_at ?? null,
    reverseReason: r.reverse_reason ?? null,
  }));
}

async function readEquipment(tenantId: string): Promise<ExportEquipment[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_equipment')
      .select('id, name, category, identifier, quantity, status, purchased_on, service_interval_days, last_serviced_on, note')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's equipment register",
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, category: r.category ?? null, identifier: r.identifier ?? null,
    quantity: r.quantity ?? null, status: r.status ?? null, purchasedOn: r.purchased_on ?? null,
    serviceIntervalDays: r.service_interval_days ?? null,
    lastServicedOn: r.last_serviced_on ?? null, note: r.note ?? null,
  }));
}

async function readShifts(tenantId: string): Promise<ExportShift[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_shifts')
      .select('id, trainer_id, starts_at, ends_at, role, status, note')
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's rota",
  );
  const names = await namesFor(rows.map((r) => r.trainer_id));
  return rows.map((r) => ({
    id: r.id,
    trainerId: r.trainer_id ?? null,
    trainerName: r.trainer_id ? names.get(r.trainer_id) ?? null : null,
    startsAt: r.starts_at ?? null, endsAt: r.ends_at ?? null,
    role: r.role ?? null, status: r.status ?? null, note: r.note ?? null,
  }));
}

async function readInterventions(tenantId: string): Promise<ExportIntervention[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('member_interventions')
      .select('id, member_id, channel, outcome, by_id, by_name, note, at')
      .eq('tenant_id', tenantId)
      .order('at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's record of member contact",
  );
  const names = await namesFor(rows.map((r) => r.member_id));
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id ?? null,
    memberName: r.member_id ? names.get(r.member_id) ?? null : null,
    channel: r.channel ?? null, outcome: r.outcome ?? null,
    byId: r.by_id ?? null, byName: r.by_name ?? null,
    note: r.note ?? null, at: r.at ?? null,
  }));
}

async function readPromos(tenantId: string): Promise<ExportPromo[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('promos')
      .select('id, code, discount, active, redemptions, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's promo codes",
  );
  return rows.map((r) => ({
    id: r.id, code: r.code ?? null,
    discount: Number.isFinite(r.discount) ? r.discount : null,
    active: typeof r.active === 'boolean' ? r.active : null,
    redemptions: Number.isFinite(r.redemptions) ? r.redemptions : null,
    createdAt: r.created_at ?? null,
  }));
}

async function readEvents(tenantId: string): Promise<ExportEvent[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_events')
      .select('id, kind, summary, subject_id, actor_id, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's activity log",
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind ?? null, summary: r.summary ?? null,
    subjectId: r.subject_id ?? null, actorId: r.actor_id ?? null, at: r.created_at,
  }));
}

/**
 * PT packs, scoped by the roster.
 *
 * `client_purchases` has no tenant column — it hangs off a trainer profile — so
 * the scope is applied by hand. The roster read THROWS rather than defaulting
 * to an empty list: an empty `in()` and a refused roster both produce "no
 * packs", and one of those is a gym whose coaches sold nothing while the other
 * is a query nobody may draw a conclusion from. In an export the second one
 * would be a missing file the bundle claimed was complete.
 */
async function readPurchases(tenantId: string): Promise<ExportPurchase[]> {
  const { data: trs, error } = await supabase
    .from('trainers').select('id').eq('tenant_id', tenantId).limit(1001);
  if (error) throw error;
  const ids: string[] = (trs ?? []).map((r: any) => r.id);
  if (!ids.length) return [];
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('client_purchases')
      .select('id, trainer_id, client_id, amount_cents, currency, sessions_total, sessions_used, status, created_at')
      .in('trainer_id', ids)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "the PT packs sold by this gym's coaches",
  );
  const names = await namesFor(rows.map((r) => r.trainer_id));
  return rows.map((r) => ({
    id: r.id,
    trainerId: r.trainer_id ?? null,
    trainerName: r.trainer_id ? names.get(r.trainer_id) ?? null : null,
    clientId: r.client_id ?? null,
    amountCents: Number.isFinite(r.amount_cents) ? r.amount_cents : null,
    currency: r.currency ?? null,
    sessionsTotal: Number.isFinite(r.sessions_total) ? r.sessions_total : null,
    sessionsUsed: Number.isFinite(r.sessions_used) ? r.sessions_used : null,
    status: r.status ?? null,
    createdAt: r.created_at ?? null,
  }));
}

/**
 * Names for a set of profile ids.
 *
 * Deliberately NOT throwing. A name is a label on a row whose figures are all
 * read from elsewhere, and an export that refused to produce invoices.csv
 * because the name lookup failed would withhold the money to protect the
 * spelling. Every table here writes the id beside the name for exactly this
 * reason: the row is still identifiable.
 */
async function namesFor(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    // eslint-disable-next-line -- no-error-ok: a missing name renders as a blank beside the id that is always written; the row is still identifiable
    const { data } = await supabase
      .from('profiles').select('id, full_name').in('id', unique.slice(i, i + ID_CHUNK));
    for (const p of (data ?? []) as any[]) {
      const n = (p.full_name || '').trim();
      if (n) out.set(p.id, n);
    }
  }
  return out;
}

async function bookingsFor(classes: GymClass[]): Promise<MemberBooking[]> {
  if (!classes.length) return [];
  const byId = new Map(classes.map((c) => [c.id, c]));
  const ids = [...byId.keys()];
  const out: MemberBooking[] = [];

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const slice = ids.slice(i, i + ID_CHUNK);
    const rows = await readAll<any>(
      (from, to) => supabase
        .from('class_bookings')
        .select('id, class_id, user_id, status, attended_at')
        .in('class_id', slice)
        // A total order. Postgres promises nothing about the order of rows
        // that tie, and each page is a separate request, so paging over a
        // non-unique order can lose rows — which is the bug this read is being
        // fixed for, arriving again by a different route.
        .order('id', { ascending: true })
        .range(from, to),
      'the class bookings for this gym',
    );
    for (const r of rows) {
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

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
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
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
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
      margin: '14px 0', padding: '11px 14px', borderRadius: 0, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13, lineHeight: 1.6,
    }}>{children}</div>
  );
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
