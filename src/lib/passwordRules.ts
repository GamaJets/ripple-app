// What Supabase will actually accept, said before somebody is rejected for it.
//
// The apps promised "min 6 characters" in three places. The project enforces
// something quite different, established by probing the signup endpoint rather
// than by reading one error message:
//
//     Aa1!aa    → "Password should be at least 8 characters."
//     aaaaaaaa  → "…at least one character of each: <lower> <upper> <digit> <symbol>"
//     Aa1!aa    → "…known to be weak and easy to guess"      (breach check, server-side)
//
// So the stated rule was wrong about the length and silent about everything
// else. A tester reads "min 6", types six characters, and is refused — and only
// then learns the first of three further rules, one at a time. Two of the
// testers who could not get in this week were on the password screens.
//
// These functions state the local rules up front. They deliberately do NOT
// promise acceptance: the breach check runs on Supabase's side against a
// corpus this app has no copy of, so a password can satisfy everything here
// and still be refused. The screens say "should be accepted", never "is valid".

/** Minimum length Supabase enforces. Probed, not assumed. */
export const PASSWORD_MIN = 8;

export interface PasswordRule {
  /** Shown to the user, phrased as the thing to do. */
  label: string;
  met: boolean;
}

/**
 * Every local rule and whether this password meets it, in a fixed order so the
 * list on screen never reorders itself as somebody types.
 */
export function passwordRules(pw: string): PasswordRule[] {
  const p = pw || '';
  return [
    { label: `${PASSWORD_MIN} characters or more`, met: p.length >= PASSWORD_MIN },
    { label: 'a lowercase letter',                 met: /[a-z]/.test(p) },
    { label: 'an uppercase letter',                met: /[A-Z]/.test(p) },
    { label: 'a number',                           met: /[0-9]/.test(p) },
    // Supabase's symbol set, verbatim from its own refusal message.
    { label: 'a symbol (! ? @ # $ … )',            met: /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/.test(p) },
  ];
}

/** Whether every rule this app can check is satisfied. Not a promise of acceptance. */
export function passwordMeetsLocalRules(pw: string): boolean {
  return passwordRules(pw).every((r) => r.met);
}

/** How many rules are still unmet — for a compact "3 to go" affordance. */
export function passwordRulesRemaining(pw: string): number {
  return passwordRules(pw).filter((r) => !r.met).length;
}

/**
 * The server refused a password. Turn its message into something a person can
 * act on without re-reading a character-class dump.
 *
 * The breach refusal is the one worth rewriting: "known to be weak and easy to
 * guess" sounds like a judgement of the person. It means the exact string has
 * appeared in a public breach corpus, which is a fact about the string.
 */
export function passwordErrorMessage(raw: string | null | undefined): string {
  const m = (raw || '').toLowerCase();
  if (m.includes('known to be weak') || m.includes('pwned') || m.includes('easy to guess')) {
    return 'That exact password has appeared in a public data breach, so it cannot be used here. Any other password of the same length is fine.';
  }
  if (m.includes('at least') && m.includes('characters')) {
    return `Passwords need to be at least ${PASSWORD_MIN} characters.`;
  }
  if (m.includes('at least one character of each')) {
    return 'Passwords need a lowercase letter, an uppercase letter, a number and a symbol.';
  }
  return raw?.trim() || 'That password was not accepted.';
}
