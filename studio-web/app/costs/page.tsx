'use client';

// Costs — the outgoing half of the gym's books, which this product did not have.
//
// This database records every penny a gym takes and one kind of penny it
// spends. `gym_payments` is money in, `gym_invoices` is money billed,
// `payroll_settlements` is money handed to trainers for sessions delivered —
// and that is the whole of the outgoing side. /accounting's "Money out" reads
// the settlements and says so on its face.
//
// So the rent was nowhere. Nor the electricity, which for a building full of
// treadmills is the second-largest line of the year; nor water, waste, the
// cleaner, the engineer who services the plate-loaded kit, the music licence,
// the insurance, the accountant, the stock in the fridge, or the receptionist —
// who is not a trainer, is not paid per session, and therefore never appears in
// payroll at all.
//
// The only outgoing figure this product held was one an owner typed into
// `app/(owner)/financials.tsx` under the label "Total Expenses / Mo", stored in
// the AsyncStorage key `repple.owner.financials`. One key, on one phone, no
// row, no currency of its own, no history — and every rule in
// src/lib/finReview.ts was scored against it.
//
// ── THE FIGURE THIS SCREEN REFUSES TO PRODUCE ──────────────────────────────
//
// There is no profit here and there is no net anywhere in this app.
//
// /accounting already prints "Cash recorded in Repple" — payments less payroll —
// under a paragraph explaining at length that Repple has never seen rent,
// stock, utilities, insurance, tax or equipment. Now that some of that IS in
// the database the obvious next edit is to fold it in and call the answer
// profit, and it would be wrong for five independent reasons: the takings are
// gross of the card processor's fee, the takings are only what somebody entered
// at the desk, this side is only what somebody typed, trainer pay is in a
// different table again, and any of it can be in a different currency this app
// holds no rate for. `GYM_COSTS_ARE_NEVER_NETTED` says so on the screen,
// because the absence of a figure reads as an omission unless somebody states
// that it was a decision.
//
// ── And no total across currencies ─────────────────────────────────────────
//
// One figure per currency, always, even for the gyms that have only ever used
// one. `gymCostsTaken` returns pots and this page renders them; there is no
// code path here that adds two.
//
// The reads are the dangerous part, as everywhere: supabase-js RESOLVES on a
// database error, so a missing `.error` check turns a refused query into a
// month in which the gym spent nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate, Loading } from '@/components/Gate';
import { type Unread, type Read, reading, landed } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { Banner, Announce } from '@/components/Banner';
import { DataTable, type Column } from '@/components/DataTable';
import { money } from '@lib/gymRecord';
import { readMinorAmount, majorFromMinor, type Taken } from '@lib/coachMoney';
// The sign on a movement, from the one module that has an arm for zero. A
// hand-rolled `x > 0 ? '+' : ''` has no answer for a category exactly on its
// budget except to print the figure as though it had moved.
import { deltaSign } from '@lib/deltaLabel';
import { gymLink, noGymNote } from '@lib/gymLink';
import { monthWindow, monthKeyOf, type MonthWindow } from '@lib/monthEnd';
// The months this gym has had, on the GYM's calendar.
//
// The bounds on this screen need no zone and are left alone: `fetchGymCosts` is
// filtered on `mw.firstDay`/`mw.lastDay` against `gym_costs.paid_on`, a `date`
// column, and the days of August are August's wherever they are read. What DID
// need one is the list of months offered. The default key below follows
// `gymDay(Date.now(), zone)`, and a list built from `recentMonths` follows the
// reader — so a <select> whose value is not among its children shows the wrong
// row selected while `key` says otherwise. Same clock for the value and for the
// list, or neither can be trusted.
// `monthsBefore` steps back from a NAMED month by arithmetic on the two integers
// in its key, so every key in the list below is on the same calendar as the
// first one. See the note on the picker for why the first one may not come from
// an instant this device chose.
// `standingCosts` is the detector the Close screen already runs over this same
// ledger — three of the last six months, including the most recent month on
// record. It is read here so the gym's own history can become a template in one
// press rather than being retyped out of somebody's memory, and it is the same
// function on both screens so the two can never disagree about what a standing
// line is. See src/lib/recurringCosts.ts for why a derived line and a typed
// template are both needed and neither is enough.
import {
  monthsBefore, standingCosts, COST_LOOKBACK_MONTHS, type StandingCost,
} from '@lib/closeCosts';
import { useMonthTick } from '@/lib/monthTick';
import { isoDate } from '@lib/format';
import { gymDay, NO_ZONE_NOTE } from '@lib/gymZone';
import { toCsv } from '@lib/gymExport';
import {
  fetchGymCosts, recordGymCost, deleteGymCost,
  gymCostBlockers, gymCostsTaken, gymCostsByCategory, gymCostsEmptyLine,
  gymCostCategoryLabel, GYM_COST_CATEGORIES,
  GYM_COSTS_ARE_YOUR_WORD, GYM_COSTS_ARE_NEVER_NETTED,
  GYM_COSTS_ARE_NOT_TAX_ADVICE, GYM_COSTS_NOT_TWICE,
  type GymCost, type GymCostCategory, type GymCostPot,
} from '@lib/gymCosts';
import {
  fetchCostTemplates, createCostTemplate, updateCostTemplate,
  endCostTemplate, deleteCostTemplate,
  templateBlockers, templatesEmptyLine, reviewTemplates, standingNote,
  carryForward, untemplatedStanding, suggestedDay,
  TEMPLATES_NEVER_POST, CARRIED_IS_NOT_INCURRED,
  type CostTemplate, type CostTemplateDraft, type TemplateReview, type CarriedCost,
} from '@lib/recurringCosts';
import {
  fetchCostBudgets, createCostBudget, endCostBudget, deleteCostBudget,
  budgetBlockers, budgetsEmptyLine, budgetReview, budgetFor, budgetNote,
  BUDGET_IS_TYPED_NOT_MEASURED, NO_VARIANCE_WITHOUT_BOTH_SIDES,
  type CostBudget, type CostBudgetDraft, type BudgetLine,
} from '@lib/costBudgets';
// The two questions every small-business finance console answers before any of
// the three this screen already did: who are we paying, and is this category
// moving. Both are read out of the SAME six complete months `standingCosts`
// judges over, which are already on this screen — see the header of
// src/lib/costTrend.ts for what was missing and why nothing here is summed
// across two currencies.
import {
  supplierSpend, categoryTrend, trendNote, unnamedPayeeNote,
  type TrendLine, type SupplierLine,
} from '@lib/costTrend';
import { readTenant, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { saveText } from '@/lib/save';

/** How far back the picker offers. Thirteen so last year's same month is there. */
const MONTHS_OFFERED = 13;

/**
 * What a read is when it holds no rows: still in flight, refused, or returned.
 *
 * The same three states /accounting keeps apart, for the same reason. "No costs
 * recorded in August" over a query that errored is a sentence about a gym's
 * spending made out of a failure, and this is a screen somebody exports.
 */

/**
 * The three reads this screen makes, and the month all three were made for.
 *
 * Held together rather than in three `useState`s so the month stamp on them
 * cannot get out of step. `loaded.key !== key` throws away all three at once,
 * which is what stops August's standing suppliers being suggested under a
 * September heading for one frame.
 */
interface Loaded {
  key: string;
  /** Costs dated inside the month on screen. */
  costs: Read<GymCost>;
  /** Every standing arrangement this gym has, running or ended. */
  templates: Read<CostTemplate>;
  /** Costs dated in the complete months BEFORE it — what `standingCosts`
   *  judges from. A month cannot be evidence for a judgement about itself, so
   *  the month on screen is never in this window. */
  past: Read<GymCost>;
  /** Every budget this gym has ever set, in force or superseded. All of them,
   *  because `budgetFor` picks the one that applies to the month on screen and
   *  a list filtered to "current" would answer the wrong question the moment
   *  somebody opens a month from before the last revision. */
  budgets: Read<CostBudget>;
}

/**
 * The day range of the `COST_LOOKBACK_MONTHS` complete months before `key`.
 *
 * Built from `monthsBefore`, which steps back from a NAMED month by arithmetic
 * on the two integers in its key — never through a Date, because a DATE parsed
 * as an instant is midnight UTC and therefore the previous month west of
 * Greenwich. The window this returns and the month list `standingCosts` is
 * given below come from that same call, so the read and the judgement cannot
 * disagree about which months were looked at.
 */
function lookBack(key: string): { firstDay: string; lastDay: string; months: string[] } | null {
  const months = monthsBefore(key, COST_LOOKBACK_MONTHS);
  if (!months.length) return null;
  // Newest first out of `monthsBefore`, so the oldest is the last one.
  const newest = monthWindow(months[0]);
  const oldest = monthWindow(months[months.length - 1]);
  if (!newest || !oldest) return null;
  return { firstDay: oldest.firstDay, lastDay: newest.lastDay, months };
}

/* ── the screen ────────────────────────────────────────────────────────────── */

export default function Costs() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameUnread, setGymNameUnread] = useState(false);
  const [tenantErr, setTenantErr] = useState<string | null>(null);
  // `tenants.currency`. A cost cannot be recorded without one: part 700 makes
  // the column NOT NULL with no default, and a figure with the wrong three
  // letters on it is a different amount of money.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);

  // Opens on the month RUNNING, which is the opposite of /accounting and is
  // deliberate. That screen is read after a month has stopped moving; this one
  // is written as the money goes out, and defaulting it to last month would
  // have somebody record today's rent into August.
  //
  // Running FOR THE GYM. This was `useState(() => monthKeyOf())`, which is the
  // month on the laptop that opened the tab — so on the first and last day of a
  // month it disagrees with the gym: a cost entered at 09:00 on 1 September in
  // Auckland was offered August by default, and a bookkeeper in London filing
  // an Auckland gym's costs late on the 31st was offered the month after.
  //
  // Null means "the owner has not chosen", so the default follows the gym's own
  // day as soon as the zone read lands rather than being frozen at mount. The
  // browser's month is the fallback and only the fallback: a gym with no zone
  // set has nothing better, and the note under the picker says so.
  const [picked, setPicked] = useState<string | null>(null);
  const gymToday = gymDay(Date.now(), zone);
  /** The month RUNNING at the gym, or the reader's where no zone is set. The
   *  select's default value AND the head of the select's own option list — one
   *  derivation, so the two cannot name different months. */
  const monthNow = gymToday ? gymToday.slice(0, 7) : monthKeyOf();
  const key = picked ?? monthNow;
  const setKey = setPicked;
  const w = useMemo(() => monthWindow(key), [key]);

  // Stored WITH the month it was read for, and used only when the two agree.
  // Without that, switching from August to September paints one frame of
  // August's costs under a September heading.
  //
  // Three reads, kept in one record for that reason: the month's costs, the
  // gym's standing arrangements, and the six complete months BEFORE the one on
  // screen. The third is what `standingCosts` judges from and it is dated by
  // the month it was taken for, exactly as the first is — a look-back read left
  // over from August would suggest August's suppliers under a September
  // heading, which is the same defect one field along.
  const [loaded, setLoaded] = useState<Loaded>({
    key: '', costs: reading(), templates: reading(), past: reading(), budgets: reading(),
  });

  const load = useCallback(async (tenantId: string, mw: MonthWindow): Promise<boolean> => {
    setLoaded({ key: '', costs: reading(), templates: reading(), past: reading(), budgets: reading() });
    const back = lookBack(mw.key);
    // `allSettled` and not `all`. One refused read must not blank the other
    // two: a gym whose template read is refused still has a month's costs, and
    // a screen that showed nothing would say this gym spent nothing.
    const [costs, templates, past, budgets] = await Promise.allSettled([
      fetchGymCosts(supabase, tenantId, mw.firstDay, mw.lastDay),
      fetchCostTemplates(supabase, tenantId),
      back
        ? fetchGymCosts(supabase, tenantId, back.firstDay, back.lastDay)
        // A gym looking at a month this console cannot build a look-back for
        // has no history to suggest from, which is a real and empty answer —
        // not a failure, and not a reason to tell it the read broke.
        : Promise.resolve<GymCost[]>([]),
      fetchCostBudgets(supabase, tenantId),
    ]);
    setLoaded({
      key: mw.key,
      costs: landed(costs, 'the recorded costs'),
      templates: landed(templates, 'this gym’s standing arrangements'),
      past: landed(past, 'the months before this one'),
      budgets: landed(budgets, 'this gym’s cost budgets'),
    });
    // A landing only when ALL THREE came back. The stamp under the heading is a
    // claim that what is on screen is current, and two thirds of a screen is
    // not. The banners say which one is missing.
    return costs.status === 'fulfilled'
      && templates.status === 'fulfilled'
      && past.status === 'fulfilled'
      && budgets.status === 'fulfilled';
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
      // `{ rows: [], state: null, why: null }` is a read that RAN and found
      // nothing, and this screen renders that as "No cost is recorded in
      // August" over a query nobody ever sent. An account with no gym on it
      // gets a sentence below instead, before any figure.
      const link = gymLink(who?.tenantId, 'recorded costs');
      if (!link.linked) return;
      const t = await readTenant(supabase, link.tenantId);
      if (!live) return;
      setGymName(t.name);
      setCcy(t.currency);
      setZone(t.zone);
      setGymNameUnread(!!t.error);
      setTenantErr(t.error);
    })();
    return () => { live = false; };
    // Identity and the gym record only. The month's costs are read by the
    // effect below, through `refresh`. They shared one effect keyed on the
    // month, so choosing a different month also re-read the gym's name,
    // currency and timezone — three facts that cannot have changed.
  }, []);

  /**
   * The chosen month's costs, kept current and dated.
   *
   * This is a book somebody else at the gym is also writing into: a manager
   * enters the engineer's invoice while the owner has August open on the office
   * machine, and until now the owner's screen answered about whenever their tab
   * was opened without saying when that was — under a total they were about to
   * take into a month close.
   */
  const { at: readAt, busy: reading_, refresh } = useFetched(
    () => (me?.tenantId && w ? load(me.tenantId, w) : Promise.resolve(false)),
  );

  /**
   * The calendar month it is NOW — which is not the same question as when this
   * screen last read.
   *
   * The picker below is keyed on this and on nothing else. It has to gain
   * October at midnight on the 1st whether or not anything has been read since,
   * and it must not be rebuilt by anything else: the read is fired by an effect
   * keyed on the chosen period, so a picker rebuilt by every read would be a
   * loop rather than a refresh. `useMonthTick` re-renders this screen exactly
   * once a month and never otherwise — see studio-web/lib/monthTick.ts.
   */
  const tick = useMonthTick();

  /**
   * The periods this screen offers — built once a MONTH, not once a mount.
   *
   * This was keyed on `[]`, and neither clock gate could see it:
   * `check-frozen-day` looks for a clock read on the line, and the clock is a
   * `now = Date.now()` default one file away; `check-frozen-hook` follows
   * exactly those defaults but skips empty dependency lists, which are the other
   * gate's rule. So the newest period this picker offered was the one the tab
   * was OPENED in. The console has no router — the rail is a plain `<a href>` —
   * so that tab is a document that lives for days, and on the 1st the period
   * that had just ended was not in the list at all. The only repair was the full
   * page reload this console spent a wave learning not to need.
   */
  /*
   * Anchored on `monthNow` — the same string the select's value defaults to —
   * and NOT on an instant.
   *
   * This was `gymRecentMonths(MONTHS_OFFERED, zone, monthTickStart(tick))`, and
   * `monthTickStart(tick)` is local midnight on the first of the READER's
   * current month. Asking which month the GYM was in at that instant answers
   * with the gym's PREVIOUS month for any gym behind the reader — a London gym
   * read from Dubai, all month, not just at a boundary — so the list started one
   * month back from the month the select was already set to and the value was
   * not among its own children. Anchoring the list on the same key the value
   * comes from is the only way the two can agree by construction.
   *
   * `tick` stays in the dependency list because it is what re-renders this
   * screen when the calendar month turns over; it no longer decides which
   * months are in the list.
   */
  const months = useMemo(
    () => [monthNow, ...monthsBefore(monthNow, MONTHS_OFFERED - 1)],
    [monthNow, tick],
  );

  useEffect(() => {
    if (me?.tenantId && w) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId, key]);

  // All three, or none of them. A mixture would pair this month's costs with
  // last month's templates for one frame, and the pairing is exactly what the
  // "already recorded / still due" verdict is made of.
  const fresh = loaded.key === key;
  const costs = fresh ? loaded.costs : reading<GymCost>();
  const templates = fresh ? loaded.templates : reading<CostTemplate>();
  const past = fresh ? loaded.past : reading<GymCost>();
  const budgets = fresh ? loaded.budgets : reading<CostBudget>();

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/costs">
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
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/costs">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          What the gym pays in rent, what it pays the people who clean it and what
          it settles with its accountant are the owner&rsquo;s books. The database
          refuses this read independently, so this is not the only thing standing
          between you and it.
        </p>
      </Shell>
    );
  }

  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/costs">
        <h1>Costs</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          {noGymNote('recorded costs')}
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/costs">
      <h1>Costs</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '78ch' }}>
        What the gym pays for. Rent, power, water, the cleaner, the engineer, the
        music licence, insurance, stock, the accountant &mdash; none of which reaches
        this app on its own. Nothing here is subtracted from what the gym took, and
        there is no profit figure in this product.
      </p>

      <Fetched at={readAt} busy={reading_} onRefresh={refresh}
               what="this month’s costs, standing arrangements and budgets" style={{ margin: '2px 0 14px' }} />

      {tenantErr ? (
        <Banner tone="crit">
          This account is linked to a gym, but the gym&rsquo;s record could not be read:{' '}
          {tenantErr}. The costs below are scoped by tenant id rather than by name, so
          they are this gym&rsquo;s &mdash; but the currency is unknown until that read
          works, and nothing can be recorded without it.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 4px' }}>
        <select value={key} onChange={(e) => setKey(e.target.value)} style={{ ...field, minWidth: 190 }}
                aria-label="Which month to show">
          {months.map((m) => {
            const mw = monthWindow(m);
            return <option key={m} value={m}>{mw ? mw.label : m}</option>;
          })}
        </select>
        {/* Which clock this screen's "today" came from. The month above and the
            date on the form below are the gym's own day when the gym has said
            what that is, and the reader's when it has not — and a reader has to
            be told which, because on the first and last day of a month the two
            disagree and the disagreement is which month a cost is filed in. */}
        {zone ? null : (
          <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '52ch' }}>{NO_ZONE_NOTE}</span>
        )}
      </div>

      {!w
        ? <Banner tone="crit">{key} is not a month this console can open.</Banner>
        : (
          <Month
            w={w} costs={costs} templates={templates} past={past} budgets={budgets}
            ccy={ccy} zone={zone} gymName={gymName}
            tenantId={me.tenantId ?? null} me={me}
            /* The hook's `refresh`, not a bare `load`: a cost recorded here is
               the one moment this screen is provably current, and re-reading
               without moving the stamp would leave the line under it ageing
               from before the write. */
            onChange={refresh}
          />
        )}
    </Shell>
  );
}

/* ── one month ─────────────────────────────────────────────────────────────── */

function Month({ w, costs, templates, past, budgets, ccy, zone, gymName, tenantId, me, onChange }: {
  w: MonthWindow; costs: Read<GymCost>; templates: Read<CostTemplate>; past: Read<GymCost>;
  budgets: Read<CostBudget>;
  ccy: TenantCurrency; zone: string | null;
  gymName: string | null;
  tenantId: string | null; me: Me; onChange: () => void;
}) {
  const rows = costs.rows ?? [];
  const taken = useMemo(() => gymCostsTaken(rows), [rows]);
  const byCategory = useMemo(() => gymCostsByCategory(rows), [rows]);

  /**
   * What a template put in the form, and how many times it has done so.
   *
   * The counter is the whole mechanism. `Record` seeds its boxes from `seed` at
   * MOUNT, and is keyed on this number — so pressing Fill twice on the same
   * template refills the form both times, which a value-equal prop would not.
   * Seeding at mount rather than through an effect is deliberate: an effect
   * that wrote into the boxes could fire after the owner had started typing
   * over them, and overwrite what they were in the middle of.
   */
  const [seed, setSeed] = useState<{ n: number; filled: CarriedCost } | null>(null);

  return (
    <>
      {costs.why ? <Banner tone="crit">{costs.why}</Banner> : null}

      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '10px 0 0' }}>
        {w.label}, {w.firstDay} to {w.lastDay}, counted by the day the money went out
        rather than the day the line was entered &mdash; so a quarter of receipts written
        up in one evening land in the months they were paid in.
      </p>

      <Totals read={costs} taken={taken} w={w} />

      <Handoff w={w} gymName={gymName} rows={rows} read={costs} byCategory={byCategory} />

      {/* Keyed on the month, so switching the picker remounts the form. Without
          it the date box keeps the day it was seeded with and a half-typed
          August cost stays on screen under a September heading — where the next
          press of Record would file it in the wrong month.

          And keyed on the fill counter, so a template can put its words in the
          boxes — see `seed` above for why that is a remount and not an effect. */}
      <Record
        key={`${w.key}|${seed?.n ?? 0}`} w={w} ccy={ccy} zone={zone}
        tenantId={tenantId} me={me} onChange={onChange} seed={seed?.filled ?? null}
      />

      <Repeats
        w={w} read={templates} monthCosts={costs} past={past} ccy={ccy} zone={zone}
        tenantId={tenantId} me={me} onChange={onChange}
        onFill={(filled) => setSeed((s) => ({ n: (s?.n ?? 0) + 1, filled }))}
      />

      <Ledger read={costs} rows={rows} w={w} onChange={onChange} />

      <Where read={costs} pots={byCategory} w={w} />

      {/* Both read the month AND the look-back this screen already holds, so
          neither costs a round trip. `lookBack` is called once here and the
          same month list goes to both, so the two sections and `Repeats` above
          cannot disagree about which months were looked at. */}
      <Trend w={w} costs={costs} past={past} months={lookBack(w.key)?.months ?? []} />

      <WhoWePay w={w} costs={costs} past={past} months={lookBack(w.key)?.months ?? []} />

      <Budgets
        w={w} read={budgets} monthCosts={costs} ccy={ccy} zone={zone}
        tenantId={tenantId} me={me} onChange={onChange}
      />

      <Section
        title="What this is, and what it is not"
        sub="Three sentences that belong beside the figures rather than in a help page."
      >
        <div style={{ padding: '14px', display: 'grid', gap: 12, color: 'var(--ink2)', fontSize: 13, maxWidth: '84ch' }}>
          <p style={{ margin: 0 }}>{GYM_COSTS_ARE_YOUR_WORD}</p>
          <p style={{ margin: 0 }}><strong>Nothing here is netted.</strong> {GYM_COSTS_ARE_NEVER_NETTED}</p>
          <p style={{ margin: 0 }}><strong>This is not a tax record.</strong> {GYM_COSTS_ARE_NOT_TAX_ADVICE}</p>
        </div>
      </Section>
    </>
  );
}

/* ── what went out, one figure per currency ────────────────────────────────── */

/**
 * The month's outgoings, per currency, and never as one number.
 *
 * A gym with one currency sees exactly the one figure it would have seen. A gym
 * with two sees two, side by side, because GBP 4,500 and EUR 900 are not 5,400
 * of anything and this app holds no rate to make them one.
 */
function Totals({ read, taken, w }: { read: Read<GymCost>; taken: Taken; w: MonthWindow }) {
  if (read.state) {
    return (
      <div style={grid}>
        <Kpi
          label="Out this month"
          text={null}
          note={read.state === 'loading' ? 'reading the ledger…' : 'the ledger could not be read, so this is unknown rather than nothing'}
        />
      </div>
    );
  }

  if (!taken.pots.length) {
    return (
      <div style={grid}>
        <Kpi label="Out this month" text={null} note={`nothing is recorded as paid in ${w.label}`} />
      </div>
    );
  }

  return (
    <>
      <div style={grid}>
        {taken.pots.map((p) => (
          <Kpi
            key={p.currency}
            label={`Out this month · ${p.currency}`}
            text={money(p.minorUnits, p.currency)}
            note={`${p.count} cost${p.count === 1 ? '' : 's'}`}
          />
        ))}
      </div>
      {taken.unlabelled || taken.unpriced ? (
        <Banner tone="crit">
          {taken.unlabelled ? (
            <>{taken.unlabelled} cost{taken.unlabelled === 1 ? '' : 's'} carr{taken.unlabelled === 1 ? 'ies' : 'y'} no
            currency, so {taken.unlabelled === 1 ? 'it is' : 'they are'} counted out of the
            figures above rather than added to a currency nobody stated. </>
          ) : null}
          {taken.unpriced ? (
            <>{taken.unpriced} cost{taken.unpriced === 1 ? '' : 's'} carr{taken.unpriced === 1 ? 'ies' : 'y'} no
            amount at all, so the totals are short by exactly {taken.unpriced === 1 ? 'that line' : 'those lines'}. </>
          ) : null}
          Neither is a zero.
        </Banner>
      ) : null}
    </>
  );
}

/* ── recording one ─────────────────────────────────────────────────────────── */

function Record({ w, ccy, zone, tenantId, me, onChange, seed }: {
  w: MonthWindow; ccy: TenantCurrency; zone: string | null;
  tenantId: string | null; me: Me; onChange: () => void;
  /** What a standing arrangement put in these boxes, or null when nobody has.
   *  Read once, at mount — this component is remounted on every fill, see the
   *  `key` at the call site. It is TEXT and nothing more: no cost exists until
   *  the owner presses Record below, which is the whole discipline of
   *  src/lib/recurringCosts.ts. */
  seed: CarriedCost | null;
}) {
  // Today, unless today is outside the month being looked at — in which case
  // the last day of that month, so somebody entering August's rent in September
  // is not silently given a September date on a screen headed August.
  //
  // The GYM's today. `isoDate(new Date())` is the reader's calendar, and this
  // date goes onto a permanent ledger row that /accounting and /close bucket by
  // month: a cost paid at 09:00 on the 1st in Auckland must not be filed on the
  // 31st because the person entering it is in London. Where the gym has no
  // zone there is nothing better than the reader's day, and it is used —
  // stating a wrong zone is worse than using the only clock there is.
  const today = gymDay(Date.now(), zone) ?? isoDate(new Date());
  const initialDay = today >= w.firstDay && today <= w.lastDay ? today : w.lastDay;

  // Seeded from the template where one filled the form, and from nothing where
  // none did. The date is the one field a template is allowed NOT to answer:
  // `paidOn` is null when the arrangement states no day of the month, and the
  // box keeps the month's own default rather than being given a date nobody
  // chose — which would then go onto a permanent ledger row.
  const [description, setDescription] = useState(seed?.description ?? '');
  const [supplier, setSupplier] = useState(seed?.supplier ?? '');
  const [category, setCategory] = useState<GymCostCategory>(seed?.category ?? 'rent');
  const [amountText, setAmountText] = useState(seed?.amountText ?? '');
  /**
   * The day the money went out — null meaning "nobody has chosen", so the box
   * FOLLOWS the gym's day rather than being frozen at the reader's.
   *
   * `useState(...initialDay)` ran its initialiser once, at mount, and this form
   * mounts before the zone is known: the effect above does `setMe(who)` and
   * only then awaits `readTenant`, so React has already painted with `zone ===
   * null` — where `gymDay` returns null and `today` is the reader's own
   * calendar. The `key` on this component is the month and the fill counter, so
   * a zone landing inside the same month does not remount it, and the gym's-day
   * repair on `today` above therefore never reached the value in the box except
   * on the two days a month where the zone also changes which month it is.
   *
   * A London bookkeeper filing an Auckland gym's costs at 22:00 on the 13th was
   * offered the 13th for money that went out on the 14th — same month, so
   * nothing moved between months, and a permanent ledger row is still dated a
   * day before the payment.
   *
   * The template's day still wins where it stated one, which is a choice made
   * by the arrangement rather than by a clock; where it stated none, `null`
   * falls through to the month's own default exactly as before.
   */
  const [pickedDay, setPickedDay] = useState<string | null>(seed?.paidOn ?? null);
  const paidOn = pickedDay ?? initialDay;
  const setPaidOn = setPickedDay;
  const [note, setNote] = useState(seed?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const draft = { description, supplier, category, amountText, currency: ccy, paidOn, note };
  const blockers = gymCostBlockers(draft);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(null);
    if (blockers.length) { setWriteErr(blockers[0]); return; }
    if (!tenantId || !ccy) return;
    // Read once, by the same reader the blockers used. Two readers over one box
    // is how an amount comes to be shown as one figure and stored as another.
    // NOT a charge — money that has already left the gym's account — and the
    // same setting `gymCostBlockers` read it with above. Two readers over one
    // box disagreeing about a Kuwaiti amount is the shape this pairing avoids.
    const amt = readMinorAmount(amountText, ccy, false);
    if (!amt.ok) { setWriteErr(amt.reason); return; }

    setBusy(true); setWriteErr(null);
    try {
      await recordGymCost(supabase, tenantId, {
        recordedBy: me.id,
        description,
        supplier,
        category,
        amountCents: amt.minorUnits,
        currency: ccy,
        paidOn,
        note,
      });
      setSaved(`Recorded: ${description.trim()}, paid ${paidOn}.`);
      setDescription(''); setSupplier(''); setAmountText(''); setNote('');
      onChange();
    } catch (e: any) {
      setWriteErr(`That cost was NOT recorded: ${e?.message ?? 'the write was refused'}. Nothing has been added to the ledger.`);
    } finally { setBusy(false); }
  };

  const chosen = GYM_COST_CATEGORIES.find((c) => c.id === category);

  return (
    <Section
      title="Record a cost"
      sub="One line per payment, dated the day the money went out. There is no edit: correcting a line is removing it and writing the right one, and the removal is logged."
    >
      <Announce say={writeErr ?? saved} tone={writeErr ? 'crit' : undefined} />

      {/* Only when a template filled this in, and it says two things: that the
          figure is last time's figure, and — where anything was held back — what
          was held back and why. The second is the important one: a template in
          a currency this gym does not record in leaves the amount box EMPTY,
          and an empty box with no sentence beside it reads as a bug rather than
          as a refusal to convert money at a rate this product does not hold. */}
      {seed ? (
        <>
          {/* Announced separately from the write result above, because the boxes
              changing under a screen reader with nothing said is the whole of
              what happened from their side. */}
          <Announce say={`The form has been filled in from a standing arrangement: ${seed.description}.${seed.withheld ? ` ${seed.withheld}` : ''}`} />
          <div style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--ink2)', maxWidth: '84ch' }}>
            <p style={{ margin: '12px 0 0' }}>{CARRIED_IS_NOT_INCURRED}</p>
            {seed.withheld ? (
              <p style={{ margin: '8px 0 0', color: 'var(--warn)' }}>{seed.withheld}</p>
            ) : null}
            {seed.paidOn === null ? (
              <p style={{ margin: '8px 0 0', color: 'var(--ink3)' }}>
                That arrangement does not say which day of the month it goes out on, so the
                date box has been left on this month&rsquo;s default rather than given a day
                nobody chose. Set it to the day the money actually left.
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <form onSubmit={submit} style={formRow}>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
               placeholder="What it was for" style={{ ...field, flex: 2, minWidth: 190 }}
               aria-label="What this cost was for" />
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
               placeholder="Who it was paid to (optional)" style={{ ...field, flex: 2, minWidth: 180 }}
               aria-label="Who this was paid to" />
        <select value={category} onChange={(e) => setCategory(e.target.value as GymCostCategory)}
                style={{ ...field, minWidth: 200 }} aria-label="What kind of cost this was">
          {GYM_COST_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal"
               placeholder={ccy ? `Amount (${ccy})` : 'Amount'} style={{ ...field, width: 150 }}
               aria-label="How much went out" />
        <label style={dateLabel}>
          paid
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)}
                 style={{ ...field, width: 148 }} aria-label="The day the money went out" />
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
               style={{ ...field, flex: 2, minWidth: 160 }} aria-label="A note about this cost" />
        <button type="submit" disabled={busy || !!blockers.length} style={primaryBtn}>Record</button>
      </form>

      {chosen ? (
        <p style={{ margin: '0 14px 10px', fontSize: 12, color: 'var(--ink3)', maxWidth: '78ch' }}>
          <span className="mono">{chosen.label}</span> &mdash; {chosen.note}
        </p>
      ) : null}

      <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '80ch' }}>
        {GYM_COSTS_NOT_TWICE}
      </p>

      {!ccy ? (
        <Banner>
          Costs cannot be recorded until this gym sets its currency &mdash; {NO_CURRENCY_NOTE}. There
          is no default here that would be right for half the gyms running Repple, and a figure
          with the wrong three letters on it is a different amount of money. Set it on{' '}
          <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a>.
        </Banner>
      ) : null}
      {blockers.length && !writeErr && (description || amountText) ? (
        <ul style={{ margin: '0 14px 12px', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn)', maxWidth: '78ch' }}>
          {blockers.map((b) => <li key={b} style={{ marginBottom: 4 }}>{b}</li>)}
        </ul>
      ) : null}
      {writeErr ? <Banner tone="crit" live={false}>{writeErr}</Banner> : null}
      {saved ? <Banner live={false}>{saved}</Banner> : null}
    </Section>
  );
}

/* ── what repeats ──────────────────────────────────────────────────────────── */

/**
 * How a `Read` stands, in the vocabulary the pure rules speak.
 *
 * Four states in `LoadStatus` and three in `Unread`, and the missing one is
 * 'partial' — which cannot reach this screen, because `fetchGymCosts` and
 * `fetchCostTemplates` both run their rows through `assertWhole` and a
 * truncated read arrives here as a rejection. So 'ready' here really is whole,
 * and `reviewTemplates` is entitled to make a claim from it.
 */
function readStatus(read: Read<unknown>) {
  if (read.state === 'loading') return 'loading' as const;
  if (read.state === 'failed') return 'error' as const;
  return 'ready' as const;
}

/**
 * The standing arrangements, and what each one's position is in this month.
 *
 * ── Why there is no "monthly commitment" figure here ───────────────────────
 *
 * It is the obvious thing to put at the top of this section and it would be a
 * number about nothing. Some templates hold no amount at all, on purpose,
 * because the bill varies; the ones that do can be in different currencies; and
 * a template is not a payment, so a total of them is a total of intentions. It
 * would sit two sections above a real figure for what actually went out, look
 * exactly like it, and be neither a subset nor a superset of it.
 */
function Repeats({ w, read, monthCosts, past, ccy, zone, tenantId, me, onChange, onFill }: {
  w: MonthWindow; read: Read<CostTemplate>; monthCosts: Read<GymCost>; past: Read<GymCost>;
  ccy: TenantCurrency; zone: string | null;
  tenantId: string | null; me: Me; onChange: () => void;
  onFill: (filled: CarriedCost) => void;
}) {
  const templates = useMemo(() => read.rows ?? [], [read.rows]);

  // The month's own costs decide "already recorded / still due", and the STATUS
  // decides whether that question may be answered at all. A prefix of the
  // month's ledger would make every line past the cap look missing, and this
  // section would then tell an owner their rent is not in — on the screen they
  // are about to close the month from.
  const reviews = useMemo(
    () => reviewTemplates(templates, monthCosts.rows ?? [], w.key, readStatus(monthCosts)),
    [templates, monthCosts, w.key],
  );

  /** The look-back window, and the months in it, from one call — so the read
   *  that fetched those months and the judgement made over them cannot
   *  disagree about which months were looked at. */
  const back = useMemo(() => lookBack(w.key), [w.key]);

  /**
   * Suppliers this gym's own ledger already shows it pays every month, with no
   * template set up for them.
   *
   * Computed ONLY over a whole look-back read. Over a refused or truncated one
   * this is empty and the section says why — "we found no standing suppliers"
   * built out of a failed query is an invitation to set up nothing.
   */
  const suggestions = useMemo(() => {
    if (past.state !== null || !back) return [];
    return untemplatedStanding(standingCosts(past.rows ?? [], back.months), templates);
  }, [past, back, templates]);

  /** The template being edited, or null while the form is creating a new one. */
  const [editing, setEditing] = useState<CostTemplate | null>(null);
  /** A draft the form should open with, plus a counter so pressing the same
   *  suggestion twice re-seeds it. Same mechanism, and same reason, as `seed`
   *  on the cost form above. */
  const [openWith, setOpenWith] = useState<{ n: number; draft: Partial<CostTemplateDraft> } | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  // The GYM's today, for the day an arrangement is recorded as having ended —
  // the same clock the cost form uses and for the same reason. Where the gym
  // has stated no zone there is nothing better than the reader's day, and the
  // note under the month picker says so.
  const today = gymDay(Date.now(), zone) ?? isoDate(new Date());

  const fill = (t: CostTemplate) => {
    setActErr(null); setSaid(null);
    const carried = carryForward(t, w.key, ccy);
    if (!carried.ok) { setActErr(carried.why); return; }
    onFill(carried.filled);
    setSaid(`The cost form above has been filled in from ${t.description}. Nothing has been recorded — check it and press Record.`);
  };

  const end = (t: CostTemplate) => {
    if (!confirm(
      `Record that "${t.description}" stopped on ${today}? It stays in this list, marked as ended, `
      + 'so the months it did run in still make sense — and it stops being offered for months after that day. '
      + 'No cost already recorded from it changes.',
    )) return;
    setActErr(null); setSaid(null);
    endCostTemplate(supabase, t.id, today)
      .then(() => { setSaid(`${t.description} is recorded as having ended on ${today}.`); onChange(); })
      .catch((e: any) => setActErr(
        `That arrangement was NOT ended: ${e?.message ?? 'the write was refused'}. It is still running and still being offered.`));
  };

  const remove = (t: CostTemplate) => {
    if (!confirm(
      `Remove the standing arrangement "${t.description}"? No cost is affected — every line already recorded from it was typed by a person and stays exactly where it is. `
      + 'If this arrangement simply stopped, End it instead: a removed one says this gym never had this supplier.',
    )) return;
    setActErr(null); setSaid(null);
    deleteCostTemplate(supabase, t.id)
      .then(() => { setSaid(`${t.description} has been removed from the standing arrangements.`); onChange(); })
      .catch((e: any) => setActErr(
        `That arrangement was NOT removed: ${e?.message ?? 'the delete was refused'}. It is still in the list.`));
  };

  const cols: Column<TemplateReview>[] = [
    { key: 'what', header: 'What for', value: (r) => r.template.description },
    { key: 'supplier', header: 'Paid to', value: (r) => r.template.supplier,
      render: (r) => r.template.supplier ?? <span className="dash">not stated</span> },
    { key: 'category', header: 'Category', value: (r) => gymCostCategoryLabel(r.template.category) },
    { key: 'usual', header: 'Usually', value: (r) => r.template.amountCents, numeric: true,
      // `money` withholds where the currency is null, and a template with no
      // usual amount prints the reason rather than a zero: "0.00" beside a
      // supplier is a statement that they are free.
      render: (r) => (r.template.amountCents == null || !r.template.currency
        ? <span className="dash">varies</span>
        : <>{money(r.template.amountCents, r.template.currency)}</>) },
    { key: 'due', header: 'Usually on', value: (r) => r.template.dueDay, numeric: true,
      render: (r) => {
        const day = suggestedDay(r.template, w.key);
        return day ? <>{day}</> : <span className="dash">no fixed day</span>;
      } },
    { key: 'standing', header: `In ${w.label}?`, value: (r) => r.standing,
      render: (r) => <span style={{ color: standingInk(r.standing) }}>{standingNote(r, w.label)}</span> },
    { key: 'act', header: '', value: () => '', align: 'right',
      render: (r) => (
        <span className="no-print" style={{ display: 'inline-flex', gap: 10, whiteSpace: 'nowrap' }}>
          {/* Offered for every arrangement that was RUNNING in this month,
              including one already recorded — a gym can pay a supplier twice in
              a month and the screen is not the judge of that. `carryForward`
              refuses the two months it must, and says why. */}
          {r.standing === 'not-yet' || r.standing === 'ended' ? null : (
            <button onClick={() => fill(r.template)} style={linkBtn}
                    aria-label={`Fill the cost form from ${r.template.description}`}>
              fill the form
            </button>
          )}
          <button onClick={() => { setEditing(r.template); setOpenWith(null); }} style={linkBtn}
                  aria-label={`Change what ${r.template.description} says`}>
            edit
          </button>
          {r.template.endsOn ? null : (
            <button onClick={() => end(r.template)} style={linkBtn}
                    aria-label={`Record that ${r.template.description} has stopped`}>
              ended
            </button>
          )}
          <button onClick={() => remove(r.template)} style={linkBtn}
                  aria-label={`Remove the standing arrangement ${r.template.description}`}>
            remove
          </button>
        </span>
      ) },
  ];

  return (
    <Section
      title="Repeats every month"
      sub="The landlord, the power, the cleaner, the music licence, the accountant — set each one up once and fill the form above with one press instead of retyping it twelve times a year."
    >
      <Announce say={actErr ?? said} tone={actErr ? 'crit' : undefined} />

      <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '84ch' }}>
        {TEMPLATES_NEVER_POST}
      </p>

      {actErr ? <Banner tone="crit" live={false}>{actErr}</Banner> : null}
      {said && !actErr ? <Banner live={false}>{said}</Banner> : null}

      <Part read={read} what="this gym’s standing arrangements"
            cost="what this gym pays every month is unknown, not nothing">
        <DataTable noun="standing arrangements"
          rows={reviews} columns={cols} rowKey={(r) => r.template.id}
          empty={templatesEmptyLine('ready')}
        />
      </Part>

      {/* The month's costs failing does not stop an owner setting a template up
          or filling the form from one — it stops this screen claiming which of
          them is still outstanding, and that is what this says. */}
      {monthCosts.state !== null ? (
        <Banner tone="crit">
          {w.label}&rsquo;s costs {monthCosts.state === 'loading' ? 'have not finished loading' : 'could not be read'},
          so whether each of these has been entered yet is <strong>unknown</strong> rather than no. The
          arrangements themselves are unaffected.
        </Banner>
      ) : null}

      <TemplateForm
        key={`${editing?.id ?? 'new'}|${openWith?.n ?? 0}`}
        editing={editing} openWith={openWith?.draft ?? null}
        today={today} ccy={ccy} tenantId={tenantId} me={me}
        onDone={(msg) => { setEditing(null); setOpenWith(null); setSaid(msg); setActErr(null); onChange(); }}
        onCancel={() => { setEditing(null); setOpenWith(null); }}
      />

      <FromHistory
        read={past} rows={suggestions} months={back?.months.length ?? 0}
        onUse={(s) => {
          setEditing(null);
          setOpenWith((o) => ({
            n: (o?.n ?? 0) + 1,
            draft: {
              description: s.supplier,
              supplier: s.supplier,
              category: s.category as GymCostCategory,
              // The last figure this supplier actually charged, and only where
              // every sighting agreed on the currency AND that currency is the
              // one this gym records in. `standingCosts` already withholds
              // `usual` across two currencies; this second test stops a euro
              // figure being typed into a box that will be stored as pounds.
              amountText: s.usual && ccy && s.usual.currency === ccy
                ? majorFromMinor(s.usual.cents, s.usual.currency)
                : '',
            },
          }));
          setSaid(`The form above has been filled in for ${s.supplier}. Check it and save it — nothing is set up until you do.`);
          setActErr(null);
        }}
      />
    </Section>
  );
}

/** Which ink a standing is said in. Only the two that ask for something get a
 *  colour: an arrangement already recorded is ordinary, and 'unknown' is a
 *  warning because a reader who skims it as "no" acts on a read that failed. */
function standingInk(s: TemplateReview['standing']): string {
  if (s === 'due') return 'var(--warn)';
  if (s === 'unknown' || s === 'unmatchable') return 'var(--crit)';
  return 'var(--ink2)';
}

/* ── setting one up ────────────────────────────────────────────────────────── */

/**
 * The form that creates a standing arrangement, or changes one.
 *
 * One form for both, because two would drift: the validation, the currency rule
 * and the day-of-month rule all have to be identical, and the field an edit
 * form quietly loses is the one nobody was looking at.
 *
 * `starts_on` is NOT offered when editing. The arrangement began when it began,
 * and moving it would make a template claim this gym has only had a landlord
 * since the day somebody corrected a typo — see `updateCostTemplate`, which
 * does not send the column at all.
 */
function TemplateForm({ editing, openWith, today, ccy, tenantId, me, onDone, onCancel }: {
  editing: CostTemplate | null;
  openWith: Partial<CostTemplateDraft> | null;
  today: string;
  ccy: TenantCurrency; tenantId: string | null; me: Me;
  onDone: (msg: string) => void; onCancel: () => void;
}) {
  const [description, setDescription] = useState(editing?.description ?? openWith?.description ?? '');
  const [supplier, setSupplier] = useState(editing?.supplier ?? openWith?.supplier ?? '');
  const [category, setCategory] = useState<GymCostCategory>(
    (editing && GYM_COST_CATEGORIES.some((c) => c.id === editing.category)
      ? editing.category as GymCostCategory
      : openWith?.category) ?? 'rent');
  const [amountText, setAmountText] = useState(
    // Read back through the reader that knows the factor is 1, 100 or 1000. An
    // edit form seeded with `cents / 100` would show a yen arrangement at a
    // hundredth of itself, and saving without touching the box would store it.
    editing ? majorFromMinor(editing.amountCents, editing.currency) : (openWith?.amountText ?? ''));
  const [dueDayText, setDueDayText] = useState(editing?.dueDay != null ? String(editing.dueDay) : '');
  /**
   * The day the arrangement started — null meaning "nobody has chosen", for the
   * reason spelled out on `pickedDay` in the cost form above: this form mounts
   * before the zone read lands, so a value latched at mount is the READER's
   * day and never the gym's.
   *
   * Only offered when creating; an edit never sends this column at all, so the
   * stored day of an existing arrangement is untouched either way.
   */
  const [startPicked, setStartPicked] = useState<string | null>(editing?.startsOn ?? null);
  const startsOn = startPicked ?? today;
  const setStartsOn = setStartPicked;
  const [note, setNote] = useState(editing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const draft: CostTemplateDraft = {
    description, supplier, category, amountText, currency: ccy, dueDayText, startsOn, note,
  };
  const blockers = templateBlockers(draft);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blockers.length) { setErr(blockers[0]); return; }
    if (!tenantId) return;

    // Read ONCE, by the same reader `templateBlockers` used above. Two readers
    // over one box is how an amount comes to be shown as one figure and stored
    // as another — the pairing gymCosts.ts keeps for the same reason.
    let amountCents: number | null = null;
    let currency: string | null = null;
    if (amountText.trim()) {
      if (!ccy) { setErr('This gym has not set a currency, so a usual amount cannot be stored.'); return; }
      const amt = readMinorAmount(amountText, ccy, false);
      if (!amt.ok) { setErr(amt.reason); return; }
      amountCents = amt.minorUnits;
      currency = ccy;
    }
    const dueDay = dueDayText.trim() ? Number(dueDayText.trim()) : null;

    setBusy(true); setErr(null);
    try {
      const write = {
        description, supplier, category, amountCents, currency, dueDay, startsOn, note,
      };
      if (editing) {
        await updateCostTemplate(supabase, editing.id, write);
        onDone(`${description.trim()} has been changed. Nothing already recorded has moved — a template describes what is coming, not what went out.`);
      } else {
        await createCostTemplate(supabase, tenantId, me.id, write);
        onDone(`${description.trim()} is set up to repeat. It has recorded nothing: fill the form above from it when the bill arrives.`);
      }
    } catch (e: any) {
      setErr(`That arrangement was NOT ${editing ? 'changed' : 'saved'}: ${e?.message ?? 'the write was refused'}. Nothing has changed.`);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--ring)' }}>
      <div style={{ padding: '12px 14px 0' }}>
        <h3 style={{ margin: 0, fontSize: 13.5 }}>
          {editing ? `Change “${editing.description}”` : 'Set one up'}
        </h3>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>
          {editing
            ? 'What this says from now on. Costs already recorded from it are ordinary lines somebody typed and are untouched. The day it started cannot be changed here — that is what stops a corrected template claiming the arrangement began today.'
            : 'The payee is required here even though it is optional on a one-off cost: it is the only thing that can tell whether this month’s bill has been entered yet. Leave the amount blank where the bill varies — that is what blank means.'}
        </p>
      </div>

      <Announce say={err} tone="crit" />

      <form onSubmit={submit} style={formRow}>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
               placeholder="What it is for" style={{ ...field, flex: 2, minWidth: 180 }}
               aria-label="What this standing arrangement is for" />
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
               placeholder="Who it is paid to" style={{ ...field, flex: 2, minWidth: 170 }}
               aria-label="Who this standing arrangement is paid to" />
        <select value={category} onChange={(e) => setCategory(e.target.value as GymCostCategory)}
                style={{ ...field, minWidth: 190 }} aria-label="What kind of cost this is">
          {GYM_COST_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal"
               placeholder={ccy ? `Usually (${ccy}) — blank if it varies` : 'Usually — blank if it varies'}
               style={{ ...field, width: 210 }}
               aria-label="What this usually costs, or blank if the bill varies" />
        <label style={dateLabel}>
          on the
          <input value={dueDayText} onChange={(e) => setDueDayText(e.target.value)} inputMode="numeric"
                 placeholder="day" style={{ ...field, width: 74 }}
                 aria-label="Which day of the month the money usually goes out, or blank" />
        </label>
        {editing ? null : (
          <label style={dateLabel}>
            since
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)}
                   style={{ ...field, width: 148 }}
                   aria-label="The day this arrangement started" />
          </label>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
               style={{ ...field, flex: 2, minWidth: 150 }}
               aria-label="A note about this standing arrangement" />
        <button type="submit" disabled={busy || !!blockers.length} style={primaryBtn}>
          {editing ? 'Save changes' : 'Set it up'}
        </button>
        {editing ? (
          <button type="button" onClick={onCancel} style={linkBtn}>cancel</button>
        ) : null}
      </form>

      {!ccy ? (
        <Banner>
          This gym has not set its currency, so a standing arrangement can be set up with a payee and a
          category but not with a usual amount &mdash; {NO_CURRENCY_NOTE}. Set it on{' '}
          <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a>, then come back and add the figures.
        </Banner>
      ) : null}
      {blockers.length && !err && (description || supplier || amountText) ? (
        <ul style={{ margin: '0 14px 12px', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn)', maxWidth: '78ch' }}>
          {blockers.map((b) => <li key={b} style={{ marginBottom: 4 }}>{b}</li>)}
        </ul>
      ) : null}
      {err ? <Banner tone="crit" live={false}>{err}</Banner> : null}
    </div>
  );
}

/* ── the ones the ledger already knows about ───────────────────────────────── */

/**
 * Suppliers this gym pays month after month that have no arrangement set up.
 *
 * This is the difference between a feature an owner has to populate by hand and
 * one that is useful on the day it ships: a gym with eight standing suppliers
 * already in its ledger sets all eight up with eight presses.
 *
 * `rows` is empty for two very different reasons and the section says which.
 * Over a look-back that did not come back, "no standing suppliers found" is a
 * sentence made out of a failed query, on a screen whose whole subject is what
 * a gym reliably pays.
 */
function FromHistory({ read, rows, months, onUse }: {
  read: Read<GymCost>; rows: StandingCost[]; months: number;
  onUse: (s: StandingCost) => void;
}) {
  const cols: Column<StandingCost>[] = [
    { key: 'supplier', header: 'Paid to', value: (s) => s.supplier },
    { key: 'category', header: 'Category', value: (s) => gymCostCategoryLabel(s.category) },
    { key: 'seen', header: 'Months seen', value: (s) => s.monthsSeen, numeric: true,
      render: (s) => <>{s.monthsSeen} of {s.lookback}</> },
    { key: 'usual', header: 'Last time', value: (s) => s.usual?.cents ?? null, numeric: true,
      // Null in three cases, all of them refusals rather than gaps: more than
      // one currency across the sightings, no amount on the most recent one, or
      // no currency on it. `standingCosts` will not average them, and neither
      // will this.
      render: (s) => (s.usual
        ? <>{money(s.usual.cents, s.usual.currency)}</>
        : <span className="dash">not one figure</span>) },
    { key: 'act', header: '', value: () => '', align: 'right',
      render: (s) => (
        <button onClick={() => onUse(s)} style={linkBtn} className="no-print"
                aria-label={`Set up a standing arrangement for ${s.supplier}`}>
          set one up
        </button>
      ) },
  ];

  return (
    <div style={{ borderTop: '1px solid var(--ring)' }}>
      <div style={{ padding: '12px 14px 0' }}>
        <h3 style={{ margin: 0, fontSize: 13.5 }}>Already in your ledger</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>
          Suppliers you have paid in at least three of the last {months || COST_LOOKBACK_MONTHS} months,
          including the most recent month on record, with nothing set up for them. The figure beside each
          is what they last charged &mdash; never an average, because a mean of a rent that went up in April
          is a number no invoice anywhere says.
        </p>
      </div>
      <Part read={read} what="the months before this one"
            cost="what this gym pays regularly cannot be worked out from its own ledger">
        <DataTable noun="suppliers"
          rows={rows} columns={cols} rowKey={(s) => s.key}
          empty="Every supplier this gym pays regularly already has a standing arrangement — or it has not been paying any of them long enough for three months of record to show it."
        />
      </Part>
    </div>
  );
}

/* ── the ledger ────────────────────────────────────────────────────────────── */

function Ledger({ read, rows, w, onChange }: {
  read: Read<GymCost>; rows: GymCost[]; w: MonthWindow; onChange: () => void;
}) {
  const [removeErr, setRemoveErr] = useState<string | null>(null);

  const remove = (c: GymCost) => {
    if (!confirm(
      `Remove "${c.description}", paid ${c.paidOn}? There is no undo and no edit — if this line was wrong, `
      + 'record the right one afterwards. The removal is logged against your account.',
    )) return;
    deleteGymCost(supabase, c.id)
      .then(() => { setRemoveErr(null); onChange(); })
      .catch((e: any) => setRemoveErr(
        `That cost was NOT removed: ${e?.message ?? 'the delete was refused'}. It is still in the ledger and still in anything exported from this page.`));
  };

  const cols: Column<GymCost>[] = [
    { key: 'paid', header: 'Paid', value: (c) => c.paidOn },
    { key: 'what', header: 'What for', value: (c) => c.description },
    { key: 'supplier', header: 'Paid to', value: (c) => c.supplier,
      render: (c) => c.supplier ?? <span className="dash">not stated</span> },
    { key: 'category', header: 'Category', value: (c) => gymCostCategoryLabel(c.category) },
    { key: 'amount', header: 'Amount', value: (c) => c.amountCents, numeric: true,
      render: (c) => (c.amountCents == null
        ? <span className="dash">no amount recorded</span>
        : <>{money(c.amountCents, c.currency)}</>) },
    { key: 'note', header: 'Note', value: (c) => c.note },
    { key: 'remove', header: '', value: () => '', align: 'right',
      render: (c) => (
        <button onClick={() => remove(c)} style={linkBtn} className="no-print"
                aria-label={`Remove ${c.description}, paid ${c.paidOn}`}>
          remove
        </button>
      ) },
  ];

  return (
    <Section
      title={`What went out in ${w.label}`}
      sub="Every line somebody recorded, newest first. An amount with no currency on it is shown as a dash rather than in a currency nobody stated."
    >
      {removeErr ? <Banner tone="crit">{removeErr}</Banner> : null}
      <Part read={read} what="the recorded costs"
            cost="what this gym spent in this month is unknown, not nil">
        <DataTable noun="costs"
          rows={rows} columns={cols} rowKey={(c) => c.id}
          empty={gymCostsEmptyLine('ready')}
        />
      </Part>
    </Section>
  );
}

/* ── where it went ─────────────────────────────────────────────────────────── */

interface CategoryLine {
  key: string;
  label: string;
  currency: string;
  count: number;
  cents: number;
}

/**
 * Per category AND per currency, never one figure per category.
 *
 * A gym paying rent in pounds and an insurer in euros has two amounts of money
 * and not a sum, and a line reading "Insurance 5,400" over two currencies is a
 * number somebody would copy.
 */
function Where({ read, pots, w }: { read: Read<GymCost>; pots: GymCostPot[]; w: MonthWindow }) {
  const lines: CategoryLine[] = [];
  for (const p of pots) {
    for (const pot of p.taken.pots) {
      lines.push({
        key: `${p.category}|${pot.currency}`,
        label: p.label,
        currency: pot.currency,
        count: pot.count,
        cents: pot.minorUnits,
      });
    }
  }

  const cols: Column<CategoryLine>[] = [
    { key: 'label', header: 'Category', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency },
    { key: 'count', header: 'Lines', value: (l) => l.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (l) => l.cents, numeric: true,
      render: (l) => money(l.cents, l.currency) },
  ];

  return (
    <Section
      title="Where it went"
      sub={`What ${w.label} was spent on. A category nobody recorded anything against is absent rather than shown at zero — a "Utilities 0.00" line would be a statement that this gym spent nothing on power.`}
    >
      <Part read={read} what="the recorded costs" cost="the split by category is unknown">
        <DataTable noun="cost categories"
          rows={lines} columns={cols} rowKey={(l) => l.key}
          empty={`Nothing is recorded as paid in ${w.label}, so there is nothing to split.`}
        />
      </Part>
    </Section>
  );
}

/* ── against what this gym has been spending ───────────────────────────────── */

/**
 * The month on screen against the run rate of the months before it.
 *
 * ── Why this is beside the budget section and not inside it ───────────────
 *
 * Because a budget is a plan and this is a fact, and most gyms have not set a
 * plan. `Budgets` answers "against what you meant to spend" and answers nothing
 * at all for a category nobody has budgeted — which, on the day this ships, is
 * every category of every gym. "Power is half again what it has been running
 * at" needs no plan, only the gym's own ledger, and the ledger is already on
 * this screen: `past` is the six complete months `standingCosts` judges over,
 * read for `Repeats` above and looked at by nothing else.
 *
 * ── The denominator is stated on the screen ──────────────────────────────
 *
 * `monthsOnRecord` — the months in that window holding any cost at all, not the
 * width of the window. A gym four months old would otherwise have every run
 * rate cut by a third and every category in its books would read as rising. The
 * heading says which number it divided by, because an average whose denominator
 * is invisible is a figure nobody can check.
 *
 * Nothing here is netted, summed across currencies or called profit. The whole
 * of that argument is in `GYM_COSTS_ARE_NEVER_NETTED`, printed at the bottom of
 * this page.
 */
function Trend({ w, costs, past, months }: {
  w: MonthWindow; costs: Read<GymCost>; past: Read<GymCost>; months: string[];
}) {
  const trend = useMemo(
    () => categoryTrend(costs.rows ?? [], past.rows ?? [], months, readStatus(costs), readStatus(past)),
    [costs, past, months],
  );

  const cols: Column<TrendLine>[] = [
    { key: 'label', header: 'Category', value: (l) => l.label },
    { key: 'currency', header: 'Currency', value: (l) => l.currency },
    { key: 'now', header: `In ${w.label}`,
      value: (l) => (l.kind === 'nothing-this-month' ? null : l.thisMonth), numeric: true,
      // Never a zero for `nothing-this-month`. A category whose invoice is
      // still in a drawer is not a category the gym spent nothing on, and
      // "0.00" beside a run rate is the line that reads as a saving.
      render: (l) => (l.kind === 'nothing-this-month'
        ? <span className="dash">nothing entered</span>
        : <>{money(l.thisMonth, l.currency)}</>) },
    { key: 'rate', header: 'A month, before this one',
      value: (l) => (l.kind === 'measured' || l.kind === 'nothing-this-month' ? l.average : null),
      numeric: true,
      render: (l) => (l.kind === 'measured' || l.kind === 'nothing-this-month'
        ? <>{money(l.average, l.currency)}</>
        : <span className="dash">{l.kind === 'no-baseline' ? 'no month on record' : 'nothing like it before'}</span>) },
    { key: 'diff', header: 'Difference', value: (l) => (l.kind === 'measured' ? l.diff : null), numeric: true,
      // `deltaSign` and the magnitude, never a hand-rolled `+`. Zero is neither
      // direction and gets no sign at all, and the figure is printed unsigned
      // so `money` cannot render a second minus beside it. Same shape, and same
      // reason, as the budget table below.
      render: (l) => (l.kind === 'measured'
        ? (
          <span style={{ color: l.diff > 0 ? 'var(--warn)' : 'var(--ink2)' }}>
            {deltaSign(l.diff)}{money(Math.abs(l.diff), l.currency)}
          </span>
        )
        : <span className="dash">no comparison</span>) },
    { key: 'pct', header: 'Of the run rate', value: (l) => (l.kind === 'measured' ? l.pct : null), numeric: true,
      render: (l) => (l.kind === 'measured' && l.pct != null
        ? (
          <span style={{ color: l.pct > 0 ? 'var(--warn)' : 'var(--ink2)' }}>
            {deltaSign(l.pct)}{Math.abs(l.pct)}%
          </span>
        )
        // Two different nothings behind one dash, and the sentence beside it
        // says which: a line with no comparison at all, or a real rise against
        // a run rate of nothing, where a proportion is not a number.
        : <span className="dash">&mdash;</span>) },
    { key: 'note', header: '', value: (l) => l.kind,
      render: (l) => (
        <span style={{ fontSize: 12, color: l.kind === 'measured' ? 'var(--ink3)' : 'var(--ink2)' }}>
          {trendNote(l, w.label, trend?.monthsOnRecord ?? 0)}
        </span>
      ) },
  ];

  return (
    <Section
      title="Against what this gym has been spending"
      sub="Each category this month, beside what it has been running at over the months before it. No budget is needed for this — it is the gym’s own ledger, compared with itself, one currency at a time."
    >
      <Part read={costs} what="the recorded costs"
            cost="what this month spent is unknown, so it is compared with nothing">
        <Part read={past} what="the months before this one"
              cost="what this gym has been spending is unknown, so nothing this month is compared against it">
          <>
            <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 12.5, maxWidth: '88ch' }}>
              {trend == null
                ? 'Both months have to be read in full before anything here can be compared.'
                : trend.monthsOnRecord === 0
                  ? <>None of the {trend.monthsLookedAt} complete months before {w.label} holds a single cost, so there is no run rate to compare anything against. That is what a new ledger looks like.</>
                  : <>
                      Every figure in the &ldquo;a month&rdquo; column divides by <strong>{trend.monthsOnRecord}</strong>
                      {' '}&mdash; the {trend.monthsOnRecord === 1 ? 'one month' : `${trend.monthsOnRecord} months`} of the
                      {' '}{trend.monthsLookedAt} before {w.label} that hold any cost at all, never the width of the
                      window. A gym four months old divided by six would read as rising in every category it has.
                    </>}
              {trend && trend.uncounted > 0 ? (
                <>
                  {' '}
                  <span style={{ color: 'var(--warn)' }}>
                    {trend.uncounted} cost{trend.uncounted === 1 ? '' : 's'} carr{trend.uncounted === 1 ? 'ies' : 'y'} no
                    amount or state{trend.uncounted === 1 ? 's' : ''} no currency, so {trend.uncounted === 1 ? 'it is' : 'they are'} in
                    no figure here. {trend.uncounted === 1 ? 'That is not a nought.' : 'Those are not noughts.'}
                  </span>
                </>
              ) : null}
            </p>
            <DataTable noun="category run rates"
              rows={trend?.lines ?? []} columns={cols} rowKey={(l) => `${l.category}|${l.currency}`}
              empty={`Nothing is recorded in ${w.label} and nothing in the months before it, so there is nothing to compare. That is a statement about the ledger, not about the gym.`}
            />
          </>
        </Part>
      </Part>
    </Section>
  );
}

/* ── who this gym pays ─────────────────────────────────────────────────────── */

/**
 * Every payee in the ledger, ranked by money, one currency at a time.
 *
 * ── What this answers that nothing else here does ─────────────────────────
 *
 * `standingCosts` asks which suppliers this gym pays every month, and
 * deliberately withholds a figure the moment two sightings disagree about the
 * currency or the amount — it is a question about REGULARITY, and a template
 * suggestion made out of an average of a rent that went up in April would be a
 * number no invoice anywhere says. So "how much has this gym paid this
 * engineer" was unanswerable on any screen: the payee has been on every cost
 * row since part 700 and nothing grouped by it.
 *
 * Ranked WITHIN a currency and never across one. Two currencies to one payee is
 * two lines, because they are two amounts of money and this app holds no rate —
 * the rule the whole of this screen is built on.
 *
 * The window is the month on screen plus the complete months before it, which
 * is exactly what is already read. A payee with no name is counted out rather
 * than given one: a "Not stated" row in a supplier league table reads as a
 * supplier called Not Stated.
 */
function WhoWePay({ w, costs, past, months }: {
  w: MonthWindow; costs: Read<GymCost>; past: Read<GymCost>; months: string[];
}) {
  /** Whole only when BOTH are. One side missing makes every payee's figure
   *  short by an unknown amount, and a league table is exactly the shape in
   *  which that is invisible. */
  const status = readStatus(costs) === 'ready' && readStatus(past) === 'ready'
    ? 'ready' as const
    : (readStatus(costs) === 'loading' || readStatus(past) === 'loading' ? 'loading' as const : 'error' as const);

  const spend = useMemo(
    () => supplierSpend([...(costs.rows ?? []), ...(past.rows ?? [])], status),
    [costs.rows, past.rows, status],
  );

  const cols: Column<SupplierLine>[] = [
    { key: 'supplier', header: 'Paid to', value: (l) => l.supplier },
    { key: 'currency', header: 'Currency', value: (l) => l.currency },
    { key: 'amount', header: 'Paid', value: (l) => l.minorUnits, numeric: true,
      render: (l) => <>{money(l.minorUnits, l.currency)}</> },
    { key: 'count', header: 'Costs', value: (l) => l.count, numeric: true },
    { key: 'months', header: 'Months seen', value: (l) => l.months, numeric: true },
    { key: 'last', header: 'Last paid', value: (l) => l.lastPaidOn },
    { key: 'cats', header: 'Filed under', value: (l) => l.categories.join(', '),
      render: (l) => <span style={{ whiteSpace: 'normal' }}>{l.categories.join(', ')}</span> },
  ];

  const note = spend ? unnamedPayeeNote(spend) : null;

  return (
    <Section
      title="Who this gym pays"
      sub="Every payee in the ledger over this month and the complete months before it, biggest first inside each currency. Two currencies to one payee is two lines — there is no rate in this product to make them one."
    >
      <Part read={costs} what="the recorded costs"
            cost="who this gym pays is unknown, not nobody">
        <Part read={past} what="the months before this one"
              cost="what this gym has paid each of its suppliers is unknown, and a list short by an unread month is a league table in the wrong order">
          <>
            <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '88ch' }}>
              {w.label} and the {months.length} complete month{months.length === 1 ? '' : 's'} before it.
              Payees are matched on the name as it was typed, ignoring case &mdash; two spellings of one
              supplier are two lines, which is worth seeing rather than quietly merging.
              {note ? <> {note}</> : null}
            </p>
            <DataTable noun="payees"
              rows={spend?.lines ?? []} columns={cols} rowKey={(l) => l.key}
              empty={`No cost in ${w.label} or the months before it names who it was paid to. A payee is optional on a cost, so this is a statement about how the ledger was filled in.`}
            />
          </>
        </Part>
      </Part>
    </Section>
  );
}

/* ── against what the gym planned ──────────────────────────────────────────── */

/**
 * The budget behind a line, or null where there is none.
 *
 * `BudgetLine` is a union and the 'no-budget' arm deliberately has no `budget`
 * field at all — the type is what stops a screen rendering an absent plan as a
 * zero. This is the one place that absence has to be turned back into a
 * nullable, for the buttons that act on a budget rather than on a comparison.
 */
function lineBudget(l: BudgetLine): CostBudget | null {
  return l.kind === 'no-budget' ? null : l.budget;
}

/**
 * What the gym meant to spend, beside what it did.
 *
 * Every refusal on this screen comes from one distinction: a budget is a number
 * somebody TYPED and an actual is a number the REGISTER produced, and the
 * difference between them is a fact only when both sides are. `budgetReview`
 * holds the four cases where no variance is stated and this renders each of
 * them as its own sentence rather than as a blank cell — a column with gaps in
 * it reads as a bug unless somebody says each gap was a decision.
 *
 * There is no pair of totals at the top. Categories can be budgeted in
 * different currencies, some have no budget, and some have nothing recorded
 * yet, so "budgeted 18,400, spent 19,900" would be two sums over different
 * subsets of the book presented as a comparison.
 */
function Budgets({ w, read, monthCosts, ccy, zone, tenantId, me, onChange }: {
  w: MonthWindow; read: Read<CostBudget>; monthCosts: Read<GymCost>;
  ccy: TenantCurrency; zone: string | null;
  tenantId: string | null; me: Me; onChange: () => void;
}) {
  const budgets = useMemo(() => read.rows ?? [], [read.rows]);

  // The month's costs are the actual side, and the STATUS decides whether that
  // side may be stated at all. A prefix of the month's ledger is a smaller
  // actual, and a smaller actual is an under-spend — the one direction a wrong
  // figure here is never questioned.
  const lines = useMemo(
    () => budgetReview(budgets, monthCosts.rows ?? [], w.key, readStatus(monthCosts)),
    [budgets, monthCosts, w.key],
  );

  const [actErr, setActErr] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [openWith, setOpenWith] = useState<{ n: number; category: GymCostCategory } | null>(null);

  // The GYM's today, for the day a budget is recorded as having stopped — the
  // same clock the cost form uses, for the same reason.
  const today = gymDay(Date.now(), zone) ?? isoDate(new Date());

  const stop = (b: CostBudget) => {
    if (!confirm(
      `Record that the budget for ${gymCostCategoryLabel(b.category)} stopped on ${today}? `
      + 'Every month up to then keeps its comparison — which is the whole reason this is not a delete.',
    )) return;
    setActErr(null); setSaid(null);
    endCostBudget(supabase, b.id, today)
      .then(() => { setSaid(`The ${gymCostCategoryLabel(b.category)} budget is recorded as having stopped on ${today}.`); onChange(); })
      .catch((e: any) => setActErr(
        `That budget was NOT stopped: ${e?.message ?? 'the write was refused'}. It is still in force and still being compared against.`));
  };

  const remove = (b: CostBudget) => {
    if (!confirm(
      `Remove the ${gymCostCategoryLabel(b.category)} budget that starts ${b.startsOn}? Do this only if it was typed by mistake. `
      + 'Every month it was in force loses its comparison — if the gym simply stopped budgeting for this, use “stopped” instead, which keeps them.',
    )) return;
    setActErr(null); setSaid(null);
    deleteCostBudget(supabase, b.id)
      .then(() => { setSaid(`The ${gymCostCategoryLabel(b.category)} budget starting ${b.startsOn} has been removed.`); onChange(); })
      .catch((e: any) => setActErr(
        `That budget was NOT removed: ${e?.message ?? 'the delete was refused'}. It is still in the list.`));
  };

  const cols: Column<BudgetLine>[] = [
    { key: 'label', header: 'Category', value: (l) => l.label },
    { key: 'budget', header: 'Budgeted', value: (l) => (l.kind === 'no-budget' ? null : l.budget?.amountCents ?? null),
      numeric: true,
      render: (l) => (l.kind === 'no-budget' || !l.budget
        ? <span className="dash">none set</span>
        : <>{money(l.budget.amountCents, l.budget.currency)}</>) },
    { key: 'actual', header: `Recorded in ${w.label}`, value: (l) => (l.kind === 'measured' ? l.actualCents : null),
      numeric: true,
      render: (l) => {
        // Four different absences, and not one of them is a zero. The one that
        // matters is 'nothing-recorded': a category with no invoice entered yet
        // is not a category the gym spent nothing in, and printing "0.00" here
        // is how a month reads as comfortably under budget on the day it is not.
        if (l.kind === 'measured') return <>{money(l.actualCents, l.budget.currency)}</>;
        if (l.kind === 'no-budget') {
          return <>{l.pots.map((p) => <div key={p.currency}>{money(p.minorUnits, p.currency)}</div>)}</>;
        }
        if (l.kind === 'currency-gap') {
          return <>{l.uncovered.map((p) => <div key={p.currency}>{money(p.minorUnits, p.currency)}</div>)}</>;
        }
        if (l.kind === 'unknown') return <span className="dash">unknown</span>;
        return <span className="dash">nothing entered</span>;
      } },
    { key: 'diff', header: 'Difference', value: (l) => (l.kind === 'measured' ? l.diffCents : null),
      numeric: true,
      render: (l) => (l.kind === 'measured'
        ? (
          // `deltaSign` and the magnitude, never a hand-rolled `+`. Zero is
          // neither direction and gets no sign at all — "on budget" is what the
          // sentence beside it says, and "−0.00" would read as an under-spend.
          // The sign is taken once and the figure printed unsigned, so `money`
          // cannot also render a minus and produce two of them.
          <span style={{ color: l.diffCents > 0 ? 'var(--warn)' : 'var(--ink2)' }}>
            {deltaSign(l.diffCents)}{money(Math.abs(l.diffCents), l.budget.currency)}
          </span>
        )
        : <span className="dash">no variance</span>) },
    { key: 'pct', header: 'Of budget', value: (l) => (l.kind === 'measured' ? l.pct : null), numeric: true,
      render: (l) => (l.kind === 'measured' && l.pct != null
        ? (
          <span style={{ color: l.pct > 0 ? 'var(--warn)' : 'var(--ink2)' }}>
            {deltaSign(l.pct)}{Math.abs(l.pct)}%
          </span>
        )
        // Two different nothings behind one dash, and the sentence in the next
        // column says which: a line with no variance at all, or a measured
        // over-spend against a budget of nothing, where a proportion is not a
        // number rather than a large one.
        : <span className="dash">&mdash;</span>) },
    { key: 'note', header: '', value: (l) => l.kind,
      render: (l) => (
        <span style={{ fontSize: 12, color: l.kind === 'measured' ? 'var(--ink3)' : 'var(--ink2)' }}>
          {budgetNote(l, w.label)}
        </span>
      ) },
    { key: 'act', header: '', value: () => '', align: 'right',
      render: (l) => (
        <span className="no-print" style={{ display: 'inline-flex', gap: 10, whiteSpace: 'nowrap' }}>
          {/* Revising is setting a NEW budget from the month the figure changes,
              never editing this one — part 2760's trigger refuses the edit, and
              the reason is that a variance somebody acted on in July was
              computed against what this row says today. */}
          <button onClick={() => setOpenWith((o) => ({ n: (o?.n ?? 0) + 1, category: l.category as GymCostCategory }))}
                  style={linkBtn} aria-label={`Set a new budget for ${l.label}`}>
            {l.kind === 'no-budget' ? 'set a budget' : 'revise'}
          </button>
          {lineBudget(l) && !lineBudget(l)!.endsOn ? (
            <button onClick={() => stop(lineBudget(l)!)} style={linkBtn}
                    aria-label={`Record that the ${l.label} budget has stopped`}>
              stopped
            </button>
          ) : null}
          {lineBudget(l) ? (
            <button onClick={() => remove(lineBudget(l)!)} style={linkBtn}
                    aria-label={`Remove the ${l.label} budget`}>
              remove
            </button>
          ) : null}
        </span>
      ) },
  ];

  return (
    <Section
      title="Against what you planned"
      sub="What the gym budgeted per month, per category, beside what it actually recorded. A difference is only shown where both sides are real."
    >
      <Announce say={actErr ?? said} tone={actErr ? 'crit' : undefined} />

      <div style={{ padding: '14px', display: 'grid', gap: 10, color: 'var(--ink2)', fontSize: 12.5, maxWidth: '84ch' }}>
        <p style={{ margin: 0 }}>{BUDGET_IS_TYPED_NOT_MEASURED}</p>
        <p style={{ margin: 0 }}>{NO_VARIANCE_WITHOUT_BOTH_SIDES}</p>
      </div>

      {actErr ? <Banner tone="crit" live={false}>{actErr}</Banner> : null}
      {said && !actErr ? <Banner live={false}>{said}</Banner> : null}

      {/* The budgets read failing is not the same as the month's costs failing,
          and the two produce different sentences: without budgets there is
          nothing to compare against, and without costs there is nothing to
          compare. `Part` covers the first; this covers the second. */}
      <Part read={read} what="this gym’s cost budgets"
            cost="nothing this month is compared against anything">
        <>
          {monthCosts.state !== null ? (
            <Banner tone="crit">
              {w.label}&rsquo;s costs {monthCosts.state === 'loading' ? 'have not finished loading' : 'could not be read'},
              so what was actually spent is <strong>unknown</strong> and no variance is shown below. A
              part-read ledger is a smaller figure, and a smaller figure looks like an under-spend.
            </Banner>
          ) : null}
          <DataTable noun="budget lines"
            rows={lines} columns={cols} rowKey={(l) => l.category}
            empty={budgetsEmptyLine('ready')}
          />
        </>
      </Part>

      <BudgetForm
        key={`${openWith?.n ?? 0}|${openWith?.category ?? 'new'}`}
        category={openWith?.category ?? 'rent'}
        existing={openWith ? budgetFor(budgets, openWith.category, w.key) : null}
        w={w} today={today} ccy={ccy} tenantId={tenantId} me={me}
        onDone={(msg) => { setOpenWith(null); setSaid(msg); setActErr(null); onChange(); }}
      />
    </Section>
  );
}

/**
 * The form that sets a budget, or supersedes one.
 *
 * There is no edit here and that is deliberate: part 2760 refuses an UPDATE to
 * the amount, the category, the currency or the start, because a variance
 * somebody acted on in July was computed against those and changing them in
 * November rewrites what the gym had planned — in the direction that makes the
 * past look better. `existing` is shown beside the box so a revision is made
 * with the old figure in front of the person making it, rather than from
 * memory.
 */
function BudgetForm({ category: initial, existing, w, today, ccy, tenantId, me, onDone }: {
  category: GymCostCategory; existing: CostBudget | null;
  w: MonthWindow; today: string;
  ccy: TenantCurrency; tenantId: string | null; me: Me;
  onDone: (msg: string) => void;
}) {
  const [category, setCategory] = useState<GymCostCategory>(initial);
  const [amountText, setAmountText] = useState('');
  // Defaults to the first day of the month ON SCREEN and not to today. An owner
  // looking at August who types a budget means it to apply to August; seeding
  // this with the gym's own today would silently start it in September for
  // anybody reviewing a month that has ended, which is most of them.
  const [startsOn, setStartsOn] = useState(w.firstDay);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const draft: CostBudgetDraft = { category, amountText, currency: ccy, startsOn, note };
  const blockers = budgetBlockers(draft);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blockers.length) { setErr(blockers[0]); return; }
    if (!tenantId || !ccy) return;
    // Read once, by the same reader the blockers used, with the same
    // `chargeable: false` the cost form uses.
    const amt = readMinorAmount(amountText, ccy, false);
    if (!amt.ok) { setErr(amt.reason); return; }

    setBusy(true); setErr(null);
    try {
      await createCostBudget(supabase, tenantId, me.id, {
        category, amountCents: amt.minorUnits, currency: ccy, startsOn, note,
      });
      onDone(`A ${gymCostCategoryLabel(category)} budget of ${money(amt.minorUnits, ccy)} a month is set from ${startsOn}. Months before that keep whatever they were measured against.`);
    } catch (e: any) {
      setErr(`That budget was NOT set: ${e?.message ?? 'the write was refused'}. Nothing has changed. If this gym already has a budget for this category starting on the same day, change the date — two budgets cannot start on one day, because nothing could then say which applies.`);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ borderTop: '1px solid var(--ring)' }}>
      <div style={{ padding: '12px 14px 0' }}>
        <h3 style={{ margin: 0, fontSize: 13.5 }}>Set a budget</h3>
        <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '84ch' }}>
          A figure per month, from the month you choose onwards, so it is not retyped twelve times a
          year. Changing one is setting a new figure from the month it changed &mdash; that is how the
          months before it keep the comparison they were actually judged on. Today is {today}.
        </p>
        {existing ? (
          <p style={{ margin: '8px 0 0', color: 'var(--ink2)', fontSize: 12.5, maxWidth: '84ch' }}>
            The {gymCostCategoryLabel(existing.category)} budget in force for {w.label} is{' '}
            <strong>{money(existing.amountCents, existing.currency)}</strong> a month, set from{' '}
            {existing.startsOn}. Whatever you set below takes over from the month you give it.
          </p>
        ) : null}
      </div>

      <Announce say={err} tone="crit" />

      <form onSubmit={submit} style={formRow}>
        <select value={category} onChange={(e) => setCategory(e.target.value as GymCostCategory)}
                style={{ ...field, minWidth: 200 }} aria-label="Which kind of cost this budget is for">
          {GYM_COST_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal"
               placeholder={ccy ? `A month (${ccy})` : 'A month'} style={{ ...field, width: 170 }}
               aria-label="How much this gym plans to spend on this in a month" />
        <label style={dateLabel}>
          from
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)}
                 style={{ ...field, width: 148 }}
                 aria-label="The first month this budget applies to" />
        </label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
               style={{ ...field, flex: 2, minWidth: 160 }}
               aria-label="A note about this budget" />
        <button type="submit" disabled={busy || !!blockers.length} style={primaryBtn}>Set it</button>
      </form>

      {!ccy ? (
        <Banner>
          A budget cannot be set until this gym states its currency &mdash; {NO_CURRENCY_NOTE}. A plan with
          no currency on it cannot be compared with anything. Set it on{' '}
          <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a>.
        </Banner>
      ) : null}
      {blockers.length && !err && amountText ? (
        <ul style={{ margin: '0 14px 12px', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn)', maxWidth: '78ch' }}>
          {blockers.map((b) => <li key={b} style={{ marginBottom: 4 }}>{b}</li>)}
        </ul>
      ) : null}
      {err ? <Banner tone="crit" live={false}>{err}</Banner> : null}
    </div>
  );
}

/* ── getting it out of the browser ─────────────────────────────────────────── */

/**
 * The month's costs as a file.
 *
 * Both sections state what could NOT be read rather than exporting an empty
 * one: an empty section in a file somebody keeps is indistinguishable, forever,
 * from a month in which the gym paid for nothing.
 */
function Handoff({ w, gymName, rows, read, byCategory }: {
  w: MonthWindow; gymName: string | null; rows: GymCost[];
  read: Read<GymCost>; byCategory: GymCostPot[];
}) {
  // `Unread` has three values and only one is null. Both gates below tested
  // `=== 'failed'`, so a read still IN FLIGHT fell through to `rows` and wrote
  // a CSV headed "COSTS RECORDED IN THE MONTH" with nothing under it — filed,
  // that is indistinguishable from a month in which the gym spent nothing.
  const loading = read.state === 'loading';

  const download = () => {
    const parts: string[] = [];
    const head = (t: string) => `\n${t}\n`;

    parts.push(`Costs — ${gymName ?? 'this gym'} — ${w.label} (${w.firstDay} to ${w.lastDay})\n`);
    parts.push('Dated by the day the money went out. Nothing here is netted against what the gym took, and no figure in this file is a tax figure.\n');

    parts.push(head('COSTS RECORDED IN THE MONTH'));
    parts.push(read.state !== null
      ? (read.state === 'loading'
          ? 'NOT EXPORTED — the recorded costs had not finished loading when this file was made. Export the month again. This is unknown, not nil.\n'
          : `NOT EXPORTED — the recorded costs could not be read${read.why ? `: ${read.why}` : ''}. This is unknown, not nil.\n`)
      : toCsv(
          ['Paid on', 'What for', 'Paid to', 'Category', 'Amount (minor units)', 'Currency', 'Note'],
          rows.map((c) => [
            c.paidOn, c.description, c.supplier, gymCostCategoryLabel(c.category),
            c.amountCents, c.currency, c.note,
          ]),
          false));

    parts.push(head('BY CATEGORY AND CURRENCY'));
    parts.push(read.state !== null
      ? (read.state === 'loading'
          ? 'NOT EXPORTED — the recorded costs had not finished loading, so there is no split. Export the month again.\n'
          : 'NOT EXPORTED — the recorded costs could not be read, so there is no split.\n')
      : toCsv(
          ['Category', 'Currency', 'Lines', 'Amount (minor units)'],
          byCategory.flatMap((p) => p.taken.pots.map((pot) => [
            p.label, pot.currency, pot.count, pot.minorUnits,
          ])),
          false));

    saveText(parts.join(''), `${slugOf(gymName)}-${w.key}-costs.csv`);
  };

  return (
    <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '18px 0 20px' }}>
      <button onClick={download} style={{ ...primaryBtn, opacity: loading ? 0.5 : 1 }} disabled={loading}>
        {loading ? 'Still reading the month…' : 'Export this month (CSV)'}
      </button>
      <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '62ch' }}>
        Amounts are exported in minor units with their currency beside them, so nothing in the file
        depends on a spreadsheet guessing how many decimal places a currency has.
      </span>
    </div>
  );
}

/** A filename fragment from the gym's name. Falls back rather than producing a
 *  file called "-2026-08-costs.csv" that sorts before everything. */
function slugOf(name: string | null): string {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'gym';
}

/* ── the small pieces ──────────────────────────────────────────────────────── */

/**
 * A section body that cannot lie about which of the three states it is in:
 * loading says loading, failed says what broke and what is therefore unknown,
 * returned hands over to the table.
 */
function Part<T>({ read, what, cost, children }: {
  read: Read<T>; what: string; cost?: string; children: React.ReactNode;
}) {
  if (read.state === 'loading') return <Loading />;
  if (read.state === 'failed') {
    return (
      // Announced. `Loading` above carries `role="status"`; this is what
      // REPLACES it, and it was a plain div — so the whole of a refused ledger
      // read was silent to a screen reader on the screen that says what the gym
      // has spent.
      <div role="status" aria-live="polite" aria-atomic="true" style={{
        padding: '16px 14px', margin: 14, borderRadius: 0,
        border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
        background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
      }}>
        Could not read {what}. This section is <strong>unknown</strong>, not empty
        {cost ? <> &mdash; {cost}</> : null}.
        {read.why ? (
          <div className="mono" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink3)' }}>{read.why}</div>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}

const grid = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
  borderRadius: 0, overflow: 'hidden', margin: '16px 0 6px',
} as const;

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
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

/** A date field with its own word beside it. `<input type="date">` renders an
 *  empty box with a picker icon and nothing saying which date it wants. */
const dateLabel = {
  display: 'flex', alignItems: 'center', gap: 6,
  color: 'var(--ink3)', fontSize: 12.5,
} as const;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '86ch' }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}
