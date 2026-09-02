'use client';

// Analytics — which way the gym is moving.
//
// Every other screen in this console answers "what is true now". Overview
// counts today's members, Close totals a month that has finished, Door shows
// who is in the building. An owner can read all of them every morning and
// still not know the one thing that decides whether the gym is a business next
// year: whether more people are arriving than leaving, and whether the ones who
// arrived are still turning up.
//
// So this page only ever draws a figure against time:
//
//   · joiners and leavers by month, from `memberships.started_on` and
//     `ends_on` — the two dates the gym actually records — and the net between
//     them;
//   · retention cohorts, using `cohorts()` from src/lib/ownerAnalytics.ts. The
//     module groups rows by the month they joined and counts how many are still
//     active, which is the same question whether the row is a coach or a
//     member. It is fed members here, and "active" is a door-log visit in the
//     last 30 days rather than a class booking, for the reason memberView.ts
//     sets out at length: a member who moved from the 6am class to the gym
//     floor is invisible in the bookings and reads exactly like somebody who
//     stopped coming;
//   · how often members come — 0, 1–3, 4–8, 9+ visits in 30 days — because a
//     gym holding its headcount while everybody halves their visits is losing
//     and its member count will not say so for another six months.
//
// `trainerHealth`, `gymRollup` and `clientAnalytics` from the same module are
// deliberately NOT used here. They score coaches as they stand today, which is
// the Staff screen's question, and a second copy of it under a different
// heading is how two screens end up disagreeing about the same coach.
//
// ── Three things this page refuses to do ───────────────────────────────────
//
//   · call a partial month a low-churn month. August is not finished; the
//     leavers it has not had yet have not happened. A rate over a running month
//     is a rate over a fraction of a month and it always looks like good news,
//     so the running month gets a dash and the reason, never a small number;
//   · print a percentage over a handful of people. The floor and the argument
//     for it are gymRetention.ts's `MIN_COHORT_FOR_RATE` and `pointsPerMember`,
//     used here rather than restated, so this page and the Retention page
//     cannot land on two different definitions of "too small to say";
//   · read a silent door log as an empty gym. If nothing was ever recorded
//     through the door, every member has zero visits and every cohort retains
//     nobody — a chart of the gym's hardware, drawn as though it were a chart
//     of the gym. The log is probed separately for its last entry, and when it
//     has none the visit figures are unknown rather than zero.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
// The console's banner, with the live region it never had. The local copy of
// this component that used to sit at the bottom of this file — and still sits
// at the bottom of eighteen other page files — rendered every sentence this
// screen produces into a plain <div>, which a screen reader never reads out.
import { Banner } from '@/components/Banner';
import { DataTable, type Column } from '@/components/DataTable';
import { type Membership } from '@lib/gymRecord';
import { fetchVisits, type Visit } from '@lib/gymVisits';
import { fetchClasses, pct, type GymClass } from '@lib/gymSchedule';
import { summariseClassRows, type ClassRates, type ClassSummaryRow } from '@lib/classRates';
import { branchSpan, branchNote } from '@lib/ownedSites';
import { cohorts, type Cohort, type TrainerLike } from '@lib/ownerAnalytics';
import {
  MIN_COHORT_FOR_RATE, COHORT_MATURITY_DAYS, rateOf, pointsPerMember, monthOfDate,
} from '@lib/gymRetention';
import { monthWindow, recentMonths, monthEnded, monthKeyOf, type MonthWindow } from '@lib/monthEnd';
import { readAll } from '@lib/rowCap';
import { money, sharedCurrency } from '@lib/gymRecord';

const DAY = 86400000;

/** The visit window every "recently" on this page means. Thirty days because
 *  that is the window `cohorts()` already judges activity over, and two
 *  different recencies on one screen is two different answers. */
const VISIT_DAYS = 30;

/** How many months of joiners and leavers to draw. Thirteen so the same month
 *  last year is on screen — a gym with a January is not churning in January. */
const MONTHS_SHOWN = 13;

/**
 * What a read is when it has produced no rows: still in flight, or refused.
 *
 * `null` is the answer "this read came back". The two failures have to look
 * different on screen, because "Loading…" that never resolves and "nobody left
 * this month" are both lies about a query that errored — and an owner acts on
 * the second one, by concluding the gym is holding when it is not.
 */
type Unread = 'loading' | 'failed' | null;

/** Rows plus which of the three states they are in. Rows are null unless the
 *  read actually returned; a failed read is never []. */
interface Read<T> { rows: T[] | null; state: Unread }

const reading = <T,>(): Read<T> => ({ rows: null, state: 'loading' });
const returned = <T,>(rows: T[]): Read<T> => ({ rows, state: null });
const refused = <T,>(): Read<T> => ({ rows: null, state: 'failed' });

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as any)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

const settled = <T,>(res: PromiseSettledResult<T[]>): Read<T> =>
  res.status === 'fulfilled' ? returned(res.value) : refused<T>();

/* ── the member spine ──────────────────────────────────────────────────────── */

/**
 * One person's whole history with the gym, from every membership row they hold.
 *
 * Built per member rather than per membership on purpose. Somebody who
 * cancelled in March and rejoined in June has two rows, and counting rows would
 * report them as two joiners and file the second under June — a gym that
 * recruits well and keeps nobody, assembled entirely out of its own returning
 * members. Their join month is the earliest start they have ever had.
 */
interface Span {
  memberId: string;
  name: string | null;
  /** Earliest `started_on`, or null when no row carried a usable one. */
  joinedOn: string | null;
  /** Latest `ends_on`, and only when every membership they hold has one. */
  leftOn: string | null;
  /** Holds a membership that has not been given an end date and has not been
   *  cancelled — i.e. still on the books. */
  open: boolean;
  /** Holds a membership marked `active`. */
  active: boolean;
  /** Holds a cancelled or expired membership with NO end date. Their leaving
   *  month is unknown, and no month may be given credit for it. */
  undatedExit: boolean;
}

const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}/.test(s);

function spansOf(rows: Membership[]): Span[] {
  const by = new Map<string, Span>();
  for (const m of rows) {
    const cur = by.get(m.memberId) ?? {
      memberId: m.memberId, name: m.memberName, joinedOn: null, leftOn: null,
      open: false, active: false, undatedExit: false,
    };
    if (m.memberName && !cur.name) cur.name = m.memberName;

    // String comparison, not Date.parse. 'YYYY-MM-DD' compares correctly as
    // text, and parsing it produces UTC midnight — which read back as a local
    // month puts every member who joined on the 1st into the previous month
    // west of Greenwich. A whole cohort moved by a timezone.
    if (isDay(m.startedOn) && (cur.joinedOn == null || m.startedOn < cur.joinedOn)) {
      cur.joinedOn = m.startedOn.slice(0, 10);
    }

    if (m.status === 'active') cur.active = true;

    const ended = m.status === 'cancelled' || m.status === 'expired';
    if (!ended && !isDay(m.endsOn)) cur.open = true;
    if (ended && !isDay(m.endsOn)) cur.undatedExit = true;
    if (isDay(m.endsOn)) {
      const d = m.endsOn.slice(0, 10);
      if (cur.leftOn == null || d > cur.leftOn) cur.leftOn = d;
    }

    by.set(m.memberId, cur);
  }

  // Somebody with any membership still running has not left, whatever end date
  // an older row of theirs carries. Otherwise their leaving day is the last end
  // date they hold — unless one of their ended memberships has no date at all,
  // in which case the gym does not know when they went and this page will not
  // pick a month for them.
  return [...by.values()].map((s) => ({
    ...s,
    leftOn: s.open || s.undatedExit ? null : s.leftOn,
  }));
}

/* ── months ────────────────────────────────────────────────────────────────── */

interface MonthRow {
  key: string;
  label: string;
  w: MonthWindow;
  running: boolean;
  joined: number;
  left: number;
  /** On the books on the first day of the month — the churn denominator. */
  opening: number;
  /** joined − left, or null when the leavers are known to be incomplete. */
  net: number | null;
  churn: number | null;
  /** Why there is no churn rate. Empty when there is one. */
  churnNote: string;
}

function monthRows(spans: Span[], undatedExits: number, now: number): MonthRow[] {
  const keys = recentMonths(MONTHS_SHOWN, now);
  const out: MonthRow[] = [];

  for (const key of keys) {
    const w = monthWindow(key);
    if (!w) continue;
    const running = !monthEnded(w, now);

    const joined = spans.filter((s) => monthOfDate(s.joinedOn) === key).length;
    const left = spans.filter((s) => monthOfDate(s.leftOn) === key).length;

    // On the books at the START of the month: joined before it began, and had
    // not left before it began. Somebody who joined and left inside the same
    // month is in neither the denominator nor the opening roster, which is the
    // standard treatment and is why the two counts are shown beside the rate.
    const opening = spans.filter(
      (s) => isDay(s.joinedOn) && s.joinedOn < w.firstDay && (s.leftOn == null || s.leftOn >= w.firstDay),
    ).length;

    // The churn rate, in the order the reasons disqualify it.
    let churn: number | null = null;
    let churnNote = '';
    if (running) {
      churnNote = 'still running — a partial month is not a low churn month';
    } else if (undatedExits > 0) {
      churnNote = `${undatedExits} ended membership${undatedExits === 1 ? ' has' : 's have'} no end date, so the leavers are incomplete`;
    } else if (opening === 0) {
      churnNote = 'nobody was on the books when the month began';
    } else {
      // rateOf withholds anything under the shared floor, so this screen and
      // the Retention screen cannot disagree about "too small to say".
      churn = rateOf(left, opening);
      if (churn == null) {
        const p = pointsPerMember(opening);
        churnNote = `${opening} on the books — one leaver would move it ${p == null ? '—' : p.toFixed(1)} points`;
      }
    }

    out.push({
      key, label: w.label, w, running, joined, left, opening,
      // A net over an incomplete leaver count is a claim about the direction of
      // the roster made from half the evidence, and it always errs upward.
      net: undatedExits > 0 ? null : joined - left,
      churn, churnNote,
    });
  }
  return out;
}

/* ── visit frequency ───────────────────────────────────────────────────────── */

const BUCKETS = [
  { key: '0', label: 'Did not come', hit: (n: number) => n === 0 },
  { key: '1-3', label: '1–3 visits', hit: (n: number) => n >= 1 && n <= 3 },
  { key: '4-8', label: '4–8 visits', hit: (n: number) => n >= 4 && n <= 8 },
  { key: '9+', label: '9 or more', hit: (n: number) => n >= 9 },
] as const;

interface BucketRow {
  key: string;
  label: string;
  /** Members in the bucket, or null when the count cannot be made. */
  members: number | null;
  /** Share of the roster, or null when the roster cannot carry a percentage. */
  share: number | null;
  note: string;
}

export default function Analytics() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  // Whether the gym's NAME could not be READ, as distinct from there being no
  // gym. The read below still drops the error into a `no-error-ok:` — no figure
  // on this page depends on the name — but the rail printed "No gym linked" for
  // either, and that is a sentence about the owner's ACCOUNT produced by a
  // query that failed. Carrying this one bit is what lets the rail say which.
  const [gymNameUnread, setGymNameUnread] = useState(false);

  const [memberships, setMemberships] = useState<Read<Membership>>(reading);
  const [visits, setVisits] = useState<Read<Visit>>(reading);
  const [classes, setClasses] = useState<Read<GymClass>>(reading);
  // The door log probed on its own: has this gym EVER recorded a visit, and
  // when was the last one. Without it a gym that runs no terminal is
  // indistinguishable from a gym nobody attends.
  const [door, setDoor] = useState<{ state: Unread; at: string | null }>({ state: 'loading', at: null });
  /**
   * The money, which this page had none of.
   *
   * `fetchPayments` was never imported here — so a screen whose whole subject
   * is "which way is the gym moving" could show joiners, leavers and visits and
   * not one figure about revenue. A gym holding its headcount while its
   * average member spends a third less is losing, and nothing on this page
   * could see it.
   */
  const [payments, setPayments] = useState<Read<MoneyRow>>(reading);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    setMemberships(reading); setVisits(reading); setClasses(reading);
    setDoor({ state: 'loading', at: null }); setErr(null);

    const now = Date.now();
    const since = new Date(now - VISIT_DAYS * DAY).toISOString();
    // The class window ends at this moment. A class that has not started has no
    // attendance and its unsold seats are still on sale; counting them would
    // draw a healthy timetable as a failing one.
    const to = new Date(now).toISOString();

    // allSettled, not all. Under one catch, a refused classes read — which
    // costs a single tile — would empty the memberships too, and this page
    // would report a gym where nobody has ever joined and nobody has ever left.
    // Thirteen months back for the money, so the same month last year is on
    // screen for exactly the reason MONTHS_SHOWN is thirteen: a gym with a
    // January is not in trouble in January.
    const moneySince = new Date(now - 400 * DAY).toISOString();

    const [mRes, vRes, cRes, dRes, pRes] = await Promise.allSettled([
      // PAGED, for the same reason the two reads below it are. `fetchMemberships`
      // caps at a thousand and throws, and its own comment in
      // src/lib/gymRecord.ts says why that ceiling is low: it returns EVERY
      // membership in the gym's history, not the live ones, so a three-year-old
      // gym of four hundred members crosses it without ever having been large.
      // Every cohort, every joiners-and-leavers month and the whole retention
      // grid on this page is made of this one read, and past the cap the
      // analytics screen went permanently dark for exactly the gyms with enough
      // history to analyse.
      pageMemberships(tenantId),
      // PAGED, not capped-and-refused. `fetchVisits` asks for one row past the
      // ceiling and THROWS on getting it, which is right for a figure and wrong
      // for this page: thirty days of door scans crosses a thousand at about
      // thirty-three a day, so a gym busy enough to be worth analysing was the
      // gym whose whole analytics screen became dashes. /export already solved
      // exactly this with `readAll`, and the honest fix is to finish the read
      // rather than to raise a cliff nobody can see.
      pageVisits(tenantId, since),
      fetchClasses(supabase, tenantId, since, to),
      lastVisitAt(tenantId),
      pagePayments(tenantId, moneySince),
    ]);

    setMemberships(settled(mRes));
    setVisits(settled(vRes));
    setClasses(settled(cRes));
    setPayments(settled(pRes));
    setDoor(dRes.status === 'fulfilled' ? { state: null, at: dRes.value } : { state: 'failed', at: null });

    const trouble = [
      failure(mRes, 'the memberships'),
      failure(vRes, 'the door log for the last 30 days'),
      failure(cRes, 'the classes in the last 30 days'),
      failure(dRes, 'the door log’s last entry'),
      failure(pRes, 'the payments of the last thirteen months'),
    ].filter((s): s is string => s !== null);
    setErr(trouble.length ? trouble.join(' · ') : null);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) {
        setMemberships(returned([])); setVisits(returned([])); setClasses(returned([]));
        setPayments(returned([]));
        setDoor({ state: null, at: null });
        return;
      }
      // The error is now read off the result. Not because the name matters — it is
      // a label — but because "we could not ask" and "there is no gym" must not
      // arrive at the rail as the same null. See the Shell's gymNameUnread prop.
      const { data: t, error: tErr } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) { setGymName(tErr ? null : t?.name ?? null); setGymNameUnread(!!tErr); }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  // Frozen for the life of the page. `Date.now()` read in the render body moves
  // on every keystroke elsewhere, which would make every memo below recompute
  // and — worse — let the month that counts as "running" change underneath a
  // table the owner is reading.
  const [now] = useState(() => Date.now());
  const windowStart = useMemo(() => new Date(now - VISIT_DAYS * DAY).toISOString(), [now]);

  const spans = useMemo(
    () => (memberships.rows ? spansOf(memberships.rows) : null),
    [memberships.rows],
  );

  /** Members whose leaving month the record does not hold. */
  const undatedExits = useMemo(() => (spans ?? []).filter((s) => s.undatedExit).length, [spans]);
  /** Members with no usable join date — they are in no cohort and no roster. */
  const undatedJoins = useMemo(() => (spans ?? []).filter((s) => !isDay(s.joinedOn)).length, [spans]);

  const months = useMemo(
    () => (spans ? monthRows(spans, undatedExits, now) : null),
    [spans, undatedExits, now],
  );

  /**
   * Whether the door log can be read as evidence at all.
   *
   * `silent` is the case this page exists to guard: the log has no entries, so
   * every member has zero visits and every cohort retains nobody. That is a
   * fact about the terminal, not about the gym.
   *
   * BOTH door reads gate it, not just the probe. `lastVisitAt` and the windowed
   * `fetchVisits` are separate promises against `gym_visits`, and the windowed
   * scan is the one every per-member count is actually made of. When it failed
   * and the probe did not — a statement timeout on the range, exactly the shape
   * where a `limit(1)` still answers — this said `live` over an empty
   * `visitsByMember`, and the cohort table printed "Still coming 0" and
   * "Retained 0%" in the warning colour against every cohort of ten or more.
   * That is the silent-log disaster this state exists to prevent, arriving
   * through the read the guard was not watching.
   */
  const doorState: 'loading' | 'failed' | 'silent' | 'stale' | 'live' =
    door.state === 'loading' || visits.state === 'loading' ? 'loading'
      : door.state === 'failed' || visits.state === 'failed' ? 'failed'
      : door.at == null ? 'silent'
      : door.at < windowStart ? 'stale'
      : 'live';

  const doorNote =
    doorState === 'silent'
      ? 'no visit has ever been recorded through the door log'
      : doorState === 'stale'
        ? `nothing has come through the door log since ${(door.at ?? '').slice(0, 10)}`
        : doorState === 'failed' ? 'the door log could not be read'
          : 'reading the door log…';

  /** Visits per member in the window, from the log alone. */
  const visitsByMember = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of visits.rows ?? []) {
      if (!v.memberId) continue;
      m.set(v.memberId, (m.get(v.memberId) ?? 0) + 1);
    }
    return m;
  }, [visits.rows]);

  /** Entries with nobody attached — a pass at the desk, or a scan that matched
   *  no member. Real visits, and not attributable to anyone on the roster, so
   *  they are counted apart rather than folded into an average per member. */
  const anonVisits = useMemo(
    () => (visits.rows ?? []).filter((v) => !v.memberId).length,
    [visits.rows],
  );

  const roster = useMemo(() => (spans ?? []).filter((s) => s.active), [spans]);

  /* ── the money, which this page had none of ────────────────────────────── */

  /**
   * The currency the whole trend is in, or null when the rows disagree.
   *
   * Same rule as every other total in this product: a gym that changed its
   * currency has two in its ledger, adding them is not a sum, and a row stating
   * none does not agree with one that does. Null withholds the entire money
   * section rather than drawing a trend line through two moneys.
   */
  const moneyCurrency = useMemo(
    () => (payments.rows && payments.rows.length ? sharedCurrency(payments.rows) : null),
    [payments.rows],
  );
  const moneyMixed = !!(payments.rows && payments.rows.length && moneyCurrency == null);

  /**
   * Thirteen months of takings, ARPU and the same month last year.
   *
   * ARPU's denominator is members who PAID in the month, not the roster: a
   * revenue-per-member figure over everybody on the books answers a different
   * question — how much of the roster is paying — and the two move in opposite
   * directions when a gym signs a lot of people who then do not pay.
   *
   * The RUNNING month is marked and never compared. A part-month always looks
   * like a collapse, and a year-on-year delta against one is the single most
   * alarming wrong number this page could produce.
   */
  const moneyMonths = useMemo<MoneyMonth[] | null>(() => {
    if (!payments.rows || moneyCurrency == null) return null;
    const keys = recentMonths(MONTHS_SHOWN, now);
    const by = new Map<string, { cents: number; payers: Set<string>; count: number }>();
    for (const p of payments.rows) {
      const k = monthKeyOf(Date.parse(p.takenAt));
      const cur = by.get(k) ?? { cents: 0, payers: new Set<string>(), count: 0 };
      cur.cents += p.amountCents;
      cur.count += 1;
      // A payment with nobody's name on it is real money and not a payer we can
      // count, so it contributes to the total and not to the denominator.
      if (p.memberId) cur.payers.add(p.memberId);
      by.set(k, cur);
    }
    const thisMonth = monthKeyOf(now);
    return keys.map((k) => {
      const v = by.get(k) ?? { cents: 0, payers: new Set<string>(), count: 0 };
      const w = monthWindow(k);
      const running = k === thisMonth || (w != null && !monthEnded(w, now));
      const yearAgoKey = `${Number(k.slice(0, 4)) - 1}-${k.slice(5, 7)}`;
      const yearAgo = by.get(yearAgoKey);
      return {
        key: k,
        label: w ? w.label : k,
        running,
        cents: v.cents,
        payments: v.count,
        payers: v.payers.size,
        // Null rather than zero: nobody paid means there is no average to take,
        // and 0.00 per member reads as a gym whose members pay nothing.
        arpuCents: v.payers.size ? Math.round(v.cents / v.payers.size) : null,
        // Withheld on a running month and where there is no matching month in
        // the read at all — a gym eleven months old has no last January, and
        // "−100%" would be the answer to a question nobody asked.
        yoyPct: running || !yearAgo || yearAgo.cents === 0
          ? null
          : Math.round(((v.cents - yearAgo.cents) / yearAgo.cents) * 100),
      };
    });
  }, [payments.rows, moneyCurrency, now]);

  /**
   * When the gym is actually busy, by hour of the day.
   *
   * `entered_at` has been read by this page all along and nothing has ever
   * drawn an hour out of it — while "when is my gym busy" is the single most
   * actionable staffing question an owner has. Local hours, not UTC: an owner
   * in Dubai staffing against a UTC histogram would put people on four hours
   * early.
   */
  const hours = useMemo<HourRow[] | null>(() => {
    if (!visits.rows) return null;
    const counts = new Array(24).fill(0) as number[];
    for (const v of visits.rows) {
      const t = Date.parse(v.enteredAt);
      if (!Number.isFinite(t)) continue;
      counts[new Date(t).getHours()] += 1;
    }
    const peak = Math.max(...counts);
    return counts.map((n, h) => ({ hour: h, visits: n, share: peak > 0 ? n / peak : 0 }));
  }, [visits.rows]);

  /* ── the four figures an owner watches ─────────────────────────────────── */

  const lastFull = months?.find((m) => !m.running) ?? null;

  // `doorState` now folds `visits.state` in, so the second clause is belt and
  // braces rather than the guard — kept because the name of this value is the
  // sentence a reader needs, and losing it would invite the next author to
  // reach for `doorState` alone the way the cohort table used to.
  const visitsCounted = doorState === 'live' && visits.state === null;

  /**
   * Visits made by the people in the denominator, and nobody else.
   *
   * Not the raw row count. The log also carries entries attached to no member
   * and entries by members whose card has expired, and putting either over the
   * active roster is an average of one population divided by another — it moves
   * up when a lapsed member walks in, which is the opposite of what the figure
   * is read to mean.
   */
  const rosterVisits = useMemo(
    () => roster.reduce((a, s) => a + (visitsByMember.get(s.memberId) ?? 0), 0),
    [roster, visitsByMember],
  );

  const avgVisits: number | null =
    !visitsCounted || spans == null || roster.length === 0
      ? null
      : Math.round((rosterVisits / roster.length) * 10) / 10;

  const avgNote =
    memberships.state === 'failed' ? 'the roster could not be read'
      : memberships.state === 'loading' || visits.state === 'loading' ? 'reading…'
        : visits.state === 'failed' ? 'the door log could not be read'
          : doorState !== 'live' ? doorNote
            : roster.length === 0 ? 'no active membership to divide by'
              : `${rosterVisits} visits by ${roster.length} active member${roster.length === 1 ? '' : 's'}`;

  /** The shared rate maths, over the classes that recorded a capacity. A class
   *  with none puts its bookings in the numerator and nothing in the
   *  denominator, which reads as a fuller room than the gym had. */
  const rated: ClassRates | null = useMemo(() => {
    if (!classes.rows) return null;
    const rows: ClassSummaryRow[] = classes.rows
      .filter((c) => (c.capacity || 0) > 0)
      .map((c) => ({
        classId: c.id,
        title: c.title,
        // `kind` is not read by summariseClassRows and is not rendered here;
        // left empty rather than invented.
        //
        // `branch` was empty too, and that is a different thing: it is the field
        // that says whether these classes happened at one place or several, and
        // emptying it made a two-place total indistinguishable from one gym's.
        kind: '',
        branch: c.branch ?? '',
        trainerId: c.trainerId ?? '',
        trainerName: c.instructor ?? '',
        startsAt: c.startsAt,
        capacity: c.capacity || 0,
        booked: c.booked,
        attended: c.attended,
      }));
    return summariseClassRows(rows);
  }, [classes.rows]);

  const uncapped = (classes.rows ?? []).filter((c) => !(c.capacity || 0)).length;

  /** How many places the fill figure covers. See the same note on /classes:
   *  `summariseClassRows` sums whatever it is handed, so a gym using `branch`
   *  for two rooms in two streets gets one rate over both. Unknown until the
   *  read settles, and 'none' for every gym in the live database today. */
  const classPlaces = branchSpan(
    classes.rows ?? [],
    classes.rows ? 'ready' : classes.state === 'failed' ? 'error' : 'loading',
  );

  /** The clause that stops the fill tile being read as one room's rate.
   *
   *  Empty for every gym today, because nothing in this console has ever
   *  written a branch. When a gym does use the field the tile says the figure
   *  spans more than one place, rather than leaving the reader to assume it
   *  does not — the full sentence, with the places named, is on /classes. */
  const placesClause = branchNote(classPlaces)
    ? `, and these classes ran at more than one place, so this covers all of them`
    : '';

  const fillNote =
    classes.state === 'failed' ? 'the classes could not be read'
      : classes.state === 'loading' ? 'reading the timetable…'
        : (classes.rows?.length ?? 0) === 0 ? 'no class ran in the last 30 days'
          : !rated || rated.fill == null
            ? `none of the ${classes.rows?.length ?? 0} classes recorded a capacity`
            : `${rated.booked} booked of ${rated.capacity} places${uncapped ? `, ${uncapped} class${uncapped === 1 ? '' : 'es'} left out for want of a capacity` : ''}${placesClause}`;

  /* ── cohorts ───────────────────────────────────────────────────────────── */

  /**
   * The gym's members, in the shape `cohorts()` groups.
   *
   * `since` is sent as LOCAL NOON of the join day, not the bare date. The
   * module parses it and reads the month back in local time, and
   * `Date.parse('2026-08-01')` is UTC midnight — which is 31 July in every
   * timezone west of Greenwich, and would move a whole month's intake into the
   * month before it.
   *
   * `clients` is 0 because nothing here has clients and nothing on this page
   * passes these rows to `trainerHealth` or `gymRollup`, which do read it and
   * would be reading it as something these rows do not have. `cohorts()` itself
   * touches only `since` and `sessions30`.
   */
  const cohortInput: TrainerLike[] = useMemo(
    () => (spans ?? [])
      .filter((s) => isDay(s.joinedOn))
      .map((s) => ({
        id: s.memberId,
        name: s.name ?? '',
        clients: 0,
        sessions30: visitsByMember.get(s.memberId) ?? 0,
        since: localNoon(s.joinedOn as string),
      })),
    [spans, visitsByMember],
  );

  const cohortRows: Cohort[] = useMemo(
    () => (spans ? cohorts(cohortInput).slice().reverse() : []),
    [spans, cohortInput],
  );

  /* ── visit frequency ───────────────────────────────────────────────────── */

  const buckets: BucketRow[] = useMemo(() => {
    const rosterKnown = memberships.state === null;
    // Which of the two ways the roster can be absent, in the words the band's
    // dash needs. Every other read on this page already draws this distinction
    // and this one did not: `rosterKnown` is false while the memberships are
    // still IN FLIGHT as well as when they were refused, and both said "the
    // roster could not be read". A page that reports a fault for the first
    // second of every visit teaches its owner to ignore the sentence — which is
    // the sentence that matters on the one occasion it is true.
    const rosterMissing =
      memberships.state === 'loading' ? 'reading the memberships…'
        : 'the roster could not be read';
    return BUCKETS.map((b) => {
      // The "did not come" bucket is the only one that needs the roster: every
      // other bucket is counted straight off the log. Without the roster the
      // members who stayed away cannot be counted, and 0 there would be the
      // most flattering possible lie on this page.
      if (!visitsCounted) return { key: b.key, label: b.label, members: null, share: null, note: doorNote };
      if (b.key === '0' && !rosterKnown) {
        return { key: b.key, label: b.label, members: null, share: null,
          note: memberships.state === 'loading'
            ? 'reading the memberships, so the members who stayed away cannot be counted yet'
            : 'the roster could not be read, so the members who stayed away cannot be counted' };
      }
      if (!rosterKnown) return { key: b.key, label: b.label, members: null, share: null, note: rosterMissing };

      const members = roster.filter((s) => b.hit(visitsByMember.get(s.memberId) ?? 0)).length;
      const share = rateOf(members, roster.length);
      const p = pointsPerMember(roster.length);
      return {
        key: b.key, label: b.label, members, share,
        note: share != null ? ''
          : roster.length === 0 ? 'no active membership on the books'
            : `${roster.length} active member${roster.length === 1 ? '' : 's'} — one is worth ${p == null ? '—' : p.toFixed(1)} points`,
      };
    });
  }, [visitsCounted, doorNote, memberships.state, roster, visitsByMember]);

  /** Members seen through the door in the window who hold no active
   *  membership — training on an expired card, or on a pass. */
  const seenNotOnRoster = useMemo(() => {
    if (!visitsCounted || memberships.state !== null) return null;
    const active = new Set(roster.map((s) => s.memberId));
    return [...visitsByMember.keys()].filter((id) => !active.has(id)).length;
  }, [visitsCounted, memberships.state, roster, visitsByMember]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/analytics">
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
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/analytics">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          Whether the gym is growing or shrinking is the owner&rsquo;s question. Your
          own clients and their attendance are on the Sessions and Timetable screens.
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/analytics">
      <h1>Analytics</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Not what is true today — which way it is moving. Who arrived, who left,
        whether the people who arrived are still coming through the door, and how
        often.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}
      {doorState === 'silent' ? (
        <Banner tone="crit">
          No visit has ever been recorded through this gym&rsquo;s door log. Every
          figure below that counts attendance is therefore <strong>unknown</strong>,
          not zero — including every cohort&rsquo;s retention, which would otherwise
          read as a gym that has kept nobody it ever signed.
        </Banner>
      ) : null}
      {doorState === 'stale' ? (
        <Banner tone="crit">
          The door log&rsquo;s last entry is {(door.at ?? '').slice(0, 10)}, before this
          30-day window opened. The attendance figures are withheld rather than
          reported as zero: nothing here can tell an unplugged terminal from an
          empty gym.
        </Banner>
      ) : null}
      {undatedExits > 0 ? (
        <Banner tone="crit">
          {undatedExits} membership{undatedExits === 1 ? ' is' : 's are'} cancelled or
          expired with no end date. There is no month to credit {undatedExits === 1 ? 'it' : 'them'} to,
          so {undatedExits === 1 ? 'it is' : 'they are'} in no leaver count on this page — and
          because the leavers are known to be short, the net and the churn rate are
          withheld rather than reported high and low respectively.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Active members"
          text={spans ? String(roster.length) : null}
          note={
            memberships.state === 'failed' ? 'the memberships could not be read'
              : memberships.state === 'loading' ? 'reading the memberships…'
                : `of ${spans?.length ?? 0} who have ever held one`
          }
        />
        <Kpi
          label={`Net change · ${lastFull ? lastFull.label : 'last full month'}`}
          text={lastFull && lastFull.net != null ? (lastFull.net > 0 ? `+${lastFull.net}` : String(lastFull.net)) : null}
          tone={lastFull && lastFull.net != null ? (lastFull.net > 0 ? 'good' : lastFull.net < 0 ? 'crit' : undefined) : undefined}
          note={
            !months ? (memberships.state === 'failed' ? 'the memberships could not be read' : 'reading the memberships…')
              : !lastFull ? 'no month has finished yet'
                : lastFull.net == null ? 'leavers incomplete — see above'
                  : `${lastFull.joined} joined, ${lastFull.left} left`
          }
        />
        <Kpi
          label="Visits per member · 30 days"
          text={avgVisits == null ? null : avgVisits.toFixed(1)}
          note={avgNote}
        />
        <Kpi
          label="Class fill · 30 days"
          text={rated ? pct(rated.fill) : null}
          note={fillNote}
        />
      </div>

      <Joiners
        months={months}
        state={memberships.state}
        undatedJoins={undatedJoins}
      />

      <Cohorts
        rows={cohortRows}
        state={memberships.state}
        doorState={doorState}
        doorNote={doorNote}
        undatedJoins={undatedJoins}
        now={now}
      />

      <Frequency
        buckets={buckets}
        rosterSize={roster.length}
        rosterState={memberships.state}
        anonVisits={anonVisits}
        seenNotOnRoster={seenNotOnRoster}
        visitsCounted={visitsCounted}
      />

      <Money rows={moneyMonths} state={payments.state} currency={moneyCurrency} mixed={moneyMixed} />

      <ByHour rows={hours} state={visits.state} doorState={doorState} doorNote={doorNote} />
    </Shell>
  );
}

/* ── the money ─────────────────────────────────────────────────────────────── */

interface MoneyMonth {
  key: string;
  label: string;
  running: boolean;
  cents: number;
  payments: number;
  payers: number;
  /** Null when nobody paid — there is no average of nothing, and 0.00 per
   *  member reads as a gym whose members pay nothing. */
  arpuCents: number | null;
  /** Null on a running month and where there is no matching month a year back. */
  yoyPct: number | null;
}

interface HourRow { hour: number; visits: number; share: number }

/**
 * Revenue by month, per paying member, and against the same month last year.
 *
 * This page never imported `fetchPayments`. So a screen whose entire subject is
 * "which way is the gym moving" could show joiners, leavers, cohorts and visit
 * frequency, and not one figure about money — while `MONTHS_SHOWN = 13` was
 * chosen precisely so the same month last year would be on screen, and nothing
 * on the page had ever compared two months.
 *
 * The running month is shown and never compared, and the reason is worth
 * stating: a part-month is always down, always looks like a collapse, and a
 * year-on-year delta against one is the most alarming wrong number this page
 * could print. Its row carries the word "running" instead of a percentage.
 */
function Money({ rows, state, currency, mixed }: {
  rows: MoneyMonth[] | null; state: Unread; currency: string | null; mixed: boolean;
}) {
  const cols: Column<MoneyMonth>[] = [
    { key: 'month', header: 'Month', value: (m) => m.key,
      render: (m) => <span>{m.label}{m.running ? <span style={{ color: 'var(--ink3)' }}> · running</span> : null}</span> },
    { key: 'taken', header: 'Taken', value: (m) => m.cents, numeric: true,
      render: (m) => money(m.cents, currency) ?? <span className="dash">—</span> },
    { key: 'payments', header: 'Payments', value: (m) => m.payments, numeric: true },
    { key: 'payers', header: 'Paying members', value: (m) => m.payers, numeric: true },
    { key: 'arpu', header: 'Per paying member', value: (m) => m.arpuCents, numeric: true,
      render: (m) => m.arpuCents == null
        ? <span className="dash">nobody paid</span>
        : money(m.arpuCents, currency) ?? <span className="dash">—</span> },
    { key: 'yoy', header: 'vs same month last year', value: (m) => m.yoyPct, numeric: true,
      render: (m) => {
        if (m.running) return <span className="dash">the month has not finished</span>;
        if (m.yoyPct == null) return <span className="dash">no month to compare</span>;
        return (
          <span style={{ color: m.yoyPct < 0 ? 'var(--crit)' : m.yoyPct > 0 ? 'var(--good)' : undefined }}>
            {m.yoyPct > 0 ? '+' : ''}{m.yoyPct}%
          </span>
        );
      } },
  ];

  return (
    <Section
      title="Money, by month"
      sub="What was recorded as received, whatever it was for. Not what was billed and not what is owed — those are on Accounting, and this is the one that moved."
    >
      {state === 'loading' ? <Loading /> : null}
      {state === 'failed' ? (
        <Unreadable what="the payments" cost="the revenue trend is unknown, not flat" />
      ) : null}
      {state === null && mixed ? (
        <div style={{ padding: '16px 14px', color: 'var(--ink2)', fontSize: 13, maxWidth: '76ch' }}>
          The payments in this window are in more than one currency, so there is no trend to draw:
          adding dirhams to pounds is not a bigger number about the same thing. This happens to a gym
          that changed its currency — the older rows keep the one they were written in, because a
          payment is a historical fact.
        </div>
      ) : null}
      {state === null && !mixed && rows ? (
        <>
          <DataTable
            rows={rows} columns={cols} rowKey={(m) => m.key}
            empty="No payment has been recorded in thirteen months. That is not the same as no income — it is the same as nobody having entered one."
          />
          <p style={{ margin: 0, padding: '11px 14px', borderTop: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5, maxWidth: '80ch' }}>
            &ldquo;Per paying member&rdquo; divides by the members who actually paid in that month,
            not by the roster. A figure over everybody on the books answers a different question —
            how much of the roster is paying — and the two move in opposite directions at a gym that
            signs a lot of people who then do not. A payment with nobody&rsquo;s name on it is in the
            total and not in the denominator.
          </p>
        </>
      ) : null}
    </Section>
  );
}

/* ── when the gym is busy ──────────────────────────────────────────────────── */

/**
 * Door entries by hour of the day.
 *
 * `entered_at` has been read by this page since it was written and nothing has
 * ever drawn an hour out of it, while "when is my gym busy" is the single most
 * actionable staffing question an owner has. LOCAL hours: an owner in Dubai
 * staffing against a UTC histogram would put people on four hours early.
 *
 * Hours with nobody in them are shown rather than filtered out. A gap at 3pm is
 * the finding; a table that skipped it would draw a smooth day.
 */
function ByHour({ rows, state, doorState, doorNote }: {
  rows: HourRow[] | null; state: Unread;
  doorState: 'loading' | 'failed' | 'silent' | 'stale' | 'live'; doorNote: string;
}) {
  const busiest = rows ? rows.reduce((a, b) => (b.visits > a.visits ? b : a), rows[0]) : null;
  const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

  const cols: Column<HourRow>[] = [
    { key: 'hour', header: 'Hour', value: (r) => r.hour, render: (r) => hour(r.hour) },
    { key: 'visits', header: 'Entries', value: (r) => r.visits, numeric: true },
    { key: 'bar', header: 'Share of the peak hour', value: (r) => r.share, numeric: true,
      render: (r) => (
        <span style={{ display: 'inline-block', width: 160, height: 6, background: 'var(--ring2)' }}>
          <span style={{ display: 'block', height: 6, width: `${Math.round(r.share * 100)}%`, background: 'var(--brand)' }} />
        </span>
      ) },
  ];

  return (
    <Section
      title="When the gym is busy"
      sub="Door entries in the last 30 days, by hour, in the gym's own time. Hours with nobody in them are shown — a gap at three is the finding, and a table that skipped it would draw a smooth day."
    >
      {state === 'loading' ? <Loading /> : null}
      {state === 'failed' ? <Unreadable what="the door log" cost="when the gym is busy is unknown, not quiet" /> : null}
      {state === null && doorState !== 'live' ? (
        <div style={{ padding: '16px 14px', color: 'var(--ink2)', fontSize: 13, maxWidth: '76ch' }}>
          Withheld: {doorNote}. A histogram of an unplugged terminal is a chart of the hardware
          drawn as though it were a chart of the gym, and it would say the building is empty at
          every hour of the day.
        </div>
      ) : null}
      {state === null && doorState === 'live' && rows ? (
        <>
          {busiest && busiest.visits > 0 ? (
            <p style={{ margin: 0, padding: '11px 14px', borderBottom: '1px solid var(--ring)', color: 'var(--ink2)', fontSize: 13 }}>
              Busiest hour: <strong>{hour(busiest.hour)}</strong> &mdash; {busiest.visits} entr
              {busiest.visits === 1 ? 'y' : 'ies'} in 30 days.
            </p>
          ) : null}
          <DataTable rows={rows} columns={cols} rowKey={(r) => String(r.hour)} empty="—" />
        </>
      ) : null}
    </Section>
  );
}

/* ── joiners and leavers ───────────────────────────────────────────────────── */

function Joiners({ months, state, undatedJoins }: {
  months: MonthRow[] | null; state: Unread; undatedJoins: number;
}) {
  const peak = Math.max(1, ...(months ?? []).map((m) => Math.max(m.joined, m.left)));

  const cols: Column<MonthRow>[] = [
    { key: 'month', header: 'Month', value: (m) => m.label,
      render: (m) => (
        <span style={{ color: m.running ? 'var(--ink3)' : undefined }}>
          {m.label}{m.running ? ' · running' : ''}
        </span>
      ) },
    { key: 'joined', header: 'Joined', value: (m) => m.joined, numeric: true },
    { key: 'left', header: 'Left', value: (m) => m.left, numeric: true },
    { key: 'net', header: 'Net', value: (m) => m.net, numeric: true,
      render: (m) => m.net == null
        ? <span className="dash" title="leavers incomplete">— leavers incomplete</span>
        : <span style={{ color: m.net > 0 ? 'var(--good)' : m.net < 0 ? 'var(--crit)' : 'var(--ink2)' }}>
            {m.net > 0 ? `+${m.net}` : m.net}
          </span> },
    { key: 'shape', header: 'Shape', value: (m) => m.joined - m.left,
      render: (m) => <Bars joined={m.joined} left={m.left} peak={peak} /> },
    { key: 'opening', header: 'On books at start', value: (m) => (m.opening || null), numeric: true,
      render: (m) => m.opening ? String(m.opening) : <span className="dash">none</span> },
    { key: 'churn', header: 'Churn', value: (m) => m.churn, numeric: true,
      render: (m) => m.churn == null
        ? <span className="dash">— {m.churnNote}</span>
        : <span>{(m.churn * 100).toFixed(1)}%</span> },
  ];

  return (
    <Section
      title="Who arrived and who left"
      sub="Counted per person, not per membership row: somebody who cancelled and rejoined belongs to the month they first came, or the gym reads as recruiting well and keeping nobody."
    >
      {state === 'loading' ? <Loading /> : null}
      {state === 'failed' ? (
        <Failed what="the memberships"
                cost="joiners, leavers and every rate drawn from them are unknown rather than zero" />
      ) : null}
      {state === null && months ? (
        <>
          <DataTable
            rows={months} columns={cols} rowKey={(m) => m.key}
            empty="No month to draw."
          />
          <p style={{ margin: 0, padding: '12px 14px', borderTop: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            Churn is leavers over the roster the month opened with, so a member who
            joined and left inside the same month is in neither figure — both counts
            are shown beside the rate rather than folded into it. A month still
            running has no rate at all: the leavers it has not had yet have not
            happened, and a fraction of a month always reads as a good one.
            {undatedJoins > 0 ? (
              <> {undatedJoins} member{undatedJoins === 1 ? ' has' : 's have'} no usable
                start date and appear in no month here.</>
            ) : null}
          </p>
        </>
      ) : null}
    </Section>
  );
}

/** Two bars against the busiest month on screen. Proportion only — the counts
 *  are in their own columns and nothing is rounded up to be visible. */
function Bars({ joined, left, peak }: { joined: number; left: number; peak: number }) {
  const w = (n: number) => `${(n / peak) * 100}%`;
  return (
    <span style={{ display: 'inline-block', width: 130, verticalAlign: 'middle' }}>
      <span style={{ display: 'block', height: 6, background: 'var(--surface2)', borderRadius: 0, overflow: 'hidden', marginBottom: 3 }}>
        <span style={{ display: 'block', height: '100%', width: w(joined), background: 'var(--good)' }} />
      </span>
      <span style={{ display: 'block', height: 6, background: 'var(--surface2)', borderRadius: 0, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: w(left), background: 'var(--crit)' }} />
      </span>
    </span>
  );
}

/* ── cohorts ───────────────────────────────────────────────────────────────── */

const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Aug 2026' back to '2026-08', so a cohort's own month can be tested for
 *  maturity. Null rather than a guess if the label is not one of the twelve. */
function keyOfLabel(label: string): string | null {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label);
  if (!m) return null;
  const i = MONTHS3.indexOf(m[1]);
  if (i < 0) return null;
  return `${m[2]}-${String(i + 1).padStart(2, '0')}`;
}

function Cohorts({ rows, state, doorState, doorNote, undatedJoins, now }: {
  rows: Cohort[];
  state: Unread;
  doorState: 'loading' | 'failed' | 'silent' | 'stale' | 'live';
  doorNote: string;
  undatedJoins: number;
  now: number;
}) {
  const cols: Column<Cohort>[] = [
    { key: 'label', header: 'Joined in', value: (c) => c.label },
    { key: 'total', header: 'Members', value: (c) => c.total, numeric: true },
    { key: 'active', header: 'Still coming', value: (c) => (doorState === 'live' ? c.active : null), numeric: true,
      render: (c) => doorState === 'live'
        ? String(c.active)
        : <span className="dash">— {doorNote}</span> },
    { key: 'pct', header: 'Retained', value: (c) => retention(c, doorState, now).rate, numeric: true,
      render: (c) => {
        const r = retention(c, doorState, now);
        return r.rate == null
          ? <span className="dash">— {r.note}</span>
          : <span style={{ color: r.rate >= 0.5 ? 'var(--good)' : 'var(--warn)' }}>{pct(r.rate)}</span>;
      } },
  ];

  return (
    <Section
      title="Do the people who join stay?"
      sub="Members grouped by the month they first joined, and how many of that group came through the door in the last 30 days. Not class bookings — a member who moved from the 6am class to the gym floor is invisible in those and reads exactly like somebody who stopped."
    >
      {state === 'loading' ? <Loading /> : null}
      {state === 'failed' ? (
        <Failed what="the memberships" cost="there is no roster to group into cohorts" />
      ) : null}
      {state === null ? (
        <>
          <DataTable
            rows={rows} columns={cols} rowKey={(c) => c.label}
            empty="No member on the roster carries a usable join date, so there are no cohorts to draw. That is a gap in the record, not a gym with no history."
          />
          <p style={{ margin: 0, padding: '12px 14px', borderTop: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
            A cohort smaller than {MIN_COHORT_FOR_RATE} gets its counts but no
            percentage: below that one member is worth more than ten points of the
            rate, so the figure measures the cohort&rsquo;s size rather than the
            gym&rsquo;s retention. A cohort less than {COHORT_MATURITY_DAYS} days past
            its month gets none either — nobody who joined a fortnight ago has had the
            chance to leave, and 100% there is a fact about the calendar.
            {undatedJoins > 0 ? (
              <> {undatedJoins} member{undatedJoins === 1 ? '' : 's'} with no usable join
                date {undatedJoins === 1 ? 'is' : 'are'} left out entirely rather than
                bucketed into an invented cohort that would drag every rate on this table.</>
            ) : null}
          </p>
        </>
      ) : null}
    </Section>
  );
}

/**
 * A cohort's retention, or the reason it has none.
 *
 * `cohorts()` always computes a percentage, because it does not know what the
 * rows are or how old they are. Everything that disqualifies one is applied
 * here, against the shared floor rather than a second opinion about it.
 */
function retention(
  c: Cohort,
  doorState: 'loading' | 'failed' | 'silent' | 'stale' | 'live',
  now: number,
): { rate: number | null; note: string } {
  if (doorState !== 'live') {
    return {
      rate: null,
      note: doorState === 'loading' ? 'reading the door log…'
        : doorState === 'failed' ? 'the door log could not be read'
          : 'the door log is silent, so activity is unknown',
    };
  }
  const key = keyOfLabel(c.label);
  const w = key ? monthWindow(key) : null;
  if (w && now < Date.parse(w.toIso) + COHORT_MATURITY_DAYS * DAY) {
    return { rate: null, note: `joined too recently to have had the chance to leave` };
  }
  const rate = rateOf(c.active, c.total);
  if (rate != null) return { rate, note: '' };
  const p = pointsPerMember(c.total);
  return {
    rate: null,
    // An empty cohort has no "one member's worth" to state, and the dash that
    // stood there made a sentence — "0 members — one is worth — points" — that
    // named a figure it did not have and described a member who is not there.
    // Nothing is withheld by saying so plainly instead.
    note: p == null
      ? 'nobody joined in this month'
      : `${c.total} member${c.total === 1 ? '' : 's'} — one is worth ${p.toFixed(1)} points`,
  };
}

/* ── how often people come ─────────────────────────────────────────────────── */

function Frequency({ buckets, rosterSize, rosterState, anonVisits, seenNotOnRoster, visitsCounted }: {
  buckets: BucketRow[];
  rosterSize: number;
  /** Which of the three, not merely whether it is known: the footer used to say
   *  "has not been read … yet" for a roster that was refused, which is a
   *  transient-sounding sentence about a permanent failure, and the reader is
   *  left waiting for something that is not coming. */
  rosterState: Unread;
  anonVisits: number;
  seenNotOnRoster: number | null;
  visitsCounted: boolean;
}) {
  const peak = Math.max(1, ...buckets.map((b) => b.members ?? 0));

  const cols: Column<BucketRow>[] = [
    { key: 'label', header: 'In 30 days', value: (b) => b.label },
    { key: 'members', header: 'Members', value: (b) => b.members, numeric: true,
      render: (b) => b.members == null
        ? <span className="dash">— {b.note}</span>
        : <span style={{ color: b.key === '0' && b.members > 0 ? 'var(--warn)' : undefined }}>{b.members}</span> },
    { key: 'share', header: 'Share of roster', value: (b) => b.share, numeric: true,
      render: (b) => b.share == null
        ? <span className="dash">{b.members == null ? '—' : `— ${b.note}`}</span>
        : <>{pct(b.share)}</> },
    { key: 'shape', header: '', value: (b) => b.members,
      render: (b) => b.members == null ? <span className="dash">—</span> : (
        <span style={{ display: 'inline-block', width: 130, height: 6, background: 'var(--surface2)', borderRadius: 0, overflow: 'hidden', verticalAlign: 'middle' }}>
          <span style={{ display: 'block', height: '100%', width: `${(b.members / peak) * 100}%`, background: 'var(--brand)' }} />
        </span>
      ) },
  ];

  return (
    <Section
      title="How often members come"
      sub="Every active membership placed in a band by its door-log visits over the last 30 days. A gym holding its headcount while everybody halves their visits is losing, and the member count will not say so for another six months."
    >
      <DataTable
        rows={buckets} columns={cols} rowKey={(b) => b.key}
        empty="—"
      />
      <p style={{ margin: 0, padding: '12px 14px', borderTop: '1px solid var(--ring)', color: 'var(--ink3)', fontSize: 12.5 }}>
        {rosterState === null
          ? <>Counted over the {rosterSize} membership{rosterSize === 1 ? '' : 's'} marked active.</>
          : rosterState === 'loading'
            ? <>The roster is still being read, so there is no denominator here yet — and none of these bands is a zero.</>
            : <>The roster could not be read, so there is no denominator here at all — and none of these bands is a zero. This is a failed read, not a quiet gym.</>}
        {' '}A band is a count of people, not of visits.
        {visitsCounted && anonVisits > 0 ? (
          <> {anonVisits} entr{anonVisits === 1 ? 'y' : 'ies'} in the window {anonVisits === 1 ? 'is' : 'are'} attached
            to no member — a pass at the desk, or a scan that matched nobody. Real
            visits, and in no band here, because there is no one to put them against.</>
        ) : null}
        {seenNotOnRoster != null && seenNotOnRoster > 0 ? (
          <> {seenNotOnRoster} {seenNotOnRoster === 1 ? 'person came' : 'people came'} through
            the door holding no active membership — training on a card that has
            expired, or on a pass. Worth a look, and deliberately not counted as
            retention.</>
        ) : null}
      </p>
    </Section>
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * The most recent entry in the door log, with no date bound.
 *
 * This is the one read on the page whose ANSWER is allowed to be null: null
 * means the gym has never recorded a visit, which is the difference between a
 * gym nobody attends and a gym with no terminal. Everything on this page that
 * counts attendance is gated on it.
 *
 * `.error` is checked. supabase-js resolves on a database error, so without it
 * a failed read arrives as `data: null`, reads as "never recorded a visit", and
 * this page would suppress every attendance figure a working gym has — the
 * gentler failure of the two, but still a wrong one, and it would be silent.
 */
/** One payment, reduced to what a trend needs. */
interface MoneyRow { id: string; memberId: string | null; amountCents: number; currency: string; takenAt: string }

/**
 * Every membership the gym has ever written, PAGED.
 *
 * `readAll`'s contract is a TOTAL order. `started_on` is a DATE — a whole gym's
 * January intake shares one value — so it cannot be the only key, and `id` is
 * the tie-break. Without it a page boundary landing inside a busy join day
 * would drop members silently, and a dropped membership on this page is not a
 * smaller number: it is a person who reads as never having joined.
 *
 * The names are resolved here rather than by `fetchMemberships`'s own helper
 * because that helper sends every id in one `.in(...)`, and a thousand uuids is
 * a forty-kilobyte query string the gateway rejects. Chunked at the same 150
 * /export uses. An unreadable name is a null and a dash, never a dropped row —
 * the membership is real whether or not the profile read came back.
 *
 * `planName` is left null on purpose. This page never prints a plan, and
 * resolving one would be a second chunked read for a field nothing displays.
 */
const ANALYTICS_ID_CHUNK = 150;

async function pageMemberships(tenantId: string): Promise<Membership[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('memberships')
      .select('id, member_id, member_label, plan_id, started_on, ends_on, status')
      .eq('tenant_id', tenantId)
      .order('started_on', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
    'the memberships',
  );
  if (!rows.length) return [];

  const ids = [...new Set(rows.map((r: any) => r.member_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += ANALYTICS_ID_CHUNK) {
    // no-error-ok: an unreadable name becomes null and renders as a dash; the
    // membership it labels is still real and still counted.
    const { data } = await supabase
      .from('profiles').select('id, full_name').in('id', ids.slice(i, i + ANALYTICS_ID_CHUNK));
    for (const p of (data ?? []) as any[]) names.set(p.id, (p.full_name || '').trim());
  }

  return rows.map((r: any) => ({
    id: r.id,
    memberId: r.member_id,
    // The live name while there is one, then the label supabase/parts/172
    // snapshots at erasure — the same order src/lib/gymRecord.ts uses.
    memberName: names.get(r.member_id) || r.member_label || null,
    planId: r.plan_id ?? null,
    planName: null,
    startedOn: r.started_on,
    endsOn: r.ends_on ?? null,
    status: r.status,
  }));
}

/**
 * Thirteen months of payments, PAGED.
 *
 * `fetchPayments` caps and refuses, which is right for a figure somebody is
 * about to act on and wrong for a trend: a gym taking forty payments a week
 * crosses a thousand in six months, and the whole revenue history would have
 * become an error message on exactly the gyms that have one. Paging finishes
 * the read instead. `readAll`'s contract needs a TOTAL order, so `id` is the
 * final key — two payments recorded in the same second are two rows a page
 * boundary could otherwise lose.
 */
async function pagePayments(tenantId: string, sinceIso: string): Promise<MoneyRow[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_payments')
      .select('id, member_id, amount_cents, currency, taken_at')
      .eq('tenant_id', tenantId)
      .gte('taken_at', sinceIso)
      .order('taken_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    'the payments of the last thirteen months',
  );
  return rows
    .filter((r) => Number.isFinite(r.amount_cents))
    .map((r) => ({
      id: r.id,
      memberId: r.member_id ?? null,
      amountCents: r.amount_cents,
      currency: r.currency,
      takenAt: r.taken_at,
    }));
}

/**
 * Thirty days of door entries, PAGED.
 *
 * Same argument, sharper edge. `fetchVisits` throws past a thousand rows, and
 * every visit figure on this page — the cohort activity, the frequency bands,
 * the per-member counts — is made of this one read. At roughly thirty-three
 * scans a day it stopped working, so the analytics screen went dark for the
 * gyms with the most to analyse and stayed working for the ones with least.
 */
async function pageVisits(tenantId: string, sinceIso: string): Promise<Visit[]> {
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('gym_visits')
      .select('id, member_id, pass_id, class_id, entered_at, exited_at, source, note')
      .eq('tenant_id', tenantId)
      .gte('entered_at', sinceIso)
      .order('entered_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    'the door log for the last 30 days',
  );
  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id ?? null,
    // The name is deliberately not joined here. This page counts visits and
    // never prints one, and the embedded `profiles(full_name)` join costs a row
    // per entry on a read that is now paged over thousands of them.
    memberName: null,
    passId: r.pass_id ?? null,
    classId: r.class_id ?? null,
    enteredAt: r.entered_at,
    exitedAt: r.exited_at ?? null,
    source: r.source,
    note: r.note ?? null,
  }));
}

async function lastVisitAt(tenantId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('gym_visits')
    .select('entered_at')
    .eq('tenant_id', tenantId)
    .order('entered_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data ?? [])[0]?.entered_at ?? null;
}

/** A plain 'YYYY-MM-DD' as local noon, so any module that parses it and reads
 *  the month back in local time gets the month the gym meant. Midnight UTC does
 *  not survive the trip west of Greenwich. */
function localNoon(day: string): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0).toISOString();
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

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

function Kpi({ label, text, note, tone }: {
  label: string; text: string | null; note?: string; tone?: 'good' | 'crit';
}) {
  const colour = text == null ? 'var(--ink3)' : tone ? `var(--${tone})` : 'var(--ink)';
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

function Failed({ what, cost }: { what: string; cost?: string }) {
  return (
    <div style={{
      padding: '16px 14px', margin: '14px', borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {what}. This section is <strong>unknown</strong>, not empty
      {cost ? <> — {cost}</> : null}. The reason is in the banner at the top of the page.
    </div>
  );
}

/** A read that definitively failed, and what is therefore unknown rather than
 *  empty. Same shape and same sentence as /revenue and /close, so an owner who
 *  has seen one of these has read all of them. */
function Unreadable({ what, cost }: { what: string; cost: string }) {
  return (
    <div style={{
      padding: '16px 14px', margin: 14, borderRadius: 0,
      border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
      background: 'var(--surface2)', color: 'var(--ink2)', fontSize: 13,
    }}>
      Could not read {what}. This section is <strong>unknown</strong>, not empty &mdash; {cost}.
      Reload before acting on anything above it.
    </div>
  );
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
