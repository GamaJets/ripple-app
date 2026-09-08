// A status colour is a MARK. It is never the colour of text.
//
// `src/theme/scale.ts` states the rule in its own header — "Status colours
// (warn/crit) are reserved for status and are never used as text colour; a
// coloured mark sits *beside* ink-coloured text instead" — and the app broke it
// in about fifty places, because nothing looked.
//
// The numbers, from src/lib/a11y.ts over the ten palettes in src/theme/tokens.ts:
//
//   t.crit as text   3.03 – 4.05:1   fails AA (4.5) on ALL TEN palettes
//   t.warn as text   3.87 – 4.08:1   fails AA on the three light palettes
//   t.s1…t.s6        3.01:1 floor    walked down to the 3:1 a MARK needs, and
//                                    deliberately not to the 4.5:1 text needs
//
// Those figures are not accidents; tokens.ts says so at the point it sets them.
// The status and series colours were tuned to the 3:1 of WCAG 1.4.11 — a bar, a
// dot, a chart line — and 3:1 is the whole of what they promise. Using one as
// ink asks them for a guarantee they were never given.
//
// What it cost: the failing line was, every time, the one sentence that said
// something had gone wrong — "your calendar could not be read", "your notes
// could not be read", "the cover you listed has expired", "Remove this meal".
// The app rendered its most important sentence in its least readable colour, on
// a phone, one-handed, often outdoors. `Flag()` in src/ui/kit.tsx has been the
// intended shape for this the whole time: the tone goes in a 6pt dot, the words
// go in ink.
//
// ── What this checks ──────────────────────────────────────────────────────
//
// A `color:` style property, anywhere under app/ or src/ui, whose value names a
// status or series token. `color` on a React Native style is text ink and
// nothing else, which is what makes a one-property rule possible here.
// Conditionals are read too — `color: bad ? t.crit : t.ink3` is the same defect
// with a branch in front of it, and was the commoner of the two forms.
//
// ── What it CANNOT see, and you should not read it as claiming ────────────
//
// This is a lint over source text. It does not render anything, does not
// resolve a variable, and does not measure a single ratio — src/lib/a11y.test.ts
// is what measures, and it walks the palettes rather than the screens. So:
//
//   · A colour reached indirectly is invisible to it. `const tone = t.crit`
//     two lines up, a helper that returns a token, a `tone` prop threaded
//     through a component — all pass.
//   · It cannot tell a <Text> from an <Icon>. It does not need to for `color:`
//     in a style, but it means a `color:` key in a plain DATA object that feeds
//     a mark looks identical to ink. Those are named in MARKS below, each with
//     the reason it is genuinely a mark.
//   · It says nothing about ink on ground. ink3 on surface3 failed AA on nine
//     palettes and no regex would have found it; a11y.test.ts did.
//   · It only knows the tokens in STATUS. A raw '#d34646' typed into a style
//     passes, and would be just as unreadable.
//
// It catches the form the mistake actually takes in this codebase, and that is
// the claim it makes.
//
// ── why rule 1's ROOTS stop at the app, and what the console needs instead ──
//
// Recorded here because a sweep over the gates reported rule 1 as not walking
// the console, and offered a reason that is not this file's: that a unitless
// CSS `line-height` is right on the web and wrong in React Native. That is a
// true sentence and it belongs to check-a11y.mjs, whose rule 2 is about
// `lineHeight` and which argues it in its own header. It has nothing to do
// with colour and nothing to do with this file.
//
// The real reason is narrower and it is mechanical. STATUS above is
// `\bt\.(crit|warn|serious|good|s[1-6])\b` — the React Native theme OBJECT, as
// `t.crit`. The console has no `t`. It spells the same token as a CSS custom
// property, `var(--crit)`. So adding `studio-web/app` to ROOTS would scan
// thirty-odd more files and match nothing, and the passing line would then
// claim the console holds a rule it was never tested against. A wider root is
// not the repair.
//
// ── the repair, described rather than built, and why ──────────────────────
//
// The web-shaped sibling is one regex away in principle: a `color:` property
// whose value is `var(--crit|--warn|--serious|--good|--s1…--s6)`, over
// studio-web's .tsx and globals.css. It is NOT built here, and the reason is
// the finding, not squeamishness about the work.
//
// The defect is real and it is measured. Rule 2 below already walks this
// console's palette and holds its status colours to the 3:1 of WCAG 1.4.11,
// because that is what a MARK promises. Asked the text question instead, the
// same arithmetic on the same file says:
//
//   dark   --crit #d34646 on --surface3 #1b3229   3.08:1   AA text needs 4.5
//   dark   --crit          on --surface2          3.57:1
//   dark   --crit          on --surface           3.80:1
//   dark   --good #0ca30c on --surface3           4.08:1
//   light  --crit #cf3737 on --surface3           4.05:1
//   light  --warn #956703 on --surface3           4.08:1
//   light  --serious      on --surface3           4.04:1
//   light  --brand #b45309 on --surface3          4.12:1
//
// and the console draws SENTENCES in those colours — `role="alert"` error text
// on /page.tsx and /settings, blocker paragraphs on /accounting and /close, a
// "let in and marked present" note on /classes. Same defect as the app's, same
// cost, in the console's own spelling.
//
// The count above was re-derived before anything was done about it and comes
// out at 220 sites in 32 files, by `color:` declaration rather than by token
// occurrence — 66 --crit, 80 --warn, 16 --good, 70 --brand, no --serious.
// Either way it is 32 files. The app's fix is `<Flag>` — the tone in a 6pt dot,
// the words in ink — and there is no `<Flag>` in this console; introducing one
// and moving 220 sites onto it is a redesign of every screen a gym owner uses,
// not a lane's edit. The thing that must NOT be done is to write the sibling
// lint and then paste 220 markers, or seed a KNOWN list with 32 files: a gate
// whose author annotates other people's code into silence has weakened the
// rule, and done it from the position least able to judge each site.
//
// ── which of the two repairs was taken ────────────────────────────────────
//
// The second one: the palette. Every one of those 220 sites became correct with
// no call-site churn by walking the hexes in globals.css until each clears
// 4.5:1 on the worst ground it sits on, in both themes and under `@media print`
// — the hold-the-hue-move-the-lightness method src/theme/tokens.ts uses. What
// moved, measured on all five grounds of all four palettes rule 2 builds:
//
//   dark   --good  #0ca30c -> #0dae0d   4.08 -> 4.61   hue and saturation held
//   dark   --crit  #d34646 -> #ff6060   3.08 -> 4.62   hue held, saturation 62%
//                                                      -> 100%: see globals.css,
//                                                      no 62%-saturated red
//                                                      reaches 4.5 on --surface3
//                                                      without going dusty rose
//   light  --good  #0a820a -> #097809   4.09 -> 4.65
//   light  --warn  #956703 -> #8a5f03   4.08 -> 4.63
//   light  --serious #c44717 -> #b54115 4.04 -> 4.62
//   light  --crit  #cf3737 -> #c22f2f   4.05 -> 4.60
//   light  --brand #b45309 -> #a84d08   4.12 -> 4.62
//   print  the four status colours re-taken from the light block, as before
//
//   dark --warn #fab219 (7.46), dark --serious #ec835a (5.19) and dark --brand
//   #e0912f (5.38) already cleared and were not touched.
//
// Every hue is held to within 0.2 degrees and every saturation exactly, except
// --crit's in the dark, so the set is no less distinguishable than it was:
// crit/serious is 25.0 dE76 against the old 25.5, and each colour's own move is
// 4–6 dE76 (12.9 for dark --crit, the one that had furthest to go).
//
// Raising a mark's contrast never breaks its 3:1 floor, so nothing regressed.
// And because the sites are now correct rather than tolerated, the sibling LINT
// described above would be wrong to build: it would fail 220 lines for doing the
// right thing. What holds the repair instead is rule 3 below, which reads those
// same call sites and raises the PALETTE's floor for every token it finds in a
// `color:` — the usage decides the floor, so the next token drawn as ink is
// caught the day it is written.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['app', 'src/ui'];
const ROOT = process.cwd();

/** The tokens tuned to 3:1 as marks, and therefore never safe as ink. */
const STATUS = /\bt\.(crit|warn|serious|good|s[1-6])\b/;

/**
 * `color:` and not backgroundColor / borderColor / tintColor / shadowColor —
 * those take a mark's colour by definition and are the correct home for it.
 */
const COLOR_PROP = /(^|[^A-Za-z])color\s*:/;

/** Where the value we are reading ends: at the next colour property on the line. */
const NEXT_COLOR_PROP = /[A-Za-z]Color\s*:/;

/**
 * Lines where `color:` is a key in a DATA object handed to something that draws
 * a mark — or, rarely, a style property on a <Text> whose content is a GLYPH
 * rather than words. Each carries the reason it is genuinely a mark,
 * because "it's fine" is a claim that has to survive somebody changing the line
 * — and if the line changes, this stops matching and the claim gets made again.
 */
const MARKS = [
  {
    file: 'app/(trainer)/analytics.tsx',
    line: '{ label: STATUS_LABEL.watch, value: watch, color: t.warn },',
    why: 'a <DistBar> segment — a filled bar, which needs 3:1 and has it',
  },
  {
    file: 'app/(trainer)/analytics.tsx',
    line: '{ label: STATUS_LABEL.at_risk, value: riskCount, color: t.crit },',
    why: 'a <DistBar> segment; the legend beside it names each band in ink',
  },
  {
    file: 'app/(owner)/growth.tsx',
    line: "{ label: 'At Risk', value: ca.atRisk, color: t.warn },",
    why: 'a <DistBar> segment; the legend beside it names each band in ink',
  },
  {
    file: 'app/(client)/progression.tsx',
    line: "reps: { label: 'Chase Reps', icon: 'plus', color: (t) => t.good ?? t.brand },",
    why: 'META.color is drawn as an <Icon> and a dot only; the label sits in ink beside it',
  },
  {
    file: 'app/(client)/progression.tsx',
    line: "hold: { label: 'Hold', icon: 'minus', color: (t) => t.warn },",
    why: 'META.color is drawn as an <Icon> and a dot only; the label sits in ink beside it',
  },
  {
    file: 'app/(client)/progression.tsx',
    line: "deload: { label: 'Ease Back', icon: 'swap', color: (t) => t.crit },",
    why: 'META.color is drawn as an <Icon> and a dot only; the label sits in ink beside it',
  },
  {
    file: 'app/(trainer)/client-training.tsx',
    line: "<Text style={{ ...ty.label, width: 14, color: m.coverage === 'logged' ? t.good : m.coverage === 'not-logged' ? t.warn : t.ink3 }}>",
    why: 'a 14pt \u2713 / \u00b7 / ? glyph, not words: the three states differ by SHAPE, and the '
      + 'same row spells each one out ("logged 3 days", "not logged", "could not be answered") '
      + 'in t.ink3. Colour is the third channel here, never the only one',
  },
];

function allowed(file, trimmed) {
  return MARKS.some((m) => m.file === file && m.line === trimmed);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const findings = [];
let scanned = 0;
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    scanned++;
    const rel = relative(ROOT, file);
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const at = line.search(COLOR_PROP);
      if (at < 0) return;
      // From `color:` to the end of the line, cut short at any later colour
      // property so a `backgroundColor: t.warn` further along the same style
      // object is not read as this one's value.
      let val = line.slice(line.indexOf(':', at) + 1);
      const next = val.search(NEXT_COLOR_PROP);
      if (next >= 0) val = val.slice(0, next);
      const m = val.match(STATUS);
      if (!m) return;
      const trimmed = line.trim();
      if (allowed(rel, trimmed)) return;
      findings.push(`${rel}:${i + 1}  color: … ${m[0]} — a status colour used as text ink`);
    });
  }
}

/* ── the empty-set guard for rule 1 ────────────────────────────────────────
 *
 * `app` and `src/ui` held 324 source files the day this was added. A run that
 * reads a handful of them has been pointed somewhere that is not the repository
 * root, and the sentence this file prints at the end — "no status colour is
 * used as text ink" — would then be a claim about a tree it never opened. That
 * sentence is quoted as evidence, so it has to be earned.
 */
if (scanned < 150) {
  console.error(`check-contrast: only found ${scanned} source files under ${ROOTS.join(', ')}, `
    + 'which cannot be right. Run from the repository root. Refusing to pass.');
  process.exit(1);
}

/* ── rule 2: the web console's CSS, measured ───────────────────────────────
 *
 * Everything above is a lint over source text and its own header says what that
 * cannot see: "It says nothing about ink on ground. ink3 on surface3 failed AA
 * on nine palettes and no regex would have found it." That is precisely what
 * then happened to studio-web/app/globals.css.
 *
 * The console's palette is a hand-copy of two entries from src/theme/tokens.ts
 * — teal for the dark theme, clinical for the daylight one. tokens.ts was
 * re-measured and several hexes moved; the copy did not follow, and nothing
 * anywhere compared the two. What the console was left holding:
 *
 *   --ink3        #6f8b87   3.73:1 on --surface3   AA needs 4.5 (was #809996)
 *   --ink3 light  #6b7896   3.63:1 on --surface3   AA needs 4.5 (was #5d6984)
 *   --crit        #d03b3b   2.85:1 as a mark       1.4.11 needs 3.0
 *   --warn light  #fab219   1.51:1 as a mark       the light block held the
 *   --serious lt  #ec835a   2.16:1 as a mark       DARK status set verbatim,
 *   --good light  #0ca30c   2.75:1 as a mark       which is the exact defect
 *                                                   tokens.ts records fixing
 *
 * So this rule does not lint the CSS, it MEASURES it — every ink against every
 * ground it can sit on, and every status colour against the same — using the
 * same WCAG arithmetic as src/lib/a11y.ts. A hex nobody looks at is how this
 * drifted, and a number is the only thing that notices.
 *
 * It deliberately does not require the console's values to EQUAL the tokens'.
 * The console has grounds of its own (--rail) and a brand of its own (Studio
 * amber, not client teal), so equality would be a lie about what these two
 * palettes are to each other. What has to hold is the promise: an ink clears
 * 4.5:1 on every ground it is drawn on, a mark clears 3:1 on the same.
 */
const CSS = 'studio-web/app/globals.css';

/** WCAG 2.x relative luminance and contrast. Mirrors src/lib/a11y.ts, which is
 *  TypeScript and cannot be required from a .mjs check. */
function srgb(hex) {
  const h = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function luminance(hex) {
  const c = srgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const x = luminance(a), y = luminance(b);
  if (x == null || y == null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * EVERY `:root` block in the file, in source order, with the line it starts on
 * and the `@media` condition it sits inside.
 *
 * It used to be one `indexOf(selector)` per block, which found the FIRST `:root`
 * and the FIRST `:root[data-theme="light"]` and stopped. globals.css has four:
 * the dark palette at :18, the daylight one at :86, and two more inside media
 * queries at :203 and :267 that nothing measured. The one at :203 is the print
 * palette, and it is the interesting kind of unmeasured — it overrides `--bg`,
 * `--surface`, `--surface2` and `--rail` to white and `--ink*` to near-black,
 * and leaves `--surface3` and every status colour at the DARK screen value. See
 * the merge below for why that is the shape of the defect rather than a
 * curiosity.
 *
 * Brace-counted rather than cut at the first `\n}`, because a `:root` inside an
 * `@media` block is indented and its closing brace is not at column 0.
 *
 * Only hex values are collected — `--ring` is an rgba() and is not a colour
 * anything is drawn ON, so it has nothing to measure.
 */
function rootBlocks(css) {
  const out = [];
  const re = /(^|\n)\s*(:root[^{\n]*)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const open = css.indexOf('{', m.index + m[0].length - 1);
    let depth = 0, close = -1;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (!depth) { close = i; break; } }
    }
    if (close < 0) continue;
    const vars = {};
    for (const v of css.slice(open, close).matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      vars[v[1]] = v[2];
    }
    const before = css.slice(0, m.index);
    const media = [...before.matchAll(/@media([^{]*)\{/g)].pop();
    out.push({
      selector: m[2].trim(),
      line: before.split('\n').length + (m[1] ? 1 : 0),
      vars,
      // Only a guess at which @media it is inside — good enough to NAME the
      // block in a failure message, which is all it is used for.
      media: media && media.index > css.lastIndexOf('\n}\n', m.index) ? `@media${media[1].trim()}` : null,
    });
  }
  return out;
}

/** Backgrounds a token can be drawn on. --rail is in here because the nav sits
 *  on it and is drawn entirely in --ink3. */
const GROUNDS = ['bg', 'surface', 'surface2', 'surface3', 'rail'];
/** 4.5:1. These are words, at 8–13px, and none of them is large text. */
const INKS = ['ink', 'ink2', 'ink3'];
/** 3:1, WCAG 1.4.11 — a dot, a bar, a 3px border on a banner. In the phone apps
 *  rule 1 above is what keeps them out of `color:`; on the console rule 3 below
 *  finds the ones that are in it anyway and raises their floor to 4.5. */
const MARKS_CSS = ['good', 'warn', 'serious', 'crit', 'brand'];

const AA_TEXT = 4.5;
const AA_MARK = 3;

/* ── rule 3: a token this console spells in `color:` is measured as TEXT ───
 *
 * The header at the top of this file describes a web-shaped sibling to rule 1
 * — a lint banning `color: var(--crit)` under studio-web — and says why it was
 * not built: 244 sites across 32 files, no `<Flag>` on the web to move them
 * onto, and a gate whose author annotates 32 files into silence has weakened
 * the rule. It also names the cheaper repair, "one edit against 244": walk the
 * status hexes until they clear the 4.5:1 text needs on every ground.
 *
 * That repair is the one that was taken, and this is the gate that holds it.
 * Which makes the sibling lint not merely expensive but WRONG: with the palette
 * repaired, `color: var(--crit)` is a correct line, and a rule forbidding it
 * would be failing 220 sites for doing the right thing.
 *
 * So this is not a ban. It is a PROMOTION. It reads studio-web for `color:`
 * properties naming a token, and every token it finds there is measured at
 * AA_TEXT rather than AA_MARK for the rest of this run. The floor follows the
 * usage instead of being asserted: write `color: var(--s3)` tomorrow and --s3
 * is held to 4.5:1 tomorrow, in both themes, on all five grounds, with no
 * edit here.
 *
 * ── text or mark: what is decidable, and what is not ──────────────────────
 *
 * Both are `color: var(--crit)`, and the question "is this line words or a
 * dot?" is NOT decidable from the source. On the web `color` is inherited text
 * ink, but it also drives `currentColor`, so the same declaration can be
 * painting an inline SVG's `fill`, a `border-color: currentColor`, or a `::before`
 * bullet. Nothing in the CSS or the JSX distinguishes those from a sentence.
 * scripts/check-console-ink.mjs makes the same narrowing and says the same
 * thing about `fill` and `stroke`: "this gate has no way to tell a mark from a
 * glyph".
 *
 * This rule does not need to decide it, because it never fails a call site. It
 * only raises a floor in the palette, and that is safe in both directions: a
 * mark drawn at 4.5:1 is still a legal mark, since 4.5 implies the 3:1 of WCAG
 * 1.4.11, whereas a sentence drawn at 3:1 is not legal text. The undecidable
 * case costs a little more contrast on a dot. Guessing the other way costs the
 * gym owner the sentence saying the month cannot close.
 *
 * What it genuinely cannot see, and must not be read as claiming:
 *
 *   · A token reached through a name. `const tone = 'var(--crit)'`, a helper
 *     returning one, a `tone` prop threaded through a component, or a class in
 *     globals.css applied by a component whose declaration is `color: var(--crit)`
 *     — the last of these it does catch, because the declaration is still in a
 *     file it reads, but a token assembled at runtime is invisible. Such a
 *     token keeps the 3:1 mark floor, which is the honest answer: the rule
 *     holds the line where the line is decidable and claims nothing past it.
 *   · A literal hex. `color: '#d34646'` names no token and promotes nothing.
 *     check-console-ink.mjs is the gate for that form and exists for it.
 *   · `background`, `border-color`, `fill`, `stroke`. Those take a mark's
 *     colour by definition and keep the 3:1 floor, deliberately.
 *   · One line at a time, like every other lint here. A `color:` whose value
 *     is on the next line is a miss.
 */
const WEB_ROOT = 'studio-web';
/** `color:` and not `background-color:` / `border-color:` / `borderColor:` /
 *  `-webkit-text-fill-color:`. The hyphen is in the exclusion because CSS
 *  spells its compound properties with one and JSX spells them with a capital. */
const WEB_COLOR_PROP = /(^|[^A-Za-z-])color\s*:/g;
const WEB_NEXT_COLOR_PROP = /[A-Za-z-]color\s*:/i;

function webWalk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === 'out' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) webWalk(p, out);
    else if (/\.(tsx?|css)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** token name -> one `file:line` that draws it as ink, for the failure message. */
const drawnAsInk = new Map();
let webScanned = 0, webColorSites = 0;
try {
  for (const file of webWalk(join(ROOT, WEB_ROOT))) {
    webScanned++;
    const rel = relative(ROOT, file);
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      WEB_COLOR_PROP.lastIndex = 0;
      let m;
      while ((m = WEB_COLOR_PROP.exec(line))) {
        let val = line.slice(line.indexOf(':', m.index + m[0].length - 1) + 1);
        const next = val.search(WEB_NEXT_COLOR_PROP);
        if (next >= 0) val = val.slice(0, next);
        let found = false;
        for (const v of val.matchAll(/var\(\s*--([a-z0-9-]+)\s*\)/g)) {
          found = true;
          if (!drawnAsInk.has(v[1])) drawnAsInk.set(v[1], `${rel}:${i + 1}`);
        }
        if (found) webColorSites++;
      }
    });
  }
} catch (e) {
  findings.push(`${WEB_ROOT}  could not be walked (${e.code ?? e.message}) — no token was promoted to the text floor`);
}

/* The empty-set guard, in the shape rule 1's already has and for the same
 * reason. This rule's whole output is "which tokens are ink", and a run that
 * reads nothing answers "none" — which then measures every status colour at 3:1
 * and prints a pass. A silent downgrade of the floor is the one failure mode a
 * promotion rule has, so it is spelled out rather than trusted. The console held
 * 47 source files and 880 `color:` sites naming a token the day this was added. */
if (webScanned < 30 || webColorSites < 100) {
  findings.push(`${WEB_ROOT}  only ${webScanned} source file(s) and ${webColorSites} \`color: var(--…)\` site(s) — `
    + 'that cannot be the console. Every status colour would fall back to the 3:1 mark floor and pass. Refusing.');
}

/** The tokens this console draws as words, held to AA_TEXT below. */
const PROMOTED = MARKS_CSS.filter((n) => drawnAsInk.has(n));

/**
 * The backlog in the console's stylesheet, and why each is still standing.
 *
 * A RATCHET, not an exemption: the list may shrink and may never grow. Every
 * entry is in `studio-web/app/globals.css`, which this lane does not write.
 */
const KNOWN_CSS = new Map([
  // Empty, and it took twelve entries to get here. All of them were one block:
  // `@media print` in studio-web/app/globals.css repainted the grounds white and
  // the inks near-black and stopped, leaving --surface3 and the four status
  // colours at their DARK screen values. On paper that is amber marks at 1.83:1
  // and a panel at 1.08:1, in a document somebody signs — and only for a reader
  // who happened to be on the default theme when they pressed Print, which is
  // why it survived so long. The print block now names all five, taken from the
  // light palette that already cleared both floors.
]);
const cssStanding = new Set();

let css = null;
try { css = readFileSync(join(ROOT, CSS), 'utf8'); } catch { css = null; }
if (css == null) {
  // NOT a `break`. This used to swallow a missing stylesheet and go on to print
  // "every ink and mark in studio-web/app/globals.css clears its floor", which
  // is a sentence about a file it had failed to open.
  findings.push(`${CSS}  could not be read — the console's palette was not measured at all`);
} else {
  const blocks = rootBlocks(css);
  const base = {
    dark: blocks.find((b) => b.selector === ':root' && !b.media)?.vars,
    light: blocks.find((b) => b.selector.includes('data-theme="light"') && !b.media)?.vars,
  };
  for (const theme of ['dark', 'light']) {
    if (!base[theme]) findings.push(`${CSS}  the ${theme} block could not be read — nothing was measured`);
  }
  if (blocks.length < 2) findings.push(`${CSS}  found ${blocks.length} :root block(s) — the stylesheet has been reshaped and this check can no longer read it`);

  /**
   * Every palette the console can actually render in: the two screen bases, and
   * each override block MERGED OVER each base.
   *
   * The merge is the point. A block inside `@media print` that sets `--bg` to
   * white and stops does not get a fresh palette — it gets the screen's, with
   * its own values on top. Half a palette overridden is the shape the defect
   * takes: white grounds under status colours picked for a near-black one.
   */
  const palettes = [];
  for (const theme of ['dark', 'light']) {
    if (!base[theme]) continue;
    palettes.push({ name: theme, vars: base[theme], line: blocks.find((b) => b.vars === base[theme]).line });
    for (const b of blocks) {
      if (b.vars === base.dark || b.vars === base.light) continue;
      if (!Object.keys(b.vars).length) continue;   // a block that sets no colour
      const label = (b.media ?? b.selector).replace(/@media\s*/, '').replace(/[()]/g, '').split(':')[0].trim();
      palettes.push({ name: `${label} over ${theme}`, vars: { ...base[theme], ...b.vars }, line: b.line });
    }
  }

  for (const p of palettes) {
    const v = p.vars;
    for (const [names, floor, kind] of [
      [INKS, AA_TEXT, 'as text'],
      [PROMOTED, AA_TEXT, 'as text'],
      [MARKS_CSS.filter((n) => !PROMOTED.includes(n)), AA_MARK, 'as a mark'],
    ]) {
      for (const name of names) {
        if (!v[name]) continue;
        for (const g of GROUNDS) {
          if (!v[g]) continue;
          const r = ratio(v[name], v[g]);
          if (r == null || r >= floor) continue;
          const why = PROMOTED.includes(name) ? ` — text because ${drawnAsInk.get(name)} draws it in a \`color:\`` : '';
          const what = `${p.name}: --${name} ${v[name]} on --${g} ${v[g]} is ${r.toFixed(2)}:1 ${kind}, under ${floor}${why}`;
          if (KNOWN_CSS.has(what)) { cssStanding.add(what); continue; }
          findings.push(`${CSS}:${p.line}  ${what}`);
        }
      }
    }
    // --brand-ink is the label written ON --brand, so it is measured against
    // that one ground rather than the page's. This is the check tokens.ts does
    // in code with brandInkFor(); here the pair is typed by hand and nothing
    // resolved it.
    if (v['brand-ink'] && v.brand) {
      const r = ratio(v['brand-ink'], v.brand);
      if (r != null && r < AA_TEXT) {
        const what = `${p.name}: --brand-ink ${v['brand-ink']} on --brand ${v.brand} is ${r.toFixed(2)}:1, under ${AA_TEXT}`;
        if (KNOWN_CSS.has(what)) cssStanding.add(what);
        else findings.push(`${CSS}:${p.line}  ${what}`);
      }
    }
  }

  // A KNOWN_CSS entry that no longer reproduces. Reported so the backlog comes
  // down with the work rather than sitting there as a licence.
  const staleCss = [...KNOWN_CSS.keys()].filter((k) => !cssStanding.has(k));
  if (!findings.length && staleCss.length) {
    console.error('KNOWN_CSS is out of date — the ratchet only counts down if somebody turns it:\n');
    for (const k of staleCss) console.error(`  ${k}`);
    console.error('\nDelete those lines from KNOWN_CSS in scripts/check-contrast.mjs.\n');
    process.exit(1);
  }
}

if (findings.length) {
  console.error(`${findings.length} contrast problem(s):\n`);
  for (const f of findings) console.error('  ' + f);
  console.error(
    '\nStatus and series colours are tuned to the 3:1 a MARK needs (WCAG 1.4.11) and'
    + '\nnot to the 4.5:1 text needs: crit as text is 3.03–4.05:1 on all ten palettes,'
    + '\nwarn 3.87–4.08:1 on the three light ones. Move the tone to a mark and leave'
    + '\nthe words in ink:'
    + '\n'
    + '\n    <Flag tone={t.warn}>The whole sentence goes here</Flag>'
    + '\n'
    + '\nor, for a short label inside a row, a 6pt dot beside it with the text on'
    + '\nt.ink / t.ink2. The words must already say it — colour is never the only'
    + '\nchannel. If the line is genuinely a MARK, add it to MARKS in'
    + `\n${relative(ROOT, 'scripts/check-contrast.mjs')} with the reason it is one.`
    + '\n'
    + `\nA measured line above is a colour in ${CSS} that does not clear its floor`
    + '\non a ground it is actually drawn on. Hold the hue, walk the lightness until'
    + '\nthe WORST ground clears, and move no further than that — which is the method'
    + '\nsrc/theme/tokens.ts uses and the value to take it from.'
    + '\n'
    + '\nA line ending "text because <file:line> draws it in a `color:`" is a status'
    + '\ncolour the CONSOLE spells as ink, so it is measured at 4.5:1 rather than the'
    + '\n3:1 a mark needs. There is no <Flag> on the web and 220 sites already draw'
    + '\nsentences in these tokens, so the repair is the palette, not the call sites:'
    + `\nwalk that hex in ${CSS} until the worst ground clears 4.5:1. Do NOT silence it`
    + '\nby moving the site off the token — a hex typed in its place fails'
    + '\nscripts/check-console-ink.mjs, and rightly.'
    + '\n'
    + '\nThe other way to see this line is that somebody has just written the first'
    + '\n`color: var(--…)` for a token that was only ever a dot. That is allowed; it'
    + '\nis what promotes the token. The palette then owes it 4.5:1.',
  );
  process.exit(1);
}
console.log(
  `contrast ok — ${scanned} source files under ${ROOTS.join(' and ')} use no status colour as text`
  + `\nink, and every ink and mark in ${CSS} clears its floor on all ${GROUNDS.length} grounds`
  + `${cssStanding.size ? `, except the ${cssStanding.size} on the ratchet below` : ''}`,
);
console.log(
  `\n${webScanned} source files under ${WEB_ROOT}/ draw ${webColorSites} \`color: var(--…)\` sites.`
  + `${PROMOTED.length
    ? `\n${PROMOTED.map((n) => `--${n}`).join(', ')} ${PROMOTED.length === 1 ? 'is' : 'are'} among them, so ${PROMOTED.length === 1 ? 'it is' : 'they are'} measured`
      + ` at ${AA_TEXT}:1 as text\nrather than the ${AA_MARK}:1 a mark needs — e.g. --${PROMOTED[0]} at ${drawnAsInk.get(PROMOTED[0])}.`
      + `${MARKS_CSS.some((n) => !PROMOTED.includes(n))
        ? ` ${MARKS_CSS.filter((n) => !PROMOTED.includes(n)).map((n) => `--${n}`).join(', ')} `
          + `${MARKS_CSS.filter((n) => !PROMOTED.includes(n)).length === 1 ? 'is' : 'are'}\nnot drawn as ink anywhere the source shows, and keep${MARKS_CSS.filter((n) => !PROMOTED.includes(n)).length === 1 ? 's' : ''} the mark floor.`
        : ''}`
    : `\nNone of them names a status colour, so all ${MARKS_CSS.length} keep the ${AA_MARK}:1 mark floor.`}`,
);
if (cssStanding.size) {
  console.log('\nStanding offences (ratcheted, they may not grow):');
  for (const k of cssStanding) console.log(`  ${k}`);
  console.log('\nAll twelve are one block: `@media print { :root { … } }` at '
    + `${CSS}:203. It repaints the grounds white and the inks near-black and stops there —`
    + '\n--surface3 and the four status colours keep their DARK screen values, so a reader on'
    + '\nthe default theme who prints /close or /accounting gets amber marks at 1.83:1 and any'
    + '\n--surface3 panel at 1.08:1, on paper, in a document somebody signs. The daylight'
    + '\npalette prints clean. Fix: give the print block its own --surface3, --warn, --serious,'
    + '\n--good and --crit, taken from the light block, which already clears both floors.');
}
