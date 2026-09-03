// The member's side of a gym invitation: read the ones addressed to me, and
// accept one.
//
// ── Why this file exists at all ───────────────────────────────────────────
//
// `fetchMyInvites` and `acceptInvite` have been in src/lib/memberInvites.ts for
// months and nothing imported them — scripts/check-dead-exports.mjs carried the
// pair and named the consequence: "a gym invite cannot be accepted in the app".
// Meanwhile `inviteMessage` in that same module emails two hundred people "sign
// up with this exact address… that is how the invitation finds you". They did,
// and the app had nowhere for them to go.
//
// ── What is read, and what cannot be ──────────────────────────────────────
//
// The invitation rows come back under `mi_invitee_read`, which matches on the
// signed-in address alone — no tenant, because the whole point is that this runs
// BEFORE the person belongs to one. That same fact is why the gym's NAME does
// not come with them: `tenants_client_r` scopes tenant rows to people already in
// the tenant, so an invitee cannot read the name of the gym inviting them.
//
// `my_invited_gyms()` (supabase/parts/960) is the definer function that closes
// that, and this hook treats it as OPTIONAL: if it is missing or refuses, the
// invitations still list and src/lib/gymInvite.ts describes the gym instead of
// naming it. A name is worth having and is not worth making the accept path
// depend on a migration having been applied.
//
// ── The accept is counted, never assumed ──────────────────────────────────
//
// supabase-js RESOLVES a raised exception with `error` set, and
// accept_member_invite raises for every refusal it has — wrong address, already
// used, withdrawn, lapsed, an owner's account. src/ui/invites.tsx is where that
// exact mistake was made for COACH invites: the RPC was fired with the result
// thrown away, the invitation was deleted locally, and the member was told they
// were coached while the coach never received them. So `accept` here returns
// the membership id the server itself returned, and anything else — an error, a
// null, an empty string — is a failure that leaves the invitation in place.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { fetchMyInvites, acceptInvite, type MemberInvite } from '../lib/memberInvites';
import { acceptFailedMessage } from '../lib/gymInvite';
import type { LoadStatus } from './loadStatus';

export interface GymInvitesValue {
  invites: MemberInvite[];
  /** Under 'error' an empty list means we could not check — never that no gym
   *  has invited you. That distinction is the whole of src/ui/loadStatus.ts. */
  status: LoadStatus;
  /** tenantId → the gym's own name, for the invitations we could get one for.
   *  A missing key is "not known" and is rendered as a description, not a gap. */
  gymNames: Map<string, string | null>;
  reload: () => void;
  /**
   * Accept one. Resolves `ok` only once the server has returned the membership
   * it opened; `message` is what to show the member either way, and never a
   * Postgres string.
   */
  accept: (inviteId: string) => Promise<{ ok: boolean; membershipId: string | null; message: string | null }>;
}

/** The optional name lookup. Silent on failure by design — see the header. */
async function readGymNames(): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!USE_SUPABASE) return out;
  try {
    const { data, error } = await supabase.rpc('my_invited_gyms');
    // no-error-ok: the names are decoration. Until part 960 is applied this
    // returns "function does not exist", and the invitations must still list.
    if (error || !Array.isArray(data)) return out;
    for (const r of data as any[]) {
      if (r?.tenant_id) out.set(String(r.tenant_id), r.gym_name ?? null);
    }
  } catch { /* same reason */ }
  return out;
}

export function useGymInvites(): GymInvitesValue {
  const [invites, setInvites] = useState<MemberInvite[]>([]);
  const [gymNames, setGymNames] = useState<Map<string, string | null>>(() => new Map());
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // Every read carries the run it belongs to, so a slow first answer landing
  // after a pull-to-refresh cannot overwrite the newer one.
  const run = useRef(0);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setInvites([]); setStatus('ready'); return; }
    const mine = ++run.current;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const rows = await fetchMyInvites(supabase);
      if (run.current !== mine) return;
      setInvites(rows);
      setStatus('ready');
      const names = await readGymNames();
      if (run.current !== mine) return;
      setGymNames(names);
    } catch (e) {
      if (run.current !== mine) return;
      reportError('gymInvites.list', e);
      // The list is emptied as well as marked: holding rows from a previous
      // read under 'error' would offer an Accept button for an invitation we
      // can no longer confirm exists.
      setInvites([]);
      setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const accept = useCallback(async (inviteId: string) => {
    if (!USE_SUPABASE) {
      return { ok: false, membershipId: null, message: acceptFailedMessage(null) };
    }
    try {
      const membershipId = await acceptInvite(supabase, inviteId);
      if (!membershipId) {
        // The function returns the membership it opened. No id is not a
        // success we failed to notice; it is a write we cannot evidence.
        reportError('gymInvites.accept', new Error('accept_member_invite returned no membership'));
        return { ok: false, membershipId: null, message: acceptFailedMessage(null) };
      }
      // Only now is the invitation gone from this screen, and only because the
      // server said so.
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      return { ok: true, membershipId, message: null };
    } catch (e: any) {
      reportError('gymInvites.accept', e);
      return { ok: false, membershipId: null, message: acceptFailedMessage(e?.message ?? null) };
    }
  }, []);

  // Stable across renders: app/(client)/trainers.tsx puts this in a
  // `useCallback` dependency list for its pull-to-refresh, and a new function
  // every render would rebuild that handler on every render.
  const reload = useCallback(() => { void load(); }, [load]);

  return { invites, status, gymNames, reload, accept };
}
