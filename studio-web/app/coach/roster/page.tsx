'use client';

// Roster — the coach's own book: who they train, when each of them last did
// anything, and who to ring first.
//
// This is the second console screen a trainer can open, and unlike the door it
// is not a desk job — it is their own client list, scoped to them and not to
// the gym. A coach must never be shown another coach's clients here, so every
// read below is filtered by the signed-in person's id rather than by tenant.
// The database enforces the same thing again; this file does not rely on that.
//
// The screen answers one question a coach asks every morning — who has gone
// quiet — and it is only worth reading if it refuses to guess. A client whose
// activity could not be read is not a quiet client, a pack that could not be
// read is not an empty pack, and a client who has never logged a weight has not
// failed to make progress. Each of those is a dash with the reason beside it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { money } from '@lib/gymRecord';
import { COACHED_MODE_SHORT, readCoachedModeOrNull, type CoachedMode } from '@lib/types';
import { goalLabel, sortGoals, GOAL_METRIC, type GoalTarget, type MeasuredKind } from '@lib/goalTargets';
import { fmtDay } from '@lib/format';

const DAY = 86400000;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "this read returned".
 *
 * "Loading…" that never resolves and "No clients yet" are both lies about a
 * query that errored, and a coach acts on both — one by waiting, the other by
 * concluding their book has been wiped.
 */
type Unread = 'loading' | 'failed' | null;

/**
 * supabase-js resolves with `{ data: null, error }` instead of throwing, so a
 * refused query handed to Promise.allSettled comes back *fulfilled* carrying
 * null. Every "the roster is empty" bug in this codebase started there. This
 * turns a database error back into a rejection so allSettled can tell the two
 * apart.
 */
async function ask<T>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw error;
  return data ?? [];
}

/** One settled read, as a line for the banner. Null when it came back fine. */
function failure(res: PromiseSettledResult<unknown>, what: string): string | null {
  if (res.status === 'fulfilled') return null;
  const why = (res.reason as { message?: string } | null)?.message;
  return `Could not read ${what}${why ? `: ${why}` : '.'}`;
}

const settled = <T,>(res: PromiseSettledResult<T[]>): T[] | null =>
  res.status === 'fulfilled' ? res.value : null;

const GOAL: Record<string, string> = { fatloss: 'Fat loss', tone: 'Tone', muscle: 'Build muscle' };

/* ── the row ───────────────────────────────────────────────────────────────── */

interface Row {
  id: string;
  /** Null means the name could not be read — the person is still on the book. */
  name: string | null;
  namesKnown: boolean;
  goal: string | null;
  /** What this client is actually working toward, from `goal_targets` — their
   *  own targets, which a coach may read (part 59). Distinct from `goal` above,
   *  which is the coarse three-way direction on `clients`. Empty means they
   *  have set none; null means the read failed and we must not say either way. */
  targets: GoalTarget[] | null;
  mode: CoachedMode | null;
  /** When this client joined THIS coach's book, not when they made an account. */
  since: string | null;

  /** Most recent workout or check-in, in ms. Null with activityKnown means the
   *  client genuinely has nothing logged. */
  lastMs: number | null;
  activityKnown: boolean;

  /** 0-100, converted from the 1-5 self-rating. See adherencePct(). */
  adherence: number | null;
  adherenceKnown: boolean;

  weightKg: number | null;
  weightAtMs: number | null;
  /** Change between the first and last InBody scan. Needs two of them. */
  scanDelta: number | null;
  scanCount: number;
  weightKnown: boolean;

  /** Sessions still owed across every paid pack this coach sold them. */
  packLeft: number | null;
  packTotal: number | null;
  packCount: number;
  packsKnown: boolean;
}

/**
 * check_ins.adherence is a 1-5 SELF-RATING — the Rating control on the client's
 * check-in screen — and every trainer surface renders adherence as a
 * percentage. Passed through raw, a client who rated themselves 4/5 appeared as
 * "4%" and was flagged at risk by a coach who then rang them about a problem
 * they did not have. Convert, and clamp: a 7 typed into a 1-5 field is not 140%.
 */
function adherencePct(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.round((Math.max(1, Math.min(5, raw)) / 5) * 100);
}

const daysSince = (ms: number) => Math.floor((Date.now() - ms) / DAY);

function ago(ms: number): string {
  const d = daysSince(ms);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}

/* ── who needs attention ───────────────────────────────────────────────────── */

interface Signal {
  /** 3 urgent, 2 worth a call, 1 worth a look, 0 fine. Null = cannot tell. */
  rank: number | null;
  label: string;
  /** Why the rank is null, or what the label is counting. */
  note?: string;
}

/**
 * The one judgement on this screen, and it is only allowed to make it out of
 * facts that actually came back.
 *
 * The order matters: silence beats a low rating, because a client who has
 * stopped logging has usually stopped training, and a rating of 2/5 from
 * someone still checking in every week is a conversation rather than a rescue.
 * A row whose inputs are missing gets no rank at all — it sorts to the bottom
 * and says which read is missing, rather than sitting quietly at "fine" and
 * letting a coach skip past someone they cannot see.
 */
function signalFor(r: Row): Signal {
  const missing: string[] = [];
  if (!r.activityKnown) missing.push('activity');
  if (!r.adherenceKnown) missing.push('check-ins');
  if (!r.packsKnown) missing.push('packs');

  if (r.activityKnown && r.lastMs == null) {
    return { rank: 3, label: 'Nothing logged yet', note: 'never trained or checked in' };
  }
  if (r.activityKnown && r.lastMs != null) {
    const d = daysSince(r.lastMs);
    if (d >= 21) return { rank: 3, label: 'Silent 3 weeks', note: `last seen ${ago(r.lastMs)}` };
    if (d >= 14) return { rank: 3, label: 'Silent 2 weeks', note: `last seen ${ago(r.lastMs)}` };
    if (d >= 7) return { rank: 2, label: 'Quiet a week', note: `last seen ${ago(r.lastMs)}` };
  }
  if (r.adherence != null && r.adherence <= 40) {
    return { rank: 2, label: 'Rating themselves low', note: `${r.adherence}% on their last check-in` };
  }
  if (r.packsKnown && r.packCount > 0 && r.packLeft === 0) {
    return { rank: 2, label: 'Pack used up', note: 'nothing left to book against' };
  }
  if (r.packsKnown && r.packCount > 0 && r.packLeft != null && r.packLeft <= 2) {
    return { rank: 1, label: 'Pack nearly done', note: `${r.packLeft} left` };
  }
  if (r.adherence != null && r.adherence <= 60) {
    return { rank: 1, label: 'Slipping', note: `${r.adherence}% on their last check-in` };
  }
  // Nothing fired. That is only "fine" if everything it would have fired on was
  // readable; otherwise the honest answer is that we do not know.
  if (missing.length) {
    return { rank: null, label: '—', note: `could not read ${missing.join(' or ')}` };
  }
  return { rank: 0, label: 'On track' };
}

const RANK_COLOUR: Record<number, string> = {
  3: 'var(--crit)',
  2: 'var(--serious)',
  1: 'var(--warn)',
  0: 'var(--ink3)',
};

/* ── the screen ────────────────────────────────────────────────────────────── */

interface Pack {
  id: string;
  clientId: string | null;
  amountCents: number | null;
  total: number | null;
  used: number;
  status: string;
  createdAt: string | null;
}

export default function CoachRoster() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [packsErr, setPacksErr] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Set when part of the book loaded and part did not — the list on screen is
   *  real but short, which is worse than no list unless it is said out loud. */
  const [partial, setPartial] = useState<string | null>(null);

  const load = useCallback(async (coachId: string) => {
    setErr(null);
    setPartial(null);

    // Two sources make up a coach's book and both are scoped to them: the
    // relationship rows they own, and the client rows that name them as
    // trainer. link_coaching() writes both, but they drift — a client whose
    // relationship was ended still carries trainer_id, and a client linked
    // before that function existed has only one of the two.
    const [relRes, cliRes] = await Promise.allSettled([
      ask<{ client_id: string; mode: string | null; status: string | null; created_at: string | null }>(
        supabase
          .from('coaching_relationships')
          .select('client_id, mode, status, created_at')
          .eq('coach_id', coachId),
      ),
      ask<{ id: string; goal: string | null; mode: string | null }>(
        supabase.from('clients').select('id, goal, mode').eq('trainer_id', coachId),
      ),
    ]);

    const rels = settled(relRes);
    const cls = settled(cliRes);

    const bookTrouble = [
      failure(relRes, 'your coaching links'),
      failure(cliRes, 'your client records'),
    ].filter((s): s is string => s !== null);

    if (rels === null && cls === null) {
      // Neither half came back. An empty table here would read as "you have no
      // clients", which is the most expensive sentence this screen can say.
      setRows(null);
      setPacks(null);
      setErr(bookTrouble.join(' · '));
      return;
    }
    if (bookTrouble.length) {
      setPartial(
        rels === null
          ? 'Your coaching links did not come back, so anyone linked to you but not yet recorded against a client record is missing from this list.'
          : 'Your client records did not come back, so the goal and training mode are missing below and anyone without a coaching link is not listed at all.',
      );
    }

    // Ended relationships are past clients, not current book. They are dropped
    // rather than shown greyed out, because a coach reading "who needs
    // attention first" must not be handed people they no longer coach.
    const live = (rels ?? []).filter((r) => r.status !== 'ended');
    const ids = [...new Set([...live.map((r) => r.client_id), ...(cls ?? []).map((c) => c.id)])].filter(Boolean);

    const relBy = new Map(live.map((r) => [r.client_id, r]));
    const cliBy = new Map((cls ?? []).map((c) => [c.id, c]));

    if (!ids.length) {
      setRows([]);
      setPacks([]);
      setPacksErr(false);
      setErr(bookTrouble.length ? bookTrouble.join(' · ') : null);
      return;
    }

    // Everything that decorates a client who is on the book either way. Settled
    // one by one: a refused check_ins read must not empty the workouts column,
    // and a refused client_purchases read must never reach the screen as a
    // sessions count of any kind.
    const [nameRes, woRes, ciRes, scRes, gtRes, cpRes] = await Promise.allSettled([
      ask<{ id: string; full_name: string | null }>(
        supabase.from('profiles').select('id, full_name').in('id', ids),
      ),
      ask<{ user_id: string; performed_at: string }>(
        supabase.from('workouts').select('user_id, performed_at').in('user_id', ids)
          .order('performed_at', { ascending: false }),
      ),
      ask<{ user_id: string; at: string; adherence: number | null; weight_kg: number | null }>(
        supabase.from('check_ins').select('user_id, at, adherence, weight_kg').in('user_id', ids)
          .order('at', { ascending: false }),
      ),
      ask<{ client_id: string; taken_at: string; weight_kg: number | null }>(
        supabase.from('scans').select('client_id, taken_at, weight_kg').in('client_id', ids)
          .order('taken_at', { ascending: true }),
      ),
      // What each client is working toward. RLS (goal_targets_coach_read) already
      // limits this to clients this coach actually coaches, so the `in` is for
      // the size of the answer rather than for who may see it.
      ask<{
        id: string; client_id: string; kind: string; target_value: string | number | null;
        title: string | null; target_date: string | null; achieved_at: string | null; created_at: string;
      }>(
        supabase.from('goal_targets')
          .select('id, client_id, kind, target_value, title, target_date, achieved_at, created_at')
          .in('client_id', ids),
      ),
      // Scoped to this coach as well as to these clients: a client may hold
      // packs bought from someone else, and those are not this coach's to spend
      // or to count.
      ask<{
        id: string; client_id: string | null; amount_cents: number | null;
        sessions_total: number | null; sessions_used: number | null;
        status: string; created_at: string | null;
      }>(
        supabase.from('client_purchases')
          .select('id, client_id, amount_cents, sessions_total, sessions_used, status, created_at')
          .eq('trainer_id', coachId).in('client_id', ids)
          .order('created_at', { ascending: false }),
      ),
    ]);

    const names = settled(nameRes);
    const workouts = settled(woRes);
    const checkIns = settled(ciRes);
    const scans = settled(scRes);
    const goalRows = settled(gtRes);
    const purchases = settled(cpRes);

    // Grouped per client. A refused read leaves this map empty AND `goalRows`
    // null, and the two are read differently below: an empty list for a client
    // whose read succeeded means they have set no goals, which is worth a coach
    // knowing. The same empty list after a failure means nothing at all.
    const goalsBy = new Map<string, GoalTarget[]>();
    for (const g of goalRows ?? []) {
      const t: GoalTarget = {
        id: g.id,
        kind: g.kind as GoalTarget['kind'],
        targetValue: g.target_value != null ? Number(g.target_value) : null,
        title: g.title,
        targetDateISO: g.target_date,
        achievedAtISO: g.achieved_at,
        createdAtISO: g.created_at,
      };
      const list = goalsBy.get(g.client_id);
      if (list) list.push(t); else goalsBy.set(g.client_id, [t]);
    }

    const nameBy = new Map((names ?? []).map((p) => [p.id, (p.full_name ?? '').trim()]));

    const lastWorkout = new Map<string, number>();
    for (const w of workouts ?? []) {
      const t = Date.parse(w.performed_at);
      if (Number.isFinite(t)) lastWorkout.set(w.user_id, Math.max(lastWorkout.get(w.user_id) ?? 0, t));
    }

    const lastCheckIn = new Map<string, number>();
    const latestAdherence = new Map<string, number>();
    const latestCheckWeight = new Map<string, { kg: number; at: number }>();
    for (const c of checkIns ?? []) {
      const t = Date.parse(c.at);
      if (!Number.isFinite(t)) continue;
      lastCheckIn.set(c.user_id, Math.max(lastCheckIn.get(c.user_id) ?? 0, t));
      // Rows arrive newest first, so the first numeric reading per client is the
      // latest one.
      const pct = adherencePct(c.adherence);
      if (pct != null && !latestAdherence.has(c.user_id)) latestAdherence.set(c.user_id, pct);
      if (c.weight_kg != null && !latestCheckWeight.has(c.user_id)) {
        latestCheckWeight.set(c.user_id, { kg: Number(c.weight_kg), at: t });
      }
    }

    const scansBy = new Map<string, { kg: number; at: number }[]>();
    for (const s of scans ?? []) {
      if (s.weight_kg == null) continue;
      const t = Date.parse(s.taken_at);
      if (!Number.isFinite(t)) continue;
      const arr = scansBy.get(s.client_id) ?? [];
      arr.push({ kg: Number(s.weight_kg), at: t });
      scansBy.set(s.client_id, arr);
    }

    const packRows: Pack[] = (purchases ?? []).map((p) => ({
      id: p.id,
      clientId: p.client_id,
      amountCents: p.amount_cents,
      total: p.sessions_total,
      used: p.sessions_used ?? 0,
      status: p.status,
      createdAt: p.created_at,
    }));

    // Only a paid pack with a session count is a pack of sessions. A pack still
    // pending, or one sold as a flat fee with no sessions_total, tells us
    // nothing about how many sessions are owed — and counting it as zero is
    // exactly the error that would tell a coach a client with eight left has
    // none.
    const packSummary = new Map<string, { left: number; total: number; count: number }>();
    for (const p of packRows) {
      if (!p.clientId || p.status !== 'paid' || p.total == null) continue;
      const cur = packSummary.get(p.clientId) ?? { left: 0, total: 0, count: 0 };
      cur.left += Math.max(0, p.total - p.used);
      cur.total += p.total;
      cur.count += 1;
      packSummary.set(p.clientId, cur);
    }

    const activityKnown = workouts !== null && checkIns !== null;
    const packsKnown = purchases !== null;

    const built: Row[] = ids.map((id) => {
      const rel = relBy.get(id);
      const cli = cliBy.get(id);
      const name = nameBy.get(id);

      const w = lastWorkout.get(id);
      const c = lastCheckIn.get(id);
      const lastMs = w != null || c != null ? Math.max(w ?? 0, c ?? 0) : null;

      const series = scansBy.get(id) ?? [];
      const fromScan = series.length ? series[series.length - 1] : null;
      const fromCheck = latestCheckWeight.get(id) ?? null;
      // The later of the two readings. The delta below deliberately uses scans
      // only: an InBody sheet and a bathroom scale are not the same measurement,
      // and subtracting one from the other invents a change nobody weighed.
      const latestWeight =
        fromScan && fromCheck ? (fromScan.at >= fromCheck.at ? fromScan : fromCheck) : fromScan ?? fromCheck;

      const pack = packSummary.get(id);
      const rawMode = cli?.mode ?? rel?.mode ?? null;

      return {
        id,
        name: name ? name : null,
        namesKnown: names !== null,
        goal: cli?.goal ? GOAL[cli.goal] ?? cli.goal : null,
        targets: goalRows === null ? null : sortGoals(goalsBy.get(id) ?? []),
        // Unclassified stays null rather than defaulting to online: the phone
        // defaults it for its own filter, but here it would tell a coach an
        // in-person client is remote.
        mode: readCoachedModeOrNull(rawMode),
        since: rel?.created_at ?? null,
        lastMs,
        activityKnown,
        adherence: latestAdherence.get(id) ?? null,
        adherenceKnown: checkIns !== null,
        weightKg: latestWeight ? Math.round(latestWeight.kg * 10) / 10 : null,
        weightAtMs: latestWeight ? latestWeight.at : null,
        scanDelta: series.length > 1
          ? Math.round((series[series.length - 1].kg - series[0].kg) * 10) / 10
          : null,
        scanCount: series.length,
        weightKnown: scans !== null && checkIns !== null,
        packLeft: pack ? pack.left : null,
        packTotal: pack ? pack.total : null,
        packCount: pack ? pack.count : 0,
        packsKnown,
      };
    });

    setRows(built);
    setPacks(purchases === null ? null : packRows);
    setPacksErr(purchases === null);

    const trouble = [
      ...bookTrouble,
      failure(nameRes, 'your clients’ names'),
      failure(woRes, 'their logged workouts'),
      failure(ciRes, 'their check-ins'),
      failure(scRes, 'their scans'),
      failure(gtRes, 'the goals they set'),
      failure(cpRes, 'their session packs'),
    ].filter((s): s is string => s !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who) return;
      if (who.tenantId) {
        // no-error-ok: an unreadable gym name renders as a dash in the frame;
        // the roster below does not depend on it.
        const { data: t } = await supabase.from('tenants').select('name').eq('id', who.tenantId).single();
        if (live) setGymName(t?.name ?? null);
      }
      if (who.role !== 'trainer' && who.role !== 'owner') return;
      await load(who.id);
    })();
    return () => { live = false; };
  }, [load]);

  // Ranked before the table sees them, so the default view already answers
  // "who first" without anyone clicking a column header.
  const ranked = useMemo(() => {
    if (!rows) return null;
    return rows
      .map((r) => ({ row: r, sig: signalFor(r) }))
      .sort((a, b) => {
        // Unranked rows sit at the bottom but are never dropped: a client we
        // cannot read is still a client.
        if (a.sig.rank == null && b.sig.rank == null) return 0;
        if (a.sig.rank == null) return 1;
        if (b.sig.rank == null) return -1;
        if (a.sig.rank !== b.sig.rank) return b.sig.rank - a.sig.rank;
        return (a.row.lastMs ?? 0) - (b.row.lastMs ?? 0);
      });
  }, [rows]);

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.role !== 'trainer' && me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/coach/roster">
        <h1>This screen is for coaches</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: 560 }}>
          A roster is one coach&rsquo;s own book of clients, so there is nothing here to
          show an account that does not coach. If you should have a coaching role
          on this gym, the owner sets it.
        </p>
      </Shell>
    );
  }

  const unread: Unread = ranked !== null ? null : err ? 'failed' : 'loading';

  // Every tile below is allowed to say "we do not know". None of them is
  // allowed to say a number it had to invent to fill the space.
  const known = ranked ?? [];
  const bookKnown = ranked !== null && partial === null;
  const activityKnown = known.length === 0 ? bookKnown : known.every((k) => k.row.activityKnown);
  const packsKnown = known.length === 0 ? bookKnown : known.every((k) => k.row.packsKnown);

  const attention = known.filter((k) => k.sig.rank != null && k.sig.rank >= 2).length;
  const unranked = known.filter((k) => k.sig.rank == null).length;
  const trainedThisWeek = known.filter((k) => k.row.lastMs != null && daysSince(k.row.lastMs) < 7).length;

  const rated = known.map((k) => k.row.adherence).filter((a): a is number => a != null);
  // An average over an empty set is undefined, not zero. A roster where nobody
  // has checked in has no average adherence, and printing 0% would put every
  // client on a call list.
  const avgAdherence = rated.length ? Math.round(rated.reduce((s, n) => s + n, 0) / rated.length) : null;

  const packTotals = known.reduce(
    (acc, k) => (k.row.packCount > 0 && k.row.packLeft != null
      ? { left: acc.left + k.row.packLeft, holders: acc.holders + 1 }
      : acc),
    { left: 0, holders: 0 },
  );

  const cols: Column<{ row: Row; sig: Signal }>[] = [
    {
      key: 'who', header: 'Client',
      value: (r) => r.row.name ?? 'zzz',
      render: (r) => r.row.name
        ? <span style={{ color: 'var(--ink)' }}>{r.row.name}</span>
        : r.row.namesKnown
          ? <span className="dash">— no name on their profile</span>
          : <span className="dash">— name unreadable</span>,
    },
    {
      key: 'goal', header: 'Goal',
      value: (r) => r.row.goal,
      render: (r) => r.row.goal ?? <span className="dash">— not set</span>,
    },
    {
      key: 'working', header: 'Working toward',
      // Sorts on the nearest open target date so a coach can see whose deadline
      // is closest; undated and achieved goals sort last rather than as a zero.
      value: (r) => {
        const open = (r.row.targets ?? []).filter((g) => !g.achievedAtISO && g.targetDateISO);
        return open.length ? Date.parse(open[0].targetDateISO as string) : Number.MAX_SAFE_INTEGER;
      },
      render: (r) => {
        const ts = r.row.targets;
        // The read failed. An empty cell here would say "this client has set no
        // goals", which is a claim about them rather than about our connection.
        if (ts === null) return <span className="dash">— unreadable</span>;
        const open = ts.filter((g) => !g.achievedAtISO);
        if (!open.length) {
          return <span className="dash">{ts.length ? '— all reached' : '— none set'}</span>;
        }
        const lead = open[0];
        const unit = lead.kind === 'custom' ? '' : GOAL_METRIC[lead.kind as MeasuredKind].unit;
        const more = open.length - 1;
        return (
          <span title={open.map((g) => goalLabel(g) + (g.targetValue != null ? ` ${g.targetValue}` : '')).join(' · ')}>
            {goalLabel(lead)}{lead.targetValue != null ? ` ${lead.targetValue}${unit}` : ''}
            {lead.targetDateISO ? <span className="dash"> by {fmtDay(lead.targetDateISO)}</span> : null}
            {more > 0 ? <span className="dash"> +{more}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'mode', header: 'Mode',
      value: (r) => r.row.mode,
      render: (r) => r.row.mode
        ? COACHED_MODE_SHORT[r.row.mode]
        : <span className="dash">— not classified</span>,
    },
    {
      key: 'last', header: 'Last trained',
      value: (r) => r.row.lastMs, numeric: true,
      render: (r) => {
        if (!r.row.activityKnown) return <span className="dash">— activity unreadable</span>;
        if (r.row.lastMs == null) return <span className="dash">— nothing logged</span>;
        return <span title={new Date(r.row.lastMs).toLocaleString()}>{ago(r.row.lastMs)}</span>;
      },
    },
    {
      key: 'adherence', header: 'Adherence',
      value: (r) => r.row.adherence, numeric: true,
      render: (r) => {
        if (!r.row.adherenceKnown) return <span className="dash">— check-ins unreadable</span>;
        // Their own 1-5 rating, converted. Never the raw column.
        if (r.row.adherence == null) return <span className="dash">— not rated yet</span>;
        return `${r.row.adherence}%`;
      },
    },
    {
      key: 'weight', header: 'Weight',
      value: (r) => r.row.weightKg, numeric: true,
      render: (r) => {
        if (!r.row.weightKnown) return <span className="dash">— readings unreadable</span>;
        // No weight logged is a missing reading, not a stalled client. It is a
        // dash — never 0 kg, and never "no progress", which is a claim about
        // the person rather than about the data.
        if (r.row.weightKg == null) return <span className="dash">— none logged</span>;
        return (
          <span>
            {r.row.weightKg.toFixed(1)} kg
            {r.row.scanDelta != null ? (
              <span style={{ color: 'var(--ink3)', fontSize: 11.5, marginLeft: 6 }}>
                {r.row.scanDelta > 0 ? '+' : ''}{r.row.scanDelta.toFixed(1)} since first scan
              </span>
            ) : (
              <span style={{ color: 'var(--ink3)', fontSize: 11.5, marginLeft: 6 }}>
                {r.row.scanCount === 1 ? 'one scan only' : 'no scan to compare'}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'pack', header: 'Sessions left',
      value: (r) => (r.row.packsKnown && r.row.packCount > 0 ? r.row.packLeft : null), numeric: true,
      render: (r) => {
        // The worst error this screen can make is telling a coach a client has
        // no sessions when they hold eight. A refused read is a dash.
        if (!r.row.packsKnown) return <span className="dash">— packs unreadable</span>;
        if (r.row.packCount === 0) return <span className="dash">— no pack on file</span>;
        return (
          <span>
            {r.row.packLeft}
            <span style={{ color: 'var(--ink3)', fontSize: 11.5, marginLeft: 6 }}>
              of {r.row.packTotal}
            </span>
          </span>
        );
      },
    },
    {
      key: 'signal', header: 'Attention',
      value: (r) => r.sig.rank, numeric: true, align: 'left',
      render: (r) => (
        <span>
          <span style={{ color: r.sig.rank == null ? 'var(--ink3)' : RANK_COLOUR[r.sig.rank] }}>
            {r.sig.label}
          </span>
          {r.sig.note ? (
            <span style={{ color: 'var(--ink3)', fontSize: 11.5, marginLeft: 6 }}>{r.sig.note}</span>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <Shell me={me} gymName={gymName} current="/coach/roster">
      <h1>Roster</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: 640 }}>
        Your clients — the ones linked to you, not the gym&rsquo;s whole book. Ordered
        by who has gone quietest, so the top of this list is the morning&rsquo;s call
        list.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}
      {partial ? <Banner>{partial}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Clients"
          text={ranked === null || !bookKnown ? null : String(ranked.length)}
          note={ranked === null ? 'your book did not load' : !bookKnown ? 'part of your book is missing' : undefined}
        />
        <Kpi
          label="Need a call"
          text={ranked === null ? null : String(attention)}
          note={unranked > 0 ? `${unranked} could not be ranked` : undefined}
        />
        <Kpi
          label="Trained this week"
          text={ranked === null || !activityKnown ? null : String(trainedThisWeek)}
          note={ranked !== null && !activityKnown ? 'their activity did not load' : undefined}
        />
        <Kpi
          label="Average adherence"
          text={avgAdherence == null ? null : `${avgAdherence}%`}
          note={
            ranked === null ? 'nothing read yet'
              : avgAdherence == null ? 'nobody has rated a check-in yet'
              : `from ${rated.length} of ${ranked.length}`
          }
        />
        <Kpi
          label="Sessions you owe"
          text={ranked === null || !packsKnown || packTotals.holders === 0 ? null : String(packTotals.left)}
          note={
            ranked === null ? 'nothing read yet'
              : !packsKnown ? 'the packs did not load'
              : packTotals.holders === 0 ? 'nobody holds a pack from you'
              : `across ${packTotals.holders} ${packTotals.holders === 1 ? 'client' : 'clients'}`
          }
        />
      </div>

      <Section
        title="Your clients"
        sub="Sorted by who needs you first. A dash is a reading that is missing, not a client doing nothing — the reason is beside it."
      >
        {unread ? (
          <Unresolved state={unread} what="your roster" />
        ) : (
          <DataTable
            rows={ranked ?? []}
            columns={cols}
            rowKey={(r) => r.row.id}
            empty="No clients linked to you yet. A client appears here once they accept your coaching link or the gym assigns them to you."
          />
        )}
      </Section>

      <Packs packs={packs} failed={packsErr} rows={rows} />
    </Shell>
  );
}

/* ── packs ─────────────────────────────────────────────────────────────────── */

function Packs({ packs, failed, rows }: { packs: Pack[] | null; failed: boolean; rows: Row[] | null }) {
  const nameOf = (id: string | null) => {
    if (!id) return null;
    return rows?.find((r) => r.id === id)?.name ?? null;
  };

  const cols: Column<Pack>[] = [
    {
      key: 'who', header: 'Client',
      value: (p) => nameOf(p.clientId) ?? 'zzz',
      render: (p) => nameOf(p.clientId) ?? <span className="dash">— not on your roster</span>,
    },
    {
      key: 'left', header: 'Left', value: (p) => (p.total == null ? null : p.total - p.used), numeric: true,
      // A pack sold as a flat fee has no session count. Zero would say it is
      // spent; it was never counted in sessions at all.
      render: (p) => p.total == null
        ? <span className="dash">— not sold by the session</span>
        : `${Math.max(0, p.total - p.used)} of ${p.total}`,
    },
    {
      key: 'paid', header: 'Paid', value: (p) => p.amountCents, numeric: true,
      render: (p) => p.amountCents == null
        ? <span className="dash">— nothing recorded</span>
        : money(p.amountCents),
    },
    { key: 'status', header: 'Status', value: (p) => p.status },
    {
      key: 'bought', header: 'Bought', value: (p) => p.createdAt,
      render: (p) => p.createdAt
        ? new Date(p.createdAt).toLocaleDateString()
        : <span className="dash">—</span>,
    },
  ];

  return (
    <Section
      title="Packs you have sold"
      sub="Every pack bought from you, including the ones that are used up. This is the read the Sessions-left column above stands on."
    >
      {packs === null ? (
        <Unresolved state={failed ? 'failed' : 'loading'} what="your session packs" />
      ) : (
        <DataTable rows={packs} columns={cols} rowKey={(p) => p.id} empty="Nobody has bought a pack from you yet." />
      )}
    </Section>
  );
}

/* ── shared bits (the same shapes the Door screen uses) ────────────────────── */

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
      <div
        className="mono"
        style={{ fontSize: 21, marginTop: 5, letterSpacing: '-0.02em', color: text == null ? 'var(--ink3)' : 'var(--ink)' }}
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
      margin: '14px 0', padding: '11px 14px', borderRadius: 0, background: 'var(--surface)',
      border: '1px solid var(--ring)', borderLeft: `3px solid ${tone === 'crit' ? 'var(--crit)' : 'var(--brand)'}`,
      color: 'var(--ink2)', fontSize: 13,
    }}>{children}</div>
  );
}

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read must not fall through to the table's own empty line, or "we
 * could not ask" and "you have no clients" become the same sentence on screen.
 */
function Unresolved({ state, what }: { state: Exclude<Unread, null>; what: string }) {
  return (
    <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>
      {state === 'loading' ? 'Loading…' : `Could not read ${what}. The banner above says why.`}
    </div>
  );
}
