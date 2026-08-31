#!/usr/bin/env node
// Every route file must be reachable, and every route anybody names must exist.
//
// scripts/check-tabs.mjs catches the route nobody DECLARED — the file that
// silently grows a tab button. This is the opposite failure and the more common
// one: the route that was declared correctly, as `href: null`, and then linked
// to by nothing. expo-router registers it, tsc compiles it, check-tabs passes,
// and the screen is reachable by no tab, no hub row, no banner and no search
// result. It exists and nobody can get to it.
//
// It has shipped here before. app/(client)/reminders.tsx was in the one hub
// group the Me screen had stopped rendering AND missing from CLIENT_FEATURES,
// so between two files it had no route into it from anywhere in the app. The
// long comment above `hubGroups` in app/(client)/profile.tsx is the write-up.
// Nothing failed. Nothing warned. The screen was simply gone.
//
// The reverse is checked too, and the same comment says why it matters more
// than it sounds: "a row pointing at nothing is worse than no row". A hub row
// naming a deleted screen is a dead end a member taps twice before deciding the
// app is broken, and deleting a screen is exactly when nobody re-reads the hub.
//
// ── WHAT THIS CANNOT SEE ───────────────────────────────────────────────────
//
// It greps for the literal string `(group)/name`. That is all it does, and the
// honest consequences are:
//
//   · A route assembled at runtime — '/(client)/' + key, or a `route` column
//     read out of the database — is INVISIBLE to it. src/lib/notifyInbox.ts
//     routes pushes by a prefix that arrives from a caller, so a screen reached
//     only by a push notification will be reported unreachable here and the
//     honest fix is a real in-app entry point, not an exemption.
//   · It cannot tell a link a person will find from one buried four levels
//     down behind a condition that is false for most accounts. "Named
//     somewhere" is the floor, not the goal.
//   · It cannot tell a live link from a dead one in a file nothing renders.
//   · Comments are stripped, so a route mentioned only in prose does not count
//     as an entry point. That is deliberate: the Reminders bug survived review
//     partly because several file headers described a hub row that was not
//     being rendered.
//
// So passing this does not mean the IA is good. Failing it means a screen is
// unreachable, which is not a matter of opinion.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GROUPS = ['(client)', '(trainer)', '(owner)'];
const ROOTS = ['app', 'src', 'scripts'];

/** Source lines with comments removed. Line-based, and `//` inside a string is
 *  cut with everything after it — which cannot hide a route reference, because
 *  a `(group)/name` never appears after a `//` in live code. */
function code(src) {
  let block = false;
  return src.split('\n').map((line) => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      if (block) {
        if (line[i] === '*' && line[i + 1] === '/') { block = false; i++; }
        continue;
      }
      if (line[i] === '/' && line[i + 1] === '*') { block = true; i++; continue; }
      if (line[i] === '/' && line[i + 1] === '/') break;
      out += line[i];
    }
    return out;
  });
}

// Tests are excluded from BOTH halves of this check, and each direction has its
// own reason. A test naming a screen is not a way for a person to reach it, so
// it must not satisfy the first half — a route whose only mention is an
// assertion is exactly as unreachable as one with no mention at all. And a test
// is the one place a route string that deliberately does not exist is correct:
// src/lib/notifyInbox.test.ts asserts on '/(client)/calendar-archive' to prove
// the icon map matches whole screen names rather than prefixes of them, and
// that string must never become a screen.
const isTest = (f) => /\.test\.[jt]sx?$/.test(f) || f.includes('__tests__');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === '.expo') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(e) && !isTest(p)) out.push(p);
  }
  return out;
}

const sources = ROOTS.flatMap((r) => walk(r)).map((f) => ({ file: f, lines: code(readFileSync(f, 'utf8')) }));

let bad = 0;

// ── every route file is named by something ──────────────────────────────────
//
// A tab is an entry point on its own: expo-router draws it a button, so a route
// declared WITHOUT `href: null` needs no link. Everything else does.
for (const g of GROUPS) {
  const dir = join('app', g);
  const layout = readFileSync(join(dir, '_layout.tsx'), 'utf8');

  // A tab is a <Tabs.Screen> whose options do not say `href: null`. Same dumb
  // regex over `name="…"` that check-tabs.mjs uses, for the same reason.
  const tabs = new Set(
    [...layout.matchAll(/<Tabs\.Screen[^>]*?name="([^"]+)"[^>]*?>/gs)]
      .filter((m) => !/href:\s*null/.test(m[0]))
      .map((m) => m[1]),
  );

  const routes = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') && f !== '_layout.tsx')
    .map((f) => f.replace(/\.tsx$/, ''));

  for (const r of routes) {
    if (tabs.has(r)) continue;
    const own = join(dir, `${r}.tsx`);
    const re = new RegExp(`${g.replace(/[()]/g, '\\$&')}/${r}(?![-a-zA-Z0-9_])`);

    // Its own file does not count (a screen linking to itself is not a way in),
    // and neither does the layout that registers it.
    const found = sources.some(({ file, lines }) =>
      file !== own && !file.endsWith('_layout.tsx') && lines.some((l) => re.test(l)));

    if (!found) {
      console.error(
        `${dir}/${r}.tsx is reachable from nothing.\n`
        + `  It is registered as href: null, so it has no tab, and no file in app/ or src/\n`
        + `  names '${g}/${r}' in live code. Give it a way in — a row in the group's hub\n`
        + `  (app/(client)/profile.tsx HUB_GROUPS, app/(trainer)/profile.tsx sections,\n`
        + `  app/(owner)/dashboard.tsx) and an entry in the search registry that group\n`
        + `  uses (CLIENT_FEATURES / TRAINER_NAV / OWNER_NAV in src/lib/features.ts).\n`
        + `  A screen in the hub but not in search is half-reachable; do both.`,
      );
      bad++;
    }
  }
}

// ── every route anybody names exists ────────────────────────────────────────
//
// The other half of the same promise, and the one that rots on its own: a row
// survives the screen it points at.
const exists = new Map(
  GROUPS.map((g) => [g, new Set(
    readdirSync(join('app', g)).filter((f) => f.endsWith('.tsx')).map((f) => f.replace(/\.tsx$/, '')),
  )]),
);

const NAMED = /\((client|trainer|owner)\)\/([a-z0-9-]+)/g;
for (const { file, lines } of sources) {
  lines.forEach((line, i) => {
    for (const m of line.matchAll(NAMED)) {
      const g = `(${m[1]})`;
      if (exists.get(g).has(m[2])) continue;
      console.error(
        `${file}:${i + 1} names '${g}/${m[2]}', which is not a file in app/${g}/.\n`
        + `  Tapping it opens nothing. If the screen was deleted, delete what points at it\n`
        + `  in the same change.`,
      );
      bad++;
    }
  });
}

if (bad) {
  console.error(`\n${bad} problem${bad === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log('check-reachable: ok — every route has a way in, and every link has a screen');
