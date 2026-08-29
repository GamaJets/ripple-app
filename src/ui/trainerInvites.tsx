// Owner → trainer invites by email. The owner invites a trainer to join the
// platform; the trainer signs in with that email, sees the invitation, and
// accepts (accept_trainer_invite → attaches them to the owner tenant as a
// trainer + trial) then completes their profile. Supabase-backed with a
// defensive in-memory fallback so the UI never blanks or crashes.
//
// Same shape of bug as the coach→client invites, one level up. Accepting is what
// attaches a trainer to an owner's tenant and starts their trial; it dismissed
// the invitation permanently and then fired `accept_trainer_invite` with the
// result discarded. A trainer whose RPC was refused lost the invitation for
// good, was shown as onboarded, and belonged to no gym — and the owner's roster
// never gained them. The dismiss now waits for the server.
//
// Both list reads swallowed their query too, so "no pending invitations" and
// "we could not check" were the same empty screen.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';

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
  /** Whether the two lists are the server's answer. Under 'error' an empty
   *  `received` means we could not check, not that nobody invited you. */
  status: LoadStatus;
  /** Resolves true only once the invitation is on the server. */
  sendTrainerInvite: (email: string) => Promise<boolean>;
  /** Resolves true only when the invitation was actually revoked server-side. */
  revokeTrainerInvite: (id: string) => Promise<boolean>;
  /** Resolves true only when the trainer is ACTUALLY attached to the tenant.
   *  False means the invitation is still in `received` and they have no gym —
   *  do not send them on to onboarding. */
  acceptTrainerInvite: (id: string) => Promise<boolean>;
  /** Resolves true when the decline was recorded. */
  declineTrainerInvite: (id: string) => Promise<boolean>;
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
  const authRev = useAuthRevision();
  const [sent, setSent] = useState<TrainerInvite[]>([]);
  const [received, setReceived] = useState<TrainerInvite[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

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
    if (!USE_SUPABASE) { seedDemo(); setStatus('ready'); return; }
    let cancelled = false;
    (async () => {
      let failed = false;
      // A read that came back short, which is not a read that did not happen:
      // the invitations listed are real, there are simply more of them.
      let truncated = false;
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const u = auth?.user;
        // Signed out: nobody has been invited, which is knowable and true.
        if (!u) { seedDemo(); setStatus('ready'); return; }
        setUid(u.id);
        try {
          const prof = await supabase.from('profiles').select('full_name, tenant_id').eq('id', u.id).single();
          if (!cancelled && prof.data) { setMyName(prof.data.full_name ?? null); setTenantId(prof.data.tenant_id ?? null); }
        } catch { /* the owner's own name is cosmetic on the invite */ }
        try {
          // Newest-first and capped. An owner's sent-invite list only grows —
          // nothing here is ever deleted, revoked rows stay — so it is the kind
          // of table that crosses a thousand rows by sitting there. Newest is
          // the end that matters: this list exists to stop an owner re-inviting
          // somebody they invited last week.
          const s = await supabase.from('trainer_invites').select('*').eq('owner_id', u.id)
            .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
          if (s.error) failed = true;
          else if (!cancelled && s.data) {
            const page = capped(s.data);
            if (page.truncated) truncated = true;
            setSent(page.rows.map(rowTo));
          }
        } catch { failed = true; }
        const email = u.email;
        if (email) {
          try {
            // Pending invites addressed to one email address. Genuinely small —
            // it takes a deliberate effort to be invited to a thousand gyms —
            // but capped and ordered anyway so that whatever it does return is
            // the same set twice running.
            const r = await supabase.from('trainer_invites').select('*').ilike('email', email)
              .eq('status', 'pending').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
            if (r.error) failed = true;
            else if (!cancelled) {
              const page = capped(r.data);
              if (page.truncated) truncated = true;
              if (page.rows.length) setReceived(page.rows.map(rowTo));
              // no pending invites for a real account -> clean slate, no sample
            }
          } catch { failed = true; /* real account: never fall back to the sample invite */ }
        }
      } catch { failed = true; seedDemo(); }
      if (!cancelled) setStatus(failed ? 'error' : truncated ? 'partial' : 'ready');
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const sendTrainerInvite: TrainerInvitesValue['sendTrainerInvite'] = async (rawEmail) => {
    const e = (rawEmail || '').trim().toLowerCase();
    if (!e) return false;
    const optimistic: TrainerInvite = {
      id: `local-${SEQ++}`, ownerId: uid ?? 'me', ownerName: myName,
      email: e, status: 'pending', createdAt: new Date().toISOString(),
    };
    setSent((p) => [optimistic, ...p.filter((i) => i.email.toLowerCase() !== e)]);
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { data, error } = await supabase
        .from('trainer_invites')
        .upsert({ owner_id: uid, owner_name: myName, tenant_id: tenantId, email: e, status: 'pending' }, { onConflict: 'owner_id,email' })
        .select()
        .single();
      if (error || !data) return false;
      setSent((p) => [rowTo(data), ...p.filter((i) => i.id !== optimistic.id && i.email.toLowerCase() !== e)]);
      return true;
    } catch { return false; }
  };

  const revokeTrainerInvite: TrainerInvitesValue['revokeTrainerInvite'] = async (id) => {
    setSent((p) => p.filter((i) => i.id !== id));
    if (!USE_SUPABASE || id.startsWith('local-')) return true;
    try {
      const { error } = await supabase.from('trainer_invites').update({ status: 'revoked' }).eq('id', id);
      return !error;
    } catch { return false; }
  };

  const acceptTrainerInvite: TrainerInvitesValue['acceptTrainerInvite'] = async (id) => {
    const inv = received.find((i) => i.id === id);
    setReceived((p) => p.filter((i) => i.id !== id));
    if (!USE_SUPABASE || !inv || inv.demo) { markDismissed(id); return false; }
    let attached = false;
    try {
      // This RPC is what puts the trainer in the owner's tenant and starts
      // their trial. Discarding its result meant a trainer could be dropped
      // between the two accounts with the invitation already burned.
      const { error } = await supabase.rpc('accept_trainer_invite', { p_invite: id });
      attached = !error;
    } catch { attached = false; }
    if (attached) markDismissed(id);
    else setReceived((p) => (p.some((i) => i.id === id) ? p : [inv, ...p]));
    return attached;
  };

  const declineTrainerInvite: TrainerInvitesValue['declineTrainerInvite'] = async (id) => {
    setReceived((p) => p.filter((i) => i.id !== id));
    // Local-only by design (there is no decline RPC): the invitation is hidden
    // on this account and nothing on the server needed to change.
    markDismissed(id);
    return true;
  };

  return (
    <Ctx.Provider value={{ sent, received, status, sendTrainerInvite, revokeTrainerInvite, acceptTrainerInvite, declineTrainerInvite }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTrainerInvites(): TrainerInvitesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTrainerInvites must be used inside <TrainerInvitesProvider>');
  return v;
}
