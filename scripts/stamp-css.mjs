#!/usr/bin/env node
// Stamp web/*.html with a content hash of styles.css.
//
// WHY. Cloudflare serves styles.css with `cache-control: max-age=14400` and the
// HTML with `max-age=0`. The pages linked it as a bare `href="styles.css"`, so
// a visitor got fresh HTML against a stylesheet up to four hours old.
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
// Run before deploying. Idempotent: re-running with unchanged CSS is a no-op.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const WEB = new URL('../web/', import.meta.url).pathname;
const css = readFileSync(join(WEB, 'styles.css'));
const hash = createHash('sha256').update(css).digest('hex').slice(0, 10);

// Matches a bare link and an already-stamped one, so the stamp is replaced
// rather than accumulated.
const RE = /href="styles\.css(?:\?v=[a-f0-9]+)?"/g;
const want = `href="styles.css?v=${hash}"`;

let changed = 0, seen = 0, missing = [];
for (const f of readdirSync(WEB).filter((n) => n.endsWith('.html'))) {
  const p = join(WEB, f);
  const before = readFileSync(p, 'utf8');
  const hits = before.match(RE);
  if (!hits) { missing.push(f); continue; }
  seen += hits.length;
  const after = before.replace(RE, want);
  if (after !== before) { writeFileSync(p, after); changed++; }
}

console.log(`styles.css → v=${hash}`);
console.log(`  ${seen} link${seen === 1 ? '' : 's'} across ${readdirSync(WEB).filter((n) => n.endsWith('.html')).length} pages · ${changed} file${changed === 1 ? '' : 's'} rewritten`);
if (missing.length) {
  // A page with no stylesheet link is almost certainly a mistake, and it is
  // exactly the page that would render unstyled without anyone noticing.
  console.error(`  NO STYLESHEET LINK: ${missing.join(', ')}`);
  process.exit(1);
}
