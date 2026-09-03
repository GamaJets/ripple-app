#!/usr/bin/env node
// Stamp web/*.html with a content hash of styles.css — and, with --check, fail
// if that stamp is not already in the committed bytes.
//
//   node scripts/stamp-css.mjs           rewrite every page's stylesheet link
//   node scripts/stamp-css.mjs --check   fail if any page's link is stale
//
// ── WHY THE STAMP EXISTS ──────────────────────────────────────────────────
//
// Cloudflare serves styles.css with `cache-control: max-age=14400` and the HTML
// with `max-age=0`. The pages linked it as a bare `href="styles.css"`, so a
// visitor got fresh HTML against a stylesheet up to four hours old.
//
// That is not a cosmetic mismatch. On 26 Aug 2026 it made every chart on the
// site render solid black: the new markup uses classes (.f-hi, .cx-box, .ch-a)
// that only exist in the new stylesheet, and when `fill: var(--accent)` never
// arrives, `fill` falls back to its initial value — black — on a near-black
// background. The page looked deployed and was unreadable.
//
// Appending the hash gives the stylesheet a new URL whenever its bytes change,
// so a stale copy can never be paired with new markup. When the CSS does not
// change, the URL does not change and the cache still does its job.
//
// ── WHY THIS FILE NOW HAS A --check MODE ──────────────────────────────────
//
// For eight days the stamp was wired into nothing a person types. It had no
// entry in package.json, no place in `check:all`, none in `preflight`, and none
// in `scripts/publish.sh`. web/README.md said, in bold, to run it by hand every
// time styles.css changes, and then said of itself:
//
//     "Nothing catches a forgotten stamp, so it is a line in this file and a
//      habit, which is the weakest kind of gate this repo has."
//
// That is the same arrangement that produced the black charts. The one thing
// standing between the site and a repeat was somebody remembering, and the
// original incident IS the record of somebody not remembering.
//
// `.github/workflows/deploy-web.yml` does run this script, which is why the
// live site has been right since. It is not sufficient, for two reasons:
//
//   1. It stamps a checkout that is thrown away. The committed HTML in `main`
//      can carry a stale hash indefinitely and nothing says so. The repo and
//      the deployed site quietly disagree about their own bytes, which is the
//      exact condition — git looking healthy while the live site is behind —
//      that the workflow's own header was written about.
//
//   2. It is not the only way this directory reaches a host. web/README.md
//      documents two more, both of which ship the committed bytes with no
//      stamping step anywhere in them:
//
//          npx wrangler pages deploy web --project-name repple
//          npx netlify deploy --dir=web --prod
//
//      Either one, run against a tree with a stale stamp, reproduces 26 August
//      exactly. The workflow protects one path out of three.
//
// ── WHY --check REFUSES RATHER THAN QUIETLY REWRITING ─────────────────────
//
// The obvious wiring is to put the WRITE into `check:all` and let every run fix
// the tree. That is worse, and the reasons are specific to this repo:
//
//   · It would make the run green while the committed bytes stayed wrong.
//     `check:all` runs in CI on a checkout nobody keeps, so the rewrite is
//     discarded the moment the job ends and the stale stamp survives in `main`
//     with a green tick over it. A gate that repairs a copy and passes is not
//     a gate; it is the habit again, automated, and now harder to notice.
//
//   · It would put a file write inside a gate that six agents run concurrently.
//     This tree is written to by several processes at once — that is the whole
//     premise of scripts/publish.sh's detached worktree — and a gate that
//     rewrites twenty-one HTML files mid-run is a lost-update race against
//     whoever is editing one of them.
//
//   · It would leave an unexplained modification behind. `scripts/publish.sh`
//     asserts the tree is a commit, runs `check:all`, and bundles from HEAD.
//     A gate that writes during that window changes nothing about what ships
//     and leaves a diff nobody made, in a tree where "who wrote this" already
//     costs real time to answer.
//
//   · A refusal is free and correct. The fix is one command, it is named in the
//     error, it is idempotent, and it produces a diff that belongs in the same
//     commit as the CSS change that caused it. Regenerating and refusing is the
//     pattern `db:check` already uses for supabase/setup.sql, for the same
//     reason: the generated artefact is committed, so the check is about the
//     commit and not about the run.
//
// So: this script still writes when run plainly, and `check:css-stamp` runs it
// with --check, which writes nothing and fails.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const CHECK = process.argv.includes('--check');
const WEB = new URL('../web/', import.meta.url).pathname;
const css = readFileSync(join(WEB, 'styles.css'));
const hash = createHash('sha256').update(css).digest('hex').slice(0, 10);

// Matches a bare link and an already-stamped one, so the stamp is replaced
// rather than accumulated.
const RE = /href="styles\.css(?:\?v=[a-f0-9]+)?"/g;
const want = `href="styles.css?v=${hash}"`;

const pages = readdirSync(WEB).filter((n) => n.endsWith('.html')).sort();

// The empty-set guard. Without it, a `web/` that has moved, been renamed, or
// been read from the wrong working directory produces zero pages, zero stale
// pages and zero missing links — and this script prints that the whole site is
// correctly stamped having opened nothing. That sentence would be quoted in a
// report, and it would be about a directory that does not exist.
assertRootFloors('check:css-stamp', { web: pages.length });

let changed = 0, seen = 0;
const missing = [];   // no stylesheet link at all
const stale = [];     // linked, but not at the current hash

for (const f of pages) {
  const p = join(WEB, f);
  const before = readFileSync(p, 'utf8');
  const hits = before.match(RE);
  if (!hits) { missing.push(f); continue; }
  seen += hits.length;
  const after = before.replace(RE, want);
  if (after === before) continue;
  if (CHECK) {
    // Report what it says now, not just that it is wrong. An unstamped link and
    // a link stamped to a superseded build fail for the same reason and are
    // fixed the same way, but they are different mistakes and reading which one
    // happened is how you find out whether somebody edited the CSS or edited a
    // page's <head> by hand.
    stale.push({ f, now: [...new Set(hits)].join(', ') });
  } else {
    writeFileSync(p, after);
    changed++;
  }
}

if (CHECK) {
  if (missing.length || stale.length) {
    console.error('The stylesheet stamp is not what the stylesheet says it should be.\n');
    console.error(`  web/styles.css currently hashes to  v=${hash}\n`);
    // Grouped by what the page actually says. When the CSS has moved, all
    // twenty-one pages are stale at the same old hash and that is ONE fact —
    // printing it twenty-one times buries the case that matters, which is a
    // page disagreeing with the others because somebody edited its <head> by
    // hand. Pages are still named, because "some pages" is not a fix.
    const byLink = new Map();
    for (const s of stale) byLink.set(s.now, [...(byLink.get(s.now) ?? []), s.f]);
    for (const [now, files] of byLink) {
      console.error(`  ${files.length} page${files.length === 1 ? ' links' : 's link'} ${now}`);
      console.error(`      ${files.map((f) => 'web/' + f).join('\n      ')}`);
      console.error(`  should be ${want}\n`);
    }
    for (const f of missing) {
      console.error(`  web/${f}`);
      console.error('      has NO stylesheet link at all — it would render unstyled, and it is');
      console.error('      exactly the page nobody would notice was broken.');
    }
    console.error('\nCloudflare caches web/styles.css for four hours and the HTML for zero, so a');
    console.error('page carrying a stale ?v= is served new markup against an old stylesheet. On');
    console.error('26 Aug 2026 that rendered every chart on the site solid black.');
    console.error('\nFix, in the same commit as whatever moved the CSS:');
    console.error('\n    node scripts/stamp-css.mjs\n');
    process.exit(1);
  }
  console.log(`css stamp ok — ${seen} link${seen === 1 ? '' : 's'} across ${pages.length} pages, all at v=${hash}.`);
} else {
  console.log(`styles.css → v=${hash}`);
  console.log(`  ${seen} link${seen === 1 ? '' : 's'} across ${pages.length} pages · ${changed} file${changed === 1 ? '' : 's'} rewritten`);
  if (missing.length) {
    // A page with no stylesheet link is almost certainly a mistake, and it is
    // exactly the page that would render unstyled without anyone noticing.
    console.error(`  NO STYLESHEET LINK: ${missing.join(', ')}`);
    process.exit(1);
  }
}
