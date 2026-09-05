// Shared training-session store — a single source of truth for the coach and
// client portals so a slot the coach opens shows up as bookable for the client,
// a booking shows on the coach's calendar, and a cancellation re-offers the slot.
// Persists to Supabase `sessions` (RLS: trainer owns; client reads open slots and
// their own; book/cancel/approve via RPC) with a defensive in-memory fallback and
// a booking reminder. Client approvals are merged in from `session_approvals`.
//
// approveSession already refuses to lie — it updates local state only after the
// RPC accepts, with a comment saying why. Everything around it did not:
//
//   · the hydrate returned early on `error`, on `!data`, and on `!data.length`,
//     all down the same path. An empty calendar meant either "no sessions
//     booked" or "we could not read them", and the coach's schedule and the
//     client's upcoming-session card both stated the first.
//   · addSession / bookSession / releaseSession / removeSession were all
//     fire-and-forget with empty rejection handlers. A booking that the server
//     refused still drew on the calendar AND scheduled the client a local "your
//     session starts in 1 hour" notification, so they were reminded to attend a
//     session that did not exist.
//
// addSession's `{ ok }` shape is untouched — screens destructure it — but it now
// also carries `saved`, a promise that resolves to whether the row reached the
// server.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  overlaps, insideNoticeWindow, noticeHoursOf, lateCancelFee, cancelWarningLine,
  feeRecordedLine, waitlistLine, type CancellationPolicy,
} from '../lib/booking';
import { VARIANT } from '../lib/variant';
import type { TrainingSession } from '../lib/types';
import type { DisputeKind } from '../lib/sessionDispute';
import { NOT_MOVED, COACH_NOT_MOVED, type RescheduleRefusal, type RescheduleReport, type CoachMoveRefusal, type CoachMoveReport } from '../lib/reschedule';
// Named explicitly. Without the import `reportError` resolves to the DOM global
// of the same name, which takes ONE argument and swallows the context string —
// so every report from this file would have arrived unattributable.
import { reportError } from '../lib/reportError';
import { scheduleLocal, sendPushChecked } from './pushNotifications';
import { reofferSlot, refundSession, sessionsRemaining } from '../lib/connect';
import { useAuthRevision } from './authRevision';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
// A capped page of sessions is up to ROW_CAP uuids, and the approvals lookup
// used to put all of them into one `.in()`. See the note at that read.
import { readByIds } from '../lib/idLookup';
import { readCappedByIds } from '../lib/cappedByIds';
// The reader's own weekday and the reader's own clock, for the three pushes
// below. See the note above `at`/`dow` in `cancelBookedSession`.
import { fmtClock, weekdayNameShort } from '../lib/format';
import { cacheKey, cachedAtLine, packCache, readCache, withinHorizon } from '../lib/readCache';
import { classifyWrite } from '../lib/offlineQueue';
// Whether the autosaved cancellation policy actually landed. The write here had
// both of the defects src/lib/profileSave.ts was written for: a discarded
// outcome, and a debounce cancelled by leaving the screen.
import { IDLE_SAVE, markPending, afterWrite, type SaveStatus } from '../lib/profileSave';
import { writeFailure } from '../lib/wroteRows';
import { useOutbox } from './outbox';
import { useLive } from './realtime';
import { useRecoverRead } from './readRefresh';

/** Where this device keeps the calendar. */
const SESSIONS_SCOPE = 'sessions';

/**
 * How stale a cached calendar may be before it stops being worth showing.
 *
 * Two days, the same as the class timetable and for the same reason: a PT slot
 * that was moved yesterday, shown today as though it were live, sends somebody
 * to the gym at the wrong time. What this keeps is the case it exists for — the
 * member who knows they have a session this morning and is standing in a
 * basement trying to remember when.
 */
const SESSIONS_CACHE_HORIZON_MS = 2 * 24 * 60 * 60 * 1000;

interface SessionsValue {
  sessions: TrainingSession[];
  /** Whether `sessions` is the server's calendar. Under 'error' an empty list
   *  means it could not be read, not that nothing is booked. Under 'partial'
   *  the calendar is longer than what is here — the newest ROW_CAP sessions —
   *  so it may be shown but not counted or totalled. */
  status: LoadStatus;
  /**
   * The sentence to put over a calendar that came off this device rather than
   * off the server, or null when what is on screen was confirmed.
   *
   * Goes with `status === 'error'`: a cached calendar is the "what we had
   * before the failure" case, and it must never render as a live one — a
   * member standing in reception has to be able to tell "you have a session at
   * 6" from "you had one at 6 the last time we could ask".
   */
  cachedNote: string | null;
  /** Add a slot. Rejected (ok:false) if it overlaps an existing session — no
   *  double-booking. `saved` (present only when ok) resolves true once the slot
   *  is on the server, where clients can actually see and book it. */
  addSession: (s: TrainingSession) => { ok: boolean; saved?: Promise<boolean> };
  /** Resolves true only when the booking reached the server. False means the
   *  slot shows as booked on this device alone — and the reminder that was just
   *  scheduled is for a session nobody else knows about. */
  bookSession: (id: string, clientId: string) => Promise<boolean>;
  /** Cancel → slot returns to available and is flagged re-offered. Resolves
   *  true only when the server accepted it; false means the client is still
   *  booked in and the coach's screen is the only thing that says otherwise.
   *
   *  This is the COACH's cancellation. A client cancelling their own booking
   *  goes through `cancelMyBooking`, which also prices the coach's policy and
   *  hands the slot to whoever is first on its waitlist — none of which a
   *  boolean can carry. */
  releaseSession: (id: string) => Promise<boolean>;
  /** The client cancelling their own booked session. One server call that frees
   *  the slot, records the late fee if the coach's policy says so, and promotes
   *  the head of the waitlist — in one transaction, so the freed slot is never
   *  observable as bookable while somebody is waiting for it. */
  cancelMyBooking: (id: string) => Promise<ServerCancel>;
  /** Resolves true only when the row was actually deleted server-side. */
  removeSession: (id: string) => Promise<boolean>;
  /** Re-read the calendar from the server. Screens call this on focus, so a
   *  booking made on somebody else's phone is on this one by the time its owner
   *  looks at it. */
  refresh: () => Promise<void>;
  /**
   * Move a booked session to another OPEN slot of the same coach, atomically.
   *
   * Not cancel-then-book. Those are two acts with a gap in the middle, and the
   * waitlist promotion in part 126 is instantaneous — so a member freeing 07:00
   * to take 18:00 could lose the 07:00 to somebody waiting and then find 18:00
   * gone as well, having asked to move one session and ended up with none.
   *
   * Never charges and never draws or returns a pack credit. A move made inside
   * the coach's notice window is REFUSED with the notice period in the report,
   * rather than priced — supabase/parts/243 has the argument in full.
   */
  rescheduleMyBooking: (fromId: string, toId: string) => Promise<RescheduleReport>;
  /**
   * The COACH moving one of their booked sessions into another of their own
   * open slots, atomically.
   *
   * Separate from `rescheduleMyBooking` because the server functions are
   * separate and must be: `reschedule_my_session` scopes on
   * `client_id = auth.uid()`, so a coach calling it is refused as `not_yours`,
   * and widening it would let a member move somebody else's booking.
   * supabase/parts/461 is the coach's, scoped on `trainer_id`.
   *
   * Never charges, and never draws or returns a pack credit — the credit
   * follows the member and travels with the booking. The freed hour goes to the
   * head of its waitlist inside the same transaction, so it is never observable
   * as bookable while somebody is waiting, and the client being moved is
   * already in their new slot before anybody else is offered the old one.
   */
  rescheduleClientSession: (fromId: string, toId: string) => Promise<CoachMoveReport>;
  /** Client confirms a delivered session, with an optional comment for the trainer.
   *  Goes through the `approve_session` RPC — a client has no write access to
   *  `sessions` or `session_approvals` directly. */
  /**
   * The client agrees a delivered session happened as claimed.
   *
   * `ok` means the server holds it and the coach can see it. `queued` on a
   * false is the third answer: nobody answered, the approval is on this phone,
   * and it goes up on its own — which is not a failure and must not be
   * described as one to somebody standing at reception with no signal.
   */
  approveSession: (id: string, note?: string) => Promise<{ ok: boolean; error?: string; queued?: boolean }>;
  /**
   * The other answer. The client says a delivered session did not happen as
   * claimed.
   *
   * Writes to `session_approvals` and to nothing else: it does not set
   * `sessions.outcome`, so it changes NOTHING about what any payroll run pays.
   * The long version of why is in src/lib/sessionDispute.ts and
   * supabase/parts/241 — a dispute that wrote an outcome would be one party
   * deciding from a phone what the other is paid.
   */
  disputeSession: (id: string, kind: DisputeKind, note?: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * What `cancel_my_session` reports back (supabase/parts/126-*.sql).
 *
 * Every field here is a fact the member is then told, which is why the RPC
 * returns a report rather than a boolean: a screen that has to re-read the row
 * to find out what happened can be told a different story than the one that was
 * written, and the row it would re-read may already belong to somebody else.
 */
export interface ServerCancel {
  /** The server actually freed it. False is a refusal — not this caller's
   *  session, or not booked — and nothing else below it happened. */
  freed: boolean;
  /** Inside the coach's notice window, as the SERVER measured it. */
  late: boolean;
  /** The notice period the server applied. Null when nothing was freed. */
  noticeHours: number | null;
  /** Whether the coach charges for a late cancellation at all. */
  policyApplies: boolean;
  /** The fee, in major units. Null when the policy does not apply or is unset. */
  fee: number | null;
  /** ISO 4217 from the gym. Null means unknown — print no symbol. */
  currency: string | null;
  /** A row really exists in `charges`. Not "would apply", not "may apply". */
  charged: boolean;
  /** The client the slot went to off its waitlist, or null when nobody was
   *  waiting. An opaque id, exactly as `reofferSlot` already returns. */
  promotedClient: string | null;
  /** How many are still waiting on that slot after the promotion. */
  waiting: number;
}

const NOT_FREED: ServerCancel = {
  freed: false, late: false, noticeHours: null, policyApplies: false,
  fee: null, currency: null, charged: false, promotedClient: null, waiting: 0,
};

const toNum = (v: unknown): number | null => {
  // Postgres `numeric` arrives as a string through PostgREST often enough that
  // Number(null) === 0 is a live hazard here: this is a fee, and a 0 printed
  // for "we could not read it" is the whole class of bug this feature replaces.
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const toServerCancel = (d: any): ServerCancel => ({
  freed: !!d?.freed,
  late: !!d?.late,
  noticeHours: toNum(d?.notice_hours),
  policyApplies: !!d?.policy_applies,
  fee: toNum(d?.fee),
  currency: typeof d?.currency === 'string' ? d.currency : null,
  charged: !!d?.charged,
  promotedClient: typeof d?.promoted === 'string' ? d.promoted : null,
  waiting: toNum(d?.waiting) ?? 0,
});

// `outcome` and `outcome_at` have been on every one of these rows since
// supabase/parts/33-session-outcomes.sql and were dropped here, by this mapper,
// on the way in. The read is `select('*')`, so they cost nothing extra to
// carry — and without them neither phone app could say what BECAME of a past
// session, only that one had been booked. Every screen that wanted to know
// therefore had to infer it from the clock, which is the exact inference part
// 33 was written to end.
//
// Unrecognised values are carried through as-is rather than coerced: it is
// `pastVerdict` in src/lib/sessionHistory.ts that decides what an outcome this
// build has never heard of means, and it reads it as unmarked rather than as
// delivered work.
const rowToSession = (r: any): TrainingSession => ({
  id: String(r.id), trainerId: r.trainer_id, clientId: r.client_id,
  startsAt: r.starts_at, durationMin: r.duration_min, status: r.status, released: !!r.released,
  outcome: r.outcome ?? null, outcomeAt: r.outcome_at ?? null,
});

const Ctx = createContext<SessionsValue | null>(null);

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const authRev = useAuthRevision();
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  /** When the calendar on screen was last confirmed, or null when it just was. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  /** True once a server answer has landed this session, so a later failed
   *  refresh cannot replace a live calendar with an older copy of itself. */
  const confirmed = useRef(false);
  /** The account the live subscription is for. In state so an unrelated
   *  re-render does not tear the channel down and reopen it. */
  const [liveUid, setLiveUid] = useState<string | null>(null);
  /** The device's outbox, or null in a tree without one. Null is a normal
   *  state: the write is still attempted and reported honestly. */
  const outbox = useOutbox();


  // Pulled out of the mount effect so the screens can ask for it again. A
  // booking made on the client's phone lands in the database and fires a push,
  // but this provider only ever read the calendar once, at launch — so the
  // coach opened the notification onto the same stale screen they were already
  // looking at, and the session they had just been told about was not on it.
  const hydrate = useCallback(async (cancelled: () => boolean = () => false) => {
    if (!USE_SUPABASE) return;
    {
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled()) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled()) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        setLiveUid(id);

        // ── this device's copy, before the network ─────────────────────────
        //
        // A member in a basement gym could not see the PT session they were
        // standing there for. This is that copy, and it is labelled as one:
        // `cachedNote` is non-null for exactly as long as nothing has confirmed
        // it.
        //
        // Only while nothing has been confirmed this session — a refresh that
        // fails must leave the live calendar it already has on screen.
        if (!confirmed.current) {
          try {
            const cached = readCache<TrainingSession>(await AsyncStorage.getItem(cacheKey(SESSIONS_SCOPE, id)));
            if (cancelled()) return;
            // `rows === null` means the cache taught us nothing. Nothing is
            // assigned, and the empty list on screen keeps whatever the status
            // says about it — it is never turned into "you have no sessions".
            if (cached.rows && cached.rows.length && withinHorizon(cached.at, Date.now(), SESSIONS_CACHE_HORIZON_MS)) {
              setSessions(cached.rows);
              setCachedAt(cached.at);
            }
          } catch { /* no usable cache; the read below is the only source */ }
        }
        // Descending, then reversed below, rather than the ascending read this
        // used to be. Both orders return the same rows until the cap bites; past
        // it they return opposite halves of the calendar, and the ascending half
        // is the useless one. A coach with 1,400 sessions on file would have got
        // their oldest 1,000 — every one of them already delivered — and not a
        // single upcoming booking, on the screen whose whole job is the week
        // ahead. Newest-first keeps the future and drops the ancient history.
        const { data, error } = await supabase.from('sessions').select('*')
          .order('starts_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled()) return;
        if (error) { setStatus('error'); return; }
        // A confirmed empty calendar is a real answer and now reports itself as
        // one, instead of returning down the same path as a failed read.
        if (!data || !data.length) {
          setSessions([]);
          setStatus('ready');
          confirmed.current = true;
          setCachedAt(null);
          // A confirmed empty calendar is cached as an empty calendar. Leaving
          // the previous file in place would resurrect a cancelled session on
          // the next launch that could not reach us.
          AsyncStorage.setItem(cacheKey(SESSIONS_SCOPE, id), packCache<TrainingSession>([]))
            .catch(() => { /* the calendar is right this session either way */ });
          return;
        }
        const page = capped(data);
        // Back to ascending for everyone downstream: the calendar, `overlaps`
        // and the analytics screens were all written against a chronological
        // list, and the read order is a fetching decision, not their business.
        let rows = page.rows.map(rowToSession).reverse();
        // Approvals live in their own table (see supabase/parts/22-session-approvals.sql).
        // A failure here must not cost us the sessions themselves — the screen is
        // still usable without knowing what has been approved.
        try {
          // Keyed on the sessions we actually hold rather than read whole. It
          // was unfiltered, so at scale it would have hit the same 1000-row
          // ceiling and silently dropped approvals off sessions that had them —
          // showing delivered, client-confirmed work as still awaiting sign-off.
          // Scoped this way it cannot exceed the session count, which is capped.
          //
          // And CHUNKED, which the sentence above was one limit short of. The
          // session read directly above ends `.limit(capLimit())`, so `rows` is
          // up to ROW_CAP = 1000 ids, and all thousand went into one `.in()` —
          // about 39 bytes of query string per uuid, so a ~39KB request line
          // against the 8KB nginx and most CDNs allow. The proxy refuses it
          // before the database sees it, supabase-js does not reject on a 414,
          // and it arrives as `data: null`. Which is `appr?.length` false, which
          // is every session on the calendar rendering as awaiting sign-off:
          // the exact outcome the paragraph above was written to prevent,
          // reached through the other limit. A coach then chases a month of
          // clients who have already confirmed. See src/lib/idLookup.ts.
          // no-error-ok: an unread approval leaves the session showing as not-yet-approved, which is what it shows before anyone approves it; the sessions themselves are the point of this screen
          const appr = await readByIds<any>(
            rows.map((r) => r.id),
            // One approval per session (supabase/parts/22), so a chunk of 150
            // ids is one round trip. `.order('session_id')` is total here for
            // that reason, and `readAll` requires a total order of every page.
            (chunk, from, to) => supabase.from('session_approvals')
              .select('session_id, approved_at, note, state, disputed_at, dispute_kind')
              .in('session_id', chunk)
              .order('session_id', { ascending: true })
              .range(from, to),
            'which of your sessions have been signed off',
          );
          if (appr?.length) {
            const byId = new Map(appr.map((a: any) => [String(a.session_id), a]));
            rows = rows.map((r) => {
              const a = byId.get(r.id);
              // `state` and its two companions ride on the same row and the
              // same policy (supabase/parts/241). A row from before that part
              // has no `state` at all, which is why the field is carried
              // through as-is rather than defaulted here: `verdictOf` in
              // src/lib/sessionDispute.ts is the one place that decides what an
              // absent one means, and it reads a stateless row with a timestamp
              // as the approval it could only have been.
              return a ? {
                ...r,
                approvedAt: a.approved_at,
                approvalNote: a.note ?? null,
                approvalState: a.state ?? null,
                disputedAt: a.disputed_at ?? null,
                disputeKind: a.dispute_kind ?? null,
              } : r;
            });
          }
        } catch { /* sessions still load */ }
        if (cancelled()) return;
        setSessions(rows);
        setStatus(page.truncated ? 'partial' : 'ready');
        confirmed.current = true;
        setCachedAt(null);
        // Cached only on a whole read. A truncated page written here would be
        // opened next launch as though it were the calendar, with nothing to
        // say it was a prefix — and the sessions it is missing are the oldest,
        // which is the half that matters least, but "matters least" is not the
        // same as "may be silently presented as all of them".
        if (!page.truncated) {
          AsyncStorage.setItem(cacheKey(SESSIONS_SCOPE, id), packCache(rows))
            .catch(() => { /* the calendar is right this session either way */ });
        }
      } catch { if (!cancelled()) setStatus('error'); }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    hydrate(() => cancelled);
    return () => { cancelled = true; };
  }, [authRev, hydrate]);

  /* ── live ────────────────────────────────────────────────────────────────
   *
   * A booking a coach just made, a session cancelled, a slot re-offered. All of
   * them reached this provider only when somebody left the screen and came
   * back, which is why the hydrate had to be pulled out for a push
   * notification to be able to open onto a correct screen at all.
   *
   * No filter: `sessions` rows are read whole here (row-level security decides
   * whose calendar this is, not a client-side `eq`), and the coach's row and
   * the client's row for the same session are the same row. `useLive` debounces,
   * so a coach publishing a week of slots is one refetch.
   *
   * Approvals get their own subscription because they live in their own table
   * and are what the coach's "awaiting sign-off" state is computed from — a
   * client approving a session at reception should take it off the coach's list
   * without either of them touching anything.
   */
  const refetch = useCallback(() => { void hydrate(); }, [hydrate]);
  /**
   * Send the approvals this device is holding.
   *
   * Registered here because this provider is mounted for the whole app
   * (app/_layout.tsx), so a queued approval always has somebody to send it —
   * unlike a queued message, whose handler had to be lifted to the root.
   */
  useEffect(() => {
    if (!outbox) return;
    return outbox.registerHandler('pt-approval', async (item) => {
      const p = item.payload as any;
      const id = typeof p?.id === 'string' ? p.id : '';
      // A payload nothing can send comes out rather than being retried forever.
      if (!id) return 'refused';
      try {
        const { error } = await supabase.rpc('approve_session', { p_session: id, p_note: p?.note ?? null });
        if (!error) { void hydrate(); return 'stored'; }
        return classifyWrite(error as any, 1) === 'unsent' ? 'unsent' : 'refused';
      } catch { return 'unsent'; }
    });
  }, [outbox, hydrate]);

  useLive({ channel: 'sessions:calendar:' + (liveUid ?? 'none'), table: 'sessions', enabled: !!liveUid, onChange: refetch });
  useLive({ channel: 'sessions:approvals:' + (liveUid ?? 'none'), table: 'session_approvals', enabled: !!liveUid, onChange: refetch });

  const addSession: SessionsValue['addSession'] = (s) => {
    if (overlaps(s.startsAt, s.durationMin, sessions)) return { ok: false };
    const entry = { ...s, trainerId: uid ?? s.trainerId };
    setSessions((p) => [...p, entry]);
    if (!USE_SUPABASE || !uid) return { ok: true, saved: Promise.resolve(false) };
    const saved = (async (): Promise<boolean> => {
      try {
        // `.then(({ data }) => …, () => {})` never read `error`, so a slot the
        // server refused was drawn on the coach's calendar as an open session a
        // client could book — and no client could ever see it.
        const { data, error } = await supabase.from('sessions')
          .insert({ trainer_id: uid, client_id: s.clientId ?? null, starts_at: s.startsAt, duration_min: s.durationMin, status: s.status, released: s.released })
          .select().single();
        if (error || !data) return false;
        setSessions((p) => p.map((x) => (x.id === entry.id ? rowToSession(data) : x)));
        return true;
      } catch { return false; }
    })();
    return { ok: true, saved };
  };

  const bookSession: SessionsValue['bookSession'] = async (id, clientId) => {
    const s = sessions.find((x) => x.id === id);
    // Drawing the booking and scheduling the reminder are what a CONFIRMED
    // booking looks like, so neither happens until the server has confirmed one.
    //
    // `who` is the id the SERVER booked it for, not the one the caller passed.
    // `book_session` writes `auth.uid()` and can write nothing else, so on the
    // server path those two are the same id — except when they are not, and the
    // one case where they are not is the one that shows. app/(client)/calendar.tsx
    // passes `useClientData().id`, which is `sbUid ?? 'unknown'`: a real string,
    // not a null, for the window between mount and the auth read landing. A
    // booking made in that window was recorded locally against 'unknown', and
    // the client's own screen filters its calendar on `s.clientId === cd.id` —
    // so the session they had just successfully booked, and been told was
    // confirmed, was on neither the grid nor the day list until the next
    // refresh. Falling back to `clientId` keeps the offline branch below, where
    // there is no `uid` and nothing has been confirmed by anybody, unchanged.
    const apply = (who: string = clientId) => {
      setSessions((p) => p.map((x) => (x.id === id ? { ...x, status: 'booked', clientId: who, released: false } : x)));
      if (s && s.startsAt) {
        const start = new Date(s.startsAt);
        // With a route. Without one this reminder was the only notification in
        // the app that opened the front door: `addNotificationTapListener`
        // reads `data.route` and does nothing when there is not one, so an
        // hour before their session a client tapped "Session in 1 hour" and
        // landed on the dashboard, with the session they had just been
        // reminded of one more tap away on the calendar.
        // Category 'sessions', so the member's own switch decides whether this
        // arrives — and, deliberately, so quiet hours do NOT move it: they
        // booked a 6:30am session and the warning has to reach them before the
        // session does. See CATEGORIES in src/lib/notifyPrefs.ts.
        scheduleLocal('Session in 1 hour', 'Your training session starts at ' + start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.', new Date(start.getTime() - 60 * 60 * 1000), { route: '/(client)/calendar' }, 'sessions');
      }
    };
    if (!USE_SUPABASE || !uid) { apply(); return false; }
    // `book_session` books only a slot that is still 'available' and belongs to
    // this client's own trainer. When neither holds it updates nothing — and an
    // update that changes no rows is not an error, so the old `!error` reported
    // a slot somebody else had already taken as a confirmed booking, complete
    // with a reminder for a session that did not exist. The RPC now returns
    // whether it booked, and that is what is believed.
    let booked = false;
    try {
      const { data, error } = await supabase.rpc('book_session', { p_session: id });
      if (error) return false;
      if (typeof data === 'boolean') booked = data;
      else {
        // An outcome we cannot read is not a booking. Settle it against the row
        // itself rather than guessing in either direction.
        const { data: row, error: readErr } = await supabase.from('sessions').select('status, client_id').eq('id', id).maybeSingle();
        // A read that failed leaves the outcome unknown, and unknown is not a
        // booking. Reporting false when the row was in fact booked costs the
        // client a second attempt and a re-read that will show it; reporting
        // true when it was not books nobody, reminds them to attend, and draws
        // a session off their pack.
        booked = !readErr && !!row && row.status === 'booked' && row.client_id === uid;
      }
    } catch { return false; }
    if (booked) apply(uid);
    return booked;
  };

  const releaseSession: SessionsValue['releaseSession'] = async (id) => {
    // Drawn only once the server has actually freed it. Painting the slot open
    // first meant a refused cancellation left the screen showing a free slot
    // that was still somebody's booked session.
    const apply = () => setSessions((p) => p.map((x) => (x.id === id ? { ...x, status: 'available', clientId: null, released: true } : x)));
    if (!USE_SUPABASE) { apply(); return false; }
    // Trainer path (RLS-owned direct update) or client path (RPC) — the one the
    // caller is allowed to do takes effect. Both were fired and neither result
    // looked at, so "neither was allowed" was indistinguishable from success.
    // An update the policy filters out is not an error in Postgrest, it just
    // changes zero rows, so the returned rows are what has to be counted.
    try {
      const { data, error } = await supabase.from('sessions').update({ status: 'available', client_id: null, released: true }).eq('id', id).select('id');
      if (!error && data && data.length) { apply(); return true; }
    } catch { /* fall through to the client-side RPC */ }
    // The client path. Same rule as booking: the RPC frees the slot only when
    // the caller is the client actually holding it, and until it reported that,
    // `!error` called a cancellation that changed nothing a success — with the
    // screen going on to tell the whole roster a slot had opened that had not.
    try {
      const { data, error } = await supabase.rpc('cancel_session', { p_session: id });
      if (error) return false;
      let freed: boolean;
      if (typeof data === 'boolean') freed = data;
      else {
        const { data: row, error: readErr } = await supabase.from('sessions').select('status').eq('id', id).maybeSingle();
        freed = !readErr && !!row && row.status === 'available';
      }
      if (freed) apply();
      return freed;
    } catch { return false; }
  };

  // The client's own cancellation, in one server call.
  //
  // `releaseSession` above still exists and is still the coach's path — a
  // direct RLS-owned update on a row they own. It is NOT this, and the two must
  // not be collapsed: this one prices a policy, writes a charge, and hands the
  // slot to a specific other client, none of which a coach cancelling their own
  // slot should do.
  const cancelMyBooking: SessionsValue['cancelMyBooking'] = async (id) => {
    if (!USE_SUPABASE) return NOT_FREED;
    try {
      const { data, error } = await supabase.rpc('cancel_my_session', { p_session: id });
      if (error) return NOT_FREED;
      const out = toServerCancel(data);
      if (!out.freed) return NOT_FREED;
      // Painted only from what the server says it did. A promoted slot is
      // somebody else's booking now, not an open one — drawing it as available
      // would invite this member to book back a slot that is already gone, and
      // `book_session` would refuse them.
      setSessions((p) => p.map((x) => (x.id === id
        ? (out.promotedClient
          ? { ...x, status: 'booked', clientId: out.promotedClient, released: false }
          : { ...x, status: 'available', clientId: null, released: true })
        : x)));
      return out;
    } catch { return NOT_FREED; }
  };

  const removeSession: SessionsValue['removeSession'] = async (id) => {
    // Where the row was, so a deletion the server refuses can be undone rather
    // than leaving a real session invisible until the app is relaunched. The
    // same shape src/ui/roster.tsx uses for `removeClient`, and every other
    // optimistic removal in this folder — clientTags, coachExercises, wellness,
    // invites, programTemplates — restores the same way.
    //
    // The count was already checked and the boolean already honest; what was
    // missing is what the SCREEN does with a refusal. `releaseSession` two
    // functions above makes the argument for the other half of it: "Painting
    // the slot open first meant a refused cancellation left the screen showing
    // a free slot that was still somebody's booked session." A refused DELETE
    // is the same failure one step further on — PostgREST answers a delete that
    // matched nothing with a 204 and `error: null`, no rows and no realtime
    // event, so a stale row or another trainer's slot the policy filters simply
    // vanished off the calendar and was back at the next launch.
    const at = sessions.findIndex((x) => x.id === id);
    const removed = at >= 0 ? sessions[at] : null;
    const putBack = () => {
      if (!removed) return;
      setSessions((p) => (p.some((x) => x.id === id) ? p : [...p.slice(0, at), removed, ...p.slice(at)]));
    };
    setSessions((p) => p.filter((x) => x.id !== id));
    // No backend to refuse it: the row is off the calendar and stays off. Still
    // false, because the documented contract is "true only when the row was
    // actually deleted server-side" and `releaseSession` above answers the same
    // question the same way.
    if (!USE_SUPABASE) return false;
    try {
      // Same reason as above: a delete the policy filters out reports no error
      // and removes nothing, leaving the session to reappear on next launch.
      const { data, error } = await supabase.from('sessions').delete().eq('id', id).select('id');
      if (!error && !!data && data.length > 0) return true;
      if (error) reportError('sessions.remove', error);
      putBack();
      return false;
    } catch (e) { reportError('sessions.remove', e); putBack(); return false; }
  };

  const rescheduleMyBooking: SessionsValue['rescheduleMyBooking'] = async (fromId, toId) => {
    if (!USE_SUPABASE) return NOT_MOVED;
    try {
      const { data, error } = await supabase.rpc('reschedule_my_session', { p_from: fromId, p_to: toId });
      // Checked, and it has to be. `data: null` from a refused RPC would fall
      // through to a report that reads as a refusal with no reason, and the
      // caller would tell somebody their session did not move when we do not
      // know whether it did.
      if (error || !data) { reportError('sessions.reschedule', error ?? new Error('reschedule_my_session returned nothing')); return NOT_MOVED; }
      const r = data as any;
      const report: RescheduleReport = {
        moved: !!r.moved,
        reason: (r.reason ?? null) as RescheduleRefusal | null,
        noticeHours: toNum(r.notice_hours),
        fee: toNum(r.fee),
        currency: typeof r.currency === 'string' ? r.currency : null,
        promoted: !!r.promoted,
        waiting: Number(r.waiting) || 0,
      };
      // The calendar this device holds is now wrong in two places at once, and
      // both of them are the point of the screen. Re-read rather than patched:
      // the freed slot may already belong to whoever was first in line for it.
      if (report.moved) await hydrate();
      return report;
    } catch (e) {
      reportError('sessions.reschedule', e);
      return NOT_MOVED;
    }
  };

  const rescheduleClientSession: SessionsValue['rescheduleClientSession'] = async (fromId, toId) => {
    if (!USE_SUPABASE) return COACH_NOT_MOVED;
    try {
      const { data, error } = await supabase.rpc('reschedule_client_session', { p_from: fromId, p_to: toId });
      // Checked, and it has to be. A refused RPC resolves with `data: null`,
      // and falling through to a report that reads as a plain refusal would
      // have the coach tell a client their hour did not move when nobody knows.
      if (error || !data) {
        reportError('sessions.rescheduleClient', error ?? new Error('reschedule_client_session returned nothing'));
        return COACH_NOT_MOVED;
      }
      const r = data as any;
      const report: CoachMoveReport = {
        moved: !!r.moved,
        reason: (r.reason ?? null) as CoachMoveRefusal | null,
        clientId: typeof r.client === 'string' ? r.client : null,
        promoted: !!r.promoted,
        waiting: Number(r.waiting) || 0,
      };
      // Two rows on this device are now wrong at once and both are the point of
      // the screen. Re-read rather than patched: the freed hour may already
      // belong to whoever was first in line for it.
      if (report.moved) await hydrate();
      return report;
    } catch (e) {
      reportError('sessions.rescheduleClient', e);
      return COACH_NOT_MOVED;
    }
  };

  const approveSession: SessionsValue['approveSession'] = async (id, note) => {
    const trimmed = (note || '').trim();
    if (!USE_SUPABASE) return { ok: false, error: 'Not signed in to the server.' };
    /**
     * Nobody answered. Keep the approval on this phone.
     *
     * This is one of the writes that may safely wait, and it is worth spelling
     * out why when a class booking may not: approving is a statement about work
     * that has ALREADY happened, it allocates nothing anybody else can take,
     * and the answer the server would give now is the answer it will give in an
     * hour. A member who approves their session at reception, where the signal
     * is worst, should not have to remember to do it again later.
     *
     * It is still `ok: false`, because `ok` means the coach can see it.
     */
    const keep = async (): Promise<{ ok: boolean; error?: string; queued?: boolean }> => {
      if (!outbox) return { ok: false, error: 'Could not reach the server.' };
      const { result } = await outbox.enqueue('pt-approval', { id, note: trimmed || null });
      return result === 'queued'
        ? { ok: false, queued: true, error: 'No signal, so this is saved on this phone and has not reached your trainer yet. It goes as soon as you are back online.' }
        : { ok: false, error: 'Could not reach the server.' };
    };
    try {
      const { error } = await supabase.rpc('approve_session', { p_session: id, p_note: trimmed || null });
      // A refusal is the server having read it and said no — a session that is
      // not this member's, one already disputed by the coach. Offering the same
      // call again gets the same answer, so it is not kept.
      if (error) return classifyWrite(error as any, 1) === 'unsent' ? keep() : { ok: false, error: error.message };
    } catch {
      return keep();
    }
    // Only after the server accepted it — an approval that exists on this phone
    // and nowhere else is exactly the bug this replaced.
    // Approving is also how a dispute is withdrawn, so the three dispute fields
    // are cleared here as well. Leaving them would show a session as both
    // approved and disputed on this device until the next hydrate, which is the
    // one state the database's own constraints refuse to hold.
    setSessions((p) => p.map((x) => (x.id === id
      ? { ...x, approvedAt: new Date().toISOString(), approvalNote: trimmed || null, approvalState: 'approved' as const, disputedAt: null, disputeKind: null }
      : x)));
    return { ok: true };
  };

  const disputeSession: SessionsValue['disputeSession'] = async (id, kind, note) => {
    const trimmed = (note || '').trim();
    if (!USE_SUPABASE) return { ok: false, error: 'Not signed in to the server.' };
    try {
      const { error } = await supabase.rpc('dispute_session', { p_session: id, p_kind: kind, p_note: trimmed || null });
      if (error) return { ok: false, error: error.message };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not reach the server.' };
    }
    // Only after the server accepted it, exactly as approveSession does. A
    // dispute that exists on this phone and nowhere else is a member who
    // believes their coach has been told and has not been.
    setSessions((p) => p.map((x) => (x.id === id
      ? { ...x, approvedAt: null, approvalNote: trimmed || null, approvalState: 'disputed' as const, disputedAt: new Date().toISOString(), disputeKind: kind }
      : x)));
    return { ok: true };
  };

  // Computed per render rather than stored: the sentence says how long ago, and
  // a stored one would go on saying "4 minutes ago" while the screen stays open.
  const cachedNote = cachedAtLine(cachedAt);

  // Re-run this read when the signal comes back, without the member having to
  // know the app is stuck and think to pull down. src/lib/readRefresh.ts.
  useRecoverRead('sessions', status, () => { void hydrate(); });

  // ── why this is not an inline object ──────────────────────────────────────
  //
  // It was one, and it cost 782 requests in five IDLE minutes on a single
  // handset — a ~2/second lap of getUser → sessions → session_approvals, read
  // off this project's own edge logs. An inline literal makes `useSessions()`
  // return a different value on every render of this provider, and `refresh`
  // a different function again. A consumer writing the obvious thing —
  // `useFocusEffect(useCallback(() => { s.refresh(); }, [s]))` — then builds a
  // machine that cannot stop: the effect re-runs when its callback's identity
  // changes, `refresh` re-runs `hydrate`, `hydrate` ends in a `setSessions`
  // with a freshly-built array, the provider re-renders, and both identities
  // are new again.
  //
  // src/ui/roster.tsx:596 documents this exact defect and fixes it there; the
  // reasoning is worth reading and is not repeated here. This provider never
  // got the same treatment, and it is read by more screens than roster is —
  // app/(client)/calendar.tsx and app/(client)/standing.tsx were both looping
  // on it.
  //
  // The wrappers are created once and read the current implementations out of
  // a ref, so they are stable for the life of the provider while still closing
  // over this render's state. Freezing the implementations themselves in a
  // `useCallback` would freeze the state they close over with them, which is
  // the bug one level down.
  const impl = useRef({
    hydrate, addSession, bookSession, releaseSession, cancelMyBooking, removeSession,
    approveSession, disputeSession, rescheduleMyBooking, rescheduleClientSession,
  });
  impl.current = {
    hydrate, addSession, bookSession, releaseSession, cancelMyBooking, removeSession,
    approveSession, disputeSession, rescheduleMyBooking, rescheduleClientSession,
  };

  const refreshStable = useCallback(() => impl.current.hydrate(), []);
  const addStable = useCallback<SessionsValue['addSession']>((...a) => impl.current.addSession(...a), []);
  const bookStable = useCallback<SessionsValue['bookSession']>((...a) => impl.current.bookSession(...a), []);
  const releaseStable = useCallback<SessionsValue['releaseSession']>((...a) => impl.current.releaseSession(...a), []);
  const cancelStable = useCallback<SessionsValue['cancelMyBooking']>((...a) => impl.current.cancelMyBooking(...a), []);
  const removeStable = useCallback<SessionsValue['removeSession']>((...a) => impl.current.removeSession(...a), []);
  const approveStable = useCallback<SessionsValue['approveSession']>((...a) => impl.current.approveSession(...a), []);
  const disputeStable = useCallback<SessionsValue['disputeSession']>((...a) => impl.current.disputeSession(...a), []);
  const rescheduleMineStable = useCallback<SessionsValue['rescheduleMyBooking']>((...a) => impl.current.rescheduleMyBooking(...a), []);
  const rescheduleClientStable = useCallback<SessionsValue['rescheduleClientSession']>((...a) => impl.current.rescheduleClientSession(...a), []);

  // Identity now changes only when something a consumer can actually see has:
  // the calendar, how much of it we trust, or whether it came off this device.
  const value = useMemo<SessionsValue>(() => ({
    sessions, status, cachedNote,
    refresh: refreshStable,
    addSession: addStable,
    bookSession: bookStable,
    releaseSession: releaseStable,
    cancelMyBooking: cancelStable,
    removeSession: removeStable,
    approveSession: approveStable,
    disputeSession: disputeStable,
    rescheduleMyBooking: rescheduleMineStable,
    rescheduleClientSession: rescheduleClientStable,
  }), [
    sessions, status, cachedNote,
    refreshStable, addStable, bookStable, releaseStable, cancelStable, removeStable,
    approveStable, disputeStable, rescheduleMineStable, rescheduleClientStable,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessions(): SessionsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessions must be used inside <SessionsProvider>');
  return v;
}

// ── Cancelling a PT session, once, for every screen that offers it ─────────
//
// A client can cancel the same booked session from two places: the Book screen
// (app/(client)/calendar.tsx) and My Bookings (app/(client)/bookings.tsx). Only
// the first of them did the whole job. My Bookings called `releaseSession` and
// stopped, so the same tap on the same session had different consequences
// depending on which screen the member happened to be on:
//
//   · the pack credit was NOT returned on a cancellation more than 24h out, so
//     cancelling from My Bookings quietly cost the member a session they had
//     paid for and cancelling from Book did not. That is the whole of the bug
//     worth caring about: it is money, it is the member's, and nothing on
//     either screen said the two buttons were different.
//   · the freed slot was not offered to the coach's other clients, so the
//     coach lost the hour as well.
//   · the coach was not told at all.
//
// The fix is this function rather than a second copy of those twenty-five
// lines, because a second copy is how the two screens came apart in the first
// place and would be how they came apart again. The screens keep their own
// alerts — they are worded for where the reader is standing — but the writes,
// their order, and the sentences that describe money are here.
//
// Deliberately NOT a hook: `cancelMyBooking` comes from the provider and is
// passed in, so this stays a plain async function that can be called from an
// Alert handler on either screen.
//
// ── What changed when the fee and the waitlist arrived ────────────────────
//
// The release used to be a boolean from `releaseSession`. It is now the report
// from `cancel_my_session`, which frees the slot, prices the coach's policy,
// writes the charge and promotes the waitlist head IN ONE TRANSACTION. Two
// things follow from that and both are load-bearing:
//
//   · the re-offer push is no longer sent when somebody was waiting. A waitlist
//     that ends in "first to book it gets it" is not a waitlist, it is the race
//     it was supposed to replace — the person at the top of the queue would be
//     beaten to their own slot by whoever happened to be holding their phone.
//     Where there IS a queue, one person is told the slot is theirs; where
//     there is not, the old broadcast stands unchanged.
//   · the fee is decided by the SERVER and reported, never computed here. This
//     device can say what the member was WARNED about; only the database can
//     say whether a row exists.
export interface PtCancelOutcome {
  /** The server actually freed the slot. Everything else is meaningless when
   *  this is false, and nothing below it was attempted. */
  freed: boolean;
  /** Inside the coach's notice window as the SERVER measured it at the moment
   *  it acted — the fee that was recorded, or not, followed from this. */
  late: boolean;
  /** Inside the notice window as THIS DEVICE measured it when the member was
   *  warned, which is what decides the pack credit. See `cancelBookedSession`:
   *  the deal somebody was shown has to be the deal they get, and only this
   *  side of it is under our control. */
  lateWhenAsked: boolean;
  /** A row exists in `charges`. Not "would apply" — the record itself. */
  charged: boolean;
  /** Whether the coach charges for late cancellations at all. Separate from
   *  `charged` so the one case that needs saying can be said: the policy
   *  applies and yet nothing was written down. */
  policyApplies: boolean;
  /** The fee that was recorded, in major units, or null. */
  fee: number | null;
  /** ISO 4217 for `fee`. Null means unknown, and no symbol may be printed. */
  currency: string | null;
  /** The notice period the server applied, or null when it did not answer. */
  noticeHours: number | null;
  /** Whether the freed slot went straight to somebody on its waitlist. */
  promoted: boolean;
  /** How many are still waiting on that slot afterwards. */
  waiting: number;
  /** Whether the person who was promoted was told. Null when nobody was. */
  promotedTold: boolean | null;
  /** A credit was actually put back on a pack. False also covers "there was no
   *  pack", which is the ordinary case for a member who pays per session. */
  refunded: boolean;
  /** How many of the coach's other clients the freed slot was offered to.
   *  null means there were none to offer it to — which is not the same as a
   *  push that failed, and the two get different sentences. */
  offeredTo: number | null;
  /** Whether that offer actually went out. null when there was nobody to send
   *  it to. */
  offerPushed: boolean | null;
  /** Whether the coach was told their slot re-opened. */
  coachTold: boolean;
  /** The pack balance re-read after the refund, or null when it could not be
   *  read. Never write null over a balance already on screen — a failed re-read
   *  is not news about the balance. */
  packLeft: number | null;
}

/**
 * Free a booked PT session and settle everything that goes with it.
 *
 * The order is the one app/(client)/calendar.tsx has used since the re-offer
 * bug, and it is load-bearing: the slot is freed FIRST, and only then is anyone
 * told it is free. Told first, the quickest client to respond was refused by a
 * slot that had not been released yet. The server now closes that window
 * outright for a slot with a waitlist — freeing it and handing it over are one
 * transaction — but the order here still matters for the broadcast case.
 *
 * `now` is the instant the CALLER decided this was or was not a late cancel —
 * not the instant this function runs. Both screens warn the member before they
 * confirm, and the deal they were shown has to be the deal they get. Left to
 * default, a member who read that warning at 24h01m and thought about it for
 * two minutes would lose their credit under a rule that said they would not,
 * and the only direction the drift runs is against them, because time only
 * moves one way. That is why the PACK CREDIT is still decided here, from
 * `now`, while the FEE is decided by the server: the credit is ours to be fair
 * about, and the charge is a record that has to be true.
 *
 * `policy` is the coach's, as the screen read it. Passing null falls back to
 * the standing 24 hours — which is what this function did unconditionally
 * before coaches could state a notice period at all.
 */
export async function cancelBookedSession(
  session: Pick<TrainingSession, 'id' | 'startsAt' | 'trainerId'>,
  cancelOnServer: (id: string) => Promise<ServerCancel>,
  now: number = Date.now(),
  policy: CancellationPolicy | null = null,
): Promise<PtCancelOutcome> {
  // `starts_at - now < notice`, which is also true of a session that has
  // already started. That is deliberate and is NOT `isLateCancellation` from
  // src/lib/booking.ts, which requires the session to still be in the future.
  //
  // The difference is a refund. Under this rule a member cancelling a session
  // that has already begun keeps no credit, which is what both screens have
  // always done and what a coach standing in an empty gym would expect. Under
  // `isLateCancellation` that same cancellation would come back "not late" and
  // this function would hand the credit BACK. `insideNoticeWindow` is that
  // exact expression, lifted into src/lib/booking.ts where it is tested against
  // `isLateCancellation` so the two cannot be swapped by accident.
  const noticeHours = noticeHoursOf(policy);
  const lateWhenAsked = insideNoticeWindow(session.startsAt, noticeHours, now);
  const start = new Date(session.startsAt);
  // Both of these leave this handset and arrive on somebody else's. The day was
  // a hardcoded `['Sun', …][getDay()]` and the time was a hand-rolled 12-hour
  // clock with an English am/pm glued on — so a member whose phone is in
  // Spanish, Arabic or German was pushed "Thu 7pm", and a member in a 24-hour
  // locale was pushed a form of the clock their country does not write. Neither
  // is a formatting nicety: this is the notification that tells somebody when
  // the session they are being offered actually is, and they act on it.
  // `weekdayNameShort` and `fmtClock` are the reader's own language and the
  // reader's own clock, and both fall back to exactly these two English forms
  // on a Hermes build with no Intl, so nothing regresses where nothing can ask.
  const at = fmtClock(start.getHours(), start.getMinutes());
  const dow = weekdayNameShort(start.getDay());

  const res = await cancelOnServer(session.id);
  if (!res.freed) {
    return {
      freed: false, late: false, lateWhenAsked, charged: false, policyApplies: false, fee: null, currency: null,
      noticeHours: null, promoted: false, waiting: 0, promotedTold: null,
      refunded: false, offeredTo: null, offerPushed: null, coachTold: false, packLeft: null,
    };
  }

  // ── who is told the slot is free ────────────────────────────────────────
  //
  // Exactly one of these two happens. When the server promoted somebody, the
  // slot is already theirs and the only person with news is them; broadcasting
  // "first to book it gets it" to the whole roster would be an invitation to
  // race for a session that is not available, and every one of them would be
  // refused by `book_session`. When nobody was waiting, the broadcast is what
  // it always was.
  let offeredTo: number | null = null;
  let offerPushed: boolean | null = null;
  let promotedTold: boolean | null = null;
  if (res.promotedClient) {
    promotedTold = (await sendPushChecked(
      [res.promotedClient],
      'The slot you were waiting for is yours',
      `${dow} ${at} with your coach just freed up and you were next on the list — it is booked for you.`,
      { route: '/(client)/calendar' },
    )).ok;
  } else {
    // Server-side lookup on THIS session's trainer, so no other client's
    // identity reaches the caller beyond opaque ids.
    const others = await reofferSlot(session.id);
    offeredTo = others.length || null;
    offerPushed = others.length === 0
      ? null
      // `dow` as well as `at`. This is the one of the three pushes that goes to
      // the WHOLE roster, and it was the only one that named a time without a
      // day: "7pm with your coach just opened up — first to book it gets it."
      // A member reads that on Tuesday evening, assumes tonight, and opens the
      // app to race for a slot that is on Thursday — or does not open it at all
      // because tonight is impossible for them, and never learns the slot was
      // on a day they were free. The other two pushes in this function already
      // carried the day; this one is the one that most needed it.
      : (await sendPushChecked(others, 'A PT slot just opened', `${dow} ${at} with your coach just opened up — first to book it gets it.`, { route: '/(client)/calendar' })).ok;
  }

  // `refundSession` answers ok:false both when there is no pack to credit and
  // when the server refused the update. Its answer is carried, not discarded —
  // discarding it is how a member comes to believe they are holding a credit
  // they do not have.
  const refund = lateWhenAsked ? { ok: false } : await refundSession(session.trainerId);
  const packLeft = await sessionsRemaining();

  const coachTold = (await sendPushChecked(
    [session.trainerId],
    'Session cancelled',
    `A client cancelled ${dow} ${at}.${res.promotedClient ? ' It went straight to the next client on its waitlist.' : ' The slot re-opened.'}${res.charged ? ' (Late cancel — fee recorded.)' : ''}`,
    { route: '/(trainer)/calendar' },
    // 'bookings'. The coach may mute chat and still be told their morning
    // changed — which is the whole point of the categories, and this is the
    // notification that most obviously has to survive one.
    'bookings',
  )).ok;

  return {
    freed: true,
    late: res.late,
    lateWhenAsked,
    charged: res.charged,
    policyApplies: res.policyApplies,
    fee: res.fee,
    currency: res.currency,
    noticeHours: res.noticeHours,
    promoted: !!res.promotedClient,
    waiting: res.waiting,
    promotedTold,
    refunded: refund.ok,
    offeredTo,
    offerPushed,
    coachTold,
    packLeft,
  };
}

/**
 * What to tell the member afterwards. Here rather than on either screen because
 * these are the sentences about their money, and two screens wording those
 * differently is the same defect as two screens doing different things.
 *
 * `at` is the session's time as that screen already renders it.
 */
export function ptCancelLines(o: PtCancelOutcome, at: string): string[] {
  const lines: string[] = [];
  // The pack credit, on the rule the member was WARNED under. `lateWhenAsked`,
  // not `late`: the server may have crossed the boundary in the seconds the
  // member spent reading the alert, and the credit is not the place to hold
  // them to a rule that changed under them.
  const w = o.noticeHours ?? 24;
  if (o.lateWhenAsked) lines.push(`Cancelled within ${w} hour${w === 1 ? '' : 's'} — this session is charged from your package.`);
  else if (o.refunded) lines.push(`Your ${at} session was cancelled and returned to your package.`);
  else lines.push(`Your ${at} session was cancelled. Nothing was returned to a session pack — if you booked it with a pack credit, check your package before booking again.`);

  // The fee, and only when a row really exists. `feeRecordedLine` returns null
  // when nothing was charged, so there is no branch on which this app claims a
  // charge it did not make — and every branch that does mention one says
  // Repple is not taking the money.
  const fee = feeRecordedLine(o.charged, o.fee, o.currency);
  if (fee) lines.push(fee);
  // The member was told a fee applied and then none was recorded. That is not
  // silence-worthy: they will be expecting one.
  else if (o.late && o.policyApplies) {
    lines.push('Your coach’s late-cancellation policy applies to this one, but no fee was recorded — check with them what you owe.');
  }

  // Where the slot went. One of three, and the waitlist case is the only one
  // that names a person rather than a broadcast.
  if (o.promoted) {
    lines.push(o.promotedTold === false
      ? 'The slot went straight to the next client on its waitlist. We couldn’t notify them, so your coach may need to.'
      : 'The slot went straight to the next client on its waitlist — nobody had to race for it.');
  } else {
    lines.push(o.offerPushed === true ? `The freed slot was offered to your coach's other clients.`
      : o.offerPushed === false ? `The slot is open again, but we couldn't tell your coach's other clients about it.`
      : `The slot is open again on your coach's calendar.`);
  }
  if (!o.coachTold) lines.push('We couldn’t notify your coach — message them if this session is soon.');
  return lines;
}

/* ── The coach's cancellation policy, as each side of it needs it ───────────
 *
 * There are two of these because they are two different questions asked by two
 * different people, and the row they touch is not the same row:
 *
 *   `useCancellationPolicy`   the CLIENT asking what they are held to. It goes
 *                             through `my_cancellation_policy`, which resolves
 *                             their own coach and that coach's gym currency —
 *                             a client cannot be trusted to name a trainer_id,
 *                             and should not have to.
 *   `useMyCancellationPolicy` the COACH stating it. A direct read and write of
 *                             their own `trainers` row under `trainers_self_rw`.
 *
 * Neither invents a policy. A read that failed is `status: 'error'` and the
 * screens say so: "we could not read your coach's policy" is a different
 * sentence from "your coach does not charge one", and printing the second for
 * the first is how somebody comes to believe a cancellation is free.
 */
export function useCancellationPolicy(): { policy: CancellationPolicy | null; status: LoadStatus; reload: () => void } {
  const authRev = useAuthRevision();
  const [policy, setPolicy] = useState<CancellationPolicy | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        // Signed out is a true answer, not a failed read. Latching 'error' on
        // the first tick before anybody has signed in is the bug the hydrate
        // above this file was fixed for; it is not repeated here.
        if (!sess?.session) { setPolicy(null); setStatus('ready'); return; }
        const { data, error } = await supabase.rpc('my_cancellation_policy');
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        // A null answer means this user has no coach — which is not a policy of
        // "no fee", and the screens word the two differently.
        if (!data) { setPolicy(null); setStatus('ready'); return; }
        const d = data as any;
        setPolicy({
          applies: !!d.applies,
          noticeHours: toNum(d.notice_hours) ?? 24,
          fee: toNum(d.fee),
          currency: typeof d.currency === 'string' ? d.currency : null,
        });
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [authRev, nonce]);

  return { policy, status, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export interface MyCancellationPolicy {
  applies: boolean;
  noticeHours: number;
  fee: number | null;
  /** The gym's, read-only here. A coach does not pick the currency per policy. */
  currency: string | null;
  status: LoadStatus;
  /** Why the last edit has not been stored, or null. The database refuses a
   *  policy that applies with no amount behind it (`trainers_late_cancel_fee_stated`),
   *  so the coach is told BEFORE the write rather than after it fails. */
  blocker: string | null;
  setApplies: (v: boolean) => void;
  setNoticeHours: (v: number) => void;
  setFee: (v: number | null) => void;
  /** Read the `trainers` columns and the gym's currency again. Under 'error'
   *  the policy on screen is the empty default and NOT the coach's own, so a
   *  screen stating a fee needs a way to ask a second time. */
  reload: () => void;
  /**
   * Whether the last edit actually reached the server.
   *
   * The write here ended `.then(() => {}, () => {})` — both arms empty, both
   * outcomes discarded — behind a 600 ms debounce whose cleanup was
   * `clearTimeout`. React runs that cleanup on unmount as well as on every
   * dependency change, so a coach who typed a fee and tapped Back inside half a
   * second had the write CANCELLED: never attempted, with nothing on screen
   * having suggested anything was in flight. src/ui/coachProfile.tsx had both
   * defects and src/lib/profileSave.ts is the answer it grew; this is the same
   * answer for the one setting in this app a client can be held to.
   */
  save: SaveStatus;
}

export function useMyCancellationPolicy(): MyCancellationPolicy {
  const [applies, setApplies] = useState(false);
  const [noticeHours, setNoticeHours] = useState(24);
  const [fee, setFee] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);
  // Nothing is written back before the server copy has been read for this uid,
  // or the empty defaults above would clobber a policy the coach already has.
  const [synced, setSynced] = useState(false);
  // Bumped by `reload`. `synced` is cleared with it, which is what keeps the
  // debounced write below from firing the empty defaults at the server while
  // the re-read is in flight — the same guard the first read already relies on.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // Not issued at all off the coach app. These are the SIGNED-IN user's own
    // `trainers` columns, and on the client app the signed-in user is the
    // client — the same refusal `useMyTrainerProfile` makes physical.
    if (!USE_SUPABASE || VARIANT !== 'trainer') { setStatus('ready'); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (cancelled) return;
        const id = auth?.user?.id ?? null;
        setUid(id);
        if (!id) { setStatus('ready'); setSynced(true); return; }
        const { data, error } = await supabase.from('trainers')
          .select('late_cancel_applies, late_cancel_notice_hours, late_cancel_fee, tenant_id')
          .eq('id', id).maybeSingle();
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        const t = data as any;
        if (t) {
          setApplies(!!t.late_cancel_applies);
          setNoticeHours(toNum(t.late_cancel_notice_hours) ?? 24);
          setFee(toNum(t.late_cancel_fee));
          if (t.tenant_id) {
            // no-error-ok: an unread currency renders the fee as a bare number, which is what a coach with no gym gets anyway; the policy itself is still editable
            const { data: tn } = await supabase.from('tenants').select('currency').eq('id', t.tenant_id).maybeSingle();
            if (!cancelled && typeof (tn as any)?.currency === 'string') setCurrency((tn as any).currency);
          }
        }
        if (!cancelled) { setStatus('ready'); setSynced(true); }
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  const reloadPolicy = useCallback(() => {
    setSynced(false);
    setStatus(USE_SUPABASE && VARIANT === 'trainer' ? 'loading' : 'ready');
    setNonce((n) => n + 1);
  }, []);

  // The database refuses `applies` without an amount, so the same rule is stated
  // here and the write is simply not sent while it is broken. A form that
  // accepts what a coach types and silently drops it is the failure mode this
  // screen family already has a rule about.
  const blocker = applies && (fee == null || !(fee > 0))
    ? 'Set an amount before switching the policy on — a fee of nothing is a policy that does not apply.'
    : null;

  const [save, setSave] = useState<SaveStatus>(IDLE_SAVE);
  // The values the next write should carry, in a ref so the unmount flush can
  // fire without being in anybody's dependency array.
  const latest = useRef({ applies, noticeHours, fee, uid });
  latest.current = { applies, noticeHours, fee, uid };
  /** An edit that has not reached the server. Cleared only by a write that came
   *  back confirmed, so a refused one stays dirty and is flushed again. */
  const dirty = useRef(false);

  /**
   * Write the policy, and count what the server changed.
   *
   * `{ count: 'exact' }`, because a PostgREST update that matched no rows is not
   * an error — it is the state a coach whose `trainers` row an RLS policy
   * refuses actually gets, and `!error` said it saved. This is the fee a coach
   * charges somebody for not turning up, and the profile screen quoting it tells
   * them Repple records it and never collects it. Over a value that may never
   * have been sent, that sentence is worse than nothing.
   */
  const flushPolicy = useCallback(async (): Promise<void> => {
    const v = latest.current;
    if (!USE_SUPABASE || VARIANT !== 'trainer' || !v.uid) return;
    try {
      const r = await supabase.from('trainers').update({
        late_cancel_applies: v.applies,
        late_cancel_notice_hours: v.noticeHours,
        late_cancel_fee: v.fee,
      }, { count: 'exact' }).eq('id', v.uid);
      const why = writeFailure('Your cancellation policy', r);
      if (why) {
        if (r.error) reportError('cancellationPolicy.persist', r.error);
        // Left dirty: the policy is still only on this handset, and the next
        // edit or the unmount flush should try it again.
        setSave((prev) => afterWrite(prev, false, Date.now(), why));
        return;
      }
      dirty.current = false;
      setSave((prev) => afterWrite(prev, true, Date.now()));
    } catch (e) {
      reportError('cancellationPolicy.persist', e);
      setSave((prev) => afterWrite(prev, false, Date.now(), null));
    }
  }, []);

  useEffect(() => {
    if (!USE_SUPABASE || VARIANT !== 'trainer' || !uid || !synced || blocker) return;
    dirty.current = true;
    setSave(markPending);
    const timer = setTimeout(() => { void flushPolicy(); }, 600);
    return () => clearTimeout(timer);
  }, [applies, noticeHours, fee, uid, synced, blocker, flushPolicy]);

  // ── the write that used to be cancelled on the way out ────────────────────
  //
  // Mount-only, so its cleanup runs ONLY on unmount and cannot defeat the
  // debounce above. Not awaited, because a component coming apart cannot be held
  // open; the request outlives it either way, and `dirty` means this is reached
  // only when there is something that has genuinely not landed. The same shape
  // src/ui/coachProfile.tsx uses, for the same gesture: type a fee, tap Back.
  useEffect(() => () => { if (dirty.current) void flushPolicy(); }, [flushPolicy]);

  return { applies, noticeHours, fee, currency, status, blocker, setApplies, setNoticeHours, setFee, reload: reloadPolicy, save };
}

/* ── The waitlist, from the client's side ──────────────────────────────────
 *
 * Two reads and two writes, in one hook, because every screen that offers one
 * needs the other: a slot you can wait for is only interesting alongside where
 * you already are in a queue, and leaving a queue has to change both.
 *
 * `taken` cannot come from the sessions store. `sessions_client_read` shows a
 * client their OWN sessions and their coach's OPEN ones — a slot somebody else
 * has booked is invisible to them, which is why it was never possible to wait
 * for one. `waitlistable_slots` answers the narrow question instead, and
 * returns no client identity for any of them: a member learns that an hour is
 * taken, not by whom.
 */
export interface TakenSlot {
  sessionId: string;
  startsAt: string;
  durationMin: number;
  waiting: number;
  /** 1-based. 0 means this member is not on that queue. */
  myPosition: number;
}
export interface MyWaitlistRow {
  sessionId: string;
  startsAt: string;
  durationMin: number;
  trainerId: string;
  position: number;
  waiting: number;
  /** Whether the slot is still somebody else's. False means it freed and did
   *  not come to this member — the queue moved past them, or the session was
   *  opened up rather than promoted. */
  stillTaken: boolean;
}

/**
 * The ceiling `waitlistable_slots()` takes, mirrored here because nothing on
 * this side can see it.
 *
 * `limit 500` is inside the function body
 * (supabase/parts/126-the-late-fee-and-the-waitlist.sql), so src/lib/rowCap.ts
 * cannot find it: `capped()` detects a cut by asking for one row more than it
 * will accept, and the server will never answer with 501.
 *
 * It is reachable, which is the part that matters. The function returns one
 * coach's booked hours over the whole window this hook asks for — sixty days by
 * default — so a coach running eight or nine sessions a day passes five hundred
 * inside it. And the order is `starts_at asc`, so what a cut list loses is the
 * FAR END: app/(client)/calendar.tsx draws "Nothing on this day" from
 * `selDayTaken.length === 0`, and under a silent cut that sentence is printed
 * over a day that is really full, to a member who would have joined the
 * waitlist for it.
 *
 * `>= cap` and not `> cap`, as in src/lib/challenges.ts: five hundred rows back
 * from a `limit 500` is already the ceiling and there is no probe row to find.
 */
const SLOTS_ROW_CAP = 500;

export function useSlotWaitlist(daysAhead: number = 60): {
  taken: TakenSlot[];
  mine: MyWaitlistRow[];
  status: LoadStatus;
  reload: () => Promise<void>;
  join: (sessionId: string) => Promise<{ ok: boolean; position?: number; waiting?: number; error?: string }>;
  leave: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
} {
  const authRev = useAuthRevision();
  const [taken, setTaken] = useState<TakenSlot[]>([]);
  const [mine, setMine] = useState<MyWaitlistRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setTaken([]); setMine([]); setStatus('ready'); return; }
      const from = new Date().toISOString();
      const to = new Date(Date.now() + daysAhead * 86_400_000).toISOString();
      const [slots, queue] = await Promise.all([
        supabase.rpc('waitlistable_slots', { p_from: from, p_to: to }),
        // sql-cap-ok: my_waitlist() ends `limit 500` on the caller's OWN
        // waitlist entries — the queues one member has personally joined. The
        // slots read above shares that ceiling and is checked against it,
        // because it covers a whole coach's diary over sixty days and gets
        // there; this one would need one person to be waiting on five hundred
        // separate hours, and joining a queue is a deliberate act taken one
        // slot at a time. The two figures on each row, `queue_position` and
        // `waiting`, are counted server-side over the full table rather than
        // over this page, so neither is a total taken from a prefix; and
        // app/(client)/bookings.tsx lists these rows without counting them.
        supabase.rpc('my_waitlist'),
      ]);
      // Either read failing makes this a fragment, and a fragment must not be
      // drawn as "nothing is taken" or "you are waiting for nothing".
      if (slots.error || queue.error) { setStatus('error'); return; }
      setTaken(((slots.data as any[]) ?? []).map((r) => ({
        sessionId: String(r.session_id),
        startsAt: r.starts_at,
        durationMin: toNum(r.duration_min) ?? 60,
        waiting: toNum(r.waiting) ?? 0,
        myPosition: toNum(r.my_position) ?? 0,
      })));
      setMine(((queue.data as any[]) ?? []).map((r) => ({
        sessionId: String(r.session_id),
        startsAt: r.starts_at,
        durationMin: toNum(r.duration_min) ?? 60,
        trainerId: String(r.trainer_id),
        position: toNum(r.queue_position) ?? 0,
        waiting: toNum(r.waiting) ?? 0,
        stillTaken: !!r.still_taken,
      })));
      // The slots read has a ceiling of its own, below PostgREST's, and it had
      // never been looked at — see SLOTS_ROW_CAP above. 'partial' rather than
      // 'ready', so the screens gate their emptiness sentences on it.
      //
      // `my_waitlist` on the line above is capped too and is deliberately not
      // tested: see the sql-cap-ok note on its call.
      setStatus(((slots.data as any[]) ?? []).length >= SLOTS_ROW_CAP ? 'partial' : 'ready');
    } catch { setStatus('error'); }
  }, [daysAhead]);

  useEffect(() => { load(); }, [authRev, load]);

  const join = useCallback(async (sessionId: string) => {
    if (!USE_SUPABASE) return { ok: false, error: 'Not connected to the server.' };
    try {
      const { data, error } = await supabase.rpc('join_session_waitlist', { p_session: sessionId });
      // The RPC refuses in words a member can act on — the slot is open, it has
      // already started, it is not this coach's. Those are carried through
      // rather than flattened into "could not join".
      if (error) return { ok: false, error: error.message };
      await load();
      const d = data as any;
      return { ok: true, position: toNum(d?.position) ?? undefined, waiting: toNum(d?.waiting) ?? undefined };
    } catch (e: any) { return { ok: false, error: e?.message || 'Could not reach the server.' }; }
  }, [load]);

  const leave = useCallback(async (sessionId: string) => {
    if (!USE_SUPABASE) return { ok: false, error: 'Not connected to the server.' };
    try {
      // The RPC counts the rows it deleted, because a delete that matched
      // nothing is not an error in PostgREST and "you have left the waitlist"
      // over a row that is still there is the failure this repo keeps finding.
      const { data, error } = await supabase.rpc('leave_session_waitlist', { p_session: sessionId });
      if (error) return { ok: false, error: error.message };
      if (data !== true) return { ok: false, error: 'You were not on that waitlist.' };
      await load();
      return { ok: true };
    } catch (e: any) { return { ok: false, error: e?.message || 'Could not reach the server.' }; }
  }, [load]);

  return { taken, mine, status, reload: load, join, leave };
}

/** The one sentence a client screen shows before confirming a cancellation.
 *  Here so that the Book screen and My Bookings cannot word the same warning
 *  two different ways — the same reason `ptCancelLines` is here. */
export function cancelWarningFor(
  startsAt: string,
  policy: CancellationPolicy | null,
  now: number = Date.now(),
): { late: boolean; line: string; noticeHours: number } {
  const noticeHours = noticeHoursOf(policy);
  const late = insideNoticeWindow(startsAt, noticeHours, now);
  return { late, noticeHours, line: cancelWarningLine(lateCancelFee(policy, late), noticeHours) };
}

/** A member's place in a queue, in words. Re-exported through this module so a
 *  screen importing the waitlist hook does not also have to reach into
 *  src/lib/booking.ts for the sentence that goes with it. */
export { waitlistLine };

/* ── The coach's side of both ──────────────────────────────────────────────
 *
 * Two reads a coach's schedule needs and could not make before: how many people
 * are waiting on each of their booked hours, and which late-cancellation fees
 * have actually been recorded against their clients.
 *
 * Both go through RLS rather than an RPC because both are already the coach's
 * own rows to read: `session_waitlist_trainer_r` scopes the queue to sessions
 * they own, and `charges_trainer_rw` scopes charges to their own clients.
 */
export function useSessionWaitlistCounts(sessionIds: string[]): {
  counts: Map<string, number>;
  status: LoadStatus;
  reload: () => Promise<void>;
} {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // The identity of `sessionIds` changes on every render of the caller. Keyed on
  // the contents instead, or this effect re-fires forever.
  const key = sessionIds.join(',');

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    const ids = key ? key.split(',') : [];
    if (!ids.length) { setCounts(new Map()); setStatus('ready'); return; }
    try {
      // Chunked, and the ceiling being argued about is the REQUEST LINE.
      // `sessionIds` is one id per booked session the calendar is drawing, off
      // a `capLimit()` read with no date window on it — so a full-time coach
      // crosses two hundred inside a few months and up to a thousand arrive. A
      // uuid costs about 39 bytes inside a PostgREST `in.("…","…")` list, so
      // that is a ~39KB query string against the 8KB request line nginx and
      // most CDNs enforce by default. The refusal is a 414, supabase-js does
      // not reject on it, and it lands as `data: null` — which means
      // `setStatus('error')` never fires and every session on the calendar
      // reports an empty waiting list. A coach with people queued for a slot is
      // told nobody wants it.
      //
      // `readCappedByIds` and not `readByIds`: the cap is what 'partial' is
      // reported off, and a queue counted off a fraction of the rows must
      // render as a dash rather than as a smaller number.
      const { rows, truncated, error } = await readCappedByIds<any>(
        ids,
        (chunk) => supabase.from('session_waitlist')
          .select('session_id').in('session_id', chunk).limit(capLimit()),
      );
      if (error) { setStatus('error'); return; }
      const m = new Map<string, number>();
      for (const r of rows) {
        const id = String(r.session_id);
        m.set(id, (m.get(id) ?? 0) + 1);
      }
      setCounts(m);
      // A truncated read undercounts every queue in it. The screen must not
      // print "2 waiting" off a fraction of the rows, so it goes to a dash.
      setStatus(truncated ? 'partial' : 'ready');
    } catch { setStatus('error'); }
  }, [key]);

  useEffect(() => { load(); }, [load]);
  return { counts, status, reload: load };
}

export interface LateCancelCharge {
  id: string;
  clientId: string;
  sessionId: string | null;
  /** Major units of `currency`. */
  amount: number | null;
  currency: string | null;
  createdAt: string;
  /** When the coach forgave it. The row stays either way — a waived fee is a
   *  fact about what happened, not an absence. */
  waivedAt: string | null;
}

export function useLateCancelCharges(): {
  charges: LateCancelCharge[];
  status: LoadStatus;
  reload: () => Promise<void>;
  waive: (id: string) => Promise<boolean>;
  unwaive: (id: string) => Promise<boolean>;
} {
  const authRev = useAuthRevision();
  const [charges, setCharges] = useState<LateCancelCharge[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  // Not gated on the app variant, and deliberately so: RLS already decides
  // WHICH rows come back, and the two answers are both wanted. On the coach app
  // `charges_trainer_rw` returns the fees their own clients owe them; on the
  // client app `charges_client_r` returns the member's own. A record only the
  // person collecting can see is half a record — the member has to be able to
  // look up what they were told they owe, after the alert has gone.
  //
  // `waive` is the coach's, and on the client app it simply changes nothing:
  // the update falls outside their policy, returns zero rows, and is reported
  // as the failure it is rather than as a success.
  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setCharges([]); setStatus('ready'); return; }
      const { data, error } = await supabase.from('charges')
        .select('id, client_id, session_id, amount, currency, created_at, waived_at')
        .eq('reason', 'late_cancellation')
        .order('created_at', { ascending: false })
        .limit(capLimit());
      if (error) { setStatus('error'); return; }
      const page = capped(data ?? []);
      setCharges((page.rows as any[]).map((r) => ({
        id: String(r.id),
        clientId: String(r.client_id),
        sessionId: r.session_id ? String(r.session_id) : null,
        amount: toNum(r.amount),
        currency: typeof r.currency === 'string' ? r.currency : null,
        createdAt: r.created_at,
        waivedAt: r.waived_at ?? null,
      })));
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch { setStatus('error'); }
  }, []);

  useEffect(() => { load(); }, [authRev, load]);

  const setWaived = useCallback(async (id: string, waived: boolean): Promise<boolean> => {
    if (!USE_SUPABASE) return false;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      // An update the policy filters out is not an error in PostgREST — it
      // changes zero rows and reports success. The rows it returns are what is
      // counted, or a coach is told they forgave a fee that still stands.
      // Two literal writes rather than one conditional object, so
      // scripts/check-schema.mjs can actually read which columns this names.
      // A `.update(expr)` is opaque to it, and an unreadable write is a column
      // nothing checks against the live database — which is the exact shape of
      // the bug that check exists for (parts written, never run, every save
      // silently rejected for one unknown column).
      const res = waived
        ? await supabase.from('charges').update({ waived_at: new Date().toISOString(), waived_by: uid }).eq('id', id).select('id')
        : await supabase.from('charges').update({ waived_at: null, waived_by: null }).eq('id', id).select('id');
      const { data, error } = res;
      if (error || !data || !data.length) return false;
      await load();
      return true;
    } catch { return false; }
  }, [load]);

  return {
    charges, status, reload: load,
    waive: (id) => setWaived(id, true),
    unwaive: (id) => setWaived(id, false),
  };
}

/**
 * What became of one promotion — three answers, where there used to be one.
 *
 *  'promoted' — the server handed the slot to `clientId`. It has an owner.
 *  'nobody'   — the server ran and handed it to nobody. This is the only answer
 *               that licenses broadcasting the hour to the rest of the book.
 *  'failed'   — the call was refused or did not come back. NOTHING is known
 *               about the queue, and least of all that it is empty.
 *
 * The distinction is the one `classifyWrite` draws in src/lib/offlineQueue.ts
 * and `readState` draws in src/lib/staleRead.ts — a call that did not happen is
 * not an empty result — and it is worth more here than in either of those. The
 * caller's next act on a wrongly-empty answer is to tell the whole roster the
 * hour is first-come-first-served, which is precisely the race this waitlist
 * exists to replace, run against a person who may already own the slot.
 *
 * 'nobody' is deliberately "the server promoted nobody" rather than "the queue
 * is empty": `_promote_session_waitlist` also returns null when the row is no
 * longer available or has already started, and every one of those means the
 * same thing to the caller — no client is holding this hour.
 */
export type PromoteResult =
  | { outcome: 'promoted'; clientId: string }
  | { outcome: 'nobody'; clientId: null }
  | { outcome: 'failed'; clientId: null };

const PROMOTE_NOBODY: PromoteResult = { outcome: 'nobody', clientId: null };
const PROMOTE_FAILED: PromoteResult = { outcome: 'failed', clientId: null };

/** Hand a freed slot to the head of its waitlist, as the COACH. The client's
 *  own cancellation does this inside the same transaction that frees the slot;
 *  a coach frees their slot with a direct RLS-owned update, so for them it is
 *  this explicit second step.
 *
 *  With no backend there is no queue to read and no read to fail — the local
 *  store is the source of truth and it holds no waitlist at all, which is the
 *  same reason `useSessionWaitlistCounts` reports 'ready' rather than 'error'
 *  in that mode. So that case is a real 'nobody', not a 'failed'. */
export async function promoteWaitlist(sessionId: string): Promise<PromoteResult> {
  if (!USE_SUPABASE) return PROMOTE_NOBODY;
  try {
    const { data, error } = await supabase.rpc('promote_session_waitlist', { p_session: sessionId });
    if (error) return PROMOTE_FAILED;
    if (typeof data === 'string') return { outcome: 'promoted', clientId: data };
    // `null` is the function's own answer for "nobody got it" and is the only
    // non-string this may read as empty. Anything else is a reply we do not
    // understand, and an answer we cannot read is not an answer that the queue
    // was empty — the broadcast is not licensed by it.
    return data == null ? PROMOTE_NOBODY : PROMOTE_FAILED;
  } catch { return PROMOTE_FAILED; }
}
