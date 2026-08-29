// Coach → client invites by email. A trainer invites someone by email; the
// client with that email sees a pending invitation and accepts, which links the
// two accounts (accept_invite → link_coaching → coaching_relationships +
// clients.trainer_id). Supabase-backed. Accepted/declined invites are remembered
// locally (AsyncStorage) so a handled invitation never re-appears on next login,
// and a real signed-in account never sees the sample invite.
//
// ── Accepting an invitation was the failure with no symptom ────────────────
//
// acceptInvite removed the invite from the list, wrote its id to the permanent
// "already handled" set, and then fired `accept_invite` with the result thrown
// away — `try { await supabase.rpc(…) } catch { }`, and supabase-js resolves on
// a refused RPC rather than throwing, so even the catch was decorative. When the
// link failed, the client's invitation was gone forever (the dismiss set is
// persisted), they had been told they were now coached, and the coach never
// received them. Neither side had anything to look at that would explain it.
//
// The dismiss now happens only once the server has actually made the link. A
// failed accept puts the invitation back and lists its id in `acceptFailed`, so
// the client can try again instead of losing it.
//
// The reads had the ordinary version: `sent` and `received` each swallowed their
// query, so "no pending invitations" and "we could not check" looked the same.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { readCoachedMode, modeForDb, type CoachedMode } from '../lib/types';

/** Alias kept because half the app imports the invite's mode from here. The
 *  vocabulary itself is in src/lib/types.ts — an invite's delivery and a
 *  roster entry's delivery are the same three answers. */
export type InviteMode = CoachedMode;
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
  /** Whether the two lists are the server's answer. Under 'error' an empty
   *  `received` means we could not check, not that nobody has invited you. */
  status: LoadStatus;
  /** Ids whose accept did NOT reach the server. The invitation is still in
   *  `received` and the two accounts are NOT linked — the caller must not
   *  navigate the client onward as though they now have a coach. */
  acceptFailed: string[];
  /** Resolves true only once the invitation is on the server, where the person
   *  being invited can actually see it. */
  sendInvite: (email: string, mode: InviteMode) => Promise<boolean>;
  /** Resolves true only when the invitation was actually revoked server-side. */
  revokeInvite: (id: string) => Promise<boolean>;
  /** The mode of the invite. NOTE: this resolves with a mode whether or not the
   *  link was made — the signature predates the fix — so check `acceptFailed`
   *  for the id before telling the client they are coached. */
  /**
   * Accept a coaching invitation.
   *
   * `ok` is the whole point: `acceptFailed` is React state, so a caller that
   * awaits this and then reads `acceptFailed` sees the value from the render it
   * was created in — the stale one — and concludes the accept worked. The
   * result has to travel back on the promise itself.
   */
  acceptInvite: (id: string) => Promise<{ mode: InviteMode; ok: boolean }>;
  /** Resolves true only when the decline was recorded server-side. */
  declineInvite: (id: string) => Promise<boolean>;
}

let SEQ = 500;
const DISMISS_KEY = 'repple.invites.dismissed'; // ids the user has accepted/declined

const rowToInvite = (r: any): Invite => ({
  id: String(r.id),
  coachId: r.coach_id,
  coachName: r.coach_name ?? null,
  email: r.email,
  mode: readCoachedMode(r.mode),
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
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [acceptFailed, setAcceptFailed] = useState<string[]>([]);

  const persistDismissed = (next: Set<string>) => {
    setDismissed(next);
    AsyncStorage.setItem(DISMISS_KEY, JSON.stringify([...next])).catch(() => {});
  };
  const markDismissed = (id: string) => { const next = new Set(dismissed); next.add(id); persistDismissed(next); };

  // ── Why this listens to auth instead of running once ──────────────────
  //
  // This effect used to be `useEffect(… , [])`: it ran a single time, when the
  // provider mounted. That is BEFORE anybody has signed in — the app is sitting
  // on the welcome screen — so `getUser()` came back with AuthSessionMissingError,
  // the catch below set status to 'error', and the empty dependency array meant
  // it was never asked again for the life of the app.
  //
  // Signing in did not re-run it. So a member who had genuinely been invited saw
  // no invitation on their home screen, permanently, and the coach saw no
  // acceptance — reported four separate times across both apps as "the coach is
  // not listed here" and "client doesn't get the request to join". The edge logs
  // show it plainly: after a successful sign-in, coach_invites is never
  // requested at all.
  //
  // It now re-runs whenever the session changes. `gen` guards against an older,
  // slower run finishing after a newer one and overwriting it.
  useEffect(() => {
    let gen = 0;
    let dead = false;
    const run = async () => {
      const mine = ++gen;
      const cancelled = () => dead || mine !== gen;
      // What the user already handled (accepted/declined) — never show it again.
      let skip = new Set<string>();
      try { const raw = await AsyncStorage.getItem(DISMISS_KEY); if (raw) skip = new Set<string>(JSON.parse(raw)); } catch { /* ignore */ }
      if (!cancelled()) setDismissed(skip);

      // Demo mode (no backend): show the sample invite unless already handled.
      if (!USE_SUPABASE) { if (!cancelled()) { setReceived([]); setStatus('ready'); } return; }

      // Real backend: only ever show genuine pending invites for this email.
      // No fake/sample invite for a live account (that was the re-pop bug).
      let failed = false;
      try {
        // getSession() first, deliberately. getUser() REJECTS when there is no
        // session, and treating that as a failed check is what latched this
        // provider into 'error' on every cold start. Signed out is a real
        // answer — nobody has invited you, because nobody knows who you are.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled()) return;
        if (!sess?.session) { setReceived([]); setSent([]); setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled()) return;
        if (authErr) { setStatus('error'); return; }
        const u = auth?.user;
        // Signed out: no invitations addressed to anybody, which is true.
        if (!u) { setStatus('ready'); return; }
        setUid(u.id);
        try {
          const prof = await supabase.from('profiles').select('full_name').eq('id', u.id).single();
          if (!cancelled() && prof.data) setMyName(prof.data.full_name ?? null);
        } catch { /* the coach's own name is cosmetic on the invite */ }

        // Sent (I'm the coach). `s.error` was never read, so a refused read
        // showed the coach an empty "invitations sent" list and invited them to
        // send the same invitation over again.
        try {
          const s = await supabase.from('coach_invites').select('*').eq('coach_id', u.id).order('created_at', { ascending: false });
          if (s.error) failed = true;
          else if (!cancelled() && s.data) setSent(s.data.map(rowToInvite));
        } catch { failed = true; }

        // Received (addressed to my email, still pending, not already handled here).
        const email = u.email;
        if (email && !cancelled()) {
          try {
            const r = await supabase.from('coach_invites').select('*').ilike('email', email).eq('status', 'pending');
            if (r.error) failed = true;
            else if (!cancelled()) setReceived((r.data ?? []).map(rowToInvite).filter((i) => !skip.has(i.id)));
          } catch { failed = true; if (!cancelled()) setReceived([]); }
        }
      } catch { failed = true; /* leave received empty — no sample invite on a real account */ }
      if (!cancelled()) setStatus(failed ? 'error' : 'ready');
    };
    run();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      // SIGNED_IN is the one that matters; the others keep the list honest when
      // a session is restored, refreshed into a different user, or dropped.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT'
          || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') run();
    });
    return () => { dead = true; sub?.subscription?.unsubscribe(); };
  }, []);

  const sendInvite: InvitesValue['sendInvite'] = async (rawEmail, mode) => {
    const e = (rawEmail || '').trim().toLowerCase();
    if (!e) return false;
    const optimistic: Invite = {
      id: `local-${SEQ++}`, coachId: uid ?? 'me', coachName: myName,
      email: e, mode, status: 'pending', createdAt: new Date().toISOString(),
    };
    setSent((p) => [optimistic, ...p.filter((i) => i.email.toLowerCase() !== e)]);
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { data, error } = await supabase
        .from('coach_invites')
        // `coach_invites.mode` is CHECK-constrained to ('online','inperson'),
        // so a hybrid invite goes out as 'inperson' and comes back that way in
        // the coach's Pending list. It is the half of hybrid the invitee has to
        // act on — turn up — and it is what the SQL in the TF-30 report widens.
        .upsert({ coach_id: uid, coach_name: myName, email: e, mode: modeForDb(mode), status: 'pending' }, { onConflict: 'coach_id,email' })
        .select()
        .single();
      // An invitation that was refused still appeared in the coach's sent list
      // looking despatched. Nobody was ever going to receive it.
      if (error || !data) return false;
      setSent((p) => [rowToInvite(data), ...p.filter((i) => i.id !== optimistic.id && i.email.toLowerCase() !== e)]);
      return true;
    } catch { return false; }
  };

  const revokeInvite: InvitesValue['revokeInvite'] = async (id) => {
    setSent((p) => p.filter((i) => i.id !== id));
    // A local id never reached the server; dropping it here is the whole revoke.
    if (!USE_SUPABASE || id.startsWith('local-')) return true;
    try {
      const { error } = await supabase.from('coach_invites').update({ status: 'revoked' }).eq('id', id);
      return !error;
    } catch { return false; }
  };

  const acceptInvite: InvitesValue['acceptInvite'] = async (id) => {
    const inv = received.find((i) => i.id === id);
    const mode: InviteMode = inv?.mode ?? 'online';
    setReceived((p) => p.filter((i) => i.id !== id));
    if (!USE_SUPABASE || !inv || inv.demo) { markDismissed(id); return { mode, ok: true }; }
    // The dismiss is what makes a failure here permanent — the id goes into a
    // persisted set and the invitation never appears again — so it now waits
    // for the server to confirm the link.
    let linked = false;
    try {
      const { error } = await supabase.rpc('accept_invite', { p_invite: id });
      linked = !error;
    } catch { linked = false; }
    if (linked) { markDismissed(id); setAcceptFailed((p) => p.filter((x) => x !== id)); }
    else {
      // Put it back so the client can try again rather than losing the only
      // route to their coach.
      setReceived((p) => (p.some((i) => i.id === id) ? p : [inv, ...p]));
      setAcceptFailed((p) => (p.includes(id) ? p : [...p, id]));
    }
    return { mode, ok: linked };
  };

  const declineInvite: InvitesValue['declineInvite'] = async (id) => {
    const inv = received.find((i) => i.id === id);
    setReceived((p) => p.filter((i) => i.id !== id));
    // Declining is safe to dismiss locally either way: the worst case is an
    // invitation the coach still sees as pending, not a link the client thinks
    // exists and does not.
    markDismissed(id);
    if (!USE_SUPABASE || !inv || inv.demo || id.startsWith('local-')) return true;
    try {
      const { error } = await supabase.from('coach_invites').update({ status: 'revoked' }).eq('id', id);
      return !error;
    } catch { return false; }
  };

  return (
    <Ctx.Provider value={{ sent, received, status, acceptFailed, sendInvite, revokeInvite, acceptInvite, declineInvite }}>
      {children}
    </Ctx.Provider>
  );
}

export function useInvites(): InvitesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useInvites must be used inside <InvitesProvider>');
  return v;
}
