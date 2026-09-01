// The brand table baked into web/join.html, held against src/lib/brands.ts.
//
// WHY THIS FILE EXISTS. `web/` is a static site. Nothing transforms it on the
// way to Cloudflare Pages, so the join page cannot import `brands.ts` and has
// to carry its own copy of the handful of fields it needs. That copy is exactly
// the thing `brands.ts` opens by forbidding: "a brand table that existed twice
// would give that back immediately, and the copy that drifted would be the one
// nobody ran."
//
// This is the thing that runs. A duplicate that is CHECKED is a different
// object from a duplicate that is trusted, and the check is what makes the
// duplicate allowable at all. Rename a scheme, move a bundle id, add a brand to
// the registry and forget the page, and this goes red before anybody ships a
// coach's invite link that opens the wrong app — or no app.
//
// The second half is about the reader with JavaScript turned off. The page's
// MARKUP is written in the default brand's words and the resolver only rewrites
// it for another host, so the baked store links are what a no-JS visitor to
// repplefitness.com actually gets. If those literals drift from the `repple`
// row of the table, the page silently offers two different apps depending on
// whether scripting is on. So they are asserted against the registry too.
//
// What this canNOT check, deliberately and unavoidably:
//
//   · `appleAppId`. An App Store numeric id is minted by Apple when a listing
//     is created and the registry has no field for it. There is nothing to
//     compare it against, so the assertions below only establish that it is
//     digits or an explicit null — the shape, not the value. A brand's id being
//     WRONG is caught by opening the link, and by nothing here.
//   · whether a brand's host is actually pointed at this deployment. That is a
//     Cloudflare dashboard fact and no file in this repo records it.
//
// A NOTE ON THE IMPORT BELOW, because it looks like an oversight and is not.
// This file is compiled twice: by `tsconfig.test.json`, which names `"types":
// ["node"]` and runs it, and by the root `tsconfig.json`, which typechecks the
// whole app tree and has no Node types in scope. `import { readFileSync } from
// 'node:fs'` fails the second one — so the module is taken through a locally
// declared `require`, which satisfies both without adding Node's globals to a
// config that builds a phone app. `npm run typecheck` is the gate that would
// otherwise go red, and a test that breaks the typecheck stops every other
// test from running at all.
import { BRANDS, DEFAULT_BRAND_ID } from './brands';

declare function require(id: string): any;
const fs = require('node:fs') as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// `npm test` runs from the repo root. The second candidate covers a run from
// one directory down. Both are tested for existence rather than assumed,
// because a test that cannot find its input must fail loudly and must never
// pass vacuously — the whole value of this file is that it reads a real page.
const CANDIDATES = [
  process.cwd() + '/web/join.html',
  process.cwd() + '/../web/join.html',
];
const path = CANDIDATES.find((p) => fs.existsSync(p));
ok(!!path, `web/join.html not found — looked in ${CANDIDATES.join(' and ')}`);

type PageBrand = {
  hosts: string[];
  label: string;
  clientApp: string;
  clientScheme: string;
  androidPackage: string;
  appleAppId: string | null;
  supportEmail: string;
};

let html = '';
let table: Record<string, PageBrand> = {};

if (path) {
  html = fs.readFileSync(path, 'utf8');

  // One block, matched on its id rather than on being the first JSON script,
  // so adding another data block to the page cannot silently redirect this.
  const m = html.match(/<script type="application\/json" id="site-brands">([\s\S]*?)<\/script>/);
  ok(!!m, 'web/join.html has no <script type="application/json" id="site-brands"> block');
  if (m) {
    try {
      table = JSON.parse(m[1]) as Record<string, PageBrand>;
    } catch (e: any) {
      errors.push(`the site-brands block is not valid JSON — ${e?.message ?? e}. The page parses it with JSON.parse too, so this would leave every reader on the fallback brand.`);
    }
  }
}

const ids = Object.keys(table);
ok(ids.length > 0, 'the site-brands table is empty');

// The page falls back to the default brand for an unrecognised host, exactly as
// resolveBrandId() does. If the default is not in the table, that fallback
// resolves to undefined and the page offers nothing at all.
ok(
  Object.prototype.hasOwnProperty.call(table, DEFAULT_BRAND_ID),
  `the site-brands table has no "${DEFAULT_BRAND_ID}" entry, which is the host-not-recognised fallback — a *.pages.dev preview would render with no store links`,
);

for (const id of ids) {
  const page = table[id];
  const brand = BRANDS[id];
  if (!brand) {
    errors.push(`web/join.html offers brand "${id}", which is not in BRANDS — nothing builds an app for it`);
    continue;
  }

  eq(page.label, brand.label, `${id}: label`);
  eq(page.clientApp, brand.apps.client.name, `${id}: clientApp must be the CLIENT app's store name — the join page invites members, never coaches`);
  eq(page.clientScheme, brand.apps.client.scheme, `${id}: clientScheme — a wrong scheme makes "Open in ..." do nothing at all`);
  eq(page.androidPackage, brand.apps.client.bundle, `${id}: androidPackage IS the Play listing address, so a mismatch is a 404 on the badge`);
  eq(page.supportEmail, brand.supportEmail, `${id}: supportEmail`);

  eq(
    JSON.stringify(page.hosts),
    JSON.stringify(brand.linkHosts),
    `${id}: hosts must be brand.linkHosts, apex then www — these are the hosts the page matches on, and a missing one serves that brand's own domain somebody else's app`,
  );

  ok(
    page.appleAppId === null || /^[0-9]+$/.test(String(page.appleAppId)),
    `${id}: appleAppId must be digits, or null for a brand with no listing yet — got ${JSON.stringify(page.appleAppId)}`,
  );
}

// ── the markup a reader with no JavaScript gets ───────────────────────────
const baked = table[DEFAULT_BRAND_ID];
if (html && baked) {
  ok(
    html.includes(`play.google.com/store/apps/details?id=${baked.androidPackage}`),
    `the static Play link in web/join.html is not ${baked.androidPackage} — with scripting off the page would offer a different app than the table says`,
  );
  if (baked.appleAppId) {
    ok(
      html.includes(`apps.apple.com/app/id${baked.appleAppId}`),
      `the static App Store link in web/join.html is not id${baked.appleAppId}`,
    );
  }
  ok(
    html.includes(`>${baked.clientApp}<`) || html.includes(`on ${baked.clientApp}<`),
    `web/join.html's baked markup no longer names ${baked.clientApp} — the no-JS default and the table have parted company`,
  );
}

if (errors.length) {
  console.error(`joinPage: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('joinPage: ok');
