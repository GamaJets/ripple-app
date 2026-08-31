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
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  overlaps, insideNoticeWindow, noticeHoursOf, lateCancelFee, cancelWarningLine,
  feeRecordedLine, waitlistLine, type CancellationPolicy,
} from '../lib/booking';
import { VARIANT } from '../lib/variant';
import type { TrainingSession } from '../lib/types';
import { scheduleLocal, sendPushChecked } from './pushNotifications';
import { reofferSlot, refundSession, sessionsRemaining } from '../lib/connect';
import { useAuthRevision } from './authRevision';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';

interface SessionsValue {
  sessions: TrainingSession[];
  /** Whether `sessions` is the server's calendar. Under 'error' an empty list
   *  means it could not be read, not that nothing is booked. Under 'partial'
   *  the calendar is longer than what is here — the newest ROW_CAP sessions —
   *  so it may be shown but not counted or totalled. */
  status: LoadStatus;
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
  /** Client confirms a delivered session, with an optional comment for the trainer.
   *  Goes through the `approve_session` RPC — a client has no write access to
   *  `sessions` or `session_approvals` directly. */
  approveSession: (id: string, note?: string) => Promise<{ ok: boolean; error?: string }>;
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

const rowToSession = (r: any): TrainingSession => ({
  id: String(r.id), trainerId: r.trainer_id, clientId: r.client_id,
  startsAt: r.starts_at, durationMin: r.duration_min, status: r.status, released: !!r.released,
});

const Ctx = createContext<SessionsValue | null>(null);

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const authRev = useAuthRevision();
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

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
        if (!data || !data.length) { setSessions([]); setStatus('ready'); return; }
        const page = capped(data);
        // Back to ascending for everyone downstream: the calendar, `overlaps`
        // and the analytics screens were all written against a chronological
        // list, and the read order is a fetching decision, not their business.
        let rows = page.rows.map(rowToSession).reverse();
        // Approvals live in their own table (see supabase/session-approvals.sql).
        // A failure here must not cost us the sessions themselves — the screen is
        // still usable without knowing what has been approved.
        try {
          // Keyed on the sessions we actually hold rather than read whole. It
          // was unfiltered, so at scale it would have hit the same 1000-row
          // ceiling and silently dropped approvals off sessions that had them —
          // showing delivered, client-confirmed work as still awaiting sign-off.
          // Scoped this way it cannot exceed the session count, which is capped.
          // no-error-ok: an unread approval leaves the session showing as not-yet-approved, which is what it shows before anyone approves it; the sessions themselves are the point of this screen
          const { data: appr } = await supabase.from('session_approvals')
            .select('session_id, approved_at, note')
            .in('session_id', rows.map((r) => r.id))
            .limit(capLimit());
          if (appr?.length) {
            const byId = new Map(appr.map((a: any) => [String(a.session_id), a]));
            rows = rows.map((r) => {
              const a = byId.get(r.id);
              return a ? { ...r, approvedAt: a.approved_at, approvalNote: a.note ?? null } : r;
            });
          }
        } catch { /* sessions still load */ }
        if (cancelled()) return;
        setSessions(rows);
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch { if (!cancelled()) setStatus('error'); }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    hydrate(() => cancelled);
    return () => { cancelled = true; };
  }, [authRev, hydrate]);

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
        scheduleLocal('Session in 1 hour', 'Your training session starts at ' + start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.', new Date(start.getTime() - 60 * 60 * 1000), { route: '/(client)/calendar' });
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
    setSessions((p) => p.filter((x) => x.id !== id));
    if (!USE_SUPABASE) return false;
    try {
      // Same reason as above: a delete the policy filters out reports no error
      // and removes nothing, leaving the session to reappear on next launch.
      const { data, error } = await supabase.from('sessions').delete().eq('id', id).select('id');
      return !error && !!data && data.length > 0;
    } catch { return false; }
  };

  const approveSession: SessionsValue['approveSession'] = async (id, note) => {
    const trimmed = (note || '').trim();
    if (!USE_SUPABASE) return { ok: false, error: 'Not signed in to the server.' };
    try {
      const { error } = await supabase.rpc('approve_session', { p_session: id, p_note: trimmed || null });
      if (error) return { ok: false, error: error.message };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not reach the server.' };
    }
    // Only after the server accepted it — an approval that exists on this phone
    // and nowhere else is exactly the bug this replaced.
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, approvedAt: new Date().toISOString(), approvalNote: trimmed || null } : x)));
    return { ok: true };
  };

  return <Ctx.Provider value={{ sessions, status, refresh: () => hydrate(), addSession, bookSession, releaseSession, cancelMyBooking, removeSession, approveSession }}>{children}</Ctx.Provider>;
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
  let h = start.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  const mm = start.getMinutes();
  const at = `${h}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}`;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][start.getDay()];

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
      : (await sendPushChecked(others, 'A PT slot just opened', `${at} with your coach just opened up — first to book it gets it.`, { route: '/(client)/calendar' })).ok;
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
  }, []);

  // The database refuses `applies` without an amount, so the same rule is stated
  // here and the write is simply not sent while it is broken. A form that
  // accepts what a coach types and silently drops it is the failure mode this
  // screen family already has a rule about.
  const blocker = applies && (fee == null || !(fee > 0))
    ? 'Set an amount before switching the policy on — a fee of nothing is a policy that does not apply.'
    : null;

  useEffect(() => {
    if (!USE_SUPABASE || VARIANT !== 'trainer' || !uid || !synced || blocker) return;
    const timer = setTimeout(() => {
      try {
        supabase.from('trainers').update({
          late_cancel_applies: applies,
          late_cancel_notice_hours: noticeHours,
          late_cancel_fee: fee,
        }).eq('id', uid).then(() => {}, () => {});
      } catch { /* the next edit tries again */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [applies, noticeHours, fee, uid, synced, blocker]);

  return { applies, noticeHours, fee, currency, status, blocker, setApplies, setNoticeHours, setFee };
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
      setStatus('ready');
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
      const { data, error } = await supabase.from('session_waitlist')
        .select('session_id').in('session_id', ids).limit(capLimit());
      if (error) { setStatus('error'); return; }
      const page = capped(data ?? []);
      const m = new Map<string, number>();
      for (const r of page.rows as any[]) {
        const id = String(r.session_id);
        m.set(id, (m.get(id) ?? 0) + 1);
      }
      setCounts(m);
      // A truncated read undercounts every queue in it. The screen must not
      // print "2 waiting" off a fraction of the rows, so it goes to a dash.
      setStatus(page.truncated ? 'partial' : 'ready');
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

/** Hand a freed slot to the head of its waitlist, as the COACH. The client's
 *  own cancellation does this inside the same transaction that frees the slot;
 *  a coach frees their slot with a direct RLS-owned update, so for them it is
 *  this explicit second step. Resolves to the client it went to, or null when
 *  nobody was waiting. */
export async function promoteWaitlist(sessionId: string): Promise<string | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.rpc('promote_session_waitlist', { p_session: sessionId });
    if (error) return null;
    return typeof data === 'string' ? data : null;
  } catch { return null; }
}
