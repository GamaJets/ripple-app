// Supabase Edge Function: send-push
// Delivers an Expo push notification to one or more users. Reads their tokens
// from push_tokens (service role, bypassing RLS) and posts to Expo's push API.
// Deploy: supabase functions deploy send-push
// Request JSON: { user_ids: string[], title: string, body: string, data?: object }
// Response JSON: { sent: number }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let user_ids: string[] = [], title = '', body = '', data: Record<string, unknown> = {};
  try {
    const b = await req.json();
    user_ids = Array.isArray(b.user_ids) ? b.user_ids : [];
    title = String(b.title || 'Repple');
    body = String(b.body || '');
    data = b.data || {};
  } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!user_ids.length) return json({ error: 'user_ids required' }, 400);

  try {
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: rows } = await supa.from('push_tokens').select('token').in('user_id', user_ids);
    const tokens: string[] = (rows ?? []).map((r: any) => r.token).filter(Boolean);
    if (!tokens.length) return json({ sent: 0 });
    const messages = tokens.map((to) => ({ to, title, body, sound: 'default', data }));
    // Expo accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    }
    return json({ sent: tokens.length });
  } catch (e) {
    return json({ error: 'send failed', detail: String(e) }, 500);
  }
});
