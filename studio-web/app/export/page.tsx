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
// The files leave as ONE zip, written by lib/zip.ts — no dependency, the 1989
// format is a page of DataViews. See the comment on `downloadAll` for why a
// download per part was not a bundle. (There were eleven when that comment was
// written and there are `EXPORT_PARTS.length` now; the count is deliberately
// not repeated in prose, because it has been wrong here twice.)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
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
import { readByIds } from '@lib/idLookup';
import { sliceLoading, sliceReady, sliceFailed } from '@lib/memberView';
import { fetchMemberRecords } from '@lib/gymMembers';
import { attributionOf } from '@lib/gymSigning';
// The gym's own name, currency and clock in one read. The clock is what the
// period presets below are computed on: a bundle's period is a claim about
// calendar days, and the only calendar that means anything to the gym's
// accountant is the gym's.
import { readTenant } from '@/lib/currency';
import { gymDay } from '@lib/gymZone';
import { isoDate } from '@lib/format';
import { Banner as SharedBanner, type BannerTone } from '@/components/Banner';
import {
  windowFromDays, windowBlocker, describeWindow, isBounded, presetDays,
  PRESET_IDS, PRESET_LABEL, type PresetId, type ExportWindow,
} from '@lib/exportWindow';
import {
  buildGymExport, exportBlocker, partSlice,
  EXPORT_PARTS, EXPORT_LABEL, EXPORT_COST, EXPORT_DATE_FIELD, EXPORT_UNBOUNDED_WHY,
  type ExportPart, type ExportFile, type GymExportInput,
  type Slice, type MemberBooking, type GymClass,
  memberSlices, memberRowCount, MEMBER_PARTS, windowSlices,
  type ExportInvoice, type ExportSettlement, type ExportEquipment, type ExportShift,
  type ExportIntervention, type ExportPromo, type ExportEvent, type ExportPurchase,
  type ExportMemberRecord, type ExportAgreement, type ExportSignature, type ExportDocument,
  type ExportOrder, type ExportClose, type ExportAdjustment, type ExportEquipmentLog,
  type ExportReconcileMark,
} from '@lib/gymExport';

/**
 * The bounds the two time-ranged READS are made over. Not the export's period.
 *
 * `fetchClasses` and `fetchSessions` take a range because every other screen
 * that calls them wants one; this screen wants all of it, so these are
 * deliberately wide. They used to be the export's own bounds as well, and that
 * was the defect: two constants with no control beside them meant the only
 * request the console could answer was "everything", while every request an
 * accountant or an auditor actually makes is for a period.
 *
 * The PERIOD is now `window` below, it is applied to the rows by
 * `buildGymExport`, and it is deliberately not applied here. Reading the whole
 * record once and narrowing it means changing the dates does not re-run
 * nineteen queries, and — the reason that matters — it means the window cannot
 * turn a read that would have failed into a read that quietly succeeds over a
 * smaller set. What was readable is the same question whatever period is asked
 * for, and the screen answers it once.
 */
const READ_FROM = '1970-01-01T00:00:00.000Z';
const READ_TO = '2100-01-01T00:00:00.000Z';

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
  invoices: sliceLoading(),
  settlements: sliceLoading(),
  equipment: sliceLoading(),
  shifts: sliceLoading(),
  interventions: sliceLoading(),
  promos: sliceLoading(),
  events: sliceLoading(),
  purchases: sliceLoading(),
  memberRecords: sliceLoading(),
  agreements: sliceLoading(),
  signatures: sliceLoading(),
  documents: sliceLoading(),
  orders: sliceLoading(),
  closes: sliceLoading(),
  adjustments: sliceLoading(),
  equipmentLog: sliceLoading(),
  reconciles: sliceLoading(),
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
  memberRecords: sliceReady([]),
  agreements: sliceReady([]),
  signatures: sliceReady([]),
  documents: sliceReady([]),
  orders: sliceReady([]),
  closes: sliceReady([]),
  adjustments: sliceReady([]),
  equipmentLog: sliceReady([]),
  reconciles: sliceReady([]),
};

export default function ExportPage() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  /**
   * True when the gym's NAME could not be READ, as distinct from there being no
   * gym.
   *
   * The read below already discards its error deliberately — no figure on this
   * page depends on the name — but `gymName: null` was carrying both facts, and
   * the rail prints "No gym linked" for a null it is given no other word for.
   * That is a sentence about the OWNER'S ACCOUNT produced by a query that
   * failed, on every screen in the console at once. Carrying this one bit is
   * what lets the rail say which of the two it is. See components/Shell.tsx.
   */
  const [gymNameUnread, setGymNameUnread] = useState(false);
  /** `tenants.timezone`, or null when the gym has not set one. The period
   *  presets below fill in a calendar day, and the only calendar that means
   *  anything on an accountant's bundle is the gym's. */
  const [zone, setZone] = useState<string | null>(null);
  const [reads, setReads] = useState<Reads>(PENDING);
  /**
   * When the twenty-eight reads behind this page came back — and why this is
   * the one screen in the console that deliberately does NOT carry a
   * `<Fetched>` stamp over it.
   *
   * Checked rather than inherited, on 4 September 2026. Three reasons, and the
   * first is the one that decides it:
   *
   *   · The moment is ALREADY on the screen, and in the form that matters.
   *     `readAt` is what becomes `manifest.exportedAt`, the completeness banner
   *     prints that instant verbatim, and the README and every filename carry
   *     it. A `<Fetched>` beside it would be a second sentence about the same
   *     fact in different words, six inches from the first.
   *   · `useFetched` re-reads on every `visibilitychange`. Here that is
   *     twenty-eight queries fired because somebody looked at another tab —
   *     and it would reset `reads` to PENDING under an owner who is mid-way
   *     through choosing a member, which is what the header above means by
   *     reading the record once and narrowing it afterwards.
   *   · The age of this read cannot go quietly wrong the way a figure on
   *     /accounting can. A stale read here does not mislabel a number on a
   *     screen; it produces a bundle whose own manifest states the moment it
   *     was taken, which is the honest artefact either way.
   *
   * What it should NOT become is a stamp with a background refresh. If this
   * ever gains a "Read again", it belongs beside the download control, wired
   * to `load` and to nothing automatic.
   */
  const [readAt, setReadAt] = useState<string | null>(null);
  // The two days somebody typed, held as typed. Blank on both sides is the
  // whole record, which is the default and is a different request from a very
  // wide period rather than a special case of one.
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');

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
        classes = await fetchClasses(supabase, tenantId, READ_FROM, READ_TO);
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
      memberRecords, agreements, signatures, documents,
      orders, closes, adjustments, equipmentLog, reconciles,
    ] = await Promise.all([
      slice(() => fetchPlans(supabase, tenantId)),
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchPayments(supabase, tenantId)),
      timetable(),
      slice(() => fetchSessions(supabase, tenantId, READ_FROM, READ_TO)),
      slice(() => fetchPassTypes(supabase, tenantId)),
      slice(() => fetchPasses(supabase, tenantId)),
      // `whole: true`, not a bare call. Without it this landed on the branch
      // that refuses an unbounded door log, so door-log.csv came out of a
      // thrown read — under the banner at the top saying the bundle is
      // complete. The export is the one caller that genuinely wants every row.
      slice(() => fetchVisits(supabase, tenantId, { whole: true })),
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
      // The paperwork, and the member's own file. Same discipline: four reads
      // with four sets of three states, because an empty signatures.csv beside
      // a refused query would tell a gym facing a claim that nobody ever signed
      // anything — which is the single most expensive false statement this
      // bundle is capable of making.
      slice(() => readMemberRecords(tenantId)),
      slice(() => readAgreements(tenantId)),
      slice(() => readSignatures(tenantId)),
      slice(() => readDocuments(tenantId)),
      // The order book, the closed months, the payroll adjustments, the
      // accident book and the reconciliation marks. Five more reads and five
      // more sets of three states, for the reason all the others have one: an
      // empty online-orders.csv beside a refused query would tell a gym that
      // takes card money on its own Stripe account that it has never sold
      // anything online, and that is the file it would hand an accountant.
      slice(() => readOrders(tenantId)),
      slice(() => readCloses(tenantId)),
      slice(() => readAdjustments(tenantId)),
      slice(() => readEquipmentLog(tenantId)),
      slice(() => readReconciles(tenantId)),
    ]);

    setReads({
      plans, memberships, payments, classes, attendance, sessions, passTypes, passes, visits, invites,
      invoices, settlements, equipment, shifts, interventions, promos, events, purchases,
      memberRecords, agreements, signatures, documents,
      orders, closes, adjustments, equipmentLog, reconciles,
    });
    setReadAt(new Date().toISOString());
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
      if (!who?.tenantId) { setReads(EMPTY); setReadAt(new Date().toISOString()); return; }
      // `readTenant`, not a hand-written `select('name')`. It reads the
      // timezone in the same round trip, and the period presets below need it:
      // "This month" pressed at 09:00 on 1 September in Auckland was computing
      // August, because `presetDays` is given an instant and reads UTC's day off
      // it. That is a bundle labelled August, holding August, produced by an
      // owner who asked for September — on the screen whose entire purpose is
      // handing a defensible record to somebody outside the building.
      const t = await readTenant(supabase, who.tenantId);
      // Checked, not assumed: a null name here means "not read", not "the gym
      // has no name" — and the gym's name ends up in every filename.
      if (live) { setGymName(t.name); setZone(t.zone); }
      if (live) setGymNameUnread(!!t.error);
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const periodError = windowBlocker(fromDay, toDay);
  // A period that will not parse produces NO window rather than half of one. An
  // export bounded by whichever of the two dates happened to be typeable is the
  // failure this whole screen is about: it would be a slice, and it would name
  // bounds nobody asked for.
  const window: ExportWindow = useMemo(
    () => (periodError ? { from: null, to: null } : windowFromDays(fromDay, toDay)),
    [periodError, fromDay, toDay],
  );

  const input: GymExportInput | null = useMemo(() => (
    me?.tenantId || me
      ? {
          gymName,
          tenantId: me?.tenantId ?? null,
          generatedAt: readAt ?? new Date(0).toISOString(),
          // The calendar the date-only columns are written on. Already read
          // above for the period presets, and it was needed twice: `date` in
          // payments.csv is what previewPayments reads and what gymImports
          // re-stamps at midday, so a bundle written on UTC's day RE-IMPORTS
          // on the wrong day for a gym far from UTC — the money moves to the
          // neighbouring day, and on a month boundary to the neighbouring
          // month, in the file an accountant is handed. Null is passed as null
          // rather than defaulted: gymExport falls back to UTC and the bundle
          // says in three places that it did.
          timezone: zone,
          from: window.from,
          to: window.to,
          ...reads,
        }
      : null
  ), [me, gymName, zone, readAt, reads, window]);

  const blocker = input ? exportBlocker(input) : 'Loading.';
  // Built even while blocked, so the screen can show what the bundle WOULD
  // contain — but the download stays disabled, because a bundle taken mid-read
  // is missing rows that exist and nothing in it would know.
  const bundle = useMemo(() => (input && readAt ? buildGymExport(input) : null), [input, readAt]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/export">
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
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/export">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          The export carries every member, payment and door visit the gym holds,
          so it is owner-only.
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/export">
      <h1>Export</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: 640 }}>
        The whole operating record as CSV in one zip, in the shapes another
        system can read: the price book, members and the gym’s own file on each of
        them, memberships, payments, invoices, the timetable, class attendance,
        one-to-ones, passes, the door log, invites, payroll settlements and the
        adjustments behind them, the equipment register and its maintenance and
        accident book, the rota, member contact, promo codes, the activity log,
        PT packs, what members bought online with the Stripe reference each one
        reconciles to, the months that were signed off, the reconciliation marks,
        and the paperwork — every version of what people are asked to sign,
        every signature with who actually gave it, and the index of the filing
        cabinet. It is the gym’s record, and leaving with it has to be possible.
        A period can be set below; one member’s own file can be taken from the
        bottom of this page.
      </p>

      {bundle && !bundle.complete ? (
        <Banner tone="crit">
          <strong>{bundle.manifest.warning}</strong>
        </Banner>
      ) : null}

      {bundle?.caveats.map((c) => (
        <Banner key={c} tone={c.startsWith('This is a SLICE') ? 'crit' : undefined}>{c}</Banner>
      ))}

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
          {bundle.manifest.wholeRecord
            ? 'Every part of the record was read, and read whole. This bundle is complete as of '
            : 'Every part was read, and read whole — within the period below. Complete here means nothing was lost to a failed read; it does not mean this is the whole record. Taken as of '}
          <span className="mono">{bundle.manifest.exportedAt}</span>. No read here can come back
          short without saying so — each one either fails rather than return a partial set, or
          pages until it has all of it, so a part that could not be read in full is listed as
          missing rather than quietly shortened.
        </Banner>
      ) : null}

      <Period
        fromDay={fromDay} toDay={toDay}
        setFromDay={setFromDay} setToDay={setToDay}
        error={periodError} window={window} zone={zone}
      />
      <Parts input={input} window={window} />
      <Files bundle={bundle} blocker={blocker} me={me} />
      <MemberRecord input={input} blocker={blocker} readAt={readAt} me={me} />
      <Notes />
    </Shell>
  );
}

/* ── the period ────────────────────────────────────────────────────────────── */

/**
 * The dates, and what setting them costs.
 *
 * ── Why the consequence is on the screen and not only in the file ─────────
 *
 * Because the person who sets a period and the person who reads the bundle are
 * usually the same person three weeks apart. Left to the README alone, the
 * owner types two dates, downloads what looks like nineteen files of gym
 * record, and emails it to an accountant with a covering note saying "here is
 * everything". The sentence that stops that has to be in front of them at the
 * moment they choose, so this section says out loud which files a period
 * narrows and which it leaves whole — the same two lists the README prints, in
 * the same words, because the two disagreeing is its own defect.
 *
 * Blank is the default and blank means everything. There is no "all time"
 * preset doing the same job differently: two spellings of the same request is
 * how a screen ends up with a state nobody tested.
 */
function Period({ fromDay, toDay, setFromDay, setToDay, error, window, zone }: {
  fromDay: string; toDay: string;
  setFromDay: (v: string) => void; setToDay: (v: string) => void;
  error: string | null; window: ExportWindow;
  /** `tenants.timezone`. Which calendar "this month" means. */
  zone: string | null;
}) {
  const bounded = isBounded(window);
  const narrowed = EXPORT_PARTS.filter((p) => EXPORT_DATE_FIELD[p]);
  const whole = EXPORT_PARTS.filter((p) => !EXPORT_DATE_FIELD[p]);

  const preset = (id: PresetId) => {
    // The GYM's day, handed in as a bare `YYYY-MM-DD`.
    //
    // It was `new Date().toISOString()` — an instant — and `presetDays` reads
    // UTC's day off whatever it is given, deliberately and for a good reason:
    // its own header explains that everything inside is UTC so the function is
    // pure and answers the same under six timezones. That purity is not the
    // problem; WHICH day is handed to it is, and the header says so too —
    // "`today` is passed in rather than read from the clock". Passing the
    // instant made the answer UTC's day; passing the gym's day as a calendar
    // string makes `instantOf` parse it at UTC midnight and the UTC getters
    // read the same three numbers back out, so the gym's day survives intact.
    //
    // The cost of the old form: "This month" pressed at 09:00 on 1 September in
    // Auckland filled the boxes with August, and "This year" pressed on 1
    // January filled them with last year. Both are a bundle whose filename,
    // manifest and README name a period the owner did not ask for.
    //
    // With no zone set, the reader's own calendar day — not UTC's, which is
    // nobody's; a person pressing a button called "This month" at 6pm on the
    // 31st in Los Angeles means the month they are standing in.
    const d = presetDays(id, gymDay(Date.now(), zone) ?? isoDate(new Date()));
    setFromDay(d.from);
    setToDay(d.to);
  };

  return (
    <Section
      title="The period"
      sub="Leave both blank for the whole record. Every request an accountant or an auditor makes is for a period, and a bundle that covers one has to say so — in its filename, in the manifest and at the top of the README."
    >
      <div style={formRow}>
        <label style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
          From{' '}
          <input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)}
                 style={field} aria-label="The first day the export covers" />
        </label>
        <label style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
          To{' '}
          <input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)}
                 style={field} aria-label="The last day the export covers, included" />
        </label>
        {PRESET_IDS.map((id) => (
          <button key={id} onClick={() => preset(id)} style={linkBtn}>{PRESET_LABEL[id]}</button>
        ))}
      </div>

      <div style={{ padding: '12px 14px', fontSize: 12.5, lineHeight: 1.65 }}>
        {error ? (
          <p style={{ margin: 0, color: 'var(--crit)' }}>
            {error} Until that is fixed the export covers the whole record — it is not
            half-bounded by whichever date was readable.
          </p>
        ) : (
          <p style={{ margin: 0, color: bounded ? 'var(--warn)' : 'var(--ink3)' }}>
            {bounded
              ? <>This export will cover <strong>{describeWindow(window)}</strong>. That is a SLICE of the
                  record, not the record — the dates go in every filename and the README opens with
                  them, because a bundle that looks whole and is a quarter is the failure this is
                  guarding against.</>
              : <>No period set, so this is the whole record: <strong>{describeWindow(window)}</strong>.</>}
          </p>
        )}

        {bounded && !error ? (
          <div style={{ marginTop: 10, color: 'var(--ink3)' }}>
            <p style={{ margin: '0 0 4px' }}>
              <strong style={{ color: 'var(--ink2)' }}>Narrowed by the period</strong> — only rows
              dated inside it: {narrowed.map((p) => `${EXPORT_LABEL[p]} (${EXPORT_DATE_FIELD[p]})`).join(', ')}.
            </p>
            <p style={{ margin: '0 0 4px' }}>
              <strong style={{ color: 'var(--ink2)' }}>Not narrowed</strong>, whatever period you
              ask for: {whole.map((p) => EXPORT_LABEL[p]).join(', ')}.
            </p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {/* The two that would be WRONG if they were bounded, said rather
                  than listed. A reader guesses "not narrowed" means "we did not
                  get round to it", and for these two it means the opposite. */}
              <li>{EXPORT_UNBOUNDED_WHY.memberships}</li>
              <li>{EXPORT_UNBOUNDED_WHY.agreements}</li>
            </ul>
            <p style={{ margin: '8px 0 0' }}>
              So do not add a figure from a narrowed file to one from a whole file and call the
              answer a figure for the period.
            </p>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/* ── what is in the record ─────────────────────────────────────────────────── */

interface PartRow {
  part: ExportPart;
  label: string;
  cost: string;
  state: 'loading' | 'ready' | 'partial' | 'failed';
  rows: number | null;
  /** How many rows were accepted, when the read came back at its ceiling. Null
   *  on every other state — a cap is only a fact about a truncated read. */
  cap: number | null;
  reason: string | null;
  /** The column the period narrowed this part by, or null when it left it
   *  whole. Null on an unbounded export too — nothing was narrowed. */
  by: string | null;
}

function Parts({ input, window }: { input: GymExportInput | null; window: ExportWindow }) {
  const bounded = isBounded(window);
  // Counted over the WINDOWED rows, because this table sits above a download
  // button and the number beside a part has to be the number of rows that
  // download contains. Showing the unnarrowed count here would put "payments:
  // 4,102" on screen over a file holding 312.
  const scoped = input ? windowSlices(input, window) : null;
  const rows: PartRow[] = EXPORT_PARTS.map((part) => {
    const s = scoped ? partSlice(scoped, part) : ({ state: 'loading' } as const);
    return {
      part,
      label: EXPORT_LABEL[part],
      cost: EXPORT_COST[part],
      state: s.state,
      // Counted under 'ready' only. A truncated read HAS a row count and it is
      // the count of the prefix, and printing it in a column headed "Rows" over
      // a download button would state the size of the file as the size of the
      // record. The cap goes in the sentence beside it instead.
      rows: s.state === 'ready' ? (s.rows as unknown[]).length : null,
      cap: s.state === 'partial' ? s.cap : null,
      reason: s.state === 'failed' ? s.reason : null,
      by: bounded ? EXPORT_DATE_FIELD[part] : null,
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
        // Its own word, not 'read'. A truncated part is in the bundle and the
        // bundle is not the record, which is a different thing to know from
        // either a failure or a clean read.
        : r.state === 'partial' ? <span style={{ color: 'var(--warn)' }}>cut off</span>
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
            : r.state === 'partial'
            ? <span style={{ color: 'var(--ink2)' }}>
                <strong>Only the first {r.cap ?? 0} rows.</strong> {capitalise(r.cost)} is in the
                bundle as a PREFIX, not in full — a total taken over this file would be a subtotal.
              </span>
            : r.rows === 0
              // Under a period, an empty file has a THIRD reading nobody would
              // guess: read fine, and nothing inside your dates. Saying "there
              // is nothing recorded" over that would be false about the gym.
              ? <span style={{ color: 'var(--ink3)' }}>
                  {bounded && r.by
                    ? 'Read, and nothing dated inside the period.'
                    : 'Read, and there is nothing recorded.'}
                </span>
              : <span style={{ color: 'var(--ink3)' }}>{capitalise(r.cost)}.</span>,
    },
    ...(bounded ? [{
      key: 'period', header: 'Period', value: (r: PartRow) => r.by ?? '',
      render: (r: PartRow) => (r.by
        ? <span style={{ color: 'var(--ink3)', fontSize: 12.5 }}>narrowed by <span className="mono">{r.by}</span></span>
        : <span style={{ color: 'var(--warn)', fontSize: 12.5 }}>whole — not narrowed</span>),
    } as Column<PartRow>] : []),
  ];

  return (
    <Section
      title="What is in the record"
      sub={bounded
        ? 'Counted over the period set above. Each part is read on its own; a read that fails is reported here and named in the bundle, and never becomes an empty file.'
        : 'Each part is read on its own. A read that fails is reported here and named in the bundle — it never becomes an empty file.'}
    >
      <DataTable noun="parts of the record" rows={rows} columns={cols} rowKey={(r) => r.part} empty="Nothing to export." />
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
      await logExport(
        me, 'gym', null,
        bundle.files.reduce((a, f) => a + (f.rows ?? 0), 0),
        bundle.manifest.parts.map((p) => p.part).filter((p): p is ExportPart => !!p),
        { from: bundle.manifest.window.from, to: bundle.manifest.window.to },
      );
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
        : <DataTable noun="files" rows={bundle.files} columns={cols} rowKey={(f) => f.name} empty="Nothing to download." />}
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
        <li>
          <strong>A signature says who gave it.</strong> Every row in <span className="mono">signatures.csv</span> carries an
          attribution column and a sentence saying what it means. Only <em>member</em> is the member’s own act;
          <em> staff</em> is somebody at the desk recording that they agreed, and <em>unknown</em> is a row written before
          this product recorded which. Do not quote a row without that column — it is the difference between a
          signature and a note about one.
        </li>
        <li>
          <strong>The filing cabinet leaves as an index, not as files.</strong>{' '}
          <span className="mono">documents.csv</span> says what each document is, what it is about and where it is
          stored. A CSV cannot carry a 25 MB scan, so the scans themselves are still in the bucket — the file says
          so rather than letting a full-looking column read as “we have the contracts”.
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
      await logExport(me, 'member', memberId, rows, MEMBER_PARTS,
        { from: bundle.manifest.window.from, to: bundle.manifest.window.to });
    } catch (e) {
      setErr(reason(e));
    } finally { setBusy(false); }
  };

  return (
    <Section
      title="One member’s record"
      sub="What this gym holds about one person — their own file (contact, next of kin, the medical note and the desk’s note), memberships, payments, invoices, bookings, one-to-ones, passes, door entries, contact, the activity log, every waiver and consent they signed and the wording they signed it against. Not the price book, the timetable or the rota: those are the gym’s and belong to nobody."
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
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '74ch' }}>
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
  rows: number | null, parts: ExportPart[], window: ExportWindow,
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
    // The period, in the log. Without it the row says a number of rows left the
    // platform and cannot say what they were a number OF, so two exports of the
    // same gym a month apart are indistinguishable in the one record that is
    // supposed to answer what was taken.
    note: `Covers ${describeWindow(window)}.`,
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
  // The roster read was `.limit(1001)` with no probe and no assert, so past a
  // thousand coaches `client_purchases` was scoped to a PARTIAL roster and
  // purchases.csv came out short with no marker of any kind — the quiet
  // failure src/lib/rowCap.ts calls "strictly worse than a failed read", inside
  // a bundle that states it is complete. Paged, so there is no thousand.
  const trs = await readAll<any>(
    (from, to) => supabase
      .from('trainers').select('id').eq('tenant_id', tenantId)
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's coaches",
  );
  const ids: string[] = trs.map((r: any) => r.id);
  if (!ids.length) return [];
  // `readByIds` rather than one `.in()`: the roster no longer stops at a
  // thousand, and `trainer_id` is a foreign key, so a chunk of ids answers with
  // many more rows than ids and each chunk has to be finished.
  const rows = await readByIds<any>(
    ids,
    (chunk, from, to) => supabase
      .from('client_purchases')
      .select('id, trainer_id, client_id, amount_cents, currency, sessions_total, sessions_used, status, created_at')
      .in('trainer_id', chunk)
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

/* ── the five the round after the paperwork left behind ────────────────────── */

/**
 * The order book — card money the gym took online.
 *
 * `fetchGymOrders` in src/lib/gymOrders.ts is the console's own reader and it
 * is NOT reused here, deliberately: it selects the columns /orders draws and
 * leaves out the three Stripe references, which are the only join between this
 * bundle and the gym's own payouts. An export that dropped them would produce a
 * list of amounts an owner cannot reconcile against anything.
 *
 * `gym_orders_owner_r` has existed since supabase/parts/281; nothing here needs
 * a policy change.
 */
async function readOrders(tenantId: string): Promise<ExportOrder[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_orders')
      .select('id, member_id, kind, intent, status, amount_cents, currency, plan_id, pass_type_id, '
        + 'term_starts_on, term_ends_on, uses_total, expires_on, membership_id, pass_id, '
        + 'stripe_account_id, stripe_session_id, stripe_payment_intent, failure_note, created_at, paid_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's online orders",
  );
  if (!rows.length) return [];
  const names = await namesFor(rows.map((r) => r.member_id));
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id ?? null,
    memberName: r.member_id ? names.get(r.member_id) ?? null : null,
    kind: r.kind ?? null, intent: r.intent ?? null, status: r.status ?? null,
    // Checked rather than coerced: `amount_cents` is not null in the schema, so
    // a non-number here means the read did not answer and must export blank.
    amountCents: Number.isFinite(r.amount_cents) ? Number(r.amount_cents) : null,
    currency: r.currency ?? null,
    planId: r.plan_id ?? null, passTypeId: r.pass_type_id ?? null,
    termStartsOn: r.term_starts_on ?? null, termEndsOn: r.term_ends_on ?? null,
    usesTotal: Number.isFinite(r.uses_total) ? Number(r.uses_total) : null,
    expiresOn: r.expires_on ?? null,
    membershipId: r.membership_id ?? null, passId: r.pass_id ?? null,
    stripeAccountId: r.stripe_account_id ?? null,
    stripeSessionId: r.stripe_session_id ?? null,
    stripePaymentIntent: r.stripe_payment_intent ?? null,
    failureNote: r.failure_note ?? null,
    createdAt: r.created_at ?? null,
    paidAt: r.paid_at ?? null,
  }));
}

/** Every month somebody signed off, reopenings included. */
async function readCloses(tenantId: string): Promise<ExportClose[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_month_closes')
      .select('id, month_key, closed_at, closed_by, note, taken_cents, invoiced_cents, outstanding_cents, '
        + 'payroll_cents, currency, unmarked_sessions, blockers_at_close, reopened_at, reopened_by, reopen_reason')
      .eq('tenant_id', tenantId)
      .order('month_key', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "the months this gym has closed",
  );
  if (!rows.length) return [];
  const names = await namesFor(rows.flatMap((r) => [r.closed_by, r.reopened_by]));
  const cents = (v: unknown): number | null => (Number.isFinite(v) ? Number(v) : null);
  return rows.map((r) => ({
    id: r.id,
    monthKey: r.month_key,
    closedAt: r.closed_at ?? null,
    closedById: r.closed_by ?? null,
    closedByName: r.closed_by ? names.get(r.closed_by) ?? null : null,
    takenCents: cents(r.taken_cents),
    invoicedCents: cents(r.invoiced_cents),
    outstandingCents: cents(r.outstanding_cents),
    payrollCents: cents(r.payroll_cents),
    currency: r.currency ?? null,
    unmarkedSessions: cents(r.unmarked_sessions),
    blockersAtClose: r.blockers_at_close ?? null,
    note: r.note ?? null,
    reopenedAt: r.reopened_at ?? null,
    reopenedById: r.reopened_by ?? null,
    reopenedByName: r.reopened_by ? names.get(r.reopened_by) ?? null : null,
    reopenReason: r.reopen_reason ?? null,
  }));
}

/** The lines that made a settlement the figure it was. */
async function readAdjustments(tenantId: string): Promise<ExportAdjustment[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('payroll_adjustments')
      .select('id, trainer_id, kind, amount_cents, currency, note, applies_on, settlement_id, created_at, created_by')
      .eq('tenant_id', tenantId)
      .order('applies_on', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's payroll adjustments",
  );
  if (!rows.length) return [];
  const names = await namesFor(rows.flatMap((r) => [r.trainer_id, r.created_by]));
  return rows.map((r) => ({
    id: r.id,
    trainerId: r.trainer_id ?? null,
    trainerName: r.trainer_id ? names.get(r.trainer_id) ?? null : null,
    kind: r.kind ?? null,
    amountCents: Number.isFinite(r.amount_cents) ? Number(r.amount_cents) : null,
    currency: r.currency ?? null,
    note: r.note ?? null,
    appliesOn: r.applies_on ?? null,
    settlementId: r.settlement_id ?? null,
    createdAt: r.created_at ?? null,
    createdById: r.created_by ?? null,
    createdByName: r.created_by ? names.get(r.created_by) ?? null : null,
  }));
}

/** The maintenance history and the accident book. */
async function readEquipmentLog(tenantId: string): Promise<ExportEquipmentLog[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_equipment_log')
      .select('id, equipment_id, equipment_label, kind, happened_on, performed_by, findings, cost_cents, '
        + 'currency, document_id, reported_to, recorded_by, created_at')
      .eq('tenant_id', tenantId)
      .order('happened_on', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's maintenance and accident book",
  );
  if (!rows.length) return [];
  const names = await namesFor(rows.map((r) => r.recorded_by));
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipment_id ?? null,
    equipmentLabel: r.equipment_label ?? null,
    kind: r.kind ?? null,
    happenedOn: r.happened_on ?? null,
    performedBy: r.performed_by ?? null,
    findings: r.findings ?? null,
    costCents: Number.isFinite(r.cost_cents) ? Number(r.cost_cents) : null,
    currency: r.currency ?? null,
    documentId: r.document_id ?? null,
    reportedTo: r.reported_to ?? null,
    recordedById: r.recorded_by ?? null,
    recordedByName: r.recorded_by ? names.get(r.recorded_by) ?? null : null,
    createdAt: r.created_at ?? null,
  }));
}

/** Which lines somebody accepted as explained, and which they flagged. */
async function readReconciles(tenantId: string): Promise<ExportReconcileMark[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_reconcile_marks')
      .select('id, subject_kind, subject_id, state, note, marked_by, marked_at')
      .eq('tenant_id', tenantId)
      .order('marked_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "this gym's reconciliation marks",
  );
  if (!rows.length) return [];
  const names = await namesFor(rows.map((r) => r.marked_by));
  return rows.map((r) => ({
    id: r.id,
    subjectKind: r.subject_kind ?? null,
    subjectId: r.subject_id ?? null,
    state: r.state ?? null,
    note: r.note ?? null,
    markedById: r.marked_by ?? null,
    markedByName: r.marked_by ? names.get(r.marked_by) ?? null : null,
    markedAt: r.marked_at ?? null,
  }));
}

/* ── the paperwork, and the member's own file ──────────────────────────────── */

/**
 * The gym's own file on each member.
 *
 * `fetchMemberRecords` in src/lib/gymMembers.ts, unchanged and unwrapped: it
 * already throws on an error and already refuses a truncated read, which is the
 * whole contract this screen needs. Reusing it rather than writing a nineteenth
 * hand-rolled read is also the point — this is the SAME query /members runs, so
 * the export cannot show a member a record that differs from the one the
 * console shows about them.
 *
 * The name comes from the roster rather than from the row, because
 * `gym_member_records` holds no name: it is keyed by member and joined to a
 * person by id everywhere else too.
 */
async function readMemberRecords(tenantId: string): Promise<ExportMemberRecord[]> {
  const rows = await fetchMemberRecords(supabase, tenantId);
  if (!rows.length) return [];
  const names = await namesFor(rows.map((r) => r.memberId));
  return rows.map((r) => ({
    memberId: r.memberId,
    memberName: names.get(r.memberId) ?? null,
    phone: r.phone, email: r.email,
    emergencyName: r.emergencyName, emergencyPhone: r.emergencyPhone,
    medicalNote: r.medicalNote, note: r.note,
    tags: r.tags, updatedAt: r.updatedAt,
  }));
}

/** Every version of everything this gym asks anybody to agree to, retired ones
 *  included — a retired version is what its signatures still point at. */
async function readAgreements(tenantId: string): Promise<ExportAgreement[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_agreements')
      .select('id, kind, title, body, version, active, required, created_at')
      .eq('tenant_id', tenantId)
      .order('kind', { ascending: true })
      .order('version', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "the documents this gym asks people to sign",
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body,
    version: Number.isFinite(r.version) ? Number(r.version) : null,
    active: typeof r.active === 'boolean' ? r.active : null,
    required: typeof r.required === 'boolean' ? r.required : null,
    createdAt: r.created_at ?? null,
  }));
}

/**
 * Every signature, with the column that says who actually gave it.
 *
 * `attribution` and `signed_by` are selected explicitly and `attributionOf`
 * narrows the value, so a database on which supabase/parts/520 has not been
 * applied — where the column comes back missing — produces 'unknown' rather
 * than throwing or defaulting to 'staff'. That is the honest degradation: an
 * unreadable answer to "who signed this" is exactly what 'unknown' means.
 *
 * Read straight here rather than through `fetchSignatures` in src/lib/gymDocs.ts
 * for the reason the eight above are: that read does not select `signed_by` or
 * `witnessed_by`, and the export wants the whole row. It is the same table with
 * the same tenant filter, ordered for paging the same way.
 */
async function readSignatures(tenantId: string): Promise<ExportSignature[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_agreement_signatures')
      .select('id, agreement_id, member_id, signed_name, signed_at, version_signed, attribution, signed_by, witnessed_by, guardian_name, guardian_relationship, note')
      .eq('tenant_id', tenantId)
      .order('signed_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    'the signatures this gym holds',
  );
  if (!rows.length) return [];
  const names = await namesFor(rows.flatMap((r) => [r.member_id, r.signed_by, r.witnessed_by]));
  const docs = await agreementsFor(rows.map((r) => r.agreement_id));
  return rows.map((r) => {
    const a = docs.get(r.agreement_id);
    return {
      id: r.id,
      agreementId: r.agreement_id,
      agreementKind: a?.kind ?? null,
      agreementTitle: a?.title ?? null,
      memberId: r.member_id ?? null,
      // The live name where the account still exists, then the name they SIGNED
      // with. The second is the one that matters: a signature is what the person
      // wrote at the time, and it outlives them renaming or being erased.
      memberName: (r.member_id ? names.get(r.member_id) : undefined) ?? r.signed_name ?? null,
      signedName: r.signed_name,
      signedAt: r.signed_at,
      versionSigned: Number.isFinite(r.version_signed) ? Number(r.version_signed) : null,
      attribution: attributionOf(r.attribution),
      signedById: r.signed_by ?? null,
      signedByName: r.signed_by ? names.get(r.signed_by) ?? null : null,
      witnessedById: r.witnessed_by ?? null,
      witnessedByName: r.witnessed_by ? names.get(r.witnessed_by) ?? null : null,
      guardianName: r.guardian_name ?? null,
      guardianRelationship: r.guardian_relationship ?? null,
      note: r.note ?? null,
    };
  });
}

/** The index of the filing cabinet. The FILES do not travel — see the note on
 *  `documentsTable` in src/lib/gymExport.ts. */
async function readDocuments(tenantId: string): Promise<ExportDocument[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_documents')
      .select('id, member_id, member_attached, equipment_id, kind, title, storage_path, mime, size_bytes, expires_on, note, uploaded_by, uploaded_at')
      .eq('tenant_id', tenantId)
      .order('uploaded_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    "the documents this gym holds",
  );
  if (!rows.length) return [];
  const names = await namesFor(rows.map((r) => r.uploaded_by));
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id ?? null,
    // The column where there is one, and `member_id` where there is not, which
    // is what a database from before supabase/parts/390 would say. Never
    // `?? false`: a missing column must not read as "this is nobody's
    // paperwork" in the file a gym produces when asked whose it is.
    memberAttached: typeof r.member_attached === 'boolean' ? r.member_attached : r.member_id != null,
    equipmentId: r.equipment_id ?? null,
    kind: r.kind, title: r.title,
    storagePath: r.storage_path,
    mime: r.mime ?? null,
    sizeBytes: Number.isFinite(r.size_bytes) ? r.size_bytes : null,
    expiresOn: r.expires_on ?? null,
    note: r.note ?? null,
    uploadedById: r.uploaded_by ?? null,
    uploadedByName: r.uploaded_by ? names.get(r.uploaded_by) ?? null : null,
    uploadedAt: r.uploaded_at,
  }));
}

/**
 * Kind and title for a set of agreement ids.
 *
 * Deliberately not throwing, for the same reason as `namesFor` below: these two
 * columns LABEL a signature whose id, name, date and attribution are all read
 * from the row itself, and refusing to export the signatures because their
 * titles would not load withholds the evidence to protect the caption. Every
 * row carries `agreement_id` regardless, and agreements.csv is in the bundle.
 */
async function agreementsFor(
  ids: Array<string | null | undefined>,
): Promise<Map<string, { kind: string | null; title: string | null }>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, { kind: string | null; title: string | null }>();
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    // eslint-disable-next-line -- no-error-ok: a missing title renders as a blank beside the agreement_id that is always written, and agreements.csv carries the wording either way
    const { data } = await supabase
      .from('gym_agreements').select('id, kind, title').in('id', unique.slice(i, i + ID_CHUNK));
    for (const a of (data ?? []) as any[]) {
      out.set(a.id, { kind: a.kind ?? null, title: a.title ?? null });
    }
  }
  return out;
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

// The banner is the shared one now: studio-web/components/Banner.tsx. This
// page carried a byte-for-byte copy of it that rendered into a plain <div>,
// so every sentence it printed — including the ones saying a write was
// REFUSED and nothing was saved — was silent to a screen reader. The shared
// component carries role="alert"/"status" and aria-live.
// The wrapper stays only for this page's looser line height, which is passed
// through the shared component's `style` rather than duplicating it.
function Banner({ children, tone }: { children: React.ReactNode; tone?: BannerTone }) {
  return <SharedBanner tone={tone} style={{ lineHeight: 1.6 }}>{children}</SharedBanner>;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
