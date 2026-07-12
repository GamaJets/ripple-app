// Supabase Edge Function: nutrition-parse
// Natural-language food logging: "chicken burrito and a coke" -> itemized macros.
// Uses the same ANTHROPIC_API_KEY secret. Deploy:
//   supabase functions deploy nutrition-parse
// Request JSON:  { text: string }
// Response JSON: { items: [{ name, kcal, protein, carbs, fat }] }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';

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
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);

  let text = '';
  try { text = String((await req.json()).text || '').slice(0, 500); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!text.trim()) return json({ error: 'text required' }, 400);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 500,
        messages: [{ role: 'user', content: PROMPT + '\n\nWhat they ate: ' + text }],
      }),
    });
    if (!res.ok) return json({ error: 'Parse API error', detail: await res.text() }, 502);
    const data = await res.json();
    const out = extractJson((data?.content?.[0]?.text) ?? '');
    return json({ items: Array.isArray(out.items) ? out.items : [] });
  } catch (e) {
    return json({ error: 'Parse failed', detail: String(e) }, 500);
  }
});
