// wearable-oauth — exchanges a vendor OAuth *code* for tokens using the vendor
// client secret (server-side only) and stores the refresh token per user.
// Secrets are Supabase env: <VENDOR>_CLIENT_ID / <VENDOR>_CLIENT_SECRET.
// Request: { provider, code, code_verifier?, redirect_uri }
// The caller is identified by the JWT and by nothing else. `user_id` is still
// sent by the app and is deliberately ignored — see the block that reads it.
//
// Auth-method note: vendors differ on how the client credentials must be sent.
// WHOOP (Ory Hydra) is registered for `client_secret_post` and REJECTS a request
// that also carries an Authorization: Basic header ("Client Authentication
// failed"). So we try post-body first, then fall back to Basic, and we surface
// the vendor's real error text instead of a generic message.
import { createClient } from 'jsr:@supabase/supabase-js@2';
// A leaf module with no relative imports of its own, so Deno can resolve it.
// It is the repo's written-down answer to "did the auth server refuse this
// credential, or did it not answer at all?" — see the block that calls it.
import { authReadFate } from '../../../src/lib/authReadFate.ts';

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

  // ── Who is asking, from their JWT ALONE ──────────────────────────────────
  //
  // This used to be `let userId = String(body.user_id || '')` with the JWT only
  // OVERWRITING it, and the catch below was commented "fall back to
  // body.user_id". That is not a fallback, it is the authorisation.
  //
  // supabase-js `auth.getUser()` does not throw on a token it cannot resolve —
  // it RESOLVES with `{ data: { user: null }, error }`. So the catch was almost
  // never the path taken. The path taken was: no user came back, `userId` kept
  // whatever the request body said, and the row below was written for that id.
  // The project's anon key is a valid JWT that resolves to no user and is
  // public by design (it is in the app bundle), so anybody holding it could
  // POST `{ provider, code, user_id: <somebody else's uuid> }` and:
  //
  //   · upsert `wearable_tokens` on (user_id, provider), REPLACING that
  //     person's real WHOOP / Oura / Fitbit credential — their recovery,
  //     sleep and heart-rate readings stop, with nothing on any screen to say
  //     why; and
  //   · leave their own vendor tokens sitting under the victim's id, so
  //     wearable-day then serves the attacker's body data to the victim's
  //     coach as the victim's.
  //
  // Every other function in this directory says the rule in as many words —
  // ads-oauth, ads-sync, ads-google, ads-tiktok, calendar-sync and
  // instagram-publish all carry "never from the body". This one had the
  // sentence in its header and the opposite in its code. `body.user_id` is now
  // read nowhere; the app still sends it (src/lib/wearables/oauth.ts) and it is
  // simply ignored, so no caller has to change for this to be safe.
  const authHeader = req.headers.get('Authorization') || '';
  const supaUrl = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // ── and the error from that read is not the same as "nobody" ─────────────
  //
  // The block above is about WHOSE id is used. This one is about what happens
  // when the id cannot be fetched at all, which used to be the same thing:
  //
  //     const { data } = await service.auth.getUser(jwt);
  //     userId = data?.user?.id || '';
  //     …
  //     if (!userId) return fail('Not signed in — sign in to Repple and try connecting again.');
  //
  // `getUser()` RESOLVES rather than rejects for any AuthError, and auth-js
  // brands offline, DNS, CORS, an abort and every 5xx as `AuthRetryableFetchError`
  // — an AuthError. So during a GoTrue blip `data.user` is null with `error`
  // set, the error was thrown away, and a SIGNED-IN member was told they were
  // signed out — on the one screen where they are trying to connect a watch,
  // with a remedy (sign in again) that cannot help, in front of an OAuth `code`
  // that is single-use and will be dead by the time they get back.
  //
  // The two cases are separable and src/lib/authReadFate.ts is where the
  // separation is written down and tested, so this reads `error` and asks it:
  //
  //   · 'signed-out'  — GoTrue looked at the credential and refused it, or
  //     there was none. "Sign in and try again" is the true next step.
  //   · 'unreadable'  — the question could not be asked. Nothing was
  //     established, least of all that they are signed out. Say so, say the
  //     connection was not made, and send them back to the same button.
  //
  // The `catch` is the non-AuthError path — the only thing `getUser` actually
  // throws — and it establishes nothing either, so it answers the same way.
  // It used to fall through to the refusal, which was the same false sentence.
  const CANNOT_ASK = 'Repple could not check who you are just now — that is our end, not yours. '
    + 'Nothing has been connected and your existing devices are untouched. Try connecting again in a moment.';
  let userId = '';
  try {
    const jwt = authHeader.replace('Bearer ', '');
    const { data, error: authErr } = await service.auth.getUser(jwt);
    if (authErr) {
      if (authReadFate(authErr) === 'unreadable') return fail(CANNOT_ASK);
    } else {
      userId = data?.user?.id || '';
    }
  } catch { return fail(CANNOT_ASK); }
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
