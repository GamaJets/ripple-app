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
// ── What this deliberately CANNOT see ─────────────────────────────────────
//
// It is a lint over source text. It does not render, does not resolve a
// variable, and measures nothing.
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
/** A literal `lineHeight: 18`. `lineHeight: grown(18)` and `lineHeight: h` pass. */
const PINNED_LINE_HEIGHT = /\blineHeight\s*:\s*\d+(\.\d+)?\s*[,}]/g;

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
    if (f.rule === 'unnamed') {
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
  `a11y: ok — no new unnamed touchables or pinned line heights`
  + (standing.length ? `, ${standing.length} standing (in ${new Set(standing.map((s) => s.file)).size} files, all listed in the gate)` : ''),
);
