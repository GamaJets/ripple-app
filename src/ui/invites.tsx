// Coach → client invites by email. A trainer invites someone by email; the
// client with that email sees a pending invitation and accepts, which links the
// two accounts (accept_invite → link_coaching → coaching_relationships +
// clients.trainer_id). Supabase-backed with a defensive in-memory fallback so
// the UI never blanks or crashes if the network/table is unavailable.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export type InviteMode = 'online' | 'inperson';
export interface Invite {
  id: string;
  coachId: string;
  coachName: string | null;
  email: string;
  mode: InviteMode;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  demo?: boolean;
}

interface InvitesValue {
  sent: Invite[];      // invites I (as a trainer) have sent
  received: Invite[];  // pending invites addressed to my email
  sendInvite: (email: string, mode: InviteMode) => Promise<void>;
  revokeInvite: (id: string) => void;
  acceptInvite: (id: string) => Promise<InviteMode>;
  declineInvite: (id: string) => void;
}

let SEQ = 500;

const rowToInvite = (r: any): Invite => ({
  id: String(r.id),
  coachId: r.coach_id,
  coachName: r.coach_name ?? null,
  email: r.email,
  mode: r.mode === 'inperson' ? 'inperson' : 'online',
  status: r.status ?? 'pending',
  createdAt: r.created_at ?? new Date().toISOString(),
});

const Ctx = createContext<InvitesValue | null>(null);

export function InvitesProvider({ children }: { children: ReactNode }) {
  const [sent, setSent] = useState<Invite[]>([]);
  const [received, setReceived] = useState<Invite[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);

  const seedDemo = () => {
    setReceived((p) => (p.length ? p : [{
      id: 'demo-invite',
      coachId: 'demo-coach',
      coachName: 'Coach Sam Rivera',
      email: 'you',
      mode: 'online',
      status: 'pending',
      createdAt: new Date().toISOString(),
      demo: true,
    }]));
  };

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
          const prof = await supabase.from('profiles').select('full_name').eq('id', u.id).single();
          if (!cancelled && prof.data) setMyName(prof.data.full_name ?? null);
        } catch { /* name is optional */ }

        // Sent (I'm the coach).
        try {
          const s = await supabase.from('coach_invites').select('*').eq('coach_id', u.id).order('created_at', { ascending: false });
          if (!cancelled && s.data) setSent(s.data.map(rowToInvite));
        } catch { /* ignore */ }

        // Received (addressed to my email, still pending).
        const email = u.email;
        if (email) {
          try {
            const r = await supabase.from('coach_invites').select('*').ilike('email', email).eq('status', 'pending');
            if (!cancelled) {
              if (r.data && r.data.length) setReceived(r.data.map(rowToInvite));
              else seedDemo();
            }
          } catch { if (!cancelled) seedDemo(); }
        } else if (!cancelled) {
          seedDemo();
        }
      } catch { seedDemo(); }
    })();
    return () => { cancelled = true; };
  }, []);

  const sendInvite: InvitesValue['sendInvite'] = async (rawEmail, mode) => {
    const e = (rawEmail || '').trim().toLowerCase();
    if (!e) return;
    const optimistic: Invite = {
      id: `local-${SEQ++}`, coachId: uid ?? 'me', coachName: myName,
      email: e, mode, status: 'pending', createdAt: new Date().toISOString(),
    };
    setSent((p) => [optimistic, ...p.filter((i) => i.email.toLowerCase() !== e)]);
    if (USE_SUPABASE && uid) {
      try {
        const { data } = await supabase
          .from('coach_invites')
          .upsert({ coach_id: uid, coach_name: myName, email: e, mode, status: 'pending' }, { onConflict: 'coach_id,email' })
          .select()
          .single();
        if (data) setSent((p) => [rowToInvite(data), ...p.filter((i) => i.id !== optimistic.id && i.email.toLowerCase() !== e)]);
      } catch { /* keep optimistic entry */ }
    }
  };

  const revokeInvite: InvitesValue['revokeInvite'] = (id) => {
    setSent((p) => p.filter((i) => i.id !== id));
    if (USE_SUPABASE && !id.startsWith('local-')) {
      try { supabase.from('coach_invites').update({ status: 'revoked' }).eq('id', id).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  const acceptInvite: InvitesValue['acceptInvite'] = async (id) => {
    const inv = received.find((i) => i.id === id);
    const mode: InviteMode = inv?.mode ?? 'online';
    setReceived((p) => p.filter((i) => i.id !== id));
    if (USE_SUPABASE && inv && !inv.demo) {
      try { await supabase.rpc('accept_invite', { p_invite: id }); } catch { /* ignore */ }
    }
    return mode;
  };

  const declineInvite: InvitesValue['declineInvite'] = (id) => {
    setReceived((p) => p.filter((i) => i.id !== id));
  };

  return (
    <Ctx.Provider value={{ sent, received, sendInvite, revokeInvite, acceptInvite, declineInvite }}>
      {children}
    </Ctx.Provider>
  );
}

export function useInvites(): InvitesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useInvites must be used inside <InvitesProvider>');
  return v;
}
