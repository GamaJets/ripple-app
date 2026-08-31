// Changing your own password and your own email address.
// Compile with tsc, run with node.
//
// The claim being pinned hardest is the one about the EMAIL. Supabase's
// `updateUser({ email })` behaves in two completely different ways depending on
// a project setting the app cannot see: with confirmations on it sends a link
// and changes nothing yet; with them off — which is where Repple's project is
// until launch — it changes the address there and then. Both resolve without an
// error. So a screen that says "your email has been changed" on a resolved
// promise is right half the time and, the other half, has just told somebody
// their sign-in address is something it is not.
import {
  MIN_PASSWORD, authErrorNote, changeEmail, changePassword, classifyEmailChange,
  emailProblem, looksLikeEmail, passwordProblem, pendingEmail,
  type AuthLike, type AuthUserLike,
} from './accountSecurity';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the password form, before anything is sent ───────────────────────────── */

eq(passwordProblem('newpassword', 'newpassword', 'oldpassword'), null, 'a well-formed change goes through');

ok(passwordProblem('newpassword', 'newpassword', '') != null, 'the current password is required — see the note in the module');
ok(/current/i.test(String(passwordProblem('newpassword', 'newpassword', ''))), 'and is named as the thing that is missing');
ok(passwordProblem('', '', 'old') != null, 'an empty new password is refused here rather than at the server');
ok(passwordProblem('short12', 'short12', 'old') != null, `${MIN_PASSWORD - 1} characters is refused`);
eq(passwordProblem('exactly8', 'exactly8', 'old'), null, `and ${MIN_PASSWORD} exactly is accepted`);
ok(/8/.test(String(passwordProblem('short12', 'short12', 'old'))), 'the refusal says the number rather than "too short"');

// The mismatch the server can never catch: only one of the two boxes is sent.
ok(passwordProblem('newpassword', 'newpassw0rd', 'old') != null, 'two boxes that differ are caught in the app');
ok(/match/i.test(String(passwordProblem('newpassword', 'newpassw0rd', 'old'))), 'and told as a mismatch');

ok(passwordProblem('samepassword', 'samepassword', 'samepassword') != null,
  'setting the password you already have is refused — GoTrue rejects it anyway, with a worse sentence');
ok(passwordProblem('        ', '        ', 'old') != null, 'a password of only spaces is a typo, not a choice');
eq(passwordProblem(' has spaces ', ' has spaces ', 'old'), null,
  'but spaces INSIDE a password are real characters and are not trimmed away');

/* ── the email form ───────────────────────────────────────────────────────── */

ok(looksLikeEmail('a@b.co'), 'the shortest plausible address passes');
ok(looksLikeEmail('first.last+tag@sub.example.co.uk'), 'and so does one with a plus, dots and a subdomain');
ok(!looksLikeEmail('nobody'), 'a bare word is not an address');
ok(!looksLikeEmail('a@b'), 'a domain with no dot is not one either');
ok(!looksLikeEmail('a@@b.co'), 'two at-signs are not one');
ok(!looksLikeEmail('a b@c.co'), 'nor is an address with a space in it');
ok(!looksLikeEmail('@b.co'), 'nor one with nothing in front of the at-sign');
ok(!looksLikeEmail('a@.co'), 'nor a domain starting with a dot');
ok(!looksLikeEmail('a@b.'), 'nor one ending with one');

eq(emailProblem('new@example.com', 'old@example.com'), null, 'a genuine change is allowed');
ok(emailProblem('  ', 'old@example.com') != null, 'a blank field is refused');
ok(emailProblem('OLD@Example.COM', 'old@example.com') != null,
  'retyping the address you already have in different case is not a change');
ok(/already/i.test(String(emailProblem('old@example.com', 'old@example.com'))), 'and is named as such');
eq(emailProblem('new@example.com', null), null, 'an account with no address on file can still set one');

/* ── which of the two things actually happened ────────────────────────────── */

const user = (over: Partial<AuthUserLike>): AuthUserLike => ({ email: 'old@example.com', ...over });

eq(classifyEmailChange(user({ email: 'new@example.com' }), 'new@example.com'), 'changed',
  'the account now HAS the address — confirmations are off, and it really did change');
eq(classifyEmailChange(user({ new_email: 'new@example.com' }), 'new@example.com'), 'pending',
  'the account still has the old address and the new one is parked in new_email — nothing has changed yet');
eq(classifyEmailChange(user({}), 'new@example.com'), 'unknown',
  'neither — never reported as success, because "changed" here is what locks somebody out');
eq(classifyEmailChange(null, 'new@example.com'), 'unknown', 'and no user at all is unknown, not changed');
eq(classifyEmailChange(user({ email: 'NEW@Example.com' }), 'new@example.com'), 'changed',
  'GoTrue lower-cases addresses, so the comparison is case-insensitive');
eq(classifyEmailChange(user({ new_email: ' new@example.com ' }), 'new@example.com'), 'pending',
  'and tolerant of whitespace either side');

// Read on mount, so somebody who never clicked last week's link is shown why
// their address is not the one they typed.
eq(pendingEmail(user({ new_email: 'new@example.com' })), 'new@example.com', 'an outstanding change is surfaced');
eq(pendingEmail(user({})), null, 'no outstanding change is null');
eq(pendingEmail(user({ new_email: '' })), null, 'an empty new_email is not an outstanding change');
eq(pendingEmail(user({ email: 'a@b.co', new_email: 'a@b.co' })), null,
  'and new_email equal to the current address is a finished change, not a pending one');
eq(pendingEmail(null), null, 'no user, no pending change');

/* ── the sentences a member is shown when it fails ────────────────────────── */

// Every one of these must end with the member knowing that NOTHING changed.
ok(/nothing was changed/i.test(authErrorNote('Invalid login credentials', 'password')), 'a wrong current password says nothing changed');
ok(/current password/i.test(authErrorNote('Invalid login credentials', 'password')), 'and names what was wrong');
ok(/another account/i.test(authErrorNote('A user with this email address has already been registered', 'email')),
  '"already been registered" is translated — a member changing their OWN email has no idea that means somebody else has it');
ok(/wait a minute/i.test(authErrorNote('For security purposes, you can only request this after 54 seconds', 'email')),
  'a rate limit reads as "wait", not as a failure they should retry immediately');
ok(/not changed/i.test(authErrorNote('', 'password')), 'even an error with no message says nothing changed');
ok(/not changed/i.test(authErrorNote('boom', 'email')), 'and so does one nobody has a translation for');
ok(/boom/.test(authErrorNote('boom', 'email')), 'while still carrying the original, for the support email');

/* ── the calls, against a stub ────────────────────────────────────────────── */

const stub = (over: Partial<AuthLike> & { user?: AuthUserLike | null } = {}): AuthLike & { seen: string[] } => {
  const seen: string[] = [];
  return {
    seen,
    signInWithPassword: over.signInWithPassword ?? (async () => { seen.push('verify'); return { error: null }; }),
    updateUser: over.updateUser ?? (async () => { seen.push('update'); return { error: null }; }),
    getUser: over.getUser ?? (async () => { seen.push('read'); return { data: { user: over.user ?? null }, error: null }; }),
  };
};

(async () => {
  /* the current password is verified BEFORE the new one is set */
  const good = stub();
  const r1 = await changePassword(good, 'me@example.com', 'oldpassword', 'newpassword');
  ok(r1.ok, 'a verified change succeeds');
  eq(good.seen.join('>'), 'verify>update', 'and the verify happens first — the whole point of asking for it');

  const wrong = stub({ signInWithPassword: async () => ({ error: { message: 'Invalid login credentials' } }) });
  const r2 = await changePassword(wrong, 'me@example.com', 'notmypassword', 'newpassword');
  ok(!r2.ok, 'a wrong current password refuses the change');
  eq(!r2.ok ? r2.field : null, 'current', 'and points at the field that was wrong');
  eq(wrong.seen.includes('update'), false, 'CRUCIALLY, updateUser is never reached — an unlocked phone cannot reset the password');

  const rejected = stub({ updateUser: async () => ({ error: { message: 'New password should be at least 6 characters' } }) });
  const r3 = await changePassword(rejected, 'me@example.com', 'oldpassword', 'newpassword');
  ok(!r3.ok, 'a server-side refusal of the new password is a failure');
  ok(!r3.ok && /not changed/i.test(r3.note), 'and says nothing changed');

  const threw = stub({ signInWithPassword: async () => { throw new Error('offline'); } });
  const r4 = await changePassword(threw, 'me@example.com', 'oldpassword', 'newpassword');
  ok(!r4.ok, 'a thrown network error is a failure, not a silent success');

  /* the email: the outcome is READ BACK, never assumed from a resolved call */
  const confirmOff = stub({ user: { email: 'new@example.com' } });
  const e1 = await changeEmail(confirmOff, 'new@example.com');
  ok(e1.ok && e1.outcome === 'changed', 'with confirmations off the address really did change');
  eq(confirmOff.seen.join('>'), 'update>read', 'and the answer comes from a read of the server, not from the update resolving');

  const confirmOn = stub({ user: { email: 'old@example.com', new_email: 'new@example.com' } });
  const e2 = await changeEmail(confirmOn, 'new@example.com');
  ok(e2.ok && e2.outcome === 'pending',
    'with confirmations on the SAME resolved call means nothing has changed yet — this is the case that must not read as success');

  const trimmed = stub({ user: { email: 'old@example.com', new_email: 'new@example.com' } });
  const e2b = await changeEmail(trimmed, '  new@example.com  ');
  ok(e2b.ok && e2b.outcome === 'pending' && e2b.requested === 'new@example.com',
    'the requested address is trimmed before it is compared, and reported trimmed');

  const unreadable = stub({ getUser: async () => ({ data: null, error: { message: 'offline' } }) });
  const e3 = await changeEmail(unreadable, 'new@example.com');
  ok(e3.ok && e3.outcome === 'unknown', 'a request that landed but could not be read back is "unknown" — not changed, not failed');

  const taken = stub({ updateUser: async () => ({ error: { message: 'A user with this email address has already been registered' } }) });
  const e4 = await changeEmail(taken, 'taken@example.com');
  ok(!e4.ok, 'an address somebody else holds is a failure');
  ok(!e4.ok && /another account/i.test(e4.note), 'explained in words a member can act on');
  eq(taken.seen.includes('read'), false, 'and no pointless read-back after a refusal');

  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`accountSecurity: ok (current password verified before the new one is set, email outcome read back not assumed, min ${MIN_PASSWORD})`);
})();
