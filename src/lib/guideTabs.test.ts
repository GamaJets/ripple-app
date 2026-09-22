// The first-run tour, held against the tab bars it describes.
//
// ── What this is guarding, and why it is a test and not a reading ─────────
//
// The tour at app/tour.tsx and the guide at app/guide.tsx both take their
// words from src/lib/guideContent.ts: one GuideSection per tab, in bar order,
// with the tour trimming each to TOUR_POINTS (src/lib/guide.ts). One source,
// which is the right shape — two hand-kept lists would be two things to keep
// true and the tour is the one nobody re-reads.
//
// One source is not the same as a correct one. The list is still typed out by
// hand, and the thing it claims to mirror — <Tabs.Screen> without `href: null`
// in app/(client)/_layout.tsx, app/(trainer)/_layout.tsx and
// app/(owner)/_layout.tsx — lives in three other files that change for reasons
// that have nothing to do with help copy. That drift has shipped twice:
//
//   · guideContent.ts's own header records the coach app being described as
//     five tabs "for as long as Profile has been in the bar", which is six.
//   · app/(client)/glucose.tsx went out over the air with no Tabs.Screen entry
//     at all, which put a sixth item in the client's bar. scripts/check-tabs.mjs
//     was written for that one and says in its own header, in as many words,
//     "This does not check the counts."
//
// Nothing else looks at the titles. So a first-run walkthrough — the one screen
// whose entire job is to tell somebody who has just installed the app what they
// are looking at — could name a tab that is not there, or miss one that is, and
// every gate in this repository would stay green. A tour that names a screen
// the person cannot reach is worse than no tour: it is the app telling a new
// user that the thing they cannot find is their fault.
//
// So this reads the three layouts and requires the guide's tab sections to be
// the bar's tabs: same titles, same order, same number, in every variant. And
// it holds the two intro sentences to that number as well, because those write
// the count out in words ("Six tabs for running your coaching") and a word is
// exactly the kind of thing that does not move when a bar does.
//
// Compile with tsc, run with node.
import { tabsFor, topicsFor, GUIDE_INTRO, TOUR_INTRO, TOUR_POINTS } from './guideContent';
import { guideFor } from './guide';
import type { AppVariant } from './variant';

// A test under src/** is compiled into the app's own tsconfig graph, where
// node:fs has no types and an `import` of it would fail the build. require with
// the shape written out is the house form — see src/lib/consoleRoutes.test.ts.
const { readFileSync } = require('node:fs') as { readFileSync: (p: string, enc: string) => string };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const VARIANTS: AppVariant[] = ['client', 'trainer', 'owner'];

const GROUP: Record<AppVariant, string> = {
  client: 'app/(client)/_layout.tsx',
  trainer: 'app/(trainer)/_layout.tsx',
  owner: 'app/(owner)/_layout.tsx',
};

/* ── reading a tab bar out of a layout ──────────────────────────────────── */

/**
 * The titles expo-router will actually draw in the bar, in the order it draws
 * them.
 *
 * Order is the declaration order of the <Tabs.Screen> children — the coach's
 * Profile is declared LAST, after forty-odd hidden screens, and is the sixth
 * item in the bar for that reason. So the list is built by walking the file
 * rather than by sorting anything.
 *
 * Comments are stripped first. Both the trainer and the client layout discuss
 * `<Tabs.Screen>` in prose in their headers, and a scan that counted those
 * found a seventh coach tab with no title — a failure that would have been read
 * as a defect in the bar rather than in this parser.
 *
 * Still a regex and not a parser, anchored the way scripts/check-tabs.mjs
 * anchors its own: at the element, then to the first `>` that is not the tail
 * of an `=>`, because `tabBarIcon: ({ color }) => …` puts an arrow inside the
 * element and `[^>]` cannot cross it.
 */
function barTitles(v: AppVariant): string[] {
  const raw = readFileSync(GROUP[v], 'utf8');
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

  const titles: string[] = [];
  for (const m of src.matchAll(/<Tabs\.Screen\b/g)) {
    const start = m.index ?? 0;
    let end = src.length;
    for (let j = start; j < src.length; j++) {
      if (src[j] === '>' && src[j - 1] !== '=') { end = j; break; }
    }
    const el = src.slice(start, end);
    // `href: null` is what keeps a route file out of the bar. Everything
    // without it is a tab, which is the whole point of check:tabs.
    if (/href\s*:\s*null/.test(el)) continue;
    const t = /\btitle\s*:\s*'([^']*)'/.exec(el) ?? /\btitle\s*:\s*"([^"]*)"/.exec(el);
    titles.push(t ? t[1] : '(no title)');
  }
  return titles;
}

/** The number written out, as the intro sentences write it. Only as far as the
 *  bars plausibly go — a seventh tab is a decision somebody makes on purpose,
 *  and this failing on it is the correct outcome, not a gap. */
const COUNT_WORD: Record<number, string> = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
};

/* ── the bar is the guide's tab list ────────────────────────────────────── */

for (const v of VARIANTS) {
  const bar = barTitles(v);
  const guide = tabsFor(v).map((s) => s.title);

  // The empty-set guard. A layout that moved, or a parser that stopped
  // matching, would produce no titles and every assertion below would pass
  // against nothing — which is how a check comes to print "ok" about a file it
  // never read.
  ok(bar.length >= 4, `${v}: the layout parses to at least four bar tabs (got ${bar.length}) — if the bar really shrank, the parser here needs looking at too`);
  ok(!bar.includes('(no title)'), `${v}: every bar tab declares a title — an untitled tab renders its route file name, and the guide has nothing to match it against`);

  // The assertion the whole file exists for. Same titles, same order.
  same(guide, bar, `${v}: the guide's tab sections are the tabs in the bar, in bar order`);

  // Said again as a count, because the failure above is easy to read as a
  // typo in one word and this is the half that has actually shipped wrong.
  eq(guide.length, bar.length, `${v}: one guide section per tab`);

  // A section title is the label on the bar, so a reader can match the words in
  // the tour to the word under the icon they are looking at.
  eq(new Set(guide).size, guide.length, `${v}: no two guide sections claim the same tab`);
}

/* ── and the sentence that writes the count out in words ────────────────── */

for (const v of VARIANTS) {
  const n = barTitles(v).length;
  const word = COUNT_WORD[n];
  ok(typeof word === 'string', `${v}: ${n} tabs is outside the range these intros are written for — add the word to COUNT_WORD and check both sentences`);
  if (typeof word !== 'string') continue;

  // Both sentences open with the count. GUIDE_INTRO and TOUR_INTRO are separate
  // strings on purpose — the guide shows topics as well as tabs and the tour
  // does not — but they count the same bar, so they are checked the same way.
  ok(GUIDE_INTRO[v].startsWith(`${word} tab`), `${v}: the guide intro opens with "${word} tab…" for its ${n} tabs — got "${GUIDE_INTRO[v]}"`);
  ok(TOUR_INTRO[v].startsWith(`${word} tab`), `${v}: the tour intro opens with "${word} tab…" for its ${n} tabs — got "${TOUR_INTRO[v]}"`);

  // No digits. These are sentences and the house voice writes a small count as
  // a word; "5 tabs" would slip past the startsWith above only by being wrong
  // in a second way, so it is worth naming.
  ok(!/\d/.test(GUIDE_INTRO[v]), `${v}: the guide intro writes its count as a word`);
  ok(!/\d/.test(TOUR_INTRO[v]), `${v}: the tour intro writes its count as a word`);
}

/* ── the tour is the guide, trimmed — never a second set of words ───────── */

for (const v of VARIANTS) {
  const tour = guideFor(v);
  const tabs = tabsFor(v);
  const topicTitles = new Set(topicsFor(v).map((s) => s.title));

  same(tour.map((s) => s.tab), tabs.map((s) => s.title), `${v}: the tour walks the same tabs as the guide`);

  for (let i = 0; i < tour.length; i++) {
    const card = tour[i];
    const section = tabs[i];

    // A topic — an injury, a booking, a package — is not a tab and must never
    // appear as a card. The tour runs before the member has seen anything, and
    // a walkthrough that opens on the release of liability is not a welcome.
    ok(!topicTitles.has(card.tab), `${v}: "${card.tab}" is a cross-tab topic and has no place in the first-run tour`);

    eq(card.summary, section.summary, `${v}: the ${card.tab} card says what the guide says`);
    ok(card.points.length <= TOUR_POINTS, `${v}: the ${card.tab} card shows at most ${TOUR_POINTS} points`);
    // Two, not three. Studio's Brand tab honestly has two things to say about
    // it, and padding it out to a house minimum is how a guide starts inventing
    // sentences. One is a card with a bullet, which is a formatting accident.
    ok(card.points.length >= 2, `${v}: the ${card.tab} card has at least two points`);

    // Trimming, not rewriting. Every line on a card is a line the guide holds,
    // so there is exactly one place to correct a sentence that has gone stale.
    for (const p of card.points) {
      ok(section.points.includes(p), `${v}: "${p.slice(0, 48)}…" on the ${card.tab} card is a line the guide also holds`);
    }
    same(card.points, section.points.slice(0, TOUR_POINTS), `${v}: the ${card.tab} card is the top of the guide's list, in order`);
  }
}

/* ── voice ──────────────────────────────────────────────────────────────── */

// Held over every section, tabs and topics both, because the guide screen shows
// them side by side and a paragraph that punctuates differently reads as a
// different app talking.
for (const v of VARIANTS) {
  for (const s of [...tabsFor(v), ...topicsFor(v)]) {
    ok(/^[A-Z]/.test(s.title), `${v}: "${s.title}" opens in capitals`);
    ok(s.summary.endsWith('.'), `${v}: the ${s.title} summary is a sentence and ends like one`);
    ok(s.points.length >= 2, `${v}: ${s.title} says at least two things`);
    for (const p of s.points) {
      ok(p.endsWith('.'), `${v}: a ${s.title} point ends its sentence — "${p.slice(0, 48)}…"`);
      // An exclamation mark is the "Welcome to your fitness journey!" register
      // this app does not use anywhere else, and least of all on the screen a
      // new member is judging it by.
      ok(!p.includes('!'), `${v}: a ${s.title} point does not shout — "${p.slice(0, 48)}…"`);
      // Long enough to say something. A tour of five tabs each captioned "Your
      // stuff." is the complaint the tour was built to answer.
      //
      // Thirty rather than the forty the shortest real line happens to be:
      // "Announce writes a note to your trainers." is forty characters, says
      // precisely what that control does, and there is nothing to add to it. A
      // floor set at the current minimum is not a floor, it is a dare — the
      // next honest short sentence fails and somebody pads it to pass.
      ok(p.length > 30, `${v}: a ${s.title} point says something specific — "${p}"`);
    }
    eq(new Set(s.points).size, s.points.length, `${v}: ${s.title} does not say the same thing twice`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('guideTabs.test.ts — ok');
