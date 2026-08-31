'use client';

// Revenue — where the money comes from, and which parts of that sentence the
// record can actually support.
//
// /money is the capture screen: it is where a plan is priced, a membership is
// opened and a payment is entered. Nothing is captured here. This screen only
// reads that record back and asks the two questions an owner asks a gym's
// books — what is contracted to bill next month, and what actually arrived —
// and it keeps them strictly apart, because they are not the same money and a
// screen that adds them has invented income.
//
// Three distinctions this page refuses to blur:
//
//   1. RECURRING IS A FORECAST OF BILLING, NOT MONEY RECEIVED. It is active
//      memberships multiplied by the price of the plan they sit on. Nobody has
//      paid it, some of them will freeze or cancel before the charge runs, and
//      a card will decline. It is what the price book says the gym is owed per
//      month if nothing changes — nothing more.
//
//   2. A YEARLY PLAN IS NOT A MONTHLY ONE. It is shown at a twelfth of its
//      price so the two can sit in one column, and the column says so. A
//      one-off plan recurs never and contributes nothing rather than a
//      twelfth of something.
//
//   3. PT PACKS ARE A DIFFERENT LEDGER. `client_purchases` is the trainer's
//      own checkout trail: it carries no tenant, no currency and no link to a
//      row in `gym_payments`. It is shown beside the till and never added into
//      it, because adding them double-counts every pack a gym also rang up at
//      the desk and leaving it out drops the rest.
//
// And the rule that governs every figure below: a plan whose price cannot be
// read is EXCLUDED from the forecast and counted out loud. Treating it as free
// would quietly shrink the forecast by exactly the amount nobody can see,
// which is the one error on this screen an owner would never catch.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchPlans, fetchMemberships, money,
  type MembershipPlan, type Membership, type PlanInterval,
} from '@lib/gymRecord';

/** The cash window. Ninety days is a quarter: long enough that a month with one
 *  odd week does not read as a trend, short enough to still be this year's gym. */
const DAYS = 90;
const DAY = 86400000;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "No payments taken in the last 90 days" are both lies about a query that
 * errored, and the second one tells an owner their gym has stopped selling.
 */
type Unread = 'loading' | 'failed' | null;

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as any)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

/* ── the rows this screen reads for itself ─────────────────────────────────── */

/**
 * A payment, with the membership link the shared reader does not select.
 *
 * `fetchPayments` in gymRecord omits `membership_id` — /money does not need it
 * to list what was taken, and that module is shared with the phone apps and is
 * not mine to change. This screen's entire job is saying what the money was
 * FOR, and that column is the only direct evidence of it, so the read is done
 * here instead.
 *
 * `amountCents` is kept nullable even though the column is NOT NULL today. A
 * sum that silently treats a missing amount as nothing is the failure this
 * whole page is written against, and the cost of defending against it is one
 * filter and one count.
 */
interface Taking {
  id: string;
  memberId: string | null;
  membershipId: string | null;
  amountCents: number | null;
  currency: string | null;
  method: string;
  takenAt: string;
}

/** A PT pack bought through a trainer's checkout. No tenant column, no currency
 *  column — both of those absences are stated on screen rather than papered
 *  over with a default. */
interface Pack {
  id: string;
  amountCents: number | null;
  sessionsTotal: number | null;
  sessionsUsed: number;
  status: string;
  createdAt: string;
}

interface Promo {
  id: string;
  code: string;
  discount: number | null;
  active: boolean;
  redemptions: number | null;
}

export default function Revenue() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);

  // A read that failed stays null, never []. [] is the gym saying it has none;
  // null is nobody knowing. On this screen those two answers differ by the
  // whole forecast.
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [takings, setTakings] = useState<Taking[] | null>(null);
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [promos, setPromos] = useState<Promo[] | null>(null);

  const [plansErr, setPlansErr] = useState<string | null>(null);
  const [membersErr, setMembersErr] = useState<string | null>(null);
  const [takingsErr, setTakingsErr] = useState<string | null>(null);
  const [packsErr, setPacksErr] = useState<string | null>(null);
  const [promosErr, setPromosErr] = useState<string | null>(null);

  const since = useMemo(() => new Date(Date.now() - DAYS * DAY).toISOString(), []);

  /**
   * Five independent reads.
   *
   * allSettled, not all: under a single catch over Promise.all, a refused
   * `promos` query — the least important row on this page — would blank the
   * price book, the memberships and the till alongside it, and the screen would
   * report a gym with no plans, no members and no income. One failed read may
   * cost its own section and nothing else.
   */
  const load = useCallback(async (tenantId: string) => {
    const [plRes, mRes, tRes, pkRes, prRes] = await Promise.allSettled([
      fetchPlans(supabase, tenantId),
      fetchMemberships(supabase, tenantId),
      fetchTakings(tenantId, since),
      fetchPacks(tenantId, since),
      fetchPromos(tenantId),
    ]);

    setPlans(plRes.status === 'fulfilled' ? plRes.value : null);
    setMembers(mRes.status === 'fulfilled' ? mRes.value : null);
    setTakings(tRes.status === 'fulfilled' ? tRes.value : null);
    setPacks(pkRes.status === 'fulfilled' ? pkRes.value : null);
    setPromos(prRes.status === 'fulfilled' ? prRes.value : null);

    setPlansErr(failure(plRes, 'the price book'));
    setMembersErr(failure(mRes, 'the memberships'));
    setTakingsErr(failure(tRes, 'the payments taken'));
    setPacksErr(failure(pkRes, 'the PT packs'));
    setPromosErr(failure(prRes, 'the promo codes'));
  }, [since]);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) {
        setPlans([]); setMembers([]); setTakings([]); setPacks([]); setPromos([]);
        return;
      }
      // supabase-js resolves with { data, error } on a database error rather
      // than rejecting, so the error is read off the result, not caught. The
      // name is cosmetic here and the failure is reported by the sidebar's own
      // dash; nothing on this page is computed from it.
      const { data: t, error } = await supabase
        .from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) setGymName(error ? null : ((t as any)?.name ?? null));
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const unread = (rows: unknown[] | null, e: string | null): Unread =>
    rows !== null ? null : e ? 'failed' : 'loading';

  /* ── the forecast ──────────────────────────────────────────────────────── */

  const recurring = useMemo(
    () => (plans && members ? buildRecurring(plans, members) : null),
    [plans, members],
  );

  /* ── the till ──────────────────────────────────────────────────────────── */

  const cash = useMemo(() => (takings ? buildCash(takings) : null), [takings]);

  /* ── what the money was for ────────────────────────────────────────────── */

  const split = useMemo(
    () => (takings && members ? buildSplit(takings, members) : null),
    [takings, members],
  );

  const packSummary = useMemo(() => (packs ? buildPacks(packs) : null), [packs]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/revenue">
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
      <Shell me={me} gymName={gymName} current="/revenue">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          This screen carries every price the gym charges and everything it has
          been paid, so it is owner-only.
        </p>
      </Shell>
    );
  }

  const plansUnread = unread(plans, plansErr);
  const membersUnread = unread(members, membersErr);
  const takingsUnread = unread(takings, takingsErr);

  // The forecast needs both the price book and the memberships. Name whichever
  // did not arrive: a bare dash under the note "no priced membership" is how a
  // failed read starts being read as a gym that sells nothing.
  const forecastMissing = [
    plansErr ? 'the price book' : null,
    membersErr ? 'the memberships' : null,
  ].filter((s): s is string => s !== null);
  const forecastNote = forecastMissing.length
    ? `could not read ${forecastMissing.join(' or ')}`
    : plansUnread || membersUnread
      ? 'still reading'
      : recurring?.reason;

  return (
    <Shell me={me} gymName={gymName} current="/revenue">
      <h1>Revenue</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What the price book says the gym is contracted to bill each month, what
        the till says actually arrived in the last {DAYS} days, and which plans
        are carrying it. Recorded in /money — only read here.
      </p>

      <Banner>
        <strong>Recurring is a forecast of billing, not money received.</strong>{' '}
        It is every active membership priced at the plan it sits on. No card has
        been charged against it, and a membership frozen or cancelled tomorrow
        leaves it tomorrow. The only figures on this page that are money the gym
        holds are under &ldquo;What actually arrived&rdquo;.
      </Banner>

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Recurring / month"
          // `recurring.currency ?? 'AED'` sat here. That null is not an
          // absence to paper over — it is `oneCurrency()` reporting that the
          // contributing plans DISAGREE, so the tile was printing a sum across
          // two currencies and labelling the result dirhams. money() withholds
          // it now and the note says which of the reasons it is.
          text={recurring ? money(recurring.mrrCents, recurring.currency) : null}
          note={recurring?.mrrCents == null ? forecastNote
            : !recurring.currency ? 'these plans are priced in more than one currency, so there is no one total'
            : `forecast, ${recurring.pricedMembers} membership${recurring.pricedMembers === 1 ? '' : 's'}`}
        />
        <Kpi
          label={`Taken (${DAYS} days)`}
          text={cash ? money(cash.totalCents, cash.currency) : null}
          note={cash?.totalCents == null
            ? (takingsErr ? 'the payments could not be read' : takingsUnread ? 'still reading' : cash?.reason)
            : !cash.currency ? 'these payments are in more than one currency, so there is no one total'
            : `${cash.count} payment${cash.count === 1 ? '' : 's'}`}
        />
        <Kpi
          label="Active memberships"
          text={recurring ? String(recurring.activeMembers) : null}
          note={recurring
            ? (recurring.excludedMembers > 0
                ? `${recurring.excludedMembers} not in the forecast`
                : 'all priced and recurring')
            : forecastNote}
        />
        <Kpi
          label={`PT packs (${DAYS} days)`}
          text={packSummary?.paidCents == null ? null : (packSummary.paidCents / 100).toFixed(2)}
          note={packSummary
            ? (packSummary.paidCents == null
                ? (packSummary.paid === 0 ? 'none sold in the window' : 'no amount recorded on any of them')
                : 'no currency is recorded — see below')
            : (packsErr ? 'the PT packs could not be read' : 'still reading')}
        />
        <Kpi
          label="Excluded from the forecast"
          text={recurring ? String(recurring.excludedPlans) : null}
          note={recurring ? 'plans with no readable price' : forecastNote}
        />
      </div>

      {plansErr ? <Banner tone="crit">{plansErr}. Every figure drawn from the price book is unknown below, not zero.</Banner> : null}
      {membersErr ? <Banner tone="crit">{membersErr}. Nobody has cancelled — the list did not come back.</Banner> : null}
      {takingsErr ? <Banner tone="crit">{takingsErr}. This is not a quarter in which the gym took nothing.</Banner> : null}

      <Recurring r={recurring} state={plansUnread ?? membersUnread} />
      <Cash c={cash} state={takingsUnread} />
      <Split
        s={split}
        state={takingsUnread ?? membersUnread}
        packs={packSummary}
        packsState={unread(packs, packsErr)}
      />
      <Promos rows={promos} state={unread(promos, promosErr)} />
    </Shell>
  );
}

/* ── recurring revenue ─────────────────────────────────────────────────────── */

interface PlanLine {
  id: string;
  name: string;
  interval: PlanInterval;
  active: boolean;
  currency: string | null;
  priceCents: number | null;
  /** Active memberships sitting on this plan right now. */
  members: number;
  /** The plan's price expressed per month, or null when it does not recur or
   *  cannot be read. */
  monthlyCents: number | null;
  /** monthlyCents × members. Null for the same two reasons. */
  contributionCents: number | null;
}

interface RecurringView {
  lines: PlanLine[];
  mrrCents: number | null;
  /** The single currency the forecast is in, or null when the contributing
   *  plans disagree — in which case there is no total to state. */
  currency: string | null;
  /** Why mrrCents is null, in words, when it is. */
  reason: string | undefined;
  activeMembers: number;
  pricedMembers: number;
  excludedMembers: number;
  excludedPlans: number;
  onUnpriced: number;
  onOneOff: number;
  noPlan: number;
  missingPlan: number;
}

/**
 * Active memberships × the price of the plan they sit on, normalised to a month.
 *
 * A membership on a retired plan still counts: retiring a plan takes it off
 * sale, it does not stop billing the people already on it, and dropping them
 * here would understate the forecast by every legacy member the gym has.
 */
function buildRecurring(plans: MembershipPlan[], memberships: Membership[]): RecurringView {
  const byPlan = new Map(plans.map((p) => [p.id, p]));
  const active = memberships.filter((m) => m.status === 'active');

  let noPlan = 0;
  let missingPlan = 0;
  const count = new Map<string, number>();
  for (const m of active) {
    if (!m.planId) { noPlan++; continue; }
    if (!byPlan.has(m.planId)) { missingPlan++; continue; }
    count.set(m.planId, (count.get(m.planId) ?? 0) + 1);
  }

  const lines: PlanLine[] = plans.map((p): PlanLine => {
    // The column is typed non-null, and the database is not the only thing that
    // can put a null in it. Number.isFinite is the check that survives both.
    const priceCents = Number.isFinite(p.priceCents) ? p.priceCents : null;
    const members = count.get(p.id) ?? 0;
    const monthlyCents =
      priceCents == null ? null
      : p.interval === 'month' ? priceCents
      // A twelfth, rounded to the cent. It is a normalisation for comparison,
      // not an amount anybody is billed — nobody pays this in any given month.
      : p.interval === 'year' ? Math.round(priceCents / 12)
      // 'once' is a day pass or a joining fee. It recurs never, so it
      // contributes nothing at all rather than a twelfth of something.
      : null;
    return {
      id: p.id,
      name: p.name,
      interval: p.interval,
      active: p.active,
      currency: p.currency ?? null,
      priceCents,
      members,
      monthlyCents,
      contributionCents: monthlyCents == null ? null : monthlyCents * members,
    };
  });

  // Heaviest plan first — the question this table answers is "what is carrying
  // the gym", and the answer should not need a click. A plan with no readable
  // price still appears at its member count rather than being sorted to the
  // bottom with the empty ones: it is excluded from the money, not from view.
  lines.sort((a, b) => b.members - a.members || (b.contributionCents ?? -1) - (a.contributionCents ?? -1));

  const contributing = lines.filter((l) => l.contributionCents != null && l.members > 0);
  const currency = oneCurrency(contributing);

  // An average — or a sum — over an empty set is undefined, not zero. A gym
  // whose every active membership is off-plan has an unknown forecast, and
  // printing 0.00 there would tell an owner the plans they sold are worthless.
  const mrrCents =
    contributing.length === 0 || currency == null
      ? null
      : contributing.reduce((a, l) => a + (l.contributionCents ?? 0), 0);

  const reason =
    contributing.length === 0
      ? 'no active membership sits on a priced, recurring plan'
      : currency == null
        ? 'the contributing plans are priced in more than one currency'
        : undefined;

  const pricedMembers = contributing.reduce((a, l) => a + l.members, 0);
  const onUnpriced = lines.filter((l) => l.priceCents == null).reduce((a, l) => a + l.members, 0);
  const onOneOff = lines
    .filter((l) => l.priceCents != null && l.interval === 'once')
    .reduce((a, l) => a + l.members, 0);

  return {
    lines,
    mrrCents,
    currency,
    reason,
    activeMembers: active.length,
    pricedMembers,
    excludedMembers: active.length - pricedMembers,
    excludedPlans: lines.filter((l) => l.priceCents == null).length,
    onUnpriced,
    onOneOff,
    noPlan,
    missingPlan,
  };
}

function Recurring({ r, state }: { r: RecurringView | null; state: Unread }) {
  // No `?? 'AED'` at the end of this chain. The view's own currency where the
  // plans agree on one, otherwise the first line's — and null when neither
  // exists, which draws dashes down the column instead of pricing a British
  // gym's plans in dirhams.
  const ccy = r?.currency ?? r?.lines[0]?.currency ?? null;

  const cols: Column<PlanLine>[] = [
    { key: 'name', header: 'Plan', value: (l) => l.name,
      render: (l) => (
        <span>
          {l.name}
          {l.active ? null : (
            <span className="micro" style={{ marginLeft: 8 }}>retired</span>
          )}
        </span>
      ) },
    { key: 'billed', header: 'Billed', value: (l) => l.interval,
      render: (l) => (l.interval === 'once' ? 'one-off' : `per ${l.interval}`) },
    { key: 'price', header: 'Price', value: (l) => l.priceCents, numeric: true,
      render: (l) => l.priceCents == null
        ? <Dash why="no price recorded" />
        : <>{money(l.priceCents, l.currency)}</> },
    { key: 'members', header: 'Active members', value: (l) => l.members, numeric: true },
    { key: 'each', header: 'Per month each', value: (l) => l.monthlyCents, numeric: true,
      render: (l) => l.monthlyCents == null
        ? <Dash why={l.priceCents == null ? 'price unreadable' : 'does not recur'} />
        : <>{money(l.monthlyCents, l.currency)}</> },
    { key: 'contribution', header: 'Recurring / month', value: (l) => l.contributionCents, numeric: true,
      render: (l) => l.contributionCents == null
        ? <Dash why={l.priceCents == null ? 'excluded' : 'not recurring'} />
        : <>{money(l.contributionCents, l.currency)}</> },
    { key: 'share', header: 'Share', value: (l) => l.contributionCents, numeric: true,
      render: (l) => {
        const s = share(l.contributionCents, r?.mrrCents ?? null);
        return s ?? <Dash why={r?.mrrCents == null ? 'no total' : 'nothing to share'} />;
      } },
  ];

  return (
    <Section
      title="Recurring, and the plans carrying it"
      sub="Active memberships priced at the plan they sit on, heaviest plan first, so the ones carrying the gym are at the top. This is a forecast of what will be billed if nothing changes — none of it has arrived."
    >
      {state ? <Unresolved state={state} what="the price book and the memberships"
                           cost="the forecast is unknown, not zero" /> : null}
      {r ? (
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {r.mrrCents == null ? (
              <>
                No monthly figure is stated: {r.reason}. That is an unknown, not a
                nil — the memberships below are real whether or not they can be priced.
              </>
            ) : (
              <>
                <strong>{money(r.mrrCents, ccy)}</strong> per month across{' '}
                {r.pricedMembers} active membership{r.pricedMembers === 1 ? '' : 's'}.
                A yearly plan is shown at a twelfth of its price so it can sit in the
                same column as a monthly one; nobody is billed that amount in any
                given month.
              </>
            )}
          </p>

          {r.excludedMembers > 0 || r.excludedPlans > 0 ? (
            <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--ring)' }}>
              <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>
                {r.excludedMembers > 0
                  ? `${r.excludedMembers} active membership${r.excludedMembers === 1 ? '' : 's'} contribute nothing to the figure above`
                  : 'What is not in the figure above'}
              </h3>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, color: 'var(--ink3)', fontSize: 12.5 }}>
                {r.excludedPlans > 0 ? (
                  <li>
                    {r.excludedPlans} plan{r.excludedPlans === 1 ? '' : 's'} whose price could
                    not be read, carrying {r.onUnpriced} active membership
                    {r.onUnpriced === 1 ? '' : 's'}. Excluded rather than counted as free — a
                    plan with no readable price is not a plan that costs nothing, and treating
                    it as one would shrink this forecast by exactly the amount nobody can see.
                  </li>
                ) : null}
                {r.onOneOff > 0 ? (
                  <li>{r.onOneOff} on a one-off plan — a day pass or a joining fee recurs never, so it is worth nothing per month, not a twelfth of its price.</li>
                ) : null}
                {r.noPlan > 0 ? (
                  <li>{r.noPlan} sold off-plan, with no plan attached at all. There is no price to apply.</li>
                ) : null}
                {r.missingPlan > 0 ? (
                  <li>{r.missingPlan} pointing at a plan that is not in the price book this console can read. The membership is real; its price is not visible from here.</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <DataTable
            rows={r.lines} columns={cols} rowKey={(l) => l.id}
            empty="The price book is empty. Until a gym prices something, there is no recurring revenue to forecast — which is different from a forecast of nothing."
          />
        </>
      ) : null}
    </Section>
  );
}

/* ── what actually arrived ─────────────────────────────────────────────────── */

interface Bucket {
  key: string;
  label: string;
  count: number;
  /** Rows in this bucket carrying no amount at all. */
  unpriced: number;
  cents: number | null;
  /**
   * The bucket's OWN currency, not the page's.
   *
   * A till holding AED card payments and USD transfers has no single currency,
   * so no overall total is stated — but each bucket still has one, and labelling
   * the USD row "AED" because that is what the page fell back to would be a
   * fabricated number wearing the right number of digits. `cents` is non-null
   * only when this is, so the pair can never disagree.
   */
  currency: string | null;
}

interface CashView {
  byMethod: Bucket[];
  totalCents: number | null;
  currency: string | null;
  count: number;
  unpriced: number;
  reason: string | undefined;
}

const METHOD_LABEL: Record<string, string> = {
  card: 'Card',
  cash: 'Cash',
  transfer: 'Bank transfer',
  direct_debit: 'Direct debit',
  other: 'Other',
};

function buildCash(rows: Taking[]): CashView {
  const priced = rows.filter((r) => r.amountCents != null);
  const currency = oneCurrency(priced);
  const totalCents = totalOf(rows);

  const groups = new Map<string, Taking[]>();
  for (const r of rows) {
    const k = r.method || 'other';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const byMethod: Bucket[] = [...groups.entries()].map(([k, rs]) => ({
    key: k,
    label: METHOD_LABEL[k] ?? k.replace('_', ' '),
    count: rs.length,
    unpriced: rs.filter((r) => r.amountCents == null).length,
    cents: totalOf(rs),
    currency: oneCurrency(rs.filter((r) => r.amountCents != null)),
  }));

  return {
    byMethod,
    totalCents,
    currency,
    count: rows.length,
    unpriced: rows.filter((r) => r.amountCents == null).length,
    // Three different silences, and the order matters: an empty priced set makes
    // `currency` null too, so "more than one currency" must be the last thing
    // checked or a quarter with no amounts on it would be blamed on the wrong
    // problem and sent to the wrong fix.
    reason:
      rows.length === 0
        ? 'nothing was recorded in the window'
        : priced.length === 0
          ? 'no payment carries an amount'
          : totalCents == null
            ? 'the payments are in more than one currency'
            : undefined,
  };
}

function Cash({ c, state }: { c: CashView | null; state: Unread }) {
  const ccy = c?.currency ?? null;

  const cols: Column<Bucket>[] = [
    { key: 'label', header: 'How it arrived', value: (b) => b.label },
    { key: 'count', header: 'Payments', value: (b) => b.count, numeric: true,
      render: (b) => (
        <span>
          {b.count}
          {b.unpriced ? <span className="dash"> ({b.unpriced} with no amount)</span> : null}
        </span>
      ) },
    { key: 'cents', header: 'Amount', value: (b) => b.cents, numeric: true,
      render: (b) => b.cents == null || b.currency == null
        ? <Dash why="no readable amount" />
        : <>{money(b.cents, b.currency)}</> },
    { key: 'share', header: 'Share', value: (b) => b.cents, numeric: true,
      render: (b) => {
        // A share only means anything when both halves are in the same money.
        const sameMoney = b.currency != null && b.currency === c?.currency;
        const s = sameMoney ? share(b.cents, c?.totalCents ?? null) : null;
        return s ?? <Dash why={
          c?.totalCents == null ? 'no total to share'
          : !sameMoney ? 'a different currency'
          : 'amounts unreadable'
        } />;
      } },
  ];

  return (
    <Section
      title="What actually arrived"
      sub={`Cash taken in the last ${DAYS} days, by method. Every row here exists because somebody recorded a payment — nothing is inferred from a membership price, and nothing is pro-rated.`}
    >
      {state ? <Unresolved state={state} what="the payments taken"
                           cost="this quarter is unknown, not empty" /> : null}
      {c ? (
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
            {c.totalCents == null ? (
              <>No total is stated: {c.reason}.</>
            ) : (
              <>
                <strong>{money(c.totalCents, ccy)}</strong> across {c.count} payment
                {c.count === 1 ? '' : 's'}. This is money the gym holds, and it is
                the only figure on this page that is.
                {c.unpriced ? ` ${c.unpriced} payment${c.unpriced === 1 ? ' carries' : 's carry'} no amount and ${c.unpriced === 1 ? 'is' : 'are'} left out of it rather than added as nothing.` : ''}
              </>
            )}
          </p>
          <DataTable
            rows={c.byMethod} columns={cols} rowKey={(b) => b.key}
            empty={`No payment was recorded in the last ${DAYS} days. That is not the same as no income — it is the same as nobody having entered one.`}
          />
        </>
      ) : null}
    </Section>
  );
}

/* ── what the money was for ────────────────────────────────────────────────── */

interface SplitView {
  buckets: Bucket[];
  totalCents: number | null;
  currency: string | null;
  /** Payments linked by `membership_id` rather than inferred from dates. */
  linked: number;
  inferred: number;
}

/**
 * Membership money against everything else, out of the till alone.
 *
 * `gym_payments` carries no category. `membership_id` is the only hard link and
 * /money does not write it, so most rows will not have one — which is why the
 * fallback exists: a payment from somebody who held a membership covering the
 * day it was taken is attributed to that membership. That is attribution, not
 * accounting, and the screen says so where it says the number.
 *
 * Date coverage is used regardless of the membership's CURRENT status: a
 * membership cancelled last week still covered a payment taken in June, and
 * filtering on status would move that money into "one-off" months after the
 * fact.
 */
function buildSplit(rows: Taking[], memberships: Membership[]): SplitView {
  const byMember = new Map<string, Membership[]>();
  for (const m of memberships) {
    byMember.set(m.memberId, [...(byMember.get(m.memberId) ?? []), m]);
  }

  const membership: Taking[] = [];
  const oneOff: Taking[] = [];
  const unattributed: Taking[] = [];
  let linked = 0;
  let inferred = 0;

  for (const r of rows) {
    if (r.membershipId) { membership.push(r); linked++; continue; }
    if (!r.memberId) { unattributed.push(r); continue; }
    const day = r.takenAt.slice(0, 10);
    const covered = (byMember.get(r.memberId) ?? []).some((m) => covers(m, day));
    if (covered) { membership.push(r); inferred++; } else { oneOff.push(r); }
  }

  const bucket = (key: string, label: string, rs: Taking[]): Bucket => ({
    key, label,
    count: rs.length,
    unpriced: rs.filter((x) => x.amountCents == null).length,
    cents: totalOf(rs),
    currency: oneCurrency(rs.filter((x) => x.amountCents != null)),
  });

  return {
    buckets: [
      bucket('membership', 'Memberships', membership),
      bucket('oneoff', 'One-off payments', oneOff),
      bucket('unattributed', 'Nobody’s name on it', unattributed),
    ],
    totalCents: totalOf(rows),
    currency: oneCurrency(rows.filter((r) => r.amountCents != null)),
    linked,
    inferred,
  };
}

interface PackView {
  paid: number;
  paidCents: number | null;
  unpriced: number;
  other: number;
  sessionsSold: number | null;
  sessionsUsed: number;
}

function buildPacks(packs: Pack[]): PackView {
  const paid = packs.filter((p) => p.status === 'paid');
  const priced = paid.filter((p) => p.amountCents != null);
  const withSessions = paid.filter((p) => p.sessionsTotal != null);
  return {
    paid: paid.length,
    // No currency column on client_purchases, so there is nothing to reconcile
    // this against — it is a bare integer of minor units and is rendered as one.
    paidCents: priced.length ? priced.reduce((a, p) => a + (p.amountCents ?? 0), 0) : null,
    unpriced: paid.length - priced.length,
    other: packs.length - paid.length,
    sessionsSold: withSessions.length ? withSessions.reduce((a, p) => a + (p.sessionsTotal ?? 0), 0) : null,
    sessionsUsed: paid.reduce((a, p) => a + p.sessionsUsed, 0),
  };
}

function Split({ s, state, packs, packsState }: {
  s: SplitView | null; state: Unread; packs: PackView | null; packsState: Unread;
}) {
  // No page-level currency fallback here on purpose: every amount below is
  // labelled with its own bucket's currency or not shown at all.
  const cols: Column<Bucket>[] = [
    { key: 'label', header: 'What it was for', value: (b) => b.label },
    { key: 'count', header: 'Payments', value: (b) => b.count, numeric: true },
    { key: 'cents', header: 'Amount', value: (b) => b.cents, numeric: true,
      render: (b) => b.cents == null || b.currency == null
        ? <Dash why={b.count === 0 ? 'no payment landed here' : 'no readable amount'} />
        : <>{money(b.cents, b.currency)}</> },
    { key: 'share', header: 'Share of the till', value: (b) => b.cents, numeric: true,
      render: (b) => {
        const sameMoney = b.currency != null && b.currency === s?.currency;
        const sh = sameMoney ? share(b.cents, s?.totalCents ?? null) : null;
        // Four reasons a share is absent, and they are not interchangeable: an
        // empty bucket, a bucket in another currency, unreadable amounts, and a
        // till with no total to be a share of.
        return sh ?? <Dash why={
          b.count === 0 ? 'nothing in this bucket'
          : s?.totalCents == null ? 'no till total'
          : !sameMoney ? 'a different currency'
          : 'amounts unreadable'
        } />;
      } },
  ];

  return (
    <Section
      title="What the money was for"
      sub="The till split three ways, and the PT ledger shown beside it rather than inside it."
    >
      {state ? <Unresolved state={state} what="the payments and the memberships"
                           cost="the money is real, but what it was for is unknown" /> : null}
      {s ? (
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            The payments table holds no category, so this is attribution rather than
            accounting. {s.linked} payment{s.linked === 1 ? ' carries' : 's carry'} a
            membership on the row itself; {s.inferred} {s.inferred === 1 ? 'is' : 'are'}{' '}
            attributed because the payer held a membership covering the day the money
            was taken. Nothing is guessed from the amount, and a payment with nobody&rsquo;s
            name on it is counted in the till and left unattributed rather than pushed
            into whichever bucket looks tidier.
          </p>
          <DataTable
            rows={s.buckets} columns={cols} rowKey={(b) => b.key}
            empty={`No payment was recorded in the last ${DAYS} days, so there is nothing to attribute.`}
          />
        </>
      ) : null}

      <div style={{ borderTop: '1px solid var(--ring)' }}>
        <div style={{ padding: '11px 14px' }}>
          <h3 style={{ fontSize: 13, margin: 0, color: 'var(--ink2)' }}>PT packs</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12 }}>
            A different ledger. <span className="mono">client_purchases</span> is the
            trainer&rsquo;s own checkout trail: it carries no tenant column — these rows are
            scoped by the trainers on this gym&rsquo;s roster, so a purchase against a
            trainer who is not on it is not counted — and no currency column, so the
            amount below is minor units with nothing to name them. Nothing links a
            purchase to a row in the till, so it is shown here and never added to the
            figures above: summing them would double-count every pack the gym also
            rang up at the desk, and ignoring it would drop the rest.
          </p>
        </div>
        {packsState ? (
          <Unresolved state={packsState} what="the PT packs"
                      cost="pack revenue is unknown, not nil" />
        ) : packs ? (
          <p style={{ margin: 0, padding: '0 14px 14px', color: 'var(--ink2)', fontSize: 13 }}>
            {packs.paid === 0 ? (
              <>No pack was bought in the last {DAYS} days.</>
            ) : (
              <>
                {packs.paid} pack{packs.paid === 1 ? '' : 's'} paid for.{' '}
                {packs.paidCents == null
                  ? <>Not one carries an amount, so the money is <span className="dash">unknown</span>, not nothing.</>
                  : <>
                      <span className="mono">{(packs.paidCents / 100).toFixed(2)}</span> in minor
                      units, currency unrecorded.
                      {packs.unpriced ? ` ${packs.unpriced} pack${packs.unpriced === 1 ? ' carries' : 's carry'} no amount and ${packs.unpriced === 1 ? 'is' : 'are'} left out of it.` : ''}
                    </>}
                {' '}
                {packs.sessionsSold == null
                  ? <>No pack states how many sessions it bought, so nothing can be said about what is still owed in hours.</>
                  : <>{packs.sessionsSold} session{packs.sessionsSold === 1 ? '' : 's'} sold, {packs.sessionsUsed} delivered — the difference is coaching the gym has been paid for and still owes.</>}
                {packs.other ? ` A further ${packs.other} purchase${packs.other === 1 ? ' is' : 's are'} not marked paid and ${packs.other === 1 ? 'is' : 'are'} counted in neither.` : ''}
              </>
            )}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/* ── promo codes ───────────────────────────────────────────────────────────── */

function Promos({ rows, state }: { rows: Promo[] | null; state: Unread }) {
  const cols: Column<Promo>[] = [
    { key: 'code', header: 'Code', value: (p) => p.code,
      render: (p) => <span className="mono">{p.code}</span> },
    { key: 'discount', header: 'Discount', value: (p) => p.discount, numeric: true,
      render: (p) => p.discount == null ? <Dash why="not recorded" /> : <>{p.discount}%</> },
    { key: 'redemptions', header: 'Redemptions', value: (p) => p.redemptions, numeric: true,
      render: (p) => p.redemptions == null ? <Dash why="not counted" /> : <>{p.redemptions}</> },
    { key: 'cost', header: 'Given away', value: () => null,
      render: () => <Dash why="no redemption is linked to a payment" /> },
    { key: 'active', header: 'Status', value: (p) => (p.active ? 'live' : 'off'),
      render: (p) => p.active
        ? <span style={{ color: 'var(--good)' }}>live</span>
        : <span className="dash">off</span> },
  ];

  return (
    <Section
      title="Promo codes"
      sub="What is discounting the price book, and the one thing this console cannot tell you about it."
    >
      {state ? <Unresolved state={state} what="the promo codes" /> : null}
      {rows ? (
        <>
          <p style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            The &ldquo;given away&rdquo; column is a dash on every row and will stay one until a
            redemption records which payment it applied to. The table counts redemptions
            and knows each code&rsquo;s percentage, but a percentage of an unknown price is
            not an amount — multiplying the two would produce a confident-looking
            figure for money the record cannot account for.
          </p>
          <DataTable
            rows={rows} columns={cols} rowKey={(p) => p.id}
            empty="No promo code has been created. Nothing is discounting the price book."
          />
        </>
      ) : null}
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * Payments in the window, including the membership link.
 *
 * `.error` is checked, not assumed. supabase-js RESOLVES on a database error,
 * so without this an RLS refusal arrives as `data: null`, falls through `?? []`
 * and this screen reports a gym that took nothing in a quarter — while still
 * printing a confident forecast beside it.
 */
async function fetchTakings(tenantId: string, sinceIso: string): Promise<Taking[]> {
  const { data, error } = await supabase
    .from('gym_payments')
    .select('id, member_id, membership_id, amount_cents, currency, method, taken_at')
    .eq('tenant_id', tenantId)
    .gte('taken_at', sinceIso)
    .order('taken_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    memberId: r.member_id ?? null,
    membershipId: r.membership_id ?? null,
    amountCents: Number.isFinite(r.amount_cents) ? r.amount_cents : null,
    // Not `?? 'AED'`. The column is `not null default 'AED'`, so this branch
    // does not fire in practice — and every currency bug in this repo was built
    // out of "in practice". Null reaches money(), which withholds the figure.
    currency: r.currency ?? null,
    method: r.method ?? 'other',
    takenAt: r.taken_at,
  }));
}

/**
 * PT packs bought through this gym's trainers.
 *
 * `client_purchases` has no tenant_id — it hangs off a trainer profile — so the
 * tenant scope has to be applied by hand, through the roster. The roster read
 * throws rather than defaulting to an empty list: an empty `in()` and a refused
 * roster would both produce "no packs", and one of those is a gym with no PT
 * revenue while the other is a query nobody may draw a conclusion from.
 */
async function fetchPacks(tenantId: string, sinceIso: string): Promise<Pack[]> {
  const { data: trs, error: trErr } = await supabase
    .from('trainers').select('id').eq('tenant_id', tenantId);
  if (trErr) throw trErr;

  const ids: string[] = (trs ?? []).map((r: any) => r.id);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('client_purchases')
    .select('id, amount_cents, sessions_total, sessions_used, status, created_at')
    .in('trainer_id', ids)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    amountCents: Number.isFinite(r.amount_cents) ? r.amount_cents : null,
    sessionsTotal: Number.isFinite(r.sessions_total) ? r.sessions_total : null,
    sessionsUsed: Number.isFinite(r.sessions_used) ? r.sessions_used : 0,
    status: r.status ?? 'paid',
    createdAt: r.created_at,
  }));
}

async function fetchPromos(tenantId: string): Promise<Promo[]> {
  const { data, error } = await supabase
    .from('promos')
    .select('id, code, discount, active, redemptions')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    code: r.code,
    discount: Number.isFinite(r.discount) ? r.discount : null,
    active: r.active !== false,
    redemptions: Number.isFinite(r.redemptions) ? r.redemptions : null,
  }));
}

/* ── arithmetic that is allowed to refuse ──────────────────────────────────── */

/** The one currency these rows share, or null when they share none — because a
 *  sum across two currencies is not a sum, it is a bigger number. */
function oneCurrency(rows: { currency: string | null }[]): string | null {
  // A row with no currency of its own is not a row that agrees with the others
  // — it is a row that cannot be added to them — so it collapses the answer to
  // null exactly as a genuine disagreement does.
  const set = new Set(rows.map((r) => r.currency));
  return set.size === 1 ? [...set][0] : null;
}

/** Integer minor units only, and null wherever a total would be a claim rather
 *  than a fact: nothing readable to add, or more than one currency in the pile. */
function totalOf(rows: { amountCents: number | null; currency: string | null }[]): number | null {
  const known = rows.filter((r) => r.amountCents != null);
  if (!known.length) return null;
  if (oneCurrency(known) == null) return null;
  return known.reduce((a, r) => a + (r.amountCents ?? 0), 0);
}

/**
 * A percentage, or null.
 *
 * The denominator is the whole point. A share of an unknown total is unknown,
 * and a share of zero is undefined rather than 0% — so both return null and the
 * caller renders a dash instead of a figure that would sum to 100% of nothing.
 */
function share(part: number | null, whole: number | null): string | null {
  if (part == null || whole == null || whole === 0) return null;
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** Did this membership cover the day the money arrived? Plain ISO date strings,
 *  compared as strings, which is exactly what ISO dates are for. */
function covers(m: Membership, day: string): boolean {
  if (m.startedOn > day) return false;
  return m.endsOn == null || m.endsOn >= day;
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

/** A figure that does not exist, and the reason beside it. Never a zero. */
function Dash({ why }: { why: string }) {
  return <span className="dash">— {why}</span>;
}

function Unresolved({ state, what, cost }: {
  state: Exclude<Unread, null>; what: string; cost?: string;
}) {
  if (state === 'loading') return <Loading />;
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {what}. This section is <strong>unknown</strong>, not empty
      {cost ? <> — {cost}</> : null}. Reload before acting on anything above it.
    </div>
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
