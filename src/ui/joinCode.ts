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
import { shapeJoinCodes, spentCodeMessage, normaliseLabel, type JoinCodeRow, type RawJoinCode } from '../lib/joinCodes';
import { shapeCodeReturns, type CodeReturnRow, type RawCodeReturn } from '../lib/codeReturn';
import type { LoadStatus } from './loadStatus';
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

/**
 * Every code this coach holds, with what each one brought in.
 *
 * The status travels with the rows because the rows are counts, and this is the
 * read where an empty answer is most dangerous: no rows under a failed read
 * looks exactly like a coach whose campaigns brought in nobody. Nothing here
 * substitutes a zero for an unknown — see src/lib/joinCodes.ts, which owns the
 * sentence each row renders.
 *
 * 'partial' is never produced: my_join_codes() returns at most twenty-one rows
 * and does its counting server-side, so PostgREST's 1,000-row cap cannot bite.
 * The type still carries it so the screens do not have to be revisited if that
 * ever stops being true.
 */
export type JoinCodesRead = { status: LoadStatus; rows: JoinCodeRow[]; reason?: string };

export async function fetchMyJoinCodes(): Promise<JoinCodesRead> {
  // Not "there are none". Without a server there is no table to have read, and
  // an empty list under 'ready' would be a claim about a coach's campaigns made
  // by an app that never asked anybody.
  if (!USE_SUPABASE) return { status: 'error', rows: [], reason: 'Sign in to Repple to see your codes.' };
  try {
    const { data, error } = await supabase.rpc('my_join_codes');
    if (error) {
      reportError('joinCode.list', error);
      return { status: 'error', rows: [], reason: 'Your codes could not be read, so nothing here is a count.' };
    }
    return { status: 'ready', rows: shapeJoinCodes((data ?? []) as RawJoinCode[]) };
  } catch (e) {
    reportError('joinCode.list', e);
    return { status: 'error', rows: [], reason: 'Your codes could not be read, so nothing here is a count.' };
  }
}

/**
 * What each code cost and what it brought back.
 *
 * A second read rather than more columns on my_join_codes(), because it is a
 * strictly more expensive query — it walks purchases and relationships — and
 * the codes list is opened far more often than the money is looked at. The two
 * agree about which codes exist and what order they read in because
 * my_code_returns() is built on the same CTEs; they can disagree about the
 * headcount, deliberately, and part 98 says why: this one counts PEOPLE, once
 * each, last touch, because it carries money.
 *
 * The status travels with the rows for the same reason it does above. An empty
 * list under a failed read is not a coach whose channels earned nothing.
 */
export type CodeReturnsRead = { status: LoadStatus; rows: CodeReturnRow[]; reason?: string };

export async function fetchMyCodeReturns(): Promise<CodeReturnsRead> {
  if (!USE_SUPABASE) return { status: 'error', rows: [], reason: 'Sign in to Repple to see what your codes returned.' };
  try {
    const { data, error } = await supabase.rpc('my_code_returns');
    if (error) {
      reportError('joinCode.returns', error);
      return { status: 'error', rows: [], reason: 'What your codes cost and returned could not be read, so nothing here is a figure.' };
    }
    return { status: 'ready', rows: shapeCodeReturns((data ?? []) as RawCodeReturn[]) };
  } catch (e) {
    reportError('joinCode.returns', e);
    return { status: 'error', rows: [], reason: 'What your codes cost and returned could not be read, so nothing here is a figure.' };
  }
}

/**
 * Record what a code cost — or clear it.
 *
 * `cents` null CLEARS the record. That is the one call here where succeeding
 * quietly matters: a coach who meant to erase a wrong number and was told
 * nothing would keep comparing channels against it. So a failure is reported
 * either way, and the caller re-reads rather than patching the row.
 *
 * `codeId` null is the coach's default code, which has no row of its own.
 */
export async function saveCodeSpend(codeId: string | null, cents: number | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to record what a code cost.' };
  try {
    const { error } = await supabase.rpc('set_code_spend', { p_code_id: codeId, p_amount_cents: cents });
    if (error) {
      reportError('joinCode.spend', error);
      return {
        ok: false,
        reason: cents == null
          ? 'That could not be cleared, so the amount already recorded is still what your figures are worked out from.'
          : 'That could not be saved, so your figures are still worked out from whatever was recorded before.',
      };
    }
    return { ok: true };
  } catch (e) {
    reportError('joinCode.spend', e);
    return { ok: false, reason: 'That could not be saved, so your figures are still worked out from whatever was recorded before.' };
  }
}

/**
 * Create a named code. The label is what makes its count readable later.
 *
 * Returns the code, not a row: the server hands back the six characters (see
 * part 81) and the label is the one just sent, so there is nothing to be
 * out of step with the list that is re-read straight afterwards.
 */
export async function createJoinCode(label: string): Promise<{ ok: true; code: string; label: string } | { ok: false; reason: string }> {
  const clean = normaliseLabel(label);
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to make a code.' };
  try {
    const { data, error } = await supabase.rpc('create_join_code', { p_label: clean });
    // The server's own words, not a flattened "something went wrong": every
    // refusal it raises here — no name, a name already live, twenty codes
    // already — is something the coach can act on in the next five seconds.
    if (error) { reportError('joinCode.create', error); return { ok: false, reason: createErrorMessage(error.message) }; }
    const code = typeof data === 'string' ? data.trim().toUpperCase() : '';
    // An empty string is not a code, and the row may or may not exist. Claiming
    // success while showing nothing to give out is the worse half of that.
    if (!code) {
      reportError('joinCode.create', new Error('create_join_code returned no code'));
      return { ok: false, reason: 'The code was not returned, so there is nothing to give out. Reopen this sheet and check before making another.' };
    }
    return { ok: true, code, label: clean };
  } catch (e: any) {
    reportError('joinCode.create', e);
    return { ok: false, reason: createErrorMessage(e?.message) };
  }
}

function createErrorMessage(raw: string | null | undefined): string {
  const m = (raw || '').toLowerCase();
  if (m.includes('already have a live code called')) return 'You already have a live code with that name. Turn it off first, or pick another name.';
  if (m.includes('20 live codes')) return 'You already have 20 live codes. Turn one off before making another.';
  if (m.includes('a code needs a name')) return 'Give the code a name, so you can tell later which one worked.';
  if (m.includes('name is too long')) return 'That name is too long — keep it to 40 characters.';
  if (m.includes('no trainer profile')) return 'This account is not set up as a coach, so it cannot issue codes.';
  if (m.includes('not signed in')) return 'Sign in to Repple to make a code.';
  return raw?.trim() ? `${raw.trim()} No code was made.` : 'The code could not be made.';
}

/**
 * Turn a named code off. It stops accepting joins and keeps its history, so the
 * clients it already brought in stay attributed to it.
 */
export async function revokeJoinCode(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to turn a code off.' };
  try {
    const { error } = await supabase.rpc('revoke_join_code', { p_id: id });
    if (error) {
      reportError('joinCode.revoke', error);
      // The code is still live. Saying otherwise would leave a coach believing
      // a code they wanted off is off, while it keeps taking joins.
      return { ok: false, reason: 'That code could not be turned off, so it is still working. Try again.' };
    }
    return { ok: true };
  } catch (e) {
    reportError('joinCode.revoke', e);
    return { ok: false, reason: 'That code could not be turned off, so it is still working. Try again.' };
  }
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
    // A named code that has been turned off is its own failure, and part 81
    // raises it as one. Folded into "no coach uses that code" it would send the
    // client back to their coach to argue about a code the coach knows they
    // issued, with both of them looking for a typo that is not there.
    if (error) return { ok: false, reason: spentCodeMessage(error.message) ?? joinErrorMessage(error.message) };
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
    return { ok: false, reason: spentCodeMessage(e?.message) ?? joinErrorMessage(e?.message) };
  }
}
