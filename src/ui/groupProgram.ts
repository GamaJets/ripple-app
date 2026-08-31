// A coach's programme groups — the named list of people a bootcamp programme
// goes out to, and the writes that keep it.
//
// Tables in supabase/parts/134-a-programme-written-once.sql; the arithmetic
// that decides who may be written to is in src/lib/groupProgram.ts. This file
// is only the reads and the writes, and the honesty about both.
//
// ── A hook rather than a provider ──────────────────────────────────────────
//
// Every other shared read in this folder is a Context with a provider mounted
// in a `_layout.tsx`. This one is a plain hook because the two screens that
// need it — the group screen and the builder — do not share state and nothing
// else in the app has any use for it, and because adding a provider means
// editing a layout file that eight other people are working in tonight. The
// cost is one extra read when the builder is open, which is a read of a
// coach's own short list.
//
// ── What the statuses have to carry ────────────────────────────────────────
//
// Two reads: the groups, and their membership. A failure in EITHER is 'error'
// for the whole thing, because a group whose membership could not be read must
// never render as an empty group. Eight people with a bootcamp programme and a
// refused membership read look exactly like a group nobody is in, and the
// screen would then offer to assign the programme to nought of them and report
// it done. `worstStatus` is what says so.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Program } from '../lib/programs';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { reportError } from '../lib/reportError';

export interface ProgramGroup {
  id: string;
  name: string;
  /** The programme the group is defined by, or null when the coach has named
   *  the group and not yet chosen one. Null is a real state, not a missing
   *  read — the read's own status says whether it was read at all. */
  program: Program | null;
  /** The clients in the group. Only meaningful when `status` is 'ready': under
   *  anything else an empty array means the membership did not come back. */
  memberIds: string[];
  createdAt: string | null;
}

/** What an add actually did, per client. Zero rows written is not an error in
 *  PostgREST — a client the policy refused (they are not this coach's, or they
 *  are a hand-added client with no account yet) comes back as a silent no-op —
 *  so the caller is handed the ids that landed and the ids that did not, and
 *  never a boolean that means "the request was accepted". */
export interface AddResult { added: string[]; failed: string[] }

// The store used when the backend is switched off entirely. In that mode the
// local store IS the source of truth, so its status is 'ready' and its writes
// genuinely succeed — see the note on 'ready' in src/ui/loadStatus.ts.
let LOCAL: ProgramGroup[] = [];
let SEQ = 1;
const localId = () => 'grp_' + Date.now().toString(36) + '_' + (SEQ++);

export function useProgramGroups() {
  const authRev = useAuthRevision();
  const [groups, setGroups] = useState<ProgramGroup[]>(() => (USE_SUPABASE ? [] : LOCAL));
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!USE_SUPABASE) { setGroups(LOCAL); setStatus('ready'); return; }
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        // getUser() REJECTS when nobody is signed in, which is a true answer
        // and not a failed check — the same latch that pinned
        // assignedPrograms into 'error' before anybody had signed in.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setGroups([]); setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setGroups([]); setStatus('ready'); return; }
        setUid(id);

        const { data: gRows, error: gErr } = await supabase
          .from('program_groups')
          .select('id, name, program, created_at')
          .eq('coach_id', id)
          .order('created_at', { ascending: false })
          .limit(capLimit());
        if (cancelled) return;
        if (gErr) { reportError('programGroups.read', gErr); setStatus('error'); return; }
        const gPage = capped(gRows);
        const list: ProgramGroup[] = (gPage.rows as any[]).map((r) => ({
          id: r.id, name: r.name, program: (r.program ?? null) as Program | null,
          memberIds: [], createdAt: r.created_at ?? null,
        }));

        if (!list.length) { setGroups([]); setStatus(gPage.truncated ? 'partial' : 'ready'); return; }

        // Membership, in one read across every group. Ordered on the primary
        // key so a capped read returns the same page each launch rather than a
        // different membership every time the coach opens the screen.
        const { data: mRows, error: mErr } = await supabase
          .from('program_group_members')
          .select('group_id, client_id')
          .in('group_id', list.map((g) => g.id))
          .order('group_id', { ascending: true }).order('client_id', { ascending: true })
          .limit(capLimit());
        if (cancelled) return;
        if (mErr) {
          // The groups are real and are shown; their membership is not known.
          // 'error' rather than a list of empty groups, which is the shape that
          // would let an assign run against nought of eight people.
          reportError('programGroups.members', mErr);
          setGroups(list); setStatus('error'); return;
        }
        const mPage = capped(mRows);
        const byGroup = new Map<string, string[]>();
        for (const r of mPage.rows as any[]) {
          const arr = byGroup.get(r.group_id);
          if (arr) arr.push(r.client_id); else byGroup.set(r.group_id, [r.client_id]);
        }
        setGroups(list.map((g) => ({ ...g, memberIds: byGroup.get(g.id) ?? [] })));
        setStatus(worstStatus(
          gPage.truncated ? 'partial' : 'ready',
          mPage.truncated ? 'partial' : 'ready',
        ));
      } catch (e) {
        if (cancelled) return;
        reportError('programGroups.read', e);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [authRev, tick]);

  const createGroup = useCallback(async (name: string): Promise<string | null> => {
    const nm = name.trim();
    if (!nm) return null;
    if (!USE_SUPABASE) {
      const g: ProgramGroup = { id: localId(), name: nm, program: null, memberIds: [], createdAt: new Date().toISOString() };
      LOCAL = [g, ...LOCAL]; setGroups(LOCAL);
      return g.id;
    }
    if (!uid) return null;
    try {
      // Counted, not merely un-errored: the returned row is what proves the
      // group exists to be added to. A caller handed a group id the server
      // never created would fill it with members that go nowhere.
      const { data, error } = await supabase.from('program_groups')
        .insert({ coach_id: uid, name: nm }).select('id, created_at');
      if (error) { reportError('programGroups.create', error, { name: nm }); return null; }
      if (!data || !data.length) { reportError('programGroups.create', new Error('insert returned no row'), { name: nm }); return null; }
      const row = data[0] as any;
      setGroups((gs) => [{ id: row.id, name: nm, program: null, memberIds: [], createdAt: row.created_at ?? null }, ...gs]);
      return row.id as string;
    } catch (e) { reportError('programGroups.create', e, { name: nm }); return null; }
  }, [uid]);

  const renameGroup = useCallback(async (id: string, name: string): Promise<boolean> => {
    const nm = name.trim();
    if (!nm) return false;
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, name: nm } : g)));
    if (!USE_SUPABASE) { LOCAL = LOCAL.map((g) => (g.id === id ? { ...g, name: nm } : g)); return true; }
    try {
      const { data, error } = await supabase.from('program_groups')
        .update({ name: nm, updated_at: new Date().toISOString() }).eq('id', id).select('id');
      if (error) { reportError('programGroups.rename', error, { id }); return false; }
      return !!data && data.length > 0;
    } catch (e) { reportError('programGroups.rename', e, { id }); return false; }
  }, []);

  const setGroupProgram = useCallback(async (id: string, program: Program): Promise<boolean> => {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, program } : g)));
    if (!USE_SUPABASE) { LOCAL = LOCAL.map((g) => (g.id === id ? { ...g, program } : g)); return true; }
    try {
      const { data, error } = await supabase.from('program_groups')
        .update({ program, updated_at: new Date().toISOString() }).eq('id', id).select('id');
      if (error) { reportError('programGroups.setProgram', error, { id }); return false; }
      // Zero rows is not an error here. It is a policy refusal, and it means
      // the group on this screen is not the group on the server.
      return !!data && data.length > 0;
    } catch (e) { reportError('programGroups.setProgram', e, { id }); return false; }
  }, []);

  const deleteGroup = useCallback(async (id: string): Promise<boolean> => {
    if (!USE_SUPABASE) { LOCAL = LOCAL.filter((g) => g.id !== id); setGroups(LOCAL); return true; }
    try {
      const { data, error } = await supabase.from('program_groups').delete().eq('id', id).select('id');
      if (error) { reportError('programGroups.delete', error, { id }); return false; }
      const gone = !!data && data.length > 0;
      if (gone) setGroups((gs) => gs.filter((g) => g.id !== id));
      return gone;
    } catch (e) { reportError('programGroups.delete', e, { id }); return false; }
  }, []);

  const addMembers = useCallback(async (id: string, clientIds: string[]): Promise<AddResult> => {
    const wanted = [...new Set(clientIds)];
    if (!wanted.length) return { added: [], failed: [] };
    if (!USE_SUPABASE) {
      LOCAL = LOCAL.map((g) => (g.id === id ? { ...g, memberIds: [...new Set([...g.memberIds, ...wanted])] } : g));
      setGroups(LOCAL);
      return { added: wanted, failed: [] };
    }
    try {
      // `ignoreDuplicates` so re-adding somebody already in the group is a
      // no-op rather than a conflict — but that makes a returned row count an
      // unreliable measure on its own, so the truth is read back below rather
      // than inferred from the insert.
      const { error } = await supabase.from('program_group_members')
        .upsert(wanted.map((c) => ({ group_id: id, client_id: c })), { onConflict: 'group_id,client_id', ignoreDuplicates: true });
      if (error) reportError('programGroups.addMembers', error, { id });
      // Whatever the insert said, this is who is actually in the group. A
      // client the policy refused — not this coach's, or a hand-added client
      // with no account for the foreign key to find — is a silent no-op in
      // PostgREST, and telling the coach "added" for them is how somebody ends
      // up believing eight people are on a programme when six are.
      const { data, error: readErr } = await supabase.from('program_group_members')
        .select('client_id').eq('group_id', id).in('client_id', wanted).limit(capLimit());
      if (readErr) { reportError('programGroups.addMembers.verify', readErr, { id }); return { added: [], failed: wanted }; }
      const there = new Set((data ?? []).map((r: any) => r.client_id as string));
      const added = wanted.filter((c) => there.has(c));
      if (added.length) {
        setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, memberIds: [...new Set([...g.memberIds, ...added])] } : g)));
      }
      return { added, failed: wanted.filter((c) => !there.has(c)) };
    } catch (e) { reportError('programGroups.addMembers', e, { id }); return { added: [], failed: wanted }; }
  }, []);

  const removeMember = useCallback(async (id: string, clientId: string): Promise<boolean> => {
    if (!USE_SUPABASE) {
      LOCAL = LOCAL.map((g) => (g.id === id ? { ...g, memberIds: g.memberIds.filter((c) => c !== clientId) } : g));
      setGroups(LOCAL);
      return true;
    }
    try {
      const { data, error } = await supabase.from('program_group_members')
        .delete().eq('group_id', id).eq('client_id', clientId).select('client_id');
      if (error) { reportError('programGroups.removeMember', error, { id, clientId }); return false; }
      const gone = !!data && data.length > 0;
      if (gone) setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, memberIds: g.memberIds.filter((c) => c !== clientId) } : g)));
      return gone;
    } catch (e) { reportError('programGroups.removeMember', e, { id, clientId }); return false; }
  }, []);

  /** Which of the coach's groups a client is in. Used by the builder to say,
   *  before a coach edits one person's copy, that it is one person's copy. */
  const groupsForClient = useCallback((clientId: string): ProgramGroup[] =>
    groups.filter((g) => g.memberIds.includes(clientId)), [groups]);

  return useMemo(() => ({
    groups, status, refresh,
    createGroup, renameGroup, deleteGroup, setGroupProgram, addMembers, removeMember, groupsForClient,
  }), [groups, status, refresh, createGroup, renameGroup, deleteGroup, setGroupProgram, addMembers, removeMember, groupsForClient]);
}
