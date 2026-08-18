// Owner → trainer invites by email. The owner invites a trainer to join the
// platform; the trainer signs in with that email, sees the invitation, and
// accepts (accept_trainer_invite → attaches them to the owner tenant as a
// trainer + trial) then completes their profile. Supabase-backed with a
// defensive in-memory fallback so the UI never blanks or crashes.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TrainerInvite {
  id: string;
  ownerId: string;
  ownerName: string | null;
  email: string;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  demo?: boolean;
}

interface TrainerInvitesValue {
  sent: TrainerInvite[];      // invites I (owner) have sent
  received: TrainerInvite[];  // pending invites addressed to my email
  sendTrainerInvite: (email: string) => Promise<void>;
  revokeTrainerInvite: (id: string) => void;
  acceptTrainerInvite: (id: string) => Promise<void>;
  declineTrainerInvite: (id: string) => void;
}

let SEQ = 600;

const rowTo = (r: any): TrainerInvite => ({
  id: String(r.id),
  ownerId: r.owner_id,
  ownerName: r.owner_name ?? null,
  email: r.email,
  status: r.status ?? 'pending',
  createdAt: r.created_at ?? new Date().toISOString(),
});

const Ctx = createContext<TrainerInvitesValue | null>(null);

export function TrainerInvitesProvider({ children }: { children: ReactNode }) {
  const [sent, setSent] = useState<TrainerInvite[]>([]);
  const [received, setReceived] = useState<TrainerInvite[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const DISMISS_KEY = 'repple.trainerInvites.dismissed';
  const markDismissed = (id: string) => {
    AsyncStorage.getItem(DISMISS_KEY).then((raw) => {
      const set = new Set<string>(raw ? JSON.parse(raw) : []);
      set.add(id);
      return AsyncStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
    }).catch(() => {});
  };
  // No demo invitation. This used to inject a fabricated pending invite from
  // "Repple HQ" — and it fired whenever there was no authenticated user, not
  // only in no-backend mode, so a signed-out trainer saw an invitation that
  // had never been sent.
  const seedDemo = () => { setReceived([]); };

  useEffect(() => {
    if (!USE_SUPABASE) { seedDemo(); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u || cancelled) { seedDemo(); return; }
        setUid(u.id);
        try {
          const prof = await supabase.from('profiles').select('full_name, tenant_id').eq('id', u.id).single();
          if (!cancelled && prof.data) { setMyName(prof.data.full_name ?? null); setTenantId(prof.data.tenant_id ?? null); }
        } catch { /* optional */ }
        try {
          const s = await supabase.from('trainer_invites').select('*').eq('owner_id', u.id).order('created_at', { ascending: false });
          if (!cancelled && s.data) setSent(s.data.map(rowTo));
        } catch { /* ignore */ }
        const email = u.email;
        if (email) {
          try {
            const r = await supabase.from('trainer_invites').select('*').ilike('email', email).eq('status', 'pending');
            if (!cancelled) {
              if (r.data && r.data.length) setReceived(r.data.map(rowTo));
              // no pending invites for a real account -> clean slate, no sample
            }
          } catch { /* real account: never fall back to the sample invite */ }
        }
      } catch { seedDemo(); }
    })();
    return () => { cancelled = true; };
  }, []);

  const sendTrainerInvite: TrainerInvitesValue['sendTrainerInvite'] = async (rawEmail) => {
    const e = (rawEmail || '').trim().toLowerCase();
    if (!e) return;
    const optimistic: TrainerInvite = {
      id: `local-${SEQ++}`, ownerId: uid ?? 'me', ownerName: myName,
      email: e, status: 'pending', createdAt: new Date().toISOString(),
    };
    setSent((p) => [optimistic, ...p.filter((i) => i.email.toLowerCase() !== e)]);
    if (USE_SUPABASE && uid) {
      try {
        const { data } = await supabase
          .from('trainer_invites')
          .upsert({ owner_id: uid, owner_name: myName, tenant_id: tenantId, email: e, status: 'pending' }, { onConflict: 'owner_id,email' })
          .select()
          .single();
        if (data) setSent((p) => [rowTo(data), ...p.filter((i) => i.id !== optimistic.id && i.email.toLowerCase() !== e)]);
      } catch { /* keep optimistic */ }
    }
  };

  const revokeTrainerInvite: TrainerInvitesValue['revokeTrainerInvite'] = (id) => {
    setSent((p) => p.filter((i) => i.id !== id));
    if (USE_SUPABASE && !id.startsWith('local-')) {
      try { supabase.from('trainer_invites').update({ status: 'revoked' }).eq('id', id).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  const acceptTrainerInvite: TrainerInvitesValue['acceptTrainerInvite'] = async (id) => {
    const inv = received.find((i) => i.id === id);
    setReceived((p) => p.filter((i) => i.id !== id));
    markDismissed(id);
    if (USE_SUPABASE && inv && !inv.demo) {
      try { await supabase.rpc('accept_trainer_invite', { p_invite: id }); } catch { /* ignore */ }
    }
  };

  const declineTrainerInvite: TrainerInvitesValue['declineTrainerInvite'] = (id) => {
    setReceived((p) => p.filter((i) => i.id !== id));
    markDismissed(id);
  };

  return (
    <Ctx.Provider value={{ sent, received, sendTrainerInvite, revokeTrainerInvite, acceptTrainerInvite, declineTrainerInvite }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTrainerInvites(): TrainerInvitesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTrainerInvites must be used inside <TrainerInvitesProvider>');
  return v;
}
