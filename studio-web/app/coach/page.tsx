'use client';

// Coach — one trainer's day, as they open it at six in the morning.
//
// Every other screen in this console answers a gym-wide question. This one
// answers a personal one, and the difference is the whole point: it is scoped
// to the signed-in trainer, never to the tenant. A coach sees their own
// sessions, their own roster and their own inbound requests. Reading a gym's
// worth of rows here and filtering afterwards would still have put another
// coach's book on the wire, so every query below carries the trainer's own id
// in its WHERE clause.
//
// Three things a coach needs before the first client arrives:
//
//   1. What is on today, in the order it happens.
//   2. What has already happened that nobody has marked. This is the section
//      that matters most, because payroll refuses to price an unmarked session
//      — an hour worked and not recorded is an hour not paid, and the person
//      who loses that money is the only person who can fix it. It is at the
//      top, with the buttons that resolve it.
//   3. Who is waiting on them: clients asking to be coached, and clients who
//      have quietly stopped turning up.
//
// An unmarked session is NOT a delivered one and is never counted as one. It
// has an unknown outcome, it sits in its own queue, and it stays out of every
// delivered figure on this page until a human says what happened.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import {
  isDelivered, isAwaitingOutcome, isPayable, sessionProfileIds, namesById,
  markOutcome, PAY_DELIVERED_ONLY,
  type PtSession, type SessionOutcome,
} from '@lib/gymSessions';
import { money } from '@lib/gymRecord';
import { isoDate, fmtDay, fmtTime } from '@lib/format';

const DAY = 86400000;

/** How far back this screen looks. Long enough to catch a session somebody
 *  forgot to mark three weeks ago, and to say something about who has gone
 *  quiet without inventing a date beyond the window. */
const WINDOW_DAYS = 60;

/** The line at which "has not trained lately" becomes worth saying out loud. */
const QUIET_DAYS = 14;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "this read returned".
 *
 * The two must not look the same. A coach who reads "No sessions waiting to be
 * marked" off a query that was refused goes to work believing their pay is in
 * order. A coach who reads "we could not check" goes and looks. Same blank
 * table, opposite consequences.
 */
type Unread = 'loading' | 'failed' | null;

const OUTCOME_LABEL: Record<SessionOutcome, string> = {
  completed: 'Delivered',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  late_cancelled: 'Late cancel',
};

const OUTCOMES: SessionOutcome[] = ['completed', 'no_show', 'late_cancelled', 'cancelled'];

interface CoachRequest {
  id: string;
  clientId: string;
  clientName: string | null;
  mode: 'online' | 'inperson';
  /** 'code', 'directory', or null on rows written before the column existed. */
  source: string | null;
  viaCode: string | null;
  createdAt: string;
}

interface Roster {
  clientId: string;
  clientName: string | null;
  status: string;
  since: string;
}

interface Approval {
  at: string;
  note: string | null;
}

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as any)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

/**
 * This trainer's sessions, and nobody else's.
 *
 * Deliberately not gymSessions.fetchSessions: that one filters on tenant_id,
 * which for a coach on a gym's staff would return every colleague's book. The
 * filter here is `trainer_id = mine`, which is also exactly what the
 * sessions_trainer row-level policy allows — so the query and the database
 * agree rather than one relying on the other.
 */
async function fetchMySessions(trainerId: string, sinceIso: string, untilIso: string): Promise<PtSession[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, settlement_id')
    .eq('trainer_id', trainerId)
    .gte('starts_at', sinceIso)
    .lte('starts_at', untilIso)
    .order('starts_at', { ascending: true });
  if (error) throw error;

  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    trainerId: r.trainer_id,
    trainerName: null,
    clientId: r.client_id ?? null,
    clientName: null,
    startsAt: r.starts_at,
    durationMin: r.duration_min ?? 60,
    status: r.status,
    outcome: (r.outcome ?? null) as SessionOutcome | null,
    outcomeAt: r.outcome_at ?? null,
    rateCents: r.rate_cents ?? null,
    settlementId: r.settlement_id ?? null,
  }));
}

async function fetchMyRequests(trainerId: string): Promise<CoachRequest[]> {
  const { data, error } = await supabase
    .from('coach_requests')
    .select('id, client_id, mode, status, source, via_code, created_at')
    .eq('trainer_id', trainerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    clientName: null,
    mode: r.mode === 'inperson' ? 'inperson' : 'online',
    source: r.source ?? null,
    viaCode: r.via_code ?? null,
    createdAt: r.created_at,
  }));
}

async function fetchMyRoster(coachId: string): Promise<Roster[]> {
  const { data, error } = await supabase
    .from('coaching_relationships')
    .select('client_id, status, created_at')
    .eq('coach_id', coachId);
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    clientId: r.client_id,
    clientName: null,
    status: r.status ?? 'active',
    since: r.created_at,
  }));
}

/**
 * Which of these sessions the client has confirmed.
 *
 * Not proof of delivery — the coach still has to mark it — but it is the
 * strongest evidence available at 6am about a session nobody wrote up, and it
 * turns "did I do this one?" into a fact rather than a memory.
 */
async function fetchApprovals(sessionIds: string[]): Promise<Map<string, Approval>> {
  if (!sessionIds.length) return new Map();
  const { data, error } = await supabase
    .from('session_approvals')
    .select('session_id, approved_at, note')
    .in('session_id', sessionIds);
  if (error) throw error;
  return new Map(((data ?? []) as any[]).map((r) => [r.session_id, { at: r.approved_at, note: r.note ?? null }]));
}

export default function Coach() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PtSession[] | null>(null);
  const [requests, setRequests] = useState<CoachRequest[] | null>(null);
  const [roster, setRoster] = useState<Roster[] | null>(null);
  const [approvals, setApprovals] = useState<Map<string, Approval> | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  /** Whether a load has finished. It is what tells a null list apart from a
   *  list still on its way — err cannot, because a load in which only one of
   *  four reads failed sets err while the other three are perfectly fine. */
  const [settled, setSettled] = useState(false);

  const load = useCallback(async (trainerId: string) => {
    const now = new Date();
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
    // To the end of today, so a session booked for this evening still shows up
    // under "today" while months of future bookings stay out of the window
    // that decides who has gone quiet.
    const until = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

    // allSettled, not all: these three answer different questions and a coach
    // needs whichever ones came back. Under Promise.all a refused
    // coaching_relationships read — a table the trainer may not even use — would
    // have emptied the unmarked-sessions queue as well, and the one section on
    // this page that stands between a coach and their pay would have rendered
    // "nothing waiting" on the strength of an unrelated failure.
    const [sRes, qRes, rRes] = await Promise.allSettled([
      fetchMySessions(trainerId, since, until),
      fetchMyRequests(trainerId),
      fetchMyRoster(trainerId),
    ]);

    const mine = sRes.status === 'fulfilled' ? sRes.value : null;
    const reqs = qRes.status === 'fulfilled' ? qRes.value : null;
    const rost = rRes.status === 'fulfilled' ? rRes.value : null;

    // Null, never []. [] is "you have none"; null is "nobody knows".
    setSessions(mine);
    setRequests(reqs);
    setRoster(rost);

    // Approvals depend on knowing the session ids, so they are a second step
    // rather than a fourth promise. A failure here costs a column, not a page.
    let aRes: PromiseSettledResult<Map<string, Approval>> | null = null;
    if (mine) {
      aRes = (await Promise.allSettled([fetchApprovals(mine.map((s) => s.id))]))[0];
      setApprovals(aRes.status === 'fulfilled' ? aRes.value : null);
    } else {
      setApprovals(null);
    }

    // One name lookup for every person these three reads named. Its failure is
    // not fatal: an unreadable name renders as a dash beside a row that is
    // still real and still actionable.
    const ids = new Set<string>([
      ...sessionProfileIds((mine ?? []).map((s) => ({ trainer_id: null, client_id: s.clientId }))),
      ...(reqs ?? []).map((r) => r.clientId),
      ...(rost ?? []).map((r) => r.clientId),
    ]);
    if (ids.size) {
      const { data } = await supabase.from('profiles').select('id, full_name').in('id', [...ids]);
      setNames(namesById((data ?? []) as Array<{ id: string; full_name?: string | null }>));
    } else {
      setNames(new Map());
    }

    const trouble = [
      failure(sRes, 'your sessions'),
      failure(qRes, 'the coaching requests'),
      failure(rRes, 'your client list'),
      aRes ? failure(aRes, 'which sessions your clients have confirmed') : null,
    ].filter((s): s is string => s !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
    setSettled(true);
  }, []);

  const refresh = useCallback(() => { if (me?.id) return load(me.id); }, [load, me?.id]);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who) return;
      if (who.tenantId) {
        // no-error-ok: the gym's name is a label in the sidebar. A coach without
        // a gym, and a gym we could not read, both leave it null and the page
        // works either way — nothing below is scoped by it.
        const { data: t } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
        if (live) setGymName(t?.name ?? null);
      }
      if (who.role !== 'trainer' && who.role !== 'owner') return;
      await load(who.id);
    })();
    return () => { live = false; };
  }, [load]);

  const now = Date.now();
  const today = isoDate(new Date());

  /** Everything on today, in the order it happens. Already ascending. */
  const todays = useMemo(
    () => sessions && sessions.filter((s) => isoDate(new Date(s.startsAt)) === today),
    [sessions, today],
  );

  /**
   * Finished, booked, and nobody has said what happened.
   *
   * isAwaitingOutcome is the rule, and it is stricter than "the clock has
   * passed": an available or blocked slot is not awaiting anything, because
   * nobody was in it. Oldest first — the oldest is the one most likely to have
   * been forgotten, and the one closest to being paid in a period that closes
   * without it.
   */
  const unmarked = useMemo(
    () => sessions && sessions.filter((s) => isAwaitingOutcome(s, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions],
  );

  /**
   * Who has gone quiet: this coach's clients, by how long since a session they
   * actually delivered.
   *
   * Delivered, not booked and not merely elapsed. A client with three unmarked
   * sessions has not been proven to have trained at all, and counting those
   * would hide exactly the person this section exists to surface.
   */
  const quiet = useMemo(() => {
    if (!roster || !sessions) return null;
    const last = new Map<string, string>();
    for (const s of sessions) {
      if (!s.clientId || !isDelivered(s)) continue;
      const prev = last.get(s.clientId);
      if (!prev || s.startsAt > prev) last.set(s.clientId, s.startsAt);
    }
    return roster
      .filter((r) => r.status === 'active')
      .map((r) => {
        const at = last.get(r.clientId) ?? null;
        return {
          ...r,
          lastAt: at,
          // Null, not a large number: "no delivered session in the window" is
          // not the same fact as "seen 61 days ago", and this screen has not
          // looked far enough back to know which it is.
          daysSince: at == null ? null : Math.floor((now - Date.parse(at)) / DAY),
        };
      })
      .filter((r) => r.daysSince == null || r.daysSince >= QUIET_DAYS)
      .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, sessions]);

  /**
   * What the delivered sessions in this window are priced at.
   *
   * Only outcome === 'completed' under PAY_DELIVERED_ONLY, because whether a
   * no-show is payable is the gym's policy and not this screen's to assert. A
   * session carrying no rate is left out of the sum and counted separately —
   * summing it as zero would quietly tell a coach their hour was worth nothing.
   */
  const priced = useMemo(() => {
    if (!sessions) return null;
    let cents: number | null = null;
    let payable = 0, withRate = 0;
    for (const s of sessions) {
      if (!isPayable(s, PAY_DELIVERED_ONLY)) continue;
      payable += 1;
      if (s.rateCents == null) continue;
      cents = (cents ?? 0) + s.rateCents;
      withRate += 1;
    }
    return { cents, payable, withRate };
  }, [sessions]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  // Owners are let in because plenty of them still coach, and this is their own
  // book rather than the gym's. Everyone else gets a sentence, not four empty
  // tables that look like a coach with no clients.
  if (me.role !== 'trainer' && me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/coach">
        <h1>This screen is for coaches</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          It shows one trainer&apos;s own sessions, clients and requests. Your account is not a
          trainer account, so there is no book here to show — which is not the same as an empty one.
        </p>
      </Shell>
    );
  }

  const unread = (rows: unknown[] | Map<unknown, unknown> | null): Unread =>
    rows !== null ? null : settled ? 'failed' : 'loading';

  /**
   * Record what happened.
   *
   * The rate is left alone on purpose — `markOutcome` writes rate_cents only
   * when it is given one, and a coach marking their own session has no business
   * setting their own fee. Payroll prices an unrated session from the gym's
   * session fee instead, which is the owner's number rather than the coach's.
   */
  const mark = async (s: PtSession, outcome: SessionOutcome) => {
    try {
      await markOutcome(supabase, s.id, outcome);
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Could not record that outcome.');
    }
  };

  return (
    <Shell me={me} gymName={gymName} current="/coach">
      <h1>Your day</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Your sessions, your clients and your requests — nobody else&apos;s.
        {me.role === 'owner' ? ' You own this gym; the gym-wide view is under Sessions.' : ''}
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 8, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="On today"
          text={todays ? String(todays.filter((s) => s.status === 'booked').length) : null}
          note={
            todays == null ? undefined
              : todays.length === 0 ? 'nothing in the diary'
              : `${todays.length} slot${todays.length === 1 ? '' : 's'} in all`
          }
        />
        <Kpi
          label="Waiting to be marked"
          text={unmarked ? String(unmarked.length) : null}
          note={unmarked && unmarked.length > 0 ? 'none of these can be paid yet' : undefined}
          tone={unmarked && unmarked.length > 0 ? 'warn' : undefined}
        />
        <Kpi
          label="Asking to join you"
          text={requests ? String(requests.length) : null}
          note={requests && requests.length > 0 ? 'waiting on your answer' : undefined}
        />
        <Kpi
          label="Gone quiet"
          text={quiet ? String(quiet.length) : null}
          note={quiet ? `no delivered session in ${QUIET_DAYS} days` : undefined}
        />
        <Kpi
          label={`Delivered, ${WINDOW_DAYS} days`}
          text={priced ? String(priced.payable) : null}
          note={
            priced == null ? undefined
              // A sum over sessions that carry no rate is not zero money; it is
              // no answer. Say which of the two this is.
              : priced.cents == null
                ? priced.payable > 0 ? 'none of them carry a rate' : undefined
                : `${money(priced.cents)} across ${priced.withRate} of ${priced.payable}`
          }
        />
      </div>

      <Unmarked
        sessions={unmarked} unread={unread(unmarked)} approvals={approvals}
        approvalsUnread={unread(approvals)} names={names} onMark={mark}
      />
      <Today sessions={todays} unread={unread(todays)} approvals={approvals} names={names} onMark={mark} />
      <Requests requests={requests} unread={unread(requests)} names={names} me={me} onChange={refresh} setErr={setErr} />
      <Quiet rows={quiet} unread={unread(quiet)} names={names} />
    </Shell>
  );
}

/* ── the queue that blocks a coach's pay ───────────────────────────────────── */

function Unmarked({ sessions, unread, approvals, approvalsUnread, names, onMark }: {
  sessions: PtSession[] | null; unread: Unread;
  approvals: Map<string, Approval> | null; approvalsUnread: Unread;
  names: Map<string, string>; onMark: (s: PtSession, o: SessionOutcome) => void;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      render: (s) => `${fmtDay(s.startsAt)} · ${fmtTime(s.startsAt)}` },
    { key: 'who', header: 'Client', value: (s) => (s.clientId && names.get(s.clientId)) ?? 'zzz',
      render: (s) => (s.clientId && names.get(s.clientId))
        ?? <span className="dash">name not readable</span> },
    { key: 'ago', header: 'Waiting', value: (s) => Date.now() - Date.parse(s.startsAt), numeric: true,
      render: (s) => {
        const d = Math.floor((Date.now() - Date.parse(s.startsAt)) / DAY);
        return d < 1 ? 'today' : `${d} day${d === 1 ? '' : 's'}`;
      } },
    { key: 'ok', header: 'Client confirmed', value: (s) => approvals?.get(s.id)?.at ?? '',
      render: (s) => {
        // Three different facts, three different cells. "Not confirmed" on a
        // read that never came back would tell a coach to chase a client who
        // confirmed days ago.
        if (approvalsUnread) return <span className="dash">not checked</span>;
        const a = approvals?.get(s.id);
        if (!a) return <span className="dash">not confirmed</span>;
        return <span title={a.note ?? undefined}>{fmtDay(a.at)}{a.note ? ' · note' : ''}</span>;
      } },
    { key: 'mark', header: '', value: () => 0, align: 'right',
      render: (s) => (
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {OUTCOMES.map((o) => (
            <button key={o} style={o === 'completed' ? markBtn : quietBtn} onClick={() => onMark(s, o)}>
              {OUTCOME_LABEL[o]}
            </button>
          ))}
        </span>
      ) },
  ];

  const n = sessions?.length ?? 0;

  return (
    <Section
      title="Not marked yet"
      sub="Sessions that started, finished, and nobody has said what happened. Payroll will not price one of these, so until it is marked the hour is worked and unpaid."
      tone={n > 0 ? 'warn' : undefined}
    >
      {unread ? <Unresolved state={unread} what="your sessions" /> : (
        <DataTable
          rows={sessions ?? []} columns={cols} rowKey={(s) => s.id}
          empty="Nothing outstanding — every finished session has an outcome against it."
        />
      )}
      {n > 0 ? (
        <p style={{ margin: 14, fontSize: 12.5, color: 'var(--ink3)' }}>
          Marking one delivered does not price it. The rate comes from your gym&apos;s session fee at
          payroll, not from this screen — a coach setting their own rate is not a thing this console
          lets happen.
        </p>
      ) : null}
    </Section>
  );
}

/* ── today ─────────────────────────────────────────────────────────────────── */

function Today({ sessions, unread, approvals, names, onMark }: {
  sessions: PtSession[] | null; unread: Unread;
  approvals: Map<string, Approval> | null;
  names: Map<string, string>; onMark: (s: PtSession, o: SessionOutcome) => void;
}) {
  const now = Date.now();

  const cols: Column<PtSession>[] = [
    { key: 'at', header: 'At', value: (s) => s.startsAt, render: (s) => fmtTime(s.startsAt) },
    { key: 'for', header: 'For', value: (s) => s.durationMin, numeric: true,
      render: (s) => `${s.durationMin} min` },
    { key: 'who', header: 'Client', value: (s) => (s.clientId && names.get(s.clientId)) ?? 'zzz',
      render: (s) => {
        if (!s.clientId) {
          return <span className="dash">{s.status === 'blocked' ? 'blocked out' : 'open slot'}</span>;
        }
        return names.get(s.clientId) ?? <span className="dash">name not readable</span>;
      } },
    { key: 'state', header: 'Outcome', value: (s) => s.outcome ?? '',
      render: (s) => {
        if (s.outcome) return OUTCOME_LABEL[s.outcome];
        if (s.status !== 'booked') return <span className="dash">—</span>;
        // The clock has not passed, so there is nothing to mark and nothing
        // missing. "Awaiting" here would put a session that has not happened
        // into the same bucket as one somebody forgot.
        if (Date.parse(s.startsAt) + s.durationMin * 60_000 > now) {
          return <span className="dash">still to come</span>;
        }
        return <span style={{ color: 'var(--warn)' }}>needs marking</span>;
      } },
    { key: 'ok', header: 'Confirmed', value: (s) => approvals?.get(s.id)?.at ?? '',
      render: (s) => (approvals?.get(s.id)
        ? fmtTime(approvals.get(s.id)!.at)
        : <span className="dash">{approvals === null ? 'not checked' : 'not yet'}</span>) },
    { key: 'paid', header: 'Rate', value: (s) => s.rateCents ?? -1, numeric: true,
      // A session with no rate stamped on it is not a free session. It is one
      // payroll will price from the gym's fee later.
      render: (s) => s.rateCents == null
        ? <span className="dash">set at payroll</span>
        : (money(s.rateCents) ?? <span className="dash">—</span>) },
    { key: 'mark', header: '', value: () => 0, align: 'right',
      render: (s) => (
        s.status === 'booked' && s.outcome === null && Date.parse(s.startsAt) <= now
          ? (
            <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
              <button style={markBtn} onClick={() => onMark(s, 'completed')}>Delivered</button>
              <button style={quietBtn} onClick={() => onMark(s, 'no_show')}>No-show</button>
            </span>
          )
          : null
      ) },
  ];

  return (
    <Section title="Today" sub="In the order it happens, from your own diary.">
      {unread ? <Unresolved state={unread} what="your sessions" /> : (
        <DataTable
          rows={sessions ?? []} columns={cols} rowKey={(s) => s.id}
          empty="Nothing booked with you today."
        />
      )}
    </Section>
  );
}

/* ── people asking to be coached by you ────────────────────────────────────── */

function Requests({ requests, unread, names, me, onChange, setErr }: {
  requests: CoachRequest[] | null; unread: Unread; names: Map<string, string>;
  me: Me; onChange: () => void; setErr: (s: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const respond = async (r: CoachRequest, accept: boolean) => {
    setBusy(r.id); setMsg(null);
    try {
      if (accept) {
        // link_coaching FIRST, and the order is the fix rather than a detail.
        // Writing coach_clients alone gives a roster row and nothing behind it:
        // every log a coach actually reads — workouts, measurements, check-ins —
        // is gated on clients.trainer_id, which only link_coaching sets. Accept
        // without it and the client appears on the roster with an empty file.
        const { error: linkErr } = await supabase.rpc('link_coaching', {
          p_coach: me.id, p_client: r.clientId, p_mode: r.mode,
        });
        // Stop here rather than carrying on. A roster row written after this
        // failed is the exact half-linked state described above.
        if (linkErr) { setMsg(`${linkErr.message} — nothing was changed.`); setBusy(null); return; }

        // coach_clients.name is NOT NULL and this trainer usually cannot read a
        // stranger's profile until the link exists, so 'A client' is a
        // placeholder standing in for a name we do not have — the same one the
        // phone writes, so the two never disagree about the row.
        const { error: rosterErr } = await supabase.from('coach_clients').upsert(
          { id: r.clientId, trainer_id: me.id, name: names.get(r.clientId) ?? 'A client', mode: r.mode },
          { onConflict: 'id' },
        );
        if (rosterErr) { setMsg(`${rosterErr.message} — they are linked but not on your roster.`); setBusy(null); return; }
      }

      const { error } = await supabase.from('coach_requests')
        .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
        .eq('id', r.id);
      if (error) { setMsg(error.message); setBusy(null); return; }

      setErr(null);
      setMsg(accept ? 'Added to your roster.' : 'Declined.');
      onChange();
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not answer that request.');
    } finally { setBusy(null); }
  };

  const cols: Column<CoachRequest>[] = [
    { key: 'who', header: 'Client', value: (r) => names.get(r.clientId) ?? 'zzz',
      // Their profile is usually not readable until the link exists, so the
      // dash here is the normal case rather than a fault. Saying which it is
      // stops a coach declining somebody because the row looked broken.
      render: (r) => names.get(r.clientId) ?? <span className="dash">name shared once you accept</span> },
    { key: 'mode', header: 'Wants', value: (r) => r.mode,
      render: (r) => (r.mode === 'inperson' ? 'In person' : 'Online') },
    { key: 'via', header: 'Came from', value: (r) => r.source ?? '',
      render: (r) => {
        if (r.source === 'code') return r.viaCode ? <span className="mono">{r.viaCode}</span> : 'your code';
        if (r.source === 'directory') return 'the directory';
        // Rows written before anything recorded a source. Guessing one would
        // make invented history indistinguishable from measured history.
        return <span className="dash">not recorded</span>;
      } },
    { key: 'when', header: 'Asked', value: (r) => r.createdAt, render: (r) => fmtDay(r.createdAt) },
    { key: 'act', header: '', value: () => 0, align: 'right',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={quietBtn} disabled={busy === r.id} onClick={() => respond(r, false)}>Decline</button>
          <button style={markBtn} disabled={busy === r.id} onClick={() => respond(r, true)}>
            {busy === r.id ? 'Working…' : 'Accept'}
          </button>
        </span>
      ) },
  ];

  return (
    <Section
      title="Asking to be coached by you"
      sub="Each one is a person waiting. From their side there is no difference between you not answering and you saying no."
    >
      {msg ? <p style={{ margin: 14, fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
      {unread ? <Unresolved state={unread} what="the coaching requests" /> : (
        <DataTable
          rows={requests ?? []} columns={cols} rowKey={(r) => r.id}
          empty="Nobody is waiting on an answer."
        />
      )}
    </Section>
  );
}

/* ── who has stopped turning up ────────────────────────────────────────────── */

interface QuietRow extends Roster { lastAt: string | null; daysSince: number | null }

function Quiet({ rows, unread, names }: {
  rows: QuietRow[] | null; unread: Unread; names: Map<string, string>;
}) {
  const cols: Column<QuietRow>[] = [
    { key: 'who', header: 'Client', value: (r) => names.get(r.clientId) ?? 'zzz',
      render: (r) => names.get(r.clientId) ?? <span className="dash">name not readable</span> },
    { key: 'last', header: 'Last delivered', value: (r) => r.lastAt ?? '',
      render: (r) => r.lastAt
        ? fmtDay(r.lastAt)
        // Not "never". This screen looked back sixty days and found nothing;
        // whether they trained before that is a question it did not ask.
        : <span className="dash">none in {WINDOW_DAYS} days</span> },
    { key: 'gap', header: 'Days', value: (r) => r.daysSince, numeric: true,
      render: (r) => r.daysSince == null
        ? <span className="dash">—</span>
        : String(r.daysSince) },
    { key: 'since', header: 'On your book since', value: (r) => r.since, render: (r) => fmtDay(r.since) },
  ];

  return (
    <Section
      title="Gone quiet"
      sub={`Clients on your book with no session you have marked delivered in the last ${QUIET_DAYS} days. A booked-but-unmarked session does not count as training — which is the point.`}
    >
      {unread ? <Unresolved state={unread} what="your client list" /> : (
        <DataTable
          rows={rows ?? []} columns={cols} rowKey={(r) => r.clientId}
          empty="Everyone on your book has trained recently."
        />
      )}
    </Section>
  );
}

/* ── shared bits (the same shapes as Door and Sessions) ────────────────────── */

const field = {
  padding: '9px 11px', borderRadius: 7, fontSize: 13.5,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const markBtn = {
  ...field, padding: '5px 10px', fontSize: 12.5,
  background: 'var(--brand)', color: 'var(--brand-ink)',
  fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
} as const;

const quietBtn = {
  ...field, padding: '5px 10px', fontSize: 12.5,
  color: 'var(--ink2)', cursor: 'pointer',
} as const;

function Section({ title, sub, tone, children }: {
  title: string; sub?: string; tone?: 'warn'; children: React.ReactNode;
}) {
  return (
    <section
      style={{
        border: '1px solid var(--ring)', borderRadius: 8, background: 'var(--surface)',
        marginBottom: 22, borderLeft: tone === 'warn' ? '3px solid var(--warn)' : undefined,
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, text, note, tone }: {
  label: string; text: string | null; note?: string; tone?: 'warn';
}) {
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
      <div className="micro">{label}</div>
      <div
        className="mono"
        style={{
          fontSize: 21, marginTop: 5, letterSpacing: '-0.02em',
          color: text == null ? 'var(--ink3)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink)',
        }}
      >
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
 * A refused read falling through to the table's own empty line would make "we
 * could not ask" and "you have none" the same sentence — and on the unmarked
 * queue that sentence costs the coach money.
 */
function Unresolved({ state, what }: { state: Exclude<Unread, null>; what: string }) {
  return (
    <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
      {state === 'loading' ? 'Loading…' : `Could not read ${what}. The banner above says why.`}
    </div>
  );
}
