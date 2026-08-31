// Tests for wroteRows — the sentence that stands between an owner and a write
// that did not happen.
//
// The defect these exist for is the one this codebase names as its defining
// bug: a screen that closes on the tap and drops the result. Its database face
// is that a PostgREST UPDATE or DELETE matching ZERO rows is not an error. It
// comes back 204 with `error: null`, so
//
//     const { error } = await sb.from('memberships').update({ status }).eq('id', id);
//     if (error) throw error;
//
// never throws, the confirmation dialog closes, the list reloads, and the
// membership is still active. `memberships_owner` — `is_owner_of(tenant_id)`,
// verified against the live database — is the only policy granting UPDATE, so a
// trainer, a member, or an owner of a different gym all land in exactly that
// silence, and a membership somebody was told was frozen keeps billing.
//
// So the assertions are about WHICH OF THE THREE OUTCOMES a result is, not
// about wording. There are three, they are genuinely different things, and the
// one that had no representation at all before this module is the middle one:
//
//   · the server refused and said so            → error
//   · the server did the write and matched none → count 0
//   · nobody asked for a count                  → count null
//
// The third is the one that keeps the rule honest over time. A helper that
// treated a missing count as success would pass every unconverted call site
// straight through — which is the entire population this module was written to
// close — so it is asserted to FAIL, and to say which half is missing.
//
// Compile with tsc then run with node, like plateMath.test.ts.
import { writeFailure, assertWrote } from './wroteRows';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// ── the one shape that is a pass ──────────────────────────────────────────
//
// A row was touched and the server did not complain. Nothing else is.
eq(writeFailure('That membership', { error: null, count: 1 }), null,
  'one row changed, no error — the only outcome that may be reported as saved');
eq(writeFailure('That membership', { error: null, count: 12 }), null,
  'several rows changed is equally a pass; the rule is "at least one", not "exactly one"');

// ── zero rows is the bug, and it must not be silent ───────────────────────
ok(writeFailure('That membership', { error: null, count: 0 }) !== null,
  'ZERO ROWS WITH NO ERROR MUST FAIL — this is the entire point of the module, and the shape a refused RLS write arrives in');

// The sentence has to be usable as an alert body, so it has to say what the
// owner should conclude. Asserted on content rather than on an exact string:
// pinning the wording would make a reworded message a red test, and the thing
// that must not regress is that the reader is told nothing changed.
{
  const why = writeFailure('That membership', { error: null, count: 0 }) ?? '';
  ok(why.includes('That membership'),
    'the message names the thing in the owner’s words, so the alert reads as a sentence rather than a field name');
  ok(/not changed|no rows|matched no/i.test(why),
    'and it states that nothing changed — an owner who reads it must not be left thinking the write half-landed');
}

// ── a missing count is not a pass ─────────────────────────────────────────
//
// The regression guard for every call site that has not been converted yet.
ok(writeFailure('That shift', { error: null, count: null }) !== null,
  'a null count is NOT confirmation — it means the caller forgot { count: \'exact\' }, and treating it as success re-admits the whole bug');
ok(writeFailure('That shift', { error: null }) !== null,
  'an absent count field is the same omission as a null one');
ok(writeFailure('That shift', {}) !== null,
  'and an empty result — which is what a stubbed or mocked client hands back — is not a pass either');

// The two failures must not read the same. "It matched no rows" sends somebody
// to check permissions; "nobody counted" sends somebody to check the call site.
{
  const missing = writeFailure('That shift', { error: null, count: null }) ?? '';
  const zero = writeFailure('That shift', { error: null, count: 0 }) ?? '';
  ok(missing !== zero,
    'a missing count and a zero count are different diagnoses and must not produce the same sentence');
  ok(/did not say|whether/i.test(missing),
    'the missing-count message names the omission rather than blaming the row');
}

// ── an error outranks the count ───────────────────────────────────────────
//
// A server that refused loudly is not also a row-count question, and a result
// carrying both must report the refusal.
ok(writeFailure('That plan', { error: new Error('permission denied'), count: 0 }) !== null,
  'an error with zero rows fails');
ok(writeFailure('That plan', { error: new Error('permission denied'), count: 1 }) !== null,
  'AN ERROR WITH ONE ROW STILL FAILS — the count must never be able to argue a refusal away');
{
  const withError = writeFailure('That plan', { error: { message: 'nope' }, count: 1 }) ?? '';
  ok(/could not be saved/i.test(withError),
    'and it says the save failed rather than describing a row count the caller should not be reading');
}

// A PostgREST error is a plain object, not an Error instance — `error` is read
// for truthiness precisely so that shape counts.
// `count: 1`, not `count: null`. With a null count the missing-count arm above
// already fails, so `!== null` was satisfied whether or not the plain object in
// `error` was noticed at all — the fixture removed the only variable the
// sentence is about. A confirmed single row is the only shape under which
// nothing but the error can produce a failure.
const bareErr = writeFailure('That plan', { error: { code: '42501', message: 'row-level security' }, count: 1 });
ok(bareErr !== null,
  'a bare PostgREST error object is an error; it does not have to be an Error instance');
ok(/could not be saved/i.test(bareErr ?? ''),
  'and it is diagnosed as a refusal, not as a row count — those send a reader to two different places');

// ── falsy-but-present values are not errors ───────────────────────────────
//
// `error: null` on a success is the normal shape and must not be confused with
// a failure by anything reading it loosely.
eq(writeFailure('That equipment', { error: undefined, count: 1 }), null,
  'an undefined error with a row touched is a pass, same as an explicit null');

// ── assertWrote throws exactly when writeFailure speaks ───────────────────
//
// The write helpers in src/lib signal failure by throwing and every owner call
// site is a try/catch around one, so the two functions have to agree — a
// divergence would mean a screen catching nothing while the sentence exists.
const threw = (r: { error?: unknown; count?: number | null }): string | null => {
  try { assertWrote('That thing', r); return null; } catch (e) { return (e as Error).message; }
};
eq(threw({ error: null, count: 1 }), null, 'assertWrote is silent on the one passing shape');
ok(threw({ error: null, count: 0 }) !== null, 'assertWrote throws on zero rows');
ok(threw({ error: null, count: null }) !== null, 'assertWrote throws on a missing count');
ok(threw({ error: new Error('x'), count: 1 }) !== null, 'assertWrote throws on an error');
eq(threw({ error: null, count: 0 }), writeFailure('That thing', { error: null, count: 0 }),
  'and it throws THE SAME SENTENCE, so the alert an owner reads is the one asserted above');

if (errors.length) {
  console.error(`wroteRows.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('wroteRows.test.ts — ok');
