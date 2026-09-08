#!/usr/bin/env node
// Two accessibility rules that are decidable from source text.
//
// `src/lib/a11y.ts` measures colour and touch targets, and `src/lib/a11y.test.ts`
// walks the palettes with it. Neither of them can see a SCREEN. This is the lint
// over the screens, and it holds exactly two rules — the two whose violation has
// a single unambiguous shape in this codebase, and no others, because a gate
// that argues about taste gets switched off.
//
// ── Rule 1: a touchable with no children must say what it is ──────────────
//
// Sixty-eight times across the three apps, a bottom sheet opens like this:
//
//     <Modal visible={open} transparent animationType="slide" …>
//       <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={close} />
//       <View style={sheet}>…</View>
//
// The dimmed area above the sheet, tap to dismiss. It has NO CHILDREN, so there
// is no text for a screen reader to name it by, and no `accessibilityLabel`
// giving it one instead. React Native does not treat that as decoration:
// Pressable renders its View with `accessible={accessible !== false}`
// (node_modules/react-native/Libraries/Components/Pressable/Pressable.js), so a
// control with no name at all is still FOCUSABLE.
//
// What VoiceOver meets when a sheet opens is therefore an unnamed element
// covering the top third to half of the screen, announced as nothing, which
// dismisses the sheet if you double-tap it. The reader who most needs to be told
// what just appeared gets, first, the one thing on screen that says nothing —
// and the gesture that takes it away again.
//
// A childless touchable is the one case where "no label" is decidable without
// rendering: there is no other place a name could come from. So the rule is
// narrow and total — name it, or mark it hidden and say at the call site what
// the OTHER way out is. `Scrim` in src/ui/kit.tsx is the shared shape for both,
// and src/ui/DateSheet.tsx argues the hidden case.
//
// ── Rule 2: a pinned lineHeight is a clipped paragraph ────────────────────
//
// src/lib/typeScale.ts states the rule it exists for: React Native scales
// `fontSize` with the reader's text setting and never scales `lineHeight`. Every
// step in src/theme/scale.ts now carries a line height multiplied by the same
// number the platform is multiplying the font size by, so `...ty.caption` is
// correct on its own.
//
// A style that spreads one of those steps and then writes `lineHeight: 18` after
// it puts the defect straight back, in the one paragraph it touches. At iOS
// accessibility-extra-large that is 28pt glyphs laid out in an 18pt line.
// `grown()` is the fix and it is one word.
//
// ── Rule 3: a label that is one FIELD of a row swallows the rest of it ────
//
// React Native merges an `accessible` element's children into a single
// accessibility element, and an `accessibilityLabel` on it does not ADD to what
// they say — it REPLACES it. `Pressable` renders `accessible={accessible !==
// false}`, so every touchable row in this app is one element, and its label is
// the whole of what a screen reader is told about it.
//
// That is fine when the label is a sentence assembled for the ear — `spoken` in
// src/ui/kit.tsx, `prSpoken` in app/(client)/records.tsx, `mealRowSpoken` in
// src/lib/meals.ts. It is a defect when the label is one FIELD of the row's own
// data and the row draws several lines:
//
//     <Pressable accessibilityLabel={m.n}>       ← the dish's name
//       <Text>{m.slot} · Coach's pick</Text>
//       <Text>{m.n}</Text>
//       <Text>Contains {…}</Text>                ← the allergen mark
//       <Text>{m.K}</Text><Text>kcal</Text>
//
// That is app/(client)/nutrition.tsx as it stood, on all three of its meal
// lists. The per-row allergen mark exists because a warning at the top of a
// screen does not tell you WHICH DISH — and the member who cannot see the mark
// was told "Harissa halloumi, button" and nothing else. The same shape on
// app/(client)/trainers.tsx dropped the price, the credentials and "Request
// pending" from every row of the coach directory; on app/(trainer)/templates.tsx
// and builder.tsx it dropped "replaces the programme they are on" from the
// control that overwrites somebody's training.
//
// So: an `accessibilityLabel` whose whole expression is a PROPERTY ACCESS —
// `c.name`, `m.n`, `e.display.text` — on an element with two or more `<Text>`
// descendants. A property access is a value the row happened to carry; a
// sentence for the ear is a value somebody wrote. The rule cannot tell a good
// sentence from a bad one, and does not try: it asks only whether anybody
// composed one at all.
//
// A bare identifier (`spoken`, `shown`, `label`) is NOT flagged, deliberately.
// It is the shape a composed sentence takes, and flagging it would put every
// correct call site on the standing list beside the defects, which is how a
// list stops being read.
//
// ── Rule 4: an icon that MIRRORS cannot be named by its icon ──────────────
//
// `Ghost` in src/ui/kit.tsx names an icon-only button from its icon when the
// call site gives it nothing else:
//
//     const spoken = a11yLabel || label || (icon ? ICON_NAMES[icon] ?? icon : undefined);
//
// That table is a good answer for a fixed glyph — 'search' is Search, 'bell' is
// Notifications — and the comment above it says it exists because 57 back
// buttons were announcing themselves as an unnamed "button".
//
// It cannot be a good answer for BACK_ICON, because BACK_ICON is not a glyph.
// src/lib/direction.ts:
//
//     export function backIcon(rtl: boolean): Chevron { return rtl ? 'chevron' : 'back'; }
//
// So the SAME call site resolves to 'back' for a left-to-right reader and
// 'chevron' for a right-to-left one, and ICON_NAMES has both: 'back' is "Back"
// and 'chevron' is "More". One hundred back buttons across the three apps
// therefore announced "Back" in English and "More" in Arabic — the same button,
// the same file, a different and confidently WRONG word, in the direction
// nobody develops in. A missing label is silence; this is a label that lies,
// and no amount of reading the screen in English would ever show it.
//
// The rule is the whole of that shape and nothing else: a `<Ghost>` whose icon
// is one of the two mirroring constants and which passes neither `a11yLabel`
// nor a visible `label`. It is one prop to fix — `a11yLabel="Back"` — which is
// what every call site in src/ui already does (FeedbackScreen, EndReasonSheet,
// notifications) and what every screen in all three apps now does too: the 58
// in app/(client) first, then the 43 in app/(trainer) and app/(owner), so Rule 4
// carries nothing on the standing list any more and a hit is a regression.
//
// Two of those 43 were NOT back buttons — the month stepper on the coach
// calendar draws BACK_ICON and FORWARD_ICON either side of the month name, and
// "Back" there would be a second lie in place of the first. They say "Previous
// month" and "Next month", which is what the control does. The rule cannot tell
// the two shapes apart and does not try; whoever fixes one has to read it.
//
// A Ghost with a visible `label` is NOT flagged: its words are the name, and
// the icon beside them is decoration. `<Icon name={BACK_ICON}>` inside a
// Pressable that names itself is not flagged either — the icon there is not
// the thing being named.
//
// ── What this deliberately CANNOT see ─────────────────────────────────────
//
// It is a lint over source text. It does not render, does not resolve a
// variable, and measures nothing.
//
//  · Rule 3 counts `<Text>` tags, not facts. A row that draws its second line
//    through a component rather than a <Text> is invisible to it, and a row
//    whose two Texts are a label and its own trailing chevron is flagged for
//    nothing. The standing list carries the second kind.
//
//  · A touchable with children is never flagged, however unnamed. `<Pressable>`
//    around a bare `<Icon>` is a real defect and is invisible here, because the
//    check cannot tell that from a Pressable around a <Text> that names it
//    perfectly well. Ghost's ICON_NAMES table in kit.tsx is what covers the
//    common form of it.
//  · It cannot see a tap target. Size comes from styles, padding, flex and the
//    parent's layout, none of which are readable from text; `hitSlopFor` in
//    src/lib/a11y.ts is the fix and `meetsTarget` is the arithmetic, but which
//    number to hand them is a judgement about a rendered box.
//  · `lineHeight: someVariable` passes, and `lineHeight: 1.5` in studio-web
//    is CORRECT — a browser multiplies a unitless line-height by the font size,
//    which is the very behaviour React Native lacks. So web is not walked.
//  · It says nothing about whether a label is any GOOD. "button" as an
//    accessibility label passes this and helps nobody.
//
// ── The standing list, and why it does not have to count down ─────────────
//
// Rules 3 and 4 carry NOTHING on this list, and that is the point of them: all
// fifteen Rule 3 found on its first run were fixed in the same change that added
// it, and Rule 4's hundred were cleared across two changes — 58 in app/(client),
// then the last 43 in app/(trainer) and app/(owner). For both rules a hit is now
// a regression rather than a backlog and there is no list to argue with.
//
// The offences below were all present when this file was written and every one of
// them is in a screen under app/. The list may not GROW: a new one fails the
// build. It is deliberately not required to SHRINK,
// unlike the ratchet in check-contrast.mjs, because several people are editing
// these files and a gate that goes red because somebody FIXED something is a
// gate that gets deleted. Prune it when you fix one; nothing breaks if you
// forget, and `--prune` prints the list as it should now read.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['app', 'src'];

/* ── the standing offences, by file:line-independent key ──────────────────
 * Keyed by file plus the source text of the tag, NOT by line number — line
 * numbers move every time somebody edits above them, and a ratchet that goes
 * red because a comment was added two hundred lines up is noise.
 */
const KNOWN = new Set([
  'app/(client)/agreements.tsx|lineHeight',
  'app/(client)/consistency.tsx|lineHeight',
  'app/(client)/my-coach.tsx|lineHeight',
  'app/(owner)/dashboard.tsx|scrim',
  'app/(owner)/equipment.tsx|scrim',
  'app/(owner)/members.tsx|scrim',
  'app/(owner)/rota.tsx|scrim',
  'app/(trainer)/analytics.tsx|scrim',
  'app/(trainer)/builder.tsx|lineHeight',
  'app/(trainer)/builder.tsx|scrim',
  'app/(trainer)/calendar.tsx|scrim',
  'app/(trainer)/chat.tsx|scrim',
  'app/(trainer)/classes.tsx|scrim',
  'app/(trainer)/client.tsx|scrim',
  'app/(trainer)/credentials.tsx|scrim',
  'app/(trainer)/dashboard.tsx|lineHeight',
  'app/(trainer)/dashboard.tsx|scrim',
  'app/(trainer)/group.tsx|scrim',
  'app/(trainer)/log-session.tsx|scrim',
  'app/(trainer)/payments.tsx|scrim',
  'app/(trainer)/settings.tsx|scrim',
  'app/(trainer)/templates-messages.tsx|scrim',
  'app/(trainer)/templates.tsx|scrim',
]);

/* ── walking ──────────────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Where a JSX opening tag ends.
 *
 * Not a regex. `style={{ flex: 1 }}` contains a `}` and `>` can appear inside a
 * brace expression (`onPress={() => close()}`), so the `>` that closes the tag
 * is the first one at brace depth zero. Getting this wrong is how a checker
 * decides a tag is self-closing when it is not.
 */
function tagEnd(src, i) {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return k;
  }
  return -1;
}

/**
 * The file with every comment blanked to spaces, offsets preserved.
 *
 * Not cosmetic. This repo documents in prose and quotes the code it is arguing
 * about — the `Scrim` doc comment in src/ui/kit.tsx contains the exact silent
 * `<Pressable …/>` line it exists to replace, and the first run of this gate
 * duly reported the documentation as the defect. Blanking rather than deleting
 * keeps every byte where it was, so a reported line number is still the line.
 *
 * Strings are tracked because a `//` inside one ("https://…") is not a comment,
 * and blanking from there to the end of the line would eat real code.
 */
function blankComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (out[k] !== '\n') out[k] = ' ';
      i = stop; continue;
    }
    if (c === '/' && d === '/') {
      let k = i;
      while (k < n && src[k] !== '\n') { out[k] = ' '; k++; }
      i = k; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      while (k < n) {
        if (src[k] === '\\') { k += 2; continue; }
        if (src[k] === c) { k++; break; }
        if (c !== '`' && src[k] === '\n') break;   // unterminated; give up rather than eat the file
        k++;
      }
      i = k; continue;
    }
    i++;
  }
  return out.join('');
}

const TOUCHABLE = /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/g;
/**
 * The two direction-dependent icon constants. Both resolve to a DIFFERENT
 * member of ICON_NAMES depending on the reader's writing direction, so neither
 * can be named by the table. See Rule 4 in the header.
 */
const MIRRORING_ICON = /icon=\{(BACK_ICON|FORWARD_ICON)\}/;

/** A literal `lineHeight: 18`. `lineHeight: grown(18)` and `lineHeight: h` pass. */
const PINNED_LINE_HEIGHT = /\blineHeight\s*:\s*\d+(\.\d+)?\s*[,}]/g;

/* ── rule 3 ──────────────────────────────────────────────────────────────── */

/** Any element that could carry a label. Components too — a row is as often a
 *  <Pressable> as it is somebody's <Card>. */
const ELEMENT = /<([A-Z][A-Za-z0-9]*)\b/g;

/**
 * A whole expression that is nothing but a property access: `c.name`,
 * `e.display.text`, `LABEL[k]`. Anchored at both ends, so a template literal, a
 * call, a ternary, an array `.join()` — anything somebody composed — is not
 * this. A BARE identifier is not this either; see the header.
 */
const FIELD_ONLY = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]*\])+$/;

/** How many `<Text>`s under this row make it more than a name. Two: a row that
 *  draws a second line is a row saying a second thing. */
const ROW_TEXTS = 2;

/**
 * The source between an opening tag and its matching close, or null if the tag
 * never closes in this file.
 *
 * Nesting is counted by NAME rather than assumed: a <View> inside a <View> is
 * the ordinary shape of every row in this app, and a scanner that stopped at
 * the first `</View>` would read one line of a five-line row.
 */
function childrenOf(src, name, tagEndIdx) {
  let depth = 1;
  let i = tagEndIdx + 1;
  while (i < src.length && depth > 0) {
    const open = src.indexOf('<' + name, i);
    const close = src.indexOf('</' + name + '>', i);
    if (close < 0) return null;
    if (open >= 0 && open < close) {
      const e = tagEnd(src, open);
      if (e >= 0 && src[e - 1] !== '/') depth++;
      i = e < 0 ? open + 1 : e + 1;
    } else {
      depth--;
      if (depth === 0) return src.slice(tagEndIdx + 1, close);
      i = close + name.length + 3;
    }
  }
  return null;
}

const found = [];   // { key, file, line, rule, text }

for (const file of ROOTS.flatMap((r) => walk(join(ROOT, r)))) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const raw = readFileSync(file, 'utf8');
  const src = blankComments(raw);
  const lineOf = (i) => src.slice(0, i).split('\n').length;

  // Rule 1
  let m;
  TOUCHABLE.lastIndex = 0;
  while ((m = TOUCHABLE.exec(src))) {
    const end = tagEnd(src, m.index);
    if (end < 0) continue;
    const tag = src.slice(m.index, end + 1);
    if (src[end - 1] !== '/') continue;               // has children — not ours to judge
    if (/accessibilityLabel/.test(tag)) continue;      // named
    if (/accessibilityElementsHidden/.test(tag)) continue; // deliberately not a stop
    found.push({
      key: `${rel}|scrim`, file: rel, line: lineOf(m.index), rule: 'unnamed',
      text: tag.replace(/\s+/g, ' ').slice(0, 96),
    });
  }

  // Rule 4
  const GHOST = /<Ghost\b/g;
  while ((m = GHOST.exec(src))) {
    const end = tagEnd(src, m.index);
    if (end < 0) continue;
    const tag = src.slice(m.index, end + 1);
    const which = tag.match(MIRRORING_ICON);
    if (!which) continue;
    if (/\ba11yLabel\s*=/.test(tag)) continue;   // named outright
    if (/\blabel\s*=/.test(tag)) continue;       // named by the words it draws
    found.push({
      key: `${rel}|backicon`, file: rel, line: lineOf(m.index), rule: 'mirroring',
      // Which constant it was. The advice differs: a BACK_ICON is almost always
      // a back button, and a FORWARD_ICON never is — the one this rule caught
      // was the forward half of a month stepper, where "Back" would have been a
      // second wrong word in place of the first.
      icon: which[1],
      text: tag.replace(/\s+/g, ' ').slice(0, 96),
    });
  }

  // Rule 3
  ELEMENT.lastIndex = 0;
  while ((m = ELEMENT.exec(src))) {
    const end = tagEnd(src, m.index);
    if (end < 0) continue;
    if (src[end - 1] === '/') continue;               // no children to swallow
    const tag = src.slice(m.index, end + 1);
    // `[^{}]*` and not `.*`: a label holding a nested brace expression is not a
    // bare field by definition, and matching greedily past it would read the
    // end of some later prop as the end of this one.
    const lbl = tag.match(/accessibilityLabel=\{([^{}]*)\}/);
    if (!lbl) continue;
    const expr = lbl[1].trim();
    if (!FIELD_ONLY.test(expr)) continue;
    // A hint is the second channel and VoiceOver reads it after the label, so a
    // row that names itself and hints the rest has said both things. The option
    // sheets in app/(client)/pt-sessions.tsx and messages.tsx are that shape:
    // `accessibilityLabel={o.label} accessibilityHint={o.note}` beside a <Text>
    // of each. Not a defect, and not something to argue about on a list.
    if (/accessibilityHint/.test(tag)) continue;
    const body = childrenOf(src, m[1], end);
    if (body == null) continue;
    if ((body.match(/<Text\b/g) || []).length < ROW_TEXTS) continue;
    found.push({
      key: `${rel}|field:${expr}`, file: rel, line: lineOf(m.index), rule: 'field',
      text: `<${m[1]} … accessibilityLabel={${expr}}>`,
    });
  }

  // Rule 2 — src/theme is where the grown line heights are DEFINED.
  if (rel.startsWith('src/theme/')) continue;
  PINNED_LINE_HEIGHT.lastIndex = 0;
  while ((m = PINNED_LINE_HEIGHT.exec(src))) {
    found.push({
      key: `${rel}|lineHeight`, file: rel, line: lineOf(m.index), rule: 'lineHeight',
      text: src.slice(m.index, m.index + 40).split('\n')[0],
    });
  }
}

const fresh = found.filter((f) => !KNOWN.has(f.key));
const standing = found.filter((f) => KNOWN.has(f.key));
const stale = [...KNOWN].filter((k) => !found.some((f) => f.key === k));

if (process.argv.includes('--prune')) {
  const live = [...new Set(found.map((f) => f.key))].sort();
  console.log(live.map((k) => `  '${k}',`).join('\n'));
  process.exit(0);
}

if (fresh.length) {
  console.error('New accessibility offences — see the header of scripts/check-a11y.mjs.\n');
  for (const f of fresh) {
    if (f.rule === 'field') {
      console.error(`  ${f.file}:${f.line}  an accessibility label that is one field of the row`);
      console.error(`    ${f.text}`);
      console.error('    → React Native merges the children into one element and this label');
      console.error('      REPLACES them, so every other line on this row goes silent. Compose the');
      console.error('      sentence — see mealRowSpoken in src/lib/meals.ts, or the header here.\n');
    } else if (f.rule === 'mirroring') {
      console.error(`  ${f.file}:${f.line}  an icon-only button named by a MIRRORING icon`);
      console.error(`    ${f.text}`);
      if (f.icon === 'FORWARD_ICON') {
        console.error('    → FORWARD_ICON is \'chevron\' left-to-right and \'back\' right-to-left, and');
        console.error('      ICON_NAMES in src/ui/kit.tsx calls them "More" and "Back". This button');
        console.error('      therefore says "More" in English and "Back" in Arabic. It is NOT a back');
        console.error('      button — name the action it performs, as the month stepper on');
        console.error('      app/(trainer)/calendar.tsx does with a11yLabel="Next month".\n');
      } else {
        console.error('    → BACK_ICON is \'back\' left-to-right and \'chevron\' right-to-left, and');
        console.error('      ICON_NAMES in src/ui/kit.tsx calls the second one "More". This button');
        console.error('      therefore says "Back" in English and "More" in Arabic. Give it the');
        console.error('      action it performs: a11yLabel="Back" on a back button, and the step it');
        console.error('      takes — "Previous month" — where it is not one.\n');
      }
    } else if (f.rule === 'unnamed') {
      console.error(`  ${f.file}:${f.line}  a touchable with no children and no name`);
      console.error(`    ${f.text}`);
      console.error('    → React Native makes it focusable anyway, so VoiceOver finds an unnamed');
      console.error('      control it can activate. Use <Scrim> from src/ui/kit.tsx, or give it an');
      console.error('      accessibilityLabel; mark it accessibilityElementsHidden only where the');
      console.error('      sheet has another way out, and say which one.\n');
    } else {
      console.error(`  ${f.file}:${f.line}  a pinned lineHeight`);
      console.error(`    ${f.text.trim()}`);
      console.error('    → React Native never scales lineHeight. Wrap it: lineHeight: grown(18).');
      console.error('      See src/lib/typeScale.ts.\n');
    }
  }
  process.exit(1);
}

if (stale.length) {
  console.log(`a11y: ${stale.length} standing offence${stale.length === 1 ? '' : 's'} on the list no longer present — run with --prune to reprint the list.`);
}
console.log(
  `a11y: ok — no new unnamed touchables, pinned line heights, field-only labels or mirroring-icon buttons`
  + (standing.length ? `, ${standing.length} standing (in ${new Set(standing.map((s) => s.file)).size} files, all listed in the gate)` : ''),
);
