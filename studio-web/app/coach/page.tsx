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
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
// `Unresolved` comes from here rather than being declared at the bottom of
// this file. Seven console screens held a byte-identical copy, every one of
// them a plain `<div>` — so the sentence saying THIS section's rows could not
// be read was never announced. One copy, with the live region on it.
import { ConsoleGate, Unresolved } from '@/components/Gate';
import { type Unread, failure } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { readTenant, amount, NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { DataTable, type Column } from '@/components/DataTable';
import {
  isDelivered, isAwaitingOutcome, isPayable, sessionProfileIds, namesById,
  markOutcome, PAY_DELIVERED_ONLY,
  type PtSession, type SessionOutcome,
} from '@lib/gymSessions';
// `money()` is reached through lib/currency's `amount()`: a session rate has no
// currency of its own until payroll stamps one, so it inherits the gym's or is
// not written at all.
import { isoDate } from '@lib/format';
// ── whose clock this screen is on ────────────────────────────────────────
//
// This route drew every date and every time on it through `fmtDay` and
// `fmtTime` from src/lib/format.ts, which are `toLocaleDateString` /
// `getHours()` on the READER's machine. It was the last console route doing so,
// and `scripts/check-console-when.mjs` could not see it: that gate reads
// `studio-web` only, and both calls it forbids were happening one directory
// over in `src/lib`, behind a helper name.
//
// It is the worst screen in the console to have it on. A coach opens this at
// six in the morning to find out what is on TODAY and which finished sessions
// still need marking, and the day a session is bucketed into decided both. A
// gym in Dubai read from a laptop still set to London put every session before
// 04:00 on the previous day — so a 06:00 client did not appear under Today at
// all, and an unmarked session's "Waiting 2 days" was a day out on the queue
// that blocks the coach's own pay.
//
// `gymTimeText` / `gymDateText` are the house answer: the reader's locale, the
// gym's zone, and `NO_ZONE_NOTE` printed where the gym has set no zone so the
// screen never claims a clock it has not got.
import { gymDateText, gymTimeText, whoseClockNote } from '@lib/gymWhen';
import { gymDay } from '@lib/gymZone';
// Every read on this screen was a bare `.select()`. PostgREST answers an
// unbounded request with a thousand rows and says nothing (src/lib/rowCap.ts),
// and every figure on this page is a COUNT over one of them — so a coach past
// the ceiling would have been shown a smaller book with nothing to say it was
// smaller. Each of these is bounded by construction (one coach, one window, or
// a list of ids already in hand), which is the shape `readAll` is written for.
import { readAll } from '@lib/rowCap';
import { readByIds } from '@lib/idLookup';
import { COACHED_MODE_SHORT, readCoachedMode, type CoachedMode } from '@lib/types';
import { Banner } from '@/components/Banner';

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
  mode: CoachedMode;
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
  // A bounded set — one coach, one window — read to the end rather than
  // refused, because the list is what the coach came here for. The order is
  // closed on `id`: `starts_at` ties whenever two sessions start on the hour,
  // and a tied order across separate page requests can drop or repeat a row.
  const data = await readAll<any>(
    (from, to) => supabase
      .from('sessions')
      .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, rate_currency, settlement_id, pack_drawn_kind, pack_drawn_at, pack_draw_shortfall_at')
      .eq('trainer_id', trainerId)
      .gte('starts_at', sinceIso)
      .lte('starts_at', untilIso)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    'your sessions in this window',
  );

  return (data as any[]).map((r) => ({
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
    rateCurrency: r.rate_currency ?? null,
    settlementId: r.settlement_id ?? null,
    // What the CLIENT paid with (supabase/parts/370), which is not the same
    // question as the settlement beside it — that is what the gym paid the
    // coach. A shortfall is the two disagreeing.
    packDrawnKind: r.pack_drawn_kind ?? null,
    packDrawnAt: r.pack_drawn_at ?? null,
    packDrawShortfallAt: r.pack_draw_shortfall_at ?? null,
  }));
}

async function fetchMyRequests(trainerId: string): Promise<CoachRequest[]> {
  // The screen prints how many requests are waiting. A capped read makes that
  // number the cap, which reads as a queue that is under control.
  const data = await readAll<any>(
    (from, to) => supabase
      .from('coach_requests')
      .select('id, client_id, mode, status, source, via_code, created_at')
      .eq('trainer_id', trainerId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    'the coaching requests waiting for you',
  );
  return (data as any[]).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    clientName: null,
    mode: readCoachedMode(r.mode),
    source: r.source ?? null,
    viaCode: r.via_code ?? null,
    createdAt: r.created_at,
  }));
}

async function fetchMyRoster(coachId: string): Promise<Roster[]> {
  // "N clients" on this page is `rost.length`. Unbounded, that figure stops at
  // a thousand and stays there, which is a coach being told their book has
  // stopped growing.
  const data = await readAll<any>(
    (from, to) => supabase
      .from('coaching_relationships')
      .select('client_id, status, created_at')
      .eq('coach_id', coachId)
      .order('client_id', { ascending: true })
      .range(from, to),
    'your client list',
  );
  return (data as any[]).map((r) => ({
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
  // `.in()` on a list that is itself a whole window's sessions is a read with
  // no ceiling of its own: past a thousand approvals the rest come back absent,
  // and an absent approval renders exactly like a session the client has not
  // confirmed. `readByIds` chunks the id list and pages each chunk.
  const rows = await readByIds<any>(
    sessionIds,
    (chunk, from, to) => supabase
      .from('session_approvals')
      .select('session_id, approved_at, note')
      .in('session_id', chunk)
      .order('session_id', { ascending: true })
      .range(from, to),
    'which sessions your clients have confirmed',
  );
  return new Map(rows.map((r) => [r.session_id, { at: r.approved_at, note: r.note ?? null }]));
}

export default function Coach() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  // The gym's currency. A session rate has none of its own until payroll stamps
  // one, so every amount on this screen inherits the gym's or is not written.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  // "The gym has not set a currency" and "the gym record would not read" both
  // leave `ccy` null, and they send a coach to two different places: one to ask
  // the owner to fill in a setting, the other to reload. This was a
  // `no-error-ok` read while the row only supplied a sidebar label; it stopped
  // being one the moment a figure depended on it.
  const [gymErr, setGymErr] = useState<string | null>(null);
  /** `tenants.timezone`, or null when the gym has not set one — in which case
   *  every time below is the reader's own and the page says so once. */
  const [zone, setZone] = useState<string | null>(null);
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
      // no-error-ok: an unreadable name renders as a labelled dash beside a row that is still shown and still actionable
      // Chunked and paged: `[...ids]` is one entry per person named by three
      // reads, and a bare `.in()` over more than a thousand of them drops the
      // tail — which renders as a row whose person has no name rather than as
      // a lookup that ran short.
      const rows = await readByIds<{ id: string; full_name?: string | null }>(
        [...ids],
        (chunk, from, to) => supabase.from('profiles').select('id, full_name').in('id', chunk)
          .order('id', { ascending: true }).range(from, to),
        'the names on your book',
      ).catch(() => [] as Array<{ id: string; full_name?: string | null }>);
      setNames(namesById(rows));
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
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      if (!who) return;
      if (who.tenantId) {
        // `readTenant`, not a hand-written `select('name, currency')`. The
        // third column it reads is `timezone`, which this screen needs and was
        // dropping on the floor — the same three facts six other console
        // screens take from this one helper, so they cannot disagree about what
        // an unparseable zone means.
        const t = await readTenant(supabase, who.tenantId);
        if (live) {
          setGymName(t.name);
          setCcy(t.currency);
          setZone(t.zone);
          setGymErr(t.error);
        }
      }
      if (who.role !== 'trainer' && who.role !== 'owner') return;
      await load(who.id);
    })();
    return () => { live = false; };
  }, [load]);

  const now = Date.now();
  // The GYM's day, and the gym's day for each session, so both sides of the
  // comparison below are on one calendar. It was `isoDate(new Date())` against
  // `isoDate(new Date(s.startsAt))` — self-consistent, and consistently the
  // reader's, which is not the calendar a 06:00 class is on. The reader's day
  // stays the fallback where the gym has set no zone, which is what this was.
  const today = gymDay(Date.now(), zone) ?? isoDate(new Date());

  /** Everything on today, in the order it happens. Already ascending. */
  const todays = useMemo(
    () => sessions && sessions.filter(
      (s) => (gymDay(s.startsAt, zone) ?? isoDate(new Date(s.startsAt))) === today,
    ),
    [sessions, today, zone],
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

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  // Owners are let in because plenty of them still coach, and this is their own
  // book rather than the gym's. Everyone else gets a sentence, not four empty
  // tables that look like a coach with no clients.
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
      <Shell me={me} gymName={gymName} current="/coach">
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
      <h1>Your Day</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Your sessions, your clients and your requests — nobody else&apos;s.
        {me.role === 'owner' ? ' You own this gym; the gym-wide view is under Sessions.' : ''}
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}
      {gymErr ? (
        <Banner tone="crit">
          Your gym record could not be read, so any amount below is missing rather than
          unpriced — the currency it would be written in is unknown, not unset: {gymErr}
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
                : !ccy ? NO_CURRENCY_NOTE
                : `${amount(priced.cents, ccy)} across ${priced.withRate} of ${priced.payable}`
          }
        />
      </div>

      {/* Said once, at the top, rather than beside every cell. This is the
          bargain the text-only forms in src/lib/gymWhen.ts are lent on: a
          screen that draws its times with `gymTimeText` owes the reader one
          sentence saying whose clock they are. Null when the gym has set a
          zone, in which case there is nothing to admit. */}
      {/* The shared sentence, capitalised and nothing else. It already ends
          "days and hours here are your own device's, not the gym's", so a lead-in
          saying that first would say it twice — and this is the note whose whole
          value is that thirty screens word it identically. */}
      {whoseClockNote(zone) ? (
        <p style={{ color: 'var(--ink3)', fontSize: 12, margin: '0 0 14px' }}>
          {whoseClockNote(zone)!.charAt(0).toUpperCase() + whoseClockNote(zone)!.slice(1)}.
        </p>
      ) : null}

      <Unmarked
        sessions={unmarked} unread={unread(unmarked)} approvals={approvals}
        approvalsUnread={unread(approvals)} names={names} onMark={mark} zone={zone}
      />
      <Today sessions={todays} unread={unread(todays)} approvals={approvals} names={names} onMark={mark} ccy={ccy} zone={zone} />
      <Requests requests={requests} unread={unread(requests)} names={names} me={me} onChange={refresh} setErr={setErr} zone={zone} />
      <Quiet rows={quiet} unread={unread(quiet)} names={names} zone={zone} />
    </Shell>
  );
}

/* ── the queue that blocks a coach's pay ───────────────────────────────────── */

function Unmarked({ sessions, unread, approvals, approvalsUnread, names, onMark, zone }: {
  sessions: PtSession[] | null; unread: Unread;
  approvals: Map<string, Approval> | null; approvalsUnread: Unread;
  names: Map<string, string>; onMark: (s: PtSession, o: SessionOutcome) => void;
  /** `tenants.timezone` — the hour a session ran is the gym's hour. */
  zone: string | null;
}) {
  const cols: Column<PtSession>[] = [
    { key: 'when', header: 'When', value: (s) => s.startsAt,
      // Null rather than "Invalid Date": a stamp that will not parse is drawn
      // as the absence it is, which is the rule every other table here follows.
      render: (s) => {
        const d = gymDateText(s.startsAt, zone, { weekday: 'short', day: 'numeric', month: 'short' });
        const t = gymTimeText(s.startsAt, zone, { hour: '2-digit', minute: '2-digit' });
        return d && t ? `${d} · ${t}` : <span className="dash">a time that could not be read</span>;
      } },
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
        return (
          <span title={a.note ?? undefined}>
            {gymDateText(a.at, zone, { weekday: 'short', day: 'numeric', month: 'short' })
              ?? <span className="dash">a date that could not be read</span>}
            {a.note ? ' · note' : ''}
          </span>
        );
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
        <DataTable noun="unmarked sessions"
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

function Today({ sessions, unread, approvals, names, onMark, ccy, zone }: {
  sessions: PtSession[] | null; unread: Unread;
  approvals: Map<string, Approval> | null;
  names: Map<string, string>; onMark: (s: PtSession, o: SessionOutcome) => void;
  ccy: TenantCurrency;
  /** `tenants.timezone` — a class at six is six on the gym's wall, wherever
   *  the coach is reading this. */
  zone: string | null;
}) {
  const now = Date.now();

  const cols: Column<PtSession>[] = [
    { key: 'at', header: 'At', value: (s) => s.startsAt,
      render: (s) => gymTimeText(s.startsAt, zone, { hour: '2-digit', minute: '2-digit' })
        ?? <span className="dash">not stated</span> },
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
        ? (gymTimeText(approvals.get(s.id)!.at, zone, { hour: '2-digit', minute: '2-digit' })
            ?? <span className="dash">confirmed, at a time that could not be read</span>)
        : <span className="dash">{approvals === null ? 'not checked' : 'not yet'}</span>) },
    { key: 'paid', header: 'Rate', value: (s) => s.rateCents ?? -1, numeric: true,
      // A session with no rate stamped on it is not a free session. It is one
      // payroll will price from the gym's fee later.
      render: (s) => s.rateCents == null
        ? <span className="dash">set at payroll</span>
        : (amount(s.rateCents, ccy) ?? <span className="dash">{NO_CURRENCY_NOTE}</span>) },
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
        <DataTable noun="sessions today"
          rows={sessions ?? []} columns={cols} rowKey={(s) => s.id}
          empty="Nothing booked with you today."
        />
      )}
    </Section>
  );
}

/* ── people asking to be coached by you ────────────────────────────────────── */

function Requests({ requests, unread, names, me, onChange, setErr, zone }: {
  requests: CoachRequest[] | null; unread: Unread; names: Map<string, string>;
  me: Me; onChange: () => void; setErr: (s: string | null) => void;
  /** `tenants.timezone` — the day somebody asked is the gym's day. */
  zone: string | null;
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
        if (linkErr) {
          setMsg(writeFailedText(linkErr, {
            what: 'Accepting that request',
            unchanged: 'nothing was changed and they are not on your roster',
            howToCheck: 'Reload this page and read whether they appear on your roster before accepting again.',
          }));
          setBusy(null);
          return;
        }

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

      // The rows changed are counted, not just `error` — see src/lib/wroteRows.ts.
      // `coach_requests_trainer_u` is `trainer_id = auth.uid()` and PostgREST
      // reports an update filtered away by a policy as a plain success with
      // nothing changed. A request the client withdrew while this board was
      // open matches nothing in exactly the same way. Either way the coach read
      // "Added to your roster." and the request was still sitting there
      // unanswered the next time they looked — and on an accept the link and
      // the roster row HAD been written, so the two halves disagreed.
      const { error, count } = await supabase.from('coach_requests')
        .update(
          { status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() },
          { count: 'exact' },
        )
        .eq('id', r.id);
      if (error) { setMsg(error.message); setBusy(null); return; }
      if (count !== 1) {
        setMsg(
          accept
            ? 'They are linked to you and on your roster, but the request itself was not marked answered — the server matched no row, so it may have been withdrawn. Reload before answering it again.'
            : 'That request was not declined — the server matched no row, so it may already have been withdrawn or answered elsewhere.',
        );
        setBusy(null);
        return;
      }

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
      render: (r) => COACHED_MODE_SHORT[r.mode] },
    { key: 'via', header: 'Came from', value: (r) => r.source ?? '',
      render: (r) => {
        if (r.source === 'code') return r.viaCode ? <span className="mono">{r.viaCode}</span> : 'your code';
        if (r.source === 'directory') return 'the directory';
        // Rows written before anything recorded a source. Guessing one would
        // make invented history indistinguishable from measured history.
        return <span className="dash">not recorded</span>;
      } },
    { key: 'when', header: 'Asked', value: (r) => r.createdAt,
      render: (r) => gymDateText(r.createdAt, zone, { weekday: 'short', day: 'numeric', month: 'short' })
        ?? <span className="dash">not stated</span> },
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
      {/* Announced — `msg` here is the answer to Accept or Decline, including
          the one that says the request was NOT marked answered. */}
      {msg ? <p role="alert" aria-live="assertive" aria-atomic="true" style={{ margin: 14, fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
      {unread ? <Unresolved state={unread} what="the coaching requests" /> : (
        <DataTable noun="requests"
          rows={requests ?? []} columns={cols} rowKey={(r) => r.id}
          empty="Nobody is waiting on an answer."
        />
      )}
    </Section>
  );
}

/* ── who has stopped turning up ────────────────────────────────────────────── */

interface QuietRow extends Roster { lastAt: string | null; daysSince: number | null }

function Quiet({ rows, unread, names, zone }: {
  rows: QuietRow[] | null; unread: Unread; names: Map<string, string>;
  /** `tenants.timezone` — the day of a last delivered session is the gym's. */
  zone: string | null;
}) {
  const cols: Column<QuietRow>[] = [
    { key: 'who', header: 'Client', value: (r) => names.get(r.clientId) ?? 'zzz',
      render: (r) => names.get(r.clientId) ?? <span className="dash">name not readable</span> },
    { key: 'last', header: 'Last delivered', value: (r) => r.lastAt ?? '',
      render: (r) => r.lastAt
        ? (gymDateText(r.lastAt, zone, { weekday: 'short', day: 'numeric', month: 'short' })
            ?? <span className="dash">a date that could not be read</span>)
        // Not "never". This screen looked back sixty days and found nothing;
        // whether they trained before that is a question it did not ask.
        : <span className="dash">none in {WINDOW_DAYS} days</span> },
    { key: 'gap', header: 'Days', value: (r) => r.daysSince, numeric: true,
      render: (r) => r.daysSince == null
        ? <span className="dash">—</span>
        : String(r.daysSince) },
    { key: 'since', header: 'On your book since', value: (r) => r.since,
      render: (r) => gymDateText(r.since, zone, { weekday: 'short', day: 'numeric', month: 'short' })
        ?? <span className="dash">not stated</span> },
  ];

  return (
    <Section
      title="Gone quiet"
      sub={`Clients on your book with no session you have marked delivered in the last ${QUIET_DAYS} days. A booked-but-unmarked session does not count as training — which is the point.`}
    >
      {unread ? <Unresolved state={unread} what="your client list" /> : (
        <DataTable noun="clients gone quiet"
          rows={rows ?? []} columns={cols} rowKey={(r) => r.clientId}
          empty="Everyone on your book has trained recently."
        />
      )}
    </Section>
  );
}

/* ── shared bits (the same shapes as Door and Sessions) ────────────────────── */

const field = {
  padding: '9px 11px', borderRadius: 0, fontSize: 13.5,
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
        border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)',
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

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read falling through to the table's own empty line would make "we
 * could not ask" and "you have none" the same sentence — and on the unmarked
 * queue that sentence costs the coach money.
 */

