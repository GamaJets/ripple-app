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

// A ceiling on every request this console sends.
//
// `src/lib/requestTimeout.ts` is the product's one answer to a socket that is
// accepted and then answers nothing, and its header carries the argument for
// both numbers — thirty seconds for a call, two minutes for a transfer, the
// second set by Supabase's own 150-second edge-function limit. It was written
// for the phone. Nothing about it is a phone: the wrapper is structurally typed
// over `fetch`, and the condition it closes is worse here than there.
//
// ── What a hung request does to THIS console ──────────────────────────────
//
// Not "shows an error late". The three-state discipline every screen here is
// built on collapses to one state, permanently:
//
//   · `components/Gate.tsx` renders "Reading your account…" and stays. Its
//     unreadable branch — the one with the Try Again button and the sentence
//     saying this is not you being signed out — is reached only when `loadMe`
//     REJECTS, and a hung fetch never rejects.
//   · `components/Fetched.tsx` sets `running.current = true` before awaiting
//     and clears it in a `finally` that never runs, so "Read again" disables
//     itself for good. The one control on the page for getting out of this is
//     the one the condition takes away.
//   · every `Read<T>` sits at 'loading', which `Unresolved` draws as
//     "Loading…" — the sentence this console's whole discipline exists to keep
//     distinct from "empty" and from "refused".
//
// A front desk on gym wifi behind a captive portal gets that, with nothing to
// press, and reloads the tab — which `Fetched`'s own header says nobody does
// because it discards a half-typed form.
//
// ── Why the wrapper rather than a second one ──────────────────────────────
//
// Because two ceilings in one product is two numbers to disagree, which is the
// case `scripts/check-sql-caps.mjs` argues at length about a different pair.
// This console shares the database, the row-level policies and every figure
// with the phone; it should not give up at a different moment.
//
// One thing it does NOT close, and it is worth writing down: a WRITE that timed
// out may have committed and had only its reply lost. The screens here worded a
// thrown write as "was NOT closed", "Nothing was taken back", "the original
// still stands in full" — which is true of a refusal and is a claim this
// console cannot make about a request nobody answered. `retryOnTimeout` already
// refuses to resend one for exactly that reason.
//
// The wording has now caught up, and it is `writeFailed` at the bottom of this
// file: three states rather than two, with the ambiguous one asserting nothing
// about the database and saying instead how to find out. It lives here because
// this is the file that introduced the ambiguity — the ceiling above is what
// made a throw mean something new — and because the `online` half of the
// evidence is a browser fact that src/lib is not allowed to know.
import { withRequestTimeout } from '@lib/requestTimeout';
import { failedWriteNote, writeFate, mayRetryWrite, type WriteSubject } from '@lib/failedWrite';
import { refused, type Said } from '@lib/consoleSay';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  // Realtime is a WebSocket and is untouched by this. Every read, every write
  // and every storage upload this console makes goes through here. Wrapped in
  // an arrow rather than passed as a bare `fetch` so the global keeps its own
  // receiver — an unbound `fetch` throws "Illegal invocation" in a browser.
  global: { fetch: withRequestTimeout((input, init) => fetch(input, init)) },
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


/* ── what a failed write may honestly be said to have done ─────────────────
 *
 * See the note beside `withRequestTimeout` above, and src/lib/failedWrite.ts
 * for the argument in full. Three states:
 *
 *   REFUSED      the database read it and declined. Nothing happened.
 *   UNREACHABLE  this browser was offline. Nothing was sent.
 *   UNANSWERED   it went out and nothing came back. WE DO NOT KNOW — it may be
 *                in the database with only the reply lost.
 *
 * Every screen that words a thrown write goes through here, so the sentence
 * cannot drift back to fourteen versions of "Nothing was saved".
 */

export type { WriteSubject };

/**
 * Whether this browser believes it has a connection.
 *
 * The ONLY positive evidence that a request never left, and the reason this
 * wrapper exists rather than the screens calling `failedWriteNote` directly.
 * `navigator.onLine` is famously weak — it is true behind a captive portal —
 * but it is only ever consulted to move an answer TOWARDS "nothing was sent",
 * and the direction it is weak in is the harmless one: a portal that swallows
 * the request leaves `onLine` true, so the fate stays 'unanswered' and the
 * screen says it does not know. Null where it cannot be asked at all, which is
 * every server render.
 */
function deviceOnline(): boolean | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const v = (navigator as { onLine?: boolean }).onLine;
    return typeof v === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Whether a plain "try again" may be offered after this failure.
 *
 * False for the ambiguous one — a retry control beside "we do not know whether
 * that went through" is an invitation to create the duplicate the sentence has
 * just warned about, which is the same judgement `retryOnTimeout` makes about
 * resending a write automatically.
 */
export function mayRetryAfter(err: unknown): boolean {
  return mayRetryWrite(writeFate(err, { online: deviceOnline() }));
}

/**
 * The `Said` a console form sets after a write threw.
 *
 * Always `refused`, in `consoleSay`'s sense — the tone is about whether the
 * thing the person wanted has demonstrably happened, and in none of the three
 * states has it. `crit` is right for the ambiguous one too: "we do not know
 * whether that payment went through" is exactly the sentence that must not wait
 * politely behind a screen reader's queue.
 */
export function writeFailed(err: unknown, subject: WriteSubject): Said {
  return refused(failedWriteNote(err, subject, { online: deviceOnline() }));
}

/**
 * The same sentence as a bare string, for the screens that hold their error in
 * a `useState<string | null>` rather than a `Said`.
 *
 * Two entry points rather than one wrapped in the other at every call site,
 * because half this console predates `consoleSay` and converting those forms is
 * a separate change from telling the truth about a timed-out write. Both go
 * through `failedWriteNote`, so the wording cannot differ between them.
 */
export function writeFailedText(err: unknown, subject: WriteSubject): string {
  return failedWriteNote(err, subject, { online: deviceOnline() });
}
