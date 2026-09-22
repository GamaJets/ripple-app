#!/usr/bin/env node
// A client screen must be in the index, or say in writing why it is not.
//
// ── the two incidents this is the gate for ─────────────────────────────────
//
// Navigation in the member app was written out by hand in TWO places:
// `CLIENT_FEATURES` in src/lib/features.ts, which drives Explore and its
// search, and `HUB_GROUPS` in app/(client)/profile.tsx, which drove the Me
// hub. A screen was reachable if it appeared in either one. So the set of
// unreachable screens was the gap between two lists that nobody ever diffed,
// and the gap opened twice.
//
// FIRST, ten screens were missing from CLIENT_FEATURES while the Me hub was
// slimmed on the explicit justification that CLIENT_FEATURES "contained
// everything". It did not. app/(client)/reminders.tsx was in the one hub group
// the slimming had stopped rendering AND absent from the index, so between the
// two files it had no route into it from any tab, hub, banner or search result
// in the app. Nothing failed. Nothing warned. The screen was simply gone.
//
// SECOND, eight more: account, attendance, compare, gym-plans, notices,
// receipts, standing and intake were in NEITHER list. A member had no way to
// change their own password, no way to see the register their gym ticks about
// them, no way to re-read a notice they missed, no way to see what they had
// been charged, and no way to end a standing appointment except by cancelling
// every occurrence of it one at a time, each inside a notice window that
// charges for it.
//
// HUB_GROUPS has now been deleted and the Me hub renders from `meGroup` in
// src/lib/features.ts, so there is one list. This gate is what keeps it one
// list, and what makes an omission from it loud.
//
// ── why this is not scripts/check-reachable.mjs ────────────────────────────
//
// That gate is the floor: it fails when NOTHING in the source tree names a
// route. This one is the bar above it: a screen can be named by exactly one
// `Ghost` button at the bottom of another screen and pass check-reachable
// while being, in practice, findable by nobody. app/(client)/invoices.tsx was
// in precisely that state — named by a button at the foot of receipts.tsx and
// by a push notification, and by nothing a member could search for — for as
// long as it had existed, and check:reachable was green the whole time.
//
// So: named somewhere is not enough. It has to be in the index a member can
// search, or there has to be a sentence in CLIENT_UNLISTED saying why not.
//
// ── what it cannot see ─────────────────────────────────────────────────────
//
//   · It reads src/lib/features.ts with regexes over single lines, the way
//     every other gate in this directory reads source. An entry reformatted
//     across several lines would be invisible to it, and would report as
//     missing rather than silently pass — the safe direction.
//   · It does not judge a reason. A `CLIENT_UNLISTED` entry saying "because"
//     passes. What it holds is that SOMEBODY WROTE ONE, which is the step that
//     did not happen either time above.
//   · Being in the index is not the same as being easy to find. That is a
//     matter of opinion and this is not.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join('app', '(client)');
const FEATURES = join('src', 'lib', 'features.ts');
const src = readFileSync(FEATURES, 'utf8');

/** The body of a top-level `export const NAME = …` up to its closing line. */
function block(name, close) {
  const a = src.indexOf(`export const ${name}`);
  if (a < 0) throw new Error(`${FEATURES} has no ${name}`);
  const b = src.indexOf(`\n${close}`, a);
  if (b < 0) throw new Error(`${FEATURES}: ${name} is not closed by ${close}`);
  return src.slice(a, b);
}

const featureBlock = block('CLIENT_FEATURES', '];');
const groupBlock = block('ME_GROUPS', '];');
const unlistedBlock = block('CLIENT_UNLISTED', '};');

// A comment line cannot list a screen. Same rule, and the same reason, as
// scripts/check-reachable.mjs: the Reminders bug survived review partly because
// several file headers described a row that was not being rendered.
const live = (b) => b.split('\n').filter((l) => !l.trim().startsWith('//'));

const features = live(featureBlock)
  .map((l) => {
    const route = /route: '([^']+)'/.exec(l);
    if (!route) return null;
    return {
      line: l,
      route: route[1],
      area: (/area: '([a-z]+)'/.exec(l) ?? [])[1],
      meGroup: (/meGroup: '([a-z]+)'/.exec(l) ?? [])[1],
    };
  })
  .filter(Boolean);

const groups = live(groupBlock)
  .map((l) => (/\{ key: '([a-z]+)', title:/.exec(l) ?? [])[1])
  .filter(Boolean);

const unlisted = new Map(
  live(unlistedBlock)
    .map((l) => /^\s*'?([a-z0-9-]+)'?: '(.*)',\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

// A tab has a button drawn for it, so it needs no index row. Same dumb regex
// over `name="…"` that check-tabs.mjs and check-reachable.mjs use.
const layout = readFileSync(join(DIR, '_layout.tsx'), 'utf8');
const tabs = new Set(
  [...layout.matchAll(/<Tabs\.Screen[^>]*?name="([^"]+)"[^>]*?>/gs)]
    .filter((m) => !/href:\s*null/.test(m[0]))
    .map((m) => m[1]),
);

const screens = readdirSync(DIR)
  .filter((f) => f.endsWith('.tsx') && f !== '_layout.tsx')
  .map((f) => f.replace(/\.tsx$/, ''));

const indexed = new Set(
  features
    .map((f) => /^\/\(client\)\/([a-z0-9-]+)$/.exec(f.route))
    .filter(Boolean)
    .map((m) => m[1]),
);

let bad = 0;
const fail = (msg) => { console.error(msg); bad++; };

// ── every screen is in the index, or says why not ───────────────────────────
for (const s of screens) {
  if (tabs.has(s)) continue;
  if (indexed.has(s)) continue;
  if (unlisted.has(s)) continue;
  fail(
    `${DIR}/${s}.tsx is in no index.\n`
    + `  It is registered href: null, so it has no tab, and CLIENT_FEATURES in\n`
    + `  ${FEATURES} does not list '/(client)/${s}'. It is therefore absent from\n`
    + `  Explore's search AND from the Me hub, which both render from that one list.\n`
    + `  Add a row there — that is the single act that puts it in both — or, if it is\n`
    + `  out on purpose, add '${s}' to CLIENT_UNLISTED with the reason.`,
  );
}

// ── an exclusion that has rotted is not a decision, it is a leftover ────────
for (const [key, reason] of unlisted) {
  if (!screens.includes(key)) {
    fail(
      `CLIENT_UNLISTED names '${key}', which is not a file in ${DIR}/.\n`
      + `  The screen it was excusing is gone. Delete the entry in the same change.`,
    );
  }
  if (indexed.has(key)) {
    fail(
      `CLIENT_UNLISTED names '${key}', and CLIENT_FEATURES lists it too.\n`
      + `  One of the two is wrong. Two lists disagreeing about one screen is the\n`
      + `  exact defect this gate exists for.`,
    );
  }
  if (!reason) {
    fail(`CLIENT_UNLISTED['${key}'] has an empty reason. A bare exclusion does not count.`);
  }
}

// ── the Me hub: every group has something in it ─────────────────────────────
//
// The first incident's proximate cause was a group that had stopped being
// rendered. A group that is empty renders as nothing just as surely, and its
// members are then in search and nowhere else.
for (const g of groups) {
  if (!features.some((f) => f.meGroup === g)) {
    fail(
      `ME_GROUPS has '${g}' and no feature carries meGroup: '${g}'.\n`
      + `  The Me screen would draw an empty card, or drop it. Either fill the group or\n`
      + `  delete it — do not leave a heading over nothing.`,
    );
  }
}

for (const f of features) {
  if (f.meGroup && !groups.includes(f.meGroup)) {
    fail(`${f.route} has meGroup: '${f.meGroup}', which is not a key in ME_GROUPS.`);
  }
  // `area: 'me'` says the Me tab owns it. A screen the Me tab owns and the Me
  // screen does not show is the shape both incidents took.
  if (f.area === 'me' && !f.meGroup) {
    fail(
      `${f.route} is area: 'me' and has no meGroup.\n`
      + `  The Me tab owns it and the Me screen does not list it, so search is its only\n`
      + `  way in. Put it in one of: ${groups.join(', ')}.`,
    );
  }
}

if (bad) {
  console.error(`\ncheck:client-index — ${bad} problem${bad === 1 ? '' : 's'}.`);
  process.exit(1);
}
