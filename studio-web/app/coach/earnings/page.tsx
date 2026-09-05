'use client';

// Earnings — what one coach has earned in a chosen month, what of it has
// already been paid, and what is holding the rest up.
//
// /payroll is the same money read from the gym's side: every trainer on one
// screen, with a button that hands money over. This is the other side of it,
// and it is deliberately smaller and read-only. A coach does not need the
// roster, does not need anybody else's rates, and must never be handed a
// control that records their own pay. What a coach needs is the answer to one
// question asked at the end of every month — "is that right?" — and the rows
// that answer it.
//
// Two rules do all the work here.
//
// SCOPED TO THE SIGNED-IN COACH, IN THE QUERY. Every read below carries
// .eq('trainer_id', me.id) as well as the tenant. Not a filter applied to a
// tenant-wide read after it lands: a tenant-wide read pulls every colleague's
// sessions and rates into this browser, and one missing .filter() away from
// there is a coach reading another coach's book. The in-memory filter that
// follows each read is a second belt, not the first one.
//
// A PARTIAL SUM IS WORSE THAN NO SUM. When anything in the month is still
// unmarked, the outstanding figure is a dash with the reason beside it, never
// a number. The number would be real arithmetic over the sessions somebody
// did mark — and it would be smaller than what the coach is owed, look exactly
// like a final figure, and be read as being underpaid. The reason comes from
// settlementBlocker and is printed word for word, because "3 sessions still
// need an outcome recorded." tells a coach what to chase and "—" alone does
// not.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
// `Unresolved` comes from here rather than being declared at the bottom of
// this file. Seven console screens held a byte-identical copy, every one of
// them a plain `<div>` — so the sentence saying THIS section's rows could not
// be read was never announced. One copy, with the live region on it.
import { ConsoleGate, Unresolved } from '@/components/Gate';
import { type Unread, failure } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { monthTickStart } from '@lib/pickerMonth';
import { useMonthTick } from '@/lib/monthTick';
import { settledLanded } from '@lib/readLanded';
import { DataTable, type Column } from '@/components/DataTable';
import { amount, currencyNote, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import {
  isDelivered, isAwaitingOutcome, isPayable,
  payrollByTrainer, payrollTotal, settlementBlocker,
  settleableSessions, settlementAmount, settleBlocker,
  PAY_DELIVERED_ONLY,
  type PtSession, type PayPolicy, type Settlement,
} from '@lib/gymSessions';
import { money } from '@lib/gymRecord';
// The gym's session fee is stored in WHOLE units; every `*_cents` column is
// minor units, and the factor is not a hundred.
import { minorFromWhole } from '@lib/coachMoney';
// What money a run of sessions is actually in — see the note on the settled
// total below. `sessions.rate_currency` (supabase/parts/1010) is what makes it
// answerable at all.
import { runCurrency, totalNote } from '@lib/gymRateCurrency';
// The middle of the three layers that price a session — what this gym pays THIS
// coach. RLS hands a coach their own row and nobody else's.
import { fetchTrainerPay, withResolvedRates, type PayIndex } from '@lib/gymPay';
import { payPolicyOf, PAY_POLICY_LABEL, type PayPolicyCode } from '@lib/gymPolicy';
import { isoDate } from '@lib/format';
import { assertWhole, capLimit, capped, readAll, type CappedRead } from '@lib/rowCap';
import { readByIds } from '@lib/idLookup';
// The reader's locale, the GYM's zone. A coach checking a payslip abroad was
// shown their own laptop's day for every session and every payment run.
import { gymDateText, gymDateTimeText, calendarDateText } from '@lib/gymWhen';
import { parseGymZone } from '@lib/gymZone';
import { Banner } from '@/components/Banner';

/** How many months back a coach can look. */
const PERIODS = 12;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "Nothing has been paid for this month yet" are both lies about a query that
 * errored — and the second one sends a coach to argue with their gym about a
 * payment that may well have been made.
 */


interface Period {
  key: string;
  label: string;
  /** Bounds of the calendar month in the gym's own timezone, as instants. */
  fromIso: string;
  toIso: string;
  fromDate: string;
  toDate: string;
}

/**
 * The last few calendar months, in the gym's timezone.
 *
 * Local, not UTC, and for the same reason the door log and the payroll run are:
 * this product sells in AED, so the desk is four hours ahead and the UTC month
 * does not turn over until 04:00 on the 1st. Built from UTC bounds, every
 * session a coach delivered in the first four hours of the 1st would show up in
 * the previous month — and a coach checking a payslip against this screen would
 * find an hour missing from one month and an extra hour in another.
 */
function periodsBack(n: number, at: number = Date.now()): Period[] {
  // The instant is an ARGUMENT. It was `new Date()` here, called from a
  // `useMemo(..., [])` one screen down, so the list of months this screen
  // offered was fixed at the moment the tab was opened — and this console has no
  // router, so that tab is a document that lives for days. On the 1st, the month
  // that had just ended was not in the picker and the run for it could not be
  // opened at all. Neither clock gate could see it: the clock was in here, and
  // the memo that froze it was down there.
  const now = new Date(at);
  const out: Period[] = [];
  for (let i = 0; i < n; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const nextStart = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const end = new Date(nextStart.getTime() - 1);
    out.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      // A calendar month, not an instant: `start` is a LOCALLY built midnight
      // of the 1st, and drawing it in any zone at all can name the month before.
      label: calendarDateText(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`,
        { month: 'long', year: 'numeric' }) ?? '—',
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      fromDate: isoDate(start),
      toDate: isoDate(end),
    });
  }
  return out;
}

/* ── reads, scoped to one coach ────────────────────────────────────────────── */

/** The names, and whether the read that was meant to supply them happened. */
interface ClientNames {
  names: Map<string, string>;
  /** Null when the read came back. A sentence when it did not. */
  unread: string | null;
}

/**
 * Client names for a set of session rows.
 *
 * Not a PostgREST embed: `clients` carries no full_name, and sessions reaches it
 * through two foreign keys, so the embed is both wrong and ambiguous. Ids out,
 * profiles in — the shape gymSessions uses.
 *
 * A failure here is deliberately not fatal. A name is a label on a row whose
 * subject is money; losing it must not black out a figure that is perfectly
 * readable without it.
 *
 * But it is not silent either, and it used to be. The error was swallowed and
 * an empty map returned, and an empty map is indistinguishable from a
 * successful read — so a refused profiles query rendered every row's client as
 * the same em dash that a session with NO CLIENT ON IT shows. Two different
 * facts, one glyph, and on this screen they are not close: "this hour was not
 * against anybody" is a thing the coach knows about their own week, and "we
 * could not read who this was" is a reason to reload. So the failure travels
 * with the names and the table says which it is.
 *
 * A name MISSING from a read that succeeded is a third thing again, and it is
 * normal rather than a fault. Verified against the live database: a coach
 * reaches `profiles` through `profiles_trainer_read` and
 * `profiles_trainer_r_clients`, both of which are scoped to their own clients,
 * so a session against somebody who is no longer on their roster comes back
 * without a name and is entitled to. Asking for three ids and getting two is
 * not truncation and is not treated as it.
 */
async function clientNames(ids: string[]): Promise<ClientNames> {
  /*
   * CHUNKED, and it was one bare `.in('id', unique)` with a `capLimit()` on it.
   *
   * The comment that stood here said the list "cannot truncate in practice"
   * because it is bounded by one coach's sessions in one month, and that is
   * true of the ROW CAP and irrelevant to the failure that actually reaches a
   * coach. A uuid costs about 39 bytes inside an `in.("…","…")` list, so past
   * roughly two hundred distinct people the REQUEST LINE goes over the 8KB
   * nginx and most CDNs allow: PostgREST answers 414, supabase-js hands back
   * `data: null`, and — because a 414 is not a row-cap hit — `assertWhole` sees
   * nothing wrong with it. Every row on the screen would render with the "not
   * named" dash and the reason given would be a refusal that never happened.
   *
   * Two hundred distinct clients in a month is a group coach with a full
   * timetable, not a hypothetical: src/lib/idLookup.ts sets ID_CHUNK at 150 for
   * exactly this and `readByIds` pages inside each chunk, so no chunk can
   * truncate either — 150 primary keys cannot answer with more than 150 rows.
   *
   * A throw is still caught and still reported as one sentence, because the
   * rule above has not changed: losing a name must not black out a figure that
   * is perfectly readable without it.
   */
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { names: new Map(), unread: null };
  let rows: Array<{ id: string; full_name: string | null }>;
  try {
    rows = await readByIds<{ id: string; full_name: string | null }>(
      unique,
      (chunk, from, to) => supabase.from('profiles').select('id, full_name')
        // Ordered by the primary key, which `readAll` inside `readByIds`
        // requires and which `profiles.id` satisfies: it IS the primary key, so
        // it cannot tie and no page can drop a row.
        .in('id', chunk).order('id', { ascending: true }).range(from, to),
      'the names of your clients',
    );
  } catch (e: any) {
    return { names: new Map(), unread: e?.message ?? 'the names could not be read' };
  }
  const m = new Map<string, string>();
  for (const p of rows) {
    const name = (p.full_name ?? '').trim();
    if (p.id && name) m.set(p.id, name);
  }
  return { names: m, unread: null };
}

/**
 * This coach's sessions in one month.
 *
 * gymSessions.fetchSessions is tenant-scoped, which is right for the owner's
 * payroll run and wrong here twice over: it would put every colleague's rates
 * in this browser, and for an owner who also coaches it would silently widen
 * this screen from "your month" to "the gym's month" without the heading
 * changing. trainer_id is in the query.
 */
/** A month's sessions, and whether the names on them could be read. The two
 *  travel together because a screen that has one without the other cannot tell
 *  an unnamed row from an unreadable one. */
interface MyMonth {
  sessions: PtSession[];
  namesUnread: string | null;
}

async function fetchMySessions(
  tenantId: string, trainerId: string, fromIso: string, toIso: string,
): Promise<MyMonth> {
  // ── Why this pages ──────────────────────────────────────────────────────
  //
  // It was a bare `.select()` with no ceiling, and every figure on this screen
  // — delivered, outstanding, already settled — is a sum over what it returns.
  // PostgREST answers an unbounded request with a thousand rows and says
  // nothing, so a coach past that ceiling would have been shown a smaller month
  // with no sign that it was smaller, and the number they check their payslip
  // against would have been quietly short.
  //
  // `readAll` rather than `assertWhole`, for the reason src/lib/rowCap.ts gives:
  // one coach in one month is a set that is finite by construction, and
  // refusing the whole screen to protect a figure that can simply be finished
  // would take a working payslip check away for no gain.
  //
  // The order is closed on `id`. `starts_at` ties whenever two sessions start
  // on the hour, and a tied order across separate page requests may drop a row
  // or return one twice — silently, and in a figure about somebody's pay.
  //
  // supabase-js resolves on a database error rather than rejecting; `readAll`
  // throws on it, which is what stops a refused read becoming an empty month.
  const rows = await readAll<any>(
    (from, to) => supabase
      .from('sessions')
      .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, rate_currency, settlement_id, pack_drawn_kind, pack_drawn_at, pack_draw_shortfall_at')
      .eq('tenant_id', tenantId)
      .eq('trainer_id', trainerId)
      .gte('starts_at', fromIso)
      .lte('starts_at', toIso)
      .order('starts_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
    'your sessions for this month',
  );
  // Second belt. The query above is the guard; if it ever stops being, this
  // stops a colleague's session reaching the screen rather than merely making
  // the total wrong.
  const mine = rows.filter((r) => r.trainer_id === trainerId);
  const { names, unread } = await clientNames(mine.map((r) => r.client_id).filter(Boolean));

  return { namesUnread: unread, sessions: mine.map((r) => ({
    id: r.id,
    trainerId: r.trainer_id,
    trainerName: null,
    clientId: r.client_id ?? null,
    clientName: r.client_id ? names.get(r.client_id) ?? null : null,
    startsAt: r.starts_at,
    durationMin: r.duration_min ?? 60,
    status: r.status,
    outcome: r.outcome ?? null,
    outcomeAt: r.outcome_at ?? null,
    rateCents: r.rate_cents ?? null,
    rateCurrency: r.rate_currency ?? null,
    settlementId: r.settlement_id ?? null,
    // What the CLIENT paid with (supabase/parts/370), which is not the same
    // question as the settlement beside it — that is what the gym paid the
    // coach. A shortfall is the two disagreeing.
    packDrawnKind: r.pack_drawn_kind ?? null,
    packDrawnAt: r.pack_drawn_at ?? null,
    packDrawShortfallAt: r.pack_draw_shortfall_at ?? null,
  })) };
}

/**
 * How many payment runs this screen will hold.
 *
 * Named rather than typed into the query, because the number appears in the
 * sentence the coach reads as well as in the read, and the two drifting apart
 * — a limit of 200 under a note saying 100 — is a lie a reader cannot detect.
 */
const SETTLEMENT_CAP = 100;

/**
 * What this coach has actually been paid. Their own rows and nobody else's.
 *
 * The `SETTLEMENT_CAP` is a deliberate prefix, not an accident of the cap, and
 * src/lib/rowCap.ts's rule — a limit the caller asked for is not a set that was
 * cut off behind its back — applies. It is safe because of what these rows are
 * USED for and nothing else: `paidHere` keeps only the settlements whose ids
 * are stamped on sessions in the selected month, and the month is one of the
 * last few. A settlement covering a session that recent cannot be older than
 * the hundredth most recent run against this one coach, which for monthly
 * payroll is eight years. Nothing here totals the list, and nothing says "these
 * are all your payments".
 *
 * ── Why the fact now leaves this function ─────────────────────────────────
 *
 * Every sentence above is an argument that survived only in this comment. The
 * return type was `Settlement[]`, so the screen was handed a prefix and a whole
 * set in the same shape and had no way to tell them apart — and the reasoning
 * holds exactly as long as the period picker offers a few months. Nothing in
 * the type stopped the next person adding "Last two years", at which point a
 * coach's payment history quietly becomes a subtotal with a heading on it.
 *
 * So it returns `CappedRead<Settlement>`: the honest page and the flag
 * together, which is the shape src/lib/rowCap.ts asks for and the same one
 * `app/(owner)/ops.tsx` already carries on the phone. The read asks for one row
 * PAST the cap — `capLimit(SETTLEMENT_CAP)` — because that is the only way a
 * full page and a truncated one stop looking identical, and `capped()` trims
 * the probe row back off so it can never be rendered as a payment.
 */
async function fetchMySettlements(
  tenantId: string, trainerId: string,
): Promise<CappedRead<Settlement>> {
  const { data, error } = await supabase
    .from('payroll_settlements')
    .select('id, trainer_id, period_from, period_to, amount_cents, currency, sessions_count, method, note, settled_at')
    .eq('tenant_id', tenantId)
    .eq('trainer_id', trainerId)
    .order('settled_at', { ascending: false })
    // Closed on `id`, because `settled_at` ties: a payroll run that settles
    // twenty coaches writes twenty rows on one timestamp, and an unclosed order
    // makes "the hundred most recent" a different hundred on every request.
    .order('id', { ascending: false })
    .limit(capLimit(SETTLEMENT_CAP));
  if (error) throw error;
  // Split BEFORE the mapping, so `truncated` is a fact about what the database
  // returned rather than about what survived the filter below.
  const page = capped((data ?? []) as any[], SETTLEMENT_CAP);
  const rows = page.rows
    .filter((r) => r.trainer_id === trainerId)
    .map((r) => ({
      id: r.id,
      trainerId: r.trainer_id,
      periodFrom: r.period_from,
      periodTo: r.period_to,
      amountCents: r.amount_cents ?? 0,
      // Not `?? 'AED'`. This is what a coach was actually handed. The column is
      // NOT NULL and — since supabase/parts/150 — has NO DEFAULT, so a
      // settlement that does not name its currency is rejected rather than
      // filed as dirhams, and the branch below does not fire in practice. "In
      // practice" is what every currency bug in this repo was made of, so it is
      // still written: null reaches money(), which withholds the figure rather
      // than denominating somebody's pay for them.
      currency: r.currency ?? null,
      sessionsCount: r.sessions_count ?? 0,
      method: r.method ?? 'transfer',
      note: r.note ?? null,
      settledAt: r.settled_at,
    }));
  return { rows, truncated: page.truncated };
}

/* ── the screen ────────────────────────────────────────────────────────────── */

export default function CoachEarnings() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  // `tenants.currency`, null when the gym has not set one. The settlement rows
  // at the bottom carry their own currency and use it; everything derived from
  // the session fee has none of its own and inherits the gym's.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);

  // "The gym has not set a session fee" and "we could not read the gym" both
  // leave sessionFee null, and they are different errands: one is a setting the
  // owner must fill in, the other is a read to retry. Without this string the
  // screen tells a coach to go and ask for a fee that is probably already set.
  const [gymError, setGymError] = useState<string | null>(null);

  /**
   * The months this screen offers — built once a MONTH, not once a mount.
   *
   * `useMonthTick` re-renders this screen when the calendar month turns over and
   * at no other time, which is exactly how often a month picker should change.
   * NOT the read stamp: the read here is fired by an effect keyed on `period`,
   * so rebuilding this list from the read stamp would be a loop — the read
   * stamps the instant, the instant rebuilds the period, the period fires the
   * read. The chosen month is held separately below and survives the rebuild.
   */
  const tick = useMonthTick();
  const periods = useMemo(() => periodsBack(PERIODS, monthTickStart(tick).getTime()), [tick]);
  const [periodKey, setPeriodKey] = useState(periods[0].key);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];

  const [sessions, setSessions] = useState<PtSession[] | null>(null);
  const [runs, setRuns] = useState<Settlement[] | null>(null);
  /**
   * True when the payment history came back at `SETTLEMENT_CAP` — the rows are
   * real and there are older ones. Held apart from `runs` for the reason the
   * whole console holds read states apart from rows: a prefix rendered as a
   * complete list is the one failure that looks like success.
   */
  const [runsPrefix, setRunsPrefix] = useState(false);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  // Carried apart from `sessionsErr` because it is a different failure with a
  // different cost: the sessions are readable and every figure on this screen
  // is right, and the only thing missing is who each hour was with. Folding it
  // into the banner would tell a coach their month could not be read.
  const [namesErr, setNamesErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /**
   * What this gym pays THIS coach per delivered session — the middle of the
   * three layers that price a session, which this screen did not read at all.
   *
   * /payroll resolves all three and pays from that. This one resolved the first
   * and the third, so a coach on a rate above their gym's standard fee was
   * shown, on their own earnings screen, what they would be owed if they were
   * on the standard one. RLS scopes the read to their own row
   * (`gym_trainer_pay_self_r`), so the same call the owner console makes hands a
   * coach exactly the one row that concerns them.
   *
   * The error is held apart from the map: an empty map is "this gym has set no
   * per-coach rate", which is a real and common answer, and a failed read is
   * "we do not know", which must not be shown as the former on the screen a
   * coach checks their pay against.
   */
  const [pay, setPay] = useState<PayIndex | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);

  /**
   * Read the month.
   *
   * `stale` is not tidiness. Switching from August to July while August is still
   * in flight would otherwise let the slower answer land last, painting August's
   * sessions under July's heading and July's total. On a screen a coach checks a
   * payslip against, that is a month's pay shown as the wrong month's.
   */
  const load = useCallback(async (
    tenantId: string, trainerId: string, p: Period, stale: () => boolean = () => false,
  ): Promise<boolean> => {
    setSessions(null); setRuns(null); setRunsPrefix(false); setNamesErr(null);

    // allSettled, not all: one failing read must not take the other with it.
    // Under Promise.all a refused payroll_settlements query would also empty the
    // sessions — so a screen whose only fault was not knowing what had been paid
    // would instead report a month with no work in it, and the two wrong facts
    // point opposite ways.
    const [sRes, rRes, pRes] = await Promise.allSettled([
      fetchMySessions(tenantId, trainerId, p.fromIso, p.toIso),
      fetchMySettlements(tenantId, trainerId),
      // Under the same allSettled and for the same reason: a refused rates read
      // must not empty the month, and it must not be reported as "this gym pays
      // you its standard fee".
      fetchTrainerPay(supabase, tenantId),
    ]);

    // A read superseded by a month change writes nothing and stamps nothing:
    // it landed, but not on what is on screen.
    if (stale()) return false;

    // A read that failed is null, never []. [] is the gym saying there were
    // none; null is nobody knowing. Here those two answers differ by a month's
    // wages.
    setSessions(sRes.status === 'fulfilled' ? sRes.value.sessions : null);
    setNamesErr(sRes.status === 'fulfilled' ? sRes.value.namesUnread : null);
    setRuns(rRes.status === 'fulfilled' ? rRes.value.rows : null);
    setRunsPrefix(rRes.status === 'fulfilled' && rRes.value.truncated);

    setPay(pRes.status === 'fulfilled' ? pRes.value : null);

    const s = failure(sRes, 'your sessions for this month');
    const r = failure(rRes, 'what you have already been paid');
    const pf = failure(pRes, 'what this gym pays you per session');
    setPayErr(pf);

    const trouble = [s, r, pf].filter((x): x is string => x !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
    setSessionsErr(s); setRunsErr(r);

    // Whole means both came back. `useFetched` stamps only on a whole read, so
    // a month read without the settlements — the half that says what has
    // already been paid — leaves the stamp where it was rather than dating an
    // outstanding figure that is missing its subtrahend.
    return settledLanded([sRes, rRes, pRes]);
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
      if (!who?.tenantId) return;
      const { data: g, error } = await supabase
        .from('tenants').select('name, session_fee, currency, session_pay_policy, timezone').eq('id', who.tenantId).single();
      if (!live) return;
      setGymName(error ? null : g?.name ?? null);
      setSessionFee(error ? null : g?.session_fee ?? null);
      setPolicyCode(error ? null : (((g as any)?.session_pay_policy ?? null) as string | null));
      setCcy(error ? null : ((((g as any)?.currency ?? '') as string).trim().toUpperCase() || null));
      setGymError(error ? (error.message || 'Could not read your gym.') : null);
      const z = error ? { kind: 'clear' as const } : parseGymZone((g as any)?.timezone);
      setZone(z.kind === 'zone' ? z.zone : null);
    })();
    return () => { live = false; };
  }, []);

  // The month is a dependency on purpose: changing it is a fresh read, not a
  // filter over rows already in hand. Filtering would show August's sessions
  // under September's heading until something else happened to trigger a load.
  const generation = useRef(0);
  const { at: readAt, busy: reading, refresh } = useFetched(async () => {
    if (!me?.tenantId) return false;
    const mine = (generation.current += 1);
    return load(me.tenantId, me.id, period, () => generation.current !== mine);
  });

  /** When this month was read, and therefore the instant "has this session
   *  finished yet" is asked at. `readAt` and not `Date.now()`: a memo keyed on
   *  the rows never re-runs because time passed, so a literal clock read inside
   *  one is pinned to the render that first produced it. */
  const nowMs = readAt ?? Date.now();

  /**
   * The month, kept current and dated.
   *
   * The month is a dependency on purpose: changing it is a fresh read, not a
   * filter over rows already in hand. Filtering would show August's sessions
   * under September's heading until something else happened to trigger a load.
   * A change made while the previous month is still in flight is COALESCED by
   * `useFetched` rather than dropped, and the superseded read neither writes
   * nor stamps.
   *
   * The stamp is what a coach needed here: this is the screen a payslip is
   * checked against, and a session marked by the owner ten minutes ago moves
   * the outstanding figure. Left open on a phone all afternoon it answered
   * about lunchtime and said nothing about it.
   */
  useEffect(() => {
    if (me === undefined) return;
    if (!me?.tenantId) { setSessions([]); setRuns([]); setNamesErr(null); return; }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, period]);

  // The gym's fee is in whole units; everything downstream is minor units.
  //
  // It was `Math.round(sessionFee * 100)`. /close carries the same repair: a
  // ¥6,000 fee became 600,000 minor units, and this is the screen on which a
  // coach reads what they are owed. `minorFromWhole` takes the places from the
  // gym's currency, and gives null rather than a figure when nothing named one.
  const fallbackCents = minorFromWhole(sessionFee, ccy);

  /**
   * The gym's pay policy, READ — stated rather than chosen, and no longer
   * assumed.
   *
   * This was `const policy: PayPolicy = PAY_DELIVERED_ONLY`, and the banner
   * below said so to the coach in as many words: "whether your gym pays for a
   * no-show or a late cancellation is its own policy, and this screen cannot
   * read it". That sentence was true and it was the bug. A coach at a gym that
   * does pay for no-shows was shown a number smaller than their actual pay,
   * every month, with an explanation that made it sound like a limitation of
   * the world rather than of a missing column.
   *
   * It is still not a coach DECISION — there is no control here, and there must
   * not be, or a coach could raise their own figure by ticking a box. The gym
   * says it once on /settings and this screen reads it.
   */
  const [policyCode, setPolicyCode] = useState<string | null>(null);
  const stated = payPolicyOf(policyCode);
  // The floor where the gym has not said. It cannot overstate what a coach is
  // owed, and the banner below now says which of the two cases this is.
  const policy: PayPolicy = stated ?? PAY_DELIVERED_ONLY;

  /**
   * The sessions with the rate that actually applies written onto each one —
   * and the money that rate is in written beside it.
   *
   * ── The defect this closes ────────────────────────────────────────────
   *
   * This screen priced its FIGURE with the gym's standard fee (`fallbackCents`
   * went to `payrollByTrainer`) and priced its OUTSTANDING SET without it
   * (`settleableSessions(sessions, policy)` — no fourth argument). Those two
   * functions have already disagreed about what "priced" means once, and
   * src/lib/gymSessions.ts carries the account of it at length; this is that
   * disagreement, reintroduced on the one screen a coach reads to check they
   * are being paid.
   *
   * What it looked like: `settleableSessions` keeps only rows whose
   * `rateCents ?? fallback` is non-null, so with no fallback passed it dropped
   * every session priced off the gym's fee. `outstanding` came back empty,
   * `settlementBlocker(total)` saw nothing wrong — the fee HAD priced them for
   * the total — and the Outstanding tile rendered `amount(0, ccy)` under the
   * note "Nothing outstanding for this trainer." Verified against the live
   * database: of 262 sessions, ONE carries `rate_cents`. So that tile read a
   * confident nought for essentially every coach at every gym, while /payroll
   * — which resolves rates up front, exactly as below — showed the owner the
   * real figure for the same month.
   *
   * ── Why `withResolvedRates` and not two layers here ──────────────────
   *
   * It is the same function /payroll and /sessions resolve with, so all three
   * screens read one implementation of the three-layer rule rather than three
   * copies of it — which is what the header of src/lib/gymPay.ts says the whole
   * shape exists for. It also brings the middle layer, `gym_trainer_pay`, which
   * this screen never read: a coach on a rate above their gym's standard fee
   * was shown what the standard fee would pay them.
   *
   * The gym's currency goes in with the fee so the unit is resolved with the
   * number. `runCurrency` reads `rateCurrency` off the rows, so without it a
   * set of fallback-priced sessions is a run in no money at all and the tile
   * falls through to a dash — for a figure whose unit is simply the gym's, one
   * column away. Where the gym has named no currency, `fallbackCents` is null
   * anyway and nothing is priced: unpriced work stays unpriced rather than
   * becoming a nought.
   *
   * Nothing is written to the database. `sessions.rate_cents` still holds only
   * what was snapshotted at delivery.
   */
  const priced = useMemo(
    () => (sessions ? withResolvedRates(sessions, pay ?? new Map(), fallbackCents, ccy) : null),
    [sessions, pay, fallbackCents, ccy],
  );

  // Stays null while `sessions` is null rather than collapsing to []. Handing
  // payrollByTrainer an empty array produces a confident, complete-looking month
  // in which nothing is owed, built out of a read that never returned.
  const lines = useMemo(
    // The fourth argument is `now`, and it defaulted. Nothing in this dependency
    // list moves when time does, so `unmarked` — the count that tells a coach a
    // session they delivered has no outcome recorded against it yet — was frozen
    // at the moment the tab was opened. A session finished since then simply did
    // not appear, and a coach reading a complete-looking month has no reason to
    // go and ask about it.
    //
    // `null` and not `fallbackCents`: the fallback has already been applied by
    // `priced` above, and passing it a second time is exactly how the three
    // functions came to disagree the first time. /payroll takes the same care.
    () => priced && payrollByTrainer(priced, policy, null, nowMs),
    [priced, policy, nowMs],
  );
  const total = useMemo(() => payrollTotal(lines ?? []), [lines]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  // A refused profile read is not a statement about who somebody is.
  //
  // `roleUnknown` exists in lib/supabase.ts for exactly this branch, and these
  // three coach screens were the only ones in the console without it: the
  // fifteen owner pages all carry it. Without it, an RLS hiccup on `profiles`
  // arrived as `role: null`, fell into the refusal below, and told a working
  // coach "your account is not a coaching account" — a claim about them, made
  // out of a query that failed.
  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymError} current="/coach/earnings">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not being a coach. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'trainer' && me.role !== 'owner') {
    // A plain sentence, not empty tables. Empty tables read as "you have earned
    // nothing", which is a far worse thing to tell somebody than "wrong screen".
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymError} current="/coach/earnings">
        <h1>This screen is for coaches</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: 560 }}>
          Earnings shows one coach&rsquo;s delivered sessions and what they are owed for them.
          Your account is not a coaching account, so there is no book to show — that is not the
          same as a book with nothing in it.
        </p>
      </Shell>
    );
  }

  // An account with no gym on it gets a sentence, not an earnings board.
  //
  // The effect above sets sessions and runs to [] in this case, so the screen
  // read "Sessions delivered 0", "Nothing waiting — every finished session this
  // month has an outcome" and "No payment has been recorded against this
  // month's sessions yet." to a coach whose profile simply carries no
  // tenant_id. Every one of those is a statement about their pay, made out of
  // a query that was never run.
  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={!!gymError} current="/coach/earnings">
        <h1>My earnings</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          Your account is not linked to a gym, so there are no sessions to price
          and no settlements to read. This is not a month in which you earned
          nothing — it is an account with no gym on it. The gym&rsquo;s owner
          sets that.
        </p>
      </Shell>
    );
  }

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread = (rows: unknown[] | null, e: string | null): Unread =>
    rows !== null ? null : e ? 'failed' : 'loading';

  const sessionsUnread = unread(sessions, sessionsErr);
  const runsUnread = unread(runs, runsErr);

  /*
   * Why the month has no outstanding figure, in words the coach can act on.
   *
   * settlementBlocker's own sentences, printed verbatim — "4 sessions still need
   * an outcome recorded." is the whole point of the dash beside it. Two things
   * it cannot know, because it sees only the sessions: with `sessions` null it
   * would answer "No payable sessions in this period." about a month nobody
   * managed to read, and when payable sessions have no rate it says "set a
   * session fee", which is the wrong errand when the fee is missing because the
   * gym row could not be read.
   */
  const blocker =
    sessions === null
      ? null
      : gymError && total.priced < total.payable
        ? `Your gym could not be read, so there is no session fee to price the rest with: ${gymError}`
        // A refused rates read leaves every session priced at the gym's
        // STANDARD fee, and for a coach on their own rate that is silently
        // smaller than what they are owed. On the screen a coach checks their
        // pay against, a figure that can only be too low is worse than a dash:
        // the dash sends them back in a minute, the figure sends them to their
        // owner with the wrong number.
        : payErr
          ? `${payErr} Without it every session here would be priced at the gym's standard fee, which is the wrong figure if you are on a rate of your own — so this month has no outstanding total yet.`
          : settlementBlocker(total);

  // Marked, payable, priced, and not already stamped with a payment. Paying by
  // session rather than by period is what stops a late-marked session being paid
  // twice — and it is why a coach's outstanding figure can be right even when a
  // previous month was settled before they finished marking it.
  //
  // Over `priced`, not over `sessions`: see the note on `priced` above. Given
  // the raw rows this filter drops every session the gym's standard fee is what
  // pays for, which is all of them at a gym that snapshots no rates — and the
  // tile then says nought is owed.
  const outstanding = priced ? settleableSessions(priced, policy) : null;

  /*
   * The outstanding figure, and the single most important decision on this
   * screen.
   *
   * A dash whenever anything blocks it — not only when the sum comes back null.
   * With sessions unmarked, settlementAmount over `outstanding` is a real sum
   * over the sessions somebody did mark: it looks final, it is smaller than the
   * truth, and a coach reading it concludes they are being short-paid. The
   * honest answer is that this month does not have a figure yet, and the reason
   * beside the dash says which sessions are missing.
   */
  const outstandingRun = outstanding === null ? null : runCurrency(outstanding);
  const outstandingText =
    sessions === null || outstanding === null || blocker !== null
      ? null
      // The same rule as the settled total below: the money these sessions were
      // priced in, never the money the gym charges in this month. An
      // outstanding figure with the wrong currency on it is what a coach takes
      // to their owner to argue about.
      : outstandingRun !== null && outstandingRun.kind === 'one'
        ? money(outstandingRun.minorUnits, outstandingRun.currency)
        // Nothing settleable is genuinely nothing owed, and that is a figure —
        // it just has no currency of its own, so it borrows the gym's.
        : outstanding.length === 0
          ? amount(0, ccy)
          : null;

  // Sessions in this month already stamped with a payment, and what their own
  // snapshotted rates say those were worth. A rate missing on a settled session
  // means this cannot be totalled — a dash, not a smaller number, for the same
  // reason as above.
  const settledSessions = sessions ? sessions.filter((s) => s.settlementId != null) : null;
  const settledUnpriced = settledSessions ? settledSessions.filter((s) => s.rateCents == null).length : 0;
  /*
   * What has already been paid, IN THE MONEY IT WAS PAID IN.
   *
   * This was `settledSessions.reduce((a, s) => a + (s.rateCents ?? 0), 0)`
   * rendered with `ccy` — the gym's currency today. A gym that changed
   * `tenants.currency` had every session it delivered beforehand relabelled by
   * this tile, and a period straddling the change was added across two
   * currencies and presented as one figure. The settlement rows at the bottom
   * of this very screen already do it properly, each with its own
   * `money(r.amountCents, r.currency)`: one screen, one coach, two answers.
   *
   * `runCurrency` reads what the sessions themselves say. One currency is a
   * figure; two is no figure at all; and rates snapshotted before
   * supabase/parts/1010 carry no unit, which is a third answer and not the
   * gym's code — that substitution is the defect, not the fallback for it.
   */
  const settledRun = settledSessions === null || settledUnpriced > 0
    ? null
    : runCurrency(settledSessions);
  const settledText = settledRun === null
    ? null
    : settledRun.kind === 'one'
      ? money(settledRun.minorUnits, settledRun.currency)
      : null;

  // The payments themselves, matched by the id stamped on this month's own
  // sessions rather than by comparing dates. A run recorded on the 2nd for last
  // month's work belongs to last month, and a date comparison files it here.
  const paidHere = (() => {
    if (!sessions || !runs) return null;
    const ids = new Set(sessions.map((s) => s.settlementId).filter((x): x is string => x != null));
    return runs.filter((r) => ids.has(r.id));
  })();

  const awaiting = sessions ? sessions.filter((s) => isAwaitingOutcome(s)) : null;
  const marked = sessions ? sessions.filter((s) => s.outcome !== null) : null;
  const line = lines?.[0] ?? null;
  const notPaidByPolicy = line ? line.noShows + line.cancelled : 0;

  // `refresh` is the hook's, not a second reader. The local one it replaces
  // passed no `stale` callback at all, so a re-read fired from a button after a
  // month change could land last and paint the other month's sessions.

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={!!gymError} current="/coach/earnings">
      <h1>Earnings</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: 640 }}>
        Your {period.label}: what you delivered, what has been paid, and what is
        still outstanding. Only sessions with a recorded outcome reach a figure —
        a booked slot whose time has passed is not a delivered session, and this
        screen will not price one as though it were.
      </p>

      <Fetched at={readAt} busy={reading} onRefresh={refresh}
               what="this month" style={{ margin: '2px 0 14px' }} />

      {err ? <Banner tone="crit">{err}</Banner> : null}

      {me.role === 'owner' ? (
        <Banner>
          You are signed in as the owner, and this screen is scoped to{' '}
          <strong style={{ color: 'var(--ink)' }}>your own</strong> sessions — the ones booked
          against you as a coach, not the gym&rsquo;s. Everybody&rsquo;s pay is on{' '}
          <a href="/payroll">Payroll</a>.
        </Banner>
      ) : null}

      {gymError ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>Your gym could not be read</strong>, so this
          month does not know the standard session fee: {gymError}. Anything that needed the fee to
          price it is shown as unpriced rather than as worth nothing. This is not the same as your
          gym having no fee set — reload the page.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 0' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--ink2)' }}>
          Month
          <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} style={field}>
            {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
          {period.fromDate} → {period.toDate}
        </span>
      </div>

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 10px',
        }}
      >
        <Kpi
          label="Sessions delivered"
          text={sessions ? String(total.delivered) : null}
          note={sessions ? 'outcome recorded as completed' : undefined}
        />
        <Kpi
          label="Awaiting an outcome"
          text={sessions ? String(total.unmarked) : null}
          note={
            sessions === null ? undefined
              : total.unmarked > 0 ? 'these are what hold the rest up'
              : 'nothing unmarked'
          }
        />
        <Kpi
          label="Already settled"
          text={settledText}
          note={
            settledSessions === null
              ? undefined
              : settledUnpriced > 0
                ? `${settledUnpriced} of ${settledSessions.length} paid sessions carry no rate, so this month's paid total cannot be added up`
                : settledSessions.length === 0
                  ? 'no session this month carries a payment yet'
                  : totalNote(settledSessions)
                    ?? `${settledSessions.length} session${settledSessions.length === 1 ? '' : 's'} stamped with a payment`
          }
        />
        <Kpi
          label="Outstanding"
          text={outstandingText}
          // No note at all while the month is unknown: "nothing outstanding" over
          // a read that never returned is the worst sentence available here.
          note={
            sessions === null
              ? undefined
              : blocker
                ? blocker
                : settleBlocker(outstanding ?? [], total.unmarked)
                  ?? totalNote(outstanding ?? [])
                  ?? currencyNote(settlementAmount(outstanding ?? []), ccy)
                  ?? `${outstanding?.length ?? 0} session${(outstanding?.length ?? 0) === 1 ? '' : 's'} marked, priced, and not yet paid`
          }
        />
      </div>

      {blocker && total.unmarked > 0 ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>This month has no outstanding figure yet.</strong>{' '}
          {blocker} Those sessions are listed below. The figure is a dash rather than a number on
          purpose: adding up only the marked ones would give you a total smaller than what you are
          owed, and it would look exactly like a final one.
        </Banner>
      ) : blocker ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>No outstanding figure for this month.</strong>{' '}
          {blocker}
        </Banner>
      ) : null}

      {notPaidByPolicy > 0 ? (
        <Banner>
          {notPaidByPolicy} session{notPaidByPolicy === 1 ? '' : 's'} this month{' '}
          {notPaidByPolicy === 1 ? 'was' : 'were'} recorded as a no-show or a cancellation, and{' '}
          {notPaidByPolicy === 1 ? 'is' : 'are'} not counted as payable above.{' '}
          {gymError ? (
            <>Your gym&rsquo;s record could not be read, so its pay policy is unknown here and this
            takes the narrow view. If your gym does pay for those, your figure is higher than the
            one shown, not lower.</>
          ) : stated ? (
            <>Your gym pays for{' '}
            <strong style={{ color: 'var(--ink)' }}>{PAY_POLICY_LABEL[policyCode as PayPolicyCode].toLowerCase()}</strong>,
            and that is what the figures above apply.</>
          ) : (
            <>Your gym has not recorded what it pays for beyond delivered sessions, so this takes
            the narrow view. If it does pay for those, your figure is higher than the one shown, not
            lower — worth asking, because nothing here can tell you.</>
          )}
        </Banner>
      ) : null}

      {namesErr ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>Your clients&rsquo; names could not be read.</strong>{' '}
          Every figure on this page is unaffected — the names are a label on the rows, not part of
          the arithmetic — but the sessions below say &ldquo;name not read&rdquo; rather than who
          they were with. That is deliberately not the same dash as a session booked against
          nobody. {namesErr}
        </Banner>
      ) : null}

      <Blocking sessions={awaiting} unread={sessionsUnread} namesUnread={namesErr} ccy={ccy} zone={zone} />

      <LineItems sessions={marked} unread={sessionsUnread} namesUnread={namesErr} policy={policy} ccy={ccy} zone={zone} />

      <Paid runs={paidHere} unread={runsUnread} prefix={runsPrefix} sessionsUnread={sessionsUnread} period={period} zone={zone} />

      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '0 0 30px', maxWidth: 640 }}>
        Nothing on this screen records an outcome or a payment. A figure marked
        settled here is settled because a payment run stamped these exact
        sessions, and outstanding means no run has. If a month looks wrong,
        this is the page to bring to your gym.{' '}
        <button style={linkBtn} onClick={refresh}>Reload the month</button>
      </p>
    </Shell>
  );
}

/**
 * The Client column, and the three different facts it has to be able to tell
 * apart.
 *
 * All three used to render the same em dash, which made the most alarming of
 * them invisible:
 *
 *   · the session has no client on it at all. Ordinary — a coach's own
 *     training, or a slot blocked out — and the coach already knows it;
 *   · the session has a client, the names read came back, and this one is not
 *     in it. Also ordinary, and the reason is in the database rather than in
 *     the code: a coach reads `profiles` through policies scoped to their own
 *     roster, so somebody who has since left it is a client they may no longer
 *     name. The row is right, the figure is right, the name is genuinely not
 *     available;
 *   · the names read FAILED. Nothing here is known, and the coach can fix it by
 *     reloading. Shown as the same dash as the two above, it was a fault
 *     reported as an ordinary fact about the week.
 *
 * The figures are untouched in every case: a name is a label, and a screen a
 * coach checks a payslip against must not black out because a label is missing.
 */
function clientColumn(namesUnread: string | null): Column<PtSession> {
  return {
    key: 'client',
    header: 'Client',
    // Sorted on the same three cases, so the rows whose name could not be read
    // group together instead of scattering through the alphabet as blanks.
    value: (s) => s.clientName ?? (s.clientId == null ? '' : namesUnread ? '\uffff\uffff' : '\uffff'),
    render: (s) => {
      if (s.clientName) return s.clientName;
      if (s.clientId == null) return <span className="dash" title="This session was not booked against a client.">—</span>;
      if (namesUnread) {
        return (
          <span className="dash" title={namesUnread}>— name not read</span>
        );
      }
      return <span className="dash" title="This session is against a client this console cannot name — usually somebody no longer on your roster.">— not named</span>;
    },
  };
}

/* ── what is holding the rest up ───────────────────────────────────────────── */

function Blocking({ sessions, unread, namesUnread, ccy, zone }: {
  sessions: PtSession[] | null; unread: Unread; namesUnread: string | null; ccy: TenantCurrency;
  /** `tenants.timezone` — the hour a session ran is the gym's hour. */
  zone: string | null;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => gymDateTimeText(s.startsAt, zone, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) ?? <span className="dash">not stated</span> },
    clientColumn(namesUnread),
    { key: 'mins', header: 'Mins', value: (s) => s.durationMin, numeric: true },
    // Not "0.00" and not the gym's standard fee presented as earned: until
    // somebody says what happened, this session has no price, only a rate it
    // might turn out to be worth.
    { key: 'worth', header: 'If delivered', value: (s) => s.rateCents ?? -1, numeric: true,
      // The row's own currency where it has one, for the reason the Rate column
      // below gives: a snapshotted rate is denominated in what the gym charged
      // in then, not in what it charges in now.
      render: (s) => s.rateCents == null
        ? <span className="dash">not rated</span>
        : <span className="dash">
            {(s.rateCurrency ? money(s.rateCents, s.rateCurrency) : amount(s.rateCents, ccy)) ?? NO_CURRENCY_NOTE}
          </span> },
  ];
  return (
    <Section
      title="Holding up your month"
      sub="Booked, finished, and nobody has recorded what happened. None of these are priced, and the outstanding figure cannot be worked out around them."
    >
      {sessions === null ? (
        // "Nothing waiting" is an all-clear, and an all-clear is exactly what a
        // failed read has not earned. Here it would tell a coach their month is
        // complete when nobody managed to read it.
        <Unresolved
          state={unread ?? 'loading'}
          what="your sessions, so nobody can say whether anything is waiting to be marked"
        />
      ) : (
        <DataTable noun="sessions holding up your month"
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing waiting — every finished session this month has an outcome."
        />
      )}
    </Section>
  );
}

/* ── the evidence ──────────────────────────────────────────────────────────── */

const OUTCOME_LABEL: Record<string, string> = {
  completed: 'Delivered',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  late_cancelled: 'Late cancel',
};

/**
 * Every marked session this month, line by line.
 *
 * The totals above are a summary, and a coach who disagrees with a total needs
 * the rows it was made of: which session, what was recorded, at what rate, and
 * whether it has been paid. Without this the only way to answer "why is my
 * August short" is to trust the number, which is the position this screen
 * exists to get a coach out of.
 */
function LineItems({ sessions, unread, namesUnread, policy, ccy, zone }: {
  sessions: PtSession[] | null; unread: Unread; namesUnread: string | null;
  policy: PayPolicy; ccy: TenantCurrency;
  /** `tenants.timezone` — which day a session falls on decides which month it
   *  is paid in, and that is the gym's day. */
  zone: string | null;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => gymDateText(s.startsAt, zone, { day: 'numeric', month: 'short' }) ?? <span className="dash">not stated</span> },
    clientColumn(namesUnread),
    { key: 'outcome', header: 'Recorded', value: (s) => s.outcome ?? '',
      render: (s) => (
        <span style={{ color: isDelivered(s) ? 'var(--good)' : 'var(--ink2)' }}>
          {s.outcome ? OUTCOME_LABEL[s.outcome] ?? s.outcome : <span className="dash">—</span>}
        </span>
      ) },
    { key: 'counts', header: 'Payable', value: (s) => (isPayable(s, policy) ? 1 : 0), numeric: true,
      render: (s) => isPayable(s, policy)
        ? <span style={{ color: 'var(--ink2)' }}>yes</span>
        : <span className="dash">no</span> },
    { key: 'rate', header: 'Rate', value: (s) => s.rateCents ?? null, numeric: true,
      // Null is a session nobody priced, which is not a session worth nothing.
      // Shown as unrated so it reads as a question for the gym rather than as a
      // free hour.
      //
      // The row's OWN currency wins where it has one. This was `amount(s.rateCents,
      // ccy)` flat — the gym's code today, printed over a rate snapshotted in
      // whatever the gym charged in at the time. That is the substitution the
      // note on the settled total above calls the defect, made row by row: a gym
      // that changed `tenants.currency` had every line item in its history
      // relabelled by this column, with nothing marking a single one.
      render: (s) => s.rateCents == null
        ? <span className="dash">not rated</span>
        : ((s.rateCurrency ? money(s.rateCents, s.rateCurrency) : amount(s.rateCents, ccy))
            ?? <span className="dash">{NO_CURRENCY_NOTE}</span>) },
    { key: 'paid', header: 'Paid', value: (s) => (s.settlementId ? 1 : 0), numeric: true,
      render: (s) => s.settlementId
        ? <span style={{ color: 'var(--ink2)' }}>settled</span>
        : <span className="dash">outstanding</span> },
  ];
  return (
    <Section
      title="Line items"
      sub="Every session this month somebody recorded an outcome for — the rows the figures above are made of."
    >
      {sessions === null ? (
        <Unresolved state={unread ?? 'loading'} what="your sessions, so there are no line items to show" />
      ) : (
        <DataTable noun="line items"
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing this month has been marked yet."
        />
      )}
    </Section>
  );
}

/* ── what has actually reached you ─────────────────────────────────────────── */

function Paid({ runs, unread, prefix, sessionsUnread, period, zone }: {
  runs: Settlement[] | null; unread: Unread; prefix: boolean; sessionsUnread: Unread; period: Period;
  /** `tenants.timezone` — the day you were paid is the gym's day. */
  zone: string | null;
}) {
  const cols: Column<Settlement>[] = [
    { key: 'when', header: 'Paid', value: (r) => r.settledAt,
      render: (r) => gymDateText(r.settledAt, zone) ?? <span className="dash">not stated</span> },
    { key: 'period', header: 'Covering', value: (r) => r.periodFrom,
      render: (r) => `${r.periodFrom} → ${r.periodTo}` },
    { key: 'n', header: 'Sessions', value: (r) => r.sessionsCount, numeric: true },
    { key: 'method', header: 'How', value: (r) => r.method },
    { key: 'note', header: 'Note', value: (r) => r.note ?? '',
      render: (r) => r.note ?? <span className="dash">—</span> },
    { key: 'amount', header: 'Amount', value: (r) => r.amountCents, numeric: true,
      // Snapshotted when the money went out, never recomputed — a later change
      // to a rate must not rewrite what a coach was actually handed.
      render: (r) => money(r.amountCents, r.currency)
        ?? <span className="dash">{r.amountCents == null ? 'not recorded' : NO_CURRENCY_NOTE}</span> },
  ];
  return (
    <Section
      title={`Payments covering ${period.label}`}
      sub="Runs matched by the payment stamped on this month's own sessions, not by comparing dates. Each amount is what was handed over at the time."
    >
      {runs === null ? (
        // The two failures behind an empty list are different errands, and
        // neither of them is "you have not been paid" — a sentence whose obvious
        // next step is a coach asking their gym for money they may already have.
        <Unresolved
          state={(sessionsUnread ?? unread) ?? 'loading'}
          what={sessionsUnread
            ? 'your sessions, so no payment can be matched to the month it covered'
            : 'your payment history. An empty list here would not mean you have not been paid — reload first'}
        />
      ) : (
        <>
          <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
            A single run can cover sessions from more than one month, so an amount here need not
            match the &ldquo;already settled&rdquo; figure above, which counts only this
            month&rsquo;s sessions.
          </p>
          {/* The fourth state, said out loud. Without this the coach reads a
              prefix of their pay history as the whole of it, and the reading
              that follows — "I was never paid for that" — is the expensive one. */}
          {prefix ? (
            <p style={{
              margin: '0 14px 12px', padding: '10px 12px', fontSize: 12.5, color: 'var(--ink2)',
              border: '1px solid var(--ring)', borderLeft: '3px solid var(--warn)', background: 'var(--surface2)',
            }}>
              Your {SETTLEMENT_CAP} most recent payment runs were read, and there are older ones.
              This is not your whole payment history, so nothing here is totalled — an older run
              missing from this list has not been checked, only unread.
            </p>
          ) : null}
          <DataTable noun="payments"
            rows={runs} columns={cols} rowKey={(r) => r.id}
            empty="No payment has been recorded against this month's sessions yet."
          />
        </>
      )}
    </Section>
  );
}

/* ── shared bits (same shapes as the Door and Payroll screens) ─────────────── */

const field = {
  padding: '7px 10px', borderRadius: 0, fontSize: 13,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 12.5, fontFamily: 'var(--sans)',
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

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read used to fall through to the table's own empty line, so "we
 * could not ask" and "there were none" were the same sentence on screen. On a
 * page about somebody's pay, those two sentences are worth an argument.
 */

