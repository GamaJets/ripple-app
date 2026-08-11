// Coach profile — the trainer's public-facing identity (photo, tagline, bio, what
// they offer, session fee). Shared state so the coach edits it in their portal and
// clients see it on the booking screen. Seeded from MOCK_TRAINER.
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOCK_TRAINER } from '../lib/mockData';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

interface CoachProfileValue {
  name: string; setName: (v: string) => void;
  photo: string | null; setPhoto: (v: string | null) => void;
  tagline: string; setTagline: (v: string) => void;
  bio: string; setBio: (v: string) => void;
  offers: string[]; setOffers: (v: string[]) => void;
  specialties: string[]; setSpecialties: (v: string[]) => void;
  sessionFee: number; setSessionFee: (v: number) => void;
}

const Ctx = createContext<CoachProfileValue | null>(null);

export function CoachProfileProvider({ children }: { children: ReactNode }) {
  // NO mock data — always start empty. Real data loads from Supabase if user is authenticated.
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [offers, setOffers] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [sessionFee, setSessionFee] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { (async () => { try { if (USE_SUPABASE) { await AsyncStorage.removeItem('repple.coachProfile'); } else { const raw = await AsyncStorage.getItem('repple.coachProfile'); if (raw) { const p = JSON.parse(raw); if (typeof p.name === 'string') setName(p.name); if (p.photo === null || typeof p.photo === 'string') setPhoto(p.photo ?? null); if (typeof p.tagline === 'string') setTagline(p.tagline); if (typeof p.bio === 'string') setBio(p.bio); if (Array.isArray(p.offers)) setOffers(p.offers); if (Array.isArray(p.specialties)) setSpecialties(p.specialties); if (typeof p.sessionFee === 'number') setSessionFee(p.sessionFee); } } } catch { /* ignore */ } setHydrated(true); })(); }, []);
  // Real account: use the signed-in profile's name unless the coach set a custom
  // one. Fixes real trainers seeing the demo identity ("Coach Daniel Reyes").
  useEffect(() => {
    if (!hydrated || !USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u || cancelled) return;
        const prof = await supabase.from('profiles').select('full_name').eq('id', u.id).single();
        const real = prof.data?.full_name;
        if (!cancelled && typeof real === 'string' && real.trim()) {
          // Always trust the fetched real profile name over whatever was cached
          // locally (a stale name from a previous account on a shared/reused
          // device is not just the mock default — it can be any other real name).
          setName(real.trim());
        }
      } catch { /* keep whatever we have */ }
    })();
    return () => { cancelled = true; };
  }, [hydrated]);

  useEffect(() => { if (!hydrated) return; AsyncStorage.setItem('repple.coachProfile', JSON.stringify({ name, photo, tagline, bio, offers, specialties, sessionFee })).catch(() => {}); }, [hydrated, name, photo, tagline, bio, offers, specialties, sessionFee]);

  return (
    <Ctx.Provider value={{ name, setName, photo, setPhoto, tagline, setTagline, bio, setBio, offers, setOffers, specialties, setSpecialties, sessionFee, setSessionFee }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCoachProfile(): CoachProfileValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachProfile must be used inside <CoachProfileProvider>');
  return v;
}
