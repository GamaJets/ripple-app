// Coach → client invites by email. A trainer invites someone by email; the
// client with that email sees a pending invitation and accepts, which links the
// two accounts (accept_invite → link_coaching → coaching_relationships +
// clients.trainer_id). Supabase-backed. Accepted/declined invites are remembered
// locally (AsyncStorage) so a handled invitation never re-appears on next login,
// and a real signed-in account never sees the sample invite.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
const DISMISS_KEY = 'repple.invites.dismissed'; // ids the user has accepted/declined

const rowToInvite = (r: any): Invite => ({
  id: String(r.id),
  coachId: r.coach_id,
  coachName: r.coach_name ?? null,
  email: r.email,
  mode: r.mode === 'inperson' ? 'inperson' : 'online',
  status: r.status ?? 'pending',
  createdAt: r.created_at ?? new Date().toISOString(),
});

// No demo invitation. A fabricated pending invite from "Coach Sam Rivera" used
// to be injected here in no-backend mode; a client had a coaching invitation
// from someone who does not exist sitting in their app.

const Ctx = createContext<InvitesValue | null>(null);

export function InvitesProvider({ children }: { children: ReactNode }) {
  const [sent, setSent] = useState<Invite[]>([]);
  const [received, setReceived] = useState<Invite[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const persistDismissed = (next: Set<string>) => {
    setDismissed(next);
    AsyncStorage.setItem(DISMISS_KEY, JSON.stringify([...next])).catch(() => {});
  };
  const markDismissed = (id: string) => { const next = new Set(dismissed); next.add(id); persistDismissed(next); };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // What the user already handled (accepted/declined) — never show it again.
      let skip = new Set<string>();
      try { const raw = await AsyncStorage.getItem(DISMISS_KEY); if (raw) skip = new Set<string>(JSON.parse(raw)); } catch { /* ignore */ }
      if (!cancelled) setDismissed(skip);

      // Demo mode (no backend): show the sample invite unless already handled.
      if (!USE_SUPABASE) { if (!cancelled) setReceived([]); return; }

      // Real backend: only ever show genuine pending invites for this email.
      // No fake/sample invite for a live account (that was the re-pop bug).
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user;
        if (!u || cancelled) return;
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

        // Received (addressed to my email, still pending, not already handled here).
        const email = u.email;
        if (email && !cancelled) {
          try {
            const r = await supabase.from('coach_invites').select('*').ilike('email', email).eq('status', 'pending');
            if (!cancelled) setReceived((r.data ?? []).map(rowToInvite).filter((i) => !skip.has(i.id)));
          } catch { if (!cancelled) setReceived([]); }
        }
      } catch { /* leave received empty — no sample invite on a real account */ }
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
    markDismissed(id); // never re-show this invite, even if the RPC lags or fails
    if (USE_SUPABASE && inv && !inv.demo) {
      try { await supabase.rpc('accept_invite', { p_invite: id }); } catch { /* ignore — dismissed locally */ }
    }
    return mode;
  };

  const declineInvite: InvitesValue['declineInvite'] = (id) => {
    const inv = received.find((i) => i.id === id);
    setReceived((p) => p.filter((i) => i.id !== id));
    markDismissed(id);
    if (USE_SUPABASE && inv && !inv.demo && !id.startsWith('local-')) {
      try { supabase.from('coach_invites').update({ status: 'revoked' }).eq('id', id).then(() => {}, () => {}); } catch { /* ignore */ }
    }
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
