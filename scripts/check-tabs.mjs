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
//
// ── and a second thing a layout can silently not say ──────────────────────
//
// The same shape of defect, one line further up. `app/(client)/_layout.tsx`
// set `headerShown: false` on its five bar tabs INDIVIDUALLY and never in
// `screenOptions`. The trainer and owner layouts had always set it group-wide.
// So the client group's sixty-six `href: null` detail screens took the
// navigator default, which is `true`, and every one of them drew a duplicate
// header: its own title under the navigator's, and its own back control under
// a header that renders none (a bottom-tabs header is built as
// `header({ layout, options })`, with no `back` prop).
//
// The cost was not only the doubled title. That header is a plain sibling View
// above the content, `44 + statusBarHeight` tall, and expo-router's Screen does
// not reset SafeAreaInsetsContext beneath it — so the `<SafeAreaView
// edges={['top']}>` those screens open with applied the top inset a second
// time. About 160 points of non-scrolling strip at the top of every detail
// screen in the client app, which is where a member's pull-to-refresh landed:
// a RefreshControl belongs to its scroller, and a drag that starts above the
// scroller is not a pull. It was reported as "pull to refresh works on the
// coach but not on the client".
//
// Nothing compared the three layouts, which is the only reason a missing line
// in one of them could sit there. Section 2 below compares them.
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

/* ── 2. headerShown, which has to be said once for the whole group ─────────
 *
 * Two rules, and the second is what actually catches the regression:
 *
 *   a. Every group layout sets `headerShown` in `screenOptions`. Left unset,
 *      the navigator default is `true` and every screen the layout does not
 *      mention individually gets a header.
 *
 *   b. No `<Tabs.Screen>` sets `headerShown` for itself. That is the defect's
 *      own footprint: setting it per-screen looks like handling it, and covers
 *      only the screens somebody remembered. Rule (a) alone would have passed
 *      the broken file the moment anyone added the group-wide line without
 *      removing the five per-screen ones, leaving the same trap half-armed.
 *
 * Deliberately narrow. Other options — title, href, tabBarIcon — SHOULD differ
 * per screen; that is what they are for. `headerShown` is the one whose right
 * home is the group, because the screens that need it most are the ones nobody
 * thought to name.
 */
for (const g of GROUPS) {
  const dir = join('app', g);
  const layout = readFileSync(join(dir, '_layout.tsx'), 'utf8');

  // `screenOptions={{ … }}`, matched by counting braces rather than by regex:
  // the object holds arrow functions and nested objects, so the first `}}` is
  // not the end of it.
  const at = layout.indexOf('screenOptions');
  let opts = '';
  if (at !== -1) {
    const open = layout.indexOf('{', layout.indexOf('=', at));
    let depth = 0;
    for (let i = open; i < layout.length; i++) {
      if (layout[i] === '{') depth++;
      else if (layout[i] === '}') { depth--; if (depth === 0) { opts = layout.slice(open, i + 1); break; } }
    }
  }
  if (!/\bheaderShown\s*:/.test(opts)) {
    console.error(
      `${dir}/_layout.tsx does not set headerShown in screenOptions.\n`
      + '  Unset, the navigator default is true, so every screen this layout does not\n'
      + '  name individually draws a header over the one the screen draws itself.\n'
      + '  Add `headerShown: false` to screenOptions.',
    );
    bad++;
  }

  for (const m of layout.matchAll(/<Tabs\.Screen\b/g)) {
    let end = layout.length;
    for (let j = m.index; j < layout.length; j++) {
      if (layout[j] === '>' && layout[j - 1] !== '=') { end = j; break; }
    }
    const el = layout.slice(m.index, end);
    if (/\bheaderShown\s*:/.test(el)) {
      const n = /\bname\s*=\s*"([^"]+)"/.exec(el);
      console.error(
        `${dir}/_layout.tsx sets headerShown on <Tabs.Screen name="${n ? n[1] : '?'}">.\n`
        + '  Set it once in screenOptions for the whole group instead. Per-screen, it\n'
        + '  covers only the screens somebody remembered to name — which is how sixty-six\n'
        + '  client screens ended up with a header nobody wanted.',
      );
      bad++;
    }
  }
}

if (bad) {
  console.error(`\n${bad} problem${bad === 1 ? '' : 's'} in the three tab groups.`);
  process.exit(1);
}
console.log('check-tabs: ok — every route in the three groups is declared, and each group settles headerShown once');
