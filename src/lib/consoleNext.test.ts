// Where sign-in sends you back to. Compile with tsc, run with node.
//
// Two things are held here and only one of them is about convenience:
//
//   1. The screen you asked for survives the sign-in, which is what
//      `ConsoleGate` has been promising in prose while linking to a bare `/`.
//   2. NOTHING ELSE survives it. `?next=` is written by whoever wrote the link,
//      so every shape that leaves this origin — a full URL, a scheme, a
//      protocol-relative `//host`, the backslash spelling of the same — is
//      refused rather than parsed. An open redirect out of a console people
//      have just typed a password into is the expensive version of this bug.
import { safeNext, signInHref, nextFromSearch, MAX_NEXT } from './consoleNext';

// The suite is a failure until it reaches the end, so a throw or an early exit
// cannot leave a zero status behind and pass silently.
process.exitCode = 1;

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the destinations this console actually has ────────────────────────── */

{
  eq(safeNext('/money'), '/money', 'a console route');
  eq(safeNext('/coach/earnings'), '/coach/earnings', 'a nested one');
  eq(safeNext('/members?member=0f8c4a2e-1b7d-4c3a-9f11-2ab4c6d8e900'), '/members?member=0f8c4a2e-1b7d-4c3a-9f11-2ab4c6d8e900',
    'the deep link /retention writes — the one a person cannot retype from memory');
  eq(safeNext('/close?month=2026-08'), '/close?month=2026-08', 'a month, carried');
}

/* ── the ones that leave this origin ───────────────────────────────────── */

{
  eq(safeNext('https://not-repple.example/sign-in'), null, 'a full URL is not a path on this console');
  eq(safeNext('http://localhost:3100/money'), null, 'nor is one that happens to name this console: it is still a URL');
  eq(safeNext('//not-repple.example'), null, 'protocol-relative: starts with a slash and is a full cross-origin jump — the one a naive check admits');
  eq(safeNext('/\\not-repple.example'), null, 'the backslash spelling of the same jump');
  eq(safeNext('javascript:alert(1)'), null, 'a scheme is not a path');
  eq(safeNext('data:text/html,x'), null, 'nor is this one');
  eq(safeNext('money'), null, 'a relative path has no leading slash and is refused rather than guessed at');
}

/* ── the ones that are not destinations at all ─────────────────────────── */

{
  eq(safeNext(null), null, 'nothing asked for');
  eq(safeNext(undefined), null, 'nothing asked for, spelled the other way');
  eq(safeNext(''), null, 'an empty parameter');
  eq(safeNext('   '), null, 'whitespace is not a route');
  eq(safeNext('/'), null, 'the Overview is where sign-in lands anyway — carrying it would navigate to the page you are on');
  eq(safeNext(`/${'a'.repeat(MAX_NEXT)}`), null, 'past the cap');
  eq(safeNext(`/${'a'.repeat(MAX_NEXT - 1)}`), `/${'a'.repeat(MAX_NEXT - 1)}`, 'and exactly at it, so the cap is a cap and not an off-by-one');
  eq(safeNext('/money\nSet-Cookie: x'), null, 'a newline in a value that goes into an href');
  eq(safeNext('/money page'), null, 'a space');
}

/* ── the link the gate draws ───────────────────────────────────────────── */

{
  eq(signInHref('/payroll'), '/?next=%2Fpayroll', 'the destination is encoded, so a query in it cannot become a query of the sign-in page');
  eq(signInHref('/members?member=abc'), '/?next=%2Fmembers%3Fmember%3Dabc', 'the whole path and query, as one parameter');
  eq(signInHref('/'), '/', 'no parameter from the page sign-in is already on');
  eq(signInHref(null), '/', 'and none when there is nothing to carry');
  eq(signInHref('https://not-repple.example'), '/', 'a destination that will not be vouched for degrades to the bare link the gate had before, not to an error');
}

/* ── reading it back on the sign-in page ───────────────────────────────── */

{
  eq(nextFromSearch('?next=%2Fpayroll'), '/payroll', 'round trip');
  eq(nextFromSearch(signInHref('/members?member=abc').slice(1)), '/members?member=abc',
    'a query with its own = and ? in the value survives being written and read back');
  eq(nextFromSearch('?other=1'), null, 'a query with no next in it');
  eq(nextFromSearch(''), null, 'no query at all');
  eq(nextFromSearch(null), null, 'nor a null one');
  eq(nextFromSearch('?next=%2F%2Fnot-repple.example'), null,
    'the encoded protocol-relative jump: URLSearchParams decodes it and safeNext then sees what the browser would see');
  eq(nextFromSearch('?next=https%3A%2F%2Fnot-repple.example'), null, 'and the encoded full URL');
}

if (errors.length) {
  console.error(`consoleNext: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
process.exitCode = 0;
console.log('consoleNext: ok');
