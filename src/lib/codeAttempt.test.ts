// A single-use code, and the lift the phone was in when it was spent.
//
// The assertion this file exists for is the third one down: an RPC that never
// reached a server must not settle the question, because `settled` is what a
// caller clears a stashed code on — and a code cleared on an unreachable server
// is gone for good, with nobody credited and nothing left to retry from.
//
// The second thing being asserted is the sentence. `joinByCode` used to hand
// the server's own words to somebody whose request never left the handset:
// "TypeError: Network request failed Nothing was sent.", under a dialog titled
// "That code didn't work". Only the refusal path may quote the server, and
// these assertions are what hold that line.
//
// Written against the shapes `@supabase/postgrest-js` v2.110.2 actually
// resolves with — the same three this repo's src/lib/referralFate.test.ts
// describes, because this module is a sentence over that module's verdict and
// must not be a second copy of it.
import { CODE_REFUSED_MESSAGE, CODE_UNREACHED_MESSAGE, codeAttempt } from './codeAttempt';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** What the caller would say if the database had ruled. Distinctive, so an
 *  assertion can tell it from anything this module composes itself. */
const REFUSAL = 'No coach is using that code. Check it with them.';

/** The resolved value for a request that never completed: `PostgrestBuilder`'s
 *  `res.catch` at the bottom of `then()`. Status zero, and an empty `code`. */
const deadFetch = () => ({
  status: 0,
  error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' },
});

/** A non-2xx whose body parsed as PostgREST JSON: the database ruling. */
const ruled = (status: number, code: string, message = 'no coach uses that code') =>
  ({ status, error: { code, details: null, hint: null, message } });

/** A non-2xx whose body did not parse — `processResponse` writes `{ message }`
 *  and nothing else. A gateway page, not the database. */
const gatewayPage = (status: number) => ({ status, error: { message: '<html>502 Bad Gateway</html>' } });

/* ── it worked ────────────────────────────────────────────────────────────── */

// `join_by_code` RETURNS TABLE and `accept_invite` returns void; PostgREST
// answers 200 and 204 respectively, with no error either way.
eq(codeAttempt({ status: 200, error: null }, REFUSAL).fate, 'recorded', 'a 200 with no error is a success');
eq(codeAttempt({ status: 204, error: null }, REFUSAL).fate, 'recorded', 'and so is a 204 from a void function');
eq(codeAttempt({ status: 204, error: null }, REFUSAL).message, null,
  'there is nothing to say to somebody whose code worked');
eq(codeAttempt({ status: 204, error: null }, REFUSAL).settled, true, 'and the question is settled');
eq(codeAttempt({ status: 204, error: null }, REFUSAL).unreached, false, 'a server that answered was reached');

/* ── THE ONE. A single-use code must never be cleared on an unreachable
 *    server: nothing was established, so the code is still good ───────────── */

eq(codeAttempt(deadFetch(), REFUSAL).fate, 'unreached',
  'status 0 is a fetch that never completed — no server ever spoke');
eq(codeAttempt(deadFetch(), REFUSAL).settled, false,
  'an unreachable server settles NOTHING, so the caller may not clear the code — this is the whole defect');
eq(codeAttempt(deadFetch(), REFUSAL).unreached, true,
  'and the screen is told it was our end rather than their code');

// Every other way of not being answered, on the same terms.
for (const res of [gatewayPage(502), gatewayPage(520), ruled(503, '57P01'), ruled(500, 'XX000')]) {
  eq(codeAttempt(res, REFUSAL).settled, false,
    'a server failing rather than answering establishes nothing about the code');
  eq(codeAttempt(res, REFUSAL).unreached, true, 'and is worded as our end');
}

// A token problem is not a verdict on the code. The join screen is reached
// immediately after a sign-in, so the very next attempt has a fresh one.
for (const status of [401, 403, 408, 425, 429]) {
  eq(codeAttempt(ruled(status, 'PGRST301'), REFUSAL).settled, false,
    `a ${status} is about the request, not about the code — keep it`);
}

// Nothing came back to look at. Never success, never settled.
eq(codeAttempt(null, REFUSAL).settled, false, 'a missing result settles nothing');
eq(codeAttempt(undefined, REFUSAL).unreached, true, 'and is not a statement about the code');
eq(codeAttempt({ error: null }, REFUSAL).settled, false,
  'no status is not a 2xx: the absence of an error proves nothing');

/* ── only the refusal path may quote the server ───────────────────────────── */

eq(codeAttempt(deadFetch(), REFUSAL).message, CODE_UNREACHED_MESSAGE,
  'an unreachable server gets the sentence about the network, not the one about the code');
ok(!codeAttempt(deadFetch(), REFUSAL).message?.includes('Check it with them'),
  'and is never told to check six characters that were never sent anywhere');
ok(!/network request failed/i.test(codeAttempt(deadFetch(), REFUSAL).message ?? ''),
  'nor handed the fetch error verbatim, which is what the screen used to print');
ok(/has not been used up/.test(codeAttempt(deadFetch(), REFUSAL).message ?? ''),
  'the sentence says the code survives — the fear a single-use code creates is that it did not');

/* ── the database ruled, and its words are the ones worth reading ─────────── */

const refused = codeAttempt(ruled(400, 'P0001'), REFUSAL);
eq(refused.fate, 'refused', 'a 4xx carrying a SQLSTATE is the database ruling on this code');
eq(refused.message, REFUSAL, "and the caller's own translation of that ruling is what is shown");
eq(refused.settled, true, 'a ruling is the same ruling tomorrow, so the question is closed');
eq(refused.unreached, false, 'and it is not worded as our end');

eq(codeAttempt(ruled(400, 'P0001'), '   ').message, CODE_REFUSED_MESSAGE,
  'a refusal with nothing quotable still says the server answered, rather than blaming the network');
ok(!codeAttempt(ruled(400, 'P0001'), '  ').message?.includes('could not reach'),
  'which is the one thing that sentence must not claim');

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`codeAttempt: ${errors.length} failure(s)`);
  process.exit(1);
}
console.log('codeAttempt: all assertions passed');
