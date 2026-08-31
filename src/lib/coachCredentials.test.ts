// What a coach claims about themselves, and the one assertion that matters
// most: nothing in here can be made to say Repple checked it. Compile with tsc,
// run with node.
//
// A client picks who to trust with their body partly on this. A badge that
// implies verification, next to a line somebody typed about themselves, is the
// failure this file exists to make impossible — so the wording is asserted
// against a regex rather than eyeballed, and a future edit that softens
// "Stated by the coach" into something warmer fails here.
import {
  credentialState, daysUntil, credentialBadge, credentialLine, expiryLine,
  sortCredentials, insuranceClaim, insuranceLine, credentialCounts,
  credentialsSummaryLine, validateDraft, draftProblemText, draftToRow,
  referenceAllowed, CLAIM_NOTE, CLAIM_NOTE_COACH, EXPIRING_SOON_DAYS,
  MAX_TITLE, type Credential, type CredentialDraft,
} from './coachCredentials';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-08-31';

const cred = (p: Partial<Credential>): Credential => ({
  id: 'c1', kind: 'certification', title: 'Level 3 Personal Trainer',
  issuer: 'CIMSPA', reference: 'R123456', issuedOn: '2019-06-01',
  expiresOn: null, verification: 'self_declared', ...p,
});

// ── The word this file is not allowed to say ───────────────────────────────
//
// Any inflection of verified/checked/confirmed/approved/accredited/validated
// next to a self-declared claim is the lie. Applied to the badge AND to the
// note above the list, because a reassuring paragraph does the same damage as a
// tick.
const CHECKED_WORDS = /verif|check|confirm|approv|accredit|validat|authentic/i;

const selfBadge = credentialBadge(cred({ verification: 'self_declared' }));
eq(selfBadge.checked, false, 'a self-declared claim is not marked checked');
ok(!CHECKED_WORDS.test(selfBadge.label),
  `a self-declared badge must not imply anybody checked it — got "${selfBadge.label}"`);
ok(/stated|claim|says|own/i.test(selfBadge.label),
  `a self-declared badge must say whose claim it is — got "${selfBadge.label}"`);

// The only row that may carry a checked badge is one nothing in the three apps
// can write: `authenticated` holds no grant on the verification columns.
const realBadge = credentialBadge(cred({ verification: 'verified' }));
eq(realBadge.checked, true, 'a verified row may be marked checked');

// The client-facing paragraph must state the negative outright. "Repple has not
// checked them" contains "check", so the assertion is on the sentence's sense:
// it has to contain a NOT.
ok(/not (seen|checked|verified)/i.test(CLAIM_NOTE),
  'the note a client reads must say plainly that Repple has not checked these');
ok(/not verif/i.test(CLAIM_NOTE_COACH),
  'the note the coach reads must say plainly that Repple does not verify it');

// ── Expiry: three answers, and the two that were one ───────────────────────
eq(credentialState(cred({ expiresOn: null }), TODAY), 'no-expiry',
  'a lifetime qualification has no expiry, which is not the same as being current');
eq(credentialState(cred({ expiresOn: '2026-03-04' }), TODAY), 'expired',
  'a date in the past is expired');
eq(credentialState(cred({ expiresOn: '2026-08-31' }), TODAY), 'expiring',
  'expiring today is not yet expired');
eq(credentialState(cred({ expiresOn: '2026-09-30' }), TODAY), 'expiring',
  'inside the warning window is expiring');
eq(credentialState(cred({ expiresOn: '2027-01-01' }), TODAY), 'current',
  'well in the future is current');

// The boundary itself, both sides, so the window cannot drift by a day.
const plus = (n: number) => new Date(Date.UTC(2026, 7, 31) + n * 86_400_000).toISOString().slice(0, 10);
eq(credentialState(cred({ expiresOn: plus(EXPIRING_SOON_DAYS) }), TODAY), 'expiring',
  'the last day of the window is inside it');
eq(credentialState(cred({ expiresOn: plus(EXPIRING_SOON_DAYS + 1) }), TODAY), 'current',
  'the day after the window is outside it');
eq(credentialState(cred({ expiresOn: plus(-1) }), TODAY), 'expired',
  'yesterday is expired');

// Dates are parsed at UTC midnight and compared against a day string, so the
// answer is the same in Auckland as in Los Angeles. npm test runs under three
// timezones; this is the assertion that would fail if a `new Date(y, m, d)`
// ever crept in.
eq(daysUntil('2026-09-01', TODAY), 1, 'one day out is one day, in every timezone');
eq(daysUntil('2026-08-31', TODAY), 0, 'today is zero days out');
eq(daysUntil(null, TODAY), null, 'no expiry has no countdown');
eq(daysUntil('not a date', TODAY), null, 'a malformed date has no countdown');

// ── The lines a screen prints ──────────────────────────────────────────────
eq(credentialLine(cred({})), 'CIMSPA · R123456', 'issuer then registration number');
eq(credentialLine(cred({ reference: null })), 'CIMSPA', 'no number, no separator left behind');
eq(credentialLine(cred({ issuer: null, reference: null })), '', 'nothing to say is an empty string, not "null"');
eq(credentialLine(cred({ issuer: '  ', reference: ' R1 ' })), 'R1', 'whitespace is not an issuer');

eq(expiryLine(cred({ expiresOn: null }), TODAY), 'No expiry date given',
  'a missing expiry is said out loud, not left blank');
ok(/expired/i.test(expiryLine(cred({ expiresOn: '2026-08-30' }), TODAY)),
  'an expired credential says so');
eq(expiryLine(cred({ expiresOn: '2026-09-01' }), TODAY), 'Expires in 1 day',
  'one day is singular');
eq(expiryLine(cred({ expiresOn: '2026-09-02' }), TODAY), 'Expires in 2 days',
  'two days is plural');
eq(expiryLine(cred({ expiresOn: '2026-08-31' }), TODAY), 'Expires today', 'today reads as today');
eq(expiryLine(cred({ expiresOn: '2026-08-30' }), TODAY), 'Expired 1 day ago', 'one day past is singular');

// The 'current' branch — the one this file used to skip, and therefore the one
// that shipped a database column into a sentence. "Valid to 2027-03-04 · Stated
// by the coach" is what a client read under a coach's certification, three
// siblings away from "Expires in 12 days".
eq(expiryLine(cred({ expiresOn: '2027-03-04' }), TODAY), 'Valid to 4 Mar 2027',
  'a current certification names its date in words, not as an ISO column');
eq(expiryLine(cred({ expiresOn: '2027-12-25' }), TODAY), 'Valid to 25 Dec 2027',
  'a two-digit day loses no leading zero and gains no padding');
ok(!/\d{4}-\d{2}-\d{2}/.test(expiryLine(cred({ expiresOn: '2027-03-04' }), TODAY)),
  'and no branch of this function may print a YYYY-MM-DD at all');
// A date the column should not hold, but might: unparseable is the same answer
// as absent, because "Valid to" with nothing after it is worse than either.
eq(expiryLine(cred({ expiresOn: '2027-13-04' }), TODAY), 'No expiry date given',
  'a month that is not a month is not a date');

// ── Sorting: an expired claim is shown, just not first ─────────────────────
const sorted = sortCredentials([
  cred({ id: 'lapsed', title: 'Lapsed', expiresOn: '2020-01-01' }),
  cred({ id: 'lifetime', title: 'Lifetime', expiresOn: null }),
  cred({ id: 'soon', title: 'Soon', expiresOn: '2026-09-05' }),
  cred({ id: 'later', title: 'Later', expiresOn: '2028-01-01' }),
], TODAY);
eq(sorted.map((c) => c.id).join(','), 'soon,later,lifetime,lapsed',
  'soonest expiry first, undated after the dated ones, expired last');
// Sorting must not mutate the caller's array — a screen re-sorting on every
// render would otherwise shuffle a list under somebody's finger.
//
// The fixture is deliberately in the WRONG order for the sort: a lifetime
// qualification sorts after a dated one, so sortCredentials has to move these
// two. It used to be written the other way round, already sorted, which meant
// `list.sort()` in place — the exact regression this guards — left element 0
// where it was and the assertion passed. A no-op check on an already-sorted
// array is not a check that the array was left alone.
const original = [cred({ id: 'a', title: 'A', expiresOn: null }), cred({ id: 'b', title: 'B', expiresOn: '2027-01-01' })];
const sortedCopy = sortCredentials(original, TODAY);
eq(sortedCopy.map((c) => c.id).join(','), 'b,a', 'the returned list is genuinely reordered, so there is something to have mutated');
eq(original.map((c) => c.id).join(','), 'a,b', 'and the caller’s own array is untouched, in full and in order');
ok(sortedCopy !== original, 'the sort hands back a new array rather than the one it was given');

// ── Insurance: the answer a gym asks for ───────────────────────────────────
//
// The important one is the first: a failed read is NOT "no insurance stated".
// That sentence, printed about a coach whose row simply did not load, is a
// statement about their professional standing.
eq(insuranceClaim(null, TODAY), 'unknown', 'an unread list says nothing about insurance');
eq(insuranceClaim([], TODAY), 'none-stated', 'a read that came back empty is a real "none stated"');
eq(insuranceClaim([cred({ kind: 'insurance', expiresOn: '2027-01-01' })], TODAY), 'stated', 'live cover is stated');
eq(insuranceClaim([cred({ kind: 'insurance', expiresOn: '2020-01-01' })], TODAY), 'lapsed', 'expired cover is not current cover');
eq(insuranceClaim([cred({ kind: 'insurance', expiresOn: null })], TODAY), 'stated',
  'cover with no end date is still a claim of cover');
eq(insuranceClaim([
  cred({ kind: 'insurance', expiresOn: '2020-01-01' }),
  cred({ kind: 'insurance', expiresOn: '2027-01-01' }),
], TODAY), 'stated', 'one live policy alongside an old one is live cover');
eq(insuranceClaim([cred({ kind: 'certification' })], TODAY), 'none-stated',
  'a certification is not insurance');

for (const claim of ['unknown', 'none-stated', 'lapsed', 'stated'] as const) {
  const line = insuranceLine(claim);
  ok(line.length > 0, `${claim} has something to say`);
  if (claim === 'stated') {
    ok(/not checked|not verif/i.test(line),
      `even the good answer has to carry the caveat — got "${line}"`);
  }
  if (claim === 'unknown') {
    ok(!/no insurance/i.test(line),
      `an unreadable list must never read as "no insurance" — got "${line}"`);
  }
}

// ── Counts, which may not be computed off an unread list ───────────────────
eq(credentialCounts(null, TODAY), null, 'nothing is counted from a list we do not have');
const counts = credentialCounts([
  cred({ kind: 'certification', expiresOn: null }),
  cred({ kind: 'certification', expiresOn: '2020-01-01' }),
  cred({ kind: 'insurance', expiresOn: '2027-01-01' }),
], TODAY)!;
eq(counts.certifications, 2, 'both certifications counted, expired included');
eq(counts.insurance, 1, 'the insurance policy counted');
eq(counts.expired, 1, 'the lapsed one counted as lapsed');

eq(credentialsSummaryLine(null, TODAY), null, 'no summary from an unread list');
eq(credentialsSummaryLine([], TODAY), null, 'no summary where there is nothing to summarise');
eq(credentialsSummaryLine([cred({ expiresOn: null })], TODAY), '1 qualification stated',
  'one qualification is singular and says "stated"');
eq(credentialsSummaryLine([
  cred({ id: '1', expiresOn: null }),
  cred({ id: '2', expiresOn: null }),
  cred({ id: '3', kind: 'insurance', expiresOn: '2027-01-01' }),
], TODAY), '2 qualifications and insurance stated', 'both halves, still "stated"');
eq(credentialsSummaryLine([cred({ expiresOn: '2020-01-01' })], TODAY), null,
  'a lapsed qualification alone does not become a summary line boasting one');
{
  const line = credentialsSummaryLine([cred({ expiresOn: null })], TODAY)!;
  ok(!CHECKED_WORDS.test(line), `the directory summary must not imply a check — got "${line}"`);
}

// ── Reference numbers: published for a certification, refused for a policy ─
eq(referenceAllowed('certification'), true, 'a registration number is checkable by the reader');
eq(referenceAllowed('insurance'), false, 'a policy number is checkable by nobody');

const draft = (p: Partial<CredentialDraft>): CredentialDraft => ({
  kind: 'certification', title: 'Level 3 PT', issuer: 'CIMSPA',
  reference: 'R1', issuedOn: '2019-06-01', expiresOn: '', ...p,
});

eq(validateDraft(draft({})), 'ok', 'a filled-in certification is fine');
eq(validateDraft(draft({ title: '   ' })), 'no-title', 'a claim needs a name');
eq(validateDraft(draft({ title: 'x'.repeat(MAX_TITLE + 1) })), 'title-too-long', 'a name has a limit');
eq(validateDraft(draft({ kind: 'insurance', reference: 'POL-9' })), 'reference-not-allowed',
  'a policy number is refused before it can be published');
eq(validateDraft(draft({ kind: 'insurance', reference: '' })), 'ok',
  'insurance without a number is exactly right');
eq(validateDraft(draft({ issuedOn: '01/06/2019' })), 'bad-issued', 'dates are YYYY-MM-DD');
eq(validateDraft(draft({ expiresOn: 'soon' })), 'bad-expires', 'so are expiry dates');
eq(validateDraft(draft({ issuedOn: '2026-01-01', expiresOn: '2025-01-01' })), 'expires-before-issued',
  'a credential cannot expire before it was issued');
eq(validateDraft(draft({ issuedOn: '', expiresOn: '' })), 'ok', 'both dates are optional');

// Every problem has a sentence, and 'ok' is the only empty one. A refusal with
// no explanation is a form that cannot be completed.
for (const p of ['ok', 'no-title', 'title-too-long', 'issuer-too-long', 'reference-too-long',
                 'reference-not-allowed', 'bad-issued', 'bad-expires', 'expires-before-issued'] as const) {
  eq(draftProblemText(p).length === 0, p === 'ok', `${p} says why`);
}

// ── The row that reaches the database ──────────────────────────────────────
const row = draftToRow(draft({ kind: 'insurance', reference: 'POL-9', issuer: ' Insure4Sport ' }), 'coach-1');
eq(row.reference, null, 'a policy number is dropped on the way to the database, not merely hidden');
eq(row.issuer, 'Insure4Sport', 'the issuer is trimmed');
eq(row.expires_on, null, 'an empty date is null, not an empty string the column would refuse');
eq(draftToRow(draft({}), 'coach-1').reference, 'R1', 'a certification keeps its registration number');
// The three verification columns must never appear in a written row: the
// database refuses them (authenticated holds no grant), and PostgREST rejects
// the WHOLE row for one column it will not take, so a stray key here would lose
// the credential rather than just the field.
{
  const keys = Object.keys(draftToRow(draft({}), 'coach-1'));
  for (const forbidden of ['verification', 'verified_at', 'verified_by']) {
    ok(!keys.includes(forbidden), `a written row must not name ${forbidden}`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`coachCredentials: ok (${sorted.length} sorted, window ${EXPIRING_SOON_DAYS}d)`);
