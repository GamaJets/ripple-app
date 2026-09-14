// The owner's typed P&L, and whose phone it is.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// app/(owner)/financials.tsx kept every figure an owner types — total revenue,
// total expenses, recurring revenue, active members, joiners, leavers, PT and
// class revenue — under ONE AsyncStorage key with no account in it:
//
//   const KEY = 'repple.owner.financials';
//   const raw = await AsyncStorage.getItem(KEY);      // whoever used this phone last
//   …
//   await AsyncStorage.setItem(KEY, JSON.stringify(next));
//
// read from a `useEffect(…, [])` that runs once at mount and is never asked
// again. src/lib/deviceAccountCache.ts sets out the class in full; this is that
// class at its most exposed, because of WHAT is in the blob and what the screen
// does with it.
//
// A gym handset on a desk is signed in and out all day, and an owner of two
// sites signs between them on one phone. What the next account saw:
//
//   · another business's revenue, expenses and member counts, on screen, in the
//     screen's own confident type, with no indication they were not theirs;
//   · those figures RE-DENOMINATED — the screen formats them with
//     `tenants.currency` of the gym signed in NOW, so a Dubai owner's
//     AED 214,000 was drawn to the London owner as "GBP 214,000";
//   · a health score, a letter grade and a net-profit verdict computed from
//     them and headed with the new gym's name;
//   · and the reconcile notice, which compares those typed figures against THIS
//     gym's register and says the two disagree — offering a "Use It" button
//     that writes this gym's register figure into the other owner's numbers,
//     after which the first owner's month is gone and nothing anywhere records
//     that it was ever there.
//
// `expo-router` compounds it: Financials is registered `href: null`, so the
// screen mounts once and is NEVER torn down — not by a sign-out, not by
// backgrounding the app. The mount-once read and the un-torn-down component are
// the same fact seen twice.
//
// ── What this file is ─────────────────────────────────────────────────────
//
// The rule is one rule and it is already written, in src/lib/deviceAccountCache.ts
// (the key, the hydration flag, the refusal of a null or 'unknown' id) and in
// src/lib/accountScopedState.ts (what a MOUNTED screen does when the account
// under it changes). Both are imported. Nothing in here re-decides either of
// them; this file names this feature's prefix against those rules and adds the
// one thing that is genuinely this feature's own — what the stored bytes mean.
//
// ── Why the old key is deleted rather than migrated ───────────────────────
//
// The unqualified blob carries no account. Nothing on the device says whether
// it is this owner's own August or the previous owner's, and reading it into
// the signed-in account is the defect above performed once, deliberately, with
// a letter grade on the end of it. The cost of losing it is that an owner
// re-types eight numbers that never left the handset anyway — the screen says
// so three times, in `storageNote()`. That is cheaper than one gym's books
// shown to another gym's owner; it is not close. Removed UNREAD, as
// src/lib/unitCache.ts and src/lib/refusedMessages.ts remove theirs.
//
// ── Why a figure read back off the device is checked for FINITENESS ───────
//
// The screen's reader was `typeof parsed?.[f.key] === 'number'`, which is true
// of `Infinity`: `JSON.parse('{"revenue":1e999}')` yields it, and so does any
// hand-edited or corrupted blob. `reviewFinances` then computes
// `(netProfit / f.revenue) * 100` and reports a margin of `NaN`, a score of
// `NaN` and a grade picked by comparisons that are all false. A figure that is
// not a finite number is not a figure, and it is dropped rather than shown.
//
// Pure: strings, a record and a parse. No storage, no supabase, so `npm test`
// reaches all of it.
import {
  accountCacheKey, cacheForAccount, isAccountCacheKey, type DeviceCache,
} from './deviceAccountCache';
import { emptyFinances, type FinInputs } from './finReview';

/** Every per-account P&L key starts with this. The trailing ':' is required by
 *  `accountCacheKey` and is what keeps the legacy key below out of the family. */
export const OWNER_FINANCIALS_PREFIX = 'repple.owner.financials:';

/**
 * The device-global key the figures used to live in.
 *
 * Exported so the decision about it is greppable from the key's side, and so
 * the screen's `removeItem` names a constant rather than a string literal that
 * could drift from the one that was written.
 */
export const LEGACY_OWNER_FINANCIALS_KEY = 'repple.owner.financials';

/** Where this account's figures live, or null when there is no account to scope
 *  them to — which means DO NOT PERSIST. A null, blank or 'unknown' id is
 *  refused by `accountCacheKey`, never fallen back to the shared key. */
export const ownerFinancialsKey = (uid: string | null | undefined): string | null =>
  accountCacheKey(OWNER_FINANCIALS_PREFIX, uid);

/** The cache record for an account, `hydrated: false`, as the screen must set
 *  it synchronously BEFORE the read it is about to start. A flag that survives
 *  the key changing is what writes one owner's figures under another's id. */
export const ownerFinancialsCache = (uid: string | null | undefined): DeviceCache =>
  cacheForAccount(OWNER_FINANCIALS_PREFIX, uid);

/** Whether a stored key holds somebody's P&L. The legacy unqualified key is
 *  deliberately not one of these. */
export const isOwnerFinancialsKey = (k: string): boolean =>
  isAccountCacheKey(OWNER_FINANCIALS_PREFIX, k);

/**
 * The eight fields, named once.
 *
 * `keyof FinInputs` rather than a hand-written list: a ninth field added to
 * `FinInputs` fails to compile here until it is named, which is the opposite of
 * the silent behaviour a `for (const k in parsed)` would have — that would copy
 * whatever the blob happened to hold, including a key the type has since
 * dropped.
 */
export const FINANCIAL_FIELDS: readonly (keyof FinInputs)[] = [
  'revenue', 'expenses', 'mrr', 'members', 'newMembers', 'churnedMembers',
  'ptRevenue', 'classRevenue',
];

/**
 * Which of the eight the owner actually typed.
 *
 * ── why this record has to exist at all ──────────────────────────────────
 *
 * `FinInputs` is eight `number`s with no null in it, and the entry form above
 * it says, in its own words, "Leave a field blank if you don't track it." Those
 * two facts cannot both be honoured by the figures alone: the screen read the
 * form with
 *
 *     const n = readNumber(draft[f.key] ?? '');
 *     next[f.key] = n ?? 0;
 *
 * so "I do not track this" and "this is zero" became the same stored number.
 *
 * That is not cosmetic on this screen. src/lib/finReview.ts computes
 * `netProfit = revenue - expenses` and `marginPct = netProfit / revenue`, and
 * it has closed this exact substitution TWICE already — `hasFigures` gates the
 * whole review on revenue, and `membersKnown` gates churn and growth — while
 * leaving `expenses` ungated, which is the field the margin is made of. An
 * owner who typed revenue 30,000 and left everything else blank was told, in
 * the screen's hero: **Health Score 100/100, Grade A**, with the summary "Your
 * gym is in strong financial health (A). 30,000/mo profit on a 100% margin, low
 * churn and positive growth" — a 100% margin because expenses were taken as
 * nought, and "low churn and positive growth" over member counts nobody
 * supplied.
 *
 * ── how it is stored ─────────────────────────────────────────────────────
 *
 * By OMISSION. A field the owner did not enter is simply not a key in the blob,
 * so "entered" is `key in blob` and there is no second list to fall out of step
 * with the figures. A deliberate `0` IS written and IS entered — an owner who
 * types zero expenses has said something, and the review should run on it.
 */
export type EnteredFields = ReadonlySet<keyof FinInputs>;

/** What one read of the key yields: the figures, and which of them are figures
 *  rather than defaults. */
export interface StoredFinancials {
  figures: FinInputs;
  entered: EnteredFields;
}

/**
 * What a completed read of the account's key holds, or null for "nothing of
 * this account's is stored".
 *
 * `raw` is what the store handed back on a read that COMPLETED — null when
 * nothing has ever been written under this account's key. A read that THREW is
 * not this function's input: the caller does not call it, which leaves the
 * cache un-hydrated and the bytes on the device untouched, because "we could
 * not read it" is not "there is nothing there".
 *
 * Null and `emptyFinances()` are kept apart on purpose and the screen renders
 * them differently: null is an owner who has never typed anything, and an
 * all-zero record is an owner who typed zeros. `hasFigures` treats both as "no
 * review", but only the second should ever be written back over the key.
 *
 * Anything unreadable — not JSON, not an object, an array, a field that is not
 * a finite number — reads as nothing rather than as a zero. A zero here is a
 * figure, and a figure invented out of a parse failure is what this product
 * refuses everywhere else.
 */
export function parseOwnerFinancials(raw: string | null | undefined): StoredFinancials | null {
  if (raw == null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const figures = emptyFinances();
  const entered = new Set<keyof FinInputs>();
  for (const f of FINANCIAL_FIELDS) {
    const v = o[f];
    // `Number.isFinite`, not `typeof v === 'number'`. See the header: the
    // second is true of Infinity and of NaN, and both reach the review as a
    // margin, a score and a grade that are all NaN. A field that fails this is
    // not entered — it is not a zero the owner typed, it is a byte nobody can
    // read, and it must not become a figure.
    if (typeof v === 'number' && Number.isFinite(v)) { figures[f] = v; entered.add(f); }
  }
  // A blob that held eight unreadable fields is a blob that said nothing. It is
  // not eight zeros, and returning `figures` here would turn a corrupted file
  // into a month in which this gym took nothing.
  return entered.size ? { figures, entered } : null;
}

/**
 * The bytes to store for one account's figures.
 *
 * Only the entered fields are written. A field the owner left blank is ABSENT
 * from the blob rather than stored as 0, which is what makes "entered" a fact
 * about the file rather than a second list beside it that can drift.
 */
export function ownerFinancialsBlob(f: FinInputs, entered: EnteredFields): string {
  const out: Record<string, number> = {};
  for (const k of FINANCIAL_FIELDS) if (entered.has(k)) out[k] = f[k];
  return JSON.stringify(out);
}

/**
 * One typed form, read.
 *
 * The screen's `save` loop, moved here so the rule that a blank box is NOT a
 * zero is written once and can be asserted under plain node. `read` is
 * `readNumber` from src/lib/units.ts, passed in rather than imported so this
 * module stays free of that file's own dependencies and so the test can hand in
 * a reader it controls.
 *
 * A box that holds something `read` cannot make a number of — letters, a stray
 * character, two decimal points — is NOT entered. It is not a zero either. The
 * caller decides whether to say so; what this refuses to do is invent a figure.
 */
export function readFinancialsDraft(
  draft: Readonly<Record<string, string | undefined>>,
  read: (s: string) => number | null,
): StoredFinancials {
  const figures = emptyFinances();
  const entered = new Set<keyof FinInputs>();
  for (const k of FINANCIAL_FIELDS) {
    const n = read(draft[k] ?? '');
    // `n != null`, not `n ?? 0`. That expression is the defect this module's
    // header is about, and it lived on this exact line.
    if (n != null && Number.isFinite(n)) { figures[k] = n; entered.add(k); }
  }
  return { figures, entered };
}

/**
 * The fields src/lib/finReview.ts cannot produce an honest review without.
 *
 * Two, and only two, because the review's own source says which. `hasFigures`
 * already gates on `revenue`; `expenses` is named here because `netProfit`,
 * `marginPct`, all forty margin points of the score and — where no member count
 * was entered — the entire 0-100 score are functions of it, and nothing in that
 * file gates it.
 *
 * `members`, `newMembers` and `churnedMembers` are deliberately NOT here:
 * `membersKnown` inside `reviewFinances` already drops churn and growth from
 * the score and from its denominator, and says so in the improvements list. A
 * second gate on them here would withhold a review that file is prepared to
 * give honestly.
 */
export const REVIEW_NEEDS: readonly (keyof FinInputs)[] = ['revenue', 'expenses'];

/** Human names for the two, for the sentence below. */
const FIELD_NAME: Record<string, string> = {
  revenue: 'total monthly revenue',
  expenses: 'total monthly expenses',
};

/**
 * Why no review can be given, or null when one can.
 *
 * A named unknown that says what is missing and what it would have been used
 * for — not a blank panel, and not a review computed over a blank taken as a
 * zero. The sentence names the consequence rather than the field alone, because
 * "expenses is required" reads as a form error and this is not one: the owner
 * may genuinely not track expenses here, and they are entitled to know that the
 * cost of that is the margin and the grade rather than to be nagged.
 */
export function reviewBlocker(entered: EnteredFields): string | null {
  const missing = REVIEW_NEEDS.filter((k) => !entered.has(k));
  if (!missing.length) return null;
  const names = missing.map((k) => FIELD_NAME[k] ?? k).join(' and ');
  return `No score or grade is shown, because ${names} ${missing.length === 1 ? 'is' : 'are'} blank. `
    + 'Net profit, margin and the health score are all worked out from those, so a blank read as '
    + 'zero would report a 100% margin and an A. Nothing here is a judgement about your gym — '
    + 'it is a figure this screen has not been given. Everything you did enter is shown above.';
}
