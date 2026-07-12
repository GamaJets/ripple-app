// wearable-oauth — exchanges a vendor OAuth *code* for tokens using the vendor
// client secret (server-side only) and stores the refresh token per user.
// Secrets are Supabase env: <VENDOR>_CLIENT_ID / <VENDOR>_CLIENT_SECRET.
// Request: { provider, code, code_verifier?, redirect_uri, user_id }
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const TOKEN_URL: Record<string, string> = {
  fitbit: 'https://api.fitbit.com/oauth2/token',
  oura: 'https://api.ouraring.com/oauth/token',
  whoop: 'https://api.prod.whoop.com/oauth/oauth2/token',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const provider = String(body.provider || '');
  const code = String(body.code || '');
  const tokenUrl = TOKEN_URL[provider];
  if (!tokenUrl || !code) return json({ error: 'unsupported provider or missing code' }, 400);

  const clientId = Deno.env.get(`${provider.toUpperCase()}_CLIENT_ID`) || '';
  const clientSecret = Deno.env.get(`${provider.toUpperCase()}_CLIENT_SECRET`) || '';
  if (!clientId || !clientSecret) return json({ error: `Set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET as Supabase secrets.` }, 400);

  // Identify the caller from their JWT.
  const authHeader = req.headers.get('Authorization') || '';
  const supaUrl = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let userId = String(body.user_id || '');
  try {
    const jwt = authHeader.replace('Bearer ', '');
    const { data } = await service.auth.getUser(jwt);
    if (data?.user?.id) userId = data.user.id;
  } catch { /* fall back to body.user_id */ }
  if (!userId) return json({ error: 'no user' }, 401);

  // Exchange the code for tokens.
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: String(body.redirect_uri || ''),
    client_id: clientId,
  });
  if (body.code_verifier) form.set('code_verifier', String(body.code_verifier));
  // Fitbit & WHOOP expect HTTP Basic auth with client_id:secret; Oura accepts body.
  const basic = 'Basic ' + btoa(`${clientId}:${clientSecret}`);
  if (!body.code_verifier) form.set('client_secret', clientSecret);

  let tok: any;
  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic },
      body: form.toString(),
    });
    tok = await res.json();
    if (!res.ok || !tok.access_token) return json({ error: tok.error_description || tok.error || 'token exchange failed' }, 400);
  } catch (e) {
    return json({ error: 'token endpoint unreachable' }, 502);
  }

  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString();
  const { error } = await service.from('wearable_tokens').upsert({
    user_id: userId, provider,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });
  if (error) return json({ error: 'could not store token' }, 500);

  return json({ ok: true, provider });
});
