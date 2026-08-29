// The two ends of the join code: a coach reading theirs, a client spending one.
//
// Both RPCs are SECURITY DEFINER and both RAISE rather than returning a null —
// see 55-coach-join-code.sql. supabase-js turns a raised exception into a
// resolved promise with `error` set, so every call here reads `error` first.
// A join that silently did nothing is the failure this whole feature exists to
// remove; it must not be reintroduced by the client that calls it.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { joinErrorMessage, normaliseCode } from '../lib/joinCode';
import type { CoachedMode } from '../lib/types';

export type MyCode = { ok: true; code: string } | { ok: false; reason: string };

/** How many people have joined by this coach's code, and how many are waiting. */
export async function fetchJoinCodeStats(): Promise<{ joined: number; pending: number } | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.rpc('my_join_code_stats');
    if (error) { reportError('joinCode.stats', error); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return { joined: Number(row.joined) || 0, pending: Number(row.pending) || 0 };
  } catch (e) { reportError('joinCode.stats', e); return null; }
}

/** Issue a new code, retiring the old one. Returns the new code, or a reason. */
export async function rotateJoinCode(): Promise<MyCode> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to change your code.' };
  try {
    const { data, error } = await supabase.rpc('rotate_join_code');
    if (error) { reportError('joinCode.rotate', error); return { ok: false, reason: 'Your code could not be changed, so the old one is still the one to give out.' }; }
    const code = typeof data === 'string' ? data.trim() : '';
    if (!code) return { ok: false, reason: 'The new code came back empty, so the old one is still in use.' };
    return { ok: true, code };
  } catch (e: any) {
    reportError('joinCode.rotate', e);
    return { ok: false, reason: 'Your code could not be changed, so the old one is still the one to give out.' };
  }
}

/** The signed-in coach's code, allocated on first ask and stable after. */
export async function fetchMyJoinCode(): Promise<MyCode> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to get your coaching code.' };
  try {
    const { data, error } = await supabase.rpc('my_join_code');
    if (error) {
      reportError('joinCode.mine', error);
      return { ok: false, reason: 'Your coaching code could not be read, so there is nothing to give out yet.' };
    }
    const code = typeof data === 'string' ? data.trim() : '';
    // An empty string is not a code. Rendering one would put a blank space on
    // screen under the words "your code", for a coach to read out to somebody.
    if (!code) return { ok: false, reason: 'Your coaching code came back empty, so there is nothing to give out yet.' };
    return { ok: true, code };
  } catch (e: any) {
    reportError('joinCode.mine', e);
    return { ok: false, reason: 'Your coaching code could not be read, so there is nothing to give out yet.' };
  }
}

export type JoinResult =
  /** `already` is true when the request or the link existed before this call. */
  | { ok: true; trainerId: string; trainerName: string; already: boolean }
  | { ok: false; reason: string };

/**
 * Spend a code: creates the pending coach request, or reports why it did not.
 *
 * `mode` is the client's own answer to how they are coached, taken from their
 * profile. The first version hardcoded 'inperson' server-side, so every client
 * who used an online-only coach's code appeared on an in-person roster for
 * sessions nobody was going to run.
 *
 * It is sent whole. The function used to collapse anything that was not
 * 'inperson' down to 'online', so a hybrid client landed on the roster as
 * remote — the same failure as above, arrived at from the other direction.
 * Part 57 replaced that reduction, so passing 'hybrid' now stores 'hybrid'.
 */
export async function joinByCode(input: string, mode: CoachedMode = 'online'): Promise<JoinResult> {
  const code = normaliseCode(input);
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first, then enter the code.' };
  try {
    const { data, error } = await supabase.rpc('join_by_code', { p_code: code, p_mode: mode });
    if (error) return { ok: false, reason: joinErrorMessage(error.message) };
    // The RPC RETURNS TABLE, so supabase-js hands back an array. No row means
    // the function did not reach its `return query` — treat it as a failure
    // rather than reporting a join that may not have been written.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.trainer_id) {
      reportError('joinCode.join', new Error('join_by_code returned no row'));
      return { ok: false, reason: 'The code was checked but nothing came back, so your request may not have been sent. Try again.' };
    }
    return {
      ok: true,
      trainerId: String(row.trainer_id),
      trainerName: String(row.trainer_name || 'Your coach'),
      already: !!row.already,
    };
  } catch (e: any) {
    return { ok: false, reason: joinErrorMessage(e?.message) };
  }
}
