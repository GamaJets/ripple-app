// Supabase Edge Function: vision-analyze
// One function, two jobs — reads a MEAL photo into macros, and an INBODY scan
// into body stats. Uses Claude vision. Deploy:
//   supabase functions deploy vision-analyze
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (from console.anthropic.com)
// The app calls it via supabase.functions.invoke('vision-analyze', { body }).
//
// Request  JSON: { mode: 'meal' | 'inbody', imageBase64: string, mediaType?: string }
// Response JSON (meal):   { name, kcal, protein, carbs, fat, confidence }
//          JSON (inbody): { weightKg, bodyFatPct, skeletalMuscleKg, takenAt? }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Default to a broadly-available vision-capable model. Override with the
// ANTHROPIC_MODEL secret to use a newer one your account has (e.g. claude-sonnet-4-5).
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-3-5-sonnet-latest';

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

function extractJson(text: string): any {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('No JSON in model response');
  return JSON.parse(text.slice(a, b + 1));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'ANTHROPIC_API_KEY not set on the function' }, 500);

  let mode = 'meal', imageBase64 = '', mediaType = 'image/jpeg';
  try {
    const b = await req.json();
    mode = (b.mode === 'inbody' || b.mode === 'physique' || b.mode === 'machine') ? b.mode : 'meal';
    imageBase64 = String(b.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (b.mediaType) mediaType = b.mediaType;
  } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!imageBase64) return json({ error: 'imageBase64 required' }, 400);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: PROMPTS[mode] },
          ],
        }],
      }),
    });
    if (!res.ok) return json({ error: 'Vision API error', detail: await res.text() }, 502);
    const data = await res.json();
    const text = (data?.content?.[0]?.text) ?? '';
    return json({ mode, result: extractJson(text) });
  } catch (e) {
    return json({ error: 'Analysis failed', detail: String(e) }, 500);
  }
});
