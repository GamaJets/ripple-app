// Supabase Edge Function: vision-analyze
// One function, two jobs — reads a MEAL photo into macros, and an INBODY scan
// into body stats. Uses Claude vision. Deploy:
//   supabase functions deploy vision-analyze
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (from console.anthropic.com)
// or, to send this through the Cheaper Inference gateway instead:
//   supabase secrets set CHEAPER_INFERENCE_API_KEY=ci_live_...
// Which provider, which endpoint and which model all live in one place, in
// src/lib/llmGateway.ts — and the endpoint in particular is NOT a per-function
// choice, because the gateway answers on an Anthropic-shaped path that accepts
// this function's image and then silently discards it.
// The app calls it via supabase.functions.invoke('vision-analyze', { body }).
//
// Request  JSON: { mode: 'meal' | 'inbody', imageBase64: string, mediaType?: string }
// Response JSON (meal):   { name, kcal, protein, carbs, fat, confidence }
//          JSON (inbody): { weightKg, bodyFatPct, skeletalMuscleKg, takenAt? }
//
// Signed-in users only, for the reason written out at length in
// supabase/functions/coach-chat: `verify_jwt` proves the bearer token was
// signed by this project, and the public anon key is such a token. This
// function POSTs a photograph — a meal, a body-composition sheet, or in
// `physique` mode a person's body — to api.anthropic.com on Repple's key, and
// it did so for anybody holding a string that ships inside the app bundle.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { providerFor, modelFor, buildCall, readReply, replyProblem, mediaTypeOr } from '../../../src/lib/llmGateway.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });


const PROMPTS: Record<string, string> = {
  meal:
    'You are a nutrition estimator. Identify the food in this photo and estimate the nutrition for the portion shown. ' +
    'Respond with ONLY valid JSON, no prose: {"name": string, "kcal": number, "protein": number, "carbs": number, "fat": number, "confidence": number (0-1)}. ' +
    'Protein/carbs/fat are grams. If unclear, give your best estimate and lower the confidence.',
  physique:
    'This is a physique / body progress photo taken for fitness tracking. Estimate visible body composition to guide training. ' +
    'Respond with ONLY valid JSON, no prose: {"bodyFatPct": number, "notes": string, "focusAreas": [string]}. ' +
    'bodyFatPct is your best visual estimate (%), notes is one or two encouraging sentences on what stands out, focusAreas lists 2-3 muscle groups or areas to prioritise next. This is a fitness estimate only, not medical or diagnostic advice.',
  machine:
    'This is a photo of a gym exercise machine or free-weight station. Identify the exercise it is used for. ' +
    'Respond with ONLY valid JSON, no prose: {"name": string, "muscleGroup": string, "isCardio": boolean, "confidence": number (0-1)}. ' +
    'Use the common gym name for name (e.g. "Bicep Curl", "Lat Pulldown", "Leg Press", "Chest Press", "Seated Row", "Leg Extension", "Shoulder Press", "Rowing Machine", "Treadmill"). ' +
    'muscleGroup is the primary muscle worked (e.g. "Biceps", "Back", "Chest", "Legs", "Shoulders"). isCardio is true only for cardio machines (treadmill, bike, rower, elliptical, stair, ski erg). ' +
    'An arm-curl / preacher-curl machine is a "Bicep Curl". If unsure, give your best guess and lower the confidence.',
  inbody:
    'This is an InBody (or similar) body-composition scan. Extract EVERY field below that is printed. ' +
    'Respond with ONLY valid JSON numbers (not strings), no prose: ' +
    '{"weightKg": number, "bodyFatPct": number, "skeletalMuscleKg": number, "takenAt": string|null, ' +
    '"visceralFat": number, "inbodyScore": number, "bmr": number, "fatMassKg": number, "leanMassKg": number, ' +
    '"bodyWaterL": number, "proteinKg": number, "mineralsKg": number, ' +
    '"leanArmLKg": number, "leanArmRKg": number, "leanTrunkKg": number, "leanLegLKg": number, "leanLegRKg": number}. ' +
    'Definitions: weightKg=total body weight kg; bodyFatPct=PBF %; skeletalMuscleKg=SMM kg; visceralFat=visceral fat level (unitless); ' +
    'inbodyScore=total InBody score points; bmr=basal metabolic rate kcal; fatMassKg=body fat mass kg; leanMassKg=lean/fat-free body mass kg; ' +
    'bodyWaterL=total body water L; proteinKg and mineralsKg in kg; leanArmLKg/leanArmRKg/leanTrunkKg/leanLegLKg/leanLegRKg are the segmental lean analysis (left/right arm, trunk, left/right leg) in kg. ' +
    'takenAt is the scan/test date. The date printed on the sheet is in DAY/MONTH/YEAR order (international format) — e.g. "05/07/2026" or "05.07.2026" means 5 July 2026, NOT 7 May. Convert it and return takenAt as YYYY-MM-DD (so 5 July 2026 -> "2026-07-05"). Use null for any field not present. Return numbers as numbers.',
};

/** The image types the vision API accepts, and the only values that may reach
 *  it from a request body. `mediaType` was taken verbatim — a caller string
 *  placed straight into a call to a third party — and while the vendor refuses
 *  an unknown one, a field that is passed through unread is a field nobody is
 *  checking. The app sends 'image/jpeg' and nothing else. The list itself moved
 *  to src/lib/llmGateway.ts, which is the file that has to build the two
 *  different image parts out of it.
 */

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
  if (!provider) return json({ error: 'No AI provider is configured on the function' }, 500);
  const key = (provider === 'cheaper-inference' ? gatewayKey : anthropicKey) as string;

  // Signed-in users only — this spends a metered quota and sends a photograph
  // to a third party. See the header.
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let userId = '';
  try {
    const { data } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    userId = data?.user?.id || '';
  } catch { /* stays empty, and the refusal below is the answer */ }
  if (!userId) return json({ error: 'Sign in to Repple to read a photo this way.' }, 401);

  let mode = 'meal', imageBase64 = '', mediaType = 'image/jpeg';
  try {
    const b = await req.json();
    mode = (b.mode === 'inbody' || b.mode === 'physique' || b.mode === 'machine') ? b.mode : 'meal';
    imageBase64 = String(b.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
    // Named, not passed through. Anything the vision API does not take is
    // 'image/jpeg', which is what every caller in this repo sends anyway.
    mediaType = mediaTypeOr(b.mediaType);
  } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!imageBase64) return json({ error: 'imageBase64 required' }, 400);

  try {
    const call = buildCall(provider, key, {
      messages: [{ role: 'user', content: PROMPTS[mode] }],
      image: { base64: imageBase64, mediaType },
      maxTokens: 400,
      model: modelFor(provider, 'vision', Deno.env.get(
        provider === 'cheaper-inference' ? 'CHEAPER_INFERENCE_MODEL' : 'ANTHROPIC_MODEL')),
    });
    const res = await fetch(call.url, { method: 'POST', headers: call.headers, body: call.body });
    if (!res.ok) return json({ error: 'Vision API error', detail: await res.text() }, 502);

    // A truncation is named rather than parsed. On a body-composition sheet the
    // dangerous shape is not the throw — it is a shorter object that PARSES,
    // with weight and body fat present and the segmental fields cut off, which
    // lands in a member's health record looking like a scan that simply did not
    // print those rows.
    const reply = readReply(provider, await res.json());
    if (!reply.ok) return json({ error: replyProblem(reply.why) }, 502);
    return json({ mode, result: extractJson(reply.text) });
  } catch (e) {
    return json({ error: 'Analysis failed', detail: String(e) }, 500);
  }
});
