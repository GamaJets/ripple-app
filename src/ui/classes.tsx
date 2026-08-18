// Group-classes store. Supabase-backed when signed in (gym_classes + class_bookings
// with capacity-safe RPCs). Starts empty — no classes until the gym creates them.
// Booking rolls onto a waitlist when a class is full; cancelling frees a
// seat (the backend promotes the next waitlister).
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { GymClass, ClassBookingStatus } from '../lib/classesMock';

interface ClassesValue {
  classes: GymClass[];
  myStatus: Record<string, ClassBookingStatus>;
  book: (id: string) => Promise<ClassBookingStatus | null>;
  cancel: (id: string) => Promise<void>;
  addClass: (c: Omit<GymClass, 'id' | 'booked'>) => Promise<void>;
  refresh: () => void;
  ready: boolean;
}

const Ctx = createContext<ClassesValue | null>(null);

const rowToClass = (r: any): GymClass => ({
  id: String(r.id), title: r.title, kind: r.kind ?? '', instructor: r.instructor ?? '',
  branch: r.branch ?? '', room: r.room ?? '', startsAt: r.starts_at, durationMin: r.duration_min ?? 45,
  capacity: r.capacity ?? 12, booked: 0,
});

export function ClassesProvider({ children }: { children: React.ReactNode }) {
  const [classes, setClasses] = useState<GymClass[]>([]);
  const [myStatus, setMyStatus] = useState<Record<string, ClassBookingStatus>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setReady(true); return; }
    try {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth?.user?.id ?? null;
      setUid(id);
      const nowIso = new Date(Date.now() - 3600_000).toISOString();
      const { data: rows } = await supabase.from('gym_classes').select('*').gte('starts_at', nowIso).order('starts_at', { ascending: true });
      if (rows && rows.length) {
        const list = rows.map(rowToClass);
        // confirmed counts (security-definer aggregate over everyone's bookings)
        try { const { data: counts } = await supabase.rpc('class_counts'); if (Array.isArray(counts)) { const cmap: Record<string, number> = {}; counts.forEach((c: any) => { cmap[String(c.class_id)] = c.booked; }); list.forEach((cl) => { cl.booked = cmap[cl.id] ?? 0; }); } } catch { /* ignore */ }
        setClasses(list);
      }
      if (id) {
        const { data: mine } = await supabase.from('class_bookings').select('class_id, status').eq('user_id', id);
        if (Array.isArray(mine)) { const ms: Record<string, ClassBookingStatus> = {}; mine.forEach((b: any) => { ms[String(b.class_id)] = b.status; }); setMyStatus(ms); }
      }
    } catch { /* stay on mock */ }
    setReady(true);
  }, []);

  useEffect(() => { let c = false; (async () => { if (!c) await load(); })(); return () => { c = true; }; }, [load]);

  const book: ClassesValue['book'] = async (id) => {
    const cl = classes.find((x) => x.id === id);
    const willWait = cl ? cl.booked >= cl.capacity : false;
    const optimistic: ClassBookingStatus = willWait ? 'waitlist' : 'booked';
    setMyStatus((p) => ({ ...p, [id]: optimistic }));
    if (!willWait) setClasses((p) => p.map((x) => (x.id === id ? { ...x, booked: x.booked + 1 } : x)));
    if (USE_SUPABASE && uid) {
      try { const { data } = await supabase.rpc('book_class', { p_class: id }); const st = (data === 'waitlist' ? 'waitlist' : 'booked') as ClassBookingStatus; setMyStatus((p) => ({ ...p, [id]: st })); return st; } catch { /* keep optimistic */ }
    }
    return optimistic;
  };

  const cancel: ClassesValue['cancel'] = async (id) => {
    const was = myStatus[id];
    setMyStatus((p) => { const n = { ...p }; delete n[id]; return n; });
    if (was === 'booked') setClasses((p) => p.map((x) => (x.id === id ? { ...x, booked: Math.max(0, x.booked - 1) } : x)));
    if (USE_SUPABASE && uid) { try { await supabase.rpc('cancel_class', { p_class: id }); } catch { /* ignore */ } }
  };

  const addClass: ClassesValue['addClass'] = async (c) => {
    const local: GymClass = { ...c, id: 'local-' + Date.now(), booked: 0 };
    setClasses((p) => [...p, local].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
    if (USE_SUPABASE && uid) {
      try {
        const { data } = await supabase.from('gym_classes').insert({ trainer_id: uid, title: c.title, kind: c.kind, instructor: c.instructor, branch: c.branch, room: c.room, starts_at: c.startsAt, duration_min: c.durationMin, capacity: c.capacity }).select().single();
        if (data) setClasses((p) => p.map((x) => (x.id === local.id ? rowToClass(data) : x)));
      } catch { /* keep local */ }
    }
  };

  return <Ctx.Provider value={{ classes, myStatus, book, cancel, addClass, refresh: load, ready }}>{children}</Ctx.Provider>;
}

export function useClasses(): ClassesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClasses must be used inside <ClassesProvider>');
  return v;
}
