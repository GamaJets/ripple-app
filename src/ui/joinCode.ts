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

export type MyCode = { ok: true; code: string } | { ok: false; reason: string };

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

/** Spend a code: creates the pending coach request, or reports why it did not. */
export async function joinByCode(input: string): Promise<JoinResult> {
  const code = normaliseCode(input);
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple first, then enter the code.' };
  try {
    const { data, error } = await supabase.rpc('join_by_code', { p_code: code });
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
