// Coach ↔ client chat thread. The thread is keyed by the client's id
// (messages.client_id). Live via Supabase Realtime with optimistic send.
// Starts empty — a thread with no messages shows no messages.
//
// ── Two silences this hook used to keep ────────────────────────────────────
//
// Reading: `ready` flipped to true whether the select succeeded or was refused,
// and on failure `messages` stayed `[]`. The chat screen showed its empty state
// — "No messages yet. Say hello." — to a client whose coach had written to them
// that morning. `ready` still means exactly what it meant (the initial load has
// settled, stop showing a spinner) because screens branch on it; `status` is the
// new thing, and it says whether the empty thread is a fact or a failure.
//
// Sending: the insert's `error` was never read, and the catch kept the
// optimistic bubble. So a message the server refused — an expired session, a
// client messaging a coach they are no longer linked to, no signal at all — sat
// in the thread looking exactly like a delivered one. The sender believed their
// coach had it. `send` now resolves false when the row did not land, and the ids
// of those bubbles are listed in `unsent` so the thread can mark them.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { sendPush } from './pushNotifications';
import { useAuthRevision } from './authRevision';
import type { Message } from '../lib/types';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { resolvePeerName, type PeerName } from '../lib/threadPeer';

export type ChatRole = 'client' | 'coach';

const rowToMsg = (r: any): Message => ({
  id: String(r.id), clientId: r.client_id, sender: r.sender, body: r.body, createdAt: r.created_at,
});

/**
 * Chat thread hook.
 * @param clientId thread key (the client's profile id). Pass null for the
 *        signed-in client's own thread (resolved from auth).
 * @param role who I am in this thread ('client' | 'coach').
 */
export function useThread(clientId: string | null, role: ChatRole) {
  const authRev = useAuthRevision();
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [unsent, setUnsent] = useState<string[]>([]);
  const tid = useRef<string | null>(clientId);
  const seen = useRef<Set<string>>(new Set());
  const coachId = useRef<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) { setReady(true); setStatus('ready'); return; }
    let cancelled = false;
    let channel: any = null;
    (async () => {
      let cid = clientId;
      if (!cid && role === 'client') {
        try {
          const { data: sess } = await supabase.auth.getSession();
          if (cancelled) return;
          if (!sess?.session) { setStatus('ready'); setReady(true); return; }
          const { data: auth, error: authErr } = await supabase.auth.getUser();
          // Not knowing who you are is a failure, not an empty thread.
          if (authErr) { if (!cancelled) { setStatus('error'); setReady(true); } return; }
          cid = auth?.user?.id ?? null;
        } catch { if (!cancelled) { setStatus('error'); setReady(true); } return; }
      }
      if (cancelled) return;
      tid.current = cid;
      // No thread key at all: there is nothing to read, and nothing was hidden.
      if (!cid) { setReady(true); setStatus('ready'); return; }
      if (role === 'client') {
        // Only used to address the push notification back to the coach. Failing
        // it costs a notification, not the thread, so it stays swallowed — but
        // deliberately, and only here.
        // no-error-ok: a tie-break for which coach to show; absent behaves the same as having no coach
      try { const { data: cr } = await supabase.from('clients').select('trainer_id').eq('id', cid).single(); coachId.current = (cr as any)?.trainer_id ?? null; } catch { /* push addressing only */ }
      }
      try {
        // Newest-first on the wire, oldest-first in the state. A thread is the
        // one read here where the ascending page is unambiguously the wrong
        // half: a coach and client who have exchanged a thousand messages open
        // the screen to say something now, and the ascending cap would have
        // shown them the conversation they had when they met and silently
        // dropped everything since — including the message that just arrived.
        const { data, error } = await supabase.from('messages').select('*')
          .eq('client_id', cid).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        if (error) { setStatus('error'); }
        else {
          const page = capped(data);
          const rows = page.rows.slice().reverse();
          // `seen` guards the realtime subscription against re-appending a
          // message already on screen. It is keyed on what we HOLD, so it is
          // built from the trimmed page — seeding it with the probe row would
          // have made the realtime handler drop a message we never rendered.
          seen.current = new Set(rows.map((r: any) => String(r.id)));
          if (rows.length) setMessages(rows.map(rowToMsg));
          setStatus(page.truncated ? 'partial' : 'ready');
        }
      } catch { if (!cancelled) setStatus('error'); }
      if (!cancelled) setReady(true);
      try {
        channel = supabase
          .channel('msg:' + cid)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'client_id=eq.' + cid }, (payload: any) => {
            const m = rowToMsg(payload.new);
            if (seen.current.has(m.id)) return;
            seen.current.add(m.id);
            setMessages((p) => [...p, m]);
          })
          .subscribe();
      } catch { /* realtime optional: the thread is already loaded, this only adds live updates */ }
    })();
    return () => { cancelled = true; if (channel) { try { supabase.removeChannel(channel); } catch { /* ignore */ } } };
  }, [clientId, role, authRev]);

  /**
   * Send a message.
   *
   * Resolves true only once the row is on the server and the other side can
   * read it. False means the bubble on screen is local: its id is added to
   * `unsent`, and the caller must not let it read as delivered.
   *
   * Note this is false in a no-backend build too, unlike `status`, which is
   * 'ready' there. A local-only read is a complete answer — there is nothing
   * else to know — but a local-only SEND is not a delivery: this thread has no
   * persistence of its own, so the message reaches nobody and does not survive
   * the session.
   */
  const send = async (body: string): Promise<boolean> => {
    const b = (body || '').trim();
    if (!b) return false;
    const optimistic: Message = { id: 'local-' + Date.now(), clientId: tid.current ?? 'c1', sender: role, body: b, createdAt: new Date().toISOString() };
    setMessages((p) => [...p, optimistic]);
    if (!USE_SUPABASE || !tid.current) { setUnsent((p) => [...p, optimistic.id]); return false; }
    try {
      const { data, error } = await supabase.from('messages').insert({ client_id: tid.current, sender: role, body: b }).select().single();
      if (error || !data) { setUnsent((p) => [...p, optimistic.id]); return false; }
      seen.current.add(String(data.id));
      setMessages((p) => p.map((m) => (m.id === optimistic.id ? rowToMsg(data) : m)));
      // notify the other side (coach -> client push; client side needs the coach id, skipped)
      if (role === 'coach' && tid.current) sendPush([tid.current], 'New message from your coach', b, { route: '/(client)/messages' });
      // The coach's route carries the thread key. It used to be the bare
      // '/(trainer)/chat', and the tap handler pushes that string straight at
      // the router — so a coach who opened the notification landed on a chat
      // with no clientId: an empty thread headed "Client", and a reply that went
      // nowhere because `send` has no thread to insert into. The client's route
      // needs no key; their thread is their own id, resolved from auth.
      else if (role === 'client' && coachId.current && tid.current) sendPush([coachId.current], 'New message from your client', b, { route: '/(trainer)/chat?clientId=' + encodeURIComponent(tid.current) });
      return true;
    } catch {
      setUnsent((p) => [...p, optimistic.id]);
      return false;
    }
  };

  return { messages, send, ready, status, unsent };
}

/**
 * Who the thread is with — for the header, and for nothing else.
 *
 * ── TF-32 ────────────────────────────────────────────────────────────────
 *
 * The client's Messages screen headed the thread from `useCoachProfile()`,
 * which is the coach-side provider: it reads `auth.getUser()` and loads THAT
 * user's own `profiles.full_name`. Signed in as a client, that is the client —
 * so the thread with your coach was labelled with your own name. The messages
 * themselves were never misrouted (the thread is `messages.client_id` and RLS
 * decides who reads it), but a header naming the reader is worse than one
 * naming nobody, because it is a name they recognise.
 *
 * This hook only ever reports a name that came back from a read for the OTHER
 * party's id. When there is none the caller gets 'withheld' and draws a dash
 * with the reason. See src/lib/threadPeer.ts.
 *
 * ── Why the client side goes through an RPC ──────────────────────────────
 *
 * There is still no policy on `profiles` that runs client → coach, and there
 * should not be: one wide enough to let a client read their coach's row would
 * expose the whole row, and writing it as a subquery over `clients` is the
 * recursion 28-fix-profiles-recursion.sql exists to undo. So a client read of
 * `profiles` for their coach's id returns nothing, and this hook used to render
 * a labelled dash for almost every client — honest, and a poor experience in an
 * app whose premise is that somebody is coaching you.
 *
 * `public.my_coach()` (supabase/parts/67) is a security-definer function that
 * takes no arguments and returns one column for one person. Having no parameter
 * is what makes it safe: there is nothing to probe, and it can only ever answer
 * about the coach of whoever is calling it.
 *
 * @param role who I am in this thread.
 * @param clientId the thread key when I am the coach; ignored for a client,
 *        whose coach comes from my_coach().
 */
export function useThreadPeerName(role: ChatRole, clientId: string | null): PeerName {
  const authRev = useAuthRevision();
  const [peer, setPeer] = useState<PeerName>(() =>
    // With no backend there is no coaching link to read and never will be, so
    // this is settled at 'unlinked' rather than spinning on 'loading' forever.
    USE_SUPABASE ? { kind: 'loading' } : { kind: 'unlinked' });

  useEffect(() => {
    if (!USE_SUPABASE) { setPeer({ kind: 'unlinked' }); return; }
    let cancelled = false;
    (async () => {
      let peerId: string | null = null;
      let linkFailed = false;
      let name: string | null = null;

      if (role === 'coach') {
        // The coach's peer is handed in by the roster, so there is no link to
        // look up; an absent clientId is a thread with nobody in it.
        peerId = clientId;
      } else {
        try {
          // One call for the link AND the name. The function requires BOTH
          // halves of the coach↔client link to be present and active, the same
          // test fetchMyCoach uses before it will name somebody as able to see
          // your photographs — so "who is my coach" has one answer across the
          // app rather than a stricter one for photos and a looser one here.
          const { data, error } = await supabase.rpc('my_coach');
          if (cancelled) return;
          // A refused or failed RPC is not "you have no coach". No rows is.
          if (error) linkFailed = true;
          else {
            // RETURNS TABLE, so supabase-js hands back an array.
            const row: any = Array.isArray(data) ? data[0] : data;
            peerId = row?.coach_id ?? null;
            // Null here means a coach who has not set a name, which is a
            // different answer from a name we could not read — resolvePeerName
            // reports the first as 'withheld' only because peerId is present.
            name = typeof row?.coach_name === 'string' && row.coach_name ? row.coach_name : null;
          }
        } catch { if (!cancelled) { setPeer({ kind: 'unknown' }); } return; }
      }

      // Coach side only. A client's name arrives with the link above, and
      // reading `profiles` for a coach's id from a client session is refused by
      // design — asking anyway would cost a round trip to be told no.
      if (!cancelled && role === 'coach' && peerId && !linkFailed) {
        try {
          // no-error-ok: refused and empty both render as the same labelled dash
          const { data } = await supabase.from('profiles').select('full_name').eq('id', peerId).single();
          if (cancelled) return;
          name = typeof (data as any)?.full_name === 'string' ? (data as any).full_name : null;
        } catch { /* leaves the name unread, which the resolver reports as withheld */ }
      }

      // A coach's manually-added client has no profile row — the only record of
      // their name is the one the coach typed on the roster, which is that
      // client's name and nobody else's, so it is a legitimate second look.
      if (!cancelled && role === 'coach' && peerId && !name) {
        try {
          // no-error-ok: same as above — a name that does not come back leaves
          // the header a labelled dash, which is the honest rendering of it.
          const { data } = await supabase.from('coach_clients').select('name').eq('id', peerId).single();
          if (cancelled) return;
          name = typeof (data as any)?.name === 'string' ? (data as any).name : null;
        } catch { /* as above */ }
      }

      if (!cancelled) setPeer(resolvePeerName({ settled: true, linkFailed, peerId, name }));
    })();
    return () => { cancelled = true; };
  }, [role, clientId, authRev]);

  return peer;
}
