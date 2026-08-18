// wearable-oauth — exchanges a vendor OAuth *code* for tokens using the vendor
// client secret (server-side only) and stores the refresh token per user.
// Secrets are Supabase env: <VENDOR>_CLIENT_ID / <VENDOR>_CLIENT_SECRET.
// Request: { provider, code, code_verifier?, redirect_uri, user_id }
//
// Auth-method note: vendors differ on how the client credentials must be sent.
// WHOOP (Ory Hydra) is registered for `client_secret_post` and REJECTS a request
// that also carries an Authorization: Basic header ("Client Authentication
// failed"). So we try post-body first, then fall back to Basic, and we surface
// the vendor's real error text instead of a generic message.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
// Failures are returned as HTTP 200 with an `error` field so supabase-js surfaces
// the message to the client (a non-2xx makes `data` null and the reason is lost).
const fail = (msg: string) => json({ error: msg });

const TOKEN_URL: Record<string, string> = {
  fitbit: 'https://api.fitbit.com/oauth2/token',
  oura: 'https://api.ouraring.com/oauth/token',
  whoop: 'https://api.prod.whoop.com/oauth/oauth2/token',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return fail('bad json'); }
  const provider = String(body.provider || '');
  const code = String(body.code || '');
  const tokenUrl = TOKEN_URL[provider];
  if (!tokenUrl || !code) return fail('unsupported provider or missing code');

  const clientId = Deno.env.get(`${provider.toUpperCase()}_CLIENT_ID`) || '';
  const clientSecret = Deno.env.get(`${provider.toUpperCase()}_CLIENT_SECRET`) || '';
  if (!clientId || !clientSecret) return fail(`Set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET as Supabase secrets.`);

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
  if (!userId) return fail('Not signed in — sign in to Repple and try connecting again.');

  const redirectUri = String(body.redirect_uri || '');
  const verifier = body.code_verifier ? String(body.code_verifier) : '';

  const baseForm = () => {
    const f = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
    });
    if (verifier) f.set('code_verifier', verifier);
    return f;
  };

  // Attempt 1: client_secret_post (secret in body, no Basic header).
  // Attempt 2: client_secret_basic (Basic header, no secret in body).
  const attempts: Array<{ label: string; headers: Record<string, string>; form: URLSearchParams }> = [];

  const postForm = baseForm();
  postForm.set('client_secret', clientSecret);
  attempts.push({
    label: 'client_secret_post',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    form: postForm,
  });

  attempts.push({
    label: 'client_secret_basic',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    form: baseForm(),
  });

  let tok: any = null;
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const res = await fetch(tokenUrl, { method: 'POST', headers: attempt.headers, body: attempt.form.toString() });
      const text = await res.text();
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { parsed = { error: text.slice(0, 300) }; }

      if (res.ok && parsed.access_token) { tok = parsed; break; }

      const detail = parsed.error_description || parsed.error || `HTTP ${res.status}`;
      errors.push(`${attempt.label}: ${detail}`);

      // An invalid/expired/already-used code will not be fixed by retrying with a
      // different client-auth method — stop and report it plainly.
      if (String(parsed.error || '') === 'invalid_grant') break;
    } catch (_e) {
      errors.push(`${attempt.label}: token endpoint unreachable`);
    }
  }

  if (!tok) {
    const combined = errors.join(' | ') || 'token exchange failed';
    if (combined.includes('invalid_grant')) {
      return fail(`WHOOP rejected the sign-in code (${combined}). Tap Connect again to start a fresh sign-in.`);
    }
    return fail(`Token exchange failed — ${combined}`);
  }

  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString();
  const { error } = await service.from('wearable_tokens').upsert({
    user_id: userId, provider,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });
  if (error) return fail(`Connected to ${provider}, but could not save the token: ${error.message}`);

  return json({ ok: true, provider });
});
