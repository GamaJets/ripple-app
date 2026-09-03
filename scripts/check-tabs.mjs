#!/usr/bin/env node
// Every route file in a tab group must be declared in that group's layout.
//
// expo-router's <Tabs> gives a TAB BUTTON to every route file in the directory
// unless the layout says `href: null`. So the way you add a hidden screen and
// the way you add a tab are the same action, and the difference is a line in
// a different file that nothing checks.
//
// It shipped. `app/(client)/glucose.tsx` went out in an over-the-air update
// with no Tabs.Screen entry, which put a sixth item called "glucose" in the
// client's tab bar next to Home, Train, Meals, Progress and Me. Nothing failed,
// nothing warned, and the app still compiled — the only symptom was on the
// phone.
//
// The three tab bars are also load-bearing elsewhere: GUIDE_INTRO in
// src/lib/guideContent.ts writes their counts out in words ("Six tabs for
// running your coaching"), and that sentence was wrong for months for the same
// reason — the bar changed and the prose did not.
//
// This does not check the counts. It checks the thing that silently changes
// them: a file nobody declared.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const GROUPS = ['(client)', '(trainer)', '(owner)'];
let bad = 0;

for (const g of GROUPS) {
  const dir = join('app', g);
  const layout = readFileSync(join(dir, '_layout.tsx'), 'utf8');

  // Names as the layout declares them, taken from `<Tabs.Screen …>` ELEMENTS and
  // not from every `name="…"` in the file.
  //
  // The dumb regex it replaces read `name=` anywhere, and the layouts are full of
  // other things called name: `tabBarIcon: ({ color }) => <Icon name="home" …/>`
  // is on the same line as the screen it decorates. So `declared` silently
  // contained the ICON names too — sixteen of them across the three groups:
  //
  //   (client)  home, train, meals, progress, me
  //   (trainer) people, train, chart, video, me
  //   (owner)   grid, people, palette, trending, wrench
  //
  // Every one of those is a plausible route file name, and `app/(client)/home.tsx`
  // is the likeliest of all — the Home tab's file, named after the tab. It would
  // have shipped as a sixth tab with this gate saying it was declared, which is
  // the glucose.tsx incident above, re-armed and pointed at the file somebody is
  // most likely to add.
  //
  // Still a regex and not a parser, but anchored at the element: `<Tabs.Screen`,
  // then the first `name="…"` before the tag closes. `[^>]` cannot cross a `>`,
  // and an arrow function inside `options` contains one, so the scan runs to the
  // element's own end by counting to the first `/>` or `>` that is not part of an
  // `=>`.
  const declared = new Set();
  for (const m of layout.matchAll(/<Tabs\.Screen\b/g)) {
    let i = m.index, end = layout.length;
    for (let j = i; j < layout.length; j++) {
      if (layout[j] === '>' && layout[j - 1] !== '=') { end = j; break; }
    }
    const el = layout.slice(i, end);
    const n = /\bname\s*=\s*"([^"]+)"/.exec(el);
    if (n) declared.add(n[1]);
  }

  // A route file is any file expo-router will route, not only `.tsx`. It resolves
  // .tsx/.ts/.jsx/.js the same way, and a route added as `.ts` would have been
  // invisible here.
  const entries = readdirSync(dir, { withFileTypes: true });

  // Nested route directories. `app/(client)/settings/index.tsx` is a route and
  // gets a tab; a flat readdir returns the DIRECTORY, which has no extension and
  // is filtered away, so the route would be unchecked and this gate would still
  // print "every route is declared". There are none today. Rather than guess at
  // expo-router's nesting rules — which this check would then have to keep
  // correct — it refuses, and says what to do.
  const nested = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (nested.length) {
    console.error(`${dir} has subdirector${nested.length === 1 ? 'y' : 'ies'} `
      + `(${nested.join(', ')}), which are nested routes this check cannot read.\n`
      + '  It only understands flat route files. Teach scripts/check-tabs.mjs the nesting\n'
      + '  rules, or the group is no longer covered — do not leave it printing "ok".');
    bad++;
  }

  const files = entries
    .filter((e) => e.isFile() && /\.(tsx|ts|jsx|js)$/.test(e.name)
      && !/^_layout\./.test(e.name) && !/\.test\./.test(e.name))
    .map((e) => e.name.replace(/\.(tsx|ts|jsx|js)$/, ''));

  /* ── the empty-set guard ────────────────────────────────────────────────
   *
   * The three groups held 71, 59 and 21 route files and declared as many. A
   * group that suddenly has a handful of either has moved — into subdirectories,
   * into another group, or out of `app/` — and the sentence at the bottom of this
   * file would then be a claim about a directory it never read. Ten is far below
   * the smallest of the three and far above nothing.
   */
  if (files.length < 10 || declared.size < 10) {
    console.error(`${dir}: found ${files.length} route file(s) and ${declared.size} `
      + '<Tabs.Screen> declaration(s), which cannot be right. Refusing to pass.');
    bad++;
    continue;
  }

  for (const f of files) {
    if (!declared.has(f)) {
      console.error(
        `${dir}/${f}.tsx has no <Tabs.Screen name="${f}"> in ${dir}/_layout.tsx.\n`
        + `  It will appear as a TAB. If that is not what you want, add:\n`
        + `      <Tabs.Screen name="${f}" options={{ href: null, title: '…' }} />`,
      );
      bad++;
    }
  }
}

if (bad) {
  console.error(`\n${bad} undeclared route${bad === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log('check-tabs: ok — every route in the three groups is declared');
