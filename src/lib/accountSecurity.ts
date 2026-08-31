// ── Changing the password, and changing the email, on your own account ──────
//
// app/(client)/settings.tsx offered a member exactly two things they could do
// to their account: sign out, and delete it. Supabase auth has supported both
// of the obvious middle options since the beginning (`updateUser`); nothing in
// the app reached them, so the only way a member could change a password they
// had reason to distrust was to trigger a "forgotten password" email for a
// password they had not forgotten.
//
// ── The rule about the password ────────────────────────────────────────────
//
// The only thing this module ever does with a password is hand it to Supabase.
// It is not logged, not stored, not put in a module-level variable, and not
// included in any error this file constructs — a reportError() with the
// argument list attached is how a plaintext password ends up in `app_errors`
// for ever. The functions take it as a parameter and it dies with the call.
//
// ── Why the current password is asked for ──────────────────────────────────
//
// `supabase.auth.updateUser({ password })` does not require it. Any live
// session can set a new password, which means an unlocked, unattended phone is
// enough to lock the owner out of their own account permanently — the attacker
// sets a password, and the recovery email goes to an address they can change
// two functions further down this file. So the current password is verified
// first, and it is verified the only way a client can verify it: by signing in
// with it. That call returns a session for the same user, so nothing about who
// is signed in changes.
//
// ── The rule about the email ───────────────────────────────────────────────
//
// A change of address is a REQUEST, not a fact. With Supabase's email
// confirmations on, `updateUser({ email })` sends a confirmation and the
// account keeps its old address until somebody clicks the link — the new one
// sits in `user.new_email`. Telling the member "your email has been changed"
// at that moment is wrong in the way that matters: they will sign in tomorrow
// with the new address, fail, and have no idea why.
//
// It is not a fact in the other direction either. Repple's Supabase project
// currently has email confirmation switched OFF until launch (a deliberate,
// temporary setting), and with it off the address changes IMMEDIATELY and
// there is no `new_email` and no email at all. So the app cannot assume either
// outcome from the setting — it has to read back which one happened. That is
// what `classifyEmailChange` is for, and why the screen re-reads the user from
// the server instead of trusting the object `updateUser` handed back.

/** The slice of `supabase.auth` this module uses. Narrow on purpose: it keeps
 *  the rules testable without a network, and it is a short list of exactly the
 *  auth surface a member may point at their own account. */
export interface AuthLike {
  signInWithPassword(c: { email: string; password: string }): Promise<{ error: { message: string } | null }>;
  updateUser(a: { password?: string; email?: string }): Promise<{ error: { message: string } | null }>;
  getUser(): Promise<{ data: { user: AuthUserLike | null } | null; error: { message: string } | null }>;
}

/** What GoTrue returns for the signed-in user, as far as this file cares. */
export interface AuthUserLike {
  email?: string | null;
  /** Set while a confirmed address change is outstanding. */
  new_email?: string | null;
}

/* ── pure rules ───────────────────────────────────────────────────────────── */

/** Supabase's own floor is 6. Eight, because this is the credential that
 *  protects somebody's health data and the app has no other factor. */
export const MIN_PASSWORD = 8;

/**
 * Why this password cannot be set, or null when it can.
 *
 * Checked here rather than left to the server so the member is told before the
 * round trip, and so "the two boxes do not match" — which the server cannot
 * see at all, since only one of them is ever sent — is caught.
 */
export function passwordProblem(next: string, confirm: string, current: string): string | null {
  if (!current) return 'Enter your current password.';
  if (!next) return 'Enter a new password.';
  if (next.length < MIN_PASSWORD) return `A new password needs at least ${MIN_PASSWORD} characters.`;
  // Leading and trailing spaces are real characters in a password and are kept.
  // A password that is nothing but spaces is a typo, not a choice.
  if (!next.trim()) return 'A password of only spaces is not a password.';
  if (next === current) return 'That is the password you already have.';
  if (next !== confirm) return 'The two new passwords do not match.';
  return null;
}

/**
 * A deliberately loose address check: exactly one @, something either side, a
 * dot in the domain, no spaces.
 *
 * Not a full RFC 5322 parser and not trying to be. The address is verified by
 * whether mail arrives at it, and an over-strict regex that refuses a valid
 * address is worse than a loose one that lets the server say no — this is the
 * field that decides whether somebody can get back into their account.
 */
export function looksLikeEmail(v: string): boolean {
  const s = v.trim();
  if (/\s/.test(s)) return false;
  const at = s.split('@');
  if (at.length !== 2) return false;
  const [local, domain] = at;
  if (!local || !domain) return false;
  return /^[^.]+(\.[^.]+)*$/.test(domain) && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/** Why this address cannot be set, or null when it can. */
export function emailProblem(next: string, current: string | null | undefined): string | null {
  const s = next.trim();
  if (!s) return 'Enter the new email address.';
  if (!looksLikeEmail(s)) return "That does not look like an email address.";
  if (s.toLowerCase() === (current || '').trim().toLowerCase()) return 'That is the address already on your account.';
  return null;
}

/** Addresses are compared case-insensitively and trimmed; they are stored
 *  lower-cased by GoTrue, and a member who types theirs with a capital has not
 *  asked for a different address. */
const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

/**
 * What actually happened to the address, read off the user as the server has
 * it AFTER the update.
 *
 * · 'pending'  — the account still has the old address and `new_email` holds
 *                the requested one. A confirmation is out. Nothing has changed
 *                yet, and the screen must say so in those words.
 * · 'changed'  — the account's address IS the requested one. This is what
 *                happens with email confirmation switched off.
 * · 'unknown'  — neither. The request may have landed and the read may simply
 *                be stale, so this is never reported as a failure OR as a
 *                success; the screen tells them to check both inboxes and
 *                re-reads. Saying "changed" here is the lie that locks
 *                somebody out.
 */
export type EmailChange = 'pending' | 'changed' | 'unknown';

export function classifyEmailChange(user: AuthUserLike | null | undefined, requested: string): EmailChange {
  if (!user) return 'unknown';
  if (sameAddress(user.email, requested)) return 'changed';
  if (sameAddress(user.new_email, requested)) return 'pending';
  return 'unknown';
}

/**
 * The address a confirmation is outstanding for, or null.
 *
 * Read on mount so a member who requested a change last week and never clicked
 * the link is shown that, rather than an ordinary form that gives no hint why
 * the address they typed is not the one on the account.
 */
export function pendingEmail(user: AuthUserLike | null | undefined): string | null {
  const n = (user?.new_email || '').trim();
  if (!n) return null;
  return sameAddress(n, user?.email) ? null : n;
}

/**
 * Turn a GoTrue error into something a member can act on.
 *
 * The raw strings are written for developers ("New password should be at least
 * 6 characters", "A user with this email address has already been registered")
 * and two of them are actively misleading on this screen — a member changing
 * their own email who is told a user "has already been registered" has no idea
 * that means "somebody else has that address".
 */
export function authErrorNote(message: string | null | undefined, what: 'password' | 'email'): string {
  const m = (message || '').toLowerCase();
  if (!m) return what === 'password' ? 'Your password was not changed.' : 'Your email address was not changed.';
  if (m.includes('already been registered') || m.includes('already registered') || m.includes('already exists')) {
    return 'Another account already uses that address. Your email address was not changed.';
  }
  if (m.includes('same password') || m.includes('should be different')) {
    return 'That is the password you already have, so nothing was changed.';
  }
  if (m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) {
    return 'Too many attempts just now. Wait a minute and try again — nothing was changed.';
  }
  if (m.includes('invalid login') || m.includes('invalid credentials')) {
    return 'That is not your current password, so nothing was changed.';
  }
  if (m.includes('weak') || m.includes('at least')) {
    return `${message} Your password was not changed.`;
  }
  return what === 'password'
    ? `Your password was not changed. (${message})`
    : `Your email address was not changed. (${message})`;
}

/* ── the calls ────────────────────────────────────────────────────────────── */

export type PasswordResult =
  | { ok: true }
  | { ok: false; note: string; field: 'current' | 'new' | 'other' };

/**
 * Verify the current password, then set the new one.
 *
 * Both arguments go straight to Supabase and nowhere else. The failure branches
 * carry a sentence, never the value.
 */
export async function changePassword(
  auth: AuthLike, email: string, current: string, next: string,
): Promise<PasswordResult> {
  try {
    const { error: signInErr } = await auth.signInWithPassword({ email, password: current });
    if (signInErr) {
      return { ok: false, field: 'current', note: authErrorNote(signInErr.message, 'password') };
    }
    const { error } = await auth.updateUser({ password: next });
    if (error) return { ok: false, field: 'new', note: authErrorNote(error.message, 'password') };
    return { ok: true };
  } catch (e) {
    // Deliberately not reporting the exception object anywhere it could be
    // serialised with the call's arguments still attached to it.
    return { ok: false, field: 'other', note: `Your password was not changed. (${(e as Error).message})` };
  }
}

export type EmailResult =
  | { ok: true; outcome: EmailChange; requested: string }
  | { ok: false; note: string };

/**
 * Ask for the account's address to be changed, then read back what happened.
 *
 * The re-read is the point. `updateUser` resolving without an error means the
 * REQUEST was accepted, which under confirmation is not the same as the address
 * having changed — and the app cannot infer which regime it is running under,
 * because that is a project setting that will change at launch. So the answer
 * comes from the server's own copy of the user.
 */
export async function changeEmail(auth: AuthLike, next: string): Promise<EmailResult> {
  const requested = next.trim();
  try {
    const { error } = await auth.updateUser({ email: requested });
    if (error) return { ok: false, note: authErrorNote(error.message, 'email') };
    const { data, error: readErr } = await auth.getUser();
    // The request went in; we just cannot say yet which of the two things it
    // did. 'unknown' is an honest answer and the screen has a sentence for it.
    if (readErr) return { ok: true, outcome: 'unknown', requested };
    return { ok: true, outcome: classifyEmailChange(data?.user ?? null, requested), requested };
  } catch (e) {
    return { ok: false, note: `Your email address was not changed. (${(e as Error).message})` };
  }
}
