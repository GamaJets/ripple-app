// Client wrapper for the nutrition-parse edge function (natural-language food).
import { supabase } from './supabase';

export interface ParsedFood { name: string; kcal: number; protein: number; carbs: number; fat: number }

/** AI food parsing is on with the same flag as vision/coach. */
export function foodAIAvailable(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_VISION === '1';
}

export async function parseFoodText(text: string): Promise<ParsedFood[] | null> {
  if (!foodAIAvailable() || !text.trim()) return null;
  try {
    const { data, error } = await supabase.functions.invoke('nutrition-parse', { body: { text } });
    if (error || !data || (data as any).error) return null;
    const items = (data as any).items;
    if (!Array.isArray(items)) return null;
    return items.map((r: any) => ({
      name: String(r.name ?? 'Food'),
      kcal: Math.round(r.kcal ?? 0), protein: Math.round(r.protein ?? 0),
      carbs: Math.round(r.carbs ?? 0), fat: Math.round(r.fat ?? 0),
    })).filter((r: ParsedFood) => r.kcal > 0);
  } catch { return null; }
}
