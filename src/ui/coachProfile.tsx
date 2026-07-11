// Coach profile — the trainer's public-facing identity (photo, tagline, bio, what
// they offer, session fee). Shared state so the coach edits it in their portal and
// clients see it on the booking screen. Seeded from MOCK_TRAINER.
import { createContext, useContext, useState, type ReactNode } from 'react';
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
