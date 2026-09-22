// The owner's P&L cache, and the handset two gyms share.
//
// ── What these assertions are guarding ────────────────────────────────────
//
// `repple.owner.financials` was a device-global key holding eight typed
// figures. The screen above it mounts once (`href: null` under expo-router's
// Tabs, so it is never torn down), read that key once, and then formatted what
// came out in the CURRENTLY signed-in gym's currency, graded it, and offered to
// overwrite it from the currently signed-in gym's register.
//
// So the assertions that matter most here are not about parsing:
//
//   · the key CONTAINS the uid, so two owners on one handset cannot share one;
//   · a null, blank or 'unknown' id yields NO key — never a fallback to the
//     shared one, because the fallback IS the defect;
//   · the hydration flag is false the instant the key changes, because a flag
//     that survives arms a write of one owner's figures under another's id;
//   · the legacy unqualified key is not a member of the per-account family, so
//     nothing can read it back in by accident;
//   · and a figure that is not a finite number is not a figure — it never
//     reaches the review as a zero, and Infinity never reaches it at all.
import {
  OWNER_FINANCIALS_PREFIX, LEGACY_OWNER_FINANCIALS_KEY, FINANCIAL_FIELDS,
  REVIEW_NEEDS,
  ownerFinancialsKey, ownerFinancialsCache, isOwnerFinancialsKey,
  parseOwnerFinancials, ownerFinancialsBlob, readFinancialsDraft, reviewBlocker,
  type EnteredFields,
} from './ownerFinancialsCache';
import { readNumber } from './units';
import type { FinInputs } from './finReview';
import { cacheHydrated, mayWriteCache } from './deviceAccountCache';
import { accountStateStep } from './accountScopedState';
import { emptyFinances, hasFigures, reviewFinances } from './finReview';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(a === b, `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Two owners, one handset. */
const DUBAI = '11111111-1111-4111-8111-111111111111';
const LONDON = '22222222-2222-4222-8222-222222222222';

/* ── the key carries the account ─────────────────────────────────────────── */
{
  eq(ownerFinancialsKey(DUBAI), `${OWNER_FINANCIALS_PREFIX}${DUBAI}`,
    'a key is the prefix and the account');
  ok((ownerFinancialsKey(DUBAI) ?? '').includes(DUBAI),
    'the account is IN the key, not merely known about');
  ok(ownerFinancialsKey(DUBAI) !== ownerFinancialsKey(LONDON),
    'two owners on one handset do not share a key — this is the whole defect');

  eq(ownerFinancialsKey(null), null, 'signed out there is no key, and no key means do not persist');
  eq(ownerFinancialsKey(undefined), null, 'nor before the session has been restored');
  eq(ownerFinancialsKey(''), null, 'an empty id is not an account');
  eq(ownerFinancialsKey('   '), null, 'nor is whitespace');
  eq(ownerFinancialsKey('unknown'), null,
    "'unknown' is the literal clientData settles on before the auth read lands — "
    + 'every signed-out session would otherwise share one key');

  ok(!isOwnerFinancialsKey(LEGACY_OWNER_FINANCIALS_KEY),
    'the legacy device-global key is NOT one of the per-account family');
  ok(isOwnerFinancialsKey(ownerFinancialsKey(DUBAI)!), 'an account key is');
  ok(!isOwnerFinancialsKey(OWNER_FINANCIALS_PREFIX),
    'and a bare prefix with no account after it is not');
  ok(OWNER_FINANCIALS_PREFIX.startsWith(LEGACY_OWNER_FINANCIALS_KEY),
    'the prefix does begin with the legacy key, which is exactly why the ":" and '
    + "isAccountCacheKey's length test both matter");
}

/* ── the hydration flag never survives the account changing ──────────────── */
{
  const dubai = ownerFinancialsCache(DUBAI);
  eq(dubai.hydrated, false, 'a fresh cache is never hydrated');
  ok(!mayWriteCache(dubai), 'and may not be written to before its read lands');

  const read = cacheHydrated(dubai);
  ok(mayWriteCache(read), 'after a read of ITS key it may be written');
  eq(read.uid, DUBAI, 'and it still knows whose it is');

  // The account changes. The screen builds the new cache; there is no setter
  // that leaves the old flag standing.
  const london = ownerFinancialsCache(LONDON);
  eq(london.hydrated, false,
    "the flag is false again the instant the key changes — a flag that survived "
    + "would arm a write of Dubai's figures under London's id");
  ok(!mayWriteCache(london), 'so nothing may be written until London has been read');

  const out = ownerFinancialsCache(null);
  eq(out.key, null, 'signed out there is no key');
  ok(!mayWriteCache(out), 'and nothing may be written at all');
}

/* ── what a mounted screen does when the account under it changes ────────── */
{
  const dubaiKey = ownerFinancialsKey(DUBAI)!;
  const londonKey = ownerFinancialsKey(LONDON)!;

  const first = accountStateStep({ key: dubaiKey, onScreenKey: null, onScreenSaved: false });
  eq(first.do, 'load', 'a first sign-in loads');
  eq(first.do === 'load' && first.forget, false, 'with nothing on screen to forget');

  const swap = accountStateStep({ key: londonKey, onScreenKey: dubaiKey, onScreenSaved: true });
  eq(swap.do, 'load', 'a different account loads');
  eq(swap.do === 'load' && swap.forget, true,
    "and forgets Dubai's figures FIRST — before London's read lands and whatever it decides");

  const same = accountStateStep({ key: dubaiKey, onScreenKey: dubaiKey, onScreenSaved: true });
  eq(same.do === 'load' && same.forget, false, 'a re-read of the same account forgets nothing');

  const signedOut = accountStateStep({ key: null, onScreenKey: dubaiKey, onScreenSaved: true });
  eq(signedOut.do, 'forget', "a sign-out drops the leaver's figures from memory");

  const wobble = accountStateStep({ key: null, onScreenKey: dubaiKey, onScreenSaved: false });
  eq(wobble.do, 'hold',
    'but a session that merely went quiet, over figures that were never armed for '
    + 'a write, holds — that is the only copy and it is not dropped');
}

/* ── what the stored bytes mean ──────────────────────────────────────────── */
{
  eq(parseOwnerFinancials(null), null, 'nothing stored is nothing — not eight zeros');
  eq(parseOwnerFinancials(undefined), null, 'nor is a key that was never written');
  eq(parseOwnerFinancials('not json'), null, 'an unparseable blob says nothing');
  eq(parseOwnerFinancials('[]'), null, 'an array is not the record');
  eq(parseOwnerFinancials('null'), null, 'nor is a JSON null');
  eq(parseOwnerFinancials('42'), null, 'nor is a bare number');
  eq(parseOwnerFinancials('{}'), null, 'an object with none of the eight fields says nothing');
  eq(parseOwnerFinancials('{"revenue":"12000"}'), null,
    'a figure stored as a string is not a figure, and is not read as one');

  const full = parseOwnerFinancials(JSON.stringify({
    revenue: 214000, expenses: 160000, mrr: 120000, members: 1940,
    newMembers: 60, churnedMembers: 41, ptRevenue: 30000, classRevenue: 24000,
  }));
  ok(full !== null, 'a full record comes back');
  eq(full?.figures.revenue, 214000, 'with its revenue');
  eq(full?.figures.churnedMembers, 41, 'and its leavers');
  eq(full?.entered.size, 8, 'and all eight are entered');

  const partial = parseOwnerFinancials('{"members":40,"nonsense":1}');
  eq(partial?.figures.members, 40, 'a field that is there is read');
  eq(partial?.figures.revenue, 0,
    'and one that is not sits at the empty record — where nothing may quote it');
  eq(partial?.entered.has('members'), true, 'members was entered');
  eq(partial?.entered.has('revenue'), false,
    'and revenue was NOT — which is the whole distinction, because the figure beside it is 0');
  eq(partial?.entered.size, 1, 'a key the type does not know is not an entered field');
  ok(!hasFigures(partial!.figures), 'so no review is offered over it');

  // Deliberate zeros ARE a record: an owner who typed 0 expenses has said
  // something, and that is not the same as a key nobody has written.
  const zeros = parseOwnerFinancials(JSON.stringify(emptyFinances()));
  ok(zeros !== null, 'eight deliberate zeros are a record, not an absence');
  eq(zeros?.figures.expenses, 0, 'and they read back as zeros');
  eq(zeros?.entered.has('expenses'), true,
    'and as ENTERED zeros — a typed 0 is a figure, and the review must run on it');
}

/* ── a figure that is not a finite number never reaches the review ───────── */
{
  // `JSON.parse` really does produce Infinity for this, and `typeof` really
  // does call it a number. That combination was the screen's old reader.
  const overflowed = JSON.parse('{"revenue":1e999}') as Record<string, unknown>;
  eq(typeof overflowed.revenue, 'number', 'typeof calls an overflowed literal a number…');
  eq(Number.isFinite(overflowed.revenue as number), false, '…and it is not a finite one');

  eq(parseOwnerFinancials('{"revenue":1e999}'), null,
    'so an overflowed revenue is dropped, and a blob of nothing else is nothing');

  const mixed = parseOwnerFinancials('{"revenue":1e999,"members":40}');
  eq(mixed?.figures.revenue, 0, 'a non-finite field does not survive beside a good one');
  eq(mixed?.entered.has('revenue'), false, 'and is not entered — an unreadable byte is not a zero');
  eq(mixed?.figures.members, 40, 'and the good one still does');

  // What the old reader would have handed the review, said out loud so the
  // assertion is about the consequence rather than about a predicate.
  const poisoned = { ...emptyFinances(), revenue: Number.POSITIVE_INFINITY, expenses: 1000 };
  const bad = reviewFinances(poisoned, 'GBP');
  ok(Number.isNaN(bad.marginPct) || !Number.isFinite(bad.netProfit),
    'a non-finite revenue makes the review report a margin nobody can read — '
    + 'which is what the finiteness test exists to stop reaching it');
}

/* ── a blank box is not a zero ───────────────────────────────────────────── */
{
  // The live defect, stated as the consequence rather than as a predicate.
  // An owner types revenue and nothing else, because the form above the boxes
  // says "Leave a field blank if you don't track it."
  const typed = readFinancialsDraft({ revenue: '30000' }, readNumber);
  eq(typed.figures.revenue, 30000, 'the revenue they typed is read');
  eq(typed.entered.has('revenue'), true, 'and is entered');
  eq(typed.figures.expenses, 0, 'expenses sits at the empty record…');
  eq(typed.entered.has('expenses'), false, '…and is NOT entered');

  // What the old `n ?? 0` handed reviewFinances, run here so the assertion is
  // about the sentence an owner read rather than about a `??`.
  const asZero = reviewFinances({ ...typed.figures }, 'AED');
  eq(asZero.marginPct, 100, 'taken as a zero, expenses give a 100% margin…');
  eq(asZero.score, 100, '…a health score of 100…');
  eq(asZero.grade, 'A', '…and an A');
  ok(asZero.summary.includes('strong financial health'),
    'with the summary telling the owner their gym is in strong financial health');
  ok(asZero.summary.includes('low churn and positive growth'),
    'and reporting churn and growth over member counts nobody entered');

  // Which is exactly why the review is withheld instead.
  //
  // Guarded rather than asserted with `!`: when this rule is broken the blocker
  // is NULL, and a `blocked!.includes(...)` would take the whole file down with
  // a TypeError instead of naming the rule that broke. A test that crashes
  // reports a broken test; a test that fails reports a broken rule.
  const blocked = reviewBlocker(typed.entered);
  ok(blocked !== null, 'so no review is given over a blank expenses figure');
  if (blocked) {
    ok(blocked.includes('expenses'), 'and the reason names the field');
    ok(blocked.includes('100% margin'), 'and names what a blank taken as zero would have reported');
    ok(!blocked.includes('required'), 'without reading as a form error — the owner may not track it');
  }

  // A deliberate zero is a different thing and does NOT block.
  const zeroed = readFinancialsDraft({ revenue: '30000', expenses: '0' }, readNumber);
  eq(zeroed.entered.has('expenses'), true, 'a typed 0 is entered');
  eq(reviewBlocker(zeroed.entered), null, 'and the review runs on it');

  // Nothing entered at all names both.
  const nothing = readFinancialsDraft({}, readNumber);
  const both = reviewBlocker(nothing.entered);
  ok(both !== null, 'a form with nothing in it gives no review');
  if (both) {
    ok(both.includes('revenue') && both.includes('expenses'), 'both missing are both named');
    ok(both.includes('are blank'), 'and the verb agrees with two of them');
  }
  const one = reviewBlocker(readFinancialsDraft({ revenue: '1' }, readNumber).entered);
  ok(one !== null && one.includes('is blank'), 'and with one of them');

  // Only the two the review actually needs.
  eq(REVIEW_NEEDS.length, 2, 'two fields gate the review');
  const allButMembers = readFinancialsDraft(
    { revenue: '30000', expenses: '20000' }, readNumber,
  );
  eq(reviewBlocker(allButMembers.entered), null,
    'a blank MEMBER count does not withhold the review — `membersKnown` inside '
    + 'reviewFinances already drops churn and growth from the score and says so');

  // A box with something in it that is not a number is not a zero either.
  const junk = readFinancialsDraft({ revenue: '30000', expenses: 'about twenty grand' }, readNumber);
  eq(junk.entered.has('expenses'), false, 'an unreadable box is not entered');
  eq(junk.figures.expenses, 0, 'and its figure is never quoted, because nothing may quote it');
  ok(!!reviewBlocker(junk.entered), 'so the review is still withheld');
}

/* ── round trip ──────────────────────────────────────────────────────────── */
{
  const typed: FinInputs = {
    revenue: 12500.5, expenses: 9000, mrr: 8000, members: 210,
    newMembers: 12, churnedMembers: 7, ptRevenue: 2200, classRevenue: 1800,
  };
  const all: EnteredFields = new Set(FINANCIAL_FIELDS);
  const back = parseOwnerFinancials(ownerFinancialsBlob(typed, all));
  ok(back !== null, 'what was written comes back');
  for (const f of FINANCIAL_FIELDS) {
    eq(back?.figures[f], typed[f], `${f} survives the round trip`);
    eq(back?.entered.has(f), true, `${f} comes back entered`);
  }
  eq(FINANCIAL_FIELDS.length, Object.keys(emptyFinances()).length,
    'every field of FinInputs is named here — a ninth one must be added deliberately');

  // An unentered field is ABSENT from the blob, not stored as 0. That is what
  // makes "entered" a fact about the file rather than a list beside it.
  const some: EnteredFields = new Set<keyof FinInputs>(['revenue', 'members']);
  const blob = JSON.parse(ownerFinancialsBlob(typed, some)) as Record<string, unknown>;
  eq(Object.keys(blob).length, 2, 'only the entered fields are written');
  eq('expenses' in blob, false, 'a blank field is absent, not zero');
  const round = parseOwnerFinancials(ownerFinancialsBlob(typed, some))!;
  eq(round.entered.size, 2, 'and comes back unentered');
  eq(round.entered.has('expenses'), false, 'specifically that one');
  ok(!!reviewBlocker(round.entered), 'so a reload withholds the review exactly as the save did');

  eq(ownerFinancialsBlob(typed, new Set()), '{}', 'nothing entered writes an empty object');
  eq(parseOwnerFinancials('{}'), null, 'which reads back as nothing stored');
}

if (errors.length) {
  console.error(`ownerFinancialsCache.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('ownerFinancialsCache.test.ts — ok');
