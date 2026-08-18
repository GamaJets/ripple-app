// Coach ↔ client chat thread. The thread is keyed by the client's id
// (messages.client_id). Live via Supabase Realtime with optimistic send.
// Starts empty — a thread with no messages shows no messages.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { sendPush } from './pushNotifications';
import type { Message } from '../lib/types';

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const tid = useRef<string | null>(clientId);
  const seen = useRef<Set<string>>(new Set());
  const coachId = useRef<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) { setReady(true); return; }
    let cancelled = false;
    let channel: any = null;
    (async () => {
      let cid = clientId;
      if (!cid && role === 'client') {
        try { const { data: auth } = await supabase.auth.getUser(); cid = auth?.user?.id ?? null; } catch { /* ignore */ }
      }
      if (cancelled) return;
      tid.current = cid;
      if (!cid) { setReady(true); return; }
      if (role === 'client') { try { const { data: cr } = await supabase.from('clients').select('trainer_id').eq('id', cid).single(); coachId.current = (cr as any)?.trainer_id ?? null; } catch { /* ignore */ } }
      try {
        const { data, error } = await supabase.from('messages').select('*').eq('client_id', cid).order('created_at', { ascending: true });
        if (!cancelled && !error && data) {
          seen.current = new Set(data.map((r: any) => String(r.id)));
          if (data.length) setMessages(data.map(rowToMsg));
        }
      } catch { /* stay on mock */ }
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
      } catch { /* realtime optional */ }
    })();
    return () => { cancelled = true; if (channel) { try { supabase.removeChannel(channel); } catch { /* ignore */ } } };
  }, [clientId, role]);

  const send = async (body: string) => {
    const b = (body || '').trim();
    if (!b) return;
    const optimistic: Message = { id: 'local-' + Date.now(), clientId: tid.current ?? 'c1', sender: role, body: b, createdAt: new Date().toISOString() };
    setMessages((p) => [...p, optimistic]);
    if (USE_SUPABASE && tid.current) {
      try {
        const { data } = await supabase.from('messages').insert({ client_id: tid.current, sender: role, body: b }).select().single();
        if (data) { seen.current.add(String(data.id)); setMessages((p) => p.map((m) => (m.id === optimistic.id ? rowToMsg(data) : m))); }
        // notify the other side (coach -> client push; client side needs the coach id, skipped)
        if (role === 'coach' && tid.current) sendPush([tid.current], 'New message from your coach', b, { route: '/(client)/messages' });
        else if (role === 'client' && coachId.current) sendPush([coachId.current], 'New message from your client', b, { route: '/(trainer)/chat' });
      } catch { /* keep optimistic */ }
    }
  };

  return { messages, send, ready };
}
