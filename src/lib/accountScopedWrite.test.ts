// Which account a server write is made as.
// Compile with tsc, run with node.
//
// What is defended here is one sentence: the account a write is GATED on and
// the account the write CARRIES are the same account, and they are the same by
// construction rather than by two lookups agreeing.
//
// The shape that made this necessary is worth stating, because every individual
// step in it is correct:
//
//   1. The screen asks `useAuth()` who is signed in. Answer: coach A.
//   2. It gates the backfill on that — `pushUpDecision({ writeUid: A })` checks
//      the device blob really is A's, and says 'push'.
//   3. `await`. The handset changes hands; auth-js now holds coach B.
//   4. The store calls `getUser()` for itself. Answer: coach B. Correct answer.
//   5. The row is written as B, carrying A's numbers, with no error anywhere.
//
// Nothing failed. The guard vouched for a write it never described. That is the
// whole defect and step 4 is the only removable part of it, so it is removed:
// the store is TOLD, and is given no way to look it up.
//
// The two things tested here are therefore:
//
//   · the refusal — a null, blank or 'unknown' uid is not an account, and a
//     store handed one must write nothing rather than resolve one; and
//   · the interleaving — a decision taken for A, an await, a session that is
//     now B, and a write that must still be about A or not happen at all.
import { accountUid, writeTargetFor, NO_ACCOUNT_TO_WRITE_AS } from './accountScopedWrite';
import { cacheForAccount, cacheHydrated, pushUpDecision } from './deviceAccountCache';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/* ── the refusal ───────────────────────────────────────────────────────────
 *
 * Not a second copy of the predicate: `accountUid` runs Lane 118's
 * `accountCacheKey` and reads the uid back out, so a literal added there is
 * refused here too. These cases assert the rule, not a re-implementation of it.
 */
ok(accountUid(A) === A, 'a uuid is an account');
ok(accountUid(null) === null, 'null is not an account');
ok(accountUid(undefined) === null, 'undefined is not an account');
ok(accountUid('') === null, 'an empty string is not an account');
ok(accountUid('   ') === null, 'whitespace is not an account');
// The literal src/ui/clientData.tsx settles on before the auth read lands. It
// looks like an id and is not one; composing anything from it gives every
// signed-out session on a shared handset one identity.
ok(accountUid('unknown') === null, "'unknown' is not an account");
// Trimmed rather than refused: a padded id is this account's id.
ok(accountUid(`  ${A}  `) === A, 'a padded uid is trimmed to the account');

/* ── the refusal, as a store sees it ───────────────────────────────────── */
const good = writeTargetFor(A);
ok(good.write === true, 'a uuid may be written as');
ok(good.write === true && good.uid === A, 'and the write carries exactly it');

for (const bad of [null, undefined, '', '   ', 'unknown']) {
  const t = writeTargetFor(bad);
  ok(t.write === false, `writeTargetFor(${JSON.stringify(bad)}) must refuse`);
  ok(t.write === false && t.why === 'no-account', `and say why for ${JSON.stringify(bad)}`);
}
ok(NO_ACCOUNT_TO_WRITE_AS.length > 0, 'a refusal has something to report');

/* ── the interleaving, which is the whole point ────────────────────────────
 *
 * A stand-in for the store, built exactly as the real ones now are: it is TOLD
 * the account and has no way to resolve one. The fake session is mutated
 * between the decision and the write, which is the account switch, and the
 * assertion is on the row the store would have sent.
 */
type Row = { user_id: string };
const sent: Row[] = [];

/** The session the handset holds RIGHT NOW. Mutable, because that is the fact
 *  the defect turned on. */
let session: string | null = A;

/** The store, in its fixed shape: no lookup, a refusal, and a row that carries
 *  what it was handed. */
async function saveAs(uid: string | null | undefined): Promise<'written' | 'refused-no-account' | 'refused-by-rls'> {
  const target = writeTargetFor(uid);
  if (!target.write) return 'refused-no-account';
  await Promise.resolve();
  // The database's own `with check (user_id = auth.uid())`. It is modelled
  // rather than assumed, because it is the half that makes a stale-but-honest
  // uid safe: the write is refused, not retargeted.
  if (session !== target.uid) return 'refused-by-rls';
  sent.push({ user_id: target.uid });
  return 'written';
}

/** The store in the shape being REMOVED, for one assertion only: that the thing
 *  we are protecting against actually happens. Nothing outside this test may
 *  have this shape. */
async function saveResolvingItsOwn(): Promise<Row | null> {
  await Promise.resolve();
  const uid = session; // getUser(), a second answer, one await later
  if (!uid) return null;
  return { user_id: uid };
}

async function run(): Promise<void> {
  // ── the decision, taken for A ───────────────────────────────────────────
  session = A;
  const cache = cacheHydrated(cacheForAccount('repple.trainer.goals:', A));
  const verdict = pushUpDecision({ cache, writeUid: A, hasCached: true, serverHas: false });
  ok(verdict === 'push', 'the gate says push for the account whose blob it read');

  // ── the await, during which the handset changes hands ───────────────────
  await Promise.resolve();
  session = B;

  // ── the old shape: the guard vouched for A, the row went in as B ────────
  const stale = await saveResolvingItsOwn();
  ok(stale !== null && stale.user_id === B,
    "the removed shape writes as B — if this ever fails the defect's premise is wrong, not the fix");
  ok(stale !== null && stale.user_id !== A,
    'and the row it writes is not the one the gate described');

  // ── the fixed shape: the write is about A, and A is not signed in ───────
  const outcome = await saveAs(A);
  ok(outcome === 'refused-by-rls',
    'handed the decided account after a switch, the write is REFUSED rather than retargeted');
  ok(sent.length === 0, 'and nothing at all was written as B');

  // ── the same pass with no switch, which must still write ────────────────
  session = A;
  ok(await saveAs(A) === 'written', 'no switch, and the write goes through');
  ok(sent.length === 1 && sent[0].user_id === A, 'carrying the account the gate described');

  // ── a caller with nothing to hand ───────────────────────────────────────
  //
  // The store must not fall back to the session, which is signed in as A right
  // now and would happily accept the row.
  sent.length = 0;
  session = A;
  for (const bad of [null, undefined, '', 'unknown']) {
    ok(await saveAs(bad) === 'refused-no-account',
      `a store handed ${JSON.stringify(bad)} refuses rather than resolving one`);
  }
  ok(sent.length === 0, 'and a signed-in session is never a substitute for being told');

  // ── the gate and the write agree by construction ────────────────────────
  //
  // There is no uid in this sequence that `pushUpDecision` approved and the
  // write did not carry: they are the same variable now.
  session = B;
  const bCache = cacheHydrated(cacheForAccount('repple.trainer.goals:', B));
  ok(pushUpDecision({ cache: bCache, writeUid: A, hasCached: true, serverHas: false }) === 'other-account',
    "B's blob may never be published as A");
  ok(pushUpDecision({ cache: bCache, writeUid: 'unknown', hasCached: true, serverHas: false }) === 'no-account',
    "'unknown' is refused by the gate as well as by the store");

  if (errors.length) {
    console.error(`accountScopedWrite: ${errors.length} failure(s)`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('accountScopedWrite: all checks passed');
}

void run();
