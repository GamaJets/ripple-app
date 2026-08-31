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
 * a mark, not a style property. Each carries the reason it is genuinely a mark,
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
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
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

/** The custom properties in one `:root` / `:root[data-theme="light"]` block.
 *  Only hex values are collected — `--ring` is an rgba() and is not a colour
 *  anything is drawn ON, so it has nothing to measure. */
function blockVars(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  const close = css.indexOf('\n}', open);
  if (open < 0 || close < 0) return null;
  const vars = {};
  for (const m of css.slice(open, close).matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    vars[m[1]] = m[2];
  }
  return vars;
}

/** Backgrounds a token can be drawn on. --rail is in here because the nav sits
 *  on it and is drawn entirely in --ink3. */
const GROUNDS = ['bg', 'surface', 'surface2', 'surface3', 'rail'];
/** 4.5:1. These are words, at 8–13px, and none of them is large text. */
const INKS = ['ink', 'ink2', 'ink3'];
/** 3:1, WCAG 1.4.11 — a dot, a bar, a 3px border on a banner. Never words:
 *  rule 1 above is what keeps them out of `color:`. */
const MARKS_CSS = ['good', 'warn', 'serious', 'crit', 'brand'];

const AA_TEXT = 4.5;
const AA_MARK = 3;

for (const [selector, theme] of [[':root {', 'dark'], [':root[data-theme="light"]', 'light']]) {
  let css;
  try { css = readFileSync(join(ROOT, CSS), 'utf8'); } catch { break; }
  const v = blockVars(css, selector);
  if (!v) { findings.push(`${CSS}  the ${theme} block could not be read — nothing was measured`); continue; }
  for (const [names, floor, kind] of [[INKS, AA_TEXT, 'as text'], [MARKS_CSS, AA_MARK, 'as a mark']]) {
    for (const name of names) {
      if (!v[name]) continue;
      for (const g of GROUNDS) {
        if (!v[g]) continue;
        const r = ratio(v[name], v[g]);
        if (r != null && r < floor) {
          findings.push(
            `${CSS}  ${theme}: --${name} ${v[name]} on --${g} ${v[g]} is ${r.toFixed(2)}:1 ${kind}, under ${floor}`,
          );
        }
      }
    }
  }
  // --brand-ink is the label written ON --brand, so it is measured against that
  // one ground rather than the page's. This is the check tokens.ts does in code
  // with brandInkFor(); here the pair is typed by hand and nothing resolved it.
  if (v['brand-ink'] && v.brand) {
    const r = ratio(v['brand-ink'], v.brand);
    if (r != null && r < AA_TEXT) {
      findings.push(`${CSS}  ${theme}: --brand-ink ${v['brand-ink']} on --brand ${v.brand} is ${r.toFixed(2)}:1, under ${AA_TEXT}`);
    }
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
    + '\nsrc/theme/tokens.ts uses and the value to take it from.',
  );
  process.exit(1);
}
console.log(
  'contrast ok — no status colour is used as text ink, and every ink and mark in'
  + `\n${CSS} clears its floor on all ${GROUNDS.length} grounds`,
);
