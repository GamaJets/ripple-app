// A referral that was never recorded, and a stashed code deleted anyway.
//
// `flushPendingReferral` used to call `recordReferral` — which swallowed every
// error — and then remove the stashed code unconditionally. A sign-in in a lift
// therefore spent the referral without recording it, permanently, silently. The
// repair is not "keep it on any error": an answer from the database will be the
// same answer tomorrow, and a code kept on one of those is retried at every
// sign-in for the life of the install and never lands.
//
// So there are four outcomes and only two of them may spend the code. These
// assertions are about that branch, written against the shapes
// `@supabase/postgrest-js` v2.110.2 actually resolves with.
import { referralFate, referralSettled } from './referralFate';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** The resolved value for a request that never completed: `PostgrestBuilder`'s
 *  `res.catch` at the bottom of `then()`. Status zero, and an empty `code`. */
const deadFetch = () => ({
  status: 0,
  error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' },
});

/** A non-2xx whose body parsed as PostgREST JSON: the database ruling. */
const answered = (status: number, code: string, message = 'no') =>
  ({ status, error: { code, details: null, hint: null, message } });

/** A non-2xx whose body did not parse — `processResponse` writes `{ message }`
 *  and nothing else. A gateway page, not the database. */
const gatewayPage = (status: number) =>
  ({ status, error: { message: '<html>502 Bad Gateway</html>' } });

/* ── the request landed and the server dealt with it ──────────────────────── */

// `record_referral` returns void, so PostgREST answers 204 with an empty body.
eq(referralFate({ status: 204, error: null }), 'recorded',
  'a 204 with no error is the ordinary success: void function, empty body');
eq(referralFate({ status: 200, error: null }), 'recorded', 'and so is a 200');

// The refusals this feature actually has — a self-referral, an unknown code, a
// second code after the first — are silent `return`s and `on conflict do
// nothing` inside the function. They arrive as success, and that is right:
// the question was asked and answered, and asking again changes nothing.
eq(referralSettled(referralFate({ status: 204, error: null })), true,
  'a question asked and answered spends the stashed code');

/* ── nothing was established, so the code must survive ────────────────────── */

eq(referralFate(deadFetch()), 'unreached',
  'status 0 is a fetch that never completed — the case the old code deleted on');
eq(referralSettled(referralFate(deadFetch())), false,
  'and an unreached server must never spend the code: this is the whole defect');

for (const status of [500, 502, 503, 504, 520, 530]) {
  eq(referralFate(answered(status, '57P01')), 'unreached',
    `a ${status} is the server failing rather than answering about this code`);
}
eq(referralFate(gatewayPage(502)), 'unreached',
  'a body that is not PostgREST JSON is a proxy speaking, not the database');
eq(referralFate(gatewayPage(400)), 'unreached',
  'and that holds at a 4xx too — a WAF refusal carries no code and rules on nothing');

eq(referralFate(answered(401, 'PGRST301', 'JWT expired')), 'unreached',
  'a token problem is not a verdict on the code; the next sign-in carries a fresh one');
eq(referralFate(answered(403, '42501', 'permission denied for function record_referral')), 'unreached',
  'nor is a grant that has not been applied yet');
eq(referralFate(answered(404, 'PGRST202', 'Could not find the function')), 'unreached',
  'an app running ahead of its migration must keep the code until the function exists');
eq(referralFate(answered(429, 'PGRST300', 'too many requests')), 'unreached',
  'being told to come back later is not being told no');

/* ── the database ruled, and will rule the same way for ever ──────────────── */

eq(referralFate(answered(400, 'P0001', 'that code has already been redeemed')), 'refused',
  'a raised exception is the server answering about this request');
eq(referralSettled(referralFate(answered(400, 'P0001'))), true,
  'and a settled question spends the code: retrying it for ever changes nothing');
eq(referralFate(answered(400, '22P02', 'invalid input syntax')), 'refused',
  'a SQLSTATE at a 4xx is the database, not the network');

/* ── the shapes that must not be read as success ──────────────────────────── */

eq(referralFate(undefined), 'unreached', 'nothing to look at is not a recorded referral');
eq(referralFate(null), 'unreached', 'and neither is null');
eq(referralFate({} as any), 'unreached',
  'a result with no status is not success by omission — the absence of an error proves nothing');
eq(referralFate({ status: '204' } as any), 'unreached',
  'a status that is not a number establishes nothing either');
eq(referralFate({ status: Number.NaN, error: null } as any), 'unreached',
  'NaN is not a 2xx');
eq(referralFate(answered(418, 'SOMETHINGNEW')), 'refused',
  'a 4xx with a SQLSTATE is the database even at a status nobody expected');
eq(referralFate({ status: 99, error: { code: 'X' } } as any), 'unreached',
  'and a status below 400 with an error is a shape nobody has explained — keep the code');

eq(referralSettled('not-asked'), false,
  'a call that was never made cannot spend the code — no backend, or no code to record');
eq(referralSettled('unreached'), false, 'and neither can one that did not land');

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`referralFate: ${errors.length} failure(s)`);
  process.exit(1);
}
console.log('referralFate: all assertions passed');
