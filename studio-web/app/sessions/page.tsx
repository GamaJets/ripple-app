'use client';

// Sessions — what happened in the one-to-ones delivered on the gym's floor.
//
// This screen exists because payroll now refuses to price a session nobody has
// marked. That refusal is only defensible if there is somewhere to do the
// marking, and this is it: the sessions that have finished with no outcome
// recorded, at the top, with the three buttons that resolve them.
//
// Before this, "delivered" was inferred as "booked, and the clock has passed" —
// which counted no-shows and slots nobody cancelled, and then paid for them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
// The reader's locale, the GYM's zone. A session's date decides which payroll
// month it falls in, and it was being drawn on whichever desk this was open at.
import { gymDateText, gymDateTimeText, calendarDateText } from '@lib/gymWhen';
import { parseGymZone } from '@lib/gymZone';
import { ConsoleGate, Loading } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { settledLanded } from '@lib/readLanded';
import { DataTable, type Column } from '@/components/DataTable';
import { amount, currencyNote, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import {
  fetchSessions, markOutcome, clearOutcome,
  isAwaitingOutcome, payrollByTrainer, payrollTotal, settlementBlocker,
  settleableSessions, settlementAmount, settleBlocker, recordSettlement, fetchSettlements,
  type Settlement,
  PAY_DELIVERED_ONLY, SETTLEMENT_METHODS, SETTLEMENT_METHOD_LABEL,
  type PtSession, type SessionOutcome, type PayPolicy, type SettlementMethod,
} from '@lib/gymSessions';
import { money } from '@lib/gymRecord';
// The gym's session fee is stored in WHOLE units and every `*_cents` column is
// minor units. The factor between them is not a hundred — sixteen currencies
// have no minor unit and five have a thousandth — so it is asked for, never
// assumed. `settleCurrencyBlocker` is the other half: a settlement is a
// permanent payment row, and it must not be stamped with a currency the
// sessions it covers were not priced in.
import { minorFromWhole } from '@lib/coachMoney';
import { settleCurrencyBlocker } from '@lib/gymRateCurrency';
import { payPolicyOf, PAY_POLICY_LABEL, NO_PAY_POLICY_NOTE, type PayPolicyCode } from '@lib/gymPolicy';
// What became of a past session, in one vocabulary shared with both phone apps.
import { pastSessions, pastVerdict, tallyPast, PAST_STATE_LABEL } from '@lib/sessionHistory';
import { Banner } from '@/components/Banner';

const DAY = 86400000;

const OUTCOME_LABEL: Record<SessionOutcome, string> = {
  completed: 'Delivered',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  late_cancelled: 'Late cancel',
};

export default function Sessions() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);
  // `tenants.currency`. Null means the gym has not said what money it charges
  // in, and every figure on this page is the gym's own session fee multiplied
  // out — none of them carries a currency of its own to fall back on.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PtSession[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // "The gym has not set a session fee" and "we could not read the gym" both
  // leave sessionFee null, and they are not the same problem: one is a setting
  // the owner can go and fill in, the other is a read to retry. Without this
  // string the page tells everybody to go and set a fee.
  const [gymError, setGymError] = useState<string | null>(null);

  /**
   * Whether a no-show is payable is a gym policy, and it is now READ rather
   * than held here.
   *
   * This was `useState<PayPolicy>(PAY_DELIVERED_ONLY)` behind two toggles, and
   * /staff and /close each had their own identical pair. Nothing saved any of
   * them. So an owner set the policy here, watched the payable count move,
   * walked to Close to settle the month — and Close had reset to the
   * conservative reading, because it was a different component's `useState`.
   * The figure they settled against was not the figure they had decided on, and
   * nothing on either screen could have told them. A fourth screen,
   * /coach/earnings, hardcoded the same constant and told every coach outright
   * that it could not read the gym's real policy.
   *
   * One nullable column on `tenants` and one control on /settings closes all
   * four. The toggles are gone from here rather than left as a preview: a
   * control that changes a figure and saves nothing is how the four screens
   * came to disagree.
   */
  const [policyCode, setPolicyCode] = useState<string | null>(null);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [settlementsError, setSettlementsError] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  /**
   * How the money is actually moving, for the settlement about to be recorded.
   *
   * Neither this screen nor /payroll used to pass one, and `recordSettlement`
   * defaulted to 'transfer' into a column that also defaults to 'transfer' — so
   * every settlement the console has written says bank transfer, including the
   * cash handed over at the desk, and /accounting shows that under a column
   * headed Method as the gym's own answer. The person pressing the button is
   * the only one who knows, so they are asked.
   */
  const [method, setMethod] = useState<SettlementMethod>('transfer');

  /**
   * The two reads this screen stands on: what happened on the floor, and what
   * has already been handed over.
   *
   * Settled one at a time rather than under a single try/catch, and with no
   * `.catch(() => [])` anywhere near either of them, because one read failing
   * must never be reported as the other coming back empty. This is the rule the
   * import screen states, and payroll is where breaking it costs money: the
   * swallowed settlements failure put `[]` under "Already paid", which reads as
   * "no trainer has ever been paid for anything", and the reasonable response
   * to that is to pay them all again.
   */
  const load = useCallback(async (tenantId: string): Promise<boolean> => {
    const [rows, runs] = await Promise.allSettled([
      fetchSessions(supabase, tenantId, new Date(Date.now() - 30 * DAY).toISOString()),
      fetchSettlements(supabase, tenantId),
    ]);

    if (rows.status === 'fulfilled') {
      setSessions(rows.value);
      setErr(null);
    } else {
      // Null, not []. Every table below is about to be asked what happened in
      // this gym over the last month, and the honest answer is that we do not
      // know — which is not the same answer as "nothing did".
      setSessions(null);
      setErr((rows.reason as any)?.message ?? 'Could not read the session record.');
    }

    if (runs.status === 'fulfilled') {
      setSettlements(runs.value);
      setSettlementsError(null);
    } else {
      setSettlements(null);
      setSettlementsError((runs.reason as any)?.message ?? 'Could not read what has already been paid.');
    }

    // Whole means both came back. `useFetched` stamps only on a whole read, so
    // a refresh that lost the settlements — the read that says what has ALREADY
    // been paid — leaves the stamp where it was rather than dating a screen
    // that is about to offer to pay those sessions again.
    return settledLanded([rows, runs]);
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
      if (!who?.tenantId) { setSessions([]); return; }
      // supabase-js resolves on a database error rather than rejecting, so the
      // error has to be read off the result. Destructuring only `data` left a
      // refused or RLS-blocked read looking exactly like a gym with no fee set:
      // sessionFee null, every payroll figure a dash, and a blocker telling the
      // owner "set a session fee" — sending him to check a setting that is
      // probably already correct, for a read he was never told had failed.
      const { data: t, error } = await supabase
        .from('tenants').select('name, session_fee, currency, session_pay_policy, timezone').eq('id', who.tenantId).single();
      if (live) {
        setGymName(error ? null : (t?.name ?? null));
        setSessionFee(error ? null : (t?.session_fee ?? null));
        setPolicyCode(error ? null : (((t as any)?.session_pay_policy ?? null) as string | null));
        setCcy(error ? null : ((((t as any)?.currency ?? '') as string).trim().toUpperCase() || null));
        setGymError(error ? (error.message || 'Could not read your gym.') : null);
        const z = error ? { kind: 'clear' as const } : parseGymZone((t as any)?.timezone);
        setZone(z.kind === 'zone' ? z.zone : null);
      }
    })();
    return () => { live = false; };
    // Identity and the gym record only. The sessions are read by the effect
    // below, through `refresh`, so the first read stamps exactly like every
    // later one.
  }, []);

  /**
   * Kept current, and it says when it was last read.
   *
   * "One-to-ones delivered on your floor in the last 30 days" is a window cut
   * at the moment of the read, and this screen never said which moment. A
   * console open since Monday still offered to settle a list ending on Monday,
   * and the sessions marked at the desk since were simply not on it.
   */
  const { at: readAt, busy: reading, refresh } = useFetched(
    () => (me?.tenantId ? load(me.tenantId) : Promise.resolve(false)),
  );

  // The first read. Keyed on the tenant id rather than fired at the end of the
  // effect above: `useFetched` holds the reader in a ref assigned during
  // RENDER, so calling `refresh()` in the same tick as `setMe(who)` would run
  // the closure from the previous render, where `me` is still undefined.
  useEffect(() => {
    if (me?.tenantId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.tenantId]);

  /**
   * The gym's stated policy, and what to do when it has not stated one.
   *
   * `payPolicyOf` answers null for a null column and for any value this build
   * does not recognise, and the FALLBACK is deliberately the conservative
   * reading rather than a refusal. Withholding payroll outright from every gym
   * that has not visited /settings would take a working screen away over a
   * setting that has never existed; paying only for delivered sessions cannot
   * overpay anybody, and it is the least the gym certainly owes.
   *
   * What is NOT allowed is for that fallback to look like an answer. `stated`
   * is what the screen prints, and where it is null the figures are labelled as
   * the floor rather than as the number.
   */
  const stated = payPolicyOf(policyCode);
  const policy: PayPolicy = stated ?? PAY_DELIVERED_ONLY;

  // Each of these stays null while `sessions` is null, rather than collapsing to
  // an empty list. `sessions ?? []` was doing the same damage as the swallowed
  // catch one level up: it handed every table below a confident, empty answer
  // built out of a read that never returned.
  const awaiting = useMemo(() => sessions && sessions.filter((s) => isAwaitingOutcome(s)), [sessions]);
  const settled = useMemo(() => sessions && sessions.filter((s) => s.outcome !== null), [sessions]);

  // The gym's session fee is in whole units; payroll works in minor units.
  //
  // It was `Math.round(sessionFee * 100)`, on all three lines of this screen
  // that needed it. /close carries the same comment over the same repair: a
  // ¥6,000 fee became 600,000 minor units and every unmarked session on it was
  // priced a hundredfold, in the figure a coach is actually paid from.
  // `minorFromWhole` asks the currency how many places its money has and
  // returns null when nothing named one — which prices nothing rather than
  // pricing it at zero.
  const feeCents = useMemo(() => minorFromWhole(sessionFee, ccy), [sessionFee, ccy]);

  const lines = useMemo(
    () => sessions && payrollByTrainer(sessions, policy, feeCents),
    [sessions, policy, feeCents],
  );
  // Totalling nothing gives zeros, which is fine here only because every place
  // that renders one of them checks `sessions` first and shows a dash instead.
  const total = useMemo(() => payrollTotal(lines ?? []), [lines]);

  // What each trainer is actually owed RIGHT NOW: marked, priced, payable and
  // not already settled. Derived from the sessions rather than from the payroll
  // line, because the line counts everything in the window while a settlement
  // must only ever cover what has not been paid.
  //
  // Null when the sessions could not be read: an empty "Outstanding" list says
  // every trainer is square, which is the single most expensive wrong sentence
  // on this page.
  const owed = useMemo(() => {
    if (sessions === null) return null;
    const byTrainer = new Map<string, { name: string | null; rows: PtSession[]; unmarked: number }>();
    for (const s of sessions) {
      const e = byTrainer.get(s.trainerId)
        ?? { name: s.trainerName, rows: [] as PtSession[], unmarked: 0 };
      if (isAwaitingOutcome(s)) e.unmarked += 1;
      byTrainer.set(s.trainerId, e);
    }
    // The same fee `lines` was priced with, or this panel offers to settle a
    // smaller number than the payroll table above it is showing.
    for (const s of settleableSessions(sessions, policy, undefined, feeCents)) {
      const e = byTrainer.get(s.trainerId);
      if (e) e.rows.push(s);
    }
    return [...byTrainer.entries()]
      .map(([trainerId, e]) => ({
        trainerId, name: e.name, rows: e.rows, unmarked: e.unmarked,
        cents: settlementAmount(e.rows, feeCents),
        blocker: settleBlocker(e.rows, e.unmarked)
          ?? (e.rows.length && !ccy
            ? 'This gym has not set its currency, so a settlement cannot say what money it is in.'
            : null)
          // What the sessions say they were priced in, against what this
          // settlement is about to be stamped with. `sessions.rate_currency`
          // (supabase/parts/1010) is what makes the comparison possible at all
          // — before it, a gym that changed its currency relabelled its whole
          // PT history and the settlement row took the new code silently.
          ?? settleCurrencyBlocker(e.rows, ccy),
      }))
      .filter((x) => x.rows.length > 0 || x.unmarked > 0);
  }, [sessions, policy, feeCents, ccy]);

  /* ── the record, one month at a time ──────────────────────────────────────
   *
   * Everything above this reads a fixed thirty days and there was no way to ask
   * for the thirty before them. An owner settling October could not look at
   * September; a dispute about a session in July had no screen anywhere in this
   * console that could show it.
   *
   * It is a SEPARATE read from the payroll one, deliberately, and the payroll
   * window is untouched. Widening the read that feeds "Payroll, 30 days",
   * "Delivered", "Payable" and the Outstanding panel would move four money
   * figures and leave three of the labels around them saying thirty days. A
   * history that costs one extra read is a much smaller price than a settlement
   * priced over a period nobody chose.
   *
   * A calendar month, not a rolling window, because a month is the period an
   * owner reconciles in and the one `payroll_settlements` records against. The
   * bounds are built with the local Date constructor: a month means the run of
   * days the gym was actually open, not a UTC slice of them.
   */
  const [histOffset, setHistOffset] = useState(0);
  const [hist, setHist] = useState<PtSession[] | null>(null);
  // Its own error, so a month that could not be read cannot empty the payroll
  // half of this page — and so that the sentence can name the month.
  const [histErr, setHistErr] = useState<string | null>(null);
  // Bumped when an outcome is recorded or undone, so the record and the queue
  // cannot end the tap disagreeing about the same session.
  const [histNonce, setHistNonce] = useState(0);

  const histWindow = useMemo(() => {
    const n = new Date();
    const from = new Date(n.getFullYear(), n.getMonth() + histOffset, 1, 0, 0, 0, 0);
    const to = new Date(n.getFullYear(), n.getMonth() + histOffset + 1, 1, 0, 0, 0, 0);
    return { from, to };
  }, [histOffset]);

  const histTenant = me?.tenantId ?? null;
  const histOwner = me?.role === 'owner';
  useEffect(() => {
    if (!histTenant || !histOwner) return;
    let live = true;
    setHist(null); setHistErr(null);
    // `fetchSessions` bounds with `.lte`, which is inclusive, so the upper end
    // is a millisecond before the next month begins. Passing the next month's
    // first instant would count a 00:00 session in two months at once.
    fetchSessions(
      supabase, histTenant,
      histWindow.from.toISOString(),
      new Date(histWindow.to.getTime() - 1).toISOString(),
    )
      .then((rows) => { if (live) { setHist(rows); setHistErr(null); } })
      .catch((e: any) => {
        if (!live) return;
        // Null, never []. An empty month is a claim about the gym's floor, and
        // a read that failed has established nothing about the gym's floor.
        setHist(null);
        setHistErr(e?.message ?? 'That month could not be read.');
      });
    return () => { live = false; };
  }, [histTenant, histOwner, histWindow, histNonce]);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/sessions">
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
      <Shell me={me} gymName={gymName} current="/sessions">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>Session records and payroll are owner-only.</p>
      </Shell>
    );
  }

  // An account with no gym on it gets a sentence, not a payroll board.
  //
  // The load sets `sessions` to [] in this case, so every table below rendered
  // its confident empty copy — "Nothing outstanding. Every marked session in
  // this window has been settled." — to an owner whose profile simply carries no
  // tenant_id. That is a claim about their trainers' pay, made from a query
  // that was never run. The Overview has said this properly all along; this
  // page had the same state and none of the sentence.
  if (!me.tenantId) {
    return (
      <Shell me={me} gymName={gymName} current="/sessions">
        <h1>Sessions</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          Your account is not linked to a gym, so there are no one-to-ones to
          read and nothing to settle. This is not a gym with no sessions in it —
          it is an account with no gym on it. The owner sets that.
        </p>
      </Shell>
    );
  }

  const tenantId = me.tenantId;
  // `refresh` is the hook's, not a second reader. It was a local
  // `() => load(tenantId)` handed to marking, undoing and settling, so the one
  // moment this screen was provably current was the one moment the line under
  // it went on ageing.

  const mark = async (s: PtSession, outcome: SessionOutcome) => {
    try {
      // Snapshot the rate at the moment of marking, so changing the gym's fee
      // next month cannot rewrite what this session cost.
      //
      // The `undefined` matters. markOutcome leaves rate_cents alone when it
      // gets undefined and writes null when it gets null — so when the gym read
      // failed, sessionFee is null for a reason that has nothing to do with the
      // gym's actual fee, and passing that null through would permanently stamp
      // "no rate" onto a session that has one. A read we could not make is not
      // a price of nothing; the only safe move is to leave the column untouched
      // and let a later marking, made with the fee in hand, set it.
      // The rate and the money it is in, written together or not at all —
      // `sessions.rate_cents` carried a figure and no unit for five parts, and
      // every reader supplied one from the gym's currency today.
      await markOutcome(supabase, s.id, outcome,
        s.rateCents != null
          ? { cents: s.rateCents, currency: s.rateCurrency }
          : gymError ? undefined : { cents: feeCents, currency: ccy });
      refresh();
      // The record below is the same rows seen a second way. Leaving it stale
      // would have the two halves of this page disagree about a session the
      // owner has just resolved, in front of them.
      setHistNonce((n) => n + 1);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not record that outcome.');
    }
  };

  // clearOutcome throws on a PostgREST error, so `.then(refresh)` alone left a
  // refused undo as an unhandled rejection: the row stayed marked, the button
  // said nothing, and the owner pressed it again.
  const undo = async (id: string) => {
    try {
      await clearOutcome(supabase, id);
      refresh();
      setHistNonce((n) => n + 1);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not undo that outcome.');
    }
  };

  // Why the figure above cannot be settled, in words the owner can act on.
  //
  // Two things settlementBlocker cannot know, because it sees only the sessions.
  // With `sessions` null it would answer "No payable sessions in this period."
  // about a period nobody has managed to read. And when payable sessions have no
  // rate it says "set a session fee", which is the wrong errand if the fee is
  // missing because the gym row could not be read rather than because nobody set
  // one — so name the read failure instead, and leave the sessions unpriced
  // rather than free.
  const unread = sessions === null && err !== null;
  const blocker =
    sessions === null
      ? null
      : gymError && total.priced < total.payable
        ? `Your gym could not be read, so there is no session fee to price the rest with: ${gymError}`
        : settlementBlocker(total);

  const settle = async (t: NonNullable<typeof owed>[number]) => {
    if (!me?.tenantId || t.blocker || !ccy) return;
    const dates = t.rows.map((s) => s.startsAt.slice(0, 10)).sort();
    setSettling(t.trainerId);
    try {
      await recordSettlement(supabase, me.tenantId, {
        trainerId: t.trainerId,
        periodFrom: dates[0],
        periodTo: dates[dates.length - 1],
        amountCents: t.cents,
        sessionIds: t.rows.map((s) => s.id),
        // Said, never defaulted — see the note on `method` above.
        method,
        // Stated, never defaulted. gymSessions USED TO write `currency ?? 'AED'`
        // into payroll_settlements, stamping the wrong money onto a permanent
        // payment record that /accounting and /close later read back as fact.
        // `recordSettlement`'s `currency` is now a required `string` and
        // supabase/parts/150 dropped the column's `'AED'` default, so omitting
        // it no longer compiles and would be rejected by the database if it did.
        // It is passed explicitly here because that is what makes the guard
        // above — which refuses to settle at a gym with no currency — the thing
        // the reader checks, rather than a defaulted value nobody sees.
        currency: ccy,
      });
      refresh();
    } catch (e: any) {
      // The worst duplicate in the product: a settlement written twice pays a
      // trainer twice, out of a table /accounting and /close both read back as
      // fact. Neither "it was refused" nor "it worked" may be assumed from a
      // request nobody answered.
      setErr(writeFailedText(e, {
        what: 'That settlement',
        unchanged: 'nothing has been paid and those sessions are still owed',
        howToCheck: 'Reload this page and read whether those sessions still show as payable before settling them again.',
      }));
    } finally { setSettling(null); }
  };

  return (
    <Shell me={me} gymName={gymName} current="/sessions">
      <h1>Sessions</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        One-to-ones delivered on your floor in the last 30 days, and what they are worth.
      </p>

      <Fetched at={readAt} busy={reading} onRefresh={refresh}
               what="this month’s sessions" style={{ margin: '2px 0 14px' }} />

      {err ? <Banner tone="crit">{err}</Banner> : null}

      {gymError ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>Your gym could not be read</strong>, so this page
          does not know your session fee: {gymError}. Anything that needed the fee to price it is
          shown as unpriced rather than as nothing owed. This is not the same as your gym having no
          fee set, and setting one now would not fix it — reload the page.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 10px',
        }}
      >
        <Kpi label="Delivered" text={sessions ? String(total.delivered) : null} />
        <Kpi
          label="Awaiting an outcome"
          text={sessions ? String(total.unmarked) : null}
          note={total.unmarked > 0 ? 'blocking payroll' : undefined}
        />
        <Kpi label="Payable" text={sessions ? String(total.payable) : null}
             note={stated === null ? 'delivered only — no policy set'
               : policy.payNoShows ? 'no-shows included' : 'delivered only'} />
        <Kpi
          label="Payroll, 30 days"
          text={amount(total.cents, ccy)}
          // No note at all when the sessions are unknown: "ready to settle" on a
          // period nobody could read is the worst of the available sentences.
          // A missing currency is its own reason and names the setting, rather
          // than being reported as something wrong with the sessions.
          note={sessions === null
            ? undefined
            : (blocker ?? currencyNote(total.cents, ccy) ?? 'ready to settle')}
        />
      </div>

      {blocker ? (
        <Banner>
          <strong style={{ color: 'var(--ink)' }}>Not ready to settle.</strong> {blocker}{' '}
          {total.unmarked > 0
            ? 'Until then this figure prices only the sessions somebody has confirmed.'
            : null}
        </Banner>
      ) : null}

      {/* Stated, not set, and that is the repair.
          This was two toggles over an unsaved `useState`, and /staff and /close
          each had their own identical pair. An owner set the policy here,
          watched the payable count move, and settled the month on Close against
          a screen that had reset to the conservative reading — three components,
          three opinions, one ledger. The single stored answer lives on /settings
          and every screen that prices a session reads it. */}
      <Section
        title="Pay policy"
        sub="A gym decision, stored once. It changes the payable count and the figure above, on every screen that prices a session."
      >
        <div style={{ padding: 14, fontSize: 13, color: 'var(--ink2)', maxWidth: '70ch' }}>
          {gymError ? (
            <>
              The gym&rsquo;s record could not be read, so its pay policy is unknown here rather
              than unset. The figures above price delivered sessions only, which is the least this
              gym owes — not necessarily what it has decided to pay.
            </>
          ) : stated ? (
            <>
              <strong style={{ color: 'var(--ink)' }}>{PAY_POLICY_LABEL[policyCode as PayPolicyCode]}.</strong>{' '}
              Change it on <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a> and every
              screen that prices a session moves with it.
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--ink)' }}>Not set</strong> — {NO_PAY_POLICY_NOTE}. The
              figures above therefore count delivered sessions only. That is the floor rather than
              an answer: a coach who held an hour for somebody who did not turn up is not in it.
              Say what this gym pays for on{' '}
              <a href="/settings" style={{ color: 'var(--brand)' }}>Gym</a>.
            </>
          )}
        </div>
      </Section>

      <Awaiting sessions={awaiting} unread={unread} zone={zone} onMark={mark} />
      <Payroll lines={lines} unread={unread} ccy={ccy} />
      <Settle owed={owed} unread={unread} settling={settling} onSettle={settle}
              method={method} onMethod={setMethod} ccy={ccy} />
      <Settled runs={settlements} error={settlementsError} zone={zone} />
      <Marked sessions={settled} unread={unread} onClear={undo} ccy={ccy} zone={zone} />
      <History
        rows={hist} error={histErr} from={histWindow.from} offset={histOffset} zone={zone}
        onOffset={setHistOffset}
      />
    </Shell>
  );
}

/* ── the queue that unblocks payroll ───────────────────────────────────────── */

function Awaiting({ sessions, unread, zone, onMark }: {
  sessions: PtSession[] | null; unread: boolean;
  onMark: (s: PtSession, o: SessionOutcome) => void;
  /** `tenants.timezone` — a session happened at the gym's hour, not the reader's. */
  zone: string | null;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => gymDateTimeText(s.startsAt, zone, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) ?? <span className="dash">not stated</span> },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '',
      render: (s) => s.trainerName ?? <span className="dash">—</span> },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'mins', header: 'Mins', value: (s) => s.durationMin, numeric: true },
    { key: 'mark', header: 'What happened?', value: () => 0, align: 'right',
      render: (s) => (
        // Four outcomes, because `SessionOutcome` has four and this screen
        // offered three. `late_cancelled` is in OUTCOME_LABEL at the top of
        // this file, it is what the gym's own pay policy toggle is ABOUT — the
        // policy on /settings reads "Delivered sessions and late cancellations"
        // — and app/coach/page.tsx has offered all four to the coach for
        // months. So the owner had a policy control for an outcome the only
        // owner-facing screen that records outcomes could not produce: a gym
        // that pays for late cancellations had no way to record one, and every
        // late cancellation went in as an ordinary cancellation and was paid
        // nothing.
        <span style={{ display: 'inline-flex', gap: 10, whiteSpace: 'nowrap' }}>
          <button style={linkBtn} onClick={() => onMark(s, 'completed')}>Delivered</button>
          <button style={linkBtn} onClick={() => onMark(s, 'no_show')}>No-show</button>
          <button style={linkBtn} onClick={() => onMark(s, 'late_cancelled')}>Late cancel</button>
          <button style={{ ...linkBtn, color: 'var(--ink3)' }} onClick={() => onMark(s, 'cancelled')}>Cancelled</button>
        </span>
      ) },
  ];
  return (
    <Section
      title="Awaiting an outcome"
      sub="Booked, finished, and nobody has said what happened. Payroll will not price these. A late cancellation is its own outcome, not a cancellation — whether the gym pays for one is the policy set on Gym, and it cannot apply to a session nobody could mark that way."
    >
      {sessions === null ? (
        // "Nothing waiting" is an all-clear, and this is the one table on the
        // console whose job is to withhold an all-clear until somebody has
        // actually marked every session.
        unread
          ? <Unread what="the session record could not be read, so nobody can say whether anything is waiting to be marked." />
          : <Loading />
      ) : (
        <DataTable noun="sessions awaiting an outcome"
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing waiting — every finished session has an outcome."
        />
      )}
    </Section>
  );
}

/* ── per-trainer payroll ───────────────────────────────────────────────────── */

function Payroll({ lines, unread, ccy }: {
  lines: ReturnType<typeof payrollByTrainer> | null; unread: boolean; ccy: TenantCurrency;
}) {
  const cols: Column<NonNullable<typeof lines>[number]>[] = [
    { key: 'name', header: 'Trainer', value: (l) => l.trainerName ?? '',
      render: (l) => l.trainerName ?? <span className="dash">—</span> },
    { key: 'delivered', header: 'Delivered', value: (l) => l.delivered, numeric: true },
    { key: 'noshow', header: 'No-shows', value: (l) => l.noShows, numeric: true },
    { key: 'cancelled', header: 'Cancelled', value: (l) => l.cancelled, numeric: true },
    { key: 'unmarked', header: 'Unmarked', value: (l) => l.unmarked, numeric: true,
      render: (l) => l.unmarked === 0
        ? <span className="dash">—</span>
        : <span style={{ color: 'var(--warn)' }}>{l.unmarked}</span> },
    { key: 'pay', header: 'Pay', value: (l) => l.cents ?? -1, numeric: true,
      // Null is unpriced work, not free work.
      render: (l) => l.cents == null
        ? <span className="dash">not priced</span>
        : (amount(l.cents, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>) },
  ];
  return (
    <Section title="Payroll by trainer" sub="Priced from confirmed sessions at the rate snapshotted when each was marked.">
      {lines === null ? (
        // "No sessions in this period" is a claim about the gym's month. A read
        // that never returned has established nothing about the gym's month.
        unread
          ? <Unread what="the session record could not be read, so there is nothing here to price." />
          : <Loading />
      ) : (
        <DataTable noun="payroll lines" rows={lines} columns={cols} rowKey={(l) => l.trainerId} empty="No sessions in this period." />
      )}
    </Section>
  );
}

/* ── settling: handing the money over, exactly once ────────────────────────── */

function Settle({ owed, unread, settling, onSettle, method, onMethod, ccy }: {
  owed: { trainerId: string; name: string | null; rows: PtSession[]; unmarked: number; cents: number; blocker: string | null }[] | null;
  unread: boolean;
  settling: string | null;
  onSettle: (t: any) => void;
  method: SettlementMethod;
  onMethod: (m: SettlementMethod) => void;
  ccy: TenantCurrency;
}) {
  /**
   * The coach whose month is about to be settled, waiting for somebody to say
   * the amount out loud.
   *
   * "Mark as paid" wrote a permanent `payroll_settlements` row on a single
   * click, stamping those session ids so they can never join another run — and
   * nothing between the click and the write named the trainer, the amount or
   * the method, and there is no reversal anywhere on this page. /payroll has
   * one (`reverseSettlement`, `reversalReasonBlocker`); this screen does not,
   * and it is the one a busy owner clicks down a list on.
   *
   * So the irreversible button now states what it is about to do, by name and
   * by figure, before it does it. That is the least a screen with no undo owes
   * the person using it.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <Section
      title="Outstanding"
      sub="What each trainer is owed for work not yet paid for. Settling stamps those exact sessions, so nothing here can be paid a second time."
    >
      {owed === null ? (
        // "Nothing outstanding" is the most expensive wrong sentence on this
        // page: it tells the owner every trainer is square, and he closes the
        // tab. It has to be earned by a read that actually came back.
        unread
          ? <Unread what="the session record could not be read, so what each trainer is owed is not known. Nothing here is settled or unsettled until it can be." />
          : <Loading />
      ) : owed.length === 0 ? (
        <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--ink3)' }}>
          Nothing outstanding. Every marked session in this window has been settled.
        </p>
      ) : (
        <>
          {/* Beside the buttons it describes. Whoever hands the money over is
              the only person who knows how it went, and the answer is read back
              months later by somebody reconciling a bank statement. */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            padding: '10px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5, color: 'var(--ink2)',
          }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              Paid by
              <select
                value={method}
                onChange={(e) => onMethod(e.target.value as SettlementMethod)}
                style={{
                  padding: '6px 9px', borderRadius: 0, fontSize: 12.5,
                  background: 'var(--surface2)', color: 'var(--ink)',
                  border: '1px solid var(--ring)', fontFamily: 'var(--sans)',
                }}
              >
                {SETTLEMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{SETTLEMENT_METHOD_LABEL[m]}</option>
                ))}
              </select>
            </label>
            <span style={{ color: 'var(--ink3)' }}>
              recorded against whichever trainer you settle next.
            </span>
          </div>
          {owed.map((t) => (
        <div key={t.trainerId} style={{
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
          padding: '12px 14px', borderTop: '1px solid var(--ring)',
        }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            {/* A dash, not "Trainer". /classes states the rule this row used to
                break: a made-up label on a row with a Pay button beside it gets
                read as a person, and the money goes out against a name nobody
                recorded. */}
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>
              {t.name ?? <span className="dash">name not readable</span>}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 2 }}>
              {t.blocker
                ? t.blocker
                : `${t.rows.length} session${t.rows.length === 1 ? '' : 's'} unpaid`}
            </div>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, minWidth: 100, textAlign: 'right' }}>
            {t.blocker
              ? <span className="dash">—</span>
              : (amount(t.cents, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>)}
          </div>
          {confirming === t.trainerId ? (
            <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink2)', maxWidth: '46ch' }}>
                Record {amount(t.cents, ccy) ?? 'an amount that cannot be stated'} paid to{' '}
                <strong style={{ color: 'var(--ink)' }}>{t.name ?? 'this coach'}</strong> by {method},
                against {t.rows.length} session{t.rows.length === 1 ? '' : 's'}? Those sessions are
                stamped for good and nothing on this screen can undo it.
              </span>
              <button
                disabled={settling === t.trainerId}
                onClick={() => { setConfirming(null); onSettle(t); }}
                style={{
                  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none',
                  borderRadius: 0, padding: '8px 14px', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {settling === t.trainerId ? 'Recording…' : 'Record it'}
              </button>
              <button
                onClick={() => setConfirming(null)}
                style={{
                  background: 'transparent', color: 'var(--ink3)', border: '1px solid var(--ring)',
                  borderRadius: 0, padding: '8px 12px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                Not yet
              </button>
            </div>
          ) : (
            <button
              disabled={!!t.blocker || settling === t.trainerId}
              onClick={() => setConfirming(t.trainerId)}
              style={{
                background: t.blocker ? 'var(--surface2)' : 'var(--brand)',
                color: t.blocker ? 'var(--ink3)' : 'var(--brand-ink)',
                border: 'none', borderRadius: 0, padding: '8px 14px', fontSize: 13,
                fontWeight: 600, cursor: t.blocker ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {settling === t.trainerId ? 'Recording…' : 'Mark as paid'}
            </button>
          )}
        </div>
          ))}
        </>
      )}
    </Section>
  );
}

/* ── what has already been paid ────────────────────────────────────────────── */

function Settled({ runs, error, zone }: { runs: Settlement[] | null; error: string | null; zone: string | null }) {
  // Not read yet: nothing to show and nothing to say, as before.
  //
  // Read and refused: say so here rather than anywhere else, because this is the
  // only section on the page whose subject is the settlements read. Silence
  // would be as bad as the old empty table — the owner would scroll past a
  // missing section and take it for a gym that has never run payroll.
  if (runs === null && error === null) return null;
  const cols: Column<Settlement>[] = [
    { key: 'when', header: 'Paid', value: (r) => r.settledAt,
      render: (r) => gymDateText(r.settledAt, zone) ?? <span className="dash">not stated</span> },
    { key: 'period', header: 'Covering', value: (r) => r.periodFrom,
      render: (r) => `${r.periodFrom} → ${r.periodTo}` },
    { key: 'n', header: 'Sessions', value: (r) => r.sessionsCount, numeric: true },
    // How the money went. Worth a column now that it is something the person
    // settling actually said rather than the same word on every row.
    { key: 'method', header: 'How', value: (r) => r.method,
      render: (r) => SETTLEMENT_METHOD_LABEL[r.method] ?? r.method },
    { key: 'amount', header: 'Amount', value: (r) => r.amountCents, numeric: true,
      // Snapshotted at the time, never recomputed — a later fee change must not
      // rewrite what was actually handed over. The row snapshots its CURRENCY
      // too, and dropping it printed every past run in whatever money the helper
      // defaults to rather than the money that actually left the account.
      // `fetchSettlements` used to coerce a null currency to 'AED' on the way
      // out, so a run that states no money printed as dirhams. It now passes
      // the null through and money() withholds — which must not be allowed to
      // fall out as an EMPTY cell, because a blank beside an amount reads as
      // "nothing was paid" rather than "we cannot say in what".
      render: (r) => money(r.amountCents, r.currency)
        ?? <span className="dash">— this run records no currency</span> },
  ];
  return (
    <Section title="Already paid" sub="Amounts as they were when the money went out, not as today's rates would price them.">
      {runs === null ? (
        // The old code caught this failure and passed [], so the table said "No
        // payroll has been settled yet." — an affirmative claim that no trainer
        // has ever been paid, whose obvious remedy is to pay them all again.
        <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--ink3)' }}>
          Not shown: the record of what has already been paid could not be read — {error}. Treat
          nothing below as settled or unsettled, and do not pay anybody a second time on the
          strength of this page. Reload first.
        </p>
      ) : (
        <DataTable noun="settled runs" rows={runs} columns={cols} rowKey={(r) => r.id} empty="No payroll has been settled yet." />
      )}
    </Section>
  );
}

/* ── the marked history, so a mistake can be undone ────────────────────────── */

function Marked({ sessions, unread, onClear, ccy, zone }: {
  sessions: PtSession[] | null; unread: boolean; onClear: (id: string) => void;
  ccy: TenantCurrency;
  /** `tenants.timezone` — a session happened at the gym's hour, not the reader's. */
  zone: string | null;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => gymDateText(s.startsAt, zone, { day: 'numeric', month: 'short' }) ?? <span className="dash">not stated</span> },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '' },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'outcome', header: 'Outcome', value: (s) => s.outcome ?? '',
      render: (s) => s.outcome ? OUTCOME_LABEL[s.outcome] : <span className="dash">—</span> },
    { key: 'rate', header: 'Rate', value: (s) => s.rateCents ?? -1, numeric: true,
      render: (s) => s.rateCents == null
        ? <span className="dash">—</span>
        : (amount(s.rateCents, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>) },
    { key: 'undo', header: '', value: () => 0, align: 'right',
      render: (s) => <button style={linkBtn} onClick={() => onClear(s.id)}>Undo</button> },
  ];
  return (
    <Section title="Marked" sub="Undo returns a session to awaiting an outcome — it does not mark it cancelled.">
      {sessions === null ? (
        // "Nothing marked yet" would read as a month of work nobody has touched,
        // which is what the queue above is for — and the owner would go and mark
        // sessions that are already marked.
        unread
          ? <Unread what="the session record could not be read, so nothing can be listed here to undo." />
          : <Loading />
      ) : (
        <DataTable noun="marked sessions" rows={sessions} columns={cols} rowKey={(s) => s.id} empty="Nothing marked yet." />
      )}
    </Section>
  );
}

/* ── the record, one month at a time ───────────────────────────────────────── */

/**
 * Every one-to-one that has already happened in a chosen calendar month, with
 * what became of each.
 *
 * Not a second copy of "Marked" above it. That table is the last thirty days
 * and lists only rows that HAVE an outcome, because its purpose is the undo
 * button. This is the record: it covers any month the owner picks, it keeps the
 * unmarked ones — the state that blocks a settlement, and the one an owner most
 * needs to see when reconciling an old month — and it keeps cancellations,
 * which are the evidence that an hour was booked at all. supabase/parts/195
 * makes that argument about classes and it holds one row down: a cancelled
 * session dropped from the record improves the month's delivery rate without
 * anybody deciding that it should.
 *
 * No money. Deliberately: the payroll figures on this page are computed over
 * the thirty-day window and settled against it, and a per-month total sitting
 * beside them would be a second, differently-scoped answer to "what does this
 * gym owe" with nothing on screen to say which is which.
 */
function History({ rows, error, from, offset, zone, onOffset }: {
  rows: PtSession[] | null;
  error: string | null;
  from: Date;
  offset: number;
  /** `tenants.timezone`, or null when the gym has not set one. */
  zone: string | null;
  onOffset: (fn: (n: number) => number) => void;
}) {
  // `calendarDateText`, not the gym's zone and not the reader's. `from` is a
  // LOCALLY built midnight of the 1st — a calendar month, not an instant — and
  // rendering it in a zone far enough east would name the month before it.
  const monthLabel = calendarDateText(
    `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`,
    { month: 'long', year: 'numeric' },
  ) ?? '—';
  // Every row here is inside a month that is over, or inside this one up to
  // now, so the tally is over a whole read — `fetchSessions` refuses a
  // truncated one rather than handing back a prefix, which is what makes these
  // counts safe to print at all.
  const past = rows ? pastSessions(rows) : null;
  const tally = rows ? tallyPast(rows) : null;

  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => gymDateTimeText(s.startsAt, zone, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) ?? <span className="dash">not stated</span> },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '',
      render: (s) => s.trainerName ?? <span className="dash">—</span> },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'mins', header: 'Mins', value: (s) => s.durationMin, numeric: true },
    { key: 'state', header: 'What became of it', value: (s) => pastVerdict(s).state,
      render: (s) => {
        const v = pastVerdict(s);
        // The unmarked state is the one that changes what somebody does next,
        // so it is the one that carries a colour. Everything else is a fact.
        return v.state === 'unmarked'
          ? <span style={{ color: 'var(--warn)' }}>{PAST_STATE_LABEL.unmarked}</span>
          : <>{PAST_STATE_LABEL[v.state]}</>;
      } },
    { key: 'markedAt', header: 'Marked', value: (s) => pastVerdict(s).at ?? '',
      render: (s) => {
        const v = pastVerdict(s);
        // A dash here means "nobody has said", which is exactly what the column
        // beside it already says in words — the two agree rather than one of
        // them implying the outcome was recorded at no particular time.
        return gymDateText(v.at, zone, { day: 'numeric', month: 'short' }) ?? <span className="dash">—</span>;
      } },
  ];

  return (
    <Section
      title="Session history"
      sub="Every one-to-one that has already happened, month by month, and what became of it. Cancellations stay on the record — a session that was booked and called off is a fact about the month, not an absence."
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', padding: '10px 14px', borderBottom: '1px solid var(--ring)',
      }}>
        <strong style={{ color: 'var(--ink)' }}>{monthLabel}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ghostBtn} onClick={() => onOffset((n) => n - 1)}>← Previous</button>
          <button style={ghostBtn} onClick={() => onOffset(() => 0)} disabled={offset === 0}>This month</button>
          {/* Stops at the current month rather than paging into the future.
              This is a record of what happened; there is nothing ahead of now
              for it to say, and an empty October read in September would be a
              blank screen that looks like a failure. */}
          <button style={ghostBtn} onClick={() => onOffset((n) => Math.min(0, n + 1))} disabled={offset >= 0}>Next →</button>
        </div>
      </div>

      {error ? (
        // Named as a read that failed, and named with the month, so an owner is
        // never left reading a blank table as a month in which their gym did
        // nothing. Going back another month still works: this one failing says
        // nothing about the one before it.
        <Unread what={`${monthLabel} could not be read, so what happened that month is not known here — this is not a month with no sessions in it. ${error}`} />
      ) : rows === null || past === null || tally === null ? (
        <Loading />
      ) : (
        <>
          <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--ink2)' }}>
            {tally.total === 0
              ? 'No one-to-one had finished in this month when it was read.'
              : (
                <>
                  {tally.total} finished · {tally.delivered} delivered · {tally.missed} no-show
                  {' '}· {tally.late_cancelled} late cancel · {tally.cancelled} cancelled
                  {tally.unmarked > 0
                    ? <> · <span style={{ color: 'var(--warn)' }}>{tally.unmarked} still needing an outcome</span></>
                    : ' · none unmarked'}
                </>
              )}
          </div>
          <DataTable noun="past sessions"
            rows={past} columns={cols} rowKey={(s) => s.id}
            empty="No one-to-one had finished in this month when it was read."
          />
        </>
      )}
    </Section>
  );
}

/* ── shared bits (same shapes as the Money and Door screens) ───────────────── */

// `Toggle` used to live here — two checkboxes that changed this page's payroll
// figure and saved nothing. It is deleted rather than left unused, because an
// unreferenced control is exactly what somebody re-wires when they next want a
// switch, and the whole of D1 is that this particular switch must be stored
// once and read by four screens instead of held four times.

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
} as const;

// Same shape as the one on /timetable, so the two boards that page through time
// in this console have the same control under the reader's hand.
const ghostBtn = {
  background: 'var(--surface2)', color: 'var(--ink2)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '6px 11px', fontSize: 12.5, cursor: 'pointer',
  fontFamily: 'var(--sans)', whiteSpace: 'nowrap',
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
 * What a section shows when the read behind it did not come back.
 *
 * Deliberately not the table's `empty` string. "There is nothing here" is a
 * statement about the gym, and a failed read has established nothing about the
 * gym — on a payroll screen that difference is an owner who reloads versus an
 * owner who pays a month of sessions twice. The reason itself is on the banner
 * at the top of the page, so it is not repeated four times down the column.
 */
function Unread({ what }: { what: string }) {
  return (
    <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--ink3)' }}>
      Not shown: {what} The banner above says why.
    </p>
  );
}
