// ocr-scan — reads an InBody sheet through OCR.space with a SERVER-SIDE key.
//
// The app used to call api.ocr.space directly with EXPO_PUBLIC_OCR_API_KEY. Two
// problems with that:
//   1. The EXPO_PUBLIC_ prefix inlines the value into the JavaScript bundle at
//      build time, so the key shipped readable to anyone who unpacked the app —
//      and unlike the WHOOP secret, this one really was read by the client.
//   2. The value was never set. It fell back to the literal 'helloworld', which
//      is OCR.space's shared public demo key: globally rate-limited to a handful
//      of requests, so scanning failed constantly and unpredictably.
//
// The key now lives only as the Supabase secret OCR_API_KEY. The client posts a
// base64 image and gets back the parsed text; nothing about the key reaches the
// device. Parsing the text into weight / body-fat / muscle stays in the app,
// where the InBody-specific rules already live.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// OCR.space caps a base64 upload at 1MB on the free tier. The app already
// downscales before sending; this is the backstop so a large image comes back as
// a clear message instead of a vendor error the user can't act on.
const MAX_B64 = 1_400_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Signed-in users only — this spends a metered quota.
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let userId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    userId = data?.user?.id || '';
  } catch { /* ignore */ }
  if (!userId) return json({ ok: false, error: 'Sign in to scan a body-composition sheet.' }, 401);

  const key = Deno.env.get('OCR_API_KEY') || '';
  if (!key || key === 'helloworld') {
    // Say so plainly rather than silently falling back to the demo key and
    // producing scans that fail at random.
    return json({ ok: false, error: 'Scanning is not configured yet — no OCR key is set on the server.' });
  }

  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  const b64 = String(body.imageBase64 || '');
  if (!b64) return json({ ok: false, error: 'No image was received.' });
  if (b64.length > MAX_B64) return json({ ok: false, error: 'That photo is too large — try again a little further back.' });

  try {
    const form = new URLSearchParams();
    form.set('apikey', key);
    form.set('OCREngine', '2');
    form.set('scale', 'true');
    form.set('base64Image', b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`);

    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const out: any = await res.json();

    // OCR.space reports failure in the body, not the status code.
    if (out?.IsErroredOnProcessing) {
      const detail = Array.isArray(out?.ErrorMessage) ? out.ErrorMessage.join(' ') : String(out?.ErrorMessage || '');
      return json({ ok: false, error: detail || 'The scanning service could not read that image.' });
    }
    const text: string = out?.ParsedResults?.[0]?.ParsedText || '';
    if (!text.trim()) return json({ ok: false, error: 'No text could be read from that photo.' });
    return json({ ok: true, text });
  } catch (_e) {
    return json({ ok: false, error: 'Could not reach the scanning service.' });
  }
});
