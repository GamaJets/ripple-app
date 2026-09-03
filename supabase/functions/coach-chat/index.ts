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

  // ── say what you were given, and nothing about what you were not ─────────
  //
  // This function serves FOUR different asks and used to be written for one:
  //
  //   a member about themselves        → FITNESS_KEYS
  //   the same, having consented       → + HEALTH_KEYS
  //   a coach about one client         → COACH_CLIENT_KEYS
  //   a coach about their own business → COACH_BUSINESS_KEYS
  //
  // The two coach vocabularies were dropped on the floor by the one component
  // that had already been handed them. Asked "how is my month going?", the
  // assistant answered — correctly, under its own "never invent data" rule —
  // that it had not been given any figures, while every one of them sat in the
  // request body.
  //
  // And the half that is a safety defect: COACH_CLIENT_KEYS carries
  // `injuryAreas`, the REDACTED injury — area and severity, never the note.
  // src/lib/coachShare.ts argues that it belongs in the fitness tier precisely
  // because "a coach asking 'what should they train next' and getting an answer
  // that loads an injured knee is the failure this whole feature would be
  // judged on". This prompt read `c.injuries`, which is on the list documented
  // as NEVER sent on a coach ask — so the model was told "none disclosed",
  // under the rule below telling it to always train around them, about a client
  // whose injured knee the app had just described to it under another name.
  //
  // So: a line is emitted only when its field arrived. That serves all four
  // shapes without the function having to know which it got, and it means a
  // fallback can never quietly assert something — "none disclosed" is now said
  // only when somebody actually said it, and a field nobody sent is simply
  // absent, which is what "never invent data you were not given" needs to be
  // true of the prompt as well as of the reply.
  //
  // No name: src/lib/coachShare.ts removed it deliberately and no filter sends
  // one. This used to print "Name: the client" on every request in the product.
  const has = (v: unknown) => v !== undefined && v !== null && v !== '';
  const lines: string[] = [];
  const say = (label: string, v: unknown, suffix = '') => { if (has(v)) lines.push(`- ${label}: ${v}${suffix}`); };

  // What the person is working towards, and how they are coached. `coaching` is
  // the member's phrase; `coachedMode` is the coach-side field for the same
  // fact, and both are read because both are sent, by different callers.
  say('Goal', c.goal);
  say('How they are coached', has(c.coaching) ? c.coaching : c.coachedMode);
  say('Diet style', c.diet);
  say('Meals a day', c.mealsPerDay);
  say('Daily targets', has(c.kcal) ? `${c.kcal} kcal · P${c.protein ?? '?'} / C${c.carbs ?? '?'} / F${c.fat ?? '?'}` : null);
  say('Eaten so far today', c.eatenToday);
  say('Program', has(c.programTitle) ? `${c.programTitle}${c.programFocus ? ' — focus: ' + c.programFocus : ''}` : null);
  say('Suggested next progression', c.nextLift);
  say('Training streak', has(c.streak) ? `${c.streak} days${c.lastTrained ? ' · last trained ' + c.lastTrained : ''}` : null);
  say('Sessions in the last 30 days', c.sessionsLast30);
  say('Adherence to their plan', c.adherence);

  // Health, only ever present when the member consented (the member ask) — and
  // `injuryAreas`, which is the redacted form a coach ask carries instead.
  say('Current weight', c.weightKg, ' kg');
  say('Body fat', c.bodyFatPct, '%');
  say('Skeletal muscle', c.muscleKg, ' kg');
  say('Readiness today', c.readiness);
  say('What is holding readiness back', c.readinessGaps);
  say('Sleep', c.sleep);
  say('Injuries / limitations', has(c.injuries) ? c.injuries : c.injuryAreas);
  say('Focus areas to emphasise (from progress photo)', c.focusAreas);

  // The coach's own business. None of this was read before, which is why the
  // assistant could not answer the most obvious question a coach would ask it.
  say('Sessions delivered this month', c.sessionsDeliveredThisMonth);
  say('Sessions still unmarked', c.sessionsStillUnmarked);
  say('Revenue at their own rate this month', has(c.revenueAtOwnRate) ? `${c.currency ?? ''} ${c.revenueAtOwnRate}`.trim() : null);
  say('Taken this month', has(c.takenThisMonth) ? `${c.currency ?? ''} ${c.takenThisMonth}`.trim() : null);
  say('Clients on their book', c.clients);
  say('Average adherence across the book', c.avgAdherence);
  say('Clients at risk', c.atRiskClients);
  say('On track / watch / at risk', has(c.onTrack) ? `${c.onTrack} / ${c.watch ?? '?'} / ${c.atRiskLow ?? '?'}` : null);
  say('New clients this month', c.newClientsThisMonth);
  say('Coaching relationships ended this month', c.endedThisMonth);
  say('How they coach', c.howTheyCoach);

  const known = lines.length
    ? ['You have been given the following, and nothing else:', ...lines].join('\n')
    : 'You have been given no figures about this person or this business.';

  return [
    "You are Repple's AI fitness coach — warm, direct, and practical. You give concise, actionable training and nutrition guidance.",
    known,
    '',
    'Rules: keep replies short (2-4 sentences unless asked for detail). Be encouraging but honest. Use their real numbers. ',
    'When relevant, factor in their readiness, what they have eaten today, and their streak — e.g. suggest a lighter session if under-recovered, or a protein-focused meal if they are behind on protein. ' +
    'Match your advice to how they are coached: never tell a client training alone to ask their coach, or to book a session they have no coach to book with; for a client coached in person, defer form checks and loading decisions to the session they already have; for a hybrid client, say which of the two a suggestion belongs to. ' +
    'If the client has disclosed injuries or limitations, ALWAYS train around them: avoid or regress exercises that load the injured area, suggest pain-free alternatives, and never program through pain. ' +
    'Give practical next steps. You are not a doctor — for pain, injury, or medical questions, advise seeing a professional. Never invent data you were not given, and do not describe a figure you were not given as zero or as unknown-but-fine — say plainly that you were not given it.',
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
