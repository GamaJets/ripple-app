'use client';

// Close — is this month finished, and may I act on these numbers?
//
// Every other screen in this console reports. This one *refuses*. A gym owner
// closing August is about to pay trainers, hand a figure to an accountant and
// chase whoever has not paid, and the single most expensive thing this software
// could do is show them a tidy total that quietly omitted the twelve sessions
// nobody marked.
//
// So the shape is inverted from the rest of the console: the verdict is at the
// top, the reasons the month is NOT closed come before any figure, and where
// the record cannot answer, the screen says so instead of printing a zero.
//
// All the reasoning lives in src/lib/monthEnd.ts, which has no Supabase import
// and is tested under plain node. What lives here is the reads — and the reads
// are the dangerous part, because supabase-js RESOLVES on a database error. A
// missing `.error` check on any query below would turn a broken month into an
// empty one, which on this screen means a payroll run over nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchMemberships, fetchPayments, money, sharedCurrency } from '@lib/gymRecord';
import {
  fetchSessions, isAwaitingOutcome, PAY_DELIVERED_ONLY,
  type PtSession, type PayPolicy, type PayrollLine,
} from '@lib/gymSessions';
import { fetchPasses } from '@lib/gymPasses';
import { payPolicyOf, PAY_POLICY_LABEL, NO_PAY_POLICY_NOTE, type PayPolicyCode } from '@lib/gymPolicy';
import { readAll, TruncatedRead } from '@lib/rowCap';
// The costs side of the month, which this screen has never read and which
// pressing Close permanently locks. See the header of src/lib/closeCosts.ts.
import { fetchGymCosts, gymCostCategoryLabel, type GymCost } from '@lib/gymCosts';
import {
  costVerdict, costNoteForClose, joinCloseBlockers, monthsBefore, COST_LOOKBACK_MONTHS,
  type CostReadState, type CostVerdict,
} from '@lib/closeCosts';
import { readByIds } from '@lib/idLookup';
import { NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
// The sentence for a figure whose own rows hold two moneys. Imported rather
// than worded here for the reason sumCurrency.ts gives at length: it is a
// different missing thing from `NO_CURRENCY_NOTE` above, and a screen that
// prints the tenant sentence over a mixed ledger sends an owner to Ops to set
// a field that is already right.
import { MIXED_CURRENCY_NOTE } from '@lib/sumCurrency';
// Only for the label map below, so a reconciliation state with no caption is a
// compile error rather than a blank line above the sentence.
import type { Reconciliation } from '@lib/finReconcile';
import { sliceLoading, sliceReady, sliceFailed, sliceNote, type Slice } from '@lib/memberView';
// The reader's locale, the GYM's zone. This page is printed for an accountant
// and every date on it is a month boundary; drawn on the reader's clock, a
// month closed at 09:00 in Dubai reads as the previous day in London.
import { gymDateText, gymDateTimeText } from '@lib/gymWhen';
import {
  monthWindow, monthKeyOf, buildClose, isOverdue, closeHeadline,
  type CloseRecord, type MonthClose, type GymInvoice, type Line, type Blocker, type Owed,
} from '@lib/monthEnd';
/*
 * The month, on the GYM's clock rather than on this laptop's.
 *
 * `monthWindow` above is still imported and still used — for LABELS, which are
 * calendar facts and need no zone. What it must not be used for on this page is
 * the bounds a read is filtered on: `fromIso`/`toIso` come out of
 * `new Date(y, mo - 1, 1)`, which is midnight where the browser is, and the two
 * reads this page filters on them are `gym_payments.taken_at` and
 * `sessions.starts_at` — both `timestamptz`. An owner in London closing a Dubai
 * gym asked for August from 23:00Z on 31 July to 23:00Z on 31 August, when the
 * gym's August ran 20:00Z to 20:00Z. Four hours of takings at each boundary
 * were filed in the wrong month, and this is the one screen where that is
 * permanent: `close_month` writes a snapshot of the figure into
 * `gym_month_closes` and an accountant works from it afterwards.
 *
 * `recentMonths` and `monthEnded` are gone from the import for the same reason
 * one layer up — which month is RUNNING and whether a month is OVER are facts
 * about the gym, and both of those read the device's calendar to answer.
 */
import { monthAtGym, gymRecentMonths, gymMonthEnded } from '@lib/gymMonth';
import { monthTickStart } from '@lib/pickerMonth';
import { useMonthTick } from '@/lib/monthTick';
import {
  fetchCloses, closeMonth, reopenMonth, snapshotOf, liveCloseFor,
  closeBlocker, reopenBlocker, driftSince,
  type MonthCloseRow,
} from '@lib/gymClose';
// `tenants.session_fee` is stored in WHOLE units and every `*_cents` column is
// in minor units, and the factor between them is not a hundred — it is a
// hundred in most of the world, one in Japan and Korea, and a thousand in
// Kuwait and Bahrain. `minorFromWhole` asks `currencyDecimals` rather than
// assuming; see the note on it in src/lib/coachMoney.ts.
import { minorFromWhole } from '@lib/coachMoney';
// The three-layer pay rule, in the one place that holds it. /payroll,
// /sessions and /coach/earnings all resolve rates through this pair before any
// figure is computed; this screen — the one that FILES the month — did not.
import { fetchTrainerPay, withResolvedRates, type PayIndex } from '@lib/gymPay';
import { gymLink, noGymNote } from '@lib/gymLink';
// How many gyms this account owns. See `siteNotice` for why a month-end sheet
// in particular is a screen that has to say it.
import { fetchOwnedSites } from '@/lib/sites';
import { siteNotice, type SiteScope } from '@lib/ownedSites';
import { parseGymZone, gymDay } from '@lib/gymZone';
// The reader's own calendar day — the fallback where the gym has set no zone,
// and the SAME one `buildClose` falls back to, so the sheet cannot hold two.
import { isoDay } from '@lib/weekStart';
import { Fetched, useFetched } from '@/components/Fetched';
import { toCsv } from '@lib/gymExport';
import { saveText } from '@/lib/save';
import { Banner } from '@/components/Banner';
import { num1 } from '@/lib/num';

const EMPTY: CloseRecord = {
  payments: sliceLoading(),
  invoices: sliceLoading(),
  sessions: sliceLoading(),
  memberships: sliceLoading(),
  passes: sliceLoading(),
};

/** How far back the picker offers. Thirteen so last year's same month is there. */
const MONTHS_OFFERED = 13;

export default function Close() {
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
  // `tenants.currency`. A month-end close is the document an owner reconciles
  // against a bank statement, so the one thing it must not do is name a
  // currency nobody chose — see currencyOf() at the foot of this file.
  const [gymCcy, setGymCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  /**
   * Whether the gym row has come back, and how — THREE states, not two.
   *
   * This was `useState<'ok' | 'failed'>('ok')`, so between `loadMe` resolving
   * and the `tenants` read landing the screen held 'ok' with `policyCode` still
   * null, and read that pair as "the gym has stated no pay policy". The banner
   * below then made a claim about the gym over a record nobody had read yet —
   * on the one screen in this console whose whole job is to refuse, and whose
   * own header says that refusing over an unread record is the one refusal it
   * must not turn into a clean bill of health. It ran on every load, for a whole
   * round trip, on every gym on the platform including the ones that HAVE set a
   * policy.
   *
   * `gymRead` on /payroll is the same distinction already drawn in this console,
   * for the same reason: a gym that has set nothing and a gym whose row has not
   * arrived are not the same fact and may not print the same sentence.
   */
  const [feeRead, setFeeRead] = useState<'reading' | 'ok' | 'failed'>('reading');
  /**
   * What this gym pays EACH coach, from `gym_trainer_pay`.
   *
   * ── The layer this screen skipped ─────────────────────────────────────
   *
   * src/lib/gymPay.ts holds one three-layer rule — the rate snapshotted on the
   * session, then the coach's own agreed rate, then the gym's standard fee —
   * and its header says in writing why it is one function: three copies of that
   * fallback is how a screen came to say AED 1,500 owed while the button handed
   * over 900. /payroll, /sessions and /coach/earnings all call
   * `withResolvedRates` before they compute anything. This screen applied layer
   * one and layer three and skipped layer two entirely, so every session with
   * no snapshotted rate was priced at `tenants.session_fee` — the wrong figure
   * for every coach on a rate of their own, and the figure that gets SNAPSHOTTED
   * into `gym_month_closes.payroll_cents`, exported in the handoff CSV and read
   * back by every later drift line. /payroll and /close reported two different
   * payrolls for one month, and this was the one that was filed.
   *
   * Null means the read has not landed or did not come back — never an empty
   * map standing in for "this gym pays everybody the standard fee".
   */
  const [pay, setPay] = useState<PayIndex | null>(null);
  /** Why the per-coach rates could not be read. Null when they came back. */
  const [payErr, setPayErr] = useState<string | null>(null);

  // The record is stored WITH the month it was read for, and used only when the
  // two agree. Without that, switching from June to July renders one frame of
  // June's invoices under a July heading — and a close screen that shows the
  // wrong month's receivables, however briefly, is the exact failure this page
  // exists to prevent. A mismatch reads as "not loaded yet", which is true.
  const [loaded, setLoaded] = useState<{ key: string; rec: CloseRecord }>({ key: '', rec: EMPTY });

  /*
   * The costs side, kept OUT of `CloseRecord` on purpose.
   *
   * `CLOSE_PARTS` is the five reads the month's FIGURES are computed from, and
   * every one of them is a blocker when it fails: a taken figure over a failed
   * payments read is not a smaller figure, it is a wrong one. Costs are not
   * that. Nothing on this screen is computed from them and nothing ever may be
   * — src/lib/gymCosts.ts forbids netting under a heading in capitals — so a
   * costs read that fails must not stop a month being closed, and folding it
   * into the record would make it one.
   *
   * What it is instead is the thing an owner needs to KNOW before pressing a
   * button that locks `gym_costs` for this month (supabase/parts/700 attaches
   * part 182's trigger to it, keyed on `paid_on`). It states its own condition
   * in its own panel and nowhere else.
   *
   * Keyed on the month for the same reason `loaded` is: rendering July's
   * suppliers under an August heading, beside a button that files August, is
   * exactly the mistake this screen exists to prevent.
   */
  const [costs, setCosts] = useState<{ key: string; month: CostRead; past: CostRead }>(
    { key: '', month: COSTS_LOADING, past: COSTS_LOADING },
  );

  // Every close and reopen this gym has recorded. Not scoped to the month on
  // screen: the history is the half an auditor wants, and a month closed,
  // reopened and closed again is three rows that only make sense together.
  //
  // null is "not read", which is NOT the same as "this gym has never closed a
  // month" — the section below says which, because offering a Close button over
  // a failed read is how a month gets closed twice.
  const [closes, setCloses] = useState<MonthCloseRow[] | null>(null);
  const [closesErr, setClosesErr] = useState<string | null>(null);

  /*
   * How many gyms this account owns.
   *
   * `siteNotice` in src/lib/ownedSites.ts was written for "a screen full of
   * figures" and had one caller: the console's home page, which is mostly links.
   * This is the screen that most needs it. A month-end close is signed, filed
   * and handed to an accountant, and part 290 changed no policy — so an owner
   * recorded against two gyms gets ONE gym's month here, complete, correct and
   * silent about being half of the business.
   *
   * The failed-read arm is the one that earns its place rather than the
   * two-site arm: a multi-site owner and a single-site owner are
   * indistinguishable when `my_sites()` does not answer, and the difference is
   * what every figure below MEANS. It renders nothing at all for a settled read
   * of one gym, which is every account on the platform today.
   */
  const [sites, setSites] = useState<SiteScope>({ status: 'loading', sites: [] });

  // Default to the month that has actually finished. Opening on the running
  // month would greet an owner with a refusal about a month nobody claimed was
  // over, and train them to skip the refusals.
  //
  // Finished FOR THE GYM, which is not the same month as finished for the
  // laptop. This was `useState(() => recentMonths(2)[1])`, read once at mount on
  // the device's calendar: at 01:00 on 1 September in London, a Dubai gym has
  // been in September for four hours and this screen offered July to close —
  // the month before the one that had just ended, on the screen whose entire
  // purpose is closing the month that has just ended.
  //
  // Null means "the owner has not chosen", exactly as /costs holds it, so the
  // default follows the gym's own month as soon as the zone read lands rather
  // than being frozen at mount by a value the page could not yet know. Once the
  // owner picks a month it stays picked — this does not move under anybody who
  // has made a choice.
  const [picked, setPicked] = useState<string | null>(null);
  const setKey = setPicked;

  /**
   * Whether a no-show is payable is a gym policy, and this screen READS it.
   *
   * The comment here used to say that a close pricing no-shows differently from
   * the payroll screen "would be a second opinion about the same money", and
   * then held its own unsaved copy — so it was one. An owner ticked the box on
   * /sessions, walked here to settle the month, and this screen had reset. The
   * month was closed on a number the owner had already decided against, in the
   * one place in the console where the figure leaves the building.
   */
  const [policyCode, setPolicyCode] = useState<string | null>(null);

  /**
   * The month this sheet is about, and the month it OPENS on until somebody
   * chooses. Both on the gym's clock where the gym has given one.
   *
   * `gymRecentMonths(2, zone)[1]` is "the month that has just finished at the
   * gym"; with no zone recorded it is the reader's, and `.note` on the same
   * result is the sentence that says so, printed beside the picker below.
   */
  // Read in the render body rather than latched in a memo, which is the shape
  // /costs already uses for the same decision and for the same reason: the
  // answer is a short string, so re-deriving it costs nothing and it cannot go
  // stale in a tab left open across a month boundary. `useMemo` here would need
  // a clock in its dependency list to be correct, and a clock in a dependency
  // list is what `check:frozen-day` exists to keep out of one.
  const openOn = gymRecentMonths(2, zone, Date.now());
  const key = picked ?? openOn.keys[1] ?? monthKeyOf();

  /**
   * The window, cut on the gym's own clock, with the caption that says whose.
   *
   * `at.window.firstDay`/`lastDay` are untouched by the cut — a calendar day is
   * a calendar day in any zone, and the invoice, cost and pass reads below are
   * filtered on `date` columns with those. Only `fromIso`/`toIso` move, and
   * they are what the payments and sessions reads are bounded by.
   */
  const at = useMemo(() => monthAtGym(key, zone), [key, zone]);
  const w = at?.window ?? null;

  const load = useCallback(async (tenantId: string, mw: NonNullable<ReturnType<typeof monthWindow>>): Promise<boolean> => {
    // Five independent reads, deliberately not one Promise.all under a single
    // catch. An invoice table that 500s must not take the payments down with
    // it: the close is allowed to be partial, but only if it says which part
    // failed and refuses to be called closed over it.
    // The per-coach rates ride with the five, and are handled separately below
    // for the same reason /payroll handles them separately: they are not one of
    // `CLOSE_PARTS`, so a failure here does not make the month's takings
    // unknown — it makes the PAYROLL figure the gym's standard fee applied to
    // everybody, which is a wrong number rather than a missing one. It is a
    // blocker on the button, not a hole in the sheet.
    const payRead = fetchTrainerPay(supabase, tenantId).then(
      (m) => ({ ok: true as const, map: m }),
      (e: any) => ({ ok: false as const, why: e?.message ?? 'The per-coach pay rates could not be read.' }),
    );
    const [payments, invoices, sessions, memberships, passes] = await Promise.all([
      // Bounded at BOTH ends. This computed a start date and no end, so a close
      // opened on a month from a year ago read every payment from that month up
      // to today — an unbounded set that the month's figures then filter back
      // down. `fetchPayments` now pages rather than refusing past a thousand
      // rows, so that no longer breaks the screen; it would still drag a year
      // of payments across the wire to total one month of them, and nothing
      // outside the month is used here.
      slice(() => fetchPayments(supabase, tenantId, mw.fromIso, mw.toIso)),
      slice(() => fetchInvoices(tenantId, mw.lastDay)),
      slice(() => fetchSessions(supabase, tenantId, mw.fromIso, mw.toIso)),
      slice(() => fetchMemberships(supabase, tenantId)),
      slice(() => fetchPasses(supabase, tenantId)),
    ]);
    setLoaded({ key: mw.key, rec: { payments, invoices, sessions, memberships, passes } });
    const pr = await payRead;
    if (pr.ok) { setPay(pr.map); setPayErr(null); }
    else { setPay(null); setPayErr(pr.why); }

    /*
     * The month's costs, and the run of months before it.
     *
     * Two reads rather than one wide one. The look-back is six months of a
     * purchase ledger and the month is one; asking for both in a single range
     * and splitting it here would put the whole seven months under one row cap,
     * so a busy gym's August would be judged against whatever survived the
     * truncation of its February. Bounded at both ends on each side, which is
     * the shape `fetchGymCosts` refuses a truncated read for.
     */
    const back = monthsBefore(mw.key, COST_LOOKBACK_MONTHS);
    const prev = back.length ? monthWindow(back[0]) : null;
    const oldest = back.length ? monthWindow(back[back.length - 1]) : null;
    const [monthCosts, pastCosts] = await Promise.all([
      readCosts(tenantId, mw.firstDay, mw.lastDay),
      oldest && prev
        ? readCosts(tenantId, oldest.firstDay, prev.lastDay)
        : Promise.resolve<CostRead>({ state: 'ready', rows: [], reason: null }),
    ]);
    setCosts({ key: mw.key, month: monthCosts, past: pastCosts });
    try {
      setCloses(await fetchCloses(supabase, tenantId));
      setClosesErr(null);
    } catch (e: any) {
      // Kept apart from the five reads above because it is not part of the
      // close: it is the record OF closes. A failure here leaves the figures
      // perfectly readable and only the Close button unusable, which is the
      // right trade — a Close pressed over a read that could not say whether
      // the month was already closed is the one mistake this table exists to
      // prevent.
      setCloses(null);
      setClosesErr(e?.message ?? 'The record of closed months could not be read.');
      return false;
    }
    // Whole only when all five reads, the per-coach rates AND the record of
    // closes came back. The rates are in the test because the payroll figure on
    // this sheet is made of them: a stamp saying "read just now" over a payroll
    // priced at the standard fee for a gym that pays three coaches their own
    // rates is a fresh timestamp on a wrong number.
    return payments.state === 'ready' && invoices.state === 'ready'
      && sessions.state === 'ready' && memberships.state === 'ready'
      && passes.state === 'ready' && pr.ok;
  }, []);

  /*
   * The close, kept current.
   *
   * Month-end is the one job in a gym two people genuinely do at once: the
   * owner on this screen, the bookkeeper on /accounting and /costs recording
   * the last of the month's invoices. This screen read once, at page open, and
   * then printed "Every figure reads today exactly as it read at the close" —
   * a comparison between a snapshot stored in the database and a read taken in
   * this browser minutes or hours ago. Taking a close from a stale read files a
   * month that was already different when the button was pressed, and the drift
   * line then reports no drift.
   *
   * Two minutes, plus every return to the tab.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId && w ? load(me.tenantId, w) : Promise.resolve(false)),
    { everyMs: 2 * 60_000 },
  );

  /**
   * The instant every judgement on this sheet is made against.
   *
   * `readAt` and not `Date.now()`, and the difference is the whole point. This
   * console has no router — the rail is a plain `<a href>` — so a month-close
   * tab left open on a desk is one document that lives for days. A `Date.now()`
   * read inside the memo below is pinned to the render that first produced it:
   * the memo's dependencies are the rows and the month, and neither of them
   * moves when midnight does. So "today" stayed at the day the tab was opened,
   * and `owed.overdue`, `overdueCents` and both of the same on `arrears` went on
   * being counted against a day that had already passed — on the one screen an
   * owner signs a month off from.
   *
   * The read instant is the honest one to judge against as well as the live one:
   * the figures on this page are of that read, and `useFetched` moves it every
   * two minutes, on every return to the tab, and whenever somebody presses
   * "Read again". `?? Date.now()` covers the render before the first read has
   * landed, where there are no rows to judge yet anyway.
   */
  const nowMs = readAt ?? Date.now();

  /**
   * The months this sheet offers — built once a MONTH, not once a mount.
   *
   * This was `useMemo(() => recentMonths(MONTHS_OFFERED + 1), [])` and neither
   * clock gate could see it: `check-frozen-day` looks for a clock read on the
   * line, and the clock is `recentMonths`'s own `now = Date.now()` default one
   * file away; `check-frozen-hook` follows exactly those defaults but skips
   * empty dependency lists, which are the other gate's rule.
   *
   * The console has no router, so a close tab is a document that lives for days.
   * Keyed on `[]`, the newest month this picker offered was the month the tab
   * was OPENED in — so an owner who left it open over the 1st could not select
   * the month that had just ended, on the screen whose entire purpose is to
   * close the month that has just ended. The initial selection above is
   * deliberately still a one-time read: which month the sheet OPENS on is a
   * decision made once, and moving it under somebody would be a different bug.
   */
  //
  // And the months offered are the GYM's, not the device's. `monthTickStart`
  // reduces the reader's clock to an instant inside the reader's current month,
  // and `gymRecentMonths` then asks which month the GYM was in at that instant
  // — so a gym behind the reader correctly does not gain a month the reader has
  // entered and it has not. The residual is the reverse case: a gym AHEAD of
  // the reader turns its month over first, and the list gains that month when
  // the reader's clock catches up rather than when the gym's does. That is the
  // lag this tick has always had; what changes here is that the list is now
  // named on the gym's calendar rather than on the laptop's.
  const tick = useMonthTick();
  const months = useMemo(
    () => gymRecentMonths(MONTHS_OFFERED + 1, zone, monthTickStart(tick).getTime()).keys,
    [tick, zone],
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
      // `sliceReady([])` is the gym saying it has none. An account with no gym
      // on it was written as five of them, so this screen closed a month over a
      // record it never read: no payments, no invoices, no sessions, nothing
      // blocking, and a verdict at the top of the page saying so. The render
      // below stops before any of that.
      const link = gymLink(who?.tenantId, 'payments, invoices or one-to-ones');
      if (!link.linked) return;
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name, session_fee, currency, session_pay_policy, timezone').eq('id', link.tenantId).single();
      if (!live) return;
      // Checked, not assumed. A null session fee from a failed read would price
      // every unrated session at nothing and quietly shrink payroll; the two
      // are told apart so the screen can say "the fee could not be read".
      setGymName(tErr ? null : t?.name ?? null);
      setGymNameUnread(!!tErr);
      setGymCcy(tErr ? null : (((t?.currency ?? '') as string).trim().toUpperCase() || null));
      // The gym's own wall clock, for the one date this screen computes rather
      // than reads: what counts as overdue TODAY. See `Owed` below.
      const z = tErr ? { kind: 'clear' as const } : parseGymZone((t as any)?.timezone);
      setZone(z.kind === 'zone' ? z.zone : null);
      setSessionFee(tErr ? null : t?.session_fee ?? null);
      setPolicyCode(tErr ? null : (((t as any)?.session_pay_policy ?? null) as string | null));
      setFeeRead(tErr ? 'failed' : 'ok');
      // Not awaited with the tenant read: whether this account owns a second
      // gym has no bearing on any figure below, so a slow or refused RPC must
      // not hold up the month.
      void fetchOwnedSites().then((s) => { if (live) setSites(s); });
      // Through `refresh`, so the first read stamps the same way every later
      // one does.
      if (w) refresh();
    })();
    return () => { live = false; };
  }, [load, w, key, refresh]);

  // Only the record that was actually read for the month on screen. Anything
  // else is EMPTY, which renders as "still reading" rather than as another
  // month's figures.
  const rec = loaded.key === key ? loaded.rec : EMPTY;
  const costsThisMonth = costs.key === key ? costs.month : COSTS_LOADING;
  const costsBefore = costs.key === key ? costs.past : COSTS_LOADING;

  // The gym's currency as the record itself states it. Declared before the
  // close, not after: the formatter below closes over it, and a `const` read
  // before its own initialiser is a ReferenceError, not a fallback.
  const currency = useMemo(() => currencyOf(rec, gymCcy), [rec, gymCcy]);

  // The gym's stated policy, and the floor where it has not stated one. A close
  // built on delivered sessions alone cannot pay somebody more than they earned;
  // it can pay them less, which is why the screen says so rather than implying
  // the gym chose it.
  const stated = payPolicyOf(policyCode);
  const policy: PayPolicy = stated ?? PAY_DELIVERED_ONLY;

  /**
   * The gym's standard session fee in minor units, or null when it cannot be
   * stated in them.
   *
   * It was `Math.round(sessionFee * 100)`. A ¥6,000 fee became 600,000 minor
   * units and every session the register never marked was priced at ¥600,000 on
   * the sheet handed to an accountant; a Kuwaiti gym's came out at a tenth of
   * the truth. `minorFromWhole` asks the currency how many places it has.
   *
   * `gymCcy` and NOT `currency`. `currency` is what the month's rows happened to
   * agree on; the fee is `tenants.session_fee` and the only currency it is ever
   * denominated in is `tenants.currency`. Pricing a stored fee by the scale of
   * whatever the card machine took that month is the same bug wearing a hat.
   *
   * Null when the gym has no currency, and that is not zero: an unpriced session
   * stays unpriced, exactly as it does when no fee is set at all.
   */
  const feeCents = useMemo(() => minorFromWhole(sessionFee, gymCcy), [sessionFee, gymCcy]);

  /**
   * Which of this gym's regular suppliers are not in the month yet.
   *
   * `w.label` and not the raw key: the sentence is read by a person and the
   * month is named in their own language, exactly as the picker above names it.
   * Null when the key is not a month, so the panel renders nothing rather than
   * a claim about a month that does not exist.
   */
  const costCheck = useMemo<CostVerdict | null>(() => {
    if (!w) return null;
    return costVerdict({
      monthKey: w.key,
      monthLabel: w.label,
      monthState: costsThisMonth.state,
      pastState: costsBefore.state,
      monthRows: costsThisMonth.rows,
      pastRows: costsBefore.rows,
    });
  }, [w, costsThisMonth, costsBefore]);

  /**
   * The month's sessions with the effective rate written onto each one.
   *
   * Resolved ONCE, up front, exactly as /payroll and /sessions do it — see the
   * note on `pay` above and the header of `withResolvedRates`. `buildClose` is
   * then handed rows that already carry their rate, and its `fallbackRateCents`
   * is `null`: applying the gym fee a second time inside `payrollByTrainer` is
   * how the three functions came to disagree the first time.
   *
   * `pay ?? new Map()` and not a bail-out: a failed rates read leaves every
   * session on the gym's fee, which is what this screen has always done, and
   * `payErr` turns that into a refusal to CLOSE rather than a blank sheet.
   */
  const pricedSessions = useMemo<Slice<PtSession>>(() => {
    const s = rec.sessions;
    if (s.state !== 'ready') return s;
    return sliceReady(withResolvedRates(s.rows, pay ?? new Map(), feeCents, gymCcy));
  }, [rec.sessions, pay, feeCents, gymCcy]);

  const pricedRec = useMemo<CloseRecord>(
    () => ({ ...rec, sessions: pricedSessions }),
    [rec, pricedSessions],
  );

  const close: MonthClose | null = useMemo(() => {
    if (!w) return null;
    return buildClose(pricedRec, w, {
      policy,
      // `null`, because `pricedSessions` has already applied all three layers.
      fallbackRateCents: null,
      // The GYM's day, which this call was not passing at all.
      //
      // `CloseOptions.today` in src/lib/monthEnd.ts exists for this one caller
      // and says so: "The day to judge an invoice overdue against… the GYM's
      // own, `gymDay(Date.now(), zone)`. It was not injectable at all until now,
      // and what it did instead was take UTC's calendar day… An invoice due on
      // the 31st was counted overdue from 5pm on the 31st in Los Angeles, on the
      // one screen an owner uses to sign off a month."
      //
      // The parameter landed and this call site never took it, so `buildClose`
      // fell through to `isoDay(new Date(now))` — the READER's day. That decides
      // `owed.overdue`, `owed.overdueCents` and the same two on `arrears`, which
      // are the arrears figures on the sheet and the blocker sentences under
      // them. Meanwhile `Owed` seven hundred lines below computes the gym's day
      // for itself and colours its Status column red on that — so one screen
      // counted overdue on two different calendars, and the row and the total
      // above it disagreed for the hours between the two midnights.
      //
      // `?? undefined` rather than `?? isoDay(...)`: with no zone, letting
      // `buildClose` fall back is byte-identical to what a zone-less gym gets
      // today, and the fallback is argued in one place rather than two.
      //
      // `nowMs` and not `Date.now()`: this memo re-runs on its dependencies,
      // none of which is a clock, so a literal read here froze the gym's day at
      // the render that first built the sheet. `now` goes with it — it is what
      // `monthEnded` and the blockers are judged on, so a month that ended while
      // the tab sat open would otherwise still be reported as still running.
      today: gymDay(nowMs, zone) ?? undefined,
      now: nowMs,
      fmt: (c) => money(c, currency) ?? '—',
    });
  }, [pricedRec, w, policy, currency, zone, nowMs]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/close">
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
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/close">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          A month-end close carries every payment and every payroll figure the
          gym holds, so it is owner-only.
        </p>
      </Shell>
    );
  }

  // Before any verdict. A close is the one screen in this console whose whole
  // job is to refuse, and refusing over an unread record is the one refusal it
  // must not turn into a clean bill of health.
  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/close">
        <h1>Month-End Close</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('payments, invoices or one-to-ones')}
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/close">
      <h1>Month-End Close</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What came in, what it was for, what is still owed, what does not
        reconcile, and what is still unmarked and therefore blocking payroll.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
        {/* Named — see the same control on /accounting. */}
        <select aria-label="Which month" value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, minWidth: 190 }}>
          {months.map((m) => {
            const mw = monthWindow(m);
            return <option key={m} value={m}>{mw ? mw.label : m}</option>;
          })}
        </select>
        {/* Read, not offered. Two checkboxes stood beside this month picker and
            saved nothing, so the close could be settled on a policy the owner
            had set somewhere else and this screen had forgotten. */}
        <span style={{ color: 'var(--ink2)', fontSize: 12.5 }}>
          {feeRead === 'reading' ? (
            <>Reading what this gym pays for…</>
          ) : feeRead === 'failed' ? (
            <>Pay policy unknown — the gym record could not be read; delivered sessions only.</>
          ) : stated ? (
            <>Pays for {PAY_POLICY_LABEL[policyCode as PayPolicyCode].toLowerCase()} ·{' '}
            <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a></>
          ) : (
            <>Pay policy not set — delivered sessions only ·{' '}
            <a href="/settings" style={{ color: 'var(--brand)' }}>set it on Gym</a></>
          )}
        </span>
      </div>

      {/* Whose clock this month was cut on.
          The caption travels with the bounds out of `monthAtGym`, so this
          screen cannot print the confident wording over the device's clock
          without going out of its way to — which is the half of the defect that
          made it dangerous rather than merely wrong. `tenants.timezone` is
          unset on every gym on the platform today, so this is the sentence
          every owner sees, and it is the truth about the figures below. */}
      {at ? (
        <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '8px 0 0', maxWidth: '78ch' }}>
          {at.note}
        </p>
      ) : null}

      {/* A month is closed here and the figure goes to an accountant, so the
          floor is said in a banner rather than only in a caption beside a
          dropdown. */}
      {/* `=== 'ok'`, never `!== 'failed'`. The second admits 'reading', which is
          how this banner came to assert that a gym had stored no pay policy
          before anything had asked it. */}
      {feeRead === 'ok' && !stated ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>No pay policy is stored for this gym</strong> —{' '}
          {NO_PAY_POLICY_NOTE}. Everything below pays delivered sessions only, which is the least
          this gym owes rather than a figure it has agreed to. A coach who held an hour for somebody
          who did not turn up is not in the total.
        </Banner>
      ) : null}

      {/* When these figures were read. The Verdict block below states that
          "every figure reads today exactly as it read at the close" — a
          comparison between a stored snapshot and THIS read, so the age of this
          read is part of the claim. */}
      <Fetched at={readAt} busy={reading} onRefresh={refresh} what="this month" />

      {/* Above the figures, because it is about what all of them cover. Null,
          and therefore nothing rendered, for a settled read of one gym. */}
      {siteNotice(sites) ? <Banner tone="warn">{siteNotice(sites)}</Banner> : null}

      {!w || !close ? (
        <Banner tone="crit">{key} is not a month this console can open.</Banner>
      ) : (
        <CloseView
          c={close} rec={rec} currency={currency} gymCcy={gymCcy} zone={zone} feeRead={feeRead} payErr={payErr} sessionFee={sessionFee} feeCents={feeCents}
          nowMs={nowMs}
          gymName={gymName} monthKey={key} tenantId={me.tenantId!} me={me}
          closes={closes} closesErr={closesErr}
          costs={costCheck} costsReason={costsThisMonth.reason ?? costsBefore.reason}
          onChange={refresh}
        />
      )}
    </Shell>
  );
}

/* ── the close itself ──────────────────────────────────────────────────────── */

function CloseView({ c, rec, currency, gymCcy, zone, nowMs, feeRead, payErr, sessionFee, feeCents, gymName, monthKey, tenantId, me, closes, closesErr, costs, costsReason, onChange }: {
  c: MonthClose;
  rec: CloseRecord;
  /** The instant this sheet's figures were read, and therefore the one every
   *  "is this late / is this still unmarked" question below is asked at. One
   *  instant for the whole sheet: the sections used to each read their own
   *  clock, which is how a total and the rows under it came to disagree. */
  nowMs: number;
  /** Which of this gym's regular suppliers are not in the month yet, and how
   *  the two reads behind that judgement came back. Never a figure: nothing
   *  here is subtracted from anything on this screen. */
  costs: CostVerdict | null;
  /** The database's own words where a costs read did not come back whole. */
  costsReason: string | null;
  /** `tenants.timezone` — the only correct basis for what "today" means to
   *  this gym. Null when the gym has not set one. */
  zone: string | null;
  /** What the PAYMENTS agree on. Only figures the payments produced may wear
   *  it — see `currencyOf`. */
  currency: TenantCurrency;
  /** `tenants.currency`. What the gym's own standing figures are denominated
   *  in: the session fee, and therefore payroll. */
  gymCcy: TenantCurrency;
  feeRead: 'reading' | 'ok' | 'failed';
  /** Why the per-coach pay rates could not be read, or null. A close taken over
   *  this prices every coach at the gym's standard fee and files it. */
  payErr: string | null;
  sessionFee: number | null;
  /** The same fee in MINOR units, or null when it cannot be stated in them.
   *  Two values rather than one because the sentences differ: a gym with no fee
   *  set and a gym whose currency would not read are told different things. */
  feeCents: number | null;
  gymName: string | null;
  monthKey: string;
  tenantId: string;
  me: Me;
  closes: MonthCloseRow[] | null;
  closesErr: string | null;
  onChange: () => void;
}) {
  const m = (cents: number | null | undefined) => money(cents, currency);

  /*
   * What the INVOICES agree on — asked TWICE, because they are two sets.
   *
   * This was one answer, `agreedCurrency(rec.invoices.rows)`, over the rows as
   * they arrived. `fetchInvoices` takes no month: it reads every invoice this
   * gym has issued up to the end of the month, because arrears reach back and
   * an invoice raised in June and still open in August is money owed at the
   * August close. `buildClose` then filters that set in two — `c.owed` is the
   * invoices ISSUED IN THIS MONTH, `c.arrears` is everything still open up to
   * its end — and sums each separately.
   *
   * So the single answer priced the month's billing off the gym's whole
   * history. One EUR invoice raised in 2024 makes `agreedCurrency` null
   * forever, and August's tile then shows a real, single-currency GBP total
   * with no code beside it — and `snapshotOf` writes that null into
   * `gym_month_closes.invoiced_currency`, permanently, where every later drift
   * line reads back through it and the handoff CSV exports it. The comment in
   * gymClose.ts says what an accountant does with an unlabelled figure: prices
   * it with the gym's code, which is the substitution supabase/parts/2540 was
   * written to stop.
   *
   * The passes side twelve lines down had this defect and states the rule that
   * fixes it: read the currency back off the summary that produced the sum,
   * rather than deriving it again from a wider set. That is what these do.
   */
  const invoicedCcy = agreedIn(c.owed);
  const arrearsCcy = agreedIn(c.arrears);
  // The passes side does NOT recompute, and that is the fix rather than the
  // shortcut. `agreedCurrency(rec.passes.rows)` asked the wrong set twice over:
  // `fetchPasses` takes no window, so it ran over every pass this gym has ever
  // issued — September's first EUR walk-in withheld August's GBP pass total on
  // the August close, a month whose own passes are all in one money — and it ran
  // over UNPRICED rows, so a pass with no price and a currency of its own
  // withheld a figure it contributes nothing to, having contributed nothing to
  // it.
  //
  // `buildClose` already filtered the passes to the month, and
  // `passRevenueCents` already agreed the currency across the PRICED rows only,
  // normalised — the `summarise`/`contributing` rule gymRecord.ts states, one
  // level down. Reading its answer is what keeps the currency and the sum
  // derived from the same rows; deriving it again from a wider set is how they
  // came to disagree.
  const passesCcy = c.passes?.currency ?? null;

  return (
    <>
      <Verdict c={c} />
      {/* Before the button, not after it. This is the only thing on the page an
          owner cannot get back to once they press Close. */}
      <CostsBeforeClose v={costs} reason={costsReason} monthKey={monthKey} />
      <Signoff
        c={c} currency={currency} invoicedCcy={invoicedCcy} arrearsCcy={arrearsCcy} monthKey={monthKey} zone={zone} tenantId={tenantId} me={me}
        closes={closes} closesErr={closesErr} costs={costs} payErr={payErr} onChange={onChange}
      />
      <Handoff c={c} rec={rec} currency={currency} arrearsCcy={arrearsCcy} gymName={gymName} monthKey={monthKey} />

      {c.warning ? <Banner tone="crit">{c.warning}</Banner> : null}
      {feeRead === 'failed' ? (
        <Banner tone="crit">
          The gym&rsquo;s session fee could not be read, so any session without its
          own snapshotted rate is left unpriced rather than valued at nothing.
        </Banner>
      ) : null}
      {/* The layer between the two. A session with no snapshotted rate is
          priced at the coach's OWN agreed rate before it falls back to the
          gym's fee, and when that read fails every coach silently drops to the
          standard fee — which is the wrong figure for anybody on a rate of
          their own, and this is the screen that files it permanently. */}
      {payErr ? (
        <Banner tone="crit">
          {payErr} Until it does, every session without its own snapshotted rate is
          priced at the gym&rsquo;s standard fee, which is the wrong figure for any coach
          on a rate of their own &mdash; so the payroll figure below is not safe to file
          and the Close button is held.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Taken"
          text={c.income ? m(c.income.takenCents) : null}
          note={
            !c.income ? stateNote(rec.payments, 'payments')
              : c.income.currencies.length > 1 ? 'more than one currency — not summed'
              : c.income.count === 0 ? 'nothing recorded this month'
              : `${c.income.count} payment${c.income.count === 1 ? '' : 's'}`
          }
        />
        {/* ── the three tiles that wore the payments' currency ─────────────
            `m()` is `money(cents, currency)` and `currency` is what the month's
            PAYMENTS agree on — its own prop doc, twenty lines up, says "only
            figures the payments produced may wear it". These three are not
            figures the payments produced. Billed and Still owed come off
            `gym_invoices`; Payroll comes off `sessions.rate_cents` and
            `tenants.session_fee`.

            So a gym whose August card takings happened to be all AED printed
            its GBP invoices and its GBP payroll as dirhams — three inches above
            the Owed and Payroll sections below, which the very next comment
            block says were repaired for exactly this and which render the same
            numbers correctly. One screen, one month, two answers, and the wrong
            one is the one at the top in bold. */}
        <Kpi
          label="Billed this month"
          text={c.owed ? money(sumOrNull(c.owed.settledCents, c.owed.outstandingCents), invoicedCcy) : null}
          note={
            !c.owed ? stateNote(rec.invoices, 'invoices')
              : c.owed.issued === 0 ? 'no invoice issued'
              // A dash for want of a currency needs its own sentence, or the
              // invoice count reads as an explanation of a missing figure.
              : !invoicedCcy ? `${c.owed.issued} invoice${c.owed.issued === 1 ? '' : 's'}, and they do not all state the same currency — so there is no one total`
              : `${c.owed.issued} invoice${c.owed.issued === 1 ? '' : 's'}${c.owed.dropped ? `, ${c.owed.dropped} void or written off` : ''}`
          }
        />
        <Kpi
          label="Still owed"
          text={c.arrears ? money(c.arrears.outstandingCents, arrearsCcy) : null}
          note={
            !c.arrears ? stateNote(rec.invoices, 'invoices')
              : c.arrears.outstanding === 0 ? 'nothing outstanding'
              : !arrearsCcy ? `${c.arrears.outstanding} open, and they do not all state the same currency — so there is no one total`
              : `${c.arrears.outstanding} open, ${c.arrears.overdue} past due`
          }
        />
        {/* ── the payroll figure, in the money the WORK was priced in ──────
            This tile read `money(c.payroll.total.cents, gymCcy)`. The figure is
            a sum over `sessions.rate_cents`, which have carried their own
            `rate_currency` since supabase/parts/1010, and `gymCcy` is
            `tenants.currency` — the code the gym charges in TODAY. A gym that
            changed it had its whole PT history relabelled by this tile in one
            write, and a month that straddled the change was ADDED ACROSS two
            currencies and presented as one total.

            `c.payroll.currency` is `runLabel` from src/lib/gymRateCurrency.ts,
            asked of the very sessions the sum is made of — the same call
            /sessions, /payroll and /coach/earnings make before printing a
            total. It is null when no single label is honest, `money()` withholds
            the figure for a null currency, and `currencyNote` is the sentence
            that says which of the two silences this is. */}
        <Kpi
          label="Payroll"
          text={c.payroll ? money(c.payroll.total.cents, c.payroll.currency) : null}
          note={
            !c.payroll ? stateNote(rec.sessions, 'one-to-ones')
              : c.payroll.total.unmarked > 0
                ? `NOT final — ${c.payroll.total.unmarked} unmarked`
                : c.payroll.total.payable === 0 ? 'no payable sessions'
                : c.payroll.currencyNote
                  ? `${c.payroll.total.delivered} delivered. ${c.payroll.currencyNote}`
                  : !gymCcy ? `${c.payroll.total.delivered} delivered, and ${NO_CURRENCY_NOTE}`
                  : `${c.payroll.total.delivered} delivered`
          }
        />
        <Kpi
          label="Unmarked sessions"
          text={c.payroll ? String(c.payroll.total.unmarked) : null}
          note={!c.payroll ? stateNote(rec.sessions, 'one-to-ones') : 'finished, outcome never recorded'}
        />
      </div>

      {/* ── one figure, one currency, and it is the one that produced it ──
          Every section below used to be handed `currency`, which `currencyOf`
          derives from the PAYMENTS rows. So a gym whose August card takings all
          happened to be in AED printed its GBP payroll, its GBP rates and its
          GBP arrears as dirhams — on the sheet that goes to an accountant,
          three inches above an invoice table rendering each row honestly with
          `money(i.amountCents, i.currency)`.

          Income keeps it, because Income IS the payments. Owed and Passes take
          what their own rows agree on, and null where they agree on nothing —
          which each of those sections already has a sentence for.

          Payroll takes no currency prop at all any more. It was handed the
          gym's own, on the argument that the figure "comes from
          `sessions.rate_cents` and `tenants.session_fee` and from nothing
          else". The first half of that is what breaks it: a snapshotted rate
          has carried its own `rate_currency` since supabase/parts/1010, so
          `tenants.currency` is the gym's code TODAY laid over rates recorded
          whenever they were recorded. Every figure inside that section is now
          priced by the rows that produced it — the total by
          `c.payroll.currency`, each trainer's pay by its own line, each rate
          held by its own session. */}
      <Income c={c} rec={rec} currency={currency} />
      {/* Arrears, not the month's billing — every figure inside is `c.arrears`. */}
      <Owed c={c} rec={rec} currency={arrearsCcy} zone={zone} nowMs={nowMs} />
      <Reconciliation c={c} rec={rec} />
      <Payroll c={c} rec={rec} zone={zone} nowMs={nowMs} sessionFee={sessionFee} feeCents={feeCents} />
      <Passes c={c} rec={rec} currency={passesCcy} />
    </>
  );
}

/**
 * The verdict, and the reasons — in that order, before a single figure.
 *
 * A blocked month gets no tick, no amber, no "mostly closed". It gets the list
 * of what is in the way, each line an action.
 */
function Verdict({ c }: { c: MonthClose }) {
  const blocked = c.state === 'blocked';
  return (
    <section
      style={{
        border: '1px solid var(--ring)',
        borderLeft: `3px solid ${blocked ? 'var(--crit)' : 'var(--brand)'}`,
        borderRadius: 0, background: 'var(--surface)', padding: '14px 16px', marginTop: 18,
      }}
    >
      <div className="micro">{blocked ? 'Not closed' : 'Can be closed'}</div>
      <p style={{ margin: '7px 0 0', fontSize: 14.5, color: 'var(--ink)' }}>
        {closeHeadline(c)}
      </p>
      {blocked ? (
        <ol style={{ margin: '12px 0 0', paddingLeft: 20, color: 'var(--ink2)', fontSize: 13.5 }}>
          {c.blockers.map((b: Blocker, i: number) => (
            <li key={`${b.kind}-${i}`} style={{ marginBottom: 6 }}>{b.text}</li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/* ── closing it, and keeping it closed ─────────────────────────────────────── */

/**
 * The button this screen has never had.
 *
 * /close had no `closed_at`, no lock, no sign-off and no write of any kind:
 * `buildClose` recomputed the verdict from live rows on every load. So a month
 * closed on Monday was open again on Tuesday if anybody recorded a late
 * payment, /accounting re-reported it with different numbers, and the figure
 * the owner handed their accountant last week was unrecoverable — not disputed,
 * gone, because it was never a stored thing.
 *
 * Three things happen when this is pressed, and only the first is obvious:
 *
 *   1. A row records that this month was closed, by whom, and WITH THE FIGURES
 *      AS THEY STOOD. Snapshotted, exactly as `payroll_settlements` snapshots
 *      what was handed over rather than recomputing it from today's fee.
 *   2. The database stops accepting payments and invoices dated inside it —
 *      supabase/parts/182. A stored close that any later write can invalidate
 *      is a note, not a close.
 *   3. If the month is closed anyway over blockers, the blockers are stored
 *      verbatim, so a close made over a known problem reads as exactly that.
 *
 * Reopening is deliberate, needs a reason, and leaves the original close
 * standing. A month that closed and then moved is two facts and an auditor
 * wants both.
 */
function Signoff({ c, currency, invoicedCcy, arrearsCcy, monthKey, zone, tenantId, me, closes, closesErr, costs, payErr, onChange }: {
  c: MonthClose; currency: TenantCurrency; monthKey: string;
  /**
   * What the INVOICES agree on, or null when they do not agree.
   *
   * Passed down rather than recomputed here so that the row this button writes
   * carries the same codes the tiles above it rendered. `currency` beside it is
   * the PAYMENTS' code and speaks for the takings alone; the payroll's own
   * comes off `c.payroll`, which derived it from the sessions the figure is a
   * sum of. Four figures, four currencies — supabase/parts/2540.
   */
  invoicedCcy: TenantCurrency;
  /** And what everything STILL OPEN agrees on — the code beside
   *  `outstandingCents`. A different set of invoices to the one above, so a
   *  different answer, and the two are stored in two columns. */
  arrearsCcy: TenantCurrency;
  /** The costs verdict, for the confirmation and for what gets stored. */
  costs: CostVerdict | null;
  /** `tenants.timezone`. A close is stamped at an instant and read as a date;
   *  which date it is is a fact about the gym, not about the reader. */
  zone: string | null;
  tenantId: string; me: Me;
  /** Why the per-coach pay rates could not be read, or null when they came
   *  back. A close taken over this files a payroll figure priced at the gym's
   *  standard fee for coaches who are not on it. */
  payErr: string | null;
  closes: MonthCloseRow[] | null; closesErr: string | null; onChange: () => void;
}) {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /*
   * The close is confirmed, and the reopen beside it already was.
   *
   * `<button onClick={doClose}>` fired `closeMonth` on one click, with one
   * optional note field and nothing between the press and a permanent row —
   * while the Reopen beside it demanded a typed sentence, and /costs confirms
   * before removing one £40 line.
   *
   * Closing a month writes the snapshot every later drift comparison is
   * measured against, and supabase/parts/182 then refuses payment and cost
   * writes dated inside it. So the click that needed no confirmation was the
   * one that locks a month for the whole gym, and the one that needed a typed
   * sentence was the one that unlocks it.
   *
   * A step rather than a typed reason: a close is the ordinary, correct
   * month-end action and making somebody write a sentence to do their job is
   * how a confirmation becomes a thing people click through. What it must not
   * be is one press.
   */
  const [confirming, setConfirming] = useState(false);

  const live = closes ? liveCloseFor(monthKey, closes) : null;
  const history = (closes ?? []).filter((r) => r.monthKey === monthKey);
  /*
   * The snapshot, with the costs line folded into what gets stored.
   *
   * `blockers_at_close` is supabase/parts/182's answer to "a close over a
   * stated problem is a decision somebody made and it has to be readable as
   * one". A rent that was never entered is exactly that: the month is filed,
   * the ledger is locked against it, and in March nobody can tell whether that
   * was deliberate. `costNoteForClose` returns null for every verdict that is
   * not a live claim, so a failed read, a gym with no history and a month with
   * nothing missing all store precisely what they stored before.
   */
  /*
   * One code per figure, and each one is the code the tile above it was priced
   * with.
   *
   * This was `snapshotOf(c, currency)` — a single code, `currencyOf(rec,
   * gymCcy)`, which is payments-first — written into `gym_month_closes` beside
   * FOUR figures. Only the takings were in it. The invoices carry their own
   * currency per row, and the payroll comes off snapshotted session rates; the
   * KPI row three inches up this screen already prices all three of those
   * correctly, and the row it filed did not. It is permanent, every later drift
   * line reads back through it, and the handoff CSV exports it.
   */
  const base = snapshotOf(c, { taken: currency, invoiced: invoicedCcy, outstanding: arrearsCcy });
  const costNote = costs ? costNoteForClose(costs) : null;
  const snap = { ...base, blockersAtClose: joinCloseBlockers(base.blockersAtClose, costNote) };
  // Over AT THE GYM. This was `monthEnded(c.window)`, which compares the
  // reader's clock against `c.window.toIso` — and `toIso` was built by
  // `new Date(y, mo, 1)` on the reader's own machine, so the two sides agreed
  // with each other and with nobody else. A bookkeeper in London was told a
  // Dubai gym's August was over four hours before it was, and this is the
  // boolean the Close button is gated on: those four hours of takings are then
  // outside a snapshot that says it holds the whole month.
  //
  // Keys, not instants. 'YYYY-MM' sorts chronologically and neither side of the
  // comparison has an instant in it left to put on the wrong clock. With no
  // zone recorded it is the reader's month against the key — what the screen
  // was already doing — and the caption above the picker says so.
  const ended = gymMonthEnded(monthKey, zone);
  const blocker = closes === null
    ? 'The record of closed months could not be read, so this console cannot tell whether this month is already closed. Closing it again would be refused by the database with an error nobody could act on.'
    // The per-coach rates. Same refusal /payroll makes before a settlement run,
    // and for a stronger reason: this button writes a PERMANENT snapshot of the
    // payroll figure into `gym_month_closes`, and a close taken while the rates
    // are unread prices every coach at the gym's standard fee — silently smaller
    // for anybody on a rate of their own, and the number every later drift line
    // is read back against.
    : payErr
    ? `${payErr} Until it does, the payroll figure on this sheet is the gym's standard fee applied to everybody, which is the wrong figure for anyone on their own rate — and closing would file it.`
    : closeBlocker(monthKey, ended, live);

  /*
   * Each side of each comparison in the money THAT side was recorded in.
   *
   * The formatter closed over `live.currency ?? currency` — one code for all
   * eight amounts, which is the same assumption that produced the single-code
   * row this reads back. `driftSince` now hands the currency in with the
   * figure: the stored side's own column, and the live side's from the snapshot
   * just built above.
   */
  const drift = live
    ? driftSince(live, snap, (cents, ccy) => money(cents, ccy) ?? 'an unstateable amount')
    : [];

  const doClose = async () => {
    setBusy(true); setErr(null);
    try {
      await closeMonth(supabase, tenantId, monthKey, snap, me.id, note.trim() || null);
      setNote(''); setConfirming(false);
      onChange();
    } catch (e: any) {
      // "Nothing has changed and the month is still open" is true of a refusal
      // and is a claim this console cannot make about a request nobody answered
      // — and a month closed twice is a second snapshot of the same takings.
      setErr(writeFailedText(e, {
        what: `Closing ${monthKey}`,
        unchanged: 'nothing has changed and the month is still open',
        howToCheck: `Reload this page and read whether ${monthKey} shows as closed before closing it again.`,
      }));
    } finally { setBusy(false); }
  };

  const doReopen = async () => {
    if (!live) return;
    const why = reopenBlocker(reason);
    if (why) { setErr(why); return; }
    setBusy(true); setErr(null);
    try {
      await reopenMonth(supabase, live.id, reason, me.id);
      setReason('');
      onChange();
    } catch (e: any) {
      setErr(writeFailedText(e, {
        what: `Reopening ${monthKey}`,
        unchanged: 'it is still closed, and the desk still cannot record a payment dated inside it',
        howToCheck: `Reload this page and read whether ${monthKey} shows as open before reopening it again.`,
      }));
    } finally { setBusy(false); }
  };

  return (
    <Section
      title={live ? `${monthKey} is closed` : `Close ${monthKey}`}
      sub={live
        ? 'The figures below are what the record says today. The ones stored at the close are beside them, and any difference is named — that is the whole reason they are stored.'
        : 'Closing writes the figures as they stand and stops the database accepting a payment or an invoice dated inside this month. Reopening is possible and takes a reason.'}
    >
      {closesErr ? (
        <Banner tone="crit">
          The record of closed months could not be read: {closesErr}. This section cannot say
          whether {monthKey} is closed, so it offers nothing rather than a button that might close
          it twice.
        </Banner>
      ) : null}
      {err ? <Banner tone="crit">{err}</Banner> : null}

      {live ? (
        <>
          <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--ink2)' }}>
            Closed by {live.closedByName ?? 'somebody whose name could not be read'} on{' '}
            <span className="mono">{gymDateTimeText(live.closedAt, zone) ?? 'a date that could not be read'}</span>.
            {live.note ? <> &ldquo;{live.note}&rdquo;</> : null}
          </div>
          {live.blockersAtClose ? (
            <div style={{ padding: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', whiteSpace: 'pre-line', maxWidth: '80ch' }}>
              Closed over these, which were outstanding at the time:{'\n'}{live.blockersAtClose}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', padding: '0 14px 14px' }}>
            {/* ── read back the way it was written ─────────────────────────
                All four tiles read the single `live.currency` column, which is
                what /close wrote and which was the PAYMENTS' code. Each now
                reads the figure's own column (supabase/parts/2540).

                Only Taken falls back to the legacy column. It was derived
                payments-first, so it can honestly speak for the takings and for
                nothing else on the row: pricing a filed payroll figure with the
                code a card machine happened to take that month is the defect,
                not the fallback for it. Nothing on this platform has ever
                written such a row — `gym_month_closes` was empty when the
                columns were split — so the fallback exists for a console tab
                left open on the previous bundle, and the other three withhold
                rather than borrow. */}
            <Kpi label="Taken, at the close" text={money(live.takenCents, live.takenCurrency ?? live.currency)}
                 note={(live.takenCurrency ?? live.currency) ? undefined : NO_CURRENCY_NOTE} />
            <Kpi label="Billed, at the close" text={money(live.invoicedCents, live.invoicedCurrency)} />
            <Kpi label="Still owed, at the close" text={money(live.outstandingCents, live.outstandingCurrency)} />
            <Kpi label="Payroll, at the close" text={money(live.payrollCents, live.payrollCurrency)}
                 note={live.unmarkedSessions ? `${live.unmarkedSessions} session(s) were unmarked` : undefined} />
          </div>
          {drift.length ? (
            <div style={{ padding: '12px 14px', borderTop: '1px solid var(--ring)' }}>
              <h3 style={{ fontSize: 13, margin: 0, color: 'var(--warn)' }}>
                The record has moved since this month was closed
              </h3>
              <p style={{ margin: '4px 0 8px', color: 'var(--ink3)', fontSize: 12, maxWidth: '76ch' }}>
                Not necessarily an error &mdash; a refund recorded in a later month correctly changes
                what this month&rsquo;s ledger says about a payment in it. It IS something the
                person holding the filed figure has to be told, and before the close was stored
                there was no way to know it had happened.
              </p>
              <ul style={{ margin: 0, padding: '0 0 0 18px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.6 }}>
                {drift.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
          ) : (
            <p style={{ margin: 0, padding: '0 14px 14px', color: 'var(--ink3)', fontSize: 12.5 }}>
              Every figure reads today exactly as it read at the close.
            </p>
          )}
          <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 14px', borderTop: '1px solid var(--ring)' }}>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
                   placeholder="Why this month is being reopened"
                   style={{ ...field, flex: 2, minWidth: 260 }} aria-label="Why this month is being reopened" />
            <button onClick={doReopen} disabled={busy || !reason.trim()} style={primaryBtn}>Reopen</button>
            <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '52ch' }}>
              The close above is kept and the reopen is recorded beside it, so a month that closed
              and then moved is visible as exactly that rather than as a month nobody ever closed.
            </span>
          </div>
        </>
      ) : (
        <div className="no-print" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="A note for whoever reads this later (optional)"
                   style={{ ...field, flex: 2, minWidth: 260 }} aria-label="A note on this close" />
            {confirming ? (
              <>
                <button onClick={doClose} disabled={busy} style={primaryBtn}>
                  {busy ? 'Closing…' : `Yes — close ${monthKey}`}
                </button>
                <button onClick={() => setConfirming(false)} disabled={busy} style={field}>
                  Not yet
                </button>
              </>
            ) : (
              <button onClick={() => { setErr(null); setConfirming(true); }} disabled={busy || !!blocker} style={primaryBtn}>
                {`Close ${monthKey}`}
              </button>
            )}
          </div>
          {confirming ? (
            <Banner tone="warn">
              <strong style={{ color: 'var(--ink)' }}>This files {monthKey} permanently.</strong>{' '}
              The figures on this screen are stored as they stand, and every later reading of this
              month is compared against them. The database will then refuse a payment, an invoice,
              a cost or a payroll run dated inside {monthKey} &mdash; for everybody, at both desks
              and in the office &mdash; until somebody reopens it with a written reason.
              {c.state === 'blocked'
                ? ' This month is not ready by the checks above, and the reasons are stored on the close word for word.'
                : ''}
              {/* Said again here, in the last sentence before the press. The
                  panel above states it once, and this is the banner somebody
                  actually reads: the cost lock is the half of that sentence
                  with no figure on this page behind it. */}
              {costs?.kind === 'gaps' ? (
                <>
                  {' '}
                  <strong style={{ color: 'var(--ink)' }}>
                    {costs.missing.length === 1
                      ? 'One supplier this gym pays most months has no cost recorded for it yet'
                      : `${costs.missing.length} suppliers this gym pays most months have no cost recorded for them yet`}
                  </strong>{' '}
                  &mdash; {costs.missing.map((x) => x.supplier).join(', ')}. That is stored on the
                  close alongside anything else in the way.
                </>
              ) : null}
            </Banner>
          ) : null}
          {blocker ? (
            <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--warn)', maxWidth: '76ch' }}>{blocker}</p>
          ) : c.state === 'blocked' ? (
            <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--warn)', maxWidth: '76ch' }}>
              This month is not ready by the checks above, and it can still be closed. The reasons
              are stored on the close, word for word, so a month signed off over a known problem
              reads later as a decision somebody took rather than as a clean month.
            </p>
          ) : null}
        </div>
      )}

      {/*
        * Off by one, in exactly the case the reason field was made mandatory for.
        *
        * This was `history.length > 1`. After ONE close and ONE reopen there is
        * one row for the month, `liveCloseFor` returns nothing (the close has a
        * `reopenedAt`), so `live` is null and the screen rendered the Close form
        * and nothing else — no reopen reason, no who, no when, no figures as
        * they stood. A month that was closed and then reopened showed no trace
        * of ever having been closed.
        *
        * The section's own argument, three hundred lines up: "Reopening is
        * deliberate, needs a reason, and leaves the original close standing. A
        * month that closed and then moved is two facts and an auditor wants
        * both." One row is already two facts whenever it carries a reopen.
        */}
      {history.length > 1 || history.some((h) => h.reopenedAt) ? (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--ring)' }}>
          <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>Everything that has happened to {monthKey}</h3>
          <ul style={{ margin: '6px 0 0', padding: '0 0 0 18px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.6 }}>
            {history.map((h) => (
              <li key={h.id}>
                Closed {gymDateText(h.closedAt, zone) ?? 'on a date that could not be read'} by {h.closedByName ?? 'somebody'}
                {h.reopenedAt
                  ? <>, reopened {gymDateText(h.reopenedAt, zone) ?? 'on a date that could not be read'} by {h.reopenedByName ?? 'somebody'} &mdash; &ldquo;{h.reopenReason}&rdquo;</>
                  : ' — still in force'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/* ── getting the close out of the browser ──────────────────────────────────── */

/**
 * The close, as a file and as a printed page.
 *
 * Same reasoning as the handoff on /accounting and the same shape, deliberately:
 * these are the two screens written for month-end, and before this wave neither
 * had an export, a print, a PDF or an email. A gym's month-end left the building
 * as a screenshot or a retyped column.
 *
 * One file. A close is a document — the verdict, the blockers, the takings, the
 * receivables and the payroll are read together, and five downloads is how the
 * blocker list ends up in Downloads on its own with nothing saying which month
 * it belongs to.
 *
 * The VERDICT and the BLOCKERS go in first, above every figure, for the same
 * reason they are at the top of the screen: a reader acts on the first thing
 * they see, and a file that opened with the takings would be a file whose
 * refusals are below the fold.
 */
function Handoff({ c, rec, currency, arrearsCcy, gymName, monthKey }: {
  c: MonthClose; rec: CloseRecord; currency: TenantCurrency;
  /** What the month's INVOICES agree on. "Still owed" is denominated in this,
   *  not in what the card takings happened to be in. */
  /** Every invoice figure in this export is `c.arrears`, so this is the arrears
   *  code and not the month's billing one. */
  arrearsCcy: TenantCurrency;
  /* `gymCcy` used to be a prop here, on the argument that payroll "comes off
   * the session fee and the snapshotted rates, so this is its unit". The
   * snapshotted rates carry their own unit (supabase/parts/1010), so it is not:
   * the payroll rows in this file now take theirs from `c.payroll` and from
   * each line, which is where it was recorded. Nothing in this export is
   * denominated in the gym's code any more, so nothing needs it. */
  gymName: string | null; monthKey: string;
}) {
  const download = () => {
    const parts: string[] = [];

    parts.push(toCsv(
      // "Takings currency", not "Currency". `currencyOf` derives it from the
      // month's PAYMENTS; the invoice and payroll figures below have their own
      // and a single header field cannot speak for all three.
      ['Report', 'Gym', 'Month', 'From', 'To', 'Verdict', 'Takings currency', 'Generated'],
      [[
        'Month-end close', gymName ?? '(gym name unread)', c.window.label,
        c.window.firstDay, c.window.lastDay,
        c.state === 'blocked' ? 'NOT CLOSEABLE' : 'Closeable',
        currency ?? '(this gym has not set one)',
        new Date().toISOString(),
      ]],
    ));

    parts.push('\nWHY IT IS NOT CLOSEABLE\n');
    parts.push(c.blockers.length
      ? toCsv(['Kind', 'What is in the way'], c.blockers.map((b) => [b.kind, b.text]), false)
      : 'Nothing is in the way.\n');

    /* ── each headline figure carries its OWN currency ───────────────────
       This block said "minor units, in the currency above" and the currency
       above is `currencyOf`, which is what the month's PAYMENTS agree on. Only
       Taken is a figure the payments produced: Still owed comes off
       `gym_invoices` and Payroll off `sessions.rate_cents` and
       `tenants.session_fee`. So the sheet an accountant reconciles against a
       bank statement declared one code at the top and put three figures under
       it, two of which were not in it. The table below this one already carries
       a currency per line, "and not the one in the front matter above", for
       precisely this reason. */
    parts.push('\nHEADLINE FIGURES — minor units, each in the currency on its own row\n');
    parts.push(toCsv(
      ['Figure', 'Amount (minor units)', 'Currency', 'Note'],
      [
        ['Taken', c.income?.takenCents ?? null, currency ?? '(not stated)',
          c.income ? `${c.income.count} payment(s)${c.income.currencies.length > 1 ? ', more than one currency so no total' : ''}` : 'the payments were not read'],
        ['Still owed', c.arrears?.outstandingCents ?? null, arrearsCcy ?? '(not stated)',
          c.arrears ? `${c.arrears.outstanding} open, ${c.arrears.overdue} past due${arrearsCcy ? '' : ' — the invoices do not all state one currency, so this is not one total'}` : 'the invoices were not read'],
        // The payroll run's OWN money, and no amount at all where the run
        // covers more than one. `gymCcy` here was `tenants.currency` — the code
        // the gym charges in today — printed against a sum of rates snapshotted
        // whenever they were snapshotted, in the file an accountant reconciles
        // against a bank statement. Where the sum spans two currencies it is
        // not an amount of anything and the Note carries the sentence instead.
        ['Payroll',
          c.payroll && !c.payroll.mixedCurrency ? c.payroll.total.cents : null,
          // Three different silences, and "(not stated)" is only one of them.
          // A reader of this file has the row and nothing else.
          !c.payroll ? '(not stated)'
            : c.payroll.currency
              ?? (c.payroll.mixedCurrency ? '(more than one — not totalled)' : '(not recorded)'),
          c.payroll
            ? [
                c.payroll.total.unmarked > 0 ? `NOT FINAL — ${c.payroll.total.unmarked} unmarked` : `${c.payroll.total.delivered} delivered`,
                c.payroll.currencyNote,
              ].filter(Boolean).join(' — ')
            : 'the sessions were not read'],
      ],
      false,
    ));

    // Each line carries its OWN currency, and not the one in the front matter
    // above. This table used to be exported blended across currencies into a
    // file that states a single Currency at the top, which is the one figure on
    // the close an accountant breaks the month down by.
    parts.push('\nWHAT CAME IN, BY METHOD\n');
    parts.push(c.income
      ? toCsv(['How it arrived', 'Currency', 'Payments', 'Amount (minor units)'],
              c.income.byMethod.map((l) => [l.label, l.currency, l.count, l.cents]), false)
      : 'NOT EXPORTED — the payments could not be read. This is unknown, not nil.\n');

    parts.push('\nSTILL OWED AT THE MONTH END\n');
    parts.push(rec.invoices.state === 'ready'
      ? toCsv(
          ['Member', 'Issued', 'Due', 'Amount (minor units)', 'Currency', 'Status'],
          rec.invoices.rows
            .filter((i) => (i.status === 'open' || i.status === 'overdue') && i.issuedOn <= c.window.lastDay)
            .map((i) => [i.memberName, i.issuedOn, i.dueOn, i.amountCents, i.currency, i.status]),
          false)
      : 'NOT EXPORTED — the invoice register could not be read. This is unknown, not nil.\n');

    // A Currency column, like every other table in this file. This one was the
    // single exception: six columns, one of them money, and nothing anywhere on
    // the row saying what money — so it was read against the one code in the
    // front matter, which is the takings'. A coach paid in EUR at a gym banking
    // in GBP was exported as a GBP figure. A line whose own sessions span two
    // currencies has no code and no total, and says so in place of both rather
    // than exporting a number that is not an amount.
    parts.push('\nPAYROLL BY TRAINER\n');
    parts.push(c.payroll
      ? toCsv(
          ['Trainer', 'Delivered', 'No-shows', 'Cancelled', 'Unmarked', 'Pay (minor units)', 'Currency'],
          c.payroll.lines.map((l) => [
            l.trainerName, l.delivered, l.noShows, l.cancelled, l.unmarked,
            l.mixedCurrency ? null : l.cents,
            l.currency ?? (l.mixedCurrency ? '(more than one — not totalled)' : '(not recorded)'),
          ]),
          false)
      : 'NOT EXPORTED — the sessions could not be read. This is unknown, not nil.\n');

    saveText(parts.join(''), `${slugOf(gymName)}-${monthKey}-close.csv`);
  };

  return (
    <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 22px' }}>
      <button onClick={download} style={primaryBtn}>Export this close (CSV)</button>
      <button onClick={() => window.print()} style={{ ...primaryBtn, background: 'transparent', color: 'var(--ink2)', border: '1px solid var(--ring)' }}>
        Print / save as PDF
      </button>
      <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '58ch' }}>
        The verdict and the blockers are the first two sections of the file, above every figure, for
        the same reason they are the first two things on this screen.
      </span>
    </div>
  );
}

/** A filename fragment from the gym's name, or a fallback rather than a file
 *  called "-2026-08-close.csv" that sorts before everything in a folder. */
function slugOf(name: string | null): string {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'gym';
}

/* ── what came in, and what it was for ─────────────────────────────────────── */

function Income({ c, rec, currency }: { c: MonthClose; rec: CloseRecord; currency: TenantCurrency }) {
  // Null for either of `money()`'s two silences — no amount, or no currency —
  // and the sentence below has to hold together under both.
  // The unattributed figure is denominated by the ROWS that make it up, not by
  // the gym's own currency. `unattributedCurrency` is null when those rows
  // disagree, and `money()` then returns null and the sentence below says why —
  // which is the same handling a missing gym currency already got.
  const unattributed = c.income ? money(c.income.unattributedCents, c.income.unattributedCurrency) : null;

  // ── every line prints the currency it is a sum of ──────────────────────────
  //
  // Both of these tables used to render `money(l.cents, currency)` against
  // lines that `incomeOf` and `purposeOf` had blended across currencies, so a
  // gym holding dirhams and pounds read one "Card" figure with a single
  // currency printed over it — on the close, which is the document an
  // accountant works from, and in the CSV below it. The grouping now splits by
  // currency, so each line is a sum of like things and states its own.
  const cols: Column<Line>[] = [
    { key: 'label', header: 'How it arrived', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency,
      render: (l) => l.currency ?? <span className="dash">not stated</span> },
    { key: 'count', header: 'Payments', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, l.currency) },
  ];

  const purposeCols: Column<Line>[] = [
    { key: 'label', header: 'What it was for', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency,
      render: (l) => l.currency ?? <span className="dash">not stated</span> },
    { key: 'count', header: 'Payments', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, l.currency) },
  ];

  return (
    <Section
      title="What came in"
      sub="Only payments somebody recorded. Nothing here is inferred from a membership price, and nothing is pro-rated."
    >
      <Part slice={rec.payments} what="the payments taken">
        {c.income ? (
          <DataTable noun="payment methods"
            rows={c.income.byMethod} columns={cols} rowKey={(l) => l.key}
            empty="No payment was recorded in this month. That is not the same as no income — it is the same as nobody having entered one."
          />
        ) : null}
      </Part>

      <div style={{ borderTop: '1px solid var(--ring)' }}>
        <div style={{ padding: '11px 14px' }}>
          <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>What it was for</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
            The payments table holds no category, so this is attribution rather
            than accounting: whether the payer held a membership covering the
            month. Nothing is guessed from the amount.
          </p>
        </div>
        {rec.memberships.state === 'loading' || rec.payments.state === 'loading' ? <Loading /> : null}
        {rec.memberships.state === 'failed' ? (
          <Failed reason={rec.memberships.reason} what="the membership roster"
                  cost="payments cannot be attributed, so this is unknown rather than unattributed" />
        ) : null}
        {c.purpose ? (
          <DataTable noun="income purposes"
            rows={c.purpose} columns={purposeCols} rowKey={(l) => l.key}
            empty="Nothing to attribute — no payment was recorded in this month."
          />
        ) : null}
        {c.income && c.income.unattributed > 0 ? (
          <p style={{ margin: 0, padding: '0 14px 14px', color: 'var(--ink3)', fontSize: 12.5 }}>
            {/* The amount is a clause, not the subject: `money()` returns null
                at a gym that has not set its currency, and React renders null as
                nothing — which left " . Counted in the total" with a space and a
                full stop where the figure should be. The count is what this
                paragraph is for and it is always known, so the money joins it
                only when it can be written. */}
            {c.income.unattributed} payment{c.income.unattributed === 1 ? '' : 's'} carr
            {c.income.unattributed === 1 ? 'ies' : 'y'} nobody&rsquo;s name
            {unattributed ? <> &mdash; {unattributed}</> : null}. Counted in the total, and
            named here because it cannot be chased, refunded or explained later.
            {/* Two different silences now reach this sentence and they are not
                the same fact. The rows themselves may disagree about what money
                they are, which is a thing about the payments; or nothing states
                a currency at all, which is a thing about the gym. */}
            {unattributed ? null : c.income && c.income.unattributedCurrency == null
              ? <> What they come to cannot be stated because those payments do not all state the same currency.</>
              : <> What they come to cannot be stated because {NO_CURRENCY_NOTE}.</>}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/* ── what is still owed ────────────────────────────────────────────────────── */

function Owed({ c, rec, currency, zone, nowMs }: {
  c: MonthClose; rec: CloseRecord; currency: TenantCurrency; zone: string | null; nowMs: number;
}) {
  // The GYM's today, not UTC's. This was `new Date().toISOString().slice(0, 10)`
  // — the UTC calendar date — which for a gym east of Greenwich turns over hours
  // before the gym's own day does and for one west of it hours after. This
  // figure decides which invoices read as overdue on a page printed for an
  // accountant, and an invoice due on the 31st is not late on the morning of
  // the 31st wherever the reader happens to be.
  //
  // The FALLBACK is `isoDay`, the reader's own day, and it was UTC's. Not a
  // free choice: `buildClose` at the top of this file is now handed
  // `gymDay(Date.now(), zone) ?? undefined` and falls back internally to
  // `isoDay(new Date(now))`, so a gym that has set no zone had this table
  // colouring its Status column on UTC's calendar while the "Still owed" tile
  // three inches above it counted `arrears.overdue` on the reader's. One
  // screen, two calendars, disagreeing for the hours between two midnights —
  // which is the whole defect this line was written to end, arriving by the
  // other door. The two fallbacks are now the same expression.
  //
  // And both now read the same INSTANT as well as the same calendar: `nowMs` is
  // when this screen last read the gym, which is what `buildClose` above is also
  // handed. A bare `Date.now()` here was fresh only because this line is not
  // memoised — the tile above it was not, and one screen agreeing with itself
  // only for as long as nobody re-rendered is not agreement.
  const today = gymDay(nowMs, zone) ?? isoDay(new Date(nowMs));
  // Both null at a gym that has not set a currency, and the paragraph below
  // states the invoice counts rather than a dash when they are.
  const outstanding = c.arrears ? money(c.arrears.outstandingCents, currency) : null;
  const dropped = c.arrears ? money(c.arrears.droppedCents, currency) : null;
  const open = (rec.invoices.state === 'ready' ? rec.invoices.rows : [])
    .filter((i) => i.status === 'open' || i.status === 'overdue')
    .filter((i) => i.issuedOn <= c.window.lastDay);

  const cols: Column<GymInvoice>[] = [
    { key: 'member', header: 'Member', value: (i) => i.memberName },
    { key: 'issued', header: 'Issued', value: (i) => i.issuedOn },
    { key: 'due', header: 'Due', value: (i) => i.dueOn,
      render: (i) => i.dueOn
        ? <span style={{ color: isOverdue(i, today) ? 'var(--crit)' : undefined }}>{i.dueOn}</span>
        : <span className="dash">no due date set</span> },
    { key: 'amount', header: 'Amount', value: (i) => i.amountCents, numeric: true,
      render: (i) => money(i.amountCents, i.currency) },
    { key: 'status', header: 'Status', value: (i) => (isOverdue(i, today) ? 'overdue' : i.status),
      render: (i) => isOverdue(i, today)
        ? <span style={{ color: 'var(--crit)' }}>overdue</span>
        : <span>{i.status}</span> },
    { key: 'note', header: 'Note', value: (i) => i.note },
  ];

  return (
    <Section
      title="What is still owed"
      sub="Every invoice issued on or before the month end that is still unpaid — including ones raised in earlier months, because those are still money the gym is owed at this close."
    >
      <Part slice={rec.invoices} what="the invoice register">
        <>
          {c.arrears ? (
            <p style={{ margin: 0, padding: '12px 14px', color: 'var(--ink2)', fontSize: 13, borderBottom: '1px solid var(--ring)' }}>
              {/* The counts lead and the money follows, because `money()` is
                  null at a gym with no currency set and "— across 3 invoices"
                  is a sentence whose subject has gone missing. The invoice
                  counts are known either way, and they are the fact an owner
                  is reconciling against. */}
              {c.arrears.outstanding === 0
                ? 'Nothing outstanding. Every invoice issued up to the end of this month is settled, void or written off.'
                : <>
                    {c.arrears.outstanding} invoice{c.arrears.outstanding === 1 ? '' : 's'} still unpaid
                    {outstanding ? <>, {outstanding} in all</> : null}, of which{' '}
                    {c.arrears.overdue} {c.arrears.overdue === 1 ? 'is' : 'are'} past a due date the gym set.
                    {outstanding ? null : ` What they come to cannot be stated because ${NO_CURRENCY_NOTE}.`}
                    {c.arrears.dropped
                      ? dropped
                        ? ` A further ${dropped} is void or written off and is counted in neither what was taken nor what is owed.`
                        : ` A further ${c.arrears.dropped} invoice${c.arrears.dropped === 1 ? ' is' : 's are'} void or written off and counted in neither what was taken nor what is owed.`
                      : null}
                  </>}
            </p>
          ) : null}
          <DataTable noun="unpaid invoices"
            rows={open} columns={cols} rowKey={(i) => i.id}
            empty="No unpaid invoice stands against this month. If the gym does not invoice through Repple, that is what this looks like — there is no second record to check the takings against."
          />
        </>
      </Part>
    </Section>
  );
}

/* ── what does not reconcile ───────────────────────────────────────────────── */

function Reconciliation({ c, rec }: { c: MonthClose; rec: CloseRecord }) {
  const bothRead = rec.payments.state === 'ready' && rec.invoices.state === 'ready';

  return (
    <Section
      title="What does not reconcile"
      sub="Money banked against money the invoice register says arrived, at the gym's own 2% tolerance — the same rule the financial-health screen uses, not a second one."
    >
      <div style={{ padding: '14px' }}>
        {!bothRead ? (
          <p style={{ margin: 0, color: 'var(--ink2)', fontSize: 13.5 }}>
            {rec.payments.state === 'loading' || rec.invoices.state === 'loading'
              ? 'Still reading both sides.'
              : 'One side of the comparison could not be read, so no reconciliation is offered. A check run against a failed read looks like a finding, which is worse than no check.'}
          </p>
        ) : !c.check ? (
          <p style={{ margin: 0, color: 'var(--ink2)', fontSize: 13.5 }}>
            Nothing to reconcile: no payment was recorded in {c.window.label} and no
            invoice in it is marked paid. Two silences, not an agreement.
          </p>
        ) : (
          <>
            <div className="micro">{RECON_LABEL[c.check.r.state]}</div>
            <p style={{ margin: '7px 0 0', fontSize: 13.5, color: 'var(--ink2)' }}>
              {c.check.note ?? 'The two sides agree inside the 2% tolerance. Nothing to explain.'}
            </p>
            {c.check.gapCents != null && c.check.r.state === 'differs' ? (
              <p style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--ink3)' }}>
                The difference is {num1(c.check.r.driftPct! * 100)}% of what the
                register expected. It is shown, not absorbed: no figure on this page
                has been adjusted to make the two agree.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}

/**
 * The caption above the reconciliation, one per state of it.
 *
 * Keyed `Record<Reconciliation['state'], string>` and not `Record<string,
 * string>`, which is the whole reason this comment exists. With the loose key
 * type a state with no entry is not an error anywhere — it is `undefined`
 * rendered into a `<div className="micro">`, which is an EMPTY LINE. That is
 * what 'unreadable' did: `moneyCheck` returns it for all three of its
 * uncomparable cases, and each of those printed a complete, correct sentence
 * about two currencies underneath a caption that was not there. Blank is the
 * one thing a screen that refuses must never be, and the type now says so.
 */
const RECON_LABEL: Record<Reconciliation['state'], string> = {
  no_record: 'Nothing to check against',
  not_entered: 'The register says money arrived that no payment shows',
  agrees: 'Agrees',
  differs: 'Does not reconcile',
  // Covers all three of `MoneyCheck.uncomparable` — mixed payments, mixed
  // invoices, and the two sides each agreeing with themselves in a different
  // money. It says the comparison did not happen and not that it failed: the
  // records are readable and this month is not one number. Which of the three,
  // and in which currencies, is the sentence below.
  unreadable: 'Not compared — these records are not in one money',
};

/* ── what is unmarked, and therefore blocking payroll ──────────────────────── */

function Payroll({ c, rec, zone, nowMs, sessionFee, feeCents }: {
  c: MonthClose; rec: CloseRecord; zone: string | null;
  nowMs: number; sessionFee: number | null; feeCents: number | null;
}) {
  // `isAwaitingOutcome(s, nowMs)`, with `nowMs` in the dependency list. The
  // second argument defaults to `Date.now()`, so with only the rows and the
  // month in the deps this list answered "which sessions had finished without an
  // outcome" as of the moment the sheet was first drawn. A session that ended
  // an hour later never appeared in it — the UNDER-counting direction, on the
  // table whose whole job is to name what is blocking a pay run.
  const unmarked = useMemo(
    () => (rec.sessions.state === 'ready' ? rec.sessions.rows : [])
      .filter((s) => inWindow(s.startsAt, c))
      .filter((s) => isAwaitingOutcome(s, nowMs)),
    [rec.sessions, c, nowMs],
  );

  // Null when the run has no one honest label — see the paragraph below, which
  // states the session count and `currencyNote` instead of a dash where the
  // total would go. `c.payroll.currency` is `runLabel` asked of the sessions
  // this sum is made of, and NOT `tenants.currency`: that was the gym's code
  // today over rates snapshotted whenever they were snapshotted.
  // Named `...Money` and not `...Total`: this is `money()`'s output, a
  // formatted string with a currency code already on the front of it, and
  // nothing downstream may treat it as a figure. It was `payrollTotal`, which
  // reads as a number — and check-numbers.mjs, walking the console for the
  // first time, reported it as a four-digit-capable figure rendered raw. The
  // gate was wrong about this line and right about the name.
  const payrollMoney = c.payroll ? money(c.payroll.total.cents, c.payroll.currency) : null;

  const cols: Column<PayrollLine>[] = [
    { key: 'trainer', header: 'Trainer', value: (l) => l.trainerName },
    { key: 'delivered', header: 'Delivered', value: (l) => l.delivered, numeric: true },
    { key: 'noShows', header: 'No-shows', value: (l) => l.noShows, numeric: true },
    { key: 'cancelled', header: 'Cancelled', value: (l) => l.cancelled, numeric: true },
    { key: 'unmarked', header: 'Unmarked', value: (l) => l.unmarked, numeric: true,
      render: (l) => l.unmarked
        ? <span style={{ color: 'var(--crit)' }}>{l.unmarked}</span>
        : <span className="dash">0</span> },
    { key: 'cents', header: 'Pay', value: (l) => l.cents, numeric: true,
      // Four silences, not three. `money()` returns null where the currency is
      // unknown, and this cell rendered that as an EMPTY cell — a blank in the
      // Pay column of a payroll table reads as nothing owed.
      //
      // `l.currency` and not the gym's. A coach paid in EUR at a gym that
      // charges in GBP had their month printed here in pounds, beside a
      // settlement screen that refuses to make that payment at all
      // (`settleCurrencyBlocker`); and a coach whose own month straddles two
      // moneys has a `cents` that is a sum across them, which is not an amount
      // and is withheld rather than labelled with either.
      render: (l) => l.cents == null
        ? <span className="dash">no rate</span>
        : money(l.cents, l.currency)
          ?? <span className="dash">{l.mixedCurrency ? 'more than one currency' : 'no currency recorded'}</span> },
  ];

  const sessionCols: Column<PtSession>[] = [
    { key: 'when', header: 'Started', value: (s) => s.startsAt,
      render: (s) => gymDateTimeText(s.startsAt, zone) ?? <span className="dash">not stated</span> },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName },
    { key: 'client', header: 'Client', value: (s) => s.clientName },
    { key: 'mins', header: 'Minutes', value: (s) => s.durationMin, numeric: true },
    // The row's OWN unit, exactly as the invoice table above renders each line
    // with `money(i.amountCents, i.currency)`. This cell used the gym's code,
    // which is the one thing a snapshotted rate is guaranteed not to be
    // denominated in once a gym has changed it.
    { key: 'rate', header: 'Rate held', value: (s) => s.rateCents, numeric: true,
      render: (s) => s.rateCents == null
        ? <span className="dash">not snapshotted</span>
        : money(s.rateCents, s.rateCurrency) ?? <span className="dash">no currency recorded</span> },
  ];

  return (
    <Section
      title="What is unmarked, and therefore blocking payroll"
      sub="Payroll counts delivered sessions. A session nobody marked has an unknown outcome, is kept out of the total, and is listed here by name rather than footnoted under it."
    >
      <Part slice={rec.sessions} what="the one-to-ones">
        <>
          {c.payroll ? (
            <p style={{
              margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
              color: c.payroll.blocker ? 'var(--ink2)' : 'var(--ink3)', fontSize: 13,
            }}>
              {/* The payable count leads. `money()` is null at a gym with no
                  currency set, and "…is marked and priced. — across 12 payable
                  sessions." reads as a sentence that lost its total rather than
                  as a total nobody can write. */}
              {c.payroll.blocker
                ? <><strong>Not safe to settle.</strong> {c.payroll.blocker}</>
                : <>Every session in {c.window.label} is marked and priced. {c.payroll.total.payable} payable session{c.payroll.total.payable === 1 ? '' : 's'}{payrollMoney ? <>, {payrollMoney} in all</> : null}.{
                    // Which silence this is, in the words of the module that
                    // decided it. `currencyNote` is `totalNote` — one sentence
                    // for a run that straddles two moneys and a different one
                    // for rates that predate supabase/parts/1010 — and only
                    // where it has nothing to say does the gym-has-no-currency
                    // sentence apply, which is the case it was written for.
                    payrollMoney ? null
                      : c.payroll.currencyNote ? ` ${c.payroll.currencyNote}`
                      : ` What they come to cannot be stated because ${NO_CURRENCY_NOTE}.`
                  }</>}
              {sessionFee == null
                ? ' No standard session fee is set, so a session with no snapshotted rate stays unpriced rather than free.'
                : feeCents == null
                  ? ' This gym has not said what money it charges in, so its standard session fee cannot be stated as an amount and a session with no snapshotted rate stays unpriced rather than free.'
                  : null}
            </p>
          ) : null}
          <DataTable noun="payroll lines"
            rows={c.payroll?.lines ?? []} columns={cols} rowKey={(l) => l.trainerId}
            empty="No one-to-one ran in this month. Nothing to pay, and nothing blocking."
          />
          {unmarked.length ? (
            <div style={{ borderTop: '1px solid var(--ring)' }}>
              <div style={{ padding: '11px 14px' }}>
                <h3 style={{ fontSize: 13, margin: 0, color: 'var(--crit)' }}>
                  {unmarked.length} session{unmarked.length === 1 ? '' : 's'} waiting on an outcome
                </h3>
                <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
                  Mark {unmarked.length === 1 ? 'it' : 'them'} under Sessions. Until then
                  the payroll figure above is short by exactly{' '}
                  {unmarked.length === 1 ? 'this one' : `these ${unmarked.length}`}.
                </p>
              </div>
              <DataTable noun="unmarked sessions"
                rows={unmarked} columns={sessionCols} rowKey={(s) => s.id}
                empty="—"
              />
            </div>
          ) : null}
        </>
      </Part>
    </Section>
  );
}

/* ── passes ────────────────────────────────────────────────────────────────── */

function Passes({ c, rec, currency }: { c: MonthClose; rec: CloseRecord; currency: TenantCurrency }) {
  // Null for three separate silences — no priced pass, priced passes in two
  // moneys, and priced passes that name no money at all — and the sentence
  // below has a branch for each. `currency` is what the month's PRICED passes
  // agree on, never `tenants.currency`, so none of the three is the gym having
  // left a field unset and none of them says so.
  // `...Money`, not `...Total` — a formatted string, for the reason given
  // beside `payrollMoney` above.
  const passesMoney = c.passes ? money(c.passes.cents, currency) : null;
  return (
    <Section
      title="Passes sold"
      sub="A separate record, shown beside the takings and deliberately not added into them."
    >
      <Part slice={rec.passes} what="passes sold">
        <p style={{ margin: 0, padding: '14px', color: 'var(--ink2)', fontSize: 13.5 }}>
          {!c.passes || c.passes.sold === 0
            ? `No pass was issued in ${c.window.label}.`
            : <>
                {c.passes.sold} pass{c.passes.sold === 1 ? '' : 'es'} issued,{' '}
                {/* Three states, not two: no price recorded on any pass, prices
                    recorded but no currency to write them in, and both. The
                    middle one used to render `money()`'s null as nothing at all,
                    leaving " recorded across 4 of them." — a sentence starting
                    with a space where its subject belonged. */}
                {c.passes.cents == null
                  ? <>and not one carried a recorded price — so the amount is unknown, not nothing.</>
                  : passesMoney
                    ? <>{passesMoney} recorded across {c.passes.priced} of them.</>
                    /* ── two silences, and neither is the gym's currency setting ──
                       This branch used to say the total could not be stated
                       "because this gym has not set its currency". The figure
                       above is denominated by the PASSES, not by the tenant, so
                       that sentence named a field that is very often already
                       set — and sent an owner to Ops to fix something that was
                       never the reason. The two real reasons are kept apart the
                       way app/(owner)/financials.tsx keeps its own several
                       silences apart, because an owner acts differently on each:
                       a month genuinely holding two moneys is not a mistake and
                       there is nothing to go and correct, while priced passes
                       that record no currency at all is a desk that has been
                       taking money without saying in what. */
                    : c.passes.mixedCurrency
                      ? <>
                          {c.passes.priced} of them carr{c.passes.priced === 1 ? 'ies' : 'y'} a recorded price
                          {c.passes.currencies.length > 1
                            ? <>, in {c.passes.currencies.join(' and ')}</>
                            : c.passes.currencies.length === 1
                              ? <>, some in {c.passes.currencies[0]} and at least one stating no currency at all</>
                              : null}
                          . {MIXED_CURRENCY_NOTE}
                        </>
                      : <>
                          {c.passes.priced} of them carr{c.passes.priced === 1 ? 'ies' : 'y'} a recorded price, but not
                          one of those rows says what money it was taken in, so there is no figure to write here.
                          The gym&rsquo;s own currency is not the answer: it is not evidence about what somebody was
                          charged at the desk.
                        </>}
                {' '}Nothing links a pass row to a payment row, so this is not added to
                what came in: summing them would double-count every pass paid for at
                the desk, and ignoring it would drop the rest. Both records are shown
                instead of one invented total.
              </>}
        </p>
      </Part>
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/** Run one read into a slice, so a rejection becomes a stated failure rather
 *  than an empty month. */
async function slice<T>(run: () => Promise<T[]>): Promise<Slice<T>> {
  try {
    return sliceReady(await run());
  } catch (e: any) {
    return sliceFailed(e?.message ?? 'The read failed.');
  }
}

/* ── the costs read ────────────────────────────────────────────────────────── */

/**
 * A window of `gym_costs`, with the four things that can be true of it.
 *
 * Not a `Slice`, and the difference is the point. `slice()` above collapses a
 * `TruncatedRead` into 'failed', which is right for the five reads the month's
 * figures come from: neither answer lets a figure be printed, so one sentence
 * covers both. It is wrong here. A cost read that FAILED tells an owner nothing
 * about their suppliers; a cost read that was CUT OFF would make every supplier
 * past the cap look like one nobody entered, on the screen that files the month.
 * They are two different accusations and only one of them is about the gym.
 */
interface CostRead {
  state: CostReadState;
  rows: GymCost[];
  /** The database's own words, for the panel. Null when there is nothing wrong. */
  reason: string | null;
}

const COSTS_LOADING: CostRead = { state: 'loading', rows: [], reason: null };

async function readCosts(tenantId: string, fromDay: string, toDay: string): Promise<CostRead> {
  try {
    return { state: 'ready', rows: await fetchGymCosts(supabase, tenantId, fromDay, toDay), reason: null };
  } catch (e: any) {
    // `instanceof` rather than a string match on the message. `assertWhole`
    // throws this exact class and nothing else does, and a screen that told
    // them apart by reading the sentence would start lying the day somebody
    // reworded it.
    if (e instanceof TruncatedRead) return { state: 'partial', rows: [], reason: e.message };
    return { state: 'failed', rows: [], reason: e?.message ?? 'The costs read failed.' };
  }
}

/**
 * Invoices issued on or before the end of the month being closed.
 *
 * Nothing had ever read `gym_invoices` — the status enum existed in
 * gymRecord.ts and no query did. This is the first, and it goes back past the
 * month on purpose: an invoice raised in June and unpaid in August is still
 * money owed at the August close, and scoping the query to August would have
 * reported that gym as owed nothing.
 *
 * `.error` is checked on both queries. supabase-js resolves on a database
 * error, so without it a failed read arrives as `data: null`, falls through
 * `?? []`, and this screen reports a gym that billed nothing and is owed
 * nothing — while continuing to call the month reconciled.
 *
 * PAGED through src/lib/rowCap.ts rather than capped, and the difference is
 * the whole life of this screen. PostgREST stops at 1000 rows silently, monthly
 * billing to a couple of hundred members passes that inside half a year, and
 * the order is `issued_on desc` so what fell away was the OLDEST — the
 * long-unpaid invoices, which is precisely what a close is looking for.
 * Refusing was the right answer to that and a temporary one: a month cannot be
 * closed against a set of invoices whose size nobody knows, but nor can it be
 * closed against a read that has refused every month since the gym's first
 * year, and no gym can make its own invoice history shorter. `readAll` finishes
 * the read, and `PAGE_CEILING` still refuses past fifty thousand invoices — a
 * sentence about the size of the read rather than about the money.
 *
 * `issued_on` is a DATE, so a gym that raises its whole book on the first of
 * the month has hundreds of rows tied on it. `id` is the primary key and gives
 * `readAll` the total order it requires; without it, pages of a tied ordering
 * drop and repeat rows silently, which on this screen would be an invoice
 * missing from a closed month.
 */
async function fetchInvoices(tenantId: string, upToDay: string): Promise<GymInvoice[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_invoices')
      .select('id, member_id, amount_cents, currency, issued_on, due_on, status, note')
      .eq('tenant_id', tenantId)
      .lte('issued_on', upToDay)
      .order('issued_on', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    'the invoices up to the end of this month',
  );
  if (!rows.length) return [];

  const names = await namesFor(rows.map((r: any) => r.member_id));
  return rows.map((r: any) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: names.get(r.member_id) ?? null,
    amountCents: r.amount_cents ?? 0,
    // Not `?? 'AED'`. The column is NOT NULL and — since supabase/parts/150 —
    // has NO DEFAULT, so a write that omits the currency is rejected and a read
    // always finds one; this branch does not fire in practice. "In practice" is
    // exactly what the currency bug was made of, so it is still written: null
    // flows to money(), which withholds the figure.
    currency: r.currency ?? null,
    issuedOn: r.issued_on,
    dueOn: r.due_on ?? null,
    status: r.status ?? 'open',
    note: r.note ?? null,
  }));
}

/**
 * Names from `profiles`, where they live. Throws on a failed read rather than
 * returning an empty map — an unnamed invoice list on a chase-the-money screen
 * is not a cosmetic problem.
 *
 * CHUNKED through src/lib/idLookup.ts, and that stopped being optional when the
 * invoice read above started paging. `unique` used to be bounded by that read's
 * thousand-row refusal, so one `.in()` could not truncate; with the read
 * finished, a gym with five thousand invoices sends five thousand ids, gets the
 * first thousand names back with no complaint, and every invoice past that is
 * drawn with no name on the chase-the-money screen. A list that long is also a
 * 200KB query string, which a proxy refuses long before PostgREST sees it.
 *
 * Fewer names than ids is still not truncation. Verified against the live
 * database: `profiles_owner_tenant_r` is `is_owner_of(tenant_id)`, so ids
 * outside this owner's gym simply do not come back, and the row keeps its
 * honest null.
 */
async function namesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const rows = await readByIds<any>(
    ids,
    (chunk, from, to) => supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
    'the names on those invoices',
  );
  return new Map(rows
    .map((p: any) => [p.id, (p.full_name || '').trim()] as [string, string])
    .filter(([, n]) => !!n));
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

function inWindow(iso: string, c: MonthClose): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= Date.parse(c.window.fromIso) && t < Date.parse(c.window.toIso);
}

/** Two figures that may each be null. Null unless at least one is known — and
 *  a known one plus an unknown one is still not a total, so both must be
 *  present or absent together. */
function sumOrNull(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * The currency this close is denominated in — or null, which is a dash on every
 * figure and is the right answer more often than it looks.
 *
 * The last line of this used to be `return 'AED'`. So a month with no priced
 * payment and no invoice in it — a quiet month, a new gym, a month whose reads
 * failed — produced a close reporting itself in dirhams, and a close is the
 * document an owner reconciles against a bank statement and sends to an
 * accountant. Nothing about the number was marked as assumed.
 *
 * Order matters and it is deliberate: a row that STATES its currency wins,
 * because that is what was actually recorded against that money. The gym's own
 * `tenants.currency` is the fallback for a month with no rows to ask. And when
 * the gym has not set one either, there is genuinely no answer and the screen
 * says so rather than picking.
 *
 * ── why it asks the rows to AGREE ─────────────────────────────────────────
 *
 * This used to read `rec.payments.rows[0].currency` — the FIRST payment of the
 * month, denominating the whole close. `gym_payments.currency` is `not null
 * default 'AED'`, so any row written before the write path required a currency
 * is a dirham row, and one of those sitting at the top of August printed a
 * London gym's entire August — payroll, the per-trainer Pay column, the rate
 * held, passes sold — in dirhams. None of those figures comes from a payment at
 * all; they inherit the label. A close is what an owner reconciles against a
 * bank statement and hands to an accountant.
 *
 * So a set of rows only gets to name the currency when every priced row in it
 * names the same one. A set that disagrees has no single currency by
 * definition, and the honest next question is the gym's own — not whichever row
 * happened to sort first.
 *
 * Only ever used for rendering; no total is asserted across currencies anywhere.
 */
/*
 * `agreedCurrency` used to live here, as five lines that were `sharedCurrency`
 * in gymRecord.ts written a second time — and written without its
 * `.trim().toUpperCase()`, so ' gbp ' and 'GBP' were two currencies and this
 * close withheld a total the gym was entitled to. That export exists precisely
 * so a rule about money does not exist twice; /revenue had a third copy called
 * `oneCurrency` and it is gone for the same reason.
 */
const agreedCurrency = (rows: Array<{ currency: string | null }>): TenantCurrency =>
  sharedCurrency(rows);

/**
 * The one code a set of invoices agreed on, read back off the summary that
 * summed them.
 *
 * Not `agreedCurrency` over rows the caller narrowed itself: `owedOf` has
 * already normalised every code the same way `sharedCurrency` does, and asking
 * a second time is how the sum and its label come to be derived from two
 * different sets.
 *
 * Both fields are consulted because they answer two different questions.
 * `currencies` is what the rows STATED, with the "nobody said" member dropped;
 * `mixedCurrency` counts that member. A month of GBP invoices with one row
 * carrying no currency at all has `currencies.length === 1` and is not a month
 * in one money, and every figure `owedOf` returned for it is already null.
 */
const agreedIn = (o: Owed | null): TenantCurrency =>
  o && !o.mixedCurrency && o.currencies.length === 1 ? o.currencies[0] : null;

function currencyOf(rec: CloseRecord, gym: TenantCurrency): TenantCurrency {
  if (rec.payments.state === 'ready' && rec.payments.rows.length) {
    const agreed = agreedCurrency(rec.payments.rows);
    if (agreed) return agreed;
  }
  if (rec.invoices.state === 'ready' && rec.invoices.rows.length) {
    const agreed = agreedCurrency(rec.invoices.rows);
    if (agreed) return agreed;
  }
  return gym;
}

/** The note under a KPI whose figure is missing — which of the three states it
 *  is missing for. */
/* ── the costs side, above the button ──────────────────────────────────────── */

/**
 * What this gym normally pays, and which of it is not in this month.
 *
 * ── Why this is on the close screen and not on /costs ──────────────────────
 *
 * Because /costs is where you go when you already know something is missing.
 * This is the screen that takes the decision away: pressing Close attaches
 * part 182's trigger to every future `gym_costs` write dated inside the month
 * (supabase/parts/700), so the rent invoice that arrives on the 8th is refused
 * with a P0001, for everybody, until an owner reopens the month with a written
 * reason on a screen only an owner can open.
 *
 * The timing is the whole problem. A supplier bills for August in September and
 * the close is pressed in the first week of September, so the moment an owner is
 * most likely to file the month is the moment its costs are least likely to be
 * in.
 *
 * ── What it deliberately is not ────────────────────────────────────────────
 *
 * Not a blocker. `closeBlockers` refuses claims about MONEY THIS SCREEN PRINTS,
 * and this screen prints no figure computed from a cost and never may — the
 * rule is stated in capitals at the head of src/lib/gymCosts.ts and it is not
 * being bent here. An owner is entitled to close August with the rent
 * outstanding; what they are not entitled to is to do it without being told.
 *
 * Not a total either. Every amount below belongs to one supplier and wears that
 * supplier's own currency, because a gym renting in pounds and insured in euros
 * has two amounts of money and no third one.
 */
function CostsBeforeClose({ v, reason, monthKey }: {
  v: CostVerdict | null; reason: string | null; monthKey: string;
}) {
  if (!v) return null;

  // Loading is a spinner's worth of information and this panel would be a
  // flicker under the verdict. The five reads above already say the page is
  // still arriving.
  if (v.kind === 'unknown') return null;

  const tone = v.kind === 'gaps' ? 'var(--warn)' : v.kind === 'unread' || v.kind === 'truncated' ? 'var(--crit)' : 'var(--ring)';

  return (
    <section style={{ border: '1px solid var(--ring)', borderLeft: `3px solid ${tone}`, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px' }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>Costs for {monthKey}</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--ink2)', fontSize: 13, maxWidth: '84ch' }}>{v.text}</p>

        {/* The reason, verbatim, where a read did not come back whole. The
            sentence above says what is unknown; this says what the database
            said, which is the half somebody can act on. */}
        {reason && (v.kind === 'unread' || v.kind === 'truncated') ? (
          <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{reason}</div>
        ) : null}

        {v.kind === 'gaps' ? (
          <ul style={{ margin: '10px 0 0', padding: '0 0 0 18px', color: 'var(--ink2)', fontSize: 12.5, lineHeight: 1.7 }}>
            {v.missing.map((x) => (
              <li key={x.key}>
                <strong style={{ color: 'var(--ink)' }}>{x.supplier}</strong>{' '}
                <span style={{ color: 'var(--ink3)' }}>({gymCostCategoryLabel(x.category)})</span>
                {' — paid in '}{x.monthsSeen} of the last {x.lookback} months
                {/* `money` withholds rather than guessing at a currency, and
                    `usual` is already null wherever the sightings disagreed
                    about one. Nothing here is added to anything else. */}
                {x.usual ? <>, last at <span className="mono">{money(x.usual.cents, x.usual.currency)}</span></> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Counted, and said, rather than silently folded into the judgement. A
            cost with no payee cannot be told apart from any other in its
            category, so it can neither be a regular supplier nor evidence that
            one was paid — and an owner whose ledger is mostly unnamed rows
            should know that this check is looking at almost none of it. */}
        {v.unnamed ? (
          <p style={{ margin: '8px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>
            {v.unnamed} of the {v.entered} cost{v.entered === 1 ? '' : 's'} recorded this month
            {v.unnamed === 1 ? ' has' : ' have'} no supplier on {v.unnamed === 1 ? 'it' : 'them'}, so
            nothing above is said about {v.unnamed === 1 ? 'it' : 'them'} either way.
          </p>
        ) : null}

        <p style={{ margin: '10px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>
          Closing {monthKey} refuses every cost dated inside it until the month is reopened with a
          reason. Nothing here is subtracted from what the gym took, and nothing on this page is
          computed from a cost. Enter what is missing on{' '}
          <a href="/costs" style={{ color: 'var(--brand)' }}>Costs</a> first if it belongs in this
          month.
        </p>
      </div>
    </section>
  );
}

function stateNote(s: Slice<unknown>, what: string): string {
  // Four arms via `sliceNote`, and the `??` keeps the 'ready' wording exactly
  // what it was. The arm that mattered is the fourth: a truncated read used to
  // fall into `reading …` and tell an accountant the month was still loading.
  return sliceNote(s, what) ?? `reading ${what}…`;
}

/**
 * A section body that cannot lie about which of the three states it is in.
 * Same shape as the Members screen: loading says loading, failed says what
 * broke and what is therefore unknown, ready hands over to the table.
 */
function Part<T>({ slice, what, children }: {
  slice: Slice<T>; what: string; children: React.ReactNode;
}) {
  return (
    <>
      {slice.state === 'loading' ? <Loading /> : null}
      {slice.state === 'failed' ? <Failed reason={slice.reason} what={what} /> : null}
      {slice.state === 'partial' ? <Truncated what={what} cap={slice.cap} /> : null}
      {slice.state === 'ready' ? children : null}
    </>
  );
}

/**
 * The banner over a section whose read came back at its ceiling.
 *
 * Neither the failure banner nor the empty sentence: the rows are real and
 * there are more of them. It does not draw the table beneath it, because every
 * figure on this screen comes through `rowsOf`, which is null for a truncated
 * read on purpose — an empty table under a "cut off" heading is a worse page
 * than the heading alone. On a month-end screen this is the one that matters
 * most: a prefix of the month's payments is a smaller month, and the accountant
 * has no way to see that from a number.
 */
function Truncated({ what, cap }: { what: string; cap: number }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--warn)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Read the first {cap} rows of {what}, and there are more. This section is a{' '}
      <strong>prefix</strong>, not the whole month, so no figure is totalled over it and no
      month may be closed on it.
    </div>
  );
}

function Failed({ reason, what, cost }: { reason: string; what: string; cost?: string }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {what}. This section is <strong>unknown</strong>, not empty
      {cost ? <> — {cost}</> : null}. No month is closed over it.
      <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{reason}</div>
    </div>
  );
}

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

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

