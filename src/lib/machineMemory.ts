// Remembers what a scanned machine code maps to, so a member only sets it up once.
// The first time you scan a machine whose QR is just an asset serial, you pick the
// exercise; we store code → { exercise, muscle group, cardio } on the device, and
// every later scan of that same code recalls it instantly — no re-entry.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'repple.machineMemory.v1';

export interface RememberedMachine { name: string; group: string; cardio: boolean; unit?: string }

let cache: Record<string, RememberedMachine> | null = null;

async function all(): Promise<Record<string, RememberedMachine>> {
  if (cache) return cache;
  try { const raw = await AsyncStorage.getItem(KEY); cache = raw ? JSON.parse(raw) : {}; } catch { cache = {}; }
  return cache || {};
}

/** Recall a previously-set-up machine by its scanned code. Null if never seen. */
export async function recallMachine(code: string): Promise<RememberedMachine | null> {
  const c = (code || '').trim(); if (!c) return null;
  const map = await all();
  return map[c] || null;
}

/** Remember (or update) what a scanned code maps to, for next time. */
export async function rememberMachine(code: string, r: RememberedMachine): Promise<void> {
  const c = (code || '').trim(); if (!c || !r.name) return;
  const map = await all();
  map[c] = { name: r.name, group: r.group, cardio: !!r.cardio, unit: r.unit };
  cache = map;
  try { await AsyncStorage.setItem(KEY, JSON.stringify(map)); } catch { /* ignore */ }
}
