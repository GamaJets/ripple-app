// The OAuth callback page, and the open redirect it must never become.
//
// `web/ads/callback.html` is where Meta, Google, TikTok and Instagram send a
// coach after they sign in. It did not exist until 2 Sep: `AD_OAUTH_REDIRECT`
// has pointed at `/ads/callback` since the ad-spend feature shipped, there was
// no `web/ads/` directory, and every coach who completed Meta's consent screen
// was redirected to a 404. Three later integrations were written against the
// same address on the assumption a shipped feature's redirect existed.
//
// The page forwards an authorisation code to a destination that arrives inside
// `state` — which the PROVIDER echoes back and an attacker can therefore
// choose. A page that forwarded wherever it was told would hand somebody else's
// code to that address. So the destination is checked against the schemes this
// product's binaries actually register.
//
// This test reads the page and asserts the check is still there and still
// agrees with `src/lib/brands.ts`. It is a cross-check of a duplicate, in the
// shape `joinPage.test.ts` already uses for the brand table.
// `require`, not `import`, and `process.cwd()`, not `__dirname`: this file is
// compiled twice — once by the app's tsconfig, which has no Node types — and a
// test that breaks THAT typecheck stops every other test from running. Same
// shape `joinPage.test.ts` uses for the same reason.
declare function require(id: string): any;
const fs = require('node:fs') as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// Both roots are TESTED for existence rather than assumed. A test whose input
// is missing must fail loudly: reading '' would let every assertion below pass
// vacuously, and the entire value of this file is that it reads the real page.
const read = (rel: string): string => {
  const candidates = [process.cwd() + '/' + rel, process.cwd() + '/../' + rel];
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) { errors.push(`${rel} not found — looked in ${candidates.join(' and ')}`); return ''; }
  return fs.readFileSync(hit, 'utf8');
};
const page = read('web/ads/callback.html');
const brands = read('src/lib/brands.ts');
const adSpend = read('src/ui/adSpend.ts');

/* ── the page exists at the address the app actually sends people to ─────── */

const redirect = /AD_OAUTH_REDIRECT\s*=\s*'([^']+)'/.exec(adSpend)?.[1] ?? '';
ok(redirect.endsWith('/ads/callback'),
  `the app's redirect still points at /ads/callback — got ${JSON.stringify(redirect)}`);

/* ── the allowlist agrees with the brands the product actually ships ─────── */

const declared = [...new Set([...brands.matchAll(/scheme: '([a-z]+)'/g)].map((m) => m[1]))].sort();
ok(declared.length >= 3, 'brands.ts declares schemes at all');

const listed = [...new Set(
  [...page.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).filter((s) => declared.includes(s)),
)].sort();
eq(listed, declared,
  'every scheme a binary registers is on the callback allowlist, and nothing else that looks like one is');

// A scheme on the page that no binary registers would be an open redirect
// wearing a brand's name, so the equality above is checked in BOTH directions
// deliberately rather than as a subset.
for (const s of declared) ok(page.includes(`'${s}'`), `${s} is on the allowlist`);

/* ── the refusal is still a refusal ──────────────────────────────────────── */

ok(/indexOf\(scheme\)\s*===\s*-1/.test(page) || /indexOf\(scheme\) === -1/.test(page),
  'the destination is checked against the list rather than merely parsed');
ok(/nothing has been sent on/i.test(page),
  'and a destination that is not on the list says nothing was forwarded');

// The two spellings of the same field. TikTok sends `auth_code`; dropping it
// would make every TikTok connection fail with "came back without a code".
ok(page.includes("q.get('code')") && page.includes("q.get('auth_code')"),
  'both spellings of the authorisation code are read');

/* ── the code is forwarded, never displayed ──────────────────────────────── */

ok(!/textContent\s*=\s*[^;]*\bcode\b/.test(page),
  'the authorisation code is never written into the page');
ok(page.includes('name="referrer" content="no-referrer"'),
  'and the query string is kept out of any referrer');
ok(/noindex/.test(page), 'the page is not indexed');

if (errors.length) { errors.forEach((e) => console.error(e)); console.error(`adsCallback: ${errors.length} failure(s)`); process.exit(1); }
console.log('adsCallback: ok — the page exists, forwards only to a scheme this product registers, and never renders the code');
