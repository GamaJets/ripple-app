// Supabase Edge Function: nutrition-parse
// Natural-language food logging: "chicken burrito and a coke" -> itemized macros.
// Uses the same ANTHROPIC_API_KEY secret — or the Cheaper Inference gateway
// when CHEAPER_INFERENCE_API_KEY is set. See src/lib/llmGateway.ts. Deploy:
//   supabase functions deploy nutrition-parse
// Request JSON:  { text: string }
// Response JSON: { items: [{ name, kcal, protein, carbs, fat }] }
//
// Signed-in users only, for the reason written out at length in
// supabase/functions/coach-chat: `verify_jwt` proves the bearer token was
// signed by this project, and the public anon key is such a token. Without the
// check below, anybody who unpacked the app could spend Repple's Anthropic
// quota through this endpoint with no account at all.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { providerFor, modelFor, buildCall, readReply, replyProblem } from '../../../src/lib/llmGateway.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const PROMPT =
  'You are a nutrition estimator. The user describes what they ate in plain language. ' +
  'Split it into individual food items and estimate the nutrition for a typical portion of each. ' +
  'Respond with ONLY valid JSON, no prose: {"items":[{"name":string,"kcal":number,"protein":number,"carbs":number,"fat":number}]}. ' +
  'protein/carbs/fat are grams. If a quantity is given, scale to it. Keep names short.';

function extractJson(text: string): any {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('No JSON in model response');
  return JSON.parse(text.slice(a, b + 1));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  // Which provider, and on whose key. See the header.
  const gatewayKey = Deno.env.get('CHEAPER_INFERENCE_API_KEY');
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const provider = providerFor(gatewayKey, anthropicKey);
  if (!provider) return json({ error: 'No AI provider is configured on the server.' }, 500);
  const key = (provider === 'cheaper-inference' ? gatewayKey : anthropicKey) as string;

  // Signed-in users only — this spends a metered quota. See the header.
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let userId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    userId = data?.user?.id || '';
  } catch { /* stays empty, and the refusal below is the answer */ }
  if (!userId) return json({ error: 'Sign in to Repple to log food this way.' }, 401);

  let text = '';
  try { text = String((await req.json()).text || '').slice(0, 500); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!text.trim()) return json({ error: 'text required' }, 400);

  try {
    const call = buildCall(provider, key, {
      messages: [{ role: 'user', content: PROMPT + '\n\nWhat they ate: ' + text }],
      maxTokens: 500,
      model: modelFor(provider, 'text', Deno.env.get(
        provider === 'cheaper-inference' ? 'CHEAPER_INFERENCE_MODEL' : 'ANTHROPIC_MODEL')),
    });
    const res = await fetch(call.url, { method: 'POST', headers: call.headers, body: call.body });
    if (!res.ok) return json({ error: 'Parse API error', detail: await res.text() }, 502);

    // A truncation is said out loud rather than being handed to `extractJson`,
    // which would throw on a half-written object — or, worse, parse a SHORTER
    // one and silently log a meal missing its last item.
    const reply = readReply(provider, await res.json());
    if (!reply.ok) return json({ error: replyProblem(reply.why) }, 502);
    const out = extractJson(reply.text);
    return json({ items: Array.isArray(out.items) ? out.items : [] });
  } catch (e) {
    return json({ error: 'Parse failed', detail: String(e) }, 500);
  }
});
