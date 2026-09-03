// The same Supabase project the phone apps use, reached from the browser.
//
// There is no second permission model here. Every table already carries
// row-level policies, and the anon key grants nothing on its own — what a
// signed-in person can read is decided in the database, by the same policies
// that govern the apps. That is the whole reason the web console can be built
// against this project directly rather than through a bespoke API.
import { createClient } from '@supabase/supabase-js';
// The union is imported rather than written out as `'kg' | 'lb'`, so this file
// cannot drift from the CHECK constraint on the column, and so the two unit
// literals never appear here at all — which is what the unit rule in
// scripts/check-currency.mjs is looking for and would otherwise have had to be
// argued with.
import type { WeightUnit } from '@lib/units';
// A request that is never going to answer, given up on rather than waited for.
// The rule, the two sentences and the timer live in one tested module because
// the phone app has exactly the same hole and this is the half of the fix that
// is not a browser type.
import { changesThings, deadlineMsFor, withDeadline, type BodyKind } from '@lib/deadline';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail loudly at import rather than producing a client that 401s on every
  // call and looks like an auth bug.
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy them from the repo root .env (the EXPO_PUBLIC_ equivalents) into studio-web/.env.local.',
  );
}

/**
 * What sort of body a request is carrying, in the three terms the deadline
 * rule is written in.
 *
 * A string is JSON — every write this console makes. A Blob, a File, a
 * FormData, a stream or a raw buffer is an upload, and `/compliance` sends a
 * gym document through this same client. Anything unrecognised is treated as
 * JSON rather than as an upload: erring the other way would hand a request
 * three minutes of silence at a front desk.
 */
function bodyKind(body: BodyInit | null | undefined): BodyKind {
  if (body == null) return 'none';
  if (typeof body === 'string') return 'text';
  if (typeof Blob !== 'undefined' && body instanceof Blob) return 'file';
  if (typeof FormData !== 'undefined' && body instanceof FormData) return 'file';
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return 'file';
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return 'file';
  return 'text';
}

/**
 * `fetch`, with a deadline on it.
 *
 * ── Why this is here and not at each call site ────────────────────────────
 *
 * Because the condition is not a property of any call site. A captive portal at
 * a front desk accepts the socket, completes the handshake and then answers
 * nothing, and every request made through this client behaves identically: the
 * promise never settles, in either direction. There are some three hundred
 * awaits across thirty-five routes and none of them is wrong; the fetch under
 * all of them is what has no deadline. See src/lib/deadline.ts for what each
 * screen does today when one of these hangs — the short version is that
 * `Fetched`'s "Read again" button disables itself permanently, because the
 * `finally` that clears its `running` flag never runs.
 *
 * ── What a caller sees ────────────────────────────────────────────────────
 *
 * A rejection, which is what every screen here is already built for: supabase-js
 * turns a fetch rejection into a thrown error on `.then`, and a thrown read is
 * `landed()`'s 'failed' arm, the banner, and the retry. Nothing downstream needs
 * to know this exists.
 *
 * ── The caller's own signal is kept ───────────────────────────────────────
 *
 * PostgREST's `.abortSignal()` passes one through `init`, and dropping it would
 * silently break every caller that cancels. Both signals abort the one request,
 * and the listener is removed on settle so a long-lived signal does not
 * accumulate one per query.
 */
const timedFetch: typeof fetch = (input, init) => {
  const method = init?.method
    ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET');
  const wrote = changesThings(method);
  const ms = deadlineMsFor(bodyKind(init?.body));

  const ac = new AbortController();
  const caller = init?.signal ?? null;
  // Already cancelled before we started: pass it straight through rather than
  // arming a timer for a request that is not going to be made.
  if (caller?.aborted) return fetch(input, init);
  const onCallerAbort = () => ac.abort(caller?.reason);
  caller?.addEventListener('abort', onCallerAbort, { once: true });

  const work = fetch(input, { ...init, signal: ac.signal });
  return withDeadline(work, ms, wrote, () => ac.abort())
    .finally(() => caller?.removeEventListener('abort', onCallerAbort));
};

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  // Realtime is a WebSocket and is untouched by this; every read, every write
  // and every storage upload this console makes goes through here.
  global: { fetch: timedFetch },
});

export type Role = 'client' | 'trainer' | 'owner';

export interface Me {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role | null;
  tenantId: string | null;
  /**
   * The unit THIS ACCOUNT reads weights in, or null because nobody has asked
   * it. `profiles.weight_unit` exists for exactly this — its schema comment
   * says "the unit this ACCOUNT reads weights in, whatever its role. Null means
   * never chosen." — and it is nullable for the same reason `tenants.currency`
   * is: a default that renders cleanly looks considered, so nobody goes and
   * fixes the setting.
   *
   * Read here rather than in a second query because this screen is already
   * selecting the profile row, and a preference nobody pays for is a preference
   * screens will actually use. See lib/units.ts for what is done with a null.
   */
  weightUnit: WeightUnit | null;
  /**
   * True when the profile could not be READ, as opposed to not existing.
   *
   * These two collapsed into `role: null` and every screen took the same
   * branch, so an RLS hiccup told the actual gym owner "Not your console —
   * you are signed in without a role". A refused read is not a statement
   * about who somebody is.
   */
  roleUnknown: boolean;
}

/**
 * "We could not tell." The fourth answer, and the one that was missing.
 *
 * `loadMe` opens with `supabase.auth.getUser()`, a NETWORK call. It rejects on
 * a dropped connection, and thirty of the console's thirty-one callers awaited
 * it inside an async IIFE with no `try` around it: the IIFE rejected unhandled,
 * `setMe` never ran, `me` stayed `undefined` for ever, and twenty-nine routes
 * sat on the word "Loading…" in a bare `<div>` — no rail, no gym name, no
 * heading, nothing announced and nothing to press. A front desk on a dropping
 * connection got nine characters and no way to tell whether the gym was down,
 * they were signed out, or the tab was broken.
 *
 * Reported as a value rather than left as a rejection, and NOT collapsed into
 * `null`. Null means "nobody is signed in", which is a statement about the
 * person; this means "the question could not be asked", which is a statement
 * about the connection. Telling somebody they are signed out because a request
 * timed out sends them to re-enter a password that was never the problem —
 * exactly the substitution `roleUnknown` was added to this file to stop one
 * layer down.
 */
export const ME_UNREADABLE = 'unreadable' as const;

/** What `loadMe` can answer: a person, nobody, or "we could not tell". */
export type MeRead = Me | null | typeof ME_UNREADABLE;

/** Who is signed in, and what the database says they are. */
export async function loadMe(): Promise<MeRead> {
  let user: { id: string; email?: string | null } | null | undefined;
  try {
    const { data: auth } = await supabase.auth.getUser();
    user = auth?.user;
  } catch {
    // The one thing that must not happen here is a silent `null`. See
    // ME_UNREADABLE above: signed out and unreachable are different facts and
    // they send a person to two different places.
    return ME_UNREADABLE;
  }
  if (!user) return null;

  let data: any;
  let error: unknown;
  try {
    // The profile read handles its own `error` below — supabase-js resolves on
    // a database refusal — but it is a second network call and it can reject
    // for the same reason the first one can.
    ({ data, error } = await supabase
      .from('profiles')
      .select('full_name, role, tenant_id, weight_unit')
      .eq('id', user.id)
      .single());
  } catch {
    // Here we DO know who they are, so this is not ME_UNREADABLE: it is the
    // state this function already had a name for. Every screen renders "We
    // could not read your account" for it, which is the true sentence.
    return {
      id: user.id,
      email: user.email ?? null,
      fullName: null,
      role: null,
      tenantId: null,
      weightUnit: null,
      roleUnknown: true,
    };
  }

  // Three outcomes, not two.
  //
  // A missing profile row is not being signed out: the person has an account
  // but no profile yet, and PostgREST says so with PGRST116 from .single().
  // Any OTHER error means the read failed and we do not know what they are —
  // which must not be reported as "no role", because every screen refuses a
  // roleless visitor by name.
  if (error) {
    const noRow = (error as { code?: string }).code === 'PGRST116';
    return {
      id: user.id,
      email: user.email ?? null,
      fullName: null,
      role: null,
      tenantId: null,
      weightUnit: null,
      roleUnknown: !noRow,
    };
  }

  // Anything other than the two the column's own CHECK constraint permits is
  // treated as never-chosen rather than passed through. A stray value would
  // otherwise reach `weightLabel` and be printed as a unit somebody invented,
  // which is the whole failure this preference exists to end.
  const wu = data?.weight_unit;
  return {
    id: user.id,
    email: user.email ?? null,
    fullName: data?.full_name ?? null,
    role: (data?.role as Role) ?? null,
    tenantId: data?.tenant_id ?? null,
    weightUnit: wu === 'kg' || wu === 'lb' ? wu : null,
    roleUnknown: false,
  };
}

