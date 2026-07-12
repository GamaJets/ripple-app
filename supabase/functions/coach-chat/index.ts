// Supabase Edge Function: coach-chat
// Repple's in-app AI coach. Knows the client's stats/goal/program (passed as
// context) and answers training + nutrition questions. Deploy:
//   supabase functions deploy coach-chat
// Uses the same ANTHROPIC_API_KEY secret you already set.
//
// Request JSON: { messages: [{role:'user'|'assistant', content:string}], context: object }
// Response JSON: { reply: string }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';

function systemPrompt(ctx: any): string {
  const c = ctx || {};
  return [
    "You are Repple's AI fitness coach — warm, direct, and practical. You give concise, actionable training and nutrition guidance.",
    'You know this client:',
    `- Name: ${c.name ?? 'the client'}`,
    `- Goal: ${c.goal ?? 'general fitness'}`,
    `- Current weight: ${c.weightKg ?? '?'} kg · body fat: ${c.bodyFatPct ?? '?'}% · skeletal muscle: ${c.muscleKg ?? '?'} kg`,
    `- Diet style: ${c.diet ?? 'unspecified'} · ${c.mealsPerDay ?? 4} meals/day`,
    `- Daily targets: ${c.kcal ?? '?'} kcal · P${c.protein ?? '?'} / C${c.carbs ?? '?'} / F${c.fat ?? '?'}`,
    `- Program: ${c.programTitle ?? 'their plan'}${c.programFocus ? ' — focus: ' + c.programFocus : ''}`,
    '',
    'Rules: keep replies short (2-4 sentences unless asked for detail). Be encouraging but honest. Use their real numbers. ',
    'Give practical next steps. You are not a doctor — for pain, injury, or medical questions, advise seeing a professional. Never invent data you were not given.',
  ].join('\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);

  let messages: any[] = [], context: any = {};
  try {
    const b = await req.json();
    messages = Array.isArray(b.messages) ? b.messages.slice(-12) : [];
    context = b.context || {};
  } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!messages.length) return json({ error: 'messages required' }, 400);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: systemPrompt(context),
        messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
      }),
    });
    if (!res.ok) return json({ error: 'Coach API error', detail: await res.text() }, 502);
    const data = await res.json();
    const reply = (data?.content?.[0]?.text) ?? "I couldn't come up with a reply — try again?";
    return json({ reply });
  } catch (e) {
    return json({ error: 'Coach failed', detail: String(e) }, 500);
  }
});
