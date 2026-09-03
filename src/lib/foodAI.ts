// Client wrapper for the nutrition-parse edge function (natural-language food).
//
// ── The zero that was not measured ─────────────────────────────────────────
//
// This coerced an absent protein, carb or fat figure to 0 with `?? 0`. A model
// that returned calories and nothing else therefore recorded a ZERO-PROTEIN
// meal — which then fed the remaining-macro figures a member eats the rest of
// their day against. A zero is a measurement; "we were not told" is not one,
// and this app does not let one stand in for the other anywhere else.
//
// The three macros are nullable now, and src/lib/foodPortion.ts refuses to
// build a loggable food out of a gap. What fills it is the member, in a box,
// which makes the figure testimony rather than an assumption by the app.
//
// ── And the flag that made the whole feature dark ──────────────────────────
//
// Availability used to be `EXPO_PUBLIC_ENABLE_VISION === '1'` alone, while the
// photo reader next door in ./vision.ts is on whenever the backend is on. Both
// call an edge function through the same client, on the same project, with the
// same failure path — so they were two answers to one question, and this was
// the pessimistic one. Worse, it is a BUILD-TIME constant: `process.env` is
// inlined by the bundler, so an OTA cannot turn it on, and "describe what you
// ate" was dark on every binary built without it while the photo reader beside
// it worked.
//
// It now agrees with `visionAvailable`, which is the only honest reading: if
// the function is reachable the feature is on, and if it is not, the call
// returns null and the screen already says so.
import { supabase } from './supabase';
import { visionAvailable } from './vision';

export interface ParsedFood {
  name: string;
  /** Null when the reader did not give us one, on the same rule as the three
   *  below. See the note on the filter in `parseFoodText`. */
  kcal: number | null;
  /** Null when the reader did not give us one. NEVER zero for an absent
   *  figure — see the header. */
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

/** AI food parsing is on exactly when the reader next door is. */
export function foodAIAvailable(): boolean {
  return visionAvailable();
}

export async function parseFoodText(text: string): Promise<ParsedFood[] | null> {
  if (!foodAIAvailable() || !text.trim()) return null;
  try {
    const { data, error } = await supabase.functions.invoke('nutrition-parse', { body: { text } });
    if (error || !data || (data as any).error) return null;
    const items = (data as any).items;
    if (!Array.isArray(items)) return null;
    // A number, or null. Accepts numeric strings for the reason ./vision.ts
    // gives — models stringify JSON numbers — and refuses everything else
    // rather than rounding it to a zero nobody measured.
    const num = (v: unknown): number | null => {
      if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
      if (typeof v === 'string') { const p = parseFloat(v.replace(/[^0-9.\-]/g, '')); return Number.isFinite(p) ? Math.round(p) : null; }
      return null;
    };
    return items.map((r: any) => ({
      name: String(r.name ?? 'Food'),
      // `?? 0` and then `.filter(r.kcal > 0)`, which is the header's own defect
      // wearing the other hat: an absent calorie figure became a zero, and the
      // zero then DELETED the food. A member who described three things and
      // was handed two of them back was never told the third existed — it was
      // not refused, not flagged, not left blank for them to fill in; it was
      // dropped, and the difference between "we were not told" and "there is
      // nothing there" is the whole subject of this file.
      //
      // So calories are nullable like the macros, and the gap is offered to the
      // member the same way theirs are: src/lib/foodPortion.ts refuses to build
      // a loggable food out of one, and the screen asks. Nothing is filtered
      // out here any more except an item with no figures at all, which is
      // nothing to ask about.
      kcal: num(r.kcal),
      protein: num(r.protein), carbs: num(r.carbs), fat: num(r.fat),
    })).filter((r: ParsedFood) => r.kcal != null || r.protein != null || r.carbs != null || r.fat != null);
  } catch { return null; }
}
