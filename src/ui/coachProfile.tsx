// Coach profile — the trainer's public-facing identity (photo, tagline, bio, what
// they offer, session fee). Shared state so the coach edits it in their portal and
// clients see it on the booking screen. Starts empty until the coach fills it in.
//
// Persistence: profiles(full_name, avatar) + trainers(bio, tagline, offers,
// specialties, session_fee). Previously every field except the name lived only in
// AsyncStorage, which this provider clears on launch when USE_SUPABASE is on — so
// a coach's tagline/bio/offers/specialties/fee were silently lost on every restart,
// and an edited name never reached the server at all (clients kept seeing the old
// one, and the next launch overwrote the edit with the stale server value).
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  // Set only once the server copy has been read for this uid. Nothing is written
  // back before then, so a stale local value can never clobber the real profile
  // (same guard clientData.tsx uses for the client name).
  const [uid, setUid] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => { (async () => { try { if (USE_SUPABASE) { await AsyncStorage.removeItem('repple.coachProfile'); } else { const raw = await AsyncStorage.getItem('repple.coachProfile'); if (raw) { const p = JSON.parse(raw); if (typeof p.name === 'string') setName(p.name); if (p.photo === null || typeof p.photo === 'string') setPhoto(p.photo ?? null); if (typeof p.tagline === 'string') setTagline(p.tagline); if (typeof p.bio === 'string') setBio(p.bio); if (Array.isArray(p.offers)) setOffers(p.offers); if (Array.isArray(p.specialties)) setSpecialties(p.specialties); if (typeof p.sessionFee === 'number') setSessionFee(p.sessionFee); } } } catch { /* ignore */ } setHydrated(true); })(); }, []);

  // Load the real server-side profile. Re-fetches on every auth state change (not
  // just once at hydration) — if the Supabase session hasn't finished restoring at
  // the moment this effect first runs (common on a cold launch), a one-shot fetch
  // gives up permanently and the real values never appear.
  useEffect(() => {
    if (!hydrated || !USE_SUPABASE) return;
    let cancelled = false;
    const fetchReal = async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u || cancelled) return;
        setUid(u.id);

        const prof = await supabase.from('profiles').select('full_name, avatar').eq('id', u.id).single();
        if (cancelled) return;
        // Always trust the fetched real profile over whatever was cached locally (a
        // stale name from a previous account on a shared/reused device is not just
        // the mock default — it can be any other real person's name).
        const real = prof.data?.full_name;
        if (typeof real === 'string' && real.trim()) setName(real.trim());
        if (typeof prof.data?.avatar === 'string' && prof.data.avatar) setPhoto(prof.data.avatar);

        const tr = await supabase.from('trainers').select('bio, tagline, offers, specialties, session_fee').eq('id', u.id).single();
        if (cancelled) return;
        const t = tr.data as any;
        if (t) {
          if (typeof t.bio === 'string') setBio(t.bio);
          if (typeof t.tagline === 'string') setTagline(t.tagline);
          if (Array.isArray(t.offers)) setOffers(t.offers);
          if (Array.isArray(t.specialties)) setSpecialties(t.specialties);
          if (t.session_fee != null && !Number.isNaN(Number(t.session_fee))) setSessionFee(Number(t.session_fee));
        }
      } catch { /* keep whatever we have */ }
      if (!cancelled) setSynced(true);
    };
    fetchReal();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled || !session) return;
      setSynced(false);
      fetchReal();
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [hydrated]);

  // Push edits back to the server. Debounced so typing in a text field doesn't fire
  // a write per keystroke. Update-only (never inserts): the trainer row is created
  // at signup, and inventing one here without a tenant_id would be wrong.
  useEffect(() => {
    if (!USE_SUPABASE || !uid || !hydrated || !synced) return;
    const timer = setTimeout(() => {
      try {
        supabase.from('profiles').update({ full_name: name, avatar: photo }).eq('id', uid).then(() => {}, () => {});
        supabase.from('trainers').update({
          bio, tagline, offers, specialties, session_fee: sessionFee,
        }).eq('id', uid).then(() => {}, () => {});
      } catch { /* ignore */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [name, photo, tagline, bio, offers, specialties, sessionFee, uid, hydrated, synced]);

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
