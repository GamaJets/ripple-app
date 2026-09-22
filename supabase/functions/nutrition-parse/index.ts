// Supabase Edge Function: nutrition-parse
// Natural-language food logging: "chicken burrito and a coke" -> itemized macros.
// Uses the same ANTHROPIC_API_KEY secret — or the Cheaper Inference gateway
// when CHEAPER_INFERENCE_API_KEY is set. See src/lib/llmGateway.ts. Deploy:
//   supabase functions deploy nutrition-parse
// Request JSON:  { text: string }
// Response JSON (read):  { items: [{ name, kcal, protein, carbs, fat, notGiven }],
//                          unreadableItems, estimated: true, note }
// Response JSON (not read): { error, why } with a 502 — one `why` per named
//                          failure, never one sentence for all of them.
//
// ── the three answers that used to be one ─────────────────────────────────
//
// This took a member's own words, put them in a prompt, and had a single
// `catch` under `extractJson`. Everything that could go wrong left it as
// `{ error: 'Parse failed' }`, including the case that is not a failure at all:
//
//   the reader named no food     "chicken burrito" misread as a sentence about
//                                a restaurant — a TRUE answer, and the only one
//                                of the three a member can act on.
//   the reader did not answer    truncated / empty / unreadable. Named upstream
//                                by `readReply` and kept named here.
//   the answer did not parse     half an object, or a shape with no items list.
//
// And the fourth, which was the quiet one: `Array.isArray(out.items) ? out.items
// : []` turned an answer of the WRONG SHAPE into an empty food list, which is
// the app's spelling of "the reader found no food in what you typed". A member
// was shown a description they had typed with nothing read out of it, told
// nothing had been found, and never told the reader had in fact answered with
// something this app could not read. The distinction now survives the wire:
// an empty `items` is a read that named no food, and a shape failure is a 502.
//
// Nothing here fills a gap with a zero. src/lib/modelAnswer.ts carries the
// argument and src/lib/foodAI.ts carries what the zero cost.
//
// Signed-in users only, for the reason written out at length in
// supabase/functions/coach-chat: `verify_jwt` proves the bearer token was
// signed by this project, and the public anon key is such a token. Without the
// check below, anybody who unpacked the app could spend Repple's Anthropic
// quota through this endpoint with no account at all.
import { createClient } from 'jsr:@supabase/supabase-js@2';
// `getUser()` does not reject when the auth server is unreachable — it RESOLVES
// with `{ data: { user: null }, error }`, the same shape a genuinely signed-out
// caller produces, and auth-js brands offline/DNS/abort and every 5xx as
// `AuthRetryableFetchError`, which is an AuthError. A leaf module with no
// relative imports of its own, so Deno can resolve it; it is where the repo
// writes down "refused the credential" versus "could not be asked".
import { authReadFate } from '../../../src/lib/authReadFate.ts';
import { providerFor, modelFor, buildCall, readReply, replyProblem } from '../../../src/lib/llmGateway.ts';
import { readModelJson, answerProblem, readNutritionItems } from '../../../src/lib/modelAnswer.ts';

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

/**
 * What the member is told when the reader read their words and named no food
 * in them.
 *
 * A REPORT ABOUT A READ, opening with its subject, rather than a claim about
 * the world. "No food found" is a sentence about the plate; this is a sentence
 * about the reader, and the difference is what stops a member believing the
 * app has ruled something out.
 */
const NONE_NAMED =
  'The reader read your description and did not name any food in it. Nothing has been filled in. Try describing it differently, or type the figures in.';

/** Said on every read, because every figure below is an ESTIMATE from a
 *  description and not a measurement of anything. The screens say so too
 *  (app/(client)/foodlog.tsx: "Read from what you typed"); this carries it on
 *  the payload so a caller cannot show the figures without it. */
const ESTIMATE_NOTE =
  'These are estimates for a typical portion, read from what you typed. Check every figure before logging it.';

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
  // ── and a dropped connection is not a signed-out person ────────────────
  //
  // This used to be `const { data } = …` with the error dropped, so a GoTrue
  // blip produced a null user — indistinguishable here from a token that was
  // looked at and refused — and the refusal below told a SIGNED-IN person to
  // sign in, which is the one remedy that cannot help. src/lib/authReadFate.ts
  // is where the two are separated; `unreadable` means nothing was established.
  // The `catch` is the non-AuthError path and establishes nothing either.
  const CANNOT_ASK = 'Repple could not check who you are just now. That is our end, not yours. '
    + 'Nothing has been logged. Try again in a moment.';
  try {
    const { data, error: authErr } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    if (authErr) {
      if (authReadFate(authErr) === 'unreadable') return json({ error: CANNOT_ASK }, 503);
    } else {
      userId = data?.user?.id || '';
    }
  } catch { return json({ error: CANNOT_ASK }, 503); }
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
    // (2) The reader did not answer. Three named reasons, not one.
    if (!reply.ok) return json({ error: replyProblem(reply.why), why: reply.why }, 502);

    // (3) It answered, and the answer holds no readable object.
    const answer = readModelJson(reply.text);
    if (!answer.ok) return json({ error: answerProblem(answer.why), why: answer.why }, 502);

    // …and the shape failure, which used to become an empty food list.
    const read = readNutritionItems(answer.value);
    if (!read.ok) {
      return json({
        error: 'The reader answered, but not with a list of foods this app could read. Nothing has been filled in. Try again, or type it in.',
        why: read.why,
      }, 502);
    }

    // (1) A real answer. An empty list here is the reader having named no food,
    // and it is a 200 because it is a read that worked.
    return json({
      items: read.items,
      unreadableItems: read.unreadableItems,
      estimated: true,
      note: read.items.length ? ESTIMATE_NOTE : NONE_NAMED,
    });
  } catch (e) {
    // Whatever is left is this function failing, not the reader. Kept distinct
    // from the four above rather than being the bucket they all fell into.
    return json({ error: 'The food reader could not be reached. Try again, or type it in.', why: 'function-failed', detail: String(e) }, 500);
  }
});
