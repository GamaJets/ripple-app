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
import { overlaps } from '../lib/booking';
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
   *  booked in and the coach's screen is the only thing that says otherwise. */
  releaseSession: (id: string) => Promise<boolean>;
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
        scheduleLocal('Session in 1 hour', 'Your training session starts at ' + start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.', new Date(start.getTime() - 60 * 60 * 1000));
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

  return <Ctx.Provider value={{ sessions, status, refresh: () => hydrate(), addSession, bookSession, releaseSession, removeSession, approveSession }}>{children}</Ctx.Provider>;
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
// Deliberately NOT a hook: `releaseSession` comes from the provider and is
// passed in, so this stays a plain async function that can be called from an
// Alert handler on either screen.
export interface PtCancelOutcome {
  /** The server actually freed the slot. Everything else is meaningless when
   *  this is false, and nothing below it was attempted. */
  freed: boolean;
  /** Inside the 24-hour window, so the session is charged and no credit is
   *  returned. See the note on `late` in `cancelBookedSession`. */
  late: boolean;
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
 * slot that had not been released yet.
 *
 * `now` is the instant the CALLER decided this was or was not a late cancel —
 * not the instant this function runs. Both screens warn the member before they
 * confirm ("inside 24 hours, so the session is charged from your package"), and
 * the deal they were shown has to be the deal they get. Left to default, a
 * member who read that warning at 24h01m and thought about it for two minutes
 * would be charged under a rule that said they would not be, and the only
 * direction the drift runs is against them, because time only moves one way.
 */
export async function cancelBookedSession(
  session: Pick<TrainingSession, 'id' | 'startsAt' | 'trainerId'>,
  release: (id: string) => Promise<boolean>,
  now: number = Date.now(),
): Promise<PtCancelOutcome> {
  // `Date.parse(...) - now < 24h`, which is also true of a session that has
  // already started. That is deliberate and is NOT `isLateCancellation` from
  // src/lib/booking.ts, which requires the session to still be in the future.
  //
  // The difference is a refund. Under this rule a member cancelling a session
  // that has already begun is charged for it, which is what both screens have
  // always done and what a coach standing in an empty gym would expect. Under
  // `isLateCancellation` that same cancellation would come back "not late" and
  // this function would hand the credit BACK. Lifting the shared helper is not
  // the place to change who pays for a missed session, and a wrong refund is
  // worse than a missing one — so the existing rule is carried over exactly.
  const late = Date.parse(session.startsAt) - now < 24 * 3600 * 1000;
  const start = new Date(session.startsAt);
  let h = start.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  const mm = start.getMinutes();
  const at = `${h}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}`;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][start.getDay()];

  const freed = await release(session.id);
  if (!freed) {
    return { freed: false, late, refunded: false, offeredTo: null, offerPushed: null, coachTold: false, packLeft: null };
  }

  // Server-side lookup on THIS session's trainer, so no other client's identity
  // reaches the caller beyond opaque ids.
  const others = await reofferSlot(session.id);
  const offerPushed = others.length === 0
    ? null
    : (await sendPushChecked(others, 'A PT slot just opened', `${at} with your coach just opened up — first to book it gets it.`, { route: '/(client)/calendar' })).ok;

  // `refundSession` answers ok:false both when there is no pack to credit and
  // when the server refused the update. Its answer is carried, not discarded —
  // discarding it is how a member comes to believe they are holding a credit
  // they do not have.
  const refund = late ? { ok: false } : await refundSession(session.trainerId);
  const packLeft = await sessionsRemaining();

  const coachTold = (await sendPushChecked([session.trainerId], 'Session cancelled', `A client cancelled ${dow} ${at}. The slot re-opened.${late ? ' (Late cancel — charged.)' : ''}`, { route: '/(trainer)/calendar' })).ok;

  return { freed: true, late, refunded: refund.ok, offeredTo: others.length || null, offerPushed, coachTold, packLeft };
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
  if (o.late) lines.push('Cancelled within 24 hours — this session is charged from your package.');
  else if (o.refunded) lines.push(`Your ${at} session was cancelled and returned to your package.`);
  else lines.push(`Your ${at} session was cancelled. Nothing was returned to a session pack — if you booked it with a pack credit, check your package before booking again.`);
  lines.push(o.offerPushed === true ? `The freed slot was offered to your coach's other clients.`
    : o.offerPushed === false ? `The slot is open again, but we couldn't tell your coach's other clients about it.`
    : `The slot is open again on your coach's calendar.`);
  if (!o.coachTold) lines.push('We couldn’t notify your coach — message them if this session is soon.');
  return lines;
}
