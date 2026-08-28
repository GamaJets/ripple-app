'use client';

// Payroll — what each trainer is owed for a named period, and nothing else.
//
// /sessions is where the floor gets marked: it runs on a rolling 30 days and
// its job is to empty the queue of sessions nobody has said anything about.
// This screen is the run itself. An owner pays people against a period — August,
// not "the last thirty days" — and the question here is narrower and more
// dangerous: for this month, for this trainer, how much money leaves the
// account, and has any of it left already.
//
// The rule the whole screen is built on: ONLY A SESSION WITH A RECORDED OUTCOME
// MAY REACH A FIGURE. A booked slot whose clock has passed is not a delivered
// session — it is a session nobody has looked at yet, and it might have been a
// no-show, a late cancellation, or an hour the trainer never turned up for.
// Pricing it is how a gym pays twice for work it did not receive, and it is
// exactly what "delivered = booked and the time has passed" used to do.
//
// So when anything in the period is still unmarked, the payable total is a dash
// with the count beside it, never a number — not even a number labelled
// "provisional", because the provisional number is the one that gets paid.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  fetchSessions, fetchSettlements, recordSettlement,
  isDelivered, isAwaitingOutcome, isPayable,
  payrollByTrainer, payrollTotal, settlementBlocker,
  settleableSessions, settlementAmount, settleBlocker, sessionProfileIds,
  PAY_DELIVERED_ONLY,
  type PtSession, type PayPolicy, type PayrollLine, type Settlement,
} from '@lib/gymSessions';
import { fetchGymTrainers, payroll30For, payrollBlocker, type GymTrainer } from '@lib/gymTrainers';
import { money } from '@lib/gymRecord';
import { isoDate } from '@lib/format';

/** How many months back the run can be opened. */
const PERIODS = 6;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "Nothing outstanding" are both lies about a query that errored, and on this
 * screen the second one tells an owner every trainer is square.
 */
type Unread = 'loading' | 'failed' | null;

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as any)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

interface Period {
  key: string;
  label: string;
  /** Bounds of the calendar month in the gym's own timezone, as instants. */
  fromIso: string;
  toIso: string;
  /** The same bounds as dates, which is what a settlement row records. */
  fromDate: string;
  toDate: string;
}

/**
 * The last few calendar months, in the gym's timezone.
 *
 * Local, not UTC, and for the same reason the door log is: this product sells in
 * AED, so the desk reading it is four hours ahead and the UTC month does not
 * turn over until 04:00 on the 1st. Built from UTC bounds, every session in the
 * first four hours of the 1st would have been paid in the previous month's run
 * and then again in this one — a session can only be settled once, so the second
 * run would silently drop it and the trainer would be short an hour.
 */
function periodsBack(n: number): Period[] {
  const now = new Date();
  const out: Period[] = [];
  for (let i = 0; i < n; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const nextStart = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const end = new Date(nextStart.getTime() - 1);
    out.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString([], { month: 'long', year: 'numeric' }),
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      fromDate: isoDate(start),
      toDate: isoDate(end),
    });
  }
  return out;
}

export default function Payroll() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [sessionFee, setSessionFee] = useState<number | null>(null);

  // "The gym has not set a session fee" and "we could not read the gym" both
  // leave sessionFee null, and they are not the same problem: one is a setting
  // to fill in, the other is a read to retry. Without this string the screen
  // sends the owner off to set a fee that is probably already set.
  const [gymError, setGymError] = useState<string | null>(null);

  const periods = useMemo(() => periodsBack(PERIODS), []);
  const [periodKey, setPeriodKey] = useState(periods[0].key);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];

  // Whether a no-show is payable is a gym policy, not something this screen may
  // assume. Same control, same default, same wording as /sessions and /staff —
  // three screens holding three opinions about the same money would be worse
  // than any of them being wrong.
  const [policy, setPolicy] = useState<PayPolicy>(PAY_DELIVERED_ONLY);

  const [sessions, setSessions] = useState<PtSession[] | null>(null);
  const [trainers, setTrainers] = useState<GymTrainer[] | null>(null);
  const [runs, setRuns] = useState<Settlement[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [trainersErr, setTrainersErr] = useState<string | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);

  /**
   * Read the run.
   *
   * `stale` is not tidiness. Switching from August to July while August is still
   * in flight would otherwise let the slower answer land last and paint August's
   * sessions under July's heading and July's total — a screen that pays people
   * showing one month's work priced as another's. A late answer is dropped.
   */
  const load = useCallback(async (tenantId: string, p: Period, stale: () => boolean = () => false) => {
    setSessions(null); setTrainers(null); setRuns(null);

    // allSettled, not all: one failing read must not take the others with it.
    // Under Promise.all a refused payroll_settlements query also emptied the
    // sessions — so a screen whose only fault was not knowing what had already
    // been paid instead reported a month with no work in it, and the two wrong
    // facts pointed opposite ways.
    const [sRes, tRes, rRes] = await Promise.allSettled([
      fetchSessions(supabase, tenantId, p.fromIso, p.toIso),
      fetchGymTrainers(supabase, tenantId),
      fetchSettlements(supabase, tenantId),
    ]);

    if (stale()) return;

    // A read that failed is null, never []. [] is the gym saying it has none;
    // null is nobody knowing. On this screen those two answers differ by a
    // month's wages.
    setSessions(sRes.status === 'fulfilled' ? sRes.value : null);
    setTrainers(tRes.status === 'fulfilled' ? tRes.value : null);
    setRuns(rRes.status === 'fulfilled' ? rRes.value : null);

    const s = failure(sRes, 'the session record');
    const t = failure(tRes, 'the roster');
    const r = failure(rRes, 'what has already been paid');
    setSessionsErr(s); setTrainersErr(t); setRunsErr(r);

    const trouble = [s, t, r].filter((x): x is string => x !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) return;
      // supabase-js resolves on a database error rather than rejecting, so the
      // error has to be read off the result. Destructuring only `data` left a
      // refused read looking exactly like a gym with no fee set: every unrated
      // session priced at nothing, and payroll quietly smaller than it owes.
      const { data: g, error } = await supabase
        .from('tenants').select('name, session_fee').eq('id', who.tenantId).single();
      if (!live) return;
      setGymName(error ? null : g?.name ?? null);
      setSessionFee(error ? null : g?.session_fee ?? null);
      setGymError(error ? (error.message || 'Could not read your gym.') : null);
    })();
    return () => { live = false; };
  }, []);

  // The period is a dependency on purpose: changing the month is a fresh read,
  // not a filter over rows already in hand. Filtering would have shown August's
  // sessions under September's heading until something else triggered a load —
  // on a screen that pays people, under the wrong month's total.
  useEffect(() => {
    if (me === undefined) return;
    if (!me?.tenantId) { setSessions([]); setTrainers([]); setRuns([]); return; }
    let dropped = false;
    load(me.tenantId, period, () => dropped);
    return () => { dropped = true; };
  }, [me, period, load]);

  // The gym's fee is in major units; everything downstream is minor units.
  const fallbackCents = sessionFee == null ? null : Math.round(sessionFee * 100);

  // Stays null while `sessions` is null rather than collapsing to []. Handing
  // payrollByTrainer an empty array would produce a confident, complete-looking
  // run of nobody owed anything, built out of a read that never returned.
  const lines = useMemo(
    () => sessions && payrollByTrainer(sessions, policy, fallbackCents),
    [sessions, policy, fallbackCents],
  );
  const total = useMemo(() => payrollTotal(lines ?? []), [lines]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/payroll">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          The payroll run carries every colleague&rsquo;s pay on one screen, so it is owner-only.
        </p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId, period);

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread = (rows: unknown[] | null, e: string | null): Unread =>
    rows !== null ? null : e ? 'failed' : 'loading';

  const sessionsUnread = unread(sessions, sessionsErr);

  /*
   * Why the figure cannot be settled, in words the owner can act on.
   *
   * Two things settlementBlocker cannot know, because it sees only the sessions.
   * With `sessions` null it would answer "No payable sessions in this period."
   * about a period nobody has managed to read. And when payable sessions have no
   * rate it says "set a session fee", which is the wrong errand if the fee is
   * missing because the gym row could not be read — so name the read failure
   * instead, and leave those sessions unpriced rather than free.
   */
  const blocker =
    sessions === null
      ? null
      : gymError && total.priced < total.payable
        ? `Your gym could not be read, so there is no session fee to price the rest with: ${gymError}`
        : settlementBlocker(total);

  /*
   * The run total, and the single most important decision on this screen.
   *
   * A dash whenever anything blocks settlement — not only when payrollTotal
   * comes back null. When sessions are unmarked, `total.cents` is a real sum
   * over the sessions somebody did mark, and putting that on screen as "the
   * payable total" is the exact failure this module was written to end: it looks
   * final, it is smaller than the truth, and the next thing that happens is that
   * somebody pays it and marks the month closed. When payable sessions carry no
   * rate it is a partial sum for the opposite reason. Either way the honest
   * answer is that this period does not have a total yet, and the note says why.
   */
  const totalText = sessions === null || blocker !== null ? null : money(total.cents);

  // Sessions in this period that nobody has marked. The reason payroll refuses,
  // listed rather than merely counted, because the fix is a person opening
  // /sessions and clicking three buttons.
  const awaiting = sessions && sessions.filter((s) => isAwaitingOutcome(s));

  // The evidence behind the money: every session somebody actually recorded an
  // outcome for. Kept separate from `awaiting` rather than shown as one list
  // with a status column, because a payslip dispute is settled by pointing at
  // these rows and nothing else belongs among them.
  const marked = sessions && sessions.filter((s) => s.outcome !== null);

  /*
   * Names this run could not resolve.
   *
   * sessionProfileIds counts the distinct people the period's rows name —
   * trainers and clients alike — and the difference against the ones that came
   * back with a name is how many rows below will show a dash where a person
   * belongs. Said out loud because an owner staring at four dashed rows should
   * know it is a profiles read that RLS filtered, not four trainers who left.
   */
  const nameGap = (() => {
    if (!sessions) return 0;
    const ids = sessionProfileIds(sessions.map((s) => ({ trainer_id: s.trainerId, client_id: s.clientId })));
    const named = new Set<string>();
    for (const s of sessions) {
      if (s.trainerName) named.add(s.trainerId);
      if (s.clientId && s.clientName) named.add(s.clientId);
    }
    return ids.length - named.size;
  })();

  /*
   * The run, one row per trainer.
   *
   * Built from the period's sessions and then topped up from the roster, so a
   * trainer who delivered nothing this month is on the run saying so rather than
   * missing from it. Missing would read as a gym with fewer staff than it has,
   * and the owner would never notice the one whose whole month went unmarked.
   */
  const rows: RunRow[] | null = (() => {
    if (lines === null || sessions === null) return null;
    const byTrainer = new Map<string, RunRow>();
    for (const l of lines) {
      byTrainer.set(l.trainerId, {
        trainerId: l.trainerId,
        name: l.trainerName,
        line: l,
        outstanding: [],
        blocker: null,
        onRoster: false,
      });
    }
    // Only sessions with a recorded outcome, a rate, and no settlement already
    // stamped on them. Paying by session rather than by period is what stops a
    // late-marked session being paid twice.
    for (const s of settleableSessions(sessions, policy)) {
      byTrainer.get(s.trainerId)?.outstanding.push(s);
    }
    for (const r of byTrainer.values()) {
      r.blocker = settleBlocker(r.outstanding, r.line?.unmarked ?? 0);
    }
    for (const t of trainers ?? []) {
      const existing = byTrainer.get(t.id);
      if (existing) { existing.onRoster = true; if (!existing.name) existing.name = t.name; continue; }
      byTrainer.set(t.id, {
        trainerId: t.id,
        name: t.name,
        line: null,
        outstanding: [],
        blocker: 'No sessions in this period.',
        onRoster: true,
      });
    }
    return [...byTrainer.values()].sort(
      (a, b) => (b.line?.delivered ?? -1) - (a.line?.delivered ?? -1)
        || (a.name ?? '').localeCompare(b.name ?? ''),
    );
  })();

  // Settlements that actually paid for sessions in this period, matched by the
  // id stamped on the sessions themselves rather than by comparing dates. A run
  // recorded on the 2nd for last month's work belongs to last month, and a date
  // comparison would file it under this one.
  const paidHere = (() => {
    if (!sessions || !runs) return null;
    const ids = new Set(sessions.map((s) => s.settlementId).filter((x): x is string => x != null));
    return runs.filter((r) => ids.has(r.id));
  })();
  const alreadySettled = sessions && sessions.filter((s) => s.settlementId != null).length;

  const settle = async (r: RunRow) => {
    if (r.blocker || r.outstanding.length === 0) return;
    setSettling(r.trainerId);
    try {
      await recordSettlement(supabase, tenantId, {
        trainerId: r.trainerId,
        // The period's own bounds, not the first and last session in it: this
        // run is "August", and a settlement covering the 4th to the 22nd would
        // leave the rest of August looking unaccounted for next time somebody
        // reads the settlement history.
        periodFrom: period.fromDate,
        periodTo: period.toDate,
        amountCents: settlementAmount(r.outstanding),
        sessionIds: r.outstanding.map((s) => s.id),
        note: `Payroll run — ${period.label}`,
      });
      await load(tenantId, period);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not record that settlement.');
    } finally { setSettling(null); }
  };

  return (
    <Shell me={me} gymName={gymName} current="/payroll">
      <h1>Payroll</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        What each trainer is owed for {period.label}, counted from sessions with
        a recorded outcome and nothing else. A booked slot whose time has passed
        is not a delivered session, and this screen will not price one.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      {gymError ? (
        <Banner tone="crit">
          <strong style={{ color: 'var(--ink)' }}>Your gym could not be read</strong>, so this run
          does not know your session fee: {gymError}. Anything that needed the fee to price it is
          shown as unpriced rather than as nothing owed. This is not the same as your gym having no
          fee set, and setting one now would not fix it — reload the page.
        </Banner>
      ) : null}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 0' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--ink2)' }}>
          Period
          <select
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            style={field}
          >
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
          borderRadius: 8, overflow: 'hidden', margin: '20px 0 10px',
        }}
      >
        <Kpi
          label={`Payable, ${period.label}`}
          text={totalText}
          // No note at all when the sessions are unknown: "ready to settle" on a
          // period nobody could read is the worst sentence available here.
          note={sessions === null ? undefined : (blocker ?? 'ready to settle')}
        />
        <Kpi
          label="Delivered"
          text={sessions ? String(total.delivered) : null}
          note={sessions ? 'outcome recorded as completed' : undefined}
        />
        <Kpi
          label="Awaiting an outcome"
          text={sessions ? String(total.unmarked) : null}
          note={total.unmarked > 0 ? 'blocking the run' : sessions ? 'nothing unmarked' : undefined}
        />
        <Kpi
          label="Payable sessions"
          text={sessions ? String(total.payable) : null}
          note={policy.payNoShows || policy.payLateCancellations ? 'policy widens this' : 'delivered only'}
        />
        <Kpi
          label="Already settled"
          text={alreadySettled == null ? null : String(alreadySettled)}
          note={alreadySettled == null ? undefined : 'sessions in this period already paid for'}
        />
      </div>

      {blocker ? (
        <Banner tone={total.unmarked > 0 ? 'crit' : undefined}>
          <strong style={{ color: 'var(--ink)' }}>This run cannot be settled.</strong> {blocker}{' '}
          {total.unmarked > 0 ? (
            <>
              The payable total is a dash rather than a figure on purpose: pricing those{' '}
              {total.unmarked} would mean paying for no-shows and slots nobody cancelled, because
              nobody has yet said which of them they are. Mark them on{' '}
              <a href="/sessions">Sessions</a> and this run will price itself.
            </>
          ) : null}
        </Banner>
      ) : null}

      {nameGap > 0 ? (
        <Banner>
          {nameGap} {nameGap === 1 ? 'person' : 'people'} named by this period&rsquo;s sessions could
          not be looked up, so some rows below show a dash where a name belongs. Every figure beside
          those dashes was still read from the sessions themselves.
        </Banner>
      ) : null}

      <Section
        title="Pay policy"
        sub="A gym decision, not a default. It changes which sessions are payable, and therefore the figure above."
      >
        <div style={{ padding: 14, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <Toggle
            label="Pay for no-shows"
            hint="The trainer held the hour and turned up."
            on={policy.payNoShows}
            onChange={(v) => setPolicy((p) => ({ ...p, payNoShows: v }))}
          />
          <Toggle
            label="Pay for late cancellations"
            hint="Cancelled too late to fill the slot."
            on={policy.payLateCancellations}
            onChange={(v) => setPolicy((p) => ({ ...p, payLateCancellations: v }))}
          />
        </div>
      </Section>

      <Blocking sessions={awaiting} unread={sessionsUnread} />

      <Run
        rows={rows}
        unread={sessionsUnread}
        rosterUnread={unread(trainers, trainersErr)}
        settling={settling}
        onSettle={settle}
      />

      <LineItems sessions={marked} unread={sessionsUnread} policy={policy} />

      <CrossCheck
        trainers={trainers}
        unread={unread(trainers, trainersErr)}
        sessionFee={sessionFee}
        gymError={gymError}
      />

      <Paid runs={paidHere} unread={unread(runs, runsErr)} sessionsUnread={sessionsUnread} period={period} />

      <p style={{ color: 'var(--ink3)', fontSize: 12.5, margin: '0 0 30px' }}>
        Recording a payment stamps those exact sessions with the run that paid
        for them, so nothing on this screen can be paid a second time — and a
        session marked after its period was settled simply joins the next run
        instead of being lost. <button style={linkBtn} onClick={refresh}>Reload the run</button>
      </p>
    </Shell>
  );
}

/* ── the rows this screen is about ─────────────────────────────────────────── */

interface RunRow {
  trainerId: string;
  name: string | null;
  /** Null when this trainer has no sessions at all in the period. */
  line: PayrollLine | null;
  /** Marked, priced, payable, and not already settled. */
  outstanding: PtSession[];
  blocker: string | null;
  /** Whether the roster still lists them. Only meaningful once it has been read. */
  onRoster: boolean;
}

/* ── what is holding the run up ────────────────────────────────────────────── */

function Blocking({ sessions, unread }: { sessions: PtSession[] | null; unread: Unread }) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleString([], {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }) },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '',
      render: (s) => s.trainerName ?? <span className="dash">—</span> },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'mins', header: 'Mins', value: (s) => s.durationMin, numeric: true },
    // Not "0.00" and not the gym's standard fee: until somebody says what
    // happened, this session has no price, only a rate it might be worth.
    { key: 'worth', header: 'If delivered', value: (s) => s.rateCents ?? -1, numeric: true,
      render: (s) => s.rateCents == null
        ? <span className="dash">not rated</span>
        : <span className="dash">{money(s.rateCents)}</span> },
  ];
  return (
    <Section
      title="Holding up the run"
      sub="Booked, finished, and nobody has recorded what happened. None of these are priced, and none of them can be settled around."
    >
      {sessions === null ? (
        // "Nothing waiting" is an all-clear, and an all-clear is precisely what a
        // failed read has not earned. On this screen it would mean "go ahead and
        // pay" about a month nobody managed to read.
        <Unresolved state={unread ?? 'loading'} what="the session record, so nobody can say whether anything is waiting to be marked" />
      ) : (
        <DataTable
          rows={sessions} columns={cols} rowKey={(s) => s.id}
          empty="Nothing waiting — every finished session in this period has an outcome."
        />
      )}
    </Section>
  );
}

/* ── the run ───────────────────────────────────────────────────────────────── */

function Run({ rows, unread, rosterUnread, settling, onSettle }: {
  rows: RunRow[] | null; unread: Unread; rosterUnread: Unread;
  settling: string | null; onSettle: (r: RunRow) => void;
}) {
  const cols: Column<RunRow>[] = [
    { key: 'name', header: 'Trainer', value: (r) => r.name ?? '',
      render: (r) => (
        <span>
          {r.name ?? <span className="dash">—</span>}
          {/* Only once the roster has actually been read: with that read
              refused, every row would carry this label and the one person it
              is really about would be invisible among them. */}
          {!r.onRoster && rosterUnread === null ? (
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink3)' }}>
              worked this period, not on the roster
            </span>
          ) : null}
        </span>
      ) },
    { key: 'delivered', header: 'Delivered', value: (r) => r.line?.delivered ?? null, numeric: true,
      // A trainer with no sessions in the period has no delivered count to give.
      // Zero would be a claim that they worked and delivered nothing.
      render: (r) => r.line ? String(r.line.delivered) : <span className="dash">—</span> },
    { key: 'noshow', header: 'No-shows', value: (r) => r.line?.noShows ?? null, numeric: true,
      render: (r) => r.line ? String(r.line.noShows) : <span className="dash">—</span> },
    { key: 'cancelled', header: 'Cancelled', value: (r) => r.line?.cancelled ?? null, numeric: true,
      render: (r) => r.line ? String(r.line.cancelled) : <span className="dash">—</span> },
    { key: 'unmarked', header: 'Unmarked', value: (r) => r.line?.unmarked ?? null, numeric: true,
      render: (r) => !r.line ? <span className="dash">—</span>
        : r.line.unmarked === 0 ? <span className="dash">—</span>
        : <span style={{ color: 'var(--warn)' }}>{r.line.unmarked}</span> },
    { key: 'period', header: 'Period worth', value: (r) => periodCents(r) ?? -1, numeric: true,
      render: (r) => {
        const c = periodCents(r);
        // Null covers three different unknowns, and each of them is a dash: no
        // sessions at all, sessions nobody marked, and payable sessions with no
        // rate. The reason travels in the Owed column's note rather than being
        // guessed at here.
        return c == null ? <span className="dash">—</span> : money(c);
      } },
    { key: 'owed', header: 'Owed now', value: (r) => (r.blocker ? -1 : settlementAmount(r.outstanding)), numeric: true,
      render: (r) => r.blocker
        ? <span className="dash">—</span>
        : money(settlementAmount(r.outstanding)) },
    { key: 'why', header: 'Status', value: (r) => r.blocker ?? '',
      render: (r) => (
        <span style={{ color: r.blocker ? 'var(--ink3)' : 'var(--ink2)', whiteSpace: 'normal' }}>
          {r.blocker ?? `${r.outstanding.length} session${r.outstanding.length === 1 ? '' : 's'} unpaid`}
        </span>
      ) },
    { key: 'pay', header: '', value: () => 0, align: 'right',
      render: (r) => (
        <button
          disabled={!!r.blocker || settling === r.trainerId}
          onClick={() => onSettle(r)}
          style={{
            background: r.blocker ? 'var(--surface2)' : 'var(--brand)',
            color: r.blocker ? 'var(--ink3)' : 'var(--brand-ink)',
            border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12.5,
            fontWeight: 600, cursor: r.blocker ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            fontFamily: 'var(--sans)',
          }}
        >
          {settling === r.trainerId ? 'Recording…' : 'Mark as paid'}
        </button>
      ) },
  ];

  return (
    <Section
      title="The run"
      sub="What each trainer's marked sessions in this period are worth, and what of it is still outstanding. Settling stamps those exact sessions."
    >
      {rows === null ? (
        // "Nothing outstanding" is the most expensive wrong sentence on this
        // page: it says every trainer is square, and the owner closes the tab.
        <Unresolved state={unread ?? 'loading'} what="the session record, so what anybody is owed is not known. Nothing here is settled or unsettled until it can be" />
      ) : (
        <>
          {rosterUnread ? (
            <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
              {rosterUnread === 'loading'
                ? 'Still reading the roster — a trainer with no sessions this period may not be listed yet.'
                : 'The roster did not come back, so this run covers only trainers who appear in the period’s own sessions. A trainer who delivered nothing this month is missing from the list rather than shown with nothing owed.'}
            </p>
          ) : null}
          <DataTable rows={rows} columns={cols} rowKey={(r) => r.trainerId} empty="Nobody delivered anything in this period." />
        </>
      )}
    </Section>
  );
}

/**
 * What the period's marked work is worth for one trainer.
 *
 * Null — a dash — rather than a partial sum whenever the line has anything
 * unmarked or anything payable it could not price. A partial sum on a payroll
 * row is the fabricated number this codebase exists to refuse: it is smaller
 * than the truth and it looks exactly like the truth.
 */
function periodCents(r: RunRow): number | null {
  if (!r.line) return null;
  if (r.line.unmarked > 0) return null;
  if (r.line.priced < r.line.payable) return null;
  return r.line.cents;
}

/* ── the evidence ──────────────────────────────────────────────────────────── */

const OUTCOME_LABEL: Record<string, string> = {
  completed: 'Delivered',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  late_cancelled: 'Late cancel',
};

/**
 * Every marked session in the period, line by line.
 *
 * The run above is a set of totals, and a trainer who disagrees with a total
 * needs the rows it was made of — which session, what was recorded, at what
 * rate, and whether the pay policy let it count. Without this the only way to
 * answer "why is my August short" is to trust the total.
 */
function LineItems({ sessions, unread, policy }: {
  sessions: PtSession[] | null; unread: Unread; policy: PayPolicy;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => new Date(s.startsAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) },
    { key: 'trainer', header: 'Trainer', value: (s) => s.trainerName ?? '',
      render: (s) => s.trainerName ?? <span className="dash">—</span> },
    { key: 'client', header: 'Client', value: (s) => s.clientName ?? '',
      render: (s) => s.clientName ?? <span className="dash">—</span> },
    { key: 'outcome', header: 'Recorded', value: (s) => s.outcome ?? '',
      render: (s) => (
        <span style={{ color: isDelivered(s) ? 'var(--good)' : 'var(--ink2)' }}>
          {s.outcome ? OUTCOME_LABEL[s.outcome] ?? s.outcome : <span className="dash">—</span>}
        </span>
      ) },
    { key: 'counts', header: 'Counts', value: (s) => (isPayable(s, policy) ? 1 : 0), numeric: true,
      // Under this gym's stated policy, not under a default. A no-show counts or
      // does not because somebody ticked a box on this page, and the row says
      // which way it went rather than leaving the total to imply it.
      render: (s) => isPayable(s, policy)
        ? <span style={{ color: 'var(--ink2)' }}>yes</span>
        : <span className="dash">no</span> },
    { key: 'rate', header: 'Rate', value: (s) => s.rateCents ?? null, numeric: true,
      // Null is a session nobody priced, which is not a session worth nothing.
      render: (s) => s.rateCents == null
        ? <span className="dash">not rated</span>
        : money(s.rateCents) },
    { key: 'paid', header: 'Settled', value: (s) => s.settlementId ?? '',
      render: (s) => s.settlementId
        ? <span style={{ color: 'var(--ink2)' }}>paid</span>
        : <span className="dash">outstanding</span> },
  ];
  return (
    <Section
      title="Line items"
      sub="Every session in this period that somebody recorded an outcome for — the rows the totals above are made of."
    >
      {sessions === null ? (
        <Unresolved state={unread ?? 'loading'} what="the session record, so there are no line items to show" />
      ) : (
        <DataTable rows={sessions} columns={cols} rowKey={(s) => s.id} empty="Nothing in this period has been marked yet." />
      )}
    </Section>
  );
}

/* ── the second opinion ────────────────────────────────────────────────────── */

/**
 * The roster's own 30-day payroll figure, beside the run.
 *
 * Deliberately a different window from the period above, and said so out loud
 * rather than quietly aligned: it is computed by a different module from a
 * different query, so when the two disagree by more than the window explains,
 * one of them is wrong and the owner should find out which before paying
 * anybody. Presenting them as the same number would hide exactly that.
 */
function CrossCheck({ trainers, unread, sessionFee, gymError }: {
  trainers: GymTrainer[] | null; unread: Unread; sessionFee: number | null; gymError: string | null;
}) {
  const cents = trainers ? payroll30For(trainers, sessionFee) : null;
  const why = trainers
    ? (gymError && sessionFee == null
        ? `Your gym could not be read, so there is no session fee to price it with: ${gymError}`
        : payrollBlocker(trainers, sessionFee))
    : null;

  const cols: Column<GymTrainer>[] = [
    { key: 'name', header: 'Trainer', value: (t) => t.name },
    { key: 'clients', header: 'Clients', value: (t) => t.clients, numeric: true },
    { key: 'booked', header: 'Booked & passed', value: (t) => t.sessions30, numeric: true },
    { key: 'delivered', header: 'Delivered', value: (t) => t.delivered30, numeric: true },
    { key: 'unmarked', header: 'Unmarked', value: (t) => t.unmarked30, numeric: true,
      render: (t) => t.unmarked30 === 0
        ? <span className="dash">—</span>
        : <span style={{ color: 'var(--warn)' }}>{t.unmarked30}</span> },
    { key: 'since', header: 'Since', value: (t) => t.since ?? '',
      render: (t) => t.since
        ? new Date(t.since).toLocaleDateString([], { month: 'short', year: 'numeric' })
        : <span className="dash">—</span> },
  ];

  return (
    <Section
      title="Roster, last 30 days"
      sub="A second reading of the same money, over a rolling 30 days rather than the period above. The two windows do not line up, and are not meant to — this is here to be disagreed with."
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="micro">30-day payroll</span>
        <span className="mono" style={{ fontSize: 18, color: cents == null ? 'var(--ink3)' : 'var(--ink)' }}>
          {/* The same refusal as the run above, from the module that owns this
              window: unmarked sessions or no fee means a dash, never a figure. */}
          {(cents != null && money(cents)) || '—'}
        </span>
        {why ? <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>{why}</span> : null}
      </div>
      {trainers === null ? (
        <Unresolved state={unread ?? 'loading'} what="the roster, so there is no second reading to check the run against" />
      ) : (
        <DataTable rows={trainers} columns={cols} rowKey={(t) => t.id} empty="No trainers on the roster." />
      )}
    </Section>
  );
}

/* ── what has already gone out ─────────────────────────────────────────────── */

function Paid({ runs, unread, sessionsUnread, period }: {
  runs: Settlement[] | null; unread: Unread; sessionsUnread: Unread; period: Period;
}) {
  const cols: Column<Settlement>[] = [
    { key: 'when', header: 'Paid', value: (r) => r.settledAt,
      render: (r) => new Date(r.settledAt).toLocaleDateString() },
    { key: 'period', header: 'Covering', value: (r) => r.periodFrom,
      render: (r) => `${r.periodFrom} → ${r.periodTo}` },
    { key: 'n', header: 'Sessions', value: (r) => r.sessionsCount, numeric: true },
    { key: 'method', header: 'How', value: (r) => r.method },
    { key: 'amount', header: 'Amount', value: (r) => r.amountCents, numeric: true,
      // Snapshotted at the time, never recomputed — a later fee change must not
      // rewrite what actually left the account.
      render: (r) => money(r.amountCents) },
  ];
  return (
    <Section
      title={`Already paid for ${period.label}`}
      sub="Matched by the run stamped on this period's own sessions, not by comparing dates. Amounts are as they were when the money went out."
    >
      {runs === null ? (
        // The two failures behind an empty list are different errands, and
        // neither of them is "nobody has been paid": that sentence's obvious
        // remedy is to pay everybody again.
        <Unresolved
          state={(sessionsUnread ?? unread) ?? 'loading'}
          what={sessionsUnread
            ? 'the session record, so nothing can be matched to a run that paid for it'
            : 'what has already been paid. Do not pay anybody a second time on the strength of this page — reload first'}
        />
      ) : (
        <DataTable rows={runs} columns={cols} rowKey={(r) => r.id} empty="Nothing in this period has been paid yet." />
      )}
    </Section>
  );
}

/* ── shared bits (same shapes as the Sessions and Door screens) ────────────── */

const field = {
  padding: '7px 10px', borderRadius: 7, fontSize: 13,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 12.5, fontFamily: 'var(--sans)',
} as const;

function Toggle({ label, hint, on, onChange }: {
  label: string; hint: string; on: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer', maxWidth: 300 }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ display: 'block', fontSize: 13.5, color: 'var(--ink)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>{hint}</span>
      </span>
    </label>
  );
}

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
      margin: '14px 0', padding: '11px 14px', borderRadius: 8, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read used to fall through to the table's own empty line, so "we
 * could not ask" and "the gym has none" were the same sentence on screen. On a
 * payroll run those are an owner who reloads and an owner who pays a month
 * twice.
 */
function Unresolved({ state, what }: { state: Exclude<Unread, null>; what: string }) {
  return (
    <div style={{ padding: '26px 20px', color: 'var(--ink3)', fontSize: 13 }}>
      {state === 'loading' ? 'Loading…' : `Not shown: could not read ${what}. The banner above says why.`}
    </div>
  );
}
