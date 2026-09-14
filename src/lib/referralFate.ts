// What `record_referral` actually established, and whether the stashed code
// may be thrown away.
//
// ── what was broken ───────────────────────────────────────────────────────
//
// `recordReferral` was one line:
//
//     try { await supabase.rpc('record_referral', { p_code: c }); } catch { }
//
// and `flushPendingReferral` was two:
//
//     await recordReferral(c);
//     await AsyncStorage.removeItem(PENDING_KEY);
//
// So the code was deleted whatever happened — including the case where nothing
// happened at all, because the phone was in a lift. `peekPendingReferral`'s own
// comment calls the flush "the only thing that clears it", which is a
// durability claim, and the pair above broke it: one sign-in on a bad
// connection and the referral is gone for good. Nobody is credited, nobody is
// told, and there is no second chance because there is nothing left to retry
// from.
//
// The naive repair — "keep it whenever there was an error" — is wrong in the
// other direction. An error that IS the server's answer will be the server's
// answer again tomorrow, so a code kept on one of those is retried at every
// sign-in forever and still never recorded. The two have to be told apart, and
// this file is where that is written down and tested.
//
// ── the three things that can come back, observed rather than assumed ─────
//
// `supabase.rpc()` does not reject on a refusal. It RESOLVES, and `@supabase/
// postgrest-js` (v2.110.2, the copy installed at the repo root) builds the
// resolved value in `PostgrestBuilder`:
//
//   · the fetch never completed — offline, DNS, a captive portal, an abort —
//     and the `res.catch` at the bottom of `then()` returns
//     `{ error: { message, details, hint, code: '' }, status: 0 }`. Status
//     ZERO: no server ever spoke. This is the case the old code deleted on.
//   · the server answered non-2xx and the body parsed as JSON, so `error` is
//     PostgREST's own object — `{ code, details, hint, message }`, where `code`
//     is a PostgREST code or a Postgres SQLSTATE — and `status` is the HTTP
//     status it came with. The database has ruled on this request.
//   · the server answered non-2xx and the body did NOT parse, so
//     `processResponse` writes `error = { message: body }` with no `code` at
//     all. That is a proxy, a WAF or a gateway error page, not the database:
//     nothing about this referral was established.
//
// ── what today's `record_referral` can and cannot say ─────────────────────
//
// One correction to how this is usually described. The function
// (supabase/parts/128-a-cohort-and-a-credit.sql) returns void and raises
// nothing: a self-referral `return`s, an unknown code inserts a row with a null
// referrer, and a second code hits `on conflict do nothing`. Every one of those
// arrives here as SUCCESS, with a 204 and no error. So there is no such thing
// today as "the RPC refused this code" — the refusals the feature has are
// silent server-side decisions, and they are correctly treated as recorded:
// the question was asked, the server answered, and asking again changes
// nothing.
//
// `'refused'` is therefore about the OTHER kind of no: a 4xx carrying a
// SQLSTATE, which is what a future `record_referral` that raises 'this code has
// already been redeemed' would produce. The branch is written now because the
// alternative is a default that quietly retries such an answer for the life of
// the install.
//
// ── the direction of the default ─────────────────────────────────────────
//
// `'refused'` is an ALLOWLIST and everything unrecognised is `'unreached'`,
// which keeps the code. That asymmetry is the point, and it is the same one
// `./authReadFate` argues for:
//
//   · keeping a code that will never be recorded costs one RPC per sign-in and
//     one small string in AsyncStorage;
//   · clearing a code that could have been recorded costs a person their
//     referral permanently, with nothing anywhere that says it happened.
//
// A status nobody has thought of yet, and anything that is not a number at all,
// lands on the cheap side.

/**
 * What the attempt established.
 *
 * `'recorded'` — the request reached the server and the server dealt with it.
 * NOT "a row now exists": `record_referral` deliberately does nothing for a
 * self-referral or for a second code, and the phone cannot see which happened.
 * What it means is that the question has been asked and answered, so there is
 * nothing left to retry.
 *
 * `'refused'` — the database ruled on this request and said no, in a way that
 * will read identically on every future attempt.
 *
 * `'unreached'` — nothing was established. The request did not land, or what
 * came back was not the database speaking. The code must survive.
 *
 * `'not-asked'` — no call was made: there is no backend in this build, or there
 * was no code to record. Also not a reason to throw anything away.
 */
export type ReferralFate = 'recorded' | 'refused' | 'unreached' | 'not-asked';

/**
 * The shape this file reads, written structurally rather than imported.
 *
 * src/lib is shared by the three phone apps and the web console and is kept
 * free of their dependencies; a structural type is also what lets the test hand
 * in plain objects instead of standing up a PostgREST client to assert against
 * itself.
 */
export interface RpcResultLike {
  readonly status?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown } | null;
}

/**
 * Statuses where the server answered but the answer is not about this referral.
 *
 * 401 and 403 are here deliberately. A missing JWT, an expired one, or an RLS
 * refusal because a grant has not been applied yet are all states that a later
 * launch can be on the other side of — the flush runs right after a sign-in, so
 * the very next attempt has a fresh token. Treating them as a verdict on the
 * code would spend a referral on a token problem.
 */
const NOT_ABOUT_THIS_REFERRAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 408, 425, 429]);

/**
 * PostgREST codes that describe the deployment rather than the request.
 *
 * `PGRST202` is "no function matching that name and arguments in the schema
 * cache" — which is exactly what an app running ahead of its migration sees,
 * and that migration lands later. `PGRST301` is a JWT the gateway would not
 * accept. Both are retried, for the same reason as the statuses above.
 */
const NOT_ABOUT_THIS_REFERRAL_CODES: ReadonlySet<string> = new Set(['PGRST202', 'PGRST301']);

/**
 * Classify the resolved value of `supabase.rpc('record_referral', …)`.
 *
 * Pass the WHOLE result, not just `error`. A missing or malformed result is
 * `'unreached'` — never success — because "nothing came back to look at" is the
 * one thing that must not read as done.
 */
export function referralFate(res: RpcResultLike | null | undefined): ReferralFate {
  if (!res || typeof res !== 'object') return 'unreached';

  const status = typeof res.status === 'number' && Number.isFinite(res.status) ? res.status : null;
  const err = res.error;

  // Not "no error, therefore it worked". A 2xx as well, so that a shape this
  // file does not recognise cannot be read as success by omission.
  if (!err) return status !== null && status >= 200 && status < 300 ? 'recorded' : 'unreached';

  // status 0 is the dead fetch; 5xx and Cloudflare's 52x are the server failing
  // rather than answering. Neither establishes anything about this code.
  if (status === null || status < 400 || status >= 500) return 'unreached';
  if (NOT_ABOUT_THIS_REFERRAL_STATUSES.has(status)) return 'unreached';

  // No `code` means the body was not PostgREST's JSON — a gateway page, not the
  // database. See the header.
  const code = typeof err.code === 'string' ? err.code.trim() : '';
  if (!code) return 'unreached';
  if (NOT_ABOUT_THIS_REFERRAL_CODES.has(code)) return 'unreached';

  return 'refused';
}

/**
 * May the stashed code be cleared?
 *
 * True only where the question has been settled — asked and answered, or ruled
 * on. Everything else keeps it, so the next sign-in tries again. This is the
 * only thing `flushPendingReferral` is allowed to decide from.
 */
export function referralSettled(fate: ReferralFate): boolean {
  return fate === 'recorded' || fate === 'refused';
}
