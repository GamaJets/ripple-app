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
        const { data, error } = await supabase.from('messages').select('*').eq('client_id', cid).order('created_at', { ascending: true });
        if (cancelled) return;
        if (error) { setStatus('error'); }
        else {
          seen.current = new Set((data ?? []).map((r: any) => String(r.id)));
          if (data && data.length) setMessages(data.map(rowToMsg));
          setStatus('ready');
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
      else if (role === 'client' && coachId.current) sendPush([coachId.current], 'New message from your client', b, { route: '/(trainer)/chat' });
      return true;
    } catch {
      setUnsent((p) => [...p, optimistic.id]);
      return false;
    }
  };

  return { messages, send, ready, status, unsent };
}
