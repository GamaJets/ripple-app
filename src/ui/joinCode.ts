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
// A count of PEOPLE, read the one way this codebase reads one. See
// `fetchJoinCodeStats` below; src/ui/sessions.tsx imports it for the same
// reason and src/lib/reschedule.ts:101 is the argument.
import { queueLength } from '../lib/reschedule';
import { ROW_CAP } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import type { CoachedMode } from '../lib/types';

export type MyCode = { ok: true; code: string } | { ok: false; reason: string };

/**
 * How many people have joined by this coach's codes, and how many are waiting.
 *
 * Null is the whole of the third state and the caller already draws it: null
 * reaches `codeUptakeLine` in src/lib/handOutCode.ts, which says the read did
 * not come back, and `app/(trainer)/join-code.tsx` keeps `undefined` separate
 * for "not asked yet" so the failure sentence is not on screen at open.
 *
 * ── why the figures are not coerced ───────────────────────────────────────
 *
 * This used to end `Number(row.joined) || 0`, twice. `Number(null)` is 0,
 * `Number('')` is 0, `Number(undefined)` is NaN and `|| 0` eats that too — so
 * an absent key, a null column and a word all arrived at the same confident
 * figure, and `codeUptakeLine` prints that figure as "0 people have joined on
 * your codes. Nobody is waiting on you." That is a claim about who is in this
 * coach's queue, built out of an unknown, and the pending half of it is a
 * claim about people who are sitting there unanswered.
 *
 * It was safe TODAY only because both figures are `count(*)` over a CTE in
 * `my_join_codes()`'s sibling and `count(*)` cannot be null — which is a fact
 * about the current function body, not about this file, and is not the same
 * thing as being correct. `queueLength` settles it at the boundary instead: a
 * non-negative integer, or nothing. Either half unreadable and the whole answer
 * is null, because half a queue is not a queue — reporting a real `joined`
 * beside a fabricated `pending` of zero is the exact sentence above with one
 * true clause in front of it.
 */
export async function fetchJoinCodeStats(): Promise<{ joined: number; pending: number } | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data, error } = await supabase.rpc('my_join_code_stats');
    if (error) { reportError('joinCode.stats', error); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const joined = queueLength(row.joined);
    const pending = queueLength(row.pending);
    if (joined == null || pending == null) {
      reportError('joinCode.stats', new Error('my_join_code_stats answered without a readable joined/pending count'));
      return null;
    }
    return { joined, pending };
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
 * ── the row count this paragraph used to claim ───────────────────────────
 *
 * It said 'partial' was never produced because "my_join_codes() returns at most
 * twenty-one rows", and the figure was wrong. Twenty is the cap on LIVE codes —
 * `create_join_code` counts `revoked_at is null` before refusing (setup.sql) —
 * and `my_join_codes()` returns the default row plus EVERY named code the coach
 * has ever made, live and revoked, because the counts on a withdrawn code are
 * the history of what worked. A coach who has turned twenty codes off and made
 * twenty more has forty-one rows, and nothing bounds that afterwards but their
 * own patience. src/lib/handOutCode.ts:216 carried the identical claim and
 * records the same correction.
 *
 * So the cap is not out of reach by arithmetic, and the read does not assume it
 * is. `my_join_codes()` has no LIMIT of its own, which leaves PostgREST's own
 * ceiling as the only one — and a set cut off at that ceiling is indistinguishable
 * from a set that ended there, so a read that comes back AT it is reported as a
 * prefix. src/ui/coachReferrals.ts:63 makes the same call on the same shape.
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
    const raw = (data ?? []) as RawJoinCode[];
    // A read that came back at the server's own ceiling is a prefix of the real
    // list, not the list. `>=` and not `>`: this is an RPC, so there is no
    // `.limit(capLimit())` probe row to ask for — PostgREST's max-rows is the
    // ceiling and it will not hand back one past it. The rows may be shown; no
    // sentence over them may be stated as a total, which `namedCodesLine` and
    // `leadCountLine` both already refuse to do under 'partial'.
    const truncated = Array.isArray(data) && raw.length >= ROW_CAP;
    return {
      status: truncated ? 'partial' : 'ready',
      rows: shapeJoinCodes(raw),
      ...(truncated ? { reason: 'Not all of your codes came back in one go, so this is not all of them.' } : {}),
    };
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
 *
 * ── `currency` is the unit the figure was SCALED in, not a preference ─────
 *
 * `cents` is minor units, and how many minor units a whole one holds is a
 * property of the currency: 100 in sterling, 1 in yen, 1000 in Kuwaiti dinar.
 * `parseSpend` in src/lib/codeReturn.ts does that scaling and it needs a
 * currency to do it, so whatever it used has to travel with the number.
 *
 * `set_code_spend` takes `p_currency` as link 1 of the chain in
 * supabase/parts/1082 — stated by the caller, else the coach's packages if they
 * agree, else their gym, else their own currency when they have no gym. Before
 * this the client sent no currency at all and scaled by a flat hundred while
 * the server independently picked a code to stamp on the result, so on a yen
 * account the number was a hundred times the amount and the label agreed with
 * it. Sending the unit the figure is actually in makes those one fact.
 *
 * Omitted, the parameter is not sent and the server resolves it exactly as it
 * did — which is right for a caller that is clearing the record, where there is
 * no figure to have a unit.
 */
export async function saveCodeSpend(codeId: string | null, cents: number | null, currency?: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Sign in to Repple to record what a code cost.' };
  try {
    const cur = (currency || '').trim().toUpperCase();
    const { error } = await supabase.rpc('set_code_spend', {
      p_code_id: codeId,
      p_amount_cents: cents,
      ...(cur ? { p_currency: cur } : {}),
    });
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


/* ── a code that costs nothing ─────────────────────────────────────────────
 *
 * app/(trainer)/ad-spend.tsx reports every code with no spend against it as
 * "cost unknown", on the reasonable premise that an unpriced channel is a gap
 * in the record. For a paid channel it is. For a code a coach read out at the
 * end of a class, put in an Instagram caption, or printed on a card they had
 * anyway, it is not — the cost is nothing, and that is a real answer.
 *
 * Today the two are indistinguishable, so a coach with four organic codes and
 * one unpriced ad reads a list of five gaps, decides the section is noise, and
 * stops looking at it — which is where the one that mattered was.
 *
 * ── Why not simply record a spend of zero ────────────────────────────────
 *
 * A row in `coach_code_spend` with `cents = 0` says "I have measured this
 * channel and it cost nothing THIS PERIOD". `is_organic` says "this channel has
 * no cost, ever". They behave identically in an arithmetic sum and differently
 * in every sentence: only the second can honestly be left out of "codes you
 * have not priced yet", and the first would have to be re-entered every month
 * to keep saying so.
 */

/** Which of the caller's codes are marked as costing nothing.
 *
 *  A Set rather than a map of booleans, and the DISTINCTION the caller needs is
 *  carried by the return being nullable: null is "we could not read it", which
 *  must render as "cost unknown" exactly as it did before this existed. An
 *  empty Set is a settled read that found no organic codes. */
export async function fetchOrganicCodes(): Promise<Set<string> | null> {
  if (!USE_SUPABASE) return null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;
    // Read straight from the table rather than through `my_join_codes()`. That
    // RPC's return type is consumed by three screens, and widening it would be
    // a drop-and-recreate of a function every one of them depends on for the
    // sake of one boolean this screen alone reads. `coach_join_codes_owner_read`
    // already admits the caller's own rows.
    const { data, error } = await supabase
      .from('coach_join_codes').select('id, is_organic').eq('trainer_id', uid);
    if (error) { reportError('joinCode.organic.read', error); return null; }
    const out = new Set<string>();
    for (const r of (data ?? []) as { id: unknown; is_organic: unknown }[]) {
      if (r?.is_organic === true && typeof r.id === 'string') out.add(r.id);
    }
    return out;
  } catch (e) {
    reportError('joinCode.organic.read', e);
    return null;
  }
}

/**
 * Mark one of the coach's own codes as costing nothing, or stop doing so.
 *
 * Through `set_code_organic()` and NOT a direct update. Part 152 revokes
 * INSERT, UPDATE and DELETE on `coach_join_codes` from `authenticated`
 * outright, and a PostgREST update matching zero rows is not an error
 * (src/lib/wroteRows.ts) — so a direct write here would have reported success
 * and changed nothing, forever, which is the exact failure part 153 describes
 * finding on the owner's brand screen.
 */
export async function setCodeOrganic(
  id: string,
  organic: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!USE_SUPABASE) return { ok: false, reason: 'Not signed in, so nothing was changed.' };
  try {
    const { data, error } = await supabase.rpc('set_code_organic', { p_id: id, p_organic: organic });
    if (error) {
      reportError('joinCode.organic.write', error);
      return { ok: false, reason: 'That did not save, so the code is unchanged.' };
    }
    // The function returns false for "not yours" and for "no such code", and
    // both are real answers rather than faults. Reporting either as saved would
    // leave a coach believing a channel is marked free when the next screen
    // will still call it unknown.
    if (data !== true) {
      return { ok: false, reason: 'That code could not be found on your account, so nothing was changed.' };
    }
    return { ok: true };
  } catch (e) {
    reportError('joinCode.organic.write', e);
    return { ok: false, reason: 'That did not save, so the code is unchanged.' };
  }
}
