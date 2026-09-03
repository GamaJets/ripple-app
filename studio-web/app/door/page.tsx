'use client';

// Door — who is in the building, who came in today, and the passes taken at
// the desk.
//
// This is the one console screen a trainer sees as well as an owner, because
// working the door is a staff job. It is a capture screen before it is a
// reporting one: until visits are recorded, attendance is only ever the subset
// of people who booked a class, and retention is inferred from a number that
// is missing most of its input.
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { supabase, writeFailed, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
// The reader's locale, the GYM's zone. This screen lives at a front desk, where
// the two are usually the same clock — and it is also the screen an owner opens
// from another country, where they are not, and where "today" deciding whether
// a pass is still good makes the difference a member is turned away over.
import { gymDateTimeText, gymTimeText } from '@lib/gymWhen';
import { gymDay, parseGymZone } from '@lib/gymZone';
// `Unresolved` comes from here rather than being declared at the bottom of
// this file. Seven console screens held a byte-identical copy, every one of
// them a plain `<div>` — so the sentence saying THIS section's rows could not
// be read was never announced. One copy, with the live region on it.
import { ConsoleGate, Unresolved } from '@/components/Gate';
import { type Unread, failure } from '@/lib/read';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { Banner as SharedBanner, Announce } from '@/components/Banner';
import {
  fetchVisits, checkIn, checkOut, summariseVisits, dwellMinutes,
  sweepStaleVisits, isAccountedFor, currentlyInside, duplicateOpenVisits,
  busiestSlots, visitsByHour, visitsByWeekday, averageDwellMinutes,
  admissionCheck, doorAdmission, wasOverridden, OVERRIDE_PREFIX,
  readPending, addPending, dropPending, partitionPending, pendingNote, pendingKey,
  WEEKDAYS,
  type Visit, type Admission, type PendingDoorWrite,
} from '@lib/gymVisits';
import { searchRows } from '@lib/consoleSearch';
// The number the member is holding up. src/lib/memberLookup.ts says at length
// why this could not be done with a fifth search field.
import {
  findByMemberNo, scanNote, memberNoFor, type RosterState,
} from '@lib/memberLookup';
import { wrote, refused as sayRefused, sayText, sayTone, type Said } from '@lib/consoleSay';
import {
  fetchPasses, fetchPassTypes, issuePass, redeemPass,
  summarisePasses, passStatus, remainingUses, passBlocker, spendable,
  // The other half of the pass ledger. `redeemPass` has been wired since the
  // desk existed and these two were called by nothing, so a visit taken off the
  // wrong person's pass could not be put back by anybody, anywhere in the
  // product — the one mistake a front desk actually makes.
  fetchRedemptions, undoRedemption, redemptionUndoBlocker,
  type GymPass, type PassType, type Redemption,
} from '@lib/gymPasses';
import { fetchMemberRecords, byMember, contactLine, type GymMemberRecord } from '@lib/gymMembers';
import { buildRollCall, rollCallHtml, emergencyLine } from '@lib/rollCall';
import { fetchMemberships, money, type Membership } from '@lib/gymRecord';
import { fetchClasses, type GymClass } from '@lib/gymSchedule';
import { isoDate } from '@lib/format';

const DAY = 86400000;

/**
 * How often the door log is re-read while somebody is looking at it.
 *
 * Thirty seconds. Short enough that two desks agree about who is in the
 * building before either of them has finished serving the next person, long
 * enough that a tablet propped by the door is not one query per second for
 * twelve hours.
 */
const REFRESH_MS = 30_000;

/**
 * How far either side of now a class is offered as the reason for a visit.
 *
 * `gym_visits.class_id` is what makes a class attendance and a floor visit
 * distinguishable in one table, and the desk is the only place that knows
 * which it is. The window is deliberately wide enough for the person who
 * arrives early to change and the one who stays behind to stretch, and narrow
 * enough that a busy timetable does not offer eleven classes: attaching a
 * visit to the WRONG class is worse than leaving it on the floor, because the
 * floor is at least true.
 */
const CLASS_WINDOW_MIN = 90;

/**
 * What a piece of state is when it is still null: a read in flight, or one that
 * came back refused. Null itself is the answer "ok, this read returned".
 *
 * The two have to look different on screen. "Loading…" that never resolves and
 * "No visits logged today" are both lies about a query that errored, and staff
 * act on both of them — one by waiting, the other by telling the owner the gym
 * was empty this morning.
 */

/**
 * The calendar day a visit belongs to, at the GYM.
 *
 * It said "in the gym's own timezone" and was `isoDate(new Date(iso))`, which is
 * the READER's. At a front desk those are the same clock and the comment was
 * true of the machine it was written on; opened from anywhere else it is the
 * reader's midnight that rolls the day over, and the four hours either side of
 * it are visits filed on the wrong day and passes refused a day early.
 *
 * The reader's day stays as the fallback for a gym that has not set a zone,
 * because then it is the only clock there is.
 */
const dayOf = (iso: string, zone: string | null) => gymDay(iso, zone) ?? isoDate(new Date(iso));

/** An id for a queued arrival. `crypto.randomUUID` where the browser has it,
 *  and something unique enough where it does not — this only has to tell one
 *  desk's own held rows apart. */
function newId(): string {
  try {
    const c = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch { /* falls through */ }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Whether this failure was the network rather than the gym.
 *
 * The distinction decides whether an arrival is HELD or reported, and getting
 * it wrong in either direction is bad: a refused write held forever retries an
 * answer that will not change, and a dropped connection reported as a refusal
 * loses the person who walked in. supabase-js surfaces a fetch failure as a
 * TypeError with no status, so the test is "the browser says it is offline, or
 * the failure carries no answer from the server at all".
 */
function isOffline(e: any): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (e?.status != null || e?.code != null) return false;
  const m = String(e?.message ?? '').toLowerCase();
  return m.includes('failed to fetch') || m.includes('networkerror')
    || m.includes('network request failed') || m.includes('load failed');
}


export default function Door() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [passes, setPasses] = useState<GymPass[] | null>(null);
  const [types, setTypes] = useState<PassType[] | null>(null);
  const [members, setMembers] = useState<Membership[] | null>(null);
  // The classes running around now, so a check-in can name the one it is
  // attendance at. Null on a refused read, like every other state here: an
  // empty picker that says "gym floor only" is a claim about the timetable.
  const [classes, setClasses] = useState<GymClass[] | null>(null);
  /**
   * What the gym itself knows about the people in the building: the next of
   * kin, and the note the desk wrote for the floor.
   *
   * This screen read five tables and not this one, while /members and /passes
   * both read it — so the asthma note and the emergency number were visible on
   * the two screens an owner opens sitting down, and invisible on the one
   * screen that is used with a person standing in front of it. Somebody goes
   * over on the floor at nine on a Sunday and the trainer at the desk has the
   * roll call, the arrival time, and no way to ring anybody.
   *
   * Null is "not read or refused", never an empty Map — an emergency contact
   * that did not load must never read as a member who has none.
   */
  const [records, setRecords] = useState<Map<string, GymMemberRecord> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    // allSettled, not all: one failing read must not take the others with it.
    // Under Promise.all a refused gym_passes query also emptied the other three
    // — the visits table said "No visits logged today" on a morning that had
    // visits, and the check-in dropdown lost every member — so one broken query
    // produced three wrong facts and the banner named none of them.
    const now = Date.now();
    const [vRes, pRes, tRes, mRes, cRes, rRes] = await Promise.allSettled([
      fetchVisits(supabase, tenantId, { sinceIso: new Date(now - 30 * DAY).toISOString() }),
      fetchPasses(supabase, tenantId),
      fetchPassTypes(supabase, tenantId),
      fetchMemberships(supabase, tenantId),
      fetchClasses(
        supabase, tenantId,
        new Date(now - CLASS_WINDOW_MIN * 60_000).toISOString(),
        new Date(now + CLASS_WINDOW_MIN * 60_000).toISOString(),
      ),
      // Sixth, and settled beside the others rather than after them: a gym that
      // has not applied supabase/parts/197 has no such table, and one refused
      // read must take nothing else down with it.
      fetchMemberRecords(supabase, tenantId),
    ]);

    // A read that failed is null, never []. [] is the gym saying it has none;
    // null is nobody knowing. Staff act differently on the two.
    setVisits(vRes.status === 'fulfilled' ? vRes.value : null);
    setPasses(pRes.status === 'fulfilled' ? pRes.value : null);
    setTypes(tRes.status === 'fulfilled' ? tRes.value : null);
    setMembers(mRes.status === 'fulfilled' ? mRes.value : null);
    setClasses(cRes.status === 'fulfilled' ? cRes.value : null);
    setRecords(rRes.status === 'fulfilled' ? byMember(rRes.value) : null);

    // Surfaced rather than swallowed: a door screen that silently fails to read
    // is worse than one that says so, because staff will keep using it. Each
    // failure is named, because "could not read" without saying which query
    // broke leaves the desk unable to tell the owner what is down.
    const trouble = [
      failure(vRes, 'the door log'),
      failure(pRes, 'the passes'),
      failure(tRes, 'the pass types'),
      failure(mRes, 'the member list'),
      failure(cRes, 'the classes running now'),
      // Named apart from the rest, because the consequence is not a figure: a
      // desk that cannot read this has no next-of-kin number for anybody in the
      // building and has to be told so rather than shown a blank column.
      failure(rRes, 'the gym’s notes on your members — no next of kin and no medical note can be shown'),
    ].filter((s): s is string => s !== null);
    setErr(trouble.length === 0 ? null : trouble.join(' · '));
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
      if (!who?.tenantId) {
        setVisits([]); setPasses([]); setTypes([]); setMembers([]); setClasses([]);
        setRecords(new Map());
        return;
      }
      // no-error-ok: the gym's name is a header label; without it the header is blank and every figure below is unaffected
      const { data: t } = await supabase.from('tenants').select('name, timezone').eq('id', who.tenantId).single();
      if (live) {
        setGymName(t?.name ?? null);
        const z = parseGymZone((t as any)?.timezone);
        setZone(z.kind === 'zone' ? z.zone : null);
      }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  /**
   * Re-read the door log on a timer, when the tab comes back, and when the
   * gym's own day rolls over.
   *
   * ── Why a screen that never refreshed was wrong on both tablets ─────────
   *
   * Everything below was computed from a snapshot taken when the page loaded.
   * With two people working the desk, each tablet saw only its own check-ins,
   * so "Inside now" was wrong on both — and the one figure on this screen
   * somebody would read out during an evacuation is that one. Neither desk had
   * any way to know it was looking at a stale number, because a stale number
   * looks exactly like a current one.
   *
   * ── And the tablet nobody turns off ────────────────────────────────────
   *
   * `today` is computed once per render pass, so a tablet left on overnight
   * kept yesterday's date and showed yesterday's arrivals as this morning's:
   * a desk opening up at 6am read a busy screen and a full "Inside now" for a
   * building that was empty. `dayTick` below moves with the gym's own local
   * midnight rather than UTC's, so the rollover happens when the gym's day
   * does — the same date this screen already compares every visit against.
   *
   * A poll rather than a realtime channel: nothing else in this console
   * subscribes, the door log is small, and a thirty-second read that always
   * arrives is worth more at a front desk than a socket that silently drops.
   */
  /** `tenants.timezone`, or null when the gym has not set one. */
  const [zone, setZone] = useState<string | null>(null);
  // reader-day-ok: `dayTick` is not a "today" anybody reads — it is a REPAINT
  // clock. Its only job is to change value when the machine with the tab open
  // crosses midnight, so a tablet nobody has touched since yesterday re-renders;
  // the day that is actually compared against is `gymDay(Date.now(), zone) ??
  // dayTick` sixty lines below, which asks the gym first.
  const [dayTick, setDayTick] = useState(() => isoDate(new Date()));
  useEffect(() => {
    if (!me?.tenantId) return;
    if (me.role !== 'owner' && me.role !== 'trainer') return;
    const tenantId = me.tenantId;
    let stopped = false;

    const tick = () => {
      // The day first, so a rollover repaints even if the read is in flight.
      // reader-day-ok: the repaint clock again — see `dayTick` above.
      const d = isoDate(new Date());
      setDayTick((prev) => (prev === d ? prev : d));
      if (document.visibilityState === 'hidden') return;
      if (stopped) return;
      void load(tenantId);
    };

    const every = window.setInterval(tick, REFRESH_MS);
    // A tablet that was asleep for an hour is the worst case, not the best:
    // coming back to the tab is exactly when the snapshot is furthest out.
    const onShow = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      stopped = true;
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [me, load]);

  /**
   * The writes this machine is holding because the network would not take them.
   *
   * Created here rather than inside a section, because both the check-in bar
   * and the Inside table put things in it and a hook cannot live behind the
   * role gates below. The tenant is '' until `loadMe` answers, which holds
   * nothing and flushes nothing.
   */
  const reload = useCallback(() => { if (me?.tenantId) void load(me.tenantId); }, [me, load]);
  const queue = useDoorQueue(me?.tenantId ?? '', reload);

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/door">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner' && me.role !== 'trainer') {
    return (
      <Shell me={me} gymName={gymName} current="/door">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>The door log is for gym staff.</p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId);

  // The gym's own calendar day, not UTC's. This product sells in AED, so the
  // desk that reads this is four hours ahead of UTC and the UTC date does not
  // turn over until 04:00 local: every 6am arrival was filed under yesterday,
  // and "Visits today", "Members today" and "Busiest hour" each opened the
  // morning already short. The same date decides a pass expiry, so a pass good
  // "to the 3rd" was refused at the desk for the four hours either side of
  // local midnight. One date, and every "today" below is compared against it.
  // `dayTick` rather than a bare `new Date()`: the value is identical, and
  // holding it in state is what makes the rollover happen on a screen nobody
  // has touched since yesterday.
  // Recomputed from `dayTick` rather than used as it stands, so the rollover
  // that `dayTick` schedules still repaints while the DAY it names is the gym's.
  // `dayTick` alone is the reader's date, which is what every "today" on this
  // screen was being compared against.
  const today = gymDay(Date.now(), zone) ?? dayTick;
  const todays = (visits ?? []).filter((v) => dayOf(v.enteredAt, zone) === today);

  // "Inside now" means today, the same thing the Overview tile means by "In the
  // building". Over the 30-day window it meant "no exit recorded at any point
  // in the last month" — and because the overnight sweep deliberately writes
  // only a note and leaves exited_at null, every abandoned check-in stayed in
  // that count forever. The tile crept upward all month and the two screens
  // disagreed. Visits left open from earlier days are counted separately and
  // said out loud: nobody is standing in the gym from Tuesday.
  // `currentlyInside` rather than a hand-rolled filter, so the Door and every
  // other reader of the door log agree on what "inside" means. It had no caller
  // anywhere in the repository until now — the definition existed, was tested,
  // and every screen re-implemented it.
  const inside = currentlyInside(todays);
  // The second and third open rows for somebody who is already in the list
  // above. `currentlyInside` folds them so the headcount is people rather than
  // scans; they are counted here so a desk that is double-scanning finds out.
  const dupes = duplicateOpenVisits(todays);
  const openBefore = (visits ?? []).filter((v) => !v.exitedAt && dayOf(v.enteredAt, zone) !== today);
  // Of those, the ones a sweep has already accounted for. Two different things
  // for the desk: "nobody has looked at these" and "these are known to be
  // people who left without scanning out".
  const sweptBefore = openBefore.filter(isAccountedFor);

  const sum = visits ? summariseVisits(todays) : null;
  const pSum = passes ? summarisePasses(passes, today) : null;

  // err is only ever set by a finished load, so a state still null once it is
  // set is a read that was refused rather than one still in flight.
  const unread = (rows: unknown[] | null): Unread => (rows !== null ? null : err ? 'failed' : 'loading');
  // The same three states for the one read that comes back as a Map. A blank
  // emergency column has to say whether it is empty or unknown.
  const recordsUnread: Unread = records !== null ? null : err ? 'failed' : 'loading';

  return (
    <Shell me={me} gymName={gymName} current="/door">
      <h1>Door</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        Every visit, not just the booked ones. A member who trains on the floor
        counts the same as one who books a class.
      </p>

      {err ? <Banner tone="crit">{err}</Banner> : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        <Kpi
          label="Inside now"
          text={visits ? String(inside.length) : null}
          note={openBefore.length > 0 ? `${openBefore.length} left open on an earlier day` : undefined}
        />
        <Kpi label="Visits today" text={sum ? String(sum.visits) : null}
             note={sum && sum.anonymous > 0 ? `${sum.anonymous} not identified` : undefined} />
        <Kpi label="Members today" text={sum ? String(sum.uniqueMembers) : null} />
        <Kpi
          label="Average stay"
          text={sum?.averageDwell == null ? null : `${sum.averageDwell} min`}
          note={
            sum == null ? undefined
              : sum.averageDwell == null ? 'no exits recorded yet'
              : `from ${sum.dwellFrom} of ${sum.visits}`
          }
        />
        <Kpi
          label="Busiest hour"
          text={sum?.peak ? `${String(sum.peak.hour).padStart(2, '0')}:00` : null}
          note={sum?.peak ? `${sum.peak.visits} in` : 'nothing logged today'}
        />
      </div>

      <CheckInBar
        members={members} passes={passes} classes={classes} visits={visits}
        records={records} tenantId={tenantId}
        membersUnread={unread(members)} classesUnread={unread(classes)}
        recordsUnread={recordsUnread}
        today={today} zone={zone} queue={queue} gymName={gymName} onChange={refresh}
      />
      <Inside
        inside={inside} openBefore={openBefore.length} swept={sweptBefore.length}
        duplicates={dupes.length}
        records={records} recordsUnread={recordsUnread} gymName={gymName}
        unread={unread(visits)} tenantId={tenantId} isOwner={me.role === 'owner'}
        queue={queue} zone={zone} onChange={refresh}
      />
      <Today visits={todays} unread={unread(visits)} zone={zone} />
      {/* Thirty days rather than today, because "when is my gym busy" is not a
          question about today. The window is the same one `load()` reads, so
          nothing here needs a second query. */}
      <Occupancy visits={visits} unread={unread(visits)} days={30} />
      <Passes
        passes={passes} types={types} members={members} summary={pSum}
        passesUnread={unread(passes)} typesUnread={unread(types)}
        tenantId={tenantId} today={today} zone={zone} me={me} gymName={gymName} onChange={refresh}
      />
    </Shell>
  );
}

/* ── the writes this desk is holding ───────────────────────────────────────── */

/** What the queue offers the two sections that use it. */
interface DoorQueue {
  pending: PendingDoorWrite[];
  lapsed: PendingDoorWrite[];
  /** False when this browser will not store anything, so nothing can be held. */
  queueRead: boolean;
  flushing: boolean;
  /** Hold one write. The moment it happened is the caller's, never the flush's. */
  hold: (item: Omit<PendingDoorWrite, 'id' | 'queuedAt' | 'tries' | 'refusedWhy'>) => void;
  flush: () => void;
  drop: (id: string) => void;
  dismissLapsed: () => void;
  /** Told the item is now on the record by some other route — the desk pressing
   *  "Record it anyway" — so it leaves the queue. */
  settled: (id: string) => void;
}

/**
 * The arrivals AND departures this machine is holding because the network would
 * not take them.
 *
 * The entire failure path here used to be one line of message text: nothing
 * written down, nothing retried, and the next arrival cleared it. Every person
 * who came in during a two-minute wifi drop was permanently absent from the
 * record, and the only trace was a toast the receptionist had already
 * dismissed. The rules — what may be held, for how long, and what happens to
 * one the gym's own record refuses — are in src/lib/gymVisits.ts; this is the
 * part that keeps them on the machine and sends them.
 *
 * ── Why it is a hook rather than state inside the check-in bar ────────────
 *
 * Because the outage does not know which section of the screen you are looking
 * at. Arrivals were queued and CHECK-OUTS were not: the same dropped connection
 * that was carefully survived at the top of the page answered "Could not check
 * that visit out" at the bottom of it and lost the departure — leaving the
 * person in Inside now, in the evacuation headcount, and out of the average
 * stay. One queue, in arrival order, owned above both sections and rendered in
 * the one place a desk already looks for it.
 */
function useDoorQueue(tenantId: string, onChange: () => void): DoorQueue {
  const [pending, setPending] = useState<PendingDoorWrite[]>([]);
  const [queueRead, setQueueRead] = useState(true);
  const [lapsed, setLapsed] = useState<PendingDoorWrite[]>([]);
  const [flushing, setFlushing] = useState(false);

  const store = useCallback((list: PendingDoorWrite[]) => {
    setPending(list);
    try { window.localStorage.setItem(pendingKey(tenantId), JSON.stringify(list)); }
    // A browser that refuses to store — private mode, a full quota — must not
    // take the check-in down with it. The row is still being sent; what is lost
    // is the retry, and the sentence below says so.
    catch { setQueueRead(false); }
  }, [tenantId]);

  useEffect(() => {
    // No gym yet — `loadMe` has not answered. There is nothing to read and, more
    // to the point, nothing may be written under a key that is not a gym's.
    if (!tenantId) return;
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(pendingKey(tenantId)); } catch { setQueueRead(false); return; }
    const { items, read } = readPending(raw);
    setQueueRead(read);
    // Split on the way in rather than on the way out: an arrival from last
    // night written into this morning's log would put a stranger in "Inside
    // now" and a phantom into the busiest hour. What lapsed is handed to the
    // screen rather than binned, because a queue that loses things quietly is
    // the thing this whole section exists to replace.
    const { live, lapsed: gone } = partitionPending(items);
    setPending(live);
    setLapsed(gone);
    if (gone.length) {
      try { window.localStorage.setItem(pendingKey(tenantId), JSON.stringify(live)); } catch { /* said below */ }
    }
  }, [tenantId]);

  const hold: DoorQueue['hold'] = useCallback((item) => {
    store(addPending(pending, { ...item, id: newId(), queuedAt: Date.now(), tries: 1, refusedWhy: null }));
  }, [pending, store]);

  /**
   * Send what is waiting.
   *
   * Run when the browser says the connection is back and after every successful
   * write, because a desk that has just written a row is a desk that can reach
   * the server. One at a time and in the order the morning happened, so the log
   * reads the way the morning did.
   *
   * An item the gym's own record REFUSES is not retried into oblivion: the
   * answer will not change, so the reason is stored on it and the desk is asked.
   * An item the network refuses is left exactly as it is.
   */
  const flush = useCallback(async () => {
    if (flushing) return;
    const { live, lapsed: gone } = partitionPending(pending);
    if (gone.length) setLapsed((l) => [...l, ...gone]);
    if (!live.length) { if (gone.length) store(live); return; }
    setFlushing(true);
    let list = live;
    for (const item of live) {
      if (item.refusedWhy) continue;
      try {
        if (item.kind === 'out') {
          // The minute they LEFT, not the minute the connection came back. A
          // departure stamped at the flush would put a two-hour stay on a
          // twenty-minute visit with nothing afterwards to see it by.
          // `checkOut` only closes a visit that is still open, so this cannot
          // overwrite a departure the other desk recorded meanwhile — it
          // matches nothing, and that is reported as a refusal rather than
          // swallowed.
          await checkOut(supabase, item.visitId!, item.atIso);
        } else {
          await checkIn(supabase, item.tenantId, {
            memberId: item.memberId,
            passId: item.passId,
            classId: item.classId,
            enteredAtIso: item.atIso,
            source: 'desk',
          });
        }
        list = dropPending(list, item.id);
      } catch (e: any) {
        if (e?.name === 'AdmissionRefused') {
          list = list.map((i) => i.id === item.id
            ? { ...i, tries: i.tries + 1, refusedWhy: e.message ?? 'The gym’s record refused it.' }
            : i);
        } else if (isOffline(e)) {
          // Still down. Stop rather than hammer, and keep the rest in order.
          list = list.map((i) => i.id === item.id ? { ...i, tries: i.tries + 1 } : i);
          break;
        } else {
          list = list.map((i) => i.id === item.id
            ? { ...i, tries: i.tries + 1, refusedWhy: e?.message ?? 'That was refused.' }
            : i);
        }
      }
    }
    store(list);
    setFlushing(false);
    onChange();
  }, [flushing, pending, store, onChange]);

  useEffect(() => {
    const back = () => { void flush(); };
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [flush]);

  return {
    pending, lapsed, queueRead, flushing,
    hold,
    flush: () => { void flush(); },
    // The same removal under two names, because they are two different facts at
    // the call site: one is "the desk has decided this will never be written",
    // the other is "it is on the record now, by another route".
    drop: (id: string) => store(dropPending(pending, id)),
    settled: (id: string) => store(dropPending(pending, id)),
    dismissLapsed: () => setLapsed([]),
  };
}

/* ── check-in ──────────────────────────────────────────────────────────────── */

function CheckInBar({ members, passes, classes, visits, records, tenantId, membersUnread, classesUnread, recordsUnread, today, zone, queue, gymName, onChange }: {
  members: Membership[] | null; passes: GymPass[] | null; classes: GymClass[] | null;
  visits: Visit[] | null;
  records: Map<string, GymMemberRecord> | null;
  tenantId: string;
  membersUnread: Unread; classesUnread: Unread; recordsUnread: Unread;
  /** `tenants.name`, for drawing a member's own number beside their name in
   *  the picker. Never used to match one. */
  gymName: string | null;
  today: string;
  /** `tenants.timezone`, or null when the gym has not set one. Every clock on
   *  this screen is drawn on it. */
  zone: string | null;
  queue: DoorQueue;
  onChange: () => void;
}) {
  const [memberId, setMemberId] = useState('');
  /**
   * What paid for this visit, as one value the desk picks.
   *
   * `''` is the gym floor. `pass:<id>` and `class:<id>` are the two things
   * `gym_visits` has a column for and has never been given: 32-door-log.sql
   * added `pass_id` and `class_id` in the same breath as the comment "so the
   * two records reconcile instead of double counting the same person", and
   * this console wrote neither. The consequences were all silent — /members
   * printed "gym floor" against every console visit including the ones that
   * were plainly a booked class, a pass and its visit could not be reconciled
   * so the same person counted twice, and nothing could tell class attendance
   * from floor attendance in the one table built to hold both.
   *
   * One control rather than two, because they are alternatives: a visit is
   * paid for by a pass or it is attendance at a class. A pass taken AT a class
   * is redeemed from the Passes table below, which writes both.
   */
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Said>(null);
  /**
   * The refusal the desk is looking at, and the sentence that would let this
   * person in anyway.
   *
   * A refusal with no way through is not a safer door, it is a desk that stops
   * using the console: the member renewing at the counter, the member whose
   * payment cleared this morning and the member the owner has waved through are
   * all real, and every visit that goes unrecorded takes attendance, fill rate
   * and the retention reading down with it. So the override is one line of
   * typing, and what is typed is written onto the visit — the row itself then
   * carries why it exists, which is the only thing that makes it auditable
   * afterwards.
   */
  const [refused, setRefused] = useState<Admission | null>(null);
  const [why, setWhy] = useState('');

  /* The passes held by the person selected that may actually pay for coming in.
   * Keyed on `holderId`, which is the whole reason A1 had to be fixed first: a
   * pass issued with only a `holderName` belongs to nobody and can never appear
   * here.
   *
   * `spendable` rather than `passStatus === 'live'`: a live pass is not the
   * same thing as a pass that pays for a VISIT. This list offered the member's
   * personal-training block as a way through the door, and picking it spent an
   * hour with a coach on a walk to the treadmill. What a pass is good for is on
   * the row — /members has printed it in a column all along. */
  const theirPasses = (passes ?? []).filter(
    (p) => !!memberId && p.holderId === memberId && spendable(p, 'visit', today),
  );
  /* Their PT credits, which are deliberately NOT offered above and are named
   * underneath instead, so the desk knows the member holds something and knows
   * it is not for this. */
  const theirPtPasses = (passes ?? []).filter(
    (p) => !!memberId && p.holderId === memberId && p.covers === 'pt' && passStatus(p, today) === 'live',
  );
  /* What the floor would need to know if this person went over, and who to
   * ring. On screen while they are being selected rather than hunted for
   * afterwards. */
  const theirRecord = memberId ? records?.get(memberId) ?? null : null;

  // Soonest first, so the class about to start is the first thing in the list
  // rather than the one that finished an hour ago.
  const nearby = [...(classes ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  /**
   * What the gym's own record says about the person at the desk, worked out
   * before anybody presses anything.
   *
   * The authoritative check is inside `checkIn`, which reads the database at
   * the moment of the write — this cannot be the gate, because it is computed
   * from a snapshot and from a member list that may have been refused. It is
   * here so the answer arrives while the member is being selected rather than
   * after a button press: a receptionist who is told "cancelled" before they
   * click has a conversation, and one who is told afterwards has an argument.
   */
  const preview = useMemo<Admission | null>(() => {
    if (!memberId) return null;
    return admissionCheck({
      memberId,
      passId: reason.startsWith('pass:') ? reason.slice(5) : null,
      // Null when the read was refused, never []. `admissionCheck` says
      // "unknown" for the first and "no membership at all" for the second, and
      // telling a paying member the gym has no record of them because a query
      // failed is the worse of the two by a distance.
      memberships: members === null
        ? null
        : members.filter((m) => m.memberId === memberId).map((m) => ({ status: m.status, endsOn: m.endsOn })),
      recent: (visits ?? [])
        .filter((v) => v.memberId === memberId)
        .map((v) => ({ enteredAt: v.enteredAt, exitedAt: v.exitedAt })),
      today,
    });
  }, [memberId, reason, members, visits, today]);

  // A pass belongs to its holder, so changing who is at the desk must not leave
  // somebody else's pass selected. Silently keeping it would take a visit off
  // the wrong person's pass — a real entitlement, spent on somebody else.
  const pickMember = (id: string) => {
    setMemberId(id);
    if (reason.startsWith('pass:')) setReason('');
    // A refusal belongs to the person it was about. Leaving it on screen while
    // the next member is selected would offer an override against somebody
    // else's record.
    setRefused(null); setWhy('');
  };

  const record = async (overrideReason: string | null) => {
    setBusy(true); setMsg(null);
    const passId = reason.startsWith('pass:') ? reason.slice(5) : null;
    const classId = reason.startsWith('class:') ? reason.slice(6) : null;
    // Stamped here, once, and carried through both the write and the queue. A
    // queued arrival that took its time from the flush would land a 06:02 entry
    // in the log at 06:47, and the busiest hour, the average stay and the class
    // it reconciles against would all be wrong with nothing to show for it.
    const at = new Date().toISOString();
    try {
      // An empty selection is a deliberate anonymous head-count, not an error.
      await checkIn(supabase, tenantId, {
        memberId: memberId || null,
        passId,
        classId,
        source: 'desk',
        enteredAtIso: at,
        overrideReason,
      });
      setMemberId(''); setReason(''); setRefused(null); setWhy('');
      setMsg(wrote(
        !memberId ? 'Anonymous visit recorded.'
          : overrideReason ? 'Recorded, with your reason on the visit.'
          : 'Checked in.',
      ));
      onChange();
      // A desk that has just written a row is a desk that can reach the server,
      // which is the cheapest signal there is that the queue is worth trying.
      if (queue.pending.length) queue.flush();
    } catch (e: any) {
      // A refusal is not an error message. It is the gym's own record saying
      // no, and it comes with the one control that gets past it — so it is held
      // in its own state and rendered as a decision rather than joining the
      // stream of things that went wrong.
      if (e?.name === 'AdmissionRefused' && e.admission) {
        setRefused(e.admission as Admission);
        setMsg(null);
      } else if (isOffline(e)) {
        // The network, not the gym. The arrival is kept with the minute the
        // person actually walked in on it, so replaying it later writes exactly
        // the same fact rather than a made-up one.
        queue.hold({
          tenantId,
          kind: 'in',
          memberId: memberId || null,
          memberName: memberId
            ? (members ?? []).find((m) => m.memberId === memberId)?.memberName ?? null
            : null,
          passId, classId,
          atIso: at,
          visitId: null,
        });
        setMemberId(''); setReason(''); setRefused(null); setWhy('');
        // Assertive: the arrival is kept, but the GYM does not have it, and the
        // desk has to know that before it walks away from this browser.
        setMsg(sayRefused('The gym could not be reached, so that arrival is held on this machine and goes up on its own when the connection is back. It keeps the minute they came in.'));
      } else {
        setRefused(null);
        setMsg(sayRefused(e?.message, 'Could not record that check-in.'));
      }
    } finally { setBusy(false); }
  };

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    void record(null);
  };

  return (
    <Section title="Check someone in" sub="Leave the member blank to record a visit you cannot attribute — it still counts toward the day. Say what the visit was for and it reconciles against the class or the pass instead of counting twice.">
      {/* Mounted for as long as this section is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text. This is the desk: whoever is on it is looking at
          the person in front of them, not at the browser. See
          studio-web/components/Banner.tsx. */}
      <Announce say={sayText(msg)} tone={sayTone(msg)} />
      <form onSubmit={go} style={formRow}>
        <MemberPicker
          members={members} value={memberId} onPick={pickMember}
          unread={membersUnread} gymName={gymName}
        />
        <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...field, flex: 2 }}
                aria-label="What this visit was for">
          <option value="">Gym floor</option>
          {theirPasses.map((p) => (
            <option key={p.id} value={`pass:${p.id}`}>
              On their {p.passTypeName ?? 'pass'} — {remainingUses(p)} left
            </option>
          ))}
          {nearby.map((c) => (
            <option key={c.id} value={`class:${c.id}`}>
              {c.title} · {gymTimeText(c.startsAt, zone, { hour: '2-digit', minute: '2-digit' }) ?? '—'}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} style={{ ...btn, flex: 'none' }}>
          {busy ? 'Recording…' : 'Check in'}
        </button>
      </form>
      {/* What the record says, before anybody presses anything. `ok` is silent:
          a green line against every member who may come in is a line the desk
          stops reading, and then the one that matters is invisible too. */}
      {preview && preview.verdict !== 'ok' && !refused ? (
        <p style={{
          margin: '0 14px 14px', fontSize: 12.5, maxWidth: '78ch',
          color: preview.verdict === 'refuse' ? 'var(--crit)' : 'var(--warn)',
        }}>
          {preview.reason}
        </p>
      ) : null}

      {/* The two things a member of staff would want in their hand if this
          person went over on the floor, on screen while they are being
          selected rather than hunted for afterwards. The medical note is the
          GYM's own operational note (supabase/parts/197), never the client's
          injury record. */}
      {memberId ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink2)', maxWidth: '80ch' }}>
          {recordsUnread ? (
            <span style={{ color: 'var(--ink3)' }}>
              {recordsUnread === 'loading'
                ? 'Still reading the gym’s notes on this member.'
                : 'The gym’s notes did not come back, so their next of kin and any medical note are UNKNOWN here — not absent. The banner above says why.'}
            </span>
          ) : (
            <>
              {theirRecord?.medicalNote
                ? <span style={{ color: 'var(--warn)' }}>{theirRecord.medicalNote}{' · '}</span>
                : null}
              {emergencyLine(theirRecord)
                ? <>In an emergency ring {emergencyLine(theirRecord)}.</>
                : <span style={{ color: 'var(--ink3)' }}>No next of kin recorded for them. Add one on Members.</span>}
              {contactLine(theirRecord)
                ? <span style={{ color: 'var(--ink3)' }}>{' · '}{contactLine(theirRecord)}</span>
                : null}
            </>
          )}
        </p>
      ) : null}

      {/* Said rather than silently filtered. The member holds a PT block, the
          desk can see they hold something, and the list above deliberately does
          not offer it — without this line the desk reads the empty list as a
          member with nothing left and sells them another one. */}
      {theirPtPasses.length > 0 ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '80ch' }}>
          They also hold {theirPtPasses.length === 1 ? 'a personal-training pass' : `${theirPtPasses.length} personal-training passes`}
          {' '}({theirPtPasses.reduce((n, p) => n + remainingUses(p), 0)} left). Not offered here: it pays for an
          hour with a coach, and spending it on a walk through the door takes that hour off them and off the
          coach who is still owed it.
        </p>
      ) : null}

      {/* What is being held on this machine. */}
      {pendingNote(queue.pending) ? (
        <div style={{
          margin: '0 14px 14px', padding: '11px 13px', background: 'var(--surface2)',
          border: '1px solid var(--ring)', borderLeft: '3px solid var(--warn)',
        }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink2)', maxWidth: '80ch' }}>
            {pendingNote(queue.pending)}
          </p>
          <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <button type="button" style={linkBtn} disabled={queue.flushing} onClick={queue.flush}>
              {queue.flushing ? 'Sending…' : 'Try them now'}
            </button>
          </div>
          {queue.pending.filter((p) => p.refusedWhy).map((p) => (
            <p key={p.id} style={{ margin: '9px 0 0', fontSize: 12.5, color: 'var(--ink2)', maxWidth: '80ch' }}>
              <span className="mono" style={{ color: 'var(--ink)' }}>
                {gymTimeText(p.atIso, zone, { hour: '2-digit', minute: '2-digit' }) ?? '—'}
              </span>
              {' '}{p.memberName ?? 'somebody not identified'}
              {' '}{p.kind === 'out' ? 'leaving' : 'arriving'} — {p.refusedWhy}{' '}
              {/* Only an arrival is offered a way through. A refused check-out
                  matched no open visit — somebody else closed it, or the row is
                  not this desk's to close — and forcing it would write a second
                  departure over the first. */}
              {p.kind === 'in' ? (
                <>
                  <button
                    type="button" style={linkBtn}
                    onClick={() => {
                      // Recorded against the gym's own answer, with the fact that
                      // it was held on the desk as the reason — which is the true
                      // one and the one an audit needs.
                      void checkIn(supabase, p.tenantId, {
                        memberId: p.memberId, passId: p.passId, classId: p.classId,
                        enteredAtIso: p.atIso, source: 'desk',
                        overrideReason: `recorded at the desk while offline at ${gymTimeText(p.atIso, zone) ?? p.atIso}`,
                      })
                        .then(() => { queue.settled(p.id); onChange(); })
                        // An arrival recorded twice is two visits against one
                        // pass, and this is the RETRY of a write that was already
                        // held once — so the ambiguous sentence matters more here
                        // than anywhere: it is the one path that invites a third.
                        .catch((e: any) => setMsg(writeFailed(e, {
                          what: 'That arrival',
                          unchanged: 'it is still not recorded and stays in the queue below',
                          howToCheck: 'Reload this page and read today’s arrivals before recording it again — one arrival written twice takes two visits off a pass.',
                        })));
                    }}
                  >
                    Record it anyway
                  </button>
                  {' · '}
                </>
              ) : (
                <>That visit is already closed, or is not this desk&rsquo;s to close.{' '}</>
              )}
              <button type="button" style={{ ...linkBtn, color: 'var(--ink3)' }}
                      onClick={() => queue.drop(p.id)}>
                Discard it
              </button>
            </p>
          ))}
        </div>
      ) : null}

      {/* What was held too long to be today's. Said, never binned in silence:
          the gym has lost a row and is entitled to know which. */}
      {queue.lapsed.length > 0 ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--crit)', maxWidth: '80ch' }}>
          {queue.lapsed.length === 1 ? 'One door write was' : `${queue.lapsed.length} door writes were`} held on
          this machine for more than half a day and {queue.lapsed.length === 1 ? 'has' : 'have'} not been
          recorded:{' '}
          {queue.lapsed.map((p) => `${p.memberName ?? 'not identified'} ${p.kind === 'out' ? 'leaving' : 'arriving'} at ${gymDateTimeText(p.atIso, zone) ?? p.atIso}`).join(', ')}.
          An arrival is not written now because a visit from yesterday put into today&rsquo;s log is a
          stranger in Inside now; a departure is not written because the visit it closes has been open
          all night and the sweep is what accounts for those. Add them by hand if they matter.{' '}
          <button type="button" style={linkBtn} onClick={queue.dismissLapsed}>Dismiss</button>
        </p>
      ) : null}

      {!queue.queueRead ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--crit)', maxWidth: '80ch' }}>
          This browser will not let the desk hold anything, so a check-in or a check-out that fails is
          lost rather than retried. Private browsing and a full storage quota both do this.
        </p>
      ) : null}

      {/* The refusal itself, and the only way past it. */}
      {refused ? (
        <div style={{
          margin: '0 14px 14px', padding: '11px 13px', background: 'var(--surface2)',
          border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
        }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink2)', maxWidth: '78ch' }}>
            <strong style={{ color: 'var(--ink)' }}>Not recorded.</strong> {refused.reason}
          </p>
          <p style={{ margin: '8px 0 9px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '78ch' }}>
            Let them in anyway if you can see the record is behind — a renewal taken at the counter,
            a payment that cleared this morning, a decision the owner has already made. What you type
            is written onto the visit, so the row says why it exists.
          </p>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <input
              value={why} onChange={(e) => setWhy(e.target.value)}
              placeholder="Why they are being let in"
              aria-label="Why this person is being admitted anyway"
              style={{ ...field, flex: 2, minWidth: 220 }}
            />
            <button
              type="button" disabled={busy || !why.trim()}
              onClick={() => void record(why.trim())}
              style={{ ...btn, flex: 'none', opacity: why.trim() ? 1 : 0.5 }}
            >
              {busy ? 'Recording…' : 'Record it anyway'}
            </button>
            <button type="button" style={linkBtn} onClick={() => { setRefused(null); setWhy(''); }}>
              Leave it
            </button>
          </div>
        </div>
      ) : null}

      {/* Same distinction as the member list beside it. An unread timetable
          offers no classes, and a desk reading that as "no class is on" files
          a room full of people under gym floor for the rest of the morning. */}
      {classesUnread ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          {classesUnread === 'loading'
            ? 'Still reading the timetable — a visit checked in now is recorded on the gym floor.'
            : 'The timetable did not come back, so no class can be named against a visit. The banner above says why — this is not a morning with no classes on.'}
        </p>
      ) : null}
      {/* A dropdown holding nothing but "Anonymous" reads as a gym with no
          members. Say which it is, or the desk checks a member in as a walk-in
          and the visit never reaches their record. */}
      {membersUnread ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          {membersUnread === 'loading'
            ? 'Still reading the member list — check in anonymously for now.'
            : 'The member list did not come back, so only an anonymous visit can be recorded. The banner above says why.'}
        </p>
      ) : null}
      {msg ? <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg.text}</p> : null}
    </Section>
  );
}

/* ── finding a member at the desk ──────────────────────────────────────────── */

/** How many matches the picker shows before it asks for more typing. Enough to
 *  cover a family with one surname; short enough that the desk is never
 *  scrolling a list while somebody stands in front of them. */
const PICKER_ROWS = 8;

/**
 * Find the person standing at the desk.
 *
 * ── What this replaces, and why a `<select>` was not merely inelegant ──────
 *
 * This was `<select>` over `members.filter(m => m.status === 'active')`, and it
 * failed in two ways that both land on the same person:
 *
 *  · at 300 members a native select is a scroll list with no search — some
 *    browsers offer type-ahead on the first characters of the label and none of
 *    them find "Okafor" from "oka" if the label starts with "Sara". The desk
 *    gives up and checks a member in as a walk-in, and the visit never reaches
 *    that member's record;
 *  · FROZEN AND LAPSED MEMBERS WERE NOT IN THE LIST AT ALL. The one member you
 *    most want a row about — the one whose membership just ran out, who is
 *    standing at the desk about to renew or about to leave — was the one the
 *    desk could only record anonymously. That is the exact person /retention
 *    and /passes exist to find, missing from the log at the moment they are
 *    most visible.
 *
 * So every membership is searchable and the status is shown beside the name.
 * Anonymous stays available and stays the default: an unattributable head-count
 * is a real answer and it still counts toward the day.
 */
function MemberPicker({ members, value, onPick, unread, gymName }: {
  members: Membership[] | null;
  value: string;
  onPick: (id: string) => void;
  unread: Unread;
  /** `tenants.name`, for drawing a member's number the way their own app draws
   *  it. Never used to MATCH one — see `memberNoBody` in memberLookup.ts. */
  gymName: string | null;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  /*
   * Which option the arrow keys are on, and why this control needed rewriting.
   *
   * The list was closed by `onBlur={() => window.setTimeout(() => setOpen(false),
   * 150)}`. The comment beside it explained the delay as a fix for mouse clicks,
   * and it is — for a mouse. The results are `<button>`s, so TABBING to the
   * first one blurred the input and the list unmounted underneath the focused
   * button a moment later: this control, on the one console screen a trainer can
   * also open, could not be used from the keyboard at all. It is how the desk
   * finds the person standing in front of them.
   *
   * The answer is the combobox pattern rather than a longer timeout: focus never
   * leaves the input, the arrow keys move a highlight, Enter takes it, Escape
   * closes. The options stop being tab stops (`tabIndex={-1}`) because in this
   * pattern they are not meant to be — `aria-activedescendant` is what tells a
   * screen reader which one is current while focus stays put.
   *
   * -1 is "nothing highlighted", which is the state the box opens in: a picker
   * that pre-selects the first match is a picker that checks in the wrong person
   * when somebody types a name and presses Enter without looking.
   */
  const [active, setActive] = useState(-1);
  const listId = useId();

  // One entry per PERSON, not per membership row. Somebody who froze a
  // membership and opened another is one human being at the desk, and two
  // identical names in a picker is how the wrong one gets clicked. The live
  // membership wins the status label, because that is what the desk is being
  // asked about.
  const people = useMemo(() => {
    const byPerson = new Map<string, { id: string; name: string; status: string; plan: string | null; no: string | null }>();
    for (const m of members ?? []) {
      const seen = byPerson.get(m.memberId);
      const rank = (s: string) => (s === 'active' ? 3 : s === 'frozen' ? 2 : 1);
      if (!seen || rank(m.status) > rank(seen.status)) {
        byPerson.set(m.memberId, {
          id: m.memberId,
          name: m.memberName ?? m.memberId,
          status: m.status,
          plan: m.planName ?? null,
          /*
           * The number this gym's app prints for them. Computed once per read
           * rather than per keystroke, and shown beside the name so the desk
           * can read it back to somebody who cannot find their own screen.
           *
           * NULL, not a number, when the gym's name did not read.
           * `memberNoFor(id, null)` is a real string — "MEM-4APA10E5Y" — and
           * the member is holding "RUO-4APA10E5Y", so printing it would put a
           * number on this screen that matches nothing the member can see and
           * invite the desk to read it out. The lookup is unaffected either
           * way: it matches on the body, which has no prefix in it.
           */
          no: gymName ? memberNoFor(m.memberId, gymName) : null,
        });
      }
    }
    return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [members, gymName]);

  /*
   * How the roster read came back, in the four answers the lookup needs.
   *
   * 'partial' cannot arise from this caller — `fetchMemberships` goes through
   * `readAll`, which PAGES rather than stopping at the cap, so the roster it
   * hands over is the whole roster or an exception. It is in the type because
   * the thing that must never happen is a future caller that truncates
   * discovering, at a front desk, that "nobody has that number" was being said
   * over a prefix.
   */
  const rosterState: RosterState =
    unread === 'failed' ? 'failed' : unread === 'loading' ? 'loading' : members === null ? 'loading' : 'ready';

  /*
   * The number on the member's own screen.
   *
   * Resolved EXACTLY, and separately from the substring search below, for the
   * reason memberLookup.ts gives: the three letters in front of the hyphen come
   * from whatever brand label the member's phone had cached, so two members of
   * one gym can be holding two different prefixes for the same number, and a
   * substring match on the number as this console spells it would find one of
   * them and not the other.
   */
  const scan = useMemo(() => findByMemberNo(q, people, rosterState), [q, people, rosterState]);
  const scanSays = scanNote(scan);

  const hits = useMemo(
    // Searchable on the plan too, because "who is on Gold" is a question the
    // desk asks out loud, and on the member number so that a partly typed one
    // narrows the list. NOT on the raw id: the comment here used to say that
    // was "what a barcode scanner types into a text field", and it is not —
    // `profiles.id` is a uuid and appears on no screen a member can open. What
    // the scanner types is the number in `no`, and `scan` above is what
    // actually resolves it.
    () => searchRows(people, q, (p) => [p.name, p.plan, p.status, p.no]),
    [people, q],
  );

  /*
   * What the arrow keys can land on, and what the list draws.
   *
   * A resolved member number wins over the substring search, and it wins by
   * REPLACING the list rather than by sorting to the top. A scan is not a
   * search: the desk has pointed a reader at a barcode and there is exactly one
   * person it means, and leaving eleven other rows under them is how the wrong
   * one gets clicked by somebody who is not looking at the screen.
   *
   * A number matching two people is the one case that draws a list of its own —
   * those two, and nobody else — because that is the case the desk has to
   * resolve by asking a name.
   */
  const options =
    scan.kind === 'one'
      ? [scan.person]
      : scan.kind === 'ambiguous'
        ? scan.people.slice(0, PICKER_ROWS)
        : hits.slice(0, PICKER_ROWS);
  // Typing changes the matches, so a highlight held over from the last keystroke
  // would point at somebody else. It is cleared on every change of the query.
  const cur = active >= 0 && active < options.length ? options[active] : null;

  const take = (id: string) => { onPick(id); setQ(''); setOpen(false); setActive(-1); };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if (!options.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(true);
      setActive((i) => (i + 1 >= options.length ? 0 : i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setOpen(true);
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter' && (cur || scan.kind === 'one')) {
      /*
       * Only when something is actually highlighted, OR when a member NUMBER
       * resolved to exactly one person.
       *
       * The original rule stands and is the reason for the `cur` half: Enter on
       * a typed query with no highlight must not check in whoever happens to
       * sort first. A scan is the other case entirely. Most barcode readers
       * send a carriage return after the digits, so the whole gesture at a desk
       * is: point, and the person is chosen. Requiring an arrow key first would
       * mean the reader typed a number and then did nothing visible, which at a
       * front desk reads as a broken scanner.
       *
       * `scan.kind === 'one'` is the only arm that may do this. 'ambiguous' is
       * two people and Enter must not pick one of them.
       */
      e.preventDefault(); take(cur ? cur.id : (scan as { person: { id: string } }).person.id);
    }
  };

  const chosen = value ? people.find((p) => p.id === value) ?? null : null;

  // Chosen: the name, and a way back. Nothing is more confusing at a desk than
  // a search box that still says "sara" after Sara has been selected.
  if (chosen) {
    return (
      <span style={{ ...field, flex: 2, display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chosen.name}
          {chosen.status !== 'active'
            ? <span style={{ color: 'var(--warn)', marginLeft: 7, fontSize: 11.5 }}>{chosen.status}</span>
            : null}
          {/* The number their own app shows them, so the desk can confirm out
              loud that the right person was picked off a scan. */}
          {chosen.no
            ? <span className="mono" style={{ color: 'var(--ink3)', marginLeft: 8, fontSize: 11 }}>{chosen.no}</span>
            : null}
        </span>
        <button type="button" style={linkBtn} onClick={() => { onPick(''); setQ(''); setActive(-1); }}>change</button>
      </span>
    );
  }

  return (
    <span style={{ flex: 2, minWidth: 180, position: 'relative' }}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        // Closed on a delay rather than immediately, still, because the options
        // are pressed with `onMouseDown` prevented and a stray click elsewhere
        // must close the list. Tabbing away now closes it correctly too: the
        // options are not tab stops, so the next Tab genuinely leaves this
        // control rather than landing on a button about to be unmounted.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder={unread === 'failed'
          ? 'Member list unread — check in anonymously'
          : 'Name, member number or scan, or leave blank for a walk-in'}
        aria-label="Search for the member at the desk"
        role="combobox"
        aria-expanded={open && !!q.trim()}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={cur ? `${listId}-${cur.id}` : undefined}
        autoComplete="off"
        style={{ ...field, width: '100%' }}
      />
      {open && q.trim() ? (
        <span
          id={listId}
          role="listbox"
          aria-label="Members matching what you typed"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
            background: 'var(--surface)', border: '1px solid var(--ring)', borderTop: 'none',
            display: 'block', maxHeight: 260, overflowY: 'auto',
          }}
        >
          {options.map((p, i) => (
            <button
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              // A resolved member number reads as chosen, because it is: Enter
              // takes it whether or not an arrow key has been pressed, and a
              // row that Enter will act on and that looks inert is how a desk
              // presses Enter twice and checks somebody in on the second one.
              aria-selected={i === active || (scan.kind === 'one' && i === 0)}
              // Not a tab stop. Focus stays in the input; the highlight is what
              // moves, and `aria-activedescendant` above is what says so.
              tabIndex={-1}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => take(p.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: i === active || (scan.kind === 'one' && i === 0) ? 'var(--surface3)' : 'transparent',
                color: 'var(--ink2)', fontFamily: 'var(--sans)',
                fontSize: 13, padding: '7px 11px', border: 'none',
                borderBottom: '1px solid var(--ring2)',
              }}
            >
              {p.name}
              {/* The status is the whole reason a lapsed member is in this list.
                  Said in colour as well as words, because the desk is reading
                  it in two seconds with somebody waiting. */}
              {p.status !== 'active' ? (
                <span style={{ color: 'var(--warn)', marginLeft: 8, fontSize: 11.5 }}>{p.status}</span>
              ) : null}
              {p.plan ? <span style={{ color: 'var(--ink3)', marginLeft: 8, fontSize: 11.5 }}>{p.plan}</span> : null}
              {/* The number, so a desk resolving a duplicate can read both back
                  and so anybody who has forgotten theirs can be told it. */}
              {p.no ? <span className="mono" style={{ color: 'var(--ink3)', marginLeft: 8, fontSize: 11 }}>{p.no}</span> : null}
            </button>
          ))}
          {/* Only about the SEARCH. When a scan resolved, `options` is that one
              person and the number of other members whose name happens to
              contain the typed text is not a thing the desk needs to know. */}
          {scan.kind !== 'one' && scan.kind !== 'ambiguous' && hits.length > PICKER_ROWS ? (
            <span style={{ display: 'block', padding: '7px 11px', color: 'var(--ink3)', fontSize: 11.5 }}>
              {hits.length - PICKER_ROWS} more match — keep typing.
            </span>
          ) : null}
          {/* What the number said, above the rows. Four sentences for four
              outcomes — see `scanNote`. Nothing at all for a name search or a
              number that resolved, because at a desk with somebody waiting the
              right answer to "it worked" is silence. */}
          {scanSays ? (
            <span
              role="status"
              style={{
                display: 'block', padding: '9px 11px', fontSize: 12,
                color: scan.kind === 'unknown' ? 'var(--warn)' : 'var(--ink2)',
                borderBottom: options.length ? '1px solid var(--ring2)' : 'none',
              }}
            >
              {scanSays}
            </span>
          ) : null}
          {hits.length === 0 && !scanSays ? (
            <span style={{ display: 'block', padding: '9px 11px', color: 'var(--ink3)', fontSize: 12 }}>
              {/* Three different sentences for three different facts, the same
                  distinction the rest of this screen makes. An empty result
                  under a failed read must never read as "we have no members". */}
              {members === null
                ? (unread === 'failed'
                  ? 'The member list did not come back, so nobody can be found here. This is not a gym with no members.'
                  : 'Still reading the member list…')
                : `Nobody on the roster matches that. ${people.length} ${people.length === 1 ? 'person is' : 'people are'} searchable — frozen and cancelled included.`}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/* ── who is inside ─────────────────────────────────────────────────────────── */

function Inside({ inside, openBefore, swept, duplicates, records, recordsUnread, gymName, unread, tenantId, isOwner, queue, zone, onChange }: {
  inside: Visit[]; openBefore: number; swept: number; duplicates: number; unread: Unread;
  records: Map<string, GymMemberRecord> | null;
  recordsUnread: Unread;
  gymName: string | null;
  tenantId: string; isOwner: boolean;
  /** `tenants.timezone`, or null when the gym has not set one. Every clock on
   *  this screen is drawn on it. */
  zone: string | null;
  queue: DoorQueue;
  onChange: () => void;
}) {
  const [msg, setMsg] = useState<Said>(null);
  const [sweeping, setSweeping] = useState(false);

  const close = async (v: Visit) => {
    setMsg(null);
    // Stamped here, before the write, and carried into the queue if the write
    // does not land. A departure that took its time from a later flush would
    // put the whole outage onto that person's stay.
    const at = new Date().toISOString();
    try {
      await checkOut(supabase, v.id, at);
      onChange();
    } catch (e: any) {
      if (isOffline(e)) {
        // The network, not the gym. This was the half of the outage nothing
        // survived: an arrival was held and a departure was reported as a
        // failure and forgotten, so the gym went on believing that person was
        // in the building — in Inside now, in the evacuation headcount, and
        // missing from the average stay for ever.
        queue.hold({
          tenantId,
          kind: 'out',
          memberId: v.memberId,
          memberName: v.memberName,
          passId: null, classId: null,
          atIso: at,
          visitId: v.id,
        });
        setMsg(sayRefused('The gym could not be reached, so that check-out is held on this machine with the minute they left on it. It goes up on its own when the connection is back — until then this list is still counting them.'));
        return;
      }
      // checkOut throws on a refused update, and with no catch that rejection
      // went nowhere: the row stayed exactly as it was and the screen said
      // nothing, so the desk clicked again and read the gym as slow rather
      // than as refusing. The reason is what tells staff to retry or escalate.
      setMsg(sayRefused(e?.message, 'Could not check that visit out.'));
    }
  };

  const cols: Column<Visit>[] = [
    { key: 'who', header: 'Who', value: (v) => v.memberName ?? 'zzz',
      render: (v) => v.memberName ?? <span className="dash">not identified</span> },
    { key: 'in', header: 'In since', value: (v) => v.enteredAt,
      render: (v) => gymTimeText(v.enteredAt, zone, { hour: '2-digit', minute: '2-digit' }) ?? <span className="dash">—</span> },
    { key: 'for', header: 'For', value: (v) => Date.now() - Date.parse(v.enteredAt), numeric: true,
      render: (v) => `${Math.max(0, Math.round((Date.now() - Date.parse(v.enteredAt)) / 60000))} min` },
    // The column this screen was missing, beside the headcount it already
    // called the evacuation list. A visit the desk could not name has nobody to
    // ring and says so; a read that failed says something different again.
    { key: 'ice', header: 'In an emergency', value: (v) => emergencyLine(v.memberId ? records?.get(v.memberId) ?? null : null) ?? '',
      render: (v) => {
        if (recordsUnread) {
          return <span className="dash">{recordsUnread === 'loading' ? '…' : 'not read'}</span>;
        }
        if (!v.memberId) return <span className="dash">not identified at the desk</span>;
        const rec = records?.get(v.memberId) ?? null;
        const ice = emergencyLine(rec);
        return (
          <>
            {ice ?? <span className="dash">none recorded</span>}
            {/* The gym's own operational note, in colour because it is read in
                two seconds by somebody kneeling on the floor. Never the
                client's own injury record — that stays theirs. */}
            {rec?.medicalNote
              ? <div style={{ color: 'var(--warn)', fontSize: 11.5, marginTop: 2 }}>{rec.medicalNote}</div>
              : null}
          </>
        );
      } },
    { key: 'out', header: '', value: () => 0, align: 'right',
      render: (v) => (
        <button style={linkBtn} onClick={() => close(v)}>Check out</button>
      ) },
  ];

  /**
   * Put the roll call on paper.
   *
   * The sentence under the duplicate warning below has said for as long as this
   * screen has existed that this is "the figure somebody would read out in an
   * evacuation", and there was no way to get it off the tablet. During an alarm
   * the only copy is inside the building, on a device that needs wifi, and the
   * one instruction every evacuation procedure gives is not to go back in.
   *
   * A new window rather than a hidden print stylesheet: what is printed is the
   * list and the caveats, not the console around it, and a popup that is
   * blocked can be reported. `src/lib/rollCall.ts` builds the document — the
   * caveats are the half that decides whether the paper lies, and they are
   * asserted there without a browser.
   */
  const print = () => {
    setMsg(null);
    const doc = buildRollCall({
      gymName,
      inside: inside.map((v) => ({ memberId: v.memberId, memberName: v.memberName, enteredAt: v.enteredAt })),
      records,
      openFromEarlierDays: openBefore,
    });
    const w = window.open('', '_blank');
    if (!w) {
      setMsg(sayRefused('This browser blocked the print window. Allow pop-ups for the console, or take a photograph of the list below — do not leave the building without it.'));
      return;
    }
    w.document.write(rollCallHtml(doc));
    w.document.close();
    w.focus();
    // Printed on a timer rather than immediately: some browsers have not laid
    // the document out when `print()` is called on the same tick and send a
    // blank sheet, which is the one failure this must not have.
    w.setTimeout(() => w.print(), 250);
  };
  /**
   * Mark the visits nobody closed.
   *
   * ── Why there is a button here at all ────────────────────────────────────
   *
   * `sweepStaleVisits` had no caller anywhere in the repository, and the
   * sentence under this heading used to say a stale visit "is swept with a
   * note" — a promise about a job that did not exist. Two ways to make that
   * true: run it on a schedule, and let the person looking at the pile run it.
   * Both are here. The scheduled half is
   * `supabase/functions/sweep-stale-visits`, which is written and NOT deployed;
   * this button works today, with the owner's own session, because
   * `gym_visits_staff_u` already permits it.
   *
   * Owner-only, matching that policy's intent rather than its letter — the
   * policy admits trainers too, and a trainer sweeping the gym's whole backlog
   * of open visits is a housekeeping decision rather than a desk one.
   */
  const sweep = async () => {
    setSweeping(true); setMsg(null);
    try {
      const n = await sweepStaleVisits(supabase, tenantId);
      // Zero is a real answer and gets its own sentence: pressing the button
      // twice must not report the same rows twice, and it does not — the sweep
      // skips what it has already marked.
      setMsg(wrote(n === 0
        ? 'Nothing left to sweep — every visit still open has already been accounted for.'
        : `${n} ${n === 1 ? 'visit' : 'visits'} marked as left without scanning out. They stay open on purpose: no exit time is invented, so none of them enters the average stay.`));
      onChange();
    } catch (e: any) {
      setMsg(sayRefused(e?.message, 'Those visits could not be swept, so nothing has changed.'));
    } finally { setSweeping(false); }
  };

  return (
    <Section title="Inside now" sub="Anyone who came in today and has not been checked out. A visit left open overnight is marked with a note and never a guessed exit time — an invented exit would put a twenty-hour stay into the average.">
      {/* Mounted for as long as this section is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text. This is the desk: whoever is on it is looking at
          the person in front of them, not at the browser. See
          studio-web/components/Banner.tsx. */}
      <Announce say={sayText(msg)} tone={sayTone(msg)} />
      {/* Above the list, not under it: during an alarm nobody scrolls. */}
      <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '80ch' }}>
        <button type="button" style={linkBtn} disabled={!!unread} onClick={print}>
          Print the roll call
        </button>
        {unread
          ? ' — the door log has not been read, so there is no list to print. This screen will not print a page that says the building is empty.'
          : ' — the list below, with each person’s next of kin and what the floor was told, on paper you can take outside. It is a snapshot of the minute you print it and it says so.'}
      </p>
      {msg ? <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg.text}</p> : null}
      {duplicates > 0 ? (
        <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--warn)', maxWidth: '80ch' }}>
          {duplicates === 1 ? 'One member has' : `${duplicates} members have`} more than one check-in
          open from today. They are counted once here — a headcount is people, not scans — but a
          desk producing these is scanning the same card twice, and this is the figure somebody
          would read out in an evacuation.
        </p>
      ) : null}
      {openBefore > 0 ? (
        <p style={{ margin: '14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          {openBefore === 1 ? '1 visit is' : `${openBefore} visits are`} still open from an earlier
          day — check-ins nobody closed, not people standing in the gym, so they are said here and
          counted nowhere. There is no Check out on them on purpose: closing one now would stamp
          this minute as the exit and put a twenty-hour stay into the average.
          {swept > 0 ? ` ${swept} of them ${swept === 1 ? 'has' : 'have'} already been accounted for — marked by a sweep, or carrying the reason somebody was let in.` : ''}
          {isOwner && openBefore > swept ? (
            <>
              {' '}
              <button type="button" style={linkBtn} disabled={sweeping} onClick={sweep}>
                {sweeping ? 'Marking…' : `Mark the other ${openBefore - swept} as left without scanning out`}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {unread ? <Unresolved state={unread} what="the door log" /> : (
        <DataTable noun="people inside" rows={inside} columns={cols} rowKey={(v) => v.id} empty="Nobody is checked in." />
      )}
    </Section>
  );
}

/* ── today ─────────────────────────────────────────────────────────────────── */

function Today({ visits, unread, zone }: { visits: Visit[]; unread: Unread; zone: string | null }) {
  const cols: Column<Visit>[] = [
    { key: 'who', header: 'Who', value: (v) => v.memberName ?? 'zzz',
      render: (v) => v.memberName ?? <span className="dash">not identified</span> },
    { key: 'in', header: 'In', value: (v) => v.enteredAt,
      render: (v) => gymTimeText(v.enteredAt, zone, { hour: '2-digit', minute: '2-digit' }) ?? <span className="dash">—</span> },
    { key: 'out', header: 'Out', value: (v) => v.exitedAt ?? '',
      render: (v) => v.exitedAt
        ? gymTimeText(v.exitedAt, zone, { hour: '2-digit', minute: '2-digit' }) ?? '—'
        : <span className="dash">—</span> },
    { key: 'stay', header: 'Stay', value: (v) => dwellMinutes(v) ?? -1, numeric: true,
      render: (v) => {
        const d = dwellMinutes(v);
        // A dash, not a zero: an open visit has no measured length.
        return d == null ? <span className="dash">—</span> : `${d} min`;
      } },
    { key: 'via', header: 'Via', value: (v) => v.source,
      // An overridden visit is the gym letting somebody in against its own
      // record, and it is the row an audit comes looking for. Marked here
      // rather than buried in a note nobody opens.
      render: (v) => wasOverridden(v)
        ? <span title={v.note ?? undefined} style={{ color: 'var(--warn)' }}>{v.source} · let in</span>
        : v.source },
  ];
  return (
    <Section title="Today" sub="Every arrival logged since local midnight — the gym's midnight, not UTC's.">
      {unread ? <Unresolved state={unread} what="the door log" /> : (
        <DataTable noun="visits today" rows={visits} columns={cols} rowKey={(v) => v.id} empty="No visits logged today." />
      )}
    </Section>
  );
}

/* ── when is the gym busy ──────────────────────────────────────────────────── */

/**
 * The building's own shape: which hours are busy, which days, and how long
 * people stay.
 *
 * ── Why this is here and was not anywhere ────────────────────────────────
 *
 * `visitsByHour`, `peakHour`, `averageDwellMinutes` and `currentlyInside` have
 * all been written, commented and tested since the door log was built, and
 * `src/lib/coverage.test.ts` was their only caller. The logic existed; no screen
 * rendered it. "When is my gym busy" is the single most actionable staffing
 * question an owner has, and the console could not answer it.
 *
 * ── Why the week and the day are shown separately ────────────────────────
 *
 * Because collapsing them produces a wrong rota. `visitsByHour` flattens every
 * day together, so a gym whose Saturday mornings are heaving and whose Tuesday
 * mornings are empty reads as "busy at 09:00" — and somebody gets rostered on a
 * Tuesday. `busiestSlots` keeps the weekday, which is the unit a rota is
 * actually written in, and carries how many calendar days each slot is averaged
 * over so a 30-day window's five Mondays and four Fridays are not compared as
 * though they were the same sample.
 */
function Occupancy({ visits, unread, days }: {
  visits: Visit[] | null; unread: Unread; days: number;
}) {
  const hours = useMemo(() => (visits ? visitsByHour(visits) : null), [visits]);
  const week = useMemo(() => (visits ? visitsByWeekday(visits) : null), [visits]);
  const slots = useMemo(() => (visits ? busiestSlots(visits, 5) : null), [visits]);
  const dwell = useMemo(() => (visits ? averageDwellMinutes(visits) : null), [visits]);

  if (unread) {
    return (
      <Section title="When the gym is busy" sub={`Every arrival in the last ${days} days.`}>
        <Unresolved state={unread} what="the door log" />
      </Section>
    );
  }
  if (!visits || !hours || !week || !slots) return null;

  if (visits.length === 0) {
    return (
      <Section title="When the gym is busy" sub={`Every arrival in the last ${days} days.`}>
        <p style={{ padding: '22px 14px', margin: 0, color: 'var(--ink3)', fontSize: 13 }}>
          Nothing has been recorded at the door in {days} days, so there is no shape to show. That
          is a desk that is not checking people in rather than a gym nobody visits — every figure on
          this page, and the retention reading on Members, is built on these rows.
        </p>
      </Section>
    );
  }

  // The tallest bar sets the scale. Floored at 1 so a single visit does not
  // divide by zero, and taken over the hours actually present rather than a
  // fixed maximum — the shape is what matters, not the absolute height.
  const busiestHour = Math.max(1, ...hours.map((h) => h.visits));
  const busiestDay = Math.max(1, ...week.map((d) => d.visits));

  return (
    <Section
      title="When the gym is busy"
      sub={`Every arrival in the last ${days} days, by hour and by day. A quiet hour is drawn as a quiet hour rather than left out.`}
    >
      <div style={{ padding: '14px 14px 4px' }}>
        <div className="micro" style={{ marginBottom: 7 }}>By hour of the day</div>
        <div style={{ display: 'grid', gap: 3, gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
          {hours.map((h) => (
            <div key={h.hour} title={`${String(h.hour).padStart(2, '0')}:00 — ${h.visits} in`}
                 style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
              <span style={{
                display: 'block', width: '100%',
                height: 4 + Math.round((h.visits / busiestHour) * 34),
                background: h.visits === 0 ? 'var(--ring)' : 'var(--brand)',
                opacity: h.visits === 0 ? 0.5 : 1,
              }} />
              <span className="mono" style={{ fontSize: 8.5, color: 'var(--ink3)' }}>
                {String(h.hour).padStart(2, '0')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px' }}>
        <div className="micro" style={{ marginBottom: 7 }}>By day of the week</div>
        <div style={{ display: 'grid', gap: 3, gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {week.map((d) => (
            <div key={d.day} title={`${d.day} — ${d.visits} in`} style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
              <span style={{
                display: 'block', width: '100%',
                height: 4 + Math.round((d.visits / busiestDay) * 34),
                background: d.visits === 0 ? 'var(--ring)' : 'var(--brand)',
                opacity: d.visits === 0 ? 0.5 : 1,
              }} />
              <span className="mono" style={{ fontSize: 9, color: 'var(--ink3)' }}>{d.day}</span>
              <span className="mono" style={{ fontSize: 10, color: d.visits === 0 ? 'var(--ink3)' : 'var(--ink2)' }}>
                {d.visits === 0 ? '—' : d.visits}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 14px 14px' }}>
        <div className="micro" style={{ marginBottom: 7 }}>Busiest slots</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 5 }}>
          {slots.map((s) => (
            <li key={`${s.weekday}:${s.hour}`} style={{
              display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
              fontSize: 12.5, color: 'var(--ink2)',
              border: '1px solid var(--ring)', background: 'var(--surface2)', padding: '6px 10px',
            }}>
              <span className="mono" style={{ color: 'var(--ink)' }}>
                {WEEKDAYS[s.weekday]} {String(s.hour).padStart(2, '0')}:00
              </span>
              <span>{s.visits} in</span>
              {/* The average is the number to staff against, and it needs its
                  denominator said out loud: 30 days holds five Mondays and four
                  Fridays, so a total alone makes Monday look busier than it is. */}
              <span style={{ color: 'var(--ink3)' }}>
                {s.days === 1 ? 'on one day' : `across ${s.days} of them — about ${Math.round((s.visits / s.days) * 10) / 10} each time`}
              </span>
            </li>
          ))}
        </ul>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--ink3)' }}>
          {/* Two figures, never one. A dwell average computed over the visits
              that recorded an exit is honest only if it says how many that was
              — half of them being open makes the average a sample, not a fact. */}
          {dwell && dwell.minutes != null
            ? `Average stay ${dwell.minutes} min, measured from the ${dwell.closed} of ${dwell.total} visits that recorded an exit.`
            : `No visit in this window recorded an exit, so there is no average stay — that is a door with no way out recorded, not a gym nobody stays in.`}
        </p>
      </div>
    </Section>
  );
}

/* ── passes ────────────────────────────────────────────────────────────────── */

function Passes({ passes, types, members, summary, passesUnread, typesUnread, tenantId, today, zone, me, gymName, onChange }: {
  passes: GymPass[] | null; types: PassType[] | null; members: Membership[] | null;
  summary: ReturnType<typeof summarisePasses> | null;
  passesUnread: Unread; typesUnread: Unread;
  tenantId: string; today: string;
  /** `tenants.timezone`, or null when the gym has not set one. Every clock on
   *  this screen is drawn on it. */
  zone: string | null;
  me: Me;
  /** `tenants.name`, for the picker's member numbers. */
  gymName: string | null;
  onChange: () => void;
}) {
  const [typeId, setTypeId] = useState('');
  /**
   * The account the pass belongs to, when the person at the desk has one.
   *
   * `gym_passes.holder_id` has existed since 31-drop-ins-and-passes.sql and
   * `IssuePass.holderId` since the library was written; this form passed only
   * `holderName`, so EVERY pass this console has ever sold is anonymous. That
   * is not a cosmetic gap. /passes measures whether pass holders go on to join
   * — the console's headline retention number — and it excludes anonymous
   * passes from the denominator on purpose, because a walk-in name cannot be
   * matched to a member without guessing at spellings. A price book of
   * name-only passes therefore leaves that metric structurally empty: not low,
   * not falling, empty, for a gym doing the exact thing the metric measures.
   *
   * The constraint takes either (`holder_id is not null or holder_name`), and
   * `issuePass` nulls the name when an id is given so the two can never
   * disagree about who holds it.
   */
  const [holderId, setHolderId] = useState('');
  const [holderName, setHolderName] = useState('');
  const [hostId, setHostId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Said>(null);
  /** The pass whose redemption the gym's own record refused, and the sentence
   *  that would take it anyway. The same shape the check-in bar uses, because
   *  it is the same decision. */
  const [refusedTake, setRefusedTake] = useState<{ pass: GymPass; admission: Admission } | null>(null);
  const [takeWhy, setTakeWhy] = useState('');
  const [taking, setTaking] = useState<string | null>(null);

  /**
   * The pass whose history is open, and what came back for it.
   *
   * Three states and not two. `rows: null` with `why: null` is still reading,
   * `why` set is a refused read, and `rows: []` is a pass nothing has been
   * taken off — which on this panel is a real and common answer and must not
   * share a sentence with either of the others.
   */
  const [history, setHistory] = useState<{ pass: GymPass; rows: Redemption[] | null; why: string | null } | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  const openHistory = async (p: GymPass) => {
    setMsg(null);
    setHistory({ pass: p, rows: null, why: null });
    try {
      const rows = await fetchRedemptions(supabase, p.id);
      // The panel may have been closed, or another pass opened, while this was
      // in flight. Landing the answer anyway would draw one pass's visits under
      // another pass's heading, which on a screen whose whole job is to say
      // whose visit this was is the worst available outcome.
      setHistory((h) => (h && h.pass.id === p.id ? { ...h, rows } : h));
    } catch (e: any) {
      const why = e?.message ?? 'The read was refused.';
      setHistory((h) => (h && h.pass.id === p.id ? { ...h, why } : h));
    }
  };

  /**
   * Put one visit back.
   *
   * The database is the guarantee, twice over: part 31's trigger recomputes
   * `uses_spent` from the surviving rows, so there is no second counter to keep
   * in step, and only an owner's policy permits the delete — a trainer may take
   * a pass and may not put one back. `undoRedemption` runs
   * `redemptionUndoBlocker` again on the way there, so the refusal below is the
   * same sentence whichever side catches it.
   *
   * What this does NOT do is remove the door log entry. The arrival happened,
   * or it did not, and that is a separate correction — so the panel says so
   * rather than leaving somebody to discover that "Visits today" did not move.
   */
  const undo = async (r: Redemption) => {
    setMsg(null);
    const blocked = redemptionUndoBlocker(r);
    if (blocked) { setMsg(sayRefused(blocked)); return; }
    setUndoing(r.id);
    try {
      await undoRedemption(supabase, r);
      setMsg(wrote('Put back. The pass has the visit again; the door log still shows the arrival, which is a separate correction.'));
      // Re-read rather than splice. The count on the row comes from the
      // database's own recomputation, and a screen that removes the line
      // itself is a screen that disagrees with the trigger the moment one of
      // them is wrong.
      const rows = await fetchRedemptions(supabase, r.passId);
      setHistory((h) => (h && h.pass.id === r.passId ? { ...h, rows, why: null } : h));
      onChange();
    } catch (e: any) {
      setMsg(sayRefused(e?.message, 'That visit was NOT put back.'));
    } finally { setUndoing(null); }
  };

  const sell = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = (types ?? []).find((x) => x.id === typeId);
    if (!t) { setMsg(sayRefused('Pick a pass.')); return; }
    if (!holderId && !holderName.trim()) {
      setMsg(sayRefused('Say who the pass is for — pick the member, or type the name at the desk for somebody with no account.'));
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await issuePass(supabase, tenantId, {
        passType: t,
        holderId: holderId || null,
        holderName: holderName.trim() || null,
        hostMemberId: t.kind === 'guest' ? (hostId || null) : null,
        issuedOn: today,
      });
      const who = activeMembers.find((m) => m.memberId === holderId)?.memberName;
      setHolderId(''); setHolderName(''); setHostId('');
      setMsg(wrote(holderId
        ? `Pass issued to ${who ?? 'that member'} — it is on their record, so what they do next counts.`
        : 'Pass issued to a name at the desk. It counts toward pass revenue, but nothing can tell whether this person later joined.'));
      onChange();
    } catch (e: any) {
      setMsg(sayRefused(e?.message, 'Could not issue that pass.'));
    } finally { setBusy(false); }
  };

  /**
   * Take a visit off a pass — the second way through this door.
   *
   * ── Why this now asks the same questions the check-in bar asks ──────────
   *
   * Because it did not, and it writes the same row. The form above runs
   * `checkIn`, which reads the gym's own record at the moment of the write and
   * refuses a double scan, somebody who is already inside, and a card scanned
   * twice within two minutes. This button went straight to `redeemPass`, which
   * asked nothing — so the identical mistake, made two inches lower on the same
   * screen, was caught by nothing and put the same person into the evacuation
   * headcount twice while spending two visits off one pass.
   *
   * A refusal here is overridable exactly as it is above, and for the same
   * reason: a desk that cannot record what it can plainly see stops recording.
   * What staff type is written onto the VISIT, so the row carries why it exists.
   */
  const take = async (p: GymPass, overrideWhy: string | null = null) => {
    setMsg(null);
    // Coverage before the round trip, and before anything is written. This is
    // the one that was losing money: a personal-training block spent by its
    // holder walking through the turnstile. `redeemPass` refuses it again on
    // the way to the database — the sentence is the same either way.
    const blocked = passBlocker(p, { spendOn: 'visit', today });
    if (blocked) { setMsg(sayRefused(blocked)); return; }
    setTaking(p.id);
    try {
      if (p.holderId && !overrideWhy) {
        const admission = await doorAdmission(supabase, tenantId, {
          memberId: p.holderId, passId: p.id,
        });
        if (admission.verdict === 'refuse') {
          setRefusedTake({ pass: p, admission });
          return;
        }
      }
      // Two rows, deliberately, and `redeemPass` writes both — see the note on
      // it in src/lib/gymPasses.ts. Taking a visit off a pass used to write the
      // redemption alone, so somebody who paid at the desk and walked into the
      // gym left NO trace in the door log: they are not in "Visits today", not
      // in "Inside now", not in the busiest-hour count, and not in any
      // attendance or retention figure built on gym_visits. The pass ledger
      // knew and the door did not.
      await redeemPass(supabase, p, {
        tenantId, redeemedBy: me.id ?? null, today, spendOn: 'visit',
        visitNote: overrideWhy ? `${OVERRIDE_PREFIX}${overrideWhy}` : null,
      });
      setRefusedTake(null); setTakeWhy('');
      if (overrideWhy) setMsg(wrote('Taken, with your reason on the visit.'));
      onChange();
    } catch (e: any) {
      if (isOffline(e)) {
        // Deliberately NOT queued, and this is the one write on this screen
        // that is not. An arrival replayed later states the same fact; a
        // redemption replayed later cannot promise that — if the first attempt
        // reached the database and only the answer was lost, the replay spends
        // a SECOND visit off the pass, and that is a member's money. So nothing
        // is written, the desk is told exactly that, and it is given the route
        // that is safe.
        setMsg(sayRefused('The gym could not be reached, so NOTHING was written — the pass is untouched and the arrival is not recorded. Check them in from the bar at the top, which is held on this machine and goes up on its own, then take the pass off when the connection is back.'));
        return;
      }
      // The reason matters at a desk: "expired on the 3rd" ends an argument
      // that "could not redeem" starts.
      setMsg(sayRefused(e?.message, 'Could not take that pass.'));
    } finally { setTaking(null); }
  };

  const cols: Column<GymPass>[] = [
    { key: 'who', header: 'Holder', value: (p) => p.holderName ?? 'zzz',
      render: (p) => p.holderName ?? <span className="dash">—</span> },
    { key: 'type', header: 'Pass', value: (p) => p.passTypeName ?? '',
      render: (p) => p.passTypeName ?? <span className="dash">retired type</span> },
    { key: 'left', header: 'Left', value: (p) => remainingUses(p), numeric: true,
      render: (p) => `${remainingUses(p)} / ${p.usesTotal}` },
    { key: 'expires', header: 'Expires', value: (p) => p.expiresOn ?? '',
      render: (p) => p.expiresOn ?? <span className="dash">no expiry</span> },
    { key: 'paid', header: 'Paid', value: (p) => p.paidCents ?? -1, numeric: true,
      // Null is a pass nobody priced, which is not a free pass.
      // money() is null when the ROW states no currency, which is a second
      // silence and gets its own words — an amount with no currency is not an
      // amount, and printing the bare number invites the reader to supply one.
      render: (p) => p.paidCents == null ? <span className="dash">not recorded</span>
        : money(p.paidCents, p.currency) ?? <span className="dash">no currency on this pass</span> },
    // What the pass BUYS, beside what is left on it. Two passes with the same
    // name and the same count buy different things, /members has printed this
    // column all along, and the screen that spends them did not have it.
    { key: 'covers', header: 'Good for', value: (p) => p.covers ?? '',
      render: (p) => p.covers === 'pt' ? 'personal training'
        : p.covers === 'visit' ? 'door and classes'
        : <span className="dash">the pass type could not be read</span> },
    { key: 'status', header: 'Status', value: (p) => passStatus(p, today) },
    { key: 'take', header: '', value: () => 0, align: 'right',
      render: (p) => {
        // The refusal is on the row rather than behind the click. A greyed
        // button with no sentence is a desk pressing it again.
        const why = passBlocker(p, { spendOn: 'visit', today });
        if (!why) {
          return (
            <button style={linkBtn} disabled={taking === p.id} onClick={() => void take(p)}>
              {taking === p.id ? 'Taking…' : 'Take a visit'}
            </button>
          );
        }
        return p.covers === 'pt'
          ? <span style={{ color: 'var(--ink3)', fontSize: 12 }} title={why}>not for the door</span>
          : null;
      } },
    // The way back. A pass with nothing taken off it has nothing to show, so
    // the control is not drawn for one — but a used-up or expired pass still
    // gets it, because those are exactly the passes a wrong redemption makes.
    { key: 'history', header: '', value: () => 0, align: 'right',
      render: (p) => {
        if (p.usesSpent <= 0) return null;
        const open = history?.pass.id === p.id;
        return (
          <button
            style={linkBtn}
            aria-expanded={open}
            onClick={() => (open ? setHistory(null) : void openHistory(p))}
          >
            {open ? 'Hide visits' : 'Visits taken'}
          </button>
        );
      } },
  ];

  const selected = (types ?? []).find((t) => t.id === typeId);
  const activeMembers = (members ?? []).filter((m) => m.status === 'active');

  return (
    <Section
      title="Passes"
      sub={
        summary
          ? `${summary.live} live · ${summary.expired} expired · ${summary.usedUp} used up · ${summary.visitsRemaining} visits still owed`
          : undefined
      }
    >
      {/* Mounted for as long as this section is on screen, so a later `msg` is a
          CHANGE to an existing region rather than a node inserted at the same
          instant as its text. This is the desk: whoever is on it is looking at
          the person in front of them, not at the browser. See
          studio-web/components/Banner.tsx. */}
      <Announce say={sayText(msg)} tone={sayTone(msg)} />
      {types === null ? (
        // Not the same sentence as "none yet": sending someone to Money to add
        // pass types they already have, because the read broke, wastes the one
        // person who could fix it.
        <p style={{ padding: '0 14px 14px', margin: 0, color: 'var(--ink3)', fontSize: 12.5 }}>
          {typesUnread === 'failed'
            ? 'The pass types did not come back, so nothing can be sold from here yet. The banner above says why.'
            : 'Still reading the pass types…'}
        </p>
      ) : types.length === 0 ? (
        <p style={{ padding: '0 14px 14px', margin: 0, color: 'var(--ink3)', fontSize: 12.5 }}>
          No pass types yet. Add them under Money before selling at the desk.
        </p>
      ) : (
        <form onSubmit={sell} style={formRow}>
          <select aria-label="Which pass" value={typeId} onChange={(e) => setTypeId(e.target.value)} style={{ ...field, flex: 2 }}>
            <option value="">Pass type…</option>
            {(types ?? []).filter((t) => t.active).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{money(t.priceCents, t.currency) ? ` — ${money(t.priceCents, t.currency)}` : ''}{t.uses > 1 ? ` (${t.uses} visits)` : ''}
              </option>
            ))}
          </select>
          {/* The member picker comes FIRST, and the free-text name is the
              fallback beside it rather than the only field. A desk offered one
              box marked "Name at the desk" types a name every time, including
              for the member standing there holding an account — which is how a
              gym ends up unable to answer whether any pass it ever sold turned
              into a membership. */}
          {/* The same searchable picker as the check-in bar, and for the same
              reason plus one: a pass is most often sold to somebody whose
              membership has just lapsed, and the `<select>` that stood here
              listed active memberships only — so the one person a day pass is
              for was the one person it could not be attributed to. */}
          <MemberPicker
            members={members} value={holderId}
            onPick={(id) => { setHolderId(id); if (id) setHolderName(''); }}
            unread={members === null ? 'failed' : null}
            gymName={gymName}
          />
          {/* Disabled rather than hidden once a member is picked: the two are a
              real either/or — `issuePass` nulls the name when it is given an id
              — and a control that vanishes reads as one that was never there. */}
          <input
            value={holderName} onChange={(e) => setHolderName(e.target.value)}
            disabled={!!holderId}
            placeholder={holderId ? 'On their account' : 'Name at the desk'}
            style={{ ...field, flex: 2, opacity: holderId ? 0.5 : 1 }}
          />
          {selected?.kind === 'guest' ? (
            <select aria-label="Whose guest" value={hostId} onChange={(e) => setHostId(e.target.value)} style={{ ...field, flex: 2 }}>
              <option value="">Guest of…</option>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.memberId}>{m.memberName ?? m.memberId}</option>
              ))}
            </select>
          ) : null}
          <button type="submit" disabled={busy} style={{ ...btn, flex: 'none' }}>
            {busy ? 'Issuing…' : 'Issue'}
          </button>
        </form>
      )}
      {/* An empty member picker reads as a gym whose passes can only ever be
          anonymous, and a desk that believes that stops looking for the name. */}
      {types !== null && types.length > 0 && members === null ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          The member list did not come back, so a pass sold now can only carry a name at the desk —
          and a pass with no account behind it is left out of the conversion figure on Passes. The
          banner above says why; sell it on the member&rsquo;s record once the page reloads.
        </p>
      ) : null}
      {msg ? <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg.text}</p> : null}

      {/* The gym's own record said no to this redemption, and the way past it.
          The same panel as the check-in bar, because it is the same decision
          about the same person — it was simply never asked here. */}
      {refusedTake ? (
        <div style={{
          margin: '0 14px 14px', padding: '11px 13px', background: 'var(--surface2)',
          border: '1px solid var(--ring)', borderLeft: '3px solid var(--crit)',
        }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink2)', maxWidth: '78ch' }}>
            <strong style={{ color: 'var(--ink)' }}>Not taken.</strong> {refusedTake.admission.reason}
          </p>
          <p style={{ margin: '8px 0 9px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '78ch' }}>
            Nothing has been written: the pass still has {remainingUses(refusedTake.pass)} on it. Take it
            anyway if you can see the record is behind — what you type goes onto the visit.
          </p>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <input
              value={takeWhy} onChange={(e) => setTakeWhy(e.target.value)}
              placeholder="Why this visit is being taken anyway"
              aria-label="Why this pass is being taken anyway"
              style={{ ...field, flex: 2, minWidth: 220 }}
            />
            <button
              type="button" disabled={!takeWhy.trim() || taking !== null}
              onClick={() => void take(refusedTake.pass, takeWhy.trim())}
              style={{ ...btn, flex: 'none', opacity: takeWhy.trim() ? 1 : 0.5 }}
            >
              Take it anyway
            </button>
            <button type="button" style={linkBtn} onClick={() => { setRefusedTake(null); setTakeWhy(''); }}>
              Leave it
            </button>
          </div>
        </div>
      ) : null}

      {summary && summary.revenueCents == null && summary.issued > 0 ? (
        <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
          No price is recorded against any pass, so pass revenue reads as a dash
          rather than nil. Record what was taken when you issue one.
        </p>
      ) : null}

      {passes === null ? <Unresolved state={passesUnread === 'failed' ? 'failed' : 'loading'} what="the passes" /> : (
        <DataTable noun="passes" rows={passes} columns={cols} rowKey={(p) => p.id} empty="No passes issued yet." />
      )}

      {/* What was taken off one pass, and the way to put one back.
          `redeemPass` has been wired since this desk existed and its opposite
          number was called by nothing, so a visit taken off the wrong person's
          card could not be reversed by anybody anywhere in the product — the
          member was simply told they had nine left. */}
      {history ? (
        <div style={{
          margin: '0 14px 14px', padding: '11px 13px', background: 'var(--surface2)',
          border: '1px solid var(--ring)',
        }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>
            Visits taken off {history.pass.holderName ?? 'this pass'}
            {history.pass.passTypeName ? ` · ${history.pass.passTypeName}` : ''}
          </h3>

          {history.why ? (
            <p style={{ margin: '7px 0 0', fontSize: 12.5, color: 'var(--crit)', maxWidth: '78ch' }}>
              What has been taken off this pass could not be read: {history.why}. That is
              not a pass nothing has been taken off &mdash; the counter beside it says{' '}
              {history.pass.usesSpent} {history.pass.usesSpent === 1 ? 'has' : 'have'} been.
            </p>
          ) : history.rows === null ? (
            <p style={{ margin: '7px 0 0', fontSize: 12.5, color: 'var(--ink3)' }}>Still reading…</p>
          ) : history.rows.length === 0 ? (
            <p style={{ margin: '7px 0 0', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '78ch' }}>
              Nothing has been taken off this pass. The counter beside it says{' '}
              {history.pass.usesSpent}, so those two disagree &mdash; which is worth
              knowing rather than smoothing over.
            </p>
          ) : (
            <>
              <p style={{ margin: '7px 0 9px', fontSize: 12.5, color: 'var(--ink3)', maxWidth: '78ch' }}>
                Putting one back returns the visit to the card. It does NOT remove the
                arrival from the door log &mdash; the person either came in or they did
                not, and that is a separate correction on the log above.
                {me.role === 'owner' ? null : ' Only an owner may put a visit back; the database refuses it either way.'}
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {history.rows.map((r) => {
                  const blocked = redemptionUndoBlocker(r);
                  return (
                    <li key={r.id} style={{
                      display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
                      padding: '7px 0', borderTop: '1px solid var(--ring)',
                    }}>
                      {/* Same formatter as every other stamp on this screen,
                          which is now the GYM's clock rather than the reader's.
                          The paragraph here used to argue for the device's on
                          consistency grounds and it was right about consistency
                          and wrong about which clock: every other stamp on this
                          page has moved, so this one moves with them. */}
                      <span className="mono" style={{ fontSize: 12.5 }}>
                        {gymDateTimeText(r.redeemedAt, zone, { dateStyle: 'medium', timeStyle: 'short' }) ?? '—'}
                      </span>
                      <span style={{ fontSize: 12.5, color: 'var(--ink3)', flex: 1, minWidth: 180 }}>
                        {r.sessionId ? 'paid for a one-to-one'
                          : r.classId ? 'taken against a class'
                          : 'taken at the door'}
                      </span>
                      {blocked ? (
                        <span style={{ fontSize: 12, color: 'var(--ink3)', maxWidth: '54ch' }}>{blocked}</span>
                      ) : me.role === 'owner' ? (
                        <button
                          style={linkBtn} disabled={undoing === r.id}
                          onClick={() => void undo(r)}
                        >
                          {undoing === r.id ? 'Putting back…' : 'Put this visit back'}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </Section>
  );
}

/* ── shared bits (same shapes as the Money screen) ─────────────────────────── */

const field = {
  padding: '9px 11px', borderRadius: 0, fontSize: 13.5,
  background: 'var(--surface2)', color: 'var(--ink)',
  border: '1px solid var(--ring)', fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const btn = {
  ...field, background: 'var(--brand)', color: 'var(--brand-ink)',
  fontWeight: 600, cursor: 'pointer', border: '1px solid transparent',
} as const;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 13, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 9, padding: 14, borderBottom: '1px solid var(--ring)', flexWrap: 'wrap' as const,
};

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

// The banner is the shared one now: studio-web/components/Banner.tsx. This
// page's copy rendered into a plain <div>, so every "the write was refused and
// nothing was saved" it said was a silence for a screen reader. The shared one
// carries role="alert"/aria-live; `live={false}` is for the ones an Announce
// region on the same screen is already reading out.
function Banner({ children, tone, live }: { children: React.ReactNode; tone?: 'crit'; live?: boolean }) {
  return <SharedBanner tone={tone} live={live}>{children}</SharedBanner>;
}

/**
 * What stands in for a table whose rows are not known.
 *
 * A refused read used to fall through to the table's own empty line, so "we
 * could not ask" and "the gym has none" were the same sentence on screen.
 */

