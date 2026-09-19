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
// Request  JSON: { mode?: 'meal' | 'physique' | 'machine' | 'inbody',
//                 imageBase64: string, mediaType?: string }
//
// Response JSON (read, 200):
//   { mode, result, notGiven: string[], estimated: true, note: string }
//   `result` holds every figure the prompt for that mode asked for, each one a
//   number or NULL. Never 0 for an absent figure. `notGiven` names the ones the
//   reader did not give, so a caller can ask a person instead of assuming.
// Response JSON (not read):
//   { error, why } — 502 when the reader did not answer or the answer did not
//   parse, 422 when it answered and named none of the figures asked for.
//
// ── the three answer-failures that used to be one ─────────────────────────
//
// The header above USED to describe a response shape this function has not
// returned for some time (it returns `{ mode, result }`), which is its own
// small version of the problem below: a description of a figure that is not the
// figure. What matters more is what happened underneath it.
//
// Every way an answer could come to nothing arrived at one `catch` and left as
// `{ error: 'Analysis failed' }`:
//
//   the reader answered in words   "I can't see any food in this image." TRUE,
//                                  useful, and the only one of the three a
//                                  member can act on. It holds no `{`, so the
//                                  old `extractJson` threw on it.
//   the reader did not answer      truncated / empty / unreadable — already
//                                  named by `readReply`, and kept named here.
//   the answer did not parse       half an object, or a shape that is not a
//                                  set of figures at all.
//
// A member told "Analysis failed" about the first retakes a photograph of a
// plate the reader was right about. A member told nothing about the third is
// handed a blank sheet and fills it in believing the reader found nothing.
//
// ── and the figures themselves ────────────────────────────────────────────
//
// `result` was the parsed object, passed through whole and unread. Two things
// followed from that. A field the model omitted arrived as `undefined` and left
// this function unremarked, so nothing downstream could tell "the sheet does
// not print visceral fat" from "the reader did not read it". And `confidence`
// was whatever the model happened to say, with no record of whether it said
// anything at all — src/lib/vision.ts still turns an absent one into 0.6, a
// figure no model produced.
//
// So every figure the prompt asks for is now read as a number or NULL, and the
// gaps are NAMED on the payload rather than left as holes in an object. Nothing
// is defaulted to 0: src/lib/modelAnswer.ts carries that argument, and
// src/lib/foodAI.ts carries what the zero cost when it was allowed.
//
// Signed-in users only, for the reason written out at length in
// supabase/functions/coach-chat: `verify_jwt` proves the bearer token was
// signed by this project, and the public anon key is such a token. This
// function POSTs a photograph — a meal, a body-composition sheet, or in
// `physique` mode a person's body — to api.anthropic.com on Repple's key, and
// it did so for anybody holding a string that ships inside the app bundle.
import { createClient } from 'jsr:@supabase/supabase-js@2';
// `getUser()` does not reject when the auth server is unreachable — it RESOLVES
// with `{ data: { user: null }, error }`, the same shape a genuinely signed-out
// caller produces, and auth-js brands offline/DNS/abort and every 5xx as
// `AuthRetryableFetchError`, which is an AuthError. A leaf module with no
// relative imports of its own, so Deno can resolve it; it is where the repo
// writes down "refused the credential" versus "could not be asked".
import { authReadFate } from '../../../src/lib/authReadFate.ts';
import { providerFor, modelFor, buildCall, readReply, replyProblem, mediaTypeOr } from '../../../src/lib/llmGateway.ts';
import { readModelJson, answerProblem, numberOrNull, figuresAmong, notGivenAmong } from '../../../src/lib/modelAnswer.ts';

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

/** The modes this function has a prompt for. An unrecognised one is refused
 *  rather than quietly read as a meal — `mode` used to fall back to 'meal' for
 *  any value it did not recognise, so a misspelled 'inbdoy' sent somebody's
 *  body-composition sheet to the meal prompt and came back with macros for it. */
const MODES = ['meal', 'physique', 'machine', 'inbody'] as const;
type Mode = typeof MODES[number];

/**
 * The numeric fields each prompt above asks the reader for, in its own words.
 *
 * This list IS the set the gaps are measured against: a figure absent from the
 * answer is a gap in something that was asked for, which is what makes naming
 * it honest rather than speculative.
 */
const FIGURES: Record<Mode, readonly string[]> = {
  meal: ['kcal', 'protein', 'carbs', 'fat', 'confidence'],
  physique: ['bodyFatPct'],
  machine: ['confidence'],
  inbody: [
    'weightKg', 'bodyFatPct', 'skeletalMuscleKg', 'visceralFat', 'inbodyScore', 'bmr',
    'fatMassKg', 'leanMassKg', 'bodyWaterL', 'proteinKg', 'mineralsKg',
    'leanArmLKg', 'leanArmRKg', 'leanTrunkKg', 'leanLegLKg', 'leanLegRKg',
  ],
};

/**
 * The figure whose absence means nothing usable came back for that mode.
 *
 * Not "all figures are null": a meal the reader priced at 600 kcal and gave no
 * macros for is a read that worked and a sheet to fill the rest of in. A meal
 * with no calorie figure is not — src/lib/vision.ts returns null for exactly
 * that — and saying WHICH of the three happened is the whole of this change.
 * `null` here means the mode has no single load-bearing figure and the check
 * below falls back to asking whether anything at all was read.
 */
const LOAD_BEARING: Record<Mode, string | null> = {
  meal: 'kcal',
  physique: 'bodyFatPct',
  machine: null,
  inbody: null,
};

/** What the member is told when the reader answered and named nothing.
 *
 *  A report about the READ, opening with its subject. "There is no food in this
 *  photo" is a claim about the plate and the reader is not entitled to it;
 *  "the reader did not give a calorie figure for it" is what actually happened,
 *  and it is the sentence that leaves the member in charge of the decision. */
const NOTHING_READ: Record<Mode, string> = {
  meal: 'The reader looked at this photo and did not give a calorie figure for it. Nothing has been filled in — type the meal in, or try a clearer photo.',
  physique: 'The reader looked at this photo and did not return an estimate from it. Nothing has been filled in.',
  machine: 'The reader looked at this photo and did not name a machine in it. Nothing has been filled in — pick the exercise yourself.',
  inbody: 'The reader looked at this sheet and did not read a single figure off it. Nothing has been filled in — type the numbers in, or try a straighter, brighter photo.',
};

/** Said on every read, because every one of these figures is an ESTIMATE from
 *  a photograph rather than a measurement this app made. The inbody sheet is
 *  the one exception worth naming: the MACHINE measured it, and the reader is
 *  transcribing — which can still be misread, so it is still checked. */
const ESTIMATE_NOTE: Record<Mode, string> = {
  meal: 'These are estimates of the portion shown, read from your photo by a model. Check every figure before logging it.',
  physique: 'This is a visual estimate read from a photo by a model, not a measurement. It is not medical or diagnostic advice.',
  machine: 'This is the reader’s best guess at the machine in the photo. Check it before you log against it.',
  inbody: 'These figures were read off your scan sheet by a model, not typed in by a person. Check each one against the printout before saving it.',
};

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
  // ── and a dropped connection is not a signed-out person ────────────────
  //
  // This used to be `const { data } = …` with the error dropped, so a GoTrue
  // blip produced a null user — indistinguishable here from a token that was
  // looked at and refused — and the refusal below told a SIGNED-IN person to
  // sign in, which is the one remedy that cannot help. src/lib/authReadFate.ts
  // is where the two are separated; `unreadable` means nothing was established.
  // The `catch` is the non-AuthError path and establishes nothing either.
  const CANNOT_ASK = 'Repple could not check who you are just now — that is our end, not yours. '
    + 'Your photo has not been read and has not been sent anywhere. Try again in a moment.';
  try {
    const { data, error: authErr } = await service.auth.getUser((req.headers.get('Authorization') || '').replace('Bearer ', ''));
    if (authErr) {
      if (authReadFate(authErr) === 'unreadable') return json({ error: CANNOT_ASK }, 503);
    } else {
      userId = data?.user?.id || '';
    }
  } catch { return json({ error: CANNOT_ASK }, 503); }
  if (!userId) return json({ error: 'Sign in to Repple to read a photo this way.' }, 401);

  let mode: Mode = 'meal';
  let imageBase64 = '', mediaType = 'image/jpeg';
  let badMode = '';
  try {
    const b = await req.json();
    // An absent mode is still a meal, which is what every caller that sends
    // none means. A mode that was SENT and is not one of the four is refused
    // below rather than read as a meal — see the note on MODES.
    const asked = b.mode == null || b.mode === '' ? 'meal' : String(b.mode);
    if ((MODES as readonly string[]).indexOf(asked) === -1) badMode = asked;
    else mode = asked as Mode;
    imageBase64 = String(b.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
    // Named, not passed through. Anything the vision API does not take is
    // 'image/jpeg', which is what every caller in this repo sends anyway.
    mediaType = mediaTypeOr(b.mediaType);
  } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (badMode) return json({ error: `Unknown mode '${badMode.slice(0, 32)}'`, why: 'unknown-mode' }, 400);
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
    // (2) The reader did not answer. Three named reasons, kept as three.
    if (!reply.ok) return json({ error: replyProblem(reply.why), why: reply.why }, 502);

    // (3) It answered, and there is no readable object in the answer. `no-json`
    // is the case that used to be lost: for a vision ask the prose usually IS
    // the answer, and it is now reported as such rather than as a crash.
    const answer = readModelJson(reply.text);
    if (!answer.ok) return json({ error: answerProblem(answer.why), why: answer.why }, 502);

    const keys = FIGURES[mode];
    const figures = figuresAmong(answer.value, keys);
    const notGiven = notGivenAmong(answer.value, keys);
    // The non-numeric fields each prompt asks for, carried as they came. A
    // string is either there or it is '', and neither can be mistaken for a
    // measurement the way a 0 can.
    const name = typeof answer.value.name === 'string' ? answer.value.name.trim() : '';
    const result: Record<string, unknown> = {
      ...figures,
      // Only when the reader actually named one. Left ABSENT rather than sent
      // as '' so that the callers' own fallbacks ('Meal', '') still decide what
      // an unnamed thing is called — this function does not name a member's
      // food for them.
      ...(name ? { name } : {}),
      muscleGroup: typeof answer.value.muscleGroup === 'string' ? answer.value.muscleGroup.trim() : '',
      isCardio: answer.value.isCardio === true,
      notes: typeof answer.value.notes === 'string' ? answer.value.notes : '',
      focusAreas: Array.isArray(answer.value.focusAreas) ? answer.value.focusAreas.map(String).slice(0, 4) : [],
      takenAt: typeof answer.value.takenAt === 'string' && answer.value.takenAt.trim() ? answer.value.takenAt.trim() : null,
      // REPORTED, not asserted. A reader that offered no confidence is not a
      // reader that was 0.6 sure, and a caller that fills the gap with a figure
      // is inventing the one number whose whole job is to say how much to trust
      // the others. src/lib/vision.ts still does `?? 0.6` at its end of this
      // wire; this flag is what lets that be fixed without guessing.
      confidenceGiven: numberOrNull(answer.value.confidence) !== null,
    };

    // (1) It answered, and named nothing this mode can be built from. A real
    // answer about the photograph, and a 422 rather than a 502 because nothing
    // failed — there is simply nothing in it to fill a sheet with.
    const bearer = LOAD_BEARING[mode];
    const nothing = bearer
      ? figures[bearer] === null
      : keys.every((k) => figures[k] === null) && !name && !result.notes && !(result.focusAreas as string[]).length;
    if (nothing) return json({ error: NOTHING_READ[mode], why: 'nothing-read', mode, notGiven }, 422);

    return json({ mode, result, notGiven, estimated: true, note: ESTIMATE_NOTE[mode] });
  } catch (e) {
    // What is left is this function failing, not the reader — kept distinct
    // from the four above rather than being the bucket they all fell into.
    return json({ error: 'The photo reader could not be reached. Try again, or type the figures in.', why: 'function-failed', detail: String(e) }, 500);
  }
});
