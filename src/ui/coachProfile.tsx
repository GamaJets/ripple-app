// Coach profile — the trainer's public-facing identity (photo, tagline, bio, what
// they offer, session fee). Shared state so the coach edits it in their portal and
// clients see it on the booking screen. Seeded from MOCK_TRAINER.
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOCK_TRAINER } from '../lib/mockData';

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
  const [name, setName] = useState(MOCK_TRAINER.name);
  const [photo, setPhoto] = useState<string | null>(null);
  const [tagline, setTagline] = useState('Strength & fat-loss coaching that fits real life');
  const [bio, setBio] = useState(
    "NASM-certified coach with 8+ years helping busy people get lean and strong. I build training and nutrition around your body, your schedule and your goals — and I keep you accountable every week."
  );
  const [offers, setOffers] = useState<string[]>(['1:1 personal training', 'Custom meal plans', 'Form-check videos', 'Weekly check-ins', 'InBody progress reviews']);
  const [specialties, setSpecialties] = useState<string[]>(['Fat loss', 'Strength', 'Habit coaching']);
  const [sessionFee, setSessionFee] = useState(MOCK_TRAINER.sessionFee);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { (async () => { try { const raw = await AsyncStorage.getItem('repple.coachProfile'); if (raw) { const p = JSON.parse(raw); if (typeof p.name === 'string') setName(p.name); if (p.photo === null || typeof p.photo === 'string') setPhoto(p.photo ?? null); if (typeof p.tagline === 'string') setTagline(p.tagline); if (typeof p.bio === 'string') setBio(p.bio); if (Array.isArray(p.offers)) setOffers(p.offers); if (Array.isArray(p.specialties)) setSpecialties(p.specialties); if (typeof p.sessionFee === 'number') setSessionFee(p.sessionFee); } } catch { /* ignore */ } setHydrated(true); })(); }, []);
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
