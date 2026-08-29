// Group-classes store. Supabase-backed when signed in (gym_classes + class_bookings
// with capacity-safe RPCs). Starts empty — no classes until the gym creates them.
// Booking rolls onto a waitlist when a class is full; cancelling frees a
// seat (the backend promotes the next waitlister).
//
// ── The worst of these was `book` ──────────────────────────────────────────
//
// `const { data } = await supabase.rpc('book_class', …)` did not destructure
// `error`, and supabase-js resolves rather than throwing. So when the RPC was
// refused — class full and the waitlist closed, membership lapsed, no signal —
// `data` came back null, the very next line read `data === 'waitlist' ? … :
// 'booked'`, and the client was told they were BOOKED. They then turned up to a
// class with no seat reserved for them. That one line is the whole reason this
// file returns null on failure now: null was always in the declared return type,
// nothing had ever returned it.
//
// The read had the ordinary version of the same problem: a failed select left
// `classes` at [] while `ready` still flipped true, so the timetable told a gym
// full of members that no classes were scheduled.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { GymClass, ClassBookingStatus } from '../lib/classesMock';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';

interface ClassesValue {
  classes: GymClass[];
  myStatus: Record<string, ClassBookingStatus>;
  /** The seat you actually hold, or null when the booking did not reach the
   *  server. Null is not "unknown" — it means DO NOT tell them they are in. */
  book: (id: string) => Promise<ClassBookingStatus | null>;
  /** Resolves true only when the seat was actually released. A cancel that was
   *  refused leaves the member holding a seat they believe they gave up. */
  cancel: (id: string) => Promise<boolean>;
  /** Resolves true only when the class is on the timetable everyone else reads,
   *  rather than on the creating device alone. */
  addClass: (c: Omit<GymClass, 'id' | 'booked'>) => Promise<boolean>;
  refresh: () => void;
  /** The initial load has settled — unchanged, screens branch on it to stop a
   *  spinner. It says nothing about whether the load worked; `status` does. */
  ready: boolean;
  /** Whether `classes` is the timetable the server holds. Under 'error' an
   *  empty list means we could not read it, not that nothing is scheduled. */
  status: LoadStatus;
  /**
   * Whether `booked` on each class is a real count.
   *
   * `rowToClass` starts every class at `booked: 0` and the `class_counts` RPC
   * fills it in. When that RPC fails the zeros stay, and a zero is not a
   * neutral placeholder here — it is the specific claim that the class is
   * empty. The member's screen computes `capacity - booked` and offers a full
   * class as wide open; the coach's screen computes `booked >= capacity` and
   * never shows one as full. Both then let somebody book a seat that is not
   * there, and the failure surfaces as a refused booking with no explanation.
   */
  countsKnown: boolean;
}

const Ctx = createContext<ClassesValue | null>(null);

const rowToClass = (r: any): GymClass => ({
  id: String(r.id), title: r.title, kind: r.kind ?? '', instructor: r.instructor ?? '',
  branch: r.branch ?? '', room: r.room ?? '', startsAt: r.starts_at, durationMin: r.duration_min ?? 45,
  capacity: r.capacity ?? 12, booked: 0,
});

export function ClassesProvider({ children }: { children: React.ReactNode }) {
  const authRev = useAuthRevision();
  const [classes, setClasses] = useState<GymClass[]>([]);
  const [myStatus, setMyStatus] = useState<Record<string, ClassBookingStatus>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [countsKnown, setCountsKnown] = useState(!USE_SUPABASE);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setReady(true); setStatus('ready'); return; }
    let failed = false;
    // Separate from `failed`: a read that came back short is not a read that did
    // not happen, and a member looking at a timetable that is missing its far
    // end should be told that rather than told the timetable is broken.
    let truncated = false;
    try {
      // Signed out is a true answer, not a failed read: getUser() rejects when
      // there is no session, which marked this whole load as failed on the
      // first tick — before anybody had signed in — and `load` never changed
      // identity, so the effect below never asked again.
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setStatus('ready'); setReady(true); return; }
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) failed = true;
      const id = auth?.user?.id ?? null;
      setUid(id);
      const nowIso = new Date(Date.now() - 3600_000).toISOString();
      // Soonest-first and capped. Ascending is the right half to keep here, and
      // for once that is not a coincidence: the read is already filtered to
      // classes that have not finished, so the first thousand are the next
      // thousand. A gym running forty classes a week has half a year of
      // timetable inside the cap.
      const { data: rows, error } = await supabase.from('gym_classes').select('*')
        .gte('starts_at', nowIso).order('starts_at', { ascending: true }).order('id', { ascending: true }).limit(capLimit());
      if (error) failed = true;
      else if (rows) {
        const page = capped(rows);
        if (page.truncated) truncated = true;
        const list = page.rows.map(rowToClass);
        // confirmed counts (security-definer aggregate over everyone's bookings)
        // A missing count only understates how full a class is; the class itself
        // is still listed, so this stays best-effort.
        // Not "counts only": every class starts at booked 0, so a failure here
        // leaves that zero standing as a claim of emptiness. Record whether the
        // numbers are real so the screens can decline to make the claim.
        try {
          // An RPC returning a table comes back through PostgREST and stops at
          // the same ceiling a table read does, so it is capped like one. A
          // class missing from a short answer falls to `?? 0` — the exact zero
          // the comment above says must not be allowed to stand as a claim of
          // emptiness — so truncation here retracts the counts wholesale rather
          // than leaving a full class showing as empty and bookable.
          const { data: counts, error: cntErr } = await supabase.rpc('class_counts').limit(capLimit());
          const cntPage = capped(Array.isArray(counts) ? counts : null);
          if (cntErr || !Array.isArray(counts) || cntPage.truncated) setCountsKnown(false);
          else {
            const cmap: Record<string, number> = {};
            cntPage.rows.forEach((c: any) => { cmap[String(c.class_id)] = c.booked; });
            list.forEach((cl) => { cl.booked = cmap[cl.id] ?? 0; });
            setCountsKnown(true);
          }
        } catch { setCountsKnown(false); }
        // Assign even when empty: an empty timetable that the server confirmed
        // is a real answer, and leaving the previous list up would be staler.
        setClasses(list);
      }
      if (id) {
        // Which seats I hold. Failing this and leaving myStatus empty makes
        // every class I am already booked into render as bookable again.
        // Newest first, then capped. A seat I hold that falls off the end of
        // this read renders as a class I can still book — the exact failure the
        // comment above is about — so which rows come back decides which of my
        // bookings become invisible. Newest keeps the ones I am about to attend.
        const { data: mine, error: mineErr } = await supabase.from('class_bookings')
          .select('class_id, status').eq('user_id', id)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (mineErr) failed = true;
        else if (Array.isArray(mine)) {
          const minePage = capped(mine);
          if (minePage.truncated) truncated = true;
          const ms: Record<string, ClassBookingStatus> = {}; minePage.rows.forEach((b: any) => { ms[String(b.class_id)] = b.status; }); setMyStatus(ms);
        }
      }
    } catch { failed = true; }
    setStatus(failed ? 'error' : truncated ? 'partial' : 'ready');
    setReady(true);
  }, [authRev]);

  useEffect(() => { let c = false; (async () => { if (!c) await load(); })(); return () => { c = true; }; }, [load]);

  const book: ClassesValue['book'] = async (id) => {
    const cl = classes.find((x) => x.id === id);
    const willWait = cl ? cl.booked >= cl.capacity : false;
    const optimistic: ClassBookingStatus = willWait ? 'waitlist' : 'booked';
    setMyStatus((p) => ({ ...p, [id]: optimistic }));
    if (!willWait) setClasses((p) => p.map((x) => (x.id === id ? { ...x, booked: x.booked + 1 } : x)));
    if (USE_SUPABASE && uid) {
      try {
        const { data, error } = await supabase.rpc('book_class', { p_class: id });
        if (error) {
          // Roll the optimistic seat back. Leaving it would show the member as
          // booked into a class the server just refused them.
          setMyStatus((p) => { const n = { ...p }; delete n[id]; return n; });
          if (!willWait) setClasses((p) => p.map((x) => (x.id === id ? { ...x, booked: Math.max(0, x.booked - 1) } : x)));
          return null;
        }
        const st = (data === 'waitlist' ? 'waitlist' : 'booked') as ClassBookingStatus;
        setMyStatus((p) => ({ ...p, [id]: st }));
        return st;
      } catch {
        setMyStatus((p) => { const n = { ...p }; delete n[id]; return n; });
        if (!willWait) setClasses((p) => p.map((x) => (x.id === id ? { ...x, booked: Math.max(0, x.booked - 1) } : x)));
        return null;
      }
    }
    // No backend to book against: the seat exists on this device only, so this
    // is the demo/offline path rather than a confirmed reservation.
    return optimistic;
  };

  const cancel: ClassesValue['cancel'] = async (id) => {
    const was = myStatus[id];
    setMyStatus((p) => { const n = { ...p }; delete n[id]; return n; });
    if (was === 'booked') setClasses((p) => p.map((x) => (x.id === id ? { ...x, booked: Math.max(0, x.booked - 1) } : x)));
    // Put the seat back on screen if the server did not take the cancellation.
    // A member who thinks they cancelled and did not is a no-show the gym
    // charges them for.
    const restore = () => {
      if (!was) return;
      setMyStatus((p) => ({ ...p, [id]: was }));
      if (was === 'booked') setClasses((p) => p.map((x) => (x.id === id ? { ...x, booked: x.booked + 1 } : x)));
    };
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.rpc('cancel_class', { p_class: id });
      if (error) {
        restore();
        return false;
      }
      return true;
    } catch {
      restore();
      return false;
    }
  };

  const addClass: ClassesValue['addClass'] = async (c) => {
    const local: GymClass = { ...c, id: 'local-' + Date.now(), booked: 0 };
    setClasses((p) => [...p, local].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { data, error } = await supabase.from('gym_classes').insert({ trainer_id: uid, title: c.title, kind: c.kind, instructor: c.instructor, branch: c.branch, room: c.room, starts_at: c.startsAt, duration_min: c.durationMin, capacity: c.capacity }).select().single();
      if (error || !data) return false;
      setClasses((p) => p.map((x) => (x.id === local.id ? rowToClass(data) : x)));
      return true;
    } catch { return false; }
  };

  return <Ctx.Provider value={{ classes, myStatus, book, cancel, addClass, refresh: load, ready, status, countsKnown }}>{children}</Ctx.Provider>;
}

export function useClasses(): ClassesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClasses must be used inside <ClassesProvider>');
  return v;
}
