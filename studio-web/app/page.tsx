'use client';

// Overview — the gym at a glance.
//
// Every figure here comes from `gymRollup`, the same function the phone app
// uses, reading the same rows through the same row-level policies. Nothing is
// computed twice and nothing is estimated: where the gym has not recorded
// something, this shows a dash and says what is missing.
import { useEffect, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { Kpi } from '@/components/Kpi';
import { DataTable, type Column } from '@/components/DataTable';
import { PasswordField } from '@/components/PasswordField';
import { ConsoleGate } from '@/components/Gate';
import { failure } from '@/lib/read';
import { Banner as SharedBanner } from '@/components/Banner';
import { amount, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { fetchGymTrainers, payrollBlocker, type GymTrainer } from '@lib/gymTrainers';
import { gymDateText } from '@lib/gymWhen';
import { gymRollup, trainerHealth, type GymRollup } from '@lib/ownerAnalytics';
// Whole units to minor units, by the places the gym's own money actually has.
import { minorFromWhole } from '@lib/coachMoney';
import { fetchMemberships, fetchPayments, fetchPlans, summarise, type Membership } from '@lib/gymRecord';
import { fetchClasses, summariseAttendance, pct } from '@lib/gymSchedule';
import { fetchVisits, summariseVisits, currentlyInside, OPEN_VISIT_HOURS } from '@lib/gymVisits';
import { gymTodayWindow, inWindow } from '@lib/gymToday';
import { fetchOwnerMetrics, type OwnerMetrics } from '@/lib/ownerMetrics';
import { fetchOwnedSites } from '@/lib/sites';
import { siteNotice, type SiteScope } from '@lib/ownedSites';

interface Gym {
  id: string;
  name: string | null;
  sessionFee: number | null;
  /** `tenants.currency`. Null means the gym has not set one — which the schema
   *  says to render as a dash and ask about, never to fill in with a default. */
  currency: string | null;
  /** `tenants.timezone` (supabase/parts/710). Null is a gym that has not said
   *  whose day its day is — never UTC and never this laptop's. It is read here
   *  rather than in a second query because this page already asks `tenants` for
   *  the name and the fee, and "today" is the window three tiles are cut on. */
  timezone: string | null;
}

/**
 * One settled read, as a line for the banner. Null when it came back fine.
 *
 * The same helper /analytics, /equipment and /door carry, and it is here for
 * the reason they have it: `Promise.allSettled` hands back the rejection and
 * this page used to drop every one of them on the floor. A rejected read became
 * `null` rows, `null` rows became a `null` figure, and a `null` figure is what
 * this page's notes already word as "no payments recorded" and "no capacity
 * recorded" — two confident statements about the gym, assembled out of a query
 * that never answered, on the first screen an owner opens every morning.
 */
/** The note under a tile whose read was refused. One sentence, in one place,
 *  so five tiles cannot word the same silence five ways. */
const UNREAD = 'this read did not come back — unknown, not nil';

export default function Overview() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined — nobody said who
   *  this is — and this is what stops that reading as a spinner that never
   *  resolves, on the console's own front door. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gym, setGym] = useState<Gym | null>(null);
  // Kept apart from `error`: that one is cleared by a successful rollup read
  // immediately afterwards, which would wipe this message off the screen.
  const [gymErr, setGymErr] = useState<string | null>(null);
  const [trainers, setTrainers] = useState<GymTrainer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The rest of the business, so the departments can be seen against each
  // other rather than one screen at a time. Each is loaded independently and
  // allowed to fail on its own: a door log that will not read should not blank
  // out the revenue figure beside it.
  const [hub, setHub] = useState<{
    revenueCents: number | null;
    mrrCents: number | null;
    /* The currency each of those two sums is actually in — from the rows that
     * were added up, not from the gym's setting. Both totals ignore each row's
     * own currency, and `gym_payments.currency` / `membership_plans.currency`
     * are `not null default 'AED'`, so a gym that has since set GBP had its
     * legacy dirhams added to its pounds and this tile labelled the result GBP.
     * Null means the contributing rows disagree, and a total that cannot be
     * denominated is withheld. */
    revenueCurrency: string | null;
    mrrCurrency: string | null;
    /* Whether there were any contributing rows at all. An empty set states no
     * currency to disagree with, so the gym's own is the honest label there —
     * and that is a different fact from rows that state two. */
    revenueRows: number;
    activeMembers: number | null;
    fillRate: number | null;
    visitsToday: number | null;
    inNow: number | null;
    /** Whose calendar "today" was cut on, when it was not the gym's own —
     *  `NO_ZONE_NOTE`, from `gymTodayWindow`. Null when `tenants.timezone` is
     *  set and there is nothing to disclose. A count of arrivals "today" is a
     *  claim about a day, and a screen that will not say which day it means is
     *  the reason this page was quietly reporting UTC's. */
    dayNote: string | null;

    /* ── which departments actually answered ──────────────────────────────
     *
     * Every figure above is null for TWO unrelated reasons — the gym has not
     * recorded the thing, or the query was refused — and the note under each
     * tile picks its wording from the figure alone. So a payments read that
     * RLS refused rendered as "no payments recorded" and a refused classes
     * read as "no capacity recorded": the console telling an owner facts about
     * their gym that nothing had established. These three bits are what let
     * each tile say which of the two silences it is in, and they are per
     * DEPARTMENT rather than one page-wide flag because allSettled exists
     * precisely so a broken door log does not blank out the revenue beside it.
     */
    /** memberships + payments + plans all came back. `summarise` needs all
     *  three, so one refusal makes every figure it produces unknown. */
    recordRead: boolean;
    classesRead: boolean;
    doorRead: boolean;
  } | null>(null);
  // Kept apart from `error`, which belongs to the roster read: these are the
  // five hub reads, and a failure in one of them must be SAID rather than
  // inferred from a dash. Named one by one, because "could not read" without
  // saying which query broke leaves an owner unable to tell anyone what is down.
  const [hubErr, setHubErr] = useState<string | null>(null);

  /**
   * How many gyms this account owns, and which of them this page is showing.
   *
   * Starts as 'loading' and not as one gym: an owner recorded against two sites
   * and an owner with one are indistinguishable until this read settles, and
   * the difference is what every figure below means. `siteNotice` says nothing
   * at all for the ordinary one-gym case, so this is invisible on every console
   * on the platform until a row is written into `owner_sites` — see
   * supabase/parts/290 and src/lib/ownedSites.ts.
   */
  const [sites, setSites] = useState<SiteScope>({ status: 'loading', sites: [] });

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      // Not `null`. Signed out and unreachable are different facts, and on THIS
      // screen the wrong one puts a sign-in form in front of somebody who is
      // already signed in and sends them to re-enter a working password.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);

      // Before the tenant guard, because it is the read that says whether the
      // tenant below is the whole of this owner's business. It carries its own
      // status, so a refusal arrives as UNKNOWN rather than as one gym.
      const owned = await fetchOwnedSites();
      if (!live) return;
      setSites(owned);

      if (!who?.tenantId) { setTrainers([]); return; }

      // supabase-js RESOLVES with { data, error } rather than throwing, so
      // taking only `data` turns an RLS refusal into `t === null` — which used
      // to render as a gym with no name and no session fee. Both are then
      // stated as facts about the gym: the sidebar says no gym is linked, and
      // the payroll note below says no fee is set. Neither is known to be true.
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('id, name, session_fee, currency, timezone').eq('id', who.tenantId).single();
      if (!live) return;
      setGymErr(tErr ? (tErr.message || 'The gym record could not be read.') : null);
      const zone = t && !tErr ? (((t.timezone ?? '') as string).trim() || null) : null;
      setGym(t && !tErr
        ? {
            id: t.id,
            name: t.name ?? null,
            sessionFee: t.session_fee ?? null,
            currency: ((t.currency ?? '') as string).trim().toUpperCase() || null,
            timezone: zone,
          }
        : null);

      try {
        const rows = await fetchGymTrainers(supabase, who.tenantId);
        if (live) setTrainers(rows);
      } catch (e: any) {
        // Null, not []. An empty roster is fed to `gymRollup`, which answers
        // 0 trainers, 0 clients, 0 sessions and 0 needing a look — six invented
        // figures — and the table below it says "No trainers in this gym yet.
        // Invite one." to an owner whose roster is full and whose read failed.
        if (live) { setError(e?.message ?? 'Could not read the roster.'); setTrainers(null); }
      }

      // allSettled, not all: one failing read must not take the others with it.
      // A department that cannot be read shows a dash; the rest still report.
      const from30 = new Date(Date.now() - 30 * 86400_000).toISOString();

      // ── "today", on the gym's calendar and not on UTC's ──────────────────
      //
      // This was `new Date(new Date().toISOString().slice(0, 10) +
      // 'T00:00:00Z')`, which is UTC midnight with the word today on it. For a
      // gym in Los Angeles that instant is 4pm or 5pm the PREVIOUS afternoon,
      // so at nine in the morning the tile below had been counting since
      // yesterday teatime and last night's 6pm and 8pm classes were in it —
      // every day, with nothing on the tile to say so. Dubai fails the other
      // way: UTC's day does not turn over until 4am there, so the 5am and 6am
      // regulars were not in "today" at all until the morning was half gone.
      //
      // `gymTodayWindow` (src/lib/gymToday.ts) cuts the day on
      // `tenants.timezone`. A gym that has not set one gets its READER's day
      // and `window.note` says so under the tile — that is not a default
      // timezone, it is the only one of the three answers that discloses which
      // calendar it used.
      const today = gymTodayWindow(zone);

      // The door read reaches back the FURTHER of the gym's day and
      // `OPEN_VISIT_HOURS`, and the two figures below are then cut out of it
      // separately. They are different questions: "through the door today" is
      // this calendar day, and "in the building" is whoever has an open visit
      // that still counts as a person in the room. Asking one window to answer
      // both is what would make a member who arrived at 11pm and was never
      // checked out vanish out of the headcount at midnight.
      const openFrom = new Date(Date.now() - OPEN_VISIT_HOURS * 3600_000).toISOString();
      const doorSince = today.fromISO < openFrom ? today.fromISO : openFrom;
      const [mRes, pRes, plRes, cRes, vRes] = await Promise.allSettled([
        fetchMemberships(supabase, who.tenantId),
        fetchPayments(supabase, who.tenantId, from30),   // windowed: the tile says 30d
        fetchPlans(supabase, who.tenantId),
        fetchClasses(supabase, who.tenantId, from30, new Date().toISOString()),
        fetchVisits(supabase, who.tenantId, { sinceIso: doorSince }),
      ]);
      if (!live) return;

      const memberships = mRes.status === 'fulfilled' ? mRes.value : null;
      const payments = pRes.status === 'fulfilled' ? pRes.value : null;
      const plans = plRes.status === 'fulfilled' ? plRes.value : null;
      const classes = cRes.status === 'fulfilled' ? cRes.value : null;
      const visits = vRes.status === 'fulfilled' ? vRes.value : null;

      const rec = (memberships && payments && plans) ? summarise(payments, memberships, plans) : null;
      const att = classes ? summariseAttendance(classes) : null;
      // Today's arrivals are the ones inside the gym's own day; the headcount
      // is over everything fetched, because an open visit is a person in the
      // room whichever calendar day it started on.
      const door = visits ? summariseVisits(visits.filter((v) => inWindow(v.enteredAt, today))) : null;
      const inNow = visits ? currentlyInside(visits).length : null;

      // Named, not swallowed. Each rejection carries the reason PostgREST gave
      // and the banner prints it: a refused read is something an owner can act
      // on — reload, or tell whoever runs the database — and a dash on its own
      // is not.
      const trouble = [
        failure(mRes, 'the memberships'),
        failure(pRes, "the last 30 days' payments"),
        failure(plRes, 'the price book'),
        failure(cRes, "the last 30 days' classes"),
        failure(vRes, "today's door log"),
      ].filter((s): s is string => s !== null);
      setHubErr(trouble.length === 0 ? null : trouble.join(' · '));

      // Every figure is null rather than 0 when the read failed or the gym has
      // recorded nothing. summarise and summariseAttendance already refuse to
      // invent a denominator; this must not undo that on the way to the screen.
      setHub({
        revenueCents: rec?.takenCents ?? null,
        mrrCents: rec?.mrrCents ?? null,
        revenueCurrency: rec?.takenCurrency ?? null,
        mrrCurrency: rec?.mrrCurrency ?? null,
        revenueRows: rec?.payments ?? 0,
        activeMembers: rec ? rec.activeMembers : null,
        fillRate: att?.fillRate ?? null,
        visitsToday: door ? door.visits : null,
        inNow,
        dayNote: today.note,
        recordRead: memberships !== null && payments !== null && plans !== null,
        classesRead: classes !== null,
        doorRead: visits !== null,
      });
    })();
    return () => { live = false; };
  }, []);

  /* ── the engagement figures, from owner-metrics ────────────────────────
   *
   * `supabase/functions/owner-metrics` has been deployed, tenant-scoped and
   * correct since part 39 closed the cross-gym leak in it, and until now it was
   * invoked by nothing at all — which docs/OWNER-PORTAL.md calls, accurately, "a
   * trap for the next person". This is its caller.
   *
   * It is used for the figures this page cannot honestly compute from the
   * browser and no other: how many members trained at all in the last thirty
   * days, how many workouts and scans there were. Each of those needs a paged
   * read across `workouts` or `scans` joined through the person's profile, and
   * a browser doing it hits PostgREST's row ceiling and quietly reports a
   * fraction. The function pages properly and — this is why it is worth calling
   * rather than reimplementing — it drops a metric it could not compute WHOLE
   * rather than returning a short one.
   *
   * `live` is that contract: a metric absent from it is unknown, and this page
   * renders a dash. Nothing here falls back to sample data, which is the other
   * thing the function's own header records having gone wrong.
   */
  const [engage, setEngage] = useState<OwnerMetrics | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetchOwnerMetrics().then((m) => { if (live) setEngage(m); });
    return () => { live = false; };
  }, []);

  // Three sentences, not one div and a form. See components/Gate.tsx: a
  // question we could not ask is not the same fact as nobody being signed in.
  if (authUnread) return <ConsoleGate me={undefined} failed />;
  if (me === undefined) return <Splash>Reading your account…</Splash>;
  if (me === null) return <SignIn />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gym?.name ?? null} sites={sites} current="/">
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
      <Shell me={me} gymName={gym?.name ?? null} current="/">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', maxWidth: '60ch', marginTop: 10 }}>
          This screen is for gym owners. Your account is{' '}
          <strong>{me.role ?? 'without a role'}</strong>.
          {me.role === 'trainer' ? (
            <>
              {' '}The <a href="/door">Door</a> is yours though &mdash; checking people in and out is
              staff work, and it is in your menu.
            </>
          ) : (
            <> If that is wrong, ask whoever runs the gym to change it.</>
          )}
        </p>
      </Shell>
    );
  }

  const roll: GymRollup | null = trainers ? gymRollup(trainers, gym?.sessionFee ?? null) : null;
  const ccy: TenantCurrency = gym?.currency ?? null;
  // The currency each of the two money tiles is actually in. An empty set of
  // rows states nothing, so the gym's own currency is the honest label; a set
  // whose rows disagree has no single currency, and a null is what makes
  // `amount()` withhold rather than pick whichever row happened to be first.
  const takenCcy: TenantCurrency = hub == null || hub.revenueRows === 0 ? ccy : hub.revenueCurrency;
  const mrrCcy: TenantCurrency = hub == null || hub.mrrCents == null ? ccy : hub.mrrCurrency;

  const cols: Column<GymTrainer>[] = [
    { key: 'name', header: 'Trainer', value: (t) => t.name },
    { key: 'clients', header: 'Clients', value: (t) => t.clients, numeric: true },
    { key: 'delivered30', header: 'Delivered', value: (t) => t.delivered30, numeric: true },
    {
      key: 'unmarked30', header: 'Unmarked', value: (t) => t.unmarked30, numeric: true,
      render: (t) =>
        t.unmarked30 === 0
          ? <span className="dash">—</span>
          : <span style={{ color: 'var(--warn)' }}>{t.unmarked30}</span>,
    },
    {
      key: 'risk',
      header: 'Status',
      value: (t) => trainerHealth(t).risk,
      render: (t) => {
        const { risk } = trainerHealth(t);
        const tone =
          risk === 'ok' ? 'var(--good)' : risk === 'watch' ? 'var(--warn)'
          : risk === 'high' ? 'var(--crit)' : 'var(--ink3)';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 0, background: tone }} />
            <span style={{ color: 'var(--ink2)', textTransform: 'capitalize' }}>{risk}</span>
          </span>
        );
      },
    },
    {
      key: 'since',
      header: 'Since',
      value: (t) => t.since,
      // `gym?.timezone`, not the reader's. A coach who joined at 22:00 on the
      // 31st in Dubai joined in September, whichever laptop this is open on.
      render: (t) => gymDateText(t.since, gym?.timezone ?? null) ?? <span className="dash">—</span>,
    },
  ];

  return (
    <Shell me={me} gymName={gym?.name ?? null} current="/">
      <h1>Overview</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        {gym?.name ? `${gym.name} · last 30 days` : 'Last 30 days'}
      </p>

      {/* Which gym these figures are. Null — so nothing renders — for a settled
          read of one gym, which is every account on the platform today. Not
          null when the site read failed, because a two-site owner and a
          one-site owner are indistinguishable then and the tiles below would
          otherwise read as the whole business. */}
      {siteNotice(sites) ? <Notice>{siteNotice(sites)}</Notice> : null}

      {!me.tenantId ? (
        <Notice>
          Your account is not linked to a gym yet, so there is nothing to show. Whoever set up the
          gym needs to add you as its owner.
        </Notice>
      ) : null}

      {gymErr ? (
        <Notice tone="crit">
          Your gym record could not be read, so its name and session fee are missing here — not
          unset. Anything below that depends on the fee is unpriced rather than free: {gymErr}
        </Notice>
      ) : null}

      {error ? <Notice tone="crit">{error}</Notice> : null}

      {/* The hub reads, when one of them did not answer. Above the tiles rather
          than beside them, because the tiles are the thing being qualified:
          anything dashed below with "could not be read" under it is explained
          here, and nothing on this page is allowed to report a refusal as a
          gym that has recorded nothing. */}
      {hubErr ? (
        <Notice tone="crit">
          <div>{hubErr}</div>
          <div style={{ marginTop: 6 }}>
            The tiles those reads feed are dashed because nobody knows, not because the gym recorded
            nothing — each one says which underneath it.
          </div>
        </Notice>
      ) : null}


      {/* The morning glance — the whole operation on one line, so departments
          can be read against each other rather than one screen at a time.
          Anything not recorded shows a dash and says what is missing; none of
          these tiles is allowed to guess. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
          gap: 1,
          background: 'var(--ring)',
          border: '1px solid var(--ring)',
          borderRadius: 0,
          overflow: 'hidden',
          margin: '20px 0 10px',
        }}
      >
        {/* `amount`, not `money`. Both of these are sums with no currency of
            their own, so they inherit the gym's, and `amount()` is the door
            that takes one.

            `money()` used to print "AED" over whatever it was not told — a
            considered-looking figure in a currency this gym may never have
            charged in — which is why this note existed. That default is gone:
            money() now withholds a figure it cannot denominate, so both doors
            are safe and this one is simply the clearer of the two. A dash
            naming the unset setting is still the honest tile. */}
        {/* `UNREAD` first in every note below, because it is the only branch
            that is a statement about the QUERY rather than about the gym. The
            three that follow it — nothing recorded, no currency set, rows in
            two currencies — are all facts established by a read that returned,
            and printing any of them over a read that did not is the defect this
            page carried: an owner reading "no payments recorded" goes and asks
            the desk why nobody took any money. */}
        <Kpi big label="Taken · 30d" text={hub && hub.recordRead ? amount(hub.revenueCents, takenCcy) : null}
             note={hub && !hub.recordRead ? UNREAD
               : hub && hub.revenueCents == null ? 'no payments recorded'
               : hub && !takenCcy
                 ? (hub.revenueRows > 0 && hub.revenueCurrency === null
                     ? 'these payments are in more than one currency, so there is no one total'
                     : NO_CURRENCY_NOTE)
               : undefined} />
        <Kpi big label="Recurring / mo" text={hub && hub.recordRead ? amount(hub.mrrCents, mrrCcy) : null}
             note={hub && !hub.recordRead ? UNREAD
               : hub && hub.mrrCents == null ? 'no priced plan on an active membership'
               : hub && !mrrCcy
                 ? (hub.mrrCurrency === null
                     ? 'these plans are priced in more than one currency, so there is no one total'
                     : NO_CURRENCY_NOTE)
               : undefined} />
        {/* A member count is the tile most obviously read as a fact, so it is
            the one that must not carry a 0 out of a refused read. `summarise`
            already returns a number rather than a null here, so the guard has
            to be the read itself. */}
        <Kpi big label="Active members" value={hub && hub.recordRead ? hub.activeMembers : null}
             note={hub && !hub.recordRead ? UNREAD : undefined} />
        <Kpi big label="Class fill" text={hub && hub.classesRead ? pct(hub.fillRate) : null}
             note={hub && !hub.classesRead ? UNREAD
               : hub && hub.fillRate == null ? 'no capacity recorded'
               : 'booked ÷ capacity'} />
        {/* "Today" is the GYM's day — see `gymTodayWindow` in the loader. Where
            the gym has not set a timezone the count is still stated, and the
            note says whose day it was counted over rather than leaving an owner
            to assume it was theirs. */}
        <Kpi big label="In the building" value={hub && hub.doorRead ? hub.inNow : null}
             note={hub && !hub.doorRead ? UNREAD
               : hub?.visitsToday != null
                 ? `${hub.visitsToday} through the door today${hub.dayNote ? ` — ${hub.dayNote}` : ''}`
               : undefined} />
        {/* There is no "Cash position" tile any more, and its removal is the
            same repair as everything above it.

            It rendered a hardcoded dash under the note "connect accounting" —
            for every gym, every morning, permanently. Two things were wrong
            with that. The smaller one is that there is nothing to connect:
            Repple has no bank feed and no accounting integration, so the note
            was an instruction to perform an action that does not exist, and an
            owner who went looking for it found nothing and concluded the
            console was half-built. The larger one is what a permanent dash does
            to every other dash on this page. Five tiles beside it use a dash to
            mean something precise and actionable — this was not recorded, this
            has no currency, this read was refused — and a sixth that is dashed
            unconditionally teaches the reader that dashes here are decoration.
            Cash in and cash out for a finished month, on a stated cash basis,
            are on /accounting; a bank balance is not something this product
            holds, and a tile is not the place to say so. */}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
          gap: 1,
          background: 'var(--ring)',
          border: '1px solid var(--ring)',
          borderRadius: 0,
          overflow: 'hidden',
          margin: '20px 0 24px',
        }}
      >
        <Kpi big label="Trainers" value={roll?.trainers} />
        <Kpi big label="Clients" value={roll?.clients} />
        <Kpi big label="Sessions 30d" value={roll?.sessions30} />
        <Kpi big
          label="Session value 30d"
          // WHOLE units from payroll30For, converted to the minor units
          // `amount` takes. It went out as a bare `value` before — a money
          // figure with nothing at all to say what money it was, on the tile an
          // owner reads first. Now it is either written in the gym's own
          // currency or not written.
          //
          // And it was `Math.round(… * 100)`, which is the literal /close was
          // mended for and this tile was not: a Tokyo gym's ¥630,000 of session
          // value rendered as ¥63,000,000 on the first figure an owner reads.
          // `minorFromWhole` asks `ccy` how many places its money has, and
          // returns null when the gym has not said — which is a dash with the
          // note beside it, not a number in no currency.
          text={amount(minorFromWhole(roll?.payroll30, ccy), ccy)}
          // A dash with no explanation reads as a bug. Say which of the four
          // reasons it is: the gym could not be read, no fee is set, work is
          // still awaiting an outcome, or the gym has never said what money it
          // charges in. The first was previously reported as the second, which
          // sends an owner to check a setting that is already correct.
          note={gymErr ? 'gym record unread — fee unknown'
                : trainers
                  ? payrollBlocker(trainers, gym?.sessionFee ?? null)
                    ?? (roll?.payroll30 != null && !ccy ? NO_CURRENCY_NOTE : undefined)
                    ?? undefined
                  : undefined}
        />
        <Kpi big label="Awaiting an outcome" value={roll?.unmarked30 ?? null}
             note={roll && roll.unmarked30 > 0 ? 'payroll cannot settle over these' : undefined} />
        {/* Not "at risk". `atRiskCount` is everyone `trainerHealth` does not
            return 'ok' for, and that set includes `idle` — a trainer hired
            yesterday with no clients and no sessions yet. Labelling them at
            risk tells a brand-new gym its only coach is failing, when the
            truthful statement is that there is nothing to assess. Every other
            screen already words this as "needs a look"; this one did not, and
            it is the first number an owner sees. The set is deliberately the
            same one staffView calls `flagged` — the count is right, the word
            for it was wrong. */}
        <Kpi big label="Trainers needing a look" value={roll?.atRiskCount}
             note={roll && roll.atRiskCount > 0 && roll.atRiskClients === 0
               ? 'nothing to assess yet — no clients between them'
               : undefined} />
      </div>

      {/* ── engagement ────────────────────────────────────────────────
          The only figures on this page that do not come from a query in this
          browser. See the comment on `engage` above for why, and for what the
          `live` array means: a metric the function could not compute whole is
          absent from it, and absent renders as a dash rather than as a zero. */}
      <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 18 }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
          <h2>Engagement</h2>
        </div>
        <div style={{ padding: '14px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {engage === undefined ? (
            <div role="status" aria-live="polite" aria-atomic="true" style={{ color: 'var(--ink3)', fontSize: 13 }}>Loading…</div>
          ) : engage === null || !engage.ok ? (
            <div role="status" aria-live="polite" aria-atomic="true" style={{ color: 'var(--ink3)', fontSize: 13, maxWidth: '68ch' }}>
              {engage?.error
                ?? 'These figures could not be read. That is unknown rather than nil — nobody has said your members have stopped training.'}
            </div>
          ) : (
            ([
              ['Trained in 30 days', 'activeMembers', 'members with at least one workout'],
              ['Workouts, 7 days', 'workouts7', 'logged across the gym'],
              ['Scans, 7 days', 'scans7', 'body composition scans taken'],
              ['PT sessions, 30 days', 'ptSessions30', 'booked and already started'],
            ] as Array<[string, string, string]>).map(([label, key, note]) => {
              // A metric is quotable only when the function put it in `live`.
              // Reading `metrics[key] ?? 0` here would undo the whole point of
              // that array — the function omits what it could not compute
              // WHOLE, and a zero in its place is the plausible wrong number
              // its own header was written about.
              const known = engage.live.includes(key);
              const v = known ? engage.metrics[key] : null;
              return (
                <div key={key} style={{ border: '1px solid var(--ring)', padding: '12px 14px', minWidth: 150 }}>
                  <div className="eyebrow">{label}</div>
                  <div className="mono" style={{ fontSize: 22, marginTop: 4 }}>
                    {v == null ? <span className="dash">—</span> : v.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 4 }}>
                    {v == null ? 'not counted — unknown, not nil' : note}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
          <h2>Roster</h2>
        </div>
        {trainers === null && error ? (
          // Not the DataTable's empty state: that sentence claims the gym has
          // no trainers, and this branch is reached precisely when nobody knows.
          <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '28px 20px', color: 'var(--ink3)', fontSize: 13 }}>
            The roster could not be read, so this is not an empty gym — it is an unread one.
            The figures above that come from the roster are missing for the same reason.
          </div>
        ) : trainers === null ? (
          <div role="status" aria-live="polite" aria-atomic="true" style={{ padding: '28px 20px', color: 'var(--ink3)' }}>Loading…</div>
        ) : (
          <DataTable noun="trainers"
            rows={trainers}
            columns={cols}
            rowKey={(t) => t.id}
            empty="No trainers in this gym yet. Invite one from the Repple Studio app."
          />
        )}
      </section>
    </Shell>
  );
}

// ── the eighth banner, and why a grep did not find it ───────────────────
//
// A sweep moved six console pages off their own local `function Banner` onto
// the shared one in studio-web/components/Banner.tsx, which carries
// role="alert"/aria-live so a refusal is not a silence for a screen reader.
// This one is called `Notice`, so `grep 'function Banner'` never listed it —
// on the first screen an owner opens every morning, carrying the roster
// failure, the five-read hub failure, the multi-site notice and the payroll
// blocker.
//
// `live` defaults on here, unlike `SharedBanner`: everything this renders is a
// read that failed or a figure that is missing, which is exactly what a screen
// reader has to be told about. The caller passes `live={false}` for anything an
// Announce region on the same page is already reading out.
function Notice({ children, tone, live = true }: { children: React.ReactNode; tone?: 'crit'; live?: boolean }) {
  return (
    <SharedBanner tone={tone} live={live} style={{ margin: '18px 0 0', maxWidth: '72ch' }}>
      {children}
    </SharedBanner>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', color: 'var(--ink3)' }}>{children}</div>;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // The reset link lands on the website rather than in one app's URL scheme,
  // so the same mail works for someone on a phone, a desk, or neither.
  const forgot = async () => {
    const addr = email.trim();
    if (!addr) { setErr('Enter your email first, then tap Forgot password.'); return; }
    setErr(null); setSent(null);
    await supabase.auth.resetPasswordForEmail(addr, {
      redirectTo: 'https://www.repplefitness.com/reset-password',
    });
    // Same answer either way: telling a stranger which addresses have accounts
    // is a way of enumerating your members.
    setSent('If that address has an account, a reset link is on its way.');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setErr(error.message); setBusy(false); return; }
    location.reload();
  };

  const linkish = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
  } as const;

  const field = {
    width: '100%', padding: '10px 12px', borderRadius: 0, fontSize: 14,
    background: 'var(--surface2)', color: 'var(--ink)',
    border: '1px solid var(--ring)', fontFamily: 'var(--sans)',
  } as const;

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <form onSubmit={submit} style={{ width: 340, maxWidth: '100%' }}>
        <h1 style={{ marginBottom: 6 }}>Repple Studio</h1>
        <p style={{ color: 'var(--ink3)', fontSize: 13, marginTop: 0, marginBottom: 20 }}>
          The same account you use in the app.
        </p>
        <label className="micro" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email}
               onChange={(e) => setEmail(e.target.value)} style={{ ...field, margin: '6px 0 14px' }} />
        <PasswordField label="Password" value={password} onChange={setPassword} required />
        {/* Announced. This is the first interaction anybody has with the
            console, and a wrong password produced a visual-only sentence. */}
        {err ? <div role="alert" aria-live="assertive" aria-atomic="true" style={{ color: 'var(--crit)', fontSize: 13, marginBottom: 12 }}>{err}</div> : null}
        {sent ? <div role="status" aria-live="polite" aria-atomic="true" style={{ color: 'var(--brand)', fontSize: 13, marginBottom: 12 }}>{sent}</div> : null}
        <button type="submit" disabled={busy}
                style={{ ...field, background: 'var(--brand)', color: 'var(--brand-ink)',
                         fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 14, fontSize: 13 }}>
          <button type="button" onClick={forgot} style={linkish}>Forgot password?</button>
          <a href="https://www.repplefitness.com/signup" style={{ color: 'var(--ink3)' }}>Create an account</a>
        </div>
      </form>
    </div>
  );
}
