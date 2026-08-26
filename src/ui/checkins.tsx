// Weekly check-ins. Client submits weight + energy/sleep/mood/adherence + a note;
// the coach sees the latest on the client detail. Persists to Supabase per user
// (hydrate-or-seed + optimistic insert) with a defensive in-memory fallback.
//
// A check-in is the one thing in this app that BOTH sides read: the client sees
// their own history, the coach sees `latest` on the client detail and judges
// adherence from it. A failed read produced `checkins: []` and therefore
// `latest: null`, which the coach's screen renders as "no check-ins yet" — a
// client who has checked in every week for a month can be shown to their coach
// as someone who has never once bothered. `status` is what stops that being
// stated as fact.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';

export interface CheckIn {
  id: string; at: string;
  weightKg: number; energy: number; sleep: number; mood: number; adherence: number; note: string;
}

interface CheckInsValue {
  checkins: CheckIn[];
  latest: CheckIn | null;
  /** Whether `checkins` is the server's answer. Under 'error' a null `latest`
   *  means unknown, and no screen should read it as "never checked in". */
  status: LoadStatus;
  /** Resolves true only once the check-in is on the server, where the coach can
   *  read it. False means the client's coach will never see this one. */
  addCheckIn: (c: Omit<CheckIn, 'id' | 'at'>) => Promise<boolean>;
}

let SEQ = 700;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };

const rowToCI = (r: any): CheckIn => ({ id: r.id, at: r.at, weightKg: Number(r.weight_kg), energy: r.energy, sleep: r.sleep, mood: r.mood, adherence: r.adherence, note: r.note ?? '' });
const ciToRow = (uid: string, c: CheckIn) => ({ user_id: uid, at: c.at, weight_kg: c.weightKg, energy: c.energy, sleep: c.sleep, mood: c.mood, adherence: c.adherence, note: c.note });

const Ctx = createContext<CheckInsValue | null>(null);

export function CheckInsProvider({ children }: { children: ReactNode }) {
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        const { data, error } = await supabase.from('check_ins').select('*').eq('user_id', id).order('at', { ascending: false });
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        // No rows means no check-ins. Show that, do NOT invent one — this used to
        // INSERT a fabricated 68.0 kg check-in into Supabase for every new account,
        // which then persisted forever and drove the trainer's adherence figures.
        setCheckins(data && data.length ? data.map(rowToCI) : []);
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const addCheckIn: CheckInsValue['addCheckIn'] = async (c) => {
    const entry: CheckIn = { ...c, id: `ci${SEQ++}`, at: new Date().toISOString() };
    setCheckins((p) => [entry, ...p]);
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('check_ins').insert(ciToRow(uid, entry));
      return !error;
    } catch { return false; }
  };

  return <Ctx.Provider value={{ checkins, latest: checkins[0] ?? null, status, addCheckIn }}>{children}</Ctx.Provider>;
}

export function useCheckIns(): CheckInsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCheckIns must be used inside <CheckInsProvider>');
  return v;
}
