// Supabase Edge Function: notify-message
// Fired by a database trigger (pg_net) whenever a row is inserted into `messages`.
// Resolves the recipient (a coach message → the client; a client message → their
// trainer), writes an in-app notification, and sends an Expo push. Runs with the
// service role internally; the DB trigger authenticates with a shared HOOK_SECRET.
// Deploy:  supabase functions deploy notify-message --use-api --no-verify-jwt
// Secret:  supabase secrets set HOOK_SECRET=<same value you put in the SQL trigger>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const HOOK = Deno.env.get('HOOK_SECRET') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!HOOK || String(b.secret || '') !== HOOK) return json({ error: 'forbidden' }, 403);

  const clientId = b.client_id as string | undefined;
  const sender = String(b.sender || '');
  const text = String(b.body || '').slice(0, 180);
  if (!clientId || !text) return json({ ok: true, skipped: 'missing fields' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let recipient: string | null = null;
  let title = 'New message';
  let route = '/(client)/messages';

  try {
    if (sender === 'coach') {
      // Coach → client: notify the client; title = the coach's name.
      recipient = clientId;
      route = '/(client)/messages';
      const { data: c } = await admin.from('clients').select('trainer_id').eq('id', clientId).maybeSingle();
      if (c?.trainer_id) {
        const { data: p } = await admin.from('profiles').select('full_name').eq('id', c.trainer_id).maybeSingle();
        title = p?.full_name || 'Your coach';
      } else { title = 'Your coach'; }
    } else {
      // Client → coach: notify the client's trainer; title = the client's name.
      route = '/(trainer)/messages';
      const { data: c } = await admin.from('clients').select('trainer_id').eq('id', clientId).maybeSingle();
      recipient = c?.trainer_id ?? null;
      const { data: p } = await admin.from('profiles').select('full_name').eq('id', clientId).maybeSingle();
      title = p?.full_name || 'Your client';
    }
  } catch { /* fall through */ }

  if (!recipient) return json({ ok: true, skipped: 'no recipient' });

  // In-app notification (backs the bell) — best-effort.
  try { await admin.from('notifications').insert({ user_id: recipient, icon: 'message', body: text }); } catch { /* ignore */ }

  // Expo push to the recipient's devices — best-effort.
  try {
    const { data: toks } = await admin.from('push_tokens').select('token').eq('user_id', recipient);
    const tokens: string[] = (toks ?? []).map((r: any) => r.token).filter(Boolean);
    if (tokens.length) {
      const msgs = tokens.map((to) => ({ to, title, body: text, sound: 'default', data: { route } }));
      for (let i = 0; i < msgs.length; i += 100) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(msgs.slice(i, i + 100)),
        });
      }
    }
  } catch { /* ignore */ }

  return json({ ok: true });
});
