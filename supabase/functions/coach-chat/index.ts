// Supabase Edge Function: coach-chat
// Repple's in-app AI coach. Knows the client's stats/goal/program (passed as
// context) and answers training + nutrition questions. Deploy:
//   supabase functions deploy coach-chat
// Uses the same ANTHROPIC_API_KEY secret you already set.
//
// Request JSON: { messages: [{role:'user'|'assistant', content:string}], context: object }
// Response JSON: { reply: string }
//
// ── WHO MAY SPEND THE ANTHROPIC KEY ───────────────────────────────────────
//
// A signed-in person, and nobody else. This function used to check nothing at
// all, and `verify_jwt` at the platform gate is not the check people assume it
// is: it verifies that the bearer token was signed by this project, and the
// project's ANON KEY is exactly such a token. It is public by design — it is
// inlined into the app bundle — so "verified by Supabase" and "a Repple user"
// were two different sentences, and only the first was true here.
//
// supabase/functions/wearable-oauth spells the same fact out at length, and
// supabase/functions/ocr-scan already refuses on it in one line ("Signed in
// users only — this spends a metered quota"). This is that line. What it costs
// an attacker to skip it was: unpack the app, take the anon key, and POST
// arbitrary `messages` with an arbitrary `system` context to Repple's Anthropic
// account, for as long as they like, on Repple's bill — a general-purpose
// Claude proxy with no account, no rate limit and nothing in this database
// naming who did it.
//
// It is deliberately only IDENTITY. The health context in the body is not read
// from the database and never has been: the caller sends their own numbers, so
// there is no other person's record for a server-side check to protect here.
// What the check protects is the KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
    // The app has always known whether anybody is coaching this person and how,
    // and never sent it. So the same "ask your coach to watch your setup" went
    // to a client training alone at 6am and to one whose trainer is in the room
    // with them — advice that is either impossible or redundant. The client
    // sends a phrase, not a code, so this line needs no vocabulary of its own.
    `- How they are coached: ${c.coaching ?? 'unknown'}`,
    `- Readiness today: ${c.readiness ?? 'unknown'}`,
    `- Eaten so far today: ${c.eatenToday ?? 'not logged yet'}`,
    `- Training streak: ${c.streak ?? '?'} days${c.lastTrained ? ' · last trained ' + c.lastTrained : ''}`,
    `- Suggested next progression: ${c.nextLift ?? 'n/a'}`,
    `- Injuries / limitations: ${c.injuries ?? 'none disclosed'}`,
    `- Focus areas to emphasise (from progress photo): ${c.focusAreas ?? 'none set'}`,
    '',
    'Rules: keep replies short (2-4 sentences unless asked for detail). Be encouraging but honest. Use their real numbers. ',
    'When relevant, factor in their readiness, what they have eaten today, and their streak — e.g. suggest a lighter session if under-recovered, or a protein-focused meal if they are behind on protein. ' +
    'Match your advice to how they are coached: never tell a client training alone to ask their coach, or to book a session they have no coach to book with; for a client coached in person, defer form checks and loading decisions to the session they already have; for a hybrid client, say which of the two a suggestion belongs to. ' +
    'If the client has disclosed injuries or limitations, ALWAYS train around them: avoid or regress exercises that load the injured area, suggest pain-free alternatives, and never program through pain. ' +
    'Give practical next steps. You are not a doctor — for pain, injury, or medical questions, advise seeing a professional. Never invent data you were not given.',
  ].join('\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);

  // Signed-in users only — this spends a metered quota on Repple's account.
  // `getUser` RESOLVES with a null user for a token it cannot turn into a
  // person (it does not throw), which is what the anon key does, so the answer
  // is checked rather than the call being wrapped and forgotten.
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let userId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    userId = data?.user?.id || '';
  } catch { /* stays empty, and the refusal below is the answer */ }
  if (!userId) return json({ error: 'Sign in to Repple to use the AI coach.' }, 401);

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
