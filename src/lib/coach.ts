// Client wrapper for the coach-chat edge function (Repple's AI coach).
import { supabase } from './supabase';

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

/** AI features are on once the vision flag is set (same backend). */
export function coachAvailable(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_VISION === '1';
}

export async function askCoach(messages: ChatMsg[], context: Record<string, unknown>): Promise<string | null> {
  if (!coachAvailable()) return null;
  try {
    const { data, error } = await supabase.functions.invoke('coach-chat', { body: { messages, context } });
    if (error || !data || (data as any).error) return null;
    return (data as any).reply ?? null;
  } catch {
    return null;
  }
}
