// A coach's page on the open web, and the three things that must never reach
// one. Compile with tsc, run with node.
//
// Most of this file is ordinary assertions about pure functions. The last two
// sections are not, and they are the reason it exists: they read
// `supabase/parts/340-a-page-a-coach-can-put-in-their-bio.sql` and
// `web/coach.html` and hold both against this module.
//
// WHY THAT IS NECESSARY. `web/` is a static site with no build step, so the
// page cannot import anything from `src/`; it carries its own copy of every
// sentence and every threshold. That is the duplicate `joinPage.test.ts` was
// written for, and the same argument applies here with more at stake — the
// copies are the wording a stranger reads about a named person, at a URL with
// no sign-in in front of it.
//
// The three refusals asserted below, in the order they matter:
//
//   1. NO REVIEWER REACHES THE PAGE. Not a name, not a body, not a gym, not a
//      reply. The function's return type is read out of the SQL and checked
//      against a list of columns that must not be in it, and the page is
//      checked for any mention of them.
//   2. NOTHING CLAIMS REPPLE CHECKED ANYTHING, and nothing expired reads as
//      current. Held at both ends: the SQL filters, and publishableCredentials
//      filters.
//   3. THE DIRECTORY OPT-IN IS NOT CONSENT TO THIS. There is no input to
//      publicPageState that produces 'live' without `listed`, and the SQL's
//      where clause is checked for both conditions.
import {
  HANDLE_MIN, HANDLE_MAX, RESERVED_HANDLES,
  normaliseHandle, handleProblem, handleProblemText,
  publicPageUrl, publicJoinUrl,
  publicPageState, publicPageStateNote,
  PUBLISHED_FIELDS, WITHHELD_FIELDS,
  asPublishResult, publishOutcome,
  publishableCredentials, PUBLIC_CLAIM_NOTE, PUBLIC_REVIEW_NOTE,
  publicFee, pageState, pageStateEyebrow, pageStateHeading, pageStateNote,
  type PublishResult, type PageState,
} from './publicProfile';
import { MIN_FOR_AVERAGE } from './reviews';
import { AA_TEXT } from './a11y';
import type { Credential } from './coachCredentials';

// See the note in src/lib/joinPage.test.ts: this module is compiled twice, and
// `import { readFileSync } from 'node:fs'` fails the root typecheck that has no
// Node types in scope. A locally declared `require` satisfies both.
declare function require(id: string): any;
const fs = require('node:fs') as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-01';

const cred = (p: Partial<Credential>): Credential => ({
  id: 'c1', kind: 'certification', title: 'Level 3 Personal Trainer',
  issuer: 'CIMSPA', reference: 'R123456', issuedOn: '2019-06-01',
  expiresOn: null, verification: 'self_declared', ...p,
});

// ═══════════════════════════════════════════════════════════════════════════
// The address
// ═══════════════════════════════════════════════════════════════════════════

eq(normaliseHandle('  Jas Fitness  '), 'jas-fitness',
  'a space is a seam and becomes a hyphen, not nothing');
eq(normaliseHandle('Jas!!Fitness'), 'jasfitness', 'anything the column cannot hold is removed');
eq(normaliseHandle('jas--fitness'), 'jas-fitness', 'a run of hyphens collapses');
eq(normaliseHandle(null), '', 'null is not a handle');
ok(normaliseHandle('x'.repeat(80)).length === HANDLE_MAX, 'a handle is cut to the length the column allows');

eq(handleProblem(normaliseHandle('jas-fitness')), 'ok', 'an ordinary handle is fine');
eq(handleProblem(''), 'empty', 'no handle is its own answer');
eq(handleProblem('ab'), 'too-short', `${HANDLE_MIN} is the floor`);
eq(handleProblem('a'.repeat(HANDLE_MAX + 1)), 'too-long', `${HANDLE_MAX} is the ceiling`);
eq(handleProblem('-jas'), 'edge-hyphen', 'a leading hyphen is refused');
eq(handleProblem('jas-'), 'edge-hyphen', 'so is a trailing one');
eq(handleProblem('support'), 'reserved', 'a coach may not take one of our own pages');
eq(handleProblem('join'), 'reserved', 'least of all the one their own link points at');

// Every problem has a sentence, and none of them is blank.
for (const p of ['empty', 'too-short', 'too-long', 'edge-hyphen', 'reserved'] as const) {
  ok(handleProblemText(p).trim().length > 10, `${p} has a real sentence behind it`);
}
eq(handleProblemText('ok'), '', 'there is nothing to say about a handle that is fine');

// Every reserved word must itself be a handle-SHAPED string, or it reserves
// nothing: `handleProblem` only ever compares the normalised form.
for (const r of RESERVED_HANDLES) {
  eq(normaliseHandle(r), r, `the reserved word ${JSON.stringify(r)} is not in the form a handle takes, so it reserves nothing`);
}
ok(new Set(RESERVED_HANDLES).size === RESERVED_HANDLES.length, 'the reserved list has no duplicates');

eq(publicPageUrl('https://www.repplefitness.com', 'jas-fitness'),
  'https://www.repplefitness.com/coach?h=jas-fitness', 'the address a coach puts in a bio');
eq(publicPageUrl('https://www.repplefitness.com/', 'jas-fitness'),
  'https://www.repplefitness.com/coach?h=jas-fitness', 'a trailing slash does not produce a double one');
eq(publicPageUrl('https://www.repplefitness.com', 'support'), null,
  'a reserved handle has no address');
eq(publicPageUrl('https://www.repplefitness.com', ''), null, 'and neither has none');
eq(publicPageUrl('', 'jas-fitness'), null, 'nor an origin nobody supplied');

// The join link is the point of the page, and it is only a link when it carries
// a code — see codeFromUrl in src/lib/adMatch.ts for what reads it.
eq(publicJoinUrl('https://www.repplefitness.com', 'e32zmz'),
  'https://www.repplefitness.com/join?c=E32ZMZ', 'a code is uppercased on the way into the link');
eq(publicJoinUrl('https://www.repplefitness.com', null), null,
  'no code, no button: /join with nothing in it loses the attribution the page exists for');
eq(publicJoinUrl('https://www.repplefitness.com', 'no'), null, 'a fragment of a code is not a code');

// ═══════════════════════════════════════════════════════════════════════════
// Consent: the directory opt-in is not consent to the open web
// ═══════════════════════════════════════════════════════════════════════════
//
// The most important block in this file. A coach who has not switched on Find a
// Trainer has no page, whatever else is true, and there is no combination of
// inputs that says otherwise.

eq(publicPageState({ listed: false, handle: 'jas-fitness', on: true }), 'off-directory',
  'a page cannot be live for a coach who is not in the directory');
eq(publicPageState({ listed: false, handle: 'jas-fitness', on: false }), 'off-directory',
  'and the reason given is the directory, not the switch');
eq(publicPageState({ listed: true, handle: null, on: true }), 'no-address',
  'a page switched on with no address is not a page');
eq(publicPageState({ listed: true, handle: 'jas-fitness', on: false }), 'ready',
  'an address with the switch off publishes nothing');
eq(publicPageState({ listed: true, handle: 'jas-fitness', on: true }), 'live',
  'both switches and an address is the only way to be live');
eq(publicPageState({ listed: true, handle: 'support', on: true }), 'no-address',
  'a reserved handle is not an address, however the switches sit');

for (const s of ['off-directory', 'no-address', 'ready', 'live'] as const) {
  ok(publicPageStateNote(s).trim().length > 20, `${s} is explained to the coach`);
}
ok(/live/i.test(publicPageStateNote('live')), 'the live state says so');
ok(!/\blive\b/i.test(publicPageStateNote('ready')),
  'a page that is off must not be described with the word live');

// What a coach is shown before they publish. This IS the consent, so it has to
// name the things somebody would be surprised by.
ok(PUBLISHED_FIELDS.length >= 6, 'the coach is shown what goes on the page, item by item');
ok(PUBLISHED_FIELDS.some((f) => /currency/i.test(f)),
  'the rate is described as inseparable from its currency');
ok(PUBLISHED_FIELDS.some((f) => /join code/i.test(f)),
  'the join code is on the page and the coach is told so');
ok(WITHHELD_FIELDS.some((f) => /review/i.test(f) && /wrote|name/i.test(f)),
  'the first thing a coach is told is withheld is what their clients wrote');
ok(WITHHELD_FIELDS.some((f) => /expired/i.test(f)), 'and that an expired claim does not appear');
ok(WITHHELD_FIELDS.some((f) => /checked/i.test(f)),
  'and that nothing there says Repple checked anything');

// ═══════════════════════════════════════════════════════════════════════════
// The switch's answers
// ═══════════════════════════════════════════════════════════════════════════

eq(asPublishResult('published'), 'published', 'a word the server can send is kept');
eq(asPublishResult('nonsense'), 'failed', 'anything else is a failure, not a success');
eq(asPublishResult(null), 'failed', 'and so is nothing at all');
eq(asPublishResult(undefined), 'failed', 'and so is an absent answer');

const ALL_RESULTS: PublishResult[] = [
  'published', 'saved', 'cleared', 'taken', 'invalid', 'reserved',
  'needs_directory', 'not_a_coach', 'signed_out', 'failed',
];
for (const r of ALL_RESULTS) {
  const o = publishOutcome(r, 'jas-fitness');
  ok(o.title.trim().length > 0 && o.body.trim().length > 0, `${r} has a title and a body`);
}
// `changed` is the flag a screen re-reads on. Exactly three results wrote.
const CHANGED = ALL_RESULTS.filter((r) => publishOutcome(r, 'jas').changed);
eq(JSON.stringify(CHANGED), JSON.stringify(['published', 'saved', 'cleared']),
  'only the three results that wrote something report a change');
ok(!publishOutcome('failed', 'jas').changed,
  'a call that did not land changed nothing, and must not send the screen to re-read as though it had');
ok(/Find a Trainer/.test(publishOutcome('needs_directory', 'jas').body),
  'refusing to publish an unlisted coach says which switch to press');

// ═══════════════════════════════════════════════════════════════════════════
// Credentials: nothing expired, nothing that claims a check
// ═══════════════════════════════════════════════════════════════════════════

eq(publishableCredentials(null, TODAY), null,
  'a failed read publishes nothing, and is NOT an empty list of claims');
{
  const list = [
    cred({ id: 'live', expiresOn: '2027-01-01' }),
    cred({ id: 'gone', expiresOn: '2026-01-01' }),
    cred({ id: 'lifetime', expiresOn: null }),
    cred({ id: 'insurance', kind: 'insurance', expiresOn: '2026-08-31' }),
  ];
  const out = publishableCredentials(list, TODAY)!;
  eq(JSON.stringify(out.map((c) => c.id)), JSON.stringify(['live', 'lifetime']),
    'an expired certification and an expired insurance policy are both dropped');
}
{
  // The boundary. `credentialState` calls the expiry day itself 'expiring', not
  // 'expired', so a certificate that runs out today is still publishable today
  // and gone tomorrow.
  const today = publishableCredentials([cred({ expiresOn: TODAY })], TODAY)!;
  eq(today.length, 1, 'a credential expiring today has not expired today');
  const yesterday = publishableCredentials([cred({ expiresOn: '2026-08-31' })], TODAY)!;
  eq(yesterday.length, 0, 'and has by the next morning');
}
{
  const out = publishableCredentials([cred({ verification: 'verified' })], TODAY)!;
  eq(out.length, 0,
    'a row somebody marked verified is not published: this page has one fixed sentence and it says nobody checked');
}

const CHECKED_WORDS = /verif|check|confirm|approv|accredit|validat|authentic/i;
ok(CHECKED_WORDS.test(PUBLIC_CLAIM_NOTE),
  'the note on the page uses one of those words — as a DENIAL, which the next assertion pins down');
ok(/has not (seen|checked)/i.test(PUBLIC_CLAIM_NOTE),
  'and it is a denial: "Repple has not seen the certificates and has not checked them"');
ok(!/we have checked|repple has checked|verified by/i.test(PUBLIC_CLAIM_NOTE),
  'nothing in it can be read as a claim that anybody checked anything');
ok(/ask to see them|look the registration number up/i.test(PUBLIC_CLAIM_NOTE),
  'and it tells the reader what to do instead, which is the whole point of publishing the number');

// ═══════════════════════════════════════════════════════════════════════════
// Reviews: an aggregate and nothing else
// ═══════════════════════════════════════════════════════════════════════════

ok(/does not publish/i.test(PUBLIC_REVIEW_NOTE),
  'the page says the withholding is a refusal, not an absence of reviews');
ok(/who they are|their name/i.test(PUBLIC_REVIEW_NOTE),
  'and names the reviewer as the reason');
ok(!/no reviews|nothing to show/i.test(PUBLIC_REVIEW_NOTE),
  'the note must never read as "this coach has nothing"');

// ═══════════════════════════════════════════════════════════════════════════
// A price never appears without its currency
// ═══════════════════════════════════════════════════════════════════════════

eq(JSON.stringify(publicFee(60, 'gbp')), JSON.stringify({ amount: 60, currency: 'GBP' }),
  'a rate and a currency is a price');
eq(publicFee(60, null), null,
  'a rate with no currency does not appear: white-label means the reader would supply their own');
eq(publicFee(60, ''), null, 'nor with a blank one');
eq(publicFee(60, 'pounds'), null, 'nor with something that is not an ISO code');
eq(publicFee(0, 'GBP'), null,
  'zero is an unset rate, not a coach who works for nothing — three production rows still hold one');
eq(publicFee(null, 'GBP'), null, 'and no rate is no price');
eq(publicFee(-5, 'GBP'), null, 'and a negative one is not a rate at all');

// ═══════════════════════════════════════════════════════════════════════════
// The four things the page can be
// ═══════════════════════════════════════════════════════════════════════════
//
// 'absent' and 'unreadable' are the pair. One is a fact about the coach; the
// other is a fact about our server, and they must never be the same sentence.

eq(pageState('loading', 'jas-fitness', false), 'loading', 'a read in flight is its own answer');
eq(pageState('ready', 'jas-fitness', true), 'ready', 'a row came back');
eq(pageState('ready', 'jas-fitness', false), 'absent', 'a completed read with no row is genuinely nobody');
eq(pageState('error', 'jas-fitness', false), 'unreadable', 'a failed read says nothing about the coach');
eq(pageState('error', 'jas-fitness', true), 'unreadable', 'and rows in hand under an error are not confirmation');
eq(pageState('partial', 'jas-fitness', true), 'unreadable',
  'a truncated read is not a profile either, even though this function cannot produce one today');
eq(pageState('ready', '', true), 'no-address', 'a link with no handle on it is a fourth thing');
eq(pageState('ready', 'support', true), 'no-address', 'and so is one carrying a reserved word');

ok(pageStateNote('absent') !== pageStateNote('unreadable'),
  'THE assertion: "there is no coach here" and "we could not read it" are two sentences');
ok(pageStateHeading('absent') !== pageStateHeading('unreadable'), 'and two headings');
for (const s of ['absent', 'unreadable', 'no-address'] as const) {
  ok((pageStateNote(s) ?? '').trim().length > 20, `${s} explains itself`);
  ok((pageStateHeading(s) ?? '').trim().length > 5, `${s} has a heading`);
  ok((pageStateEyebrow(s) ?? '').trim().length > 0, `${s} has a kicker`);
}
for (const s of ['ready', 'loading'] as const) {
  eq(pageStateNote(s), null, `${s} has no failure sentence`);
  eq(pageStateHeading(s), null, `${s} has no failure heading`);
  eq(pageStateEyebrow(s), null, `${s} has no failure kicker`);
}
ok(!/coach has|they have no|nothing to show/i.test(pageStateNote('unreadable') ?? ''),
  'the failed-read sentence says nothing whatsoever about the coach');
ok(/our end/i.test(pageStateNote('unreadable') ?? ''), 'it says whose fault it is');

// ═══════════════════════════════════════════════════════════════════════════
// Held against supabase/parts/340
// ═══════════════════════════════════════════════════════════════════════════

const SQL_CANDIDATES = [
  process.cwd() + '/supabase/parts/340-a-page-a-coach-can-put-in-their-bio.sql',
  process.cwd() + '/../supabase/parts/340-a-page-a-coach-can-put-in-their-bio.sql',
];
const sqlPath = SQL_CANDIDATES.find((p) => fs.existsSync(p));
ok(!!sqlPath, `part 340 not found — looked in ${SQL_CANDIDATES.join(' and ')}`);
const sql = sqlPath ? fs.readFileSync(sqlPath, 'utf8') : '';

/** The SQL with `-- ` comments stripped, so a column NAMED in prose does not
 *  count as a column the function returns. The header of that file discusses
 *  `client_id` and `reviewer_name` at length, on purpose. */
const sqlCode = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

// ── the reserved list exists once ──────────────────────────────────────────
{
  const m = /create or replace function public\.reserved_public_handles\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(sql);
  ok(!!m, 'reserved_public_handles() does not have the array literal this test reads');
  if (m) {
    const fromSql = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    eq(JSON.stringify([...fromSql].sort()), JSON.stringify([...RESERVED_HANDLES].sort()),
      'RESERVED_HANDLES and reserved_public_handles() have parted company — the server is the authority, and the app would be offering a coach a handle it will refuse');
  }
}

// ── the shape the column allows is the shape this module produces ──────────
{
  const m = /public_handle ~ '(\^[^']+\$)'/.exec(sql);
  ok(!!m, 'the CHECK constraint on trainers.public_handle does not carry a regex this test can read');
  if (m) {
    const re = new RegExp(m[1]);
    // Anything this module calls 'ok' must survive the column, or a coach is
    // told their handle is fine and the write is refused.
    for (const h of ['jas-fitness', 'abc', 'a1b', 'x'.repeat(HANDLE_MAX), 'jas-fitness-2026']) {
      const mine = handleProblem(normaliseHandle(h)) === 'ok';
      eq(re.test(h), mine, `the column and handleProblem disagree about ${JSON.stringify(h)}`);
    }
    for (const h of ['ab', '-jas', 'jas-', 'Jas', 'jas fitness', 'x'.repeat(HANDLE_MAX + 1)]) {
      ok(!re.test(h), `the column would accept ${JSON.stringify(h)}, which this module refuses`);
    }
  }
}

// ── the read is gated on BOTH switches ─────────────────────────────────────
{
  const m = /create or replace function public\.public_coach_page\(p_handle text\)([\s\S]*?)\$function\$;/.exec(sqlCode);
  ok(!!m, 'public_coach_page() is not in part 340 in the shape this test reads');
  const body = m ? m[1] : '';

  ok(/t\.listed\s*=\s*true/.test(body),
    'public_coach_page() does not require listed = true, so a coach who left the directory would still have a page');
  ok(/t\.public_page\s*=\s*true/.test(body),
    'public_coach_page() does not require public_page = true, so the directory opt-in alone would publish somebody to the open web');

  // ── NO REVIEWER REACHES THE PAGE ────────────────────────────────────────
  //
  // The function's declared return type is the contract. Nothing in it may name
  // a person other than the coach, or anything a client wrote.
  const rt = /returns table \(([\s\S]*?)\)\s*language sql/.exec(body);
  ok(!!rt, 'public_coach_page() has no readable returns-table declaration');
  const returned = rt
    ? rt[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)
    : [];
  ok(returned.length > 0, 'the return type parsed to nothing, which would make the next check vacuous');

  const FORBIDDEN = [
    'client_id', 'reviewer', 'reviewer_name', 'review_id', 'review_body',
    'body', 'coach_reply', 'coach_replied_at', 'other_gym', 'tenant_name',
    'verified_by', 'verified_at', 'verification', 'avatar', 'email', 'phone',
  ];
  for (const f of FORBIDDEN) {
    ok(!returned.includes(f),
      `public_coach_page() returns ${f} to an unauthenticated caller. Reviews are anonymous by construction (part 139) and this page publishes a count and a sum only.`);
  }
  ok(returned.includes('rating_count') && returned.includes('rating_sum'),
    'the review aggregate is a count and a sum, so src/lib/reviews.ts decides what it may be made to say');

  // The credential filter, at the end it cannot be bypassed from.
  ok(/k\.verification = 'self_declared'/.test(body),
    'part 340 does not restrict published credentials to self-declared rows');
  ok(/k\.expires_on is null or k\.expires_on >= current_date/.test(body),
    'part 340 does not filter expired credentials out, so a lapsed certificate could be published as though it were current');
  ok(/withdrawn_at is null/.test(body),
    'a withdrawn review is still being counted');
}

// ── who may call what ──────────────────────────────────────────────────────
ok(/\[anon entry point\]/.test(sql),
  'public_coach_page() has no [anon entry point] marker, so part 141\'s sweep would revoke anon and switch the page off silently');
ok(/grant\s+execute on function public\.public_coach_page\(text\) to anon, authenticated;/.test(sqlCode),
  'the page cannot be read without a grant to anon');
ok(/revoke execute on function public\.set_my_public_page\(text, boolean\) from public, anon;/.test(sqlCode),
  'set_my_public_page() must not be reachable by anon: it writes a coach\'s row');
ok(/grant select \(public_page, public_handle\) on public\.trainers to authenticated;/.test(sqlCode),
  'the two new columns are not in the SELECT grant, so the coach\'s own screen would be refused 42501 (part 151)');
ok(!/grant update \([^)]*public_handle/.test(sqlCode),
  'public_handle has an UPDATE grant, which would let the profile screen\'s fire-and-forget write claim a taken handle and swallow the error');

// ═══════════════════════════════════════════════════════════════════════════
// Held against web/coach.html
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_CANDIDATES = [
  process.cwd() + '/web/coach.html',
  process.cwd() + '/../web/coach.html',
];
const pagePath = PAGE_CANDIDATES.find((p) => fs.existsSync(p));
ok(!!pagePath, `web/coach.html not found — looked in ${PAGE_CANDIDATES.join(' and ')}`);
const page = pagePath ? fs.readFileSync(pagePath, 'utf8') : '';

/** The handful of entities the page's attributes use, decoded the way a browser
 *  decodes them before `dataset` hands the value over. */
const decode = (s: string) =>
  s.replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

/**
 * The page with its HTML and JavaScript block comments removed.
 *
 * The checks below are about what the page DOES, and that file documents itself
 * at length: its own header says "nothing on this page assigns innerHTML",
 * which a search of the raw text reads as an offence. Comments are stripped for
 * the same reason scripts/check-reachable.mjs strips them — prose about a thing
 * is not the thing.
 */
const pageCode = page
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

// ── the six sentences a reader gets when there is no profile ───────────────
{
  const tag = /<div id="nothing"([\s\S]*?)>/.exec(page);
  ok(!!tag, 'web/coach.html has no #nothing element carrying the failure copy');
  const attrs = new Map<string, string>();
  if (tag) {
    for (const m of tag[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)) attrs.set(m[1], decode(m[2]));
  }
  const PAIRS: Array<[PageState, string]> = [
    ['absent', 'absent'],
    ['unreadable', 'unreadable'],
    ['no-address', 'noaddress'],
  ];
  for (const [state, key] of PAIRS) {
    eq(attrs.get(`${key}-eyebrow`), pageStateEyebrow(state), `web/coach.html's ${key} kicker`);
    eq(attrs.get(`${key}-hd`), pageStateHeading(state), `web/coach.html's ${key} heading`);
    eq(attrs.get(`${key}-note`), pageStateNote(state), `web/coach.html's ${key} sentence`);
  }
}

// ── the two notes that carry promises ──────────────────────────────────────
ok(page.includes(PUBLIC_CLAIM_NOTE),
  'web/coach.html no longer carries PUBLIC_CLAIM_NOTE verbatim, so the page and this module disagree about what Repple has checked');
ok(page.includes(PUBLIC_REVIEW_NOTE),
  'web/coach.html no longer carries PUBLIC_REVIEW_NOTE verbatim, so the page may now read as a coach with no reviews');

// ── the thresholds the page carries its own copy of ────────────────────────
{
  const m = /const MIN_FOR_AVERAGE = (\d+);/.exec(page);
  ok(!!m, 'web/coach.html does not declare MIN_FOR_AVERAGE where this test can read it');
  if (m) {
    eq(Number(m[1]), MIN_FOR_AVERAGE,
      'the page would average a number of reviews src/lib/reviews.ts refuses to average');
  }
}
{
  const m = /const AA_TEXT = ([\d.]+);/.exec(page);
  ok(!!m, 'web/coach.html does not declare AA_TEXT where this test can read it');
  if (m) {
    eq(Number(m[1]), AA_TEXT,
      'the page would accept a coach accent colour no label can be read on');
  }
}

// ── the page asks for exactly one thing, and it is not the reviews ─────────
{
  const calls = [...page.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1]);
  eq(JSON.stringify(calls), JSON.stringify(['public_coach_page']),
    'web/coach.html calls something other than public_coach_page — every other RPC in this database is behind a sign-in');
}
for (const f of ['coach_reviews_for', 'coach_review_summary', 'my_review_of', 'coach_reviews']) {
  ok(!pageCode.includes(f),
    `web/coach.html names ${f}. Those are the readers that carry a reviewer's first name and they are revoked from anon for that reason.`);
}
for (const f of ['reviewer_name', 'client_id', 'coach_reply', 'other_gym']) {
  ok(!pageCode.includes(f), `web/coach.html names ${f}, which no reader of a public URL may ever be handed`);
}

// ── nothing on this page is written as markup ──────────────────────────────
//
// A coach's bio, tagline, specialties and credential titles are all free text
// somebody typed, and they are drawn at our own origin.
ok(!/\binnerHTML\b/.test(pageCode),
  'web/coach.html assigns innerHTML somewhere. Every value here comes from a field a person types into; textContent is the whole defence.');
ok(!/\bdocument\.write\b/.test(pageCode), 'web/coach.html calls document.write');
ok(!/\binsertAdjacentHTML\b/.test(pageCode), 'web/coach.html calls insertAdjacentHTML');

// ── the join link, which is the point of the page ──────────────────────────
ok(/'\/join\?c=' \+ encodeURIComponent\(code\)/.test(pageCode),
  'web/coach.html no longer builds the join link with the coach\'s code, so an arrival from their own bio would be unattributed');

// ── the stylesheet contract scripts/stamp-css.mjs enforces ─────────────────
ok(/href="styles\.css(\?v=[a-f0-9]+)?"/.test(page),
  'web/coach.html has no stylesheet link, so it would render unstyled and scripts/stamp-css.mjs would fail');

// ── the site brand table, byte-identical to the join page's ────────────────
//
// joinPage.test.ts holds web/join.html's copy against src/lib/brands.ts. Rather
// than repeat that whole comparison, this asserts the two pages carry the SAME
// block — so the join page stays the single place the table is checked, and
// this page cannot drift away from it and serve a chain's coach Repple's
// wordmark.
{
  const BLOCK = /<script type="application\/json" id="site-brands">([\s\S]*?)<\/script>/;
  const joinCandidates = [process.cwd() + '/web/join.html', process.cwd() + '/../web/join.html'];
  const joinPath = joinCandidates.find((p) => fs.existsSync(p));
  ok(!!joinPath, 'web/join.html not found, so the brand table could not be compared');
  const mine = BLOCK.exec(page);
  const theirs = joinPath ? BLOCK.exec(fs.readFileSync(joinPath, 'utf8')) : null;
  ok(!!mine, 'web/coach.html has no site-brands block, so a chain\'s host would render Repple\'s wordmark');
  ok(!!theirs, 'web/join.html has no site-brands block');
  if (mine && theirs) {
    eq(mine[1], theirs[1],
      'the brand tables in web/coach.html and web/join.html have parted company. joinPage.test.ts only checks the join page, so a drift here is unchecked against src/lib/brands.ts.');
  }
}

if (errors.length) {
  console.error(`publicProfile: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('publicProfile: ok');
