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
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { GymClass, ClassBookingStatus } from '../lib/classesMock';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { cacheKey, cachedAtLine, packCache, readCache, withinHorizon } from '../lib/readCache';
import { useLive } from './realtime';
import { useAuthRevision } from './authRevision';
import { useRecoverRead } from './readRefresh';

/**
 * How stale a cached timetable may be before it stops being worth showing.
 *
 * Two days, not the week src/lib/readCache.ts defaults to. A timetable is the
 * one cached list where age is actively dangerous: classes get moved and
 * cancelled, and a member who turns up for a Tuesday class that was pulled on
 * Monday has been sent to the gym by this app. Two days keeps the useful case
 * — the member who looked at the timetable last night and is now standing in
 * the basement — and drops the one that misleads.
 */
const CLASS_CACHE_HORIZON_MS = 2 * 24 * 60 * 60 * 1000;

/** What the cache holds. Two keys rather than one blob, because the timetable
 *  and which seats I hold have different lifetimes and one may be readable when
 *  the other is not. */
const CLASSES_SCOPE = 'classes';
const MINE_SCOPE = 'classMine';

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
  /** `waiting` is excluded alongside `booked` for the same reason: both are
   *  counted by `class_counts()` on read and neither is a property of the class
   *  the coach is creating. A new class has nobody in it and nobody waiting. */
  /** `status`, `cancelReason` and `seriesId` are excluded for the same reason:
   *  a class being created is scheduled, belongs to no series and was called
   *  off by nobody. All three are the server's to say on the next read. */
  addClass: (c: Omit<GymClass, 'id' | 'booked' | 'waiting' | 'status' | 'cancelReason' | 'seriesId' | 'trainerId'>) => Promise<boolean>;
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
  /**
   * The sentence to put over a timetable that came off this device rather than
   * off the server, or null when what is on screen was just confirmed.
   *
   * Non-null and `status === 'error'` go together: a cached list is the "we had
   * this before the failure" case src/ui/loadStatus.ts describes, and it must
   * never render as a live one. src/lib/readCache.ts writes the sentence.
   */
  cachedNote: string | null;
}

const Ctx = createContext<ClassesValue | null>(null);

const rowToClass = (r: any): GymClass => ({
  id: String(r.id), title: r.title, kind: r.kind ?? '', instructor: r.instructor ?? '',
  branch: r.branch ?? '', room: r.room ?? '', startsAt: r.starts_at, durationMin: r.duration_min ?? 45,
  capacity: r.capacity ?? 12, booked: 0,
  // Part 195's two columns, which this mapper dropped on the floor. The select
  // above is `*`, so both have been arriving in the payload since the day the
  // migration ran; nothing read them, `GymClass` had nowhere to put them, and
  // every row drew identically. A coach then turned up to a class the gym had
  // called off and told the members it was on.
  //
  // Narrowed here rather than passed through: the column is free text with a
  // check constraint, and anything that is not the one value meaning "called
  // off" is a class that is ON. A row from a database without the column reads
  // undefined, which `isCancelled` in src/lib/gymSchedule.ts already treats as
  // scheduled — the only reading that cannot drop a real class off a timetable.
  // Null and not the empty string. A class with no trainer recorded is
  // UNATTRIBUTED, and the coach's calendar treats that as "cannot tell" rather
  // than as "not yours" — see the note on the field.
  trainerId: typeof r.trainer_id === 'string' && r.trainer_id ? r.trainer_id : null,
  status: r.status === 'cancelled' ? 'cancelled' : 'scheduled',
  cancelReason: typeof r.cancel_reason === 'string' ? r.cancel_reason : null,
  // Null and not the empty string: a one-off belongs to no series, and a series
  // of one would make "this class" and "this and every later one" the same
  // button on the screens that offer both.
  seriesId: typeof r.series_id === 'string' && r.series_id ? r.series_id : null,
  // Null and not 0. `class_counts()` gained a `waiting` column in part 210, and
  // a build talking to a database without it reads `undefined` — which must
  // NEVER settle to zero, because "nobody is waiting" is exactly the claim that
  // stops a coach putting on a second session for the six people who are.
  waiting: null,
});

export function ClassesProvider({ children }: { children: React.ReactNode }) {
  const authRev = useAuthRevision();
  const [classes, setClasses] = useState<GymClass[]>([]);
  const [myStatus, setMyStatus] = useState<Record<string, ClassBookingStatus>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [countsKnown, setCountsKnown] = useState(!USE_SUPABASE);
  /** When the list on screen was last confirmed by the server, or null when it
   *  has been. Only ever set from a cached read. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  /** True once a server answer has landed this session. What it guards is the
   *  cache read below: a timetable that has already been confirmed must not be
   *  replaced by an older copy of itself when a later refresh fails. */
  const confirmed = useRef(false);
  /** The account whose channel we are listening on. Held in state rather than
   *  read from `uid` directly so the subscription is not torn down and reopened
   *  by every unrelated re-render. */
  const [liveUid, setLiveUid] = useState<string | null>(null);

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
      setLiveUid(id);

      // ── this device's copy, before the network ────────────────────────
      //
      // What a member standing in the basement weights room is entitled to
      // see: the timetable as it was the last time this phone could reach us,
      // labelled as exactly that.
      //
      // Only when nothing has been confirmed yet this session. A refresh that
      // fails must leave the live list it already has on screen — replacing a
      // confirmed timetable with an older copy of itself is a regression the
      // member would experience as the app losing data.
      if (id && !confirmed.current) {
        try {
          const [rawList, rawMine] = await Promise.all([
            AsyncStorage.getItem(cacheKey(CLASSES_SCOPE, id)),
            AsyncStorage.getItem(cacheKey(MINE_SCOPE, id)),
          ]);
          const cachedList = readCache<GymClass>(rawList);
          // `rows === null` is "we learnt nothing", not "there are no classes".
          // Nothing is assigned in that case, so the empty list on screen keeps
          // whatever the status says about it.
          if (cachedList.rows && withinHorizon(cachedList.at, Date.now(), CLASS_CACHE_HORIZON_MS)) {
            // Past classes are dropped here for the same reason the server read
            // filters them: a member looking for what is on next must not be
            // shown last Tuesday.
            const cutoff = Date.now() - 3600_000;
            const live = cachedList.rows.filter((c) => Date.parse(c.startsAt) >= cutoff);
            setClasses(live.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
            setCachedAt(cachedList.at);
            // The counts are the one thing a cached timetable may NOT claim.
            // They came from an aggregate over everybody's bookings at some
            // earlier moment, and a class that had two seats then may have none
            // now — which is the number a member decides their evening on.
            setCountsKnown(false);
            const cachedMine = readCache<{ id: string; status: ClassBookingStatus }>(rawMine);
            if (cachedMine.rows) {
              const ms: Record<string, ClassBookingStatus> = {};
              cachedMine.rows.forEach((b) => { ms[String(b.id)] = b.status; });
              setMyStatus(ms);
            }
            // Something is on screen and it is not confirmed. If the read below
            // fails, this is the state the member is left in and it has to say
            // so; a successful read clears it.
            setReady(true);
          }
        } catch { /* no usable cache; the read below is the only source */ }
      }

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
            const wmap: Record<string, number | null> = {};
            cntPage.rows.forEach((c: any) => {
              cmap[String(c.class_id)] = c.booked;
              // Absent on a database that has not had part 210 applied. Kept as
              // null rather than coerced: the coach's screen draws a dash for
              // null and nothing at all for zero, and those are different
              // sentences about a queue.
              wmap[String(c.class_id)] = typeof c.waiting === 'number' ? c.waiting : null;
            });
            list.forEach((cl) => {
              cl.booked = cmap[cl.id] ?? 0;
              // A class with no row in the answer has nobody booked AND nobody
              // waiting — the group-by only omits a class with no bookings at
              // all — so zero is the right value here and null is the right one
              // for a column the server did not send.
              cl.waiting = cl.id in wmap ? wmap[cl.id] : 0;
            });
            setCountsKnown(true);
          }
        } catch { setCountsKnown(false); }
        // Assign even when empty: an empty timetable that the server confirmed
        // is a real answer, and leaving the previous list up would be staler.
        setClasses(list);
        // Confirmed, so nothing on screen is a cached copy any more.
        confirmed.current = true;
        setCachedAt(null);
        // …and this is now the copy a basement gets. Written only on a whole
        // read: a truncated page cached would be opened next launch as though
        // it were the timetable, with no way to know it was a prefix.
        if (id && !truncated) {
          AsyncStorage.setItem(cacheKey(CLASSES_SCOPE, id), packCache(list))
            .catch(() => { /* the timetable is right this session either way */ });
        }
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
          // The seats I hold, for the next time this phone cannot ask. Not
          // cached when the read was short, for the reason above: a member
          // whose booking fell off the end would open the app to a class they
          // are in, offered as bookable.
          if (!minePage.truncated) {
            AsyncStorage.setItem(cacheKey(MINE_SCOPE, id), packCache(minePage.rows.map((b: any) => ({ id: String(b.class_id), status: b.status }))))
              .catch(() => { /* as above */ });
          }
        }
      }
    } catch { failed = true; }
    setStatus(failed ? 'error' : truncated ? 'partial' : 'ready');
    setReady(true);
  }, [authRev]);

  useEffect(() => { let c = false; (async () => { if (!c) await load(); })(); return () => { c = true; }; }, [load]);

  /* ── live ────────────────────────────────────────────────────────────────
   *
   * Two subscriptions, and they are watching two different things.
   *
   * `gym_classes` is the timetable itself: a class added, moved or cancelled
   * while somebody has the screen open. Before this, a member could be looking
   * at a class that had been pulled ten minutes earlier and would go on looking
   * at it until they left the screen and came back.
   *
   * `class_bookings` is how full it is. That number is the one members decide
   * on — "2 places left" — and it was a snapshot from whenever the screen
   * happened to load. Note the filter is deliberately absent: it is not MY
   * bookings that change how full a class is, it is everybody's. Realtime
   * applies row-level security, so what actually arrives is whatever this
   * account may read, and that is fine here because the payload is never used
   * for its contents — it is a nudge to call `class_counts()` again, which is a
   * security-definer aggregate and the only thing entitled to the real number.
   * See src/ui/realtime.ts on why nothing here patches state from a payload.
   *
   * Both are debounced together by `useLive`, so a coach publishing next week's
   * timetable is one refetch and not forty.
   */
  useLive({ channel: 'classes:timetable', table: 'gym_classes', enabled: !!liveUid, onChange: load });
  useLive({ channel: 'classes:seats:' + (liveUid ?? 'none'), table: 'class_bookings', enabled: !!liveUid, onChange: load });

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
    // is the offline path rather than a confirmed reservation.
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
    // Zero and not null: a class this device has just created genuinely has
    // nobody waiting for it, which is a settled answer rather than an unread
    // one. It is replaced by the server's own count on the next load.
    // 'scheduled' and not undefined: a class this device has just created is
    // one somebody means to run, which is a settled answer rather than a column
    // nobody read. It is replaced by the server's own row on the next load.
    const local: GymClass = { ...c, id: 'local-' + Date.now(), booked: 0, waiting: 0, status: 'scheduled', cancelReason: null, seriesId: null,
      // The insert below writes `trainer_id: uid`, so the row this stands in
      // for is the signed-in coach's. Anything else here would make the phone
      // and the server disagree for the length of one load.
      trainerId: uid };
    setClasses((p) => [...p, local].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { data, error } = await supabase.from('gym_classes').insert({ trainer_id: uid, title: c.title, kind: c.kind, instructor: c.instructor, branch: c.branch, room: c.room, starts_at: c.startsAt, duration_min: c.durationMin, capacity: c.capacity }).select().single();
      if (error || !data) return false;
      setClasses((p) => p.map((x) => (x.id === local.id ? rowToClass(data) : x)));
      return true;
    } catch { return false; }
  };

  // Computed per render rather than stored beside `cachedAt`: the sentence says
  // how long ago, and a stored string would go on saying "4 minutes ago" for
  // the rest of the time the screen is open.
  const cachedNote = cachedAtLine(cachedAt);

  // Re-run this read when the signal comes back, without the member having
  // to know the app is stuck and think to pull down. src/lib/readRefresh.ts.
  useRecoverRead('classes', status, () => { void load(); });
  return <Ctx.Provider value={{ classes, myStatus, book, cancel, addClass, refresh: load, ready, status, countsKnown, cachedNote }}>{children}</Ctx.Provider>;
}

export function useClasses(): ClassesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClasses must be used inside <ClassesProvider>');
  return v;
}
